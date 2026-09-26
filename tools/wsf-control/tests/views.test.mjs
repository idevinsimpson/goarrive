#!/usr/bin/env node
/** The read-only side: worker-view, program-view, reconcile and CURRENT rendering. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  A, B, C, D, E, BASE, CURRENT_COMMENT, GENESIS, SOURCE_ONLY, VERIFIED_ACTIVATION,
  add, boot, build, chain, comment, done, freeze, pull, refused, run, test,
} from './helpers.mjs';
import { appendEvent, appendToDir } from '../append.mjs';
import { workerWatch } from '../derive.mjs';
import { ledgerHeads } from '../reduce.mjs';
import { isTerminal } from '../schema.mjs';
import { reconcile, validateSnapshot, inSubject, surfaceStatus } from '../reconcile.mjs';
import { renderCurrent, verifyCurrent } from '../render-current.mjs';
import { workerView } from '../worker-view.mjs';
import { programView } from '../program-view.mjs';

const TOOLS = path.resolve('tools/wsf-control');
const cli = (script, args) => spawnSync(process.execPath, [path.join(TOOLS, script), ...args], { encoding: 'utf8' });
const raw = (r, e) => appendEvent(r.eventsText, e, { expectHead: r.state.ledgerHead });
const base = () => build(BASE);
const released = () => add(base(), { type: 'release', packet: 'ALPHA', inbox: 396 });
const delivered = () => add(released(), { type: 'deliver', packet: 'ALPHA', pr: 520, subjectSha: A });
/** A snapshot whose CURRENT comment is healthy and marked with `s`'s head. */
const snap = (s, extra = {}) => ({ schemaVersion: 1, prs: {}, currentSurface: { commentId: CURRENT_COMMENT, exists: true, markerHead: s.ledgerHead }, ...extra });
const openPr = (headSha, more = {}) => ({ state: 'open', merged: false, headSha, ...more });
const kinds = (fs_) => fs_.map((x) => x.kind).sort();
const EXT = [{ external: 'OWNER-DEVICE', condition: 'device check', owner: 'Owner', unblockWhen: 'owner verdict' }];

/** Run 54: activation tooling accepted and integrated, its hosted activation proof begun (and, in the snapshot, failed). */
function run54() {
  let r = chain(base(), { type: 'withdraw', packet: 'ALPHA' }, { type: 'release', packet: 'BETA', inbox: 396 }, { type: 'deliver', packet: 'BETA', pr: 516, subjectSha: B });
  r = raw(r, { type: 'accept', actor: 'Fable', source: comment(5847649445), packet: 'BETA', subjectSha: B });
  r = raw(r, { type: 'integrate', actor: 'L0', source: pull(516), packet: 'BETA', mergeSha: C, acceptance: 5847649445 });
  return r;
}

// ---- WATCH ----
test('WATCH is off with only queued work, on while a packet is released', () => {
  assert.equal(workerWatch(base().state, 'W3'), false);
  assert.equal(workerWatch(released().state, 'W3'), true);
});
test('a blocked packet does not keep WATCH on', () => {
  const r = add(released(), { type: 'block', packet: 'ALPHA', blockedBy: EXT });
  assert.equal(workerWatch(r.state, 'W3'), false);
  const v = workerView(r.state, 'W3');
  assert.ok(v.includes('WATCH=off'));
  assert.ok(v.includes('ACTIVE_NOW=none'));
  assert.ok(v.includes('BLOCKED=ALPHA (not work; does not keep WATCH on)'));
});
test('a reference packet does not keep WATCH on, even when released', () => {
  const r = add(base(), { type: 'release', packet: 'REF-1', inbox: 400 });
  assert.equal(r.state.packets['REF-1'].phase, 'RELEASED');
  assert.equal(workerWatch(r.state, 'W7'), false);
  assert.ok(workerView(r.state, 'W7').includes('WATCH=off'));
});
test('WATCH stays on while delivered work awaits review, and goes off on acceptance', () => {
  const r = delivered();
  assert.equal(workerWatch(r.state, 'W3'), true);
  assert.equal(workerWatch(add(r, { type: 'accept', packet: 'ALPHA', subjectSha: A }).state, 'W3'), false);
});

