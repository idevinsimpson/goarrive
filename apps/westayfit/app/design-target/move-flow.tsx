import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  ClosedGoalTarget,
  ConfirmedTarget,
  ContributeTarget,
  MoveEntryTarget,
  PendingTarget,
  PickerTarget,
  RefusedTarget,
  ReviewTarget,
} from '../../src/ui/designTarget/MoveFlowTargets';

/**
 * THE MOVE-FAMILY TARGETS, BEHIND THE SAME GATE AS THE OTHERS.
 *
 * Each cell is a real phone-sized frame rendering the real component, so the
 * capture is of the thing itself rather than a thumbnail of a drawing. The
 * capture spec screenshots each frame by its testID, which is why every frame
 * is exactly 390 wide and either 844 or 640 tall.
 */
function previewAllowed(): boolean {
  const raw = process.env.EXPO_PUBLIC_WSF_USE_EMULATORS;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true';
}

const FRAMES: { id: string; label: string; height: number; node: React.ReactNode }[] = [
  {
    id: 'move-choose',
    label: 'MOVE · several goals open',
    height: 844,
    node: <MoveEntryTarget state="choose" />,
  },
  {
    id: 'move-nogoal',
    label: 'MOVE · nothing running',
    height: 844,
    node: <MoveEntryTarget state="noGoal" />,
  },
  {
    id: 'move-choose-short',
    label: 'MOVE · several goals open · 390×640',
    height: 640,
    node: <MoveEntryTarget state="choose" />,
  },
  { id: 'picker-one', label: 'Picker · one movement', height: 844, node: <PickerTarget chosen={1} /> },
  {
    id: 'picker-many',
    label: 'Picker · several movements',
    height: 844,
    node: <PickerTarget chosen={3} />,
  },
  { id: 'contribute', label: 'Contribution entry', height: 844, node: <ContributeTarget /> },
  {
    id: 'contribute-short',
    label: 'Contribution entry · 390×640',
    height: 640,
    node: <ContributeTarget />,
  },
  { id: 'review', label: 'Review · before anything is written', height: 844, node: <ReviewTarget /> },
  { id: 'review-short', label: 'Review · 390×640', height: 640, node: <ReviewTarget /> },
  { id: 'confirmed', label: 'Confirmed · ordinary', height: 844, node: <ConfirmedTarget /> },
  {
    id: 'confirmed-short',
    label: 'Confirmed · ordinary · 390×640',
    height: 640,
    node: <ConfirmedTarget />,
  },
  {
    id: 'confirmed-reached',
    label: 'Confirmed · goal reached, still open',
    height: 844,
    node: <ConfirmedTarget variant="reached" />,
  },
  {
    id: 'confirmed-reached-short',
    label: 'Confirmed · reached · 390×640',
    height: 640,
    node: <ConfirmedTarget variant="reached" />,
  },
  {
    id: 'confirmed-posttarget',
    label: 'Confirmed · past the target already',
    height: 844,
    node: <ConfirmedTarget variant="postTarget" />,
  },
  { id: 'pending', label: 'Outcome unknown · not confirmed yet', height: 844, node: <PendingTarget /> },
  { id: 'pending-short', label: 'Outcome unknown · 390×640', height: 640, node: <PendingTarget /> },
  { id: 'refused', label: 'Definitive refusal · not recorded', height: 844, node: <RefusedTarget /> },
  { id: 'closed', label: 'Closed goal', height: 844, node: <ClosedGoalTarget /> },
  { id: 'closed-short', label: 'Closed goal · 390×640', height: 640, node: <ClosedGoalTarget /> },
];

/** The label strip burnt into every captured frame. */
const FRAME_BANNER = 18;

export default function MoveFlowPreview() {
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
    <ScrollView contentContainerStyle={st.sheet} testID="wsf-target-move-flow">
      <View style={st.banner}>
        <Text style={st.bannerText}>TARGET / CONCEPT — NOT IMPLEMENTED · MOVE FAMILY</Text>
      </View>
      <View style={st.grid}>
        {FRAMES.map((f) => (
          <View key={f.id} style={st.cell}>
            <Text style={st.cellLabel}>{f.label}</Text>
            {/*
              THE LABEL TRAVELS WITH THE FRAME. The page banner above is not in
              these element screenshots, and a target that circulates without
              its label is one paste away from being read as a shipped screen.
              The strip is added to the frame's height, so the device area below
              it is still exactly the device class named on the label.
            */}
            <View
              style={[st.frame, { height: f.height + FRAME_BANNER }]}
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
  cell: { width: 390, gap: 4 },
  cellLabel: { color: '#0B1F3A', fontSize: 13, fontWeight: '900' },
  frameBanner: {
    height: FRAME_BANNER,
    backgroundColor: '#22C55E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameBannerText: { color: '#04260F', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  frame: {
    width: 390,
    overflow: 'hidden',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#B9B4A9',
    backgroundColor: '#F7F5F0',
  },
});
