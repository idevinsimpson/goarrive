#!/usr/bin/env node
/**
 * THE WSF PRODUCTION PRE-FLIGHT. A refusal here is the cheapest place a bad
 * production deploy can stop.
 *
 * PRODUCTION-DEPLOY-PATH-1 (#365 6075293313). Production is the SHARED
 * `goarrive` Firebase project, and GoArrive lives there too. This guard runs on
 * an operator's local clone BEFORE any credentialed command. It answers one
 * question: is this exact candidate, with this exact config and this exact
 * command, a WSF-only deploy that cannot reach GoArrive?
 *
 * PURE AND NETWORK-FREE. It reads local git objects (`git show`,
 * `git merge-base`) and the files it is given. It never fetches, never logs in,
 * never writes a file, and never runs firebase or gcloud. It prints one JSON
 * verdict on stdout. Exit 0 means every check passed; exit 1 means at least
 * one refused; exit 2 means the inputs themselves were unusable.
 *
 * WHAT IT REFUSES, AND WHY (the inventory is #599 at 711ecca1):
 *   - A candidate that is operational main, or that does not descend from the
 *     reviewed development anchor ec162d17. Main has ONE WSF export, so a
 *     functions:westayfit deploy from it would prune every other WSF function.
 *   - An export list different from the candidate's reviewed manifest (59
 *     names at A), or a different set of `invoker: 'public'` declarations (17).
 *   - A firestore.rules that differs from main's anywhere outside the single
 *     WSF section, or whose WSF section matches a non-wsf path, or that loses
 *     the catch-all deny. The ruleset is shared: deploying it replaces
 *     GoArrive's rules too.
 *   - Indexes that drop or change any of main's, or add a non-WSF one.
 *   - A production config that declares anything beyond the `westayfit`
 *     functions codebase and Firestore rules/indexes (no hosting, no storage).
 *   - A deploy command with --force, any Hosting or Storage target, a bare
 *     `functions` target, GoArrive's `default` codebase, a missing --only,
 *     firebase.json, or any project other than goarrive.
 *   - For candidate B: a consent version still pending, server and client
 *     constants that disagree, or any change beyond the consent constants and
 *     the policy text.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** The reviewed development anchor: candidate A exactly, and B's parent line. */
export const ANCHOR_A = 'ec162d17a0540e936741027f9b8f90dd372cfaf4';
export const PRODUCTION_PROJECT = 'goarrive';
export const PRODUCTION_CONFIG = 'firebase.westayfit.production.json';
export const WSF_CODEBASE = 'westayfit';
export const WSF_SOURCE = 'functions-westayfit';

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

/** The 17 exports that declare `invoker: 'public'` at ec162d17. Every other export must not. */
export const CANDIDATE_A_PUBLIC = Object.freeze([
  'wsfPreviewCommunity', 'wsfResolveMarker', 'wsfPublicPreviewLabel', 'wsfChallengePulse',
  'wsfSendPasswordResetEmail', 'wsfGoalPulse', 'wsfGoalRecentAdditions', 'wsfStationRequestPairing',
  'wsfStationPairingStatus', 'wsfStationClaimPairing', 'wsfStationState', 'wsfCombinedGoalPulse',
  'wsfTurnState', 'wsfCallNext', 'wsfStartTurn', 'wsfCompleteTurn', 'wsfCancelTurn',
]);

const SERVER_CONSENT_FILE = 'functions-westayfit/src/index.ts';
const CLIENT_CONSENT_FILE = 'apps/westayfit/src/profileConstants.ts';
/** Paths a candidate B may change relative to A: the consent constants, and the policy text they version. */
export const CANDIDATE_B_ALLOWED_PATHS = Object.freeze([SERVER_CONSENT_FILE, CLIENT_CONSENT_FILE, 'apps/westayfit/src/legalContent.ts']);
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
      `${publicNames.length} declare invoker 'public'; expected ${publicManifest.length}` + (pubMissing.length ? `; missing ${pubMissing.join(',')}` : '') + (pubExtra.length ? `; unexpected ${pubExtra.join(',')}` : '')),
  ];
}

