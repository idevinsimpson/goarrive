import { createHash, randomBytes, timingSafeEqual } from 'crypto';

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

/**
 * One stored line of the recent-additions tail, held as its own document at
 * `wsfGoals/{goalId}/recentAdditions/{attemptId}`.
 *
 * A SUBCOLLECTION, NOT A FIELD ON THE GOAL. An array on the goal document
 * would have made every contribution a write to `wsfGoals/{goalId}`, which
 * serializes contributions on one document and defeats the counter sharding
 * that exists precisely so they do not contend. Each addition is now its own
 * document and contributions stay fanned out.
 *
 * THE DOCUMENT ID IS THE ATTEMPT ID, which is what makes the write idempotent
 * by construction rather than by a check: a retried transaction, or a replay
 * that somehow reached this line, writes the same id with the same content.
 *
 * `amount` is the units added; `at` is an ISO instant ROUNDED DOWN TO THE
 * MINUTE, so the stored value cannot be used to line an addition up with
 * anything else that happened at the same second. Deliberately a string, not a
 * Timestamp: it is published verbatim, its precision is part of what it is,
 * and an ISO-8601 UTC string sorts lexicographically in chronological order,
 * which is what the read below orders on.
 *
 * These two fields are the whole document. No uid, no attemptId IN the
 * document, no shard index, no member total, no ordinal.
 */
type RecentAddition = { amount: number; at: string };

const RECENT_ADDITIONS_COLLECTION = 'recentAdditions';

/**
 * Newest ten, applied on READ. The subcollection itself is not pruned — see
 * the note on wsfGoalRecentAdditions — so this is the bound on what is ever
 * published, which is the bound that matters.
 */
const RECENT_ADDITIONS_LIMIT = 10;

/** ISO instant truncated to the minute — the only precision ever stored. */
function isoMinute(ms: number): string {
  return new Date(Math.floor(ms / 60_000) * 60_000).toISOString();
}

function recentAdditionsRef(goalId: string) {
  return getFirestore()
    .collection('wsfGoals')
    .doc(goalId)
    .collection(RECENT_ADDITIONS_COLLECTION);
}

/**
 * How many times ONE member may contribute to ONE goal.
 *
 *   'once'     — a member's contribution to this goal is recorded once. A
 *                second attempt with a NEW attemptId is refused; replaying a
 *                KNOWN attemptId still returns its original receipt.
 *   'multiple' — a member may record further contributions to the same goal.
 *                Each is idempotent by its own attemptId and each accumulates
 *                into own credit and the shared total.
 *
 * Nothing is backfilled and nothing is migrated: every read goes through
 * goalRepeatPolicy(), never the field directly. See that function for the
 * resolution table, including what an ABSENT field means — which is 'multiple',
 * because that is what this server has always done.
 */
type GoalRepeatPolicy = 'once' | 'multiple';

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
   * `reachedAttemptId` is ALWAYS null today. The crossing is learned from a
   * post-commit observation of the shard total, and that observation cannot
   * prove which of several concurrent contributions moved the total across
   * the line (A +30 and B +70 against 100: both may observe 100). Naming an
   * attempt from it would sometimes name the wrong member, so no attempt is
   * named. The field stays so a future mechanism that CAN prove the order
   * (e.g. replaying contribution commit timestamps) has a place to write.
   */
  reachedAt?: FirebaseFirestore.Timestamp;
  reachedAttemptId?: string | null;
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
   * Set by wsfCreateGoal on every goal created since the crossing event
   * exists. A goal that carries it may record an UNCREDITED event (reachedAt
   * and reachedSharedTotal, reachedAttemptId null) when the total is observed
   * at or beyond the target with no attributable attempt — the only way a
   * crossing can be missed is several attempts landing in the same instant at
   * the line. A goal without it (created before this field) never gets an
   * uncredited event: it may already have been beyond its target for weeks,
   * and "reached today" would be a false date.
   */
  crossingTracked?: boolean;
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
  /** See goalRepeatPolicy() for the resolution table. Absent means 'multiple'. */
  repeatPolicy?: GoalRepeatPolicy;
  repeatPolicyUpdatedAt?: FirebaseFirestore.Timestamp;
  repeatPolicyUpdatedBy?: string;
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
 * The ONLY way this package asks "how often may one member contribute?".
 *
 * THE RESOLUTION TABLE — all four cases, and the reason for each:
 *
 *   absent / null  -> 'multiple'  Every goal written before this field existed
 *                                 accepts repeat contributions from the same
 *                                 member today: wsfContribute's only
 *                                 uniqueness is (goal, uid, attemptId), and a
 *                                 second attemptId has always been a second
 *                                 contribution. Resolving absence to 'once'
 *                                 would silently take that away from live
 *                                 goals. Absence therefore means "unchanged".
 *   'once'         -> 'once'      An explicit, deliberate restriction.
 *   'multiple'     -> 'multiple'  An explicit, deliberate permission.
 *   anything else  -> 'once'      A typo, a hand edit, an import, or a literal
 *                                 a later build introduced. A value this build
 *                                 does not understand must never widen what a
 *                                 member may do, so it lands on the stricter
 *                                 policy — NOT on the absent-field default.
 *
 * The distinction in the last two rows is the whole point: "the field is not
 * there" and "the field says something I don't recognise" are different facts
 * and get different answers.
 */
