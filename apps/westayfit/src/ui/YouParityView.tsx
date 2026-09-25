import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { groupTypeCardLabel, memberCountLabel, roleCardLabel } from '../labels';
import {
  initialsOf,
  leadAndOthers,
  partBlock,
  sharedCell,
  sharedLine,
  statusOf,
  whenLabel,
  type YouCommunity,
  type YouGoal,
  type YouProfile,
  type YouState,
  type YouStatus,
} from '../youParity';
import { ACTION_GREEN, NAVY, PROGRESS_GREEN, SURFACE, elevation } from './kit';
import { LivingWeProgress } from './LivingWeProgress';
import { MEMBER_TAB_BAR_BODY, MEMBER_TAB_MOVE_OVERHANG } from './MemberTabBar';
import { fillRatio, percentLabel } from './progressFormat';

/**
 * YOU PARITY VIEW — the accepted Lovable You reference (`642f830b`,
 * `src/demo/screens/you.tsx` + `src/styles.css`) as a PURE presentation
 * component (YOU-PARITY-1, Director #456 `5840756497`, Phase A).
 *
 * It receives already-resolved canonical facts and callbacks. It makes NO
 * Firebase read, owns no route, touches no auth or storage, and carries none of
 * the prototype's demo authority. The route (`app/(tabs)/you.tsx`, W9's during
 * PERF-MOBILE-1) resolves the state and renders this; the hook is Phase B.
 *
 * ORDER, which is the claim: who you are (avatar, name, member since, Settings)
 * → your current community (role, size) → your part in Living WE (the shared
 * position beside your exact confirmed part, never joined) → other goals you
 * helped (with the reference's four lifecycle pills) → the account, last and
 * quiet. Sign out needs no read, so it renders in every signed-in state.
 *
 * The test ids are the route's existing ones, so the route's specs keep
 * reading the same handles once the hook lands.
 */

export type YouParityActions = {
  onSettings: () => void;
  onSignOut: () => void;
  onSignIn: () => void;
  onCommunity: () => void;
  onRetry: () => void;
  onStartMoving: () => void;
};

export type YouParityViewProps = {
  state: YouState;
  /** The signed-in account's email, shown only in the quiet account row. */
  email: string | null;
  signingOut: boolean;
  actions: YouParityActions;
};

const n = (v: number) => v.toLocaleString('en-US');

/**
 * The reference's `@media (max-height: 700px)` block: a short phone tightens
 * the head, the band and the state cards. Same breakpoint, same values.
 */
export const YOU_COMPACT_MAX_HEIGHT = 700;

/**
 * True on a phone no taller than the reference's breakpoint. It waits for
 * hydration, the rule the display, kiosk and station follow (#418): the static
 * export renders with no window, and React does not repair attributes on
 * hydration, so the first client render must match the export's full rhythm.
 * A missing measurement never selects the compact layout.
 */
export function useYouCompact(): boolean {
  const { height } = useWindowDimensions();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  return hydrated && height > 0 && height <= YOU_COMPACT_MAX_HEIGHT;
}

