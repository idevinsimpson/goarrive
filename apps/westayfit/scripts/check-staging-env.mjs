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
 * The file must be one git can never commit by accident, and one no build
 * reads. It is refused when git tracks it (by the path given or by the path
 * it resolves to), in this repository or in whatever other work tree holds
 * it (a second clone, a sibling worktree, a dotfiles or nested repository);
 * when it sits inside a repository without being ignored (a `git add -A`
 * would commit it: keep it outside the repository, for example in $TMP);
 * when it is one of the env files Expo CLI loads into this app's production
 * build (`.env`, `.env.local`, `.env.production`, `.env.production.local`),
 * ignored or not, because `npm run build:web` would inline it: refused by
 * that NAME anywhere, in any case (any checkout of the app builds from it;
 * RV11-641-SEC-F2), and by device and inode for a link into this app; when
 * it has more than one hard link (it could be a tracked file under another
 * name); on Linux, when it is reached through a bind mount of another
 * directory (git cannot see where it really lives; SEC-F4); and whenever git
 * cannot answer (no git, no work tree, an unexpected reply): the check never
 * passes a file it could not place. git runs with no repository-local
 * fsmonitor hook and from an absolute PATH entry only (SEC-N1), and looks for
 * a work tree across mount points (SEC-F3).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const ORIGIN = 'EXPO_PUBLIC_WSF_PUBLIC_ORIGIN';
const INVITE_HOSTS = 'EXPO_PUBLIC_WSF_INVITE_HOSTS';
const KNOWN_NAMES = [...STAGING_NAMES, SELECTOR, AUTH, EMULATORS, HARNESS, ORIGIN, INVITE_HOSTS];
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
  // W12-13 (INT-08): the origin a phone build names.
  { test: new RegExp(`^\\s*${REFUSED}${ORIGIN} is not an https origin on a public host `), label: 'must be an https origin on a public host', names: [ORIGIN] },
  { test: new RegExp(`^\\s*${REFUSED}a production (ios|android) build needs ${ORIGIN}, `), label: 'a production build needs a public origin', names: [ORIGIN] },
  {
    test: new RegExp(`^\\s*${REFUSED}the host of ${ORIGIN} is not in ${INVITE_HOSTS}, `),
    label: 'the origin\'s host must be one of the invite hosts',
    names: [ORIGIN, INVITE_HOSTS],
  },
];

/*
  W12-13. app.config.js WARNS (console.warn) where a build may go ahead: a
  staging build that names no public origin yet. A warning is shown as a note
  under its check, by fixed label and names, and never fails it.
*/
const WARNED = 'WSF native build warning: ';
export const APP_CONFIG_WARNINGS = [
  {
    test: new RegExp(`^\\s*${WARNED}${ORIGIN} is not set for this staging (ios|android) build, `),
    label: 'not set: this staging build has no MOVE handoff or station QR codes yet (a warning)',
    names: [ORIGIN],
  },
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
  notIgnored: 'refused: the file is inside a repository and git does not ignore it; keep it outside the repository (for example $TMP).',
  expoLoaded: 'refused: Expo loads a file of this name into the app\'s builds from any checkout (.env, .env.local, .env.production, .env.production.local); give it another name and keep it outside the repository (for example $TMP/wsf-staging.env).',
  bindMount: 'refused: the file is reached through a bind mount of another directory, so git cannot see where it really lives; copy it to a file of its own outside the repository (for example $TMP).',
  mounts: 'refused: the mount table could not be read to show where the file lives; nothing was read.',
  git: 'refused: git could not show that the file is outside the repository or ignored by it (no git, no work tree, or an unexpected answer); nothing was read.',
};

/*
  THE ENV FILES EXPO CLI LOADS for this app's production build (`expo
  export`, so `npm run build:web`), which would inline every EXPO_PUBLIC_*
  value into the bundle. The fixed four always, plus whatever @expo/env
  itself says for 'production' when it can be loaded (it can be switched off
  with EXPO_NO_DOTENV here and not at build time, so it only ever adds).
  `.env.development.local` is not among them: only `expo start` loads it.
*/
const EXPO_PRODUCTION_ENV_FILES = ['.env.production.local', '.env.local', '.env.production', '.env'];
/** The names of those files: the fixed four plus @expo/env's own list. */
export function expoLoadedEnvNames(appRoot = APP_ROOT) {
  const names = new Set(EXPO_PRODUCTION_ENV_FILES);
  try {
    const expoEnv = createRequire(join(appRoot, 'package.json'))('@expo/env');
    for (const f of expoEnv.getFiles('production', { silent: true })) if (typeof f === 'string' && f) names.add(basename(f));
  } catch {
    // The fixed four stand on their own.
  }
  return [...names];
}
export function expoLoadedEnvFiles(appRoot = APP_ROOT) {
  return expoLoadedEnvNames(appRoot).map((n) => join(appRoot, n));
}

