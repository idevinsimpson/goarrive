/**
 * EVERGREEN-MARKER-ENTRY-1 (phase A) — wsfResolveMarker and wsfJoinViaMarker.
 *
 * A printed QR names only `/go/{markerSlug}`. These callables turn that slug
 * into one community + one goal, and let a signed-in visitor join through it.
 * What this suite pins:
 *
 *   1. FAIL CLOSED, ONE SHAPE. Unknown, malformed, inactive or half-written
 *      markers; a community that is missing, private or not active; a goal
 *      that is missing or belongs to a different community — every one is the
 *      same generic not-found that the join link uses.
 *   2. TRUTHFUL STATE. The goal's state follows the same server-time window
 *      wsfContribute enforces, so an `active` goal past `endsAt` reads 'ended'.
 *   3. NOTHING LEAKS. No join code, member, count or community id reaches a
 *      visitor; the community id is returned only to an active member.
 *   4. SAME JOIN RULES. Joining through a marker applies wsfJoinCommunity's own
 *      admission core: verified email, profile, removed stays refused,
 *      departed reactivates, a second tap is idempotent.
 *   5. REPOINTING NEVER REWRITES A GOAL. Pointing the marker elsewhere leaves
 *      both goal documents byte-identical, and a join after the repoint lands
 *      in the community the marker names NOW.
 *   6. RESOLVING HAS NO SIDE EFFECTS. No membership, contribution, turn-line or
 *      marker write happens on a scan.
 *
 * All data is synthetic and emulator-only (demo-wsf-local). No marker document
 * is written by product code; the suite seeds them with the Admin SDK.
 */

process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { mintJoinCode, wsfJoinCommunity, wsfJoinViaMarker, wsfResolveMarker } from '../../src/index';

const RUN = `m${Date.now().toString(36)}`;
const NOT_FOUND = 'This link is not valid.';
const HOUR = 60 * 60 * 1000;

let ipSeq = 0;
function makeRequest(uid: string | null, data: Record<string, unknown>, emailVerified = true): any {
  ipSeq += 1;
  return {
    auth: uid ? { uid, token: { email_verified: emailVerified } } : undefined,
    data,
    // A distinct synthetic address per call keeps the shared preview bucket
    // from coupling this suite to any other.
    rawRequest: { ip: `198.51.100.${ipSeq % 250}`, headers: {} },
    acceptsStreaming: false,
  };
}

async function attempt<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: HttpsError }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: e as HttpsError };
  }
}

const resolve = (uid: string | null, markerSlug: unknown) =>
  attempt(() => wsfResolveMarker.run(makeRequest(uid, { markerSlug })));
const join = (uid: string | null, markerSlug: unknown, emailVerified = true) =>
  attempt(() => wsfJoinViaMarker.run(makeRequest(uid, { markerSlug }, emailVerified)));

function expectNotFound(r: { ok: boolean; error?: HttpsError }) {
  expect(r.ok).toBe(false);
  expect(r.error?.code).toBe('not-found');
  expect(r.error?.message).toBe(NOT_FOUND);
}

const db = () => getFirestore();

async function seedProfile(uid: string) {
  await db().doc(`wsfMemberProfiles/${uid}`).set({ displayName: 'Synthetic Visitor' });
}

async function seedGroup(name: string, joinPolicy = 'public', lifecycleStatus = 'active') {
  const ref = db().collection('wsfCommunityGroups').doc(`${RUN}_${name}`);
  await ref.set({
    displayName: `Synthetic ${name}`,
    groupType: 'custom',
    joinPolicy,
    joinCode: mintJoinCode(),
    createdByUserId: 'seeder',
    lifecycleStatus,
    isSample: false,
  });
  return ref.id;
}

