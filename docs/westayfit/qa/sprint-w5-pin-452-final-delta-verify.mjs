#!/usr/bin/env node
/**
 * W5 — FINAL delta review harness for pin PR #452
 * (`claude/wsf-staging-pin-f2f901a`; released by L0 #395 5802798163: "only the
 * approvedAppSha + notes delta on the successor SHA"). The SHA-independent
 * parts were pre-reviewed at ed8649ec (22/22, #395 5802021692) and accepted as
 * sufficient; this harness checks only what the final edit may change, and
 * that nothing else moved.
 *
 * Rows (each CONTROL; any BROKEN row exits 2):
 *   E0  the pin head descends from the pre-reviewed head (no history rewrite)
 *   E1  file scope: PIN's tree = (pre-reviewed head merged with main) + ONLY
 *       .github/wsf-staging/approved-candidate.json
 *   E2  field scope inside the approval: only approvedAppSha and the prose
 *       fields may change; project, expectedPriorFunctions (46),
 *       candidateAddedFunctions (same three, SAME ORDER — the live tripwire is
 *       order-sensitive), _comment and _twelveTransportNote are unchanged, and
 *       no key is added or removed
 *   E3  approvedAppSha is the named CANDIDATE, a real commit that descends from
 *       both the previous pin (f2f901a) and the served build (c8f38e3)
 *   E4  protected paths: c8f38e3..CANDIDATE is exactly the nine files measured
 *       at the pre-review, and f2f901a..CANDIDATE touches none of them
 *   E5  the function inventory the approval asserts is the candidate's SOURCE:
 *       exports(CANDIDATE) − exports(c8f38e3) is exactly candidateAddedFunctions
 *       (lower-cased), 46 → 49
 *   E6  the notes: no "#450 … under review" claim; approvedAppSha cited in full
 *   E7  resolve-candidate on PIN's approval resolves CANDIDATE and refuses every
 *       superseded SHA
 *   E8  the pre-review harness re-run on PIN merged onto main: 22/22
 *   E9  run-all on PIN merged onto main: exit 0, same suite count as main, and
 *       exactly main's total + 2 (the two live cases)
 *   E10 the hosting-route check (main's helper, F1/F2 included) passes the
 *       candidate's firebase.westayfit.json against the operational config
 *
 * Usage (read-only on every branch; local plumbing objects only, never pushed):
 *   PIN=<pin head sha> CANDIDATE=<Director-named sha> [MAIN=<sha>] [DIST=<built dist dir>] \
 *   node docs/westayfit/qa/sprint-w5-pin-452-final-delta-verify.mjs
 *   ONLY=E1,E2 … limits a probing run to named rows (never for the delivered review).
 *   SELFTEST=1 CANDIDATE=<sha> node …   builds a simulated pin plus mutants
 *   locally and proves each rule can fail.
 *
 * Without DIST, E10 uses a dist MODELLED from the candidate's declared
 * __dynamic destinations (stated in the row). No network, no credential.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

const REPO = process.env.REPO || process.cwd();
const HERE = path.dirname(new URL(import.meta.url).pathname);
const PRE = 'ed8649ecb65e96d4ce2d2e9d99d8c533a14ee94c';
const PREV_PIN = 'f2f901acbe3103d8bdd05afb448064e67e19b5cf';
const SERVED = 'c8f38e37b6286297d1f401834cd9500a675a2923';
const APPROVAL = '.github/wsf-staging/approved-candidate.json';
const SOCIAL = ['wsfsetcommunityvisibility', 'wsfcommunitymembers', 'wsfcommunityactivity'];
const NINE = [
  'apps/westayfit/package.json', 'firebase.westayfit.emulators.json', 'firebase.westayfit.json',
  'firestore.indexes.json', 'functions-westayfit/src/index.ts',
  'functions-westayfit/tests/callable/sprint-w8-social-visibility.test.ts',
  'functions-westayfit/tests/callable/wsf-my-communities.test.ts',
  'functions-westayfit/tests/deploy-config/sprint-w8-social-invoker.test.ts',
  'scripts/westayfit/inject_meta.py',
];
const PROTECTED = [
  'functions-westayfit', 'firestore.rules', 'firestore.indexes.json', 'firebase.json',
  'firebase.westayfit.json', 'firebase.westayfit.emulators.json', '.firebaserc', 'package.json',
  'package-lock.json', 'apps/westayfit/package.json', 'apps/westayfit/app.json', '.github',
  'functions', 'apps/goarrive', 'scripts/westayfit',
];
const MAY_CHANGE = new Set(['approvedAppSha', 'packageLabel', 'sourceAcceptedOn', '_expectedPriorFunctionsNote', '_fullCandidateNote']);
const MUST_HOLD = ['project', 'expectedPriorFunctions', 'candidateAddedFunctions', '_comment', '_twelveTransportNote'];
const SUPERSEDED = [
  PREV_PIN, SERVED,
  '9f27c6eae26beebd610779a61fb458bd18266f27', '0bf8f42741449f2f840c197281f215349f778595',
  'dd8672115aea326a4e0e1153a2f73a6f7780f695',
];

const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim();
const gitOk = (...a) => spawnSync('git', ['-C', REPO, ...a], { encoding: 'utf8' }).status === 0;
const full = (s) => git('rev-parse', '--verify', `${s}^{commit}`);
const temps = [];
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `w5-final-${p}-`)); temps.push(d); return d; };
const worktrees = [];

function mergedTree(a, b) {
  const r = spawnSync('git', ['-C', REPO, 'merge-tree', '--write-tree', a, b], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout.split('\n')[0].trim();
}
function protectedDiff(a, b) {
  const out = git('diff', '--name-only', a, b, '--', ...PROTECTED);
  return out ? out.split('\n').sort() : [];
}
function exportsAt(sha) {
  const src = git('show', `${sha}:functions-westayfit/src/index.ts`);
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  return new Set([...noComments.matchAll(/export\s+const\s+(wsf[A-Za-z0-9_]*)/g)].map((m) => m[1].toLowerCase()));
}
function approvalAt(sha) { return JSON.parse(git('show', `${sha}:${APPROVAL}`)); }
function commitWithApproval(parentTree, parents, approvalObj, extraFiles = {}) {
  const idx = path.join(tmp('idx'), 'index');
  const env = { ...process.env, GIT_INDEX_FILE: idx };
  const run = (args, input) => execFileSync('git', ['-C', REPO, ...args], { env, input, encoding: 'utf8' }).trim();
  run(['read-tree', parentTree]);
  const files = { [APPROVAL]: JSON.stringify(approvalObj, null, 2) + '\n', ...extraFiles };
  for (const [p, content] of Object.entries(files)) {
    const blob = run(['hash-object', '-w', '--stdin'], content);
    run(['update-index', '--cacheinfo', `100644,${blob},${p}`]);
  }
  const tree = run(['write-tree']);
  const pargs = parents.flatMap((p) => ['-p', p]);
  return run(['commit-tree', tree, ...pargs, '-m', 'W5 local simulation — never pushed'], '');
}
function worktreeAt(commit) {
  const d = tmp('wt');
  fs.rmSync(d, { recursive: true, force: true });
  git('worktree', 'add', '--detach', '--quiet', d, commit);
  worktrees.push(d);
  return d;
}
function runAll(dir) {
  const r = spawnSync(process.execPath, ['.github/wsf-staging/tests/run-all.mjs'], { cwd: dir, encoding: 'utf8', timeout: 900000, maxBuffer: 1 << 26 });
  const out = r.stdout + r.stderr;
  const suites = (out.match(/^=== /gm) || []).length;
  const self = [...out.matchAll(/^[a-z-]+: (\d+) passed/gm)].reduce((s, m) => s + Number(m[1]), 0);
  const nodeTest = [...out.matchAll(/^# pass (\d+)/gm)].reduce((s, m) => s + Number(m[1]), 0);
  return { code: r.status, suites, self, nodeTest, total: self + nodeTest };
}

/**
 * Evaluate every row for one pin head. `opts.heavy` runs E8–E10 (worktrees,
 * suites, the helper); the self-test mutants run the cheap rows only, except
 * where a mutant targets a heavy row.
 */
