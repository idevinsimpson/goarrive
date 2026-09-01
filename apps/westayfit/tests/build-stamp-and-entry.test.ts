import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { WSF_BUILD_STAMP } from '../src/buildStamp';

const APP_ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => readFileSync(path.join(APP_ROOT, rel), 'utf-8');

describe('build stamp honesty', () => {
  // /health reported "Built at 14:27:03Z" for a bundle deployed at 12:53Z --
  // the page was reading the browser's clock at render time and presenting it
  // as a build timestamp. It is always wrong, always plausible, and always
  // says the build is brand new. Absent data must read as absent.
  it('never fabricates a build time from the runtime clock', () => {
    expect(process.env.EXPO_PUBLIC_WSF_BUILT_AT).toBeUndefined();
    expect(WSF_BUILD_STAMP.builtAt).toBe('unknown');
  });

  it('does not call Date() as the builtAt fallback', () => {
    expect(read('src/buildStamp.ts')).not.toMatch(/builtAt[^\n]*new Date\(/);
  });

  it('build:web stamps both the commit and the build time', () => {
    const { scripts } = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(scripts['build:web']).toContain('EXPO_PUBLIC_BUILD_COMMIT=');
    expect(scripts['build:web']).toContain('EXPO_PUBLIC_WSF_BUILT_AT=');
    // Metro caches env values between exports; a build that reuses the cache
    // ships the previous run's commit SHA.
    expect(scripts['build:web']).toContain('--clear');
  });
});

describe('the home page is a usable front door', () => {
  // The flag-ON build shipped with working /signup and /signin that nothing
  // linked to, under copy that told visitors there was no signup. Every gate
  // passed: the routes worked, the rules worked, the deploy worked. The app
  // was simply unreachable unless you already knew the URL.
  const home = read('app/index.tsx');

  it('offers signup and signin when auth is enabled', () => {
    expect(home).toContain('wsfAuthEnabled');
    expect(home).toMatch(/href="\/signup"/);
    expect(home).toMatch(/href="\/signin"/);
  });

  it('only claims there is no signup while auth is disabled', () => {
    // The sentence is fine in the flag-OFF shell and false with the flag on,
    // so it must sit on the disabled branch rather than render unconditionally.
    //
    // Comments are stripped first: the prose explaining this rule also contains
    // the phrase, and matching it there passes or fails on where a comment sits.
    const code = home.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const claim = 'no signup';
    expect(code).toContain(claim);
    const branch = code.indexOf('wsfAuthEnabled ?');
    expect(branch).toBeGreaterThan(-1);
    expect(code.indexOf(claim)).toBeGreaterThan(branch);
  });
});
