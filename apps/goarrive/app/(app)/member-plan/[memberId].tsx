/**
 * Coach Member Plan — Forge-style seamless editing
 *
 * The coach sees the same beautiful plan as the member, with subtle edit
 * affordances layered on top: pencil icons, tappable day tiles with dropdown
 * session-type picker, sliders for readiness/motivation/sessions, and a
 * Plan Controls drawer for pricing settings.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, StyleSheet,
  Platform, Modal, Animated, Dimensions, Image, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../../lib/AuthContext';
import { Icon } from '../../../components/Icon';
import {
  MemberPlanData, DayPlan, SessionType, Phase,
  SessionTypeGuidance, GuidanceLevel, PricingResult,
  calculatePricing, formatCurrency, monthsToWeeks,
  createDefaultPlan, createDefaultSchedule, createDefaultPhases,
  countSessionsByType, getGuidanceProfile,
  typeColors, phaseColors, resolvePhaseColor, goalConfig, availableGoals,
  dayTypeOptions, guidanceLevels, SESSION_TYPES,
  GUIDANCE_FACTORS, GUIDANCE_SHORT,
  SessionsPerWeek, ContractLength,
} from '../../../lib/planTypes';

const { width: SCREEN_W } = Dimensions.get('window');
const ACCENT = '#6EBB7A';
const PRIMARY = '#5B9BD5';
const SECONDARY = '#F5A623';
const BG = '#0E1117';
const CARD = '#151B28';
const BORDER = '#1E2A3A';
const MUTED = '#8899AA';
const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

// ═══════════════════════════════════════════════════════════════════════════════
// REUSABLE COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── EditModal (bottom sheet for text editing) ───────────────────────────────
function EditModal({ visible, onClose, title, value, onSave, multiline = false }: {
  visible: boolean; onClose: () => void; title: string;
  value: string; onSave: (v: string) => void; multiline?: boolean;
}) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  if (!visible) return null;
  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <Pressable style={em.overlay} onPress={onClose}>
        <Pressable style={em.sheet} onPress={e => e.stopPropagation()}>
          <View style={em.header}>
            <Text style={em.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={8}><Icon name="x" size={20} color={MUTED} /></Pressable>
          </View>
          <TextInput
            style={[em.input, multiline && em.inputMulti]}
            value={text} onChangeText={setText} multiline={multiline}
            numberOfLines={multiline ? 4 : 1} placeholderTextColor="#4A5568" autoFocus
          />
          <View style={em.buttons}>
            <Pressable style={em.btnCancel} onPress={onClose}>
              <Text style={em.btnCancelText}>Cancel</Text>
            </Pressable>
            <Pressable style={em.btnSave} onPress={() => { onSave(text); onClose(); }}>
              <Text style={em.btnSaveText}>Save</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
const em = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: CARD, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 17, fontWeight: '700', color: '#FFF', fontFamily: FH },
  input: { backgroundColor: BG, borderWidth: 1, borderColor: BORDER, borderRadius: 10, padding: 14, fontSize: 15, color: '#FFF', marginBottom: 16 },
  inputMulti: { minHeight: 100, textAlignVertical: 'top' },
  buttons: { flexDirection: 'row', gap: 12 },
  btnCancel: { flex: 1, paddingVertical: 14, borderRadius: 10, borderWidth: 1, borderColor: BORDER, alignItems: 'center' },
  btnCancelText: { color: MUTED, fontSize: 15, fontWeight: '600' },
  btnSave: { flex: 1, paddingVertical: 14, borderRadius: 10, backgroundColor: ACCENT, alignItems: 'center' },
  btnSaveText: { color: '#000', fontSize: 15, fontWeight: '700' },
});

// ─── PencilButton ────────────────────────────────────────────────────────────
function PencilBtn({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} style={{ padding: 4, marginLeft: 6 }}>
      <Text style={{ fontSize: 14, color: MUTED }}>✏️</Text>
    </Pressable>
  );
}

// ─── MeterBar (read-only segmented bar) ──────────────────────────────────────
function MeterBar({ value, max = 10, label, color = ACCENT }: {
  value: number; max?: number; label: string; color?: string;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ color: MUTED, fontSize: 14 }}>{label}</Text>
        <Text style={{ color, fontSize: 14, fontWeight: '700' }}>{value}/{max}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {Array.from({ length: max }, (_, i) => (
          <View key={i} style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: i < value ? color : 'rgba(255,255,255,0.08)' }} />
        ))}
      </View>
    </View>
  );
}

// ─── Slider (web range input) ────────────────────────────────────────────────
function RangeSlider({ value, min, max, onChange, color = ACCENT }: {
  value: number; min: number; max: number; onChange: (v: number) => void; color?: string;
}) {
  if (Platform.OS === 'web') {
    return (
      <input
        type="range" min={min} max={max} value={value}
        onChange={(e: any) => onChange(parseInt(e.target.value))}
        style={{ width: '100%', accentColor: color } as any}
      />
    );
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Pressable onPress={() => onChange(Math.max(min, value - 1))} style={ss.stepBtn}>
        <Text style={ss.stepText}>−</Text>
      </Pressable>
      <Text style={{ color: '#FFF', fontSize: 18, fontWeight: '700', minWidth: 30, textAlign: 'center' }}>{value}</Text>
      <Pressable onPress={() => onChange(Math.min(max, value + 1))} style={ss.stepBtn}>
        <Text style={ss.stepText}>+</Text>
      </Pressable>
    </View>
  );
}
const ss = StyleSheet.create({
  stepBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1A2035', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER },
  stepText: { color: '#FFF', fontSize: 18, fontWeight: '600' },
});

// ─── DayTile (tappable with dropdown session type picker) ────────────────────
function DayTile({ day, isCoach, onTypeChange, onOpen, isOpen }: {
  day: DayPlan; isCoach: boolean; onTypeChange: (t: SessionType) => void;
  onOpen?: () => void; isOpen?: boolean;
}) {
  const tc = typeColors[day.type] || typeColors['Rest'];
  const isSession = day.isSession && day.type !== 'Rest';
  const abbr = day.type === 'Strength' ? 'STR' : day.type === 'Cardio + Mobility' ? 'CARD' : day.type === 'Mix' ? 'MIX' : 'OFF';

  return (
    <View style={{ width: (SCREEN_W - 88) / 7, alignItems: 'center', zIndex: isOpen ? 9999 : 1, elevation: isOpen ? 20 : 1 }}>
      <Pressable
        onPress={() => { if (isCoach) { onOpen?.(); } }}
        style={[dt.tile, { backgroundColor: isSession ? tc.bg : 'rgba(42,51,71,0.2)', borderColor: isOpen ? tc.text : (isSession ? tc.border : 'transparent'), borderWidth: 1 }]}
      >
        <Text style={{ fontSize: 9, fontWeight: '600', color: MUTED, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.3 }}>{day.shortDay}</Text>
        <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: isSession ? tc.dot : '#2A3040', marginBottom: 5 }} />
        <Text style={{ fontSize: 8, fontWeight: '700', color: isSession ? tc.text : '#4A5568', letterSpacing: 0.2 }} numberOfLines={1}>{abbr}</Text>
      </Pressable>
      {isOpen && isCoach && (
        <View style={dt.dropdown}>
          {SESSION_TYPES.map(type => {
            const selected = type === day.type;
            const tcc = typeColors[type] || typeColors['Rest'];
            return (
              <Pressable key={type} onPress={() => { onTypeChange(type); onOpen?.(); }}
                style={[dt.dropItem, selected && { backgroundColor: 'rgba(110,187,122,0.15)' }]}>
                <Text style={{ fontSize: 14, fontWeight: '500', color: selected ? ACCENT : tcc.text }}>{type}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}
const dt = StyleSheet.create({
  tile: { width: '100%', paddingVertical: 8, paddingHorizontal: 2, borderRadius: 10, alignItems: 'center' },
  dropdown: {
    position: 'absolute', top: 72, left: -10, zIndex: 200,
    backgroundColor: '#1A2035', borderRadius: 10, borderWidth: 1, borderColor: BORDER,
    paddingVertical: 4, minWidth: 170,
    ...(Platform.OS === 'web' ? { boxShadow: '0 8px 24px rgba(0,0,0,0.5)' } as any : { elevation: 10 }),
  },
  dropItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14 },
});

// ─── PhaseInput ──────────────────────────────────────────────────────────────
function PhaseInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <TextInput
        style={{ backgroundColor: BG, borderWidth: 1, borderColor: BORDER, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, color: '#FFF', fontSize: 14, fontWeight: '700', width: 54, textAlign: 'center' }}
        value={String(value)} onChangeText={t => { const n = parseInt(t); if (!isNaN(n) && n >= 0) onChange(n); }}
        keyboardType="number-pad" selectTextOnFocus
      />
      <Text style={{ color: MUTED, fontSize: 12 }}>weeks</Text>
    </View>
  );
}

// ─── NumericField (for Plan Controls) ────────────────────────────────────────
function NumericField({ label, value, onChange, prefix, suffix, icon }: {
  label: string; value: number; onChange: (v: number) => void;
  prefix?: string; suffix?: string; icon?: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 8 }}>
        {icon && <Text style={{ fontSize: 14 }}>{icon}</Text>}
        <Text style={{ color: MUTED, fontSize: 14 }}>{label}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {prefix && <Text style={{ color: MUTED, fontSize: 13 }}>{prefix}</Text>}
        <TextInput
          style={{ backgroundColor: BG, borderWidth: 1, borderColor: BORDER, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, color: '#FFF', fontSize: 14, fontWeight: '700', width: 64, textAlign: 'center' }}
          value={String(value)} onChangeText={t => { const n = parseInt(t); if (!isNaN(n) && n >= 0) onChange(n); }}
          keyboardType="number-pad" selectTextOnFocus
        />
        {suffix && <Text style={{ color: MUTED, fontSize: 13 }}>{suffix}</Text>}
      </View>
    </View>
  );
}

// ─── ButtonGroup ─────────────────────────────────────────────────────────────
function ButtonGroup<T extends string | number>({ options, value, onChange }: {
  options: T[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {options.map(opt => {
        const sel = opt === value;
        return (
          <Pressable key={String(opt)} onPress={() => onChange(opt)}
            style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
              backgroundColor: sel ? ACCENT : '#1A2035', borderWidth: 1, borderColor: sel ? ACCENT : BORDER }}>
            <Text style={{ color: sel ? '#000' : MUTED, fontSize: 14, fontWeight: sel ? '700' : '600' }}>{String(opt)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── GuidanceDropdown ────────────────────────────────────────────────────────
function GuidanceDropdown({ value, onChange, isOpen, onOpen }: {
  value: GuidanceLevel; onChange: (v: GuidanceLevel) => void;
  isOpen?: boolean; onOpen?: () => void;
}) {
  return (
    <View style={{ position: 'relative', zIndex: isOpen ? 9999 : 1, elevation: isOpen ? 20 : 1 }}>
      <Pressable onPress={() => onOpen?.()}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: BG, borderWidth: 1, borderColor: isOpen ? ACCENT : BORDER, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 }}>
        <Text style={{ color: isOpen ? ACCENT : '#FFF', fontSize: 12, fontWeight: '600' }}>{GUIDANCE_SHORT[value]}</Text>
        <Icon name="chevron-down" size={12} color={isOpen ? ACCENT : MUTED} />
      </Pressable>
      {isOpen && (
        <View style={{
          position: 'absolute', top: 36, left: 0, zIndex: 9999,
          backgroundColor: '#1A2035', borderRadius: 8, borderWidth: 1, borderColor: BORDER,
          minWidth: 90, paddingVertical: 2,
          ...(Platform.OS === 'web' ? { boxShadow: '0 4px 16px rgba(0,0,0,0.5)' } as any : { elevation: 20 }),
        }}>
          {guidanceLevels.map(level => (
            <Pressable key={level} onPress={() => { onChange(level); onOpen?.(); }}
              style={[{ paddingVertical: 8, paddingHorizontal: 12 }, level === value && { backgroundColor: 'rgba(110,187,122,0.15)' }]}>
              <Text style={{ color: level === value ? ACCENT : '#FFF', fontSize: 12, fontWeight: '500' }}>{GUIDANCE_SHORT[level]}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// PLAN VIEW — Unified view for both coach and member
// Coach mode adds pencil icons, tappable day tiles, sliders, etc.
// ═══════════════════════════════════════════════════════════════════════════════

function PlanView({ plan, isCoach, onChange }: {
  plan: MemberPlanData; isCoach: boolean;
  onChange: (updates: Partial<MemberPlanData>) => void;
}) {
  const [editField, setEditField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [openDayIndex, setOpenDayIndex] = useState<number | null>(null);

  // Pricing calculation
  const pricing = useMemo(() => {
    try {
      return calculatePricing(plan);
    } catch (err) {
      console.error('PlanView pricing error:', err);
      return null;
    }
  }, [plan]);

  // Helper to open edit modal
  const openEdit = (field: string, val: string) => { setEditField(field); setEditValue(val); };

  // Handle edit save
  const handleEditSave = (val: string) => {
    if (!editField) return;
    const updates: any = {};
    switch (editField) {
      case 'memberName': updates.memberName = val; break;
      case 'memberAge': updates.memberAge = parseInt(val) || 0; break;
      case 'identityTag': updates.identityTag = val; break;
      case 'planSubtitle': updates.planSubtitle = val; break;
      case 'referredBy': updates.referredBy = val; break;
      case 'whyStatement': updates.whyStatement = val; break;
      case 'whyTranslation': updates.whyTranslation = val; break;
      case 'goalSummary': updates.goalSummary = val; break;
      case 'currentWeight': updates.currentWeight = val; break;
      case 'goalWeight': updates.goalWeight = val; break;
      case 'startingPointIntro': updates.startingPointIntro = val; break;
    }
    onChange(updates);
    setEditField(null);
  };

  // Handle schedule day type change
  const handleDayTypeChange = (dayIndex: number, newType: SessionType) => {
    const newSchedule = [...plan.weeklySchedule];
    const isSession = newType !== 'Rest';
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    newSchedule[dayIndex] = {
      ...newSchedule[dayIndex],
      type: newType,
      isSession,
      label: isSession ? newType : 'Rest',
      shortDay: dayNames[dayIndex] || newSchedule[dayIndex].shortDay,
      duration: isSession ? (plan.sessionLengthMinutes || 30) : 0,
      breakdown: [],
    };
    const newSessionCount = newSchedule.filter(d => d.isSession && d.type !== 'Rest').length as SessionsPerWeek;
    onChange({ weeklySchedule: newSchedule, sessionsPerWeek: newSessionCount });
  };

  // Handle sessions per week slider change
  const handleSessionsChange = (count: number) => {
    const clamped = Math.max(2, Math.min(6, count)) as SessionsPerWeek;
    const newSchedule = createDefaultSchedule(clamped);
    onChange({ sessionsPerWeek: clamped, weeklySchedule: newSchedule });
  };

  // Handle phase duration change
  const handlePhaseDurationChange = (index: number, weeks: number) => {
    const newPhases = [...plan.phases];
    newPhases[index] = { ...newPhases[index], weeks };
    // Auto-calculate last phase
    const totalWeeks = monthsToWeeks(plan.contractMonths);
    if (newPhases.length >= 3) {
      const used = newPhases.slice(0, -1).reduce((s, p) => s + p.weeks, 0);
      newPhases[newPhases.length - 1] = { ...newPhases[newPhases.length - 1], weeks: Math.max(0, totalWeeks - used) };
    }
    onChange({ phases: newPhases });
  };

  // Handle phase description edit
  const handlePhaseDescSave = (index: number, desc: string) => {
    const newPhases = [...plan.phases];
    newPhases[index] = { ...newPhases[index], description: desc };
    onChange({ phases: newPhases });
  };

  // Handle goal toggle
  const handleGoalToggle = (goal: string) => {
    const goals = plan.goals || [];
    const newGoals = goals.includes(goal) ? goals.filter(g => g !== goal) : [...goals, goal];
    onChange({ goals: newGoals });
  };

  // Handle starting point changes
  const handleStartingPointRemove = (index: number) => {
    const newPoints = [...(plan.startingPoints || [])];
    newPoints.splice(index, 1);
    onChange({ startingPoints: newPoints });
  };
  const handleStartingPointAdd = (text: string) => {
    onChange({ startingPoints: [...(plan.startingPoints || []), text] });
  };

  // Total weeks from phases
  const totalWeeks = (plan.phases || []).reduce((s, p) => s + (p?.weeks || 0), 0);
  const totalWeeksTarget = monthsToWeeks(plan.contractMonths || 12);

  // ─── RENDER ────────────────────────────────────────────────────────────────

  return (
    <View>
      {/* ─── HEADER SECTION ──────────────────────────────────────────────── */}
      <View style={pv.section}>
        <Text style={pv.builtWith}>BUILT WITH GOARRIVE</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={pv.heroName}>
            <Text style={{ color: ACCENT }}>{plan.memberName || 'Member'}</Text>'s
          </Text>
          {isCoach && <PencilBtn onPress={() => openEdit('memberName', plan.memberName || '')} />}
        </View>
        <Text style={pv.heroTitle}>Tailored Plan</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 4 }}>
          <Text style={pv.heroMeta}>
            {plan.memberAge ? `${plan.memberAge} years old` : ''}
            {plan.memberAge && plan.identityTag ? ' · ' : ''}
            {plan.identityTag || ''}
          </Text>
          {isCoach && <PencilBtn onPress={() => openEdit('identityTag', plan.identityTag || '')} />}
        </View>
        {plan.referredBy ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 6 }}>
            <View style={{ backgroundColor: 'rgba(245,166,35,0.15)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 }}>
              <Text style={{ color: SECONDARY, fontSize: 12, fontWeight: '600' }}>Referred by {plan.referredBy}</Text>
            </View>
          </View>
        ) : null}
        {plan.planSubtitle ? (
          <View style={[pv.card, { marginTop: 16 }]}>
            <Text style={pv.bodyText}>{plan.planSubtitle}</Text>
            {isCoach && <PencilBtn onPress={() => openEdit('planSubtitle', plan.planSubtitle || '')} />}
          </View>
        ) : isCoach ? (
          <Pressable onPress={() => openEdit('planSubtitle', '')} style={[pv.card, { marginTop: 16, borderStyle: 'dashed' }]}>
            <Text style={{ color: '#4A5568', fontSize: 14, fontStyle: 'italic' }}>+ Add plan subtitle...</Text>
          </Pressable>
        ) : null}
      </View>

      {/* ─── WHERE YOU'RE STARTING FROM ──────────────────────────────────── */}
      <View style={pv.section}>
        <Text style={pv.sectionLabel}>WHERE YOU'RE STARTING FROM</Text>
        <View style={pv.card}>
          {plan.startingPointIntro ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 }}>
              <Text style={[pv.bodyText, { flex: 1, fontStyle: 'italic' }]}>{plan.startingPointIntro}</Text>
              {isCoach && <PencilBtn onPress={() => openEdit('startingPointIntro', plan.startingPointIntro || '')} />}
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(plan.startingPoints || []).map((point, i) => (
              <View key={i} style={pv.tag}>
                <Text style={pv.tagText}>{point}</Text>
                {isCoach && (
                  <Pressable onPress={() => handleStartingPointRemove(i)} hitSlop={6} style={{ marginLeft: 6 }}>
                    <Text style={{ color: MUTED, fontSize: 12 }}>×</Text>
                  </Pressable>
                )}
              </View>
            ))}
            {isCoach && <AddTagButton onAdd={handleStartingPointAdd} />}
          </View>
        </View>
      </View>

      {/* ─── YOUR HEALTH GOALS ───────────────────────────────────────────── */}
      <View style={pv.section}>
        <Text style={pv.sectionLabel}>YOUR HEALTH GOALS</Text>
        <Text style={pv.sectionTitle}>What we're building toward</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
          {(isCoach ? availableGoals : (plan.goals || [])).map(goal => {
            const cfg = goalConfig[goal] || { emoji: '🎯', color: ACCENT };
            const isSelected = (plan.goals || []).includes(goal);
            if (!isCoach && !isSelected) return null;
            return (
              <Pressable key={goal} onPress={() => isCoach && handleGoalToggle(goal)}
                style={[pv.goalCard, {
                  backgroundColor: isSelected ? cfg.color + '15' : '#161B25',
                  borderColor: isSelected ? cfg.color + '40' : BORDER,
                  opacity: isCoach && !isSelected ? 0.5 : 1,
                }]}>
                <Text style={{ fontSize: 24, marginBottom: 4 }}>{cfg.emoji}</Text>
                <Text style={{ color: isSelected ? cfg.color : MUTED, fontSize: 13, fontWeight: '600', textAlign: 'center' }}>{goal}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Weight row */}
        {(plan.currentWeight || plan.goalWeight) ? (
          <View style={[pv.card, { marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
            <View>
              <Text style={{ color: MUTED, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>CURRENT</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ color: '#FFF', fontSize: 22, fontWeight: '700', fontFamily: FH }}>{plan.currentWeight || '—'}</Text>
                {isCoach && <PencilBtn onPress={() => openEdit('currentWeight', plan.currentWeight || '')} />}
              </View>
            </View>
            <Text style={{ color: MUTED, fontSize: 20 }}>→</Text>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: MUTED, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>GOAL</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ color: ACCENT, fontSize: 22, fontWeight: '700', fontFamily: FH }}>{plan.goalWeight || '—'}</Text>
                {isCoach && <PencilBtn onPress={() => openEdit('goalWeight', plan.goalWeight || '')} />}
              </View>
            </View>
          </View>
        ) : isCoach ? (
          <Pressable onPress={() => openEdit('currentWeight', '')} style={[pv.card, { marginTop: 16, borderStyle: 'dashed' }]}>
            <Text style={{ color: '#4A5568', fontSize: 14, fontStyle: 'italic' }}>+ Add weight goal...</Text>
          </Pressable>
        ) : null}

        {/* Goal summary */}
        {plan.goalSummary ? (
          <View style={[pv.card, { marginTop: 12 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
              <Text style={{ fontSize: 16, marginRight: 8 }}>🎯</Text>
              <Text style={[pv.bodyText, { flex: 1 }]}>{plan.goalSummary}</Text>
              {isCoach && <PencilBtn onPress={() => openEdit('goalSummary', plan.goalSummary || '')} />}
            </View>
          </View>
        ) : null}
      </View>

      {/* ─── YOUR GUIDANCE ────────────────────────────────────────────────── */}
      <View style={pv.section}>
        <Text style={pv.sectionLabel}>YOUR GUIDANCE</Text>
        <View style={pv.card}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Text style={pv.whyLabel}>IN {(plan.memberName || 'MEMBER').toUpperCase()}'S WORDS</Text>
              <Text style={pv.whyQuote}>"{plan.whyStatement || 'Why I want to change...'}"</Text>
            </View>
            {isCoach && <PencilBtn onPress={() => openEdit('whyStatement', plan.whyStatement || '')} />}
          </View>
        </View>
        {plan.whyTranslation ? (
          <View style={[pv.card, { marginTop: 10 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
              <Text style={[pv.bodyText, { flex: 1, fontStyle: 'italic' }]}>{plan.whyTranslation}</Text>
              {isCoach && <PencilBtn onPress={() => openEdit('whyTranslation', plan.whyTranslation || '')} />}
            </View>
          </View>
        ) : null}

        {/* Readiness meters */}
        <View style={[pv.card, { marginTop: 10 }]}>
          {isCoach ? (
            <>
              <EditableMeter label="Readiness for Change" value={plan.readiness || 7} max={10} color={ACCENT}
                onChange={v => onChange({ readiness: v })} />
              <EditableMeter label="Motivation" value={plan.motivation || 7} max={10} color={PRIMARY}
                onChange={v => onChange({ motivation: v })} />
              <EditableMeter label="Gym Confidence" value={plan.gymConfidence || 5} max={10} color={SECONDARY}
                onChange={v => onChange({ gymConfidence: v })} />
            </>
          ) : (
            <>
              <MeterBar label="Readiness for Change" value={plan.readiness || 7} color={ACCENT} />
              <MeterBar label="Motivation" value={plan.motivation || 7} color={PRIMARY} />
              <MeterBar label="Gym Confidence" value={plan.gymConfidence || 5} color={SECONDARY} />
            </>
          )}
        </View>
      </View>

      {/* ─── YOUR WEEKLY PLAN ────────────────────────────────────────────── */}
      <View style={pv.section}>
        <Text style={pv.sectionLabel}>YOUR WEEKLY PLAN</Text>
        <View style={pv.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ color: ACCENT, fontSize: 18, fontWeight: '700', fontFamily: FH }}>{plan.sessionsPerWeek} Sessions</Text>
            <Text style={{ color: MUTED, fontSize: 14, marginLeft: 6 }}>per week · {plan.contractMonths} months</Text>
          </View>

          {/* Sessions per week slider (coach only) */}
          {isCoach && (
            <View style={{ marginBottom: 16, padding: 12, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 10 }}>
              <Text style={{ color: MUTED, fontSize: 12, marginBottom: 8 }}>Sessions per week</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <RangeSlider value={plan.sessionsPerWeek} min={2} max={6} onChange={handleSessionsChange} />
                </View>
                <Text style={{ color: '#FFF', fontSize: 20, fontWeight: '700', minWidth: 30, textAlign: 'center' }}>{plan.sessionsPerWeek}</Text>
              </View>
            </View>
          )}

          {isCoach && (
            <Text style={{ color: '#4A5568', fontSize: 11, marginBottom: 10, fontStyle: 'italic' }}>
              Tap any active day to change its session type
            </Text>
          )}

          {/* Day tiles */}
          <View style={{ flexDirection: 'row', gap: 4, justifyContent: 'space-between', zIndex: openDayIndex !== null ? 9999 : 1 }}>
            {(plan.weeklySchedule || []).map((day, i) => (
              <DayTile key={day.shortDay || i} day={day} isCoach={isCoach}
                onTypeChange={(type) => { handleDayTypeChange(i, type); setOpenDayIndex(null); }}
                isOpen={openDayIndex === i}
                onOpen={() => setOpenDayIndex(openDayIndex === i ? null : i)}
              />
            ))}
          </View>
        </View>
      </View>

      {/* ─── HOW YOUR COACHING SUPPORT EVOLVES ───────────────────────────── */}
      <View style={pv.section}>
        <Text style={[pv.sectionLabel, { color: resolvePhaseColor(plan.phases[0]?.intensity ?? '').text }]}>HOW YOUR COACHING SUPPORT EVOLVES</Text>
        <View style={pv.card}>
          {/* Phase progress bar */}
          <View style={{ flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', marginBottom: 4 }}>
            {(plan.phases || []).map((phase, i) => {
              const pct = totalWeeksTarget > 0 ? (phase.weeks / totalWeeksTarget) * 100 : 0;
              const pc = resolvePhaseColor(phase.intensity ?? '');
              return <View key={i} style={{ width: `${pct}%` as any, backgroundColor: pc.bar, height: 12 }} />;
            })}
          </View>
          <View style={{ flexDirection: 'row', marginBottom: 8 }}>
            {(plan.phases || []).map((phase, i) => {
              const pct = totalWeeksTarget > 0 ? (phase.weeks / totalWeeksTarget) * 100 : 0;
              return (
                <View key={i} style={{ width: `${pct}%` as any, alignItems: 'center' }}>
                  <Text style={{ color: MUTED, fontSize: 10 }}>{phase.weeks}w</Text>
                </View>
              );
            })}
          </View>
          <Text style={{ color: MUTED, fontSize: 12, textAlign: 'center', marginBottom: 16 }}>
            Total: {totalWeeks} weeks ({plan.contractMonths} months)
          </Text>

          {/* Phase cards */}
          {(plan.phases || []).map((phase, i) => {
            const pc = resolvePhaseColor(phase.intensity ?? '');
            const isLast = i === (plan.phases || []).length - 1;
            return (
              <View key={i} style={[pv.phaseCard, { borderColor: pc.border, backgroundColor: pc.bg }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={{ color: pc.text, fontWeight: '700', fontSize: 15, fontFamily: FH }}>
                    {phase.name}: {phase.intensity}
                  </Text>
                  {isCoach && !isLast && (
                    <PhaseInput value={phase.weeks} onChange={w => handlePhaseDurationChange(i, w)} />
                  )}
                  {isCoach && isLast && (
                    <Text style={{ color: MUTED, fontSize: 12 }}>{phase.weeks} weeks (auto)</Text>
                  )}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <Text style={{ color: MUTED, fontSize: 13, flex: 1, lineHeight: 19 }}>{phase.description}</Text>
                  {isCoach && <PencilBtn onPress={() => openEdit(`phase_${i}`, phase.description)} />}
                </View>
              </View>
            );
          })}

          {/* Coach-only pricing explanation */}
          {isCoach && (
            <View style={{ marginTop: 12, padding: 10, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
              <Text style={{ color: '#4A5568', fontSize: 11, fontStyle: 'italic', lineHeight: 16 }}>
                Pricing assumes Phase 1 sessions are fully guided, Phase 2 sessions are a blend of full and partial guidance (average 62.5% coach time), and Phase 3 is driven by monthly check-in calls.
              </Text>
            </View>
          )}

          <Text style={{ color: MUTED, fontSize: 13, textAlign: 'center', fontStyle: 'italic', marginTop: 14, lineHeight: 19 }}>
            We'll start fully guided and gradually build you toward self-reliance with the same tailored coaching behind you.
          </Text>
        </View>
      </View>

      {/* ─── WHAT'S INCLUDED ─────────────────────────────────────────────── */}
      {(plan.whatsIncluded && plan.whatsIncluded.length > 0) || isCoach ? (
        <View style={pv.section}>
          <Text style={pv.sectionLabel}>WHAT'S INCLUDED</Text>
          <View style={pv.card}>
            {(plan.whatsIncluded || []).map((item, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 10 }}>
                <Text style={{ color: ACCENT, fontSize: 14 }}>✓</Text>
                <Text style={{ color: '#C5CDD8', fontSize: 14, flex: 1 }}>{item}</Text>
                {isCoach && (
                  <Pressable onPress={() => {
                    const newItems = [...(plan.whatsIncluded || [])];
                    newItems.splice(i, 1);
                    onChange({ whatsIncluded: newItems });
                  }} hitSlop={6}>
                    <Text style={{ color: MUTED, fontSize: 12 }}>×</Text>
                  </Pressable>
                )}
              </View>
            ))}
            {isCoach && <AddItemButton onAdd={(text) => onChange({ whatsIncluded: [...(plan.whatsIncluded || []), text] })} placeholder="Add included item..." />}
          </View>
        </View>
      ) : null}

      {/* ─── COMMIT TO SAVE ──────────────────────────────────────────────── */}
      {(plan.commitToSave?.enabled) ? (
        <View style={pv.section}>
          <Text style={pv.sectionLabel}>COMMIT TO SAVE</Text>
          <CommitToSaveView plan={plan} isCoach={isCoach} />
        </View>
      ) : null}

      {/* ─── NUTRITION ───────────────────────────────────────────────────── */}
      {(plan.nutrition?.enabled) ? (
        <View style={pv.section}>
          <Text style={pv.sectionLabel}>NUTRITION COACHING</Text>
          <View style={pv.card}>
            <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '600', marginBottom: 6, fontFamily: FH }}>
              {plan.nutrition.type === 'in-house' ? 'In-House Nutrition Coaching' : `Nutrition by ${plan.nutrition.providerName || 'Partner'}`}
            </Text>
            <Text style={{ color: MUTED, fontSize: 13, lineHeight: 19 }}>{plan.nutrition.description}</Text>
            {plan.nutrition.monthlyCost > 0 && (
              <Text style={{ color: ACCENT, fontSize: 14, fontWeight: '600', marginTop: 8 }}>
                +{formatCurrency(plan.nutrition.monthlyCost)}/mo
              </Text>
            )}
          </View>
        </View>
      ) : null}

      {/* ─── YOUR INVESTMENT ─────────────────────────────────────────────── */}
      {(plan.showInvestment !== false || isCoach) && (
        <View style={pv.section}>
          <Text style={pv.sectionLabel}>YOUR INVESTMENT</Text>
          {pricing && <InvestmentView plan={plan} pricing={pricing} isCoach={isCoach} />}
        </View>
      )}

      {/* Edit Modal */}
      <EditModal
        visible={editField !== null}
        onClose={() => setEditField(null)}
        title={getEditTitle(editField)}
        value={editValue}
        onSave={(val) => {
          if (editField?.startsWith('phase_')) {
            const idx = parseInt(editField.split('_')[1]);
            handlePhaseDescSave(idx, val);
          } else {
            handleEditSave(val);
          }
        }}
        multiline={editField === 'planSubtitle' || editField === 'whyStatement' || editField === 'whyTranslation' || editField === 'goalSummary' || editField === 'startingPointIntro' || editField?.startsWith('phase_')}
      />
    </View>
  );
}

// ─── Helper: Edit title mapping ──────────────────────────────────────────────
function getEditTitle(field: string | null): string {
  const map: Record<string, string> = {
    memberName: 'Edit Name', memberAge: 'Edit Age', identityTag: 'Edit Quick Identifiers',
    planSubtitle: 'Edit Plan Subtitle', referredBy: 'Edit Referred By',
    whyStatement: "Edit Member's Why", whyTranslation: 'Edit Coach Translation',
    goalSummary: 'Edit Goal Summary', currentWeight: 'Edit Current Weight',
    goalWeight: 'Edit Goal Weight', startingPointIntro: 'Edit Starting Point Intro',
  };
  if (field?.startsWith('phase_')) return 'Edit Phase Description';
  return map[field || ''] || 'Edit';
}

// ─── EditableMeter (coach can tap segments to change value) ──────────────────
function EditableMeter({ label, value, max = 10, color, onChange }: {
  label: string; value: number; max?: number; color: string; onChange: (v: number) => void;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ color: MUTED, fontSize: 14 }}>{label}</Text>
        <Text style={{ color, fontSize: 14, fontWeight: '700' }}>{value}/{max}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {Array.from({ length: max }, (_, i) => (
          <Pressable key={i} onPress={() => onChange(i + 1)} style={{ flex: 1, height: 24, borderRadius: 4, backgroundColor: i < value ? color : 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: i < value ? color + '60' : '#1E2535' }} />
        ))}
      </View>
    </View>
  );
}

// ─── AddTagButton ────────────────────────────────────────────────────────────
function AddTagButton({ onAdd }: { onAdd: (text: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  if (!adding) {
    return (
      <Pressable onPress={() => setAdding(true)} style={[pv.tag, { borderStyle: 'dashed' }]}>
        <Text style={{ color: MUTED, fontSize: 13 }}>+ Add</Text>
      </Pressable>
    );
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <TextInput
        style={[pv.tag, { minWidth: 100, color: '#FFF', fontSize: 13, paddingVertical: 6 }]}
        value={text} onChangeText={setText} placeholder="New tag..."
        placeholderTextColor="#4A5568" autoFocus
        onSubmitEditing={() => { if (text.trim()) { onAdd(text.trim()); setText(''); setAdding(false); } }}
      />
      <Pressable onPress={() => { if (text.trim()) { onAdd(text.trim()); setText(''); setAdding(false); } }}>
        <Text style={{ color: ACCENT, fontSize: 16, fontWeight: '700' }}>+</Text>
      </Pressable>
      <Pressable onPress={() => { setText(''); setAdding(false); }}>
        <Text style={{ color: MUTED, fontSize: 14 }}>×</Text>
      </Pressable>
    </View>
  );
}

// ─── AddItemButton ───────────────────────────────────────────────────────────
function AddItemButton({ onAdd, placeholder }: { onAdd: (text: string) => void; placeholder?: string }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  if (!adding) {
    return (
      <Pressable onPress={() => setAdding(true)} style={{ paddingVertical: 8 }}>
        <Text style={{ color: '#4A5568', fontSize: 13, fontStyle: 'italic' }}>+ {placeholder || 'Add item...'}</Text>
      </Pressable>
    );
  }
  return (
    <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
      <TextInput
        style={{ flex: 1, backgroundColor: BG, borderWidth: 1, borderColor: BORDER, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, color: '#FFF', fontSize: 13 }}
        value={text} onChangeText={setText} placeholder={placeholder || 'Add item...'} placeholderTextColor="#4A5568" autoFocus
        onSubmitEditing={() => { if (text.trim()) { onAdd(text.trim()); setText(''); setAdding(false); } }}
      />
      <Pressable onPress={() => { if (text.trim()) { onAdd(text.trim()); setText(''); setAdding(false); } }}
        style={{ backgroundColor: ACCENT + '20', borderRadius: 8, paddingHorizontal: 12, justifyContent: 'center', borderWidth: 1, borderColor: ACCENT + '40' }}>
        <Text style={{ color: ACCENT, fontWeight: '700', fontSize: 16 }}>+</Text>
      </Pressable>
    </View>
  );
}

// ─── CommitToSaveView ────────────────────────────────────────────────────────
function CommitToSaveView({ plan, isCoach }: { plan: MemberPlanData; isCoach: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const cts = plan.commitToSave;
  if (!cts?.enabled) return null;
  return (
    <View style={pv.card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text style={{ color: ACCENT, fontSize: 16, fontWeight: '700', fontFamily: FH }}>
          Save {formatCurrency(cts.monthlySavings ?? 0)}/mo
        </Text>
        <Text style={{ color: MUTED, fontSize: 12 }}>Accountability discount</Text>
      </View>
      <Text style={{ color: MUTED, fontSize: 13, lineHeight: 19, marginBottom: 8 }}>
        {cts.summary || 'Stay consistent and save. Miss a session without making it up, and the discount pauses until you rebuild your streak.'}
      </Text>
      <Pressable onPress={() => setExpanded(!expanded)}>
        <Text style={{ color: PRIMARY, fontSize: 13, fontWeight: '600' }}>
          {expanded ? 'Hide details ▴' : 'How it works ▾'}
        </Text>
      </Pressable>
      {expanded && (
        <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: BORDER }}>
          <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18, marginBottom: 4 }}>
            • Complete all sessions each week (make-ups allowed within {cts.makeUpWindowHours || 48}hrs)
          </Text>
          <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18, marginBottom: 4 }}>
            • 30-day streak bonus: {cts.nextMonthPercentOff || 5}% off next month
          </Text>
          <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18, marginBottom: 4 }}>
            • Missed session fee: {formatCurrency(cts.missedSessionFee || 25)} (waived if made up)
          </Text>
          {cts.emergencyWaiverEnabled && (
            <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18, marginBottom: 4 }}>
              • Emergency waiver available (1 per quarter)
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

// ─── InvestmentView ──────────────────────────────────────────────────────────
function InvestmentView({ plan, pricing, isCoach }: { plan: MemberPlanData; pricing: PricingResult; isCoach: boolean }) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const hidden = plan.showInvestment === false;

  if (hidden && !isCoach) return null;

  return (
    <View style={pv.card}>
      {hidden && isCoach && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10, padding: 8, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
          <Text style={{ fontSize: 14 }}>👁️‍🗨️</Text>
          <Text style={{ color: MUTED, fontSize: 12, fontStyle: 'italic' }}>Investment hidden from member</Text>
        </View>
      )}

      {/* Pricing summary card */}
      <View style={{ backgroundColor: 'rgba(110,187,122,0.08)', borderRadius: 10, padding: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
          <Text style={{ color: ACCENT, fontSize: 14 }}>Monthly</Text>
          <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '700' }}>{formatCurrency(pricing.displayMonthlyPrice)}</Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
          <Text style={{ color: MUTED, fontSize: 14 }}>Per session</Text>
          <Text style={{ color: '#FFF', fontSize: 14 }}>{formatCurrency(pricing.perSessionPrice)}</Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: MUTED, fontSize: 14 }}>Pay in full</Text>
          <Text style={{ color: '#FFF', fontSize: 14 }}>{formatCurrency(pricing.payInFullPrice)}</Text>
        </View>
      </View>

      {/* Breakdown toggle */}
      {isCoach && (
        <View style={{ marginTop: 10 }}>
          <Pressable onPress={() => setShowBreakdown(!showBreakdown)}>
            <Text style={{ color: PRIMARY, fontSize: 13, fontWeight: '600' }}>
              {showBreakdown ? 'Hide breakdown ▴' : 'Show breakdown ▾'}
            </Text>
          </Pressable>
          {showBreakdown && <PricingBreakdown plan={plan} pricing={pricing} />}
        </View>
      )}

      {/* Member-facing explanation */}
      {!isCoach && (
        <View style={{ marginTop: 10 }}>
          <Pressable onPress={() => setShowBreakdown(!showBreakdown)}>
            <Text style={{ color: MUTED, fontSize: 12 }}>
              {showBreakdown ? 'Hide breakdown ▴' : 'How we got these numbers ▾'}
            </Text>
          </Pressable>
          {showBreakdown && (
            <View style={{ marginTop: 8, padding: 10, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
              <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>
                Monthly price is based on your coaching rate, session length ({plan.sessionLengthMinutes || 30} min), {plan.sessionsPerWeek} sessions/week, monthly check-in calls, and initial program build time.
              </Text>
              <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18, marginTop: 6 }}>
                Per session: {formatCurrency(pricing.displayMonthlyPrice)} × {plan.contractMonths} months ÷ {pricing.totalSessions} total sessions = {formatCurrency(pricing.perSessionPrice)}
              </Text>
              <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18, marginTop: 6 }}>
                Pay in full: {formatCurrency(pricing.displayMonthlyPrice)} × {plan.contractMonths} months, minus {plan.payInFullDiscountPercent || 10}% discount = {formatCurrency(pricing.payInFullPrice)}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ─── PricingBreakdown (coach-only detailed calculation) ──────────────────────
function PricingBreakdown({ plan, pricing }: { plan: MemberPlanData; pricing: PricingResult }) {
  const sessionCounts = countSessionsByType(plan.weeklySchedule);
  const sessionTypes = Object.keys(sessionCounts) as SessionType[];
  const months = plan.contractMonths;
  const sessionLength = plan.sessionLengthMinutes || 30;
  const hourlyRate = plan.hourlyRate || 20;
  const checkInMin = plan.checkInCallMinutes || 20;
  const buildHrs = plan.programBuildTimeHours || 5;

  // Calculate per-type, per-phase hours
  const typeHours = sessionTypes.filter(t => t !== 'Rest').map(type => {
    const count = sessionCounts[type] || 0;
    const profile = getGuidanceProfile(type, plan.sessionGuidanceProfiles || []);
    const P1 = (plan.phases && plan.phases[0]?.weeks) || 0;
    const P2 = (plan.phases && plan.phases[1]?.weeks) || 0;
    const P3 = (plan.phases && plan.phases[2]?.weeks) || 0;
    return {
      type, count, profile,
      p1Hrs: P1 * count * (sessionLength / 60) * GUIDANCE_FACTORS[profile.phase1],
      p2Hrs: P2 * count * (sessionLength / 60) * GUIDANCE_FACTORS[profile.phase2],
      p3Hrs: P3 * count * (sessionLength / 60) * GUIDANCE_FACTORS[profile.phase3],
    };
  });

  const totalCoachingHrs = typeHours.reduce((s, t) => s + t.p1Hrs + t.p2Hrs + t.p3Hrs, 0);
  const checkInHrs = months * checkInMin / 60;
  const totalHrs = totalCoachingHrs + checkInHrs + buildHrs;
  const P1 = (plan.phases && plan.phases[0]?.weeks) || 0;
  const P2 = (plan.phases && plan.phases[1]?.weeks) || 0;
  const P3 = (plan.phases && plan.phases[2]?.weeks) || 0;

  return (
    <View style={{ marginTop: 8, padding: 12, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 8, borderWidth: 1, borderColor: BORDER }}>
      <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '700', marginBottom: 8 }}>How monthly price is calculated:</Text>

      {typeHours.map(({ type, count, profile, p1Hrs, p2Hrs, p3Hrs }) => (
        <View key={type} style={{ marginBottom: 6 }}>
          {P1 > 0 && (
            <Text style={bd.line}>
              {type === 'Cardio + Mobility' ? 'Cardio' : type}: {P1} × {count} × {sessionLength} min × {GUIDANCE_FACTORS[profile.phase1]} = {p1Hrs.toFixed(1)} hrs (P1)
            </Text>
          )}
          {P2 > 0 && (
            <Text style={bd.line}>
              {type === 'Cardio + Mobility' ? 'Cardio' : type}: {P2} × {count} × {sessionLength} min × {GUIDANCE_FACTORS[profile.phase2]} = {p2Hrs.toFixed(1)} hrs (P2)
            </Text>
          )}
          {P3 > 0 && (
            <Text style={bd.line}>
              {type === 'Cardio + Mobility' ? 'Cardio' : type}: {P3} × {count} × {sessionLength} min × {GUIDANCE_FACTORS[profile.phase3]} = {p3Hrs.toFixed(1)} hrs (P3)
            </Text>
          )}
        </View>
      ))}

      <Text style={bd.line}>Check-in calls ({months} months): {months} × {checkInMin} min ÷ 60 = {checkInHrs.toFixed(1)} hrs</Text>
      <Text style={bd.line}>Program build: {buildHrs} hrs</Text>

      <View style={{ borderTopWidth: 1, borderTopColor: BORDER, marginTop: 8, paddingTop: 8 }}>
        <Text style={bd.line}>Total hours: {totalCoachingHrs.toFixed(1)} + {checkInHrs.toFixed(1)} + {buildHrs} = {totalHrs.toFixed(1)} hrs</Text>
        <Text style={bd.line}>Total program: {totalHrs.toFixed(1)} hrs × {formatCurrency(hourlyRate)}/hr = {formatCurrency(Math.round(totalHrs * hourlyRate))}</Text>
        <Text style={[bd.line, { color: '#FFF', fontWeight: '700' }]}>
          Monthly: {formatCurrency(Math.round(totalHrs * hourlyRate))} ÷ {months} months = {formatCurrency(pricing.calculatedMonthlyPrice)}
        </Text>
      </View>
    </View>
  );
}
const bd = StyleSheet.create({
  line: { color: MUTED, fontSize: 11, lineHeight: 17, fontFamily: Platform.OS === 'web' ? 'monospace' : undefined },
});


// ═══════════════════════════════════════════════════════════════════════════════
// PLAN CONTROLS DRAWER (bottom sheet)
// ═══════════════════════════════════════════════════════════════════════════════

function PlanControlsDrawer({ visible, onClose, plan, pricing, onChange }: {
  visible: boolean; onClose: () => void;
  plan: MemberPlanData; pricing: PricingResult;
  onChange: (updates: Partial<MemberPlanData>) => void;
}) {
  const [showGuidance, setShowGuidance] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [openGuidanceKey, setOpenGuidanceKey] = useState<string | null>(null);

  if (!visible) return null;

  const sessionCounts = countSessionsByType(plan.weeklySchedule);
  const sessionTypes = Object.keys(sessionCounts).filter(t => t !== 'Rest') as SessionType[];

  const handleGuidanceChange = (sessionType: SessionType, phase: 'phase1' | 'phase2' | 'phase3', value: GuidanceLevel) => {
    const existing = plan.sessionGuidanceProfiles || [];
    const profile = getGuidanceProfile(sessionType, existing);
    const updated: SessionTypeGuidance = { ...profile, sessionType, [phase]: value };
    const newProfiles = existing.filter(p => p.sessionType !== sessionType);
    newProfiles.push(updated);
    onChange({ sessionGuidanceProfiles: newProfiles });
  };

  const handleBasePriceOverride = (val: number) => {
    onChange({ monthlyPriceOverride: val, isManualOverride: true });
  };

  const handleResetToCalculated = () => {
    onChange({ monthlyPriceOverride: undefined, isManualOverride: false });
  };

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <Pressable style={em.overlay} onPress={onClose}>
        <Pressable style={[em.sheet, { maxHeight: '85%' }]} onPress={e => e.stopPropagation()}>
          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Header */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 18, fontWeight: '700', color: '#FFF', fontFamily: FH }}>Plan Controls</Text>
                <Text style={{ color: MUTED, fontSize: 14 }}>▴</Text>
              </View>
              <Pressable onPress={onClose} hitSlop={8}><Icon name="x" size={20} color={MUTED} /></Pressable>
            </View>

            {/* Sessions per week */}
            <View style={{ marginBottom: 16 }}>
              <Text style={dc.label}>Sessions per week</Text>
              <ButtonGroup options={[2, 3, 4, 5, 6] as number[]} value={plan.sessionsPerWeek} onChange={(v) => {
                const clamped = v as SessionsPerWeek;
                const newSchedule = createDefaultSchedule(clamped);
                onChange({ sessionsPerWeek: clamped, weeklySchedule: newSchedule });
              }} />
            </View>

            {/* Contract length */}
            <View style={{ marginBottom: 16 }}>
              <Text style={dc.label}>Contract length (months)</Text>
              <ButtonGroup options={[6, 9, 12] as number[]} value={plan.contractMonths} onChange={(v) => {
                const months = v as ContractLength;
                const newPhases = createDefaultPhases(months);
                onChange({ contractMonths: months, phases: newPhases });
              }} />
            </View>

            {/* Include nutrition coaching */}
            <Pressable
              onPress={() => onChange({ nutrition: { ...(plan.nutrition || { type: 'in-house', providerName: '', monthlyCost: 0, description: 'Personalized nutrition guidance to complement your training.', enabled: false }), enabled: !(plan.nutrition?.enabled) } })}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, marginBottom: 12 }}
            >
              <Text style={{ color: '#FFF', fontSize: 14 }}>Include nutrition coaching</Text>
              <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: plan.nutrition?.enabled ? ACCENT : BORDER, backgroundColor: plan.nutrition?.enabled ? ACCENT : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {plan.nutrition?.enabled && <Text style={{ color: '#000', fontSize: 14, fontWeight: '700' }}>✓</Text>}
              </View>
            </Pressable>

            {/* Pricing Settings (collapsible) */}
            <Pressable onPress={() => setShowPricing(!showPricing)}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderTopWidth: 1, borderTopColor: BORDER }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 14 }}>💲</Text>
                <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '600' }}>Pricing Settings</Text>
              </View>
              <Text style={{ color: MUTED }}>{showPricing ? '▴' : '▾'}</Text>
            </Pressable>

            {showPricing && (
              <View style={{ paddingVertical: 8, paddingHorizontal: 4 }}>
                <View style={{ backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: BORDER }}>
                  <NumericField label="Hourly rate" value={plan.hourlyRate || 20} onChange={v => onChange({ hourlyRate: v })} prefix="$" suffix="/hr" icon="💰" />
                  <NumericField label="Session length" value={plan.sessionLengthMinutes || 30} onChange={v => onChange({ sessionLengthMinutes: v })} suffix="min" icon="⏱️" />
                  <NumericField label="Monthly check-in call" value={plan.checkInCallMinutes || 20} onChange={v => onChange({ checkInCallMinutes: v })} suffix="min" icon="📞" />
                  <NumericField label="Program build time" value={plan.programBuildTimeHours || 5} onChange={v => onChange({ programBuildTimeHours: v })} suffix="hrs" icon="🔧" />
                </View>

                {/* Guidance by session type (collapsible) */}
                <Pressable onPress={() => setShowGuidance(!showGuidance)}
                  style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, marginTop: 8, borderTopWidth: 1, borderTopColor: BORDER }}>
                  <Text style={{ color: MUTED, fontSize: 14 }}>Guidance by session type</Text>
                  <Text style={{ color: MUTED }}>{showGuidance ? '▴' : '▾'}</Text>
                </Pressable>

                {showGuidance && (
                  <View style={{ gap: 12 }}>
                    {sessionTypes.map(type => {
                      const count = sessionCounts[type] || 0;
                      const profile = getGuidanceProfile(type, plan.sessionGuidanceProfiles || []);
                      return (
                        <View key={type} style={{ backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: 12 }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                            <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '600' }}>
                              {type === 'Cardio + Mobility' ? 'Cardio' : type} sessions
                            </Text>
                            <Text style={{ color: MUTED, fontSize: 12 }}>{count}× per week</Text>
                          </View>
                          <View style={{ flexDirection: 'row', gap: 8 }}>
                            {(['phase1', 'phase2', 'phase3'] as const).map((phase, idx) => {
                              const gKey = `${type}-${phase}`;
                              return (
                                <View key={phase} style={{ flex: 1 }}>
                                  <Text style={{ color: MUTED, fontSize: 10, marginBottom: 4 }}>Phase {idx + 1}</Text>
                                  <GuidanceDropdown
                                    value={profile[phase]}
                                    onChange={(val) => { handleGuidanceChange(type, phase, val); setOpenGuidanceKey(null); }}
                                    isOpen={openGuidanceKey === gKey}
                                    onOpen={() => setOpenGuidanceKey(openGuidanceKey === gKey ? null : gKey)}
                                  />
                                </View>
                              );
                            })}
                          </View>
                        </View>
                      );
                    })}
                    <Text style={{ color: '#4A5568', fontSize: 10 }}>
                      Full = 100% live coach time · Blend = 62.5% · Self = 0%
                    </Text>
                  </View>
                )}

                {/* Calculated monthly */}
                <View style={{ borderTopWidth: 1, borderTopColor: BORDER, marginTop: 12, paddingTop: 12 }}>
                  <Text style={{ color: MUTED, fontSize: 13 }}>
                    Calculated monthly: {formatCurrency(pricing.calculatedMonthlyPrice)}
                  </Text>
                  <Pressable onPress={() => setShowBreakdown(!showBreakdown)} style={{ marginTop: 4 }}>
                    <Text style={{ color: PRIMARY, fontSize: 13, fontWeight: '600' }}>
                      {showBreakdown ? 'Hide breakdown ▴' : 'Show breakdown ▾'}
                    </Text>
                  </Pressable>
                  {showBreakdown && <PricingBreakdown plan={plan} pricing={pricing} />}
                </View>
              </View>
            )}

            {/* Present Plan */}
            {plan.status === 'draft' && (
              <Pressable
                onPress={() => onChange({ status: 'pending' })}
                style={{ backgroundColor: PRIMARY, paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 20 }}
              >
                <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '700' }}>Present Plan to Member</Text>
              </Pressable>
            )}

            {plan.status === 'pending' && (
              <View style={{ marginTop: 20, padding: 12, backgroundColor: 'rgba(91,155,213,0.08)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(91,155,213,0.25)' }}>
                <Text style={{ color: PRIMARY, fontSize: 14, fontWeight: '600', marginBottom: 4 }}>Plan Presented</Text>
                <Text style={{ color: MUTED, fontSize: 13 }}>The plan has been presented to the member. They will see an option to accept it on their end.</Text>
              </View>
            )}

            {plan.status === 'accepted' && (
              <View style={{ marginTop: 20, padding: 12, backgroundColor: 'rgba(110,187,122,0.08)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(110,187,122,0.25)' }}>
                <Text style={{ color: ACCENT, fontSize: 14, fontWeight: '600', marginBottom: 4 }}>Plan Accepted!</Text>
                <Text style={{ color: MUTED, fontSize: 13 }}>The member has accepted this plan. It is now active.</Text>
              </View>
            )}

            {/* Monthly price override */}
            <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text style={{ color: MUTED, fontSize: 14 }}>
                  Monthly price {plan.isManualOverride ? '(override)' : ''}
                </Text>
                {plan.isManualOverride && (
                  <Pressable onPress={handleResetToCalculated}>
                    <Text style={{ color: PRIMARY, fontSize: 13, fontWeight: '600' }}>Reset to calculated</Text>
                  </Pressable>
                )}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: MUTED, fontSize: 16 }}>$</Text>
                <TextInput
                  style={{ flex: 1, backgroundColor: BG, borderWidth: 1, borderColor: BORDER, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, color: '#FFF', fontSize: 18, fontWeight: '700' }}
                  value={String(pricing.displayMonthlyPrice)}
                  onChangeText={t => { const n = parseInt(t); if (!isNaN(n)) handleBasePriceOverride(n); }}
                  keyboardType="number-pad" selectTextOnFocus
                />
              </View>
            </View>

            {/* Pricing summary */}
            <View style={{ marginTop: 12, backgroundColor: 'rgba(110,187,122,0.08)', borderRadius: 10, padding: 14 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text style={{ color: ACCENT, fontSize: 14 }}>Monthly</Text>
                <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '700' }}>{formatCurrency(pricing.displayMonthlyPrice)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text style={{ color: MUTED, fontSize: 14 }}>Per session</Text>
                <Text style={{ color: '#FFF', fontSize: 14 }}>{formatCurrency(pricing.perSessionPrice)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: MUTED, fontSize: 14 }}>Pay in full</Text>
                <Text style={{ color: '#FFF', fontSize: 14 }}>{formatCurrency(pricing.payInFullPrice)}</Text>
              </View>
            </View>

            {/* Investment visibility toggle */}
            <Pressable
              onPress={() => onChange({ showInvestment: !(plan.showInvestment !== false) })}
              style={[dc.visToggle, { backgroundColor: plan.showInvestment !== false ? ACCENT : '#1A2035', borderColor: plan.showInvestment !== false ? ACCENT : BORDER }]}
            >
              <Text style={{ fontSize: 14 }}>{plan.showInvestment !== false ? '👁️' : '👁️‍🗨️'}</Text>
              <Text style={{ color: plan.showInvestment !== false ? '#000' : MUTED, fontSize: 13, fontWeight: '600' }}>
                {plan.showInvestment !== false ? 'Investment visible to member' : 'Investment hidden from member'}
              </Text>
            </Pressable>

            {/* Commit to Save toggle */}
            <Pressable
              onPress={() => onChange({
                commitToSave: {
                  ...(plan.commitToSave || { monthlySavings: 100, nextMonthPercentOff: 5, missedSessionFee: 25, makeUpWindowHours: 48, emergencyWaiverEnabled: true, reentryRule: 'Resume full rate for 30 days, then re-qualify.', summary: 'Stay consistent and save. Miss a session without making it up, and the discount pauses until you rebuild your streak.', enabled: false, active: false }),
                  enabled: !(plan.commitToSave?.enabled),
                },
              })}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, marginTop: 8 }}
            >
              <Text style={{ color: '#FFF', fontSize: 14 }}>Include Commit to Save</Text>
              <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: plan.commitToSave?.enabled ? ACCENT : BORDER, backgroundColor: plan.commitToSave?.enabled ? ACCENT : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {plan.commitToSave?.enabled && <Text style={{ color: '#000', fontSize: 14, fontWeight: '700' }}>✓</Text>}
              </View>
            </Pressable>

            <View style={{ height: 20 }} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const dc = StyleSheet.create({
  label: { color: MUTED, fontSize: 13, marginBottom: 8 },
  visToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 10, borderWidth: 1, marginTop: 12,
  },
});