export function YouParityView({ state, email, signingOut, actions }: YouParityViewProps) {
  const compact = useYouCompact();
  const account = <Account email={email} signingOut={signingOut} onSignOut={actions.onSignOut} />;
  const card = [s.stateCard, compact && s.stateCardCompact];
  const cardTitle = [s.stateTitle, compact && s.stateTitleCompact];
  return (
    <View style={s.screen} testID="wsf-you" {...({ dataSet: { compact: compact ? 'true' : 'false' } } as Record<string, unknown>)}>
      <ScrollView contentContainerStyle={[s.body, compact && s.bodyCompact]}>
        {state.kind === 'loading' ? (
          <>
            <YouHead profile={null} onSettings={null} resolved={false} compact={compact} />
            <View style={[s.bandSkeleton, compact && s.bandCompact]} testID="wsf-you-loading">
              <View style={[s.skelOnNavy, { width: '46%', height: 11 }]} />
              <View style={[s.skelOnNavy, { width: '70%', height: 24 }]} />
              <View style={[s.skelOnNavy, { width: '100%', height: 34, marginTop: 10 }]} />
            </View>
            <View style={s.leadSkeleton}>
              <View style={[s.skel, { width: '52%', height: 11 }]} />
              <View style={[s.skel, { width: '78%', height: 22 }]} />
              <View style={[s.skel, { width: '100%', height: 118, borderRadius: 8, marginTop: 12 }]} />
            </View>
          </>
        ) : null}

        {state.kind === 'signedOut' ? (
          <>
            <YouHead profile={null} onSettings={null} resolved={false} compact={compact} />
            <View style={card} testID="wsf-you-signed-out">
              <Text style={s.eyebrow}>YOUR PART</Text>
              <Text style={cardTitle}>Sign in to see your part and your communities</Text>
              <Text style={s.stateBody}>
                What you record is yours. It is counted into your community’s shared total and is
                never shown beside anybody else’s.
              </Text>
              <PrimaryAction label="Sign in" onPress={actions.onSignIn} testID="wsf-you-signin" />
            </View>
          </>
        ) : null}

        {state.kind === 'noCommunity' ? (
          <>
            <YouHead profile={state.profile} onSettings={actions.onSettings} compact={compact} />
            <View style={card} testID="wsf-you-no-community">
              <Text style={s.eyebrow}>YOUR COMMUNITY</Text>
              <Text style={cardTitle}>Find your people</Text>
              <Text style={s.stateBody}>
                You’re not in a community yet. Your part is counted inside a community’s goals —
                join one with a code, or start your own.
              </Text>
              <PrimaryAction label="Find a community" arrow onPress={actions.onCommunity} testID="wsf-you-find-community" />
            </View>
            {account}
          </>
        ) : null}

        {state.kind === 'pickCommunity' ? (
          <>
            <YouHead profile={state.profile} onSettings={actions.onSettings} compact={compact} />
            <View style={card} testID="wsf-you-pick-community">
              <Text style={s.eyebrow}>YOUR COMMUNITY</Text>
              <Text style={cardTitle}>Which community?</Text>
              <Text style={s.stateBody}>
                {`You are in ${state.count} communities. Open one and it becomes the one this ` +
                  'page speaks for.'}
              </Text>
              <PrimaryAction label="Choose a community" arrow onPress={actions.onCommunity} testID="wsf-you-choose-community" />
            </View>
            {account}
          </>
        ) : null}

        {state.kind === 'failed' ? (
          <>
            <YouHead profile={state.profile} onSettings={actions.onSettings} compact={compact} />
            {state.community ? <Belonging community={state.community} compact={compact} /> : null}
            <View style={card} testID="wsf-you-failed" accessibilityRole={'alert' as never}>
              <Text style={s.eyebrow}>YOUR PART</Text>
              <Text style={cardTitle}>Contribution details unavailable</Text>
              <Text style={s.stateBody}>
                {state.community
                  ? 'Your identity and community are still here. We won’t guess an amount or show it as zero.'
                  : 'Your identity is still here. We won’t guess an amount or show it as zero.'}
              </Text>
              <View style={s.flowActions}>
                <SecondaryAction label="Open community" onPress={actions.onCommunity} testID="wsf-you-failed-community" />
                <PrimaryAction label="Retry" onPress={actions.onRetry} testID="wsf-you-retry" inRow />
              </View>
            </View>
            {account}
          </>
        ) : null}

        {state.kind === 'member' ? (
          <Member state={state} actions={actions} account={account} compact={compact} />
        ) : null}
      </ScrollView>
    </View>
  );
}

