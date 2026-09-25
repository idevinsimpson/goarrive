import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { NAVY } from '../../src/ui/kit';
import { YouParityView } from '../../src/ui/YouParityView';
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
 * `?state=` picks the state: normal | no-own | no-eligible | failed.
 *
 * THIS IS NOT THE ROUTE. The route stays W9's during PERF-MOBILE-1; the hook is
 * Phase B. Nothing here reads Firebase. The top band is exactly as tall as the
 * reference's prototype strip plus its top bar (30 + 62 = 92 px) and says what
 * this page is, so the comparison crops both frames to the same body window.
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

/** The reference's masthead height: prototype strip 30 + top bar 62. */
export const REFERENCE_MASTHEAD = 92;

const PROFILE = { displayName: 'Alex M.', memberSince: 'September 2026' };
const COMMUNITY = { displayName: 'Oak Grove Together', role: 'member', memberCount: 23 };

const DAY = 24 * 60 * 60_000;
const FIXED_NOW = Date.UTC(2026, 8, 25, 16, 0, 0);

const LEAD: YouGoal = {
  goalId: 'fixture-lead',
  title: '500 squats together',
  unit: 'squats',
  target: 500,
  yourPart: 25,
  sharedTotal: 241,
  open: true,
  endsAt: new Date(FIXED_NOW + 2 * DAY).toISOString(),
};

const OTHER: YouGoal = {
  goalId: 'fixture-other',
  title: '150 squats this week',
  unit: 'squats',
  target: 150,
  yourPart: 20,
  sharedTotal: 155,
  open: true,
  endsAt: new Date(FIXED_NOW + 6 * DAY).toISOString(),
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
};

export default function YouParityFixture() {
  const params = useLocalSearchParams<{ state?: string }>();
  const [pressed, setPressed] = useState<string | null>(null);
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
      <View style={styles.band}>
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
    height: REFERENCE_MASTHEAD,
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
