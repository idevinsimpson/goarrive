#!/usr/bin/env node
/**
 * W5 — SHA-independent pre-review harness for pin PR #452
 * (`claude/wsf-staging-pin-f2f901a`, reviewed at
 * ed8649ecb65e96d4ce2d2e9d99d8c533a14ee94c; released by L0 #395 5801807119).
 *
 * What it proves, on scratch copies of the tree (the checkout is never edited):
 *
 *   A  the verify-deployment suite as shipped passes, and each of its new
 *      guards fails when the thing it guards is broken (mutation rows);
 *   B  the 16 legacy base-contract cases are ISOLATED from the live approval
 *      (a live approval they must not see does not move them), and the
 *      restructure was NECESSARY (the old wiring fails them on this approval);
 *   C  BEFORE and AFTER stay distinct evidence, and a retaining rollback works
 *      only with candidateAddedFunctions kept — driven through the real
 *      verifier and the real read-inventory, not asserted from the notes;
 *   D  resolve-candidate resolves the live file and refuses anything else.
 *
 * Every row is CONTROL: a row that does not behave as stated exits 2.
 *
 * Usage (read-only; writes only to its own temp dirs, which it removes):
 *   ROOT=<a git checkout of the pin head, or of its merge onto main> \
 *   node docs/westayfit/qa/sprint-w5-pin-452-preview-verify.mjs
 *
 * No network beyond 127.0.0.1 mocks, no credential, no cloud call.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

const ROOT = process.env.ROOT;
if (!ROOT || !fs.existsSync(path.join(ROOT, '.github/wsf-staging/verify-deployment.mjs'))) {
  console.error('ROOT must be a checkout containing .github/wsf-staging/verify-deployment.mjs');
  process.exit(2);
}
const HEAD = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD']).toString().trim();
const TEST = '.github/wsf-staging/tests/verify-deployment.test.mjs';
const APPROVAL = '.github/wsf-staging/approved-candidate.json';
const SOCIAL = ['wsfsetcommunityvisibility', 'wsfcommunitymembers', 'wsfcommunityactivity'];
const temps = [];
const rows = [];

function copyTree() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'w5-pin-'));
  temps.push(d);
  execFileSync('sh', ['-c', `git -C "${ROOT}" archive HEAD .github | tar -x -C "${d}"`]);
  return d;
}
function runSuite(dir) {
  const r = spawnSync(process.execPath, [TEST], { cwd: dir, encoding: 'utf8', timeout: 180000 });
  const ok = (r.stdout.match(/^ {2}ok {2}(.*)$/gm) || []).map((l) => l.replace(/^ {2}ok {2}/, ''));
  const total = (r.stdout.match(/verify-deployment: (\d+) passed/) || [])[1];
  const firstErr = (r.stderr.match(/AssertionError[^\n]*\n[^\n]*/) || [''])[0].replace(/\s+/g, ' ').slice(0, 160);
  return { code: r.status, ok, total: total ? Number(total) : null, firstErr, out: r.stdout, err: r.stderr };
}
function editJson(dir, rel, f) {
  const p = path.join(dir, rel);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  f(j);
  fs.writeFileSync(p, JSON.stringify(j, null, 2));
}
function row(id, what, expect, got, pass) {
  rows.push({ id, what, expect, got, pass });
}

// ---------------------------------------------------------------- A: as shipped
const base = runSuite(copyTree());
const LEGACY = base.ok.slice(0, 16);
row('A0', 'suite as shipped', 'exit 0, 30 passed', `exit ${base.code}, ${base.total} passed`, base.code === 0 && base.total === 30);

// Guards on the live approval. Each must fail at least one LIVE case and no
// legacy case — a guard that moves a legacy case is not isolated.
const LIVE_MUTANTS = [
  ['A1', 'drop one social name from the live approval', (j) => { j.candidateAddedFunctions = SOCIAL.slice(0, 2); }],
  ['A2', 'add a fourth name to the live approval', (j) => { j.candidateAddedFunctions = [...SOCIAL, 'wsfbogusaddition']; }],
  ['A3', 'remove candidateAddedFunctions', (j) => { delete j.candidateAddedFunctions; }],
  ['A4', 'expectedPriorFunctions 46 -> 49', (j) => { j.expectedPriorFunctions = 49; }],
  ['A5', 'approvedAppSha shortened to 7 hex', (j) => { j.approvedAppSha = j.approvedAppSha.slice(0, 7); }],
  ['A6', 'same three names, different order', (j) => { j.candidateAddedFunctions = [...SOCIAL].reverse(); }],
];
for (const [id, what, f] of LIVE_MUTANTS) {
  const d = copyTree();
  editJson(d, APPROVAL, f);
  const r = runSuite(d);
  const legacyIntact = LEGACY.every((n) => r.ok.includes(n));
  const caught = r.code !== 0;
  row(id, what, 'suite FAILS; all 16 legacy cases still pass', `exit ${r.code}; legacy ${LEGACY.filter((n) => r.ok.includes(n)).length}/16; ${r.firstErr || '-'}`, caught && legacyIntact);
}

