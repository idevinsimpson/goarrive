#!/usr/bin/env node
/**
 * AUTONOMY-STATE-1A F4 (Director #519 5848958204): review ownership drives the
 * reviewer, not the implementer. WATCH is on only for the worker holding the
 * ball: the owner in RELEASED/ACKED/CHANGES_REQUESTED, or the assigned W#
 * reviewer of an UNDER_REVIEW packet. A W# reviewer holds at most one review.
 */
import assert from 'node:assert/strict';
import { BASE, QUEUE_BETA, add, build, chain, comment, done, refused, test } from './helpers.mjs';
import { appendEvent } from '../append.mjs';
import { workerWatch } from '../derive.mjs';
import { workerView } from '../worker-view.mjs';
import { programView } from '../program-view.mjs';
import { renderCurrent } from '../render-current.mjs';

const base = () => build(BASE);
const raw = (r, e) => appendEvent(r.eventsText, { actor: 'Fable', ...e }, { expectHead: r.state.ledgerHead });
const delivered = () => chain(base(), { type: 'release', packet: 'ALPHA', inbox: 396 }, { type: 'deliver', packet: 'ALPHA', pr: 520, subjectSha: 'a'.repeat(40) });
const watch = (s) => ({ W3: workerWatch(s, 'W3'), W7: workerWatch(s, 'W7') });

