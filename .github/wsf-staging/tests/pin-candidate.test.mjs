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
import { targetTitle } from '../../../tools/wsf-control/fastpath.mjs';

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

// C1: operational heads that each change exactly one kind of thing since the serving run.
const MANIFEST_REL = '.github/wsf-staging/journeys/manifest.json';
const manifestFor = (productSha, over = {}) => JSON.stringify({
  schemaVersion: 1, milestone: 'FIXTURE-MILESTONE-1', productSha, previousKnownGoodSha: P,
  journeys: [{ id: 'community', entry: '/community', setup: 's', actions: ['open'], expected: ['shown'], knownExclusions: [] }], ...over,
});
const opsBranch = (name, files) => {
  g('checkout', '-q', '-b', name, OPS);
  for (const [rel, body] of Object.entries(files)) write(rel, body);
  return commit(name);
};
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
// A ledger fast-path run served S (a descendant of the pin P) while the
// operational main's approval still named P; CS is the next candidate on S.
g('checkout', '-q', '-b', 'served', P);
write('apps/westayfit/app/(tabs)/you.tsx', 'you served\n');
const S = commit('the ledger-served target');
write('apps/westayfit/app/new-route.tsx', 'after served\n');
const CS = commit('the candidate after the served target');
g('checkout', '-q', '-b', 'served-prot', P);
write('firestore.indexes.json', '{"served":true}\n');
const S_PROT = commit('a served target that touched an index file');
write('apps/westayfit/app/x.tsx', 'x\n');
const CS_PROT = commit('candidate after it');
const OPS_MANIFEST_ONLY = opsBranch('ops-manifest-only', { [MANIFEST_REL]: manifestFor(C) });
const OPS_STALE_MANIFEST = opsBranch('ops-stale-manifest', { [MANIFEST_REL]: manifestFor(P.replace(/./, (c) => (c === 'a' ? 'b' : 'a'))) });
const OPS_DRIVER = opsBranch('ops-driver', { '.github/wsf-staging/journeys/community.mjs': 'export const community = 1;\n' });
const OPS_REGISTRY = opsBranch('ops-registry', { '.github/wsf-staging/journeys/index.mjs': 'export const drivers = {};\n' });
const OPS_WORKFLOW = opsBranch('ops-workflow', { '.github/workflows/wsf-staging-deploy.yml': 'name: changed\n' });
const OPS_TOOL = opsBranch('ops-tool', { '.github/wsf-staging/hosted-changed-journeys.mjs': '// changed\n' });
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
    'run-title': 'WSF staging · mode=deploy',
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

// ---- C1: the manifest is release DATA; the code around it is not ----------------------------
test('C1: an operational head that changes ONLY the milestone manifest stays fast-path eligible', () => {
  const r = run({ 'ops-head': OPS_MANIFEST_ONLY });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json._pinInvariants.fastPath.eligible, true, r.json._pinInvariants.fastPath.reasons.join('\n'));
  assert.deepEqual(r.json._pinInvariants.releaseEnvironment.delta, []);
  assert.deepEqual(r.json._pinInvariants.milestone, { declared: 'at operational head', milestone: 'FIXTURE-MILESTONE-1', journeys: ['community'] });
});

for (const [name, head, file] of [
  ['a driver', () => OPS_DRIVER, '.github/wsf-staging/journeys/community.mjs'],
  ['the driver registry', () => OPS_REGISTRY, '.github/wsf-staging/journeys/index.mjs'],
  ['the workflow', () => OPS_WORKFLOW, '.github/workflows/wsf-staging-deploy.yml'],
  ['the smoke runner', () => OPS_TOOL, '.github/wsf-staging/hosted-changed-journeys.mjs'],
]) {
  test(`C1: an operational head that changes ${name} leaves the fast path, named`, () => {
    const f = reasons({ 'ops-head': head() });
    assert.equal(f.eligible, false);
    assert.ok(f.reasons.includes(`the release environment changed since run 7: ${file}`), f.reasons.join('\n'));
  });
}

test('C1: a stale manifest at the operational head is refused unless this pin supplies or withdraws one', () => {
  const r = run({ 'ops-head': OPS_STALE_MANIFEST });
  assert.equal(r.code, 1);
  assert.match(r.err, /pass --manifest <file> for [0-9a-f]{8}, or --manifest none/);
  const none = run({ 'ops-head': OPS_STALE_MANIFEST, manifest: 'none' });
  assert.equal(none.code, 0, none.err);
  assert.deepEqual(none.json._pinInvariants.milestone, { declared: 'none', removesManifestAtOpsHead: true });
  const file = path.join(root, 'next-manifest.json');
  fs.writeFileSync(file, manifestFor(C));
  const supplied = run({ 'ops-head': OPS_STALE_MANIFEST, manifest: file });
  assert.equal(supplied.code, 0, supplied.err);
  assert.equal(supplied.json._pinInvariants.milestone.declared, 'supplied');
});

