#!/usr/bin/env node
/**
 * THE WSF PRODUCTION PRE-FLIGHT. A refusal here is the cheapest place a bad
 * production deploy can stop.
 *
 * PRODUCTION-DEPLOY-PATH-1 (#365 6075293313). Production is the SHARED
 * `goarrive` Firebase project, and GoArrive lives there too. This guard runs on
 * an operator's local clone BEFORE any credentialed command. It answers one
 * question: is this exact candidate, with this exact config, this exact
 * worktree and this exact command, a WSF-only deploy that cannot reach
 * GoArrive?
 *
 * PURE AND NETWORK-FREE. It reads local git objects (`git show`,
 * `git merge-base`, `git status`) and the files it is given. It never fetches,
 * never logs in, never writes a file, and never runs firebase or gcloud. It
 * prints one JSON verdict on stdout, and never a value from the env file. Exit
 * 0 means every check passed; exit 1 means at least one refused; exit 2 means
 * the inputs themselves were unusable.
 *
 * WHAT IT REFUSES, AND WHY (the inventory is #599 at 80b603c7):
 *   - A candidate that is operational main, or that is not the reviewed
 *     development anchor ec162d17 (A) or a descendant of it (B). Main has ONE
 *     WSF export, so a functions:westayfit deploy from it would prune every
 *     other `westayfit` function. The anchor is fixed here; the CLI cannot
 *     replace it.
 *   - A candidate or main missing a file the checks read: refused as a check,
 *     so the verdict always prints.
 *   - An export list different from the candidate's reviewed manifest (59
 *     names at A). The 17 `invoker: 'public'` declarations are checked as a
 *     SOURCE invariant only: with firebase-functions 4.9.0 and firebase-tools
 *     15.30.1 the option is inert for onCall, and every callable gets
 *     `allUsers` run.invoker when it is created (#599 section 3).
 *   - A firestore.rules that differs from main's anywhere outside the single
 *     WSF section, whose WSF section matches any path that is not a wsf*
 *     collection or has unbalanced braces, or that loses the catch-all deny.
 *     The ruleset is shared: deploying it replaces GoArrive's rules too, so a
 *     rules deploy also needs the live ruleset, which must equal main outside
 *     its own WSF section.
 *   - Indexes that drop or change any of main's, or add a non-WSF one.
 *   - A production config that declares anything beyond the `westayfit`
 *     functions codebase and Firestore rules/indexes, or that differs from
 *     main's reviewed file (its predeploy runs with the operator's
 *     credentials).
 *   - A deploy worktree whose HEAD is not the candidate, or that holds any
 *     change beyond the production config and the functions env file; and an
 *     env file that does not set WSF_APP_URL to https://app.westay.fit and a
 *     westay.fit sender.
 *   - A deploy command with --force, any Hosting or Storage target,
 *     `firestore:indexes` (the runbook creates the two WSF indexes with
 *     gcloud), a bare `functions` target, GoArrive's `default` codebase, a
 *     missing --only, firebase.json, any project other than goarrive, or any
 *     flag given twice (firebase-tools keeps the last one). --non-interactive
 *     is required, with ONE named exception: `--interactive-reason
 *     minimum-bill` checks the reviewed interactive functions command the
 *     runbook uses when the non-interactive one stopped on the minimum-bill
 *     prompt (#599 S2), and then --non-interactive must be absent.
 *   - For candidate B: a consent version that is pending, blank or a
 *     placeholder, server and client constants that disagree, or any change
 *     beyond the consent constants, the policy text, and test files that
 *     change only by the version string.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** The reviewed development anchor: candidate A exactly, and B's parent line. */
export const ANCHOR_A = 'ec162d17a0540e936741027f9b8f90dd372cfaf4';
/**
 * Record G, the GATED successor: `claude/wsf-app-shell` after ANON-GATE-1 (#601)
 * merged over A (#365 6078945971 item 6). It must be exactly this commit, and
 * its difference from A must be exactly CANDIDATE_G_DELTA_PATHS.
 */
export const ANCHOR_G = 'e65bfee9eecb2370f602d09880da604709fba58a';
export const CANDIDATE_G_DELTA_PATHS = Object.freeze([
  'docs/westayfit/ops/security/ANON-GATE-1.md',
  'functions-westayfit/src/anon-gate.ts',
  'functions-westayfit/src/index.ts',
  'functions-westayfit/tests/callable/wsf-anon-gate.test.ts',
]);
/** The only action handler a production env file may name: the callables' own default. */
export const PRODUCTION_ACTION_HANDLER = 'https://goarrive.firebaseapp.com/__/auth/action';
export const PRODUCTION_PROJECT = 'goarrive';
export const PRODUCTION_CONFIG = 'firebase.westayfit.production.json';
export const WSF_CODEBASE = 'westayfit';
export const WSF_SOURCE = 'functions-westayfit';
export const WSF_APP_URL = 'https://app.westay.fit';
export const ENV_FILE = `${WSF_SOURCE}/.env.${PRODUCTION_PROJECT}`;
export const PENDING_CONSENT = 'pending-approval-2026-08-25';

