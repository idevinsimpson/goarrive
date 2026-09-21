import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  EventChooseActivityTarget,
  EventChosenTarget,
  EventDeviceChoiceTarget,
  EventDeviceSharedTarget,
  EventErrorTarget,
  EventJoiningTarget,
  EventNamePanelTarget,
  EventNoActivitiesTarget,
  EventNotMemberTarget,
  EventQueueErrorTarget,
  EventSignedOutTarget,
  QueueActiveTarget,
  QueueCalledTarget,
  QueueErrorTarget,
  QueueLoadingTarget,
  QueueNotInLineTarget,
  QueueReadyTarget,
  QueueReceiptTarget,
  QueueRecordErrorTarget,
  QueueRecordedTarget,
  QueueSignedOutTarget,
  QueueTellingTarget,
  QueueTimedOutTarget,
  QueueWaitingTarget,
} from '../../src/ui/designTarget/EventQueueTargets';

/**
 * ATLAS BATCH D, BEHIND THE SAME GATE AS THE OTHER TARGET ROUTES.
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
    key: 'd1-event',
    route: '/event/[goalId]',
    title: 'D1 — standing in the room',
    screens: [
      { id: 'event-device-choice', label: 'Whose screen is this?', tone: 'action required', node: <EventDeviceChoiceTarget /> },
      { id: 'event-device-shared', label: 'Shared screen', tone: 'action required', node: <EventDeviceSharedTarget /> },
      { id: 'event-signed-out', label: 'Signed out', tone: 'action required', node: <EventSignedOutTarget /> },
      { id: 'event-not-member', label: 'Not in the community', tone: 'refused', node: <EventNotMemberTarget /> },
      { id: 'event-choose-activity', label: 'Decision one only', tone: 'ordinary', node: <EventChooseActivityTarget /> },
      { id: 'event-chosen', label: 'Chosen — two ways on', tone: 'ordinary', node: <EventChosenTarget /> },
      { id: 'event-name-panel', label: 'What should it call you?', tone: 'ordinary', node: <EventNamePanelTarget /> },
      { id: 'event-joining', label: 'Getting in line', tone: 'working', node: <EventJoiningTarget /> },
      { id: 'event-queue-error', label: 'Could not get in line', tone: 'error', node: <EventQueueErrorTarget /> },
      { id: 'event-no-activities', label: 'Nothing to choose', tone: 'error', node: <EventNoActivitiesTarget /> },
      { id: 'event-error', label: 'Could not load', tone: 'error', node: <EventErrorTarget /> },
    ],
  },
  {
    key: 'd2-queue',
    route: '/queue/[goalId]',
    title: 'D2 — waiting, being called, finishing',
    screens: [
      { id: 'queue-waiting', label: '3rd in line', tone: 'live', node: <QueueWaitingTarget /> },
      { id: 'queue-called', label: 'Called · 45s', tone: 'now', node: <QueueCalledTarget /> },
      { id: 'queue-telling', label: 'Telling them', tone: 'working', node: <QueueTellingTarget /> },
      { id: 'queue-ready', label: 'Place held · walk over', tone: 'live', node: <QueueReadyTarget /> },
      { id: 'queue-active', label: 'Turn running', tone: 'live', node: <QueueActiveTarget /> },
      { id: 'queue-record-error', label: 'Number refused', tone: 'error', node: <QueueRecordErrorTarget /> },
      { id: 'queue-recorded', label: 'Recorded', tone: 'counted', node: <QueueRecordedTarget /> },
      { id: 'queue-receipt', label: 'Your last turn here', tone: 'counted', node: <QueueReceiptTarget /> },
      { id: 'queue-timed-out', label: 'Timed out', tone: 'quiet', node: <QueueTimedOutTarget /> },
      { id: 'queue-not-in-line', label: 'Not in the line', tone: 'quiet', node: <QueueNotInLineTarget /> },
      { id: 'queue-signed-out', label: 'Signed out', tone: 'action required', node: <QueueSignedOutTarget /> },
      { id: 'queue-error', label: 'Could not check', tone: 'error', node: <QueueErrorTarget /> },
      { id: 'queue-loading', label: 'Checking your place', tone: 'working', node: <QueueLoadingTarget /> },
    ],
  },
];

const CLASSES = [
  { key: '390x844', width: 390, height: 844 },
  { key: '390x640', width: 390, height: 640 },
  { key: '430x932', width: 430, height: 932 },
];

export default function EventQueueTargetPreview() {
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
    <ScrollView contentContainerStyle={st.page} testID="wsf-target-event-queue-batch">
      <View style={st.banner}>
        <Text style={st.bannerText}>
          TARGET / CONCEPT — NOT IMPLEMENTED · ATLAS BATCH D · THE EVENT AND THE LINE, ON YOUR OWN PHONE
        </Text>
      </View>

      <View style={st.contact} testID="wsf-contact-batch-d">
        <Text style={st.contactTitle}>Atlas Batch D — the event and the line</Text>
        <Text style={st.contactSub}>
          TARGET / CONCEPT — NOT IMPLEMENTED · two destinations, twenty-four states · 390×844
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
                      testID={`wsf-frame-d-${sc.id}-${c.key}`}
                    >
                      <View style={st.frameBanner} testID={`wsf-frame-banner-d-${sc.id}-${c.key}`}>
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
