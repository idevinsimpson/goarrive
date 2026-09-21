import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  ChallengeAllCountedTarget,
  ChallengeErrorTarget,
  ChallengeLiveTarget,
  ChallengeLoadingTarget,
  ChallengeMoveStatesTarget,
  ChallengeNoneTarget,
  ChallengeNotMemberTarget,
  ChallengeOpenEndedTarget,
  ChallengeReachedTarget,
  ChallengeSignedOutTarget,
  HomeChooseTarget,
  HomeCodeRejectedTarget,
  HomeEmptyTarget,
  HomeListErrorTarget,
  HomeListLoadingTarget,
  HomeOpeningTarget,
  HomeSignedOutTarget,
} from '../../src/ui/designTarget/ChallengeHomeTargets';

/**
 * ATLAS BATCH C, BEHIND THE SAME GATE AS THE OTHER TARGET ROUTES.
 *
 * Renders only when the build carries EXPO_PUBLIC_WSF_USE_EMULATORS, which
 * scripts/westayfit/build-staging.sh refuses. No deployed artifact can serve
 * this route.
 */
function previewAllowed(): boolean {
  const raw = process.env.EXPO_PUBLIC_WSF_USE_EMULATORS;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true';
}

const FRAME_BANNER = 18;

type Screen = { id: string; label: string; tone: string; node: React.ReactNode };
type Group = { key: string; route: string; title: string; screens: Screen[] };

const GROUPS: Group[] = [
  {
    key: 'c1-challenge',
    route: '/community/[groupId]/challenge',
    title: 'C1 — the challenge in the room',
    screens: [
      { id: 'challenge-live', label: 'Live', tone: 'live', node: <ChallengeLiveTarget /> },
      { id: 'challenge-open-ended', label: 'No target set', tone: 'live', node: <ChallengeOpenEndedTarget /> },
      { id: 'challenge-reached', label: 'Target reached, still open', tone: 'live', node: <ChallengeReachedTarget /> },
      { id: 'challenge-all-counted', label: 'You’ve done all of them', tone: 'live', node: <ChallengeAllCountedTarget /> },
      { id: 'challenge-move-states', label: 'Move card · all six states', tone: 'reference', node: <ChallengeMoveStatesTarget /> },
      { id: 'challenge-none', label: 'No challenge (also: finished)', tone: 'quiet', node: <ChallengeNoneTarget /> },
      { id: 'challenge-not-member', label: 'Not a member', tone: 'refused', node: <ChallengeNotMemberTarget /> },
      { id: 'challenge-signed-out', label: 'Signed out', tone: 'action required', node: <ChallengeSignedOutTarget /> },
      { id: 'challenge-error', label: 'Could not load', tone: 'error', node: <ChallengeErrorTarget /> },
      { id: 'challenge-loading', label: 'Loading', tone: 'working', node: <ChallengeLoadingTarget /> },
    ],
  },
  {
    key: 'c2-home',
    route: '/',
    title: 'C2 — the home resolver',
    screens: [
      { id: 'home-signed-out', label: 'Signed out', tone: 'ordinary', node: <HomeSignedOutTarget /> },
      { id: 'home-opening', label: 'Opening your community', tone: 'working', node: <HomeOpeningTarget /> },
      { id: 'home-choose', label: 'Several, none chosen', tone: 'ordinary', node: <HomeChooseTarget /> },
      { id: 'home-empty', label: 'Not in a community yet', tone: 'ordinary', node: <HomeEmptyTarget /> },
      { id: 'home-code-rejected', label: 'Code does not look valid', tone: 'error', node: <HomeCodeRejectedTarget /> },
      { id: 'home-my-loading', label: 'Loading your communities', tone: 'working', node: <HomeListLoadingTarget /> },
      { id: 'home-my-error', label: 'List failed, ways in remain', tone: 'error', node: <HomeListErrorTarget /> },
    ],
  },
];

const CLASSES = [
  { key: '390x844', width: 390, height: 844 },
  { key: '390x640', width: 390, height: 640 },
  { key: '430x932', width: 430, height: 932 },
];

