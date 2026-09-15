import { createHash, randomBytes } from 'crypto';

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

initializeApp();

const GROUP_TYPES = ['familyFriends', 'custom'] as const;
// 'public' added for E2: only 'public' groups are joinable by code. Private and
// inviteOnly groups still have a joinCode (minted on create; back-filled for
// legacy rows) but wsfPreviewCommunity and wsfJoinCommunity treat them as
// not-found so an attacker cannot use those endpoints as an existence oracle.
const JOIN_POLICIES = ['private', 'inviteOnly', 'public'] as const;

type GroupType = (typeof GROUP_TYPES)[number];
type JoinPolicy = (typeof JOIN_POLICIES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Join code — printed on a QR, so PUBLIC by construction, but must not be
// enumerable or derivable from anything else on the group. randomBytes(16)
// yields 128 bits of entropy; base64url is URL-safe and needs no percent
// encoding on either the QR or in a copy-paste. 22 chars. Well above the spec
// minimum of 16.
//
// NOT hashed at rest. It is unguessable, not secret; a hashed store would make
// the lookup path impossible. Do not conflate the two properties.
// ─────────────────────────────────────────────────────────────────────────────
export function mintJoinCode(): string {
  return randomBytes(16).toString('base64url');
}

function normalizeJoinCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  // 16–128 chars, base64url alphabet. Anything else can't be one we minted; a
  // strict shape check keeps garbage out of the query without leaking whether
  // a real code with that shape exists.
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(trimmed)) return null;
  return trimmed;
}

export const wsfHealth = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'wsfHealth requires an authenticated caller.');
    }
    return { ok: true } as const;
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// wsfSaveProfile — create-or-update wsfMemberProfiles/{uid} via the Admin SDK.
//
// A callable, not a client setDoc, for two reasons:
//   1. firestore.rules require adultConfirmation on wsfMemberProfiles create,
//      DECISIONS.md 2026-09-06 removed the age gate, and a rules edit is a
//      separate deploy on Devin's say-so. The Admin SDK write bypasses rules
//      the same way every other WSF write already does.
//   2. The server owns which terms/privacy version is being accepted and when.
//      A client-written version is trivially spoofable; a callable stamps it
//      from server-side constants that mirror profileConstants.ts.
//
// Input:  { displayName: string }  — 2..80 chars after trim.
// Output: { created: boolean }     — true when the document did not exist.
//
// Create writes displayName, both accepted versions, createdAt and updatedAt.
// Update writes displayName and updatedAt; accepted versions are re-stamped
// ONLY if they differ from the stored values, so re-saving through ?edit=1
// leaves createdAt and the consent record untouched when nothing changed.
//
// WSF_ACCEPTED_TERMS_VERSION / WSF_ACCEPTED_PRIVACY_VERSION MUST equal
// apps/westayfit/src/profileConstants.ts. Bump both files in the same PR.
// ─────────────────────────────────────────────────────────────────────────────

const WSF_ACCEPTED_TERMS_VERSION = 'pending-approval-2026-08-25';
const WSF_ACCEPTED_PRIVACY_VERSION = 'pending-approval-2026-08-25';

type SaveProfileRequest = {
  displayName?: unknown;
};

type SaveProfileResponse = { created: boolean };

