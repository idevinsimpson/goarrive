/**
 * GoArrive Plan Data Types — Aligned with Forge UX patterns
 * Session types: Strength, Cardio + Mobility, Mix, Rest
 * Pricing engine with per-type guidance profiles
 */

// ─── Session schedule ─────────────────────────────────────────────────────────

export type SessionType = 'Strength' | 'Cardio + Mobility' | 'Mix' | 'Rest';

export interface DayPlan {
  day: string;
  shortDay: string;
  type: SessionType;
  isSession: boolean;
  label: string;
  duration: number; // minutes, 0 for rest
  breakdown?: string[];
}

export type SessionsPerWeek = 2 | 3 | 4 | 5 | 6;

export const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const FULL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const SESSION_TYPES: SessionType[] = ['Strength', 'Cardio + Mobility', 'Mix', 'Rest'];

// ─── Guidance system ──────────────────────────────────────────────────────────

export type GuidanceLevel = 'Fully guided' | 'Blended' | 'Self-reliant';

export const GUIDANCE_FACTORS: Record<GuidanceLevel, number> = {
  'Fully guided': 1.0,
  'Blended': 0.625,
  'Self-reliant': 0,
};

export const GUIDANCE_SHORT: Record<GuidanceLevel, string> = {
  'Fully guided': 'Full',
  'Blended': 'Blend',
  'Self-reliant': 'Self',
};

export const guidanceLevels: GuidanceLevel[] = ['Fully guided', 'Blended', 'Self-reliant'];

export interface SessionTypeGuidance {
  sessionType: 'Strength' | 'Cardio + Mobility' | 'Mix';
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
  totalSessions: number;
  commitToSaveActive: boolean;
  commitToSaveSavings: number;
  noShowFee: number;
  isManualOverride: boolean;
  manualMonthlyOverride?: number;
  phaseBreakdown: PhaseHoursDetail[];
}

// ─── Support phases ───────────────────────────────────────────────────────────

export interface Phase {
  id: number;
  name: string;
  weeks: number;
  intensity: 'Fully Guided' | 'Shared Guidance' | 'Self-Reliant';
  description: string;
}

// ─── Nutrition add-on ─────────────────────────────────────────────────────────

export interface NutritionAddOn {
  enabled: boolean;
  type: 'in-house' | 'outsourced';
  providerName: string;
  monthlyCost: number;
  description: string;
}

// ─── Commit to Save add-on ──────────────────────────────────────────────────

export interface CommitToSave {
  enabled: boolean;
  active: boolean;
  monthlySavings: number;
  missedSessionFee: number;
  nextMonthPercentOff: number;
  summary: string;
  makeUpWindowHours: number;
  reentryRule: string;
  emergencyWaiverEnabled: boolean;
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
  subtitle?: string;
  planSubtitle?: string;
  identityTag?: string;
  referredBy?: string;

  // Starting Points
  startingPoints: string[];
  startingPointIntro?: string;

  // Goals
  goals: string[];
  currentWeight?: string | number;
  goalWeight?: string;
  gymConfidence?: number;
  gym?: string;
  goalSummary?: string;

  // Why
  whyStatement: string;
  whyTranslation: string;
  readiness: number;
  motivation: number;

  // Weekly Plan
  sessionsPerWeek: SessionsPerWeek;
  contractMonths: ContractLength;
  weeklySchedule: DayPlan[];

  // Phases
  phases: Phase[];

  // What's Included
  whatsIncluded: string[];

  // Pricing — top-level for easy access
  hourlyRate: number;
  sessionLengthMinutes: number;
  checkInCallMinutes: number;
  programBuildTimeHours: number;
  sessionGuidanceProfiles: SessionTypeGuidance[];
  showInvestment: boolean;
  payInFullDiscountPercent: number;

  // Manual override
  isManualOverride?: boolean;
  monthlyPriceOverride?: number;

  // Cached pricing result
  pricingResult?: PricingResult;

  // Commit to Save
  commitToSave?: CommitToSave;

  // Nutrition add-on
  nutrition?: NutritionAddOn;

  // Injury notes
  injuryNotes?: string;

  // Timestamps
  createdAt?: any;
  updatedAt?: any;

  // Shareable link
  shareToken?: string;

