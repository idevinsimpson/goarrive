import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  anonymousRemainder,
  bannerSupport,
  canDrawLivingWe,
  effectiveTotal,
  goalFigures,
  goalMeta,
  goalPill,
  goalsCountFact,
  knownMemberCount,
  peopleLabel,
  roleFact,
  type CommunityParityProps,
  type DrawableGoal,
  type ParityGoal,
  type PillTone,
} from './communityParityTypes';
import { initialsOf, isChampionRole } from './CommunityPresence';
import { NAVY, PROGRESS_GREEN, SURFACE } from './kit';
import { LivingWeProgress } from './LivingWeProgress';
import { MEMBER_TAB_BAR_BODY, MEMBER_TAB_MOVE_OVERHANG } from './MemberTabBar';
import { fillRatioAttribute, formatCount } from './progressFormat';

/**
 * COMMUNITY PARITY VIEW — the frozen Lovable Community reference
 * (`e15b9fa0…` @ `d4f60624`, `src/demo/screens/community.tsx` + `src/styles.css`)
 * as a PURE, route-agnostic presentation component.
 *
 * Director release COMMUNITY-PRESENTATION-ACCELERATOR-1 (#447 `5840798701`),
 * with the Director-approved data mapping (`5840935220`). It receives already
 * resolved canonical facts and callbacks. It makes no read, owns no route or
 * overlay, holds no timer and touches no auth or storage; W9's route wires it.
 *
 * THE HIERARCHY IS THE REFERENCE'S, literally:
 *   1. the navy identity banner (supporting line · name · descriptor · facts)
 *   2. the facts row: Members · Your role · Goals
 *   3. Your communities: the joined-community chips, then Join and Start
 *   4. This period: the featured goal with its Living WE, then the other open
 *      goals, labelled separately
 *   5. Goal history: "What we've done together"
 *   6. Members: the named roster, then the anonymous remainder when it is known
 *
 * TRUTH OVER DENSITY. Lovable's free-form place and descriptor have no
 * canonical field, so the banner carries the group type and join policy where
 * they read naturally and leaves the slot out otherwise (an intentional,
 * recorded reference difference). A fact whose read failed is shown as not
 * known — never as zero — and the Goals count appears only for a fully loaded
 * collection. No sample community is added to fill the chip row, and nobody
 * is marked "(you)": the roster read carries no uid to say who that is.
 *
 * HEADINGS: the community's name is the page heading (level 1, as the route
 * that hosts this view has no other); each section title is level 2.
 */
