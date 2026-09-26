#!/usr/bin/env node
/**
 * W5 — independent review harness for the staging hosting-route check
 * (`.github/wsf-staging/check-hosting-routes.mjs`, PR #450, reviewed at
 * 6f70c171cb0ba63b8fe91595d78364faf4356cb8).
 *
 * WRITTEN FROM THE HELPER'S OWN CONTRACT, NOT FROM ITS TEST FILE. The helper
 * claims that one sample URL per rule answers "presence, destination and
 * precedence in one question", that it is candidate-relative, and that a
 * missing input is an error. Each claim is exercised here against fixtures
 * built from scratch, so an agreement with the author's suite is evidence and
 * not an echo of it.
 *
 * THREE KINDS OF ROW, and only one of them can fail this script:
 *
 *   CONTROL  behaviour the helper must have. If a control misbehaves, the
 *            INSTRUMENT is wrong (or the helper regressed) and this script
 *            exits 2. A review whose controls fail proves nothing.
 *   GAP      a behaviour W5 reported as a gap. Printed as GAP while the helper
 *            still has it and as CLOSED once a fix removes it. Informational:
 *            a gap is a finding for the Director, not a failure of this run.
 *   MATRIX   the candidate / rollback compatibility cells (packet item 4).
 *
 * Usage (read-only; writes only to its own temp dirs, which it removes):
 *   HELPER=<path to check-hosting-routes.mjs> \
 *   CONTRACT_ROOT=<a checkout containing .github/> \   # optional: part B
 *   REPO=<a git checkout that has the SHAs below>        # optional: part C
 *   node docs/westayfit/qa/sprint-w5-hosting-route-check-verify.mjs
 *
 * No network, no credential, no cloud call.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

const HELPER = process.env.HELPER;
const CONTRACT_ROOT = process.env.CONTRACT_ROOT || '';
const REPO = process.env.REPO || '';
if (!HELPER || !fs.existsSync(HELPER)) {
  console.error('HELPER=<path to check-hosting-routes.mjs> is required');
  process.exit(2);
}

const tmpRoots = [];
function tmp(label) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `w5-hosting-${label}-`));
  tmpRoots.push(d);
  return d;
}
const rows = [];
function row(kind, id, ok, detail) {
  rows.push({ kind, id, ok, detail });
}

// ---- fixture builder --------------------------------------------------------
// The layout the helper reads: <cand>/firebase.westayfit.json,
// <cand>/apps/westayfit/dist/**, <ops>/firebase.westayfit.staging.json.
function fixture({ candidate, ops, pages, noCandidate = false, noDist = false }) {
  const root = tmp('fx');
  const cand = path.join(root, 'app');
  const opsDir = path.join(root, 'ops');
  fs.mkdirSync(cand, { recursive: true });
  fs.mkdirSync(opsDir, { recursive: true });
  if (!noCandidate) {
    fs.writeFileSync(path.join(cand, 'firebase.westayfit.json'), JSON.stringify({ hosting: { rewrites: candidate } }));
  }
  fs.writeFileSync(path.join(opsDir, 'firebase.westayfit.staging.json'), JSON.stringify({ hosting: { rewrites: ops } }));
  if (!noDist) {
    const dist = path.join(cand, 'apps/westayfit/dist');
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.html'), '<html></html>');
    for (const p of pages) {
      const f = path.join(dist, p.replace(/^\//, ''));
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, '<html></html>');
    }
  }
  return { cand, opsDir };
}
function runHelper(fx) {
  const r = spawnSync(process.execPath, [HELPER, fx.cand, fx.opsDir], { encoding: 'utf8' });
  const out = `${r.stdout}${r.stderr}`;
  const routes = (out.match(/^ROUTES=.*$/m) || ['(no ROUTES= line)'])[0];
  return { code: r.status, out, routes };
}

// The route set the product actually has (candidate f2f901a / dd86721).
const CH = { source: '/community/*/challenge', destination: '/community/__dynamic/challenge.html' };
const MEM = { source: '/community/*/members', destination: '/community/__dynamic/members.html' };
const CAT = { source: '/community/**', destination: '/community/__dynamic.html' };
const MOVE = { source: '/move/**', destination: '/move/__dynamic.html' };
const CANDIDATE = [CH, MEM, CAT, MOVE];
const PAGES = CANDIDATE.map((r) => r.destination);

