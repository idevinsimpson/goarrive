/**
 * Auth layout — Unauthenticated screens
 */
import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#0E1117' },
      }}
    />
  );
}