export default function ChallengeHomeTargetPreview() {
  if (!previewAllowed()) {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
        <Text style={{ fontSize: 16, lineHeight: 22 }}>
          Design-target previews are not part of this build.
        </Text>
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={st.page} testID="wsf-target-challenge-home-batch">
      <View style={st.banner}>
        <Text style={st.bannerText}>
          TARGET / CONCEPT — NOT IMPLEMENTED · ATLAS BATCH C · THE CHALLENGE, AND THE DOOR
        </Text>
      </View>

      <View style={st.contact} testID="wsf-contact-batch-c">
        <Text style={st.contactTitle}>Atlas Batch C — the challenge, and the door</Text>
        <Text style={st.contactSub}>
          TARGET / CONCEPT — NOT IMPLEMENTED · two destinations, seventeen states · 390×844
        </Text>
        {GROUPS.map((g) => (
          <View key={g.key} style={st.contactGroup}>
            <View style={st.contactGroupHead}>
              <Text style={st.contactGroupTitle}>{g.title}</Text>
              <Text style={st.contactGroupRoute}>{g.route}</Text>
              <Text style={st.contactGroupCount}>{g.screens.length} states</Text>
            </View>
            <View style={st.contactGrid}>
              {g.screens.map((sc) => (
                <View key={sc.id} style={st.contactCell}>
                  <View style={st.contactCaption}>
                    <Text style={st.contactCaptionText}>{sc.label}</Text>
                    <Text style={st.contactTone}>{sc.tone}</Text>
                  </View>
                  <View style={st.contactFrame}>{sc.node}</View>
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>

      {CLASSES.map((c) => (
        <View key={c.key} style={st.row}>
          <Text style={st.rowTitle}>{c.key}</Text>
          {GROUPS.map((g) => (
            <View key={`${g.key}-${c.key}`} style={st.rowGroup}>
              <Text style={st.rowGroupTitle}>
                {g.title} · {g.route}
              </Text>
              <View style={st.grid}>
                {g.screens.map((sc) => (
                  <View key={`${sc.id}-${c.key}`} style={[st.cell, { width: c.width }]}>
                    <Text style={st.cellLabel}>
                      {sc.label} · {c.key}
                    </Text>
                    <View
                      style={[st.frame, { width: c.width, height: c.height + FRAME_BANNER }]}
                      testID={`wsf-frame-c-${sc.id}-${c.key}`}
                    >
                      <View style={st.frameBanner} testID={`wsf-frame-banner-c-${sc.id}-${c.key}`}>
                        <Text style={st.frameBannerText}>TARGET / CONCEPT — NOT IMPLEMENTED</Text>
                      </View>
                      <View style={{ height: c.height }}>{sc.node}</View>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  page: { backgroundColor: '#D9D5CC', padding: 20, gap: 20 },
  banner: { backgroundColor: '#22C55E', paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
  bannerText: { color: '#04260F', fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },

  contact: { backgroundColor: '#F7F5F0', borderRadius: 16, padding: 18, gap: 4 },
  contactTitle: { color: '#0B1F3A', fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  contactSub: { color: '#6B7C93', fontSize: 12, fontWeight: '700', marginBottom: 12 },
  contactGroup: { gap: 8, marginBottom: 18 },
  contactGroupHead: { flexDirection: 'row', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' },
  contactGroupTitle: { color: '#0B1F3A', fontSize: 15, fontWeight: '900' },
  contactGroupRoute: { color: '#6B7C93', fontSize: 12, fontWeight: '700' },
  contactGroupCount: { color: '#6B7C93', fontSize: 11, fontWeight: '800' },
  contactGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  contactCell: { width: 390, gap: 5 },
  contactCaption: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  contactCaptionText: { color: '#0B1F3A', fontSize: 13, fontWeight: '900' },
  contactTone: { color: '#6B7C93', fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  contactFrame: {
    width: 390,
    height: 844,
    overflow: 'hidden',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#B9B4A9',
    backgroundColor: '#F7F5F0',
  },

  row: { gap: 12 },
  rowTitle: { color: '#0B1F3A', fontSize: 15, fontWeight: '900' },
  rowGroup: { gap: 8 },
  rowGroupTitle: { color: '#0B1F3A', fontSize: 13, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  cell: { gap: 4 },
  cellLabel: { color: '#0B1F3A', fontSize: 13, fontWeight: '900' },
  frame: {
    overflow: 'hidden',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#B9B4A9',
    backgroundColor: '#F7F5F0',
  },
  frameBanner: {
    height: FRAME_BANNER,
    backgroundColor: '#22C55E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameBannerText: { color: '#04260F', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
});
