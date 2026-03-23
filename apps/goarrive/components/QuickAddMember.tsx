/**
 * QuickAddMember – Full-screen multi-step intake form for coaches.
 *
 * Same look & feel as the member-facing intake form, but:
 *  • Only First Name and Last Name are required.
 *  • All other fields are optional (coach fills in what they know).
 *  • No "Create Account" step — no Firebase Auth account is created.
 *  • Saves a `members` doc (hasAccount: false) and an `intakeSubmissions` doc.
 */
import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
} from 'react-native';
import {
  collection,
  addDoc,
  doc,
  setDoc,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';

// ── Constants ───────────────────────────────────────────────────────────────
const STEPS = [
  'Basic Info',
  'Work & Lifestyle',
  'Health History',
  'Diet & Routine',
  'Fitness Goals',
  'Motivation',
  'Scheduling',
];

const GOAL_OPTIONS = [
  'Feel healthier', 'Fat loss', 'Build muscle', 'Improve endurance',
  'Lower stress', 'Better sleep', 'More energy', 'Increase flexibility',
  'Build confidence', 'Manage pain', 'Sport-specific training',
];

const INJURY_OPTIONS = [
  'Shoulder', 'Back (lower)', 'Back (upper)', 'Knee', 'Hip',
  'Wrist/Hand', 'Ankle/Foot', 'Neck', 'Elbow', 'None',
];

const ENERGY_OPTIONS = ['Very low', 'Low', 'Moderate', 'High', 'Very high'];
const STRESS_OPTIONS = ['Very low', 'Low', 'Moderate', 'High', 'Very high'];
const DIET_OPTIONS = [
  'No specific diet', 'Keto', 'Paleo', 'Vegan', 'Vegetarian',
  'Mediterranean', 'Intermittent fasting', 'Gluten-free', 'Low-carb',
  'High-protein', 'Other',
];
const ACTIVITY_LEVELS = ['Low', 'Moderate', 'High'];

// ── Types ───────────────────────────────────────────────────────────────────
interface FormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  gender: string;
  dateOfBirth: string;
  heightFeet: string;
  heightInches: string;
  weight: string;
  occupation: string;
  activityLevel: string;
  workSchedule: string;
  physicalActivities: string;
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
  currentDiet: string[];
  currentRoutine: string;
  energyLevel: string[];
  stressLevel: string[];
  primaryGoals: string[];
  goalWeight: string;
  specificGoals: string;
  whyStatement: string;
  readinessForChange: number;
  motivation: number;
  gymConfidence: number;
  preferredDays: string[];
  preferredTime: string;
  sessionsPerWeek: string;
  gym: string;
}

const initialFormData: FormData = {
  firstName: '', lastName: '', email: '', phone: '',
  gender: '', dateOfBirth: '', heightFeet: '', heightInches: '', weight: '',
  occupation: '', activityLevel: '', workSchedule: '', physicalActivities: '',
  healthProblems: '', medications: '', therapies: '', currentInjuries: '',
  injuries: [], stressMotivation: '',
  familyHeartDisease: '', familyDiseases: '', familyDiseasesDetail: '',
  diabetes: '', asthma: '', cardiovascular: '', medicalExplanation: '',
  smoker: '', emergencyContactName: '', emergencyContactPhone: '',
  currentDiet: [], currentRoutine: '', energyLevel: [], stressLevel: [],
  primaryGoals: [], goalWeight: '', specificGoals: '',
  whyStatement: '', readinessForChange: 7, motivation: 8, gymConfidence: 7,
  preferredDays: [], preferredTime: '', sessionsPerWeek: '', gym: '',
};

interface QuickAddMemberProps {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
  coachId: string;
  tenantId: string;
}

