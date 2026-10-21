/**
 * NATIVE-INTEGRATOR-1 (INT-10). What a native binary knows about its own
 * build. Nothing on web: the web build stamps itself at bundle time
 * (`build:web` sets EXPO_PUBLIC_BUILD_COMMIT and EXPO_PUBLIC_WSF_BUILT_AT).
 * iOS and Android get src/nativeBuildInfo.native.ts.
 */
export const nativeBuildInfo: { commit?: string; builtAt?: string } = {};
