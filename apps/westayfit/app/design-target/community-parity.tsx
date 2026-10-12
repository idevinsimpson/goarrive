import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type {
  CommunityParityProps,
  ParityGoal,
  PrivacyCommunity,
} from '../../src/ui/communityParityTypes';
import { CommunityParityView } from '../../src/ui/CommunityParityView';
import { CommunityPrivacyPanelView } from '../../src/ui/CommunityPrivacyPanelView';
import { NAVY } from '../../src/ui/kit';

/**
 * COMMUNITY-PRESENTATION-ACCELERATOR-1 — THE COMPONENT FIXTURE
 * (Director #447 `5840798701`, data mapping `5840935220`).
 *
 * `CommunityParityView` and `CommunityPrivacyPanelView` rendered with the
 * frozen reference's OWN sample state (Lovable `e15b9fa0…` @ `d4f60624`:
 * "Oak Grove Together", 23 members, "500 squats together" at 241 of 500, two
 * finished goals; "Harbor Lunch Crew" beside it), mapped through the canonical
 * prop contract, so its frames can be laid over the reference's originals.
 *
 * `?state=` picks the state:
 *   normal | no-goal | goals-failed | roster-complete — the Community view
 *   privacy | privacy-failed | privacy-unconfirmed | privacy-refused — the panel
 *
 * THIS IS NOT THE ROUTE. The Community and Settings routes stay W9's, who owns
 * the wiring. Nothing here reads Firebase. The Community page's top band is
 * exactly as tall as the reference's prototype strip plus top bar (30 + 62 =
 * 92 px) and says what this page is; the privacy states sit in a panel at the
 * reference's inset under a fixture header of the reference's height, so the
 * comparison crops both to the same window.
 *
 * Behind the same gate as every other design-target route: it renders only when
 * the build carries EXPO_PUBLIC_WSF_USE_EMULATORS, which staging and production
 * builds refuse.
 */
function previewAllowed(): boolean {
  const raw = process.env.EXPO_PUBLIC_WSF_USE_EMULATORS;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true';
}

/** The reference's masthead height: prototype strip 30 + top bar 62. */
export const REFERENCE_MASTHEAD = 92;
/**
 * The reference panel's inset from the viewport edge, and its header's
 * measured height on the original (kicker + 22 px title at line-height 1.5,
 * plus its rule): the panel body starts 95 px from the viewport top.
 */
export const PANEL_INSET = 12;
export const PANEL_HEADER = 83;

const CURRENT: ParityGoal = {
  goalId: 'oak-500',
  title: '500 squats together',
  unit: 'squats',
  target: 500,
  total: { state: 'confirmed', value: 241 },
  status: 'active',
  windowLabel: 'This week',
};

const HISTORY: ParityGoal[] = [
  {
    goalId: 'oak-apr',
    title: '1,000 squats in April',
    unit: 'squats',
    target: 1000,
    total: { state: 'confirmed', value: 1024 },
    status: 'closed',
    windowLabel: 'April',
  },
  {
    goalId: 'oak-mar',
    title: '800 squats in March',
    unit: 'squats',
    target: 800,
    total: { state: 'confirmed', value: 612 },
    status: 'closed',
    windowLabel: 'March',
  },
];

const NAMED = [
  { key: 'alex', displayName: 'Alex M.', role: 'member' },
  { key: 'jordan', displayName: 'Jordan P.', role: 'member' },
  { key: 'kira', displayName: 'Kira T.', role: 'member' },
];

const BASE: Omit<CommunityParityProps, 'onSelectCommunity' | 'onJoin' | 'onStart'> = {
  groupId: 'oak',
  displayName: 'Oak Grove Together',
  groupType: 'familyFriends',
  joinPolicy: 'inviteOnly',
  memberCount: 23,
  role: 'member',
  communities: {
    state: 'loaded',
    value: [
      { groupId: 'oak', displayName: 'Oak Grove Together' },
      { groupId: 'harbor', displayName: 'Harbor Lunch Crew' },
    ],
  },
  goals: { state: 'loaded', value: { featured: CURRENT, otherOpen: [] } },
  history: { state: 'loaded', value: HISTORY },
  roster: { state: 'loaded', value: { named: NAMED, complete: false } },
};

const COMMUNITY_STATES: Record<string, typeof BASE> = {
  normal: BASE,
  'no-goal': {
    ...BASE,
    goals: { state: 'loaded', value: { featured: null, otherOpen: [] } },
  },
  'goals-failed': { ...BASE, goals: { state: 'failed' }, history: { state: 'failed' } },
  'roster-complete': {
    ...BASE,
    memberCount: 4,
    roster: { state: 'loaded', value: { named: NAMED, complete: true } },
  },
};