/** The 59 exports of functions-westayfit/src/index.ts at ec162d17, in source order. Candidate B adds none. */
export const CANDIDATE_A_EXPORTS = Object.freeze([
  'wsfHealth', 'wsfSaveProfile', 'wsfCreateCommunity', 'wsfSendVerificationEmail', 'wsfPreviewCommunity',
  'wsfJoinCommunity', 'wsfResolveMarker', 'wsfJoinViaMarker', 'wsfPublicPreviewLabel', 'wsfResetJoinCode',
  'wsfRemoveMember', 'wsfLeaveCommunity', 'wsfReinstateMember', 'wsfDesignateChampion', 'wsfListChallenge',
  'wsfCheckIn', 'wsfMyCommunities', 'wsfChallengePulse', 'wsfSendPasswordResetEmail', 'wsfCreateGoal',
  'wsfContribute', 'wsfGoalPulse', 'wsfGoalRecentAdditions', 'wsfMyContribution', 'wsfListGoals',
  'wsfSetGoalDisplayAuthorization', 'wsfAdjustGoal', 'wsfStationRequestPairing', 'wsfStationPairingStatus',
  'wsfApproveStation', 'wsfStationClaimPairing', 'wsfStationState', 'wsfListStations', 'wsfRevokeStation',
  'wsfCreateCombinedGoal', 'wsfCloseCombinedGoal', 'wsfRepairCombinedGoal', 'wsfCombinedGoalPulse',
  'wsfEventContext', 'wsfJoinTurnLine', 'wsfMyTurn', 'wsfTurnReady', 'wsfLeaveTurnLine', 'wsfTurnState',
  'wsfCallNext', 'wsfStartTurn', 'wsfCompleteTurn', 'wsfCompleteMyTurn', 'wsfCancelTurn',
  'wsfSetCommunityVisibility', 'wsfCommunityMembers', 'wsfMyProfilePhoto', 'wsfSetProfilePhoto',
  'wsfRemoveProfilePhoto', 'wsfSetPortraitDecision', 'wsfSetCommunityPhotoVisibility', 'wsfCommunityFaces',
  'wsfCommunityFacePhotos', 'wsfCommunityActivity',
]);

/**
 * The 17 exports that DECLARE `invoker: 'public'` in source at ec162d17: a
 * source-identity invariant, and NOT the deployed IAM. For onCall the option is
 * inert with these versions; every one of the 59 receives `allUsers`
 * run.invoker when it is created, and each handler's own auth check is the
 * control (#599 section 3).
 */
export const CANDIDATE_A_PUBLIC = Object.freeze([
  'wsfPreviewCommunity', 'wsfResolveMarker', 'wsfPublicPreviewLabel', 'wsfChallengePulse',
  'wsfSendPasswordResetEmail', 'wsfGoalPulse', 'wsfGoalRecentAdditions', 'wsfStationRequestPairing',
  'wsfStationPairingStatus', 'wsfStationClaimPairing', 'wsfStationState', 'wsfCombinedGoalPulse',
  'wsfTurnState', 'wsfCallNext', 'wsfStartTurn', 'wsfCompleteTurn', 'wsfCancelTurn',
]);

const SERVER_CONSENT_FILE = `${WSF_SOURCE}/src/index.ts`;
const CLIENT_CONSENT_FILE = 'apps/westayfit/src/profileConstants.ts';
/** Paths a candidate B may change relative to A: the consent constants, and the policy text they version. None but index.ts is deployed. */
export const CANDIDATE_B_ALLOWED_PATHS = Object.freeze([
  SERVER_CONSENT_FILE, CLIENT_CONSENT_FILE, 'apps/westayfit/src/legalContent.ts',
  'apps/westayfit/legal/terms.md', 'apps/westayfit/legal/privacy.md',
]);
/** Test trees that pin the consent version. B may change a file here by that version string and nothing else. None is deployed. */
export const CANDIDATE_B_VERSION_ONLY_PREFIXES = Object.freeze([`${WSF_SOURCE}/tests/`, 'apps/westayfit/tests-e2e/']);
const CONSENT_NAMES = ['WSF_ACCEPTED_TERMS_VERSION', 'WSF_ACCEPTED_PRIVACY_VERSION'];
const SHA40 = /^[0-9a-f]{40}$/;

// ── pure checks: strings and objects in, findings out ──────────────────────

const check = (id, ok, detail) => ({ id, ok: Boolean(ok), detail });

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * The deployable exports of an index.ts and which of them declare
 * `invoker: 'public'`. A wildcard re-export cannot be verified statically, so
 * it is reported and refused rather than guessed at.
 */
export function parseExports(indexSource) {
  const src = stripComments(indexSource);
  const names = [];
  const publicNames = [];
  const wildcard = /^export\s+\*\s+from\s/m.test(src);
  const re = /^export const (\w+)\s*=\s*(onCall|onRequest|onSchedule|onDocument\w*|onTaskDispatched|onObject\w*|onMessagePublished|beforeUser\w*)\b(?:<[^\n]*?>)?\(\s*/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    names.push(m[1]);
    const rest = src.slice(re.lastIndex);
    if (rest.startsWith('{')) {
      let depth = 0;
      for (let i = 0; i < rest.length; i += 1) {
        if (rest[i] === '{') depth += 1;
        if (rest[i] === '}') depth -= 1;
        if (depth === 0) {
          if (/invoker:\s*'public'/.test(rest.slice(0, i + 1))) publicNames.push(m[1]);
          break;
        }
      }
    }
  }
  for (const r of src.matchAll(/^export\s*\{([^}]*)\}\s*from\s*['"][^'"]+['"]/gm)) {
    for (const part of r[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.push(name);
    }
  }
  return { names, publicNames, wildcard };
}

