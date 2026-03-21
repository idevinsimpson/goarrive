/**
 * GoArrive Plan Data Types — Comprehensive plan model
 * Ported from legacy Plan-Building repo with full pricing engine
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

export type SessionsPerWeek = 2 | 3 | 4 | 5 | 6;

// ─── Guidance system ──────────────────────────────────────────────────────────

export type GuidanceLevel = 'Fully guided' | 'Blended' | 'Self-reliant';

export const GUIDANCE_FACTORS: Record<GuidanceLevel, number> = {
  'Fully guided': 1.0,
  'Blended': 0.625,
  'Self-reliant': 0,
};

export type SessionType = 'Strength' | 'Endurance' | 'Optional';

export interface SessionTypeGuidance {
  sessionType: SessionType;
  phase1: GuidanceLevel;
  phase2: GuidanceLevel;
  phase3: GuidanceLevel;
}

// ─── Pricing types ────────────────────────────────────────────────────────────

export type ContractLength = 6 | 9 | 12;

export interface PricingInputs {
  hourlyRate: number;
  sessionLengthMinutes: number;
  checkInCallLengthMinutes: number;
  programBuildTimeHours: number;
}

export interface PricingResult {
  hourlyRate: number;
  sessionLengthMinutes: number;
  checkInCallLengthMinutes: number;
  programBuildTimeHours: number;
  calculatedMonthlyPrice: number;
  baseMonthlyPrice: number;
  displayMonthlyPrice: number;
  perSessionPrice: number;
  payInFullPrice: number;
  payInFullDiscount: number;
  totalCoachingHours: number;
  checkInHours: number;
  buildHours: number;
  totalHours: number;
  totalProgramPrice: number;
  commitToSaveActive: boolean;
  commitToSaveSavings: number;
  noShowFee: number;
  isManualOverride: boolean;
  manualMonthlyOverride?: number;
  phaseBreakdown: PhaseHoursDetail[];
}

export interface PhaseHoursDetail {
  sessionType: string;
  sessionsPerWeek: number;
  phase1Hours: number;
  phase2Hours: number;
  phase3Hours: number;
  totalHours: number;
  phase1Guidance: GuidanceLevel;
  phase2Guidance: GuidanceLevel;
  phase3Guidance: GuidanceLevel;
}

// ─── Support phases ───────────────────────────────────────────────────────────

export interface Phase {
  id: number;
  name: string;
  weeks: number;
  description: string;
}

// ─── Full plan data ───────────────────────────────────────────────────────────

export interface MemberPlanData {
  id?: string;
  memberId: string;
  coachId: string;
  status: 'draft' | 'presented' | 'accepted' | 'active';

  // Hero
  memberName: string;
  memberAge?: number;
  age?: number;
  subtitle: string;
  planSubtitle?: string;
  identityTag: string;
  referredBy?: string;

  // Goals
  currentWeight?: number;
  goalWeight?: string;
  gymConfidence?: number;
  gym?: string;
  startingPoints: string[];
  goals: string[];
  healthGoals?: string[];
  goalSummary: string;

  // Why
  whyStatement: string;
  whyTranslation: string;
  readiness: number;
  motivation: number;

  // Weekly Plan
  sessionsPerWeek: SessionsPerWeek;
  contractLengthMonths: ContractLength;
  contractMonths?: number;
  weekPlan4: DayPlan[];
  weekPlan3: DayPlan[];
  weekPlan2: DayPlan[];
  weeklyPlan?: DayPlan[];

  // Phases
  phases: Phase[];

  // What's Included
  whatsIncluded: string[];

  // Pricing system
  pricingInputs: PricingInputs;
  sessionGuidanceProfiles: SessionTypeGuidance[];
  pricingResult?: PricingResult;
  showInvestment: boolean;

  // Legacy simple pricing fields (fallback)
  monthlyPrice?: number;
  perSessionPrice?: number;
  payInFullPrice?: number;
  payInFullDiscount?: number;
  hourlyRate?: number;

  // Manual override
  manualMonthlyOverride?: number;

  // Commit to Save
  commitToSaveEnabled: boolean;
  commitToSaveAddOnActive: boolean;
  commitToSaveMonthlySavings: number;
  commitToSaveMissedSessionFee: number;
  commitToSaveNextMonthPercentOff: number;
  commitToSaveSummary: string;
  commitToSaveDetailsExpandedByDefault: boolean;
  commitToSaveMakeUpWindowHours: number;
  commitToSaveReentryRule: string;
  commitToSaveEmergencyWaiverEnabled: boolean;

  // Nutrition add-on
  nutritionEnabled: boolean;
  nutritionAddOnActive: boolean;
  nutritionMonthlyCost: number;
  nutritionInHouse: boolean;
  nutritionProviderName: string;
  nutritionDescription: string;

  // Timestamps
  createdAt?: any;
  updatedAt?: any;

  // Shareable link
  shareToken?: string;
}

// ─── Pricing engine ───────────────────────────────────────────────────────────

export function monthsToWeeks(months: number): number {
  if (months === 6) return 26;
  if (months === 9) return 39;
  if (months === 12) return 52;
  return Math.round(months * (52 / 12));
}

export function getDefaultGuidance(sessionType: SessionType): SessionTypeGuidance {
  return { sessionType, phase1: 'Fully guided', phase2: 'Blended', phase3: 'Self-reliant' };
}

export function getGuidanceProfile(
  sessionType: SessionType,
  profiles: SessionTypeGuidance[]
): SessionTypeGuidance {
  return profiles.find(p => p.sessionType === sessionType) || getDefaultGuidance(sessionType);
}

export function countSessionsByType(weekPlan: DayPlan[]): Record<SessionType, number> {
  const counts: Record<SessionType, number> = { Strength: 0, Endurance: 0, Optional: 0 };
  weekPlan.forEach(day => {
    if (day.type === 'strength') counts.Strength++;
    else if (day.type === 'cardio') counts.Endurance++;
    else if (day.type === 'optional') counts.Optional++;
  });
  return counts;
}

export function calculatePricing(
  weekPlan: DayPlan[],
  sessionsPerWeek: SessionsPerWeek,
  contractLengthMonths: ContractLength,
  phases: Phase[],
  inputs: PricingInputs,
  guidanceProfiles: SessionTypeGuidance[],
  commitToSaveActive: boolean,
  manualMonthlyOverride?: number
): PricingResult {
  const hourlyRate = Math.max(1, inputs.hourlyRate);
  const sessionLengthMinutes = Math.max(1, inputs.sessionLengthMinutes);
  const checkInCallLengthMinutes = Math.max(0, inputs.checkInCallLengthMinutes);
  const programBuildTimeHours = Math.max(0, inputs.programBuildTimeHours);

  const months = contractLengthMonths;
  const weeks = monthsToWeeks(months);
  const P1 = phases[0]?.weeks ?? 6;
  const P2 = phases[1]?.weeks ?? 12;
  const P3 = Math.max(0, weeks - P1 - P2);

  const sessionCounts = countSessionsByType(weekPlan);
  const sessionTypes: SessionType[] = ['Strength', 'Endurance', 'Optional'];
  const activeTypes = sessionTypes.filter(t => sessionCounts[t] > 0);

  let totalCoachingHours = 0;
  const phaseBreakdown: PhaseHoursDetail[] = [];

  if (activeTypes.length > 0) {
    activeTypes.forEach(type => {
      const count = sessionCounts[type];
      const guidance = getGuidanceProfile(type, guidanceProfiles);
      const f1 = GUIDANCE_FACTORS[guidance.phase1];
      const f2 = GUIDANCE_FACTORS[guidance.phase2];
      const f3 = GUIDANCE_FACTORS[guidance.phase3];
      const phase1Hours = (P1 * count * sessionLengthMinutes * f1) / 60;
      const phase2Hours = (P2 * count * sessionLengthMinutes * f2) / 60;
      const phase3Hours = (P3 * count * sessionLengthMinutes * f3) / 60;
      const total = phase1Hours + phase2Hours + phase3Hours;
      totalCoachingHours += total;
      phaseBreakdown.push({
        sessionType: type,
        sessionsPerWeek: count,
        phase1Hours,
        phase2Hours,
        phase3Hours,
        totalHours: total,
        phase1Guidance: guidance.phase1,
        phase2Guidance: guidance.phase2,
        phase3Guidance: guidance.phase3,
      });
    });
  } else {
    const Phase1Hours = (P1 * sessionsPerWeek * sessionLengthMinutes) / 60;
    const Phase2Hours = (P2 * sessionsPerWeek * 0.625 * sessionLengthMinutes) / 60;
    totalCoachingHours = Phase1Hours + Phase2Hours;
  }

  const checkInHours = (months * checkInCallLengthMinutes) / 60;
  const buildHours = programBuildTimeHours;
  const totalHours = totalCoachingHours + checkInHours + buildHours;
  const totalProgramPrice = totalHours * hourlyRate;

  const calculatedMonthlyPrice = Math.round(totalProgramPrice / months);
  const isManualOverride = manualMonthlyOverride !== undefined && manualMonthlyOverride > 0;
  const baseMonthlyPrice = isManualOverride ? manualMonthlyOverride! : calculatedMonthlyPrice;

  const commitToSaveSavings = 100;
  const displayMonthlyPrice = commitToSaveActive
    ? baseMonthlyPrice - commitToSaveSavings
    : baseMonthlyPrice;

  const totalScheduledSessions = weeks * sessionsPerWeek;
  const effectiveTotalPrice = displayMonthlyPrice * months;
  const perSessionPrice = totalScheduledSessions > 0
    ? Math.round(effectiveTotalPrice / totalScheduledSessions)
    : 0;
  const payInFullPrice = Math.round(effectiveTotalPrice * 0.90);

  return {
    hourlyRate,
    sessionLengthMinutes,
    checkInCallLengthMinutes,
    programBuildTimeHours,
    calculatedMonthlyPrice,
    baseMonthlyPrice,
    displayMonthlyPrice,
    perSessionPrice,
    payInFullPrice,
    payInFullDiscount: 10,
    totalCoachingHours,
    checkInHours,
    buildHours,
    totalHours,
    totalProgramPrice,
    commitToSaveActive,
    commitToSaveSavings,
    noShowFee: 50,
    isManualOverride,
    manualMonthlyOverride,
    phaseBreakdown,
  };
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// ─── Default plan data ────────────────────────────────────────────────────────

const defaultPricingInputs: PricingInputs = {
  hourlyRate: 75,
  sessionLengthMinutes: 60,
  checkInCallLengthMinutes: 30,
  programBuildTimeHours: 5,
};

const defaultPhases: Phase[] = [
  { id: 1, name: 'Fully Guided', weeks: 6, description: 'We start with strong support so you can learn the plan, build consistency, and train with confidence from day one.' },
  { id: 2, name: 'Shared Guidance', weeks: 12, description: "You'll begin owning more of each workout while support and accountability stay high." },
  { id: 3, name: 'Self-Reliant', weeks: 34, description: "You're training with confidence and more independence, with your plan still being refined." },
];

const defaultGuidanceProfiles: SessionTypeGuidance[] = [
  { sessionType: 'Strength', phase1: 'Fully guided', phase2: 'Blended', phase3: 'Self-reliant' },
  { sessionType: 'Endurance', phase1: 'Fully guided', phase2: 'Blended', phase3: 'Self-reliant' },
  { sessionType: 'Optional', phase1: 'Blended', phase2: 'Self-reliant', phase3: 'Self-reliant' },
];

export function createDefaultPlan(memberId: string, coachId: string, memberName: string): MemberPlanData {
  const wp4 = defaultWeekPlan(4);
  const wp3 = defaultWeekPlan(3);
  const wp2 = defaultWeekPlan(2);

  const pricingResult = calculatePricing(
    wp4, 4, 12, defaultPhases, defaultPricingInputs, defaultGuidanceProfiles, true
  );

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
    weekPlan4: wp4,
    weekPlan3: wp3,
    weekPlan2: wp2,
    phases: defaultPhases,
    whatsIncluded: [
      '4 coaching sessions per week',
      '12-month commitment',
      'Tailored fitness plan updated as you progress',
      'Accountability and coaching support',
      'Monthly progress check-ins',
      'Nutrition support available as an add-on',
      'Clear structure so your training feels purposeful, not random',
    ],
    pricingInputs: defaultPricingInputs,
    sessionGuidanceProfiles: defaultGuidanceProfiles,
    pricingResult,
    showInvestment: true,
    // Commit to Save
    commitToSaveEnabled: true,
    commitToSaveAddOnActive: true,
    commitToSaveMonthlySavings: 100,
    commitToSaveMissedSessionFee: 50,
    commitToSaveNextMonthPercentOff: 5,
    commitToSaveSummary: 'Save $100 per month when you commit to showing up consistently.',
    commitToSaveDetailsExpandedByDefault: false,
    commitToSaveMakeUpWindowHours: 48,
    commitToSaveReentryRule: 'If you opt out, you can re-enter at the start of the next year.',
    commitToSaveEmergencyWaiverEnabled: true,
    // Nutrition add-on
    nutritionEnabled: true,
    nutritionAddOnActive: false,
    nutritionMonthlyCost: 100,
    nutritionInHouse: false,
    nutritionProviderName: '',
    nutritionDescription: 'Add personalized nutrition coaching to your plan. Includes a custom nutrition strategy, macro targets, and monthly check-ins.',
  };
}

function defaultWeekPlan(sessions: number): DayPlan[] {
  if (sessions === 4) {
    return [
      { day: 'Monday', shortDay: 'Mon', type: 'rest', label: 'No-Go Day', breakdown: ['Not available', 'Rest and recovery'] },
      { day: 'Tuesday', shortDay: 'Tue', type: 'strength', label: 'Strength — 7:30am', duration: '60 min', breakdown: ['7:30am session start', 'Warm-up / mobility', 'Main strength work', 'Accessory work', 'Core or finisher'] },
      { day: 'Wednesday', shortDay: 'Wed', type: 'cardio', label: 'Endurance — 7:30am', duration: '45–60 min', breakdown: ['7:30am session start', 'Warm-up', 'Engine / endurance work', 'Conditioning or intervals', 'Cool down'] },
      { day: 'Thursday', shortDay: 'Thu', type: 'strength', label: 'Strength — 7:30am', duration: '60 min', breakdown: ['7:30am session start', 'Warm-up / mobility', 'Main strength work', 'Accessory work', 'Core or finisher'] },
      { day: 'Friday', shortDay: 'Fri', type: 'rest', label: 'No-Go Day', breakdown: ['Not available', 'Rest and recovery'] },
      { day: 'Saturday', shortDay: 'Sat', type: 'optional', label: 'Optional / Mobility', breakdown: ['Optional mobility work', 'Light walk', 'Full rest'] },
      { day: 'Sunday', shortDay: 'Sun', type: 'strength', label: 'Strength — 7–9am', duration: '60–90 min', breakdown: ['Morning window: 7:00–9:00am', 'Warm-up / mobility', 'Main strength or conditioning work', 'Accessory work', 'Core or finisher'] },
    ];
  }
  if (sessions === 3) {
    return [
      { day: 'Monday', shortDay: 'Mon', type: 'rest', label: 'No-Go Day', breakdown: ['Not available', 'Rest and recovery'] },
      { day: 'Tuesday', shortDay: 'Tue', type: 'strength', label: 'Strength — 7:30am', duration: '60 min', breakdown: ['7:30am session start', 'Warm-up / mobility', 'Main strength work', 'Accessory work', 'Core or finisher'] },
      { day: 'Wednesday', shortDay: 'Wed', type: 'cardio', label: 'Endurance — 7:30am', duration: '45–60 min', breakdown: ['7:30am session start', 'Warm-up', 'Engine / endurance work', 'Conditioning or intervals', 'Cool down'] },
      { day: 'Thursday', shortDay: 'Thu', type: 'rest', label: 'Rest / Walk', breakdown: ['Light walking or full rest'] },
      { day: 'Friday', shortDay: 'Fri', type: 'rest', label: 'No-Go Day', breakdown: ['Not available', 'Rest and recovery'] },
      { day: 'Saturday', shortDay: 'Sat', type: 'optional', label: 'Optional / Walk', breakdown: ['Optional walking or recovery'] },
      { day: 'Sunday', shortDay: 'Sun', type: 'strength', label: 'Strength — 7–9am', duration: '60–90 min', breakdown: ['Morning window: 7:00–9:00am', 'Warm-up / mobility', 'Main strength or conditioning work', 'Accessory work'] },
    ];
  }
  // 2 sessions
  return [
    { day: 'Monday', shortDay: 'Mon', type: 'rest', label: 'No-Go Day', breakdown: ['Not available', 'Rest and recovery'] },
    { day: 'Tuesday', shortDay: 'Tue', type: 'strength', label: 'Strength — 7:30am', duration: '60 min', breakdown: ['7:30am session start', 'Warm-up / mobility', 'Full-body strength work', 'Accessory work', 'Core or finisher'] },
    { day: 'Wednesday', shortDay: 'Wed', type: 'rest', label: 'Rest / Walk', breakdown: ['Light walking or full rest'] },
    { day: 'Thursday', shortDay: 'Thu', type: 'rest', label: 'Rest / Walk', breakdown: ['Light walking or full rest'] },
    { day: 'Friday', shortDay: 'Fri', type: 'rest', label: 'No-Go Day', breakdown: ['Not available', 'Rest and recovery'] },
    { day: 'Saturday', shortDay: 'Sat', type: 'optional', label: 'Optional / Walk', breakdown: ['Optional walking or recovery'] },
    { day: 'Sunday', shortDay: 'Sun', type: 'strength', label: 'Strength — 7–9am', duration: '60–90 min', breakdown: ['Morning window: 7:00–9:00am', 'Warm-up / mobility', 'Full-body strength work', 'Accessory work'] },
  ];
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
    { label: 'Improved Health', icon: '\u2764\uFE0F', bgColor: 'rgba(110,187,122,0.1)', borderColor: 'rgba(110,187,122,0.3)', textColor: '#6EBB7A' },
    { label: 'Improved Endurance', icon: '\u26A1', bgColor: 'rgba(91,155,213,0.1)', borderColor: 'rgba(91,155,213,0.3)', textColor: '#5B9BD5' },
    { label: 'Increased Strength', icon: '\uD83D\uDCAA', bgColor: 'rgba(245,166,35,0.1)', borderColor: 'rgba(245,166,35,0.3)', textColor: '#F5A623' },
    { label: 'Increased Muscle Mass', icon: '\uD83C\uDFCB\uFE0F', bgColor: 'rgba(126,184,232,0.1)', borderColor: 'rgba(126,184,232,0.25)', textColor: '#7EB8E8' },
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
  strength: { bg: 'rgba(91,155,213,0.14)', border: 'rgba(91,155,213,0.35)', text: '#5B9BD5', dot: '#5B9BD5' },
  cardio: { bg: 'rgba(245,166,35,0.14)', border: 'rgba(245,166,35,0.35)', text: '#F5A623', dot: '#F5A623' },
  rest: { bg: 'rgba(42,51,71,0.3)', border: '#1E2535', text: '#4A5568', dot: '#2A3347' },
  optional: { bg: 'rgba(110,187,122,0.08)', border: 'rgba(110,187,122,0.2)', text: '#6EBB7A', dot: '#6EBB7A' },
  Strength: { bg: 'rgba(91,155,213,0.14)', border: 'rgba(91,155,213,0.35)', text: '#5B9BD5', dot: '#5B9BD5' },
  Endurance: { bg: 'rgba(245,166,35,0.14)', border: 'rgba(245,166,35,0.35)', text: '#F5A623', dot: '#F5A623' },
  Rest: { bg: 'rgba(42,51,71,0.3)', border: '#1E2535', text: '#4A5568', dot: '#2A3347' },
  Optional: { bg: 'rgba(110,187,122,0.08)', border: 'rgba(110,187,122,0.2)', text: '#6EBB7A', dot: '#6EBB7A' },
};

export const phaseColors = ['#5B9BD5', '#F5A623', '#6EBB7A'];

export const dayTypeOptions: { value: DayPlan['type']; label: string }[] = [
  { value: 'strength', label: 'Strength' },
  { value: 'cardio', label: 'Endurance' },
  { value: 'rest', label: 'Rest' },
  { value: 'optional', label: 'Optional' },
];

export const guidanceLevels: GuidanceLevel[] = ['Fully guided', 'Blended', 'Self-reliant'];
