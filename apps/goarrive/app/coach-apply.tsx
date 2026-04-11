/**
 * Coach Application screen — /coach-apply
 *
 * Public page (no auth required). Collects coach interest form data
 * and saves it to the `coachApplications` Firestore collection for
 * admin review. Styled to match the existing coach-signup page.
 */
import React, { useState } from 'react';
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
import { router } from 'expo-router';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';

const FONT_HEADING =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_BODY =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

export default function CoachApplyScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [experience, setExperience] = useState('');
  const [certifications, setCertifications] = useState('');
  const [why, setWhy] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  async function handleSubmit() {
    if (!name.trim() || !email.trim()) {
      setError('Please fill in at least your name and email.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await addDoc(collection(db, 'coachApplications'), {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        experience: experience.trim(),
        certifications: certifications.trim(),
        why: why.trim(),
        status: 'pending',
        createdAt: serverTimestamp(),
      });

      setSuccess(true);
    } catch (err: any) {
      setError('Something went wrong. Please try again or email coaches@goa.fit directly.');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <View style={s.root}>
        <View style={s.successContainer}>
          <Text style={s.successIcon}>✓</Text>
          <Text style={s.successTitle}>Application Received</Text>
          <Text style={s.successBody}>
            Thank you for your interest in coaching with GoArrive. We review every application personally and will be in touch soon.
          </Text>
          <Pressable
            style={[s.submitBtn, { marginTop: 24, paddingHorizontal: 32 }]}
            onPress={() => router.replace('/')}
          >
            <Text style={s.submitBtnText}>Back to Home</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={s.header}>
          <Pressable onPress={() => router.replace('/')}>
            <Image
              source={require('../assets/logo.png')}
              style={s.logo}
              resizeMode="contain"
              accessibilityLabel="GoArrive"
            />
          </Pressable>
          <Text style={s.title}>Apply to Coach with GoArrive</Text>
          <Text style={s.subtitle}>
            We are selectively growing our coaching team. Tell us about yourself and we will be in touch.
          </Text>
        </View>

        {/* Form */}
        <View style={s.card}>
          <View style={s.fieldWrap}>
            <Text style={s.label}>Full Name *</Text>
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
            <Text style={s.label}>Email Address *</Text>
            <TextInput
              style={s.input}
              placeholder="your@email.com"
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
            <Text style={s.label}>Phone Number</Text>
            <TextInput
              style={s.input}
              placeholder="(optional)"
              placeholderTextColor="#4A5568"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              editable={!loading}
            />
          </View>

          <View style={s.fieldWrap}>
            <Text style={s.label}>Coaching Experience</Text>
            <TextInput
              style={[s.input, s.textArea]}
              placeholder="How long have you been coaching? What kind of coaching do you do?"
              placeholderTextColor="#4A5568"
              value={experience}
              onChangeText={setExperience}
              multiline
              numberOfLines={3}
              editable={!loading}
            />
          </View>

          <View style={s.fieldWrap}>
            <Text style={s.label}>Certifications</Text>
            <TextInput
              style={s.input}
              placeholder="e.g. NASM-CPT, CSCS, etc. (optional)"
              placeholderTextColor="#4A5568"
              value={certifications}
              onChangeText={setCertifications}
              editable={!loading}
            />
          </View>

          <View style={s.fieldWrap}>
            <Text style={s.label}>Why GoArrive?</Text>
            <TextInput
              style={[s.input, s.textArea]}
              placeholder="What interests you about coaching with GoArrive?"
              placeholderTextColor="#4A5568"
              value={why}
              onChangeText={setWhy}
              multiline
              numberOfLines={3}
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
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#0E1117" size="small" />
            ) : (
              <Text style={s.submitBtnText}>Submit Application</Text>
            )}
          </Pressable>

          <Text style={s.noteText}>
            We review every application personally. Coach positions are selective.
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
    maxWidth: 340,
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
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
    paddingTop: 12,
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
    backgroundColor: '#7BA05B',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    fontFamily: FONT_HEADING,
  },
  noteText: {
    fontSize: 13,
    color: '#6B7280',
    fontFamily: FONT_BODY,
    textAlign: 'center',
    fontStyle: 'italic',
  },
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
    maxWidth: 320,
  },
});
