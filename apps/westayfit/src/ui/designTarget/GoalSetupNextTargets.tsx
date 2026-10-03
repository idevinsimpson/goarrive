import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import {
  ACTION_GREEN,
  CARD_BORDER,
  CREAM,
  ERROR_RED,
  HAIRLINE,
  HERO_MUTED,
  INK_QUIET,
  NAVY,
  ON_ACTION,
  ON_NAVY_RULE,
  OPTION_SELECTED_TINT,
  PROGRESS_GREEN,
  SURFACE,
  TEXT_MUTED,
  display,
  elevation,
  kit,
} from '../kit';
import { WsfWordmark } from '../WsfWordmark';

/* ══════════════════════════════════════════════════════════════════════════
   W6 · /goals/new — THE CHAMPION SETUP EXPERIENCE, PROPOSED
   ══════════════════════════════════════════════════════════════════════════

   NOTHING IN THIS FILE IS IMPLEMENTED AND NOTHING IN IT IS ACCEPTED. Every
   frame the preview route draws from these components carries a
   PROPOSED / NOT ACCEPTED strip inside the image. `app/goals/new.tsx` is
   untouched (blob e5be66f) and stays untouched until the Director rules.

   WHAT THIS IS A TARGET FOR. The route as it stands today
   (docs/design-target/review/goal-setup-current/) is correct, honest and
   already says the right words. What it does not have is HIERARCHY: four
   identically-weighted white cards stacked down a page that is over two
   screens tall on a 390x844 phone and nearly four on a 390x640 one. Read the
   two BEFOREs side by side and the same three facts come out:

     1. THE MASTHEAD COSTS 410 px BEFORE THE FIRST DECISION. Wordmark row,
        eyebrow, 32 px heading, two-line intro. On the short phone that is
        64% of the viewport, and the definition line — the whole point of the
        first section — is below the fold before a Champion has typed
        anything.

     2. THE PAYOFF IS DRAWN AS A LABEL. "30,000 squats" is the sentence the
        two fields exist to produce, and it renders at 20 px in the same
        navy as the field labels above it. The kit has a display tier
        (display.md = 29) precisely for the number that carries a screen.

     3. THE COMMIT POINT IS THE QUIETEST SURFACE ON THE PAGE. "Check it over"
        is `kit.cardQuiet` — 55% white — under three solid `kit.card`s, and
        the control that actually starts the goal sits OUTSIDE it, below the
        fold from the summary it is meant to confirm. At 390x844 a Champion
        cannot see what they are agreeing to and the button that agrees to it
        at the same time.

   WHAT THIS TARGET PROPOSES, AND NOTHING MORE.

     A SPINE. The same four sections, in the same order, with the same
     titles, joined by a numbered rule down the left gutter. Three decisions
     and a check, not four boxes. Still ONE page, still one scroll — no
     wizard, no steps that hide each other, no route change.

     THE PAYOFF AT DISPLAY SIZE, on the kit's own selected-option tint.

     DURATION AS FOUR PILLS, not four 56 px option rows with descriptions.
     `kit.pill` / `kit.pillSelected` already exist and are already 44 px of
     hit target. The four labels are unchanged — 1 week / 2 weeks / 1 month /
     Custom — and the chosen option's description is kept, once, under the
     row. That is ~230 px returned to the page.

     THE REPEAT CHOICE STAYS EXACTLY TWO FULL OPTION ROWS. It is the one
     decision on this page with a consequence for every member, `once` is
     still the default, and it keeps its description in both states. A third
     policy is not proposed and no existing one is reworded.

     THE SUMMARY BECOMES THE ONE NAVY SURFACE ON THE PAGE, and the submit
     control moves INSIDE it. Same seven rows, same words. A Champion cannot
     scroll the thing they are confirming away from the thing that confirms
     it, and the last row is no longer underneath the raised MOVE circle.

     A RESERVED STRIP FOR THE MEMBER TAB BAR, so no content sits under it.
     (goal-setup-current observation 4: the bar overlaps the foot of the
     summary card today.)

     TRUTHFUL OUTCOMES. Three distinct ones, because the route has three:
     the server refused (it answered), we could not confirm (it did not), and
     the goal is live. Today all three unhappy paths render one `error`
     string, and `describeServerError` maps `unavailable`, `deadline-exceeded`
     and the default case to "try again" — which asserts that nothing was
     created at the exact moment the client cannot know that.

   WHAT IS NOT PROPOSED, explicitly: no third repeat policy, no movement
   catalog, no wizard, no removal of the production gate, no backend field,
   no idempotency claim, no Living WE anywhere in setup (a goal that does not
   exist has no confirmed total), no faces, names, quotes, counts, streaks or
   rankings, no health data, no coaching upsell, no forced sharing.

   BOARD 08 IS REFERENCE, NOT A SOURCE. Its accepted current-build captures
   are what these are measured against. Its older target drawings label this
   form differently ("Goal title", a Step 1/2/3 wizard spine, a unit paired
   beside the target) — those conflict with the build and with the lock, and
   none of them is copied here. The words in this file are the route's own.

   FIXTURE IDENTITY is the BEFORE package's, so the pairs read side by side:
   Harbor Walkers · Autumn squat challenge · 30,000 squats · the 1-week
   derived window · Coordinated Universal Time, which is the zone the capture
   container reports.
   ══════════════════════════════════════════════════════════════════════════ */