async function seedGoal(name: string, groupId: string, extra: Record<string, unknown> = {}) {
  const now = Date.now();
  const ref = db().doc(`wsfGoals/${RUN}_${name}`);
  await ref.set({
    ownerUid: 'seeder',
    communityGroupId: groupId,
    title: `Synthetic ${name} squats`,
    target: 100,
    unit: 'reps',
    status: 'active',
    startsAt: Timestamp.fromMillis(now - HOUR),
    endsAt: Timestamp.fromMillis(now + HOUR),
    timezone: 'America/New_York',
    ...extra,
  });
  return ref.id;
}

async function seedMarker(slug: string, fields: Record<string, unknown>) {
  await db().doc(`wsfMarkers/${slug}`).set({ label: 'Synthetic Flag', active: true, kioskMode: 'off', ...fields });
}

async function membership(groupId: string, uid: string) {
  return (await db().doc(`wsfMemberships/${groupId}_${uid}`).get()).data();
}

const slug = (name: string) => `${RUN}-${name}`.toLowerCase();

let expoA: string;
let expoB: string;
let goalA: string;
let goalB: string;

beforeAll(async () => {
  await db().doc('_warmup/wsf-marker-entry').set({ at: Date.now() });
  expoA = await seedGroup('expoA');
  expoB = await seedGroup('expoB', 'inviteOnly');
  goalA = await seedGoal('goalA', expoA);
  goalB = await seedGoal('goalB', expoB);
  await seedMarker(slug('flag'), { communityGroupId: expoA, goalId: goalA, label: 'Synthetic Flag 01' });
}, 30_000);

describe('wsfResolveMarker — what a scan shows', () => {
  it('a signed-out visitor sees the community, the goal and its truthful state, nothing else', async () => {
    const r = await resolve(null, slug('flag'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      markerSlug: slug('flag'),
      label: 'Synthetic Flag 01',
      communityName: 'Synthetic expoA',
      goalId: goalA,
      goalTitle: 'Synthetic goalA squats',
      goalState: 'open',
      kioskMode: 'off',
      viewer: 'signedOut',
      communityGroupId: null,
    });
    const text = JSON.stringify(r.value);
    const code = (await db().doc(`wsfCommunityGroups/${expoA}`).get()).data()!.joinCode as string;
    expect(text).not.toContain(code);
    expect(text).not.toMatch(/joinCode|count|member(s|Count)\b|uid/i);
  });

  it('a printed slug typed in capitals resolves to the same marker', async () => {
    const r = await resolve(null, `  ${slug('flag').toUpperCase()} `);
    expect(r.ok && r.value.markerSlug).toBe(slug('flag'));
  });

  it('a signed-in non-member is told so, and gets no community id', async () => {
    const r = await resolve(`${RUN}_nonmember`, slug('flag'));
    expect(r.ok && r.value.viewer).toBe('nonMember');
    expect(r.ok && r.value.communityGroupId).toBeNull();
  });

  it('an active member is recognised and given the community id', async () => {
    const uid = `${RUN}_member`;
    await db().doc(`wsfMemberships/${expoA}_${uid}`).set({
      groupId: expoA, userId: uid, role: 'member', membershipStatus: 'active',
    });
    const r = await resolve(uid, slug('flag'));
    expect(r.ok && r.value.viewer).toBe('member');
    expect(r.ok && r.value.communityGroupId).toBe(expoA);
  });

  it('a removed or departed membership reads as nonMember', async () => {
    for (const status of ['removed', 'departed']) {
      const uid = `${RUN}_${status}_view`;
      await db().doc(`wsfMemberships/${expoA}_${uid}`).set({
        groupId: expoA, userId: uid, role: 'member', membershipStatus: status,
      });
      const r = await resolve(uid, slug('flag'));
      expect(r.ok && r.value.viewer).toBe('nonMember');
    }
  });

  it('goal state follows the server-time window and the closed status', async () => {
    const now = Date.now();
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['closed', { status: 'closed' }, 'closed'],
      ['ended', { endsAt: Timestamp.fromMillis(now - 1000) }, 'ended'],
      ['upcoming', { startsAt: Timestamp.fromMillis(now + HOUR), endsAt: Timestamp.fromMillis(now + 2 * HOUR) }, 'upcoming'],
    ];
    for (const [name, extra, expected] of cases) {
      const goalId = await seedGoal(`state_${name}`, expoA, extra);
      await seedMarker(slug(`state-${name}`), { communityGroupId: expoA, goalId });
      const r = await resolve(null, slug(`state-${name}`));
      expect(r.ok && r.value.goalState).toBe(expected);
    }
  });

  it('kiosk mode is passed through exactly, for each of off / available / queue', async () => {
    for (const mode of ['off', 'available', 'queue']) {
      await seedMarker(slug(`kiosk-${mode}`), { communityGroupId: expoA, goalId: goalA, kioskMode: mode });
      const r = await resolve(null, slug(`kiosk-${mode}`));
      expect(r.ok && r.value.kioskMode).toBe(mode);
    }
  });

  it('an inviteOnly community resolves (it is link-joinable)', async () => {
    await seedMarker(slug('invite'), { communityGroupId: expoB, goalId: goalB });
    const r = await resolve(null, slug('invite'));
    expect(r.ok && r.value.communityName).toBe('Synthetic expoB');
  });
});

