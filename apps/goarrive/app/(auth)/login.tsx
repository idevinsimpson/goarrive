/**
 * Login screen — GoArrive Coach Portal
 *
 * Card-style login with COACH PORTAL label, "Welcome back" heading,
 * labeled Email/Password fields, Sign In button, Forgot password flow,
 * and "New coaches: contact your GoArrive administrator" note.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Image,
} from 'react-native';
import { router } from 'expo-router';
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { auth } from '../../lib/firebase';

const FONT_HEADING =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_BODY =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Forgot password state
  const [showForgot, setShowForgot] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState('');

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      router.replace('/(app)/dashboard');
    } catch (err: any) {
      const code = err?.code ?? '';
      if (
        code === 'auth/user-not-found' ||
        code === 'auth/wrong-password' ||
        code === 'auth/invalid-credential'
      ) {
        setError('Invalid email or password.');
      } else if (code === 'auth/invalid-email') {
        setError('Please enter a valid email address.');
      } else if (code === 'auth/too-many-requests') {
        setError('Too many attempts. Please try again later.');
      } else {
        setError('Sign-in failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    const trimmed = forgotEmail.trim();
    if (!trimmed) {
      setForgotError('Please enter your email address.');
      return;
    }
    setForgotError('');
    setForgotLoading(true);
    try {
      await sendPasswordResetEmail(auth, trimmed);
      setForgotSent(true);
    } catch (err: any) {
      const code = err?.code ?? '';
      if (code === 'auth/user-not-found') {
        // Security: show same success state
        setForgotSent(true);
      } else if (code === 'auth/invalid-email') {
        setForgotError('Please enter a valid email address.');
      } else if (code === 'auth/too-many-requests') {
        setForgotError('Too many attempts. Please try again later.');
      } else {
        setForgotError('Something went wrong. Please try again.');
      }
    } finally {
      setForgotLoading(false);
    }
  }

  function handleShowForgot() {
    setShowForgot(true);
    setForgotEmail(email.trim());
    setForgotError('');
    setForgotSent(false);
  }

  function handleBackToLogin() {
    setShowForgot(false);
    setForgotError('');
    setForgotSent(false);
  }

  // ── Forgot Password: Success State ───────────────────────────────────────
  if (showForgot && forgotSent) {
    return (
      <View style={s.root}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <View style={s.card}>
            <Image
              source={require('../../assets/logo.png')}
              style={s.logo}
              resizeMode="contain"
              accessibilityLabel="GoArrive"
            />
            <Text style={s.portalLabel}>CHECK YOUR INBOX</Text>
            <Text style={s.heading}>Email sent!</Text>
            <Text style={s.sentBody}>
              We sent a password reset link to{'\n'}
              <Text style={s.sentEmail}>{forgotEmail || 'your email'}</Text>.{'\n\n'}
              Check your inbox and spam folder. The link expires in 1 hour.
            </Text>
            <Pressable style={s.loginBtn} onPress={handleBackToLogin}>
              <Text style={s.loginText}>Back to Sign In</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    );
  }

  // ── Forgot Password: Form ─────────────────────────────────────────────────
  if (showForgot) {
    return (
      <KeyboardAvoidingView
        style={s.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <View style={s.card}>
            <Image
              source={require('../../assets/logo.png')}
              style={s.logo}
              resizeMode="contain"
              accessibilityLabel="GoArrive"
            />
            <Text style={s.portalLabel}>RESET PASSWORD</Text>
            <Text style={s.heading}>Forgot your password?</Text>
            <Text style={s.forgotInstructions}>
              Enter your email and we&apos;ll send you a reset link.
            </Text>

            <View style={s.fieldWrap}>
              <Text style={s.fieldLabel}>Email</Text>
            <TextInput
              style={s.input}
              placeholder="coach@example.com"
              placeholderTextColor="#4A5568"
              value={forgotEmail}
              onChangeText={setForgotEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              importantForAutofill="yes"
              editable={!forgotLoading}
              onSubmitEditing={handleForgotPassword}
            />
            </View>

            {forgotError ? (
              <Text style={s.error}>{forgotError}</Text>
            ) : null}

            <Pressable
              style={[s.loginBtn, forgotLoading && s.loginBtnDisabled]}
              onPress={handleForgotPassword}
              disabled={forgotLoading}
            >
              {forgotLoading ? (
                <ActivityIndicator color="#0E1117" size="small" />
              ) : (
                <Text style={s.loginText}>Send Reset Link</Text>
              )}
            </Pressable>

            <Pressable onPress={handleBackToLogin} style={s.backLink}>
              <Text style={s.backLinkText}>← Back to Sign In</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Login View ────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.card}>
          {/* Logo */}
          <Image
            source={require('../../assets/logo.png')}
            style={s.logo}
            resizeMode="contain"
            accessibilityLabel="GoArrive"
          />

          {/* Labels */}
          <Text style={s.portalLabel}>COACH PORTAL</Text>
          <Text style={s.heading}>Welcome back</Text>

          {/* Email field */}
          <View style={s.fieldWrap}>
            <Text style={s.fieldLabel}>Email</Text>
            <TextInput
              style={s.input}
              placeholder="coach@example.com"
              placeholderTextColor="#4A5568"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              importantForAutofill="yes"
              editable={!loading}
            />
          </View>

          {/* Password field */}
          <View style={s.fieldWrap}>
            <Text style={s.fieldLabel}>Password</Text>
            <TextInput
              style={s.input}
              placeholder="••••••••"
              placeholderTextColor="#4A5568"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              importantForAutofill="yes"
              editable={!loading}
              onSubmitEditing={handleLogin}
            />
          </View>

          {error ? <Text style={s.error}>{error}</Text> : null}

          <Pressable
            style={[s.loginBtn, loading && s.loginBtnDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#0E1117" size="small" />
            ) : (
              <Text style={s.loginText}>Sign In</Text>
            )}
          </Pressable>

          {/* Forgot password */}
          <Pressable onPress={handleShowForgot} style={s.forgotLink}>
            <Text style={s.forgotText}>Forgot password?</Text>
          </Pressable>

          {/* Admin note */}
          <Text style={s.adminNote}>
            New coaches: contact your GoArrive administrator to receive an invitation.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0E1117',
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
    maxWidth: 440,
    alignSelf: 'center',
    width: '100%',
  },
  card: {
    backgroundColor: '#111827',
    borderRadius: 20,
    padding: 28,
    borderWidth: 1,
    borderColor: '#1E2A3A',
    gap: 0,
  },
  logo: {
    width: 180,
    height: 52,
    alignSelf: 'center',
    marginBottom: 16,
  },
  portalLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#7DD3FC',
    fontFamily: FONT_BODY,
    textAlign: 'center',
    letterSpacing: 2,
    marginBottom: 6,
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
    textAlign: 'center',
    marginBottom: 22,
  },
  fieldWrap: {
    marginBottom: 14,
    gap: 6,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#8A95A3',
    fontFamily: FONT_BODY,
  },
  input: {
    backgroundColor: '#1A2035',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 15,
    color: '#F0F4F8',
    fontFamily: FONT_BODY,
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  error: {
    fontSize: 13,
    color: '#E05252',
    fontFamily: FONT_BODY,
    textAlign: 'center',
    marginBottom: 4,
  },
  loginBtn: {
    backgroundColor: '#F5A623',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 4,
  },
  loginBtnDisabled: {
    opacity: 0.6,
  },
  loginText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FONT_HEADING,
  },
  forgotLink: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  forgotText: {
    fontSize: 14,
    color: '#F5A623',
    fontFamily: FONT_BODY,
    fontWeight: '500',
  },
  adminNote: {
    fontSize: 12,
    color: '#4A5568',
    fontFamily: FONT_BODY,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 4,
  },
  forgotInstructions: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  backLink: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  backLinkText: {
    fontSize: 14,
    color: '#F5A623',
    fontFamily: FONT_BODY,
    fontWeight: '500',
  },
  sentBody: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  sentEmail: {
    color: '#F0F4F8',
    fontWeight: '600',
  },
});