const COMMUNITY = 'Harbor Walkers';
const GOAL_NAME = 'Autumn squat challenge';
const TARGET_NUMBER = '30000';
const UNIT = 'squats';
const PHRASE = '30,000 squats';
const STARTS = 'today at 10:15 PM';
const ENDS = 'Tuesday, Sep 29 at 10:15 PM';
const ZONE = 'Coordinated Universal Time';
const REPEAT_ONCE = 'One contribution per member';

/** The height the member tab bar occupies, measured off the BEFORE frames. */
const TAB_BAR_RESERVE = 92;

/* ---------------------------------------------------------------- scaffold */

/**
 * One phone screen, at one device class, clipped exactly as the device clips
 * it. Nothing is stretched to fill a frame and no frame is made taller than
 * the class it is named for: a composition no phone renders is not evidence
 * of anything.
 */
function Screen({
  compact,
  children,
  testID,
}: {
  compact: boolean;
  children: React.ReactNode;
  testID?: string;
}) {
  return (
    <View style={s.screen} testID={testID}>
      <View style={[s.screenBody, { paddingTop: compact ? 14 : 16 }]}>{children}</View>
      <TabBarReserve compact={compact} />
    </View>
  );
}

/**
 * The strip the member tab bar owns. Drawn as reserved space and labelled as
 * reserved space — NOT as a picture of the bar. MemberTabBar.tsx belongs to
 * another worker and a hand-drawn copy of it would be a claim about a
 * component this checkpoint has not looked at.
 */
function TabBarReserve({ compact }: { compact: boolean }) {
  return (
    <View style={[s.reserve, { height: compact ? TAB_BAR_RESERVE - 8 : TAB_BAR_RESERVE }]}>
      <Text style={s.reserveText}>MEMBER TAB BAR · RESERVED, NOTHING UNDER IT</Text>
    </View>
  );
}

/** Wordmark left, at most one quiet control right — the route's own chrome. */
function Masthead({ back = true }: { back?: boolean }) {
  return (
    <View style={kit.chrome}>
      <WsfWordmark variant="navy" height={22} />
      {back ? <Text style={kit.chromeLinkText}>Back to community</Text> : null}
    </View>
  );
}

/**
 * Eyebrow, heading, intro — the route's words, unchanged. The only move is
 * typographic: on the short phone the heading drops to `kit.headingCompact`,
 * a token this product already uses for exactly this reason, which is what
 * lets the definition line clear the fold at 390x640.
 */