export function checkExports(indexSource, manifest = CANDIDATE_A_EXPORTS, publicManifest = CANDIDATE_A_PUBLIC) {
  const { names, publicNames, wildcard } = parseExports(indexSource);
  const sorted = (a) => [...a].sort();
  const missing = manifest.filter((n) => !names.includes(n));
  const extra = names.filter((n) => !manifest.includes(n));
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  const pubMissing = publicManifest.filter((n) => !publicNames.includes(n));
  const pubExtra = publicNames.filter((n) => !publicManifest.includes(n));
  return [
    check('exports.no-wildcard', !wildcard, wildcard ? 'index.ts has `export * from`, which cannot be verified' : 'no wildcard re-export'),
    check('exports.match-manifest', missing.length === 0 && extra.length === 0 && dupes.length === 0,
      `${names.length} exports; manifest ${manifest.length}` + (missing.length ? `; missing ${missing.join(',')}` : '') + (extra.length ? `; unexpected ${extra.join(',')}` : '') + (dupes.length ? `; duplicated ${dupes.join(',')}` : '')),
    check('exports.public-invokers', pubMissing.length === 0 && pubExtra.length === 0 && JSON.stringify(sorted(publicNames)) === JSON.stringify(sorted(publicManifest)),
      `source invariant, not deployed IAM: ${publicNames.length} declare invoker 'public'; expected ${publicManifest.length}` + (pubMissing.length ? `; missing ${pubMissing.join(',')}` : '') + (pubExtra.length ? `; unexpected ${pubExtra.join(',')}` : '')),
  ];
}

