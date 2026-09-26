#!/usr/bin/env node
/** The ledger engine: schema, transitions, chain, derived state and the single writer. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { A, B, C, D, E, BASE, build, done, refused, test } from './helpers.mjs';
import { Refused, appendEvent, appendToDir } from '../append.mjs';
import { checkTexts, checkDir, invariants } from '../check.mjs';
import { reduce, serialize, sha256 } from '../reduce.mjs';
import { GENESIS, validateEvent } from '../schema.mjs';

const TOOLS = path.resolve('tools/wsf-control');
const run = (script, args) => spawnSync(process.execPath, [path.join(TOOLS, script), ...args], { encoding: 'utf8' });
const base = () => build(BASE);
const add = (r, e) => appendEvent(r.eventsText, { actor: 'Fable', authority: 5000 + r.state.eventCount, ...e });
const released = () => add(base(), { type: 'release', packet: 'ALPHA', inbox: 396 });
const delivered = () => add(released(), { type: 'deliver', packet: 'ALPHA', pr: 520, subjectSha: A });

test('the standard program reduces, and state.json is exactly its reduction', () => {
  const r = base();
  assert.equal(r.state.eventCount, BASE.length);
  assert.equal(r.stateText, serialize(reduce(r.eventsText)));
  assert.deepEqual(checkTexts(r.eventsText, r.stateText).problems, []);
  assert.deepEqual(r.state.queue.W3, ['ALPHA', 'BETA']);
  assert.equal(r.state.criticalPath, 'ALPHA');
});

test('the first line chains from GENESIS and each later line from the sha256 of the line before', () => {
  const lines = base().eventsText.trimEnd().split('\n');
  assert.equal(JSON.parse(lines[0]).prev, GENESIS);
  for (let i = 1; i < lines.length; i += 1) assert.equal(JSON.parse(lines[i]).prev, sha256(lines[i - 1]));
  assert.equal(reduce(base().eventsText).ledgerHead, sha256(lines.at(-1)));
});

// ---- required: illegal transition refused ----
for (const [name, event, re] of [
  ['ack before release', { type: 'ack', packet: 'ALPHA' }, /ack is not legal from QUEUED/],
  ['deliver before release', { type: 'deliver', packet: 'ALPHA', pr: 1, subjectSha: A }, /deliver is not legal from QUEUED/],
  ['accept a queued packet', { type: 'accept', packet: 'ALPHA', subjectSha: A }, /accept is not legal from QUEUED/],
  ['integrate before acceptance', { type: 'integrate', packet: 'ALPHA', mergeSha: A }, /integrate is not legal from QUEUED/],
  ['unblock a packet that is not blocked', { type: 'unblock', packet: 'ALPHA' }, /unblock is not legal from QUEUED/],
  ['a second init', { type: 'init' }, /init is legal only as the first event/],
  ['a transition on an unknown packet', { type: 'ack', packet: 'NOPE' }, /packet NOPE does not exist/],
]) {
  test(`illegal transition refused: ${name}`, () => refused(() => add(base(), event), re));
}
test('illegal transition refused: accept straight from RELEASED (nothing delivered)', () => {
  refused(() => add(released(), { type: 'accept', packet: 'ALPHA', subjectSha: A }), /accept is not legal from RELEASED/);
});
test('illegal transition refused: stage an ops-track packet', () => {
  let r = add(base(), { type: 'queue', packet: 'OPS-1', owner: 'W7', track: 'ops' });
  r = add(r, { type: 'release', packet: 'OPS-1', inbox: 400 });
  r = add(r, { type: 'deliver', packet: 'OPS-1', pr: 9, subjectSha: B });
  r = add(r, { type: 'accept', packet: 'OPS-1', subjectSha: B });
  r = add(r, { type: 'integrate', packet: 'OPS-1', mergeSha: C });
  refused(() => add(r, { type: 'stage', packet: 'OPS-1', runId: 1, servedSha: C }), /packet is terminal|stage/);
});
test('the first event must be init', () => {
  refused(() => appendEvent('', { type: 'register-worker', worker: 'W3', inbox: 396, actor: 'Fable', authority: 1 }), /the first event must be init/);
});

// ---- required: broken prev refused ----
test('broken prev refused: a line whose prev does not chain', () => {
  const lines = base().eventsText.trimEnd().split('\n');
  const e = JSON.parse(lines[3]);
  e.prev = sha256('something else');
  lines[3] = JSON.stringify(e);
  refused(() => reduce(`${lines.join('\n')}\n`), /line 4: prev does not match the previous line/);
});
test('broken prev refused: an earlier line edited in place breaks the next line\'s chain', () => {
  const lines = base().eventsText.trimEnd().split('\n');
  lines[3] = lines[3].replace('"inbox":396', '"inbox":397');
  refused(() => reduce(`${lines.join('\n')}\n`), /line 5: prev does not match/);
});
test('a removed line is refused (seq gap)', () => {
  const lines = base().eventsText.trimEnd().split('\n');
  lines.splice(2, 1);
  refused(() => reduce(`${lines.join('\n')}\n`), /line 3: seq is 4, expected 3/);
});
test('a ledger without a trailing newline, or with a blank line, is refused', () => {
  refused(() => reduce(base().eventsText.trimEnd()), /must end with a newline/);
  refused(() => reduce(base().eventsText.replace('\n', '\n\n')), /is blank/);
});

// ---- required: hand-edited snapshot refused (reduce ≠ state) ----
test('hand-edited state.json refused: a phase changed by hand', () => {
  const r = base();
  const edited = r.stateText.replace('"phase": "QUEUED"', '"phase": "ACCEPTED"');
  assert.notEqual(edited, r.stateText);
  const c = checkTexts(r.eventsText, edited);
  assert.equal(c.ok, false);
  assert.ok(c.problems.some((p) => /hand-edited/.test(p)));
});
test('hand-edited state.json refused: whitespace-only reformatting is still not the reduction', () => {
  const r = base();
  assert.equal(checkTexts(r.eventsText, JSON.stringify(JSON.parse(r.stateText))).ok, false);
});
test('state.json from an older head (not regenerated after an append) is refused', () => {
  const r0 = base();
  const r1 = add(r0, { type: 'release', packet: 'ALPHA', inbox: 396 });
  assert.equal(checkTexts(r1.eventsText, r0.stateText).ok, false);
});

// ---- required: two worker-owned packets refused ----
test('two worker-owned packets refused: releasing BETA while W3 holds ALPHA', () => {
  const err = refused(() => add(released(), { type: 'release', packet: 'BETA', inbox: 396 }), /W3 holds 2 worker-owned packets \(ALPHA, BETA\); at most one/);
  assert.ok(err instanceof Refused);
});
test('a delivered packet frees the worker: BETA may be released while ALPHA awaits review', () => {
  const r = add(delivered(), { type: 'release', packet: 'BETA', inbox: 396 });
  assert.equal(r.state.packets.BETA.phase, 'RELEASED');
});
test('two worker-owned packets refused: a finding returns ALPHA to W3 while W3 holds BETA', () => {
  const r = add(delivered(), { type: 'release', packet: 'BETA', inbox: 396 });
  refused(() => add(r, { type: 'finding', packet: 'ALPHA' }), /W3 holds 2 worker-owned packets/);
});

// ---- required: a release outside the canonical inbox refused ----
test('a release outside the canonical inbox refused', () => {
  refused(() => add(base(), { type: 'release', packet: 'ALPHA', inbox: 400 }), /release must be handed off in W3's canonical inbox #396, not #400/);
});
test('a worker cannot be registered twice (the canonical inbox cannot be silently moved)', () => {
  refused(() => add(base(), { type: 'register-worker', worker: 'W3', inbox: 401 }), /already registered/);
});

// ---- required: a queued packet that is already released refused ----
test('a queued packet that is already released refused: queue ALPHA again', () => {
  refused(() => add(released(), { type: 'queue', packet: 'ALPHA', owner: 'W3' }), /packet ALPHA already exists \(RELEASED\)/);
});
test('a released packet leaves the queue, and a queue naming a released packet fails the invariants', () => {
  const r = released();
  assert.deepEqual(r.state.queue.W3, ['BETA']);
  const bad = JSON.parse(r.stateText);
  bad.queue.W3 = ['ALPHA', 'BETA'];
  assert.equal(checkTexts(r.eventsText, serialize(bad)).ok, false);
  assert.ok(invariants(bad).some((p) => /W3's queue names ALPHA, which is already RELEASED/.test(p)));
});
test('reorder-queue must be a permutation of the queue', () => {
  const r = add(base(), { type: 'reorder-queue', owner: 'W3', order: ['BETA', 'ALPHA'] });
  assert.deepEqual(r.state.queue.W3, ['BETA', 'ALPHA']);
  refused(() => add(base(), { type: 'reorder-queue', owner: 'W3', order: ['BETA'] }), /must be a permutation/);
  refused(() => add(base(), { type: 'reorder-queue', owner: 'W3', order: ['BETA', 'BETA'] }), /must be a permutation/);
});

// ---- required: a terminal criticalPath refused ----
test('a terminal criticalPath refused: set-critical-path on a withdrawn packet', () => {
  const r = add(base(), { type: 'withdraw', packet: 'BETA' });
  refused(() => add(r, { type: 'set-critical-path', packet: 'BETA' }), /packet is terminal \(WITHDRAWN\)/);
});
test('a reference packet cannot be the critical path', () => {
  refused(() => add(base(), { type: 'set-critical-path', packet: 'REF-1' }), /a reference packet cannot be the critical path/);
});
test('the critical path clears when its packet completes, and a hand-set terminal criticalPath fails the invariants', () => {
  const r = add(base(), { type: 'withdraw', packet: 'ALPHA' });
  assert.equal(r.state.criticalPath, null);
  const bad = JSON.parse(r.stateText);
  bad.criticalPath = 'ALPHA';
  assert.equal(checkTexts(r.eventsText, serialize(bad)).ok, false);
  assert.ok(invariants(bad).some((p) => /criticalPath ALPHA is terminal/.test(p)));
});

// ---- required: evidence-head advancement does not move subjectSha ----
test('evidence-head advancement does not move subjectSha (record-evidence and reconcile-head)', () => {
  let r = delivered();
  r = add(r, { type: 'record-evidence', packet: 'ALPHA', evidenceSha: B });
  r = add(r, { type: 'reconcile-head', packet: 'ALPHA', prHeadSha: B });
  const a = r.state.packets.ALPHA.artifact;
  assert.deepEqual([a.subjectSha, a.prHeadSha, a.evidenceSha], [A, B, B]);
  assert.equal(r.state.packets.ALPHA.phase, 'DELIVERED');
});
test('evidence never substitutes for acceptance: accepting the evidence head is refused', () => {
  let r = delivered();
  r = add(r, { type: 'record-evidence', packet: 'ALPHA', evidenceSha: B });
  refused(() => add(r, { type: 'accept', packet: 'ALPHA', subjectSha: B }), /accept names bbbbbbbb, but the subject under review is aaaaaaaa/);
  assert.equal(add(r, { type: 'accept', packet: 'ALPHA', subjectSha: A }).state.packets.ALPHA.phase, 'ACCEPTED');
});

// ---- required: a successor deliver does move subjectSha ----
test('a successor deliver moves subjectSha (and the PR head with it)', () => {
  let r = delivered();
  r = add(r, { type: 'review', packet: 'ALPHA', reviewers: ['Fable', 'W7'] });
  r = add(r, { type: 'finding', packet: 'ALPHA' });
  r = add(r, { type: 'deliver', packet: 'ALPHA', pr: 520, subjectSha: C, evidenceSha: D });
  const a = r.state.packets.ALPHA.artifact;
  assert.deepEqual([a.subjectSha, a.prHeadSha, a.evidenceSha, r.state.packets.ALPHA.phase], [C, C, D, 'DELIVERED']);
  refused(() => add(r, { type: 'accept', packet: 'ALPHA', subjectSha: A }), /the subject under review is cccccccc/);
});
test('a successor deliver on a different PR is refused', () => {
  refused(() => add(delivered(), { type: 'deliver', packet: 'ALPHA', pr: 521, subjectSha: C }), /this packet is delivered on #520/);
});

// ---- block / unblock ----
test('block keeps the phase it interrupted, and unblock restores it', () => {
  let r = add(released(), { type: 'ack', packet: 'ALPHA' });
  r = add(r, { type: 'block', packet: 'ALPHA', blockedBy: [{ external: 'OWNER-DEVICE', condition: 'device check pending', owner: 'Owner', unblockWhen: 'owner posts verdict' }] });
  assert.deepEqual([r.state.packets.ALPHA.phase, r.state.packets.ALPHA.phaseBeforeBlock], ['BLOCKED', 'ACKED']);
  r = add(r, { type: 'unblock', packet: 'ALPHA' });
  assert.deepEqual([r.state.packets.ALPHA.phase, r.state.packets.ALPHA.phaseBeforeBlock, r.state.packets.ALPHA.blockedBy], ['ACKED', null, []]);
  refused(() => add(r, { type: 'block', packet: 'ALPHA', blockedBy: [{ packet: 'NOPE', until: 'ACCEPTED' }] }), /blocking packet NOPE does not exist/);
});

// ---- required: PII/secret-like values are rejected ----
const SECRETS = [
  ['an email address', 'ping someone@example.com'],
  ['a Google API key', `AIza${'x'.repeat(30)}`],
  ['a bearer token', 'Bearer abc.def'],
  ['a URL with an oobCode', 'https://x.test/a?oobCode=zzz'],
  ['a GitHub token', `ghp_${'y'.repeat(30)}`],
  ['a private key block', `-----BEGIN ${'PRIVATE'} KEY-----`],
  ['a JWT', `eyJ${'a'.repeat(12)}.${'b'.repeat(12)}.${'c'.repeat(12)}`],
];
for (const [name, value] of SECRETS) {
  test(`PII/secret-like values rejected: ${name} in a label, and the value is never echoed`, () => {
    const err = refused(() => add(base(), { type: 'queue', packet: 'GAMMA', owner: 'W3', label: value }), /-shaped content is not allowed \(value withheld\)/);
    assert.ok(!err.message.includes(value));
  });
}
test('PII/secret-like values rejected in a blocker condition too', () => {
  refused(() => add(released(), { type: 'block', packet: 'ALPHA', blockedBy: [{ external: 'X-1', condition: 'mail a@b.co', owner: 'Owner', unblockWhen: 'later' }] }), /email-address-shaped/);
});
test('free text is short and single-line; unknown fields (prose, titles, bodies) are refused', () => {
  refused(() => add(base(), { type: 'queue', packet: 'GAMMA', owner: 'W3', label: 'x'.repeat(201) }), /limited to 200 characters/);
  refused(() => add(base(), { type: 'queue', packet: 'GAMMA', owner: 'W3', label: 'two\nlines' }), /multi-line/);
  refused(() => add(base(), { type: 'queue', packet: 'GAMMA', owner: 'W3', title: 'PR title copy' }), /unknown field "title"/);
  refused(() => add(delivered(), { type: 'review', packet: 'ALPHA', reviewers: ['W7'], body: 'comment text' }), /unknown field "body"/);
});
test('the envelope is checked: actor, authority and type', () => {
  assert.ok(validateEvent({ seq: 1, type: 'init', actor: 'W3', authority: 1, prev: GENESIS }).some((p) => /actor must be one of/.test(p)));
  assert.ok(validateEvent({ seq: 1, type: 'init', actor: 'Fable', authority: 0, prev: GENESIS }).some((p) => /authority must be the GitHub comment id/.test(p)));
  assert.deepEqual(validateEvent({ seq: 1, type: 'nope', actor: 'Fable', authority: 1, prev: GENESIS }), ['unknown event type "nope"']);
});

// ---- the single writer ----
test('append refuses a caller-supplied seq or prev', () => {
  refused(() => appendEvent(base().eventsText, { type: 'ack', packet: 'ALPHA', actor: 'Fable', authority: 1, seq: 99 }), /assigned by append.mjs/);
});
test('append --expect-head refuses a writer that read an older head', () => {
  const r0 = base();
  const r1 = add(r0, { type: 'release', packet: 'ALPHA', inbox: 396 });
  refused(() => appendEvent(r1.eventsText, { type: 'ack', packet: 'ALPHA', actor: 'Fable', authority: 7 }, { expectHead: r0.state.ledgerHead }), /another decision was recorded; re-read and reconcile/);
  assert.equal(appendEvent(r1.eventsText, { type: 'ack', packet: 'ALPHA', actor: 'Fable', authority: 7 }, { expectHead: r1.state.ledgerHead }).state.packets.ALPHA.phase, 'ACKED');
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-control-'));
const writeEvent = (dir, e) => { const f = path.join(dir, 'event.json'); fs.writeFileSync(f, JSON.stringify(e)); return f; };
test('append.mjs CLI writes the pair; check.mjs CLI validates it', () => {
  const d = tmp();
  const state = path.join(d, 'state');
  for (const [i, e] of BASE.entries()) {
    const r = run('append.mjs', [state, writeEvent(d, { actor: 'Fable', authority: 2000 + i, ...e })]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`^APPENDED seq=${i + 1} type=${e.type} head=[0-9a-f]{64}$`, 'm'));
  }
  const c = run('check.mjs', [state]);
  assert.equal(c.status, 0, c.stderr);
  assert.match(c.stdout, new RegExp(`^CONTROL_STATE=valid events=${BASE.length} head=[0-9a-f]{12}$`, 'm'));
});
test('append.mjs CLI refuses an illegal event and writes nothing', () => {
  const d = tmp();
  const state = path.join(d, 'state');
  appendToDir(state, { actor: 'Fable', authority: 1, type: 'init' });
  const before = [fs.readFileSync(path.join(state, 'events.jsonl'), 'utf8'), fs.readFileSync(path.join(state, 'state.json'), 'utf8')];
  const r = run('append.mjs', [state, writeEvent(d, { actor: 'Fable', authority: 2, type: 'ack', packet: 'NOPE' })]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^APPEND=refused \(nothing written\)$/m);
  assert.deepEqual([fs.readFileSync(path.join(state, 'events.jsonl'), 'utf8'), fs.readFileSync(path.join(state, 'state.json'), 'utf8')], before);
  assert.deepEqual(fs.readdirSync(state).sort(), ['events.jsonl', 'state.json']);
});
test('append refuses to build on a hand-edited state.json, and check.mjs CLI reports it invalid', () => {
  const d = tmp();
  const state = path.join(d, 'state');
  for (const [i, e] of BASE.entries()) appendToDir(state, { actor: 'Fable', authority: 3000 + i, ...e });
  const sp = path.join(state, 'state.json');
  fs.writeFileSync(sp, fs.readFileSync(sp, 'utf8').replace('"criticalPath": "ALPHA"', '"criticalPath": null'));
  refused(() => appendToDir(state, { actor: 'Fable', authority: 9, type: 'release', packet: 'ALPHA', inbox: 396 }), /not valid before this append/);
  const c = run('check.mjs', [state]);
  assert.equal(c.status, 1);
  assert.match(c.stdout, /^CONTROL_STATE=invalid/m);
  assert.match(c.stderr, /hand-edited/);
  assert.equal(checkDir(state).ok, false);
});
test('append.mjs CLI --expect-head mismatch writes nothing', () => {
  const d = tmp();
  const state = path.join(d, 'state');
  appendToDir(state, { actor: 'Fable', authority: 1, type: 'init' });
  const r = run('append.mjs', [state, writeEvent(d, { actor: 'Fable', authority: 2, type: 'register-worker', worker: 'W3', inbox: 396 }), '--expect-head', E.slice(0, 40) + E.slice(0, 24)]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /APPEND=refused/);
  assert.equal(checkDir(state).state.eventCount, 1);
});

done('ledger');