function Head({
  compact,
  eyebrow = COMMUNITY,
  title,
  intro,
}: {
  compact: boolean;
  eyebrow?: string;
  title: string;
  intro: string;
}) {
  return (
    <View style={s.head}>
      <Text style={kit.eyebrow}>{eyebrow}</Text>
      <Text style={[compact ? kit.headingCompact : kit.heading, s.headTitle]}>{title}</Text>
      <Text style={[compact ? kit.body : kit.intro, s.headIntro]}>{intro}</Text>
    </View>
  );
}

/**
 * A section on the spine. The number and the rule are the whole of the
 * navigation: a Champion can see how many decisions there are and which one
 * they are in without anything collapsing, paginating or hiding.
 */
function Step({
  n,
  title,
  meta,
  children,
  last,
  style,
}: {
  n: string;
  title: string;
  meta?: string;
  children: React.ReactNode;
  last?: boolean;
  style?: ViewStyle;
}) {
  return (
    <View style={[s.step, style]}>
      <View style={s.spine}>
        <View style={s.spineDot}>
          <Text style={s.spineDotText}>{n}</Text>
        </View>
        {last ? null : <View style={s.spineRule} />}
      </View>
      <View style={s.stepBody}>
        <Text style={s.stepTitle}>{title}</Text>
        {meta ? <Text style={s.stepMeta}>{meta}</Text> : null}
        <View style={s.stepCard}>{children}</View>
      </View>
    </View>
  );
}

/** Label over input, the shape the route already uses. */
function Field({
  label,
  value,
  placeholder,
  invalid,
  error,
}: {
  label: string;
  value?: string;
  placeholder?: string;
  invalid?: boolean;
  error?: string;
}) {
  return (
    <View style={s.field}>
      <Text style={kit.fieldLabel}>{label}</Text>
      <View style={[s.input, invalid ? s.inputInvalid : null]}>
        <Text style={value ? s.inputValue : s.inputPlaceholder}>{value ?? placeholder ?? ''}</Text>
      </View>
      {error ? <Text style={kit.errorText}>{error}</Text> : null}
    </View>
  );
}

function Pill({ label, selected }: { label: string; selected?: boolean }) {
  return (
    <View style={[s.pill, selected ? s.pillSelected : null]}>
      <Text style={[kit.pillText, selected ? kit.pillTextSelected : null]}>{label}</Text>
    </View>
  );
}

/** The repeat choice keeps the full row: indicator, label, description. */
function Option({
  label,
  description,
  selected,
}: {
  label: string;
  description: string;
  selected?: boolean;
}) {
  return (
    <View style={[kit.optionRow, selected ? kit.optionRowSelected : null]}>
      <View style={kit.optionIndicator}>{selected ? <View style={kit.optionIndicatorDot} /> : null}</View>
      <View style={s.optionText}>
        <Text style={kit.optionLabel}>{label}</Text>
        <Text style={kit.optionDescription}>{description}</Text>
      </View>
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.sumRow}>
      <Text style={s.sumLabel}>{label}</Text>
      <Text style={s.sumValue}>{value}</Text>
    </View>
  );
}

function Primary({ label }: { label: string }) {
  return (
    <View style={s.primary}>
      <Text style={s.primaryText}>{label}</Text>
    </View>
  );
}

function Secondary({ label, onNavy }: { label: string; onNavy?: boolean }) {
  return (
    <View style={onNavy ? s.secondaryOnNavy : s.secondary}>
      <Text style={onNavy ? s.secondaryOnNavyText : s.secondaryText}>{label}</Text>
    </View>
  );
}

/**
 * An outcome the Champion did not ask for. `error` states nothing was
 * created because the server said so; `unknown` states only what is known,
 * which is that nothing is known.
 */
