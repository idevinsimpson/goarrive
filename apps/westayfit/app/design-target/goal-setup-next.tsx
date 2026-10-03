import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  GoalNextCreatedTarget,
  GoalNextCustomWindowTarget,
  GoalNextFormTopTarget,
  GoalNextRefusedTarget,
  GoalNextSummaryCommitTarget,
  GoalNextUnconfirmedTarget,
} from '../../src/ui/designTarget/GoalSetupNextTargets';

/**
 * /goals/new — THE PROPOSED CHAMPION SETUP EXPERIENCE, ON ITS OWN SURFACE.
 *
 * WHY THIS IS NOT SIX MORE ENTRIES ON AN EXISTING TARGET ROUTE. Every other
 * design-target page shoots its whole registry into one accepted contact
 * sheet, so adding a screen to one of them rewrites an ACCEPTED image the
 * next time anyone regenerates that batch — silently, and inside somebody
 * else's run. This proposal gets its own page, its own frame ids
 * (`wsf-frame-gsnext-*`) and its own producer. Nothing accepted moves, and
 * the only thing that changes when this proposal is accepted or dropped is
 * this file and its component.
 *
 * Behind the same gate as every other target route: it renders only when the
 * build carries EXPO_PUBLIC_WSF_USE_EMULATORS, which
 * scripts/westayfit/build-staging.sh refuses. No deployed artifact serves it.
 *
 * TWO PHONE CLASSES. 390x844 is the ordinary phone; 390x640 is the short one
 * this form is worst on, because it is the longest form in the product. A
 * 430x932 pass is worth drawing when the hierarchy has a verdict, not before.
 *
 * THE STRIP IS AMBER, matching the other proposal-in-flight page on this
 * sprint. Green strips mean "this is the accepted target"; a reviewer looking
 * at a wall of frames should be able to tell a proposal from an acceptance
 * without reading a word.
 */
function previewAllowed(): boolean {
  const raw = process.env.EXPO_PUBLIC_WSF_USE_EMULATORS;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true';
}

const FRAME_BANNER = 18;

type Screen = {
  id: string;
  label: string;
  tone: string;
  render: (compact: boolean) => React.ReactNode;
};

const SCREENS: Screen[] = [
  {
    id: 'form-top',
    label: 'The form, from the top',
    tone: 'hierarchy',
    render: (compact) => <GoalNextFormTopTarget compact={compact} />,
  },
  {
    id: 'custom-window',
    label: 'Custom · the window stated once',
    tone: 'hierarchy',
    render: (compact) => <GoalNextCustomWindowTarget compact={compact} />,
  },
  {
    id: 'summary-commit',
    label: 'Check it over · and the commit',
    tone: 'commit',
    render: (compact) => <GoalNextSummaryCommitTarget compact={compact} />,
  },
  {
    id: 'refused',
    label: 'Refused · the server answered',
    tone: 'refused',
    render: (compact) => <GoalNextRefusedTarget compact={compact} />,
  },
  {
    id: 'unconfirmed',
    label: 'Unconfirmed · we do not know',
    tone: 'unknown',
    render: (compact) => <GoalNextUnconfirmedTarget compact={compact} />,
  },
  {
    id: 'created',
    label: 'Live · the goal exists',
    tone: 'ordinary',
    render: (compact) => <GoalNextCreatedTarget compact={compact} />,
  },
];

const CLASSES = [
  { key: '390x844', width: 390, height: 844, compact: false },
  { key: '390x640', width: 390, height: 640, compact: true },
] as const;

export default function GoalSetupNextPreview() {
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
    <ScrollView contentContainerStyle={st.page} testID="wsf-target-goal-setup-next">
      <View style={st.banner}>
        <Text style={st.bannerText}>
          PROPOSED / NOT ACCEPTED · NOT IMPLEMENTED · /goals/new · HIERARCHY, COMMIT, OUTCOMES
        </Text>
      </View>

      <View style={st.contact} testID="wsf-contact-gsnext">
        <View style={st.contactStrip}>
          <Text style={st.contactStripText}>PROPOSED / NOT ACCEPTED — NOT IMPLEMENTED</Text>
        </View>
        <Text style={st.contactTitle}>/goals/new — proposed Champion setup</Text>
        <Text style={st.contactSub}>
          PROPOSED / NOT ACCEPTED · six states · 390×844 · drawings awaiting a verdict
        </Text>
        <View style={st.contactGrid}>
          {SCREENS.map((sc) => (
            <View key={sc.id} style={st.contactCell}>
              <View style={st.contactCaption}>
                <Text style={st.contactCaptionText}>{sc.label}</Text>
                <Text style={st.contactTone}>{sc.tone}</Text>
              </View>
              <View style={st.contactFrame}>{sc.render(false)}</View>
            </View>
          ))}
        </View>
      </View>

      {CLASSES.map((c) => (
        <View key={c.key} style={st.row}>
          <Text style={st.rowTitle}>{c.key}</Text>
          <View style={st.grid}>
            {SCREENS.map((sc) => (
              <View key={`${sc.id}-${c.key}`} style={[st.cell, { width: c.width }]}>
                <Text style={st.cellLabel}>
                  {sc.label} · {c.key}
                </Text>
                <View
                  style={[st.frame, { width: c.width, height: c.height + FRAME_BANNER }]}
                  testID={`wsf-frame-gsnext-${sc.id}-${c.key}`}
                >
                  <View style={st.frameBanner} testID={`wsf-frame-banner-gsnext-${sc.id}-${c.key}`}>
                    <Text style={st.frameBannerText}>PROPOSED / NOT ACCEPTED</Text>
                  </View>
                  <View style={{ height: c.height }}>{sc.render(c.compact)}</View>
                </View>
              </View>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  page: { backgroundColor: '#D9D5CC', padding: 20, gap: 20 },
  banner: { backgroundColor: '#F59E0B', paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
  bannerText: { color: '#2B1A00', fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },

  contact: {
    backgroundColor: '#F7F5F0',
    borderRadius: 16,
    overflow: 'hidden',
    gap: 4,
    paddingHorizontal: 18,
    paddingBottom: 18,
  },
  contactStrip: {
    marginHorizontal: -18,
    backgroundColor: '#F59E0B',
    paddingVertical: 7,
    alignItems: 'center',
    marginBottom: 12,
  },
  contactStripText: { color: '#2B1A00', fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  contactTitle: { color: '#0B1F3A', fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  contactSub: { color: '#6B7C93', fontSize: 12, fontWeight: '700', marginBottom: 12 },
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
    backgroundColor: '#F59E0B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameBannerText: { color: '#2B1A00', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
});
