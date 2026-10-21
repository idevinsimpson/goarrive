/**
 * NATIVE-INTEGRATOR-1 (INT-09). WHICH STATUS-BAR ICONS A SCREEN GETS.
 *
 * Light icons over navy, dark over cream. On web the browser owns the status
 * area and none of this is applied (expo-status-bar renders nothing on web).
 * W12-26 (the owner's UI-copy order): the red strip a test build used to draw
 * behind the status bar is gone, so the screen's tone alone decides.
 */
export type ScreenTone = 'navy' | 'cream';

export function statusBarStyleFor(tone: ScreenTone): 'light' | 'dark' {
  return tone === 'navy' ? 'light' : 'dark';
}
