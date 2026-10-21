import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

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
  const r = spawnSync(process.execPath, [SCRIPT, file, ...args], { cwd: APP_ROOT, encoding: 'utf8' });
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

  it('refuses to read a file git tracks', () => {
    const r = runOn(join(APP_ROOT, 'app.json'));
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('refused: that file is tracked by git');
    expect(r.stdout).not.toContain('PASS');
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

  it('every sentinel was really used, and none collides with the script\'s own words', () => {
    expect(sentinels.length).toBeGreaterThanOrEqual(11);
    const words = run(GOOD).all;
    assertNoLeak(words, sentinels);
  });
});