function Banner({
  tone,
  title,
  body,
}: {
  tone: 'error' | 'unknown' | 'live';
  title: string;
  body: string;
}) {
  const style = tone === 'error' ? s.bannerError : tone === 'unknown' ? s.bannerUnknown : s.bannerLive;
  const titleStyle =
    tone === 'error' ? s.bannerTitleError : tone === 'unknown' ? s.bannerTitleUnknown : s.bannerTitleLive;
  return (
    <View style={[s.banner, style]}>
      <Text style={titleStyle}>{title}</Text>
      <Text style={s.bannerBody}>{body}</Text>
    </View>
  );
}

/**
 * The check and the commit, as ONE object. Seven rows, the route's own
 * labels and values, then the control that starts the goal. `submit` is
 * required rather than defaulted: one frame removes it because the server
 * has already refused this request, and a default would quietly put it back.
 */
function CommitPanel({
  compact,
  repeat = REPEAT_ONCE,
  endsValue = ENDS,
  submit,
}: {
  compact: boolean;
  repeat?: string;
  endsValue?: string;
  submit: React.ReactNode;
}) {
  return (
    <View style={[s.commit, compact ? s.commitCompact : null]} testID="wsf-gsnext-commit">
      <Text style={s.commitTitle}>Check it over</Text>
      <Text style={s.commitMeta}>This is what your community will see.</Text>
      <View style={s.commitRows}>
        <SummaryRow label="Community" value={COMMUNITY} />
        <SummaryRow label="Goal" value={GOAL_NAME} />
        <SummaryRow label="Target" value={PHRASE} />
        <SummaryRow label="Starts" value={STARTS} />
        <SummaryRow label="Ends" value={endsValue} />
        <SummaryRow label="Time zone" value={ZONE} />
        <SummaryRow label="Members" value={repeat} />
      </View>
      {submit}
    </View>
  );
}

/** A clipped section edge, so a frame taken mid-page reads as mid-page. */
function ScrolledFrom({ label }: { label: string }) {
  return (
    <View style={s.scrolledFrom}>
      <Text style={s.scrolledFromText}>{label}</Text>
    </View>
  );
}

/* ------------------------------------------------------------- the targets */

/**
 * THE FORM HIERARCHY, FROM THE TOP. What a Champion sees on arrival with the
 * first section filled: the spine, the payoff at display size, and — the
 * claim this frame exists to make — the duration pills on screen at BOTH
 * device classes. In the build, the 390x640 viewport ends inside the third
 * field.
 */
export function GoalNextFormTopTarget({ compact }: { compact: boolean }) {
  return (
    <Screen compact={compact} testID="wsf-gsnext-form-top">
      <Masthead />
      <Head
        compact={compact}
        title="Start a goal"
        intro="Set what your community will do together. Every contribution adds to one shared total."
      />
      <Step
        n="1"
        title="The goal"
        meta={`Name it, set the total, and say what you're counting — together they read like "5,000 squats" or "300 miles".`}
      >
        <Field label="Goal name" value={GOAL_NAME} />
        <View style={s.pair}>
          <View style={s.pairWide}>
            <Field label="Target" value={TARGET_NUMBER} />
          </View>
          <View style={s.pairNarrow}>
            <Field label="What you're counting" value={UNIT} />
          </View>
        </View>
        {/*
          THE SENTENCE THE TWO FIELDS EXIST TO MAKE. Same string the route
          already builds (`definitionPhrase`), at the kit's display tier
          instead of at label weight, on the kit's own selected tint. It is
          the only thing on this screen at this size.
        */}
        <View style={s.payoff}>
          <Text style={s.payoffText}>{PHRASE}</Text>
        </View>
      </Step>
      <Step n="2" title="When" last>
        <Text style={kit.fieldLabel}>How long</Text>
        <View style={s.pills}>
          <Pill label="1 week" selected />
          <Pill label="2 weeks" />
          <Pill label="1 month" />
          <Pill label="Custom" />
        </View>
        <Text style={kit.caption}>Seven days from the start.</Text>
      </Step>
    </Screen>
  );
}

