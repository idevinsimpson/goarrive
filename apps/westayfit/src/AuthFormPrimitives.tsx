import { forwardRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';

import { ButtonLink } from './ui/ButtonLink';
import {
  ACTION_GREEN,
  ACTION_GREEN_DEEP,
  CREAM,
  HAIRLINE,
  INK_QUIET,
  NAVY,
  ON_NAVY,
  ON_NAVY_MUTED,
  PROGRESS_GREEN,
  SURFACE,
  display,
  elevation,
  kit,
} from './ui/kit';
import { WsfWordmark } from './ui/WsfWordmark';

/**
 * THE IDENTITY ENTRY FUNNEL, BUILT TO THE ACCEPTED BATCH A TARGET.
 *
 * Every one of the five identity routes renders through `FormShell`, so the
 * visual reset is this one composition rather than five parallel rewrites:
 * a navy field carrying the wordmark, the heading and whatever destination is
 * waiting, over a cream sheet carrying the form.
 *
 * NO LIVING WE ON ANY OF THESE SCREENS, and that is a rule rather than an
 * omission. Its fill is the product's one truthful confirmed-progress
 * instrument, and not one of these surfaces owns a progress value — most of
 * them do not have a community yet. Using it decoratively here would make the
 * honest signal decorative everywhere else. The brand carries through the
 * wordmark, the navy field, its motion texture and the type.
 *
 * FOUR TONES, SO THE STATE READS BEFORE THE WORDS DO:
 *
 *   ordinary   navy field, green action. Sign in, sign up, reset.
 *   action     the field carries a step chip. Verify email, profile setup.
 *   error      the field is UNCHANGED — a failed password does not re-brand
 *              the product — and the sheet carries the banded message.
 *   returning  the field carries the destination that is waiting, which is
 *              the entire point of the screen.
 */
export type AuthTone = 'ordinary' | 'action' | 'error' | 'returning';

/**
 * A destination a return is carrying.
 *
 * WHAT THIS MUST NOT CLAIM. A pending join code is opaque and a pending event
 * is a goal id; naming the community or the goal needs a read a signed-out
 * visitor may not be entitled to make. So it names the KIND of thing waiting
 * and what will happen, which is true from session storage alone.
 */
export type AuthDestination = { label: string; line: string; note: string };

/** Measures the frame so the field can take a share of a TALL screen only. */
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

/**
 * The diagonal bands are the wordmark's own slash, enlarged. Not a gradient.
 *
 * EVERY BOX HERE FITS INSIDE THE FIELD, and that is not cosmetic. The first
 * version drew each band as a 420 pt rectangle rotated about its own centre
 * and let the field's `overflow: hidden` clip the tail. Clipping hides the
 * paint but not the layout: `getBoundingClientRect().right` still reported
 * ~534-614 on a 390 pt phone, so three decorations sat past the right edge of
 * the screen and the project's own R1 rule caught them on every route that
 * renders this shell — `/start-community` included, which no visual work had
 * touched.
 *
 * So the geometry is anchored instead of clipped. Each band rotates about its
 * LEFT edge, which is the end that is actually visible, and its length is
 * measured to reach the field's right edge and stop there. The painted stripe
 * starts at the same point, runs at the same angle and ends at the same edge;
 * what is gone is the invisible tail that was hanging off the viewport.
 *
 * `width` is the measured frame. Before the first layout it is 0, so the
 * bands have no length and nothing is drawn past anything.
 */
const BAND_ANGLE_COS = 0.95106; // cos 18°
const BAND_ANGLE_SIN = 0.30902; // sin 18°
const BAND_HEIGHT = 26;
/** Where each band's visible end sits, and how far its box may reach. */
const BAND_STARTS = [
  { left: 130, top: 71 },
  { left: 170, top: 117 },
  { left: 210, top: 163 },
];
const BAND_EDGE_INSET = 4;

function bandLength(frameWidth: number, left: number): number {
  const reach =
    frameWidth - BAND_EDGE_INSET - left - (BAND_HEIGHT / 2) * BAND_ANGLE_SIN;
  return Math.max(0, reach / BAND_ANGLE_COS);
}

function FieldTexture({ width }: { width: number }) {
  return (
    <View pointerEvents="none" style={shell.texture}>
      {BAND_STARTS.map((start, i) => (
        <View
          key={start.left}
          style={[
            shell.band,
            i === 1 ? shell.band2 : i === 2 ? shell.band3 : null,
            { left: start.left, top: start.top, width: bandLength(width, start.left) },
          ]}
        />
      ))}
      {/* The glow is anchored to the right edge for the same reason: a circle
          hanging off the corner laid out past the screen. */}
      <View style={shell.glow} />
    </View>
  );
}

/**
 * The form page: a navy field over a cream sheet, built to the accepted
 * Batch A target. Replaces the cream card-on-cream page, whose form of three
 * controls left most of a tall phone empty — the flatness the owner board
 * moves away from.
 *
 * It scrolls, so long content (profile setup with both legal panels open) is
 * never clipped.
 *
 * `testID` stays on a visible element, exactly where the old shell carried it,
 * so no existing selector moves.
 */
export function FormShell({
  eyebrow,
  heading,
  meta,
  metaTestID,
  intro,
  introTestID,
  children,
  testID,
  tone = 'ordinary',
  step,
  destination,
  foot,
}: {
  eyebrow?: string;
  heading: string;
  /**
   * A short fact under the heading — the invitation surface uses it for the
   * community's type, which sits between its name and what joining means.
   */
  meta?: string;
  /** A handle on that fact. `/join` keeps `wsf-join-meta` here, where the
   *  pre-rebuild screen carried it, so no existing selector moves. */
  metaTestID?: string;
  intro?: string;
  /** A handle on the intro line. `/join` puts `wsf-join-conditions` here: the
   *  joining conditions are a property worth asserting on their own. */
  introTestID?: string;
  children: ReactNode;
  testID: string;
  tone?: AuthTone;
  /** A step chip in the field, for the gates a member passes through. */
  step?: string;
  destination?: AuthDestination;
  /**
   * The ways OUT of this screen. They sit at the foot rather than trailing the
   * primary action: on a tall phone that is where a thumb is, and it stops the
   * sheet ending in a column of links with empty cream under it.
   */
  foot?: ReactNode;
}) {
  const { box, onLayout, compact } = useBox();
  /*
    THE FIELD TAKES ITS SHARE OF A TALL SCREEN, rather than the screen leaving
    cream under the form. The brand field is real content, so it is what grows.
    On a short phone it does not: there the form needs every point it can get,
    which is what keeps 390x640 reachable.
  */
  const fieldMinHeight =
    compact || !box ? undefined : Math.round(box.height * 0.38);
  return (
    /*
      `testID` SITS ON THE WHOLE SCREEN, not on the sheet.

      The old shell carried it on the column that held the chrome, the title
      block AND the card, so `getByTestId('wsf-verify')` contained the outcome
      sentence. This composition moves that sentence into the navy field, so a
      testID on the sheet alone would silently stop containing the very text
      that states the screen's state — which is what three verify specs read.
    */
    <View style={shell.screen} onLayout={onLayout} testID={testID}>
      <ScrollView
        style={kit.scroll}
        contentContainerStyle={shell.body}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            shell.field,
            compact ? shell.fieldCompact : null,
            fieldMinHeight ? { minHeight: fieldMinHeight } : null,
          ]}
        >
          <FieldTexture width={box?.width ?? 0} />
          <View style={shell.fieldTop}>
            <WsfWordmark
              variant="white"
              height={compact ? 15 : 17}
              testID="wsf-form-wordmark"
            />
            {step ? (
              <View
                style={[shell.stepChip, tone === 'action' ? shell.stepChipAction : null]}
                testID="wsf-form-step"
              >
                <Text
                  style={[
                    shell.stepChipText,
                    tone === 'action' ? shell.stepChipTextAction : null,
                  ]}
                >
                  {step}
                </Text>
              </View>
            ) : null}
          </View>
          {eyebrow ? <Text style={shell.fieldEyebrow}>{eyebrow}</Text> : null}
          <Text style={[compact ? display.md : display.lg, shell.fieldTitle]}>{heading}</Text>
          {meta ? (
            <Text style={shell.fieldMeta} testID={metaTestID}>
              {meta}
            </Text>
          ) : null}
          {intro ? (
            <Text style={shell.fieldIntro} testID={introTestID}>
              {intro}
            </Text>
          ) : null}
          {destination ? (
            <View style={shell.destination} testID="wsf-form-destination">
              <Text style={shell.destinationLabel}>{destination.label}</Text>
              <Text style={shell.destinationLine}>{destination.line}</Text>
              <Text style={shell.destinationNote}>{destination.note}</Text>
            </View>
          ) : null}
        </View>
        <View style={[shell.sheet, compact ? shell.sheetCompact : null]}>
          {children}
          {foot ? (
            <>
              <View style={shell.spacer} />
              <View style={shell.foot}>{foot}</View>
            </>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const shell = StyleSheet.create({
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
    height: BAND_HEIGHT,
    backgroundColor: 'rgba(145,203,125,0.10)',
    // Rotating about the LEFT edge is what lets the length be trimmed to the
    // field without moving the stripe that is actually seen.
    transformOrigin: 'left center',
    transform: [{ rotate: '-18deg' }],
  },
  band2: { backgroundColor: 'rgba(145,203,125,0.07)' },
  band3: { backgroundColor: 'rgba(145,203,125,0.05)' },
  /*
    The glow keeps the corner it always hugged, at a diameter that fits.

    It used to be a 230 pt disc pushed 70 pt off the right edge, so its box
    reached x = width + 70 — the fourth element R1 caught. Anchored at the
    edge instead, its left extent is what has to match, and 160 pt reaches the
    same point the old arc did: the silhouette in the corner is the same
    shape, at one tenth alpha, with nothing hanging off the screen.
  */
  glow: {
    position: 'absolute',
    right: 0,
    top: -55,
    width: 160,
    height: 160,
    borderRadius: 80,
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
  /*
    PALE, NOT GREEN. The accepted invitation target sets the community's type
    in the field's own near-white ink and keeps the green for the eyebrow
    above it. Two green lines in the same block competed with each other and
    with the heading between them.

    `meta` is rendered by the join surface alone, so this colour reaches no
    Batch A screen.
  */
  fieldMeta: { color: ON_NAVY, fontSize: 12.5, fontWeight: '800' },
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
  sheetCompact: { paddingTop: 14, gap: 9 },
  spacer: { flex: 1, minHeight: 10 },
  foot: { gap: 2, borderTopWidth: 1, borderTopColor: HAIRLINE, paddingTop: 8 },
});

/**
 * THE QUIET PAGE: what a link that did not open looks like.
 *
 * A DELIBERATELY DIFFERENT COMPOSITION FROM `FormShell`, and the accepted
 * Batch B target is explicit about it. A refusal gets the cream ground, the
 * navy wordmark and a single white card carrying the sentence — no navy
 * field, no step chip, no eyebrow. The navy field is the product presenting
 * itself, and a dead link is not an occasion for the product to present
 * itself; putting the brand hero above "This link is not valid." dresses up a
 * dead end.
 *
 * It is a separate export rather than a fifth `AuthTone` so that no identity
 * route can reach it by accident: the five Batch A screens keep the field in
 * every tone they have, `error` included, exactly as they were accepted.
 */
export function QuietShell({
  heading,
  body,
  bodyTestID,
  children,
  testID,
  foot,
}: {
  heading: string;
  /** The sentence under the heading, inside the same card. */
  body: string;
  /**
   * A handle on that sentence. The refusals use it: what these screens say —
   * and specifically what they decline to say about WHICH refusal it is — is
   * a privacy property, and a test that can read the sentence can guard it.
   */
  bodyTestID?: string;
  /** Anything that follows the card — the way on, where there is one. */
  children?: ReactNode;
  testID: string;
  foot?: ReactNode;
}) {
  const { onLayout, compact } = useBox();
  return (
    <View style={quiet.screen} onLayout={onLayout} testID={testID}>
      <ScrollView
        style={kit.scroll}
        contentContainerStyle={quiet.body}
        keyboardShouldPersistTaps="handled"
      >
        <View style={quiet.chrome}>
          <WsfWordmark variant="navy" height={compact ? 18 : 21} testID="wsf-form-wordmark" />
        </View>
        <View style={quiet.card}>
          <Text style={[compact ? display.md : display.lg, quiet.cardTitle]}>{heading}</Text>
          <Text style={quiet.cardBody} testID={bodyTestID}>
            {body}
          </Text>
        </View>
        {children}
        <View style={shell.spacer} />
        {foot ? <View style={shell.foot}>{foot}</View> : null}
      </ScrollView>
    </View>
  );
}

const quiet = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CREAM },
  body: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 24, gap: 14 },
  chrome: { alignItems: 'flex-start' },
  card: {
    backgroundColor: SURFACE,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 22,
    gap: 10,
    ...elevation.card,
  },
  cardTitle: { color: NAVY },
  cardBody: { color: INK_QUIET, fontSize: 15, lineHeight: 22 },
});

