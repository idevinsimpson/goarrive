import { createContext, useContext, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { cleanCustomUnit, createFixture, eligibility, goalMovements, goalTotal, goalUnitFor, isCoherent, isMovementKey, MAX_ENTRY, ME, movementsCompatible, NO_SCENARIO, ownTotal, scenarioSampleTotal, type RejectReason, type Community, type DemoState, type MovementKey, type Role, type Scenario } from "./model";

const KEY = "wsf-proto-state-v4";
export const PENDING_MS = 700;

export type Action =
  | { type: "hydrate"; state: DemoState }
  | { type: "reset" }
  | { type: "select"; communityId: string }
  | { type: "privacy"; communityId: string; key: "name" | "activity"; value: boolean }
  | { type: "submit"; attemptId: string; communityId: string; goalId: string; movementKey?: MovementKey; amount: number; lost: boolean; neverRecorded?: boolean }
  | { type: "discardAttempt"; attemptId: string }
  | { type: "removeLegacyAttempt"; attemptId: string }
  | { type: "resolve"; attemptId: string }
  | { type: "reconcile"; attemptId: string }
  | { type: "clearAttempt"; attemptId: string }
  | { type: "join"; communityId: string }
  | { type: "createCommunity"; id: string; name: string }
  | { type: "createGoal"; id: string; communityId: string; title: string; movementKeys: MovementKey[]; target: number; period: string; feature: boolean; customUnit?: string | undefined; startsAt?: number; endsAt?: number; timeZone?: string; repeat?: "once" | "multiple" }
  | { type: "feature"; communityId: string; goalId: string }
  | { type: "scenario"; scenario: Scenario }
  | { type: "role"; role: Role }
  | { type: "kioskStep"; step: DemoState["kiosk"]["step"]; count?: string; attemptId?: string | null }
  | { type: "kioskConfirm"; attemptId: string; amount: number }
  | { type: "kioskFinish" };

function withCommunity(s: DemoState, c: Community): DemoState {
  return { ...s, communities: { ...s.communities, [c.id]: c } };
}

/** Simulated server write: records the attempt's outcome in the local ledger only. Idempotent. */
function recordOnServer(s: DemoState, attemptId: string): DemoState {
  const a = s.attempt;
  if (!a || a.id !== attemptId) return s;
  const ledger = s.serverLedger ?? {};
  if (ledger[attemptId]) return s;
  const scenarioLoaded = s.scenario.goalId === a.goalId && s.scenario.sampleTotal != null;
  // Commit boundary: the window is judged at the moment the request was sent; once-policy against every other accepted record.
  const e = eligibility(s, a.goalId, a.submittedAt, ME, attemptId);
  const rejected: RejectReason | undefined = e.ok ? undefined : e.reason;
  return { ...s, serverLedger: { ...ledger, [attemptId]: { attemptId, communityId: a.communityId, goalId: a.goalId, movementKey: a.movementKey ?? "squats", customUnit: a.customUnit, amount: a.amount, recordedAt: Date.now(), scenarioLoaded, memberId: ME, rejected } } };
}

/** Client-confirmed presentation: applies a confirmed ledger record exactly once. Never manufactures a record. */
function applyConfirmed(s: DemoState, attemptId: string): DemoState {
  const r = s.serverLedger?.[attemptId];
  if (!r || r.rejected) return s;
  if (s.contributions.some((c) => c.attemptId === attemptId)) return s;
  return { ...s, contributions: [...s.contributions, { id: attemptId, attemptId, memberId: ME, communityId: r.communityId, goalId: r.goalId, movementKey: r.movementKey ?? "squats", customUnit: r.customUnit, amount: r.amount, at: r.recordedAt, source: "demo", scenarioLoaded: r.scenarioLoaded }] };
}

/**
 * Migrates only the contradictory legacy-v4 case: an unresolved attempt whose
 * contribution was already added by the old lost-reply path, but which has no
 * saved ledger outcome. The local credit is preserved and visibly quarantined;
 * no server outcome is invented. Safe to run repeatedly.
 */
export function hydrateDemoState(s: DemoState): DemoState {
  const a = s.attempt;
  // Presentation eligibility is never persisted. Older drafts may contain this obsolete field.
  if (a && "confirmedFresh" in a) {
    const { confirmedFresh: _ignored, sharedBefore: _oldSubmitSnapshot, ...safeAttempt } = a as typeof a & { confirmedFresh?: boolean; sharedBefore?: number };
    return hydrateDemoState({ ...s, attempt: safeAttempt });
  }
  if (!a || (a.stage !== "unknown" && a.stage !== "notFound" && a.stage !== "legacyAmbiguous") || s.serverLedger?.[a.id]) return s;
  const matching = s.contributions.some((c) => c.attemptId === a.id);
  if (!matching) return s;
  const contributions = s.contributions.map((c) => c.attemptId === a.id && !c.legacyAmbiguous ? { ...c, legacyAmbiguous: true } : c);
  const unchanged = a.stage === "legacyAmbiguous" && contributions.every((c, i) => c === s.contributions[i]);
  return unchanged ? s : { ...s, contributions, attempt: { ...a, stage: "legacyAmbiguous" } };
}

export function reducer(s: DemoState, a: Action): DemoState {
  switch (a.type) {
    case "hydrate": return a.state;
    case "reset": return createFixture();
    case "select": {
      if (!s.communities[a.communityId]) return s;
      // Reviewer scenario is scoped to its community; switching clears it so it cannot leak.
      return { ...s, selectedCommunityId: a.communityId, scenario: a.communityId === s.selectedCommunityId ? s.scenario : NO_SCENARIO };
    }
    case "privacy": {
      const cur = s.privacy[a.communityId]?.[ME] ?? { name: true, activity: true };
      return { ...s, privacy: { ...s.privacy, [a.communityId]: { ...s.privacy[a.communityId], [ME]: { ...cur, [a.key]: a.value } } } };
    }
    case "submit": {
      if (s.attempt && s.attempt.stage !== "confirmed") return s; // one unresolved attempt at a time
      if (s.contributions.some((c) => c.attemptId === a.attemptId) || s.serverLedger?.[a.attemptId]) return s;
      const goal = s.goals[a.goalId];
      const movementKey = a.movementKey ?? "squats";
      if (!Number.isInteger(a.amount) || a.amount <= 0 || a.amount > MAX_ENTRY || !goal || !s.communities[a.communityId] || !goalMovements(goal).includes(movementKey)) return s;
      if (!eligibility(s, a.goalId).ok) return s; // review→submit boundary
      return { ...s, attempt: { id: a.attemptId, communityId: a.communityId, goalId: a.goalId, movementKey, customUnit: movementKey === "custom" ? goal.customUnit : undefined, amount: a.amount, stage: "pending", lost: a.lost || !!a.neverRecorded, neverRecorded: !!a.neverRecorded, submittedAt: Date.now(), ownBefore: ownTotal(s, a.goalId) } };
    }
    case "resolve": {
      // Simulated server step. It writes ONLY the server ledger (unless the request "never reached" it).
      // The user's credit/history is applied only when the client actually reads a confirmation.
      if (!s.attempt || s.attempt.id !== a.attemptId || s.attempt.stage !== "pending") return s;
      const boundaryBefore = goalTotal(s, s.attempt.goalId);
      const target = s.goals[s.attempt.goalId]?.target ?? null;
      const boundaryAfter = boundaryBefore + s.attempt.amount;
      const crossedTarget = target != null && target > 0 && boundaryBefore < target && boundaryAfter >= target;
      const receiptStatus = target != null && target > 0 && boundaryAfter >= target ? "reachedOpen" as const : "open" as const;
      const receipt = { receiptBefore: boundaryBefore, receiptAfter: boundaryAfter, receiptTarget: target, receiptStatus, crossedTarget };
      const recorded = s.attempt.neverRecorded ? s : recordOnServer(s, a.attemptId);
      if (s.attempt.lost) return { ...recorded, attempt: { ...s.attempt, ...receipt, stage: "unknown" } };
      if (recorded.serverLedger?.[a.attemptId]?.rejected) return { ...recorded, attempt: { ...s.attempt, stage: "rejected" } };
      return { ...applyConfirmed(recorded, a.attemptId), attempt: { ...s.attempt, ...receipt, stage: "confirmed" } };
    }
    case "reconcile": {
      // Check status = read the SAME attempt's existing ledger outcome. Missing -> notFound, nothing created.
      if (!s.attempt || s.attempt.id !== a.attemptId || (s.attempt.stage !== "unknown" && s.attempt.stage !== "notFound")) return s;
      const checks = (s.attempt.checks ?? 0) + 1;
      if (!s.serverLedger?.[a.attemptId]) return { ...s, attempt: { ...s.attempt, stage: "notFound", checks } };
      if (s.serverLedger[a.attemptId]?.rejected) return { ...s, attempt: { ...s.attempt, stage: "rejected", checks } };
      return { ...applyConfirmed(s, a.attemptId), attempt: { ...s.attempt, stage: "confirmed", checks } };
    }
    case "discardAttempt":
      // Only an attempt the ledger has no record of may be discarded; nothing is counted.
      return s.attempt?.id === a.attemptId && s.attempt.stage === "notFound" && !s.serverLedger?.[a.attemptId] ? { ...s, attempt: null } : s;
    case "removeLegacyAttempt":
      // Explicitly remove only the quarantined attempt and its matching local credit.
      if (s.attempt?.id !== a.attemptId || s.attempt.stage !== "legacyAmbiguous" || s.serverLedger?.[a.attemptId]) return s;
      return { ...s, contributions: s.contributions.filter((c) => c.attemptId !== a.attemptId), attempt: null };
    case "clearAttempt":
      return s.attempt?.id === a.attemptId && (s.attempt.stage === "confirmed" || s.attempt.stage === "rejected") ? { ...s, attempt: null } : s;
    case "join": {
      const c = s.communities[a.communityId];
      if (!c) return s;
      if (s.joined.includes(a.communityId)) return { ...s, selectedCommunityId: a.communityId, scenario: NO_SCENARIO };
      return {
        ...withCommunity(s, { ...c, memberIds: [...c.memberIds, ME] }),
        joined: [...s.joined, a.communityId], selectedCommunityId: a.communityId, scenario: NO_SCENARIO,
        privacy: { ...s.privacy, [a.communityId]: { ...s.privacy[a.communityId], [ME]: { name: true, activity: true } } },
      };
    }
    case "createCommunity": {
      if (s.communities[a.id]) return s; // same flow token → no duplicate
      return {
        ...withCommunity(s, { id: a.id, name: a.name, descriptor: "A new sample community", place: "Started in this demo", memberIds: [ME], extraMembers: 0, movedTodayOthers: 0, currentGoalId: null, otherOpenGoalIds: [], pastGoalIds: [], championIds: [ME], createdInDemo: true }),
        joined: [...s.joined, a.id], selectedCommunityId: a.id, scenario: NO_SCENARIO,
        privacy: { ...s.privacy, [a.id]: { [ME]: { name: true, activity: true } } },
      };
    }
    case "createGoal": {
      // Never closes or replaces an existing goal. Existing open goals stay open; the Champion picks the featured one.
      if (s.goals[a.id]) return s;
      const c = s.communities[a.communityId];
      if (!c || !Number.isInteger(a.target) || a.target < 1 || a.target > MAX_ENTRY || !a.title.trim() || !a.period || !a.movementKeys.length || a.movementKeys.some((key) => !isMovementKey(key))) return s;
      const movements = [...new Set(a.movementKeys)];
      // Only rep movements combine; steps / laps / a custom unit each stand alone.
      if (movements.some((key, i) => i > 0 && !movementsCompatible(movements.slice(0, i), key))) return s;
      const customUnit = movements[0] === "custom" ? cleanCustomUnit(a.customUnit ?? "") : null;
      if (movements[0] === "custom" && !customUnit) return s;
      const hasWindow = a.startsAt != null || a.endsAt != null;
      if (hasWindow && !(Number.isFinite(a.startsAt) && Number.isFinite(a.endsAt) && (a.endsAt as number) > (a.startsAt as number))) return s;
      const goals = { ...s.goals, [a.id]: { id: a.id, communityId: c.id, title: a.title.trim(), unit: goalUnitFor(movements, customUnit), movements, ...(customUnit ? { customUnit } : {}), target: a.target, period: a.period, status: "open" as const, ...(hasWindow ? { startsAt: a.startsAt, endsAt: a.endsAt, timeZone: a.timeZone } : {}), repeat: a.repeat ?? "once" } };
      const prev = c.currentGoalId;
      const feature = a.feature || !prev;
      const next: Community = feature
        ? { ...c, currentGoalId: a.id, otherOpenGoalIds: prev ? [prev, ...c.otherOpenGoalIds] : c.otherOpenGoalIds }
        : { ...c, otherOpenGoalIds: [...c.otherOpenGoalIds, a.id] };
      return { ...withCommunity(s, next), goals, scenario: NO_SCENARIO };
    }
    case "feature": {
      const c = s.communities[a.communityId];
      if (!c || c.currentGoalId === a.goalId || !c.otherOpenGoalIds.includes(a.goalId)) return s;
      const others = c.otherOpenGoalIds.filter((g) => g !== a.goalId);
      return { ...withCommunity(s, { ...c, currentGoalId: a.goalId, otherOpenGoalIds: c.currentGoalId ? [c.currentGoalId, ...others] : others }), scenario: NO_SCENARIO };
    }
    case "scenario": {
      const cid = s.selectedCommunityId;
      const c = s.communities[cid];
      if (!c || a.scenario === "inhabited") return { ...s, scenario: NO_SCENARIO };
      const g = c.currentGoalId ? s.goals[c.currentGoalId] : undefined;
      if (a.scenario !== "noGoal" && a.scenario !== "quiet" && a.scenario !== "profileStale" && a.scenario !== "profileUnknown" && a.scenario !== "profileNoOwn" && a.scenario !== "profileNoCommunity" && a.scenario !== "profileNoEligible" && !a.scenario.startsWith("progress") && !g) return s;
      const sampleTotal = a.scenario === "stale" && g ? goalTotal({ ...s, scenario: NO_SCENARIO }, g.id) : scenarioSampleTotal(a.scenario, g?.target ?? null);
      return { ...s, scenario: { kind: a.scenario, communityId: cid, goalId: g?.id ?? null, sampleTotal } };
    }
    case "role": return { ...s, role: a.role };
    case "kioskStep": return { ...s, kiosk: { ...s.kiosk, step: a.step, count: a.count ?? s.kiosk.count, attemptId: a.attemptId === undefined ? s.kiosk.attemptId : a.attemptId } };
    case "kioskConfirm": {
      if (s.kioskAttempts.includes(a.attemptId)) return s;
      return { ...s, expoKioskTotal: s.expoKioskTotal + a.amount, kioskAttempts: [...s.kioskAttempts, a.attemptId], kiosk: { ...s.kiosk, step: "done", lastAdded: a.amount } };
    }
    case "kioskFinish": return { ...s, kiosk: { step: "welcome", count: "", lastAdded: 0, attemptId: null } };
  }
}

interface Ctx { state: DemoState; dispatch: (a: Action) => void; recovered: boolean }
const DemoCtx = createContext<Ctx | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => createFixture());
  const [recovered, setRecovered] = useState(false);
  const hydrated = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && isCoherent(parsed as DemoState)) dispatch({ type: "hydrate", state: hydrateDemoState(parsed as DemoState) });
        else setRecovered(true); // unreadable/older sample state → honest fresh sample session
      }
    } catch { setRecovered(true); }
    hydrated.current = true;
  }, []);
  useEffect(() => { if (hydrated.current) localStorage.setItem(KEY, JSON.stringify(state)); }, [state]);

  // The simulated "server" lives here, not in the MOVE sheet, so closing or reloading never loses a pending attempt.
  const pendingId = state.attempt?.stage === "pending" ? state.attempt.id : null;
  const submittedAt = state.attempt?.submittedAt ?? 0;
  useEffect(() => {
    if (!pendingId) return;
    const wait = Math.max(0, PENDING_MS - (Date.now() - submittedAt));
    const t = window.setTimeout(() => dispatch({ type: "resolve", attemptId: pendingId }), wait);
    return () => window.clearTimeout(t);
  }, [pendingId, submittedAt]);

  return <DemoCtx.Provider value={{ state, dispatch, recovered }}>{children}</DemoCtx.Provider>;
}

export function useDemo() {
  const v = useContext(DemoCtx);
  if (!v) throw new Error("useDemo outside DemoProvider");
  return v;
}

export function isChampion(s: DemoState, communityId: string) {
  return !!s.communities[communityId]?.championIds.includes(ME) || s.role === "champion";
}

/** Manage is a focused Community-tab action: offered only while Community is active and the selected community grants Champion. */
export function manageActionFor(s: DemoState, tab: string): string | null {
  const cid = s.selectedCommunityId;
  return tab === "community" && s.joined.includes(cid) && isChampion(s, cid) ? cid : null;
}

/** Fail-closed Manage guard: identity/selection is checked before any dereference, then role separately. */
export function manageGuard(s: DemoState, communityId: string | undefined): "ok" | "changed" | "role" {
  if (!communityId || !s.communities[communityId] || !s.joined.includes(communityId) || communityId !== s.selectedCommunityId) return "changed";
  return isChampion(s, communityId) ? "ok" : "role";
}