  // ── Legacy / backward-compat aliases ──
  contractLengthMonths?: number;
  pricingInputs?: PricingInputs;
  monthlyPrice?: number;
  perSessionPrice?: number;
  payInFullPrice?: number;
  payInFullDiscount?: number;
  commitToSaveEnabled?: boolean;
  commitToSaveAddOnActive?: boolean;
  commitToSaveMonthlySavings?: number;
  commitToSaveMissedSessionFee?: number;
  commitToSaveNextMonthPercentOff?: number;
  commitToSaveSummary?: string;
  commitToSaveMakeUpWindowHours?: number;
  commitToSaveReentryRule?: string;
  commitToSaveEmergencyWaiverEnabled?: boolean;
  nutritionEnabled?: boolean;
  nutritionAddOnActive?: boolean;
  nutritionMonthlyCost?: number;
  nutritionInHouse?: boolean;
  nutritionProviderName?: string;
  nutritionDescription?: string;
  age?: number;
  healthGoals?: string[];
  weekPlan4?: DayPlan[];
  weekPlan3?: DayPlan[];
  weekPlan2?: DayPlan[];
  weeklyPlan?: DayPlan[];
}

// ─── Pricing engine ───────────────────────────────────────────────────────────

export function monthsToWeeks(months: number): number {
  if (months === 6) return 26;
  if (months === 9) return 39;
  if (months === 12) return 52;
  return Math.round(months * (52 / 12));
}

export function getDefaultGuidance(sessionType: 'Strength' | 'Cardio + Mobility' | 'Mix'): SessionTypeGuidance {
  return { sessionType, phase1: 'Fully guided', phase2: 'Blended', phase3: 'Self-reliant' };
}

export function getGuidanceProfile(
  sessionType: 'Strength' | 'Cardio + Mobility' | 'Mix',
  profiles: SessionTypeGuidance[]
): SessionTypeGuidance {
  return profiles.find(p => p.sessionType === sessionType) || getDefaultGuidance(sessionType);
}

export function countSessionsByType(schedule: DayPlan[]): Record<string, number> {
  const counts: Record<string, number> = {};
  schedule.forEach(day => {
    if (day.isSession && day.type !== 'Rest') {
      counts[day.type] = (counts[day.type] || 0) + 1;
    }
  });
  return counts;
}

/**
 * Calculate pricing from a plan object (convenience overload).
 * Reads all fields directly from the plan.
 */
export function calculatePricing(plan: MemberPlanData): PricingResult;
/**
 * Calculate pricing from individual arguments (legacy overload).
 */
export function calculatePricing(
  schedule: DayPlan[],
  sessionsPerWeek: SessionsPerWeek,
  contractLengthMonths: ContractLength,
  phases: Phase[],
  inputs: PricingInputs,
  guidanceProfiles: SessionTypeGuidance[],
  commitToSaveActive: boolean,
  manualMonthlyOverride?: number
): PricingResult;
export function calculatePricing(
  planOrSchedule: MemberPlanData | DayPlan[],
  sessionsPerWeek?: SessionsPerWeek,
  contractLengthMonths?: ContractLength,
  phases?: Phase[],
  inputs?: PricingInputs,
  guidanceProfiles?: SessionTypeGuidance[],
  commitToSaveActive?: boolean,
  manualMonthlyOverride?: number
): PricingResult {
  // Detect which overload
  if (!Array.isArray(planOrSchedule) && 'memberId' in planOrSchedule) {
    // Plan object overload
    const p = planOrSchedule as MemberPlanData;
    return _calculatePricing(
      p.weeklySchedule,
      p.sessionsPerWeek,
      p.contractMonths || (p.contractLengthMonths as ContractLength) || 12,
      p.phases,
      {
        hourlyRate: p.hourlyRate || p.pricingInputs?.hourlyRate || 100,
        sessionLengthMinutes: p.sessionLengthMinutes || p.pricingInputs?.sessionLengthMinutes || 60,
        checkInCallLengthMinutes: p.checkInCallMinutes || p.pricingInputs?.checkInCallLengthMinutes || 30,
        programBuildTimeHours: p.programBuildTimeHours || p.pricingInputs?.programBuildTimeHours || 5,
      },
      p.sessionGuidanceProfiles || [],
      p.commitToSave?.active ?? p.commitToSaveAddOnActive ?? true,
      p.isManualOverride ? p.monthlyPriceOverride : undefined,
      p.commitToSave?.monthlySavings ?? p.commitToSaveMonthlySavings ?? 100,
      p.commitToSave?.missedSessionFee ?? p.commitToSaveMissedSessionFee ?? 50,
      p.payInFullDiscountPercent ?? 10,
    );
  }
  // Legacy overload
  return _calculatePricing(
    planOrSchedule as DayPlan[],
    sessionsPerWeek!,
    contractLengthMonths!,
    phases!,
    inputs!,
    guidanceProfiles!,
    commitToSaveActive!,
    manualMonthlyOverride,
  );
}

