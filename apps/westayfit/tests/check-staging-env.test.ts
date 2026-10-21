// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { linkSync, mkdtempSync, readdirSync, readFileSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';

import {
  APP_CONFIG_RULES,
  REFUSALS,
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
const DIR = mkdtempSync(join(tmpdir(), 'wsf-check-staging-env-'));
let n = 0;

// RV7-641-7: only what this file made. DIR holds plain files and links, never a directory.
afterAll(() => {
  for (const entry of readdirSync(DIR)) unlinkSync(join(DIR, entry));
  rmdirSync(DIR);
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

/** A file inside the app directory, removed again whatever happens. */
function withAppFile<T>(name: string, text: string, fn: (path: string) => T): T {
  const path = join(APP_ROOT, name);
  writeFileSync(path, text);
  try {
    return fn(path);
  } finally {
    unlinkSync(path);
  }
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
  const tag = `${process.pid}-${Date.now().toString(36)}`;

  it('refuses to read a file git tracks', () => {
    refusedWith(runOn(join(APP_ROOT, 'app.json')), REFUSALS.tracked);
  });

  it('RV7-641-2: an untracked file inside the repository that git does not ignore is refused before it is read', () => {
    withAppFile(`staging-${tag}.env`, envText(GOOD), (path) => {
      refusedWith(runOn(path), REFUSALS.notIgnored);
      // The same file, named relative to the app.
      refusedWith(runOn(`staging-${tag}.env`), REFUSALS.notIgnored);
    });
  });

  it('a .env*.local file inside the repository is ignored by git, so it is checked', () => {
    withAppFile(`.env.wsf-test-${tag}.local`, envText(GOOD), (path) => {
      const r = runOn(path, '--platform', 'ios');
      expect(r.code).toBe(0);
      expect(r.stdout.trim().split('\n').pop()).toBe('PASS');
    });
  });

  it('RV7-641-1: a symlink outside the repository to a tracked file is judged by its real path', () => {
    const link = join(DIR, `link-tracked-${(n += 1)}.env`);
    symlinkSync(join(APP_ROOT, 'app.json'), link);
    refusedWith(runOn(link), REFUSALS.tracked);
  });

  it('RV7-641-1: a symlink outside the repository to an unignored file inside it is refused', () => {
    withAppFile(`staging-${tag}-target.env`, envText(GOOD), (target) => {
      const link = join(DIR, `link-inside-${(n += 1)}.env`);
      symlinkSync(target, link);
      refusedWith(runOn(link), REFUSALS.notIgnored);
    });
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

  describe('gitRefusal: only three git answers let a file through', () => {
    type Reply = { status: number | null; stderr: string };
    const NO_MATCH: Reply = { status: 1, stderr: "error: pathspec '/x' did not match any file(s) known to git" };
    const OUTSIDE: Reply = { status: 128, stderr: "fatal: /x: '/x' is outside repository at '/repo'" };
    const fake = (answers: { lsGiven?: Reply; lsReal?: Reply; ignore?: Reply }) => {
      const calls: string[][] = [];
      const git = (args: string[]): Reply => {
        calls.push(args);
        if (args[0] === 'ls-files') return (args[3] === '/given' ? answers.lsGiven : answers.lsReal) ?? NO_MATCH;
        return answers.ignore ?? OUTSIDE;
      };
      return { git, calls };
    };

    it('outside the repository, or inside and ignored: allowed; check-ignore is asked about the real path', () => {
      const out = fake({ lsGiven: OUTSIDE, lsReal: OUTSIDE, ignore: OUTSIDE });
      expect(gitRefusal('/given', '/real', out.git)).toBeNull();
      expect(out.calls).toEqual([
        ['ls-files', '--error-unmatch', '--', '/given'],
        ['ls-files', '--error-unmatch', '--', '/real'],
        ['check-ignore', '-q', '--', '/real'],
      ]);
      expect(gitRefusal('/given', '/real', fake({ ignore: { status: 0, stderr: '' } }).git)).toBeNull();
    });

    it('the given path tracked (a tracked symlink), or the real path tracked: refused as tracked', () => {
      expect(gitRefusal('/given', '/real', fake({ lsGiven: { status: 0, stderr: '' }, ignore: { status: 0, stderr: '' } }).git)).toBe(REFUSALS.tracked);
      expect(gitRefusal('/given', '/real', fake({ lsReal: { status: 0, stderr: '' }, ignore: { status: 0, stderr: '' } }).git)).toBe(REFUSALS.tracked);
    });

    it('inside and not ignored: refused', () => {
      expect(gitRefusal('/given', '/real', fake({ ignore: { status: 1, stderr: '' } }).git)).toBe(REFUSALS.notIgnored);
    });

    it.each([
      ['git is not installed', { lsGiven: { status: null, stderr: '' } }],
      ['not a work tree', { lsGiven: { status: 128, stderr: 'fatal: not a git repository (or any of the parent directories): .git' } }],
      ['exit 1 that is not "did not match"', { lsReal: { status: 1, stderr: 'error: something new' } }],
      ['"did not match" with another status', { lsReal: { status: 128, stderr: NO_MATCH.stderr } }],
      ['"outside repository" with another status', { lsGiven: { status: 1, stderr: OUTSIDE.stderr } }],
      ['check-ignore fails some other way', { ignore: { status: 128, stderr: 'fatal: unsafe repository' } }],
      ['check-ignore does not run', { ignore: { status: null, stderr: '' } }],
    ] as const)('%s: refused, never read', (_why, answers) => {
      expect(gitRefusal('/given', '/real', fake(answers).git)).toBe(REFUSALS.git);
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
