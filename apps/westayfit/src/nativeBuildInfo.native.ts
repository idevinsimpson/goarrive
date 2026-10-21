import Constants from 'expo-constants';

/**
 * NATIVE-INTEGRATOR-1 (INT-10). THE BINARY'S OWN COMMIT AND BUILD TIME.
 *
 * A phone build used to read "build dev": EXPO_PUBLIC_BUILD_COMMIT is set only
 * by the web build script. An EAS build now stamps `extra.wsfBuild` in its app
 * config (app.config.js, from EAS_BUILD_GIT_COMMIT_HASH and the time the
 * config was evaluated during the build), and the binary carries that config,
 * so the staging strip and Build details can say which build this is. A local
 * development build has no stamp and keeps saying "dev".
 */
type Stamp = { commit?: unknown; builtAt?: unknown };

/** The stamp in an app config's `extra`, keeping only well-formed values. */
export function buildInfoFrom(extra: unknown): { commit?: string; builtAt?: string } {
  const raw = (extra as { wsfBuild?: Stamp } | null | undefined)?.wsfBuild;
  const stamp: Stamp = raw && typeof raw === 'object' ? raw : {};
  return {
    commit: typeof stamp.commit === 'string' && /^[0-9a-f]{7,40}$/.test(stamp.commit) ? stamp.commit : undefined,
    builtAt:
      typeof stamp.builtAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(stamp.builtAt) ? stamp.builtAt : undefined,
  };
}

export const nativeBuildInfo = buildInfoFrom(Constants.expoConfig?.extra);
