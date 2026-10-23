/** Public email-action handler. No sign-in, account creation, or role changes. */
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { passwordResetError, readPasswordResetLink, validateResetPassword } from '../../lib/passwordReset';
import { BG, BORDER, CARD, FB, FG, FH, GOLD, MUTED, RED } from '../../lib/theme';

type Status = 'checking' | 'ready' | 'submitting' | 'success' | 'invalid' | 'retry';

export default function ResetPasswordScreen() {
  const { mode, oobCode } = useLocalSearchParams<{ mode?: string | string[]; oobCode?: string | string[] }>();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const link = readPasswordResetLink(mode, oobCode);
  // A different link gets fresh state. Results from an old request cannot enable it.
  return (
    <>
      <Head>
        <title>Reset password | GoArrive</title>
        <meta name="referrer" content="no-referrer" />
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      {/* Static export has no query. Keep its first client render identical. */}
      <ResetPasswordForm
        key={mounted ? link.code ?? link.error : 'initializing'}
        code={mounted ? link.code : null} linkError={mounted ? link.error : ''}
        initializing={!mounted}
      />
    </>
  );
}

function ResetPasswordForm({ code, linkError, initializing }: { code: string | null; linkError: string; initializing: boolean }) {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<Status>(initializing || code ? 'checking' : 'invalid');
  const [error, setError] = useState(linkError);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [slow, setSlow] = useState(false);
  const mounted = useRef(false);
  const submitting = useRef(false);
  const confirmationRef = useRef<TextInput>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!code) return;
    let active = true;
    setStatus('checking');
    setError('');
    // The returned email is deliberately not displayed, logged, or persisted.
    verifyPasswordResetCode(auth, code).then(() => {
      if (active) setStatus('ready');
    }).catch((failure: unknown) => {
      if (!active) return;
      const problem = passwordResetError(failure);
      setError(problem.message);
      setStatus(problem.terminal ? 'invalid' : 'retry');
    });
    return () => { active = false; };
  }, [code, attempt]);

  useEffect(() => {
    setSlow(false);
    if (status !== 'checking' && status !== 'submitting') return;
    // Do not race a timeout against a write: its outcome could still be success.
    const timer = setTimeout(() => setSlow(true), 15000);
    return () => clearTimeout(timer);
  }, [status]);

  async function handleSubmit() {
    // Ref closes the double-click/Enter race before React paints disabled state.
    if (!code || status !== 'ready' || submitting.current) return;
    const validationError = validateResetPassword(password, confirmation);
    if (validationError) {
      setError(validationError);
      return;
    }
    submitting.current = true;
    setStatus('submitting');
    setError('');
    try {
      // Firebase enforces the project's password policy and one-time code use.
      await confirmPasswordReset(auth, code, password);
      if (mounted.current) setStatus('success');
    } catch (failure: unknown) {
      if (!mounted.current) return;
      const problem = passwordResetError(failure);
      setError(problem.message);
      setStatus(problem.terminal ? 'invalid' : 'ready');
    } finally {
      submitting.current = false;
      if (mounted.current) {
        setPassword('');
        setConfirmation('');
      }
    }
  }

  function goToSignIn() {
    // Never follow continueUrl (or any other URL supplied by the reset link).
    setPassword('');
    setConfirmation('');
    router.replace('/(auth)/login');
  }

  const busy = status === 'checking' || status === 'submitting';
  const showForm = status === 'ready' || status === 'submitting';

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[s.content, { paddingTop: Math.max(20, insets.top), paddingBottom: Math.max(20, insets.bottom) }]} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          <Image source={require('../../assets/logo.png')} style={s.logo} resizeMode="contain" accessibilityLabel="GoArrive" />
          <Text style={s.eyebrow}>RESET PASSWORD</Text>
          <Text style={s.heading} accessibilityRole="header">{status === 'success' ? 'Password updated' : 'Choose a new password'}</Text>

          {status === 'checking' && (
            <View style={s.progress} accessibilityLiveRegion="polite">
              <ActivityIndicator color={GOLD} accessibilityLabel="Checking reset link" />
              <Text style={s.body}>Checking your reset link…</Text>
            </View>
          )}
          {status === 'success' && <Text style={s.body} accessibilityLiveRegion="polite">Your password has been updated. Sign in with your new password.</Text>}

          {showForm && (
            <>
              <Text style={s.body}>Use at least 6 characters. Your account may require a stronger password.</Text>
              <View style={s.field}>
                <Text style={s.label}>New password</Text>
                <TextInput
                  style={s.input} value={password} onChangeText={setPassword}
                  accessibilityLabel="New password" secureTextEntry
                  autoComplete="new-password" textContentType="newPassword"
                  autoCapitalize="none" autoCorrect={false} editable={!busy}
                  returnKeyType="next" onSubmitEditing={() => confirmationRef.current?.focus()}
                />
              </View>
              <View style={s.field}>
                <Text style={s.label}>Confirm new password</Text>
                <TextInput
                  ref={confirmationRef} style={s.input} value={confirmation} onChangeText={setConfirmation}
                  accessibilityLabel="Confirm new password" secureTextEntry
                  autoComplete="new-password" textContentType="newPassword"
                  autoCapitalize="none" autoCorrect={false} editable={!busy}
                  returnKeyType="go" onSubmitEditing={handleSubmit}
                />
              </View>
            </>
          )}
          {!!error && <Text style={s.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">{error}</Text>}
          {slow && busy && <Text style={s.body} accessibilityLiveRegion="polite">This is taking longer than usual. Please wait; do not submit again.</Text>}

          {showForm && (
            <Pressable onPress={handleSubmit} disabled={busy} accessibilityRole="button" accessibilityLabel="Update password" accessibilityState={{ disabled: busy, busy }} style={({ pressed }) => [s.button, busy && s.disabled, pressed && !busy && s.pressed]}>
              {status === 'submitting' ? <ActivityIndicator color={BG} accessibilityLabel="Updating password" /> : <Text style={s.buttonText}>Update Password</Text>}
            </Pressable>
          )}
          {status === 'retry' && (
            <Pressable onPress={() => setAttempt(value => value + 1)} accessibilityRole="button" accessibilityLabel="Check reset link again" style={s.button}>
              <Text style={s.buttonText}>Try Again</Text>
            </Pressable>
          )}
          {status === 'invalid' && <Text style={s.body}>On the sign-in page, choose “Forgot password?” to request a new link.</Text>}
          <Pressable onPress={goToSignIn} disabled={status === 'submitting'} accessibilityRole="button" accessibilityLabel="Back to sign in" accessibilityState={{ disabled: status === 'submitting' }} style={[s.back, status === 'submitting' && s.disabled]}>
            <Text style={s.backText}>Back to Sign In</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  content: { flexGrow: 1, justifyContent: 'center', padding: 20, maxWidth: 440, alignSelf: 'center', width: '100%' },
  card: { backgroundColor: CARD, borderRadius: 20, padding: 24, borderWidth: 1, borderColor: BORDER },
  logo: { width: 180, height: 52, alignSelf: 'center', marginBottom: 16 },
  eyebrow: { fontSize: 11, fontWeight: '700', color: '#7DD3FC', fontFamily: FB, textAlign: 'center', letterSpacing: 2, marginBottom: 6 },
  heading: { fontSize: 24, fontWeight: '700', color: FG, fontFamily: FH, textAlign: 'center', marginBottom: 20 },
  body: { fontSize: 14, color: MUTED, fontFamily: FB, textAlign: 'center', lineHeight: 21, marginBottom: 16 },
  progress: { gap: 12 },
  field: { marginBottom: 14, gap: 6 },
  label: { fontSize: 13, color: MUTED, fontFamily: FB },
  input: { backgroundColor: '#1A2035', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 13, fontSize: 16, color: FG, fontFamily: FB, borderWidth: 1, borderColor: '#2A3347' },
  error: { fontSize: 14, color: RED, fontFamily: FB, textAlign: 'center', lineHeight: 21, marginBottom: 16 },
  button: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  buttonText: { fontSize: 16, fontWeight: '700', color: BG, fontFamily: FH },
  disabled: { opacity: 0.6 },
  pressed: { opacity: 0.85 },
  back: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  backText: { fontSize: 14, color: GOLD, fontFamily: FB, fontWeight: '500' },
});
