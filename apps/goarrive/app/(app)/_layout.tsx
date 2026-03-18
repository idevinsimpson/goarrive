/**
 * (app) Layout — Protected routes with bottom tab navigation
 *
 * Bottom tab bar with proper safe-area handling for PWA/iOS/Android.
 * Uses CSS env(safe-area-inset-bottom) on web for notch-aware bottom padding.
 */
import React from 'react';
import { Tabs, Redirect } from 'expo-router';
import { useAuth } from '../../lib/AuthContext';
import { View, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { Icon } from '../../components/Icon';

const TAB_BG = '#0E1117';
const TAB_BORDER = '#1E2A3A';
const ACTIVE_COLOR = '#F5A623';
const INACTIVE_COLOR = '#4A5568';

export default function AppLayout() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#F5A623" />
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: TAB_BG,
          borderTopColor: TAB_BORDER,
          borderTopWidth: 1,
          // Native: give enough room for icon + label
          height: Platform.select({ ios: 68, android: 62, web: 62, default: 62 }),
          paddingTop: 8,
          paddingBottom: Platform.select({ ios: 10, android: 6, web: 6, default: 6 }),
          ...(Platform.OS === 'web'
            ? ({
                position: 'fixed' as any,
                bottom: 0,
                left: 0,
                right: 0,
                zIndex: 1000,
                // Fixed small bottom padding — iOS home indicator is handled by the OS
                paddingBottom: '8px' as any,
                height: '64px' as any,
              } as any)
            : {}),
        },
        tabBarActiveTintColor: ACTIVE_COLOR,
        tabBarInactiveTintColor: INACTIVE_COLOR,
        tabBarLabelStyle: {
          fontSize: 13,
          fontWeight: '600',
          marginTop: 2,
          fontFamily:
            Platform.OS === 'web'
              ? "'DM Sans', sans-serif"
              : undefined,
        },
        tabBarIconStyle: {
          marginTop: 0,
        },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, focused }) => (
            <Icon name={focused ? 'dashboard-filled' : 'dashboard'} size={26} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="members"
        options={{
          title: 'Members',
          tabBarIcon: ({ color }) => (
            <Icon name="members" size={26} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="workouts"
        options={{
          title: 'Workouts',
          tabBarIcon: ({ color }) => (
            <Icon name="workouts" size={26} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="movements"
        options={{
          title: 'Movements',
          tabBarIcon: ({ color }) => (
            <Icon name="movements" size={26} color={color} />
          ),
        }}
      />
      {/* Hidden screens — accessible via navigation but not shown in tab bar */}
      <Tabs.Screen name="admin" options={{ href: null }} />
      <Tabs.Screen name="account" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0E1117',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