export function FieldLabel({ children }: { children: ReactNode }) {
  return <Text style={field.label}>{children}</Text>;
}

// forwardRef so the parent can hold a ref to the underlying TextInput and
// call .focus() on it — email `returnKeyType="next"` needs to focus the
// password field, and the password field needs to submit on `returnKeyType="go"`
// via onSubmitEditing (which react-native-web forwards from Enter).
export const TextField = forwardRef<TextInput, TextInputProps>(function TextField(
  props,
  ref
) {
  return (
    <TextInput
      ref={ref}
      {...props}
      placeholderTextColor={INK_QUIET}
      style={[field.input, props.style]}
    />
  );
});

/**
 * Password input with an inline Show/Hide toggle. The toggle is text, not an
 * eye icon, so it renders in a form with no icon font and reads correctly to
 * a screen reader without an aria-label workaround. State is component-local
 * — never persisted — so the field defaults to obscured on every mount, and
 * a returning session cannot leak a previous reveal.
 *
 * The caller supplies the input's testID (wsf-signin-password /
 * wsf-signup-password); the toggle carries wsf-password-toggle so the e2e
 * spec can flip it without a per-screen selector.
 */
export const PasswordField = forwardRef<
  TextInput,
  Omit<TextInputProps, 'secureTextEntry'>