export function CommunityParityView(props: CommunityParityProps) {
  const {
    displayName,
    groupType,
    joinPolicy,
    memberCount,
    role,
    goals,
    history,
    roster,
    testID = 'wsf-community-parity',
  } = props;
  const support = bannerSupport(groupType, joinPolicy);
  const goalsCount = goalsCountFact(goals, history);
  const members = knownMemberCount(memberCount);
  const roleText = roleFact(role);

  return (
    <View style={s.screen} testID={testID}>
      <ScrollView contentContainerStyle={s.body}>
        {/* 1–2 · the identity banner and its facts */}
        <View style={s.banner} testID="wsf-parity-banner">
          <View style={s.bannerRing} pointerEvents="none" />
          {support.eyebrow ? (
            <Text style={s.bannerEyebrow} testID="wsf-parity-banner-eyebrow">
              {support.eyebrow.toUpperCase()}
            </Text>
          ) : null}
          <Text style={s.bannerName} accessibilityRole="header" aria-level={1} testID="wsf-parity-name">
            {displayName}
          </Text>
          {support.descriptor ? (
            <Text style={s.bannerSub} testID="wsf-parity-descriptor">
              {support.descriptor}
            </Text>
          ) : null}
          <View style={s.facts} testID="wsf-parity-facts">
            <Fact label="MEMBERS" value={members === null ? null : formatCount(members)} testID="wsf-parity-fact-members" />
            <Fact label="YOUR ROLE" value={roleText} testID="wsf-parity-fact-role" />
            <Fact label="GOALS" value={goalsCount === null ? null : formatCount(goalsCount)} testID="wsf-parity-fact-goals" />
          </View>
        </View>

        {/* 3 · your communities */}
        <View style={s.switcher} testID="wsf-parity-switcher">
          <Text style={s.eyebrow}>YOUR COMMUNITIES</Text>
          {props.communities.state === 'loading' ? (
            <Text style={[s.mutedSmall, s.switchNote]} testID="wsf-parity-communities-loading">
              Loading your communities…
            </Text>
          ) : null}
          {props.communities.state === 'failed' ? (
            <ReadFailed
              text="Your communities couldn’t be loaded just now."
              onRetry={props.onRetryCommunities}
              testID="wsf-parity-communities-failed"
            />
          ) : null}
          <View style={s.switchList}>
            {(props.communities.state === 'loaded' ? props.communities.value : []).map((c) => {
              const on = c.groupId === props.groupId;
              return (
                <Pressable
                  key={c.groupId}
                  onPress={on ? undefined : () => props.onSelectCommunity(c.groupId)}
                  accessibilityRole="button"
                  aria-pressed={on}
                  accessibilityLabel={on ? `${c.displayName}, showing now` : `Show ${c.displayName}`}
                  style={[s.chip, on ? s.chipOn : null]}
                  testID={`wsf-parity-chip-${c.groupId}`}
                >
                  {on ? <Text style={[s.chipGlyph, s.chipTextOn]}>✓</Text> : null}
                  <Text style={[s.chipText, on ? s.chipTextOn : null]} numberOfLines={1}>
                    {c.displayName}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              onPress={props.onJoin}
              accessibilityRole="button"
              accessibilityLabel="Join a community"
              style={[s.chip, s.chipGhost]}
              testID="wsf-parity-join"
            >
              <Text style={[s.chipGlyph, s.chipTextGhost]}>＋</Text>
              <Text style={[s.chipText, s.chipTextGhost]}>Join</Text>
            </Pressable>
            <Pressable
              onPress={props.onStart}
              accessibilityRole="button"
              accessibilityLabel="Start a community"
              style={[s.chip, s.chipGhost]}
              testID="wsf-parity-start"
            >
              <Text style={[s.chipGlyph, s.chipTextGhost]}>＋</Text>
              <Text style={[s.chipText, s.chipTextGhost]}>Start</Text>
            </Pressable>
          </View>
        </View>

        {/* 4 · this period */}
        <View style={s.period} testID="wsf-parity-period">
          <PeriodBlock {...props} />
        </View>

        {/* 5 · goal history */}
        {history.state === 'unavailable' ? null : (
          <View style={s.block} testID="wsf-parity-history">
            <Text style={s.eyebrow}>GOAL HISTORY</Text>
            <Text style={s.h2} accessibilityRole="header" aria-level={2}>
              What we’ve done together
            </Text>
            {history.state === 'loading' ? (
              <Text style={s.muted} testID="wsf-parity-history-loading">
                Loading past goals…
              </Text>
            ) : history.state === 'failed' ? (
              <ReadFailed
                text="Past goals couldn’t be loaded just now."
                onRetry={props.onRetryHistory}
                testID="wsf-parity-history-failed"
              />
            ) : history.value.length === 0 ? (
              <Text style={s.muted} testID="wsf-parity-history-empty">
                No past goals yet.
              </Text>
            ) : (
              <View style={s.timeline}>
                {history.value.map((g) => (
                  <TimelineItem key={g.goalId} goal={g} onOpenGoal={props.onOpenGoal} />
                ))}
              </View>
            )}
          </View>
        )}

        {/* 6 · members */}
        <View style={s.block} testID="wsf-parity-roster">
          <Text style={s.eyebrow}>MEMBERS</Text>
          <Text style={s.h2} accessibilityRole="header" aria-level={2} testID="wsf-parity-roster-count">
            {members === null ? 'Members' : peopleLabel(members)}
          </Text>
          <RosterBody {...props} />
        </View>
      </ScrollView>
    </View>
  );
}

function Fact({ label, value, testID }: { label: string; value: string | null; testID: string }) {
  return (
    <View style={s.fact} testID={testID}>
      <Text style={s.factDt}>{label}</Text>
      <Text style={s.factDd} accessibilityLabel={value === null ? `${label}: not known` : undefined}>
        {value === null ? '—' : value}
      </Text>
    </View>
  );
}

function PeriodBlock(props: CommunityParityProps) {
  const { goals } = props;
  if (goals.state === 'loading') {
    return (
      <>
        <Text style={s.eyebrow}>THIS PERIOD</Text>
        <Text style={s.muted} testID="wsf-parity-goals-loading">
          Loading this period’s goal…
        </Text>
      </>
    );
  }
  if (goals.state === 'failed') {
    return (
      <>
        <Text style={s.eyebrow}>THIS PERIOD</Text>
        <ReadFailed
          text="This community’s goals couldn’t be loaded just now."
          onRetry={props.onRetryGoals}
          testID="wsf-parity-goals-failed"
        />
      </>
    );
  }
  const { featured, otherOpen } = goals.value;
  // An unknown role makes no claim about who can start the next goal.
  const nextStep =
    props.role === null
      ? ''
      : isChampionRole(props.role)
        ? ' Set one up from Manage community in the menu.'
        : ' Your Champion can start the next goal.';
  return (
    <>
      <View style={s.sectionHeading}>
        <View style={s.sectionHeadingText}>
          <Text style={s.eyebrow}>THIS PERIOD</Text>
          <Text style={s.h2} accessibilityRole="header" aria-level={2} testID="wsf-parity-period-title">
            {featured ? featured.title : 'No active goal'}
          </Text>
        </View>
        {featured ? (
          <View style={s.headingPill}>
            <StatusPill goal={featured} testID="wsf-parity-period-status" />
          </View>
        ) : null}
      </View>
      {featured ? (
        <FeaturedGoal goal={featured} onOpenGoal={props.onOpenGoal} />
      ) : (
        <Text style={s.muted} testID="wsf-parity-no-goal">
          {`No shared target is being counted.${nextStep}`}
        </Text>
      )}
      {otherOpen.length > 0 ? (
        <View style={s.alsoOpen} accessibilityLabel="Also open" testID="wsf-parity-also-open">
          {otherOpen.map((g) => (
            <GoalRow
              key={g.goalId}
              goal={g}
              onOpenGoal={props.onOpenGoal}
              style={s.alsoOpenRow}
              testID={`wsf-parity-also-open-${g.goalId}`}
            >
              <View style={s.flex1}>
                <Text style={s.alsoOpenTitle} numberOfLines={2}>
                  {g.title}
                </Text>
                <Text style={s.alsoOpenSub}>
                  {g.windowLabel ? `${g.windowLabel} · ${goalFigures(g)}` : goalFigures(g)}
                </Text>
              </View>
              <StatusPill goal={g} inRow />
            </GoalRow>
          ))}
        </View>
      ) : null}
    </>
  );
}

function FeaturedGoal({ goal, onOpenGoal }: { goal: ParityGoal; onOpenGoal?: (goalId: string) => void }) {
  const drawable = canDrawLivingWe(goal) ? goal : null;
  const body = drawable ? (
    <View style={s.periodRow} testID="wsf-parity-period-row">
      <View style={[s.wePlate, drawable.total.state === 'lastKnown' ? s.notLive : null]}>
        <LivingWeProgress
          completed={drawable.total.value}
          target={drawable.target}
          unit={drawable.unit}
          width={88}
          surface="dark"
          testID="wsf-parity-living-we"
        />
      </View>
      <View style={s.flex1}>
        <GoalNumbers goal={drawable} />
        {goal.windowLabel ? <Text style={[s.mutedSmall, s.periodWindow]}>{goal.windowLabel}</Text> : null}
      </View>
    </View>
  ) : (
    <View style={s.unknownBox} testID="wsf-parity-period-unknown">
      <Text style={s.unknownStrong}>{instrumentlessHeadline(goal)}</Text>
      <Text style={s.mutedSmall}>{instrumentlessDetail(goal)}</Text>
      {goal.windowLabel ? <Text style={[s.mutedSmall, s.periodWindow]}>{goal.windowLabel}</Text> : null}
    </View>
  );
  if (!onOpenGoal) return body;
  // The button's name carries the figures: a name of only "Open <title>" would
  // hide the instrument and the numbers it wraps from a screen reader.
  const figures = drawable ? `${goalFigures(goal)}, ${goalMeta(drawable).strong}` : goalFigures(goal);
  return (
    <Pressable
      onPress={() => onOpenGoal(goal.goalId)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${goal.title}. ${figures}`}
      testID="wsf-parity-open-featured"
    >
      {body}
    </Pressable>
  );
}

/** A featured goal with no instrument: why, in plain words. */
function instrumentlessHeadline(goal: ParityGoal): string {
  const t = effectiveTotal(goal.total);
  if (t.state === 'loading') return 'Loading the total…';
  if (t.state === 'failed') return 'Progress unknown';
  return goalFigures(goal);
}
function instrumentlessDetail(goal: ParityGoal): string {
  const t = effectiveTotal(goal.total);
  if (t.state === 'loading') return 'The confirmed total is on its way.';
  if (t.state === 'failed') return 'We can’t confirm the current total. Nothing is shown as zero.';
  return 'No target set — no progress instrument.';
}

function GoalNumbers({ goal }: { goal: DrawableGoal }) {
  const meta = goalMeta(goal);
  const lastKnown = goal.total.state === 'lastKnown';
  // Rounded DOWN, so the bar can only read full once the goal is reached.
  const pct = Number(fillRatioAttribute(goal.total.value, goal.target)) * 100;
  return (
    <View testID="wsf-parity-goal-numbers">
      <View style={s.goalNumber}>
        <Text style={s.goalNumberStrong} testID="wsf-parity-total">
          {formatCount(goal.total.value)}
        </Text>
        <Text style={s.goalNumberSpan}>
          {`/ ${formatCount(goal.target)} ${lastKnown ? 'last known' : 'confirmed'}`}
        </Text>
      </View>
      <View style={s.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[s.trackFill, { width: `${pct}%` }]} testID="wsf-parity-track-fill" />
      </View>
      <View style={s.meta}>
        <Text style={s.metaStrong} testID="wsf-parity-meta-strong">
          {meta.strong}
        </Text>
        <Text style={s.metaSoft}>{meta.soft}</Text>
      </View>
    </View>
  );
}

/** A goal row: a button when it can open the goal, a plain row otherwise. */
function GoalRow({
  goal,
  onOpenGoal,
  style,
  testID,
  children,
}: {
  goal: ParityGoal;
  onOpenGoal?: (goalId: string) => void;
  style: object;
  testID: string;
  children: ReactNode;
}) {
  if (!onOpenGoal) {
    return (
      <View style={style} testID={testID}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => onOpenGoal(goal.goalId)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${goal.title}. ${goalFigures(goal)}, ${goalPill(goal).label}`}
      style={style}
      testID={testID}
    >
      {children}
    </Pressable>
  );
}

function TimelineItem({ goal, onOpenGoal }: { goal: ParityGoal; onOpenGoal?: (goalId: string) => void }) {
  const pill = goalPill(goal);
  const quiet = pill.tone === 'unfinished' || pill.tone === 'unknown' || pill.tone === 'pending';
  return (
    <GoalRow goal={goal} onOpenGoal={onOpenGoal} style={s.timelineItem} testID={`wsf-parity-history-${goal.goalId}`}>
      <View style={[s.dot, quiet ? s.dotQuiet : null]} />
      <View style={s.flex1}>
        <Text style={s.timelineTitle}>{goal.title}</Text>
        <Text style={s.timelineSub}>
          {goal.windowLabel ? `${goal.windowLabel} · ${goalFigures(goal)}` : goalFigures(goal)}
        </Text>
      </View>
      <StatusPill goal={goal} inRow />
    </GoalRow>
  );
}

function RosterBody(props: CommunityParityProps) {
  const { roster } = props;
  if (roster.state === 'loading') {
    return (
      <Text style={s.muted} testID="wsf-parity-roster-loading">
        Loading members…
      </Text>
    );
  }
  if (roster.state === 'failed') {
    return (
      <ReadFailed
        text="Members couldn’t be loaded just now."
        onRetry={props.onRetryRoster}
        testID="wsf-parity-roster-failed"
      />
    );
  }
  const remainder = anonymousRemainder(props.memberCount, roster);
  return (
    <>
      <View style={s.rosterList}>
        {roster.value.named.map((p) => (
          <View key={p.key} style={s.rosterRow} testID={`wsf-parity-member-${p.key}`}>
            <View style={s.avatar}>
              <Text style={s.avatarText}>{initialsOf(p.displayName)}</Text>
            </View>
            <Text style={s.rosterName} numberOfLines={1}>
              {p.displayName}
            </Text>
            {isChampionRole(p.role ?? undefined) ? <Text style={s.rosterBadge}>CHAMPION</Text> : <View />}
          </View>
        ))}
        {remainder !== null && remainder > 0 ? (
          <View style={s.rosterRow} testID="wsf-parity-anonymous">
            <View style={[s.avatar, s.avatarAnon]}>
              <PersonGlyph />
            </View>
            <Text style={s.rosterName}>
              {`${formatCount(remainder)} member${remainder > 1 ? 's' : ''} shown without names`}
            </Text>
            <View />
          </View>
        ) : null}
      </View>
      {!roster.value.complete && props.onShowMoreMembers ? (
        <Pressable
          onPress={props.onShowMoreMembers}
          accessibilityRole="button"
          style={s.moreButton}
          testID="wsf-parity-roster-more"
        >
          <Text style={s.moreText}>Show more members</Text>
        </Pressable>
      ) : null}
      <Text style={s.mutedSmall}>Names follow each member’s privacy choice for this community.</Text>
    </>
  );
}

/**
 * `inRow`: inside a history or also-open row the reference's pill is a <span>
 * that the row's own `span` rule (12 px, 0,1,1) outranks on size, so it reads
 * larger there than beside the period heading (10 px).
 */
function StatusPill({ goal, testID, inRow = false }: { goal: ParityGoal; testID?: string; inRow?: boolean }) {
  const pill = goalPill(goal);
  return (
    <View style={[s.pill, inRow ? s.pillInRow : null, PILL_BG[pill.tone]]} testID={testID}>
      <Text style={[s.pillText, inRow ? s.pillTextInRow : null, PILL_TEXT[pill.tone]]}>
        {pill.label.toUpperCase()}
      </Text>
    </View>
  );
}

function ReadFailed({ text, onRetry, testID }: { text: string; onRetry?: () => void; testID: string }) {
  return (
    <View style={s.failed} testID={testID} accessibilityRole={'alert' as never}>
      <Text style={s.failedText}>{text}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} accessibilityRole="button" style={s.retry} testID={`${testID}-retry`}>
          <Text style={s.retryText}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function PersonGlyph() {
  return (
    <View style={s.person} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={s.personHead} />
      <View style={s.personBody} />
    </View>
  );
}

/*
  TOKENS FROM THE FROZEN REFERENCE (Lovable `d4f60624`, src/styles.css),
  converted from oklch to hex so this view matches without editing the shared
  kit. Navy and confirmed green are the kit's own. The same conversions W6's
  YOU-PARITY-1 uses, so the two views agree.
*/
const BG = '#FBFAF4';
const MUTED_BG = '#EFEFE6';
const MUTED_FG = '#4B5C71';
const BORDER = '#D7DFE7';
const EYEBROW_GREEN = '#00741E';
const LINK_GREEN = '#005E19';
const META_GREEN = '#045819';
const PILL_GREEN_TEXT = '#014210';
const PILL_GREEN_BG = '#E0F0DB';
const BANNER_SUB = '#C2D8E5';
const BANNER_DT = '#A6C3D4';
const BANNER_RULE = 'rgba(255,255,255,0.18)';
/** color-mix(confirmed 14%, transparent) over navy. */
const BANNER_RING = 'rgba(145,203,125,0.14)';

const PILL_BG: Record<PillTone, object> = {
  open: { backgroundColor: PILL_GREEN_BG },
  reached: { backgroundColor: PILL_GREEN_BG },
  closedReached: { backgroundColor: NAVY },
  unfinished: { backgroundColor: MUTED_BG },
  scheduled: { backgroundColor: PILL_GREEN_BG },
  unknown: { backgroundColor: MUTED_BG },
  pending: { backgroundColor: MUTED_BG },
};
const PILL_TEXT: Record<PillTone, object> = {
  open: { color: PILL_GREEN_TEXT },
  reached: { color: PILL_GREEN_TEXT },
  closedReached: { color: PROGRESS_GREEN },
  unfinished: { color: MUTED_FG },
  scheduled: { color: PILL_GREEN_TEXT },
  unknown: { color: MUTED_FG },
  pending: { color: MUTED_FG },
};

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  body: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: MEMBER_TAB_BAR_BODY + MEMBER_TAB_MOVE_OVERHANG,
  },
  flex1: { flex: 1, minWidth: 0 },

  /*
    LINE HEIGHTS: the reference inherits Tailwind's preflight line-height of 1.5
    for everything it does not set, so text boxes are taller than React Native's
    defaults; these restate it where it moves the layout.
  */
  eyebrow: { color: EYEBROW_GREEN, fontSize: 11, lineHeight: 17, fontWeight: '800', letterSpacing: 1.32 },
  /*
    The banner's eyebrow is a <p> in the reference, so `.community-banner p`
    (14 px) outranks `.eyebrow` (11 px) on size, while `.eyebrow.light` keeps
    its colour. Measured on the reference original, not assumed.
  */
  bannerEyebrow: { color: PROGRESS_GREEN, fontSize: 14, lineHeight: 20, fontWeight: '800', letterSpacing: 1.68 },
  h2: { color: NAVY, fontSize: 21, lineHeight: 31, fontWeight: '400', marginTop: 2, marginBottom: 12 },
  muted: { color: MUTED_FG, fontSize: 14, lineHeight: 21 },
  mutedSmall: { color: MUTED_FG, fontSize: 12, lineHeight: 17 },

  banner: {
    marginHorizontal: -20,
    paddingHorizontal: 20,
    paddingTop: 26,
    paddingBottom: 20,
    backgroundColor: NAVY,
    overflow: 'hidden',
  },
  bannerRing: {
    position: 'absolute',
    right: -90,
    top: -90,
    width: 260,
    height: 260,
    borderRadius: 130,
    borderWidth: 40,
    borderColor: BANNER_RING,
  },
  bannerName: {
    color: SURFACE,
    fontSize: 31,
    lineHeight: 33,
    fontWeight: '400',
    marginTop: 4,
    marginBottom: 2,
  },
  bannerSub: { color: BANNER_SUB, fontSize: 14, lineHeight: 21 },
  facts: { marginTop: 18, flexDirection: 'row', gap: 8 },
  fact: { flex: 1, paddingTop: 8, borderTopWidth: 1, borderTopColor: BANNER_RULE },
  factDt: { color: BANNER_DT, fontSize: 10, lineHeight: 15, letterSpacing: 1 },
  factDd: { color: SURFACE, fontSize: 17, lineHeight: 25, fontWeight: '800', marginTop: 2 },

  switcher: { marginTop: 18 },
  switchList: { marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  switchNote: { marginTop: 6 },
  chip: {
    minHeight: 44,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: BORDER,
    borderRadius: 22,
    backgroundColor: SURFACE,
    maxWidth: '100%',
  },
  chipOn: { borderColor: NAVY, backgroundColor: NAVY },
  chipGhost: { borderStyle: 'dashed' },
  chipText: { color: NAVY, fontSize: 13, lineHeight: 19, fontWeight: '800', flexShrink: 1 },
  chipTextOn: { color: SURFACE },
  chipTextGhost: { color: LINK_GREEN },
  chipGlyph: { color: NAVY, fontSize: 13, fontWeight: '800' },

  period: { paddingTop: 26 },
  block: { paddingTop: 22, marginTop: 26 },
  sectionHeading: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  sectionHeadingText: { flex: 1, minWidth: 0 },
  /* The reference aligns the pill to the heading block's END, below the title's 12 px margin. */
  headingPill: { alignSelf: 'flex-end' },

  periodRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  wePlate: {
    width: 108,
    height: 92,
    borderRadius: 16,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  periodWindow: { marginTop: 6 },
  /* The reference's `.living-we.not-live`: a last-known figure is dimmed. */
  notLive: { opacity: 0.55 },
  goalNumber: { flexDirection: 'row', alignItems: 'baseline', gap: 7 },
  goalNumberStrong: { color: NAVY, fontSize: 28, lineHeight: 30, fontWeight: '700' },
  goalNumberSpan: { color: MUTED_FG, fontSize: 13, fontWeight: '700' },
  track: { height: 8, marginTop: 8, overflow: 'hidden', borderRadius: 10, backgroundColor: MUTED_BG },
  trackFill: { height: '100%', borderRadius: 10, backgroundColor: PROGRESS_GREEN },
  meta: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 14, rowGap: 2, marginTop: 5 },
  metaStrong: { color: META_GREEN, fontSize: 11, fontWeight: '800' },
  metaSoft: { color: NAVY, fontSize: 11 },

  unknownBox: { paddingVertical: 4, gap: 4 },
  unknownStrong: { color: NAVY, fontSize: 16, fontWeight: '800' },

  alsoOpen: { marginTop: 12, gap: 8 },
  alsoOpenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  alsoOpenTitle: { color: NAVY, fontSize: 14, lineHeight: 21, fontWeight: '700' },
  alsoOpenSub: { color: MUTED_FG, fontSize: 12, lineHeight: 18 },

  timeline: { marginLeft: 0, paddingLeft: 14, borderLeftWidth: 2, borderLeftColor: BORDER },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingTop: 10,
    paddingBottom: 14,
    paddingLeft: 8,
  },
  dot: {
    position: 'absolute',
    left: -22,
    top: 15,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: PROGRESS_GREEN,
    borderWidth: 2,
    borderColor: BG,
  },
  dotQuiet: { backgroundColor: BORDER },
  timelineTitle: { color: NAVY, fontSize: 16, lineHeight: 24, fontWeight: '800' },
  timelineSub: { color: MUTED_FG, fontSize: 12, lineHeight: 18, marginTop: 2 },

  pill: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, alignSelf: 'flex-start' },
  pillText: { fontSize: 10, lineHeight: 15, fontWeight: '800', letterSpacing: 0.3 },
  pillInRow: { marginTop: 2 },
  pillTextInRow: { fontSize: 12, lineHeight: 18 },

  rosterList: { marginBottom: 10 },
  rosterRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarAnon: { backgroundColor: MUTED_BG },
  avatarText: { color: SURFACE, fontSize: 11, fontWeight: '800' },
  rosterName: { flex: 1, minWidth: 0, color: NAVY, fontSize: 14, lineHeight: 21, fontWeight: '700' },
  rosterBadge: { color: LINK_GREEN, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  moreButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  moreText: { color: LINK_GREEN, fontSize: 13, fontWeight: '800' },

  failed: { gap: 6, paddingVertical: 4 },
  failedText: { color: NAVY, fontSize: 14, lineHeight: 20 },
  retry: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  retryText: { color: NAVY, fontSize: 14, fontWeight: '800', textDecorationLine: 'underline' },

  person: { width: 22, height: 22, alignItems: 'center', justifyContent: 'flex-end' },
  personHead: { width: 9, height: 9, borderRadius: 5, backgroundColor: MUTED_FG, marginBottom: 2 },
  personBody: { width: 16, height: 8, borderTopLeftRadius: 8, borderTopRightRadius: 8, backgroundColor: MUTED_FG },
});