export default function QuickAddMember({
  visible, onClose, onSaved, coachId, tenantId,
}: QuickAddMemberProps) {
  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState<FormData>({ ...initialFormData });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const updateField = useCallback(
    (field: keyof FormData, value: any) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      // Clear error when user starts typing
      if (errors[field]) {
        setErrors((prev) => { const e = { ...prev }; delete e[field]; return e; });
      }
    },
    [errors]
  );

  const toggleArrayItem = useCallback(
    (field: keyof FormData, item: string) => {
      const arr = formData[field] as string[];
      const next = arr.includes(item)
        ? arr.filter((i) => i !== item)
        : [...arr, item];
      updateField(field, next);
    },
    [formData, updateField]
  );

  function validateStep(): boolean {
    const newErrors: Record<string, string> = {};
    if (step === 0) {
      if (!formData.firstName.trim()) newErrors.firstName = 'First name is required';
      if (!formData.lastName.trim()) newErrors.lastName = 'Last name is required';
    }
    // All other steps have no required fields for coach quick-add
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
    return Object.keys(newErrors).length === 0;
  }

  function handleNext() {
    if (validateStep()) {
      setStep((s) => s + 1);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  }

  function handleBack() {
    setStep((s) => Math.max(0, s - 1));
    setErrors({});
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  async function handleSave() {
    if (!validateStep()) return;
    setSubmitting(true);
    try {
      const displayName = `${formData.firstName.trim()} ${formData.lastName.trim()}`;
      const memberRef = await addDoc(collection(db, 'members'), {
        coachId,
        tenantId,
        name: displayName,
        displayName,
        email: formData.email.trim().toLowerCase() || '',
        phone: formData.phone.trim(),
        gender: formData.gender,
        dateOfBirth: formData.dateOfBirth,
        height: formData.heightFeet
          ? `${formData.heightFeet}'${formData.heightInches || '0'}"`
          : '',
        weight: formData.weight,
        role: 'member',
        isArchived: false,
        hasAccount: false,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });

      // Save intake submission with all data the coach entered
      await setDoc(doc(db, 'intakeSubmissions', memberRef.id), {
        memberId: memberRef.id,
        coachId,
        ...formData,
        submittedBy: 'coach',
        submittedAt: Timestamp.now(),
      });

      // Reset form
      setFormData({ ...initialFormData });
      setStep(0);
      setErrors({});
      onSaved();
      onClose();
    } catch (error: any) {
      setErrors({ submit: 'Something went wrong. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  function handleCloseForm() {
    setFormData({ ...initialFormData });
    setStep(0);
    setErrors({});
    onClose();
  }

  // ── Render helpers ──────────────────────────────────────────────────────
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
    const hasError = !!errors[field];
    return (
      <View style={s.fieldWrap}>
        <Text style={[s.fieldLabel, hasError && s.fieldLabelError]}>
          {label}{options?.required ? ' *' : ''}
        </Text>
        <TextInput
          style={[s.input, options?.multiline && s.inputMultiline, hasError && s.inputError]}
          placeholder={placeholder}
          placeholderTextColor="#4A5568"
          value={formData[field] as string}
          onChangeText={(v) => updateField(field, v as any)}
          keyboardType={options?.keyboardType || 'default'}
          multiline={options?.multiline}
          numberOfLines={options?.multiline ? 4 : 1}
          autoCapitalize={options?.keyboardType === 'email-address' ? 'none' : 'sentences'}
        />
        {hasError ? <Text style={s.errorText}>{errors[field]}</Text> : null}
      </View>
    );
  }

  function renderChipSelect(label: string, field: keyof FormData, options: string[]) {
    const selected = formData[field] as string[];
    return (
      <View style={s.fieldWrap}>
        <Text style={s.fieldLabel}>{label}</Text>
        <View style={s.chipContainer}>
          {options.map((opt) => (
            <Pressable
              key={opt}
              style={[s.chip, selected.includes(opt) && s.chipSelected]}
              onPress={() => toggleArrayItem(field, opt)}
            >
              <Text style={[s.chipText, selected.includes(opt) && s.chipTextSelected]}>
                {opt}
              </Text>
            </Pressable>
          ))}
        </View>
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
              style={[s.yesNoBtn, value === opt && s.yesNoBtnSelected]}
              onPress={() => updateField(field, opt as any)}
            >
              <Text style={[s.yesNoBtnText, value === opt && s.yesNoBtnTextSelected]}>
                {opt}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  function renderSlider(label: string, field: keyof FormData, min: number, max: number) {
    const value = (formData[field] as number) || min;
    return (
      <View style={s.fieldWrap}>
        <Text style={s.fieldLabel}>{label}</Text>
        <View style={s.sliderRow}>
          <Text style={s.sliderValue}>{value}</Text>
          {Platform.OS === 'web' ? (
            <input
              type="range"
              min={min}
              max={max}
              value={value}
              onChange={(e: any) => updateField(field, parseInt(e.currentTarget.value))}
              style={{ flex: 1, marginLeft: 12, marginRight: 12, height: 6, cursor: 'pointer' } as any}
            />
          ) : (
            <View style={{ flex: 1, marginHorizontal: 12 }}>
              <Text style={{ color: '#888' }}>{value}/{max}</Text>
            </View>
          )}
          <Text style={s.sliderMax}>{max}</Text>
        </View>
      </View>
    );
  }

  // ── Step renderers ────────────────────────────────────────────────────
  function renderStep0() {
    return (
      <View>
        <Text style={s.stepTitle}>Basic Info</Text>
        <Text style={s.stepDescription}>
          Enter your member's details. Only first and last name are required — fill in whatever else you know.
        </Text>
        {renderTextField('First Name', 'firstName', "Member's first name", { required: true })}
        {renderTextField('Last Name', 'lastName', "Member's last name", { required: true })}
        {renderTextField('Email', 'email', 'email@example.com', { keyboardType: 'email-address' })}
        {renderTextField('Phone', 'phone', '(555) 123-4567', { keyboardType: 'phone-pad' })}
        <View style={s.fieldWrap}>
          <Text style={s.fieldLabel}>Gender</Text>
          <View style={s.buttonRow}>
            {['Male', 'Female', 'Other'].map((g) => (
              <Pressable
                key={g}
                style={[s.genderBtn, formData.gender === g && s.genderBtnSelected]}
                onPress={() => updateField('gender', g)}
              >
                <Text style={[s.genderBtnText, formData.gender === g && s.genderBtnTextSelected]}>
                  {g}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        {renderTextField('Date of Birth', 'dateOfBirth', 'MM/DD/YYYY')}
        <View style={s.fieldWrap}>
          <Text style={s.fieldLabel}>Height</Text>
          <View style={s.heightRow}>
            <TextInput
              style={s.heightInput}
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
        </View>
        {renderTextField('Weight (lbs)', 'weight', '180', { keyboardType: 'numeric' })}
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
                style={[s.activityBtn, formData.activityLevel === level && s.activityBtnSelected]}
                onPress={() => updateField('activityLevel', level)}
              >
                <Text style={[s.activityBtnText, formData.activityLevel === level && s.activityBtnTextSelected]}>
                  {level}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        {renderTextField('Work Schedule', 'workSchedule', 'e.g., 9-5 office')}
        {renderTextField('Physical Activities', 'physicalActivities', 'e.g., Running, swimming')}
      </View>
    );
  }

  function renderStep2() {
    return (
      <View>
        <Text style={s.stepTitle}>Health & Medical History</Text>
        {renderYesNo('Any health problems?', 'healthProblems')}
        {renderTextField('Medications', 'medications', 'List any medications', { multiline: true })}
        {renderTextField('Current Therapies', 'therapies', 'e.g., Physical therapy', { multiline: true })}
        {renderChipSelect('Past Injuries', 'injuries', INJURY_OPTIONS)}
        {renderYesNo('Family history of heart disease?', 'familyHeartDisease')}
        {renderYesNo('Family history of diabetes?', 'diabetes')}
        {renderYesNo('Family history of asthma?', 'asthma')}
        {renderYesNo('Family history of cardiovascular disease?', 'cardiovascular')}
        {renderYesNo('Current smoker?', 'smoker')}
        {renderTextField('Emergency Contact Name', 'emergencyContactName', 'Full name')}
        {renderTextField('Emergency Contact Phone', 'emergencyContactPhone', 'Phone number')}
      </View>
    );
  }

  function renderStep3() {
    return (
      <View>
        <Text style={s.stepTitle}>Diet & Current Routine</Text>
        {renderChipSelect('Diet Type', 'currentDiet', DIET_OPTIONS)}
        {renderTextField('Current Routine', 'currentRoutine', 'Describe their typical day', { multiline: true })}
        {renderChipSelect('Energy Level', 'energyLevel', ENERGY_OPTIONS)}
        {renderChipSelect('Stress Level', 'stressLevel', STRESS_OPTIONS)}
      </View>
    );
  }

  function renderStep4() {
    return (
      <View>
        <Text style={s.stepTitle}>Fitness Goals</Text>
        {renderChipSelect('Primary Goals', 'primaryGoals', GOAL_OPTIONS)}
        {renderTextField('Goal Weight (lbs)', 'goalWeight', '180', { keyboardType: 'numeric' })}
        {renderTextField('Specific Goals', 'specificGoals', 'Any other goals?', { multiline: true })}
      </View>
    );
  }

  function renderStep5() {
    return (
      <View>
        <Text style={s.stepTitle}>Motivation & Readiness</Text>
        {renderTextField('Why do they want to get fit?', 'whyStatement', 'Their motivation story', { multiline: true })}
        {renderSlider('Readiness for Change (1-10)', 'readinessForChange', 1, 10)}
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
                style={[s.chip, formData.preferredDays.includes(day) && s.chipSelected]}
                onPress={() => toggleArrayItem('preferredDays', day)}
              >
                <Text style={[s.chipText, formData.preferredDays.includes(day) && s.chipTextSelected]}>
                  {day}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        {renderTextField('Preferred Time', 'preferredTime', 'e.g., Morning, Evening')}
        {renderTextField('Sessions Per Week', 'sessionsPerWeek', 'e.g., 3', { keyboardType: 'numeric' })}
        {renderTextField('Gym / Location', 'gym', 'Where do they train?')}
      </View>
    );
  }

  const stepRenderers = [
    renderStep0, renderStep1, renderStep2, renderStep3,
    renderStep4, renderStep5, renderStep6,
  ];
  const isLastStep = step === STEPS.length - 1;

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <KeyboardAvoidingView
        style={s.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header with progress */}
        <View style={s.progressBar}>
          <View style={s.headerRow}>
            <Pressable onPress={handleCloseForm} style={s.closeBtn}>
              <Text style={s.closeBtnText}>✕</Text>
            </Pressable>
            <Text style={s.headerTitle}>Add Member</Text>
            <View style={{ width: 40 }} />
          </View>
          <View style={s.progressHeader}>
            <Text style={s.progressLabel}>{STEPS[step]}</Text>
            <Text style={s.progressCount}>{step + 1} of {STEPS.length}</Text>
          </View>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${((step + 1) / STEPS.length) * 100}%` }]} />
          </View>
        </View>

        {/* Form Content */}
        <View style={s.scrollContainer}>
          <ScrollView
            ref={scrollRef}
            style={s.scroll}
            contentContainerStyle={s.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {stepRenderers[step]()}
            {errors.submit ? (
              <Text style={[s.errorText, { textAlign: 'center', marginTop: 12 }]}>
                {errors.submit}
              </Text>
            ) : null}
          </ScrollView>
        </View>

        {/* Navigation */}
        <View style={s.navBar}>
          {step > 0 ? (
            <Pressable style={s.backBtn} onPress={handleBack}>
              <Text style={s.backBtnText}>Back</Text>
            </Pressable>
          ) : (
            <Pressable style={s.backBtn} onPress={handleCloseForm}>
              <Text style={s.backBtnText}>Cancel</Text>
            </Pressable>
          )}
          {isLastStep ? (
            <Pressable
              style={[s.nextBtn, submitting && s.nextBtnDisabled]}
              onPress={handleSave}
              disabled={submitting}
            >
              {submitting ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <ActivityIndicator color="#0E1117" size="small" />
                  <Text style={[s.nextBtnText, { fontSize: 13 }]}>Saving…</Text>
                </View>
              ) : (
                <Text style={s.nextBtnText}>Save Member</Text>
              )}
            </Pressable>
          ) : (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable style={s.skipBtn} onPress={() => { setStep((s) => s + 1); scrollRef.current?.scrollTo({ y: 0, animated: true }); }}>
                <Text style={s.skipBtnText}>Skip</Text>
              </Pressable>
              <Pressable style={s.nextBtn} onPress={handleNext}>
                <Text style={s.nextBtnText}>Next</Text>
              </Pressable>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const s: any = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0E1117',
    display: 'flex' as any,
    flexDirection: 'column',
    minHeight: '100vh' as any,
    height: '100vh' as any,
  },
  progressBar: {
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'web' ? 16 : 60,
    paddingBottom: 12,
    backgroundColor: '#0E1117',
    borderBottomWidth: 1,
    borderBottomColor: '#30363D',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#888',
    fontSize: 20,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressLabel: {
    color: '#F5A623',
    fontSize: 14,
    fontWeight: '600',
  },
  progressCount: {
    color: '#888',
    fontSize: 13,
  },
  progressTrack: {
    height: 4,
    backgroundColor: '#1C2128',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    backgroundColor: '#F5A623',
    borderRadius: 2,
  },
  scrollContainer: {
    flex: 1,
    overflow: 'hidden' as any,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  navBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#30363D',
    backgroundColor: '#0E1117',
    paddingBottom: Platform.OS === 'ios' ? 32 : 12,
  },
  backBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  backBtnText: {
    color: '#888',
    fontSize: 16,
  },
  nextBtn: {
    backgroundColor: '#F5A623',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  nextBtnDisabled: {
    opacity: 0.5,
  },
  nextBtnText: {
    color: '#0E1117',
    fontWeight: '700',
    fontSize: 16,
  },
  skipBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#30363D',
    borderRadius: 8,
  },
  skipBtnText: {
    color: '#888',
    fontSize: 16,
  },
  stepTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  stepDescription: {
    fontSize: 14,
    color: '#888',
    marginBottom: 20,
    lineHeight: 20,
  },
  fieldWrap: {
    marginBottom: 16,
  },
  fieldLabel: {
    color: '#CDD9E5',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 6,
  },
  fieldLabelError: {
    color: '#F85149',
  },
  input: {
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#30363D',
    borderRadius: 8,
    color: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  inputError: {
    borderColor: '#F85149',
  },
  errorText: {
    color: '#F85149',
    fontSize: 12,
    marginTop: 4,
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
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#30363D',
  },
  chipSelected: {
    backgroundColor: '#F5A623',
    borderColor: '#F5A623',
  },
  chipText: {
    color: '#CDD9E5',
    fontSize: 14,
  },
  chipTextSelected: {
    color: '#0E1117',
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  genderBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#30363D',
    alignItems: 'center',
  },
  genderBtnSelected: {
    backgroundColor: '#F5A623',
    borderColor: '#F5A623',
  },
  genderBtnText: {
    color: '#CDD9E5',
    fontSize: 14,
  },
  genderBtnTextSelected: {
    color: '#0E1117',
    fontWeight: '600',
  },
  activityBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#30363D',
    alignItems: 'center',
  },
  activityBtnSelected: {
    backgroundColor: '#F5A623',
    borderColor: '#F5A623',
  },
  activityBtnText: {
    color: '#CDD9E5',
    fontSize: 14,
  },
  activityBtnTextSelected: {
    color: '#0E1117',
    fontWeight: '600',
  },
  yesNoRow: {
    flexDirection: 'row',
    gap: 8,
  },
  yesNoBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#30363D',
    alignItems: 'center',
  },
  yesNoBtnSelected: {
    backgroundColor: '#F5A623',
    borderColor: '#F5A623',
  },
  yesNoBtnText: {
    color: '#CDD9E5',
    fontSize: 14,
  },
  yesNoBtnTextSelected: {
    color: '#0E1117',
    fontWeight: '600',
  },
  heightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  heightInput: {
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#30363D',
    borderRadius: 8,
    color: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    width: 60,
    textAlign: 'center',
  },
  heightLabel: {
    color: '#888',
    fontSize: 14,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sliderValue: {
    color: '#F5A623',
    fontSize: 16,
    fontWeight: '700',
    width: 30,
    textAlign: 'center',
  },
  sliderMax: {
    color: '#888',
    fontSize: 13,
    width: 24,
    textAlign: 'center',
  },
});
