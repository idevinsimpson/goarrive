import { useState } from 'react';
import { type LayoutChangeEvent, ScrollView, StyleSheet, Text, View } from 'react-native';

import { LivingWeProgress } from '../LivingWeProgress';
import { WsfWordmark } from '../WsfWordmark';
import { memberCountLabel, roleCardLabel } from '../../labels';
import {
  ACTION_GREEN,
  ACTION_GREEN_DEEP,
  CREAM,
  ERROR_RED,
  HAIRLINE,
  INK_QUIET,
  NAVY,
  ON_ACTION,
  ON_NAVY,
  ON_NAVY_MUTED,
  SURFACE,
  display,
  elevation,
} from '../kit';

/**
 * PAGE 5 — YOU. TARGET, NOT AN IMPLEMENTED PAGE.
 *
 * SECOND REVISION. The first was reviewed and not accepted, in these words:
 * "the page still repeats a community card, two own-part cards and two history
 * cards on cream; the progress instrument is small and the account actions
 * arrive below the first viewport. It remains too close to the rejected
 * card-stack grammar."
 *
 * That is a fair reading of what it was. What changed:
 *
 *   IDENTITY, BELONGING AND ACCOUNT ARE ONE COMPOSITION, not three cards.
 *   The navy field carries the real wordmark, the member's name at display
 *   size, when they joined, the community they belong to with their role —
 *   and the account row. Putting the account row IN the field is what gets it
 *   above the fold on a 390x844 without demoting anything: it is identity, and
 *   it belongs with identity rather than at the bottom of a scroll.
 *
 *   THE INSTRUMENT IS THE REAL ONE, AND IT IS BIG. `LivingWeProgress` at 150px
 *   on the open goal, not a hairline track. It is the product's signature
 *   progress instrument and this is a page about progress.
 *
 *   GOALS ARE COMPACT ROWS, NOT CARDS. One row per goal: what it is, the
 *   member's own exact part, and — for an open goal — where the community
 *   stands. Four cards became four rows and a rule.
 *
 *   THE REAL FULL WORDMARK. The previous revision drew the letters "WE STAY
 *   FIT" as text. `/you` already renders `WsfWordmark`, so the target does.
 *
 * ── WHAT THIS PAGE REFUSES, AND WHY ──────────────────────────────────────
 *
 * The route is `/you`. There is no `/profile`; `/profile-setup` is a signup
 * step. Today `/you` is 74 lines, calls no callable, and shows a raw email and
 * Sign out over two thirds of empty screen.
 *
 * WHAT IS PROVABLE TODAY, with no new backend:
 *   `wsfMemberProfiles/{uid}` is owner-readable (`allow read: if
 *   request.auth.uid == uid`) and carries `displayName` and `createdAt`. So a
 *   name and a join month are real. `wsfMyCommunities` gives the community,
 *   role and member count. `wsfListGoals` with `includeHistory` gives open and
 *   closed goals, each with the member's own part and the shared total.
 *
 * NO PHOTO AND NO QUOTE. Nothing stores either.
 *
 * NO STREAK, NO DATED ACTIVITY, NO PER-WEEK COUNT. `wsfContributions` and
 * `wsfGoalMemberTotals` are returned by no callable and `firestore.rules`
 * denies them, so "45 squats this week" and "6 day streak" are a documented
 * seam, not a drawing.
 *
 * NO PERSONAL SCORE, NO RANK, NO COMPARISON.
 *
 * NO "YOU MOVED US FROM 216 TO 261". That is not a missing callable, it is
 * arithmetic — and it is arithmetic over a window that contains everybody who
 * wrote in it. The page shows the member's exact own credit and the current
 * shared state, separately labelled, and makes no causal claim joining them.
 *
 * NO SHARE CONTROL. The only share path in the product shares a GOAL's public
 * display link; nothing shares a profile.
 *
 * NO LEAVE CONTROL. `wsfLeaveCommunity` works, and deliberately lives on
 * Community. Duplicating a destructive action is how it gets pressed by
 * accident.
 *
 * ONE ACCOUNT ACTION, BECAUSE THERE IS ONE. Sign out. A control with no
 * capability behind it is the thing this atlas refuses everywhere else.
 *
 * The explanatory copy that used to sit on the page — "Yours alone, and never
 * compared" — is gone from the drawing and lives in the truth table in this
 * package's README, where it belongs: it told the member nothing they could
 * act on and read as the product reassuring itself.
 */