function Member({
  state,
  actions,
  account,
  compact,
}: {
  state: Extract<YouState, { kind: 'member' }>;
  actions: YouParityActions;
  account: ReactNode;
  compact: boolean;
}) {
  const { lead, others } = leadAndOthers(state.open, state.finished);
  const block = partBlock(state);
  const card = [s.stateCard, compact && s.stateCardCompact];
  const cardTitle = [s.stateTitle, compact && s.stateTitleCompact];
  return (
    <>
      <YouHead profile={state.profile} onSettings={actions.onSettings} compact={compact} />
      <View testID="wsf-you-member">
        <Belonging community={state.community} compact={compact} />
        {state.partial ? (
          <Text style={s.partial} testID="wsf-you-partial">
            Some goals could not be loaded, so this list may be short.
          </Text>
        ) : null}
        {block === 'lead' && lead ? <Lead row={lead} /> : null}
        {block === 'startMoving' ? (
          <View style={card} testID="wsf-you-nothing-yet">
            <Text style={s.eyebrow}>YOUR PART</Text>
            <Text style={cardTitle}>Your first confirmed contribution can start here</Text>
            <Text style={s.stateBody}>
              No confirmed contribution is shown for you yet. Pending or unknown attempts never count
              here.
            </Text>
            <PrimaryAction label="Start moving" arrow onPress={actions.onStartMoving} testID="wsf-you-start-moving" />
          </View>
        ) : null}
        {block === 'noEligible' ? (
          <View
            style={card}
            testID="wsf-you-nothing-yet"
            {...({ dataSet: { state: 'no-eligible-goal' } } as Record<string, unknown>)}
          >
            <Text style={s.eyebrow}>YOUR PART</Text>
            <Text style={cardTitle}>No goal is open for contributions</Text>
            <Text style={s.stateBody}>
              {state.finished.length > 0
                ? 'This community has no goal accepting contributions right now. What you added before is below.'
                : 'No confirmed contribution is shown for you, and this community has no goal accepting contributions right now. Nothing here can be counted yet.'}
            </Text>
            <SecondaryAction label="Open community" arrow onPress={actions.onCommunity} testID="wsf-you-open-community" block />
          </View>
        ) : null}
        <OtherGoals rows={others} communityName={state.community.displayName} />
      </View>
      {account}
    </>
  );
}

/**
 * THE HEAD: who you are, first. Avatar, name, member-since, and Settings as a
 * working affordance on the right — the accepted reference's `you-head`. The
 * side panel itself is W9's; this only opens Settings.
 */