// ---- A. helper behaviour ----------------------------------------------------
function expect(kind, id, spec, want) {
  const r = runHelper(fixture(spec));
  const passed = r.code === 0 && /ROUTES=pass/.test(r.routes);
  let ok;
  if (want === 'pass') ok = passed;
  else if (want === 'fail') ok = r.code === 1 && /ROUTES=failed/.test(r.routes);
  else if (want === 'error') ok = r.code === 1 && /ROUTES=error/.test(r.routes);
  else if (want === 'pass-with-note') ok = passed && /^note: /m.test(r.out);
  row(kind, id, ok, `exit=${r.code} ${r.routes}`);
  return r;
}

expect('CONTROL', 'A1 correct configs pass', { candidate: CANDIDATE, ops: CANDIDATE, pages: PAGES }, 'pass');
expect('CONTROL', 'A2 ops missing the members rule fails', { candidate: CANDIDATE, ops: [CH, CAT, MOVE], pages: PAGES }, 'fail');
expect('CONTROL', 'A3 ops missing the /move rule fails', { candidate: CANDIDATE, ops: [CH, MEM, CAT], pages: PAGES }, 'fail');
expect('CONTROL', 'A4 members placed after the catch-all fails', { candidate: CANDIDATE, ops: [CH, CAT, MEM, MOVE], pages: PAGES }, 'fail');
expect(
  'CONTROL',
  'A5 an ops rewrite the candidate has no page for is a NOTE (candidate-relative)',
  { candidate: [CH, CAT, MOVE], ops: CANDIDATE, pages: [CH, CAT, MOVE].map((r) => r.destination) },
  'pass-with-note'
);
expect('CONTROL', 'A6 a missing candidate config is an error', { candidate: CANDIDATE, ops: CANDIDATE, pages: PAGES, noCandidate: true }, 'error');
expect('CONTROL', 'A7 a missing build is an error', { candidate: CANDIDATE, ops: CANDIDATE, pages: PAGES, noDist: true }, 'error');

// GAPS. Every real dynamic URL in this product is ONE path segment
// (/move/<goalId>, /community/<groupId>). The helper samples `**` as TWO
// segments, so a rule that captures the one-segment shape ahead of the
// candidate's rule is never exercised. Each of these configs serves every real
// URL of the route a document other than the candidate's — and should fail.
function gap(id, ops) {
  const r = runHelper(fixture({ candidate: CANDIDATE, ops, pages: PAGES }));
  const stillPasses = r.code === 0;
  row('GAP', id, !stillPasses, `exit=${r.code} ${r.routes}${stillPasses ? '  <- passes; real traffic is shadowed' : ''}`);
}
gap('G1 /move/* -> /index.html ahead of /move/** (shadows every /move/<goalId>)', [
  CH, MEM, CAT, { source: '/move/*', destination: '/index.html' }, MOVE,
]);
gap('G2 /community/* -> /index.html ahead of /community/** (shadows every community home)', [
  CH, MEM, { source: '/community/*', destination: '/index.html' }, CAT, MOVE,
]);
gap('G3 /community/* -> another route\'s page ahead of /community/**', [
  CH, MEM, { source: '/community/*', destination: '/move/__dynamic.html' }, CAT, MOVE,
]);

