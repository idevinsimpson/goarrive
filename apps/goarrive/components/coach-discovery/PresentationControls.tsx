import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { discoveryColors, discoveryFonts } from './tokens';

interface PresentationControlsProps {
  presentationMode: boolean;
  isMobile: boolean;
  onBackToTop: () => void;
  onShare: () => void;
}

export function PresentationControls({
  presentationMode,
  isMobile,
  onBackToTop,
  onShare,
}: PresentationControlsProps) {
  const insets = useSafeAreaInsets();
  if (presentationMode) return null;
  return (
    <View
      style={[
        styles.wrap,
        isMobile ? styles.wrapMobile : styles.wrapDesktop,
        Platform.OS === 'web' && ({ position: 'fixed' } as any),
        isMobile && Platform.OS === 'web' && ({ bottom: 'max(12px, env(safe-area-inset-bottom, 0px))' } as any),
        isMobile && Platform.OS !== 'web' && { bottom: Math.max(12, insets.bottom + 12) },
      ]}
    >
      <ControlButton label="Back to top" compact={isMobile} onPress={onBackToTop} />
      <ControlButton label="Share" compact={isMobile} onPress={onShare} />
    </View>
  );
}

function ControlButton({
  label,
  onPress,
  compact,
}: {
  label: string;
  onPress: () => void;
  compact: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        focused && styles.buttonFocused,
        pressed && styles.buttonPressed,
      ]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    zIndex: 900,
    flexDirection: 'row',
    gap: 8,
  },
  wrapMobile: {
    right: 12,
    bottom: 12,
  },
  wrapDesktop: {
    right: 22,
    bottom: 22,
  },
  button: {
    minHeight: 40,
    paddingHorizontal: 15,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(21,27,40,0.9)',
    borderWidth: 1,
    borderColor: discoveryColors.borderSoft,
  },
  buttonCompact: {
    minHeight: 36,
    paddingHorizontal: 12,
  },
  buttonFocused: {
    borderColor: discoveryColors.blue,
    shadowColor: discoveryColors.blue,
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  buttonPressed: {
    opacity: 0.76,
    transform: [{ scale: 0.98 }],
  },
  buttonText: {
    color: discoveryColors.textSoft,
    fontFamily: discoveryFonts.body,
    fontSize: 11,
    fontWeight: '600',
  },
});