/**
 * CUSTOM, OPEN. The longest the form ever gets, and the one place the
 * BEFORE package found an assumption worth keeping straight: under Custom
 * the explicit start control REPLACES the derived "Starts …" line — the two
 * are alternatives, not companions (goal-setup-current, observation 1). The
 * target draws them that way. The ends line stays, because the route keeps
 * it in both modes.
 */
export function GoalNextCustomWindowTarget({ compact }: { compact: boolean }) {
  return (
    <Screen compact={compact} testID="wsf-gsnext-custom">
      <ScrolledFrom label="1 · The goal — 30,000 squats" />
      <Step n="2" title="When" last>
        <Text style={kit.fieldLabel}>How long</Text>
        <View style={s.pills}>
          <Pill label="1 week" />
          <Pill label="2 weeks" />
          <Pill label="1 month" />
          <Pill label="Custom" selected />
        </View>
        <Text style={kit.caption}>Choose the exact start and end.</Text>
        <Field label="Starts" value="2026-10-01 09:00" />
        <Field label="Ends" value="2026-11-15 18:00" />
        {/*
          No derived "Starts …" line here: the control above states the start.
          The ends line stays — the route renders it in both modes.
        */}
        <Text style={kit.body}>Ends Sunday, Nov 15 at 6:00 PM</Text>
        <Text style={[kit.caption, s.zone]}>Times are in {ZONE}</Text>
      </Step>
    </Screen>
  );
}

/**
 * THE LOWER PAGE. The repeat decision at full weight, then the check and the
 * commit as one navy object. This is the frame that carries the proposal:
 * in the build these two are separated by a scroll, the summary is the
 * palest surface on the page, and its last row sits under the raised MOVE
 * circle.
 */
export function GoalNextSummaryCommitTarget({ compact }: { compact: boolean }) {
  return (
    <Screen compact={compact} testID="wsf-gsnext-summary">
      {/*
        THE SHORT PHONE REACHES THIS PANEL AT ITS OWN SCROLL POSITION, and the
        frame says so. 390x640 cannot hold the repeat decision AND the whole
        commit panel — measured, not guessed: see README.md. Drawing them
        together there would either clip the button, which is the exact defect
        this frame is about, or stretch a composition no phone renders. What
        the frame claims at 390x640 is the claim that matters: when a Champion
        scrolls to the check, the check and the control that acts on it are
        one object and arrive whole.
      */}
      {compact ? (
        <ScrolledFrom label="3 · How members take part — one contribution per member" />
      ) : (
        <>
          <ScrolledFrom label="2 · When — starts today at 10:15 PM" />
          <Step n="3" title="How members take part" last style={s.stepTight}>
            <Text style={kit.fieldLabel}>How often can one member contribute?</Text>
            <Option
              label={REPEAT_ONCE}
              description="Each member records one contribution toward this goal."
              selected
            />
            <Option
              label="Members can contribute again"
              description="Each member can record as many contributions as they like while the goal is open."
            />
          </Step>
        </>
      )}
      <CommitPanel compact={compact} submit={<Primary label="Start this goal" />} />
    </Screen>
  );
}

/**
 * REFUSED. The server answered, so the screen may say plainly that nothing
 * was started — and the control that was just refused is GONE, because
 * `permission-denied` will refuse the identical request again for as long as
 * this account is not a Champion here. The typed work stays on screen: the
 * route keeps it today and the target keeps it too.
 */
