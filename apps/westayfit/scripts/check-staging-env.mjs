#!/usr/bin/env node
/**
 * I-9c. CHECK A STAGING ENV FILE BEFORE IT GOES ANYWHERE, WITHOUT SEEING IT.
 *
 * Usage (from apps/westayfit):
 *   npm run check:staging-env -- <path-to-env-file> [--platform ios|android]
 *
 * Reads a dotenv file (KEY=VALUE lines, `#` comments) and checks it with the
 * app's OWN rules, not a copy of them:
 *   - `resolveStagingConfig` (src/stagingEnv.ts), the rule a staging build
 *     runs at start-up: complete, coherent, never production;
 *   - `nativeTargetProblem` (src/stagingEnv.ts) for a phone release build
 *     (`__DEV__` false, so the emulator flag cannot name the backend);
 *   - `app.config.js` the way an EAS build of the `preview` profile runs it
 *     (EAS_BUILD_PLATFORM, EAS_BUILD_PROFILE=preview, the file's env).
 * EXPO_PUBLIC_WSF_ENV=staging and EXPO_PUBLIC_WSF_AUTH_ENABLED=1 are added
 * for the check unless the file sets them (they live in eas.json, not in the
 * EAS environment).
 *
 * VALUES ARE NEVER PRINTED. The output is the six names with present/missing,
 * PASS or FAIL per check, and for each failure a short rule label and the
 * variable NAMES involved. The app's own refusal messages quote values, so
 * each one is mapped to a fixed label and the names it concerns; the message
 * itself is never written anywhere. Exit 0 on PASS, 1 on FAIL.
 *
 * It refuses to read a file that git tracks: a real value must never be in
 * the repository, and this is not a reason to put one there.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const STAGING_NAMES = [
  'EXPO_PUBLIC_WSF_STAGING_API_KEY',
  'EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN',
  'EXPO_PUBLIC_WSF_STAGING_PROJECT_ID',
  'EXPO_PUBLIC_WSF_STAGING_STORAGE_BUCKET',
  'EXPO_PUBLIC_WSF_STAGING_SENDER_ID',
  'EXPO_PUBLIC_WSF_STAGING_APP_ID',
];
const SELECTOR = 'EXPO_PUBLIC_WSF_ENV';
const AUTH = 'EXPO_PUBLIC_WSF_AUTH_ENABLED';
const EMULATORS = 'EXPO_PUBLIC_WSF_USE_EMULATORS';
const HARNESS = 'EXPO_PUBLIC_WSF_CRASH_HARNESS';
const KNOWN_NAMES = [...STAGING_NAMES, SELECTOR, AUTH, EMULATORS, HARNESS];
const [API_KEY, AUTH_DOMAIN, PROJECT_ID, STORAGE_BUCKET, SENDER_ID, APP_ID] = STAGING_NAMES;

/** KEY=VALUE lines; `#` comments and blank lines skipped; an optional `export `; matching quotes removed. */
export function parseDotenv(text) {
  const env = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2];
    const quoted = /^(['"])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, '').trim();
    env[m[1]] = value;
  }
  return env;
}

/** The known names a text mentions, in the canonical order (never the text itself). */
function namesIn(text) {
  return KNOWN_NAMES.filter((n) => new RegExp(`(^|[^A-Z_])${n}([^A-Z_]|$)`).test(text));
}

