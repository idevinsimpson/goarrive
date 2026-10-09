/**
 * KIOSK-EXPECTED-TURN-NATIVE-CALLER-RECOVERY-1: the station's turn commands,
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

describe('the serialized requests (the actual SDK bodies)', () => {
  it('Start, Record and "Let them go" each send the credential and the turn they were pressed for; Record sends its reviewed count; Call next is unchanged', async () => {
    const start = controller.press('wsfStartTurn', visible(HALL_A_READY));
    const r0 = await nextRequest(0);
    expect(r0.name).toBe('wsfStartTurn');
    expect(r0.body).toBe(JSON.stringify({ data: { stationId: 'st-1', secret: 'sec-1', expectedTurn: REF_A } }));
    r0.answer({ result: HALL_A_ACTIVE });
    expect((await start).kind).toBe('done');

    const record = controller.press('wsfCompleteTurn', visible(HALL_A_ACTIVE), ' 20 ');
    const r1 = await nextRequest(1);
    expect(r1.name).toBe('wsfCompleteTurn');
    expect(r1.body).toBe(JSON.stringify({ data: { stationId: 'st-1', secret: 'sec-1', count: 20, expectedTurn: REF_A } }));
    r1.answer({ result: { ...HALL_EMPTY, ...receiptFor('entry-A', 20, false), recorded: { amount: 20, unit: 'squats', alreadyRecorded: false }, anyoneWaiting: true } });
    expect((await record).kind).toBe('recorded');

    const cancel = controller.press('wsfCancelTurn', visible(HALL_B_ACTIVE));
    const r2 = await nextRequest(2);
    expect(r2.body).toBe(JSON.stringify({ data: { stationId: 'st-1', secret: 'sec-1', expectedTurn: REF_B } }));
    r2.answer({ result: HALL_EMPTY });
    await cancel;

    const next = controller.callNext();
    const r3 = await nextRequest(3);
    expect(r3.name).toBe('wsfCallNext');
    expect(r3.body).toBe(JSON.stringify({ data: { stationId: 'st-1', secret: 'sec-1' } }));
    r3.answer({ result: HALL_A_ACTIVE });
    expect((await next).kind).toBe('called');
    for (const r of backend.requests) expect(r.body).not.toMatch(/uid|calledName|Ana|Ben/);
  });

  it('a double tap sends ONE command: the guard holds before any re-render', async () => {
    const first = controller.press('wsfStartTurn', visible(HALL_A_READY));
    const second = controller.press('wsfStartTurn', visible(HALL_A_READY));
    const third = controller.callNext();
    expect((await second).kind).toBe('busy');
    expect((await third).kind).toBe('busy');
    (await nextRequest(0)).answer({ result: HALL_A_ACTIVE });
    await first;
    await flush();
    expect(backend.requests).toHaveLength(1);
  });
});

describe('A lost Record, B called, A retried', () => {
  it('retries A with A\'s own binding and count, reads A\'s own receipt, and never touches B\'s turn, input or count', async () => {
    // A's Record: the answer is lost.
    const lost = await (async () => {
      const p = controller.press('wsfCompleteTurn', visible(HALL_A_ACTIVE), '20');
      (await nextRequest(0)).answer('lost');
      return p;
    })();
    expect(lost.kind).toBe('lost');
    const opA = controller.pending();
    expect(opA).toMatchObject({ command: 'wsfCompleteTurn', expectedTurn: REF_A, count: 20, code: 'K7Q2' });
    expect(Object.isFrozen(opA)).toBe(true);
    expect(describePendingOperation(opA!)).toBe('No answer yet for K7Q2. “Try again” sends the result (20) again for that turn — it can’t count twice.');

    // The hall moves on: a poll shows nobody (A WAS recorded), then Call next brings B.
    const t = controller.issueTicket();
    expect(controller.acceptHall(t, HALL_EMPTY)).not.toBeNull();
    expect(controller.pending()).toBe(opA); // a Record is never settled by the hall — only by its own receipt
    const call = controller.callNext();
    (await nextRequest(1)).answer({ result: HALL_B_ACTIVE });
    const called = await call;
    expect(called.kind === 'called' && called.hall?.assigned?.turnRef).toBe(REF_B);

    // Somebody types B's count.
    let input = { turnRef: REF_B as string | null, text: '9' };
    expect(countInputFor(input, REF_B)).toBe('9');

    // A new Record press for B is refused while A is unanswered — never sent with B's ref and A's count.
    const blocked = await controller.press('wsfCompleteTurn', visible(HALL_B_ACTIVE), '9');
    expect(blocked.kind).toBe('otherPending');

    // Try again: EXACTLY A's request, though the screen shows B.
    const retry = controller.retry();
    const rr = await nextRequest(2);
    expect(rr.body).toBe(JSON.stringify({ data: { stationId: 'st-1', secret: 'sec-1', count: 20, expectedTurn: REF_A } }));
    rr.answer({ result: { ...HALL_B_ACTIVE, ...receiptFor('entry-A', 20, true), recorded: { amount: 20, unit: 'squats', alreadyRecorded: true }, anyoneWaiting: true } });
    const done = await retry;
    expect(done.kind).toBe('recorded');
    if (done.kind !== 'recorded') return;
    expect(done.entryId).toBe('entry-A');
    expect(done.receipt).toMatchObject({ addedCount: 20, alreadyRecorded: true });
    expect(describeRecordedOperation(done.op, done.receipt)).toBe('K7Q2 · 20 squats recorded.');
    expect(done.hall?.assigned).toMatchObject({ turnRef: REF_B, calledName: 'Ben', state: 'active' }); // B stays B
    input = countInputAfter(input, done.op) as typeof input;
    expect(input).toEqual({ turnRef: REF_B, text: '9' }); // A's answer does not clear B's count
    expect(controller.pending()).toBeNull();
    expect(backend.requests.filter((r) => r.name === 'wsfCompleteTurn').every((r) => r.body.includes(REF_A))).toBe(true);
  });

  it('pressing Record again for the same turn resends the captured count, not a newly typed one', async () => {
    const p = controller.press('wsfCompleteTurn', visible(HALL_A_ACTIVE), '20');
    (await nextRequest(0)).answer('lost');
    await p;
    const again = controller.press('wsfCompleteTurn', visible(HALL_A_ACTIVE), '25');
    const r = await nextRequest(1);
    expect(r.body).toBe(JSON.stringify({ data: { stationId: 'st-1', secret: 'sec-1', count: 20, expectedTurn: REF_A } }));
    r.answer({ result: { ...HALL_EMPTY, ...receiptFor('entry-A', 20, true) } });
    expect((await again).kind).toBe('recorded');
  });
});

describe('answers that arrive in the other order', () => {
  it('a poll issued before a command cannot repaint the hall after the command\'s answer', async () => {
    const pollTicket = controller.issueTicket();
    const rec = controller.press('wsfCompleteTurn', visible(HALL_A_ACTIVE), '20');
    (await nextRequest(0)).answer({ result: { ...HALL_EMPTY, ...receiptFor('entry-A', 20, false) } });
    const r = await rec;
    expect(r.kind === 'recorded' && r.hall?.assigned).toBeNull();
    expect(controller.acceptHall(pollTicket, HALL_A_ACTIVE)).toBeNull(); // the late, older poll is dropped
  });

  it('a poll issued after a command paints first; the command\'s older hall is dropped but its receipt still settles it', async () => {
    const rec = controller.press('wsfCompleteTurn', visible(HALL_A_ACTIVE), '20');
    const req = await nextRequest(0);
    const pollTicket = controller.issueTicket();
    expect(controller.acceptHall(pollTicket, HALL_B_ACTIVE)?.assigned?.turnRef).toBe(REF_B);
    req.answer({ result: { ...HALL_A_ACTIVE, ...receiptFor('entry-A', 20, false) } });
    const r = await rec;
    expect(r.kind).toBe('recorded');
    expect(r.kind === 'recorded' && r.hall).toBeNull(); // never repaints A over B
    expect(controller.pending()).toBeNull();
  });
});

describe('revocation, unpairing and goal switch', () => {
  for (const [name, next] of [
    ['revoked (no credential)', null],
    ['re-enrolled (new secret)', { ...SESSION, secret: 'sec-2' }],
    ['another goal', { ...SESSION, goalId: 'goal-2' }],
  ] as const) {
    it(`an answer in flight when the session changes is dropped whole: ${name}`, async () => {
      const p = controller.press('wsfCompleteTurn', visible(HALL_A_ACTIVE), '20');
      const req = await nextRequest(0);
      expect(controller.setSession(next)).toBe(true);
      req.answer({ result: { ...HALL_EMPTY, ...receiptFor('entry-A', 20, false) } });
      expect((await p).kind).toBe('dropped');
      expect(controller.pending()).toBeNull();
      expect(controller.busy()).toBe(false);
    });
  }

  it('a fresh enrollment does not inherit an unanswered operation', async () => {
    const p = controller.press('wsfCompleteTurn', visible(HALL_A_ACTIVE), '20');
    (await nextRequest(0)).answer('lost');
    await p;
    expect(controller.pending()).not.toBeNull();
    controller.setSession({ ...SESSION, secret: 'sec-2' });
    expect(controller.pending()).toBeNull();
    expect((await controller.retry()).kind).toBe('noTurn');
    const stale = controller.issueTicket();
    controller.setSession({ ...SESSION, secret: 'sec-3' });
    expect(controller.acceptHall(stale, HALL_A_ACTIVE)).toBeNull(); // an old session's read never paints
    expect(backend.requests).toHaveLength(1);
  });

  it('the same session set again changes nothing', async () => {
    const p = controller.press('wsfCompleteTurn', visible(HALL_A_ACTIVE), '20');
    (await nextRequest(0)).answer('lost');
    await p;
    expect(controller.setSession({ ...SESSION })).toBe(false);
    expect(controller.pending()).not.toBeNull();
  });
});

describe('malformed, missing and foreign answers', () => {
  it('a Record answered 2xx without a valid receipt is NOT success with the sent count: it stays unanswered', async () => {
    for (const body of [
      HALL_EMPTY,
      { ...HALL_EMPTY, entryId: 'entry-A', receipt: { ...receiptFor('entry-A', 20, false).receipt, entryId: 'entry-B' } },
      { ...HALL_EMPTY, ...receiptFor('entry-A', 0, false) },
      { ...HALL_EMPTY, entryId: 'entry-A', receipt: { ...receiptFor('entry-A', 20, false).receipt, sharedTotal: '120' } },
      null,
    ]) {
      controller.setSession({ ...SESSION, secret: `s-${Math.random()}` });
      const i = backend.requests.length;
      const p = controller.press('wsfCompleteTurn', visible(HALL_A_ACTIVE), '20');
      (await nextRequest(i)).answer({ result: body });
      const r = await p;
      expect(r.kind, JSON.stringify(body)).toBe('lost');
      expect(controller.pending()).not.toBeNull();
    }
  });

  it('a hall that is not one is never painted (and an array anywhere refuses it)', () => {
    for (const bad of [null, [], { ...HALL_EMPTY, waitingCount: -1 }, { ...HALL_EMPTY, assigned: [] }, { ...HALL_EMPTY, assigned: { ...assigned(REF_A, 'active', 'K', 'A'), state: 'waiting' } }, { ...HALL_EMPTY, result: { code: 'K', amount: '3', unit: 'x', secondsLeft: 1 } }]) {
      expect(parseStationHall(bad), JSON.stringify(bad)).toBeNull();
      expect(controller.acceptHall(controller.issueTicket(), bad)).toBeNull();
    }
    expect(parseStationHall({ ...HALL_A_ACTIVE, assigned: { ...HALL_A_ACTIVE.assigned, turnRef: 'tr_short' } })?.assigned?.turnRef).toBeNull();
  });

  it('an old server without the binding: the three commands are unavailable and nothing is sent unbound; Call next still works', async () => {
    const old = visible(hall(assigned(null, 'active', 'K7Q2', 'Ana')));
    for (const command of ['wsfStartTurn', 'wsfCompleteTurn', 'wsfCancelTurn'] as const) {
      const v = command === 'wsfStartTurn' ? visible(hall(assigned(null, 'ready', 'K7Q2', 'Ana'))) : old;
      expect((await controller.press(command, v, '20')).kind).toBe('unavailable');
    }
    expect(backend.requests).toHaveLength(0);
    expect(TURN_COMMANDS_UNAVAILABLE).toMatch(/can’t start or record turns/);
    const c = controller.callNext();
    (await nextRequest(0)).answer({ result: hall(assigned(null, 'assigned', 'K7Q2', 'Ana')) });
    expect((await c).kind).toBe('called');
  });

  it('a press that does not fit the turn sends nothing: no turn, the wrong state, or an unusable count', async () => {
    expect((await controller.press('wsfStartTurn', visible(HALL_EMPTY))).kind).toBe('noTurn');
    expect((await controller.press('wsfStartTurn', visible(HALL_A_ACTIVE))).kind).toBe('noTurn');
    expect((await controller.press('wsfCompleteTurn', visible(HALL_A_READY), '5')).kind).toBe('noTurn');
    for (const bad of ['', '0', '-3', '2.5', 'abc', '1000001']) expect((await controller.press('wsfCompleteTurn', visible(HALL_A_ACTIVE), bad)).kind, bad).toBe('badCount');
    expect(controller.pending()).toBeNull();
    expect(backend.requests).toHaveLength(0);
  });
});

describe('definite refusals end the operation; lost answers do not', () => {
  const refuse = (status: string, http: number, message: string): Answer => ({ error: { status, message }, http });
  for (const [label, answer, kind] of [
    ['stale (moved on)', refuse('FAILED_PRECONDITION', 400, TURN_STALE_MESSAGE), 'stale'],
    ['not running', refuse('FAILED_PRECONDITION', 400, TURN_NOT_RUNNING_MESSAGE), 'notRunning'],
    ['needs an update', refuse('INVALID_ARGUMENT', 400, TURN_NEEDS_UPDATE_MESSAGE), 'needsUpdate'],
    ['revoked', refuse('PERMISSION_DENIED', 403, 'This screen is not enrolled.'), 'revoked'],
    ['closed goal', refuse('FAILED_PRECONDITION', 400, 'This goal is closed.'), 'refused'],
  ] as const) {
    it(`${label}: the operation is over (no retry), with the server's own words`, async () => {
      const p = controller.press('wsfCompleteTurn', visible(HALL_A_ACTIVE), '20');
      (await nextRequest(0)).answer(answer);
      const r = await p;
      expect(r.kind === 'failed' && r.failure).toBe(kind);
      expect(controller.pending()).toBeNull();
      expect((await controller.retry()).kind).toBe('noTurn');
    });
  }

  for (const [label, answer] of [['a dropped connection', 'lost'], ['a 503', { error: { status: 'UNAVAILABLE', message: 'unavailable' }, http: 503 }], ['a 500', { error: { status: 'INTERNAL', message: 'internal' }, http: 500 }]] as const) {
    it(`${label}: the answer is lost, the operation stays, and "Try again" resends it exactly`, async () => {
      const p = controller.press('wsfCancelTurn', visible(HALL_A_READY));
      (await nextRequest(0)).answer(answer as Answer);
      expect((await p).kind).toBe('lost');
      const again = controller.retry();
      const r = await nextRequest(1);
      expect(r.body).toBe(backend.requests[0].body);
      r.answer({ result: HALL_EMPTY });
      expect((await again).kind).toBe('done');
    });
  }

  it('classifyCommandFailure: the binding sentences are matched exactly; anything without a code is lost', () => {
    expect(classifyCommandFailure({ code: 'functions/failed-precondition', message: TURN_STALE_MESSAGE }).kind).toBe('stale');
    expect(classifyCommandFailure({ code: 'functions/failed-precondition', message: `${TURN_STALE_MESSAGE} ` }).kind).toBe('refused');
    expect(classifyCommandFailure(new TypeError('x')).kind).toBe('lost');
    expect(classifyCommandFailure(null).kind).toBe('lost');
  });
});

describe('a later hall settles an unanswered Start or "Let them go" — never a Record', () => {
  it('Start lost, then the hall shows that turn running: settled', async () => {
    const p = controller.press('wsfStartTurn', visible(HALL_A_READY));
    (await nextRequest(0)).answer('lost');
    await p;
    expect(controller.acceptHall(controller.issueTicket(), HALL_A_READY)).not.toBeNull();
    expect(controller.pending()).not.toBeNull();
    controller.acceptHall(controller.issueTicket(), HALL_A_ACTIVE);
    expect(controller.pending()).toBeNull();
  });
  it('"Let them go" lost, then the hall no longer shows that turn: settled', async () => {
    const p = controller.press('wsfCancelTurn', visible(HALL_A_READY));
    (await nextRequest(0)).answer('lost');
    await p;
    controller.acceptHall(controller.issueTicket(), HALL_B_ACTIVE);
    expect(controller.pending()).toBeNull();
  });
});

describe('the count box belongs to one turn; the binding shape is the server\'s', () => {
  it('countInputFor / countInputAfter', () => {
    expect(countInputFor({ turnRef: REF_A, text: '20' }, REF_A)).toBe('20');
    expect(countInputFor({ turnRef: REF_A, text: '20' }, REF_B)).toBe('');
    expect(countInputFor({ turnRef: null, text: '20' }, null)).toBe('');
  });
  it('isStationTurnRef mirrors ^tr_[A-Za-z0-9_-]{16,64}$', () => {
    for (const ok of [REF_A, `tr_${'a'.repeat(16)}`, `tr_${'Z9_-'.repeat(16)}`]) expect(isStationTurnRef(ok), ok).toBe(true);
    for (const bad of ['', 'tr_', `tr_${'a'.repeat(15)}`, `tr_${'a'.repeat(65)}`, `TR_${'a'.repeat(16)}`, `tr_${'a'.repeat(15)}!`, 42, null]) expect(isStationTurnRef(bad), String(bad)).toBe(false);
  });
  it('parseStationReceipt keeps exactly the whitelist', () => {
    const r = parseStationReceipt({ ...receiptFor('entry-A', 7, false), extra: 1 });
    expect(r?.receipt && Object.keys(r.receipt).sort()).toEqual(['addedCount', 'alreadyRecorded', 'crossedTarget', 'entryId', 'goalId', 'sharedTotal', 'status', 'target', 'unit']);
    expect(parseStationReceipt({ entryId: 'e', receipt: { ...receiptFor('e', 7, false).receipt, sharedTotal: null, target: null, status: null, crossedTarget: null } })?.receipt.sharedTotal).toBeNull();
  });
});
