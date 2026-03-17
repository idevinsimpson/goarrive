/**
 * Login screen — Email/password sign-in for GoArrive
 *
 * Simple email + password form. On success, redirects to (app)/dashboard.
 * Includes "Forgot password?" flow using Firebase sendPasswordResetEmail.
 * Registration is handled by Cloud Functions / admin invite flow.
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
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotMessage, setForgotMessage] = useState('');
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
      if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
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
    const trimmed = forgotEmail.trim() || email.trim();
    if (!trimmed) {
      setForgotError('Please enter your email address.');
      return;
    }
    setForgotError('');
    setForgotMessage('');
    setForgotLoading(true);
    try {
      await sendPasswordResetEmail(auth, trimmed);
      setForgotMessage(
        'Password reset email sent! Check your inbox (and spam folder).'
      );
    } catch (err: any) {
      const code = err?.code ?? '';
      if (code === 'auth/user-not-found') {
        // For security, show the same success message
        setForgotMessage(
          'If an account exists for that email, a reset link has been sent.'
        );
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
    setForgotMessage('');
  }

  function handleBackToLogin() {
    setShowForgot(false);
    setForgotError('');
    setForgotMessage('');
  }

  // ── Forgot Password View ──────────────────────────────────────────────────
  if (showForgot) {
    return (
      <KeyboardAvoidingView
        style={s.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* Brand */}
          <View style={s.brandWrap}>
            <Text style={s.brandLogo}>G➲A</Text>
            <Text style={s.brandName}>GoArrive</Text>
            <Text style={s.brandTag}>Reset your password</Text>
          </View>

          {/* Forgot Form */}
          <View style={s.form}>
            <Text style={s.forgotInstructions}>
              Enter the email address associated with your account and
              we&apos;ll send you a link to reset your password.
            </Text>

            <TextInput
              style={s.input}
              placeholder="Email"
              placeholderTextColor="#4A5568"
              value={forgotEmail}
              onChangeText={setForgotEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!forgotLoading}
              onSubmitEditing={handleForgotPassword}
            />

            {forgotError ? (
              <Text style={s.error}>{forgotError}</Text>
            ) : null}
            {forgotMessage ? (
              <Text style={s.success}>{forgotMessage}</Text>
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

            <Pressable onPress={handleBackToLogin} style={s.forgotLink}>
              <Text style={s.forgotText}>Back to Sign In</Text>
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
        {/* Brand */}
        <View style={s.brandWrap}>
          <Text style={s.brandLogo}>G➲A</Text>
          <Text style={s.brandName}>GoArrive</Text>
          <Text style={s.brandTag}>Fitness coaching, simplified.</Text>
        </View>

        {/* Form */}
        <View style={s.form}>
          <TextInput
            style={s.input}
            placeholder="Email"
            placeholderTextColor="#4A5568"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
          />
          <TextInput
            style={s.input}
            placeholder="Password"
            placeholderTextColor="#4A5568"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            editable={!loading}
            onSubmitEditing={handleLogin}
          />

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

          <Pressable onPress={handleShowForgot} style={s.forgotLink}>
            <Text style={s.forgotText}>Forgot password?</Text>
          </Pressable>
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
    padding: 24,
    gap: 32,
    maxWidth: 400,
    alignSelf: 'center',
    width: '100%',
  },
  brandWrap: {
    alignItems: 'center',
    gap: 8,
  },
  brandLogo: {
    fontSize: 48,
    fontWeight: '800',
    color: '#F5A623',
    fontFamily: FONT_HEADING,
    letterSpacing: 2,
  },
  brandName: {
    fontSize: 20,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
  },
  brandTag: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
  },
  form: {
    gap: 14,
  },
  forgotInstructions: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#1A2035',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
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
  },
  success: {
    fontSize: 13,
    color: '#4ADE80',
    fontFamily: FONT_BODY,
    textAlign: 'center',
  },
  loginBtn: {
    backgroundColor: '#F5A623',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
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
    paddingVertical: 8,
  },
  forgotText: {
    fontSize: 14,
    color: '#F5A623',
    fontFamily: FONT_BODY,
    fontWeight: '500',
  },
});
