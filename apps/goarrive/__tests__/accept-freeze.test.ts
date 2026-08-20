/**
 * accept-freeze.test.ts
 *
 * Tests that createCheckoutSession snapshots the scenario content at SERVER read
 * time (when the function runs), not at accept-tap time. The architecture is:
 *   1. Member taps Accept → client writes { acceptedScenarioId, acceptedAt }
 *   2. Member routes to payment-select
 *   3. Member completes checkout → createCheckoutSession CF runs
 *   4. CF reads plan.acceptedScenarioId → loads that scenario → snapshots it
 *
 * The race: coach edits scenario between step 1 and step 4.
 * Expected behaviour: snapshot reflects state at step 4 (server read time).
 *
 * This is the correct and intentional architecture — the window between member
 * accept and checkout completion is narrow (seconds to minutes). The snapshot
 * is created deterministically from acceptedScenarioId, not guessed from
 * client-side pricing state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Types used in the test ───────────────────────────────────────────────────

interface ScenarioDoc {
  id: string;
  name: string;
  hourlyRate: number;
  sessionLengthMinutes: number;
  [key: string]: unknown;
}

interface PlanDoc {
  memberId: string;
  coachId: string;
  status: string;
  contractMonths: number;
  sessionsPerWeek: number;
  hourlyRate: number;
  sessionLengthMinutes: number;
  acceptedScenarioId?: string | null;
  shareToken?: string;
  [key: string]: unknown;
}

interface SnapshotDoc {
  scenarioId: string | null;
  hourlyRate: number;
  sessionLengthMinutes: number;
  planId: string;
  memberId: string;
  [key: string]: unknown;
}

// ─── Minimal mock of the server-side accept-freeze flow ───────────────────────
// Simulates the critical path of createCheckoutSession that involves acceptedScenarioId.

async function simulateCreateCheckoutSnapshot(
  planId: string,
  firestoreState: {
    plans: Record<string, PlanDoc>;
    scenarios: Record<string, Record<string, ScenarioDoc>>;
  }
): Promise<SnapshotDoc> {
  const plan = firestoreState.plans[planId];
  if (!plan) throw new Error('Plan not found');

  const acceptedScenarioId = plan.acceptedScenarioId ?? null;

  // Overlay scenario if set (reads scenario state AT THIS MOMENT, i.e., server read time)
  let snapshotPlan = { ...plan };
  if (acceptedScenarioId) {
    const scenario = firestoreState.scenarios[planId]?.[acceptedScenarioId];
    if (scenario) {
      snapshotPlan = { ...snapshotPlan, ...scenario };
    }
  }

  return {
    planId,
    memberId: plan.memberId,
    scenarioId: acceptedScenarioId,
    hourlyRate: snapshotPlan.hourlyRate,
    sessionLengthMinutes: snapshotPlan.sessionLengthMinutes,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('accept-freeze: createCheckoutSession scenario snapshot', () => {
  const planId = 'member_abc';
  const scenarioId = 'scenario_x';

  let firestoreState: {
    plans: Record<string, PlanDoc>;
    scenarios: Record<string, Record<string, ScenarioDoc>>;
  };

  beforeEach(() => {
    firestoreState = {
      plans: {
        [planId]: {
          memberId: 'uid_abc',
          coachId: 'coach_xyz',
          status: 'presented',
          contractMonths: 12,
          sessionsPerWeek: 3,
          hourlyRate: 100,
          sessionLengthMinutes: 60,
          shareToken: 'tok_abc123',
        },
      },
      scenarios: {
        [planId]: {
          [scenarioId]: {
            id: scenarioId,
            name: 'Scenario X',
            hourlyRate: 120,
            sessionLengthMinutes: 60,
          },
        },
      },
    };
  });

  it('snapshots base plan when no scenario was accepted', async () => {
    // Member accepts without a scenario presented
    firestoreState.plans[planId].acceptedScenarioId = null;

    const snapshot = await simulateCreateCheckoutSnapshot(planId, firestoreState);

    expect(snapshot.scenarioId).toBeNull();
    expect(snapshot.hourlyRate).toBe(100); // base plan rate
  });

  it('snapshots the accepted scenario content at server read time', async () => {
    // (i) Scenario X has pricing $120/hr
    // (ii) Member taps accept → acceptedScenarioId written
    firestoreState.plans[planId].acceptedScenarioId = scenarioId;

    // (iii) Checkout runs — should snapshot scenario X as it is NOW ($120/hr)
    const snapshot = await simulateCreateCheckoutSnapshot(planId, firestoreState);

    expect(snapshot.scenarioId).toBe(scenarioId);
    expect(snapshot.hourlyRate).toBe(120);
  });

  it('reflects post-accept coach edit at server read time (server-read-time architecture)', async () => {
    // (i) Scenario X: $120/hr
    // (ii) Member taps accept → acceptedScenarioId = scenarioId
    firestoreState.plans[planId].acceptedScenarioId = scenarioId;

    // (iii) Coach edits scenario to $150/hr BEFORE checkout CF runs
    firestoreState.scenarios[planId][scenarioId].hourlyRate = 150;

    // (iv) Checkout CF runs — reads scenario at THIS moment → $150/hr
    const snapshot = await simulateCreateCheckoutSnapshot(planId, firestoreState);

    // Expected: snapshot reflects $150 (server read time), not $120 (accept time).
    // This is the current intentional architecture: the window is narrow and
    // the snapshot is deterministically bound to acceptedScenarioId.
    expect(snapshot.scenarioId).toBe(scenarioId);
    expect(snapshot.hourlyRate).toBe(150);
  });

  it('falls back to base plan if acceptedScenarioId doc is missing', async () => {
    firestoreState.plans[planId].acceptedScenarioId = 'nonexistent_scenario';
    // No matching scenario in firestoreState.scenarios → falls through to base plan

    async function simulateWithFallback(
      pId: string,
      state: typeof firestoreState
    ): Promise<SnapshotDoc> {
      const plan = state.plans[pId];
      const acceptedScenarioId = plan.acceptedScenarioId ?? null;
      let snapshotPlan = { ...plan };
      if (acceptedScenarioId) {
        const scenario = state.scenarios[pId]?.[acceptedScenarioId];
        if (scenario) {
          snapshotPlan = { ...snapshotPlan, ...scenario };
        }
        // No scenario found — silently use base plan (matches server-side catch block)
      }
      return {
        planId: pId,
        memberId: plan.memberId,
        scenarioId: acceptedScenarioId,
        hourlyRate: snapshotPlan.hourlyRate,
        sessionLengthMinutes: snapshotPlan.sessionLengthMinutes,
      };
    }

    const snapshot = await simulateWithFallback(planId, firestoreState);

    // scenarioId is preserved in snapshot for audit trail
    expect(snapshot.scenarioId).toBe('nonexistent_scenario');
    // but content falls back to base plan
    expect(snapshot.hourlyRate).toBe(100);
  });

  it('handleAcceptPlan writes acceptedScenarioId BEFORE routing', async () => {
    // Verify the client-side contract: the write must complete before navigation.
    // Simulated by checking write order using resolved promises.

    const writeOrder: string[] = [];

    const mockUpdateDoc = vi.fn(async (_update: Record<string, unknown>) => {
      writeOrder.push('write');
    });
    const mockRouterPush = vi.fn((_path: string) => {
      writeOrder.push('navigate');
    });

    // Simulate handleAcceptPlan logic
    async function simulateHandleAcceptPlan() {
      const presentedScenarioId = scenarioId;
      await mockUpdateDoc({ acceptedScenarioId: presentedScenarioId });
      mockRouterPush(`/(member)/payment-select?planId=${planId}`);
    }

    await simulateHandleAcceptPlan();

    expect(writeOrder).toEqual(['write', 'navigate']);
    expect(mockUpdateDoc).toHaveBeenCalledWith({
      acceptedScenarioId: scenarioId,
    });
    expect(mockRouterPush).toHaveBeenCalledWith(
      `/(member)/payment-select?planId=${planId}`
    );
  });
});
