/**
 * Coach Member Plan — Forge-style seamless editing
 *
 * The coach sees the same beautiful plan as the member, with subtle edit
 * affordances layered on top: pencil icons, tappable day tiles with dropdown
 * session-type picker, sliders for readiness/motivation/sessions, and a
 * Plan Controls drawer for pricing settings.
 *
 * ─── DROPDOWN RULE (DO NOT VIOLATE) ─────────────────────────────────────────
 * ALL floating dropdown menus in this file MUST use ReactDOM.createPortal to
 * render directly into document.body with position:fixed and zIndex:99999.
 *
 * WHY: React Native Web wraps the app in a scrollable div with overflow:auto.
 * Any dropdown using position:absolute will be clipped by that container and
 * disappear behind sibling sections. The same applies inside React Native
 * Modal components (PlanControlsDrawer) which create their own stacking context.
 *
 * REQUIRED PATTERN for every floating dropdown:
 *   1. Wrap the trigger in a <div ref={domRef}> to get reliable getBoundingClientRect()
 *   2. On open, call getBoundingClientRect() and compute top/left for position:fixed
 *   3. Flip the dropdown upward if there is insufficient space below (spaceBelow < dropHeight+20)
 *   4. Hard-clamp top so the dropdown never escapes the viewport
 *   5. Render via ReactDOM.createPortal(<>, document.body) with zIndex:99999
 *   6. Include a full-screen transparent backdrop div (zIndex:99998) to close on outside click
 *   7. Add a scroll event listener (window, capture phase) that closes the dropdown on scroll
 *      — use a 100ms delay so the dropdown doesn't close the instant it opens
 *
 * NEVER use position:absolute for dropdowns. NEVER render dropdowns inline
 * inside a ScrollView or Modal without portal rendering.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { CtsOptInModal } from '../../../components/CtsOptInModal';
import ReactDOM from 'react-dom';
import {
  View, Text, ScrollView, Pressable, TextInput, StyleSheet,
  Platform, Modal, Animated, Dimensions, Image, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc, setDoc, addDoc, collection, serverTimestamp, updateDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../../lib/AuthContext';
import { Icon } from '../../../components/Icon';
import ContinuationCard from '../../../components/ContinuationCard';
import {
  MemberPlanData, DayPlan, SessionType, Phase,
  SessionTypeGuidance, GuidanceLevel, PricingResult, PostContract, ContinuationPricing,
  calculatePricing, formatCurrency, monthsToWeeks,
  createDefaultPlan, createDefaultSchedule, createDefaultPhases,
  countSessionsByType, getGuidanceProfile,
  typeColors, phaseColors, resolvePhaseColor, goalConfig, availableGoals, allKnownGoals,
  getGoalEmoji, getGoalColor,
  dayTypeOptions, guidanceLevels, SESSION_TYPES,
  GUIDANCE_FACTORS, GUIDANCE_SHORT,
  SessionsPerWeek, ContractLength,
} from '../../../lib/planTypes';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const ACCENT = '#6EBB7A';
const PRIMARY = '#5B9BD5';
const SECONDARY = '#F5A623';
const BG = '#0E1117';
const CARD = '#151B28';
const BORDER = '#1E2A3A';
const MUTED = '#8899AA';
const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

// Remove undefined values from an object before saving to Firestore
// (Firestore rejects undefined field values)
function sanitizeForFirestore(obj: any): any {
  if (obj === null || obj === undefined) return null;
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
  if (typeof obj === 'object' && typeof obj.toDate !== 'function') {
    const result: any = {};
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val !== undefined) result[key] = sanitizeForFirestore(val);
    }
    return result;
  }
  return obj;
}

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
  sheet: { backgroundColor: CARD, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
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
// DROPDOWN RULE: All dropdowns that appear inside scrollable containers, cards with
// borderRadius, or overflow:hidden parents MUST use portal rendering (ReactDOM.createPortal
// to document.body with position:fixed) to avoid clipping. Never use position:absolute
// inside such containers.
function DayTile({ day, isCoach, onTypeChange, onOpen, isOpen }: {
  day: DayPlan; isCoach: boolean; onTypeChange: (t: SessionType) => void;
  onOpen?: () => void; isOpen?: boolean;
}) {
  const tc = typeColors[day.type] || typeColors['Rest'];
  const isSession = day.isSession && day.type !== 'Rest';
  const abbr = day.type === 'Strength' ? 'STR' : day.type === 'Cardio + Mobility' ? 'CARD' : day.type === 'Mix' ? 'MIX' : 'OFF';
  const domRef = useRef<HTMLDivElement | null>(null);
  const [dropPos, setDropPos] = useState<{ top: number; left: number } | null>(null);

  // Close dropdown on scroll (prevents dropdown from floating over other content)
  // We use a small delay to avoid closing immediately when the dropdown opens
  // (which can trigger a micro-scroll in some browsers)
  useEffect(() => {
    if (!isOpen || Platform.OS !== 'web') return;
    let active = false;
    const timer = setTimeout(() => { active = true; }, 100);
    const handleScroll = () => { if (active) onOpen?.(); }; // toggle closes it
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [isOpen]);

  const handlePress = () => {
    if (!isCoach) return;
    if (!isOpen && domRef.current && Platform.OS === 'web') {
      const rect = domRef.current.getBoundingClientRect();
      // 4 session types * ~40px each = ~170px dropdown height
      const dropHeight = 180;
      const vh = Math.min(
        window.innerHeight,
        document.documentElement.clientHeight,
        window.visualViewport ? window.visualViewport.height : Infinity
      );
      const spaceBelow = vh - rect.bottom;
      let top = spaceBelow >= dropHeight + 20
        ? rect.bottom + 4
        : rect.top - dropHeight - 4;
      // Hard clamp: never let dropdown go below viewport or above 0
      top = Math.max(8, Math.min(top, vh - dropHeight - 8));
      setDropPos({ top, left: rect.left });
    }
    onOpen?.();
  };

  const tileContent = (
    <Pressable
      onPress={handlePress}
      style={[dt.tile, { backgroundColor: isSession ? tc.bg : 'rgba(42,51,71,0.2)', borderColor: isOpen ? tc.text : (isSession ? tc.border : 'transparent'), borderWidth: 1 }]}
    >
      <Text style={{ fontSize: 9, fontWeight: '600', color: MUTED, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.3 }}>{day.shortDay}</Text>
      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: isSession ? tc.dot : '#2A3040', marginBottom: 5 }} />
      <Text style={{ fontSize: 8, fontWeight: '700', color: isSession ? tc.text : '#4A5568', letterSpacing: 0.2 }} numberOfLines={1}>{abbr}</Text>
    </Pressable>
  );

  const portalDropdown = isOpen && isCoach && Platform.OS === 'web' && dropPos ? ReactDOM.createPortal(
    <>
      <div onClick={() => onOpen?.()} style={{ position: 'fixed', inset: 0, zIndex: 99998 }} />
      <div style={{
        position: 'fixed', top: dropPos.top, left: dropPos.left,
        zIndex: 99999, minWidth: 180,
        backgroundColor: '#1A2035', borderRadius: 10,
        border: '1px solid #1E2A3A',
        boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
        overflow: 'hidden',
      }}>
        {SESSION_TYPES.map(type => {
          const selected = type === day.type;
          const tcc = typeColors[type] || typeColors['Rest'];
          return (
            <div key={type}
              onClick={(e) => { e.stopPropagation(); onTypeChange(type); onOpen?.(); }}
              style={{
                display: 'flex', alignItems: 'center',
                padding: '10px 14px', cursor: 'pointer',
                backgroundColor: selected ? 'rgba(110,187,122,0.15)' : 'transparent',
              }}
              onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'rgba(255,255,255,0.05)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = selected ? 'rgba(110,187,122,0.15)' : 'transparent'; }}
            >
              <span style={{ fontSize: 14, fontWeight: '500', color: selected ? '#6EBB7A' : tcc.text, fontFamily: "'DM Sans', sans-serif" }}>{type}</span>
            </div>
          );
        })}
      </div>
    </>,
    document.body
  ) : null;

  return (
    <View style={{ width: (SCREEN_W - 88) / 7, alignItems: 'center' }}>
      {/* Native DOM wrapper so getBoundingClientRect() is always available on web */}
      {Platform.OS === 'web' ? (
        <div ref={domRef} style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
          {tileContent}
        </div>
      ) : tileContent}
      {portalDropdown}
      {/* Native fallback (non-web) */}
      {isOpen && isCoach && Platform.OS !== 'web' && (
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
    paddingVertical: 4, minWidth: 170, elevation: 20,
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
// Uses portal rendering to escape Modal ScrollView overflow clipping.
// IMPORTANT: Uses a native DOM div ref wrapper to reliably get getBoundingClientRect()
// on React Native Web — Pressable refs return RN component instances, not DOM nodes.
function GuidanceDropdown({ value, onChange, isOpen, onOpen }: {
  value: GuidanceLevel; onChange: (v: GuidanceLevel) => void;
  isOpen?: boolean; onOpen?: () => void;
}) {
  const domRef = useRef<HTMLDivElement | null>(null);
  const [dropPos, setDropPos] = useState<{ top: number; left: number } | null>(null);

  // Close dropdown on scroll (prevents dropdown from floating over other content)
  // We use a small delay to avoid closing immediately when the dropdown opens
  useEffect(() => {
    if (!isOpen || Platform.OS !== 'web') return;
    let active = false;
    const timer = setTimeout(() => { active = true; }, 100);
    const handleScroll = () => { if (active) onOpen?.(); }; // toggle closes it
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [isOpen]);

  const handlePress = () => {
    if (!isOpen && domRef.current && Platform.OS === 'web') {
      const rect = domRef.current.getBoundingClientRect();
      // Dropdown height estimate: 3 options * 33px each = ~100px
      const dropHeight = 110;
      // Use the smaller of window.innerHeight and document.documentElement.clientHeight
      // to handle mobile browsers where the address bar reduces visible area.
      // Also clamp so the dropdown never goes below the visible viewport.
      const vh = Math.min(
        window.innerHeight,
        document.documentElement.clientHeight,
        window.visualViewport ? window.visualViewport.height : Infinity
      );
      const spaceBelow = vh - rect.bottom;
      let top = spaceBelow >= dropHeight + 20
        ? rect.bottom + 4
        : rect.top - dropHeight - 4;
      // Hard clamp: never let dropdown go below viewport or above 0
      top = Math.max(8, Math.min(top, vh - dropHeight - 8));
      setDropPos({ top, left: rect.left });
    }
    onOpen?.();
  };

  const triggerEl = (
    <Pressable onPress={handlePress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: BG, borderWidth: 1, borderColor: isOpen ? ACCENT : BORDER, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 }}>
      <Text style={{ color: isOpen ? ACCENT : '#FFF', fontSize: 12, fontWeight: '600' }}>{GUIDANCE_SHORT[value]}</Text>
      <Icon name="chevron-down" size={12} color={isOpen ? ACCENT : MUTED} />
    </Pressable>
  );

  return (
    <View>
      {/* DOM wrapper for reliable getBoundingClientRect on React Native Web */}
      {Platform.OS === 'web' ? (
        <div ref={domRef}>{triggerEl}</div>
      ) : triggerEl}
      {/* Portal dropdown — renders at document.body to escape Modal ScrollView clipping */}
      {isOpen && Platform.OS === 'web' && dropPos && ReactDOM.createPortal(
        <>
          <div onClick={() => onOpen?.()} style={{ position: 'fixed', inset: 0, zIndex: 99998 }} />
          <div style={{
            position: 'fixed', top: dropPos.top, left: dropPos.left,
            zIndex: 99999, minWidth: 100,
            backgroundColor: '#1A2035', borderRadius: 8,
            border: '1px solid #1E2A3A',
            boxShadow: '0 4px 20px rgba(0,0,0,0.8)',
            overflow: 'hidden',
          }}>
            {guidanceLevels.map(level => (
              <div key={level}
                onClick={(e) => { e.stopPropagation(); onChange(level); onOpen?.(); }}
                style={{
                  padding: '8px 12px', cursor: 'pointer',
                  backgroundColor: level === value ? 'rgba(110,187,122,0.15)' : 'transparent',
                }}
                onMouseEnter={e => { if (level !== value) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'rgba(255,255,255,0.05)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = level === value ? 'rgba(110,187,122,0.15)' : 'transparent'; }}
              >
                <span style={{ fontSize: 12, fontWeight: '500', color: level === value ? '#6EBB7A' : '#FFF', fontFamily: "'DM Sans', sans-serif" }}>{GUIDANCE_SHORT[level]}</span>
              </div>
            ))}
          </div>
        </>,
        document.body
      )}
      {/* Native fallback (non-web) */}
      {isOpen && Platform.OS !== 'web' && (
        <View style={{
          position: 'absolute', top: 36, left: 0, zIndex: 9999,
          backgroundColor: '#1A2035', borderRadius: 8, borderWidth: 1, borderColor: BORDER,
          minWidth: 90, paddingVertical: 2, elevation: 20,
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

export function PlanView({ plan, isCoach, onChange, onAccept }: {
  plan: MemberPlanData; isCoach: boolean;
  onChange: (updates: Partial<MemberPlanData>) => void;
  onAccept?: () => void;
}) {
  const [editField, setEditField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [openDayIndex, setOpenDayIndex] = useState<number | null>(null);
  const [goalEditOpen, setGoalEditOpen] = useState(false);

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
      case 'goalWeight': updates.goalWeight = val; updates.goalWeightAutoSuggested = false; break;
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
    const updatedIncluded = (plan.whatsIncluded || []).map(item =>
      /^\d+ coaching sessions? per week$/i.test(item)
        ? `${newSessionCount} coaching sessions per week`
        : item
    );
    onChange({ weeklySchedule: newSchedule, sessionsPerWeek: newSessionCount, whatsIncluded: updatedIncluded });
  };

  // Handle sessions per week slider change
  const handleSessionsChange = (count: number) => {
    const clamped = Math.max(2, Math.min(6, count)) as SessionsPerWeek;
    const newSchedule = createDefaultSchedule(clamped);
    // Update whatsIncluded to reflect new session count
    const updatedIncluded = (plan.whatsIncluded || []).map(item =>
      /^\d+ coaching sessions? per week$/i.test(item)
        ? `${clamped} coaching sessions per week`
        : item
    );
    onChange({ sessionsPerWeek: clamped, weeklySchedule: newSchedule, whatsIncluded: updatedIncluded });
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

  const handleAddCustomGoal = (name: string, emoji: string) => {
    const goals = plan.goals || [];
    if (goals.includes(name)) return; // already exists
    const newEmojis = { ...(plan.goalEmojis || {}), [name]: emoji };
    onChange({ goals: [...goals, name], goalEmojis: newEmojis });
  };

  const handleChangeEmoji = (goalName: string, newEmoji: string) => {
    const newEmojis = { ...(plan.goalEmojis || {}), [goalName]: newEmoji };
    onChange({ goalEmojis: newEmojis });
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
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Text style={pv.sectionLabel}>YOUR HEALTH GOALS</Text>
            <Text style={pv.sectionTitle}>What we're building toward</Text>
          </View>
          {isCoach && (
            <Pressable onPress={() => setGoalEditOpen(true)} hitSlop={10} style={{ padding: 4 }}>
              <Text style={{ fontSize: 14, color: MUTED }}>✏️</Text>
            </Pressable>
          )}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
          {(plan.goals || []).map(goal => {
            const emoji = getGoalEmoji(goal, plan.goalEmojis);
            const color = getGoalColor(goal);
            return (
              <View key={goal}
                style={[pv.goalCard, {
                  backgroundColor: color + '15',
                  borderColor: color + '40',
                }]}>
                <Text style={{ fontSize: 24, marginBottom: 4 }}>{emoji}</Text>
                <Text style={{ color: color, fontSize: 13, fontWeight: '600', textAlign: 'center' }}>{goal}</Text>
              </View>
            );
          })}
        </View>

        {/* Goal selection modal (coach only) */}
        {isCoach && (
          <GoalEditModal
            visible={goalEditOpen}
            onClose={() => setGoalEditOpen(false)}
            selectedGoals={plan.goals || []}
            goalEmojis={plan.goalEmojis || {}}
            onToggle={handleGoalToggle}
            onAddCustomGoal={handleAddCustomGoal}
            onChangeEmoji={handleChangeEmoji}
          />
        )}

        {/* Weight row */}
        {(plan.currentWeight || plan.goalWeight) ? (
          <View style={[pv.card, { marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
            <View>
              <Text style={{ color: MUTED, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>CURRENT</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ color: '#FFF', fontSize: 22, fontWeight: '700', fontFamily: FH }}>{plan.currentWeight || '—'}</Text>
                {isCoach && <PencilBtn onPress={() => openEdit('currentWeight', String(plan.currentWeight ?? ''))} />}
              </View>
            </View>
            <Text style={{ color: MUTED, fontSize: 20 }}>→</Text>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: MUTED, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>GOAL</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ color: ACCENT, fontSize: 22, fontWeight: '700', fontFamily: FH }}>{plan.goalWeight || '—'}</Text>
                {isCoach && <PencilBtn onPress={() => openEdit('goalWeight', plan.goalWeight || '')} />}
              </View>
              {/* Auto-suggested badge: shown only to coaches when the value was
                  calculated from intake data rather than entered by the member */}
              {isCoach && plan.goalWeightAutoSuggested && (
                <Text style={{ color: '#F5A623', fontSize: 10, fontStyle: 'italic', marginTop: 2 }}>
                  Auto-suggested — please review
                </Text>
              )}
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

          {/* No-show grace period (coach only) */}
          {isCoach && (
            <View style={{ marginBottom: 16, padding: 12, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 10 }}>
              <Text style={{ color: MUTED, fontSize: 12, marginBottom: 8 }}>No-show grace period (minutes)</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {[10, 15, 20, 30].map(mins => (
                  <Pressable
                    key={mins}
                    onPress={() => onChange({ noShowGraceMinutes: mins })}
                    style={{
                      paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6,
                      backgroundColor: (plan.noShowGraceMinutes || 15) === mins ? ACCENT : 'rgba(255,255,255,0.06)',
                    }}
                  >
                    <Text style={{
                      color: (plan.noShowGraceMinutes || 15) === mins ? '#000' : MUTED,
                      fontSize: 13, fontWeight: '600',
                    }}>{mins} min</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={{ color: '#4A5568', fontSize: 10, marginTop: 6, fontStyle: 'italic' }}>
                Member marked no-show if they don't join within this window. Overrides coach-level setting for this plan.
              </Text>
            </View>
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

      {/* ─── COACHING INVESTMENT (unified section) ──────────────────────── */}
      {/* Show the section if:
           - pricing is visible (showInvestment !== false), OR
           - the viewer is a coach (always show), OR
           - there are enabled add-on cards (CTS / Nutrition) to show even when
             the main pricing numbers are hidden from the member */}
      {pricing && (
        (plan.showInvestment !== false || isCoach ||
          (plan.commitToSave?.enabled ?? false) ||
          (plan.nutrition?.enabled ?? false) ||
          (plan.postContract?.enabled ?? false)
        ) && (
          <CoachingInvestmentSection plan={plan} pricing={pricing} isCoach={isCoach} onChange={onChange} />
        )
      )}

      {/* ─── PLAN ACCEPTANCE + PAYMENT OPTIONS (visible to both coach and member) ──────── */}
      <InlinePaymentSection plan={plan} pricing={pricing} isCoach={isCoach} onChange={onChange} onAccept={onAccept} />

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

// ─── GoalEditModal (coach picks which goals are selected + custom goals + emoji editing) ───
const COMMON_EMOJIS = ['😊','🔥','💪','🏃','🧘','😴','⚡','🤸','🚀','❤️‍🩹','💚','🏋️','⚖️','📈','🏆','🎯','🌟','🧠','💎','🌈','🎯','🏅','💥','🦾','🫀','🩺','🥗','🧬','🌱','🏔️'];

function GoalEditModal({ visible, onClose, selectedGoals, goalEmojis, onToggle, onAddCustomGoal, onChangeEmoji }: {
  visible: boolean; onClose: () => void;
  selectedGoals: string[]; goalEmojis: Record<string, string>;
  onToggle: (goal: string) => void;
  onAddCustomGoal: (name: string, emoji: string) => void;
  onChangeEmoji: (goalName: string, newEmoji: string) => void;
}) {
  const [customName, setCustomName] = useState('');
  const [customEmoji, setCustomEmoji] = useState('🎯');
  const [showAddForm, setShowAddForm] = useState(false);
  const [emojiPickerGoal, setEmojiPickerGoal] = useState<string | null>(null);

  if (!visible) return null;

  // Build the full list: allKnownGoals + any custom goals already in selectedGoals
  const allGoals = [...allKnownGoals];
  selectedGoals.forEach(g => { if (!allGoals.includes(g)) allGoals.push(g); });

  const handleAddCustom = () => {
    const name = customName.trim();
    if (!name) return;
    onAddCustomGoal(name, customEmoji);
    setCustomName('');
    setCustomEmoji('🎯');
    setShowAddForm(false);
  };

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <Pressable style={gem.overlay} onPress={onClose}>
        <Pressable style={gem.sheet} onPress={e => e.stopPropagation()}>
          <ScrollView style={{ maxHeight: Dimensions.get('window').height * 0.7 }} showsVerticalScrollIndicator={false}>
            <View style={gem.header}>
              <Text style={gem.title}>Edit Health Goals</Text>
              <Pressable onPress={onClose} hitSlop={8}>
                <Text style={{ color: MUTED, fontSize: 18 }}>✕</Text>
              </Pressable>
            </View>
            <Text style={{ color: MUTED, fontSize: 13, marginBottom: 16 }}>Tap card to select/deselect · Tap ✎ to change emoji</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {allGoals.map(goal => {
                const emoji = getGoalEmoji(goal, goalEmojis);
                const color = getGoalColor(goal);
                const isSelected = selectedGoals.includes(goal);
                const pickerOpen = emojiPickerGoal === goal;
                return (
                  <View key={goal} style={{ position: 'relative' as const }}>
                    <Pressable onPress={() => onToggle(goal)}
                      style={[gem.goalCard, {
                        backgroundColor: isSelected ? color + '15' : '#161B25',
                        borderColor: isSelected ? color + '40' : BORDER,
                        opacity: !isSelected ? 0.5 : 1,
                      }]}>
                      <Text style={{ fontSize: 22, marginBottom: 2 }}>{emoji}</Text>
                      <Text style={{ color: isSelected ? color : MUTED, fontSize: 12, fontWeight: '600', textAlign: 'center' }}>{goal}</Text>
                    </Pressable>
                    {/* Small edit-emoji button in top-right corner */}
                    <Pressable
                      onPress={() => setEmojiPickerGoal(pickerOpen ? null : goal)}
                      style={{ position: 'absolute', top: 2, right: 2, width: 20, height: 20, borderRadius: 10, backgroundColor: '#1E2535', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
                      <Text style={{ fontSize: 9, color: MUTED }}>✎</Text>
                    </Pressable>
                    {pickerOpen && (
                      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER, padding: 8, zIndex: 100 }}>
                        <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '600', marginBottom: 6 }}>Pick emoji:</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                          {COMMON_EMOJIS.map((e, idx) => (
                            <Pressable key={idx} onPress={() => { onChangeEmoji(goal, e); setEmojiPickerGoal(null); }}
                              style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 6, backgroundColor: emoji === e ? ACCENT + '30' : 'transparent' }}>
                              <Text style={{ fontSize: 16 }}>{e}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>

            {/* Add Custom Goal */}
            {!showAddForm ? (
              <Pressable onPress={() => setShowAddForm(true)} style={{ marginTop: 16, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: ACCENT + '40', borderStyle: 'dashed', alignItems: 'center' }}>
                <Text style={{ color: ACCENT, fontSize: 13, fontWeight: '600' }}>+ Add Custom Goal</Text>
              </Pressable>
            ) : (
              <View style={{ marginTop: 16, backgroundColor: '#161B25', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: BORDER }}>
                <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '600', marginBottom: 8 }}>New Custom Goal</Text>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                  <Pressable onPress={() => {
                    const idx = COMMON_EMOJIS.indexOf(customEmoji);
                    setCustomEmoji(COMMON_EMOJIS[(idx + 1) % COMMON_EMOJIS.length]);
                  }} style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 22 }}>{customEmoji}</Text>
                  </Pressable>
                  <TextInput
                    value={customName}
                    onChangeText={setCustomName}
                    placeholder="Goal name..."
                    placeholderTextColor={MUTED}
                    style={{ flex: 1, color: '#FFF', fontSize: 14, backgroundColor: CARD, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: BORDER }}
                  />
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable onPress={() => setShowAddForm(false)} style={{ flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: '#1E2433', alignItems: 'center' }}>
                    <Text style={{ color: MUTED, fontSize: 13, fontWeight: '600' }}>Cancel</Text>
                  </Pressable>
                  <Pressable onPress={handleAddCustom} style={{ flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: ACCENT, alignItems: 'center' }}>
                    <Text style={{ color: '#000', fontSize: 13, fontWeight: '700' }}>Add</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </ScrollView>
          <Pressable style={gem.doneBtn} onPress={onClose}>
            <Text style={gem.doneBtnText}>Done</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
const gem = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: CARD, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { fontSize: 17, fontWeight: '700', color: '#FFF', fontFamily: Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold' },
  goalCard: {
    width: (Dimensions.get('window').width - 80) / 2 - 5, paddingVertical: 12, paddingHorizontal: 10,
    borderRadius: 12, borderWidth: 1, alignItems: 'center' as const,
  },
  doneBtn: { backgroundColor: ACCENT, paddingVertical: 14, borderRadius: 12, alignItems: 'center' as const, marginTop: 20 },
  doneBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
});

// ═══════════════════════════════════════════════════════════════════════════════
// COACHING INVESTMENT SECTION (unified: pricing cards + add-ons + breakdown)
// Matches the Hunter reference design: two pricing cards, stats row,
// interactive Commit to Save and Nutrition Add-On cards, breakdown accordion.
// ═══════════════════════════════════════════════════════════════════════════════

const GOLD = '#F5A623';
const GOLD_BG = 'rgba(245,166,35,0.12)';
const GOLD_BORDER = 'rgba(245,166,35,0.5)';
const GREEN_BORDER = 'rgba(110,187,122,0.5)';

// ─── Inline Payment Options (replaces separate payment-select page) ──────────
type PaymentOption = 'monthly' | 'pay_in_full';

function InlinePaymentSection({ plan, pricing, isCoach, onChange, onAccept }: {
  plan: MemberPlanData; pricing: PricingResult | null; isCoach: boolean;
  onChange: (updates: Partial<MemberPlanData>) => void;
  onAccept?: () => void;
}) {
  const [selected, setSelected] = useState<PaymentOption | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [copyLinkLoading, setCopyLinkLoading] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();

  // Coach-only: generate Stripe checkout URL and copy to clipboard
  async function handleCopyPaymentLink() {
    if (!selected || !user) return;
    const planId = plan.id;
    if (!planId) { setError('Plan ID not found.'); return; }
    setCopyLinkLoading(true);
    setError(null);
    try {
      const functions = getFunctions();
      const createCheckout = httpsCallable<
        { planId: string; memberId: string; paymentOption: PaymentOption },
        { sessionUrl: string; intentId: string; snapshotId: string }
      >(functions, 'createCheckoutSession');
      const result = await createCheckout({
        planId,
        memberId: plan.memberId,
        paymentOption: selected,
      });
      const { sessionUrl } = result.data;
      if (sessionUrl && Platform.OS === 'web' && navigator.clipboard) {
        await navigator.clipboard.writeText(sessionUrl);
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 3000);
      } else if (sessionUrl) {
        // Native fallback — alert the URL so coach can copy manually
        if (typeof alert !== 'undefined') alert(sessionUrl);
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 3000);
      } else {
        setError('No checkout URL returned. Please try again.');
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes('not-found') || msg.includes('NOT_FOUND')) {
        setError('ME-001: Payment system is not yet configured.');
      } else if (msg.includes('failed-precondition') || msg.includes('FAILED_PRECONDITION')) {
        setError(msg.replace('FAILED_PRECONDITION: ', ''));
      } else {
        setError(msg);
      }
    } finally {
      setCopyLinkLoading(false);
    }
  }

  // Pricing calculations (same as payment-select.tsx)
  const contractMonths = plan.contractMonths ?? 12;
  const pr = (plan as any)?.pricingResult;
  const cp = plan.continuationPricing;

  const displayMonthlyPrice = Math.round(
    pricing?.displayMonthlyPrice ??
    pr?.displayMonthlyPrice ??
    (plan as any)?.monthlyPriceOverride ??
    pr?.calculatedMonthlyPrice ??
    0
  );
  const contractTotal = displayMonthlyPrice * contractMonths;
  const payInFullTotal = Math.round(contractTotal * 0.9);
  const payInFullMonthly = Math.round(payInFullTotal / contractMonths);
  const payInFullSavings = contractTotal - payInFullTotal;

  const continuationMonthly = Math.round(
    (cp as any)?.continuationMonthlyPrice ?? pr?.continuationMonthly ?? 0
  );
  const hasCTS = plan.pricing?.commitToSave === true || plan.postContract?.ctsMonthlySavings != null;
  const ctsSavings = plan.postContract?.ctsMonthlySavings ?? Math.round(continuationMonthly * 0.5);
  const ctsAfterPif = hasCTS ? Math.round(continuationMonthly - ctsSavings) : continuationMonthly;

  // Handle checkout (calls createCheckoutSession CF)
  async function handleProceed() {
    if (!selected || !user) return;
    const planId = plan.id;
    if (!planId) { setError('Plan ID not found.'); return; }
    setCheckoutLoading(true);
    setError(null);
    try {
      const functions = getFunctions();
      const createCheckout = httpsCallable<
        { planId: string; memberId: string; paymentOption: PaymentOption },
        { sessionUrl: string; intentId: string; snapshotId: string }
      >(functions, 'createCheckoutSession');
      const result = await createCheckout({
        planId,
        memberId: plan.memberId,
        paymentOption: selected,
      });
      const { sessionUrl } = result.data;
      if (sessionUrl) {
        if (Platform.OS === 'web') {
          window.location.href = sessionUrl;
        } else {
          const Linking = require('expo-linking');
          await Linking.openURL(sessionUrl);
        }
      } else {
        setError('No checkout URL returned. Please try again.');
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes('not-found') || msg.includes('NOT_FOUND')) {
        setError('ME-001: Payment system is not yet configured. Please contact your coach.');
      } else if (msg.includes('permission-denied') || msg.includes('PERMISSION_DENIED')) {
        setError('Only the member can complete checkout. Share this plan link with your member to proceed.');
      } else if (msg.includes('failed-precondition') || msg.includes('FAILED_PRECONDITION')) {
        setError(msg.replace('FAILED_PRECONDITION: ', ''));
      } else {
        setError(msg);
      }
    } finally {
      setCheckoutLoading(false);
    }
  }

  // Don't show for active plans
  if (plan.status === 'active') return null;

  // Pre-acceptance: show Accept Plan button
  if (plan.status === 'presented' || plan.status === 'pending' || plan.status === 'draft') {
    return (
      <View style={{ marginTop: 20, marginBottom: 20, paddingHorizontal: 16 }}>
        <Text style={{ fontSize: 11, fontWeight: '700', color: '#5B9BD5', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>PLAN ACCEPTANCE</Text>
        <View style={{ backgroundColor: '#161B25', borderWidth: 1, borderColor: '#2A3347', borderRadius: 12, padding: 14 }}>
          <Text style={{ color: '#C5CDD8', fontSize: 14, lineHeight: 22 }}>
            {isCoach
              ? 'When your member is ready, they will accept the plan and choose a payment option below.'
              : 'Your coach has prepared this personalized fitness plan for you. Please review all the details. If you\'re ready to commit, accept the plan below.'}
          </Text>
          <Pressable
            onPress={() => {
              // Both coach and member: update status to 'accepted' to reveal payment options
              onChange({ status: 'accepted' } as any);
            }}
            style={{ backgroundColor: '#6EBB7A', paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 20 }}
          >
            <Text style={{ color: '#000', fontSize: 16, fontWeight: '700' }}>Accept Plan</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Post-acceptance: show payment options (same UI as payment-select.tsx)
  if (plan.status === 'accepted') {
    return (
      <View style={{ marginTop: 20, marginBottom: 20, paddingHorizontal: 16 }}>
        <Text style={{ fontSize: 11, fontWeight: '700', color: '#5B9BD5', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>CHOOSE YOUR PAYMENT</Text>

        <Text style={{ color: '#FFF', fontSize: 20, fontWeight: '700', fontFamily: FH, textAlign: 'center', marginBottom: 4 }}>You're one step away.</Text>
        <Text style={{ color: MUTED, fontSize: 13, textAlign: 'center', lineHeight: 18, marginBottom: 14 }}>
          {`${contractMonths}-month contract · ${plan.sessionsPerWeek || 3}x/week · Continues month-to-month after`}
        </Text>

        {/* Option: Monthly */}
        <Pressable
          onPress={() => setSelected('monthly')}
          style={[ips.optionCard, selected === 'monthly' && ips.optionCardSelected]}
        >
          <View style={ips.optionHeader}>
            <View style={ips.optionRadio}>
              {selected === 'monthly' && <View style={ips.optionRadioDot} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={ips.optionTitle}>Monthly</Text>
              <Text style={ips.optionSubtitle}>Flexible · Cancel after contract ends</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={ips.optionPrice}>{formatCurrency(displayMonthlyPrice)}</Text>
              <Text style={ips.optionPriceSuffix}>/mo</Text>
            </View>
          </View>
          <View style={ips.optionDetail}>
            <View style={ips.detailRow}>
              <Text style={ips.detailLabel}>Contract total</Text>
              <Text style={ips.detailValue}>{formatCurrency(contractTotal)}</Text>
            </View>
            <View style={ips.detailRow}>
              <Text style={ips.detailLabel}>After contract</Text>
              <Text style={ips.detailValue}>{formatCurrency(continuationMonthly)}/mo</Text>
            </View>
            {hasCTS && (
              <View style={ips.detailRow}>
                <Text style={ips.detailLabel}>With Commit to Save</Text>
                <Text style={[ips.detailValue, { color: ACCENT }]}>{formatCurrency(ctsAfterPif)}/mo</Text>
              </View>
            )}
          </View>
        </Pressable>

        {/* Option: Pay in Full */}
        <Pressable
          onPress={() => setSelected('pay_in_full')}
          style={[ips.optionCard, selected === 'pay_in_full' && ips.optionCardSelectedGold, { marginTop: 10 }]}
        >
          <View style={ips.optionHeader}>
            <View style={[ips.optionRadio, { borderColor: GOLD }]}>
              {selected === 'pay_in_full' && <View style={[ips.optionRadioDot, { backgroundColor: GOLD }]} />}
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={ips.optionTitle}>Pay in Full</Text>
                <View style={{ paddingHorizontal: 8, paddingVertical: 2, backgroundColor: GOLD_BG, borderRadius: 10, borderWidth: 1, borderColor: GOLD_BORDER }}>
                  <Text style={{ color: GOLD, fontSize: 10, fontWeight: '700' }}>10% OFF</Text>
                </View>
              </View>
              <Text style={ips.optionSubtitle}>One payment · Best value</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[ips.optionPrice, { color: GOLD }]}>{formatCurrency(payInFullMonthly)}</Text>
              <Text style={ips.optionPriceSuffix}>/mo</Text>
            </View>
          </View>
          <View style={ips.optionDetail}>
            <View style={ips.detailRow}>
              <Text style={ips.detailLabel}>One payment today</Text>
              <Text style={[ips.detailValue, { color: '#FFF', fontWeight: '700' }]}>{formatCurrency(payInFullTotal)}</Text>
            </View>
            <View style={ips.detailRow}>
              <Text style={ips.detailLabel}>You save</Text>
              <Text style={[ips.detailValue, { color: ACCENT }]}>{formatCurrency(payInFullSavings)}</Text>
            </View>
            <View style={ips.detailRow}>
              <Text style={ips.detailLabel}>After contract</Text>
              <Text style={ips.detailValue}>{formatCurrency(continuationMonthly)}/mo</Text>
            </View>
            {hasCTS && (
              <View style={ips.detailRow}>
                <Text style={ips.detailLabel}>With CTS + PIF</Text>
                <Text style={[ips.detailValue, { color: ACCENT }]}>{formatCurrency(ctsAfterPif)}/mo</Text>
              </View>
            )}
          </View>
        </Pressable>



        {/* Error */}
        {error && (
          <View style={{ padding: 12, backgroundColor: 'rgba(224,82,82,0.08)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(224,82,82,0.25)', marginTop: 10 }}>
            <Text style={{ color: '#E05252', fontSize: 12, lineHeight: 18 }}>{error}</Text>
          </View>
        )}

        {/* CTA */}
        <Pressable
          onPress={handleProceed}
          disabled={!selected || checkoutLoading}
          style={[ips.ctaBtn, (!selected || checkoutLoading) && { opacity: 0.5 }]}
        >
          {checkoutLoading ? (
            <ActivityIndicator size="small" color="#000" />
          ) : (
            <Text style={ips.ctaBtnText}>
              {selected === 'pay_in_full'
                ? `Pay ${formatCurrency(payInFullTotal)} Now`
                : selected === 'monthly'
                ? `Start at ${formatCurrency(displayMonthlyPrice)}/mo`
                : 'Select a payment option'}
            </Text>
          )}
        </Pressable>



        {/* Fine print */}
        <Text style={{ color: '#4A5568', fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 10 }}>
          Payments are processed securely by Stripe. By proceeding you agree to the GoArrive coaching terms. You may cancel month-to-month continuation at any time after your contract ends.
        </Text>
      </View>
    );
  }

  return null;
}

const ips = StyleSheet.create({
  optionCard: {
    backgroundColor: '#161B25',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#2A3347',
  },
  optionCardSelected: { borderColor: '#5B9BD5' },
  optionCardSelectedGold: { borderColor: '#F5A623' },
  optionHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  optionRadio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: '#5B9BD5',
    alignItems: 'center', justifyContent: 'center',
  },
  optionRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#5B9BD5' },
  optionTitle: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  optionSubtitle: { color: '#7A8A9A', fontSize: 12, marginTop: 1 },
  optionPrice: { color: '#FFF', fontSize: 20, fontWeight: '700' },
  optionPriceSuffix: { color: '#7A8A9A', fontSize: 11 },
  optionDetail: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#2A3347',
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  detailLabel: { color: '#7A8A9A', fontSize: 12 },
  detailValue: { color: '#7A8A9A', fontSize: 12 },
  ctaBtn: {
    backgroundColor: '#F5A623',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  ctaBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
  copyLinkBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    borderWidth: 1.5,
    borderColor: '#5B9BD5',
    backgroundColor: 'transparent',
  },
  copyLinkText: { color: '#5B9BD5', fontSize: 14, fontWeight: '700' },
});

function CoachingInvestmentSection({ plan, pricing, isCoach, onChange }: {
  plan: MemberPlanData; pricing: PricingResult; isCoach: boolean;
  onChange: (updates: Partial<MemberPlanData>) => void;
}) {
  const hidden = plan.showInvestment === false;
  const cts = plan.commitToSave;
  const nut = plan.nutrition;
  const ctsEnabled = cts?.enabled ?? false; // coach enabled it as an option
  const ctsActive = cts?.active ?? false;    // member (or coach) toggled it on
  const nutEnabled = nut?.enabled ?? false;  // coach enabled it as an option
  const nutActive = nut?.active ?? false;     // member (or coach) toggled it on
  // When investment is hidden, only the pricing numbers are suppressed.
  // Commit to Save and Nutrition add-on cards have their own separate `enabled`
  // flags and must still render for members when the coach has enabled them.
  const hasVisibleAddOns = ctsEnabled || nutEnabled;
  if (hidden && !isCoach && !hasVisibleAddOns) return null;

  // Compute prices with and without add-ons for display
  const baseMonthly = pricing.baseMonthlyPrice; // before commit-to-save
  const ctsSavings = cts?.monthlySavings ?? 100;
  const nutCost = nut?.monthlyCost ?? 100;

  // The displayMonthlyPrice already includes commit-to-save if active
  const monthlyPrice = pricing.displayMonthlyPrice;
  const payInFullTotal = pricing.payInFullPrice;
  const payInFullMonthly = Math.round(payInFullTotal / (plan.contractMonths || 12));
  const payInFullSavings = Math.round(monthlyPrice * (plan.contractMonths || 12) - payInFullTotal);
  const payInFullPct = plan.payInFullDiscountPercent || 10;

  const totalSessions = pricing.totalSessions;
  const perSession = pricing.perSessionPrice;
  const programTotal = Math.round(monthlyPrice * (plan.contractMonths || 12));

  // Toggle commit to save active state
  const toggleCommitToSave = () => {
    onChange({
      commitToSave: {
        ...(cts || { monthlySavings: 100, nextMonthPercentOff: 5, missedSessionFee: 50, makeUpWindowHours: 48, emergencyWaiverEnabled: true, reentryRule: '', summary: '', enabled: true }),
        active: !ctsActive,
      },
    });
  };

  // Toggle nutrition active state (member adds/removes)
  const toggleNutrition = () => {
    if (!nut) return;
    onChange({
      nutrition: {
        ...nut,
        active: !nutActive,
      },
    });
  };

  return (
    <View style={pv.section}>
      <Text style={pv.sectionLabel}>COACHING INVESTMENT</Text>

      {hidden && isCoach && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10, padding: 8, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
          <Text style={{ color: MUTED, fontSize: 12, fontStyle: 'italic' }}>Investment hidden from member</Text>
        </View>
      )}

      {/* ── Two pricing cards side by side ── */}
      {(!hidden || isCoach) && <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
        {/* Monthly card */}
        <View style={[inv.priceCard, { flex: 1 }]}>
          <Text style={inv.priceLabel}>MONTHLY</Text>
          <Text style={inv.priceAmount}>{formatCurrency(monthlyPrice)}<Text style={inv.priceSuffix}> /mo</Text></Text>
          <Text style={inv.priceDetail}>{formatCurrency(perSession)} per session</Text>
        </View>
        {/* Pay in Full card */}
        <View style={[inv.priceCard, { flex: 1, borderColor: GOLD_BORDER }]}>
          <Text style={[inv.priceLabel, { color: GOLD }]}>PAY IN FULL</Text>
          <Text style={inv.priceAmount}>{formatCurrency(payInFullMonthly)}<Text style={inv.priceSuffix}> /mo</Text></Text>
          <Text style={{ color: MUTED, fontSize: 11, marginTop: 2 }}>{formatCurrency(payInFullTotal)} total</Text>
          <Text style={{ color: ACCENT, fontSize: 12, fontWeight: '600', marginTop: 2 }}>Save {formatCurrency(payInFullSavings)} ({payInFullPct}% off)</Text>
        </View>
      </View>}
      {/* ── Stats row ── */}
      {(!hidden || isCoach) && <View style={[inv.statsRow]}>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={inv.statsLabel}>SESSIONS</Text>
          <Text style={inv.statsValue}>{totalSessions}</Text>
          <Text style={inv.statsDetail}>over {plan.contractMonths} months</Text>
        </View>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={inv.statsLabel}>PER SESSION</Text>
          <Text style={[inv.statsValue, { color: GOLD }]}>{formatCurrency(perSession)}</Text>
          <Text style={inv.statsDetail}>effective rate</Text>
        </View>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={inv.statsLabel}>PROGRAM</Text>
          <Text style={[inv.statsValue, { color: ACCENT }]}>{formatCurrency(programTotal)}</Text>
          <Text style={inv.statsDetail}>total value</Text>
        </View>
      </View>}

      {/* ── Commit to Save card ── */}
      {(ctsEnabled || isCoach) && (
        <CommitToSaveCard
          plan={plan}
          isCoach={isCoach}
          isActive={ctsActive}
          onToggle={toggleCommitToSave}
          monthlyPrice={monthlyPrice}
          ctsSavings={ctsSavings}
        />
      )}

      {/* ── Nutrition Add-On card ── */}
      {(nutEnabled || (isCoach && nut)) && (
        <NutritionAddOnCard
          plan={plan}
          isCoach={isCoach}
          isActive={nutActive}
          onToggle={toggleNutrition}
          monthlyPrice={monthlyPrice}
          nutCost={nutCost}
          payInFullMonthly={payInFullMonthly}
        />
      )}

      {/* ── How we got these numbers (coach only) ── */}
      {(!hidden || isCoach) && <HowWeGotTheseNumbers plan={plan} pricing={pricing} isCoach={isCoach} />}

      {/* ── Referral Rewards ── */}
      {(!hidden || isCoach) && <View style={[inv.statsRow, { marginTop: 12, paddingVertical: 14, paddingHorizontal: 16 }]}>
        <Text style={{ color: MUTED, fontSize: 13, lineHeight: 19, textAlign: 'center' }}>
          <Text style={{ color: GOLD, fontWeight: '700' }}>Referral Rewards: </Text>
          Invite 3 friends into a yearly plan and your base membership is refunded.
        </Text>
      </View>}

      {/* ── Post-Contract Ongoing Support card ── */}
      {(plan.postContract?.enabled || isCoach) && (
        <PostContractCard
          plan={plan}
          isCoach={isCoach}
          sessionsPerMonth={Math.round((plan.sessionsPerWeek || 3) * (52 / 12))}
          coachId={plan.coachId ?? ''}
        />
      )}

      {/* ── After Contract / Continuation card ── */}
      {(plan.continuationPricing?.continuationEnabled !== false || isCoach) && (
        <ContinuationCard
          plan={plan}
          isCoach={isCoach}
          sessionsPerMonth={Math.round((plan.sessionsPerWeek || 3) * (52 / 12))}
          coachId={plan.coachId ?? ''}
        />
      )}
    </View>
  );
}

// ── Commit to Save interactive card ─────────────────────────────────────────
function CommitToSaveCard({ plan, isCoach, isActive, onToggle, monthlyPrice, ctsSavings }: {
  plan: MemberPlanData; isCoach: boolean; isActive: boolean;
  onToggle: () => void; monthlyPrice: number; ctsSavings: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const cts = plan.commitToSave;
  const rateAfter = monthlyPrice; // displayMonthlyPrice already includes CTS if active
  // If active, the rate shown is the current displayMonthlyPrice
  // If not active, the rate after adding would be monthlyPrice - ctsSavings
  const rateWithCts = isActive ? monthlyPrice : monthlyPrice - ctsSavings;

  return (
    <View style={[inv.addonCard, isActive && { borderColor: GOLD_BORDER, backgroundColor: GOLD_BG }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        {/* Icon */}
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: isActive ? GOLD : 'rgba(245,166,35,0.15)', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 16 }}>💡</Text>
        </View>
        {/* Content */}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '700', fontFamily: FH }}>Commit to Save</Text>
            <Pressable onPress={onToggle} style={[inv.addBtn, isActive && inv.addBtnActive]}>
              {isActive ? (
                <Text style={{ color: ACCENT, fontSize: 13, fontWeight: '600' }}>✓ Added</Text>
              ) : (
                <Text style={{ color: MUTED, fontSize: 13, fontWeight: '600' }}>Add</Text>
              )}
            </Pressable>
          </View>
          <Text style={{ color: GOLD, fontSize: 12, marginTop: 2 }}>
            Consistency reward · −{formatCurrency(ctsSavings)}/mo
          </Text>
          <Text style={{ color: MUTED, fontSize: 13, lineHeight: 19, marginTop: 6 }}>
            Save {formatCurrency(ctsSavings)} per month when you commit to showing up consistently.
          </Text>
          <Pressable onPress={() => setExpanded(!expanded)} style={{ marginTop: 6 }}>
            <Text style={{ color: PRIMARY, fontSize: 13, fontWeight: '600' }}>
              {expanded ? 'Hide details ▴' : 'How it works ▾'}
            </Text>
          </Pressable>
          {expanded && (
            <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: BORDER }}>
              <Text style={inv.detailLine}>→  Commit to Save lowers your monthly rate by {formatCurrency(ctsSavings)} while it's active.</Text>
              <Text style={inv.detailLine}>→  Complete a 30-day streak and unlock an additional {cts?.nextMonthPercentOff || 5}% discount on the following month.</Text>
              <Text style={inv.detailLine}>→  If you miss a session without making it up within {cts?.makeUpWindowHours || 48} hours, a {formatCurrency(cts?.missedSessionFee || 50)} accountability fee applies.</Text>
              <Text style={inv.detailLine}>→  Fees are waived for family emergencies or illness.</Text>
              <Text style={inv.detailLine}>→  You can opt out at any time.</Text>
              <Text style={inv.detailLine}>→  If you opt out, you can re-enter at the start of the next year.</Text>
              <View style={{ marginTop: 10, padding: 12, backgroundColor: 'rgba(245,166,35,0.08)', borderRadius: 8, borderWidth: 1, borderColor: 'rgba(245,166,35,0.2)' }}>
                <Text style={{ color: GOLD, fontSize: 12, lineHeight: 18, fontStyle: 'italic' }}>
                  This is a commitment reward system built to help you follow through on what you already said you want to do. Best for highly committed members who want to save.
                </Text>
              </View>
            </View>
          )}
        </View>
      </View>
      {/* Summary row when active */}
      {isActive && (
        <View style={{ flexDirection: 'row', marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(245,166,35,0.2)' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: GOLD, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>YOU SAVE</Text>
            <Text style={{ color: '#FFF', fontSize: 22, fontWeight: '700', fontFamily: FH }}>{formatCurrency(ctsSavings)}<Text style={{ fontSize: 13, color: MUTED }}>/mo</Text></Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: GOLD, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>YOUR RATE</Text>
            <Text style={{ color: '#FFF', fontSize: 22, fontWeight: '700', fontFamily: FH }}>{formatCurrency(rateAfter)}<Text style={{ fontSize: 13, color: MUTED }}>/mo</Text></Text>
          </View>
        </View>
      )}
    </View>
  );
}

// ── Nutrition Add-On interactive card ───────────────────────────────────────
function NutritionAddOnCard({ plan, isCoach, isActive, onToggle, monthlyPrice, nutCost, payInFullMonthly }: {
  plan: MemberPlanData; isCoach: boolean; isActive: boolean;
  onToggle: () => void; monthlyPrice: number; nutCost: number; payInFullMonthly: number;
}) {
  const nut = plan.nutrition;
  const providerName = nut?.providerName || 'Partner';
  const description = nut?.description || 'Add personalized nutrition coaching to your plan. Includes a custom nutrition strategy, macro targets, and monthly check-ins to keep your eating aligned with your training goals.';
  // When nutrition is active, the price already includes it
  // When toggled on, new monthly = current + nutCost
  const newMonthly = isActive ? monthlyPrice : monthlyPrice + nutCost;
  const newPayInFull = Math.round(newMonthly * (plan.contractMonths || 12) * (1 - (plan.payInFullDiscountPercent || 10) / 100) / (plan.contractMonths || 12));

  return (
    <View style={[inv.addonCard, isActive && { borderColor: GREEN_BORDER, backgroundColor: 'rgba(110,187,122,0.08)' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        {/* Icon */}
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: isActive ? ACCENT : 'rgba(110,187,122,0.15)', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 16 }}>🥗</Text>
        </View>
        {/* Content */}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '700', fontFamily: FH }}>Nutrition Add-On</Text>
            <Pressable onPress={onToggle} style={[inv.addBtn, isActive && { borderColor: GREEN_BORDER, backgroundColor: 'rgba(110,187,122,0.1)' }]}>
              {isActive ? (
                <Text style={{ color: ACCENT, fontSize: 13, fontWeight: '600' }}>✓ Added</Text>
              ) : (
                <Text style={{ color: MUTED, fontSize: 13, fontWeight: '600' }}>Add</Text>
              )}
            </Pressable>
          </View>
          <Text style={{ color: ACCENT, fontSize: 12, marginTop: 2 }}>
            With {providerName} · +{formatCurrency(nutCost)}/mo
          </Text>
          <Text style={{ color: MUTED, fontSize: 13, lineHeight: 19, marginTop: 6 }}>
            {description}
          </Text>
        </View>
      </View>
      {/* Summary row when active */}
      {isActive && (
        <View style={{ flexDirection: 'row', marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(110,187,122,0.2)' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: ACCENT, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>NEW MONTHLY</Text>
            <Text style={{ color: '#FFF', fontSize: 22, fontWeight: '700', fontFamily: FH }}>{formatCurrency(newMonthly)}<Text style={{ fontSize: 13, color: MUTED }}>/mo</Text></Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: ACCENT, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>PAY IN FULL</Text>
            <Text style={{ color: '#FFF', fontSize: 22, fontWeight: '700', fontFamily: FH }}>{formatCurrency(newPayInFull)}<Text style={{ fontSize: 13, color: MUTED }}>/mo</Text></Text>
          </View>
        </View>
      )}
    </View>
  );
}

// ── Post-Contract Ongoing Support card ─────────────────────────────────────
function PostContractCard({ plan, isCoach, sessionsPerMonth, coachId }: {
  plan: MemberPlanData; isCoach: boolean; sessionsPerMonth: number; coachId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [ctsModalVisible, setCtsModalVisible] = useState(false);
  const pc = plan.postContract;
  const hourlyRate = pc?.hourlyRate ?? plan.hourlyRate ?? 100;
  const sessionMinutes = pc?.sessionMinutes ?? 3.5;
  const nutCost = pc?.nutritionMonthlyCost ?? 25;
  const nutEnabled = plan.nutrition?.enabled ?? false;

  // Monthly rate = hourlyRate × (sessionMinutes ÷ 60) × sessionsPerMonth
  const monthlyRate = Math.round(hourlyRate * (sessionMinutes / 60) * sessionsPerMonth);
  const yearlyRate = monthlyRate * 12;
  // Pay-in-full: 10% off yearly
  const payInFullMonthly = Math.round(yearlyRate * 0.9 / 12);
  const payInFullSavings = Math.round(yearlyRate - yearlyRate * 0.9);
  // Commit to Save: use coach override if set, otherwise half off monthly
  const ctsMonthly = pc?.ctsMonthlySavings != null ? pc.ctsMonthlySavings : Math.round(monthlyRate * 0.5);
  // Nutrition add-on
  const withNutMonthly = monthlyRate + nutCost;

  return (
    <View style={[inv.addonCard, { borderColor: 'rgba(91,155,213,0.4)', backgroundColor: 'rgba(91,155,213,0.05)', marginTop: 12 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        {/* Icon */}
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(91,155,213,0.2)', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 16 }}>🔄</Text>
        </View>
        {/* Content */}
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '700', fontFamily: FH }}>Ongoing Support</Text>
          <Text style={{ color: PRIMARY, fontSize: 12, marginTop: 2 }}>After your contract · Month-to-month</Text>
          <Text style={{ color: MUTED, fontSize: 13, lineHeight: 19, marginTop: 6 }}>
            You've built the foundation. Ongoing support keeps you accountable, progressing, and connected to your coach — on your terms.
          </Text>
          <Pressable onPress={() => setExpanded(!expanded)} style={{ marginTop: 6 }}>
            <Text style={{ color: PRIMARY, fontSize: 13, fontWeight: '600' }}>
              {expanded ? 'Hide details ▴' : 'See your ongoing rate ▾'}
            </Text>
          </Pressable>
          {expanded && (
            <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: BORDER }}>
              {/* Pricing grid */}
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
                <View style={[inv.priceCard, { flex: 1 }]}>
                  <Text style={inv.priceLabel}>MONTHLY</Text>
                  <Text style={inv.priceAmount}>{formatCurrency(monthlyRate)}<Text style={inv.priceSuffix}>/mo</Text></Text>
                  <Text style={inv.priceDetail}>Cancel anytime</Text>
                </View>
                <View style={[inv.priceCard, { flex: 1, borderColor: GOLD_BORDER }]}>
                  <Text style={[inv.priceLabel, { color: GOLD }]}>PAY IN FULL</Text>
                  <Text style={inv.priceAmount}>{formatCurrency(payInFullMonthly)}<Text style={inv.priceSuffix}>/mo</Text></Text>
                  <Text style={{ color: ACCENT, fontSize: 12, fontWeight: '600', marginTop: 2 }}>Save {formatCurrency(payInFullSavings)}/yr</Text>
                </View>
              </View>
              {/* Commit to Save */}
              <View style={{ padding: 10, backgroundColor: GOLD_BG, borderRadius: 8, borderWidth: 1, borderColor: GOLD_BORDER, marginBottom: 8 }}>
                <Text style={{ color: GOLD, fontSize: 13, fontWeight: '700', marginBottom: 2 }}>💡 Commit to Save — Half Off</Text>
                <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>
                  Stay consistent and lock in {formatCurrency(ctsMonthly)}/mo — half your standard monthly rate. The same accountability rules apply.
                </Text>
                {!isCoach && plan.status === 'active' && (() => {
                  // CTS button only visible after contract period ends (RISK-001)
                  const endAt = (plan as any).contractEndAt;
                  const contractEnded = endAt ? (endAt.toMillis ? endAt.toMillis() : endAt.seconds * 1000) <= Date.now() : false;
                  return contractEnded;
                })() && (
                  <Pressable
                    onPress={() => setCtsModalVisible(true)}
                    style={{ marginTop: 8, backgroundColor: GOLD, borderRadius: 8, paddingVertical: 8, alignItems: 'center' }}
                  >
                    <Text style={{ color: '#000', fontSize: 13, fontWeight: '700' }}>Commit to Save — {formatCurrency(ctsMonthly)}/mo</Text>
                  </Pressable>
                )}
              </View>
              {!isCoach && (
                <CtsOptInModal
                  visible={ctsModalVisible}
                  onClose={() => setCtsModalVisible(false)}
                  memberId={plan.memberId}
                  planId={plan.id ?? ''}
                  coachId={coachId}
                  ctsMonthlyRate={ctsMonthly}
                  standardMonthlyRate={monthlyRate}
                  ctsMonthlyFormatted={formatCurrency(ctsMonthly)}
                  standardMonthlyFormatted={formatCurrency(monthlyRate)}
                />
              )}
              {/* Nutrition */}
              {nutEnabled && (
                <View style={{ padding: 10, backgroundColor: 'rgba(110,187,122,0.08)', borderRadius: 8, borderWidth: 1, borderColor: 'rgba(110,187,122,0.3)', marginBottom: 8 }}>
                  <Text style={{ color: ACCENT, fontSize: 13, fontWeight: '700', marginBottom: 2 }}>🥗 Nutrition Add-On</Text>
                  <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>
                    Continue your nutrition coaching for +{formatCurrency(nutCost)}/mo. New monthly: {formatCurrency(withNutMonthly)}.
                  </Text>
                </View>
              )}
              {/* Referral reset */}
              <View style={{ padding: 10, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 8, borderWidth: 1, borderColor: BORDER }}>
                <Text style={{ color: GOLD, fontSize: 13, fontWeight: '700', marginBottom: 2 }}>🎁 Referral Clock Resets</Text>
                <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>
                  Refer 3 friends into a yearly plan within {plan.contractMonths || 12} months and your base membership is refunded — same as your original contract.
                </Text>
              </View>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

// ── How we got these numbers (expandable breakdown) ─────────────────────────
function HowWeGotTheseNumbers({ plan, pricing, isCoach }: { plan: MemberPlanData; pricing: PricingResult; isCoach: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const months = plan.contractMonths;
  const sessionLength = pricing.sessionLengthMinutes || plan.sessionLengthMinutes || 60;
  const hourlyRate = pricing.hourlyRate || plan.hourlyRate || 100;
  const checkInMin = pricing.checkInCallLengthMinutes || plan.checkInCallMinutes || 30;
  const buildHrs = pricing.buildHours ?? plan.programBuildTimeHours ?? 5;
  const checkInHrs = pricing.checkInHours;
  const totalCoachingHrs = pricing.totalCoachingHours;
  const totalHrs = pricing.totalHours;
  const phaseBreakdown = pricing.phaseBreakdown || [];
  const selfMin = pricing.selfReliantMinutesPerSession ?? 3.5;
  const P1 = (plan.phases && plan.phases[0]?.weeks) || 0;
  const P2 = (plan.phases && plan.phases[1]?.weeks) || 0;
  const P3 = (plan.phases && plan.phases[2]?.weeks) || 0;

  return (
    <View style={{ marginTop: 12 }}>
      <Pressable
        onPress={() => setIsOpen(!isOpen)}
        style={[inv.statsRow, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16 }]}
      >
        <Text style={{ color: PRIMARY, fontSize: 14, fontWeight: '600' }}>
          {isOpen ? 'Hide breakdown' : 'Pricing breakdown'}
        </Text>
        <Text style={{ color: PRIMARY, fontSize: 14 }}>{isOpen ? '▴' : '▾'}</Text>
      </Pressable>

      {isOpen && isCoach && (() => {
        const BdRow = ({ left, right, bold }: { left: string; right: string; bold?: boolean }) => (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
            <Text style={{ color: MUTED, fontSize: 11, flex: 1 }} numberOfLines={1}>{left}</Text>
            <Text style={{ color: bold ? '#FFF' : MUTED, fontSize: 11, fontWeight: bold ? '700' : '400', textAlign: 'right', minWidth: 50 }}>{right}</Text>
          </View>
        );
        return (
          <View style={{ marginTop: 8, padding: 12, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 8, borderWidth: 1, borderColor: BORDER }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ color: MUTED, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>SESSION TYPE</Text>
              <Text style={{ color: MUTED, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>HOURS</Text>
            </View>
            {phaseBreakdown.map(({ sessionType, sessionsPerWeek: count, phase1Hours: p1Hrs, phase2Hours: p2Hrs, phase3Hours: p3Hrs, phase1Guidance, phase2Guidance, phase3Guidance }) => {
              const label = sessionType === 'Cardio + Mobility' ? 'Cardio' : sessionType;
              const rows: { left: string; right: string }[] = [];
              if (P1 > 0) {
                const desc = phase1Guidance === 'Self-reliant' ? `P1: ${P1}w × ${count} × ${selfMin}m` : `P1: ${P1}w × ${count} × ${sessionLength}m × ${GUIDANCE_FACTORS[phase1Guidance as keyof typeof GUIDANCE_FACTORS]}`;
                rows.push({ left: `${label} ${desc}`, right: `${p1Hrs.toFixed(1)}h` });
              }
              if (P2 > 0) {
                const desc = phase2Guidance === 'Self-reliant' ? `P2: ${P2}w × ${count} × ${selfMin}m` : `P2: ${P2}w × ${count} × ${sessionLength}m × ${GUIDANCE_FACTORS[phase2Guidance as keyof typeof GUIDANCE_FACTORS]}`;
                rows.push({ left: `${label} ${desc}`, right: `${p2Hrs.toFixed(1)}h` });
              }
              if (P3 > 0) {
                const desc = phase3Guidance === 'Self-reliant' ? `P3: ${P3}w × ${count} × ${selfMin}m` : `P3: ${P3}w × ${count} × ${sessionLength}m × ${GUIDANCE_FACTORS[phase3Guidance as keyof typeof GUIDANCE_FACTORS]}`;
                rows.push({ left: `${label} ${desc}`, right: `${p3Hrs.toFixed(1)}h` });
              }
              return <View key={sessionType} style={{ marginBottom: 2 }}>{rows.map((r, i) => <BdRow key={i} left={r.left} right={r.right} />)}</View>;
            })}
            <View style={{ borderTopWidth: 1, borderTopColor: BORDER, marginTop: 4, paddingTop: 4 }}>
              <BdRow left={`Check-ins (${months}mo × ${checkInMin}m)`} right={`${checkInHrs.toFixed(1)}h`} />
              <BdRow left="Program build" right={`${buildHrs}h`} />
            </View>
            <View style={{ borderTopWidth: 1, borderTopColor: BORDER, marginTop: 4, paddingTop: 4 }}>
              <BdRow left="Total hours" right={`${totalHrs.toFixed(1)}h`} bold />
              <BdRow left={`${totalHrs.toFixed(1)}h × ${formatCurrency(hourlyRate)}/hr`} right={formatCurrency(Math.round(totalHrs * hourlyRate))} />
              <BdRow left={`÷ ${months} months`} right={formatCurrency(pricing.calculatedMonthlyPrice)} bold />
            </View>
          </View>
        );
      })()}

      {isOpen && !isCoach && (
        <View style={{ marginTop: 8, padding: 12, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
          <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>
            <Text style={{ color: '#FFF', fontWeight: '600' }}>Monthly price: </Text>
            Based on your coaching rate, session length ({sessionLength} min), {plan.sessionsPerWeek} sessions/week, monthly check-in calls, and initial program build time.
          </Text>
          <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18, marginTop: 6 }}>
            <Text style={{ color: '#FFF', fontWeight: '600' }}>Per session: </Text>
            {formatCurrency(pricing.displayMonthlyPrice)} × {months} months ÷ {pricing.totalSessions} total sessions = {formatCurrency(pricing.perSessionPrice)}
          </Text>
          <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18, marginTop: 6 }}>
            <Text style={{ color: '#FFF', fontWeight: '600' }}>Pay in full: </Text>
            {formatCurrency(pricing.displayMonthlyPrice)} × {months} months, minus {plan.payInFullDiscountPercent || 10}% discount = {formatCurrency(pricing.payInFullPrice)}
          </Text>
        </View>
      )}
    </View>
  );
}

const inv = StyleSheet.create({
  priceCard: {
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
  },
  priceLabel: {
    color: MUTED,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  priceAmount: {
    color: '#FFF',
    fontSize: 28,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold',
  },
  priceSuffix: {
    fontSize: 14,
    fontWeight: '400',
    color: MUTED,
  },
  priceDetail: {
    color: MUTED,
    fontSize: 12,
    marginTop: 4,
  },
  statsRow: {
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: 'row',
    marginBottom: 12,
  },
  statsLabel: {
    color: MUTED,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  statsValue: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold',
  },
  statsDetail: {
    color: MUTED,
    fontSize: 11,
    marginTop: 2,
  },
  addonCard: {
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 12,
  },
  addBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  addBtnActive: {
    borderColor: GOLD_BORDER,
    backgroundColor: 'rgba(245,166,35,0.08)',
  },
  detailLine: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 8,
  },
});

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
  // showBreakdown removed — breakdown is now inline in Pricing Settings
  const [openGuidanceKey, setOpenGuidanceKey] = useState<string | null>(null);
  // Post-contract unsaved-changes indicator
  const [pcSaved, setPcSaved] = useState<'idle' | 'saved'>('idle');
  // Local string state for session-minutes so backspace-to-empty and decimals work
  const [sessionMinText, setSessionMinText] = useState<string>(String(plan.postContract?.sessionMinutes ?? 3.5));
  // contMinText is no longer needed here — self-reliant minutes is managed via sessionMinText above
  const pcSavedTimer = useRef<any>(null);
  const onPcChange = (updates: Partial<MemberPlanData>) => {
    onChange(updates);
    setPcSaved('saved');
    if (pcSavedTimer.current) clearTimeout(pcSavedTimer.current);
    pcSavedTimer.current = setTimeout(() => setPcSaved('idle'), 2500);
  };

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
        <View
          style={[em.sheet, { maxHeight: SCREEN_H * 0.85 }]}
          onStartShouldSetResponder={() => true}
          {...(Platform.OS === 'web' ? { onClick: (e: any) => e.stopPropagation() } as any : {})}
        >
          <ScrollView
            style={{ maxHeight: SCREEN_H * 0.85 - 40 }}
            showsVerticalScrollIndicator
            bounces={false}
            nestedScrollEnabled
            contentContainerStyle={{ paddingBottom: 32 }}
          >
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
                const updatedIncluded = (plan.whatsIncluded || []).map(item =>
                  /^\d+ coaching sessions? per week$/i.test(item)
                    ? `${clamped} coaching sessions per week`
                    : item
                );
                onChange({ sessionsPerWeek: clamped, weeklySchedule: newSchedule, whatsIncluded: updatedIncluded });
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
                      Full = 100% live coach time · Blend = 62.5% · Self = {plan.postContract?.sessionMinutes ?? 3.5} min/session
                    </Text>
                  </View>
                )}

                {/* Pricing breakdown (inline, mobile-friendly table) */}
                <View style={{ borderTopWidth: 1, borderTopColor: BORDER, marginTop: 12, paddingTop: 12 }}>
                  <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '700', marginBottom: 8 }}>Pricing Breakdown</Text>
                  {(() => {
                    const months = plan.contractMonths;
                    const sessionLength = pricing.sessionLengthMinutes || plan.sessionLengthMinutes || 60;
                    const hourlyRate = pricing.hourlyRate || plan.hourlyRate || 100;
                    const checkInMin = pricing.checkInCallLengthMinutes || plan.checkInCallMinutes || 30;
                    const buildHrs = pricing.buildHours ?? plan.programBuildTimeHours ?? 5;
                    const checkInHrs = pricing.checkInHours;
                    const totalCoachingHrs = pricing.totalCoachingHours;
                    const totalHrs = pricing.totalHours;
                    const phaseBreakdown = pricing.phaseBreakdown || [];
                    const selfMin = pricing.selfReliantMinutesPerSession ?? 3.5;
                    const P1 = (plan.phases && plan.phases[0]?.weeks) || 0;
                    const P2 = (plan.phases && plan.phases[1]?.weeks) || 0;
                    const P3 = (plan.phases && plan.phases[2]?.weeks) || 0;

                    // Table row helper
                    const Row = ({ left, right, bold }: { left: string; right: string; bold?: boolean }) => (
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
                        <Text style={{ color: MUTED, fontSize: 11, flex: 1 }} numberOfLines={1}>{left}</Text>
                        <Text style={{ color: bold ? '#FFF' : MUTED, fontSize: 11, fontWeight: bold ? '700' : '400', textAlign: 'right', minWidth: 50 }}>{right}</Text>
                      </View>
                    );

                    return (
                      <View style={{ padding: 10, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 8, borderWidth: 1, borderColor: BORDER }}>
                        {/* Phase header */}
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                          <Text style={{ color: MUTED, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>SESSION TYPE</Text>
                          <Text style={{ color: MUTED, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>HOURS</Text>
                        </View>
                        {phaseBreakdown.map(({ sessionType, sessionsPerWeek: count, phase1Hours: p1Hrs, phase2Hours: p2Hrs, phase3Hours: p3Hrs, phase1Guidance, phase2Guidance, phase3Guidance }) => {
                          const label = sessionType === 'Cardio + Mobility' ? 'Cardio' : sessionType;
                          const rows: { left: string; right: string }[] = [];
                          if (P1 > 0) {
                            const desc = phase1Guidance === 'Self-reliant' ? `P1: ${P1}w × ${count} × ${selfMin}m` : `P1: ${P1}w × ${count} × ${sessionLength}m × ${GUIDANCE_FACTORS[phase1Guidance as keyof typeof GUIDANCE_FACTORS]}`;
                            rows.push({ left: `${label} ${desc}`, right: `${p1Hrs.toFixed(1)}h` });
                          }
                          if (P2 > 0) {
                            const desc = phase2Guidance === 'Self-reliant' ? `P2: ${P2}w × ${count} × ${selfMin}m` : `P2: ${P2}w × ${count} × ${sessionLength}m × ${GUIDANCE_FACTORS[phase2Guidance as keyof typeof GUIDANCE_FACTORS]}`;
                            rows.push({ left: `${label} ${desc}`, right: `${p2Hrs.toFixed(1)}h` });
                          }
                          if (P3 > 0) {
                            const desc = phase3Guidance === 'Self-reliant' ? `P3: ${P3}w × ${count} × ${selfMin}m` : `P3: ${P3}w × ${count} × ${sessionLength}m × ${GUIDANCE_FACTORS[phase3Guidance as keyof typeof GUIDANCE_FACTORS]}`;
                            rows.push({ left: `${label} ${desc}`, right: `${p3Hrs.toFixed(1)}h` });
                          }
                          return <View key={sessionType} style={{ marginBottom: 2 }}>{rows.map((r, i) => <Row key={i} left={r.left} right={r.right} />)}</View>;
                        })}
                        <View style={{ borderTopWidth: 1, borderTopColor: BORDER, marginTop: 4, paddingTop: 4 }}>
                          <Row left={`Check-ins (${months}mo × ${checkInMin}m)`} right={`${checkInHrs.toFixed(1)}h`} />
                          <Row left="Program build" right={`${buildHrs}h`} />
                        </View>
                        <View style={{ borderTopWidth: 1, borderTopColor: BORDER, marginTop: 4, paddingTop: 4 }}>
                          <Row left={`Total hours`} right={`${totalHrs.toFixed(1)}h`} bold />
                          <Row left={`${totalHrs.toFixed(1)}h × ${formatCurrency(hourlyRate)}/hr`} right={formatCurrency(Math.round(totalHrs * hourlyRate))} />
                          <Row left={`÷ ${months} months`} right={formatCurrency(pricing.calculatedMonthlyPrice)} bold />
                        </View>
                      </View>
                    );
                  })()}
                </View>

                {/* ── After Contract / Continuation (inside Pricing Settings) ── */}
                <View style={{ borderTopWidth: 1, borderTopColor: BORDER, marginTop: 12, paddingTop: 12 }}>
                  <Pressable
                    onPress={() => {
                      const cp = plan.continuationPricing;
                      onChange({ continuationPricing: { ...(cp || { continuationHourlyRate: plan.hourlyRate ?? 100, continuationMinutesPerSession: plan.postContract?.sessionMinutes ?? 3.5, continuationCheckInMinutesPerMonth: plan.checkInCallMinutes ?? 30, continuationEnabled: true }), continuationEnabled: !(cp?.continuationEnabled ?? true) } });
                    }}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}
                  >
                    <View>
                      <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '600' }}>After Contract / Continuation</Text>
                      <Text style={{ color: MUTED, fontSize: 11, marginTop: 2 }}>Month-to-month pricing after the contract ends</Text>
                    </View>
                    <View style={{ width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: (plan.continuationPricing?.continuationEnabled ?? true) ? PRIMARY : BORDER, backgroundColor: (plan.continuationPricing?.continuationEnabled ?? true) ? PRIMARY : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                      {(plan.continuationPricing?.continuationEnabled ?? true) && <Text style={{ color: '#000', fontSize: 12, fontWeight: '700' }}>✓</Text>}
                    </View>
                  </Pressable>

                  {(plan.continuationPricing?.continuationEnabled ?? true) && (() => {
                    // Continuation uses same hourly rate and check-in as the contract
                    const contHr = plan.hourlyRate ?? 100;
                    const contMin = plan.postContract?.sessionMinutes ?? 3.5;
                    const contCheckIn = plan.checkInCallMinutes ?? 30;
                    const spm = Math.round((plan.sessionsPerWeek || 3) * (52 / 12));
                    const contSessionHrs = contHr * (contMin / 60) * spm;
                    const contCheckInHrs = contCheckIn / 60; // 1 call/mo
                    const contMonthly = Math.round(contSessionHrs + (contCheckInHrs * contHr));
                    // CTS + Pay-in-full stacking: PIF discount first (10% off yearly), then CTS (half off that)
                    const contYearly = contMonthly * 12;
                    const contPifYearly = Math.round(contYearly * 0.9); // 10% PIF discount
                    const contPifMonthly = Math.round(contPifYearly / 12);
                    const contCts = plan.postContract?.ctsMonthlySavings != null ? plan.postContract.ctsMonthlySavings : Math.round(contMonthly * 0.5);
                    // Stacked: PIF + CTS both apply
                    const contStackedMonthly = Math.round(contPifMonthly - contCts);

                    // Self-reliant minutes validation
                    const minWarning = contMin < 3 || contMin > 5;

                    // Auto-sync continuation pricing to Firestore
                    // This ensures the billing system always has up-to-date values
                    const syncedCp = {
                      continuationHourlyRate: contHr,
                      continuationMinutesPerSession: contMin,
                      continuationCheckInMinutesPerMonth: contCheckIn,
                      continuationEnabled: true,
                      continuationMonthlyPrice: contMonthly,
                      continuationPayInFullTotal: contPifYearly,
                      continuationPayInFullMonthlyEquivalent: contPifMonthly,
                      ctsMonthlySavings: contCts,
                    };
                    // Check if Firestore values are stale and need syncing
                    const cp = plan.continuationPricing;
                    const needsSync = !cp ||
                      cp.continuationHourlyRate !== contHr ||
                      cp.continuationMinutesPerSession !== contMin ||
                      cp.continuationCheckInMinutesPerMonth !== contCheckIn ||
                      cp.continuationMonthlyPrice !== contMonthly ||
                      cp.continuationPayInFullTotal !== contPifYearly ||
                      cp.continuationPayInFullMonthlyEquivalent !== contPifMonthly;
                    if (needsSync) {
                      // Debounced sync: schedule a write on next tick to avoid re-render loop
                      setTimeout(() => onChange({ continuationPricing: syncedCp as any }), 0);
                    }

                    return (
                      <View style={{ marginTop: 8, padding: 10, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 8, borderWidth: 1, borderColor: BORDER }}>
                        <Text style={{ color: MUTED, fontSize: 11, lineHeight: 16, marginBottom: 6 }}>
                          Uses your hourly rate ({formatCurrency(contHr)}/hr), self-reliant coach time ({contMin} min/session), and check-in call ({contCheckIn} min/mo).
                        </Text>
                        {minWarning && (
                          <View style={{ padding: 6, backgroundColor: 'rgba(245,166,35,0.1)', borderRadius: 6, borderWidth: 1, borderColor: 'rgba(245,166,35,0.3)', marginBottom: 6 }}>
                            <Text style={{ color: GOLD, fontSize: 11, lineHeight: 15 }}>
                              ⚠️ Self-reliant coach time is outside the recommended 3–5 min range. This may skew pricing significantly.
                            </Text>
                          </View>
                        )}
                        <View style={{ padding: 8, backgroundColor: 'rgba(91,155,213,0.08)', borderRadius: 6, borderWidth: 1, borderColor: 'rgba(91,155,213,0.2)' }}>
                          <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>Monthly: <Text style={{ color: '#FFF', fontWeight: '600' }}>{formatCurrency(contMonthly)}/mo</Text></Text>
                          <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>Pay in full (10% off): <Text style={{ color: '#FFF' }}>{formatCurrency(contPifMonthly)}/mo</Text></Text>
                          <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>Commit to Save: <Text style={{ color: GOLD }}>{formatCurrency(contCts)}/mo off</Text></Text>
                          <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(91,155,213,0.15)', marginTop: 4, paddingTop: 4 }}>
                            <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>PIF + CTS stacked: <Text style={{ color: ACCENT, fontWeight: '700' }}>{formatCurrency(Math.max(0, contStackedMonthly))}/mo</Text></Text>
                          </View>
                        </View>
                      </View>
                    );
                  })()}
                </View>
              </View>
            )}

            {/* Present Plan */}
            {plan.status === 'draft' && (
              <Pressable
                onPress={() => onChange({ status: 'presented' })}
                style={{ backgroundColor: PRIMARY, paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 20 }}
              >
                <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '700' }}>Present Plan to Member</Text>
              </Pressable>
            )}

            {plan.status === 'presented' && (
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
                  value={String(Math.round(pricing.displayMonthlyPrice))}
                  onChangeText={t => { const n = parseInt(t); if (!isNaN(n)) handleBasePriceOverride(n); }}
                  keyboardType="number-pad" selectTextOnFocus
                />
              </View>
            </View>

            {/* ── Member Visibility Controls ── */}
            <View style={{ marginTop: 16, borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 12 }}>
              <Text style={{ color: MUTED, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 10 }}>MEMBER VISIBILITY</Text>

              {/* Investment visibility */}
              <Pressable
                onPress={() => onChange({ showInvestment: !(plan.showInvestment !== false) })}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 }}
              >
                <Text style={{ color: '#FFF', fontSize: 14 }}>Show investment to member</Text>
                <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: plan.showInvestment !== false ? ACCENT : BORDER, backgroundColor: plan.showInvestment !== false ? ACCENT : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {plan.showInvestment !== false && <Text style={{ color: '#000', fontSize: 14, fontWeight: '700' }}>✓</Text>}
                </View>
              </Pressable>

              {/* Commit to Save visibility */}
              <Pressable
                onPress={() => onChange({
                  commitToSave: {
                    ...(plan.commitToSave || { monthlySavings: 100, nextMonthPercentOff: 5, missedSessionFee: 50, makeUpWindowHours: 48, emergencyWaiverEnabled: true, reentryRule: '', summary: '', enabled: false, active: false }),
                    enabled: !(plan.commitToSave?.enabled),
                  },
                })}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 }}
              >
                <Text style={{ color: '#FFF', fontSize: 14 }}>Show Commit to Save to member</Text>
                <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: plan.commitToSave?.enabled ? ACCENT : BORDER, backgroundColor: plan.commitToSave?.enabled ? ACCENT : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {plan.commitToSave?.enabled && <Text style={{ color: '#000', fontSize: 14, fontWeight: '700' }}>✓</Text>}
                </View>
              </Pressable>

              {/* Nutrition visibility */}
              <Pressable
                onPress={() => onChange({ nutrition: { ...(plan.nutrition || { type: 'in-house', providerName: '', monthlyCost: 100, description: 'Add personalized nutrition coaching to your plan. Includes a custom nutrition strategy, macro targets, and monthly check-ins to keep your eating aligned with your training goals.', enabled: false, active: false }), enabled: !(plan.nutrition?.enabled) } })}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 }}
              >
                <Text style={{ color: '#FFF', fontSize: 14 }}>Show Nutrition Add-On to member</Text>
                <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: plan.nutrition?.enabled ? ACCENT : BORDER, backgroundColor: plan.nutrition?.enabled ? ACCENT : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {plan.nutrition?.enabled && <Text style={{ color: '#000', fontSize: 14, fontWeight: '700' }}>✓</Text>}
                </View>
              </Pressable>

              {/* Post-Contract visibility */}
              <Pressable
                onPress={() => onChange({
                  postContract: {
                    ...(plan.postContract || { hourlyRate: plan.hourlyRate ?? 100, sessionMinutes: 3.5, nutritionMonthlyCost: 25 }),
                    enabled: !(plan.postContract?.enabled),
                  },
                })}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 }}
              >
                <Text style={{ color: '#FFF', fontSize: 14 }}>Show Ongoing Support to member</Text>
                <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: plan.postContract?.enabled ? PRIMARY : BORDER, backgroundColor: plan.postContract?.enabled ? PRIMARY : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {plan.postContract?.enabled && <Text style={{ color: '#000', fontSize: 14, fontWeight: '700' }}>✓</Text>}
                </View>
              </Pressable>

              {/* ── Ongoing Support Pricing (inline, shown when enabled) ── */}
              {plan.postContract?.enabled && (
                <View style={{ marginLeft: 0, marginTop: 4, marginBottom: 8, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: BORDER }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <Text style={{ color: MUTED, fontSize: 11, fontWeight: '700', letterSpacing: 1.2 }}>ONGOING SUPPORT PRICING</Text>
                    {pcSaved === 'saved' && (
                      <Text style={{ color: '#6EBB7A', fontSize: 11, fontWeight: '600' }}>✓ Saved</Text>
                    )}
                  </View>

                {/* Hourly rate */}
                <Text style={dc.label}>Post-contract hourly rate</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <Text style={{ color: MUTED, fontSize: 14 }}>$</Text>
                  <TextInput
                    style={{ flex: 1, backgroundColor: BG, borderWidth: 1, borderColor: BORDER, borderRadius: 8, padding: 10, color: '#FFF', fontSize: 15 }}
                    value={String(plan.postContract?.hourlyRate ?? plan.hourlyRate ?? 100)}
                    keyboardType="number-pad" selectTextOnFocus
                    onChangeText={t => {
                      const n = parseFloat(t);
                      if (!isNaN(n)) onPcChange({ postContract: { ...(plan.postContract || { hourlyRate: plan.hourlyRate ?? 100, sessionMinutes: 3.5, nutritionMonthlyCost: 25, enabled: true }), hourlyRate: n } });
                    }}
                  />
                  <Text style={{ color: MUTED, fontSize: 13 }}>/hr</Text>
                </View>

                {/* Session time */}
                <Text style={dc.label}>Avg. coach time per session (min)</Text>
                <Text style={{ color: MUTED, fontSize: 11, lineHeight: 16, marginBottom: 6 }}>Self-reliant phase: recommended 3–5 min. Default 3.5.</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <TextInput
                    style={{ flex: 1, backgroundColor: BG, borderWidth: 1, borderColor: BORDER, borderRadius: 8, padding: 10, color: '#FFF', fontSize: 15 }}
                    value={sessionMinText}
                    keyboardType="decimal-pad" selectTextOnFocus
                    onChangeText={t => {
                      setSessionMinText(t);
                      const n = parseFloat(t);
                      if (!isNaN(n) && t !== '' && !t.endsWith('.')) {
                        onPcChange({ postContract: { ...(plan.postContract || { hourlyRate: plan.hourlyRate ?? 100, sessionMinutes: 3.5, nutritionMonthlyCost: 25, enabled: true }), sessionMinutes: n } });
                      }
                    }}
                    onBlur={() => {
                      const n = parseFloat(sessionMinText);
                      const fallback = plan.postContract?.sessionMinutes ?? 3.5;
                      if (isNaN(n) || sessionMinText === '') {
                        setSessionMinText(String(fallback));
                      } else {
                        setSessionMinText(String(n));
                        onPcChange({ postContract: { ...(plan.postContract || { hourlyRate: plan.hourlyRate ?? 100, sessionMinutes: 3.5, nutritionMonthlyCost: 25, enabled: true }), sessionMinutes: n } });
                      }
                    }}
                  />
                  <Text style={{ color: MUTED, fontSize: 13 }}>min</Text>
                </View>

                {/* Nutrition monthly cost */}
                <Text style={dc.label}>Nutrition add-on monthly cost</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <Text style={{ color: MUTED, fontSize: 14 }}>$</Text>
                  <TextInput
                    style={{ flex: 1, backgroundColor: BG, borderWidth: 1, borderColor: BORDER, borderRadius: 8, padding: 10, color: '#FFF', fontSize: 15 }}
                    value={String(plan.postContract?.nutritionMonthlyCost ?? 25)}
                    keyboardType="number-pad" selectTextOnFocus
                    onChangeText={t => {
                      const n = parseFloat(t);
                      if (!isNaN(n)) onPcChange({ postContract: { ...(plan.postContract || { hourlyRate: plan.hourlyRate ?? 100, sessionMinutes: 3.5, nutritionMonthlyCost: 25, enabled: true }), nutritionMonthlyCost: n } });
                    }}
                  />
                  <Text style={{ color: MUTED, fontSize: 13 }}>/mo</Text>
                </View>

                {/* Commit to Save override */}
                <Text style={dc.label}>Commit to Save monthly rate (optional override)</Text>
                <Text style={{ color: MUTED, fontSize: 11, marginBottom: 6, marginTop: -8 }}>Leave blank to auto-calculate as half the monthly rate</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <Text style={{ color: MUTED, fontSize: 14 }}>$</Text>
                  <TextInput
                    style={{ flex: 1, backgroundColor: BG, borderWidth: 1, borderColor: BORDER, borderRadius: 8, padding: 10, color: '#FFF', fontSize: 15 }}
                    value={plan.postContract?.ctsMonthlySavings != null ? String(plan.postContract.ctsMonthlySavings) : ''}
                    placeholder="Auto (half monthly)"
                    placeholderTextColor={MUTED}
                    keyboardType="number-pad" selectTextOnFocus
                    onChangeText={t => {
                      const base = plan.postContract || { hourlyRate: plan.hourlyRate ?? 100, sessionMinutes: 3.5, nutritionMonthlyCost: 25, enabled: true };
                      if (t === '' || t === null) {
                        const { ctsMonthlySavings: _removed, ...rest } = { ...base } as any;
                        onPcChange({ postContract: rest });
                      } else {
                        const n = parseFloat(t);
                        if (!isNaN(n)) onPcChange({ postContract: { ...base, ctsMonthlySavings: n } });
                      }
                    }}
                  />
                  <Text style={{ color: MUTED, fontSize: 13 }}>/mo</Text>
                </View>

                {/* Live preview */}
                {(() => {
                  const hr = plan.postContract?.hourlyRate ?? plan.hourlyRate ?? 100;
                  const sm = plan.postContract?.sessionMinutes ?? 3.5;
                  const spm = Math.round((plan.sessionsPerWeek || 3) * (52 / 12));
                  const monthly = Math.round(hr * (sm / 60) * spm);
                  const ctsHalf = plan.postContract?.ctsMonthlySavings ?? Math.round(monthly * 0.5);
                  const pifMonthly = Math.round(monthly * 12 * 0.9 / 12);
                  return (
                    <View style={{ padding: 10, backgroundColor: 'rgba(91,155,213,0.08)', borderRadius: 8, borderWidth: 1, borderColor: 'rgba(91,155,213,0.3)' }}>
                      <Text style={{ color: PRIMARY, fontSize: 12, fontWeight: '700', marginBottom: 4 }}>LIVE PREVIEW</Text>
                      <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>Monthly: <Text style={{ color: '#FFF' }}>{formatCurrency(monthly)}/mo</Text></Text>
                      <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>Pay in full: <Text style={{ color: '#FFF' }}>{formatCurrency(pifMonthly)}/mo</Text></Text>
                      <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>Commit to Save (half off): <Text style={{ color: GOLD }}>{formatCurrency(ctsHalf)}/mo</Text></Text>
                    </View>
                  );
                })()}
                </View>
              )}
            </View>

            {/* After Contract / Continuation is now inside Pricing Settings above */}

            <View style={{ height: 20 }} />
          </ScrollView>
        </View>
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
// QUESTIONNAIRE VIEWER (editable by coach)
// ═══════════════════════════════════════════════════════════════════════════════

function QuestionnaireViewer({ data, memberId: qMemberId, onSaved }: {
  data: any;
  memberId: string;
  onSaved: (updated: any) => void;
}) {
  const [editField, setEditField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSaveField(field: string, value: string) {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'intakeSubmissions', qMemberId), { [field]: value });
      onSaved({ ...data, [field]: value });
    } catch (e) {
      console.warn('Failed to save intake field:', e);
    } finally {
      setSaving(false);
      setEditField(null);
    }
  }

  if (!data) {
    return (
      <View style={{ padding: 24, alignItems: 'center' }}>
        <Text style={{ color: MUTED, fontSize: 15, textAlign: 'center', marginBottom: 8 }}>
          No intake data yet.
        </Text>
        <Text style={{ color: '#4A5568', fontSize: 13, textAlign: 'center' }}>
          This member was added manually. Their intake answers will appear here once they complete the intake form, or you can add notes below.
        </Text>
      </View>
    );
  }

  // Map fields from intakeSubmissions if needed
  const name = `${data.firstName || ''} ${data.lastName || ''}`.trim();
  const goals = data.primaryGoals || data.goals;
  const weight = data.weight || data.currentWeight;
  const readiness = data.readinessForChange || data.readiness;
  const activity = data.activityLevel || data.occupation;
  const diet = Array.isArray(data.currentDiet) ? data.currentDiet.join(', ') : (data.currentDiet || data.diet);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
      {/* Edit modal */}
      {editField && (
        <Modal transparent animationType="slide" visible={true} onRequestClose={() => setEditField(null)}>
          <Pressable style={em.overlay} onPress={() => setEditField(null)}>
            <Pressable style={em.sheet} onPress={e => e.stopPropagation()}>
              <View style={em.header}>
                <Text style={em.title}>Edit {editField.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}</Text>
                <Pressable onPress={() => setEditField(null)} hitSlop={8}><Icon name="x" size={20} color={MUTED} /></Pressable>
              </View>
              <TextInput
                style={em.input}
                value={editValue}
                onChangeText={setEditValue}
                multiline
                numberOfLines={3}
                placeholderTextColor="#4A5568"
                autoFocus
              />
              <View style={em.buttons}>
                <Pressable style={em.btnCancel} onPress={() => setEditField(null)}>
                  <Text style={em.btnCancelText}>Cancel</Text>
                </Pressable>
                <Pressable style={[em.btnSave, saving && { opacity: 0.6 }]} onPress={() => handleSaveField(editField, editValue)} disabled={saving}>
                  <Text style={em.btnSaveText}>{saving ? 'Saving…' : 'Save'}</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      <QSection label="About">
        <QRow label="Name" value={name} />
        <QRowEdit label="Email" value={data.email} onEdit={() => { setEditField('email'); setEditValue(data.email || ''); }} />
        <QRowEdit label="Phone" value={data.phone} onEdit={() => { setEditField('phone'); setEditValue(data.phone || ''); }} />
        <QRowEdit label="Gender" value={data.gender} onEdit={() => { setEditField('gender'); setEditValue(data.gender || ''); }} />
        <QRowEdit label="DOB" value={data.dateOfBirth} onEdit={() => { setEditField('dateOfBirth'); setEditValue(data.dateOfBirth || ''); }} />
        <QRowEdit label="Height" value={data.height} onEdit={() => { setEditField('height'); setEditValue(data.height || ''); }} />
        <QRowEdit label="Weight" value={weight} onEdit={() => { setEditField('weight'); setEditValue(String(weight || '')); }} />
      </QSection>

      <QSection label="Goals">
        <QRow label="Primary Goals" value={goals} />
        <QRowEdit label="Specific Goals" value={data.specificGoals} onEdit={() => { setEditField('specificGoals'); setEditValue(data.specificGoals || ''); }} />
        <QRowEdit label="Goal Weight" value={data.goalWeight} onEdit={() => { setEditField('goalWeight'); setEditValue(data.goalWeight || ''); }} />
        <QRowEdit label="Why Statement" value={data.whyStatement} onEdit={() => { setEditField('whyStatement'); setEditValue(data.whyStatement || ''); }} />
      </QSection>

      <QSection label="Motivation">
        <QRow label="Readiness" value={readiness} />
        <QRow label="Motivation" value={data.motivation} />
        <QRow label="Gym Confidence" value={data.gymConfidence} />
      </QSection>

      <QSection label="Lifestyle">
        <QRowEdit label="Activity/Occupation" value={activity} onEdit={() => { setEditField('activityLevel'); setEditValue(String(activity || '')); }} />
        <QRowEdit label="Current Routine" value={data.currentRoutine} onEdit={() => { setEditField('currentRoutine'); setEditValue(data.currentRoutine || ''); }} />
        <QRow label="Diet" value={diet} />
        <QRowEdit label="Work Schedule" value={data.workSchedule} onEdit={() => { setEditField('workSchedule'); setEditValue(data.workSchedule || ''); }} />
      </QSection>

      <QSection label="Health">
        <QRowEdit label="Health Problems" value={data.healthProblems} onEdit={() => { setEditField('healthProblems'); setEditValue(data.healthProblems || ''); }} />
        <QRowEdit label="Medications" value={data.medications} onEdit={() => { setEditField('medications'); setEditValue(data.medications || ''); }} />
        <QRowEdit label="Injuries" value={data.currentInjuries || (Array.isArray(data.injuries) ? data.injuries.join(', ') : data.injuries)} onEdit={() => { setEditField('currentInjuries'); setEditValue(data.currentInjuries || ''); }} />
        <QRowEdit label="Therapies" value={data.therapies} onEdit={() => { setEditField('therapies'); setEditValue(data.therapies || ''); }} />
      </QSection>

      <QSection label="Scheduling">
        <QRow label="Preferred Days" value={Array.isArray(data.preferredDays) ? data.preferredDays.join(', ') : data.preferredDays} />
        <QRowEdit label="Preferred Time" value={data.preferredTime} onEdit={() => { setEditField('preferredTime'); setEditValue(data.preferredTime || ''); }} />
        <QRowEdit label="Gym" value={data.gym} onEdit={() => { setEditField('gym'); setEditValue(data.gym || ''); }} />
        <QRowEdit label="Sessions/Week" value={data.sessionsPerWeek} onEdit={() => { setEditField('sessionsPerWeek'); setEditValue(String(data.sessionsPerWeek || '')); }} />
      </QSection>
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

function QRowEdit({ label, value, onEdit }: { label: string; value?: string | number | string[]; onEdit: () => void }) {
  const display = value && !Array.isArray(value) ? String(value) : (Array.isArray(value) ? value.join(', ') : '');
  return (
    <Pressable
      onPress={onEdit}
      style={({ pressed }) => [{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: BORDER }, pressed && { opacity: 0.7 }]}
    >
      <Text style={{ color: MUTED, fontSize: 13, flex: 1 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '65%' }}>
        <Text style={{ color: display ? '#FFF' : '#4A5568', fontSize: 13, fontWeight: '500', textAlign: 'right' } as any} numberOfLines={2}>
          {display || 'Tap to add'}
        </Text>
        <Text style={{ color: MUTED, fontSize: 11 }}>✏️</Text>
      </View>
    </Pressable>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN SCREEN
// ═══════════════════════════════════════════════════════════════════════════════

export default function MemberPlanScreen() {
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const router = useRouter();
  const { user, effectiveUid } = useAuth();
  const coachUid = effectiveUid || user?.uid || '';

  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<MemberPlanData | null>(null);
  const [questionnaire, setQuestionnaire] = useState<any>(null);
  const [memberName, setMemberName] = useState('');
  const [tab, setTab] = useState<'questionnaire' | 'plan'>('plan');
  const [isCoachMode, setIsCoachMode] = useState(true);
  const [showControls, setShowControls] = useState(false);
  const [copied, setCopied] = useState(false);
  const [paymentLinkCopied, setPaymentLinkCopied] = useState(false);
  const [paymentLinkLoading, setPaymentLinkLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveTimer = useRef<any>(null);
  const saveStatusTimer = useRef<any>(null);
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

    // ── Step 2b: Load coach's preferred pricing defaults ────────────────
    let coachPricingDefaults: { hourlyRate?: number; sessionLengthMinutes?: number; checkInCallMinutes?: number; programBuildTimeHours?: number } = {};
    try {
      const brandDoc = await getDoc(doc(db, 'coach_brands', coachUid));
      if (brandDoc.exists()) {
        const brandData = brandDoc.data();
        if (brandData.defaultPricing) {
          coachPricingDefaults = brandData.defaultPricing;
        }
      }
    } catch (e) {
      // Non-blocking — if this fails, use hardcoded defaults
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
        const defaultPlan = createDefaultPlan(name, memberId, coachUid);
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
          const defaultPlan = createDefaultPlan(name, memberUid, coachUid);
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

    // ── Step 3b: Merge intake data into existing plan if fields are empty ──
    if (finalPlan && qData) {
      // Populate goals from intake if plan has no goals yet
      if (!finalPlan.goals || finalPlan.goals.length === 0) {
        if (qData.primaryGoals && qData.primaryGoals.length > 0) finalPlan.goals = qData.primaryGoals;
        else if (qData.goals && qData.goals.length > 0) finalPlan.goals = qData.goals;
      }
      // Populate other empty fields from intake
      if (!finalPlan.whyStatement && qData.whyStatement) finalPlan.whyStatement = qData.whyStatement;
      if (!finalPlan.currentWeight && qData.weight) finalPlan.currentWeight = String(qData.weight) + ' lbs';
      if (!finalPlan.goalWeight && qData.goalWeight) {
        finalPlan.goalWeight = String(qData.goalWeight) + ' lbs';
      } else if (!finalPlan.goalWeight && qData.weight) {
        // Auto-suggest goal weight based on selected goals
        const currentLbs = parseFloat(String(qData.weight));
        if (!isNaN(currentLbs)) {
          const goals: string[] = finalPlan.goals || [];
          if (goals.includes('Fat loss')) {
            finalPlan.goalWeight = Math.round(currentLbs * 0.90) + ' lbs'; // -10%
          } else if (goals.includes('Build muscle')) {
            finalPlan.goalWeight = Math.round(currentLbs * 1.05) + ' lbs'; // +5%
          }
        }
      }
      if (finalPlan.readiness === 7 && qData.readinessForChange) finalPlan.readiness = qData.readinessForChange;
      if (finalPlan.motivation === 8 && qData.motivation) finalPlan.motivation = qData.motivation;
      if (finalPlan.gymConfidence === 5 && qData.gymConfidence) finalPlan.gymConfidence = qData.gymConfidence;
    }

    // ── Step 4: Create plan from scratch if none found ───────────────────
    if (!finalPlan) {
      console.log('[loadData] No plan found, creating default plan for:', name);
      const defaultPlan = createDefaultPlan(name, planKey, coachUid);
      // Apply coach's preferred pricing defaults (overrides hardcoded defaults)
      if (coachPricingDefaults.hourlyRate != null) defaultPlan.hourlyRate = coachPricingDefaults.hourlyRate;
      if (coachPricingDefaults.sessionLengthMinutes != null) defaultPlan.sessionLengthMinutes = coachPricingDefaults.sessionLengthMinutes;
      if (coachPricingDefaults.checkInCallMinutes != null) defaultPlan.checkInCallMinutes = coachPricingDefaults.checkInCallMinutes;
      if (coachPricingDefaults.programBuildTimeHours != null) defaultPlan.programBuildTimeHours = coachPricingDefaults.programBuildTimeHours;
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
        if (qData.goalWeight) {
          // Member explicitly stated a goal weight — not auto-suggested
          defaultPlan.goalWeight = String(qData.goalWeight) + ' lbs';
          defaultPlan.goalWeightAutoSuggested = false;
        } else if (qData.weight) {
          // Auto-suggest goal weight based on selected goals.
          // goalWeightAutoSuggested=true causes the plan builder to show an
          // "Auto-suggested" badge so the coach knows to review the value.
          const currentLbs = parseFloat(String(qData.weight));
          if (!isNaN(currentLbs)) {
            const goals: string[] = defaultPlan.goals || [];
            if (goals.includes('Fat loss')) {
              defaultPlan.goalWeight = Math.round(currentLbs * 0.90) + ' lbs';
              defaultPlan.goalWeightAutoSuggested = true;
            } else if (goals.includes('Build muscle')) {
              defaultPlan.goalWeight = Math.round(currentLbs * 1.05) + ' lbs';
              defaultPlan.goalWeightAutoSuggested = true;
            }
          }
        }
        if (qData.gym) defaultPlan.gym = qData.gym;
      }
      finalPlan = defaultPlan;
      // Try to persist — but NEVER let a save failure block showing the plan
      try {
        let initPricing: PricingResult | undefined;
        try { initPricing = calculatePricing(finalPlan as MemberPlanData); } catch { /* ignore */ }
        await setDoc(doc(db, 'member_plans', planKey), sanitizeForFirestore({
          ...finalPlan,
          ...(initPricing ? { pricingResult: initPricing } : {}),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }));
        console.log('[loadData] New plan saved to Firestore at key:', planKey);
      } catch (saveErr) {
        console.warn('[loadData] Could not save plan to Firestore (will show in-memory):', saveErr);
        // Plan still shows in UI — coach can edit and it will retry on next change
      }
    }

    // ── Step 5: Always set plan state ────────────────────────────────────
    planKeyRef.current = planKey; // Store the resolved key for auto-save
    finalPlan.id = planKey; // Ensure plan.id is set for checkout and other lookups
    console.log('[loadData] Setting plan for:', finalPlan.memberName, 'planKey:', planKey);
    setPlan(finalPlan);
    setLoading(false);
  };

  // Auto-save with debounce
  const handlePlanChange = useCallback((updates: Partial<MemberPlanData>) => {
    setSaveStatus('saving');
    setPlan(prev => {
      if (!prev) return prev;
      const updated = { ...prev, ...updates };
      // Debounced save to Firestore using the resolved planKey
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        const key = planKeyRef.current || memberId!;
        try {
          // Also persist computed pricingResult so the member's page always has correct pricing
          let pricingResult: PricingResult | undefined;
          try { pricingResult = calculatePricing(updated as MemberPlanData); } catch { /* ignore */ }
          const toSave = sanitizeForFirestore(pricingResult
            ? { ...updated, pricingResult, updatedAt: serverTimestamp() }
            : { ...updated, updatedAt: serverTimestamp() });
          await setDoc(doc(db, 'member_plans', key), toSave, { merge: true });
          setSaveStatus('saved');
          if (saveStatusTimer.current) clearTimeout(saveStatusTimer.current);
          saveStatusTimer.current = setTimeout(() => setSaveStatus('idle'), 2000);

          // If pricing fields changed, persist as coach's preferred defaults
          const pricingKeys: (keyof MemberPlanData)[] = ['hourlyRate', 'sessionLengthMinutes', 'checkInCallMinutes', 'programBuildTimeHours'];
          const hasPricingChange = pricingKeys.some(k => k in updates);
          if (hasPricingChange && user) {
            const coachDocId = coachUid;
            const pricingDefaults: Record<string, number> = {};
            if (updated.hourlyRate != null) pricingDefaults.hourlyRate = updated.hourlyRate;
            if (updated.sessionLengthMinutes != null) pricingDefaults.sessionLengthMinutes = updated.sessionLengthMinutes;
            if (updated.checkInCallMinutes != null) pricingDefaults.checkInCallMinutes = updated.checkInCallMinutes;
            if (updated.programBuildTimeHours != null) pricingDefaults.programBuildTimeHours = updated.programBuildTimeHours;
            try {
              await setDoc(doc(db, 'coach_brands', coachDocId), { defaultPricing: pricingDefaults }, { merge: true });
            } catch (e) {
              console.warn('[pricing defaults] Could not save to coach_brands:', e);
            }
          }
        } catch (err) {
          console.error('Error saving plan:', err);
          setSaveStatus('idle');
        }
      }, 800);
      return updated;
    });
  }, [memberId, user]);

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
  // Share Payment Link — generates a Stripe checkout URL and copies it
  const handleSharePaymentLink = async () => {
    if (!plan || !user) return;
    const planId = planKeyRef.current || plan.id;
    if (!planId) return;
    setPaymentLinkLoading(true);
    try {
      const functions = getFunctions();
      const createCheckout = httpsCallable<
        { planId: string; memberId: string; paymentOption: 'monthly' | 'pay_in_full' },
        { sessionUrl: string; intentId: string; snapshotId: string }
      >(functions, 'createCheckoutSession');
      const result = await createCheckout({
        planId,
        memberId: plan.memberId,
        paymentOption: 'monthly', // default to monthly for share
      });
      const { sessionUrl } = result.data;
      if (sessionUrl && Platform.OS === 'web' && navigator.clipboard) {
        await navigator.clipboard.writeText(sessionUrl);
        setPaymentLinkCopied(true);
        setTimeout(() => setPaymentLinkCopied(false), 3000);
      } else if (sessionUrl) {
        // Native fallback — alert the URL so coach can copy manually
        if (typeof alert !== 'undefined') alert(sessionUrl);
        setPaymentLinkCopied(true);
        setTimeout(() => setPaymentLinkCopied(false), 3000);
      }
    } catch (err: any) {
      console.error('[handleSharePaymentLink] Error:', err);
      // Silently fail — the coach can use the inline Copy Payment Link button instead
    } finally {
      setPaymentLinkLoading(false);
    }
  };

  const handleShare = async () => {
    const url = `https://goarrive.web.app/shared-plan/${memberId}`;
    try {
      // Auto-set status to 'presented' when sharing if still draft
      if (plan && (!plan.status || plan.status === 'draft')) {
        handlePlanChange({ status: 'presented' } as any);
      }
      if (Platform.OS === 'web' && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);

      // Write in-app notification so member sees a badge/alert on their My Plan page
      try {
        const memberUid = planKeyRef.current || memberId!;
        await addDoc(collection(db, 'notifications'), {
          recipientId: memberUid,
          type: 'plan_shared',
          title: 'Your plan has been updated',
          body: `${user?.displayName || 'Your coach'} has shared your fitness plan with you.`,
          coachId: coachUid,
          planId: memberUid,
          read: false,
          createdAt: serverTimestamp(),
        });
      } catch (notifErr) {
        console.warn('[handleShare] Could not write notification:', notifErr);
      }
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
    <View style={{ flex: 1, backgroundColor: BG, ...(Platform.OS === 'web' ? { height: '100dvh', maxHeight: '100dvh', overflow: 'hidden' } as any : {}) }}>
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
              <View style={{ backgroundColor: 'rgba(245,166,35,0.2)', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                <Text style={{ fontSize: 8, fontWeight: '700', color: '#F5A623', letterSpacing: 0.8 }}>BETA</Text>
              </View>
            </Pressable>
            <Pressable onPress={() => setIsCoachMode(false)}
              style={[mt.btn, !isCoachMode && mt.btnActive]}>
              <Text style={{ fontSize: 14 }}>👁️</Text>
              <Text style={[mt.btnText, !isCoachMode && mt.btnTextActive]}>Member View</Text>
            </Pressable>
          </View>
          {/* Save status indicator — only visible to coach while in Coach mode */}
          {isCoachMode && saveStatus !== 'idle' && (
            <Text style={{ color: saveStatus === 'saved' ? '#6EBB7A' : MUTED, fontSize: 11, textAlign: 'right', marginTop: 4 }}>
              {saveStatus === 'saving' ? 'Saving…' : '✓ Saved'}
            </Text>
          )}
        </View>
      )}

      {/* ─── CONTENT ──────────────────────────────────────────────────────── */}
      {tab === 'questionnaire' ? (
        <QuestionnaireViewer
          data={questionnaire}
          memberId={memberId || ''}
          onSaved={(updated) => setQuestionnaire(updated)}
        />
      ) : plan ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 280 }}>
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
          <Pressable onPress={handleShare} style={[ab.shareBtn, { flex: 1 }]}>
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
