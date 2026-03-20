/**
 * GoArrive Plan Data Types — Comprehensive plan model for viewing + editing
 * Supports coach edit mode and member read-only view
 */

// ─── Session schedule ─────────────────────────────────────────────────────────

export interface DayPlan {
  day: string;
  shortDay: string;
  type: 'strength' | 'cardio' | 'rest' | 'optional';
  label: string;
  duration?: string;
  breakdown?: string[];
}

export type SessionsPerWeek = 2 | 3 | 4;

// ─── Support phases ───────────────────────────────────────────────────────────

export interface Phase {
  id: number;
  name: string;
  weeks: number;
  description: string;
}

// ─── Full plan data (member-facing read-only + coach editable) ──────────────

export interface MemberPlanData {
  id?: string;
  memberId: string;
  coachId: string;
  status: 'draft' | 'presented' | 'active';

  // Hero
  memberName: string;
  memberAge?: number;
  age?: number;           // legacy alias
  subtitle: string;
  planSubtitle?: string;  // legacy alias
  identityTag: string;
  referredBy?: string;

  // Goals
  currentWeight?: number;
  goalWeight?: string;
  gymConfidence?: number;
  gym?: string;
  startingPoints: string[];
  goals: string[];
  healthGoals?: string[]; // legacy alias
  goalSummary: string;

  // Why
  whyStatement: string;
  whyTranslation: string;
  readiness: number;
  motivation: number;

  // Weekly Plan
  sessionsPerWeek: SessionsPerWeek;
  contractLengthMonths: number;
  contractMonths?: number; // legacy alias
  weekPlan4: DayPlan[];
  weekPlan3: DayPlan[];
  weekPlan2: DayPlan[];
  weeklyPlan?: DayPlan[]; // legacy alias — computed from sessionsPerWeek

  // Phases
  phases: Phase[];

  // What's Included
  whatsIncluded: string[];

  // Pricing (coach controls visibility)
  showInvestment: boolean;
  monthlyPrice?: number;
  perSessionPrice?: number;
  payInFullPrice?: number;
  payInFullDiscount?: number;
  hourlyRate?: number;

  // Timestamps
  createdAt?: any;
  updatedAt?: any;

  // Shareable link
  shareToken?: string;
}

// ─── Default plan template for new plans ────────────────────────────────────

export function createDefaultPlan(memberId: string, coachId: string, memberName: string): MemberPlanData {
  return {
    memberId,
    coachId,
    status: 'draft',
    memberName,
    memberAge: 0,
    subtitle: 'Built to help you train with purpose, build strength, and create real discipline.',
    identityTag: 'Ready to train',
    referredBy: '',
    currentWeight: 0,
    goalWeight: '',
    gymConfidence: 5,
    gym: '',
    startingPoints: [],
    goals: [],
    goalSummary: '',
    whyStatement: '',
    whyTranslation: '',
    readiness: 5,
    motivation: 5,
    sessionsPerWeek: 4,
    contractLengthMonths: 12,
    weekPlan4: defaultWeekPlan(4),
    weekPlan3: defaultWeekPlan(3),
    weekPlan2: defaultWeekPlan(2),
    phases: [
      { id: 1, name: 'Foundation', weeks: 12, description: 'Building habits, learning form, and establishing your training rhythm.' },
      { id: 2, name: 'Development', weeks: 20, description: 'Progressive overload, increased volume, and growing independence.' },
      { id: 3, name: 'Ownership', weeks: 20, description: 'Self-directed training with coaching check-ins and continued growth.' },
    ],
    whatsIncluded: [
      'Personalized coaching sessions per week',
      'Custom fitness plan updated as you progress',
      'Accountability and coaching support',
      'Monthly progress check-ins',
    ],
    showInvestment: true,
    monthlyPrice: 0,
    perSessionPrice: 0,
    payInFullPrice: 0,
    payInFullDiscount: 10,
    hourlyRate: 0,
  };
}

function defaultWeekPlan(sessions: number): DayPlan[] {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const shorts = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  
  if (sessions === 4) {
    return days.map((day, i) => ({
      day,
      shortDay: shorts[i],
      type: [0, 1, 3, 4].includes(i) ? 'strength' as const : i === 5 ? 'optional' as const : 'rest' as const,
      label: [0, 1, 3, 4].includes(i) ? 'Strength' : i === 5 ? 'Optional' : 'Rest',
      duration: [0, 1, 3, 4].includes(i) ? '60 min' : undefined,
      breakdown: [],
    }));
  }
  if (sessions === 3) {
    return days.map((day, i) => ({
      day,
      shortDay: shorts[i],
      type: [0, 2, 4].includes(i) ? 'strength' as const : i === 5 ? 'optional' as const : 'rest' as const,
      label: [0, 2, 4].includes(i) ? 'Strength' : i === 5 ? 'Optional' : 'Rest',
      duration: [0, 2, 4].includes(i) ? '60 min' : undefined,
      breakdown: [],
    }));
  }
  // 2 sessions
  return days.map((day, i) => ({
    day,
    shortDay: shorts[i],
    type: [1, 4].includes(i) ? 'strength' as const : i === 5 ? 'optional' as const : 'rest' as const,
    label: [1, 4].includes(i) ? 'Strength' : i === 5 ? 'Optional' : 'Rest',
    duration: [1, 4].includes(i) ? '60 min' : undefined,
    breakdown: [],
  }));
}