export function YouHead({
  profile,
  onSettings,
  resolved = true,
  compact = false,
}: {
  profile: YouProfile | null;
  onSettings: (() => void) | null;
  /** The reference's short-phone block: 9 px under the head instead of 14. */
  compact?: boolean;
  /**
   * False while loading and when signed out. `wsf-you-identity` is the shell
   * tests' "this screen has resolved for a signed-in member" handle and
   * `wsf-you-name` is somebody's name, so neither may be on a loading or
   * signed-out page.
   */
  resolved?: boolean;
}) {
  const name = profile?.displayName ?? null;
  const initials = initialsOf(name);
  return (
    <View style={[s.head, compact && s.headCompact]} testID={resolved ? 'wsf-you-identity' : undefined}>
      <View style={s.avatar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {initials ? <Text style={s.avatarText}>{initials}</Text> : <PersonGlyph />}
      </View>
      <View style={s.headText}>
        <Text style={s.eyebrow} testID="wsf-you-title">YOUR PROFILE</Text>
        <Text style={s.h1} testID={resolved ? 'wsf-you-name' : undefined} accessibilityRole="header">
          {name ?? 'You'}
        </Text>
        {profile?.memberSince ? (
          <Text style={s.muted} testID="wsf-you-since">{`Member since ${profile.memberSince}`}</Text>
        ) : null}
      </View>
      {onSettings ? (
        <Pressable
          onPress={onSettings}
          style={s.settings}
          testID="wsf-you-settings"
          accessibilityRole="button"
          accessibilityLabel="Settings"
        >
          <GearGlyph />
          <Text style={s.settingsText}>Settings</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Your current community, full-bleed navy: name, kind, then role and size. */
function Belonging({ community, compact }: { community: YouCommunity; compact: boolean }) {
  const kind = groupTypeCardLabel(community.groupType ?? null);
  return (
    <View style={[s.band, compact && s.bandCompact]} testID="wsf-you-community">
      <View>
        <Text style={s.eyebrowLight}>YOUR CURRENT COMMUNITY</Text>
        <Text style={s.bandName}>{community.displayName}</Text>
        {kind ? <Text style={s.bandSub}>{kind}</Text> : null}
      </View>
      <View style={s.bandFacts}>
        <View style={[s.bandFact, { flex: 0.7 }]}>
          <Text style={s.bandDt}>ROLE</Text>
          <Text style={s.bandDd}>{roleCardLabel(community.role) ?? 'Member'}</Text>
        </View>
        <View style={[s.bandFact, { flex: 1.3 }]}>
          <Text style={s.bandDt}>COMMUNITY</Text>
          <Text style={s.bandDd}>{memberCountLabel(community.memberCount)}</Text>
        </View>
      </View>
    </View>
  );
}

function Pill({ status, testID }: { status: YouStatus; testID?: string }) {
  return (
    <View
      style={[
        s.pill,
        status.tone === 'closedReached' && s.pillClosedReached,
        status.tone === 'closedUnfinished' && s.pillClosedUnfinished,
      ]}
      testID={testID}
    >
      <Text
        style={[
          s.pillText,
          status.tone === 'closedReached' && s.pillTextClosedReached,
          status.tone === 'closedUnfinished' && s.pillTextClosedUnfinished,
        ]}
      >
        {status.label}
      </Text>
    </View>
  );
}

/**
 * YOUR PART IN LIVING WE: the shared position and your exact confirmed part,
 * side by side and never joined. No ratio between them, no rank, no streak.
 */
function Lead({ row }: { row: YouGoal }) {
  const usable = row.target > 0;
  const ratio = usable ? fillRatio(row.sharedTotal, row.target) : 0;
  const remaining = Math.max(0, row.target - row.sharedTotal);
  const reached = usable && row.sharedTotal >= row.target;
  return (
    <View style={s.lead} testID="wsf-you-lead">
      <View style={s.leadHeading}>
        <View style={s.leadHeadingText}>
          <Text style={s.eyebrow}>YOUR PART IN LIVING WE</Text>
          <Text style={s.h2}>{row.title}</Text>
        </View>
        <Pill status={statusOf(row)} testID="wsf-you-lead-status" />
      </View>
      <View style={s.leadBody}>
        <View style={s.shared}>
          {usable ? (
            <LivingWeProgress
              completed={row.sharedTotal}
              target={row.target}
              unit={row.unit}
              width={76}
              surface="dark"
            />
          ) : null}
          <View style={s.sharedText}>
            <Text style={s.sharedSmall}>SHARED POSITION</Text>
            <View
              style={s.sharedNumberLine}
              testID="wsf-you-lead-shared"
              accessible
              accessibilityLabel={sharedLine(row)}
            >
              <Text style={s.sharedNumber}>{`${n(row.sharedTotal)} `}</Text>
              <Text style={s.sharedOf}>{sharedLine(row).slice(n(row.sharedTotal).length + 1)}</Text>
            </View>
            {usable ? (
              <>
                <View style={s.track}>
                  <View style={[s.trackFill, { width: `${ratio * 100}%` }]} />
                </View>
                <View style={s.meta}>
                  <Text style={s.metaStrong}>
                    {reached ? 'Goal reached' : `${percentLabel(row.sharedTotal, row.target)} complete`}
                  </Text>
                  <Text style={s.metaSoft}>{reached ? 'Still open' : `${n(remaining)} ${row.unit} to go`}</Text>
                </View>
              </>
            ) : null}
          </View>
        </View>
        <View style={s.own}>
          <Text style={s.ownSmall}>YOUR EXACT CONFIRMED PART</Text>
          {/* The figure and its unit in one labelled block. The number carries
              a trailing space, so the block reads "25 squats" as one phrase to
              assistive tech and to text matching, while the unit sits 3 px
              under the number as in the reference. */}
          <View testID="wsf-you-lead-own" accessible accessibilityLabel={`${n(row.yourPart)} ${row.unit}`}>
            <Text style={s.ownNumber}>{`${n(row.yourPart)} `}</Text>
            <Text style={s.ownUnit}>{row.unit}</Text>
          </View>
        </View>
      </View>
      <Text style={s.truth}>Shared and yours are separate facts. No rank, streak, score or inferred impact.</Text>
    </View>
  );
}

/** Other goals you helped: each with your part and the shared figure, kept apart. */
function OtherGoals({ rows, communityName }: { rows: YouGoal[]; communityName: string }) {
  if (rows.length === 0) return null;
  return (
    <View style={s.others} testID="wsf-you-others">
      <Text style={s.eyebrow}>ALSO YOURS</Text>
      <Text style={s.h2Others}>Other goals you helped</Text>
      {rows.map((r) => (
        <View key={r.goalId} style={s.row} testID={`wsf-you-row-${r.goalId}`}>
          <View style={s.rowHead}>
            <View style={s.rowHeadText}>
              <Text style={s.rowTitle} numberOfLines={2}>
                {r.title}
              </Text>
              <Text style={s.rowSub}>{[communityName, whenLabel(r)].filter(Boolean).join(' · ')}</Text>
            </View>
            <Pill status={statusOf(r)} />
          </View>
          <View style={s.rowFacts}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowDt}>YOURS</Text>
              <Text style={s.rowDd}>{`${n(r.yourPart)} ${r.unit}`}</Text>
            </View>
            <View style={{ flex: 1.45 }}>
              <Text style={s.rowDt}>SHARED</Text>
              <Text style={s.rowDd}>
                {sharedCell(r)}
              </Text>
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * THE ACCOUNT, LAST AND QUIET. Signing out needs no read, so this renders in
 * every signed-in state — it is reachable, just not the member story's lead.
 */
function Account({
  email,
  signingOut,
  onSignOut,
}: {
  email: string | null;
  signingOut: boolean;
  onSignOut: () => void;
}) {
  return (
    <View style={s.account} testID="wsf-you-account">
      <View style={s.accountText}>
        <Text style={s.accountLabel}>Signed in as</Text>
        <Text style={s.accountEmail} numberOfLines={1} testID="wsf-you-email">
          {email ?? 'this device'}
        </Text>
      </View>
      <Pressable
        onPress={onSignOut}
        disabled={signingOut}
        style={s.signOut}
        testID="wsf-you-signout"
        accessibilityRole="button"
      >
        <Text style={s.signOutText}>{signingOut ? 'Signing out…' : 'Sign out'}</Text>
      </Pressable>
    </View>
  );
}

function PrimaryAction({
  label,
  onPress,
  testID,
  arrow,
  inRow,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  arrow?: boolean;
  inRow?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[s.primary, inRow && s.inRow]}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={s.primaryText}>{label}</Text>
      {arrow ? <ArrowGlyph size={20} /> : null}
    </Pressable>
  );
}

function SecondaryAction({
  label,
  onPress,
  testID,
  arrow,
  block,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  arrow?: boolean;
  block?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[s.secondary, block ? s.secondaryBlock : s.inRow]}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={s.secondaryText}>{label}</Text>
      {arrow ? <ArrowGlyph size={17} /> : null}
    </Pressable>
  );
}

/**
 * lucide `arrow-right` (the reference's action arrow) drawn from Views on its
 * own 24-unit grid: the shaft 5→19 on y 12 and the two strokes of the head,
 * stroke width 2, round caps. The app ships no SVG library.
 */
function ArrowGlyph({ size }: { size: number }) {
  const k = size / 24;
  const stroke = 2 * k;
  const bar = (x1: number, y1: number, x2: number, y2: number) => {
    const len = Math.hypot(x2 - x1, y2 - y1) * k + stroke;
    const cx = ((x1 + x2) / 2) * k;
    const cy = ((y1 + y2) / 2) * k;
    const deg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    return {
      position: 'absolute' as const,
      left: cx - len / 2,
      top: cy - stroke / 2,
      width: len,
      height: stroke,
      borderRadius: stroke / 2,
      backgroundColor: NAVY,
      transform: [{ rotate: `${deg}deg` }],
    };
  };
  return (
    <View
      style={{ width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={bar(5, 12, 19, 12)} />
      <View style={bar(12, 5, 19, 12)} />
      <View style={bar(19, 12, 12, 19)} />
    </View>
  );
}

/**
 * The Settings gear, drawn from Views as an outline like lucide `settings`:
 * four crossed bars make eight teeth, a ring covers their middle, and a small
 * ring sits at the centre.
 */
function GearGlyph() {
  return (
    <View style={s.gear} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[0, 45, 90, 135].map((deg) => (
        <View key={deg} style={[s.gearTooth, { transform: [{ rotate: `${deg}deg` }] }]} />
      ))}
      <View style={s.gearHub} />
      <View style={s.gearHole} />
    </View>
  );
}

/** A plain figure for a member with no display name. */
function PersonGlyph() {
  return (
    <View style={s.person} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={s.personHead} />
      <View style={s.personBody} />
    </View>
  );
}

/*
  TOKENS FROM THE ACCEPTED REFERENCE (Lovable `642f830b`, src/styles.css),
  converted from oklch to hex so this route reads the same without editing the
  shared kit. Navy, action green and confirmed green are the kit's own.
*/
const BG = '#FBFAF4';
const MUTED_BG = '#EFEFE6';
const MUTED_FG = '#4B5C71';
const BORDER = '#D7DFE7';
const EYEBROW_GREEN = '#00741E';
const UNIT_GREEN = '#005E19';
const PILL_TEXT = '#014210';
const PILL_BG = '#E0F0DB';
const CONFIRMED = PROGRESS_GREEN;
const BAND_SUB = '#BFD5E2';
const BAND_DT = '#A6C3D4';
const SHARED_SMALL = '#ACC9DB';
const SHARED_SOFT = '#B5CEE3';

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  body: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: MEMBER_TAB_BAR_BODY + MEMBER_TAB_MOVE_OVERHANG,
  },
  bodyCompact: { paddingTop: 8 },

  // Line heights are the reference's literal ones: its own where styles.css
  // sets one, otherwise the 1.5 every element inherits from the Tailwind
  // preflight. React Native's default ("normal") is shorter.
  eyebrow: { color: EYEBROW_GREEN, fontSize: 11, lineHeight: 16.5, fontWeight: '800', letterSpacing: 1.32 },
  eyebrowLight: { color: CONFIRMED, fontSize: 11, lineHeight: 16.5, fontWeight: '800', letterSpacing: 1.32 },
  muted: { color: MUTED_FG, fontSize: 12, lineHeight: 18 },
  h1: { color: NAVY, fontSize: 27, lineHeight: 40.5, fontWeight: '400', marginVertical: 2 },
  h2: { color: NAVY, fontSize: 21, lineHeight: 23.1, fontWeight: '400', marginTop: 3 },

  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 4,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  headCompact: { paddingBottom: 9 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: SURFACE, fontSize: 11, fontWeight: '800' },
  headText: { flex: 1, minWidth: 0 },
  settings: {
    minWidth: 48,
    minHeight: 48,
    paddingHorizontal: 6,
    paddingVertical: 3,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  settingsText: { color: NAVY, fontSize: 10, lineHeight: 15, fontWeight: '800' },
  gear: { width: 21, height: 21, alignItems: 'center', justifyContent: 'center' },
  gearTooth: { position: 'absolute', width: 4, height: 19, borderRadius: 1, backgroundColor: NAVY },
  gearHub: {
    position: 'absolute',
    width: 15,
    height: 15,
    borderRadius: 7.5,
    borderWidth: 1.75,
    borderColor: NAVY,
    backgroundColor: BG,
  },
  gearHole: { position: 'absolute', width: 7, height: 7, borderRadius: 3.5, borderWidth: 1.75, borderColor: NAVY },
  person: { width: 22, height: 22, alignItems: 'center', justifyContent: 'flex-end' },
  personHead: { width: 9, height: 9, borderRadius: 5, backgroundColor: SURFACE, marginBottom: 2 },
  personBody: { width: 16, height: 8, borderTopLeftRadius: 8, borderTopRightRadius: 8, backgroundColor: SURFACE },

  band: {
    marginTop: 14,
    marginHorizontal: -20,
    paddingHorizontal: 20,
    paddingVertical: 18,
    gap: 14,
    backgroundColor: NAVY,
  },
  bandCompact: { marginTop: 8, paddingVertical: 13, gap: 9 },
  bandName: { color: SURFACE, fontSize: 25, lineHeight: 26.25, fontWeight: '400', marginTop: 3, marginBottom: 2 },
  bandSub: { color: BAND_SUB, fontSize: 12, lineHeight: 18 },
  bandFacts: { flexDirection: 'row', gap: 14 },
  bandFact: { paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.18)' },
  bandDt: { color: BAND_DT, fontSize: 10, lineHeight: 15, fontWeight: '800' },
  bandDd: { color: SURFACE, fontSize: 14, lineHeight: 21, fontWeight: '800', marginTop: 2 },

  partial: { color: MUTED_FG, fontSize: 12.5, lineHeight: 18.75, fontWeight: '700', marginTop: 12 },

  lead: { paddingTop: 18, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: BORDER },
  leadHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  leadHeadingText: { flex: 1, minWidth: 0 },
  leadBody: { marginTop: 13, flexDirection: 'row', gap: 10 },
  shared: {
    flex: 1.35,
    minWidth: 0,
    padding: 12,
    borderRadius: 8,
    backgroundColor: NAVY,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sharedText: { flex: 1, minWidth: 0 },
  sharedSmall: { color: SHARED_SMALL, fontSize: 9, lineHeight: 13.5, fontWeight: '800' },
  // `.goal-number`: a baseline-aligned row with a 4 px gap. The figure's
  // trailing space keeps the phrase readable as one; it hangs at the end of
  // its line, so the gap is the margin.
  sharedNumberLine: { flexDirection: 'row', alignItems: 'baseline' },
  sharedNumber: { color: SURFACE, fontSize: 24, lineHeight: 24, fontWeight: '700', marginRight: 4 },
  sharedOf: { flexShrink: 1, color: SHARED_SOFT, fontSize: 13, lineHeight: 19.5, fontWeight: '700' },
  track: {
    height: 8,
    marginTop: 8,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  trackFill: { height: '100%', borderRadius: 10, backgroundColor: CONFIRMED },
  meta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    columnGap: 14,
    rowGap: 2,
    marginTop: 5,
  },
  metaStrong: { color: CONFIRMED, fontSize: 9, lineHeight: 13.5, fontWeight: '700' },
  metaSoft: { color: SHARED_SOFT, fontSize: 9, lineHeight: 13.5 },
  own: {
    flex: 0.65,
    minWidth: 104,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    borderLeftWidth: 4,
    borderLeftColor: CONFIRMED,
    backgroundColor: SURFACE,
  },
  ownSmall: { color: MUTED_FG, fontSize: 9, lineHeight: 11.25, fontWeight: '800' },
  ownNumber: { color: NAVY, fontSize: 34, lineHeight: 32.3, fontWeight: '700', marginTop: 6 },
  ownUnit: { color: UNIT_GREEN, fontSize: 12, lineHeight: 18, fontWeight: '800', marginTop: 3 },
  truth: { color: MUTED_FG, fontSize: 10, lineHeight: 15, marginTop: 9 },

  pill: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: PILL_BG,
    alignSelf: 'flex-start',
  },
  pillText: { color: PILL_TEXT, fontSize: 10, lineHeight: 15, fontWeight: '800' },
  pillClosedReached: { backgroundColor: NAVY },
  pillTextClosedReached: { color: CONFIRMED },
  pillClosedUnfinished: { backgroundColor: MUTED_BG },
  pillTextClosedUnfinished: { color: MUTED_FG },

  others: { paddingTop: 17 },
  h2Others: { color: NAVY, fontSize: 19, lineHeight: 28.5, fontWeight: '400', marginTop: 2, marginBottom: 6 },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: BORDER },
  rowHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rowHeadText: { flex: 1, minWidth: 0 },
  rowTitle: { color: NAVY, fontSize: 14, lineHeight: 21, fontWeight: '700' },
  rowSub: { color: MUTED_FG, fontSize: 11, lineHeight: 16.5, marginTop: 2 },
  rowFacts: { flexDirection: 'row', gap: 10, marginTop: 8 },
  rowDt: { color: MUTED_FG, fontSize: 9, lineHeight: 13.5, fontWeight: '800' },
  rowDd: { color: NAVY, fontSize: 12, lineHeight: 18, fontWeight: '800', marginTop: 2 },

  stateCard: { marginTop: 16, padding: 20, borderRadius: 8, backgroundColor: MUTED_BG },
  stateCardCompact: { marginTop: 10, paddingVertical: 15, paddingHorizontal: 20 },
  stateTitle: { color: NAVY, fontSize: 22, lineHeight: 24.64, fontWeight: '400', marginTop: 4, marginBottom: 7 },
  stateTitleCompact: { fontSize: 20, lineHeight: 22.4 },
  stateBody: { color: MUTED_FG, fontSize: 13, lineHeight: 18.85 },
  flowActions: { flexDirection: 'row', gap: 8, marginTop: 16 },
  inRow: { flex: 1, marginTop: 0 },

  primary: {
    minHeight: 54,
    marginTop: 10,
    borderRadius: 10,
    backgroundColor: ACTION_GREEN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    ...elevation.action,
  },
  primaryText: { color: NAVY, fontSize: 16, fontWeight: '800' },
  secondary: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: NAVY,
    backgroundColor: SURFACE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  secondaryBlock: { alignSelf: 'flex-start', marginTop: 10 },
  secondaryText: { color: NAVY, fontSize: 14, fontWeight: '800' },

  account: {
    marginTop: 24,
    minHeight: 64,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: BORDER,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  accountText: { flex: 1, minWidth: 0 },
  accountLabel: { color: MUTED_FG, fontSize: 12, lineHeight: 18 },
  accountEmail: { color: NAVY, fontSize: 14, lineHeight: 21, fontWeight: '800', marginTop: 2 },
  signOut: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutText: { color: NAVY, fontSize: 13.5, fontWeight: '800' },

  bandSkeleton: {
    marginTop: 14,
    marginHorizontal: -20,
    paddingHorizontal: 20,
    paddingVertical: 18,
    gap: 8,
    backgroundColor: NAVY,
  },
  leadSkeleton: { paddingTop: 18, gap: 8 },
  skel: { backgroundColor: '#E9E5DC', borderRadius: 6 },
  skelOnNavy: { backgroundColor: 'rgba(247,245,240,0.14)', borderRadius: 6 },
});