// ---- worker-view ----
test('worker-view prints one ACTIVE NOW, the packets awaiting review, NEXT, WATCH and the typed authority refs', () => {
  let r = add(delivered(), { type: 'review', packet: 'ALPHA', reviewers: ['Fable', 'W7'] });
  r = add(r, { type: 'release', packet: 'BETA', inbox: 396 });
  const v = workerView(r.state, 'W3');
  const ref = (x) => `comment:${x.id}`;
  const beta = r.state.packets.BETA.authority;
  const alpha = r.state.packets.ALPHA.authority;
  assert.deepEqual(v, [
    'WORKER=W3 inbox=#396',
    'ACTIVE_NOW=BETA phase=RELEASED',
    `AWAITING_REVIEW=ALPHA phase=UNDER_REVIEW pr=#520 subject=${A} reviewers=Fable,W7`,
    'NEXT=none',
    'WATCH=on',
    `AUTHORITY BETA origin=ledger queued=${ref(beta.queued)} released=${ref(beta.released)} last=${ref(beta.released)}`,
    `AUTHORITY ALPHA origin=ledger queued=${ref(alpha.queued)} released=${ref(alpha.released)} last=${ref(alpha.lastTransition)}`,
  ]);
});
test('a queued reference packet is never NEXT and asks for no release', () => {
  const s = base().state;
  assert.deepEqual(s.queue.W7, ['REF-1']);
  assert.ok(workerView(s, 'W7').includes('NEXT=none'));
  assert.ok(!programView(s).some((l) => l.includes('REF-1')));
});

// ---- program-view ----
test('program-view lists the critical path and the transitions waiting on Fable/L0', () => {
  let r = delivered();
  r = raw(r, { type: 'accept', actor: 'Fable', source: comment(70), packet: 'ALPHA', subjectSha: A });
  let v = programView(r.state);
  assert.equal(v[0], 'CRITICAL_PATH=ALPHA phase=ACCEPTED owner=W3 pr=#520');
  assert.ok(v.includes('NEEDS_TRANSITION ALPHA event=integrate by=L0 :: accepted but not integrated'));
  assert.ok(v.includes('NEEDS_TRANSITION BETA event=release by=Fable reactivates=W3 :: W3 holds no active packet and BETA is next'));
  assert.ok(v.includes(`ACCEPTED_NOT_INTEGRATED ALPHA subject=${A} pr=#520`));
  assert.ok(v.includes('SNAPSHOT=none (external blockers not evaluated; run conclusions unknown; GitHub facts not reconciled)'));
  assert.ok(v.includes('CURRENT_SURFACE=unchecked'));
  assert.deepEqual(v.slice(-2), ['ACTIONABLE=on', 'MONITOR=on']);
  r = raw(r, { type: 'integrate', actor: 'L0', source: pull(520), packet: 'ALPHA', mergeSha: B, acceptance: 70 });
  v = programView(r.state);
  assert.ok(v.includes(`INTEGRATED_NOT_STAGED ALPHA merge=${B}`));
  assert.ok(v.includes('NEEDS_TRANSITION ALPHA event=stage by=L0 :: integrated but not staged'));
});
test('an external blocker clears only when the supplied snapshot says so', () => {
  const s = add(released(), { type: 'block', packet: 'ALPHA', blockedBy: EXT }).state;
  const cleared = (v) => v.includes('BLOCKERS_CLEARED ALPHA');
  assert.equal(cleared(programView(s)), false);
  assert.equal(cleared(programView(s, snap(s))), false);
  assert.equal(cleared(programView(s, snap(s, { externalConditions: { 'OTHER-1': true } }))), false);
  assert.equal(cleared(programView(s, snap(s, { externalConditions: { 'OWNER-DEVICE': false } }))), false);
  assert.equal(cleared(programView(s, snap(s, { externalConditions: { 'OWNER-DEVICE': true } }))), true);
});
test('a packet blocker clears on the blocking packet\'s phase', () => {
  let r = chain(released(), { type: 'deliver', packet: 'ALPHA', pr: 520, subjectSha: A }, { type: 'release', packet: 'BETA', inbox: 396 }, { type: 'block', packet: 'BETA', blockedBy: [{ packet: 'ALPHA', until: 'INTEGRATED' }] });
  assert.ok(!programView(r.state).includes('BLOCKERS_CLEARED BETA'));
  r = raw(r, { type: 'accept', actor: 'Fable', source: comment(71), packet: 'ALPHA', subjectSha: A });
  assert.ok(!programView(r.state).includes('BLOCKERS_CLEARED BETA'));
  r = raw(r, { type: 'integrate', actor: 'L0', source: pull(520), packet: 'ALPHA', mergeSha: B, acceptance: 71 });
  assert.ok(programView(r.state).includes('BLOCKERS_CLEARED BETA'));
});
test('program-view flags inconsistent WATCH from the snapshot\'s check-in state', () => {
  const s = released().state;
  const v = programView(s, snap(s, { triggers: { W3: { enabled: false }, W7: { enabled: true } } }));
  assert.ok(v.includes('WATCH_INCONSISTENT W3 work-without-watch'));
  assert.ok(v.includes('WATCH_INCONSISTENT W7 watch-on-without-work'));
});

