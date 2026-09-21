import { useState } from 'react';
import { type LayoutChangeEvent, ScrollView, StyleSheet, Text, View } from 'react-native';

import { LivingWeProgress } from '../LivingWeProgress';
import { TabGlyph } from '../TabGlyph';
import { memberCountLabel, roleCardLabel } from '../../labels';
import { fillRatio, formatCount, percentLabel, totalOfTargetLabel } from '../progressFormat';
import {
  ACTION_GREEN,
  CREAM,
  HAIRLINE,
  INK_QUIET,
  NAVY,
  ON_ACTION,
  ON_NAVY,
  ON_NAVY_MUTED,
  ON_NAVY_RULE,
  PROGRESS_GREEN,
  SURFACE,
  TEXT_MUTED,
  display,
  elevation,
} from '../kit';

/**
 * TARGETS FOR COMMUNITY. NOT IMPLEMENTED PAGES.
 *
 * COMMUNITY IS WHO THE "WE" IS. Home is what I do next; MOVE is me adding to
 * it. Community is the only surface whose subject is other people, so its job
 * is identity and shared record — not a second command centre and not an admin
 * directory.
 *
 * THREE THINGS THE CURRENT PRODUCT DOES THAT THESE DELIBERATELY UNDO:
 *
 *   THE LIST IS A DIRECTORY. Three identical cream cards reading "1 member"
 *   over a half-screen void, and a naked underlined link. Nothing says which
 *   community I am in right now, what it is doing, or that anyone is there.
 *
 *   THE DETAIL IS A SECOND HOME. A navy goal hero with the Living WE, the big
 *   total, the track and a green "Start moving" — Home's exact command-centre
 *   hierarchy, re-rendered one route over. Here the open goals are a compact
 *   live list instead, because MOVE already owns the act of contributing and
 *   the shell already carries it.
 *
 *   ADMINISTRATION OUTRANKS MEMORY. "Invite people" sits ABOVE "History", so
 *   the community's own past is the last thing it mentions about itself.
 *   These put what we've done above the tools and leave the tools quiet.
 *
 * EVERY FACT ON THESE FRAMES IS ONE THE BACKEND ALREADY SERVES:
 *
 *   wsfMyCommunities  -> displayName, role, memberCount
 *   wsfListGoals      -> title, target, unit, status, endsAt, reachedAt, and
 *                        (includeHistory) sharedTotal + closedAt
 *   wsfGoalRecentAdditions -> { amount, unit, at } and NOTHING else. The
 *                        server strips the uid and the name before publishing,
 *                        and its own callable test fixes the member route:
 *                        "ACTIVE MEMBER of an UNAUTHORIZED goal is allowed —
 *                        membership is its own route". So anonymous movement
 *                        is readable for EVERY community a member belongs to,
 *                        not only the display-authorized ones.
 *
 * WHAT THESE REFUSE, each for a reason that outlives the drawing:
 *
 *   NO FACES, NO NAMES, NO REACTIONS. The momentum strip is amounts and
 *   minutes. The product cannot say who moved, and a placeholder avatar on a
 *   screen whose whole job is to be true about other people is a lie with a
 *   border-radius.
 *
 *   NO COUNT OF PEOPLE MOVING. `memberCount` is a roll, not a presence: it
 *   says who belongs, never who is here. No surface counts contributors, and
 *   none is invented.
 *
 *   NO FOUNDED DATE. The community document has `createdAt`, but
 *   wsfMyCommunities does not return it. A masthead fact that needs a new
 *   backend field is a target that lies, so the masthead does without it.
 *
 *   NO STREAK, NO RANKING, NO HEALTH CLAIM, NO ENCOURAGE BUTTON. There is no
 *   capability behind an encouragement control, and a button that does
 *   nothing is worse than no button.
 */

/** Measured, not asked for: these render inside a frame, not the window. */
function useBox() {
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0 && (!box || box.width !== width || box.height !== height)) {
      setBox({ width, height });
    }
  };
  return {
    box,
    onLayout,
    compact: box !== null && box.height < 700,
    roomy: box !== null && box.height >= 820,
  };
}

/* ── fixture ─────────────────────────────────────────────────────────────── */

const CURRENT = {
  name: 'Alpharetta Morning Movers',
  role: 'foundingChampion',
  memberCount: 14,
  goal: { title: 'October Squat Challenge', unit: 'squats', target: 5000, total: 1847 },
  second: { title: 'Step-ups round', unit: 'step-ups', target: 2000, total: 612 },
};

/** amount + unit + minute. Exactly the three fields the server publishes. */
const MOMENTUM = [
  { amount: 20, unit: 'squats', ago: '4m' },
  { amount: 50, unit: 'squats', ago: '12m' },
  { amount: 15, unit: 'step-ups', ago: '31m' },
  { amount: 30, unit: 'squats', ago: '1h' },
];

