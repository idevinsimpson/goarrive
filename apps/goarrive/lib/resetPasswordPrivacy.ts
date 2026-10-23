/**
 * Reset links are bearer credentials. Suppress telemetry from the reset page
 * and records that still carry a reset URL after navigation away. Do not turn
 * SDK error messages, action codes, or password fields into diagnostic data.
 */
function containsResetLink(text: string): boolean {
  // Also recognize URL-encoded links nested in navigation or network metadata.
  let candidate = text;
  for (let pass = 0; pass < 3; pass += 1) {
    if (
      /(?:^|\/)reset-password(?:\.html)?(?:[/?#\s"')]|$)/i.test(candidate) ||
      /[?&#]oobCode(?:=|[&#\s"')]|$)/i.test(candidate)
    ) {
      return true;
    }
    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) break;
      candidate = decoded;
    } catch {
      break;
    }
  }
  return false;
}

function containsResetCredential(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value === 'string') return containsResetLink(value);
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);

  // Error.message/stack are non-enumerable, unlike most Sentry event fields.
  if (value instanceof Error && (containsResetLink(value.message) || containsResetLink(value.stack ?? ''))) {
    return true;
  }

  return Object.entries(value).some(([key, nested]) =>
    /^(?:oobCode|password|newPassword|confirmPassword)$/i.test(key) ||
    containsResetCredential(nested, seen)
  );
}

export function filterResetPasswordTelemetry<T>(record: T): T | null {
  try {
    if (typeof window !== 'undefined' && containsResetLink(window.location.href)) {
      return null;
    }
    return containsResetCredential(record) ? null : record;
  } catch {
    // Fail closed if an unexpected diagnostic object cannot be inspected.
    return null;
  }
}
