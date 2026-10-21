// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { copyFileSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';

import {
  APP_CONFIG_RULES,
  GIT_REPLY,
  GIT_SAFETY_ARGS,
  REFUSALS,
  bindMountRefusal,
  expoLoadedEnvFiles,
  readMountInfo,
  expoLoadedEnvNames,
  gitEnv,
  placeFile,
  RESOLVER_RULES,
  UNRECOGNISED,
  gitRefusal,
  internalErrorLine,
  parseArgs,
  redact,
} from '../scripts/check-staging-env.mjs';

/**
 * I-9c: `npm run check:staging-env` checks a staging env file with the app's
 * own rules and never prints a value. Every value here is a dummy, clearly
 * fake, and the leak tests use unique sentinels: no 4-character piece of any
 * of them may appear in anything the script writes. The script runs as the
 * owner would run it, in a child process, on files outside the repository.
 */

const APP_ROOT = join(__dirname, '..');
const SCRIPT = join(APP_ROOT, 'scripts', 'check-staging-env.mjs');
/*
  RV12-641-1. Every temporary directory is named by its real path: on macOS
  the temporary directory is reached through a symlink (/var -> /private/var),
  and the script reports real paths.
*/
const TMP_REAL = realpathSync(tmpdir());
const DIR = realpathSync(mkdtempSync(join(tmpdir(), 'wsf-check-staging-env-')));
let n = 0;

// RV7-641-7: only what this file made. DIR holds plain files and links, never a directory; it is
// removed in the one afterAll below, with the fixtures, before that hook judges anything.

/*
  RV11-641-SEC-F1. THIS FILE NEVER WRITES INTO THE REAL APP DIRECTORY. An
  owner's checkout keeps real staging values in apps/westayfit/.env.development.local
  (and may keep .env.local); a test that wrote or unlinked a fixed name there
  would destroy them. Every in-repository case uses the repositories made
  below, and the Expo env-file cases a fake app directory (FAKE_APP) passed to
  placeFile. The real app directory's .env* files are recorded now and checked
  untouched in afterAll; the fake directory's sentinels likewise.
*/
const envEntries = (dir: string) =>
  readdirSync(dir)
    .filter((name) => name.startsWith('.env'))
    .sort()
    .map((name) => {
      const st = lstatSync(join(dir, name));
      return { name, ino: st.ino, size: st.size, mtimeMs: st.mtimeMs };
    });
const APP_ENV_BEFORE = envEntries(APP_ROOT);

const FAKE_APP = realpathSync(mkdtempSync(join(tmpdir(), 'wsf-check-staging-env-app-')));
const EXPO_FILES = ['.env', '.env.local', '.env.production', '.env.production.local'];
const SENTINEL = (name: string) => `# OWNER_SENTINEL ${name} ${process.pid}: this file must survive the tests unchanged\n`;
for (const name of [...EXPO_FILES, '.env.development.local']) writeFileSync(join(FAKE_APP, name), SENTINEL(name));

/*
  Real repositories, made here: a small repository with a tracked file, an
  ignored one and a loose one, and a `git worktree add` sibling of it. All
  of it lives under one mkdtemp directory of its own, removed in afterAll
  entry by entry (never following a link) after checking it is that
  directory.
*/
const REPOS = realpathSync(mkdtempSync(join(tmpdir(), 'wsf-check-staging-env-repos-')));
const REPO = join(REPOS, 'repo');
const SIBLING = join(REPOS, 'sibling');
const fixtureGit = (cwd: string, ...args: string[]) => {
  const r = spawnSync(
    'git',
    ['-c', 'user.name=wsf-test', '-c', 'user.email=wsf-test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', '-c', 'core.hooksPath=/dev/null', ...args],
    { cwd, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed`);
};
mkdirSync(REPO);
fixtureGit(REPO, 'init', '-q');
writeFileSync(join(REPO, '.gitignore'), '*.local\n');
writeFileSync(join(REPO, 'tracked.env'), '# dummy values for a test, not real\n');
fixtureGit(REPO, 'add', '.gitignore', 'tracked.env');
fixtureGit(REPO, 'commit', '-q', '-m', 'test fixture');
fixtureGit(REPO, 'worktree', 'add', '-q', SIBLING);

function removeOwnTree(dir: string) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (lstatSync(full).isDirectory()) {
      removeOwnTree(full);
      rmdirSync(full);
    } else unlinkSync(full);
  }
}
afterAll(() => {
  // The guard reads first, cleans up whatever it finds, and only then judges, so a failure leaves nothing behind.
  const appEnvAfter = envEntries(APP_ROOT);
  const sentinels = [...EXPO_FILES, '.env.development.local'].map((name) => {
    try {
      return readFileSync(join(FAKE_APP, name), 'utf8');
    } catch {
      return null;
    }
  });
  for (const entry of readdirSync(DIR)) unlinkSync(join(DIR, entry));
  rmdirSync(DIR);
  for (const dir of [FAKE_APP, REPOS]) {
    if (dir.startsWith(TMP_REAL) && basename(dir).startsWith('wsf-check-staging-env-')) {
      removeOwnTree(dir);
      rmdirSync(dir);
    }
  }
  // The real app directory's env files are exactly as they were, and so are the fake one's sentinels.
  expect(appEnvAfter).toEqual(APP_ENV_BEFORE);
  expect(sentinels).toEqual([...EXPO_FILES, '.env.development.local'].map(SENTINEL));
});

const GOOD: Record<string, string> = {
  EXPO_PUBLIC_WSF_STAGING_API_KEY: 'AIzaFAKEfakeFAKEfakeFAKEfakeFAKEfake123',
  EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN: 'wsf-fake-staging.firebaseapp.com',
  EXPO_PUBLIC_WSF_STAGING_PROJECT_ID: 'wsf-fake-staging',
  EXPO_PUBLIC_WSF_STAGING_STORAGE_BUCKET: 'wsf-fake-staging.firebasestorage.app',
  EXPO_PUBLIC_WSF_STAGING_SENDER_ID: '123456789012',
  EXPO_PUBLIC_WSF_STAGING_APP_ID: '1:123456789012:web:0123456789abcdef',
};
const NAMES = Object.keys(GOOD);

function run(env: Record<string, string | undefined>, ...args: string[]) {
  const file = join(DIR, `case-${(n += 1)}.env`);
  const text = Object.entries(env)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  writeFileSync(file, `# dummy values for a test, not real\n${text}\n`);
  return runOn(file, ...args);
}

function runOn(file: string, ...args: string[]) {
  return runWith({}, file, ...args);
}

function runWith(extraEnv: Record<string, string>, ...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: APP_ROOT, encoding: 'utf8', env: { ...process.env, ...extraEnv } });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, all: `${r.stdout}${r.stderr}` };
}

const envText = (env: Record<string, string>) =>
  `# dummy values for a test, not real\n${Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')}\n`;

// The fixture repository's loose and ignored files, with dummy values (written after envText exists).
writeFileSync(join(REPO, 'loose.env'), envText(GOOD));
writeFileSync(join(REPO, 'kept.local'), envText(GOOD));
writeFileSync(join(SIBLING, 'loose.env'), envText(GOOD));

/** The script run from another directory (a relative path is resolved against it). */
function runIn(cwd: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: process.env });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, all: `${r.stdout}${r.stderr}` };
}

const failures = (stdout: string) =>
  stdout
    .split('\n')
    .filter((l) => l.trim().startsWith('- '))
    .map((l) => l.trim());

