/**
 * Staging environment resolution for the We Stay Fit web app.
 *
 * WHY THIS EXISTS. Before this file the app could reach exactly two backends:
 * the production project `goarrive`, or the local emulator namespace, and the
 * emulator one only on a loopback host. There was no way to build an artifact
 * that talks to a staging backend. A Firebase Hosting preview channel does not
 * create one: it changes the hostname the bundle is served from and nothing
 * about the Auth pool, Firestore, Functions or Storage it calls.
 *
 * WHAT CHANGED IN THIS REVISION, and why it matters more than it looks.
 * The first version treated anything that was not exactly `staging` as
 * production and returned null. That is a SILENT FALLBACK: a typo in the
 * selector (`Staging`, `stagng`, `stagin`), or a complete set of staging
 * values supplied with the selector forgotten entirely, produced a perfectly
 * successful build pointed at LIVE PRODUCTION — with no banner, because the
 * banner keys off the same resolution. The failure mode was a green build that
 * was wrong, which is the worst kind.
 *
 * The rule now is: SILENCE ONLY FOR AN UNAMBIGUOUS PRODUCTION BUILD. A build
 * with no selector and no staging values is production and says nothing. Every
 * other shape — a selector that is not recognised, staging values without the
 * selector, a selector without complete values — throws. A build that cannot
 * be shown to be what it claims does not build.
 *
 * WHAT IT STILL DOES NOT DO. It does not create a staging backend and cannot.
 * It only lets a build be pointed at one that already exists.
 */

/** The production project. A staging build may never resolve to this. */
export const WSF_PRODUCTION_PROJECT_ID = 'goarrive' as const;

/**
 * Production's project NUMBER. It appears below as messagingSenderId and
 * inside appId, but it is ALSO a valid way to name the production project in
 * a projectId field — and a per-field comparison never notices that, because
 * the field it is in is different. Named separately so the projectId check can
 * ask about it directly.
 */
const WSF_PRODUCTION_PROJECT_NUMBER = '413741232388' as const;

/**
 * Is this projectId production, under any spelling that would still route to
 * production? Firebase project ids are lowercase, but DNS is case-insensitive,
 * so `GoArrive.firebaseapp.com` reaches production's auth handler while
 * `'GoArrive' !== 'goarrive'` passes a naive check. Sibling projects are
 * refused too: `goarrive-prod`, `goarrive-eu` and the like are not this
 * project's staging environment, and if one of them ever IS the intended
 * target that should be a deliberate change here, not a silent pass.
 */
export function namesProductionProject(rawProjectId: string): boolean {
  const id = rawProjectId.trim().toLowerCase();
  if (id === WSF_PRODUCTION_PROJECT_NUMBER) return true;
  return id.includes(WSF_PRODUCTION_PROJECT_ID);
}

/**
 * Production's own client identifiers, duplicated here ON PURPOSE so the
 * resolver can refuse a "staging" config that has quietly borrowed one of
 * them. These are publishable Firebase web values, not secrets (see the note
 * in firebase.ts); the point of repeating them is to be able to say no.
 */
const PRODUCTION_VALUES: Readonly<Record<string, string>> = {
  apiKey: 'AIzaSyBgLIP0uvGJ98fde3aZthZjILTg6unkkX0',
  authDomain: 'goarrive.firebaseapp.com',
  projectId: 'goarrive',
  storageBucket: 'goarrive.firebasestorage.app',
  messagingSenderId: '413741232388',
  appId: '1:413741232388:web:30f3490b0a3b220dd42051',
};

/** The environment selectors this app understands. Anything else is an error. */
export const WSF_ENV_NAMES = ['production', 'staging'] as const;
export type WsfEnvName = (typeof WSF_ENV_NAMES)[number];

export type WsfFirebaseConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

