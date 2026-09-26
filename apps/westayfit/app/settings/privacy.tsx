import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useWsfAuth } from '../../src/auth';
import { CommunityPrivacyControls } from '../../src/ui/CommunityPrivacyControls';
import { NAVY, PROGRESS_GREEN, CREAM, TEXT_MUTED } from '../../src/ui/kit';
import { MEMBER_TAB_BAR_BODY } from '../../src/ui/MemberTabBar';

/**
 * PRIVACY — how you appear in each of your communities.
 *
 * PER COMMUNITY, NOT PER ACCOUNT. Somebody glad to be named among the people
 * they train with on Tuesday has said nothing about a group they joined once.
 * A member may be visible at church and private at work, and the storage is per
 * membership row for exactly that reason.
 *
 * THE COMMUNITY IS THE HEADING AND THE CONTROLS SIT UNDER IT. Inverting that —
 * two global toggles each containing a list of communities — is what turns a
 * settings screen into a policy console. The controls are visually subordinate
 * to the community they belong to.
 *
 * COMMUNITY-VISIBLE BY DEFAULT, AND THE COPY SAYS SO PLAINLY. Both toggles
 * start on, because a missing stored preference resolves to visible inside the
 * community. What "visible" means is bounded and stated at the foot of the
 * page: other signed-in members of that community, and nowhere else — never the
 * open web, never a public display, never a kiosk.
 *
 * WHAT IS RENDERED IS WHAT IS STORED. `wsfSetCommunityVisibility` returns the
 * SETTLED value rather than an echo of the request, and this page adopts that
 * response. An optimistic switch that disagreed with the server would be a
 * member believing they are private when they are not — the one failure mode
 * this screen must never have. On failure it puts the switch back.
 */


export default function PrivacySettingsScreen() {
  const { user, ready } = useWsfAuth();
  useEffect(() => {
    if (ready && !user) router.replace('/');
  }, [ready, user]);

  return (
    <ScrollView style={st.screen} contentContainerStyle={st.body} testID="wsf-privacy-screen">
      <View style={st.chrome}>
        <Pressable
          onPress={() => router.replace('/settings')}
          accessibilityRole="link"
          accessibilityLabel="Back to Settings"
          testID="wsf-privacy-back"
        >
          <Text style={st.back}>‹</Text>
        </Pressable>
        <Text style={st.chromeTitle}>Settings</Text>
      </View>

      <View style={st.identity}>
        <Text style={st.eyebrow}>Privacy</Text>
        <Text style={st.title}>Community visibility</Text>
        <Text style={st.sub}>You choose this for each community separately.</Text>
      </View>

      {/* COMMUNITY-SETTINGS-PARITY-1: the same controls the Settings panel
          draws (src/ui/CommunityPrivacyControls.tsx), including W7 Check 43's
          failure behaviour. */}
      <CommunityPrivacyControls />
    </ScrollView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CREAM },
  body: { paddingHorizontal: 20, paddingTop: 14, gap: 12, paddingBottom: MEMBER_TAB_BAR_BODY },
  chrome: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { color: NAVY, fontSize: 26, fontWeight: '800', lineHeight: 28 },
  chromeTitle: { color: TEXT_MUTED, fontSize: 12.5, fontWeight: '700' },
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
  sub: { color: TEXT_MUTED, fontSize: 12.5, lineHeight: 17 },
});