const OTHERS = [
  { name: 'Sunrise Striders', memberCount: 8, line: 'No goal running' },
  {
    name: 'Westside Walkers',
    memberCount: 23,
    goal: { title: 'Spring Lap Round', unit: 'laps', target: 800, total: 617 },
  },
];

const HISTORY = [
  {
    title: 'September Push-up Push',
    unit: 'push-ups',
    target: 3000,
    total: 3142,
    when: 'Ended Aug 31',
    reached: true,
  },
  {
    title: 'Summer Step Streak',
    unit: 'steps',
    target: 100000,
    total: 104820,
    when: 'Ended Aug 6',
    reached: true,
  },
  {
    title: 'Spring Lap Round',
    unit: 'laps',
    target: 800,
    total: 617,
    when: 'Ended Jun 21',
    reached: false,
  },
];

/* ── shared pieces ───────────────────────────────────────────────────────── */

/** The five-slot shell, preserved exactly, with the raised MOVE action. */
function Tabs({ active }: { active: 'Home' | 'Community' }) {
  return (
    <View style={s.tabs}>
      {(
        [
          ['Home', 'home'],
          ['Community', 'community'],
        ] as const
      ).map(([label, glyph]) => (
        <View key={label} style={s.tab}>
          <View style={s.tabGlyphWrap}>
            <TabGlyph name={glyph} color={label === active ? NAVY : '#98A5B5'} />
          </View>
          <Text style={[s.tabLabel, label === active ? s.tabLabelOn : null]}>{label}</Text>
        </View>
      ))}
      <View style={s.move}>
        <Text style={s.moveText}>MOVE</Text>
      </View>
      {(
        [
          ['Progress', 'activity'],
          ['You', 'you'],
        ] as const
      ).map(([label, glyph]) => (
        <View key={label} style={s.tab}>
          <View style={s.tabGlyphWrap}>
            <TabGlyph name={glyph} color="#98A5B5" />
          </View>
          <Text style={s.tabLabel}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

/** A slim shared track. The fill is always the ratio the WE mark fills by. */
function Track({ total, target, dark }: { total: number; target: number; dark?: boolean }) {
  return (
    <View style={[s.track, dark ? s.trackDark : null]}>
      <View style={[s.trackFill, { width: `${Math.round(fillRatio(total, target) * 100)}%` }]} />
    </View>
  );
}

/**
 * Anonymous movement. Amount, unit, minute — the whole published record.
 * The eyebrow says what it is and, just as importantly, what it is not.
 */
function Momentum({ rows, dark }: { rows: typeof MOMENTUM; dark?: boolean }) {
  return (
    <View style={s.momentum}>
      <Text style={[s.eyebrow, dark ? s.eyebrowDark : null]}>RECENT MOVEMENT</Text>
      <View style={s.momentumRows}>
        {rows.map((r, i) => (
          <View key={i} style={[s.chip, dark ? s.chipDark : null]}>
            <Text style={[s.chipAmount, dark ? s.chipAmountDark : null]}>
              +{formatCount(r.amount)}
            </Text>
            <Text style={[s.chipUnit, dark ? s.chipUnitDark : null]}>{r.unit}</Text>
            <Text style={[s.chipAgo, dark ? s.chipAgoDark : null]}>{r.ago}</Text>
          </View>
        ))}
      </View>
      <Text style={[s.momentumNote, dark ? s.momentumNoteDark : null]}>
        What was added, and when. Never who.
      </Text>
    </View>
  );
}

/* ── 1 · the list ────────────────────────────────────────────────────────── */

/** The stable app header. It is the same in every state, including the ones
 *  that have no data: a page that loses its own identity while loading reads
 *  as a page that failed. */
function Header() {
  return (
    <>
      <View style={s.wordmarkRow}>
        <Text style={s.wordmark}>WE STAY FIT</Text>
      </View>
      <Text style={[display.md, s.pageTitle]}>Community</Text>
    </>
  );
}

/**
 * Compact, app-like secondary actions. Never a naked underlined link — the
 * BEFORE critique was that the existing one reads like a website, and two more
 * of them would have been the same defect in a new place.
 *
 * JOIN IS BACK, AND SECONDARY.
 *
 * An earlier revision removed every Join control from this screen on the
 * grounds that "nothing in the product accepts a typed code". That was false:
 * `JoinWithCodeField` in app/index.tsx validates a pasted code against
 * `JOIN_CODE_SHAPE` and pushes to `/join/<code>`. The control has a real
 * destination and real behaviour to reuse.
 *
 * It is drawn compact and secondary on purpose. Joining is legitimate and it
 * is not what this screen is for — it must not outrank Home or MOVE, so it
 * sits beside Start rather than above the content, and neither is a naked
 * underlined link.
 */
function SecondaryActions() {
  return (
    <View style={s.actionRow}>
      <View style={s.pill}>
        <Text style={s.pillText}>Join with a code</Text>
      </View>
      <View style={s.pill}>
        <Text style={s.pillText}>Start a community</Text>
      </View>
    </View>
  );
}

/** A community that is not the current one. The cue says what tapping does. */
function OtherRow({
  name,
  memberCount,
  goal,
  line,
  cue,
}: {
  name: string;
  memberCount: number;
  goal?: { title: string; unit: string; target: number; total: number };
  line?: string;
  cue: string;
}) {
  return (
    <View style={s.otherRow}>
      <View style={s.otherHead}>
        <View style={s.otherText}>
          <Text style={s.otherName} numberOfLines={1}>
            {name}
          </Text>
          <Text style={s.otherMeta}>
            {memberCountLabel(memberCount)} · {goal ? goal.title : line}
          </Text>
          {goal ? (
            <Text style={s.otherTotal}>
              {totalOfTargetLabel(goal.total, goal.target, goal.unit)} ·{' '}
              {percentLabel(goal.total, goal.target)}
            </Text>
          ) : null}
        </View>
        {/*
          ROW BEHAVIOUR HAS TO BE VISIBLE. Tapping a row switches the current
          community AND opens its Home; a Pressable with an accessibility
          label says that to a screen reader and to nobody else.
        */}
        <View style={s.cue}>
          <Text style={s.cueText}>{cue}</Text>
        </View>
      </View>
      {goal ? <Track total={goal.total} target={goal.target} /> : null}
    </View>
  );
}

export function CommunityListTarget({
  state,
}: {
  state: 'none' | 'one' | 'several' | 'severalNoCurrent' | 'loading' | 'failed';
}) {
  const { onLayout, compact, roomy } = useBox();
  const hasCurrent = state === 'one' || state === 'several';
  const showOthers = state === 'several';

  return (
    <View style={s.screen} onLayout={onLayout}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[
          s.body,
          compact ? s.bodyCompact : null,
          roomy && !showOthers ? s.bodyRoomy : null,
        ]}
      >
        <Header />

        {state === 'none' ? (
          <View style={s.emptyWrap}>
            <View style={s.emptyPanel}>
              {/*
                NO SLOGAN. The standing-slogan system was removed from Home on
                direction; this screen does not get to reintroduce one. The
                heading is the thing the member is here to do.

                AND THE FIELD IS REAL. `JoinWithCodeField` on `/` validates a
                pasted code against `JOIN_CODE_SHAPE` and pushes to
                `/join/<code>`, so this is existing behaviour placed where
                somebody with a code is actually standing — not a new capability
                and not a control with nowhere to go. An earlier revision
                removed it on the false premise that nothing accepted a typed
                code; that premise is withdrawn.
              */}
              <Text style={[display.lg, s.emptyTitle]}>Join a community</Text>
              <Text style={s.emptyBody}>
                Paste the code someone sent you, or open their invite link.
              </Text>
              <View style={s.joinRow}>
                <View style={s.joinInput}>
                  <Text style={s.joinPlaceholder}>Paste a join code</Text>
                </View>
                <View style={s.joinGo}>
                  <Text style={s.joinGoText}>Go</Text>
                </View>
              </View>
              <View style={s.emptyRule} />
              <Text style={s.emptyOr}>Or start your own and invite people to it.</Text>
              <View style={s.primary}>
                <Text style={s.primaryText}>Start a community</Text>
              </View>
            </View>

            <View style={s.emptyFacts}>
              {[
                [
                  'Count what you choose',
                  'Your community sets what it is counting, and how much. It can run more than one goal at a time.',
                ],
                [
                  'Every amount counts once',
                  'You add what you did. The shared total is the record.',
                ],
                ['No leaderboards', 'There is no ranking here, and nobody is compared.'],
              ].map(([title, body]) => (
                <View key={title} style={s.emptyFact}>
                  <Text style={s.emptyFactTitle}>{title}</Text>
                  <Text style={s.emptyFactBody}>{body}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : state === 'loading' ? (
          /*
            THE SKELETON IS THE REAL STRUCTURE. A single grey card over a blank
            page tells the member nothing about what is arriving; this is the
            current-community panel and two rows, in their real places.
          */
          <View style={s.stateWrap}>
            <View style={s.skeletonPanel}>
              <View style={s.boneRow}>
                <View style={[s.bone, { width: 74, height: 20 }]} />
                <View style={[s.bone, { width: 96, height: 20 }]} />
              </View>
              <View style={[s.bone, { width: '86%', height: 30 }]} />
              <View style={[s.bone, { width: '40%', height: 14 }]} />
              <View style={[s.boneRule]} />
              <View style={[s.bone, { width: '54%', height: 13 }]} />
              <View style={s.boneGoal}>
                <View style={[s.bone, { width: 60, height: 42 }]} />
                <View style={s.boneGoalText}>
                  <View style={[s.bone, { width: '80%', height: 16 }]} />
                  <View style={[s.bone, { width: '60%', height: 13 }]} />
                  <View style={[s.bone, { width: '100%', height: 6 }]} />
                </View>
              </View>
            </View>
            {(roomy ? [0, 1, 2] : [0, 1]).map((i) => (
              <View key={i} style={s.skeletonRow}>
                <View style={[s.bone, { width: '52%', height: 17 }]} />
                <View style={[s.bone, { width: '34%', height: 12 }]} />
              </View>
            ))}
            <Text style={s.stateNote}>Loading your communities…</Text>
          </View>
        ) : state === 'failed' ? (
          /*
            A FAILURE STILL KNOWS WHAT PAGE IT IS. The header above stays, the
            panel says what did not happen and what is still true, and the way
            out is more than a retry: a member who cannot load this list can
            still reach the community they were in.
          */
          <View style={s.stateWrap}>
            <View style={s.failPanel}>
              <Text style={s.failTitle}>Your communities could not be loaded just now.</Text>
              <Text style={s.failBody}>
                Nothing has changed — this is the reading, not the record.
              </Text>
              <View style={s.failPrimary}>
                <Text style={s.primaryText}>Try again</Text>
              </View>
            </View>
            <View style={s.actionRow}>
              <View style={s.pill}>
                <Text style={s.pillText}>Go to Home</Text>
              </View>
              <View style={s.pill}>
                <Text style={s.pillText}>Start a community</Text>
              </View>
            </View>
          </View>
        ) : state === 'severalNoCurrent' ? (
          <>
            {/*
              THE STATE THE PRODUCT ACTUALLY HAS, and the one the first draft
              skipped. `resolveCurrentCommunity()` returns NULL when several
              memberships exist and none is remembered — it does not fall back
              to the first. Marking a row CURRENT here would be a convenience
              inventing a fact, so the screen asks instead.
            */}
            <View style={s.choosePanel}>
              <Text style={s.chooseTitle}>Choose which community Home opens</Text>
              <Text style={s.chooseBody}>
                You are in {OTHERS.length + 1} communities and have not opened one yet. Pick one —
                you can switch whenever you like.
              </Text>
            </View>
            <View style={s.others}>
              <OtherRow
                name={CURRENT.name}
                memberCount={CURRENT.memberCount}
                goal={{ ...CURRENT.goal, title: CURRENT.goal.title }}
                cue="Choose"
              />
              {OTHERS.map((o) => (
                <OtherRow
                  key={o.name}
                  name={o.name}
                  memberCount={o.memberCount}
                  goal={o.goal}
                  line={o.line}
                  cue="Choose"
                />
              ))}
            </View>
            <SecondaryActions />
          </>
        ) : (
          <>
            {/*
              THE CURRENT COMMUNITY IS THE SUBJECT, not the first row of a
              list. It is the one Home opens, so it says so, and it carries
              what it is doing right now rather than only its name.
            */}
            <View style={s.currentPanel}>
              <View style={s.currentTop}>
                <Text style={s.currentPill}>CURRENT</Text>
                {roleCardLabel(CURRENT.role) ? (
                  <Text style={s.rolePill}>{roleCardLabel(CURRENT.role)}</Text>
                ) : null}
              </View>
              <Text style={[display.lg, s.currentName]} numberOfLines={2}>
                {CURRENT.name}
              </Text>
              <Text style={s.currentMeta}>{memberCountLabel(CURRENT.memberCount)}</Text>

              <View style={s.currentRule} />

              <Text style={s.eyebrowDark}>WHAT WE&apos;RE DOING</Text>
              <View style={s.currentGoalRow}>
                <LivingWeProgress
                  completed={CURRENT.goal.total}
                  target={CURRENT.goal.target}
                  unit={CURRENT.goal.unit}
                  width={compact ? 58 : roomy && !showOthers ? 88 : 74}
                  surface="dark"
                />
                <View style={s.currentGoalText}>
                  <Text style={s.currentGoalTitle} numberOfLines={1}>
                    {CURRENT.goal.title}
                  </Text>
                  <Text style={s.currentGoalTotal}>
                    {totalOfTargetLabel(
                      CURRENT.goal.total,
                      CURRENT.goal.target,
                      CURRENT.goal.unit,
                    )}
                  </Text>
                  <Track total={CURRENT.goal.total} target={CURRENT.goal.target} dark />
                  <Text style={s.currentGoalPct}>
                    {percentLabel(CURRENT.goal.total, CURRENT.goal.target)}
                  </Text>
                </View>
              </View>

              {roomy && !showOthers ? (
                <View style={s.currentSecond}>
                  <Text style={s.currentSecondTitle} numberOfLines={1}>
                    {CURRENT.second.title}
                  </Text>
                  <Text style={s.currentSecondPct}>
                    {percentLabel(CURRENT.second.total, CURRENT.second.target)}
                  </Text>
                </View>
              ) : null}

              <Momentum rows={MOMENTUM.slice(0, compact ? 2 : roomy && !showOthers ? 4 : 3)} dark />
            </View>

            {showOthers ? (
              <View style={s.others}>
                <Text style={s.eyebrow}>ALSO YOURS</Text>
                {OTHERS.map((o) => (
                  <OtherRow
                    key={o.name}
                    name={o.name}
                    memberCount={o.memberCount}
                    goal={o.goal}
                    line={o.line}
                    cue="Switch"
                  />
                ))}
              </View>
            ) : null}

            {/*
              Joining and starting sit directly under the content rather than
              pinned to the bottom of the frame: with one membership, pinning
              them left most of the screen as empty cream.
            */}
            {hasCurrent || showOthers ? <SecondaryActions /> : null}
          </>
        )}
      </ScrollView>
      <Tabs active="Community" />
    </View>
  );
}

/* ── 2 · one community ───────────────────────────────────────────────────── */

export function CommunityDetailTarget({
  state,
}: {
  state: 'active' | 'noGoal' | 'history' | 'loading' | 'failed' | 'switch';
}) {
  const { onLayout, compact, roomy } = useBox();
  const hasOpen = state === 'active' || state === 'switch';
  const historyRows =
    state === 'history' ? HISTORY : HISTORY.slice(0, compact ? 1 : roomy ? 3 : 2);

  return (
    <View style={s.screen} onLayout={onLayout}>
      <ScrollView style={s.scroll} contentContainerStyle={[s.body, compact ? s.bodyCompact : null]}>
        {/*
          THE MASTHEAD. Identity first and loudest: this is the screen whose
          subject is the people. The WE mark is the community's own mark here,
          not a progress readout, so it carries no number.
        */}
        <View style={s.masthead}>
          <View style={s.mastheadTop}>
            <Text style={s.wordmarkOnNavy}>WE STAY FIT</Text>
            <Text style={s.switchChip}>Switch</Text>
          </View>
          <Text style={s.mastheadEyebrow}>YOUR COMMUNITY</Text>
          <Text style={[display.lg, s.mastheadName]} numberOfLines={2}>
            {CURRENT.name}
          </Text>
          <View style={s.mastheadFacts}>
            <Text style={s.mastheadFact}>{memberCountLabel(CURRENT.memberCount)}</Text>
            {roleCardLabel(CURRENT.role) ? (
              <>
                <Text style={s.mastheadDot}>·</Text>
                <Text style={s.mastheadFact}>{roleCardLabel(CURRENT.role)}</Text>
              </>
            ) : null}
          </View>
        </View>

        {state === 'loading' ? (
          <View style={s.stateWrap}>
            <View style={s.skeletonPanel}>
              <View style={[s.bone, { width: '40%', height: 12 }]} />
              <View style={[s.bone, { width: '90%', height: 20 }]} />
              <View style={[s.bone, { width: '100%', height: 10, marginTop: 6 }]} />
              <View style={[s.bone, { width: '70%', height: 12 }]} />
            </View>
            <Text style={s.stateNote}>Loading what this community is doing…</Text>
          </View>
        ) : state === 'failed' ? (
          <View style={s.stateWrap}>
            <View style={s.failPanel}>
              <Text style={s.failTitle}>This community&apos;s goals could not be loaded.</Text>
              <Text style={s.failBody}>
                Nothing has changed — this is the reading, not the record.
              </Text>
              <View style={s.secondary}>
                <Text style={s.secondaryText}>Try again</Text>
              </View>
            </View>
          </View>
        ) : (
          <>
            {/* ── what we're doing ── */}
            <View style={s.section}>
              <Text style={s.eyebrow}>WHAT WE&apos;RE DOING</Text>
              {hasOpen ? (
                <>
                  {[CURRENT.goal, CURRENT.second].map((g) => (
                    <View key={g.title} style={s.openRow}>
                      <View style={s.openText}>
                        <Text style={s.openTitle} numberOfLines={1}>
                          {g.title}
                        </Text>
                        <Text style={s.openTotal}>
                          {totalOfTargetLabel(g.total, g.target, g.unit)}
                        </Text>
                        <Track total={g.total} target={g.target} />
                      </View>
                      <Text style={s.openPct}>{percentLabel(g.total, g.target)}</Text>
                    </View>
                  ))}
                </>
              ) : (
                <View style={s.quietPanel}>
                  <Text style={s.quietTitle}>No goal running yet</Text>
                  <Text style={s.quietBody}>
                    {roleCardLabel(CURRENT.role)
                      ? 'Start one and your community can begin contributing.'
                      : 'Your Champion can start one for this community.'}
                  </Text>
                  {roleCardLabel(CURRENT.role) ? (
                    <View style={s.primaryQuiet}>
                      <Text style={s.primaryText}>Start a goal</Text>
                    </View>
                  ) : null}
                </View>
              )}
            </View>

            {/* ── momentum, only where there is something to report ── */}
            {hasOpen ? <Momentum rows={MOMENTUM.slice(0, roomy ? 4 : 3)} /> : null}

            {/* ── what we've done ── */}
            <View style={s.section}>
              <Text style={s.eyebrow}>WHAT WE&apos;VE DONE</Text>
              {historyRows.map((h, i) => (
                <View key={h.title} style={[s.doneRow, h.reached ? s.doneRowReached : null]}>
                  {/*
                    ONE Living WE on this screen, and it is here. A mark filled
                    to the top beside a goal the community actually finished is
                    the celebration; the same mark shrunk onto every open row
                    was a gauge too small to read, which is decoration wearing
                    a number's clothes. Open goals carry the track instead.
                  */}
                  {i === 0 && h.reached ? (
                    <LivingWeProgress
                      completed={h.total}
                      target={h.target}
                      unit={h.unit}
                      width={compact ? 46 : 56}
                      surface="light"
                    />
                  ) : null}
                  <View style={s.doneText}>
                    <Text style={s.doneTitle} numberOfLines={2}>
                      {h.title}
                    </Text>
                    <Text style={s.doneTotal}>
                      {totalOfTargetLabel(h.total, h.target, h.unit)}
                    </Text>
                    <Text style={s.doneWhen}>{h.when}</Text>
                  </View>
                  {h.reached ? (
                    <View style={s.reachedBadge}>
                      <Text style={s.reachedText}>REACHED</Text>
                    </View>
                  ) : (
                    <Text style={s.notReached}>
                      {percentLabel(h.total, h.target)}
                    </Text>
                  )}
                </View>
              ))}
            </View>

            {/* Administration is available, and last. */}
            <View style={s.adminRow}>
              <Text style={s.footLink}>Invite people</Text>
              <Text style={s.footDot}>·</Text>
              <Text style={s.footLink}>Manage</Text>
            </View>
          </>
        )}
      </ScrollView>

      {state === 'switch' ? (
        <>
          <View style={s.scrim} />
          <View style={s.sheet}>
            <View style={s.sheetGrip} />
            <Text style={s.sheetTitle}>Switch community</Text>
            <View style={s.sheetRow}>
              <View style={s.sheetTick}>
                <Text style={s.sheetTickMark}>✓</Text>
              </View>
              <View style={s.sheetText}>
                <Text style={s.sheetName}>{CURRENT.name}</Text>
                <Text style={s.sheetMeta}>{memberCountLabel(CURRENT.memberCount)}</Text>
              </View>
            </View>
            {OTHERS.map((o) => (
              <View key={o.name} style={s.sheetRow}>
                <View style={s.sheetTickOff} />
                <View style={s.sheetText}>
                  <Text style={s.sheetName}>{o.name}</Text>
                  <Text style={s.sheetMeta}>{memberCountLabel(o.memberCount)}</Text>
                </View>
              </View>
            ))}
          </View>
        </>
      ) : null}

      <Tabs active="Community" />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CREAM },
  scroll: { flex: 1 },
  /*
    THE RAISED MOVE CONTROL LIFTS 22px INTO THE SCROLL AREA (`move.marginTop`),
    so content that stops at its own padding sits under it no matter how far
    the page scrolls — the defect the Page 2 gate sent back. The inset is the
    overhang plus a margin, and it is why the last history row clears.
  */
  body: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 46,
    gap: 14,
  },
  bodyCompact: { paddingTop: 8, gap: 10 },
  /* A tall phone spends its height on rhythm rather than leaving it at the end. */
  bodyRoomy: { gap: 18, paddingTop: 14 },

  wordmarkRow: { height: 26, justifyContent: 'center' },
  wordmark: { color: NAVY, fontSize: 17, fontWeight: '900', letterSpacing: 1.2 },
  wordmarkOnNavy: { color: ON_NAVY, fontSize: 13, fontWeight: '900', letterSpacing: 1.1 },
  pageTitle: { color: NAVY, marginTop: -2 },

  /* Compact, app-like secondary actions — never a naked underlined link. */
  actionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', paddingTop: 2 },
  pill: {
    borderWidth: 1.5,
    borderColor: '#C9C5BC',
    backgroundColor: SURFACE,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  pillText: { color: NAVY, fontSize: 13, fontWeight: '800' },

  /* The cue that says what tapping a row does. */
  cue: {
    borderWidth: 1,
    borderColor: '#C9C5BC',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  cueText: { color: INK_QUIET, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },

  /* Several memberships, none chosen yet. */
  choosePanel: { gap: 4 },
  chooseTitle: { color: NAVY, fontSize: 19, lineHeight: 25, fontWeight: '900' },
  chooseBody: { color: TEXT_MUTED, fontSize: 13.5, lineHeight: 19 },

  eyebrow: { color: '#2F7D4F', fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  eyebrowDark: { color: PROGRESS_GREEN, fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },

  /* ── the list's current community ── */
  currentPanel: {
    backgroundColor: NAVY,
    borderRadius: 22,
    padding: 18,
    gap: 8,
    ...elevation.card,
  },
  currentTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  currentPill: {
    color: '#04260F',
    backgroundColor: PROGRESS_GREEN,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  rolePill: {
    color: ON_NAVY_MUTED,
    borderColor: ON_NAVY_RULE,
    borderWidth: 1,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  currentName: { color: ON_NAVY },
  currentMeta: { color: ON_NAVY_MUTED, fontSize: 13, lineHeight: 18 },
  currentRule: { height: 1, backgroundColor: ON_NAVY_RULE, marginVertical: 4 },
  currentGoalRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  currentGoalText: { flex: 1, gap: 3 },
  currentGoalTitle: { color: ON_NAVY, fontSize: 15, lineHeight: 20, fontWeight: '800' },
  currentGoalTotal: { color: ON_NAVY_MUTED, fontSize: 13, lineHeight: 18 },
  currentGoalPct: { color: PROGRESS_GREEN, fontSize: 12, lineHeight: 16, fontWeight: '800' },
  currentSecond: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: ON_NAVY_RULE,
    paddingTop: 8,
    gap: 10,
  },
  currentSecondTitle: { color: ON_NAVY_MUTED, fontSize: 13, lineHeight: 18, flex: 1 },
  currentSecondPct: { color: PROGRESS_GREEN, fontSize: 12, fontWeight: '800' },

  /* ── other communities ── */
  others: { gap: 8 },
  otherRow: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: HAIRLINE,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 9,
  },
  otherHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  otherText: { flex: 1, gap: 2 },
  otherName: { color: NAVY, fontSize: 15, lineHeight: 20, fontWeight: '800' },
  otherMeta: { color: TEXT_MUTED, fontSize: 12, lineHeight: 16 },
  otherTotal: { color: INK_QUIET, fontSize: 12, lineHeight: 16 },
  otherTrackWrap: { paddingTop: 2 },

  /* ── momentum ── */
  momentum: { gap: 7, paddingTop: 4 },
  momentumRows: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
    backgroundColor: '#EDF6F0',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipDark: { backgroundColor: 'rgba(255,255,255,0.10)' },
  chipAmount: { color: '#1C5E38', fontSize: 13, fontWeight: '900' },
  chipAmountDark: { color: PROGRESS_GREEN },
  chipUnit: { color: '#2F6A48', fontSize: 11, fontWeight: '700' },
  chipUnitDark: { color: ON_NAVY },
  chipAgo: { color: TEXT_MUTED, fontSize: 11 },
  chipAgoDark: { color: ON_NAVY_MUTED },
  momentumNote: { color: TEXT_MUTED, fontSize: 11, lineHeight: 15 },
  momentumNoteDark: { color: ON_NAVY_MUTED },

  /* ── zero state ── */
  emptyWrap: { gap: 14 },
  emptyPanel: { backgroundColor: NAVY, borderRadius: 22, padding: 20, gap: 10, ...elevation.card },
  emptyKicker: { color: PROGRESS_GREEN, fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  emptyTitle: { color: ON_NAVY },
  emptyBody: { color: ON_NAVY_MUTED, fontSize: 14, lineHeight: 20 },
  /* the code field, reusing the behaviour that already exists on `/` */
  joinRow: { flexDirection: 'row', gap: 9, alignItems: 'stretch', marginTop: 4 },
  joinInput: {
    flex: 1,
    minWidth: 0,
    backgroundColor: SURFACE,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: HAIRLINE,
    paddingHorizontal: 13,
    minHeight: 48,
    justifyContent: 'center',
  },
  joinPlaceholder: { color: INK_QUIET, fontSize: 15 },
  joinGo: {
    minWidth: 66,
    borderRadius: 13,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  joinGoText: { color: CREAM, fontSize: 15, fontWeight: '900' },

  emptyRule: { height: 1, backgroundColor: ON_NAVY_RULE, marginVertical: 6 },
  emptyOr: { color: ON_NAVY_MUTED, fontSize: 13.5, lineHeight: 19 },
  emptyActions: { gap: 9, paddingTop: 4 },
  emptyFacts: { gap: 11, paddingTop: 2 },
  emptyFact: {
    backgroundColor: SURFACE,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: HAIRLINE,
    paddingHorizontal: 15,
    paddingVertical: 14,
    gap: 3,
  },
  emptyFactTitle: { color: NAVY, fontSize: 14, lineHeight: 19, fontWeight: '800' },
  emptyFactBody: { color: TEXT_MUTED, fontSize: 12.5, lineHeight: 17 },

  primary: {
    backgroundColor: ACTION_GREEN,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    ...elevation.action,
  },
  primaryQuiet: {
    backgroundColor: ACTION_GREEN,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryText: { color: ON_ACTION, fontSize: 15, fontWeight: '900' },
  secondary: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: ON_NAVY_RULE,
    paddingVertical: 13,
    alignItems: 'center',
  },
  secondaryText: { color: ON_NAVY, fontSize: 14, fontWeight: '800' },

  /* ── loading / failure ── */
  stateWrap: { gap: 10, paddingTop: 6 },
  skeletonPanel: {
    backgroundColor: SURFACE,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: HAIRLINE,
    padding: 16,
    gap: 9,
  },
  bone: { backgroundColor: '#E3E0D8', borderRadius: 6 },
  boneRow: { flexDirection: 'row', gap: 8 },
  boneRule: { height: 1, backgroundColor: '#E3E0D8', marginVertical: 2 },
  boneGoal: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  boneGoalText: { flex: 1, gap: 6 },
  skeletonRow: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: HAIRLINE,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 7,
  },
  stateNote: { color: TEXT_MUTED, fontSize: 13, lineHeight: 18 },
  failPanel: {
    backgroundColor: NAVY,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 20,
    gap: 10,
  },
  failTitle: { color: ON_NAVY, fontSize: 20, lineHeight: 27, fontWeight: '900' },
  failBody: { color: ON_NAVY_MUTED, fontSize: 14, lineHeight: 20 },
  failPrimary: {
    backgroundColor: ACTION_GREEN,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
    ...elevation.action,
  },

  /* ── detail masthead ── */
  masthead: {
    backgroundColor: NAVY,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 4,
    ...elevation.card,
  },
  mastheadTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  switchChip: {
    color: ON_NAVY,
    borderColor: ON_NAVY_RULE,
    borderWidth: 1,
    fontSize: 12,
    fontWeight: '800',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    overflow: 'hidden',
  },
  mastheadEyebrow: { color: PROGRESS_GREEN, fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  mastheadName: { color: ON_NAVY },
  mastheadFacts: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 2 },
  mastheadFact: { color: ON_NAVY_MUTED, fontSize: 13, lineHeight: 18 },
  mastheadDot: { color: ON_NAVY_RULE, fontSize: 13 },

  /* ── sections ── */
  section: { gap: 8 },
  openRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: HAIRLINE,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  openText: { flex: 1, gap: 3 },
  openTitle: { color: NAVY, fontSize: 15, lineHeight: 20, fontWeight: '800' },
  openTotal: { color: TEXT_MUTED, fontSize: 12, lineHeight: 16 },
  openPct: { color: '#1C5E38', fontSize: 13, fontWeight: '900' },

  quietPanel: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: HAIRLINE,
    padding: 14,
    gap: 5,
  },
  quietTitle: { color: NAVY, fontSize: 16, lineHeight: 22, fontWeight: '800' },
  quietBody: { color: TEXT_MUTED, fontSize: 13, lineHeight: 18 },

  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: HAIRLINE,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  doneRowReached: { borderColor: '#BFE3CC', backgroundColor: '#F2FAF5' },
  doneText: { flex: 1, gap: 2 },
  doneTitle: { color: NAVY, fontSize: 15, lineHeight: 20, fontWeight: '800' },
  doneTotal: { color: INK_QUIET, fontSize: 12, lineHeight: 16 },
  doneWhen: { color: TEXT_MUTED, fontSize: 11, lineHeight: 15 },
  reachedBadge: {
    backgroundColor: PROGRESS_GREEN,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  reachedText: { color: '#04260F', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  notReached: { color: TEXT_MUTED, fontSize: 12, fontWeight: '800' },

  /* ── tracks ── */
  track: { height: 6, borderRadius: 3, backgroundColor: '#DFDCD4', overflow: 'hidden' },
  trackDark: { backgroundColor: 'rgba(255,255,255,0.18)' },
  trackFill: { height: '100%', borderRadius: 3, backgroundColor: PROGRESS_GREEN },

  /* ── feet ── */
  foot: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 2, marginTop: 'auto' },
  adminRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 4, marginTop: 'auto' },
  footLink: { color: NAVY, fontSize: 14, fontWeight: '800', textDecorationLine: 'underline' },
  footDot: { color: TEXT_MUTED, fontSize: 14 },

  /* ── switch sheet ── */
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8,18,31,0.55)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: SURFACE,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 96,
    gap: 10,
  },
  sheetGrip: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D3CFC6',
    alignSelf: 'center',
    marginBottom: 4,
  },
  sheetTitle: { color: NAVY, fontSize: 17, fontWeight: '900' },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  sheetTick: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: PROGRESS_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTickMark: { color: '#04260F', fontSize: 13, fontWeight: '900' },
  sheetTickOff: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CFCBC2',
  },
  sheetText: { flex: 1, gap: 1 },
  sheetName: { color: NAVY, fontSize: 15, fontWeight: '800' },
  sheetMeta: { color: TEXT_MUTED, fontSize: 12 },

  /* ── the shell, preserved ── */
  tabs: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-around',
    backgroundColor: SURFACE,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
    paddingTop: 8,
    paddingBottom: 10,
  },
  tab: { width: 60, alignItems: 'center', gap: 5 },
  tabGlyphWrap: { height: 22, alignItems: 'center', justifyContent: 'center' },
  tabLabel: { fontSize: 10.5, lineHeight: 14, fontWeight: '700', color: INK_QUIET },
  tabLabelOn: { color: NAVY },
  move: {
    width: 62,
    height: 62,
    borderRadius: 31,
    marginTop: -22,
    backgroundColor: ACTION_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.action,
  },
  moveText: {
    color: '#04260F',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});
