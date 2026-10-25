export function containsGuestWorkoutLink(value: string): boolean {
  let text = value;
  for (let i = 0; i < 3; i++) {
    if (/(?:^|\/)guest-workout(?:\.html)?(?:[/?#\s"')]|$)/i.test(text)) return true;
    try { const decoded = decodeURIComponent(text); if (decoded === text) break; text = decoded; } catch { break; }
  }
  return false;
}
export function filterGuestWorkoutTelemetry<T>(record: T): T | null {
  try {
    if (typeof window !== 'undefined' && containsGuestWorkoutLink(window.location.href)) return null;
    const seen = new WeakSet<object>();
    const sensitive = (value: unknown): boolean => {
      if (typeof value === 'string') return containsGuestWorkoutLink(value);
      if (!value || typeof value !== 'object' || seen.has(value)) return false;
      seen.add(value);
      if (value instanceof Error && (containsGuestWorkoutLink(value.message) || containsGuestWorkoutLink(value.stack || ''))) return true;
      return Object.entries(value).some(([key, v]) => /^(guestCapability|capabilityToken)$/i.test(key) || sensitive(v));
    };
    return sensitive(record) ? null : record;
  } catch { return null; }
}