export function GoalNextRefusedTarget({ compact }: { compact: boolean }) {
  return (
    <Screen compact={compact} testID="wsf-gsnext-refused">
      <ScrolledFrom label="3 · How members take part — one contribution per member" />
      {/*
        THE CLAIM IS SCOPED TO WHAT WAS DEMONSTRATED, not spread over every
        unhappy path. It is safe HERE and only here: `permission-denied` is
        raised inside `runTransaction` before `tx.set`, so the server answered
        AND answered before it wrote. The sentence names the refusal that
        makes it true rather than asserting the outcome on its own, which is
        what keeps it from becoming the blanket "nothing was created" the
        unconfirmed state must never inherit.
      */}
      <Banner
        tone="error"
        title="We couldn’t start your goal."
        body="Only a Champion of this community can start a goal here. The server refused this request, so no goal was created."
      />
      <CommitPanel
        compact={compact}
        submit={
          <>
            {/*
              ACTIONABLE, and pointed at the one thing that can change the
              answer. The control the server just refused is NOT redrawn: it
              would refuse the identical request again until this account is a
              Champion here.
            */}
            <Secondary label="Back to community" onNavy />
            <Text style={s.commitNote}>
              Starting a goal here needs a Champion of {COMMUNITY}.
            </Text>
          </>
        }
      />
    </Screen>
  );
}

/**
 * UNCONFIRMED — THE RECOVERY STATE, TO THE DIRECTOR'S CONTRACT (`5787676653`).
 *
 * The client did not get an answer, so it says exactly that and nothing more:
 * no "nothing was created", no "safe to try again", and no second create
 * sent on the Champion's behalf.
 *
 * W7 measured this independently in a browser at `a193b43` (evidence
 * `e6a208a`, checkpoint `5787648446`): abort-before-send and
 * commit-with-lost-response render the IDENTICAL sentence word for word while
 * the server holds 0 goals in one case and 1 in the other — so a Champion who
 * obeys "Please try again." after a committed-but-unconfirmed submit ends up
 * with two goals, two ids, one title. That is not a hypothesis about the code
 * any more; it is a photographed outcome.
 *
 * THE FOUR THINGS THIS FRAME IS REQUIRED TO GET RIGHT:
 *
 *   1. The sentence is the unknown one, verbatim.
 *   2. The primary RESOLVES the uncertainty and is community-level:
 *      `Check community goals` -> `/community/<groupId>`, using the groupId
 *      the route already validated from its own param. W7 confirmed that page
 *      already links to the goal that was created, so this is a real way back
 *      to it and not a promise the product cannot keep. NO id is inferred
 *      from the title and NO matching-name goal is selected automatically.
 *   3. Any fresh create is `Start another goal` — its own words, subordinate,
 *      deliberate, never an automatic retry, with the duplicate consequence
 *      beside it rather than in a banner already scrolled past.
 *   4. Nothing here promises the draft or the receipt survives a reload,
 *      because nothing in the route makes that true.
 *
 * NO IDEMPOTENCY IS CLAIMED and no attempt key is asked for: `wsfCreateGoal`
 * writes a fresh auto-id per call and the route enforces no one-open-goal
 * rule. The frontend answer to a backend gap is to stop asserting what it
 * cannot observe, not to design around it.
 */
export function GoalNextUnconfirmedTarget({ compact }: { compact: boolean }) {
  return (
    <Screen compact={compact} testID="wsf-gsnext-unconfirmed">
      <ScrolledFrom label="3 · How members take part — one contribution per member" />
      <Banner
        tone="unknown"
        title="We couldn’t confirm your goal was created."
        body="It may have been created anyway. Starting another one could create a duplicate."
      />
      {/* -> /community/<groupId>, the route's own validated param. */}
      <Primary label="Check community goals" />
      <CommitPanel
        compact={compact}
        submit={
          <>
            <Secondary label="Start another goal" onNavy />
            <Text style={s.commitNote}>
              This starts a new, separate goal. If the first one was created, your community will
              have two.
            </Text>
          </>
        }
      />
    </Screen>
  );
}

