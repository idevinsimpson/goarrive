/**
 * MemberDetail — Member Hub bottom sheet
 *
 * Tapping a member opens this full-featured hub. The top section shows the
 * member's name, contact info, and quick-action buttons. Below that is a grid
 * of action tiles — some live now, others marked "Coming Soon" for future
 * features described in the GoArrive blueprint.
 *
 * Live actions:
 *   - View Plan / Intake (navigates to member-plan page)
 *   - Edit Profile (opens MemberForm)
 *   - Archive / Restore
 *   - Schedule (assign recurring time slot with multi-day support)
 *
 * Coming Soon tiles (future blueprint features):
 *   - Workouts & Playlist
 *   - Sessions & Stats
 *   - Messages
 *   - Check-in Call
 *   - Measurements & Photos
 *   - Coach Notes
 *   - Referrals
 *   - Coach Videos
 *   - Journal
 *   - Send Password Reset
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Platform,
  Alert,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { db, functions } from '../lib/firebase';
import { doc, onSnapshot, collection, query, where, getDocs, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Icon } from './Icon';
import { router } from 'expo-router';
import { DAY_LABELS, DAY_SHORT_LABELS, formatTime, addMinutesToTime, type GuidancePhase, type SessionType, type RoomSource } from '../lib/schedulingTypes';
import { type Phase, type MemberPlanData, type SessionTypeGuidance, type GuidanceLevel, resolvePhaseColor } from '../lib/planTypes';
import { defaultHostingMode, defaultCoachExpectedLive } from '../lib/schedulingTypes';

const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

const BG = '#0E1117';
const CARD = '#111827';
const CARD2 = '#151B28';
const BORDER = '#1E2A3A';
const MUTED = '#8A95A3';
const GOLD = '#F5A623';
const GREEN = '#6EBB7A';
const BLUE = '#5B9BD5';
const RED = '#E05252';

const { width: SCREEN_W } = Dimensions.get('window');

// ── Slider constants ────────────────────────────────────────────────────────
const SLIDER_TRACK_WIDTH = Math.min(SCREEN_W - 80, 340);
const HANDLE_SIZE = 28;
const STEP = 5; // 5-minute increments

interface MemberDetailProps {
  member: any;
  onClose: () => void;
  onEdit: (member: any) => void;
  onArchive: (member: any) => void;
}

interface HubTile {
  icon: string;
  label: string;
  sublabel?: string;
  color: string;
  bgColor: string;
  live: boolean;
  onPress?: () => void;
}

// ── Time slot options ────────────────────────────────────────────────────────
const TIME_OPTIONS: string[] = [];
for (let h = 5; h <= 21; h++) {
  for (let m = 0; m < 60; m += 15) {
    TIME_OPTIONS.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
  }
}

const DURATION_OPTIONS = [15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];

const TIMEZONE_OPTIONS = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'Pacific/Honolulu',
];

// Phase mapping: plan intensity → scheduling guidance phase
const INTENSITY_TO_PHASE: Record<string, GuidancePhase> = {
  'Fully Guided': 'coach_guided',
  'Shared Guidance': 'shared_guidance',
  'Self-Reliant': 'self_guided',
};

// Map GuidanceLevel (plan types) → GuidancePhase (scheduling types)
const GUIDANCE_LEVEL_TO_PHASE: Record<GuidanceLevel, GuidancePhase> = {
  'Fully guided': 'coach_guided',
  'Blended': 'shared_guidance',
  'Self-reliant': 'self_guided',
};

// Map scheduling session type → plan session type for guidance profile lookup
const SCHED_TO_PLAN_SESSION_TYPE: Record<SessionType, string> = {
  strength: 'Strength',
  cardio: 'Cardio + Mobility',
  flexibility: 'Cardio + Mobility',
  hiit: 'Mix',
  recovery: 'Rest',
  check_in: 'check_in', // special: always coach_guided
};

// Phase colors for scheduling UI — matches planTypes.ts phaseColors
const SCHED_PHASE_COLORS: Record<GuidancePhase, string> = {
  coach_guided: GREEN,
  shared_guidance: '#5B9BD5',
  self_guided: '#FFC000',
};

const SCHED_PHASE_LABELS: Record<GuidancePhase, string> = {
  coach_guided: 'Coach Guided',
  shared_guidance: 'Shared Guidance',
  self_guided: 'Self Guided',
};

// ── Multi-day state type ────────────────────────────────────────────────────
interface DayTimeEntry {
  dayOfWeek: number;
  startTime: string;
}

// ── Dual-Handle Range Slider (web-native pointer events for smooth dragging) ─
function DualHandleSlider({
  totalMinutes,
  liveStart,
  liveEnd,
  onChangeStart,
  onChangeEnd,
}: {
  totalMinutes: number;
  liveStart: number;
  liveEnd: number;
  onChangeStart: (v: number) => void;
  onChangeEnd: (v: number) => void;
}) {
  const trackRef = useRef<View>(null);
  const trackLeft = useRef(0);
  const dragType = useRef<'left' | 'right' | 'middle' | null>(null);
  const dragStartX = useRef(0);
  const dragStartLiveStart = useRef(0);
  const dragStartLiveEnd = useRef(0);

  const trackWidth = SLIDER_TRACK_WIDTH;
  const minToX = (min: number) => (min / totalMinutes) * trackWidth;
  const xToMin = (x: number) => {
    const raw = (x / trackWidth) * totalMinutes;
    return Math.max(0, Math.min(Math.round(raw / STEP) * STEP, totalMinutes));
  };

  // Measure track position on mount and layout changes
  const measureTrack = useCallback(() => {
    if (Platform.OS === 'web' && trackRef.current) {
      const el = trackRef.current as any;
      if (el.getBoundingClientRect) {
        trackLeft.current = el.getBoundingClientRect().left;
      } else if (el.measure) {
        el.measure((_x: number, _y: number, _w: number, _h: number, px: number) => {
          trackLeft.current = px;
        });
      }
    }
  }, []);

  const getPointerX = useCallback((e: any): number => {
    if (e.clientX !== undefined) return e.clientX;
    if (e.nativeEvent?.pageX !== undefined) return e.nativeEvent.pageX;
    if (e.touches?.[0]?.clientX !== undefined) return e.touches[0].clientX;
    return 0;
  }, []);

  const handlePointerDown = useCallback((type: 'left' | 'right' | 'middle') => (e: any) => {
    e.preventDefault?.();
    e.stopPropagation?.();
    measureTrack();
    dragType.current = type;
    dragStartX.current = getPointerX(e);
    dragStartLiveStart.current = liveStart;
    dragStartLiveEnd.current = liveEnd;

    const onMove = (ev: any) => {
      ev.preventDefault?.();
      const clientX = ev.clientX ?? ev.touches?.[0]?.clientX ?? 0;
      const dx = clientX - dragStartX.current;
      const dMin = xToMin(Math.abs(dx)) * (dx < 0 ? -1 : 1);

      if (dragType.current === 'left') {
        const newStart = Math.max(0, Math.min(dragStartLiveStart.current + dMin, dragStartLiveEnd.current - STEP));
        const snapped = Math.round(newStart / STEP) * STEP;
        onChangeStart(Math.max(0, Math.min(snapped, liveEnd - STEP)));
      } else if (dragType.current === 'right') {
        const newEnd = Math.max(dragStartLiveStart.current + STEP, Math.min(dragStartLiveEnd.current + dMin, totalMinutes));
        const snapped = Math.round(newEnd / STEP) * STEP;
        onChangeEnd(Math.max(liveStart + STEP, Math.min(snapped, totalMinutes)));
      } else if (dragType.current === 'middle') {
        const duration = dragStartLiveEnd.current - dragStartLiveStart.current;
        let newStart = dragStartLiveStart.current + dMin;
        newStart = Math.round(newStart / STEP) * STEP;
        newStart = Math.max(0, Math.min(newStart, totalMinutes - duration));
        onChangeStart(newStart);
        onChangeEnd(newStart + duration);
      }
    };

    const onUp = () => {
      dragType.current = null;
      if (Platform.OS === 'web') {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onUp);
      }
    };

    if (Platform.OS === 'web') {
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onUp);
    }
  }, [liveStart, liveEnd, totalMinutes, measureTrack, getPointerX, onChangeStart, onChangeEnd]);

  const leftX = minToX(liveStart);
  const rightX = minToX(liveEnd);
  const liveWidth = rightX - leftX;
  const selfLeftWidth = leftX;
  const selfRightWidth = trackWidth - rightX;
  const liveDuration = liveEnd - liveStart;

  return (
    <View style={sl.container}>
      {/* Labels row */}
      <View style={sl.labelsRow}>
        {liveStart > 0 && (
          <Text style={[sl.zoneLabel, { width: selfLeftWidth, textAlign: 'center' }]} numberOfLines={1}>
            {liveStart}m solo
          </Text>
        )}
        <Text
          style={[sl.zoneLabelLive, { width: Math.max(liveWidth, 50), textAlign: 'center', marginLeft: liveStart === 0 ? 0 : undefined }]}
          numberOfLines={1}
        >
          {liveDuration}m live
        </Text>
        {liveEnd < totalMinutes && (
          <Text style={[sl.zoneLabel, { width: selfRightWidth, textAlign: 'center' }]} numberOfLines={1}>
            {totalMinutes - liveEnd}m solo
          </Text>
        )}
      </View>

      {/* Track */}
      <View
        ref={trackRef}
        onLayout={measureTrack}
        style={[sl.track, { width: trackWidth }]}
      >
        {/* Self-guided left zone */}
        {selfLeftWidth > 0 && (
          <View style={[sl.zoneSelf, { width: selfLeftWidth, borderTopLeftRadius: 8, borderBottomLeftRadius: 8 }]} />
        )}
        {/* Live coaching zone — draggable as a whole */}
        <View
          onPointerDown={handlePointerDown('middle')}
          onTouchStart={handlePointerDown('middle')}
          style={[sl.zoneLive, {
            width: Math.max(liveWidth, 4),
            borderTopLeftRadius: selfLeftWidth === 0 ? 8 : 0,
            borderBottomLeftRadius: selfLeftWidth === 0 ? 8 : 0,
            borderTopRightRadius: selfRightWidth === 0 ? 8 : 0,
            borderBottomRightRadius: selfRightWidth === 0 ? 8 : 0,
            ...(Platform.OS === 'web' ? { cursor: 'grab' } : {}),
          }]}
        />
        {/* Self-guided right zone */}
        {selfRightWidth > 0 && (
          <View style={[sl.zoneSelf, { width: selfRightWidth, borderTopRightRadius: 8, borderBottomRightRadius: 8 }]} />
        )}

        {/* Left handle */}
        <View
          onPointerDown={handlePointerDown('left')}
          onTouchStart={handlePointerDown('left')}
          style={[sl.handle, { left: leftX - HANDLE_SIZE / 2 }]}
        >
          <View style={sl.handleInner}>
            <View style={sl.handleGrip} />
            <View style={sl.handleGrip} />
          </View>
        </View>

        {/* Right handle */}
        <View
          onPointerDown={handlePointerDown('right')}
          onTouchStart={handlePointerDown('right')}
          style={[sl.handle, { left: rightX - HANDLE_SIZE / 2 }]}
        >
          <View style={sl.handleInner}>
            <View style={sl.handleGrip} />
            <View style={sl.handleGrip} />
          </View>
        </View>
      </View>

      {/* Time markers */}
      <View style={[sl.markersRow, { width: trackWidth }]}>
        <Text style={sl.marker}>0m</Text>
        <Text style={sl.marker}>{Math.round(totalMinutes / 2)}m</Text>
        <Text style={sl.marker}>{totalMinutes}m</Text>
      </View>

      {/* Summary text */}
      <View style={sl.summaryRow}>
        <Text style={sl.summaryHighlight}>
          {liveDuration} min on your calendar
        </Text>
      </View>
    </View>
  );
}