// ---- never a sleeping system (5848248754) ----
test('everything blocked and every WATCH off: ACTIONABLE=off but MONITOR=on; a snapshot that clears the dependency asks for the unblock and reactivates W3', () => {
  const r = chain(base(), { type: 'withdraw', packet: 'BETA' }, { type: 'release', packet: 'ALPHA', inbox: 396 }, { type: 'block', packet: 'ALPHA', blockedBy: EXT });
  const s = r.state;
  assert.deepEqual([workerWatch(s, 'W3'), workerWatch(s, 'W7')], [false, false]);
  const quiet = programView(s, snap(s, { externalConditions: { 'OWNER-DEVICE': false }, triggers: { W3: { enabled: false }, W7: { enabled: false } } }));
  assert.deepEqual(quiet.slice(-3), ['CURRENT_SURFACE=ok', 'ACTIONABLE=off', 'MONITOR=on']);
  assert.ok(!quiet.some((l) => l.startsWith('NEEDS_TRANSITION')));
  const cleared = programView(s, snap(s, { externalConditions: { 'OWNER-DEVICE': true }, triggers: { W3: { enabled: false }, W7: { enabled: false } } }));
  assert.ok(cleared.includes('NEEDS_TRANSITION ALPHA event=unblock by=Fable reactivates=W3 :: every blocker has cleared'));
  assert.ok(cleared.includes('BLOCKERS_CLEARED ALPHA'));
  assert.deepEqual(cleared.slice(-2), ['ACTIONABLE=on', 'MONITOR=on']);
  assert.equal(workerWatch(add(r, { type: 'unblock', packet: 'ALPHA' }).state, 'W3'), true);
});

