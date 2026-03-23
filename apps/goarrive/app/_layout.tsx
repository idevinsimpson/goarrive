/**
 * Root layout — GoArrive app
 *
 * Wraps the entire app in AuthProvider and sets up the navigation stack.
 * Uses Expo Router's Stack navigator with three route groups:
 *   - (auth): Login/signup screens (unauthenticated)
 *   - (app): Coach/admin dashboard (authenticated, coach/admin role)
 *   - (member): Member dashboard (authenticated, member role)
 *   - intake: Public intake form (no auth required)
 */
import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '../lib/AuthContext';

export default function RootLayout() {
  return (
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
        <Stack.Screen name="intake" />
        <Stack.Screen name="coach-signup" />
      </Stack>
    </AuthProvider>
  );
}
