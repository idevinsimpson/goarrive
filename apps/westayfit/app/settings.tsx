import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useWsfAuth } from '../src/auth';
import {
  CREAM,
  HAIRLINE,
  INK_QUIET,
  NAVY,
  PROGRESS_GREEN,
  TEXT_MUTED,
} from '../src/ui/kit';
import { MEMBER_TAB_BAR_BODY } from '../src/ui/MemberTabBar';

/**
 * SETTINGS — the hub.
 *
 * REACHED FROM A ROW INSIDE `You`, NOT FROM A HEADER GEAR AND NOT FROM A SIXTH
 * TAB. The proposal drew a gear in the top-right chrome; the Director refused
 * it because W9 owns the persistent header and hamburger, and a second utility
 * affordance in that corner would either fight W9's or become dead. So this is
 * an ordinary working route that W9 can expose from the hamburger later — real
 * on arrival, with nothing to wire up afterwards.
 *
 * DELIBERATELY THIN. This holds exactly what exists today. A settings hub that
 * lists rows leading nowhere teaches a member the app is unfinished, so
 * anything not built is simply absent rather than disabled.
 */
export default function SettingsScreen() {
  const { user, ready } = useWsfAuth();
  if (ready && !user) {
    router.replace('/');
    return null;
  }
  return (
    <ScrollView style={st.screen} contentContainerStyle={st.body} testID="wsf-settings-screen">
      <View style={st.chrome}>
        <Pressable
          onPress={() => router.replace('/you')}
          accessibilityRole="link"
          accessibilityLabel="Back to You"
          testID="wsf-settings-back"
        >
          <Text style={st.back}>‹</Text>
        </Pressable>
      </View>

      <View style={st.identity}>
        <Text style={st.eyebrow}>Settings</Text>
        <Text style={st.title}>Your preferences</Text>
      </View>

      <Pressable
        onPress={() => router.push('/settings/privacy')}
        accessibilityRole="link"
        style={st.row}
        testID="wsf-settings-privacy-row"
      >
        <View style={st.rowText}>
          <Text style={st.rowTitle}>Privacy</Text>
          <Text style={st.rowSub}>How you appear in each of your communities</Text>
        </View>
        <Text style={st.chevron}>›</Text>
      </Pressable>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CREAM },
  body: { paddingHorizontal: 20, paddingTop: 14, gap: 14, paddingBottom: MEMBER_TAB_BAR_BODY },
  chrome: { flexDirection: 'row', alignItems: 'center' },
  back: { color: NAVY, fontSize: 26, fontWeight: '800', lineHeight: 28 },
  identity: { gap: 6 },
  eyebrow: {
    color: PROGRESS_GREEN,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  title: { color: NAVY, fontSize: 30, lineHeight: 35, fontWeight: '800', letterSpacing: -0.7 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
  },
  rowText: { gap: 2, flex: 1 },
  rowTitle: { color: NAVY, fontSize: 16, lineHeight: 21, fontWeight: '800' },
  rowSub: { color: TEXT_MUTED, fontSize: 12.5, lineHeight: 17 },
  chevron: { color: INK_QUIET, fontSize: 20, fontWeight: '700' },
});
