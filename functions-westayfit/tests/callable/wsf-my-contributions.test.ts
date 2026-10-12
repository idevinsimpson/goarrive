/**
 * PROGRESS-SELF-HISTORY-1: wsfMyContributions returns only the caller's own
 * recorded contributions, newest first, with a clamped limit and an honest
 * `truncated` flag, and skips rows missing a fact.
 *
 * DRAFT from the Lovable Web Twin project. NOT RUN by Lovable (no emulator in
 * that sandbox). W9 runs it in goarrive against the local Firestore emulator:
 *   cd functions-westayfit
 *   firebase emulators:exec --only firestore --project demo-wsf-local "npm run test:callable"
 * Every uid and document here is synthetic.
 */

process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import { ANONYMOUS_REFUSAL } from '../../src/anon-gate';
import * as wsf from '../../src/index';

type Data = Record<string, unknown>;
type Token = Record<string, unknown>;
type Item = { attemptId: string; goalId: string; communityId: string; amount: number; unit: string; at: string };
type Reply = { items: Item[]; truncated: boolean };

const RUN = `mc${Date.now().toString(36)}`;
const ANON_TOKEN: Token = { firebase: { sign_in_provider: 'anonymous' } };
const PASSWORD_TOKEN: Token = { email_verified: true, email: 'synthetic@example.invalid', firebase: { sign_in_provider: 'password' } };

function req(uid: string | null, token: Token | null, data: Data = {}): never {
  return {
    auth: uid ? { uid, token: token ?? {} } : undefined,
    data,
    rawRequest: { ip: '127.0.0.1', headers: {}, socket: { remoteAddress: '127.0.0.1' } },
    acceptsStreaming: false,
  } as never;
}

type Outcome = { ok: true; value: Reply } | { ok: false; error: HttpsError };
async function attempt(p: Promise<unknown>): Promise<Outcome> {
  try { return { ok: true, value: (await p) as Reply }; } catch (e) { return { ok: false, error: e as HttpsError }; }
}
const call = (uid: string | null, token: Token | null, data: Data = {}) =>
  attempt((wsf as unknown as { wsfMyContributions: { run: (r: never) => Promise<unknown> } }).wsfMyContributions.run(req(uid, token, data)));

const BASE = Date.parse('2026-10-01T12:00:00Z');

/** Seeds a row shaped exactly like wsfContribute's write; `over` replaces/removes fields. */
async function seed(uid: string, i: number, over: Data = {}): Promise<string> {
  const goalId = `${RUN}Goal`;
  const attemptId = `${RUN}${uid}A${i}`;
  const row: Data = {
    goalId, attemptId, userId: uid, count: 10 + i, shardIndex: 0, unit: 'squats',
    communityGroupId: `${RUN}Group`, crossedTarget: false,
    createdAt: Timestamp.fromMillis(BASE + i * 60_000),
    ...over,
  };
  for (const k of Object.keys(row)) if (row[k] === undefined) delete row[k];
  await getFirestore().doc(`wsfContributions/${goalId}_${uid}_${attemptId}`).set(row);
  return attemptId;
}

beforeAll(async () => {
  await getFirestore().doc('_warmup/wsf-my-contributions').set({ at: Date.now() }, { merge: true });
});