/*
  The app's refusals, line by line, mapped to a fixed label and fixed names.
  A line that quotes a value is matched on the words around the value, and
  only the label and names below are ever printed.
*/
const RESOLVER_RULES = [
  { test: /These variables are set but empty:/, label: 'present but blank', names: 'listed' },
  { test: /is not a recognised environment/, label: 'must be exactly "staging" or "production"', names: [SELECTOR] },
  {
    test: /(A complete staging Firebase config was supplied|Staging values were supplied)/,
    label: `staging values need ${SELECTOR}=staging`,
    names: 'listed+selector',
  },
  { test: /and the emulator flag are both set/, label: 'staging and the emulator flag are exclusive', names: [SELECTOR, EMULATORS] },
  { test: /^\s*Missing: /, label: 'missing', names: 'listed' },
  { test: /which names the production project/, label: 'PROJECT_ID must not name the production project', names: [PROJECT_ID] },
  { test: /^\s*(EXPO_PUBLIC_WSF_STAGING_[A-Z_]+) is the PRODUCTION value\./, label: 'must not be a production value', names: 'leading' },
  { test: new RegExp(`^\\s*${AUTH_DOMAIN} is "`), label: 'AUTH_DOMAIN must equal <PROJECT_ID>.firebaseapp.com', names: [AUTH_DOMAIN, PROJECT_ID] },
  {
    test: new RegExp(`^\\s*${STORAGE_BUCKET} is "`),
    label: 'STORAGE_BUCKET must be <PROJECT_ID>.firebasestorage.app or <PROJECT_ID>.appspot.com',
    names: [STORAGE_BUCKET, PROJECT_ID],
  },
  { test: new RegExp(`^\\s*${SENDER_ID} must be all digits`), label: 'SENDER_ID must be all digits', names: [SENDER_ID] },
  { test: new RegExp(`^\\s*${APP_ID} is "`), label: 'APP_ID must be a web app id, 1:<SENDER_ID>:web:<hex>', names: [APP_ID, SENDER_ID] },
  { test: new RegExp(`^\\s*${API_KEY} is not the shape`), label: 'API_KEY must have the shape of a Firebase browser key', names: [API_KEY] },
];

const APP_CONFIG_RULES = [
  { test: /EXPO_PUBLIC_WSF_ENV must be "staging" or "production"/, label: 'must be "staging" or "production"', names: [SELECTOR] },
  { test: /staging values are missing from the EAS environment:/, label: 'missing from the build environment', names: 'listed' },
  { test: /EXPO_PUBLIC_WSF_AUTH_ENABLED is not set to 1 or 0/, label: 'must be 1 (only a production build may say 0)', names: [AUTH] },
  { test: /EXPO_PUBLIC_WSF_AUTH_ENABLED is off for a/, label: 'is off for a non-production build', names: [AUTH] },
  { test: /EXPO_PUBLIC_WSF_CRASH_HARNESS is set for a production/, label: 'the crash harness is refused in production', names: [HARNESS] },
  { test: /EXPO_PUBLIC_WSF_USE_EMULATORS cannot\s+name its backend/, label: 'a release build cannot use the emulator', names: [EMULATORS, SELECTOR] },
];

/** A refusal message mapped to [{ label, names }]. The message is never returned or printed. */
export function redact(message, rules) {
  const findings = [];
  for (const line of String(message).split('\n')) {
    const rule = rules.find((r) => r.test.test(line));
    if (!rule) continue;
    const match = rule.test.exec(line);
    // A listed rule names what follows its own words (the list), nothing before them.
    const rest = line.slice(match.index + match[0].length);
    let names;
    if (rule.names === 'listed') names = namesIn(rest);
    else if (rule.names === 'listed+selector') names = [SELECTOR, ...namesIn(rest).filter((n) => STAGING_NAMES.includes(n))];
    else if (rule.names === 'leading') names = namesIn(match[1]);
    else names = rule.names;
    // A complete config with no selector lists no names: all six were supplied.
    if (rule.names === 'listed+selector' && names.length === 1) names = [SELECTOR, ...STAGING_NAMES];
    findings.push({ label: rule.label, names });
  }
  if (findings.length === 0) findings.push({ label: 'refused (an unrecognised rule)', names: namesIn(String(message)) });
  return findings;
}