describe('check:staging-env: the app\'s own rules, by name only', () => {
  it('a complete, coherent config passes every check on both platforms', () => {
    const r = run(GOOD);
    expect(r.code).toBe(0);
    expect(r.stdout.trim().split('\n').pop()).toBe('PASS');
    for (const name of NAMES) expect(r.stdout).toMatch(new RegExp(`${name}\\s+present`));
    expect(r.stdout).toContain('PASS  stagingEnv resolveStagingConfig');
    expect(r.stdout).toContain('PASS  stagingEnv nativeTargetProblem (ios, release)');
    expect(r.stdout).toContain('PASS  app.config.js (EAS android preview)');
    expect(r.stdout).toMatch(/EXPO_PUBLIC_WSF_ENV\s+added for this check/);
    expect(r.stderr).toBe('');
  });

  it.each(NAMES)('a missing %s fails, named as missing by the app and by app.config.js', (name) => {
    const r = run({ ...GOOD, [name]: undefined }, '--platform', 'ios');
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(new RegExp(`${name}\\s+missing`));
    expect(failures(r.stdout)).toEqual([`- missing [${name}]`, `- missing from the build environment [${name}]`]);
    expect(r.stdout.trim().split('\n').pop()).toBe('FAIL');
  });

  it('a production project id is refused', () => {
    const id = 'goarrive-fake';
    const r = run({
      ...GOOD,
      EXPO_PUBLIC_WSF_STAGING_PROJECT_ID: id,
      EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN: `${id}.firebaseapp.com`,
      EXPO_PUBLIC_WSF_STAGING_STORAGE_BUCKET: `${id}.firebasestorage.app`,
    });
    expect(r.code).toBe(1);
    expect(failures(r.stdout)).toEqual(['- PROJECT_ID must not name the production project [EXPO_PUBLIC_WSF_STAGING_PROJECT_ID]']);
  });

  it('an authDomain that is not <projectId>.firebaseapp.com is refused', () => {
    const r = run({ ...GOOD, EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN: 'another-fake.firebaseapp.com' });
    expect(failures(r.stdout)).toEqual([
      '- AUTH_DOMAIN must equal <PROJECT_ID>.firebaseapp.com [EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN, EXPO_PUBLIC_WSF_STAGING_PROJECT_ID]',
    ]);
    expect(r.code).toBe(1);
  });

  it('a storage bucket of another project is refused', () => {
    const r = run({ ...GOOD, EXPO_PUBLIC_WSF_STAGING_STORAGE_BUCKET: 'another-fake.appspot.com' });
    expect(failures(r.stdout)).toEqual([
      '- STORAGE_BUCKET must be <PROJECT_ID>.firebasestorage.app or <PROJECT_ID>.appspot.com [EXPO_PUBLIC_WSF_STAGING_STORAGE_BUCKET, EXPO_PUBLIC_WSF_STAGING_PROJECT_ID]',
    ]);
  });

  it('a sender id that is not all digits is refused', () => {
    const r = run({ ...GOOD, EXPO_PUBLIC_WSF_STAGING_SENDER_ID: '12345abc' });
    expect(failures(r.stdout)).toEqual(['- SENDER_ID must be all digits [EXPO_PUBLIC_WSF_STAGING_SENDER_ID]']);
  });

  it('an app id that is not a web app id of that sender is refused', () => {
    const r = run({ ...GOOD, EXPO_PUBLIC_WSF_STAGING_APP_ID: '1:123456789012:ios:0123456789abcdef' });
    expect(failures(r.stdout)).toEqual([
      '- APP_ID must be a web app id, 1:<SENDER_ID>:web:<hex> [EXPO_PUBLIC_WSF_STAGING_APP_ID, EXPO_PUBLIC_WSF_STAGING_SENDER_ID]',
    ]);
  });

});