export const wsfSaveProfile = onCall<SaveProfileRequest>(
  { region: 'us-central1' },
  async (request): Promise<SaveProfileResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'wsfSaveProfile requires an authenticated caller.');
    }
    const token = request.auth.token as { email_verified?: boolean };
    if (token.email_verified !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Verify your email before saving your profile.'
      );
    }
    const uid = request.auth.uid;

    const rawDisplayName = request.data?.displayName;
    if (typeof rawDisplayName !== 'string') {
      throw new HttpsError('invalid-argument', 'displayName must be a string.');
    }
    const displayName = rawDisplayName.trim();
    if (displayName.length < 2 || displayName.length > 80) {
      throw new HttpsError('invalid-argument', 'displayName must be 2-80 characters.');
    }

    const db = getFirestore();
    const ref = db.doc(`wsfMemberProfiles/${uid}`);
    const snap = await ref.get();

    if (!snap.exists) {
      await ref.set({
        displayName,
        acceptedTermsVersion: WSF_ACCEPTED_TERMS_VERSION,
        acceptedPrivacyVersion: WSF_ACCEPTED_PRIVACY_VERSION,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { created: true };
    }

    const existing = snap.data() as {
      acceptedTermsVersion?: string;
      acceptedPrivacyVersion?: string;
    };
    const update: Record<string, unknown> = {
      displayName,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (existing.acceptedTermsVersion !== WSF_ACCEPTED_TERMS_VERSION) {
      update.acceptedTermsVersion = WSF_ACCEPTED_TERMS_VERSION;
    }
    if (existing.acceptedPrivacyVersion !== WSF_ACCEPTED_PRIVACY_VERSION) {
      update.acceptedPrivacyVersion = WSF_ACCEPTED_PRIVACY_VERSION;
    }
    await ref.update(update);
    return { created: false };
  }
);

type CreateCommunityRequest = {
  displayName?: unknown;
  groupType?: unknown;
  joinPolicy?: unknown;
};

export const wsfCreateCommunity = onCall<CreateCommunityRequest>(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'wsfCreateCommunity requires an authenticated caller.');
    }
    const token = request.auth.token as { email_verified?: boolean };
    if (token.email_verified !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Verify your email before creating a community.'
      );
    }

    const uid = request.auth.uid;

    const rawDisplayName = request.data?.displayName;
    if (typeof rawDisplayName !== 'string') {
      throw new HttpsError('invalid-argument', 'displayName must be a string.');
    }
    const displayName = rawDisplayName.trim();
    if (displayName.length < 2 || displayName.length > 80) {
      throw new HttpsError('invalid-argument', 'displayName must be 2-80 characters.');
    }

    const rawGroupType = request.data?.groupType;
    if (!isGroupType(rawGroupType)) {
      throw new HttpsError(
        'invalid-argument',
        `groupType must be one of: ${GROUP_TYPES.join(', ')}.`
      );
    }
    const groupType: GroupType = rawGroupType;

    const rawJoinPolicy = request.data?.joinPolicy ?? 'private';
    if (!isJoinPolicy(rawJoinPolicy)) {
      throw new HttpsError(
        'invalid-argument',
        `joinPolicy must be one of: ${JOIN_POLICIES.join(', ')}.`
      );
    }
    const joinPolicy: JoinPolicy = rawJoinPolicy;

    const db = getFirestore();
    const profileRef = db.doc(`wsfMemberProfiles/${uid}`);
    const groupRef = db.collection('wsfCommunityGroups').doc();
    const membershipRef = db.doc(`wsfMemberships/${groupRef.id}_${uid}`);

    await db.runTransaction(async (tx) => {
      const profileSnap = await tx.get(profileRef);
      if (!profileSnap.exists) {
        throw new HttpsError(
          'failed-precondition',
          'Complete your profile before creating a community.'
        );
      }
      // Age gate removed 2026-09-06 (Devin, DECISIONS.md). Profile existence is
      // still gated; adultConfirmation is no longer read here.

      tx.set(groupRef, {
        displayName,
        groupType,
        joinPolicy,
        // Every new group ships with a joinCode from day one so the E2 path
        // never has to distinguish "old group without a code" from "new group
        // with one" — the backfill script only has to catch groups minted
        // before this change landed.
        joinCode: mintJoinCode(),
        createdByUserId: uid,
        lifecycleStatus: 'active',
        isSample: false,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      tx.set(membershipRef, {
        groupId: groupRef.id,
        userId: uid,
        role: 'foundingChampion',
        membershipStatus: 'active',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return { groupId: groupRef.id } as const;
  }
);

function isGroupType(v: unknown): v is GroupType {
  return typeof v === 'string' && (GROUP_TYPES as readonly string[]).includes(v);
}

function isJoinPolicy(v: unknown): v is JoinPolicy {
  return typeof v === 'string' && (JOIN_POLICIES as readonly string[]).includes(v);
}

// ─────────────────────────────────────────────────────────────────────────────
// wsfSendVerificationEmail — WSF's own delivery path for verification mail.
//
// Two independent faults made it impossible for a real member to finish signup,
// and each hid the other:
//
//   N-U9   WSF was the only thing in this project relying on Firebase Auth's
//          built-in mail. GoArrive stopped: it has a Resend provider on a
//          verified domain, and its admin flows generate a link and hand it to a
//          human rather than letting Firebase send it. WSF self-signup has no
//          human in the loop, so it inherited an abandoned path. Mail never
//          arrived.
//   N-U11  Even hand-delivered, the link was dead. The project's Auth action URL
//          points at a route that does not exist, and GoArrive's hosting
//          catch-all answers it 200 with an app shell that discards the code
//          silently.
//
// Fixing either alone changes nothing, which is why the first diagnosis felt
// complete and wasn't. This mints the link, repoints it at a handler that works,
// and sends it over a channel that delivers.
//
// SECURITY — the constraints behind every line below:
//   * Sends ONLY to the caller's own address, read from the ID token. Never from
//     the request body: that would make this an open relay and an
//     account-existence oracle.
//   * Never returns the link. A caller who could read it could verify an address
//     they do not own.
//   * Rate limited per uid — any authenticated user can call it, and it spends
//     real money and real sender reputation.
//   * Refuses to run unless configured. It will not invent a sender address; a
//     guessed domain fails DMARC and burns the real domain on the way out.
// ─────────────────────────────────────────────────────────────────────────────

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const SEND_COOLDOWN_MS = 60_000;
const SEND_DAILY_CAP = 10;

/**
 * The Resend key is bound through Secret Manager, not plain function config.
 *
 * A bare `process.env.WSF_EMAIL_API_KEY` would have worked at runtime, and that
 * is precisely the trap: the only ways to populate one are a committed `.env`,
 * a `.env` on whichever laptop happens to deploy, or plaintext function config
 * that the Cloud console renders in full to anyone with project access. This
 * repo has already had one live credential reach a public branch, so the
 * default has to be the safe one rather than the convenient one.
 *
 * `.value()` still resolves through process.env at runtime — Cloud Run mounts
 * the secret there — so the callable tests set the variable exactly as before,
 * and an unbound secret reads as '' and trips the missing-config check below.
 */
const wsfEmailApiKey = defineSecret('WSF_EMAIL_API_KEY');

type SendConfig = {
  apiKey: string;
  from: string;
  appUrl: string;
  actionHandler: string;
};

function readSendConfig(): SendConfig {
  const apiKey = wsfEmailApiKey.value();
  const from = process.env.WSF_EMAIL_FROM;
  const appUrl = process.env.WSF_APP_URL;
  const missing = [
    !apiKey && 'WSF_EMAIL_API_KEY',
    !from && 'WSF_EMAIL_FROM',
    !appUrl && 'WSF_APP_URL',
  ].filter(Boolean);
  if (missing.length) {
    // Shared by wsfSendVerificationEmail and wsfSendPasswordResetEmail. The
    // client screens key on `failed-precondition` to show their honest
    // "not set up yet on this build" copy (verify-email C7, reset-password C3
    // in E3.5 §3C).
    throw new HttpsError(
      'failed-precondition',
      `WSF email sending is not configured: missing ${missing.join(', ')}.`
    );
  }
  return {
    apiKey: apiKey as string,
    from: from as string,
    appUrl: appUrl as string,
    // Defaults to Firebase's own handler, which is always live and is precisely
    // what the project's custom action URL overrode. Override this once a real
    // handler route exists.
    actionHandler:
      process.env.WSF_AUTH_ACTION_HANDLER ??
      `https://${process.env.GCLOUD_PROJECT ?? 'goarrive'}.firebaseapp.com/__/auth/action`,
  };
}

/**
 * Repoints a minted action link at a handler that works, preserving the query
 * string verbatim — the oobCode and apiKey live there and must survive intact.
 */
export function retargetActionLink(link: string, handler: string): string {
  const minted = new URL(link);
  const target = new URL(handler);
  target.search = minted.search;
  return target.toString();
}

/** Cooldown plus daily cap, per uid. Returns ms still to wait, or 0 when clear. */
async function checkSendQuota(uid: string, now: number): Promise<number> {
  const ref = getFirestore().doc(`wsfVerificationSends/${uid}`);
  const snap = await ref.get();
  const data = snap.data() as
    | { lastSentAt?: number; dayStart?: number; countToday?: number }
    | undefined;

  const since = now - (data?.lastSentAt ?? 0);
  if (data?.lastSentAt && since < SEND_COOLDOWN_MS) return SEND_COOLDOWN_MS - since;

  const dayStart = data?.dayStart ?? 0;
  const sameDay = now - dayStart < 24 * 60 * 60 * 1000;
  const countToday = sameDay ? (data?.countToday ?? 0) : 0;
  if (countToday >= SEND_DAILY_CAP) {
    throw new HttpsError(
      'resource-exhausted',
      'Too many verification emails today. Try again tomorrow.'
    );
  }

  await ref.set(
    { lastSentAt: now, dayStart: sameDay ? dayStart : now, countToday: countToday + 1 },
    { merge: true }
  );
  return 0;
}

export const wsfSendVerificationEmail = onCall(
  // Without `secrets`, the value is never mounted and the function refuses to
  // run — the safe failure, but a confusing one. Binding it here is what makes
  // the deployed function able to read the key at all.
  { region: 'us-central1', secrets: [wsfEmailApiKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    // The address comes from the token. Never from the caller.
    const email = request.auth.token.email;
    if (typeof email !== 'string' || !email) {
      throw new HttpsError('failed-precondition', 'This account has no email address.');
    }
    if (request.auth.token.email_verified === true) {
      // Already done — not a condition worth alarming anyone about.
      return { sent: false, reason: 'already-verified' } as const;
    }

    const config = readSendConfig();

    const waitMs = await checkSendQuota(request.auth.uid, Date.now());
    if (waitMs > 0) {
      throw new HttpsError(
        'resource-exhausted',
        `Please wait ${Math.ceil(waitMs / 1000)}s before requesting another email.`
      );
    }

    const minted = await getAuth().generateEmailVerificationLink(email, {
      url: config.appUrl,
      handleCodeInApp: false,
    });
    const link = retargetActionLink(minted, config.actionHandler);

    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: config.from,
        to: [email],
        subject: 'Confirm your email for We Stay Fit',
        text: [
          'Confirm your email address to finish setting up your We Stay Fit account.',
          '',
          link,
          '',
          'If you did not create this account, you can ignore this message.',
        ].join('\n'),
      }),
    });

    if (!res.ok) {
      // The response body can echo the recipient; log the status only.
      console.error('[wsfSendVerificationEmail] provider rejected send', res.status);
      throw new HttpsError('internal', 'Could not send the verification email. Try again shortly.');
    }

    return { sent: true } as const;
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// E2 — Join an existing community by link / QR.
//
// Two callables, one route (client-side): wsfPreviewCommunity (unauthenticated)
// serves the "which community am I about to join?" preview, and
// wsfJoinCommunity (authenticated) creates the membership. Both bypass
// firestore.rules by construction (Admin SDK), which is deliberate: a rules
// change replaces GoArrive's live ruleset too (see docs/westayfit/dispatch/
// E2-JOIN-BY-QR.md §1), so E2 is designed to need ZERO rules changes.
//
// The reads that had to happen: a visitor cannot read wsfCommunityGroups
// directly (rule requires membership), and we do not weaken that rule. Instead
// the callables read on the visitor's behalf and return a strictly-shaped
// projection — never the raw doc, never the groupId on the preview path.
//
// The two properties this design must preserve:
//   * Not an existence oracle. Unknown code and non-public group must return
//     byte-identical not-found. See PREVIEW_NOT_FOUND / JOIN_NOT_FOUND.
//   * Idempotent join. The membership doc ID is deterministic
//     (`${groupId}_${uid}`) so a double-tap, a back-button re-submit, or a
//     network retry produces exactly one row and no error.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * §5 open decision: does joining require a verified email?
 *
 * Default TRUE (safe, consistent with wsfCreateCommunity, protects the aggregate
 * counter from throwaway signups). Flipping to false trades the booth funnel
 * for that safety — the decision is Devin's. The guard is exactly one line so
 * that answer is one line, per §5.
 */
const JOIN_REQUIRES_EMAIL_VERIFIED = true;

function assertJoinEmailVerified(token: { email_verified?: boolean }): void {
  if (JOIN_REQUIRES_EMAIL_VERIFIED && token.email_verified !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Verify your email before joining a community.'
    );
  }
}

/**
 * A single generic not-found shape shared by preview and join. Same code, same
 * message. Asserted byte-identical by the callable suite because it is the
 * property most likely to erode silently under a helpful-error refactor.
 */
const NOT_FOUND_MESSAGE = 'This link is not valid.';
function notFound(): never {
  throw new HttpsError('not-found', NOT_FOUND_MESSAGE);
}

// Coarse per-IP bucket for wsfPreviewCommunity. It is unauthenticated by design
// (visitors have not signed up yet), so the callable is enumerable-by-attempt.
// The join code space is 128-bit CSPRNG so brute force is not the concern; the
// rate limit exists to keep the endpoint from being a cheap DoS or Firestore
// cost pump.
//
// 100 requests / rolling minute per IP hash. The IP hash is salted with the
// current UTC day so buckets rotate daily and no long-lived per-visitor
// identifier lives in Firestore.
const PREVIEW_RATE_LIMIT_WINDOW_MS = 60_000;
const PREVIEW_RATE_LIMIT_MAX = 100;

function hashIpForBucket(ip: string, now: number): string {
  const daySalt = Math.floor(now / (24 * 60 * 60 * 1000)).toString();
  return createHash('sha256').update(`${ip}:${daySalt}`).digest('hex').slice(0, 16);
}

function extractIp(rawRequest: { ip?: string; headers?: Record<string, unknown> }): string {
  // Rightmost XFF entry, not leftmost: Cloud Run's front-end appends the
  // real client last, and every hop before it is caller-supplied and
  // spoofable. Reading the left entry gives the attacker a knob to rotate
  // buckets by lying about the header — the exact bypass this exists to
  // prevent.
  //
  // If these callables are ever routed through Hosting rewrites, the
  // rightmost entry becomes the Firebase CDN and this must change: at that
  // point the real client is second-from-right and the CDN entry must be
  // stripped first.
  const header = rawRequest?.headers?.['x-forwarded-for'];
  let raw: string | null = null;
  if (typeof header === 'string') {
    raw = header;
  } else if (Array.isArray(header)) {
    raw = header.filter((v) => typeof v === 'string').join(',');
  }
  if (raw && raw.length > 0) {
    const parts = raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    if (parts.length > 0) return parts[parts.length - 1]!;
  }
  return rawRequest?.ip ?? 'unknown';
}

async function enforcePreviewRateLimit(ip: string, now: number): Promise<void> {
  const hash = hashIpForBucket(ip, now);
  const db = getFirestore();
  const ref = db.doc(`wsfPreviewRateLimits/${hash}`);
  // Transaction + FieldValue.increment gives an atomic read-modify-write.
  // The old shape read the doc, computed nextCount, and wrote — under a
  // parallel burst two callers would both read the same count and both
  // write the same nextCount, under-counting the bucket by up to the
  // concurrency factor. That is precisely the case the limiter is here to
  // catch, so the limiter itself must not race. A transaction retries on
  // contention; increment resolves as a CRDT commit.
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() as { windowStart?: number; count?: number } | undefined;
    const windowStart = data?.windowStart ?? 0;
    const inWindow = snap.exists && now - windowStart < PREVIEW_RATE_LIMIT_WINDOW_MS;
    if (inWindow) {
      const nextCount = (data?.count ?? 0) + 1;
      if (nextCount > PREVIEW_RATE_LIMIT_MAX) {
        // Distinct code from not-found so hitting the limit does not signal
        // "the code was valid" — it signals nothing about codes at all.
        throw new HttpsError('resource-exhausted', 'Too many requests. Try again shortly.');
      }
      tx.update(ref, { count: FieldValue.increment(1) });
    } else {
      // Window rolled (or first hit): reset windowStart and count in a
      // single write so the next reader sees a coherent window.
      tx.set(ref, { windowStart: now, count: 1 });
    }
  });
}

type PreviewRequest = { joinCode?: unknown };
type PreviewResponse = {
  displayName: string;
  groupType: GroupType;
  memberCount: number;
};