/**
 * Whether the file is one Expo would load. RV11-641-SEC-F2: by NAME, the
 * given or the real one, in any case and anywhere, because the same file in
 * any other checkout of this app (a sibling worktree, a second clone) is
 * loaded by a build run there, and git ignores these names. And by device and
 * inode for this app's own files (a symlink or a second name does not hide
 * them).
 */
function isExpoLoaded(given, real, st, appRoot = APP_ROOT) {
  const names = expoLoadedEnvNames(appRoot);
  const lower = new Set(names.map((n) => n.toLowerCase()));
  if (lower.has(basename(given).toLowerCase()) || lower.has(basename(real).toLowerCase())) return true;
  for (const f of names.map((n) => join(appRoot, n))) {
    try {
      const other = statSync(f);
      if (other.dev === st.dev && other.ino === st.ino) return true;
    } catch {
      // Not there: nothing to match.
    }
  }
  return false;
}

/**
 * The environment every git command runs in: the C locale (so its replies
 * can be read); no GIT_* variable that could point it at another repository
 * or index; GIT_DISCOVERY_ACROSS_FILESYSTEM=1, so a file on a filesystem
 * mounted inside a work tree is still found to be in it (RV11-641-SEC-F3);
 * and only the absolute PATH entries, so a `git` next to the env file (a
 * relative entry such as `.`, resolved against the file's directory) never
 * runs (SEC-N1).
 * @param {Record<string, string | undefined>} [base]
 */
export function gitEnv(base = process.env) {
  const env = { ...base, LC_ALL: 'C', LANGUAGE: '' };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  env.GIT_DISCOVERY_ACROSS_FILESYSTEM = '1';
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = String(env[pathKey] ?? '')
    .split(delimiter)
    .filter((entry) => isAbsolute(entry))
    .join(delimiter);
  return env;
}

/** Ahead of every git command: no repository-local fsmonitor hook (it could read the file) and no untracked cache (SEC-N1). */
export const GIT_SAFETY_ARGS = ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false'];

/**
 * One git command in `cwd` (the app's work tree unless said otherwise).
 * Returns { status, stdout, stderr }; status is null when git did not run.
 */
