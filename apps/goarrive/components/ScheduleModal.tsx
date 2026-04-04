/**
 * ScheduleModal — Extracted from MemberDetail.tsx
 *
 * Full-featured scheduling modal for assigning recurring time slots to members.
 * Includes phase timeline, calendar view, conflict detection, templates,
 * batch creation, and instance management.
 */
import React, { useState, useEffect, useCallback, useMemo, useRef, useReducer } from 'react';
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
  Linking,
} from 'react-native';
import { db, functions } from '../lib/firebase';
import { doc, onSnapshot, collection, query, where, getDocs, getDoc, addDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Icon } from './Icon';
import { DAY_LABELS, DAY_SHORT_LABELS, formatTime, addMinutesToTime, type GuidancePhase, type SchedulingSessionType, type RoomSource } from '../lib/schedulingTypes';
import { type Phase, type MemberPlanData, type SessionTypeGuidance, type GuidanceLevel, resolvePhaseColor } from '../lib/planTypes';
import { defaultHostingMode, defaultCoachExpectedLive } from '../lib/schedulingTypes';
import { BG, CARD, BORDER, MUTED, GOLD, GREEN, BLUE, RED, FG, FH, FB } from '../lib/theme';

const { width: SCREEN_W } = Dimensions.get('window');

// ── Slider constants ────────────────────────────────────────────────────────
const SLIDER_TRACK_WIDTH = Math.min(SCREEN_W - 80, 340);
const HANDLE_SIZE = 28;
const STEP = 5; // 5-minute increments

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
const SCHED_TO_PLAN_SESSION_TYPE: Record<SchedulingSessionType, string> = {
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

// ── Helper: convert HH:MM to total minutes ─────────────────────────────────
function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// ── Multi-day state type ────────────────────────────────────────────────────
interface DayTimeEntry {
  dayOfWeek: number;
  startTime: string;
}

// ── Form Reducer ────────────────────────────────────────────────────────────
interface FormState {
  selectedDays: DayTimeEntry[];
  editingTimeForDay: number | null;
  selectedDuration: number;
  selectedTimezone: string;
  selectedPattern: 'weekly' | 'biweekly' | 'monthly';
  selectedWeekOfMonth: 1 | 2 | 3 | 4;
  selectedSessionType: SchedulingSessionType;
  selectedPhase: GuidancePhase;
  creating: boolean;
  editingSlotId: string | null;
  liveStart: number;
  liveEnd: number;
  planPhaseOverride: boolean;
  templateName: string;
  showSaveTemplate: boolean;
  showTemplateMenu: boolean;
}

const INITIAL_FORM_STATE: FormState = {
  selectedDays: [{ dayOfWeek: 1, startTime: '06:00' }],
  editingTimeForDay: null,
  selectedDuration: 30,
  selectedTimezone: 'America/New_York',
  selectedPattern: 'weekly',
  selectedWeekOfMonth: 1,
  selectedSessionType: 'strength',
  selectedPhase: 'coach_guided',
  creating: false,
  editingSlotId: null,
  liveStart: Math.round((30 * 0.25) / STEP) * STEP,
  liveEnd: Math.round((30 * 0.75) / STEP) * STEP,
  planPhaseOverride: false,
  templateName: '',
  showSaveTemplate: false,
  showTemplateMenu: false,
};

type FormAction =
  | { type: 'SET_FIELD'; field: keyof FormState; value: any }
  | { type: 'RESET'; duration?: number }
  | { type: 'LOAD_TEMPLATE'; template: any }
  | { type: 'EDIT_SLOT'; slot: any }
  | { type: 'SET_DURATION'; duration: number };

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'SET_FIELD':
      return { ...state, [action.field]: action.value };
    case 'RESET': {
      const dur = action.duration || 30;
      return {
        ...INITIAL_FORM_STATE,
        selectedDuration: DURATION_OPTIONS.includes(dur) ? dur : 30,
        liveStart: Math.round((dur * 0.25) / STEP) * STEP,
        liveEnd: Math.round((dur * 0.75) / STEP) * STEP,
      };
    }
    case 'LOAD_TEMPLATE': {
      const t = action.template;
      return {
        ...state,
        selectedSessionType: t.sessionType || 'strength',
        selectedPhase: t.guidancePhase || 'coach_guided',
        selectedDuration: t.durationMinutes || 30,
        selectedPattern: t.recurrencePattern || 'weekly',
        selectedTimezone: t.timezone || 'America/New_York',
        liveStart: t.liveStart !== undefined ? t.liveStart : state.liveStart,
        liveEnd: t.liveEnd !== undefined ? t.liveEnd : state.liveEnd,
        selectedDays: t.days?.length
          ? t.days.map((d: number) => ({ dayOfWeek: d, startTime: '06:00' }))
          : state.selectedDays,
        showTemplateMenu: false,
        planPhaseOverride: true,
      };
    }
    case 'EDIT_SLOT': {
      const s = action.slot;
      return {
        ...state,
        editingSlotId: s.id,
        selectedSessionType: s.sessionType || 'strength',
        selectedPhase: s.guidancePhase || 'coach_guided',
        selectedDays: [{ dayOfWeek: s.dayOfWeek, startTime: s.startTime || '06:00' }],
        selectedDuration: s.durationMinutes || 30,
        selectedPattern: s.recurrencePattern || 'weekly',
        selectedWeekOfMonth: s.weekOfMonth || state.selectedWeekOfMonth,
        selectedTimezone: s.timezone || 'America/New_York',
        liveStart: s.liveCoachingStartMin !== undefined ? s.liveCoachingStartMin : state.liveStart,
        liveEnd: s.liveCoachingEndMin !== undefined ? s.liveCoachingEndMin : state.liveEnd,
        planPhaseOverride: true,
      };
    }
    case 'SET_DURATION': {
      const dur = action.duration;
      return {
        ...state,
        selectedDuration: dur,
        liveStart: Math.min(state.liveStart, dur - STEP),
        liveEnd: Math.min(state.liveEnd, dur),
      };
    }
    default:
      return state;
  }
}

// ── Instance Reducer ────────────────────────────────────────────────────────
interface InstanceState {
  expandedSlotId: string | null;
  slotInstances: any[];
  instanceAttendance: Record<string, any>;
  rescheduleInstanceId: string | null;
  rescheduleDate: string;
  rescheduleTime: string;
  rescheduling: boolean;
  skippingInstanceId: string | null;
  skipReason: string;
  editingNoteId: string | null;
  noteText: string;
  instanceNotes: Record<string, string>;
}