test('C1: a supplied manifest is checked exactly as the pre-deploy gate will check it, plus its rollback SHA', () => {
  const bad = (name, body, re) => {
    const file = path.join(root, `${name}.json`);
    fs.writeFileSync(file, body);
    const r = run({ manifest: file });
    assert.equal(r.code, 1, `${name} should be refused`);
    assert.match(r.err, re);
    assert.equal(r.text, null);
  };
  bad('wrong-product', manifestFor(C_PROTECTED), /would be refused before deploy: the manifest is for/);
  bad('no-driver', manifestFor(C, { journeys: [{ id: 'kiosk', entry: '/k', setup: 's', actions: ['a'], expected: ['e'], knownExclusions: [] }] }), /no registered driver for journey kiosk/);
  bad('wrong-rollback', manifestFor(C, { previousKnownGoodSha: B0 }), /previousKnownGoodSha is [0-9a-f]{40}, not the served pin/);
  bad('invalid', manifestFor(C, { extra: 1 }), /unknown key "extra"/);
});

test('with no manifest anywhere, the pin declares no member-visible milestone', () => {
  assert.deepEqual(run().json._pinInvariants.milestone, { declared: 'none', removesManifestAtOpsHead: false });
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

// ---- STAGING-PIN-FASTPATH-SERVED-BASELINE-1: a ledger-served baseline ----------------------
const LEDGER = (served, over = {}) => ({ candidate: CS, 'run-title': targetTitle(served), 'served-sha': served, 'run-marker': served, ...over });

test('SERVED: a ledger run serving S over the pin P rolls back to S, keeps P as history, and never says the run deployed P', () => {
  const r = run(LEDGER(S));
  assert.equal(r.code, 0, r.err);
  const j = r.json;
  const [p8, s8] = [P.slice(0, 8), S.slice(0, 8)];
  assert.equal(j.approvedAppSha, CS);
  assert.ok(j._rollbackNote.startsWith(`ROLLBACK TARGET (Director #365 5841628546). The previous known-good served app SHA is ${S}: ` +
    `run 7 (1001) served it in ledger fast-path mode (run title "${targetTitle(S)}", its verifier checking ${S}), dispatched from ` +
    `operational main ${RUN_MAIN}, whose approval still named the historical pin ${P}; that run did not deploy the pin. It printed INVENTORY_BEFORE=3`), j._rollbackNote);
  assert.match(j._rollbackNote, new RegExp(`re-pinning ${s8} is compatible`));
  assert.match(j._expectedPriorFunctionsNote, new RegExp(`served ${s8} in ledger fast-path mode over the historical pin ${p8}`));
  assert.ok(j._fullCandidateNote.startsWith(`${CS} is measured against ${S}, the SHA run 7 (1001) served in ledger fast-path mode`), j._fullCandidateNote);
  assert.ok(j._fullCandidateNote.includes(`previously approved, ${P}, is historical approval ancestry only: that run did not deploy it.`));
  assert.match(j._fullCandidateNote, /ONE first-parent commit \([0-9a-f]{8}\); 1 commit in all;/);
  assert.ok(j._fullCandidateNote.includes(`Against the historical pin ${p8} (an ancestor of ${s8}): TWO first-parent commits`));
  // The rotation still retires the pin this file approved, and says the run did not deploy it.
  assert.equal(j[`_previousPackageLabel${p8}`], `HISTORICAL, the label of the ${p8} pin, which run 7 (1001) did not deploy: that run served ${s8} in ledger fast-path mode, 3 -> 3 with CREATED_THIS_DEPLOY=none and VERIFY=pass: PREVIOUS LABEL`);
  assert.equal(j[`_previousExpectedPriorFunctionsNote${p8}`], `HISTORICAL, the note as it stood for the ${p8} pin, which run 7 did not deploy (it served ${s8} in ledger fast-path mode): old prior note`);
  for (const bad of ['run 7 (1001) deployed', 'true until run 7 deployed', `${P}, the SHA this file previously approved, which run 7`, `served app SHA is ${P}`]) {
    assert.equal(r.text.includes(bad), false, `the output must not say: ${bad}`);
  }
  const inv = j._pinInvariants;
  assert.equal(inv.previousApprovedAppSha, P);
  assert.equal(inv.run.mode, 'ledger');
  assert.equal(inv.run.servedAppSha, S);
  assert.equal(inv.run.verifiedMarker, S);
  assert.equal(inv.run.title, targetTitle(S));
  assert.equal(inv.servedBaseline.servedAppSha, S);
  assert.equal(inv.servedBaseline.rollbackTarget, S);
  assert.equal(inv.servedBaseline.historicalPin, P);
  assert.equal(inv.lineage.commits, 1);
  assert.equal(inv.servedBaseline.pinLineage.commits, 2);
  assert.deepEqual(inv.servedBaseline.pinLineage.protectedPathDelta, []);
  assert.equal(inv.fastPath.eligible, true, inv.fastPath.reasons.join('\n'));
  assert.ok(r.out.includes(`PIN_PREVIOUS=${P}\nPIN_SERVED=${S}\nPIN_ROLLBACK=${S}\n`), r.out);
  assert.equal(run(LEDGER(S)).text, r.text, 'deterministic');
});

test('SERVED: a protected change between the pin and the served SHA leaves the fast path, named against the pin', () => {
  const r = run(LEDGER(S_PROT, { candidate: CS_PROT }));
  assert.equal(r.code, 0, r.err);
  const f = r.json._pinInvariants.fastPath;
  assert.deepEqual(r.json._pinInvariants.protectedPathDelta, [], 'served -> candidate is clean');
  assert.ok(f.reasons.includes(`historical pin ${P.slice(0, 8)}: protected paths changed: firestore.indexes.json`), f.reasons.join('\n'));
  assert.equal(f.eligible, false);
  assert.match(r.json._fullCandidateNote, /protected-path diff NOT EMPTY: firestore\.indexes\.json/);
});

test('SERVED: a milestone manifest rolls back to the served SHA, not the historical pin', () => {
  const ok = path.join(root, 'served-manifest.json');
  fs.writeFileSync(ok, manifestFor(CS, { previousKnownGoodSha: S }));
  const r = run(LEDGER(S, { manifest: ok }));
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json._pinInvariants.milestone.declared, 'supplied');
  const stale = path.join(root, 'served-manifest-pin.json');
  fs.writeFileSync(stale, manifestFor(CS));
  const bad = run(LEDGER(S, { manifest: stale }));
  assert.equal(bad.code, 1);
  assert.ok(bad.err.includes(`previousKnownGoodSha is ${P}, not the served pin ${S}`), bad.err);
});

test('FULL PATH unchanged: the pin-mode title, the pre-run-59 title, and an explicit served = pin are byte-identical', () => {
  const base = run().text;
  assert.ok(base);
  assert.equal(run({ 'run-title': 'WSF staging deploy' }).text, base);
  assert.equal(run({ 'served-sha': P, 'run-marker': P }).text, base);
  assert.doesNotMatch(base, /ledger|servedBaseline/);
  assert.doesNotMatch(run().out, /PIN_SERVED|PIN_ROLLBACK/);
});

const SERVED_REFUSALS = [
  ['no run title', { 'run-title': undefined }, /--run-title is required/],
  ['a ledger run with no served baseline (the reported defect)', { candidate: CS, 'run-title': targetTitle(S) }, new RegExp(`run served ${S} in ledger fast-path mode, not the pin ${P}: pass --served-sha`)],
  ['a served SHA that is not the title target', LEDGER(S, { 'served-sha': CS }), /is not the run title's target/],
  ['no run marker', LEDGER(S, { 'run-marker': undefined }), /needs --run-marker/],
  ['a marker that is not the served SHA', LEDGER(S, { 'run-marker': P }), /the run's marker did not observe it/],
  ['a ledger target that is the pin itself', { 'run-title': targetTitle(P), 'served-sha': P, 'run-marker': P }, /ambiguous/],
  ['a served SHA that does not descend from the pin', LEDGER(C_SIDE, { candidate: C_SIDE }), /is not an ancestor of the served SHA/],
  ['a candidate that does not descend from the served SHA', LEDGER(S, { candidate: C }), /is not an ancestor of the candidate/],
  ['a served SHA that is not a commit', LEDGER('b'.repeat(40)), /is not a commit/],
  ['a non-deploy run title', { 'run-title': 'WSF staging · mode=player-journey' }, /not a WSF staging deploy-mode run title/],
  ['a short title target', { 'run-title': `WSF staging · mode=deploy · target=${S.slice(0, 8)}`, 'served-sha': S, 'run-marker': S }, /does not name a full 40-character target/],
  ['a title with trailing text', { 'run-title': `${targetTitle(S)} `, 'served-sha': S, 'run-marker': S }, /does not name a full 40-character target/],
  ['a full-path title with another served SHA', { 'served-sha': S }, /serves the pin/],
  ['a full-path title with another marker', { 'run-marker': S }, /checks the pin/],
  ['a malformed served SHA', LEDGER(S, { 'served-sha': 'xyz' }), /--served-sha must be a full 40-character/],
  ['a ledger run whose main approved a different SHA', LEDGER(S, { 'run-main': RUN_MAIN_OTHER }), /that run did not deploy the pin this file replaces/],
  ['a ledger run whose BEFORE is not the pin prior', LEDGER(S, { 'inventory-before': '2' }), /read-inventory would have refused/],
  ['a ledger run that did not verify', LEDGER(S, { verify: 'fail' }), /VERIFY=pass/],
  ['a ledger run whose hosted marker was not observed', LEDGER(S, { 'hosted-marker': 'false' }), /hosted marker/],
  ['a ledger run whose hosted verification failed', LEDGER(S, { 'hosted-verify': 'fail' }), /hosted verification/],
];
for (const [name, over, re] of SERVED_REFUSALS) {
  test(`REFUSED (served baseline): ${name}`, () => {
    const r = run(over);
    assert.equal(r.code, 1, `expected a refusal: ${r.out}`);
    assert.match(r.err, re);
    assert.match(r.err, /PIN=refused/);
    assert.equal(r.text, null, 'a refusal must not write the output');
  });
}

test('REFUSED (served baseline): nextApproval rejects a served baseline for a different pin', () => {
  assert.throws(() => nextApproval(approval0, { candidate: CS, run: {}, label: 'x', acceptedOn: '2026-01-01', m: {}, served: { sha: S, pin: B0, title: '', marker: S, mPin: {} } }), /does not name this file's pin/);
});

// ---- the real topology: pin a3127651, served ab77fbfc (run 60, ledger mode), candidate 5705dc3b --
test('REAL TOPOLOGY: run 60 served ab77fbfc over the pin a3127651; the 5705dc3b pin rolls back to ab77fbfc and keeps a3127651 as history', () => {
  const PIN = 'a31276516e786ac8f848269de4c839b3b9e13123';
  const SERVED = 'ab77fbfce97e60c1c22492397b2ab6b491f9e0db';
  const CAND = '5705dc3bf198a9490600c7e32b8bb55356defd9d';
  const MAIN = 'b4b479a62d380edfe3f792bfa6e6090d4979f9c4';
  const OPSH = '9ca268d2500c60dddc3aba8d490a67f24b97a2cb';
  const added = ['wsfsetcommunityvisibility', 'wsfcommunitymembers', 'wsfcommunityactivity'];
  const prev = {
    _comment: ['fixture'], project: 'westayfit-staging', approvedAppSha: PIN, packageLabel: 'THE a3127651 LABEL',
    sourceAcceptedOn: '2026-09-27', expectedPriorFunctions: 49, candidateAddedFunctions: added,
    _rollbackNote: 'r', _expectedPriorFunctionsNote: 'e', _fullCandidateNote: 'f',
  };
  // Measured with this generator's measure() on the real repository (both lineages are clean).
  const base = Array.from({ length: 46 }, (_, i) => `wsfn${String(i).padStart(2, '0')}`);
  const names = [...base, ...added].sort();
  const tree = '5a3f232ebe87026c48cee0c2a023c02a1a96e8f1';
  const common = {
    ancestor: true, protectedDelta: [], functionsTree: { previous: tree, candidate: tree }, exports: { previous: names, candidate: names },
    verifier: { ref: OPSH, base }, releaseEnvironment: { from: MAIN, to: OPSH, delta: [] },
  };
  const m = { ...common, firstParent: [CAND], commits: 3, files: 4, added: 477, deleted: 25, docs: 0, routes: { added: [], modified: ['app/event/[goalId].tsx'], removed: [] } };
  const mPin = { ...common, firstParent: ['9a506766dce251fd500c2a93ca0ccafd7c847690', SERVED, CAND], commits: 42, files: 26, added: 2080, deleted: 306, docs: 17,
    routes: { added: [], modified: ['app/(tabs)/(home)/community/[groupId]/index.tsx', 'app/event/[goalId].tsx', 'app/station/[goalId].tsx'], removed: [] } };
  const run60 = { id: 37025084843, number: 60, main: MAIN, date: '2026-10-02', before: 49, after: 49, created: 'none' };
  const served = { sha: SERVED, pin: PIN, title: targetTitle(SERVED), marker: SERVED, mPin };
  const got = nextApproval(prev, { candidate: CAND, run: run60, label: 'L', acceptedOn: '2026-10-02', m, served });
  const text = serialize(got);
  assert.equal(got.approvedAppSha, CAND);
  assert.equal(got.expectedPriorFunctions, 49);
  assert.ok(got._rollbackNote.startsWith(`ROLLBACK TARGET (Director #365 5841628546). The previous known-good served app SHA is ${SERVED}: run 60 (37025084843) served it in ledger fast-path mode (run title "WSF staging · mode=deploy · target=${SERVED}"`), got._rollbackNote);
  assert.ok(got._rollbackNote.includes(`whose approval still named the historical pin ${PIN}; that run did not deploy the pin. It printed INVENTORY_BEFORE=49, INVENTORY_AFTER=49, CREATED_THIS_DEPLOY=none, HOSTED_MARKER_MATCHES=true and VERIFY=pass`));
  assert.ok(got._rollbackNote.includes('the functions-westayfit tree is 5a3f232e at both SHAs), so re-pinning ab77fbfc is compatible with the live 49-function inventory'));
  assert.ok(got._expectedPriorFunctionsNote.startsWith('49, the measured live inventory. Run 37025084843 (run 60, 2026-10-02, served ab77fbfc in ledger fast-path mode over the historical pin a3127651 from main b4b479a6)'), got._expectedPriorFunctionsNote);
  assert.ok(got._expectedPriorFunctionsNote.includes("THIS PIN'S DEPLOY IS EXPECTED TO CREATE NOTHING (49 -> 49, CREATED_THIS_DEPLOY=none)"));
  assert.ok(got._expectedPriorFunctionsNote.includes('the 46-name base plus the three names in candidateAddedFunctions'));
  assert.ok(got._fullCandidateNote.startsWith(`${CAND} is measured against ${SERVED}, the SHA run 60 (37025084843) served in ledger fast-path mode`));
  assert.ok(got._fullCandidateNote.includes('ONE first-parent commit (5705dc3b); 3 commits in all; 4 files, +477 / -25, 0 of them under docs/'));
  assert.ok(got._fullCandidateNote.includes('Against the historical pin a3127651 (an ancestor of ab77fbfc): THREE first-parent commits (9a506766, ab77fbfc, 5705dc3b); 42 commits in all; 26 files, +2080 / -306, 17 of them under docs/; protected-path diff EMPTY; functions-westayfit tree 5a3f232e at both SHAs.'));
  assert.equal(got._previousPackageLabela3127651, 'HISTORICAL, the label of the a3127651 pin, which run 60 (37025084843) did not deploy: that run served ab77fbfc in ledger fast-path mode, 49 -> 49 with CREATED_THIS_DEPLOY=none and VERIFY=pass: THE a3127651 LABEL');
  for (const bad of ['run 60 (37025084843) deployed', 'true until run 60 deployed', `${PIN}, the SHA this file previously approved, which run 60`, `served app SHA is ${PIN}`]) {
    assert.equal(text.includes(bad), false, `must not say: ${bad}`);
  }
  const inv = got._pinInvariants;
  assert.equal(inv.previousApprovedAppSha, PIN);
  assert.equal(inv.servedBaseline.rollbackTarget, SERVED);
  assert.deepEqual(inv.run, { id: 37025084843, number: 60, operationalMain: MAIN, inventoryBefore: 49, inventoryAfter: 49, created: 'none',
    verify: 'pass', hostedMarkerMatches: true, hostedVerify: 'pass', mode: 'ledger', title: targetTitle(SERVED), servedAppSha: SERVED, verifiedMarker: SERVED });
  assert.deepEqual(inv.lineage, { previousIsAncestor: true, firstParentCommits: [CAND], commits: 3 });
  assert.equal(inv.servedBaseline.pinLineage.commits, 42);
  assert.deepEqual(inv.exportCount, { previous: 49, candidate: 49 });
  assert.equal(inv.fastPath.eligible, true, inv.fastPath.reasons.join('\n'));
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
