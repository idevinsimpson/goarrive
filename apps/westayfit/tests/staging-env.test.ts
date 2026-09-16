import { describe, expect, it } from 'vitest';

import {
  WSF_PRODUCTION_PROJECT_ID,
  WsfStagingConfigError,
  isStagingDeclared,
  resolveStagingConfig,
  type StagingEnvInput,
} from '../src/stagingEnv';

/**
 * The staging resolver decides which backend a build talks to, so its failure
 * mode matters more than its happy path. Two properties are load-bearing:
 *
 *   1. It defaults CLOSED. Anything that is not exactly 'staging' is
 *      production, and production is never affected by the staging vars.
 *   2. It REFUSES rather than falls back. A build that says staging and is
 *      not staging must not boot, because the alternative is a second front
 *      door to live data wearing a STAGING banner.
 */

const COMPLETE: StagingEnvInput = {
  envName: 'staging',
  apiKey: 'test-api-key',
  authDomain: 'wsf-staging.firebaseapp.com',
  projectId: 'wsf-staging',
  storageBucket: 'wsf-staging.firebasestorage.app',
  messagingSenderId: '111111111111',
  appId: '1:111111111111:web:abcdef',
};

describe('isStagingDeclared — opting in requires getting it exactly right', () => {
  for (const raw of [undefined, '', 'production', 'prod', 'Staging', 'STAGING', ' staging', 'staging ', '1', 'true']) {
    it(`${JSON.stringify(raw)} is NOT staging`, () => {
      expect(isStagingDeclared(raw)).toBe(false);
    });
  }
  it("'staging' is staging", () => {
    expect(isStagingDeclared('staging')).toBe(true);
  });
});

describe('resolveStagingConfig — production is untouched', () => {
  it('returns null when staging is not declared, even with a full staging config present', () => {
    // The vars being set must not be enough on their own. Declaring the
    // environment is the deliberate act.
    expect(resolveStagingConfig({ ...COMPLETE, envName: undefined })).toBeNull();
    expect(resolveStagingConfig({ ...COMPLETE, envName: 'production' })).toBeNull();
  });

  it('does not throw for a production build, whatever the staging vars contain', () => {
    expect(() =>
      resolveStagingConfig({
        envName: undefined,
        apiKey: undefined,
        authDomain: undefined,
        projectId: WSF_PRODUCTION_PROJECT_ID,
        storageBucket: undefined,
        messagingSenderId: undefined,
        appId: undefined,
      })
    ).not.toThrow();
  });
});

describe('resolveStagingConfig — refuses rather than falls back', () => {
  it('throws, naming every missing variable, when the config is incomplete', () => {
    let caught: unknown;
    try {
      resolveStagingConfig({ ...COMPLETE, apiKey: undefined, appId: '   ' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WsfStagingConfigError);
    const message = (caught as Error).message;
    expect(message).toContain('EXPO_PUBLIC_WSF_STAGING_API_KEY');
    expect(message).toContain('EXPO_PUBLIC_WSF_STAGING_APP_ID');
    // It must not name the ones that WERE supplied.
    expect(message).not.toContain('EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN');
    // And it must say what it will not do.
    expect(message).toContain('will not fall back to production');
  });

  it('throws when the declared staging project IS production', () => {
    // This is the whole point. A Hosting preview channel of the production
    // project is not a staging backend, and a build must not be able to claim
    // it is one.
    expect(() =>
      resolveStagingConfig({ ...COMPLETE, projectId: WSF_PRODUCTION_PROJECT_ID })
    ).toThrow(WsfStagingConfigError);
    expect(() =>
      resolveStagingConfig({ ...COMPLETE, projectId: ` ${WSF_PRODUCTION_PROJECT_ID} ` })
    ).toThrow(WsfStagingConfigError);
  });

  it('a whitespace-only value counts as missing, not as a value', () => {
    expect(() => resolveStagingConfig({ ...COMPLETE, projectId: '   ' })).toThrow(
      WsfStagingConfigError
    );
  });
});

describe('resolveStagingConfig — the happy path', () => {
  it('returns the trimmed staging config for a separate project', () => {
    expect(resolveStagingConfig({ ...COMPLETE, projectId: '  wsf-staging  ' })).toEqual({
      apiKey: 'test-api-key',
      authDomain: 'wsf-staging.firebaseapp.com',
      projectId: 'wsf-staging',
      storageBucket: 'wsf-staging.firebasestorage.app',
      messagingSenderId: '111111111111',
      appId: '1:111111111111:web:abcdef',
    });
  });

  it('never returns the production project id', () => {
    const resolved = resolveStagingConfig(COMPLETE);
    expect(resolved?.projectId).not.toBe(WSF_PRODUCTION_PROJECT_ID);
  });
});