function _calculatePricing(
  schedule: DayPlan[],
  sessionsPerWeek: SessionsPerWeek,
  contractLengthMonths: ContractLength,
  phases: Phase[],
  inputs: PricingInputs,
  guidanceProfiles: SessionTypeGuidance[],
  commitToSaveActive: boolean,
  manualMonthlyOverride?: number,
  commitToSaveMonthlySavings: number = 100,
  commitToSaveMissedSessionFee: number = 50,
  payInFullDiscountPercent: number = 10,
): PricingResult {
  const hourlyRate = Math.max(1, inputs.hourlyRate);
  const sessionLengthMinutes = Math.max(1, inputs.sessionLengthMinutes);
  const checkInCallLengthMinutes = Math.max(0, inputs.checkInCallLengthMinutes);
  const programBuildTimeHours = Math.max(0, inputs.programBuildTimeHours);

  const months = contractLengthMonths;
  const weeks = monthsToWeeks(months);
  const P1 = phases[0]?.weeks ?? 6;
  const P2 = phases[1]?.weeks ?? 16;
  const P3 = Math.max(0, weeks - P1 - P2);

  const sessionCounts = countSessionsByType(schedule);
  const activeTypes = Object.keys(sessionCounts) as ('Strength' | 'Cardio + Mobility' | 'Mix')[];

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
        phase1Hours, phase2Hours, phase3Hours,
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

  const displayMonthlyPrice = commitToSaveActive
    ? Math.max(0, baseMonthlyPrice - commitToSaveMonthlySavings)
    : baseMonthlyPrice;

  const totalSessions = weeks * sessionsPerWeek;
  const effectiveTotalPrice = displayMonthlyPrice * months;
  const perSessionPrice = totalSessions > 0
    ? Math.round(effectiveTotalPrice / totalSessions)
    : 0;
  const payInFullPrice = Math.round(effectiveTotalPrice * (1 - payInFullDiscountPercent / 100));

  return {
    hourlyRate, sessionLengthMinutes, checkInCallLengthMinutes, programBuildTimeHours,
    calculatedMonthlyPrice, baseMonthlyPrice, displayMonthlyPrice,
    perSessionPrice, payInFullPrice, payInFullDiscount: payInFullDiscountPercent,
    totalCoachingHours, checkInHours, buildHours, totalHours, totalProgramPrice,
    totalSessions,
    commitToSaveActive, commitToSaveSavings: commitToSaveMonthlySavings,
    noShowFee: commitToSaveMissedSessionFee,
    isManualOverride, manualMonthlyOverride, phaseBreakdown,
  };
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(amount);
}

// ─── Schedule generation ─────────────────────────────────────────────────────

function getDistributedDays(count: number): number[] {
  if (count >= 7) return [0, 1, 2, 3, 4, 5, 6];
  if (count === 6) return [0, 1, 2, 3, 4, 5];
  if (count === 5) return [0, 1, 2, 3, 4];
  if (count === 4) return [0, 1, 3, 4];
  if (count === 3) return [0, 2, 4];
  if (count === 2) return [1, 4];
  if (count === 1) return [2];
  return [];
}

export function createDefaultSchedule(sessionsPerWeek: number): DayPlan[] {
  const schedule: DayPlan[] = FULL_DAYS.map((day, i) => ({
    day,
    shortDay: DAYS_OF_WEEK[i],
    type: 'Rest' as SessionType,
    isSession: false,
    label: 'Rest',
    duration: 0,
  }));

  const sessionDays = getDistributedDays(sessionsPerWeek);
  const typePattern: ('Strength' | 'Cardio + Mobility' | 'Mix')[] = [
    'Strength', 'Cardio + Mobility', 'Strength', 'Mix', 'Strength', 'Cardio + Mobility', 'Mix',
  ];

  sessionDays.forEach((dayIndex, i) => {
    const type = typePattern[i % typePattern.length];
    schedule[dayIndex] = {
      day: FULL_DAYS[dayIndex],
      shortDay: DAYS_OF_WEEK[dayIndex],
      type,
      isSession: true,
      label: type,
      duration: 60,
    };
  });

  return schedule;
}