function evaluate(PIN, CANDIDATE, MAIN, opts = {}) {
  const rows = [];
  const row = (id, what, expect, got, pass) => rows.push({ id, what, expect, got, pass });
  const only = opts.only ? new Set(opts.only) : null;
  const want = (id) => !only || only.has(id);

  // E0
  if (want('E0')) row('E0', 'pin head descends from the pre-reviewed ed8649ec', 'ancestor', gitOk('merge-base', '--is-ancestor', PRE, PIN) ? 'ancestor' : 'NOT an ancestor', gitOk('merge-base', '--is-ancestor', PRE, PIN));

  // E1
  const mainIn = gitOk('merge-base', '--is-ancestor', MAIN, PIN);
  const baseTree = mainIn ? mergedTree(PRE, MAIN) : git('rev-parse', `${PRE}^{tree}`);
  if (want('E1')) {
    const changed = baseTree ? git('diff', '--name-only', baseTree, `${PIN}^{tree}`).split('\n').filter(Boolean) : ['<pre ⊕ main does not merge cleanly>'];
    row('E1', `file scope vs ${mainIn ? 'ed8649ec ⊕ main' : 'ed8649ec (main not merged into the pin)'}`, `only ${APPROVAL}`, changed.join(', ') || '(none)', changed.length === 1 && changed[0] === APPROVAL);
  }

  // E2
  const pre = approvalAt(PRE);
  let pin;
  try { pin = approvalAt(PIN); } catch { pin = null; }
  if (want('E2')) {
    if (!pin) row('E2', 'approval parses at the pin head', 'valid JSON', 'unparseable', false);
    else {
      const added = Object.keys(pin).filter((k) => !(k in pre));
      const removed = Object.keys(pre).filter((k) => !(k in pin));
      const changed = Object.keys(pin).filter((k) => k in pre && JSON.stringify(pin[k]) !== JSON.stringify(pre[k]));
      const illegal = changed.filter((k) => !MAY_CHANGE.has(k));
      const held = MUST_HOLD.every((k) => JSON.stringify(pin[k]) === JSON.stringify(pre[k]));
      const exact = pin.expectedPriorFunctions === 46 && JSON.stringify(pin.candidateAddedFunctions) === JSON.stringify(SOCIAL);
      row('E2', 'field scope inside the approval', 'only approvedAppSha + prose change; 46 and the three (same order) held; no key added/removed',
        `changed=[${changed.join(', ')}] added=[${added.join(', ')}] removed=[${removed.join(', ')}] expectedPrior=${pin.expectedPriorFunctions} added3=${JSON.stringify(pin.candidateAddedFunctions)}`,
        !added.length && !removed.length && !illegal.length && held && exact);
    }
  }

  // E3
  if (want('E3')) {
    const sha = pin?.approvedAppSha || '';
    let isCommit = false; try { isCommit = full(sha) === sha; } catch {}
    const desc = isCommit && gitOk('merge-base', '--is-ancestor', PREV_PIN, sha) && gitOk('merge-base', '--is-ancestor', SERVED, sha);
    row('E3', 'approvedAppSha is the named candidate', `${CANDIDATE}; descends from f2f901a and c8f38e3`, `${sha || '(none)'}; commit=${isCommit}; descends=${desc}`, sha === CANDIDATE && isCommit && desc);
  }

  // E4
  if (want('E4')) {
    const fromServed = protectedDiff(SERVED, CANDIDATE);
    const fromPrev = protectedDiff(PREV_PIN, CANDIDATE);
    const same = JSON.stringify(fromServed) === JSON.stringify([...NINE].sort());
    row('E4', 'protected paths: c8f38e3..candidate = the nine; f2f901a..candidate = none', '9 / 0',
      `${fromServed.length} / ${fromPrev.length}${fromPrev.length ? ` (${fromPrev.join(', ')})` : ''}${same ? '' : ` set≠nine: ${fromServed.join(', ')}`}`, same && fromPrev.length === 0);
  }

  // E5
  if (want('E5')) {
    const after = exportsAt(CANDIDATE), before = exportsAt(SERVED);
    const added = [...after].filter((n) => !before.has(n)).sort();
    const lost = [...before].filter((n) => !after.has(n));
    const listed = [...(pin?.candidateAddedFunctions || [])].sort();
    row('E5', "candidate source's added exports = candidateAddedFunctions", `46 → 49; +${[...SOCIAL].sort().join(', ')}`,
      `${before.size} → ${after.size}; +${added.join(', ')}${lost.length ? `; LOST ${lost.join(', ')}` : ''}`,
      before.size === 46 && after.size === 49 && !lost.length && JSON.stringify(added) === JSON.stringify(listed));
  }

  // E6
  if (want('E6')) {
    const prose = ['packageLabel', '_fullCandidateNote', '_expectedPriorFunctionsNote'].map((k) => String(pin?.[k] || '')).join('\n');
    const stale = /#450[^.]{0,40}under review/i.test(prose);
    const cites = prose.includes(CANDIDATE);
    const prevAsCurrent = /^f2f901acbe3103d8bdd05afb448064e67e19b5cf is measured against/.test(String(pin?._fullCandidateNote || ''));
    row('E6', 'notes current: no "#450 under review"; candidate cited in full; not re-based on f2f901a', 'clean', `stale450=${stale} citesCandidate=${cites} noteBasedOnF2f901a=${prevAsCurrent}`, !stale && cites && !prevAsCurrent);
  }

  // E7
  if (want('E7')) {
    const d = tmp('rc');
    const rc = path.join(d, 'resolve-candidate.mjs');
    fs.writeFileSync(rc, git('show', `${PIN}:.github/wsf-staging/resolve-candidate.mjs`));
    const ap = path.join(d, 'approved-candidate.json');
    fs.writeFileSync(ap, git('show', `${PIN}:${APPROVAL}`));
    const run = (req) => spawnSync(process.execPath, [rc, ap], { encoding: 'utf8', env: { ...process.env, WSF_REQUESTED_SHA: req } });
    const a = run('');
    const b = run(CANDIDATE);
    const refused = SUPERSEDED.filter((s) => s !== CANDIDATE && !CANDIDATE.startsWith(s)).map((s) => [s, run(s).status]);
    const leaks = refused.filter(([, st]) => st === 0).map(([s]) => s.slice(0, 7));
    row('E7', 'resolve-candidate: resolves the candidate, refuses every superseded SHA', `CANDIDATE=${CANDIDATE.slice(0, 7)}…; ${refused.length} refused`,
      `default exit ${a.status} ${(a.stdout.match(/CANDIDATE=\S{7}/) || ['-'])[0]}; request exit ${b.status}; accepted-superseded=[${leaks.join(', ')}]`,
      a.status === 0 && a.stdout.includes(`CANDIDATE=${CANDIDATE}`) && b.status === 0 && leaks.length === 0);
  }

  if (!opts.heavy) return rows;

  // E8–E10 on PIN merged onto MAIN.
  const mergedCommit = mainIn ? PIN : (() => {
    const t = mergedTree(MAIN, PIN);
    return t ? execFileSync('git', ['-C', REPO, 'commit-tree', t, '-p', MAIN, '-p', PIN, '-m', 'W5 local merge — never pushed'], { encoding: 'utf8', input: '' }).trim() : null;
  })();
  if (!mergedCommit) {
    for (const id of ['E8', 'E9', 'E10']) if (want(id)) row(id, 'pin merges onto main', 'clean merge', 'CONFLICT', false);
    return rows;
  }
  const wt = worktreeAt(mergedCommit);
  if (want('E8')) {
    const r = spawnSync(process.execPath, [path.join(HERE, 'sprint-w5-pin-452-preview-verify.mjs')], { encoding: 'utf8', env: { ...process.env, ROOT: wt }, timeout: 900000, maxBuffer: 1 << 26 });
    const sum = (r.stdout.match(/SUMMARY (\d+)\/(\d+) OK/) || []);
    row('E8', 'pre-review harness on pin ⊕ main', 'exit 0, 22/22', `exit ${r.status}, ${sum[1] || '?'}/${sum[2] || '?'}`, r.status === 0 && sum[1] === '22' && sum[2] === '22');
  }
  if (want('E9')) {
    const m = runAll(worktreeAt(MAIN));
    const p = runAll(wt);
    row('E9', 'run-all on pin ⊕ main vs main', `exit 0; suites = main's; total = main + 2`,
      `main exit ${m.code} ${m.suites} suites ${m.self}+${m.nodeTest}=${m.total}; pin⊕main exit ${p.code} ${p.suites} suites ${p.self}+${p.nodeTest}=${p.total}`,
      m.code === 0 && p.code === 0 && p.suites === m.suites && p.total === m.total + 2);
  }
  if (want('E10')) {
    const root = tmp('routes');
    const app = path.join(root, 'app'), ops = path.join(root, 'ops');
    fs.mkdirSync(app, { recursive: true });
    fs.writeFileSync(path.join(app, 'firebase.westayfit.json'), git('show', `${CANDIDATE}:firebase.westayfit.json`));
    const dist = path.join(app, 'apps/westayfit/dist');
    let distKind;
    if (process.env.DIST) { fs.cpSync(process.env.DIST, dist, { recursive: true }); distKind = 'REAL build'; }
    else {
      const cfg = JSON.parse(git('show', `${CANDIDATE}:firebase.westayfit.json`));
      for (const r of cfg.hosting.rewrites) {
        if (!r.destination.includes('__dynamic')) continue;
        const f = path.join(dist, r.destination);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, '<!doctype html>');
      }
      distKind = 'MODELLED from declared destinations';
    }
    // The operational side is exactly what the deploy job reads: the merged tree's
    // staging hosting config, and main's helper (F1/F2 included).
    fs.mkdirSync(path.join(ops, '.github/wsf-staging'), { recursive: true });
    fs.copyFileSync(path.join(wt, 'firebase.westayfit.staging.json'), path.join(ops, 'firebase.westayfit.staging.json'));
    fs.copyFileSync(path.join(wt, '.github/wsf-staging/check-hosting-routes.mjs'), path.join(ops, '.github/wsf-staging/check-hosting-routes.mjs'));
    const r = spawnSync(process.execPath, [path.join(ops, '.github/wsf-staging/check-hosting-routes.mjs'), app, ops], { encoding: 'utf8' });
    const line = ((r.stdout + r.stderr).match(/ROUTES=[^\n]*/) || ['-'])[0];
    row('E10', `hosting check (main's helper) on the candidate's config; dist ${distKind}`, 'exit 0, ROUTES=pass', `exit ${r.status}, ${line}`, r.status === 0 && /ROUTES=pass/.test(line));
  }
  return rows;
}

