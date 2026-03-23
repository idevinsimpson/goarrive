/**
 * AppHeader — Fixed top header for the GoArrive app
 *
 * Displays the real GoArrive logo image on the left and a user avatar on the right.
 * Tapping the logo navigates to the dashboard.
 * Tapping the avatar opens AccountPanel as a slide-over modal (not a page navigation).
 * Uses env(safe-area-inset-top) for PWA standalone mode on iOS.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, Image } from 'react-native';
import { useAuth } from '../lib/AuthContext';
import { useRouter } from 'expo-router';
import AccountPanel from './AccountPanel';

const FONT_HEADING =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';

export function AppHeader() {
  const { user } = useAuth();
  const router = useRouter();
  const [showPanel, setShowPanel] = useState(false);

  const initials = user?.displayName
    ? user.displayName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : user?.email?.[0]?.toUpperCase() ?? '?';

  return (
    <>
      <View style={s.root}>
        {/* GoArrive Logo — tapping navigates to dashboard */}
        <Pressable
          onPress={() => router.push('/(app)/dashboard' as any)}
          accessibilityRole="button"
          accessibilityLabel="Go to Dashboard"
          hitSlop={8}
        >
          <Image
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            source={require('../assets/logo.png')}
            style={s.logo}
            resizeMode="contain"
            accessibilityLabel="GoArrive"
          />
        </Pressable>

        {/* Account avatar — opens slide-over panel */}
        <Pressable
          style={s.avatar}
          onPress={() => setShowPanel(true)}
          accessibilityRole="button"
          accessibilityLabel="Account"
          hitSlop={8}
        >
          <Text style={s.avatarText}>{initials}</Text>
        </Pressable>
      </View>

      {/* Account slide-over panel */}
      <AccountPanel
        visible={showPanel}
        onClose={() => setShowPanel(false)}
      />
    </>
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
