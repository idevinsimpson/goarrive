/**
 * Tests for pricing and payment utility functions from planTypes.ts
 */
import {
  formatCurrency,
  monthsToWeeks,
  getDefaultGuidance,
  getGuidanceProfile,
  countSessionsByType,
  createDefaultSchedule,
  createDefaultPhases,
  calculatePricing,
  createDefaultPlan,
} from '../../lib/planTypes';

describe('formatCurrency', () => {
  it('formats whole numbers', () => {
    expect(formatCurrency(500)).toBe('$500');
  });

  it('rounds decimals', () => {
    expect(formatCurrency(499.7)).toBe('$500');
  });

  it('formats large numbers with commas', () => {
    expect(formatCurrency(10000)).toBe('$10,000');
  });

  it('handles zero', () => {
    expect(formatCurrency(0)).toBe('$0');
  });

  it('handles NaN', () => {
    expect(formatCurrency(NaN)).toBe('$0');
  });
});

describe('monthsToWeeks', () => {
  it('converts 6 months to 26 weeks', () => {
    expect(monthsToWeeks(6)).toBe(26);
  });

  it('converts 9 months to 39 weeks', () => {
    expect(monthsToWeeks(9)).toBe(39);
  });

  it('converts 12 months to 52 weeks', () => {
    expect(monthsToWeeks(12)).toBe(52);
  });
});

describe('getDefaultGuidance', () => {
  it('returns default phase progression for Strength', () => {
    const g = getDefaultGuidance('Strength');
    expect(g.sessionType).toBe('Strength');
    expect(g.phase1).toBe('Fully guided');
    expect(g.phase2).toBe('Blended');
    expect(g.phase3).toBe('Self-reliant');
  });
});

describe('getGuidanceProfile', () => {
  it('finds matching profile from list', () => {
    const profiles = [
      { sessionType: 'Strength' as const, phase1: 'Blended' as const, phase2: 'Blended' as const, phase3: 'Self-reliant' as const },
    ];
    const result = getGuidanceProfile('Strength', profiles);
    expect(result.phase1).toBe('Blended');
  });

  it('returns default when no match found', () => {
    const result = getGuidanceProfile('Mix', []);
    expect(result.sessionType).toBe('Mix');
    expect(result.phase1).toBe('Fully guided');
  });
});

describe('countSessionsByType', () => {
  it('counts non-rest session types', () => {
    const schedule = createDefaultSchedule(3);
    const counts = countSessionsByType(schedule);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(3); // 3 sessions per week
  });

  it('excludes rest days from count', () => {
    const schedule = createDefaultSchedule(3);
    const counts = countSessionsByType(schedule);
    expect(counts['Rest']).toBeUndefined();
  });
});

describe('createDefaultSchedule', () => {
  it('creates a 7-day schedule', () => {
    const schedule = createDefaultSchedule(3);
    expect(schedule).toHaveLength(7);
  });

  it('more sessions per week means fewer rest days', () => {
    const s3 = createDefaultSchedule(3).filter(d => d.type === 'Rest').length;
    const s5 = createDefaultSchedule(5).filter(d => d.type === 'Rest').length;
    expect(s3).toBeGreaterThan(s5);
  });

  it.each([2, 3, 4, 5, 6] as const)('createDefaultSchedule(%i) produces exactly %i session days', (n) => {
    const sessionDays = createDefaultSchedule(n).filter(d => d.isSession && d.type !== 'Rest');
    expect(sessionDays).toHaveLength(n);
  });
});

describe('createDefaultPhases', () => {
  it('creates 3 phases for a 12-month contract', () => {
    const phases = createDefaultPhases(12);
    expect(phases).toHaveLength(3);
  });

  it('phase weeks sum to contract weeks', () => {
    const phases = createDefaultPhases(12);
    const totalWeeks = phases.reduce((sum, p) => sum + p.weeks, 0);
    expect(totalWeeks).toBe(52);
  });
});