// ---- B. the workflow contract: is the step's EFFECT pinned, or only its order?
if (CONTRACT_ROOT) {
  const WF = '.github/workflows/wsf-staging-deploy.yml';
  const SUITE = '.github/wsf-staging/tests/workflow-contract.test.mjs';
  const NAME = '      - name: Check the operational hosting config routes this candidate\n';
  const RUN = '        run: node ops/.github/wsf-staging/check-hosting-routes.mjs app ops\n';
  const src = fs.readFileSync(path.join(CONTRACT_ROOT, WF), 'utf8');
  if (!src.includes(NAME + RUN)) {
    row('CONTROL', 'B0 the step exists exactly as reviewed', false, 'step text not found — cannot mutate reliably');
  } else {
    // The WHOLE tree, not just .github: the contract suite reads repo-root
    // files (the hosting configs among them). An earlier revision of this
    // harness copied only .github, the unmutated suite then failed in the copy,
    // and every mutation below "failed" for that reason alone — which would
    // have reported four real gaps as CLOSED. Control B0 is what caught it.
    const copyRoot = tmp('contract');
    execFileSync('sh', ['-c', `git -C "${CONTRACT_ROOT}" archive HEAD | tar -x -C "${copyRoot}"`]);
    const runSuite = (text) => {
      fs.writeFileSync(path.join(copyRoot, WF), text);
      const r = spawnSync(process.execPath, [SUITE], { cwd: copyRoot, encoding: 'utf8' });
      const count = (`${r.stdout}${r.stderr}`.match(/workflow-contract: (\d+) passed/) || [])[1];
      return { code: r.status, count: count ?? '-' };
    };
    const base = runSuite(src);
    row('CONTROL', 'B0 unmutated contract suite passes', base.code === 0, `exit=${base.code} passed=${base.count}`);
    const removed = runSuite(src.replace(NAME + RUN, ''));
    row('CONTROL', 'B1 deleting the step is caught (the mutation mechanism works)', removed.code !== 0, `exit=${removed.code}`);

    // Each of these leaves the step's ORDER intact and makes the check a no-op
    // or a warning. The deploy would then proceed on an operational config
    // missing rewrites — the defect the step exists to stop.
    const neuter = [
      ['G4 the step commented out', src.replace(NAME + RUN, NAME.replace('      -', '      # -') + RUN.replace('        run', '      # run'))],
      ['G5 continue-on-error: true on the step', src.replace(NAME + RUN, NAME + '        continue-on-error: true\n' + RUN)],
      ['G6 if: ${{ false }} on the step', src.replace(NAME + RUN, NAME + '        if: ${{ false }}\n' + RUN)],
      ['G7 `|| true` appended to the invocation', src.replace(NAME + RUN, NAME + RUN.replace('app ops\n', 'app ops || true\n'))],
    ];
    for (const [id, text] of neuter) {
      const r = runSuite(text);
      row('GAP', id, r.code !== 0, `contract exit=${r.code} passed=${r.count}${r.code === 0 ? '  <- green; the check is neutered' : ''}`);
    }
  }
}

// ---- C. compatibility matrix (packet item 4), dist MODELLED from declared ---
// destinations. W5 separately measured the same four cells against REAL
// exports of both candidates and found the modelled and real page sets equal.
if (REPO) {
  const show = (sha, file) => JSON.parse(execFileSync('git', ['-C', REPO, 'show', `${sha}:${file}`], { encoding: 'utf8' }));
  const CAND = { f2f901a: 'f2f901acbe3103d8bdd05afb448064e67e19b5cf', c8f38e3: 'c8f38e37b6286297d1f401834cd9500a675a2923' };
  const OPS = { 'main-as-was': '340e1417a8c0a2c9c9a4b0a3a414f3d96b5574bc', corrected: '9df7e09a832992931b5c0435f6d501c1ceb0f074' };
  const WANT = {
    'f2f901a|main-as-was': 'fail', 'f2f901a|corrected': 'pass',
    'c8f38e3|main-as-was': 'fail', 'c8f38e3|corrected': 'pass-with-note',
  };
  for (const [cn, cs] of Object.entries(CAND)) {
    const candidate = show(cs, 'firebase.westayfit.json').hosting.rewrites;
    const pages = candidate.map((r) => r.destination).filter((d) => d.includes('__dynamic'));
    for (const [on, os_] of Object.entries(OPS)) {
      const ops = show(os_, 'firebase.westayfit.staging.json').hosting.rewrites;
      const key = `${cn}|${on}`;
      expect('MATRIX', `C ${cn} vs ops ${on}`, { candidate, ops, pages }, WANT[key]);
    }
  }
}

// ---- report -----------------------------------------------------------------
for (const d of tmpRoots) fs.rmSync(d, { recursive: true, force: true });
const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
console.log('\nW5 hosting-route check — independent harness');
console.log(`HELPER=${HELPER}`);
for (const r of rows) {
  const verdict =
    r.kind === 'GAP' ? (r.ok ? 'CLOSED' : 'GAP') : r.ok ? 'OK' : 'BROKEN';
  console.log(`${pad(r.kind, 8)} ${pad(verdict, 7)} ${pad(r.id, 88)} ${r.detail}`);
}
const broken = rows.filter((r) => r.kind !== 'GAP' && !r.ok);
const gaps = rows.filter((r) => r.kind === 'GAP' && !r.ok);
console.log(`\ncontrols+matrix: ${rows.length - rows.filter((r) => r.kind === 'GAP').length - broken.length} ok, ${broken.length} broken`);
console.log(`gaps: ${gaps.length} open, ${rows.filter((r) => r.kind === 'GAP' && r.ok).length} closed`);
// Only a broken CONTROL or MATRIX row fails the run: that means the instrument
// is wrong or the helper regressed. Open gaps are findings, reported above.
process.exit(broken.length ? 2 : 0);
