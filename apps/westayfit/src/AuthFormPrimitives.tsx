import { Link } from 'expo-router';
import { forwardRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';

import { wsfTheme } from './theme';

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
    <View style={styles.container} testID={testID}>
      <View style={styles.inner}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.heading}>{heading}</Text>
        {intro ? <Text style={styles.intro}>{intro}</Text> : null}
        {children}
      </View>
    </View>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
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
      style={[styles.input, props.style]}
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
        placeholderTextColor={wsfTheme.colors.textMuted}
        style={[styles.input, styles.passwordInput, props.style]}
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

export function SubmitButton({
  label,
  onPress,
  submitting,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  submitting: boolean;
  disabled?: boolean;
  testID: string;
}) {
  const isDisabled = submitting || disabled;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={[styles.button, isDisabled ? styles.buttonDisabled : null]}
      testID={testID}
      accessibilityRole="button"
    >
      {submitting ? (
        <ActivityIndicator color={wsfTheme.colors.surface} />
      ) : (
        <Text style={styles.buttonText}>{label}</Text>
      )}
    </Pressable>
  );
}

export function ErrorText({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <Text style={styles.error} testID={testID}>
      {children}
    </Text>
  );
}

export function StatusText({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <Text style={styles.status} testID={testID}>
      {children}
    </Text>
  );
}

export function SecondaryLink({
  href,
  label,
  testID,
}: {
  href: string;
  label: string;
  testID?: string;
}) {
  return (
    <Link href={href as never} style={styles.link} testID={testID}>
      {label}
    </Link>
  );
}

export const authFormStyles = StyleSheet.create({
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: wsfTheme.spacing.md,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: wsfTheme.colors.primary,
    borderRadius: wsfTheme.radius.sm,
    marginRight: wsfTheme.spacing.md,
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: wsfTheme.colors.primary,
  },
  checkboxCheck: {
    color: wsfTheme.colors.surface,
    fontSize: 16,
    fontWeight: '700',
  },
  checkboxLabel: {
    flex: 1,
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.body.fontSize,
    lineHeight: wsfTheme.typography.body.lineHeight,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: wsfTheme.colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: wsfTheme.spacing.xl,
  },
  inner: {
    maxWidth: 480,
    width: '100%',
  },
  eyebrow: {
    color: wsfTheme.colors.primary,
    fontSize: wsfTheme.typography.caption.fontSize,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: wsfTheme.spacing.md,
  },
  heading: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.heading.fontSize,
    fontWeight: wsfTheme.typography.heading.fontWeight,
    lineHeight: wsfTheme.typography.heading.lineHeight,
    marginBottom: wsfTheme.spacing.md,
  },
  intro: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.body.fontSize,
    lineHeight: wsfTheme.typography.body.lineHeight,
    marginBottom: wsfTheme.spacing.lg,
  },
  label: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.caption.fontSize,
    fontWeight: '600',
    marginBottom: wsfTheme.spacing.xs,
    marginTop: wsfTheme.spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: wsfTheme.colors.border,
    backgroundColor: wsfTheme.colors.surface,
    borderRadius: wsfTheme.radius.sm,
    paddingHorizontal: wsfTheme.spacing.md,
    paddingVertical: wsfTheme.spacing.sm,
    fontSize: wsfTheme.typography.body.fontSize,
    color: wsfTheme.colors.text,
    marginBottom: wsfTheme.spacing.sm,
  },
  passwordRow: {
    position: 'relative',
    justifyContent: 'center',
  },
  passwordInput: {
    // Room for the Show/Hide toggle so a long password does not tuck under it.
    paddingRight: wsfTheme.spacing.xl * 2.4,
  },
  passwordToggle: {
    position: 'absolute',
    right: wsfTheme.spacing.sm,
    top: 0,
    bottom: wsfTheme.spacing.sm,
    justifyContent: 'center',
    paddingHorizontal: wsfTheme.spacing.sm,
  },
  passwordToggleText: {
    color: wsfTheme.colors.primary,
    fontSize: wsfTheme.typography.body.fontSize,
    fontWeight: '600',
  },
  button: {
    backgroundColor: wsfTheme.colors.primary,
    borderRadius: wsfTheme.radius.sm,
    paddingVertical: wsfTheme.spacing.md,
    alignItems: 'center',
    marginTop: wsfTheme.spacing.md,
    marginBottom: wsfTheme.spacing.md,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: wsfTheme.colors.surface,
    fontSize: wsfTheme.typography.body.fontSize,
    fontWeight: '700',
  },
  error: {
    color: '#B4232C',
    fontSize: wsfTheme.typography.body.fontSize,
    marginTop: wsfTheme.spacing.sm,
    marginBottom: wsfTheme.spacing.sm,
  },
  status: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.body.fontSize,
    marginTop: wsfTheme.spacing.sm,
    marginBottom: wsfTheme.spacing.sm,
  },
  link: {
    color: wsfTheme.colors.primary,
    fontSize: wsfTheme.typography.body.fontSize,
    fontWeight: '600',
    textDecorationLine: 'underline',
    marginTop: wsfTheme.spacing.md,
  },
});
