import { Platform } from 'react-native';

import { wsfIsStaging } from './firebase';

/**
 * NATIVE-INTEGRATOR-1 (INT-10). True on a native staging build, where the red
 * staging strip paints behind the status bar (src/StagingBanner.tsx). On web
 * the strip is the page's first row under the browser's own chrome, so this
 * is false there.
 */
export const STAGING_STRIP_UNDER_STATUS_BAR = wsfIsStaging && Platform.OS !== 'web';