describe('wsfResolveMarker — fails closed with one generic shape', () => {
  it('unknown and malformed slugs', async () => {
    for (const bad of [slug('nope'), '', ' ', 'a/b', '../x', '-lead', 'trail-', 'x'.repeat(49), 'flag_01', 42, null, { a: 1 }]) {
      expectNotFound(await resolve(null, bad));
    }
  });

  it('inactive, half-written and malformed marker documents', async () => {
    const variants: Array<[string, Record<string, unknown>]> = [
      ['inactive', { active: false }],
      ['active-string', { active: 'true' }],
      ['no-goal', { goalId: undefined }],
      ['bad-goal-id', { goalId: 'a/b' }],
      ['no-community', { communityGroupId: undefined }],
      ['bad-kiosk', { kioskMode: 'always' }],
      ['empty-label', { label: '  ' }],
      ['long-label', { label: 'L'.repeat(81) }],
    ];
    for (const [name, override] of variants) {
      const doc: Record<string, unknown> = { label: 'Synthetic', active: true, kioskMode: 'off', communityGroupId: expoA, goalId: goalA, ...override };
      for (const k of Object.keys(doc)) if (doc[k] === undefined) delete doc[k];
      await db().doc(`wsfMarkers/${slug(`bad-${name}`)}`).set(doc);
      expectNotFound(await resolve(null, slug(`bad-${name}`)));
    }
  });

  it('a community that is private, paused or missing', async () => {
    const priv = await seedGroup('private', 'private');
    const paused = await seedGroup('paused', 'public', 'archived');
    for (const [name, groupId] of [['private', priv], ['paused', paused], ['missing', `${RUN}_ghost`]] as const) {
      const goalId = await seedGoal(`for_${name}`, groupId);
      await seedMarker(slug(`grp-${name}`), { communityGroupId: groupId, goalId });
      expectNotFound(await resolve(null, slug(`grp-${name}`)));
      // A member of that community gets the same answer: the marker is a
      // public link, never stronger than the community's own.
      const uid = `${RUN}_${name}_mem`;
      await db().doc(`wsfMemberships/${groupId}_${uid}`).set({ groupId, userId: uid, role: 'member', membershipStatus: 'active' });
      expectNotFound(await resolve(uid, slug(`grp-${name}`)));
    }
  });

  it("a goal that is missing or belongs to another community", async () => {
    await seedMarker(slug('goal-missing'), { communityGroupId: expoA, goalId: `${RUN}_none` });
    expectNotFound(await resolve(null, slug('goal-missing')));
    await seedMarker(slug('goal-foreign'), { communityGroupId: expoA, goalId: goalB });
    expectNotFound(await resolve(null, slug('goal-foreign')));
  });
});