describe('calculatePricing', () => {
  it('calculates pricing from a default plan', () => {
    const plan = createDefaultPlan('Test Member', 'm1', 'c1');
    const result = calculatePricing(plan);
    expect(result.calculatedMonthlyPrice).toBeGreaterThan(0);
    expect(result.totalProgramPrice).toBeGreaterThan(0);
    expect(result.payInFullPrice).toBeLessThan(result.totalProgramPrice); // PIF discount
  });

  it('manual override replaces calculated price', () => {
    const plan = createDefaultPlan('Test Member', 'm1', 'c1');
    plan.isManualOverride = true;
    plan.monthlyPriceOverride = 999;
    const result = calculatePricing(plan);
    expect(result.displayMonthlyPrice).toBe(999);
  });

  it('2-session plan produces lower price than 6-session plan', () => {
    const plan2 = createDefaultPlan('A', 'm1', 'c1');
    plan2.sessionsPerWeek = 2;
    plan2.weeklySchedule = createDefaultSchedule(2);
    const plan6 = createDefaultPlan('B', 'm2', 'c1');
    plan6.sessionsPerWeek = 6;
    plan6.weeklySchedule = createDefaultSchedule(6);
    expect(calculatePricing(plan2).calculatedMonthlyPrice).toBeLessThan(
      calculatePricing(plan6).calculatedMonthlyPrice
    );
  });

  it('pay-in-full discount produces finite positive value', () => {
    const plan = createDefaultPlan('Test', 'm1', 'c1');
    const result = calculatePricing(plan);
    expect(result.payInFullDiscount).toBeGreaterThan(0);
    expect(Number.isFinite(result.payInFullDiscount)).toBe(true);
  });

  it('all numeric results are finite (no NaN or Infinity)', () => {
    const plan = createDefaultPlan('Test', 'm1', 'c1');
    const result = calculatePricing(plan);
    const numericKeys = Object.entries(result).filter(([, v]) => typeof v === 'number');
    for (const [key, value] of numericKeys) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('short contract (6 months) still produces valid pricing', () => {
    const plan = createDefaultPlan('Test', 'm1', 'c1');
    plan.contractMonths = 6;
    plan.phases = createDefaultPhases(6);
    const result = calculatePricing(plan);
    expect(result.calculatedMonthlyPrice).toBeGreaterThan(0);
    expect(result.totalSessions).toBeGreaterThan(0);
    expect(Number.isFinite(result.totalProgramPrice)).toBe(true);
  });
});

describe('calculatePricing — $0 / free plans', () => {
  it('manual override of 0 produces a free plan', () => {
    const plan = createDefaultPlan('Test', 'm1', 'c1');
    plan.isManualOverride = true;
    plan.monthlyPriceOverride = 0;
    const result = calculatePricing(plan);
    expect(result.isManualOverride).toBe(true);
    expect(result.displayMonthlyPrice).toBe(0);
    expect(result.payInFullPrice).toBe(0);
    expect(result.perSessionPrice).toBe(0);
  });

  it('explicitly zeroed rate inputs produce $0 (0 is not swallowed by defaults)', () => {
    const plan = createDefaultPlan('Test', 'm1', 'c1');
    plan.hourlyRate = 0;
    plan.programBuildTimeHours = 0;
    plan.checkInCallMinutes = 0;
    const result = calculatePricing(plan);
    expect(result.hourlyRate).toBe(0);
    expect(result.calculatedMonthlyPrice).toBe(0);
    // Default plan has CTS active ($100 savings) — must clamp to 0, never negative
    expect(result.displayMonthlyPrice).toBe(0);
  });

  it('weekly and yearly override frequencies at 0 still produce $0', () => {
    const plan = createDefaultPlan('Test', 'm1', 'c1');
    plan.isManualOverride = true;
    plan.monthlyPriceOverride = 0;
    plan.overrideFrequency = 'week';
    expect(calculatePricing(plan).displayMonthlyPrice).toBe(0);
    plan.overrideFrequency = 'year';
    expect(calculatePricing(plan).displayMonthlyPrice).toBe(0);
  });

  it('negative override is ignored and falls back to calculated price', () => {
    const plan = createDefaultPlan('Test', 'm1', 'c1');
    plan.isManualOverride = true;
    plan.monthlyPriceOverride = -50;
    const result = calculatePricing(plan);
    expect(result.isManualOverride).toBe(false);
    expect(result.displayMonthlyPrice).toBeGreaterThan(0);
  });

  it('all numeric results remain finite for a free plan', () => {
    const plan = createDefaultPlan('Test', 'm1', 'c1');
    plan.isManualOverride = true;
    plan.monthlyPriceOverride = 0;
    const result = calculatePricing(plan);
    for (const [, value] of Object.entries(result).filter(([, v]) => typeof v === 'number')) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe('createDefaultPlan', () => {
  it('returns a plan with consistent sessionsPerWeek and schedule length', () => {
    const plan = createDefaultPlan('Test', 'm1', 'c1');
    const sessionDays = plan.weeklySchedule.filter(d => d.isSession && d.type !== 'Rest');
    expect(sessionDays).toHaveLength(plan.sessionsPerWeek);
    expect(plan.weeklySchedule).toHaveLength(7);
  });

  it('phase count matches default 3-phase structure', () => {
    const plan = createDefaultPlan('Test', 'm1', 'c1');
    expect(plan.phases).toHaveLength(3);
    const totalWeeks = plan.phases.reduce((sum, p) => sum + p.weeks, 0);
    expect(totalWeeks).toBe(52); // 12 months
  });

  it('whatsIncluded reflects sessionsPerWeek and contractMonths', () => {
    const plan = createDefaultPlan('Test', 'm1', 'c1');
    expect(plan.whatsIncluded[0]).toContain(String(plan.sessionsPerWeek));
    expect(plan.whatsIncluded[1]).toContain(String(plan.contractMonths));
  });
});

// Bug guard: pricing must honor an explicit 0-week phase, not silently reinflate
// to the 25/50/25 default split. JV's plan (P1=0, P2=0, P3=13) was billed $421/mo
// instead of ~$176 because `(phases[0]?.weeks) ?` treated 0 as falsy.
describe('calculatePricing — explicit-zero phase weeks (JV bug guard)', () => {
  const jvPhases = [
    { id: 1, name: 'Phase 1', weeks: 0, intensity: 'Fully Guided' as const, description: '' },
    { id: 2, name: 'Phase 2', weeks: 0, intensity: 'Shared Guidance' as const, description: '' },
    { id: 3, name: 'Phase 3', weeks: 13, intensity: 'Self-Reliant' as const, description: '' },
  ];
  const jvInputs = { hourlyRate: 100, sessionLengthMinutes: 30, checkInCallLengthMinutes: 15, programBuildTimeHours: 3 };

  it("JV's exact shape (phases [0,0,13]) prices at ~$176/mo, not $421", () => {
    const schedule = createDefaultSchedule(2); // Strength ×2/wk
    const result = calculatePricing(schedule, 2, 3, jvPhases, jvInputs, [], false);

    // totalCoachingHours: only P3 contributes → 2 sessions × 13 weeks × 3.5/60 = 1.5167
    // checkInHours: 3 mo × 15/60 = 0.75; buildHours: 3 → totalHours ≈ 5.27
    expect(result.totalCoachingHours).toBeCloseTo(1.5167, 2);
    expect(result.totalHours).toBeCloseTo(5.2667, 2);
    expect(Math.round(result.baseMonthlyPrice)).toBe(176);
    expect(Math.round(result.calculatedMonthlyPrice)).toBe(176);
  });

  it('phaseBreakdown line hours sum to totalCoachingHours (invariant)', () => {
    // Multi-type plan makes the invariant meaningful (>1 row in phaseBreakdown)
    const schedule = createDefaultSchedule(4); // Strength ×2, Cardio + Mobility ×2
    const phases = [
      { id: 1, name: 'P1', weeks: 3, intensity: 'Fully Guided' as const, description: '' },
      { id: 2, name: 'P2', weeks: 7, intensity: 'Shared Guidance' as const, description: '' },
      { id: 3, name: 'P3', weeks: 3, intensity: 'Self-Reliant' as const, description: '' },
    ];
    const result = calculatePricing(schedule, 4, 3, phases, jvInputs, [], false);

    expect(result.phaseBreakdown.length).toBeGreaterThan(1);
    const summedLineHours = result.phaseBreakdown.reduce((sum, row) => sum + row.totalHours, 0);
    expect(summedLineHours).toBeCloseTo(result.totalCoachingHours, 6);

    // Per-row invariant too: each row's totalHours === phase1+phase2+phase3
    for (const row of result.phaseBreakdown) {
      expect(row.totalHours).toBeCloseTo(row.phase1Hours + row.phase2Hours + row.phase3Hours, 6);
    }
  });

  it('legacy plan with no phases falls back to 25/50/25 (behavior unchanged)', () => {
    const schedule = createDefaultSchedule(2);
    const result = calculatePricing(schedule, 2, 3, [], jvInputs, [], false);

    // 13 weeks → 25/50/25 = 3/7/3 (JS Math.round(6.5)=7, then 13-3-7=3)
    // Strength ×2: P1=2×3×.5×1.0=3, P2=2×7×.5×.625=4.375, P3=2×3×3.5/60=0.35
    // totalCoachingHours = 7.725
    expect(result.totalCoachingHours).toBeCloseTo(7.725, 2);
    expect(result.phaseBreakdown[0].phase1Hours).toBeCloseTo(3, 4);
    expect(result.phaseBreakdown[0].phase2Hours).toBeCloseTo(4.375, 4);
    expect(result.phaseBreakdown[0].phase3Hours).toBeCloseTo(0.35, 4);
  });
});
