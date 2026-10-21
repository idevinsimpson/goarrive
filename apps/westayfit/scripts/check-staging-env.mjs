#!/usr/bin/env node
/**
 * I-9c. CHECK A STAGING ENV FILE BEFORE IT GOES ANYWHERE, WITHOUT SEEING IT.
 *
 * Usage (from apps/westayfit):
 *   npm run check:staging-env -- <path-to-env-file> [--platform ios|android]
 * (`--platform=ios` works too). Exactly one file; any other flag is refused.
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
 * The file must be one git can never commit by accident. It is refused when
 * git tracks it (by the path given or by the path it resolves to), when it
 * sits inside the repository without being ignored (a `git add -A` would
 * commit it; use a `.env*.local` name or keep it outside), when it has more
 * than one hard link (it could be a tracked file under another name), and
 * whenever git cannot answer (no git, no work tree, an unexpected reply):
 * the check never passes a file it could not place.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
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
  Only the label and names below are ever printed.

  Every test is anchored at the start of the line (`^\s*`), on the fixed words
  a refusal opens with. A value never opens a line (every refusal in
  src/stagingEnv.ts and app.config.js starts with fixed text, and a dotenv
  value cannot hold a newline), so a value that happens to contain another
  rule's words cannot pick the rule. The specific `${NAME} is "` lines come
  first, the generic any-name rule last.
*/
export const RESOLVER_RULES = [
  { test: new RegExp(`^\\s*${SELECTOR} is ".*", which is not a recognised environment\\.`), label: 'must be exactly "staging" or "production"', names: [SELECTOR] },
  { test: new RegExp(`^\\s*${PROJECT_ID} is ".*", which names the production project`), label: 'PROJECT_ID must not name the production project', names: [PROJECT_ID] },
  {
    test: new RegExp(`^\\s*${AUTH_DOMAIN} is ".*" but project ".*" means it must be "`),
    label: 'AUTH_DOMAIN must equal <PROJECT_ID>.firebaseapp.com',
    names: [AUTH_DOMAIN, PROJECT_ID],
  },
  {
    test: new RegExp(`^\\s*${STORAGE_BUCKET} is ".*" but project ".*" means it must be one of `),
    label: 'STORAGE_BUCKET must be <PROJECT_ID>.firebasestorage.app or <PROJECT_ID>.appspot.com',
    names: [STORAGE_BUCKET, PROJECT_ID],
  },
  { test: new RegExp(`^\\s*${APP_ID} is ".*", which does not have the shape 1:`), label: 'APP_ID must be a web app id, 1:<SENDER_ID>:web:<hex>', names: [APP_ID, SENDER_ID] },
  { test: new RegExp(`^\\s*${SENDER_ID} must be all digits; got "`), label: 'SENDER_ID must be all digits', names: [SENDER_ID] },
  { test: new RegExp(`^\\s*${API_KEY} is not the shape of a Firebase browser API key\\.`), label: 'API_KEY must have the shape of a Firebase browser key', names: [API_KEY] },
  { test: /^\s*These variables are set but empty: /, label: 'present but blank', names: 'listed' },
  {
    test: new RegExp(`^\\s*A complete staging Firebase config was supplied, but ${SELECTOR} is `),
    label: `staging values need ${SELECTOR}=staging`,
    names: [SELECTOR, ...STAGING_NAMES],
  },
  {
    // The list is the group: only the names inside the brackets, never what follows.
    test: new RegExp(`^\\s*Staging values were supplied \\(([A-Z_, ]*)\\), but ${SELECTOR} is `),
    label: `staging values need ${SELECTOR}=staging`,
    names: 'selector+group',
  },
  { test: new RegExp(`^\\s*${SELECTOR}=staging and the emulator flag are both set\\.`), label: 'staging and the emulator flag are exclusive', names: [SELECTOR, EMULATORS] },
  { test: /^\s*Missing: /, label: 'missing', names: 'listed' },
  { test: /^\s*(EXPO_PUBLIC_WSF_STAGING_[A-Z_]+) is the PRODUCTION value\./, label: 'must not be a production value', names: 'group' },
];

const REFUSED = 'WSF native build refused: ';
export const APP_CONFIG_RULES = [
  { test: new RegExp(`^\\s*${REFUSED}${SELECTOR} must be "staging" or "production" for an? `), label: 'must be "staging" or "production"', names: [SELECTOR] },
  {
    test: new RegExp(`^\\s*${REFUSED}profile "[^"]*" embeds its JavaScript, so ${EMULATORS} cannot name its backend`),
    label: 'a release build cannot use the emulator',
    names: [EMULATORS, SELECTOR],
  },
  { test: new RegExp(`^\\s*${REFUSED}${HARNESS} is set for a production `), label: 'the crash harness is refused in production', names: [HARNESS] },
  {
    test: new RegExp(`^\\s*${REFUSED}profile "[^"]*" embeds its JavaScript with ${SELECTOR}=staging, but these staging values are missing from the EAS environment: `),
    label: 'missing from the build environment',
    names: 'listed',
  },
  {
    test: new RegExp(`^\\s*${REFUSED}profile "[^"]*" embeds its JavaScript, but ${AUTH} is not set to 1 or 0 \\(got "`),
    label: 'must be 1 (only a production build may say 0)',
    names: [AUTH],
  },
  { test: new RegExp(`^\\s*${REFUSED}${AUTH} is off for an? `), label: 'is off for a non-production build', names: [AUTH] },
];

