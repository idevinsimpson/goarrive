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

export const phaseColors: Record<GuidanceLevel, { text: string; bg: string; bar: string; border: string }> = {
  'Fully guided': { text: '#E0FFE0', bg: 'rgba(110,187,122,0.15)', bar: '#6EBB7A', border: 'rgba(110,187,122,0.5)' },
  'Blended': { text: '#E0F0FF', bg: 'rgba(91,155,213,0.15)', bar: '#5B9BD5', border: 'rgba(91,155,213,0.5)' },
  'Self-reliant': { text: '#FFF8E0', bg: 'rgba(255,192,0,0.15)', bar: '#FFC000', border: 'rgba(255,192,0,0.5)' },
};

export const guidanceLevels: GuidanceLevel[] = ['Fully guided', 'Blended', 'Self-reliant'];

// Normalize any intensity string (from Firestore data) to a phaseColors key.
// Handles legacy names like 'Fully Guided', 'Shared Guidance', 'Self-Reliant'.
const _FALLBACK_PC = { text: '#E0E0E0', bg: 'rgba(255,255,255,0.08)', bar: '#888', border: 'rgba(255,255,255,0.2)' };
export function resolvePhaseColor(intensity: string): { text: string; bg: string; bar: string; border: string } {
  if (!intensity) return _FALLBACK_PC;
  const lower = intensity.toLowerCase().trim();
  if (lower.includes('full')) return phaseColors['Fully guided'];
  if (lower.includes('blend') || lower.includes('shared') || lower.includes('mix')) return phaseColors['Blended'];
  if (lower.includes('self') || lower.includes('reliant')) return phaseColors['Self-reliant'];
  return phaseColors[intensity as GuidanceLevel] ?? _FALLBACK_PC;
}

// Array-indexed phase colors for member/shared plan views (index 0=Phase1, 1=Phase2, 2=Phase3)
export const phaseColorList: string[] = ['#6EBB7A', '#5B9BD5', '#F5A623'];

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

export type PhaseType = 'Fully Guided' | 'Shared Guidance' | 'Self-Reliant';

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
  status: 'draft' | 'pending' | 'presented' | 'accepted' | 'active';

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

