#!/usr/bin/env node
/** milestone-manifest.mjs: the strict schema v1 the smoke and the owner card both read. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateManifest } from '../milestone-manifest.mjs';

const CLI = path.resolve('.github/wsf-staging/milestone-manifest.mjs');
let passed = 0;
const test = (n, f) => { f(); passed += 1; console.log(`  ok  ${n}`); };

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const good = () => ({
  schemaVersion: 1,
  milestone: 'COMMUNITY-SETTINGS-PARITY-1',
  productSha: A,
  previousKnownGoodSha: B,
  journeys: [{
    id: 'community',
    entry: '/community',
    setup: 'signed-in active member with selected community',
    actions: ['open Community', 'switch selected community', 'return'],
    expected: ['selected community leads presentation', 'server order is not mutated'],
    knownExclusions: [],
  }],
});
const edit = (f) => { const m = good(); f(m); return m; };
const fails = (m, re) => {
  const e = validateManifest(m);
  assert.ok(e.length > 0, 'expected the manifest to be refused');
  assert.ok(e.some((x) => re.test(x)), `no error matched ${re}: ${e.join(' | ')}`);
};

test('the contract example is valid', () => assert.deepEqual(validateManifest(good()), []));

const CASES = [
  ['an unknown top-level key', (m) => { m.asOf = 'x'; }, /unknown key "asOf"/],
  ['a missing top-level key', (m) => { delete m.previousKnownGoodSha; }, /missing previousKnownGoodSha/],
  ['schemaVersion 2', (m) => { m.schemaVersion = 2; }, /schemaVersion must be 1/],
  ['a lower-case milestone', (m) => { m.milestone = 'community'; }, /milestone must be/],
  ['a short productSha', (m) => { m.productSha = 'abc1234'; }, /productSha must be/],
  ['an upper-case previousKnownGoodSha', (m) => { m.previousKnownGoodSha = 'B'.repeat(40); }, /previousKnownGoodSha must be/],
  ['product and rollback SHAs equal', (m) => { m.previousKnownGoodSha = A; }, /same commit/],
  ['no journeys', (m) => { m.journeys = []; }, /non-empty array/],
  ['a misspelt journey key', (m) => { m.journeys[0].knownExclusion = []; }, /unknown key "knownExclusion"/],
  ['a missing journey key', (m) => { delete m.journeys[0].setup; }, /missing setup/],
  ['a duplicate journey id', (m) => { m.journeys.push({ ...m.journeys[0] }); }, /duplicate/],
  ['a bad journey id', (m) => { m.journeys[0].id = 'Community Home'; }, /\.id must/],
  ['an entry that is a URL', (m) => { m.journeys[0].entry = 'https://example.test/community'; }, /entry must be an app path/],
  ['a protocol-relative entry', (m) => { m.journeys[0].entry = '//example.test/x'; }, /entry must be an app path/],
  ['an entry with no leading slash', (m) => { m.journeys[0].entry = 'community'; }, /entry must be an app path/],
  ['no actions', (m) => { m.journeys[0].actions = []; }, /actions must have at least 1/],
  ['no expected', (m) => { m.journeys[0].expected = []; }, /expected must have at least 1/],
  ['a blank expectation', (m) => { m.journeys[0].expected = ['  ']; }, /expected\[0\]/],
  ['a multi-line action', (m) => { m.journeys[0].actions = ['a\nb']; }, /actions\[0\]/],
  ['knownExclusions not an array', (m) => { m.journeys[0].knownExclusions = 'none'; }, /knownExclusions must be an array/],
  ['an empty setup', (m) => { m.journeys[0].setup = ''; }, /setup must be/],
];
for (const [name, f, re] of CASES) test(`REFUSED: ${name}`, () => fails(edit(f), re));
test('REFUSED: not an object', () => assert.deepEqual(validateManifest([]), ['the manifest must be a JSON object']));

test('the CLI prints MANIFEST=valid / MANIFEST=invalid with exit 0 / 1', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-manifest-'));
  const ok = path.join(d, 'ok.json');
  const bad = path.join(d, 'bad.json');
  fs.writeFileSync(ok, JSON.stringify(good()));
  fs.writeFileSync(bad, JSON.stringify(edit((m) => { m.extra = 1; })));
  const r1 = spawnSync(process.execPath, [CLI, ok], { encoding: 'utf8' });
  assert.equal(r1.status, 0);
  assert.match(r1.stdout, /MANIFEST=valid COMMUNITY-SETTINGS-PARITY-1 \(1 journey\)/);
  const r2 = spawnSync(process.execPath, [CLI, bad], { encoding: 'utf8' });
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /MANIFEST=invalid/);
  const r3 = spawnSync(process.execPath, [CLI, path.join(d, 'absent.json')], { encoding: 'utf8' });
  assert.equal(r3.status, 1);
});

console.log(`\nmilestone-manifest: ${passed} passed`);