const CATCH_ALL = /^\s*match \/\{document=\*\*\} \{\s*$/;

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
  const lastMatch = [...lines.keys()].filter((i) => /^\s*match \//.test(lines[i])).pop();
  const catchAllLast = catchAll !== -1 && lastMatch === catchAll;
  if (banner === -1) return { outside: rulesText, section: '', catchAll: catchAll !== -1, wellFormed: catchAllLast };
  let start = banner;
  if (start > 0 && /^\s*\/\/\s*─+\s*$/.test(lines[start - 1])) start -= 1;
  if (catchAll === -1 || catchAll < banner) return { outside: rulesText, section: '', catchAll: catchAll !== -1, wellFormed: false };
  const section = lines.slice(start, catchAll).join('\n');
  const outside = [...lines.slice(0, start), ...lines.slice(catchAll)].join('\n');
  return { outside, section, catchAll: true, wellFormed: catchAllLast };
}

export function checkRules(candidateRules, mainRules, liveRules) {
  const cand = splitWsfSection(candidateRules);
  const main = splitWsfSection(mainRules);
  const nonWsf = [...cand.section.matchAll(/^\s*match \/([^/{\s]+)/gm)].map((m) => m[1]).filter((p) => !/^wsf[A-Z]/.test(p));
  const out = [
    check('rules.catch-all-last', cand.wellFormed, cand.wellFormed ? 'the catch-all deny is present and is the last match' : 'the catch-all deny is missing, misplaced, or not the last match'),
    check('rules.outside-wsf-equals-main', cand.outside === main.outside, cand.outside === main.outside ? 'byte-equal to main outside the WSF section' : 'differs from main outside the WSF section'),
    check('rules.wsf-section-wsf-only', nonWsf.length === 0, nonWsf.length ? `the WSF section matches non-wsf paths: ${nonWsf.join(',')}` : 'every match in the WSF section is a wsf* collection'),
  ];
  if (liveRules !== undefined) {
    const live = splitWsfSection(liveRules);
    out.push(check('rules.live-outside-wsf-equals-main', live.outside === main.outside,
      live.outside === main.outside ? 'the live ruleset equals main outside any WSF section: the rules step is lawful' : 'the live ruleset differs from main outside the WSF section: skip the rules step and escalate'));
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

const ALLOWED_ONLY = new Set([`functions:${WSF_CODEBASE}`, 'firestore:rules', 'firestore:indexes']);

/** The exact deploy command the operator will run, as one string. Quotes are not supported and are refused. */
export function checkCommand(command) {
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
  if (flags.some((f) => f === '--force' || f === '-f' || f.startsWith('--force='))) problems.push('--force is refused: a prune or index deletion must never be accepted blindly');
  if (!flags.includes('--non-interactive')) problems.push('--non-interactive is required, so a deletion prompt aborts instead of being answered');
  if (value('--project') !== PRODUCTION_PROJECT && value('-P') !== PRODUCTION_PROJECT) problems.push(`--project must be ${PRODUCTION_PROJECT}`);
  if (value('--config') !== PRODUCTION_CONFIG && value('-c') !== PRODUCTION_CONFIG) problems.push(`--config must be ${PRODUCTION_CONFIG} (never firebase.json)`);
  const only = value('--only');
  if (!only) problems.push('--only is required: a bare deploy reaches every target in the config');
  else {
    for (const t of only.split(',')) {
      if (!ALLOWED_ONLY.has(t)) problems.push(`target ${t} is refused (allowed: ${[...ALLOWED_ONLY].join(', ')})`);
    }
  }
  const takesValue = new Set(['--project', '-P', '--config', '-c', '--only']);
  const known = new Set([...takesValue, '--force', '-f', '--non-interactive']);
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const base = a.includes('=') ? a.slice(0, a.indexOf('=')) : a;
    if (!a.startsWith('-')) {
      problems.push(`stray argument ${a}`);
      continue;
    }
    if (!known.has(base)) problems.push(`flag ${base} is not part of the reviewed command`);
    if (takesValue.has(base) && !a.includes('=')) i += 1;
  }
  return [check('command.reviewed-shape', problems.length === 0, problems.length ? problems.join('; ') : `firebase deploy --only ${only} --project ${PRODUCTION_PROJECT} --config ${PRODUCTION_CONFIG} --non-interactive`)];
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

export function checkConsent(record, consent) {
  const agree = CONSENT_NAMES.every((n) => consent[n].server !== null && consent[n].server === consent[n].client);
  const pending = CONSENT_NAMES.some((n) => /^pending-approval/.test(consent[n].server ?? '') || /^pending-approval/.test(consent[n].client ?? ''));
  const values = CONSENT_NAMES.map((n) => `${n}=${consent[n].server}`).join(' ');
  const out = [check('consent.server-equals-client', agree, agree ? values : 'server and client consent constants disagree or are missing')];
  if (record === 'B') out.push(check('consent.approved-version', !pending, pending ? 'B must carry the approved version, not pending-approval' : values));
  return out;
}

// ── the git-backed run ──────────────────────────────────────────────────────

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
function gitOk(repo, args) {
  try {
    execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const show = (repo, sha, file) => git(repo, ['show', `${sha}:${file}`]);

/**
 * Every check for one candidate. Inputs are explicit and full SHAs only; the
 * caller supplies the main SHA it fetched, never a branch name, so the verdict
 * names exactly what was compared.
 */
export function runPreflight({ repo = '.', record, candidate, main, anchor = ANCHOR_A, config, command, liveRules, manifest = CANDIDATE_A_EXPORTS, publicManifest = CANDIDATE_A_PUBLIC }) {
  const checks = [];
  if (record !== 'A' && record !== 'B') return { ok: false, usage: 'record must be A or B' };
  for (const [name, sha] of [['candidate', candidate], ['main', main], ['anchor', anchor]]) {
    if (!SHA40.test(sha ?? '')) return { ok: false, usage: `${name} must be a full 40-character SHA` };
    if (!gitOk(repo, ['cat-file', '-e', `${sha}^{commit}`])) return { ok: false, usage: `${name} ${sha} is not a commit in this clone (fetch it first; this guard never fetches)` };
  }

  checks.push(check('candidate.not-main', candidate !== main && git(repo, ['rev-parse', `${candidate}^{tree}`]) !== git(repo, ['rev-parse', `${main}^{tree}`]),
    candidate === main ? 'the candidate IS operational main' : 'the candidate is not main and does not share main\'s tree'));
  if (record === 'A') {
    checks.push(check('candidate.is-anchor-A', candidate === anchor, candidate === anchor ? `A is exactly ${anchor}` : `A must be exactly ${anchor}`));
  } else {
    const descends = candidate !== anchor && gitOk(repo, ['merge-base', '--is-ancestor', anchor, candidate]);
    checks.push(check('candidate.B-descends-from-A', descends, descends ? `B descends from ${anchor}` : `B must be a descendant of ${anchor}, not ${anchor} itself`));
    if (descends) {
      const changed = git(repo, ['diff', '--name-only', anchor, candidate]).split('\n').filter(Boolean);
      const outside = changed.filter((p) => !CANDIDATE_B_ALLOWED_PATHS.includes(p));
      checks.push(check('candidate.B-changes-only-consent', outside.length === 0, outside.length ? `B changes ${outside.join(',')}` : `B changes only ${changed.join(',') || 'nothing'}`));
      const sameServer = blankConsent(show(repo, anchor, SERVER_CONSENT_FILE)) === blankConsent(show(repo, candidate, SERVER_CONSENT_FILE));
      const sameClient = blankConsent(show(repo, anchor, CLIENT_CONSENT_FILE)) === blankConsent(show(repo, candidate, CLIENT_CONSENT_FILE));
      checks.push(check('candidate.B-code-equals-A-except-consent', sameServer && sameClient,
        sameServer && sameClient ? 'index.ts and profileConstants.ts equal A except the two consent values' : 'B changes code beyond the consent values'));
    }
  }

  checks.push(...checkExports(show(repo, candidate, `${WSF_SOURCE}/src/index.ts`), manifest, publicManifest));
  checks.push(...checkRules(show(repo, candidate, 'firestore.rules'), show(repo, main, 'firestore.rules'), liveRules));
  checks.push(...checkIndexes(JSON.parse(show(repo, candidate, 'firestore.indexes.json')), JSON.parse(show(repo, main, 'firestore.indexes.json'))));
  checks.push(...checkConfig(config));
  if (command !== undefined) checks.push(...checkCommand(command));
  const consent = readConsent(show(repo, candidate, SERVER_CONSENT_FILE), show(repo, candidate, CLIENT_CONSENT_FILE));
  checks.push(...checkConsent(record, consent));
  const consentPending = Object.values(consent).some((v) => /^pending-approval/.test(v.server ?? ''));

  return {
    ok: checks.every((c) => c.ok),
    record,
    candidate,
    main,
    anchor,
    project: PRODUCTION_PROJECT,
    exports: parseExports(show(repo, candidate, `${WSF_SOURCE}/src/index.ts`)).names.length,
    signUpMustStayClosed: consentPending,
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
    out[k] = v;
    i += 1;
  }
  return out;
}

const USAGE = 'usage: node .github/wsf-production/preflight.mjs --record A|B --candidate <sha40> --main <sha40> --config firebase.westayfit.production.json [--command "firebase deploy ..."] [--live-rules <file>] [--repo <dir>] [--anchor <sha40>]';

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2));
  const allowed = new Set(['record', 'candidate', 'main', 'config', 'command', 'live-rules', 'repo', 'anchor']);
  const unknown = Object.keys(args).filter((k) => k !== 'error' && !allowed.has(k));
  if (args.error || unknown.length || !args.record || !args.candidate || !args.main || !args.config) {
    console.log(JSON.stringify({ ok: false, usage: args.error ?? (unknown.length ? `unknown option ${unknown.join(',')}` : USAGE) }));
    process.exit(2);
  }
  let config;
  try {
    config = JSON.parse(fs.readFileSync(args.config, 'utf8'));
  } catch {
    console.log(JSON.stringify({ ok: false, usage: `cannot read ${args.config} as JSON` }));
    process.exit(2);
  }
  const liveRules = args['live-rules'] === undefined ? undefined : fs.readFileSync(args['live-rules'], 'utf8');
  const verdict = runPreflight({ repo: args.repo ?? '.', record: args.record, candidate: args.candidate, main: args.main, anchor: args.anchor ?? ANCHOR_A, config, command: args.command, liveRules });
  console.log(JSON.stringify(verdict, null, 2));
  process.exit(verdict.usage ? 2 : verdict.ok ? 0 : 1);
}