export default function MemberDetail({
  member,
  onClose,
  onEdit,
  onArchive,
}: MemberDetailProps) {
  const [currentMember, setCurrentMember] = useState(member);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [existingSlots, setExistingSlots] = useState<any[]>([]);

  // Plan data for phase sync
  const [memberPlan, setMemberPlan] = useState<MemberPlanData | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planPhaseOverride, setPlanPhaseOverride] = useState(false);

  // Schedule form state — multi-day
  const [selectedDays, setSelectedDays] = useState<DayTimeEntry[]>([
    { dayOfWeek: 1, startTime: '06:00' },
  ]);
  const [editingTimeForDay, setEditingTimeForDay] = useState<number | null>(null);

  // Shared settings for all days in this batch
  const [selectedDuration, setSelectedDuration] = useState(30);
  const [selectedTimezone, setSelectedTimezone] = useState('America/New_York');
  const [selectedPattern, setSelectedPattern] = useState<'weekly' | 'biweekly' | 'monthly'>('weekly');
  const [selectedWeekOfMonth, setSelectedWeekOfMonth] = useState<1 | 2 | 3 | 4>(1);
  const [selectedSessionType, setSelectedSessionType] = useState<SessionType>('strength');
  const [selectedPhase, setSelectedPhase] = useState<GuidancePhase>('coach_guided');
  const [creating, setCreating] = useState(false);

  // Phase transition control
  const [transitionPhase, setTransitionPhase] = useState<GuidancePhase | null>(null);
  const [transitioning, setTransitioning] = useState(false);

  // Editing existing slot
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);

  // Shared Guidance Window: dual-handle live coaching window (in minutes from session start)
  // Defaults to centered — equal solo time on both sides
  const [liveStart, setLiveStart] = useState(Math.round((selectedDuration * 0.25) / STEP) * STEP);
  const [liveEnd, setLiveEnd] = useState(Math.round((selectedDuration * 0.75) / STEP) * STEP);

  // ── Transition awareness: which phase is the member currently in? ────────
  const currentPhaseInfo = useMemo(() => {
    if (!memberPlan?.phases?.length) return null;
    const startDate = memberPlan.planStartDate
      ? new Date(memberPlan.planStartDate)
      : memberPlan.createdAt?.toDate
        ? memberPlan.createdAt.toDate()
        : null;
    if (!startDate) return null;
    const now = new Date();
    const elapsedWeeks = Math.max(0, Math.floor((now.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)));
    let cumulativeWeeks = 0;
    for (const phase of memberPlan.phases) {
      cumulativeWeeks += phase.weeks || 0;
      if (elapsedWeeks < cumulativeWeeks) {
        return { phase, elapsedWeeks, cumulativeWeeks, startDate };
      }
    }
    // Past all phases — in the last phase
    const lastPhase = memberPlan.phases[memberPlan.phases.length - 1];
    return { phase: lastPhase, elapsedWeeks, cumulativeWeeks, startDate };
  }, [memberPlan]);

  // ── CTS awareness ───────────────────────────────────────────────────────
  const hasCTS = useMemo(() => {
    return memberPlan?.pricing?.commitToSave === true;
  }, [memberPlan]);

  // Keep live window within duration when duration changes, re-center if needed
  useEffect(() => {
    const quarter = Math.round((selectedDuration * 0.25) / STEP) * STEP;
    const threeQuarter = Math.round((selectedDuration * 0.75) / STEP) * STEP;
    if (liveEnd > selectedDuration || liveStart >= selectedDuration || liveStart >= liveEnd) {
      // Re-center when duration shrinks below current window
      setLiveStart(quarter);
      setLiveEnd(threeQuarter);
    }
  }, [selectedDuration]);

  // Default duration from plan's sessionLengthMinutes (on plan load)
  useEffect(() => {
    if (memberPlan?.pricing?.sessionLengthMinutes) {
      const planDuration = memberPlan.pricing.sessionLengthMinutes;
      if (DURATION_OPTIONS.includes(planDuration)) {
        setSelectedDuration(planDuration);
        // Re-center the slider for the new duration
        setLiveStart(Math.round((planDuration * 0.25) / STEP) * STEP);
        setLiveEnd(Math.round((planDuration * 0.75) / STEP) * STEP);
      }
    }
  }, [memberPlan]);

  // ── Load member data ──────────────────────────────────────────────────────
  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'members', member.id), (snapshot) => {
      if (snapshot.exists()) {
        setCurrentMember({ id: snapshot.id, ...snapshot.data() });
      }
    });
    return () => unsubscribe();
  }, [member.id]);

  // Load existing slots for this member
  useEffect(() => {
    if (!member.id) return;
    const q = query(
      collection(db, 'recurring_slots'),
      where('memberId', '==', member.id),
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      setExistingSlots(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsubscribe();
  }, [member.id]);

  // ── Load member plan for phase sync ───────────────────────────────────────
  useEffect(() => {
    if (!member.id || !showScheduleModal) return;
    let cancelled = false;
    (async () => {
      setPlanLoading(true);
      try {
        const planDoc = await getDoc(doc(db, 'member_plans', member.id));
        if (planDoc.exists() && !cancelled) {
          setMemberPlan(planDoc.data() as MemberPlanData);
        } else {
          const q = query(collection(db, 'member_plans'), where('memberId', '==', member.id));
          const snap = await getDocs(q);
          if (!snap.empty && !cancelled) {
            setMemberPlan(snap.docs[0].data() as MemberPlanData);
          }
        }
      } catch (err) {
        console.warn('[MemberDetail] Failed to load plan:', err);
      }
      if (!cancelled) setPlanLoading(false);
    })();
    return () => { cancelled = true; };
  }, [member.id, showScheduleModal]);

  // ── Derived phase data from plan ──────────────────────────────────────────
  const planPhases = useMemo(() => {
    if (!memberPlan?.phases?.length) return null;
    return memberPlan.phases;
  }, [memberPlan]);

  const totalWeeks = useMemo(() => {
    if (!planPhases) return 0;
    return planPhases.reduce((sum, p) => sum + (p.weeks || 0), 0);
  }, [planPhases]);

  const phaseWeekMap = useMemo(() => {
    const map: Record<GuidancePhase, number> = { coach_guided: 0, shared_guidance: 0, self_guided: 0 };
    if (!planPhases) return map;
    for (const p of planPhases) {
      const schedPhase = INTENSITY_TO_PHASE[p.intensity];
      if (schedPhase) map[schedPhase] += p.weeks;
    }
    return map;
  }, [planPhases]);

  // ── Auto-determine guidance phase from plan's sessionGuidanceProfiles ─────
  const autoPhaseForSessionType = useMemo((): GuidancePhase | null => {
    if (!memberPlan || planPhaseOverride) return null;
    // Check-in is always coach_guided
    if (selectedSessionType === 'check_in') return 'coach_guided';
    // Find the current phase index based on elapsed weeks
    const phases = memberPlan.phases;
    if (!phases?.length) return null;
    const startDate = memberPlan.createdAt?.toDate ? memberPlan.createdAt.toDate() : null;
    if (!startDate) return null;
    const now = new Date();
    const elapsedWeeks = Math.max(0, Math.floor((now.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)));
    let currentPhaseIdx = phases.length - 1;
    let cumulativeWeeks = 0;
    for (let i = 0; i < phases.length; i++) {
      cumulativeWeeks += phases[i].weeks || 0;
      if (elapsedWeeks < cumulativeWeeks) { currentPhaseIdx = i; break; }
    }
    // Look up the guidance profile for this session type
    const profiles = memberPlan.sessionGuidanceProfiles;
    if (!profiles?.length) {
      // Fallback: use the phase intensity
      const phase = phases[currentPhaseIdx];
      return INTENSITY_TO_PHASE[phase.intensity] || 'coach_guided';
    }
    const planSessionType = SCHED_TO_PLAN_SESSION_TYPE[selectedSessionType];
    const profile = profiles.find(p => p.sessionType === planSessionType);
    if (!profile) {
      const phase = phases[currentPhaseIdx];
      return INTENSITY_TO_PHASE[phase.intensity] || 'coach_guided';
    }
    // Map phase index to phase1/phase2/phase3
    const phaseKey = currentPhaseIdx === 0 ? 'phase1' : currentPhaseIdx === 1 ? 'phase2' : 'phase3';
    const guidanceLevel = profile[phaseKey as keyof SessionTypeGuidance] as GuidanceLevel;
    return GUIDANCE_LEVEL_TO_PHASE[guidanceLevel] || 'coach_guided';
  }, [memberPlan, selectedSessionType, planPhaseOverride]);

  // Auto-set the guidance phase when session type changes (unless overriding)
  useEffect(() => {
    if (autoPhaseForSessionType && !planPhaseOverride) {
      setSelectedPhase(autoPhaseForSessionType);
    }
  }, [autoPhaseForSessionType, planPhaseOverride]);

  // ── Session types that already have active slots ──────────────────────────
  const usedSessionTypes = useMemo(() => {
    const used = new Set<string>();
    for (const slot of existingSlots) {
      if (slot.status === 'active' || slot.status === 'paused') {
        if (slot.sessionType) used.add(slot.sessionType);
      }
    }
    return used;
  }, [existingSlots]);

  // ── Check-in defaults: auto-set monthly recurrence when check-in selected ──
  useEffect(() => {
    if (selectedSessionType === 'check_in') {
      setSelectedPattern('monthly');
      setSelectedPhase('coach_guided');
    }
  }, [selectedSessionType]);

  const initials = currentMember.name
    ? currentMember.name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((w: string) => w[0]?.toUpperCase() ?? '')
        .join('')
    : '?';

  function navigateToPlan() {
    onClose();
    router.push(`/(app)/member-plan/${currentMember.id}` as any);
  }

  // ── Multi-day toggle ──────────────────────────────────────────────────────
  function toggleDay(dayIdx: number) {
    setSelectedDays(prev => {
      const exists = prev.find(d => d.dayOfWeek === dayIdx);
      if (exists) {
        if (prev.length <= 1) return prev;
        return prev.filter(d => d.dayOfWeek !== dayIdx);
      }
      return [...prev, { dayOfWeek: dayIdx, startTime: '06:00' }].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
    });
  }

  function updateDayTime(dayIdx: number, time: string) {
    setSelectedDays(prev =>
      prev.map(d => d.dayOfWeek === dayIdx ? { ...d, startTime: time } : d)
    );
    setEditingTimeForDay(null);
  }

  // ── Room source auto-routing ──────────────────────────────────────────────
  // Shared Guidance ALWAYS uses shared pool (round-robin)
  const resolvedRoomSource = useMemo((): RoomSource => {
    if (selectedPhase === 'coach_guided') return 'coach_personal';
    // Both shared_guidance and self_guided use shared pool
    return 'shared_pool';
  }, [selectedPhase]);

  // ── Reset form to defaults ──────────────────────────────────────────────────
  const resetForm = useCallback(() => {
    setSelectedDays([{ dayOfWeek: 1, startTime: '06:00' }]);
    setSelectedSessionType('strength');
    setSelectedPhase('coach_guided');
    setSelectedPattern('weekly');
    setSelectedWeekOfMonth(1);
    setSelectedTimezone('America/New_York');
    const dur = memberPlan?.pricing?.sessionLengthMinutes || 30;
    setSelectedDuration(DURATION_OPTIONS.includes(dur) ? dur : 30);
    setLiveStart(Math.round((dur * 0.25) / STEP) * STEP);
    setLiveEnd(Math.round((dur * 0.75) / STEP) * STEP);
    setEditingSlotId(null);
    setPlanPhaseOverride(false);
  }, [memberPlan]);

  // ── Edit existing slot: populate form with slot data ──────────────────────
  const handleEditSlot = useCallback((slot: any) => {
    setEditingSlotId(slot.id);
    setSelectedSessionType(slot.sessionType || 'strength');
    setSelectedPhase(slot.guidancePhase || 'coach_guided');
    setSelectedDays([{ dayOfWeek: slot.dayOfWeek, startTime: slot.startTime || '06:00' }]);
    setSelectedDuration(slot.durationMinutes || 30);
    setSelectedPattern(slot.recurrencePattern || 'weekly');
    if (slot.weekOfMonth) setSelectedWeekOfMonth(slot.weekOfMonth);
    setSelectedTimezone(slot.timezone || 'America/New_York');
    if (slot.liveCoachingStartMin !== undefined) setLiveStart(slot.liveCoachingStartMin);
    if (slot.liveCoachingEndMin !== undefined) setLiveEnd(slot.liveCoachingEndMin);
    setPlanPhaseOverride(true); // allow manual control when editing
  }, []);

  // ── Create slots (one per selected day) ───────────────────────────────────
  const handleCreateSlots = useCallback(async () => {
    setCreating(true);
    try {
      const fn = httpsCallable(functions, editingSlotId ? 'updateRecurringSlot' : 'createRecurringSlot');
      let totalInstances = 0;
      const dayNames: string[] = [];

      for (const entry of selectedDays) {
        const hostingMode = defaultHostingMode(selectedPhase);
        const coachExpectedLive = defaultCoachExpectedLive(selectedPhase);
        const payload: Record<string, any> = editingSlotId ? {
          slotId: editingSlotId,
          action: 'update',
          dayOfWeek: entry.dayOfWeek,
          startTime: entry.startTime,
          durationMinutes: selectedDuration,
          timezone: selectedTimezone,
          recurrencePattern: selectedPattern,
          weekOfMonth: selectedPattern === 'monthly' ? selectedWeekOfMonth : undefined,
          sessionType: selectedSessionType,
          guidancePhase: selectedPhase,
          roomSource: resolvedRoomSource,
          coachJoining: selectedPhase === 'coach_guided',
          hostingMode,
          coachExpectedLive,
          personalZoomRequired: selectedPhase === 'coach_guided',
          commitToSaveEnabled: hasCTS,
        } : {
          memberId: member.id,
          memberName: currentMember.name || 'Unknown',
          dayOfWeek: entry.dayOfWeek,
          startTime: entry.startTime,
          durationMinutes: selectedDuration,
          timezone: selectedTimezone,
          recurrencePattern: selectedPattern,
          weekOfMonth: selectedPattern === 'monthly' ? selectedWeekOfMonth : undefined,
          sessionType: selectedSessionType,
          guidancePhase: selectedPhase,
          roomSource: resolvedRoomSource,
          coachJoining: selectedPhase === 'coach_guided',
          hostingMode,
          coachExpectedLive,
          personalZoomRequired: selectedPhase === 'coach_guided',
          commitToSaveEnabled: hasCTS,
        };

        // For shared_guidance, include the live coaching window
        if (selectedPhase === 'shared_guidance') {
          payload.coachJoining = true; // coach joins for part of the session
          payload.liveCoachingStartMin = liveStart;
          payload.liveCoachingEndMin = liveEnd;
          payload.liveCoachingDuration = liveEnd - liveStart;
        }

        const result = await fn(payload);
        const data = result.data as any;
        totalInstances += data.instancesGenerated || data.updatedInstances || 0;
        dayNames.push(`${DAY_LABELS[entry.dayOfWeek]} ${formatTime(entry.startTime)}`);
      }

      const liveInfo = selectedPhase === 'shared_guidance'
        ? `\n\nLive coaching: ${liveStart}\u2013${liveEnd} min (${liveEnd - liveStart} min on your calendar)`
        : '';

      Alert.alert(
        editingSlotId ? 'Slot Updated' : (selectedDays.length > 1 ? 'Slots Created' : 'Slot Created'),
        editingSlotId
          ? `Slot updated: ${dayNames.join(', ')}${liveInfo}`
          : `${selectedDays.length} recurring slot${selectedDays.length > 1 ? 's' : ''} created:\n${dayNames.join(', ')}\n\n${totalInstances} total sessions generated for the next 4 weeks.${liveInfo}`
      );
      // Reset form after successful creation
      resetForm();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to create slot(s)');
    }
    setCreating(false);
  }, [member.id, currentMember.name, selectedDays, selectedDuration, selectedTimezone, selectedPattern, selectedWeekOfMonth, selectedSessionType, selectedPhase, resolvedRoomSource, liveStart, liveEnd, editingSlotId, hasCTS, resetForm]);

  const handlePauseSlot = useCallback(async (slotId: string) => {
    try {
      const fn = httpsCallable(functions, 'updateRecurringSlot');
      await fn({ slotId, action: 'pause' });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to pause slot');
    }
  }, []);

  const handleResumeSlot = useCallback(async (slotId: string) => {
    try {
      const fn = httpsCallable(functions, 'updateRecurringSlot');
      await fn({ slotId, action: 'resume' });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to resume slot');
    }
  }, []);

  const handleCancelSlot = useCallback(async (slotId: string) => {
    try {
      const fn = httpsCallable(functions, 'updateRecurringSlot');
      const result = await fn({ slotId, action: 'cancel' });
      const data = result.data as any;
      Alert.alert('Slot Cancelled', `${data.instancesCancelled || 0} future sessions cancelled.`);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to cancel slot');
    }
  }, []);

  const handlePhaseTransition = useCallback(async (newPhase: GuidancePhase) => {
    setTransitioning(true);
    try {
      const fn = httpsCallable(functions, 'updateMemberGuidancePhase');
      const result = await fn({ memberId: member.id, newPhase });
      const data = result.data as any;
      Alert.alert(
        'Phase Updated',
        `Transitioned to ${SCHED_PHASE_LABELS[newPhase]}.\n${data.updatedInstances || 0} session(s) and ${data.updatedSlots || 0} slot(s) updated.`
      );
      setTransitionPhase(null);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to transition phase');
    } finally {
      setTransitioning(false);
    }
  }, [member.id]);

  const activeSlots = existingSlots.filter(s => s.status === 'active' || s.status === 'paused');
  const scheduleSubLabel = activeSlots.length > 0
    ? `${activeSlots.length} active slot${activeSlots.length !== 1 ? 's' : ''}`
    : 'Assign recurring time';

  const tiles: HubTile[] = [
    {
      icon: 'document',
      label: 'Plan & Intake',
      sublabel: 'View & edit fitness plan',
      color: GOLD,
      bgColor: 'rgba(245,166,35,0.1)',
      live: true,
      onPress: navigateToPlan,
    },
    {
      icon: 'fitness',
      label: 'Workouts',
      sublabel: 'Playlist & rotation',
      color: GREEN,
      bgColor: 'rgba(110,187,122,0.1)',
      live: false,
    },
    {
      icon: 'activity',
      label: 'Sessions & Stats',
      sublabel: 'Past & upcoming sessions',
      color: BLUE,
      bgColor: 'rgba(125,211,252,0.1)',
      live: false,
    },
    {
      icon: 'calendar',
      label: 'Schedule',
      sublabel: scheduleSubLabel,
      color: '#A78BFA',
      bgColor: 'rgba(167,139,250,0.1)',
      live: true,
      onPress: () => setShowScheduleModal(true),
    },
    {
      icon: 'mail',
      label: 'Messages',
      sublabel: 'Direct communication',
      color: BLUE,
      bgColor: 'rgba(125,211,252,0.1)',
      live: false,
    },
    {
      icon: 'play-circle',
      label: 'Check-in Call',
      sublabel: 'Start Zoom session',
      color: GREEN,
      bgColor: 'rgba(110,187,122,0.1)',
      live: false,
    },
    {
      icon: 'trending-up',
      label: 'Measurements',
      sublabel: 'Progress & photos',
      color: GOLD,
      bgColor: 'rgba(245,166,35,0.1)',
      live: false,
    },
    {
      icon: 'edit',
      label: 'Coach Notes',
      sublabel: 'Check-in call notes',
      color: '#F472B6',
      bgColor: 'rgba(244,114,182,0.1)',
      live: false,
    },
    {
      icon: 'person',
      label: 'Referrals',
      sublabel: 'Members they referred',
      color: GOLD,
      bgColor: 'rgba(245,166,35,0.1)',
      live: false,
    },
    {
      icon: 'share',
      label: 'Coach Videos',
      sublabel: 'Social content for member',
      color: '#F472B6',
      bgColor: 'rgba(244,114,182,0.1)',
      live: false,
    },
    {
      icon: 'document',
      label: 'Journal',
      sublabel: 'Entries & comments',
      color: GREEN,
      bgColor: 'rgba(110,187,122,0.1)',
      live: false,
    },
    {
      icon: 'lock',
      label: 'Password Reset',
      sublabel: 'Send reset link',
      color: MUTED,
      bgColor: 'rgba(138,149,163,0.1)',
      live: false,
    },
  ];

  // ── Phase Timeline Component ──────────────────────────────────────────────
  function PhaseTimeline() {
    if (!planPhases || planPhases.length === 0) return null;
    const barWidth = SCREEN_W - 80;
    return (
      <View style={s.timelineWrap}>
        <View style={s.timelineHeader}>
          <Text style={s.timelineTitleText}>Plan Phase Timeline</Text>
          <TouchableOpacity
            style={s.editPlanBtn}
            onPress={() => {
              setShowScheduleModal(false);
              navigateToPlan();
            }}
          >
            <Icon name="edit" size={12} color={GOLD} />
            <Text style={s.editPlanBtnText}>Edit Plan</Text>
          </TouchableOpacity>
        </View>
        <View style={s.timelineBar}>
          {planPhases.map((phase, idx) => {
            const pct = totalWeeks > 0 ? (phase.weeks / totalWeeks) : (1 / planPhases!.length);
            const color = resolvePhaseColor(phase.intensity);
            return (
              <View
                key={idx}
                style={[
                  s.timelineSegment,
                  {
                    width: Math.max(pct * barWidth, 30),
                    backgroundColor: color.bar,
                    borderTopLeftRadius: idx === 0 ? 6 : 0,
                    borderBottomLeftRadius: idx === 0 ? 6 : 0,
                    borderTopRightRadius: idx === planPhases!.length - 1 ? 6 : 0,
                    borderBottomRightRadius: idx === planPhases!.length - 1 ? 6 : 0,
                  },
                ]}
              >
                <Text style={s.timelineSegText} numberOfLines={1}>
                  {phase.weeks}w
                </Text>
              </View>
            );
          })}
        </View>
        <View style={s.timelineLegend}>
          {planPhases.map((phase, idx) => {
            const color = resolvePhaseColor(phase.intensity);
            return (
              <View key={idx} style={s.legendItem}>
                <View style={[s.legendDot, { backgroundColor: color.bar }]} />
                <Text style={s.legendText}>{phase.name}: {phase.weeks}w</Text>
              </View>
            );
          })}
          <Text style={[s.legendText, { marginLeft: 'auto' }]}>{totalWeeks} weeks total</Text>
        </View>
      </View>
    );
  }

  return (
    <Modal visible={true} animationType="slide" transparent={true}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          {/* Drag handle */}
          <View style={s.handle} />

          {/* Header */}
          <View style={s.header}>
            <View style={s.avatar}>
              <Text style={s.avatarText}>{initials}</Text>
            </View>
            <View style={s.headerInfo}>
              <Text style={s.name} numberOfLines={1}>
                {currentMember.name}
              </Text>
              <View style={s.headerMeta}>
                {currentMember.isArchived && (
                  <View style={s.archivedBadge}>
                    <Text style={s.archivedBadgeText}>Archived</Text>
                  </View>
                )}
                {currentMember.email ? (
                  <Text style={s.metaText} numberOfLines={1}>{currentMember.email}</Text>
                ) : currentMember.phone ? (
                  <Text style={s.metaText} numberOfLines={1}>{currentMember.phone}</Text>
                ) : null}
              </View>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Icon name="x" size={22} color={MUTED} />
            </TouchableOpacity>
          </View>

          {/* Quick actions row */}
          <View style={s.quickActions}>
            <TouchableOpacity
              style={s.qaBtn}
              onPress={() => onEdit(currentMember)}
            >
              <Icon name="edit" size={16} color={GOLD} />
              <Text style={s.qaBtnText}>Edit Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.qaBtn, currentMember.isArchived && s.qaBtnRestore]}
              onPress={() => onArchive(currentMember)}
            >
              <Icon
                name={currentMember.isArchived ? 'refresh' : 'archive'}
                size={16}
                color={currentMember.isArchived ? GREEN : RED}
              />
              <Text style={[s.qaBtnText, { color: currentMember.isArchived ? GREEN : RED }]}>
                {currentMember.isArchived ? 'Restore' : 'Archive'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Hub grid */}
          <ScrollView
            style={s.body}
            contentContainerStyle={s.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={s.sectionLabel}>MEMBER HUB</Text>
            <View style={s.grid}>
              {tiles.map((tile) => (
                <TouchableOpacity
                  key={tile.label}
                  style={[s.tile, { backgroundColor: tile.bgColor, borderColor: tile.live ? tile.color + '40' : BORDER }]}
                  onPress={tile.live && tile.onPress ? tile.onPress : undefined}
                  activeOpacity={tile.live ? 0.7 : 1}
                >
                  <View style={[s.tileIcon, { backgroundColor: tile.bgColor }]}>
                    <Icon name={tile.icon as any} size={20} color={tile.live ? tile.color : MUTED} />
                  </View>
                  <Text style={[s.tileLabel, { color: tile.live ? '#F0F4F8' : MUTED }]} numberOfLines={1}>
                    {tile.label}
                  </Text>
                  {tile.sublabel ? (
                    <Text style={s.tileSublabel} numberOfLines={1}>{tile.sublabel}</Text>
                  ) : null}
                  {!tile.live && (
                    <View style={s.comingSoonBadge}>
                      <Text style={s.comingSoonText}>Soon</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ height: 20 }} />
          </ScrollView>
        </View>
      </View>

      {/* Schedule Modal */}
      <Modal visible={showScheduleModal} transparent animationType="slide">
        <View style={s.schedOverlay}>
          <View style={s.schedSheet}>
            <ScrollView bounces={false} contentContainerStyle={{ paddingBottom: 40 }}>
              {/* Header */}
              <View style={s.schedHeader}>
                <Text style={s.schedTitle}>Schedule {currentMember.name?.split(' ')[0] || 'Member'}</Text>
                <TouchableOpacity onPress={() => setShowScheduleModal(false)} hitSlop={8}>
                  <Icon name="x" size={22} color={MUTED} />
                </TouchableOpacity>
              </View>

              {/* Plan Phase Timeline */}
              {planLoading ? (
                <View style={{ padding: 20, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color={GOLD} />
                  <Text style={[s.slotMeta, { marginTop: 6 }]}>Loading plan data...</Text>
                </View>
              ) : (
                <>
                  <PhaseTimeline />
                  {/* Current Phase Indicator */}
                  {currentPhaseInfo && (
                    <View style={s.currentPhaseBar}>
                      <View style={[s.currentPhaseDot, { backgroundColor: resolvePhaseColor(currentPhaseInfo.phase.intensity).bar }]} />
                      <Text style={s.currentPhaseText}>
                        Currently in <Text style={{ fontWeight: '700', color: resolvePhaseColor(currentPhaseInfo.phase.intensity).bar }}>{currentPhaseInfo.phase.name}</Text>
                        {' '}(week {currentPhaseInfo.elapsedWeeks + 1})
                      </Text>
                    </View>
                  )}
                  {/* Phase Transition Control */}
                  {currentPhaseInfo && (
                    <View style={s.phaseTransitionBar}>
                      {!transitionPhase ? (
                        <TouchableOpacity
                          style={s.phaseTransitionTrigger}
                          onPress={() => {
                            const currentKey = INTENSITY_TO_PHASE[currentPhaseInfo.phase.intensity] || 'coach_guided';
                            // Default to next phase
                            const order: GuidancePhase[] = ['coach_guided', 'shared_guidance', 'self_guided'];
                            const idx = order.indexOf(currentKey);
                            setTransitionPhase(order[Math.min(idx + 1, order.length - 1)] as GuidancePhase);
                          }}
                        >
                          <Icon name="arrow-right" size={12} color={GOLD} />
                          <Text style={s.phaseTransitionTriggerText}>Transition Phase</Text>
                        </TouchableOpacity>
                      ) : (
                        <View style={s.phaseTransitionPicker}>
                          <Text style={s.phaseTransitionLabel}>Move to:</Text>
                          <View style={s.phaseTransitionOptions}>
                            {([
                              { key: 'coach_guided' as GuidancePhase, label: 'Guided', color: GREEN },
                              { key: 'shared_guidance' as GuidancePhase, label: 'Blended', color: '#5B9BD5' },
                              { key: 'self_guided' as GuidancePhase, label: 'Self-Reliant', color: '#FFC000' },
                            ] as const).map(p => {
                              const currentKey = INTENSITY_TO_PHASE[currentPhaseInfo.phase.intensity] || 'coach_guided';
                              const isCurrent = p.key === currentKey;
                              const isSelected = p.key === transitionPhase;
                              return (
                                <TouchableOpacity
                                  key={p.key}
                                  disabled={isCurrent}
                                  style={[
                                    s.phaseTransitionChip,
                                    isSelected && { backgroundColor: p.color + '20', borderColor: p.color },
                                    isCurrent && { opacity: 0.35 },
                                  ]}
                                  onPress={() => setTransitionPhase(p.key)}
                                >
                                  <Text style={[
                                    s.phaseTransitionChipText,
                                    isSelected && { color: p.color },
                                  ]}>
                                    {isCurrent ? `${p.label} (current)` : p.label}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                          <View style={s.phaseTransitionActions}>
                            <TouchableOpacity
                              style={s.phaseTransitionCancel}
                              onPress={() => setTransitionPhase(null)}
                            >
                              <Text style={s.phaseTransitionCancelText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[
                                s.phaseTransitionConfirm,
                                transitioning && { opacity: 0.5 },
                              ]}
                              disabled={transitioning || !transitionPhase || transitionPhase === (INTENSITY_TO_PHASE[currentPhaseInfo.phase.intensity] || 'coach_guided')}
                              onPress={() => transitionPhase && handlePhaseTransition(transitionPhase)}
                            >
                              <Text style={s.phaseTransitionConfirmText}>
                                {transitioning ? 'Updating...' : 'Confirm Transition'}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      )}
                    </View>
                  )}
                  {/* CTS Indicator */}
                  {hasCTS && (
                    <View style={s.ctsBar}>
                      <Icon name="star" size={14} color={GOLD} />
                      <Text style={s.ctsText}>Commit to Save active — member has a CTS discount</Text>
                    </View>
                  )}
                </>
              )}

              {/* Existing Slots */}
              {activeSlots.length > 0 && (
                <View style={s.schedSection}>
                  <Text style={s.schedSectionTitle}>Current Slots</Text>
                  {activeSlots.map(slot => {
                    const phaseColors: Record<string, string> = { coach_guided: GREEN, shared_guidance: '#5B9BD5', self_guided: '#FFC000' };
                    const phaseLabels: Record<string, string> = { coach_guided: 'Coach Guided', shared_guidance: 'Shared Guidance', self_guided: 'Self Guided' };
                    const stLabel = slot.sessionType === 'check_in' ? 'Check-in' : (slot.sessionType || '').charAt(0).toUpperCase() + (slot.sessionType || '').slice(1);
                    return (
                    <View key={slot.id} style={s.slotCard}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.slotDay}>
                          {DAY_LABELS[slot.dayOfWeek]} · {formatTime(slot.startTime)}
                        </Text>
                        <Text style={s.slotMeta}>
                          {slot.durationMinutes}min · {slot.recurrencePattern === 'biweekly' ? 'Every 2 weeks' : 'Weekly'}
                          {stLabel ? ` · ${stLabel}` : ''}
                        </Text>
                        {slot.guidancePhase && (
                          <Text style={[s.slotMeta, { color: phaseColors[slot.guidancePhase] || MUTED, fontWeight: '600' }]}>
                            {phaseLabels[slot.guidancePhase] || slot.guidancePhase}
                            {slot.guidancePhase === 'shared_guidance' && slot.liveCoachingDuration
                              ? ` (${slot.liveCoachingDuration}min live)`
                              : ''}
                          </Text>
                        )}
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity
                          style={[s.slotActionBtn, { backgroundColor: 'rgba(91,155,213,0.1)' }]}
                          onPress={() => handleEditSlot(slot)}
                        >
                          <Text style={[s.slotActionText, { color: BLUE }]}>Edit</Text>
                        </TouchableOpacity>
                        {slot.status === 'active' ? (
                          <TouchableOpacity
                            style={[s.slotActionBtn, { backgroundColor: 'rgba(245,166,35,0.1)' }]}
                            onPress={() => handlePauseSlot(slot.id)}
                          >
                            <Text style={[s.slotActionText, { color: GOLD }]}>Pause</Text>
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity
                            style={[s.slotActionBtn, { backgroundColor: 'rgba(110,187,122,0.1)' }]}
                            onPress={() => handleResumeSlot(slot.id)}
                          >
                            <Text style={[s.slotActionText, { color: GREEN }]}>Resume</Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          style={[s.slotActionBtn, { backgroundColor: 'rgba(224,82,82,0.1)' }]}
                          onPress={() => handleCancelSlot(slot.id)}
                        >
                          <Text style={[s.slotActionText, { color: RED }]}>Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                    );
                  })}
                </View>
              )}

              {/* New Slot Form */}
              <View style={s.schedSection}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={s.schedSectionTitle}>
                    {editingSlotId ? 'Edit Slot' : (activeSlots.length > 0 ? 'Add More Slots' : 'Create Recurring Slots')}
                  </Text>
                  {editingSlotId && (
                    <TouchableOpacity onPress={resetForm}>
                      <Text style={[s.overrideLink, { color: MUTED }]}>Cancel Edit</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Session Type */}
                <Text style={s.fieldLabel}>Session Type</Text>
                <View style={s.dayRow}>
                  {(['strength', 'cardio', 'flexibility', 'hiit', 'recovery', 'check_in'] as SessionType[]).map(st => {
                    const isUsed = usedSessionTypes.has(st) && !editingSlotId;
                    return (
                      <TouchableOpacity
                        key={st}
                        style={[s.dayBtn, selectedSessionType === st && s.dayBtnActive, isUsed && { opacity: 0.4 }, { minWidth: 70 }]}
                        onPress={() => setSelectedSessionType(st)}
                      >
                        <Text style={[s.dayBtnText, selectedSessionType === st && s.dayBtnTextActive, { fontSize: 12 }]}>
                          {st === 'check_in' ? 'Check-in' : st.charAt(0).toUpperCase() + st.slice(1)}
                        </Text>
                        {isUsed && <Text style={{ fontSize: 8, color: MUTED, fontFamily: FB, marginTop: 1 }}>Active</Text>}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Guidance Phase — with week counts from plan (hidden for check-in) */}
                {selectedSessionType !== 'check_in' && (<>
                <View style={s.phaseHeaderRow}>
                  <Text style={s.fieldLabel}>Guidance Phase</Text>
                  {planPhases && !planPhaseOverride && (
                    <TouchableOpacity onPress={() => setPlanPhaseOverride(true)}>
                      <Text style={s.overrideLink}>Override</Text>
                    </TouchableOpacity>
                  )}
                  {planPhaseOverride && (
                    <TouchableOpacity onPress={() => setPlanPhaseOverride(false)}>
                      <Text style={[s.overrideLink, { color: GREEN }]}>Sync to plan</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={s.dayRow}>
                  {([
                    { key: 'coach_guided' as GuidancePhase, label: 'Coach Guided', color: GREEN },
                    { key: 'shared_guidance' as GuidancePhase, label: 'Shared Guidance', color: '#5B9BD5' },
                    { key: 'self_guided' as GuidancePhase, label: 'Self Guided', color: '#FFC000' },
                  ] as const).map(phase => {
                    const weekCount = phaseWeekMap[phase.key];
                    const isDisabled = !planPhaseOverride && autoPhaseForSessionType !== null && selectedSessionType !== 'check_in';
                    return (
                      <TouchableOpacity
                        key={phase.key}
                        style={[
                          s.phaseBtn,
                          selectedPhase === phase.key && { backgroundColor: phase.color + '18', borderColor: phase.color + '60' },
                          isDisabled && selectedPhase !== phase.key && { opacity: 0.35 },
                        ]}
                        onPress={() => {
                          if (!isDisabled) setSelectedPhase(phase.key);
                        }}
                        disabled={isDisabled}
                      >
                        <Text style={[
                          s.phaseBtnLabel,
                          selectedPhase === phase.key && { color: phase.color },
                        ]}>
                          {phase.label}
                        </Text>
                        {weekCount > 0 && (
                          <Text style={[
                            s.phaseBtnWeeks,
                            selectedPhase === phase.key && { color: phase.color },
                          ]}>
                            {weekCount} weeks
                          </Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {!planPhaseOverride && autoPhaseForSessionType !== null && (
                  <Text style={{ fontSize: 10, color: MUTED, fontFamily: FB, marginTop: 4, fontStyle: 'italic' }}>
                    Auto-set from plan. Tap "Override" to change.
                  </Text>
                )}
                </>)}
                {selectedSessionType === 'check_in' && (
                  <View style={s.roomSourceRow}>
                    <Icon name="info" size={14} color={GREEN} />
                    <Text style={[s.roomSourceText, { color: GREEN }]}>
                      Check-in — always coach-guided, monthly
                    </Text>
                  </View>
                )}

                {/* Hosting Mode Indicator (auto-determined, hidden for check-in) */}
                {selectedSessionType !== 'check_in' && (
                  <View style={s.roomSourceRow}>
                    <Icon name="info" size={14} color={MUTED} />
                    <Text style={s.roomSourceText}>
                      {selectedPhase === 'coach_guided'
                        ? 'Coach-led \u2014 sessions use your personal Zoom'
                        : 'Hosted \u2014 sessions use shared infrastructure'}
                    </Text>
                  </View>
                )}

                {/* ── Shared Guidance Window (only for shared_guidance phase, not check-in) ── */}
                {selectedPhase === 'shared_guidance' && selectedSessionType !== 'check_in' && (
                  <View style={s.sliderSection}>
                    <Text style={s.fieldLabel}>Shared Guidance Window</Text>
                    <Text style={s.fieldHint}>
                      Drag the handles to set when you'll be guiding your member
                    </Text>
                    <DualHandleSlider
                      totalMinutes={selectedDuration}
                      liveStart={liveStart}
                      liveEnd={liveEnd}
                      onChangeStart={setLiveStart}
                      onChangeEnd={setLiveEnd}
                    />
                  </View>
                )}

                {/* ── Multi-Day Selector ─────────────────────────────────────── */}
                <Text style={s.fieldLabel}>Days & Times</Text>
                <Text style={s.fieldHint}>Tap days to select. Each day gets its own start time.</Text>
                <View style={s.dayRow}>
                  {DAY_SHORT_LABELS.map((label, idx) => {
                    const isSelected = selectedDays.some(d => d.dayOfWeek === idx);
                    return (
                      <TouchableOpacity
                        key={idx}
                        style={[s.dayBtn, isSelected && s.dayBtnActive]}
                        onPress={() => toggleDay(idx)}
                      >
                        <Text style={[s.dayBtnText, isSelected && s.dayBtnTextActive]}>
                          {label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Per-day time pickers */}
                {selectedDays.map(entry => (
                  <View key={entry.dayOfWeek} style={s.dayTimeRow}>
                    <View style={s.dayTimeLabel}>
                      <Text style={s.dayTimeDayText}>{DAY_LABELS[entry.dayOfWeek]}</Text>
                    </View>
                    <TouchableOpacity
                      style={s.dayTimeBtn}
                      onPress={() => setEditingTimeForDay(
                        editingTimeForDay === entry.dayOfWeek ? null : entry.dayOfWeek
                      )}
                    >
                      <Text style={s.dayTimeBtnText}>{formatTime(entry.startTime)}</Text>
                      <Icon name="chevron-down" size={14} color={MUTED} />
                    </TouchableOpacity>
                    <Text style={s.dayTimeEnd}>
                      — {formatTime(addMinutesToTime(entry.startTime, selectedDuration))}
                    </Text>
                  </View>
                ))}

                {/* Time picker dropdown for active day */}
                {editingTimeForDay !== null && (
                  <View style={s.timePickerWrap}>
                    <Text style={s.timePickerTitle}>
                      Set time for {DAY_LABELS[editingTimeForDay]}
                    </Text>
                    <ScrollView style={s.timeList} nestedScrollEnabled>
                      {TIME_OPTIONS.map(t => {
                        const isActive = selectedDays.find(d => d.dayOfWeek === editingTimeForDay)?.startTime === t;
                        return (
                          <TouchableOpacity
                            key={t}
                            style={[s.timeOption, isActive && s.timeOptionActive]}
                            onPress={() => updateDayTime(editingTimeForDay, t)}
                          >
                            <Text style={[s.timeOptionText, isActive && { color: GOLD }]}>
                              {formatTime(t)}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                )}

                {/* Duration — sliding scale */}
                <Text style={s.fieldLabel}>Duration — {selectedDuration} min</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
                  <View style={[s.dayRow, { flexWrap: 'nowrap' }]}>
                    {DURATION_OPTIONS.map(d => (
                      <TouchableOpacity
                        key={d}
                        style={[s.dayBtn, selectedDuration === d && s.dayBtnActive, { minWidth: 48, paddingHorizontal: 8 }]}
                        onPress={() => setSelectedDuration(d)}
                      >
                        <Text style={[s.dayBtnText, selectedDuration === d && s.dayBtnTextActive, { fontSize: 12 }]}>
                          {d}m
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>

                {/* Pattern */}
                <Text style={s.fieldLabel}>Recurrence</Text>
                <View style={s.dayRow}>
                  {(['weekly', 'biweekly', 'monthly'] as const).map(p => (
                    <TouchableOpacity
                      key={p}
                      style={[s.dayBtn, selectedPattern === p && s.dayBtnActive, { minWidth: 80 }]}
                      onPress={() => setSelectedPattern(p)}
                    >
                      <Text style={[s.dayBtnText, selectedPattern === p && s.dayBtnTextActive]}>
                        {p.charAt(0).toUpperCase() + p.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Week of Month — only visible when Monthly is selected */}
                {selectedPattern === 'monthly' && (
                  <>
                    <Text style={s.fieldLabel}>Which week?</Text>
                    <View style={s.dayRow}>
                      {([1, 2, 3, 4] as const).map(w => {
                        const labels = ['1st', '2nd', '3rd', '4th'];
                        return (
                          <TouchableOpacity
                            key={w}
                            style={[s.dayBtn, selectedWeekOfMonth === w && s.dayBtnActive, { minWidth: 60 }]}
                            onPress={() => setSelectedWeekOfMonth(w)}
                          >
                            <Text style={[s.dayBtnText, selectedWeekOfMonth === w && s.dayBtnTextActive]}>
                              {labels[w - 1]}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                )}

                {/* Timezone */}
                <Text style={s.fieldLabel}>Timezone</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                  <View style={[s.dayRow, { flexWrap: 'nowrap' }]}>
                    {TIMEZONE_OPTIONS.map(tz => {
                      const short = tz.split('/')[1]?.replace(/_/g, ' ') || tz;
                      return (
                        <TouchableOpacity
                          key={tz}
                          style={[s.dayBtn, selectedTimezone === tz && s.dayBtnActive, { minWidth: 70 }]}
                          onPress={() => setSelectedTimezone(tz)}
                        >
                          <Text style={[s.dayBtnText, selectedTimezone === tz && s.dayBtnTextActive, { fontSize: 11 }]}>
                            {short}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </ScrollView>

                {/* Summary */}
                <View style={s.summaryCard}>
                  <Text style={s.summaryText}>
                    {selectedDays.length === 1
                      ? `${DAY_LABELS[selectedDays[0].dayOfWeek]}s at ${formatTime(selectedDays[0].startTime)} for ${selectedDuration} min`
                      : `${selectedDays.length} days/week for ${selectedDuration} min each`}
                    {selectedPattern === 'monthly'
                      ? `, ${['1st', '2nd', '3rd', '4th'][selectedWeekOfMonth - 1]} week monthly`
                      : `, ${selectedPattern}`}
                  </Text>
                  {selectedDays.length > 1 && (
                    <Text style={s.summaryDays}>
                      {selectedDays.map(d => `${DAY_SHORT_LABELS[d.dayOfWeek]} ${formatTime(d.startTime)}`).join(' · ')}
                    </Text>
                  )}
                  <Text style={s.summaryMeta}>
                    {selectedSessionType === 'check_in' ? 'Check-in' : selectedSessionType.charAt(0).toUpperCase() + selectedSessionType.slice(1)}
                    {' · '}
                    {SCHED_PHASE_LABELS[selectedPhase]}
                    {selectedPhase === 'shared_guidance' && ` (${liveEnd - liveStart}min live)`}
                  </Text>
                  <Text style={s.summaryMeta}>
                    {resolvedRoomSource === 'coach_personal' ? 'Coach-led (Your Zoom)' : 'Hosted'}
                    {' \u00b7 '}
                    {selectedTimezone.split('/')[1]?.replace(/_/g, ' ')} time
                  </Text>
                  {selectedPhase === 'shared_guidance' && (
                    <Text style={[s.summaryMeta, { color: GOLD }]}>
                      Calendar block: {liveEnd - liveStart} min (join at {liveStart}min, leave at {liveEnd}min)
                    </Text>
                  )}
                </View>

                {/* Create Button */}
                <TouchableOpacity
                  style={s.createBtn}
                  onPress={handleCreateSlots}
                  disabled={creating}
                >
                  {creating ? (
                    <ActivityIndicator size="small" color={BG} />
                  ) : (
                    <Text style={s.createBtnText}>
                      {editingSlotId
                        ? 'Update Slot'
                        : selectedDays.length > 1
                          ? `Create ${selectedDays.length} Recurring Slots`
                          : 'Create Recurring Slot'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

// ── Dual-Handle Slider Styles ───────────────────────────────────────────────
const sl = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  labelsRow: {
    flexDirection: 'row',
    width: SLIDER_TRACK_WIDTH,
    marginBottom: 6,
    alignItems: 'center',
  },
  zoneLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: MUTED,
    fontFamily: FB,
  },
  zoneLabelLive: {
    fontSize: 11,
    fontWeight: '700',
    color: GOLD,
    fontFamily: FB,
  },
  track: {
    height: 24,
    flexDirection: 'row',
    borderRadius: 8,
    overflow: 'visible',
    position: 'relative',
    ...(Platform.OS === 'web' ? { touchAction: 'none', userSelect: 'none' } as any : {}),
  },
  zoneSelf: {
    height: 24,
    backgroundColor: 'rgba(138,149,163,0.2)',
  },
  zoneLive: {
    height: 24,
    backgroundColor: 'rgba(245,166,35,0.35)',
    borderTopWidth: 2,
    borderBottomWidth: 2,
    borderColor: GOLD,
    ...(Platform.OS === 'web' ? { touchAction: 'none', cursor: 'grab' } as any : {}),
  },
  handle: {
    position: 'absolute',
    top: -2,
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    backgroundColor: '#F0F4F8',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web'
      ? { cursor: 'grab', boxShadow: '0 2px 6px rgba(0,0,0,0.4)', touchAction: 'none', userSelect: 'none' } as any
      : { elevation: 4 }
    ),
    zIndex: 10,
  },
  handleInner: {
    flexDirection: 'row',
    gap: 2,
  },
  handleGrip: {
    width: 2,
    height: 10,
    borderRadius: 1,
    backgroundColor: MUTED,
  },
  markersRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  marker: {
    fontSize: 9,
    color: MUTED,
    fontFamily: FB,
  },
  summaryRow: {
    alignItems: 'center',
    marginTop: 10,
    gap: 2,
  },
  summaryHighlight: {
    fontSize: 13,
    fontWeight: '700',
    color: GOLD,
    fontFamily: FB,
  },
});

// ── Main Styles ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: CARD,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    borderWidth: 1,
    borderColor: BORDER,
    borderBottomWidth: 0,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#2A3347',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(245,166,35,0.15)',
    borderWidth: 1.5,
    borderColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 17,
    fontWeight: '700',
    color: GOLD,
    fontFamily: FH,
  },
  headerInfo: {
    flex: 1,
    gap: 3,
  },
  name: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  headerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  metaText: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FB,
  },
  archivedBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(74,85,104,0.3)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  archivedBadgeText: {
    fontSize: 11,
    color: MUTED,
    fontFamily: FB,
    fontWeight: '600',
  },
  quickActions: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  qaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.25)',
  },
  qaBtnRestore: {
    backgroundColor: 'rgba(110,187,122,0.08)',
    borderColor: 'rgba(110,187,122,0.25)',
  },
  qaBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: GOLD,
    fontFamily: FB,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: MUTED,
    letterSpacing: 1.5,
    fontFamily: FH,
    marginBottom: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tile: {
    width: '47%',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    gap: 6,
    position: 'relative',
  },
  tileIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  tileLabel: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: FH,
  },
  tileSublabel: {
    fontSize: 11,
    color: MUTED,
    fontFamily: FB,
  },
  comingSoonBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(42,51,71,0.9)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: BORDER,
  },
  comingSoonText: {
    fontSize: 9,
    fontWeight: '700',
    color: MUTED,
    fontFamily: FB,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  // ── Schedule Modal Styles ──────────────────────────────────────────────
  schedOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
  },
  schedSheet: {
    backgroundColor: CARD,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    borderWidth: 1,
    borderColor: BORDER,
    borderBottomWidth: 0,
  },
  schedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  schedTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  schedSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  schedSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: MUTED,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 14,
  },
  fieldHint: {
    fontSize: 11,
    color: MUTED,
    fontFamily: FB,
    marginBottom: 8,
    marginTop: -4,
  },
  dayRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  dayBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(30,42,58,0.5)',
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },
  dayBtnActive: {
    backgroundColor: 'rgba(167,139,250,0.15)',
    borderColor: '#A78BFA',
  },
  dayBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: MUTED,
    fontFamily: FB,
  },
  dayBtnTextActive: {
    color: '#A78BFA',
  },

  // ── Phase buttons (taller, with week count) ───────────────────────────
  phaseBtn: {
    flex: 1,
    minWidth: 90,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(30,42,58,0.5)',
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    gap: 2,
  },
  phaseBtnLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: MUTED,
    fontFamily: FB,
    textAlign: 'center',
  },
  phaseBtnWeeks: {
    fontSize: 10,
    fontWeight: '500',
    color: MUTED,
    fontFamily: FB,
  },
  phaseHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 8,
  },
  overrideLink: {
    fontSize: 11,
    fontWeight: '600',
    color: GOLD,
    fontFamily: FB,
  },

  // ── Room source indicator ─────────────────────────────────────────────
  roomSourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  roomSourceText: {
    fontSize: 11,
    color: MUTED,
    fontFamily: FB,
    flex: 1,
  },

  // ── Slider section ────────────────────────────────────────────────────
  sliderSection: {
    marginTop: 4,
    paddingTop: 4,
    paddingBottom: 4,
  },

  // ── Multi-day time rows ───────────────────────────────────────────────
  dayTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  dayTimeLabel: {
    width: 80,
  },
  dayTimeDayText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FB,
  },
  dayTimeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(30,42,58,0.5)',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  dayTimeBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#A78BFA',
    fontFamily: FB,
  },
  dayTimeEnd: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FB,
  },
  timePickerWrap: {
    marginTop: 8,
    backgroundColor: BG,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
  },
  timePickerTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FB,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  selectBtn: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(30,42,58,0.5)',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  selectBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FB,
  },
  timeList: {
    maxHeight: 180,
    backgroundColor: BG,
  },
  timeOption: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  timeOptionActive: {
    backgroundColor: 'rgba(167,139,250,0.1)',
  },
  timeOptionText: {
    fontSize: 14,
    color: '#F0F4F8',
    fontFamily: FB,
  },
  slotCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30,42,58,0.3)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: BORDER,
  },
  slotDay: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FB,
  },
  slotMeta: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FB,
    marginTop: 2,
  },
  slotActionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  slotActionText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: FB,
  },
  summaryCard: {
    backgroundColor: 'rgba(167,139,250,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.25)',
    borderRadius: 10,
    padding: 14,
    marginTop: 16,
    alignItems: 'center',
  },
  summaryText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FB,
    textAlign: 'center',
  },
  summaryDays: {
    fontSize: 12,
    fontWeight: '500',
    color: '#A78BFA',
    fontFamily: FB,
    marginTop: 4,
    textAlign: 'center',
  },
  summaryMeta: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FB,
    marginTop: 4,
  },
  createBtn: {
    backgroundColor: '#A78BFA',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  createBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: BG,
    fontFamily: FH,
  },

  // ── Phase Timeline ────────────────────────────────────────────────────
  timelineWrap: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  timelineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  timelineTitleText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  editPlanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: 'rgba(245,166,35,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
  },
  editPlanBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: GOLD,
    fontFamily: FB,
  },
  timelineBar: {
    flexDirection: 'row',
    height: 28,
    borderRadius: 6,
    overflow: 'hidden',
    gap: 2,
  },
  timelineSegment: {
    justifyContent: 'center',
    alignItems: 'center',
    height: 28,
  },
  timelineSegText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
    fontFamily: FB,
  },
  timelineLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 10,
    color: MUTED,
    fontFamily: FB,
  },
  currentPhaseBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: CARD + '80',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  currentPhaseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  currentPhaseText: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FB,
  },
  phaseTransitionBar: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  phaseTransitionTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  phaseTransitionTriggerText: {
    fontSize: 12,
    fontWeight: '600',
    color: GOLD,
    fontFamily: FB,
  },
  phaseTransitionPicker: {
    gap: 8,
  },
  phaseTransitionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: MUTED,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  phaseTransitionOptions: {
    flexDirection: 'row',
    gap: 6,
  },
  phaseTransitionChip: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(30,42,58,0.5)',
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },
  phaseTransitionChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: MUTED,
    fontFamily: FB,
    textAlign: 'center',
  },
  phaseTransitionActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  phaseTransitionCancel: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },
  phaseTransitionCancelText: {
    fontSize: 12,
    fontWeight: '600',
    color: MUTED,
    fontFamily: FB,
  },
  phaseTransitionConfirm: {
    flex: 2,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: GOLD,
    alignItems: 'center',
  },
  phaseTransitionConfirmText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0B1120',
    fontFamily: FB,
  },
  ctsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(245,166,35,0.06)',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  ctsText: {
    fontSize: 12,
    color: GOLD,
    fontFamily: FB,
  },
});
