import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  CombinedClosedTarget,
  CombinedSetupFailedTarget,
  CombinedSetupReadyTarget,
  CombinedSetupShortTarget,
  CombinedSetupWorkingTarget,
  CombinedLiveTarget,
  CombinedNothingTarget,
  CombinedStaleTarget,
  CombinedUnreachableTarget,
  GoalCustomWindowTarget,
  GoalErrorsTarget,
  GoalFailedTarget,
  GoalFormTarget,
  GoalLiveTarget,
  GoalNoCommunityTarget,
  GoalUnavailableTarget,
  GoalWorkingTarget,
  JoinDeviceChoiceTarget,
  JoinDeviceSharedTarget,
  JoinFailedTarget,
  JoinLoadFailedTarget,
  JoinLoadingTarget,
  JoinNotValidTarget,
  JoinSignedInTarget,
  JoinSignedOutTarget,
  JoinTooManyTarget,
  JoinWorkingTarget,
  StartFailedTarget,
  StartFamilyTarget,
  StartNameMissingTarget,
  StartOtherTarget,
  StartSignInTarget,
  StartVerifyTarget,
  StartWorkingTarget,
} from '../../src/ui/designTarget/JoinSetupTargets';

/**
 * ATLAS BATCH B, BEHIND THE SAME GATE AS THE OTHER TARGET ROUTES.
 *
 * Renders only when the build carries EXPO_PUBLIC_WSF_USE_EMULATORS, which
 * scripts/westayfit/build-staging.sh refuses. No deployed artifact can serve
 * this route.
 *
 * Every frame carries its label INSIDE the frame, and the strip is added to
 * the frame's height so the device area beneath it is exactly the class the
 * filename names.
 *
 * THREE PHONE CLASSES, not Batch A's two. 430x932 is in the atlas's device
 * list and Batch A did not draw it; every batch from here on does, so the
 * widest phone stops being a thing we assume works.
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

/**
 * The tones are the same four Batch A established, plus `live` for the two
 * screens that report a confirmed number. A tone is how the state reads before
 * the words do; it is not decoration and it is not a severity scale.
 */
const GROUPS: Group[] = [
  {
    key: 'b1-join',
    route: '/join/[joinCode]',
    title: 'B1 — the invitation',
    screens: [
      { id: 'join-invite-out', label: 'Invitation · signed out', tone: 'ordinary', node: <JoinSignedOutTarget /> },
      { id: 'join-invite-in', label: 'Invitation · signed in', tone: 'ordinary', node: <JoinSignedInTarget /> },
      { id: 'join-working', label: 'Joining', tone: 'working', node: <JoinWorkingTarget /> },
      { id: 'join-failed', label: 'Join failed', tone: 'error', node: <JoinFailedTarget /> },
      { id: 'join-loading', label: 'Loading the invitation', tone: 'working', node: <JoinLoadingTarget /> },
      { id: 'join-not-valid', label: 'Not valid (also: private)', tone: 'refused', node: <JoinNotValidTarget /> },
      { id: 'join-too-many', label: 'Too many requests', tone: 'refused', node: <JoinTooManyTarget /> },
      { id: 'join-load-failed', label: 'Could not load', tone: 'error', node: <JoinLoadFailedTarget /> },
      { id: 'join-device-choice', label: 'Whose screen is this?', tone: 'action required', node: <JoinDeviceChoiceTarget /> },
      { id: 'join-device-shared', label: 'Shared screen', tone: 'action required', node: <JoinDeviceSharedTarget /> },
    ],
  },
  {
    key: 'b2-start',
    route: '/start-community',
    title: 'B2 — starting a community',
    screens: [
      { id: 'start-form', label: 'Family & friends (private)', tone: 'ordinary', node: <StartFamilyTarget /> },
      { id: 'start-form-other', label: 'Other community (link)', tone: 'ordinary', node: <StartOtherTarget /> },
      { id: 'start-name-missing', label: 'Name missing', tone: 'error', node: <StartNameMissingTarget /> },
      { id: 'start-working', label: 'Creating', tone: 'working', node: <StartWorkingTarget /> },
      { id: 'start-failed', label: 'Create failed', tone: 'error', node: <StartFailedTarget /> },
      { id: 'start-signin', label: 'Sign in first', tone: 'action required', node: <StartSignInTarget /> },
      { id: 'start-verify', label: 'Verify email first', tone: 'action required', node: <StartVerifyTarget /> },
    ],
  },
  {
    key: 'b3-goal',
    route: '/goals/new',
    title: 'B3 — opening a goal',
    screens: [
      { id: 'goal-form', label: 'The four decisions', tone: 'ordinary', node: <GoalFormTarget /> },
      { id: 'goal-custom-window', label: 'Custom window', tone: 'ordinary', node: <GoalCustomWindowTarget /> },
      { id: 'goal-errors', label: 'Field errors', tone: 'error', node: <GoalErrorsTarget /> },
      { id: 'goal-working', label: 'Opening', tone: 'working', node: <GoalWorkingTarget /> },
      { id: 'goal-failed', label: 'Open failed', tone: 'error', node: <GoalFailedTarget /> },
      { id: 'goal-live', label: 'Your goal is live', tone: 'live', node: <GoalLiveTarget /> },
      { id: 'goal-unavailable', label: 'Not available here', tone: 'refused', node: <GoalUnavailableTarget /> },
      { id: 'goal-no-community', label: 'No community yet', tone: 'refused', node: <GoalNoCommunityTarget /> },
    ],
  },
  {
    key: 'b3b-combined-setup',
    route: 'combined-goal setup (on Community Home today)',
    title: 'B3b — setting up a combined goal',
    screens: [
      { id: 'combined-setup-short', label: 'One picked — floor stated', tone: 'ordinary', node: <CombinedSetupShortTarget /> },
      { id: 'combined-setup-ready', label: 'Three picked — ready', tone: 'ordinary', node: <CombinedSetupReadyTarget /> },
      { id: 'combined-setup-working', label: 'Starting', tone: 'working', node: <CombinedSetupWorkingTarget /> },
      { id: 'combined-setup-failed', label: 'Could not start', tone: 'error', node: <CombinedSetupFailedTarget /> },
    ],
  },
  {
    key: 'b4-combined',
    route: '/combined/[setupId]',
    title: 'B4 — watching a combined goal',
    screens: [
      { id: 'combined-live', label: 'Live', tone: 'live', node: <CombinedLiveTarget /> },
      { id: 'combined-closed', label: 'Reached and closed', tone: 'live', node: <CombinedClosedTarget /> },
      { id: 'combined-stale', label: 'Last confirmed total', tone: 'working', node: <CombinedStaleTarget /> },
      { id: 'combined-unreachable', label: 'Connection interrupted', tone: 'error', node: <CombinedUnreachableTarget /> },
      { id: 'combined-nothing', label: 'Nothing to show (3 causes)', tone: 'refused', node: <CombinedNothingTarget /> },
    ],
  },
];

