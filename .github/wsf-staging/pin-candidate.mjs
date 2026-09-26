#!/usr/bin/env node
/**
 * Generate the next staging pin from an exact accepted product SHA and the
 * receipt of the run that deployed the current pin.
 *
 * WHY. Every pin since run 47 was written by hand: the approved SHA, the
 * measured prior inventory, three notes, and a rotation of the previous notes
 * into `_previous*<sha8>` history keys. The machine fields and the rotation are
 * mechanical, and a hand edit is where a stale SHA or a mistyped count gets in.
 * This script derives them from git and from the run receipt, refuses when the
 * receipt does not describe the pin it is replacing, and records which release
 * invariants held (`_pinInvariants`).
 *
 * WHAT STAYS HUMAN. `packageLabel` is the reviewed prose of what changes for
 * members; it is read verbatim from --label-file and never generated. The
 * boundary note this script writes is git facts only (commits, files, routes,
 * protected paths, the functions tree), not the per-file review narrative a
 * hand-written note carried.
 *
 * WHAT IT DOES NOT DO. It does not approve anything, does not open a PR, and
 * does not change the release gate: the output is a file for the ordinary
 * reviewed pin PR. `_pinInvariants.fastPath` records whether a FUTURE
 * pointer-only fast path would apply; nothing reads it today, and the current
 * pin review stays in force until the generator and the changed-journey smoke
 * are accepted (docs/westayfit/ops/OWNER_TEST_CARD_AND_SMOKE_CONTRACT.md).
 *
 * Deterministic: no clock, no network, no environment. The same inputs and the
 * same repository give byte-identical output.
 *
 * Exit 0 = written. Exit 1 = refused; nothing is written.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// THE PROTECTED PATHS, defined once. A pin whose candidate differs from the
// served pin on any of these leaves the fast path and gets explicit review:
// they are the backend, rules, indexes, hosting and package configuration, and
// the automation itself.
export const PROTECTED_PATHS = Object.freeze([
  'firebase.westayfit.json',
  'firebase.westayfit.emulators.json',
  'firestore.rules',
  'firestore.indexes.json',
  'firebase.json',
  '.firebaserc',
  'package.json',
  'package-lock.json',
  'apps/westayfit/package.json',
  'apps/westayfit/app.json',
  '.github/',
  'scripts/westayfit/',
  'functions/',
  'functions-westayfit/',
]);

// THE RELEASE ENVIRONMENT: the operational files a staging run executes. A
// change here between the run that served the current pin and the operational
// head this pin will be dispatched from means the next run is not the same
// procedure, so it too leaves the fast path. The approval file itself is the
// thing being changed and is excluded.
export const RELEASE_ENVIRONMENT_PATHS = Object.freeze([
  '.github/workflows/wsf-staging-deploy.yml',
  '.github/wsf-staging/',
  'firebase.westayfit.staging.json',
]);
const APPROVAL_REL = '.github/wsf-staging/approved-candidate.json';
const VERIFIER_REL = '.github/wsf-staging/verify-deployment.mjs';
const ROLLBACK_AUTHORITY = 'Director #365 5841628546';

const SHA = /^[0-9a-f]{40}$/;
const WORDS = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE'];
const word = (n) => (n < WORDS.length ? WORDS[n] : String(n));
const lower = (n) => word(n).toLowerCase();

export class Refusal extends Error {}
const refuse = (message) => { throw new Refusal(message); };

// ---- git ----------------------------------------------------------------------
function git(repo, args, { allowFail = false } = {}) {
  const r = spawnSync('git', ['-C', repo, '-c', 'core.quotepath=off', ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) {
    if (allowFail) return null;
    refuse(`git ${args[0]} failed: ${(r.stderr || '').trim().split('\n')[0]}`);
  }
  return r.stdout;
}
const isCommit = (repo, sha) => git(repo, ['cat-file', '-e', `${sha}^{commit}`], { allowFail: true }) !== null;
const isAncestor = (repo, a, b) => spawnSync('git', ['-C', repo, 'merge-base', '--is-ancestor', a, b]).status === 0;
const treeOf = (repo, sha, p) => (git(repo, ['rev-parse', `${sha}:${p}`], { allowFail: true }) || '').trim() || null;
const lines = (s) => s.split('\n').filter(Boolean);

/**
 * Exported callables in functions-westayfit/src/index.ts, lower-cased as the
 * deployed service names are. `null` when the file cannot be read or re-exports
 * (`export {` / `export *`) that a line scan cannot count: unmeasurable is not
 * the same as unchanged.
 */
