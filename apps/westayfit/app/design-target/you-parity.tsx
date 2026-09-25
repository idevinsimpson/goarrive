import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { UNKNOWN_SHARED, knownShared } from '../../src/goalTruth';
import { NAVY } from '../../src/ui/kit';
import { YouParityView, useYouCompact } from '../../src/ui/YouParityView';
import type { YouGoal, YouState } from '../../src/youParity';

/**
 * YOU-PARITY-1 — THE COMPONENT FIXTURE (Phase A, Director #456 `5840756497`).
 *
 * `YouParityView` rendered with the accepted reference's OWN state (Lovable
 * `642f830b`: "Alex M." in "Oak Grove Together", 23 members, "500 squats
 * together" at 241 of 500 with 25 of them this member's, and a reached,
 * still-open goal they also helped), so its frames can be laid over the
 * reference's originals pixel for pixel.
 *
 * `?state=` picks the state: normal | no-own | no-eligible | failed |
 * unknown-shared (an open lead and a finished goal whose shared totals did not
 * answer — the reference has no such frame; it is canonical truth only).
 *
 * Period labels are given as the route adapter will give them: already
 * formatted in the goal's own timezone. The view shows them verbatim.
 *
 * THIS IS NOT THE ROUTE. The route stays W9's during PERF-MOBILE-1; the hook is
 * Phase B. Nothing here reads Firebase. The top band is exactly as tall as the
 * reference's prototype strip plus its top bar (30 + 62 = 92 px; 30 + 56 = 86 px
 * on a phone no taller than 700 px, where the reference's top bar shortens)
 * and says what this page is, so the comparison crops both frames to the same
 * body window.
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

/** The reference's masthead height: prototype strip 30 + top bar 62 (56 when short). */
export const REFERENCE_MASTHEAD = 92;
export const REFERENCE_MASTHEAD_COMPACT = 86;

const PROFILE = { displayName: 'Alex M.', memberSince: 'September 2026' };
const COMMUNITY = { displayName: 'Oak Grove Together', role: 'member', memberCount: 23 };

const LEAD: YouGoal = {
  goalId: 'fixture-lead',
  title: '500 squats together',
  unit: 'squats',
  target: 500,
  yourPart: 25,
  shared: knownShared(241),
  open: true,
  periodLabel: 'Ends Sep 27',
};

const OTHER: YouGoal = {
  goalId: 'fixture-other',
  title: '150 squats this week',
  unit: 'squats',
  target: 150,
  yourPart: 20,
  shared: knownShared(155),
  open: true,
  periodLabel: 'Ends Oct 1',
};

const STATES: Record<string, YouState> = {
  normal: {
    kind: 'member',
    profile: PROFILE,
    community: COMMUNITY,
    open: [LEAD, OTHER],
    finished: [],
    partial: false,
    eligible: true,
  },
  'no-own': {
    kind: 'member',
    profile: PROFILE,
    community: COMMUNITY,
    open: [],
    finished: [],
    partial: false,
    eligible: true,
  },
  'no-eligible': {
    kind: 'member',
    profile: PROFILE,
    community: COMMUNITY,
    open: [],
    finished: [],
    partial: false,
    eligible: false,
  },
  failed: { kind: 'failed', profile: PROFILE, community: COMMUNITY },
  'unknown-shared': {
    kind: 'member',
    profile: PROFILE,
    community: COMMUNITY,
    open: [{ ...LEAD, shared: UNKNOWN_SHARED }],
    finished: [
      {
        goalId: 'fixture-closed-unknown',
        title: '800 squats in July',
        unit: 'squats',
        target: 800,
        yourPart: 40,
        shared: UNKNOWN_SHARED,
        open: false,
        periodLabel: 'Ended Jul 31',
      },
    ],
    partial: false,
    eligible: true,
  },
};

export default function YouParityFixture() {
  const params = useLocalSearchParams<{ state?: string }>();
  const [pressed, setPressed] = useState<string | null>(null);
  const compact = useYouCompact();
  if (!previewAllowed()) {
    return (
      <View style={styles.refused} testID="wsf-you-parity-refused">
        <Text>Not available in this build.</Text>
      </View>
    );
  }
  const key = typeof params.state === 'string' && params.state in STATES ? params.state : 'normal';
  const press = (name: string) => () => setPressed(name);
  return (
    <View style={styles.page} testID="wsf-you-parity-fixture" dataSet={{ state: key, pressed: pressed ?? '' }}>
      <View style={[styles.band, { height: compact ? REFERENCE_MASTHEAD_COMPACT : REFERENCE_MASTHEAD }]}>
        <Text style={styles.bandText}>YOU-PARITY-1 · COMPONENT FIXTURE · NOT THE ROUTE</Text>
        <Text style={styles.bandSub}>{`state=${key}${pressed ? ` · pressed ${pressed}` : ''}`}</Text>
      </View>
      <View style={styles.view}>
        <YouParityView
          state={STATES[key]!}
          email="alex@example.com"
          signingOut={false}
          actions={{
            onSettings: press('settings'),
            onSignOut: press('signout'),
            onSignIn: press('signin'),
            onCommunity: press('community'),
            onRetry: press('retry'),
            onStartMoving: press('move'),
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