describe('wsfResolveMarker — a scan writes nothing', () => {
  it('no membership, contribution, turn-line or marker write follows a resolve', async () => {
    const uid = `${RUN}_scanner`;
    const before = (await db().doc(`wsfMarkers/${slug('flag')}`).get()).updateTime;
    for (let i = 0; i < 3; i += 1) {
      await resolve(null, slug('flag'));
      await resolve(uid, slug('flag'));
    }
    expect(await membership(expoA, uid)).toBeUndefined();
    expect((await db().collection('wsfContributions').where('goalId', '==', goalA).get()).size).toBe(0);
    expect((await db().doc(`wsfTurnMembers/goal__${goalA}__${uid}`).get()).exists).toBe(false);
    expect((await db().collection('wsfTurnEntries').where('goalId', '==', goalA).get()).size).toBe(0);
    expect((await db().doc(`wsfMarkers/${slug('flag')}`).get()).updateTime?.isEqual(before!)).toBe(true);
  });
});

describe('wsfJoinViaMarker — the same admission rules as the join link', () => {
  it('refuses signed out, then no profile (verified or not), writing nothing', async () => {
    const uid = `${RUN}_gated`;
    const signedOut = await join(null, slug('flag'));
    expect(signedOut.ok === false && signedOut.error.code).toBe('unauthenticated');
    for (const verified of [false, true]) {
      const noProfile = await join(uid, slug('flag'), verified);
      expect(noProfile.ok === false && noProfile.error.code).toBe('failed-precondition');
      expect(noProfile.ok === false && noProfile.error.message).toBe('Complete your profile before joining a community.');
    }
    expect(await membership(expoA, uid)).toBeUndefined();
  });

  it('KIOSK-UNVERIFIED-PARTICIPANT-1: an unverified account with a profile joins through an approved marker', async () => {
    const uid = `${RUN}_unverified_joiner`;
    await seedProfile(uid);
    const first = await join(uid, slug('flag'), false);
    expect(first.ok && first.value).toEqual({ groupId: expoA, goalId: goalA, alreadyMember: false });
    const again = await join(uid, slug('flag'), false);
    expect(again.ok && again.value.alreadyMember).toBe(true);
    // Verifying later keeps the same membership.
    const verified = await join(uid, slug('flag'), true);
    expect(verified.ok && verified.value.alreadyMember).toBe(true);
    expect((await db().collection('wsfMemberships').where('userId', '==', uid).get()).size).toBe(1);
    // Every marker refusal still applies to an unverified caller.
    for (const s of [slug('nope'), slug('bad-inactive'), slug('grp-private'), slug('goal-foreign')]) {
      expectNotFound(await join(uid, s, false));
    }
  });

  it('joins the named community with the standard membership shape, and a second tap is idempotent', async () => {
    const uid = `${RUN}_joiner`;
    await seedProfile(uid);
    const first = await join(uid, slug('flag'));
    expect(first.ok && first.value).toEqual({ groupId: expoA, goalId: goalA, alreadyMember: false });
    const row = await membership(expoA, uid);
    expect(row).toMatchObject({ groupId: expoA, userId: uid, role: 'member', membershipStatus: 'active' });
    const second = await join(uid, slug('flag'));
    expect(second.ok && second.value).toEqual({ groupId: expoA, goalId: goalA, alreadyMember: true });
    expect((await db().collection('wsfMemberships').where('userId', '==', uid).get()).size).toBe(1);
  });

  it('a removed member stays refused with the generic answer; a departed member is reactivated', async () => {
    const removed = `${RUN}_removed`;
    const departed = `${RUN}_departed`;
    for (const [uid, status] of [[removed, 'removed'], [departed, 'departed']]) {
      await seedProfile(uid);
      await db().doc(`wsfMemberships/${expoA}_${uid}`).set({ groupId: expoA, userId: uid, role: 'member', membershipStatus: status });
    }
    expectNotFound(await join(removed, slug('flag')));
    expect((await membership(expoA, removed))?.membershipStatus).toBe('removed');
    const back = await join(departed, slug('flag'));
    expect(back.ok && back.value.alreadyMember).toBe(false);
    expect((await membership(expoA, departed))?.membershipStatus).toBe('active');
  });

  it('every resolve refusal is also a join refusal, with no membership written', async () => {
    const uid = `${RUN}_refused`;
    await seedProfile(uid);
    for (const s of [slug('nope'), slug('bad-inactive'), slug('grp-private'), slug('grp-paused'), slug('goal-foreign'), 'a/b']) {
      expectNotFound(await join(uid, s));
    }
    expect((await db().collection('wsfMemberships').where('userId', '==', uid).get()).size).toBe(0);
  });

  it('a closed goal still lets the visitor join the community (the journey then offers the community, not a start)', async () => {
    const uid = `${RUN}_closedjoin`;
    await seedProfile(uid);
    const r = await join(uid, slug('state-closed'));
    expect(r.ok && r.value.groupId).toBe(expoA);
  });

  it('joining through a marker writes no contribution, turn-line entry or timer', async () => {
    const uid = `${RUN}_sidefx`;
    await seedProfile(uid);
    await join(uid, slug('kiosk-queue'));
    expect((await db().collection('wsfContributions').where('goalId', '==', goalA).get()).size).toBe(0);
    expect((await db().doc(`wsfTurnMembers/goal__${goalA}__${uid}`).get()).exists).toBe(false);
    expect((await db().collection('wsfTurnEntries').where('goalId', '==', goalA).get()).size).toBe(0);
  });
});

