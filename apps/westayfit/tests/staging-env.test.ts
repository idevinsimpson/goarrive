import { describe, expect, it } from 'vitest';

import {
  WSF_PRODUCTION_PROJECT_ID,
  WsfStagingConfigError,
  resolveStagingConfig,
  type StagingEnvInput,
} from '../src/stagingEnv';

/**
 * The resolver decides which backend a build talks to, so its REFUSALS matter
 * more than its happy path. The property under test is:
 *
 *   silence only for an unambiguous production build; everything ambiguous
 *   throws, and nothing ever falls back to production.
 *
 * The earlier version returned null for anything that was not exactly
 * 'staging'. That made a typo, or a complete staging config with the selector
 * forgotten, build successfully against LIVE PRODUCTION with no banner —
 * because the banner keys off the same resolution. These tests exist to keep
 * that shape from coming back.
 */

/** A complete, coherent staging config for a project that is not production. */
const STAGING: StagingEnvInput = {
  envName: 'staging',
  apiKey: 'AIzaSyBstaging0000000000000000000000000',
  authDomain: 'wsf-staging.firebaseapp.com',
  projectId: 'wsf-staging',
  storageBucket: 'wsf-staging.firebasestorage.app',
  messagingSenderId: '111111111111',
  appId: '1:111111111111:web:abcdef0123456789',
};

const PRODUCTION_ONLY: StagingEnvInput = {
  envName: undefined,
  apiKey: undefined,
  authDomain: undefined,
  projectId: undefined,
  storageBucket: undefined,
  messagingSenderId: undefined,
  appId: undefined,
};

function refusal(input: StagingEnvInput): WsfStagingConfigError {
  let caught: unknown;
  try {
    resolveStagingConfig(input);
  } catch (e) {
    caught = e;
  }
  expect(caught, 'expected a refusal, got none').toBeInstanceOf(WsfStagingConfigError);
  return caught as WsfStagingConfigError;
}

describe('a normal production build is unchanged and silent', () => {
  it('no selector and no staging values resolves to production', () => {
    expect(resolveStagingConfig(PRODUCTION_ONLY)).toBeNull();
  });

  it("the explicit 'production' selector also resolves to production", () => {
    expect(resolveStagingConfig({ ...PRODUCTION_ONLY, envName: 'production' })).toBeNull();
  });

  it('an emulator build with no staging values is not a staging concern', () => {
    // The emulator path is firebase.ts's, not this resolver's. With no staging
    // values it must stay out of the way entirely.
    expect(
      resolveStagingConfig({ ...PRODUCTION_ONLY, emulatorFlagRaw: '1' })
    ).toBeNull();
  });
});

describe('an unrecognised selector fails instead of meaning production', () => {
  for (const bad of ['Staging', 'STAGING', ' Staging', 'stagng', 'stagin', 'prod', 'dev', 'test', '1', 'true']) {
    it(`${JSON.stringify(bad)} is refused`, () => {
      const e = refusal({ ...PRODUCTION_ONLY, envName: bad });
      expect(e.message).toContain('not a recognised environment');
      expect(e.message).toContain('production, staging');
    });
  }

  it('the refusal explains the failure mode it prevents', () => {
    const e = refusal({ ...PRODUCTION_ONLY, envName: 'Staging' });
    expect(e.message).toContain('will not fall back to production');
    expect(e.message).toContain('pointed at live data');
  });

  it('surrounding whitespace on a valid name is tolerated, not refused', () => {
    // ' staging ' is a shell accident, not a different intent.
    expect(resolveStagingConfig({ ...STAGING, envName: ' staging ' })).not.toBeNull();
    expect(resolveStagingConfig({ ...PRODUCTION_ONLY, envName: ' production ' })).toBeNull();
  });
});

describe('staging values without the staging selector fail', () => {
  it('a COMPLETE staging config with no selector is refused, not built as production', () => {
    // This is the headline case: every value correct, one env var forgotten.
    const e = refusal({ ...STAGING, envName: undefined });
    expect(e.message).toContain('A complete staging Firebase config was supplied');
    expect(e.message).toContain('not set');
    expect(e.message).toContain('Set EXPO_PUBLIC_WSF_ENV=staging');
  });

  it("a complete staging config with envName 'production' is refused", () => {
    const e = refusal({ ...STAGING, envName: 'production' });
    expect(e.message).toContain('"production"');
  });

  it('even ONE stray staging value with no selector is refused, and is named', () => {
    const e = refusal({ ...PRODUCTION_ONLY, projectId: 'wsf-staging' });
    expect(e.message).toContain('EXPO_PUBLIC_WSF_STAGING_PROJECT_ID');
    expect(e.message).not.toContain('A complete staging Firebase config');
  });
});

