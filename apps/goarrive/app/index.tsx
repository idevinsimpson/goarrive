/**
 * Root index — Role-based routing
 *
 * Routes authenticated users to the appropriate dashboard based on their role:
 *   - platformAdmin → (app)/dashboard (coach/admin dashboard)
 *   - coach → (app)/dashboard (coach dashboard)
 *   - member → (member)/home (member dashboard)
 *   - no role (bootstrap) → (app)/dashboard (default to coach for bootstrapped accounts)
 *
 * Unauthenticated users are sent to the login screen.
 */
import { Redirect } from 'expo-router';
import { useAuth } from '../lib/AuthContext';
import { View, ActivityIndicator, StyleSheet } from 'react-native';

export default function Index() {
  const { user, claims, loading } = useAuth();

  if (loading) {
    return (
      <View style={s.root}>
        <ActivityIndicator color="#F5A623" size="large" />
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/(auth)/login" />;
  }

  // Determine role from custom claims
  const role = claims?.role;

  // Route based on role
  if (role === 'member') {
    return <Redirect href="/(member)/home" />;
  }

  // Coach, platformAdmin, or no role (bootstrap) → coach dashboard
  return <Redirect href="/(app)/dashboard" />;
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0E1117',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