/** The raw environment this resolution reads. Passed explicitly so it is testable. */
export type StagingEnvInput = {
  envName: string | undefined;
  apiKey: string | undefined;
  authDomain: string | undefined;
  projectId: string | undefined;
  storageBucket: string | undefined;
  messagingSenderId: string | undefined;
  appId: string | undefined;
  /** The emulator selector, so staging-plus-emulator is caught here and tested. */
  emulatorFlagRaw?: string | undefined;
};

export class WsfStagingConfigError extends Error {}

const CONFIG_KEYS = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
] as const;

type ConfigKey = (typeof CONFIG_KEYS)[number];

const ENV_VAR_OF: Readonly<Record<ConfigKey, string>> = {
  apiKey: 'EXPO_PUBLIC_WSF_STAGING_API_KEY',
  authDomain: 'EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN',
  projectId: 'EXPO_PUBLIC_WSF_STAGING_PROJECT_ID',
  storageBucket: 'EXPO_PUBLIC_WSF_STAGING_STORAGE_BUCKET',
  messagingSenderId: 'EXPO_PUBLIC_WSF_STAGING_SENDER_ID',
  appId: 'EXPO_PUBLIC_WSF_STAGING_APP_ID',
};

function clean(v: string | undefined): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** True when the flag means on. Mirrors firebase.ts's emulator flag parsing. */
function flagOn(raw: string | undefined): boolean {
  return raw === '1' || raw?.trim().toLowerCase() === 'true';
}

/** Which staging values carry an actual value, regardless of the selector. */
function suppliedKeys(input: StagingEnvInput): ConfigKey[] {
  return CONFIG_KEYS.filter((k) => clean(input[k]) !== '');
}

/**
 * Which variables are PRESENT in the environment but blank.
 *
 * This distinction is the difference between "nobody asked for staging" and
 * "somebody asked for staging and the values did not arrive". `undefined` is
 * the first; `''` or whitespace is the second — a CI job that names the
 * variables but whose secrets did not resolve, or an env file that failed to
 * load. Treating those the same produced a silent, unbannered PRODUCTION
 * build from exactly the scenario this file exists to prevent.
 */
function presentButBlank(input: StagingEnvInput): string[] {
  const names: string[] = [];
  if (input.envName !== undefined && clean(input.envName) === '') {
    names.push('EXPO_PUBLIC_WSF_ENV');
  }
  for (const k of CONFIG_KEYS) {
    if (input[k] !== undefined && clean(input[k]) === '') names.push(ENV_VAR_OF[k]);
  }
  return names;
}

/**
 * Structural coherence: do these six values describe ONE Firebase project,
 * and is that project the one the selector names?
 *
 * This exists because `projectId !== 'goarrive'` establishes almost nothing.
 * A config naming project `wsf-staging` while carrying production's authDomain
 * and appId would pass that check and then authenticate against the live user
 * pool — the projectId in a web config is not what routes Auth. Firebase's own
 * config shape gives us the invariants to check instead:
 *
 *   authDomain      is <projectId>.firebaseapp.com
 *   storageBucket   is <projectId>.firebasestorage.app or <projectId>.appspot.com
 *   appId           is 1:<messagingSenderId>:web:<hex>, so it embeds the sender
 *   apiKey          is a Firebase browser key (AIza + 35 chars)
 *
 * Those hold for every Firebase web app, so they can be enforced without
 * knowing the particular staging project's values — which this code must never
 * guess. The registered Web App's real SDK config is supplied at build time;
 * this is what refuses it if it does not hang together.
 */
