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
import React, { useState, useCallback } from 'react';
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
  'Improved health',
  'Improved endurance',
  'Increased strength',
  'Increased muscle mass',
  'Weight loss',
  'Weight gain',
  'Flexibility',
  'Stress reduction',
  'Better sleep',
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
  gymConfidence: 5,
  preferredDays: [],
  preferredTime: '',
  sessionsPerWeek: '4',
  gym: '',
  password: '',
  confirmPassword: '',
};

export default function IntakeForm() {
  const { coachId } = useLocalSearchParams<{ coachId: string }>();
  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const updateField = useCallback(
    <K extends keyof FormData>(field: K, value: FormData[K]) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      if (errors[field]) {
        setErrors((prev) => {
          const { [field]: _, ...rest } = prev;
          return rest;
        });
      }
    },
    [errors]
  );

  const toggleArrayItem = useCallback(
    (field: keyof FormData, item: string) => {
      setFormData((prev) => {
        const arr = prev[field] as string[];
        return {
          ...prev,
          [field]: arr.includes(item)
            ? arr.filter((i) => i !== item)
            : [...arr, item],
        };
      });
    },
    []
  );

  function validateStep(): boolean {
    const newErrors: Record<string, string> = {};

    switch (step) {
      case 0: // About You
        if (!formData.firstName.trim()) newErrors.firstName = 'First name is required';
        if (!formData.lastName.trim()) newErrors.lastName = 'Last name is required';
        if (!formData.email.trim()) newErrors.email = 'Email is required';
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email))
          newErrors.email = 'Please enter a valid email';
        if (!formData.phone.trim()) newErrors.phone = 'Phone number is required';
        break;
      case 1: // Work & Lifestyle
        if (!formData.occupation.trim()) newErrors.occupation = 'Please enter your occupation';
        break;
      case 4: // Fitness Goals
        if (formData.primaryGoals.length === 0)
          newErrors.primaryGoals = 'Select at least one goal';
        break;
      case 5: // Motivation
        if (!formData.whyStatement.trim())
          newErrors.whyStatement = 'Please share why this is important to you';
        break;
      case 7: // Account
        if (!formData.password) newErrors.password = 'Password is required';
        else if (formData.password.length < 6)
          newErrors.password = 'Password must be at least 6 characters';
        if (formData.password !== formData.confirmPassword)
          newErrors.confirmPassword = 'Passwords do not match';
        break;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  function handleNext() {
    if (validateStep()) {
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
    }
  }

  function handleBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleSubmit() {
    if (!validateStep()) return;
    setSubmitting(true);

    try {
      // 1. Create Firebase Auth account
      const cred = await createUserWithEmailAndPassword(
        auth,
        formData.email.trim().toLowerCase(),
        formData.password
      );
      const uid = cred.user.uid;

      // Update display name
      await updateProfile(cred.user, {
        displayName: `${formData.firstName.trim()} ${formData.lastName.trim()}`,
      });

      // 2. Create intake submission document
      const submissionRef = doc(collection(db, 'intakeSubmissions'));
      await setDoc(submissionRef, {
        memberId: uid,
        coachId: coachId,
        personalInfo: {
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim(),
          email: formData.email.trim().toLowerCase(),
          phone: formData.phone.trim(),
          gender: formData.gender,
          dateOfBirth: formData.dateOfBirth,
          heightFeet: parseInt(formData.heightFeet) || 0,
          heightInches: parseInt(formData.heightInches) || 0,
          weight: parseInt(formData.weight) || 0,
        },
        workLifestyle: {
          occupation: formData.occupation.trim(),
          activityLevel: formData.activityLevel,
          workSchedule: formData.workSchedule.trim(),
          physicalActivities: formData.physicalActivities.trim(),
        },
        healthHistory: {
          healthProblems: formData.healthProblems.trim(),
          medications: formData.medications.trim(),
          therapies: formData.therapies.trim(),
          currentInjuries: formData.currentInjuries.trim(),
          injuries: formData.injuries,
          stressMotivation: formData.stressMotivation,
          familyHeartDisease: formData.familyHeartDisease,
          familyDiseases: formData.familyDiseases,
          familyDiseasesDetail: formData.familyDiseasesDetail.trim(),
          diabetes: formData.diabetes,
          asthma: formData.asthma,
          cardiovascular: formData.cardiovascular,
          medicalExplanation: formData.medicalExplanation.trim(),
          smoker: formData.smoker,
          emergencyContactName: formData.emergencyContactName.trim(),
          emergencyContactPhone: formData.emergencyContactPhone.trim(),
        },
        dietRoutine: {
          currentDiet: formData.currentDiet,
          currentRoutine: formData.currentRoutine.trim(),
          energyLevel: formData.energyLevel,
          stressLevel: formData.stressLevel,
        },
        fitnessGoals: {
          goals: formData.primaryGoals,
          goalWeight: formData.goalWeight.trim(),
          specificGoals: formData.specificGoals.trim(),
        },
        motivation: {
          whyStatement: formData.whyStatement.trim(),
          readinessForChange: formData.readinessForChange,
          motivation: formData.motivation,
          gymConfidence: formData.gymConfidence,
        },
        scheduling: {
          preferredDays: formData.preferredDays,
          preferredTime: formData.preferredTime.trim(),
          sessionsPerWeek: parseInt(formData.sessionsPerWeek) || 4,
          gym: formData.gym.trim(),
        },
        status: 'submitted',
        createdAt: Timestamp.now(),
      });

      // 3. Create member document
      await setDoc(doc(db, 'members', uid), {
        uid: uid,
        email: formData.email.trim().toLowerCase(),
        displayName: `${formData.firstName.trim()} ${formData.lastName.trim()}`,
        phone: formData.phone.trim(),
        coachId: coachId,
        status: 'pending',
        intakeSubmissionId: submissionRef.id,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });

      // 4. Redirect to member dashboard
      router.replace('/(member)/home');
    } catch (err: any) {
      console.error('[IntakeForm] Submission error:', err);
      const code = err?.code ?? '';
      if (code === 'auth/email-already-in-use') {
        setErrors({ email: 'This email is already registered. Please sign in instead.' });
        setStep(0); // Go back to step 1 to show the email error
      } else if (code === 'auth/weak-password') {
        setErrors({ password: 'Password is too weak. Please use at least 6 characters.' });
      } else {
        setErrors({ submit: 'Something went wrong. Please try again.' });
      }
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
    }
  ) {
    return (
      <View style={s.fieldWrap}>
        <Text style={s.fieldLabel}>
          {label}
          {options?.required ? ' *' : ''}
        </Text>
        <TextInput
          style={[s.input, options?.multiline && s.inputMultiline]}
          placeholder={placeholder}
          placeholderTextColor="#4A5568"
          value={formData[field] as string}
          onChangeText={(v) => updateField(field, v as any)}
          keyboardType={options?.keyboardType || 'default'}
          multiline={options?.multiline}
          numberOfLines={options?.multiline ? 4 : 1}
          autoCapitalize={
            options?.keyboardType === 'email-address' ? 'none' : 'sentences'
          }
        />
        {errors[field] ? (
          <Text style={s.errorText}>{errors[field]}</Text>
        ) : null}
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
    return (
      <View style={s.fieldWrap}>
        <Text style={s.fieldLabel}>
          {label}
          {required ? ' *' : ''}
        </Text>
        <View style={s.chipContainer}>
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
        {errors[field] ? (
          <Text style={s.errorText}>{errors[field]}</Text>
        ) : null}
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
                  s.yesNoText,
                  value === opt && s.yesNoTextSelected,
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
    const value = formData[field] as number;
    return (
      <View style={s.fieldWrap}>
        <Text style={s.fieldLabel}>
          {label}: <Text style={s.sliderValue}>{value}/{max}</Text>
        </Text>
        <View style={s.sliderRow}>
          {Array.from({ length: max - min + 1 }, (_, i) => i + min).map(
            (n) => (
              <Pressable
                key={n}
                style={[
                  s.sliderDot,
                  n <= value && s.sliderDotActive,
                ]}
                onPress={() => updateField(field, n as any)}
              >
                <Text
                  style={[
                    s.sliderDotText,
                    n <= value && s.sliderDotTextActive,
                  ]}
                >
                  {n}
                </Text>
              </Pressable>
            )
          )}
        </View>
      </View>
    );
  }

  // ── Step renderers ────────────────────────────────────────────────────────

  function renderStep0() {
    return (
      <View>
        <Text style={s.stepTitle}>Let's Get to Know You</Text>
        <Text style={s.stepSubtitle}>
          Tell us about yourself so your coach can personalize your experience.
        </Text>
        {renderTextField('First Name', 'firstName', 'Enter your first name', {
          required: true,
        })}
        {renderTextField('Last Name', 'lastName', 'Enter your last name', {
          required: true,
        })}
        {renderTextField('Email', 'email', 'you@example.com', {
          required: true,
          keyboardType: 'email-address',
        })}
        {renderTextField('Phone Number', 'phone', '(555) 123-4567', {
          required: true,
          keyboardType: 'phone-pad',
        })}
        <View style={s.fieldWrap}>
          <Text style={s.fieldLabel}>Gender</Text>
          <View style={s.yesNoRow}>
            {['Male', 'Female', 'Other'].map((opt) => (
              <Pressable
                key={opt}
                style={[
                  s.yesNoBtn,
                  formData.gender === opt && s.yesNoBtnSelected,
                ]}
                onPress={() => updateField('gender', opt)}
              >
                <Text
                  style={[
                    s.yesNoText,
                    formData.gender === opt && s.yesNoTextSelected,
                  ]}
                >
                  {opt}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        {renderTextField('Date of Birth', 'dateOfBirth', 'MM/DD/YYYY')}
        <View style={s.rowFields}>
          <View style={s.halfField}>
            {renderTextField('Height (ft)', 'heightFeet', "5", {
              keyboardType: 'numeric',
            })}
          </View>
          <View style={s.halfField}>
            {renderTextField('Height (in)', 'heightInches', "10", {
              keyboardType: 'numeric',
            })}
          </View>
        </View>
        {renderTextField('Weight (lbs)', 'weight', '180', {
          keyboardType: 'numeric',
        })}
      </View>
    );
  }

  function renderStep1() {
    return (
      <View>
        <Text style={s.stepTitle}>Work & Lifestyle</Text>
        <Text style={s.stepSubtitle}>
          Understanding your daily routine helps us design a plan that fits your life.
        </Text>
        {renderTextField('What do you do for a living?', 'occupation', 'e.g., Software Engineer', {
          required: true,
        })}
        <View style={s.fieldWrap}>
          <Text style={s.fieldLabel}>Activity level at your job</Text>
          <View style={s.yesNoRow}>
            {ACTIVITY_LEVELS.map((opt) => (
              <Pressable
                key={opt}
                style={[
                  s.yesNoBtn,
                  formData.activityLevel === opt && s.yesNoBtnSelected,
                ]}
                onPress={() => updateField('activityLevel', opt)}
              >
                <Text
                  style={[
                    s.yesNoText,
                    formData.activityLevel === opt && s.yesNoTextSelected,
                  ]}
                >
                  {opt}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        {renderTextField(
          'Typical work schedule',
          'workSchedule',
          'e.g., Mon-Fri 8am-5pm'
        )}
        {renderTextField(
          'Physical activities outside gym/work',
          'physicalActivities',
          'e.g., Walking, hiking, sports...',
          { multiline: true }
        )}
      </View>
    );
  }

  function renderStep2() {
    return (
      <View>
        <Text style={s.stepTitle}>Health & Medical History</Text>
        <Text style={s.stepSubtitle}>
          This information helps your coach keep you safe and design around any limitations.
        </Text>
        {renderTextField(
          'Diagnosed health problems',
          'healthProblems',
          'List any diagnosed conditions...',
          { multiline: true }
        )}
        {renderTextField(
          'Current medications',
          'medications',
          'List any medications...',
          { multiline: true }
        )}
        {renderTextField(
          'Current injuries',
          'currentInjuries',
          'Describe any current injuries...',
          { multiline: true }
        )}
        {renderChipSelect('Injury areas', 'injuries', INJURY_OPTIONS)}
        {renderYesNo('Stresses or motivational problems?', 'stressMotivation')}
        {renderYesNo('Family heart disease before 60?', 'familyHeartDisease')}
        {renderYesNo('Diabetes?', 'diabetes')}
        {renderYesNo('Asthma/respiratory disorders?', 'asthma')}
        {renderYesNo('Cardiovascular issues?', 'cardiovascular')}
        {(formData.diabetes === 'Yes' ||
          formData.asthma === 'Yes' ||
          formData.cardiovascular === 'Yes') &&
          renderTextField(
            'Please explain',
            'medicalExplanation',
            'Provide details...',
            { multiline: true }
          )}
        {renderYesNo('Current cigarette smoker?', 'smoker')}
        {renderTextField(
          'Emergency Contact Name',
          'emergencyContactName',
          'Full name'
        )}
        {renderTextField(
          'Emergency Contact Phone',
          'emergencyContactPhone',
          '(555) 123-4567',
          { keyboardType: 'phone-pad' }
        )}
      </View>
    );
  }

  function renderStep3() {
    return (
      <View>
        <Text style={s.stepTitle}>Diet & Current Routine</Text>
        <Text style={s.stepSubtitle}>
          Tell us about your current eating habits and exercise routine.
        </Text>
        {renderChipSelect('Current diet', 'currentDiet', DIET_OPTIONS)}
        {renderTextField(
          'Describe your current routine',
          'currentRoutine',
          'What does your typical week of exercise look like?',
          { multiline: true }
        )}
        {renderChipSelect('Energy levels', 'energyLevel', ENERGY_OPTIONS)}
        {renderChipSelect('Stress levels', 'stressLevel', STRESS_OPTIONS)}
      </View>
    );
  }

  function renderStep4() {
    return (
      <View>
        <Text style={s.stepTitle}>Fitness Goals</Text>
        <Text style={s.stepSubtitle}>
          What do you want to achieve? Select all that apply.
        </Text>
        {renderChipSelect(
          'Primary goals',
          'primaryGoals',
          GOAL_OPTIONS,
          true
        )}
        {renderTextField('Goal weight', 'goalWeight', 'e.g., 175 lbs', {
          keyboardType: 'default',
        })}
        {renderTextField(
          'Any specific goals?',
          'specificGoals',
          'e.g., Run a 5K, deadlift 300 lbs...',
          { multiline: true }
        )}
      </View>
    );
  }

  function renderStep5() {
    return (
      <View>
        <Text style={s.stepTitle}>Motivation & Readiness</Text>
        <Text style={s.stepSubtitle}>
          Help your coach understand what drives you.
        </Text>
        {renderTextField(
          'Why is this important to you?',
          'whyStatement',
          'What is driving you to make this change?',
          { multiline: true, required: true }
        )}
        {renderSlider('Readiness for change', 'readinessForChange', 1, 10)}
        {renderSlider('Motivation level', 'motivation', 1, 10)}
        {renderSlider('Gym confidence', 'gymConfidence', 1, 10)}
      </View>
    );
  }

  function renderStep6() {
    return (
      <View>
        <Text style={s.stepTitle}>Scheduling & Availability</Text>
        <Text style={s.stepSubtitle}>
          When can you train? This helps your coach build your weekly plan.
        </Text>
        {renderChipSelect('Preferred training days', 'preferredDays', [
          'Monday',
          'Tuesday',
          'Wednesday',
          'Thursday',
          'Friday',
          'Saturday',
          'Sunday',
        ])}
        {renderTextField(
          'Preferred training time',
          'preferredTime',
          'e.g., 6:00 AM, After work'
        )}
        {renderTextField(
          'Sessions per week',
          'sessionsPerWeek',
          '4',
          { keyboardType: 'numeric' }
        )}
        {renderTextField('Gym / Training location', 'gym', 'e.g., Lifetime Fitness')}
      </View>
    );
  }

  function renderStep7() {
    return (
      <View>
        <Text style={s.stepTitle}>Create Your Account</Text>
        <Text style={s.stepSubtitle}>
          Set a password to create your GoArrive account. You'll use your email
          ({formData.email || 'entered in Step 1'}) to sign in.
        </Text>
        <View style={s.fieldWrap}>
          <Text style={s.fieldLabel}>Password *</Text>
          <TextInput
            style={s.input}
            placeholder="At least 6 characters"
            placeholderTextColor="#4A5568"
            value={formData.password}
            onChangeText={(v) => updateField('password', v)}
            secureTextEntry
          />
          {errors.password ? (
            <Text style={s.errorText}>{errors.password}</Text>
          ) : null}
        </View>
        <View style={s.fieldWrap}>
          <Text style={s.fieldLabel}>Confirm Password *</Text>
          <TextInput
            style={s.input}
            placeholder="Type your password again"
            placeholderTextColor="#4A5568"
            value={formData.confirmPassword}
            onChangeText={(v) => updateField('confirmPassword', v)}
            secureTextEntry
          />
          {errors.confirmPassword ? (
            <Text style={s.errorText}>{errors.confirmPassword}</Text>
          ) : null}
        </View>
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

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Progress Bar */}
      <View style={s.progressBar}>
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

      {/* Form Content */}
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {stepRenderers[step]()}
      </ScrollView>

      {/* Navigation Buttons */}
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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 24,
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
  stepSubtitle: {
    fontSize: 14,
    color: '#A0AEC0',
    lineHeight: 22,
    marginBottom: 24,
    fontFamily:
      Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined,
  },
  fieldWrap: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#8A95A3',
    marginBottom: 6,
    fontFamily:
      Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined,
  },
  input: {
    backgroundColor: '#1A2035',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#F0F4F8',
    borderWidth: 1,
    borderColor: '#2A3347',
    fontFamily:
      Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined,
  },
  inputMultiline: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  errorText: {
    fontSize: 12,
    color: '#E05252',
    marginTop: 4,
    fontFamily:
      Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1A2035',
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  chipSelected: {
    backgroundColor: 'rgba(245, 166, 35, 0.15)',
    borderColor: '#F5A623',
  },
  chipText: {
    fontSize: 13,
    color: '#A0AEC0',
    fontFamily:
      Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined,
  },
  chipTextSelected: {
    color: '#F5A623',
    fontWeight: '600',
  },
  yesNoRow: {
    flexDirection: 'row',
    gap: 10,
  },
  yesNoBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#1A2035',
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  yesNoBtnSelected: {
    backgroundColor: 'rgba(245, 166, 35, 0.15)',
    borderColor: '#F5A623',
  },
  yesNoText: {
    fontSize: 14,
    color: '#A0AEC0',
    fontFamily:
      Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined,
  },
  yesNoTextSelected: {
    color: '#F5A623',
    fontWeight: '600',
  },
  sliderValue: {
    color: '#F5A623',
    fontWeight: '700',
  },
  sliderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  sliderDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1A2035',
    borderWidth: 1,
    borderColor: '#2A3347',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sliderDotActive: {
    backgroundColor: 'rgba(245, 166, 35, 0.2)',
    borderColor: '#F5A623',
  },
  sliderDotText: {
    fontSize: 12,
    color: '#718096',
    fontWeight: '600',
  },
  sliderDotTextActive: {
    color: '#F5A623',
  },
  rowFields: {
    flexDirection: 'row',
    gap: 12,
  },
  halfField: {
    flex: 1,
  },
  navBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#1E2A3A',
    backgroundColor: '#0E1117',
    ...(Platform.OS === 'web'
      ? {
          paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))' as any,
        }
      : {}),
  },
  backBtn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  backBtnText: {
    fontSize: 14,
    color: '#A0AEC0',
    fontWeight: '600',
    fontFamily:
      Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined,
  },
  nextBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#F5A623',
  },
  nextBtnDisabled: {
    opacity: 0.6,
  },
  nextBtnText: {
    fontSize: 14,
    color: '#0E1117',
    fontWeight: '700',
    fontFamily:
      Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : undefined,
  },
});
