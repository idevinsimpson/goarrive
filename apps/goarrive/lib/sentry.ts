/**
 * Sentry error monitoring initialization for GoArrive.
 *
 * Uses the self-hosted Sentry instance at sentry.butterflyotel.online.
 * DSN is stored in EXPO_PUBLIC_SENTRY_DSN (set in app.config.js / EAS secrets).
 *
 * Usage:
 *   import { captureException, captureMessage } from './sentry';
 *   captureException(error);
 *   captureMessage('Something notable happened', 'info');
 */
import * as Sentry from '@sentry/react-native';

const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';

export function initSentry(): void {
  if (!SENTRY_DSN) {
    if (__DEV__) {
      console.warn('[Sentry] EXPO_PUBLIC_SENTRY_DSN is not set — error reporting disabled.');
    }
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    debug: __DEV__,
    // Capture 100% of errors; adjust tracesSampleRate for performance tracing
    tracesSampleRate: __DEV__ ? 0 : 0.2,
    // Tag every event with the environment
    environment: __DEV__ ? 'development' : 'production',
    // Automatically capture unhandled promise rejections
    enableAutoSessionTracking: true,
    // Attach user context when available (set via setSentryUser)
    attachStacktrace: true,
  });
}

/**
 * Set the current user context so Sentry events are attributed to a user.
 * Call this after successful auth.
 */
export function setSentryUser(uid: string, email?: string): void {
  Sentry.setUser({ id: uid, email });
}

/**
 * Clear user context on logout.
 */
export function clearSentryUser(): void {
  Sentry.setUser(null);
}

/**
 * Capture an exception and send it to Sentry.
 */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (context) {
    Sentry.withScope((scope) => {
      scope.setExtras(context);
      Sentry.captureException(error);
    });
  } else {
    Sentry.captureException(error);
  }
}

/**
 * Capture a message (non-error event) and send it to Sentry.
 */
export function captureMessage(
  message: string,
  level: Sentry.SeverityLevel = 'info'
): void {
  Sentry.captureMessage(message, level);
}

export { Sentry };