describe('check:staging-env refuses a file git could commit, and fails closed without git', () => {
  const refusedWith = (r: ReturnType<typeof runOn>, refusal: string) => {
    expect(r.code).toBe(1);
    expect(r.stdout).toBe(`${refusal}\nFAIL\n`);
    expect(r.stderr).toBe('');
  };
  it('refuses to read a file git tracks', () => {
    refusedWith(runOn(join(APP_ROOT, 'app.json')), REFUSALS.tracked);
  });

  it('RV7-641-2: an untracked file inside a repository that git does not ignore is refused before it is read', () => {
    refusedWith(runOn(join(REPO, 'loose.env')), REFUSALS.notIgnored);
    // The same file, named relative to where the script runs.
    refusedWith(runIn(REPO, 'loose.env'), REFUSALS.notIgnored);
  });

  it('a file inside a repository that git ignores is checked', () => {
    const r = runOn(join(REPO, 'kept.local'), '--platform', 'ios');
    expect(r.code).toBe(0);
    expect(r.stdout.trim().split('\n').pop()).toBe('PASS');
  });

  it('RV7-641-1: a symlink outside the repository to a tracked file is judged by its real path', () => {
    const link = join(DIR, `link-tracked-${(n += 1)}.env`);
    symlinkSync(join(APP_ROOT, 'app.json'), link);
    refusedWith(runOn(link), REFUSALS.tracked);
  });

  it('RV7-641-1: a symlink outside the repository to an unignored file inside one is refused', () => {
    const link = join(DIR, `link-inside-${(n += 1)}.env`);
    symlinkSync(join(REPO, 'loose.env'), link);
    refusedWith(runOn(link), REFUSALS.notIgnored);
  });

  it('a file with a second hard link is refused (it could be a tracked file under another name)', () => {
    const file = join(DIR, `hard-${(n += 1)}.env`);
    writeFileSync(file, envText(GOOD));
    linkSync(file, join(DIR, `hard-${n}-twin.env`));
    refusedWith(runOn(file), REFUSALS.hardLinked);
  });

  it('a directory and a missing file are refused without reading anything', () => {
    refusedWith(runOn(DIR), REFUSALS.notFile);
    refusedWith(runOn(join(DIR, 'no-such-file.env')), REFUSALS.unreadable);
  });

  it('a GIT_* variable cannot point git at another index: a tracked file stays tracked', () => {
    refusedWith(runWith({ GIT_INDEX_FILE: join(DIR, 'no-such-index') }, join(APP_ROOT, 'app.json')), REFUSALS.tracked);
  });

  describe('gitRefusal: the app repository, then the work tree that holds the file; only clean answers pass', () => {
    type Answer = { status: number | null; stdout?: string; stderr: string };
    /*
      A reply, or how git words it for the call it answers: git prints the
      pathspec and its path verbatim, and the script now expects exactly those
      (RV11-641-SEC-N2), so a fake reply is built from the call's own last
      argument.
    */
    type Reply = Answer | ((args: string[]) => Answer);
    const pathOf = (spec: string) => spec.replace(/^:\([^)]*\)/, '');
    const OK: Reply = { status: 0, stdout: '', stderr: '' };
    const NO_MATCH: Reply = (args) => ({ status: 1, stderr: `error: pathspec '${args.at(-1)}' did not match any file(s) known to git\nDid you forget to 'git add'?\n` });
    const OUTSIDE: Reply = (args) => ({ status: 128, stderr: `fatal: ${args.at(-1)}: '${pathOf(args.at(-1)!)}' is outside repository at '/repo'\n` });
    const NOT_A_REPO: Reply = { status: 128, stderr: 'fatal: not a git repository (or any of the parent directories): .git\n' };
    const UNSET: Reply = { status: 1, stdout: '', stderr: '' };
    const asked = (r: Reply, args: string[]): Answer => (typeof r === 'function' ? r(args) : r);
    /** A reply as git words it for this call, then changed (another status, a line before it …). */
    const reword = (r: Reply, change: (a: Answer) => Answer): Reply => (args) => change(asked(r, args));
    type Answers = Partial<Record<'appConfig' | 'lsGiven' | 'lsReal' | 'appIgnore' | 'top' | 'otherConfig' | 'otherLs' | 'otherIgnore', Reply>>;
    /** Outside every repository unless a case says otherwise. */
    const fake = (a: Answers) => {
      const calls: Array<[string, string[]]> = [];
      // git's answer as the script reads it: stdout is always a string.
      const git = (args: string[], cwd?: string) => ({ stdout: '', ...asked(answer(args, cwd), args) });
      const answer = (args: string[], cwd?: string): Reply => {
        const where = cwd === APP_ROOT ? 'app' : String(cwd);
        calls.push([where, args]);
        const app = where === 'app';
        if (args[0] === 'config') return (app ? a.appConfig : a.otherConfig) ?? UNSET;
        if (args[0] === 'rev-parse') return a.top ?? NOT_A_REPO;
        if (args[0] === 'ls-files') {
          if (!app) return a.otherLs ?? NO_MATCH;
          return (args[3]!.endsWith('/given') ? a.lsGiven : a.lsReal) ?? OUTSIDE;
        }
        return (app ? a.appIgnore : a.otherIgnore) ?? (app ? OUTSIDE : OK);
      };
      return { git, calls };
    };
    const IN_OTHER: Answers = { top: { status: 0, stdout: '/repo2\n', stderr: '' } };
    const run = (a: Answers) => gitRefusal('/given', '/repo2/real.env', fake(a).git);

    it('outside every repository: allowed, after the app repository answered and the file\'s directory is no work tree', () => {
      const f = fake({});
      expect(gitRefusal('/given', '/repo2/real.env', f.git)).toBeNull();
      expect(f.calls).toEqual([
        ['app', ['config', '--bool', 'core.ignorecase']],
        ['app', ['ls-files', '--error-unmatch', '--', ':(literal)/given']],
        ['app', ['ls-files', '--error-unmatch', '--', ':(literal)/repo2/real.env']],
        ['app', ['check-ignore', '-q', '--', '/repo2/real.env']],
        ['/repo2', ['rev-parse', '--show-toplevel']],
      ]);
    });

    it('RV9-641-I11-1: in another work tree, asked there with its own root: ignored passes, tracked or not ignored refuses', () => {
      const f = fake({ ...IN_OTHER });
      expect(gitRefusal('/given', '/repo2/real.env', f.git)).toBeNull();
      expect(f.calls.slice(5)).toEqual([
        ['/repo2', ['config', '--bool', 'core.ignorecase']],
        ['/repo2', ['ls-files', '--error-unmatch', '--', ':(literal)/repo2/real.env']],
        ['/repo2', ['check-ignore', '-q', '--', '/repo2/real.env']],
      ]);
      expect(run({ ...IN_OTHER, otherLs: OK })).toBe(REFUSALS.tracked);
      expect(run({ ...IN_OTHER, otherIgnore: { status: 1, stderr: '' } })).toBe(REFUSALS.notIgnored);
    });

    it('in the app repository: the given or the real path tracked, or not ignored, refuses', () => {
      expect(run({ lsGiven: OK })).toBe(REFUSALS.tracked);
      expect(run({ lsReal: OK })).toBe(REFUSALS.tracked);
      expect(run({ lsGiven: NO_MATCH, lsReal: NO_MATCH, appIgnore: { status: 1, stderr: '' } })).toBe(REFUSALS.notIgnored);
      expect(run({ lsGiven: NO_MATCH, lsReal: NO_MATCH, appIgnore: OK, top: { status: 0, stdout: '/app\n', stderr: '' } })).toBeNull();
    });

    it('RV9-641-I11-4: a repository that folds case is asked case-folded', () => {
      const f = fake({ appConfig: { status: 0, stdout: 'true\n', stderr: '' }, ...IN_OTHER, otherConfig: { status: 0, stdout: 'true\n', stderr: '' } });
      expect(gitRefusal('/given', '/repo2/real.env', f.git)).toBeNull();
      const specs = f.calls.filter(([, args]) => args[0] === 'ls-files').map(([, args]) => args[3]);
      expect(specs).toEqual([':(literal,icase)/given', ':(literal,icase)/repo2/real.env', ':(literal,icase)/repo2/real.env']);
      const plain = fake({ appConfig: { status: 0, stdout: 'false\n', stderr: '' } });
      gitRefusal('/given', '/repo2/real.env', plain.git);
      expect(plain.calls[1]![1][3]).toBe(':(literal)/given');
    });

    it.each([
      ['git is not installed', { appConfig: { status: null, stderr: '' } }],
      ['the app is not a work tree', { appConfig: { status: 128, stderr: NOT_A_REPO.stderr } }],
      ['core.ignorecase answers something else', { appConfig: { status: 0, stdout: 'maybe\n', stderr: '' } }],
      ['exit 1 that is not "did not match"', { lsReal: { status: 1, stderr: 'error: something new\n' } }],
      ['"did not match" with another status', { lsReal: reword(NO_MATCH, (r) => ({ ...r, status: 128 })) }],
      ['"outside repository" with another status', { lsGiven: reword(OUTSIDE, (r) => ({ ...r, status: 1 })) }],
      ['"did not match" only on a later line', { lsReal: reword(NO_MATCH, (r) => ({ ...r, stderr: `warning: x\n${r.stderr}` })) }],
      ['"is outside repository" only on a later line', { lsGiven: reword(OUTSIDE, (r) => ({ ...r, stderr: `fatal: unsafe repository\n${r.stderr}` })) }],
      ['SEC-N2: "did not match" for another pathspec', { lsReal: { status: 1, stderr: "error: pathspec ':(literal)/elsewhere.env' did not match any file(s) known to git\n" } }],
      ['SEC-N2: "outside repository" for another path', { lsGiven: { status: 128, stderr: "fatal: :(literal)/elsewhere: '/elsewhere' is outside repository at '/repo'\n" } }],
      ['SEC-N2: "outside repository" naming no work tree', { lsGiven: (args: string[]) => ({ status: 128, stderr: `fatal: ${args.at(-1)}: '${pathOf(args.at(-1)!)}' is outside repository at ''\n` }) }],
      ['SEC-N2: the pathspec is in a submodule', { lsGiven: (args: string[]) => ({ status: 128, stderr: `fatal: Pathspec '${args.at(-1)}' is in submodule 'sub'\n` }) }],
      ['SEC-N2: the app check-ignore says another path is outside', { appIgnore: { status: 128, stderr: "fatal: /elsewhere: '/elsewhere' is outside repository at '/repo'\n" } }],
      ['SEC-N2: the other repository says another pathspec did not match', { ...IN_OTHER, otherLs: { status: 1, stderr: "error: pathspec ':(literal)/repo2/other.env' did not match any file(s) known to git\n" } }],
      ['"is outside repository" as free text in another fatal', { lsGiven: { status: 128, stderr: 'fatal: the path is outside repository somewhere\n' } }],
      ['app check-ignore fails some other way', { appIgnore: { status: 128, stderr: 'fatal: unsafe repository\n' } }],
      ['app check-ignore does not run', { appIgnore: { status: null, stderr: '' } }],
      ['rev-parse fails some other way (dubious ownership)', { top: { status: 128, stderr: 'fatal: detected dubious ownership in repository at /repo2\n' } }],
      ['"not a git repository" only on a later line', { top: { status: 128, stderr: 'fatal: something\nfatal: not a git repository (or any parent)\n' } }],
      ['rev-parse answers nothing', { top: { status: 0, stdout: '', stderr: '' } }],
      ['the other repository\'s ls-files says something else', { ...IN_OTHER, otherLs: { status: 128, stderr: 'fatal: index file corrupt\n' } }],
      ['the other repository says the file is outside it', { ...IN_OTHER, otherLs: OUTSIDE }],
      ['the other repository\'s check-ignore fails', { ...IN_OTHER, otherIgnore: { status: 128, stderr: 'fatal: x\n' } }],
      ['the other repository\'s config fails', { ...IN_OTHER, otherConfig: { status: 128, stderr: 'fatal: bad config\n' } }],
    ] as const)('%s: refused, never read', (_why, answers) => {
      expect(run(answers as Answers)).toBe(REFUSALS.git);
    });

    it('RV9-641-I11-3 / SEC-N2: a reply is git\'s whole first line, built from the exact pathspec and path passed', () => {
      const spec = ":(literal)/a b/it's.env";
      expect(GIT_REPLY.untracked(`error: pathspec '${spec}' did not match any file(s) known to git\nDid you forget to 'git add'?\n`, spec)).toBe(true);
      expect(GIT_REPLY.outside("fatal: :(literal)/dev/shm/x.env: '/dev/shm/x.env' is outside repository at '/repo'\n", ':(literal)/dev/shm/x.env', '/dev/shm/x.env')).toBe(true);
      expect(GIT_REPLY.outside("fatal: /dev/shm/x.env: '/dev/shm/x.env' is outside repository at '/repo'\n", '/dev/shm/x.env', '/dev/shm/x.env')).toBe(true);
      expect(GIT_REPLY.notARepository('fatal: not a git repository (or any of the parent directories): .git\n')).toBe(true);
      expect(GIT_REPLY.notARepository('fatal: not a git repository (or any parent up to mount point /dev)\nStopping at filesystem boundary (GIT_DISCOVERY_ACROSS_FILESYSTEM not set).\n')).toBe(true);
      // A path with a newline: git's first line ends inside it, so nothing matches.
      expect(GIT_REPLY.untracked("error: pathspec 'a\nb' did not match any file(s) known to git\n", 'a\nb')).toBe(false);
      expect(GIT_REPLY.outside('fatal: is outside repository\n', ':(literal)/x', '/x')).toBe(false);
      // The reviewer's crafted case: a directory name holding the fixed words cannot make the submodule error read as outside.
      const crafted = ":(literal)/app/sub/d: 'z' is outside repository at 'w/x.env";
      const submodule = `fatal: Pathspec '${crafted}' is in submodule 'sub'\n`;
      expect(GIT_REPLY.outside(submodule, crafted, pathOf(crafted))).toBe(false);
      expect(GIT_REPLY.outside(submodule, ':(literal)/app/sub/d', '/app/sub/d')).toBe(false);
    });
  });
});

