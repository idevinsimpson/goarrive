/**
 * Root layout — GoArrive app
 *
 * Wraps the entire app in AuthProvider and sets up the navigation stack.
 * Uses Expo Router's Stack navigator with three route groups:
 *   - (auth): Login/signup screens (unauthenticated)
 *   - (app): Coach/admin dashboard (authenticated, coach/admin role)
 *   - (member): Member dashboard (authenticated, member role)
 *   - intake: Public intake form (no auth required)
 *
 * GestureHandlerRootView is required at the root for react-native-draggable-flatlist
 * and other gesture-based interactions.
 */
import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../lib/AuthContext';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <AuthProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: '#0E1117' },
            }}
          >
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(app)" />
            <Stack.Screen name="(member)" />
            <Stack.Screen name="intake/index" />
            <Stack.Screen name="intake/[coachId]" />
            <Stack.Screen name="coach-signup" />
            <Stack.Screen name="coach-apply" />
            <Stack.Screen name="checkout-success" />
            <Stack.Screen name="shared-plan/[memberId]" />
            <Stack.Screen name="join/[sessionInstanceId]" />
          </Stack>
        </AuthProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
