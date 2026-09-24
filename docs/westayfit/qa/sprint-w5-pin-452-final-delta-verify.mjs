#!/usr/bin/env node
/**
 * W5 — FINAL delta review harness for pin PR #452
 * (`claude/wsf-staging-pin-f2f901a`; released by L0 #395 5802798163: "only the
 * approvedAppSha + notes delta on the successor SHA"). The SHA-independent
 * parts were pre-reviewed at ed8649ec (22/22, #395 5802021692) and accepted as
 * sufficient; this harness checks only what the final edit may change, and
 * that nothing else moved.
 *
 * v2 — hardened after an adversarial red-team (wf_31f83f28-07c) demonstrated
 * bypasses of v1: an extra "ours" parent, a pin without main merged in, and
 * gutted or stale prose that still passed E2/E6. Each is now a SELFTEST mutant.
 *
 * Rows (each CONTROL; any BROKEN row exits 2):
 *   E0  ancestry: ed8649ec AND main are ancestors of the pin; every new commit
 *       is on the first-parent line; every non-first parent is on main (no
 *       side history can ride in)
 *   E1  file scope: the pin tree = (ed8649ec ⊕ main) with exactly ONE raw
 *       change, a mode-100644 modification of approved-candidate.json
 *   E2  approval text: canonical JSON (2-space, trailing newline, pre's key
 *       order, no duplicate/prototype keys); only approvedAppSha, packageLabel
 *       and _fullCandidateNote may change; 46 and the three (same order) held
 *   E3  approvedAppSha is the named CANDIDATE: a real commit descending from
 *       f2f901a and c8f38e3, reachable from app-shell or the candidate branch
 *   E4  protected paths: c8f38e3..CANDIDATE is exactly the expected set (the
 *       nine the notes name + apps/westayfit/package-lock.json), and
 *       f2f901a..CANDIDATE touches none
 *   E5  candidate source exports: 46 → 49, the added three = the approval list
 *   E6  prose structure: the pre-reviewed label survives verbatim except the
 *       one "(PR #450, under review) will enforce." sentence, whose replacement
 *       cites 13accc5 (an ancestor of main); a prefix may cite the candidate but
 *       no superseded SHA; _fullCandidateNote starts "<CANDIDATE> is measured
 *       against"; no format characters or non-ASCII spaces anywhere
 *   E7  resolve-candidate on the pin's approval resolves CANDIDATE and refuses
 *       every superseded SHA
 *   E8  the pre-review harness on the PIN itself: 22/22
 *   E9  run-all on the PIN = run-all on (ed8649ec ⊕ main), suite by suite
 *   E10 the hosting-route check (the pin's helper) passes the candidate's
 *       firebase.westayfit.json against the pin's operational config
 *
 * Usage (read-only on every branch; local plumbing objects only, never pushed;
 * `git fetch` first so origin/* refs are current):
 *   MAIN must be the main the pin merges INTO (for #452: 18dd21eb), not a later
 *   main that already contains the pin.
 *   PIN=<sha> CANDIDATE=<sha> [MAIN=<sha>] [DIST=<built dist>] node …/sprint-w5-pin-452-final-delta-verify.mjs
 *   ONLY=E1,E2 …   probing run; prints PARTIAL and exits 3 (never a verdict)
 *   SELFTEST=1 CANDIDATE=<sha> [MAIN=<sha>] node …   simulated pin + mutants
 * Without DIST, E10 uses a dist MODELLED from the candidate's declared
 * __dynamic destinations, and says so. No network, no credential.
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
const OLD_450 = '(PR #450, under review) will enforce.';
const EXPECTED_PROTECTED = [
  'apps/westayfit/package-lock.json', 'apps/westayfit/package.json', 'firebase.westayfit.emulators.json',
  'firebase.westayfit.json', 'firestore.indexes.json', 'functions-westayfit/src/index.ts',
  'functions-westayfit/tests/callable/sprint-w8-social-visibility.test.ts',
  'functions-westayfit/tests/callable/wsf-my-communities.test.ts',
  'functions-westayfit/tests/deploy-config/sprint-w8-social-invoker.test.ts',
  'scripts/westayfit/inject_meta.py',
].sort();
const PROTECTED = [
  'functions-westayfit', 'firestore.rules', 'firestore.indexes.json', 'firebase.json',
  'firebase.westayfit.json', 'firebase.westayfit.emulators.json', '.firebaserc', 'package.json',
  'package-lock.json', 'apps/westayfit/package.json', 'apps/westayfit/package-lock.json',
  'apps/westayfit/app.json', '.github', 'functions', 'apps/goarrive', 'scripts/westayfit',
];
const MAY_CHANGE = new Set(['approvedAppSha', 'packageLabel', '_fullCandidateNote']);
const SUPERSEDED = [
  PREV_PIN, SERVED,
  '9f27c6eae26beebd610779a61fb458bd18266f27', '0bf8f42741449f2f840c197281f215349f778595',
  'dd8672115aea326a4e0e1153a2f73a6f7780f695',
];
const CANDIDATE_BRANCHES = ['origin/claude/wsf-app-shell', 'origin/claude/wsf-release-candidate-round-2'];
const BAD_CHARS = /[\p{Cf}   -   　]/u;

const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim();
const gitOk = (...a) => spawnSync('git', ['-C', REPO, ...a], { encoding: 'utf8' }).status === 0;
const lines = (s) => s.split('\n').filter(Boolean);
const full = (s) => git('rev-parse', '--verify', `${s}^{commit}`);
const temps = [];
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `w5-final-${p}-`)); temps.push(d); return d; };
const worktrees = [];
function cleanup() {
  for (const w of worktrees.splice(0)) spawnSync('git', ['-C', REPO, 'worktree', 'remove', '--force', w]);
  spawnSync('git', ['-C', REPO, 'worktree', 'prune']);
  for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanup(); process.exit(130); });

function mergedTree(a, b) {
  const r = spawnSync('git', ['-C', REPO, 'merge-tree', '--write-tree', a, b], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split('\n')[0].trim() : null;
}
function commitTree(tree, parents, msg = 'W5 local simulation — never pushed') {
  return execFileSync('git', ['-C', REPO, 'commit-tree', tree, ...parents.flatMap((p) => ['-p', p]), '-m', msg], { encoding: 'utf8', input: '' }).trim();
}
function protectedDiff(a, b) { return lines(git('diff', '--name-only', a, b, '--', ...PROTECTED)).sort(); }
function exportsAt(sha) {
  const src = git('show', `${sha}:functions-westayfit/src/index.ts`);
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const byRegex = new Set([...noComments.matchAll(/export\s+const\s+(wsf[A-Za-z0-9_]*)/g)].map((m) => m[1].toLowerCase()));
  // Cross-check: a line-anchored count must agree, or the comment stripping miscounted.
  const byLine = new Set([...src.matchAll(/^export\s+const\s+(wsf[A-Za-z0-9_]*)/gm)].map((m) => m[1].toLowerCase()));
  return { set: byRegex, agree: byRegex.size === byLine.size && [...byRegex].every((n) => byLine.has(n)) };
}
function rawApproval(sha) { return git('show', `${sha}:${APPROVAL}`) + '\n'; }
/** Build a local commit from a base tree with files replaced: { path: { content, mode } }. */
function commitWithFiles(baseTree, parents, files) {
  const idx = path.join(tmp('idx'), 'index');
  const env = { ...process.env, GIT_INDEX_FILE: idx };
  const run = (args, input) => execFileSync('git', ['-C', REPO, ...args], { env, input, encoding: 'utf8' }).trim();
  run(['read-tree', baseTree]);
  for (const [p, { content, mode = '100644' }] of Object.entries(files)) {
    const blob = run(['hash-object', '-w', '--stdin'], content);
    run(['update-index', '--cacheinfo', `${mode},${blob},${p}`]);
  }
  return commitTree(run(['write-tree']), parents);
}
const canonical = (obj) => JSON.stringify(obj, null, 2) + '\n';
function worktreeAt(commit) {
  const d = tmp('wt');
  fs.rmSync(d, { recursive: true, force: true });
  git('worktree', 'add', '--detach', '--quiet', d, commit);
  worktrees.push(d);
  const head = execFileSync('git', ['-C', d, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (head !== commit) throw new Error(`worktree HEAD ${head} ≠ ${commit}`);
  return d;
}
function runAll(dir) {
  const r = spawnSync(process.execPath, ['.github/wsf-staging/tests/run-all.mjs'], {
    cwd: dir, encoding: 'utf8', timeout: 900000, maxBuffer: 1 << 26, env: { ...process.env, TMPDIR: tmp('child') },
  });
  if (r.signal || r.error) throw new Error(`run-all did not complete: ${r.signal || r.error.message}`);
  const out = r.stdout + r.stderr;
  const perSuite = {};
  for (const block of out.split(/^=== /m).slice(1)) {
    const name = block.split('\n')[0].replace(/\s*===\s*$/, '').trim();
    const self = [...block.matchAll(/^[a-z-]+: (\d+) passed/gm)].reduce((s, m) => s + Number(m[1]), 0);
    const nt = [...block.matchAll(/^# pass (\d+)/gm)].reduce((s, m) => s + Number(m[1]), 0);
    perSuite[name] = self + nt;
  }
  const total = Object.values(perSuite).reduce((s, n) => s + n, 0);
  return { code: r.status, suites: Object.keys(perSuite).length, perSuite, total };
}

function evaluate(PIN, CANDIDATE, MAIN, opts = {}) {
  const rows = [];
  const row = (id, what, expect, got, pass) => rows.push({ id, what, expect, got, pass });
  const only = opts.only ? new Set(opts.only) : null;
  const want = (id) => !only || only.has(id);
  const guard = (id, what, f) => { if (!want(id)) return; try { f(); } catch (e) { row(id, what, 'row completes', `CRASH: ${String(e.message).split('\n')[0].slice(0, 160)}`, false); } };

  const preIn = gitOk('merge-base', '--is-ancestor', PRE, PIN);
  const mainIn = gitOk('merge-base', '--is-ancestor', MAIN, PIN);
  const baseTree = mergedTree(PRE, MAIN);

  guard('E0', 'ancestry: ed8649ec and main in the pin; new commits first-parent only; side parents on main', () => {
    const all = lines(git('rev-list', PIN, `^${PRE}`, `^${MAIN}`));
    const fp = lines(git('rev-list', '--first-parent', PIN, `^${PRE}`, `^${MAIN}`));
    const offMain = [];
    for (const c of all) {
      const parents = git('rev-list', '--parents', '-n', '1', c).split(' ').slice(2);
      for (const p of parents) if (!gitOk('merge-base', '--is-ancestor', p, MAIN) && p !== PRE && !gitOk('merge-base', '--is-ancestor', p, PRE)) offMain.push(p.slice(0, 8));
    }
    const sideHistory = all.length !== fp.length || all.some((c) => !fp.includes(c));
    row('E0', 'ancestry: ed8649ec and main in the pin; new commits first-parent only; side parents on main', 'pre ✓ main ✓ first-parent ✓ side parents on main ✓',
      `pre ${preIn ? '✓' : '✗'} main ${mainIn ? '✓' : '✗'} new=${all.length} firstParent=${fp.length}${sideHistory ? ' SIDE HISTORY' : ''}${offMain.length ? ` off-main parents=[${offMain.join(', ')}]` : ''}`,
      preIn && mainIn && !sideHistory && !offMain.length);
  });

  guard('E1', 'file scope vs ed8649ec ⊕ main (raw diff, mode pinned)', () => {
    if (!baseTree) return row('E1', 'file scope', 'clean base', 'ed8649ec ⊕ main does not merge cleanly', false);
    const raw = lines(git('diff', '--raw', '--no-renames', '--no-abbrev', baseTree, `${PIN}^{tree}`));
    const ok = mainIn && raw.length === 1 && /^:100644 100644 [0-9a-f]{40} [0-9a-f]{40} M\t/.test(raw[0]) && raw[0].endsWith(`\t${APPROVAL}`);
    row('E1', 'file scope vs ed8649ec ⊕ main (raw diff, mode pinned)', `main merged; exactly one M 100644 ${APPROVAL}`,
      `${mainIn ? '' : 'MAIN NOT MERGED INTO THE PIN; '}${raw.map((l) => l.replace(/ [0-9a-f]{40}/g, '')).join(' | ') || '(none)'}`, ok);
  });

  const preRaw = rawApproval(PRE);
  const pre = JSON.parse(preRaw);
  let pinRaw = '', pin = null;
  try { pinRaw = rawApproval(PIN); pin = JSON.parse(pinRaw); } catch {}

  guard('E2', 'approval text: canonical, pre key order, only three keys change, 46 + the three held', () => {
    if (!pin) return row('E2', 'approval parses', 'valid JSON', 'unparseable', false);
    const canon = pinRaw === canonical(pin);
    const order = JSON.stringify(Object.keys(pin)) === JSON.stringify(Object.keys(pre));
    const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const added = Object.keys(pin).filter((k) => !own(pre, k));
    const removed = Object.keys(pre).filter((k) => !own(pin, k));
    const changed = Object.keys(pin).filter((k) => own(pre, k) && JSON.stringify(pin[k]) !== JSON.stringify(pre[k]));
    const illegal = changed.filter((k) => !MAY_CHANGE.has(k));
    const exact = pin.expectedPriorFunctions === 46 && JSON.stringify(pin.candidateAddedFunctions) === JSON.stringify(SOCIAL);
    const types = typeof pin.packageLabel === 'string' && typeof pin._fullCandidateNote === 'string';
    row('E2', 'approval text: canonical, pre key order, only three keys change, 46 + the three held',
      'canonical, same key order, changes ⊆ {approvedAppSha, packageLabel, _fullCandidateNote}',
      `canonical=${canon} keyOrder=${order} changed=[${changed.join(', ')}] added=[${added.join(', ')}] removed=[${removed.join(', ')}] 46=${pin.expectedPriorFunctions} three=${JSON.stringify(pin.candidateAddedFunctions)}`,
      canon && order && !added.length && !removed.length && !illegal.length && exact && types);
  });

  guard('E3', 'approvedAppSha is the named candidate on a candidate branch', () => {
    const sha = pin?.approvedAppSha || '';
    let isCommit = false; try { isCommit = full(sha) === sha; } catch {}
    const desc = isCommit && gitOk('merge-base', '--is-ancestor', PREV_PIN, sha) && gitOk('merge-base', '--is-ancestor', SERVED, sha);
    const on = CANDIDATE_BRANCHES.filter((b) => { try { return gitOk('merge-base', '--is-ancestor', sha, full(b)); } catch { return false; } });
    row('E3', 'approvedAppSha is the named candidate on a candidate branch', `${CANDIDATE}; descends from f2f901a and c8f38e3; on app-shell or the candidate branch`,
      `${sha || '(none)'}; commit=${isCommit}; descends=${desc}; reachableFrom=[${on.map((b) => b.replace('origin/claude/', '')).join(', ')}]`,
      sha === CANDIDATE && isCommit && desc && on.length > 0);
  });

  guard('E4', 'protected paths', () => {
    const fromServed = protectedDiff(SERVED, CANDIDATE);
    const fromPrev = protectedDiff(PREV_PIN, CANDIDATE);
    const same = JSON.stringify(fromServed) === JSON.stringify(EXPECTED_PROTECTED);
    row('E4', 'protected paths: c8f38e3..candidate = the expected ten; f2f901a..candidate = none', `${EXPECTED_PROTECTED.length} / 0`,
      `${fromServed.length} / ${fromPrev.length}${fromPrev.length ? ` (${fromPrev.join(', ')})` : ''}${same ? '' : ` set≠expected: ${fromServed.join(', ')}`}`, same && fromPrev.length === 0);
  });

  guard('E5', "candidate source's added exports = candidateAddedFunctions", () => {
    const a = exportsAt(CANDIDATE), b = exportsAt(SERVED);
    const added = [...a.set].filter((n) => !b.set.has(n)).sort();
    const lost = [...b.set].filter((n) => !a.set.has(n));
    const listed = [...(pin?.candidateAddedFunctions || [])].sort();
    row('E5', "candidate source's added exports = candidateAddedFunctions", `46 → 49; +${[...SOCIAL].sort().join(', ')}; counters agree`,
      `${b.set.size} → ${a.set.size}; +${added.join(', ')}${lost.length ? `; LOST ${lost.join(', ')}` : ''}; countersAgree=${a.agree && b.agree}`,
      b.set.size === 46 && a.set.size === 49 && !lost.length && JSON.stringify(added) === JSON.stringify(listed) && a.agree && b.agree);
  });

  guard('E6', 'prose structure', () => {
    const label = String(pin?.packageLabel ?? ''), note = String(pin?._fullCandidateNote ?? '');
    const badChars = BAD_CHARS.test(pinRaw);
    const i = pre.packageLabel.indexOf(OLD_450);
    const head = pre.packageLabel.slice(0, i), tail = pre.packageLabel.slice(i + OLD_450.length);
    const j = label.indexOf(head);
    const rest = j >= 0 ? label.slice(j + head.length) : '';
    const structural = i >= 0 && j >= 0 && rest.endsWith(tail) && rest.length > tail.length;
    const R = structural ? rest.slice(0, rest.length - tail.length) : '';
    const prefix = j >= 0 ? label.slice(0, j) : label;
    let r450 = false; try { r450 = /13accc5/.test(R) && gitOk('merge-base', '--is-ancestor', full('13accc5'), MAIN) && !/under review/i.test(R); } catch {}
    const hexCite = (s, sha) => new RegExp(`(?<![0-9a-f])${sha}(?![0-9a-f])`).test(s);
    const prefixSuperseded = SUPERSEDED.filter((s) => prefix.includes(s)).map((s) => s.slice(0, 7));
    const noteOk = note.startsWith(`${CANDIDATE} is measured against `);
    row('E6', 'prose structure: label intact but for the #450 sentence; note re-based; no hidden characters',
      'label = prefix + pre-label with only the #450 sentence replaced (cites 13accc5 ⊂ main); note starts with the candidate; clean characters',
      `structural=${structural} R=${JSON.stringify(R).slice(0, 140)} r450ok=${r450} prefixLen=${prefix.length} prefixCitesCandidate=${hexCite(prefix, CANDIDATE)} prefixSuperseded=[${prefixSuperseded.join(', ')}] noteRebased=${noteOk} hiddenChars=${badChars}`,
      structural && r450 && !prefixSuperseded.length && noteOk && !badChars && hexCite(label + note, CANDIDATE));
  });

  guard('E7', 'resolve-candidate', () => {
    const d = tmp('rc');
    const rc = path.join(d, 'resolve-candidate.mjs');
    fs.writeFileSync(rc, git('show', `${PIN}:.github/wsf-staging/resolve-candidate.mjs`));
    const ap = path.join(d, 'approved-candidate.json');
    fs.writeFileSync(ap, pinRaw);
    const run = (req) => spawnSync(process.execPath, [rc, ap], { encoding: 'utf8', env: { ...process.env, WSF_REQUESTED_SHA: req } });
    const a = run(''), b = run(CANDIDATE);
    const refused = SUPERSEDED.filter((s) => s !== CANDIDATE).map((s) => [s, run(s).status]);
    const leaks = refused.filter(([, st]) => st === 0).map(([s]) => s.slice(0, 7));
    row('E7', 'resolve-candidate: resolves the candidate, refuses every superseded SHA', `CANDIDATE=${CANDIDATE.slice(0, 7)}…; ${refused.length} refused`,
      `default exit ${a.status} ${(a.stdout.match(/CANDIDATE=\S{7}/) || ['-'])[0]}; request exit ${b.status}; accepted-superseded=[${leaks.join(', ')}]`,
      a.status === 0 && a.stdout.includes(`CANDIDATE=${CANDIDATE}`) && b.status === 0 && leaks.length === 0);
  });

  if (!opts.heavy) return rows;
  if (!mainIn) {
    for (const id of ['E8', 'E9', 'E10']) if (want(id)) row(id, 'heavy row on the pin', 'main merged into the pin', 'MAIN NOT MERGED INTO THE PIN — nothing synthesized', false);
    return rows;
  }
  let wt;
  guard('E8', 'pre-review harness on the PIN', () => {
    wt = wt || worktreeAt(PIN);
    const r = spawnSync(process.execPath, [path.join(HERE, 'sprint-w5-pin-452-preview-verify.mjs')], { encoding: 'utf8', env: { ...process.env, ROOT: wt, TMPDIR: tmp('child') }, timeout: 900000, maxBuffer: 1 << 26 });
    if (r.signal || r.error) throw new Error(`pre-review harness did not complete: ${r.signal || r.error.message}`);
    const sum = r.stdout.match(/SUMMARY (\d+)\/(\d+) OK/) || [];
    row('E8', 'pre-review harness on the PIN itself', 'exit 0, 22/22', `exit ${r.status}, ${sum[1] || '?'}/${sum[2] || '?'}`, r.status === 0 && sum[1] === '22' && sum[2] === '22');
  });
  guard('E9', 'run-all on the PIN = run-all on ed8649ec ⊕ main, suite by suite', () => {
    wt = wt || worktreeAt(PIN);
    const base = runAll(worktreeAt(commitTree(baseTree, [MAIN, PRE], 'W5 local base — never pushed')));
    const p = runAll(wt);
    const diffs = [...new Set([...Object.keys(base.perSuite), ...Object.keys(p.perSuite)])].filter((k) => base.perSuite[k] !== p.perSuite[k]);
    const empty = Object.entries(p.perSuite).filter(([, n]) => !(n > 0)).map(([k]) => k);
    row('E9', 'run-all on the PIN = run-all on ed8649ec ⊕ main, suite by suite', 'both exit 0; every suite equal and non-empty',
      `base exit ${base.code} ${base.suites} suites ${base.total}; pin exit ${p.code} ${p.suites} suites ${p.total}${diffs.length ? `; differ=[${diffs.join(', ')}]` : ''}${empty.length ? `; empty=[${empty.join(', ')}]` : ''}`,
      base.code === 0 && p.code === 0 && p.suites === base.suites && !diffs.length && !empty.length);
  });
  guard('E10', 'hosting check', () => {
    wt = wt || worktreeAt(PIN);
    const root = tmp('routes');
    const app = path.join(root, 'app'), ops = path.join(root, 'ops');
    fs.mkdirSync(app, { recursive: true });
    fs.writeFileSync(path.join(app, 'firebase.westayfit.json'), git('show', `${CANDIDATE}:firebase.westayfit.json`));
    const dist = path.join(app, 'apps/westayfit/dist');
    let distKind;
    if (process.env.DIST) { fs.cpSync(process.env.DIST, dist, { recursive: true }); distKind = `REAL build (${process.env.DIST})`; }
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
    fs.mkdirSync(path.join(ops, '.github/wsf-staging'), { recursive: true });
    fs.copyFileSync(path.join(wt, 'firebase.westayfit.staging.json'), path.join(ops, 'firebase.westayfit.staging.json'));
    fs.copyFileSync(path.join(wt, '.github/wsf-staging/check-hosting-routes.mjs'), path.join(ops, '.github/wsf-staging/check-hosting-routes.mjs'));
    const r = spawnSync(process.execPath, [path.join(ops, '.github/wsf-staging/check-hosting-routes.mjs'), app, ops], { encoding: 'utf8' });
    const line = ((r.stdout + r.stderr).match(/ROUTES=[^\n]*/) || ['-'])[0];
    row('E10', `hosting check (the pin's helper + operational config) on the candidate's config; dist ${distKind}`, 'exit 0, ROUTES=pass', `exit ${r.status}, ${line}`, r.status === 0 && /ROUTES=pass/.test(line));
  });
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
    const base = mergedTree(PRE, MAIN);
    const preRaw = rawApproval(PRE);
    const pre = JSON.parse(preRaw);
    const R = '(PR #450, merged as 13accc5; its one-segment sampling and step-liveness guards merged as #460 18dd21e) enforces.';
    const good = {
      ...pre,
      approvedAppSha: CANDIDATE,
      packageLabel: `SIMULATED CORRECTED CANDIDATE ${CANDIDATE}. ` + pre.packageLabel.replace(OLD_450, R),
      _fullCandidateNote: `${CANDIDATE} is measured against ${SERVED} (simulated).`,
    };
    const A = (obj) => ({ [APPROVAL]: { content: canonical(obj) } });
    const sim = commitWithFiles(base, [PRE, MAIN], A(good));
    const g = evaluate(sim, CANDIDATE, MAIN, { heavy: true });
    exitCode |= print(`SELFTEST control: simulated correct pin ${sim.slice(0, 12)} (local, never pushed) — every row must be OK`, g) ? 2 : 0;

    const touchRules = (() => {
      const t = execFileSync('git', ['-C', REPO, 'rev-parse', `${CANDIDATE}^{tree}`], { encoding: 'utf8' }).trim();
      return commitWithFiles(t, [CANDIDATE], { 'firestore.rules': { content: git('show', `${CANDIDATE}:firestore.rules`) + '\n// W5 mutant\n' } });
    })();
    const preTree = git('rev-parse', `${PRE}^{tree}`);
    const dup = canonical(good).replace('  "expectedPriorFunctions": 46,', '  "expectedPriorFunctions": 47,\n  "expectedPriorFunctions": 46,');
    const MUTANTS = [
      // [id, target row, what, commit builder, candidate]
      ['M1', 'E2', 'expectedPriorFunctions 46 → 47', () => commitWithFiles(base, [PRE, MAIN], A({ ...good, expectedPriorFunctions: 47 }))],
      ['M2', 'E2', 'the three reordered', () => commitWithFiles(base, [PRE, MAIN], A({ ...good, candidateAddedFunctions: [...SOCIAL].reverse() }))],
      ['M3', 'E2', 'a fourth addition', () => commitWithFiles(base, [PRE, MAIN], A({ ...good, candidateAddedFunctions: [...SOCIAL, 'wsfbogus'] }))],
      ['M4', 'E3', 'approvedAppSha = superseded 9f27c6e', () => commitWithFiles(base, [PRE, MAIN], A({ ...good, approvedAppSha: '9f27c6eae26beebd610779a61fb458bd18266f27' }))],
      ['M5', 'E6', 'label keeps "(PR #450, under review)"', () => commitWithFiles(base, [PRE, MAIN], A({ ...good, packageLabel: `SIMULATED ${CANDIDATE}. ` + pre.packageLabel }))],
      ['M6', 'E1', 'an extra file changed', () => commitWithFiles(base, [PRE, MAIN], { ...A(good), '.github/wsf-staging/verify-deployment.mjs': { content: git('show', `${PRE}:.github/wsf-staging/verify-deployment.mjs`) + '\n// W5 mutant\n' } })],
      ['M7', 'E4', 'candidate touches firestore.rules', () => commitWithFiles(base, [PRE, MAIN], A({ ...good, approvedAppSha: touchRules })), touchRules],
      ['M8', 'E7', 'approval still names the old pin f2f901a', () => commitWithFiles(base, [PRE, MAIN], A({ ...good, approvedAppSha: PREV_PIN }))],
      ['M9', 'E0', "extra 'ours' parent carrying the candidate's history", () => commitTree(git('rev-parse', `${sim}^{tree}`), [PRE, MAIN, CANDIDATE])],
      ['M10', 'E1', 'approval committed as a symlink (mode 120000)', () => commitWithFiles(base, [PRE, MAIN], { [APPROVAL]: { content: canonical(good), mode: '120000' } })],
      ['M11', 'E1', 'main NOT merged into the pin', () => commitWithFiles(preTree, [PRE], A(good))],
      ['M12', 'E6', 'dispatch-precondition sentence gutted from the label', () => commitWithFiles(base, [PRE, MAIN], A({ ...good, packageLabel: good.packageLabel.replace(/DISPATCH PRECONDITIONS[^]*?None of those is claimed by this file\./, '') }))],
      ['M13', 'E6', 'stale sentence kept with a no-break space', () => commitWithFiles(base, [PRE, MAIN], A({ ...good, packageLabel: `SIMULATED ${CANDIDATE}. ` + pre.packageLabel.replace('under review', 'under review') }))],
      ['M14', 'E2', '_expectedPriorFunctionsNote rewritten', () => commitWithFiles(base, [PRE, MAIN], A({ ...good, _expectedPriorFunctionsNote: 'A rollback may drop candidateAddedFunctions.' }))],
      ['M15', 'E2', 'duplicate expectedPriorFunctions key in the raw file', () => commitWithFiles(base, [PRE, MAIN], { [APPROVAL]: { content: dup } })],
      ['M16', 'E6', '_fullCandidateNote left on f2f901a', () => commitWithFiles(base, [PRE, MAIN], A({ ...good, _fullCandidateNote: pre._fullCandidateNote }))],
      ['M17', 'E9', 'a pin that drops a suite registration (heavy)', () => commitWithFiles(base, [PRE, MAIN], { ...A(good), '.github/wsf-staging/tests/run-all.mjs': { content: git('show', `${MAIN}:.github/wsf-staging/tests/run-all.mjs`).replace(/^\s*'check-hosting-routes\.test\.mjs',\n/m, '') } })],
    ];
    const mrows = [];
    for (const [id, target, what, build, cand = CANDIDATE] of MUTANTS) {
      let hit;
      try {
        const c = build();
        const rs = evaluate(c, cand, MAIN, { only: [target], heavy: ['E8', 'E9', 'E10'].includes(target) });
        hit = rs.find((r) => r.id === target);
      } catch (e) { hit = { pass: true, got: `builder crashed: ${e.message}` }; }
      mrows.push({ id, what: `${what} → ${target} must BREAK`, expect: 'BROKEN', got: hit ? (hit.pass ? `still OK: ${hit.got.slice(0, 100)}` : `BROKEN: ${hit.got.slice(0, 120)}`) : 'row missing', pass: !!hit && !hit.pass });
    }
    exitCode |= print('SELFTEST mutants (each must break its target row)', mrows) ? 2 : 0;
  } else {
    const PIN = full(process.env.PIN || '');
    const only = process.env.ONLY ? process.env.ONLY.split(',').map((x) => x.trim()) : null;
    const heavy = !only || only.some((x) => ['E8', 'E9', 'E10'].includes(x));
    const rows = evaluate(PIN, CANDIDATE, MAIN, { heavy, only });
    const broken = print(`${only ? 'PARTIAL (ONLY=' + only.join(',') + ') — NOT A VERDICT — ' : ''}FINAL delta — PIN ${PIN}  CANDIDATE ${CANDIDATE}  MAIN ${MAIN}  REPO ${REPO}`, rows);
    exitCode = broken ? 2 : only ? 3 : 0;
  }
} finally {
  cleanup();
}
process.exit(exitCode);
