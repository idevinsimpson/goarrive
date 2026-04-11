/**
 * Coach Application Form — /coach-application
 *
 * In-depth, multi-step application for coaches applying to join GoArrive.
 * 8 sections with progress bar, field-level validation, file + video uploads,
 * availability grid, self-assessment ratings, and localStorage save/resume.
 */
import React, { useState, useRef, useEffect } from 'react';
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
  Dimensions,
} from 'react-native';
import { router } from 'expo-router';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../lib/firebase';

/* ─── Brand Tokens ─── */
const C = {
  bg:        '#0F1117',
  surface:   '#161A24',
  card:      '#1C2030',
  border:    '#252B3D',
  borderSub: '#1E2538',
  green:     '#7BA05B',
  greenDim:  'rgba(123,160,91,0.15)',
  gold:      '#F5A623',
  goldGlow:  'rgba(245,166,35,0.20)',
  goldDim:   'rgba(245,166,35,0.08)',
  blue:      '#7BA7D4',
  text:      '#E8EAF0',
  textSoft:  '#9BA3B8',
  muted:     '#6B7280',
  white:     '#FFFFFF',
  dark:      '#0E1117',
  red:       '#E05252',
  redDim:    'rgba(224,82,82,0.12)',
};

const FONT_H = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_B = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

/* ─── Step Definitions ─── */
const STEPS = [
  { key: 'personal', label: 'Personal Information' },
  { key: 'work', label: 'Work & Business' },
  { key: 'background', label: 'Coaching Background' },
  { key: 'vision', label: 'Vision & Fit' },
  { key: 'assessment', label: 'Self-Assessment' },
  { key: 'availability', label: 'Availability' },
  { key: 'uploads', label: 'Uploads & Vision' },
  { key: 'references', label: 'References & Submit' },
];

const EMPLOYMENT_OPTIONS = [
  'Business Owner',
  'Full-Time Employee',
  'Part-Time Employee',
  'Unemployed',
  'Other',
];

const EARNINGS_OPTIONS = [
  '$500', '$1,000', '$1,500', '$2,000', '$2,500',
  '$3,000', '$3,500', '$4,000', '$4,500', '$5,000+',
];

const DISCOVERY_OPTIONS = [
  'Instagram or Facebook',
  'Facebook Job Ad',
  'GoArrive Coach Referral',
  'Other',
];

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PERIOD_LABELS = ['Morning', 'Afternoon', 'Evening'];

/* ─── Form Data ─── */
interface FormData {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  streetAddress: string;
  streetAddress2: string;
  city: string;
  state: string;
  zipCode: string;
  phone: string;
  email: string;
  igHandle: string;
  facebookHandle: string;

  currentOccupation: string;
  employmentStatus: string;
  otherEmploymentStatus: string;
  maintainEmployment: string;
  employerName: string;
  employerWebsite: string;

  certifications: string;
  yearsExperience: string;
  specializations: string;
  topThreeStrengths: string;
  weakness: string;
  standOut: string;
  idealMember: string;

  numberOneGoal: string;
  supportFromTeamLead: string;
  desiredMonthlyEarnings: string;
  whyJoinGoArrive: string;
  greatFit: string;

  entrepreneurialSpirit: number;
  teamPlayer: number;
  adaptability: number;
  communicationSkills: number;

  howHeardAbout: string;
  otherHowHeard: string;
  referringCoachName: string;

  weeklyHoursAvailable: string;
  weekendAvailability: string;
  availability: Record<string, boolean>;

  resumeUrl: string;
  resumeFileName: string;
  certificationsUrl: string;
  certificationsFileName: string;

  futureResumeVideoUrl: string;
  futureResumeVideoFileName: string;

  ref1Name: string;
  ref1Email: string;
  ref1Phone: string;
  ref2Name: string;
  ref2Email: string;
  ref2Phone: string;
  ref3Name: string;
  ref3Email: string;
  ref3Phone: string;

  truthAcknowledged: boolean;
  signatureName: string;
  signatureDate: string;
}

const BLANK: FormData = {
  firstName: '', lastName: '', dateOfBirth: '', streetAddress: '', streetAddress2: '',
  city: '', state: '', zipCode: '', phone: '', email: '', igHandle: '', facebookHandle: '',
  currentOccupation: '', employmentStatus: '', otherEmploymentStatus: '', maintainEmployment: '',
  employerName: '', employerWebsite: '',
  certifications: '', yearsExperience: '', specializations: '', topThreeStrengths: '',
  weakness: '', standOut: '', idealMember: '',
  numberOneGoal: '', supportFromTeamLead: '', desiredMonthlyEarnings: '',
  whyJoinGoArrive: '', greatFit: '',
  entrepreneurialSpirit: 0, teamPlayer: 0, adaptability: 0, communicationSkills: 0,
  howHeardAbout: '', otherHowHeard: '', referringCoachName: '',
  weeklyHoursAvailable: '', weekendAvailability: '', availability: {},
  resumeUrl: '', resumeFileName: '', certificationsUrl: '', certificationsFileName: '',
  futureResumeVideoUrl: '', futureResumeVideoFileName: '',
  ref1Name: '', ref1Email: '', ref1Phone: '',
  ref2Name: '', ref2Email: '', ref2Phone: '',
  ref3Name: '', ref3Email: '', ref3Phone: '',
  truthAcknowledged: false, signatureName: '', signatureDate: '',
};

const SAVE_KEY = 'goarrive-coach-app';
const SAVE_STEP_KEY = 'goarrive-coach-app-step';

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   HELPER COMPONENTS
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function ProgressBar({ step, total, label, isMobile }: { step: number; total: number; label: string; isMobile: boolean }) {
  const pct = ((step + 1) / total) * 100;
  if (isMobile) {
    return (
      <View style={pg.wrap}>
        <Text style={pg.stepText}>Step {step + 1} of {total}</Text>
        <Text style={pg.label}>{label}</Text>
        <View style={pg.barBg}>
          <View style={[pg.barFill, { width: `${pct}%` as any }]} />
        </View>
      </View>
    );
  }
  return (
    <View style={pg.wrap}>
      <View style={pg.dots}>
        {Array.from({ length: total }).map((_, i) => (
          <React.Fragment key={i}>
            {i > 0 && <View style={[pg.line, i <= step && pg.lineActive]} />}
            <View style={[pg.dot, i < step && pg.dotDone, i === step && pg.dotCurrent]}>
              <Text style={[pg.dotText, i <= step && pg.dotTextActive]}>
                {i < step ? '\u2713' : String(i + 1)}
              </Text>
            </View>
          </React.Fragment>
        ))}
      </View>
      <Text style={pg.label}>{label}</Text>
    </View>
  );
}

function Field({ label, required, children, hint, error, fieldId }: {
  label: string; required?: boolean; children: React.ReactNode; hint?: string; error?: string; fieldId?: string;
}) {
  return (
    <View style={[fi.wrap, error && fi.wrapError]} nativeID={fieldId ? `field-${fieldId}` : undefined}>
      <Text style={[fi.label, error && { color: C.red }]}>{label}{required ? ' *' : ''}</Text>
      {hint ? <Text style={fi.hint}>{hint}</Text> : null}
      {children}
      {error ? <Text style={fi.fieldErrorText}>{error}</Text> : null}
    </View>
  );
}

function Input(props: {
  value: string; onChangeText: (t: string) => void; placeholder?: string;
  multiline?: boolean; numberOfLines?: number; keyboardType?: any; autoCapitalize?: any; editable?: boolean;
  error?: boolean;
}) {
  const { multiline, numberOfLines } = props;
  return (
    <TextInput
      style={[fi.input, multiline && { minHeight: (numberOfLines || 3) * 24 + 16, textAlignVertical: 'top' as any }, props.error && fi.inputError]}
      placeholder={props.placeholder}
      placeholderTextColor={C.muted}
      value={props.value}
      onChangeText={props.onChangeText}
      multiline={multiline}
      numberOfLines={numberOfLines}
      keyboardType={props.keyboardType}
      autoCapitalize={props.autoCapitalize || 'none'}
      autoCorrect={false}
      editable={props.editable !== false}
    />
  );
}

