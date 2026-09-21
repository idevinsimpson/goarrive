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
 * ATLAS BATCH B — THE INVITATION AND THE THINGS A CHAMPION STARTS.
 * TARGETS, NOT IMPLEMENTED PAGES.
 *
 * Four destinations, twenty-eight states, drawn in the same grammar Batch A
 * established: a navy field with the wordmark's own slash as its texture, a
 * cream sheet under it, one green action. Real React Native against the real
 * kit, rendered only by the gated preview route.
 *
 *   B1  /join/[joinCode]      the invitation                  10 states
 *   B2  /start-community      starting a community             7 states
 *   B3  /goals/new            opening a goal                   8 states
 *   B4  /combined/[setupId]   watching a combined goal         5 states
 *
 * WHAT CHANGES FROM BATCH A, AND WHY. Batch A's screens are about the person
 * arriving — they own no community and no progress value, so its field carries
 * a greeting and no fillable instrument. Every screen here is about a thing
 * that already exists or is being brought into existence, so the field carries
 * THAT THING: the community's name on the invitation, the goal on the live
 * card, the number itself on the combined screen.
 *
 * THE ONE FILLABLE INSTRUMENT IN THIS BATCH is on B4, and it is legitimate
 * there for the reason Batch A refused it everywhere: `wsfCombinedGoalPulse`
 * returns a confirmed `combinedTotal` against a `target`, so the fill is a
 * report, not decoration. It appears nowhere else in the batch, because
 * nowhere else in the batch is there a confirmed number to report.
 *
 * ── WHAT THIS BATCH REFUSES, AND THE PRIMARY SOURCE FOR EACH ──────────────
 *
 * NO MEMBER COUNT, NO GOAL LIST, NO PROGRESS ON THE INVITATION.
 *   `wsfPreviewCommunity` returns `{ displayName, groupType, joinPolicy }` and
 *   nothing else (app/join/[joinCode].tsx, type Preview). A visitor who has not
 *   joined is not entitled to the community's numbers, so the invitation may
 *   not show "14 members" or "3 goals open" — it would be an invention, and an
 *   invention that leaks.
 *
 * "NOT VALID", "PRIVATE" AND "YOU WERE REMOVED" ARE ONE STATE, NOT THREE.
 *   The server returns the same `functions/not-found` for an unknown code, for
 *   a group that is not link-joinable, and for a person whose membership was
 *   REMOVED — deliberately, so the page cannot become an oracle for which
 *   communities exist, nor disclose that this person was once a member of one.
 *   Drawing a distinct "this community is private" or "you were removed"
 *   screen would undo that at the last inch. One state, one wording. (Same
 *   rule at B4: unknown setup, unauthorized setup and revoked permission are
 *   the same two sentences.)
 *
 *   A VOLUNTARILY DEPARTED PERSON IS NOT IN THAT SET, and gets no screen of
 *   their own either: a valid link reactivates their existing membership and
 *   they land on Community Home like anyone else. Leaving is not a ban, so
 *   there is no welcome-back surface to draw — and no "you are already a
 *   member" screen, because an active member's tap replaces straight through.
 *
 * THERE IS NO "JOINED!" SCREEN, AND NO "COMMUNITY CREATED!" SCREEN.
 *   A successful join does `router.replace(destination)` and a successful
 *   create does `router.replace('/community/<id>')`. The success IS Community
 *   Home, which is Page 1 and already accepted. Inventing a celebration screen
 *   between them would be designing a surface the router never renders.
 *
 * A TYPED CODE REACHES THIS ROUTE, FROM `/`.
 *   `JoinWithCodeField` in app/index.tsx validates against `JOIN_CODE_SHAPE`
 *   and pushes to `/join/<code>`, so the invitation is opened by a pasted code
 *   as well as by a tapped link. Same screen either way, so it is drawn once.
 *
 * THERE IS NO PROFILE GATE ON THE INVITATION.
 *   The signed-out invitation routes to `/signup`; the profile step is its own
 *   route and its own Batch A target. This batch does not redraw it.
 *
 * THERE IS NO MOVEMENT CATALOG IN `/goals/new`.
 *   A goal is a title, a whole number and a unit the Champion types
 *   (FIELD_ORDER = title, target, unit, starts, ends, timezone). Nothing in
 *   that route picks an activity from a list, so this batch draws none. The
 *   unified movement picker is a MOVE-flow target and stays there.
 *
 * `/combined/[setupId]` IS NOT A SETUP WIZARD.
 *   It is a read-only live view that polls `wsfCombinedGoalPulse` every two
 *   seconds and renders nothing a Champion can operate. `setupId` names a
 *   stored combined-goal setup; it is not a flow in progress. So there is no
 *   setup progress, no success and no recovery here beyond "Check again".
 *
 * NO NAMES, NO FACES, NO CONTRIBUTOR COUNTS anywhere in the batch, for the
 * reason every other page has none: no callable returns them.
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

/** The diagonal bands are the wordmark's own slash, enlarged. Not a gradient. */
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

/**
 * The navy field. `grow` lets a screen whose field IS the content (the
 * invitation, the combined total) take a real share of a tall phone, the way
 * Batch A's does; a screen that is mostly form leaves the height to the form.
 */
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
    <View style={s.screen} onLayout={onLayout} testID={`wsf-target-b-${id}`}>
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

/* ── parts ──────────────────────────────────────────────────────────────── */

function FormField({
  label,
  value,
  placeholder,
  hint,
  suffix,
  invalid,
  error,
}: {
  label: string;
  value?: string;
  placeholder?: string;
  hint?: string;
  suffix?: string;
  invalid?: boolean;
  error?: string;
}) {
  return (
    <View style={s.formField}>
      <Text style={s.formLabel}>{label}</Text>
      <View style={[s.input, invalid ? s.inputInvalid : null]}>
        <Text style={value ? s.inputValue : s.inputPlaceholder}>{value ?? placeholder ?? ''}</Text>
        {suffix ? <Text style={s.inputSuffix}>{suffix}</Text> : null}
        {hint ? <Text style={s.inputHint}>{hint}</Text> : null}
      </View>
      {error ? <Text style={s.fieldError}>{error}</Text> : null}
    </View>
  );
}

