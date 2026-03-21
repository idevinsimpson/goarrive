/**
 * Member Plan — Coach full-screen view of a member's plan
 *
 * Features:
 *   - Questionnaire tab + Fitness Plan tab
 *   - Coach Edit / Member Preview toggle
 *   - Full pricing engine with auto-calculation
 *   - Commit to Save add-on
 *   - Nutrition add-on
 *   - Plan Controls drawer (bottom sheet)
 *   - Bottom action bar (Share + Plan Controls)
 *   - Contract length selector (6/9/12 months)
 *   - Guidance profiles per session type
 *   - Shareable link generation
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Platform,
  TouchableOpacity,
  TextInput,
  Image,
  Animated,
  Dimensions,
  Modal,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../../lib/AuthContext';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import { Icon } from '../../../components/Icon';
import {
  MemberPlanData,
  DayPlan,
  Phase,
  SessionsPerWeek,
  ContractLength,
  GuidanceLevel,
  SessionType,
  SessionTypeGuidance,
  PricingInputs,
  goalConfig,
  typeColors,
  phaseColors,
  availableGoals,
  dayTypeOptions,
  guidanceLevels,
  createDefaultPlan,
  calculatePricing,
  formatCurrency,
  countSessionsByType,
} from '../../../lib/planTypes';

const FONT_HEADING =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_BODY =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

type TabType = 'questionnaire' | 'plan';
type ViewMode = 'edit' | 'preview';

// ─── Reusable Edit Components ───────────────────────────────────────────────

function EditField({ label, value, onChangeText, placeholder, multiline, keyboardType, hint }: {
  label: string; value: string; onChangeText: (text: string) => void;
  placeholder?: string; multiline?: boolean; keyboardType?: 'default' | 'numeric' | 'decimal-pad'; hint?: string;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={es.fieldLabel}>{label}</Text>
      {hint && <Text style={es.fieldHint}>{hint}</Text>}
      <TextInput
        style={[es.input, multiline && { minHeight: 80, textAlignVertical: 'top' }]}
        value={value} onChangeText={onChangeText} placeholder={placeholder}
        placeholderTextColor="#3A4255" multiline={multiline} keyboardType={keyboardType}
      />
    </View>
  );
}

function EditNumberField({ label, value, onChange, hint, prefix, suffix }: {
  label: string; value: number | undefined; onChange: (val: number) => void;
  hint?: string; prefix?: string; suffix?: string;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={es.fieldLabel}>{label}</Text>
      {hint && <Text style={es.fieldHint}>{hint}</Text>}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {prefix && <Text style={{ color: '#8A95A3', fontSize: 14, fontFamily: FONT_BODY }}>{prefix}</Text>}
        <TextInput
          style={[es.input, { flex: 1 }]}
          value={value !== undefined && value !== 0 ? String(value) : ''}
          onChangeText={(t) => { const n = parseFloat(t.replace(/[^0-9.]/g, '')); onChange(isNaN(n) ? 0 : n); }}
          placeholder="0" placeholderTextColor="#3A4255" keyboardType="decimal-pad"
        />
        {suffix && <Text style={{ color: '#8A95A3', fontSize: 14, fontFamily: FONT_BODY }}>{suffix}</Text>}
      </View>
    </View>
  );
}

function EditSlider({ label, value, onChange, max = 10, color }: {
  label: string; value: number; onChange: (val: number) => void; max?: number; color: string;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={es.fieldLabel}>{label}</Text>
        <Text style={{ color, fontSize: 14, fontWeight: '700', fontFamily: FONT_HEADING }}>{value}/{max}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {Array.from({ length: max }).map((_, i) => (
          <Pressable key={i} onPress={() => onChange(i + 1)}
            style={{ flex: 1, height: 24, borderRadius: 4, backgroundColor: i < value ? color : '#2A3347', borderWidth: 1, borderColor: i < value ? color + '60' : '#1E2535' }}
          />
        ))}
      </View>
    </View>
  );
}

function SectionEditor({ title, color, children, collapsed, onToggle }: {
  title: string; color: string; children: React.ReactNode; collapsed: boolean; onToggle: () => void;
}) {
  return (
    <View style={[es.sectionCard, { borderColor: color + '30' }]}>
      <Pressable onPress={onToggle} style={es.sectionHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <View style={{ width: 4, height: 20, borderRadius: 2, backgroundColor: color }} />
          <Text style={[es.sectionTitle, { color }]}>{title}</Text>
        </View>
        <Text style={{ color: '#4A5568', fontSize: 18 }}>{collapsed ? '▸' : '▾'}</Text>
      </Pressable>
      {!collapsed && <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>{children}</View>}
    </View>
  );
}

function ChipSelector({ selected, options, onToggle, color }: {
  selected: string[]; options: string[]; onToggle: (item: string) => void; color: string;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((opt) => {
        const isSelected = selected.includes(opt);
        return (
          <Pressable key={opt} onPress={() => onToggle(opt)}
            style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1,
              backgroundColor: isSelected ? color + '20' : '#161B25', borderColor: isSelected ? color + '50' : '#2A3347' }}>
            <Text style={{ fontSize: 13, color: isSelected ? color : '#8A95A3', fontWeight: isSelected ? '600' : '400' }}>{opt}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ListEditor({ items, onChange, placeholder, color }: {
  items: string[]; onChange: (items: string[]) => void; placeholder?: string; color?: string;
}) {
  const [newItem, setNewItem] = useState('');
  return (
    <View>
      {items.map((item, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Text style={{ color: '#C5CDD8', fontSize: 13, flex: 1, fontFamily: FONT_BODY }}>{item}</Text>
          <Pressable onPress={() => onChange(items.filter((_, j) => j !== i))}
            style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(224,107,107,0.15)', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#E06B6B', fontSize: 14, fontWeight: '700' }}>×</Text>
          </Pressable>
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
        <TextInput style={[es.input, { flex: 1 }]} value={newItem} onChangeText={setNewItem}
          placeholder={placeholder || 'Add item...'} placeholderTextColor="#3A4255"
          onSubmitEditing={() => { if (newItem.trim()) { onChange([...items, newItem.trim()]); setNewItem(''); } }} />
        <Pressable onPress={() => { if (newItem.trim()) { onChange([...items, newItem.trim()]); setNewItem(''); } }}
          style={{ backgroundColor: (color || '#5B9BD5') + '20', borderRadius: 8, paddingHorizontal: 12, justifyContent: 'center', borderWidth: 1, borderColor: (color || '#5B9BD5') + '40' }}>
          <Text style={{ color: color || '#5B9BD5', fontWeight: '700', fontSize: 16 }}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Drawer Row Helper ──────────────────────────────────────────────────────
function DrawerRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 12, fontWeight: '600', color: '#8A95A3', fontFamily: FONT_HEADING, letterSpacing: 0.3, marginBottom: 2 }}>{label}</Text>
      {hint && <Text style={{ fontSize: 11, color: '#4A5568', fontFamily: FONT_BODY, marginBottom: 4 }}>{hint}</Text>}
      {children}
    </View>
  );
}

function DrawerSectionHeader({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <View style={{ width: 4, height: 16, borderRadius: 2, backgroundColor: color }} />
      <Text style={{ fontSize: 13, fontWeight: '700', color, fontFamily: FONT_HEADING, letterSpacing: 0.5 }}>{label}</Text>
    </View>
  );
}

function DrawerNumericInput({ value, onChange, prefix, suffix, min = 0 }: {
  value: number; onChange: (v: number) => void; prefix?: string; suffix?: string; min?: number;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {prefix && <Text style={{ color: '#8A95A3', fontSize: 13 }}>{prefix}</Text>}
      <TextInput
        style={[es.input, { flex: 1, paddingVertical: 8 }]}
        value={value > 0 ? String(value) : ''}
        onChangeText={(t) => { const n = parseFloat(t.replace(/[^0-9.]/g, '')); onChange(Math.max(min, isNaN(n) ? 0 : n)); }}
        placeholder="0" placeholderTextColor="#3A4255" keyboardType="decimal-pad"
      />
      {suffix && <Text style={{ color: '#8A95A3', fontSize: 13 }}>{suffix}</Text>}
    </View>
  );
}

// ─── Questionnaire Viewer ────────────────────────────────────────────────────
function QuestionnaireSection({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={q.section}><Text style={q.sectionLabel}>{label}</Text>{children}</View>;
}

function QRow({ label, value }: { label: string; value?: string | number | string[] }) {
  if (!value || (Array.isArray(value) && value.length === 0)) return null;
  const display = Array.isArray(value) ? value.join(', ') : String(value);
  if (!display.trim()) return null;
  return <View style={q.row}><Text style={q.rowLabel}>{label}</Text><Text style={q.rowValue}>{display}</Text></View>;
}

function ScoreBar({ label, value, max = 10 }: { label: string; value: number; max?: number }) {
  return (
    <View style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={q.rowLabel}>{label}</Text>
        <Text style={[q.rowValue, { color: '#F5A623' }]}>{value}/{max}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {Array.from({ length: max }).map((_, i) => (
          <View key={i} style={{ flex: 1, height: 6, borderRadius: 2, backgroundColor: i < value ? '#F5A623' : '#2A3347' }} />
        ))}
      </View>
    </View>
  );
}

function QuestionnaireViewer({ intake }: { intake: any }) {
  if (!intake) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <Icon name="document" size={48} color="#2A3347" />
        <Text style={{ color: '#4A5568', fontSize: 16, fontFamily: FONT_HEADING, marginTop: 16, textAlign: 'center' }}>No questionnaire submitted yet</Text>
        <Text style={{ color: '#4A5568', fontSize: 14, fontFamily: FONT_BODY, marginTop: 8, textAlign: 'center' }}>This member has not completed the intake form.</Text>
      </View>
    );
  }
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <QuestionnaireSection label="About You">
        <QRow label="Full Name" value={`${intake.firstName || ''} ${intake.lastName || ''}`.trim()} />
        <QRow label="Email" value={intake.email} />
        <QRow label="Phone" value={intake.phone} />
        <QRow label="Gender" value={intake.gender} />
        <QRow label="Date of Birth" value={intake.dateOfBirth} />
        <QRow label="Height" value={intake.heightFeet ? `${intake.heightFeet}'${intake.heightInches || 0}"` : undefined} />
        <QRow label="Weight" value={intake.weight ? `${intake.weight} lbs` : undefined} />
      </QuestionnaireSection>
      <QuestionnaireSection label="Work & Lifestyle">
        <QRow label="Occupation" value={intake.occupation} />
        <QRow label="Activity Level" value={intake.activityLevel} />
        <QRow label="Work Schedule" value={intake.workSchedule} />
        <QRow label="Physical Activities" value={intake.physicalActivities} />
      </QuestionnaireSection>
      <QuestionnaireSection label="Health & Medical History">
        <QRow label="Health Problems" value={intake.healthProblems} />
        <QRow label="Medications" value={intake.medications} />
        <QRow label="Therapies" value={intake.therapies} />
        <QRow label="Current Injuries" value={intake.currentInjuries} />
        <QRow label="Injury Areas" value={intake.injuries} />
        <QRow label="Stress / Motivation" value={intake.stressMotivation} />
        <QRow label="Family Heart Disease" value={intake.familyHeartDisease} />
        <QRow label="Family Diseases" value={intake.familyDiseases} />
        <QRow label="Diabetes" value={intake.diabetes} />
        <QRow label="Asthma" value={intake.asthma} />
        <QRow label="Cardiovascular" value={intake.cardiovascular} />
        <QRow label="Smoker" value={intake.smoker} />
        <QRow label="Emergency Contact" value={intake.emergencyContactName ? `${intake.emergencyContactName} — ${intake.emergencyContactPhone}` : undefined} />
      </QuestionnaireSection>
      <QuestionnaireSection label="Diet & Current Routine">
        <QRow label="Current Diet" value={intake.currentDiet} />
        <QRow label="Current Routine" value={intake.currentRoutine} />
        <QRow label="Energy Level" value={intake.energyLevel} />
        <QRow label="Stress Level" value={intake.stressLevel} />
      </QuestionnaireSection>
      <QuestionnaireSection label="Fitness Goals">
        <QRow label="Primary Goals" value={intake.primaryGoals} />
        <QRow label="Goal Weight" value={intake.goalWeight ? `${intake.goalWeight} lbs` : undefined} />
        <QRow label="Specific Goals" value={intake.specificGoals} />
      </QuestionnaireSection>
      <QuestionnaireSection label="Motivation & Readiness">
        <QRow label="Why Statement" value={intake.whyStatement} />
        {intake.readinessForChange !== undefined && <ScoreBar label="Readiness for Change" value={intake.readinessForChange} />}
        {intake.motivation !== undefined && <ScoreBar label="Motivation" value={intake.motivation} />}
        {intake.gymConfidence !== undefined && <ScoreBar label="Gym Confidence" value={intake.gymConfidence} />}
      </QuestionnaireSection>
      <QuestionnaireSection label="Scheduling & Availability">
        <QRow label="Preferred Days" value={intake.preferredDays} />
        <QRow label="Preferred Time" value={intake.preferredTime} />
        <QRow label="Sessions Per Week" value={intake.sessionsPerWeek} />
        <QRow label="Gym / Location" value={intake.gym} />
      </QuestionnaireSection>
    </ScrollView>
  );
}

// ─── Segmented Bar (read-only) ──────────────────────────────────────────────
function SegmentedBar({ value, max = 10, color }: { value: number; max?: number; color: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 3 }}>
      {Array.from({ length: max }).map((_, i) => (
        <View key={i} style={{ flex: 1, height: 6, borderRadius: 2, backgroundColor: i < value ? color : '#2A3347' }} />
      ))}
    </View>
  );
}


// ─── Plan Preview (Member-identical read-only view) ─────────────────────────
function PlanPreview({ plan }: { plan: MemberPlanData }) {
  const [expandedDay, setExpandedDay] = useState<number | null>(null);
  const [commitToSaveExpanded, setCommitToSaveExpanded] = useState(plan.commitToSaveDetailsExpandedByDefault || false);

  const currentPlan: DayPlan[] =
    plan.sessionsPerWeek === 4 ? plan.weekPlan4
    : plan.sessionsPerWeek === 3 ? plan.weekPlan3
    : plan.weekPlan2;

  const contractMonths = plan.contractLengthMonths || 12;
  const memberAge = plan.memberAge || plan.age;

  // Compute pricing
  const p = plan.pricingResult || (plan.pricingInputs ? calculatePricing(
    currentPlan, plan.sessionsPerWeek, plan.contractLengthMonths, plan.phases,
    plan.pricingInputs, plan.sessionGuidanceProfiles || [], plan.commitToSaveAddOnActive
  ) : null);

  const displayMonthly = p ? p.displayMonthlyPrice : (plan.monthlyPrice || 0);
  const ctsActive = plan.commitToSaveAddOnActive;
  const ctsSavings = plan.commitToSaveMonthlySavings || 100;
  const nutritionActive = plan.nutritionAddOnActive;
  const nutritionCost = plan.nutritionMonthlyCost || 100;
  const totalMonthly = displayMonthly + (nutritionActive ? nutritionCost : 0);
  const totalPayInFull = p ? Math.round(totalMonthly * contractMonths * 0.9) : (plan.payInFullPrice || 0);
  const totalSavings = totalMonthly * contractMonths - totalPayInFull;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
      {/* GoArrive Logo */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Image source={require('../../../assets/goarrive-icon.png')} style={{ width: 36, height: 36, borderRadius: 8 }} resizeMode="contain" />
        <Text style={{ fontSize: 11, color: '#5B9BD5', fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', fontFamily: FONT_HEADING }}>Fitness Plan</Text>
      </View>

      {/* Hero */}
      <View style={{ marginBottom: 16 }}>
        <View style={[pv.badge, { backgroundColor: 'rgba(91,155,213,0.12)', borderColor: 'rgba(91,155,213,0.25)', marginBottom: 14 }]}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#5B9BD5' }} />
          <Text style={{ fontSize: 11, fontWeight: '700', color: '#5B9BD5', fontFamily: FONT_HEADING, letterSpacing: 1 }}>{plan.identityTag?.toUpperCase() || 'FITNESS PLAN'}</Text>
        </View>
        <Text style={{ fontSize: 28, fontWeight: '700', color: '#F0F4F8', fontFamily: FONT_HEADING, letterSpacing: -0.5, marginBottom: 4 }}>{plan.memberName}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          {memberAge ? <Text style={{ fontSize: 13, color: '#8A95A3', fontWeight: '500' }}>{memberAge} years old</Text> : null}
          {plan.referredBy ? (
            <View style={[pv.badge, { backgroundColor: 'rgba(245,166,35,0.08)', borderColor: 'rgba(245,166,35,0.2)' }]}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#F5A623', letterSpacing: 0.4 }}>Referred by {plan.referredBy}</Text>
            </View>
          ) : null}
        </View>
        <Text style={{ fontSize: 20, fontWeight: '700', color: '#F0F4F8', marginBottom: 4 }}>{plan.memberName.split(' ')[0]}'s Tailored Plan</Text>
        <Text style={{ fontSize: 11, color: '#5B9BD5', fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>Built with GoArrive</Text>
        <View style={pv.darkCard}><Text style={{ color: '#C5CDD8', fontSize: 14, lineHeight: 22 }}>{plan.subtitle}</Text></View>
      </View>

      {/* Starting Points */}
      {plan.startingPoints && plan.startingPoints.length > 0 && (
        <View style={{ marginBottom: 20 }}>
          <Text style={pv.sectionLabel}>Where You're Starting From</Text>
          <View style={pv.darkCard}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {plan.startingPoints.map((chip, i) => (
                <View key={i} style={{ backgroundColor: '#1E2535', borderWidth: 1, borderColor: '#2A3347', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 }}>
                  <Text style={{ fontSize: 12, color: '#C5CDD8' }}>{chip}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      )}

      {/* Goals */}
      {plan.goals && plan.goals.length > 0 && (
        <View style={{ marginBottom: 20 }}>
          <Text style={pv.sectionLabel}>Your Health Goals</Text>
          <Text style={{ fontSize: 15, fontWeight: '700', color: '#F0F4F8', marginBottom: 12 }}>What we're building toward</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
            {plan.goals.map((goal, i) => {
              const cfg = (goalConfig as any)[goal] || { emoji: '🎯', color: '#8A95A3' };
              const gcfg = (goalConfig as any[]).find?.((g: any) => g.label === goal);
              return (
                <View key={i} style={{ flex: 1, minWidth: '45%', backgroundColor: gcfg?.bgColor || cfg.color + '15', borderColor: gcfg?.borderColor || cfg.color + '40', borderWidth: 1, borderRadius: 12, padding: 14 }}>
                  <Text style={{ fontSize: 24, marginBottom: 6 }}>{gcfg?.icon || cfg.emoji}</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: gcfg?.textColor || cfg.color }}>{goal}</Text>
                </View>
              );
            })}
          </View>
          {(plan.currentWeight || plan.goalWeight) ? (
            <View style={[pv.darkCard, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }]}>
              <View><Text style={pv.miniLabel}>CURRENT</Text><Text style={{ fontSize: 17, fontWeight: '700', color: '#F0F4F8' }}>{plan.currentWeight} lbs</Text></View>
              <Text style={{ color: '#5B9BD5', fontSize: 18 }}>→</Text>
              <View style={{ alignItems: 'flex-end' }}><Text style={[pv.miniLabel, { color: '#5B9BD5' }]}>GOAL</Text><Text style={{ fontSize: 17, fontWeight: '700', color: '#5B9BD5' }}>{plan.goalWeight}</Text></View>
            </View>
          ) : null}
          {plan.goalSummary ? (
            <View style={{ borderRadius: 12, padding: 14, backgroundColor: 'rgba(91,155,213,0.06)', borderWidth: 1, borderColor: 'rgba(91,155,213,0.25)' }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                <Text style={{ fontSize: 16 }}>🎯</Text>
                <Text style={{ color: '#C5CDD8', fontSize: 14, lineHeight: 22, fontStyle: 'italic', flex: 1 }}>{plan.goalSummary}</Text>
              </View>
            </View>
          ) : null}
        </View>
      )}

      {/* Why */}
      {plan.whyStatement ? (
        <View style={{ marginBottom: 20 }}>
          <Text style={pv.sectionLabel}>Your Why</Text>
          <View style={[pv.darkCard, { borderLeftWidth: 3, borderLeftColor: '#F5A623', marginBottom: 10 }]}>
            <Text style={[pv.miniLabel, { color: '#F5A623', marginBottom: 8 }]}>IN {plan.memberName.split(' ')[0].toUpperCase()}'S WORDS</Text>
            <Text style={{ color: '#F0F4F8', fontSize: 16, fontWeight: '600', lineHeight: 24, fontStyle: 'italic' }}>"{plan.whyStatement}"</Text>
          </View>
          {plan.whyTranslation ? (
            <View style={[pv.darkCard, { borderLeftWidth: 3, borderLeftColor: '#5B9BD5', marginBottom: 12 }]}>
              <Text style={{ color: '#C5CDD8', fontSize: 14, lineHeight: 22 }}>{plan.whyTranslation}</Text>
            </View>
          ) : null}
          <View style={pv.darkCard}>
            <View style={{ marginBottom: 14 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={pv.miniLabel}>READINESS</Text><Text style={{ color: '#6EBB7A', fontSize: 13, fontWeight: '700' }}>{plan.readiness}/10</Text>
              </View>
              <SegmentedBar value={plan.readiness} color="#6EBB7A" />
            </View>
            <View style={{ marginBottom: 14 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={pv.miniLabel}>MOTIVATION</Text><Text style={{ color: '#5B9BD5', fontSize: 13, fontWeight: '700' }}>{plan.motivation}/10</Text>
              </View>
              <SegmentedBar value={plan.motivation} color="#5B9BD5" />
            </View>
            {plan.gymConfidence ? (
              <View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={pv.miniLabel}>GYM CONFIDENCE</Text><Text style={{ color: '#F5A623', fontSize: 13, fontWeight: '700' }}>{plan.gymConfidence}/10</Text>
                </View>
                <SegmentedBar value={plan.gymConfidence} color="#F5A623" />
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Weekly Plan */}
      {currentPlan && currentPlan.length > 0 && (
        <View style={{ marginBottom: 20 }}>
          <Text style={pv.sectionLabel}>Your Weekly Plan</Text>
          <View style={[pv.darkCard, { marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
            <Text style={{ fontSize: 13, color: '#8A95A3' }}>Sessions per week</Text>
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#5B9BD5' }}>{plan.sessionsPerWeek}×</Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {currentPlan.map((day, i) => {
              const tc = typeColors[day.type] || typeColors.rest;
              return (
                <Pressable key={i} onPress={() => setExpandedDay(expandedDay === i ? null : i)}
                  style={{ flex: 1, minWidth: 80, backgroundColor: tc.bg, borderWidth: 1, borderColor: expandedDay === i ? tc.text : tc.border, borderRadius: 10, padding: 10, alignItems: 'center' }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: tc.text, marginBottom: 2 }}>{day.shortDay}</Text>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tc.dot, marginBottom: 4 }} />
                  <Text style={{ fontSize: 10, color: '#8A95A3', textAlign: 'center' }} numberOfLines={1}>{day.label.split('—')[0].trim()}</Text>
                </Pressable>
              );
            })}
          </View>
          {expandedDay !== null && (
            <View style={[pv.darkCard, { borderWidth: 1, borderColor: (typeColors[currentPlan[expandedDay].type] || typeColors.rest).border }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: (typeColors[currentPlan[expandedDay].type] || typeColors.rest).text }}>{currentPlan[expandedDay].day}</Text>
                  <Text style={{ fontSize: 13, color: '#8A95A3' }}>— {currentPlan[expandedDay].label}</Text>
                </View>
                {currentPlan[expandedDay].duration ? (
                  <View style={[pv.badge, { backgroundColor: 'rgba(91,155,213,0.12)', borderColor: 'rgba(91,155,213,0.2)' }]}>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: '#5B9BD5', letterSpacing: 0.4 }}>{currentPlan[expandedDay].duration}</Text>
                  </View>
                ) : null}
              </View>
              {currentPlan[expandedDay].breakdown?.map((item, j) => (
                <View key={j} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                  <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: (typeColors[currentPlan[expandedDay].type] || typeColors.rest).dot, marginTop: 7 }} />
                  <Text style={{ fontSize: 14, color: '#C5CDD8', lineHeight: 22 }}>{item}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Coaching Evolution */}
      {plan.phases && plan.phases.length > 0 && (
        <View style={{ marginBottom: 20 }}>
          <Text style={pv.sectionLabel}>How Your Coaching Support Evolves</Text>
          <View style={{ flexDirection: 'row', borderRadius: 12, overflow: 'hidden', height: 8, marginBottom: 12 }}>
            {plan.phases.map((phase, i) => <View key={phase.id} style={{ flex: phase.weeks, backgroundColor: phaseColors[i % phaseColors.length], opacity: 0.85 }} />)}
          </View>
          <View style={{ flexDirection: 'row', gap: 4, marginBottom: 14 }}>
            {plan.phases.map((phase, i) => (
              <View key={phase.id} style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ fontSize: 10, fontWeight: '600', color: phaseColors[i % phaseColors.length], textTransform: 'uppercase', letterSpacing: 0.5 }}>{phase.name}</Text>
                <Text style={{ fontSize: 10, color: '#8A95A3', marginTop: 2 }}>{phase.weeks}w</Text>
              </View>
            ))}
          </View>
          {plan.phases.map((phase, i) => (
            <View key={phase.id} style={[pv.darkCard, { borderLeftWidth: 3, borderLeftColor: phaseColors[i % phaseColors.length], marginBottom: 10 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <View style={{ backgroundColor: `${phaseColors[i % phaseColors.length]}20`, borderWidth: 1, borderColor: `${phaseColors[i % phaseColors.length]}40`, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: phaseColors[i % phaseColors.length] }}>Phase {phase.id}</Text>
                </View>
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#F0F4F8' }}>{phase.name}</Text>
                <Text style={{ fontSize: 12, color: '#8A95A3', marginLeft: 'auto' }}>{phase.weeks} weeks</Text>
              </View>
              <Text style={{ fontSize: 13, color: '#C5CDD8', lineHeight: 21 }}>{phase.description}</Text>
            </View>
          ))}
        </View>
      )}

      {/* What's Included */}
      {plan.whatsIncluded && plan.whatsIncluded.length > 0 && (
        <View style={{ marginBottom: 20 }}>
          <Text style={pv.sectionLabel}>What's Included</Text>
          <View style={pv.darkCard}>
            {plan.whatsIncluded.map((item, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(110,187,122,0.15)', borderWidth: 1, borderColor: 'rgba(110,187,122,0.3)', justifyContent: 'center', alignItems: 'center', marginTop: 1 }}>
                  <Text style={{ fontSize: 11, color: '#6EBB7A', fontWeight: '700' }}>✓</Text>
                </View>
                <Text style={{ fontSize: 14, color: '#C5CDD8', lineHeight: 22, flex: 1 }}>{item}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Commit to Save */}
      {plan.commitToSaveEnabled && (
        <View style={{ marginBottom: 20 }}>
          <Text style={pv.sectionLabel}>Commit to Save</Text>
          <View style={[pv.darkCard, { borderColor: 'rgba(245,166,35,0.25)' }]}>
            {/* Header row */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(245,166,35,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 16 }}>🔒</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#F0F4F8' }}>Commit to Save</Text>
                <Text style={{ fontSize: 12, color: '#F5A623' }}>Save {formatCurrency(ctsSavings)}/mo</Text>
              </View>
              {/* Active toggle indicator */}
              <View style={{ backgroundColor: ctsActive ? 'rgba(110,187,122,0.15)' : 'rgba(138,149,163,0.1)', borderWidth: 1, borderColor: ctsActive ? 'rgba(110,187,122,0.3)' : '#2A3347', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: ctsActive ? '#6EBB7A' : '#8A95A3' }}>{ctsActive ? 'Active' : 'Inactive'}</Text>
              </View>
            </View>

            {/* Stats grid */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              <View style={{ flex: 1, backgroundColor: 'rgba(245,166,35,0.06)', borderWidth: 1, borderColor: 'rgba(245,166,35,0.15)', borderRadius: 10, padding: 10 }}>
                <Text style={{ fontSize: 10, fontWeight: '600', color: '#F5A623', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }}>Monthly Savings</Text>
                <Text style={{ fontSize: 18, fontWeight: '700', color: '#F5A623' }}>{formatCurrency(ctsSavings)}</Text>
              </View>
              <View style={{ flex: 1, backgroundColor: 'rgba(91,155,213,0.06)', borderWidth: 1, borderColor: 'rgba(91,155,213,0.15)', borderRadius: 10, padding: 10 }}>
                <Text style={{ fontSize: 10, fontWeight: '600', color: '#5B9BD5', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }}>Streak Bonus</Text>
                <Text style={{ fontSize: 18, fontWeight: '700', color: '#5B9BD5' }}>{plan.commitToSaveNextMonthPercentOff || 5}% off</Text>
                <Text style={{ fontSize: 10, color: '#8A95A3' }}>next month</Text>
              </View>
              <View style={{ flex: 1, backgroundColor: 'rgba(138,149,163,0.06)', borderWidth: 1, borderColor: 'rgba(138,149,163,0.15)', borderRadius: 10, padding: 10 }}>
                <Text style={{ fontSize: 10, fontWeight: '600', color: '#8A95A3', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }}>Missed Session</Text>
                <Text style={{ fontSize: 18, fontWeight: '700', color: '#C5CDD8' }}>${plan.commitToSaveMissedSessionFee || 50}</Text>
                <Text style={{ fontSize: 10, color: '#8A95A3' }}>if not made up</Text>
              </View>
            </View>

            {/* Summary */}
            <Text style={{ fontSize: 13, color: '#C5CDD8', lineHeight: 20, marginBottom: 10 }}>{plan.commitToSaveSummary}</Text>

            {/* Expand toggle */}
            <Pressable onPress={() => setCommitToSaveExpanded(!commitToSaveExpanded)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#F5A623' }}>{commitToSaveExpanded ? 'Hide details' : 'How it works'}</Text>
              <Text style={{ fontSize: 12, color: '#F5A623' }}>{commitToSaveExpanded ? '▴' : '▾'}</Text>
            </Pressable>

            {commitToSaveExpanded && (
              <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(245,166,35,0.1)' }}>
                {[
                  { color: '#F5A623', text: `Commit to Save lowers your monthly rate by ${formatCurrency(ctsSavings)} while it's active.` },
                  { color: '#5B9BD5', text: `Complete a 30-day streak and unlock an additional ${plan.commitToSaveNextMonthPercentOff || 5}% discount on the following month.` },
                  { color: '#C5CDD8', text: `If you miss a session without making it up within ${plan.commitToSaveMakeUpWindowHours || 48} hours, a $${plan.commitToSaveMissedSessionFee || 50} accountability fee applies.` },
                  ...(plan.commitToSaveEmergencyWaiverEnabled ? [{ color: '#6EBB7A', text: 'Fees are waived for family emergencies or illness.' }] : []),
                  { color: '#C5CDD8', text: 'You can opt out at any time.' },
                  { color: '#C5CDD8', text: plan.commitToSaveReentryRule || 'If you opt out, you can re-enter at the start of the next year.' },
                ].map((item, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: item.color, marginTop: 2, width: 12 }}>→</Text>
                    <Text style={{ fontSize: 13, color: '#C5CDD8', lineHeight: 20, flex: 1 }}>{item.text}</Text>
                  </View>
                ))}
                <View style={{ backgroundColor: 'rgba(245,166,35,0.05)', borderWidth: 1, borderColor: 'rgba(245,166,35,0.12)', borderRadius: 10, padding: 12, marginTop: 4 }}>
                  <Text style={{ fontSize: 12, color: '#C5CDD8', lineHeight: 20, fontStyle: 'italic' }}>
                    This is a commitment reward system built to help you follow through on what you already said you want to do. Best for highly committed members who want to save.
                  </Text>
                </View>
              </View>
            )}
          </View>
        </View>
      )}

      {/* Nutrition Add-On */}
      {plan.nutritionEnabled && (
        <View style={{ marginBottom: 20 }}>
          <Text style={pv.sectionLabel}>Nutrition Coaching</Text>
          <View style={[pv.darkCard, { borderColor: 'rgba(110,187,122,0.25)' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(110,187,122,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 16 }}>🥗</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#F0F4F8' }}>Nutrition Add-On</Text>
                <Text style={{ fontSize: 12, color: '#6EBB7A' }}>+{formatCurrency(nutritionCost)}/mo</Text>
              </View>
              <View style={{ backgroundColor: nutritionActive ? 'rgba(110,187,122,0.15)' : 'rgba(138,149,163,0.1)', borderWidth: 1, borderColor: nutritionActive ? 'rgba(110,187,122,0.3)' : '#2A3347', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: nutritionActive ? '#6EBB7A' : '#8A95A3' }}>{nutritionActive ? 'Added' : 'Available'}</Text>
              </View>
            </View>
            <Text style={{ fontSize: 13, color: '#C5CDD8', lineHeight: 20, marginBottom: 8 }}>{plan.nutritionDescription}</Text>
            {!plan.nutritionInHouse && plan.nutritionProviderName ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <Text style={{ fontSize: 12, color: '#8A95A3' }}>Provided by</Text>
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#6EBB7A' }}>{plan.nutritionProviderName}</Text>
              </View>
            ) : null}
          </View>
        </View>
      )}

      {/* Investment */}
      {plan.showInvestment && displayMonthly > 0 && (
        <View style={{ marginBottom: 20 }}>
          <Text style={pv.sectionLabel}>Your Coaching Investment</Text>
          {/* Pricing cards */}
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
            <View style={[pv.darkCard, { flex: 1, borderColor: 'rgba(91,155,213,0.35)' }]}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: '#8A95A3', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Monthly</Text>
              <Text style={{ fontSize: 30, fontWeight: '800', color: '#F0F4F8', lineHeight: 34 }}>{formatCurrency(displayMonthly)}</Text>
              <Text style={{ fontSize: 12, color: '#8A95A3', marginTop: 2 }}>/mo</Text>
              {p && p.perSessionPrice > 0 ? <Text style={{ fontSize: 12, color: '#5B9BD5', marginTop: 8 }}>{formatCurrency(p.perSessionPrice)} per session</Text> : null}
            </View>
            <View style={[pv.darkCard, { flex: 1, backgroundColor: 'rgba(245,166,35,0.08)', borderColor: 'rgba(245,166,35,0.35)' }]}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: '#F5A623', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Pay in Full</Text>
              <Text style={{ fontSize: 30, fontWeight: '800', color: '#F5A623', lineHeight: 34 }}>{formatCurrency(Math.round(totalPayInFull / contractMonths))}</Text>
              <Text style={{ fontSize: 12, color: '#8A95A3', marginTop: 2 }}>/mo equivalent</Text>
              <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(245,166,35,0.15)' }}>
                <Text style={{ fontSize: 12, color: '#8A95A3' }}>{formatCurrency(totalPayInFull)} total</Text>
                <Text style={{ fontSize: 12, color: '#6EBB7A', marginTop: 2, fontWeight: '600' }}>Save {formatCurrency(totalSavings)} (10% off)</Text>
              </View>
            </View>
          </View>

          {/* Price breakdown */}
          <View style={pv.darkCard}>
            <Text style={{ fontSize: 13, color: '#C5CDD8', lineHeight: 20, marginBottom: 10 }}>
              Your monthly rate is calculated from your coach's hourly rate, the length of each session, how many sessions you have per week, monthly check-in calls, and the time your coach spends building your program.
            </Text>
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12, color: '#8A95A3' }}>Base monthly rate</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#F0F4F8' }}>{formatCurrency(p ? p.baseMonthlyPrice : displayMonthly)}/mo</Text>
              </View>
              {ctsActive && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 12, color: '#F5A623' }}>Commit to Save</Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#F5A623' }}>−{formatCurrency(ctsSavings)}/mo</Text>
                </View>
              )}
              {nutritionActive && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 12, color: '#6EBB7A' }}>Nutrition add-on</Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#6EBB7A' }}>+{formatCurrency(nutritionCost)}/mo</Text>
                </View>
              )}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(91,155,213,0.15)' }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#F0F4F8' }}>Your total</Text>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#F5A623' }}>{formatCurrency(totalMonthly)}/mo</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12, color: '#8A95A3' }}>Pay in full ({contractMonths} months)</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#F5A623' }}>{formatCurrency(totalPayInFull)} (save {formatCurrency(totalSavings)})</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </ScrollView>
  );
}


// ─── Plan Editor (Coach Edit Mode) ──────────────────────────────────────────

function PlanEditor({ plan, updatePlan }: { plan: MemberPlanData; updatePlan: (updates: Partial<MemberPlanData>) => void }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

  const currentWeekKey = plan.sessionsPerWeek === 4 ? 'weekPlan4' : plan.sessionsPerWeek === 3 ? 'weekPlan3' : 'weekPlan2';
  const currentPlan = (plan[currentWeekKey] || plan.weekPlan4) as DayPlan[];

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
      {/* GoArrive Logo */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Image source={require('../../../assets/goarrive-icon.png')} style={{ width: 36, height: 36, borderRadius: 8 }} resizeMode="contain" />
        <Text style={{ fontSize: 13, color: '#F5A623', fontWeight: '700', letterSpacing: 0.5, fontFamily: FONT_HEADING }}>Fitness Plan Editor</Text>
      </View>

      {/* ── Hero Section ── */}
      <SectionEditor title="Hero / Identity" color="#5B9BD5" collapsed={!!collapsed.hero} onToggle={() => toggle('hero')}>
        <EditField label="Member Name" value={plan.memberName} onChangeText={(v) => updatePlan({ memberName: v })} />
        <EditNumberField label="Age" value={plan.memberAge || plan.age} onChange={(v) => updatePlan({ memberAge: v, age: v })} />
        <EditField label="Identity Tag" value={plan.identityTag} onChangeText={(v) => updatePlan({ identityTag: v })} hint="e.g. Ready to train seriously" />
        <EditField label="Referred By" value={plan.referredBy || ''} onChangeText={(v) => updatePlan({ referredBy: v })} />
        <EditField label="Plan Subtitle" value={plan.subtitle || ''} onChangeText={(v) => updatePlan({ subtitle: v })} multiline hint="The tagline shown below the member's name" />
      </SectionEditor>

      {/* ── Starting Points ── */}
      <SectionEditor title="Starting Points" color="#8A95A3" collapsed={!!collapsed.starting} onToggle={() => toggle('starting')}>
        <Text style={es.fieldHint}>Chips that describe where the member is starting from</Text>
        <ListEditor items={plan.startingPoints || []} onChange={(v) => updatePlan({ startingPoints: v })} placeholder="Add starting point..." color="#8A95A3" />
      </SectionEditor>

      {/* ── Goals ── */}
      <SectionEditor title="Health Goals" color="#6EBB7A" collapsed={!!collapsed.goals} onToggle={() => toggle('goals')}>
        <Text style={[es.fieldLabel, { marginBottom: 8 }]}>Select Goals</Text>
        <ChipSelector
          selected={plan.goals || []}
          options={availableGoals}
          onToggle={(goal) => {
            const current = plan.goals || [];
            updatePlan({ goals: current.includes(goal) ? current.filter(g => g !== goal) : [...current, goal] });
          }}
          color="#6EBB7A"
        />
        <View style={{ marginTop: 16 }}>
          <EditNumberField label="Current Weight" value={plan.currentWeight} onChange={(v) => updatePlan({ currentWeight: v })} suffix="lbs" />
          <EditField label="Goal Weight" value={plan.goalWeight || ''} onChangeText={(v) => updatePlan({ goalWeight: v })} placeholder="e.g. 191–195 lbs" />
          <EditField label="Goal Summary" value={plan.goalSummary || ''} onChangeText={(v) => updatePlan({ goalSummary: v })} multiline hint="Summarize what the plan is designed to achieve" />
        </View>
      </SectionEditor>

      {/* ── Why ── */}
      <SectionEditor title="Their Why" color="#F5A623" collapsed={!!collapsed.why} onToggle={() => toggle('why')}>
        <EditField label="Why Statement" value={plan.whyStatement || ''} onChangeText={(v) => updatePlan({ whyStatement: v })} multiline hint="In the member's own words" />
        <EditField label="Coach Translation" value={plan.whyTranslation || ''} onChangeText={(v) => updatePlan({ whyTranslation: v })} multiline hint="Your interpretation of their why" />
        <EditSlider label="Readiness" value={plan.readiness || 5} onChange={(v) => updatePlan({ readiness: v })} color="#6EBB7A" />
        <EditSlider label="Motivation" value={plan.motivation || 5} onChange={(v) => updatePlan({ motivation: v })} color="#5B9BD5" />
        <EditSlider label="Gym Confidence" value={plan.gymConfidence || 5} onChange={(v) => updatePlan({ gymConfidence: v })} color="#F5A623" />
      </SectionEditor>

      {/* ── Weekly Plan ── */}
      <SectionEditor title="Weekly Plan" color="#5B9BD5" collapsed={!!collapsed.weekly} onToggle={() => toggle('weekly')}>
        <Text style={[es.fieldLabel, { marginBottom: 8 }]}>Sessions Per Week</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
          {([2, 3, 4] as const).map((n) => (
            <Pressable key={n} onPress={() => updatePlan({ sessionsPerWeek: n as SessionsPerWeek })}
              style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
                backgroundColor: plan.sessionsPerWeek === n ? '#5B9BD520' : '#161B25',
                borderWidth: 1, borderColor: plan.sessionsPerWeek === n ? '#5B9BD550' : '#2A3347' }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: plan.sessionsPerWeek === n ? '#5B9BD5' : '#8A95A3' }}>{n}</Text>
              <Text style={{ fontSize: 10, color: '#4A5568', marginTop: 2 }}>per week</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[es.fieldLabel, { marginBottom: 8 }]}>Contract Length</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
          {([6, 9, 12] as const).map((n) => (
            <Pressable key={n} onPress={() => updatePlan({ contractLengthMonths: n as ContractLength })}
              style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
                backgroundColor: plan.contractLengthMonths === n ? '#F5A62320' : '#161B25',
                borderWidth: 1, borderColor: plan.contractLengthMonths === n ? '#F5A62350' : '#2A3347' }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: plan.contractLengthMonths === n ? '#F5A623' : '#8A95A3' }}>{n}</Text>
              <Text style={{ fontSize: 10, color: '#4A5568', marginTop: 2 }}>months</Text>
            </Pressable>
          ))}
        </View>

        {/* Day editors */}
        {currentPlan.map((day, i) => (
          <View key={i} style={{ backgroundColor: '#161B25', borderRadius: 10, borderWidth: 1, borderColor: '#2A3347', padding: 12, marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#F0F4F8', width: 36 }}>{day.shortDay}</Text>
              <View style={{ flex: 1, flexDirection: 'row', gap: 4 }}>
                {dayTypeOptions.map((opt) => (
                  <Pressable key={opt.value} onPress={() => {
                    const updated = [...currentPlan];
                    updated[i] = { ...updated[i], type: opt.value, label: opt.label };
                    updatePlan({ [currentWeekKey]: updated } as any);
                  }}
                    style={{ flex: 1, paddingVertical: 5, borderRadius: 6, alignItems: 'center',
                      backgroundColor: day.type === opt.value ? (typeColors[opt.value]?.bg || '#1E2535') : 'transparent',
                      borderWidth: 1, borderColor: day.type === opt.value ? (typeColors[opt.value]?.border || '#2A3347') : 'transparent' }}>
                    <Text style={{ fontSize: 10, fontWeight: '600', color: day.type === opt.value ? (typeColors[opt.value]?.text || '#8A95A3') : '#4A5568' }}>{opt.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <TextInput style={[es.input, { paddingVertical: 6, fontSize: 12 }]} value={day.label}
              onChangeText={(v) => { const updated = [...currentPlan]; updated[i] = { ...updated[i], label: v }; updatePlan({ [currentWeekKey]: updated } as any); }}
              placeholder="Session label" placeholderTextColor="#3A4255" />
            {day.type !== 'rest' && (
              <TextInput style={[es.input, { paddingVertical: 6, fontSize: 12, marginTop: 6 }]} value={day.duration || ''}
                onChangeText={(v) => { const updated = [...currentPlan]; updated[i] = { ...updated[i], duration: v }; updatePlan({ [currentWeekKey]: updated } as any); }}
                placeholder="Duration (e.g. 60 min)" placeholderTextColor="#3A4255" />
            )}
          </View>
        ))}
      </SectionEditor>

      {/* ── Coaching Evolution ── */}
      <SectionEditor title="Coaching Evolution" color="#F5A623" collapsed={!!collapsed.phases} onToggle={() => toggle('phases')}>
        {plan.phases.map((phase, i) => (
          <View key={phase.id} style={{ backgroundColor: '#161B25', borderRadius: 10, borderWidth: 1, borderColor: (phaseColors[i % phaseColors.length]) + '30', padding: 12, marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <View style={{ backgroundColor: phaseColors[i % phaseColors.length] + '20', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: phaseColors[i % phaseColors.length] }}>Phase {phase.id}</Text>
              </View>
            </View>
            <EditField label="Name" value={phase.name} onChangeText={(v) => {
              const updated = [...plan.phases]; updated[i] = { ...updated[i], name: v }; updatePlan({ phases: updated });
            }} />
            <EditNumberField label="Weeks" value={phase.weeks} onChange={(v) => {
              const updated = [...plan.phases]; updated[i] = { ...updated[i], weeks: v }; updatePlan({ phases: updated });
            }} />
            <EditField label="Description" value={phase.description} onChangeText={(v) => {
              const updated = [...plan.phases]; updated[i] = { ...updated[i], description: v }; updatePlan({ phases: updated });
            }} multiline />
            {plan.phases.length > 1 && (
              <Pressable onPress={() => updatePlan({ phases: plan.phases.filter((_, j) => j !== i) })} style={{ marginTop: 6, alignSelf: 'flex-end' }}>
                <Text style={{ fontSize: 12, color: '#E06B6B' }}>Remove phase</Text>
              </Pressable>
            )}
          </View>
        ))}
        <Pressable onPress={() => { const newPhase: Phase = { id: plan.phases.length + 1, name: '', weeks: 12, description: '' }; updatePlan({ phases: [...plan.phases, newPhase] }); }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 }}>
          <Text style={{ fontSize: 18, color: '#F5A623', fontWeight: '700' }}>+</Text>
          <Text style={{ fontSize: 13, color: '#F5A623', fontWeight: '600' }}>Add Phase</Text>
        </Pressable>
      </SectionEditor>

      {/* ── What's Included ── */}
      <SectionEditor title="What's Included" color="#6EBB7A" collapsed={!!collapsed.included} onToggle={() => toggle('included')}>
        <ListEditor items={plan.whatsIncluded || []} onChange={(v) => updatePlan({ whatsIncluded: v })} placeholder="Add included item..." color="#6EBB7A" />
      </SectionEditor>

      {/* ── Commit to Save ── */}
      <SectionEditor title="Commit to Save" color="#F5A623" collapsed={!!collapsed.commitToSave} onToggle={() => toggle('commitToSave')}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <Text style={es.fieldLabel}>Show to Member</Text>
          <Pressable onPress={() => updatePlan({ commitToSaveEnabled: !plan.commitToSaveEnabled })}
            style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8,
              backgroundColor: plan.commitToSaveEnabled ? 'rgba(110,187,122,0.15)' : '#161B25',
              borderWidth: 1, borderColor: plan.commitToSaveEnabled ? 'rgba(110,187,122,0.3)' : '#2A3347' }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: plan.commitToSaveEnabled ? '#6EBB7A' : '#8A95A3' }}>{plan.commitToSaveEnabled ? 'Visible' : 'Hidden'}</Text>
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <Text style={es.fieldLabel}>Default Active for Member</Text>
          <Pressable onPress={() => updatePlan({ commitToSaveAddOnActive: !plan.commitToSaveAddOnActive })}
            style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8,
              backgroundColor: plan.commitToSaveAddOnActive ? 'rgba(245,166,35,0.15)' : '#161B25',
              borderWidth: 1, borderColor: plan.commitToSaveAddOnActive ? 'rgba(245,166,35,0.3)' : '#2A3347' }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: plan.commitToSaveAddOnActive ? '#F5A623' : '#8A95A3' }}>{plan.commitToSaveAddOnActive ? 'Active' : 'Inactive'}</Text>
          </Pressable>
        </View>
        <EditNumberField label="Monthly Savings" value={plan.commitToSaveMonthlySavings} onChange={(v) => updatePlan({ commitToSaveMonthlySavings: v })} prefix="$" suffix="/mo" />
        <EditNumberField label="Missed Session Fee" value={plan.commitToSaveMissedSessionFee} onChange={(v) => updatePlan({ commitToSaveMissedSessionFee: v })} prefix="$" />
        <EditNumberField label="Streak Bonus %" value={plan.commitToSaveNextMonthPercentOff} onChange={(v) => updatePlan({ commitToSaveNextMonthPercentOff: v })} suffix="% off" />
        <EditNumberField label="Make-Up Window" value={plan.commitToSaveMakeUpWindowHours} onChange={(v) => updatePlan({ commitToSaveMakeUpWindowHours: v })} suffix="hours" />
        <EditField label="Summary" value={plan.commitToSaveSummary || ''} onChangeText={(v) => updatePlan({ commitToSaveSummary: v })} multiline hint="Shown to the member" />
        <EditField label="Re-Entry Rule" value={plan.commitToSaveReentryRule || ''} onChangeText={(v) => updatePlan({ commitToSaveReentryRule: v })} multiline />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <Text style={es.fieldLabel}>Emergency Waiver</Text>
          <Pressable onPress={() => updatePlan({ commitToSaveEmergencyWaiverEnabled: !plan.commitToSaveEmergencyWaiverEnabled })}
            style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8,
              backgroundColor: plan.commitToSaveEmergencyWaiverEnabled ? 'rgba(110,187,122,0.15)' : '#161B25',
              borderWidth: 1, borderColor: plan.commitToSaveEmergencyWaiverEnabled ? 'rgba(110,187,122,0.3)' : '#2A3347' }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: plan.commitToSaveEmergencyWaiverEnabled ? '#6EBB7A' : '#8A95A3' }}>{plan.commitToSaveEmergencyWaiverEnabled ? 'Enabled' : 'Disabled'}</Text>
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={es.fieldLabel}>Details Expanded by Default</Text>
          <Pressable onPress={() => updatePlan({ commitToSaveDetailsExpandedByDefault: !plan.commitToSaveDetailsExpandedByDefault })}
            style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8,
              backgroundColor: plan.commitToSaveDetailsExpandedByDefault ? 'rgba(91,155,213,0.15)' : '#161B25',
              borderWidth: 1, borderColor: plan.commitToSaveDetailsExpandedByDefault ? 'rgba(91,155,213,0.3)' : '#2A3347' }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: plan.commitToSaveDetailsExpandedByDefault ? '#5B9BD5' : '#8A95A3' }}>{plan.commitToSaveDetailsExpandedByDefault ? 'Expanded' : 'Collapsed'}</Text>
          </Pressable>
        </View>
      </SectionEditor>

      {/* ── Nutrition Add-On ── */}
      <SectionEditor title="Nutrition Add-On" color="#6EBB7A" collapsed={!!collapsed.nutrition} onToggle={() => toggle('nutrition')}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <Text style={es.fieldLabel}>Show to Member</Text>
          <Pressable onPress={() => updatePlan({ nutritionEnabled: !plan.nutritionEnabled })}
            style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8,
              backgroundColor: plan.nutritionEnabled ? 'rgba(110,187,122,0.15)' : '#161B25',
              borderWidth: 1, borderColor: plan.nutritionEnabled ? 'rgba(110,187,122,0.3)' : '#2A3347' }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: plan.nutritionEnabled ? '#6EBB7A' : '#8A95A3' }}>{plan.nutritionEnabled ? 'Visible' : 'Hidden'}</Text>
          </Pressable>
        </View>
        <Text style={[es.fieldLabel, { marginBottom: 8 }]}>Delivery</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
          <Pressable onPress={() => updatePlan({ nutritionInHouse: true })}
            style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
              backgroundColor: plan.nutritionInHouse ? 'rgba(110,187,122,0.2)' : '#161B25',
              borderWidth: 1, borderColor: plan.nutritionInHouse ? 'rgba(110,187,122,0.5)' : '#2A3347' }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: plan.nutritionInHouse ? '#6EBB7A' : '#8A95A3' }}>I coach it</Text>
          </Pressable>
          <Pressable onPress={() => updatePlan({ nutritionInHouse: false })}
            style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
              backgroundColor: !plan.nutritionInHouse ? 'rgba(110,187,122,0.2)' : '#161B25',
              borderWidth: 1, borderColor: !plan.nutritionInHouse ? 'rgba(110,187,122,0.5)' : '#2A3347' }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: !plan.nutritionInHouse ? '#6EBB7A' : '#8A95A3' }}>Outsourced</Text>
          </Pressable>
        </View>
        {!plan.nutritionInHouse && (
          <EditField label="Provider Name" value={plan.nutritionProviderName || ''} onChangeText={(v) => updatePlan({ nutritionProviderName: v })} placeholder="e.g. Darren Fink" hint="Name shown to the member" />
        )}
        <EditNumberField label="Monthly Cost" value={plan.nutritionMonthlyCost} onChange={(v) => updatePlan({ nutritionMonthlyCost: v })} prefix="$" suffix="/mo" hint="Added to the member's monthly rate" />
        <EditField label="Description" value={plan.nutritionDescription || ''} onChangeText={(v) => updatePlan({ nutritionDescription: v })} multiline hint="Member-facing description" />
      </SectionEditor>

      {/* ── Investment & Pricing ── */}
      <SectionEditor title="Investment & Pricing" color="#F5A623" collapsed={!!collapsed.investment} onToggle={() => toggle('investment')}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <Text style={es.fieldLabel}>Show Investment to Member</Text>
          <Pressable onPress={() => updatePlan({ showInvestment: !plan.showInvestment })}
            style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8,
              backgroundColor: plan.showInvestment ? 'rgba(110,187,122,0.15)' : '#161B25',
              borderWidth: 1, borderColor: plan.showInvestment ? 'rgba(110,187,122,0.3)' : '#2A3347' }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: plan.showInvestment ? '#6EBB7A' : '#8A95A3' }}>{plan.showInvestment ? 'Visible' : 'Hidden'}</Text>
          </Pressable>
        </View>

        {/* Pricing Inputs */}
        <View style={{ backgroundColor: 'rgba(91,155,213,0.04)', borderWidth: 1, borderColor: 'rgba(91,155,213,0.12)', borderRadius: 12, padding: 12, marginBottom: 14 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: '#5B9BD5', letterSpacing: 0.5, marginBottom: 10, fontFamily: FONT_HEADING }}>Pricing Inputs</Text>
          <EditNumberField label="Hourly Rate" value={plan.pricingInputs?.hourlyRate} onChange={(v) => updatePlan({ pricingInputs: { ...plan.pricingInputs, hourlyRate: v } })} prefix="$" suffix="/hr" hint="Your coaching hourly rate" />
          <EditNumberField label="Session Length" value={plan.pricingInputs?.sessionLengthMinutes} onChange={(v) => updatePlan({ pricingInputs: { ...plan.pricingInputs, sessionLengthMinutes: v } })} suffix="min" />
          <EditNumberField label="Check-In Call Length" value={plan.pricingInputs?.checkInCallLengthMinutes} onChange={(v) => updatePlan({ pricingInputs: { ...plan.pricingInputs, checkInCallLengthMinutes: v } })} suffix="min/mo" />
          <EditNumberField label="Program Build Time" value={plan.pricingInputs?.programBuildTimeHours} onChange={(v) => updatePlan({ pricingInputs: { ...plan.pricingInputs, programBuildTimeHours: v } })} suffix="hrs" />
        </View>

        {/* Manual Override */}
        <View style={{ backgroundColor: 'rgba(245,166,35,0.04)', borderWidth: 1, borderColor: 'rgba(245,166,35,0.12)', borderRadius: 12, padding: 12, marginBottom: 14 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: '#F5A623', letterSpacing: 0.5, marginBottom: 10, fontFamily: FONT_HEADING }}>Manual Override</Text>
          <EditNumberField label="Override Monthly Price" value={plan.manualMonthlyOverride} onChange={(v) => updatePlan({ manualMonthlyOverride: v })} prefix="$" suffix="/mo" hint="Leave at 0 to use calculated price" />
          {plan.manualMonthlyOverride && plan.manualMonthlyOverride > 0 ? (
            <Pressable onPress={() => updatePlan({ manualMonthlyOverride: 0 })}
              style={{ alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: 'rgba(91,155,213,0.15)', borderWidth: 1, borderColor: 'rgba(91,155,213,0.3)' }}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#5B9BD5' }}>Reset to calculated</Text>
            </Pressable>
          ) : null}
        </View>

        {/* Calculated Preview */}
        {plan.pricingInputs && plan.pricingInputs.hourlyRate > 0 && (() => {
          const wp = plan.sessionsPerWeek === 4 ? plan.weekPlan4 : plan.sessionsPerWeek === 3 ? plan.weekPlan3 : plan.weekPlan2;
          const pr = calculatePricing(wp, plan.sessionsPerWeek, plan.contractLengthMonths, plan.phases,
            plan.pricingInputs, plan.sessionGuidanceProfiles || [], plan.commitToSaveAddOnActive, plan.manualMonthlyOverride);
          return (
            <View style={{ backgroundColor: 'rgba(110,187,122,0.04)', borderWidth: 1, borderColor: 'rgba(110,187,122,0.12)', borderRadius: 12, padding: 12 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#6EBB7A', letterSpacing: 0.5, marginBottom: 10, fontFamily: FONT_HEADING }}>Calculated Preview</Text>
              <View style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 12, color: '#8A95A3' }}>Total coaching hours</Text>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: '#F0F4F8' }}>{pr.totalHours.toFixed(1)} hrs</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 12, color: '#8A95A3' }}>Total program price</Text>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: '#F0F4F8' }}>{formatCurrency(pr.totalProgramPrice)}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 12, color: '#8A95A3' }}>Calculated monthly</Text>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: '#F0F4F8' }}>{formatCurrency(pr.calculatedMonthlyPrice)}/mo</Text>
                </View>
                {pr.isManualOverride && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 12, color: '#F5A623' }}>Manual override</Text>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: '#F5A623' }}>{formatCurrency(pr.baseMonthlyPrice)}/mo</Text>
                  </View>
                )}
                {pr.commitToSaveActive && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 12, color: '#F5A623' }}>Commit to Save</Text>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: '#F5A623' }}>−{formatCurrency(pr.commitToSaveSavings)}/mo</Text>
                  </View>
                )}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 6, borderTopWidth: 1, borderTopColor: 'rgba(110,187,122,0.2)', marginTop: 4 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#F0F4F8' }}>Display monthly</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#F5A623' }}>{formatCurrency(pr.displayMonthlyPrice)}/mo</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 12, color: '#8A95A3' }}>Per session</Text>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: '#5B9BD5' }}>{formatCurrency(pr.perSessionPrice)}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 12, color: '#8A95A3' }}>Pay in full</Text>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: '#F5A623' }}>{formatCurrency(pr.payInFullPrice)}</Text>
                </View>
              </View>
            </View>
          );
        })()}
      </SectionEditor>

      {/* ── Plan Status ── */}
      <SectionEditor title="Plan Status" color="#8A95A3" collapsed={!!collapsed.status} onToggle={() => toggle('status')}>
        <Text style={[es.fieldLabel, { marginBottom: 8 }]}>Status</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['draft', 'presented', 'active'] as const).map((st) => (
            <Pressable key={st} onPress={() => updatePlan({ status: st })}
              style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
                backgroundColor: plan.status === st ? (st === 'active' ? 'rgba(110,187,122,0.15)' : st === 'presented' ? 'rgba(91,155,213,0.15)' : 'rgba(138,149,163,0.1)') : '#161B25',
                borderWidth: 1, borderColor: plan.status === st ? (st === 'active' ? 'rgba(110,187,122,0.3)' : st === 'presented' ? 'rgba(91,155,213,0.3)' : '#2A3347') : '#2A3347' }}>
              <Text style={{ fontSize: 13, fontWeight: '600', textTransform: 'capitalize',
                color: plan.status === st ? (st === 'active' ? '#6EBB7A' : st === 'presented' ? '#5B9BD5' : '#8A95A3') : '#4A5568' }}>{st}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[es.fieldHint, { marginTop: 8 }]}>Draft = only you can see it. Presented = member can view. Active = plan is live.</Text>
      </SectionEditor>
    </ScrollView>
  );
}