function runGit(args, cwd = APP_ROOT) {
  const r = spawnSync('git', [...GIT_SAFETY_ARGS, ...args], { cwd, env: gitEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { status: r.error ? null : r.status, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? '') };
}

/*
  git's own replies, matched on the exit code AND the whole first line of its
  message, built from the exact pathspec and path that were passed
  (RV11-641-SEC-N2; git prints both verbatim): a crafted directory name
  cannot make another error read as one of these. Free text elsewhere in
  stderr never decides anything; a path with a newline in it matches none of
  these, and refuses.
*/
const firstLine = (text) => {
  const end = text.indexOf('\n');
  return end === -1 ? text : text.slice(0, end);
};
export const GIT_REPLY = {
  /** `ls-files --error-unmatch -- <spec>` on a path the index does not have. */
  untracked: (stderr, spec) => firstLine(stderr) === `error: pathspec '${spec}' did not match any file(s) known to git`,
  /** A pathspec element `elt` (whose path is `path`) outside the work tree. */
  outside: (stderr, elt, path) => {
    const line = firstLine(stderr);
    const head = `fatal: ${elt}: '${path}' is outside repository at '`;
    return line.startsWith(head) && line.length > head.length + 1 && line.endsWith("'");
  },
  /** "(or any parent up to mount point /x)" or "(or any of the parent directories): .git" */
  notARepository: (stderr) => /^fatal: not a git repository \(or any (?:of the )?parent[^\n]*$/.test(firstLine(stderr)),
};
const isUntracked = (r, spec) => r.status === 1 && GIT_REPLY.untracked(r.stderr, spec);
const isOutside = (r, elt, path) => r.status === 128 && GIT_REPLY.outside(r.stderr, elt, path);

/** core.ignorecase for the repository at `cwd`: true, false, or null when git gives no clean answer. */
function ignoresCase(git, cwd) {
  const r = git(['config', '--bool', 'core.ignorecase'], cwd);
  if (r.status === 1 && r.stdout.trim() === '') return false;
  if (r.status === 0 && r.stdout.trim() === 'true') return true;
  if (r.status === 0 && r.stdout.trim() === 'false') return false;
  return null;
}

/** A pathspec that is exactly this path (no glob, no magic of its own), case-folded where the repository folds case (RV9-641-I11-4). */
const exactly = (path, icase) => `:(literal${icase ? ',icase' : ''})${path}`;

/**
 * Why git says this file may not be read, or null. `given` is the path as
 * typed (resolved), `real` its realpath; `git(args, cwd)` runs one git
 * command.
 *
 *   1. The app's own repository first, which also shows git works here: the
 *      given and the real path must be untracked or outside it, and inside
 *      it the file must be ignored.
 *   2. Then the work tree that holds the file itself, whichever it is
 *      (another clone, a sibling worktree, a dotfiles or nested repository;
 *      RV9-641-I11-1): there too it must be untracked and ignored. Only a
 *      clean "not a git repository" means no work tree holds it.
 *
 * Every other answer refuses.
 */
export function gitRefusal(given, real, git = runGit) {
  const appIcase = ignoresCase(git, APP_ROOT);
  if (appIcase === null) return REFUSALS.git;
  for (const p of new Set([given, real])) {
    const spec = exactly(p, appIcase);
    const r = git(['ls-files', '--error-unmatch', '--', spec], APP_ROOT);
    if (r.status === 0) return REFUSALS.tracked;
    if (!isUntracked(r, spec) && !isOutside(r, spec, p)) return REFUSALS.git;
  }
  // check-ignore takes no pathspec magic; an absolute path never starts with ':'.
  const own = git(['check-ignore', '-q', '--', real], APP_ROOT);
  if (own.status === 1) return REFUSALS.notIgnored;
  if (own.status !== 0 && !isOutside(own, real, real)) return REFUSALS.git;

  const top = git(['rev-parse', '--show-toplevel'], dirname(real));
  if (top.status === 128 && GIT_REPLY.notARepository(top.stderr)) return null;
  const root = top.status === 0 ? top.stdout.replace(/\n$/, '') : '';
  if (!root || root.includes('\n')) return REFUSALS.git;
  const icase = ignoresCase(git, root);
  if (icase === null) return REFUSALS.git;
  const spec = exactly(real, icase);
  const tracked = git(['ls-files', '--error-unmatch', '--', spec], root);
  if (tracked.status === 0) return REFUSALS.tracked;
  if (!isUntracked(tracked, spec)) return REFUSALS.git;
  const ignored = git(['check-ignore', '-q', '--', real], root);
  if (ignored.status === 0) return null;
  if (ignored.status === 1) return REFUSALS.notIgnored;
  return REFUSALS.git;
}

/*
  RV11-641-SEC-F4. A BIND MOUNT shows a directory's files under a path no
  work tree holds: realpath does not see through it, nlink stays 1, and git
  finds no repository there, so a tracked file could pass. On Linux the
  mount table says so: the mount that holds the file (the longest mount
  point above it; a later mount on the same point covers an earlier one)
  has a root other than '/'. A btrfs subvolume mounted whole names its
  subvolume as its root; that is not a bind. Where there is no mount table
  (macOS, Windows) nothing is checked; where it cannot be read, the file is
  refused. Mounts stacked over a parent of an earlier mount are not modelled.
*/
const unescapeMount = (field) => field.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
function parseMountInfo(text) {
  const mounts = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const f = line.split(' ');
    const sep = f.indexOf('-', 6);
    if (f.length < 7 || sep === -1 || f.length < sep + 3) return null;
    mounts.push({ root: unescapeMount(f[3]), mountPoint: unescapeMount(f[4]), fsType: f[sep + 1], superOptions: f[sep + 3] ?? '' });
  }
  return mounts;
}
const subvolOf = (superOptions) => {
  const opt = superOptions.split(',').find((o) => o.startsWith('subvol='));
  return opt === undefined ? null : `/${opt.slice('subvol='.length).replace(/^\/+/, '')}`;
};
/** Why the mount table refuses `real`, or null. `mountinfo` is /proc/self/mountinfo's text, or null where there is none. */
export function bindMountRefusal(real, mountinfo) {
  if (mountinfo === null) return null;
  const mounts = parseMountInfo(mountinfo);
  if (!mounts || mounts.length === 0) return REFUSALS.mounts;
  let holder = null;
  for (const m of mounts) {
    const holds = m.mountPoint === '/' || real === m.mountPoint || real.startsWith(`${m.mountPoint}/`);
    if (holds && (!holder || m.mountPoint.length >= holder.mountPoint.length)) holder = m;
  }
  if (!holder) return REFUSALS.mounts;
  if (holder.root === '/') return null;
  if (holder.fsType === 'btrfs' && subvolOf(holder.superOptions) === holder.root) return null;
  return REFUSALS.bindMount;
}
/** /proc/self/mountinfo, null where there is none, '' where it cannot be read (refused). */
export function readMountInfo(path = '/proc/self/mountinfo') {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    return e && e.code === 'ENOENT' ? null : '';
  }
}

