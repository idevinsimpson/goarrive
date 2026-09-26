#!/usr/bin/env node
/** The ledger engine: schema, writers, provenance, identity, bootstrap, transitions, chain and the single writer. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  A, B, C, D, E, F, BASE, GENESIS, REPO, SOURCE_ONLY, STAGED_HOSTED, VERIFIED_ACTIVATION,
  add, boot, build, chain, comment, commit, done, pull, refused, run, test,
} from './helpers.mjs';
import { Refused, appendEvent, appendToDir } from '../append.mjs';
import { checkTexts, checkDir, invariants } from '../check.mjs';
import { reduce, serialize, sha256 } from '../reduce.mjs';
import { eventId, isTerminal, validateEvent } from '../schema.mjs';
import { workerWatch } from '../derive.mjs';

const TOOLS = path.resolve('tools/wsf-control');
const cli = (script, args) => spawnSync(process.execPath, [path.join(TOOLS, script), ...args], { encoding: 'utf8' });
const base = () => build(BASE);
const released = () => add(base(), { type: 'release', packet: 'ALPHA', inbox: 396 });
const delivered = () => add(released(), { type: 'deliver', packet: 'ALPHA', pr: 520, subjectSha: A });
const raw = (r, e, head = r.state.ledgerHead) => appendEvent(r.eventsText, e, { expectHead: head });
/** BETA (completes VERIFIED after a journey-activation proof) delivered, accepted and integrated. */
function betaIntegrated() {
  let r = chain(base(), { type: 'withdraw', packet: 'ALPHA' }, { type: 'release', packet: 'BETA', inbox: 396 }, { type: 'deliver', packet: 'BETA', pr: 516, subjectSha: B });
  const acceptance = 7777;
  r = raw(r, { type: 'accept', actor: 'Fable', source: comment(acceptance), packet: 'BETA', subjectSha: B });
  r = raw(r, { type: 'integrate', actor: 'L0', source: pull(516), packet: 'BETA', mergeSha: C, acceptance });
  return r;
}

test('the standard program reduces, and state.json is exactly its reduction', () => {
  const r = base();
  assert.equal(r.state.eventCount, BASE.length);
  assert.equal(r.stateText, serialize(reduce(r.eventsText)));
  assert.deepEqual(checkTexts(r.eventsText, r.stateText).problems, []);
  assert.deepEqual(r.state.queue.W3, ['ALPHA', 'BETA']);
  assert.equal(r.state.criticalPath, 'ALPHA');
  assert.equal(r.state.repository, REPO);
  assert.deepEqual(r.state.surfaces.current, { pr: 365, commentId: 9001 });
});
test('the bootstrap line chains from GENESIS and each later line from the sha256 of the line before; ids are identities', () => {
  const text = base().eventsText;
  const lines = text.trimEnd().split('\n');
  assert.equal(JSON.parse(lines[0]).prev, GENESIS);
  for (let i = 1; i < lines.length; i += 1) assert.equal(JSON.parse(lines[i]).prev, sha256(lines[i - 1]));
  for (const l of lines) assert.equal(JSON.parse(l).id, eventId(JSON.parse(l)));
  assert.equal(reduce(text).ledgerHead, sha256(lines.at(-1)));
});

// ---- closed writers (5848257247) ----
for (const actor of ['W3', 'W7', 'Director', 'Owner']) {
  test(`a non-writer actor is refused: ${actor}`, () => {
    refused(() => raw(released(), { type: 'ack', actor, source: comment(5), packet: 'ALPHA' }), new RegExp(`actor "${actor}" is not a ledger writer`));
  });
}
test('a worker cannot write its own acceptance or queue; Fable/L0 recording the worker\'s own ACK or delivery comment is allowed', () => {
  refused(() => raw(delivered(), { type: 'accept', actor: 'W3', source: comment(6), packet: 'ALPHA', subjectSha: A }), /not a ledger writer/);
  refused(() => raw(base(), { type: 'reorder-queue', actor: 'W3', source: comment(6), owner: 'W3', order: ['BETA', 'ALPHA'] }), /not a ledger writer/);
  const workersAck = comment(4242); // the worker's own ACK comment is the source; Fable is the writer
  const r = raw(released(), { type: 'ack', actor: 'Fable', source: workersAck, packet: 'ALPHA' });
  assert.equal(r.state.packets.ALPHA.phase, 'ACKED');
  assert.equal(raw(r, { type: 'deliver', actor: 'L0', source: comment(4243), packet: 'ALPHA', pr: 520, subjectSha: A }).state.packets.ALPHA.phase, 'DELIVERED');
});