const CATCH_ALL = /^\s*match \/\{document=\*\*\} \{\s*$/;
/** Any `match /` token, however it is spaced, with line comments removed first. */
const MATCH_TOKEN = /\bmatch\s*\//;
/** A rules line with its `//` comment removed, where `//` inside a quoted string is not a comment. */
function ruleLine(l) {
  let quote = null;
  for (let i = 0; i < l.length; i += 1) {
    const c = l[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === '/' && l[i + 1] === '/') return l.slice(0, i);
  }
  return l;
}

/**
 * Splits firestore.rules into what is outside the WSF section and the section
 * itself. The section starts at the rule line just above the "WE STAY FIT
 * (WSF)" banner and runs to the catch-all deny. A file with no banner has an
 * empty section, which is what main has today.
 */
export function splitWsfSection(rulesText) {
  const lines = rulesText.split('\n');
  const banner = lines.findIndex((l) => /WE STAY FIT \(WSF\)/.test(l));
  const catchAll = lines.findIndex((l) => CATCH_ALL.test(l));
  const lastMatch = [...lines.keys()].filter((i) => MATCH_TOKEN.test(ruleLine(lines[i]))).pop();
  const catchAllLast = catchAll !== -1 && lastMatch === catchAll;
  if (banner === -1) return { outside: rulesText, section: '', catchAll: catchAll !== -1, wellFormed: catchAllLast };
  let start = banner;
  if (start > 0 && /^\s*\/\/\s*─+\s*$/.test(lines[start - 1])) start -= 1;
  if (catchAll === -1 || catchAll < banner) return { outside: rulesText, section: '', catchAll: catchAll !== -1, wellFormed: false };
  const section = lines.slice(start, catchAll).join('\n');
  const outside = [...lines.slice(0, start), ...lines.slice(catchAll)].join('\n');
  return { outside, section, catchAll: true, wellFormed: catchAllLast };
}

/** Every match in a WSF section must open a wsf* collection, and its braces must balance. */
export function wsfSectionScope(section) {
  const code = section.split('\n').map(ruleLine).join('\n');
  const bad = [...code.matchAll(/\bmatch\s*\/(\S*)/g)].map((m) => m[1]).filter((p) => !/^wsf[A-Z]\w*\//.test(p));
  const balanced = (code.match(/\{/g) ?? []).length === (code.match(/\}/g) ?? []).length;
  return { bad, balanced, ok: bad.length === 0 && balanced };
}

/** The first line where two texts differ, for a refusal that says where to look. Rules text is not secret. */
function firstDifference(a, b) {
  const x = a.split('\n');
  const y = b.split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if (x[i] !== y[i]) {
      const cut = (s) => (s === undefined ? '(end of file)' : JSON.stringify(s.length > 120 ? `${s.slice(0, 120)}…` : s));
      return `outside-section line ${i + 1}: live ${cut(x[i])} vs main ${cut(y[i])}`;
    }
  }
  return 'no difference';
}

export function checkRules(candidateRules, mainRules, liveRules) {
  const cand = splitWsfSection(candidateRules);
  const main = splitWsfSection(mainRules);
  const scope = wsfSectionScope(cand.section);
  const out = [
    check('rules.catch-all-last', cand.wellFormed, cand.wellFormed ? 'the catch-all deny is present and is the last match' : 'the catch-all deny is missing, misplaced, or not the last match'),
    check('rules.outside-wsf-equals-main', cand.outside === main.outside, cand.outside === main.outside ? 'byte-equal to main outside the WSF section' : 'differs from main outside the WSF section'),
    check('rules.wsf-section-wsf-only', scope.ok, scope.bad.length ? `the WSF section matches non-wsf paths: ${scope.bad.join(',')}` : scope.balanced ? 'every match in the WSF section is a wsf* collection' : 'the WSF section has unbalanced braces'),
  ];
  if (liveRules !== undefined) {
    const live = splitWsfSection(liveRules);
    const liveScope = wsfSectionScope(live.section);
    const lawful = live.outside === main.outside && liveScope.ok;
    out.push(check('rules.live-outside-wsf-equals-main', lawful,
      lawful ? 'the live ruleset equals main outside its WSF section, which holds only wsf* matches: the rules step is lawful'
        : live.outside !== main.outside ? `the live ruleset differs from main outside the WSF section (${firstDifference(live.outside, main.outside)}): skip the rules step and escalate`
          : `the live WSF section holds non-wsf rules (${liveScope.bad.join(',') || 'unbalanced braces'}): skip the rules step and escalate`));
  }
  return out;
}

export function checkIndexes(candidateJson, mainJson) {
  const key = (i) => JSON.stringify(i);
  const candIx = candidateJson.indexes ?? [];
  const mainIx = mainJson.indexes ?? [];
  const missing = mainIx.filter((i) => !candIx.some((c) => key(c) === key(i)));
  const added = candIx.filter((c) => !mainIx.some((i) => key(i) === key(c)));
  const nonWsfAdded = added.filter((a) => !/^wsf[A-Z]/.test(a.collectionGroup ?? ''));
  const candFo = candidateJson.fieldOverrides ?? [];
  const mainFo = mainJson.fieldOverrides ?? [];
  const foMissing = mainFo.filter((f) => !candFo.some((c) => key(c) === key(f)));
  const foAdded = candFo.filter((c) => !mainFo.some((f) => key(f) === key(c)));
  const foNonWsf = foAdded.filter((a) => !/^wsf[A-Z]/.test(a.collectionGroup ?? ''));
  return [
    check('indexes.additive', missing.length === 0 && foMissing.length === 0,
      missing.length || foMissing.length ? `drops or changes ${missing.length} of main's composite indexes and ${foMissing.length} field overrides` : `every one of main's ${mainIx.length} composite indexes and ${mainFo.length} field overrides is present unchanged`),
    check('indexes.wsf-only-additions', nonWsfAdded.length === 0 && foNonWsf.length === 0,
      `adds ${added.length} composite (${added.map((a) => a.collectionGroup).join(',') || 'none'}) and ${foAdded.length} field overrides` + (nonWsfAdded.length || foNonWsf.length ? '; some are not wsf*' : '')),
  ];
}

export function checkConfig(config) {
  const keys = Object.keys(config ?? {}).filter((k) => k !== '_comment');
  const extraKeys = keys.filter((k) => k !== 'functions' && k !== 'firestore');
  const fns = Array.isArray(config?.functions) ? config.functions : [];
  const fnOk = fns.length === 1 && fns[0].codebase === WSF_CODEBASE && fns[0].source === WSF_SOURCE;
  const fs_ = config?.firestore ?? {};
  const fsKeys = Object.keys(fs_);
  const fsOk = fs_.rules === 'firestore.rules' && fs_.indexes === 'firestore.indexes.json' && fsKeys.every((k) => k === 'rules' || k === 'indexes');
  return [
    check('config.only-functions-and-firestore', extraKeys.length === 0 && keys.includes('functions'),
      extraKeys.length ? `declares ${extraKeys.join(',')}: no hosting, storage or anything else may be reachable` : 'declares only functions and firestore'),
    check('config.only-westayfit-codebase', fnOk, fnOk ? `one codebase: ${WSF_CODEBASE} from ${WSF_SOURCE}` : `functions must be exactly [{ source: ${WSF_SOURCE}, codebase: ${WSF_CODEBASE} }]`),
    check('config.firestore-rules-and-indexes', fsOk, fsOk ? 'firestore.rules and firestore.indexes.json' : 'firestore must name exactly rules: firestore.rules and indexes: firestore.indexes.json'),
  ];
}

/** `firestore:indexes` is not here: the runbook creates the two WSF composites with gcloud, and a full index deploy would also create GoArrive's. */
const ALLOWED_ONLY = new Set([`functions:${WSF_CODEBASE}`, 'firestore:rules']);
const FLAG_ALIAS = { '-P': '--project', '-c': '--config', '-f': '--force' };
/** The only reason the pre-flight accepts a command without --non-interactive (#599 S2). */
export const INTERACTIVE_REASONS = Object.freeze(['minimum-bill']);

/** The --only targets of a command, or [] when it has none. */
export function commandTargets(command) {
  const argv = String(command ?? '').trim().split(/\s+/).filter(Boolean);
  const i = argv.findIndex((a) => a === '--only' || a.startsWith('--only='));
  if (i === -1) return [];
  return (argv[i].includes('=') ? argv[i].slice(argv[i].indexOf('=') + 1) : argv[i + 1] ?? '').split(',').filter(Boolean);
}

/**
 * The exact deploy command the operator will run, as one string. Quotes are not supported and are refused.
 * `interactiveReason` is the one reviewed exception to --non-interactive, and only for the functions target.
 */
export function checkCommand(command, { interactiveReason } = {}) {
  const argv = String(command ?? '').trim().split(/\s+/).filter(Boolean);
  const problems = [];
  if (/["'`$;|&<>]/.test(String(command))) problems.push('quotes, substitutions and shell operators are not allowed');
  if (argv[0] !== 'firebase' || argv[1] !== 'deploy') problems.push('must be `firebase deploy`');
  const value = (flag) => {
    const i = argv.findIndex((a) => a === flag || a.startsWith(`${flag}=`));
    if (i === -1) return undefined;
    return argv[i].includes('=') ? argv[i].slice(argv[i].indexOf('=') + 1) : argv[i + 1];
  };
  const flags = argv.filter((a) => a.startsWith('-'));
  if (flags.some((f) => f === '--force' || f === '-f' || f.startsWith('--force='))) problems.push('--force is refused: a prune, a minimum-bill increase or a cleanup policy must never be accepted blindly');
  if (interactiveReason === undefined) {
    if (!flags.includes('--non-interactive')) problems.push('--non-interactive is required, so a deletion prompt aborts instead of being answered');
  } else if (!INTERACTIVE_REASONS.includes(interactiveReason)) {
    problems.push(`interactive reason ${interactiveReason} is not reviewed (allowed: ${INTERACTIVE_REASONS.join(', ')})`);
  } else {
    if (flags.includes('--non-interactive')) problems.push(`the ${interactiveReason} form is the interactive command: drop --non-interactive, or drop --interactive-reason`);
    if (value('--only') !== `functions:${WSF_CODEBASE}`) problems.push(`the ${interactiveReason} form applies only to --only functions:${WSF_CODEBASE}`);
  }
  if ((value('--project') ?? value('-P')) !== PRODUCTION_PROJECT) problems.push(`--project must be ${PRODUCTION_PROJECT}`);
  if ((value('--config') ?? value('-c')) !== PRODUCTION_CONFIG) problems.push(`--config must be ${PRODUCTION_CONFIG} (never firebase.json)`);
  const only = value('--only');
  if (!only) problems.push('--only is required: a bare deploy reaches every target in the config');
  else {
    const targets = only.split(',');
    if (targets.length !== 1) problems.push(`--only must name exactly one target per deploy, not ${targets.length}: firebase-tools would release them in its own order`);
    for (const t of targets) {
      if (!ALLOWED_ONLY.has(t)) problems.push(`target ${t} is refused (allowed: ${[...ALLOWED_ONLY].join(', ')})`);
    }
  }
  const takesValue = new Set(['--project', '-P', '--config', '-c', '--only']);
  const known = new Set([...takesValue, '--force', '-f', '--non-interactive']);
  const seen = new Set();
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const base = a.includes('=') ? a.slice(0, a.indexOf('=')) : a;
    if (!a.startsWith('-')) {
      problems.push(`stray argument ${a}`);
      continue;
    }
    if (/^-[^-]=/.test(a)) problems.push(`${a}: write -X value, not -X=value`);
    const canon = FLAG_ALIAS[base] ?? base;
    if (seen.has(canon)) problems.push(`${canon} is given more than once: firebase-tools uses the last one`);
    seen.add(canon);
    if (!known.has(base)) problems.push(`flag ${base} is not part of the reviewed command`);
    if (takesValue.has(base) && !a.includes('=')) i += 1;
  }
  const shape = `firebase deploy --only ${only} --project ${PRODUCTION_PROJECT} --config ${PRODUCTION_CONFIG}` + (interactiveReason === undefined ? ' --non-interactive' : ` (interactive: ${interactiveReason})`);
  return [check('command.reviewed-shape', problems.length === 0, problems.length ? problems.join('; ') : shape)];
}

/**
 * The functions env file the deploy will upload. firebase-tools replaces a
 * function's whole env with it, so both values must be present. Reports key
 * names only, never a value except the public app URL.
 */
export function checkEnvFile(text) {
  const env = {};
  const bad = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!m) {
      bad.push('a line that is not KEY=value');
      continue;
    }
    let v = m[2].trim();
    const q = /^(["'])(.*)\1$/.exec(v);
    if (q) v = q[2];
    env[m[1]] = v;
  }
  const keys = Object.keys(env);
  const allowed = new Set(['WSF_EMAIL_FROM', 'WSF_APP_URL', 'WSF_AUTH_ACTION_HANDLER']);
  const extra = keys.filter((k) => !allowed.has(k));
  const problems = [...bad];
  if (extra.length) problems.push(`unexpected keys ${extra.join(',')} (no secret belongs in the env file)`);
  if (env.WSF_APP_URL !== WSF_APP_URL) problems.push(`WSF_APP_URL must be ${WSF_APP_URL}`);
  if ('WSF_AUTH_ACTION_HANDLER' in env && env.WSF_AUTH_ACTION_HANDLER !== PRODUCTION_ACTION_HANDLER) {
    problems.push(`WSF_AUTH_ACTION_HANDLER, when set, must be ${PRODUCTION_ACTION_HANDLER}: the oobCode links go to it`);
  }
  if (!/@westay\.fit>?$/.test(env.WSF_EMAIL_FROM ?? '')) problems.push('WSF_EMAIL_FROM must be set to a westay.fit sender');
  return [check('worktree.env-file', problems.length === 0, problems.length ? problems.join('; ') : `${ENV_FILE} sets ${keys.sort().join(', ')}; WSF_APP_URL=${WSF_APP_URL}`)];
}

export function readConsent(serverSource, clientSource) {
  const read = (src, name) => {
    const m = new RegExp(`^(?:export\\s+)?const ${name}\\s*=\\s*'([^']*)'`, 'm').exec(src);
    return m ? m[1] : null;
  };
  return Object.fromEntries(CONSENT_NAMES.map((n) => [n, { server: read(serverSource, n), client: read(clientSource, n) }]));
}

/** The consent constants with their values blanked, so two files can be compared everywhere else. */
export function blankConsent(src) {
  let out = src;
  for (const n of CONSENT_NAMES) out = out.replace(new RegExp(`^((?:export\\s+)?const ${n}\\s*=\\s*)'[^']*'`, 'm'), "$1'<consent-version>'");
  return out;
}

/** An approved version is a real token: not pending, not blank, not a placeholder. */
export function isApprovedVersion(v) {
  return typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{3,63}$/.test(v) && !/^pending/i.test(v) && !/^(tbd|todo|tbc|placeholder|x+|none|null|undefined|draft)$/i.test(v);
}

export function checkConsent(record, consent) {
  const agree = CONSENT_NAMES.every((n) => consent[n].server !== null && consent[n].server === consent[n].client);
  const values = CONSENT_NAMES.map((n) => `${n}=${consent[n].server}`).join(' ');
  const out = [check('consent.server-equals-client', agree, agree ? values : 'server and client consent constants disagree or are missing')];
  if (record === 'B') {
    const approved = CONSENT_NAMES.every((n) => isApprovedVersion(consent[n].server) && isApprovedVersion(consent[n].client));
    out.push(check('consent.approved-version', approved, approved ? values : 'B must carry an approved version: not pending, blank or a placeholder'));
  }
  return out;
}

// ── the git-backed run ──────────────────────────────────────────────────────

function git(repo, args) {
  return execFileSync('git', ['--no-optional-locks', '-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
function gitOk(repo, args) {
  try {
    execFileSync('git', ['--no-optional-locks', '-C', repo, ...args], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const show = (repo, sha, file) => git(repo, ['show', `${sha}:${file}`]);
const has = (repo, sha, file) => gitOk(repo, ['cat-file', '-e', `${sha}:${file}`]);
const showOrNull = (repo, sha, file) => (has(repo, sha, file) ? show(repo, sha, file) : null);

/** Files the checks read at each commit. A missing one is a refusal, never a crash. */
const CANDIDATE_FILES = [`${WSF_SOURCE}/src/index.ts`, 'firestore.rules', 'firestore.indexes.json', CLIENT_CONSENT_FILE];
const MAIN_FILES = ['firestore.rules', 'firestore.indexes.json', PRODUCTION_CONFIG];

/**
 * Every check for one candidate. Inputs are explicit and full SHAs only; the
 * caller supplies the main SHA it fetched, never a branch name, so the verdict
 * names exactly what was compared. `anchor` exists for synthetic tests; the
 * CLI never accepts it.
 */
export function runPreflight({ repo = '.', record, candidate, main, anchor = ANCHOR_A, anchorG = ANCHOR_G, config, command, interactiveReason, liveRules, worktree, envFile, cwd, manifest = CANDIDATE_A_EXPORTS, publicManifest = CANDIDATE_A_PUBLIC }) {
  const checks = [];
  if (record !== 'A' && record !== 'B' && record !== 'G') return { ok: false, usage: 'record must be A, B or G' };
  const shas = [['candidate', candidate], ['main', main], ['anchor', anchor], ...(record === 'G' ? [['gated anchor', anchorG]] : [])];
  for (const [name, sha] of shas) {
    if (!SHA40.test(sha ?? '')) return { ok: false, usage: `${name} must be a full 40-character SHA` };
    if (!gitOk(repo, ['cat-file', '-e', `${sha}^{commit}`])) return { ok: false, usage: `${name} ${sha} is not a commit in this clone (fetch it first; this guard never fetches)` };
  }

  checks.push(check('candidate.not-main', candidate !== main && git(repo, ['rev-parse', `${candidate}^{tree}`]) !== git(repo, ['rev-parse', `${main}^{tree}`]),
    candidate === main ? 'the candidate IS operational main' : 'the candidate is not main and does not share main\'s tree'));
  const candMissing = CANDIDATE_FILES.filter((f) => !has(repo, candidate, f));
  const mainMissing = MAIN_FILES.filter((f) => !has(repo, main, f));
  checks.push(check('candidate.files-present', candMissing.length === 0, candMissing.length ? `the candidate lacks ${candMissing.join(',')}` : `the candidate has ${CANDIDATE_FILES.join(', ')}`));
  checks.push(check('main.files-present', mainMissing.length === 0, mainMissing.length ? `main lacks ${mainMissing.join(',')}` : `main has ${MAIN_FILES.join(', ')}`));
  const filesOk = candMissing.length === 0 && mainMissing.length === 0;

  if (record === 'A') {
    checks.push(check('candidate.is-anchor-A', candidate === anchor, candidate === anchor ? `A is exactly ${anchor}` : `A must be exactly ${anchor}`));
  } else if (record === 'G') {
    checks.push(check('candidate.is-anchor-G', candidate === anchorG, candidate === anchorG ? `G is exactly ${anchorG}` : `G must be exactly ${anchorG}`));
    const descends = candidate !== anchor && gitOk(repo, ['merge-base', '--is-ancestor', anchor, candidate]);
    const changed = descends ? git(repo, ['diff', '--name-only', anchor, candidate]).split('\n').filter(Boolean).sort() : [];
    const exact = descends && JSON.stringify(changed) === JSON.stringify([...CANDIDATE_G_DELTA_PATHS].sort());
    checks.push(check('candidate.G-is-the-gate-over-A', exact,
      exact ? `G descends from ${anchor} and changes exactly ${CANDIDATE_G_DELTA_PATHS.join(', ')}`
        : descends ? `G must change exactly ${CANDIDATE_G_DELTA_PATHS.join(', ')} over ${anchor}; it changes ${changed.join(',') || 'nothing'}`
          : `G must descend from ${anchor}`));
  } else {
    const descends = candidate !== anchor && gitOk(repo, ['merge-base', '--is-ancestor', anchor, candidate]);
    checks.push(check('candidate.B-descends-from-A', descends, descends ? `B descends from ${anchor}` : `B must be a descendant of ${anchor}, not ${anchor} itself`));
    if (descends && filesOk) {
      const changed = git(repo, ['diff', '--name-only', anchor, candidate]).split('\n').filter(Boolean);
      const next = readConsent(show(repo, candidate, SERVER_CONSENT_FILE), '');
      const versions = [PENDING_CONSENT, ...CONSENT_NAMES.map((n) => next[n].server).filter(Boolean)].sort((a, b) => b.length - a.length);
      const norm = (s) => versions.reduce((t, v) => t.split(v).join('<consent-version>'), s);
      const versionOnly = (p) => {
        if (!CANDIDATE_B_VERSION_ONLY_PREFIXES.some((pre) => p.startsWith(pre))) return false;
        const a = showOrNull(repo, anchor, p);
        const c = showOrNull(repo, candidate, p);
        return a !== null && c !== null && norm(a) === norm(c);
      };
      const outside = changed.filter((p) => !CANDIDATE_B_ALLOWED_PATHS.includes(p) && !versionOnly(p));
      checks.push(check('candidate.B-changes-only-consent', outside.length === 0, outside.length ? `B changes ${outside.join(',')}` : `B changes only ${changed.join(',') || 'nothing'}`));
      const sameServer = blankConsent(show(repo, anchor, SERVER_CONSENT_FILE)) === blankConsent(show(repo, candidate, SERVER_CONSENT_FILE));
      const sameClient = blankConsent(show(repo, anchor, CLIENT_CONSENT_FILE)) === blankConsent(show(repo, candidate, CLIENT_CONSENT_FILE));
      checks.push(check('candidate.B-code-equals-A-except-consent', sameServer && sameClient,
        sameServer && sameClient ? 'index.ts and profileConstants.ts equal A except the two consent values' : 'B changes code beyond the consent values'));
    }
  }

  const targets = commandTargets(command);
  const deploysFunctions = targets.includes(`functions:${WSF_CODEBASE}`);
  const deploysRules = targets.includes('firestore:rules');
  let consent = null;
  let rulesHashes = null;
  if (filesOk) {
    const sha = (t) => createHash('sha256').update(t).digest('hex');
    const lines = (t) => t.split('\n').length - (t.endsWith('\n') ? 1 : 0);
    const candRules = show(repo, candidate, 'firestore.rules');
    const mainRules = show(repo, main, 'firestore.rules');
    rulesHashes = {
      candidate: { sha256: sha(candRules), lines: lines(candRules), outsideWsfSha256: sha(splitWsfSection(candRules).outside) },
      main: { sha256: sha(mainRules), lines: lines(mainRules) },
      ...(liveRules !== undefined ? { live: { sha256: sha(liveRules), lines: lines(liveRules), outsideWsfSha256: sha(splitWsfSection(liveRules).outside) } } : {}),
    };
    checks.push(...checkExports(show(repo, candidate, `${WSF_SOURCE}/src/index.ts`), manifest, publicManifest));
    checks.push(...checkRules(show(repo, candidate, 'firestore.rules'), show(repo, main, 'firestore.rules'), liveRules));
    checks.push(...checkIndexes(JSON.parse(show(repo, candidate, 'firestore.indexes.json')), JSON.parse(show(repo, main, 'firestore.indexes.json'))));
    const sameAsMain = JSON.stringify(config) === JSON.stringify(JSON.parse(show(repo, main, PRODUCTION_CONFIG)));
    checks.push(check('config.equals-main', sameAsMain, sameAsMain ? `equals ${PRODUCTION_CONFIG} at main` : `differs from main's reviewed ${PRODUCTION_CONFIG} (predeploy, ignore and comments included)`));
    consent = readConsent(show(repo, candidate, SERVER_CONSENT_FILE), show(repo, candidate, CLIENT_CONSENT_FILE));
    checks.push(...checkConsent(record, consent));
  }
  checks.push(...checkConfig(config));
  if (command !== undefined) checks.push(...checkCommand(command, { interactiveReason }));
  else if (interactiveReason !== undefined) checks.push(check('command.reviewed-shape', false, 'an interactive reason needs the --command it applies to'));
  if (deploysRules) {
    checks.push(check('rules.live-ruleset-supplied', liveRules !== undefined, liveRules !== undefined ? 'the live ruleset was supplied and compared' : 'a rules deploy needs --live-rules: the shared ruleset may only be replaced when it equals main outside its WSF section'));
  }
  if (deploysFunctions || deploysRules) {
    checks.push(check('worktree.supplied', worktree !== undefined, worktree !== undefined ? `the deploy worktree is ${worktree}` : 'a deploy needs --worktree: firebase-tools deploys the working tree, not the commit'));
  }
  if (worktree !== undefined) {
    const head = gitOk(worktree, ['rev-parse', '--verify', 'HEAD']) ? git(worktree, ['rev-parse', 'HEAD']).trim() : '';
    checks.push(check('worktree.at-candidate', head === candidate, head === candidate ? `worktree HEAD is ${candidate}` : `worktree HEAD ${head || '(not a git worktree)'} is not the candidate`));
    // Ignored files count too: firebase-tools uploads and loads them (a stray
    // functions-westayfit/.env is read before .env.goarrive). Only the install
    // and the build output may exist without being reviewed. `matching` lists an
    // ignored directory once, as `dir/`, instead of every file inside it.
    const allowed = new Set([`?? ${PRODUCTION_CONFIG}`, `?? ${ENV_FILE}`, `!! ${WSF_SOURCE}/node_modules/`, `!! ${WSF_SOURCE}/lib/`]);
    const dirty = head ? git(worktree, ['status', '--porcelain', '--untracked-files=all', '--ignored=matching']).split('\n').filter(Boolean).filter((l) => !allowed.has(l)) : ['(not a git worktree)'];
    checks.push(check('worktree.clean', dirty.length === 0, dirty.length ? `unreviewed changes, ignored files included: ${dirty.join(', ')}` : `only ${PRODUCTION_CONFIG} and ${ENV_FILE} are added (plus ${WSF_SOURCE}/node_modules and lib)`));
    if (deploysFunctions || deploysRules) {
      const real = (d) => {
        try {
          return fs.realpathSync(d);
        } catch {
          return null;
        }
      };
      const here = cwd === undefined ? null : real(cwd);
      const there = real(worktree);
      const same = here !== null && here === there;
      checks.push(check('worktree.is-cwd', same, same ? 'the deploy runs from the checked worktree' : `the deploy must run from the worktree it was checked against (cd into ${worktree}); it would run from ${cwd ?? '(unknown)'}`));
    }
    if (deploysFunctions) checks.push(...checkEnvFile(envFile));
  }

  const consentVersion = consent ? Object.fromEntries(CONSENT_NAMES.map((n) => [n, consent[n].server])) : null;
  return {
    ok: checks.every((c) => c.ok),
    record,
    candidate,
    main,
    anchor,
    ...(record === 'G' ? { anchorG } : {}),
    project: PRODUCTION_PROJECT,
    ...(interactiveReason !== undefined ? { interactiveReason } : {}),
    rulesHashes,
    exports: filesOk ? parseExports(show(repo, candidate, `${WSF_SOURCE}/src/index.ts`)).names.length : null,
    consentVersion,
    consentVersionPending: consent ? Object.values(consent).some((v) => /^pending/.test(v.server ?? '')) : null,
    checks,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) return { error: `unexpected argument ${a}` };
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) return { error: `--${k} needs a value` };
    if (k in out) return { error: `--${k} is given more than once` };
    out[k] = v;
    i += 1;
  }
  return out;
}

const USAGE = 'usage: node .github/wsf-production/preflight.mjs --record A|B|G --candidate <sha40> --main <sha40> --config firebase.westayfit.production.json [--command "firebase deploy ..."] [--interactive-reason minimum-bill] [--worktree <dir>] [--live-rules <file>] [--repo <dir>]';

/** The CLI as a function: argv in, { code, verdict } out. The anchors are for synthetic tests only and are never read from argv. */
export function cli(argv, { anchor = ANCHOR_A, anchorG = ANCHOR_G, cwd = process.cwd() } = {}) {
  try {
    return cliUnsafe(argv, { anchor, anchorG, cwd });
  } catch (e) {
    // Fails closed AND says so: a malformed file or a git error still prints a verdict.
    return { code: 2, verdict: { ok: false, usage: `unusable input: ${String(e?.message ?? e).split('\n')[0].slice(0, 300)}` } };
  }
}

function cliUnsafe(argv, { anchor, anchorG, cwd }) {
  const args = parseArgs(argv);
  const allowed = new Set(['record', 'candidate', 'main', 'config', 'command', 'interactive-reason', 'live-rules', 'repo', 'worktree']);
  const unknown = Object.keys(args).filter((k) => k !== 'error' && !allowed.has(k));
  if (args.error || unknown.length || !args.record || !args.candidate || !args.main || !args.config) {
    return { code: 2, verdict: { ok: false, usage: args.error ?? (unknown.length ? `unknown option ${unknown.join(',')}` : USAGE) } };
  }
  const read = (file) => {
    try {
      return { text: fs.readFileSync(file, 'utf8') };
    } catch {
      return { error: `cannot read ${file}` };
    }
  };
  const cfg = read(args.config);
  let config;
  try {
    config = JSON.parse(cfg.text ?? '');
  } catch {
    return { code: 2, verdict: { ok: false, usage: `cannot read ${args.config} as JSON` } };
  }
  let liveRules;
  if (args['live-rules'] !== undefined) {
    const r = read(args['live-rules']);
    if (r.error || !r.text.trim()) return { code: 2, verdict: { ok: false, usage: `${r.error ?? `${args['live-rules']} is empty`}: re-capture the live ruleset` } };
    liveRules = r.text;
  }
  let envFile;
  if (args.worktree !== undefined) {
    const e = read(path.join(args.worktree, ENV_FILE));
    envFile = e.text ?? '';
  }
  const verdict = runPreflight({ repo: args.repo ?? '.', record: args.record, candidate: args.candidate, main: args.main, anchor, anchorG, config, command: args.command, interactiveReason: args['interactive-reason'], liveRules, worktree: args.worktree, envFile, cwd });
  return { code: verdict.usage ? 2 : verdict.ok ? 0 : 1, verdict };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { code, verdict } = cli(process.argv.slice(2));
  console.log(JSON.stringify(verdict, null, 2));
  process.exit(code);
}
