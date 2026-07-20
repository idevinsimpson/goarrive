import { Platform } from 'react-native';

export const TAB_BG = '#0E1117';
export const TAB_BORDER = '#1E2A3A';

// Shared so screens (e.g. Build during drag) can hide the tab bar with
// { ...TAB_BAR_STYLE, display: 'none' } and restore the exact same style —
// setOptions replaces tabBarStyle wholesale rather than merging.
export const TAB_BAR_STYLE: any = {
  backgroundColor: TAB_BG,
  borderTopColor: TAB_BORDER,
  borderTopWidth: 1,
  height: Platform.select({ ios: 84, android: 68, web: 68, default: 68 }),
  paddingTop: 8,
  paddingBottom: Platform.select({ ios: 24, android: 10, web: 10, default: 10 }),
  ...(Platform.OS === 'web'
    ? {
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        paddingBottom: 'max(10px, env(safe-area-inset-bottom, 0px))',
        height: 'calc(62px + max(10px, env(safe-area-inset-bottom, 0px)))',
      }
    : {}),
};

// Bottom padding for scroll content so the last row clears the fixed web tab
// bar (62px + up to ~34px iOS safe-area inset — env() isn't readable from JS).
export const CONTENT_BOTTOM_CLEARANCE = Platform.OS === 'web' ? 160 : 100;