// ─── Phase generation ────────────────────────────────────────────────────────

export function createDefaultPhases(contractLengthMonths: number = 12): Phase[] {
  const totalWeeks = monthsToWeeks(contractLengthMonths);
  const phase1Weeks = Math.round(totalWeeks * 0.12);
  const phase2Weeks = Math.round(totalWeeks * 0.30);
  const phase3Weeks = totalWeeks - phase1Weeks - phase2Weeks;

  return [
    {
      id: 1, name: 'Phase 1', weeks: phase1Weeks, intensity: 'Fully Guided',
      description: "We're live together for the full session while you learn the movements and routines.",
    },
    {
      id: 2, name: 'Phase 2', weeks: phase2Weeks, intensity: 'Shared Guidance',
      description: "Some sessions or parts of sessions you'll tackle on your own, while I'm right there coaching you through others. Workouts are captured automatically so I can review everything and keep your program dialed in.",
    },
    {
      id: 3, name: 'Phase 3', weeks: phase3Weeks, intensity: 'Self-Reliant',
      description: "You're confidently following your tailored plan with me still in your corner. Workouts are captured automatically so I can check in and keep your program on track — no guessing.",
    },
  ];
}

// ─── Default Commit to Save ─────────────────────────────────────────────────

export function createDefaultCommitToSave(): CommitToSave {
  return {
    enabled: true,
    active: true,
    monthlySavings: 100,
    missedSessionFee: 50,
    nextMonthPercentOff: 5,
    summary: 'Save $100 per month on your membership when you commit to showing up consistently. Small $50 fee only if you no-show a scheduled session without notice.',
    makeUpWindowHours: 48,
    reentryRule: 'If you opt out, you can re-enter at the start of the next billing cycle.',
    emergencyWaiverEnabled: true,
  };
}

// ─── Default Nutrition ──────────────────────────────────────────────────────

export function createDefaultNutrition(): NutritionAddOn {
  return {
    enabled: false,
    type: 'in-house',
    providerName: '',
    monthlyCost: 100,
    description: 'Add personalized nutrition coaching to your plan. Includes a custom nutrition strategy, macro targets, and monthly check-ins with a dedicated nutrition coach.',
  };
}

// ─── Default plan data ────────────────────────────────────────────────────────

export function createDefaultPlan(memberName: string, memberId: string, coachId: string): MemberPlanData {
  const schedule = createDefaultSchedule(4);
  const phases = createDefaultPhases(12);

  return {
    memberId,
    coachId,
    status: 'draft',
    memberName,
    memberAge: 0,
    subtitle: 'Built to help you train with purpose, build strength, and create real discipline.',
    identityTag: 'Ready to train',
    referredBy: '',
    startingPoints: [],
    startingPointIntro: "You're not starting from zero. You're starting with solid habits and real readiness — just without a structured coaching system behind it.",
    goals: [],
    currentWeight: '',
    goalWeight: '',
    gymConfidence: 5,
    gym: '',
    goalSummary: '',
    whyStatement: '',
    whyTranslation: '',
    readiness: 7,
    motivation: 8,
    sessionsPerWeek: 4,
    contractMonths: 12,
    weeklySchedule: schedule,
    phases,
    whatsIncluded: [
      '4 coaching sessions per week',
      '12-month commitment',
      'Tailored fitness plan updated as you progress',
      'Injury-aware programming adapted to your needs',
      'Monthly progress check-in calls',
    ],
    // Pricing — top-level
    hourlyRate: 100,
    sessionLengthMinutes: 60,
    checkInCallMinutes: 30,
    programBuildTimeHours: 5,
    sessionGuidanceProfiles: [
      { sessionType: 'Strength', phase1: 'Fully guided', phase2: 'Blended', phase3: 'Self-reliant' },
      { sessionType: 'Cardio + Mobility', phase1: 'Fully guided', phase2: 'Blended', phase3: 'Self-reliant' },
      { sessionType: 'Mix', phase1: 'Fully guided', phase2: 'Blended', phase3: 'Self-reliant' },
    ],
    showInvestment: false,
    payInFullDiscountPercent: 10,
    isManualOverride: false,
    // Commit to Save
    commitToSave: createDefaultCommitToSave(),
    // Nutrition
    nutrition: createDefaultNutrition(),
  };
}