describe('RV9-641-I11: files in other work trees, and the env files Expo loads', () => {
  const refused = (r: ReturnType<typeof runOn>, refusal: string) => {
    expect(r.stdout).toBe(`${refusal}\nFAIL\n`);
    expect(r.code).toBe(1);
  };

  it('(a) another repository: its tracked file and its loose file are refused; its ignored file is checked', () => {
    refused(runOn(join(REPO, 'tracked.env')), REFUSALS.tracked);
    refused(runOn(join(REPO, 'loose.env')), REFUSALS.notIgnored);
    const kept = runOn(join(REPO, 'kept.local'), '--platform', 'ios');
    expect(kept.code).toBe(0);
    expect(kept.stdout.trim().split('\n').pop()).toBe('PASS');
  });

  it('(b) a git worktree sibling: its checked-out tracked file and its loose file are refused', () => {
    refused(runOn(join(SIBLING, 'tracked.env')), REFUSALS.tracked);
    refused(runOn(join(SIBLING, 'loose.env')), REFUSALS.notIgnored);
  });

  it('a symlink from outside every repository to the other repository\'s tracked file is refused', () => {
    const link = join(DIR, `link-other-${(n += 1)}.env`);
    symlinkSync(join(REPO, 'tracked.env'), link);
    refused(runOn(link), REFUSALS.tracked);
  });

  // The env-file cases run against a fake app directory (SEC-F1): placeFile with its appRoot.
  it('RV9-641-I11-2: the four env files Expo loads into a production build are refused in the app directory', () => {
    for (const name of EXPO_FILES) expect(placeFile(join(FAKE_APP, name), undefined, FAKE_APP)).toEqual({ real: null, refusal: REFUSALS.expoLoaded });
    // And through a symlink from outside: the same file by device and inode.
    const link = join(DIR, `link-expo-${(n += 1)}.env`);
    symlinkSync(join(FAKE_APP, '.env.local'), link);
    expect(placeFile(link, undefined, FAKE_APP).refusal).toBe(REFUSALS.expoLoaded);
  });

  it('.env.development.local (only expo start loads it) is not an Expo-loaded file: it is placed, for path A', () => {
    const placed = placeFile(join(FAKE_APP, '.env.development.local'), undefined, FAKE_APP);
    expect(placed.refusal).toBeNull();
    expect(placed.real).toBe(join(FAKE_APP, '.env.development.local'));
  });

  it('the Expo list is the fixed four plus what @expo/env says for production, in the app directory', () => {
    const rel = (root: string) => expoLoadedEnvFiles(root).map((f: string) => f.slice(root.length + 1)).sort();
    expect(rel(APP_ROOT)).toEqual(['.env', '.env.local', '.env.production', '.env.production.local']);
    // Where @expo/env cannot be loaded (the fake directory has no node_modules), the fixed four stand.
    expect(rel(FAKE_APP)).toEqual(['.env', '.env.local', '.env.production', '.env.production.local']);
  });

  /*
    SEC-F1, widened for RV12-641-3. Every call that writes, links, renames,
    removes, opens, copies onto or changes the mode or times of a path, by
    name whether called bare or as a property (fs.rmSync,
    require('node:fs').rmSync, promises.writeFile), with every path argument
    it changes (both of a rename or a hard link). A path argument offends when
    its text, or the declaration of any name in it (followed through
    aliases), mentions the app directory.
  */
  const PATH_ARGS: Record<string, number[]> = {
    writeFileSync: [0], appendFileSync: [0], unlinkSync: [0], mkdirSync: [0], rmdirSync: [0], rmSync: [0], truncateSync: [0],
    openSync: [0], createWriteStream: [0], chmodSync: [0], chownSync: [0], utimesSync: [0], lchownSync: [0], lutimesSync: [0],
    symlinkSync: [1], linkSync: [0, 1], renameSync: [0, 1], copyFileSync: [1], cpSync: [1],
    writeFile: [0], appendFile: [0], unlink: [0], mkdir: [0], rmdir: [0], rm: [0], truncate: [0], open: [0], chmod: [0], chown: [0],
    utimes: [0], symlink: [1], link: [0, 1], rename: [0, 1], copyFile: [1], cp: [1],
  };
  const APP_NAMES = new Set(['APP_ROOT', 'SCRIPT', '__dirname', '__filename']);
  function appWrites(source: string): { calls: number; offenders: string[] } {
    const sf = ts.createSourceFile('t.ts', source, ts.ScriptTarget.Latest, true);
    // Every declared name and the expressions it is set from (every declaration of the name, any scope: the strict reading).
    const inits = new Map<string, ts.Expression[]>();
    const add = (name: string, init: ts.Expression) => inits.set(name, [...(inits.get(name) ?? []), init]);
    const collect = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) add(node.name.text, node.initializer);
      // `for (const f of [join(APP_ROOT, …)])`: the loop variable comes from the list.
      if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer)) {
        for (const d of node.initializer.declarations) if (ts.isIdentifier(d.name)) add(d.name.text, node.expression);
      }
      ts.forEachChild(node, collect);
    };
    collect(sf);
    /** Whether a path expression can reach the app directory: its names, followed through their declarations. */
    const reachesApp = (expr: ts.Node, seen: Set<string>): boolean => {
      if (ts.isIdentifier(expr)) {
        if (APP_NAMES.has(expr.text)) return true;
        if (seen.has(expr.text)) return false;
        seen.add(expr.text);
        return (inits.get(expr.text) ?? []).some((init) => reachesApp(init, seen));
      }
      if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr) || ts.isNumericLiteral(expr)) return false;
      // A call's callee is not a path (join, mkdtempSync …); its arguments may be. A property's name is not a name.
      if (ts.isCallExpression(expr)) return expr.arguments.some((a) => reachesApp(a, seen));
      if (ts.isPropertyAccessExpression(expr)) return reachesApp(expr.expression, seen);
      let found = false;
      ts.forEachChild(expr, (child) => {
        found ||= reachesApp(child, seen);
      });
      return found;
    };
    const offenders: string[] = [];
    let calls = 0;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
        if (name && name in PATH_ARGS) {
          calls += 1;
          for (const i of PATH_ARGS[name]!) {
            const arg = node.arguments[i];
            if (!arg || reachesApp(arg, new Set())) offenders.push(node.getText());
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return { calls, offenders: [...new Set(offenders)] };
  }

  it('SEC-F1 / RV12-641-3: the scan sees a write, rename, removal or alias that reaches the app directory', () => {
    const offends = (code: string) => appWrites(`const APP_ROOT = join(__dirname, '..');\nconst DIR = mkdtempSync('x');\n${code}`).offenders.length > 0;
    // The reviewer's survivors: a rename out of it, a removal through an alias, and a property callee.
    expect(offends("renameSync(join(APP_ROOT, '.env.local'), join(DIR, 'moved-out'));")).toBe(true);
    expect(offends("const ZZ_OWNER = join(APP_ROOT, '.env.development.local');\nunlinkSync(ZZ_OWNER);")).toBe(true);
    expect(offends("require('node:fs').rmSync(join(APP_ROOT, '.env.local'));")).toBe(true);
    // Aliases of aliases, loop variables, the promises API, streams, copies onto it, hard links of its files.
    expect(offends("const A = APP_ROOT;\nconst B = join(A, 'x');\nwriteFileSync(B, 'y');")).toBe(true);
    expect(offends("for (const f of [join(APP_ROOT, '.env')]) unlinkSync(f);")).toBe(true);
    expect(offends("const p = `${APP_ROOT}/.env`;\ntruncateSync(p);")).toBe(true);
    expect(offends("await fs.promises.writeFile(join(APP_ROOT, '.env'), 'y');")).toBe(true);
    expect(offends("createWriteStream(join(APP_ROOT, '.env'));")).toBe(true);
    expect(offends("copyFileSync(join(DIR, 'a'), join(APP_ROOT, '.env'));")).toBe(true);
    expect(offends("linkSync(join(APP_ROOT, 'app.json'), join(DIR, 'twin'));")).toBe(true);
    expect(offends("rmSync(join(__dirname, '..', '.env.local'));")).toBe(true);
    // What the tests do: write in their own directories, read the app's files, link to them from outside.
    expect(offends("writeFileSync(join(DIR, 'a.env'), 'x');")).toBe(false);
    expect(offends("symlinkSync(join(APP_ROOT, 'app.json'), join(DIR, 'link'));")).toBe(false);
    expect(offends("copyFileSync(join(APP_ROOT, 'scripts', 'x.mjs'), join(DIR, 'x.mjs'));")).toBe(false);
  });

  it('SEC-F1: nothing in this file writes, links, renames or removes a path in the real app directory', () => {
    const source = readFileSync(__filename, 'utf8');
    const { calls, offenders } = appWrites(source);
    expect(calls).toBeGreaterThan(10);
    expect(offenders).toEqual([]);
    // The old helper that wrote fixed names into the app directory is gone (named in two parts, so this line is not a match).
    expect(source.includes(['with', 'AppFile'].join(''))).toBe(false);
  });

  /*
    RV12-641-2. The CLI as the owner runs it refuses its own app's Expo env
    files: a copy of the script in the fake app directory (its app root comes
    from its own location, and it imports only node built-ins at load) is run
    on that directory's .env.local and on a link to it. And main hands
    placeFile the path alone, so the app root is always the script's own.
  */
  it('the script runs when reached through a symlink (it compares real paths before running main)', () => {
    const link = join(DIR, `link-script-${(n += 1)}.mjs`);
    symlinkSync(SCRIPT, link);
    const file = join(DIR, `case-${(n += 1)}.env`);
    writeFileSync(file, envText(GOOD));
    const r = spawnSync(process.execPath, [link, file, '--platform', 'ios'], { cwd: DIR, encoding: 'utf8', env: process.env });
    expect(r.stdout.trim().split('\n').pop()).toBe('PASS');
    expect(r.status).toBe(0);
    const tracked = spawnSync(process.execPath, [link, join(APP_ROOT, 'app.json')], { cwd: DIR, encoding: 'utf8', env: process.env });
    expect(tracked.stdout).toBe(`${REFUSALS.tracked}\nFAIL\n`);
    expect(tracked.status).toBe(1);
  });

  it('RV12-641-2: the script as run refuses its own app directory\'s Expo env files, and main passes placeFile the path alone', () => {
    mkdirSync(join(FAKE_APP, 'scripts'));
    const copy = join(FAKE_APP, 'scripts', 'check-staging-env.mjs');
    copyFileSync(SCRIPT, copy);
    const runCopy = (file: string) => spawnSync(process.execPath, [copy, file], { cwd: FAKE_APP, encoding: 'utf8', env: process.env });
    for (const target of [join(FAKE_APP, '.env.local'), join(FAKE_APP, '.env.production')]) {
      const r = runCopy(target);
      expect(r.stdout).toBe(`${REFUSALS.expoLoaded}\nFAIL\n`);
      expect(r.status).toBe(1);
    }
    const link = join(DIR, `link-copy-${(n += 1)}.env`);
    symlinkSync(join(FAKE_APP, '.env.local'), link);
    expect(runCopy(link).stdout).toBe(`${REFUSALS.expoLoaded}\nFAIL\n`);
    // main's one placeFile call takes exactly one argument.
    const sf = ts.createSourceFile('s.mjs', readFileSync(SCRIPT, 'utf8'), ts.ScriptTarget.Latest, true);
    const main = sf.statements.find((st): st is ts.FunctionDeclaration => ts.isFunctionDeclaration(st) && st.name?.text === 'main')!;
    const calls: ts.CallExpression[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'placeFile') calls.push(node);
      ts.forEachChild(node, visit);
    };
    visit(main);
    expect(calls.map((c) => c.arguments.length)).toEqual([1]);
  });

  it('the refusals give no .env*.local advice and point outside the repository', () => {
    expect(REFUSALS.notIgnored).toContain('keep it outside the repository (for example $TMP)');
    expect(REFUSALS.expoLoaded).toContain('give it another name and keep it outside the repository (for example $TMP/wsf-staging.env)');
    expect(REFUSALS.bindMount).toContain('outside the repository (for example $TMP)');
    for (const r of Object.values(REFUSALS)) expect(r).not.toContain('.env*.local');
  });
});