const CLASSES = [
  { key: '390x844', width: 390, height: 844 },
  { key: '390x640', width: 390, height: 640 },
  { key: '430x932', width: 430, height: 932 },
];

export default function JoinSetupTargetPreview() {
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
    <ScrollView contentContainerStyle={st.page} testID="wsf-target-join-setup-batch">
      <View style={st.banner}>
        <Text style={st.bannerText}>
          TARGET / CONCEPT — NOT IMPLEMENTED · ATLAS BATCH B · THE INVITATION AND WHAT A CHAMPION
          STARTS
        </Text>
      </View>

      {/* THE CONTACT SHEET. All thirty, grouped by destination, at 390x844. */}
      <View style={st.contact} testID="wsf-contact-batch-b">
        {/*
          THE CONTACT SHEET CARRIES THE LABEL TOO.

          Every framed state already had the green strip inside it; the
          contact sheet did not, because it is a card of frames rather
          than a frame. That left exactly one file per package whose top
          band was the page ground — and twice now a review has opened a
          package, found a file with no strip, and reported the frames as
          unlabelled. Arguing about which file was opened is worth less
          than removing the ambiguity, so now no file in any package is
          without it.
        */}
        <View style={st.contactStrip} testID={`wsf-contact-strip-${'wsf-contact-batch-b'}`}>
          <Text style={st.contactStripText}>TARGET / CONCEPT — NOT IMPLEMENTED</Text>
        </View>
        <Text style={st.contactTitle}>Atlas Batch B — join, start, open, watch</Text>
        <Text style={st.contactSub}>
          TARGET / CONCEPT — NOT IMPLEMENTED · five destinations, thirty-four states · 390×844
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

      {/* The per-class frames the capture spec screenshots one by one. */}
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
                      testID={`wsf-frame-b-${sc.id}-${c.key}`}
                    >
                      <View style={st.frameBanner} testID={`wsf-frame-banner-b-${sc.id}-${c.key}`}>
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

  contact: {
    backgroundColor: '#F7F5F0',
    borderRadius: 16,
    overflow: 'hidden',
    gap: 4,
    paddingHorizontal: 18,
    paddingBottom: 18,
  },
  /** Bleeds to the card's edges, so it reads as a label on the sheet. */
  contactStrip: {
    marginHorizontal: -18,
    backgroundColor: '#22C55E',
    paddingVertical: 7,
    alignItems: 'center',
    marginBottom: 12,
  },
  contactStripText: { color: '#04260F', fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
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