// ─── Goal display config ─────────────────────────────────────────────────────

export const HEALTH_GOALS = [
  'Feel healthier', 'Fat loss', 'Build muscle', 'Improve endurance',
  'Lower stress', 'Better sleep', 'More energy', 'Increase flexibility',
  'Build confidence', 'Manage pain',
];

export const goalConfig: Record<string, { emoji: string; color: string }> = {
  'Improved Health': { emoji: '\u2764\uFE0F', color: '#6EBB7A' },
  'Improved Endurance': { emoji: '\u26A1', color: '#5B9BD5' },
  'Increased Strength': { emoji: '\uD83D\uDCAA', color: '#F5A623' },
  'Increased Muscle Mass': { emoji: '\uD83C\uDFCB\uFE0F', color: '#7EB8E8' },
  'Weight Loss': { emoji: '\uD83C\uDFAF', color: '#E06B6B' },
  'Flexibility': { emoji: '\uD83E\uDDD8', color: '#9B8FD5' },
  'Mental Health': { emoji: '\uD83E\uDDE0', color: '#5B9BD5' },
  'Better Sleep': { emoji: '\uD83D\uDE34', color: '#7EB8E8' },
  'Feel healthier': { emoji: '\u2764\uFE0F', color: '#6EBB7A' },
  'Fat loss': { emoji: '\uD83D\uDD25', color: '#E06B6B' },
  'Build muscle': { emoji: '\uD83D\uDCAA', color: '#F5A623' },
  'Improve endurance': { emoji: '\uD83C\uDFC3', color: '#5B9BD5' },
  'Lower stress': { emoji: '\uD83C\uDF19', color: '#9B8FD5' },
  'More energy': { emoji: '\u26A1', color: '#F5A623' },
  'Increase flexibility': { emoji: '\uD83E\uDDD8', color: '#9B8FD5' },
  'Build confidence': { emoji: '\uD83D\uDE0A', color: '#6EBB7A' },
  'Manage pain': { emoji: '\uD83C\uDFAF', color: '#E06B6B' },
};

export const availableGoals = [
  'Improved Health', 'Improved Endurance', 'Increased Strength', 'Increased Muscle Mass',
  'Weight Loss', 'Flexibility', 'Mental Health', 'Better Sleep',
];

// ─── Day type colors ─────────────────────────────────────────────────────────

export const typeColors: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  'Strength': { bg: 'rgba(91,155,213,0.14)', border: 'rgba(91,155,213,0.35)', text: '#5B9BD5', dot: '#5B9BD5' },
  'Cardio + Mobility': { bg: 'rgba(245,166,35,0.14)', border: 'rgba(245,166,35,0.35)', text: '#F5A623', dot: '#F5A623' },
  'Mix': { bg: 'rgba(110,187,122,0.14)', border: 'rgba(110,187,122,0.35)', text: '#6EBB7A', dot: '#6EBB7A' },
  'Rest': { bg: 'rgba(42,51,71,0.3)', border: '#1E2535', text: '#4A5568', dot: '#2A3347' },
  'strength': { bg: 'rgba(91,155,213,0.14)', border: 'rgba(91,155,213,0.35)', text: '#5B9BD5', dot: '#5B9BD5' },
  'cardio': { bg: 'rgba(245,166,35,0.14)', border: 'rgba(245,166,35,0.35)', text: '#F5A623', dot: '#F5A623' },
  'rest': { bg: 'rgba(42,51,71,0.3)', border: '#1E2535', text: '#4A5568', dot: '#2A3347' },
  'optional': { bg: 'rgba(110,187,122,0.08)', border: 'rgba(110,187,122,0.2)', text: '#6EBB7A', dot: '#6EBB7A' },
};

export const phaseColors = ['#5B9BD5', '#F5A623', '#6EBB7A'];

export const dayTypeOptions: { value: SessionType; label: string }[] = [
  { value: 'Strength', label: 'Strength' },
  { value: 'Cardio + Mobility', label: 'Cardio + Mobility' },
  { value: 'Mix', label: 'Mix' },
  { value: 'Rest', label: 'Rest' },
];