export function formatCurrency(amount: number): string {
  if (amount == null || isNaN(amount)) return '$0';
  return '$' + Math.round(amount).toLocaleString('en-US');
}

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
  if (planOrSchedule && !Array.isArray(planOrSchedule) && 'memberId' in planOrSchedule) {
    // Plan object overload
    const p = planOrSchedule as MemberPlanData;
    return _calculatePricing(
      p.weeklySchedule || [],
      p.sessionsPerWeek || 3,
      p.contractMonths || (p.contractLengthMonths as ContractLength) || 12,
      p.phases || [],
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
  const safeInputs = inputs || { hourlyRate: 100, sessionLengthMinutes: 60, checkInCallLengthMinutes: 30, programBuildTimeHours: 5 };
  const { hourlyRate, sessionLengthMinutes, checkInCallLengthMinutes, programBuildTimeHours } = safeInputs;

  const totalWeeks = monthsToWeeks(contractLengthMonths);
  const phase1Weeks = Math.round(totalWeeks * 0.25);
  const phase3Weeks = Math.round(totalWeeks * 0.25);
  const phase2Weeks = totalWeeks - phase1Weeks - phase3Weeks;

  const sessionCounts = countSessionsByType(schedule);
  const totalSessionsPerWeek = Object.values(sessionCounts).reduce((sum, count) => sum + count, 0);

  const phaseBreakdown: PhaseHoursDetail[] = Object.keys(sessionCounts).map(type => {
    const sessionType = type as 'Strength' | 'Cardio + Mobility' | 'Mix';
    const sessions = sessionCounts[sessionType];
    const guidance = getGuidanceProfile(sessionType, guidanceProfiles);

    const phase1Hours = (sessions * phase1Weeks * (sessionLengthMinutes / 60)) * GUIDANCE_FACTORS[guidance.phase1];
    const phase2Hours = (sessions * phase2Weeks * (sessionLengthMinutes / 60)) * GUIDANCE_FACTORS[guidance.phase2];
    const phase3Hours = (sessions * phase3Weeks * (sessionLengthMinutes / 60)) * GUIDANCE_FACTORS[guidance.phase3];

    return {
      sessionType,
      sessionsPerWeek: sessions,
      phase1Hours,
      phase2Hours,
      phase3Hours,
      totalHours: phase1Hours + phase2Hours + phase3Hours,
      phase1Guidance: guidance.phase1,
      phase2Guidance: guidance.phase2,
      phase3Guidance: guidance.phase3,
    };
  });

  const totalCoachingHours = phaseBreakdown.reduce((sum, item) => sum + item.totalHours, 0);
  const checkInHours = (contractLengthMonths * 2 * (checkInCallLengthMinutes / 60)); // 2 calls/mo
  const buildHours = programBuildTimeHours;
  const totalHours = totalCoachingHours + checkInHours + buildHours;
  const totalProgramPrice = totalHours * hourlyRate;
  const baseMonthlyPrice = totalProgramPrice / contractLengthMonths;

  let displayMonthlyPrice = baseMonthlyPrice;
  if (commitToSaveActive) {
    displayMonthlyPrice -= commitToSaveMonthlySavings;
  }

  const isManualOverride = typeof manualMonthlyOverride === 'number' && manualMonthlyOverride > 0;
  if (isManualOverride) {
    displayMonthlyPrice = manualMonthlyOverride;
  }

  const totalSessions = totalSessionsPerWeek * totalWeeks;
  const perSessionPrice = displayMonthlyPrice > 0 && totalSessions > 0 ? (displayMonthlyPrice * contractLengthMonths) / totalSessions : 0;

  const payInFullPrice = displayMonthlyPrice * contractLengthMonths * (1 - (payInFullDiscountPercent / 100));

  return {
    hourlyRate,
    sessionLengthMinutes,
    checkInCallLengthMinutes,
    programBuildTimeHours,
    calculatedMonthlyPrice: baseMonthlyPrice,
    baseMonthlyPrice,
    displayMonthlyPrice,
    perSessionPrice,
    payInFullPrice,
    payInFullDiscount: (displayMonthlyPrice * contractLengthMonths) - payInFullPrice,
    totalCoachingHours,
    checkInHours,
    buildHours,
    totalHours,
    totalProgramPrice,
    totalSessions,
    commitToSaveActive,
    commitToSaveSavings: commitToSaveActive ? commitToSaveMonthlySavings : 0,
    noShowFee: commitToSaveMissedSessionFee,
    isManualOverride,
    manualMonthlyOverride,
    phaseBreakdown,
  };
}

// ─── Default schedule ───────────────────────────────────────────────────────────

export function createDefaultSchedule(sessionsPerWeek: SessionsPerWeek): DayPlan[] {
  const basePlan: SessionType[] = ['Strength', 'Cardio + Mobility', 'Rest', 'Strength', 'Cardio + Mobility', 'Rest', 'Rest'];
  if (sessionsPerWeek === 2) {
    basePlan[1] = 'Rest';
    basePlan[4] = 'Rest';
  }
  if (sessionsPerWeek === 3) {
    basePlan[1] = 'Rest';
    basePlan[4] = 'Mix';
    basePlan[5] = 'Rest';
  }
  if (sessionsPerWeek === 4) {
    basePlan[5] = 'Strength';
  }
  if (sessionsPerWeek === 5) {
    basePlan[5] = 'Strength';
    basePlan[6] = 'Cardio + Mobility';
  }
  if (sessionsPerWeek === 6) {
    basePlan[2] = 'Strength';
    basePlan[5] = 'Strength';
    basePlan[6] = 'Cardio + Mobility';
  }

  return DAYS_OF_WEEK.map((day, i) => {
    const type = basePlan[i];
    const isSession = type !== 'Rest';
    return {
      day: FULL_DAYS[i],
      shortDay: day,
      type,
      isSession,
      label: isSession ? `${type} Session` : 'Rest Day',
      duration: isSession ? 60 : 0,
    };
  });
}

// ─── Default phases ─────────────────────────────────────────────────────────────

export function createDefaultPhases(contractMonths: number): Phase[] {
  const totalWeeks = monthsToWeeks(contractMonths);
  const phase1Weeks = Math.round(totalWeeks * 0.25);
  const phase3Weeks = Math.round(totalWeeks * 0.25);
  const phase2Weeks = totalWeeks - phase1Weeks - phase3Weeks;

  return [
    {
      id: 1, name: 'Phase 1', weeks: phase1Weeks, intensity: 'Fully Guided',
      description: "We start with hands-on coaching to build a strong foundation. I'll be there every step, ensuring your form is solid and you feel confident in every movement.",
    },
    {
      id: 2, name: 'Phase 2', weeks: phase2Weeks, intensity: 'Shared Guidance',
      description: "We shift to a blended model where you take more ownership. I'll provide the structure and support while you begin to drive your progress independently.",
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

// ─── Type colors (used by day tiles in coach and member views) ──────────────────

export const typeColors: Record<SessionType, { text: string; bg: string; border: string; dot: string }> = {
  'Strength':         { text: '#6EBB7A', bg: 'rgba(110,187,122,0.12)', border: 'rgba(110,187,122,0.35)', dot: '#6EBB7A' },
  'Cardio + Mobility':{ text: '#5B9BD5', bg: 'rgba(91,155,213,0.12)',  border: 'rgba(91,155,213,0.35)',  dot: '#5B9BD5' },
  'Mix':              { text: '#F5A623', bg: 'rgba(245,166,35,0.12)',  border: 'rgba(245,166,35,0.35)',  dot: '#F5A623' },
  'Rest':             { text: '#4A5568', bg: 'rgba(42,51,71,0.2)',     border: 'transparent',            dot: '#4A5568' },
};

// ─── Available goals (alias for HEALTH_GOALS) ────────────────────────────────

export const availableGoals = [
  'Feel healthier', 'Fat loss', 'Build muscle', 'Improve endurance',
  'Lower stress', 'Better sleep', 'More energy', 'Increase flexibility',
  'Build confidence', 'Manage pain',
];

// ─── Day type options (for coach dropdown picker) ────────────────────────────

export const dayTypeOptions: { label: string; value: SessionType }[] = [
  { label: 'Strength',  value: 'Strength' },
  { label: 'Cardio',    value: 'Cardio + Mobility' },
  { label: 'Mix',       value: 'Mix' },
  { label: 'Rest',      value: 'Rest' },
];

// ─── Goal display config ─────────────────────────────────────────────────────

export const HEALTH_GOALS = [
  'Feel healthier', 'Fat loss', 'Build muscle', 'Improve endurance',
  'Lower stress', 'Better sleep', 'More energy', 'Increase flexibility',
  'Build confidence', 'Manage pain',
];

export const goalConfig: Record<string, { emoji: string; color: string }> = {
  'Feel healthier': { emoji: '😊', color: '#6EBB7A' },
  'Fat loss': { emoji: '🔥', color: '#FFC000' },
  'Build muscle': { emoji: '💪', color: '#5B9BD5' },
  'Improve endurance': { emoji: '🏃', color: '#FFC000' },
  'Lower stress': { emoji: '🧘', color: '#6EBB7A' },
  'Better sleep': { emoji: '😴', color: '#5B9BD5' },
  'More energy': { emoji: '⚡', color: '#FFC000' },
  'Increase flexibility': { emoji: '🤸', color: '#6EBB7A' },
  'Build confidence': { emoji: '🚀', color: '#5B9BD5' },
  'Manage pain': { emoji: '❤️‍🩹', color: '#FFC000' },
};