/**
 * LIVE. The goal exists. The receipt and the one next useful action become a
 * single navy object with the goal named in it, and the two remaining links
 * are a plain pair underneath — the build wraps one of them in a card of its
 * own ("Put it to work"), which is a surface for a single link.
 *
 * THE PHRASE IS THE TARGET, NOT A TOTAL. It is drawn at display size in
 * cream, never in progress green, and there is no ratio, bar or count
 * anywhere on it: nobody has contributed yet, and a Living WE here would be
 * a picture of a number that does not exist.
 *
 * THE ID ON THIS SCREEN IS THE SERVER'S. `Open the contribute page` resolves
 * to `/contribute/<goalId>` from the callable's own response, held while this
 * confirmed receipt is in memory. Nothing here infers an id from the title or
 * picks a goal whose name happens to match, and nothing promises the receipt
 * survives a reload — the route keeps it in component state and a reload
 * loses it. Recovery after a reload is the unconfirmed frame's job, through
 * the community, not this screen's through a guess.
 */
export function GoalNextCreatedTarget({ compact }: { compact: boolean }) {
  return (
    <Screen compact={compact} testID="wsf-gsnext-created">
      <Masthead back={false} />
      <Head
        compact={compact}
        title="Your goal is live"
        intro="Send it to your members and put it on a screen."
      />
      <View style={s.live}>
        <Text style={s.liveEyebrow}>NOW OPEN</Text>
        <Text style={s.liveTitle}>{GOAL_NAME}</Text>
        <Text style={[compact ? display.md : display.lg, s.livePhrase]}>{PHRASE}</Text>
        <View style={s.liveRule} />
        <Text style={s.liveMeta}>
          Starts {STARTS} · Ends {ENDS}
        </Text>
        <Text style={s.liveMeta}>
          {ZONE} · {REPEAT_ONCE}
        </Text>
        <Primary label="Open the contribute page" />
        <Text style={s.liveCaption}>
          Where members record what they did and watch the shared total grow.
        </Text>
      </View>
      <Secondary label="Show on a big screen" />
      <Text style={kit.caption}>
        A live view of the total for a TV or projector where everyone can see it.
      </Text>
      <Secondary label="Back to community" />
    </Screen>
  );
}

