/**
 * (app) Layout — Protected routes with bottom tab navigation
 *
 * This layout wraps all screens in the (app) group.
 * It ensures that only authenticated users can access these screens.
 * Provides a bottom tab bar for Dashboard, Members, Workouts, Movements.
 */
import React from 'react';
import { Tabs, Redirect } from 'expo-router';
import { useAuth } from '../../lib/AuthContext';
import { View, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const TAB_BG = '#0E1117';
const TAB_BORDER = '#2A3347';
const ACTIVE_COLOR = '#F5A623';
const INACTIVE_COLOR = '#6B7280';

export default function AppLayout() {
  const { user, loading } = useAuth();

  // Show a loading spinner while checking auth state
  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#F5A623" />
      </View>
    );
  }

  // If not logged in, redirect to login
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
          height: Platform.select({ ios: 88, web: 64, default: 64 }),
          paddingBottom: Platform.select({ ios: 24, web: 8, default: 8 }),
          paddingTop: 8,
          ...(Platform.OS === 'web'
            ? ({
                position: 'fixed' as any,
                bottom: 0,
                left: 0,
                right: 0,
                zIndex: 1000,
              } as any)
            : {}),
        },
        tabBarActiveTintColor: ACTIVE_COLOR,
        tabBarInactiveTintColor: INACTIVE_COLOR,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          fontFamily:
            Platform.OS === 'web'
              ? "'DM Sans', sans-serif"
              : 'DMSans-Regular',
        },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="members"
        options={{
          title: 'Members',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="workouts"
        options={{
          title: 'Workouts',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="barbell-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="movements"
        options={{
          title: 'Movements',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="body-outline" size={size} color={color} />
          ),
        }}
      />
      {/* Hidden screens accessible via navigation but not shown in tab bar */}
      <Tabs.Screen
        name="admin"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          href: null,
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
