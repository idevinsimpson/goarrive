/**
 * haptics — Platform-safe haptic feedback utilities
 *
 * On native (iOS/Android): uses expo-haptics for tactile feedback.
 * On web: no-op (Vibration API is unreliable and not widely supported).
 *
 * Slice 1, Week 4, Loop 5 — Hardening
 */
import { Platform } from 'react-native';

// Lazy-load expo-haptics only on native to avoid web bundle issues
let Haptics: typeof import('expo-haptics') | null = null;

if (Platform.OS !== 'web') {
  try {
    Haptics = require('expo-haptics');
  } catch {
    // expo-haptics not installed — graceful fallback
    Haptics = null;
  }
}

/** Light tap — used for countdown ticks, minor transitions */
export function hapticLight(): void {
  if (Haptics) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }
}

/** Medium impact — used for phase transitions (work → rest, rest → work) */
export function hapticMedium(): void {
  if (Haptics) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }
}

/** Heavy impact — used for workout start and completion */
export function hapticHeavy(): void {
  if (Haptics) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
  }
}

/** Success notification — used for workout completion */
export function hapticSuccess(): void {
  if (Haptics) {
    Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Success,
    ).catch(() => {});
  }
}