// ═══════════════════════════════════════════════════════════════════════════════
// QUESTIONNAIRE VIEWER
// ═══════════════════════════════════════════════════════════════════════════════

function QuestionnaireViewer({ data }: { data: any }) {
  if (!data) return <View style={{ padding: 20 }}><Text style={{ color: MUTED }}>No questionnaire data available.</Text></View>;
  
  // Map fields from intakeSubmissions if needed
  const name = `${data.firstName || ''} ${data.lastName || ''}`.trim();
  const goals = data.primaryGoals || data.goals;
  const weight = data.weight || data.currentWeight;
  const readiness = data.readinessForChange || data.readiness;
  const activity = data.activityLevel || data.occupation;
  const diet = data.currentDiet || data.diet;
  
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
      <QSection label="About">
        <QRow label="Name" value={name} />
        <QRow label="Email" value={data.email} />
        <QRow label="Phone" value={data.phone} />
        <QRow label="Gender" value={data.gender} />
        <QRow label="DOB" value={data.dateOfBirth} />
        <QRow label="Height" value={data.height} />
      </QSection>

      {(goals || weight || data.goalWeight) && (
        <QSection label="Goals">
          <QRow label="Primary Goals" value={goals} />
          <QRow label="Specific Goals" value={data.specificGoals} />
          <QRow label="Current Weight" value={weight} />
          <QRow label="Goal Weight" value={data.goalWeight} />
        </QSection>
      )}

      {(data.whyStatement || readiness || data.motivation) && (
        <QSection label="Motivation">
          <QRow label="Why Statement" value={data.whyStatement} />
          <QRow label="Readiness" value={readiness} />
          <QRow label="Motivation" value={data.motivation} />
          <QRow label="Gym Confidence" value={data.gymConfidence} />
        </QSection>
      )}

      {(activity || diet || data.currentRoutine) && (
        <QSection label="Lifestyle">
          <QRow label="Activity/Occupation" value={activity} />
          <QRow label="Current Routine" value={data.currentRoutine} />
          <QRow label="Diet" value={diet} />
          <QRow label="Work Schedule" value={data.workSchedule} />
        </QSection>
      )}

      {(data.healthProblems || data.medications || data.injuries || data.currentInjuries) && (
        <QSection label="Health">
          <QRow label="Health Problems" value={data.healthProblems} />
          <QRow label="Medications" value={data.medications} />
          <QRow label="Injuries" value={data.injuries || data.currentInjuries} />
          <QRow label="Therapies" value={data.therapies} />
        </QSection>
      )}

      {(data.preferredDays || data.preferredTime || data.gym) && (
        <QSection label="Scheduling">
          <QRow label="Preferred Days" value={data.preferredDays} />
          <QRow label="Preferred Time" value={data.preferredTime} />
          <QRow label="Gym" value={data.gym} />
          <QRow label="Sessions/Week" value={data.sessionsPerWeek} />
        </QSection>
      )}
    </ScrollView>
  );
}

function QSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={{ color: ACCENT, fontSize: 12, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10, fontFamily: FH }}>{label}</Text>
      <View style={{ backgroundColor: CARD, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: BORDER }}>{children}</View>
    </View>
  );
}

function QRow({ label, value }: { label: string; value?: string | number | string[] }) {
  if (!value || (Array.isArray(value) && value.length === 0)) return null;
  const display = Array.isArray(value) ? value.join(', ') : String(value);
  if (!display.trim()) return null;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: BORDER }}>
      <Text style={{ color: MUTED, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '500', maxWidth: '60%', textAlign: 'right' } as any}>{display}</Text>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN SCREEN
// ═══════════════════════════════════════════════════════════════════════════════

export default function MemberPlanScreen() {
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<MemberPlanData | null>(null);
  const [questionnaire, setQuestionnaire] = useState<any>(null);
  const [memberName, setMemberName] = useState('');
  const [tab, setTab] = useState<'questionnaire' | 'plan'>('plan');
  const [isCoachMode, setIsCoachMode] = useState(true);
  const [showControls, setShowControls] = useState(false);
  const [copied, setCopied] = useState(false);
  const saveTimer = useRef<any>(null);
  const planKeyRef = useRef<string>(memberId || '');

  // Load data
  useEffect(() => {
    if (!memberId || !user) return;
    loadData();
  }, [memberId, user]);

  const loadData = async () => {
    if (!memberId || !user) return;
    setLoading(true);

    // ── Step 1: Load member profile ──────────────────────────────────────
    let name = 'Member';
    let memberUid: string = memberId; // default: assume memberId IS the uid
    try {
      const memberDoc = await getDoc(doc(db, 'members', memberId));
      if (memberDoc.exists()) {
        const d = memberDoc.data();
        // Support all possible name fields: name, displayName, firstName+lastName
        name = d.firstName
          ? `${d.firstName} ${d.lastName || ''}`.trim()
          : d.displayName || d.name || 'Member';
        // If the member doc has a uid field (intake-created), use it for plan lookup
        if (d.uid) memberUid = d.uid;
      }
    } catch (err) {
      console.warn('[loadData] Could not load member profile:', err);
    }
    setMemberName(name);

    // ── Step 2: Load questionnaire ───────────────────────────────────────
    let qData: any = null;
    try {
      // Try both the Firestore doc ID and the uid
      const qDoc = await getDoc(doc(db, 'intakeSubmissions', memberId));
      if (qDoc.exists()) {
        qData = qDoc.data();
      } else if (memberUid !== memberId) {
        const qDoc2 = await getDoc(doc(db, 'intakeSubmissions', memberUid));
        if (qDoc2.exists()) qData = qDoc2.data();
      }
      if (qData) setQuestionnaire(qData);
    } catch (err) {
      console.warn('[loadData] Could not load questionnaire:', err);
    }

    // ── Step 3: Load or create plan ──────────────────────────────────────
    // Try both the Firestore doc ID and the uid as plan keys
    let finalPlan: MemberPlanData | null = null;
    let planKey = memberId; // the key we'll use to save/update the plan

    try {
      // Try primary key first
      const planDoc = await getDoc(doc(db, 'member_plans', memberId));
      if (planDoc.exists()) {
        console.log('[loadData] Found plan at key:', memberId);
        const existingPlan = planDoc.data() as MemberPlanData;
        const defaultPlan = createDefaultPlan(name, memberId, user.uid);
        finalPlan = {
          ...defaultPlan,
          ...existingPlan,
          nutrition: { ...defaultPlan.nutrition, ...(existingPlan.nutrition || {}) },
          commitToSave: { ...defaultPlan.commitToSave, ...(existingPlan.commitToSave || {}) },
          phases: (existingPlan.phases && existingPlan.phases.length > 0) ? existingPlan.phases : defaultPlan.phases,
          weeklySchedule: (existingPlan.weeklySchedule && existingPlan.weeklySchedule.length > 0) ? existingPlan.weeklySchedule : defaultPlan.weeklySchedule,
          sessionGuidanceProfiles: (existingPlan.sessionGuidanceProfiles && existingPlan.sessionGuidanceProfiles.length > 0) ? existingPlan.sessionGuidanceProfiles : defaultPlan.sessionGuidanceProfiles,
          memberName: existingPlan.memberName || name,
        };
        planKey = memberId;
      } else if (memberUid !== memberId) {
        // Try uid-based key (for intake-created members)
        const planDoc2 = await getDoc(doc(db, 'member_plans', memberUid));
        if (planDoc2.exists()) {
          console.log('[loadData] Found plan at uid key:', memberUid);
          const existingPlan = planDoc2.data() as MemberPlanData;
          const defaultPlan = createDefaultPlan(name, memberUid, user.uid);
          finalPlan = {
            ...defaultPlan,
            ...existingPlan,
            nutrition: { ...defaultPlan.nutrition, ...(existingPlan.nutrition || {}) },
            commitToSave: { ...defaultPlan.commitToSave, ...(existingPlan.commitToSave || {}) },
            phases: (existingPlan.phases && existingPlan.phases.length > 0) ? existingPlan.phases : defaultPlan.phases,
            weeklySchedule: (existingPlan.weeklySchedule && existingPlan.weeklySchedule.length > 0) ? existingPlan.weeklySchedule : defaultPlan.weeklySchedule,
            sessionGuidanceProfiles: (existingPlan.sessionGuidanceProfiles && existingPlan.sessionGuidanceProfiles.length > 0) ? existingPlan.sessionGuidanceProfiles : defaultPlan.sessionGuidanceProfiles,
            memberName: existingPlan.memberName || name,
          };
          planKey = memberUid;
        }
      }
    } catch (err) {
      console.warn('[loadData] Error reading plan from Firestore:', err);
    }

    // ── Step 4: Create plan from scratch if none found ───────────────────
    if (!finalPlan) {
      console.log('[loadData] No plan found, creating default plan for:', name);
      const defaultPlan = createDefaultPlan(name, planKey, user.uid);
      // Populate from questionnaire if available
      if (qData) {
        if (qData.dateOfBirth) {
          try {
            const birthDate = new Date(qData.dateOfBirth);
            const age = new Date().getFullYear() - birthDate.getFullYear();
            defaultPlan.memberAge = age;
          } catch (e) { /* ignore */ }
        }
        defaultPlan.whyStatement = qData.whyStatement || '';
        defaultPlan.readiness = qData.readinessForChange || qData.readiness || 7;
        defaultPlan.motivation = qData.motivation || 8;
        defaultPlan.gymConfidence = qData.gymConfidence || 5;
        if (qData.primaryGoals) defaultPlan.goals = qData.primaryGoals;
        else if (qData.goals) defaultPlan.goals = qData.goals;
        if (qData.weight) defaultPlan.currentWeight = String(qData.weight) + ' lbs';
        if (qData.goalWeight) defaultPlan.goalWeight = String(qData.goalWeight) + ' lbs';
        if (qData.gym) defaultPlan.gym = qData.gym;
      }
      finalPlan = defaultPlan;
      // Try to persist — but NEVER let a save failure block showing the plan
      try {
        await setDoc(doc(db, 'member_plans', planKey), {
          ...finalPlan,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        console.log('[loadData] New plan saved to Firestore at key:', planKey);
      } catch (saveErr) {
        console.warn('[loadData] Could not save plan to Firestore (will show in-memory):', saveErr);
        // Plan still shows in UI — coach can edit and it will retry on next change
      }
    }

    // ── Step 5: Always set plan state ────────────────────────────────────
    planKeyRef.current = planKey; // Store the resolved key for auto-save
    console.log('[loadData] Setting plan for:', finalPlan.memberName, 'planKey:', planKey);
    setPlan(finalPlan);
    setLoading(false);
  };

  // Auto-save with debounce
  const handlePlanChange = useCallback((updates: Partial<MemberPlanData>) => {
    setPlan(prev => {
      if (!prev) return prev;
      const updated = { ...prev, ...updates };
      // Debounced save to Firestore using the resolved planKey
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        const key = planKeyRef.current || memberId!;
        try {
          await setDoc(doc(db, 'member_plans', key), { ...updated, updatedAt: serverTimestamp() }, { merge: true });
        } catch (err) {
          console.error('Error saving plan:', err);
        }
      }, 800);
      return updated;
    });
  }, [memberId]);

  // Pricing (memoized)
  const pricing = useMemo(() => {
    if (!plan) return null;
    try {
      return calculatePricing(plan);
    } catch (err) {
      console.error('Pricing calculation error:', err);
      return null;
    }
  }, [plan]);

  // Share link
  const handleShare = async () => {
    const url = `https://goarrive.web.app/shared-plan/${memberId}`;
    try {
      if (Platform.OS === 'web' && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Error copying:', err);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={{ color: MUTED, marginTop: 12 }}>Loading plan...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      {/* ─── TOP BAR ──────────────────────────────────────────────────────── */}
      <View style={tb.bar}>
        <Pressable onPress={() => router.back()} style={tb.backBtn}>
          <Icon name="arrow-back" size={20} color={MUTED} />
        </Pressable>

        {/* Tab selector */}
        <View style={tb.tabs}>
          <Pressable onPress={() => setTab('questionnaire')} style={[tb.tab, tab === 'questionnaire' && tb.tabActive]}>
            <Text style={[tb.tabText, tab === 'questionnaire' && tb.tabTextActive]}>Intake</Text>
          </Pressable>
          <Pressable onPress={() => setTab('plan')} style={[tb.tab, tab === 'plan' && tb.tabActive]}>
            <Text style={[tb.tabText, tab === 'plan' && tb.tabTextActive]}>Fitness Plan</Text>
          </Pressable>
        </View>

        {/* Settings gear (opens Plan Controls) */}
        {tab === 'plan' && isCoachMode && (
          <Pressable onPress={() => setShowControls(!showControls)}
            style={[tb.gearBtn, showControls && { backgroundColor: ACCENT }]}>
            <Icon name="settings" size={20} color={showControls ? '#000' : MUTED} />
          </Pressable>
        )}
        {(tab !== 'plan' || !isCoachMode) && <View style={{ width: 40 }} />}
      </View>

      {/* ─── MODE TOGGLE (Coach / Member View) ────────────────────────────── */}
      {tab === 'plan' && (
        <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
          <View style={{ flexDirection: 'row', backgroundColor: '#1A2035', borderRadius: 10, padding: 3 }}>
            <Pressable onPress={() => setIsCoachMode(true)}
              style={[mt.btn, isCoachMode && mt.btnActive]}>
              <Icon name="settings" size={14} color={isCoachMode ? '#FFF' : MUTED} />
              <Text style={[mt.btnText, isCoachMode && mt.btnTextActive]}>Coach</Text>
            </Pressable>
            <Pressable onPress={() => setIsCoachMode(false)}
              style={[mt.btn, !isCoachMode && mt.btnActive]}>
              <Text style={{ fontSize: 14 }}>👁️</Text>
              <Text style={[mt.btnText, !isCoachMode && mt.btnTextActive]}>Member View</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* ─── CONTENT ──────────────────────────────────────────────────────── */}
      {tab === 'questionnaire' ? (
        <QuestionnaireViewer data={questionnaire} />
      ) : plan ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 120 }}>
          <PlanView plan={plan} isCoach={isCoachMode} onChange={handlePlanChange} />
        </ScrollView>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Text style={{ color: MUTED, fontSize: 16, marginBottom: 16, textAlign: 'center' }}>Could not load plan data.</Text>
          <Pressable onPress={loadData} style={{ backgroundColor: PRIMARY, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 }}>
            <Text style={{ color: '#FFF', fontWeight: '700' }}>Retry</Text>
          </Pressable>
        </View>
      )}

      {/* ─── BOTTOM ACTION BAR ────────────────────────────────────────────── */}
      {tab === 'plan' && isCoachMode && (
        <View style={ab.bar}>
          <Pressable onPress={handleShare} style={ab.shareBtn}>
            <Icon name="share" size={18} color="#000" />
            <Text style={ab.shareBtnText}>
              {copied ? 'Link copied!' : `Share with ${plan?.memberName || 'Member'}`}
            </Text>
          </Pressable>
          <Pressable onPress={() => setShowControls(true)} style={ab.controlsBtn}>
            <Icon name="settings" size={18} color={MUTED} />
          </Pressable>
        </View>
      )}

      {/* ─── PLAN CONTROLS DRAWER ─────────────────────────────────────────── */}
      {plan && pricing && (
        <PlanControlsDrawer
          visible={showControls}
          onClose={() => setShowControls(false)}
          plan={plan}
          pricing={pricing}
          onChange={handlePlanChange}
        />
      )}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════════════════════

const es = StyleSheet.create({
  fieldLabel: { color: MUTED, fontSize: 12, fontWeight: '600', marginBottom: 4, fontFamily: FH, letterSpacing: 0.3 },
  fieldHint: { color: '#4A5568', fontSize: 11, marginBottom: 4 },
  input: { backgroundColor: BG, borderWidth: 1, borderColor: BORDER, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: '#FFF', fontSize: 14 },
  sectionCard: { borderWidth: 1, borderRadius: 12, marginBottom: 12, overflow: 'hidden' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  sectionTitle: { fontSize: 14, fontWeight: '700', fontFamily: FH },
});

const tb = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingTop: Platform.OS === 'web' ? 12 : 50, paddingBottom: 8,
    backgroundColor: BG, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  backBtn: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tabs: { flexDirection: 'row', backgroundColor: '#1A2035', borderRadius: 10, padding: 3 },
  tab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  tabActive: { backgroundColor: CARD },
  tabText: { color: MUTED, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#FFF' },
  gearBtn: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});

const mt = StyleSheet.create({
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 8 },
  btnActive: { backgroundColor: CARD },
  btnText: { color: MUTED, fontSize: 13, fontWeight: '600' },
  btnTextActive: { color: '#FFF' },
});

const ab = StyleSheet.create({
  bar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: 10, padding: 16, paddingBottom: 28,
    backgroundColor: BG, borderTopWidth: 1, borderTopColor: BORDER,
  },
  shareBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 12, backgroundColor: SECONDARY,
  },
  shareBtnText: { color: '#000', fontSize: 15, fontWeight: '700' },
  controlsBtn: {
    width: 52, height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#1A2035', borderWidth: 1, borderColor: BORDER,
  },
});

