# W7 Check 81 instruments: expected-turn native caller (inert)

Inert on this branch. These three files were written, run and kept in a **detached worktree of #596 at
`1cdbeff52555a1585595e23a87f6905aa0b694ae`** and were never pushed to the PR. They live here as text so that
`ts:check` and the W7 suite are unaffected: the spec imports `./helpers/expo-attendee-fixtures` (not on
`claude/wsf-sprint-w7-journey-qa`), and the probe imports the PR's `src/stationTurnOperation`. They are evidence for
**Check 81** (report §81). They change no product code and no other worker's spec. Emulators only (`demo-wsf-local`).

## What they prove

| # | Instrument | On the head | Why it can fail |
|---|---|---|---|
| 1 | End-to-end: A's Record reaches the server but its answer is lost; B is called; A is retried | **pass** (1/1, 46.8 s) | the retry must be A's own request byte for byte, answered with A's receipt (`alreadyRecorded`, `addedCount` 25, A's `entryId`); B gets no contribution and no attempt; the goal reads 125, then 135 after B's own turn. **Fails on the newest-ref mutant** (the retry no longer carries A's receipt) **and on the base client** (Start is refused, the record view never appears) |
| 2 | Probe test, 6 tests against the real callable SDK with only `fetch` scripted | **6 / 6** | pins five behaviours the PR's own 29 tests leave unpinned: each is **killed** by a probe (W7-4, 8, 11, 12, 16); the sixth (a stale refusal frees the screen for B's own ref) holds as well |
| 3 | 16 extra mutants of `src/stationTurnOperation.ts` (the owner's harness, my list) | PR suite kills **10 / 16**; the 6 survivors are not defects: W7-1 is an equivalent mutant (the secret identifies the station), W7-4, 8, 11, 12 and 16 are killed by the probe | pins that the code is right and the PR suite is incomplete |

## Run them

In a detached worktree of the PR's head, after `npm ci` in `apps/westayfit` and `functions-westayfit`, with the emulator stack
(firestore 8080, auth 9099, functions 5001, hosting 5010) and the emulator-flagged web build served:

```sh
cp <instrument 1> apps/westayfit/tests-e2e/sprint-w7-expected-turn-lost-record.spec.ts
cp <instrument 2> apps/westayfit/tests/w7-probe.test.ts
cd apps/westayfit
WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 WSF_PLAYWRIGHT_CHROMIUM=/opt/pw-browsers/chromium \
  npx playwright test --config=playwright.config.ts --workers=1 tests-e2e/sprint-w7-expected-turn-lost-record.spec.ts
npx vitest run tests/w7-probe.test.ts
node <instrument 3>            # mutates src/stationTurnOperation.ts in place and restores it
```

Instrument 3 is the owner's `mut-nc.mjs` (from the PR body) with the mutant list replaced; to pin the survivors, point its
`vitest` target at `tests/w7-probe.test.ts`.

## Instrument 1: `sprint-w7-expected-turn-lost-record.spec.ts`

```ts
/**
 * W7 INDEPENDENT JOURNEY QA — KIOSK-EXPECTED-TURN-NATIVE-CALLER-RECOVERY-2 (#596).
 *
 * EMULATOR ONLY (project demo-wsf-local). Synthetic fixtures only (every name is
 * labelled "Fixture", every address is under example.com). Nothing here is a
 * product test: it is an instrument, kept as text under docs/westayfit/qa/.
 *
 * THE HAZARD (#587 server contract): a Record for visitor A whose ANSWER is lost
 * is retried after the screen has moved on to visitor B. A retry that takes the
 * newest ref sends B's binding with A's count, and the server records A's count
 * to B. The right answer: the retry is A's own — A's ref, A's count — the server
 * says "already recorded" for A, B is untouched, and the goal counts A's 25 once.
 *
 * Runs against the REAL station UI and the REAL integrated server.
 */
import { expect, test, type Request } from '@playwright/test';

import {
  contributionsOf,
  joinLineFromEventPage,
  openEnrolledStation,
  openPhone,
  seedExpoEvent,
  shardTotal,
  turnEntriesOf,
} from './helpers/expo-attendee-fixtures';

test.describe.configure({ timeout: 300_000 });

test('A\'s lost Record, B called, A retried: A\'s own ref and count, A\'s receipt, B untouched, the goal counts A once', async ({
  browser,
}) => {
  const fx = await seedExpoEvent({
    tag: 'w7et',
    attendees: ['Fixture W7 Attendee A', 'Fixture W7 Attendee B'],
    target: 1000,
    seededTotal: 100,
  });
  const [a, b] = fx.attendees as [(typeof fx.attendees)[number], (typeof fx.attendees)[number]];
  const station = await openEnrolledStation(browser, fx, 1);
  const phoneA = await openPhone(browser, a);
  const phoneB = await openPhone(browser, b);
  try {
    const sent: Array<{ name: string; body: string }> = [];
    station.page.on('request', (r: Request) => {
      const m = r.url().match(/\/(wsf(?:StartTurn|CompleteTurn|CancelTurn|CallNext))$/);
      if (m && r.method() === 'POST') sent.push({ name: m[1]!, body: r.postData() ?? '' });
    });
    const sentOf = (name: string) => sent.filter((s) => s.name === name);

    await joinLineFromEventPage(phoneA.page, fx.goalId, 'Fixture A');
    await joinLineFromEventPage(phoneB.page, fx.goalId, 'Fixture B');

    // A is called, ready, started.
    await station.page.getByTestId('wsf-station-call-next').click();
    await expect(station.page.getByTestId('wsf-station-queue-serving')).toHaveText('Fixture A', { timeout: 25_000 });
    const codeA = (await station.page.getByTestId('wsf-station-queue-code').innerText()).trim();
    await phoneA.page.getByTestId('wsf-queue-ready').click();
    await expect(station.page.getByTestId('wsf-station-turn-action')).toBeEnabled({ timeout: 25_000 });
    await station.page.getByTestId('wsf-station-turn-action').click();
    await expect(station.page.getByTestId('wsf-station-turn-record')).toBeVisible({ timeout: 25_000 });
    const [entryA] = await turnEntriesOf(fx.goalId, a.uid);

    // The Start was bound: its body carries an expectedTurn.
    const startBody = JSON.parse(sentOf('wsfStartTurn')[0]!.body) as { data: { expectedTurn?: string } };
    expect(startBody.data.expectedTurn, 'Start carries the binding').toMatch(/^tr_[A-Za-z0-9_-]{16,64}$/);
    const refA = startBody.data.expectedTurn!;

    // A's Record REACHES the server, but its answer never comes back.
    let completes = 0;
    await station.page.route('**/wsfCompleteTurn', async (route) => {
      completes += 1;
      if (completes === 1) {
        await route.fetch();
        await route.abort('connectionreset');
        return;
      }
      await route.continue();
    });
    await station.page.getByTestId('wsf-station-turn-count').fill('25');
    await station.page.getByTestId('wsf-station-turn-action').click();
    await expect(station.page.getByTestId('wsf-station-op-retry')).toBeVisible({ timeout: 25_000 });
    expect((await contributionsOf(fx.goalId, a.uid)).map((c) => c.count), 'the server recorded A once').toEqual([25]);
    expect(await shardTotal(fx.goalId)).toBe(125);
    const first = JSON.parse(sentOf('wsfCompleteTurn')[0]!.body) as { data: { expectedTurn: string; count: number } };
    expect(first.data).toMatchObject({ expectedTurn: refA, count: 25 });

    // The hall moves on: nobody assigned (A was recorded), then Call next brings B.
    await expect(station.page.getByTestId('wsf-station-call-next')).toBeVisible({ timeout: 25_000 });
    await station.page.getByTestId('wsf-station-call-next').click();
    await expect(station.page.getByTestId('wsf-station-queue-serving')).toHaveText('Fixture B', { timeout: 25_000 });
    await phoneB.page.getByTestId('wsf-queue-ready').click();
    await expect(station.page.getByTestId('wsf-station-turn-action')).toBeEnabled({ timeout: 25_000 });

    // Pressing Start for B while A is unanswered is NOT sent; the screen says why, by A's code.
    const startsBefore = sentOf('wsfStartTurn').length;
    await station.page.getByTestId('wsf-station-turn-action').click();
    await expect(station.page.getByTestId('wsf-station-queue-error')).toContainText(`Finish checking ${codeA.toUpperCase()} first`, { timeout: 10_000 });
    expect(sentOf('wsfStartTurn').length, 'no Start for B went out').toBe(startsBefore);
    expect(await turnEntriesOf(fx.goalId, b.uid).then((r) => r[0]?.attemptId ?? null), 'B has no attempt').toBeNull();

    // "Try again": EXACTLY A's request, though the screen shows B.
    const retried = station.page.waitForResponse((r) => r.url().includes('wsfCompleteTurn'));
    await station.page.getByTestId('wsf-station-op-retry').click();
    const answer = (await (await retried).json()) as { result?: { entryId?: string; receipt?: { addedCount: number; alreadyRecorded: boolean; entryId: string } } };
    expect(answer.result?.receipt).toMatchObject({ addedCount: 25, alreadyRecorded: true });
    expect(answer.result?.entryId).toBe(entryA!.id);
    const second = JSON.parse(sentOf('wsfCompleteTurn')[1]!.body) as { data: { expectedTurn: string; count: number } };
    expect(second.data, 'the retry is byte-for-byte A\'s own operation').toEqual(first.data);

    // The screen: A's line from A's receipt, in A's code; B still B, nothing painted onto B.
    await expect(station.page.getByTestId('wsf-station-op-receipt')).toContainText(`${codeA.toUpperCase()} · 25 squats recorded.`, { timeout: 15_000 });
    await expect(station.page.getByTestId('wsf-station-queue-serving')).toHaveText('Fixture B');
    await expect(station.page.getByTestId('wsf-station-op-retry')).toHaveCount(0);

    // The store: A counted once; B untouched; the goal 125, not 150.
    expect((await contributionsOf(fx.goalId, a.uid)).map((c) => c.count)).toEqual([25]);
    expect(await contributionsOf(fx.goalId, b.uid), 'B has no contribution').toEqual([]);
    expect(await shardTotal(fx.goalId)).toBe(125);
    const [entryB] = await turnEntriesOf(fx.goalId, b.uid);
    expect(entryB!.status).not.toBe('done');
    expect(entryB!.resultAmount).toBeNull();

    // B's own turn still works with B's own binding.
    await station.page.getByTestId('wsf-station-turn-action').click();
    await expect(station.page.getByTestId('wsf-station-turn-record')).toBeVisible({ timeout: 25_000 });
    const startB = JSON.parse(sentOf('wsfStartTurn').at(-1)!.body) as { data: { expectedTurn?: string } };
    expect(startB.data.expectedTurn).toMatch(/^tr_/);
    expect(startB.data.expectedTurn).not.toBe(refA);
    await expect(station.page.getByTestId('wsf-station-turn-count')).toHaveValue('');
    await station.page.getByTestId('wsf-station-turn-count').fill('10');
    await station.page.getByTestId('wsf-station-turn-action').click();
    await expect(station.page.getByTestId('wsf-station-queue-result')).toContainText('10 squats recorded.', { timeout: 25_000 });
    expect((await contributionsOf(fx.goalId, b.uid)).map((c) => c.count)).toEqual([10]);
    expect((await contributionsOf(fx.goalId, a.uid)).map((c) => c.count)).toEqual([25]);
    expect(await shardTotal(fx.goalId)).toBe(135);
    station.assertNoCrash('the station');
  } finally {
    await Promise.all([station.context.close(), phoneA.context.close(), phoneB.context.close()]);
  }
});
```

## Instrument 2: `w7-probe.test.ts`

```ts
/**
 * W7 probe (never committed to the PR; detached worktree only)
 * each bound to the turn it was pressed for (src/stationTurnOperation.ts).
 *
 * The controller is driven through the REAL Firebase callable SDK
 * (`httpsCallable`), with only `fetch` scripted, so every payload asserted here
 * is the exact JSON body the SDK serializes, and every failure is the
 * FirebaseError the SDK itself raises for that HTTP answer.
 */
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  classifyCommandFailure,
  countInputAfter,
  countInputFor,
  createStationTurnController,
  describePendingOperation,
  describeRecordedOperation,
  parseStationHall,
  parseStationReceipt,
  TURN_COMMANDS_UNAVAILABLE,
  type StationCallable,
  type StationHall,
} from '../src/stationTurnOperation';
import { isStationTurnRef, TURN_NEEDS_UPDATE_MESSAGE, TURN_NOT_RUNNING_MESSAGE, TURN_STALE_MESSAGE } from '../src/turnContract';

const REF_A = 'tr_AAAAAAAAAAAAAAAAAAAAAAAA';
const REF_B = 'tr_BBBBBBBBBBBBBBBBBBBBBBBB';
const SESSION = { goalId: 'goal-1', stationId: 'st-1', secret: 'sec-1' };

const assigned = (ref: string | null, state: 'assigned' | 'ready' | 'active', code: string, name: string) => ({
  code, calledName: name, state, readySecondsLeft: state === 'assigned' ? 30 : null, activityUnit: 'squats', activityTitle: 'Squats', turnRef: ref,
});
const hall = (a: ReturnType<typeof assigned> | null, extra: Record<string, unknown> = {}) => ({
  stationId: 'st-1', stationLabel: 'Station 1', assigned: a, result: null, waitingCount: 2, ...extra,
});
const HALL_A_ACTIVE = hall(assigned(REF_A, 'active', 'K7Q2', 'Ana'));
const HALL_A_READY = hall(assigned(REF_A, 'ready', 'K7Q2', 'Ana'));
const HALL_B_ACTIVE = hall(assigned(REF_B, 'active', 'M3X9', 'Ben'));
const HALL_EMPTY = hall(null);
const receiptFor = (entryId: string, addedCount: number, alreadyRecorded: boolean) => ({
  entryId, receipt: { entryId, goalId: 'goal-1', addedCount, unit: 'squats', alreadyRecorded, sharedTotal: 120, target: 5000, status: 'active', crossedTarget: false },
});

/** A scripted callable backend: each request is recorded with its exact serialized body, and answered when the test says. */
type Answer = { result: unknown } | { error: { status: string; message: string }; http: number } | 'lost';
function scriptedBackend() {
  const requests: Array<{ name: string; body: string; answer: (a: Answer) => void }> = [];
  const fetchImpl = vi.fn((url: string, init: { body: string }) => {
    const name = new URL(url).pathname.split('/').pop() as string;
    return new Promise((resolve, reject) => {
      requests.push({
        name,
        body: init.body,
        answer: (a) => {
          if (a === 'lost') return reject(new TypeError('fetch failed'));
          if ('result' in a) return resolve(new Response(JSON.stringify({ result: a.result }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
          return resolve(new Response(JSON.stringify({ error: a.error }), { status: a.http, headers: { 'Content-Type': 'application/json' } }));
        },
      });
    });
  });
  return { requests, fetchImpl };
}

let app: FirebaseApp;
let backend: ReturnType<typeof scriptedBackend>;
let n = 0;
beforeEach(() => {
  backend = scriptedBackend();
  vi.stubGlobal('fetch', backend.fetchImpl);
  app = initializeApp({ projectId: 'demo-wsf-test', apiKey: 'demo-key', appId: '1:1:web:1' }, `station-op-${++n}`);
  const functions = getFunctions(app, 'us-central1');
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  controller = createStationTurnController({
    send: async (name: StationCallable, payload) => (await httpsCallable(functions, name)(payload)).data,
  });
  controller.setSession(SESSION);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await deleteApp(app);
});
let controller: ReturnType<typeof createStationTurnController>;

const flush = () => new Promise((r) => setTimeout(r, 0));
/** Wait for the SDK to put the next request on the wire. */
async function nextRequest(i: number) {
  for (let k = 0; k < 50 && backend.requests.length <= i; k += 1) await flush();
  expect(backend.requests.length).toBeGreaterThan(i);
  return backend.requests[i];
}
const visible = (data: unknown) => parseStationHall(data) as StationHall;


describe('W7 probes: behaviours the PR unit tests do not pin (the code is expected to hold)', () => {
  it('P1 a definite refusal (permission-denied) answering for an OLD session is dropped and cannot touch the new session', async () => {
    const p = controller.press('wsfCompleteTurn', visible(HALL_A_ACTIVE), '20');
    const req = await nextRequest(0);
    expect(controller.setSession({ ...SESSION, secret: 'sec-2' })).toBe(true);
    // the new session begins its own command
    const q = controller.press('wsfStartTurn', visible(HALL_A_READY));
    await nextRequest(1);
    expect(controller.busy()).toBe(true);
    req.answer({ error: { status: 'PERMISSION_DENIED', message: 'This screen is not enrolled.' }, http: 403 });
    expect((await p).kind).toBe('dropped');
    expect(controller.busy()).toBe(true); // the NEW session's command is still the one in flight
    backend.requests[1].answer({ result: HALL_A_ACTIVE });
    expect((await q).kind).toBe('done');
  });
  it('P2 the Record line states what the server recorded, not what was sent', async () => {
    const p = controller.press('wsfCompleteTurn', visible(HALL_A_ACTIVE), '20');
    (await nextRequest(0)).answer('lost');
    await p;
    const r = controller.retry();
    (await nextRequest(1)).answer({ result: { ...HALL_EMPTY, ...receiptFor('entry-A', 18, true) } });
    const done = await r;
    expect(done.kind).toBe('recorded');
    if (done.kind === 'recorded') expect(describeRecordedOperation(done.op, done.receipt)).toBe('K7Q2 · 18 squats recorded.');
  });
  it('P3 another command for the SAME turn while Record is unanswered waits; it never resends the Record', async () => {
    const p = controller.press('wsfCompleteTurn', visible(HALL_A_ACTIVE), '20');
    (await nextRequest(0)).answer('lost');
    await p;
    const c = await controller.press('wsfCancelTurn', visible(HALL_A_ACTIVE));
    expect(c.kind).toBe('otherPending');
    expect(backend.requests).toHaveLength(1);
  });
  it('P4 Try again while the operation is in flight sends nothing', async () => {
    const p = controller.press('wsfCompleteTurn', visible(HALL_A_ACTIVE), '20');
    await nextRequest(0);
    expect((await controller.retry()).kind).toBe('busy');
    expect(backend.requests).toHaveLength(1);
    backend.requests[0].answer('lost');
    await p;
  });
  it('P5 a receipt whose alreadyRecorded is not a boolean is not a receipt', () => {
    const bad = { ...HALL_EMPTY, ...receiptFor('entry-A', 20, false) } as Record<string, any>;
    bad.receipt = { ...bad.receipt, alreadyRecorded: 'yes' };
    expect(parseStationReceipt(bad)).toBeNull();
  });
  it('P6 a stale refusal for A ends A; B is then pressable with B\'s own ref', async () => {
    const p = controller.press('wsfStartTurn', visible(HALL_A_READY));
    (await nextRequest(0)).answer({ error: { status: 'FAILED_PRECONDITION', message: TURN_STALE_MESSAGE }, http: 400 });
    const r = await p;
    expect(r.kind === 'failed' && r.failure).toBe('stale');
    expect(controller.pending()).toBeNull();
    const b = controller.press('wsfStartTurn', visible(hall(assigned(REF_B, 'ready', 'M3X9', 'Ben'))));
    const rb = await nextRequest(1);
    expect(rb.body).toBe(JSON.stringify({ data: { stationId: 'st-1', secret: 'sec-1', expectedTurn: REF_B } }));
    rb.answer({ result: HALL_B_ACTIVE });
    expect((await b).kind).toBe('done');
  });
});
```

## Instrument 3: `mut-w7.mjs`

```js
  // Mutation check for KIOSK-EXPECTED-TURN-NATIVE-CALLER-RECOVERY-1: each mutant of src/stationTurnOperation.ts (or
  // turnContract.ts) must make tests/stationTurnOperation.test.ts fail. Run from apps/westayfit. Restores each file.
  import fs from 'node:fs';
  import { spawnSync } from 'node:child_process';
  const OP = 'src/stationTurnOperation.ts';
  const TC = 'src/turnContract.ts';
  const M = [
    ['W7-1 a session change ignores the station id', OP, [["session.goalId === next.goalId && session.stationId === next.stationId && session.secret === next.secret", "session.goalId === next.goalId && session.secret === next.secret"]]],
    ['W7-2 a session change ignores the secret', OP, [["session.goalId === next.goalId && session.stationId === next.stationId && session.secret === next.secret", "session.goalId === next.goalId && session.stationId === next.stationId"]]],
    ['W7-3 the hall settles Start for ANY running turn (binding ignored)', OP, [["const shown = hall.assigned?.turnRef === pending.expectedTurn ? hall.assigned : null;", "const shown = hall.assigned;"]]],
    ['W7-4 retry has no in-flight guard', OP, [["  async function retry(): Promise<CommandResult> {\n    if (inFlight) return { kind: 'busy' };", "  async function retry(): Promise<CommandResult> {"]]],
    ['W7-5 call next has no in-flight guard', OP, [["  async function callNext(): Promise<CommandResult> {\n    if (inFlight) return { kind: 'busy' };", "  async function callNext(): Promise<CommandResult> {"]]],
    ['W7-6 unavailable is a definite refusal', OP, [["'internal', 'unavailable', ", "'internal', "]]],
    ['W7-7 permission-denied is only lost', OP, [["permission-denied", "permission-denied-x"]]],
    ['W7-8 a late failure from an old session is not dropped', OP, [["    } catch (e) {\n      if (!live(op.generation)) return { kind: 'dropped' };\n      inFlight = false;\n      const f = classifyCommandFailure(e);\n      if (f.kind === 'lost')", "    } catch (e) {\n      inFlight = false;\n      const f = classifyCommandFailure(e);\n      if (f.kind === 'lost')"]]],
    ['W7-9 acceptHall ignores the ticket generation', OP, [["!live(ticket.generation) || ", ""]]],
    ['W7-10 the ticket is taken after the answer', OP, [["    inFlight = true;\n    const ticket = issueTicket();\n    let data: unknown;\n    try {\n      data = await deps.send(op.command, commandPayload(op, s));\n    } catch", "    inFlight = true;\n    let ticket: HallTicket | null = null;\n    let data: unknown;\n    try {\n      data = await deps.send(op.command, commandPayload(op, s));\n      ticket = issueTicket();\n    } catch"]]],
    ['W7-11 the Record line states the count that was sent', OP, [["${op.code.toUpperCase()} · ${receipt.addedCount} ${unit} recorded.", "${op.code.toUpperCase()} · ${op.count} ${unit} recorded."]]],
    ['W7-12 a different command for the same turn resends the unanswered one', OP, [["pending.expectedTurn === assigned.turnRef && pending.command === command", "pending.expectedTurn === assigned.turnRef"]]],
    ['W7-13 a definite refusal keeps the operation pending', OP, [["      if (pending?.id === op.id) pending = null;\n      return { kind: 'failed', op, failure: f.kind", "      return { kind: 'failed', op, failure: f.kind"]]],
    ['W7-14 a recorded answer keeps the operation pending', OP, [["      if (pending?.id === op.id) pending = null;\n      return { kind: 'recorded'", "      return { kind: 'recorded'"]]],
    ['W7-15 the payload sends the secret of a later session', OP, [["const base = { stationId: session.stationId, secret: session.secret };", "const base = { stationId: session.stationId, secret: session.secret + 'x' };"]]],
    ['W7-16 a non-boolean alreadyRecorded is accepted', OP, [[" || typeof r.alreadyRecorded !== 'boolean'", ""]]],
  ];
  const originals = { [OP]: fs.readFileSync(OP, 'utf8'), [TC]: fs.readFileSync(TC, 'utf8') };
  let killed = 0;
  try {
    for (const [name, file, edits] of M) {
      let src = originals[file];
      let ok = true;
      for (const [from, to] of edits) {
        const n = src.split(from).length - 1;
        if (n !== 1) { console.log(`NOT-APPLICABLE ${name} (${n} matches of ${JSON.stringify(from.slice(0, 50))})`); ok = false; break; }
        src = src.replace(from, to);
      }
      if (!ok) continue;
      fs.writeFileSync(file, src);
      const r = spawnSync('npx', ['vitest', 'run', 'tests/stationTurnOperation.test.ts'], { encoding: 'utf8', timeout: 180_000 });
      fs.writeFileSync(file, originals[file]);
      const dead = r.status !== 0;
      killed += dead;
      console.log(`${dead ? 'killed  ' : 'SURVIVED'} ${name}`);
    }
  } finally { for (const [f, s] of Object.entries(originals)) fs.writeFileSync(f, s); }
  console.log(`${killed}/${M.length} killed`);
  
```
