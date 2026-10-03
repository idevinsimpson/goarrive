import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { lockMessage, type SessionSnapshot } from './session';

/**
 * Pieces shared by the web lab and the native placeholder. Deliberately
 * plain: this is a test instrument, not the product's visual design, so it
 * uses no kit/theme tokens (and touches no file another lane owns).
 */

export const PRIVACY_LINE =
  'Camera frames are processed on this device and are never recorded, stored or uploaded. The count is not saved anywhere.';

export function LabBanner() {
  return (
    <View style={s.banner}>
      <Text style={s.bannerText}>DEV LAB · MOVEMENT-VISION-1 · SQUATS · NOT A MEMBER SURFACE</Text>
    </View>
  );
}

export function LabButton({
  label,
  onPress,
  testID,
  tone = 'plain',
  disabled,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
  tone?: 'plain' | 'primary';
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      style={[s.button, tone === 'primary' && s.buttonPrimary, disabled && s.buttonDisabled]}
    >
      <Text style={[s.buttonText, tone === 'primary' && s.buttonTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

const STATE_COLOR: Record<SessionSnapshot['lockState'], string> = {
  searching: '#6b7280',
  acquiring: '#b45309',
  locked: '#15803d',
  lost: '#b91c1c',
};

export function stateColor(state: SessionSnapshot['lockState']): string {
  return STATE_COLOR[state];
}

export function CountPanel({ snap, children }: { snap: SessionSnapshot; children?: ReactNode }) {
  const manual = snap.mode === 'manual';
  return (
    <View style={s.panel}>
      {!manual && (
        <View style={[s.statePill, { backgroundColor: stateColor(snap.lockState) }]}>
          <Text testID="mv-state" style={s.statePillText}>
            {lockMessage(snap.lockState, snap.lockReason)}
          </Text>
        </View>
      )}
      <Text style={s.repLabel}>{manual ? 'SQUATS (MANUAL COUNT)' : 'SQUATS'}</Text>
      <Text testID="mv-reps" accessibilityLabel={`${snap.reps} squats`} style={s.repCount}>
        {snap.reps}
      </Text>
      {children}
    </View>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={s.row}>{children}</View>;
}

export const labStyles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f5f5f4' },
  scroll: { padding: 16, gap: 12, maxWidth: 960, width: '100%', alignSelf: 'center' },
  note: { fontSize: 13, lineHeight: 18, color: '#374151' },
  mono: { fontSize: 12, lineHeight: 16, color: '#374151', fontFamily: 'monospace' },
  error: { fontSize: 14, lineHeight: 20, color: '#b91c1c' },
});

const s = StyleSheet.create({
  banner: { backgroundColor: '#111827', paddingVertical: 6, paddingHorizontal: 12 },
  bannerText: { color: '#fde68a', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#ffffff',
  },
  buttonPrimary: { backgroundColor: '#111827', borderColor: '#111827' },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { fontSize: 14, fontWeight: '600', color: '#111827' },
  buttonTextPrimary: { color: '#ffffff' },
  panel: { backgroundColor: '#ffffff', borderRadius: 12, padding: 16, gap: 8, alignItems: 'flex-start' },
  statePill: { borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  statePillText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  repLabel: { fontSize: 12, fontWeight: '700', color: '#6b7280', letterSpacing: 1 },
  repCount: { fontSize: 72, lineHeight: 80, fontWeight: '800', color: '#111827' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
