/**
 * ANON-GATE-1 (#365 6077731662): an anonymous-provider token is refused at
 * every signed-in WSF callable, and counts as signed out wherever signing in
 * is optional.
 *
 * The shared `goarrive` project keeps Anonymous sign-in on for GoArrive's
 * share page, so any browser can mint such a token. These tests pin:
 *   1. the helpers in src/anon-gate.ts;
 *   2. the SOURCE: every `if (!request.auth)` check in index.ts is followed by
 *      requireRealIdentity(request), except wsfHealth (an operator probe that
 *      returns `{ ok: true }` and touches no data, named untouched by the
 *      packet). No `request.auth?.uid` remains: the four optional-uid sites use
 *      optionalRealUid. The public callables carry neither.
 *   3. REFUSAL at every one of the 42 gated callables, with nothing written for
 *      the anonymous uid by the write roots;
 *   4. ACCEPTANCE at the same 42 for a `password` token and for a token with no
 *      `firebase` claim (the shape every existing fixture uses): whatever each
 *      callable answers, it is never the anonymous refusal;
 *   5. the OPTIONAL-UID behavior: an anonymous token carrying a member's uid
 *      gets the signed-out answer from wsfGoalRecentAdditions and
 *      wsfGoalPulse, and the same uid on a password token gets the member's.
 *
 * Runs against the local Firestore emulator (`demo-wsf-local`) via
 * `func.run(request)`. Every uid and document here is synthetic.
 *   cd functions-westayfit
 *   firebase emulators:exec --only firestore --project demo-wsf-local "npm run test:callable"
 */

process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import { ANONYMOUS_REFUSAL, isAnonymousIdentity, optionalRealUid, requireRealIdentity } from '../../src/anon-gate';
import * as wsf from '../../src/index';

type Data = Record<string, unknown>;
type Token = Record<string, unknown>;
type Callable = { run: (req: never) => Promise<unknown> };

const RUN = `ag${Date.now().toString(36)}`;
const ANON_TOKEN: Token = { firebase: { sign_in_provider: 'anonymous' } };
const PASSWORD_TOKEN: Token = { email_verified: true, email: 'synthetic@example.invalid', firebase: { sign_in_provider: 'password' } };
const NO_CLAIM_TOKEN: Token = { email_verified: true, email: 'synthetic@example.invalid' };

/** The 42 callables that check `request.auth` and must refuse an anonymous token. */
const GATED = [
  'wsfSaveProfile', 'wsfCreateCommunity', 'wsfSendVerificationEmail', 'wsfJoinCommunity', 'wsfJoinViaMarker',
  'wsfResetJoinCode', 'wsfRemoveMember', 'wsfLeaveCommunity', 'wsfReinstateMember', 'wsfDesignateChampion',
  'wsfListChallenge', 'wsfCheckIn', 'wsfMyCommunities', 'wsfChallengePulse', 'wsfCreateGoal', 'wsfContribute',
  'wsfMyContribution', 'wsfListGoals', 'wsfSetGoalDisplayAuthorization', 'wsfAdjustGoal', 'wsfApproveStation',
  'wsfListStations', 'wsfRevokeStation', 'wsfCreateCombinedGoal', 'wsfCloseCombinedGoal', 'wsfRepairCombinedGoal',
  'wsfEventContext', 'wsfJoinTurnLine', 'wsfMyTurn', 'wsfTurnReady', 'wsfLeaveTurnLine', 'wsfCompleteMyTurn',
  'wsfSetCommunityVisibility', 'wsfCommunityMembers', 'wsfMyProfilePhoto', 'wsfSetProfilePhoto',
  'wsfRemoveProfilePhoto', 'wsfSetPortraitDecision', 'wsfSetCommunityPhotoVisibility', 'wsfCommunityFaces',
  'wsfCommunityFacePhotos', 'wsfCommunityActivity',
] as const;

/** The roots named by the packet, where an anonymous token could otherwise write. */
const ROOTS = ['wsfSaveProfile', 'wsfJoinCommunity', 'wsfJoinViaMarker', 'wsfMyProfilePhoto', 'wsfSetProfilePhoto', 'wsfRemoveProfilePhoto', 'wsfSetPortraitDecision'] as const;

