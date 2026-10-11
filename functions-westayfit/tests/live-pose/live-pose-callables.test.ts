/**
 * KIOSK-LIVE-POSE-2 — the callables, against the Firestore, Auth and Realtime
 * Database emulators.
 *
 *   1. When a turn becomes `active`, and only while WSF_LIVE_POSE is "1", the
 *      server mints a 43-character key, stores it on the entry and on
 *      `station.serving`, and writes `meta = { writerUid, expiresAt }`.
 *   2. The key reaches two callers only: the entry's own member (wsfMyTurn)
 *      and the station serving the turn (wsfTurnState). Nothing else returns
 *      it.
 *   3. It is deleted on every path out of `active`, and lazily by wsfTurnState
 *      and wsfStationState once it is expired or orphaned.
 *   4. A new key replaces the station's earlier one.
 *   5. It is never a contribution: a frame claiming 999 reps changes nothing a
 *      Record records.
 *   6. With the switch off, nothing is minted, `livePose` is null and nothing
 *      is written to the Realtime Database.
 *
 * All fixtures are synthetic and local to the demo-wsf-local emulators.
 */
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

import {
  KEY_SHAPE,
  PROJECT,
  adminDb,
  anon,
  callAs,
  callNext,
  complete,
  entryOf,
  eventually,
  frame,
  goneEventually,
  join,
  kiosk,
  myTurn,
  phone,
  poseNode,
  rulesEnvironment,
  scene,
  setMeta,
  start,
  startTurn,
  state,
  stationDoc,
  uniq,
  type Station,
} from './harness';
import {
  wsfCancelTurn,
  wsfCompleteMyTurn,
  wsfEventContext,
  wsfLeaveTurnLine,
  wsfListStations,
  wsfRevokeStation,
  wsfStationState,
  wsfTurnReady,
} from '../../src/index';
import { LIVE_POSE_TTL_MS, livePoseDatabaseUrl } from '../../src/live-pose';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await rulesEnvironment();
  await getFirestore().doc('_warmup/wsf-live-pose').set({ at: Date.now() }, { merge: true });
}, 30_000);

afterAll(async () => {
  delete process.env.WSF_LIVE_POSE;
  await env.cleanup();
  await adminDb().goOffline();
});

beforeEach(() => {
  process.env.WSF_LIVE_POSE = '1';
});

const stationState = (s: Station) =>
  anon(wsfStationState, { stationId: s.stationId, secret: s.secret }) as Promise<Record<string, unknown>>;

/** A started turn at screen one, and the key it was given. */
async function liveTurn() {
  const sc = await scene();
  const turn = await startTurn(sc.one, sc.goalId, sc.a, 'Ann');
  const entry = await entryOf(turn.entryId);
  const key = entry.poseKey as string;
  // Every test built on this starts from a real, armed key; without these two
  // lines an exit-path test would pass vacuously on a build that mints none.
  expect(key).toMatch(KEY_SHAPE);
  expect(await poseNode(key)).not.toBeNull();
  return { ...sc, ...turn, entry, key };
}

