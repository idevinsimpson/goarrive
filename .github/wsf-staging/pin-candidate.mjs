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
import { checkManifestObject } from './check-milestone-manifest.mjs';
import { drivers as registeredDrivers } from './journeys/index.mjs';
import { DEPLOY_TITLE, targetTitle } from '../../tools/wsf-control/fastpath.mjs';

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
// procedure, so it too leaves the fast path. Two files are excluded, and only
// these two exact paths: the approval file (the thing being changed) and the
// milestone manifest (reviewed release DATA: every visible milestone changes
// its productSha, and it is validated on its own below and again pre-deploy).
// The workflow, this generator, the smoke runner, the driver registry and
// every driver stay inside: a change to any of them takes the human path.
export const RELEASE_ENVIRONMENT_PATHS = Object.freeze([
  '.github/workflows/wsf-staging-deploy.yml',
  '.github/wsf-staging/',
  'firebase.westayfit.staging.json',
]);
const APPROVAL_REL = '.github/wsf-staging/approved-candidate.json';
export const MANIFEST_REL = '.github/wsf-staging/journeys/manifest.json';
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
      ? { from: runMain, to: opsHead, delta: diffNames(repo, runMain, opsHead, RELEASE_ENVIRONMENT_PATHS, [APPROVAL_REL, MANIFEST_REL]) }
      : null,
  };
}