describe('repointing the marker never rewrites a goal', () => {
  it('both goals are untouched, and the next scan and join follow the marker', async () => {
    const s = slug('repoint');
    await seedMarker(s, { communityGroupId: expoA, goalId: goalA });
    const goalABefore = (await db().doc(`wsfGoals/${goalA}`).get()).data();
    const goalBBefore = (await db().doc(`wsfGoals/${goalB}`).get()).data();
    const r1 = await resolve(null, s);
    expect(r1.ok && r1.value.goalId).toBe(goalA);

    // An operator repoint, done here by the Admin SDK: phase A has no repoint
    // callable by design.
    await seedMarker(s, { communityGroupId: expoB, goalId: goalB });
    const r2 = await resolve(null, s);
    expect(r2.ok && [r2.value.goalId, r2.value.communityName]).toEqual([goalB, 'Synthetic expoB']);

    const uid = `${RUN}_afterrepoint`;
    await seedProfile(uid);
    const joined = await join(uid, s);
    expect(joined.ok && joined.value).toEqual({ groupId: expoB, goalId: goalB, alreadyMember: false });
    expect(await membership(expoA, uid)).toBeUndefined();

    expect((await db().doc(`wsfGoals/${goalA}`).get()).data()).toEqual(goalABefore);
    expect((await db().doc(`wsfGoals/${goalB}`).get()).data()).toEqual(goalBBefore);
  });
});

describe('wsfJoinCommunity keeps its behaviour after the join core was shared', () => {
  it('joins by code, refuses removed, and is idempotent', async () => {
    const uid = `${RUN}_bycode`;
    await seedProfile(uid);
    const code = (await db().doc(`wsfCommunityGroups/${expoA}`).get()).data()!.joinCode as string;
    const r = await wsfJoinCommunity.run(makeRequest(uid, { joinCode: code }));
    expect(r).toEqual({ groupId: expoA, alreadyMember: false });
    expect(await wsfJoinCommunity.run(makeRequest(uid, { joinCode: code }))).toEqual({ groupId: expoA, alreadyMember: true });
    await db().doc(`wsfMemberships/${expoA}_${uid}`).update({ membershipStatus: 'removed' });
    expectNotFound(await attempt(() => wsfJoinCommunity.run(makeRequest(uid, { joinCode: code }))));
  });
});

describe('the marker collection is server-only', () => {
  it('firestore.rules names no wsfMarkers allowance, so the WSF catch-all denies every client read and write', () => {
    const rules = readFileSync(path.resolve(__dirname, '../../../firestore.rules'), 'utf8');
    expect(rules).not.toMatch(/wsfMarkers/);
    expect(rules).toMatch(/match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
  });
});
