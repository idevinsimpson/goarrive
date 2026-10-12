import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  CommunityPresenceTarget,
  MembersTarget,
  SettingsPrivacyTarget,
  YouSettingsEntryTarget,
} from '../../src/ui/designTarget/CommunityPresenceTargets';

/**
 * THE COMMUNITY-PRESENCE TARGETS, BEHIND THE SAME GATE AS THE OTHERS.
 *
 * Each cell is a real device-sized frame rendering the real component, so the
 * capture is of the thing itself rather than a thumbnail of a drawing.
 *
 * THE STRIP SAYS "PROPOSED — NOT ACCEPTED", not "TARGET / CONCEPT — NOT
 * IMPLEMENTED". The existing producers draw against targets the Director has
 * already accepted; nothing in this package has been reviewed, and a frame
 * that circulates on its own must not borrow the settled wording of one that
 * has. No accepted frame or producer is edited by this file — every frame id
 * here is new.
 */
function previewAllowed(): boolean {
  const raw = process.env.EXPO_PUBLIC_WSF_USE_EMULATORS;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true';
}

type Frame = { id: string; label: string; width: number; height: number; node: React.ReactNode };

const P = { w: 390, h: 844 };
const SHORT = { w: 390, h: 640 };

const FRAMES: Frame[] = [
  // ── 1 · community presence ──
  {
    id: 'community-inhabited-390x844',
    label: 'Community · people present, activity today · 390×844',
    width: P.w,
    height: P.h,
    node: <CommunityPresenceTarget state="inhabited" />,
  },
  {
    id: 'community-inhabited-390x640',
    label: 'Community · people present, activity today · 390×640',
    width: SHORT.w,
    height: SHORT.h,
    node: <CommunityPresenceTarget state="inhabited" compact />,
  },
  {
    id: 'community-quiettoday-390x844',
    label: 'Community · nobody has moved yet today · 390×844',
    width: P.w,
    height: P.h,
    node: <CommunityPresenceTarget state="quietToday" />,
  },
  {
    id: 'community-allprivate-390x844',
    label: 'Community · every member private · 390×844',
    width: P.w,
    height: P.h,
    node: <CommunityPresenceTarget state="allPrivate" />,
  },
  {
    id: 'community-small-390x640',
    label: 'Community · three members · 390×640',
    width: SHORT.w,
    height: SHORT.h,
    node: <CommunityPresenceTarget state="small" compact />,
  },

  // ── 2 · members ──
  {
    id: 'members-people-390x844',
    label: 'Members · people, not a table · 390×844',
    width: P.w,
    height: P.h,
    node: <MembersTarget state="people" />,
  },
  {
    id: 'members-people-390x640',
    label: 'Members · people, not a table · 390×640',
    width: SHORT.w,
    height: SHORT.h,
    node: <MembersTarget state="people" compact />,
  },
  {
    id: 'members-allprivate-390x844',
    label: 'Members · nobody listed by name · 390×844',
    width: P.w,
    height: P.h,
    node: <MembersTarget state="allPrivate" />,
  },

  // ── 3 · settings ──
  {
    id: 'settings-privacy-390x844',
    label: 'Settings · community visibility · 390×844',
    width: P.w,
    height: P.h,
    node: <SettingsPrivacyTarget />,
  },
  {
    id: 'settings-privacy-390x640',
    label: 'Settings · community visibility · 390×640',
    width: SHORT.w,
    height: SHORT.h,
    node: <SettingsPrivacyTarget compact />,
  },

  // ── 4 · the way in ──
  {
    id: 'you-settings-entry-390x844',
    label: 'You · the quiet settings entry · 390×844',
    width: P.w,
    height: P.h,
    node: <YouSettingsEntryTarget />,
  },
];

/** The label strip burnt into every captured frame. */
const FRAME_BANNER = 18;
/** The exact words, shared with the capture spec's assertion. */
export const PROPOSED_STRIP = 'PROPOSED — NOT ACCEPTED';

export default function CommunityPresencePreview() {
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
    <ScrollView contentContainerStyle={st.sheet} testID="wsf-target-community-presence-sheet">
      <View style={st.banner}>
        <Text style={st.bannerText}>
          PROPOSED — NOT ACCEPTED · COMMUNITY PRESENCE · W8
        </Text>
      </View>
      <View style={st.grid}>
        {FRAMES.map((f) => (
          <View key={f.id} style={[st.cell, { width: f.width }]}>
            <Text style={st.cellLabel}>{f.label}</Text>
            {/*
              THE LABEL TRAVELS WITH THE FRAME. The page banner above is not in
              these element screenshots, and a proposal that circulates without
              its label is one paste away from being read as an accepted target
              or a shipped screen. The strip is added to the frame's height, so
              the device area below it is still exactly the device class named
              on the label.
            */}
            <View
              style={[st.frame, { width: f.width, height: f.height + FRAME_BANNER }]}
              testID={`wsf-frame-${f.id}`}
            >
              <View style={st.frameBanner} testID={`wsf-frame-banner-${f.id}`}>
                <Text style={st.frameBannerText}>{PROPOSED_STRIP}</Text>
              </View>
              <View style={{ height: f.height }}>{f.node}</View>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  sheet: { backgroundColor: '#D9D5CC', padding: 20, gap: 16 },
  banner: { backgroundColor: '#B45309', paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
  bannerText: { color: '#FFF7ED', fontSize: 11, fontWeight: '900', letterSpacing: 1.6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  cell: { gap: 4 },
  cellLabel: { color: '#0B1F3A', fontSize: 13, fontWeight: '900' },
  frameBanner: {
    height: FRAME_BANNER,
    /*
      AMBER, NOT THE GREEN THE ACCEPTED PRODUCERS USE. Two different claims
      should not wear the same colour: green strips mark frames drawn against
      an accepted target, and this package has not been reviewed at all.
    */
    backgroundColor: '#B45309',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameBannerText: { color: '#FFF7ED', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  frame: {
    overflow: 'hidden',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#B9B4A9',
    backgroundColor: '#F7F5F0',
  },
});
