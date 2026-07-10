/**
 * (app) Layout — Protected routes with bottom tab navigation
 *
 * Bottom tab bar with proper safe-area handling for PWA/iOS/Android.
 * Uses CSS env(safe-area-inset-bottom) on web for notch-aware bottom padding.
 */
import React from 'react';
import { Tabs, Redirect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/AuthContext';
import { useCoachModules } from '../../lib/useCoachModules';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { Icon } from '../../components/Icon';
import { TAB_BAR_STYLE } from '../../lib/tabBarStyle';

const ACTIVE_COLOR = '#F5A623';
const INACTIVE_COLOR = '#4A5568';

export default function AppLayout() {
  const { user, claims, loading, adminCoachOverride, setAdminCoachOverride } = useAuth();
  const { modules } = useCoachModules();
  const insets = useSafeAreaInsets();
  const bannerTopPad = Platform.OS === 'web' ? Math.max(6, insets.top) : 6;
  // When every gateable tab is off, only Dashboard would remain — hide the whole bar
  const allTabsHidden = !modules.members && !modules.build && !modules.scheduling;

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
    <View
      style={[
        { flex: 1 },
        // iOS PWA standalone: lock to dynamic viewport + disable body scroll so
        // sticky AppHeader can't be overlapped by content sliding up behind it.
        Platform.OS === 'web'
          ? ({ height: '100dvh', maxHeight: '100dvh', overflow: 'hidden', overscrollBehavior: 'none' } as any)
          : null,
      ]}
    >
      {adminCoachOverride && (
        <View style={[styles.overrideBanner, { paddingTop: bannerTopPad }]}>
          <Text style={styles.overrideText}>
            Viewing as coach: {adminCoachOverride.coachName}
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
        tabBarStyle: allTabsHidden ? { ...TAB_BAR_STYLE, display: 'none' } : TAB_BAR_STYLE,
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
          href: modules.members ? undefined : null,
          title: 'Members',
          tabBarIcon: ({ color }) => (
            <Icon name="members" size={26} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="build"
        options={{
          href: modules.build ? undefined : null,
          title: 'Build',
          tabBarIcon: ({ color, focused }) => (
            <Icon name={focused ? 'build-filled' : 'build'} size={26} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="scheduling"
        options={{
          href: modules.scheduling ? undefined : null,
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
      <Tabs.Screen name="feedback" options={{ href: null }} />
      <Tabs.Screen name="my-page" options={{ href: null }} />
      <Tabs.Screen name="billing" options={{ href: null }} />
      <Tabs.Screen name="coach-launch" options={{ href: null }} />
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
    paddingBottom: 6,
    paddingHorizontal: 16,
    gap: 12,
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