function coherenceProblems(cfg: WsfFirebaseConfig): string[] {
  const problems: string[] = [];
  const { projectId } = cfg;

  if (cfg.authDomain !== `${projectId}.firebaseapp.com`) {
    problems.push(
      `${ENV_VAR_OF.authDomain} is "${cfg.authDomain}" but project "${projectId}" means it must be ` +
        `"${projectId}.firebaseapp.com". Auth is routed by authDomain, not by projectId, so a ` +
        `mismatch here signs people in against a different project than the one named.`
    );
  }

  const buckets = [`${projectId}.firebasestorage.app`, `${projectId}.appspot.com`];
  if (!buckets.includes(cfg.storageBucket)) {
    problems.push(
      `${ENV_VAR_OF.storageBucket} is "${cfg.storageBucket}" but project "${projectId}" means it ` +
        `must be one of ${buckets.map((b) => `"${b}"`).join(' or ')}.`
    );
  }

  if (!/^\d+$/.test(cfg.messagingSenderId)) {
    // RETURN, do not fall through. The appId check below used to interpolate
    // this value straight into a RegExp, so a sender id containing regex
    // metacharacters threw a SyntaxError instead of this refusal — an error
    // that is not a WsfStagingConfigError and would not be reported as a
    // configuration problem.
    problems.push(`${ENV_VAR_OF.messagingSenderId} must be all digits; got "${cfg.messagingSenderId}".`);
    return problems;
  }

  // Safe to interpolate now: the value is known to be digits only.
  const appIdShape = new RegExp(`^1:${cfg.messagingSenderId}:web:[0-9a-f]{8,}$`);
  if (!appIdShape.test(cfg.appId)) {
    problems.push(
      `${ENV_VAR_OF.appId} is "${cfg.appId}", which does not have the shape ` +
        `1:${ENV_VAR_OF.messagingSenderId}:web:<at least 8 hex chars>. A web appId always embeds its own ` +
        `sender id, ` +
        `so these two values disagreeing means they came from different projects.`
    );
  }

  if (!/^AIza[0-9A-Za-z_-]{35}$/.test(cfg.apiKey)) {
    problems.push(`${ENV_VAR_OF.apiKey} is not the shape of a Firebase browser API key.`);
  }

  // Finally: no field may be production's, whatever the projectId says.
  for (const key of CONFIG_KEYS) {
    if (cfg[key] === PRODUCTION_VALUES[key]) {
      problems.push(
        `${ENV_VAR_OF[key]} is the PRODUCTION value. A staging build may not borrow any production ` +
          `identifier, and a blank must never be filled in from production.`
      );
    }
  }

  return problems;
}

function refuse(lines: string[]): never {
  throw new WsfStagingConfigError(
    ['WSF STAGING CONFIGURATION REFUSED — this build will not fall back to production.', ...lines.map((l) => `  ${l}`)].join(
      '\n'
    )
  );
}

/**
 * Returns the staging Firebase config for a staging build, null for an
 * unambiguous production build, and THROWS for everything in between.
 *
 * Null is returned in exactly one situation: no selector (or the explicit
 * `production` selector) AND not one staging value supplied. That is the
 * normal production build, and it is unchanged.
 */
