/**
 * useScheduleState — Typed reducer slices for ScheduleModal
 *
 * Centralizes all scheduling state into 5 useReducer slices:
 *   formReducer     — slot creation/editing form fields
 *   instanceReducer — instance-level interactions (expand, reschedule, skip, notes)
 *   batchReducer    — batch slot creation
 *   dataReducer     — fetched Firestore data
 *   uiReducer       — UI panel toggles and misc state
 */
import { useReducer } from 'react';
import { type GuidancePhase, type SchedulingSessionType } from '../lib/schedulingTypes';
import { type MemberPlanData } from '../lib/planTypes';

// ── Shared constants ────────────────────────────────────────────────────────
const STEP = 5; // 5-minute increments
const DURATION_OPTIONS = [15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];
export { STEP, DURATION_OPTIONS };

// ── DayTimeEntry ────────────────────────────────────────────────────────────
export interface DayTimeEntry {
  dayOfWeek: number;
  startTime: string;
}

// ── Form Reducer ────────────────────────────────────────────────────────────
export interface FormState {
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

export type FormAction =
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
export interface InstanceState {
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
export interface BatchState {
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

// ── Data Reducer ────────────────────────────────────────────────────────────
export interface DataState {
  allCoachSlots: any[];
  memberPlan: MemberPlanData | null;
  planLoading: boolean;
  slotTemplates: any[];
  sharedTemplates: any[];
  coachInstances: any[];
  templateUpdateAvailable: Record<string, boolean>;
  conflictWarning: string | null;
  conflictSuggestions: { day: string; time: string; dayIdx: number }[];
}

const INITIAL_DATA_STATE: DataState = {
  allCoachSlots: [],
  memberPlan: null,
  planLoading: false,
  slotTemplates: [],
  sharedTemplates: [],
  coachInstances: [],
  templateUpdateAvailable: {},
  conflictWarning: null,
  conflictSuggestions: [],
};

type DataAction = { type: 'SET_FIELD'; field: keyof DataState; value: any };

function dataReducer(state: DataState, action: DataAction): DataState {
  switch (action.type) {
    case 'SET_FIELD':
      return { ...state, [action.field]: action.value };
    default:
      return state;
  }
}

// ── UI Reducer ──────────────────────────────────────────────────────────────
export interface UIState {
  showCalendarView: boolean;
  showEditConfirm: boolean;
  showSharedTemplates: boolean;
  showAssignWorkout: boolean;
  showReviewQueue: boolean;
  showAnalytics: boolean;
  showLogReview: boolean;
  showWorkoutHistory: boolean;
  transitionPhase: GuidancePhase | null;
  transitioning: boolean;
  pendingEditPayload: any;
  dragSlot: { id: string; startY: number; startDay: number; startMin: number } | null;
  dragPreview: { day: number; min: number } | null;
}

const INITIAL_UI_STATE: UIState = {
  showCalendarView: false,
  showEditConfirm: false,
  showSharedTemplates: false,
  showAssignWorkout: false,
  showReviewQueue: false,
  showAnalytics: false,
  showLogReview: false,
  showWorkoutHistory: false,
  transitionPhase: null,
  transitioning: false,
  pendingEditPayload: null,
  dragSlot: null,
  dragPreview: null,
};

type UIAction = { type: 'SET_FIELD'; field: keyof UIState; value: any };

function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case 'SET_FIELD':
      return { ...state, [action.field]: action.value };
    default:
      return state;
  }
}

// ── Hook ────────────────────────────────────────────────────────────────────
export function useScheduleState() {
  const [form, formDispatch] = useReducer(formReducer, INITIAL_FORM_STATE);
  const [inst, instDispatch] = useReducer(instanceReducer, INITIAL_INSTANCE_STATE);
  const [batch, batchDispatch] = useReducer(batchReducer, INITIAL_BATCH_STATE);
  const [data, dataDispatch] = useReducer(dataReducer, INITIAL_DATA_STATE);
  const [ui, uiDispatch] = useReducer(uiReducer, INITIAL_UI_STATE);

  // Form setter wrappers
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

  // Instance setter wrappers
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

  // Batch setter wrappers
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

  // Data setter wrappers
  const setAllCoachSlots = (v: any[]) => dataDispatch({ type: 'SET_FIELD', field: 'allCoachSlots', value: v });
  const setConflictWarning = (v: string | null) => dataDispatch({ type: 'SET_FIELD', field: 'conflictWarning', value: v });
  const setMemberPlan = (v: MemberPlanData | null) => dataDispatch({ type: 'SET_FIELD', field: 'memberPlan', value: v });
  const setPlanLoading = (v: boolean) => dataDispatch({ type: 'SET_FIELD', field: 'planLoading', value: v });
  const setSlotTemplates = (v: any[]) => dataDispatch({ type: 'SET_FIELD', field: 'slotTemplates', value: v });
  const setSharedTemplates = (v: any[]) => dataDispatch({ type: 'SET_FIELD', field: 'sharedTemplates', value: v });
  const setCoachInstances = (v: any[]) => dataDispatch({ type: 'SET_FIELD', field: 'coachInstances', value: v });
  const setTemplateUpdateAvailable = (v: Record<string, boolean>) => dataDispatch({ type: 'SET_FIELD', field: 'templateUpdateAvailable', value: v });
  const setConflictSuggestions = (v: { day: string; time: string; dayIdx: number }[]) => dataDispatch({ type: 'SET_FIELD', field: 'conflictSuggestions', value: v });

  // UI setter wrappers
  const setShowCalendarView = (v: boolean) => uiDispatch({ type: 'SET_FIELD', field: 'showCalendarView', value: v });
  const setShowEditConfirm = (v: boolean) => uiDispatch({ type: 'SET_FIELD', field: 'showEditConfirm', value: v });
  const setShowSharedTemplates = (v: boolean) => uiDispatch({ type: 'SET_FIELD', field: 'showSharedTemplates', value: v });
  const setShowAssignWorkout = (v: boolean) => uiDispatch({ type: 'SET_FIELD', field: 'showAssignWorkout', value: v });
  const setShowReviewQueue = (v: boolean) => uiDispatch({ type: 'SET_FIELD', field: 'showReviewQueue', value: v });
  const setShowAnalytics = (v: boolean) => uiDispatch({ type: 'SET_FIELD', field: 'showAnalytics', value: v });
  const setShowLogReview = (v: boolean) => uiDispatch({ type: 'SET_FIELD', field: 'showLogReview', value: v });
  const setShowWorkoutHistory = (v: boolean) => uiDispatch({ type: 'SET_FIELD', field: 'showWorkoutHistory', value: v });
  const setTransitionPhase = (v: GuidancePhase | null) => uiDispatch({ type: 'SET_FIELD', field: 'transitionPhase', value: v });
  const setTransitioning = (v: boolean) => uiDispatch({ type: 'SET_FIELD', field: 'transitioning', value: v });
  const setPendingEditPayload = (v: any) => uiDispatch({ type: 'SET_FIELD', field: 'pendingEditPayload', value: v });
  const setDragSlot = (v: UIState['dragSlot']) => uiDispatch({ type: 'SET_FIELD', field: 'dragSlot', value: v });
  const setDragPreview = (v: UIState['dragPreview']) => uiDispatch({ type: 'SET_FIELD', field: 'dragPreview', value: v });

  return {
    // Raw dispatchers (for atomic multi-field updates)
    formDispatch,

    // Form state + setters
    ...form,
    setSelectedDays, setEditingTimeForDay, setSelectedDuration, setSelectedTimezone,
    setSelectedPattern, setSelectedWeekOfMonth, setSelectedSessionType, setSelectedPhase,
    setCreating, setEditingSlotId, setLiveStart, setLiveEnd, setPlanPhaseOverride,
    setTemplateName, setShowSaveTemplate, setShowTemplateMenu,

    // Instance state + setters
    ...inst,
    setExpandedSlotId, setSlotInstances, setInstanceAttendance, setRescheduleInstanceId,
    setRescheduleDate, setRescheduleTime, setSkippingInstanceId, setSkipReason,
    setEditingNoteId, setNoteText, setInstanceNotes,

    // Batch state + setters
    ...batch,
    setShowBatchPicker, setBatchMembers, setSelectedBatchMembers, setBatchCreating, setBatchOverrides,

    // Data state + setters
    ...data,
    setAllCoachSlots, setConflictWarning, setMemberPlan, setPlanLoading,
    setSlotTemplates, setSharedTemplates, setCoachInstances, setTemplateUpdateAvailable,
    setConflictSuggestions,

    // UI state + setters
    ...ui,
    setShowCalendarView, setShowEditConfirm, setShowSharedTemplates, setShowAssignWorkout,
    setShowReviewQueue, setShowAnalytics, setShowLogReview, setShowWorkoutHistory,
    setTransitionPhase, setTransitioning, setPendingEditPayload, setDragSlot, setDragPreview,
  };
}