// ---- post-integration proof (5848214525): run 54 ----
test('run 54: accepted + integrated activation tooling whose proof was never begun is not complete; program-view asks L0 to begin it', () => {
  const s = run54().state;
  assert.equal(isTerminal(s.packets.BETA), false);
  const v = programView(s);
  assert.ok(v.includes('NEEDS_TRANSITION BETA event=begin-proof by=L0 :: integrated; its completion contract needs a journey-activation proof'));
  assert.ok(v.includes(`INTEGRATED_NOT_VERIFIED BETA merge=${C}`));
});
test('run 54: a failed activation run shows as needing a corrective transition, not as complete', () => {
  const r = raw(run54(), { type: 'begin-proof', actor: 'L0', source: run(54), packet: 'BETA', runId: 54, proofType: 'journey-activation' });
  const s = r.state;
  const v = programView(s, snap(s, { prs: { 516: { state: 'closed', merged: true, headSha: B, mergeSha: C } }, runs: { 54: { status: 'completed', conclusion: 'failure' } } }));
  assert.ok(v.includes('NEEDS_TRANSITION BETA event=proof-fail by=Fable reactivates=W3 :: proof run 54 concluded failure; a focused finding comment records the failure'));
  assert.ok(v.includes(`INTEGRATED_NOT_VERIFIED BETA merge=${C} run=54 result=RUNNING`));
  assert.ok(v.some((l) => /^FINDING kind=proof-run-concluded wins=github packet=BETA run=54 :: the ledger says RUNNING; the run concluded failure suggest=\{"type":"proof-fail"/.test(l)));
  assert.equal(v.at(-2), 'ACTIONABLE=on');
  assert.equal(s.packets.BETA.phase, 'VERIFYING');
  const running = programView(s, snap(s, { prs: { 516: { state: 'closed', merged: true, headSha: B, mergeSha: C } }, runs: { 54: { status: 'in_progress', conclusion: null } } }));
  assert.ok(!running.some((l) => l.startsWith('NEEDS_TRANSITION BETA')));
});
test('run conclusion drift is reported by reconcile, never silently corrected', () => {
  let r = raw(run54(), { type: 'begin-proof', actor: 'L0', source: run(55), packet: 'BETA', runId: 55, proofType: 'journey-activation' });
  r = raw(r, { type: 'proof-pass', actor: 'L0', source: run(55), packet: 'BETA', runId: 55 });
  const state = freeze(JSON.parse(r.stateText));
  const s = freeze(snap(state, { prs: { 516: { state: 'closed', merged: true, headSha: B, mergeSha: C } }, runs: { 55: { status: 'completed', conclusion: 'failure' } } }));
  const before = JSON.stringify(state);
  const out = reconcile(state, s);
  assert.deepEqual(out.map((x) => [x.kind, x.wins, x.detail]), [['proof-result-drift', 'github', 'the ledger records PASS; the run is completed (failure)']]);
  assert.equal(JSON.stringify(state), before);
  assert.equal(state.packets.BETA.phase, 'VERIFIED');
});

// ---- reconcile ----
test('reconcile never mutates the state or the snapshot (deep-frozen inputs, identical after)', () => {
  const r = delivered();
  const state = freeze(JSON.parse(r.stateText));
  const s = freeze(snap(state, {
    prs: { 520: openPr(B, { changedSinceSubject: ['apps/wsf/x.ts'] }) },
    inboxHandoffs: [{ inbox: 396, commentId: 99, packet: 'GHOST' }],
    pin: { approvedAppSha: D }, staging: { servedSha: D }, triggers: { W3: { enabled: false } },
    currentSurface: { commentId: CURRENT_COMMENT, exists: false, markerHead: null },
  }));
  const before = [JSON.stringify(state), JSON.stringify(s)];
  const out = reconcile(state, s);
  assert.ok(out.length >= 6);
  assert.deepEqual([JSON.stringify(state), JSON.stringify(s)], before);
  assert.equal(programView(state, s).at(-2), 'ACTIONABLE=on');
});
test('reconcile: a head move inside the subject paths makes the subject stale; the ledger decides what follows', () => {
  const st = delivered().state;
  const out = reconcile(st, snap(st, { prs: { 520: openPr(B, { changedSinceSubject: ['apps/wsf/screen.tsx', 'docs/x.md'] }) } }));
  assert.deepEqual(kinds(out), ['pr-head-moved', 'subject-stale']);
  const stale = out.find((x) => x.kind === 'subject-stale');
  assert.equal(stale.wins, 'ledger');
  assert.match(stale.detail, /1 subject path\(s\) changed .*apps\/wsf\/screen\.tsx/);
  assert.deepEqual(out.find((x) => x.kind === 'pr-head-moved').suggest, { type: 'reconcile-head', packet: 'ALPHA', prHeadSha: B });
});
test('reconcile: a head move outside the subject paths is evidence movement; the subject stands', () => {
  const st = delivered().state;
  const out = reconcile(st, snap(st, { prs: { 520: openPr(B, { changedSinceSubject: ['docs/westayfit/evidence.md', 'apps/wsfx/y.ts'] }) } }));
  assert.deepEqual(kinds(out), ['evidence-moved', 'pr-head-moved']);
  assert.deepEqual(out.find((x) => x.kind === 'evidence-moved').suggest, { type: 'record-evidence', packet: 'ALPHA', evidenceSha: B });
});
test('reconcile: without changedSinceSubject the classification is reported unknown; a matching head is quiet', () => {
  const st = delivered().state;
  assert.deepEqual(kinds(reconcile(st, snap(st, { prs: { 520: openPr(B) } }))), ['pr-head-moved', 'subject-change-unknown']);
  assert.deepEqual(reconcile(st, snap(st, { prs: { 520: openPr(A) } })), []);
});
test('reconcile: merge and close drift', () => {
  const accepted = raw(delivered(), { type: 'accept', actor: 'Fable', source: comment(72), packet: 'ALPHA', subjectSha: A }).state;
  const merged = { state: 'closed', merged: true, headSha: A, mergeSha: E };
  const m1 = reconcile(accepted, snap(accepted, { prs: { 520: merged } }));
  assert.deepEqual(m1.map((x) => [x.kind, x.wins]), [['pr-merged-not-integrated', 'github']]);
  assert.deepEqual(m1[0].suggest, { type: 'integrate', packet: 'ALPHA', mergeSha: E, acceptance: 72, by: 'L0' });
  const st = delivered().state;
  assert.deepEqual(reconcile(st, snap(st, { prs: { 520: merged } })).map((x) => [x.kind, x.wins]), [['pr-merged-without-acceptance', 'ledger']]);
  assert.deepEqual(kinds(reconcile(st, snap(st, { prs: { 520: { state: 'closed', merged: false, headSha: A } } }))), ['pr-closed-not-withdrawn']);
  assert.deepEqual(kinds(reconcile(st, snap(st))), ['pr-not-in-snapshot']);
});
test('reconcile: inbox handoffs with no packet, outside the canonical inbox, or not recorded', () => {
  const st = released().state;
  const recorded = st.packets.ALPHA.authority.released.id;
  const out = reconcile(st, snap(st, { inboxHandoffs: [
    { inbox: 396, commentId: recorded, packet: 'ALPHA' },
    { inbox: 396, commentId: 11, packet: 'GHOST' },
    { inbox: 400, commentId: 12, packet: 'BETA' },
    { inbox: 396, commentId: 13, packet: 'ALPHA' },
  ] }));
  assert.deepEqual(out.map((x) => `${x.kind}:${x.commentId}`), ['handoff-without-packet:11', 'handoff-outside-canonical-inbox:12', 'handoff-not-recorded:13']);
  assert.ok(out.every((x) => x.wins === 'ledger'));
});
test('reconcile: a bootstrap import\'s supporting refs count as recorded handoffs', () => {
  const st = build([boot({ packets: { 'LIVE-1': { owner: 'W3', completion: SOURCE_ONLY, phase: 'ACKED', refs: [comment(5847471407)] } } })]).state;
  assert.deepEqual(reconcile(st, snap(st, { inboxHandoffs: [{ inbox: 396, commentId: 5847471407, packet: 'LIVE-1' }] })), []);
});
test('reconcile: staging and pin mismatches', () => {
  const s = base().state;
  assert.deepEqual(reconcile(s, snap(s, { pin: { approvedAppSha: C }, staging: { servedSha: C } })), []);
  assert.deepEqual(kinds(reconcile(s, snap(s, { pin: { approvedAppSha: D }, staging: { servedSha: E } }))), ['pin-mismatch', 'staging-mismatch']);
});
test('reconcile: queue/phase inconsistencies in a supplied state are reported, not repaired', () => {
  const s = JSON.parse(released().stateText);
  s.queue.W3 = ['ALPHA', 'BETA'];
  const out = reconcile(freeze(s), snap(s));
  assert.deepEqual(out.map((x) => x.kind), ['queue-phase-inconsistent']);
  assert.match(out[0].detail, /W3's queue names ALPHA, which is already RELEASED/);
});
test('a snapshot carrying prose, titles, bodies or secrets is refused', () => {
  const s = base().state;
  assert.ok(validateSnapshot(snap(s, { prs: { 520: openPr(A, { title: 'x' }) } })).some((p) => /unknown key "title"/.test(p)));
  assert.ok(validateSnapshot(snap(s, { ci: {} })).some((p) => /unknown key "ci"/.test(p)));
  assert.ok(validateSnapshot(snap(s, { inboxHandoffs: [{ inbox: 396, commentId: 1, packet: 'A1', body: 'hi' }] })).some((p) => /exactly \{ inbox, commentId, packet \}/.test(p)));
  assert.ok(validateSnapshot(snap(s, { runs: { 5: { status: 'completed', conclusion: 'failure', url: 'x' } } })).some((p) => /snapshot.runs.5 must be exactly/.test(p)));
  assert.ok(validateSnapshot(snap(s, { runs: { 5: { status: 'in_progress', conclusion: 'success' } } })).some((p) => /snapshot.runs.5 must be exactly/.test(p)));
  assert.ok(validateSnapshot(snap(s, { prs: { 520: openPr(A, { changedSinceSubject: ['a@b.co'] }) } })).some((p) => /email-address-shaped/.test(p)));
  assert.ok(validateSnapshot(snap(s, { prs: { 520: { state: 'closed', merged: true, headSha: A } } })).some((p) => /needs its mergeSha/.test(p)));
  refused(() => reconcile(s, { schemaVersion: 2, prs: {} }), /schemaVersion must be 1/);
});
test('subject paths: "*" is the whole tree; others are a file or a directory prefix', () => {
  assert.equal(inSubject('anything/at/all', ['*']), true);
  assert.equal(inSubject('apps/wsf/a.ts', ['apps/wsf']), true);
  assert.equal(inSubject('apps/wsf', ['apps/wsf']), true);
  assert.equal(inSubject('apps/wsfx/a.ts', ['apps/wsf']), false);
  assert.equal(inSubject('apps/wsf/a.ts', ['apps/wsf/']), true);
});

// ---- control surfaces (5848241695): the CURRENT pointer fails closed ----
test('CURRENT surface: a healthy comment at this head, or at an earlier head of this ledger, is ok', () => {
  const r1 = released();
  const heads = ledgerHeads(r1.eventsText);
  assert.equal(surfaceStatus(r1.state, snap(r1.state), heads).ok, true);
  const earlier = { ...snap(r1.state), currentSurface: { commentId: CURRENT_COMMENT, exists: true, markerHead: heads[1] } };
  const st = surfaceStatus(r1.state, earlier, heads);
  assert.deepEqual([st.ok, st.detail], [true, 'behind the ledger head; re-render and edit in place']);
});
for (const [name, surface, re] of [
  ['the comment is deleted', { commentId: CURRENT_COMMENT, exists: false, markerHead: null }, /is missing; it is not re-created without a set-surfaces decision/],
  ['the comment has no control marker', { commentId: CURRENT_COMMENT, exists: true, markerHead: null }, /carries no control marker/],
  ['the marker names a head this ledger never had', { commentId: CURRENT_COMMENT, exists: true, markerHead: 'f'.repeat(64) }, /which is not a head of this ledger/],
  ['the snapshot checked another comment', { commentId: 1234, exists: true, markerHead: GENESIS }, /the ledger's CURRENT is comment 9001/],
]) {
  test(`CURRENT surface fails closed: ${name}`, () => {
    const s = released().state;
    const out = reconcile(s, { schemaVersion: 1, prs: {}, currentSurface: surface });
    assert.deepEqual(out.map((x) => [x.kind, x.wins]), [['control-surface-exception', 'exception']]);
    assert.match(out[0].detail, re);
    assert.ok(programView(s, { schemaVersion: 1, prs: {}, currentSurface: surface }).includes('CURRENT_SURFACE=exception'));
  });
}
test('CURRENT surface fails closed when the snapshot does not report it at all', () => {
  const s = released().state;
  const out = reconcile(s, { schemaVersion: 1, prs: {} });
  assert.deepEqual(out.map((x) => x.kind), ['control-surface-exception']);
  assert.match(out[0].detail, /not edited unchecked/);
});

// ---- CURRENT rendering ----
test('CURRENT is byte-stable, embeds the ledgerHead, and says what the bootstrap imported', () => {
  const r = delivered();
  const t1 = renderCurrent(r.state);
  assert.equal(t1, renderCurrent(JSON.parse(r.stateText)));
  assert.equal(t1.split('\n')[0], `<!-- wsf-control ledgerHead=${r.state.ledgerHead} events=${r.state.eventCount} rendered by tools/wsf-control/render-current.mjs; do not edit -->`);
  assert.ok(t1.endsWith('\n'));
  assert.match(t1, /^- Genesis: bootstrap as of 2026-09-26T17:00:00Z\. /m);
  assert.match(t1, /\| ALPHA \| W3 \| work \| STAGED \(hosted\) \| ledger \| DELIVERED \| #520 \| aaaaaaaa \| aaaaaaaa \| — \| — \| — \|/);
  assert.match(t1, /\| W3 \| #396 \| — \| ALPHA \| — \| BETA \| BETA \| on \|/);
  assert.deepEqual(verifyCurrent(r.state, t1), { status: 'current' });
  const imported = renderCurrent(build([boot({ packets: { 'LIVE-1': { owner: 'W3', completion: VERIFIED_ACTIVATION, phase: 'ACKED', refs: [comment(1)] } } })]).state);
  assert.match(imported, /\| LIVE-1 \| W3 \| work \| VERIFIED \(journey-activation\) \| bootstrap \| ACKED \|/);
});
test('a hand-edited CURRENT is detectable; one from an older head is stale', () => {
  const r = delivered();
  assert.equal(verifyCurrent(r.state, renderCurrent(r.state).replace('| DELIVERED |', '| ACCEPTED |')).status, 'hand-edited');
  assert.equal(verifyCurrent(r.state, `${renderCurrent(r.state)}\nnote\n`).status, 'hand-edited');
  const r1 = add(r, { type: 'accept', packet: 'ALPHA', subjectSha: A });
  assert.equal(verifyCurrent(r1.state, renderCurrent(r.state)).status, 'stale');
});

// ---- CLIs: refuse an invalid state; print; never write the state ----
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-control-v-'));
function dirWith(events) {
  const d = path.join(tmp(), 'state');
  let head = GENESIS;
  for (const [i, e] of events.entries()) head = appendToDir(d, { actor: 'Fable', source: comment(4000 + i), ...e }, { expectHead: head }).state.ledgerHead;
  return d;
}
const withRelease = [...BASE, { type: 'release', packet: 'ALPHA', inbox: 396 }];
const snapshotFile = (dir, s) => { const f = path.join(path.dirname(dir), 'snap.json'); fs.writeFileSync(f, JSON.stringify(s)); return f; };
const pair = (d) => ['events.jsonl', 'state.json'].map((f) => fs.readFileSync(path.join(d, f), 'utf8'));
const stateOf = (d) => JSON.parse(fs.readFileSync(path.join(d, 'state.json'), 'utf8'));

test('the view CLIs print and change nothing', () => {
  const d = dirWith(withRelease);
  const before = pair(d);
  const s = stateOf(d);
  const w = cli('worker-view.mjs', [d, 'W3']);
  assert.equal(w.status, 0, w.stderr);
  assert.match(w.stdout, /^ACTIVE_NOW=ALPHA phase=RELEASED$/m);
  assert.match(w.stdout, /^WATCH=on$/m);
  const p = cli('program-view.mjs', [d, '--snapshot', snapshotFile(d, snap(s, { triggers: { W3: { enabled: true } } }))]);
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /^CRITICAL_PATH=ALPHA phase=RELEASED owner=W3$/m);
  assert.match(p.stdout, /^CURRENT_SURFACE=ok$/m);
  assert.match(p.stdout, /^MONITOR=on$/m);
  const rc = cli('reconcile.mjs', [d, snapshotFile(d, snap(s, { inboxHandoffs: [{ inbox: 396, commentId: 5, packet: 'GHOST' }] }))]);
  assert.equal(rc.status, 0, rc.stderr);
  assert.match(rc.stdout, /^FINDING kind=handoff-without-packet wins=ledger packet=GHOST inbox=#396 comment=5 :: /m);
  assert.match(rc.stdout, /^CURRENT_SURFACE=ok$/m);
  assert.match(rc.stdout, /^RECONCILE findings=1 head=[0-9a-f]{64}$/m);
  const bad = cli('reconcile.mjs', [d, snapshotFile(d, { schemaVersion: 1, prs: {}, currentSurface: { commentId: CURRENT_COMMENT, exists: true, markerHead: null } })]);
  assert.match(bad.stdout, /^CURRENT_SURFACE=exception$/m);
  assert.deepEqual(pair(d), before);
});
test('render-current CLI: --out then --verify is current; a hand edit fails --verify', () => {
  const d = dirWith(withRelease);
  const out = path.join(path.dirname(d), 'CURRENT.md');
  assert.equal(cli('render-current.mjs', [d, '--out', out]).status, 0);
  const v = cli('render-current.mjs', [d, '--verify', out]);
  assert.equal(v.status, 0);
  assert.match(v.stdout, /^CURRENT=current$/m);
  fs.writeFileSync(out, fs.readFileSync(out, 'utf8').replace('RELEASED', 'ACCEPTED'));
  const bad = cli('render-current.mjs', [d, '--verify', out]);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /^CURRENT=hand-edited$/m);
});
test('every view CLI refuses a hand-edited state', () => {
  const d = dirWith(withRelease);
  const sp = path.join(d, 'state.json');
  fs.writeFileSync(sp, fs.readFileSync(sp, 'utf8').replace('"phase": "RELEASED"', '"phase": "QUEUED"'));
  for (const [script, args, re] of [
    ['worker-view.mjs', [d, 'W3'], /WORKER_VIEW=refused/],
    ['program-view.mjs', [d], /PROGRAM_VIEW=refused/],
    ['reconcile.mjs', [d, snapshotFile(d, { schemaVersion: 1, prs: {} })], /RECONCILE=refused/],
    ['render-current.mjs', [d], /CURRENT=refused/],
  ]) {
    const r = cli(script, args);
    assert.equal(r.status, 2, `${script} should refuse`);
    assert.match(r.stdout, re);
  }
});
test('reconcile and program-view CLIs refuse a malformed snapshot', () => {
  const d = dirWith(withRelease);
  const f = snapshotFile(d, { schemaVersion: 1, prs: { 520: { state: 'open', merged: false, headSha: A, title: 'copied title' } } });
  assert.match(cli('reconcile.mjs', [d, f]).stdout, /RECONCILE=refused \(the snapshot is malformed\)/);
  assert.match(cli('program-view.mjs', [d, '--snapshot', f]).stdout, /PROGRAM_VIEW=refused \(the snapshot is malformed\)/);
});

done('views');
