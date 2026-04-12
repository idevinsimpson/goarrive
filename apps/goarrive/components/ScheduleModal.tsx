/**
 * ScheduleModal — Orchestrator for the scheduling modal.
 *
 * Subcomponents: ./scheduling/{PhaseTimeline,InstanceList,BatchCreator,SlotForm,CalendarView}
 * Shared styles: ./scheduling/styles.ts · Constants: ./scheduling/constants.ts
 */
import React, { useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { db, functions } from '../lib/firebase';
import { doc, onSnapshot, collection, query, where, getDocs, getDoc, addDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Icon } from './Icon';
import { DAY_LABELS, formatTime, type GuidancePhase, type SchedulingSessionType, type RoomSource } from '../lib/schedulingTypes';
import { type MemberPlanData, type SessionTypeGuidance, type GuidanceLevel, resolvePhaseColor } from '../lib/planTypes';
import { defaultHostingMode, defaultCoachExpectedLive } from '../lib/schedulingTypes';
import { MUTED, GOLD, GREEN, BLUE, RED, FG, FH, FB } from '../lib/theme';
import { useScheduleState, STEP, DURATION_OPTIONS, type DayTimeEntry } from '../hooks/useScheduleState';
import { PhaseTimeline, InstanceList, SlotForm, CalendarView } from './scheduling';
import { s, sl, SCREEN_W, SLIDER_TRACK_WIDTH, HANDLE_SIZE } from './scheduling/styles';
import { INTENSITY_TO_PHASE, SCHED_PHASE_LABELS, timeToMinutes } from './scheduling/constants';

// Map GuidanceLevel (plan types) → GuidancePhase (scheduling types)
const GUIDANCE_LEVEL_TO_PHASE: Record<GuidanceLevel, GuidancePhase> = {
  'Fully guided': 'coach_guided',
  'Blended': 'shared_guidance',
  'Self-reliant': 'self_guided',
};

// Map scheduling session type → plan session type for guidance profile lookup
const SCHED_TO_PLAN_SESSION_TYPE: Record<SchedulingSessionType, string> = {
  strength: 'Strength',
  cardio: 'Cardio + Mobility',
  flexibility: 'Cardio + Mobility',
  hiit: 'Mix',
  recovery: 'Rest',
  check_in: 'check_in',
};

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


export interface ScheduleModalProps {
  visible: boolean;
  onClose: () => void;
  memberId: string;
  memberName: string;
  coachId: string;
  existingSlots: any[];
  onNavigateToPlan: () => void;
}

export default function ScheduleModal({
  visible,
  onClose,
  memberId,
  memberName,
  coachId,
  existingSlots,
  onNavigateToPlan,
}: ScheduleModalProps) {
  // ── All scheduling state from useScheduleState hook ──────────────────────
  const state = useScheduleState();
  const {
    formDispatch,
    // Form
    selectedDays, editingTimeForDay, selectedDuration, selectedTimezone,
    selectedPattern, selectedWeekOfMonth, selectedSessionType, selectedPhase,
    creating, editingSlotId, liveStart, liveEnd, planPhaseOverride,
    templateName, showSaveTemplate, showTemplateMenu,
    setSelectedDays, setEditingTimeForDay, setSelectedDuration, setSelectedTimezone,
    setSelectedPattern, setSelectedWeekOfMonth, setSelectedSessionType, setSelectedPhase,
    setCreating, setEditingSlotId, setLiveStart, setLiveEnd, setPlanPhaseOverride,
    setTemplateName, setShowSaveTemplate, setShowTemplateMenu,
    // Instance
    expandedSlotId, slotInstances, instanceAttendance, rescheduleInstanceId,
    rescheduleDate, rescheduleTime, rescheduling, skippingInstanceId, skipReason,
    editingNoteId, noteText, instanceNotes,
    setExpandedSlotId, setSlotInstances, setInstanceAttendance, setRescheduleInstanceId,
    setRescheduleDate, setRescheduleTime, setSkippingInstanceId, setSkipReason,
    setEditingNoteId, setNoteText, setInstanceNotes,
    // Batch
    showBatchPicker, batchMembers, selectedBatchMembers, batchCreating, batchOverrides,
    setShowBatchPicker, setBatchMembers, setSelectedBatchMembers, setBatchCreating, setBatchOverrides,
    // Data
    allCoachSlots, memberPlan, planLoading, slotTemplates, sharedTemplates,
    coachInstances, templateUpdateAvailable, conflictWarning, conflictSuggestions,
    setAllCoachSlots, setConflictWarning, setMemberPlan, setPlanLoading,
    setSlotTemplates, setSharedTemplates, setCoachInstances, setTemplateUpdateAvailable,
    setConflictSuggestions,
    // UI
    showCalendarView, showEditConfirm, showSharedTemplates, showAssignWorkout,
    showReviewQueue, showAnalytics, showLogReview, showWorkoutHistory,
    transitionPhase, transitioning, pendingEditPayload, dragSlot, dragPreview,
    setShowCalendarView, setShowEditConfirm, setShowSharedTemplates, setShowAssignWorkout,
    setShowReviewQueue, setShowAnalytics, setShowLogReview, setShowWorkoutHistory,
    setTransitionPhase, setTransitioning, setPendingEditPayload, setDragSlot, setDragPreview,
  } = state;

  // ── Transition awareness: which phase is the member currently in? ────────
  const currentPhaseInfo = useMemo(() => {
    if (!memberPlan?.phases?.length) return null;
    const psd = memberPlan.planStartDate;
    const startDate = psd
      ? (typeof psd === 'string' ? new Date(psd) : psd.toDate ? psd.toDate() : new Date(psd.seconds * 1000))
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
  // Load ALL coach's active slots (for conflict detection) — Item 10: limit for performance
  useEffect(() => {
    if (!coachId || !visible) return;
    const q = query(
      collection(db, 'recurring_slots'),
      where('coachId', '==', coachId),
      where('status', '==', 'active'),
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      setAllCoachSlots(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsubscribe();
  }, [coachId, visible]);

  // Item 2: Load actual coach session instances for next 4 weeks (precise biweekly/monthly conflict detection)
  useEffect(() => {
    if (!coachId || !visible) return;
    const today = new Date();
    const fourWeeksOut = new Date(today.getTime() + 28 * 24 * 60 * 60 * 1000);
    const todayStr = today.toISOString().split('T')[0];
    const futureStr = fourWeeksOut.toISOString().split('T')[0];
    const q = query(
      collection(db, 'session_instances'),
      where('coachId', '==', coachId),
      where('scheduledDate', '>=', todayStr),
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      const instances = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter((i: any) => i.scheduledDate <= futureStr);
      setCoachInstances(instances);
    });
    return () => unsubscribe();
  }, [coachId, visible]);

  // Item 4: Load shared templates
  useEffect(() => {
    if (!visible) return;
    const q = query(collection(db, 'shared_templates'));
    const unsubscribe = onSnapshot(q, (snap) => {
      setSharedTemplates(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsubscribe();
  }, [visible]);

  // Load slot templates for this coach
  useEffect(() => {
    if (!coachId || !visible) return;
    const q = query(collection(db, 'coaches', coachId, 'slot_templates'));
    const unsubscribe = onSnapshot(q, (snap) => {
      setSlotTemplates(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsubscribe();
  }, [coachId, visible]);

  // Load instances for expanded slot (View Instances)
  useEffect(() => {
    if (!expandedSlotId) { setSlotInstances([]); setInstanceAttendance({}); return; }
    const q = query(
      collection(db, 'session_instances'),
      where('slotId', '==', expandedSlotId),
      where('scheduledDate', '>=', new Date().toISOString().split('T')[0]),
    );
    const unsubscribe = onSnapshot(q, async (snap) => {
      const instances = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      instances.sort((a: any, b: any) => (a.scheduledDate || '').localeCompare(b.scheduledDate || ''));
      const sliced = instances.slice(0, 8);
      setSlotInstances(sliced);

      // Item 7: Load attendance data from session_events for each instance
      const attendance: Record<string, any> = {};
      for (const inst of sliced) {
        try {
          const evQ = query(
            collection(db, 'session_events'),
            where('occurrenceId', '==', inst.id),
          );
          const evSnap = await getDocs(evQ);
          const events = evSnap.docs.map(d => d.data());
          const joined = events.some((e: any) => e.eventType === 'participant_joined');
          const left = events.some((e: any) => e.eventType === 'participant_left');
          const started = events.some((e: any) => e.eventType === 'meeting_started');
          attendance[inst.id] = {
            joined,
            left,
            started,
            eventCount: events.length,
            label: joined ? 'Attended' : ((inst as any).status === 'missed' ? 'Missed' : (started ? 'No-show' : 'Pending')),
          };
        } catch {
          attendance[inst.id] = { label: '—', eventCount: 0 };
        }
      }
      setInstanceAttendance(attendance);
    });
    return () => unsubscribe();
  }, [expandedSlotId]);

  // ── Load member plan for phase sync ───────────────────────────────────────
  useEffect(() => {
    if (!memberId || !visible) return;
    let cancelled = false;
    (async () => {
      setPlanLoading(true);
      try {
        const planDoc = await getDoc(doc(db, 'member_plans', memberId));
        if (planDoc.exists() && !cancelled) {
          setMemberPlan(planDoc.data() as MemberPlanData);
        } else {
          const q = query(collection(db, 'member_plans'), where('memberId', '==', memberId));
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
  }, [memberId, visible]);
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

  // ── Slot conflict detection (Item 2: precise biweekly/monthly via instances) ──
  // Only relevant for coach_guided (full session) and shared_guidance (live window)
  useEffect(() => {
    if (!allCoachSlots.length || selectedPhase === 'self_guided') {
      setConflictWarning(null);
      return;
    }
    const conflicts: string[] = [];
    for (const entry of selectedDays) {
      const entryStart = timeToMinutes(entry.startTime);
      const entryEnd = entryStart + selectedDuration;
      const coachBusyStart = selectedPhase === 'shared_guidance' ? entryStart + liveStart : entryStart;
      const coachBusyEnd = selectedPhase === 'shared_guidance' ? entryStart + liveEnd : entryEnd;

      // Weekly slots: use the existing slot-level check
      for (const slot of allCoachSlots) {
        if (editingSlotId && slot.id === editingSlotId) continue;
        if (slot.guidancePhase === 'self_guided') continue;
        // For biweekly/monthly slots, skip slot-level check — use instance-level below
        if (slot.recurrencePattern === 'biweekly' || slot.recurrencePattern === 'monthly') continue;
        if (slot.dayOfWeek !== entry.dayOfWeek) continue;
        const slotStart = timeToMinutes(slot.startTime);
        const slotEnd = slotStart + (slot.durationMinutes || 30);
        const slotBusyStart = slot.guidancePhase === 'shared_guidance' ? slotStart + (slot.liveCoachingStartMin || 0) : slotStart;
        const slotBusyEnd = slot.guidancePhase === 'shared_guidance' ? slotStart + (slot.liveCoachingEndMin || slot.durationMinutes || 30) : slotEnd;
        if (coachBusyStart < slotBusyEnd && coachBusyEnd > slotBusyStart) {
          const memberName = slot.memberName || 'another member';
          conflicts.push(`${DAY_LABELS[entry.dayOfWeek]} ${formatTime(entry.startTime)} overlaps with ${memberName}'s ${formatTime(slot.startTime)} weekly slot`);
        }
      }

      // Biweekly/monthly: use actual instances for precise detection
      if (coachInstances.length > 0) {
        const dayName = DAY_LABELS[entry.dayOfWeek];
        for (const inst of coachInstances) {
          if (editingSlotId && (inst as any).slotId === editingSlotId) continue;
          // Check if instance falls on the same day of week
          const instDate = new Date((inst as any).scheduledDate + 'T00:00:00');
          if (instDate.getDay() !== entry.dayOfWeek) continue;
          // Check if the instance's slot is biweekly or monthly
          const parentSlot = allCoachSlots.find(s => s.id === (inst as any).slotId);
          if (!parentSlot || (parentSlot.recurrencePattern !== 'biweekly' && parentSlot.recurrencePattern !== 'monthly')) continue;
          if (parentSlot.guidancePhase === 'self_guided') continue;
          const instStart = timeToMinutes((inst as any).startTime || parentSlot.startTime);
          const instEnd = instStart + (parentSlot.durationMinutes || 30);
          const instBusyStart = parentSlot.guidancePhase === 'shared_guidance' ? instStart + (parentSlot.liveCoachingStartMin || 0) : instStart;
          const instBusyEnd = parentSlot.guidancePhase === 'shared_guidance' ? instStart + (parentSlot.liveCoachingEndMin || parentSlot.durationMinutes || 30) : instEnd;
          if (coachBusyStart < instBusyEnd && coachBusyEnd > instBusyStart) {
            const memberName = parentSlot.memberName || 'another member';
            conflicts.push(`${dayName} ${formatTime(entry.startTime)} overlaps with ${memberName}'s ${(inst as any).scheduledDate} instance`);
          }
        }
      }
    }
    // Deduplicate
    const unique = [...new Set(conflicts)];
    setConflictWarning(unique.length > 0 ? unique.join('\n') : null);
  }, [selectedDays, selectedDuration, selectedPhase, liveStart, liveEnd, allCoachSlots, editingSlotId, coachInstances]);

  // Item 4: Conflict resolution — suggest free time slots when conflicts are detected
  useEffect(() => {
    if (!conflictWarning) { setConflictSuggestions([]); return; }
    const suggestions: { day: string; time: string; dayIdx: number }[] = [];
    const busySlots: Record<number, { start: number; end: number }[]> = {};
    for (const slot of allCoachSlots) {
      if (slot.guidancePhase === 'self_guided') continue;
      const d = slot.dayOfWeek as number;
      if (!busySlots[d]) busySlots[d] = [];
      const s = timeToMinutes(slot.startTime);
      const e = s + (slot.durationMinutes || 30);
      busySlots[d].push({ start: s, end: e });
    }
    // Check each selected day for free 30-min windows between 6 AM and 9 PM
    for (const entry of selectedDays) {
      const dayBusy = (busySlots[entry.dayOfWeek] || []).sort((a, b) => a.start - b.start);
      for (let t = 360; t <= 1260 - selectedDuration; t += 15) {
        const tEnd = t + selectedDuration;
        const isFree = !dayBusy.some(b => t < b.end && tEnd > b.start);
        if (isFree && suggestions.length < 6) {
          const h = Math.floor(t / 60);
          const m = t % 60;
          const ampm = h >= 12 ? 'PM' : 'AM';
          const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
          suggestions.push({
            day: DAY_LABELS[entry.dayOfWeek],
            time: `${h12}:${m.toString().padStart(2, '0')} ${ampm}`,
            dayIdx: entry.dayOfWeek,
          });
        }
      }
    }
    setConflictSuggestions(suggestions.slice(0, 6));
  }, [conflictWarning, allCoachSlots, selectedDays, selectedDuration]);

  // ── Session type validation against plan guidance profiles ──────────────────
  const sessionTypeWarning = useMemo((): string | null => {
    if (!memberPlan?.sessionGuidanceProfiles?.length) return null;
    if (selectedSessionType === 'check_in' || selectedSessionType === 'recovery') return null;
    const planSessionType = SCHED_TO_PLAN_SESSION_TYPE[selectedSessionType];
    const profile = memberPlan.sessionGuidanceProfiles.find(p => p.sessionType === planSessionType);
    if (!profile) {
      return `This member's plan does not include a "${planSessionType}" session type. The plan has: ${memberPlan.sessionGuidanceProfiles.map(p => p.sessionType).join(', ')}.`;
    }
    return null;
  }, [memberPlan, selectedSessionType]);
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
    formDispatch({ type: 'RESET', duration: memberPlan?.pricing?.sessionLengthMinutes });
  }, [memberPlan]);

  // ── Edit existing slot: populate form with slot data ──────────────────────
  const handleEditSlot = useCallback((slot: any) => {
    formDispatch({ type: 'EDIT_SLOT', slot });
  }, []);

  // ── Save current form as a template ──────────────────────────────────────
  const handleSaveTemplate = useCallback(async () => {
    if (!coachId || !templateName.trim()) return;
    try {
      await addDoc(collection(db, 'coaches', coachId, 'slot_templates'), {
        name: templateName.trim(),
        sessionType: selectedSessionType,
        guidancePhase: selectedPhase,
        durationMinutes: selectedDuration,
        recurrencePattern: selectedPattern,
        timezone: selectedTimezone,
        liveStart,
        liveEnd,
        days: selectedDays.map(d => d.dayOfWeek),
        createdAt: new Date(),
      });
      setShowSaveTemplate(false);
      setTemplateName('');
    } catch (err) {
      console.error('Failed to save template:', err);
    }
  }, [coachId, templateName, selectedSessionType, selectedPhase, selectedDuration, selectedPattern, selectedTimezone, liveStart, liveEnd, selectedDays]);

  // ── Load a template into the form ────────────────────────────────────────
  const handleLoadTemplate = useCallback((template: any) => {
    formDispatch({ type: 'LOAD_TEMPLATE', template });
  }, []);

  // ── Delete a template ─────────────────────────────────────────────────
  const handleDeleteTemplate = useCallback(async (templateId: string) => {
    if (!coachId) return;
    try {
      await deleteDoc(doc(db, 'coaches', coachId, 'slot_templates', templateId));
    } catch (err) {
      console.error('Failed to delete template:', err);
    }
  }, [coachId]);

  // ── Reschedule a single instance ────────────────────────────────────────
  const handleRescheduleInstance = useCallback(async (instanceId: string, newDate: string, newTime: string) => {
    try {
      const fn = httpsCallable(functions, 'updateRecurringSlot');
      await fn({ slotId: instanceId, action: 'reschedule_instance', newDate, newTime });
    } catch (err) {
      console.error('Failed to reschedule instance:', err);
    }
  }, []);

  // ── Item 6: Confirmation before editing an existing slot ──────────────────
  const handleCreateOrUpdate = useCallback(() => {
    if (editingSlotId) {
      Alert.alert(
        'Confirm Slot Update',
        'This will update the slot and regenerate all future sessions. Past sessions are not affected. Continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Update', onPress: () => handleCreateSlots() },
        ]
      );
    } else {
      handleCreateSlots();
    }
  }, [editingSlotId]);

  // Item 2: Skip instance handler
  const handleSkipInstance = useCallback(async (slotId: string, instanceId: string, reason: string) => {
    try {
      const fn = httpsCallable(functions, 'updateRecurringSlot');
      await fn({ slotId, action: 'skip_instance', instanceId, reason });
      setSkippingInstanceId(null);
      setSkipReason('');
      // Refresh instances
      setExpandedSlotId(prev => { const v = prev; setExpandedSlotId(null); setTimeout(() => setExpandedSlotId(v), 100); return prev; });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to skip instance');
    }
  }, []);

  // Item 7: Save instance notes handler
  const handleSaveInstanceNotes = useCallback(async (slotId: string, instanceId: string, notes: string) => {
    try {
      const fn = httpsCallable(functions, 'updateRecurringSlot');
      await fn({ slotId, action: 'update_instance_notes', instanceId, notes });
      setInstanceNotes(prev => ({ ...prev, [instanceId]: notes }));
      setEditingNoteId(null);
      setNoteText('');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save notes');
    }
  }, []);

  // Item 6: Batch slot creation — create same schedule for multiple members
  const handleBatchCreate = useCallback(async () => {
    if (selectedBatchMembers.size === 0) return;
    setBatchCreating(true);
    try {
      const fn = httpsCallable(functions, 'createRecurringSlot');
      let created = 0;
      for (const bm of batchMembers) {
        if (!selectedBatchMembers.has(bm.id)) continue;
        const override = batchOverrides[bm.id];
        for (const entry of selectedDays) {
          const hostingMode = defaultHostingMode(selectedPhase);
          const payload: Record<string, any> = {
            memberId: bm.id, memberName: bm.name || 'Unknown',
            dayOfWeek: override?.dayOfWeek || entry.dayOfWeek,
            startTime: override?.startTime || entry.startTime,
            durationMinutes: selectedDuration, timezone: selectedTimezone,
            recurrencePattern: selectedPattern, sessionType: selectedSessionType,
            guidancePhase: selectedPhase, roomSource: 'platform',
            coachJoining: selectedPhase !== 'self_guided',
            hostingMode, coachExpectedLive: hostingMode !== 'hosted' || selectedPhase === 'shared_guidance',
            personalZoomRequired: hostingMode === 'coach_led',
          };
          if (selectedPhase === 'shared_guidance') {
            payload.liveCoachingStartMin = liveStart;
            payload.liveCoachingEndMin = liveEnd;
            payload.liveCoachingDuration = liveEnd - liveStart;
          }
          await fn(payload);
          created++;
        }
      }
      Alert.alert('Batch Created', `Created ${created} slots for ${selectedBatchMembers.size} members.`);
      setShowBatchPicker(false);
      setSelectedBatchMembers(new Set());
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Batch creation failed');
    } finally {
      setBatchCreating(false);
    }
  }, [selectedBatchMembers, batchMembers, selectedDays, selectedDuration, selectedTimezone, selectedPattern, selectedSessionType, selectedPhase, liveStart, liveEnd, batchOverrides]);

  // Item 1: Drag-and-drop handler — update slot time after drag
  const handleDragDrop = useCallback(async (slotId: string, newDay: number, newMinutes: number) => {
    const h = Math.floor(newMinutes / 60);
    const m = newMinutes % 60;
    const newTime = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    try {
      const fn = httpsCallable(functions, 'updateRecurringSlot');
      await fn({ slotId, action: 'update', dayOfWeek: newDay, startTime: newTime });
      // Refresh slots
      setDragSlot(null);
      setDragPreview(null);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to move slot');
    }
  }, []);

  // Item 5: Template versioning — check for updates
  useEffect(() => {
    if (!slotTemplates.length || !sharedTemplates.length) return;
    const updates: Record<string, boolean> = {};
    for (const local of slotTemplates) {
      if (local.sharedTemplateId) {
        const shared = sharedTemplates.find(s => s.id === local.sharedTemplateId);
        if (shared && shared.version && local.version && shared.version > local.version) {
          updates[local.id] = true;
        }
      }
    }
    setTemplateUpdateAvailable(updates);
  }, [slotTemplates, sharedTemplates]);

  // Item 6: Load batch members (all coach's members except current)
  useEffect(() => {
    if (!showBatchPicker || !coachId) return;
    const q = query(collection(db, 'members'), where('coachId', '==', coachId));
    getDocs(q).then(snap => {
      const members = snap.docs.filter(d => d.id !== memberId).map(d => ({ id: d.id, ...d.data() }));
      setBatchMembers(members);
    });
  }, [showBatchPicker, coachId, memberId]);

  // ── Create slots (one per selected day) ─────────────────────────────────────────
  const handleCreateSlots = useCallback(async () => {
    setCreating(true); try {
      // Server-side conflict detection before creation (catches race conditions)
      if (selectedPhase !== 'self_guided') {
        const conflictFn = httpsCallable(functions, 'checkSlotConflicts');
        for (const entry of selectedDays) {
          try {
            const cResult = await conflictFn({
              coachId: coachId,
              dayOfWeek: entry.dayOfWeek,
              startTime: entry.startTime,
              durationMinutes: selectedDuration,
              guidancePhase: selectedPhase,
              excludeSlotId: editingSlotId || undefined,
            });
            const cData = cResult.data as any;
            if (cData.hasConflict) {
              const conflictNames = cData.conflicts.map((c: any) => `${c.memberName} at ${c.startTime}`).join(', ');
              const proceed = await new Promise<boolean>((resolve) => {
                Alert.alert(
                  'Schedule Conflict Detected',
                  `Server detected a conflict on ${DAY_LABELS[entry.dayOfWeek]} with: ${conflictNames}. Continue anyway?`,
                  [
                    { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                    { text: 'Continue', onPress: () => resolve(true) },
                  ]
                );
              });
              if (!proceed) { setCreating(false); return; }
            }
          } catch (conflictErr: any) {
            console.warn('Server conflict check failed, proceeding:', conflictErr.message);
          }
        }
      }

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
          memberId: memberId,
          memberName: memberName || 'Unknown',
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
  }, [memberId, memberName, selectedDays, selectedDuration, selectedTimezone, selectedPattern, selectedWeekOfMonth, selectedSessionType, selectedPhase, resolvedRoomSource, liveStart, liveEnd, editingSlotId, hasCTS, resetForm]);

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
      const result = await fn({ memberId: memberId, newPhase });
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
  }, [memberId]);

  const activeSlots = existingSlots.filter(sl => sl.status === 'active' || sl.status === 'paused');


  return (
    <>
      {/* Schedule Modal */}
      <Modal visible={visible} transparent animationType="slide">
        <View style={s.schedOverlay}>
          <View style={s.schedSheet}>
            <ScrollView style={{ flex: 1 }} bounces={false} contentContainerStyle={{ paddingBottom: 40 }}>
              {/* Header */}
              <View style={s.schedHeader}>
                <Text style={s.schedTitle}>Schedule {memberName?.split(' ')[0] || 'Member'}</Text>
                <TouchableOpacity onPress={onClose} hitSlop={8}>
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
                  <PhaseTimeline planPhases={planPhases} totalWeeks={totalWeeks} onNavigateToPlan={onNavigateToPlan} />
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

              {/* Calendar View */}
              <CalendarView state={state} memberId={memberId} handleDragDrop={handleDragDrop} />

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
                      <InstanceList
                        slot={slot}
                        state={state}
                        handleRescheduleInstance={handleRescheduleInstance}
                        handleSkipInstance={handleSkipInstance}
                        handleSaveInstanceNotes={handleSaveInstanceNotes}
                      />
                    </View>
                    );
                  })}
                </View>
              )}

              {/* New Slot Form */}
              <SlotForm
                state={state}
                coachId={coachId}
                activeSlots={activeSlots}
                usedSessionTypes={usedSessionTypes}
                sessionTypeWarning={sessionTypeWarning}
                autoPhaseForSessionType={autoPhaseForSessionType}
                phaseWeekMap={phaseWeekMap}
                planPhases={planPhases}
                resolvedRoomSource={resolvedRoomSource}
                resetForm={resetForm}
                handleLoadTemplate={handleLoadTemplate}
                handleDeleteTemplate={handleDeleteTemplate}
                handleSaveTemplate={handleSaveTemplate}
                handleCreateOrUpdate={handleCreateOrUpdate}
                handleBatchCreate={handleBatchCreate}
                toggleDay={toggleDay}
                updateDayTime={updateDayTime}
                DualHandleSlider={DualHandleSlider}
              />
            </ScrollView>
          </View>
        </View>
       </Modal>

    </>
  );
}

