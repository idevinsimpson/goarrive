/**
 * NATIVE-INTEGRATOR-1 (INT-09, INT-10). WHICH STATUS-BAR ICONS A SCREEN GETS.
 *
 * Light icons over navy, dark over cream. On a native staging build the red
 * staging strip sits behind the status bar on every screen, so the icons are
 * light everywhere there. On web the browser owns the status area and none of
 * this is applied (expo-status-bar renders nothing on web).
 */
export type ScreenTone = 'navy' | 'cream';

export function statusBarStyleFor(tone: ScreenTone, stagingStripUnderStatusBar: boolean): 'light' | 'dark' {
  if (stagingStripUnderStatusBar) return 'light';
  return tone === 'navy' ? 'light' : 'dark';
}
