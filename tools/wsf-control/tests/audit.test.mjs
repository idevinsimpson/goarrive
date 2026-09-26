#!/usr/bin/env node
/**
 * AUTONOMY-STATE-1A O6/O7 (Director #519/#396 5849188356), the final deterministic audit:
 *   O6 an unblock reactivates whoever holds the ball in the restored phase: the owner of
 *      worker-owned work, the outstanding W# reviewers of an UNDER_REVIEW packet, no one
 *      for QUEUED or DELIVERED;
 *   O7 a packet blocker waits only for a milestone the dependency's completion contract can
 *      reach; an impossible `until` is refused, and being terminal alone never clears it.
 */
import assert from 'node:assert/strict';
import { A, B, BASE, SOURCE_ONLY, add, boot, build, chain, comment, done, pull, refused, run, test } from './helpers.mjs';
import { appendEvent } from '../append.mjs';
import { blockerCleared, neededTransitions, workerWatch } from '../derive.mjs';
import { invariants } from '../check.mjs';
import { programView } from '../program-view.mjs';

const EXT = [{ external: 'OWNER-HOLD', condition: 'owner decision pending', owner: 'Owner', unblockWhen: 'owner posts a verdict' }];
const CLEARED = { schemaVersion: 1, prs: {}, externalConditions: { 'OWNER-HOLD': true } };
const raw = (r, e) => appendEvent(r.eventsText, { actor: 'Fable', ...e }, { expectHead: r.state.ledgerHead });
const L0 = (r, e) => appendEvent(r.eventsText, { actor: 'L0', ...e }, { expectHead: r.state.ledgerHead });
const reg = (r, w, inbox) => add(r, { type: 'register-worker', worker: w, inbox });
const unblockOf = (s, id) => neededTransitions(s, CLEARED).find((n) => n.packet === id && n.event === 'unblock');
const base = () => build(BASE);
const delivered = () => chain(base(), { type: 'release', packet: 'ALPHA', inbox: 396 }, { type: 'deliver', packet: 'ALPHA', pr: 520, subjectSha: A });

// ---------------------------------------------------------------- O6
test('O6.1: a blocked UNDER_REVIEW packet → unblock reactivates the outstanding W# reviewer, not the implementation owner', () => {
  let r = chain(delivered(), { type: 'review', packet: 'ALPHA', reviewers: ['W7'] }, { type: 'block', packet: 'ALPHA', blockedBy: EXT });
  assert.deepEqual([workerWatch(r.state, 'W7'), workerWatch(r.state, 'W3')], [false, false]);
  assert.equal(unblockOf(r.state, 'ALPHA').reactivates, 'W7');
  assert.ok(programView(r.state, CLEARED).includes('NEEDS_TRANSITION ALPHA event=unblock by=Fable reactivates=W7 :: every blocker has cleared'));
  r = add(r, { type: 'unblock', packet: 'ALPHA' });
  assert.deepEqual([r.state.packets.ALPHA.phase, workerWatch(r.state, 'W7'), workerWatch(r.state, 'W3')], ['UNDER_REVIEW', true, false]);
});
test('O6.2: with one reviewer passed, only the outstanding reviewer is reactivated', () => {
  const r = chain(reg(delivered(), 'W5', 405), { type: 'review', packet: 'ALPHA', reviewers: ['W7', 'W5'] }, { type: 'review-pass', packet: 'ALPHA', reviewer: 'W7' },
    { type: 'block', packet: 'ALPHA', blockedBy: EXT });
  assert.equal(unblockOf(r.state, 'ALPHA').reactivates, 'W5');
  const u = add(r, { type: 'unblock', packet: 'ALPHA' });
  assert.deepEqual([workerWatch(u.state, 'W5'), workerWatch(u.state, 'W7'), workerWatch(u.state, 'W3')], [true, false, false]);
});
test('O6.3: every W# reviewer passed, or only Director/Owner/Fable/L0 reviewers → the unblock reactivates no worker', () => {
  const passed = chain(delivered(), { type: 'review', packet: 'ALPHA', reviewers: ['W7', 'Director'] }, { type: 'review-pass', packet: 'ALPHA', reviewer: 'W7' },
    { type: 'block', packet: 'ALPHA', blockedBy: EXT });
  assert.equal(unblockOf(passed.state, 'ALPHA').reactivates, null);
  const human = chain(delivered(), { type: 'review', packet: 'ALPHA', reviewers: ['Director', 'Owner'] }, { type: 'block', packet: 'ALPHA', blockedBy: EXT });
  assert.equal(unblockOf(human.state, 'ALPHA').reactivates, null);
});
test('O6.4: blocked from DELIVERED → no one is reactivated (Fable routes the review); from ACKED or CHANGES_REQUESTED → the owner; from QUEUED → no one', () => {
  const dlv = add(delivered(), { type: 'block', packet: 'ALPHA', blockedBy: EXT });
  assert.equal(unblockOf(dlv.state, 'ALPHA').reactivates, null);
  assert.ok(programView(dlv.state, CLEARED).includes('NEEDS_TRANSITION ALPHA event=unblock by=Fable :: every blocker has cleared'));
  const acked = chain(base(), { type: 'release', packet: 'ALPHA', inbox: 396 }, { type: 'ack', packet: 'ALPHA', worker: 'W3' }, { type: 'block', packet: 'ALPHA', blockedBy: EXT });
  assert.equal(unblockOf(acked.state, 'ALPHA').reactivates, 'W3');
  const cr = chain(delivered(), { type: 'finding', packet: 'ALPHA' }, { type: 'block', packet: 'ALPHA', blockedBy: EXT });
  assert.equal(unblockOf(cr.state, 'ALPHA').reactivates, 'W3');
  const queued = add(base(), { type: 'block', packet: 'ALPHA', blockedBy: EXT });
  assert.equal(unblockOf(queued.state, 'ALPHA').reactivates, null);
});
test('O6.5: restoring a review to a reviewer that took another ball meanwhile is refused (one ball)', () => {
  const r = chain(delivered(), { type: 'review', packet: 'ALPHA', reviewers: ['W7'] }, { type: 'block', packet: 'ALPHA', blockedBy: EXT },
    { type: 'queue', packet: 'GAMMA', owner: 'W7', completion: SOURCE_ONLY }, { type: 'release', packet: 'GAMMA', inbox: 400 });
  refused(() => add(r, { type: 'unblock', packet: 'ALPHA' }), /W7 holds 2 balls \(active GAMMA; reviewing ALPHA\)/);
});

