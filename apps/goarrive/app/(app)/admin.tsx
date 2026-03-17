/**
 * Admin screen — Platform admin tools
 *
 * Only visible to users with role === 'platformAdmin'.
 * Provides system-level tools and diagnostics.
 */
import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native';
import { Icon } from '../../components/Icon';
import { useAuth } from '../../lib/AuthContext';

const FONT_HEADING =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_BODY =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

export default function AdminScreen() {
  const { user, claims } = useAuth();

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Text style={s.title}>Admin Panel</Text>
      <Text style={s.subtitle}>Platform administration tools</Text>

      <View style={s.card}>
        <Icon name="person" size={20} color="#F5A623" />
        <View style={s.cardContent}>
          <Text style={s.cardTitle}>Current User</Text>
          <Text style={s.cardValue}>{user?.email ?? '—'}</Text>
          <Text style={s.cardMeta}>
            Role: {claims?.role ?? 'unknown'} · Coach ID: {claims?.coachId ?? '—'}
          </Text>
        </View>
      </View>

      <View style={s.card}>
        <Icon name="check-circle" size={20} color="#6EBB7A" />
        <View style={s.cardContent}>
          <Text style={s.cardTitle}>Security Rules</Text>
          <Text style={s.cardValue}>Deployed</Text>
          <Text style={s.cardMeta}>
            Firestore rules active for all collections
          </Text>
        </View>
      </View>

      <View style={s.card}>
        <Icon name="activity" size={20} color="#5B9BD5" />
        <View style={s.cardContent}>
          <Text style={s.cardTitle}>App Version</Text>
          <Text style={s.cardValue}>Slice 1 · Week 5</Text>
          <Text style={s.cardMeta}>
            PWA deployed to goarrive.web.app
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0E1117',
  },
  content: {
    padding: 16,
    paddingTop: Platform.select({ web: 60, default: 16 }),
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
  },
  subtitle: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
    marginBottom: 8,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: '#1A2035',
    borderRadius: 14,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#2A3347',
    alignItems: 'flex-start',
  },
  cardContent: {
    flex: 1,
    gap: 4,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
  },
  cardValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FONT_HEADING,
  },
  cardMeta: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
  },
});
