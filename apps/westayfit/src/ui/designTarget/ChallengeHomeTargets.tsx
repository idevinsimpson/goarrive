import { useState } from 'react';
import { type LayoutChangeEvent, ScrollView, StyleSheet, Text, View } from 'react-native';

import { WsfWordmark } from '../WsfWordmark';
import {
  ACTION_GREEN,
  ACTION_GREEN_DEEP,
  CARD_BORDER,
  CREAM,
  ERROR_RED,
  HAIRLINE,
  INK_QUIET,
  NAVY,
  ON_ACTION,
  ON_NAVY,
  ON_NAVY_MUTED,
  PROGRESS_GREEN,
  SURFACE,
  display,
  elevation,
} from '../kit';

/**
 * ATLAS BATCH C — THE CHALLENGE, AND THE DOOR EVERYTHING ELSE OPENS FROM.
 * TARGETS, NOT IMPLEMENTED PAGES.
 *
 *   C1  /community/[groupId]/challenge   the challenge in the room   10 states
 *   C2  /                                the home resolver            7 states
 *
 * WHY THESE TWO SHARE A BATCH. They are the two ends of the same minute. `/`
 * is where an app opens and, for almost everyone almost always, is a screen
 * nobody sees — it resolves and replaces. The challenge is the opposite: it is
 * the screen a hundred people are looking at simultaneously while an emcee
 * says "everyone do this now". One must disappear well; the other must hold a
 * room. Drawing them together is what keeps the first from being decorated and
 * the second from being quiet.
 *
 * ── THE ONE PLACE THIS PRODUCT COUNTS PEOPLE, AND WHY IT IS ALLOWED ───────
 *
 * "18 members moving" is not an invention and not a liberty taken here.
 * `wsfListChallenge` returns `totals.participantCount` as a server-side
 * aggregate, and the route prints it as `${participantCount} members moving`.
 * It is a count of memberships that checked in, never a list, never a name,
 * never an order. The server comment is explicit that there is no leaderboard
 * and no member identity under any pulse input.
 *
 * So the rule this product actually holds is not "never count people" — it is
 * "never invent a number, and never turn a count into a comparison". A count
 * the server computed, shown without names and without rank, is the honest
 * form of "you are not doing this alone", which is the entire reason a room
 * full of people looks up at a screen.
 *
 * ── WHAT THIS BATCH REFUSES ───────────────────────────────────────────────
 *
 * NO COMPLETED-CHALLENGE SCREEN, because the route cannot render one.
 *   `wsfListChallenge` queries `status == 'active'` and returns
 *   `challenge: null` for anything else, which the route renders as "No active
 *   challenge". A finished challenge and a community that never had one are
 *   the same screen. Drawing a "challenge complete!" retrospective would be
 *   drawing a surface the query makes unreachable.
 *
 * REACHED IS A STATE OF THE NUMBER, NOT OF THE SCREEN.
 *   A challenge whose `completedCount` passes its `goalTarget` is still
 *   `active` and still accepting check-ins. So the target marks it in the
 *   hero and changes nothing else: the moves stay tappable, because they are.
 *
 * NO FILL WITHOUT A TARGET.
 *   `goalTarget` is nullable and admin-set. When it is null the route prints
 *   the count alone, with no "of N" — so the instrument is absent too, rather
 *   than drawn full or drawn empty. A progress bar with no denominator is a
 *   picture of a number nobody chose.
 *
 * NO NAMES, NO FACES, NO RANK, NO BODY DATA, NO STREAK anywhere.
 *
 * NOTHING ON `/` THAT SURVIVES A SUCCESSFUL RESOLVE.
 *   Home replaces into the member's community the moment the real list lands.
 *   Every frame here is therefore a state where the resolve did NOT happen —
 *   no membership, several with none chosen, still loading, or failed. A rich
 *   dashboard on `/` would be a screen designed for a case the router removes.
 */

/* ── shell ──────────────────────────────────────────────────────────────── */

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

