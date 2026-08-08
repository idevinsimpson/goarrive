/**
 * Checkout Success — Public page shown after Stripe Checkout completes,
 * and after a $0 plan is activated via startFreePlan (?free=1).
 *
 * Route: /checkout-success
 * Query params:
 *   - intent: intentId from createCheckoutSession / startFreePlan
 *   - memberId: the member's ID (the member_plans / members doc key)
 *   - planId: the plan ID (same as memberId for current plans)
 *   - free: '1' when the plan was activated without payment
 *
 * This page does NOT require authentication. It is the claim gate:
 * after payment (or free activation) the buyer either
 *   - is already signed in as the member → straight to the member home,
 *   - creates an account → linked to the member record via claimMemberAccount,
 *   - or signs in to an existing account and is linked the same way.
 *
 * Flow: View shared plan → Pay via Stripe (or Start Free) → This page →
 *       claimMemberAccount → /(member)/home
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  User,
} from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { auth } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';

const BG = '#0E1117';
const GOLD = '#F5A623';
const ACCENT = '#6EBB7A';
const MUTED = '#7A8A9A';
const PRIMARY = '#5B9BD5';
const BORDER = '#2A3347';
const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'System';

type Phase = 'confirm' | 'boot' | 'gate' | 'signedIn' | 'noMember';
type GateMode = 'create' | 'signin';

export default function CheckoutSuccessPublicScreen() {
  const insets = useSafeAreaInsets();
  const { memberId, free } = useLocalSearchParams<{
    intent?: string; memberId?: string; planId?: string; free?: string;
  }>();
  const isFree = free === '1';
  const { user, claims, loading: authLoading, signOut } = useAuth();

  const [phase, setPhase] = useState<Phase>('confirm');
  const [mode, setMode] = useState<GateMode>('create');
  const [emailMasked, setEmailMasked] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const bootedRef = useRef(false);

  // Brief confirmation beat. Paid: gives the webhook a moment to activate the
  // plan. Free: activation already happened synchronously, so keep it short.
  useEffect(() => {
    const timer = setTimeout(() => setPhase((p) => (p === 'confirm' ? 'boot' : p)), isFree ? 800 : 2500);
    return () => clearTimeout(timer);
  }, [isFree]);

  // Decide which gate to show, once auth state is known.
  useEffect(() => {
    if (phase !== 'boot' || authLoading || bootedRef.current) return;
    bootedRef.current = true;

    if (!memberId) {
      setPhase('noMember');
      return;
    }
    if (user) {
      setPhase('signedIn');
      return;
    }
    (async () => {
      try {
        const fns = getFunctions();
        const res = await httpsCallable(fns, 'getMemberClaimStatus')({ memberId });
        const data = res.data as { exists: boolean; hasAccount: boolean; emailMasked: string };
        if (!data.exists) {
          setPhase('noMember');
          return;
        }
        setEmailMasked(data.emailMasked || '');
        setMode(data.hasAccount ? 'signin' : 'create');
      } catch (err) {
        // Degrade gracefully — let them try creating an account; the server
        // still enforces the email match on claim.
        console.warn('[CheckoutSuccess] getMemberClaimStatus failed:', err);
        setMode('create');
      }
      setPhase('gate');
    })();
  }, [phase, authLoading, user, memberId]);

  function goHome() {
    if (Platform.OS === 'web') {
      // Full page load so AuthContext re-resolves the fresh custom claims on
      // boot — an in-app navigation would keep the pre-claim auth state.
      window.location.assign('/home');
    } else {
      router.replace('/(member)/home');
    }
  }

  async function claimAndEnter(u: User) {
    setBusy(true);
    setFormError('');
    try {
      const fns = getFunctions();
      await httpsCallable(fns, 'claimMemberAccount')({ memberId });
      await u.getIdToken(true);
      goHome();
    } catch (err: any) {
      const code: string = err?.code ?? '';
      if (code === 'functions/already-exists') {
        // The member record is already linked. If it's linked to this very
        // account, we're done; otherwise the coach needs to relink it.
        try {
          const tok = await u.getIdTokenResult(true);
          if ((tok.claims as any).memberId === memberId || u.uid === memberId) {
            goHome();
            return;
          }
        } catch { /* fall through to the error message */ }
        setFormError('This plan is already linked to a different account. Sign in with the original email, or ask your coach to link your account for you.');
      } else if (code === 'functions/permission-denied') {
        setFormError(`${err?.message ?? 'This email does not match the plan.'} You can also ask your coach to link your account for you.`);
      } else {
        setFormError(err?.message || 'Could not link your account. Please try again.');
      }
      setBusy(false);
    }
  }

  async function handleCreate() {
    if (!email.trim() || !password) {
      setFormError('Enter your email and choose a password.');
      return;
    }
    if (password.length < 6) {
      setFormError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setFormError('');
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await claimAndEnter(cred.user);
    } catch (err: any) {
      const code: string = err?.code ?? '';
      if (code === 'auth/email-already-in-use') {
        setMode('signin');
        setFormError('An account with this email already exists — sign in instead.');
      } else if (code === 'auth/weak-password') {
        setFormError('Your password is too weak. Use at least 6 characters.');
      } else if (code === 'auth/invalid-email') {
        setFormError('Please enter a valid email address.');
      } else {
        setFormError('Something went wrong creating your account. Please try again.');
      }
      setBusy(false);
    }
  }

  async function handleSignIn() {
    if (!email.trim() || !password) {
      setFormError('Enter your email and password.');
      return;
    }
    setBusy(true);
    setFormError('');
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      const tok = await cred.user.getIdTokenResult(true);
      if ((tok.claims as any).memberId === memberId || cred.user.uid === memberId) {
        goHome();
        return;
      }
      await claimAndEnter(cred.user);
    } catch (err: any) {
      const code: string = err?.code ?? '';
      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
        setFormError('Incorrect email or password.');
      } else if (code === 'auth/too-many-requests') {
        setFormError('Too many attempts. Please wait a moment and try again.');
      } else {
        setFormError('Could not sign you in. Please try again.');
      }
      setBusy(false);
    }
  }

  async function handleUseDifferentAccount() {
    setBusy(true);
    setFormError('');
    try {
      await signOut();
    } finally {
      setBusy(false);
      bootedRef.current = false;
      setPhase('boot');
    }
  }

  const successTitle = isFree ? 'Your Plan Is Active!' : 'Payment Received!';
  const isSignedInAsMember =
    !!user && (user.uid === memberId || (claims as any)?.memberId === memberId);

  return (
    <View style={[s.root, { paddingTop: Math.max(24, insets.top) }]}>
      <View style={s.card}>
        {phase === 'confirm' && (
          <>
            <ActivityIndicator size="large" color={GOLD} style={{ marginBottom: 20 }} />
            <Text style={s.title}>{isFree ? 'Activating your plan...' : 'Confirming your payment...'}</Text>
            <Text style={s.subtitle}>This usually takes just a moment.</Text>
          </>
        )}

        {phase === 'boot' && (
          <ActivityIndicator size="large" color={GOLD} style={{ marginVertical: 24 }} />
        )}

        {phase === 'noMember' && (
          <>
            <Text style={s.title}>Something's missing</Text>
            <Text style={s.subtitle}>
              We couldn't find this membership. Use the plan link your coach sent you, or contact your coach directly.
            </Text>
          </>
        )}

        {phase === 'signedIn' && isSignedInAsMember && (
          <>
            <Text style={{ fontSize: 56, marginBottom: 16 }}>{'🎉'}</Text>
            <Text style={s.title}>{successTitle}</Text>
            <Text style={s.subtitle}>
              {isFree
                ? 'Your coaching plan is active. Your coach will be notified and will reach out to get started.'
                : 'Your coaching plan is being activated. Your coach will be notified and will reach out to get started.'}
            </Text>
            <Pressable onPress={goHome} style={s.ctaBtn} disabled={busy}>
              <Text style={s.ctaBtnText}>Go to My Plan</Text>
            </Pressable>
          </>
        )}

        {phase === 'signedIn' && !isSignedInAsMember && (
          <>
            <Text style={{ fontSize: 56, marginBottom: 16 }}>{'🎉'}</Text>
            <Text style={s.title}>{successTitle}</Text>
            <Text style={s.subtitle}>
              You're signed in as {user?.email ?? 'another account'}. Link this plan to your account to access it.
            </Text>
            {formError ? <Text style={s.errorText}>{formError}</Text> : null}
            <Pressable onPress={() => user && claimAndEnter(user)} style={s.ctaBtn} disabled={busy}>
              {busy ? <ActivityIndicator size="small" color="#000" /> : <Text style={s.ctaBtnText}>Link This Plan to My Account</Text>}
            </Pressable>
            <Pressable onPress={handleUseDifferentAccount} disabled={busy} style={{ marginTop: 14 }}>
              <Text style={s.linkText}>Use a different account</Text>
            </Pressable>
          </>
        )}

        {phase === 'gate' && (
          <>
            <Text style={{ fontSize: 48, marginBottom: 12 }}>{'🎉'}</Text>
            <Text style={s.title}>{successTitle}</Text>
            <Text style={s.subtitle}>
              {mode === 'create'
                ? 'Create your account to access your plan, schedule sessions, and connect with your coach.'
                : `Sign in to access your plan.${emailMasked ? ` This plan was set up for ${emailMasked}.` : ''}`}
            </Text>

            <TextInput
              style={s.input}
              placeholder="Email"
              placeholderTextColor={MUTED}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
            />
            <TextInput
              style={s.input}
              placeholder={mode === 'create' ? 'Choose a password' : 'Password'}
              placeholderTextColor={MUTED}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
            {mode === 'create' && (
              <TextInput
                style={s.input}
                placeholder="Confirm password"
                placeholderTextColor={MUTED}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
              />
            )}

            {formError ? <Text style={s.errorText}>{formError}</Text> : null}

            <Pressable
              onPress={mode === 'create' ? handleCreate : handleSignIn}
              style={[s.ctaBtn, busy && { opacity: 0.6 }]}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator size="small" color="#000" />
              ) : (
                <Text style={s.ctaBtnText}>
                  {mode === 'create' ? 'Create Account & Continue' : 'Sign In & Continue'}
                </Text>
              )}
            </Pressable>

            <Pressable
              onPress={() => { setMode(mode === 'create' ? 'signin' : 'create'); setFormError(''); }}
              disabled={busy}
              style={{ marginTop: 14 }}
            >
              <Text style={s.linkText}>
                {mode === 'create' ? 'Already have an account? Sign in' : 'New here? Create an account'}
              </Text>
            </Pressable>
          </>
        )}
      </View>

      {/* Footer */}
      <View style={{ position: 'absolute', bottom: 24 }}>
        <Text style={{ color: '#4A5568', fontSize: 11 }}>Powered by GoArrive</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#161B25',
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },
  title: {
    color: '#FFF',
    fontSize: 24,
    fontWeight: '700',
    fontFamily: FH,
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    color: MUTED,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 24,
  },
  input: {
    width: '100%',
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#FFF',
    fontSize: 15,
    marginBottom: 12,
  },
  errorText: {
    color: '#E05252',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 12,
  },
  ctaBtn: {
    backgroundColor: GOLD,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignItems: 'center',
    width: '100%',
  },
  ctaBtnText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: FH,
  },
  linkText: {
    color: PRIMARY,
    fontSize: 14,
    fontWeight: '600',
  },
});