function RadioGroup({ options, value, onChange, error }: { options: string[]; value: string; onChange: (v: string) => void; error?: boolean }) {
  return (
    <View style={[fi.radioGroup, error && fi.radioGroupError]}>
      {options.map(opt => (
        <Pressable key={opt} style={fi.radioRow} onPress={() => onChange(opt)}>
          <View style={[fi.radioCircle, value === opt && fi.radioCircleActive, error && fi.radioCircleError]}>
            {value === opt && <View style={fi.radioDot} />}
          </View>
          <Text style={fi.radioText}>{opt}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function YesNo({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: boolean }) {
  return (
    <View style={fi.yesNoRow}>
      {['Yes', 'No'].map(opt => (
        <Pressable key={opt} style={[fi.yesNoBtn, value === opt && fi.yesNoBtnActive, error && !value && fi.yesNoBtnError]} onPress={() => onChange(opt)}>
          <Text style={[fi.yesNoText, value === opt && fi.yesNoTextActive]}>{opt}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Dropdown({ options, value, onChange, placeholder }: { options: string[]; value: string; onChange: (v: string) => void; placeholder: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={[{ position: 'relative' as any, zIndex: open ? 9999 : 1 }, Platform.OS === 'web' && open && ({ overflow: 'visible' } as any)]}>
      <Pressable style={fi.dropdown} onPress={() => setOpen(!open)}>
        <Text style={[fi.dropdownText, !value && { color: C.muted }]}>{value || placeholder}</Text>
        <Text style={fi.dropdownArrow}>{open ? '\u25B2' : '\u25BC'}</Text>
      </Pressable>
      {open && (
        <View style={fi.dropdownList}>
          <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
            {options.map(opt => (
              <Pressable key={opt} style={[fi.dropdownItem, value === opt && fi.dropdownItemActive]} onPress={() => { onChange(opt); setOpen(false); }}>
                <Text style={[fi.dropdownItemText, value === opt && { color: C.gold }]}>{opt}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

function RatingScale({ value, onChange, lowLabel, highLabel, error }: { value: number; onChange: (v: number) => void; lowLabel: string; highLabel: string; error?: boolean }) {
  return (
    <View style={fi.ratingWrap}>
      <View style={fi.ratingLabels}>
        <Text style={fi.ratingLabelText}>{lowLabel}</Text>
        <Text style={fi.ratingLabelText}>{highLabel}</Text>
      </View>
      <View style={[fi.ratingRow, error && { borderWidth: 1, borderColor: C.red, borderRadius: 12, padding: 8 }]}>
        {[1, 2, 3, 4, 5].map(n => (
          <Pressable key={n} style={[fi.ratingCircle, value === n && fi.ratingCircleActive]} onPress={() => onChange(n)}>
            <Text style={[fi.ratingNum, value === n && fi.ratingNumActive]}>{n}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function AvailabilityGrid({ value, onChange }: { value: Record<string, boolean>; onChange: (v: Record<string, boolean>) => void }) {
  const toggle = (day: string, period: string) => {
    const key = `${day}-${period}`;
    onChange({ ...value, [key]: !value[key] });
  };
  return (
    <View style={fi.gridWrap}>
      <View style={fi.gridRow}>
        <View style={fi.gridLabelCell} />
        {DAYS.map(d => (
          <View key={d} style={fi.gridHeaderCell}>
            <Text style={fi.gridHeaderText}>{d}</Text>
          </View>
        ))}
      </View>
      {PERIOD_LABELS.map(period => (
        <View key={period} style={fi.gridRow}>
          <View style={fi.gridLabelCell}>
            <Text style={fi.gridLabelText}>{period}</Text>
          </View>
          {DAYS.map(day => {
            const key = `${day}-${period}`;
            const active = !!value[key];
            return (
              <Pressable key={key} style={[fi.gridCell, active && fi.gridCellActive]} onPress={() => toggle(day, period)}>
                {active && <Text style={fi.gridCheck}>{'\u2713'}</Text>}
              </Pressable>
            );
          })}
        </View>
      ))}
      <Text style={[fi.hint, { marginTop: 8 }]}>Morning = 6 am – 12 pm · Afternoon = 12 – 5 pm · Evening = 5 – 9 pm</Text>
    </View>
  );
}

function FileUpload({ label, fileName, uploading, onPick, progress }: { label: string; fileName: string; uploading: boolean; onPick: () => void; progress?: number }) {
  return (
    <Pressable style={fi.uploadBtn} onPress={onPick} disabled={uploading}>
      {uploading ? (
        <View style={fi.uploadEmpty}>
          <ActivityIndicator color={C.gold} size="small" />
          <Text style={fi.uploadLabel}>Uploading{progress != null ? `... ${progress}%` : ''}</Text>
          {progress != null && (
            <View style={[pg.barBg, { marginTop: 8, width: '80%' as any }]}>
              <View style={[pg.barFill, { width: `${progress}%` as any }]} />
            </View>
          )}
        </View>
      ) : fileName ? (
        <View style={fi.uploadDone}>
          <Text style={fi.uploadCheckIcon}>{'\u2705'}</Text>
          <Text style={fi.uploadFileName} numberOfLines={1}>{fileName}</Text>
        </View>
      ) : (
        <View style={fi.uploadEmpty}>
          <Text style={fi.uploadPlusIcon}>{'\uD83D\uDCCE'}</Text>
          <Text style={fi.uploadLabel}>{label}</Text>
          <Text style={fi.uploadSub}>PDF, DOC, DOCX, JPG, PNG — Max 10 MB</Text>
        </View>
      )}
    </Pressable>
  );
}

function Checkbox({ checked, onChange, label, prominent }: { checked: boolean; onChange: (v: boolean) => void; label: string; prominent?: boolean }) {
  return (
    <Pressable style={[fi.checkboxRow, prominent && fi.checkboxProminent]} onPress={() => onChange(!checked)}>
      <View style={[fi.checkbox, checked && fi.checkboxActive, prominent && !checked && fi.checkboxPromientUnchecked]}>
        {checked && <Text style={fi.checkboxCheck}>{'\u2713'}</Text>}
      </View>
      <Text style={[fi.checkboxLabel, prominent && fi.checkboxLabelProminent]}>{label}</Text>
    </Pressable>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   MAIN COMPONENT
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
export default function CoachApplicationScreen() {
  const [w, setW] = useState(Dimensions.get('window').width);
  const isMobile = w < 768;
  const scrollRef = useRef<ScrollView>(null);

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>(BLANK);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [uploading, setUploading] = useState<'resume' | 'certifications' | 'video' | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [videoFileSize, setVideoFileSize] = useState(0);
  const [videoBytesTransferred, setVideoBytesTransferred] = useState(0);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState('');
  // Keep file input ref alive to prevent Safari from GC-ing the File blob mid-upload
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  /* Restore saved progress */
  useEffect(() => {
    if (Platform.OS === 'web') {
      try {
        const saved = localStorage.getItem(SAVE_KEY);
        if (saved) setForm(prev => ({ ...prev, ...JSON.parse(saved) }));
        const savedStep = localStorage.getItem(SAVE_STEP_KEY);
        if (savedStep) setStep(parseInt(savedStep, 10) || 0);
      } catch { /* ignore */ }
    }
  }, []);

  /* Persist progress */
  useEffect(() => {
    if (Platform.OS === 'web') {
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(form));
        localStorage.setItem(SAVE_STEP_KEY, String(step));
      } catch { /* ignore */ }
    }
  }, [form, step]);

  const set = <K extends keyof FormData>(key: K) => (val: FormData[K]) =>
    setForm(prev => ({ ...prev, [key]: val }));

  const fe = (field: string) => fieldErrors[field];

  /* ─── Field-Level Validation ─── */
  function validateStepFields(s: number): Record<string, string> {
    const errs: Record<string, string> = {};
    switch (s) {
      case 0: {
        if (!form.firstName.trim()) errs.firstName = 'Required';
        if (!form.lastName.trim()) errs.lastName = 'Required';
        if (!form.dateOfBirth.trim()) errs.dateOfBirth = 'Required';
        if (!form.streetAddress.trim()) errs.streetAddress = 'Required';
        if (!form.city.trim()) errs.city = 'Required';
        if (!form.state.trim()) errs.state = 'Required';
        if (!form.zipCode.trim()) errs.zipCode = 'Required';
        if (!form.phone.trim()) errs.phone = 'Required';
        if (!form.email.trim() || !form.email.includes('@')) errs.email = 'Valid email required';
        if (!form.igHandle.trim()) errs.igHandle = 'Required';
        if (!form.facebookHandle.trim()) errs.facebookHandle = 'Required';
        break;
      }
      case 1: {
        if (!form.currentOccupation.trim()) errs.currentOccupation = 'Required';
        if (!form.employmentStatus) errs.employmentStatus = 'Required';
        if (form.employmentStatus === 'Other' && !form.otherEmploymentStatus.trim()) errs.otherEmploymentStatus = 'Required';
        if (!form.maintainEmployment) errs.maintainEmployment = 'Required';
        break;
      }
      case 2: {
        if (!form.topThreeStrengths.trim()) errs.topThreeStrengths = 'Required';
        if (!form.weakness.trim()) errs.weakness = 'Required';
        if (!form.standOut.trim()) errs.standOut = 'Required';
        if (!form.idealMember.trim()) errs.idealMember = 'Required';
        break;
      }
      case 3: {
        if (!form.numberOneGoal.trim()) errs.numberOneGoal = 'Required';
        if (!form.supportFromTeamLead.trim()) errs.supportFromTeamLead = 'Required';
        if (!form.whyJoinGoArrive.trim()) errs.whyJoinGoArrive = 'Required';
        if (!form.greatFit.trim()) errs.greatFit = 'Required';
        break;
      }
      case 4: {
        if (!form.entrepreneurialSpirit) errs.entrepreneurialSpirit = 'Required';
        if (!form.teamPlayer) errs.teamPlayer = 'Required';
        if (!form.adaptability) errs.adaptability = 'Required';
        if (!form.communicationSkills) errs.communicationSkills = 'Required';
        break;
      }
      case 5: {
        if (!form.howHeardAbout) errs.howHeardAbout = 'Required';
        if (form.howHeardAbout === 'Other' && !form.otherHowHeard.trim()) errs.otherHowHeard = 'Required';
        if (!form.weeklyHoursAvailable.trim()) errs.weeklyHoursAvailable = 'Required';
        if (!form.weekendAvailability) errs.weekendAvailability = 'Required';
        if (!Object.values(form.availability).some(Boolean)) errs.availability = 'Select at least one time slot';
        break;
      }
      case 6: {
        if (!form.futureResumeVideoUrl) errs.futureResumeVideo = 'Please upload your future resume video';
        break;
      }
      case 7: {
        if (!form.ref1Name.trim()) errs.ref1Name = 'Required';
        if (!form.ref1Email.trim()) errs.ref1Email = 'Required';
        if (!form.ref1Phone.trim()) errs.ref1Phone = 'Required';
        if (!form.ref2Name.trim()) errs.ref2Name = 'Required';
        if (!form.ref2Email.trim()) errs.ref2Email = 'Required';
        if (!form.ref2Phone.trim()) errs.ref2Phone = 'Required';
        if (!form.ref3Name.trim()) errs.ref3Name = 'Required';
        if (!form.ref3Email.trim()) errs.ref3Email = 'Required';
        if (!form.ref3Phone.trim()) errs.ref3Phone = 'Required';
        if (!form.truthAcknowledged) errs.truthAcknowledged = 'You must acknowledge to continue';
        if (!form.signatureName.trim()) errs.signatureName = 'Required';
        if (!form.signatureDate.trim()) errs.signatureDate = 'Required';
        break;
      }
    }
    return errs;
  }

  function scrollToFirstError(errs: Record<string, string>) {
    if (Platform.OS === 'web') {
      const firstField = Object.keys(errs)[0];
      if (firstField) {
        setTimeout(() => {
          const el = document.getElementById(`field-${firstField}`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } else {
            scrollRef.current?.scrollTo({ y: 0, animated: true });
          }
        }, 100);
      }
    } else {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  }

  function next() {
    const errs = validateStepFields(step);
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      const firstMsg = Object.values(errs)[0];
      setError(firstMsg === 'Required' ? 'Please complete all required fields highlighted below.' : firstMsg);
      scrollToFirstError(errs);
      return;
    }
    setFieldErrors({});
    setError('');
    setStep(s => s + 1);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  function prev() {
    setFieldErrors({});
    setError('');
    setStep(s => s - 1);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  /* ─── File Upload ─── */
  function pickFile(type: 'resume' | 'certifications') {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.doc,.docx,.jpg,.jpeg,.png';
    input.onchange = async (e: any) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) { setError('File must be under 10 MB.'); return; }
      setUploading(type);
      setUploadProgress(0);
      setError('');
      try {
        // Read file into memory first — iOS Safari can garbage-collect
        // the blob reference before an async upload starts
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const storageRef = ref(storage, `coachApplications/${Date.now()}_${file.name}`);
        const task = uploadBytesResumable(storageRef, bytes, { contentType: file.type || 'application/octet-stream' });
        task.on('state_changed', (snap) => {
          setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
        });
        await task;
        const url = await getDownloadURL(storageRef);
        if (type === 'resume') {
          setForm(prev => ({ ...prev, resumeUrl: url, resumeFileName: file.name }));
        } else {
          setForm(prev => ({ ...prev, certificationsUrl: url, certificationsFileName: file.name }));
        }
      } catch (err: any) {
        console.error('Upload error:', err);
        const code = err?.code || '';
        const msg = code === 'storage/unauthorized' ? 'Upload permission denied.'
          : code === 'storage/canceled' ? 'Upload was canceled.'
          : `File upload failed (${code || err?.message || 'unknown'}). Please try again.`;
        setError(msg);
      } finally {
        setUploading(null);
        setUploadProgress(0);
      }
    };
    input.click();
  }

  /* ─── Video Upload ─── */
  function pickVideo() {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    // Store the input element in a ref so Safari doesn't GC the File blob
    // during a long upload (known WebKit issue with temporary input elements)
    videoInputRef.current = input;
    input.onchange = async (e: any) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      if (file.size > 500 * 1024 * 1024) {
        setError('Video must be under 500 MB. Try trimming or using a lower resolution.');
        return;
      }
      setUploading('video');
      setUploadProgress(0);
      setVideoFileSize(file.size);
      setVideoBytesTransferred(0);
      setError('');
      setFieldErrors(prev => { const n = { ...prev }; delete n.futureResumeVideo; return n; });
      // Create local preview URL immediately so user sees their video
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
      setVideoPreviewUrl(URL.createObjectURL(file));
      try {
        const storageRef = ref(storage, `coachApplications/videos/${Date.now()}_${file.name}`);
        const task = uploadBytesResumable(storageRef, file, { contentType: file.type || 'video/mp4' });
        task.on('state_changed', (snap) => {
          setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
          setVideoBytesTransferred(snap.bytesTransferred);
        });
        await task;
        const url = await getDownloadURL(storageRef);
        setForm(prev => ({ ...prev, futureResumeVideoUrl: url, futureResumeVideoFileName: file.name }));
      } catch (err: any) {
        console.error('Video upload error:', err);
        // Clean up preview on failure
        if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
        setVideoPreviewUrl('');
        const code = err?.code || '';
        const msg = code === 'storage/unauthorized' ? 'Video upload permission denied.'
          : code === 'storage/canceled' ? 'Video upload was canceled.'
          : code === 'storage/retry-limit-exceeded' ? 'Upload timed out. Please check your connection and try again.'
          : `Video upload failed (${code || err?.message || 'unknown'}). Please try again.`;
        setError(msg);
      } finally {
        setUploading(null);
        // Keep videoInputRef alive until component unmounts or new upload
      }
    };
    input.click();
  }

  function removeVideo() {
    setForm(prev => ({ ...prev, futureResumeVideoUrl: '', futureResumeVideoFileName: '' }));
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    setVideoPreviewUrl('');
    setUploadProgress(0);
    setVideoFileSize(0);
    setVideoBytesTransferred(0);
    videoInputRef.current = null;
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /* ─── Submit ─── */
  async function handleSubmit() {
    const errs = validateStepFields(step);
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setError('Please complete all required fields highlighted below.');
      scrollToFirstError(errs);
      return;
    }
    setLoading(true);
    setError('');
    setFieldErrors({});
    try {
      const doc: Record<string, any> = {};
      for (const [k, v] of Object.entries(form)) {
        doc[k] = typeof v === 'string' ? v.trim() : v;
      }
      doc.email = form.email.trim().toLowerCase();
      doc.status = 'pending';
      doc.createdAt = serverTimestamp();

      await addDoc(collection(db, 'coachApplications'), doc);
      setSuccess(true);
      if (Platform.OS === 'web') {
        localStorage.removeItem(SAVE_KEY);
        localStorage.removeItem(SAVE_STEP_KEY);
      }
    } catch {
      setError('Something went wrong. Please try again or email coaches@goa.fit.');
    } finally {
      setLoading(false);
    }
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  /* ━━━ STEP RENDERERS ━━━ */

  function renderPersonal() {
    return (
      <>
        <View style={isMobile ? undefined : st.row}>
          <View style={isMobile ? undefined : st.half}>
            <Field label="First Name" required error={fe('firstName')} fieldId="firstName">
              <Input value={form.firstName} onChangeText={set('firstName')} placeholder="First name" autoCapitalize="words" error={!!fe('firstName')} />
            </Field>
          </View>
          <View style={isMobile ? undefined : st.half}>
            <Field label="Last Name" required error={fe('lastName')} fieldId="lastName">
              <Input value={form.lastName} onChangeText={set('lastName')} placeholder="Last name" autoCapitalize="words" error={!!fe('lastName')} />
            </Field>
          </View>
        </View>
        <Field label="Date of Birth" required error={fe('dateOfBirth')} fieldId="dateOfBirth">
          <Input value={form.dateOfBirth} onChangeText={set('dateOfBirth')} placeholder="MM/DD/YYYY" error={!!fe('dateOfBirth')} />
        </Field>
        <Field label="Street Address" required error={fe('streetAddress')} fieldId="streetAddress">
          <Input value={form.streetAddress} onChangeText={set('streetAddress')} placeholder="Street address" autoCapitalize="words" error={!!fe('streetAddress')} />
        </Field>
        <Field label="Street Address Line 2">
          <Input value={form.streetAddress2} onChangeText={set('streetAddress2')} placeholder="Apt, suite, unit, etc. (optional)" autoCapitalize="words" />
        </Field>
        <View style={isMobile ? undefined : st.row}>
          <View style={isMobile ? undefined : { flex: 2 }}>
            <Field label="City" required error={fe('city')} fieldId="city">
              <Input value={form.city} onChangeText={set('city')} placeholder="City" autoCapitalize="words" error={!!fe('city')} />
            </Field>
          </View>
          <View style={isMobile ? undefined : { flex: 1 }}>
            <Field label="State" required error={fe('state')} fieldId="state">
              <Input value={form.state} onChangeText={set('state')} placeholder="State" autoCapitalize="characters" error={!!fe('state')} />
            </Field>
          </View>
          <View style={isMobile ? undefined : { flex: 1 }}>
            <Field label="ZIP Code" required error={fe('zipCode')} fieldId="zipCode">
              <Input value={form.zipCode} onChangeText={set('zipCode')} placeholder="ZIP" keyboardType="number-pad" error={!!fe('zipCode')} />
            </Field>
          </View>
        </View>
        <View style={isMobile ? undefined : st.row}>
          <View style={isMobile ? undefined : st.half}>
            <Field label="Phone Number" required error={fe('phone')} fieldId="phone">
              <Input value={form.phone} onChangeText={set('phone')} placeholder="(555) 555-5555" keyboardType="phone-pad" error={!!fe('phone')} />
            </Field>
          </View>
          <View style={isMobile ? undefined : st.half}>
            <Field label="Email Address" required error={fe('email')} fieldId="email">
              <Input value={form.email} onChangeText={set('email')} placeholder="you@email.com" keyboardType="email-address" error={!!fe('email')} />
            </Field>
          </View>
        </View>
        <View style={isMobile ? undefined : st.row}>
          <View style={isMobile ? undefined : st.half}>
            <Field label="Instagram Handle" required error={fe('igHandle')} fieldId="igHandle">
              <Input value={form.igHandle} onChangeText={set('igHandle')} placeholder="@yourhandle" error={!!fe('igHandle')} />
            </Field>
          </View>
          <View style={isMobile ? undefined : st.half}>
            <Field label="Facebook Handle" required error={fe('facebookHandle')} fieldId="facebookHandle">
              <Input value={form.facebookHandle} onChangeText={set('facebookHandle')} placeholder="Your Facebook name or URL" error={!!fe('facebookHandle')} />
            </Field>
          </View>
        </View>
      </>
    );
  }

  function renderWork() {
    const showEmployer = ['Business Owner', 'Full-Time Employee', 'Part-Time Employee'].includes(form.employmentStatus);
    return (
      <>
        <Field label="Current Occupation" required error={fe('currentOccupation')} fieldId="currentOccupation">
          <Input value={form.currentOccupation} onChangeText={set('currentOccupation')} placeholder="What do you do currently?" autoCapitalize="words" error={!!fe('currentOccupation')} />
        </Field>
        <Field label="Current Employment Status" required error={fe('employmentStatus')} fieldId="employmentStatus">
          <RadioGroup options={EMPLOYMENT_OPTIONS} value={form.employmentStatus} onChange={set('employmentStatus')} error={!!fe('employmentStatus')} />
        </Field>
        {form.employmentStatus === 'Other' && (
          <Field label="Please Specify" required error={fe('otherEmploymentStatus')} fieldId="otherEmploymentStatus">
            <Input value={form.otherEmploymentStatus} onChangeText={set('otherEmploymentStatus')} placeholder="Describe your current status" error={!!fe('otherEmploymentStatus')} />
          </Field>
        )}
        <Field label="Will you maintain current employment while growing your business with GoArrive?" required error={fe('maintainEmployment')} fieldId="maintainEmployment">
          <YesNo value={form.maintainEmployment} onChange={set('maintainEmployment')} error={!!fe('maintainEmployment')} />
        </Field>
        {showEmployer && (
          <>
            <Field label="Employer or Business Name">
              <Input value={form.employerName} onChangeText={set('employerName')} placeholder="Company or business name" autoCapitalize="words" />
            </Field>
            <Field label="Employer or Business Website">
              <Input value={form.employerWebsite} onChangeText={set('employerWebsite')} placeholder="https://..." />
            </Field>
          </>
        )}
      </>
    );
  }

  function renderBackground() {
    return (
      <>
        <Field label="Certification(s)" hint="List all relevant fitness certifications (e.g., NASM, ACE, ISSA, etc.)">
          <Input value={form.certifications} onChangeText={set('certifications')} placeholder="NASM-CPT, ACE, ISSA, etc." />
        </Field>
        <Field label="Years of Fitness Coaching Experience">
          <Input value={form.yearsExperience} onChangeText={set('yearsExperience')} placeholder="e.g., 3" keyboardType="number-pad" />
        </Field>
        <Field label="Specializations" hint="e.g., weight loss, strength training, sports performance, etc.">
          <Input value={form.specializations} onChangeText={set('specializations')} placeholder="Your coaching specializations" />
        </Field>
        <Field label="What are your top three strengths as a fitness coach?" required error={fe('topThreeStrengths')} fieldId="topThreeStrengths">
          <Input value={form.topThreeStrengths} onChangeText={set('topThreeStrengths')} placeholder="List your top 3 strengths" multiline numberOfLines={3} error={!!fe('topThreeStrengths')} />
        </Field>
        <Field label="What is a weakness or growth area you'd like to develop as a coach?" required error={fe('weakness')} fieldId="weakness">
          <Input value={form.weakness} onChangeText={set('weakness')} placeholder="Be honest — growth mindset matters" multiline numberOfLines={3} error={!!fe('weakness')} />
        </Field>
        <Field label="What makes you stand out as a fitness coach?" required error={fe('standOut')} fieldId="standOut">
          <Input value={form.standOut} onChangeText={set('standOut')} placeholder="What sets you apart?" multiline numberOfLines={3} error={!!fe('standOut')} />
        </Field>
        <Field label="Describe your ideal member" required error={fe('idealMember')} fieldId="idealMember" hint="Who do you coach best? What are their goals, lifestyle, and mindset?">
          <Input value={form.idealMember} onChangeText={set('idealMember')} placeholder="Describe your ideal coaching member" multiline numberOfLines={4} error={!!fe('idealMember')} />
        </Field>
      </>
    );
  }

  function renderVision() {
    return (
      <>
        <Field label="What is the #1 goal you want from this opportunity?" required error={fe('numberOneGoal')} fieldId="numberOneGoal">
          <Input value={form.numberOneGoal} onChangeText={set('numberOneGoal')} placeholder="Your primary goal" multiline numberOfLines={3} error={!!fe('numberOneGoal')} />
        </Field>
        <Field label="What support would you like from your GoArrive team lead?" required error={fe('supportFromTeamLead')} fieldId="supportFromTeamLead">
          <Input value={form.supportFromTeamLead} onChangeText={set('supportFromTeamLead')} placeholder="How can we help you succeed?" multiline numberOfLines={3} error={!!fe('supportFromTeamLead')} />
        </Field>
        <View style={{ zIndex: 50 }}>
          <Field label="Desired monthly earnings by end of year one">
            <Dropdown options={EARNINGS_OPTIONS} value={form.desiredMonthlyEarnings} onChange={set('desiredMonthlyEarnings')} placeholder="Select target earnings" />
          </Field>
        </View>
        <View style={{ zIndex: 1 }}>
          <Field label="Why do you want to join GoArrive?" required error={fe('whyJoinGoArrive')} fieldId="whyJoinGoArrive">
            <Input value={form.whyJoinGoArrive} onChangeText={set('whyJoinGoArrive')} placeholder="What draws you to GoArrive specifically?" multiline numberOfLines={4} error={!!fe('whyJoinGoArrive')} />
          </Field>
          <Field label="What makes you a great fit for this opportunity?" required error={fe('greatFit')} fieldId="greatFit">
            <Input value={form.greatFit} onChangeText={set('greatFit')} placeholder="Why should we choose you?" multiline numberOfLines={4} error={!!fe('greatFit')} />
          </Field>
        </View>
      </>
    );
  }

  function renderAssessment() {
    return (
      <>
        <Text style={st.intro}>
          Rate yourself honestly on each trait below. There are no wrong answers — we value self-awareness as much as high scores.
        </Text>
        <Field label="Entrepreneurial Spirit" required error={fe('entrepreneurialSpirit')} fieldId="entrepreneurialSpirit">
          <RatingScale value={form.entrepreneurialSpirit} onChange={set('entrepreneurialSpirit')} lowLabel="Employee Mindset" highLabel="Entrepreneurial" error={!!fe('entrepreneurialSpirit')} />
        </Field>
        <Field label="Team Player Mindset" required error={fe('teamPlayer')} fieldId="teamPlayer">
          <RatingScale value={form.teamPlayer} onChange={set('teamPlayer')} lowLabel="Lone Ranger" highLabel="Team Player" error={!!fe('teamPlayer')} />
        </Field>
        <Field label="Adaptability" required error={fe('adaptability')} fieldId="adaptability">
          <RatingScale value={form.adaptability} onChange={set('adaptability')} lowLabel="Prefers Routine" highLabel="Highly Adaptable" error={!!fe('adaptability')} />
        </Field>
        <Field label="Communication Skills" required error={fe('communicationSkills')} fieldId="communicationSkills">
          <RatingScale value={form.communicationSkills} onChange={set('communicationSkills')} lowLabel="Needs Improvement" highLabel="Excellent" error={!!fe('communicationSkills')} />
        </Field>
      </>
    );
  }

  function renderAvailability() {
    return (
      <>
        <Field label="How did you hear about this opportunity?" required error={fe('howHeardAbout')} fieldId="howHeardAbout">
          <RadioGroup options={DISCOVERY_OPTIONS} value={form.howHeardAbout} onChange={set('howHeardAbout')} error={!!fe('howHeardAbout')} />
        </Field>
        {form.howHeardAbout === 'Other' && (
          <Field label="Please Specify" required error={fe('otherHowHeard')} fieldId="otherHowHeard">
            <Input value={form.otherHowHeard} onChangeText={set('otherHowHeard')} placeholder="How did you find us?" error={!!fe('otherHowHeard')} />
          </Field>
        )}
        <Field label="Referring Coach Name" hint="Only one coach can be credited as your referring coach. Provide first and last name.">
          <Input value={form.referringCoachName} onChangeText={set('referringCoachName')} placeholder="First and Last Name (if applicable)" autoCapitalize="words" />
        </Field>
        <View style={st.divider} />
        <Field label="How many hours per week can you commit to apprenticeship / coaching?" required error={fe('weeklyHoursAvailable')} fieldId="weeklyHoursAvailable">
          <Input value={form.weeklyHoursAvailable} onChangeText={set('weeklyHoursAvailable')} placeholder="e.g., 15" keyboardType="number-pad" error={!!fe('weeklyHoursAvailable')} />
        </Field>
        <Field label="Are you available to work weekends?" required error={fe('weekendAvailability')} fieldId="weekendAvailability">
          <YesNo value={form.weekendAvailability} onChange={set('weekendAvailability')} error={!!fe('weekendAvailability')} />
        </Field>
        <Field label="Availability" required error={fe('availability')} fieldId="availability" hint="Tap the time slots when you are available for coaching.">
          <AvailabilityGrid value={form.availability} onChange={set('availability')} />
        </Field>
      </>
    );
  }

  function renderUploads() {
    return (
      <>
        <Text style={st.intro}>
          Upload your resume and any relevant certifications. Accepted formats: PDF, DOC, DOCX, JPG, PNG (max 10 MB each).
        </Text>
        <Field label="Resume Upload">
          <FileUpload label="Choose Resume File" fileName={form.resumeFileName} uploading={uploading === 'resume'} onPick={() => pickFile('resume')} progress={uploading === 'resume' ? uploadProgress : undefined} />
        </Field>
        <Field label="Certifications Upload">
          <FileUpload label="Choose Certifications File" fileName={form.certificationsFileName} uploading={uploading === 'certifications'} onPick={() => pickFile('certifications')} progress={uploading === 'certifications' ? uploadProgress : undefined} />
        </Field>
        {Platform.OS !== 'web' && (
          <Text style={fi.hint}>File uploads are available on the web version. You may also email documents to coaches@goa.fit after submitting.</Text>
        )}
        <View style={st.divider} />
        <Field label="Your Future Resume Video" required error={fe('futureResumeVideo')} fieldId="futureResumeVideo" hint="Record a 2-3 minute video sharing your vision for your coaching career with GoArrive. What do you hope to achieve? What milestones do you want to reach? How will you grow as a coach? Be aspirational, specific, and authentic.">
          {uploading === 'video' ? (
            <View style={[fi.uploadBtn, { borderColor: C.gold, borderStyle: 'solid' as any }]}>
              <View style={fi.uploadEmpty}>
                <ActivityIndicator color={C.gold} size="small" />
                <Text style={fi.uploadLabel}>Uploading video... {uploadProgress}%</Text>
                <Text style={fi.uploadSub}>
                  {formatBytes(videoBytesTransferred)} of {formatBytes(videoFileSize)}
                </Text>
                <View style={[pg.barBg, { marginTop: 8, width: '100%' as any }]}>
                  <View style={[pg.barFill, { width: `${uploadProgress}%` as any }]} />
                </View>
                {videoPreviewUrl ? (
                  <View style={{ marginTop: 12, width: '100%' as any, borderRadius: 8, overflow: 'hidden' as any }}>
                    {Platform.OS === 'web' && (
                      <video
                        src={videoPreviewUrl}
                        style={{ width: '100%', maxHeight: 180, objectFit: 'cover' as any, borderRadius: 8, opacity: 0.6 }}
                        muted
                      />
                    )}
                  </View>
                ) : null}
              </View>
            </View>
          ) : form.futureResumeVideoUrl ? (
            <View style={[fi.uploadBtn, { borderColor: C.green, borderStyle: 'solid' as any }]}>
              <View style={{ alignItems: 'center' as any, gap: 10, width: '100%' as any }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={fi.uploadCheckIcon}>{'\u2705'}</Text>
                  <Text style={[fi.uploadFileName, { flex: 1 }]} numberOfLines={1}>{form.futureResumeVideoFileName}</Text>
                </View>
                {videoFileSize > 0 && (
                  <Text style={fi.uploadSub}>{formatBytes(videoFileSize)} uploaded</Text>
                )}
                {(videoPreviewUrl || form.futureResumeVideoUrl) && Platform.OS === 'web' && (
                  <View style={{ width: '100%' as any, borderRadius: 8, overflow: 'hidden' as any, marginTop: 4 }}>
                    <video
                      src={videoPreviewUrl || form.futureResumeVideoUrl}
                      controls
                      style={{ width: '100%', maxHeight: 240, borderRadius: 8, background: '#000' }}
                    />
                  </View>
                )}
                <Pressable
                  onPress={removeVideo}
                  style={{ marginTop: 4, paddingVertical: 6, paddingHorizontal: 14, borderRadius: 8, backgroundColor: C.redDim, borderWidth: 1, borderColor: 'rgba(224,82,82,0.25)' }}
                >
                  <Text style={{ fontSize: 13, color: C.red, fontFamily: FONT_B }}>Remove & Re-upload</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable style={[fi.uploadBtn, fe('futureResumeVideo') && { borderColor: C.red }]} onPress={pickVideo}>
              <View style={fi.uploadEmpty}>
                <Text style={fi.uploadPlusIcon}>{'\uD83C\uDFA5'}</Text>
                <Text style={fi.uploadLabel}>Upload Your Future Resume Video</Text>
                <Text style={fi.uploadSub}>MP4, MOV, AVI, WebM — Max 500 MB</Text>
              </View>
            </Pressable>
          )}
        </Field>
      </>
    );
  }

  function renderReferences() {
    const refBlock = (num: number, nk: keyof FormData, ek: keyof FormData, pk: keyof FormData) => (
      <View style={st.refBlock}>
        <Text style={st.refTitle}>Reference {num}</Text>
        <Field label="Full Name" required error={fe(nk)} fieldId={nk}>
          <Input value={form[nk] as string} onChangeText={set(nk) as any} placeholder="First and Last Name" autoCapitalize="words" error={!!fe(nk)} />
        </Field>
        <View style={isMobile ? undefined : st.row}>
          <View style={isMobile ? undefined : st.half}>
            <Field label="Email" required error={fe(ek)} fieldId={ek}>
              <Input value={form[ek] as string} onChangeText={set(ek) as any} placeholder="email@example.com" keyboardType="email-address" error={!!fe(ek)} />
            </Field>
          </View>
          <View style={isMobile ? undefined : st.half}>
            <Field label="Phone" required error={fe(pk)} fieldId={pk}>
              <Input value={form[pk] as string} onChangeText={set(pk) as any} placeholder="(555) 555-5555" keyboardType="phone-pad" error={!!fe(pk)} />
            </Field>
          </View>
        </View>
      </View>
    );
    return (
      <>
        <Text style={st.intro}>
          Provide three professional or personal references who can speak to your character, work ethic, and coaching ability.
        </Text>
        {refBlock(1, 'ref1Name', 'ref1Email', 'ref1Phone')}
        {refBlock(2, 'ref2Name', 'ref2Email', 'ref2Phone')}
        {refBlock(3, 'ref3Name', 'ref3Email', 'ref3Phone')}
        <View style={st.divider} />
        {/* Enhanced Acknowledgment */}
        <View style={[st.ackCard, fe('truthAcknowledged') && { borderColor: C.red }]} nativeID="field-truthAcknowledged">
          <View style={st.ackHeader}>
            <Text style={st.ackIcon}>{'\u26A0\uFE0F'}</Text>
            <Text style={st.ackTitle}>Final Acknowledgment</Text>
          </View>
          <Text style={st.ackSubtext}>Please read carefully and confirm before submitting.</Text>
          <Checkbox
            checked={form.truthAcknowledged}
            onChange={set('truthAcknowledged')}
            label="By checking this box, I certify that all information provided in this application is true, complete, and accurate to the best of my knowledge. I understand that any misrepresentation may result in disqualification from the GoArrive coaching program."
            prominent
          />
          {fe('truthAcknowledged') && <Text style={fi.fieldErrorText}>{fe('truthAcknowledged')}</Text>}
        </View>
        <View style={isMobile ? undefined : st.row}>
          <View style={isMobile ? undefined : st.half}>
            <Field label="Signature (Typed Full Name)" required error={fe('signatureName')} fieldId="signatureName">
              <Input value={form.signatureName} onChangeText={set('signatureName')} placeholder="Type your full legal name" autoCapitalize="words" error={!!fe('signatureName')} />
            </Field>
          </View>
          <View style={isMobile ? undefined : st.half}>
            <Field label="Today's Date" required error={fe('signatureDate')} fieldId="signatureDate">
              <Input value={form.signatureDate} onChangeText={set('signatureDate')} placeholder="MM/DD/YYYY" error={!!fe('signatureDate')} />
            </Field>
          </View>
        </View>
      </>
    );
  }

  function renderStepContent() {
    switch (step) {
      case 0: return renderPersonal();
      case 1: return renderWork();
      case 2: return renderBackground();
      case 3: return renderVision();
      case 4: return renderAssessment();
      case 5: return renderAvailability();
      case 6: return renderUploads();
      case 7: return renderReferences();
      default: return null;
    }
  }

  function renderSuccess() {
    return (
      <View style={st.successWrap}>
        <View style={st.successCircle}>
          <Text style={st.successIcon}>{'\u2713'}</Text>
        </View>
        <Text style={st.successTitle}>Application Submitted</Text>
        <Text style={st.successBody}>
          Thank you for applying to coach with GoArrive. We review every application personally and with care. If your application moves forward, we will be in touch within 5–7 business days.
        </Text>
        <Text style={st.successBody}>
          In the meantime, follow us on Instagram and Facebook to stay connected with the GoArrive community.
        </Text>
        <Pressable
          style={st.ctaBtn}
          onPress={() => router.replace('/coach-apply')}
        >
          <Text style={st.ctaBtnText}>Back to GoArrive</Text>
        </Pressable>
      </View>
    );
  }

  const isLast = step === STEPS.length - 1;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flex: 1 }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {/* Nav Bar */}
        <View style={[st.nav, Platform.OS === 'web' && ({ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 999 } as any)]}>
          <View style={st.navInner}>
            <Pressable onPress={() => router.replace('/coach-apply')}>
              <Image source={require('../assets/logo.png')} style={st.navLogo} resizeMode="contain" accessibilityLabel="GoArrive" />
            </Pressable>
            <Pressable onPress={() => router.replace('/coach-apply')}>
              <Text style={st.navBack}>{'\u2190'} Back to Overview</Text>
            </Pressable>
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: Platform.OS === 'web' ? 80 : 10, paddingBottom: 60 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {success ? renderSuccess() : (
            <View style={[st.container, { maxWidth: 700, alignSelf: 'center' as any, width: '100%' as any }]}>
              {/* Header */}
              <View style={st.header}>
                <Text style={st.headerTag}>COACH APPLICATION</Text>
                <Text style={[st.headerTitle, isMobile && { fontSize: 26 }]}>
                  Apply to Coach{'\n'}with GoArrive
                </Text>
                <Text style={st.headerSub}>
                  GoArrive is building a selective team of dedicated, growth-minded fitness coaches. This application helps us understand who you are, how you coach, and whether we are the right fit for each other.
                </Text>
              </View>

              <ProgressBar step={step} total={STEPS.length} label={STEPS[step].label} isMobile={isMobile} />

              {/* Form Card */}
              <View style={st.formCard}>
                <Text style={st.sectionTitle}>{STEPS[step].label}</Text>

                {error ? (
                  <View style={st.errorBanner}>
                    <Text style={st.errorText}>{error}</Text>
                  </View>
                ) : null}

                {renderStepContent()}

                {/* Navigation Row */}
                <View style={st.navRow}>
                  {step > 0 ? (
                    <Pressable style={st.backBtn} onPress={prev}>
                      <Text style={st.backBtnText}>{'\u2190'} Back</Text>
                    </Pressable>
                  ) : <View />}
                  <Pressable
                    style={[st.ctaBtn, loading && { opacity: 0.6 }]}
                    onPress={isLast ? handleSubmit : next}
                    disabled={loading}
                  >
                    {loading ? (
                      <ActivityIndicator color={C.dark} size="small" />
                    ) : (
                      <Text style={st.ctaBtnText}>{isLast ? 'Submit Application' : 'Continue \u2192'}</Text>
                    )}
                  </Pressable>
                </View>
              </View>

              {/* Save note */}
              {Platform.OS === 'web' && (
                <Text style={st.saveNote}>Your progress is automatically saved. You can close this page and return later.</Text>
              )}
            </View>
          )}

          {/* Footer */}
          <View style={st.footer}>
            <Text style={st.footerText}>&copy; {new Date().getFullYear()} GoArrive. All rights reserved.</Text>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   STYLES
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/* ─ Progress Bar ─ */
const pg = StyleSheet.create({
  wrap: { marginBottom: 24, alignItems: 'center' as any },
  stepText: { fontSize: 12, fontWeight: '600', color: C.muted, fontFamily: FONT_H, letterSpacing: 1, textTransform: 'uppercase' as any, marginBottom: 4 },
  label: { fontSize: 15, fontWeight: '600', color: C.text, fontFamily: FONT_H, marginTop: 8, textAlign: 'center' as any },
  barBg: { width: '100%' as any, height: 4, backgroundColor: C.border, borderRadius: 2, marginTop: 10 },
  barFill: { height: 4, backgroundColor: C.gold, borderRadius: 2 },
  dots: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' as any },
  dot: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: C.card,
    borderWidth: 2, borderColor: C.border,
    alignItems: 'center' as any, justifyContent: 'center' as any,
  },
  dotDone: { backgroundColor: C.green, borderColor: C.green },
  dotCurrent: { borderColor: C.gold, backgroundColor: C.goldDim },
  dotText: { fontSize: 13, fontWeight: '700', color: C.muted, fontFamily: FONT_H },
  dotTextActive: { color: C.white },
  line: { width: 24, height: 2, backgroundColor: C.border },
  lineActive: { backgroundColor: C.green },
});

/* ─ Form Fields ─ */
const fi = StyleSheet.create({
  wrap: { marginBottom: 18 },
  wrapError: { borderLeftWidth: 3, borderLeftColor: C.red, paddingLeft: 12 },
  label: { fontSize: 14, fontWeight: '600', color: C.text, fontFamily: FONT_H, marginBottom: 6 },
  hint: { fontSize: 12, color: C.muted, fontFamily: FONT_B, marginBottom: 6, lineHeight: 18 },
  fieldErrorText: { fontSize: 12, color: C.red, fontFamily: FONT_B, marginTop: 4 },
  input: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: C.text, fontFamily: FONT_B,
  },
  inputError: { borderColor: C.red, borderWidth: 2 },
  radioGroup: { gap: 10 },
  radioGroupError: { borderWidth: 1, borderColor: C.red, borderRadius: 10, padding: 10 },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  radioCircle: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.border,
    alignItems: 'center' as any, justifyContent: 'center' as any,
  },
  radioCircleActive: { borderColor: C.gold },
  radioCircleError: { borderColor: C.red },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.gold },
  radioText: { fontSize: 14, color: C.text, fontFamily: FONT_B },
  yesNoRow: { flexDirection: 'row', gap: 12 },
  yesNoBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: C.border,
    alignItems: 'center' as any, backgroundColor: C.bg,
  },
  yesNoBtnActive: { borderColor: C.gold, backgroundColor: C.goldDim },
  yesNoBtnError: { borderColor: C.red, borderWidth: 2 },
  yesNoText: { fontSize: 15, fontWeight: '600', color: C.textSoft, fontFamily: FONT_H },
  yesNoTextActive: { color: C.gold },
  dropdown: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  dropdownText: { fontSize: 15, color: C.text, fontFamily: FONT_B },
  dropdownArrow: { fontSize: 10, color: C.muted },
  dropdownList: {
    position: 'absolute' as any, top: '100%' as any, left: 0, right: 0,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    marginTop: 4, zIndex: 9999,
    ...(Platform.OS === 'web' ? { boxShadow: '0 8px 24px rgba(0,0,0,0.6)' } as any : {}),
  },
  dropdownItem: { paddingHorizontal: 14, paddingVertical: 11 },
  dropdownItemActive: { backgroundColor: C.goldDim },
  dropdownItemText: { fontSize: 14, color: C.text, fontFamily: FONT_B },
  ratingWrap: { gap: 8 },
  ratingLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  ratingLabelText: { fontSize: 11, color: C.muted, fontFamily: FONT_B },
  ratingRow: { flexDirection: 'row', gap: 12, justifyContent: 'center' as any },
  ratingCircle: {
    width: 48, height: 48, borderRadius: 24, borderWidth: 2, borderColor: C.border,
    alignItems: 'center' as any, justifyContent: 'center' as any, backgroundColor: C.bg,
  },
  ratingCircleActive: { borderColor: C.gold, backgroundColor: C.goldDim },
  ratingNum: { fontSize: 18, fontWeight: '700', color: C.muted, fontFamily: FONT_H },
  ratingNumActive: { color: C.gold },
  gridWrap: { gap: 2 },
  gridRow: { flexDirection: 'row', gap: 2, alignItems: 'center' },
  gridLabelCell: { width: 76, paddingRight: 4 },
  gridHeaderCell: { flex: 1, alignItems: 'center' as any, paddingVertical: 4 },
  gridHeaderText: { fontSize: 11, fontWeight: '600', color: C.textSoft, fontFamily: FONT_H },
  gridLabelText: { fontSize: 11, color: C.textSoft, fontFamily: FONT_B, textAlign: 'right' as any },
  gridCell: {
    flex: 1, aspectRatio: 1, borderRadius: 6, borderWidth: 1, borderColor: C.border,
    alignItems: 'center' as any, justifyContent: 'center' as any, backgroundColor: C.bg,
    maxHeight: 40,
  },
  gridCellActive: { backgroundColor: C.greenDim, borderColor: C.green },
  gridCheck: { fontSize: 14, color: C.green, fontWeight: '700' },
  uploadBtn: {
    borderWidth: 1, borderColor: C.border, borderRadius: 12, borderStyle: 'dashed' as any,
    paddingVertical: 20, paddingHorizontal: 16, alignItems: 'center' as any,
    backgroundColor: C.bg,
  },
  uploadEmpty: { alignItems: 'center' as any, gap: 6 },
  uploadPlusIcon: { fontSize: 24 },
  uploadLabel: { fontSize: 14, fontWeight: '600', color: C.text, fontFamily: FONT_H },
  uploadSub: { fontSize: 11, color: C.muted, fontFamily: FONT_B },
  uploadDone: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  uploadCheckIcon: { fontSize: 18 },
  uploadFileName: { fontSize: 14, color: C.green, fontFamily: FONT_B, maxWidth: 250 },
  checkboxRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 8 },
  checkboxProminent: {
    backgroundColor: C.goldDim, borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.3)',
  },
  checkbox: {
    width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: C.border,
    alignItems: 'center' as any, justifyContent: 'center' as any, marginTop: 2,
    flexShrink: 0,
  },
  checkboxActive: { borderColor: C.gold, backgroundColor: C.goldDim },
  checkboxPromientUnchecked: { borderColor: C.gold, borderWidth: 2 },
  checkboxCheck: { fontSize: 14, fontWeight: '700', color: C.gold },
  checkboxLabel: { fontSize: 13, color: C.textSoft, fontFamily: FONT_B, lineHeight: 20, flex: 1 },
  checkboxLabelProminent: { color: C.text, fontSize: 14, lineHeight: 22 },
});

/* ─ Page Layout ─ */
const st = StyleSheet.create({
  nav: {
    backgroundColor: 'rgba(15,17,23,0.94)', borderBottomWidth: 1, borderBottomColor: C.borderSub,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' } as any : {}),
  },
  navInner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingVertical: 14, maxWidth: 1080, alignSelf: 'center' as any, width: '100%' as any,
  },
  navLogo: { width: 130, height: 30 },
  navBack: { fontSize: 14, fontWeight: '500', color: C.textSoft, fontFamily: FONT_B },
  container: { paddingHorizontal: 20 },
  header: { alignItems: 'center' as any, marginBottom: 32, marginTop: 16 },
  headerTag: {
    fontSize: 12, fontWeight: '700', color: C.gold, fontFamily: FONT_H,
    letterSpacing: 2, textTransform: 'uppercase' as any, marginBottom: 12,
  },
  headerTitle: {
    fontSize: 32, fontWeight: '700', color: C.text, fontFamily: FONT_H,
    textAlign: 'center' as any, lineHeight: 40, marginBottom: 14,
  },
  headerSub: {
    fontSize: 15, color: C.textSoft, fontFamily: FONT_B,
    textAlign: 'center' as any, lineHeight: 24, maxWidth: 540,
  },
  formCard: {
    backgroundColor: C.card, borderRadius: 16, padding: 24, borderWidth: 1, borderColor: C.border,
    marginBottom: 16,
    ...(Platform.OS === 'web' ? { overflow: 'visible' } as any : {}),
  },
  sectionTitle: {
    fontSize: 20, fontWeight: '700', color: C.text, fontFamily: FONT_H,
    marginBottom: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.borderSub,
  },
  intro: { fontSize: 14, color: C.textSoft, fontFamily: FONT_B, lineHeight: 22, marginBottom: 20 },
  row: { flexDirection: 'row', gap: 16 },
  half: { flex: 1 },
  divider: { height: 1, backgroundColor: C.borderSub, marginVertical: 24 },
  refBlock: {
    backgroundColor: C.bg, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: C.borderSub,
    marginBottom: 16,
  },
  refTitle: { fontSize: 15, fontWeight: '700', color: C.gold, fontFamily: FONT_H, marginBottom: 12 },
  ackCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 20, marginBottom: 20,
    borderWidth: 2, borderColor: C.gold,
  },
  ackHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  ackIcon: { fontSize: 20 },
  ackTitle: { fontSize: 18, fontWeight: '700', color: C.gold, fontFamily: FONT_H },
  ackSubtext: { fontSize: 13, color: C.textSoft, fontFamily: FONT_B, marginBottom: 14 },
  errorBanner: {
    backgroundColor: C.redDim, borderRadius: 10, padding: 14, marginBottom: 16,
    borderWidth: 1, borderColor: 'rgba(224,82,82,0.25)',
  },
  errorText: { fontSize: 14, color: C.red, fontFamily: FONT_B },
  navRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 28, paddingTop: 20, borderTopWidth: 1, borderTopColor: C.borderSub },
  backBtn: { paddingVertical: 12, paddingHorizontal: 16 },
  backBtnText: { fontSize: 15, fontWeight: '600', color: C.textSoft, fontFamily: FONT_H },
  ctaBtn: {
    backgroundColor: C.gold, paddingHorizontal: 32, paddingVertical: 16, borderRadius: 12,
    alignItems: 'center' as any,
    ...(Platform.OS === 'web' ? { boxShadow: `0 0 20px ${C.goldGlow}, 0 4px 12px rgba(0,0,0,0.3)` } as any : {}),
  },
  ctaBtnText: { fontSize: 16, fontWeight: '700', color: C.dark, fontFamily: FONT_H, letterSpacing: 0.3 },
  saveNote: { fontSize: 12, color: C.muted, fontFamily: FONT_B, textAlign: 'center' as any, marginTop: 8, marginBottom: 24 },
  successWrap: {
    alignItems: 'center' as any, paddingHorizontal: 32, paddingVertical: 80,
    maxWidth: 520, alignSelf: 'center' as any,
  },
  successCircle: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: C.greenDim,
    borderWidth: 2, borderColor: C.green,
    alignItems: 'center' as any, justifyContent: 'center' as any, marginBottom: 24,
  },
  successIcon: { fontSize: 32, color: C.green, fontWeight: '700' },
  successTitle: { fontSize: 24, fontWeight: '700', color: C.text, fontFamily: FONT_H, marginBottom: 16, textAlign: 'center' as any },
  successBody: { fontSize: 15, color: C.textSoft, fontFamily: FONT_B, textAlign: 'center' as any, lineHeight: 24, marginBottom: 12 },
  footer: { paddingVertical: 32, alignItems: 'center' as any, borderTopWidth: 1, borderTopColor: C.borderSub, marginTop: 24 },
  footerText: { fontSize: 12, color: C.muted, fontFamily: FONT_B },
});
