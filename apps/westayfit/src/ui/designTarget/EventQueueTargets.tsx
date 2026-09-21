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
 * ATLAS BATCH D — THE EVENT AND THE LINE, ON SOMEBODY'S OWN PHONE.
 * TARGETS, NOT IMPLEMENTED PAGES.
 *
 *   D1  /event/[goalId]   standing in the room, deciding      11 states
 *   D2  /queue/[goalId]   waiting, being called, finishing    12 states
 *
 * THESE ARE PHONE SCREENS AT AN EVENT, which is a different design problem
 * from the rest of the product and the reason they are their own batch. The
 * person holding this phone is standing up, half listening to someone at the
 * front, in a room with other people, and will look at the screen for two
 * seconds at a time. So:
 *
 *   · The one fact that matters is the biggest thing on the screen, every
 *     time, and it CHANGES as the turn does — the place in line, then the
 *     name being called, then the seconds left, then the number recorded.
 *   · Nothing reflows underneath a thumb. A screen that rearranges while
 *     somebody is walking towards a station loses them.
 *   · Every state says what is true of THEM, not what the system is doing.
 *     "3rd in line" is a fact about them; "polling" is not.
 *
 * ── THE PRIVACY DESIGN IS THE PRODUCT HERE, AND IT IS DRAWN ───────────────
 *
 * A queue puts a person's name on a screen in a room full of strangers. Every
 * refusal below is in the route already; the target's job is to make them
 * legible rather than quietly correct.
 *
 * THE NAME IS CHOSEN BY THE PERSON IT IS ABOUT, BEFORE ANYTHING IS SENT.
 *   The name panel is not a formality on the way to a queue — it is the
 *   feature's one real decision. The shipped copy says where it goes ("the
 *   screen in the room, where everybody can read it"), what to pick ("whatever
 *   you are happy for strangers to see"), and what becomes of it ("kept with
 *   your place in the line and nowhere else… it goes when your place does").
 *   Initials are one tap and not buried.
 *
 * OPENING A CONTROL IS NOT JOINING A LINE.
 *   "Opening either one puts nobody in a line. You are in the line only once
 *   you confirm the name the screen will call." Both ways on are drawn as
 *   openers, and the only control that writes is inside the name panel.
 *
 * A SCAN DECIDES NOTHING.
 *   An activity arriving from a QR is offered as an option like any other,
 *   with the shipped sentence saying so. The target does not pre-select it.
 *
 * NO JOIN CODE ON THE NOT-MEMBER SCREEN, and no control that asks for one.
 *   Who may be admitted is the community's decision, made on a Champion's own
 *   surfaces. Standing next to a screen is not an admission. The route says
 *   what to do and stops, and so does this.
 *
 * THE RECEIPT IS THEIR OWN PART, SAID TO BE THEIRS.
 *   "Your own part, counted once." The shared total is NOT restated on the
 *   queue screens, where it would be read as the same figure.
 *
 * ── DEVICE QUESTION: DRAWN TWICE ON PURPOSE ───────────────────────────────
 *
 * Batch B drew the JOIN route's device pair, which carries `signupAhead` and
 * therefore says an account is about to be made. This batch draws the EVENT
 * route's pair, which does not: the person here may already be signed in, and
 * the question is only about the device. Same component, different promise,
 * so both are shown rather than one standing in for the other.
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
  urgent,
  children,
}: {
  compact: boolean;
  grow?: number;
  frameHeight: number;
  chip?: string;
  chipTone?: 'quiet' | 'action' | 'live';
  /** The one state under a clock. The field carries a green edge rather than
   * turning red: this is a good thing happening, quickly. */
  urgent?: boolean;
  children: React.ReactNode;
}) {
  const minHeight =
    !grow || compact || frameHeight === 0 ? undefined : Math.round(frameHeight * grow);
  return (
    <View
      style={[
        s.field,
        compact ? s.fieldCompact : null,
        urgent ? s.fieldUrgent : null,
        minHeight ? { minHeight } : null,
      ]}
    >
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
    <View style={s.screen} onLayout={onLayout} testID={`wsf-target-d-${id}`}>
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
  working,
  disabled,
}: {
  label: string;
  working?: boolean;
  disabled?: boolean;
}) {
  return (
    <View style={[s.primary, working || disabled ? s.primaryOff : null]}>
      {working ? <View style={s.spinner} /> : null}
      <Text style={[s.primaryText, working || disabled ? s.primaryTextOff : null]}>{label}</Text>
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

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <View style={s.card}>
      {title ? <Text style={s.cardTitle}>{title}</Text> : null}
      {children}
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

function Banner({ tone, title, body }: { tone: 'error' | 'note'; title: string; body?: string }) {
  return (
    <View style={[s.banner, tone === 'error' ? s.bannerError : s.bannerNote]}>
      <Text style={[s.bannerTitle, tone === 'error' ? s.bannerTitleError : null]}>{title}</Text>
      {body ? <Text style={s.bannerBody}>{body}</Text> : null}
    </View>
  );
}

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
  back?: string;
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
        {back ? (
          <Foot>
            <Secondary label={back} quiet />
          </Foot>
        ) : null}
      </Sheet>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   D1 · /event/[goalId] — STANDING IN THE ROOM
   ════════════════════════════════════════════════════════════════════════ */

function EventHero({
  compact,
  frameHeight,
  community,
  title,
}: {
  compact: boolean;
  frameHeight: number;
  community: string;
  title: string;
}) {
  return (
    <Field compact={compact} grow={0.3} frameHeight={frameHeight} chip="At the event" chipTone="live">
      <Text style={s.fieldEyebrow}>{community}</Text>
      <Text style={[compact ? display.md : display.lg, s.fieldTitle]}>{title}</Text>
      <Text style={s.fieldIntro}>
        Two things, in order: what you’re here to do, then where you’ll do it. Whatever you add,
        you count yourself — nothing is counted for you.
      </Text>
    </Field>
  );
}

/** Decision one. Always on the page, always above the ways on. */
function ActivityCard({ chosen }: { chosen?: 'scanned' | 'other' }) {
  return (
    <Card title="What are you here to do?">
      <Text style={s.cardBody}>
        Pick the activity. Choosing it records nothing and puts nobody in a line.
      </Text>
      {/*
        THE SCANNED ACTIVITY IS AN OPTION, NOT A DECISION ALREADY MADE. It is
        never pre-selected, and it carries the shipped sentence saying the scan
        is only how they got here.
      */}
      <Option
        label="Push-ups at the front"
        description="Counted in push-ups. This is the screen you scanned. Scanning is how you got here — tap it to say it is what you are doing."
        selected={chosen === 'scanned'}
      />
      <Option
        label="Lap of the hall"
        description="Counted in movements."
        selected={chosen === 'other'}
      />
    </Card>
  );
}

/** Decision two. Rendered only once an activity is selected — not disabled,
 * not greyed, not present. */
function ChoiceBlock({ nameOpen }: { nameOpen?: boolean }) {
  return (
    <View style={s.choice}>
      <Text style={s.choiceTitle}>Where do you want to do it?</Text>
      <Text style={s.choiceEcho}>Push-ups at the front</Text>
      <Text style={s.cardBody}>Two ways, and you are in neither until you pick one.</Text>
      <Primary label="Use my phone" />
      <Text style={s.underNote}>
        Do it now and enter the number you counted yourself. Nothing of yours goes on the screen in
        the room.
      </Text>
      {!nameOpen ? (
        <>
          <Secondary label="Join the kiosk queue" />
          <Text style={s.underNote}>
            Wait your turn at the screen in the room. You choose what it calls you first, and you
            are not in the line until you say so.
          </Text>
        </>
      ) : null}
      <Text style={s.underNote}>
        Opening either one puts nobody in a line. You are in the line only once you confirm the
        name the screen will call.
      </Text>
    </View>
  );
}

/**
 * THE NAME PANEL. The one screen in this product where a person decides what
 * strangers will read about them, so it is given the weight of a decision:
 * where it goes, what to pick, and what becomes of it, above the control that
 * sends it.
 */
function NamePanel({ working, error }: { working?: boolean; error?: string }) {
  return (
    <Card title="What should the screen call you?">
      <Text style={s.cardBody}>
        This goes on the screen in the room, where everybody can read it. Pick whatever you are
        happy for strangers to see.
      </Text>
      <Text style={s.fieldLabel}>Name on the screen</Text>
      <View style={[s.input, error ? s.inputInvalid : null]}>
        <Text style={s.inputValue}>Sam</Text>
      </View>
      <View style={s.pills}>
        <View style={[s.pill, s.pillOn]}>
          <Text style={[s.pillText, s.pillTextOn]}>Sam</Text>
        </View>
        <View style={s.pill}>
          <Text style={s.pillText}>Initials only (S.H.)</Text>
        </View>
      </View>
      <Text style={s.underNote}>
        It is kept with your place in the line and nowhere else. It never joins your profile, and
        it goes when your place does.
      </Text>
      {error ? <Text style={s.fieldError}>{error}</Text> : null}
      <Primary label={working ? 'Getting in line…' : 'Get in line'} working={working} />
      <Secondary label="Not now" quiet />
    </Card>
  );
}

export function EventChooseActivityTarget() {
  return (
    <Frame id="event-choose-activity">
      {({ compact, frameHeight }) => (
        <>
          <EventHero
            compact={compact}
            frameHeight={frameHeight}
            community="Riverside Church"
            title="Add your part"
          />
          <Sheet compact={compact}>
            <ActivityCard />
            {/*
              NO SECOND DECISION ON SCREEN YET. Not disabled and not greyed —
              absent. A control that is visible but refuses to work is a
              question the person cannot answer.
            */}
            <Foot>
              <Secondary label="Back to home" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function EventChosenTarget() {
  return (
    <Frame id="event-chosen">
      {({ compact, frameHeight }) => (
        <>
          <EventHero
            compact={compact}
            frameHeight={frameHeight}
            community="Riverside Church"
            title="Add your part"
          />
          <Sheet compact={compact}>
            <ActivityCard chosen="scanned" />
            <ChoiceBlock />
            <Foot>
              <Secondary label="Back to home" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function EventNamePanelTarget() {
  return (
    <Frame id="event-name-panel">
      {({ compact, frameHeight }) => (
        <>
          <EventHero
            compact={compact}
            frameHeight={frameHeight}
            community="Riverside Church"
            title="Add your part"
          />
          <Sheet compact={compact}>
            <ActivityCard chosen="scanned" />
            <ChoiceBlock nameOpen />
            <NamePanel />
            <Foot>
              <Secondary label="Back to home" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function EventJoiningTarget() {
  return (
    <Frame id="event-joining">
      {({ compact, frameHeight }) => (
        <>
          <EventHero
            compact={compact}
            frameHeight={frameHeight}
            community="Riverside Church"
            title="Add your part"
          />
          <Sheet compact={compact}>
            <ActivityCard chosen="scanned" />
            <ChoiceBlock nameOpen />
            <NamePanel working />
            <Foot>
              <Secondary label="Back to home" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function EventQueueErrorTarget() {
  return (
    <Frame id="event-queue-error">
      {({ compact, frameHeight }) => (
        <>
          <EventHero
            compact={compact}
            frameHeight={frameHeight}
            community="Riverside Church"
            title="Add your part"
          />
          <Sheet compact={compact}>
            <ActivityCard chosen="scanned" />
            <ChoiceBlock nameOpen />
            {/*
              THE REFUSAL SITS IN THE PANEL THAT CAUSED IT, above its own
              control, and the name they typed is still there. Nothing is in
              the line, and the screen says so rather than leaving them to
              wonder whether it half-worked.
            */}
            <NamePanel error="We couldn’t get you in line. Nothing was sent — try again." />
            <Foot>
              <Secondary label="Back to home" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function EventNoActivitiesTarget() {
  return (
    <Frame id="event-no-activities">
      {({ compact, frameHeight }) => (
        <>
          <EventHero
            compact={compact}
            frameHeight={frameHeight}
            community="Riverside Church"
            title="Add your part"
          />
          <Sheet compact={compact}>
            {/*
              NOTHING TO CHOOSE, SO NOTHING IS OFFERED. The route does not
              invent an activity to fill the card, and neither does this.
            */}
            <Card title="What are you here to do?">
              <Text style={s.cardBody}>
                We couldn’t load what this event is counting. Reload the page and try again.
              </Text>
              <Primary label="Reload" />
            </Card>
            <Foot>
              <Secondary label="Back to home" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function EventSignedOutTarget() {
  return (
    <Frame id="event-signed-out">
      {({ compact, frameHeight }) => (
        <>
          <Field compact={compact} grow={0.42} frameHeight={frameHeight} chip="At the event" chipTone="live">
            <Text style={s.fieldEyebrow}>At the event</Text>
            <Text style={[compact ? display.md : display.lg, s.fieldTitle]}>Add your part</Text>
            <Text style={s.fieldIntro}>
              You’ll need an account, so what you add is yours and stays yours.
            </Text>
          </Field>
          <Sheet compact={compact}>
            <Primary label="Create an account" />
            <Secondary label="Already have an account? Sign in" />
            <Foot>
              {/*
                THE CANCEL BOUNDARY. Somebody who says "not now" must not be
                carried back here by an auth flow they start later, so the way
                out is a real control rather than a browser back button.
              */}
              <Secondary label="Not now — back to home" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function EventNotMemberTarget() {
  return (
    <Frame id="event-not-member">
      {({ compact }) => (
        <Quiet
          compact={compact}
          title="Join the community first."
          body="You’re signed in, but you’re not in the community running this. Ask a Champion to send you their invite, then come back to this page."
          back="Back to home"
        />
      )}
    </Frame>
  );
}

export function EventDeviceChoiceTarget() {
  return (
    <Frame id="event-device-choice">
      {({ compact, frameHeight }) => (
        <>
          <Field compact={compact} grow={0.3} frameHeight={frameHeight} chip="Before anything else" chipTone="action">
            <Text style={s.fieldEyebrow}>One question first</Text>
            <Text style={[compact ? display.md : display.lg, s.fieldTitle]}>Whose screen is this?</Text>
            <Text style={s.fieldIntro}>
              It changes what happens next, so nothing runs until this is answered.
            </Text>
          </Field>
          <Sheet compact={compact}>
            <View style={s.deviceCard}>
              <Text style={s.deviceLabel}>My own phone</Text>
              <Text style={s.deviceBody}>
                Your part is counted to you, and your name is only ever on a screen if you put it
                there.
              </Text>
              <Primary label="This is my phone" />
            </View>
            <View style={s.deviceCardQuiet}>
              <Text style={s.deviceLabel}>A screen we’re sharing</Text>
              <Text style={s.deviceBody}>
                The screen goes to the shared session instead, where anyone can add their part and
                nothing is kept about who they are.
              </Text>
              <Secondary label="We’re sharing this screen" />
            </View>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function EventDeviceSharedTarget() {
  return (
    <Frame id="event-device-shared">
      {({ compact, frameHeight }) => (
        <>
          <Field compact={compact} grow={0.3} frameHeight={frameHeight} chip="Shared screen" chipTone="action">
            <Text style={s.fieldEyebrow}>Remembered on this screen</Text>
            <Text style={[compact ? display.md : display.lg, s.fieldTitle]}>This is a shared screen.</Text>
            <Text style={s.fieldIntro}>
              It is not offered a personal sign-in — it is offered the session it belongs to.
            </Text>
          </Field>
          <Sheet compact={compact}>
            <Card title="What that means">
              <Text style={s.cardBody}>Anyone can add their part without signing in.</Text>
              <Text style={s.cardBody}>Nothing identifies the last person who used it.</Text>
              <Text style={s.cardBody}>You can undo this choice on this screen at any time.</Text>
            </Card>
            <Primary label="Continue to the shared screen" />
            <Foot>
              <Secondary label="Use my own phone instead" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function EventErrorTarget() {
  return (
    <Frame id="event-error">
      {({ compact }) => (
        <Quiet
          compact={compact}
          title="Something went wrong."
          body="We couldn’t load this event. Nothing of yours is affected — try again."
          action="Try again"
          back="Back to home"
        />
      )}
    </Frame>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   D2 · /queue/[goalId] — WAITING, BEING CALLED, FINISHING
   ════════════════════════════════════════════════════════════════════════ */

/**
 * THE HERO IS WHATEVER MATTERS RIGHT NOW, AND IT CHANGES FOUR TIMES.
 *
 *   waiting   the place in line, largest — "3rd in line".
 *   called    the name the screen is showing, and the code beside it, so two
 *             people called Sam each know which one is theirs.
 *   running   the turn, with the activity named, because three may be running
 *             at once in the same room.
 *   recorded  the number they added.
 *
 * Nothing under the hero moves between these; the panels swap, the page does
 * not rearrange around a walking thumb.
 */
export function QueueWaitingTarget() {
  return (
    <Frame id="queue-waiting">
      {({ compact, frameHeight }) => (
        <>
          <Field compact={compact} grow={0.4} frameHeight={frameHeight} chip="In line" chipTone="live">
            <Text style={s.fieldEyebrow}>In line</Text>
            <Text style={s.bigPlace}>3rd in line</Text>
            <Text style={s.fieldMeta}>The screen will call you Sam.</Text>
            <Text style={s.fieldIntro}>
              Keep this page open, or come back to it. You’ll have 45 seconds to say you’re coming.
            </Text>
          </Field>
          <Sheet compact={compact}>
            <Card title="While you wait">
              <Text style={s.cardBody}>
                Your name is on the screen in the room with your place in the line, and nowhere
                else.
              </Text>
            </Card>
            <Secondary label="Use my phone instead" />
            <Foot>
              {/*
                LEAVING IS THE LAST RESORT, NOT THE ONLY THING ON OFFER. It
                used to be the only control here. It stays, plainly, at the
                foot — and it says what it actually does, which is take a name
                off a screen in a room.
              */}
              <Secondary label="Take my name off the screen" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

function CalledField({
  compact,
  frameHeight,
  eyebrow,
  lease,
}: {
  compact: boolean;
  frameHeight: number;
  eyebrow: string;
  lease?: string;
}) {
  return (
    <Field
      compact={compact}
      grow={0.42}
      frameHeight={frameHeight}
      chip={lease ? 'Now' : 'Your turn'}
      chipTone="live"
      urgent={Boolean(lease)}
    >
      <Text style={s.fieldEyebrow}>{eyebrow}</Text>
      <Text style={s.calledName}>Sam</Text>
      {/* The same three characters the screen in the room is showing. */}
      <Text style={s.code}>H4K</Text>
      <Text style={s.fieldMeta}>Go to Station 2.</Text>
      {lease ? <Text style={s.lease}>{lease}</Text> : null}
    </Field>
  );
}

export function QueueCalledTarget() {
  return (
    <Frame id="queue-called">
      {({ compact, frameHeight }) => (
        <>
          <CalledField
            compact={compact}
            frameHeight={frameHeight}
            eyebrow="Your turn"
            lease="45s to say you’re coming"
          />
          <Sheet compact={compact}>
            <Card title="Are you coming?">
              <Text style={s.cardBody}>
                Tap this and the screen holds your place while you walk over. If nobody taps within
                45 seconds the screen moves on, so nobody waits on an empty spot.
              </Text>
              <Primary label="I’m ready" />
            </Card>
            <Foot>
              <Secondary label="Take my name off the screen" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function QueueTellingTarget() {
  return (
    <Frame id="queue-telling">
      {({ compact, frameHeight }) => (
        <>
          <CalledField
            compact={compact}
            frameHeight={frameHeight}
            eyebrow="Your turn"
            lease="41s to say you’re coming"
          />
          <Sheet compact={compact}>
            <Card title="Are you coming?">
              <Text style={s.cardBody}>
                Tap this and the screen holds your place while you walk over. If nobody taps within
                45 seconds the screen moves on, so nobody waits on an empty spot.
              </Text>
              <Primary label="Telling them…" working />
            </Card>
            <Foot>
              <Secondary label="Take my name off the screen" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function QueueReadyTarget() {
  return (
    <Frame id="queue-ready">
      {({ compact, frameHeight }) => (
        <>
          {/*
            THEY SAID THEY WERE COMING. The clock is gone, because it is: the
            lease is held. What replaces it is the only useful sentence left,
            which is where to walk.
          */}
          <CalledField compact={compact} frameHeight={frameHeight} eyebrow="Walk over" />
          <Sheet compact={compact}>
            <Banner
              tone="note"
              title="Your place is held."
              body="Go to Station 2 and it will start when you’re there."
            />
            <Secondary label="Use my phone instead" />
            <Foot>
              <Secondary label="Take my name off the screen" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

function RecordPanel({ error }: { error?: string }) {
  return (
    <Card title="How many push-ups did you do?">
      <Text style={s.cardBody}>
        You can finish here or at the screen — it is the same turn either way, and it is counted
        once.
      </Text>
      <Text style={s.fieldLabel}>How many</Text>
      <View style={[s.input, error ? s.inputInvalid : null]}>
        <Text style={error ? s.inputValue : s.inputPlaceholder}>{error ? '0' : '30'}</Text>
      </View>
      {error ? <Text style={s.fieldError}>{error}</Text> : null}
      <Primary label="Record it" />
    </Card>
  );
}

export function QueueActiveTarget() {
  return (
    <Frame id="queue-active">
      {({ compact, frameHeight }) => (
        <>
          <Field compact={compact} grow={0.3} frameHeight={frameHeight} chip="Running" chipTone="live">
            <Text style={s.fieldEyebrow}>Your turn is running</Text>
            <Text style={s.calledName}>Sam</Text>
            <Text style={s.fieldMeta}>Station 2 · H4K</Text>
          </Field>
          <Sheet compact={compact}>
            {/*
              WHICH ACTIVITY, ON THE PHONE TOO. They chose it several screens
              ago; with three running at once in the same room, the screen they
              are following along on should say which one it is.
            */}
            <Text style={s.activityName}>Push-ups at the front</Text>
            <Text style={s.activityUnit}>Counted in push-ups</Text>
            <View style={s.player}>
              <Text style={s.playerClock}>0:38</Text>
              <Text style={s.playerCue}>Keep going</Text>
              <View style={s.playerTrack}>
                <View style={[s.playerBar, { width: '63%' }]} />
              </View>
              <Text style={s.playerHandoff}>Enter what you counted below.</Text>
            </View>
            <RecordPanel />
            <Foot>
              <Secondary label="Take my name off the screen" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function QueueRecordErrorTarget() {
  return (
    <Frame id="queue-record-error">
      {({ compact, frameHeight }) => (
        <>
          <Field compact={compact} grow={0.3} frameHeight={frameHeight} chip="Running" chipTone="live">
            <Text style={s.fieldEyebrow}>Your turn is running</Text>
            <Text style={s.calledName}>Sam</Text>
            <Text style={s.fieldMeta}>Station 2 · H4K</Text>
          </Field>
          <Sheet compact={compact}>
            <Text style={s.activityName}>Push-ups at the front</Text>
            <Text style={s.activityUnit}>Counted in push-ups</Text>
            {/*
              THE TURN IS NOT LOST. A refused number is a refused number; the
              panel keeps the turn, keeps the field, and says what to change.
            */}
            <RecordPanel error="Enter how many you did — a whole number above zero." />
            <Foot>
              <Secondary label="Take my name off the screen" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

function ReceiptField({
  compact,
  frameHeight,
  eyebrow,
  scope,
}: {
  compact: boolean;
  frameHeight: number;
  eyebrow: string;
  scope: string;
}) {
  return (
    <Field compact={compact} grow={0.42} frameHeight={frameHeight} chip="Counted" chipTone="live">
      <Text style={s.fieldEyebrow}>{eyebrow}</Text>
      {/*
        WHAT THEY DID, FIRST AND LARGEST. This page used to open with "You're
        not in the line" and bury the number underneath — the least interesting
        true thing on the screen sitting above the only thing anybody came back
        to see.
      */}
      <Text style={s.bigPlace}>30 push-ups recorded.</Text>
      {/*
        THEIR OWN CREDIT, SAID TO BE THEIRS. The shared total is not restated
        here, where it would be read as the same figure.
      */}
      <Text style={s.fieldIntro}>{scope}</Text>
    </Field>
  );
}

export function QueueRecordedTarget() {
  return (
    <Frame id="queue-recorded">
      {({ compact, frameHeight }) => (
        <>
          <ReceiptField
            compact={compact}
            frameHeight={frameHeight}
            eyebrow="Recorded"
            scope="Your own part, counted once. Thank you."
          />
          <Sheet compact={compact}>
            <Primary label="Back to the event" />
            <View style={s.quietStrip}>
              <Text style={s.quietStripTitle}>You’re not in the line</Text>
              <Text style={s.quietStripBody}>
                Nothing of yours is on the screen in the room. You can get back in line from the
                event page whenever you like.
              </Text>
            </View>
            <Foot>
              <Secondary label="Back to home" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function QueueReceiptTarget() {
  return (
    <Frame id="queue-receipt">
      {({ compact, frameHeight }) => (
        <>
          {/*
            THE RECOVERABLE RECEIPT. The same news arriving by a different
            route: this is what is still here when the tap never came back,
            which is the whole reason it exists — so it says so in its own
            words rather than borrowing the fresh one's.
          */}
          <ReceiptField
            compact={compact}
            frameHeight={frameHeight}
            eyebrow="Your last turn here"
            scope="Your own part, counted once — whatever happened to the page that recorded it."
          />
          <Sheet compact={compact}>
            <Primary label="Back to the event" />
            <View style={s.quietStrip}>
              <Text style={s.quietStripTitle}>You’re not in the line</Text>
              <Text style={s.quietStripBody}>
                Nothing of yours is on the screen in the room. You can get back in line from the
                event page whenever you like.
              </Text>
            </View>
            <Foot>
              <Secondary label="Back to home" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function QueueTimedOutTarget() {
  return (
    <Frame id="queue-timed-out">
      {({ compact, frameHeight }) => (
        <>
          <Field compact={compact} grow={0.34} frameHeight={frameHeight} chip="Moved on" chipTone="quiet">
            <Text style={s.fieldEyebrow}>Your turn timed out</Text>
            <Text style={[compact ? display.md : display.lg, s.fieldTitle]}>
              The screen moved on.
            </Text>
            {/*
              NOT A TELLING-OFF. The screen moved on so nobody waits on an
              empty spot, and getting back in line is one tap. The shipped
              sentence already ends on that, so the target leads with the
              recovery and not the miss.
            */}
            <Text style={s.fieldIntro}>
              The screen called you and the 45 seconds ran out, so it moved on. Get back in line and
              it will call you again.
            </Text>
          </Field>
          <Sheet compact={compact}>
            <Primary label="Back to the event" />
            <Foot>
              <Secondary label="Back to home" quiet />
            </Foot>
          </Sheet>
        </>
      )}
    </Frame>
  );
}

export function QueueNotInLineTarget() {
  return (
    <Frame id="queue-not-in-line">
      {({ compact }) => (
        <Quiet
          compact={compact}
          title="You’re not in the line."
          body="Nothing of yours is on the screen in the room. You can get back in line from the event page whenever you like."
          action="Back to the event"
          back="Back to home"
        />
      )}
    </Frame>
  );
}

export function QueueSignedOutTarget() {
  return (
    <Frame id="queue-signed-out">
      {({ compact }) => (
        <Quiet
          compact={compact}
          title="Sign in to see your turn."
          body="Your place in the line belongs to your account, so we need to know it is you."
          action="Sign in"
          back="Back to home"
        />
      )}
    </Frame>
  );
}

export function QueueErrorTarget() {
  return (
    <Frame id="queue-error">
      {({ compact }) => (
        <Quiet
          compact={compact}
          title="Something went wrong."
          body="We couldn’t check your place in the line. Your place is not affected — try again."
          action="Try again"
          back="Back to the event"
        />
      )}
    </Frame>
  );
}

export function QueueLoadingTarget() {
  return (
    <Frame id="queue-loading">
      {({ compact }) => (
        <>
          <View style={[s.fieldQuiet, compact ? s.fieldQuietCompact : null]}>
            <WsfWordmark variant="navy" height={compact ? 18 : 20} />
          </View>
          <Sheet compact={compact}>
            <View style={s.skelHero}>
              <View style={[s.skel, { width: '26%', height: 11 }]} />
              <View style={[s.skel, { width: '58%', height: 34 }]} />
              <View style={[s.skel, { width: '70%', height: 13 }]} />
            </View>
            <View style={s.skelCard}>
              <View style={[s.skel, { width: '48%', height: 14 }]} />
              <View style={[s.skel, { width: '92%', height: 11 }]} />
              <View style={[s.skel, { width: '100%', height: 44 }]} />
            </View>
            <Text style={s.loadingNote}>Checking your place…</Text>
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
  fieldUrgent: { borderBottomWidth: 5, borderBottomColor: ACTION_GREEN },
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
  fieldMeta: { color: ON_NAVY_MUTED, fontSize: 13.5, fontWeight: '700' },
  fieldIntro: { color: ON_NAVY_MUTED, fontSize: 13.5, lineHeight: 19 },

  /* the one fact that matters, whatever it currently is */
  bigPlace: {
    color: CREAM,
    fontSize: 38,
    lineHeight: 43,
    fontWeight: '900',
    letterSpacing: -1.2,
    flexShrink: 1,
    minWidth: 0,
  },
  calledName: {
    color: CREAM,
    fontSize: 44,
    lineHeight: 49,
    fontWeight: '900',
    letterSpacing: -1.4,
    flexShrink: 1,
    minWidth: 0,
  },
  code: {
    color: PROGRESS_GREEN,
    fontSize: 26,
    lineHeight: 31,
    fontWeight: '900',
    letterSpacing: 6,
  },
  lease: {
    color: ON_ACTION,
    backgroundColor: ACTION_GREEN,
    borderRadius: 999,
    alignSelf: 'flex-start',
    paddingHorizontal: 13,
    paddingVertical: 6,
    fontSize: 14,
    fontWeight: '900',
    overflow: 'hidden',
    marginTop: 4,
  },

  sheet: { flex: 1, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 24, gap: 12 },
  sheetCompact: { paddingTop: 13, gap: 9 },
  spacer: { flex: 1, minHeight: 10 },
  foot: { gap: 2, borderTopWidth: 1, borderTopColor: HAIRLINE, paddingTop: 8 },
  loadingNote: { color: INK_QUIET, fontSize: 13, textAlign: 'center', marginTop: 4 },
  underNote: { color: INK_QUIET, fontSize: 12, lineHeight: 17 },

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
  spinner: {
    width: 15,
    height: 15,
    borderRadius: 8,
    borderWidth: 2.5,
    borderColor: '#6B8A76',
    borderTopColor: 'transparent',
  },
  secondary: {
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: HAIRLINE,
    backgroundColor: SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { color: NAVY, fontSize: 15.5, fontWeight: '800' },
  secondaryQuiet: { minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  secondaryQuietText: { color: INK_QUIET, fontSize: 13.5, fontWeight: '700' },

  card: {
    backgroundColor: SURFACE,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 15,
    gap: 8,
    ...elevation.card,
  },
  cardTitle: { color: NAVY, fontSize: 16, fontWeight: '900' },
  cardBody: { color: NAVY, fontSize: 13.5, lineHeight: 19 },

  /* decision two */
  choice: { gap: 8 },
  choiceTitle: { color: NAVY, fontSize: 17, fontWeight: '900' },
  choiceEcho: { color: ACTION_GREEN_DEEP, fontSize: 13.5, fontWeight: '800' },

  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
    backgroundColor: CREAM,
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

  fieldLabel: {
    color: INK_QUIET,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: CREAM,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: HAIRLINE,
    paddingHorizontal: 14,
    minHeight: 50,
    justifyContent: 'center',
  },
  inputInvalid: { borderColor: ERROR_RED },
  inputValue: { color: NAVY, fontSize: 16, fontWeight: '700' },
  inputPlaceholder: { color: INK_QUIET, fontSize: 16 },
  fieldError: { color: ERROR_RED, fontSize: 12.5, lineHeight: 17, fontWeight: '700' },

  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: HAIRLINE,
    backgroundColor: CREAM,
    paddingHorizontal: 14,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillOn: { borderColor: ACTION_GREEN_DEEP, backgroundColor: '#F1F9F3' },
  pillText: { color: INK_QUIET, fontSize: 13, fontWeight: '800' },
  pillTextOn: { color: ACTION_GREEN_DEEP },

  banner: { borderRadius: 14, borderLeftWidth: 4, paddingHorizontal: 13, paddingVertical: 11, gap: 3 },
  bannerError: { backgroundColor: '#FBEFEF', borderLeftColor: ERROR_RED },
  bannerNote: { backgroundColor: '#F1F9F3', borderLeftColor: ACTION_GREEN_DEEP },
  bannerTitle: { color: NAVY, fontSize: 14.5, lineHeight: 19, fontWeight: '900' },
  bannerTitleError: { color: ERROR_RED },
  bannerBody: { color: INK_QUIET, fontSize: 12.5, lineHeight: 17 },

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

  /* the turn in progress */
  activityName: { color: NAVY, fontSize: 16, fontWeight: '900' },
  activityUnit: { color: INK_QUIET, fontSize: 12.5, marginTop: -6 },
  player: {
    backgroundColor: NAVY,
    borderRadius: 20,
    padding: 18,
    gap: 8,
    alignItems: 'center',
    ...elevation.hero,
  },
  playerClock: { color: CREAM, fontSize: 40, lineHeight: 45, fontWeight: '900', letterSpacing: -1 },
  playerCue: { color: PROGRESS_GREEN, fontSize: 14, fontWeight: '800' },
  playerTrack: {
    height: 8,
    width: '100%',
    borderRadius: 999,
    backgroundColor: 'rgba(247,245,240,0.16)',
    overflow: 'hidden',
  },
  playerBar: { height: 8, borderRadius: 999, backgroundColor: ACTION_GREEN },
  playerHandoff: { color: ON_NAVY_MUTED, fontSize: 12.5, marginTop: 2 },

  /* not in the line, under a receipt */
  quietStrip: {
    backgroundColor: '#EEF2F6',
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 11,
    gap: 3,
  },
  quietStripTitle: { color: INK_QUIET, fontSize: 13, fontWeight: '900' },
  quietStripBody: { color: INK_QUIET, fontSize: 12.5, lineHeight: 17 },

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
});