const OPTIONAL_UID = ['wsfResolveMarker', 'wsfGoalPulse', 'wsfGoalRecentAdditions', 'wsfCombinedGoalPulse'] as const;
const PUBLIC_UNTOUCHED = ['wsfPreviewCommunity', 'wsfResolveMarker', 'wsfPublicPreviewLabel', 'wsfHealth'] as const;

/**
 * Data that gets each callable past any input check that runs before its auth
 * check (wsfChallengePulse validates challengeId first). The values name
 * nothing that exists, so an accepted call stops at its own validation or
 * not-found.
 */
const PROBE_DATA: Data = { challengeId: `${RUN}NoChallenge`, goalId: `${RUN}NoGoal`, groupId: `${RUN}NoGroup` };

function req(uid: string | null, token: Token | null, data: Data = PROBE_DATA): never {
  return {
    auth: uid ? { uid, token: token ?? {} } : undefined,
    data,
    rawRequest: { ip: '127.0.0.1', headers: {}, socket: { remoteAddress: '127.0.0.1' } },
    acceptsStreaming: false,
  } as never;
}

type Outcome = { ok: true; value: unknown } | { ok: false; error: HttpsError };

async function attempt(p: Promise<unknown>): Promise<Outcome> {
  try {
    return { ok: true, value: await p };
  } catch (e) {
    return { ok: false, error: e as HttpsError };
  }
}

const callable = (name: string): Callable => (wsf as unknown as Record<string, Callable>)[name];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** Each exported onCall with its source body, in source order. */
function exportedCallables(src: string): { name: string; body: string }[] {
  const starts = [...src.matchAll(/^export const (\w+)\s*=\s*onCall\b/gm)].map((m) => ({ name: m[1], at: m.index ?? 0 }));
  return starts.map((s, i) => ({ name: s.name, body: src.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : undefined) }));
}

const INDEX = stripComments(readFileSync(path.resolve(__dirname, '../../src/index.ts'), 'utf8'));

beforeAll(async () => {
  await getFirestore().doc('_warmup/wsf-anon-gate').set({ at: Date.now() }, { merge: true });
});

// ── 1. the helpers ───────────────────────────────────────────────────────────

describe('anon-gate helpers', () => {
  test('requireRealIdentity refuses an anonymous token with failed-precondition and the plain message', () => {
    let caught: unknown;
    try {
      requireRealIdentity(req('a', ANON_TOKEN));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HttpsError);
    expect((caught as HttpsError).code).toBe('failed-precondition');
    expect((caught as HttpsError).message).toBe('Sign in with an email account.');
    expect(ANONYMOUS_REFUSAL).toBe('Sign in with an email account.');
  });

  test('requireRealIdentity accepts password, other providers and a token with no firebase claim', () => {
    for (const token of [PASSWORD_TOKEN, NO_CLAIM_TOKEN, {}, { firebase: {} }, { firebase: { sign_in_provider: 'custom' } }, { firebase: { sign_in_provider: 'google.com' } }]) {
      expect(() => requireRealIdentity(req('a', token))).not.toThrow();
    }
  });

  test('requireRealIdentity still refuses a missing token as unauthenticated', () => {
    expect(() => requireRealIdentity(req(null, null))).toThrow(expect.objectContaining({ code: 'unauthenticated' }));
  });

  test('isAnonymousIdentity matches the anonymous provider exactly', () => {
    expect(isAnonymousIdentity({ uid: 'a', token: { firebase: { sign_in_provider: 'anonymous' } } })).toBe(true);
    for (const v of ['Anonymous', 'anonymous ', 'password', '', undefined, null, 1]) {
      expect(isAnonymousIdentity({ uid: 'a', token: { firebase: { sign_in_provider: v } } })).toBe(false);
    }
    expect(isAnonymousIdentity(undefined)).toBe(false);
  });

  test('optionalRealUid: the uid for a real account; null for signed-out or anonymous', () => {
    expect(optionalRealUid(req('alice', PASSWORD_TOKEN))).toBe('alice');
    expect(optionalRealUid(req('alice', NO_CLAIM_TOKEN))).toBe('alice');
    expect(optionalRealUid(req('alice', ANON_TOKEN))).toBeNull();
    expect(optionalRealUid(req(null, null))).toBeNull();
  });
});

