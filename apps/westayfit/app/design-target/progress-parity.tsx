import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { UNKNOWN_SHARED, knownShared } from '../../src/goalTruth';
import type { ProgressGoal, ProgressReceipt, ProgressState } from '../../src/progressParity';
import { NAVY } from '../../src/ui/kit';
import { ProgressParityView, useProgressCompact } from '../../src/ui/ProgressParityView';

/**
 * PROGRESS-PARITY-1 — THE COMPONENT FIXTURE (Phase A, Director #451 `5840756702`).
 *
 * `ProgressParityView` rendered with the accepted reference's OWN state
 * (Lovable `09b8a73c`: Alex M., in Oak Grove Together and Harbor Lunch Crew,
 * with 145 squats recorded across four goals — two open, one closed reached,
 * one closed unfinished), so its frames can be laid over the reference's
 * originals pixel for pixel.
 *
 * `?state=` picks the state: populated | first-eligible | no-open-goal |
 * partial | failure | receipts-contract | unknown-shared (an open and a
 * finished goal whose shared totals did not answer; canonical truth only).
 *
 * Period labels are the reference's own semantic labels ("This week",
 * "August", "July"), as the route adapter will supply them; the view shows
 * them verbatim (Director #495 `5841257894`).
 *
 * `receipts-contract` IS NOT A CANONICAL STATE. It fills the receipt slot from
 * props to show the slot is ready for a future authorized source; its band
 * says so. Every other state passes `receipts: null`, which is the truth
 * today.
 *
 * THIS IS NOT THE ROUTE. The route stays W9's during PERF-MOBILE-1; the hook is
 * Phase B. Nothing here reads Firebase. The top band is exactly as tall as the
 * reference's prototype strip plus its top bar (30 + 62 = 92 px; 30 + 56 = 86 px
 * on a phone no taller than 700 px) so the comparison crops both frames to the
 * same body window.
 *
 * Behind the same gate as every other design-target route: it renders only when
 * the build carries EXPO_PUBLIC_WSF_USE_EMULATORS, which staging and
 * production builds refuse.
 */
function previewAllowed(): boolean {
  const raw = process.env.EXPO_PUBLIC_WSF_USE_EMULATORS;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true';
}

export const REFERENCE_MASTHEAD = 92;
export const REFERENCE_MASTHEAD_COMPACT = 86;

const OAK = { communityId: 'oak', community: 'Oak Grove Together' };
const HARBOR = { communityId: 'harbor', community: 'Harbor Lunch Crew' };

const OAK_500: ProgressGoal = {
  goalId: 'oak-500',
  title: '500 squats together',
  ...OAK,
  unit: 'squats',
  yourPart: 25,
  target: 500,
  shared: knownShared(241),
  open: true,
  periodLabel: 'This week',
};
const HARBOR_150: ProgressGoal = {
  goalId: 'harbor-150',
  title: '150 squats this week',
  ...HARBOR,
  unit: 'squats',
  yourPart: 20,
  target: 150,
  shared: knownShared(155),
  open: true,
  periodLabel: 'This week',
};
const OAK_AUG: ProgressGoal = {
  goalId: 'oak-aug',
  title: '1,000 squats in August',
  ...OAK,
  unit: 'squats',
  yourPart: 60,
  target: 1000,
  shared: knownShared(1024),
  open: false,
  periodLabel: 'August',
};
const OAK_JUL: ProgressGoal = {
  goalId: 'oak-jul',
  title: '800 squats in July',
  ...OAK,
  unit: 'squats',
  yourPart: 40,
  target: 800,
  shared: knownShared(612),
  open: false,
  periodLabel: 'July',
};

/** The reference's own receipt rows — FIXTURE PROPS, for the contract state only. */
const CONTRACT_RECEIPTS: ProgressReceipt[] = [
  { id: 'r1', amount: 20, unit: 'squats', goalTitle: '500 squats together', community: 'Oak Grove Together', whenLabel: '8 min ago' },
  { id: 'r2', amount: 20, unit: 'squats', goalTitle: '150 squats this week', community: 'Harbor Lunch Crew', whenLabel: 'yesterday' },
  { id: 'r3', amount: 5, unit: 'squats', goalTitle: '500 squats together', community: 'Oak Grove Together', whenLabel: '2 days ago' },
  { id: 'r4', amount: 60, unit: 'squats', goalTitle: '1,000 squats in August', community: 'Oak Grove Together', whenLabel: '41 days ago' },
  { id: 'r5', amount: 40, unit: 'squats', goalTitle: '800 squats in July', community: 'Oak Grove Together', whenLabel: '72 days ago' },
];

const READY = {
  kind: 'ready' as const,
  memberName: 'Alex M.',
  open: [OAK_500, HARBOR_150],
  finished: [OAK_AUG, OAK_JUL],
  partial: false,
  canStart: true,
  receipts: null,
};

const STATES: Record<string, ProgressState> = {
  populated: READY,
  'first-eligible': { ...READY, open: [], finished: [], canStart: true },
  'no-open-goal': { ...READY, open: [], finished: [], canStart: false },
  // The reference's partial read keeps the open goals and loses the finished ones.
  partial: { ...READY, finished: [], partial: true },
  failure: { kind: 'failed', memberName: 'Alex M.' },
  'receipts-contract': { ...READY, receipts: CONTRACT_RECEIPTS },
  'unknown-shared': {
    ...READY,
    open: [OAK_500, { ...HARBOR_150, shared: UNKNOWN_SHARED }],
    finished: [OAK_AUG, { ...OAK_JUL, shared: UNKNOWN_SHARED }],
  },
};

export default function ProgressParityFixture() {
  const params = useLocalSearchParams<{ state?: string }>();
  const [pressed, setPressed] = useState<string | null>(null);
  const compact = useProgressCompact();
  if (!previewAllowed()) {
    return (
      <View style={styles.refused} testID="wsf-progress-parity-refused">
        <Text>Not available in this build.</Text>
      </View>
    );
  }
  const key = typeof params.state === 'string' && params.state in STATES ? params.state : 'populated';
  const press = (name: string) => () => setPressed(name);
  const contract = key === 'receipts-contract';
  return (
    <View style={styles.page} testID="wsf-progress-parity-fixture" dataSet={{ state: key, pressed: pressed ?? '' }}>
      <View style={[styles.band, { height: compact ? REFERENCE_MASTHEAD_COMPACT : REFERENCE_MASTHEAD }]}>
        <Text style={styles.bandText}>PROGRESS-PARITY-1 · COMPONENT FIXTURE · NOT THE ROUTE</Text>
        <Text style={styles.bandSub}>
          {contract
            ? 'RECEIPT SLOT CONTRACT · rows are fixture props · no canonical source'
            : `state=${key}${pressed ? ` · pressed ${pressed}` : ''}`}
        </Text>
      </View>
      <View style={styles.view}>
        <ProgressParityView
          state={STATES[key]!}
          actions={{
            onRetry: press('retry'),
            onStartMoving: press('move'),
            onOpenCommunity: press('community'),
            onOpenReceipt: (id) => setPressed(`receipt:${id}`),
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#FBFAF4' },
  band: {
    backgroundColor: '#FFF4D6',
    borderBottomWidth: 1,
    borderBottomColor: '#E8D9A8',
    justifyContent: 'center',
    paddingHorizontal: 14,
    gap: 3,
  },
  bandText: { color: NAVY, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  bandSub: { color: NAVY, fontSize: 10 },
  view: { flex: 1 },
  refused: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