// ---- typed provenance (5848224264) ----
for (const [name, event, re] of [
  ['a release resting on a run result', { type: 'release', source: run(1), packet: 'ALPHA', inbox: 396 }, /release must rest on a comment, not a workflow_run/],
  ['a queue decision resting on a commit', { type: 'queue', source: commit(E), packet: 'GAMMA', owner: 'W3', completion: SOURCE_ONLY }, /queue must rest on a comment, not a commit/],
  ['a block resting on a PR', { type: 'block', source: pull(1), packet: 'ALPHA', blockedBy: [{ packet: 'BETA', until: 'ACCEPTED' }] }, /block must rest on a comment/],
  ['a source with a URL-shaped repo', { type: 'ack', source: { kind: 'comment', id: 1, repo: 'https://x.test/a' }, packet: 'ALPHA' }, /source must be \{ kind/],
  ['a source with an unknown kind', { type: 'ack', source: { kind: 'issue', id: 1, repo: REPO }, packet: 'ALPHA' }, /source must be \{ kind/],
  ['a commit source that is not a SHA', { type: 'reconcile-head', source: { kind: 'commit', id: 12, repo: REPO }, packet: 'ALPHA', prHeadSha: A }, /source must be \{ kind/],
  ['a source in another repository', { type: 'ack', source: { kind: 'comment', id: 1, repo: 'other/repo' }, packet: 'ALPHA' }, /source repository other\/repo is not the controlled repository/],
]) {
  test(`provenance refused: ${name}`, () => refused(() => raw(released(), { actor: 'Fable', ...event }), re));
}
test('a run result never grants acceptance', () => {
  refused(() => raw(delivered(), { type: 'accept', actor: 'L0', source: run(55), packet: 'ALPHA', subjectSha: A }), /accept must rest on a comment, not a workflow_run/);
});
test('integrate rests on the merge (PR or commit) and must carry the acceptance comment that authorized it', () => {
  let r = delivered();
  r = raw(r, { type: 'accept', actor: 'Fable', source: comment(8888), packet: 'ALPHA', subjectSha: A });
  refused(() => raw(r, { type: 'integrate', actor: 'L0', source: comment(9), packet: 'ALPHA', mergeSha: C, acceptance: 8888 }), /integrate must rest on a pull_request or commit, not a comment/);
  refused(() => raw(r, { type: 'integrate', actor: 'L0', source: pull(520), packet: 'ALPHA', mergeSha: C, acceptance: 1234 }), /must carry the acceptance that authorized it \(comment 8888\), not 1234/);
  assert.equal(raw(r, { type: 'integrate', actor: 'L0', source: commit(C), packet: 'ALPHA', mergeSha: C, acceptance: 8888 }).state.packets.ALPHA.phase, 'INTEGRATED');
});

// ---- idempotent append (5848224264) ----
test('an exact retry is a NO-OP: no new line, the existing head returned', () => {
  const r0 = released();
  const ev = { type: 'ack', actor: 'Fable', source: comment(3131), packet: 'ALPHA' };
  const r1 = raw(r0, ev);
  const again = appendEvent(r1.eventsText, ev, { expectHead: r1.state.ledgerHead });
  assert.equal(again.noop, true);
  assert.equal(again.eventsText, r1.eventsText);
  assert.equal(again.state.ledgerHead, r1.state.ledgerHead);
  assert.equal(again.seq, r1.seq);
});
test('a retry after an uncertain push is recognized even though the writer holds the old head', () => {
  const r0 = released();
  const ev = { type: 'ack', actor: 'Fable', source: comment(3132), packet: 'ALPHA' };
  const landed = raw(r0, ev);
  const retry = appendEvent(landed.eventsText, ev, { expectHead: r0.state.ledgerHead });
  assert.equal(retry.noop, true);
  assert.equal(retry.state.ledgerHead, landed.state.ledgerHead);
});
test('the same identity with a different payload is a hard conflict', () => {
  const r0 = delivered();
  const r1 = raw(r0, { type: 'accept', actor: 'Fable', source: comment(3133), packet: 'ALPHA', subjectSha: A });
  refused(() => appendEvent(r1.eventsText, { type: 'accept', actor: 'Fable', source: comment(3133), packet: 'ALPHA', subjectSha: B }, { expectHead: r1.state.ledgerHead }), /conflict: .* already recorded at seq \d+ with a different payload/);
  refused(() => appendEvent(r1.eventsText, { type: 'accept', actor: 'L0', source: comment(3133), packet: 'ALPHA', subjectSha: A }, { expectHead: r1.state.ledgerHead }), /conflict/);
});
test('a stale-prev concurrent append is refused, and a missing expectHead is refused', () => {
  const r0 = released();
  const r1 = raw(r0, { type: 'ack', actor: 'Fable', source: comment(3134), packet: 'ALPHA' });
  refused(() => appendEvent(r1.eventsText, { type: 'deliver', actor: 'Fable', source: comment(3135), packet: 'ALPHA', pr: 520, subjectSha: A }, { expectHead: r0.state.ledgerHead }), /another decision was recorded; re-read and reconcile/);
  refused(() => appendEvent(r1.eventsText, { type: 'deliver', actor: 'Fable', source: comment(3135), packet: 'ALPHA', pr: 520, subjectSha: A }), /expectHead .* is required/);
});
test('two different events from one GitHub comment are allowed when their identities differ', () => {
  const one = comment(3136);
  let r = raw(base(), { type: 'release', actor: 'Fable', source: one, packet: 'ALPHA', inbox: 396 });
  r = raw(r, { type: 'queue', actor: 'Fable', source: one, packet: 'GAMMA', owner: 'W7', completion: SOURCE_ONLY });
  assert.deepEqual([r.state.packets.ALPHA.phase, r.state.packets.GAMMA.phase], ['RELEASED', 'QUEUED']);
});
test('a caller cannot supply seq, id or prev', () => {
  for (const k of ['seq', 'id', 'prev']) refused(() => raw(released(), { type: 'ack', actor: 'Fable', source: comment(1), packet: 'ALPHA', [k]: k === 'seq' ? 9 : GENESIS }), /assigned by append.mjs/);
});
test('a ledger with a tampered id, or one identity twice, is refused', () => {
  const lines = released().eventsText.trimEnd().split('\n');
  const tampered = JSON.parse(lines.at(-1));
  tampered.id = sha256('x');
  refused(() => reduce(`${[...lines.slice(0, -1), JSON.stringify(tampered)].join('\n')}\n`), /id is not the event's identity/);
  const dup = JSON.parse(lines.at(-1));
  const second = { ...dup, seq: dup.seq + 1, prev: sha256(lines.at(-1)) };
  refused(() => reduce(`${[...lines, JSON.stringify(second)].join('\n')}\n`), /the same event identity is recorded twice/);
});

// ---- honest genesis (5848252887) ----
test('the first line must be the bootstrap; a bootstrap after line 1 (a second bootstrap) is refused', () => {
  refused(() => appendEvent('', { type: 'register-worker', actor: 'Fable', source: comment(1), worker: 'W3', inbox: 396 }, { expectHead: GENESIS }), /the first ledger line must be the bootstrap/);
  refused(() => raw(base(), boot({ source: comment(101) })), /bootstrap is legal only as the first ledger line/);
});
test('bootstrap imports current state marked origin=bootstrap, with the refs for its current phase and no fake history', () => {
  const r = build([boot({
    queue: { W3: ['NEXT-1'], W7: [] },
    packets: {
      'LIVE-1': { owner: 'W3', completion: VERIFIED_ACTIVATION, phase: 'UNDER_REVIEW', pr: 516, artifact: { subjectSha: A }, reviewers: ['Fable'], refs: [comment(5847559113), pull(516)], releasedBy: 5847471407 },
      'NEXT-1': { owner: 'W3', completion: SOURCE_ONLY, phase: 'QUEUED', refs: [] },
    },
    criticalPath: 'LIVE-1',
  })]);
  const p = r.state.packets['LIVE-1'];
  assert.equal(r.state.eventCount, 1);
  assert.deepEqual([p.origin, p.phase, p.inbox, p.artifact.prHeadSha], ['bootstrap', 'UNDER_REVIEW', 396, A]);
  assert.deepEqual(p.importRefs, [{ kind: 'comment', id: 5847559113 }, { kind: 'pull_request', id: 516 }]);
  assert.deepEqual([p.authority.queued, p.authority.released], [null, { kind: 'comment', id: 5847471407 }]);
  assert.equal(r.state.criticalPath, 'LIVE-1');
});
for (const [name, packets, re] of [
  ['a history field', { X1: { owner: 'W3', completion: SOURCE_ONLY, phase: 'RELEASED', refs: [comment(1)], history: [] } }, /unknown field "history" \(a bootstrap imports current state only/],
  ['a transition timestamp', { X1: { owner: 'W3', completion: SOURCE_ONLY, phase: 'RELEASED', refs: [comment(1)], releasedAt: '2026-09-01T00:00:00Z' } }, /unknown field "releasedAt"/],
  ['a released packet with no supporting refs', { X1: { owner: 'W3', completion: SOURCE_ONLY, phase: 'RELEASED', refs: [] } }, /needs the GitHub refs that support its current phase/],
  ['an ACCEPTED packet with no acceptance comment', { X1: { owner: 'W3', completion: SOURCE_ONLY, phase: 'ACCEPTED', pr: 1, artifact: { subjectSha: A }, refs: [comment(1)] } }, /ACCEPTED needs acceptedBy/],
  ['a VERIFIED packet whose contract completes at STAGED', { X1: { owner: 'W3', completion: STAGED_HOSTED, phase: 'VERIFIED', pr: 1, artifact: { subjectSha: A, mergeSha: B }, refs: [comment(1)] } }, /VERIFIED does not match its completion contract \(STAGED\)/],
  ['two worker-owned packets for one worker', {
    X1: { owner: 'W3', completion: SOURCE_ONLY, phase: 'RELEASED', refs: [comment(1)] },
    X2: { owner: 'W3', completion: SOURCE_ONLY, phase: 'ACKED', refs: [comment(2)] },
  }, /W3 holds 2 worker-owned packets/],
  ['a queued packet missing from its queue', { X1: { owner: 'W3', completion: SOURCE_ONLY, phase: 'QUEUED', refs: [] } }, /X1 is QUEUED but not in W3's queue/],
  ['a packet with no completion contract', { X1: { owner: 'W3', phase: 'QUEUED', refs: [] } }, /completion is required/],
]) {
  test(`bootstrap refused: ${name}`, () => refused(() => build([boot({ packets })]), re));
}
test('bootstrap refused: a source outside the bootstrapped repository', () => {
  refused(() => build([boot({ source: { kind: 'comment', id: 1, repo: 'other/repo' } })]), /the source must be in the bootstrapped repository/);
});

// ---- completion contract and proof (5848214525) ----
test('completion contracts are closed: a source-only packet cannot claim a hosted proof, and one is always declared', () => {
  refused(() => add(base(), { type: 'queue', packet: 'GAMMA', owner: 'W3', completion: { terminal: 'INTEGRATED', proofType: 'hosted' } }), /completion is missing or malformed/);
  refused(() => add(base(), { type: 'queue', packet: 'GAMMA', owner: 'W3' }), /completion is missing or malformed/);
});
test('an ops packet that completes at VERIFIED is not done at INTEGRATED', () => {
  const p = betaIntegrated().state.packets.BETA;
  assert.equal(p.phase, 'INTEGRATED');
  assert.equal(isTerminal(p), false);
});
test('begin-proof moves it to VERIFYING; a passed proof reaches VERIFIED (terminal)', () => {
  let r = raw(betaIntegrated(), { type: 'begin-proof', actor: 'L0', source: run(36257846281), packet: 'BETA', runId: 36257846281, proofType: 'journey-activation' });
  assert.deepEqual([r.state.packets.BETA.phase, r.state.packets.BETA.proof], ['VERIFYING', { type: 'journey-activation', runId: 36257846281, result: 'RUNNING' }]);
  r = raw(r, { type: 'proof-pass', actor: 'L0', source: run(36257846281), packet: 'BETA', runId: 36257846281, evidenceRef: { kind: 'artifact', id: 42 } });
  assert.equal(r.state.packets.BETA.phase, 'VERIFIED');
  assert.equal(isTerminal(r.state.packets.BETA), true);
});
test('a failed proof returns the packet to CHANGES_REQUESTED, the worker\'s WATCH comes back on, and a successor deliver on a new PR follows', () => {
  let r = raw(betaIntegrated(), { type: 'begin-proof', actor: 'L0', source: comment(60), packet: 'BETA', runId: 54, proofType: 'journey-activation' });
  assert.equal(workerWatch(r.state, 'W3'), false);
  refused(() => raw(r, { type: 'proof-fail', actor: 'L0', source: run(54), packet: 'BETA', runId: 54 }), /proof-fail must rest on a comment, not a workflow_run/);
  r = raw(r, { type: 'proof-fail', actor: 'Fable', source: comment(61), packet: 'BETA', runId: 54 });
  assert.deepEqual([r.state.packets.BETA.phase, r.state.packets.BETA.proof.result], ['CHANGES_REQUESTED', 'FAIL']);
  assert.equal(workerWatch(r.state, 'W3'), true);
  r = add(r, { type: 'deliver', packet: 'BETA', pr: 530, subjectSha: D });
  const a = r.state.packets.BETA.artifact;
  assert.deepEqual([r.state.packets.BETA.phase, r.state.packets.BETA.pr, a.subjectSha, a.mergeSha], ['DELIVERED', 530, D, null]);
});
test('proofs must match the contract and the run in progress', () => {
  const r = betaIntegrated();
  refused(() => raw(r, { type: 'begin-proof', actor: 'L0', source: comment(62), packet: 'BETA', runId: 5, proofType: 'hosted' }), /needs a journey-activation proof, not hosted/);
  refused(() => raw(r, { type: 'begin-proof', actor: 'L0', source: run(6), packet: 'BETA', runId: 5, proofType: 'journey-activation' }), /the source run is not the named run/);
  const v = raw(r, { type: 'begin-proof', actor: 'L0', source: comment(63), packet: 'BETA', runId: 5, proofType: 'journey-activation' });
  refused(() => raw(v, { type: 'proof-pass', actor: 'L0', source: comment(64), packet: 'BETA', runId: 6 }), /names run 6, but the proof in progress is run 5/);
  refused(() => raw(v, { type: 'stage', actor: 'L0', source: run(5), packet: 'BETA', runId: 5, servedSha: C }), /completes at VERIFIED, not STAGED/);
});
test('a packet that completes at STAGED cannot be marked VERIFIED instead', () => {
  let r = delivered();
  r = raw(r, { type: 'accept', actor: 'Fable', source: comment(70), packet: 'ALPHA', subjectSha: A });
  r = raw(r, { type: 'integrate', actor: 'L0', source: pull(520), packet: 'ALPHA', mergeSha: B, acceptance: 70 });
  r = raw(r, { type: 'begin-proof', actor: 'L0', source: run(71), packet: 'ALPHA', runId: 71, proofType: 'hosted' });
  refused(() => raw(r, { type: 'proof-pass', actor: 'L0', source: run(71), packet: 'ALPHA', runId: 71 }), /completes at STAGED, not VERIFIED/);
  r = raw(r, { type: 'stage', actor: 'L0', source: run(71), packet: 'ALPHA', runId: 71, servedSha: B });
  assert.deepEqual([r.state.packets.ALPHA.phase, r.state.packets.ALPHA.staged, r.state.criticalPath], ['STAGED', { runId: 71, servedSha: B }, null]);
});
test('a source-only packet declared terminal at INTEGRATED finishes there', () => {
  let r = chain(base(), { type: 'queue', packet: 'DOCS-1', owner: 'W7', completion: SOURCE_ONLY }, { type: 'release', packet: 'DOCS-1', inbox: 400 }, { type: 'deliver', packet: 'DOCS-1', pr: 9, subjectSha: E });
  r = raw(r, { type: 'accept', actor: 'Fable', source: comment(80), packet: 'DOCS-1', subjectSha: E });
  r = raw(r, { type: 'integrate', actor: 'L0', source: commit(F), packet: 'DOCS-1', mergeSha: F, acceptance: 80 });
  assert.equal(isTerminal(r.state.packets['DOCS-1']), true);
  refused(() => raw(r, { type: 'begin-proof', actor: 'L0', source: comment(81), packet: 'DOCS-1', runId: 1, proofType: 'source-only' }), /packet is terminal \(INTEGRATED\)/);
});

// ---- illegal transitions ----
for (const [name, event, re] of [
  ['ack before release', { type: 'ack', packet: 'ALPHA' }, /ack is not legal from QUEUED/],
  ['deliver before release', { type: 'deliver', packet: 'ALPHA', pr: 1, subjectSha: A }, /deliver is not legal from QUEUED/],
  ['accept a queued packet', { type: 'accept', packet: 'ALPHA', subjectSha: A }, /accept is not legal from QUEUED/],
  ['begin-proof before integration', { type: 'begin-proof', packet: 'BETA', runId: 1, proofType: 'journey-activation' }, /begin-proof is not legal from QUEUED/],
  ['unblock a packet that is not blocked', { type: 'unblock', packet: 'ALPHA' }, /unblock is not legal from QUEUED/],
  ['a transition on an unknown packet', { type: 'ack', packet: 'NOPE' }, /packet NOPE does not exist/],
]) {
  test(`illegal transition refused: ${name}`, () => refused(() => add(base(), event), re));
}
test('illegal transition refused: accept straight from RELEASED (nothing delivered)', () => {
  refused(() => add(released(), { type: 'accept', packet: 'ALPHA', subjectSha: A }), /accept is not legal from RELEASED/);
});

// ---- broken prev / hand-edited state ----
test('broken prev refused: a line whose prev does not chain', () => {
  const lines = base().eventsText.trimEnd().split('\n');
  const e = JSON.parse(lines[2]);
  e.prev = sha256('something else');
  lines[2] = JSON.stringify(e);
  refused(() => reduce(`${lines.join('\n')}\n`), /line 3: prev does not match the previous line/);
});
test('broken prev refused: an earlier line edited in place breaks the next line\'s chain', () => {
  const lines = base().eventsText.trimEnd().split('\n');
  lines[1] = lines[1].replace('"first packet"', '"edited packet"');
  refused(() => reduce(`${lines.join('\n')}\n`), /line 3: prev does not match/);
});
test('a removed line is refused (seq gap); a missing newline or a blank line is refused', () => {
  const lines = base().eventsText.trimEnd().split('\n');
  refused(() => reduce(`${[lines[0], ...lines.slice(2)].join('\n')}\n`), /line 2: seq is 3, expected 2/);
  refused(() => reduce(base().eventsText.trimEnd()), /must end with a newline/);
  refused(() => reduce(base().eventsText.replace('\n', '\n\n')), /is blank/);
});
test('hand-edited state.json refused (reduce ≠ state), including whitespace-only reformatting and an older head', () => {
  const r = base();
  const edited = r.stateText.replace('"phase": "QUEUED"', '"phase": "ACCEPTED"');
  assert.notEqual(edited, r.stateText);
  assert.ok(checkTexts(r.eventsText, edited).problems.some((p) => /hand-edited/.test(p)));
  assert.equal(checkTexts(r.eventsText, JSON.stringify(JSON.parse(r.stateText))).ok, false);
  assert.equal(checkTexts(released().eventsText, r.stateText).ok, false);
});

// ---- one worker-owned packet; canonical inbox; queue ----
test('two worker-owned packets refused: releasing BETA while W3 holds ALPHA', () => {
  const err = refused(() => add(released(), { type: 'release', packet: 'BETA', inbox: 396 }), /W3 holds 2 worker-owned packets \(ALPHA, BETA\); at most one/);
  assert.ok(err instanceof Refused);
});
test('a delivered packet frees the worker; a finding that would give W3 two is refused', () => {
  const r = add(delivered(), { type: 'release', packet: 'BETA', inbox: 396 });
  assert.equal(r.state.packets.BETA.phase, 'RELEASED');
  refused(() => add(r, { type: 'finding', packet: 'ALPHA' }), /W3 holds 2 worker-owned packets/);
});
test('a release outside the canonical inbox refused', () => {
  refused(() => add(base(), { type: 'release', packet: 'ALPHA', inbox: 400 }), /release must be handed off in W3's canonical inbox #396, not #400/);
  refused(() => add(base(), { type: 'register-worker', worker: 'W3', inbox: 401 }), /already registered/);
});
test('a queued packet that is already released refused; a queue naming a released packet fails the invariants', () => {
  refused(() => add(released(), { type: 'queue', packet: 'ALPHA', owner: 'W3', completion: SOURCE_ONLY }), /packet ALPHA already exists \(RELEASED\)/);
  const r = released();
  assert.deepEqual(r.state.queue.W3, ['BETA']);
  const bad = JSON.parse(r.stateText);
  bad.queue.W3 = ['ALPHA', 'BETA'];
  assert.equal(checkTexts(r.eventsText, serialize(bad)).ok, false);
  assert.ok(invariants(bad).some((p) => /W3's queue names ALPHA, which is already RELEASED/.test(p)));
});
test('reorder-queue must be a permutation of the queue', () => {
  assert.deepEqual(add(base(), { type: 'reorder-queue', owner: 'W3', order: ['BETA', 'ALPHA'] }).state.queue.W3, ['BETA', 'ALPHA']);
  refused(() => add(base(), { type: 'reorder-queue', owner: 'W3', order: ['BETA'] }), /must be a permutation/);
  refused(() => add(base(), { type: 'reorder-queue', owner: 'W3', order: ['BETA', 'BETA'] }), /must be a permutation/);
});

// ---- critical path ----
test('a terminal criticalPath refused; a reference cannot be the critical path; it clears on completion', () => {
  refused(() => add(add(base(), { type: 'withdraw', packet: 'BETA' }), { type: 'set-critical-path', packet: 'BETA' }), /packet is terminal \(WITHDRAWN\)/);
  refused(() => add(base(), { type: 'set-critical-path', packet: 'REF-1' }), /a reference packet cannot be the critical path/);
  const r = add(base(), { type: 'withdraw', packet: 'ALPHA' });
  assert.equal(r.state.criticalPath, null);
  const bad = JSON.parse(r.stateText);
  bad.criticalPath = 'ALPHA';
  assert.ok(invariants(bad).some((p) => /criticalPath ALPHA is terminal/.test(p)));
});

// ---- subject vs evidence ----
test('evidence-head advancement does not move subjectSha (record-evidence and reconcile-head)', () => {
  let r = delivered();
  r = add(r, { type: 'record-evidence', packet: 'ALPHA', evidenceSha: B });
  r = raw(r, { type: 'reconcile-head', actor: 'Fable', source: pull(520), packet: 'ALPHA', prHeadSha: B });
  const a = r.state.packets.ALPHA.artifact;
  assert.deepEqual([a.subjectSha, a.prHeadSha, a.evidenceSha, r.state.packets.ALPHA.phase], [A, B, B, 'DELIVERED']);
  refused(() => add(r, { type: 'accept', packet: 'ALPHA', subjectSha: B }), /accept names bbbbbbbb, but the subject under review is aaaaaaaa/);
});
test('a successor deliver moves subjectSha (and the PR head with it); a different PR is refused before integration', () => {
  const r = chain(delivered(), { type: 'review', packet: 'ALPHA', reviewers: ['Fable', 'W7'] }, { type: 'finding', packet: 'ALPHA' }, { type: 'deliver', packet: 'ALPHA', pr: 520, subjectSha: C, evidenceSha: D });
  const a = r.state.packets.ALPHA.artifact;
  assert.deepEqual([a.subjectSha, a.prHeadSha, a.evidenceSha, r.state.packets.ALPHA.phase], [C, C, D, 'DELIVERED']);
  refused(() => add(r, { type: 'accept', packet: 'ALPHA', subjectSha: A }), /the subject under review is cccccccc/);
  refused(() => add(delivered(), { type: 'deliver', packet: 'ALPHA', pr: 521, subjectSha: C }), /this packet is delivered on #520/);
});

// ---- block / unblock ----
test('block keeps the phase it interrupted, and unblock restores it', () => {
  let r = add(released(), { type: 'ack', packet: 'ALPHA' });
  r = add(r, { type: 'block', packet: 'ALPHA', blockedBy: [{ external: 'OWNER-DEVICE', condition: 'device check pending', owner: 'Owner', unblockWhen: 'owner posts verdict' }] });
  assert.deepEqual([r.state.packets.ALPHA.phase, r.state.packets.ALPHA.phaseBeforeBlock], ['BLOCKED', 'ACKED']);
  r = add(r, { type: 'unblock', packet: 'ALPHA' });
  assert.deepEqual([r.state.packets.ALPHA.phase, r.state.packets.ALPHA.phaseBeforeBlock, r.state.packets.ALPHA.blockedBy], ['ACKED', null, []]);
});

// ---- PII / secret / prose ----
const SECRETS = [
  ['an email address', 'ping someone@example.com'],
  ['a Google API key', `AIza${'x'.repeat(30)}`],
  ['a bearer token', 'Bearer abc.def'],
  ['a URL with an oobCode', 'see x.test/a?oobCode=zzz'],
  ['a URL', 'https://x.test/a'],
  ['a GitHub token', `ghp_${'y'.repeat(30)}`],
  ['a private key block', `-----BEGIN ${'PRIVATE'} KEY-----`],
  ['a JWT', `eyJ${'a'.repeat(12)}.${'b'.repeat(12)}.${'c'.repeat(12)}`],
];
for (const [name, value] of SECRETS) {
  test(`PII/secret-like values rejected: ${name} in a label, and the value is never echoed`, () => {
    const err = refused(() => add(base(), { type: 'queue', packet: 'GAMMA', owner: 'W3', completion: SOURCE_ONLY, label: value }), /-shaped content is not allowed \(value withheld\)/);
    assert.ok(!err.message.includes(value));
  });
}
test('PII/secret-like values rejected in a blocker condition and in a bootstrap import', () => {
  refused(() => add(released(), { type: 'block', packet: 'ALPHA', blockedBy: [{ external: 'X-1', condition: 'mail a@b.co', owner: 'Owner', unblockWhen: 'later' }] }), /email-address-shaped/);
  refused(() => build([boot({ packets: { X1: { owner: 'W3', completion: SOURCE_ONLY, phase: 'RELEASED', refs: [comment(1)], label: 'a@b.co' } } })]), /email-address-shaped/);
});
test('free text is short and single-line; unknown fields (prose, titles, bodies) are refused', () => {
  refused(() => add(base(), { type: 'queue', packet: 'GAMMA', owner: 'W3', completion: SOURCE_ONLY, label: 'x'.repeat(201) }), /limited to 200 characters/);
  refused(() => add(base(), { type: 'queue', packet: 'GAMMA', owner: 'W3', completion: SOURCE_ONLY, label: 'two\nlines' }), /multi-line/);
  refused(() => add(base(), { type: 'queue', packet: 'GAMMA', owner: 'W3', completion: SOURCE_ONLY, title: 'PR title copy' }), /unknown field "title"/);
  refused(() => add(delivered(), { type: 'review', packet: 'ALPHA', reviewers: ['W7'], body: 'comment text' }), /unknown field "body"/);
});
test('the envelope is checked', () => {
  const env = { seq: 1, id: GENESIS, prev: GENESIS, source: comment(1) };
  assert.deepEqual(validateEvent({ ...env, type: 'nope', actor: 'Fable' }), ['unknown event type "nope"']);
  assert.ok(validateEvent({ ...env, type: 'ack', actor: 'Fable', packet: 'A1', source: undefined }).some((p) => /source must be/.test(p)));
});

// ---- the single writer, on disk ----
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-control-'));
const writeEvent = (dir, e) => { const f = path.join(dir, 'event.json'); fs.writeFileSync(f, JSON.stringify(e)); return f; };
const headOf = (state) => (fs.existsSync(path.join(state, 'state.json')) ? JSON.parse(fs.readFileSync(path.join(state, 'state.json'), 'utf8')).ledgerHead : GENESIS);
test('append.mjs CLI writes the pair (expect-head required); a retry prints noop; check.mjs validates it', () => {
  const d = tmp();
  const state = path.join(d, 'state');
  for (const [i, e] of BASE.entries()) {
    const ev = { actor: 'Fable', source: comment(2000 + i), ...e };
    assert.equal(cli('append.mjs', [state, writeEvent(d, ev)]).status, 1, 'expect-head is required');
    const r = cli('append.mjs', [state, writeEvent(d, ev), '--expect-head', headOf(state)]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`^APPENDED seq=${i + 1} type=${e.type} head=[0-9a-f]{64}$`, 'm'));
  }
  const last = { actor: 'Fable', source: comment(2000 + BASE.length - 1), ...BASE.at(-1) };
  const retry = cli('append.mjs', [state, writeEvent(d, last), '--expect-head', GENESIS]);
  assert.equal(retry.status, 0, retry.stderr);
  assert.match(retry.stdout, new RegExp(`^APPEND=noop \\(already recorded as seq=${BASE.length}\\) head=${headOf(state)}$`, 'm'));
  const c = cli('check.mjs', [state]);
  assert.equal(c.status, 0, c.stderr);
  assert.match(c.stdout, new RegExp(`^CONTROL_STATE=valid events=${BASE.length} head=[0-9a-f]{12}$`, 'm'));
});
test('append.mjs CLI refuses an illegal event, a worker writer, or a stale head, and writes nothing', () => {
  const d = tmp();
  const state = path.join(d, 'state');
  appendToDir(state, boot(), { expectHead: GENESIS });
  const before = ['events.jsonl', 'state.json'].map((f) => fs.readFileSync(path.join(state, f), 'utf8'));
  for (const [ev, head] of [
    [{ actor: 'Fable', source: comment(2), type: 'ack', packet: 'NOPE' }, headOf(state)],
    [{ actor: 'W3', source: comment(3), type: 'register-worker', worker: 'W9', inbox: 409 }, headOf(state)],
    [{ actor: 'Fable', source: comment(4), type: 'register-worker', worker: 'W9', inbox: 409 }, E.slice(0, 40) + E.slice(0, 24)],
  ]) {
    const r = cli('append.mjs', [state, writeEvent(d, ev), '--expect-head', head]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^APPEND=refused \(nothing written\)$/m);
  }
  assert.deepEqual(['events.jsonl', 'state.json'].map((f) => fs.readFileSync(path.join(state, f), 'utf8')), before);
  assert.deepEqual(fs.readdirSync(state).sort(), ['events.jsonl', 'state.json']);
});
test('append refuses to build on a hand-edited state.json, and check.mjs CLI reports it invalid', () => {
  const d = tmp();
  const state = path.join(d, 'state');
  appendToDir(state, boot(), { expectHead: GENESIS });
  const sp = path.join(state, 'state.json');
  fs.writeFileSync(sp, fs.readFileSync(sp, 'utf8').replace('"inbox": 396', '"inbox": 397'));
  refused(() => appendToDir(state, { actor: 'Fable', source: comment(9), type: 'register-worker', worker: 'W9', inbox: 409 }, { expectHead: headOf(state) }), /not valid before this append/);
  const c = cli('check.mjs', [state]);
  assert.equal(c.status, 1);
  assert.match(c.stdout, /^CONTROL_STATE=invalid/m);
  assert.match(c.stderr, /hand-edited/);
  assert.equal(checkDir(state).ok, false);
});

done('ledger');
