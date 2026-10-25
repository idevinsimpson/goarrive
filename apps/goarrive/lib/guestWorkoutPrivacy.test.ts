import { describe, it, expect } from 'vitest';
import { filterGuestWorkoutTelemetry as filter, containsGuestWorkoutLink } from './guestWorkoutPrivacy';
describe('guest telemetry boundary', () => {
  it.each(['/guest-workout#fixture', '/guest-workout.html#fixture', encodeURIComponent('/guest-workout#fixture'), encodeURIComponent(encodeURIComponent('/guest-workout#fixture'))])('drops nested current or stale URL: %s', url => {
    expect(containsGuestWorkoutLink(url)).toBe(true); expect(filter({ breadcrumbs: [{ data: { url } }] })).toBeNull();
  });
  it('drops non-enumerable error and raw credential fields', () => {
    expect(filter(new Error('failed /guest-workout#fixture'))).toBeNull();
    expect(filter({ nested: { capabilityToken: 'synthetic' } })).toBeNull();
    expect(filter({ nested: { guestCapability: 'synthetic' } })).toBeNull();
  });
  it('preserves unrelated diagnostics and tolerates cycles', () => {
    const event: any = { message: 'ordinary failure' }; event.self = event; expect(filter(event)).toBe(event);
  });
});
