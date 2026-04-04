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