describe('an explicit staging build must be complete', () => {
  it('names every missing variable, and only the missing ones', () => {
    // Both genuinely UNSET. A present-but-blank value is a different refusal
    // now (see the present-but-blank block) and is caught earlier.
    const e = refusal({ ...STAGING, apiKey: undefined, appId: undefined });
    expect(e.message).toContain('EXPO_PUBLIC_WSF_STAGING_API_KEY');
    expect(e.message).toContain('EXPO_PUBLIC_WSF_STAGING_APP_ID');
    expect(e.message).not.toContain('EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN');
  });

  it('tells the operator not to fill blanks from production', () => {
    const e = refusal({ ...STAGING, apiKey: undefined });
    expect(e.message).toContain('Do not fill blanks from production');
  });

  it('a whitespace-only value is refused as blank, naming the variable', () => {
    // It used to be folded into "missing". It is now its own, more accurate
    // refusal — the variable IS set, its value just never arrived.
    const e = refusal({ ...STAGING, projectId: '   ' });
    expect(e.message).toContain('EXPO_PUBLIC_WSF_STAGING_PROJECT_ID');
    expect(e.message).toContain('set but empty');
  });
});

describe('staging plus the emulator flag fails', () => {
  for (const raw of ['1', 'true', 'TRUE', ' true ']) {
    it(`emulator flag ${JSON.stringify(raw)} with staging is refused`, () => {
      const e = refusal({ ...STAGING, emulatorFlagRaw: raw });
      expect(e.message).toContain('never both');
    });
  }

  it('an off-looking emulator flag does not block a staging build', () => {
    expect(resolveStagingConfig({ ...STAGING, emulatorFlagRaw: '0' })).not.toBeNull();
  });
});

describe('the production project is prohibited as the staging destination', () => {
  it('rejects projectId goarrive outright', () => {
    const e = refusal({
      ...STAGING,
      projectId: WSF_PRODUCTION_PROJECT_ID,
      authDomain: `${WSF_PRODUCTION_PROJECT_ID}.firebaseapp.com`,
      storageBucket: `${WSF_PRODUCTION_PROJECT_ID}.firebasestorage.app`,
    });
    expect(e.message).toContain('the production project');
    expect(e.message).toContain('Hosting preview channel');
  });

  it('rejects it with surrounding whitespace too', () => {
    expect(
      refusal({ ...STAGING, projectId: `  ${WSF_PRODUCTION_PROJECT_ID}  ` }).message
    ).toContain('the production project');
  });
});

describe('the six values must describe ONE project, not just a non-production id', () => {
  // This is the check that projectId !== goarrive cannot make. A config naming
  // a staging project while carrying production's authDomain would sign people
  // in against the LIVE user pool, because Auth is routed by authDomain.

  it("refuses production's authDomain under a staging projectId", () => {
    const e = refusal({ ...STAGING, authDomain: 'goarrive.firebaseapp.com' });
    expect(e.message).toContain('Auth is routed by authDomain');
    expect(e.message).toContain('PRODUCTION value');
  });

  it('refuses an authDomain belonging to some third project', () => {
    const e = refusal({ ...STAGING, authDomain: 'someone-else.firebaseapp.com' });
    expect(e.message).toContain('must be');
    expect(e.message).toContain('wsf-staging.firebaseapp.com');
  });

  it("refuses production's storage bucket", () => {
    expect(refusal({ ...STAGING, storageBucket: 'goarrive.firebasestorage.app' }).message).toContain(
      'PRODUCTION value'
    );
  });

  it('accepts either supported storage-bucket domain for the right project', () => {
    expect(
      resolveStagingConfig({ ...STAGING, storageBucket: 'wsf-staging.appspot.com' })
    ).not.toBeNull();
  });

  it('refuses an appId whose embedded sender id disagrees with messagingSenderId', () => {
    const e = refusal({ ...STAGING, appId: '1:999999999999:web:abcdef0123456789' });
    expect(e.message).toContain('embeds its own sender id');
    expect(e.message).toContain('different projects');
  });

  it("refuses production's appId and sender id", () => {
    const e = refusal({
      ...STAGING,
      messagingSenderId: '413741232388',
      appId: '1:413741232388:web:30f3490b0a3b220dd42051',
    });
    expect(e.message).toContain('PRODUCTION value');
  });

  it("refuses production's API key even when everything else is staging", () => {
    const e = refusal({ ...STAGING, apiKey: 'AIzaSyBgLIP0uvGJ98fde3aZthZjILTg6unkkX0' });
    expect(e.message).toContain('PRODUCTION value');
  });

  it('refuses an API key that is not a Firebase browser key at all', () => {
    expect(refusal({ ...STAGING, apiKey: 'not-a-key' }).message).toContain(
      'not the shape of a Firebase browser API key'
    );
  });

  it('refuses a non-numeric messagingSenderId', () => {
    expect(refusal({ ...STAGING, messagingSenderId: 'abc' }).message).toContain('all digits');
  });
});

