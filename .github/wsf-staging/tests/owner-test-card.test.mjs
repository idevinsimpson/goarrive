#!/usr/bin/env node
/** owner-test-card.mjs: the card says only what was run, on the build that was served. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { renderCard } from '../owner-test-card.mjs';

const CLI = path.resolve('.github/wsf-staging/owner-test-card.mjs');
let passed = 0;
const test = (n, f) => { f(); passed += 1; console.log(`  ok  ${n}`); };

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const URL_ = 'https://staging.example.test';
const journey = (id, extra = {}) => ({
  id, entry: `/${id}`, setup: `setup for ${id}`, actions: [`open ${id}`, 'return'],
  expected: [`${id} looks right`], knownExclusions: [], ...extra,
});
const manifest = () => ({
  schemaVersion: 1, milestone: 'TEST-MILESTONE-1', productSha: A, previousKnownGoodSha: B,
  journeys: [journey('community', { knownExclusions: ['kiosk use stays held'] }), journey('you')],
});
const pass = (journeyId, marker = A) => ({
  journeyId, status: 'passed', servedMarker: marker, setupId: 'member-1', actionsPerformed: ['open'],
  assertions: [{ expected: `${journeyId} looks right`, ok: true }], reason: null, artifact: null,
});
const results = (list, servedSha = A) => ({ schemaVersion: 1, servedSha, results: list });
const card = (r, m = manifest()) => renderCard(m, r, { stagingUrl: URL_ });
const refused = (r, re, m) => assert.throws(() => card(r, m), re);

test('every journey passed on the manifest build: PASSED, with the required header', () => {
  const c = card(results([pass('community'), pass('you')]));
  assert.equal(c.summary, 'PASSED');
  for (const line of [`- Staging link: ${URL_}`, `- Served SHA: ${A}`, `- Previous known-good / rollback SHA: ${B}`,
    '- Milestone: TEST-MILESTONE-1', '- Hosted changed-journey status: PASSED (2 passed, 0 failed, 0 blocked, 0 not verified, 0 not run)']) {
    assert.ok(c.text.includes(line), `missing header line: ${line}`);
  }
  assert.match(c.text, /1\. Where to go: `\/community`\n2\. Setup that matters: setup for community\n3\. What to do: open community → return\n4\. What should be visible or feel different:\n   - community looks right\n5\. Intentionally unchanged or unavailable:\n   - kiosk use stays held/);
  assert.match(c.text, /5\. Intentionally unchanged or unavailable: none recorded/);
});

test('device review is always NOT RUN — Devin\'s verdict, even when everything passed', () => {
  const c = card(results([pass('community'), pass('you')]));
  assert.match(c.text, /- Device review: NOT RUN — Devin's verdict/);
  assert.match(c.text, /## Device review\n\nNOT RUN — Devin's verdict/);
  assert.doesNotMatch(c.text, /Device review: (PASS|pass)/);
});

test('a journey with no result is NOT RUN and the card is INCOMPLETE, never PASSED', () => {
  const c = card(results([pass('community')]));
  assert.equal(c.summary, 'INCOMPLETE');
  assert.match(c.text, /## 2\. you[\s\S]*Hosted smoke: \*\*NOT RUN\*\*/);
});

test('no results at all: the hosted status is NOT RUN and every journey says so', () => {
  const c = card(null);
  assert.equal(c.summary, 'NOT RUN');
  assert.match(c.text, /Hosted changed-journey status: NOT RUN/);
  assert.match(c.text, /- Served SHA: not observed/);
  assert.equal((c.text.match(/\*\*NOT RUN\*\*/g) || []).length, 2);
});