function Field({
  compact,
  grow,
  frameHeight,
  chip,
  chipTone = 'quiet',
  children,
}: {
  compact: boolean;
  grow?: number;
  frameHeight: number;
  chip?: string;
  chipTone?: 'quiet' | 'action' | 'live';
  children: React.ReactNode;
}) {
  const minHeight =
    !grow || compact || frameHeight === 0 ? undefined : Math.round(frameHeight * grow);
  return (
    <View style={[s.field, compact ? s.fieldCompact : null, minHeight ? { minHeight } : null]}>
      <FieldTexture />
      <View style={s.fieldTop}>
        <WsfWordmark variant="white" height={compact ? 15 : 17} />
        {chip ? (
          <View
            style={[
              s.chip,
              chipTone === 'action' ? s.chipAction : null,
              chipTone === 'live' ? s.chipLive : null,
            ]}
          >
            {chipTone === 'live' ? <View style={s.chipDot} /> : null}
            <Text
              style={[
                s.chipText,
                chipTone === 'action' ? s.chipTextAction : null,
                chipTone === 'live' ? s.chipTextLive : null,
              ]}
            >
              {chip}
            </Text>
          </View>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function Frame({
  id,
  children,
}: {
  id: string;
  children: (ctx: { compact: boolean; frameHeight: number }) => React.ReactNode;
}) {
  const { box, onLayout, compact } = useBox();
  return (
    <View style={s.screen} onLayout={onLayout} testID={`wsf-target-c-${id}`}>
      <ScrollView contentContainerStyle={s.body}>
        {children({ compact, frameHeight: box?.height ?? 0 })}
      </ScrollView>
    </View>
  );
}

function Sheet({ compact, children }: { compact: boolean; children: React.ReactNode }) {
  return <View style={[s.sheet, compact ? s.sheetCompact : null]}>{children}</View>;
}

function Foot({ children }: { children: React.ReactNode }) {
  return (
    <>
      <View style={s.spacer} />
      <View style={s.foot}>{children}</View>
    </>
  );
}

function Primary({
  label,
  disabled,
  working,
  done,
}: {
  label: string;
  disabled?: boolean;
  working?: boolean;
  done?: boolean;
}) {
  return (
    <View
      style={[
        s.primary,
        disabled || working ? s.primaryOff : null,
        done ? s.primaryDone : null,
      ]}
    >
      {working ? <View style={s.spinner} /> : null}
      {done ? <View style={s.tick} /> : null}
      <Text
        style={[
          s.primaryText,
          disabled || working ? s.primaryTextOff : null,
          done ? s.primaryTextDone : null,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

function Secondary({ label, quiet }: { label: string; quiet?: boolean }) {
  return (
    <View style={quiet ? s.secondaryQuiet : s.secondary}>
      <Text style={quiet ? s.secondaryQuietText : s.secondaryText}>{label}</Text>
    </View>
  );
}

function Banner({ tone, title, body }: { tone: 'error' | 'note'; title: string; body?: string }) {
  return (
    <View style={[s.banner, tone === 'error' ? s.bannerError : s.bannerNote]}>
      <Text style={[s.bannerTitle, tone === 'error' ? s.bannerTitleError : null]}>{title}</Text>
      {body ? <Text style={s.bannerBody}>{body}</Text> : null}
    </View>
  );
}

/**
 * The instrument, and the rule for when it is allowed to exist. `pct` is
 * `completedCount / goalTarget` — both server aggregates — and the caller
 * passes `null` when `goalTarget` is null, which draws nothing at all.
 */
function Fill({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <View style={s.fillTrack}>
      <View style={[s.fillBar, { width: `${clamped}%` }]} />
    </View>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   C1 · /community/[groupId]/challenge
   ════════════════════════════════════════════════════════════════════════ */

/**
 * A MOVE CARD IS ONE INSTRUCTION AND ONE BUTTON.
 *
 * Its six states are the whole interaction design of this page, because at an
 * event the card is read at arm's length by someone who is half listening. So
 * the state lives in the button — the one thing a thumb is already aimed at —
 * and never only in a colour.
 *
 *   fresh      "I did this", green, the obvious tap.
 *   code       a code field above it; the button is off until something is in
 *              it, because the server will refuse an empty one and a refusal
 *              after a tap is worse than a button that waits.
 *   ready      the same card with the code entered and the button live.
 *   counting   "Counting…" — one round trip, and the card does not move.
 *   counted    "Already counted", the button settles into the card and stops
 *              asking. Not hidden: the member needs to see that it registered,
 *              and a card that vanishes reads as a card that failed.
 *   error      the reason under the button, the button still live. Check-in is
 *              idempotent by deterministic document id, so retrying is safe
 *              and the target does not warn against it.
 */
function MoveCard({
  title,
  instructions,
  location,
  state,
  code,
}: {
  title: string;
  instructions: string;
  location?: string;
  state: 'fresh' | 'code' | 'ready' | 'counting' | 'counted' | 'error';
  code?: string;
}) {
  const needsCode = state === 'code' || state === 'ready';
  return (
    <View style={[s.move, state === 'counted' ? s.moveDone : null]}>
      <Text style={s.moveTitle}>{title}</Text>
      <Text style={s.moveBody}>{instructions}</Text>
      {location ? <Text style={s.moveMeta}>{location}</Text> : null}
      {needsCode ? (
        <View style={[s.codeInput, state === 'ready' ? s.codeInputFilled : null]}>
          <Text style={state === 'ready' ? s.codeValue : s.codePlaceholder}>
            {state === 'ready' ? (code ?? 'RIVER-42') : 'Check-in code'}
          </Text>
        </View>
      ) : null}
      {state === 'counted' ? (
        <Primary label="Already counted" done />
      ) : state === 'counting' ? (
        <Primary label="Counting…" working />
      ) : state === 'code' ? (
        <Primary label="I did this" disabled />
      ) : (
        <Primary label="I did this" />
      )}
      {state === 'error' ? (
        <Text style={s.moveError}>That code didn’t match. Check it and try again.</Text>
      ) : null}
    </View>
  );
}

function ChallengeHero({
  compact,
  frameHeight,
  count,
  target,
  participants,
  reached,
}: {
  compact: boolean;
  frameHeight: number;
  count: string;
  target: string | null;
  participants: string;
  reached?: boolean;
}) {
  const pct = target ? 100 : null;
  return (
    <Field
      compact={compact}
      grow={0.36}
      frameHeight={frameHeight}
      chip={reached ? 'Reached' : 'Live'}
      chipTone="live"
    >
      <Text style={s.fieldEyebrow}>Challenge</Text>
      <Text style={[compact ? display.md : display.lg, s.fieldTitle]}>
        Riverside Fall Kickoff
      </Text>
      {/*
        THE NUMBER IS THE BIGGEST THING IN THE ROOM. At an event this screen is
        held up, propped on a table, and glanced at from three metres. Nothing
        above it competes: the eyebrow is small, the title is a title, and the
        count owns the field.
      */}
      <Text style={s.bigCount}>
        {count}
        {target ? <Text style={s.bigCountOf}> of {target}</Text> : null}
      </Text>
      <Fill pct={reached ? pct : target ? 42 : null} />
      <Text style={s.fieldIntro}>{participants}</Text>
      {reached ? (
        <Text style={s.reachedLine}>Target reached. It is still open — keep going.</Text>
      ) : null}
    </Field>
  );
}

export function ChallengeLiveTarget() {
  return (
    <Frame id="challenge-live">
      {({ compact, frameHeight }) => (
        <>
          <ChallengeHero
            compact={compact}
            frameHeight={frameHeight}
            count="42"
            target="100"
            participants="18 members moving"
          />
          <Sheet compact={compact}>
            <MoveCard
              title="Ten squats, together"
              instructions="Wherever you are. Count them out loud if you can."
              state="fresh"
            />
            <MoveCard
              title="Lap of the hall"
              instructions="Once around the outside, any pace."
              location="Main hall"
              state="code"
            />
            <MoveCard
              title="Stretch and breathe"
              instructions="Two minutes. Reach up, roll the shoulders back."
              state="counted"
            />
            <Foot>
              <Secondary label="Back to community" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function ChallengeOpenEndedTarget() {
  return (
    <Frame id="challenge-open-ended">
      {({ compact, frameHeight }) => (
        <>
          {/*
            NO TARGET, SO NO DENOMINATOR AND NO BAR. `goalTarget` is nullable
            and admin-set; when it is null the route prints the count alone.
            A bar here would be a picture of a ratio nobody chose.
          */}
          <ChallengeHero
            compact={compact}
            frameHeight={frameHeight}
            count="42"
            target={null}
            participants="18 members moving"
          />
          <Sheet compact={compact}>
            <MoveCard
              title="Ten squats, together"
              instructions="Wherever you are. Count them out loud if you can."
              state="fresh"
            />
            <MoveCard
              title="Lap of the hall"
              instructions="Once around the outside, any pace."
              location="Main hall"
              state="fresh"
            />
            <Foot>
              <Secondary label="Back to community" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function ChallengeReachedTarget() {
  return (
    <Frame id="challenge-reached">
      {({ compact, frameHeight }) => (
        <>
          <ChallengeHero
            compact={compact}
            frameHeight={frameHeight}
            count="104"
            target="100"
            participants="31 members moving"
            reached
          />
          <Sheet compact={compact}>
            {/*
              REACHED CHANGES THE HERO AND NOTHING ELSE. The challenge is still
              `active` and still accepting check-ins, so every move stays
              tappable. Locking them at the target would refuse a member who
              did the thing, for the crime of arriving after the number moved.
            */}
            <MoveCard
              title="Ten squats, together"
              instructions="Wherever you are. Count them out loud if you can."
              state="fresh"
            />
            <MoveCard
              title="Lap of the hall"
              instructions="Once around the outside, any pace."
              location="Main hall"
              state="counted"
            />
            <Foot>
              <Secondary label="Back to community" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function ChallengeAllCountedTarget() {
  return (
    <Frame id="challenge-all-counted">
      {({ compact, frameHeight }) => (
        <>
          <ChallengeHero
            compact={compact}
            frameHeight={frameHeight}
            count="67"
            target="100"
            participants="24 members moving"
          />
          <Sheet compact={compact}>
            {/*
              EVERY MOVE COUNTED, FOR THIS MEMBER. The one line that changes is
              a note, not a trophy: the challenge is not over, and their part
              in it is. It says what is true and does not ask for anything.
            */}
            <Banner
              tone="note"
              title="You’ve done all of them."
              body="The challenge is still running. Your part is counted."
            />
            <MoveCard
              title="Ten squats, together"
              instructions="Wherever you are. Count them out loud if you can."
              state="counted"
            />
            <MoveCard
              title="Lap of the hall"
              instructions="Once around the outside, any pace."
              location="Main hall"
              state="counted"
            />
            <MoveCard
              title="Stretch and breathe"
              instructions="Two minutes. Reach up, roll the shoulders back."
              state="counted"
            />
            <Foot>
              <Secondary label="Back to community" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

/**
 * THE MOVE-CARD STATE STRIP. Not a screen the product renders — one frame that
 * puts all six card states in a column so the set can be reviewed as a set.
 * The brief asked for state strips rather than a hundred and forty isolated
 * screens, and this is what that means for the one component on this page that
 * has real states.
 */
export function ChallengeMoveStatesTarget() {
  return (
    <Frame id="challenge-move-states">
      {({ compact }) => (
        <>
          <View style={[s.fieldQuiet, compact ? s.fieldQuietCompact : null]}>
            <WsfWordmark variant="navy" height={compact ? 18 : 20} />
            <Text style={s.stripTitle}>A move card, in all six states</Text>
            <Text style={s.stripNote}>
              Reference frame — the product never shows these together.
            </Text>
          </View>
          <Sheet compact={compact}>
            <Text style={s.stripLabel}>Fresh</Text>
            <MoveCard title="Ten squats, together" instructions="Wherever you are." state="fresh" />
            <Text style={s.stripLabel}>Needs a code — button off</Text>
            <MoveCard title="Lap of the hall" instructions="Once around the outside." state="code" />
            <Text style={s.stripLabel}>Code entered — button live</Text>
            <MoveCard title="Lap of the hall" instructions="Once around the outside." state="ready" />
            <Text style={s.stripLabel}>Counting</Text>
            <MoveCard title="Ten squats, together" instructions="Wherever you are." state="counting" />
            <Text style={s.stripLabel}>Counted</Text>
            <MoveCard title="Ten squats, together" instructions="Wherever you are." state="counted" />
            <Text style={s.stripLabel}>Refused — safe to retry</Text>
            <MoveCard title="Lap of the hall" instructions="Once around the outside." state="error" />
          </Sheet>
        </>
      )}
    </Frame>
  );
}

/**
 * The four states with no challenge to show. They share a shape: quiet header,
 * one card, one way on. What differs is whose problem it is and what resolves
 * it, which is the only thing these screens have to get right.
 */
function Quiet({
  compact,
  title,
  body,
  action,
  back,
}: {
  compact: boolean;
  title: string;
  body: string;
  action?: string;
  back: string;
}) {
  return (
    <>
      <View style={[s.fieldQuiet, compact ? s.fieldQuietCompact : null]}>
        <WsfWordmark variant="navy" height={compact ? 18 : 20} />
      </View>
      <Sheet compact={compact}>
        <View style={s.quietCard}>
          <Text style={[compact ? display.md : display.lg, s.quietTitle]}>{title}</Text>
          <Text style={s.quietBody}>{body}</Text>
        </View>
        {action ? <Primary label={action} /> : null}
        <Foot>
          <Secondary label={back} quiet />
        </Foot>
      </Sheet>
    </>
  );
}

export function ChallengeNoneTarget() {
  return (
    <Frame id="challenge-none">
      {({ compact }) => (
        <Quiet
          compact={compact}
          title="No challenge running."
          /*
            THIS IS ALSO WHAT A FINISHED CHALLENGE LOOKS LIKE, because
            wsfListChallenge queries status == 'active' and returns null for
            everything else. The copy therefore may not say "not yet" — for
            half the people who see it, it already happened.
          */
          body="There is no challenge running here right now. Your community’s goals are still open on its home page."
          back="Back to community"
        />
      )}
    </Frame>
  );
}

export function ChallengeNotMemberTarget() {
  return (
    <Frame id="challenge-not-member">
      {({ compact }) => (
        <Quiet
          compact={compact}
          title="You’re not in this community."
          /*
            A CLOSED DOOR, NOT AN ACCUSATION. The server refuses a non-member
            with permission-denied and the target says the plain fact without
            implying they did something wrong or that the community is hiding.
          */
          body="Only members can see a community’s challenge. If someone sent you an invite link, open it and you’ll be in."
          back="Back to home"
        />
      )}
    </Frame>
  );
}

export function ChallengeSignedOutTarget() {
  return (
    <Frame id="challenge-signed-out">
      {({ compact }) => (
        <Quiet
          compact={compact}
          title="Sign in to see this challenge."
          body="Challenges belong to a community, so we need to know which of yours this is."
          action="Sign in"
          back="Back to home"
        />
      )}
    </Frame>
  );
}

export function ChallengeErrorTarget() {
  return (
    <Frame id="challenge-error">
      {({ compact }) => (
        <Quiet
          compact={compact}
          title="Something went wrong."
          body="We couldn’t load this challenge. Nothing you did is lost — try again."
          action="Try again"
          back="Back to community"
        />
      )}
    </Frame>
  );
}

export function ChallengeLoadingTarget() {
  return (
    <Frame id="challenge-loading">
      {({ compact }) => (
        <>
          <View style={[s.fieldQuiet, compact ? s.fieldQuietCompact : null]}>
            <WsfWordmark variant="navy" height={compact ? 18 : 20} />
          </View>
          <Sheet compact={compact}>
            <View style={s.skelHero}>
              <View style={[s.skel, { width: '32%', height: 11 }]} />
              <View style={[s.skel, { width: '72%', height: 28 }]} />
              <View style={[s.skel, { width: '44%', height: 40 }]} />
            </View>
            {[0, 1].map((i) => (
              <View key={i} style={s.skelCard}>
                <View style={[s.skel, { width: '58%', height: 14 }]} />
                <View style={[s.skel, { width: '90%', height: 11 }]} />
                <View style={[s.skel, { width: '100%', height: 44 }]} />
              </View>
            ))}
            <Text style={s.loadingNote}>Loading…</Text>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   C2 · / — THE HOME RESOLVER
   ════════════════════════════════════════════════════════════════════════ */

/**
 * The code-entry field. It is here because it is real: `JoinWithCodeField` on
 * `/` validates a pasted code against `JOIN_CODE_SHAPE` and pushes to
 * `/join/<code>`. This is the ONLY place in the product that accepts a typed
 * code, which makes it worth drawing properly rather than leaving as a row at
 * the bottom of a page.
 */
function JoinField({
  title,
  value,
  error,
}: {
  title: string;
  value?: string;
  error?: string;
}) {
  return (
    <View style={s.joinCard}>
      <Text style={s.joinTitle}>{title}</Text>
      <View style={s.joinRow}>
        <View style={[s.joinInput, error ? s.joinInputInvalid : null]}>
          <Text style={value ? s.joinValue : s.joinPlaceholder}>{value ?? 'Paste a join code'}</Text>
        </View>
        <View style={[s.joinGo, value ? null : s.joinGoOff]}>
          <Text style={[s.joinGoText, value ? null : s.joinGoTextOff]}>Go</Text>
        </View>
      </View>
      {error ? <Text style={s.joinError}>{error}</Text> : null}
    </View>
  );
}

/**
 * One community, one card, one way in — the whole card is the control.
 *
 * THE STATUS LINE IS COLOURED BY WHETHER THERE IS SOMETHING TO DO, not by
 * being a status line. "October Push-Up Challenge · ends Sat" is news and
 * carries the action colour; "No open goal right now" is the absence of news
 * and must not, or the list says every community is equally alive and the
 * member has to read every word to find the one that isn't.
 */
function CommunityCard({
  name,
  meta,
  status,
  quiet,
}: {
  name: string;
  meta: string;
  status: string;
  quiet?: boolean;
}) {
  return (
    <View style={s.commCard}>
      <View style={s.commText}>
        <Text style={s.commName}>{name}</Text>
        <Text style={s.commMeta}>{meta}</Text>
        <Text style={[s.commStatus, quiet ? s.commStatusQuiet : null]}>{status}</Text>
      </View>
      <View style={s.commGo}>
        <Text style={s.commGoText}>Open</Text>
      </View>
    </View>
  );
}

export function HomeSignedOutTarget() {
  return (
    <Frame id="home-signed-out">
      {({ compact, frameHeight }) => (
        <>
          <Field compact={compact} grow={0.46} frameHeight={frameHeight}>
            <Text style={[compact ? display.md : display.lg, s.fieldTitle]}>
              Turn your community into a place that moves.
            </Text>
            <Text style={s.fieldIntro}>
              Shared challenges. More movement. Stronger communities.
            </Text>
            <View style={s.heroActions}>
              <Primary label="Create an account" />
              <View style={s.onNavySecondary}>
                <Text style={s.onNavySecondaryText}>Sign in</Text>
              </View>
            </View>
          </Field>
          <Sheet compact={compact}>
            <JoinField title="Join with a code" />
            <Foot>
              <Text style={s.footNote}>
                Someone already in a community can send you a link or a code.
              </Text>
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

/**
 * THE SCREEN THAT SHOULD BARELY EXIST. Home replaces into the member's
 * community as soon as the real list lands, so this frame is a fraction of a
 * second long. It is drawn anyway because on a slow connection it is not, and
 * because what it must never do is look like a destination — no hero, no
 * cards, nothing to start reading and then have pulled away. A line, the
 * wordmark, and the name of where they are going.
 */
export function HomeOpeningTarget() {
  return (
    <Frame id="home-opening">
      {({ compact }) => (
        <>
          <View style={[s.fieldQuiet, compact ? s.fieldQuietCompact : null]}>
            <WsfWordmark variant="navy" height={compact ? 18 : 20} />
          </View>
          <Sheet compact={compact}>
            <View style={s.openingBlock}>
              <View style={s.openingDots}>
                <View style={[s.openingDot, s.openingDot1]} />
                <View style={[s.openingDot, s.openingDot2]} />
                <View style={[s.openingDot, s.openingDot3]} />
              </View>
              <Text style={s.openingText}>Opening your community…</Text>
            </View>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function HomeChooseTarget() {
  return (
    <Frame id="home-choose">
      {({ compact, frameHeight }) => (
        <>
          <Field compact={compact} grow={0.22} frameHeight={frameHeight}>
            <Text style={s.fieldEyebrow}>Choose a community</Text>
            <Text style={[compact ? display.md : display.lg, s.fieldTitle]}>
              Where are you moving today?
            </Text>
            {/*
              SEVERAL COMMUNITIES AND NONE CHOSEN YET — the one case the list
              was ever the right answer for. resolveCurrentCommunity returns
              null here rather than picking the first, so the target does not
              mark any row as current. Nobody has chosen.
            */}
          </Field>
          <Sheet compact={compact}>
            <CommunityCard
              name="The Henderson Family"
              meta="Family & friends · Champion · 6 members"
              status="October Push-Up Challenge · ends Sat"
            />
            <CommunityCard
              name="Riverside Church"
              meta="Other community · 84 members"
              status="No open goal right now"
              quiet
            />
            <JoinField title="Join another community" />
            <Secondary label="Start a community" />
            <Foot>
              <Text style={s.footNote}>
                We’ll open whichever you pick next time you come back.
              </Text>
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function HomeEmptyTarget() {
  return (
    <Frame id="home-empty">
      {({ compact, frameHeight }) => (
        <>
          <Field compact={compact} grow={0.38} frameHeight={frameHeight}>
            <Text style={[compact ? display.md : display.lg, s.fieldTitle]}>
              You’re not in a community yet.
            </Text>
            <Text style={s.fieldIntro}>
              A community is a group that moves together — a family, a church, a
              workplace. Everyone adds to the same total.
            </Text>
          </Field>
          <Sheet compact={compact}>
            {/*
              TWO REAL WAYS IN, BOTH OF WHICH WORK TODAY. Starting one is the
              primary because it is the only one that does not need somebody
              else; the code field is beside it because a pasted code is how
              most people actually arrive.
            */}
            <Primary label="Start a community" />
            <JoinField title="Join with a code" />
            <Foot>
              <Text style={s.footNote}>
                Communities aren’t listed or searchable. You get in by a link or a code.
              </Text>
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function HomeListLoadingTarget() {
  return (
    <Frame id="home-my-loading">
      {({ compact, frameHeight }) => (
        <>
          <Field compact={compact} grow={0.22} frameHeight={frameHeight}>
            <Text style={s.fieldEyebrow}>Choose a community</Text>
            <Text style={[compact ? display.md : display.lg, s.fieldTitle]}>
              Where are you moving today?
            </Text>
          </Field>
          <Sheet compact={compact}>
            {[0, 1].map((i) => (
              <View key={i} style={s.skelCard}>
                <View style={[s.skel, { width: '62%', height: 16 }]} />
                <View style={[s.skel, { width: '48%', height: 11 }]} />
                <View style={[s.skel, { width: '74%', height: 11 }]} />
              </View>
            ))}
            <Text style={s.loadingNote}>Loading your communities…</Text>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function HomeListErrorTarget() {
  return (
    <Frame id="home-my-error">
      {({ compact, frameHeight }) => (
        <>
          <Field compact={compact} grow={0.22} frameHeight={frameHeight}>
            <Text style={s.fieldEyebrow}>Choose a community</Text>
            <Text style={[compact ? display.md : display.lg, s.fieldTitle]}>
              Where are you moving today?
            </Text>
          </Field>
          <Sheet compact={compact}>
            {/*
              THE LIST FAILED; THE PAGE DID NOT. The two controls that work
              without the list stay exactly where they were, so a failed read
              does not also take away the ways in.
            */}
            <Banner
              tone="error"
              title="We couldn’t load your communities."
              body="Nothing has changed. Check your connection and try again."
            />
            <Primary label="Try again" />
            <JoinField title="Join with a code" />
            <Secondary label="Start a community" />
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function HomeCodeRejectedTarget() {
  return (
    <Frame id="home-code-rejected">
      {({ compact, frameHeight }) => (
        <>
          <Field compact={compact} grow={0.38} frameHeight={frameHeight}>
            <Text style={[compact ? display.md : display.lg, s.fieldTitle]}>
              You’re not in a community yet.
            </Text>
            <Text style={s.fieldIntro}>
              A community is a group that moves together — a family, a church, a
              workplace. Everyone adds to the same total.
            </Text>
          </Field>
          <Sheet compact={compact}>
            <Primary label="Start a community" />
            {/*
              SHAPE, NOT EXISTENCE. This message fires before anything is sent:
              the code does not match JOIN_CODE_SHAPE, so it cannot be a code.
              It deliberately does not say whether any community has it — that
              question is answered, identically for every cause, on the
              invitation screen itself.
            */}
            <JoinField
              title="Join with a code"
              value="hello there"
              error="That does not look like a valid code."
            />
            <Foot>
              <Text style={s.footNote}>
                Communities aren’t listed or searchable. You get in by a link or a code.
              </Text>
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

/* ── styles ─────────────────────────────────────────────────────────────── */

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CREAM },
  body: { flexGrow: 1 },

  field: {
    backgroundColor: NAVY,
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 30,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    gap: 6,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    ...elevation.hero,
  },
  fieldCompact: { paddingTop: 16, paddingBottom: 20, gap: 4 },
  fieldQuiet: { paddingHorizontal: 20, paddingTop: 26, paddingBottom: 10, gap: 6 },
  fieldQuietCompact: { paddingTop: 16, paddingBottom: 6 },
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
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(247,245,240,0.12)',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  chipAction: { backgroundColor: 'rgba(145,203,125,0.18)' },
  chipLive: { backgroundColor: 'rgba(34,197,94,0.20)' },
  chipDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: ACTION_GREEN },
  chipText: { color: ON_NAVY_MUTED, fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  chipTextAction: { color: PROGRESS_GREEN },
  chipTextLive: { color: PROGRESS_GREEN },
  fieldEyebrow: {
    color: PROGRESS_GREEN,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  fieldTitle: { color: ON_NAVY },
  fieldIntro: { color: ON_NAVY_MUTED, fontSize: 13.5, lineHeight: 19 },
  heroActions: { gap: 10, marginTop: 10 },
  onNavySecondary: {
    minHeight: 50,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(247,245,240,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  onNavySecondaryText: { color: ON_NAVY, fontSize: 16, fontWeight: '800' },

  /* the challenge count */
  bigCount: {
    color: CREAM,
    fontSize: 54,
    lineHeight: 60,
    fontWeight: '900',
    letterSpacing: -2,
    marginTop: 4,
    flexShrink: 1,
    minWidth: 0,
  },
  bigCountOf: { fontSize: 24, lineHeight: 30, fontWeight: '800', color: ON_NAVY_MUTED },
  fillTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(247,245,240,0.16)',
    overflow: 'hidden',
    marginTop: 2,
  },
  fillBar: { height: 10, borderRadius: 999, backgroundColor: ACTION_GREEN },
  reachedLine: { color: PROGRESS_GREEN, fontSize: 13, lineHeight: 18, fontWeight: '800' },

  sheet: { flex: 1, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 24, gap: 12 },
  sheetCompact: { paddingTop: 13, gap: 9 },
  spacer: { flex: 1, minHeight: 10 },
  foot: { gap: 2, borderTopWidth: 1, borderTopColor: HAIRLINE, paddingTop: 8 },
  footNote: { color: INK_QUIET, fontSize: 12, lineHeight: 17, textAlign: 'center' },
  loadingNote: { color: INK_QUIET, fontSize: 13, textAlign: 'center', marginTop: 4 },

  primary: {
    flexDirection: 'row',
    gap: 9,
    backgroundColor: ACTION_GREEN,
    borderRadius: 16,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    ...elevation.action,
  },
  primaryOff: { backgroundColor: '#CDE8D5', shadowOpacity: 0 },
  primaryDone: {
    backgroundColor: SURFACE,
    borderWidth: 1.5,
    borderColor: CARD_BORDER,
    shadowOpacity: 0,
  },
  primaryText: { color: ON_ACTION, fontSize: 16.5, fontWeight: '900' },
  primaryTextOff: { color: '#6B8A76' },
  primaryTextDone: { color: INK_QUIET },
  spinner: {
    width: 15,
    height: 15,
    borderRadius: 8,
    borderWidth: 2.5,
    borderColor: '#6B8A76',
    borderTopColor: 'transparent',
  },
  tick: {
    width: 13,
    height: 7,
    borderLeftWidth: 2.5,
    borderBottomWidth: 2.5,
    borderColor: ACTION_GREEN_DEEP,
    transform: [{ rotate: '-45deg' }],
    marginTop: -4,
  },
  secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: NAVY, fontSize: 15, fontWeight: '800' },
  secondaryQuiet: { minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  secondaryQuietText: { color: INK_QUIET, fontSize: 13.5, fontWeight: '700' },

  banner: { borderRadius: 14, borderLeftWidth: 4, paddingHorizontal: 13, paddingVertical: 11, gap: 3 },
  bannerError: { backgroundColor: '#FBEFEF', borderLeftColor: ERROR_RED },
  bannerNote: { backgroundColor: '#F1F9F3', borderLeftColor: ACTION_GREEN_DEEP },
  bannerTitle: { color: NAVY, fontSize: 14, lineHeight: 19, fontWeight: '900' },
  bannerTitleError: { color: ERROR_RED },
  bannerBody: { color: INK_QUIET, fontSize: 12.5, lineHeight: 17 },

  /* a move card */
  move: {
    backgroundColor: SURFACE,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 15,
    gap: 6,
    ...elevation.card,
  },
  moveDone: { backgroundColor: '#F4F7F4', shadowOpacity: 0 },
  moveTitle: { color: NAVY, fontSize: 16, fontWeight: '900' },
  moveBody: { color: NAVY, fontSize: 13.5, lineHeight: 19 },
  moveMeta: { color: INK_QUIET, fontSize: 12, fontWeight: '700' },
  moveError: { color: ERROR_RED, fontSize: 12.5, lineHeight: 17, fontWeight: '700' },
  codeInput: {
    backgroundColor: CREAM,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: HAIRLINE,
    paddingHorizontal: 13,
    minHeight: 46,
    justifyContent: 'center',
    marginTop: 2,
  },
  codeInputFilled: { borderColor: ACTION_GREEN_DEEP, backgroundColor: SURFACE },
  codePlaceholder: { color: INK_QUIET, fontSize: 15 },
  codeValue: { color: NAVY, fontSize: 15, fontWeight: '800', letterSpacing: 1 },

  /* the state strip */
  stripTitle: { color: NAVY, fontSize: 18, fontWeight: '900', marginTop: 8 },
  stripNote: { color: INK_QUIET, fontSize: 12, lineHeight: 17 },
  stripLabel: {
    color: INK_QUIET,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginTop: 6,
  },

  /* the states with nothing to show */
  quietCard: {
    backgroundColor: SURFACE,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 18,
    gap: 8,
    ...elevation.card,
  },
  quietTitle: { color: NAVY },
  quietBody: { color: INK_QUIET, fontSize: 13.5, lineHeight: 19.5 },

  skelHero: { gap: 9, paddingVertical: 4 },
  skelCard: {
    backgroundColor: SURFACE,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 15,
    gap: 9,
  },
  skel: { backgroundColor: '#E9E5DC', borderRadius: 6 },

  /* the code field on / */
  joinCard: {
    backgroundColor: SURFACE,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 15,
    gap: 9,
    ...elevation.card,
  },
  joinTitle: { color: NAVY, fontSize: 15, fontWeight: '900' },
  joinRow: { flexDirection: 'row', gap: 9, alignItems: 'stretch' },
  joinInput: {
    flex: 1,
    minWidth: 0,
    backgroundColor: CREAM,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: HAIRLINE,
    paddingHorizontal: 13,
    minHeight: 48,
    justifyContent: 'center',
  },
  joinInputInvalid: { borderColor: ERROR_RED },
  joinPlaceholder: { color: INK_QUIET, fontSize: 15 },
  joinValue: { color: NAVY, fontSize: 15, fontWeight: '700' },
  joinGo: {
    minWidth: 68,
    borderRadius: 13,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  joinGoOff: { backgroundColor: '#DDE3E9' },
  joinGoText: { color: CREAM, fontSize: 15, fontWeight: '900' },
  joinGoTextOff: { color: '#8A98A6' },
  joinError: { color: ERROR_RED, fontSize: 12.5, lineHeight: 17, fontWeight: '700' },

  /* a community row on / */
  commCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: SURFACE,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingHorizontal: 15,
    paddingVertical: 14,
    ...elevation.card,
  },
  commText: { flexShrink: 1, minWidth: 0, gap: 2 },
  commName: { color: NAVY, fontSize: 16.5, fontWeight: '900' },
  commMeta: { color: INK_QUIET, fontSize: 12, lineHeight: 16.5 },
  commStatus: { color: ACTION_GREEN_DEEP, fontSize: 13, fontWeight: '800', marginTop: 2 },
  commStatusQuiet: { color: INK_QUIET, fontWeight: '700' },
  commGo: {
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: HAIRLINE,
    paddingHorizontal: 14,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commGoText: { color: NAVY, fontSize: 14, fontWeight: '800' },

  /* the opening moment */
  openingBlock: { alignItems: 'center', justifyContent: 'center', gap: 14, paddingVertical: 40 },
  openingDots: { flexDirection: 'row', gap: 8 },
  openingDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: ACTION_GREEN },
  openingDot1: { opacity: 1 },
  openingDot2: { opacity: 0.55 },
  openingDot3: { opacity: 0.25 },
  openingText: { color: INK_QUIET, fontSize: 14.5, fontWeight: '700' },
});