/* ------------------------------------------------------------------ styles */

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CREAM },
  screenBody: { flex: 1, paddingHorizontal: 20, gap: 12, overflow: 'hidden' },

  reserve: {
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
    backgroundColor: 'rgba(11,31,58,0.045)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reserveText: { color: INK_QUIET, fontSize: 9, fontWeight: '800', letterSpacing: 1.1 },

  head: { gap: 0 },
  headTitle: { marginTop: 4 },
  headIntro: { color: TEXT_MUTED, marginTop: 6 },

  // ---- the spine ----
  step: { flexDirection: 'row', gap: 12 },
  stepTight: { marginTop: -2 },
  spine: { width: 26, alignItems: 'center' },
  spineDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spineDotText: { color: CREAM, fontSize: 13, fontWeight: '900' },
  spineRule: { flex: 1, width: 2, backgroundColor: HAIRLINE, marginTop: 6 },
  stepBody: { flex: 1, gap: 6 },
  stepTitle: { color: NAVY, fontSize: 18, fontWeight: '800', lineHeight: 26 },
  stepMeta: { color: TEXT_MUTED, fontSize: 13, lineHeight: 18 },
  stepCard: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    padding: 13,
    gap: 9,
    marginTop: 2,
    ...elevation.card,
  },

  // ---- fields ----
  field: { gap: 5 },
  input: {
    borderWidth: 1.5,
    borderColor: CARD_BORDER,
    backgroundColor: SURFACE,
    borderRadius: 14,
    minHeight: 48,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  inputInvalid: { borderColor: ERROR_RED },
  inputValue: { color: NAVY, fontSize: 17, fontWeight: '600' },
  inputPlaceholder: { color: TEXT_MUTED, fontSize: 17 },
  // Target and unit read as one sentence, so they sit on one line where the
  // words allow it and stack when they do not.
  pair: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  pairWide: { flexGrow: 1, flexBasis: 120, minWidth: 110 },
  pairNarrow: { flexGrow: 2, flexBasis: 150, minWidth: 140 },

  payoff: {
    backgroundColor: OPTION_SELECTED_TINT,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  payoffText: { color: NAVY, ...display.md },

  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    borderWidth: 1.5,
    borderColor: CARD_BORDER,
    backgroundColor: SURFACE,
    borderRadius: 999,
    minHeight: 44,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  pillSelected: { borderColor: NAVY, backgroundColor: NAVY },
  optionText: { flex: 1, gap: 2 },
  zone: { marginTop: 2 },

  // ---- the check and the commit, as one object ----
  commit: {
    backgroundColor: NAVY,
    borderRadius: 20,
    padding: 16,
    gap: 5,
    ...elevation.hero,
  },
  commitCompact: { padding: 15 },
  commitTitle: { color: CREAM, fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  commitMeta: { color: HERO_MUTED, fontSize: 14, lineHeight: 19 },
  commitRows: { marginTop: 4, marginBottom: 9 },
  commitNote: { color: HERO_MUTED, fontSize: 12.5, lineHeight: 17, marginTop: 8 },
  sumRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: ON_NAVY_RULE,
  },
  sumLabel: { color: HERO_MUTED, fontSize: 14, flexShrink: 1, minWidth: 0 },
  sumValue: {
    color: CREAM,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'right',
    flexShrink: 1,
    minWidth: 0,
    marginLeft: 'auto',
  },

  // ---- actions ----
  // ACTION_GREEN with ON_ACTION ink: the kit's designated action token, which
  // this route does not use today (it fills its primary with PROGRESS_GREEN,
  // the confirmed-total colour the kit reserves for the Living WE).
  primary: {
    backgroundColor: ACTION_GREEN,
    borderRadius: 14,
    minHeight: 54,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: ON_ACTION, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  secondary: {
    backgroundColor: SURFACE,
    borderWidth: 1.5,
    borderColor: NAVY,
    borderRadius: 14,
    minHeight: 48,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { color: NAVY, fontSize: 15, fontWeight: '700' },
  secondaryOnNavy: {
    borderWidth: 1.5,
    borderColor: 'rgba(247,245,240,0.45)',
    borderRadius: 14,
    minHeight: 48,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryOnNavyText: { color: CREAM, fontSize: 15, fontWeight: '700' },

  // ---- outcomes ----
  banner: { borderRadius: 16, padding: 14, gap: 4, borderLeftWidth: 5 },
  bannerError: { backgroundColor: '#FBECEC', borderLeftColor: ERROR_RED },
  // Amber, not red: an unknown outcome is not a failure, and colouring it as
  // one is its own false claim.
  bannerUnknown: { backgroundColor: '#FDF3E2', borderLeftColor: '#B8761B' },
  bannerLive: { backgroundColor: '#EAF7EF', borderLeftColor: PROGRESS_GREEN },
  bannerTitleError: { color: ERROR_RED, fontSize: 17, fontWeight: '800', lineHeight: 23 },
  bannerTitleUnknown: { color: '#8A5610', fontSize: 17, fontWeight: '800', lineHeight: 23 },
  bannerTitleLive: { color: NAVY, fontSize: 17, fontWeight: '800', lineHeight: 23 },
  bannerBody: { color: NAVY, fontSize: 14, lineHeight: 20 },

  // ---- the live goal ----
  live: { backgroundColor: NAVY, borderRadius: 20, padding: 18, gap: 8, ...elevation.hero },
  liveEyebrow: {
    color: PROGRESS_GREEN,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  liveTitle: { color: CREAM, fontSize: 20, fontWeight: '700', lineHeight: 26 },
  livePhrase: { color: CREAM },
  liveRule: { height: 1, backgroundColor: ON_NAVY_RULE, marginVertical: 2 },
  liveMeta: { color: HERO_MUTED, fontSize: 13.5, lineHeight: 19 },
  liveCaption: { color: HERO_MUTED, fontSize: 12.5, lineHeight: 17 },

  scrolledFrom: {
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
    paddingBottom: 8,
  },
  scrolledFromText: { color: INK_QUIET, fontSize: 11, fontWeight: '800', letterSpacing: 0.9 },
});