describe('RV11-641-SEC: other checkouts, mount points, bind mounts, and the git that runs', () => {
  const refused = (r: ReturnType<typeof runOn>, refusal: string) => {
    expect(r.stdout).toBe(`${refusal}\nFAIL\n`);
    expect(r.code).toBe(1);
  };
  /** git, for placeFile cases that must be refused before git is asked. */
  const noGit = () => {
    throw new Error('git was asked');
  };

  describe('SEC-F2: an Expo env file name is refused in any checkout, in any case', () => {
    // A sibling worktree of the fixture repository: .env.local is ignored there (*.local), .env is not.
    writeFileSync(join(SIBLING, '.env.local'), envText(GOOD));
    writeFileSync(join(SIBLING, '.env'), envText(GOOD));

    it('a sibling worktree\'s .env.local (ignored by git) and .env are refused, by the script as run', () => {
      refused(runOn(join(SIBLING, '.env.local'), '--platform', 'ios'), REFUSALS.expoLoaded);
      refused(runOn(join(SIBLING, '.env'), '--platform', 'ios'), REFUSALS.expoLoaded);
    });

    it('by name before git is asked, whatever the case, outside every repository too', () => {
      for (const name of ['.env', '.ENV.Local', '.env.PRODUCTION', '.Env.Production.Local']) {
        const file = join(DIR, name);
        writeFileSync(file, envText(GOOD));
        expect(placeFile(file, noGit, FAKE_APP)).toEqual({ real: null, refusal: REFUSALS.expoLoaded });
        unlinkSync(file);
      }
    });

    it('the name given or the name it resolves to: a link named .env, or a plain name linked to a .env.local', () => {
      const plain = join(DIR, `plain-${(n += 1)}.env`);
      writeFileSync(plain, envText(GOOD));
      const named = join(DIR, '.env');
      symlinkSync(plain, named);
      expect(placeFile(named, noGit, FAKE_APP).refusal).toBe(REFUSALS.expoLoaded);
      unlinkSync(named);
      const innocent = join(DIR, `innocent-${(n += 1)}.env`);
      symlinkSync(join(SIBLING, '.env.local'), innocent);
      expect(placeFile(innocent, noGit, FAKE_APP).refusal).toBe(REFUSALS.expoLoaded);
    });

    it('.env.development.local (only expo start loads it) and other names still pass to git', () => {
      const file = join(DIR, '.env.development.local');
      writeFileSync(file, envText(GOOD));
      const placed = placeFile(file, undefined, FAKE_APP);
      expect(placed).toEqual({ real: file, refusal: null });
      unlinkSync(file);
    });

    it('the names are the fixed four plus @expo/env\'s own list for production', () => {
      expect(expoLoadedEnvNames(APP_ROOT).sort()).toEqual(['.env', '.env.local', '.env.production', '.env.production.local']);
    });
  });

  describe('SEC-F3 and SEC-N1: the git that runs, and how', () => {
    it('gitEnv: no GIT_* but GIT_DISCOVERY_ACROSS_FILESYSTEM=1, the C locale, and only absolute PATH entries', () => {
      const env = gitEnv({ PATH: `.:/usr/bin::rel/bin:/bin`, GIT_DIR: '/x', GIT_INDEX_FILE: '/y', GIT_DISCOVERY_ACROSS_FILESYSTEM: '0', HOME: '/home/u', LC_ALL: 'de_DE.UTF-8' });
      expect(env).toEqual({ PATH: '/usr/bin:/bin', HOME: '/home/u', LC_ALL: 'C', LANGUAGE: '', GIT_DISCOVERY_ACROSS_FILESYSTEM: '1' });
    });

    it('every git command starts with no fsmonitor hook and no untracked cache', () => {
      expect(GIT_SAFETY_ARGS).toEqual(['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false']);
    });

    // A git that records how it was run (its directory, its arguments, its git and locale environment) and says "not a repository".
    const fakeGit = (log: string) =>
      [
        '#!/bin/sh',
        `{ printf 'cwd=%s\\n' "$PWD"; printf 'args=%s\\n' "$*"; env | grep -E '^(GIT_|LC_ALL=)' | sort; } >> '${log}'`,
        "echo 'fatal: not a git repository (or any of the parent directories): .git' >&2",
        'exit 128',
        '',
      ].join('\n');

    it('as run: the variable, the C locale and the safety flags reach git; no other GIT_* does', () => {
      const bin = join(DIR, 'git');
      const log = join(DIR, `git-log-${(n += 1)}.txt`);
      writeFileSync(bin, fakeGit(log), { mode: 0o755 });
      const file = join(DIR, `case-${(n += 1)}.env`);
      writeFileSync(file, envText(GOOD));
      const r = runWith({ PATH: `${DIR}:${process.env.PATH}`, GIT_DIR: '/elsewhere', GIT_INDEX_FILE: '/elsewhere/index' }, file);
      unlinkSync(bin);
      // The app repository answered "not a repository": refused, nothing read.
      refused(r, REFUSALS.git);
      const lines = readFileSync(log, 'utf8').trim().split('\n');
      expect(lines).toEqual([
        `cwd=${APP_ROOT}`,
        'args=-c core.fsmonitor=false -c core.untrackedCache=false config --bool core.ignorecase',
        'GIT_DISCOVERY_ACROSS_FILESYSTEM=1',
        'LC_ALL=C',
      ]);
    });

    it('a git next to the env file, reached through a relative PATH entry, never runs', () => {
      const bin = join(DIR, 'git');
      const log = join(DIR, `git-log-${(n += 1)}.txt`);
      writeFileSync(bin, fakeGit(log), { mode: 0o755 });
      const file = join(DIR, `case-${(n += 1)}.env`);
      writeFileSync(file, envText(GOOD));
      // '.' first: without the filter, the work-tree lookup (run in the file's directory) would start that git.
      const r = runWith({ PATH: `.:${process.env.PATH}` }, file, '--platform', 'ios');
      unlinkSync(bin);
      expect(r.stdout.trim().split('\n').pop()).toBe('PASS');
      expect(r.code).toBe(0);
      expect(() => readFileSync(log, 'utf8')).toThrow();
    });
  });

  describe('SEC-F4: a file reached through a bind mount is refused (Linux mount table)', () => {
    const mount = (root: string, point: string, fs = 'ext4', options = 'rw') => `29 1 8:1 ${root} ${point} rw,relatime shared:1 - ${fs} /dev/sda1 ${options}`;
    const table = (...lines: string[]) => `${lines.join('\n')}\n`;
    const BASE = [mount('/', '/'), mount('/', '/dev/shm', 'tmpfs', 'rw,size=1g')];

    it('the root mount and an ordinary tmpfs: nothing to refuse', () => {
      expect(bindMountRefusal('/home/u/x.env', table(...BASE))).toBeNull();
      expect(bindMountRefusal('/dev/shm/x.env', table(...BASE))).toBeNull();
    });

    it('a bind of a repository\'s subdirectory: refused; a neighbour of its mount point is not under it', () => {
      const t = table(...BASE, mount('/rv11/apps/westayfit', '/dev/shm/bindapp'));
      expect(bindMountRefusal('/dev/shm/bindapp/app.json', t)).toBe(REFUSALS.bindMount);
      expect(bindMountRefusal('/dev/shm/bindapp', t)).toBe(REFUSALS.bindMount);
      expect(bindMountRefusal('/dev/shm/bindappx/y.env', t)).toBeNull();
      expect(bindMountRefusal('/dev/shm/other.env', t)).toBeNull();
    });

    it('the latest mount on a mount point is the one that holds the file', () => {
      expect(bindMountRefusal('/mnt/x.env', table(...BASE, mount('/sub', '/mnt'), mount('/', '/mnt', 'tmpfs')))).toBeNull();
      expect(bindMountRefusal('/mnt/x.env', table(...BASE, mount('/', '/mnt', 'tmpfs'), mount('/sub', '/mnt')))).toBe(REFUSALS.bindMount);
    });

    it('a btrfs subvolume mounted whole is not a bind; a bind of a directory inside one is', () => {
      expect(bindMountRefusal('/home/u/x.env', table(mount('/@', '/', 'btrfs', 'rw,subvol=/@'), mount('/@home', '/home', 'btrfs', 'rw,ssd,subvol=/@home')))).toBeNull();
      expect(bindMountRefusal('/x.env', table(mount('/root', '/', 'btrfs', 'rw,subvol=root')))).toBeNull();
      expect(bindMountRefusal('/srv/app/app.json', table(mount('/@', '/', 'btrfs', 'rw,subvol=/@'), mount('/@home/u/repo/apps', '/srv/app', 'btrfs', 'rw,subvol=/@home')))).toBe(REFUSALS.bindMount);
    });

    it('mount points with escaped characters are read as the kernel writes them', () => {
      expect(bindMountRefusal('/mnt/with space/x.env', table(...BASE, mount('/sub', '/mnt/with\\040space')))).toBe(REFUSALS.bindMount);
    });

    it('no mount table (macOS, Windows): not checked; an unreadable or unparsable one: refused', () => {
      // How the table is read: none where the file does not exist, '' (refused) where it cannot be read.
      expect(readMountInfo(join(DIR, 'no-such-mountinfo'))).toBeNull();
      expect(readMountInfo(DIR)).toBe('');
      expect(bindMountRefusal('/x.env', null)).toBeNull();
      expect(bindMountRefusal('/x.env', '')).toBe(REFUSALS.mounts);
      expect(bindMountRefusal('/x.env', 'garbage\n')).toBe(REFUSALS.mounts);
      expect(bindMountRefusal('/x.env', table(mount('/', '/dev/shm', 'tmpfs')))).toBe(REFUSALS.mounts);
    });

    it('placeFile asks the mount table before the Expo names and git', () => {
      const file = join(DIR, `case-${(n += 1)}.env`);
      writeFileSync(file, envText(GOOD));
      const bound = table(mount('/', '/'), mount('/elsewhere/apps/westayfit', DIR, 'tmpfs'));
      expect(placeFile(file, noGit, FAKE_APP, () => bound)).toEqual({ real: null, refusal: REFUSALS.bindMount });
      expect(placeFile(file, noGit, FAKE_APP, () => '')).toEqual({ real: null, refusal: REFUSALS.mounts });
      // With an ordinary table it goes on to git, as before.
      expect(placeFile(file, undefined, FAKE_APP, () => table(mount('/', '/')))).toEqual({ real: file, refusal: null });
    });
  });
});