export const wsfPreviewCommunity = onCall<PreviewRequest>(
  // invoker: 'public' grants run.invoker to allUsers at deploy so the client
  // can call this while signed out. No-op in the emulator — the setting is
  // enforced by Cloud Run's IAM, not by the callable framework itself.
  { region: 'us-central1', invoker: 'public' },
  async (request): Promise<PreviewResponse> => {
    const ip = extractIp(request.rawRequest as any);
    // Rate-limit fires FIRST, before any code lookup, so a limited caller
    // cannot learn anything about the code space by comparing responses.
    await enforcePreviewRateLimit(ip, Date.now());

    const joinCode = normalizeJoinCode(request.data?.joinCode);
    if (!joinCode) notFound();

    const db = getFirestore();
    const groupsSnap = await db
      .collection('wsfCommunityGroups')
      .where('joinCode', '==', joinCode)
      .limit(1)
      .get();
    if (groupsSnap.empty) notFound();

    const groupDoc = groupsSnap.docs[0]!;
    const group = groupDoc.data() as {
      displayName: string;
      groupType: GroupType;
      joinPolicy: JoinPolicy;
      lifecycleStatus: string;
    };
    // Only 'public' groups on 'active' lifecycle preview. Anything else must
    // return the same not-found as an unknown code — this is the oracle test.
    if (group.joinPolicy !== 'public' || group.lifecycleStatus !== 'active') {
      notFound();
    }

    // Aggregate count: cheaper than reading every membership doc and does not
    // require a composite index for a single equality filter. Only counts
    // active memberships so soft-removed rows (a future concern) never inflate
    // the "how big is this community?" preview.
    const countSnap = await db
      .collection('wsfMemberships')
      .where('groupId', '==', groupDoc.id)
      .where('membershipStatus', '==', 'active')
      .count()
      .get();

    return {
      displayName: group.displayName,
      groupType: group.groupType,
      memberCount: countSnap.data().count,
    };
  }
);

type JoinRequest = { joinCode?: unknown };
type JoinResponse = { groupId: string; alreadyMember: boolean };

