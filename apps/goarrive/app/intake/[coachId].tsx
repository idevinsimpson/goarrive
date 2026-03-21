/**
 * Intake Form — Public multi-step intake wizard
 *
 * Accessible at /intake/{coachId} — no authentication required.
 * This is the unified intake form that combines the JotForm comprehensiveness
 * with the Plan Forge's modern multi-step UX.
 *
 * Phase 3 implementation — 8-step wizard:
 *   1. About You (Personal Information)
 *   2. Work & Lifestyle
 *   3. Health & Medical History
 *   4. Diet & Current Routine
 *   5. Fitness Goals
 *   6. Motivation & Readiness
 *   7. Scheduling & Availability
 *   8. Create Account (email + password)
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
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import {
  createUserWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import {
  doc,
  setDoc,
  collection,
  Timestamp,
} from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';

const FONT_HEADING =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_BODY =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

const STEPS = [
  'About You',
  'Work & Lifestyle',
  'Health History',
  'Diet & Routine',
  'Fitness Goals',
  'Motivation',
  'Scheduling',
  'Create Account',
];

// Goal options
const GOAL_OPTIONS = [
  'Feel healthier',
  'Fat loss',
  'Build muscle',
  'Improve endurance',
  'Lower stress',
  'Better sleep',
  'More energy',
  'Increase flexibility',
  'Build confidence',
  'Manage pain',
  'Sport-specific training',
];

// Injury options
const INJURY_OPTIONS = [
  'Shoulder',
  'Back (lower)',
  'Back (upper)',
  'Knee',
  'Hip',
  'Wrist/Hand',
  'Ankle/Foot',
  'Neck',
  'Elbow',
  'None',
];

// Energy level options
const ENERGY_OPTIONS = ['Very low', 'Low', 'Moderate', 'High', 'Very high'];
const STRESS_OPTIONS = ['Very low', 'Low', 'Moderate', 'High', 'Very high'];

// Diet options
const DIET_OPTIONS = [
  'Low-fat',
  'Low-carb',
  'High-protein',
  'Vegetarian/Vegan',
  'No special diet',
  'Other',
];

// Activity level options
const ACTIVITY_LEVELS = ['Low', 'Moderate', 'High'];

interface FormData {
  // Step 1: About You
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  gender: string;
  dateOfBirth: string;
  heightFeet: string;
  heightInches: string;
  weight: string;
  // Step 2: Work & Lifestyle
  occupation: string;
  activityLevel: string;
  workSchedule: string;
  physicalActivities: string;
  // Step 3: Health & Medical
  healthProblems: string;
  medications: string;
  therapies: string;
  currentInjuries: string;
  injuries: string[];
  stressMotivation: string;
  familyHeartDisease: string;
  familyDiseases: string;
  familyDiseasesDetail: string;
  diabetes: string;
  asthma: string;
  cardiovascular: string;
  medicalExplanation: string;
  smoker: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  // Step 4: Diet & Routine
  currentDiet: string[];
  currentRoutine: string;
  energyLevel: string[];
  stressLevel: string[];
  // Step 5: Fitness Goals
  primaryGoals: string[];
  goalWeight: string;
  specificGoals: string;
  // Step 6: Motivation
  whyStatement: string;
  readinessForChange: number;
  motivation: number;
  gymConfidence: number;
  // Step 7: Scheduling
  preferredDays: string[];
  preferredTime: string;
  sessionsPerWeek: string;
  gym: string;
  // Step 8: Account
  password: string;
  confirmPassword: string;
}

const initialFormData: FormData = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  gender: '',
  dateOfBirth: '',
  heightFeet: '',
  heightInches: '',
  weight: '',
  occupation: '',
  activityLevel: '',
  workSchedule: '',
  physicalActivities: '',
  healthProblems: '',
  medications: '',
  therapies: '',
  currentInjuries: '',
  injuries: [],
  stressMotivation: '',
  familyHeartDisease: '',
  familyDiseases: '',
  familyDiseasesDetail: '',
  diabetes: '',
  asthma: '',
  cardiovascular: '',
  medicalExplanation: '',
  smoker: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  currentDiet: [],
  currentRoutine: '',
  energyLevel: [],
  stressLevel: [],
  primaryGoals: [],
  goalWeight: '',
  specificGoals: '',
  whyStatement: '',
  readinessForChange: 7,
  motivation: 8,
  gymConfidence: 7,
  preferredDays: [],
  preferredTime: '',
  sessionsPerWeek: '',
  gym: '',
  password: '',
  confirmPassword: '',
};

export default function IntakeForm() {
  const { coachId } = useLocalSearchParams<{ coachId: string }>();

  // SSR-safe localStorage: always start with default state, restore after mount
  const storageKey = `intake_draft_${coachId || 'unknown'}`;
  const [step, setStep] = useState<number>(0);
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const scrollRef = React.useRef<ScrollView>(null);

  // Restore saved draft from localStorage after hydration (client-side only)
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

  // Persist form state to localStorage on every change (web only, after hydration)
  useEffect(() => {
    if (!hydrated || Platform.OS !== 'web' || typeof localStorage === 'undefined') return;
    // Don't persist password fields
    const toSave = { step, formData: { ...formData, password: '', confirmPassword: '' } };
    try { localStorage.setItem(storageKey, JSON.stringify(toSave)); } catch { /* ignore */ }
  }, [step, formData, storageKey, hydrated]);

  const updateField = useCallback(
    (field: keyof FormData, value: any) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      if (errors[field]) {
        setErrors((prev) => {
          const newErrors = { ...prev };
          delete newErrors[field];
          return newErrors;
        });
      }
    },
    [errors]
  );

  const toggleArrayItem = useCallback(
    (field: keyof FormData, item: string) => {
      const arr = formData[field] as string[];
      if (arr.includes(item)) {
        updateField(field, arr.filter((x) => x !== item));
      } else {
        updateField(field, [...arr, item]);
      }
    },
    [formData, updateField]
  );

  function validateStep(): boolean {
    const newErrors: Record<string, string> = {};

    if (step === 0) {
      if (!formData.firstName.trim())
        newErrors.firstName = 'First name required';
      if (!formData.lastName.trim())
        newErrors.lastName = 'Last name required';
      if (!formData.email.trim()) newErrors.email = 'Email required';
      if (!formData.phone.trim()) newErrors.phone = 'Phone required';
      if (!formData.gender) newErrors.gender = 'Gender required';
      if (!formData.dateOfBirth.trim())
        newErrors.dateOfBirth = 'Date of birth required';
      if (!formData.heightFeet.trim())
        newErrors.heightFeet = 'Height required';
      if (!formData.weight.trim()) newErrors.weight = 'Weight required';
    } else if (step === 4) {
      if (formData.primaryGoals.length === 0) {
        newErrors.primaryGoals = 'Please select at least one goal';
      }
    } else if (step === 7) {
      if (!formData.password) newErrors.password = 'Password required';
      if (!formData.confirmPassword)
        newErrors.confirmPassword = 'Confirm password required';
      if (
        formData.password &&
        formData.confirmPassword &&
        formData.password !== formData.confirmPassword
      ) {
        newErrors.confirmPassword = 'Passwords do not match';
      }
    }

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
    return Object.keys(newErrors).length === 0;
  }

  function handleNext() {
    if (validateStep()) {
      setStep((s) => s + 1);
    }
  }

  function handleBack() {
    setStep((s) => Math.max(0, s - 1));
  }

  async function handleSubmit() {
    if (!validateStep()) return;

    setSubmitting(true);
    try {
      if (!formData.password || formData.password !== formData.confirmPassword) {
        setErrors({ submit: 'Passwords do not match' });
        return;
      }

      const userCred = await createUserWithEmailAndPassword(
        auth,
        formData.email,
        formData.password
      );

      await updateProfile(userCred.user, {
        displayName: `${formData.firstName} ${formData.lastName}`,
      });

      const memberRef = doc(
        collection(db, 'members'),
        userCred.user.uid
      );
      await setDoc(memberRef, {
        uid: userCred.user.uid,
        coachId: coachId || 'unassigned',
        email: formData.email,
        displayName: `${formData.firstName} ${formData.lastName}`,
        phone: formData.phone,
        gender: formData.gender,
        dateOfBirth: formData.dateOfBirth,
        height: `${formData.heightFeet}'${formData.heightInches}"`,
        weight: formData.weight,
        role: 'member',
        createdAt: Timestamp.now(),
        isArchived: false,
      });

      const intakeRef = doc(
        collection(db, 'intakeSubmissions'),
        userCred.user.uid
      );
      await setDoc(intakeRef, {
        uid: userCred.user.uid,
        coachId: coachId || 'unassigned',
        ...formData,
        submittedAt: Timestamp.now(),
      });

      // Clear saved draft after successful submission
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
      }
      router.replace('/(member)/home');
    } catch (error: any) {
      setErrors({
        submit: error.message || 'Failed to create account',
      });
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  function renderTextField(
    label: string,
    field: keyof FormData,
    placeholder: string,
    options?: {
      multiline?: boolean;
      keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'numeric';
      required?: boolean;
      secureTextEntry?: boolean;
    }
  ) {
    const hasError = !!errors[field];

    const handleBlur = () => {
      if (!options?.required) return;
      const val = formData[field];
      const isEmpty = typeof val === 'string' ? val.trim() === '' : !val;
      if (isEmpty) {
        setErrors(prev => ({ ...prev, [field]: `${label} is required` }));
      } else {
        // Clear error if field is now valid
        setErrors(prev => { const e = { ...prev }; delete e[field]; return e; });
      }
    };

    return (
      <View style={s.fieldWrap}>
        <Text style={[s.fieldLabel, hasError && s.fieldLabelError]}>
          {label}
          {options?.required ? ' *' : ''}
        </Text>
        <TextInput
          style={[
            s.input,
            options?.multiline && s.inputMultiline,
            hasError && s.inputError,
          ]}
          placeholder={placeholder}
          placeholderTextColor="#4A5568"
          value={formData[field] as string}
          onChangeText={(v) => updateField(field, v as any)}
          onBlur={handleBlur}
          keyboardType={options?.keyboardType || 'default'}
          multiline={options?.multiline}
          numberOfLines={options?.multiline ? 4 : 1}
          secureTextEntry={options?.secureTextEntry}
          autoCapitalize={
            options?.keyboardType === 'email-address' ? 'none' : 'sentences'
          }
        />
        {hasError ? <Text style={s.errorText}>{errors[field]}</Text> : null}
      </View>
    );
  }

  function renderChipSelect(
    label: string,
    field: keyof FormData,
    options: string[],
    required?: boolean
  ) {
    const selected = formData[field] as string[];
    const hasError = !!errors[field];
    return (
      <View style={s.fieldWrap}>
        <Text style={[s.fieldLabel, hasError && s.fieldLabelError]}>
          {label}
          {required ? ' *' : ''}
        </Text>
        <View
          style={[s.chipContainer, hasError && s.chipContainerError]}
        >
          {options.map((opt) => (
            <Pressable
              key={opt}
              style={[
                s.chip,
                selected.includes(opt) && s.chipSelected,
              ]}
              onPress={() => toggleArrayItem(field, opt)}
            >
              <Text
                style={[
                  s.chipText,
                  selected.includes(opt) && s.chipTextSelected,
                ]}
              >
                {opt}
              </Text>
            </Pressable>
          ))}
        </View>
        {hasError ? <Text style={s.errorText}>{errors[field]}</Text> : null}
      </View>
    );
  }

  function renderYesNo(label: string, field: keyof FormData) {
    const value = formData[field] as string;
    return (
      <View style={s.fieldWrap}>
        <Text style={s.fieldLabel}>{label}</Text>
        <View style={s.yesNoRow}>
          {['Yes', 'No'].map((opt) => (
            <Pressable
              key={opt}
              style={[
                s.yesNoBtn,
                value === opt && s.yesNoBtnSelected,
              ]}
              onPress={() => updateField(field, opt as any)}
            >
              <Text
                style={[
                  s.yesNoBtnText,
                  value === opt && s.yesNoBtnTextSelected,
                ]}
              >
                {opt}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  function renderSlider(
    label: string,
    field: keyof FormData,
    min: number,
    max: number
  ) {
    const value = (formData[field] as number) || min;
    return (
      <View style={s.fieldWrap}>
        <Text style={s.fieldLabel}>{label}</Text>
        <View style={s.sliderRow}>
          <Text style={s.sliderValue}>{value}</Text>
          <input
            type="range"
            min={min}
            max={max}
            value={value}
            onChange={(e) =>
              updateField(field, parseInt(e.currentTarget.value))
            }
            style={{
              flex: 1,
              marginHorizontal: 12,
              height: 6,
              cursor: 'pointer',
            } as any}
          />
          <Text style={s.sliderMax}>{max}</Text>
        </View>
      </View>
    );
  }

  // Step renderers
  function renderStep0() {
    return (
      <View>
        <Text style={s.stepTitle}>Let's Get to Know You</Text>
        <Text style={s.stepDescription}>
          Tell us about yourself so your coach can personalize your
          experience.
        </Text>
        {renderTextField(
          'First Name',
          'firstName',
          'Enter your first name',
          { required: true }
        )}
        {renderTextField(
          'Last Name',
          'lastName',
          'Enter your last name',
          { required: true }
        )}
        {renderTextField(
          'Email',
          'email',
          'you@example.com',
          { required: true, keyboardType: 'email-address' }
        )}
        {renderTextField(
          'Phone Number',
          'phone',
          '(555) 123-4567',
          { required: true, keyboardType: 'phone-pad' }
        )}
        <View style={s.fieldWrap}>
          <Text
            style={[s.fieldLabel, !!errors.gender && s.fieldLabelError]}
          >
            Gender *
          </Text>
          <View
            style={[
              s.buttonRow,
              !!errors.gender && s.buttonRowError,
            ]}
          >
            {['Male', 'Female', 'Other'].map((g) => (
              <Pressable
                key={g}
                style={[
                  s.genderBtn,
                  formData.gender === g && s.genderBtnSelected,
                ]}
                onPress={() => updateField('gender', g)}
              >
                <Text
                  style={[
                    s.genderBtnText,
                    formData.gender === g && s.genderBtnTextSelected,
                  ]}
                >
                  {g}
                </Text>
              </Pressable>
            ))}
          </View>
          {errors.gender ? (
            <Text style={s.errorText}>{errors.gender}</Text>
          ) : null}
        </View>
        {renderTextField(
          'Date of Birth',
          'dateOfBirth',
          'MM/DD/YYYY',
          { required: true }
        )}
        <View style={s.fieldWrap}>
          <Text
            style={[
              s.fieldLabel,
              !!errors.heightFeet && s.fieldLabelError,
            ]}
          >
            Height *
          </Text>
          <View style={s.heightRow}>
            <TextInput
              style={[
                s.heightInput,
                !!errors.heightFeet && s.inputError,
              ]}
              placeholder="5"
              placeholderTextColor="#4A5568"
              value={formData.heightFeet}
              onChangeText={(v) => updateField('heightFeet', v)}
              keyboardType="numeric"
            />
            <Text style={s.heightLabel}>ft</Text>
            <TextInput
              style={s.heightInput}
              placeholder="10"
              placeholderTextColor="#4A5568"
              value={formData.heightInches}
              onChangeText={(v) => updateField('heightInches', v)}
              keyboardType="numeric"
            />
            <Text style={s.heightLabel}>in</Text>
          </View>
          {errors.heightFeet ? (
            <Text style={s.errorText}>{errors.heightFeet}</Text>
          ) : null}
        </View>
        {renderTextField(
          'Weight (lbs)',
          'weight',
          '180',
          { required: true, keyboardType: 'numeric' }
        )}
      </View>
    );
  }

  function renderStep1() {
    return (
      <View>
        <Text style={s.stepTitle}>Work & Lifestyle</Text>
        {renderTextField('Occupation', 'occupation', 'e.g., Software Engineer')}
        <View style={s.fieldWrap}>
          <Text style={s.fieldLabel}>Activity Level</Text>
          <View style={s.buttonRow}>
            {ACTIVITY_LEVELS.map((level) => (
              <Pressable
                key={level}
                style={[
                  s.activityBtn,
                  formData.activityLevel === level && s.activityBtnSelected,
                ]}
                onPress={() => updateField('activityLevel', level)}
              >
                <Text
                  style={[
                    s.activityBtnText,
                    formData.activityLevel === level &&
                      s.activityBtnTextSelected,
                  ]}
                >
                  {level}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        {renderTextField(
          'Work Schedule',
          'workSchedule',
          'e.g., 9-5 office'
        )}
        {renderTextField(
          'Physical Activities',
          'physicalActivities',
          'e.g., Running, swimming'
        )}
      </View>
    );
  }

  function renderStep2() {
    return (
      <View>
        <Text style={s.stepTitle}>Health & Medical History</Text>
        {renderYesNo('Any health problems?', 'healthProblems')}
        {renderTextField(
          'Medications',
          'medications',
          'List any medications',
          { multiline: true }
        )}
        {renderTextField(
          'Current Therapies',
          'therapies',
          'e.g., Physical therapy',
          { multiline: true }
        )}
        {renderChipSelect('Past Injuries', 'injuries', INJURY_OPTIONS)}
        {renderYesNo('Family history of heart disease?', 'familyHeartDisease')}
        {renderYesNo('Family history of diabetes?', 'diabetes')}
        {renderYesNo('Family history of asthma?', 'asthma')}
        {renderYesNo(
          'Family history of cardiovascular disease?',
          'cardiovascular'
        )}
        {renderYesNo('Current smoker?', 'smoker')}
        {renderTextField(
          'Emergency Contact Name',
          'emergencyContactName',
          'Full name'
        )}
        {renderTextField(
          'Emergency Contact Phone',
          'emergencyContactPhone',
          'Phone number'
        )}
      </View>
    );
  }

  function renderStep3() {
    return (
      <View>
        <Text style={s.stepTitle}>Diet & Current Routine</Text>
        {renderChipSelect('Diet Type', 'currentDiet', DIET_OPTIONS)}
        {renderTextField(
          'Current Routine',
          'currentRoutine',
          'Describe your typical day',
          { multiline: true }
        )}
        {renderChipSelect('Energy Level', 'energyLevel', ENERGY_OPTIONS)}
        {renderChipSelect('Stress Level', 'stressLevel', STRESS_OPTIONS)}
      </View>
    );
  }

  function renderStep4() {
    return (
      <View>
        <Text style={s.stepTitle}>Fitness Goals</Text>
        {renderChipSelect('Primary Goals', 'primaryGoals', GOAL_OPTIONS, true)}
        {renderTextField(
          'Goal Weight (lbs)',
          'goalWeight',
          '180',
          { keyboardType: 'numeric' }
        )}
        {renderTextField(
          'Specific Goals',
          'specificGoals',
          'Any other goals?',
          { multiline: true }
        )}
      </View>
    );
  }

  function renderStep5() {
    return (
      <View>
        <Text style={s.stepTitle}>Motivation & Readiness</Text>
        {renderTextField(
          'Why do you want to get fit?',
          'whyStatement',
          'Tell us your story',
          { multiline: true }
        )}
        {renderSlider(
          'Readiness for Change (1-10)',
          'readinessForChange',
          1,
          10
        )}
        {renderSlider('Motivation Level (1-10)', 'motivation', 1, 10)}
        {renderSlider('Gym Confidence (1-10)', 'gymConfidence', 1, 10)}
      </View>
    );
  }

  function renderStep6() {
    return (
      <View>
        <Text style={s.stepTitle}>Scheduling & Availability</Text>
        <View style={s.fieldWrap}>
          <Text style={s.fieldLabel}>Preferred Days</Text>
          <View style={s.chipContainer}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
              <Pressable
                key={day}
                style={[
                  s.chip,
                  formData.preferredDays.includes(day) && s.chipSelected,
                ]}
                onPress={() => toggleArrayItem('preferredDays', day)}
              >
                <Text
                  style={[
                    s.chipText,
                    formData.preferredDays.includes(day) &&
                      s.chipTextSelected,
                  ]}
                >
                  {day}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        {renderTextField(
          'Preferred Time',
          'preferredTime',
          'e.g., Morning, Evening'
        )}
        {renderTextField(
          'Sessions Per Week',
          'sessionsPerWeek',
          'e.g., 3',
          { keyboardType: 'numeric' }
        )}
        {renderTextField('Gym / Location', 'gym', 'Where do you train?')}
      </View>
    );
  }

  function renderStep7() {
    return (
      <View>
        <Text style={s.stepTitle}>Create Your Account</Text>
        {renderTextField(
          'Password',
          'password',
          'Create a password',
          { required: true, secureTextEntry: true }
        )}
        {renderTextField(
          'Confirm Password',
          'confirmPassword',
          'Confirm password',
          { required: true, secureTextEntry: true }
        )}
        {errors.submit ? (
          <Text style={[s.errorText, { textAlign: 'center', marginTop: 8 }]}>
            {errors.submit}
          </Text>
        ) : null}
      </View>
    );
  }

  const stepRenderers = [
    renderStep0,
    renderStep1,
    renderStep2,
    renderStep3,
    renderStep4,
    renderStep5,
    renderStep6,
    renderStep7,
  ];

  const isLastStep = step === STEPS.length - 1;

  // Prevent React hydration mismatch: don't render dynamic content until client has hydrated
  if (!hydrated && Platform.OS === 'web') {
    return (
      <View style={{ flex: 1, backgroundColor: '#0a0a0f', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#F5A623" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Progress Bar */}
      <View style={s.progressBar}>
        {Platform.OS === 'web' && (
          <img
            src="/goarrive-logo.png"
            alt="GoArrive"
            style={{
              height: 40,
              marginBottom: 12,
              objectFit: 'contain',
            } as any}
          />
        )}
        <View style={s.progressHeader}>
          <Text style={s.progressLabel}>{STEPS[step]}</Text>
          <Text style={s.progressCount}>
            {step + 1} of {STEPS.length}
          </Text>
        </View>
        <View style={s.progressTrack}>
          <View
            style={[
              s.progressFill,
              { width: `${((step + 1) / STEPS.length) * 100}%` },
            ]}
          />
        </View>
      </View>

      {/* Form Content — Scrollable container */}
      <View style={s.scrollContainer}>
        <ScrollView
          ref={scrollRef}
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {stepRenderers[step]()}
        </ScrollView>
      </View>

      {/* Navigation Buttons — Fixed at bottom */}
      <View style={s.navBar}>
        {step > 0 ? (
          <Pressable style={s.backBtn} onPress={handleBack}>
            <Text style={s.backBtnText}>Back</Text>
          </Pressable>
        ) : (
          <View />
        )}
        <Pressable
          style={[s.nextBtn, submitting && s.nextBtnDisabled]}
          onPress={isLastStep ? handleSubmit : handleNext}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#0E1117" size="small" />
          ) : (
            <Text style={s.nextBtnText}>
              {isLastStep ? 'Submit & Create Account' : 'Continue'}
            </Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0E1117',
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    height: '100vh',
  },
  progressBar: {
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'web' ? 16 : 60,
    paddingBottom: 12,
    backgroundColor: '#0E1117',
    borderBottomWidth: 1,
    borderBottomColor: '#1E2A3A',
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  progressLabel: {
    fontSize: 13,
    color: '#A0AEC0',
    fontFamily:
      Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined,
  },
  progressCount: {
    fontSize: 13,
    color: '#718096',
    fontFamily:
      Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined,
  },
  progressTrack: {
    height: 4,
    backgroundColor: '#1E2A3A',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#F5A623',
    borderRadius: 2,
  },
  scrollContainer: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 100,
    maxWidth: 520,
    alignSelf: 'center',
    width: '100%',
  },
  stepTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F0F4F8',
    marginBottom: 8,
    fontFamily:
      Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : undefined,
  },
  stepDescription: {
    fontSize: 14,
    color: '#A0AEC0',
    marginBottom: 20,
    lineHeight: 20,
    fontFamily:
      Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined,
  },
  fieldWrap: {
    marginBottom: 20,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#CBD5E0',
    marginBottom: 8,
    fontFamily:
      Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined,
  },
  input: {
    backgroundColor: '#FFFACD',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0E1117',
    borderWidth: 1,
    borderColor: 'transparent',
    fontFamily:
      Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined,
  },
  inputError: {
    borderColor: '#FC8181',
    backgroundColor: '#FFF5F5',
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  fieldLabelError: {
    color: '#FC8181',
  },
  errorText: {
    fontSize: 12,
    color: '#FC8181',
    marginTop: 4,
    fontWeight: '500',
    fontFamily:
      Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined,
  },
  chipContainerError: {
    borderWidth: 1,
    borderColor: '#FC8181',
    borderRadius: 12,
    padding: 8,
    backgroundColor: 'rgba(252, 129, 129, 0.05)',
  },
  buttonRowError: {
    borderWidth: 1,
    borderColor: '#FC8181',
    borderRadius: 12,
    padding: 8,
    backgroundColor: 'rgba(252, 129, 129, 0.05)',
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#2D3748',
    backgroundColor: 'transparent',
  },
  chipSelected: {
    borderColor: '#F5A623',
    backgroundColor: '#F5A623',
  },
  chipText: {
    fontSize: 13,
    color: '#A0AEC0',
    fontFamily:
      Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined,
  },
  chipTextSelected: {
    color: '#0E1117',
    fontWeight: '600',
  },
  yesNoRow: {
    flexDirection: 'row',
    gap: 12,
  },
  yesNoBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2D3748',
    backgroundColor: 'transparent',
    alignItems: 'center',
  },
  yesNoBtnSelected: {
    borderColor: '#F5A623',
    backgroundColor: '#F5A623',
  },
  yesNoBtnText: {
    fontSize: 13,
    color: '#A0AEC0',
    fontWeight: '600',
    fontFamily:
      Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined,
  },
  yesNoBtnTextSelected: {
    color: '#0E1117',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  genderBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2D3748',
    backgroundColor: 'transparent',
    alignItems: 'center',
  },
  genderBtnSelected: {
    borderColor: '#F5A623',
    backgroundColor: '#F5A623',
  },
  genderBtnText: {
    fontSize: 13,
    color: '#A0AEC0',
    fontWeight: '600',
    fontFamily:
      Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined,
  },
  genderBtnTextSelected: {
    color: '#0E1117',
  },
  activityBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2D3748',
    backgroundColor: 'transparent',
    alignItems: 'center',
  },
  activityBtnSelected: {
    borderColor: '#F5A623',
    backgroundColor: '#F5A623',
  },
  activityBtnText: {
    fontSize: 13,
    color: '#A0AEC0',
    fontWeight: '600',
    fontFamily:
      Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined,
  },
  activityBtnTextSelected: {
    color: '#0E1117',
  },
  heightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  heightInput: {
    flex: 1,
    backgroundColor: '#FFFACD',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0E1117',
    fontFamily:
      Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined,
  },
  heightLabel: {
    fontSize: 13,
    color: '#A0AEC0',
    fontWeight: '600',
    fontFamily:
      Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sliderValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F5A623',
    minWidth: 30,
    fontFamily:
      Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined,
  },
  sliderMax: {
    fontSize: 13,
    color: '#718096',
    minWidth: 20,
    fontFamily:
      Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined,
  },
  navBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: Platform.OS === 'ios' ? 'max(12px, env(safe-area-inset-bottom))' : 12,
    backgroundColor: '#0E1117',
    borderTopWidth: 1,
    borderTopColor: '#1E2A3A',
    gap: 12,
    flexShrink: 0,
  } as any,
  backBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2D3748',
    backgroundColor: 'transparent',
    alignItems: 'center',
  },
  backBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#A0AEC0',
    fontFamily:
      Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined,
  },
  nextBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#F5A623',
    alignItems: 'center',
  },
  nextBtnDisabled: {
    opacity: 0.6,
  },
  nextBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0E1117',
    fontFamily:
      Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined,
  },
});
