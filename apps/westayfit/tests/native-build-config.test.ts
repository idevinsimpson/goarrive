import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

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
  'EXPO_PUBLIC_WSF_AUTH_ENABLED',
  ...STAGING_KEYS,
];
const COMPLETE_STAGING = Object.fromEntries(STAGING_KEYS.map((k) => [k, 'dummy-value']));
// INT-11: every build that embeds its JS must say whether sign-in is on.
const SIGN_IN_ON = { EXPO_PUBLIC_WSF_AUTH_ENABLED: '1' };

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
      run({ EAS_BUILD_PLATFORM: 'android', EAS_BUILD_PROFILE: 'preview', EXPO_PUBLIC_WSF_ENV: 'staging', ...COMPLETE_STAGING, ...SIGN_IN_ON })()
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
        ...SIGN_IN_ON,
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
        ...SIGN_IN_ON,
      })()
    ).toEqual({ name: 'We Stay Fit' });
    // Blank is unset.
    expect(
      run({
        EAS_BUILD_PLATFORM: 'ios',
        EAS_BUILD_PROFILE: 'preview',
        EXPO_PUBLIC_WSF_ENV: 'production',
        EXPO_PUBLIC_WSF_CRASH_HARNESS: '  ',
        ...SIGN_IN_ON,
      })()
    ).toEqual({ name: 'We Stay Fit' });
  });

  it('leaves an explicit production build unchanged', () => {
    expect(
      run({ EAS_BUILD_PLATFORM: 'ios', EAS_BUILD_PROFILE: 'preview', EXPO_PUBLIC_WSF_ENV: 'production', ...SIGN_IN_ON })()
    ).toEqual({
      name: 'We Stay Fit',
    });
  });

  describe('NATIVE-INTEGRATOR-1 (INT-11): a native build cannot ship with sign-in switched off by accident', () => {
    const stagingPreview = (platform: string, auth?: string) =>
      run({
        EAS_BUILD_PLATFORM: platform,
        EAS_BUILD_PROFILE: 'preview',
        EXPO_PUBLIC_WSF_ENV: 'staging',
        ...COMPLETE_STAGING,
        ...(auth === undefined ? {} : { EXPO_PUBLIC_WSF_AUTH_ENABLED: auth }),
      });

    it('case 1: an iOS or Android build with the flag unset fails at config time with a named error', () => {
      for (const platform of ['ios', 'android']) {
        expect(stagingPreview(platform)).toThrow(
          new RegExp(`EXPO_PUBLIC_WSF_AUTH_ENABLED is not set to 1 or 0 \\(got ""\\)\\. This ${platform} build would ship with sign-in switched off`)
        );
      }
      expect(
        run({ EAS_BUILD_PLATFORM: 'ios', EAS_BUILD_PROFILE: 'preview', EXPO_PUBLIC_WSF_ENV: 'production' })
      ).toThrow(/EXPO_PUBLIC_WSF_AUTH_ENABLED is not set to 1 or 0/);
      // A value src/featureFlags.ts would not read as on is not a decision either.
      expect(stagingPreview('android', 'yes')).toThrow(/is not set to 1 or 0 \(got "yes"\)/);
      expect(stagingPreview('android', '  ')).toThrow(/is not set to 1 or 0/);
    });

    it('case 1: a staging build with it set to 0 fails the same way', () => {
      expect(stagingPreview('ios', '0')).toThrow(
        /EXPO_PUBLIC_WSF_AUTH_ENABLED is off for a staging ios build, which would ship with sign-in switched off/
      );
      expect(stagingPreview('android', 'false')).toThrow(/is off for a staging android build/);
    });

    it('staging builds with it on (1 or true, any case or spacing) build', () => {
      expect(stagingPreview('ios', '1')()).toEqual({ name: 'We Stay Fit' });
      expect(stagingPreview('android', ' TRUE ')()).toEqual({ name: 'We Stay Fit' });
    });

    it('production may switch sign-in off, but only by saying 0 (the launch switch stays the owner\'s)', () => {
      const prod = (auth: string) =>
        run({ EAS_BUILD_PLATFORM: 'android', EAS_BUILD_PROFILE: 'preview', EXPO_PUBLIC_WSF_ENV: 'production', EXPO_PUBLIC_WSF_AUTH_ENABLED: auth });
      expect(prod('0')()).toEqual({ name: 'We Stay Fit' });
      expect(prod('1')()).toEqual({ name: 'We Stay Fit' });
    });

    it('a development client takes the flag from the local dev server, so its build does not need it', () => {
      expect(
        run({ EAS_BUILD_PLATFORM: 'ios', EAS_BUILD_PROFILE: 'development', EXPO_PUBLIC_WSF_ENV: 'staging' })()
      ).toEqual({ name: 'We Stay Fit' });
    });

    it('case 3 (staging half): every committed eas.json profile names both values, and each builds with its own env', () => {
      const eas = JSON.parse(readFileSync(join(__dirname, '..', 'eas.json'), 'utf8')) as {
        build: Record<string, { extends?: string; env?: Record<string, string> }>;
      };
      const envOf = (name: string): Record<string, string> => {
        const p = eas.build[name]!;
        return { ...(p.extends ? envOf(p.extends) : {}), ...(p.env ?? {}) };
      };
      for (const name of Object.keys(eas.build)) {
        const env = envOf(name);
        expect(env.EXPO_PUBLIC_WSF_ENV, name).toBe('staging');
        expect(env.EXPO_PUBLIC_WSF_AUTH_ENABLED, name).toBe('1');
        for (const platform of ['ios', 'android']) {
          expect(run({ EAS_BUILD_PLATFORM: platform, EAS_BUILD_PROFILE: name, ...env, ...COMPLETE_STAGING })()).toEqual({
            name: 'We Stay Fit',
          });
        }
      }
      // Production publishing is out of this sprint: no production profile is committed (owner decision).
      expect(Object.keys(eas.build)).not.toContain('production');
    });
  });
});