export function exportedFunctions(src) {
  if (src === null) return null;
  if (/^export\s*(\{|\*)/m.test(src)) return null;
  const names = [...src.matchAll(/^export const ([A-Za-z0-9_]+)\s*=\s*on[A-Z][A-Za-z]*\s*[<(]/gm)].map((m) => m[1].toLowerCase());
  return [...new Set(names)].sort();
}

/** The verifier's BASE_EXPECTED array literal, read as text (the script has side effects and exports nothing). */
export function verifierBase(src) {
  if (src === null) return null;
  const m = /const BASE_EXPECTED = \[([\s\S]*?)\];/.exec(src);
  if (!m) return null;
  const body = m[1].split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  return [...body.matchAll(/'([a-z0-9]+)'/g)].map((x) => x[1]).sort();
}

function diffNames(repo, a, b, paths, excludes = []) {
  const spec = [...paths, ...excludes.map((e) => `:(exclude)${e}`)];
  return lines(git(repo, ['diff', '--no-renames', '--name-only', a, b, '--', ...spec])).sort();
}

/** Everything the notes and invariants say about the repository, measured once. */
export function measure(repo, { previous, candidate, runMain, opsHead }) {
  const ancestor = isAncestor(repo, previous, candidate);
  const firstParent = ancestor ? lines(git(repo, ['rev-list', '--first-parent', '--reverse', `${previous}..${candidate}`])) : [];
  const commits = ancestor ? Number(git(repo, ['rev-list', '--count', `${previous}..${candidate}`]).trim()) : null;

  let files = 0, added = 0, deleted = 0, docs = 0;
  for (const l of lines(git(repo, ['diff', '--no-renames', '--numstat', previous, candidate]))) {
    const [a, d, ...rest] = l.split('\t');
    const p = rest.join('\t');
    files += 1;
    if (a !== '-') added += Number(a);
    if (d !== '-') deleted += Number(d);
    if (p.startsWith('docs/')) docs += 1;
  }

  const routes = { added: [], modified: [], removed: [] };
  for (const l of lines(git(repo, ['diff', '-M', '--name-status', previous, candidate, '--', 'apps/westayfit/app']))) {
    const [status, ...ps] = l.split('\t');
    const rel = (p) => p.replace(/^apps\/westayfit\//, '');
    if (status === 'A') routes.added.push(rel(ps[0]));
    else if (status === 'M' || status === 'T') routes.modified.push(rel(ps[0]));
    else if (status === 'D') routes.removed.push(rel(ps[0]));
    else if (status.startsWith('R')) routes.removed.push(`${rel(ps[0])} (renamed to ${rel(ps[1])})`);
    else routes.modified.push(rel(ps[ps.length - 1]));
  }
  for (const k of Object.keys(routes)) routes[k].sort();

  const show = (sha, p) => git(repo, ['show', `${sha}:${p}`], { allowFail: true });
  const verifierRef = opsHead || runMain;
  return {
    ancestor,
    firstParent,
    commits,
    files, added, deleted, docs,
    routes,
    protectedDelta: diffNames(repo, previous, candidate, PROTECTED_PATHS),
    functionsTree: { previous: treeOf(repo, previous, 'functions-westayfit'), candidate: treeOf(repo, candidate, 'functions-westayfit') },
    exports: {
      previous: exportedFunctions(show(previous, 'functions-westayfit/src/index.ts')),
      candidate: exportedFunctions(show(candidate, 'functions-westayfit/src/index.ts')),
    },
    verifier: { ref: verifierRef, base: verifierBase(show(verifierRef, VERIFIER_REL)) },
    releaseEnvironment: opsHead
      ? { from: runMain, to: opsHead, delta: diffNames(repo, runMain, opsHead, RELEASE_ENVIRONMENT_PATHS, [APPROVAL_REL]) }
      : null,
  };
}

// ---- notes --------------------------------------------------------------------
const s8 = (sha) => sha.slice(0, 8);
const list = (xs) => (xs.length === 0 ? 'none' : xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

function sameFunctions(m) {
  return m.functionsTree.previous !== null && m.functionsTree.previous === m.functionsTree.candidate;
}

export function rollbackNote({ previous, run, m }) {
  let s = `ROLLBACK TARGET (${ROLLBACK_AUTHORITY}). The previous known-good served app SHA is ${previous}: ` +
    `run ${run.number} (${run.id}) deployed it, dispatched from operational main ${run.main}, and printed ` +
    `INVENTORY_BEFORE=${run.before}, INVENTORY_AFTER=${run.after}, CREATED_THIS_DEPLOY=${run.created}, ` +
    `HOSTED_MARKER_MATCHES=true and VERIFY=pass, with its hosted verification job green. `;
  if (sameFunctions(m)) {
    s += `This pin changes no backend inventory (the functions-westayfit tree is ${s8(m.functionsTree.candidate)} at both SHAs), ` +
      `so re-pinning ${s8(previous)} is compatible with the live ${run.after}-function inventory: set approvedAppSha back, ` +
      'keep expectedPriorFunctions at the measured BEFORE and keep candidateAddedFunctions, recheck that pin against the ' +
      'current inventory, merge it reviewed, and dispatch once.';
  } else {
    s += `This pin CHANGES the functions-westayfit tree (${m.functionsTree.previous ? s8(m.functionsTree.previous) : 'absent'} -> ` +
      `${m.functionsTree.candidate ? s8(m.functionsTree.candidate) : 'absent'}), so a rollback to ${s8(previous)} after this pin ` +
      'deploys needs its own inventory review before dispatch.';
  }
  return `${s} A note, not a gate: no script reads it.`;
}

export function expectedPriorNote({ previous, run, added, m }) {
  const base = run.after - added.length;
  let s = `${run.after}, the measured live inventory. Run ${run.id} (run ${run.number}, ${run.date}, candidate ${s8(previous)} ` +
    `from main ${s8(run.main)}), the last deploy-mode run, printed in its own deploy-job log INVENTORY_BEFORE=${run.before}, ` +
    `INVENTORY_AFTER=${run.after}, EXPECTED_INVENTORY=${run.after}, CREATED_THIS_DEPLOY=${run.created}, ` +
    'HOSTED_MARKER_MATCHES=true and VERIFY=pass. read-inventory.mjs refuses a deploy whose live count differs from this number. ';
  if (sameFunctions(m)) {
    s += `THIS PIN'S DEPLOY IS EXPECTED TO CREATE NOTHING (${run.after} -> ${run.after}, CREATED_THIS_DEPLOY=none) and to lose nothing. `;
  } else {
    s += 'THIS PIN CHANGES THE FUNCTION SOURCE, so what its deploy creates or removes is NOT derived here and needs explicit review. ';
  }
  const baseOk = m.verifier.base !== null && m.verifier.base.length === base;
  s += baseOk
    ? `The verifier's EXPECTED set is still the ${base}-name base plus the ${lower(added.length)} names in candidateAddedFunctions, ` +
      'read from this file in the operational checkout, which equals this prior. '
    : `The verifier's base (${m.verifier.base === null ? 'unreadable' : m.verifier.base.length} names at ${s8(m.verifier.ref)}) plus the ` +
      `${lower(added.length)} names in candidateAddedFunctions does NOT equal this prior; review the expected set before dispatch. `;
  s += 'A new function fails verification as present but not expected; a listed social service that disappears fails, named. ' +
    'A retaining rollback (re-pin to an older candidate while the three services remain deployed) must keep ' +
    'candidateAddedFunctions and keep expectedPriorFunctions at the measured BEFORE; removing the key while the services ' +
    'remain is invalid (SOCIAL-ROLLOUT-SEQUENCE.md section 6a).';
  return s;
}

export function boundaryNote({ previous, candidate, run, m }) {
  const parts = [];
  parts.push(`${candidate} is measured against ${previous}, the SHA this file previously approved, which run ${run.number} ` +
    `(${run.id}) deployed and whose hosted marker that run observed.`);
  if (m.ancestor) {
    parts.push(`${s8(previous)} is an ancestor of the candidate. Derived with git by pin-candidate.mjs: ` +
      `${word(m.firstParent.length)} first-parent commit${m.firstParent.length === 1 ? '' : 's'} (${m.firstParent.map(s8).join(', ') || 'none'}); ` +
      `${m.commits} commit${m.commits === 1 ? '' : 's'} in all; ${m.files} files, +${m.added} / -${m.deleted}, ${m.docs} of them under docs/.`);
  } else {
    parts.push(`${s8(previous)} is NOT an ancestor of the candidate: this is not a forward pin, and its lineage needs explicit review. ` +
      `Derived with git by pin-candidate.mjs: ${m.files} files differ, +${m.added} / -${m.deleted}, ${m.docs} of them under docs/.`);
  }
  parts.push(`Route files under apps/westayfit/app: added ${list(m.routes.added)}; modified ${list(m.routes.modified)}; ` +
    `removed or renamed ${list(m.routes.removed)}.`);
  if (m.protectedDelta.length === 0) {
    parts.push(`git diff over the protected paths is EMPTY: ${list(PROTECTED_PATHS)} are identical.`);
  } else {
    parts.push(`git diff over the protected paths is NOT EMPTY (${m.protectedDelta.length} file${m.protectedDelta.length === 1 ? '' : 's'}): ` +
      `${list(m.protectedDelta)}. Each needs explicit review.`);
  }
  const ex = m.exports.candidate === null ? 'an export count this script cannot measure' : `${m.exports.candidate.length} names`;
  parts.push(sameFunctions(m)
    ? `The functions-westayfit tree is ${s8(m.functionsTree.candidate)} at both SHAs and src/index.ts exports ${ex}.`
    : `The functions-westayfit tree is ${m.functionsTree.previous ? s8(m.functionsTree.previous) : 'absent'} at the previous SHA and ` +
      `${m.functionsTree.candidate ? s8(m.functionsTree.candidate) : 'absent'} at the candidate, whose src/index.ts exports ${ex}.`);
  parts.push('The staging deploy uses the OPERATIONAL firebase.westayfit.staging.json, not the candidate\'s hosting config. ' +
    'This file records the boundary, not review results.');
  return parts.join(' ');
}

// ---- invariants -----------------------------------------------------------------
export function invariants({ previous, candidate, run, added, m }) {
  const reasons = [];
  if (!m.ancestor) reasons.push(`lineage: ${s8(previous)} is not an ancestor of ${s8(candidate)}`);
  if (m.protectedDelta.length) reasons.push(`protected paths changed: ${m.protectedDelta.join(', ')}`);
  if (!sameFunctions(m)) reasons.push('the functions-westayfit tree changed');
  if (m.exports.previous === null || m.exports.candidate === null) reasons.push('the exported function set cannot be measured');
  else if (m.exports.previous.join() !== m.exports.candidate.join()) reasons.push('the exported function set changed');
  const expected = m.verifier.base === null ? null : [...m.verifier.base, ...added].sort();
  if (expected === null) reasons.push(`the verifier's base inventory cannot be read at ${s8(m.verifier.ref)}`);
  else {
    if (expected.length !== run.after) reasons.push(`the verifier's expected set (${expected.length}) is not the run's AFTER (${run.after})`);
    if (m.exports.candidate !== null && expected.join() !== m.exports.candidate.join()) reasons.push('the candidate\'s exports are not the verifier\'s expected set');
  }
  const missing = m.exports.candidate === null ? [] : added.filter((n) => !m.exports.candidate.includes(n));
  if (missing.length) reasons.push(`candidateAddedFunctions not exported by the candidate: ${missing.join(', ')}`);
  if (run.before !== run.after) reasons.push(`the last run changed the inventory (${run.before} -> ${run.after})`);
  if (run.created !== 'none') reasons.push(`the last run created functions (${run.created})`);
  if (m.releaseEnvironment === null) reasons.push('the release environment was not measured (no --ops-head)');
  else if (m.releaseEnvironment.delta.length) reasons.push(`the release environment changed since run ${run.number}: ${m.releaseEnvironment.delta.join(', ')}`);

  return {
    generator: 'pin-candidate.mjs v1',
    previousApprovedAppSha: previous,
    candidate,
    run: {
      id: run.id, number: run.number, operationalMain: run.main,
      inventoryBefore: run.before, inventoryAfter: run.after, created: run.created,
      verify: 'pass', hostedMarkerMatches: true, hostedVerify: 'pass',
    },
    lineage: { previousIsAncestor: m.ancestor, firstParentCommits: m.firstParent, commits: m.commits },
    protectedPathDelta: m.protectedDelta,
    functionsTree: m.functionsTree,
    exportCount: {
      previous: m.exports.previous === null ? null : m.exports.previous.length,
      candidate: m.exports.candidate === null ? null : m.exports.candidate.length,
    },
    releaseEnvironment: m.releaseEnvironment,
    fastPath: {
      eligible: reasons.length === 0,
      reasons,
      applies: false,
      note: 'Recorded only. The current pin review and human gates stay in force until the generator and the changed-journey smoke are accepted; even then the fast path never bypasses product acceptance, deployment authorization, hosted verification or rollback evidence.',
    },
  };
}

// ---- rotation -----------------------------------------------------------------
/**
 * Insert `key` immediately before the first existing key that starts with
 * `prefix` (history is newest-first), or right after `anchor` when there is no
 * history yet, or at the end when there is no anchor.
 */
function insertHistory(entries, prefix, key, value, anchor) {
  const at = entries.findIndex(([k]) => k.startsWith(prefix));
  if (at !== -1) { entries.splice(at, 0, [key, value]); return; }
  const a = anchor ? entries.findIndex(([k]) => k === anchor) : -1;
  if (a !== -1) entries.splice(a + 1, 0, [key, value]);
  else entries.push([key, value]);
}

/** The pure part: previous approval + measured facts -> next approval object. */
export function nextApproval(prev, { candidate, run, label, acceptedOn, m }) {
  const previous = prev.approvedAppSha;
  const p8 = s8(previous);
  const added = Array.isArray(prev.candidateAddedFunctions) ? [...prev.candidateAddedFunctions] : [];
  for (const k of [`_previousPackageLabel${p8}`, `_previousExpectedPriorFunctionsNote${p8}`, `_previousFullCandidateNote${p8}`]) {
    if (Object.hasOwn(prev, k)) refuse(`the approval already carries ${k}: ${p8} has been rotated out once`);
  }
  for (const k of ['packageLabel', '_expectedPriorFunctionsNote', '_fullCandidateNote']) {
    if (typeof prev[k] !== 'string' || prev[k] === '') refuse(`the approval has no ${k} to rotate into history`);
  }
  const ran = `run ${run.number} (${run.id}) deployed ${run.before} -> ${run.after} with CREATED_THIS_DEPLOY=${run.created} and VERIFY=pass`;

  const entries = Object.entries(prev).filter(([k]) => k !== '_pinInvariants');
  const set = (k, v) => {
    const i = entries.findIndex(([x]) => x === k);
    if (i === -1) entries.push([k, v]); else entries[i] = [k, v];
  };
  set('approvedAppSha', candidate);
  set('packageLabel', label);
  set('sourceAcceptedOn', acceptedOn);
  set('expectedPriorFunctions', run.after);
  set('_rollbackNote', rollbackNote({ previous, run, m }));
  set('_expectedPriorFunctionsNote', expectedPriorNote({ previous, run, added, m }));
  set('_fullCandidateNote', boundaryNote({ previous, candidate, run, m }));
  insertHistory(entries, '_previousExpectedPriorFunctionsNote', `_previousExpectedPriorFunctionsNote${p8}`,
    `HISTORICAL, the note as it stood for the ${p8} pin, true until run ${run.number} deployed it: ${prev._expectedPriorFunctionsNote}`,
    '_expectedPriorFunctionsNote');
  insertHistory(entries, '_previousFullCandidateNote', `_previousFullCandidateNote${p8}`,
    `HISTORICAL, the boundary note for the ${p8} pin: ${prev._fullCandidateNote}`, '_fullCandidateNote');
  insertHistory(entries, '_previousPackageLabel', `_previousPackageLabel${p8}`,
    `HISTORICAL, the label of the ${p8} pin, which ${ran}: ${prev.packageLabel}`, null);
  entries.push(['_pinInvariants', invariants({ previous, candidate, run, added, m })]);
  return Object.fromEntries(entries);
}

export const serialize = (obj) => `${JSON.stringify(obj, null, 2)}\n`;

// ---- CLI ------------------------------------------------------------------------
const FLAGS = {
  approval: 'path', repo: 'path', candidate: 'sha', 'ops-head': 'sha?',
  'run-id': 'int', 'run-number': 'int', 'run-main': 'sha', 'run-date': 'date',
  'inventory-before': 'int', 'inventory-after': 'int', created: 'created',
  verify: 'str', 'hosted-marker': 'str', 'hosted-verify': 'str',
  'label-file': 'path', 'accepted-on': 'date', out: 'path', receipt: 'path?',
};

export function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 1) {
    const m = /^--([a-z-]+)$/.exec(argv[i]);
    if (!m || !(m[1] in FLAGS)) refuse(`unknown argument ${JSON.stringify(argv[i])}`);
    if (m[1] in a) refuse(`--${m[1]} given twice`);
    if (i + 1 >= argv.length) refuse(`--${m[1]} needs a value`);
    a[m[1]] = argv[++i];
  }
  for (const [k, kind] of Object.entries(FLAGS)) {
    const v = a[k];
    if (v === undefined) { if (!kind.endsWith('?')) refuse(`--${k} is required`); continue; }
    const t = kind.replace('?', '');
    if (t === 'sha' && !SHA.test(v)) refuse(`--${k} must be a full 40-character lowercase commit SHA`);
    if (t === 'int' && !/^(0|[1-9][0-9]*)$/.test(v)) refuse(`--${k} must be a non-negative integer`);
    if (t === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) refuse(`--${k} must be YYYY-MM-DD`);
    if (t === 'created' && !/^(none|wsf[a-z0-9]+(,wsf[a-z0-9]+)*)$/.test(v)) refuse('--created must be none or a comma list of lower-case wsf service names');
  }
  return a;
}

export function generate(argv) {
  const a = parseArgs(argv);
  if (a.verify !== 'pass') refuse(`the run did not print VERIFY=pass (got ${a.verify}); a failed run cannot anchor a pin`);
  if (a['hosted-marker'] !== 'true') refuse('the run did not observe its hosted marker; the served SHA is not established');
  if (a['hosted-verify'] !== 'pass') refuse('the run\'s hosted verification job did not pass; the served pin is not known-good');

  let prev;
  try { prev = JSON.parse(fs.readFileSync(a.approval, 'utf8')); } catch { refuse('the approval file is missing or unreadable'); }
  if (prev === null || typeof prev !== 'object' || Array.isArray(prev)) refuse('the approval file is not a JSON object');
  if (prev.project !== 'westayfit-staging') refuse('the approval file does not name westayfit-staging');
  const previous = String(prev.approvedAppSha || '');
  if (!SHA.test(previous)) refuse('the approval file does not carry a valid approvedAppSha');

  const repo = a.repo;
  const candidate = a.candidate;
  if (candidate === previous) refuse('the candidate is the SHA already approved; there is nothing to pin');
  for (const [flag, sha] of [['candidate', candidate], ['run-main', a['run-main']], ['ops-head', a['ops-head']]]) {
    if (sha && !isCommit(repo, sha)) refuse(`--${flag} ${sha} is not a commit in ${repo}`);
  }
  if (!isCommit(repo, previous)) refuse(`the approved SHA ${previous} is not a commit in ${repo}`);

  // The run must have deployed THIS file's pin: the approval it read, on the
  // operational main it ran from, names the SHA being replaced.
  let atRun;
  try { atRun = JSON.parse(git(repo, ['show', `${a['run-main']}:${APPROVAL_REL}`])); } catch { refuse(`no readable approval file at run main ${a['run-main']}`); }
  if (atRun?.approvedAppSha !== previous) {
    refuse(`run main ${s8(a['run-main'])} approved ${atRun?.approvedAppSha}, not ${previous}: that run did not deploy the pin this file replaces`);
  }
  const run = {
    id: Number(a['run-id']), number: Number(a['run-number']), main: a['run-main'], date: a['run-date'],
    before: Number(a['inventory-before']), after: Number(a['inventory-after']), created: a.created,
  };
  if (prev.expectedPriorFunctions !== run.before) {
    refuse(`the run's INVENTORY_BEFORE (${run.before}) is not this file's expectedPriorFunctions (${prev.expectedPriorFunctions}); read-inventory would have refused that run`);
  }

  let label;
  try { label = fs.readFileSync(a['label-file'], 'utf8').replace(/\n$/, ''); } catch { refuse('the label file is missing or unreadable'); }
  if (!label.trim() || /[\r\n]/.test(label)) refuse('the label must be one non-empty line of reviewed prose');

  const m = measure(repo, { previous, candidate, runMain: a['run-main'], opsHead: a['ops-head'] });
  const next = nextApproval(prev, { candidate, run, label, acceptedOn: a['accepted-on'], m });
  return { args: a, next, text: serialize(next) };
}

function receiptText({ next }) {
  const inv = next._pinInvariants;
  return [
    `PIN_CANDIDATE=${inv.candidate}`,
    `PIN_PREVIOUS=${inv.previousApprovedAppSha}`,
    `PIN_EXPECTED_PRIOR_FUNCTIONS=${next.expectedPriorFunctions}`,
    `PIN_PROTECTED_DELTA=${inv.protectedPathDelta.length}`,
    `PIN_FAST_PATH=${inv.fastPath.eligible ? 'eligible' : 'ineligible'}`,
    ...inv.fastPath.reasons.map((r) => `PIN_FAST_PATH_REASON=${r}`),
    'PIN_FAST_PATH_APPLIES=false',
    '',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const r = generate(process.argv.slice(2));
    fs.writeFileSync(r.args.out, r.text);
    const receipt = receiptText(r);
    if (r.args.receipt) fs.writeFileSync(r.args.receipt, receipt);
    process.stdout.write(receipt);
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    console.error(`::error::${e.message}`);
    console.error('PIN=refused');
    process.exit(1);
  }
}