// ---- notes --------------------------------------------------------------------
const s8 = (sha) => sha.slice(0, 8);
const list = (xs) => (xs.length === 0 ? 'none' : xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

function sameFunctions(m) {
  return m.functionsTree.previous !== null && m.functionsTree.previous === m.functionsTree.candidate;
}

/*
 * A LEDGER-SERVED BASELINE (STAGING-PIN-FASTPATH-SERVED-BASELINE-1). A ledger
 * fast-path run (target_source=ledger) serves the control writer's target, not
 * the pin: the pin on its operational main stays the older SHA. Then the SHA
 * staging serves, and the one to roll back to, is the run's target, and the
 * pin is only historical approval ancestry. `served` (null on a full-path run)
 * carries what generate() proved about it: { sha, pin, title, marker, mPin }.
 */
const servedPhrase = (run, served) => `run ${run.number} (${run.id}) served it in ledger fast-path mode (run title "${served.title}", ` +
  `its verifier checking ${served.marker}), dispatched from operational main ${run.main}, whose approval still named the ` +
  `historical pin ${served.pin}; that run did not deploy the pin. It printed `;

export function rollbackNote({ previous, run, m, served = null, superseded = null }) {
  let s = `ROLLBACK TARGET (${ROLLBACK_AUTHORITY}). The previous known-good served app SHA is ${previous}: ` +
    (served ? servedPhrase(run, served) : `run ${run.number} (${run.id}) deployed it, dispatched from operational main ${run.main}, and printed `) +
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
  if (superseded) {
    s += ` The approval this pin replaces named ${superseded.sha}, which no deploy served (superseded before any deploy); ` +
      'it is not a rollback target.';
  }
  return `${s} A note, not a gate: no script reads it.`;
}

export function expectedPriorNote({ previous, run, added, m, served = null, newFunctions = null }) {
  const base = run.after - added.length;
  const what = served ? `served ${s8(previous)} in ledger fast-path mode over the historical pin ${s8(served.pin)}` : `candidate ${s8(previous)}`;
  let s = `${run.after}, the measured live inventory. Run ${run.id} (run ${run.number}, ${run.date}, ${what} ` +
    `from main ${s8(run.main)}), the last deploy-mode run, printed in its own deploy-job log INVENTORY_BEFORE=${run.before}, ` +
    `INVENTORY_AFTER=${run.after}, EXPECTED_INVENTORY=${run.after}, CREATED_THIS_DEPLOY=${run.created}, ` +
    'HOSTED_MARKER_MATCHES=true and VERIFY=pass. read-inventory.mjs refuses a deploy whose live count differs from this number. ';
  if (sameFunctions(m)) {
    s += `THIS PIN'S DEPLOY IS EXPECTED TO CREATE NOTHING (${run.after} -> ${run.after}, CREATED_THIS_DEPLOY=none) and to lose nothing. `;
  } else {
    s += 'THIS PIN CHANGES THE FUNCTION SOURCE, so what its deploy creates or removes is NOT derived here and needs explicit review. ';
  }
  if (newFunctions) {
    const n = newFunctions.names.length;
    s += `THIS PIN ADDS ${word(n)} FUNCTION${n === 1 ? '' : 'S'} to candidateAddedFunctions, measured with git as exported by the candidate ` +
      `and not by ${s8(newFunctions.measuredAgainst)} (${newFunctions.exportsBefore} -> ${newFunctions.exportsAfter} exports, none removed): ` +
      `${list(newFunctions.names)}. Its deploy is expected to create exactly these (${run.after} -> ${run.after + n}), and the verifier's ` +
      `EXPECTED set then becomes the base plus all ${lower(added.length + n)} listed names. `;
  }
  const baseOk = m.verifier.base !== null && m.verifier.base.length === base;
  if (newFunctions) {
    // Same facts as below, worded for a pin whose deploy grows the expected set (the wording without the flag is unchanged).
    const kept = `the ${lower(added.length)} name${added.length === 1 ? '' : 's'} this file already listed`;
    const all = lower(added.length + newFunctions.names.length);
    s += baseOk
      ? `Before this deploy, the verifier's EXPECTED set is the ${base}-name base plus ${kept}, which equals this prior; ` +
        'the verifier reads candidateAddedFunctions from this file in the operational checkout. '
      : `The verifier's base (${m.verifier.base === null ? 'unreadable' : m.verifier.base.length} names at ${s8(m.verifier.ref)}) plus ` +
        `${kept} does NOT equal this prior; review the expected set before dispatch. `;
    return s + 'A function that is not listed fails verification as present but not expected; a listed service that disappears fails, named. ' +
      `A retaining rollback (re-pin to an older candidate while the ${all} listed services remain deployed) must keep ` +
      'candidateAddedFunctions and keep expectedPriorFunctions at the measured BEFORE; removing a name while its service ' +
      'remains is invalid (SOCIAL-ROLLOUT-SEQUENCE.md section 6a).';
  }
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

export function boundaryNote({ previous, candidate, run, m, served = null, superseded = null }) {
  const parts = [];
  if (superseded) {
    parts.push(`${candidate} is measured against ${previous}, the SHA run ${run.number} (${run.id}) ` +
      `${served ? 'served in ledger fast-path mode' : 'deployed'} and whose hosted marker that run observed. ` +
      `The SHA this file previously approved, ${superseded.sha}, was NEVER SERVED: it was approved on operational main after ` +
      `run ${run.number}, descends from ${s8(previous)}, is an ancestor of the candidate, and is superseded by this pin before any deploy.` +
      (superseded.chainedFrom ? ` It had itself superseded ${superseded.chainedFrom}, also NEVER SERVED` +
        (superseded.chain?.length > 1 ? `, which had superseded ${superseded.chain[1]}, also NEVER SERVED.` : '.') : '') +
      (served ? ` The historical pin ${served.pin}, which run ${run.number}'s operational main still named, is approval ancestry only: that run did not deploy it.` : ''));
  } else parts.push(served
    ? `${candidate} is measured against ${previous}, the SHA run ${run.number} (${run.id}) served in ledger fast-path mode and whose ` +
      `hosted marker that run observed. The SHA this file previously approved, ${served.pin}, is historical approval ancestry ` +
      'only: that run did not deploy it.'
    : `${candidate} is measured against ${previous}, the SHA this file previously approved, which run ${run.number} ` +
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
  if (served) {
    const p = served.mPin;
    parts.push(`Against the historical pin ${s8(served.pin)} (an ancestor of ${s8(previous)}): ` +
      `${word(p.firstParent.length)} first-parent commit${p.firstParent.length === 1 ? '' : 's'} (${p.firstParent.map(s8).join(', ') || 'none'}); ` +
      `${p.commits} commit${p.commits === 1 ? '' : 's'} in all; ${p.files} files, +${p.added} / -${p.deleted}, ${p.docs} of them under docs/; ` +
      `protected-path diff ${p.protectedDelta.length ? `NOT EMPTY: ${list(p.protectedDelta)}` : 'EMPTY'}; functions-westayfit tree ` +
      `${sameFunctions(p) ? `${s8(p.functionsTree.candidate)} at both SHAs` : 'CHANGED'}.`);
  }
  parts.push('The staging deploy uses the OPERATIONAL firebase.westayfit.staging.json, not the candidate\'s hosting config. ' +
    'This file records the boundary, not review results.');
  return parts.join(' ');
}

// ---- invariants -----------------------------------------------------------------
function lineageReasons(m, previous, candidate) {
  const reasons = [];
  if (!m.ancestor) reasons.push(`lineage: ${s8(previous)} is not an ancestor of ${s8(candidate)}`);
  if (m.protectedDelta.length) reasons.push(`protected paths changed: ${m.protectedDelta.join(', ')}`);
  if (!sameFunctions(m)) reasons.push('the functions-westayfit tree changed');
  if (m.exports.previous === null || m.exports.candidate === null) reasons.push('the exported function set cannot be measured');
  else if (m.exports.previous.join() !== m.exports.candidate.join()) reasons.push('the exported function set changed');
  return reasons;
}

export function invariants({ previous, candidate, run, added, m, milestone = null, served = null, superseded = null, newFunctions = null }) {
  const reasons = lineageReasons(m, previous, candidate);
  if (superseded) reasons.push(`the approval this pin replaces (${s8(superseded.sha)}) was never served`);
  // A ledger-served baseline must be clean against the historical pin too:
  // the release gate's own fast path compares a candidate with the pin.
  if (served) for (const r of lineageReasons(served.mPin, served.pin, candidate)) reasons.push(`historical pin ${s8(served.pin)}: ${r}`);
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

  const exportCount = (x) => ({
    previous: x.exports.previous === null ? null : x.exports.previous.length,
    candidate: x.exports.candidate === null ? null : x.exports.candidate.length,
  });
  return {
    generator: 'pin-candidate.mjs v1',
    previousApprovedAppSha: superseded ? superseded.sha : served ? served.pin : previous,
    candidate,
    run: {
      id: run.id, number: run.number, operationalMain: run.main,
      inventoryBefore: run.before, inventoryAfter: run.after, created: run.created,
      verify: 'pass', hostedMarkerMatches: true, hostedVerify: 'pass',
      ...(served ? { mode: 'ledger', title: served.title, servedAppSha: previous, verifiedMarker: served.marker } : {}),
    },
    lineage: { previousIsAncestor: m.ancestor, firstParentCommits: m.firstParent, commits: m.commits },
    protectedPathDelta: m.protectedDelta,
    functionsTree: m.functionsTree,
    exportCount: exportCount(m),
    ...(served ? {
      servedBaseline: {
        servedAppSha: previous,
        rollbackTarget: previous,
        historicalPin: served.pin,
        pinIsAncestorOfServed: true,
        servedIsAncestorOfCandidate: true,
        pinLineage: {
          previousIsAncestor: served.mPin.ancestor, firstParentCommits: served.mPin.firstParent, commits: served.mPin.commits,
          protectedPathDelta: served.mPin.protectedDelta, functionsTree: served.mPin.functionsTree, exportCount: exportCount(served.mPin),
        },
      },
    } : {}),
    ...(superseded ? {
      supersededApproval: {
        approvedAppSha: superseded.sha,
        served: false,
        servedAppSha: previous,
        lastDeployedApprovalSha: superseded.deployedPin,
        descendsFromServed: true,
        ancestorOfCandidate: true,
        anchoringRun: run.id,
        matchesOperationalHead: superseded.opsHead,
        ...(superseded.chainedFrom ? { priorNeverServed: superseded.chainedFrom } : {}),
      },
    } : {}),
    ...(newFunctions ? {
      newFunctions: {
        names: newFunctions.names,
        measuredAgainst: newFunctions.measuredAgainst,
        exportsBefore: newFunctions.exportsBefore,
        exportsAfter: newFunctions.exportsAfter,
        removed: [],
      },
    } : {}),
    releaseEnvironment: m.releaseEnvironment,
    milestone,
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

/**
 * The three history entries a pin writes for the never-served approval `file`
 * it supersedes, keyed as nextApproval() inserts them. One definition, so the
 * chain proof (proveLink) checks a holder's history against exactly what this
 * script writes.
 */
export function supersededHistory(file, { run, previous }) {
  const p8 = s8(file.approvedAppSha);
  return {
    [`_previousExpectedPriorFunctionsNote${p8}`]: `HISTORICAL, the note as it stood for the ${p8} pin, which was never served (superseded before any deploy): ${file._expectedPriorFunctionsNote}`,
    [`_previousFullCandidateNote${p8}`]: `HISTORICAL, the boundary note for the ${p8} pin, which was never served: ${file._fullCandidateNote}`,
    [`_previousPackageLabel${p8}`]: `HISTORICAL, the label of the ${p8} pin, which no deploy served: run ${run.number} (${run.id}), the last deploy-mode run, ` +
      `served ${s8(previous)}, and this pin supersedes it before any deploy: ${file.packageLabel}`,
  };
}

/** The pure part: previous approval + measured facts -> next approval object. */
export function nextApproval(deployed, { candidate, run, label, acceptedOn, m, milestone = null, served = null, superseded = null, newFunctions = null }) {
  if (served && served.pin !== deployed.approvedAppSha) refuse('the served baseline does not name this file\'s pin as its historical pin');
  // The SHA staging serves: what the notes measure against and roll back to.
  const previous = served ? served.sha : deployed.approvedAppSha;
  // The file being replaced: the deployed approval, or (superseded) the never-served
  // approval that already rotated the deployed one out. Its pin's notes rotate out.
  if (superseded && superseded.approval.approvedAppSha !== superseded.sha) refuse('the superseded approval does not name the superseded SHA');
  const prev = superseded ? superseded.approval : deployed;
  const p8 = s8(prev.approvedAppSha);
  const retained = Array.isArray(prev.candidateAddedFunctions) ? [...prev.candidateAddedFunctions] : [];
  const added = newFunctions ? [...retained, ...newFunctions.names] : retained;
  for (const k of [`_previousPackageLabel${p8}`, `_previousExpectedPriorFunctionsNote${p8}`, `_previousFullCandidateNote${p8}`]) {
    if (Object.hasOwn(prev, k)) refuse(`the approval already carries ${k}: ${p8} has been rotated out once`);
  }
  for (const k of ['packageLabel', '_expectedPriorFunctionsNote', '_fullCandidateNote']) {
    if (typeof prev[k] !== 'string' || prev[k] === '') refuse(`the approval has no ${k} to rotate into history`);
  }
  const ran = served
    ? `run ${run.number} (${run.id}) did not deploy: that run served ${s8(previous)} in ledger fast-path mode, ${run.before} -> ${run.after} with CREATED_THIS_DEPLOY=${run.created} and VERIFY=pass`
    : `run ${run.number} (${run.id}) deployed ${run.before} -> ${run.after} with CREATED_THIS_DEPLOY=${run.created} and VERIFY=pass`;
  const hist = superseded ? supersededHistory(prev, { run, previous }) : null;

  const entries = Object.entries(prev).filter(([k]) => k !== '_pinInvariants');
  const set = (k, v) => {
    const i = entries.findIndex(([x]) => x === k);
    if (i === -1) entries.push([k, v]); else entries[i] = [k, v];
  };
  set('approvedAppSha', candidate);
  set('packageLabel', label);
  set('sourceAcceptedOn', acceptedOn);
  set('expectedPriorFunctions', run.after);
  if (newFunctions) set('candidateAddedFunctions', added);
  set('_rollbackNote', rollbackNote({ previous, run, m, served, superseded }));
  set('_expectedPriorFunctionsNote', expectedPriorNote({ previous, run, added: retained, m, served, newFunctions }));
  set('_fullCandidateNote', boundaryNote({ previous, candidate, run, m, served, superseded }));
  insertHistory(entries, '_previousExpectedPriorFunctionsNote', `_previousExpectedPriorFunctionsNote${p8}`,
    hist
      ? hist[`_previousExpectedPriorFunctionsNote${p8}`]
      : served
      ? `HISTORICAL, the note as it stood for the ${p8} pin, which run ${run.number} did not deploy (it served ${s8(previous)} in ledger fast-path mode): ${prev._expectedPriorFunctionsNote}`
      : `HISTORICAL, the note as it stood for the ${p8} pin, true until run ${run.number} deployed it: ${prev._expectedPriorFunctionsNote}`,
    '_expectedPriorFunctionsNote');
  insertHistory(entries, '_previousFullCandidateNote', `_previousFullCandidateNote${p8}`,
    hist ? hist[`_previousFullCandidateNote${p8}`] : `HISTORICAL, the boundary note for the ${p8} pin: ${prev._fullCandidateNote}`, '_fullCandidateNote');
  insertHistory(entries, '_previousPackageLabel', `_previousPackageLabel${p8}`,
    hist ? hist[`_previousPackageLabel${p8}`] : `HISTORICAL, the label of the ${p8} pin, which ${ran}: ${prev.packageLabel}`, null);
  entries.push(['_pinInvariants', invariants({ previous, candidate, run, added, m, milestone, served, superseded, newFunctions })]);
  return Object.fromEntries(entries);
}

export const serialize = (obj) => `${JSON.stringify(obj, null, 2)}\n`;

// ---- CLI ------------------------------------------------------------------------
const FLAGS = {
  approval: 'path', repo: 'path', candidate: 'sha', 'ops-head': 'sha?',
  'run-id': 'int', 'run-number': 'int', 'run-main': 'sha', 'run-date': 'date',
  'inventory-before': 'int', 'inventory-after': 'int', created: 'created',
  verify: 'str', 'hosted-marker': 'str', 'hosted-verify': 'str',
  'label-file': 'path', 'accepted-on': 'date', out: 'path', receipt: 'path?', manifest: 'path?',
  'run-title': 'str', 'served-sha': 'sha?', 'run-marker': 'sha?', 'superseded-approval': 'path?', 'added-functions': 'names?',
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
    if (t === 'names' && !/^wsf[a-z0-9]+(,wsf[a-z0-9]+)*$/.test(v)) refuse('--added-functions must be a comma list of lower-case wsf service names');
  }
  return a;
}

/**
 * The milestone this pin declares. `--manifest <file>` is the manifest the pin
 * PR commits; `--manifest none` declares no member-visible milestone (the PR
 * removes any manifest at the operational head). Without the flag, a manifest
 * already at the operational head must describe this candidate. Whatever is
 * declared is checked exactly as the pre-deploy gate will check it, plus the
 * rollback SHA, so a pin is never generated that the gate would then refuse.
 */
function milestoneFor(repo, a, { previous, candidate }) {
  // `previous` is the SHA staging serves (the run's target on a ledger run).
  const opsRef = a['ops-head'] || a['run-main'];
  const atOps = git(repo, ['show', `${opsRef}:${MANIFEST_REL}`], { allowFail: true });
  if (a.manifest === 'none') return { declared: 'none', removesManifestAtOpsHead: atOps !== null };
  let mf;
  let declared = 'supplied';
  if (a.manifest === undefined) {
    if (atOps === null) return { declared: 'none', removesManifestAtOpsHead: false };
    try { mf = JSON.parse(atOps); } catch { refuse(`the manifest at ${s8(opsRef)} is not JSON`); }
    if (mf?.productSha !== candidate) {
      refuse(`the manifest at ${s8(opsRef)} is for ${mf?.productSha}, not this candidate: pass --manifest <file> for ${s8(candidate)}, or --manifest none for a release with no member-visible milestone`);
    }
    declared = 'at operational head';
  } else {
    try { mf = JSON.parse(fs.readFileSync(a.manifest, 'utf8')); } catch { refuse('the --manifest file is missing or is not JSON'); }
  }
  const r = checkManifestObject(mf, { approvedSha: candidate, drivers: registeredDrivers });
  if (r.status !== 'valid') refuse(`the milestone manifest would be refused before deploy: ${r.lines.join('; ')}`);
  if (mf.previousKnownGoodSha !== previous) {
    refuse(`the manifest's previousKnownGoodSha is ${mf.previousKnownGoodSha}, not the served pin ${previous} it rolls back to`);
  }
  return { declared, milestone: mf.milestone, journeys: mf.journeys.map((j) => j.id) };
}

/**
 * What the run served, from its title (the workflow's own run-name) and the
 * marker its verifier checked. A full-path run (`WSF staging · mode=deploy`, or
 * the pre-run-59 `WSF staging deploy`) serves the pin: null, and every note is
 * exactly as before. A ledger run (`… · target=<sha>`) served <sha>, which
 * must be named again by --served-sha and --run-marker, descend from the pin,
 * and be an ancestor of the candidate. Anything else refuses: a run whose
 * served SHA differs from the pin never yields a note saying it deployed the pin.
 */
const LEGACY_DEPLOY_TITLE = 'WSF staging deploy';
function servedBaseline(repo, a, { pin, candidate }) {
  const title = a['run-title'];
  const servedFlag = a['served-sha'];
  const marker = a['run-marker'];
  if (title === DEPLOY_TITLE || title === LEGACY_DEPLOY_TITLE) {
    if (servedFlag !== undefined && servedFlag !== pin) refuse(`a full-path run ("${title}") serves the pin ${pin}; --served-sha names ${servedFlag}`);
    if (marker !== undefined && marker !== pin) refuse(`a full-path run ("${title}") checks the pin ${pin}; --run-marker names ${marker}`);
    return null;
  }
  const prefix = `${DEPLOY_TITLE} · target=`;
  if (!title.startsWith(prefix)) refuse(`the run title ${JSON.stringify(title)} is not a WSF staging deploy-mode run title; only a deploy run can anchor a pin`);
  const target = title.slice(prefix.length);
  if (!SHA.test(target) || title !== targetTitle(target)) refuse(`the run title ${JSON.stringify(title)} does not name a full 40-character target`);
  if (target === pin) refuse(`the ledger run's target is the pin ${pin} itself; that is ambiguous, not a served baseline`);
  if (servedFlag === undefined) {
    refuse(`run served ${target} in ledger fast-path mode, not the pin ${pin}: pass --served-sha ${target} and --run-marker with the SHA its verifier checked`);
  }
  if (servedFlag !== target) refuse(`--served-sha ${servedFlag} is not the run title's target ${target}`);
  if (marker === undefined) refuse('a ledger-served baseline needs --run-marker, the SHA the run\'s verifier checked');
  if (marker !== target) refuse(`--run-marker ${marker} is not the served SHA ${target}: the run's marker did not observe it`);
  if (!isCommit(repo, target)) refuse(`the served SHA ${target} is not a commit in ${repo}`);
  if (!isAncestor(repo, pin, target)) refuse(`the pin ${s8(pin)} is not an ancestor of the served SHA ${s8(target)}: not a fast-path baseline`);
  if (!isAncestor(repo, target, candidate)) refuse(`the served SHA ${s8(target)} is not an ancestor of the candidate ${s8(candidate)}`);
  return { sha: target, pin, title, marker, mPin: null };
}

/**
 * A SUPERSEDED, NEVER-SERVED APPROVAL (EMAIL-STAGING-REPAIR-STAGING-PIN, Director
 * #396 5965941193). Operational main can approve a candidate that no deploy then
 * serves, and a newer accepted candidate replaces it. --approval stays the file
 * the anchoring run deployed (so every run check above still holds), and
 * --superseded-approval is the file actually being replaced. It is accepted only
 * when it is byte-for-byte the approval at --ops-head and at no point served:
 * generated by this script from the same anchoring run and marker, rolling back
 * to the same served SHA, with the same measured inventory and retained set,
 * having already rotated the deployed pin out, and naming an accepted SHA that
 * descends from the served SHA and is an ancestor of the candidate. Anything
 * else refuses; nothing is inferred.
 *
 * A BOUNDED CHAIN (EXPO-LATEST-FULL-STAGING-PIN-1, Director #396 5970631460;
 * one link longer in EXPO-FULL-STAGING-RECOVERY-3, Director #365 6043989729 with
 * the owner's consent 6074607727). The superseded approval may itself stand on
 * never-served approvals, each recorded in the _pinInvariants of the file that
 * replaced it. Each inner link is accepted only as recorded there AND as its own
 * approval file says, read from git at the operational commit the record names
 * (innerChain). At most MAX_NEVER_SERVED never-served approvals stand between
 * the deployed pin and the candidate, and nothing older is trusted.
 */
export const MAX_NEVER_SERVED = 3;
function supersededApproval(repo, a, { deployed, deployedText, served, run, candidate }) {
  const file = a['superseded-approval'];
  if (file === undefined) return null;
  const opsHead = a['ops-head'];
  if (!opsHead) refuse('--superseded-approval needs --ops-head: the file it replaces is the approval at the operational head');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { refuse('the superseded approval file is missing or unreadable'); }
  const atOps = git(repo, ['show', `${opsHead}:${APPROVAL_REL}`], { allowFail: true });
  if (atOps === null || text !== atOps) refuse(`the superseded approval is not the approval at the operational head ${s8(opsHead)}, the file this pin replaces`);
  const atRun = git(repo, ['show', `${a['run-main']}:${APPROVAL_REL}`]);
  if (deployedText !== atRun) refuse(`--approval is not byte-for-byte the approval run main ${s8(a['run-main'])} read: with --superseded-approval it must be the deployed file`);
  let sup;
  try { sup = JSON.parse(text); } catch { refuse('the superseded approval is not JSON'); }
  if (sup === null || typeof sup !== 'object' || Array.isArray(sup) || sup.project !== 'westayfit-staging') refuse('the superseded approval is not a westayfit-staging approval object');
  const sha = String(sup.approvedAppSha || '');
  if (!SHA.test(sha)) refuse('the superseded approval does not carry a valid approvedAppSha');
  if (!isCommit(repo, sha)) refuse(`the superseded SHA ${sha} is not a commit in ${repo}`);
  const servedSha = served ? served.sha : deployed.approvedAppSha;
  if (sha === servedSha || sha === deployed.approvedAppSha) {
    refuse(`the superseded SHA ${sha} was served or deployed by run ${run.number}: it is not superseded; generate from its own deployed approval`);
  }
  if (sha === candidate) refuse('the superseded SHA is the candidate; there is nothing to pin');
  if (!isAncestor(repo, servedSha, sha)) refuse(`the superseded SHA ${s8(sha)} does not descend from the served SHA ${s8(servedSha)}`);
  if (!isAncestor(repo, sha, candidate)) refuse(`the superseded SHA ${s8(sha)} is not an ancestor of the candidate ${s8(candidate)}: accepted ancestry would be dropped`);
  // The evidence that it was never served: this script wrote it from the same anchoring run.
  const inv = sup._pinInvariants;
  if (!inv || typeof inv !== 'object' || !inv.run) refuse('the superseded approval carries no _pinInvariants: there is no evidence of the run it was generated from');
  const didNotReplace = () => refuse(`the superseded approval's invariants do not record ${s8(deployed.approvedAppSha)} -> ${s8(sha)}: it did not replace the deployed approval`);
  if (inv.candidate !== sha) didNotReplace();
  let chain = [];
  if (inv.previousApprovedAppSha !== deployed.approvedAppSha) {
    if (inv.supersededApproval === undefined) didNotReplace();
    chain = innerChain(repo, { inv, sup, sha, deployed, served, servedSha, run, opsHead, candidate });
  }
  if (inv.run.id !== run.id || inv.run.operationalMain !== run.main) {
    refuse(`the superseded approval was generated from run ${inv.run.id} on ${inv.run.operationalMain}, not run ${run.id} on ${run.main}: stale run evidence`);
  }
  const supServed = inv.run.servedAppSha ?? null;
  const supMarker = inv.run.verifiedMarker ?? null;
  if (served ? (supServed !== served.sha || supMarker !== served.marker) : (supServed !== null || supMarker !== null)) {
    refuse(`the superseded approval records the run served ${supServed} (marker ${supMarker}), not this run's ${served ? served.sha : 'pin'}: stale run or marker`);
  }
  const rollback = inv.servedBaseline ? inv.servedBaseline.rollbackTarget : inv.previousApprovedAppSha;
  if (rollback !== servedSha) refuse(`the superseded approval rolls back to ${rollback}, not the served ${servedSha}`);
  if (sup.expectedPriorFunctions !== run.after || sup.expectedPriorFunctions !== deployed.expectedPriorFunctions) {
    refuse(`the superseded approval expects ${sup.expectedPriorFunctions} prior functions, not the measured ${run.after}`);
  }
  const set = (x) => JSON.stringify(Array.isArray(x) ? x : null);
  if (set(sup.candidateAddedFunctions) !== set(deployed.candidateAddedFunctions)) refuse('the superseded approval does not retain the deployed approval\'s candidateAddedFunctions exactly');
  const d8 = s8(deployed.approvedAppSha);
  if (!Object.hasOwn(sup, `_previousPackageLabel${d8}`)) refuse(`the superseded approval has not rotated the deployed pin ${d8} into history: its ancestry is not the deployed approval's`);
  return { sha, approval: sup, deployedPin: deployed.approvedAppSha, opsHead, chainedFrom: chain[0] ?? null, chain };
}

/**
 * The never-served links a superseded approval stands on, outermost first. Each
 * link is the SHA its holder (the file that replaced it) names as
 * previousApprovedAppSha and records in _pinInvariants.supersededApproval, and
 * is accepted only when BOTH hold:
 *   - the record, re-proved against git: never served; the same deployed pin,
 *     served SHA and anchoring run; descended from the served SHA; a strict
 *     ancestor of its holder; not the served SHA, the deployed pin, the
 *     candidate or any SHA already in the chain (no cycle);
 *   - the link's OWN approval file, read from git at the operational commit the
 *     record names (matchesOperationalHead), which must be an operational commit
 *     after the anchoring run's main and strictly before its holder's: it names
 *     the link, was generated by this script from the same run, marker,
 *     rollback, inventory and retained set, rotated the deployed pin out, and is
 *     what its holder's history quotes word for word; every history entry it
 *     kept, its holder still carries verbatim (history is append-only).
 * A link whose own file replaced the deployed pin ends the chain and must say
 * nothing earlier; a link that chains must name exactly the prior its record
 * names. More than MAX_NEVER_SERVED never-served approvals in all refuses.
 */
function innerChain(repo, { inv, sup, sha, deployed, served, servedSha, run, opsHead, candidate }) {
  const chain = [];
  const seen = new Set([servedSha, deployed.approvedAppSha, candidate, sha]);
  let holder = { approval: sup, inv, sha, commit: opsHead };
  let record = inv.supersededApproval;
  for (;;) {
    if (1 + chain.length + 1 > MAX_NEVER_SERVED) {
      refuse(`the superseded approval's never-served chain is too long: ${s8(holder.sha)} itself superseded ${s8(String(holder.inv.previousApprovedAppSha))}, ` +
        `a fourth never-served approval; at most ${lower(MAX_NEVER_SERVED)} never-served approvals may be superseded`);
    }
    const link = proveLink(repo, { record, holder, depth: chain.length + 1, deployed, served, servedSha, run, seen });
    chain.push(link.sha);
    seen.add(link.sha);
    const bad = (why) => refuse(`the superseded approval's inner link ${chain.length} cannot be proved: ${why}`);
    if (link.inv.previousApprovedAppSha === deployed.approvedAppSha) {
      if (Object.hasOwn(record, 'priorNeverServed')) bad(`its record names an earlier never-served ${record.priorNeverServed}, but ${s8(link.sha)}'s own approval replaced the deployed pin directly`);
      if (link.inv.supersededApproval !== undefined) bad(`${s8(link.sha)}'s own approval replaced the deployed pin directly yet records a superseded approval`);
      return chain;
    }
    if (!Object.hasOwn(record, 'priorNeverServed')) bad(`its record names no earlier never-served approval, but ${s8(link.sha)}'s own approval replaced ${link.inv.previousApprovedAppSha}`);
    if (record.priorNeverServed !== link.inv.previousApprovedAppSha) bad(`its record names the earlier never-served ${record.priorNeverServed}, but ${s8(link.sha)}'s own approval replaced ${link.inv.previousApprovedAppSha}`);
    if (link.inv.supersededApproval === undefined) bad(`${s8(link.sha)}'s own approval replaced ${link.inv.previousApprovedAppSha} but records no superseded approval`);
    holder = { approval: link.approval, inv: link.inv, sha: link.sha, commit: record.matchesOperationalHead };
    record = link.inv.supersededApproval;
  }
}

/** One never-served link, re-proved from its record and from its own approval file; see innerChain(). */
function proveLink(repo, { record, holder, depth, deployed, served, servedSha, run, seen }) {
  const bad = (why) => refuse(`the superseded approval's inner link ${depth} cannot be proved: ${why}`);
  if (record === null || typeof record !== 'object' || Array.isArray(record)) bad('its supersededApproval record is malformed');
  const keys = ['approvedAppSha', 'served', 'servedAppSha', 'lastDeployedApprovalSha', 'descendsFromServed', 'ancestorOfCandidate', 'anchoringRun', 'matchesOperationalHead'];
  for (const k of keys) if (!Object.hasOwn(record, k)) bad(`its supersededApproval record has no ${k}`);
  for (const k of Object.keys(record)) if (![...keys, 'priorNeverServed'].includes(k)) bad(`its supersededApproval record carries an unknown ${k}`);
  const p = record.approvedAppSha;
  if (typeof p !== 'string' || !SHA.test(p)) bad('it names no valid SHA');
  if (p !== holder.inv.previousApprovedAppSha) bad(`it names ${p}, but the approval says it replaced ${holder.inv.previousApprovedAppSha}`);
  if (record.served !== false) bad(`${s8(p)} is not recorded as never served`);
  if (record.lastDeployedApprovalSha !== deployed.approvedAppSha) bad(`it was measured from the deployed pin ${record.lastDeployedApprovalSha}, not ${deployed.approvedAppSha}`);
  if (record.servedAppSha !== servedSha) bad(`it records the served SHA ${record.servedAppSha}, not ${servedSha}`);
  if (record.anchoringRun !== run.id) bad(`it was anchored on run ${record.anchoringRun}, not run ${run.id}`);
  if (record.descendsFromServed !== true || record.ancestorOfCandidate !== true) bad('it does not record its own lineage checks as held');
  if (Object.hasOwn(record, 'priorNeverServed') && (typeof record.priorNeverServed !== 'string' || !SHA.test(record.priorNeverServed))) bad('its priorNeverServed is not a valid SHA');
  if (!isCommit(repo, p)) bad(`${p} is not a commit in ${repo}`);
  if (seen.has(p)) bad(`${s8(p)} is the served SHA, the deployed pin, the candidate, the superseded SHA or a link already in the chain`);
  if (!isAncestor(repo, servedSha, p)) bad(`${s8(p)} does not descend from the served SHA ${s8(servedSha)}`);
  if (!isAncestor(repo, p, holder.sha)) bad(`${s8(p)} is not an ancestor of ${s8(holder.sha)}, the approval that replaced it`);
  if (!Object.hasOwn(holder.approval, `_previousPackageLabel${s8(p)}`)) bad(`the approval has not rotated ${s8(p)} into its history`);

  // ITS OWN FILE: the approval at the operational commit where the record says it stood.
  const at = record.matchesOperationalHead;
  if (typeof at !== 'string' || !SHA.test(at) || !isCommit(repo, at)) bad(`it names no operational commit for ${s8(p)}`);
  if (at === holder.commit || !isAncestor(repo, at, holder.commit)) {
    bad(`${s8(at)}, where it records ${s8(p)} stood, is not an operational commit before ${s8(holder.commit)}, where the approval that replaced it stands`);
  }
  if (!isAncestor(repo, run.main, at)) bad(`${s8(at)} is not on operational main after run ${run.number}'s ${s8(run.main)}: ${s8(p)} was not approved after that run`);
  const text = git(repo, ['show', `${at}:${APPROVAL_REL}`], { allowFail: true });
  if (text === null) bad(`there is no approval file at ${s8(at)}`);
  let file;
  try { file = JSON.parse(text); } catch { bad(`the approval file at ${s8(at)} is not JSON`); }
  if (file === null || typeof file !== 'object' || Array.isArray(file) || file.project !== 'westayfit-staging') bad(`the approval at ${s8(at)} is not a westayfit-staging approval object`);
  if (file.approvedAppSha !== p) bad(`the approval at ${s8(at)} names ${file.approvedAppSha}, not ${p}`);
  const finv = file._pinInvariants;
  if (!finv || typeof finv !== 'object' || !finv.run) bad(`the approval at ${s8(at)} carries no _pinInvariants`);
  if (finv.candidate !== p) bad(`the approval at ${s8(at)} records the candidate ${finv.candidate}, not ${p}`);
  if (finv.run.id !== run.id || finv.run.operationalMain !== run.main) {
    bad(`the approval at ${s8(at)} was generated from run ${finv.run.id} on ${finv.run.operationalMain}, not run ${run.id} on ${run.main}: stale run evidence`);
  }
  const fServed = finv.run.servedAppSha ?? null;
  const fMarker = finv.run.verifiedMarker ?? null;
  if (served ? (fServed !== served.sha || fMarker !== served.marker) : (fServed !== null || fMarker !== null)) {
    bad(`the approval at ${s8(at)} records the run served ${fServed} (marker ${fMarker}), not this run's ${served ? served.sha : 'pin'}: stale run or marker`);
  }
  const rollback = finv.servedBaseline ? finv.servedBaseline.rollbackTarget : finv.previousApprovedAppSha;
  if (rollback !== servedSha) bad(`the approval at ${s8(at)} rolls back to ${rollback}, not the served ${servedSha}`);
  if (file.expectedPriorFunctions !== run.after || file.expectedPriorFunctions !== deployed.expectedPriorFunctions) {
    bad(`the approval at ${s8(at)} expects ${file.expectedPriorFunctions} prior functions, not the measured ${run.after}`);
  }
  const set = (x) => JSON.stringify(Array.isArray(x) ? x : null);
  if (set(file.candidateAddedFunctions) !== set(deployed.candidateAddedFunctions)) bad(`the approval at ${s8(at)} does not retain the deployed approval's candidateAddedFunctions exactly`);
  if (!Object.hasOwn(file, `_previousPackageLabel${s8(deployed.approvedAppSha)}`)) bad(`the approval at ${s8(at)} has not rotated the deployed pin ${s8(deployed.approvedAppSha)} into history`);
  for (const [k, v] of Object.entries(supersededHistory(file, { run, previous: servedSha }))) {
    if (holder.approval[k] !== v) bad(`${s8(holder.sha)}'s ${k} is not ${s8(p)}'s own approval at ${s8(at)}, rotated as a never-served pin`);
  }
  // History is append-only: whatever the link's own file kept as history, its holder still carries verbatim.
  for (const [k, v] of Object.entries(file)) {
    if (k.startsWith('_previous') && holder.approval[k] !== v) bad(`${s8(holder.sha)} does not carry ${k} exactly as ${s8(p)}'s own approval at ${s8(at)} has it`);
  }
  return { sha: p, approval: file, inv: finv };
}

/**
 * NEW FUNCTIONS (EXPO-FULL-STAGING-RECOVERY-3; the owner's approval in the W3
 * session). A candidate that exports callables the served build does not fails
 * the verifier as "present but not expected" unless the pin lists them in
 * candidateAddedFunctions (SOCIAL-ROLLOUT-SEQUENCE.md section 6, step 4).
 * --added-functions names them and is accepted only when it is EXACTLY what git
 * measures: the candidate's exports minus the served build's, with nothing
 * removed (this workflow cannot remove a function), none already expected (the
 * verifier base or the retained list) and none named twice. Nothing is inferred:
 * without the flag the retained list is carried exactly as before.
 */
function addedFunctions(flag, { m, base, retained }) {
  if (flag === undefined) return null;
  const names = flag.split(',');
  if (new Set(names).size !== names.length) refuse('--added-functions names a function twice');
  if (m.exports.previous === null || m.exports.candidate === null) refuse(`--added-functions needs the exports of ${s8(base)} and of the candidate measured, and one of them cannot be`);
  if (m.verifier.base === null) refuse(`--added-functions needs the verifier's base inventory, which cannot be read at ${s8(m.verifier.ref)}`);
  const removed = m.exports.previous.filter((n) => !m.exports.candidate.includes(n));
  if (removed.length) refuse(`the candidate no longer exports ${removed.join(', ')}, which ${s8(base)} exports: this workflow cannot remove a function`);
  const measured = m.exports.candidate.filter((n) => !m.exports.previous.includes(n));
  const missing = measured.filter((n) => !names.includes(n));
  const extra = names.filter((n) => !measured.includes(n));
  if (missing.length || extra.length) {
    refuse(`--added-functions is not the export delta git measures from ${s8(base)} to the candidate: ` +
      [missing.length ? `new and not listed: ${missing.join(', ')}` : '', extra.length ? `listed and not new: ${extra.join(', ')}` : ''].filter(Boolean).join('; '));
  }
  const kept = Array.isArray(retained) ? retained : [];
  const already = names.filter((n) => kept.includes(n) || m.verifier.base.includes(n));
  if (already.length) refuse(`--added-functions names ${already.join(', ')}, already in the verifier's expected set`);
  return { names: [...names].sort(), measuredAgainst: base, exportsBefore: m.exports.previous.length, exportsAfter: m.exports.candidate.length };
}

export function generate(argv) {
  const a = parseArgs(argv);
  if (a.verify !== 'pass') refuse(`the run did not print VERIFY=pass (got ${a.verify}); a failed run cannot anchor a pin`);
  if (a['hosted-marker'] !== 'true') refuse('the run did not observe its hosted marker; the served SHA is not established');
  if (a['hosted-verify'] !== 'pass') refuse('the run\'s hosted verification job did not pass; the served pin is not known-good');

  let prev;
  let prevText;
  try { prevText = fs.readFileSync(a.approval, 'utf8'); prev = JSON.parse(prevText); } catch { refuse('the approval file is missing or unreadable'); }
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
  const served = servedBaseline(repo, a, { pin: previous, candidate });
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

  const superseded = supersededApproval(repo, a, { deployed: prev, deployedText: prevText, served, run, candidate });
  const base = served ? served.sha : previous;
  const m = measure(repo, { previous: base, candidate, runMain: a['run-main'], opsHead: a['ops-head'] });
  if (served) served.mPin = measure(repo, { previous, candidate, runMain: a['run-main'], opsHead: a['ops-head'] });
  const newFunctions = addedFunctions(a['added-functions'], { m, base, retained: (superseded ? superseded.approval : prev).candidateAddedFunctions });
  const milestone = milestoneFor(repo, a, { previous: base, candidate });
  const next = nextApproval(prev, { candidate, run, label, acceptedOn: a['accepted-on'], m, milestone, served, superseded, newFunctions });
  return { args: a, next, text: serialize(next) };
}

function receiptText({ next }) {
  const inv = next._pinInvariants;
  return [
    `PIN_CANDIDATE=${inv.candidate}`,
    `PIN_PREVIOUS=${inv.previousApprovedAppSha}`,
    ...(inv.supersededApproval ? [`PIN_SUPERSEDED_NEVER_SERVED=${inv.supersededApproval.approvedAppSha}`] : []),
    ...(inv.servedBaseline ? [`PIN_SERVED=${inv.servedBaseline.servedAppSha}`, `PIN_ROLLBACK=${inv.servedBaseline.rollbackTarget}`] : []),
    `PIN_EXPECTED_PRIOR_FUNCTIONS=${next.expectedPriorFunctions}`,
    ...(inv.newFunctions ? [`PIN_ADDED_FUNCTIONS=${inv.newFunctions.names.join(',')}`] : []),
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