export function resolveStagingConfig(input: StagingEnvInput): WsfFirebaseConfig | null {
  const envName = clean(input.envName);
  const supplied = suppliedKeys(input);
  const emulator = flagOn(input.emulatorFlagRaw);

  // 0. Present but blank is never "unset". A variable someone bothered to
  //    name, arriving empty, is a configuration failure — not a request for a
  //    production build.
  const blanks = presentButBlank(input);
  if (blanks.length) {
    refuse([
      `These variables are set but empty: ${blanks.join(', ')}.`,
      `A variable that is present and blank means its value did not arrive —`,
      `an unresolved secret, or an env file that did not load.`,
      `Unset them for a production build, or give them real values for staging.`,
    ]);
  }

  // 1. An unrecognised selector is always an error. Previously `Staging`,
  //    `stagng` and `prod` all silently meant production.
  if (envName !== '' && !(WSF_ENV_NAMES as readonly string[]).includes(envName)) {
    refuse([
      `EXPO_PUBLIC_WSF_ENV is "${input.envName}", which is not a recognised environment.`,
      `Use exactly one of: ${WSF_ENV_NAMES.join(', ')}.`,
      `A misspelled selector used to be treated as production, which shipped a build`,
      `pointed at live data while its author believed it was staging.`,
    ]);
  }

  const wantsStaging = envName === 'staging';

  // 2. Staging values supplied without the staging selector. This is the
  //    "forgot EXPO_PUBLIC_WSF_ENV" case, and it used to build production.
  if (!wantsStaging && supplied.length > 0) {
    refuse([
      supplied.length === CONFIG_KEYS.length
        ? `A complete staging Firebase config was supplied, but EXPO_PUBLIC_WSF_ENV is ` +
          `${envName === '' ? 'not set' : `"${envName}"`}.`
        : `Staging values were supplied (${supplied.map((k) => ENV_VAR_OF[k]).join(', ')}), but ` +
          `EXPO_PUBLIC_WSF_ENV is ${envName === '' ? 'not set' : `"${envName}"`}.`,
      `Set EXPO_PUBLIC_WSF_ENV=staging, or remove the staging values entirely.`,
      `Building production while staging values are present is never what was meant.`,
    ]);
  }

  // 3. Unambiguous production: no selector or an explicit production selector,
  //    and no staging values at all. Behaviour here is deliberately unchanged.
  if (!wantsStaging) return null;

  // 4. Staging and the emulator are mutually exclusive: that build has two
  //    different answers for which backend.
  if (emulator) {
    refuse([
      `EXPO_PUBLIC_WSF_ENV=staging and the emulator flag are both set.`,
      `A build targets the staging backend or the local emulator suite, never both.`,
    ]);
  }

  // 5. Staging must be complete. No partial config, no blanks filled in.
  const missing = CONFIG_KEYS.filter((k) => clean(input[k]) === '');
  if (missing.length) {
    refuse([
      `EXPO_PUBLIC_WSF_ENV=staging but the staging Firebase config is incomplete.`,
      `Missing: ${missing.map((k) => ENV_VAR_OF[k]).join(', ')}.`,
      `Supply the registered staging Web App's own SDK config. Do not fill blanks from production.`,
    ]);
  }

  const cfg: WsfFirebaseConfig = {
    apiKey: clean(input.apiKey),
    authDomain: clean(input.authDomain),
    projectId: clean(input.projectId),
    storageBucket: clean(input.storageBucket),
    messagingSenderId: clean(input.messagingSenderId),
    appId: clean(input.appId),
  };

  // 6. The production project is never a staging destination.
  if (namesProductionProject(cfg.projectId)) {
    refuse([
      `${ENV_VAR_OF.projectId} is "${cfg.projectId}", which names the production project.`,
      `Refused for any casing, for production's project number, and for sibling ids that`,
      `contain "${WSF_PRODUCTION_PROJECT_ID}" — DNS is case-insensitive, so a differently-cased`,
      `id still resolves to production's auth handler.`,
      `A staging build must point at a separate backend; a Hosting preview channel of the`,
      `production project is not one.`,
    ]);
  }

  // 7. And the six values must describe one coherent project.
  const problems = coherenceProblems(cfg);
  if (problems.length) refuse(problems);

  return cfg;
}

/** Reads the staging env off process.env. Kept separate so the resolver stays pure. */
export function readStagingEnv(): StagingEnvInput {
  return {
    envName: process.env.EXPO_PUBLIC_WSF_ENV,
    apiKey: process.env.EXPO_PUBLIC_WSF_STAGING_API_KEY,
    authDomain: process.env.EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN,
    projectId: process.env.EXPO_PUBLIC_WSF_STAGING_PROJECT_ID,
    storageBucket: process.env.EXPO_PUBLIC_WSF_STAGING_STORAGE_BUCKET,
    messagingSenderId: process.env.EXPO_PUBLIC_WSF_STAGING_SENDER_ID,
    appId: process.env.EXPO_PUBLIC_WSF_STAGING_APP_ID,
    emulatorFlagRaw: process.env.EXPO_PUBLIC_WSF_USE_EMULATORS,
  };
}
