import { StyleSheet, Text, View } from 'react-native';

import { LivingWeProgress } from '../LivingWeProgress';
import { WsfWordmark } from '../WsfWordmark';
import {
  ACTION_GREEN,
  ACTION_GREEN_DEEP,
  CREAM,
  INK_QUIET,
  NAVY,
  ON_ACTION,
  ON_NAVY,
  ON_NAVY_MUTED,
  PROGRESS_GREEN,
  SURFACE,
  elevation,
} from '../kit';

/**
 * ATLAS BATCH E — THE SCREENS IN THE ROOM. TARGETS, NOT IMPLEMENTED PAGES.
 *
 *   E1  /kiosk/[goalId]              800x1280 portrait     6 states
 *   E2  /contribute/[goalId]?kiosk=1 800x1280 portrait     7 states
 *   E3  /station/[goalId]            1280x800 landscape   14 states
 *
 * ── THESE ARE NOT BIG PHONES ──────────────────────────────────────────────
 *
 * Every other batch draws a screen held in a hand by one person. These are
 * read across a room by people who are not holding them, and the differences
 * are not cosmetic:
 *
 *   NOTHING SCROLLS. A venue screen has no thumb. Everything that matters is
 *   on the canvas at once or it does not exist, which is why the station's
 *   running turn is two columns rather than a column: stacked, its count box
 *   sat below the bottom edge of a canvas that cannot be scrolled to.
 *
 *   THE TYPE IS SIZED FOR THREE METRES, not for a reading distance. The
 *   called name, the code and the total are the three things a room reads,
 *   and they are the three largest things on the canvas.
 *
 *   THE BACKGROUND IS NAVY, EDGE TO EDGE. A cream page with a navy card is a
 *   document; these are signage, and the brand field IS the screen.
 *
 *   THERE IS NO BACK. No chrome link, no "back to home". A device bolted to a
 *   table has nowhere to go back to, and a control that navigates off the
 *   screen is how a kiosk ends up showing somebody's inbox.
 *
 * ── WHAT A SHARED SCREEN MAY NEVER DO, AND HOW THE TARGET SHOWS IT ────────
 *
 * NO NAME SURVIVES A TURN. The station shows a called name at the largest
 * size on the canvas while that person is up, and the moment the turn is
 * recorded EVERY name on the screen is gone — the ten-second result carries a
 * code and a number and nothing else. Ten seconds later so does that. The
 * target draws the recorded state and the cleared state side by side
 * precisely so this can be checked rather than believed.
 *
 * THE WAITING ARE A NUMBER, NOT A LIST. Not a list truncated to four either.
 * The room does not need to read anybody's name but the one person who is up.
 *
 * THE KIOSK WITNESSES NOTHING. Its one control hands off to the visitor's own
 * sign-in and their own self-counted entry. "Contribute here" — not "check
 * in", not "verify". The device claims nothing about what anybody did.
 *
 * FINISH SIGNS OUT AND RETURNS THE DEVICE. It clears a settled draft and the
 * kiosk's own keys. It does NOT erase an unresolved attempt: that record is
 * the only thing that lets the person who made it replay the same attempt id
 * and get the original receipt instead of booking a second contribution.
 * Deleting it to make the kiosk look clean would destroy the one artefact
 * that keeps their effort reconcilable — so the target shows the unresolved
 * receipt keeping its notice, and says where to go and see it.
 *
 * AN IDLE TERMINAL SCREEN FINISHES ITSELF. Ninety seconds: long enough to
 * read a receipt twice, short enough that the next person does not find the
 * previous person's result waiting for them. "Stay" is beside the countdown
 * for the person who is still reading.
 *
 * THE REFUSAL IS BYTE-IDENTICAL ACROSS KIOSK, STATION AND PUBLIC DISPLAY.
 * Unknown goal, unauthorized goal and revoked permission are the same two
 * sentences on all three, so no room screen can become an oracle.
 *
 * NO PAIRING CODE IS EVER PRINTED IN EVIDENCE. The station's pairing frames
 * show the SHAPE of the code with a fixed placeholder; nothing in this file
 * is a real enrolment code and the capture spec never renders one.
 */

/* ── shell ──────────────────────────────────────────────────────────────── */

/** The canvas. Navy, edge to edge, no scroll, no way off it. */
function Canvas({
  id,
  landscape,
  children,
}: {
  id: string;
  landscape?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View
      style={[s.canvas, landscape ? s.canvasLandscape : null]}
      testID={`wsf-target-e-${id}`}
    >
      <View pointerEvents="none" style={s.texture}>
        <View style={[s.band, s.band1]} />
        <View style={[s.band, s.band2]} />
        <View style={[s.band, s.band3]} />
        <View style={s.glow} />
      </View>
      {children}
    </View>
  );
}

