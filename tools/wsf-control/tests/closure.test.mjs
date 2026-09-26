#!/usr/bin/env node
/**
 * AUTONOMY-STATE-1A closure (Director #519 5848879418; W7 Check 62/62a):
 *   F1 a QUEUED packet may be blocked without lying about its phase;
 *   F2 a CURRENT comment on an earlier known head is stale and actionable;
 *   F3 at most one driving NEXT (queued work packet) per worker.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  BASE, CURRENT_COMMENT, GENESIS, QUEUE_BETA, SOURCE_ONLY, STAGED_HOSTED,
  add, boot, build, chain, comment, done, freeze, refused, test,
} from './helpers.mjs';
import { appendToDir } from '../append.mjs';
import { invariants } from '../check.mjs';
import { ledgerHeads, sha256 } from '../reduce.mjs';
import { reconcile, surfaceStatus } from '../reconcile.mjs';
import { renderCurrent } from '../render-current.mjs';
import { workerView } from '../worker-view.mjs';
import { programView } from '../program-view.mjs';

const TOOLS = path.resolve('tools/wsf-control');
const cli = (script, args) => spawnSync(process.execPath, [path.join(TOOLS, script), ...args], { encoding: 'utf8' });
const base = () => build(BASE);
const EXT = [{ external: 'OWNER-HOLD', condition: 'owner decision pending', owner: 'Owner', unblockWhen: 'owner posts a verdict' }];
const ref = (packet, owner = 'W3') => ({ type: 'queue', packet, owner, kind: 'reference', completion: SOURCE_ONLY });

// ---- F3: one driving NEXT per worker ----
test('F3: append refuses a second queued work packet for one worker', () => {
  refused(() => add(base(), QUEUE_BETA), /W3 has 2 queued work packets \(ALPHA, BETA\); at most one NEXT/);
});
test('F3: reference packets are exempt and never become NEXT', () => {
  const r = chain(base(), ref('REF-A'), ref('REF-B'), { type: 'reorder-queue', owner: 'W3', order: ['REF-A', 'REF-B', 'ALPHA'] });
  assert.deepEqual(r.state.queue.W3, ['REF-A', 'REF-B', 'ALPHA']);
  assert.ok(workerView(r.state, 'W3').includes('NEXT=ALPHA'));
});
test('F3: bootstrap import refuses two queued work packets for one worker', () => {
  refused(() => build([boot({
    queue: { W3: ['Q1', 'Q2'], W7: [] },
    packets: { Q1: { owner: 'W3', completion: SOURCE_ONLY, phase: 'QUEUED', refs: [] }, Q2: { owner: 'W3', completion: SOURCE_ONLY, phase: 'QUEUED', refs: [] } },
  })]), /W3 has 2 queued work packets \(Q1, Q2\); at most one NEXT/);
});
test('F3: a hand-built state with two queued work packets fails the invariants', () => {
  const s = JSON.parse(chain(base(), { type: 'release', packet: 'ALPHA', inbox: 396 }, QUEUE_BETA).stateText);
  s.packets.GAMMA = { ...s.packets.BETA };
  s.queue.W3 = ['BETA', 'GAMMA'];
  assert.ok(invariants(s).some((p) => /W3 has 2 queued work packets \(BETA, GAMMA\)/.test(p)));
});

// ---- F1: a queued packet may be blocked ----
test('F1: blocking a QUEUED work packet removes it from the driving queue; it is not NEXT and asks for no release', () => {
  const r = add(base(), { type: 'block', packet: 'ALPHA', blockedBy: EXT });
  const p = r.state.packets.ALPHA;
  assert.deepEqual([p.phase, p.phaseBeforeBlock, r.state.queue.W3], ['BLOCKED', 'QUEUED', []]);
  const v = workerView(r.state, 'W3');
  assert.ok(v.includes('NEXT=none'));
  assert.ok(v.includes('BLOCKED=ALPHA (not work; does not keep WATCH on)'));
  assert.ok(v.includes('WATCH=off'));
  assert.ok(!programView(r.state).some((l) => /event=release/.test(l)));
});
test('F1: unblock restores QUEUED at its original relative position', () => {
  let r = chain(base(), ref('REF-A'), ref('REF-B'), { type: 'reorder-queue', owner: 'W3', order: ['REF-A', 'ALPHA', 'REF-B'] });
  r = add(r, { type: 'block', packet: 'ALPHA', blockedBy: EXT });
  assert.deepEqual(r.state.queue.W3, ['REF-A', 'REF-B']);
  assert.equal(r.state.packets.ALPHA.queueIndexBeforeBlock, 1);
  r = add(r, { type: 'unblock', packet: 'ALPHA' });
  assert.deepEqual(r.state.queue.W3, ['REF-A', 'ALPHA', 'REF-B']);
  assert.deepEqual([r.state.packets.ALPHA.phase, r.state.packets.ALPHA.phaseBeforeBlock, r.state.packets.ALPHA.queueIndexBeforeBlock], ['QUEUED', null, null]);
  assert.ok(workerView(r.state, 'W3').includes('NEXT=ALPHA'));
});
test('F1: restoring a blocked queued packet that would make a second NEXT is a conflict, refused', () => {
  let r = add(base(), { type: 'block', packet: 'ALPHA', blockedBy: EXT });
  r = add(r, QUEUE_BETA);
  assert.deepEqual(r.state.queue.W3, ['BETA']);
  refused(() => add(r, { type: 'unblock', packet: 'ALPHA' }), /W3 has 2 queued work packets \(ALPHA, BETA\); at most one NEXT/);
});
test('F1: a blocked queued reference packet stays non-driving and is restored to its place', () => {
  let r = add(base(), { type: 'block', packet: 'REF-1', blockedBy: EXT });
  assert.deepEqual([r.state.packets['REF-1'].phase, r.state.queue.W7], ['BLOCKED', []]);
  assert.ok(workerView(r.state, 'W7').includes('NEXT=none'));
  r = add(r, { type: 'unblock', packet: 'REF-1' });
  assert.deepEqual([r.state.packets['REF-1'].phase, r.state.queue.W7], ['QUEUED', ['REF-1']]);
  assert.ok(workerView(r.state, 'W7').includes('NEXT=none'));
});
test('F1: bootstrap imports a queued packet as BLOCKED with phaseBeforeBlock QUEUED, outside the queue; unblock queues it', () => {
  let r = build([boot({
    packets: { HELD: { owner: 'W3', completion: STAGED_HOSTED, phase: 'BLOCKED', phaseBeforeBlock: 'QUEUED', blockedBy: EXT, refs: [comment(55)] } },
  })]);
  assert.deepEqual([r.state.packets.HELD.phase, r.state.packets.HELD.phaseBeforeBlock, r.state.queue.W3], ['BLOCKED', 'QUEUED', []]);
  r = add(r, { type: 'unblock', packet: 'HELD' });
  assert.deepEqual([r.state.packets.HELD.phase, r.state.queue.W3], ['QUEUED', ['HELD']]);
  refused(() => build([boot({
    queue: { W3: ['HELD'], W7: [] },
    packets: { HELD: { owner: 'W3', completion: STAGED_HOSTED, phase: 'BLOCKED', phaseBeforeBlock: 'QUEUED', blockedBy: EXT, refs: [comment(55)] } },
  })]), /W3's queue names HELD, which is already BLOCKED/);
});
test('F1: a blocked queued packet may be withdrawn; nothing is left behind in the queue', () => {
  const r = chain(base(), { type: 'block', packet: 'ALPHA', blockedBy: EXT }, { type: 'withdraw', packet: 'ALPHA' });
  assert.deepEqual([r.state.packets.ALPHA.phase, r.state.queue.W3], ['WITHDRAWN', []]);
});

// ---- F2: a stale CURRENT is actionable ----
/** A quiet program: W3 holds ALPHA, W7 only a reference; nothing needs a transition. */
const quiet = () => add(base(), { type: 'release', packet: 'ALPHA', inbox: 396 });
const surfaceAt = (markerHead, extra = {}) => ({ commentId: CURRENT_COMMENT, exists: true, markerHead, ...extra });