export const UNRECOGNISED = 'refused (an unrecognised rule)';

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
    else if (rule.names === 'selector+group') names = [SELECTOR, ...namesIn(match[1]).filter((n) => STAGING_NAMES.includes(n))];
    else if (rule.names === 'group') names = namesIn(match[1]);
    else names = rule.names;
    findings.push({ label: rule.label, names });
  }
  if (findings.length === 0) findings.push({ label: UNRECOGNISED, names: namesIn(String(message)) });
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

export const REFUSALS = {
  unreadable: 'refused: the file cannot be read.',
  notFile: 'refused: that is not a regular file.',
  hardLinked: 'refused: the file has more than one hard link, so it could be a tracked file under another name; copy it to a file of its own.',
  tracked: 'refused: that file is tracked by git; a staging value must never be in the repository.',
  notIgnored: 'refused: the file is inside the repository and not ignored; move it out or use a .env*.local name.',
  git: 'refused: git could not show that the file is outside the repository or ignored by it (no git, no work tree, or an unexpected answer); nothing was read.',
};

/**
 * One git command, from the app's own work tree, in the C locale (so its
 * replies can be read), and with no GIT_* variable that could point it at
 * another repository or index. Returns { status, stderr }; status is null
 * when git did not run at all.
 */
function runGit(args) {
  const env = { ...process.env, LC_ALL: 'C', LANGUAGE: '' };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  const r = spawnSync('git', args, { cwd: APP_ROOT, env, encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] });
  return { status: r.error ? null : r.status, stderr: String(r.stderr ?? '') };
}

const UNTRACKED = /did not match any file/;
const OUTSIDE = /is outside repository/;

/**
 * Why git says this file may not be read, or null. `given` is the path as
 * typed (resolved), `real` its realpath; `git` runs one git command. Only
 * three answers let a file through: "did not match" (not tracked),
 * "is outside repository", and an ignored path. Anything else refuses.
 */
export function gitRefusal(given, real, git = runGit) {
  for (const p of new Set([given, real])) {
    const r = git(['ls-files', '--error-unmatch', '--', p]);
    if (r.status === 0) return REFUSALS.tracked;
    const untracked = r.status === 1 && UNTRACKED.test(r.stderr);
    const outside = r.status === 128 && OUTSIDE.test(r.stderr);
    if (!untracked && !outside) return REFUSALS.git;
  }
  const r = git(['check-ignore', '-q', '--', real]);
  if (r.status === 0) return null;
  if (r.status === 1) return REFUSALS.notIgnored;
  if (r.status === 128 && OUTSIDE.test(r.stderr)) return null;
  return REFUSALS.git;
}

/** The file's realpath and null, or null and why it is refused, before anything is read. */
export function placeFile(given, git = runGit) {
  let real;
  let st;
  try {
    real = realpathSync(given);
    st = statSync(real);
  } catch {
    return { real: null, refusal: REFUSALS.unreadable };
  }
  if (!st.isFile()) return { real: null, refusal: REFUSALS.notFile };
  if (st.nlink > 1) return { real: null, refusal: REFUSALS.hardLinked };
  const refusal = gitRefusal(given, real, git);
  return refusal ? { real: null, refusal } : { real, refusal: null };
}

const USAGE = 'usage: npm run check:staging-env -- <path-to-env-file> [--platform ios|android]';

/** argv after the script: exactly one file, and at most one --platform (ios or android). Anything else is { error }. */
export function parseArgs(argv) {
  let platform;
  const files = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--platform' || a.startsWith('--platform=')) {
      if (platform !== undefined) return { error: USAGE };
      if (a === '--platform') {
        if (i + 1 >= argv.length) return { error: USAGE };
        i += 1;
        platform = argv[i];
      } else platform = a.slice('--platform='.length);
    } else if (a.startsWith('-')) return { error: USAGE };
    else files.push(a);
  }
  if (files.length !== 1) return { error: USAGE };
  if (platform !== undefined && !['ios', 'android'].includes(platform)) return { error: USAGE };
  return { file: files[0], platform };
}

/** The internal-error line: only a standard error class name, never anything the error carries. */
const STANDARD_ERRORS = ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'URIError', 'EvalError', 'AggregateError'];
export function internalErrorLine(e) {
  const name = e && typeof e.name === 'string' && STANDARD_ERRORS.includes(e.name) ? e.name : 'Error';
  return `internal error (${name}); nothing was printed from the file.`;
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
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    process.stdout.write(`${args.error}\nFAIL\n`);
    return 1;
  }
  const { real, refusal } = placeFile(resolve(process.cwd(), args.file));
  if (refusal) {
    process.stdout.write(`${refusal}\nFAIL\n`);
    return 1;
  }
  let text;
  try {
    text = readFileSync(real, 'utf8');
  } catch {
    process.stdout.write(`${REFUSALS.unreadable}\nFAIL\n`);
    return 1;
  }
  const result = await check(parseDotenv(text), args.platform ? [args.platform] : ['ios', 'android']);
  return print(result) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      // Never the message, nor a name the error chose: either could quote a value.
      process.stdout.write(`${internalErrorLine(e)}\nFAIL\n`);
      process.exit(1);
    },
  );
}
