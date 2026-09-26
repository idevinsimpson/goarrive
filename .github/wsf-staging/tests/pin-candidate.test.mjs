#!/usr/bin/env node
/**
 * pin-candidate.mjs against fixture git repositories built here, plus a golden
 * replay of a real pin.
 *
 * The golden (fixtures/pin-14ce1907.json -> fixtures/pin-74d19281.json, the
 * approval files of #502 and #508 exactly as merged) covers the MACHINE fields,
 * the key order and the history rotation byte for byte, and the inventory note.
 * It does not cover packageLabel (reviewed prose, an input) or the boundary
 * note (the hand-written one carried a per-file narrative the generator
 * deliberately replaces with git facts); the rollback note differs by exactly
 * one hand-written sentence, asserted below.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  PROTECTED_PATHS, exportedFunctions, verifierBase, nextApproval, serialize,
} from '../pin-candidate.mjs';

const GEN = path.resolve('.github/wsf-staging/pin-candidate.mjs');
const FIX = path.resolve('.github/wsf-staging/tests/fixtures');
let passed = 0;
const test = (n, f) => { f(); passed += 1; console.log(`  ok  ${n}`); };

// ---- a fixture repository ---------------------------------------------------------
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-pin-'));
const repo = path.join(root, 'repo');
fs.mkdirSync(repo);
const g = (...args) => {
  const r = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env, GIT_AUTHOR_NAME: 'f', GIT_AUTHOR_EMAIL: 'f@example.test', GIT_COMMITTER_NAME: 'f',
      GIT_COMMITTER_EMAIL: 'f@example.test', GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
    },
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const write = (rel, body) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), body); };
const commit = (msg) => { g('add', '-A'); g('commit', '-q', '--allow-empty', '-m', msg); return g('rev-parse', 'HEAD'); };
const fn = (names) => `import { onCall } from 'x';\nexport function helper() {}\n${names.map((n) => `export const ${n} = onCall<Req>(\n  async () => 1,\n);`).join('\n')}\n`;
const VERIFIER = "const BASE_EXPECTED = [\n  'wsfalpha', // the 'wsfnotaname' in a comment\n  'wsfbeta',\n];\n";

g('init', '-q', '-b', 'main');
write('functions-westayfit/src/index.ts', fn(['wsfAlpha', 'wsfBeta', 'wsfGamma']));
write('apps/westayfit/app/(tabs)/you.tsx', 'you v1\n');
write('apps/westayfit/app/old.tsx', 'old\n');
write('firestore.indexes.json', '{}\n');
write('.github/wsf-staging/verify-deployment.mjs', VERIFIER);
write('.github/wsf-staging/other.mjs', 'v1\n');
const B0 = commit('base');
write('apps/westayfit/app/(tabs)/you.tsx', 'you v2\n');
const P = commit('the served pin');

const approval0 = {
  _comment: ['fixture'], project: 'westayfit-staging', approvedAppSha: P,
  packageLabel: 'PREVIOUS LABEL', sourceAcceptedOn: '2026-01-01', expectedPriorFunctions: 3,
  candidateAddedFunctions: ['wsfgamma'], _rollbackNote: 'old rollback',
  _expectedPriorFunctionsNote: 'old prior note', _fullCandidateNote: 'old boundary note', _other: 'kept',
};
write('.github/wsf-staging/approved-candidate.json', serialize(approval0));
const RUN_MAIN = commit('ops main approving P');
write('README.md', 'unrelated\n');
const OPS = commit('ops head, no release-environment change');
write('.github/wsf-staging/approved-candidate.json', serialize({ ...approval0, packageLabel: 'edited' }));
const OPS_APPROVAL_ONLY = commit('ops head changing only the approval');
write('.github/wsf-staging/other.mjs', 'v2\n');
const OPS_CHANGED = commit('ops head changing the automation');
write('.github/wsf-staging/approved-candidate.json', serialize({ ...approval0, approvedAppSha: B0 }));
const RUN_MAIN_OTHER = commit('ops main approving a different SHA');

g('checkout', '-q', '-b', 'dev', P);
write('apps/westayfit/app/new-route.tsx', 'new\n');
write('apps/westayfit/app/(tabs)/you.tsx', 'you v3\n');
g('mv', 'apps/westayfit/app/old.tsx', 'apps/westayfit/app/renamed.tsx');
write('docs/review/a.md', 'a\n');
const C = commit('the accepted candidate');
write('firestore.indexes.json', '{"indexes":[]}\n');
const C_PROTECTED = commit('touches an index file');
g('checkout', '-q', '-b', 'fn', C);
write('functions-westayfit/src/index.ts', fn(['wsfAlpha', 'wsfBeta', 'wsfGamma', 'wsfDelta']));
const C_FUNCTIONS = commit('adds a callable');
g('checkout', '-q', '-b', 'side', B0);
write('docs/side.md', 'side\n');
const C_SIDE = commit('not a descendant of P');
g('checkout', '-q', 'main');

const approvalPath = path.join(root, 'approval.json');
fs.writeFileSync(approvalPath, serialize(approval0));
const labelPath = path.join(root, 'label.txt');
fs.writeFileSync(labelPath, 'THE NEW LABEL\n');

function args(over = {}) {
  const a = {
    approval: approvalPath, repo, candidate: C, 'ops-head': OPS,
    'run-id': '1001', 'run-number': '7', 'run-main': RUN_MAIN, 'run-date': '2026-02-02',
    'inventory-before': '3', 'inventory-after': '3', created: 'none',
    verify: 'pass', 'hosted-marker': 'true', 'hosted-verify': 'pass',
    'label-file': labelPath, 'accepted-on': '2026-02-01', out: path.join(root, 'out.json'),
    ...over,
  };
  return Object.entries(a).filter(([, v]) => v !== undefined).flatMap(([k, v]) => [`--${k}`, v]);
}
function run(over) {
  const out = (over && over.out) || path.join(root, 'out.json');
  fs.rmSync(out, { force: true });
  const r = spawnSync(process.execPath, [GEN, ...args(over)], { encoding: 'utf8' });
  const written = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null;
  return { code: r.status, out: r.stdout, err: r.stderr, text: written, json: written && JSON.parse(written) };
}

// ---- the ordinary forward pin ---------------------------------------------------------
test('a forward pin with nothing protected changed is generated and fast-path eligible', () => {
  const r = run();
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.approvedAppSha, C);
  assert.equal(r.json.packageLabel, 'THE NEW LABEL');
  assert.equal(r.json.sourceAcceptedOn, '2026-02-01');
  assert.equal(r.json.expectedPriorFunctions, 3);
  assert.deepEqual(r.json.candidateAddedFunctions, ['wsfgamma']);
  assert.equal(r.json._other, 'kept');
  const inv = r.json._pinInvariants;
  assert.equal(inv.fastPath.eligible, true, inv.fastPath.reasons.join('\n'));
  assert.equal(inv.fastPath.applies, false, 'recording eligibility must never switch the fast path on');
  assert.deepEqual(inv.protectedPathDelta, []);
  assert.deepEqual(inv.exportCount, { previous: 3, candidate: 3 });
  assert.match(r.out, /PIN_FAST_PATH=eligible/);
});

test('history rotates into _previous*<sha8> keys at the documented positions', () => {
  const r = run();
  const p8 = P.slice(0, 8);
  assert.deepEqual(Object.keys(r.json), [
    '_comment', 'project', 'approvedAppSha', 'packageLabel', 'sourceAcceptedOn', 'expectedPriorFunctions',
    'candidateAddedFunctions', '_rollbackNote', '_expectedPriorFunctionsNote', `_previousExpectedPriorFunctionsNote${p8}`,
    '_fullCandidateNote', `_previousFullCandidateNote${p8}`, '_other', `_previousPackageLabel${p8}`, '_pinInvariants',
  ]);
  assert.equal(r.json[`_previousPackageLabel${p8}`],
    `HISTORICAL, the label of the ${p8} pin, which run 7 (1001) deployed 3 -> 3 with CREATED_THIS_DEPLOY=none and VERIFY=pass: PREVIOUS LABEL`);
  assert.equal(r.json[`_previousExpectedPriorFunctionsNote${p8}`], `HISTORICAL, the note as it stood for the ${p8} pin, true until run 7 deployed it: old prior note`);
  assert.equal(r.json[`_previousFullCandidateNote${p8}`], `HISTORICAL, the boundary note for the ${p8} pin: old boundary note`);
});

test('the boundary note is git-derived: commits, files, routes (added, modified, renamed) and the protected paths', () => {
  const n = run().json._fullCandidateNote;
  assert.match(n, new RegExp(`^${C} is measured against ${P}`));
  assert.match(n, /ONE first-parent commit \([0-9a-f]{8}\); 1 commit in all; 5 files, /);
  assert.match(n, /1 of them under docs\//);
  assert.match(n, /added app\/new-route\.tsx; modified app\/\(tabs\)\/you\.tsx; removed or renamed app\/old\.tsx \(renamed to app\/renamed\.tsx\)\./);
  assert.match(n, /git diff over the protected paths is EMPTY/);
  for (const p of PROTECTED_PATHS) assert.ok(n.includes(p), `the note must name ${p}`);
});

test('the output is deterministic and in the approval file\'s own format', () => {
  const a = run().text;
  const b = run().text;
  assert.equal(a, b);
  assert.equal(`${JSON.stringify(JSON.parse(a), null, 2)}\n`, a);
});

// ---- conditions that leave the fast path (generated, but flagged) -----------------------
const reasons = (over) => { const r = run(over); assert.equal(r.code, 0, r.err); return r.json._pinInvariants.fastPath; };

test('a protected-path change leaves the fast path and is named', () => {
  const f = reasons({ candidate: C_PROTECTED });
  assert.equal(f.eligible, false);
  assert.ok(f.reasons.includes('protected paths changed: firestore.indexes.json'), f.reasons.join('\n'));
  assert.match(run({ candidate: C_PROTECTED }).json._fullCandidateNote, /is NOT EMPTY \(1 file\): firestore\.indexes\.json/);
});

test('a function-source change leaves the fast path, and the notes stop promising 3 -> 3', () => {
  const r = run({ candidate: C_FUNCTIONS });
  const f = r.json._pinInvariants.fastPath;
  assert.equal(f.eligible, false);
  for (const want of ['the functions-westayfit tree changed', 'the exported function set changed', 'the candidate\'s exports are not the verifier\'s expected set']) {
    assert.ok(f.reasons.includes(want), `missing: ${want}`);
  }
  assert.doesNotMatch(r.json._expectedPriorFunctionsNote, /EXPECTED TO CREATE NOTHING/);
  assert.match(r.json._expectedPriorFunctionsNote, /CHANGES THE FUNCTION SOURCE/);
  assert.match(r.json._rollbackNote, /CHANGES the functions-westayfit tree/);
});

test('a candidate that does not descend from the served pin leaves the fast path', () => {
  const r = run({ candidate: C_SIDE });
  assert.ok(r.json._pinInvariants.fastPath.reasons.some((x) => x.startsWith('lineage:')));
  assert.match(r.json._fullCandidateNote, /is NOT an ancestor/);
});

test('a release-environment change since the serving run leaves the fast path; an approval-only change does not', () => {
  const f = reasons({ 'ops-head': OPS_CHANGED });
  assert.ok(f.reasons.includes('the release environment changed since run 7: .github/wsf-staging/other.mjs'), f.reasons.join('\n'));
  assert.equal(reasons({ 'ops-head': OPS_APPROVAL_ONLY }).eligible, true);
});

test('without --ops-head the release environment is unmeasured, which is not eligible', () => {
  const f = reasons({ 'ops-head': undefined });
  assert.equal(f.eligible, false);
  assert.ok(f.reasons.includes('the release environment was not measured (no --ops-head)'));
});

test('a serving run that created functions or moved the inventory leaves the fast path', () => {
  const f = reasons({ created: 'wsfgamma', 'inventory-after': '4' });
  assert.ok(f.reasons.includes('the last run created functions (wsfgamma)'));
  assert.ok(f.reasons.includes('the last run changed the inventory (3 -> 4)'));
  assert.ok(f.reasons.includes('the verifier\'s expected set (3) is not the run\'s AFTER (4)'));
});

// ---- refusals: exit 1, nothing written ---------------------------------------------------
const REFUSALS = [
  ['a run that did not verify', { verify: 'fail' }, /VERIFY=pass/],
  ['a run that did not observe its hosted marker', { 'hosted-marker': 'false' }, /hosted marker/],
  ['a run whose hosted verification failed', { 'hosted-verify': 'fail' }, /hosted verification/],
  ['re-pinning the SHA already approved', { candidate: P }, /nothing to pin/],
  ['a candidate that is not a commit here', { candidate: 'a'.repeat(40) }, /is not a commit/],
  ['a short SHA', { candidate: C.slice(0, 8) }, /40-character/],
  ['a run main with no approval file', { 'run-main': B0 }, /no readable approval file at run main/],
  ['a run whose main approved a different SHA', { 'run-main': RUN_MAIN_OTHER }, /that run did not deploy the pin this file replaces/],
  ['a BEFORE that read-inventory would have refused', { 'inventory-before': '2' }, /read-inventory would have refused/],
  ['a malformed created list', { created: 'wsfA,x' }, /--created/],
  ['a missing flag', { 'run-id': undefined }, /--run-id is required/],
];
for (const [name, over, re] of REFUSALS) {
  test(`REFUSED: ${name}`, () => {
    const r = run(over);
    assert.equal(r.code, 1, `expected a refusal: ${r.out}`);
    assert.match(r.err, re);
    assert.match(r.err, /PIN=refused/);
    assert.equal(r.text, null, 'a refusal must not write the output');
  });
}

test('REFUSED: an unknown flag', () => {
  const r = spawnSync(process.execPath, [GEN, ...args(), '--force', 'yes'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown argument/);
});

test('REFUSED: a multi-line label', () => {
  const bad = path.join(root, 'bad-label.txt');
  fs.writeFileSync(bad, 'one\ntwo\n');
  const r = run({ 'label-file': bad });
  assert.equal(r.code, 1);
  assert.match(r.err, /one non-empty line/);
});

test('REFUSED: rotating the same pin out twice', () => {
  const twice = path.join(root, 'rotated.json');
  fs.writeFileSync(twice, serialize({ ...approval0, [`_previousPackageLabel${P.slice(0, 8)}`]: 'x' }));
  const r = run({ approval: twice });
  assert.equal(r.code, 1);
  assert.match(r.err, /rotated out once/);
});

// ---- helpers ----------------------------------------------------------------------------
test('exportedFunctions counts callables only, and refuses to guess past a re-export', () => {
  assert.deepEqual(exportedFunctions(fn(['wsfB', 'wsfA'])), ['wsfa', 'wsfb']);
  assert.equal(exportedFunctions(`${fn(['wsfA'])}export { x } from './y';\n`), null);
  assert.equal(exportedFunctions(`${fn(['wsfA'])}export * from './y';\n`), null);
  assert.equal(exportedFunctions(null), null);
});

test('verifierBase reads the array literal and ignores quoted words in comments', () => {
  assert.deepEqual(verifierBase(VERIFIER), ['wsfalpha', 'wsfbeta']);
  assert.equal(verifierBase('const OTHER = [];'), null);
});

test('on this branch, the verifier base plus candidateAddedFunctions equals expectedPriorFunctions', () => {
  const base = verifierBase(fs.readFileSync(path.resolve('.github/wsf-staging/verify-deployment.mjs'), 'utf8'));
  const approval = JSON.parse(fs.readFileSync(path.resolve('.github/wsf-staging/approved-candidate.json'), 'utf8'));
  assert.equal(base.length + approval.candidateAddedFunctions.length, approval.expectedPriorFunctions);
});

// ---- golden: replay #508 from #502 ---------------------------------------------------------
test('GOLDEN: replaying pin 74d19281 from pin 14ce1907 with run 51 reproduces the machine fields, order and rotation', () => {
  const before = fs.readFileSync(path.join(FIX, 'pin-14ce1907.json'), 'utf8');
  const after = fs.readFileSync(path.join(FIX, 'pin-74d19281.json'), 'utf8');
  assert.equal(serialize(JSON.parse(before)), before, 'the fixture is in the file\'s own format');
  assert.equal(serialize(JSON.parse(after)), after);
  const prev = JSON.parse(before);
  const want = JSON.parse(after);

  // The facts git measured for this pin (the boundary note of #508 and a real
  // run of the generator agree on them): 49 callables at both SHAs, tree 5a3f232e.
  const base = Array.from({ length: 46 }, (_, i) => `wsfn${String(i).padStart(2, '0')}`);
  const names = [...base, ...prev.candidateAddedFunctions].sort();
  const tree = '5a3f232ebe87026c48cee0c2a023c02a1a96e8f1';
  const m = {
    ancestor: true, firstParent: ['993f0796', '87997c58', '87a86531', '74d19281'].map((s) => s.padEnd(40, '0')), commits: 39,
    files: 211, added: 9844, deleted: 1157, docs: 182, routes: { added: [], modified: [], removed: [] },
    protectedDelta: [], functionsTree: { previous: tree, candidate: tree },
    exports: { previous: names, candidate: names },
    verifier: { ref: '32563aa0443ab43f70538d0545b6c0578f5d13c2', base },
    releaseEnvironment: { from: '32563aa0443ab43f70538d0545b6c0578f5d13c2', to: 'bc53a787d38ed39e6b13550f8ee80cfca914dde5', delta: [] },
  };
  const got = nextApproval(prev, {
    candidate: want.approvedAppSha, label: want.packageLabel, acceptedOn: want.sourceAcceptedOn, m,
    run: { id: 36219503815, number: 51, main: '32563aa0443ab43f70538d0545b6c0578f5d13c2', date: '2026-09-26', before: 49, after: 49, created: 'none' },
  });
  assert.deepEqual(Object.keys(got), [...Object.keys(want), '_pinInvariants']);
  for (const k of Object.keys(want)) {
    if (k === '_fullCandidateNote') continue;
    if (k === '_rollbackNote') {
      assert.equal(got[k], want[k].replace(' The earlier known-good 0b460ce3 (run 50) is equally compatible.', ''), k);
      continue;
    }
    assert.deepEqual(got[k], want[k], `${k} differs from the merged pin`);
  }
  assert.equal(got._pinInvariants.fastPath.eligible, true, got._pinInvariants.fastPath.reasons.join('\n'));
});

console.log(`\npin-candidate: ${passed} passed`);