const OAK: PrivacyCommunity = {
  groupId: 'oak',
  displayName: 'Oak Grove Together',
  shownName: 'Alex M.',
  stored: { name: 'private', activity: 'visible' },
  saving: null,
  saveError: null,
};
const HARBOR: PrivacyCommunity = {
  groupId: 'harbor',
  displayName: 'Harbor Lunch Crew',
  shownName: 'Alex M.',
  stored: { name: 'visible', activity: 'private' },
  saving: null,
  saveError: null,
};

const PRIVACY_STATES: Record<string, PrivacyCommunity[]> = {
  privacy: [OAK, HARBOR],
  // A refused / lost save of Oak's name switch (to "visible"): the switch is
  // back on the stored value and the failure stays said.
  'privacy-failed': [{ ...OAK, saveError: 'notSaved' }, HARBOR],
  // The reply was lost after the write landed: the re-read found it stored.
  'privacy-unconfirmed': [{ ...OAK, stored: { name: 'visible', activity: 'visible' }, saveError: 'unconfirmed' }, HARBOR],
  'privacy-refused': [{ ...OAK, saveError: 'membershipRefused' }, HARBOR],
};

export default function CommunityParityFixture() {
  const params = useLocalSearchParams<{ state?: string; h?: string }>();
  const [pressedState, setPressedState] = useState<{ last: string | null; count: number }>({
    last: null,
    count: 0,
  });
  const pressed = pressedState.last;
  // Every callback is counted, so a control that fires twice is visible.
  const setPressed = (name: string) => setPressedState((prev) => ({ last: name, count: prev.count + 1 }));
  if (!previewAllowed()) {
    return (
      <View style={styles.refused} testID="wsf-community-parity-refused">
        <Text>Not available in this build.</Text>
      </View>
    );
  }
  const raw = typeof params.state === 'string' ? params.state : 'normal';
  const key = Object.hasOwn(COMMUNITY_STATES, raw) || Object.hasOwn(PRIVACY_STATES, raw) ? raw : 'normal';
  const compact = params.h === '640';
  const press = (name: string) => () => setPressed(name);
  const data = { state: key, pressed: pressed ?? '', presses: String(pressedState.count) };

  const privacy = Object.hasOwn(PRIVACY_STATES, key) ? PRIVACY_STATES[key] : undefined;
  if (privacy) {
    return (
      <View style={styles.scrim} testID="wsf-community-parity-fixture" {...({ dataSet: data } as object)}>
        <View style={styles.panel}>
          <View style={styles.panelHeader}>
            <Text style={styles.panelKicker}>COMPONENT FIXTURE · NOT THE ROUTE</Text>
            <Text style={styles.panelTitle}>Settings</Text>
          </View>
          <CommunityPrivacyPanelView
            load="ready"
            communities={privacy}
            compact={compact}
            onChange={(groupId, k, value) => setPressed(`change:${groupId}:${k}:${value}`)}
            onRetrySave={(groupId) => setPressed(`retry:${groupId}`)}
            onRetryLoad={press('retry-load')}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.page} testID="wsf-community-parity-fixture" {...({ dataSet: data } as object)}>
      <View style={styles.band}>
        <Text style={styles.bandText}>COMMUNITY-PARITY · COMPONENT FIXTURE · NOT THE ROUTE</Text>
        <Text style={styles.bandSub}>{`state=${key}${pressed ? ` · pressed ${pressed}` : ''}`}</Text>
      </View>
      <View style={styles.view}>
        <CommunityParityView
          {...(COMMUNITY_STATES[key] ?? BASE)}
          onSelectCommunity={(groupId) => setPressed(`select:${groupId}`)}
          onJoin={press('join')}
          onStart={press('start')}
          onRetryGoals={press('retry-goals')}
          onRetryHistory={press('retry-history')}
          onRetryRoster={press('retry-roster')}
          onShowMoreMembers={press('more-members')}
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
  scrim: { flex: 1, padding: PANEL_INSET, backgroundColor: '#7C8591' },
  panel: { flex: 1, borderRadius: 8, overflow: 'hidden', backgroundColor: '#FFFFFF' },
  panelHeader: {
    height: PANEL_HEADER,
    paddingLeft: 18,
    paddingRight: 12,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#D7DFE7',
    backgroundColor: '#FFF4D6',
  },
  panelKicker: { color: NAVY, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  panelTitle: { color: NAVY, fontSize: 22, marginTop: 2 },
  refused: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
