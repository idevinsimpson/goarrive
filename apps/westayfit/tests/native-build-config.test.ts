import { createRequire } from 'node:module';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

// app.config.js is CommonJS, loaded by Expo with Node's require. Load it the same way.
const appConfig: (ctx: { config: Record<string, unknown> }) => Record<string, unknown> = createRequire(
  import.meta.url
)('../app.config.js');

const STAGING_KEYS = [
  'EXPO_PUBLIC_WSF_STAGING_API_KEY',
  'EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN',
  'EXPO_PUBLIC_WSF_STAGING_PROJECT_ID',
  'EXPO_PUBLIC_WSF_STAGING_STORAGE_BUCKET',
  'EXPO_PUBLIC_WSF_STAGING_SENDER_ID',
  'EXPO_PUBLIC_WSF_STAGING_APP_ID',
];
const ENV_KEYS = [
  'EAS_BUILD_PLATFORM',
  'EAS_BUILD_PROFILE',
  'EXPO_PUBLIC_WSF_ENV',
  'EXPO_PUBLIC_WSF_USE_EMULATORS',
  'EXPO_PUBLIC_WSF_CRASH_HARNESS',
  ...STAGING_KEYS,
];
const COMPLETE_STAGING = Object.fromEntries(STAGING_KEYS.map((k) => [k, 'dummy-value']));

const saved: Record<string, string | undefined> = {};

function run(env: Record<string, string>) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  const config = { name: 'We Stay Fit' };
  return () => appConfig({ config });
}

