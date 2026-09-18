/**
 * wsfGoalRecentAdditions — the bounded, non-identifying tail of contributions.
 *
 * Two properties are pinned here and they are the whole reason this callable
 * exists separately from wsfGoalPulse:
 *
 *   1. ACCESS MIRRORS THE PULSE EXACTLY. Both go through
 *      evaluateGoalAggregateAccess, so the member / anonymous-authorized /
 *      unauthorized / revoked / sample / removed / unknown matrix must produce
 *      the SAME answers from both. The tests below call both callables for the
 *      same fixture and compare, rather than asserting a remembered list of
 *      expected codes — a change to the shared policy then moves both or
 *      fails here.
 *
 *   2. THE RESPONSE CARRIES NOTHING PER-MEMBER. Exactly one top-level key, and
 *      exactly three keys per line. The key-set assertions are exact
 *      (`Object.keys(...).sort()`), not `toMatchObject`, because the risk this
 *      file exists to catch is a FIELD BEING ADDED — a uid, a display name, a
 *      contributor count — and a subset assertion would pass straight through
 *      one.
 *
 * Runs against the local Firestore emulator via `func.run(request)`.
 */

process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import { wsfContribute, wsfGoalPulse, wsfGoalRecentAdditions } from '../../src/index';

type Data = Record<string, unknown>;
type JoinPolicy = 'private' | 'inviteOnly' | 'public';

function request(uid: string | null, data: Data): never {
  return {
    auth: uid ? { uid, token: { email_verified: true } } : undefined,
    data,
    rawRequest: { ip: '127.0.0.1', headers: {} },
    acceptsStreaming: false,
  } as never;
}

type Outcome<T> = { ok: true; value: T } | { ok: false; error: HttpsError };

async function attempt<T>(p: Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await p };
  } catch (e) {
    return { ok: false, error: e as HttpsError };
  }
}

function recent(uid: string | null, data: Data) {
  return attempt(wsfGoalRecentAdditions.run(request(uid, data)));
}

function pulse(uid: string | null, data: Data) {
  return attempt(wsfGoalPulse.run(request(uid, data)));
}

function contribute(uid: string, data: Data) {
  return attempt(wsfContribute.run(request(uid, data)));
}

let seq = 0;
function uniq(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

async function seedCommunity(opts: {
  joinPolicy: JoinPolicy;
  championUid: string;
  isSample?: boolean;
}): Promise<string> {
  const db = getFirestore();
  const groupId = uniq('recentGroup');
  await db.doc(`wsfCommunityGroups/${groupId}`).set({
    displayName: 'Recent additions community',
    groupType: 'custom',
    joinPolicy: opts.joinPolicy,
    joinCode: uniq('code'),
    createdByUserId: opts.championUid,
    lifecycleStatus: 'active',
    isSample: opts.isSample === true,
  });
  await db.doc(`wsfMemberships/${groupId}_${opts.championUid}`).set({
    groupId,
    userId: opts.championUid,
    role: 'foundingChampion',
    membershipStatus: 'active',
  });
  await db.doc(`wsfMemberProfiles/${opts.championUid}`).set({ displayName: opts.championUid });
  return groupId;
}

async function seedMember(groupId: string, uid: string, status = 'active'): Promise<void> {
  const db = getFirestore();
  await db.doc(`wsfMemberships/${groupId}_${uid}`).set({
    groupId,
    userId: uid,
    role: 'member',
    membershipStatus: status,
  });
  await db.doc(`wsfMemberProfiles/${uid}`).set({ displayName: uid });
}

async function seedGoal(
  groupId: string,
  opts?: { unit?: string; authorized?: boolean }
): Promise<string> {
  const now = Date.now();
  const ref = getFirestore().collection('wsfGoals').doc();
  const doc: Record<string, unknown> = {
    ownerUid: 'recentSeed',
    communityGroupId: groupId,
    title: 'Recent additions goal',
    target: 5000,
    unit: opts?.unit ?? 'squats',
    status: 'active',
    startsAt: Timestamp.fromMillis(now - 60_000),
    endsAt: Timestamp.fromMillis(now + 3_600_000),
    timezone: 'America/New_York',
  };
  if (opts?.authorized === true) doc.aggregateDisplayAuthorized = true;
  await ref.set(doc);
  return ref.id;
}

/** Everything actually stored in the tail subcollection, ids included. */
async function storedAdditions(
  goalId: string
): Promise<{ id: string; amount: number; at: string }[]> {
  const snap = await getFirestore()
    .collection('wsfGoals')
    .doc(goalId)
    .collection('recentAdditions')
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as { amount: number; at: string }) }));
}