describe('wsfMyContributions identity', () => {
  test('an unauthenticated call is refused', async () => {
    const r = await call(null, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('unauthenticated');
  });

  test('an anonymous sign-in is refused', async () => {
    const r = await call(`${RUN}Anon`, ANON_TOKEN);
    expect(r.ok).toBe(false);
    if (!r.ok) expect([r.error.code, r.error.message]).toEqual(['failed-precondition', ANONYMOUS_REFUSAL]);
  });
});

describe('wsfMyContributions scope and order', () => {
  const alice = `${RUN}Alice`;
  const bob = `${RUN}Bob`;
  beforeAll(async () => {
    for (let i = 0; i < 3; i++) await seed(alice, i);
    for (let i = 0; i < 3; i++) await seed(bob, i, { communityGroupId: `${RUN}BobGroup`, goalId: `${RUN}BobGoal` });
  });

  test('only the caller\'s own rows come back, newest first, in the reviewed shape', async () => {
    const r = await call(alice, PASSWORD_TOKEN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items.map((x) => x.attemptId)).toEqual([2, 1, 0].map((i) => `${RUN}${alice}A${i}`));
    expect(r.value.items[0]).toEqual({
      attemptId: `${RUN}${alice}A2`, goalId: `${RUN}Goal`, communityId: `${RUN}Group`,
      amount: 12, unit: 'squats', at: new Date(BASE + 2 * 60_000).toISOString(),
    });
    expect(r.value.truncated).toBe(false);
  });

  test('no other member\'s ids appear anywhere in the response', async () => {
    const r = await call(alice, PASSWORD_TOKEN);
    const text = JSON.stringify(r);
    expect(text).not.toContain(bob);
    expect(text).not.toContain(`${RUN}BobGroup`);
    expect(text).not.toContain(`${RUN}BobGoal`);
    expect(text).not.toContain('userId');
    expect(text).not.toContain('shardIndex');
  });
});

describe('wsfMyContributions limit and truncated', () => {
  const many = `${RUN}Many`;
  beforeAll(async () => { for (let i = 0; i < 105; i++) await seed(many, i); });

  test('default limit is 50 and more rows mark truncated', async () => {
    const r = await call(many, PASSWORD_TOKEN);
    if (!r.ok) throw r.error;
    expect(r.value.items).toHaveLength(50);
    expect(r.value.truncated).toBe(true);
  });

  test.each([
    [500, 100], [100, 100], [7.9, 7], [0, 1], [-3, 1], ['20', 50], [null, 50], [Number.NaN, 50],
  ])('limit %p returns %p rows', async (limit, expected) => {
    const r = await call(many, PASSWORD_TOKEN, { limit } as Data);
    if (!r.ok) throw r.error;
    expect(r.value.items).toHaveLength(expected as number);
  });

  test('truncated is false exactly at the boundary and true one past it', async () => {
    const edge = `${RUN}Edge`;
    for (let i = 0; i < 5; i++) await seed(edge, i);
    const exact = await call(edge, PASSWORD_TOKEN, { limit: 5 });
    const under = await call(edge, PASSWORD_TOKEN, { limit: 4 });
    if (!exact.ok || !under.ok) throw new Error('call failed');
    expect([exact.value.items.length, exact.value.truncated]).toEqual([5, false]);
    expect([under.value.items.length, under.value.truncated]).toEqual([4, true]);
  });
});

describe('wsfMyContributions never invents a value', () => {
  test('malformed rows are skipped', async () => {
    const m = `${RUN}Malformed`;
    const good = await seed(m, 0);
    await seed(m, 1, { createdAt: '2026-10-01T12:01:00Z' });
    await seed(m, 2, { createdAt: undefined });
    await seed(m, 3, { count: 0 });
    await seed(m, 4, { count: -2 });
    await seed(m, 5, { count: '5' });
    await seed(m, 6, { unit: '' });
    await seed(m, 7, { unit: undefined });
    await seed(m, 8, { goalId: '   ' });
    await seed(m, 9, { communityGroupId: undefined });
    const r = await call(m, PASSWORD_TOKEN);
    if (!r.ok) throw r.error;
    expect(r.value.items.map((x) => x.attemptId)).toEqual([good]);
  });
});

describe('wsfMyContributions after leaving', () => {
  test('a former member still gets their history', async () => {
    const former = `${RUN}Former`;
    const groupId = `${RUN}Group`;
    await getFirestore().doc(`wsfMemberships/${groupId}_${former}`).set({ groupId, userId: former, role: 'member', membershipStatus: 'left' });
    const id = await seed(former, 0);
    const r = await call(former, PASSWORD_TOKEN);
    if (!r.ok) throw r.error;
    expect(r.value.items.map((x) => x.attemptId)).toEqual([id]);
  });
});
