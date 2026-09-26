#!/usr/bin/env node
/**
 * AUTONOMY-STATE-1A O1/O2 (Director #519 5849116723; W7 Check 65 observations):
 *   O1 CURRENT body integrity is required: a configured CURRENT surface is ok or
 *      stale only when the snapshot carries the SHA-256 of its exact body and that
 *      hash verifies as a rendering this ledger produced; the skill's snapshot is
 *      built by current-surface.mjs from the fetched body;
 *   O2 a W# implementation owner never reviews its own work packet.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { BASE, CURRENT_COMMENT, GENESIS, SOURCE_ONLY, add, boot, build, chain, comment, done, refused, test } from './helpers.mjs';
import { appendToDir } from '../append.mjs';
import { ledgerHeads, sha256 } from '../reduce.mjs';
import { reconcile, surfaceStatus } from '../reconcile.mjs';
import { renderCurrent, renderHashes } from '../render-current.mjs';
import { programView } from '../program-view.mjs';
import { surfaceEvidence } from '../current-surface.mjs';

const TOOLS = path.resolve('tools/wsf-control');
const cli = (script, args) => spawnSync(process.execPath, [path.join(TOOLS, script), ...args], { encoding: 'utf8' });
const two = () => { const r1 = add(build(BASE), { type: 'release', packet: 'ALPHA', inbox: 396 }); return { r1, r2: add(r1, { type: 'register-worker', worker: 'W9', inbox: 409 }) }; };
const statusOf = (r, surface) => surfaceStatus(r.state, { schemaVersion: 1, prs: {}, currentSurface: surface }, { heads: ledgerHeads(r.eventsText), renders: renderHashes(r.eventsText) });

// ---- O1: the skill-created snapshot carries the exact body hash ----
test('O1: current-surface.mjs builds the snapshot entry from the fetched body: marker head and exact body hash', () => {
  const { r2 } = two();
  const body = renderCurrent(r2.state);
  assert.deepEqual(surfaceEvidence(CURRENT_COMMENT, body), { commentId: CURRENT_COMMENT, exists: true, markerHead: r2.state.ledgerHead, bodySha256: sha256(body) });
  assert.deepEqual(surfaceEvidence(CURRENT_COMMENT, null), { commentId: CURRENT_COMMENT, exists: false, markerHead: null, bodySha256: null });
  assert.deepEqual(surfaceEvidence(CURRENT_COMMENT, 'no marker here\n'), { commentId: CURRENT_COMMENT, exists: true, markerHead: null, bodySha256: sha256('no marker here\n') });
  // Line endings a comment store may introduce are normalised before hashing.
  assert.equal(surfaceEvidence(CURRENT_COMMENT, body.replace(/\n/g, '\r\n')).bodySha256, sha256(body));
});
test('O1: the skill-created snapshot of a current, untouched CURRENT is ok; of a stale, untouched one is stale (verified repair)', () => {
  const { r1, r2 } = two();
  assert.deepEqual(statusOf(r2, surfaceEvidence(CURRENT_COMMENT, renderCurrent(r2.state))).status, 'ok');
  assert.deepEqual(statusOf(r2, surfaceEvidence(CURRENT_COMMENT, renderCurrent(r1.state))).status, 'stale');
});
test('O1: a hand-edited body is an exception whether its marker is current or earlier', () => {
  const { r1, r2 } = two();
  for (const body of [renderCurrent(r2.state), renderCurrent(r1.state)]) {
    const st = statusOf(r2, surfaceEvidence(CURRENT_COMMENT, body.replace('# WSF control state: CURRENT', '# WSF control state: CURRENT (edited)')));
    assert.equal(st.status, 'exception');
    assert.match(st.detail, /hand-edited/);
  }
});
for (const [name, patch, re] of [
  ['missing', (s) => { delete s.bodySha256; }, /body integrity evidence \(bodySha256\) is missing or unavailable/],
  ['unavailable (null)', (s) => { s.bodySha256 = null; }, /body integrity evidence \(bodySha256\) is missing or unavailable/],
  ['malformed', (s) => { s.bodySha256 = 'not-a-hash'; }, /body integrity evidence \(bodySha256\) is malformed/],
]) {
  test(`O1: ${name} body evidence fails closed as exception, never ok or stale (current and earlier marker)`, () => {
    const { r1, r2 } = two();
    for (const body of [renderCurrent(r2.state), renderCurrent(r1.state)]) {
      const surface = surfaceEvidence(CURRENT_COMMENT, body);
      patch(surface);
      const st = statusOf(r2, surface);
      assert.deepEqual([st.status, re.test(st.detail)], ['exception', true]);
      const v = programView(r2.state, { schemaVersion: 1, prs: {}, currentSurface: surface }, { heads: ledgerHeads(r2.eventsText), renders: renderHashes(r2.eventsText) });
      assert.ok(v.includes('CURRENT_SURFACE=exception'));
    }
  });
}
test('O1: the current-surface CLI writes the snapshot entry, and reconcile/program-view accept it end to end', () => {
  const d = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-integrity-')), 'state');
  let head = GENESIS;
  let body = null;
  let bodyHead = null;
  for (const [i, e] of [...BASE, { type: 'release', packet: 'ALPHA', inbox: 396 }].entries()) {
    const r = appendToDir(d, { actor: 'Fable', source: comment(8500 + i), ...e }, { expectHead: head });
    head = r.state.ledgerHead;
    if (i === BASE.length - 1) { body = renderCurrent(r.state); bodyHead = head; } // CURRENT as last edited: one head behind
  }
  const bodyFile = path.join(path.dirname(d), 'current-body.md');
  fs.writeFileSync(bodyFile, body);
  const out = cli('current-surface.mjs', [String(CURRENT_COMMENT), bodyFile]);
  assert.equal(out.status, 0, out.stderr);
  const surface = JSON.parse(out.stdout);
  assert.deepEqual(surface, { commentId: CURRENT_COMMENT, exists: true, markerHead: bodyHead, bodySha256: sha256(body) });
  const snapFile = path.join(path.dirname(d), 'snap.json');
  fs.writeFileSync(snapFile, JSON.stringify({ schemaVersion: 1, prs: {}, currentSurface: surface }));
  assert.match(cli('reconcile.mjs', [d, snapFile]).stdout, /^CURRENT_SURFACE=stale$/m);
  fs.writeFileSync(bodyFile, `${body}hand edit\n`);
  fs.writeFileSync(snapFile, JSON.stringify({ schemaVersion: 1, prs: {}, currentSurface: JSON.parse(cli('current-surface.mjs', [String(CURRENT_COMMENT), bodyFile]).stdout) }));
  assert.match(cli('program-view.mjs', [d, '--snapshot', snapFile]).stdout, /^CURRENT_SURFACE=exception$/m);
  const missing = cli('current-surface.mjs', [String(CURRENT_COMMENT), '--missing']);
  assert.deepEqual(JSON.parse(missing.stdout), { commentId: CURRENT_COMMENT, exists: false, markerHead: null, bodySha256: null });
});
test('O1: the skill tells the session to build the CURRENT snapshot entry with current-surface.mjs from the fetched body', () => {
  const skill = fs.readFileSync('.claude/skills/wsf-program-director/SKILL.md', 'utf8').replace(/\s+/g, ' ');
  assert.match(skill, /node tools\/wsf-control\/current-surface\.mjs <commentId> <body file>/);
  assert.match(skill, /exact body/);
  assert.doesNotMatch(skill, /the CURRENT comment \(it exists, and its marker head\)/);
});

// ---- O2: no owner self-review ----
const delivered = () => chain(build(BASE), { type: 'release', packet: 'ALPHA', inbox: 396 }, { type: 'deliver', packet: 'ALPHA', pr: 520, subjectSha: 'a'.repeat(40) });
test('O2: append refuses a review that names the implementation owner as a reviewer', () => {
  refused(() => add(delivered(), { type: 'review', packet: 'ALPHA', reviewers: ['W3'] }), /W3 cannot review its own work packet ALPHA; review must be independent/);
  refused(() => add(delivered(), { type: 'review', packet: 'ALPHA', reviewers: ['W7', 'W3'] }), /W3 cannot review its own work packet ALPHA/);
  assert.equal(add(delivered(), { type: 'review', packet: 'ALPHA', reviewers: ['W7', 'Fable'] }).state.packets.ALPHA.phase, 'UNDER_REVIEW');
});
test('O2: bootstrap import refuses an UNDER_REVIEW packet reviewed by its own owner', () => {
  refused(() => build([boot({
    packets: { LIVE: { owner: 'W3', completion: SOURCE_ONLY, phase: 'UNDER_REVIEW', pr: 9, artifact: { subjectSha: 'b'.repeat(40) }, reviewers: ['W3'], refs: [comment(71)] } },
  })]), /W3 cannot review its own work packet LIVE/);
  assert.equal(build([boot({
    packets: { LIVE: { owner: 'W3', completion: SOURCE_ONLY, phase: 'UNDER_REVIEW', pr: 9, artifact: { subjectSha: 'b'.repeat(40) }, reviewers: ['W7'], refs: [comment(71)] } },
  })]).state.packets.LIVE.phase, 'UNDER_REVIEW');
});
test('O2: non-worker reviewers are unaffected and still wake no W#', () => {
  const r = add(delivered(), { type: 'review', packet: 'ALPHA', reviewers: ['Director', 'Owner'] });
  const out = reconcile(r.state, { schemaVersion: 1, prs: { 520: { state: 'open', merged: false, headSha: 'a'.repeat(40) } }, currentSurface: surfaceEvidence(CURRENT_COMMENT, renderCurrent(r.state)) });
  assert.deepEqual(out, []);
});

done('integrity');