test('a served-SHA mismatch means nothing is verified, whatever the statuses say', () => {
  const c = card(results([pass('community', C), pass('you', C)], C));
  assert.equal(c.summary, 'INCOMPLETE');
  assert.match(c.text, /NOT the manifest's a{40}; nothing below is verified/);
  assert.equal((c.text.match(/\*\*NOT VERIFIED\*\*/g) || []).length, 2);
  assert.doesNotMatch(c.text, /\*\*PASSED\*\*/);
});

test('one result observed on another build is NOT VERIFIED on its own', () => {
  const c = card(results([pass('community'), pass('you', C)]));
  assert.equal(c.summary, 'INCOMPLETE');
  assert.match(c.text, /## 2\. you[\s\S]*\*\*NOT VERIFIED\*\* — observed build cccccccc is not the manifest's aaaaaaaa/);
});

test('a verified failure makes the card FAILED and names what did not hold', () => {
  const failed = { ...pass('you'), status: 'failed', reason: 'an expected assertion did not hold', assertions: [{ expected: 'you looks right', ok: false }] };
  const c = card(results([pass('community'), failed]));
  assert.equal(c.summary, 'FAILED');
  assert.match(c.text, /\*\*FAILED\*\* — an expected assertion did not hold; did not hold: you looks right/);
});

test('a failure on the wrong build is NOT VERIFIED, not FAILED', () => {
  const failed = { ...pass('you', C), status: 'failed', reason: 'x', assertions: [] };
  assert.equal(card(results([pass('community'), failed])).summary, 'INCOMPLETE');
});

test('BLOCKED keeps its reason and is never PASSED', () => {
  const b = { ...pass('you', null), status: 'blocked', reason: 'no registered driver', assertions: [], actionsPerformed: [] };
  const c = card(results([pass('community'), b]));
  assert.equal(c.summary, 'INCOMPLETE');
  assert.match(c.text, /\*\*BLOCKED\*\* — no registered driver/);
});

test('REFUSED: an unknown status', () => refused(results([{ ...pass('you'), status: 'skipped' }]), /only passed, failed, blocked are known/));
test('REFUSED: a result for a journey the manifest does not name', () => refused(results([pass('kiosk')]), /does not name/));
test('REFUSED: two results for one journey', () => refused(results([pass('you'), pass('you')]), /second result/));
test('REFUSED: passed with no assertions', () => refused(results([{ ...pass('you'), assertions: [] }]), /carries no assertions/));
test('REFUSED: passed with an assertion that did not hold', () => refused(results([{ ...pass('you'), assertions: [{ expected: 'x', ok: false }] }]), /did not hold/));
test('REFUSED: failed or blocked without a reason', () => refused(results([{ ...pass('you'), status: 'failed', reason: null }]), /without a reason/));
test('REFUSED: an unknown result key', () => refused(results([{ ...pass('you'), verdict: 'ok' }]), /unknown key "verdict"/));
test('REFUSED: an invalid manifest', () => refused(null, /manifest is invalid/, { ...manifest(), extra: 1 }));
test('REFUSED: a non-https staging link', () => assert.throws(() => renderCard(manifest(), null, { stagingUrl: 'http://x' }), /https URL/));

test('the CLI is deterministic and prints OWNER_CARD_SUMMARY', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-card-'));
  const mf = path.join(d, 'm.json');
  const rf = path.join(d, 'r.json');
  fs.writeFileSync(mf, JSON.stringify(manifest()));
  fs.writeFileSync(rf, JSON.stringify(results([pass('community')])));
  const go = (out) => spawnSync(process.execPath, [CLI, '--manifest', mf, '--results', rf, '--staging-url', URL_, '--out', out], { encoding: 'utf8' });
  const r1 = go(path.join(d, '1.md'));
  const r2 = go(path.join(d, '2.md'));
  assert.equal(r1.status, 0, r1.stderr);
  assert.match(r1.stdout, /OWNER_CARD_SUMMARY=INCOMPLETE/);
  assert.equal(fs.readFileSync(path.join(d, '1.md'), 'utf8'), fs.readFileSync(path.join(d, '2.md'), 'utf8'));
  fs.writeFileSync(rf, JSON.stringify(results([{ ...pass('you'), status: 'maybe' }])));
  const r3 = go(path.join(d, '3.md'));
  assert.equal(r3.status, 1);
  assert.match(r3.stderr, /OWNER_CARD=refused/);
  assert.equal(fs.existsSync(path.join(d, '3.md')), false);
});

console.log(`\nowner-test-card: ${passed} passed`);