function print(title, rows) {
  console.log(`\n== ${title}`);
  for (const r of rows) console.log(`${r.pass ? 'OK    ' : 'BROKEN'} ${r.id.padEnd(4)} ${r.what}\n          expect: ${r.expect}\n          got:    ${r.got}`);
  const broken = rows.filter((r) => !r.pass).length;
  console.log(`SUMMARY ${rows.length - broken}/${rows.length} OK${broken ? `, ${broken} BROKEN` : ''}`);
  return broken;
}

let exitCode = 0;
try {
  const CANDIDATE = full(process.env.CANDIDATE || '');
  const MAIN = full(process.env.MAIN || 'origin/main');
  if (process.env.SELFTEST) {
    // A simulated pin: ed8649ec ⊕ main, with the edit L0 described (#365 5803870408).
    const base = mergedTree(PRE, MAIN);
    const pre = approvalAt(PRE);
    const good = {
      ...pre,
      approvedAppSha: CANDIDATE,
      packageLabel: `SIMULATED corrected candidate ${CANDIDATE}. ` + pre.packageLabel.replace(/\(PR #450, under review\)/, '(PR #450, merged as 13accc5; #460 18dd21e)'),
      _fullCandidateNote: `${CANDIDATE} is measured against c8f38e37b6286297d1f401834cd9500a675a2923 (simulated).`,
    };
    const sim = commitWithApproval(base, [PRE, MAIN], good);
    const g = evaluate(sim, CANDIDATE, MAIN, { heavy: true });
    exitCode |= print(`SELFTEST control: simulated correct pin ${sim.slice(0, 12)} (local, never pushed) — every row must be OK`, g) ? 2 : 0;

    // Mutants: each must break its own row (and the listed row only is asserted).
    const protectedTouch = execFileSync('git', ['-C', REPO, 'commit-tree', (() => {
      const idx = path.join(tmp('idx'), 'index');
      const env = { ...process.env, GIT_INDEX_FILE: idx };
      const r = (a, i) => execFileSync('git', ['-C', REPO, ...a], { env, input: i, encoding: 'utf8' }).trim();
      r(['read-tree', `${CANDIDATE}^{tree}`]);
      const blob = r(['hash-object', '-w', '--stdin'], git('show', `${CANDIDATE}:firestore.rules`) + '\n// W5 mutant\n');
      r(['update-index', '--cacheinfo', `100644,${blob},firestore.rules`]);
      return r(['write-tree']);
    })(), '-p', CANDIDATE, '-m', 'W5 mutant — never pushed'], { encoding: 'utf8', input: '' }).trim();
    const MUTANTS = [
      ['M1', 'E2', 'expectedPriorFunctions 46 → 47', { ...good, expectedPriorFunctions: 47 }],
      ['M2', 'E2', 'the three reordered', { ...good, candidateAddedFunctions: [...SOCIAL].reverse() }],
      ['M3', 'E2', 'a fourth addition', { ...good, candidateAddedFunctions: [...SOCIAL, 'wsfbogus'] }],
      ['M4', 'E3', 'approvedAppSha = superseded 9f27c6e', { ...good, approvedAppSha: '9f27c6eae26beebd610779a61fb458bd18266f27' }],
      ['M5', 'E6', 'notes keep "(PR #450, under review)"', { ...good, packageLabel: pre.packageLabel }],
      ['M6', 'E1', 'an extra file changed in the pin', good, { '.github/wsf-staging/verify-deployment.mjs': git('show', `${PRE}:.github/wsf-staging/verify-deployment.mjs`) + '\n// W5 mutant\n' }],
      ['M7', 'E4', 'approvedAppSha = a candidate that touches firestore.rules', { ...good, approvedAppSha: protectedTouch }, {}, protectedTouch],
      ['M8', 'E7', 'the approval still names the old pin f2f901a', { ...good, approvedAppSha: PREV_PIN }, {}, CANDIDATE],
    ];
    const mrows = [];
    for (const [id, target, what, obj, extra = {}, cand = CANDIDATE] of MUTANTS) {
      const c = commitWithApproval(base, [PRE, MAIN], obj, extra);
      const rs = evaluate(c, cand, MAIN, { only: [target] });
      const hit = rs.find((r) => r.id === target);
      mrows.push({ id, what: `${what} → ${target} must BREAK`, expect: 'BROKEN', got: hit ? (hit.pass ? 'still OK' : `BROKEN: ${hit.got.slice(0, 110)}`) : 'row missing', pass: !!hit && !hit.pass });
    }
    exitCode |= print('SELFTEST mutants (each must break its target row)', mrows) ? 2 : 0;
  } else {
    const PIN = full(process.env.PIN || '');
    // ONLY=E1,E2,… limits the run to named rows (for probing); the delivered
    // review always runs every row.
    const only = process.env.ONLY ? process.env.ONLY.split(',').map((x) => x.trim()) : null;
    const heavy = !only || only.some((x) => ['E8', 'E9', 'E10'].includes(x));
    const rows = evaluate(PIN, CANDIDATE, MAIN, { heavy, only });
    exitCode = print(`FINAL delta — PIN ${PIN}  CANDIDATE ${CANDIDATE}  MAIN ${MAIN}`, rows) ? 2 : 0;
  }
} finally {
  for (const w of worktrees) spawnSync('git', ['-C', REPO, 'worktree', 'remove', '--force', w]);
  spawnSync('git', ['-C', REPO, 'worktree', 'prune']);
  for (const d of temps) fs.rmSync(d, { recursive: true, force: true });
}
process.exit(exitCode);
