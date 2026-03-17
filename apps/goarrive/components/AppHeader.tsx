/**
 * AppHeader — Fixed top header for the GoArrive app
 *
 * Displays the G➲A logo/brand and an account avatar button.
 * Stays fixed at the top of the screen and never moves during swipe.
 * Uses env(safe-area-inset-top) for PWA standalone mode on iOS.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../lib/AuthContext';
import { router } from 'expo-router';

const FONT_HEADING =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';

interface Props {
  onNavigateAccount?: () => void;
}

export function AppHeader({ onNavigateAccount }: Props) {
  const { user } = useAuth();

  const initials = user?.displayName
    ? user.displayName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : user?.email?.[0]?.toUpperCase() ?? '?';

  const handleAccountPress = () => {
    if (onNavigateAccount) {
      onNavigateAccount();
    } else {
      router.push('/(app)/account');
    }
  };

  return (
    <View style={s.root}>
      {/* Brand */}
      <View style={s.brandRow}>
        <Text style={s.brandText}>G➲A</Text>
        <Text style={s.brandSub}>GoArrive</Text>
      </View>

      {/* Account avatar */}
      <Pressable
        style={s.avatar}
        onPress={handleAccountPress}
        accessibilityRole="button"
        accessibilityLabel="Account"
        hitSlop={8}
      >
        <Text style={s.avatarText}>{initials}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0E1117',
    paddingHorizontal: 16,
    paddingTop: Platform.select({ ios: 56, web: 12, default: 16 }),
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2A3347',
    ...(Platform.OS === 'web'
      ? ({
          position: 'sticky' as any,
          top: 0,
          left: 0,
          right: 0,
          zIndex: 1000,
          paddingTop: 'max(12px, env(safe-area-inset-top, 12px))' as any,
        } as any)
      : {}),
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  brandText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#F5A623',
    fontFamily: FONT_HEADING,
    letterSpacing: 1,
  },
  brandSub: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FONT_HEADING,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1A2035',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  avatarText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FONT_HEADING,
  },
});
