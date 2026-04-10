/**
 * Root index — Landing page + Role-based routing
 *
 * Unauthenticated visitors see the public marketing landing page.
 * Authenticated users are routed to the appropriate dashboard based on role:
 *   - platformAdmin → (app)/dashboard
 *   - coach → (app)/dashboard
 *   - member → (member)/home
 *   - no role (bootstrap) → (app)/dashboard
 */
import { Redirect } from 'expo-router';
import { useAuth } from '../lib/AuthContext';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import LandingPage from '../components/landing/LandingPage';

export default function Index() {
  const { user, claims, loading } = useAuth();

  if (loading) {
    return (
      <View style={s.root}>
        <ActivityIndicator color="#F5A623" size="large" />
      </View>
    );
  }

  // Unauthenticated → show public landing page
  if (!user) {
    return <LandingPage />;
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
