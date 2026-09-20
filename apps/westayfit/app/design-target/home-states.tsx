import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { HomeTarget, type HomeTargetProps } from '../../src/ui/designTarget/HomeTarget';

/**
 * THE HOME LIFECYCLE STATE MATRIX. A TARGET, NOT AN IMPLEMENTED PAGE.
 *
 * One composition, every state the product actually has, so the visual
 * language can be checked against the lifecycle rather than against the happy
 * path alone. Same gate as the single-screen preview: this renders only in an
 * emulator build.
 *
 * Every cell is the real HomeTarget at a real device size. Nothing here is a
 * thumbnail of a drawing.
 */
function previewAllowed(): boolean {
  const raw = process.env.EXPO_PUBLIC_WSF_USE_EMULATORS;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true';
}

const BASE: HomeTargetProps = {
  communityName: 'Smyrna Strong',
  memberCount: 23,
  goalTitle: '500 Squats by Friday',
  goalWindow: 'Open · ends Fri, Sep 25',
  sharedTotal: 241,
  target: 500,
  unit: 'squats',
  yourPart: 45,
  finishedGoals: 2,
  recent: [
    { amount: 20, when: '2h ago' },
    { amount: 15, when: '5h ago' },
    { amount: 30, when: '1d ago' },
  ],
};

const STATES: { label: string; note: string; props: HomeTargetProps }[] = [
  {
    label: '0% · nobody has moved yet',
    note: 'The mark is empty and reads as the brand, not as a disabled shape.',
    props: { ...BASE, phase: 'zero', sharedTotal: 0, yourPart: 0, recent: [] },
  },
  {
    label: 'Ordinary progress',
    note: 'The approved composition.',
    props: { ...BASE },
  },
  {
    label: '90% · near goal',
    note: 'Nothing changes but the numbers. The screen does not start shouting.',
    props: { ...BASE, phase: 'near', sharedTotal: 450, yourPart: 85 },
  },
  {
    label: 'Reached, still open',
    note: 'The eyebrow carries the news. The goal stays open, so moving stays possible.',
    props: { ...BASE, phase: 'reachedOpen', sharedTotal: 512, yourPart: 95 },
  },
  {
    label: 'Closed · reached',
    note: 'The action is gone, because nothing more can be added. A statement replaces it.',
    props: {
      ...BASE,
      phase: 'closedReached',
      sharedTotal: 528,
      yourPart: 95,
      goalWindow: 'Closed · ended Fri, Sep 19',
    },
  },
  {
    label: 'Closed · unfinished',
    note: 'Says what was reached without dressing it up, and without blame.',
    props: {
      ...BASE,
      phase: 'closedUnfinished',
      sharedTotal: 380,
      yourPart: 60,
      goalWindow: 'Closed · ended Fri, Sep 19',
    },
  },
  {
    label: 'No active goal',
    note: 'The hero gives way to a quiet invitation. Champion and member see different copy.',
    props: { ...BASE, phase: 'noGoal', isChampion: true, recent: [] },
  },
  {
    label: 'Stale · last confirmed',
    note: 'The screen says when it last knew, rather than implying it knows now.',
    props: { ...BASE, phase: 'stale' },
  },
  {
    label: 'Unavailable · refused',
    note: 'The progress area is replaced, not faked. The rest of the screen survives.',
    props: { ...BASE, phase: 'unavailable', recent: [] },
  },
  {
    label: 'Multiple goals, one featured',
    note: 'The featured goal keeps the hero; the others are a quiet list under the action.',
    props: {
      ...BASE,
      otherGoals: [{ title: 'Step-ups round', completed: 612, target: 2000, unit: 'step-ups' }],
    },
  },
  {
    label: 'Champion · management affordance',
    note: 'Manage appears in the chrome for a Champion, and for nobody else.',
    props: { ...BASE, isChampion: true },
  },
  {
    label: 'Member · no management',
    note: 'The same screen without Manage. A control that does nothing is a lie.',
    props: { ...BASE, isChampion: false },
  },
];

export default function HomeStatesPreview() {
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
    <ScrollView contentContainerStyle={st.sheet} testID="wsf-target-home-states">
      <View style={st.banner}>
        <Text style={st.bannerText}>TARGET / CONCEPT — NOT IMPLEMENTED · HOME LIFECYCLE STATES</Text>
      </View>
      <View style={st.grid}>
        {STATES.map((s) => (
          <View key={s.label} style={st.cell}>
            <Text style={st.cellLabel}>{s.label}</Text>
            <Text style={st.cellNote}>{s.note}</Text>
            <View style={st.frame}>
              <HomeTarget {...s.props} />
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  sheet: { backgroundColor: '#D9D5CC', padding: 20, gap: 16 },
  banner: {
    backgroundColor: '#22C55E',
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  bannerText: { color: '#04260F', fontSize: 11, fontWeight: '900', letterSpacing: 1.6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  cell: { width: 390, gap: 3 },
  cellLabel: { color: '#0B1F3A', fontSize: 13, fontWeight: '900' },
  cellNote: { color: '#4A5A70', fontSize: 11, lineHeight: 15, minHeight: 30 },
  // A real phone-sized frame. Overflow hidden so each cell shows the first
  // viewport, which is what a state has to survive.
  frame: {
    width: 390,
    height: 844,
    overflow: 'hidden',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#B9B4A9',
    backgroundColor: '#F7F5F0',
  },
});