function Header({
  landscape,
  right,
  label,
}: {
  landscape?: boolean;
  right?: string;
  label?: string;
}) {
  return (
    <View style={s.header}>
      <WsfWordmark variant="white" height={landscape ? 34 : 38} />
      <View style={s.headerRight}>
        {label ? <Text style={s.stationLabel}>{label}</Text> : null}
        {right ? <Text style={s.freshness}>{right}</Text> : null}
      </View>
    </View>
  );
}

/**
 * The Living WE at venue scale — the REAL component, not a rectangle standing
 * in for it.
 *
 * Drawing a placeholder here would have been the exact mistake this atlas
 * keeps catching elsewhere: a target that shows an instrument the product does
 * not have, or shows the product's instrument as something simpler than it is.
 * `LivingWeProgress` is what `/kiosk/[goalId]` and `/station/[goalId]` already
 * render, so the target renders it too, with `surface="dark"` as those routes
 * pass and a width sized for the room. Its fill is `completed / target` —
 * both confirmed server values.
 */
function LivingWe({
  completed,
  target,
  unit,
  width,
}: {
  completed: number;
  target: number;
  unit: string;
  width: number;
}) {
  return (
    <View style={s.weWrap}>
      <LivingWeProgress
        completed={completed}
        target={target}
        unit={unit}
        width={width}
        surface="dark"
      />
    </View>
  );
}

function Primary({ label, big, working }: { label: string; big?: boolean; working?: boolean }) {
  return (
    <View style={[s.primary, big ? s.primaryBig : null, working ? s.primaryOff : null]}>
      {working ? <View style={s.spinner} /> : null}
      <Text style={[s.primaryText, big ? s.primaryTextBig : null, working ? s.primaryTextOff : null]}>
        {label}
      </Text>
    </View>
  );
}

function Tertiary({ label }: { label: string }) {
  return (
    <View style={s.tertiary}>
      <Text style={s.tertiaryText}>{label}</Text>
    </View>
  );
}

/**
 * The generic non-ready screen, shared by kiosk and station because it is
 * shared in the product: one block, centred, the wordmark above it, and
 * "Check again" only where checking again can change anything.
 */