// ---------------------------------------------------------------- B: isolation / necessity
{
  // B1: the old wiring (legacy cases run beside the LIVE approval) must fail on
  // this approval — otherwise the restructure was unnecessary and the test
  // file's comment would be wrong.
  const d = copyTree();
  const p = path.join(d, TEST);
  const src = fs.readFileSync(p, 'utf8');
  const mutated = src.replace('[opsCheckout(dir, NO_ADDITIONS)]', '[VERIFY]');
  fs.writeFileSync(p, mutated);
  const r = runSuite(d);
  row('B1', 'legacy runner reverted to the LIVE approval (old wiring)', 'suite FAILS at a legacy case', `exit ${r.code}; mutated=${src !== mutated}; ${r.firstErr || '-'}`, src !== mutated && r.code !== 0 && r.ok.length < 16);
}
{
  // B2: the legacy cases must not read the live file at all — make it
  // unreadable garbage; the 16 legacy cases must still pass.
  const d = copyTree();
  fs.writeFileSync(path.join(d, APPROVAL), '{ not json');
  const r = runSuite(d);
  const legacyIntact = LEGACY.every((n) => r.ok.includes(n));
  row('B2', 'live approval replaced by malformed JSON', 'legacy 16/16 pass; live cases fail', `exit ${r.code}; legacy ${LEGACY.filter((n) => r.ok.includes(n)).length}/16`, legacyIntact && r.code !== 0);
}