test('F2 crash window: the ledger advanced but the CURRENT edit never happened → CURRENT_SURFACE=stale, ACTIONABLE=on, repair in place', () => {
  const r1 = quiet();
  const r2 = add(r1, { type: 'register-worker', worker: 'W9', inbox: 409 });
  const heads = ledgerHeads(r2.eventsText);
  // Control: CURRENT at the present head is quiet.
  const fresh = programView(r2.state, { schemaVersion: 1, prs: {}, currentSurface: surfaceAt(r2.state.ledgerHead) }, { heads });
  assert.deepEqual(fresh.slice(-3), ['CURRENT_SURFACE=ok', 'ACTIONABLE=off', 'MONITOR=on']);
  // The crash window: CURRENT still carries the previous head.
  const snap = freeze({ schemaVersion: 1, prs: {}, currentSurface: surfaceAt(r1.state.ledgerHead) });
  const out = reconcile(freeze(JSON.parse(r2.stateText)), snap, { heads });
  assert.deepEqual(out.map((x) => [x.kind, x.wins]), [['current-surface-stale', 'ledger']]);
  assert.deepEqual(out[0].suggest, { action: 'render-current-and-edit-in-place', commentId: CURRENT_COMMENT, head: r2.state.ledgerHead });
  const v = programView(r2.state, snap, { heads });
  assert.deepEqual(v.slice(-3), ['CURRENT_SURFACE=stale', 'ACTIONABLE=on', 'MONITOR=on']);
  assert.deepEqual(surfaceStatus(r2.state, snap, { heads }).status, 'stale');
});
test('F2: exception stays reserved for missing, unmarked, foreign-head and hand-edited surfaces', () => {
  const r = quiet();
  const heads = ledgerHeads(r.eventsText);
  const status = (surface, opts = {}) => surfaceStatus(r.state, { schemaVersion: 1, prs: {}, currentSurface: surface }, { heads, ...opts }).status;
  assert.equal(status(surfaceAt(r.state.ledgerHead)), 'ok');
  assert.equal(status(surfaceAt(r.state.ledgerHead, { exists: false })), 'exception');
  assert.equal(status(surfaceAt(null)), 'exception');
  assert.equal(status(surfaceAt('f'.repeat(64))), 'exception');
  // Hand-edited: the marker names this head but the body is not its rendering.
  const good = sha256(renderCurrent(r.state));
  assert.equal(status(surfaceAt(r.state.ledgerHead, { bodySha256: good })), 'ok');
  assert.equal(status(surfaceAt(r.state.ledgerHead, { bodySha256: sha256('edited by hand') })), 'exception');
  // An earlier head's body is checked against that head's own rendering when known; unknown → exception (fail closed).
  const earlier = heads[heads.length - 2];
  const unverifiable = surfaceStatus(r.state, { schemaVersion: 1, prs: {}, currentSurface: surfaceAt(earlier, { bodySha256: sha256('x') }) }, { heads });
  assert.deepEqual([unverifiable.status, /cannot be checked against the rendering/.test(unverifiable.detail)], ['exception', true]);
  assert.equal(status(surfaceAt(earlier, { bodySha256: 'a'.repeat(64) }), { renders: { [earlier]: 'a'.repeat(64) } }), 'stale');
});
test('F2: the reconcile and program-view CLIs print CURRENT_SURFACE=stale for the crash window, and check the body against each head\'s own rendering', () => {
  const d = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-closure-')), 'state');
  let head = GENESIS;
  const events = [...BASE, { type: 'release', packet: 'ALPHA', inbox: 396 }];
  const bodies = {};
  for (const [i, e] of events.entries()) {
    const r = appendToDir(d, { actor: 'Fable', source: comment(8000 + i), ...e }, { expectHead: head });
    head = r.state.ledgerHead;
    bodies[head] = renderCurrent(r.state);
  }
  const heads = Object.keys(bodies);
  const earlier = heads[heads.length - 2];
  const snapFile = (s) => { const f = path.join(path.dirname(d), 'snap.json'); fs.writeFileSync(f, JSON.stringify(s)); return f; };
  const stale = snapFile({ schemaVersion: 1, prs: {}, currentSurface: surfaceAt(earlier, { bodySha256: sha256(bodies[earlier]) }) });
  const rc = cli('reconcile.mjs', [d, stale]);
  assert.equal(rc.status, 0, rc.stderr);
  assert.match(rc.stdout, /^FINDING kind=current-surface-stale wins=ledger :: /m);
  assert.match(rc.stdout, /^CURRENT_SURFACE=stale$/m);
  assert.match(cli('program-view.mjs', [d, '--snapshot', stale]).stdout, /^CURRENT_SURFACE=stale\nACTIONABLE=on\nMONITOR=on$/m);
  const edited = snapFile({ schemaVersion: 1, prs: {}, currentSurface: surfaceAt(earlier, { bodySha256: sha256(`${bodies[earlier]}x`) }) });
  assert.match(cli('reconcile.mjs', [d, edited]).stdout, /^CURRENT_SURFACE=exception$/m);
});

done('closure');
