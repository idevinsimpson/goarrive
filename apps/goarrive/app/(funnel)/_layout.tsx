import { Stack } from 'expo-router';

export default function FunnelLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#0E1117' },
      }}
    />
  );
}