/**
 * The file's realpath and null, or null and why it is refused, before anything
 * is read. `appRoot` is the app whose Expo env files are refused (this app;
 * a test passes a fake one, so it never touches the real app directory), and
 * `mounts` reads the mount table (a test passes its own).
 */
export function placeFile(given, git = runGit, appRoot = APP_ROOT, mounts = () => readMountInfo()) {
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
  const bound = bindMountRefusal(real, mounts());
  if (bound) return { real: null, refusal: bound };
  if (isExpoLoaded(given, real, st, appRoot)) return { real: null, refusal: REFUSALS.expoLoaded };
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
  // A warning is collected, never written: its text is mapped to a fixed label like a refusal (W12-13).
  const warn = console.warn;
  const warnings = [];
  console.warn = (...parts) => {
    warnings.push(parts.map(String).join(' '));
  };
  try {
    appConfig({ config: expo });
    return { findings: [], notes: warnings.flatMap((w) => redactWarning(w)) };
  } catch (e) {
    return { findings: redact(e instanceof Error ? e.message : String(e), APP_CONFIG_RULES), notes: warnings.flatMap((w) => redactWarning(w)) };
  } finally {
    console.warn = warn;
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

/** A warning mapped to [{ label, names }] by APP_CONFIG_WARNINGS; its text is never returned or printed. */
export function redactWarning(message) {
  const found = redact(message, APP_CONFIG_WARNINGS);
  return found.map((f) => (f.label === UNRECOGNISED ? { label: 'a warning (an unrecognised rule)', names: f.names } : f));
}

// TODO(RV8-642-N3): refuse a SET EXPO_PUBLIC_WSF_INVITE_HOSTS whose
// configuredInviteHosts() is [] (configured but empty: native Copy and Share
// would disappear). Import the member lane's parser from src/joinInput.ts once
// this branch has it (it lands with candidate-5); never a copy of its rules.
// RV8-642-N4 (W12-13): app.config.js now refuses a build whose
// EXPO_PUBLIC_WSF_PUBLIC_ORIGIN host is not in EXPO_PUBLIC_WSF_INVITE_HOSTS
// when both are set, and this check maps that refusal like the others.
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
    const { findings, notes } = appConfigFindings(env, platform);
    checks.push({ name: `app.config.js (EAS ${platform} preview)`, findings, notes });
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
    for (const f of c.notes ?? []) out.push(`        note: ${f.label} [${f.names.join(', ')}]`);
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

/*
  Run as a script, not imported. Compared by real path: node loads the main
  module by its real path, so a script reached through a symlinked directory
  (macOS's /var and /tmp, a linked checkout) would otherwise do nothing and
  exit 0 (found with RV12-641-1's symlinked temporary directory).
*/
const realOrNull = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
};
const invokedAs = process.argv[1] ? realOrNull(process.argv[1]) : null;
if (invokedAs !== null && invokedAs === realOrNull(fileURLToPath(import.meta.url))) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      // Never the message, nor a name the error chose: either could quote a value.
      process.stdout.write(`${internalErrorLine(e)}\nFAIL\n`);
      process.exit(1);
    },
  );
}