export const wsfJoinCommunity = onCall<JoinRequest>(
  { region: 'us-central1' },
  async (request): Promise<JoinResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    assertJoinEmailVerified(request.auth.token as { email_verified?: boolean });

    const uid = request.auth.uid;
    const joinCode = normalizeJoinCode(request.data?.joinCode);
    if (!joinCode) notFound();

    const db = getFirestore();
    const profileRef = db.doc(`wsfMemberProfiles/${uid}`);
    const groupsQuery = db
      .collection('wsfCommunityGroups')
      .where('joinCode', '==', joinCode)
      .limit(1);

    return await db.runTransaction(async (tx) => {
      // All reads first (Firestore txn rule).
      const [profileSnap, groupsSnap] = await Promise.all([
        tx.get(profileRef),
        tx.get(groupsQuery),
      ]);

      if (!profileSnap.exists) {
        throw new HttpsError(
          'failed-precondition',
          'Complete your profile before joining a community.'
        );
      }
      // Age gate removed 2026-09-06 (Devin, DECISIONS.md). Profile existence is
      // still gated; adultConfirmation is no longer read here.

      if (groupsSnap.empty) notFound();
      const groupDoc = groupsSnap.docs[0]!;
      const group = groupDoc.data() as { joinPolicy: JoinPolicy; lifecycleStatus: string };

      const membershipRef = db.doc(`wsfMemberships/${groupDoc.id}_${uid}`);
      const membershipSnap = await tx.get(membershipRef);

      // Existing members are grandfathered: a returning tap resolves even if
      // the group has since flipped away from 'public' or gone inactive. The
      // rule is "new joins require public+active", not "existing members lose
      // access when the champion flips a setting."
      if (membershipSnap.exists) {
        return { groupId: groupDoc.id, alreadyMember: true };
      }

      if (group.joinPolicy !== 'public' || group.lifecycleStatus !== 'active') {
        notFound();
      }

      // Membership shape matches wsfCreateCommunity's exactly (see §2). Role
      // is 'member' rather than 'foundingChampion' — a joiner is not the
      // creator.
      tx.set(membershipRef, {
        groupId: groupDoc.id,
        userId: uid,
        role: 'member',
        membershipStatus: 'active',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { groupId: groupDoc.id, alreadyMember: false };
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// E3 — Challenges, moves, and check-ins.
//
// The failure mode this file has to survive is one moment, not the average
// day: the emcee at FitLife says "everyone do this now," and roughly a hundred
// people tap within thirty seconds. A single `wsfChallenges/{id}.completedCount`
// increment is one Firestore document — sustainable at ~1 write/second, which
// is precisely below the burst floor. Writes contend, retry, fail, and the
// counter — the most-watched object in the room — stalls.
//
// So the counter is a 10-way sharded aggregate under
// `wsfChallengeCounters/{challengeId}/shards/{0..9}`. Each check-in picks a
// shard uniformly at random and increments it with FieldValue.increment(1);
// any read sums the ten. Ten shards buys ~10 writes/second headroom,
// comfortably past what a five-hour event can produce.
//
// Two invariants the acceptance criteria assert directly (§5.3, §5.5):
//
//   * Idempotency is free from the deterministic doc ID
//     `wsfCheckIns/{moveId}_{membershipId}`. The transaction reads that doc
//     first; if it exists, we return `alreadyCheckedIn: true` and touch
//     nothing — never an error. A double-tap, a network retry, or a
//     back-button re-submit produces exactly one row and exactly one increment.
//
//   * Concurrency is real: the burst test drives 50 members hitting the same
//     move via Promise.all. Distinct check-in doc IDs (no write contention)
//     plus random shard selection (average contention ~5 per shard, resolved
//     by FieldValue.increment's CRDT-like commit) produces a total of exactly
//     50 with no lost updates.
//
// Everything else follows E2's ground rules: callables only (Admin SDK
// bypasses rules, so `git diff -- firestore.rules` is empty — §5.9), no
// hardcoded goal (`goalTarget` is nullable and admin-set), no member identity
// under any pulse input (§5.7), sample groups excluded from real totals
// (§5.8), no leaderboard, no body data.
//
// `minInstances: 1` on wsfCheckIn is intentional. A cold start between
// someone's tap and their number moving is the one latency that matters at
// the event.
// ─────────────────────────────────────────────────────────────────────────────

const CHALLENGE_SHARD_COUNT = 10;

// wsfChallengePulse in-process cache. The kiosk polls at ~2 s and each miss
// pays 13 doc reads (challenge + group + 10 shards + 1 participant aggregate)
// on a public callable. Devin's own spec: "the kiosk polling 2 s stale is
// fine." Cache TTL matches — the freshest a poll can be is the poll cadence,
// so nothing legitimate loses precision, and a burst of bot traffic collapses
// to one real read per challengeId per 2 s per instance.
//
// Per-instance, not global. Cloud Run may scale to N instances, so worst
// case is N reads / 2 s / challenge, still enough compression to matter.
// Cache stores only successful totals; not-found and rate-limited paths bypass
// it so an attacker cannot use a cache hit as an existence oracle.
const PULSE_CACHE_TTL_MS = 2_000;
const PULSE_CACHE_MAX = 1_000;
const pulseCache = new Map<string, { ts: number; value: PulseTotals }>();

function pulseCacheGet(challengeId: string, now: number): PulseTotals | null {
  const hit = pulseCache.get(challengeId);
  if (!hit) return null;
  if (now - hit.ts >= PULSE_CACHE_TTL_MS) {
    pulseCache.delete(challengeId);
    return null;
  }
  return hit.value;
}

function pulseCacheSet(challengeId: string, now: number, value: PulseTotals): void {
  if (pulseCache.size >= PULSE_CACHE_MAX && !pulseCache.has(challengeId)) {
    // Drop the oldest insertion. Map iteration is insertion-ordered, so the
    // first key is the LRU-in-effect for a strict TTL cache.
    const oldest = pulseCache.keys().next().value;
    if (oldest !== undefined) pulseCache.delete(oldest);
  }
  pulseCache.set(challengeId, { ts: now, value });
}

type ChallengeStatus = 'draft' | 'active' | 'completed';

type ChallengeDoc = {
  groupId: string;
  title: string;
  status: ChallengeStatus;
  goalTarget: number | null;
  startsAt?: FirebaseFirestore.Timestamp;
  endsAt?: FirebaseFirestore.Timestamp;
};

type MoveDoc = {
  challengeId: string;
  title: string;
  instructions?: string;
  sequence: number;
  dayNumber: number | null;
  locationLabel?: string;
  requiresCode?: boolean;
  // Present only on moves whose admin set requiresCode:true. Never returned
  // by wsfListChallenge (see the response whitelist), only read server-side
  // by wsfCheckIn to compare against the caller's `code`.
  checkInCode?: string;
};

type PulseTotals = {
  participantCount: number;
  completedCount: number;
  goalTarget: number | null;
};

function randomShardIndex(): number {
  return Math.floor(Math.random() * CHALLENGE_SHARD_COUNT);
}

function shardRef(challengeId: string, index: number) {
  return getFirestore().doc(
    `wsfChallengeCounters/${challengeId}/shards/${index}`
  );
}

/**
 * Sums the ten completed-count shards for a challenge. Missing shard docs
 * count as zero — the seed script does not need to pre-write empty shards,
 * and a challenge with zero check-ins reads as zero without special-casing.
 *
 * `db.getAll(...refs)` batches all ten reads into one RPC. The prior shape
 * (ten `.get()`s in Promise.all) still paid ten roundtrips, and after a
 * successful check-in the response was blocked on the slowest of those ten —
 * the tap-to-total latency that matters at the event.
 */
async function sumCompletedShards(challengeId: string): Promise<number> {
  const db = getFirestore();
  const refs: FirebaseFirestore.DocumentReference[] = [];
  for (let i = 0; i < CHALLENGE_SHARD_COUNT; i++) {
    refs.push(db.doc(`wsfChallengeCounters/${challengeId}/shards/${i}`));
  }
  const snaps = await db.getAll(...refs);
  let total = 0;
  for (const snap of snaps) {
    const data = snap.data() as { count?: number } | undefined;
    if (typeof data?.count === 'number') total += data.count;
  }
  return total;
}

/**
 * Counts distinct members who have ever checked in on this challenge, via
 * `wsfChallengeParticipants/{challengeId}_{membershipId}` marker docs. First
 * check-in for a member atomically writes the marker inside the same txn as
 * the check-in itself, so the count converges without a distinct query.
 */
async function countParticipants(challengeId: string): Promise<number> {
  const snap = await getFirestore()
    .collection('wsfChallengeParticipants')
    .where('challengeId', '==', challengeId)
    .count()
    .get();
  return snap.data().count;
}

async function readChallengeTotals(
  challengeId: string,
  goalTarget: number | null
): Promise<PulseTotals> {
  const [completedCount, participantCount] = await Promise.all([
    sumCompletedShards(challengeId),
    countParticipants(challengeId),
  ]);
  return { participantCount, completedCount, goalTarget };
}

// Doc-id shape check. Firestore accepts almost anything in a document ID, and
// that permissiveness reached the public endpoints as `internal` — a raw
// `/` in the value made `db.doc(...)` throw a TypeError under the callable
// wrapper, and the wrapper had nothing to translate it to. The goal is only
// "no `/`, bounded length", not a length floor: hand-made FitLife ids like
// `fitlife-2026` need to pass on event day, and a well-formed unknown id is
// `not-found` at the doc read, not `invalid-argument` at the boundary.
function normalizeStringId(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(trimmed)) return null;
  return trimmed;
}

type ListChallengeRequest = { groupId?: unknown };
type ListedMove = {
  id: string;
  title: string;
  instructions: string;
  sequence: number;
  dayNumber: number | null;
  locationLabel: string | null;
  requiresCode: boolean;
};
type ListChallengeResponse = {
  challenge:
    | {
        id: string;
        title: string;
        status: ChallengeStatus;
        goalTarget: number | null;
      }
    | null;
  moves: ListedMove[];
  myCheckedInMoveIds: string[];
  totals: PulseTotals;
};

export const wsfListChallenge = onCall<ListChallengeRequest>(
  { region: 'us-central1' },
  async (request): Promise<ListChallengeResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    const uid = request.auth.uid;
    const groupId = normalizeStringId(request.data?.groupId);
    if (!groupId) {
      throw new HttpsError('invalid-argument', 'groupId is required.');
    }

    const db = getFirestore();
    const membershipId = `${groupId}_${uid}`;
    const membershipRef = db.doc(`wsfMemberships/${membershipId}`);
    const membershipSnap = await membershipRef.get();
    // Non-members are refused with permission-denied, not not-found. This is
    // an authenticated endpoint scoped to a groupId the caller supplied — the
    // fact that a group with that id exists is not what we are guarding here.
    if (!membershipSnap.exists) {
      throw new HttpsError('permission-denied', 'Members only.');
    }
    const membership = membershipSnap.data() as { membershipStatus?: string };
    if (membership.membershipStatus !== 'active') {
      throw new HttpsError('permission-denied', 'Members only.');
    }

    const challengesSnap = await db
      .collection('wsfChallenges')
      .where('groupId', '==', groupId)
      .where('status', '==', 'active')
      .limit(1)
      .get();
    if (challengesSnap.empty) {
      return {
        challenge: null,
        moves: [],
        myCheckedInMoveIds: [],
        totals: { participantCount: 0, completedCount: 0, goalTarget: null },
      };
    }
    const challengeDoc = challengesSnap.docs[0]!;
    const challenge = challengeDoc.data() as ChallengeDoc;

    const [movesSnap, totals] = await Promise.all([
      db
        .collection('wsfChallengeMoves')
        .where('challengeId', '==', challengeDoc.id)
        .get(),
      readChallengeTotals(challengeDoc.id, challenge.goalTarget ?? null),
    ]);

    const moves: ListedMove[] = movesSnap.docs
      .map((doc) => {
        const data = doc.data() as MoveDoc;
        return {
          id: doc.id,
          title: data.title,
          instructions: data.instructions ?? '',
          sequence: data.sequence,
          dayNumber: data.dayNumber ?? null,
          locationLabel: data.locationLabel ?? null,
          requiresCode: data.requiresCode === true,
        };
      })
      .sort((a, b) => a.sequence - b.sequence);

    // One batched read against the caller's own check-in docs, keyed on the
    // canonical id `wsfCheckIns/{moveId}_{membershipId}`. `db.getAll` on
    // known paths sidesteps the composite index a `where` query would need,
    // and — because the paths embed the caller's membershipId — it can never
    // return anyone else's check-in.
    const myCheckedInMoveIds: string[] = [];
    if (moves.length > 0) {
      const checkInRefs = moves.map((m) =>
        db.doc(`wsfCheckIns/${m.id}_${membershipId}`)
      );
      const checkInSnaps = await db.getAll(...checkInRefs);
      for (let i = 0; i < checkInSnaps.length; i++) {
        if (checkInSnaps[i]!.exists) {
          myCheckedInMoveIds.push(moves[i]!.id);
        }
      }
    }

    return {
      challenge: {
        id: challengeDoc.id,
        title: challenge.title,
        status: challenge.status,
        goalTarget: challenge.goalTarget ?? null,
      },
      moves,
      myCheckedInMoveIds,
      totals,
    };
  }
);

type CheckInRequest = { moveId?: unknown; code?: unknown };
type CheckInResponse = {
  alreadyCheckedIn: boolean;
  totals: PulseTotals;
};

function normalizeCheckInCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return null;
  return trimmed;
}

export const wsfCheckIn = onCall<CheckInRequest>(
  // minInstances:1 — see the E3 header. A cold start on this callable is the
  // one visible latency at the event. Everything else can pay a cold start.
  { region: 'us-central1', minInstances: 1 },
  async (request): Promise<CheckInResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    const uid = request.auth.uid;
    const moveId = normalizeStringId(request.data?.moveId);
    if (!moveId) {
      throw new HttpsError('invalid-argument', 'moveId is required.');
    }

    const db = getFirestore();
    const moveRef = db.doc(`wsfChallengeMoves/${moveId}`);
    const moveSnap = await moveRef.get();
    if (!moveSnap.exists) {
      throw new HttpsError('not-found', 'Move not found.');
    }
    const move = moveSnap.data() as MoveDoc;

    const challengeRef = db.doc(`wsfChallenges/${move.challengeId}`);

    // §E3 review fix 3 — challenge.status and membership are read inside the
    // transaction so a status flip from `active` to `completed` between an
    // emcee's "we're done" and a straggler's tap is caught atomically. The
    // txn does a two-phase read because membership + check-in doc paths both
    // key on the challenge's groupId (a challenge can, in principle, be
    // reassigned; membership follows the current group). Sequential tx.get()s
    // are legal — the "all reads before writes" rule stops at the first write.
    // Order inside the callback matters:
    //   1. Read challenge to learn groupId. Not-found fails fast.
    //   2. Read [existingCheckIn, existingParticipant, membership] with the
    //      derived paths.
    //   3. If check-in already exists, return alreadyCheckedIn:true regardless
    //      of the challenge's current status — spec §5.3 idempotency wins
    //      even against a completed challenge, so a retry from a member who
    //      already succeeded never surfaces as an error.
    //   4. NOW enforce requiresCode. Ordered AFTER the idempotent return so a
    //      member who already succeeded can never be told `failed-precondition`
    //      on a retry, whatever they send as `code` (spec §5.3 "never an
    //      error"). Under the old order the code gate lived before the txn
    //      and rejected an existing-member retry that sent a wrong or absent
    //      code — the same tap that succeeded once would fail on the retry.
    //   5. Otherwise validate status active + membership active, then write.
    const { alreadyCheckedIn, goalTarget } = await db.runTransaction(
      async (tx) => {
        const challengeSnap = await tx.get(challengeRef);
        if (!challengeSnap.exists) {
          throw new HttpsError('not-found', 'Challenge not found.');
        }
        const challenge = challengeSnap.data() as ChallengeDoc;
        const gt = challenge.goalTarget ?? null;

        const membershipId = `${challenge.groupId}_${uid}`;
        const membershipRef = db.doc(`wsfMemberships/${membershipId}`);
        const checkInRef = db.doc(`wsfCheckIns/${moveId}_${membershipId}`);
        const participantRef = db.doc(
          `wsfChallengeParticipants/${move.challengeId}_${membershipId}`
        );

        const [existingCheckIn, existingParticipant, membershipSnap] =
          await Promise.all([
            tx.get(checkInRef),
            tx.get(participantRef),
            tx.get(membershipRef),
          ]);

        if (existingCheckIn.exists) {
          // Idempotent path — spec §5.3. Touch nothing, never throw, and
          // never re-gate on challenge.status, membership state, or the
          // paired code. A member who already succeeded is grandfathered
          // against any change that happened after their first tap.
          return { alreadyCheckedIn: true as const, goalTarget: gt };
        }

        // §E3 review fix 2 — requiresCode is real. Honour system is still
        // the default (requiresCode undefined/false), but the moment an
        // admin flips a move to requiresCode:true the callable enforces the
        // paired secret. Same vocabulary as "this challenge is not active"
        // so the client can render a single "can't check in" state without
        // leaking whether the code was absent or wrong.
        if (move.requiresCode === true) {
          const providedCode = normalizeCheckInCode(request.data?.code);
          const expectedCode =
            typeof move.checkInCode === 'string' ? move.checkInCode.trim() : '';
          if (expectedCode.length === 0 || providedCode !== expectedCode) {
            throw new HttpsError(
              'failed-precondition',
              'This move requires a check-in code.'
            );
          }
        }

        if (challenge.status !== 'active') {
          throw new HttpsError(
            'failed-precondition',
            'This challenge is not active.'
          );
        }

        if (!membershipSnap.exists) {
          throw new HttpsError('permission-denied', 'Members only.');
        }
        const membership = membershipSnap.data() as { membershipStatus?: string };
        if (membership.membershipStatus !== 'active') {
          throw new HttpsError('permission-denied', 'Members only.');
        }

        const shardIndex = randomShardIndex();
        const shard = shardRef(move.challengeId, shardIndex);

        tx.set(checkInRef, {
          challengeId: move.challengeId,
          moveId,
          membershipId,
          userId: uid,
          groupId: challenge.groupId,
          shardIndex,
          createdAt: FieldValue.serverTimestamp(),
        });
        tx.set(
          shard,
          { count: FieldValue.increment(1) },
          { merge: true }
        );
        if (!existingParticipant.exists) {
          tx.set(participantRef, {
            challengeId: move.challengeId,
            membershipId,
            userId: uid,
            groupId: challenge.groupId,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
        return { alreadyCheckedIn: false as const, goalTarget: gt };
      }
    );

    const totals = await readChallengeTotals(move.challengeId, goalTarget);
    return { alreadyCheckedIn, totals };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// wsfMyCommunities — the signed-in home reads this to render "Your communities".
//
// Authenticated, no rules change: reads wsfMemberships where userId == caller
// with the Admin SDK, then loads each group and (if any) its active challenge.
// firestore.rules already permits the caller to read their own memberships and
// the groups they belong to, but a single callable is faster (one round trip
// from the client's perspective) and keeps the aggregate totals off the
// client — the response carries no member identity, only per-group and
// per-challenge aggregates.
//
// isSample groups are NOT filtered out — a member of a sample group still sees
// it in their list, but the item is marked `isSample: true` so the UI can badge
// it "Sample" and never count it into any pooled aggregate.
// ─────────────────────────────────────────────────────────────────────────────

type MyCommunityItem = {
  groupId: string;
  displayName: string;
  groupType: GroupType;
  joinPolicy: JoinPolicy;
  role: string;
  memberCount: number;
  isSample: boolean;
  activeChallenge: {
    id: string;
    title: string;
    participantCount: number;
    completedCount: number;
    goalTarget: number | null;
  } | null;
};

type MyCommunitiesResponse = { items: MyCommunityItem[] };

export const wsfMyCommunities = onCall(
  { region: 'us-central1' },
  async (request): Promise<MyCommunitiesResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    const uid = request.auth.uid;
    const db = getFirestore();

    const membershipsSnap = await db
      .collection('wsfMemberships')
      .where('userId', '==', uid)
      .where('membershipStatus', '==', 'active')
      .get();

    if (membershipsSnap.empty) return { items: [] };

    const items = await Promise.all(
      membershipsSnap.docs.map(async (membershipDoc) => {
        const membership = membershipDoc.data() as {
          groupId: string;
          role: string;
        };
        const groupSnap = await db
          .doc(`wsfCommunityGroups/${membership.groupId}`)
          .get();
        if (!groupSnap.exists) return null;
        const group = groupSnap.data() as {
          displayName: string;
          groupType: GroupType;
          joinPolicy: JoinPolicy;
          isSample?: boolean;
        };

        const [memberCountSnap, activeChallengeSnap] = await Promise.all([
          db
            .collection('wsfMemberships')
            .where('groupId', '==', membership.groupId)
            .where('membershipStatus', '==', 'active')
            .count()
            .get(),
          db
            .collection('wsfChallenges')
            .where('groupId', '==', membership.groupId)
            .where('status', '==', 'active')
            .limit(1)
            .get(),
        ]);

        let activeChallenge: MyCommunityItem['activeChallenge'] = null;
        if (!activeChallengeSnap.empty) {
          const challengeDoc = activeChallengeSnap.docs[0]!;
          const challenge = challengeDoc.data() as ChallengeDoc;
          const totals = await readChallengeTotals(
            challengeDoc.id,
            challenge.goalTarget ?? null
          );
          activeChallenge = {
            id: challengeDoc.id,
            title: challenge.title,
            participantCount: totals.participantCount,
            completedCount: totals.completedCount,
            goalTarget: totals.goalTarget,
          };
        }

        const item: MyCommunityItem = {
          groupId: membership.groupId,
          displayName: group.displayName,
          groupType: group.groupType,
          joinPolicy: group.joinPolicy,
          role: membership.role,
          memberCount: memberCountSnap.data().count,
          isSample: group.isSample === true,
          activeChallenge,
        };
        return item;
      })
    );

    const filtered = items.filter((i): i is MyCommunityItem => i !== null);
    filtered.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return { items: filtered };
  }
);

type PulseRequest = { challengeId?: unknown };
type PulseResponse = PulseTotals;

export const wsfChallengePulse = onCall<PulseRequest>(
  // Public: the kiosk display is unauthenticated. Spec §5.7 forbids member
  // identity in the response under any input, and readChallengeTotals returns
  // only aggregates — no docs, no ids, no names. Sample-flagged groups are
  // hidden entirely (§5.8) so a curator-facing seed cannot leak into a real
  // display via a copied challengeId.
  //
  // Two throttles guard the endpoint (§ E3 review, cache-first): the
  // per-challengeId in-process cache is checked BEFORE the IP limiter — a
  // cache hit is already-public aggregate data, costs zero Firestore reads,
  // and must not count against anyone's bucket or the same emcee-facing
  // kiosk poll would burn its own quota. Only genuine cache misses fall
  // through to the per-IP bucket wsfPreviewCommunity uses (100 req / rolling
  // minute per IP hash), which then guards the Firestore read path.
  { region: 'us-central1', invoker: 'public' },
  async (request): Promise<PulseResponse> => {
    const now = Date.now();

    const challengeId = normalizeStringId(request.data?.challengeId);
    if (!challengeId) {
      throw new HttpsError('invalid-argument', 'challengeId is required.');
    }

    // Cache first — hits return public-safe totals with no Firestore reads
    // and no limiter bump. Misses fall through to the limiter and reads.
    const cached = pulseCacheGet(challengeId, now);
    if (cached) return cached;

    const ip = extractIp(request.rawRequest as any);
    await enforcePreviewRateLimit(ip, now);

    const db = getFirestore();
    const challengeSnap = await db.doc(`wsfChallenges/${challengeId}`).get();
    if (!challengeSnap.exists) {
      throw new HttpsError('not-found', 'Challenge not found.');
    }
    const challenge = challengeSnap.data() as ChallengeDoc;

    const groupSnap = await db
      .doc(`wsfCommunityGroups/${challenge.groupId}`)
      .get();
    if (!groupSnap.exists) {
      throw new HttpsError('not-found', 'Challenge not found.');
    }
    const group = groupSnap.data() as { isSample?: boolean };
    if (group.isSample === true) {
      // §5.8 — sample data must never surface in a total presented as real.
      throw new HttpsError('not-found', 'Challenge not found.');
    }

    const totals = await readChallengeTotals(challengeId, challenge.goalTarget ?? null);
    pulseCacheSet(challengeId, now, totals);
    return totals;
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// wsfSendPasswordResetEmail — self-service password reset for a signed-out
// visitor. Devin's returning sign-in stopped at "email and password do not
// match" with no way out (E3.5 §3C F12), and enumeration protection is the
// entire reason this callable exists rather than surfacing Firebase Auth's
// built-in reset. The screen never learns whether the address is on file.
//
// SECURITY — the constraints behind every line below:
//   * Unauthenticated by design: a visitor who has forgotten their password
//     cannot sign in first. Public invoker at deploy time.
//   * Never reveals whether an account exists. Unknown email, malformed
//     email, and successful send all return the same `{ accepted: true }`.
//     No log line names the address either — a shared error log would
//     otherwise become a signup list.
//   * Per-EMAIL quota (sha256-hashed key). Same cooldown + daily cap as
//     wsfSendVerificationEmail's per-uid quota, but since there is no uid
//     the recipient itself has to be the key. The write happens before the
//     unknown-email check on purpose: conditioning it on account existence
//     would leak that fact via a Firestore write pattern.
//   * Same Resend config path as verification. Refuses to run unconfigured
//     with `failed-precondition` so the screen can render the honest
//     "not set up yet on this build" copy.
// ─────────────────────────────────────────────────────────────────────────────

async function checkResetQuota(emailKey: string, now: number): Promise<number> {
  const ref = getFirestore().doc(`wsfPasswordResetSends/${emailKey}`);
  const snap = await ref.get();
  const data = snap.data() as
    | { lastSentAt?: number; dayStart?: number; countToday?: number }
    | undefined;

  const since = now - (data?.lastSentAt ?? 0);
  if (data?.lastSentAt && since < SEND_COOLDOWN_MS) return SEND_COOLDOWN_MS - since;

  const dayStart = data?.dayStart ?? 0;
  const sameDay = now - dayStart < 24 * 60 * 60 * 1000;
  const countToday = sameDay ? (data?.countToday ?? 0) : 0;
  if (countToday >= SEND_DAILY_CAP) {
    throw new HttpsError(
      'resource-exhausted',
      'Too many password reset requests today. Try again tomorrow.'
    );
  }

  await ref.set(
    { lastSentAt: now, dayStart: sameDay ? dayStart : now, countToday: countToday + 1 },
    { merge: true }
  );
  return 0;
}

function normalizeResetEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim().toLowerCase();
  // Not RFC 5322 — just a cheap shape check so obvious garbage is rejected
  // before we hash it or hand it to the Admin SDK. The Admin SDK will refuse
  // truly malformed addresses; anything it accepts, we accept.
  if (trimmed.length < 3 || trimmed.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

function hashEmailForQuota(email: string): string {
  return createHash('sha256').update(email).digest('hex').slice(0, 32);
}

type SendPasswordResetRequest = { email?: unknown };
type SendPasswordResetResponse = { accepted: true };

export const wsfSendPasswordResetEmail = onCall<SendPasswordResetRequest>(
  // invoker: 'public' — the caller is signed out by definition. Same shape
  // as wsfPreviewCommunity. secrets: [wsfEmailApiKey] — Cloud Run mounts the
  // Resend key at process.env for `.value()` to read.
  { region: 'us-central1', secrets: [wsfEmailApiKey], invoker: 'public' },
  async (request): Promise<SendPasswordResetResponse> => {
    const email = normalizeResetEmail(request.data?.email);
    if (!email) {
      throw new HttpsError('invalid-argument', 'email is required.');
    }

    // Config first, quota second — same order as verification, so a missing
    // secret surfaces as failed-precondition before any Firestore write.
    const config = readSendConfig();

    const emailKey = hashEmailForQuota(email);
    const waitMs = await checkResetQuota(emailKey, Date.now());
    if (waitMs > 0) {
      throw new HttpsError(
        'resource-exhausted',
        `Please wait ${Math.ceil(waitMs / 1000)}s before requesting another reset.`
      );
    }

    let minted: string;
    try {
      minted = await getAuth().generatePasswordResetLink(email, {
        url: config.appUrl,
      });
    } catch (e) {
      const code =
        typeof e === 'object' && e && 'code' in e
          ? String((e as { code?: unknown }).code ?? '')
          : '';
      // Unknown email is the whole enumeration case: return the SAME success
      // shape the happy path returns. auth/invalid-email is folded in for the
      // same reason — the client shouldn't be able to distinguish "you typed
      // it wrong" from "not on file".
      if (
        code === 'auth/user-not-found' ||
        code === 'auth/email-not-found' ||
        code === 'auth/invalid-email'
      ) {
        return { accepted: true };
      }
      // Anything else is a real fault. Log the code only, never the address.
      console.error('[wsfSendPasswordResetEmail] Admin SDK failed', code || 'unknown');
      throw new HttpsError('internal', 'Could not send the reset email. Try again shortly.');
    }

    const link = retargetActionLink(minted, config.actionHandler);

    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: config.from,
        to: [email],
        subject: 'Reset your We Stay Fit password',
        text: [
          'Someone asked to reset the password for your We Stay Fit account.',
          '',
          'Open this link to choose a new password. The link expires in an hour.',
          '',
          link,
          '',
          'If you did not ask for a reset, you can ignore this message.',
        ].join('\n'),
      }),
    });

    if (!res.ok) {
      // The provider response body can echo the recipient; log the status only.
      console.error('[wsfSendPasswordResetEmail] provider rejected send', res.status);
      throw new HttpsError('internal', 'Could not send the reset email. Try again shortly.');
    }

    return { accepted: true };
  }
);

// ═════════════════════════════════════════════════════════════════════════════
// E4-A1 — Goals + Contributions (quantitative shared totals).
//
// Where E3 counted unique members × moves (binary check-in), E4 counts a
// running quantity: "we did 3,720 squats together." A member contributes N
// units per attempt; the same attemptId retried counts once; the aggregate
// reflects the sum.
//
// Invariants pinned by acceptance:
//   * 3700+20=3720. FieldValue.increment(count) on a random shard.
//   * concurrent +30/+20 -> +50 shared, +30 own for the +30 contributor
//     (concurrency-safe via 10-way sharded counter + per-member totals doc).
//   * double-submit counts once — idempotency on
//     wsfContributions/{goalId}_{userId}_{attemptId} inside a transaction.
//     The key is scoped by the authenticated uid (E4-A1-R4), so two members
//     who independently pick the same attemptId each count exactly once and
//     a replay can never surface another member's count.
//   * 4999/5000 != 100%. All math is integer; percent uses (n*100)/target
//     floor semantics on the display, never a float round-trip.
//   * 4980+35=5015. Overshoot preserved: aggregate is unclamped; the UI
//     clamps a progress bar to 100% while the number keeps climbing.
//   * closed / new-goal / unit isolation: closed goals reject contributions
//     (failed-precondition), separate goalIds keep separate counters, and
//     each contribution records the goal's `unit` at attempt time.
//
// New Admin-SDK-only collections (no firestore.rules change; default-deny
// covers them — same pattern as E3 §5.9):
//   * wsfGoals/{goalId}
//   * wsfContributions/{goalId}_{userId}_{attemptId}
//   * wsfGoalCounters/{goalId}/shards/{0..9}
//   * wsfGoalMemberTotals/{goalId}_{userId}
// ═════════════════════════════════════════════════════════════════════════════

const GOAL_SHARD_COUNT = 10;

type GoalStatus = 'active' | 'closed';

type GoalDoc = {
  ownerUid: string;
  communityGroupId: string;
  title: string;
  target: number;
  unit: string;
  status: GoalStatus;
  startsAt: FirebaseFirestore.Timestamp;
  endsAt: FirebaseFirestore.Timestamp;
  timezone: string;
  isSample?: boolean;
  createdAt?: FirebaseFirestore.Timestamp;
  closedAt?: FirebaseFirestore.Timestamp;
};

type GoalPulseTotals = {
  sharedTotal: number;
  target: number;
  unit: string;
  status: GoalStatus;
  contributorCount: number;
};

function randomGoalShardIndex(): number {
  return Math.floor(Math.random() * GOAL_SHARD_COUNT);
}

function goalShardRef(goalId: string, index: number) {
  return getFirestore().doc(`wsfGoalCounters/${goalId}/shards/${index}`);
}

async function sumGoalShards(goalId: string): Promise<number> {
  const db = getFirestore();
  const refs: FirebaseFirestore.DocumentReference[] = [];
  for (let i = 0; i < GOAL_SHARD_COUNT; i++) {
    refs.push(db.doc(`wsfGoalCounters/${goalId}/shards/${i}`));
  }
  const snaps = await db.getAll(...refs);
  let total = 0;
  for (const snap of snaps) {
    const data = snap.data() as { count?: number } | undefined;
    if (typeof data?.count === 'number') total += data.count;
  }
  return total;
}

async function countGoalContributors(goalId: string): Promise<number> {
  const snap = await getFirestore()
    .collection('wsfGoalMemberTotals')
    .where('goalId', '==', goalId)
    .count()
    .get();
  return snap.data().count;
}

// Same 2-second TTL and per-instance LRU as wsfChallengePulse — a poller at
// 2s cadence never loses precision, and burst traffic collapses to one real
// read per goalId per 2s per instance.
const GOAL_PULSE_CACHE_TTL_MS = 2_000;
const GOAL_PULSE_CACHE_MAX = 1_000;
const goalPulseCache = new Map<string, { ts: number; value: GoalPulseTotals }>();

function goalPulseCacheGet(goalId: string, now: number): GoalPulseTotals | null {
  const hit = goalPulseCache.get(goalId);
  if (!hit) return null;
  if (now - hit.ts >= GOAL_PULSE_CACHE_TTL_MS) {
    goalPulseCache.delete(goalId);
    return null;
  }
  return hit.value;
}

function goalPulseCacheSet(
  goalId: string,
  now: number,
  value: GoalPulseTotals
): void {
  if (goalPulseCache.size >= GOAL_PULSE_CACHE_MAX && !goalPulseCache.has(goalId)) {
    const oldest = goalPulseCache.keys().next().value;
    if (oldest !== undefined) goalPulseCache.delete(oldest);
  }
  goalPulseCache.set(goalId, { ts: now, value });
}

function normalizeGoalTitle(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (trimmed.length < 2 || trimmed.length > 120) return null;
  return trimmed;
}

function normalizeGoalTarget(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (!Number.isInteger(v)) return null;
  if (v < 1 || v > 100_000_000) return null;
  return v;
}

function normalizeGoalUnit(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (trimmed.length < 1 || trimmed.length > 40) return null;
  // Reject ASCII control characters. No script/language whitelist — a unit
  // like "sentadillas" or "поднятия" is valid; matches wsfCreateCommunity's
  // trim + length free-text pattern for displayName.
  if (/[\x00-\x1F\x7F]/.test(trimmed)) return null;
  return trimmed;
}

function normalizeAttemptId(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(trimmed)) return null;
  return trimmed;
}

function normalizeContributionCount(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (!Number.isInteger(v)) return null;
  if (v < 1 || v > 100_000) return null;
  return v;
}

// Signed integer for wsfAdjustGoal.delta. Zero is not a legal adjustment
// (nothing to record). Bounded so a fat-finger can't hide behind Number.MAX.
function normalizeAdjustmentDelta(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (!Number.isInteger(v)) return null;
  if (v === 0) return null;
  if (v < -100_000_000 || v > 100_000_000) return null;
  return v;
}

// 1..280 chars, no ASCII control chars. Recorded on the immutable adjustment
// doc so future audits can read why the correction happened; the length cap
// keeps the audit doc within a comfortable read size.
function normalizeAdjustmentReason(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (trimmed.length < 1 || trimmed.length > 280) return null;
  if (/[\x00-\x1F\x7F]/.test(trimmed)) return null;
  return trimmed;
}

// ISO 8601 string -> Date. Rejects empty, malformed, and infinite dates. The
// callable receives ISO strings because httpsCallable serializes over JSON;
// Date instances on the client become strings on the wire. We convert to a
// Firestore Timestamp at write time via Timestamp.fromDate().
function normalizeIsoTimestamp(v: unknown): Date | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (trimmed.length < 1 || trimmed.length > 64) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

// IANA zone name — validated by asking the runtime to build a formatter for
// it. Any invalid identifier throws RangeError. This is the same check the
// browser platform uses; we don't ship a hard-coded allowlist because the
// canonical IANA database is what actually matters and it changes over time.
function normalizeIanaTimezone(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (trimmed.length < 1 || trimmed.length > 64) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed });
    return trimmed;
  } catch {
    return null;
  }
}