/** src/stagingEnv.ts, compiled in memory with the TypeScript already in node_modules (no new dependency). */
export async function loadStagingEnv() {
  const req = createRequire(join(APP_ROOT, 'package.json'));
  const ts = req('typescript');
  const source = readFileSync(join(APP_ROOT, 'src', 'stagingEnv.ts'), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}

function isTracked(path) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', path], { cwd: APP_ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Runs app.config.js as an EAS `preview` build of `platform` would, with exactly this env. */
function appConfigFindings(env, platform) {
  const req = createRequire(join(APP_ROOT, 'package.json'));
  const appConfig = req(join(APP_ROOT, 'app.config.js'));
  const expo = JSON.parse(readFileSync(join(APP_ROOT, 'app.json'), 'utf8')).expo;
  const saved = { ...process.env };
  for (const k of Object.keys(process.env)) if (k.startsWith('EXPO_PUBLIC_') || k.startsWith('EAS_BUILD_')) delete process.env[k];
  Object.assign(process.env, env, { EAS_BUILD_PLATFORM: platform, EAS_BUILD_PROFILE: 'preview' });
  try {
    appConfig({ config: expo });
    return [];
  } catch (e) {
    return redact(e instanceof Error ? e.message : String(e), APP_CONFIG_RULES);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

export async function check(fileEnv, platforms) {
  const env = { ...fileEnv };
  const added = [];
  if (!(SELECTOR in env)) {
    env[SELECTOR] = 'staging';
    added.push(SELECTOR);
  }
  if (!(AUTH in env)) {
    env[AUTH] = '1';
    added.push(AUTH);
  }
  const { resolveStagingConfig, nativeTargetProblem } = await loadStagingEnv();
  const checks = [];

  let resolver = [];
  try {
    const cfg = resolveStagingConfig({
      envName: env[SELECTOR],
      apiKey: env[API_KEY],
      authDomain: env[AUTH_DOMAIN],
      projectId: env[PROJECT_ID],
      storageBucket: env[STORAGE_BUCKET],
      messagingSenderId: env[SENDER_ID],
      appId: env[APP_ID],
      emulatorFlagRaw: env[EMULATORS],
    });
    if (cfg === null) resolver = [{ label: 'resolves to production, not staging', names: [SELECTOR] }];
  } catch (e) {
    resolver = redact(e instanceof Error ? e.message : String(e), RESOLVER_RULES);
  }
  checks.push({ name: 'stagingEnv resolveStagingConfig', findings: resolver });

  for (const platform of platforms) {
    // A release binary: __DEV__ is false, so the emulator flag never applies (src/firebase.ts).
    const problem = nativeTargetProblem({ isNative: true, envName: env[SELECTOR], emulated: false });
    checks.push({
      name: `stagingEnv nativeTargetProblem (${platform}, release)`,
      findings: problem ? [{ label: 'a phone build must name its backend: staging or production', names: [SELECTOR] }] : [],
    });
    checks.push({ name: `app.config.js (EAS ${platform} preview)`, findings: appConfigFindings(env, platform) });
  }
  return { present: STAGING_NAMES.map((n) => [n, (env[n] ?? '').trim() !== '']), added, checks };
}

function print(result) {
  const out = [];
  out.push('check:staging-env (values are never printed)');
  for (const [name, present] of result.present) out.push(`  ${name.padEnd(40)} ${present ? 'present' : 'missing'}`);
  for (const n of [SELECTOR, AUTH]) out.push(`  ${n.padEnd(40)} ${result.added.includes(n) ? 'added for this check' : 'from the file'}`);
  for (const c of result.checks) {
    out.push(`${c.findings.length ? 'FAIL' : 'PASS'}  ${c.name}`);
    for (const f of c.findings) out.push(`        - ${f.label} [${f.names.join(', ')}]`);
  }
  const ok = result.checks.every((c) => c.findings.length === 0);
  out.push(ok ? 'PASS' : 'FAIL');
  process.stdout.write(`${out.join('\n')}\n`);
  return ok;
}

async function main() {
  const args = process.argv.slice(2);
  const pi = args.indexOf('--platform');
  const platform = pi >= 0 ? args[pi + 1] : undefined;
  const file = args.find((a, i) => !a.startsWith('--') && !(pi >= 0 && i === pi + 1));
  if (!file || (platform !== undefined && !['ios', 'android'].includes(platform))) {
    process.stdout.write('usage: npm run check:staging-env -- <path-to-env-file> [--platform ios|android]\nFAIL\n');
    return 1;
  }
  const path = resolve(process.cwd(), file);
  if (isTracked(path)) {
    process.stdout.write('refused: that file is tracked by git; a staging value must never be in the repository.\nFAIL\n');
    return 1;
  }
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    process.stdout.write('refused: the file cannot be read.\nFAIL\n');
    return 1;
  }
  const result = await check(parseDotenv(text), platform ? [platform] : ['ios', 'android']);
  return print(result) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      // Never the message: it could quote a value.
      process.stdout.write(`internal error (${e && e.name ? e.name : 'Error'}); nothing was printed from the file.\nFAIL\n`);
      process.exit(1);
    },
  );
}
