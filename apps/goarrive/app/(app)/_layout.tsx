/**
 * (app) Layout — Protected routes
 *
 * This layout wraps all screens in the (app) group.
 * It ensures that only authenticated users can access these screens.
 */
import React from 'react';
import { Stack, Redirect } from 'expo-router';
import { useAuth } from '../../lib/AuthContext';
import { View, ActivityIndicator, StyleSheet } from 'react-native';

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

  // Render the child screens
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="dashboard" />
      <Stack.Screen name="members" />
      <Stack.Screen name="workouts" />
      <Stack.Screen name="movements" />
      <Stack.Screen name="admin" />
      <Stack.Screen name="account" />
    </Stack>
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