// ── 2. the source: every site is gated ───────────────────────────────────────

describe('every WSF callable auth site carries the gate', () => {
  const fns = exportedCallables(INDEX);

  test('every `if (!request.auth)` check is followed by requireRealIdentity(request), except wsfHealth', () => {
    const gated: string[] = [];
    const missing: string[] = [];
    for (const { name, body } of fns) {
      const checks = [...body.matchAll(/if \(!request\.auth\)/g)];
      if (checks.length === 0) continue;
      expect([name, checks.length]).toEqual([name, 1]);
      // The statement right after the check (a one-line throw / notFound, or a braced block).
      const after = body.slice((checks[0].index ?? 0) + 'if (!request.auth)'.length);
      const rest = after.trimStart().startsWith('{') ? after.slice(after.indexOf('}') + 1) : after.slice(after.indexOf(';') + 1);
      if (/^\s*requireRealIdentity\(request\);/.test(rest)) gated.push(name);
      else missing.push(name);
    }
    expect(missing).toEqual(['wsfHealth']);
    expect([...gated].sort()).toEqual([...GATED].sort());
    expect(gated).toHaveLength(42);
  });

  test('no optional `request.auth?.` read remains; the four optional-uid sites use optionalRealUid', () => {
    expect(INDEX).not.toMatch(/request\.auth\?\./);
    const users = fns.filter((f) => /optionalRealUid\(request\)/.test(f.body)).map((f) => f.name);
    expect([...users].sort()).toEqual([...OPTIONAL_UID].sort());
  });

  test('the public callables carry no requireRealIdentity; wsfHealth keeps its own check', () => {
    for (const name of PUBLIC_UNTOUCHED) {
      const f = fns.find((x) => x.name === name);
      expect([name, f !== undefined]).toEqual([name, true]);
      expect([name, /requireRealIdentity/.test(f!.body)]).toEqual([name, false]);
    }
    expect(fns.find((x) => x.name === 'wsfHealth')!.body).toMatch(/if \(!request\.auth\)/);
  });
});

// ── 3. refusal at every gated callable ───────────────────────────────────────

describe('an anonymous token is refused at every signed-in WSF callable', () => {
  test.each(GATED.map((n) => [n]))('%s refuses with failed-precondition', async (name) => {
    const r = await attempt(callable(name).run(req(`${RUN}Anon${name}`, ANON_TOKEN)));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect([name, r.error.code, r.error.message]).toEqual([name, 'failed-precondition', ANONYMOUS_REFUSAL]);
    }
  });

  test('the write roots write nothing for the anonymous uid', async () => {
    const uid = `${RUN}AnonWriter`;
    const db = getFirestore();
    const calls: [string, Data][] = [
      ['wsfSaveProfile', { displayName: 'Synthetic Anonymous' }],
      ['wsfSetPortraitDecision', { decision: 'skipped' }],
      ['wsfSetProfilePhoto', { source: 'camera', image: 'data:image/jpeg;base64,AAAA' }],
      ['wsfRemoveProfilePhoto', {}],
      ['wsfJoinCommunity', { joinCode: `${RUN}NoCode` }],
      ['wsfJoinViaMarker', { slug: `${RUN}NoSlug` }],
      ['wsfMyProfilePhoto', {}],
    ];
    for (const [name, data] of calls) {
      const r = await attempt(callable(name).run(req(uid, ANON_TOKEN, data)));
      expect([name, r.ok ? 'resolved' : r.error.message]).toEqual([name, ANONYMOUS_REFUSAL]);
    }
    expect((await db.doc(`wsfMemberProfiles/${uid}`).get()).exists).toBe(false);
    expect((await db.doc(`wsfProfilePhotos/${uid}`).get()).exists).toBe(false);
    expect((await db.collection('wsfMemberships').where('userId', '==', uid).get()).size).toBe(0);
  });

  test('a signed-out caller still gets the answer each root gave before (unchanged)', async () => {
    for (const name of ROOTS) {
      const r = await attempt(callable(name).run(req(null, null)));
      expect([name, r.ok ? 'resolved' : r.error.code]).toEqual([name, 'unauthenticated']);
    }
  });
});

