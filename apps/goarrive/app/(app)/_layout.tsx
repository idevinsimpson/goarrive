/**
 * (app) Layout — Protected routes with bottom tab navigation
 *
 * Bottom tab bar with proper safe-area handling for PWA/iOS/Android.
 * Uses CSS env(safe-area-inset-bottom) on web for notch-aware bottom padding.
 */
import React from 'react';
import { Tabs, Redirect } from 'expo-router';
import { useAuth } from '../../lib/AuthContext';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { Icon } from '../../components/Icon';

const TAB_BG = '#0E1117';
const TAB_BORDER = '#1E2A3A';
const ACTIVE_COLOR = '#F5A623';
const INACTIVE_COLOR = '#4A5568';

export default function AppLayout() {
  const { user, claims, loading, adminCoachOverride, setAdminCoachOverride } = useAuth();

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

  // Role-based route guard: If user is a member, they should NOT be in the (app) section
  if (claims?.role === 'member') {
    return <Redirect href="/(member)/home" />;
  }

  return (
    <View style={{ flex: 1 }}>
      {adminCoachOverride && (
        <View style={styles.overrideBanner}>
          <Text style={styles.overrideText}>
            Viewing as coach: {adminCoachOverride.slice(0, 8)}...
          </Text>
          <TouchableOpacity
            style={styles.overrideExitBtn}
            onPress={() => setAdminCoachOverride(null)}
          >
            <Text style={styles.overrideExitText}>Exit</Text>
          </TouchableOpacity>
        </View>
      )}
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: TAB_BG,
          borderTopColor: TAB_BORDER,
          borderTopWidth: 1,
          // Native: give enough room for icon + label + home indicator
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
                // Full safe-area-inset-bottom so labels clear the home indicator zone
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
        name="build"
        options={{
          title: 'Build',
          tabBarIcon: ({ color, focused }) => (
            <Icon name={focused ? 'build-filled' : 'build'} size={26} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="scheduling"
        options={{
          title: 'Scheduling',
          tabBarIcon: ({ color }) => (
            <Icon name="calendar" size={26} color={color} />
          ),
        }}
      />
      <Tabs.Screen name="workouts" options={{ href: null }} />
      <Tabs.Screen name="movements" options={{ href: null }} />
      {/* Hidden screens — accessible via navigation but not shown in tab bar */}
      <Tabs.Screen name="admin" options={{ href: null }} />
      <Tabs.Screen name="account" options={{ href: null }} />
      <Tabs.Screen name="billing" options={{ href: null }} />
      {/* member-plan: full-screen immersive, no tab bar */}
      <Tabs.Screen
        name="member-plan/[memberId]"
        options={{
          href: null,
          tabBarStyle: { display: 'none' },
        }}
      />
    </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0E1117',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overrideBanner: {
    backgroundColor: '#F5A623',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 16,
    gap: 12,
    ...(Platform.OS === 'web'
      ? ({ paddingTop: 'max(6px, env(safe-area-inset-top, 0px))' } as any)
      : {}),
  },
  overrideText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined,
  },
  overrideExitBtn: {
    backgroundColor: '#0E1117',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 6,
  },
  overrideExitText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined,
  },
});
