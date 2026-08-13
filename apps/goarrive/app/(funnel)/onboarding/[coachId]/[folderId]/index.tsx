/**
 * Onboarding Questionnaire — 3-step wizard before Stripe checkout
 *
 * Route: /onboarding/<coachId>/<folderId>?ref=&source=
 *
 * Step 1: Basic info (name, email, DOB, gender)
 * Step 2: Equipment / level (coach-configured subscriptionPaths)
 * Step 3: Schedule (days of week + time of day)
 *
 * On submit writes onboarding_submissions + drip_email_queue, then redirects
 * to /checkout/[submissionId] (PR-H owns the actual Stripe checkout page).
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import {
  collection,
  doc,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../../../../lib/firebase';
import type { PlaybookFolder, PlaybookFolderSubscriptionPath } from '../../../../../lib/types';

const FONT_HEADING =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_BODY =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

const STEPS = ['Basic Info', 'Program Type', 'Schedule'];

const DAYS = [
  { label: 'Sun', value: 0 },
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
];

const GENDER_OPTIONS = [
  { label: 'Male', value: 'male' },
  { label: 'Female', value: 'female' },
  { label: 'Other', value: 'other' },
  { label: 'Prefer not to say', value: 'prefer-not-to-say' },
];

interface FormData {
  firstName: string;
  lastName: string;
  email: string;
  dateOfBirth: string;
  gender: string;
  subscriptionPathId: string;
  scheduleDaysOfWeek: number[];
  scheduleTimeOfDay: string;
}

const initialFormData: FormData = {
  firstName: '',
  lastName: '',
  email: '',
  dateOfBirth: '',
  gender: '',
  subscriptionPathId: '',
  scheduleDaysOfWeek: [],
  scheduleTimeOfDay: '08:00',
};

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export default function OnboardingQuestionnaire() {
  const { coachId, folderId, ref: refParam, source } = useLocalSearchParams<{
    coachId: string;
    folderId: string;
    ref?: string;
    source?: string;
  }>();

  const storageKey = `onboarding-draft-${coachId}-${folderId}`;

  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [folder, setFolder] = useState<PlaybookFolder | null>(null);
  const [folderLoading, setFolderLoading] = useState(true);
  const [coachBrand, setCoachBrand] = useState<{
    displayName: string;
    brandColor: string | null;
  } | null>(null);

  const accent = coachBrand?.brandColor || '#F5A623';
  const scrollRef = React.useRef<ScrollView>(null);

  // Load coach brand + folder via server callable (unauth-safe)
  useEffect(() => {
    if (!coachId || !folderId) return;
    const getFunnelFolder = httpsCallable<
      { coachId: string; folderId: string },
      {
        folder: {
          id: string;
          name: string;
          subscriptionPaths: PlaybookFolder['subscriptionPaths'];
          emailTemplate: { subject: string; body: string } | null;
          funnelPhotoUrl: string | null;
          campaignName: string | null;
        };
        coach: {
          id: string;
          displayName: string;
          brandColor: string | null;
          funnelPhotoUrl: string | null;
        };
      }
    >(getFunctions(), 'getFunnelFolder');
    getFunnelFolder({ coachId, folderId })
      .then(({ data }) => {
        setCoachBrand({
          displayName: data.coach.displayName,
          brandColor: data.coach.brandColor,
        });
        setFolder({
          id: data.folder.id,
          coachId,
          name: data.folder.name,
          subscriptionPaths: data.folder.subscriptionPaths,
          emailTemplate: data.folder.emailTemplate as PlaybookFolder['emailTemplate'],
          // Fields not projected by the callable — fill with safe defaults
          type: 'playbook_folder',
          parentId: null,
          templatePlaybookIds: [],
          syncEnabled: false,
          linkedShareTokenIds: [],
          isArchived: false,
          createdAt: null as any,
          updatedAt: null as any,
        } as PlaybookFolder);
      })
      .catch(() => { /* non-blocking */ })
      .finally(() => setFolderLoading(false));
  }, [coachId, folderId]);

  // SSR-safe localStorage restore after mount
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof localStorage === 'undefined') {
      setHydrated(true);
      return;
    }
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft?.formData) setFormData(draft.formData);
        if (typeof draft?.step === 'number') setStep(draft.step);
      }
    } catch { /* ignore */ }
    setHydrated(true);
  }, [storageKey]);

  // Persist to localStorage on every change
  useEffect(() => {
    if (!hydrated || Platform.OS !== 'web' || typeof localStorage === 'undefined') return;
    try { localStorage.setItem(storageKey, JSON.stringify({ step, formData })); } catch { /* ignore */ }
  }, [step, formData, storageKey, hydrated]);

  const updateField = useCallback(<K extends keyof FormData>(field: K, value: FormData[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => { const e = { ...prev }; delete e[field]; return e; });
    }
  }, [errors]);

  const validateStep = useCallback((): boolean => {
    const errs: Record<string, string> = {};
    if (step === 0) {
      if (!formData.firstName.trim()) errs.firstName = 'First name is required';
      if (!formData.lastName.trim()) errs.lastName = 'Last name is required';
      if (!formData.email.trim()) errs.email = 'Email is required';
      else if (!isValidEmail(formData.email)) errs.email = 'Enter a valid email address';
      if (!formData.dateOfBirth) errs.dateOfBirth = 'Date of birth is required';
      if (!formData.gender) errs.gender = 'Please select a gender';
    } else if (step === 1) {
      if (!formData.subscriptionPathId) errs.subscriptionPathId = 'Please select a program type';
    } else if (step === 2) {
      if (formData.scheduleDaysOfWeek.length === 0) errs.scheduleDaysOfWeek = 'Select at least one day';
      if (!formData.scheduleTimeOfDay) errs.scheduleTimeOfDay = 'Select a preferred time';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [step, formData]);

  const handleNext = useCallback(() => {
    if (!validateStep()) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, [validateStep]);

  const handleBack = useCallback(() => {
    setStep((s) => Math.max(s - 1, 0));
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!validateStep()) return;
    if (!coachId || !folderId) return;
    setSubmitting(true);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const submissionData = {
        coachId,
        folderId,
        subscriptionPathId: formData.subscriptionPathId,
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        email: formData.email.trim().toLowerCase(),
        dateOfBirth: formData.dateOfBirth,
        gender: formData.gender,
        scheduleDaysOfWeek: formData.scheduleDaysOfWeek,
        scheduleTimeOfDay: formData.scheduleTimeOfDay,
        timezone,
        ref: refParam || null,
        source: source || null,
        status: 'pending_checkout',
        createdAt: serverTimestamp(),
      };

      const submissionRef = await addDoc(collection(db, 'onboarding_submissions'), submissionData);
      const submissionId = submissionRef.id;

      // TODO: PR-I wires the sender — for now queue a drip email doc
      await addDoc(collection(db, 'drip_email_queue'), {
        submissionId,
        coachId,
        folderId,
        email: formData.email.trim().toLowerCase(),
        firstName: formData.firstName.trim(),
        status: 'queued',
        scheduledFor: serverTimestamp(),
        createdAt: serverTimestamp(),
      });

      // Clear draft on successful submit
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
      }

      // PR-H owns /checkout/[submissionId]; redirect there
      router.replace(`/checkout/${submissionId}`);
    } catch (err) {
      console.error('Submission error', err);
      setErrors({ submit: 'Something went wrong. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  }, [coachId, folderId, formData, refParam, source, storageKey, validateStep]);

  if (!hydrated || folderLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#F5A623" size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: accent }]}>
        {coachBrand?.displayName ? (
          <Text style={styles.coachName}>{coachBrand.displayName}</Text>
        ) : null}
        <Text style={styles.headerTitle}>Get Started</Text>
      </View>

      {/* Step indicator */}
      <View style={styles.stepRow}>
        {STEPS.map((label, i) => (
          <View key={label} style={styles.stepItem}>
            <View style={[styles.stepDot, i <= step ? { backgroundColor: accent } : {}]}>
              <Text style={[styles.stepDotText, i <= step ? { color: '#000' } : {}]}>
                {i + 1}
              </Text>
            </View>
            <Text style={[styles.stepLabel, i === step ? { color: accent } : {}]}>{label}</Text>
          </View>
        ))}
      </View>

      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {step === 0 && (
          <StepBasicInfo
            formData={formData}
            errors={errors}
            accent={accent}
            onUpdate={updateField}
          />
        )}
        {step === 1 && (
          <StepProgramType
            folder={folder}
            formData={formData}
            errors={errors}
            accent={accent}
            onUpdate={updateField}
          />
        )}
        {step === 2 && (
          <StepSchedule
            formData={formData}
            errors={errors}
            accent={accent}
            onUpdate={updateField}
          />
        )}

        {errors.submit ? (
          <Text style={styles.submitError}>{errors.submit}</Text>
        ) : null}

        {/* Nav buttons */}
        <View style={styles.navRow}>
          {step > 0 ? (
            <Pressable style={styles.backBtn} onPress={handleBack}>
              <Text style={styles.backBtnText}>Back</Text>
            </Pressable>
          ) : (
            <View style={styles.backBtnPlaceholder} />
          )}
          {step < STEPS.length - 1 ? (
            <Pressable style={[styles.nextBtn, { backgroundColor: accent }]} onPress={handleNext}>
              <Text style={styles.nextBtnText}>Next</Text>
            </Pressable>
          ) : (
            <Pressable
              style={[styles.nextBtn, { backgroundColor: accent }, submitting ? styles.disabledBtn : {}]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#000" size="small" />
              ) : (
                <Text style={styles.nextBtnText}>Continue to Payment</Text>
              )}
            </Pressable>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Step 1: Basic Info ───────────────────────────────────────────────────────

interface StepBasicInfoProps {
  formData: FormData;
  errors: Record<string, string>;
  accent: string;
  onUpdate: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
}

function StepBasicInfo({ formData, errors, accent, onUpdate }: StepBasicInfoProps) {
  return (
    <View>
      <Text style={styles.stepTitle}>Tell us about yourself</Text>

      <View style={styles.row}>
        <View style={[styles.fieldHalf, { marginRight: 8 }]}>
          <Text style={styles.label}>First Name *</Text>
          <TextInput
            style={[styles.input, errors.firstName ? styles.inputError : {}]}
            value={formData.firstName}
            onChangeText={(v) => onUpdate('firstName', v)}
            placeholder="Jane"
            placeholderTextColor="#555"
            autoCapitalize="words"
          />
          {errors.firstName ? <Text style={styles.errorText}>{errors.firstName}</Text> : null}
        </View>
        <View style={styles.fieldHalf}>
          <Text style={styles.label}>Last Name *</Text>
          <TextInput
            style={[styles.input, errors.lastName ? styles.inputError : {}]}
            value={formData.lastName}
            onChangeText={(v) => onUpdate('lastName', v)}
            placeholder="Smith"
            placeholderTextColor="#555"
            autoCapitalize="words"
          />
          {errors.lastName ? <Text style={styles.errorText}>{errors.lastName}</Text> : null}
        </View>
      </View>

      <Text style={styles.label}>Email *</Text>
      <TextInput
        style={[styles.input, errors.email ? styles.inputError : {}]}
        value={formData.email}
        onChangeText={(v) => onUpdate('email', v)}
        placeholder="jane@example.com"
        placeholderTextColor="#555"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {errors.email ? <Text style={styles.errorText}>{errors.email}</Text> : null}

      <Text style={styles.label}>Date of Birth *</Text>
      <TextInput
        style={[styles.input, errors.dateOfBirth ? styles.inputError : {}]}
        value={formData.dateOfBirth}
        onChangeText={(v) => onUpdate('dateOfBirth', v)}
        placeholder="YYYY-MM-DD"
        placeholderTextColor="#555"
        keyboardType={Platform.OS === 'web' ? 'default' : 'numbers-and-punctuation'}
      />
      {errors.dateOfBirth ? <Text style={styles.errorText}>{errors.dateOfBirth}</Text> : null}

      <Text style={styles.label}>Gender *</Text>
      <View style={styles.radioGroup} pointerEvents="box-none">
        {GENDER_OPTIONS.map((opt) => (
          <Pressable
            key={opt.value}
            style={[
              styles.radioCard,
              formData.gender === opt.value ? { borderColor: accent } : {},
            ]}
            onPress={() => onUpdate('gender', opt.value)}
          >
            <View style={[styles.radioCircle, formData.gender === opt.value ? { borderColor: accent } : {}]}>
              {formData.gender === opt.value && (
                <View style={[styles.radioFill, { backgroundColor: accent }]} />
              )}
            </View>
            <Text style={styles.radioLabel}>{opt.label}</Text>
          </Pressable>
        ))}
      </View>
      {errors.gender ? <Text style={styles.errorText}>{errors.gender}</Text> : null}
    </View>
  );
}

// ─── Step 2: Program Type ─────────────────────────────────────────────────────

interface StepProgramTypeProps {
  folder: PlaybookFolder | null;
  formData: FormData;
  errors: Record<string, string>;
  accent: string;
  onUpdate: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
}

function StepProgramType({ folder, formData, errors, accent, onUpdate }: StepProgramTypeProps) {
  const paths: PlaybookFolderSubscriptionPath[] = folder?.subscriptionPaths ?? [];

  if (!folder) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Program not found. Please contact your coach.</Text>
      </View>
    );
  }

  if (paths.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.stepTitle}>Program Options</Text>
        <Text style={[styles.label, { marginTop: 16, textAlign: 'center' }]}>
          Program not configured — please contact coach.
        </Text>
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.stepTitle}>Choose your program type</Text>
      <Text style={[styles.label, { marginBottom: 16 }]}>
        Select the option that best matches your equipment and fitness level.
      </Text>
      {paths.map((path) => (
        <Pressable
          key={path.id}
          style={[
            styles.pathCard,
            formData.subscriptionPathId === path.id ? { borderColor: accent } : {},
          ]}
          onPress={() => onUpdate('subscriptionPathId', path.id)}
        >
          <View style={[styles.radioCircle, formData.subscriptionPathId === path.id ? { borderColor: accent } : {}]}>
            {formData.subscriptionPathId === path.id && (
              <View style={[styles.radioFill, { backgroundColor: accent }]} />
            )}
          </View>
          <Text style={styles.pathLabel}>{path.label}</Text>
        </Pressable>
      ))}
      {errors.subscriptionPathId ? (
        <Text style={styles.errorText}>{errors.subscriptionPathId}</Text>
      ) : null}
    </View>
  );
}

// ─── Step 3: Schedule ─────────────────────────────────────────────────────────

interface StepScheduleProps {
  formData: FormData;
  errors: Record<string, string>;
  accent: string;
  onUpdate: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
}

function StepSchedule({ formData, errors, accent, onUpdate }: StepScheduleProps) {
  const toggleDay = useCallback((dayValue: number) => {
    const current = formData.scheduleDaysOfWeek;
    const next = current.includes(dayValue)
      ? current.filter((d) => d !== dayValue)
      : [...current, dayValue].sort((a, b) => a - b);
    onUpdate('scheduleDaysOfWeek', next);
  }, [formData.scheduleDaysOfWeek, onUpdate]);

  return (
    <View>
      <Text style={styles.stepTitle}>When do you want to train?</Text>
      <Text style={[styles.label, { marginBottom: 12 }]}>
        Pick the days you plan to work out each week (select at least one).
      </Text>

      <View style={styles.dayRow}>
        {DAYS.map((day) => {
          const selected = formData.scheduleDaysOfWeek.includes(day.value);
          return (
            <Pressable
              key={day.value}
              style={[styles.dayBtn, selected ? { backgroundColor: accent } : {}]}
              onPress={() => toggleDay(day.value)}
            >
              <Text style={[styles.dayBtnText, selected ? { color: '#000' } : {}]}>
                {day.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {errors.scheduleDaysOfWeek ? (
        <Text style={styles.errorText}>{errors.scheduleDaysOfWeek}</Text>
      ) : null}

      <Text style={[styles.label, { marginTop: 24 }]}>
        Preferred workout time (your local time)
      </Text>
      <TextInput
        style={[styles.input, errors.scheduleTimeOfDay ? styles.inputError : {}]}
        value={formData.scheduleTimeOfDay}
        onChangeText={(v) => onUpdate('scheduleTimeOfDay', v)}
        placeholder="HH:MM"
        placeholderTextColor="#555"
        keyboardType={Platform.OS === 'web' ? 'default' : 'numbers-and-punctuation'}
        maxLength={5}
      />
      {errors.scheduleTimeOfDay ? (
        <Text style={styles.errorText}>{errors.scheduleTimeOfDay}</Text>
      ) : null}
      <Text style={styles.hint}>
        We will schedule your drip content around this time.
      </Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0E1117',
  } as ViewStyle,
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  } as ViewStyle,
  header: {
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F5A623',
  } as ViewStyle,
  coachName: {
    fontFamily: FONT_BODY,
    fontSize: 13,
    color: '#888',
    marginBottom: 2,
  } as TextStyle,
  headerTitle: {
    fontFamily: FONT_HEADING,
    fontSize: 22,
    color: '#FFFFFF',
    fontWeight: '700',
  } as TextStyle,
  stepRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 8,
    gap: 8,
  } as ViewStyle,
  stepItem: {
    alignItems: 'center',
    flex: 1,
  } as ViewStyle,
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1E2129',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  } as ViewStyle,
  stepDotText: {
    fontFamily: FONT_BODY,
    fontSize: 12,
    color: '#555',
    fontWeight: '600',
  } as TextStyle,
  stepLabel: {
    fontFamily: FONT_BODY,
    fontSize: 11,
    color: '#555',
    textAlign: 'center',
  } as TextStyle,
  scroll: {
    flex: 1,
  } as ViewStyle,
  scrollContent: {
    padding: 24,
    paddingBottom: 80,
  } as ViewStyle,
  stepTitle: {
    fontFamily: FONT_HEADING,
    fontSize: 20,
    color: '#FFFFFF',
    fontWeight: '700',
    marginBottom: 20,
  } as TextStyle,
  row: {
    flexDirection: 'row',
  } as ViewStyle,
  fieldHalf: {
    flex: 1,
  } as ViewStyle,
  label: {
    fontFamily: FONT_BODY,
    fontSize: 14,
    color: '#CCCCCC',
    marginBottom: 6,
    marginTop: 4,
  } as TextStyle,
  input: {
    backgroundColor: '#1E2129',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2E3340',
    color: '#FFFFFF',
    fontFamily: FONT_BODY,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 4,
  } as TextStyle,
  inputError: {
    borderColor: '#EF4444',
  } as ViewStyle,
  errorText: {
    fontFamily: FONT_BODY,
    fontSize: 12,
    color: '#EF4444',
    marginBottom: 8,
    marginTop: 2,
  } as TextStyle,
  radioGroup: {
    gap: 8,
    marginBottom: 4,
  } as ViewStyle,
  radioCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E2129',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2E3340',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  } as ViewStyle,
  radioCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#2E3340',
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,
  radioFill: {
    width: 8,
    height: 8,
    borderRadius: 4,
  } as ViewStyle,
  radioLabel: {
    fontFamily: FONT_BODY,
    fontSize: 14,
    color: '#FFFFFF',
  } as TextStyle,
  pathCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E2129',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#2E3340',
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 10,
    gap: 12,
  } as ViewStyle,
  pathLabel: {
    fontFamily: FONT_HEADING,
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '600',
    flex: 1,
  } as TextStyle,
  dayRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  } as ViewStyle,
  dayBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1E2129',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2E3340',
  } as ViewStyle,
  dayBtnText: {
    fontFamily: FONT_BODY,
    fontSize: 12,
    color: '#888',
    fontWeight: '600',
  } as TextStyle,
  hint: {
    fontFamily: FONT_BODY,
    fontSize: 12,
    color: '#555',
    marginTop: 6,
    marginBottom: 8,
  } as TextStyle,
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 32,
    gap: 12,
  } as ViewStyle,
  backBtn: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: '#1E2129',
    borderWidth: 1,
    borderColor: '#2E3340',
  } as ViewStyle,
  backBtnText: {
    fontFamily: FONT_BODY,
    fontSize: 15,
    color: '#AAAAAA',
    fontWeight: '600',
  } as TextStyle,
  backBtnPlaceholder: {
    flex: 1,
  } as ViewStyle,
  nextBtn: {
    flex: 2,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 10,
  } as ViewStyle,
  nextBtnText: {
    fontFamily: FONT_HEADING,
    fontSize: 15,
    color: '#000000',
    fontWeight: '700',
  } as TextStyle,
  disabledBtn: {
    opacity: 0.6,
  } as ViewStyle,
  submitError: {
    fontFamily: FONT_BODY,
    fontSize: 14,
    color: '#EF4444',
    textAlign: 'center',
    marginTop: 8,
  } as TextStyle,
});