// Read the caller's membership in `groupId`. Returns the membership data
// only if the row exists AND membershipStatus === 'active'. Everything else
// returns null so the caller can reject with a uniform "Members only." —
// this mirrors wsfListChallenge / wsfCheckIn.
async function readActiveMembership(
  tx: FirebaseFirestore.Transaction,
  groupId: string,
  uid: string
): Promise<{ role: string; membershipStatus: string } | null> {
  const membershipRef = getFirestore().doc(`wsfMemberships/${groupId}_${uid}`);
  const snap = await tx.get(membershipRef);
  if (!snap.exists) return null;
  const data = snap.data() as {
    role?: string;
    membershipStatus?: string;
  };
  if (data.membershipStatus !== 'active') return null;
  return {
    role: data.role ?? '',
    membershipStatus: data.membershipStatus,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// wsfCreateGoal — bring a new goal into being.
//
// Authenticated + email-verified. Caller becomes ownerUid. Returns { goalId }
// so the client can immediately deep-link into /contribute/{goalId} and
// /display/{goalId}. status starts as 'active'; unit is recorded verbatim so
// concurrent goals with different units stay isolated.
// ─────────────────────────────────────────────────────────────────────────────

type CreateGoalRequest = {
  communityGroupId?: unknown;
  title?: unknown;
  target?: unknown;
  unit?: unknown;
  startsAt?: unknown; // ISO 8601
  endsAt?: unknown; // ISO 8601
  timezone?: unknown; // IANA
};

type CreateGoalResponse = { goalId: string };

export const wsfCreateGoal = onCall<CreateGoalRequest>(
  { region: 'us-central1' },
  async (request): Promise<CreateGoalResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    const token = request.auth.token as { email_verified?: boolean };
    if (token.email_verified !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Verify your email before starting a goal.'
      );
    }
    const uid = request.auth.uid;

    const communityGroupId = normalizeStringId(request.data?.communityGroupId);
    if (!communityGroupId) {
      throw new HttpsError(
        'invalid-argument',
        'communityGroupId is required.'
      );
    }
    const title = normalizeGoalTitle(request.data?.title);
    if (!title) {
      throw new HttpsError('invalid-argument', 'title must be 2..120 chars.');
    }
    const target = normalizeGoalTarget(request.data?.target);
    if (target === null) {
      throw new HttpsError(
        'invalid-argument',
        'target must be a positive integer up to 100000000.'
      );
    }
    const unit = normalizeGoalUnit(request.data?.unit);
    if (!unit) {
      throw new HttpsError(
        'invalid-argument',
        'unit must be 1..40 chars; no ASCII control characters.'
      );
    }
    const startsAtDate = normalizeIsoTimestamp(request.data?.startsAt);
    if (!startsAtDate) {
      throw new HttpsError(
        'invalid-argument',
        'startsAt must be a valid ISO 8601 timestamp.'
      );
    }
    const endsAtDate = normalizeIsoTimestamp(request.data?.endsAt);
    if (!endsAtDate) {
      throw new HttpsError(
        'invalid-argument',
        'endsAt must be a valid ISO 8601 timestamp.'
      );
    }
    if (endsAtDate.getTime() <= startsAtDate.getTime()) {
      throw new HttpsError(
        'invalid-argument',
        'endsAt must be strictly after startsAt.'
      );
    }
    const timezone = normalizeIanaTimezone(request.data?.timezone);
    if (!timezone) {
      throw new HttpsError(
        'invalid-argument',
        'timezone must be a valid IANA identifier.'
      );
    }

    const db = getFirestore();
    const goalRef = db.collection('wsfGoals').doc();

    // Membership + role are checked inside the transaction so a caller who
    // loses foundingChampion between read and write can never race a goal
    // into existence. Reuses the E3.5 wsfMemberships shape verbatim —
    // groupId_uid path, {role, membershipStatus}. No new role invented.
    await db.runTransaction(async (tx) => {
      const membership = await readActiveMembership(tx, communityGroupId, uid);
      if (!membership) {
        throw new HttpsError(
          'permission-denied',
          'Active membership required in the community.'
        );
      }
      if (membership.role !== 'foundingChampion') {
        throw new HttpsError(
          'permission-denied',
          'Only a foundingChampion can start a goal in this community.'
        );
      }

      tx.set(goalRef, {
        ownerUid: uid,
        communityGroupId,
        title,
        target,
        unit,
        status: 'active',
        startsAt: Timestamp.fromDate(startsAtDate),
        endsAt: Timestamp.fromDate(endsAtDate),
        timezone,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    return { goalId: goalRef.id };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// wsfContribute — add `count` units to `goalId` under attempt `attemptId`.
//
// Idempotent by (goalId, attemptId). Concurrency-safe via random-shard
// increment + a per-member totals doc for own-credit. Rejects contributions
// to a non-active goal.
//
// The transaction reads goal + prior contribution + prior member total up
// front, then either short-circuits on idempotent replay OR writes the
// contribution + shard delta + updated member total atomically. Idempotent
// replay returns the ORIGINAL count so the caller sees the same body they
// would have seen on the first tap — matching E3's §5.3 discipline.
// ─────────────────────────────────────────────────────────────────────────────

type ContributeRequest = {
  goalId?: unknown;
  attemptId?: unknown;
  count?: unknown;
};

type ContributeResponse = {
  addedCount: number;
  ownCredit: number;
  sharedTotal: number;
  target: number;
  unit: string;
  status: GoalStatus;
  alreadyRecorded: boolean;
};

export const wsfContribute = onCall<ContributeRequest>(
  { region: 'us-central1' },
  async (request): Promise<ContributeResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    const uid = request.auth.uid;

    const goalId = normalizeStringId(request.data?.goalId);
    if (!goalId) {
      throw new HttpsError('invalid-argument', 'goalId is required.');
    }
    const attemptId = normalizeAttemptId(request.data?.attemptId);
    if (!attemptId) {
      throw new HttpsError(
        'invalid-argument',
        'attemptId must be 8..128 chars of A-Z, a-z, 0-9, _ or -.'
      );
    }
    const count = normalizeContributionCount(request.data?.count);
    if (count === null) {
      throw new HttpsError(
        'invalid-argument',
        'count must be a positive integer up to 100000.'
      );
    }

    const db = getFirestore();
    const goalRef = db.doc(`wsfGoals/${goalId}`);
    // Attempt identity is goal + authenticated uid + attemptId. Same member,
    // same attemptId -> one recorded contribution and the original receipt
    // on replay; different members with the same attemptId -> distinct keys.
    const contribRef = db.doc(
      `wsfContributions/${goalId}_${uid}_${attemptId}`
    );
    const memberTotalRef = db.doc(`wsfGoalMemberTotals/${goalId}_${uid}`);

    // Two-phase read inside the transaction: goal first (need communityGroupId
    // to derive the membership path), then contribution + memberTotal +
    // membership in parallel. Mirrors wsfCheckIn's §E3-fix-3 shape — the
    // "all reads before writes" rule stops at the first write, so sequential
    // tx.get() plus a Promise.all is legal.
    const { addedCount, alreadyRecorded, goalTarget, goalUnit, goalStatus } =
      await db.runTransaction(async (tx) => {
        const goalSnap = await tx.get(goalRef);
        if (!goalSnap.exists) {
          throw new HttpsError('not-found', 'Goal not found.');
        }
        const goal = goalSnap.data() as GoalDoc;
        const membershipRef = db.doc(
          `wsfMemberships/${goal.communityGroupId}_${uid}`
        );

        const [contribSnap, memberTotalSnap, membershipSnap] =
          await Promise.all([
            tx.get(contribRef),
            tx.get(memberTotalRef),
            tx.get(membershipRef),
          ]);

        // Idempotency wins over closure, window end, AND membership drift.
        // A member who already succeeded must never see "you did the reps,
        // we say you didn't" — even if the goal has since closed, the window
        // has ended, or their membership was revoked. Matches wsfCheckIn
        // §5.3 discipline.
        if (contribSnap.exists) {
          const prev = contribSnap.data() as {
            count?: number;
            userId?: string;
          };
          // The key is scoped by uid, so an existing doc IS this caller's own
          // earlier attempt. If storage ever disagreed that would be corruption,
          // not a caller-observable state: refuse rather than leak a count.
          if (prev.userId !== uid) {
            throw new HttpsError('internal', 'Contribution record mismatch.');
          }
          return {
            addedCount: typeof prev.count === 'number' ? prev.count : 0,
            alreadyRecorded: true as const,
            goalTarget: goal.target,
            goalUnit: goal.unit,
            goalStatus: goal.status,
          };
        }

        // NEW contribution — enforce all gates in strict order.
        //   1. Active membership in the goal's community. Non-member and
        //      wrong-group callers both fall out here with the same message
        //      (avoids leaking whether a given group id exists).
        if (!membershipSnap.exists) {
          throw new HttpsError('permission-denied', 'Members only.');
        }
        const membership = membershipSnap.data() as {
          membershipStatus?: string;
        };
        if (membership.membershipStatus !== 'active') {
          throw new HttpsError('permission-denied', 'Members only.');
        }

        //   2. Goal must be active.
        if (goal.status !== 'active') {
          throw new HttpsError('failed-precondition', 'This goal is closed.');
        }

        //   3. Server-time window enforcement. startsAt inclusive, endsAt
        //      exclusive — a contribution landing exactly at endsAt is
        //      rejected. Uses Timestamp.now() so a client clock skew can
        //      never open or close the window early.
        const now = Timestamp.now();
        const startMs = goal.startsAt.toMillis();
        const endMs = goal.endsAt.toMillis();
        if (now.toMillis() < startMs) {
          throw new HttpsError(
            'failed-precondition',
            'Goal has not started yet.'
          );
        }
        if (now.toMillis() >= endMs) {
          throw new HttpsError(
            'failed-precondition',
            'Goal window has ended.'
          );
        }

        const shardIndex = randomGoalShardIndex();
        const shard = goalShardRef(goalId, shardIndex);

        tx.set(contribRef, {
          goalId,
          attemptId,
          userId: uid,
          count,
          shardIndex,
          unit: goal.unit,
          communityGroupId: goal.communityGroupId,
          createdAt: FieldValue.serverTimestamp(),
        });
        tx.set(
          shard,
          { count: FieldValue.increment(count) },
          { merge: true }
        );

        const previousMemberTotal =
          (memberTotalSnap.data() as { total?: number } | undefined)?.total ??
          0;
        tx.set(
          memberTotalRef,
          {
            goalId,
            userId: uid,
            total: previousMemberTotal + count,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return {
          addedCount: count,
          alreadyRecorded: false as const,
          goalTarget: goal.target,
          goalUnit: goal.unit,
          goalStatus: goal.status,
        };
      });

    const [sharedTotal, ownCreditSnap] = await Promise.all([
      sumGoalShards(goalId),
      memberTotalRef.get(),
    ]);
    const ownCredit =
      (ownCreditSnap.data() as { total?: number } | undefined)?.total ?? 0;

    return {
      addedCount,
      ownCredit,
      sharedTotal,
      target: goalTarget,
      unit: goalUnit,
      status: goalStatus,
      alreadyRecorded,
    };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// wsfGoalPulse — public read of the shared total for `goalId`.
//
// Public invoker: a kiosk / audience display uses this unauthenticated.
// Cache-first (2s TTL, per-instance LRU) mirrors wsfChallengePulse so a
// display polling every 2s does not pay a Firestore read on every tick.
// No rate-limit / no isSample filter / no eligibility check — the E4-A1
// slice reads the goal doc verbatim by id. Hardening beyond the cache TTL
// is deferred to its own review per the scope correction 2026-09-11.
// ─────────────────────────────────────────────────────────────────────────────

type GoalPulseRequest = { goalId?: unknown };

export const wsfGoalPulse = onCall<GoalPulseRequest>(
  { region: 'us-central1', invoker: 'public' },
  async (request): Promise<GoalPulseTotals> => {
    const now = Date.now();

    const goalId = normalizeStringId(request.data?.goalId);
    if (!goalId) {
      throw new HttpsError('invalid-argument', 'goalId is required.');
    }

    const cached = goalPulseCacheGet(goalId, now);
    if (cached) return cached;

    const db = getFirestore();
    const goalSnap = await db.doc(`wsfGoals/${goalId}`).get();
    if (!goalSnap.exists) {
      throw new HttpsError('not-found', 'Goal not found.');
    }
    const goal = goalSnap.data() as GoalDoc;

    const [sharedTotal, contributorCount] = await Promise.all([
      sumGoalShards(goalId),
      countGoalContributors(goalId),
    ]);
    const totals: GoalPulseTotals = {
      sharedTotal,
      target: goal.target,
      unit: goal.unit,
      status: goal.status,
      contributorCount,
    };
    goalPulseCacheSet(goalId, now, totals);
    return totals;
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// wsfMyContribution — authenticated own-credit read for a goal (E4-A1-R4).
//
// The auth boundary is the explicit `request.auth` check below: anonymous
// callers get `unauthenticated`. The Firestore path is derived from
// request.auth.uid, never from a client-supplied id, so a caller can only
// read their own row. Deliberately NOT cached — a shared cache would be a
// cross-member leak vector; wsfGoalPulse's cache holds public totals only.
//
// No membership check by design: a member who left still deserves to see
// the credit they earned (matches wsfContribute's idempotency-over-membership-
// drift discipline). Corrections applied through wsfAdjustGoal land on the
// same wsfGoalMemberTotals doc, so this read is durable across reload,
// closure and authorized correction with no extra mechanism.
// ─────────────────────────────────────────────────────────────────────────────

type MyContributionRequest = { goalId?: unknown };

type MyContributionResponse = { ownCredit: number; unit: string };

export const wsfMyContribution = onCall<MyContributionRequest>(
  { region: 'us-central1' },
  async (request): Promise<MyContributionResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    const uid = request.auth.uid;
    const goalId = normalizeStringId(request.data?.goalId);
    if (!goalId) {
      throw new HttpsError('invalid-argument', 'goalId is required.');
    }
    const db = getFirestore();
    const [goalSnap, memberSnap] = await Promise.all([
      db.doc(`wsfGoals/${goalId}`).get(),
      db.doc(`wsfGoalMemberTotals/${goalId}_${uid}`).get(),
    ]);
    if (!goalSnap.exists) {
      throw new HttpsError('not-found', 'Goal not found.');
    }
    const goal = goalSnap.data() as GoalDoc;
    const total =
      (memberSnap.data() as { total?: number } | undefined)?.total ?? 0;
    return { ownCredit: total, unit: goal.unit };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// wsfAdjustGoal — authorized downward (or upward) correction of a goal's
// shared total and, optionally, a specific member's own credit.
//
// Contributions are immutable. When a mis-recording needs to be undone, we
// don't rewrite the contribution — we WRITE an adjustment. The adjustment is
// itself immutable; each one is a new row on wsfGoalAdjustments/{adjId}. The
// running total is (sum of contribution counts) + (sum of adjustment deltas).
//
// Why: three properties matter simultaneously —
//   • the ledger of what actually happened stays intact,
//   • the visible shared total is *exact* (not monotonic-only),
//   • any downward move is traced to a caller and a reason.
//
// Auth: caller must have an active foundingChampion membership in the goal's
// community. No new role is invented — this reuses the same authority model
// that lets a foundingChampion create the goal in the first place.
//
// Delta is a signed nonzero integer. targetUid is optional; when present the
// caller-supplied uid's per-member total moves by delta as well, so both
// "we counted this member for too much" and "we counted a member who never
// showed" can be corrected symmetrically. When targetUid is absent, only the
// shared total moves — used for e.g. "one of the tally counters was jammed
// and the shared count is off by 40."
//
// Bounds: delta is nonzero, bounded to ±100M. The transaction rejects any
// adjustment that would drive shared total or the addressed member total
// below zero — "no monotonic-only total" does not mean "allow negative
// totals," it means "downward corrections are permitted."
// ─────────────────────────────────────────────────────────────────────────────

type AdjustGoalRequest = {
  goalId?: unknown;
  delta?: unknown;
  targetUid?: unknown;
  reason?: unknown;
};

type AdjustGoalResponse = {
  adjustmentId: string;
  delta: number;
  targetUid: string | null;
  sharedTotal: number;
  targetMemberTotal: number | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// wsfListGoals — the seam between a community and its goals.
//
// Every other wsfGoals access in this file is by explicit goalId, so a member
// who did not create the goal had no way to learn its id. That, not a missing
// primitive, is why the built goal loop was unreachable from the community.
//
// AUTHORIZATION IS ENFORCED HERE, IN THE HANDLER. The callable framework hands
// the handler the caller's auth state; it does not gate on it. `invoker` only
// controls who may reach Cloud Run, and how many functions carry
// `invoker: 'public'` is not a test of anything. This handler requires
// authentication AND an active membership in the requested group, and returns
// the same not-found to a non-member as to a caller naming a group that does
// not exist, so the response cannot be used to probe which groups exist.
//
// RESPONSE IS MINIMAL by design: goalId, title, target, unit, status, startsAt,
// endsAt. No member identity, no per-member credit, no contributor list. The
// shared total is not included — a caller that wants it asks wsfGoalPulse,
// which is a separate surface with its own (currently unresolved) eligibility
// question. This callable does not widen that.
//
// INDEX EXPECTATION, not an unconditional claim: the query filters on
// `communityGroupId ==` and `status ==` with no range, no inequality and no
// orderBy, so it is expected to be served by Firestore's automatic
// single-field indexes, which can be merged for conjunctions of equality
// filters. `firestore.indexes.json` is deliberately untouched. Note that the
// emulator does NOT enforce compound-index requirements, so an emulator pass
// cannot verify production index readiness — that is a deploy-time check.
// ─────────────────────────────────────────────────────────────────────────────

type ListGoalsRequest = { groupId?: unknown };

type ListedGoal = {
  goalId: string;
  title: string;
  target: number;
  unit: string;
  status: GoalStatus;
  startsAt: string;
  endsAt: string;
};

type ListGoalsResponse = { goals: ListedGoal[] };

export const wsfListGoals = onCall<ListGoalsRequest>(
  { region: 'us-central1' },
  async (request): Promise<ListGoalsResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    const uid = request.auth.uid;

    const groupId = normalizeStringId(request.data?.groupId);
    if (!groupId) {
      throw new HttpsError('invalid-argument', 'groupId is required.');
    }

    const db = getFirestore();

    // Active membership in THIS group. An inactive membership, a membership in
    // a different group, and no membership at all are the same answer, and it
    // is the same answer a caller gets for a group that does not exist.
    const membershipSnap = await db.doc(`wsfMemberships/${groupId}_${uid}`).get();
    if (!membershipSnap.exists) {
      throw new HttpsError('not-found', 'Community not found.');
    }
    const membership = membershipSnap.data() as { membershipStatus?: string };
    if (membership.membershipStatus !== 'active') {
      throw new HttpsError('not-found', 'Community not found.');
    }

    // Equality-only. A goal that has reached or passed its target is still
    // `active` until it is closed, so it stays in this list — reaching the
    // target is a reason to celebrate on the page, never a reason for the goal
    // to disappear from under the people still contributing to it.
    const snap = await db
      .collection('wsfGoals')
      .where('communityGroupId', '==', groupId)
      .where('status', '==', 'active')
      .get();

    // More than one active goal is legitimate and is NOT collapsed: separately
    // created goals stay separate, each with its own title, unit and window.
    // The client decides how to present several; this callable does not pick
    // one for it. Zero goals is an ordinary empty list, not an error — a
    // community with no goal yet is the normal state before a champion starts
    // one.
    const goals: ListedGoal[] = snap.docs.map((docSnap) => {
      const goal = docSnap.data() as GoalDoc;
      return {
        goalId: docSnap.id,
        title: goal.title,
        target: goal.target,
        unit: goal.unit,
        status: goal.status,
        startsAt: goal.startsAt.toDate().toISOString(),
        endsAt: goal.endsAt.toDate().toISOString(),
      };
    });

    // Deterministic order so the interface does not reshuffle between polls.
    // Sorted in the handler rather than with orderBy, which would add an index
    // requirement this packet is not allowed to introduce.
    goals.sort((a, b) => (a.endsAt === b.endsAt ? a.goalId.localeCompare(b.goalId) : a.endsAt.localeCompare(b.endsAt)));

    return { goals };
  }
);

export const wsfAdjustGoal = onCall<AdjustGoalRequest>(
  { region: 'us-central1' },
  async (request): Promise<AdjustGoalResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    const uid = request.auth.uid;

    const goalId = normalizeStringId(request.data?.goalId);
    if (!goalId) {
      throw new HttpsError('invalid-argument', 'goalId is required.');
    }
    const delta = normalizeAdjustmentDelta(request.data?.delta);
    if (delta === null) {
      throw new HttpsError(
        'invalid-argument',
        'delta must be a nonzero integer within ±100000000.'
      );
    }
    const reason = normalizeAdjustmentReason(request.data?.reason);
    if (!reason) {
      throw new HttpsError(
        'invalid-argument',
        'reason must be 1..280 chars; no ASCII control characters.'
      );
    }
    let targetUid: string | null = null;
    const rawTargetUid = request.data?.targetUid;
    if (rawTargetUid !== undefined && rawTargetUid !== null) {
      const normalized = normalizeStringId(rawTargetUid);
      if (!normalized) {
        throw new HttpsError(
          'invalid-argument',
          'targetUid, when provided, must be a valid user id.'
        );
      }
      targetUid = normalized;
    }

    const db = getFirestore();
    const goalRef = db.doc(`wsfGoals/${goalId}`);
    const adjustmentRef = db.collection('wsfGoalAdjustments').doc();
    const shardRefs: FirebaseFirestore.DocumentReference[] = [];
    for (let i = 0; i < GOAL_SHARD_COUNT; i++) {
      shardRefs.push(db.doc(`wsfGoalCounters/${goalId}/shards/${i}`));
    }
    const writeShardRef = shardRefs[0]!; // deterministic; corrections aren't hot

    const { newTargetTotal } = await db.runTransaction(async (tx) => {
      const goalSnap = await tx.get(goalRef);
      if (!goalSnap.exists) {
        throw new HttpsError('not-found', 'Goal not found.');
      }
      const goal = goalSnap.data() as GoalDoc;

      // Caller must be an active foundingChampion in the goal's community.
      const callerMembership = await readActiveMembership(
        tx,
        goal.communityGroupId,
        uid
      );
      if (!callerMembership) {
        throw new HttpsError('permission-denied', 'Members only.');
      }
      if (callerMembership.role !== 'foundingChampion') {
        throw new HttpsError(
          'permission-denied',
          'Only a foundingChampion can adjust this goal.'
        );
      }

      const targetMemberTotalRef = targetUid
        ? db.doc(`wsfGoalMemberTotals/${goalId}_${targetUid}`)
        : null;

      const [shardSnaps, targetTotalSnap] = await Promise.all([
        Promise.all(shardRefs.map((r) => tx.get(r))),
        targetMemberTotalRef
          ? tx.get(targetMemberTotalRef)
          : Promise.resolve(null),
      ]);

      const currentSharedTotal = shardSnaps.reduce((sum, snap) => {
        const data = snap.data() as { count?: number } | undefined;
        return sum + (typeof data?.count === 'number' ? data.count : 0);
      }, 0);
      const projectedSharedTotal = currentSharedTotal + delta;
      if (projectedSharedTotal < 0) {
        throw new HttpsError(
          'failed-precondition',
          'Adjustment would drive shared total below zero.'
        );
      }

      let projectedTargetTotal: number | null = null;
      if (targetMemberTotalRef && targetTotalSnap) {
        const prevTargetTotal =
          (targetTotalSnap.data() as { total?: number } | undefined)?.total ??
          0;
        projectedTargetTotal = prevTargetTotal + delta;
        if (projectedTargetTotal < 0) {
          throw new HttpsError(
            'failed-precondition',
            "Adjustment would drive the member's total below zero."
          );
        }
      }

      // Immutable audit doc. Written once; never updated.
      tx.set(adjustmentRef, {
        goalId,
        communityGroupId: goal.communityGroupId,
        delta,
        targetUid,
        reason,
        byUid: uid,
        byRole: 'foundingChampion',
        shardIndex: 0,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(
        writeShardRef,
        { count: FieldValue.increment(delta) },
        { merge: true }
      );
      if (targetMemberTotalRef) {
        tx.set(
          targetMemberTotalRef,
          {
            goalId,
            userId: targetUid,
            total: projectedTargetTotal,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      return { newTargetTotal: projectedTargetTotal };
    });

    const sharedTotal = await sumGoalShards(goalId);
    return {
      adjustmentId: adjustmentRef.id,
      delta,
      targetUid,
      sharedTotal,
      targetMemberTotal: newTargetTotal,
    };
  }
);
