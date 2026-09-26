#!/usr/bin/env node
/** check-milestone-manifest.mjs: the frozen manifest is checked BEFORE deploy (CONTROL-PLANE-CI-1 C3). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkMilestone } from '../check-milestone-manifest.mjs';
import { drivers } from '../journeys/index.mjs';

const CLI = path.resolve('.github/wsf-staging/check-milestone-manifest.mjs');
const EXAMPLE = path.resolve('.github/wsf-staging/journeys/examples/community-settings-parity-1.json');
const LIVE = path.resolve('.github/wsf-staging/journeys/manifest.json');
let passed = 0;
const test = (n, f) => { f(); passed += 1; console.log(`  ok  ${n}`); };

const example = JSON.parse(fs.readFileSync(EXAMPLE, 'utf8'));
const APPROVED = example.productSha;
const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-cmm-'));
const write = (name, body) => { const p = path.join(d, name); fs.writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body)); return p; };
const check = (p, approvedSha = APPROVED) => checkMilestone({ manifestPath: p, approvedSha, drivers });

test('ABSENT is allowed and said plainly: no member-visible milestone, never a pass', () => {
  const r = check(path.join(d, 'none.json'));
  assert.equal(r.status, 'absent');
  assert.match(r.lines[0], /no member-visible milestone is declared/);
  assert.doesNotMatch(r.lines.join(' '), /pass/i);
});

test('the COMMUNITY-SETTINGS-PARITY-1 example is valid for its own SHA, every journey driven', () => {
  const r = check(EXAMPLE);
  assert.equal(r.status, 'valid', r.lines.join('\n'));
  assert.match(r.lines[0], /COMMUNITY-SETTINGS-PARITY-1: 2 journeys \(community, settings\), each with a registered driver/);
});

test('REFUSED: a stale manifest (productSha is not the approved candidate)', () => {
  const r = check(EXAMPLE, 'c'.repeat(40));
  assert.equal(r.status, 'refused');
  assert.match(r.lines.join(' '), /the manifest is for 938e00d8[0-9a-f]{32}, but the approved candidate is c{40}/);
});

test('REFUSED: a journey with no registered driver', () => {
  const r = check(write('nodriver.json', { ...example, journeys: [...example.journeys, { ...example.journeys[0], id: 'kiosk' }] }));
  assert.equal(r.status, 'refused');
  assert.match(r.lines.join(' '), /no registered driver for journey kiosk/);
});

test('REFUSED: a schema-invalid manifest, naming the problem', () => {
  const r = check(write('bad.json', { ...example, extra: 1 }));
  assert.equal(r.status, 'refused');
  assert.match(r.lines.join(' '), /unknown key "extra"/);
});

test('REFUSED: not JSON', () => assert.equal(check(write('x.json', '{')).status, 'refused'));
test('REFUSED: no valid approved SHA to compare against', () => assert.equal(check(EXAMPLE, '').status, 'refused'));

test('the CLI: absent and valid exit 0; refused exits 1 before any deploy', () => {
  const run = (p, sha) => spawnSync(process.execPath, [CLI, p], { encoding: 'utf8', env: { ...process.env, WSF_APPROVED_SHA: sha } });
  const a = run(path.join(d, 'none.json'), APPROVED);
  assert.equal(a.status, 0);
  assert.match(a.stdout, /MILESTONE_MANIFEST=absent/);
  const v = run(EXAMPLE, APPROVED);
  assert.equal(v.status, 0, v.stderr);
  assert.match(v.stdout, /MILESTONE_MANIFEST=valid/);
  const x = run(EXAMPLE, 'c'.repeat(40));
  assert.equal(x.status, 1);
  assert.match(x.stdout, /MILESTONE_MANIFEST=refused/);
  assert.match(x.stderr, /::error::the manifest is for/);
});

test('--require (the activation proof): ABSENT is a refusal, a valid manifest still passes', () => {
  const absent = checkMilestone({ manifestPath: path.join(d, 'none.json'), approvedSha: APPROVED, drivers, required: true });
  assert.equal(absent.status, 'refused');
  assert.match(absent.lines[0], /a milestone manifest is required for this run/);
  assert.equal(checkMilestone({ manifestPath: EXAMPLE, approvedSha: APPROVED, drivers, required: true }).status, 'valid');
  const cli = spawnSync(process.execPath, [CLI, '--require', path.join(d, 'none.json')], { encoding: 'utf8', env: { ...process.env, WSF_APPROVED_SHA: APPROVED } });
  assert.equal(cli.status, 1);
  assert.match(cli.stdout, /MILESTONE_MANIFEST=refused/);
  const unknown = spawnSync(process.execPath, [CLI, '--allow-absent', EXAMPLE], { encoding: 'utf8' });
  assert.equal(unknown.status, 1, 'an unknown flag is a usage error, never ignored');
});

test('on this branch, a live manifest (if any) passes the pre-deploy check for the approved candidate', () => {
  // No edit here when a manifest lands: that would make every visible
  // milestone a release-environment code change (C1).
  const approved = JSON.parse(fs.readFileSync(path.resolve('.github/wsf-staging/approved-candidate.json'), 'utf8')).approvedAppSha;
  const r = check(LIVE, approved);
  assert.notEqual(r.status, 'refused', r.lines.join('\n'));
});

console.log(`\ncheck-milestone-manifest: ${passed} passed`);
