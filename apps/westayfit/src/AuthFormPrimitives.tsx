import { forwardRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';

import { wsfTheme } from './theme';
import { ButtonLink } from './ui/ButtonLink';
import { CREAM, NAVY, SURFACE, kit } from './ui/kit';
import { WsfWordmark } from './ui/WsfWordmark';

/**
 * The form page: a scrolling cream page, the wordmark chrome at the top, the
 * heading and intro, then the form itself in a card. Same language as
 * Community Home and Contribute. It scrolls so long content (profile setup
 * with both legal panels open) is never clipped, and nothing is centred in a
 * flex box any more.
 *
 * `testID` stays on the column View, a visible element, exactly where the
 * old shell carried it.
 */
export function FormShell({
  eyebrow,
  heading,
  intro,
  children,
  testID,
}: {
  eyebrow?: string;
  heading: string;
  intro?: string;
  children: ReactNode;
  testID: string;
}) {
  return (
    <ScrollView style={kit.scroll} contentContainerStyle={kit.page} keyboardShouldPersistTaps="handled">
      <View style={kit.columnNarrow} testID={testID}>
        <View style={kit.chrome}>
          <WsfWordmark variant="navy" height={22} testID="wsf-form-wordmark" />
        </View>
        <View style={styles.titleBlock}>
          {eyebrow ? <Text style={kit.eyebrow}>{eyebrow}</Text> : null}
          <Text style={kit.heading}>{heading}</Text>
          {intro ? <Text style={kit.intro}>{intro}</Text> : null}
        </View>
        <View style={kit.card}>{children}</View>
      </View>
    </ScrollView>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <Text style={[kit.fieldLabel, styles.labelSpacing]}>{children}</Text>;
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
      placeholderTextColor={wsfTheme.colors.textMuted}
      style={[kit.input, props.style]}
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
        placeholderTextColor={wsfTheme.colors.textMuted}
        style={[kit.input, styles.passwordInput, props.style]}
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
}: {
  label: string;
  onPress: () => void;
  submitting: boolean;
  disabled?: boolean;
  testID: string;
  variant?: SubmitButtonVariant;
}) {
  const isDisabled = submitting || disabled;
  const buttonStyle =
    variant === 'secondary'
      ? kit.secondaryButton
      : variant === 'tertiary'
        ? kit.tertiaryButton
        : [kit.primaryButton, styles.submitPrimary];
  const textStyle =
    variant === 'secondary'
      ? kit.secondaryButtonText
      : variant === 'tertiary'
        ? kit.tertiaryButtonText
        : kit.primaryButtonText;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={[buttonStyle, isDisabled ? kit.primaryButtonDisabled : null]}
      testID={testID}
      accessibilityRole="button"
    >
      {submitting ? (
        <ActivityIndicator color={NAVY} />
      ) : (
        <Text style={textStyle}>{label}</Text>
      )}
    </Pressable>
  );
}

export function ErrorText({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <Text style={kit.errorText} testID={testID}>
      {children}
    </Text>
  );
}

export function StatusText({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <Text style={kit.statusText} testID={testID}>
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
    <Text style={kit.caption} testID={testID}>
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
      style={kit.tertiaryButton}
      textStyle={kit.tertiaryButtonText}
      // ButtonLink types the testID as required; callers without one get no
      // data-testid attribute, exactly as before.
      testID={testID as string}
      label={label}
      onPress={onPress}
    />
  );
}

export const authFormStyles = StyleSheet.create({
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    minHeight: 44,
    paddingVertical: 4,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: NAVY,
    borderRadius: 6,
    backgroundColor: SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: NAVY,
  },
  checkboxCheck: {
    color: CREAM,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 20,
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