// ─── Goal display config ─────────────────────────────────────────────────────

export const goalConfig: Record<string, { emoji: string; color: string }> & Array<{
  label: string;
  icon: string;
  bgColor: string;
  borderColor: string;
  textColor: string;
}> = Object.assign(
  [
    {
      label: 'Improved Health',
      icon: '\u2764\uFE0F',
      bgColor: 'rgba(110,187,122,0.1)',
      borderColor: 'rgba(110,187,122,0.3)',
      textColor: '#6EBB7A',
    },
    {
      label: 'Improved Endurance',
      icon: '\u26A1',
      bgColor: 'rgba(91,155,213,0.1)',
      borderColor: 'rgba(91,155,213,0.3)',
      textColor: '#5B9BD5',
    },
    {
      label: 'Increased Strength',
      icon: '\uD83D\uDCAA',
      bgColor: 'rgba(245,166,35,0.1)',
      borderColor: 'rgba(245,166,35,0.3)',
      textColor: '#F5A623',
    },
    {
      label: 'Increased Muscle Mass',
      icon: '\uD83C\uDFCB\uFE0F',
      bgColor: 'rgba(126,184,232,0.1)',
      borderColor: 'rgba(126,184,232,0.25)',
      textColor: '#7EB8E8',
    },
  ] as any,
  {
    'Improved Health': { emoji: '\u2764\uFE0F', color: '#6EBB7A' },
    'Improved Endurance': { emoji: '\u26A1', color: '#5B9BD5' },
    'Increased Strength': { emoji: '\uD83D\uDCAA', color: '#F5A623' },
    'Increased Muscle Mass': { emoji: '\uD83C\uDFCB\uFE0F', color: '#7EB8E8' },
    'Weight Loss': { emoji: '\uD83C\uDFAF', color: '#E06B6B' },
    'Flexibility': { emoji: '\uD83E\uDDD8', color: '#9B8FD5' },
    'Mental Health': { emoji: '\uD83E\uDDE0', color: '#5B9BD5' },
    'Better Sleep': { emoji: '\uD83D\uDE34', color: '#7EB8E8' },
  }
);

// ─── Available goals for editing ────────────────────────────────────────────

export const availableGoals = [
  'Improved Health',
  'Improved Endurance',
  'Increased Strength',
  'Increased Muscle Mass',
  'Weight Loss',
  'Flexibility',
  'Mental Health',
  'Better Sleep',
];

// ─── Day type colors ─────────────────────────────────────────────────────────

export const typeColors: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  strength: {
    bg: 'rgba(91,155,213,0.14)',
    border: 'rgba(91,155,213,0.35)',
    text: '#5B9BD5',
    dot: '#5B9BD5',
  },
  cardio: {
    bg: 'rgba(245,166,35,0.14)',
    border: 'rgba(245,166,35,0.35)',
    text: '#F5A623',
    dot: '#F5A623',
  },
  rest: {
    bg: 'rgba(42,51,71,0.3)',
    border: '#1E2535',
    text: '#4A5568',
    dot: '#2A3347',
  },
  optional: {
    bg: 'rgba(110,187,122,0.08)',
    border: 'rgba(110,187,122,0.2)',
    text: '#6EBB7A',
    dot: '#6EBB7A',
  },
  Strength: {
    bg: 'rgba(91,155,213,0.14)',
    border: 'rgba(91,155,213,0.35)',
    text: '#5B9BD5',
    dot: '#5B9BD5',
  },
  Endurance: {
    bg: 'rgba(245,166,35,0.14)',
    border: 'rgba(245,166,35,0.35)',
    text: '#F5A623',
    dot: '#F5A623',
  },
  Rest: {
    bg: 'rgba(42,51,71,0.3)',
    border: '#1E2535',
    text: '#4A5568',
    dot: '#2A3347',
  },
  Optional: {
    bg: 'rgba(110,187,122,0.08)',
    border: 'rgba(110,187,122,0.2)',
    text: '#6EBB7A',
    dot: '#6EBB7A',
  },
};

// ─── Phase colors ────────────────────────────────────────────────────────────

export const phaseColors = ['#5B9BD5', '#F5A623', '#6EBB7A'];

// ─── Day type options for editing ───────────────────────────────────────────

export const dayTypeOptions: { value: DayPlan['type']; label: string }[] = [
  { value: 'strength', label: 'Strength' },
  { value: 'cardio', label: 'Endurance' },
  { value: 'rest', label: 'Rest' },
  { value: 'optional', label: 'Optional' },
];