describe('check:staging-env arguments (RV7-641-5)', () => {
  it.each([
    [['a.env'], { file: 'a.env', platform: undefined }],
    [['a.env', '--platform', 'ios'], { file: 'a.env', platform: 'ios' }],
    [['--platform', 'android', 'a.env'], { file: 'a.env', platform: 'android' }],
    [['a.env', '--platform=ios'], { file: 'a.env', platform: 'ios' }],
  ])('%j is accepted', (argv, expected) => {
    expect(parseArgs(argv)).toEqual(expected);
  });

  it.each([
    [[]],
    [['a.env', 'b.env']],
    [['a.env', '--platform']],
    [['a.env', '--platform=']],
    [['a.env', '--platform', 'web']],
    [['a.env', '--platform', '--verbose']],
    [['a.env', '--platform=ios', '--platform', 'android']],
    [['a.env', '--verbose']],
    [['a.env', '-v']],
    [['--', 'a.env']],
  ])('%j is refused', (argv) => {
    expect(parseArgs(argv)).toEqual({ error: expect.stringMatching(/^usage: /) });
  });

  it('two files on the command line: usage, and neither is read', () => {
    const r = runOn(join(DIR, 'one.env'), join(DIR, 'two.env'));
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^usage: .*\nFAIL\n$/);
  });

  it('--platform=android runs only that platform', () => {
    const r = run(GOOD, '--platform=android');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('PASS  app.config.js (EAS android preview)');
    expect(r.stdout).not.toContain('(ios');
  });
});

