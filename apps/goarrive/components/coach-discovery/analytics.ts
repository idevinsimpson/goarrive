export type CoachDiscoveryEvent =
  | 'experience_opened'
  | 'scene_depth_reached'
  | 'platform_section_viewed'
  | 'compensation_section_viewed'
  | 'final_question_reached'
  | 'next_step_cta_selected';

export function trackCoachDiscoveryEvent(
  event: CoachDiscoveryEvent,
  properties: Record<string, string | number | boolean> = {},
) {
  if (typeof globalThis.window === 'undefined') return;
  const browserWindow = globalThis.window as any;
  browserWindow.dispatchEvent(
    new CustomEvent('goarrive:coach-discovery', { detail: { event, ...properties } }),
  );

  if (typeof browserWindow.gtag === 'function') {
    browserWindow.gtag('event', event, properties);
  }
}
