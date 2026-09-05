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
      const profile = profileSnap.data() as { adultConfirmation?: unknown };
      if (profile.adultConfirmation !== true) {
        throw new HttpsError(
          'failed-precondition',
          'You must confirm you are 18 or older before creating a community.'
        );
      }

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
  const header = rawRequest?.headers?.['x-forwarded-for'];
  if (typeof header === 'string' && header.length > 0) {
    // First entry is the origin client per XFF convention. Trim whitespace.
    return header.split(',')[0]!.trim();
  }
  if (Array.isArray(header) && header.length > 0 && typeof header[0] === 'string') {
    return header[0].split(',')[0]!.trim();
  }
  return rawRequest?.ip ?? 'unknown';
}

async function enforcePreviewRateLimit(ip: string, now: number): Promise<void> {
  const hash = hashIpForBucket(ip, now);
  const ref = getFirestore().doc(`wsfPreviewRateLimits/${hash}`);
  const snap = await ref.get();
  const data = snap.data() as { windowStart?: number; count?: number } | undefined;
  const windowStart = data?.windowStart ?? 0;
  const inWindow = now - windowStart < PREVIEW_RATE_LIMIT_WINDOW_MS;
  const nextCount = (inWindow ? (data?.count ?? 0) : 0) + 1;
  if (nextCount > PREVIEW_RATE_LIMIT_MAX) {
    // Distinct code from not-found so hitting the limit does not signal
    // "the code was valid" — it signals nothing about codes at all.
    throw new HttpsError('resource-exhausted', 'Too many requests. Try again shortly.');
  }
  await ref.set(
    { windowStart: inWindow ? windowStart : now, count: nextCount },
    { merge: true }
  );
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
      const profile = profileSnap.data() as { adultConfirmation?: unknown };
      if (profile.adultConfirmation !== true) {
        throw new HttpsError(
          'failed-precondition',
          'You must confirm you are 18 or older before joining a community.'
        );
      }

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
