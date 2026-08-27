export const WSF_BUILD_STAMP = {
  commitSha: process.env.EXPO_PUBLIC_WSF_COMMIT_SHA ?? 'dev',
  builtAt: process.env.EXPO_PUBLIC_WSF_BUILT_AT ?? new Date().toISOString(),
  appName: 'We Stay Fit',
  version: '0.1.0',
} as const;