// ---------------------------------------------------------------- C: evidence and rollback, through the real scripts
{
  const d = copyTree();
  const p = path.join(d, TEST);
  // Appended after the suite's own cases; reuses its mock and helpers.
  const extra = `
const W5 = [];
async function w5(id, f) { try { await f(); W5.push(id + ' OK'); } catch (e) { W5.push(id + ' BROKEN ' + String(e.message).split('\\n')[0]); } }
const all49 = [...ALL, ...SOCIAL];
await w5('C1 live approval, BEFORE 46 / AFTER 49: pass, created = exactly the three, BEFORE stays 46', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'w5v-'));
  const { server, base } = await startMock({ functions: all49, services: all49.map((n) => svc(n)) });
  const r = await runFrom(VERIFY, base, beforeFile(d, ALL), d); server.close();
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /INVENTORY_BEFORE=46/); assert.match(r.out, /EXPECTED_INVENTORY=49/);
  assert.equal(r.receipt.inventory.beforeCount, 46);
  assert.deepEqual(r.receipt.inventory.createdThisDeploy, [...SOCIAL].sort());
});
await w5('C2 live approval, partial deploy (two of three): FAILS naming the missing one', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'w5v-'));
  const got = [...ALL, ...SOCIAL.slice(0, 2)];
  const { server, base } = await startMock({ functions: got, services: got.map((n) => svc(n)) });
  const r = await runFrom(VERIFY, base, beforeFile(d, ALL), d); server.close();
  assert.equal(r.code, 1); assert.match(r.err, new RegExp(SOCIAL[2] + ' absent'));
});
await w5('C3 live approval, three deployed SHUT: VERIFY passes, transport reported (not a working feature)', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'w5v-'));
  const services = all49.map((n) => SOCIAL.includes(n) ? svc(n, { invokerIamDisabled: false }) : svc(n));
  const { server, base } = await startMock({ functions: all49, services });
  const r = await runFrom(VERIFY, base, beforeFile(d, ALL), d); server.close();
  assert.equal(r.code, 0, r.err);
  for (const n of SOCIAL) assert.match(r.out + r.err, new RegExp(n));
});
const RB = { project: 'westayfit-staging', approvedAppSha: SHA, candidateAddedFunctions: SOCIAL, expectedPriorFunctions: 49 };
await w5('C4 retaining rollback (key KEPT, BEFORE 49 / AFTER 49): pass, nothing created', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'w5v-'));
  const { server, base } = await startMock({ functions: all49, services: all49.map((n) => svc(n)) });
  const r = await runFrom(opsCheckout(d, RB), base, beforeFile(d, all49), d); server.close();
  assert.equal(r.code, 0, r.err); assert.match(r.out, /EXPECTED_INVENTORY=49/);
  assert.deepEqual(r.receipt.inventory.createdThisDeploy, []);
});
await w5('C5 rollback with the key REMOVED while the three stay: FAILS as present-but-not-expected', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'w5v-'));
  const { server, base } = await startMock({ functions: all49, services: all49.map((n) => svc(n)) });
  const r = await runFrom(opsCheckout(d, { project: 'westayfit-staging', approvedAppSha: SHA, expectedPriorFunctions: 49 }), base, beforeFile(d, all49), d); server.close();
  assert.equal(r.code, 1); assert.match(r.out, /EXPECTED_INVENTORY=46/);
  for (const n of SOCIAL) assert.match(r.err, new RegExp(n));
});
console.log('W5ROWS ' + JSON.stringify(W5));
`;
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8') + extra);
  const r = runSuite(d);
  const m = r.out.match(/^W5ROWS (.*)$/m);
  const w5 = m ? JSON.parse(m[1]) : [`C* harness did not run: exit ${r.code} ${r.err.slice(0, 200)}`];
  for (const s of w5) {
    const [id] = s.split(' ');
    row(id, s.replace(/ (OK|BROKEN.*)$/, '').slice(id.length + 1), 'as stated', s.endsWith(' OK') ? 'OK' : s.slice(s.indexOf(' BROKEN') + 1), s.endsWith(' OK'));
  }
}
{
  // read-inventory (the BEFORE gate) against the live approval and a rollback approval.
  const d = copyTree();
  const RI = path.join(d, '.github/wsf-staging/read-inventory.mjs');
  const live = path.join(d, APPROVAL);
  const liveJ = JSON.parse(fs.readFileSync(live, 'utf8'));
  // The 46 names, read from the suite's own fixture so they are not retyped here.
  const src = fs.readFileSync(path.join(d, TEST), 'utf8');
  const lists = {};
  for (const k of ['NAMES', 'STATION', 'TURN']) {
    const m = src.match(new RegExp(`const ${k} = \\[([\\s\\S]*?)\\];`));
    lists[k] = [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
  }
  const all46 = [...lists.NAMES, 'wsfsetgoaldisplayauthorization', 'wsfgoalrecentadditions', ...lists.STATION, ...lists.TURN];
  const rb = path.join(d, 'rollback.json');
  fs.writeFileSync(rb, JSON.stringify({ ...liveJ, expectedPriorFunctions: 49 }));
  const cases = [
    ['R1', 'live approval, staging at 46', all46, live, 0],
    ['R2', 'live approval, staging already at 49 (re-dispatch after success)', [...all46, ...SOCIAL], live, 1],
    ['R3', 'live approval, staging at 47 (earlier partial deploy)', [...all46, SOCIAL[0]], live, 1],
    ['R4', 'rollback approval (prior 49), staging at 49', [...all46, ...SOCIAL], rb, 0],
  ];
  row('R0', 'fixture 46-name base derived from the suite', '46 unique names', `${new Set(all46).size}`, new Set(all46).size === 46);
  for (const [id, what, names, appr, want] of cases) {
    const raw = path.join(d, `${id}.raw.json`);
    fs.writeFileSync(raw, JSON.stringify({ result: names.map((id) => ({ id })) }));
    const r = spawnSync(process.execPath, [RI, '0', raw, path.join(d, `${id}.out.json`), appr], { encoding: 'utf8' });
    const line = (r.stdout + r.stderr).split('\n').find((l) => /PREFLIGHT_BEFORE=/.test(l)) || '';
    row(id, `read-inventory: ${what}`, `exit ${want}`, `exit ${r.status}; ${line}`, r.status === want);
  }
}

// ---------------------------------------------------------------- D: resolve-candidate
{
  const d = copyTree();
  const RC = path.join(d, '.github/wsf-staging/resolve-candidate.mjs');
  const live = path.join(d, APPROVAL);
  const sha = JSON.parse(fs.readFileSync(live, 'utf8')).approvedAppSha;
  const run = (env) => spawnSync(process.execPath, [RC, live], { encoding: 'utf8', env: { ...process.env, ...env } });
  const a = run({ WSF_REQUESTED_SHA: '' });
  row('D1', 'resolve-candidate, no request', `CANDIDATE=${sha.slice(0, 7)}…`, `exit ${a.status}; ${(a.stdout.match(/CANDIDATE=\S+/) || [''])[0].slice(0, 20)}`, a.status === 0 && a.stdout.includes(`CANDIDATE=${sha}`));
  const b = run({ WSF_REQUESTED_SHA: sha });
  row('D2', 'resolve-candidate, request = the approved SHA', 'exit 0', `exit ${b.status}`, b.status === 0 && b.stdout.includes(`CANDIDATE=${sha}`));
  const c = run({ WSF_REQUESTED_SHA: 'c8f38e37b6286297d1f401834cd9500a675a2923' });
  row('D3', 'resolve-candidate, request = the old served SHA', 'refused', `exit ${c.status}; ${(c.stderr.match(/CANDIDATE=\S+/) || [''])[0]}`, c.status !== 0);
}

for (const d of temps) fs.rmSync(d, { recursive: true, force: true });

console.log(`W5 #452 pre-review harness — ROOT HEAD ${HEAD}\n`);
for (const r of rows) console.log(`${r.pass ? 'OK    ' : 'BROKEN'} ${r.id.padEnd(3)} ${r.what}\n         expect: ${r.expect}\n         got:    ${r.got}`);
const broken = rows.filter((r) => !r.pass).length;
console.log(`\nSUMMARY ${rows.length - broken}/${rows.length} OK${broken ? `, ${broken} BROKEN` : ''}`);
process.exit(broken ? 2 : 0);