describe('check:staging-env never prints a value (sentinel leak tests)', () => {
  // Built from letters and digits that the script's own words never contain in a row.
  const S = (tag: string) => `q${tag}x7zj9v${tag}w3k`;
  const sentinels: string[] = [];
  const sentinel = (tag: string) => {
    const s = S(tag);
    sentinels.push(s);
    return s;
  };
  const pieces = (s: string) => Array.from({ length: s.length - 3 }, (_, i) => s.slice(i, i + 4));
  const assertNoLeak = (out: string, values: string[]) => {
    for (const v of values) for (const p of pieces(v)) expect(out.includes(p), `leaked "${p}" of a value`).toBe(false);
  };

  it('six garbage values: the authDomain, bucket and sender refusals quote them; the output does not', () => {
    const env = Object.fromEntries(NAMES.map((name, i) => [name, sentinel(`a${i}`)]));
    const r = run(env);
    expect(r.code).toBe(1);
    expect(failures(r.stdout).length).toBeGreaterThanOrEqual(3);
    assertNoLeak(r.all, Object.values(env));
  });

  it('an app id and api key that quote themselves in their refusals', () => {
    const env = { ...GOOD, EXPO_PUBLIC_WSF_STAGING_APP_ID: sentinel('b1'), EXPO_PUBLIC_WSF_STAGING_API_KEY: sentinel('b2') };
    const r = run(env);
    expect(failures(r.stdout).map((l) => l.split(' [')[0])).toEqual([
      '- APP_ID must be a web app id, 1:<SENDER_ID>:web:<hex>',
      '- API_KEY must have the shape of a Firebase browser key',
    ]);
    assertNoLeak(r.all, [env.EXPO_PUBLIC_WSF_STAGING_APP_ID, env.EXPO_PUBLIC_WSF_STAGING_API_KEY]);
  });

  it('a selector and a sign-in flag that both refusals quote (stagingEnv and app.config.js)', () => {
    const env = { ...GOOD, EXPO_PUBLIC_WSF_ENV: sentinel('c1'), EXPO_PUBLIC_WSF_AUTH_ENABLED: sentinel('c2') };
    const r = run(env, '--platform', 'android');
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/EXPO_PUBLIC_WSF_ENV\s+from the file/);
    expect(failures(r.stdout).length).toBeGreaterThanOrEqual(2);
    assertNoLeak(r.all, [env.EXPO_PUBLIC_WSF_ENV, env.EXPO_PUBLIC_WSF_AUTH_ENABLED]);
  });

  it('a production project id, which its refusal quotes', () => {
    const id = `${sentinel('d1')}goarrive`;
    const r = run({ ...GOOD, EXPO_PUBLIC_WSF_STAGING_PROJECT_ID: id });
    expect(failures(r.stdout)[0]).toContain('PROJECT_ID must not name the production project');
    assertNoLeak(r.all, [id.replace('goarrive', '')]);
  });

  it('RV7-641-3a: redact on a message no rule knows gives the fixed label and no piece of it', () => {
    const value = sentinel('e1');
    const findings = redact(`Something new went wrong with "${value}" and ${value}.`, RESOLVER_RULES);
    expect(findings).toEqual([{ label: UNRECOGNISED, names: [] }]);
    assertNoLeak(JSON.stringify(findings), [value]);
    // Names in an unknown message are reported; still nothing else.
    const named = redact(`EXPO_PUBLIC_WSF_STAGING_APP_ID went wrong: "${value}"`, APP_CONFIG_RULES);
    expect(named).toEqual([{ label: UNRECOGNISED, names: ['EXPO_PUBLIC_WSF_STAGING_APP_ID'] }]);
    assertNoLeak(JSON.stringify(named), [value]);
  });

  it('RV7-641-3c: the internal-error handler prints neither the message nor a name the error chose', () => {
    const message = sentinel('f1');
    const name = sentinel('f2');
    const stub = join(DIR, `throwing-loader-${(n += 1)}.mjs`);
    // Loaded before the script: the first require of typescript (src/stagingEnv.ts's compiler) throws.
    writeFileSync(
      stub,
      [
        "import Module from 'node:module';",
        'const load = Module._load;',
        'Module._load = function (request, ...rest) {',
        "  if (request === 'typescript') {",
        `    const e = new Error(${JSON.stringify(`could not load ${message}`)});`,
        `    e.name = ${JSON.stringify(name)};`,
        '    throw e;',
        '  }',
        '  return load.call(this, request, ...rest);',
        '};',
        '',
      ].join('\n'),
    );
    const file = join(DIR, `case-${(n += 1)}.env`);
    const value = sentinel('f3');
    writeFileSync(file, envText({ ...GOOD, EXPO_PUBLIC_WSF_STAGING_API_KEY: value }));
    const r = runWith({ NODE_OPTIONS: `--import ${pathToFileURL(stub).href}` }, file);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('internal error (Error); nothing was printed from the file.\nFAIL\n');
    expect(r.stderr).toBe('');
    assertNoLeak(r.all, [message, name, value]);
  });

  it('internalErrorLine keeps a standard class name and nothing else', () => {
    expect(internalErrorLine(new TypeError('x'))).toBe('internal error (TypeError); nothing was printed from the file.');
    expect(internalErrorLine(Object.assign(new Error('x'), { name: 'AIzaSecretError' }))).toBe('internal error (Error); nothing was printed from the file.');
    expect(internalErrorLine('a thrown string')).toBe('internal error (Error); nothing was printed from the file.');
    expect(internalErrorLine(undefined)).toBe('internal error (Error); nothing was printed from the file.');
  });

  it('every sentinel was really used, and none collides with the script\'s own words', () => {
    expect(sentinels.length).toBeGreaterThanOrEqual(11);
    const words = run(GOOD).all;
    assertNoLeak(words, sentinels);
  });
});

