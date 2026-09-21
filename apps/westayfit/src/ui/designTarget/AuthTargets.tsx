import { useState } from 'react';
import { type LayoutChangeEvent, ScrollView, StyleSheet, Text, View } from 'react-native';

import { WsfWordmark } from '../WsfWordmark';
import {
  ACTION_GREEN,
  ACTION_GREEN_DEEP,
  CREAM,
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
 * ATLAS BATCH A — IDENTITY AND ONBOARDING. TARGETS, NOT IMPLEMENTED PAGES.
 *
 * Eight surfaces: sign in, sign up, verify email, reset password, profile
 * setup, the credential error, and the two returns. Real React Native against
 * the real kit, rendered only by the gated preview route.
 *
 * NO FILLABLE LIVING WE ANYWHERE IN THIS BATCH. Its fill is a truthful
 * confirmed-progress instrument, and not one of these eight surfaces owns a
 * progress value -- most of them do not even have a community yet. Using it
 * decoratively here would make the product's one honest progress signal into
 * decoration everywhere else. The brand carries these screens through the
 * compact wordmark, the navy field, its motion texture, and the type.
 *
 * FOUR TONES, SO THE STATE READS BEFORE THE WORDS DO:
 *
 *   ordinary   navy field, green action. Sign in, sign up, reset.
 *   action     the field carries a step chip; the sheet leads with the thing
 *              to do. Verify email, profile setup.
 *   error      the field is unchanged -- a failed password does not re-brand
 *              the product -- and the sheet carries a banded message with
 *              BOTH honest forks as real controls, because Firebase collapses
 *              "no such user" and "wrong password" into one code.
 *   returning  the field carries the destination that is waiting, which is
 *              the entire point of the screen.
 *
 * WHAT THE RETURNS DO NOT CLAIM. A pending join code is opaque and a pending
 * event is a goal id; naming the community or the goal needs a read a
 * signed-out visitor may not be entitled to make. So the destination card
 * names the KIND of thing waiting and what will happen, which is true from
 * sessionStorage alone. If the implementation can resolve the name, it may
 * add it; the target does not promise what it cannot read.
 */

type Tone = 'ordinary' | 'action' | 'error' | 'returning';

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

function Field({
  tone,
  compact,
  step,
  frameHeight,
  children,
}: {
  tone: Tone;
  compact: boolean;
  step?: string;
  /** The measured frame, so the field can take a share of a TALL screen. */
  frameHeight: number;
  children: React.ReactNode;
}) {
  /*
    THE FIELD TAKES ITS SHARE OF THE SCREEN, RATHER THAN THE SCREEN LEAVING
    CREAM UNDER THE FORM. A sign-in form is three controls; on an 844 phone
    that is a quarter of the viewport, and the old shape left the rest empty
    -- the exact flatness the owner board moves away from. The brand field is
    real content, so it is what grows. On a short phone it does not: there the
    form needs every point it can get.
  */
  const minHeight = compact || frameHeight === 0 ? undefined : Math.round(frameHeight * 0.38);
  return (
    <View style={[s.field, compact ? s.fieldCompact : null, minHeight ? { minHeight } : null]}>
      <FieldTexture />
      <View style={s.fieldTop}>
        <WsfWordmark variant="white" height={compact ? 15 : 17} />
        {step ? (
          <View style={[s.stepChip, tone === 'action' ? s.stepChipAction : null]}>
            <Text style={[s.stepChipText, tone === 'action' ? s.stepChipTextAction : null]}>
              {step}
            </Text>
          </View>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** A form row. The target draws the field, never a live input. */
function FormField({
  label,
  value,
  hint,
  rule,
}: {
  label: string;
  value?: string;
  hint?: string;
  /** A requirement the product enforces, said before it is enforced. */
  rule?: string;
}) {
  return (
    <View style={s.formField}>
      <Text style={s.formLabel}>{label}</Text>
      <View style={s.input}>
        <Text style={value ? s.inputValue : s.inputPlaceholder}>{value ?? ''}</Text>
        {hint ? <Text style={s.inputHint}>{hint}</Text> : null}
      </View>
      {rule ? <Text style={s.formRule}>{rule}</Text> : null}
    </View>
  );
}

function Primary({ label, disabled }: { label: string; disabled?: boolean }) {
  return (
    <View style={[s.primary, disabled ? s.primaryOff : null]}>
      <Text style={[s.primaryText, disabled ? s.primaryTextOff : null]}>{label}</Text>
    </View>
  );
}

function Secondary({ label }: { label: string }) {
  return (
    <View style={s.secondary}>
      <Text style={s.secondaryText}>{label}</Text>
    </View>
  );
}

function Screen({
  id,
  tone,
  step,
  eyebrow,
  title,
  intro,
  destination,
  children,
  foot,
}: {
  id: string;
  tone: Tone;
  step?: string;
  eyebrow?: string;
  title: string;
  intro: string;
  destination?: { label: string; line: string; note: string };
  children: React.ReactNode;
  /**
   * The ways OUT of this screen. They sit at the foot rather than trailing
   * the primary action: on a tall phone that is where a thumb is, and it
   * stops the sheet ending in a column of links with empty cream under it.
   */
  foot?: React.ReactNode;
}) {
  const { box, onLayout, compact } = useBox();
  return (
    <View style={s.screen} onLayout={onLayout} testID={`wsf-target-auth-${id}`}>
      <ScrollView contentContainerStyle={s.body}>
        <Field tone={tone} compact={compact} step={step} frameHeight={box?.height ?? 0}>
          {eyebrow ? <Text style={s.fieldEyebrow}>{eyebrow}</Text> : null}
          <Text style={[compact ? display.md : display.lg, s.fieldTitle]}>{title}</Text>
          <Text style={s.fieldIntro}>{intro}</Text>
          {destination ? (
            <View style={s.destination}>
              <Text style={s.destinationLabel}>{destination.label}</Text>
              <Text style={s.destinationLine}>{destination.line}</Text>
              <Text style={s.destinationNote}>{destination.note}</Text>
            </View>
          ) : null}
        </Field>
        <View style={[s.sheet, compact ? s.sheetCompact : null]}>
          {children}
          {foot ? (
            <>
              <View style={s.spacer} />
              <View style={s.foot}>{foot}</View>
            </>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

/* ── 1 · sign in ────────────────────────────────────────────────────────── */

export function SignInTarget() {
  return (
    <Screen
      id="signin"
      tone="ordinary"
      title="Welcome back."
      intro="Sign in to your community."
      foot={
        <>
          <Secondary label="Forgot your password?" />
          <Secondary label="New here? Create an account" />
        </>
      }
    >
      <FormField label="Email" value="devin@example.com" />
      <FormField label="Password" value="••••••••••" hint="Show" />
      <Primary label="Sign in" />
    </Screen>
  );
}

/* ── 2 · sign up ────────────────────────────────────────────────────────── */

export function SignUpTarget() {
  return (
    <Screen
      id="signup"
      tone="ordinary"
      step="Step 1 of 3"
      title="Start moving together."
      intro="We will send a verification email before you can join a community."
      foot={<Secondary label="Already have an account? Sign in" />}
    >
      <FormField label="Display name" value="Devin" />
      <FormField label="Email" value="devin@example.com" />
      {/*
        THE RULE IS STATED WHERE IT IS OBEYED, not discovered at submit.
        `canSubmit` requires `password.length >= 8` and the shipped field
        carries "At least 8 characters" as a hint. The earlier frame drew a
        password field with no rule at all, which made the requirement a
        surprise at the moment somebody is already committed.
      */}
      <FormField label="Password" value="••••••••••" hint="Show" rule="At least 8 characters" />
      <Primary label="Create account" />
    </Screen>
  );
}

/* ── 3 · verify email — all five send outcomes ──────────────────────────── */

/**
 * THE PRODUCT DISTINGUISHES FIVE OUTCOMES AND SO DOES THE TARGET.
 *
 * `INTRO` in app/verify-email.tsx keys the intro sentence off
 * `VerificationSendOutcome`, and the earlier frame drew only "We sent…" — an
 * outcome the screen may not have. Four of the five say something materially
 * different about what to do next, and one of them says nothing can be done
 * at all.
 *
 * `unconfigured` is the one that matters most and the one a drawing is most
 * likely to omit: on a build with email switched off, nobody can finish
 * verifying, and the screen says so plainly rather than inviting somebody to
 * keep tapping Resend. The shipped copy is a full second sentence and the
 * target carries it whole.
 */
function VerifyScreen({
  id,
  step,
  eyebrow,
  intro,
  notice,
  destination,
}: {
  id: string;
  step?: string;
  eyebrow?: string;
  intro: string;
  notice?: string;
  destination?: { label: string; line: string; note: string };
}) {
  return (
    <Screen
      id={id}
      tone="action"
      step={step ?? 'Step 2 of 3'}
      eyebrow={eyebrow ?? 'One thing to do'}
      title="Check your email."
      intro={intro}
      destination={destination}
      foot={
        <>
          <Text style={s.footNote}>Signed in as devin@example.com</Text>
          <Secondary label="Sign out" />
        </>
      }
    >
      {notice ? (
        <View style={s.noticePanel}>
          <Text style={s.noticeText}>{notice}</Text>
        </View>
      ) : null}
      <Primary label="I have verified" />
      <Secondary label="Resend verification email" />
      <View style={s.help}>
        <Text style={s.helpTitle}>No email yet?</Text>
        <Text style={s.helpBody}>
          Check spam, and confirm the address above is the one you meant. Resending sends a new
          link to the same address.
        </Text>
      </View>
    </Screen>
  );
}

/** `sent` — the ordinary outcome. */
export function VerifyEmailTarget() {
  return (
    <VerifyScreen
      id="verify"
      intro="We sent a verification link to devin@example.com. Confirm it, then tap I have verified."
    />
  );
}

/** `sending` — in flight. The screen does not yet claim anything arrived. */
export function VerifySendingTarget() {
  return (
    <VerifyScreen
      id="verify-sending"
      intro="Sending a verification link to devin@example.com. Confirm it, then tap I have verified."
    />
  );
}

/** `already-verified` — nothing to wait for; the way on is the only control. */
export function VerifyAlreadyTarget() {
  return (
    <VerifyScreen
      id="verify-already"
      eyebrow="Nothing to wait for"
      intro="devin@example.com is already verified. Tap I have verified to continue."
    />
  );
}

/** `unconfigured` — the build cannot send at all, and says so. */
export function VerifyUnconfiguredTarget() {
  return (
    <VerifyScreen
      id="verify-unconfigured"
      eyebrow="Not possible here"
      intro="Email isn't switched on for this test build, so no verification link can be sent to devin@example.com yet."
      notice="Email isn't switched on for this test build yet, so no message was sent. Nobody can finish verifying a new account here until it is switched on. Sign out to use an account that is already verified."
    />
  );
}

/** `failed` — the send failed, and Resend is the named way out. */
export function VerifyFailedTarget() {
  return (
    <VerifyScreen
      id="verify-failed"
      eyebrow="Didn’t send"
      intro="We could not send a verification link to devin@example.com. Tap Resend to try again."
    />
  );
}

/**
 * THE DESTINATION SURVIVES THIS GATE TOO — debt 4.
 *
 * `nextRouteAfterAuth` is read at signup, at verify-email AND at
 * profile-setup, so a pending destination outlives all three. Batch A drew
 * only the sign-in hop, which left the same waiting thing unexplained on two
 * further screens where somebody is most likely to wonder whether it is lost.
 *
 * It still names only the KIND of thing waiting: a pending join code is
 * opaque and a private community's name is not something a half-authorized
 * account is entitled to read.
 */
export function VerifyCarryingTarget() {
  return (
    <VerifyScreen
      id="verify-carrying"
      intro="We sent a verification link to devin@example.com. Confirm it, then tap I have verified."
      destination={{
        label: 'Still waiting for you',
        line: 'An invitation to a community',
        note: 'It survives this step and the next one. You will land on it, not on home.',
      }}
    />
  );
}

/* ── 4 · reset password ─────────────────────────────────────────────────── */

export function ResetPasswordTarget() {
  return (
    <Screen
      id="reset"
      tone="ordinary"
      title="Set a new password."
      intro="Enter your email and we will send a link to set a new one."
      foot={<Secondary label="Back to sign in" />}
    >
      <FormField label="Email" value="devin@example.com" />
      <Primary label="Send reset link" />
      {/*
        ENUMERATION SAFETY IS A DESIGN CONSTRAINT, NOT A DETAIL. The product
        cannot say whether that address has an account, so the target never
        draws a state that would imply it. This is the shipped wording.
      */}
      <View style={s.help}>
        <Text style={s.helpTitle}>What happens next</Text>
        <Text style={s.helpBody}>
          If an account exists for that email, a reset link is on its way. Check your inbox and
          spam.
        </Text>
      </View>
    </Screen>
  );
}

/* ── 4b · reset password — the two outcomes it actually has ─────────────── */

/**
 * The shipped screen has two states past submit, and they are not the same
 * news. `sent` keeps the enumeration-safe sentence and disables the field;
 * `unconfigured` says the build cannot send at all, so waiting for an email
 * is waiting for nothing.
 */
export function ResetSentTarget() {
  return (
    <Screen
      id="reset-sent"
      tone="ordinary"
      title="Set a new password."
      intro="Enter your email and we will send a link to set a new one."
      foot={<Secondary label="Back to sign in" />}
    >
      <FormField label="Email" value="devin@example.com" />
      <View style={s.noticePanel}>
        <Text style={s.noticeText}>
          If an account exists for that email, a reset link is on its way. Check your inbox and
          spam.
        </Text>
      </View>
      <Secondary label="Back to sign in" />
    </Screen>
  );
}

export function ResetUnconfiguredTarget() {
  return (
    <Screen
      id="reset-unconfigured"
      tone="error"
      title="Set a new password."
      intro="Enter your email and we will send a link to set a new one."
      foot={<Secondary label="Back to sign in" />}
    >
      <FormField label="Email" value="devin@example.com" />
      <View style={s.errorPanel}>
        <Text style={s.errorLabel}>Nothing was sent</Text>
        <Text style={s.errorBody}>
          Email isn't switched on for this test build yet, so no reset link was sent.
        </Text>
      </View>
      <Primary label="Send reset link" disabled />
    </Screen>
  );
}

/* ── 5 · profile setup — action required ────────────────────────────────── */

export function ProfileSetupTarget() {
  return (
    <Screen
      id="profile"
      tone="action"
      step="Step 3 of 3"
      eyebrow="Last step"
      title="What should we call you?"
      intro="One step before you can start or join a community."
      foot={
        <>
          <Text style={s.footNote}>Signed in as devin@example.com</Text>
          <Secondary label="Sign out" />
        </>
      }
    >
      <FormField label="Display name" value="Devin" />
      {/*
        CONSENT IS DRAWN UNCHECKED, AND THAT IS THE POINT.

        `acceptedTerms` starts false and `canSubmit` requires it, so the
        shipped screen cannot be submitted until a person ticks this
        themselves. The earlier frame drew the box already ticked — a picture
        of consent as a thing the product had arranged rather than a thing
        somebody gave, which is the one defect in this batch that was a truth
        problem rather than a coverage gap.

        The sentence and both policy links are the shipped ones, and the
        primary is drawn disabled because at this moment it is.
      */}
      <View style={s.terms}>
        <View style={s.checkboxEmpty} />
        <Text style={s.termsText}>
          By saving I confirm I am 13 or older and accept the{' '}
          <Text style={s.termsLink}>Terms of Service</Text> and{' '}
          <Text style={s.termsLink}>Privacy Policy</Text>.
        </Text>
      </View>
      <Primary label="Save profile" disabled />
    </Screen>
  );
}

/* ── 6 · the credential error ───────────────────────────────────────────── */

export function AuthErrorTarget() {
  return (
    <Screen
      id="error"
      tone="error"
      title="Welcome back."
      intro="Sign in to your community."
    >
      <FormField label="Email" value="devin@example.com" />
      <FormField label="Password" value="••••••••••" hint="Show" />
      {/*
        ONE CODE, TWO HONEST FORKS. Firebase's enumeration protection collapses
        "no such user" and "wrong password" into a single error, so the screen
        cannot say which happened. Both ways out are real controls rather than
        links buried in a paragraph -- that dead end is what this state exists
        to fix.
      */}
      <View style={s.errorPanel}>
        <Text style={s.errorLabel}>Not signed in</Text>
        <Text style={s.errorBody}>
          That email and password do not match an account. It may be a different address, or a
          different password.
        </Text>
      </View>
      <Primary label="Sign in" />
      <View style={s.forkRow}>
        <View style={s.fork}>
          <Text style={s.forkText}>Reset password</Text>
        </View>
        <View style={s.fork}>
          <Text style={s.forkText}>Create account</Text>
        </View>
      </View>
    </Screen>
  );
}

/* ── 7 · returning to a join ────────────────────────────────────────────── */

export function ReturnToJoinTarget() {
  return (
    <Screen
      id="return-join"
      tone="returning"
      title="Welcome back."
      intro="Sign in and we will take you straight back to the invitation."
      destination={{
        label: 'Waiting for you',
        line: 'An invitation to a community',
        note: 'You opened an invitation before signing in. It is still here.',
      }}
      foot={<Secondary label="New here? Create an account" />}
    >
      <FormField label="Email" value="devin@example.com" />
      <FormField label="Password" value="••••••••••" hint="Show" />
      <Primary label="Sign in and continue" />
    </Screen>
  );
}

/* ── 8 · returning to an event ──────────────────────────────────────────── */

export function ReturnToEventTarget() {
  return (
    <Screen
      id="return-event"
      tone="returning"
      title="Nearly there."
      intro="Sign in and we will take you straight back to the event you scanned."
      destination={{
        label: 'Waiting for you',
        line: 'The event you scanned',
        note: 'You scanned a code before signing in. You will land back on it, not on home.',
      }}
      foot={<Secondary label="New here? Create an account" />}
    >
      <FormField label="Email" value="devin@example.com" />
      <FormField label="Password" value="••••••••••" hint="Show" />
      <Primary label="Sign in and continue" />
    </Screen>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CREAM },
  body: { flexGrow: 1 },

  /* the navy field */
  field: {
    backgroundColor: NAVY,
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 34,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    gap: 7,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    ...elevation.hero,
  },
  fieldCompact: { paddingTop: 16, paddingBottom: 22, gap: 5 },
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
  stepChip: {
    backgroundColor: 'rgba(247,245,240,0.12)',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  stepChipAction: { backgroundColor: 'rgba(145,203,125,0.18)' },
  stepChipText: { color: ON_NAVY_MUTED, fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  stepChipTextAction: { color: PROGRESS_GREEN },
  fieldEyebrow: {
    color: PROGRESS_GREEN,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  fieldTitle: { color: ON_NAVY },
  fieldIntro: { color: ON_NAVY_MUTED, fontSize: 13.5, lineHeight: 19 },

  /* the destination a return is carrying */
  destination: {
    marginTop: 12,
    backgroundColor: 'rgba(0,0,0,0.24)',
    borderRadius: 16,
    borderLeftWidth: 4,
    borderLeftColor: ACTION_GREEN,
    paddingHorizontal: 13,
    paddingVertical: 11,
    gap: 3,
  },
  destinationLabel: {
    color: PROGRESS_GREEN,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  destinationLine: { color: ON_NAVY, fontSize: 16, lineHeight: 21, fontWeight: '900' },
  destinationNote: { color: ON_NAVY_MUTED, fontSize: 11.5, lineHeight: 16 },

  /* the cream sheet that carries the form */
  sheet: { flex: 1, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24, gap: 12 },
  spacer: { flex: 1, minHeight: 10 },
  foot: { gap: 2, borderTopWidth: 1, borderTopColor: HAIRLINE, paddingTop: 8 },
  sheetCompact: { paddingTop: 14, gap: 9 },

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
  inputValue: { color: NAVY, fontSize: 16, fontWeight: '600' },
  inputPlaceholder: { color: INK_QUIET, fontSize: 16 },
  inputHint: { color: ACTION_GREEN_DEEP, fontSize: 13, fontWeight: '800' },
  /** A requirement the product enforces, said before it is enforced. */
  formRule: { color: INK_QUIET, fontSize: 11.5, lineHeight: 16 },

  primary: {
    backgroundColor: ACTION_GREEN,
    borderRadius: 16,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    ...elevation.action,
  },
  primaryOff: { backgroundColor: '#CDE8D5' },
  primaryText: { color: ON_ACTION, fontSize: 17, fontWeight: '900' },
  primaryTextOff: { color: '#6B8A76' },
  secondary: { minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: NAVY, fontSize: 14, fontWeight: '800' },
  footNote: { color: INK_QUIET, fontSize: 12, textAlign: 'center', marginTop: 2 },

  /* what to do when the obvious thing did not work */
  help: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    padding: 14,
    gap: 4,
    ...elevation.card,
  },
  /* A true statement about what did or did not happen — neither an error nor
     an invitation to keep tapping. */
  noticePanel: {
    backgroundColor: '#EEF2F6',
    borderRadius: 14,
    borderLeftWidth: 4,
    borderLeftColor: INK_QUIET,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  noticeText: { color: NAVY, fontSize: 13, lineHeight: 19 },
  helpTitle: { color: NAVY, fontSize: 14, fontWeight: '900' },
  helpBody: { color: INK_QUIET, fontSize: 12.5, lineHeight: 18 },

  terms: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 2 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    backgroundColor: ACTION_GREEN_DEEP,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: { color: '#FFFFFF', fontSize: 13, lineHeight: 16, fontWeight: '900' },
  /** The gate before anybody has given it: an empty box, not a ticked one. */
  checkboxEmpty: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#B9C4CF',
    backgroundColor: SURFACE,
  },
  termsText: { flex: 1, color: INK_QUIET, fontSize: 12.5, lineHeight: 18 },
  termsLink: { color: ACTION_GREEN_DEEP, fontWeight: '800', textDecorationLine: 'underline' },

  errorPanel: {
    backgroundColor: '#FDECEC',
    borderRadius: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#C0392B',
    paddingHorizontal: 13,
    paddingVertical: 11,
    gap: 3,
  },
  errorLabel: {
    color: '#8E2B20',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  errorBody: { color: '#7A2A21', fontSize: 13, lineHeight: 18 },
  forkRow: { flexDirection: 'row', gap: 10 },
  fork: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: HAIRLINE,
    backgroundColor: SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  forkText: { color: NAVY, fontSize: 14, fontWeight: '800' },
});

/* ── 9 · the profile gate, still carrying ───────────────────────────────── */

/**
 * The last of the three gates `nextRouteAfterAuth` is read at. Same rule as
 * the verify frame: the KIND of thing waiting, never its name.
 */
export function ProfileCarryingTarget() {
  return (
    <Screen
      id="profile-carrying"
      tone="action"
      step="Step 3 of 3"
      eyebrow="Last step"
      title="What should we call you?"
      intro="One step before you can start or join a community."
      destination={{
        label: 'Still waiting for you',
        line: 'An invitation to a community',
        note: 'This is the last step before it opens.',
      }}
      foot={
        <>
          <Text style={s.footNote}>Signed in as devin@example.com</Text>
          <Secondary label="Sign out" />
        </>
      }
    >
      <FormField label="Display name" value="Devin" />
      <View style={s.terms}>
        <View style={s.checkboxEmpty} />
        <Text style={s.termsText}>
          By saving I confirm I am 13 or older and accept the{' '}
          <Text style={s.termsLink}>Terms of Service</Text> and{' '}
          <Text style={s.termsLink}>Privacy Policy</Text>.
        </Text>
      </View>
      <Primary label="Save profile" disabled />
    </Screen>
  );
}

/* ── 10 · returning to a kiosk ──────────────────────────────────────────── */

/**
 * THE THIRD DESTINATION KIND, which Batch A never drew.
 *
 * `nextRouteAfterAuth` resolves three: a pending join code, an event return
 * and a KIOSK return (`readKioskReturnGoal` -> `kioskContributeRoute`). The
 * kiosk one is the one where the wording matters most, because the person is
 * standing at a shared device and the thing they most need to know is that
 * signing in here does not leave them signed in on it.
 */
export function ReturnToKioskTarget() {
  return (
    <Screen
      id="return-kiosk"
      tone="returning"
      title="Nearly there."
      intro="Sign in and we will take you straight back to the screen you started at."
      destination={{
        label: 'Waiting for you',
        line: 'The screen you started at',
        note: 'You will land back on it to enter your count. Finishing signs you out of this device.',
      }}
      foot={<Secondary label="New here? Create an account" />}
    >
      <FormField label="Email" value="devin@example.com" />
      <FormField label="Password" value="••••••••••" hint="Show" />
      <Primary label="Sign in and continue" />
    </Screen>
  );
}