function goalRepeatPolicy(goal: Pick<GoalDoc, 'repeatPolicy'>): GoalRepeatPolicy {
  const raw = goal.repeatPolicy as unknown;
  if (raw === undefined || raw === null) return 'multiple';
  if (raw === 'multiple') return 'multiple';
  return 'once';
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

// A goal's repeat policy as supplied by a caller. Only the two literals are
// accepted — an unknown string is an error at the boundary rather than a value
// that silently resolves to 'once' inside a goal document.
function normalizeRepeatPolicy(v: unknown): GoalRepeatPolicy | null {
  if (v === 'once' || v === 'multiple') return v;
  return null;
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
  repeatPolicy?: unknown; // 'once' | 'multiple'; absent means 'once'
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
    // Optional in the request, but NEVER absent on a goal this callable
    // writes: omitting it records an explicit 'once'. A new goal states its
    // policy rather than inheriting the absent-field default, so
    // goalRepeatPolicy()'s 'absent means multiple' row only ever applies to
    // goals written before this field existed. Supplying anything other than
    // the two literals is refused here rather than written and reinterpreted
    // later.
    let repeatPolicy: GoalRepeatPolicy = 'once';
    const rawRepeatPolicy = request.data?.repeatPolicy;
    if (rawRepeatPolicy !== undefined && rawRepeatPolicy !== null) {
      const normalizedRepeatPolicy = normalizeRepeatPolicy(rawRepeatPolicy);
      if (!normalizedRepeatPolicy) {
        throw new HttpsError(
          'invalid-argument',
          "repeatPolicy must be 'once' or 'multiple'."
        );
      }
      repeatPolicy = normalizedRepeatPolicy;
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
        repeatPolicy,
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
   * Per-attempt credit for the crossing. ALWAYS false today, and stored as
   * false on every attempt: the crossing is learned from a post-commit
   * observation of the sharded total, which cannot prove which concurrent
   * contribution crossed the line, so no member is told "this one took us
   * past our goal". The goal-level event (GoalDoc.reachedAt) is still
   * recorded once; Community Home and the display celebrate WE reaching it.
   * The field stays in the contract so a mechanism that can prove the order
   * can light it without a shape change; until then it is never true.
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
      crossedTarget: storedCrossedTarget,
      goalHadNoEvent,
      goalTracked,
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
            goalHadNoEvent: false,
            goalTracked: goal.crossingTracked === true,
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

        //   4. Repeat policy. Under 'once' a member's contribution to this
        //      goal is recorded once, and a SECOND attempt is refused even
        //      though its attemptId is new and well-formed. Minting a fresh
        //      attemptId is how a client says "this is a different attempt";
        //      it is never how it earns a second one. The replay branch above
        //      already returned, so reaching here with a known attemptId is
        //      impossible and an honest earlier contribution is never refused.
        //
        //      The evidence is the member's own totals document, which was
        //      already read above — a document read, not a query, so two
        //      transactions racing two different attemptIds contend on it and
        //      exactly one commits.
        const priorMemberTotal = memberTotalSnap.data() as
          | { total?: number; contributionCount?: number }
          | undefined;
        const previousMemberTotal =
          typeof priorMemberTotal?.total === 'number' ? priorMemberTotal.total : 0;
        // Rows written before contributionCount existed carry no count. Their
        // total is not proof either way — wsfAdjustGoal can move a total
        // without any contribution behind it — so the ledger itself is asked,
        // and only for those rows. A member with no totals document at all has
        // nothing recorded: the contribution write below always creates one.
        let previousContributionCount: number | null =
          typeof priorMemberTotal?.contributionCount === 'number'
            ? priorMemberTotal.contributionCount
            : null;
        if (previousContributionCount === null && memberTotalSnap.exists) {
          const priorContributions = await tx.get(
            db
              .collection('wsfContributions')
              .where('goalId', '==', goalId)
              .where('userId', '==', uid)
              .limit(1)
          );
          previousContributionCount = priorContributions.empty ? 0 : 1;
        }
        const recordedBefore = (previousContributionCount ?? 0) > 0;
        if (goalRepeatPolicy(goal) === 'once' && recordedBefore) {
          throw new HttpsError(
            'failed-precondition',
            'This goal takes one contribution from each member, and yours is already recorded.'
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
          // Part of the attempt's stored outcome, exactly like `count`: a
          // replay reports it rather than deciding it again. False until the
          // post-commit claim below credits this attempt.
          crossedTarget: false,
          createdAt: FieldValue.serverTimestamp(),
        });
        tx.set(
          shard,
          { count: FieldValue.increment(count) },
          { merge: true }
        );

        tx.set(
          memberTotalRef,
          {
            goalId,
            userId: uid,
            total: previousMemberTotal + count,
            // How many contributions this member has recorded toward this
            // goal, as distinct from how many units they are credited with.
            // The repeat policy is about the former; an authorized correction
            // moves the latter and must not change it.
            contributionCount: (previousContributionCount ?? 0) + 1,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        // The recent-additions tail. Written HERE, on the branch that records
        // a new contribution, and nowhere else: the replay branch above
        // returns before reaching this line, so an attemptId replayed any
        // number of times records exactly once.
        //
        // ONE SMALL DOCUMENT OF ITS OWN, keyed by the attempt id. Nothing is
        // read first and nothing is rewritten, so this adds no contention:
        // the goal document is untouched, and two members contributing at the
        // same instant write two different documents rather than queueing on
        // one. Keying by the attempt id makes the write idempotent by
        // construction — a transaction retry, or any future path that reached
        // this line twice for one attempt, writes the same id with the same
        // content and there is still exactly one document.
        //
        // `now` is the SERVER time already used to enforce the window, rounded
        // down to the minute. The amount is the count just recorded. Nothing
        // that identifies the contributor — uid, attemptId as a FIELD, shard,
        // member total, position in any sequence — is written; the attempt id
        // is the document's name, not data inside it, and it is a per-tap
        // random value that names no one.
        const addition: RecentAddition = {
          amount: count,
          at: isoMinute(now.toMillis()),
        };
        tx.set(recentAdditionsRef(goalId).doc(attemptId), addition);

        // Reached only after the active-membership gate above, so this caller
        // is an active member by construction.
        return {
          addedCount: count,
          alreadyRecorded: false as const,
          crossedTarget: false,
          goalHadNoEvent: goal.reachedAt == null,
          goalTracked: goal.crossingTracked === true,
          goalTarget: goal.target,
          goalUnit: goal.unit,
          goalStatus: goal.status,
          callerIsActiveMember: true,
          goalDisplayAuthorized: isAggregateDisplayAuthorized(goal),
          goalCommunityGroupId: goal.communityGroupId,
        };
      });

    // THE TARGET-CROSSING EVENT — claimed after the commit, on the goal
    // document only. See claimTargetCrossing for the rule.
    // `crossedTarget` is never raised here: see ContributeResponse.
    const crossedTarget = storedCrossedTarget === true;
    let observedSharedTotal: number | null = null;
    if (!alreadyRecorded && goalHadNoEvent && goalTarget > 0) {
      observedSharedTotal = await sumGoalShards(goalId);
      if (observedSharedTotal >= goalTarget) {
        await recordTargetCrossing({ goalRef, count, observedSharedTotal, goalTracked });
      }
    }

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

    const sharedTotal = observedSharedTotal ?? (await sumGoalShards(goalId));

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

/**
 * Record the one-time target-crossing event for a goal whose shard total was
 * just observed at or beyond the target by a contribution that has committed.
 *
 * WHY AFTER THE COMMIT. The shared total lives in ten shards so that
 * concurrent contributions never touch the same document. Deciding the
 * crossing inside the contribution transaction meant reading all ten shards
 * there, which turned every pre-crossing contribution into a conflict with
 * every other (measured: 20 simultaneous attempts took 13 s and 48 of 50
 * aborted). This record touches ONLY the goal document, once.
 *
 * WHAT IS RECORDED, AND WHAT IS NOT. The event is a fact about the goal:
 * reachedAt and reachedSharedTotal. No attempt is named (reachedAttemptId is
 * written null) because a post-commit observation cannot prove which of
 * several concurrent contributions crossed the line — A +30 and B +70 against
 * a target of 100 may both observe 100 whichever landed first. A goal-level
 * "WE reached it" is true either way; "this one took us past" might not be.
 *
 * WHEN. Exactly once, the first time an observer sees the total at or beyond
 * the target with no event on the goal:
 *   • when the observer's own count spans the line
 *     (observed − count < target ≤ observed) — the crossing happened in this
 *     batch, so the date is honest — on any goal; or
 *   • on a goal created since this field exists (`crossingTracked`), whenever
 *     observed ≥ target — the only way a crossing is otherwise missed is
 *     several attempts landing in one instant, and the moment must not be
 *     lost. A goal from before could have stood beyond its target for weeks,
 *     so it never gets a dated event it cannot honestly carry.
 * A plain read first: once the goal carries an event the transaction is not
 * opened, so the post-crossing hot path pays one document read and nothing
 * else. Returns whether this call recorded the event.
 */
async function recordTargetCrossing(args: {
  goalRef: FirebaseFirestore.DocumentReference;
  count: number;
  observedSharedTotal: number;
  goalTracked: boolean;
}): Promise<boolean> {
  const { goalRef, count, observedSharedTotal, goalTracked } = args;
  const db = getFirestore();
  const peek = (await goalRef.get()).data() as GoalDoc | undefined;
  if (!peek || peek.reachedAt != null) return false;
  const spansLine =
    observedSharedTotal - count < peek.target && observedSharedTotal >= peek.target;
  if (!spansLine && !goalTracked) return false;

  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(goalRef);
    const goal = snap.data() as GoalDoc | undefined;
    if (!goal || goal.reachedAt != null) return false;
    const spans = observedSharedTotal - count < goal.target && observedSharedTotal >= goal.target;
    if (!spans && goal.crossingTracked !== true) return false;
    if (observedSharedTotal < goal.target) return false;
    tx.update(goalRef, {
      reachedAt: FieldValue.serverTimestamp(),
      reachedSharedTotal: observedSharedTotal,
      reachedAttemptId: null,
    });
    return true;
  });
}

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

/**
 * THE GOAL PULSE READ ITSELF — the gate, the context and the nine published
 * fields, lifted out of `wsfGoalPulse` so a second callable can answer with
 * EXACTLY this and not with a second implementation of it.
 *
 * `wsfStationState` needs the same nine fields for the screen standing at an
 * event. Copying the body would have given the product two places where the
 * display gate is decided, and the one thing this gate must never become is
 * a pair of rules that drift. So the body moved here unchanged and both
 * callables call it: wsfGoalPulse's response stays byte-identical (its own
 * test file is the guard), and a station can be no more of an oracle than the
 * public display already is.
 *
 * `callerUid` is the caller's own uid or null. A station passes null — it is
 * not signed in as anybody and must never be treated as a member — so it
 * reaches these totals only by the display route, which is exactly the
 * Champion's published-display permission and nothing wider.
 *
 * Throws the same generic not-found for every refusal, as before.
 */
async function readGoalPulseTotals(
  goalId: string,
  callerUid: string | null
): Promise<GoalPulseTotals> {
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
  const access = await evaluateGoalAggregateAccess(goal, callerUid);
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

export const wsfGoalPulse = onCall<GoalPulseRequest>(
  { region: 'us-central1', invoker: 'public' },
  async (request): Promise<GoalPulseTotals> => {
    const goalId = normalizeStringId(request.data?.goalId);
    if (!goalId) {
      throw new HttpsError('invalid-argument', 'goalId is required.');
    }
    // The whole body is readGoalPulseTotals. Nothing is added to, removed
    // from or reordered in what it returns: this response is the settled
    // nine-field contract and this callable is now only its front door.
    return readGoalPulseTotals(goalId, request.auth?.uid ?? null);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// wsfGoalRecentAdditions — the bounded, non-identifying tail of contributions.
//
// A SEPARATE callable on purpose. wsfGoalPulse publishes exactly nine fields
// and that shape is settled; widening it would re-open a decision that was
// already made, and would force every caller entitled to the totals to also
// receive this list. They are different disclosures, so they are different
// endpoints and a Champion's authorization reaches both by the SAME rule.
//
// WHAT IS PUBLISHED: an amount, the unit it is counted in, and the MINUTE it
// landed. Newest first, at most RECENT_ADDITIONS_LIMIT of them, and nothing
// else in the response object — no names, no photos, no ids, no contributor
// count, no per-member anything, not even how many distinct people the list
// represents. Ten entries may be one person or ten.
//
// THE BOUND IS APPLIED ON READ, by `limit()`. The subcollection itself is not
// pruned: it keeps one small document per contribution for the life of the
// goal. That is a deliberate trade for the write path — pruning would mean
// reading the tail inside the contribution transaction, which is the goal-
// document contention this subcollection exists to avoid. Nothing beyond the
// newest ten is ever published, and each retained document is an amount and a
// minute that names no one.
//
// ORDERED BY `at` DESCENDING — a single-field order on a single collection,
// which Firestore serves from the automatic single-field index. It needs no
// composite index and no firestore.indexes.json entry. Within one minute the
// stored values are equal, so Firestore breaks the tie by document name; the
// display shows minute granularity, so two additions in the same minute are
// indistinguishable to a viewer either way and no order between them is
// claimed.
//
// WHAT IS NOT LISTED: corrections. wsfAdjustGoal moves a total without being a
// contribution, so an adjustment appends nothing here and is invisible to this
// read. A public display that showed a total being walked back would narrate
// an administrative act to an outside audience, and the correction's size
// would say something about whoever it corrected.
//
// THE GATE is evaluateGoalAggregateAccess — the SAME function and the same
// call shape wsfGoalPulse uses, not a copy of its reasoning. Active member, or
// an authorized goal in a real (non-sample) community. Everyone else gets the
// byte-identical generic not-found an unknown goalId gets, so this cannot
// become an oracle for which goal ids exist any more than the pulse can.
//
// Deliberately NOT cached. The pulse's 2s cache holds one entry per goal for
// every entitled caller; this list is small, the display asks for it far less
// often than it polls the pulse, and a second cache would be a second place a
// revoked goal's data could linger.
// ─────────────────────────────────────────────────────────────────────────────

type GoalRecentAdditionsRequest = { goalId?: unknown };

/**
 * The published line. `unit` is the goal's current unit, carried so the
 * display never has to pair this response with another one to render a line.
 * It is the same unit wsfGoalPulse publishes.
 */
type PublishedRecentAddition = { amount: number; unit: string; at: string };

/**
 * Exactly one key. An empty `additions` is the honest answer when nothing has
 * been recorded — never an error, and never a substitute shape that would let
 * a caller tell "no contributions" apart from "no permission".
 */
type GoalRecentAdditionsResponse = { additions: PublishedRecentAddition[] };

export const wsfGoalRecentAdditions = onCall<GoalRecentAdditionsRequest>(
  { region: 'us-central1', invoker: 'public' },
  async (request): Promise<GoalRecentAdditionsResponse> => {
    const goalId = normalizeStringId(request.data?.goalId);
    if (!goalId) {
      throw new HttpsError('invalid-argument', 'goalId is required.');
    }

    const db = getFirestore();
    const goalSnap = await db.doc(`wsfGoals/${goalId}`).get();
    if (!goalSnap.exists) notFound();
    const goal = goalSnap.data() as GoalDoc;

    const access = await evaluateGoalAggregateAccess(goal, request.auth?.uid ?? null);
    if (!access.allowed) notFound();

    // The read happens only after the gate. Newest first, bounded by the query
    // itself, so an unbounded subcollection cannot turn into an unbounded
    // response.
    const snap = await recentAdditionsRef(goalId)
      .orderBy('at', 'desc')
      .limit(RECENT_ADDITIONS_LIMIT)
      .get();

    // Read defensively and republish nothing that is not the two stored
    // fields. A hand-edited or imported document carrying anything extra — a
    // uid, a name — is rebuilt from `amount` and `at` alone, so it cannot ride
    // out through this response. The document's own id is never published
    // either. A malformed document is dropped rather than guessed at.
    const unit = typeof goal.unit === 'string' ? goal.unit : '';
    const additions: PublishedRecentAddition[] = [];
    for (const doc of snap.docs) {
      const entry = doc.data() as Partial<RecentAddition> | undefined;
      const amount = entry?.amount;
      const at = entry?.at;
      if (typeof amount !== 'number' || !Number.isFinite(amount)) continue;
      if (typeof at !== 'string' || at === '') continue;
      additions.push({ amount, unit, at });
    }

    return { additions };
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
  /**
   * The goal's repeat policy, so the contribution screen can say honestly
   * whether more may be added later. It is a property of the goal, not of
   * anyone's identity, and this callable is already gated on active
   * membership or an own record — the same gate the unit already passes.
   * The public wsfGoalPulse response is untouched.
   */
  repeatPolicy: GoalRepeatPolicy;
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
      repeatPolicy: goalRepeatPolicy(goal),
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
  repeatPolicy?: unknown; // 'once' | 'multiple'
};

type AdjustGoalResponse = {
  adjustmentId: string;
  delta: number;
  targetUid: string | null;
  sharedTotal: number;
  targetMemberTotal: number | null;
  /** The goal's repeat policy AFTER this call, changed or not. */
  repeatPolicy: GoalRepeatPolicy;
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
    // The Champion's repeat-policy change rides on this callable rather than
    // on a new one: it is the same authority, the same goal, and it produces
    // the same immutable, attributed audit row every other correction does.
    let repeatPolicy: GoalRepeatPolicy | null = null;
    const rawRepeatPolicy = request.data?.repeatPolicy;
    if (rawRepeatPolicy !== undefined && rawRepeatPolicy !== null) {
      repeatPolicy = normalizeRepeatPolicy(rawRepeatPolicy);
      if (!repeatPolicy) {
        throw new HttpsError(
          'invalid-argument',
          "repeatPolicy must be 'once' or 'multiple'."
        );
      }
    }
    // delta stays required for a count correction and stays nonzero. It
    // becomes optional in exactly one case: a call whose whole business is the
    // repeat policy, which then records delta 0 and moves no total. A reason
    // is still required, so a policy change is as traceable as a count change.
    let delta = 0;
    const rawDelta = request.data?.delta;
    if (rawDelta !== undefined && rawDelta !== null) {
      const normalizedDelta = normalizeAdjustmentDelta(rawDelta);
      if (normalizedDelta === null) {
        throw new HttpsError(
          'invalid-argument',
          'delta must be a nonzero integer within ±100000000.'
        );
      }
      delta = normalizedDelta;
    } else if (!repeatPolicy) {
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

    const { newTargetTotal, effectiveRepeatPolicy } = await db.runTransaction(async (tx) => {
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
        // Present only on a call that changed it, so the ledger reads as
        // "this is what this correction did".
        ...(repeatPolicy ? { repeatPolicy } : {}),
        createdAt: FieldValue.serverTimestamp(),
      });
      if (delta !== 0) {
        tx.set(
          writeShardRef,
          { count: FieldValue.increment(delta) },
          { merge: true }
        );
      }
      if (targetMemberTotalRef && delta !== 0) {
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
      if (repeatPolicy) {
        // Merged onto the goal, never rewritten wholesale: nothing else about
        // the goal moves, and the change carries who made it and when for the
        // same reason the display authorization does.
        tx.set(
          goalRef,
          {
            repeatPolicy,
            repeatPolicyUpdatedAt: FieldValue.serverTimestamp(),
            repeatPolicyUpdatedBy: uid,
          },
          { merge: true }
        );
      }

      return {
        newTargetTotal: projectedTargetTotal,
        effectiveRepeatPolicy: repeatPolicy ?? goalRepeatPolicy(goal),
      };
    });

    const sharedTotal = await sumGoalShards(goalId);
    return {
      adjustmentId: adjustmentRef.id,
      delta,
      targetUid,
      sharedTotal,
      targetMemberTotal: newTargetTotal,
      repeatPolicy: effectiveRepeatPolicy,
    };
  }
);

// ═════════════════════════════════════════════════════════════════════════════
// STATION ENROLMENT — the second screen at an event.
//
// WHAT A STATION IS. One physical screen, standing at an event, showing ONE
// goal. It is Station 1 or Station 2 of that goal and nothing else. It is
// enrolled by the goal's Champion, it can be revoked by the goal's Champion,
// and until it is enrolled it shows nothing but a pairing code.
//
// WHY A STATION IS NOT A FIREBASE AUTH USER. app/kiosk/[goalId].tsx signs the
// device out every time its start screen comes into focus, deliberately, so
// that no visitor inherits the previous visitor's account. A screen at an
// event lives on the same kind of device and under the same rule, so an
// account is exactly the wrong shape for its identity: it would be signed out
// from under it, and an account that survived would be an account standing
// unattended in a public hall.
//
// So a station's identity is a SECRET, not a session: a random string minted
// by this server at approval, stored here only as a sha256 hash, held by the
// device in its own localStorage, presented on every call, compared in
// constant time, and revocable by the Champion in one action.
//
// WHAT A STATION IS DELIBERATELY NOT ABLE TO DO. It cannot record a
// contribution, it cannot name a person, it cannot list members, and it
// cannot read anything a public display could not. It calls
// `readGoalPulseTotals(goalId, null)` — the display route, the Champion's own
// published-display permission — so a station standing on a goal that is not
// display-authorized is refused exactly as the kiosk and the display are.
//
// WHAT IS DELIBERATELY NOT STORED about a station: no user agent, no IP
// address, no device fingerprint, no geolocation, and no attendee identity of
// any kind. A station cannot prove who is standing at it, so it records
// nothing about them, and nothing here writes wsfContributions,
// wsfGoalCounters or wsfGoalMemberTotals.
//
// RULES. Neither wsfKioskStations nor wsfKioskPairings appears in
// firestore.rules, so both fall to the catch-all `match /{document=**} { allow
// read, write: if false; }`. Every document below is server-only and no rules
// change accompanies this feature. Verified against firestore.rules: the only
// wsf collections with client rules are wsfMemberProfiles, wsfCommunityGroups
// and wsfMemberships.
// ═════════════════════════════════════════════════════════════════════════════

/** Station 1 or Station 2. A goal has two; there is no third slot. */
const STATION_SLOTS = [1, 2] as const;
type StationSlot = (typeof STATION_SLOTS)[number];

type StationStatus = 'pendingClaim' | 'active' | 'revoked';
type PairingStatus = 'pending' | 'approved' | 'claimed' | 'expired' | 'refused';

/**
 * The station's visible name, derived HERE from the slot and never taken from
 * a request. A label a client could supply is a label an unenrolled device
 * could choose for itself, and "Station 1" on a screen has to mean the slot
 * the Champion approved.
 */
function stationLabelForSlot(slot: StationSlot): string {
  return `Station ${slot}`;
}

function normalizeStationSlot(v: unknown): StationSlot | null {
  if (v === 1 || v === '1') return 1;
  if (v === 2 || v === '2') return 2;
  return null;
}

/**
 * The pairing-code alphabet: 32 characters with I, O, 0 and 1 removed, so a
 * code read off a screen across a hall and typed into a phone cannot be
 * mistyped into a DIFFERENT valid code. 32 divides 256 exactly, so the byte
 * mapping below is unbiased.
 *
 * Mirrored — deliberately, as a copy — by STATION_PAIRING_ALPHABET in
 * apps/westayfit/src/stationSession.ts, which normalizes what the Champion
 * types. Both are pinned by tests.
 */
const STATION_PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const STATION_PAIRING_CODE_LENGTH = 6;

/** Ten minutes. Long enough to walk a code to the Champion, short enough that
 * an abandoned code on a screen in a hall stops meaning anything. */
const STATION_PAIRING_TTL_MS = 10 * 60 * 1000;

function mintPairingCode(): string {
  const bytes = randomBytes(STATION_PAIRING_CODE_LENGTH);
  let out = '';
  for (let i = 0; i < STATION_PAIRING_CODE_LENGTH; i += 1) {
    out += STATION_PAIRING_ALPHABET[bytes[i]! % STATION_PAIRING_ALPHABET.length];
  }
  return out;
}

/**
 * The station secret. 256 bits of CSPRNG in base64url — URL-safe characters,
 * although it must never be in a URL (see the quality bar: no secret, token
 * or authority ever rides in a URL or a QR code). It is minted once, handed
 * to one device once, and stored here only as a hash.
 */
function mintStationSecret(): string {
  return randomBytes(32).toString('base64url');
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Constant-time comparison of two sha256 hex digests.
 *
 * `===` on a secret-derived value leaks, through timing, how many leading
 * characters an attacker got right, which turns a 256-bit secret into a
 * character-at-a-time search. Both operands here are fixed-length hex digests
 * of the same function, so their LENGTH is public and a length mismatch can be
 * refused before the comparison without telling an attacker anything.
 */
function constantTimeHexEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  if (left.length === 0) return false;
  return timingSafeEqual(left, right);
}

function normalizePairingCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  // A person typing a code off a screen adds spaces and dashes. They are
  // removed here, not rejected, and the code is compared in upper case — the
  // stored hash is of the upper-case form and of nothing else.
  const cleaned = v.replace(/[\s-]+/g, '').toUpperCase();
  if (cleaned.length !== STATION_PAIRING_CODE_LENGTH) return null;
  for (const ch of cleaned) {
    if (!STATION_PAIRING_ALPHABET.includes(ch)) return null;
  }
  return cleaned;
}

/** The shape a station secret takes. Anything else cannot be one we minted. */
function normalizeStationSecret(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Per-IP bucket for the four callables a station device makes UNAUTHENTICATED,
 * modelled on enforcePreviewRateLimit and kept in its own collection so the
 * two features cannot exhaust each other's budget.
 *
 * 300 a minute: a station polls its state every 2 seconds (30/min), an event
 * may have two stations, and a hall's devices usually share one NAT address,
 * so the ceiling has to sit well above honest use while still bounding a cost
 * pump. The same salted, daily-rotating IP hash: no long-lived per-device
 * identifier is written anywhere.
 */
const STATION_RATE_LIMIT_WINDOW_MS = 60_000;
const STATION_RATE_LIMIT_MAX = 300;

async function enforceStationRateLimit(ip: string, now: number): Promise<void> {
  const hash = hashIpForBucket(ip, now);
  const db = getFirestore();
  const ref = db.doc(`wsfStationRateLimits/${hash}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() as { windowStart?: number; count?: number } | undefined;
    const windowStart = data?.windowStart ?? 0;
    const inWindow = snap.exists && now - windowStart < STATION_RATE_LIMIT_WINDOW_MS;
    if (inWindow) {
      const nextCount = (data?.count ?? 0) + 1;
      if (nextCount > STATION_RATE_LIMIT_MAX) {
        throw new HttpsError('resource-exhausted', 'Too many requests. Try again shortly.');
      }
      tx.update(ref, { count: FieldValue.increment(1) });
    } else {
      tx.set(ref, { windowStart: now, count: 1 });
    }
  });
}

/**
 * wsfKioskStations/{stationId} — one enrolled screen.
 *
 * `serving` is null for this slice and stays null: calling a participant by
 * name is the queue, and the queue is not this slice. The field exists so the
 * document shape does not change under a live station when it arrives.
 */
type StationDoc = {
  goalId: string;
  communityGroupId: string;
  /** Equal to goalId for now — one queue per goal. Written explicitly so the
   * two can part company later without a migration of meaning. */
  queueId: string;
  slot: StationSlot;
  /** Server-derived from `slot`. Never client-supplied. */
  label: string;
  /** sha256 hex of the secret. The secret itself is never stored. */
  secretHash?: string;
  /**
   * The pairing this screen was approved from. Stored so REVOCATION can reach
   * the in-transit copy of the secret by id — a document read, not a query,
   * so this costs no entry in firestore.indexes.json.
   */
  pairingId?: string;
  secretVersion: number;
  status: StationStatus;
  serving: null;
  createdAt?: FirebaseFirestore.Timestamp;
  createdBy: string;
  claimedAt?: FirebaseFirestore.Timestamp | null;
  revokedAt?: FirebaseFirestore.Timestamp | null;
  revokedBy?: string | null;
  lastSeenAt?: FirebaseFirestore.Timestamp | null;
};

type PairingDoc = {
  pairingId: string;
  goalId: string;
  /** sha256 of the UPPER-CASE six-character code. The live code is never
   * stored, so this collection cannot be read back into working codes. */
  codeHash: string;
  status: PairingStatus;
  expiresAt: FirebaseFirestore.Timestamp;
  createdAt?: FirebaseFirestore.Timestamp;
  slot?: StationSlot;
  stationId?: string;
  deliverySecret?: string;
  approvedAt?: FirebaseFirestore.Timestamp;
  claimedAt?: FirebaseFirestore.Timestamp;
};

function toIso(v: unknown): string | null {
  const ts = v as { toDate?: () => Date } | undefined | null;
  const d = ts?.toDate?.();
  return d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// wsfStationRequestPairing — an unenrolled screen asks to be let in.
//
// UNAUTHENTICATED, because a station has no account and must not have one.
// The device gets back a `pairingId` only it knows and a six-character code it
// prints large on itself. The code is what the Champion types; the pairingId
// is what the device polls and claims with, and it never appears on screen, in
// a URL or in a QR.
//
// IT READS NO GOAL. A request for a well-formed goalId always succeeds,
// whether or not that goal exists, so this endpoint cannot be walked to learn
// which goal ids are real. Nothing is granted by a pairing: until a Champion
// of that exact goal approves the code, an approved pairing does not exist.
// ─────────────────────────────────────────────────────────────────────────────

type StationRequestPairingRequest = { goalId?: unknown };
type StationRequestPairingResponse = {
  pairingId: string;
  /** The live code. In the response only — never stored, only its hash is. */
  code: string;
  expiresAt: string;
};

export const wsfStationRequestPairing = onCall<StationRequestPairingRequest>(
  { region: 'us-central1', invoker: 'public' },
  async (request): Promise<StationRequestPairingResponse> => {
    const now = Date.now();
    await enforceStationRateLimit(extractIp(request.rawRequest ?? {}), now);

    const goalId = normalizeStringId(request.data?.goalId);
    if (!goalId) {
      throw new HttpsError('invalid-argument', 'goalId is required.');
    }

    const db = getFirestore();
    // Random document id: the pairing is addressed only by a value the
    // requesting device holds. Nothing enumerates this collection.
    const ref = db.collection('wsfKioskPairings').doc();
    const code = mintPairingCode();
    const expiresAt = Timestamp.fromMillis(now + STATION_PAIRING_TTL_MS);

    const doc: PairingDoc = {
      pairingId: ref.id,
      goalId,
      codeHash: sha256Hex(code),
      status: 'pending',
      expiresAt,
    };
    await ref.set({ ...doc, createdAt: FieldValue.serverTimestamp() });

    return { pairingId: ref.id, code, expiresAt: expiresAt.toDate().toISOString() };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// wsfStationPairingStatus — the waiting screen asks whether it has been let in.
//
// Answers ONE word and no more. It does not say which goal, which community,
// which slot or which Champion; the screen that asks already knows the goal it
// is standing on, and everything else arrives with the claim.
// ─────────────────────────────────────────────────────────────────────────────

type StationPairingStatusRequest = { pairingId?: unknown };
type StationPairingStatusResponse = { status: PairingStatus };

export const wsfStationPairingStatus = onCall<StationPairingStatusRequest>(
  { region: 'us-central1', invoker: 'public' },
  async (request): Promise<StationPairingStatusResponse> => {
    const now = Date.now();
    await enforceStationRateLimit(extractIp(request.rawRequest ?? {}), now);

    const pairingId = normalizeStringId(request.data?.pairingId);
    if (!pairingId) {
      throw new HttpsError('invalid-argument', 'pairingId is required.');
    }

    const snap = await getFirestore().doc(`wsfKioskPairings/${pairingId}`).get();
    // An unknown pairingId and an expired one are the same answer on purpose:
    // 'expired' is what the screen does something about, and neither reveals
    // whether that id was ever real.
    if (!snap.exists) return { status: 'expired' };
    const pairing = snap.data() as PairingDoc;
    if (pairing.status === 'pending' && pairing.expiresAt.toMillis() <= now) {
      return { status: 'expired' };
    }
    return { status: pairing.status };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// wsfApproveStation — the Champion lets a screen in, as Station 1 or Station 2.
//
// AUTHORIZATION: an ACTIVE foundingChampion of the community that owns the
// goal the pairing was requested for. Checked inside the transaction through
// the same `requireChampion` every other Champion action uses; a caller who is
// not one gets the same not-found a goal that does not exist gets, so this
// cannot be used to probe goals or communities.
//
// The slot comes from the Champion, and the LABEL comes from the slot, here.
// The screen never names itself.
// ─────────────────────────────────────────────────────────────────────────────

type ApproveStationRequest = { goalId?: unknown; code?: unknown; slot?: unknown };
type ApproveStationResponse = {
  stationId: string;
  slot: StationSlot;
  label: string;
  goalId: string;
};

/** Written for the Champion, who is already authorized and learns nothing from
 * it that they could not learn by looking at the screen in front of them. */
const STATION_CODE_INVALID = 'That code is not valid, or it has expired. Ask the screen for a new one.';

export const wsfApproveStation = onCall<ApproveStationRequest>(
  { region: 'us-central1' },
  async (request): Promise<ApproveStationResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    const uid = request.auth.uid;

    const goalId = normalizeStringId(request.data?.goalId);
    if (!goalId) {
      throw new HttpsError('invalid-argument', 'goalId is required.');
    }
    const code = normalizePairingCode(request.data?.code);
    const slot = normalizeStationSlot(request.data?.slot);
    if (!slot) {
      throw new HttpsError('invalid-argument', 'slot must be 1 or 2.');
    }
    // A malformed code is refused with the SAME sentence a wrong one gets, so
    // the shape of the code space is not narrated back to anyone.
    if (!code) {
      throw new HttpsError('not-found', STATION_CODE_INVALID);
    }

    const db = getFirestore();
    const now = Date.now();
    const codeHash = sha256Hex(code);
    const stationRef = db.collection('wsfKioskStations').doc();
    const secret = mintStationSecret();

    const approved = await db.runTransaction(async (tx) => {
      // READS FIRST — Firestore requires every read in a transaction to
      // precede every write.
      const goalRef = db.doc(`wsfGoals/${goalId}`);
      const goalSnap = await tx.get(goalRef);
      if (!goalSnap.exists) notFound();
      const goal = goalSnap.data() as GoalDoc;
      const groupId = normalizeStringId(goal.communityGroupId);
      if (!groupId) notFound();

      // AUTHORITY BEFORE ANYTHING ELSE IS SAID ABOUT THE CODE. A caller who
      // is not this community's Champion is refused here, so nobody can use
      // this callable to test codes.
      await requireChampion(tx, groupId, uid);

      // Looked up by codeHash alone — a single-field equality query, which
      // Firestore serves from its automatic index and which needs no entry in
      // firestore.indexes.json. Goal, status and expiry are checked here.
      const matches = await tx.get(
        db.collection('wsfKioskPairings').where('codeHash', '==', codeHash).limit(10)
      );
      const pairingSnap = matches.docs.find((d) => {
        const p = d.data() as PairingDoc;
        return (
          p.goalId === goalId &&
          p.status === 'pending' &&
          p.expiresAt.toMillis() > now
        );
      });
      if (!pairingSnap) {
        throw new HttpsError('not-found', STATION_CODE_INVALID);
      }

      // The station document. `secretHash` only — the secret itself is in
      // this function's memory and, for the next few minutes, in the pairing's
      // deliverySecret; it is never written here.
      const station: StationDoc = {
        goalId,
        communityGroupId: groupId,
        queueId: goalId,
        slot,
        label: stationLabelForSlot(slot),
        secretHash: sha256Hex(secret),
        pairingId: pairingSnap.id,
        secretVersion: 1,
        status: 'pendingClaim',
        serving: null,
        createdBy: uid,
        claimedAt: null,
        revokedAt: null,
        revokedBy: null,
        lastSeenAt: null,
      };
      tx.set(stationRef, { ...station, createdAt: FieldValue.serverTimestamp() });

      tx.update(pairingSnap.ref, {
        status: 'approved' satisfies PairingStatus,
        slot,
        stationId: stationRef.id,
        approvedAt: FieldValue.serverTimestamp(),
        /**
         * deliverySecret — THE PLAINTEXT SECRET, IN TRANSIT ONLY.
         *
         * Say it plainly: this is a deliberate, time-boxed trade. The secret
         * has to travel from the Champion's approval to the screen that asked
         * for it, and the screen is not signed in as anybody, so there is no
         * session to hand it to. The proper answer is an envelope encrypted to
         * a key the device generated, or a KMS-held key, and standing up KMS
         * was not something to do against this deadline.
         *
         * What bounds it. The field lives on a document in wsfKioskPairings,
         * which appears nowhere in firestore.rules and therefore falls to the
         * catch-all deny — no client can read it, ever, on any path. It is
         * deleted by the first successful claim (see wsfStationClaimPairing),
         * and the pairing expires ten minutes after it was created whether or
         * not anyone claims it.
         *
         * THE FOLLOW-UP, so it is not lost: have the requesting device
         * generate a key pair and send its public key with the pairing
         * request, seal the secret to that public key at approval, and let the
         * claim return the sealed envelope — at which point no plaintext
         * secret is ever written to Firestore at all. Until then, this field
         * is the one place a station secret exists at rest in the clear.
         */
        deliverySecret: secret,
      });

      return { stationId: stationRef.id, slot, label: stationLabelForSlot(slot), goalId };
    });

    return approved;
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// wsfStationClaimPairing — the approved screen collects its credential, ONCE.
//
// UNAUTHENTICATED, and authenticated in the only way that is available here:
// by the `pairingId`, which this server minted and handed to exactly one
// device and which has never been on screen, in a URL or in a QR code.
//
// The first successful claim deletes the delivery copy of the secret. A second
// claim therefore cannot succeed, and a claim after a revocation cannot
// resurrect anything: the station document is the authority and this only ever
// moves it from 'pendingClaim' to 'active'.
// ─────────────────────────────────────────────────────────────────────────────

type StationClaimPairingRequest = { pairingId?: unknown };
type StationClaimPairingResponse = {
  stationId: string;
  /** The only time this value crosses the wire to the device. */
  secret: string;
  slot: StationSlot;
  label: string;
  goalId: string;
};

export const wsfStationClaimPairing = onCall<StationClaimPairingRequest>(
  { region: 'us-central1', invoker: 'public' },
  async (request): Promise<StationClaimPairingResponse> => {
    const now = Date.now();
    await enforceStationRateLimit(extractIp(request.rawRequest ?? {}), now);

    const pairingId = normalizeStringId(request.data?.pairingId);
    if (!pairingId) {
      throw new HttpsError('invalid-argument', 'pairingId is required.');
    }

    const db = getFirestore();
    const pairingRef = db.doc(`wsfKioskPairings/${pairingId}`);

    return db.runTransaction(async (tx) => {
      const pairingSnap = await tx.get(pairingRef);
      if (!pairingSnap.exists) {
        throw new HttpsError('not-found', STATION_CODE_INVALID);
      }
      const pairing = pairingSnap.data() as PairingDoc;
      const stationId = normalizeStringId(pairing.stationId);
      const secret = pairing.deliverySecret;
      if (
        pairing.status !== 'approved' ||
        !stationId ||
        typeof secret !== 'string' ||
        secret === '' ||
        !pairing.slot
      ) {
        // Already claimed, never approved, or refused. One answer for all of
        // them: there is nothing here to collect.
        throw new HttpsError('failed-precondition', 'This screen has nothing to collect.');
      }

      const stationRef = db.doc(`wsfKioskStations/${stationId}`);
      const stationSnap = await tx.get(stationRef);
      if (!stationSnap.exists) {
        throw new HttpsError('failed-precondition', 'This screen has nothing to collect.');
      }
      const station = stationSnap.data() as StationDoc;
      if (station.status === 'revoked') {
        // Revoked between approval and claim. The credential is not delivered,
        // and the delivery copy goes now rather than sitting until expiry.
        tx.update(pairingRef, {
          status: 'refused' satisfies PairingStatus,
          deliverySecret: FieldValue.delete(),
        });
        throw new HttpsError('failed-precondition', 'This screen has nothing to collect.');
      }

      tx.update(stationRef, {
        status: 'active' satisfies StationStatus,
        claimedAt: FieldValue.serverTimestamp(),
        lastSeenAt: FieldValue.serverTimestamp(),
      });
      // The delete and the status change are in the SAME write. A claim either
      // hands over the credential and destroys the delivery copy, or does
      // neither.
      tx.update(pairingRef, {
        status: 'claimed' satisfies PairingStatus,
        claimedAt: FieldValue.serverTimestamp(),
        deliverySecret: FieldValue.delete(),
      });

      return {
        stationId,
        secret,
        slot: pairing.slot,
        label: station.label,
        goalId: station.goalId,
      };
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// wsfStationState — what an enrolled screen shows.
//
// AUTHORIZATION: the station secret, compared in CONSTANT TIME against the
// stored sha256 hash. Never string equality. An unknown station, a revoked
// station and a wrong secret are all one answer — 'permission-denied' — which
// is also the signal the screen acts on: clear the credential and go back to
// asking for a pairing code.
//
// The goal totals come from `readGoalPulseTotals(goalId, null)`. Null uid, so
// the station reaches them ONLY by the display route — a goal whose Champion
// has not authorized public display refuses here exactly as it refuses the
// public display, and the screen renders the same refusal the kiosk does.
//
// `joinCode` is the community's EXISTING invite code, and only ever for a
// community whose join policy admits by link at all (the same LINK_JOINABLE
// set the join page and the Champion's own QR use). It is here so the screen
// can draw the newcomer QR the Champion would otherwise print by hand. It is
// not an admission-policy change: a private community returns null and the
// screen simply has no newcomer QR to show.
// ─────────────────────────────────────────────────────────────────────────────

type StationStateRequest = { stationId?: unknown; secret?: unknown };
type StationStateResponse = {
  stationId: string;
  slot: StationSlot;
  label: string;
  goalId: string;
  queueId: string;
  /** Null for a community that admits nobody by link. */
  joinCode: string | null;
  /** The identical nine fields wsfGoalPulse publishes; same function. */
  pulse: GoalPulseTotals;
};

/**
 * One answer for every way a credential can fail to be a live one: an unknown
 * station, a revoked one, a wrong secret and a malformed request are all this
 * sentence and this code, so none of them tells a caller which it was.
 */
const STATION_REJECTED_MESSAGE = 'This screen is not enrolled.';

/** A station that has called in within the last minute does not need its
 * lastSeenAt rewritten. The screen polls every two seconds; a write per poll
 * would be 30 writes a minute per screen to record a fact one write records. */
const STATION_LAST_SEEN_MIN_INTERVAL_MS = 60_000;

export const wsfStationState = onCall<StationStateRequest>(
  { region: 'us-central1', invoker: 'public' },
  async (request): Promise<StationStateResponse> => {
    const now = Date.now();

    /**
     * THE BUCKET IS CHARGED FOR REFUSALS, NOT FOR SERVICE.
     *
     * The other three unauthenticated station callables take the per-IP limit
     * on every call, and that is right: they are open doors, and a caller
     * holding nothing can hammer them. This one is different. It is the only
     * station callable that is *authenticated* — by a secret this server
     * minted and handed to exactly one screen — and it is the only one a
     * screen calls on a timer, every two seconds, for as long as the event
     * lasts.
     *
     * Charging it per call put a transactional write on ONE document per IP
     * on the main polling path. Two screens behind a venue's single NAT
     * address is a sustained write per second to that one document, which is
     * where Firestore's per-document write ceiling sits — so the two screens
     * an expo hall is most likely to have are exactly the case that contends
     * with itself. A parallel test run reproduced it: the same two tests pass
     * one at a time and stall together.
     *
     * So: a call that proves it holds a live credential is served without
     * touching the bucket, and every refusal is charged before it answers.
     * Brute force is still throttled — guessing is precisely the refusal path
     * — while a screen doing its job costs no contended write at all.
     */
    const ip = extractIp(request.rawRequest ?? {});
    const stationRefusal = async (): Promise<HttpsError> => {
      await enforceStationRateLimit(ip, now);
      return new HttpsError('permission-denied', STATION_REJECTED_MESSAGE);
    };

    const stationId = normalizeStringId(request.data?.stationId);
    const secret = normalizeStationSecret(request.data?.secret);
    if (!stationId || !secret) throw await stationRefusal();

    const db = getFirestore();
    const stationRef = db.doc(`wsfKioskStations/${stationId}`);
    const stationSnap = await stationRef.get();
    if (!stationSnap.exists) throw await stationRefusal();
    const station = stationSnap.data() as StationDoc;
    if (station.status !== 'active') throw await stationRefusal();
    if (!constantTimeHexEqual(station.secretHash, sha256Hex(secret))) {
      throw await stationRefusal();
    }

    const slot = normalizeStationSlot(station.slot);
    if (!slot) throw await stationRefusal();

    // The display gate, unchanged and shared. This may throw the generic
    // not-found, and that is the intended outcome for an unauthorized goal:
    // the screen renders the kiosk's refusal, and is no more of an oracle than
    // the kiosk is.
    const pulse = await readGoalPulseTotals(station.goalId, null);

    // The invite code, only where a link admits anyone at all.
    let joinCode: string | null = null;
    const groupSnap = await db.doc(`wsfCommunityGroups/${station.communityGroupId}`).get();
    if (groupSnap.exists) {
      const group = groupSnap.data() as { joinPolicy?: string; joinCode?: string };
      if (
        typeof group.joinPolicy === 'string' &&
        LINK_JOINABLE.has(group.joinPolicy) &&
        typeof group.joinCode === 'string' &&
        group.joinCode !== ''
      ) {
        joinCode = group.joinCode;
      }
    }

    const lastSeenMs = (station.lastSeenAt as { toMillis?: () => number } | null | undefined)
      ?.toMillis?.();
    if (typeof lastSeenMs !== 'number' || now - lastSeenMs >= STATION_LAST_SEEN_MIN_INTERVAL_MS) {
      // Best effort, and deliberately not awaited into the response path's
      // success: a screen that is up must not go dark because a bookkeeping
      // write failed.
      await stationRef
        .update({ lastSeenAt: FieldValue.serverTimestamp() })
        .catch(() => undefined);
    }

    return {
      stationId,
      slot,
      label: station.label,
      goalId: station.goalId,
      queueId: station.queueId ?? station.goalId,
      joinCode,
      pulse,
    };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// wsfListStations — the Champion sees which screens are enrolled on a goal.
//
// AUTHORIZATION: an ACTIVE foundingChampion of the goal's community.
//
// NO SECRET LEAVES THIS FUNCTION. `secretHash` is not in the response type and
// is not read into it; a list of screens is a list of screens.
// ─────────────────────────────────────────────────────────────────────────────

type ListStationsRequest = { goalId?: unknown };
type ListedStation = {
  stationId: string;
  slot: StationSlot;
  label: string;
  status: StationStatus;
  createdAt: string | null;
  claimedAt: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
};
type ListStationsResponse = { stations: ListedStation[] };

const STATION_LIST_LIMIT = 50;

export const wsfListStations = onCall<ListStationsRequest>(
  { region: 'us-central1' },
  async (request): Promise<ListStationsResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    const uid = request.auth.uid;
    const goalId = normalizeStringId(request.data?.goalId);
    if (!goalId) {
      throw new HttpsError('invalid-argument', 'goalId is required.');
    }

    const db = getFirestore();
    const goalSnap = await db.doc(`wsfGoals/${goalId}`).get();
    if (!goalSnap.exists) notFound();
    const goal = goalSnap.data() as GoalDoc;
    const groupId = normalizeStringId(goal.communityGroupId);
    if (!groupId) notFound();
    await db.runTransaction(async (tx) => {
      await requireChampion(tx, groupId, uid);
    });

    // Single-field equality, ordered in memory: a `where` plus an `orderBy` on
    // a different field would need a composite index, and firestore.indexes.json
    // is not this slice's to change.
    const snap = await db
      .collection('wsfKioskStations')
      .where('goalId', '==', goalId)
      .limit(STATION_LIST_LIMIT)
      .get();

    const stations: ListedStation[] = [];
    for (const d of snap.docs) {
      const s = d.data() as StationDoc;
      const slot = normalizeStationSlot(s.slot);
      if (!slot) continue;
      stations.push({
        stationId: d.id,
        slot,
        label: s.label ?? stationLabelForSlot(slot),
        status: s.status,
        createdAt: toIso(s.createdAt),
        claimedAt: toIso(s.claimedAt),
        lastSeenAt: toIso(s.lastSeenAt),
        revokedAt: toIso(s.revokedAt),
      });
    }
    stations.sort((a, b) => a.slot - b.slot || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
    return { stations };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// wsfRevokeStation — the Champion turns a screen off, from anywhere.
//
// AUTHORIZATION: an ACTIVE foundingChampion of the goal's community.
//
// The secret hash is DELETED, not just marked stale: after this there is
// nothing stored that the revoked device's secret can match, and its next poll
// gets the same 'permission-denied' an unknown screen gets, which is what makes
// it clear its own storage and go back to a pairing code. The document itself
// stays, with when it was revoked and by whom.
// ─────────────────────────────────────────────────────────────────────────────

type RevokeStationRequest = { stationId?: unknown };
type RevokeStationResponse = { stationId: string; status: 'revoked' };

export const wsfRevokeStation = onCall<RevokeStationRequest>(
  { region: 'us-central1' },
  async (request): Promise<RevokeStationResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    const uid = request.auth.uid;
    const stationId = normalizeStringId(request.data?.stationId);
    if (!stationId) {
      throw new HttpsError('invalid-argument', 'stationId is required.');
    }

    const db = getFirestore();
    const stationRef = db.doc(`wsfKioskStations/${stationId}`);

    await db.runTransaction(async (tx) => {
      const stationSnap = await tx.get(stationRef);
      if (!stationSnap.exists) notFound();
      const station = stationSnap.data() as StationDoc;
      const groupId = normalizeStringId(station.communityGroupId);
      if (!groupId) notFound();
      await requireChampion(tx, groupId, uid);

      /**
       * REVOKING BEFORE THE SCREEN EVER CLAIMED.
       *
       * A screen approved but not yet claimed still has its plaintext secret
       * sitting in the pairing's `deliverySecret`, waiting to be collected.
       * Revoking the station alone already stops the claim — it is refused on
       * the station's status — but it would leave that secret at rest in the
       * clear until the pairing expired, for a screen the Champion has just
       * said they do not want. A Champion who revokes expects the credential
       * gone, not gone in ten minutes, so the delivery copy goes here too and
       * the pairing is closed in the same transaction.
       *
       * Read before any write, as a Firestore transaction requires, and by id
       * rather than by query so no index is needed.
       */
      const pairingId = normalizeStringId(station.pairingId);
      const pairingRef = pairingId ? db.doc(`wsfKioskPairings/${pairingId}`) : null;
      const pairingSnap = pairingRef ? await tx.get(pairingRef) : null;

      tx.update(stationRef, {
        status: 'revoked' satisfies StationStatus,
        secretHash: FieldValue.delete(),
        revokedAt: FieldValue.serverTimestamp(),
        revokedBy: uid,
      });

      if (pairingRef && pairingSnap?.exists) {
        const pairing = pairingSnap.data() as PairingDoc;
        // Only this station's own pairing, and only one that has not already
        // been claimed — a claimed pairing holds no secret anyway, and its
        // `claimed` status is a record worth keeping intact.
        if (pairing.stationId === stationId && pairing.status === 'approved') {
          // 'refused' rather than a new status: the screen already treats it
          // exactly as it treats 'expired' — it stops waiting and asks for a
          // fresh code — and adding a status the client has never seen would
          // leave it polling a word it cannot act on.
          tx.update(pairingRef, {
            status: 'refused' satisfies PairingStatus,
            deliverySecret: FieldValue.delete(),
          });
        }
      }
    });

    return { stationId, status: 'revoked' };
  }
);

// ═════════════════════════════════════════════════════════════════════════════
// COMBINED MOVEMENT GOAL — several activity goals, one shared total.
//
// THE ONE IDEA THE WHOLE FEATURE RESTS ON: **the parent has no counter.** A
// combined goal's total is a pure function of its children's existing sharded
// counters, computed at read time. Nothing here writes to wsfGoalCounters,
// nothing here runs on the contribution path, and wsfContribute, wsfAdjustGoal,
// wsfGoalPulse, wsfListGoals and wsfCreateGoal are untouched by this feature.
//
// Everything below follows from that:
//   * "atomic canonical child-and-parent credit" is satisfied by there being
//     exactly ONE write — the existing wsfContribute transaction. The instant
//     it commits, the parent's derived total includes it. There is no second
//     write to fail, to retry, or to apply twice.
//   * the existing (goal, uid, attemptId) idempotency cannot break, because no
//     code here runs when a contribution is recorded or replayed.
//   * a correction reaches the parent with NO new mechanism: wsfAdjustGoal
//     moves a child's shard total by `delta`, and the parent is the sum of
//     child shard totals, so the parent moves by exactly `delta`, once.
//   * the parent cannot drift from the children, because there is only one
//     number. Drift is not mitigated here; it is impossible.
//
// WHAT WAS REJECTED, and why, so nobody re-proposes it: a
// wsfCombinedCounters/{setupId}/shards/{i} mirror incremented inside the
// wsfContribute transaction would need, on the hot path, "which setups does
// this goal belong to" — an extra read per contribution, or a denormalized
// field on wsfGoals that has to be kept true — and wsfAdjustGoal would need a
// parallel fan-out a future correction path could forget. Two numbers, two
// places to forget. It would also re-introduce exactly the document contention
// the ten-shard fan-out and the post-commit crossing claim exist to avoid.
//
// New Admin-SDK-only collection (no firestore.rules change; the catch-all
// deny at the bottom of the WSF section covers it — same position as
// wsfGoals, wsfGoalCounters and wsfKioskStations):
//   * wsfCombinedGoals/{setupId}
//
// Every query below is a document read or an equality on a single field, so
// firestore.indexes.json is untouched too.
// ═════════════════════════════════════════════════════════════════════════════

/** A combined goal of one activity is not combined. */
const MIN_COMBINED_CHILDREN = 2;
/**
 * The cap bounds the read fan-out of the pulse: 1 setup + N goals + 10N shard
 * documents + 1 membership + 1 community. At six that is at most 69 document
 * reads, collapsed to one real read per setup per 2 s per instance by the
 * cache below.
 */
const MAX_COMBINED_CHILDREN = 6;

/**
 * THE FROZEN RULE, version 1, written down rather than implied.
 *
 *   An activity goal is eligible for a combined setup only if its own window
 *   sits entirely inside the combined window:
 *     child.startsAt >= combined.startsAt AND child.endsAt <= combined.endsAt
 *
 * This is what makes the derivation exact. wsfContribute enforces the child's
 * own window on the server ("Goal has not started yet." / "Goal window has
 * ended."), so EVERY contribution that can ever exist on an eligible child
 * necessarily lands inside the combined window. A child's lifetime shard total
 * therefore IS its in-window contribution to the parent, and the parent needs
 * no timestamp filter, no range query and no composite index.
 *
 * The alternative — a combined window narrower than a child's — would force
 * counting from wsfContributions with a createdAt range: a composite index, a
 * query on the hot read path, and a second definition of "counted" that could
 * disagree with the shards. Rejected.
 *
 * The rule is checked at freeze time AND re-checked on every read, so a
 * hand-edited document cannot quietly widen what is counted.
 */
type CombinedContributionRule = 'childWindowWithin';
const COMBINED_CONTRIBUTION_RULE: CombinedContributionRule = 'childWindowWithin';

/**
 * Version 1's whole conversion model: ONE REPETITION OF ANY ELIGIBLE ACTIVITY
 * COUNTS AS ONE UNIT OF THE COMBINED GOAL. No factor, no weighting, no
 * conversion table.
 *
 * There is deliberately no `repetitionFactor: 1` field — an unapplied stored
 * field is a trap for the next reader. If weighting is ever wanted it arrives
 * as contributionRuleVersion 2 with its own field, and every version-1 setup
 * keeps meaning exactly what it meant.
 */
const COMBINED_CONTRIBUTION_RULE_VERSION = 1;

/**
 * The explicit eligible-repetition metadata, frozen at creation.
 *
 * It records what each activity WAS when the Champion froze the setup. It is
 * not what the screen shows: the pulse reads title, unit, target and status
 * live from the child documents, because each activity keeps its own goal and
 * a Champion who renames one should see the new name. The frozen copy is the
 * record of what was agreed to, and `startsAt`/`endsAt` here are the windows
 * the frozen rule was checked against.
 */
type FrozenChild = {
  goalId: string;
  title: string;
  /** The ACTIVITY's own unit — "squats", "push-ups" — not the combined unit. */
  unit: string;
  /** The activity's own target, which it keeps. */
  target: number;
  /** Resolved through goalRepeatPolicy(), never the raw field. */
  repeatPolicy: GoalRepeatPolicy;
  /** The only value version 1 accepts or writes. See the constant above. */
  countsAs: 'repetition';
  startsAt: FirebaseFirestore.Timestamp;
  endsAt: FirebaseFirestore.Timestamp;
  statusAtFreeze: GoalStatus;
};

/**
 * The persisted setup. NO `sharedTotal`, NO `combinedTotal`, no counter
 * subcollection, no `reachedAt` — deliberately. Any stored total would be a
 * second number that can drift from the children.
 *
 * `reachedAt` in particular is absent because a crossing cannot be claimed
 * honestly from a derived sum: it would need the same post-commit claim
 * machinery recordTargetCrossing uses, on a read path with no write. "Reached
 * right now" is derived from combinedTotal >= target on the screen, which is
 * what every other surface already does.
 */
type CombinedGoalDoc = {
  communityGroupId: string;
  ownerUid: string;
  title: string;
  /** The word the COMBINED count is shown in, e.g. "movements". */
  unit: string;
  target: number;
  startsAt: FirebaseFirestore.Timestamp;
  endsAt: FirebaseFirestore.Timestamp;
  timezone: string;
  status: GoalStatus;
  contributionRule: CombinedContributionRule;
  contributionRuleVersion: number;
  children: FrozenChild[];
  /** The same ids, flat, so a later equality query needs no composite index. */
  childGoalIds: string[];
  frozenAt?: FirebaseFirestore.Timestamp;
  createdAt?: FirebaseFirestore.Timestamp;
};

/**
 * The child id list, validated at the boundary.
 *
 * THE DUPLICATE CHECK MATTERS MORE THAN IT LOOKS. A repeated id in
 * `childGoalIds` would be summed twice by the pulse and is the only way this
 * design could double-count. It is refused here AND deduped defensively on
 * read, because one guard at a boundary is not a guard against a hand edit.
 */
const COMBINED_CHILDREN_MESSAGE =
  'childGoalIds must be a list of 2 to 6 activity goals.';
const COMBINED_DUPLICATE_MESSAGE = 'Each activity may be listed once.';
const COMBINED_WINDOW_MESSAGE =
  "Every activity's own period must sit inside the combined period.";

function normalizeCombinedChildIds(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  if (v.length < MIN_COMBINED_CHILDREN || v.length > MAX_COMBINED_CHILDREN) return null;
  const ids: string[] = [];
  for (const raw of v) {
    const id = normalizeStringId(raw);
    if (!id) return null;
    ids.push(id);
  }
  return ids;
}

// ─────────────────────────────────────────────────────────────────────────────
// wsfCreateCombinedGoal — freeze a setup.
//
// AUTHORIZATION, in order, and deliberately the SAME four steps and the SAME
// strings wsfCreateGoal uses — one verification story and one champion story,
// not two:
//   1. no request.auth            -> unauthenticated, "Sign in first."
//   2. token.email_verified!==true-> failed-precondition, "Verify your email
//                                    before starting a goal."
//   3. no active membership       -> permission-denied (inside the transaction)
//   4. role !== 'foundingChampion'-> permission-denied (inside the transaction)
//
// Membership and role are read INSIDE the transaction, exactly as in
// wsfCreateGoal, so authority cannot be lost between the read and the write.
//
// Writes ONE document and reads at most 1 membership + 6 goals: a cheap, cold,
// Champion-only path.
// ─────────────────────────────────────────────────────────────────────────────

type CreateCombinedGoalRequest = {
  communityGroupId?: unknown;
  title?: unknown;
  unit?: unknown;
  target?: unknown;
  startsAt?: unknown; // ISO 8601
  endsAt?: unknown; // ISO 8601
  timezone?: unknown; // IANA
  childGoalIds?: unknown; // string[], 2..6, distinct
};

type CreateCombinedGoalResponse = { setupId: string };

export const wsfCreateCombinedGoal = onCall<CreateCombinedGoalRequest>(
  { region: 'us-central1' },
  async (request): Promise<CreateCombinedGoalResponse> => {
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

    // Every validator here is the one wsfCreateGoal uses, with the same
    // message, so a Champion meets one vocabulary across both forms.
    const communityGroupId = normalizeStringId(request.data?.communityGroupId);
    if (!communityGroupId) {
      throw new HttpsError('invalid-argument', 'communityGroupId is required.');
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
    const childGoalIds = normalizeCombinedChildIds(request.data?.childGoalIds);
    if (!childGoalIds) {
      throw new HttpsError('invalid-argument', COMBINED_CHILDREN_MESSAGE);
    }
    if (new Set(childGoalIds).size !== childGoalIds.length) {
      throw new HttpsError('invalid-argument', COMBINED_DUPLICATE_MESSAGE);
    }

    const db = getFirestore();
    const setupRef = db.collection('wsfCombinedGoals').doc();
    const startsAt = Timestamp.fromDate(startsAtDate);
    const endsAt = Timestamp.fromDate(endsAtDate);

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

      const snaps = await Promise.all(
        childGoalIds.map((id) => tx.get(db.doc(`wsfGoals/${id}`)))
      );

      const children: FrozenChild[] = [];
      for (let i = 0; i < snaps.length; i++) {
        const snap = snaps[i]!;
        const goalId = childGoalIds[i]!;
        // A goal that does not exist and a goal in ANOTHER community are the
        // byte-identical generic answer, matching wsfSetGoalDisplayAuthorization
        // and wsfListStations: this callable must not become an oracle for
        // which goal ids exist in a community the caller is not a Champion of.
        if (!snap.exists) notFound();
        const goal = snap.data() as GoalDoc;
        if (normalizeStringId(goal.communityGroupId) !== communityGroupId) notFound();

        const childStartsAt = goal.startsAt;
        const childEndsAt = goal.endsAt;
        // A child with no usable window cannot be checked against the rule, so
        // it cannot be frozen into a setup whose whole correctness is that
        // check. Same generic answer: nothing about the goal is disclosed.
        if (!childStartsAt?.toMillis || !childEndsAt?.toMillis) notFound();

        // THE FROZEN RULE, applied at freeze time. Bounds are inclusive: a
        // child whose window is exactly the combined window is eligible.
        if (
          childStartsAt.toMillis() < startsAt.toMillis() ||
          childEndsAt.toMillis() > endsAt.toMillis()
        ) {
          throw new HttpsError('failed-precondition', COMBINED_WINDOW_MESSAGE);
        }

        children.push({
          goalId,
          title: typeof goal.title === 'string' ? goal.title : '',
          unit: typeof goal.unit === 'string' ? goal.unit : '',
          target: typeof goal.target === 'number' ? goal.target : 0,
          repeatPolicy: goalRepeatPolicy(goal),
          countsAs: 'repetition',
          startsAt: childStartsAt,
          endsAt: childEndsAt,
          statusAtFreeze: goal.status === 'closed' ? 'closed' : 'active',
        });
      }

      tx.set(setupRef, {
        communityGroupId,
        ownerUid: uid,
        title,
        unit,
        target,
        startsAt,
        endsAt,
        timezone,
        status: 'active' satisfies GoalStatus,
        contributionRule: COMBINED_CONTRIBUTION_RULE,
        contributionRuleVersion: COMBINED_CONTRIBUTION_RULE_VERSION,
        children,
        childGoalIds,
        // When the rule and the window were frozen. Separate from createdAt
        // on purpose: a later slice may re-freeze a setup's children, and the
        // two dates would then be different facts.
        frozenAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    return { setupId: setupRef.id };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// wsfCombinedGoalPulse — the read.
//
// A SEPARATE CALLABLE, for the same reason wsfGoalRecentAdditions is separate:
// wsfGoalPulse publishes exactly nine fields and that shape is settled.
// Widening it would re-open a decision that was already made, and would force
// every caller entitled to a goal's totals to also receive a combined view
// they may not be entitled to.
//
// `invoker: 'public'` exactly like wsfGoalPulse — the transport is public, the
// handler is the boundary.
//
// WHAT IT DISCLOSES, in full: the community's display name, the combined
// title / unit / target / total / window / zone, and per activity its title,
// unit, target and total. NO uid, no member name, no contributor count, no
// individual contribution, no join code, no invite capability — the same list
// GoalPulseTotals withholds.
// ─────────────────────────────────────────────────────────────────────────────

type CombinedGoalPulseRequest = { setupId?: unknown };

type CombinedActivity = {
  goalId: string;
  /** Live, from the child document — each activity keeps its own goal. */
  title: string;
  unit: string;
  target: number;
  /** The child's summed shards. */
  total: number;
  countsAs: 'repetition';
  status: GoalStatus;
};

type CombinedGoalPulse = {
  setupId: string;
  status: GoalStatus;
  communityDisplayName: string;
  title: string;
  unit: string;
  target: number;
  /** Derived: the sum of the children's shard totals. Never stored. */
  combinedTotal: number;
  /** ISO, as wsfListGoals already serializes a window. */
  startsAt: string;
  endsAt: string;
  timezone: string;
  contributionRule: CombinedContributionRule;
  contributionRuleVersion: number;
  activities: CombinedActivity[];
};

// The same 2 s TTL and per-instance LRU as the goal pulse, in its own Map so
// the two caches cannot be confused for one another. Consulted AFTER the gate,
// for the same reason: a revocation must take effect on the next read, not in
// two seconds.
const COMBINED_PULSE_CACHE_TTL_MS = 2_000;
const COMBINED_PULSE_CACHE_MAX = 1_000;
const combinedPulseCache = new Map<string, { ts: number; value: CombinedGoalPulse }>();

function combinedPulseCacheGet(setupId: string, now: number): CombinedGoalPulse | null {
  const hit = combinedPulseCache.get(setupId);
  if (!hit) return null;
  if (now - hit.ts >= COMBINED_PULSE_CACHE_TTL_MS) {
    combinedPulseCache.delete(setupId);
    return null;
  }
  return hit.value;
}

function combinedPulseCacheSet(setupId: string, now: number, value: CombinedGoalPulse): void {
  if (combinedPulseCache.size >= COMBINED_PULSE_CACHE_MAX && !combinedPulseCache.has(setupId)) {
    const oldest = combinedPulseCache.keys().next().value;
    if (oldest !== undefined) combinedPulseCache.delete(oldest);
  }
  // Delete before set so eviction order stays LRU.
  combinedPulseCache.delete(setupId);
  combinedPulseCache.set(setupId, { ts: now, value });
}

type CombinedAccess = {
  asMember: boolean;
  asDisplay: boolean;
  allowed: boolean;
  communityDisplayName: string | null;
};

/**
 * THE GATE. Two independent routes, neither implying the other, exactly
 * parallel to evaluateGoalAggregateAccess:
 *
 *   asMember  — an active member of the setup's community. Members see their
 *               own community's combined progress whether or not anything is
 *               published, and are not subject to the sample suppression.
 *   asDisplay — EVERY child carries an explicit aggregateDisplayAuthorized,
 *               the community exists, and it is not sample data.
 *
 * WHY "EVERY CHILD" AND NOT "ANY CHILD". The screen shows each activity's own
 * total. Publishing the combined view when one activity is unpublished would
 * publish that activity's progress through the back door. And because the gate
 * IS the children's own flag, revoking any one child — the existing, tested,
 * owner-reviewed control — de-authorizes the combined display on the next
 * read, with no second switch that could disagree with the first. That is also
 * why the setup document carries no authorization flag of its own.
 *
 * The children are the documents already fetched by the pulse, so this costs
 * one membership read and one community read, not one per child.
 */
async function evaluateCombinedAccess(
  communityGroupId: string,
  children: GoalDoc[],
  callerUid: string | null
): Promise<CombinedAccess> {
  const db = getFirestore();

  const groupId = normalizeStringId(communityGroupId);
  if (!groupId) {
    return { asMember: false, asDisplay: false, allowed: false, communityDisplayName: null };
  }

  let asMember = false;
  if (callerUid) {
    const membershipSnap = await db.doc(`wsfMemberships/${groupId}_${callerUid}`).get();
    asMember =
      membershipSnap.exists &&
      (membershipSnap.data() as { membershipStatus?: string }).membershipStatus === 'active';
  }

  // Strict `=== true` on every child, through the same helper the single-goal
  // gate uses. An empty child list would make `every` vacuously true, so it is
  // refused explicitly rather than relied on not to happen.
  const everyChildAuthorized =
    children.length > 0 && children.every((child) => isAggregateDisplayAuthorized(child));

  let asDisplay = false;
  let communityDisplayName: string | null = null;
  if (asMember || everyChildAuthorized) {
    const groupSnap = await db.doc(`wsfCommunityGroups/${groupId}`).get();
    const group = groupSnap.exists
      ? (groupSnap.data() as { isSample?: boolean; displayName?: unknown })
      : null;
    if (group && typeof group.displayName === 'string' && group.displayName.trim() !== '') {
      communityDisplayName = group.displayName;
    }
    if (everyChildAuthorized) {
      asDisplay = group !== null && group.isSample !== true;
    }
  }

  return { asMember, asDisplay, allowed: asMember || asDisplay, communityDisplayName };
}

export const wsfCombinedGoalPulse = onCall<CombinedGoalPulseRequest>(
  { region: 'us-central1', invoker: 'public' },
  async (request): Promise<CombinedGoalPulse> => {
    const setupId = normalizeStringId(request.data?.setupId);
    if (!setupId) {
      throw new HttpsError('invalid-argument', 'setupId is required.');
    }

    const db = getFirestore();
    const setupSnap = await db.doc(`wsfCombinedGoals/${setupId}`).get();
    if (!setupSnap.exists) notFound();
    const setup = setupSnap.data() as CombinedGoalDoc;

    const communityGroupId = normalizeStringId(setup.communityGroupId);
    if (!communityGroupId) notFound();

    // Defensive dedupe. The boundary already refuses a repeated id; this is the
    // second guard, against a hand-edited document, and it is what makes
    // "a child appears in the sum exactly once" true rather than assumed.
    const rawIds = Array.isArray(setup.childGoalIds) ? setup.childGoalIds : [];
    const childIds: string[] = [];
    for (const raw of rawIds) {
      const id = normalizeStringId(raw);
      if (id && !childIds.includes(id)) childIds.push(id);
    }
    if (childIds.length < MIN_COMBINED_CHILDREN || childIds.length > MAX_COMBINED_CHILDREN) {
      notFound();
    }

    const setupStartsAt = setup.startsAt;
    const setupEndsAt = setup.endsAt;
    if (!setupStartsAt?.toMillis || !setupEndsAt?.toMillis) notFound();
    const timezone = normalizeIanaTimezone(setup.timezone) ?? '';
    const title = typeof setup.title === 'string' ? setup.title.trim() : '';
    const unit = typeof setup.unit === 'string' ? setup.unit.trim() : '';
    const target = normalizeGoalTarget(setup.target);
    const status: GoalStatus = setup.status === 'closed' ? 'closed' : 'active';
    if (!timezone || !title || !unit || target === null) notFound();
    // Version 1 is the only rule this build knows how to apply. A setup
    // carrying anything else was written by a build that understood something
    // this one does not, and guessing at it would be inventing what was agreed.
    if (
      setup.contributionRule !== COMBINED_CONTRIBUTION_RULE ||
      setup.contributionRuleVersion !== COMBINED_CONTRIBUTION_RULE_VERSION
    ) {
      notFound();
    }

    // ONE batched read for every child, at most six documents.
    const childSnaps = await db.getAll(...childIds.map((id) => db.doc(`wsfGoals/${id}`)));
    const children: GoalDoc[] = [];
    for (const snap of childSnaps) {
      // A combined goal that cannot name all of its parts does not render half
      // of itself. Nothing in this repository deletes a wsfGoals document —
      // there is no delete callable — so this is a corruption or hand-edit
      // path, handled conservatively and with the same generic answer an
      // unknown setupId gets.
      if (!snap.exists) notFound();
      const goal = snap.data() as GoalDoc;
      if (normalizeStringId(goal.communityGroupId) !== communityGroupId) notFound();
      if (!goal.startsAt?.toMillis || !goal.endsAt?.toMillis) notFound();
      // THE FROZEN RULE, RE-CHECKED ON EVERY READ. A hand-edited child window
      // cannot quietly widen what this total counts.
      if (
        goal.startsAt.toMillis() < setupStartsAt.toMillis() ||
        goal.endsAt.toMillis() > setupEndsAt.toMillis()
      ) {
        notFound();
      }
      children.push(goal);
    }

    const access = await evaluateCombinedAccess(communityGroupId, children, request.auth?.uid ?? null);
    // Byte-identical to the answer an unknown setupId gets, so the URL cannot
    // be used to learn whether a setup exists.
    if (!access.allowed) notFound();
    // Context is published only complete, the same position wsfGoalPulse takes.
    if (!access.communityDisplayName) notFound();

    // The cache is keyed by setupId, so it may only be consulted once the
    // caller is known to be entitled to this setup's aggregate. Both routes
    // yield the identical response, so one shared entry is correct.
    const now = Date.now();
    const cached = combinedPulseCacheGet(setupId, now);
    if (cached) return cached;

    // THE DERIVATION. Ten shard reads per child, batched in one pass by the
    // helper wsfListGoals already uses. This is the only place a combined
    // total exists, and it exists for the length of this response.
    const totals = await sumGoalShardsForMany(childIds);
    const activities: CombinedActivity[] = [];
    let combinedTotal = 0;
    for (let i = 0; i < childIds.length; i++) {
      const goalId = childIds[i]!;
      const goal = children[i]!;
      const total = totals.get(goalId) ?? 0;
      combinedTotal += total;
      activities.push({
        goalId,
        title: typeof goal.title === 'string' ? goal.title : '',
        unit: typeof goal.unit === 'string' ? goal.unit : '',
        target: typeof goal.target === 'number' ? goal.target : 0,
        total,
        countsAs: 'repetition',
        status: goal.status === 'closed' ? 'closed' : 'active',
      });
    }

    const pulse: CombinedGoalPulse = {
      setupId,
      status,
      communityDisplayName: access.communityDisplayName,
      title,
      unit,
      target,
      combinedTotal,
      startsAt: setupStartsAt.toDate().toISOString(),
      endsAt: setupEndsAt.toDate().toISOString(),
      timezone,
      contributionRule: COMBINED_CONTRIBUTION_RULE,
      contributionRuleVersion: COMBINED_CONTRIBUTION_RULE_VERSION,
      activities,
    };
    combinedPulseCacheSet(setupId, now, pulse);
    return pulse;
  }
);