/**
 * Seeds tail documents DIRECTLY, with chosen minutes. Used wherever a test is
 * about ordering or the bound: contributions made in one test run all land in
 * the same minute, and the read orders on the minute, so driving those cases
 * through wsfContribute would be asserting a tie-break rather than an order.
 * The append itself is driven through the real callable in its own tests.
 */
async function seedAdditions(
  goalId: string,
  entries: { id: string; amount: number; minutesAgo: number }[]
): Promise<void> {
  const db = getFirestore();
  const batch = db.batch();
  for (const e of entries) {
    const at = new Date(
      Math.floor((Date.now() - e.minutesAgo * 60_000) / 60_000) * 60_000
    ).toISOString();
    batch.set(
      db.collection('wsfGoals').doc(goalId).collection('recentAdditions').doc(e.id),
      { amount: e.amount, at }
    );
  }
  await batch.commit();
}

/** The goal document's own updateTime — used to prove it is NOT being written. */
async function goalUpdateTime(goalId: string): Promise<string> {
  const snap = await getFirestore().doc(`wsfGoals/${goalId}`).get();
  return snap.updateTime?.toDate().toISOString() ?? '';
}

beforeAll(async () => {
  await getFirestore().doc('_warmup/wsf-goal-recent-additions').set({ at: Date.now() }, { merge: true });
});

// ───────────────────────────────────────────────────────────────────────────
// ACCESS — the same matrix the pulse answers, answered the same way.
// ───────────────────────────────────────────────────────────────────────────

