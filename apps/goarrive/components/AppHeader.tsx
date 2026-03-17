/**
 * AppHeader — Fixed top header for the GoArrive app
 *
 * Displays the real GoArrive logo image on the left and a user avatar on the right.
 * Uses env(safe-area-inset-top) for PWA standalone mode on iOS.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform, Image } from 'react-native';
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
      {/* GoArrive Logo */}
      <Image
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        source={require('../assets/logo.png')}
        style={s.logo}
        resizeMode="contain"
        accessibilityLabel="GoArrive"
      />

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
    paddingTop: Platform.select({ ios: 52, android: 16, web: 12, default: 16 }),
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2A3A',
    ...(Platform.OS === 'web'
      ? ({
          position: 'sticky' as any,
          top: 0,
          left: 0,
          right: 0,
          zIndex: 1000,
          // Dynamically respect iPhone notch/Dynamic Island in PWA mode
          paddingTop: 'max(12px, env(safe-area-inset-top, 12px))' as any,
        } as any)
      : {}),
  },
  logo: {
    width: 130,
    height: 38,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1A2035',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#F5A623',
  },
  avatarText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FONT_HEADING,
  },
});
