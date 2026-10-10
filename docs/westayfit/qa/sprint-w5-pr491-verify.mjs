#!/usr/bin/env node
// W5 QA2 — independent mutation check of PR #491 (social-privacy mode) at an
// exact SHA. Read-only: `git archive`s the reviewed commit into its own temp
// dir, mutates only that copy, runs only the focused suites
// (social-privacy-postop, workflow-contract), and removes the copy.
// No network, no emulator, no cloud.
//
//   ROOT=<git checkout> REV=<sha> node docs/westayfit/qa/sprint-w5-pr491-verify.mjs
//
// C0      controls: both focused suites pass unmutated.
// L1-L4   logic probes of the exported functions (independent of the PR's tests).
// M*      mutants that MUST turn a focused suite red (INSTRUMENT if the target
//         text is not found exactly once).
// G*      mutants recorded as OPEN/CLOSED gaps; they do not fail the run.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.env.ROOT || process.cwd();
const REV = process.env.REV;
if (!REV) { console.error('REV is required'); process.exit(2); }
const H = '.github/wsf-staging/social-privacy-postop.mjs';
const W = '.github/workflows/wsf-staging-deploy.yml';
const SUITES = { unit: '.github/wsf-staging/tests/social-privacy-postop.test.mjs', wf: '.github/wsf-staging/tests/workflow-contract.test.mjs' };