describe('NATIVE-BUILD-1: app.config.js build-time backend refusals', () => {
  beforeAll(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('runs no checks outside an EAS iOS/Android build (web export, local tooling)', () => {
    expect(run({})()).toEqual({ name: 'We Stay Fit' });
    expect(run({ EAS_BUILD_PROFILE: 'preview' })()).toEqual({ name: 'We Stay Fit' });
  });

  it('refuses a native build that names no backend', () => {
    expect(run({ EAS_BUILD_PLATFORM: 'ios' })).toThrow(/EXPO_PUBLIC_WSF_ENV must be "staging" or "production" for an ios build \(got ""\)/);
    expect(run({ EAS_BUILD_PLATFORM: 'android', EAS_BUILD_PROFILE: 'development' })).toThrow(/must be "staging" or "production"/);
  });

  it('refuses a preview build that carries only the emulator flag', () => {
    expect(
      run({ EAS_BUILD_PLATFORM: 'android', EAS_BUILD_PROFILE: 'preview', EXPO_PUBLIC_WSF_USE_EMULATORS: '1' })
    ).toThrow(/profile "preview" embeds its JavaScript, so EXPO_PUBLIC_WSF_USE_EMULATORS cannot name its backend/);
    expect(
      run({ EAS_BUILD_PLATFORM: 'ios', EAS_BUILD_PROFILE: 'preview', EXPO_PUBLIC_WSF_USE_EMULATORS: ' TRUE ' })
    ).toThrow(/embeds its JavaScript/);
  });

  it('allows a development client that carries only the emulator flag', () => {
    expect(
      run({ EAS_BUILD_PLATFORM: 'android', EAS_BUILD_PROFILE: 'development', EXPO_PUBLIC_WSF_USE_EMULATORS: '1' })()
    ).toEqual({ name: 'We Stay Fit' });
    // A value firebase.ts would not treat as on does not count as naming a backend.
    expect(
      run({ EAS_BUILD_PLATFORM: 'android', EAS_BUILD_PROFILE: 'development', EXPO_PUBLIC_WSF_USE_EMULATORS: 'yes' })
    ).toThrow(/must be "staging" or "production"/);
  });

  it('treats development-simulator as a development client', () => {
    expect(
      run({ EAS_BUILD_PLATFORM: 'ios', EAS_BUILD_PROFILE: 'development-simulator', EXPO_PUBLIC_WSF_USE_EMULATORS: '1' })()
    ).toEqual({ name: 'We Stay Fit' });
    // No staging values needed: its JS comes from the local dev server.
    expect(
      run({ EAS_BUILD_PLATFORM: 'ios', EAS_BUILD_PROFILE: 'development-simulator', EXPO_PUBLIC_WSF_ENV: 'staging' })()
    ).toEqual({ name: 'We Stay Fit' });
    expect(
      run({ EAS_BUILD_PLATFORM: 'android', EAS_BUILD_PROFILE: 'development', EXPO_PUBLIC_WSF_ENV: 'staging' })()
    ).toEqual({ name: 'We Stay Fit' });
  });

  it('refuses an embedded-JS staging build missing staging values, and accepts a complete one', () => {
    expect(
      run({ EAS_BUILD_PLATFORM: 'android', EAS_BUILD_PROFILE: 'preview', EXPO_PUBLIC_WSF_ENV: 'staging' })
    ).toThrow(/profile "preview" embeds its JavaScript with EXPO_PUBLIC_WSF_ENV=staging, but these staging values are missing/);
    expect(
      run({ EAS_BUILD_PLATFORM: 'android', EAS_BUILD_PROFILE: 'preview', EXPO_PUBLIC_WSF_ENV: 'staging', ...COMPLETE_STAGING })()
    ).toEqual({ name: 'We Stay Fit' });
  });

  it('treats an unlisted development-* profile as embedding its JS', () => {
    expect(
      run({ EAS_BUILD_PLATFORM: 'android', EAS_BUILD_PROFILE: 'development-store', EXPO_PUBLIC_WSF_ENV: 'staging' })
    ).toThrow(/profile "development-store" embeds its JavaScript with EXPO_PUBLIC_WSF_ENV=staging/);
    expect(
      run({ EAS_BUILD_PLATFORM: 'android', EAS_BUILD_PROFILE: 'development-store', EXPO_PUBLIC_WSF_USE_EMULATORS: '1' })
    ).toThrow(/profile "development-store" embeds its JavaScript/);
    expect(
      run({
        EAS_BUILD_PLATFORM: 'android',
        EAS_BUILD_PROFILE: 'development-store',
        EXPO_PUBLIC_WSF_ENV: 'staging',
        ...COMPLETE_STAGING,
      })()
    ).toEqual({ name: 'We Stay Fit' });
  });

  it('NATIVE-INTEGRATOR-1 (INT-01): refuses a production build carrying the injected-throw harness', () => {
    expect(
      run({
        EAS_BUILD_PLATFORM: 'ios',
        EAS_BUILD_PROFILE: 'preview',
        EXPO_PUBLIC_WSF_ENV: 'production',
        EXPO_PUBLIC_WSF_CRASH_HARNESS: 'progress',
      })
    ).toThrow(/EXPO_PUBLIC_WSF_CRASH_HARNESS is set for a production ios build/);
    // A staging test build may carry it: that is what it is for.
    expect(
      run({
        EAS_BUILD_PLATFORM: 'android',
        EAS_BUILD_PROFILE: 'preview',
        EXPO_PUBLIC_WSF_ENV: 'staging',
        EXPO_PUBLIC_WSF_CRASH_HARNESS: 'progress,timer',
        ...COMPLETE_STAGING,
      })()
    ).toEqual({ name: 'We Stay Fit' });
    // Blank is unset.
    expect(
      run({
        EAS_BUILD_PLATFORM: 'ios',
        EAS_BUILD_PROFILE: 'preview',
        EXPO_PUBLIC_WSF_ENV: 'production',
        EXPO_PUBLIC_WSF_CRASH_HARNESS: '  ',
      })()
    ).toEqual({ name: 'We Stay Fit' });
  });

  it('leaves an explicit production build unchanged', () => {
    expect(run({ EAS_BUILD_PLATFORM: 'ios', EAS_BUILD_PROFILE: 'preview', EXPO_PUBLIC_WSF_ENV: 'production' })()).toEqual({
      name: 'We Stay Fit',
    });
  });
});