function Generic({
  id,
  landscape,
  headline,
  body,
  action,
}: {
  id: string;
  landscape?: boolean;
  headline: string;
  body?: string;
  action?: boolean;
}) {
  return (
    <Canvas id={id} landscape={landscape}>
      <View style={s.genericBlock}>
        <WsfWordmark variant="white" height={landscape ? 40 : 44} />
        <Text style={[s.genericHeadline, landscape ? s.genericHeadlineLandscape : null]}>
          {headline}
        </Text>
        {body ? <Text style={s.genericBody}>{body}</Text> : null}
        {action ? <Tertiary label="Check again" /> : null}
      </View>
    </Canvas>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   E1 · /kiosk/[goalId] — 800x1280 PORTRAIT
   ════════════════════════════════════════════════════════════════════════ */

function KioskReady({
  id,
  total,
  target,
  completed,
  targetN,
  percent,
  status,
  period,
  stale,
  closed,
}: {
  id: string;
  total: string;
  target: string;
  completed: number;
  targetN: number;
  percent: string;
  status: string;
  period: string;
  stale?: boolean;
  closed?: boolean;
}) {
  return (
    <Canvas id={id}>
      <Header right={`${stale ? 'Last confirmed' : 'Confirmed'} 2:14 PM`} />
      <View style={s.kioskHero}>
        <Text style={s.community}>Riverside Church</Text>
        <Text style={s.goalTitle}>October Push-Up Challenge</Text>
        <Text style={s.period}>{period}</Text>
        <LivingWe completed={completed} target={targetN} unit="push-ups" width={320} />
        <Text style={s.total}>
          {total}
          <Text style={s.totalOf}>{` of ${target} push-ups`}</Text>
        </Text>
        <Text style={s.percent}>{percent}</Text>
        <Text style={[s.status, closed ? s.statusClosed : null]}>{status}</Text>
      </View>
      {/*
        THE ONE ACTION, and the only two sentences that describe it. The
        device witnesses nothing: what follows is the visitor's own sign-in
        and their own self-counted entry, and the copy claims nothing more.
      */}
      <View style={s.kioskActions}>
        <Primary label="Contribute here" big />
        <Text style={s.caption}>
          You’ll sign in with your own account, enter the number you counted yourself, and finish.
        </Text>
        <Text style={s.caption}>
          This is a shared device. Nothing about you stays on it after you finish.
        </Text>
      </View>
    </Canvas>
  );
}

export function KioskLiveTarget() {
  return (
    <KioskReady
      id="kiosk-live"
      total="6,420"
      target="10,000"
      completed={6420}
      targetN={10000}
      percent="64% complete"
      status="Open · ends Fri, Oct 31"
      period="Ends Fri, Oct 31"
    />
  );
}

export function KioskStaleTarget() {
  return (
    <KioskReady
      id="kiosk-stale"
      total="6,420"
      target="10,000"
      completed={6420}
      targetN={10000}
      percent="64% complete"
      status="Open · ends Fri, Oct 31"
      period="Ends Fri, Oct 31"
      stale
    />
  );
}

export function KioskClosedTarget() {
  return (
    <KioskReady
      id="kiosk-closed"
      total="10,840"
      target="10,000"
      completed={10840}
      targetN={10000}
      percent="108% complete"
      status="Reached · this goal has closed"
      period="Oct 1 — Oct 31"
      closed
    />
  );
}

export function KioskLoadingTarget() {
  return <Generic id="kiosk-loading" headline="Loading display…" />;
}

export function KioskUnreachableTarget() {
  return (
    <Generic
      id="kiosk-unreachable"
      headline="Connection interrupted"
      body="Nothing has been confirmed yet. Check again when you’re connected."
      action
    />
  );
}

export function KioskNotAvailableTarget() {
  return (
    <Generic
      id="kiosk-not-available"
      headline="Nothing to show here"
      body="This display isn’t currently available."
      action
    />
  );
}

/* ════════════════════════════════════════════════════════════════════════
   E2 · /contribute/[goalId]?kiosk=1 — 800x1280 PORTRAIT
   ════════════════════════════════════════════════════════════════════════ */

/**
 * The same contribution route, in kiosk mode. What the mode adds is the
 * session: a Finish control, an idle countdown, and a sign-out. Everything
 * else on the screen is Page 2's accepted design, sized for a tablet.
 */
function KioskEntryShell({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  return (
    <Canvas id={id}>
      <Header />
      <View style={s.entryBody}>
        <Text style={s.community}>Riverside Church</Text>
        <Text style={s.entryGoal}>October Push-Up Challenge</Text>
        {children}
      </View>
    </Canvas>
  );
}

export function KioskSignInTarget() {
  return (
    <KioskEntryShell id="kiosk-signin">
      {/*
        THE HANDOFF, AND WHY IT IS THE ORDINARY SIGN-IN. The kiosk does not
        have its own credential surface and must not: a shared device asking
        for a password in its own chrome is the shape of every credential
        harvest there has ever been. The visitor goes through the product's
        own sign-in, and the kiosk destination rides sessionStorage across it.
      */}
      <View style={s.entryCard}>
        <Text style={s.entryCardTitle}>Sign in to add your part</Text>
        <Text style={s.entryCardBody}>
          This is the same sign-in you use on your own phone. We’ll bring you straight back here.
        </Text>
        <Primary label="Sign in" big />
        <Text style={s.caption}>
          No account yet? You can create one — it takes a moment and what you add stays yours.
        </Text>
      </View>
    </KioskEntryShell>
  );
}

export function KioskEntryTarget() {
  return (
    <KioskEntryShell id="kiosk-entry">
      <View style={s.entryCard}>
        <Text style={s.entryCardTitle}>How many push-ups did you do?</Text>
        <Text style={s.entryCardBody}>
          Enter the number you counted yourself. Nobody is checking it, and nobody else can change
          it.
        </Text>
        <View style={s.bigInput}>
          <Text style={s.bigInputValue}>30</Text>
        </View>
        <Primary label="Add to the total" big />
        <Text style={s.caption}>Signed in as sam@example.com</Text>
      </View>
    </KioskEntryShell>
  );
}

/**
 * The three terminal screens, which differ only in what is true — and that is
 * the whole design. Each keeps the same Finish control, the same explainer,
 * the same countdown and the same Stay, because the session ends the same way
 * whatever happened to the attempt.
 */
function KioskTerminal({
  id,
  eyebrow,
  headline,
  body,
  notice,
  finishing,
  error,
  countdown,
}: {
  id: string;
  eyebrow: string;
  headline: string;
  body: string;
  notice?: string;
  finishing?: boolean;
  error?: string;
  countdown: string;
}) {
  return (
    <Canvas id={id}>
      <Header />
      <View style={s.terminalBody}>
        <Text style={s.terminalEyebrow}>{eyebrow}</Text>
        <Text style={s.terminalHeadline}>{headline}</Text>
        <Text style={s.terminalBodyText}>{body}</Text>
        {notice ? (
          <View style={s.noticeBox}>
            <Text style={s.noticeText}>{notice}</Text>
          </View>
        ) : null}
      </View>
      <View style={s.kioskActions}>
        <Primary label={finishing ? 'Finishing…' : 'Finish'} big working={finishing} />
        <Text style={s.caption}>Finish signs you out and returns this device to its start screen.</Text>
        <View style={s.countdownRow}>
          <Text style={s.caption}>{countdown}</Text>
          <Tertiary label="Stay" />
        </View>
        {error ? <Text style={s.errorText}>{error}</Text> : null}
      </View>
    </Canvas>
  );
}

export function KioskConfirmedTarget() {
  return (
    <KioskTerminal
      id="kiosk-confirmed"
      eyebrow="Counted"
      headline="30 push-ups added."
      body="Your own part, counted once. The community total is on the start screen."
      countdown="Finishing in 74 seconds"
    />
  );
}

export function KioskRefusedTarget() {
  return (
    <KioskTerminal
      id="kiosk-refused"
      eyebrow="Not added"
      headline="That wasn’t added."
      /*
        A DEFINITIVE REFUSAL IS SETTLED, so its draft is cleared by Finish
        like any other. The screen says nothing was recorded, rather than
        leaving a person at a shared device unsure whether to try again.
      */
      body="Nothing was recorded, so nothing is counted twice. You can try again from your own phone."
      countdown="Finishing in 62 seconds"
    />
  );
}

export function KioskUnresolvedTarget() {
  return (
    <KioskTerminal
      id="kiosk-unresolved"
      eyebrow="Not confirmed"
      headline="We couldn’t confirm this."
      /*
        THE ONE OUTCOME FINISH MAY NOT ERASE. The stored record is what lets
        this person replay the SAME attempt id later and get the original
        receipt instead of booking a second contribution. It stays, keyed to
        their account, and they are told plainly where to go and see it.
      */
      body="It may still have been recorded. Nothing is lost either way."
      notice="Your attempt is saved to your account; check it from your own device."
      countdown="Finishing in 88 seconds"
    />
  );
}

export function KioskFinishingTarget() {
  return (
    <KioskTerminal
      id="kiosk-finishing"
      eyebrow="Counted"
      headline="30 push-ups added."
      body="Your own part, counted once. The community total is on the start screen."
      finishing
      countdown="Finishing now…"
    />
  );
}

export function KioskFinishErrorTarget() {
  return (
    <KioskTerminal
      id="kiosk-finish-error"
      eyebrow="Counted"
      headline="30 push-ups added."
      body="Your own part, counted once. The community total is on the start screen."
      error="We couldn’t sign you out. Tap Finish again before you walk away."
      countdown="Finishing in 41 seconds"
    />
  );
}

/* ════════════════════════════════════════════════════════════════════════
   E3 · /station/[goalId] — 1280x800 LANDSCAPE
   ════════════════════════════════════════════════════════════════════════ */

/**
 * PAIRING. A station enrols by showing a code that somebody with authority
 * types somewhere else. The code's SHAPE is drawn; no code in this file is a
 * real one, and the capture spec never renders a live enrolment code into
 * evidence.
 */
function Pairing({
  id,
  code,
  line,
  instructions,
  retry,
}: {
  id: string;
  code?: string;
  line: string;
  instructions?: string;
  retry?: boolean;
}) {
  return (
    <Canvas id={id} landscape>
      <View style={s.genericBlock}>
        <WsfWordmark variant="white" height={40} />
        {code ? <Text style={s.pairingCode}>{code}</Text> : null}
        <Text style={s.genericBody}>{line}</Text>
        {instructions ? <Text style={s.pairingInstructions}>{instructions}</Text> : null}
        {retry ? <Tertiary label="Try again" /> : null}
        <Text style={s.caption}>
          This screen shows a shared total and calls people by the name they chose. It never shows
          anybody’s account.
        </Text>
      </View>
    </Canvas>
  );
}

export function StationPairingRequestingTarget() {
  return <Pairing id="station-pairing-requesting" line="Getting a code for this screen…" />;
}

export function StationPairingWaitingTarget() {
  return (
    <Pairing
      id="station-pairing-waiting"
      code="••• •••"
      line="Waiting to be paired."
      instructions="Enter this code where your Champion manages screens. It stops working once it is used or when it expires."
    />
  );
}

export function StationPairingClaimingTarget() {
  return <Pairing id="station-pairing-claiming" code="••• •••" line="Pairing this screen…" />;
}

export function StationPairingExpiredTarget() {
  return (
    <Pairing
      id="station-pairing-expired"
      line="That code expired."
      instructions="Codes are short-lived on purpose, so an unattended screen cannot be paired by someone walking past."
      retry
    />
  );
}

export function StationPairingFailedTarget() {
  return (
    <Pairing
      id="station-pairing-failed"
      line="We couldn’t pair this screen."
      instructions="Nothing was changed. Check the connection and try again."
      retry
    />
  );
}

export function StationLoadingTarget() {
  return <Generic id="station-loading" landscape headline="Loading display…" />;
}

export function StationUnreachableTarget() {
  return (
    <Generic
      id="station-unreachable"
      landscape
      headline="Connection interrupted"
      body="Nothing has been confirmed yet. Check again when you’re connected."
      action
    />
  );
}

export function StationNotAvailableTarget() {
  return (
    <Generic
      id="station-not-available"
      landscape
      headline="Nothing to show here"
      body="This display isn’t currently available."
      action
    />
  );
}

/** The left column: the shared total, unchanged by whose turn it is. */
function StationTotals({ compactWe }: { compactWe?: boolean }) {
  return (
    <View style={s.stationLeft}>
      <Text style={s.communitySmall}>Riverside Church</Text>
      <Text style={s.stationGoal}>October Push-Up Challenge</Text>
      <Text style={s.period}>Ends Fri, Oct 31</Text>
      <LivingWe completed={6420} target={10000} unit="push-ups" width={compactWe ? 130 : 200} />
      <Text style={s.stationTotal}>
        6,420
        <Text style={s.totalOf}>{' of 10,000 push-ups'}</Text>
      </Text>
      <Text style={s.percent}>64% complete</Text>
    </View>
  );
}

function StationShell({
  id,
  right,
  stale,
}: {
  id: string;
  right: React.ReactNode;
  stale?: boolean;
}) {
  return (
    <Canvas id={id} landscape>
      <Header landscape label="Station 2" right={`${stale ? 'Last confirmed' : 'Confirmed'} 2:14 PM`} />
      <View style={s.stationColumns}>
        <StationTotals compactWe={false} />
        <View style={s.stationRight}>{right}</View>
      </View>
    </Canvas>
  );
}

export function StationAttractTarget() {
  return (
    <StationShell
      id="station-attract"
      right={
        <>
          <View style={s.queuePanel}>
            <Text style={s.queueEyebrow}>Now serving</Text>
            {/*
              NOBODY IS UP. The panel keeps its shape rather than collapsing,
              so the screen does not rearrange itself every time the line
              empties and fills.
            */}
            <Text style={s.queueEmpty}>Nobody is being called.</Text>
            <Text style={s.queueCount}>Nobody is waiting.</Text>
          </View>
          {/*
            THE TWO QR CODES, AND THE DIFFERENCE BETWEEN THEM. One admits
            somebody to the community; the other takes a member who is already
            in to this event. They are labelled by what they do, because a
            wall of two identical squares is a coin toss.
          */}
          <View style={s.qrRow}>
            <View style={s.qrBlock}>
              <View style={s.qrSquare} />
              <Text style={s.qrLabel}>New here?</Text>
              <Text style={s.qrNote}>Scan to join the community.</Text>
            </View>
            <View style={s.qrBlock}>
              <View style={s.qrSquare} />
              <Text style={s.qrLabel}>Already a member?</Text>
              <Text style={s.qrNote}>Scan to add your part.</Text>
            </View>
          </View>
        </>
      }
    />
  );
}

export function StationCalledTarget() {
  return (
    <StationShell
      id="station-called"
      right={
        <View style={s.queuePanelTall}>
          <Text style={s.queueEyebrow}>Now serving</Text>
          {/*
            BEING CALLED IS WHAT MATTERS NOW, so the name is the biggest thing
            on the canvas — and the code beside it is how two people called
            Sam each know which one is theirs.
          */}
          <Text style={s.servingName}>Sam</Text>
          <Text style={s.servingCode}>H 4 K</Text>
          <Text style={s.servingSentence}>Sam, you’re up — come to Station 2.</Text>
          <Text style={s.queueCount}>3 people waiting.</Text>
        </View>
      }
    />
  );
}

export function StationRunningTarget() {
  return (
    <StationShell
      id="station-running"
      right={
        <View style={s.queuePanel}>
          <Text style={s.queueEyebrow}>Now serving</Text>
          {/*
            WHILE THEY ARE MOVING, THE MOVEMENT IS THE BIGGEST THING. The name
            shrinks: they already know the turn is theirs, and at attract size
            it pushed the clock and the count box off a canvas that cannot
            scroll.
          */}
          <Text style={s.servingNameRunning}>Sam · H 4 K</Text>
          <Text style={s.turnActivity}>Push-ups at the front</Text>
          <Text style={s.turnActivityUnit}>Counted in push-ups</Text>
          {/*
            TWO COLUMNS, and the reason is not taste. Stacked at this size the
            count box and "Record this turn" sat below the bottom edge of a
            canvas that does not scroll. Two columns spend the width that was
            going spare and halve the height.
          */}
          <View style={s.turnColumns}>
            <View style={s.player}>
              <Text style={s.playerClock}>0:38</Text>
              <Text style={s.playerCue}>Keep going</Text>
              <View style={s.playerTrack}>
                <View style={[s.playerBar, { width: '63%' }]} />
              </View>
            </View>
            <View style={s.recordBox}>
              <Text style={s.recordLabel}>How many?</Text>
              <View style={s.bigInput}>
                <Text style={s.bigInputValue}>30</Text>
              </View>
              <Primary label="Record this turn" />
              <Tertiary label="Cancel this turn" />
            </View>
          </View>
        </View>
      }
    />
  );
}

export function StationRecordedTarget() {
  return (
    <StationShell
      id="station-recorded"
      right={
        <View style={s.queuePanelTall}>
          <Text style={s.queueEyebrow}>Now serving</Text>
          {/*
            THE TEN SECONDS — A CODE AND A NUMBER, AND NO NAME.

            This frame exists to be checked against the one before it. The
            moment a turn is recorded, every name on this screen is gone. Ten
            seconds later so is this. Compare it with station-called and with
            station-cleared: the name appears on exactly one of the three.
          */}
          <Text style={s.resultSentence}>H 4 K · 30 push-ups recorded.</Text>
          <Text style={s.queueCount}>3 people waiting.</Text>
        </View>
      }
    />
  );
}

export function StationClearedTarget() {
  return (
    <StationShell
      id="station-cleared"
      right={
        <View style={s.queuePanelTall}>
          <Text style={s.queueEyebrow}>Now serving</Text>
          {/*
            TEN SECONDS LATER. Nothing of the previous participant is on this
            screen: not their name, not their code, not their number. The next
            person walks up to a screen that knows nothing about the last one.
          */}
          <Text style={s.queueEmpty}>Nobody is being called.</Text>
          <Text style={s.queueCount}>3 people waiting.</Text>
        </View>
      }
    />
  );
}

export function StationStaleTarget() {
  return (
    <StationShell
      id="station-stale"
      stale
      right={
        <View style={s.queuePanelTall}>
          <Text style={s.queueEyebrow}>Now serving</Text>
          <Text style={s.queueEmpty}>Reading the line…</Text>
          {/*
            THE TOTAL STAYS AND SAYS IT IS OLD. A number that vanishes when a
            poll fails reads, across a room, as a number that went away.
          */}
          <Text style={s.queueCount}>
            This is the last confirmed total. It may be out of date.
          </Text>
        </View>
      }
    />
  );
}

export function StationQueueErrorTarget() {
  return (
    <StationShell
      id="station-queue-error"
      right={
        <View style={s.queuePanelTall}>
          <Text style={s.queueEyebrow}>Now serving</Text>
          <Text style={s.queueEmpty}>Nobody is being called.</Text>
          {/*
            THE LINE FAILED; THE TOTAL DID NOT. They are separate reads and
            the screen says which one is in trouble rather than blanking both.
          */}
          <View style={s.errorBox}>
            <Text style={s.errorText}>
              We couldn’t read the line. The total beside this is still confirmed.
            </Text>
          </View>
        </View>
      }
    />
  );
}

/* ── styles ─────────────────────────────────────────────────────────────── */

const s = StyleSheet.create({
  canvas: {
    flex: 1,
    backgroundColor: NAVY,
    paddingHorizontal: 44,
    paddingVertical: 40,
    gap: 22,
    overflow: 'hidden',
  },
  canvasLandscape: { paddingHorizontal: 40, paddingVertical: 30, gap: 16 },

  texture: { ...StyleSheet.absoluteFillObject },
  band: {
    position: 'absolute',
    height: 62,
    width: 1400,
    backgroundColor: 'rgba(145,203,125,0.09)',
    transform: [{ rotate: '-18deg' }],
  },
  band1: { top: 40, left: 240 },
  band2: { top: 170, left: 330, backgroundColor: 'rgba(145,203,125,0.06)' },
  band3: { top: 300, left: 420, backgroundColor: 'rgba(145,203,125,0.045)' },
  glow: {
    position: 'absolute',
    right: -180,
    top: -220,
    width: 620,
    height: 620,
    borderRadius: 310,
    backgroundColor: 'rgba(34,197,94,0.10)',
  },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerRight: { alignItems: 'flex-end', gap: 4 },
  stationLabel: { color: PROGRESS_GREEN, fontSize: 20, fontWeight: '900', letterSpacing: 0.5 },
  freshness: { color: ON_NAVY_MUTED, fontSize: 16, fontWeight: '700' },

  /* the generic non-ready screen */
  genericBlock: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 },
  genericHeadline: {
    color: ON_NAVY,
    fontSize: 54,
    lineHeight: 60,
    fontWeight: '900',
    letterSpacing: -1.6,
    textAlign: 'center',
  },
  genericHeadlineLandscape: { fontSize: 48, lineHeight: 54 },
  genericBody: {
    color: ON_NAVY_MUTED,
    fontSize: 24,
    lineHeight: 33,
    textAlign: 'center',
    maxWidth: 680,
  },

  /* the kiosk */
  kioskHero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  community: { color: PROGRESS_GREEN, fontSize: 24, fontWeight: '900', letterSpacing: 1.6, textTransform: 'uppercase' },
  communitySmall: { color: PROGRESS_GREEN, fontSize: 17, fontWeight: '900', letterSpacing: 1.4, textTransform: 'uppercase' },
  goalTitle: {
    color: ON_NAVY,
    fontSize: 54,
    lineHeight: 60,
    fontWeight: '900',
    letterSpacing: -1.6,
    textAlign: 'center',
  },
  period: { color: ON_NAVY_MUTED, fontSize: 20, fontWeight: '700' },
  total: { color: CREAM, fontSize: 60, lineHeight: 68, fontWeight: '900', letterSpacing: -2, textAlign: 'center' },
  totalOf: { fontSize: 30, lineHeight: 38, fontWeight: '800', color: ON_NAVY_MUTED },
  percent: { color: PROGRESS_GREEN, fontSize: 24, fontWeight: '900' },
  status: { color: ON_NAVY_MUTED, fontSize: 21, fontWeight: '700' },
  statusClosed: { color: PROGRESS_GREEN },
  kioskActions: { alignItems: 'center', gap: 12 },
  caption: { color: ON_NAVY_MUTED, fontSize: 17, lineHeight: 24, textAlign: 'center', maxWidth: 640 },

  /* the Living WE at venue scale */
  weWrap: { alignItems: 'center', justifyContent: 'center' },

  primary: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: ACTION_GREEN,
    borderRadius: 20,
    minHeight: 64,
    paddingHorizontal: 34,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.action,
  },
  primaryBig: { minHeight: 84, paddingHorizontal: 54, borderRadius: 24 },
  primaryOff: { backgroundColor: '#CDE8D5', shadowOpacity: 0 },
  primaryText: { color: ON_ACTION, fontSize: 22, fontWeight: '900' },
  primaryTextBig: { fontSize: 30 },
  primaryTextOff: { color: '#6B8A76' },
  spinner: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: '#6B8A76',
    borderTopColor: 'transparent',
  },
  tertiary: {
    minHeight: 52,
    paddingHorizontal: 26,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(247,245,240,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tertiaryText: { color: ON_NAVY, fontSize: 18, fontWeight: '800' },

  /* kiosk contribution */
  entryBody: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  entryGoal: {
    color: ON_NAVY,
    fontSize: 40,
    lineHeight: 46,
    fontWeight: '900',
    letterSpacing: -1.2,
    textAlign: 'center',
    marginBottom: 14,
  },
  entryCard: {
    backgroundColor: SURFACE,
    borderRadius: 28,
    padding: 34,
    gap: 16,
    alignItems: 'center',
    width: '100%',
    maxWidth: 620,
    ...elevation.card,
  },
  entryCardTitle: { color: NAVY, fontSize: 32, lineHeight: 38, fontWeight: '900', textAlign: 'center' },
  entryCardBody: { color: INK_QUIET, fontSize: 19, lineHeight: 27, textAlign: 'center' },
  bigInput: {
    backgroundColor: CREAM,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: ACTION_GREEN_DEEP,
    minHeight: 96,
    minWidth: 220,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  bigInputValue: { color: NAVY, fontSize: 52, fontWeight: '900', letterSpacing: -1 },

  terminalBody: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  terminalEyebrow: { color: PROGRESS_GREEN, fontSize: 22, fontWeight: '900', letterSpacing: 2, textTransform: 'uppercase' },
  terminalHeadline: {
    color: CREAM,
    fontSize: 58,
    lineHeight: 64,
    fontWeight: '900',
    letterSpacing: -1.8,
    textAlign: 'center',
  },
  terminalBodyText: { color: ON_NAVY_MUTED, fontSize: 22, lineHeight: 30, textAlign: 'center', maxWidth: 640 },
  noticeBox: {
    backgroundColor: 'rgba(0,0,0,0.26)',
    borderLeftWidth: 5,
    borderLeftColor: ACTION_GREEN,
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 16,
    maxWidth: 640,
  },
  noticeText: { color: ON_NAVY, fontSize: 19, lineHeight: 27 },
  countdownRow: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  errorBox: {
    backgroundColor: 'rgba(0,0,0,0.26)',
    borderLeftWidth: 5,
    borderLeftColor: '#FF8A8A',
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  errorText: { color: '#FFC9C9', fontSize: 18, lineHeight: 25, fontWeight: '700', textAlign: 'center' },

  /* the station */
  pairingCode: {
    color: CREAM,
    fontSize: 96,
    lineHeight: 104,
    fontWeight: '900',
    letterSpacing: 16,
  },
  pairingInstructions: {
    color: ON_NAVY_MUTED,
    fontSize: 20,
    lineHeight: 28,
    textAlign: 'center',
    maxWidth: 720,
  },
  stationColumns: { flex: 1, flexDirection: 'row', gap: 34 },
  stationLeft: { flex: 4, minWidth: 0, justifyContent: 'center', gap: 10 },
  stationRight: { flex: 6, minWidth: 0, justifyContent: 'center', gap: 16 },
  stationGoal: { color: ON_NAVY, fontSize: 34, lineHeight: 40, fontWeight: '900', letterSpacing: -1 },
  stationTotal: { color: CREAM, fontSize: 40, lineHeight: 47, fontWeight: '900', letterSpacing: -1.2 },

  queuePanel: {
    backgroundColor: 'rgba(0,0,0,0.26)',
    borderRadius: 26,
    padding: 24,
    gap: 10,
  },
  queuePanelTall: {
    backgroundColor: 'rgba(0,0,0,0.26)',
    borderRadius: 26,
    padding: 30,
    gap: 12,
    flex: 1,
    justifyContent: 'center',
  },
  queueEyebrow: { color: PROGRESS_GREEN, fontSize: 17, fontWeight: '900', letterSpacing: 2, textTransform: 'uppercase' },
  servingName: { color: CREAM, fontSize: 96, lineHeight: 104, fontWeight: '900', letterSpacing: -3 },
  servingNameRunning: { color: ON_NAVY, fontSize: 26, fontWeight: '900', letterSpacing: 1 },
  servingCode: { color: PROGRESS_GREEN, fontSize: 46, lineHeight: 54, fontWeight: '900', letterSpacing: 10 },
  servingSentence: { color: ON_NAVY, fontSize: 24, lineHeight: 32, fontWeight: '700' },
  resultSentence: { color: CREAM, fontSize: 46, lineHeight: 54, fontWeight: '900', letterSpacing: -1 },
  queueEmpty: { color: ON_NAVY_MUTED, fontSize: 32, lineHeight: 40, fontWeight: '800' },
  queueCount: { color: ON_NAVY_MUTED, fontSize: 20, lineHeight: 28, fontWeight: '700' },

  turnActivity: { color: CREAM, fontSize: 26, fontWeight: '900' },
  turnActivityUnit: { color: ON_NAVY_MUTED, fontSize: 16, marginTop: -6 },
  turnColumns: { flexDirection: 'row', gap: 20, alignItems: 'stretch' },
  player: {
    flex: 1,
    minWidth: 0,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 20,
    padding: 20,
    gap: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerClock: { color: CREAM, fontSize: 58, lineHeight: 64, fontWeight: '900', letterSpacing: -1.5 },
  playerCue: { color: PROGRESS_GREEN, fontSize: 19, fontWeight: '800' },
  playerTrack: {
    height: 10,
    width: '100%',
    borderRadius: 999,
    backgroundColor: 'rgba(247,245,240,0.16)',
    overflow: 'hidden',
  },
  playerBar: { height: 10, borderRadius: 999, backgroundColor: ACTION_GREEN },
  recordBox: { flex: 1, minWidth: 0, gap: 10, alignItems: 'center', justifyContent: 'center' },
  recordLabel: { color: ON_NAVY, fontSize: 20, fontWeight: '800' },

  qrRow: { flexDirection: 'row', gap: 22 },
  qrBlock: {
    flex: 1,
    minWidth: 0,
    backgroundColor: 'rgba(0,0,0,0.26)',
    borderRadius: 22,
    padding: 20,
    gap: 8,
    alignItems: 'center',
  },
  /* The target draws the PLACE a QR goes, never a live one: a code rendered
     into committed evidence is a working link to somebody's community. */
  qrSquare: { width: 132, height: 132, borderRadius: 12, backgroundColor: 'rgba(247,245,240,0.22)' },
  qrLabel: { color: CREAM, fontSize: 20, fontWeight: '900' },
  qrNote: { color: ON_NAVY_MUTED, fontSize: 15, lineHeight: 21, textAlign: 'center' },
});
