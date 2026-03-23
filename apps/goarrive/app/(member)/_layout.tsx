/**
 * (member) Layout — Protected routes for member role
 *
 * Bottom tab bar with Home, My Plan, and Profile tabs.
 * Only accessible to users with 'member' role.
 */
import React from 'react';
import { Tabs, Redirect } from 'expo-router';
import { useAuth } from '../../lib/AuthContext';
import { View, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { Icon } from '../../components/Icon';
import { useFcmToken } from '../../lib/useFcmToken';

const TAB_BG = '#0E1117';
const TAB_BORDER = '#1E2A3A';
const ACTIVE_COLOR = '#F5A623';
const INACTIVE_COLOR = '#4A5568';

export default function MemberLayout() {
  const { user, claims, loading } = useAuth();
  // Register FCM push token for this member so the coach's "Share" action
  // can trigger a native push notification even when the app is not open.
  useFcmToken(user?.uid);

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

  // If user is a coach or admin, redirect to coach dashboard
  const role = claims?.role;
  if (role === 'coach' || role === 'platformAdmin') {
    return <Redirect href="/(app)/dashboard" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: TAB_BG,
          borderTopColor: TAB_BORDER,
          borderTopWidth: 1,
          height: Platform.select({ ios: 84, android: 68, web: 68, default: 68 }),
          paddingTop: 8,
          paddingBottom: Platform.select({ ios: 24, android: 10, web: 10, default: 10 }),
          ...(Platform.OS === 'web'
            ? ({
                position: 'fixed' as any,
                bottom: 0,
                left: 0,
                right: 0,
                zIndex: 1000,
                paddingBottom: 'max(10px, env(safe-area-inset-bottom, 0px))' as any,
                height: 'calc(62px + max(10px, env(safe-area-inset-bottom, 0px)))' as any,
              } as any)
            : {}),
        },
        tabBarActiveTintColor: ACTIVE_COLOR,
        tabBarInactiveTintColor: INACTIVE_COLOR,
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
          marginTop: 1,
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
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <Icon name={focused ? 'dashboard-filled' : 'dashboard'} size={26} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="my-sessions"
        options={{
          title: 'Sessions',
          tabBarIcon: ({ color }) => (
            <Icon name="calendar" size={26} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="my-plan"
        options={{
          title: 'My Plan',
          tabBarStyle: { display: 'none' },
          tabBarIcon: ({ color }) => (
            <Icon name="document" size={26} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => (
            <Icon name="person" size={26} color={color} />
          ),
        }}
      />
      {/* Hidden screens — accessible via router.push but not shown in tab bar */}
      <Tabs.Screen
        name="payment-select"
        options={{
          href: null,
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="checkout-success"
        options={{
          href: null,
          tabBarStyle: { display: 'none' },
        }}
      />
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
