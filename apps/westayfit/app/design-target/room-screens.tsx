import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  KioskClosedTarget,
  KioskConfirmedTarget,
  KioskEntryTarget,
  KioskFinishErrorTarget,
  KioskFinishingTarget,
  KioskLiveTarget,
  KioskLoadingTarget,
  KioskNotAvailableTarget,
  KioskRefusedTarget,
  KioskSignInTarget,
  KioskStaleTarget,
  KioskUnreachableTarget,
  KioskUnresolvedTarget,
  StationAttractTarget,
  StationCalledTarget,
  StationClearedTarget,
  StationLoadingTarget,
  StationNotAvailableTarget,
  StationPairingClaimingTarget,
  StationPairingExpiredTarget,
  StationPairingFailedTarget,
  StationPairingRequestingTarget,
  StationPairingWaitingTarget,
  StationQueueErrorTarget,
  StationRecordedTarget,
  StationRunningTarget,
  StationStaleTarget,
  StationUnreachableTarget,
} from '../../src/ui/designTarget/RoomScreenTargets';

/**
 * ATLAS BATCH E, BEHIND THE SAME GATE AS THE OTHER TARGET ROUTES.
 *
 * Renders only when the build carries EXPO_PUBLIC_WSF_USE_EMULATORS, which
 * scripts/westayfit/build-staging.sh refuses. No deployed artifact can serve
 * this route.
 *
 * TWO DEVICE CLASSES, ONE PER GROUP, because that is how these are installed:
 * a kiosk is a portrait tablet on a stand and a station is a landscape tablet
 * beside a mat. Drawing either at the other's aspect would be drawing a device
 * nobody has.
 */
function previewAllowed(): boolean {
  const raw = process.env.EXPO_PUBLIC_WSF_USE_EMULATORS;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true';
}

const FRAME_BANNER = 22;

type Screen = { id: string; label: string; tone: string; node: React.ReactNode };
type Group = {
  key: string;
  route: string;
  title: string;
  width: number;
  height: number;
  className: string;
  screens: Screen[];
};

const GROUPS: Group[] = [
  {
    key: 'e1-kiosk',
    route: '/kiosk/[goalId]',
    title: 'E1 — the kiosk start screen',
    width: 800,
    height: 1280,
    className: '800x1280',
    screens: [
      { id: 'kiosk-live', label: 'Live', tone: 'live', node: <KioskLiveTarget /> },
      { id: 'kiosk-stale', label: 'Last confirmed', tone: 'quiet', node: <KioskStaleTarget /> },
      { id: 'kiosk-closed', label: 'Reached and closed', tone: 'live', node: <KioskClosedTarget /> },
      { id: 'kiosk-loading', label: 'Loading', tone: 'working', node: <KioskLoadingTarget /> },
      { id: 'kiosk-unreachable', label: 'Connection interrupted', tone: 'error', node: <KioskUnreachableTarget /> },
      { id: 'kiosk-not-available', label: 'Nothing to show (3 causes)', tone: 'refused', node: <KioskNotAvailableTarget /> },
    ],
  },
  {
    key: 'e2-kiosk-contribute',
    route: '/contribute/[goalId]?kiosk=1',
    title: 'E2 — contributing at the kiosk',
    width: 800,
    height: 1280,
    className: '800x1280',
    screens: [
      { id: 'kiosk-signin', label: 'Sign in (the ordinary one)', tone: 'action required', node: <KioskSignInTarget /> },
      { id: 'kiosk-entry', label: 'Enter what you counted', tone: 'ordinary', node: <KioskEntryTarget /> },
      { id: 'kiosk-confirmed', label: 'Counted · Finish · 90s', tone: 'counted', node: <KioskConfirmedTarget /> },
      { id: 'kiosk-refused', label: 'Not added', tone: 'error', node: <KioskRefusedTarget /> },
      { id: 'kiosk-unresolved', label: 'Not confirmed · kept', tone: 'quiet', node: <KioskUnresolvedTarget /> },
      { id: 'kiosk-finishing', label: 'Finishing', tone: 'working', node: <KioskFinishingTarget /> },
      { id: 'kiosk-finish-error', label: 'Sign-out failed', tone: 'error', node: <KioskFinishErrorTarget /> },
    ],
  },
  {
    key: 'e3-station',
    route: '/station/[goalId]',
    title: 'E3 — the station beside the mat',
    width: 1280,
    height: 800,
    className: '1280x800',
    screens: [
      { id: 'station-pairing-requesting', label: 'Getting a code', tone: 'working', node: <StationPairingRequestingTarget /> },
      { id: 'station-pairing-waiting', label: 'Waiting to be paired', tone: 'action required', node: <StationPairingWaitingTarget /> },
      { id: 'station-pairing-claiming', label: 'Pairing', tone: 'working', node: <StationPairingClaimingTarget /> },
      { id: 'station-pairing-expired', label: 'Code expired', tone: 'refused', node: <StationPairingExpiredTarget /> },
      { id: 'station-pairing-failed', label: 'Pairing failed', tone: 'error', node: <StationPairingFailedTarget /> },
      { id: 'station-attract', label: 'Attract · two QRs', tone: 'live', node: <StationAttractTarget /> },
      { id: 'station-called', label: 'Called · name largest', tone: 'now', node: <StationCalledTarget /> },
      { id: 'station-running', label: 'Turn running · two columns', tone: 'live', node: <StationRunningTarget /> },
      { id: 'station-recorded', label: 'Recorded · NO NAME', tone: 'counted', node: <StationRecordedTarget /> },
      { id: 'station-cleared', label: 'Cleared · nothing left', tone: 'quiet', node: <StationClearedTarget /> },
      { id: 'station-stale', label: 'Last confirmed', tone: 'quiet', node: <StationStaleTarget /> },
      { id: 'station-queue-error', label: 'Line failed, total did not', tone: 'error', node: <StationQueueErrorTarget /> },
      { id: 'station-loading', label: 'Loading', tone: 'working', node: <StationLoadingTarget /> },
      { id: 'station-unreachable', label: 'Connection interrupted', tone: 'error', node: <StationUnreachableTarget /> },
      { id: 'station-not-available', label: 'Nothing to show (3 causes)', tone: 'refused', node: <StationNotAvailableTarget /> },
    ],
  },
];