// ── 4. acceptance: a real account is never refused by the gate ──────────────

describe('a password token, or one with no firebase claim, passes the gate everywhere', () => {
  test.each(GATED.map((n) => [n]))('%s does not answer with the anonymous refusal', async (name) => {
    for (const [label, token] of [['password', PASSWORD_TOKEN], ['no claim', NO_CLAIM_TOKEN]] as const) {
      const r = await attempt(callable(name).run(req(`${RUN}Real${name}${label === 'password' ? 'Pw' : 'Nc'}`, token)));
      expect([name, label, r.ok ? 'resolved' : r.error.message === ANONYMOUS_REFUSAL ? 'ANON REFUSAL' : 'other']).not.toEqual([name, label, 'ANON REFUSAL']);
    }
  });

  test('a password account saves its profile at the wsfSaveProfile root', async () => {
    const uid = `${RUN}PwSaver`;
    const r = await attempt(callable('wsfSaveProfile').run(req(uid, PASSWORD_TOKEN, { displayName: 'Synthetic Password' })));
    expect(r).toEqual({ ok: true, value: { created: true } });
    expect((await getFirestore().doc(`wsfMemberProfiles/${uid}`).get()).exists).toBe(true);
    await getFirestore().doc(`wsfMemberProfiles/${uid}`).delete();
  });
});

// ── 5. optional uid: anonymous counts as signed out ─────────────────────────

describe('an anonymous token counts as signed out where signing in is optional', () => {
  async function seedPrivateGoalWithMember(member: string): Promise<string> {
    const db = getFirestore();
    const groupId = `${RUN}Group${member}`;
    const champion = `${RUN}Champ${member}`;
    await db.doc(`wsfCommunityGroups/${groupId}`).set({
      displayName: 'Anon gate community',
      groupType: 'custom',
      joinPolicy: 'private',
      joinCode: `${RUN}Code${member}`,
      createdByUserId: champion,
      lifecycleStatus: 'active',
      isSample: false,
    });
    for (const [uid, role] of [[champion, 'foundingChampion'], [member, 'member']] as const) {
      await db.doc(`wsfMemberships/${groupId}_${uid}`).set({ groupId, userId: uid, role, membershipStatus: 'active' });
      await db.doc(`wsfMemberProfiles/${uid}`).set({ displayName: uid });
    }
    const now = Date.now();
    const goal = db.collection('wsfGoals').doc();
    // Not display-authorized: only the member route can read it.
    await goal.set({
      ownerUid: champion,
      communityGroupId: groupId,
      title: 'Anon gate goal',
      target: 500,
      unit: 'squats',
      status: 'active',
      startsAt: Timestamp.fromMillis(now - 60_000),
      endsAt: Timestamp.fromMillis(now + 3_600_000),
      timezone: 'America/New_York',
    });
    return goal.id;
  }

  test.each([['wsfGoalRecentAdditions'], ['wsfGoalPulse']])('%s: the member uid on a password token reads; the same uid on an anonymous token is refused like a signed-out caller', async (name) => {
    const member = `${RUN}Member${name}`;
    const goalId = await seedPrivateGoalWithMember(member);
    const asMember = await attempt(callable(name).run(req(member, PASSWORD_TOKEN, { goalId })));
    const asAnon = await attempt(callable(name).run(req(member, ANON_TOKEN, { goalId })));
    const signedOut = await attempt(callable(name).run(req(null, null, { goalId })));
    expect(asMember.ok).toBe(true);
    expect(signedOut.ok).toBe(false);
    expect(asAnon.ok).toBe(false);
    if (!asAnon.ok && !signedOut.ok) {
      expect([asAnon.error.code, asAnon.error.message]).toEqual([signedOut.error.code, signedOut.error.message]);
    }
  });
});