const ME = {
  displayName: 'Devin Simpson',
  email: 'devin@example.com',
  /** wsfMemberProfiles/{uid}.createdAt — owner-readable under the rules. */
  memberSince: 'August 2026',
  community: {
    name: 'Alpharetta Morning Movers',
    role: 'foundingChampion',
    memberCount: 14,
  },
  open: [
    { title: 'October Squat Challenge', unit: 'squats', target: 5000, sharedTotal: 1847, yourPart: 120 },
    { title: 'Step-ups round', unit: 'step-ups', target: 2000, sharedTotal: 640, yourPart: 45 },
  ],
  finished: [
    { title: 'September Push-up Push', unit: 'push-ups', yourPart: 260, reached: true },
    { title: 'Summer Step Round', unit: 'steps', yourPart: 8400, reached: true },
  ],
};

function useBox() {
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0 && (!box || box.width !== width || box.height !== height)) {
      setBox({ width, height });
    }
  };
  return { box, onLayout, compact: box !== null && box.height < 700 };
}

function FieldTexture() {
  return (
    <View pointerEvents="none" style={s.texture}>
      <View style={[s.band, s.band1]} />
      <View style={[s.band, s.band2]} />
      <View style={[s.band, s.band3]} />
      <View style={s.glow} />
    </View>
  );
}

function n(v: number): string {
  return v.toLocaleString('en-US');
}

/**
 * ONE GOAL, ONE ROW. Three facts on two lines: what it is, the member's exact
 * own part, and where the community stands. The own part is the emphasised
 * one because this is their page; the shared total sits beside it, plainly
 * labelled as the community's, so the two can never be read as the same
 * number.
 */