export default function RoomScreenTargetPreview() {
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
    <ScrollView contentContainerStyle={st.page} testID="wsf-target-room-screens-batch">
      <View style={st.banner}>
        <Text style={st.bannerText}>
          TARGET / CONCEPT — NOT IMPLEMENTED · ATLAS BATCH E · THE SCREENS IN THE ROOM
        </Text>
      </View>

      <View style={st.contact} testID="wsf-contact-batch-e">
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
        <View style={st.contactStrip} testID={`wsf-contact-strip-${'wsf-contact-batch-e'}`}>
          <Text style={st.contactStripText}>TARGET / CONCEPT — NOT IMPLEMENTED</Text>
        </View>
        <Text style={st.contactTitle}>Atlas Batch E — the screens in the room</Text>
        <Text style={st.contactSub}>
          TARGET / CONCEPT — NOT IMPLEMENTED · three destinations, twenty-eight states ·
          800×1280 portrait and 1280×800 landscape
        </Text>
        {GROUPS.map((g) => (
          <View key={g.key} style={st.contactGroup}>
            <View style={st.contactGroupHead}>
              <Text style={st.contactGroupTitle}>{g.title}</Text>
              <Text style={st.contactGroupRoute}>{g.route}</Text>
              <Text style={st.contactGroupCount}>
                {g.screens.length} states · {g.className}
              </Text>
            </View>
            <View style={st.contactGrid}>
              {g.screens.map((sc) => (
                <View key={sc.id} style={[st.contactCell, { width: g.width / 2 }]}>
                  <View style={st.contactCaption}>
                    <Text style={st.contactCaptionText}>{sc.label}</Text>
                    <Text style={st.contactTone}>{sc.tone}</Text>
                  </View>
                  {/*
                    Half scale in the contact sheet, so a wall of tablets fits
                    on one sheet. The per-class frames below are full size.
                  */}
                  <View style={[st.contactFrame, { width: g.width / 2, height: g.height / 2 }]}>
                    <View
                      style={{
                        width: g.width,
                        height: g.height,
                        transform: [{ scale: 0.5 }, { translateX: -g.width / 2 }, { translateY: -g.height / 2 }],
                      }}
                    >
                      {sc.node}
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>

      {GROUPS.map((g) => (
        <View key={`full-${g.key}`} style={st.row}>
          <Text style={st.rowTitle}>
            {g.title} · {g.route} · {g.className}
          </Text>
          <View style={st.grid}>
            {g.screens.map((sc) => (
              <View key={`${sc.id}-full`} style={[st.cell, { width: g.width }]}>
                <Text style={st.cellLabel}>
                  {sc.label} · {g.className}
                </Text>
                <View
                  style={[st.frame, { width: g.width, height: g.height + FRAME_BANNER }]}
                  testID={`wsf-frame-e-${sc.id}-${g.className}`}
                >
                  <View style={st.frameBanner} testID={`wsf-frame-banner-e-${sc.id}-${g.className}`}>
                    <Text style={st.frameBannerText}>TARGET / CONCEPT — NOT IMPLEMENTED</Text>
                  </View>
                  <View style={{ width: g.width, height: g.height }}>{sc.node}</View>
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
  contactCell: { gap: 5 },
  contactCaption: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  contactCaptionText: { color: '#0B1F3A', fontSize: 12, fontWeight: '900', flexShrink: 1, minWidth: 0 },
  contactTone: { color: '#6B7C93', fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  contactFrame: {
    overflow: 'hidden',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#B9B4A9',
    backgroundColor: '#0B1F3A',
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
    backgroundColor: '#0B1F3A',
  },
  frameBanner: {
    height: FRAME_BANNER,
    backgroundColor: '#22C55E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameBannerText: { color: '#04260F', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
});
