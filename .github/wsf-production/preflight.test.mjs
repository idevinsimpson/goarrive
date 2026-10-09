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
  CANDIDATE_A_EXPORTS,
  CANDIDATE_A_PUBLIC,
  checkCommand,
  checkConfig,
  checkConsent,
  checkExports,
  checkIndexes,
  checkRules,
  parseExports,
  readConsent,
  runPreflight,
  splitWsfSection,
} from './preflight.mjs';

const SCRIPT = path.resolve('.github/wsf-production/preflight.mjs');
const PROD_CONFIG = JSON.parse(fs.readFileSync('firebase.westayfit.production.json', 'utf8'));
const REVIEWED = 'firebase deploy --only functions:westayfit --project goarrive --config firebase.westayfit.production.json --non-interactive';
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
  return { dir, root, main, anchor };
}
const run = (h, over = {}) => runPreflight({ repo: h.dir, record: 'A', candidate: h.anchor, main: h.main, anchor: h.anchor, config: PROD_CONFIG, command: REVIEWED, ...over });

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

test('rules: a missing or misplaced catch-all deny is refused', () => {
  const noCatchAll = withWsf(GOARRIVE_RULES).replace('    match /{document=**} {\n      allow read, write: if false;\n    }\n', '');
  assert.ok(failed(checkRules(noCatchAll, GOARRIVE_RULES)).includes('rules.catch-all-last'));
  const afterCatchAll = GOARRIVE_RULES.replace('  }\n}\n', `    match /wsfLate/{id} {\n      allow read: if true;\n    }\n  }\n}\n`);
  assert.ok(failed(checkRules(afterCatchAll, GOARRIVE_RULES)).includes('rules.catch-all-last'));
});

test('rules: the live ruleset gates the rules step only when it equals main outside the WSF section', () => {
  const cand = withWsf(GOARRIVE_RULES);
  assert.deepEqual(failed(checkRules(cand, GOARRIVE_RULES, GOARRIVE_RULES)), []);
  assert.deepEqual(failed(checkRules(cand, GOARRIVE_RULES, cand)), []);
  assert.deepEqual(failed(checkRules(cand, GOARRIVE_RULES, GOARRIVE_RULES.replace('coaches', 'trainers'))), ['rules.live-outside-wsf-equals-main']);
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

test('command: the reviewed functions, rules and indexes commands pass, in either flag spelling', () => {
  assert.deepEqual(failed(checkCommand(REVIEWED)), []);
  assert.deepEqual(failed(checkCommand('firebase deploy --only firestore:rules --project goarrive --config firebase.westayfit.production.json --non-interactive')), []);
  assert.deepEqual(failed(checkCommand('firebase deploy --non-interactive --only=firestore:indexes -P goarrive -c firebase.westayfit.production.json')), []);
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

// ── consent ─────────────────────────────────────────────────────────────────

test('consent: A may carry the pending version; B must carry an approved one; server and client must agree', () => {
  const pending = readConsent(indexTs(), profileConstants());
  assert.deepEqual(failed(checkConsent('A', pending)), []);
  assert.deepEqual(failed(checkConsent('B', pending)), ['consent.approved-version']);
  const approved = readConsent(indexTs(undefined, undefined, '2026-10-10'), profileConstants('2026-10-10'));
  assert.deepEqual(failed(checkConsent('B', approved)), []);
  const split = readConsent(indexTs(undefined, undefined, '2026-10-10'), profileConstants('2026-10-10', '2026-10-11'));
  assert.deepEqual(failed(checkConsent('B', split)), ['consent.server-equals-client']);
});

// ── the git-backed run ──────────────────────────────────────────────────────

test('git: candidate A on its anchor passes every check and reports that sign-up must stay closed', () => {
  const h = history();
  const v = run(h);
  assert.deepEqual(failed(v.checks), []);
  assert.equal(v.ok, true);
  assert.equal(v.exports, 59);
  assert.equal(v.signUpMustStayClosed, true);
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
  assert.equal(run(h, { record: 'B', candidate: good }).signUpMustStayClosed, false);

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

test('cli: prints one JSON verdict, exits 0 / 1 / 2, and writes nothing', () => {
  const h = history();
  const before = git(h.dir, 'status', '--porcelain');
  const cli = (args) => spawnSync(process.execPath, [SCRIPT, '--repo', h.dir, '--config', path.resolve('firebase.westayfit.production.json'), '--anchor', h.anchor, ...args], { encoding: 'utf8' });
  const ok = cli(['--record', 'A', '--candidate', h.anchor, '--main', h.main, '--command', REVIEWED]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(JSON.parse(ok.stdout).ok, true);
  const refused = cli(['--record', 'A', '--candidate', h.main, '--main', h.main]);
  assert.equal(refused.status, 1);
  assert.equal(JSON.parse(refused.stdout).ok, false);
  const usage = cli(['--record', 'A', '--candidate', h.anchor]);
  assert.equal(usage.status, 2);
  assert.match(JSON.parse(usage.stdout).usage, /usage/);
  const unknown = cli(['--record', 'A', '--candidate', h.anchor, '--main', h.main, '--force', 'yes']);
  assert.equal(unknown.status, 2);
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
