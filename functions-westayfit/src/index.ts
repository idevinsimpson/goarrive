import { createHash, randomBytes } from 'crypto';

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
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
    throw new HttpsError(
      'failed-precondition',
      `wsfSendVerificationEmail is not configured: missing ${missing.join(', ')}.`
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
