export const WSF_BUILD_STAMP = {
  commitSha: process.env.EXPO_PUBLIC_BUILD_COMMIT ?? 'dev',
  // Falls back to 'unknown', never to new Date(). A runtime clock read here
  // renders the moment the PAGE was opened, which looks exactly like a build
  // timestamp and is wrong every single time -- /health reported a build "14
  // seconds ago" for a bundle that shipped two hours earlier. A field nobody
  // can trust is worse than a field that admits it has no value.
  builtAt: process.env.EXPO_PUBLIC_WSF_BUILT_AT ?? 'unknown',
  appName: 'We Stay Fit',
  version: '0.1.0',
} as const;