// ─── Plan Controls Drawer (Bottom Sheet) ────────────────────────────────────

function PlanControlsDrawer({ visible, onClose, plan, updatePlan }: {
  visible: boolean; onClose: () => void; plan: MemberPlanData;
  updatePlan: (updates: Partial<MemberPlanData>) => void;
}) {
  if (!visible) return null;

  const currentPlan = plan.sessionsPerWeek === 4 ? plan.weekPlan4 : plan.sessionsPerWeek === 3 ? plan.weekPlan3 : plan.weekPlan2;
  const pr = plan.pricingInputs && plan.pricingInputs.hourlyRate > 0
    ? calculatePricing(currentPlan, plan.sessionsPerWeek, plan.contractLengthMonths, plan.phases,
        plan.pricingInputs, plan.sessionGuidanceProfiles || [], plan.commitToSaveAddOnActive, plan.manualMonthlyOverride)
    : null;

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }} onPress={onClose} />
      <View style={{ backgroundColor: '#0E1117', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%', borderTopWidth: 1, borderTopColor: '#2A3347' }}>
        {/* Handle */}
        <View style={{ alignItems: 'center', paddingVertical: 10 }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: '#2A3347' }} />
        </View>
        <Text style={{ fontSize: 16, fontWeight: '700', color: '#F0F4F8', fontFamily: FONT_HEADING, paddingHorizontal: 16, marginBottom: 12 }}>Plan Controls</Text>

        <ScrollView style={{ paddingHorizontal: 16 }} contentContainerStyle={{ paddingBottom: 40 }}>
          {/* Sessions per week */}
          <DrawerSectionHeader label="Schedule" color="#5B9BD5" />
          <DrawerRow label="Sessions per week">
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {([2, 3, 4, 5, 6] as const).map((n) => (
                <Pressable key={n} onPress={() => updatePlan({ sessionsPerWeek: n as SessionsPerWeek })}
                  style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center',
                    backgroundColor: plan.sessionsPerWeek === n ? '#5B9BD520' : '#161B25',
                    borderWidth: 1, borderColor: plan.sessionsPerWeek === n ? '#5B9BD550' : '#2A3347' }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: plan.sessionsPerWeek === n ? '#5B9BD5' : '#8A95A3' }}>{n}</Text>
                </Pressable>
              ))}
            </View>
          </DrawerRow>

          <DrawerRow label="Contract length">
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {([6, 9, 12] as const).map((n) => (
                <Pressable key={n} onPress={() => updatePlan({ contractLengthMonths: n as ContractLength })}
                  style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center',
                    backgroundColor: plan.contractLengthMonths === n ? '#F5A62320' : '#161B25',
                    borderWidth: 1, borderColor: plan.contractLengthMonths === n ? '#F5A62350' : '#2A3347' }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: plan.contractLengthMonths === n ? '#F5A623' : '#8A95A3' }}>{n}</Text>
                  <Text style={{ fontSize: 10, color: '#4A5568' }}>mo</Text>
                </Pressable>
              ))}
            </View>
          </DrawerRow>

          {/* Pricing */}
          <DrawerSectionHeader label="Pricing" color="#F5A623" />
          <DrawerRow label="Hourly Rate" hint="Your coaching hourly rate">
            <DrawerNumericInput value={plan.pricingInputs?.hourlyRate || 0} onChange={(v) => updatePlan({ pricingInputs: { ...plan.pricingInputs, hourlyRate: v } })} prefix="$" suffix="/hr" />
          </DrawerRow>
          <DrawerRow label="Session Length">
            <DrawerNumericInput value={plan.pricingInputs?.sessionLengthMinutes || 0} onChange={(v) => updatePlan({ pricingInputs: { ...plan.pricingInputs, sessionLengthMinutes: v } })} suffix="min" />
          </DrawerRow>
          <DrawerRow label="Check-In Call Length">
            <DrawerNumericInput value={plan.pricingInputs?.checkInCallLengthMinutes || 0} onChange={(v) => updatePlan({ pricingInputs: { ...plan.pricingInputs, checkInCallLengthMinutes: v } })} suffix="min/mo" />
          </DrawerRow>
          <DrawerRow label="Program Build Time">
            <DrawerNumericInput value={plan.pricingInputs?.programBuildTimeHours || 0} onChange={(v) => updatePlan({ pricingInputs: { ...plan.pricingInputs, programBuildTimeHours: v } })} suffix="hrs" />
          </DrawerRow>

          <DrawerRow label="Monthly price override" hint="Leave empty to use auto-calculated price">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <DrawerNumericInput value={plan.manualMonthlyOverride || 0} onChange={(v) => updatePlan({ manualMonthlyOverride: v })} prefix="$" suffix="/mo" />
              </View>
              {plan.manualMonthlyOverride && plan.manualMonthlyOverride > 0 ? (
                <Pressable onPress={() => updatePlan({ manualMonthlyOverride: 0 })}
                  style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: 'rgba(91,155,213,0.15)', borderWidth: 1, borderColor: 'rgba(91,155,213,0.3)' }}>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: '#5B9BD5' }}>Reset</Text>
                </Pressable>
              ) : null}
            </View>
          </DrawerRow>

          {/* Calculated price display */}
          {pr && (
            <View style={{ backgroundColor: 'rgba(245,166,35,0.04)', borderWidth: 1, borderColor: 'rgba(245,166,35,0.12)', borderRadius: 12, padding: 12, marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ fontSize: 12, color: '#8A95A3' }}>Calculated</Text>
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#F0F4F8' }}>{formatCurrency(pr.calculatedMonthlyPrice)}/mo</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#F0F4F8' }}>Display price</Text>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#F5A623' }}>{formatCurrency(pr.displayMonthlyPrice)}/mo</Text>
              </View>
            </View>
          )}

          {/* Visibility */}
          <DrawerSectionHeader label="Visibility" color="#8A95A3" />
          <DrawerRow label="Investment visibility">
            <Pressable onPress={() => updatePlan({ showInvestment: !plan.showInvestment })}
              style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
                backgroundColor: plan.showInvestment ? 'rgba(110,187,122,0.15)' : '#161B25',
                borderWidth: 1, borderColor: plan.showInvestment ? 'rgba(110,187,122,0.3)' : '#2A3347' }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: plan.showInvestment ? '#6EBB7A' : '#8A95A3' }}>
                {plan.showInvestment ? 'Investment visible to member' : 'Investment hidden from member'}
              </Text>
            </Pressable>
          </DrawerRow>

          {/* Nutrition */}
          <DrawerSectionHeader label="Nutrition Add-On" color="#6EBB7A" />
          <DrawerRow label="Include nutrition coaching">
            <Pressable onPress={() => updatePlan({ nutritionEnabled: !plan.nutritionEnabled })}
              style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
                backgroundColor: plan.nutritionEnabled ? 'rgba(110,187,122,0.15)' : '#161B25',
                borderWidth: 1, borderColor: plan.nutritionEnabled ? 'rgba(110,187,122,0.3)' : '#2A3347' }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: plan.nutritionEnabled ? '#6EBB7A' : '#8A95A3' }}>
                {plan.nutritionEnabled ? 'Section visible' : 'Section hidden'}
              </Text>
            </Pressable>
          </DrawerRow>

          {/* Commit to Save */}
          <DrawerSectionHeader label="Commit to Save" color="#F5A623" />
          <DrawerRow label="Enable Commit to Save">
            <Pressable onPress={() => updatePlan({ commitToSaveEnabled: !plan.commitToSaveEnabled })}
              style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
                backgroundColor: plan.commitToSaveEnabled ? 'rgba(245,166,35,0.15)' : '#161B25',
                borderWidth: 1, borderColor: plan.commitToSaveEnabled ? 'rgba(245,166,35,0.3)' : '#2A3347' }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: plan.commitToSaveEnabled ? '#F5A623' : '#8A95A3' }}>
                {plan.commitToSaveEnabled ? 'Section visible' : 'Section hidden'}
              </Text>
            </Pressable>
          </DrawerRow>

          {/* Guidance Profiles */}
          <DrawerSectionHeader label="Guidance Profiles" color="#5B9BD5" />
          <Text style={{ fontSize: 11, color: '#4A5568', fontFamily: FONT_BODY, marginBottom: 10 }}>
            Set guidance level per session type per phase. This affects pricing calculation.
          </Text>
          {(plan.sessionGuidanceProfiles || []).map((profile, pi) => (
            <View key={profile.sessionType} style={{ backgroundColor: '#161B25', borderRadius: 10, borderWidth: 1, borderColor: '#2A3347', padding: 10, marginBottom: 8 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#F0F4F8', marginBottom: 8, fontFamily: FONT_HEADING }}>{profile.sessionType}</Text>
              {(['phase1', 'phase2', 'phase3'] as const).map((phaseKey, phaseIdx) => (
                <View key={phaseKey} style={{ marginBottom: 6 }}>
                  <Text style={{ fontSize: 10, color: '#8A95A3', marginBottom: 4 }}>Phase {phaseIdx + 1}</Text>
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    {guidanceLevels.map((level) => (
                      <Pressable key={level} onPress={() => {
                        const updated = [...(plan.sessionGuidanceProfiles || [])];
                        updated[pi] = { ...updated[pi], [phaseKey]: level };
                        updatePlan({ sessionGuidanceProfiles: updated });
                      }}
                        style={{ flex: 1, paddingVertical: 5, borderRadius: 6, alignItems: 'center',
                          backgroundColor: profile[phaseKey] === level ? '#5B9BD520' : 'transparent',
                          borderWidth: 1, borderColor: profile[phaseKey] === level ? '#5B9BD550' : '#2A3347' }}>
                        <Text style={{ fontSize: 9, fontWeight: '600', color: profile[phaseKey] === level ? '#5B9BD5' : '#4A5568', textAlign: 'center' }}>{level}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          ))}
        </ScrollView>

        {/* Close button */}
        <View style={{ paddingHorizontal: 16, paddingBottom: Platform.OS === 'ios' ? 34 : 16, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#1E2A3A' }}>
          <Pressable onPress={onClose}
            style={{ backgroundColor: '#5B9BD5', borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff', fontFamily: FONT_HEADING }}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}


// ─── Plan Viewer (Coach — wraps editor + preview + drawer) ─────────────────

function PlanViewer({ plan, memberName, memberId, onPlanUpdate }: {
  plan: MemberPlanData | null; memberName: string; memberId: string;
  onPlanUpdate: (plan: MemberPlanData) => void;
}) {
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState<ViewMode>('edit');
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [showShareToast, setShowShareToast] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [localPlan, setLocalPlan] = useState<MemberPlanData | null>(plan);

  useEffect(() => { setLocalPlan(plan); }, [plan]);

  const updatePlan = useCallback((updates: Partial<MemberPlanData>) => {
    setLocalPlan(prev => {
      if (!prev) return prev;
      const updated = { ...prev, ...updates };
      // Auto-recalculate pricing when inputs change
      if (updates.pricingInputs || updates.sessionsPerWeek || updates.contractLengthMonths ||
          updates.commitToSaveAddOnActive || updates.manualMonthlyOverride ||
          updates.sessionGuidanceProfiles || updates.weekPlan2 || updates.weekPlan3 || updates.weekPlan4 || updates.phases) {
        const wp = (updates.sessionsPerWeek || updated.sessionsPerWeek) === 4 ? updated.weekPlan4
          : (updates.sessionsPerWeek || updated.sessionsPerWeek) === 3 ? updated.weekPlan3 : updated.weekPlan2;
        if (updated.pricingInputs && updated.pricingInputs.hourlyRate > 0) {
          updated.pricingResult = calculatePricing(
            wp, updated.sessionsPerWeek, updated.contractLengthMonths, updated.phases,
            updated.pricingInputs, updated.sessionGuidanceProfiles || [],
            updated.commitToSaveAddOnActive, updated.manualMonthlyOverride
          );
          // Sync legacy fields
          updated.monthlyPrice = updated.pricingResult.displayMonthlyPrice;
          updated.perSessionPrice = updated.pricingResult.perSessionPrice;
          updated.payInFullPrice = updated.pricingResult.payInFullPrice;
          updated.hourlyRate = updated.pricingInputs.hourlyRate;
        }
      }
      return updated;
    });
    setHasChanges(true);
  }, []);

  async function handleSave() {
    if (!localPlan || !user) return;
    setSaving(true);
    try {
      const planDocId = localPlan.id || `plan_${memberId}`;
      const saveData = { ...localPlan, memberId, coachId: user.uid, updatedAt: serverTimestamp() };
      delete (saveData as any).id;
      if (localPlan.id) {
        await updateDoc(doc(db, 'member_plans', planDocId), saveData);
      } else {
        saveData.createdAt = serverTimestamp();
        await setDoc(doc(db, 'member_plans', planDocId), saveData);
      }
      const savedPlan = { ...localPlan, id: planDocId };
      setLocalPlan(savedPlan);
      onPlanUpdate(savedPlan);
      setHasChanges(false);
      if (Platform.OS === 'web') {
        const toast = document.createElement('div');
        toast.textContent = '✓ Plan saved';
        toast.style.cssText = 'position:fixed;top:20px;right:20px;background:#6EBB7A;color:#fff;padding:10px 20px;border-radius:8px;font-weight:600;z-index:9999;font-family:Space Grotesk,sans-serif;';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
      }
    } catch (err: any) {
      console.error('[PlanViewer] Save error:', err);
      if (Platform.OS === 'web') { alert('Error saving plan: ' + err.message); }
    } finally { setSaving(false); }
  }

  async function handleCreatePlan() {
    if (!user) return;
    const newPlan = createDefaultPlan(memberId, user.uid, memberName);
    setLocalPlan(newPlan);
    setHasChanges(true);
    setViewMode('edit');
  }

  function handleShareLink() {
    const url = `${Platform.OS === 'web' ? window.location.origin : 'https://goarrive.web.app'}/shared-plan/${memberId}`;
    setShareUrl(url);
    if (Platform.OS === 'web') {
      navigator.clipboard?.writeText(url).then(() => {
        setShowShareToast(true);
        setTimeout(() => setShowShareToast(false), 3000);
      });
    }
  }

  if (!localPlan) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <Icon name="document" size={48} color="#2A3347" />
        <Text style={{ color: '#4A5568', fontSize: 16, fontFamily: FONT_HEADING, marginTop: 16, textAlign: 'center' }}>No fitness plan created yet</Text>
        <Text style={{ color: '#4A5568', fontSize: 14, fontFamily: FONT_BODY, marginTop: 8, textAlign: 'center' }}>Create a personalized fitness plan for {memberName}.</Text>
        <TouchableOpacity
          style={{ marginTop: 24, backgroundColor: '#F5A623', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', gap: 8 }}
          onPress={handleCreatePlan}>
          <Icon name="add" size={18} color="#0E1117" />
          <Text style={{ color: '#0E1117', fontWeight: '700', fontSize: 15, fontFamily: FONT_HEADING }}>Build Fitness Plan</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Toolbar: View Toggle + Save */}
      <View style={tb.toolbar}>
        <View style={tb.toggleContainer}>
          <Pressable onPress={() => setViewMode('edit')} style={[tb.toggleBtn, viewMode === 'edit' && tb.toggleBtnActive]}>
            <Icon name="settings" size={14} color={viewMode === 'edit' ? '#F5A623' : '#4A5568'} />
            <Text style={[tb.toggleText, viewMode === 'edit' && tb.toggleTextActive]}>Edit</Text>
          </Pressable>
          <Pressable onPress={() => setViewMode('preview')} style={[tb.toggleBtn, viewMode === 'preview' && tb.toggleBtnActive]}>
            <Icon name="person" size={14} color={viewMode === 'preview' ? '#5B9BD5' : '#4A5568'} />
            <Text style={[tb.toggleText, viewMode === 'preview' && { color: '#5B9BD5' }]}>Member View</Text>
          </Pressable>
        </View>
        <Pressable onPress={handleSave} disabled={saving || !hasChanges}
          style={[tb.saveBtn, (!hasChanges || saving) && { opacity: 0.5 }]}>
          {saving ? <ActivityIndicator size="small" color="#0E1117" /> :
            <Text style={tb.saveBtnText}>{hasChanges ? 'Save' : 'Saved'}</Text>}
        </Pressable>
      </View>

      {/* Share URL toast */}
      {showShareToast && (
        <View style={{ backgroundColor: 'rgba(91,155,213,0.15)', borderWidth: 1, borderColor: 'rgba(91,155,213,0.3)', borderRadius: 10, marginHorizontal: 16, marginTop: 8, padding: 12 }}>
          <Text style={{ fontSize: 12, color: '#5B9BD5', fontWeight: '600', marginBottom: 4 }}>Link copied to clipboard!</Text>
          <Text style={{ fontSize: 11, color: '#8A95A3' }} numberOfLines={1}>{shareUrl}</Text>
        </View>
      )}

      {/* Content */}
      {viewMode === 'edit' ? (
        <PlanEditor plan={localPlan} updatePlan={updatePlan} />
      ) : (
        <PlanPreview plan={localPlan} />
      )}

      {/* Bottom Action Bar */}
      <View style={ba.bar}>
        <Pressable onPress={handleShareLink} style={ba.shareBtn}>
          <Icon name="share" size={15} color="#6EBB7A" />
          <Text style={ba.shareBtnText}>Share with {localPlan.memberName.split(' ')[0]}</Text>
        </Pressable>
        {viewMode === 'edit' && (
          <Pressable onPress={() => setDrawerOpen(true)} style={ba.controlsBtn}>
            <Icon name="settings" size={15} color="#fff" />
            <Text style={ba.controlsBtnText}>Plan Controls</Text>
          </Pressable>
        )}
      </View>

      {/* Plan Controls Drawer */}
      <PlanControlsDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        plan={localPlan}
        updatePlan={updatePlan}
      />
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function MemberPlanScreen() {
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('questionnaire');
  const [loading, setLoading] = useState(true);
  const [memberData, setMemberData] = useState<any>(null);
  const [intakeData, setIntakeData] = useState<any>(null);
  const [planData, setPlanData] = useState<MemberPlanData | null>(null);

  useEffect(() => { if (!memberId) return; loadData(); }, [memberId]);

  async function loadData() {
    setLoading(true);
    try {
      const memberSnap = await getDoc(doc(db, 'members', memberId));
      if (memberSnap.exists()) setMemberData({ id: memberSnap.id, ...memberSnap.data() });
    } catch (e: any) { console.error('[MemberPlan] member profile error:', e.message); }

    try {
      const intakeDocSnap = await getDoc(doc(db, 'intakeSubmissions', memberId));
      if (intakeDocSnap.exists()) {
        const intakeRaw = intakeDocSnap.data();
        setIntakeData(intakeRaw.formData ? { ...intakeRaw, ...intakeRaw.formData } : intakeRaw);
      }
    } catch (e: any) { console.error('[MemberPlan] intake submission error:', e.message); }

    try {
      const planDocSnap = await getDoc(doc(db, 'member_plans', `plan_${memberId}`));
      if (planDocSnap.exists()) {
        setPlanData({ id: planDocSnap.id, ...planDocSnap.data() } as MemberPlanData);
      } else {
        const plansQuery = query(collection(db, 'member_plans'), where('memberId', '==', memberId));
        const plansSnap = await getDocs(plansQuery);
        if (!plansSnap.empty) {
          const planDoc = plansSnap.docs[0];
          setPlanData({ id: planDoc.id, ...planDoc.data() } as MemberPlanData);
        }
      }
    } catch (e: any) { console.error('[MemberPlan] plan load error:', e.message); }
    setLoading(false);
  }

  const memberName = memberData?.displayName || memberData?.name || 'Member';
  const initials = memberName.trim().split(/\s+/).slice(0, 2).map((w: string) => w[0]?.toUpperCase() ?? '').join('');

  if (loading) {
    return (
      <View style={[s.root, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#F5A623" />
        <Text style={{ color: '#4A5568', marginTop: 12, fontFamily: FONT_BODY }}>Loading member data...</Text>
      </View>
    );
  }

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <Icon name="arrow-back" size={22} color="#F0F4F8" />
        </TouchableOpacity>
        <View style={s.avatar}><Text style={s.avatarText}>{initials}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={s.headerName} numberOfLines={1}>{memberName}</Text>
          <Text style={s.headerSub} numberOfLines={1}>{memberData?.email || ''}</Text>
        </View>
      </View>

      {/* Tab Bar */}
      <View style={s.tabBar}>
        <Pressable style={[s.tab, activeTab === 'questionnaire' && s.tabActive]} onPress={() => setActiveTab('questionnaire')}>
          <Icon name="document" size={16} color={activeTab === 'questionnaire' ? '#F5A623' : '#4A5568'} />
          <Text style={[s.tabText, activeTab === 'questionnaire' && s.tabTextActive]}>Questionnaire</Text>
        </Pressable>
        <Pressable style={[s.tab, activeTab === 'plan' && s.tabActive]} onPress={() => setActiveTab('plan')}>
          <Icon name="fitness" size={16} color={activeTab === 'plan' ? '#F5A623' : '#4A5568'} />
          <Text style={[s.tabText, activeTab === 'plan' && s.tabTextActive]}>Fitness Plan {planData ? '✓' : ''}</Text>
        </Pressable>
      </View>

      {/* Content */}
      {activeTab === 'questionnaire' ? (
        <QuestionnaireViewer intake={intakeData} />
      ) : (
        <PlanViewer plan={planData} memberName={memberName} memberId={memberId} onPlanUpdate={(updated) => setPlanData(updated)} />
      )}
    </View>
  );
}

// ─── Bottom Action Bar Styles ──────────────────────────────────────────────
const ba = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: Platform.OS === 'ios' ? 30 : 12,
    backgroundColor: '#0E1117',
    borderTopWidth: 1,
    borderTopColor: '#1E2A3A',
  },
  shareBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 24,
    backgroundColor: '#1E2535',
    borderWidth: 1,
    borderColor: 'rgba(110,187,122,0.3)',
  },
  shareBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6EBB7A',
    fontFamily: FONT_HEADING,
  },
  controlsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderRadius: 24,
    backgroundColor: '#5B9BD5',
  },
  controlsBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    fontFamily: FONT_HEADING,
  },
});

// ─── Toolbar Styles ─────────────────────────────────────────────────────────
const tb = StyleSheet.create({
  toolbar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1E2A3A', backgroundColor: '#0E1117',
  },
  toggleContainer: {
    flexDirection: 'row', borderRadius: 10, borderWidth: 1, borderColor: '#2A3347', backgroundColor: '#161B25', overflow: 'hidden',
  },
  toggleBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 8 },
  toggleBtnActive: { backgroundColor: 'rgba(245,166,35,0.1)' },
  toggleText: { fontSize: 13, fontWeight: '600', color: '#4A5568', fontFamily: FONT_HEADING },
  toggleTextActive: { color: '#F5A623' },
  saveBtn: { backgroundColor: '#F5A623', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8, minWidth: 60, alignItems: 'center' },
  saveBtnText: { color: '#0E1117', fontWeight: '700', fontSize: 13, fontFamily: FONT_HEADING },
});

// ─── Preview Styles ─────────────────────────────────────────────────────────
const pv = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 16, borderWidth: 1, alignSelf: 'flex-start' },
  darkCard: { backgroundColor: '#161B25', borderWidth: 1, borderColor: '#2A3347', borderRadius: 12, padding: 14 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#5B9BD5', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8, fontFamily: FONT_HEADING },
  miniLabel: { fontSize: 10, fontWeight: '600', color: '#8A95A3', letterSpacing: 0.8, textTransform: 'uppercase' },
});

// ─── Edit Styles ────────────────────────────────────────────────────────────
const es = StyleSheet.create({
  sectionCard: { backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 14, borderWidth: 1, marginBottom: 12, overflow: 'hidden' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  sectionTitle: { fontSize: 14, fontWeight: '700', fontFamily: FONT_HEADING, letterSpacing: 0.3 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: '#8A95A3', fontFamily: FONT_HEADING, letterSpacing: 0.3, marginBottom: 4 },
  fieldHint: { fontSize: 11, color: '#4A5568', fontFamily: FONT_BODY, marginBottom: 6 },
  input: { backgroundColor: '#161B25', borderWidth: 1, borderColor: '#2A3347', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: '#F0F4F8', fontSize: 14, fontFamily: FONT_BODY },
});

// ─── Main Styles ────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0E1117' },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
    paddingTop: Platform.select({ ios: 56, android: 40, web: 20, default: 20 }),
    paddingBottom: 14, gap: 12, borderBottomWidth: 1, borderBottomColor: '#1E2A3A', backgroundColor: '#0E1117',
  },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(245,166,35,0.15)', borderWidth: 1.5, borderColor: '#F5A623', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '700', color: '#F5A623', fontFamily: FONT_HEADING },
  headerName: { fontSize: 17, fontWeight: '700', color: '#F0F4F8', fontFamily: FONT_HEADING },
  headerSub: { fontSize: 13, color: '#4A5568', fontFamily: FONT_BODY, marginTop: 1 },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1E2A3A', backgroundColor: '#0E1117' },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 13, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#F5A623' },
  tabText: { fontSize: 14, fontWeight: '600', color: '#4A5568', fontFamily: FONT_BODY },
  tabTextActive: { color: '#F5A623' },
});

// ─── Questionnaire Styles ────────────────────────────────────────────────────
const q = StyleSheet.create({
  section: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 14, borderWidth: 1, borderColor: '#1E2A3A', padding: 16, marginBottom: 12 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#F5A623', fontFamily: FONT_HEADING, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)', gap: 12 },
  rowLabel: { fontSize: 13, color: '#4A5568', fontFamily: FONT_BODY, flex: 1 },
  rowValue: { fontSize: 13, color: '#C0C8D4', fontFamily: FONT_BODY, flex: 2, textAlign: 'right' },
});
