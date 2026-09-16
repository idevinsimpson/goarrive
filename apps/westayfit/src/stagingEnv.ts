/**
 * Staging environment resolution for the We Stay Fit web app.
 *
 * WHY THIS EXISTS. Before this file the app could reach exactly two backends:
 * the production project `goarrive`, or the local emulator namespace
 * `demo-wsf-local` — and the emulator one only on a loopback host. There was
 * no third option, so there was no way to build an artifact that talks to a
 * staging backend. A Firebase Hosting preview channel does NOT create one: a
 * preview channel changes the hostname the bundle is served from and nothing
 * about the Auth pool, Firestore database, Cloud Functions or Storage bucket
 * it calls. Without this file, "deploy WSF to staging" means "point a second
 * URL at live production data".
 *
 * WHAT IT DOES NOT DO. It does not create a staging backend and it cannot.
 * It only lets a build be pointed at one that already exists. If no separate
 * backend exists, declaring EXPO_PUBLIC_WSF_ENV=staging is refused below
 * rather than quietly resolving to production.
 *
 * THE STRUCTURAL GUARD. The lesson already learned in firebase.ts is that a
 * build-time flag alone is a promise, not a guarantee. The same discipline
 * applies in the other direction here: a build that CLAIMS to be staging must
 * not be able to write to production. So `resolveStagingConfig` refuses, by
 * throwing, when the declared staging project id is the production one, or
 * when the config is only partly supplied. A build that cannot be trusted to
 * be staging does not boot, which is strictly safer than one that silently
 * becomes production while wearing a STAGING banner.
 */

/** The production project. A staging build may never resolve to this. */
export const WSF_PRODUCTION_PROJECT_ID = 'goarrive' as const;

export type WsfEnvName = 'production' | 'staging';

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
};

/**
 * Only the exact lowercase word `staging` opts in. Anything else — unset,
 * empty, 'prod', 'Staging ', a typo — is production. Opting IN to a weaker
 * environment should require getting it exactly right; opting out should not.
 */
export function isStagingDeclared(envName: string | undefined): boolean {
  return envName === 'staging';
}

export class WsfStagingConfigError extends Error {}

const REQUIRED: (keyof StagingEnvInput)[] = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
];

const ENV_VAR_OF: Record<string, string> = {
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

/**
 * Returns the staging Firebase config when this build is a staging build, and
 * null when it is not. THROWS when staging is declared but the result would
 * not actually be a separate backend — that case is a misconfiguration, and
 * the only safe response is to refuse to start.
 */
export function resolveStagingConfig(input: StagingEnvInput): WsfFirebaseConfig | null {
  if (!isStagingDeclared(input.envName)) return null;

  const missing = REQUIRED.filter((k) => clean(input[k]) === '').map((k) => ENV_VAR_OF[k]);
  if (missing.length) {
    throw new WsfStagingConfigError(
      `EXPO_PUBLIC_WSF_ENV=staging but the staging Firebase config is incomplete. ` +
        `Missing: ${missing.join(', ')}. A staging build will not fall back to production.`
    );
  }

  const projectId = clean(input.projectId);
  if (projectId === WSF_PRODUCTION_PROJECT_ID) {
    throw new WsfStagingConfigError(
      `EXPO_PUBLIC_WSF_STAGING_PROJECT_ID is "${WSF_PRODUCTION_PROJECT_ID}", which is the ` +
        `production project. A staging build must point at a separate backend; a Hosting ` +
        `preview channel of the production project is not one.`
    );
  }

  return {
    apiKey: clean(input.apiKey),
    authDomain: clean(input.authDomain),
    projectId,
    storageBucket: clean(input.storageBucket),
    messagingSenderId: clean(input.messagingSenderId),
    appId: clean(input.appId),
  };
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
  };
}