/*
  RV7-641-3b and RV7-641-4. Every refusal the app can raise today, read
  straight from src/stagingEnv.ts and app.config.js with the TypeScript
  parser, must map to a specific rule, never the fallback; and a value that
  carries another refusal's words must not change which rule it maps to.
  Each `${...}` slot is filled with a stand-in value; the names the code
  interpolates (ENV_VAR_OF.x, the profile, the platform) are filled with
  the names themselves.
*/
describe('check:staging-env rules match every current refusal, and a value cannot steal a rule', () => {
  const ENV_VAR_OF: Record<string, string> = {
    apiKey: 'EXPO_PUBLIC_WSF_STAGING_API_KEY',
    authDomain: 'EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN',
    projectId: 'EXPO_PUBLIC_WSF_STAGING_PROJECT_ID',
    storageBucket: 'EXPO_PUBLIC_WSF_STAGING_STORAGE_BUCKET',
    messagingSenderId: 'EXPO_PUBLIC_WSF_STAGING_SENDER_ID',
    appId: 'EXPO_PUBLIC_WSF_STAGING_APP_ID',
  };
  type Own = (e: ts.Expression) => string[] | null;

  function render(node: ts.Expression, value: string, own: Own): string[] {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
    if (ts.isParenthesizedExpression(node)) return render(node.expression, value, own);
    if (ts.isTemplateExpression(node)) {
      let acc = [node.head.text];
      for (const span of node.templateSpans) {
        const parts = render(span.expression, value, own);
        acc = acc.flatMap((a) => parts.map((p) => a + p + span.literal.text));
      }
      return acc;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = render(node.left, value, own);
      const right = render(node.right, value, own);
      return left.flatMap((a) => right.map((b) => a + b));
    }
    if (ts.isConditionalExpression(node)) return [...render(node.whenTrue, value, own), ...render(node.whenFalse, value, own)];
    return own(node) ?? [value];
  }

  const source = (rel: string) => ts.createSourceFile(rel, readFileSync(join(APP_ROOT, rel), 'utf8'), ts.ScriptTarget.Latest, true);
  const STAGING = source('src/stagingEnv.ts');
  const APP_CONFIG = source('app.config.js');
  const HEADER = 'WSF STAGING CONFIGURATION REFUSED — this build will not fall back to production.';

  const stagingOwn: Own = (e) => {
    if (ts.isPropertyAccessExpression(e) && e.expression.getText() === 'ENV_VAR_OF') return [ENV_VAR_OF[e.name.text]];
    if (ts.isElementAccessExpression(e) && e.expression.getText() === 'ENV_VAR_OF') return Object.values(ENV_VAR_OF);
    // A list built from ENV_VAR_OF holds names only.
    if (e.getText().includes('ENV_VAR_OF[')) return [`${ENV_VAR_OF.apiKey}, ${ENV_VAR_OF.appId}`];
    return null;
  };
  const appConfigOwn: Own = (e) => {
    if (ts.isIdentifier(e) && e.text === 'profile') return ['preview'];
    if (ts.isIdentifier(e) && e.text === 'platform') return ['ios', 'android'];
    return null;
  };

  /** Each refusal site as its possible messages. */
  function stagingSites(value: string): string[][] {
    const sites: string[][] = [];
    const visit = (node: ts.Node) => {
      // RV9-641-I11-5: refuse() takes an array literal (read below) or `problems` (the pushes); any other shape fails here.
      if (ts.isCallExpression(node) && node.expression.getText() === 'refuse') {
        const arg = node.arguments[0];
        expect(node.arguments.length === 1 && !!arg && (ts.isArrayLiteralExpression(arg) || (ts.isIdentifier(arg) && arg.text === 'problems')), node.getText()).toBe(true);
      }
      if (ts.isCallExpression(node) && node.expression.getText() === 'refuse' && node.arguments[0] && ts.isArrayLiteralExpression(node.arguments[0])) {
        let messages = [HEADER];
        for (const el of node.arguments[0].elements) {
          const lines = render(el as ts.Expression, value, stagingOwn);
          messages = messages.flatMap((m) => lines.map((l) => `${m}\n  ${l}`));
        }
        sites.push(messages);
      } else if (ts.isCallExpression(node) && node.expression.getText() === 'problems.push') {
        sites.push(render(node.arguments[0], value, stagingOwn).map((l) => `${HEADER}\n  ${l}`));
      }
      ts.forEachChild(node, visit);
    };
    visit(STAGING);
    return sites;
  }
  function appConfigSites(value: string): string[][] {
    const sites: string[][] = [];
    const visit = (node: ts.Node) => {
      if (ts.isThrowStatement(node)) {
        const e = node.expression;
        // Every throw in app.config.js is `new Error(<message>)`, or this test has to learn the new shape.
        expect(ts.isNewExpression(e) && e.expression.getText() === 'Error' && e.arguments?.length === 1, node.getText()).toBe(true);
        sites.push(render((e as ts.NewExpression).arguments![0], value, appConfigOwn));
      }
      ts.forEachChild(node, visit);
    };
    visit(APP_CONFIG);
    return sites;
  }

  const NEUTRAL = 'qv7zNEUTRALw3k';
  const labels = (message: string, rules: typeof RESOLVER_RULES) => redact(message, rules).map((f: { label: string }) => f.label);
  const SETS = [
    { name: 'src/stagingEnv.ts', sites: stagingSites, rules: RESOLVER_RULES, atLeast: 12 },
    { name: 'app.config.js', sites: appConfigSites, rules: APP_CONFIG_RULES, atLeast: 6 },
  ];

  it('the refusals are really read (nothing slips past the parser)', () => {
    expect(stagingSites(NEUTRAL).length).toBeGreaterThanOrEqual(12);
    expect(appConfigSites(NEUTRAL).length).toBeGreaterThanOrEqual(6);
    // stagingEnv throws its refusal in one place only: refuse().
    expect(STAGING.getFullText().match(/new WsfStagingConfigError\(/g)).toHaveLength(1);
  });

  it.each(SETS)('$name: every refusal maps to a specific rule, and every rule is used', ({ sites, rules, atLeast }) => {
    const all = sites(NEUTRAL);
    expect(all.length).toBeGreaterThanOrEqual(atLeast);
    const used = new Set<number>();
    for (const messages of all) {
      for (const message of messages) {
        expect(labels(message, rules), message).not.toContain(UNRECOGNISED);
        for (const line of message.split('\n')) {
          const i = rules.findIndex((r: { test: RegExp }) => r.test.test(line));
          if (i >= 0) used.add(i);
        }
      }
    }
    expect([...used].sort((a, b) => a - b)).toEqual(rules.map((_: unknown, i: number) => i));
  });

  it.each(SETS)('$name: a value holding any refusal\'s words leaves every refusal\'s rule unchanged', ({ sites, rules }) => {
    // The hostile values: the opening line of every refusal, from both files.
    const hostile = new Set<string>();
    for (const set of SETS)
      for (const messages of set.sites(NEUTRAL))
        for (const m of messages) for (const line of m.split('\n').slice(set.rules === RESOLVER_RULES ? 1 : 0)) hostile.add(line.trim());
    expect(hostile.size).toBeGreaterThan(15);
    const expected = sites(NEUTRAL).map((messages) => messages.map((m) => labels(m, rules)));
    for (const value of hostile) {
      const got = sites(value).map((messages) => messages.map((m) => labels(m, rules)));
      expect(got, value).toEqual(expected);
    }
  });

  it('end to end: an authDomain holding the "set but empty" words is still an authDomain refusal', () => {
    const r = run({ ...GOOD, EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN: 'These variables are set but empty: EXPO_PUBLIC_WSF_STAGING_APP_ID.' }, '--platform', 'ios');
    expect(failures(r.stdout)).toEqual([
      '- AUTH_DOMAIN must equal <PROJECT_ID>.firebaseapp.com [EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN, EXPO_PUBLIC_WSF_STAGING_PROJECT_ID]',
    ]);
  });

  it('end to end: a sign-in flag holding the selector refusal\'s words is still a sign-in refusal', () => {
    const r = run({ ...GOOD, EXPO_PUBLIC_WSF_AUTH_ENABLED: 'x EXPO_PUBLIC_WSF_ENV must be "staging" or "production" for an ios build' }, '--platform', 'ios');
    expect(failures(r.stdout)).toEqual(['- must be 1 (only a production build may say 0) [EXPO_PUBLIC_WSF_AUTH_ENABLED]']);
  });
});