// ---------------------------------------------------------------- O7
const withDeps = () => chain(reg(base(), 'W9', 409),
  { type: 'queue', packet: 'SRC', owner: 'W7', completion: SOURCE_ONLY },
  { type: 'queue', packet: 'VER', owner: 'W9', completion: { terminal: 'VERIFIED', proofType: 'hosted' } });
for (const [dep, until, re] of [
  ['ALPHA', 'VERIFIED', /block: ALPHA completes at STAGED, so it never reaches VERIFIED/],
  ['SRC', 'VERIFIED', /block: SRC completes at INTEGRATED, so it never reaches VERIFIED/],
  ['SRC', 'STAGED', /block: SRC completes at INTEGRATED, so it never reaches STAGED/],
  ['VER', 'STAGED', /block: VER completes at VERIFIED, so it never reaches STAGED/],
]) {
  test(`O7.1: block on ${dep} until ${until} is impossible by its contract → refused`, () => {
    const holder = dep === 'ALPHA' ? 'REF-1' : 'ALPHA';
    refused(() => add(withDeps(), { type: 'block', packet: holder, blockedBy: [{ packet: dep, until }] }), re);
  });
}
test('O7.1: every milestone the contract reaches is accepted', () => {
  for (const [dep, untils] of [['ALPHA', ['ACCEPTED', 'INTEGRATED', 'STAGED']], ['SRC', ['ACCEPTED', 'INTEGRATED']], ['VER', ['ACCEPTED', 'INTEGRATED', 'VERIFIED']]]) {
    for (const until of untils) {
      const holder = dep === 'ALPHA' ? 'REF-1' : 'ALPHA';
      assert.equal(add(withDeps(), { type: 'block', packet: holder, blockedBy: [{ packet: dep, until }] }).state.packets[holder].phase, 'BLOCKED');
    }
  }
});
test('O7.2: a self-block, a missing dependency and a withdrawn dependency never clear → refused', () => {
  refused(() => add(withDeps(), { type: 'block', packet: 'ALPHA', blockedBy: [{ packet: 'ALPHA', until: 'ACCEPTED' }] }), /block: ALPHA cannot be blocked by itself/);
  refused(() => add(withDeps(), { type: 'block', packet: 'ALPHA', blockedBy: [{ packet: 'NOPE', until: 'ACCEPTED' }] }), /blocking packet NOPE does not exist/);
  const w = add(withDeps(), { type: 'withdraw', packet: 'SRC' });
  refused(() => add(w, { type: 'block', packet: 'ALPHA', blockedBy: [{ packet: 'SRC', until: 'INTEGRATED' }] }), /SRC is withdrawn, so it never reaches INTEGRATED/);
});
test('O7.3: a bootstrap import with an impossible or self blocker is refused', () => {
  const imp = (blockedBy) => build([boot({ packets: {
    DEP: { owner: 'W3', completion: SOURCE_ONLY, phase: 'QUEUED', refs: [comment(71)] },
    HELD: { owner: 'W7', completion: SOURCE_ONLY, phase: 'BLOCKED', phaseBeforeBlock: 'QUEUED', blockedBy, refs: [comment(72)] },
  }, queue: { W3: ['DEP'], W7: [] } })]);
  refused(() => imp([{ packet: 'DEP', until: 'STAGED' }]), /bootstrap: packet HELD: DEP completes at INTEGRATED, so it never reaches STAGED/);
  refused(() => imp([{ packet: 'HELD', until: 'ACCEPTED' }]), /bootstrap: packet HELD: HELD cannot be blocked by itself/);
  assert.equal(imp([{ packet: 'DEP', until: 'INTEGRATED' }]).state.packets.HELD.phase, 'BLOCKED');
});
test('O7.4: the invariant names an impossible blocker in any state', () => {
  const s = structuredClone(add(withDeps(), { type: 'block', packet: 'ALPHA', blockedBy: [{ packet: 'SRC', until: 'INTEGRATED' }] }).state);
  s.packets.ALPHA.blockedBy = [{ packet: 'SRC', until: 'STAGED' }];
  assert.ok(invariants(s).includes('ALPHA: SRC completes at INTEGRATED, so it never reaches STAGED'));
});
test('O7.5: terminal alone never clears a blocker: a STAGED dependency does not satisfy VERIFIED, an INTEGRATED one does not satisfy STAGED', () => {
  let r = delivered();
  r = raw(r, { type: 'accept', source: comment(9601), packet: 'ALPHA', subjectSha: A });
  r = raw(r, { type: 'integrate', actor: 'L0', source: pull(520), packet: 'ALPHA', mergeSha: B, acceptance: 9601 });
  assert.deepEqual(['ACCEPTED', 'INTEGRATED', 'STAGED'].map((until) => blockerCleared(r.state, { packet: 'ALPHA', until })), [true, true, false]);
  r = L0(r, { type: 'begin-proof', source: run(91), packet: 'ALPHA', runId: 91, proofType: 'hosted' });
  r = L0(r, { type: 'stage', source: run(91), packet: 'ALPHA', runId: 91, servedSha: B });
  r = L0(r, { type: 'proof-pass', source: run(91), packet: 'ALPHA', runId: 91 });
  assert.equal(r.state.packets.ALPHA.phase, 'STAGED');
  assert.deepEqual(['ACCEPTED', 'INTEGRATED', 'STAGED', 'VERIFIED'].map((until) => blockerCleared(r.state, { packet: 'ALPHA', until })), [true, true, true, false]);
  // A terminal INTEGRATED (source-only) packet never reaches STAGED or VERIFIED.
  const s = structuredClone(r.state);
  Object.assign(s.packets.ALPHA, { completion: SOURCE_ONLY, phase: 'INTEGRATED' });
  assert.deepEqual(['INTEGRATED', 'STAGED', 'VERIFIED'].map((until) => blockerCleared(s, { packet: 'ALPHA', until })), [true, false, false]);
});
test('O7.5: a failed proof sends the dependency back: it no longer counts as INTEGRATED', () => {
  let r = delivered();
  r = raw(r, { type: 'accept', source: comment(9602), packet: 'ALPHA', subjectSha: A });
  r = raw(r, { type: 'integrate', actor: 'L0', source: pull(520), packet: 'ALPHA', mergeSha: B, acceptance: 9602 });
  r = L0(r, { type: 'begin-proof', source: run(92), packet: 'ALPHA', runId: 92, proofType: 'hosted' });
  assert.equal(blockerCleared(r.state, { packet: 'ALPHA', until: 'INTEGRATED' }), true);
  r = raw(r, { type: 'proof-fail', source: comment(9603), packet: 'ALPHA', runId: 92 });
  assert.equal(blockerCleared(r.state, { packet: 'ALPHA', until: 'INTEGRATED' }), false);
});

done('audit');
