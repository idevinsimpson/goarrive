#!/usr/bin/env node
/**
 * AUTONOMY-STATE-1A O3–O5 (Director #519 5849138687, 5849148679, 5849163727, 5849164141):
 *   O3  retract-release: a newer hold before ACK returns a released packet to NEXT;
 *   O4a review-pass: an assigned W# reviewer's PASS releases its ball, never acceptance;
 *   O4b reassign-review: replace the reviewer set of an UNDER_REVIEW packet;
 *   O5a transfer-owner: worker death after ACK or CHANGES_REQUESTED, the new owner re-ACKs;
 *   O5b stage is the DEPLOYMENT RECEIPT only; HOSTED VERIFIED (proof-pass) completes STAGED.
 */
import assert from 'node:assert/strict';
import { A, B, C, BASE, SOURCE_ONLY, add, build, chain, comment, done, pull, refused, run, test } from './helpers.mjs';
import { appendEvent } from '../append.mjs';
import { workerWatch } from '../derive.mjs';
import { reduce } from '../reduce.mjs';
import { isTerminal } from '../schema.mjs';
import { workerView } from '../worker-view.mjs';
import { programView } from '../program-view.mjs';
import { reconcile } from '../reconcile.mjs';
import { invariants } from '../check.mjs';

const base = () => build(BASE);
const raw = (r, e) => appendEvent(r.eventsText, { actor: 'Fable', ...e }, { expectHead: r.state.ledgerHead });
const again = (r, e) => appendEvent(r.eventsText, { actor: 'Fable', ...e }, { expectHead: r.state.ledgerHead });
const lines = (r) => r.eventsText.trimEnd().split('\n').map((l) => JSON.parse(l));
const W = (s, w) => workerWatch(s, w);
const reg = (r, w, inbox) => add(r, { type: 'register-worker', worker: w, inbox });
const REF_A = { type: 'queue', packet: 'REF-A', owner: 'W3', kind: 'reference', completion: SOURCE_ONLY };

// ---------------------------------------------------------------- O3
test('O3.1: ALPHA NEXT → released to W3 → a newer retract before ACK → ALPHA is NEXT again, W3 WATCH off, history kept', () => {
  let r = add(base(), { type: 'release', packet: 'ALPHA', inbox: 396 });
  assert.deepEqual([r.state.packets.ALPHA.phase, W(r.state, 'W3')], ['RELEASED', true]);
  r = raw(r, { type: 'retract-release', source: comment(9301), packet: 'ALPHA' });
  const p = r.state.packets.ALPHA;
  assert.deepEqual([p.phase, p.inbox, p.authority.released, r.state.queue.W3, W(r.state, 'W3')], ['QUEUED', null, null, ['ALPHA'], false]);
  assert.ok(workerView(r.state, 'W3').includes('NEXT=ALPHA'));
  assert.deepEqual(lines(r).slice(-2).map((e) => e.type), ['release', 'retract-release']); // the release is history, not erased
});
test('O3: retraction restores the original relative queue position', () => {
  let r = chain(base(), REF_A, { type: 'reorder-queue', owner: 'W3', order: ['ALPHA', 'REF-A'] }, { type: 'release', packet: 'ALPHA', inbox: 396 });
  assert.deepEqual(r.state.queue.W3, ['REF-A']);
  r = add(r, { type: 'retract-release', packet: 'ALPHA' });
  assert.deepEqual(r.state.queue.W3, ['ALPHA', 'REF-A']);
});
test('O3.2: a different work packet occupied NEXT before the retract → refused (one NEXT)', () => {
  const r = chain(base(), { type: 'release', packet: 'ALPHA', inbox: 396 }, { type: 'queue', packet: 'BETA', owner: 'W3', completion: SOURCE_ONLY });
  refused(() => add(r, { type: 'retract-release', packet: 'ALPHA' }), /W3 has 2 queued work packets \(ALPHA, BETA\); at most one NEXT/);
});
test('O3.3: retract after ACK → refused', () => {
  const r = chain(base(), { type: 'release', packet: 'ALPHA', inbox: 396 }, { type: 'ack', packet: 'ALPHA', worker: 'W3' });
  refused(() => add(r, { type: 'retract-release', packet: 'ALPHA' }), /retract-release is not legal from ACKED/);
});
test('O3.4: a retry of the same retract source is idempotent', () => {
  const r0 = add(base(), { type: 'release', packet: 'ALPHA', inbox: 396 });
  const ev = { type: 'retract-release', source: comment(9302), packet: 'ALPHA' };
  const r1 = raw(r0, ev);
  const r2 = again(r1, ev);
  assert.deepEqual([r2.noop, r2.eventsText === r1.eventsText], [true, true]);
});
test('O3.5: a released reference packet retracts back to its queue and stays non-driving', () => {
  let r = add(base(), { type: 'release', packet: 'REF-1', inbox: 400 });
  r = add(r, { type: 'retract-release', packet: 'REF-1' });
  assert.deepEqual([r.state.packets['REF-1'].phase, r.state.queue.W7, W(r.state, 'W7')], ['QUEUED', ['REF-1'], false]);
  assert.ok(workerView(r.state, 'W7').includes('NEXT=none'));
});