describe('access mirrors wsfGoalPulse exactly', () => {
  test('missing goalId -> invalid-argument, as the pulse does', async () => {
    const r = await recent(null, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid-argument');
  });

  test('ACTIVE MEMBER of an UNAUTHORIZED goal is allowed — membership is its own route', async () => {
    const groupId = await seedCommunity({ joinPolicy: 'private', championUid: uniq('champ') });
    const goalId = await seedGoal(groupId);
    const member = uniq('member');
    await seedMember(groupId, member);

    const r = await recent(member, { goalId });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.additions).toEqual([]);
    // And the pulse agrees.
    expect((await pulse(member, { goalId })).ok).toBe(true);
  });

  test('ANONYMOUS caller + AUTHORIZED goal is allowed — the display route', async () => {
    const groupId = await seedCommunity({ joinPolicy: 'private', championUid: uniq('champ') });
    const goalId = await seedGoal(groupId, { authorized: true });

    const r = await recent(null, { goalId });
    expect(r.ok).toBe(true);
    expect((await pulse(null, { goalId })).ok).toBe(true);
  });

  test('UNAUTHORIZED caller — anonymous, goal not authorized — is refused', async () => {
    const groupId = await seedCommunity({ joinPolicy: 'public', championUid: uniq('champ') });
    const goalId = await seedGoal(groupId);

    const r = await recent(null, { goalId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not-found');
    expect((await pulse(null, { goalId })).ok).toBe(false);
  });

  test('REVOKED member of an unauthorized goal is refused', async () => {
    const groupId = await seedCommunity({ joinPolicy: 'private', championUid: uniq('champ') });
    const goalId = await seedGoal(groupId);
    const revoked = uniq('revoked');
    await seedMember(groupId, revoked, 'removed');

    const r = await recent(revoked, { goalId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not-found');
    expect((await pulse(revoked, { goalId })).ok).toBe(false);
  });

  test('REMOVED member — membership document gone entirely — is refused', async () => {
    const groupId = await seedCommunity({ joinPolicy: 'private', championUid: uniq('champ') });
    const goalId = await seedGoal(groupId);
    const gone = uniq('gone');
    await seedMember(groupId, gone);
    // They contributed while they were a member, so the list is NOT empty —
    // which is what makes this case worth a test rather than a tautology.
    await contribute(gone, { goalId, attemptId: uniq('attempt'), count: 7 });
    await getFirestore().doc(`wsfMemberships/${groupId}_${gone}`).delete();

    const r = await recent(gone, { goalId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not-found');
    expect((await pulse(gone, { goalId })).ok).toBe(false);
    // The rows are still on the goal; the refusal is what withholds them.
    expect((await storedAdditions(goalId)).length).toBe(1);
  });

  test('SAMPLE community: the display route is closed, the member route is not', async () => {
    const champion = uniq('champ');
    const groupId = await seedCommunity({ joinPolicy: 'public', championUid: champion, isSample: true });
    const goalId = await seedGoal(groupId, { authorized: true });

    // §5.8 — sample data may never surface in a total presented as real to an
    // outside audience, and that applies to the tail as much as the total.
    const anon = await recent(null, { goalId });
    expect(anon.ok).toBe(false);
    if (!anon.ok) expect(anon.error.code).toBe('not-found');
    expect((await pulse(null, { goalId })).ok).toBe(false);

    // The sample community's own members are looking at their own community.
    expect((await recent(champion, { goalId })).ok).toBe(true);
    expect((await pulse(champion, { goalId })).ok).toBe(true);
  });

  test('UNKNOWN goalId and a real-but-unauthorized one are byte-identical refusals', async () => {
    const groupId = await seedCommunity({ joinPolicy: 'private', championUid: uniq('champ') });
    const realButUnauthorized = await seedGoal(groupId);

    const unknown = await recent(null, { goalId: uniq('nosuchgoal') });
    const real = await recent(null, { goalId: realButUnauthorized });
    expect(unknown.ok).toBe(false);
    expect(real.ok).toBe(false);
    if (unknown.ok || real.ok) return;
    expect(real.error.code).toBe(unknown.error.code);
    expect(real.error.message).toBe(unknown.error.message);
    expect(real.error.details).toEqual(unknown.error.details);

    // And identical to what the PULSE says for the same two ids, so the pair
    // of endpoints cannot be differenced into an existence oracle.
    const pulseUnknown = await pulse(null, { goalId: uniq('nosuchgoal') });
    if (pulseUnknown.ok) throw new Error('pulse answered an unknown goalId');
    expect(unknown.error.code).toBe(pulseUnknown.error.code);
    expect(unknown.error.message).toBe(pulseUnknown.error.message);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// SHAPE — exactly one key out, exactly three keys per line.
// ───────────────────────────────────────────────────────────────────────────

describe('the response carries an amount, a unit and a minute — and nothing else', () => {
  test('exact response keys', async () => {
    const groupId = await seedCommunity({ joinPolicy: 'private', championUid: uniq('champ') });
    const goalId = await seedGoal(groupId, { authorized: true, unit: 'squats' });
    const member = uniq('member');
    await seedMember(groupId, member);
    await contribute(member, { goalId, attemptId: uniq('attempt'), count: 20 });

    const r = await recent(null, { goalId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.value)).toEqual(['additions']);
    expect(r.value.additions.length).toBe(1);
    expect(Object.keys(r.value.additions[0]).sort()).toEqual(['amount', 'at', 'unit']);
    expect(r.value.additions[0].amount).toBe(20);
    expect(r.value.additions[0].unit).toBe('squats');
    // Minute-rounded: seconds and milliseconds are always zero.
    expect(r.value.additions[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
  });

  test('a stored document carrying an extra field cannot ride out in the response', async () => {
    // Defence against a hand edit, an import, or a future writer that is less
    // careful than wsfContribute. The handler rebuilds each line from `amount`
    // and `at` alone, so anything else on the stored document is dropped — and
    // the document's own id is never published either.
    const groupId = await seedCommunity({ joinPolicy: 'private', championUid: uniq('champ') });
    const goalId = await seedGoal(groupId, { authorized: true });
    await getFirestore()
      .collection('wsfGoals')
      .doc(goalId)
      .collection('recentAdditions')
      .doc('attempt_leak_me_0001')
      .set({ amount: 5, at: '2026-09-18T13:04:00.000Z', userId: 'leak_me', displayName: 'Dana' });

    const r = await recent(null, { goalId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.value.additions[0]).sort()).toEqual(['amount', 'at', 'unit']);
    const body = JSON.stringify(r.value);
    expect(body).not.toContain('leak_me');
    expect(body).not.toContain('Dana');
    // The attempt id names the document; it is never part of the answer.
    expect(body).not.toContain('attempt_leak_me_0001');
  });

  test('a malformed stored document is dropped, not guessed at', async () => {
    const groupId = await seedCommunity({ joinPolicy: 'private', championUid: uniq('champ') });
    const goalId = await seedGoal(groupId, { authorized: true });
    const col = getFirestore().collection('wsfGoals').doc(goalId).collection('recentAdditions');
    await col.doc('bad_amount_0001').set({ amount: 'twenty', at: '2026-09-18T13:04:00.000Z' });
    await col.doc('no_at_00000001').set({ amount: 5 });
    await col.doc('good_one_00001').set({ amount: 9, at: '2026-09-18T13:05:00.000Z' });

    const r = await recent(null, { goalId });
    expect(r.ok).toBe(true);
    // The `amount: 5` document has no `at` at all, so the orderBy does not
    // select it; the string-valued one is selected and then dropped by the
    // handler. Either way exactly one line is published.
    if (r.ok) {
      expect(r.value.additions).toEqual([
        { amount: 9, unit: 'squats', at: '2026-09-18T13:05:00.000Z' },
      ]);
    }
  });

  test('a goal with no recorded additions returns the empty list, not an error', async () => {
    const groupId = await seedCommunity({ joinPolicy: 'private', championUid: uniq('champ') });
    const goalId = await seedGoal(groupId, { authorized: true });
    const r = await recent(null, { goalId });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ additions: [] });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// APPEND — once per attempt, newest first, bounded at ten.
// ───────────────────────────────────────────────────────────────────────────

describe('wsfContribute records the tail', () => {
  test('a contribution writes ONE document, and the goal document is not touched', async () => {
    // This is the whole reason the tail is a subcollection. An array field on
    // the goal would have made every contribution a write to
    // wsfGoals/{goalId}, serializing contributions on one document and
    // defeating the counter sharding. The goal's updateTime proves it is not
    // being written.
    const groupId = await seedCommunity({ joinPolicy: 'private', championUid: uniq('champ') });
    const goalId = await seedGoal(groupId, { authorized: true });
    const member = uniq('member');
    await seedMember(groupId, member);

    const before = await goalUpdateTime(goalId);
    const attemptId = uniq('single');
    const c = await contribute(member, { goalId, attemptId, count: 3 });
    expect(c.ok).toBe(true);

    const stored = await storedAdditions(goalId);
    expect(stored).toHaveLength(1);
    expect(stored[0].amount).toBe(3);
    // The document is NAMED by the attempt id and does not contain it.
    expect(stored[0].id).toBe(attemptId);
    expect(Object.keys(stored[0]).filter((k) => k !== 'id').sort()).toEqual(['amount', 'at']);
    expect(stored[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);

    expect(await goalUpdateTime(goalId)).toBe(before);
  });

  test('REPLAY of the same attemptId cannot produce two documents', async () => {
    // Two independent reasons, and this pins both: the replay branch of
    // wsfContribute returns before the write, AND the document is named by the
    // attempt id, so even a write that did happen twice would be one document.
    const groupId = await seedCommunity({ joinPolicy: 'private', championUid: uniq('champ') });
    const goalId = await seedGoal(groupId, { authorized: true });
    const member = uniq('member');
    await seedMember(groupId, member);
    const attemptId = uniq('replay');

    const first = await contribute(member, { goalId, attemptId, count: 25 });
    expect(first.ok).toBe(true);
    for (let i = 0; i < 3; i++) {
      const replay = await contribute(member, { goalId, attemptId, count: 25 });
      expect(replay.ok).toBe(true);
      if (replay.ok) expect((replay.value as { alreadyRecorded: boolean }).alreadyRecorded).toBe(true);
    }

    const stored = await storedAdditions(goalId);
    expect(stored).toHaveLength(1);
    expect(stored[0].amount).toBe(25);
    const r = await recent(null, { goalId });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.additions).toHaveLength(1);
  });

  test('CONCURRENT replays of one attemptId still leave exactly one document', async () => {
    // Four taps racing, same attempt. Whatever interleaving the transactions
    // take, the document id is the attempt id.
    const groupId = await seedCommunity({ joinPolicy: 'private', championUid: uniq('champ') });
    const goalId = await seedGoal(groupId, { authorized: true });
    const member = uniq('member');
    await seedMember(groupId, member);
    const attemptId = uniq('race');

    const results = await Promise.all(
      [0, 1, 2, 3].map(() => contribute(member, { goalId, attemptId, count: 11 }))
    );
    expect(results.every((r) => r.ok)).toBe(true);

    const stored = await storedAdditions(goalId);
    expect(stored).toHaveLength(1);
    expect(stored[0].amount).toBe(11);
  });

  test('distinct attempts each write their own document', async () => {
    const groupId = await seedCommunity({ joinPolicy: 'private', championUid: uniq('champ') });
    const goalId = await seedGoal(groupId, { authorized: true });
    const member = uniq('member');
    await seedMember(groupId, member);

    await contribute(member, { goalId, attemptId: uniq('a'), count: 3 });
    await contribute(member, { goalId, attemptId: uniq('b'), count: 8 });

    const stored = await storedAdditions(goalId);
    expect(stored).toHaveLength(2);
    expect(stored.map((d) => d.amount).sort((x, y) => x - y)).toEqual([3, 8]);
    // Both land in the same minute in a test run, and the read orders on the
    // minute, so the ORDER between them is Firestore's tie-break and is not
    // asserted here — it is asserted on distinct minutes below. What is
    // asserted is that both are published.
    const r = await recent(null, { goalId });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.additions.map((a) => a.amount).sort((x, y) => x - y)).toEqual([3, 8]);
  });

  test('a REFUSED contribution writes nothing', async () => {
    // Non-member. The write lives after the membership gate, so there is no
    // path on which a refused attempt leaves a document behind.
    const groupId = await seedCommunity({ joinPolicy: 'private', championUid: uniq('champ') });
    const goalId = await seedGoal(groupId, { authorized: true });
    const stranger = uniq('stranger');

    const r = await contribute(stranger, { goalId, attemptId: uniq('a'), count: 5 });
    expect(r.ok).toBe(false);
    expect(await storedAdditions(goalId)).toEqual([]);
  });

  test('the shared total is unaffected by the tail — the tail is not the ledger', async () => {
    const groupId = await seedCommunity({ joinPolicy: 'private', championUid: uniq('champ') });
    const goalId = await seedGoal(groupId, { authorized: true });
    const member = uniq('member');
    await seedMember(groupId, member);
    for (let i = 1; i <= 12; i++) {
      await contribute(member, { goalId, attemptId: uniq(`total${i}`), count: 10 });
    }
    const p = await pulse(null, { goalId });
    expect(p.ok).toBe(true);
    if (p.ok) expect((p.value as { sharedTotal: number }).sharedTotal).toBe(120);
    // Twelve contributions, twelve documents stored — the subcollection is NOT
    // pruned. The bound below is a bound on what is PUBLISHED.
    expect(await storedAdditions(goalId)).toHaveLength(12);
  });
});

describe('the read is newest-first and bounded at ten', () => {
  // These cases seed the tail directly so each document has its OWN minute.
  // Contributions made inside one test run all share a minute, and ordering on
  // equal values is Firestore's tie-break, not a property worth pinning.

  test('newest first', async () => {
    const groupId = await seedCommunity({ joinPolicy: 'private', championUid: uniq('champ') });
    const goalId = await seedGoal(groupId, { authorized: true });
    await seedAdditions(goalId, [
      { id: 'attempt_oldest_01', amount: 1, minutesAgo: 30 },
      { id: 'attempt_middle_01', amount: 2, minutesAgo: 20 },
      { id: 'attempt_newest_01', amount: 3, minutesAgo: 5 },
    ]);

    const r = await recent(null, { goalId });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.additions.map((a) => a.amount)).toEqual([3, 2, 1]);
  });

  test('fourteen stored, ten published, and they are the ten newest', async () => {
    const groupId = await seedCommunity({ joinPolicy: 'private', championUid: uniq('champ') });
    const goalId = await seedGoal(groupId, { authorized: true });
    // amount i landed i minutes ago, so 1 is the newest and 14 the oldest.
    await seedAdditions(
      goalId,
      Array.from({ length: 14 }, (_, k) => ({
        id: `attempt_bound_${String(k + 1).padStart(4, '0')}`,
        amount: k + 1,
        minutesAgo: k + 1,
      }))
    );

    expect(await storedAdditions(goalId)).toHaveLength(14);
    const r = await recent(null, { goalId });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.additions).toHaveLength(10);
      expect(r.value.additions.map((a) => a.amount)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    }
  });
});

describe('the pulse is unchanged', () => {
  test('wsfGoalPulse still publishes exactly its nine fields', async () => {
    // The tail was added as a separate callable precisely so this shape could
    // not move. Asserted here, next to the change that could have moved it.
    const groupId = await seedCommunity({ joinPolicy: 'private', championUid: uniq('champ') });
    const goalId = await seedGoal(groupId, { authorized: true });
    const member = uniq('member');
    await seedMember(groupId, member);
    await contribute(member, { goalId, attemptId: uniq('nine'), count: 4 });

    const p = await pulse(null, { goalId });
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(Object.keys(p.value as object).sort()).toEqual([
        'communityDisplayName',
        'endsAt',
        'goalTitle',
        'sharedTotal',
        'startsAt',
        'status',
        'target',
        'timezone',
        'unit',
      ]);
    }
  });
});
