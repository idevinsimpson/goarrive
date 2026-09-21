import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  CommunityDetailTarget,
  CommunityListTarget,
} from '../../src/ui/designTarget/CommunityTargets';

/**
 * THE COMMUNITY TARGETS, BEHIND THE SAME GATE AS THE OTHERS.
 *
 * Each cell is a real device-sized frame rendering the real component, so the
 * capture is of the thing itself rather than a thumbnail of a drawing. The
 * capture spec screenshots each frame by its testID, which is why every frame
 * carries its exact device class in `width` and `height`.
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
const BIG = { w: 430, h: 932 };

const FRAMES: Frame[] = [
  // ── the list ──
  {
    id: 'list-several-390x844',
    label: 'Community list · several memberships · 390×844',
    width: P.w,
    height: P.h,
    node: <CommunityListTarget state="several" />,
  },
  {
    id: 'list-one-390x844',
    label: 'Community list · one membership · 390×844',
    width: P.w,
    height: P.h,
    node: <CommunityListTarget state="one" />,
  },
  {
    id: 'list-none-390x844',
    label: 'Community list · no memberships · 390×844',
    width: P.w,
    height: P.h,
    node: <CommunityListTarget state="none" />,
  },
  {
    id: 'list-loading-390x844',
    label: 'Community list · loading · 390×844',
    width: P.w,
    height: P.h,
    node: <CommunityListTarget state="loading" />,
  },
  {
    id: 'list-failed-390x844',
    label: 'Community list · could not be loaded · 390×844',
    width: P.w,
    height: P.h,
    node: <CommunityListTarget state="failed" />,
  },
  {
    id: 'list-several-390x640',
    label: 'Community list · several · 390×640',
    width: SHORT.w,
    height: SHORT.h,
    node: <CommunityListTarget state="several" />,
  },
  {
    id: 'list-several-430x932',
    label: 'Community list · several · 430×932',
    width: BIG.w,
    height: BIG.h,
    node: <CommunityListTarget state="several" />,
  },

  // ── one community ──
  {
    id: 'detail-active-390x844',
    label: 'Community · goals running · 390×844',
    width: P.w,
    height: P.h,
    node: <CommunityDetailTarget state="active" />,
  },
  {
    id: 'detail-nogoal-390x844',
    label: 'Community · nothing running · 390×844',
    width: P.w,
    height: P.h,
    node: <CommunityDetailTarget state="noGoal" />,
  },
  {
    id: 'detail-history-390x844',
    label: 'Community · what we have done · 390×844',
    width: P.w,
    height: P.h,
    node: <CommunityDetailTarget state="history" />,
  },
  {
    id: 'detail-switch-390x844',
    label: 'Community · switching community · 390×844',
    width: P.w,
    height: P.h,
    node: <CommunityDetailTarget state="switch" />,
  },
  {
    id: 'detail-loading-390x844',
    label: 'Community · loading · 390×844',
    width: P.w,
    height: P.h,
    node: <CommunityDetailTarget state="loading" />,
  },
  {
    id: 'detail-failed-390x844',
    label: 'Community · goals could not be loaded · 390×844',
    width: P.w,
    height: P.h,
    node: <CommunityDetailTarget state="failed" />,
  },
  {
    id: 'detail-active-390x640',
    label: 'Community · goals running · 390×640',
    width: SHORT.w,
    height: SHORT.h,
    node: <CommunityDetailTarget state="active" />,
  },
  {
    id: 'detail-nogoal-390x640',
    label: 'Community · nothing running · 390×640',
    width: SHORT.w,
    height: SHORT.h,
    node: <CommunityDetailTarget state="noGoal" />,
  },
  {
    id: 'detail-history-390x640',
    label: 'Community · what we have done · 390×640',
    width: SHORT.w,
    height: SHORT.h,
    node: <CommunityDetailTarget state="history" />,
  },
  {
    id: 'detail-active-430x932',
    label: 'Community · goals running · 430×932',
    width: BIG.w,
    height: BIG.h,
    node: <CommunityDetailTarget state="active" />,
  },
  {
    id: 'detail-nogoal-430x932',
    label: 'Community · nothing running · 430×932',
    width: BIG.w,
    height: BIG.h,
    node: <CommunityDetailTarget state="noGoal" />,
  },
  {
    id: 'detail-history-430x932',
    label: 'Community · what we have done · 430×932',
    width: BIG.w,
    height: BIG.h,
    node: <CommunityDetailTarget state="history" />,
  },
];

/** The label strip burnt into every captured frame. */
const FRAME_BANNER = 18;

export default function CommunityPreview() {
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
    <ScrollView contentContainerStyle={st.sheet} testID="wsf-target-community">
      <View style={st.banner}>
        <Text style={st.bannerText}>TARGET / CONCEPT — NOT IMPLEMENTED · COMMUNITY</Text>
      </View>
      <View style={st.grid}>
        {FRAMES.map((f) => (
          <View key={f.id} style={[st.cell, { width: f.width }]}>
            <Text style={st.cellLabel}>{f.label}</Text>
            {/*
              THE LABEL TRAVELS WITH THE FRAME. The page banner above is not in
              these element screenshots, and a target that circulates without
              its label is one paste away from being read as a shipped screen.
              The strip is added to the frame's height, so the device area below
              it is still exactly the device class named on the label.
            */}
            <View
              style={[st.frame, { width: f.width, height: f.height + FRAME_BANNER }]}
              testID={`wsf-frame-${f.id}`}
            >
              <View style={st.frameBanner}>
                <Text style={st.frameBannerText}>TARGET / CONCEPT — NOT IMPLEMENTED</Text>
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
  banner: { backgroundColor: '#22C55E', paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
  bannerText: { color: '#04260F', fontSize: 11, fontWeight: '900', letterSpacing: 1.6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  cell: { gap: 4 },
  cellLabel: { color: '#0B1F3A', fontSize: 13, fontWeight: '900' },
  frameBanner: {
    height: FRAME_BANNER,
    backgroundColor: '#22C55E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameBannerText: { color: '#04260F', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  frame: {
    overflow: 'hidden',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#B9B4A9',
    backgroundColor: '#F7F5F0',
  },
});