test('F4.1: delivery turns the implementer\'s WATCH off; program-view asks Fable to route the review', () => {
  const s = delivered().state;
  assert.deepEqual(watch(s), { W3: false, W7: false });
  const v = workerView(s, 'W3');
  assert.ok(v.includes('WATCH=off'));
  assert.ok(v.includes('WAITING=ALPHA phase=DELIVERED (waiting on review; does not keep WATCH on)'));
  assert.ok(programView(s).includes('NEEDS_TRANSITION ALPHA event=review by=Fable :: delivered and not yet routed to review'));
});
test('F4.2: review routed to W7 → W7 REVIEWING and WATCH on; W3 stays off', () => {
  const s = add(delivered(), { type: 'review', packet: 'ALPHA', reviewers: ['W7'] }).state;
  assert.deepEqual(watch(s), { W3: false, W7: true });
  const v = workerView(s, 'W7');
  assert.ok(v.includes(`REVIEWING=ALPHA phase=UNDER_REVIEW pr=#520 subject=${'a'.repeat(40)} reviewers=W7 owner=W3`));
  assert.ok(v.includes('WATCH=on'));
  assert.ok(v.some((l) => l.startsWith('AUTHORITY ALPHA ')));
  assert.ok(workerView(s, 'W3').includes('WAITING=ALPHA phase=UNDER_REVIEW (waiting on review; does not keep WATCH on)'));
  assert.match(renderCurrent(s), /\| W7 \| #400 \| — \| ALPHA \| — \| — \| — \| REF-1 \| on \|/);
});
test('F4.3: a finding hands the ball back: W7 off, W3 on (CHANGES_REQUESTED)', () => {
  const s = chain(delivered(), { type: 'review', packet: 'ALPHA', reviewers: ['W7'] }, { type: 'finding', packet: 'ALPHA' }).state;
  assert.deepEqual(watch(s), { W3: true, W7: false });
  assert.ok(workerView(s, 'W3').includes('ACTIVE_NOW=ALPHA phase=CHANGES_REQUESTED pr=#520 subject=' + 'a'.repeat(40) + ' reviewers=W7'));
  assert.ok(workerView(s, 'W7').includes('REVIEWING=none'));
});
test('F4.3b: a successor delivery after the finding wakes no one until Fable routes the review again', () => {
  const r = chain(delivered(), { type: 'review', packet: 'ALPHA', reviewers: ['W7'] }, { type: 'finding', packet: 'ALPHA' },
    { type: 'deliver', packet: 'ALPHA', pr: 520, subjectSha: 'c'.repeat(40) });
  assert.deepEqual([r.state.packets.ALPHA.phase, r.state.packets.ALPHA.reviewers], ['DELIVERED', ['W7']]);
  assert.deepEqual(watch(r.state), { W3: false, W7: false });
  assert.ok(programView(r.state).includes('NEEDS_TRANSITION ALPHA event=review by=Fable :: delivered and not yet routed to review'));
});
test('F4.4: acceptance turns both W# watches off; integration is L0\'s transition', () => {
  let r = add(delivered(), { type: 'review', packet: 'ALPHA', reviewers: ['W7'] });
  r = raw(r, { type: 'accept', source: comment(9101), packet: 'ALPHA', subjectSha: 'a'.repeat(40) });
  assert.deepEqual(watch(r.state), { W3: false, W7: false });
  assert.ok(programView(r.state).includes('NEEDS_TRANSITION ALPHA event=integrate by=L0 :: accepted but not integrated'));
});
test('F4.5: a second simultaneous review for W7 is refused; the packet stays DELIVERED and ACTIONABLE', () => {
  let r = chain(delivered(), { type: 'review', packet: 'ALPHA', reviewers: ['W7'] }, QUEUE_BETA, { type: 'release', packet: 'BETA', inbox: 396 },
    { type: 'deliver', packet: 'BETA', pr: 530, subjectSha: 'b'.repeat(40) });
  refused(() => add(r, { type: 'review', packet: 'BETA', reviewers: ['W7'] }), /W7 is already reviewing 1 work packet \(ALPHA\); a W# reviewer holds at most one review/);
  assert.equal(r.state.packets.BETA.phase, 'DELIVERED');
  assert.ok(programView(r.state).includes('NEEDS_TRANSITION BETA event=review by=Fable :: delivered and not yet routed to review'));
  // A different, free reviewer may take it; multiple reviewers on one packet are fine when each is free.
  r = add(r, { type: 'register-worker', worker: 'W9', inbox: 409 });
  r = add(r, { type: 'review', packet: 'BETA', reviewers: ['W9', 'Fable'] });
  assert.deepEqual([workerWatch(r.state, 'W9'), r.state.packets.BETA.phase], [true, 'UNDER_REVIEW']);
});
test('F4.6: a Director, Owner, Fable or L0 review creates no worker WATCH', () => {
  const s = add(delivered(), { type: 'review', packet: 'ALPHA', reviewers: ['Director', 'Owner', 'Fable', 'L0'] }).state;
  assert.deepEqual(watch(s), { W3: false, W7: false });
  assert.ok(workerView(s, 'W7').includes('REVIEWING=none'));
});
test('F4: a W# reviewer must be a registered worker (it has no inbox or check-in otherwise)', () => {
  refused(() => add(delivered(), { type: 'review', packet: 'ALPHA', reviewers: ['W8'] }), /reviewer W8 of ALPHA is not a registered worker/);
});

// ---- F4 clarification (Director #519 5848971923): one W# holds one ball in total ----
/** W7 holds implementation work: GAMMA released to W7. */
const w7Active = (r) => chain(r, { type: 'queue', packet: 'GAMMA', owner: 'W7', completion: { terminal: 'INTEGRATED', proofType: 'source-only' } }, { type: 'release', packet: 'GAMMA', inbox: 400 });
test('F4.8: a worker holding implementation ACTIVE cannot be assigned as a reviewer', () => {
  const r = w7Active(delivered());
  assert.equal(r.state.packets.GAMMA.phase, 'RELEASED');
  refused(() => add(r, { type: 'review', packet: 'ALPHA', reviewers: ['W7'] }), /W7 holds 2 balls \(active GAMMA; reviewing ALPHA\); one ball per worker across implementation and review/);
  assert.equal(r.state.packets.ALPHA.phase, 'DELIVERED');
});
test('F4.9: a REVIEWING worker keeps one queued NEXT, but program-view does not suggest releasing it until the review completes', () => {
  let r = add(delivered(), { type: 'review', packet: 'ALPHA', reviewers: ['W7'] });
  r = add(r, { type: 'queue', packet: 'GAMMA', owner: 'W7', completion: { terminal: 'INTEGRATED', proofType: 'source-only' } });
  assert.ok(workerView(r.state, 'W7').includes('NEXT=GAMMA'));
  assert.ok(!programView(r.state).some((l) => /NEEDS_TRANSITION GAMMA event=release/.test(l)));
  refused(() => add(r, { type: 'release', packet: 'GAMMA', inbox: 400 }), /W7 holds 2 balls \(active GAMMA; reviewing ALPHA\)/);
  r = raw(r, { type: 'accept', source: comment(9102), packet: 'ALPHA', subjectSha: 'a'.repeat(40) });
  assert.ok(programView(r.state).includes('NEEDS_TRANSITION GAMMA event=release by=Fable reactivates=W7 :: W7 holds no active packet and GAMMA is next'));
  assert.equal(add(r, { type: 'release', packet: 'GAMMA', inbox: 400 }).state.packets.GAMMA.phase, 'RELEASED');
});

done('review');