const pv = StyleSheet.create({
  section: { paddingHorizontal: 16, marginTop: 24 },
  sectionLabel: { color: ACCENT, fontSize: 12, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6, fontFamily: FH },
  sectionTitle: { color: '#FFF', fontSize: 20, fontWeight: '700', fontFamily: FH },
  builtWith: { color: ACCENT, fontSize: 11, fontWeight: '600', letterSpacing: 1.5, textTransform: 'uppercase', textAlign: 'center', marginBottom: 4, fontFamily: FH },
  heroName: { color: '#FFF', fontSize: 28, fontWeight: '700', fontFamily: FH, textAlign: 'center' },
  heroTitle: { color: '#FFF', fontSize: 24, fontWeight: '700', fontFamily: FH, textAlign: 'center', marginTop: 2 },
  heroMeta: { color: MUTED, fontSize: 14 },
  card: { backgroundColor: CARD, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: BORDER },
  bodyText: { color: '#C5CDD8', fontSize: 14, lineHeight: 21 },
  tag: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: ACCENT + '40', backgroundColor: ACCENT + '10' },
  tagText: { color: ACCENT, fontSize: 13, fontWeight: '500' },
  goalCard: {
    width: (SCREEN_W - 48) / 2 - 5, paddingVertical: 14, paddingHorizontal: 12,
    borderRadius: 12, borderWidth: 1, alignItems: 'center',
  },
  whyLabel: { color: SECONDARY, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
  whyQuote: { color: '#FFF', fontSize: 16, fontWeight: '600', fontStyle: 'italic', fontFamily: FH, lineHeight: 24 },
  phaseCard: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10 },
});