>(function PasswordField(props, ref) {
  const [hidden, setHidden] = useState(true);
  return (
    <View style={styles.passwordRow}>
      <TextInput
        ref={ref}
        {...props}
        secureTextEntry={hidden}
        // When the toggle reveals the password, iOS will otherwise autocorrect,
        // spell-check, and title-case the plaintext — silently corrupting what
        // was typed. Lock these off at the primitive so no caller can forget.
        autoCorrect={false}
        spellCheck={false}
        autoCapitalize="none"
        placeholderTextColor={INK_QUIET}
        style={[field.input, styles.passwordInput, props.style]}
      />
      <Pressable
        onPress={() => setHidden((h) => !h)}
        style={styles.passwordToggle}
        testID="wsf-password-toggle"
        accessibilityRole="button"
        accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
      >
        <Text style={styles.passwordToggleText}>{hidden ? 'Show' : 'Hide'}</Text>
      </Pressable>
    </View>
  );
});

export type SubmitButtonVariant = 'primary' | 'secondary' | 'tertiary';

/**
 * A form action. `primary` is the green fill (one per screen); `secondary`
 * the navy outline; `tertiary` the underlined text control. All three are at
 * least 44 px tall and dim to 0.6 while disabled or submitting; the spinner
 * is navy on every variant.
 */