function GoalRow({
  title,
  unit,
  yourPart,
  sharedTotal,
  target,
  reached,
}: {
  title: string;
  unit: string;
  yourPart: number;
  sharedTotal?: number;
  target?: number;
  reached?: boolean;
}) {
  return (
    <View style={s.row}>
      <View style={s.rowHead}>
        <Text style={s.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {reached ? <Text style={s.rowReached}>Reached</Text> : null}
      </View>
      <View style={s.rowFacts}>
        <View style={s.rowFact}>
          <Text style={s.rowFactLabel}>YOUR PART</Text>
          <Text style={s.rowMine}>{`${n(yourPart)} ${unit}`}</Text>
        </View>
        {sharedTotal !== undefined && target !== undefined ? (
          <View style={s.rowFact}>
            <Text style={s.rowFactLabel}>THE COMMUNITY</Text>
            <Text style={s.rowShared}>{`${n(sharedTotal)} of ${n(target)}`}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * THE MEMBER TAB BAR. You is a shell tab, so a target that leaves it out is a
 * target of a screen the product never renders. The raised MOVE control is the
 * shell's own shape, and the bar's height here is the shell's exported body
 * measurement so the content above it clears by the same margin the real one
 * demands.
 */
function Tabs() {
  const items = ['Home', 'Community', 'MOVE', 'Progress', 'You'] as const;
  return (
    <View style={s.tabs}>
      {items.map((label) => {
        if (label === 'MOVE') {
          return (
            <View key={label} style={s.tabMoveWrap}>
              <View style={s.tabMove}>
                <Text style={s.tabMoveText}>MOVE</Text>
              </View>
            </View>
          );
        }
        const on = label === 'You';
        return (
          <View key={label} style={s.tab}>
            <View style={[s.tabDot, on ? s.tabDotOn : null]} />
            <Text style={[s.tabText, on ? s.tabTextOn : null]}>{label}</Text>
          </View>
        );
      })}
    </View>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={s.sectionLabel}>{children}</Text>;
}

/** The account row. In the field, so it is above the fold on every phone. */
function AccountRow({ email }: { email: string }) {
  return (
    <View style={s.account}>
      <View style={s.accountText}>
        <Text style={s.accountLabel}>SIGNED IN AS</Text>
        <Text style={s.accountEmail} numberOfLines={1}>
          {email}
        </Text>
      </View>
      <View style={s.signOut}>
        <Text style={s.signOutText}>Sign out</Text>
      </View>
    </View>
  );
}

function Field({
  compact,
  frameHeight,
  grow,
  children,
}: {
  compact: boolean;
  frameHeight: number;
  grow: number;
  children: React.ReactNode;
}) {
  const minHeight = compact || frameHeight === 0 ? undefined : Math.round(frameHeight * grow);
  return (
    <View style={[s.field, compact ? s.fieldCompact : null, minHeight ? { minHeight } : null]}>
      <FieldTexture />
      <View style={s.fieldTop}>
        <WsfWordmark variant="white" height={compact ? 15 : 17} />
        <Text style={s.pageTag}>You</Text>
      </View>
      {children}
    </View>
  );
}

export function YouTarget({
  state,
}: {
  state: 'member' | 'noCommunity' | 'loading' | 'failed' | 'signedOut';
}) {
  const { box, onLayout, compact } = useBox();
  const frameHeight = box?.height ?? 0;
  const lead = ME.open[0]!;
  const meta = [roleCardLabel(ME.community.role), memberCountLabel(ME.community.memberCount)]
    .filter((p): p is string => Boolean(p))
    .join(' · ');

  return (
    <View style={s.screen} onLayout={onLayout} testID={`wsf-target-you-${state}`}>
      <ScrollView contentContainerStyle={s.body}>
        {state === 'member' ? (
          <>
            <Field compact={compact} frameHeight={frameHeight} grow={0.52}>
              <Text style={[compact ? display.md : display.lg, s.name]}>{ME.displayName}</Text>
              <Text style={s.since}>{`Member since ${ME.memberSince}`}</Text>
              {/*
                BELONGING, IN THE SAME COMPOSITION AS IDENTITY — not a card
                under it. Who they are and who they move with is one thought.
              */}
              <View style={s.belong}>
                <Text style={s.belongName}>{ME.community.name}</Text>
                {meta ? <Text style={s.belongMeta}>{meta}</Text> : null}
              </View>
              <AccountRow email={ME.email} />
            </Field>

            <View style={[s.sheet, compact ? s.sheetCompact : null]}>
              {/*
                THE ONE BIG INSTRUMENT, on the goal that is open now. Their own
                part is stated as their own; the fill is the community's
                confirmed progress. Two labels, two numbers, no arithmetic
                joining them into a claim about cause.
              */}
              <View style={s.lead}>
                <View style={s.leadWe}>
                  <LivingWeProgress
                    completed={lead.sharedTotal}
                    target={lead.target}
                    unit={lead.unit}
                    width={150}
                    surface="light"
                  />
                </View>
                <View style={s.leadText}>
                  <Text style={s.leadTitle}>{lead.title}</Text>
                  <Text style={s.leadMineLabel}>YOUR PART</Text>
                  <Text style={s.leadMine}>{`${n(lead.yourPart)} ${lead.unit}`}</Text>
                  <Text style={s.leadShared}>
                    {`The community is at ${n(lead.sharedTotal)} of ${n(lead.target)}.`}
                  </Text>
                </View>
              </View>

              {/*
                THE LEAD IS NOT REPEATED. The composition above IS the first
                open goal, so the list below carries the rest. Drawing it in
                both places put the same two numbers on the screen twice and
                made the spotlight look like decoration rather than the goal
                it actually is. With only one open goal there is no list.
              */}
              {ME.open.length > 1 ? (
                <>
                  <SectionLabel>ALSO OPEN</SectionLabel>
                  {ME.open.slice(1).map((g) => (
                    <GoalRow
                      key={g.title}
                      title={g.title}
                      unit={g.unit}
                      yourPart={g.yourPart}
                      sharedTotal={g.sharedTotal}
                      target={g.target}
                    />
                  ))}
                </>
              ) : null}

              {/*
                FINISHED GOALS KEEP THE MEMBER'S OWN PART AND NOTHING ELSE. No
                date — the product cannot read one — and no ordering claim.
              */}
              <SectionLabel>FINISHED</SectionLabel>
              {ME.finished.map((g) => (
                <GoalRow
                  key={g.title}
                  title={g.title}
                  unit={g.unit}
                  yourPart={g.yourPart}
                  reached={g.reached}
                />
              ))}
            </View>
          </>
        ) : null}

        {state === 'noCommunity' ? (
          <>
            <Field compact={compact} frameHeight={frameHeight} grow={0.52}>
              <Text style={[compact ? display.md : display.lg, s.name]}>{ME.displayName}</Text>
              <Text style={s.since}>{`Member since ${ME.memberSince}`}</Text>
              <AccountRow email={ME.email} />
            </Field>
            <View style={[s.sheet, compact ? s.sheetCompact : null]}>
              {/*
                NOTHING RECORDED YET IS NOT A FAILURE, and the page does not
                draw an empty instrument to suggest one. It says the true thing
                and names the one action that changes it.
              */}
              <Text style={s.emptyTitle}>You’re not in a community yet.</Text>
              <Text style={s.emptyBody}>
                Your part is counted inside a community’s goals. Join one with a code, or start
                your own.
              </Text>
              <View style={s.primary}>
                <Text style={s.primaryText}>Find a community</Text>
              </View>
            </View>
          </>
        ) : null}

        {state === 'loading' ? (
          <>
            <Field compact={compact} frameHeight={frameHeight} grow={0.42}>
              <View style={[s.skelOnNavy, { width: '62%', height: 30 }]} />
              <View style={[s.skelOnNavy, { width: '40%', height: 13 }]} />
            </Field>
            <View style={[s.sheet, compact ? s.sheetCompact : null]}>
              <View style={s.skelRow}>
                <View style={[s.skel, { width: 150, height: 150, borderRadius: 16 }]} />
                <View style={s.skelCol}>
                  <View style={[s.skel, { width: '80%', height: 16 }]} />
                  <View style={[s.skel, { width: '50%', height: 12 }]} />
                  <View style={[s.skel, { width: '65%', height: 22 }]} />
                </View>
              </View>
              {[0, 1].map((i) => (
                <View key={i} style={[s.skel, { width: '100%', height: 62, borderRadius: 14 }]} />
              ))}
            </View>
          </>
        ) : null}

        {state === 'failed' ? (
          <>
            <Field compact={compact} frameHeight={frameHeight} grow={0.52}>
              <Text style={[compact ? display.md : display.lg, s.name]}>{ME.displayName}</Text>
              <Text style={s.since}>{`Member since ${ME.memberSince}`}</Text>
              <AccountRow email={ME.email} />
            </Field>
            <View style={[s.sheet, compact ? s.sheetCompact : null]}>
              {/*
                THE READ FAILED; THE ACCOUNT DID NOT. Identity and Sign out are
                above this and unaffected, so a failed goal read never strands
                somebody on a page they cannot leave.
              */}
              <View style={s.errorBox}>
                <Text style={s.errorTitle}>We couldn’t load your goals.</Text>
                <Text style={s.errorBody}>
                  Nothing of yours has changed. Check your connection and try again.
                </Text>
              </View>
              <View style={s.primary}>
                <Text style={s.primaryText}>Try again</Text>
              </View>
            </View>
          </>
        ) : null}

        {state === 'signedOut' ? (
          <>
            <Field compact={compact} frameHeight={frameHeight} grow={0.42}>
              <Text style={[compact ? display.md : display.lg, s.name]}>You</Text>
              <Text style={s.since}>Sign in to see your part and your communities.</Text>
            </Field>
            <View style={[s.sheet, compact ? s.sheetCompact : null]}>
              <View style={s.primary}>
                <Text style={s.primaryText}>Sign in</Text>
              </View>
              <Text style={s.emptyBody}>
                What you record is yours. It is counted into your community’s shared total and is
                never shown beside anybody else’s.
              </Text>
            </View>
          </>
        ) : null}
      </ScrollView>
      <Tabs />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CREAM },
  body: { flexGrow: 1 },

  field: {
    backgroundColor: NAVY,
    paddingHorizontal: 20,
    paddingTop: 26,
    paddingBottom: 22,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    gap: 6,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    ...elevation.hero,
  },
  fieldCompact: { paddingTop: 16, paddingBottom: 16, gap: 4 },
  texture: { ...StyleSheet.absoluteFillObject },
  band: {
    position: 'absolute',
    height: 26,
    width: 420,
    backgroundColor: 'rgba(145,203,125,0.10)',
    transform: [{ rotate: '-18deg' }],
  },
  band1: { top: 6, left: 120 },
  band2: { top: 52, left: 160, backgroundColor: 'rgba(145,203,125,0.07)' },
  band3: { top: 98, left: 200, backgroundColor: 'rgba(145,203,125,0.05)' },
  glow: {
    position: 'absolute',
    right: -70,
    top: -90,
    width: 230,
    height: 230,
    borderRadius: 115,
    backgroundColor: 'rgba(34,197,94,0.10)',
  },
  fieldTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 30,
    marginBottom: 'auto',
  },
  pageTag: {
    color: ON_NAVY_MUTED,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  name: { color: ON_NAVY },
  since: { color: ON_NAVY_MUTED, fontSize: 13, fontWeight: '600' },

  belong: {
    marginTop: 10,
    backgroundColor: 'rgba(0,0,0,0.24)',
    borderRadius: 16,
    borderLeftWidth: 4,
    borderLeftColor: ACTION_GREEN,
    paddingHorizontal: 13,
    paddingVertical: 11,
    gap: 2,
  },
  belongName: { color: ON_NAVY, fontSize: 17, lineHeight: 22, fontWeight: '900' },
  belongMeta: { color: ON_NAVY_MUTED, fontSize: 12, lineHeight: 17 },

  account: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(247,245,240,0.16)',
    paddingTop: 12,
  },
  accountText: { flexShrink: 1, minWidth: 0, gap: 1 },
  accountLabel: {
    color: ON_NAVY_MUTED,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  accountEmail: { color: ON_NAVY, fontSize: 13.5, fontWeight: '700' },
  signOut: {
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(247,245,240,0.4)',
    paddingHorizontal: 14,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutText: { color: ON_NAVY, fontSize: 13.5, fontWeight: '800' },

  /*
    THE SHEET CLEARS THE BAR. `paddingBottom` is the shell's own body
    measurement (6 + 48 + 10) plus the raised MOVE control's 24px overhang,
    so the last row is readable at rest instead of sitting under the bar and
    needing a scroll nobody knows to make.
  */
  sheet: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 6 + 48 + 10 + 24,
    gap: 10,
  },
  sheetCompact: { paddingTop: 12, gap: 8 },

  lead: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  leadWe: { alignItems: 'center', justifyContent: 'center' },
  leadText: { flexShrink: 1, minWidth: 0, gap: 1 },
  leadTitle: { color: NAVY, fontSize: 15.5, lineHeight: 20, fontWeight: '900' },
  leadMineLabel: {
    color: INK_QUIET,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 1.4,
    marginTop: 6,
  },
  leadMine: { color: ACTION_GREEN_DEEP, fontSize: 24, lineHeight: 29, fontWeight: '900' },
  leadShared: { color: INK_QUIET, fontSize: 12.5, lineHeight: 17, marginTop: 4 },

  sectionLabel: {
    color: INK_QUIET,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginTop: 8,
  },

  row: {
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
    paddingTop: 9,
    paddingBottom: 3,
    gap: 5,
  },
  rowHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  rowTitle: { color: NAVY, fontSize: 14.5, fontWeight: '800', flexShrink: 1, minWidth: 0 },
  rowReached: { color: ACTION_GREEN_DEEP, fontSize: 11, fontWeight: '900', letterSpacing: 0.4 },
  rowFacts: { flexDirection: 'row', gap: 22 },
  rowFact: { gap: 1 },
  rowFactLabel: { color: INK_QUIET, fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  rowMine: { color: NAVY, fontSize: 15, fontWeight: '900' },
  rowShared: { color: INK_QUIET, fontSize: 15, fontWeight: '700' },

  primary: {
    backgroundColor: ACTION_GREEN,
    borderRadius: 16,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    ...elevation.action,
  },
  primaryText: { color: ON_ACTION, fontSize: 17, fontWeight: '900' },

  emptyTitle: { color: NAVY, fontSize: 20, lineHeight: 26, fontWeight: '900' },
  emptyBody: { color: INK_QUIET, fontSize: 13.5, lineHeight: 19 },

  errorBox: {
    backgroundColor: '#FBEFEF',
    borderRadius: 14,
    borderLeftWidth: 4,
    borderLeftColor: ERROR_RED,
    paddingHorizontal: 13,
    paddingVertical: 11,
    gap: 3,
  },
  errorTitle: { color: ERROR_RED, fontSize: 14.5, lineHeight: 19, fontWeight: '900' },
  errorBody: { color: INK_QUIET, fontSize: 12.5, lineHeight: 17 },

  skel: { backgroundColor: '#E9E5DC', borderRadius: 6 },
  skelOnNavy: { backgroundColor: 'rgba(247,245,240,0.14)', borderRadius: 6 },
  skelRow: { flexDirection: 'row', gap: 16, alignItems: 'center' },

  /* the shell's own bar, at the shell's own measurements */
  tabs: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    backgroundColor: SURFACE,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 10,
    minHeight: 6 + 48 + 10,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 48 },
  tabDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'transparent' },
  tabDotOn: { backgroundColor: ACTION_GREEN_DEEP },
  tabText: { color: INK_QUIET, fontSize: 10.5, fontWeight: '700' },
  tabTextOn: { color: NAVY, fontWeight: '900' },
  tabMoveWrap: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  /** Lifts into the scroll area exactly as the shell's does. */
  tabMove: {
    marginTop: -22,
    minWidth: 62,
    minHeight: 62,
    borderRadius: 31,
    backgroundColor: ACTION_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.action,
  },
  tabMoveText: { color: ON_ACTION, fontSize: 12.5, fontWeight: '900', letterSpacing: 0.4 },
  skelCol: { flexShrink: 1, minWidth: 0, gap: 8, flexGrow: 1 },
});
