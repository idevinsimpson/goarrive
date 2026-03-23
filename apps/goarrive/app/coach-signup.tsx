/**
 * Coach Signup screen — /coach-signup?token=<inviteToken>
 *
 * Public page (no auth required to view).
 * Reads the invite token from the URL, validates it, and lets the invited
 * coach create their account. On success, calls activateCoachInvite to
 * set the coach role and redirects to the dashboard.
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView,
  Image,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  createUserWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { auth } from '../lib/firebase';

const FONT_HEADING =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_BODY =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

export default function CoachSignupScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // If no token, show an error immediately
  const hasToken = !!token;

  async function handleSignup() {
    if (!name.trim() || !email.trim() || !password.trim() || !confirmPassword.trim()) {
      setError('Please fill in all fields.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (!token) {
      setError('Invalid invite link. Please request a new one from your administrator.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // 1. Create the Firebase Auth account
      const cred = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);

      // 2. Set the display name
      await updateProfile(cred.user, { displayName: name.trim() });

      // 3. Activate the invite — sets coach custom claims and writes coaches doc
      const functions = getFunctions();
      const activateCoachInvite = httpsCallable<
        { token: string },
        { success: boolean; coachId: string }
      >(functions, 'activateCoachInvite');

      await activateCoachInvite({ token });

      // 4. Force token refresh to pick up new coach claims
      await cred.user.getIdToken(true);

      setSuccess(true);

      // 5. Redirect to dashboard after a short delay
      setTimeout(() => {
        router.replace('/(app)/dashboard');
      }, 2000);
    } catch (err: any) {
      // Clean up: if auth account was created but activateCoachInvite failed,
      // delete the auth account so the user can try again
      if (auth.currentUser && !success) {
        try { await auth.currentUser.delete(); } catch {}
      }

      const msg =
        err?.message?.includes('email-already-in-use')
          ? 'An account with this email already exists. Please sign in instead.'
          : err?.message?.includes('not-found')
          ? 'This invite link is invalid. Please request a new one from your administrator.'
          : err?.message?.includes('already been used')
          ? 'This invite link has already been used. Please request a new one.'
          : err?.message?.includes('expired')
          ? 'This invite link has expired. Please request a new one from your administrator.'
          : err?.message?.includes('permission-denied')
          ? 'The email address does not match this invite. Please use the email address the invite was sent to.'
          : err?.message ?? 'Something went wrong. Please try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <View style={s.root}>
        <View style={s.successContainer}>
          <Text style={s.successIcon}>✓</Text>
          <Text style={s.successTitle}>Welcome to GoArrive!</Text>
          <Text style={s.successBody}>Your coach account has been created. Taking you to your dashboard...</Text>
          <ActivityIndicator color="#F5A623" style={{ marginTop: 16 }} />
        </View>
      </View>
    );
  }

  if (!hasToken) {
    return (
      <View style={s.root}>
        <View style={s.successContainer}>
          <Text style={s.errorIcon}>✕</Text>
          <Text style={s.successTitle}>Invalid Invite Link</Text>
          <Text style={s.successBody}>
            This link is missing a required invite token. Please ask your GoArrive administrator to send you a new invite link.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={s.header}>
          <Image
            source={require('../assets/logo.png')}
            style={s.logo}
            resizeMode="contain"
            accessibilityLabel="GoArrive"
          />
          <Text style={s.title}>Create Your Coach Account</Text>
          <Text style={s.subtitle}>
            You've been invited to join GoArrive as a coach. Fill in the details below to get started.
          </Text>
        </View>

        {/* Form */}
        <View style={s.card}>
          <View style={s.fieldWrap}>
            <Text style={s.label}>Full Name</Text>
            <TextInput
              style={s.input}
              placeholder="Your full name"
              placeholderTextColor="#4A5568"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              autoCorrect={false}
              editable={!loading}
            />
          </View>

          <View style={s.fieldWrap}>
            <Text style={s.label}>Email Address</Text>
            <TextInput
              style={s.input}
              placeholder="The email your invite was sent to"
              placeholderTextColor="#4A5568"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading}
            />
          </View>

          <View style={s.fieldWrap}>
            <Text style={s.label}>Password</Text>
            <TextInput
              style={s.input}
              placeholder="At least 8 characters"
              placeholderTextColor="#4A5568"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              editable={!loading}
            />
          </View>

          <View style={s.fieldWrap}>
            <Text style={s.label}>Confirm Password</Text>
            <TextInput
              style={s.input}
              placeholder="Repeat your password"
              placeholderTextColor="#4A5568"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              editable={!loading}
            />
          </View>

          {error ? (
            <View style={s.errorBanner}>
              <Text style={s.errorText}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            style={[s.submitBtn, loading && s.submitBtnDisabled]}
            onPress={handleSignup}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#0E1117" size="small" />
            ) : (
              <Text style={s.submitBtnText}>Create My Account</Text>
            )}
          </Pressable>

          <Text style={s.loginNote}>
            Already have an account?{' '}
            <Text style={s.loginLink} onPress={() => router.replace('/(auth)/login')}>
              Sign in
            </Text>
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0E1117' },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
    paddingTop: Platform.select({ web: 60, default: 40 }),
    paddingBottom: 60,
    gap: 24,
  },
  header: { alignItems: 'center', gap: 10 },
  logo: {
    width: 200,
    height: 46,
    marginBottom: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 320,
  },
  card: {
    backgroundColor: '#1A2035',
    borderRadius: 16,
    padding: 20,
    gap: 16,
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  fieldWrap: { gap: 6 },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: '#8A95A3',
    fontFamily: FONT_BODY,
  },
  input: {
    backgroundColor: '#0E1117',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#F0F4F8',
    fontFamily: FONT_BODY,
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  errorBanner: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(224,82,82,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(224,82,82,0.2)',
  },
  errorText: {
    fontSize: 13,
    color: '#E05252',
    fontFamily: FONT_BODY,
    lineHeight: 18,
  },
  submitBtn: {
    backgroundColor: '#F5A623',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FONT_HEADING,
  },
  loginNote: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
    textAlign: 'center',
  },
  loginLink: {
    color: '#F5A623',
    fontWeight: '600',
  },
  // Success / error full-screen states
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
  },
  successIcon: {
    fontSize: 48,
    color: '#6EBB7A',
  },
  errorIcon: {
    fontSize: 48,
    color: '#E05252',
  },
  successTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
    textAlign: 'center',
  },
  successBody: {
    fontSize: 15,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 300,
  },
});
