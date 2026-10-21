import { nativeBuildInfo } from './nativeBuildInfo';

export const WSF_BUILD_STAMP = {
  // INT-10: a native binary reads its own EAS build stamp (src/nativeBuildInfo.native.ts);
  // on web that module is empty, so this is exactly the web build's stamp, as before.
  commitSha: process.env.EXPO_PUBLIC_BUILD_COMMIT ?? nativeBuildInfo.commit ?? 'dev',
  // Falls back to 'unknown', never to new Date(). A runtime clock read here
  // renders the moment the PAGE was opened, which looks exactly like a build
  // timestamp and is wrong every single time -- /health reported a build "14
  // seconds ago" for a bundle that shipped two hours earlier. A field nobody
  // can trust is worse than a field that admits it has no value.
  builtAt: process.env.EXPO_PUBLIC_WSF_BUILT_AT ?? nativeBuildInfo.builtAt ?? 'unknown',
  appName: 'We Stay Fit',
  version: '0.1.0',
} as const;