describe('present-but-blank is a failure, not a request for production', () => {
  // Found in adversarial review. clean() mapped undefined, '' and '   ' to the
  // same empty string, so a CI job that NAMES all seven variables but whose
  // secrets did not resolve produced a silent, unbannered PRODUCTION build —
  // the exact "an env file that did not load" case this revision exists for.

  it('all seven variables present but empty is refused, not built as production', () => {
    const e = refusal({
      envName: '',
      apiKey: '',
      authDomain: '',
      projectId: '',
      storageBucket: '',
      messagingSenderId: '',
      appId: '',
    });
    expect(e.message).toContain('set but empty');
    expect(e.message).toContain('EXPO_PUBLIC_WSF_ENV');
    expect(e.message).toContain('did not arrive');
  });

  it('whitespace-only values are refused the same way', () => {
    const e = refusal({ ...PRODUCTION_ONLY, envName: '   ', projectId: '\t' });
    expect(e.message).toContain('set but empty');
  });

  it('a single blank staging variable alongside a valid staging build is refused', () => {
    expect(refusal({ ...STAGING, storageBucket: '' }).message).toContain('set but empty');
  });

  it('genuinely UNSET variables still mean production, silently', () => {
    // The distinction that makes the rule usable: undefined is not blank.
    expect(resolveStagingConfig(PRODUCTION_ONLY)).toBeNull();
  });
});

describe('naming the production project is refused however it is spelled', () => {
  const variants = [
    ['GoArrive', 'ASCII case variant — DNS is case-insensitive, so it still reaches production'],
    ['GOARRIVE', 'all caps'],
    ['413741232388', "production's project NUMBER, which a per-field check never looks for"],
    ['goarrive-prod', 'a sibling project holding live data'],
    ['goarrive-staging', 'a sibling project this code has not approved'],
    ['my-goarrive-clone', 'contains the production id'],
  ];
  for (const [id, why] of variants) {
    it(`refuses projectId ${JSON.stringify(id)} — ${why}`, () => {
      const e = refusal({
        ...STAGING,
        projectId: id,
        authDomain: `${id}.firebaseapp.com`,
        storageBucket: `${id}.firebasestorage.app`,
      });
      expect(e.message).toContain('names the production project');
    });
  }

  it('still allows an unrelated staging project', () => {
    expect(resolveStagingConfig(STAGING)).not.toBeNull();
  });
});

describe('a malformed sender id fails as a config error, not a crash', () => {
  // The appId regex interpolated this value directly, so metacharacters threw
  // a SyntaxError — which is not a WsfStagingConfigError and would not be
  // reported to the operator as a configuration problem at all.
  for (const bad of ['(', '12*+', '1[', '.*', '12)']) {
    it(`sender id ${JSON.stringify(bad)} throws a config error`, () => {
      const e = refusal({ ...STAGING, messagingSenderId: bad });
      expect(e.message).toContain('all digits');
    });
  }
});

describe('the appId tail must be a plausible registration', () => {
  it('refuses a one-character hex tail', () => {
    expect(refusal({ ...STAGING, appId: '1:111111111111:web:a' }).message).toContain(
      'at least 8 hex chars'
    );
  });
});

describe('the valid staging case', () => {
  it('returns exactly the supplied config, trimmed', () => {
    expect(resolveStagingConfig({ ...STAGING, projectId: '  wsf-staging  ' })).toEqual({
      apiKey: STAGING.apiKey,
      authDomain: 'wsf-staging.firebaseapp.com',
      projectId: 'wsf-staging',
      storageBucket: 'wsf-staging.firebasestorage.app',
      messagingSenderId: '111111111111',
      appId: '1:111111111111:web:abcdef0123456789',
    });
  });

  it('never returns the production project id, and shares no field with production', () => {
    const resolved = resolveStagingConfig(STAGING);
    expect(resolved?.projectId).not.toBe(WSF_PRODUCTION_PROJECT_ID);
    expect(resolved?.authDomain).not.toContain(WSF_PRODUCTION_PROJECT_ID);
    expect(resolved?.storageBucket).not.toContain(WSF_PRODUCTION_PROJECT_ID);
    expect(resolved?.messagingSenderId).not.toBe('413741232388');
  });

  it('every refusal message says the build will not fall back to production', () => {
    const cases: StagingEnvInput[] = [
      { ...PRODUCTION_ONLY, envName: 'Staging' },
      { ...STAGING, envName: undefined },
      { ...STAGING, apiKey: undefined },
      { ...STAGING, emulatorFlagRaw: '1' },
      { ...STAGING, projectId: WSF_PRODUCTION_PROJECT_ID },
      { ...STAGING, authDomain: 'goarrive.firebaseapp.com' },
    ];
    for (const input of cases) {
      expect(refusal(input).message).toContain('will not fall back to production');
    }
  });
});
