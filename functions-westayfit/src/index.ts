import { createHash, randomBytes } from 'crypto';

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { defineSecret, projectID } from 'firebase-functions/params';
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

/**
 * Admission tiers a valid link can open. 'private' is deliberately absent:
 * a forwarded general link never admits anyone to a private community —
 * authorization there is per invitee (D5).
 *
 * 'public' remains the only tier that may ever be listed or discovered; this
 * set is about link admission, not discoverability, and nothing here
 * implements discovery.
 */
const LINK_JOINABLE: ReadonlySet<string> = new Set(['public', 'inviteOnly']);

/**
 * Membership states.
 *
 * 'removed' and 'departed' are deliberately different values, not one
 * "inactive". A person who leaves is not banned; a person who was removed
 * needs an explicit Champion action to come back. Every existing read already
 * requires exactly 'active' (wsfListChallenge, wsfCheckIn,
 * readActiveMembership, wsfContribute, wsfMyCommunities, and the preview's
 * member aggregate), so both values close those doors the moment they can be
 * written.
 */
const MEMBERSHIP_ACTIVE = 'active';
const MEMBERSHIP_REMOVED = 'removed';
const MEMBERSHIP_DEPARTED = 'departed';

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
  joinPolicy: JoinPolicy;
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
    // D4: 'public' AND 'inviteOnly' preview on an 'active' lifecycle.
    // 'private' and anything else return the same not-found as an unknown
    // code — the oracle test still holds for every tier that is not link-
    // addressable.
    //
    // WIDENING, named explicitly: this callable is invoker:'public', so an
    // unauthenticated caller holding a code could previously confirm the
    // existence, name and type of a 'public' community only. It can now do the
    // same for an 'inviteOnly' community whose code it holds. That is what
    // "Anyone with the link" requires. It stays bounded by the IP rate limit
    // that fires before any code lookup, by the minimised response (D6), and
    // by the unchanged not-found for 'private' and unknown codes.
    if (!LINK_JOINABLE.has(group.joinPolicy) || group.lifecycleStatus !== 'active') {
      notFound();
    }

    // D6: the minimum needed to explain what someone is joining — name, the
    // supported type, and the joining conditions the client renders from
    // joinPolicy. NO member count.
    //
    // BEHAVIOUR CHANGE to an existing response: this callable used to return a
    // `memberCount` aggregate over active memberships. It no longer does.
    // Caller updated: apps/westayfit/app/join/[joinCode].tsx.
    //
    // No member names, goals, totals, history or locations are exposed here,
    // and none ever were.
    return {
      displayName: group.displayName,
      groupType: group.groupType,
      joinPolicy: group.joinPolicy,
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

      // D3. This branch used to return before any policy check and WITHOUT
      // consulting membershipStatus. Once a non-active value can be written,
      // that would have routed a removed person straight back in on an old
      // link. Each state now has a stated answer.
      //
      // Note the ordering that is deliberately preserved: the code lookup
      // above already returned notFound() for an unknown — including a RESET —
      // code before membership is read. So a reset code is unknown to
      // everyone, members included (D1 wins over this grandfathering), and the
      // code space stays unguessable.
      if (membershipSnap.exists) {
        const existing = membershipSnap.data() as { membershipStatus?: string };
        const status = existing.membershipStatus;

        // ACTIVE MEMBER — the legitimate purpose of this branch. A returning
        // tap on the CURRENT link resolves, and the membership is neither
        // re-created nor duplicated, even if the Champion has since flipped
        // the policy or the lifecycle.
        if (status === MEMBERSHIP_ACTIVE) {
          return { groupId: groupDoc.id, alreadyMember: true };
        }

        // REMOVED — a general link never reactivates a removed membership.
        // The response is the same notFound() an unknown code gets, so it
        // discloses nothing about the community's current state, its name, or
        // even that this person was once a member. Reinstatement is an
        // explicit Champion action (wsfReinstateMember).
        if (status === MEMBERSHIP_REMOVED) {
          notFound();
        }

        // VOLUNTARILY DEPARTED — not banned. They come back the ordinary way,
        // so the normal admission rules below must pass: a valid link to a
        // link-joinable community on an active lifecycle. If those pass, the
        // existing record is reactivated rather than duplicated.
        if (status === MEMBERSHIP_DEPARTED) {
          if (!LINK_JOINABLE.has(group.joinPolicy) || group.lifecycleStatus !== 'active') {
            notFound();
          }
          tx.set(
            membershipRef,
            {
              membershipStatus: MEMBERSHIP_ACTIVE,
              rejoinedAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          return { groupId: groupDoc.id, alreadyMember: false };
        }

        // Any other stored value is not a state this code understands, and
        // guessing would be the wrong instinct for an admission decision.
        notFound();
      }

      if (!LINK_JOINABLE.has(group.joinPolicy) || group.lifecycleStatus !== 'active') {
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
// D — ADMISSION CONTROLS
//
// Everything below changes who may enter or remain in a community. None of it
// touches contributions: no callable here writes wsfContributions,
// wsfGoalCounters, wsfGoalMemberTotals, wsfGoalAdjustments, wsfCheckIns,
// wsfChallengeCounters or wsfChallengeParticipants. Past valid contributions
// stay counted when a membership ends — that is a deliberate property of these
// handlers, not an accident of not having gotten to it.
// ─────────────────────────────────────────────────────────────────────────────

type ChampionGroup = { joinPolicy: JoinPolicy; lifecycleStatus: string; joinCode?: string };
type ChampionCheck = { groupRef: FirebaseFirestore.DocumentReference; group: ChampionGroup };

/**
 * Require an ACTIVE foundingChampion membership in this community, read inside
 * the transaction. Same shape as the existing champion-gated callables; no new
 * role is invented.
 *
 * A caller who is not a champion here gets the same not-found as a community
 * that does not exist, so these callables cannot be used to probe which
 * communities exist or who runs them.
 */
async function requireChampion(
  tx: FirebaseFirestore.Transaction,
  groupId: string,
  uid: string
): Promise<ChampionCheck> {
  const db = getFirestore();
  const groupRef = db.doc(`wsfCommunityGroups/${groupId}`);
  const [groupSnap, membershipSnap] = await Promise.all([
    tx.get(groupRef),
    tx.get(db.doc(`wsfMemberships/${groupId}_${uid}`)),
  ]);
  if (!groupSnap.exists) notFound();
  if (!membershipSnap.exists) notFound();
  const membership = membershipSnap.data() as { role?: string; membershipStatus?: string };
  if (membership.membershipStatus !== MEMBERSHIP_ACTIVE) notFound();
  if (membership.role !== 'foundingChampion') notFound();
  return { groupRef, group: groupSnap.data() as ChampionGroup };
}

/**
 * Count active champions in a community, INSIDE the caller's transaction.
 *
 * DEFECT THIS FIXES, found in review of Package D. The first version ran an
 * aggregate .count() outside the transaction and captured the result in a
 * closure. That put the champion documents in no read set at all, and
 * wsfLeaveCommunity's transaction touches only the caller's OWN membership
 * doc — so two Champions leaving at the same time wrote to disjoint
 * documents, never conflicted, both observed a count of 2, both passed the
 * `<= 1` guard, and the community was left with zero Champions. Exactly the
 * outcome D7 exists to prevent. A comment above the old call even claimed the
 * guard was "re-checked inside" the transaction; it was not.
 *
 * Reading the champion docs through tx.get puts every one of them in the read
 * set, so concurrent departures now overlap and Firestore aborts and retries
 * the loser, which then sees the true remaining count and is refused. This is
 * why it counts documents rather than using the cheaper .count() aggregate:
 * the point is the read set, not the number.
 */
async function countActiveChampionsTx(
  tx: FirebaseFirestore.Transaction,
  groupId: string
): Promise<number> {
  const snap = await tx.get(
    getFirestore()
      .collection('wsfMemberships')
      .where('groupId', '==', groupId)
      .where('membershipStatus', '==', MEMBERSHIP_ACTIVE)
      .where('role', '==', 'foundingChampion')
  );
  return snap.size;
}

// ─────────────────────────────────────────────────────────────────────────────
// D1 — wsfResetJoinCode. A Champion retires the current link.
//
// New admissions through the old link stop. Existing members are NOT removed
// and contributions are NOT altered — this writes exactly one field on one
// group document.
//
// After a reset the old code resolves exactly as an unknown code does, on both
// the join and the preview path: the same notFound(), with no distinguishable
// "this link was reset" response, so the code space stays unguessable. That
// includes existing members: a reset code is unknown to everyone. An active
// member who taps a retired link remains a member and reaches the community
// through the current link or their own community list.
// ─────────────────────────────────────────────────────────────────────────────

type ResetJoinCodeRequest = { groupId?: unknown };
type ResetJoinCodeResponse = { groupId: string; joinCode: string };

export const wsfResetJoinCode = onCall<ResetJoinCodeRequest>(
  { region: 'us-central1' },
  async (request): Promise<ResetJoinCodeResponse> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const uid = request.auth.uid;
    const groupId = normalizeStringId(request.data?.groupId);
    if (!groupId) throw new HttpsError('invalid-argument', 'groupId is required.');

    const db = getFirestore();

    // Codes are looked up by equality on `joinCode`, so a collision would make
    // one code resolve to two communities. Mint from 16 random bytes and check
    // before committing; on the vanishingly unlikely collision, try again a
    // bounded number of times and fail loudly rather than silently reusing.
    let minted = '';
    for (let attempt = 0; attempt < 5 && !minted; attempt += 1) {
      const candidate = mintJoinCode();
      const clash = await db
        .collection('wsfCommunityGroups')
        .where('joinCode', '==', candidate)
        .limit(1)
        .get();
      if (clash.empty) minted = candidate;
    }
    if (!minted) {
      throw new HttpsError('internal', 'Could not mint a unique join code. Try again.');
    }

    await db.runTransaction(async (tx) => {
      const { groupRef } = await requireChampion(tx, groupId, uid);
      // Admission only. One field.
      tx.set(
        groupRef,
        { joinCode: minted, joinCodeResetAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
    });

    return { groupId, joinCode: minted };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// D2 — removal, voluntary departure, and reinstatement.
//
// Removal and departure are DIFFERENT STATES, not one "inactive". A person who
// leaves is not banned: they return through the community's ordinary admission
// path (see wsfJoinCommunity's departed branch). A person who was removed needs
// an explicit Champion action.
//
// WHAT A STATUS FLIP ACTUALLY CLOSES — enumerated rather than assumed. Every
// one of these requires membershipStatus === 'active' and therefore closes
// immediately: wsfListChallenge, wsfCheckIn, readActiveMembership (which gates
// wsfCreateGoal and wsfAdjustGoal), wsfContribute, wsfMyCommunities, and the
// preview's active-membership aggregate.
//
// WHAT IT DOES NOT CLOSE, deliberately:
//   - wsfMyContribution still answers a former member about their OWN credit.
//     That is what "past valid contributions do not disappear" means, and it
//     survives Package E unchanged. What Package E added there is a
//     non-enumeration check, not a membership check: a caller with no record
//     of their own AND no active membership gets the unknown-goal answer, so
//     the own-credit endpoint stopped being a way for a signed-in stranger to
//     confirm that a protected goal exists and learn its unit.
//   - wsfGoalPulse was a public aggregate read with no eligibility check at
//     all, and removal did not close it. PACKAGE E closed it: the read now
//     requires an active membership in the goal's community OR an explicit
//     per-goal display authorization. Removal therefore does now close the
//     pulse path for an unauthorized goal, and deliberately does not close it
//     for an authorized one — those numbers are public by explicit decision.
// ─────────────────────────────────────────────────────────────────────────────

type MembershipActionRequest = { groupId?: unknown; targetUid?: unknown };
type MembershipActionResponse = { groupId: string; targetUid: string; membershipStatus: string };

export const wsfRemoveMember = onCall<MembershipActionRequest>(
  { region: 'us-central1' },
  async (request): Promise<MembershipActionResponse> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const uid = request.auth.uid;
    const groupId = normalizeStringId(request.data?.groupId);
    const targetUid = normalizeStringId(request.data?.targetUid);
    if (!groupId) throw new HttpsError('invalid-argument', 'groupId is required.');
    if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid is required.');
    if (targetUid === uid) {
      throw new HttpsError(
        'failed-precondition',
        'Use leave-community to step down yourself; removal is for other members.'
      );
    }

    const db = getFirestore();
    await db.runTransaction(async (tx) => {
      await requireChampion(tx, groupId, uid);
      // D7 guard, counted inside the transaction so the champion documents
      // are in this transaction's read set (see countActiveChampionsTx).
      const championsBefore = await countActiveChampionsTx(tx, groupId);
      const targetRef = db.doc(`wsfMemberships/${groupId}_${targetUid}`);
      const targetSnap = await tx.get(targetRef);
      if (!targetSnap.exists) notFound();
      const target = targetSnap.data() as { role?: string; membershipStatus?: string };
      if (target.membershipStatus !== MEMBERSHIP_ACTIVE) {
        throw new HttpsError('failed-precondition', 'That person is not an active member.');
      }
      // A community must never be left with nobody able to manage it.
      if (target.role === 'foundingChampion' && championsBefore <= 1) {
        throw new HttpsError(
          'failed-precondition',
          'This community would be left with no Champion. Designate another Champion first.'
        );
      }
      tx.set(
        targetRef,
        {
          membershipStatus: MEMBERSHIP_REMOVED,
          removedAt: FieldValue.serverTimestamp(),
          removedByUid: uid,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    return { groupId, targetUid, membershipStatus: MEMBERSHIP_REMOVED };
  }
);

type LeaveRequest = { groupId?: unknown };

export const wsfLeaveCommunity = onCall<LeaveRequest>(
  { region: 'us-central1' },
  async (request): Promise<MembershipActionResponse> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const uid = request.auth.uid;
    const groupId = normalizeStringId(request.data?.groupId);
    if (!groupId) throw new HttpsError('invalid-argument', 'groupId is required.');

    const db = getFirestore();
    await db.runTransaction(async (tx) => {
      // Counted inside the transaction. This is the case the old out-of-band
      // count got wrong: two Champions leaving at once touch only their own
      // membership docs, so without the champion docs in the read set nothing
      // made them conflict.
      const championsBefore = await countActiveChampionsTx(tx, groupId);
      const ref = db.doc(`wsfMemberships/${groupId}_${uid}`);
      const snap = await tx.get(ref);
      if (!snap.exists) notFound();
      const membership = snap.data() as { role?: string; membershipStatus?: string };
      if (membership.membershipStatus !== MEMBERSHIP_ACTIVE) {
        throw new HttpsError('failed-precondition', 'You are not an active member.');
      }
      if (membership.role === 'foundingChampion' && championsBefore <= 1) {
        throw new HttpsError(
          'failed-precondition',
          'You are this community\'s only Champion. Designate another Champion before you leave.'
        );
      }
      tx.set(
        ref,
        {
          membershipStatus: MEMBERSHIP_DEPARTED,
          departedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    return { groupId, targetUid: uid, membershipStatus: MEMBERSHIP_DEPARTED };
  }
);

/**
 * Reinstatement of a REMOVED member. Deliberate, Champion-only, and never an
 * automatic consequence of tapping a link.
 *
 * A voluntarily departed person does not need this: they rejoin through the
 * ordinary admission path. Applying the removed-member rule to them would be
 * treating leaving as a ban.
 */
export const wsfReinstateMember = onCall<MembershipActionRequest>(
  { region: 'us-central1' },
  async (request): Promise<MembershipActionResponse> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const uid = request.auth.uid;
    const groupId = normalizeStringId(request.data?.groupId);
    const targetUid = normalizeStringId(request.data?.targetUid);
    if (!groupId) throw new HttpsError('invalid-argument', 'groupId is required.');
    if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid is required.');

    const db = getFirestore();
    await db.runTransaction(async (tx) => {
      await requireChampion(tx, groupId, uid);
      const targetRef = db.doc(`wsfMemberships/${groupId}_${targetUid}`);
      const targetSnap = await tx.get(targetRef);
      if (!targetSnap.exists) notFound();
      const target = targetSnap.data() as { membershipStatus?: string };
      if (target.membershipStatus !== MEMBERSHIP_REMOVED) {
        throw new HttpsError('failed-precondition', 'That membership is not in a removed state.');
      }
      tx.set(
        targetRef,
        {
          membershipStatus: MEMBERSHIP_ACTIVE,
          reinstatedAt: FieldValue.serverTimestamp(),
          reinstatedByUid: uid,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    return { groupId, targetUid, membershipStatus: MEMBERSHIP_ACTIVE };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// D7 — the last-Champion case. RESOLUTION CHOSEN: designate.
//
// From the source: wsfCreateCommunity writes role 'foundingChampion' and
// wsfJoinCommunity writes role 'member'; before this packet no callable
// promoted anyone, so a second Champion could not exist at all.
//
// "Block" alone would have left a sole Champion permanently unable to leave,
// which is a trap rather than a resolution. So designation is the mechanism and
// the block is its enforcement: the departure and removal paths above refuse
// while the community would be left with zero Champions, and this callable is
// how that is resolved. It reuses the existing foundingChampion role rather
// than inventing an authority tier.
// ─────────────────────────────────────────────────────────────────────────────

export const wsfDesignateChampion = onCall<MembershipActionRequest>(
  { region: 'us-central1' },
  async (request): Promise<MembershipActionResponse & { role: string }> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const uid = request.auth.uid;
    const groupId = normalizeStringId(request.data?.groupId);
    const targetUid = normalizeStringId(request.data?.targetUid);
    if (!groupId) throw new HttpsError('invalid-argument', 'groupId is required.');
    if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid is required.');
    if (targetUid === uid) {
      throw new HttpsError('failed-precondition', 'You are already a Champion of this community.');
    }

    const db = getFirestore();
    await db.runTransaction(async (tx) => {
      await requireChampion(tx, groupId, uid);
      const targetRef = db.doc(`wsfMemberships/${groupId}_${targetUid}`);
      const targetSnap = await tx.get(targetRef);
      if (!targetSnap.exists) notFound();
      const target = targetSnap.data() as { role?: string; membershipStatus?: string };
      if (target.membershipStatus !== MEMBERSHIP_ACTIVE) {
        throw new HttpsError('failed-precondition', 'That person is not an active member.');
      }
      if (target.role === 'foundingChampion') {
        throw new HttpsError('failed-precondition', 'That person is already a Champion.');
      }
      tx.set(
        targetRef,
        {
          role: 'foundingChampion',
          designatedAt: FieldValue.serverTimestamp(),
          designatedByUid: uid,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    return { groupId, targetUid, membershipStatus: MEMBERSHIP_ACTIVE, role: 'foundingChampion' };
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
// A warm instance on wsfCheckIn is intentional IN PRODUCTION. A cold start
// between someone's tap and their number moving is the one latency that
// matters at the event. It is resolved per project at deploy time — one warm
// instance on `goarrive`, none anywhere else — because a warm instance bills
// continuously and a staging project has no event to be fast for. See
// checkInMinInstances at the declaration.
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
  // Map.set on a live key keeps its position; delete first so a re-set
  // entry moves to the tail and the insertion-order eviction stays LRU.
  pulseCache.delete(challengeId);
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
/**
 * PACKAGE E. `totals` is the challenge's CURRENT shared community state, so it
 * is optional for the same reason wsfContribute's shared fields are: the
 * check-in replay branch returns before the membership gate, so a removed
 * member replaying a valid code used to receive current totals.
 *
 * `alreadyCheckedIn` is about the caller's own action and is always returned.
 * There is no display-authorization escape here — Package E deliberately did
 * not invent a publication model for the legacy challenge aggregate, so the
 * only thing that entitles a caller to these totals is active membership.
 */
type CheckInResponse = {
  alreadyCheckedIn: boolean;
  totals?: PulseTotals;
};

function normalizeCheckInCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return null;
  return trimmed;
}

/**
 * How many instances wsfCheckIn keeps warm, decided per PROJECT at deploy time.
 *
 * Production keeps one warm, for the reason in the E3 header: a cold start on
 * this callable is the one latency anybody sees at the event. Staging keeps
 * none, because a warm instance bills continuously and a staging project has
 * no event to be fast for.
 *
 * `projectID` is firebase-functions' OWN built-in parameter — Manus supplies
 * no extra environment variable for this. It resolves from whatever `--project`
 * the deploy targets, and `.thenElse` compiles to a CEL expression that
 * Firebase evaluates while it is DISCOVERING and preparing the function, so
 * the right value is baked into the deployment rather than decided later at
 * request time.
 *
 * Scoped deliberately to this one function. There is no global scaling
 * override here, and no other WSF function sets a positive minimum.
 */
const PRODUCTION_PROJECT_ID = 'goarrive';
const checkInMinInstances = projectID.equals(PRODUCTION_PROJECT_ID).thenElse(1, 0);

export const wsfCheckIn = onCall<CheckInRequest>(
  { region: 'us-central1', minInstances: checkInMinInstances },
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
    const { alreadyCheckedIn, goalTarget, callerIsActiveMember } = await db.runTransaction(
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
          // Idempotent as before — no write. It now also reports whether the
          // caller is still an active member, so the handler can decide
          // whether they may be told where the challenge stands now.
          const replayMembership = membershipSnap.exists
            ? (membershipSnap.data() as { membershipStatus?: string })
            : null;
          return {
            alreadyCheckedIn: true as const,
            goalTarget: gt,
            callerIsActiveMember: replayMembership?.membershipStatus === 'active',
          };
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
        // Reached only past the active-membership gate above.
        return { alreadyCheckedIn: false as const, goalTarget: gt, callerIsActiveMember: true };
      }
    );

    if (!callerIsActiveMember) {
      // A removed member replaying a check-in. Their own check-in is
      // acknowledged honestly; the challenge's current standing is not
      // disclosed, and readChallengeTotals is not called.
      return { alreadyCheckedIn };
    }

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

    // AUTHORIZATION BEFORE CACHE. The cache used to be consulted first, which
    // was correct while these totals were genuinely public and is a hole now.
    // Two ways it leaked: a cached entry would be handed to an unauthenticated
    // caller with the membership check never running, and — because the key is
    // the challengeId alone — to an active member of a DIFFERENT community who
    // happened to hold this challenge's id.
    //
    // So the cache moved below the membership check entirely. It still saves
    // the expensive part (readChallengeTotals is ~13 document reads); it no
    // longer saves the decision about who is asking. A shared cache keyed by
    // an id can only ever be consulted once the caller is known to be entitled
    // to that id's data.
    if (!request.auth) notFound();
    const callerUid = request.auth.uid;

    const ip = extractIp(request.rawRequest as any);
    await enforcePreviewRateLimit(ip, now);

    // PACKAGE E. This read was anonymous, and its authorization was an
    // accident: it fetches the group document but casts it to { isSample } and
    // checks only that, so joinPolicy never entered into it. A 'public'
    // community and a 'private' one were treated identically, and possession
    // of a challengeId was permission.
    //
    // It is now an ACTIVE-MEMBER read, following wsfListGoals. No second
    // anonymous-publication model is invented here: the per-goal authorization
    // Package E introduces is for GOALS, and extending it to the legacy
    // challenge model would be deciding a publication policy nobody approved.
    // If a FitLife requirement genuinely needs legacy challenge aggregates
    // shown anonymously, that is a separate compatibility decision.
    //
    // Transport stays invoker:'public' — unchanged, and not the boundary.
    const db = getFirestore();
    const challengeSnap = await db.doc(`wsfChallenges/${challengeId}`).get();
    if (!challengeSnap.exists) notFound();
    const challenge = challengeSnap.data() as ChallengeDoc;

    const membershipSnap = await db
      .doc(`wsfMemberships/${challenge.groupId}_${callerUid}`)
      .get();
    if (!membershipSnap.exists) notFound();
    if ((membershipSnap.data() as { membershipStatus?: string }).membershipStatus !== 'active') {
      notFound();
    }

    const groupSnap = await db
      .doc(`wsfCommunityGroups/${challenge.groupId}`)
      .get();
    if (!groupSnap.exists) notFound();
    const group = groupSnap.data() as { isSample?: boolean };
    if (group.isSample === true) {
      // §5.8 — sample data must never surface in a total presented as real.
      notFound();
    }

    const cached = pulseCacheGet(challengeId, now);
    if (cached) return cached;

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
  /**
   * THE TARGET-CROSSING EVENT. Written exactly once, by the wsfContribute
   * transaction that moved the shared total from below `target` to at or
   * beyond it, and never written again by anything in this file.
   *
   * These three fields are a HISTORICAL RECORD of a moment, not a live state.
   * "Is this goal reached right now?" stays derived from the current shared
   * total against the current target (isReached on the client, progressPhase
   * on every surface) — so a later downward correction, or a raised target,
   * honestly makes the live state false again while the event stays as what
   * happened. They are separate facts and are never collapsed into one.
   *
   * THE RULE, stated once (see wsfContribute and wsfAdjustGoal):
   *   • wsfContribute writes them only when `reachedAt` is absent AND the
   *     total it is committing moves from below target to >= target.
   *   • Nothing overwrites them: overshoot, later contributions, corrections,
   *     target changes and closure all leave them exactly as written.
   *   • Nothing in this package clears them, so a second event can never be
   *     emitted for a goal that already carries one. A goal whose total dips
   *     below target and crosses again reports the FIRST crossing, which is
   *     the one that happened; claiming a second "first time" would be false.
   *
   * `reachedAttemptId` is the attemptId of the crossing attempt — enough to
   * identify the attempt for the member replaying it (the contribution key is
   * goal + uid + attemptId, and only that member can present that uid). No
   * uid is stored here: the shared display must not be able to name a person.
   */
  reachedAt?: FirebaseFirestore.Timestamp;
  reachedAttemptId?: string;
  reachedSharedTotal?: number;
  /**
   * Optional per-goal counting-guide override. The client keys its counting
   * guide off the goal's `unit`; when a Champion wants a different guide than
   * the unit's own words would pick, this field names it and wins.
   *
   * It carries no authority over anything recorded: the contribution count,
   * the shared total and every permission are untouched by it. Absent means
   * "derive the guide from the unit", which is what every goal written before
   * this field existed does. Nothing is backfilled.
   */
  activityGuideKey?: string;
  /**
   * PACKAGE E. Explicit permission for ONE thing: this goal's approved
   * aggregate progress may be presented through the authorized unauthenticated
   * aggregate-display path.
   *
   * It does NOT mean the community is discoverable, that anyone may join, that
   * member information or individual contributions are public, that future
   * goals are authorized, or that the goal may be used for unrelated public
   * proof. Those are separate concepts and none of them implies this one.
   *
   * Optional on purpose: absent means false. Existing goals were written
   * before this field existed and must behave exactly as unauthorized, so
   * nothing is backfilled and every read goes through
   * isAggregateDisplayAuthorized() rather than reading the field directly.
   */
  aggregateDisplayAuthorized?: boolean;
  aggregateDisplayAuthorizedAt?: FirebaseFirestore.Timestamp;
  aggregateDisplayAuthorizedBy?: string;
};

/**
 * The ONLY way this package asks "may this goal's aggregate be displayed?".
 *
 * Absent, false, null, and any non-boolean all mean no. Written as an explicit
 * `=== true` so a truthy-but-wrong value (a string "false", say, from a hand
 * edit or an import) can never authorize publication.
 */
function isAggregateDisplayAuthorized(goal: Pick<GoalDoc, 'aggregateDisplayAuthorized'>): boolean {
  return goal.aggregateDisplayAuthorized === true;
}

/**
 * THE single policy for "may this caller be told this goal's CURRENT shared
 * state?". Every path that can disclose it calls this — the display read and
 * the contribution replay both — so a second path cannot quietly apply a
 * weaker rule than the first.
 *
 * It exists because they HAD diverged: wsfGoalPulse required the community to
 * exist and refused a sample community, while the replay path checked only
 * membership-or-authorization. A non-member replaying an authorized goal in a
 * sample community would have received state the display itself refuses.
 *
 * Two independent routes, neither implying the other:
 *   asMember  — an active member of the goal's community. The member
 *               experience does not depend on publication, and is not subject
 *               to the sample suppression: a sample community's own members
 *               are looking at their own community.
 *   asDisplay — the goal carries an explicit aggregateDisplayAuthorized, the
 *               community exists, and it is not sample data. §5.8: sample data
 *               may never surface in a total presented as real to an outside
 *               audience.
 */
type GoalAggregateAccess = {
  asMember: boolean;
  asDisplay: boolean;
  allowed: boolean;
  /**
   * The owning community's displayName, read from the community document
   * whenever a route to the aggregate is open. Null when the document is
   * missing or carries no usable name — a caller may then still be `allowed`
   * to the totals by membership, but the pulse refuses rather than publish
   * mismatched context (see wsfGoalPulse).
   */
  communityDisplayName: string | null;
};

async function evaluateGoalAggregateAccess(
  goal: Pick<GoalDoc, 'communityGroupId' | 'aggregateDisplayAuthorized'>,
  callerUid: string | null
): Promise<GoalAggregateAccess> {
  const db = getFirestore();

  // A goal whose community reference is not a usable id (a corrupt or
  // hand-edited document) opens no route at all. Without this, an empty
  // reference makes the path builder below throw, and that surfaces to the
  // caller as `internal` — a distinguishable answer for a goal that exists.
  const groupId = normalizeStringId(goal.communityGroupId);
  if (!groupId) {
    return { asMember: false, asDisplay: false, allowed: false, communityDisplayName: null };
  }

  let asMember = false;
  if (callerUid) {
    const membershipSnap = await db
      .doc(`wsfMemberships/${groupId}_${callerUid}`)
      .get();
    asMember =
      membershipSnap.exists &&
      (membershipSnap.data() as { membershipStatus?: string }).membershipStatus === 'active';
  }

  // The community document is read only once a route to the aggregate may be
  // open (an active member, or an explicitly authorized goal). It answers two
  // questions: sample suppression for the display route, and the one context
  // field that lives on the community — its display name. Nothing else on
  // the document is read or returned.
  let asDisplay = false;
  let communityDisplayName: string | null = null;
  if (asMember || isAggregateDisplayAuthorized(goal)) {
    const groupSnap = await db.doc(`wsfCommunityGroups/${groupId}`).get();
    const group = groupSnap.exists
      ? (groupSnap.data() as { isSample?: boolean; displayName?: unknown })
      : null;
    if (group && typeof group.displayName === 'string' && group.displayName.trim() !== '') {
      communityDisplayName = group.displayName;
    }
    if (isAggregateDisplayAuthorized(goal)) {
      asDisplay = group !== null && group.isSample !== true;
    }
  }

  return { asMember, asDisplay, allowed: asMember || asDisplay, communityDisplayName };
}

/**
 * The aggregate-display response. PACKAGE E removed `contributorCount`: it
 * had no approved public-display purpose, and it was being returned by
 * inertia rather than by decision. Nothing replaces it — a substitute metric
 * would be the same unapproved disclosure under another name.
 *
 * CHECKPOINT C (owner publication decision, 2026-09-18): a Champion's
 * per-goal public-display authorization also permits the display to name
 * what it is showing. Exactly five context fields join the four aggregate
 * fields: the owning community's display name, the goal's title, its window
 * (ISO instants, as wsfListGoals already serializes them) and its stored time
 * zone. Every allowed caller — member route or display route — receives the
 * same shape, so one cache entry per goal is complete for everyone entitled
 * to it.
 *
 * Deliberately NOT here, and not authorized by that decision: member names,
 * photos, member or contributor counts, individual contributions, own-credit
 * records, contact details, locations, group type, join policy, join code,
 * Champion or creator identity, organization information, invitation
 * capabilities. Authorization of one goal publishes nothing about any other.
 */
type GoalPulseTotals = {
  sharedTotal: number;
  target: number;
  unit: string;
  status: GoalStatus;
  communityDisplayName: string;
  goalTitle: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
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

// countGoalContributors was removed with PACKAGE E. It existed only to fill
// `contributorCount` in the anonymous aggregate response, which has no approved
// public-display purpose. The function is gone rather than left unused, so the
// number cannot be quietly reintroduced by a later caller finding a helper
// already sitting there.

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
  // Same as pulseCacheSet: delete before set so eviction order stays LRU.
  goalPulseCache.delete(goalId);
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

/**
 * Optional per-goal counting-guide key. Same shape and same 40-char ceiling as
 * the unit it stands in for — it is a key into the client's guide table, not
 * prose, so it is stored trimmed and verbatim and the client normalizes it
 * (lowercase, plural/synonym folding) exactly as it normalizes a unit. An
 * unknown key is not an error here: the client falls back to the unit.
 *
 * Returns undefined when the caller sent nothing, null when they sent
 * something unusable — the two are different answers to the callable.
 */
function normalizeActivityGuideKey(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (trimmed.length < 1 || trimmed.length > 40) return null;
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
  activityGuideKey?: unknown; // optional counting-guide override, 1..40 chars
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
    // Optional. Omitting it is the ordinary case and writes no field at all,
    // so a goal without an override is byte-identical to one created before
    // this argument existed.
    const activityGuideKey = normalizeActivityGuideKey(request.data?.activityGuideKey);
    if (activityGuideKey === null) {
      throw new HttpsError(
        'invalid-argument',
        'activityGuideKey, when provided, must be 1..40 chars; no ASCII control characters.'
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
        ...(activityGuideKey === undefined ? {} : { activityGuideKey }),
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

/**
 * PACKAGE E. The four fields describing CURRENT SHARED COMMUNITY STATE are
 * optional because a caller may be entitled to the first three and not to
 * them.
 *
 * addedCount, ownCredit and alreadyRecorded are about the CALLER'S OWN
 * contribution. They are returned to whoever made it, including someone who
 * has since been removed — a person's own history is theirs, and that is the
 * same position wsfMyContribution already takes.
 *
 * sharedTotal, target, unit and status are the community's current state.
 * They are returned only to an active member, or to anyone when the goal is
 * explicitly display-authorized (in which case they are public anyway). A
 * removed member replaying a valid attemptId used to receive all four, read
 * fresh, because the replay branch returned before the membership check ever
 * ran. That is the hole this closes.
 */
type ContributeResponse = {
  addedCount: number;
  ownCredit: number;
  alreadyRecorded: boolean;
  sharedTotal?: number;
  target?: number;
  unit?: string;
  status?: GoalStatus;
  /**
   * TRUE on exactly one attempt per goal: the one whose transaction moved the
   * shared total from below the target to at or beyond it. Stored on that
   * attempt's contribution document, so a replay of the SAME attemptId
   * returns the same answer forever and no other attempt can ever be told it
   * crossed — not an overshoot, not a concurrent attempt that lost the race,
   * not a contribution after a correction dropped the total back down.
   *
   * It sits with the current-shared-state fields, not with the caller's own
   * three, because "the community's total reached its target" is a fact about
   * the community. A caller who may not be told where the community stands is
   * not told this either; their own receipt (addedCount, ownCredit,
   * alreadyRecorded) is unchanged and still true.
   */
  crossedTarget?: boolean;
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
    const {
      addedCount,
      alreadyRecorded,
      crossedTarget,
      goalTarget,
      goalUnit,
      goalStatus,
      callerIsActiveMember,
      goalDisplayAuthorized,
      goalCommunityGroupId,
    } =
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
            crossedTarget?: boolean;
          };
          // The key is scoped by uid, so an existing doc IS this caller's own
          // earlier attempt. If storage ever disagreed that would be corruption,
          // not a caller-observable state: refuse rather than leak a count.
          if (prev.userId !== uid) {
            throw new HttpsError('internal', 'Contribution record mismatch.');
          }
          // Idempotency is untouched: this returns without writing, so the
          // attempt is still counted exactly once. What changed is that the
          // branch now reports whether the caller is STILL an active member,
          // so the handler below can decide what they may be told. Deciding
          // that here would mean reading shared state before knowing whether
          // it may be disclosed.
          const replayMembership = membershipSnap.exists
            ? (membershipSnap.data() as { membershipStatus?: string })
            : null;
          return {
            addedCount: typeof prev.count === 'number' ? prev.count : 0,
            alreadyRecorded: true as const,
            // Read from the ATTEMPT, never recomputed. The stored outcome is
            // what this attempt did when it landed; recomputing it from the
            // current total would let a replay claim a crossing someone else
            // made, or deny one this attempt really made after a correction.
            // An attempt recorded before this field existed carries no value
            // and is reported as false — it is not evidence of a crossing.
            crossedTarget: prev.crossedTarget === true,
            goalTarget: goal.target,
            goalUnit: goal.unit,
            goalStatus: goal.status,
            callerIsActiveMember: replayMembership?.membershipStatus === 'active',
            goalDisplayAuthorized: isAggregateDisplayAuthorized(goal),
            goalCommunityGroupId: goal.communityGroupId,
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

        //   4. THE TARGET-CROSSING EVENT, decided here and nowhere else.
        //
        // The shared total lives in shards, so "did THIS contribution move us
        // from below the target to at or beyond it?" can only be answered by
        // reading the shards inside this transaction — the same read
        // wsfAdjustGoal already performs. Doing it after the transaction
        // would be an inference from a total that may already contain someone
        // else's work, which is exactly the misattribution this replaces.
        //
        // The read is skipped entirely once `reachedAt` exists, so the goal
        // pays the ten-document read (and the contention that comes with it)
        // only while the crossing is still ahead of it. Afterwards every
        // contribution keeps the cheap single-shard write it has today.
        //
        // CONCURRENCY. Two attempts that together cross both read the shards
        // in their own transaction and one of them writes a shard the other
        // read, so Firestore aborts and retries the loser. The retry re-reads
        // the committed total and the committed `reachedAt`, finds the goal
        // already crossed, and records `crossedTarget: false`. Exactly one
        // attempt is ever told it crossed, and it is the one whose
        // transaction actually committed the crossing.
        let crossed = false;
        let crossingSharedTotal = 0;
        if (goal.reachedAt == null) {
          const shardSnaps = await Promise.all(
            Array.from({ length: GOAL_SHARD_COUNT }, (_, i) =>
              tx.get(goalShardRef(goalId, i))
            )
          );
          const previousSharedTotal = shardSnaps.reduce((sum, snap) => {
            const data = snap.data() as { count?: number } | undefined;
            return sum + (typeof data?.count === 'number' ? data.count : 0);
          }, 0);
          const nextSharedTotal = previousSharedTotal + count;
          // A crossing is a MOVE across the line: strictly below before, at or
          // beyond after. A goal already at or beyond its target when this
          // field was introduced (or after an upward correction) never crossed
          // while anyone was watching, so no attempt is credited with a moment
          // that did not happen. A non-positive target has no line to cross.
          if (
            goal.target > 0 &&
            previousSharedTotal < goal.target &&
            nextSharedTotal >= goal.target
          ) {
            crossed = true;
            crossingSharedTotal = nextSharedTotal;
          }
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
          // Part of the attempt's stored outcome, exactly like `count`: a
          // replay reports it rather than deciding it again.
          crossedTarget: crossed,
          createdAt: FieldValue.serverTimestamp(),
        });
        if (crossed) {
          // update(), not set(merge) — the goal document must already exist
          // (it was read above) and the three fields are written together or
          // not at all. No other field of the goal is touched.
          tx.update(goalRef, {
            reachedAt: FieldValue.serverTimestamp(),
            reachedAttemptId: attemptId,
            reachedSharedTotal: crossingSharedTotal,
          });
        }
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

        // Reached only after the active-membership gate above, so this caller
        // is an active member by construction.
        return {
          addedCount: count,
          alreadyRecorded: false as const,
          crossedTarget: crossed,
          goalTarget: goal.target,
          goalUnit: goal.unit,
          goalStatus: goal.status,
          callerIsActiveMember: true,
          goalDisplayAuthorized: isAggregateDisplayAuthorized(goal),
          goalCommunityGroupId: goal.communityGroupId,
        };
      });

    // May this caller be told the community's CURRENT shared state? Decided by
    // evaluateGoalAggregateAccess — the SAME policy wsfGoalPulse uses — so a
    // replay can never bypass a restriction the display path enforces. It
    // previously checked only membership-or-authorization, which meant a
    // non-member replaying an authorized goal in a SAMPLE community received
    // state the display itself refuses.
    //
    // The caller's own receipt is decided separately below and is not subject
    // to this: addedCount, ownCredit and alreadyRecorded are theirs.
    const { allowed: maySeeCurrentSharedState } = await evaluateGoalAggregateAccess(
      {
        communityGroupId: goalCommunityGroupId,
        aggregateDisplayAuthorized: goalDisplayAuthorized ? true : undefined,
      },
      callerIsActiveMember ? uid : null
    );

    // Their own credit is theirs either way, and is read for both cases. It is
    // derived from their own uid, never from anyone else's row.
    const ownCreditSnap = await memberTotalRef.get();
    const ownCredit =
      (ownCreditSnap.data() as { total?: number } | undefined)?.total ?? 0;

    if (!maySeeCurrentSharedState) {
      // A removed member replaying a valid attempt. They keep the honest
      // answer about their own contribution — it happened, it counted once,
      // here is what it was — and learn nothing about where the community
      // stands now. sumGoalShards is not even called, and `crossedTarget` is
      // withheld with the rest: whether the community's total reached its
      // target is the community's state, and this caller is not entitled to
      // it. Nothing false is said; a fact they may not see is not shown.
      return { addedCount, ownCredit, alreadyRecorded };
    }

    const sharedTotal = await sumGoalShards(goalId);

    return {
      addedCount,
      ownCredit,
      sharedTotal,
      target: goalTarget,
      unit: goalUnit,
      status: goalStatus,
      alreadyRecorded,
      crossedTarget,
    };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// wsfGoalPulse — the AUTHORIZED unauthenticated aggregate-display read.
//
// PACKAGE E. This callable used to return a goal's shared total to anyone who
// held its id: no auth, no membership, no visibility check. Possession of a
// goalId was, in effect, permission — which meant a private community's
// progress was readable by a stranger who had seen the id once, and a removed
// member kept reading it after removal.
//
// It is now gated on ONE thing: the goal itself carries an explicit
// aggregateDisplayAuthorized, set deliberately by a Champion of that goal's
// community. Nothing else grants it. Not the community's joinPolicy, not
// discoverability, not membership, not the goal's lifecycle, not isSample, and
// not the fact that a display is what is asking.
//
// The refusal is the byte-identical not-found an unknown id gets, following
// wsfPreviewCommunity and wsfListGoals: an unauthorized goal and a goal that
// does not exist must be indistinguishable, or this becomes an oracle for
// which ids are real.
//
// Transport stays public on purpose. The Cloud Run invoker is not the
// authorization boundary; this handler is. A publicly reachable endpoint that
// returns nothing without authorization is the intended shape.
//
// The 2s per-instance cache is kept, and is keyed by goalId AFTER the
// authorization check, so a cached entry can only ever exist for a goal that
// was authorized when it was cached — see the revocation note below.
// ─────────────────────────────────────────────────────────────────────────────

type GoalPulseRequest = { goalId?: unknown };

export const wsfGoalPulse = onCall<GoalPulseRequest>(
  { region: 'us-central1', invoker: 'public' },
  async (request): Promise<GoalPulseTotals> => {
    const goalId = normalizeStringId(request.data?.goalId);
    if (!goalId) {
      throw new HttpsError('invalid-argument', 'goalId is required.');
    }

    const db = getFirestore();
    const goalSnap = await db.doc(`wsfGoals/${goalId}`).get();
    if (!goalSnap.exists) notFound();
    const goal = goalSnap.data() as GoalDoc;

    // THE GATE — two independent routes to the same aggregate, which is the
    // whole model: membership permits the member experience, per-goal
    // authorization permits the display experience, and neither implies the
    // other.
    //
    //   1. An ACTIVE MEMBER of this goal's community. This is the member
    //      experience — the contribution screen polls here so a peer's
    //      contribution surfaces — and it does not depend on the goal being
    //      authorized for public display. A member of a private community
    //      that publishes nothing still sees their own community's progress.
    //   2. ANYONE, when the goal itself carries an explicit
    //      aggregateDisplayAuthorized. This is the display route.
    //
    // Read before the cache is consulted, so a revocation takes effect on the
    // next read rather than lingering for the cache TTL, and so a cached entry
    // can never stand in for the decision. That costs a document read per
    // poll and is the right trade: a Champion who revokes expects it revoked,
    // not revoked in two seconds.
    const access = await evaluateGoalAggregateAccess(goal, request.auth?.uid ?? null);
    if (!access.allowed) notFound();

    // Context is published only complete and only server-authoritative: the
    // community name from the community document, the title, window and time
    // zone from the goal document. A missing community document or an
    // unusable value refuses (the same generic not-found) rather than serving
    // a display that names half of what it shows. Nothing here is taken from
    // the request.
    if (!access.communityDisplayName) notFound();
    const goalTitle = typeof goal.title === 'string' ? goal.title.trim() : '';
    // The same IANA normalization goal creation applies: an unusable stored
    // zone is never published as if it were authoritative.
    const timezone = normalizeIanaTimezone(goal.timezone) ?? '';
    const startsAt = goal.startsAt?.toDate?.();
    const endsAt = goal.endsAt?.toDate?.();
    if (!goalTitle || !timezone || !startsAt || !endsAt) notFound();

    // The cache is keyed by goalId, so it may only be consulted once the
    // caller is known to be entitled to that goal's aggregate. Both routes
    // above yield the identical, complete response, so one shared entry is
    // correct: a display can never be served a member-shaped entry missing
    // its context, and an unentitled caller never reaches the lookup.

    // Stamped when the cache is consulted, after the access reads: a slow
    // read must not stretch an entry's freshness past the TTL the display's
    // poll is matched to.
    const now = Date.now();
    const cached = goalPulseCacheGet(goalId, now);
    if (cached) return cached;

    // contributorCount is deliberately not computed. It is not in the response
    // and countGoalContributors is not called on this path.
    const sharedTotal = await sumGoalShards(goalId);
    const totals: GoalPulseTotals = {
      sharedTotal,
      target: goal.target,
      unit: goal.unit,
      status: goal.status,
      communityDisplayName: access.communityDisplayName,
      goalTitle,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      timezone,
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

type MyContributionResponse = {
  ownCredit: number;
  unit: string;
  // Optional per-goal counting-guide override, present only when the goal
  // carries one. It rides this authenticated member-only read rather than
  // wsfGoalPulse, whose nine-field authorized display payload is fixed.
  activityGuideKey?: string;
};

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
    if (!goalSnap.exists) notFound();
    const goal = goalSnap.data() as GoalDoc;

    // PACKAGE E. This used to answer ANY authenticated caller, so a signed-in
    // stranger holding a goalId learned that the goal existed and what its
    // unit was — an enumeration surface on a protected goal, reached through
    // the own-credit endpoint rather than the display one.
    //
    // Two legitimate readers, and the rule keeps both:
    //   1. An ACTIVE MEMBER, who may see their own zero before they have
    //      contributed anything.
    //   2. ANYONE WITH THEIR OWN RECORD here, including a former member. The
    //      test is that the totals document EXISTS, not that it is positive —
    //      a correction that zeroes someone's total must never erase their
    //      legitimate history, and their own past contribution stays theirs.
    //
    // Everyone else gets the non-enumerating answer an unknown goal gets.
    // Membership is not required to keep what is yours, and having something
    // of your own here is not membership.
    const hasOwnRecord = memberSnap.exists;
    let isActiveMember = false;
    if (!hasOwnRecord) {
      const membershipSnap = await db
        .doc(`wsfMemberships/${goal.communityGroupId}_${uid}`)
        .get();
      isActiveMember =
        membershipSnap.exists &&
        (membershipSnap.data() as { membershipStatus?: string }).membershipStatus === 'active';
    }
    if (!hasOwnRecord && !isActiveMember) notFound();

    const total =
      (memberSnap.data() as { total?: number } | undefined)?.total ?? 0;
    // Only ever a non-empty string; a legacy or malformed value is simply not
    // published and the client derives the guide from the unit.
    const activityGuideKey =
      typeof goal.activityGuideKey === 'string' && goal.activityGuideKey.trim() !== ''
        ? goal.activityGuideKey.trim()
        : undefined;
    return {
      ownCredit: total,
      unit: goal.unit,
      ...(activityGuideKey === undefined ? {} : { activityGuideKey }),
    };
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
//
// THE TARGET-CROSSING EVENT IS NOT TOUCHED HERE, in either direction, and
// that is the whole rule (see GoalDoc.reachedAt):
//   • A correction that drops the total back below the target does NOT clear
//     `reachedAt`. The live "reached" state is derived from the current total
//     and honestly becomes false again; the event stays as the record of a
//     moment that did happen. Two different facts, both kept.
//   • A correction that pushes the total past the target does NOT create an
//     event. A crossing is something a member's contribution did; an
//     accounting correction is not that, and no attempt exists to credit.
//   • Because nothing here clears the field, a later contribution that
//     crosses the target a second time emits nothing. The goal keeps the
//     first crossing, which is the one that happened.
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
// `includeHistory: true` is the ONE documented departure, and it departs only
// for the caller who asks: the response then also carries every closed goal of
// the community (bounded to the most recent 50 by endsAt) regardless of
// display authorization, and each goal gains sharedTotal, timezone and
// closedAt. Still no member identity, no per-member credit, no contributor
// list, no counts — a record of what the community did is not a record of who
// did it. The shared total's eligibility question is not reopened either: the
// flag is reachable only through the active-membership gate below, which is
// the same `asMember` route wsfGoalPulse already grants the same caller for
// the same goals. Absent or false — or any non-boolean value — the response is
// byte-for-byte what it has always been, so existing clients and the hosted
// staging harness are untouched.
//
// INDEX EXPECTATION, not an unconditional claim: the query filters on
// `communityGroupId ==` and `status ==` with no range, no inequality and no
// orderBy, so it is expected to be served by Firestore's automatic
// single-field indexes, which can be merged for conjunctions of equality
// filters. `firestore.indexes.json` is deliberately untouched. Note that the
// emulator does NOT enforce compound-index requirements, so an emulator pass
// cannot verify production index readiness — that is a deploy-time check.
// ─────────────────────────────────────────────────────────────────────────────

type ListGoalsRequest = { groupId?: unknown; includeHistory?: unknown };

type ListedGoal = {
  goalId: string;
  title: string;
  target: number;
  unit: string;
  status: GoalStatus;
  startsAt: string;
  endsAt: string;
  aggregateDisplayAuthorized: boolean;
  /**
   * When this goal's shared total first crossed its target, as an ISO instant;
   * null for a goal that never has. A MEMBER-AUTHORIZED field: this callable
   * refuses everyone who is not an active member of the community, so the date
   * travels with the member experience and nowhere else. It is deliberately
   * NOT on wsfGoalPulse — the public aggregate contract is fixed at nine
   * fields and a publication decision for the total is not a publication
   * decision for the community's history.
   *
   * It names no person and carries no attempt id. "WE reached it on this day"
   * is the whole of it.
   */
  reachedAt: string | null;
};

/**
 * The extra facts a goal carries ONLY when the caller asked for history.
 *
 * Written as an intersection rather than as fields on `ListedGoal` so the
 * default response is provably untouched: every existing caller, and the
 * hosted staging harness, sees exactly the keys it saw before.
 *
 * `sharedTotal` and `timezone` are here because the history list has to STATE
 * a result — "Reached", or "Closed at 62.4%", over the goal's own window in
 * the goal's own zone — and a result nobody can compute is not a history.
 * They disclose nothing new: the caller is an active member of the goal's
 * community, which is exactly the `asMember` route wsfGoalPulse already grants
 * for these same goals. This is the same person reading the same numbers in
 * one round trip instead of one per goal. It is NOT a widening of who may
 * know: the fields appear only on the member-gated history request, and the
 * unauthenticated aggregate-display path is untouched.
 *
 * `closedAt` is the only lifecycle marker the goal document actually carries —
 * there is no stored `reachedAt` — and it is passed through as written.
 * Whether a goal was REACHED is derived from sharedTotal against target by the
 * shared presentation helpers, so the server states no verdict the totals do
 * not support.
 */
type GoalHistoryFields = {
  sharedTotal: number;
  timezone: string;
  closedAt: string | null;
};

type ListedGoalWithHistory = ListedGoal & GoalHistoryFields;

type ListGoalsResponse = { goals: Array<ListedGoal | ListedGoalWithHistory> };

/**
 * The most recent CLOSED goals a history request may carry. Active goals are
 * not bounded — they are what the community is doing now, and there are few.
 */
const GOAL_HISTORY_LIMIT = 50;

/**
 * Shard totals for several goals in one pass. sumGoalShards issues its own
 * getAll per goal, which for a 50-goal history would be 50 round trips; this
 * batches the same reads (ten shards a goal) into chunks the Admin SDK is
 * comfortable with. The arithmetic is identical — absent or non-numeric shard
 * counts contribute nothing.
 */
async function sumGoalShardsForMany(goalIds: string[]): Promise<Map<string, number>> {
  const db = getFirestore();
  const totals = new Map<string, number>();
  for (const goalId of goalIds) totals.set(goalId, 0);

  const refs: Array<{ goalId: string; ref: FirebaseFirestore.DocumentReference }> = [];
  for (const goalId of goalIds) {
    for (let i = 0; i < GOAL_SHARD_COUNT; i++) {
      refs.push({ goalId, ref: db.doc(`wsfGoalCounters/${goalId}/shards/${i}`) });
    }
  }

  const CHUNK = 300;
  for (let start = 0; start < refs.length; start += CHUNK) {
    const chunk = refs.slice(start, start + CHUNK);
    const snaps = await db.getAll(...chunk.map((r) => r.ref));
    snaps.forEach((snap, i) => {
      const data = snap.data() as { count?: number } | undefined;
      if (typeof data?.count === 'number') {
        const goalId = chunk[i]!.goalId;
        totals.set(goalId, (totals.get(goalId) ?? 0) + data.count);
      }
    });
  }
  return totals;
}

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

    // STRICTLY `true`. Absent, false, null, a string, a number — anything that
    // is not the boolean true — leaves the caller on today's behaviour and
    // today's exact response, so a coerced or hand-edited value can never
    // silently change the shape a deployed client is parsing. No new error
    // path either: an unrecognised value is not a request for history.
    const includeHistory = request.data?.includeHistory === true;

    // Equality-only. A goal that has reached or passed its target is still
    // `active` until it is closed, so it stays in this list — reaching the
    // target is a reason to celebrate on the page, never a reason for the goal
    // to disappear from under the people still contributing to it.
    // Two equality-only queries. PACKAGE E adds the second: a goal that is no
    // longer active but is STILL display-authorized has to stay reachable, or
    // "survives closure but remains revocable" is only true of the callable
    // and not of the product — the Champion would have no way to turn it off.
    //
    // Equality-only on both, so Firestore serves them from single-field
    // indexes and no composite index is introduced. firestore.indexes.json is
    // untouched.
    //
    // `includeHistory` adds a THIRD, on the same terms: every closed goal of
    // this community, whatever its display authorization. That third query is
    // the whole point of the flag. Community Home's history was built on the
    // first two, so a goal that closed without ever being authorized — or
    // whose authorization was revoked — vanished from the community's past,
    // and a publication decision decided what the members were allowed to
    // remember. It is equality-only like the others; no composite index and no
    // change to firestore.indexes.json.
    const [activeSnap, authorizedSnap, closedSnap] = await Promise.all([
      db
        .collection('wsfGoals')
        .where('communityGroupId', '==', groupId)
        .where('status', '==', 'active')
        .get(),
      db
        .collection('wsfGoals')
        .where('communityGroupId', '==', groupId)
        .where('aggregateDisplayAuthorized', '==', true)
        .get(),
      includeHistory
        ? db
            .collection('wsfGoals')
            .where('communityGroupId', '==', groupId)
            .where('status', '==', 'closed')
            .get()
        : Promise.resolve(null),
    ]);

    const byId = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    for (const d of activeSnap.docs) byId.set(d.id, d);
    for (const d of authorizedSnap.docs) byId.set(d.id, d);
    if (closedSnap) {
      // The most recent 50 CLOSED goals by endsAt. Selected on a descending
      // sort and then added, so the bound keeps the most recent 50 rather than
      // an arbitrary 50. Goals the first two queries already admitted are never
      // dropped by it: this only ever adds, so a history request is a strict
      // superset of the same request without the flag.
      const recentClosed = closedSnap.docs
        .slice()
        .sort((a, b) => {
          const ae = (a.data() as GoalDoc).endsAt.toMillis();
          const be = (b.data() as GoalDoc).endsAt.toMillis();
          return ae === be ? a.id.localeCompare(b.id) : be - ae;
        })
        .slice(0, GOAL_HISTORY_LIMIT);
      for (const d of recentClosed) byId.set(d.id, d);
    }
    const snap = { docs: [...byId.values()] };

    // One batched shard read for the whole page of goals, only when history
    // was asked for. Without the flag nothing extra is read and nothing extra
    // is returned.
    const totals = includeHistory
      ? await sumGoalShardsForMany(snap.docs.map((d) => d.id))
      : null;

    // More than one active goal is legitimate and is NOT collapsed: separately
    // created goals stay separate, each with its own title, unit and window.
    // The client decides how to present several; this callable does not pick
    // one for it. Zero goals is an ordinary empty list, not an error — a
    // community with no goal yet is the normal state before a champion starts
    // one.
    const goals: Array<ListedGoal | ListedGoalWithHistory> = snap.docs.map((docSnap) => {
      const goal = docSnap.data() as GoalDoc;
      const listed: ListedGoal = {
        goalId: docSnap.id,
        title: goal.title,
        target: goal.target,
        unit: goal.unit,
        status: goal.status,
        startsAt: goal.startsAt.toDate().toISOString(),
        endsAt: goal.endsAt.toDate().toISOString(),
        // PACKAGE E. Members of the community may know whether their own
        // goal's aggregate is authorized for public display — arguably they
        // should. It is a property of their goal, not of anyone's identity,
        // and this callable is already active-member-gated.
        aggregateDisplayAuthorized: isAggregateDisplayAuthorized(goal),
        // The historical event, not a live "is it reached" flag: the caller
        // still derives that from the current total against the current
        // target. Absent stays absent — nothing is backfilled from a total
        // that happens to be at or beyond the target today, because that is
        // not evidence of a moment anyone lived through.
        reachedAt: goal.reachedAt ? goal.reachedAt.toDate().toISOString() : null,
      };
      // Without the flag this returns `listed` untouched, so the response is
      // byte-for-byte what it has always been.
      if (!includeHistory) return listed;
      return {
        ...listed,
        sharedTotal: totals?.get(docSnap.id) ?? 0,
        timezone: goal.timezone,
        closedAt: goal.closedAt ? goal.closedAt.toDate().toISOString() : null,
      };
    });

    // Deterministic order so the interface does not reshuffle between polls.
    // Sorted in the handler rather than with orderBy, which would add an index
    // requirement this packet is not allowed to introduce.
    goals.sort((a, b) => (a.endsAt === b.endsAt ? a.goalId.localeCompare(b.goalId) : a.endsAt.localeCompare(b.endsAt)));

    return { goals };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// wsfSetGoalDisplayAuthorization — PACKAGE E. The Champion's explicit,
// revocable permission for one goal's aggregate to appear on a public display.
//
// Deliberately its own callable rather than a field on goal creation. Making
// publication a checkbox in a creation form is how it becomes an incidental
// side effect of starting a goal; it should be a decision somebody took on
// purpose, separately, and can take back.
//
// Authority is the EXISTING community-scoped Champion authority — an active
// foundingChampion of the community that owns this goal. No global claim, no
// new role, no platform-wide publisher.
//
// It works after the goal is closed, on purpose: an authorized completed goal
// may go on supporting "what we've done" and recap presentation. Closing is not
// revocation, and revocation is not closing — they stay separate lifecycle
// concepts and this callable touches only the authorization.
// ─────────────────────────────────────────────────────────────────────────────

type SetGoalDisplayAuthorizationRequest = { goalId?: unknown; authorized?: unknown };
type SetGoalDisplayAuthorizationResponse = { goalId: string; aggregateDisplayAuthorized: boolean };

export const wsfSetGoalDisplayAuthorization = onCall<SetGoalDisplayAuthorizationRequest>(
  { region: 'us-central1' },
  async (request): Promise<SetGoalDisplayAuthorizationResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    const uid = request.auth.uid;

    const goalId = normalizeStringId(request.data?.goalId);
    if (!goalId) {
      throw new HttpsError('invalid-argument', 'goalId is required.');
    }
    // Strictly boolean. A missing or coerced value must never be read as an
    // instruction to publish.
    if (typeof request.data?.authorized !== 'boolean') {
      throw new HttpsError('invalid-argument', 'authorized must be true or false.');
    }
    const authorized = request.data.authorized;

    const db = getFirestore();

    await db.runTransaction(async (tx) => {
      const goalRef = db.doc(`wsfGoals/${goalId}`);
      const goalSnap = await tx.get(goalRef);
      // A goal that does not exist and a goal the caller has no authority over
      // are the same answer, matching wsfListGoals and wsfPreviewCommunity.
      if (!goalSnap.exists) notFound();
      const goal = goalSnap.data() as GoalDoc;

      const membershipSnap = await tx.get(
        db.doc(`wsfMemberships/${goal.communityGroupId}_${uid}`)
      );
      if (!membershipSnap.exists) notFound();
      const membership = membershipSnap.data() as { role?: string; membershipStatus?: string };
      if (membership.membershipStatus !== MEMBERSHIP_ACTIVE) notFound();
      if (membership.role !== 'foundingChampion') notFound();

      // Deliberately does NOT touch status, closedAt, or any contribution
      // record. Revoking removes the permission; it never deletes the goal or
      // its history.
      tx.set(
        goalRef,
        {
          aggregateDisplayAuthorized: authorized,
          aggregateDisplayAuthorizedAt: FieldValue.serverTimestamp(),
          aggregateDisplayAuthorizedBy: uid,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    return { goalId, aggregateDisplayAuthorized: authorized };
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