export function SubmitButton({
  label,
  onPress,
  submitting,
  disabled,
  testID,
  variant = 'primary',
  busyLabel,
}: {
  label: string;
  onPress: () => void;
  submitting: boolean;
  disabled?: boolean;
  testID: string;
  variant?: SubmitButtonVariant;
  /**
   * What the control says WHILE it is working, next to the spinner.
   *
   * OPT-IN, so the identity funnel is untouched. Without it the button shows
   * the spinner alone, exactly as the accepted Batch A screens do. The join
   * target names the work in progress ("Joining…") because that action can
   * take a visible moment and a bare spinner does not say what is happening.
   */
  busyLabel?: string;
}) {
  const isDisabled = submitting || disabled;
  const buttonStyle =
    variant === 'secondary'
      ? field.fork
      : variant === 'tertiary'
        ? field.secondary
        : field.primary;
  const textStyle =
    variant === 'secondary'
      ? field.forkText
      : variant === 'tertiary'
        ? field.secondaryText
        : field.primaryText;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={[buttonStyle, isDisabled && variant === 'primary' ? field.primaryOff : null]}
      testID={testID}
      accessibilityRole="button"
    >
      {submitting ? (
        busyLabel ? (
          <View style={field.busyRow}>
            <ActivityIndicator color={NAVY} />
            <Text style={[textStyle, variant === 'primary' ? field.primaryTextOff : null]}>
              {busyLabel}
            </Text>
          </View>
        ) : (
          <ActivityIndicator color={NAVY} />
        )
      ) : (
        <Text style={[textStyle, isDisabled && variant === 'primary' ? field.primaryTextOff : null]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * A failure, banded rather than a loose red line.
 *
 * The field above stays UNCHANGED for an error tone — a failed password does
 * not re-brand the product — so this panel is what carries the state, and it
 * has to be able to.
 */
export function ErrorText({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <View style={field.errorPanel} testID={testID}>
      <Text style={field.errorBody}>{children}</Text>
    </View>
  );
}

/**
 * A true statement about what did or did not happen — neither an error nor an
 * invitation to keep tapping. `unconfigured` is the case this exists for.
 */
export function NoticeText({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <View style={field.noticePanel} testID={testID}>
      <Text style={field.noticeText}>{children}</Text>
    </View>
  );
}

export function StatusText({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <Text style={field.status} testID={testID}>
      {children}
    </Text>
  );
}

/**
 * Muted hint that sits next to a field to state a rule the caller must satisfy
 * BEFORE they submit — e.g. the signup password length requirement. Separate
 * from StatusText (which reports what happened) because the semantic is a
 * standing precondition, not an event, and it should not shift the caller's
 * focus the way an error/status message does.
 */
export function FieldHint({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <Text style={field.rule} testID={testID}>
      {children}
    </Text>
  );
}

/**
 * The quiet link under a form: a tertiary control, 44 px tall. Expo Router's
 * Link is a text anchor on web, so it goes through ButtonLink, which hands
 * the href to a Pressable that can carry the minimum height and keeps the
 * testID on the anchor the tests click.
 */
export function SecondaryLink({
  href,
  label,
  testID,
  onPress,
}: {
  href: string;
  label: string;
  testID?: string;
  /** Runs before the navigation, exactly as ButtonLink's does. A caller that
   * passes none behaves as it always has. */
  onPress?: () => void;
}) {
  return (
    <ButtonLink
      href={href}
      style={field.secondary}
      textStyle={field.secondaryText}
      // ButtonLink types the testID as required; callers without one get no
      // data-testid attribute, exactly as before.
      testID={testID as string}
      label={label}
      onPress={onPress}
    />
  );
}

/**
 * The two honest forks, side by side.
 *
 * Firebase Auth's enumeration protection collapses "no such user" and "wrong
 * password" into a single code, so the product cannot know which happened.
 * Rather than guess, the error offers both as real controls: reset the
 * password you have, or create the account you do not.
 */
export function ForkRow({ children }: { children: ReactNode }) {
  return <View style={field.forkRow}>{children}</View>;
}

/** One fork. A bordered, equal-width way out, at least 46pt tall. */
export function ForkLink({
  href,
  label,
  testID,
}: {
  href: string;
  label: string;
  testID?: string;
}) {
  return (
    <View style={field.forkCell}>
      <ButtonLink
        href={href}
        style={field.fork}
        textStyle={field.forkText}
        testID={testID as string}
        label={label}
      />
    </View>
  );
}

/** What to do when the obvious thing did not work. */
export function HelpPanel({
  title,
  body,
  testID,
}: {
  title: string;
  body: string;
  testID?: string;
}) {
  return (
    <View style={field.help} testID={testID}>
      <Text style={field.helpTitle}>{title}</Text>
      <Text style={field.helpBody}>{body}</Text>
    </View>
  );
}

/** A quiet line at the foot, e.g. which account this is. */
export function FootNote({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <Text style={field.footNote} testID={testID}>
      {children}
    </Text>
  );
}

/** The form controls inside the sheet, drawn to the accepted Batch A target. */
const field = StyleSheet.create({
  label: {
    color: INK_QUIET,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginTop: 6,
    marginBottom: 5,
  },
  input: {
    backgroundColor: SURFACE,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: HAIRLINE,
    paddingHorizontal: 14,
    minHeight: 50,
    color: NAVY,
    fontSize: 16,
    fontWeight: '600',
  },
  /** A requirement the product enforces, said before it is enforced. */
  rule: { color: INK_QUIET, fontSize: 11.5, lineHeight: 16 },
  status: { color: INK_QUIET, fontSize: 13, lineHeight: 18 },

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
  /** Spinner and the word for what it is doing, on one line. */
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  primaryText: { color: '#04260F', fontSize: 17, fontWeight: '900' },
  primaryTextOff: { color: '#6B8A76' },

  /** The quiet way out. At least 44pt so it is a real touch target. */
  secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: NAVY, fontSize: 14, fontWeight: '800' },

  /**
   * One of two honest forks. Firebase collapses "no such user" and "wrong
   * password" into one code, so when that lands the screen offers BOTH as
   * real controls rather than guessing which happened.
   */
  forkRow: { flexDirection: 'row', gap: 10 },
  forkCell: { flex: 1, minWidth: 0 },
  fork: {
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: HAIRLINE,
    backgroundColor: SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  forkText: { color: NAVY, fontSize: 14, fontWeight: '800' },

  errorPanel: {
    backgroundColor: '#FDECEC',
    borderRadius: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#C0392B',
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  errorBody: { color: '#7A2A21', fontSize: 13, lineHeight: 18 },

  noticePanel: {
    backgroundColor: '#EEF2F6',
    borderRadius: 14,
    borderLeftWidth: 4,
    borderLeftColor: INK_QUIET,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  noticeText: { color: NAVY, fontSize: 13, lineHeight: 19 },

  help: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    padding: 14,
    gap: 4,
    ...elevation.card,
  },
  helpTitle: { color: NAVY, fontSize: 14, fontWeight: '900' },
  helpBody: { color: INK_QUIET, fontSize: 12.5, lineHeight: 18 },
  footNote: { color: INK_QUIET, fontSize: 12, textAlign: 'center', marginTop: 2 },
});

export const authFormStyles = StyleSheet.create({
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    minHeight: 44,
    paddingVertical: 4,
  },
  /** The gate before anybody has given it: an empty box, never a ticked one. */
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderColor: '#B9C4CF',
    borderRadius: 7,
    backgroundColor: SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: ACTION_GREEN_DEEP,
    borderColor: ACTION_GREEN_DEEP,
  },
  checkboxCheck: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 16,
  },
  checkboxLabel: {
    ...StyleSheet.flatten(kit.body),
    flex: 1,
    minWidth: 0,
  },
});

const styles = StyleSheet.create({
  titleBlock: { gap: 6 },
  // Fields are grouped label-over-input; the label's top margin opens the
  // gap between one group and the next inside the card.
  labelSpacing: { marginTop: 6 },
  // The primary action sits a little apart from the fields above it; the
  // quieter variants stack directly under it.
  submitPrimary: { marginTop: 8 },
  passwordRow: {
    position: 'relative',
    justifyContent: 'center',
  },
  passwordInput: {
    // Room for the Show/Hide toggle so a long password does not tuck under it.
    paddingRight: 84,
  },
  passwordToggle: {
    position: 'absolute',
    right: 4,
    top: 0,
    bottom: 0,
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  passwordToggleText: {
    color: NAVY,
    fontSize: 15,
    fontWeight: '700',
  },
});