const rows = []; const gaps = [];
const row = (id, ok, detail) => { rows.push({ id, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${detail}`); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w5-pr491-'));
process.on('SIGINT', () => { fs.rmSync(tmp, { recursive: true, force: true }); process.exit(130); });
try {
  execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${REV} | tar -x -C "${tmp}"`]);
  const run = (suite) => spawnSync(process.execPath, [SUITES[suite]], { cwd: tmp, encoding: 'utf8', timeout: 300_000 });
  const ORIG = { [H]: fs.readFileSync(path.join(tmp, H), 'utf8'), [W]: fs.readFileSync(path.join(tmp, W), 'utf8') };

  for (const s of Object.keys(SUITES)) { const r = run(s); row(`C0-${s}`, r.status === 0, `unmutated ${SUITES[s]} exit=${r.status} ${((r.stdout.match(/: (\d+) passed/) || [])[0] || '')}`); }

  // ---- L rows: the exported logic, probed independently
  const mod = await import(pathToFileURL(path.join(tmp, H)).href);
  const all = (s) => Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`row${i + 1}`, s]));
  row('L1', mod.verdict(all('PASS')).exit === 0 && ['BLOCKED', 'FAIL', 'SKIPPED', undefined, null, 'pass'].every((bad) => mod.verdict({ ...all('PASS'), row4: bad }).exit !== 0)
    && mod.verdict({ ...all('PASS'), row8: 'PASS' }).exit !== 0,
    'only exactly seven PASS rows exit 0 (any other value in one row, or an eighth row, is not ready)');
  row('L2', mod.rowStatus([]) === 'BLOCKED' && mod.rowStatus([{ status: 'PASS' }, { status: 'BLOCKED' }, { status: 'FAIL' }]) === 'FAIL' && mod.rowStatus([{ status: 'PASS' }, { status: 'weird' }]) === 'PASS',
    'rowStatus: empty=BLOCKED, FAIL outranks BLOCKED; NOTE an unknown sub-status counts as PASS (only PASS/BLOCKED/FAIL are ever produced)');
  const shutHtml = mod.classifyTransport(403, '<html><body><h1>Error: Forbidden</h1></body></html>');
  const gfeJson403 = mod.classifyTransport(403, JSON.stringify({ error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } }));
  const gfeJson401 = mod.classifyTransport(401, JSON.stringify({ error: { code: 401, message: 'Request is missing required authentication credential.', status: 'UNAUTHENTICATED' } }));
  row('L3', shutHtml === 'shut' && mod.classifyTransport(500, 'x') === 'unknown', `HTML 403 → ${shutHtml}; 5xx → unknown`);
  console.log(`INFO  L4 a Google-front-end-shaped JSON refusal: 403 PERMISSION_DENIED → ${gfeJson403}; 401 UNAUTHENTICATED with numeric code → ${gfeJson401} (the unauthenticated probe cannot tell these from the handler)`);
  gaps.push({ id: 'L4', open: gfeJson403 === 'open' });

  // ---- M / G rows
  const MUT = [
    ['M1', H, 'unknown transport treated as open (writes on an unproven setter)', "const setterOpen = transport.wsfSetCommunityVisibility === 'open';", "const setterOpen = transport.wsfSetCommunityVisibility !== 'shut';"],
    ['M2', H, 'fixtures created before the setter gate', "  const setterOpen = transport.wsfSetCommunityVisibility === 'open';", "  await createUser('champion');\n  const setterOpen = transport.wsfSetCommunityVisibility === 'open';"],
    ['M3', H, 'bare 401/403 read as open (SHUT misread)', "if (status === 401 || status === 403) return 'shut';", "if (status === 401 || status === 403) return 'open';"],
    ['M4', H, 'verdict: a BLOCKED row counts as ready', "if (s.some((x) => x !== 'PASS')) return { verdict: 'blocked', exit: 3 };", "if (s.some((x) => x !== 'PASS' && x !== 'BLOCKED')) return { verdict: 'blocked', exit: 3 };"],
    ['M5', H, 'verdict: row count not checked', "  if (s.length !== 7) return { verdict: 'fail', exit: 1 };\n", ''],
    ['M6', H, 'rowStatus: a row with no evidence passes', "if (checks.length === 0) return 'BLOCKED';", "if (checks.length === 0) return 'PASS';"],
    ['M7', H, 'missing-index INTERNAL becomes a privacy FAIL for row 3', "else add('row3', 'BLOCKED', v3.activityNote);", "else add('row3', 'FAIL', v3.activityNote);"],
    ['M8', H, 'the harness gains a transport mutation', "export const SOCIAL_SERVICES", "const unused = 'setIamPolicy';\nexport const SOCIAL_SERVICES"],
    ['M9', W, 'privacy job broadened to contents: write', "  social-privacy:\n    needs: [gate, config]\n    if: ${{ inputs.mode == 'social-privacy' }}\n    runs-on: ubuntu-latest\n    timeout-minutes: 20\n    environment: wsf-staging\n    permissions:\n      contents: read", "  social-privacy:\n    needs: [gate, config]\n    if: ${{ inputs.mode == 'social-privacy' }}\n    runs-on: ubuntu-latest\n    timeout-minutes: 20\n    environment: wsf-staging\n    permissions:\n      contents: write"],
    ['M10', W, 'upload no longer gated on the scan', "        if: ${{ always() && steps.scan-privacy-evidence.outcome == 'success' }}", "        if: ${{ always() }}"],
    ['M11', W, 'cleanup skipped after a failed verification', "      - name: Remove synthetic fixtures\n        if: always()\n        env:\n          WSF_CLEANUP_MANIFEST: ${{ github.workspace }}/wsf-privacy-evidence/cleanup-manifest.json", "      - name: Remove synthetic fixtures\n        env:\n          WSF_CLEANUP_MANIFEST: ${{ github.workspace }}/wsf-privacy-evidence/cleanup-manifest.json"],
    ['M12', W, 'build job reachable in social-privacy mode', null, null], // filled below
    ['M13', W, 'the privacy job checks out the candidate', "      - name: Check out operational assets at the running workflow commit\n        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with:\n          ref: ${{ github.sha }}\n          path: ops\n          persist-credentials: false\n\n      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0\n        with:\n          node-version: 20\n\n      # For google-auth-library only", "      - name: Check out operational assets at the running workflow commit\n        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with:\n          ref: ${{ github.sha }}\n          path: ops\n          persist-credentials: false\n\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with:\n          ref: ${{ needs.gate.outputs.app_sha }}\n          path: app\n          persist-credentials: false\n\n      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0\n        with:\n          node-version: 20\n\n      # For google-auth-library only"],
    ['M14', W, 'final gate ignores the verification outcome', "          [ \"${{ steps.privacy.outcome }}\" = \"success\" ] \\\n            || { echo \"::error::the privacy verification did not pass", "          true \\\n            || { echo \"::error::the privacy verification did not pass"],
    // Gaps: behaviours the focused suites are not expected to pin today.
    ['G4', W, 'a second checkout of another ref (not spelled via needs.gate.outputs.app_sha) into the privacy job', "      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0\n        with:\n          node-version: 20\n\n      # For google-auth-library only", "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with:\n          ref: refs/heads/claude/wsf-app-shell\n          path: app\n          persist-credentials: false\n\n      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0\n        with:\n          node-version: 20\n\n      # For google-auth-library only"],
    ['G1', H, 'any non-INTERNAL members/activity error for an authorised viewer is BLOCKED, not FAIL (e.g. a PERMISSION_DENIED to the champion)', null, null],
    ['G2', H, 'the unauthenticated anonymous-setter check in row 5 dropped', "    const u1 =await call('wsfSetCommunityVisibility', { groupId: A, name: 'private' });\n    expect('row5', u1.error === 'UNAUTHENTICATED', `an anonymous setter call answered ${u1.error || 'a result'}`);\n", ''],
    ['G3', H, 'row 6 aggregate: people-moved-today accepts any value', "v6.activity.contributorsToday === null || v6.activity.contributorsToday === 2", "true"],
  ];
  // M12: add social-privacy to the build job's if (first occurrence of the deploy-or-player list that is the build job's)
  {
    const t = ORIG[W];
    const i = t.indexOf('\n  build:');
    const j = t.indexOf('    if: ', i);
    const k = t.indexOf('\n', j);
    const line = t.slice(j, k);
    MUT.find((m) => m[0] === 'M12').splice(3, 2, t.slice(i, k), t.slice(i, j) + line.replace(/\}\}\s*$/, "|| inputs.mode == 'social-privacy' }}"));
  }
  for (const [id, file, what, from, to] of MUT) {
    if (from === null) { console.log(`INFO  ${id} (source-only finding, see report): ${what}`); if (id.startsWith('G')) gaps.push({ id, open: true, sourceOnly: true }); continue; }
    const n = ORIG[file].split(from).length - 1;
    if (n !== 1) { row(id, false, `INSTRUMENT: target found ${n} times — ${what}`); continue; }
    fs.writeFileSync(path.join(tmp, file), ORIG[file].replace(from, to));
    const res = Object.keys(SUITES).map((s) => [s, run(s)]);
    fs.writeFileSync(path.join(tmp, file), ORIG[file]);
    const red = res.filter(([, r]) => r.status !== 0).map(([s]) => s);
    if (id.startsWith('G')) { gaps.push({ id, open: red.length === 0 }); console.log(`GAP   ${id}  ${red.length ? 'CLOSED (caught by ' + red.join('+') + ')' : 'OPEN (no focused suite catches it)'} — ${what}`); continue; }
    row(id, red.length > 0, `${red.length ? 'caught by ' + red.join('+') : 'SURVIVED'} — ${what}`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
const failed = rows.filter((r) => !r.ok);
console.log(`\ngaps: ${gaps.map((g) => `${g.id}=${g.open ? 'OPEN' : 'CLOSED'}`).join(' ')}`);
console.log(`${rows.length - failed.length}/${rows.length} required rows as required${failed.length ? `; FAILED: ${failed.map((r) => r.id).join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