const INITIAL_INSTANCE_STATE: InstanceState = {
  expandedSlotId: null,
  slotInstances: [],
  instanceAttendance: {},
  rescheduleInstanceId: null,
  rescheduleDate: '',
  rescheduleTime: '06:00',
  rescheduling: false,
  skippingInstanceId: null,
  skipReason: '',
  editingNoteId: null,
  noteText: '',
  instanceNotes: {},
};

type InstanceAction =
  | { type: 'SET_FIELD'; field: keyof InstanceState; value: any }
  | { type: 'EXPAND_SLOT'; slotId: string | null }
  | { type: 'START_RESCHEDULE'; instanceId: string; date: string; time: string }
  | { type: 'CANCEL_RESCHEDULE' }
  | { type: 'START_SKIP'; instanceId: string }
  | { type: 'CANCEL_SKIP' }
  | { type: 'SAVE_NOTE'; instanceId: string; notes: string };

function instanceReducer(state: InstanceState, action: InstanceAction): InstanceState {
  switch (action.type) {
    case 'SET_FIELD':
      return { ...state, [action.field]: action.value };
    case 'EXPAND_SLOT':
      return {
        ...state,
        expandedSlotId: action.slotId,
        slotInstances: action.slotId ? state.slotInstances : [],
        instanceAttendance: action.slotId ? state.instanceAttendance : {},
      };
    case 'START_RESCHEDULE':
      return {
        ...state,
        rescheduleInstanceId: action.instanceId,
        rescheduleDate: action.date,
        rescheduleTime: action.time,
      };
    case 'CANCEL_RESCHEDULE':
      return { ...state, rescheduleInstanceId: null };
    case 'START_SKIP':
      return { ...state, skippingInstanceId: action.instanceId, skipReason: '' };
    case 'CANCEL_SKIP':
      return { ...state, skippingInstanceId: null, skipReason: '' };
    case 'SAVE_NOTE':
      return {
        ...state,
        instanceNotes: { ...state.instanceNotes, [action.instanceId]: action.notes },
      };
    default:
      return state;
  }
}

// ── Batch Reducer ───────────────────────────────────────────────────────────
interface BatchState {
  showBatchPicker: boolean;
  batchMembers: any[];
  selectedBatchMembers: Set<string>;
  batchCreating: boolean;
  batchOverrides: Record<string, { dayOfWeek?: string; startTime?: string }>;
}

const INITIAL_BATCH_STATE: BatchState = {
  showBatchPicker: false,
  batchMembers: [],
  selectedBatchMembers: new Set(),
  batchCreating: false,
  batchOverrides: {},
};

type BatchAction =
  | { type: 'SET_FIELD'; field: keyof BatchState; value: any }
  | { type: 'TOGGLE_MEMBER'; memberId: string }
  | { type: 'CLOSE' }
  | { type: 'SET_OVERRIDE'; memberId: string; override: { dayOfWeek?: string; startTime?: string } };