async function expectRetired(key: string, s: Station, entryId: string): Promise<void> {
  expect(await goneEventually(key)).toBe(true);
  const entry = await entryOf(entryId);
  expect('poseKey' in entry).toBe(false);
  expect('poseExpiresAt' in entry).toBe(false);
  expect(
    await eventually(async () => ((await stationDoc(s)).livePoseKey ?? null) === null)
  ).toBe(true);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE KEY IS MINTED WHEN THE TURN STARTS
// ═══════════════════════════════════════════════════════════════════════════

describe('starting a turn mints its key', () => {
  test('43 base64url characters, on the entry and on serving, with meta naming the entry owner and the 2-minute expiry', async () => {
    const t = await liveTurn();
    expect(t.key).toMatch(KEY_SHAPE);
    const startedAt = (t.entry.attemptStartedAt as { toMillis: () => number }).toMillis();
    expect(t.entry.poseExpiresAt).toBe(startedAt + LIVE_POSE_TTL_MS);
    expect(LIVE_POSE_TTL_MS).toBe(120_000);

    const station = await stationDoc(t.one);
    const serving = station.serving as Record<string, unknown>;
    expect(serving.entryId).toBe(t.entryId);
    expect(serving.poseKey).toBe(t.key);
    expect(serving.poseExpiresAt).toBe(t.entry.poseExpiresAt);
    expect(station.livePoseKey).toBe(t.key);

    expect(await poseNode(t.key)).toEqual({
      meta: { writerUid: t.a, expiresAt: t.entry.poseExpiresAt },
    });
  });

  test('every turn gets its own key', async () => {
    const keys = new Set<string>();
    for (let i = 0; i < 3; i += 1) keys.add((await liveTurn()).key);
    expect(keys.size).toBe(3);
  });

  test('no key before the turn is active: waiting, assigned and ready carry none', async () => {
    const { goalId, one, a } = await scene();
    const { entryId } = await join(goalId, a, 'Ann');
    expect((await myTurn(a, goalId)).livePose).toBeNull();
    await callNext(one);
    expect((await state(one)).livePose).toBeNull();
    expect((await myTurn(a, goalId)).livePose).toBeNull();
    await callAs(wsfTurnReady, a, { entryId });
    expect((await state(one)).livePose).toBeNull();
    expect((await myTurn(a, goalId)).livePose).toBeNull();
    const entry = await entryOf(entryId);
    expect('poseKey' in entry).toBe(false);
    expect(((await stationDoc(one)).livePoseKey ?? null)).toBeNull();
  });

  test('a replayed start mints nothing: same key, same meta', async () => {
    const t = await liveTurn();
    await start(t.one, t.turnRef);
    const again = await entryOf(t.entryId);
    expect(again.poseKey).toBe(t.key);
    expect((await stationDoc(t.one)).livePoseKey).toBe(t.key);
    expect(await poseNode(t.key)).toEqual({
      meta: { writerUid: t.a, expiresAt: t.entry.poseExpiresAt },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. WHO RECEIVES THE KEY
// ═══════════════════════════════════════════════════════════════════════════

describe('the key reaches the turn owner and the serving station, and nobody else', () => {
  test('wsfMyTurn gives it to the owner; wsfTurnState gives it to the serving station', async () => {
    const t = await liveTurn();
    const expected = { key: t.key, expiresAt: t.entry.poseExpiresAt };
    expect((await myTurn(t.a, t.goalId)).livePose).toEqual(expected);
    expect((await state(t.one)).livePose).toEqual(expected);
  });

  test("a station whose serving pointer does not name the key is given none, though its owner still is", async () => {
    const t = await liveTurn();
    // A hand edit: the screen's pointer still names the turn, but not its key.
    await getFirestore()
      .doc(`wsfKioskStations/${t.one.stationId}`)
      .update({ 'serving.poseKey': FieldValue.delete() });
    expect((await state(t.one)).livePose).toBeNull();
    expect((await myTurn(t.a, t.goalId)).livePose?.key).toBe(t.key);
  });

  test('another member, a waiting member, and the other station get null', async () => {
    const t = await liveTurn();
    await join(t.goalId, t.b, 'Ben');
    expect((await myTurn(t.b, t.goalId)).livePose).toBeNull();
    const outsider = uniq('outsider');
    await getFirestore().doc(`wsfMemberships/${t.groupId}_${outsider}`).set({
      groupId: t.groupId,
      userId: outsider,
      role: 'member',
      membershipStatus: 'active',
    });
    expect((await myTurn(outsider, t.goalId)).livePose).toBeNull();
    expect((await state(t.two)).livePose).toBeNull();
  });

  test('no other answer carries the key, whatever its field is called', async () => {
    const t = await liveTurn();
    await join(t.goalId, t.b, 'Ben');
    const answers: unknown[] = [
      t.started,
      await start(t.one, t.turnRef),
      await callNext(t.two),
      await stationState(t.one),
      await stationState(t.two),
      await callAs(wsfListStations, t.championUid, { goalId: t.goalId }),
      await callAs(wsfEventContext, t.a, { goalId: t.goalId }),
      await myTurn(t.b, t.goalId),
    ];
    for (const answer of answers) {
      expect(JSON.stringify(answer)).not.toContain(t.key);
      expect(answer as object).not.toHaveProperty('livePose.key');
    }
    expect(t.started).not.toHaveProperty('livePose');

    const cancelled = await anon(wsfCancelTurn, {
      stationId: t.two.stationId,
      secret: t.two.secret,
      expectedTurn: (await state(t.two)).assigned?.turnRef,
    });
    expect(JSON.stringify(cancelled)).not.toContain(t.key);
    expect(cancelled).not.toHaveProperty('livePose');

    const recorded = await complete(t.one, t.turnRef, 3);
    expect(JSON.stringify(recorded)).not.toContain(t.key);
    expect(recorded).not.toHaveProperty('livePose');
  });

  test('the answers keep every field they had, and add only livePose', async () => {
    const t = await liveTurn();
    const hall = await state(t.one);
    expect(Object.keys(hall)).toEqual([
      'stationId',
      'stationLabel',
      'assigned',
      'result',
      'waitingCount',
      'livePose',
    ]);
    expect(Object.keys(hall.assigned as object)).toEqual([
      'code',
      'calledName',
      'state',
      'readySecondsLeft',
      'activityUnit',
      'activityTitle',
      'turnRef',
    ]);
    const mine = await myTurn(t.a, t.goalId);
    expect(Object.keys(mine)).toEqual(['turn', 'receipt', 'livePose']);
    expect(Object.keys(mine.turn as object)).toEqual([
      'entryId',
      'code',
      'calledName',
      'status',
      'goalId',
      'activityUnit',
      'activityTitle',
      'ahead',
      'stationLabel',
      'readySecondsLeft',
      'attemptOpen',
    ]);
  });

  test('the key in hand works end to end: the owner writes a frame, the kiosk reads it, another member cannot write', async () => {
    const t = await liveTurn();
    const mine = (await myTurn(t.a, t.goalId)).livePose as { key: string };
    const hall = (await state(t.one)).livePose as { key: string };
    const path = `wsfLivePose/${mine.key}/frame`;
    await assertSucceeds(phone(env, t.a).ref(path).set(frame(1, 0, 4)));
    const seen = await assertSucceeds(kiosk(env).ref(`wsfLivePose/${hall.key}/frame`).once('value'));
    expect(seen.val()).toEqual(frame(1, 0, 4));
    await assertFails(phone(env, t.b).ref(path).set(frame(2, 50, 5)));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE KILL SWITCH
// ═══════════════════════════════════════════════════════════════════════════

describe('with WSF_LIVE_POSE anything but "1", nothing is minted and nothing is written', () => {
  for (const value of [undefined, '', '0', 'true', 'yes', ' 1', '1 ']) {
    test(`WSF_LIVE_POSE=${JSON.stringify(value)}`, async () => {
      if (value === undefined) delete process.env.WSF_LIVE_POSE;
      else process.env.WSF_LIVE_POSE = value;
      const { goalId, one, a } = await scene();
      const { entryId, turnRef } = await startTurn(one, goalId, a, 'Ann');

      const entry = await entryOf(entryId);
      expect('poseKey' in entry).toBe(false);
      expect('poseExpiresAt' in entry).toBe(false);
      const station = await stationDoc(one);
      expect('livePoseKey' in station).toBe(false);
      expect(Object.keys(station.serving as object).sort()).toEqual(
        ['calledAt', 'calledName', 'entryId', 'position', 'turnRef'].sort()
      );
      expect((await myTurn(a, goalId)).livePose).toBeNull();
      expect((await state(one)).livePose).toBeNull();

      // Nothing in the Realtime Database names this member.
      const all = ((await adminDb().ref('wsfLivePose').once('value')).val() ?? {}) as Record<
        string,
        { meta?: { writerUid?: string } }
      >;
      expect(Object.values(all).some((n) => n?.meta?.writerUid === a)).toBe(false);

      // The turn records exactly as before.
      const recorded = (await complete(one, turnRef, 6)) as { recorded: { amount: number } };
      expect(recorded.recorded.amount).toBe(6);
    });
  }

  test('switched off mid-turn: the key stops being handed out, and no delete is attempted', async () => {
    const t = await liveTurn();
    process.env.WSF_LIVE_POSE = '0';
    expect((await myTurn(t.a, t.goalId)).livePose).toBeNull();
    expect((await state(t.one)).livePose).toBeNull();
    await complete(t.one, t.turnRef, 2);
    // No Realtime Database write while off: the node is still there, and its
    // own expiresAt is what retires it.
    expect(await poseNode(t.key)).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. DELETED ON EVERY PATH OUT OF `active`
// ═══════════════════════════════════════════════════════════════════════════

describe('every path out of active deletes the key', () => {
  test('the station records the turn (wsfCompleteTurn)', async () => {
    const t = await liveTurn();
    await complete(t.one, t.turnRef, 5);
    await expectRetired(t.key, t.one, t.entryId);
    expect('poseKey' in ((await stationDoc(t.one)).serving as object)).toBe(false);
    expect((await state(t.one)).livePose).toBeNull();
  });

  test('the member records it on their phone (wsfCompleteMyTurn)', async () => {
    const t = await liveTurn();
    await callAs(wsfCompleteMyTurn, t.a, { entryId: t.entryId, count: 5 });
    await expectRetired(t.key, t.one, t.entryId);
    expect((await myTurn(t.a, t.goalId)).livePose).toBeNull();
  });

  test('the station cancels it (wsfCancelTurn)', async () => {
    const t = await liveTurn();
    await anon(wsfCancelTurn, { stationId: t.one.stationId, secret: t.one.secret, expectedTurn: t.turnRef });
    await expectRetired(t.key, t.one, t.entryId);
  });

  test('the member leaves, or switches to their phone (wsfLeaveTurnLine)', async () => {
    for (const switchingToPhone of [false, true]) {
      const t = await liveTurn();
      await callAs(wsfLeaveTurnLine, t.a, { entryId: t.entryId, switchingToPhone });
      await expectRetired(t.key, t.one, t.entryId);
    }
  });

  test('the station is revoked: the turn goes back to the line without its key, and its next start mints a new one', async () => {
    const t = await liveTurn();
    await callAs(wsfRevokeStation, t.championUid, { stationId: t.one.stationId });
    await expectRetired(t.key, t.one, t.entryId);
    const back = await entryOf(t.entryId);
    expect(back.status).toBe('waiting');
    expect(back.attemptId ?? null).toBeNull();

    await callNext(t.two);
    const ref = (await state(t.two)).assigned?.turnRef as string;
    await callAs(wsfTurnReady, t.a, { entryId: t.entryId });
    await start(t.two, ref);
    const restarted = await entryOf(t.entryId);
    expect(restarted.poseKey).toMatch(KEY_SHAPE);
    expect(restarted.poseKey).not.toBe(t.key);
    expect((await state(t.two)).livePose?.key).toBe(restarted.poseKey);
  });

  test('revoking also deletes a key the station still had recorded from an earlier turn', async () => {
    const t = await liveTurn();
    await complete(t.one, t.turnRef, 1);
    await expectRetired(t.key, t.one, t.entryId);
    // As if that delete had failed: the node and the pointer are back.
    await setMeta(t.key, { writerUid: t.a, expiresAt: Date.now() + 60_000 });
    await getFirestore().doc(`wsfKioskStations/${t.one.stationId}`).update({ livePoseKey: t.key });
    await callAs(wsfRevokeStation, t.championUid, { stationId: t.one.stationId });
    expect(await goneEventually(t.key)).toBe(true);
  });

  test('expiry: wsfTurnState stops handing the key out and deletes it, and the turn still records', async () => {
    const t = await liveTurn();
    const past = Date.now() - 1;
    await getFirestore().doc(`wsfTurnEntries/${t.entryId}`).update({ poseExpiresAt: past });
    await getFirestore()
      .doc(`wsfKioskStations/${t.one.stationId}`)
      .update({ 'serving.poseExpiresAt': past });
    await setMeta(t.key, { writerUid: t.a, expiresAt: past });

    expect((await state(t.one)).livePose).toBeNull();
    expect((await myTurn(t.a, t.goalId)).livePose).toBeNull();
    expect(await goneEventually(t.key)).toBe(true);
    expect(((await stationDoc(t.one)).livePoseKey ?? null)).toBeNull();

    const recorded = (await complete(t.one, t.turnRef, 9)) as { recorded: { amount: number } };
    expect(recorded.recorded.amount).toBe(9);
  });

  test('expiry: wsfStationState deletes it too', async () => {
    const t = await liveTurn();
    const past = Date.now() - 1;
    await getFirestore()
      .doc(`wsfKioskStations/${t.one.stationId}`)
      .update({ 'serving.poseExpiresAt': past });
    await stationState(t.one);
    expect(await goneEventually(t.key)).toBe(true);
    expect(((await stationDoc(t.one)).livePoseKey ?? null)).toBeNull();
  });

  test('an orphaned key (its turn ended and the delete failed) is deleted by the next wsfTurnState, and by wsfStationState', async () => {
    for (const poll of [state, stationState]) {
      const t = await liveTurn();
      await complete(t.one, t.turnRef, 1);
      await expectRetired(t.key, t.one, t.entryId);
      await setMeta(t.key, { writerUid: t.a, expiresAt: Date.now() + 60_000 });
      await getFirestore().doc(`wsfKioskStations/${t.one.stationId}`).update({ livePoseKey: t.key });
      await poll(t.one);
      expect(await goneEventually(t.key)).toBe(true);
      expect(((await stationDoc(t.one)).livePoseKey ?? null)).toBeNull();
    }
  });

  test('a live key is left alone by the sweep', async () => {
    const t = await liveTurn();
    for (let i = 0; i < 3; i += 1) {
      await state(t.one);
      await stationState(t.one);
    }
    expect(await poseNode(t.key)).not.toBeNull();
    expect((await stationDoc(t.one)).livePoseKey).toBe(t.key);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. A NEW KEY REPLACES THE STATION'S OLD ONE
// ═══════════════════════════════════════════════════════════════════════════

describe("a new key replaces the station's earlier one", () => {
  test('the earlier key is deleted when the next turn starts at that station', async () => {
    const t = await liveTurn();
    await complete(t.one, t.turnRef, 1);
    await expectRetired(t.key, t.one, t.entryId);

    // The next person is called and taps ready. Only THEN is the earlier key
    // put back, as if the delete after that Record had failed, so no
    // wsfTurnState sweep runs between it and the start: the start's own delete
    // is the only thing that can take it down.
    const { entryId: nextEntryId } = await join(t.goalId, t.b, 'Ben');
    await callNext(t.one);
    const ref = (await state(t.one)).assigned?.turnRef as string;
    await callAs(wsfTurnReady, t.b, { entryId: nextEntryId });
    await setMeta(t.key, { writerUid: t.a, expiresAt: Date.now() + 60_000 });
    await getFirestore().doc(`wsfKioskStations/${t.one.stationId}`).update({ livePoseKey: t.key });

    await start(t.one, ref);
    const next = { entryId: nextEntryId };
    const nextKey = (await entryOf(next.entryId)).poseKey as string;
    expect(nextKey).toMatch(KEY_SHAPE);
    expect(nextKey).not.toBe(t.key);
    expect(await goneEventually(t.key)).toBe(true);
    expect(await poseNode(nextKey)).toEqual({
      meta: { writerUid: t.b, expiresAt: (await entryOf(next.entryId)).poseExpiresAt },
    });
    expect((await stationDoc(t.one)).livePoseKey).toBe(nextKey);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. NEVER A CONTRIBUTION
// ═══════════════════════════════════════════════════════════════════════════

describe('a frame is never a contribution', () => {
  async function recordedWith(rep: number | null, via: 'station' | 'phone') {
    const t = await liveTurn();
    if (rep !== null) {
      const path = `wsfLivePose/${t.key}/frame`;
      await assertSucceeds(phone(env, t.a).ref(path).set(frame(1, 0, rep)));
      await assertSucceeds(phone(env, t.a).ref(path).set(frame(2, 50, rep)));
    }
    let amount: number;
    let addedCount: number;
    if (via === 'station') {
      const res = (await complete(t.one, t.turnRef, 7)) as {
        recorded: { amount: number };
        receipt: { addedCount: number; alreadyRecorded: boolean };
      };
      amount = res.recorded.amount;
      addedCount = res.receipt.addedCount;
    } else {
      const res = (await callAs(wsfCompleteMyTurn, t.a, { entryId: t.entryId, count: 7 })) as {
        receipt: { addedCount: number };
      };
      amount = res.receipt.addedCount;
      addedCount = res.receipt.addedCount;
    }
    const contributions = (
      await getFirestore()
        .collection('wsfContributions')
        .where('goalId', '==', t.goalId)
        .where('userId', '==', t.a)
        .get()
    ).docs.map((d) => (d.data() as { count: number }).count);
    const total = ((await getFirestore().doc(`wsfGoalMemberTotals/${t.goalId}_${t.a}`).get()).data() as
      | { total?: number }
      | undefined)?.total;
    const entry = await entryOf(t.entryId);
    const receipt = (await myTurn(t.a, t.goalId)).receipt;
    return {
      amount,
      addedCount,
      contributions,
      total,
      resultAmount: entry.resultAmount,
      receiptAmount: receipt?.amount,
    };
  }

  for (const via of ['station', 'phone'] as const) {
    test(`with frame.rep = 999, the ${via} Record of 7 records 7, exactly as with no frame at all`, async () => {
      const withFrame = await recordedWith(999, via);
      const without = await recordedWith(null, via);
      expect(withFrame).toEqual(without);
      expect(withFrame).toEqual({
        amount: 7,
        addedCount: 7,
        contributions: [7],
        total: 7,
        resultAmount: 7,
        receiptAmount: 7,
      });
    });
  }

  test('no function reads the Realtime Database, and no write is made at a path that holds a key', async () => {
    const { readFileSync } = await import('fs');
    const path = await import('path');
    const src = (f: string) => readFileSync(path.resolve(__dirname, '../../src', f), 'utf8');
    const livePose = src('live-pose.ts');
    const index = src('index.ts');
    // index.ts never touches the Realtime Database directly.
    expect(index).not.toMatch(/firebase-admin\/database/);
    expect(index).not.toMatch(/getDatabase/);
    // live-pose.ts reaches the Realtime Database only through poseRoot, which
    // loads the SDK on first use; the module imports nothing from it.
    expect(livePose).not.toMatch(/^import .*firebase-admin\/database/m);
    expect(livePose.match(/getDatabaseWithUrl\(/g)).toHaveLength(1);
    expect(livePose.match(/import\('firebase-admin\/database'\)/g)).toHaveLength(1);
    const poseRootBody = livePose.slice(
      livePose.indexOf('async function poseRoot('),
      livePose.indexOf('\n}\n', livePose.indexOf('async function poseRoot('))
    );
    expect(poseRootBody).toContain("await import('firebase-admin/database')");
    // The only reference is `/wsfLivePose` itself: no path below it, so no
    // path the SDK could print holds a key (W3 F1).
    expect(livePose.match(/\.ref\(/g)).toHaveLength(1);
    expect(poseRootBody).toContain('.ref(LIVE_POSE_ROOT)');
    expect(livePose.match(/await poseRoot\(/g)).toHaveLength(2);
    // Every call on it is an update, and there are exactly three: the meta
    // write and the delete, both inside the deadline, and the delete queued
    // behind a meta write that missed it. Nothing reads.
    expect([...livePose.matchAll(/\broot\.(\w+)\(/g)].map((m) => m[1])).toEqual(['update', 'update', 'update']);
    expect(livePose).toContain('await withinDeadline(root.update({ [k]: null }));');
    expect(livePose).toContain(
      'await withinDeadline(root.update({ [`${key}/meta`]: { writerUid: args.writerUid, expiresAt: args.expiresAt } }));'
    );
    expect(livePose).toContain("void root.update({ [key]: null }).catch((cleanup) => logFailure('cleanup', cleanup));");
    // The SDK's debug log prints values; nothing turns it on.
    expect(livePose).not.toMatch(/enableLogging\(/);
    expect(index).not.toMatch(/enableLogging\(/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. A TURN THAT ENDS BEFORE ITS KEY IS ARMED
// ═══════════════════════════════════════════════════════════════════════════

describe('armPoseKey', () => {
  test('a turn that ended between the commit and meta takes its key down', async () => {
    const { armPoseKey, mintPoseKey } = await import('../../src/live-pose');
    const key = mintPoseKey();
    const stationId = uniq('station');
    await getFirestore().doc(`wsfKioskStations/${stationId}`).set({ livePoseKey: key });
    await armPoseKey({
      key,
      writerUid: uniq('writer'),
      expiresAt: Date.now() + 60_000,
      earlierKey: null,
      stationId,
      stillLive: async () => false,
    });
    expect(await poseNode(key)).toBeNull();
    expect((await getFirestore().doc(`wsfKioskStations/${stationId}`).get()).get('livePoseKey')).toBeNull();
  });

  test('a station pointer that has moved on is not cleared', async () => {
    const { retirePoseKey, mintPoseKey } = await import('../../src/live-pose');
    const old = mintPoseKey();
    const current = mintPoseKey();
    const stationId = uniq('station');
    await getFirestore().doc(`wsfKioskStations/${stationId}`).set({ livePoseKey: current });
    await setMeta(old, { writerUid: 'w', expiresAt: Date.now() + 60_000 });
    await retirePoseKey(old, stationId);
    expect(await poseNode(old)).toBeNull();
    expect((await getFirestore().doc(`wsfKioskStations/${stationId}`).get()).get('livePoseKey')).toBe(current);
  });

  test('with the switch off, retire and arm write nothing at all', async () => {
    const { armPoseKey, retirePoseKey, mintPoseKey } = await import('../../src/live-pose');
    const key = mintPoseKey();
    const fresh = mintPoseKey();
    const stationId = uniq('station');
    await getFirestore().doc(`wsfKioskStations/${stationId}`).set({ livePoseKey: key });
    await setMeta(key, { writerUid: 'w', expiresAt: Date.now() + 60_000 });
    process.env.WSF_LIVE_POSE = '0';
    await retirePoseKey(key, stationId);
    await armPoseKey({
      key: fresh,
      writerUid: 'w',
      expiresAt: Date.now() + 60_000,
      earlierKey: key,
      stationId,
      stillLive: async () => true,
    });
    expect(await poseNode(key)).not.toBeNull();
    expect(await poseNode(fresh)).toBeNull();
    expect((await getFirestore().doc(`wsfKioskStations/${stationId}`).get()).get('livePoseKey')).toBe(key);
  });

  test('livePoseIfLive: live strictly before expiresAt, never at or after it, and only for a well-formed key', async () => {
    const { livePoseIfLive, mintPoseKey } = await import('../../src/live-pose');
    const key = mintPoseKey();
    expect(livePoseIfLive(key, 1000, 999)).toEqual({ key, expiresAt: 1000 });
    expect(livePoseIfLive(key, 1000, 1000)).toBeNull();
    expect(livePoseIfLive(key, 1000, 1001)).toBeNull();
    expect(livePoseIfLive(key, '2000', 999)).toBeNull();
    expect(livePoseIfLive(key, Number.NaN, 999)).toBeNull();
    expect(livePoseIfLive(`${key}x`, 1000, 999)).toBeNull();
    expect(livePoseIfLive(key.slice(1), 1000, 999)).toBeNull();
    expect(livePoseIfLive('a/b', 1000, 999)).toBeNull();
    expect(Buffer.from(key, 'base64url')).toHaveLength(32);
  });

  test('withinDeadline: a call that never settles is cut off with deadline-exceeded, and a settled one passes through', async () => {
    const { withinDeadline, LIVE_POSE_DEADLINE_MS } = await import('../../src/live-pose');
    expect(LIVE_POSE_DEADLINE_MS).toBe(3_000);
    const startedAt = Date.now();
    const never = new Promise<never>(() => undefined);
    await expect(withinDeadline(never, 100)).rejects.toMatchObject({ code: 'deadline-exceeded' });
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    await expect(withinDeadline(Promise.resolve(7), 100)).resolves.toBe(7);
    await expect(withinDeadline(Promise.reject(Object.assign(new Error('x'), { code: 'boom' })), 100)).rejects.toMatchObject({ code: 'boom' });
  });

  test('a malformed key never reaches the SDK: it is logged with no key and no uid, and fails nothing', async () => {
    const { armPoseKey, removePoseKey } = await import('../../src/live-pose');
    const uid = uniq('writer');
    const bad = `bad.key#${uid}`;
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(await removePoseKey(bad)).toBe(false);
      await armPoseKey({
        key: bad,
        writerUid: uid,
        expiresAt: Date.now() + 60_000,
        earlierKey: null,
        stationId: uniq('station'),
        stillLive: async () => true,
      });
      expect(error.mock.calls).toEqual([
        ['[wsfLivePose]', 'remove', 'failed', 'bad-key'],
        ['[wsfLivePose]', 'arm', 'failed', 'bad-key'],
      ]);
      expect(warn).not.toHaveBeenCalled();
      const logged = JSON.stringify([error.mock.calls, warn.mock.calls]);
      expect(logged).not.toContain(uid);
      expect(logged).not.toContain('bad.key');
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
  });

  test('a write the server refuses is logged without its key, by this module and by the SDK (W3 F1)', async () => {
    const { mintPoseKey } = await import('../../src/live-pose');
    const held = mintPoseKey();
    const fresh = mintPoseKey();
    const earlier = mintPoseKey();
    const uid = uniq('writer');
    // A node the refused delete cannot take down: `meta` written by the
    // functions' own (admin) connection, as after a successful arm.
    await setMeta(held, { writerUid: uid, expiresAt: Date.now() + 60_000 });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await jest.isolateModulesAsync(async () => {
        // A second copy of the module and the Admin SDK, whose default app
        // reaches the database emulator with no credentials at all. Under the
        // reviewed rules every write it makes is refused by the server: a
        // real refusal, through the module's own code, with nothing stubbed.
        const { initializeApp } = await import('firebase-admin/app');
        initializeApp({ projectId: PROJECT, databaseAuthVariableOverride: null });
        const { getDatabaseWithUrl } = await import('firebase-admin/database');
        const lp = await import('../../src/live-pose');
        try {
          expect(await lp.removePoseKey(held)).toBe(false);
          await lp.armPoseKey({
            key: fresh,
            writerUid: uid,
            expiresAt: Date.now() + 60_000,
            earlierKey: earlier,
            stationId: uniq('station'),
            stillLive: async () => true,
          });
          // The delete queued behind the refused meta write is not awaited:
          // wait for its own refusal.
          await eventually(async () => warn.mock.calls.length >= 4);
        } finally {
          await getDatabaseWithUrl(livePoseDatabaseUrl(PROJECT)).goOffline();
        }
      });
      // No line, the SDK's or this module's, carries a key or the uid.
      const logged = JSON.stringify([warn.mock.calls, error.mock.calls]);
      for (const k of [held, fresh, earlier]) expect(logged).not.toContain(k);
      expect(logged).not.toContain(uid);
      // The refusals were real: the held node is still there.
      expect(await poseNode(held)).not.toBeNull();
      expect(await poseNode(fresh)).toBeNull();
      // The SDK logged each refusal, at `/wsfLivePose` only.
      const warned = warn.mock.calls.map((c) => c.map(String).join(' '));
      expect(warned).toHaveLength(4);
      for (const line of warned) {
        expect(line).toMatch(/FIREBASE WARNING: update at \/wsfLivePose failed: permission_denied\s*$/);
      }
      // This module logged an operation and a code: delete, earlier delete,
      // arm, and the queued delete.
      expect(error.mock.calls).toEqual([
        ['[wsfLivePose]', 'remove', 'failed', 'PERMISSION_DENIED'],
        ['[wsfLivePose]', 'remove', 'failed', 'PERMISSION_DENIED'],
        ['[wsfLivePose]', 'arm', 'failed', 'PERMISSION_DENIED'],
        ['[wsfLivePose]', 'cleanup', 'failed', 'PERMISSION_DENIED'],
      ]);
    } finally {
      warn.mockRestore();
      error.mockRestore();
      await adminDb().ref('wsfLivePose').update({ [held]: null });
    }
  });

  test('a meta write that misses its deadline and lands later leaves no node: the delete is queued behind it (W3 F2)', async () => {
    const { armPoseKey, mintPoseKey, LIVE_POSE_DEADLINE_MS } = await import('../../src/live-pose');
    // The functions' own connection: the module writes through this same
    // Database instance. Offline, it queues writes and settles none, which is
    // a database that does not answer within the deadline.
    const db = adminDb();
    // The server's view, from a separate connection.
    const onServer = async (k: string): Promise<unknown> => {
      let val: unknown;
      await env.withSecurityRulesDisabled(async (ctx) => {
        val = (await ctx.database().ref(`wsfLivePose/${k}`).once('value')).val();
      });
      return val;
    };
    const control = mintPoseKey();
    const key = mintPoseKey();
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      let tookMs = 0;
      db.goOffline();
      try {
        // The control: the same late meta write with nothing queued behind it.
        void db.ref('wsfLivePose').update({ [`${control}/meta`]: { writerUid: 'w', expiresAt: Date.now() + 60_000 } });
        const startedAt = Date.now();
        await armPoseKey({
          key,
          writerUid: uniq('writer'),
          expiresAt: Date.now() + 60_000,
          earlierKey: null,
          stationId: uniq('station'),
          stillLive: async () => true,
        });
        tookMs = Date.now() - startedAt;
        expect(await onServer(control)).toBeNull();
        expect(await onServer(key)).toBeNull();
      } finally {
        db.goOnline();
      }
      // The arm gave up at the deadline, and did not wait for the delete.
      expect(tookMs).toBeGreaterThanOrEqual(LIVE_POSE_DEADLINE_MS - 50);
      expect(tookMs).toBeLessThan(2 * LIVE_POSE_DEADLINE_MS);
      expect(error.mock.calls).toEqual([['[wsfLivePose]', 'arm', 'failed', 'deadline-exceeded']]);
      // A write on the same connection is answered only after every write
      // queued before it, so once it settles the late writes have landed.
      await db.ref('wsfLivePose').update({ [mintPoseKey()]: null });
      // Without the delete, the late meta is the orphan F2 describes.
      expect(await onServer(control)).toEqual({ meta: { writerUid: 'w', expiresAt: expect.any(Number) } });
      // With it, nothing is left.
      expect(await onServer(key)).toBeNull();
      expect(await poseNode(key)).toBeNull();
    } finally {
      error.mockRestore();
      await db.ref('wsfLivePose').update({ [control]: null });
    }
  });

  test('a confirmation that cannot be read takes the node down', async () => {
    const { armPoseKey, mintPoseKey } = await import('../../src/live-pose');
    const key = mintPoseKey();
    const stationId = uniq('station');
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await armPoseKey({
        key,
        writerUid: uniq('writer'),
        expiresAt: Date.now() + 60_000,
        earlierKey: null,
        stationId,
        stillLive: async () => {
          throw Object.assign(new Error('synthetic read failure'), { code: 'unavailable' });
        },
      });
      expect(await poseNode(key)).toBeNull();
      expect(error.mock.calls).toEqual([['[wsfLivePose]', 'confirm', 'failed', 'unavailable']]);
    } finally {
      error.mockRestore();
    }
  });
});