function Primary({
  label,
  disabled,
  working,
}: {
  label: string;
  disabled?: boolean;
  working?: boolean;
}) {
  return (
    <View style={[s.primary, disabled || working ? s.primaryOff : null]}>
      {working ? <View style={s.spinner} /> : null}
      <Text style={[s.primaryText, disabled || working ? s.primaryTextOff : null]}>{label}</Text>
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

function Card({
  title,
  children,
  tint,
}: {
  title?: string;
  children: React.ReactNode;
  tint?: boolean;
}) {
  return (
    <View style={[s.card, tint ? s.cardTint : null]}>
      {title ? <Text style={s.cardTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

/** A bulleted fact. The dot is a mark, not a character the screen reader reads. */
function Fact({ children }: { children: React.ReactNode }) {
  return (
    <View style={s.fact}>
      <View style={s.factDot} />
      <Text style={s.factText}>{children}</Text>
    </View>
  );
}

/**
 * A banded message. `tone` is carried by the band AND the words, never by
 * colour alone — the batch has to read the same to someone who cannot
 * distinguish the green from the red.
 */
function Banner({ tone, title, body }: { tone: 'error' | 'note'; title: string; body?: string }) {
  return (
    <View style={[s.banner, tone === 'error' ? s.bannerError : s.bannerNote]}>
      <Text style={[s.bannerTitle, tone === 'error' ? s.bannerTitleError : null]}>{title}</Text>
      {body ? <Text style={s.bannerBody}>{body}</Text> : null}
    </View>
  );
}

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
    <View style={[s.option, selected ? s.optionSelected : null]}>
      <View style={[s.radio, selected ? s.radioOn : null]}>
        {selected ? <View style={s.radioDot} /> : null}
      </View>
      <View style={s.optionText}>
        <Text style={[s.optionLabel, selected ? s.optionLabelSelected : null]}>{label}</Text>
        <Text style={s.optionDescription}>{description}</Text>
      </View>
    </View>
  );
}

/** A chip row — the duration and repeat choices, which are short enough to sit
 * side by side rather than take a full row each. */
function Chips({ options, selected }: { options: string[]; selected: string }) {
  return (
    <View style={s.chipRow}>
      {options.map((o) => (
        <View key={o} style={[s.choiceChip, o === selected ? s.choiceChipOn : null]}>
          <Text style={[s.choiceChipText, o === selected ? s.choiceChipTextOn : null]}>{o}</Text>
        </View>
      ))}
    </View>
  );
}

function SummaryRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[s.summaryRow, last ? s.summaryRowLast : null]}>
      <Text style={s.summaryLabel}>{label}</Text>
      <Text style={s.summaryValue}>{value}</Text>
    </View>
  );
}

/**
 * THE ONE FILLABLE INSTRUMENT IN THIS BATCH. `pct` is a confirmed ratio the
 * server returned, never an estimate and never a forecast. `dim` draws the
 * same confirmed fill with the confidence taken out of it, for the state where
 * the number is the last one confirmed rather than the current one.
 */
function Fill({ pct, dim }: { pct: number; dim?: boolean }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <View style={s.fillTrack}>
      <View style={[s.fillBar, { width: `${clamped}%` }, dim ? s.fillBarDim : null]} />
    </View>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   B1 · /join/[joinCode] — THE INVITATION
   ════════════════════════════════════════════════════════════════════════ */

/**
 * The invitation itself, shared by both sides of sign-in exactly as the route
 * shares it. Only the actions under it differ, and that is the whole design:
 * the same welcome, two different next steps.
 *
 * The meta line is built from the two things the preview actually returns —
 * the type as a card fact and the joining condition for the stored policy. It
 * is the shipped wording, not a paraphrase.
 */
function Invitation({
  compact,
  frameHeight,
}: {
  compact: boolean;
  frameHeight: number;
}) {
  return (
    <Field compact={compact} grow={0.44} frameHeight={frameHeight} chip="Invitation">
      <Text style={s.fieldEyebrow}>You have been invited to</Text>
      <Text style={[compact ? display.md : display.lg, s.fieldTitle]}>The Henderson Family</Text>
      <Text style={s.fieldMeta}>Family &amp; friends</Text>
      <Text style={s.fieldIntro}>
        Anyone with the invite link can join. The community is not listed or searchable anywhere,
        so people need the link.
      </Text>
    </Field>
  );
}

/** What joining means — three facts, each one true of the product today. */
function JoiningMeans() {
  return (
    <Card title="What joining means">
      <Fact>See the community’s goals and its shared progress.</Fact>
      <Fact>Add your own contributions to the shared total.</Fact>
      <Fact>Leave whenever you like.</Fact>
    </Card>
  );
}

export function JoinSignedOutTarget() {
  return (
    <Frame id="join-invite-out">
      {({ compact, frameHeight }) => (
        <>
          <Invitation compact={compact} frameHeight={frameHeight} />
          <Sheet compact={compact}>
            <JoiningMeans />
            {/* No account surprise after the tap: say it before the button. */}
            <Text style={s.preface}>You’ll need a free account first.</Text>
            <Primary label="Sign up to join" />
            <Secondary label="Already have an account? Sign in" />
            <Foot>
              <Secondary label="Not now — back to home" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function JoinSignedInTarget() {
  return (
    <Frame id="join-invite-in">
      {({ compact, frameHeight }) => (
        <>
          <Invitation compact={compact} frameHeight={frameHeight} />
          <Sheet compact={compact}>
            <JoiningMeans />
            {/*
              The button carries the community's name, as the route does. It is
              the one place in the batch where a name is printed, and it is the
              name the visitor was already shown by the preview.
            */}
            <Primary label="Join The Henderson Family" />
            <Foot>
              <Secondary label="Not now — back to home" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function JoinWorkingTarget() {
  return (
    <Frame id="join-working">
      {({ compact, frameHeight }) => (
        <>
          <Invitation compact={compact} frameHeight={frameHeight} />
          <Sheet compact={compact}>
            <JoiningMeans />
            {/*
              THE SCREEN DOES NOT MOVE WHILE IT WAITS. The button is the only
              thing that changes; nothing is hidden, nothing reflows, and the
              community is still on screen. A join takes one round trip, and a
              full-screen spinner for one round trip loses the place.
            */}
            <Primary label="Joining…" working />
            <Foot>
              <Secondary label="Not now — back to home" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function JoinFailedTarget() {
  return (
    <Frame id="join-failed">
      {({ compact, frameHeight }) => (
        <>
          <Invitation compact={compact} frameHeight={frameHeight} />
          <Sheet compact={compact}>
            {/*
              The failure sits ABOVE the control that failed, so the retry is
              read after the reason rather than before it. The invitation is
              untouched: a failed round trip does not invalidate the link, and
              re-rendering the hero as an error state would say it did.
            */}
            <Banner
              tone="error"
              title="We couldn’t join this community."
              body="Nothing was changed. Check your connection and try again."
            />
            <Primary label="Join The Henderson Family" />
            <Foot>
              <Secondary label="Not now — back to home" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

/**
 * The three states where there is nothing to invite anyone to. They share one
 * shape on purpose: a quiet field, a single card, one way out. The field drops
 * its texture and its chip — there is no invitation to dress.
 */
function Dead({
  id,
  compact,
  frameHeight,
  title,
  body,
  action,
}: {
  id: string;
  compact: boolean;
  frameHeight: number;
  title: string;
  body: string;
  action?: string;
}) {
  return (
    <>
      <View style={[s.fieldQuiet, compact ? s.fieldQuietCompact : null]}>
        <WsfWordmark variant="navy" height={compact ? 18 : 20} />
      </View>
      <Sheet compact={compact}>
        <View style={s.deadCard} testID={`wsf-target-b-${id}-card`}>
          <Text style={[compact ? display.md : display.lg, s.deadTitle]}>{title}</Text>
          <Text style={s.deadBody}>{body}</Text>
        </View>
        {action ? <Primary label={action} /> : null}
        <Foot>
          <Secondary label="Back to home" quiet />
        </Foot>
      </Sheet>
    </>
  );
}

export function JoinNotValidTarget() {
  return (
    <Frame id="join-not-valid">
      {({ compact, frameHeight }) => (
        <Dead
          id="join-not-valid"
          compact={compact}
          frameHeight={frameHeight}
          title="This link is not valid."
          /*
            ONE STATE FOR TWO CAUSES, AND THE WORDING IS WHY. An unknown code
            and a community that is not link-joinable come back from the server
            identically, so this screen may not hint which it was. "…or is no
            longer active" covers both without choosing.
          */
          body="The link you followed is not valid or is no longer active. Ask the person who shared it to send you a new one."
        />
      )}
    </Frame>
  );
}

export function JoinTooManyTarget() {
  return (
    <Frame id="join-too-many">
      {({ compact, frameHeight }) => (
        <Dead
          id="join-too-many"
          compact={compact}
          frameHeight={frameHeight}
          title="Too many requests."
          /*
            NOT THE VISITOR'S FAULT, AND THE WORDS SAY SO. The limit is on the
            link, not on them; "you have tried too many times" would be both
            wrong and accusing.
          */
          body="This link is being opened a lot right now. Wait a moment and try again."
          action="Try again"
        />
      )}
    </Frame>
  );
}

export function JoinLoadFailedTarget() {
  return (
    <Frame id="join-load-failed">
      {({ compact, frameHeight }) => (
        <Dead
          id="join-load-failed"
          compact={compact}
          frameHeight={frameHeight}
          title="Something went wrong."
          body="We couldn’t load this community. The link may still be good — try again."
          action="Try again"
        />
      )}
    </Frame>
  );
}

export function JoinLoadingTarget() {
  return (
    <Frame id="join-loading">
      {({ compact }) => (
        <>
          <View style={[s.fieldQuiet, compact ? s.fieldQuietCompact : null]}>
            <WsfWordmark variant="navy" height={compact ? 18 : 20} />
          </View>
          <Sheet compact={compact}>
            {/*
              THE SHAPE OF WHAT IS COMING, NOT A SPINNER IN THE MIDDLE OF
              NOTHING. The blocks are where the community's name and the
              joining condition will be, so the page does not jump when they
              arrive.
            */}
            <View style={s.skelHero}>
              <View style={[s.skel, { width: '38%', height: 11 }]} />
              <View style={[s.skel, { width: '76%', height: 28 }]} />
              <View style={[s.skel, { width: '54%', height: 13 }]} />
            </View>
            <View style={s.skelCard}>
              <View style={[s.skel, { width: '46%', height: 14 }]} />
              <View style={[s.skel, { width: '92%', height: 11 }]} />
              <View style={[s.skel, { width: '84%', height: 11 }]} />
            </View>
            <Text style={s.loadingNote}>Loading…</Text>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

/**
 * The event path. These two belong to the join route and are drawn here so
 * Batch D does not draw them a second time — they are listed in this batch's
 * coverage and excluded from Batch D's.
 *
 * The question is asked BEFORE an account is created, which is the only reason
 * it is worth a screen: the next tap on the personal branch makes an account,
 * and on a screen handed round a hall that is the wrong outcome.
 */
export function JoinDeviceChoiceTarget() {
  return (
    <Frame id="join-device-choice">
      {({ compact, frameHeight }) => (
        <>
          <Field compact={compact} grow={0.3} frameHeight={frameHeight} chip="Before you sign up" chipTone="action">
            <Text style={s.fieldEyebrow}>One question first</Text>
            <Text style={[compact ? display.md : display.lg, s.fieldTitle]}>Whose screen is this?</Text>
            <Text style={s.fieldIntro}>
              It changes what happens next, so we ask before an account is made.
            </Text>
          </Field>
          <Sheet compact={compact}>
            <View style={s.deviceCard}>
              <Text style={s.deviceLabel}>My own phone</Text>
              <Text style={s.deviceBody}>
                You’ll make an account, join the community, and your part is counted to you.
              </Text>
              <Primary label="This is my phone" />
            </View>
            <View style={s.deviceCardQuiet}>
              <Text style={s.deviceLabel}>A screen we’re sharing</Text>
              <Text style={s.deviceBody}>
                No account is made. The screen goes to the event page, where anyone can add their
                part and nothing is kept about who they are.
              </Text>
              <Secondary label="We’re sharing this screen" />
            </View>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function JoinDeviceSharedTarget() {
  return (
    <Frame id="join-device-shared">
      {({ compact, frameHeight }) => (
        <>
          <Field compact={compact} grow={0.3} frameHeight={frameHeight} chip="Shared screen" chipTone="action">
            <Text style={s.fieldEyebrow}>Remembered on this screen</Text>
            <Text style={[compact ? display.md : display.lg, s.fieldTitle]}>This is a shared screen.</Text>
            <Text style={s.fieldIntro}>No account is made here and nothing is kept about who uses it.</Text>
          </Field>
          <Sheet compact={compact}>
            <Card title="What that means">
              <Fact>Anyone can add their part without signing in.</Fact>
              <Fact>Nothing identifies the last person who used it.</Fact>
              <Fact>You can undo this choice on this screen at any time.</Fact>
            </Card>
            <Primary label="Continue to the event" />
            <Foot>
              <Secondary label="Use my own phone instead" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   B2 · /start-community — STARTING A COMMUNITY
   ════════════════════════════════════════════════════════════════════════ */

/**
 * One page, not a wizard, because the route is one page. Three decisions and a
 * name, with the consequence of each choice written under it in the words the
 * callable and the rules actually enforce.
 *
 * THE SUMMARY LINE IS THE REVIEW STEP. It restates the three choices as one
 * sentence directly above the button, which is the only review a three-field
 * form earns. A separate review screen would be a step invented to look
 * thorough.
 */
function StartField({
  compact,
  frameHeight,
  name,
}: {
  compact: boolean;
  frameHeight: number;
  name?: string;
}) {
  return (
    <Field compact={compact} grow={0.26} frameHeight={frameHeight} chip="New community" chipTone="action">
      <Text style={s.fieldEyebrow}>Starting something</Text>
      <Text style={[compact ? display.md : display.lg, s.fieldTitle]}>
        {name ?? 'Start your community.'}
      </Text>
      <Text style={s.fieldIntro}>Give it a name, choose who it is for and who can join.</Text>
    </Field>
  );
}

function StartForm({
  variant,
  nameValue,
  nameError,
  working,
  error,
}: {
  variant: 'familyFriends' | 'custom';
  nameValue?: string;
  nameError?: string;
  working?: boolean;
  error?: string;
}) {
  const family = variant === 'familyFriends';
  return (
    <>
      {error ? <Banner tone="error" title="We couldn’t create your community." body={error} /> : null}
      <FormField
        label="Community name"
        value={nameValue}
        placeholder="The Henderson Family"
        invalid={Boolean(nameError)}
        error={nameError}
      />
      <Text style={s.groupLabel}>Community type</Text>
      <Option
        label="Family &amp; friends"
        description="For people you already know."
        selected={family}
      />
      <Option
        label="Other community"
        description="For a church, workplace, neighborhood, group, or another existing community."
        selected={!family}
      />
      <Text style={s.groupLabel}>Who can join?</Text>
      {/*
        THE DEFAULT MOVES WITH THE TYPE, AND THE TARGET DRAWS BOTH DEFAULTS.
        Family & friends starts Private; Other community starts Anyone-with-
        the-link. Public is opt-in either way. Two frames rather than one,
        because the pairing is the decision this screen is really making.
      */}
      <Option
        label="Public"
        description="Anyone with the invite link can join. The community is not listed or searchable anywhere, so people need the link."
      />
      <Option
        label="Anyone with the link"
        description="Anyone with the invite link can join, including anyone it is forwarded to, until you create a new link."
        selected={!family}
      />
      <Option
        label="Private"
        description="No one can join by link and there is no way to add members, so the community is just you."
        selected={family}
      />
      <View style={s.summary}>
        <Text style={s.summaryEyebrow}>You are creating</Text>
        <Text style={s.summaryLine}>
          {(nameValue || 'Your community') +
            ' · ' +
            (family ? 'Family & friends' : 'Other community') +
            ' · ' +
            (family ? 'Private' : 'Anyone with the link')}
        </Text>
      </View>
      <Primary label={working ? 'Creating…' : 'Create community'} working={working} />
    </>
  );
}

export function StartFamilyTarget() {
  return (
    <Frame id="start-form">
      {({ compact, frameHeight }) => (
        <>
          <StartField compact={compact} frameHeight={frameHeight} />
          <Sheet compact={compact}>
            <StartForm variant="familyFriends" nameValue="The Henderson Family" />
            <Foot>
              <Secondary label="Back to home" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function StartOtherTarget() {
  return (
    <Frame id="start-form-other">
      {({ compact, frameHeight }) => (
        <>
          <StartField compact={compact} frameHeight={frameHeight} />
          <Sheet compact={compact}>
            <StartForm variant="custom" nameValue="Riverside Church" />
            <Foot>
              <Secondary label="Back to home" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function StartNameMissingTarget() {
  return (
    <Frame id="start-name-missing">
      {({ compact, frameHeight }) => (
        <>
          <StartField compact={compact} frameHeight={frameHeight} />
          <Sheet compact={compact}>
            {/*
              NO RED BEFORE THEY HAVE TRIED. The message appears after a submit
              attempt or after leaving the field short — never while someone is
              typing their first character. The button stays tappable and sends
              them back to the field; nothing goes to the server.
            */}
            <StartForm variant="familyFriends" nameError="Give your community a name." />
            <Foot>
              <Secondary label="Back to home" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function StartWorkingTarget() {
  return (
    <Frame id="start-working">
      {({ compact, frameHeight }) => (
        <>
          <StartField compact={compact} frameHeight={frameHeight} />
          <Sheet compact={compact}>
            <StartForm variant="familyFriends" nameValue="The Henderson Family" working />
            <Foot>
              <Secondary label="Back to home" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function StartFailedTarget() {
  return (
    <Frame id="start-failed">
      {({ compact, frameHeight }) => (
        <>
          <StartField compact={compact} frameHeight={frameHeight} />
          <Sheet compact={compact}>
            <StartForm
              variant="familyFriends"
              nameValue="The Henderson Family"
              error="Nothing was created. Check your connection and try again."
            />
            <Foot>
              <Secondary label="Back to home" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

/**
 * The two gates. They are deliberately the plainest screens in the batch: one
 * sentence, one control, nothing else. A gate that decorates itself reads as
 * an obstacle; a gate that states the one missing thing reads as a step.
 */
function Gate({
  compact,
  frameHeight,
  chip,
  title,
  intro,
  action,
}: {
  compact: boolean;
  frameHeight: number;
  chip: string;
  title: string;
  intro: string;
  action: string;
}) {
  return (
    <>
      <Field compact={compact} grow={0.3} frameHeight={frameHeight} chip={chip} chipTone="action">
        <Text style={[compact ? display.md : display.lg, s.fieldTitle]}>{title}</Text>
        <Text style={s.fieldIntro}>{intro}</Text>
      </Field>
      <Sheet compact={compact}>
        <Primary label={action} />
        <Foot>
          <Secondary label="Back to home" quiet />
        </Foot>
      </Sheet>
    </>
  );
}

export function StartSignInTarget() {
  return (
    <Frame id="start-signin">
      {({ compact, frameHeight }) => (
        <Gate
          compact={compact}
          frameHeight={frameHeight}
          chip="One step"
          title="Start your community."
          intro="Sign in to start a community."
          action="Sign in"
        />
      )}
    </Frame>
  );
}

export function StartVerifyTarget() {
  return (
    <Frame id="start-verify">
      {({ compact, frameHeight }) => (
        <Gate
          compact={compact}
          frameHeight={frameHeight}
          chip="One step"
          title="Start your community."
          intro="Verify your email before starting a community."
          action="Verify email"
        />
      )}
    </Frame>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   B3 · /goals/new — OPENING A GOAL
   ════════════════════════════════════════════════════════════════════════ */

/**
 * The longest form in the product, and the one place a Champion decides what
 * everyone else will be adding to. It is one page in the route and stays one
 * page here; what the target adds is a spine, so a long form reads as four
 * short decisions rather than one wall.
 *
 * THE DEFINITION LINE IS THE POINT OF THE TOP SECTION. "1,000 push-ups" is
 * assembled from the number and the unit as they are typed, so the Champion
 * reads the thing they are making rather than checking two fields against
 * each other.
 */
function GoalField({
  compact,
  frameHeight,
  chip,
  chipTone,
  eyebrow,
  title,
  intro,
}: {
  compact: boolean;
  frameHeight: number;
  chip?: string;
  chipTone?: 'quiet' | 'action' | 'live';
  eyebrow: string;
  title: string;
  intro: string;
}) {
  return (
    <Field compact={compact} grow={0.26} frameHeight={frameHeight} chip={chip} chipTone={chipTone}>
      <Text style={s.fieldEyebrow}>{eyebrow}</Text>
      <Text style={[compact ? display.md : display.lg, s.fieldTitle]}>{title}</Text>
      <Text style={s.fieldIntro}>{intro}</Text>
    </Field>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <View style={s.step}>
      <View style={s.stepHead}>
        <View style={s.stepNum}>
          <Text style={s.stepNumText}>{n}</Text>
        </View>
        <Text style={s.stepTitle}>{title}</Text>
      </View>
      <View style={s.stepBody}>{children}</View>
    </View>
  );
}

function GoalForm({
  custom,
  errors,
  working,
  error,
}: {
  custom?: boolean;
  errors?: boolean;
  working?: boolean;
  error?: string;
}) {
  return (
    <>
      {error ? <Banner tone="error" title="We couldn’t open this goal." body={error} /> : null}
      <Step n="1" title="What are you counting?">
        <FormField
          label="Goal title"
          value={errors ? undefined : 'October Push-Up Challenge'}
          placeholder="October Push-Up Challenge"
          invalid={errors}
          error={errors ? 'Give the goal a title.' : undefined}
        />
        <View style={s.pair}>
          <View style={s.pairItem}>
            <FormField
              label="Target"
              value={errors ? '0' : '1,000'}
              invalid={errors}
              error={errors ? 'Use a whole number above zero.' : undefined}
            />
          </View>
          <View style={s.pairItem}>
            <FormField label="Unit" value="push-ups" />
          </View>
        </View>
        {/*
          The sentence the two fields make. It is the goal in the words members
          will read, assembled as it is typed.
        */}
        <View style={s.definition}>
          <Text style={s.definitionText}>{errors ? '— push-ups' : '1,000 push-ups'}</Text>
        </View>
      </Step>

      <Step n="2" title="How long is it open?">
        <Chips options={['1 week', '2 weeks', '1 month', 'Custom']} selected={custom ? 'Custom' : '1 month'} />
        {custom ? (
          <>
            <FormField label="Starts" value="2026-10-01 06:00" />
            <FormField label="Ends" value="2026-10-31 23:45" />
          </>
        ) : (
          <View style={s.windowLines}>
            <Text style={s.windowLine}>Starts today at 6:00 AM</Text>
            <Text style={s.windowLine}>Ends Sat, Oct 31 at 11:45 PM</Text>
          </View>
        )}
        {/*
          THE ZONE IS STATED, NOT ASSUMED. A goal that closes at midnight
          closes at midnight SOMEWHERE, and the Champion setting it is the one
          person who has to know which.
        */}
        <Text style={s.zoneLine}>Times are in Eastern Time, from this device.</Text>
      </Step>

      <Step n="3" title="How often can one member add?">
        <Chips options={['Once', 'Once a day', 'No limit']} selected="No limit" />
      </Step>

      <Step n="4" title="Check it over">
        <View style={s.summaryCard}>
          <SummaryRow label="Goal" value={errors ? '—' : 'October Push-Up Challenge'} />
          <SummaryRow label="Counting to" value={errors ? '—' : '1,000 push-ups'} />
          <SummaryRow label="Open" value="Today — Sat, Oct 31" />
          <SummaryRow label="Zone" value="Eastern Time" />
          <SummaryRow label="Adding" value="No limit per member" last />
        </View>
      </Step>

      <Primary label={working ? 'Opening…' : 'Open this goal'} working={working} />
      <Text style={s.afterNote}>
        Members can add to it as soon as it opens. You can put it on a screen after.
      </Text>
    </>
  );
}

export function GoalFormTarget() {
  return (
    <Frame id="goal-form">
      {({ compact, frameHeight }) => (
        <>
          <GoalField
            compact={compact}
            frameHeight={frameHeight}
            chip="New goal"
            chipTone="action"
            eyebrow="The Henderson Family"
            title="Open a goal."
            intro="Everyone in the community adds to the same total."
          />
          <Sheet compact={compact}>
            <GoalForm />
            <Foot>
              <Secondary label="Back to community" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function GoalCustomWindowTarget() {
  return (
    <Frame id="goal-custom-window">
      {({ compact, frameHeight }) => (
        <>
          <GoalField
            compact={compact}
            frameHeight={frameHeight}
            chip="New goal"
            chipTone="action"
            eyebrow="The Henderson Family"
            title="Open a goal."
            intro="Everyone in the community adds to the same total."
          />
          <Sheet compact={compact}>
            <GoalForm custom />
            <Foot>
              <Secondary label="Back to community" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function GoalErrorsTarget() {
  return (
    <Frame id="goal-errors">
      {({ compact, frameHeight }) => (
        <>
          <GoalField
            compact={compact}
            frameHeight={frameHeight}
            chip="New goal"
            chipTone="action"
            eyebrow="The Henderson Family"
            title="Open a goal."
            intro="Everyone in the community adds to the same total."
          />
          <Sheet compact={compact}>
            {/*
              EVERY FIELD SAYS ITS OWN PROBLEM, IN ITS OWN PLACE. One summary
              banner at the top of a four-step form makes the Champion hunt;
              the message belongs under the field that has to change. The
              summary rows go to em dashes rather than showing a value the
              form does not have.
            */}
            <GoalForm errors />
            <Foot>
              <Secondary label="Back to community" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function GoalWorkingTarget() {
  return (
    <Frame id="goal-working">
      {({ compact, frameHeight }) => (
        <>
          <GoalField
            compact={compact}
            frameHeight={frameHeight}
            chip="New goal"
            chipTone="action"
            eyebrow="The Henderson Family"
            title="Open a goal."
            intro="Everyone in the community adds to the same total."
          />
          <Sheet compact={compact}>
            <GoalForm working />
            <Foot>
              <Secondary label="Back to community" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function GoalFailedTarget() {
  return (
    <Frame id="goal-failed">
      {({ compact, frameHeight }) => (
        <>
          <GoalField
            compact={compact}
            frameHeight={frameHeight}
            chip="New goal"
            chipTone="action"
            eyebrow="The Henderson Family"
            title="Open a goal."
            intro="Everyone in the community adds to the same total."
          />
          <Sheet compact={compact}>
            <GoalForm error="Nothing was opened. Check your connection and try again." />
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
 * The goal is live. This IS the success screen — the only one in the batch,
 * and it exists because the route renders it: the create does not navigate
 * away, it swaps the form for this.
 *
 * WHAT IT DOES NOT DO: it does not celebrate a number. Nothing has been
 * counted yet. What a Champion needs in this second is the two things that
 * turn an opened goal into a moving one — the page members add on, and the
 * screen it goes up on — so those are the whole sheet.
 */
export function GoalLiveTarget() {
  return (
    <Frame id="goal-live">
      {({ compact, frameHeight }) => (
        <>
          <Field compact={compact} grow={0.34} frameHeight={frameHeight} chip="Open now" chipTone="live">
            <Text style={s.fieldEyebrow}>The Henderson Family</Text>
            <Text style={[compact ? display.md : display.lg, s.fieldTitle]}>Your goal is live.</Text>
            <View style={s.liveCard}>
              <Text style={s.liveTitle}>October Push-Up Challenge</Text>
              <Text style={s.liveDefinition}>1,000 push-ups</Text>
              <Text style={s.liveMeta}>Starts today · Ends Sat, Oct 31</Text>
              <Text style={s.liveMeta}>Eastern Time · No limit per member</Text>
            </View>
          </Field>
          <Sheet compact={compact}>
            <Text style={s.preface}>Send it to your members and put it on a screen.</Text>
            <Primary label="Open the contribute page" />
            <Text style={s.afterNote}>
              Where members record what they did and watch the shared total grow.
            </Text>
            <Card title="Put it to work">
              <Secondary label="Show on a big screen" />
              <Text style={s.cardMeta}>
                A live view of the total for a TV or projector where everyone can see it.
              </Text>
            </Card>
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
 * The two states where a Champion cannot open a goal here. They are gates, not
 * errors, and the difference is that a gate says what WOULD work.
 */
export function GoalUnavailableTarget() {
  return (
    <Frame id="goal-unavailable">
      {({ compact, frameHeight }) => (
        <Dead
          id="goal-unavailable"
          compact={compact}
          frameHeight={frameHeight}
          title="Not available here yet."
          body="Goals can be started from your community once this is switched on for your build."
        />
      )}
    </Frame>
  );
}

export function GoalNoCommunityTarget() {
  return (
    <Frame id="goal-no-community">
      {({ compact, frameHeight }) => (
        <Dead
          id="goal-no-community"
          compact={compact}
          frameHeight={frameHeight}
          title="A goal needs a community."
          /*
            NOT "no community found". The Champion has not lost anything — they
            have not started one yet, and that is a different sentence with a
            different next step.
          */
          body="Start a community first, then open a goal for the people in it."
          action="Start a community"
        />
      )}
    </Frame>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   B4 · /combined/[setupId] — WATCHING A COMBINED GOAL
   ════════════════════════════════════════════════════════════════════════ */

/**
 * A read-only live view. There is no control on it a Champion can operate, and
 * the target adds none.
 *
 * THE HARD PART IS THE TWO NUMBERS PER ACTIVITY, AND THE TARGET DRAWS BOTH.
 * Each activity keeps its own total for its whole life; what it has counted
 * TOWARD this combined goal is only what was recorded since the combined goal
 * began. Where an activity was already under way those differ, and presenting
 * the larger one as the contribution would credit this goal with repetitions
 * nobody did here. So every activity row shows its own total AND its counted-
 * here figure, with the counted-here figure the emphasised one, because that
 * is the one the big number is the sum of.
 *
 * AND WHY THE COUNTED-HERE LINE CARRIES NO UNIT. Units are never summed
 * across goals in this product, and one look at the activities shows why the
 * rule matters here: push-ups and movements cannot be added together. A
 * combined goal is the one place the product does add across activities, and
 * it is allowed to because every activity enters it as `countsAs:
 * 'repetition'` — repetitions, not push-ups. So the combined total carries the
 * combined goal's own unit, each activity keeps its own on its own line, and
 * the line that bridges them names no unit at all. That is the shipped
 * behaviour, not a target invention: the route prints
 * `<n> counted toward <title>` with no unit in it.
 */
function CombinedActivityRow({
  title,
  own,
  counted,
  closed,
}: {
  title: string;
  own: string;
  counted: string;
  closed?: boolean;
}) {
  return (
    <View style={s.activity}>
      <Text style={s.activityTitle}>{title}</Text>
      <Text style={s.activityCounted}>{counted}</Text>
      <Text style={s.activityOwn}>{own}</Text>
      {closed ? <Text style={s.activityClosed}>Closed. What it counted still counts here.</Text> : null}
    </View>
  );
}

function CombinedBody({
  closed,
  stale,
}: {
  closed?: boolean;
  stale?: boolean;
}) {
  return (
    <>
      <Text style={s.groupLabel}>Activities</Text>
      <CombinedActivityRow
        title="October Push-Up Challenge"
        counted="3,120 counted toward Fall Together"
        own="8,940 of 10,000 push-ups"
      />
      <CombinedActivityRow
        title="Riverside Morning Walk"
        counted="2,480 counted toward Fall Together"
        own="2,480 of 5,000 movements"
      />
      <CombinedActivityRow
        title="Tuesday Night Circuit"
        counted="1,060 counted toward Fall Together"
        own="4,200 of 4,000 movements"
        closed={closed}
      />
      {stale ? (
        <>
          {/*
            THE LAST CONFIRMED NUMBER, SAID TO BE THAT. The screen keeps what
            it knows rather than blanking — a total that vanishes when a poll
            fails reads as a total that went away — and it says plainly that it
            may be behind, with the one control that can resolve it.
          */}
          <Banner
            tone="note"
            title="This is the last confirmed total."
            body="It may be out of date."
          />
          <Secondary label="Check again" />
        </>
      ) : null}
    </>
  );
}

export function CombinedLiveTarget() {
  return (
    <Frame id="combined-live">
      {({ compact, frameHeight }) => (
        <>
          <Field compact={compact} grow={0.42} frameHeight={frameHeight} chip="Live" chipTone="live">
            <Text style={s.fieldEyebrow}>The Henderson Family</Text>
            <Text style={[compact ? display.md : display.lg, s.fieldTitle]}>Fall Together</Text>
            <Text style={s.fieldMeta}>Oct 1 — Oct 31</Text>
            <Text style={s.bigTotal}>6,660 of 20,000 movements</Text>
            <Fill pct={33} />
            <Text style={s.fieldIntro}>33% complete · counting since Oct 1</Text>
          </Field>
          <Sheet compact={compact}>
            <CombinedBody />
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function CombinedClosedTarget() {
  return (
    <Frame id="combined-closed">
      {({ compact, frameHeight }) => (
        <>
          <Field compact={compact} grow={0.42} frameHeight={frameHeight} chip="Closed" chipTone="quiet">
            <Text style={s.fieldEyebrow}>The Henderson Family</Text>
            <Text style={[compact ? display.md : display.lg, s.fieldTitle]}>Fall Together</Text>
            <Text style={s.fieldMeta}>Oct 1 — Oct 31</Text>
            <Text style={s.bigTotal}>21,430 of 20,000 movements</Text>
            <Fill pct={100} />
            {/*
              REACHED IS SAID PLAINLY AND ONCE. No confetti, no exclamation
              mark, no second badge repeating what the number already shows.
              The closing line is the news.
            */}
            <Text style={s.fieldIntro}>Reached · this combined goal has closed.</Text>
          </Field>
          <Sheet compact={compact}>
            <CombinedBody closed />
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function CombinedStaleTarget() {
  return (
    <Frame id="combined-stale">
      {({ compact, frameHeight }) => (
        <>
          <Field compact={compact} grow={0.42} frameHeight={frameHeight} chip="Last confirmed" chipTone="quiet">
            <Text style={s.fieldEyebrow}>The Henderson Family</Text>
            <Text style={[compact ? display.md : display.lg, s.fieldTitle]}>Fall Together</Text>
            <Text style={s.fieldMeta}>Oct 1 — Oct 31</Text>
            <Text style={s.bigTotal}>6,660 of 20,000 movements</Text>
            <Fill pct={33} dim />
            <Text style={s.fieldIntro}>33% complete · counting since Oct 1</Text>
          </Field>
          <Sheet compact={compact}>
            <CombinedBody stale />
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function CombinedUnreachableTarget() {
  return (
    <Frame id="combined-unreachable">
      {({ compact, frameHeight }) => (
        <Dead
          id="combined-unreachable"
          compact={compact}
          frameHeight={frameHeight}
          title="Connection interrupted."
          /*
            NOTHING WAS EVER CONFIRMED HERE, so there is no number to keep and
            none is drawn. This is the one state that must not look like the
            stale one: a screen that has never loaded and a screen showing an
            old total are different situations for the person watching.
          */
          body="Nothing has been confirmed yet. Check again when you’re connected."
          action="Check again"
        />
      )}
    </Frame>
  );
}

export function CombinedNothingTarget() {
  return (
    <Frame id="combined-nothing">
      {({ compact, frameHeight }) => (
        <Dead
          id="combined-nothing"
          compact={compact}
          frameHeight={frameHeight}
          title="Nothing to show here."
          /*
            ONE STATE FOR THREE CAUSES. An unknown setup, one this viewer may
            not see, and one whose permission was revoked mid-watch are the
            same two sentences — the same two the kiosk and the public display
            use — so this page can never become an oracle for which setups
            exist. The wording is shared from src/kioskSession.ts rather than
            written again here.
          */
          body="This display isn’t currently available."
          action="Check again"
        />
      )}
    </Frame>
  );
}

/* ── styles ─────────────────────────────────────────────────────────────── */

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CREAM },
  body: { flexGrow: 1 },

  /* the navy field */
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
  /** A field with nothing to dress: no texture, no chip, cream not navy. */
  fieldQuiet: {
    paddingHorizontal: 20,
    paddingTop: 26,
    paddingBottom: 10,
  },
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
  fieldMeta: { color: ON_NAVY_MUTED, fontSize: 12.5, fontWeight: '700', letterSpacing: 0.2 },
  fieldIntro: { color: ON_NAVY_MUTED, fontSize: 13.5, lineHeight: 19 },

  /* the number a combined goal exists for */
  bigTotal: {
    color: CREAM,
    fontSize: 32,
    lineHeight: 37,
    fontWeight: '900',
    letterSpacing: -1,
    marginTop: 6,
    flexShrink: 1,
    minWidth: 0,
  },
  fillTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(247,245,240,0.16)',
    overflow: 'hidden',
    marginTop: 2,
  },
  fillBar: { height: 10, borderRadius: 999, backgroundColor: ACTION_GREEN },
  fillBarDim: { backgroundColor: 'rgba(145,203,125,0.45)' },

  /* the cream sheet */
  sheet: { flex: 1, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 24, gap: 12 },
  sheetCompact: { paddingTop: 13, gap: 9 },
  spacer: { flex: 1, minHeight: 10 },
  foot: { gap: 2, borderTopWidth: 1, borderTopColor: HAIRLINE, paddingTop: 8 },

  preface: { color: INK_QUIET, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  afterNote: { color: INK_QUIET, fontSize: 12, lineHeight: 17, textAlign: 'center' },
  loadingNote: { color: INK_QUIET, fontSize: 13, textAlign: 'center', marginTop: 4 },
  groupLabel: {
    color: INK_QUIET,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginTop: 4,
  },

  /* form parts */
  formField: { gap: 5 },
  formLabel: {
    color: INK_QUIET,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  input: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: SURFACE,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: HAIRLINE,
    paddingHorizontal: 14,
    minHeight: 50,
  },
  inputInvalid: { borderColor: ERROR_RED },
  inputValue: { color: NAVY, fontSize: 16, fontWeight: '600' },
  inputPlaceholder: { color: INK_QUIET, fontSize: 16 },
  inputSuffix: { color: INK_QUIET, fontSize: 13, fontWeight: '700' },
  inputHint: { color: ACTION_GREEN_DEEP, fontSize: 13, fontWeight: '800' },
  fieldError: { color: ERROR_RED, fontSize: 12.5, lineHeight: 17, fontWeight: '700' },
  pair: { flexDirection: 'row', gap: 10 },
  pairItem: { flex: 1, minWidth: 0 },

  primary: {
    flexDirection: 'row',
    gap: 9,
    backgroundColor: ACTION_GREEN,
    borderRadius: 16,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    ...elevation.action,
  },
  primaryOff: { backgroundColor: '#CDE8D5', shadowOpacity: 0 },
  primaryText: { color: ON_ACTION, fontSize: 17, fontWeight: '900' },
  primaryTextOff: { color: '#6B8A76' },
  /** Drawn, not animated: a target is a still frame. */
  spinner: {
    width: 15,
    height: 15,
    borderRadius: 8,
    borderWidth: 2.5,
    borderColor: '#6B8A76',
    borderTopColor: 'transparent',
  },
  secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: NAVY, fontSize: 15, fontWeight: '800' },
  secondaryQuiet: { minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  secondaryQuietText: { color: INK_QUIET, fontSize: 13.5, fontWeight: '700' },

  /* cards */
  card: {
    backgroundColor: SURFACE,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 15,
    gap: 7,
    ...elevation.card,
  },
  cardTint: { backgroundColor: '#F1F6F2' },
  cardTitle: { color: NAVY, fontSize: 15, fontWeight: '900' },
  cardMeta: { color: INK_QUIET, fontSize: 12.5, lineHeight: 17 },
  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  factDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: ACTION_GREEN,
    marginTop: 6,
  },
  factText: { color: NAVY, fontSize: 13.5, lineHeight: 19, flexShrink: 1, minWidth: 0 },

  /* banded messages */
  banner: { borderRadius: 14, borderLeftWidth: 4, paddingHorizontal: 13, paddingVertical: 11, gap: 3 },
  bannerError: { backgroundColor: '#FBEFEF', borderLeftColor: ERROR_RED },
  bannerNote: { backgroundColor: '#EEF2F6', borderLeftColor: INK_QUIET },
  bannerTitle: { color: NAVY, fontSize: 14, lineHeight: 19, fontWeight: '900' },
  bannerTitleError: { color: ERROR_RED },
  bannerBody: { color: INK_QUIET, fontSize: 12.5, lineHeight: 17 },

  /* choices */
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
    backgroundColor: SURFACE,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: HAIRLINE,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  optionSelected: { borderColor: ACTION_GREEN_DEEP, backgroundColor: '#F1F9F3' },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#B9C4CF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  radioOn: { borderColor: ACTION_GREEN_DEEP },
  radioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: ACTION_GREEN_DEEP },
  optionText: { flexShrink: 1, minWidth: 0, gap: 2 },
  optionLabel: { color: NAVY, fontSize: 14.5, fontWeight: '800' },
  optionLabelSelected: { color: ACTION_GREEN_DEEP },
  optionDescription: { color: INK_QUIET, fontSize: 12, lineHeight: 16.5 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choiceChip: {
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: HAIRLINE,
    backgroundColor: SURFACE,
    paddingHorizontal: 14,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceChipOn: { borderColor: ACTION_GREEN_DEEP, backgroundColor: '#F1F9F3' },
  choiceChipText: { color: INK_QUIET, fontSize: 13, fontWeight: '800' },
  choiceChipTextOn: { color: ACTION_GREEN_DEEP },

  /* the review line on /start-community */
  summary: {
    backgroundColor: '#EEF2F6',
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 11,
    gap: 3,
  },
  summaryEyebrow: {
    color: INK_QUIET,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  summaryLine: { color: NAVY, fontSize: 14.5, lineHeight: 20, fontWeight: '800' },

  /* the four steps on /goals/new */
  step: { gap: 9 },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: { color: CREAM, fontSize: 11.5, fontWeight: '900' },
  stepTitle: { color: NAVY, fontSize: 15.5, fontWeight: '900', flexShrink: 1, minWidth: 0 },
  /** The spine: the rule under the number, so four decisions read as a column. */
  stepBody: {
    gap: 9,
    marginLeft: 10,
    paddingLeft: 21,
    borderLeftWidth: 1.5,
    borderLeftColor: HAIRLINE,
  },
  definition: {
    backgroundColor: '#F1F9F3',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  definitionText: { color: ACTION_GREEN_DEEP, fontSize: 17, fontWeight: '900' },
  windowLines: { gap: 2 },
  windowLine: { color: NAVY, fontSize: 13.5, lineHeight: 19, fontWeight: '600' },
  zoneLine: { color: INK_QUIET, fontSize: 12, lineHeight: 17 },
  summaryCard: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  summaryRowLast: { borderBottomWidth: 0 },
  summaryLabel: { color: INK_QUIET, fontSize: 12.5, fontWeight: '700' },
  summaryValue: {
    color: NAVY,
    fontSize: 13.5,
    fontWeight: '800',
    textAlign: 'right',
    flexShrink: 1,
    minWidth: 0,
  },

  /* the live goal card, inside the field */
  liveCard: {
    marginTop: 10,
    backgroundColor: 'rgba(0,0,0,0.24)',
    borderRadius: 16,
    borderLeftWidth: 4,
    borderLeftColor: ACTION_GREEN,
    paddingHorizontal: 13,
    paddingVertical: 12,
    gap: 3,
  },
  liveTitle: { color: ON_NAVY, fontSize: 17, lineHeight: 22, fontWeight: '900' },
  liveDefinition: { color: PROGRESS_GREEN, fontSize: 14, fontWeight: '800' },
  liveMeta: { color: ON_NAVY_MUTED, fontSize: 11.5, lineHeight: 16 },

  /* the device question */
  deviceCard: {
    backgroundColor: SURFACE,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: ACTION_GREEN_DEEP,
    padding: 15,
    gap: 7,
    ...elevation.card,
  },
  deviceCardQuiet: {
    backgroundColor: SURFACE,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 15,
    gap: 7,
  },
  deviceLabel: { color: NAVY, fontSize: 16, fontWeight: '900' },
  deviceBody: { color: INK_QUIET, fontSize: 13, lineHeight: 18.5 },

  /* the states with nothing behind them */
  deadCard: {
    backgroundColor: SURFACE,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 18,
    gap: 8,
    ...elevation.card,
  },
  deadTitle: { color: NAVY },
  deadBody: { color: INK_QUIET, fontSize: 13.5, lineHeight: 19.5 },

  /* the shape of what is coming */
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

  /* combined activities */
  activity: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 3,
    ...elevation.card,
  },
  activityTitle: { color: NAVY, fontSize: 14.5, fontWeight: '900' },
  /** The emphasised figure: the one the big number is the sum of. */
  activityCounted: { color: ACTION_GREEN_DEEP, fontSize: 13.5, fontWeight: '800' },
  activityOwn: { color: INK_QUIET, fontSize: 12.5, lineHeight: 17 },
  activityClosed: { color: INK_QUIET, fontSize: 12, lineHeight: 17, fontStyle: 'italic' },
});