function batchReducer(state: BatchState, action: BatchAction): BatchState {
  switch (action.type) {
    case 'SET_FIELD':
      return { ...state, [action.field]: action.value };
    case 'TOGGLE_MEMBER': {
      const next = new Set(state.selectedBatchMembers);
      if (next.has(action.memberId)) next.delete(action.memberId); else next.add(action.memberId);
      return { ...state, selectedBatchMembers: next };
    }
    case 'CLOSE':
      return { ...state, showBatchPicker: false, selectedBatchMembers: new Set() };
    case 'SET_OVERRIDE':
      return {
        ...state,
        batchOverrides: { ...state.batchOverrides, [action.memberId]: action.override },
      };
    default:
      return state;
  }
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
  // ── Reducer state slices ──────────────────────────────────────────────────
  const [form, formDispatch] = useReducer(formReducer, INITIAL_FORM_STATE);
  const [inst, instDispatch] = useReducer(instanceReducer, INITIAL_INSTANCE_STATE);
  const [batch, batchDispatch] = useReducer(batchReducer, INITIAL_BATCH_STATE);

  // Destructure form state for backward-compatible access
  const { selectedDays, editingTimeForDay, selectedDuration, selectedTimezone,
    selectedPattern, selectedWeekOfMonth, selectedSessionType, selectedPhase,
    creating, editingSlotId, liveStart, liveEnd, planPhaseOverride,
    templateName, showSaveTemplate, showTemplateMenu } = form;

  // Destructure instance state
  const { expandedSlotId, slotInstances, instanceAttendance, rescheduleInstanceId,
    rescheduleDate, rescheduleTime, rescheduling, skippingInstanceId, skipReason,
    editingNoteId, noteText, instanceNotes } = inst;

  // Destructure batch state
  const { showBatchPicker, batchMembers, selectedBatchMembers, batchCreating, batchOverrides } = batch;

  // ── Remaining individual state (data, UI toggles, misc) ─────────────────
  const [allCoachSlots, setAllCoachSlots] = useState<any[]>([]);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
  const [showCalendarView, setShowCalendarView] = useState(false);
  const [memberPlan, setMemberPlan] = useState<MemberPlanData | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [transitionPhase, setTransitionPhase] = useState<GuidancePhase | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [slotTemplates, setSlotTemplates] = useState<any[]>([]);
  const [pendingEditPayload, setPendingEditPayload] = useState<any>(null);
  const [showEditConfirm, setShowEditConfirm] = useState(false);
  const [coachInstances, setCoachInstances] = useState<any[]>([]);
  const [sharedTemplates, setSharedTemplates] = useState<any[]>([]);
  const [showSharedTemplates, setShowSharedTemplates] = useState(false);
  const [dragSlot, setDragSlot] = useState<{ id: string; startY: number; startDay: number; startMin: number } | null>(null);
  const [dragPreview, setDragPreview] = useState<{ day: number; min: number } | null>(null);
  const [conflictSuggestions, setConflictSuggestions] = useState<{ day: string; time: string; dayIdx: number }[]>([]);
  const [templateUpdateAvailable, setTemplateUpdateAvailable] = useState<Record<string, boolean>>({});
  const [showAssignWorkout, setShowAssignWorkout] = useState(false);
  const [showReviewQueue, setShowReviewQueue] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showLogReview, setShowLogReview] = useState(false);
  const [showWorkoutHistory, setShowWorkoutHistory] = useState(false);

  // ── Setter wrappers (delegate to reducers, keep call sites unchanged) ──
  const setSelectedDays = (v: DayTimeEntry[] | ((prev: DayTimeEntry[]) => DayTimeEntry[])) => {
    if (typeof v === 'function') formDispatch({ type: 'SET_FIELD', field: 'selectedDays', value: v(form.selectedDays) });
    else formDispatch({ type: 'SET_FIELD', field: 'selectedDays', value: v });
  };
  const setEditingTimeForDay = (v: number | null) => formDispatch({ type: 'SET_FIELD', field: 'editingTimeForDay', value: v });
  const setSelectedDuration = (v: number) => formDispatch({ type: 'SET_DURATION', duration: v });
  const setSelectedTimezone = (v: string) => formDispatch({ type: 'SET_FIELD', field: 'selectedTimezone', value: v });
  const setSelectedPattern = (v: 'weekly' | 'biweekly' | 'monthly') => formDispatch({ type: 'SET_FIELD', field: 'selectedPattern', value: v });
  const setSelectedWeekOfMonth = (v: 1 | 2 | 3 | 4) => formDispatch({ type: 'SET_FIELD', field: 'selectedWeekOfMonth', value: v });
  const setSelectedSessionType = (v: SchedulingSessionType) => formDispatch({ type: 'SET_FIELD', field: 'selectedSessionType', value: v });
  const setSelectedPhase = (v: GuidancePhase) => formDispatch({ type: 'SET_FIELD', field: 'selectedPhase', value: v });
  const setCreating = (v: boolean) => formDispatch({ type: 'SET_FIELD', field: 'creating', value: v });
  const setEditingSlotId = (v: string | null) => formDispatch({ type: 'SET_FIELD', field: 'editingSlotId', value: v });
  const setLiveStart = (v: number) => formDispatch({ type: 'SET_FIELD', field: 'liveStart', value: v });
  const setLiveEnd = (v: number) => formDispatch({ type: 'SET_FIELD', field: 'liveEnd', value: v });
  const setPlanPhaseOverride = (v: boolean) => formDispatch({ type: 'SET_FIELD', field: 'planPhaseOverride', value: v });
  const setTemplateName = (v: string) => formDispatch({ type: 'SET_FIELD', field: 'templateName', value: v });
  const setShowSaveTemplate = (v: boolean) => formDispatch({ type: 'SET_FIELD', field: 'showSaveTemplate', value: v });
  const setShowTemplateMenu = (v: boolean) => formDispatch({ type: 'SET_FIELD', field: 'showTemplateMenu', value: v });

  const setExpandedSlotId = (v: string | null | ((prev: string | null) => string | null)) => {
    if (typeof v === 'function') instDispatch({ type: 'SET_FIELD', field: 'expandedSlotId', value: v(inst.expandedSlotId) });
    else instDispatch({ type: 'EXPAND_SLOT', slotId: v });
  };
  const setSlotInstances = (v: any[]) => instDispatch({ type: 'SET_FIELD', field: 'slotInstances', value: v });
  const setInstanceAttendance = (v: Record<string, any>) => instDispatch({ type: 'SET_FIELD', field: 'instanceAttendance', value: v });
  const setRescheduleInstanceId = (v: string | null) => instDispatch({ type: 'SET_FIELD', field: 'rescheduleInstanceId', value: v });
  const setRescheduleDate = (v: string) => instDispatch({ type: 'SET_FIELD', field: 'rescheduleDate', value: v });
  const setRescheduleTime = (v: string) => instDispatch({ type: 'SET_FIELD', field: 'rescheduleTime', value: v });
  const setSkippingInstanceId = (v: string | null) => instDispatch({ type: 'SET_FIELD', field: 'skippingInstanceId', value: v });
  const setSkipReason = (v: string) => instDispatch({ type: 'SET_FIELD', field: 'skipReason', value: v });
  const setEditingNoteId = (v: string | null) => instDispatch({ type: 'SET_FIELD', field: 'editingNoteId', value: v });
  const setNoteText = (v: string) => instDispatch({ type: 'SET_FIELD', field: 'noteText', value: v });
  const setInstanceNotes = (v: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => {
    if (typeof v === 'function') instDispatch({ type: 'SET_FIELD', field: 'instanceNotes', value: v(inst.instanceNotes) });
    else instDispatch({ type: 'SET_FIELD', field: 'instanceNotes', value: v });
  };

  const setShowBatchPicker = (v: boolean) => batchDispatch({ type: 'SET_FIELD', field: 'showBatchPicker', value: v });
  const setBatchMembers = (v: any[]) => batchDispatch({ type: 'SET_FIELD', field: 'batchMembers', value: v });
  const setSelectedBatchMembers = (v: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    if (typeof v === 'function') batchDispatch({ type: 'SET_FIELD', field: 'selectedBatchMembers', value: v(batch.selectedBatchMembers) });
    else batchDispatch({ type: 'SET_FIELD', field: 'selectedBatchMembers', value: v });
  };
  const setBatchCreating = (v: boolean) => batchDispatch({ type: 'SET_FIELD', field: 'batchCreating', value: v });
  const setBatchOverrides = (v: Record<string, { dayOfWeek?: string; startTime?: string }> | ((prev: Record<string, { dayOfWeek?: string; startTime?: string }>) => Record<string, { dayOfWeek?: string; startTime?: string }>)) => {
    if (typeof v === 'function') batchDispatch({ type: 'SET_FIELD', field: 'batchOverrides', value: v(batch.batchOverrides) });
    else batchDispatch({ type: 'SET_FIELD', field: 'batchOverrides', value: v });
  };
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

  const activeSlots = existingSlots.filter(s => s.status === 'active' || s.status === 'paused');

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
            onPress={onNavigateToPlan}
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

  function InstanceList({ slot }: { slot: any }) {
    return (
      <>
        {/* View Instances toggle */}
        <TouchableOpacity
          style={{ marginTop: 6 }}
          onPress={() => setExpandedSlotId(expandedSlotId === slot.id ? null : slot.id)}
        >
          <Text style={{ fontSize: 11, color: BLUE, fontFamily: FB }}>
            {expandedSlotId === slot.id ? 'Hide Instances' : 'View Instances'}
          </Text>
        </TouchableOpacity>
        {/* Instance list expansion (Item 1: reschedule UI, Item 7: attendance) */}
        {expandedSlotId === slot.id && (
          <View style={{ marginTop: 8, paddingLeft: 4 }}>
            {slotInstances.length === 0 ? (
              <Text style={{ fontSize: 11, color: MUTED, fontFamily: FB }}>No upcoming instances</Text>
            ) : (
              slotInstances.map((inst: any) => {
                const att = instanceAttendance[inst.id];
                const attColor = att?.label === 'Attended' ? GREEN : att?.label === 'Missed' || att?.label === 'No-show' ? RED : MUTED;
                const isRescheduling = rescheduleInstanceId === inst.id;
                return (
                <View key={inst.id} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 11, color: FG, fontFamily: FB }}>
                        {inst.scheduledDate} at {inst.startTime || '—'}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 2 }}>
                        <Text style={{ fontSize: 10, color: inst.status === 'completed' ? GREEN : inst.status === 'missed' ? RED : inst.status === 'skip_requested' ? '#FFC000' : inst.status === 'skipped' ? '#FFC000' : MUTED, fontFamily: FB }}>
                          {inst.status === 'skip_requested' ? 'skip requested' : (inst.status || 'scheduled')}
                        </Text>
                        {att && (
                          <Text style={{ fontSize: 9, color: attColor, fontFamily: FB }}>
                            {att.label}{att.eventCount > 0 ? ` (${att.eventCount} events)` : ''}
                          </Text>
                        )}
                      </View>
                    </View>
                    {inst.status !== 'completed' && inst.status !== 'missed' && (
                      <TouchableOpacity
                        onPress={() => {
                          setRescheduleInstanceId(isRescheduling ? null : inst.id);
                          setRescheduleDate(inst.scheduledDate || '');
                          setRescheduleTime(inst.startTime || '06:00');
                        }}
                      >
                        <Text style={{ fontSize: 10, color: BLUE, fontFamily: FB }}>
                          {isRescheduling ? 'Cancel' : 'Reschedule'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {/* Reschedule form */}
                  {isRescheduling && (
                    <View style={{ marginTop: 6, backgroundColor: 'rgba(91,155,213,0.06)', borderRadius: 6, padding: 8 }}>
                      <Text style={{ fontSize: 10, color: MUTED, fontFamily: FH, marginBottom: 4 }}>New Date & Time</Text>
                      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                        <TextInput
                          style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 6, padding: 6, color: FG, fontFamily: FB, fontSize: 11 }}
                          placeholder="YYYY-MM-DD"
                          placeholderTextColor={MUTED}
                          value={rescheduleDate}
                          onChangeText={setRescheduleDate}
                        />
                        <TouchableOpacity
                          style={{ backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 6, padding: 6 }}
                          onPress={() => setEditingTimeForDay(editingTimeForDay === -99 ? null : -99)}
                        >
                          <Text style={{ fontSize: 11, color: FG, fontFamily: FB }}>{formatTime(rescheduleTime)}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{ backgroundColor: BLUE + '20', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 }}
                          onPress={async () => {
                            if (!rescheduleDate || !rescheduleTime) return;
                            await handleRescheduleInstance(inst.id, rescheduleDate, rescheduleTime);
                            setRescheduleInstanceId(null);
                            Alert.alert('Rescheduled', `Session moved to ${rescheduleDate} at ${formatTime(rescheduleTime)}`);
                          }}
                        >
                          <Text style={{ fontSize: 10, color: BLUE, fontFamily: FH }}>Confirm</Text>
                        </TouchableOpacity>
                      </View>
                      {/* Quick time picker for reschedule */}
                      {editingTimeForDay === -99 && (
                        <ScrollView horizontal style={{ marginTop: 6 }} showsHorizontalScrollIndicator={false}>
                          <View style={{ flexDirection: 'row', gap: 4 }}>
                            {TIME_OPTIONS.filter((_, i) => i % 2 === 0).map(t => (
                              <TouchableOpacity
                                key={t}
                                style={[{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, backgroundColor: rescheduleTime === t ? BLUE + '30' : 'rgba(255,255,255,0.06)' }]}
                                onPress={() => { setRescheduleTime(t); setEditingTimeForDay(null); }}
                              >
                                <Text style={{ fontSize: 10, color: rescheduleTime === t ? BLUE : MUTED, fontFamily: FB }}>{formatTime(t)}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        </ScrollView>
                      )}
                    </View>
                  )}
                  {/* Item 2: Skip instance */}
                  {inst.status !== 'completed' && inst.status !== 'missed' && inst.status !== 'skipped' && inst.status !== 'skip_requested' && (
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                      {skippingInstanceId === inst.id ? (
                        <View style={{ flex: 1, backgroundColor: 'rgba(255,200,0,0.06)', borderRadius: 6, padding: 6 }}>
                          <TextInput
                            style={{ backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 4, padding: 4, color: FG, fontFamily: FB, fontSize: 10, marginBottom: 4 }}
                            placeholder="Reason (e.g., holiday, vacation)"
                            placeholderTextColor={MUTED}
                            value={skipReason}
                            onChangeText={setSkipReason}
                          />
                          <View style={{ flexDirection: 'row', gap: 6 }}>
                            <TouchableOpacity onPress={() => handleSkipInstance(slot.id, inst.id, skipReason)} style={{ backgroundColor: '#FFC000' + '20', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 }}>
                              <Text style={{ fontSize: 9, color: '#FFC000', fontFamily: FH }}>Confirm Skip</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => { setSkippingInstanceId(null); setSkipReason(''); }}>
                              <Text style={{ fontSize: 9, color: MUTED, fontFamily: FB }}>Cancel</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ) : (
                        <TouchableOpacity onPress={() => { setSkippingInstanceId(inst.id); setSkipReason(''); }}>
                          <Text style={{ fontSize: 9, color: '#FFC000', fontFamily: FB }}>Skip</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                  {inst.status === 'skipped' && (inst.skipReason || inst.skipCategory) && (
                    <View style={{ marginTop: 2 }}>
                      <Text style={{ fontSize: 9, color: '#FFC000', fontFamily: FB }}>Skipped{inst.skipCategory ? ` [${inst.skipCategory}]` : ''}{inst.skipReason ? `: ${inst.skipReason}` : ''}</Text>
                      {inst.skipRequestedBy && <Text style={{ fontSize: 8, color: MUTED, fontFamily: FB }}>Requested by member</Text>}
                    </View>
                  )}
                  {/* Skip request pending — approve/deny buttons */}
                  {inst.status === 'skip_requested' && (
                    <View style={{ marginTop: 4, backgroundColor: 'rgba(255,200,0,0.06)', borderRadius: 6, padding: 6 }}>
                      <Text style={{ fontSize: 10, color: '#FFC000', fontFamily: FH, marginBottom: 2 }}>Skip Requested</Text>
                      {inst.skipCategory && <Text style={{ fontSize: 9, color: MUTED, fontFamily: FB }}>Category: {inst.skipCategory}</Text>}
                      {inst.skipReason && <Text style={{ fontSize: 9, color: MUTED, fontFamily: FB }}>Reason: {inst.skipReason}</Text>}
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                        <TouchableOpacity
                          style={{ backgroundColor: GREEN + '20', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4 }}
                          onPress={async () => {
                            try {
                              const fn = httpsCallable(functions, 'updateRecurringSlot');
                              await fn({ slotId: slot.id, action: 'approve_skip_request', instanceId: inst.id });
                              Alert.alert('Approved', 'Skip request has been approved.');
                            } catch (err: any) {
                              Alert.alert('Error', err.message || 'Failed to approve skip request');
                            }
                          }}
                        >
                          <Text style={{ fontSize: 9, color: GREEN, fontFamily: FH }}>Approve</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{ backgroundColor: RED + '20', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4 }}
                          onPress={async () => {
                            try {
                              const fn = httpsCallable(functions, 'updateRecurringSlot');
                              await fn({ slotId: slot.id, action: 'deny_skip_request', instanceId: inst.id });
                              Alert.alert('Denied', 'Skip request has been denied.');
                            } catch (err: any) {
                              Alert.alert('Error', err.message || 'Failed to deny skip request');
                            }
                          }}
                        >
                          <Text style={{ fontSize: 9, color: RED, fontFamily: FH }}>Deny</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                  {/* Item 7: Session notes */}
                  <View style={{ marginTop: 4 }}>
                    {editingNoteId === inst.id ? (
                      <View style={{ backgroundColor: 'rgba(91,155,213,0.06)', borderRadius: 6, padding: 6 }}>
                        <TextInput
                          style={{ backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 4, padding: 4, color: FG, fontFamily: FB, fontSize: 10, minHeight: 40 }}
                          placeholder="Session notes..."
                          placeholderTextColor={MUTED}
                          value={noteText}
                          onChangeText={setNoteText}
                          multiline
                        />
                        <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                          <TouchableOpacity onPress={() => handleSaveInstanceNotes(slot.id, inst.id, noteText)} style={{ backgroundColor: BLUE + '20', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 }}>
                            <Text style={{ fontSize: 9, color: BLUE, fontFamily: FH }}>Save Note</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => { setEditingNoteId(null); setNoteText(''); }}>
                            <Text style={{ fontSize: 9, color: MUTED, fontFamily: FB }}>Cancel</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                        {(instanceNotes[inst.id] || inst.notes) ? (
                          <Text style={{ fontSize: 9, color: MUTED, fontFamily: FB, flex: 1 }} numberOfLines={2}>
                            📝 {instanceNotes[inst.id] || inst.notes}
                          </Text>
                        ) : null}
                        <TouchableOpacity onPress={() => { setEditingNoteId(inst.id); setNoteText(instanceNotes[inst.id] || inst.notes || ''); }}>
                          <Text style={{ fontSize: 9, color: BLUE, fontFamily: FB }}>{(instanceNotes[inst.id] || inst.notes) ? 'Edit Note' : 'Add Note'}</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                  {/* Zoom recording link — coaches/admins only */}
                  {inst.recordings && inst.recordings.length > 0 && (
                    <View style={{ marginTop: 4, backgroundColor: 'rgba(91,155,213,0.06)', borderRadius: 4, padding: 4 }}>
                      <Text style={{ fontSize: 9, color: BLUE, fontFamily: FH, marginBottom: 2 }}>Session Recordings</Text>
                      {inst.recordings.map((rec: any, ri: number) => (
                        <TouchableOpacity
                          key={ri}
                          onPress={() => {
                            const url = rec.playUrl || rec.downloadUrl;
                            if (url) Linking.openURL(url);
                          }}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 }}
                        >
                          <Icon name="video" size={10} color={BLUE} />
                          <Text style={{ fontSize: 9, color: BLUE, fontFamily: FB, textDecorationLine: 'underline' }} numberOfLines={1}>
                            {rec.topic || `Recording ${ri + 1}`}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                  {inst.zoomRecordingUrl && !inst.recordings?.length && (
                    <View style={{ marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <TouchableOpacity
                        onPress={() => Linking.openURL(inst.zoomRecordingUrl)}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                      >
                        <Icon name="video" size={10} color={BLUE} />
                        <Text style={{ fontSize: 9, color: BLUE, fontFamily: FB, textDecorationLine: 'underline' }}>View Recording</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={async () => {
                          try {
                            const fn = httpsCallable(functions, 'refreshRecordingUrl');
                            const result = await fn({ instanceId: inst.id }) as any;
                            if (result.data?.recordingUrl) {
                              Linking.openURL(result.data.recordingUrl);
                            } else {
                              Alert.alert('Info', 'No updated recording URL available.');
                            }
                          } catch (err: any) {
                            Alert.alert('Error', err.message || 'Failed to refresh recording URL');
                          }
                        }}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
                      >
                        <Icon name="refresh" size={9} color={MUTED} />
                        <Text style={{ fontSize: 8, color: MUTED, fontFamily: FB }}>Refresh</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {/* Transcription link (coaches/admins only) */}
                  {inst.transcriptionUrl && (
                    <View style={{ marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <TouchableOpacity
                        onPress={() => Linking.openURL(inst.transcriptionUrl)}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                      >
                        <Icon name="document" size={10} color={BLUE} />
                        <Text style={{ fontSize: 9, color: BLUE, fontFamily: FB, textDecorationLine: 'underline' }}>View Transcript</Text>
                      </TouchableOpacity>
                      {inst.transcriptionStatus && (
                        <Text style={{ fontSize: 8, color: MUTED }}>({inst.transcriptionStatus})</Text>
                      )}
                    </View>
                  )}
                </View>
                );
              })
            )}
          </View>
        )}
      </>
    );
  }

  function BatchCreator() {
    return (
      <>
        {/* Batch creation button */}
        {!editingSlotId && (
          <TouchableOpacity
            style={{ marginBottom: 8, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: BLUE + '40', alignItems: 'center' }}
            onPress={() => setShowBatchPicker(true)}
          >
            <Text style={{ fontSize: 12, color: BLUE, fontFamily: FH }}>Apply to Multiple Members</Text>
          </TouchableOpacity>
        )}

        {/* Batch member picker modal */}
        {showBatchPicker && (
          <View style={{ backgroundColor: 'rgba(91,155,213,0.06)', borderRadius: 8, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: BLUE + '20' }}>
            {/* Batch template picker */}
            {(slotTemplates.length > 0 || sharedTemplates.length > 0) && (
              <View style={{ marginBottom: 8 }}>
                <Text style={{ fontSize: 11, color: GOLD, fontFamily: FH, marginBottom: 4 }}>Apply Template First</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {[...slotTemplates, ...sharedTemplates].map((t: any) => (
                      <TouchableOpacity
                        key={t.id}
                        style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: GOLD + '40', backgroundColor: 'rgba(245,166,35,0.08)' }}
                        onPress={() => handleLoadTemplate(t)}
                      >
                        <Text style={{ fontSize: 10, color: GOLD, fontFamily: FB }}>{t.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
                <Text style={{ fontSize: 9, color: MUTED, fontFamily: FB }}>Tap a template to load its settings, then select members below.</Text>
              </View>
            )}
            <Text style={{ fontSize: 12, color: BLUE, fontFamily: FH, marginBottom: 6 }}>Select Members</Text>
            {batchMembers.length === 0 ? (
              <Text style={{ fontSize: 11, color: MUTED, fontFamily: FB }}>Loading members...</Text>
            ) : (
              <ScrollView style={{ maxHeight: 150 }} nestedScrollEnabled>
                {batchMembers.map((bm: any) => (
                  <TouchableOpacity
                    key={bm.id}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}
                    onPress={() => {
                      setSelectedBatchMembers(prev => {
                        const next = new Set(prev);
                        if (next.has(bm.id)) next.delete(bm.id); else next.add(bm.id);
                        return next;
                      });
                    }}
                  >
                    <View style={{ width: 18, height: 18, borderRadius: 3, borderWidth: 1, borderColor: selectedBatchMembers.has(bm.id) ? BLUE : MUTED, backgroundColor: selectedBatchMembers.has(bm.id) ? BLUE + '30' : 'transparent', marginRight: 8, alignItems: 'center', justifyContent: 'center' }}>
                      {selectedBatchMembers.has(bm.id) && <Text style={{ fontSize: 10, color: BLUE }}>✓</Text>}
                    </View>
                    <Text style={{ fontSize: 12, color: FG, fontFamily: FB }}>{bm.name || bm.id}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            {/* Per-member day/time overrides */}
            {selectedBatchMembers.size > 0 && (
              <View style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)', paddingTop: 8 }}>
                <Text style={{ fontSize: 11, color: GOLD, fontFamily: FH, marginBottom: 4 }}>Per-Member Overrides (optional)</Text>
                <Text style={{ fontSize: 9, color: MUTED, fontFamily: FB, marginBottom: 6 }}>Set a different day or time for specific members. Leave blank to use the form defaults.</Text>
                {batchMembers.filter(bm => selectedBatchMembers.has(bm.id)).map((bm: any) => {
                  const ov = batchOverrides[bm.id];
                  const dayVal = ov?.dayOfWeek ?? '';
                  const timeVal = ov?.startTime ?? '';
                  const dayInvalid = dayVal !== '' && (!/^[0-6]$/.test(dayVal));
                  const timeInvalid = timeVal !== '' && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeVal));
                  return (
                    <View key={bm.id} style={{ marginBottom: 4 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ fontSize: 10, color: FG, fontFamily: FB, width: 80 }} numberOfLines={1}>{bm.name || bm.id}</Text>
                        <TextInput
                          style={{ flex: 1, backgroundColor: '#0E1117', borderRadius: 4, borderWidth: 1, borderColor: dayInvalid ? '#FF5722' : MUTED + '30', color: FG, fontSize: 10, fontFamily: FB, paddingHorizontal: 6, paddingVertical: 3 }}
                          placeholder="Day (0=Sun..6=Sat)"
                          placeholderTextColor={MUTED}
                          value={dayVal}
                          onChangeText={(v) => setBatchOverrides(prev => ({ ...prev, [bm.id]: { ...prev[bm.id], dayOfWeek: v || undefined } }))}
                          keyboardType="numeric"
                          maxLength={1}
                        />
                        <TextInput
                          style={{ flex: 1, backgroundColor: '#0E1117', borderRadius: 4, borderWidth: 1, borderColor: timeInvalid ? '#FF5722' : MUTED + '30', color: FG, fontSize: 10, fontFamily: FB, paddingHorizontal: 6, paddingVertical: 3 }}
                          placeholder="Time (HH:MM)"
                          placeholderTextColor={MUTED}
                          value={timeVal}
                          onChangeText={(v) => setBatchOverrides(prev => ({ ...prev, [bm.id]: { ...prev[bm.id], startTime: v || undefined } }))}
                          maxLength={5}
                        />
                      </View>
                      {(dayInvalid || timeInvalid) && (
                        <Text style={{ fontSize: 8, color: '#FF5722', fontFamily: FB, marginLeft: 86, marginTop: 2 }}>
                          {dayInvalid ? 'Day must be 0-6 (0=Sun, 1=Mon, ..., 6=Sat)' : ''}
                          {dayInvalid && timeInvalid ? ' · ' : ''}
                          {timeInvalid ? 'Time must be HH:MM (e.g. 09:00)' : ''}
                        </Text>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: BLUE, paddingVertical: 8, borderRadius: 6, alignItems: 'center', opacity: selectedBatchMembers.size === 0 || batchCreating || (() => {
                  for (const bmId of Array.from(selectedBatchMembers)) {
                    const ov = batchOverrides[bmId];
                    if (ov?.dayOfWeek && !/^[0-6]$/.test(ov.dayOfWeek)) return true;
                    if (ov?.startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(ov.startTime)) return true;
                  }
                  return false;
                })() ? 0.5 : 1 }}
                onPress={handleBatchCreate}
                disabled={selectedBatchMembers.size === 0 || batchCreating || (() => {
                  for (const bmId of Array.from(selectedBatchMembers)) {
                    const ov = batchOverrides[bmId];
                    if (ov?.dayOfWeek && !/^[0-6]$/.test(ov.dayOfWeek)) return true;
                    if (ov?.startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(ov.startTime)) return true;
                  }
                  return false;
                })()}
              >
                <Text style={{ fontSize: 12, color: '#fff', fontFamily: FH }}>
                  {batchCreating ? 'Creating...' : `Create for ${selectedBatchMembers.size} Members`}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6 }}
                onPress={() => { setShowBatchPicker(false); setSelectedBatchMembers(new Set()); }}
              >
                <Text style={{ fontSize: 12, color: MUTED, fontFamily: FB }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </>
    );
  }

  function CalendarView() {
    if (!allCoachSlots.length) return null;
    // Compute hour range from all slots
    let minHour = 24, maxHour = 0;
    for (const slot of allCoachSlots) {
      const mins = timeToMinutes(slot.startTime || '06:00');
      const endMins = mins + (slot.durationMinutes || 30);
      minHour = Math.min(minHour, Math.floor(mins / 60));
      maxHour = Math.max(maxHour, Math.ceil(endMins / 60));
    }
    if (minHour >= maxHour) { minHour = 5; maxHour = 21; }
    minHour = Math.max(0, minHour - 1);
    maxHour = Math.min(24, maxHour + 1);
    const hours = Array.from({ length: maxHour - minHour }, (_, i) => minHour + i);
    const HOUR_HEIGHT = 32;
    return (
      <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
        <TouchableOpacity
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
          onPress={() => setShowCalendarView(!showCalendarView)}
        >
          <Icon name={showCalendarView ? 'chevron-down' : 'chevron-right'} size={14} color={BLUE} />
          <Text style={{ fontSize: 12, color: BLUE, fontFamily: FH }}>Weekly Calendar (All Members)</Text>
        </TouchableOpacity>
        {showCalendarView && (() => {
          return (
          <View style={{ marginTop: 8, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
            {/* Header row */}
            <View style={{ flexDirection: 'row' }}>
              <View style={{ width: 30, paddingVertical: 4, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center' }}>
                <Text style={{ fontSize: 8, color: MUTED, fontFamily: FH }}> </Text>
              </View>
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, idx) => (
                <View key={day} style={{ flex: 1, paddingVertical: 4, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.05)' }}>
                  <Text style={{ fontSize: 9, color: MUTED, fontFamily: FH }}>{day}</Text>
                </View>
              ))}
            </View>
            {/* Time grid */}
            <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled>
              <View style={{ flexDirection: 'row', height: hours.length * HOUR_HEIGHT }}>
                {/* Time axis */}
                <View style={{ width: 30 }}>
                  {hours.map(h => (
                    <View key={h} style={{ height: HOUR_HEIGHT, justifyContent: 'flex-start', paddingTop: 1, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)' }}>
                      <Text style={{ fontSize: 7, color: MUTED, fontFamily: FB, textAlign: 'right', paddingRight: 3 }}>
                        {h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`}
                      </Text>
                    </View>
                  ))}
                </View>
                {/* Day columns */}
                {[1, 2, 3, 4, 5, 6, 0].map((dayIdx) => {
                  const daySlots = allCoachSlots.filter(s => s.dayOfWeek === dayIdx);
                  return (
                    <View key={dayIdx} style={{ flex: 1, borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.04)', position: 'relative' }}>
                      {/* Hour grid lines */}
                      {hours.map(h => (
                        <View key={h} style={{ position: 'absolute', top: (h - minHour) * HOUR_HEIGHT, left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.04)' }} />
                      ))}
                      {/* Slot blocks */}
                      {/* Drag-and-drop preview */}
                      {dragPreview && dragPreview.day === dayIdx && (
                        <View style={{ position: 'absolute', top: ((dragPreview.min / 60) - minHour) * HOUR_HEIGHT, left: 0, right: 0, height: Math.max(12, (selectedDuration / 60) * HOUR_HEIGHT), backgroundColor: 'rgba(91,155,213,0.3)', borderRadius: 2, borderWidth: 1, borderColor: BLUE, borderStyle: 'dashed' }} />
                      )}
                      {daySlots.map((slot: any) => {
                        const mins = timeToMinutes(slot.startTime || '06:00');
                        const top = ((mins / 60) - minHour) * HOUR_HEIGHT;
                        const height = Math.max(12, ((slot.durationMinutes || 30) / 60) * HOUR_HEIGHT);
                        const isCurrentMember = slot.memberId === memberId;
                        const isDragging = dragSlot?.id === slot.id;
                        const phaseColors: Record<string, string> = { coach_guided: GREEN, shared_guidance: BLUE, self_guided: '#FFC000' };
                        const borderColor = phaseColors[slot.guidancePhase] || MUTED;
                        return (
                          <TouchableOpacity
                            key={slot.id}
                            activeOpacity={0.7}
                            delayLongPress={400}
                            onLongPress={() => {
                              if (isCurrentMember) {
                                setDragSlot({ id: slot.id, startY: 0, startDay: dayIdx, startMin: mins });
                                Alert.alert(
                                  'Move Slot',
                                  `Drag ${slot.memberName}'s ${slot.startTime} slot to a new time.\n\nSelect a new time:`,
                                  [
                                    { text: 'Cancel', style: 'cancel', onPress: () => setDragSlot(null) },
                                    { text: '30 min earlier', onPress: () => handleDragDrop(slot.id, dayIdx, Math.max(0, mins - 30)) },
                                    { text: '30 min later', onPress: () => handleDragDrop(slot.id, dayIdx, Math.min(1410, mins + 30)) },
                                    { text: '1 hour earlier', onPress: () => handleDragDrop(slot.id, dayIdx, Math.max(0, mins - 60)) },
                                    { text: '1 hour later', onPress: () => handleDragDrop(slot.id, dayIdx, Math.min(1410, mins + 60)) },
                                  ]
                                );
                              }
                            }}
                            style={{ position: 'absolute', top, left: 1, right: 1, height, backgroundColor: isDragging ? 'rgba(91,155,213,0.4)' : isCurrentMember ? 'rgba(91,155,213,0.2)' : 'rgba(255,255,255,0.06)', borderRadius: 2, borderLeftWidth: 2, borderLeftColor: borderColor, padding: 1, overflow: 'hidden' }}
                          >
                            <Text style={{ fontSize: 6, color: isCurrentMember ? BLUE : MUTED, fontFamily: FH }} numberOfLines={1}>
                              {slot.startTime?.slice(0, 5)}
                            </Text>
                            <Text style={{ fontSize: 6, color: isCurrentMember ? FG : MUTED, fontFamily: FB }} numberOfLines={1}>
                              {slot.memberName?.split(' ')[0] || '?'}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </View>
          );
        })()}
      </View>
    );
  }

  return (
    <>
      {/* Schedule Modal */}
      <Modal visible={visible} transparent animationType="slide">
        <View style={s.schedOverlay}>
          <View style={s.schedSheet}>
            <ScrollView bounces={false} contentContainerStyle={{ paddingBottom: 40 }}>
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

              {/* Calendar View */}
              <CalendarView />

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
                      <InstanceList slot={slot} />
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
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    {editingSlotId && (
                      <TouchableOpacity onPress={resetForm}>
                        <Text style={[s.overrideLink, { color: MUTED }]}>Cancel Edit</Text>
                      </TouchableOpacity>
                    )}
                    {slotTemplates.length > 0 && (
                      <TouchableOpacity onPress={() => setShowTemplateMenu(!showTemplateMenu)}>
                        <Text style={{ fontSize: 11, color: BLUE, fontFamily: FB }}>Templates</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={() => setShowSaveTemplate(!showSaveTemplate)}>
                      <Text style={{ fontSize: 11, color: GREEN, fontFamily: FB }}>Save as Template</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Template menu dropdown (Item 4: includes shared templates) */}
                {showTemplateMenu && (slotTemplates.length > 0 || sharedTemplates.length > 0) && (
                  <View style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 6, padding: 8, marginBottom: 8 }}>
                    {slotTemplates.length > 0 && (
                      <>
                        <Text style={{ fontSize: 11, color: MUTED, fontFamily: FH, marginBottom: 4 }}>My Templates</Text>
                        {slotTemplates.map((t: any) => (
                          <View key={t.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                            <TouchableOpacity style={{ flex: 1 }} onPress={() => handleLoadTemplate(t)}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <Text style={{ fontSize: 12, color: FG, fontFamily: FB }}>{t.name}</Text>
                                {templateUpdateAvailable[t.id] && (
                                  <View style={{ backgroundColor: '#FFC000' + '20', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3 }}>
                                    <Text style={{ fontSize: 8, color: '#FFC000', fontFamily: FH }}>Update Available</Text>
                                  </View>
                                )}
                              </View>
                              <Text style={{ fontSize: 10, color: MUTED, fontFamily: FB }}>
                                {t.sessionType} · {t.guidancePhase} · {t.durationMinutes}min · {t.recurrencePattern}
                              </Text>
                            </TouchableOpacity>
                            <View style={{ flexDirection: 'row', gap: 8 }}>
                              <TouchableOpacity onPress={async () => {
                                try {
                                  const version = (t.version || 0) + 1;
                                  await addDoc(collection(db, 'shared_templates'), { ...t, sharedBy: coachId, sharedAt: new Date(), version });
                                  // Update local template with sharedTemplateId reference
                                  const tRef = doc(db, 'coaches', coachId, 'slot_templates', t.id);
                                  await updateDoc(tRef, { version });
                                  Alert.alert('Shared', 'Template shared with all coaches');
                                } catch (err) { console.error('Share failed:', err); }
                              }}>
                                <Text style={{ fontSize: 10, color: BLUE, fontFamily: FB }}>Share</Text>
                              </TouchableOpacity>
                              <TouchableOpacity onPress={() => handleDeleteTemplate(t.id)}>
                                <Text style={{ fontSize: 10, color: RED, fontFamily: FB }}>Delete</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        ))}
                      </>
                    )}
                    {sharedTemplates.length > 0 && (
                      <>
                        <Text style={{ fontSize: 11, color: BLUE, fontFamily: FH, marginTop: slotTemplates.length > 0 ? 8 : 0, marginBottom: 4 }}>Shared Templates</Text>
                        {sharedTemplates.map((t: any) => (
                          <View key={t.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                            <TouchableOpacity style={{ flex: 1 }} onPress={() => handleLoadTemplate(t)}>
                              <Text style={{ fontSize: 12, color: FG, fontFamily: FB }}>{t.name}</Text>
                              <Text style={{ fontSize: 10, color: MUTED, fontFamily: FB }}>
                                {t.sessionType} · {t.guidancePhase} · {t.durationMinutes}min · {t.recurrencePattern}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        ))}
                      </>
                    )}
                  </View>
                )}

                {/* Save template input */}
                {showSaveTemplate && (
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                    <TextInput
                      style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 6, padding: 8, color: FG, fontFamily: FB, fontSize: 12 }}
                      placeholder="Template name..."
                      placeholderTextColor={MUTED}
                      value={templateName}
                      onChangeText={setTemplateName}
                    />
                    <TouchableOpacity
                      style={{ backgroundColor: GREEN + '20', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6 }}
                      onPress={handleSaveTemplate}
                    >
                      <Text style={{ fontSize: 11, color: GREEN, fontFamily: FH }}>Save</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => { setShowSaveTemplate(false); setTemplateName(''); }}>
                      <Text style={{ fontSize: 11, color: MUTED, fontFamily: FB }}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Session Type */}
                <Text style={s.fieldLabel}>Session Type</Text>
                <View style={s.dayRow}>
                  {(['strength', 'cardio', 'flexibility', 'hiit', 'recovery', 'check_in'] as SchedulingSessionType[]).map(st => {
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
                {/* Session type validation warning */}
                {sessionTypeWarning && (
                  <View style={{ backgroundColor: 'rgba(245,166,35,0.1)', padding: 8, borderRadius: 6, marginTop: 6 }}>
                    <Text style={{ fontSize: 11, color: GOLD, fontFamily: FB }}>
                      ⚠ {sessionTypeWarning}
                    </Text>
                  </View>
                )}

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
                    const isDisabled = !planPhaseOverride && autoPhaseForSessionType !== null;
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

                {/* Conflict Warning */}
                {conflictWarning && (
                  <View style={{ backgroundColor: 'rgba(224,82,82,0.1)', padding: 10, borderRadius: 6, marginBottom: 8, borderWidth: 1, borderColor: RED + '40' }}>
                    <Text style={{ fontSize: 12, color: RED, fontFamily: FH, marginBottom: 4 }}>⚠ Schedule Conflict</Text>
                    <Text style={{ fontSize: 11, color: RED, fontFamily: FB }}>{conflictWarning}</Text>
                    <Text style={{ fontSize: 10, color: MUTED, fontFamily: FB, marginTop: 4, fontStyle: 'italic' }}>You can still create this slot, but you'll need to be in two places at once.</Text>
                    {/* Item 4: Conflict resolution suggestions */}
                    {conflictSuggestions.length > 0 && (
                      <View style={{ marginTop: 8 }}>
                        <Text style={{ fontSize: 10, color: GREEN, fontFamily: FH, marginBottom: 4 }}>Available times:</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                          {conflictSuggestions.map((s, i) => (
                            <TouchableOpacity
                              key={i}
                              style={{ backgroundColor: GREEN + '15', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, borderWidth: 1, borderColor: GREEN + '30' }}
                              onPress={() => {
                                // Apply suggested time to the matching day
                                const [hStr, rest] = s.time.split(':');
                                const mStr = rest.slice(0, 2);
                                const ampm = rest.slice(3);
                                let h = parseInt(hStr);
                                if (ampm === 'PM' && h !== 12) h += 12;
                                if (ampm === 'AM' && h === 12) h = 0;
                                const newTime = `${h.toString().padStart(2, '0')}:${mStr}`;
                                setSelectedDays(prev => prev.map(d => d.dayOfWeek === s.dayIdx ? { ...d, startTime: newTime } : d));
                              }}
                            >
                              <Text style={{ fontSize: 10, color: GREEN, fontFamily: FB }}>{s.day} {s.time}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    )}
                  </View>
                )}

                <BatchCreator />

                {/* Create Button */}
                <TouchableOpacity
                  style={s.createBtn}
                  onPress={handleCreateOrUpdate}
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

    </>
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


const s = StyleSheet.create({
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