// ---------------------------------------------------------------- O4a
const delivered = () => chain(base(), { type: 'release', packet: 'ALPHA', inbox: 396 }, { type: 'deliver', packet: 'ALPHA', pr: 520, subjectSha: A });
const twoReviewers = () => add(reg(delivered(), 'W5', 405), { type: 'review', packet: 'ALPHA', reviewers: ['W7', 'W5'] });
test('O4a.1: W7 assigned → WATCH on; W7 review-pass → WATCH off while the packet stays unaccepted', () => {
  let r = add(delivered(), { type: 'review', packet: 'ALPHA', reviewers: ['W7'] });
  assert.equal(W(r.state, 'W7'), true);
  r = add(r, { type: 'review-pass', packet: 'ALPHA', reviewer: 'W7' });
  assert.deepEqual([W(r.state, 'W7'), r.state.packets.ALPHA.phase, r.state.packets.ALPHA.reviewedBy], [false, 'UNDER_REVIEW', ['W7']]);
  assert.ok(workerView(r.state, 'W7').includes('REVIEWING=none'));
  assert.ok(programView(r.state).includes(`AWAITING_ACCEPTANCE ALPHA subject=${A} passed=W7`));
});
test('O4a.2: two W# reviewers: W7 passing turns only W7 off; W5 stays on', () => {
  const r = add(twoReviewers(), { type: 'review-pass', packet: 'ALPHA', reviewer: 'W7' });
  assert.deepEqual([W(r.state, 'W7'), W(r.state, 'W5')], [false, true]);
  assert.ok(programView(r.state).includes('AWAITING_REVIEW ALPHA pending=W5 passed=W7'));
});
test('O4a.3: accept before every assigned W# review has passed → refused', () => {
  const r = add(twoReviewers(), { type: 'review-pass', packet: 'ALPHA', reviewer: 'W7' });
  refused(() => add(r, { type: 'accept', packet: 'ALPHA', subjectSha: A }), /assigned W# review\(s\) not complete: W5/);
});
test('O4a.4: accept after all assigned W# passes → allowed, subject unchanged', () => {
  const r = chain(twoReviewers(), { type: 'review-pass', packet: 'ALPHA', reviewer: 'W7' }, { type: 'review-pass', packet: 'ALPHA', reviewer: 'W5' },
    { type: 'accept', packet: 'ALPHA', subjectSha: A });
  assert.deepEqual([r.state.packets.ALPHA.phase, r.state.packets.ALPHA.artifact.subjectSha, W(r.state, 'W7'), W(r.state, 'W5')], ['ACCEPTED', A, false, false]);
});
test('O4a.5: a finding before the pass → owner back on, reviewer off, review cycle cleared', () => {
  const r = chain(add(delivered(), { type: 'review', packet: 'ALPHA', reviewers: ['W7'] }), { type: 'finding', packet: 'ALPHA' });
  assert.deepEqual([W(r.state, 'W3'), W(r.state, 'W7'), r.state.packets.ALPHA.reviewedBy], [true, false, []]);
});
test('O4a.6: a successor delivery after a finding does not inherit an earlier pass', () => {
  let r = chain(twoReviewers(), { type: 'review-pass', packet: 'ALPHA', reviewer: 'W7' }, { type: 'finding', packet: 'ALPHA' },
    { type: 'deliver', packet: 'ALPHA', pr: 520, subjectSha: B }, { type: 'review', packet: 'ALPHA', reviewers: ['W7'] });
  assert.deepEqual([r.state.packets.ALPHA.reviewedBy, W(r.state, 'W7')], [[], true]);
  refused(() => add(r, { type: 'accept', packet: 'ALPHA', subjectSha: B }), /not complete: W7/);
});
test('O4a.5b: a finding after one reviewer passed clears that pass: the owner holds the ball, no reviewer does', () => {
  const r = chain(twoReviewers(), { type: 'review-pass', packet: 'ALPHA', reviewer: 'W7' }, { type: 'finding', packet: 'ALPHA' });
  assert.deepEqual([r.state.packets.ALPHA.reviewedBy, W(r.state, 'W3'), W(r.state, 'W7'), W(r.state, 'W5')], [[], true, false, false]);
});
test('O4a.7: the same review-pass source again is idempotent; a second pass from another source is refused', () => {
  const r0 = add(delivered(), { type: 'review', packet: 'ALPHA', reviewers: ['W7'] });
  const ev = { type: 'review-pass', source: comment(9401), packet: 'ALPHA', reviewer: 'W7' };
  const r1 = raw(r0, ev);
  assert.equal(again(r1, ev).noop, true);
  refused(() => add(r1, { type: 'review-pass', packet: 'ALPHA', reviewer: 'W7' }), /already passed ALPHA in this review cycle/);
});
test('O4a.8: a pass from an unassigned reviewer → refused', () => {
  const r = add(delivered(), { type: 'review', packet: 'ALPHA', reviewers: ['W7'] });
  refused(() => add(r, { type: 'review-pass', packet: 'ALPHA', reviewer: 'W5' }), /W5 is not an assigned reviewer of ALPHA/);
});

// ---------------------------------------------------------------- O4b
const w7Reviewing = () => add(reg(delivered(), 'W9', 409), { type: 'review', packet: 'ALPHA', reviewers: ['W7'] });
test('O4b.1: W7 reviewing ALPHA → reassigned to a free W9: W7 off, W9 REVIEWING and WATCH on; owner stays off; subject unchanged', () => {
  const r = add(w7Reviewing(), { type: 'reassign-review', packet: 'ALPHA', reviewers: ['W9'] });
  assert.deepEqual([W(r.state, 'W7'), W(r.state, 'W9'), W(r.state, 'W3'), r.state.packets.ALPHA.artifact.subjectSha, r.state.packets.ALPHA.phase], [false, true, false, A, 'UNDER_REVIEW']);
  assert.ok(workerView(r.state, 'W9').some((l) => l.startsWith('REVIEWING=ALPHA ')));
});
test('O4b.2: reassignment to the owner W3 → refused', () => {
  refused(() => add(w7Reviewing(), { type: 'reassign-review', packet: 'ALPHA', reviewers: ['W3'] }), /W3 cannot review its own work packet ALPHA/);
});
test('O4b.3: reassignment to a busy or unregistered W# → refused', () => {
  let r = chain(w7Reviewing(), { type: 'queue', packet: 'GAMMA', owner: 'W9', completion: SOURCE_ONLY }, { type: 'release', packet: 'GAMMA', inbox: 409 });
  refused(() => add(r, { type: 'reassign-review', packet: 'ALPHA', reviewers: ['W9'] }), /W9 holds 2 balls \(active GAMMA; reviewing ALPHA\)/);
  refused(() => add(w7Reviewing(), { type: 'reassign-review', packet: 'ALPHA', reviewers: ['W8'] }), /reviewer W8 of ALPHA is not a registered worker/);
});
test('O4b.4: reassignment to the Director creates no W# WATCH', () => {
  const r = add(w7Reviewing(), { type: 'reassign-review', packet: 'ALPHA', reviewers: ['Director'] });
  assert.deepEqual([W(r.state, 'W7'), W(r.state, 'W9'), W(r.state, 'W3')], [false, false, false]);
});
test('O4b.5: the original review and the reassignment both remain in the append-only history', () => {
  const r = add(w7Reviewing(), { type: 'reassign-review', packet: 'ALPHA', reviewers: ['W9'] });
  const types = lines(r).map((e) => e.type);
  assert.deepEqual(types.slice(-2), ['review', 'reassign-review']);
  assert.equal(reduce(r.eventsText).packets.ALPHA.reviewers.join(), 'W9');
});
test('O4b.6: a reassignment drops passes of removed reviewers and keeps passes of retained ones', () => {
  const passed = chain(reg(twoReviewers(), 'W9', 409), { type: 'review-pass', packet: 'ALPHA', reviewer: 'W7' });
  const away = add(passed, { type: 'reassign-review', packet: 'ALPHA', reviewers: ['W5', 'W9'] });
  assert.deepEqual(away.state.packets.ALPHA.reviewedBy, []);
  assert.ok(programView(away.state).includes('AWAITING_REVIEW ALPHA pending=W5,W9'));
  // Reassigned away and back: an earlier pass does not come back with it.
  const back = add(away, { type: 'reassign-review', packet: 'ALPHA', reviewers: ['W7', 'W5'] });
  assert.deepEqual([back.state.packets.ALPHA.reviewedBy, W(back.state, 'W7')], [[], true]);
  const kept = add(passed, { type: 'reassign-review', packet: 'ALPHA', reviewers: ['W7', 'W9'] });
  assert.deepEqual([kept.state.packets.ALPHA.reviewedBy, W(kept.state, 'W7'), W(kept.state, 'W9')], [['W7'], false, true]);
});

// ---------------------------------------------------------------- O5a
const acked = () => reg(chain(base(), { type: 'release', packet: 'ALPHA', inbox: 396 }, { type: 'ack', packet: 'ALPHA', worker: 'W3' }), 'W9', 409);
test('O5a.1: W3 ACKED ALPHA → transfer to a free W9 → RELEASED in W9\'s canonical inbox; W3 off, W9 on; W9 ACK succeeds', () => {
  let r = add(acked(), { type: 'transfer-owner', packet: 'ALPHA', owner: 'W9', inbox: 409 });
  const p = r.state.packets.ALPHA;
  assert.deepEqual([p.owner, p.inbox, p.phase, W(r.state, 'W3'), W(r.state, 'W9')], ['W9', 409, 'RELEASED', false, true]);
  r = add(r, { type: 'ack', packet: 'ALPHA', worker: 'W9' });
  assert.equal(r.state.packets.ALPHA.phase, 'ACKED');
});
test('O5a.2: a CHANGES_REQUESTED transfer keeps subject, PR and evidence, and needs a new ACK', () => {
  let r = chain(delivered(), { type: 'record-evidence', packet: 'ALPHA', evidenceSha: C }, { type: 'review', packet: 'ALPHA', reviewers: ['W7'] }, { type: 'finding', packet: 'ALPHA' });
  r = add(reg(r, 'W9', 409), { type: 'transfer-owner', packet: 'ALPHA', owner: 'W9', inbox: 409 });
  const p = r.state.packets.ALPHA;
  assert.deepEqual([p.phase, p.owner, p.pr, p.artifact.subjectSha, p.artifact.evidenceSha], ['RELEASED', 'W9', 520, A, C]);
  refused(() => add(r, { type: 'ack', packet: 'ALPHA', worker: 'W3' }), /ack names W3, but ALPHA is owned by W9/);
  assert.equal(add(r, { type: 'ack', packet: 'ALPHA', worker: 'W9' }).state.packets.ALPHA.phase, 'ACKED');
});
test('O5a.3: transfer to a busy, unregistered or the same owner → refused', () => {
  const r = chain(acked(), { type: 'queue', packet: 'GAMMA', owner: 'W9', completion: SOURCE_ONLY }, { type: 'release', packet: 'GAMMA', inbox: 409 });
  refused(() => add(r, { type: 'transfer-owner', packet: 'ALPHA', owner: 'W9', inbox: 409 }), /W9 holds 2 worker-owned packets/);
  refused(() => add(acked(), { type: 'transfer-owner', packet: 'ALPHA', owner: 'W8', inbox: 408 }), /worker W8 is not registered/);
  refused(() => add(acked(), { type: 'transfer-owner', packet: 'ALPHA', owner: 'W3', inbox: 396 }), /already owned by W3/);
  refused(() => add(acked(), { type: 'transfer-owner', packet: 'ALPHA', owner: 'W9', inbox: 396 }), /W9's canonical inbox #409, not #396/);
});
test('O5a.4: after a transfer the old owner cannot ACK; the new owner can', () => {
  const r = add(acked(), { type: 'transfer-owner', packet: 'ALPHA', owner: 'W9', inbox: 409 });
  refused(() => add(r, { type: 'ack', packet: 'ALPHA', worker: 'W3' }), /ack names W3, but ALPHA is owned by W9/);
  assert.equal(add(r, { type: 'ack', packet: 'ALPHA', worker: 'W9' }).state.packets.ALPHA.phase, 'ACKED');
});
test('O5a: a death before ACK uses retract-release, not a second rewind path; a transferred packet cannot be retracted into a queue', () => {
  refused(() => add(reg(add(base(), { type: 'release', packet: 'ALPHA', inbox: 396 }), 'W9', 409), { type: 'transfer-owner', packet: 'ALPHA', owner: 'W9', inbox: 409 }), /transfer-owner is not legal from RELEASED/);
  const r = add(acked(), { type: 'transfer-owner', packet: 'ALPHA', owner: 'W9', inbox: 409 });
  refused(() => add(r, { type: 'retract-release', packet: 'ALPHA' }), /applies only to a packet released from its queue/);
});

// ---------------------------------------------------------------- O5b
const integrated = () => {
  let r = delivered();
  r = raw(r, { type: 'accept', source: comment(9501), packet: 'ALPHA', subjectSha: A });
  return raw(r, { type: 'integrate', actor: 'L0', source: pull(520), packet: 'ALPHA', mergeSha: B, acceptance: 9501 });
};
const L0 = (r, e) => appendEvent(r.eventsText, { actor: 'L0', ...e }, { expectHead: r.state.ledgerHead });
test('O5b.1: stage straight from INTEGRATED with no hosted proof → refused', () => {
  refused(() => L0(integrated(), { type: 'stage', source: run(81), packet: 'ALPHA', runId: 81, servedSha: B }), /stage is not legal from INTEGRATED/);
});
test('O5b.2: begin-proof + stage → still non-terminal VERIFYING, proof RUNNING, served receipt recorded', () => {
  let r = L0(integrated(), { type: 'begin-proof', source: run(81), packet: 'ALPHA', runId: 81, proofType: 'hosted' });
  r = L0(r, { type: 'stage', source: run(81), packet: 'ALPHA', runId: 81, servedSha: B });
  const p = r.state.packets.ALPHA;
  assert.deepEqual([p.phase, p.proof.result, p.served, isTerminal(p)], ['VERIFYING', 'RUNNING', { runId: 81, servedSha: B }, false]);
});
test('O5b.3: a hosted proof PASS before the served receipt → refused for a STAGED contract', () => {
  const r = L0(integrated(), { type: 'begin-proof', source: run(81), packet: 'ALPHA', runId: 81, proofType: 'hosted' });
  refused(() => L0(r, { type: 'proof-pass', source: run(81), packet: 'ALPHA', runId: 81 }), /needs the served receipt of run 81/);
});
test('O5b.4: begin-proof + stage + proof-pass on the same run → STAGED terminal', () => {
  let r = L0(integrated(), { type: 'begin-proof', source: run(81), packet: 'ALPHA', runId: 81, proofType: 'hosted' });
  r = L0(r, { type: 'stage', source: run(81), packet: 'ALPHA', runId: 81, servedSha: B });
  r = L0(r, { type: 'proof-pass', source: run(81), packet: 'ALPHA', runId: 81 });
  assert.deepEqual([r.state.packets.ALPHA.phase, r.state.packets.ALPHA.proof.result, isTerminal(r.state.packets.ALPHA)], ['STAGED', 'PASS', true]);
});
test('O5b.5: stage never turns a RUNNING proof into PASS (program-view still asks for the proof result)', () => {
  let r = L0(integrated(), { type: 'begin-proof', source: run(81), packet: 'ALPHA', runId: 81, proofType: 'hosted' });
  r = L0(r, { type: 'stage', source: run(81), packet: 'ALPHA', runId: 81, servedSha: B });
  assert.equal(r.state.packets.ALPHA.proof.result, 'RUNNING');
  const v = programView(r.state, { schemaVersion: 1, prs: { 520: { state: 'closed', merged: true, headSha: A, mergeSha: B } }, runs: { 81: { status: 'completed', conclusion: 'success' } } });
  assert.ok(v.includes('NEEDS_TRANSITION ALPHA event=proof-pass by=L0 :: proof run 81 concluded success'));
});
test('O5b.6: hosted proof FAIL after stage → CHANGES_REQUESTED; the factual served receipt is retained', () => {
  let r = L0(integrated(), { type: 'begin-proof', source: run(81), packet: 'ALPHA', runId: 81, proofType: 'hosted' });
  r = L0(r, { type: 'stage', source: run(81), packet: 'ALPHA', runId: 81, servedSha: B });
  r = raw(r, { type: 'proof-fail', source: comment(9502), packet: 'ALPHA', runId: 81 });
  const p = r.state.packets.ALPHA;
  assert.deepEqual([p.phase, p.proof.result, p.served, isTerminal(p)], ['CHANGES_REQUESTED', 'FAIL', { runId: 81, servedSha: B }, false]);
});
test('O5b.7: a wrong run id, or a served SHA outside the integrated subject → refused', () => {
  const r = L0(integrated(), { type: 'begin-proof', source: run(81), packet: 'ALPHA', runId: 81, proofType: 'hosted' });
  refused(() => L0(r, { type: 'stage', source: run(82), packet: 'ALPHA', runId: 82, servedSha: B }), /stage names run 82, but the hosted proof in progress is run 81/);
  refused(() => L0(r, { type: 'stage', source: run(81), packet: 'ALPHA', runId: 81, servedSha: C }), /is not this packet's integrated subject/);
  const s = L0(r, { type: 'stage', source: run(81), packet: 'ALPHA', runId: 81, servedSha: B });
  refused(() => L0(s, { type: 'proof-pass', source: run(83), packet: 'ALPHA', runId: 83 }), /names run 83, but the proof in progress is run 81/);
});
test('O5b.8: a hosted proof FAIL ends the accepted review cycle; the correction needs a fresh W# pass', () => {
  let r = chain(delivered(), { type: 'review', packet: 'ALPHA', reviewers: ['W7'] }, { type: 'review-pass', packet: 'ALPHA', reviewer: 'W7' });
  r = raw(r, { type: 'accept', source: comment(9502), packet: 'ALPHA', subjectSha: A });
  r = raw(r, { type: 'integrate', actor: 'L0', source: pull(520), packet: 'ALPHA', mergeSha: B, acceptance: 9502 });
  r = L0(r, { type: 'begin-proof', source: run(81), packet: 'ALPHA', runId: 81, proofType: 'hosted' });
  r = L0(r, { type: 'stage', source: run(81), packet: 'ALPHA', runId: 81, servedSha: B });
  r = raw(r, { type: 'proof-fail', source: comment(9503), packet: 'ALPHA', runId: 81 });
  assert.deepEqual([r.state.packets.ALPHA.phase, r.state.packets.ALPHA.reviewedBy, W(r.state, 'W3')], ['CHANGES_REQUESTED', [], true]);
  r = chain(r, { type: 'deliver', packet: 'ALPHA', pr: 530, subjectSha: C }, { type: 'review', packet: 'ALPHA', reviewers: ['W7'] });
  assert.equal(W(r.state, 'W7'), true);
  refused(() => add(r, { type: 'accept', packet: 'ALPHA', subjectSha: C }), /not complete: W7/);
});
test('O5b.9: reconcile suggests stage (the served receipt) for a concluded hosted run first, then proof-pass', () => {
  const snap = { schemaVersion: 1, prs: { 520: { state: 'closed', merged: true, headSha: A, mergeSha: B } }, runs: { 81: { status: 'completed', conclusion: 'success' } } };
  const suggestion = (st) => reconcile(st, snap).find((x) => x.kind === 'proof-run-concluded')?.suggest?.type;
  const v = L0(integrated(), { type: 'begin-proof', source: run(81), packet: 'ALPHA', runId: 81, proofType: 'hosted' });
  assert.equal(suggestion(v.state), 'stage');
  assert.equal(suggestion(L0(v, { type: 'stage', source: run(81), packet: 'ALPHA', runId: 81, servedSha: B }).state), 'proof-pass');
});
test('O4/O5: the invariant refuses review passes that outlive their cycle or name an unassigned reviewer', () => {
  const r = chain(twoReviewers(), { type: 'review-pass', packet: 'ALPHA', reviewer: 'W7' });
  assert.deepEqual(invariants(r.state), []);
  const stale = structuredClone(r.state);
  stale.packets.ALPHA.phase = 'CHANGES_REQUESTED';
  assert.ok(invariants(stale).includes('ALPHA is CHANGES_REQUESTED but still carries review passes (W7) from an ended review cycle'));
  const blocked = structuredClone(stale);
  Object.assign(blocked.packets.ALPHA, { phase: 'BLOCKED', phaseBeforeBlock: 'DELIVERED' });
  assert.ok(invariants(blocked).includes('ALPHA is DELIVERED but still carries review passes (W7) from an ended review cycle'));
  const unassigned = structuredClone(r.state);
  unassigned.packets.ALPHA.reviewers = ['W5'];
  assert.ok(invariants(unassigned).includes('ALPHA: W7 passed review but is not an assigned reviewer'));
});
test('O5b: program-view asks for begin-proof after integration, then for the served receipt before the proof result', () => {
  const r = integrated();
  assert.ok(programView(r.state).includes('NEEDS_TRANSITION ALPHA event=begin-proof by=L0 :: integrated; staging needs a hosted proof with its deployment run'));
  const v = L0(r, { type: 'begin-proof', source: run(81), packet: 'ALPHA', runId: 81, proofType: 'hosted' });
  assert.ok(programView(v.state, { schemaVersion: 1, prs: { 520: { state: 'closed', merged: true, headSha: A, mergeSha: B } }, runs: { 81: { status: 'completed', conclusion: 'success' } } })
    .includes('NEEDS_TRANSITION ALPHA event=stage by=L0 :: proof run 81 concluded success'));
});

done('recovery');
