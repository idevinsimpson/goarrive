import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  StartNextCreatedTarget,
  StartNextNameTooLongTarget,
  StartNextRefusedTarget,
  StartNextUnconfirmedTarget,
} from '../../src/ui/designTarget/JoinSetupTargets';

/**
 * /start-community — THE PROPOSED REFRESH, ON ITS OWN SURFACE.
 *
 * WHY THIS IS NOT FOUR MORE ENTRIES ON `/design-target/join-setup`.
 * That route's contact sheet is one screenshot of the whole registry
 * (`design-target-join-setup-capture.spec.ts` shoots `wsf-contact-batch-b`),
 * so adding a screen to its GROUPS changes an ACCEPTED image the next time
 * anyone regenerates the batch — silently, and in someone else's run. The
 * proposal gets its own page instead. Batch B stays reproducible from its own
 * unchanged sources, and the only thing that moves when this proposal is
 * accepted or dropped is this file.
 *
 * Behind the same gate as every other target route: renders only when the
 * build carries EXPO_PUBLIC_WSF_USE_EMULATORS, which
 * scripts/westayfit/build-staging.sh refuses. No deployed artifact serves it.
 *
 * TWO PHONE CLASSES, not Batch B's three. This is a small checkpoint for a
 * verdict on four states, not a production run; 430×932 is drawn when the
 * states are ruled on.
 */
function previewAllowed(): boolean {
  const raw = process.env.EXPO_PUBLIC_WSF_USE_EMULATORS;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true';
}

const FRAME_BANNER = 18;

type Screen = { id: string; label: string; tone: string; node: React.ReactNode };

const SCREENS: Screen[] = [
  {
    id: 'start-next-name-too-long',
    label: 'Name over the ceiling',
    tone: 'error',
    node: <StartNextNameTooLongTarget />,
  },
  {
    id: 'start-next-refused',
    label: 'Refused · the server answered',
    tone: 'refused',
    node: <StartNextRefusedTarget />,
  },
  {
    id: 'start-next-unconfirmed',
    label: 'Unconfirmed · we do not know',
    tone: 'error',
    node: <StartNextUnconfirmedTarget />,
  },
  {
    id: 'start-next-created',
    label: 'Created · could not open it',
    tone: 'ordinary',
    node: <StartNextCreatedTarget />,
  },
];

const CLASSES = [
  { key: '390x844', width: 390, height: 844 },
  { key: '390x640', width: 390, height: 640 },
] as const;

export default function StartCommunityNextPreview() {
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
    <ScrollView contentContainerStyle={st.page} testID="wsf-target-start-community-next">
      <View style={st.banner}>
        <Text style={st.bannerText}>
          PROPOSED / NOT ACCEPTED · NOT IMPLEMENTED · /start-community · REFUSAL, UNCERTAINTY,
          RECOVERY
        </Text>
      </View>

      <View style={st.contact} testID="wsf-contact-sc-next">
        <View style={st.contactStrip}>
          <Text style={st.contactStripText}>PROPOSED / NOT ACCEPTED — NOT IMPLEMENTED</Text>
        </View>
        <Text style={st.contactTitle}>/start-community — proposed refresh</Text>
        <Text style={st.contactSub}>
          PROPOSED / NOT ACCEPTED · four states · 390×844 · drawings awaiting a verdict
        </Text>
        <View style={st.contactGrid}>
          {SCREENS.map((sc) => (
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
                  testID={`wsf-frame-scnext-${sc.id}-${c.key}`}
                >
                  <View
                    style={st.frameBanner}
                    testID={`wsf-frame-banner-scnext-${sc.id}-${c.key}`}
                  >
                    <Text style={st.frameBannerText}>PROPOSED / NOT ACCEPTED</Text>
                  </View>
                  <View style={{ height: c.height }}>{sc.node}</View>
                </View>
              </View>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

/**
 * The strip is AMBER here, not Batch B's green. Green on every other target
 * page means "this is the target"; these four are a proposal against an
 * accepted target, and a reviewer who sees them next to a Batch B frame should
 * not have to read the words to tell which is which.
 */
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
