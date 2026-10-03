// Synthetic, local-only demo model. Nothing here represents real people or activity.
/** Goal unit. Built-ins are "squats" | "reps" | "steps" | "laps"; a custom goal stores its exact trimmed custom unit. */
export type Unit = string;
export type MovementKey = "squats" | "pushUps" | "jumpingJacks" | "sitUps" | "steps" | "laps" | "custom";
/** Independent count types. Only "reps" movements may share one goal; nothing is converted between types. */
export type CountKind = "reps" | "steps" | "laps" | "custom";
export interface Guide { title: string; rules: readonly string[]; counts: string; doesNotCount: string }
export interface Movement { key: MovementKey; label: string; singular: string; countKind: CountKind; guide: Guide }
const REST = "Rest when you want to. The count picks up where you left it.";
export const MOVEMENTS: readonly Movement[] = [
  { key: "squats", label: "Squats", singular: "squat", countKind: "reps", guide: { title: "Counting squats", rules: ["Count one squat when you stand back up.", "Count only the squats you finished.", REST], counts: "A squat counts when you go down and stand back up.", doesNotCount: "A squat you stopped partway through does not count." } },
  { key: "pushUps", label: "Push-ups", singular: "push-up", countKind: "reps", guide: { title: "Counting push-ups", rules: ["Count one push-up when your arms are straight again.", "Count only the push-ups you finished.", REST], counts: "A push-up counts when you lower down and come all the way back up.", doesNotCount: "A push-up you stopped partway through does not count." } },
  { key: "jumpingJacks", label: "Jumping jacks", singular: "jumping jack", countKind: "reps", guide: { title: "Counting jumping jacks", rules: ["Count one jumping jack when your feet are back together.", "Count only the jumping jacks you finished.", REST], counts: "A jumping jack counts when you jump out and back in.", doesNotCount: "A jumping jack you stopped partway through does not count." } },
  { key: "sitUps", label: "Sit-ups", singular: "sit-up", countKind: "reps", guide: { title: "Counting sit-ups", rules: ["Count one sit-up when you are back down again.", "Count only the sit-ups you finished."], counts: "A sit-up counts when you come up and return to where you started.", doesNotCount: "A sit-up you stopped partway through does not count." } },
  { key: "steps", label: "Steps", singular: "step", countKind: "steps", guide: { title: "Counting steps", rules: ["Count each step you take.", "A step counter you already use is fine to read from.", "Enter the steps for this session, not your total for the day."], counts: "Steps you took yourself count.", doesNotCount: "Steps someone else took do not count." } },
  { key: "laps", label: "Laps", singular: "lap", countKind: "laps", guide: { title: "Counting laps", rules: ["Count one lap each time you finish the full distance.", "Count only the laps you finished."], counts: "A lap counts when you reach the end of the lap you set out to do.", doesNotCount: "A part lap does not count." } },
  { key: "custom", label: "Something else", singular: "one", countKind: "custom", guide: { title: "Counting", rules: ["Count each completed one once.", "Count only what you finished."], counts: "What you finished counts.", doesNotCount: "What you started and did not finish does not count." } },
];
const MOVEMENT_BY_KEY = Object.fromEntries(MOVEMENTS.map((m) => [m.key, m])) as Record<MovementKey, Movement>;
export const isMovementKey = (k: unknown): k is MovementKey => typeof k === "string" && k in MOVEMENT_BY_KEY;
export const movementOf = (key: MovementKey) => MOVEMENT_BY_KEY[key];
export const CUSTOM_UNIT_MAX = 40;
/** Trimmed, whitespace-collapsed custom unit; length counted in Unicode code points. Empty/overlong → null. */
export function cleanCustomUnit(raw: string): string | null {
  const v = raw.trim().replace(/\s+/g, " ");
  const n = [...v].length;
  return n >= 1 && n <= CUSTOM_UNIT_MAX ? v : null;
}
/** Display text for one movement identity. Custom text is the exact unit the Champion typed — never re-spelled or matched. */
export function movementText(key: MovementKey, customUnit?: string | null) {
  const m = movementOf(key);
  if (key === "custom") {
    const u = (customUnit ?? "").trim() || "units";
    return { label: u, lower: u, singular: u, countLabel: `${u} completed`, guide: { title: `Counting ${u}`, rules: [`Count each completed ${u} once.`, "Count only what you finished."], counts: m.guide.counts, doesNotCount: m.guide.doesNotCount } as Guide };
  }
  return { label: m.label, lower: m.label.toLowerCase(), singular: m.singular, countLabel: `${m.label} completed`, guide: m.guide };
}
/** Can `key` join `current` in one goal? Only rep movements combine; steps/laps/custom stand alone. */
export function movementsCompatible(current: readonly MovementKey[], key: MovementKey) {
  return current.every((k) => movementOf(k).countKind === "reps") && movementOf(key).countKind === "reps";
}
export function goalUnitFor(movements: readonly MovementKey[], customUnit?: string | null): Unit {
  const kind = movements[0] ? movementOf(movements[0]).countKind : "reps";
  if (kind === "custom") return customUnit ?? "units";
  if (kind === "steps" || kind === "laps") return kind;
  return movements.length === 1 && movements[0] === "squats" ? "squats" : "reps";
}
export const MAX_ENTRY = 100_000;
/** Whole number 1..100000 from raw text. No stripping: "1.5", "-3", "1e3" are rejected, never reinterpreted. */
export function parseCount(raw: string): { ok: true; n: number } | { ok: false; reason: "format" | "zero" | "over" } {
  const t = raw.trim();
  if (!/^\d+$/.test(t)) return { ok: false, reason: "format" };
  const n = Number(t);
  if (n < 1) return { ok: false, reason: "zero" };
  if (n > MAX_ENTRY) return { ok: false, reason: "over" };
  return { ok: true, n };
}
export type RepeatPolicy = "once" | "multiple";
/** Absent/null legacy policy = multiple; any unknown value fails closed to once. */
export const repeatPolicyOf = (g: Goal): RepeatPolicy => g.repeat == null ? "multiple" : g.repeat === "multiple" ? "multiple" : "once";
export const REPEAT_COPY: Record<RepeatPolicy, string> = { once: "One contribution per member", multiple: "Members can contribute again while open" };
/** Same calendar day next month; when that day doesn't exist (e.g. Jan 31) it clamps to the next month's last day at the same time. */
export function addCalendarMonth(ms: number): number {
  const d = new Date(ms);
  const day = d.getDate();
  const t = new Date(d); t.setDate(1); t.setMonth(t.getMonth() + 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(day, last));
  return t.getTime();
}
export type PeriodPreset = "7d" | "14d" | "1m";
export function presetWindow(preset: PeriodPreset, start: number) {
  const endsAt = preset === "7d" ? start + 7 * 86_400_000 : preset === "14d" ? start + 14 * 86_400_000 : addCalendarMonth(start);
  return { startsAt: start, endsAt };
}
export function windowState(g: Goal, now = Date.now()): "none" | "scheduled" | "open" | "ended" {
  if (g.startsAt == null || g.endsAt == null) return "none";
  if (now < g.startsAt) return "scheduled";
  if (now >= g.endsAt) return "ended";
  return "open";
}
export function formatWindow(startsAt: number, endsAt: number, timeZone?: string) {
  const sameYear = new Date(startsAt).getFullYear() === new Date(endsAt).getFullYear();
  const f = (ms: number) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" as const }), hour: "numeric", minute: "2-digit", timeZone });
  return `${f(startsAt)} – ${f(endsAt)}`;
}
export const deviceTimeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };
export type GoalStatus = "open" | "scheduled" | "paused" | "closed";
export type Scenario =
  | "inhabited" | "quiet" | "near" | "reachedOpen" | "closedReached" | "closedUnfinished"
  | "stale" | "unknown" | "noGoal" | "profileStale" | "profileUnknown" | "profileNoOwn" | "profileNoCommunity" | "profileNoEligible"
  | "progressNoOwnEligible" | "progressNoOwnNoEligible" | "progressPartial" | "progressFailure";
export type Role = "member" | "champion";

export interface Member { id: string; name: string; initials: string }
export interface Goal {
  id: string; communityId: string; title: string; unit: Unit; target: number | null; period: string; status: GoalStatus; movements?: MovementKey[];
  /** Exact custom counting unit when movements = ["custom"]. */
  customUnit?: string | undefined;
  /** Exact window (epoch ms) + IANA zone it was created in. Absent on legacy goals, which keep status-only semantics. */
  startsAt?: number; endsAt?: number; timeZone?: string;
  /** "once" | "multiple"; absent = multiple (legacy), unknown = once. */
  repeat?: string | null;
}
export interface Community {
  id: string; name: string; descriptor: string; place: string;
  memberIds: string[]; extraMembers: number; movedTodayOthers: number;
  /** Featured open goal shown on Home. Other open goals stay open in otherOpenGoalIds. */
  currentGoalId: string | null; otherOpenGoalIds: string[]; pastGoalIds: string[]; championIds: string[]; createdInDemo?: boolean;
}
export interface Contribution {
  id: string; attemptId: string; memberId: string; communityId: string; goalId: string;
  amount: number; at: number; source: "fixture" | "demo" | "aggregate"; movementKey?: MovementKey; customUnit?: string | undefined;
  /** Demo confirmation made while a reviewer sample state was loaded for this goal. */
  scenarioLoaded?: boolean;
  /** Migrated old demo credit whose confirmation outcome cannot be established from saved data. */
  legacyAmbiguous?: boolean;
}
export interface Privacy { name: boolean; activity: boolean }
/** One unresolved MOVE attempt, persisted so Close / reopen / reload resumes the SAME attempt. */
export interface PendingAttempt {
  id: string; communityId: string; goalId: string; movementKey?: MovementKey; customUnit?: string | undefined; amount: number;
  stage: "pending" | "unknown" | "notFound" | "legacyAmbiguous" | "confirmed" | "rejected";
  /** Demo failure mode chosen before Confirm: none, reply lost after the simulated server recorded, or request never recorded. */
  lost: boolean; neverRecorded?: boolean; submittedAt: number; ownBefore: number;
  /** Immutable shared receipt facts captured at the simulated confirmation boundary. Absent on legacy records. */
  receiptBefore?: number; receiptAfter?: number; receiptTarget?: number | null; receiptStatus?: "open" | "reachedOpen" | "closedReached" | "closedUnfinished"; crossedTarget?: boolean;
  checks?: number;
}
/** Simulated server outcome for an attempt. Separate from client-confirmed contributions; only a read of this record can confirm. */
export type RejectReason = "scheduled" | "ended" | "closed" | "once";
export interface ServerRecord { attemptId: string; communityId: string; goalId: string; movementKey?: MovementKey; customUnit?: string | undefined; amount: number; recordedAt: number; scenarioLoaded: boolean; memberId?: string; rejected?: RejectReason | undefined }
/** Reviewer-only sample state, scoped to one community + goal. Target never changes. */
export interface ScenarioState { kind: Scenario; communityId: string | null; goalId: string | null; sampleTotal: number | null }
export interface Kiosk { step: "welcome" | "count" | "done"; count: string; lastAdded: number; attemptId: string | null }
export interface DemoState {
  version: 4;
  selectedCommunityId: string;
  joined: string[];
  members: Record<string, Member>;
  communities: Record<string, Community>;
  goals: Record<string, Goal>;
  contributions: Contribution[];
  privacy: Record<string, Record<string, Privacy>>;
  scenario: ScenarioState;
  attempt: PendingAttempt | null;
  /** Simulated persisted server ledger (local only). Optional for older saved sessions. */
  serverLedger?: Record<string, ServerRecord>;
  role: Role;
  expoBase: number;
  expoKioskTotal: number;
  kioskAttempts: string[];
  kiosk: Kiosk;
}

export const ME = "alex";
const MIN = 60_000;
const DAY_MS = 24 * 60 * MIN;

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
/** Mid-month timestamp N months before now, with its month name — keeps history labels coherent with today. */
function monthsAgo(now: number, n: number) {
  const d = new Date(now); d.setDate(15); d.setHours(12, 0, 0, 0); d.setMonth(d.getMonth() - n);
  return { at: d.getTime(), name: MONTHS[d.getMonth()] ?? "Earlier" };
}
export const NO_SCENARIO: ScenarioState = { kind: "inhabited", communityId: null, goalId: null, sampleTotal: null };
export const goalMovements = (goal: Goal): MovementKey[] => goal.movements?.length ? goal.movements : ["squats"];
export const contributionMovement = (contribution: Contribution): MovementKey => contribution.movementKey ?? "squats";

export function createFixture(now = Date.now()): DemoState {
  const m1 = monthsAgo(now, 1), m2 = monthsAgo(now, 2);
  const c = (id: string, memberId: string, communityId: string, goalId: string, amount: number, minsAgo: number, source: Contribution["source"] = "fixture"): Contribution =>
    ({ id, attemptId: id, memberId, communityId, goalId, amount, at: now - minsAgo * MIN, source });
  const cAt = (id: string, memberId: string, goalId: string, amount: number, at: number, source: Contribution["source"] = "fixture"): Contribution =>
    ({ id, attemptId: id, memberId, communityId: "oak", goalId, amount, at, source });
  return {
    version: 4,
    selectedCommunityId: "oak",
    joined: ["oak", "harbor"],
    members: {
      alex: { id: "alex", name: "Alex M.", initials: "AM" },
      jordan: { id: "jordan", name: "Jordan P.", initials: "JP" },
      kira: { id: "kira", name: "Kira T.", initials: "KT" },
      sam: { id: "sam", name: "Sam R.", initials: "SR" },
      maya: { id: "maya", name: "Maya R.", initials: "MR" },
      dev: { id: "dev", name: "Dev O.", initials: "DO" },
      priya: { id: "priya", name: "Priya S.", initials: "PS" },
      leo: { id: "leo", name: "Leo B.", initials: "LB" },
    },
    communities: {
      oak: { id: "oak", name: "Oak Grove Together", descriptor: "Moving together this week", place: "Neighborhood community", memberIds: ["alex", "jordan", "kira", "sam"], extraMembers: 19, movedTodayOthers: 11, currentGoalId: "oak-500", otherOpenGoalIds: [], pastGoalIds: ["oak-apr", "oak-mar"], championIds: [] },
      harbor: { id: "harbor", name: "Harbor Lunch Crew", descriptor: "Midday movement, together", place: "Workplace community", memberIds: ["alex", "maya", "dev"], extraMembers: 6, movedTodayOthers: 4, currentGoalId: "harbor-150", otherOpenGoalIds: [], pastGoalIds: [], championIds: [] },
      river: { id: "river", name: "Riverside Walkers", descriptor: "Easy pace, every week", place: "Neighborhood community", memberIds: ["priya", "leo"], extraMembers: 12, movedTodayOthers: 5, currentGoalId: "river-400", otherOpenGoalIds: [], pastGoalIds: [], championIds: [] },
    },
    goals: {
      "oak-500": { id: "oak-500", communityId: "oak", title: "500 squats together", unit: "squats", target: 500, period: "This week", status: "open" },
      "oak-apr": { id: "oak-apr", communityId: "oak", title: `1,000 squats in ${m1.name}`, unit: "squats", target: 1000, period: m1.name, status: "closed" },
      "oak-mar": { id: "oak-mar", communityId: "oak", title: `800 squats in ${m2.name}`, unit: "squats", target: 800, period: m2.name, status: "closed" },
      "harbor-150": { id: "harbor-150", communityId: "harbor", title: "150 squats this week", unit: "squats", target: 150, period: "This week", status: "open" },
      "river-400": { id: "river-400", communityId: "river", title: "400 squats this month", unit: "squats", target: 400, period: "This month", status: "open" },
    },
    contributions: [
      c("f-oak-agg", "aggregate", "oak", "oak-500", 179, 60 * 30, "aggregate"),
      c("f-oak-a1", "alex", "oak", "oak-500", 5, 60 * 48),
      c("f-oak-k", "kira", "oak", "oak-500", 12, 180),
      c("f-oak-s", "sam", "oak", "oak-500", 10, 43),
      c("f-oak-j", "jordan", "oak", "oak-500", 15, 24),
      c("f-oak-a2", "alex", "oak", "oak-500", 20, 8),
      cAt("f-apr-agg", "aggregate", "oak-apr", 964, m1.at - 3 * DAY_MS, "aggregate"),
      cAt("f-apr-a", "alex", "oak-apr", 60, m1.at),
      cAt("f-mar-agg", "aggregate", "oak-mar", 572, m2.at - 3 * DAY_MS, "aggregate"),
      cAt("f-mar-a", "alex", "oak-mar", 40, m2.at),
      c("f-h-agg", "aggregate", "harbor", "harbor-150", 110, 60 * 40, "aggregate"),
      c("f-h-a", "alex", "harbor", "harbor-150", 20, 60 * 26),
      c("f-h-d", "dev", "harbor", "harbor-150", 15, 120),
      c("f-h-m", "maya", "harbor", "harbor-150", 18, 62),
      c("f-r-agg", "aggregate", "river", "river-400", 188, 60 * 50, "aggregate"),
      c("f-r-p", "priya", "river", "river-400", 14, 95),
      c("f-r-l", "leo", "river", "river-400", 22, 35),
    ],
    privacy: {
      oak: { alex: { name: true, activity: true }, jordan: { name: true, activity: true }, kira: { name: true, activity: false }, sam: { name: false, activity: true } },
      harbor: { alex: { name: true, activity: true }, maya: { name: true, activity: true }, dev: { name: true, activity: true } },
      river: { priya: { name: true, activity: true }, leo: { name: true, activity: true } },
    },
    scenario: NO_SCENARIO,
    attempt: null,
    serverLedger: {},
    role: "member",
    expoBase: 1318,
    expoKioskTotal: 0,
    kioskAttempts: [],
    kiosk: { step: "welcome", count: "", lastAdded: 0, attemptId: null },
  };
}

/** Confirmed records only (fixture, demo, aggregate). Reviewer scenarios never write records. */
export function recordTotal(s: DemoState, goalId: string) {
  return s.contributions.filter((c) => c.goalId === goalId && !c.legacyAmbiguous).reduce((sum, c) => sum + c.amount, 0);
}
/** Base sample total the reviewer scenario was loaded at (same fixed target). */
function scenarioFor(s: DemoState, goalId: string) {
  const sc = s.scenario;
  return sc.goalId === goalId && sc.communityId === s.selectedCommunityId ? sc : null;
}
/**
 * Displayed shared total. When a reviewer sample state is loaded for this goal, the displayed total is the
 * labeled sample total plus any demo confirmations made after loading it — never a changed target.
 */
export function goalTotal(s: DemoState, goalId: string) {
  const sc = scenarioFor(s, goalId);
  if (sc && sc.sampleTotal != null) {
    const afterLoad = s.contributions.filter((c) => c.goalId === goalId && c.source === "demo" && c.scenarioLoaded && !c.legacyAmbiguous).reduce((a, c) => a + c.amount, 0);
    return sc.sampleTotal + afterLoad;
  }
  return recordTotal(s, goalId);
}
export function ownTotal(s: DemoState, goalId: string, memberId = ME) {
  return s.contributions.filter((c) => c.goalId === goalId && c.memberId === memberId && !c.legacyAmbiguous).reduce((sum, c) => sum + c.amount, 0);
}
/** Goals with exact confirmed credit for one member; active goals first, then most recently touched. */
export function memberGoalRows(s: DemoState, memberId = ME) {
  const latest = new Map<string, number>();
  s.contributions.filter((c) => c.memberId === memberId && !c.legacyAmbiguous).forEach((c) => latest.set(c.goalId, Math.max(latest.get(c.goalId) ?? 0, c.at)));
  return [...latest.keys()].filter((id) => !!s.goals[id]).sort((a, b) => {
    const av = goalViewFor(s, a), bv = goalViewFor(s, b);
    const active = (kind: ViewKind) => kind === "open" || kind === "reachedOpen" ? 1 : 0;
    return active(bv.kind) - active(av.kind) || (latest.get(b) ?? 0) - (latest.get(a) ?? 0);
  });
}
export function ownMovementTotal(s: DemoState, goalId: string, movementKey: MovementKey, memberId = ME) {
  return s.contributions.filter((c) => c.goalId === goalId && c.memberId === memberId && contributionMovement(c) === movementKey && !c.legacyAmbiguous).reduce((sum, c) => sum + c.amount, 0);
}
/** Private per-movement totals. Custom units are keyed by their exact text, so different spellings never merge. */
export function ownMovementTotals(s: DemoState, memberId = ME) {
  const totals = new Map<string, { label: string; n: number }>();
  s.contributions.filter((c) => c.memberId === memberId && !c.legacyAmbiguous).forEach((c) => {
    const key = contributionMovement(c);
    const id = key === "custom" ? `custom:${c.customUnit ?? ""}` : key;
    const cur = totals.get(id);
    totals.set(id, { label: movementText(key, c.customUnit).lower, n: (cur?.n ?? 0) + c.amount });
  });
  return totals;
}
export const contributionText = (c: { movementKey?: MovementKey; customUnit?: string | undefined }) => movementText(c.movementKey ?? "squats", c.customUnit);
/** Member eligibility at `now` for a new contribution: status, exact window and once-per-member policy (confirmed or server-accepted). */
export function eligibility(s: DemoState, goalId: string, now = Date.now(), memberId = ME, exceptAttemptId?: string): { ok: true } | { ok: false; reason: RejectReason } {
  const g = s.goals[goalId];
  if (!g || g.status === "closed" || g.status === "paused") return { ok: false, reason: "closed" };
  if (g.status === "scheduled") return { ok: false, reason: "scheduled" };
  const w = windowState(g, now);
  if (w === "scheduled") return { ok: false, reason: "scheduled" };
  if (w === "ended") return { ok: false, reason: "ended" };
  if (repeatPolicyOf(g) === "once") {
    const confirmed = s.contributions.some((c) => c.goalId === goalId && c.memberId === memberId && !c.legacyAmbiguous && c.attemptId !== exceptAttemptId);
    const accepted = Object.values(s.serverLedger ?? {}).some((r) => r.goalId === goalId && (r.memberId ?? ME) === memberId && !r.rejected && r.attemptId !== exceptAttemptId);
    if (confirmed || accepted) return { ok: false, reason: "once" };
  }
  return { ok: true };
}
export const REJECT_COPY: Record<RejectReason, string> = {
  scheduled: "This goal hasn’t started yet.",
  ended: "This goal’s window has ended.",
  closed: "This goal is closed.",
  once: "This goal counts one contribution per member, and yours is already in.",
};

export function legacyAmbiguousFor(s: DemoState, goalId?: string) {
  return s.contributions.filter((c) => c.legacyAmbiguous && (!goalId || c.goalId === goalId));
}

/** Floor to one decimal below completion; tiny positive shows "<0.1%"; fill capped at 100. */
export function progress(total: number, target: number | null) {
  if (!target || target <= 0) return null;
  const reached = total >= target;
  const tenths = Math.floor((total * 1000) / target);
  const label = reached ? "100%" : total > 0 && tenths === 0 ? "<0.1%" : `${(tenths / 10).toFixed(1)}%`;
  const fill = Math.min(100, (total / target) * 100);
  return { reached, label, fill, remaining: Math.max(0, target - total), overshoot: Math.max(0, total - target) };
}

/** Sample totals for each reviewer state, derived from the goal's unchanged target (500 → 490 / 515 / 360). */
export function scenarioSampleTotal(kind: Scenario, target: number | null): number | null {
  if (!target) return null;
  if (kind === "near") return target - Math.max(1, Math.round(target * 0.02));
  if (kind === "reachedOpen" || kind === "closedReached") return target + Math.max(1, Math.round(target * 0.03));
  if (kind === "closedUnfinished") return Math.round(target * 0.72);
  return null;
}

export type ViewKind = "open" | "reachedOpen" | "closedReached" | "closedUnfinished" | "stale" | "unknown" | "none" | "scheduled" | "paused";
export interface GoalView {
  kind: ViewKind; goal: Goal | null; total: number | null; target: number | null;
  live: boolean; canContribute: boolean; statusLabel: string; sampleState: string | null;
}

export function baseView(goal: Goal, total: number, sampleState: string | null = null, now = Date.now()): GoalView {
  const w = goal.status === "open" ? windowState(goal, now) : "none";
  if (w === "scheduled") goal = { ...goal, status: "scheduled" };
  if (w === "ended") goal = { ...goal, status: "closed" };
  const target = goal.target;
  const p = progress(total, target);
  const v = { goal, total, target, live: true, sampleState };
  if (goal.status === "scheduled") return { ...v, kind: "scheduled", canContribute: false, statusLabel: "Scheduled" };
  if (goal.status === "paused") return { ...v, kind: "paused", canContribute: false, statusLabel: "Paused" };
  if (goal.status === "closed") return p?.reached
    ? { ...v, kind: "closedReached", canContribute: false, statusLabel: "Closed · reached" }
    : { ...v, kind: "closedUnfinished", canContribute: false, statusLabel: "Closed · unfinished" };
  if (p?.reached) return { ...v, kind: "reachedOpen", canContribute: true, statusLabel: "Reached · still open" };
  return { ...v, kind: "open", canContribute: true, statusLabel: "Open" };
}

const SAMPLE_LABEL: Partial<Record<Scenario, string>> = {
  near: "Reviewer sample state · Near goal", reachedOpen: "Reviewer sample state · Reached, still open",
  closedReached: "Reviewer sample state · Closed, reached", closedUnfinished: "Reviewer sample state · Closed, unfinished",
  stale: "Reviewer sample state · Stale", unknown: "Reviewer sample state · Unknown", quiet: "Reviewer sample state · Quiet today",
  noGoal: "Reviewer sample state · No active goal",
  profileStale: "Reviewer sample state · Profile stale", progressNoOwnEligible: "Reviewer sample state · Progress, no own part", progressNoOwnNoEligible: "Reviewer sample state · Progress, no own part and no open goal", progressPartial: "Reviewer sample state · Progress, partial read", progressFailure: "Reviewer sample state · Progress, read failed", profileNoEligible: "Reviewer sample state · You, no own part and no eligible goal", profileUnknown: "Reviewer sample state · Profile unknown",
};

/** THE view for any goal. Home, Community, Progress and the MOVE receipt all use this, so numbers agree. */
export function goalViewFor(s: DemoState, goalId: string): GoalView {
  const g = s.goals[goalId];
  if (!g) return { kind: "none", goal: null, total: null, target: null, live: true, canContribute: false, statusLabel: "No active goal", sampleState: null };
  const sc = scenarioFor(s, goalId);
  const label = sc ? SAMPLE_LABEL[sc.kind] ?? null : null;
  const total = goalTotal(s, goalId);
  if (sc?.kind === "stale") return { kind: "stale", goal: g, total: sc.sampleTotal ?? total, target: g.target, live: false, canContribute: false, statusLabel: "Last known · not live", sampleState: label };
  if (sc?.kind === "unknown") return { kind: "unknown", goal: g, total: null, target: g.target, live: false, canContribute: false, statusLabel: "Unknown", sampleState: label };
  const closedOverride = sc?.kind === "closedReached" || sc?.kind === "closedUnfinished";
  return baseView(closedOverride ? { ...g, status: "closed" } : g, total, label);
}

/** Featured-goal view for a community; reviewer scenario applies only to its own community + goal. */
export function currentView(s: DemoState, communityId: string): GoalView {
  const c = s.communities[communityId];
  const noGoal = (s.scenario.kind === "noGoal" || s.scenario.kind === "profileNoEligible" || s.scenario.kind === "progressNoOwnNoEligible") && s.scenario.communityId === communityId && communityId === s.selectedCommunityId;
  if (!c || !c.currentGoalId || noGoal) return { kind: "none", goal: null, total: null, target: null, live: true, canContribute: false, statusLabel: "No active goal", sampleState: noGoal ? SAMPLE_LABEL.noGoal ?? null : null };
  return goalViewFor(s, c.currentGoalId);
}

/** You "Start moving" is offered only for a live open/reached-open goal with a usable denominator. */
export function canInviteFirstContribution(view: GoalView): boolean {
  return (view.kind === "open" || view.kind === "reachedOpen") && view.live && view.canContribute
    && view.goal != null && view.target != null && view.target > 0;
}

export function scenarioActive(s: DemoState, communityId: string, kind: Scenario) {
  return s.scenario.kind === kind && s.scenario.communityId === communityId && communityId === s.selectedCommunityId;
}

export function privacyOf(s: DemoState, communityId: string, memberId: string): Privacy {
  return s.privacy[communityId]?.[memberId] ?? { name: true, activity: true };
}

export interface Identity { anonymous: boolean; label: string; initials: string | null }
export function identity(s: DemoState, communityId: string, memberId: string): Identity {
  const m = s.members[memberId];
  const p = privacyOf(s, communityId, memberId);
  return p.name && m ? { anonymous: false, label: m.name, initials: m.initials } : { anonymous: true, label: "Anonymous member", initials: null };
}

export function memberCount(s: DemoState, communityId: string) {
  const c = s.communities[communityId];
  return c ? c.memberIds.length + c.extraMembers : 0;
}

const DAY = 24 * 60 * MIN;
export function isToday(at: number, now = Date.now()) { return now - at < DAY && new Date(at).toDateString() === new Date(now).toDateString(); }

export function movedToday(s: DemoState, communityId: string) {
  const c = s.communities[communityId];
  if (!c) return 0;
  const quiet = scenarioActive(s, communityId, "quiet");
  const meToday = s.contributions.some((x) => x.communityId === communityId && x.memberId === ME && !x.legacyAmbiguous && isToday(x.at) && (!quiet || x.source === "demo"));
  return (quiet ? 0 : c.movedTodayOthers) + (meToday ? 1 : 0);
}

/** Visible, chronological rows for the community's current goal (privacy + scenario applied). */
export function recentRows(s: DemoState, communityId: string) {
  const c = s.communities[communityId];
  if (!c || !c.currentGoalId) return [];
  const quiet = scenarioActive(s, communityId, "quiet");
  return s.contributions
    .filter((x) => x.goalId === c.currentGoalId && x.source !== "aggregate" && !x.legacyAmbiguous && (!quiet || x.source === "demo"))
    .filter((x) => privacyOf(s, communityId, x.memberId).activity)
    .filter((x) => Date.now() - x.at < DAY)
    .sort((a, b) => b.at - a.at)
    .slice(0, 5)
    .map((x) => ({ ...x, who: identity(s, communityId, x.memberId) }));
}

export function relTime(at: number, now = Date.now()) {
  const m = Math.max(0, Math.round((now - at) / MIN));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function newId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

export const fmt = (n: number) => n.toLocaleString("en-US");

export const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;

/** Minimal integrity check for persisted demo state; failing it triggers an honest reset. */
export function isCoherent(s: DemoState): boolean {
  if (s.version !== 4 || !s.communities || !s.goals || !Array.isArray(s.contributions) || !s.members) return false;
  if (!s.communities[s.selectedCommunityId] || !s.members[ME]) return false;
  for (const id of s.joined) if (!s.communities[id]) return false;
  for (const c of Object.values(s.communities)) {
    for (const g of [c.currentGoalId, ...(c.otherOpenGoalIds ?? []), ...c.pastGoalIds]) if (g && !s.goals[g]) return false;
    if (!Array.isArray(c.otherOpenGoalIds)) return false;
  }
  for (const goal of Object.values(s.goals)) {
    if (goal.movements && (!goal.movements.length || goal.movements.some((key) => !isMovementKey(key)))) return false;
    if (goal.movements?.includes("custom") && !goal.customUnit) return false;
  }
  for (const x of s.contributions) {
    const goal = s.goals[x.goalId];
    if (!goal || !s.communities[x.communityId] || (x.movementKey && !goalMovements(goal).includes(x.movementKey))) return false;
  }
  if (s.attempt && (!s.goals[s.attempt.goalId] || !s.communities[s.attempt.communityId])) return false;
  return !!s.scenario && typeof s.scenario.kind === "string";
}

/** Guarded lookup after isCoherent(); a miss throws to the prototype's recovery view instead of rendering undefined. */
export function need<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null) throw new Error(`Missing sample ${what}`);
  return v;
}
export const communityOf = (s: DemoState, id: string) => need(s.communities[id], `community ${id}`);
export const goalOf = (s: DemoState, id: string) => need(s.goals[id], `goal ${id}`);

/** Aggregate status for the "You" screen and profile data. */
export function userProfileView(s: DemoState) {
  const sc = s.scenario;
  const isProfileScenario = sc.kind === "profileStale" || sc.kind === "profileUnknown";
  const live = !isProfileScenario;
  const kind = isProfileScenario ? (sc.kind === "profileStale" ? "stale" : "unknown") : "live";
  const label = isProfileScenario ? SAMPLE_LABEL[sc.kind] : null;
  
  const totalMoves = s.contributions.filter((c) => c.memberId === ME && !c.legacyAmbiguous).reduce((sum, c) => sum + c.amount, 0);
  const communityCount = s.joined.length;
  
  return { live, kind, label, totalMoves, communityCount, noOwn: sc.kind === "profileNoOwn" || sc.kind === "profileNoEligible", noCommunity: sc.kind === "profileNoCommunity" };
}

/** Private Progress view. Only goals with this member's confirmed credit appear; units are never summed. */
export function progressView(s: DemoState, memberId = ME) {
  const sc = s.scenario.kind;
  const label = SAMPLE_LABEL[sc] ?? null;
  if (sc === "progressFailure") return { status: "failure" as const, label, mine: [] as Contribution[], goalIds: [] as string[], totals: new Map<string, { label: string; n: number }>(), zeroOwn: false, canStart: false };
  const zero = sc === "progressNoOwnEligible" || sc === "progressNoOwnNoEligible";
  let goalIds = zero ? [] : memberGoalRows(s, memberId);
  const partial = sc === "progressPartial";
  if (partial) goalIds = goalIds.filter((id) => { const k = goalViewFor(s, id).kind; return k === "open" || k === "reachedOpen"; });
  const keep = new Set(goalIds);
  const mine = s.contributions.filter((c) => c.memberId === memberId && !c.legacyAmbiguous && keep.has(c.goalId)).sort((a, b) => b.at - a.at);
  const totals = ownMovementTotals({ ...s, contributions: mine }, memberId);
  const cid = s.joined.includes(s.selectedCommunityId) ? s.selectedCommunityId : s.joined[0];
  const canStart = cid ? canInviteFirstContribution(currentView(s, cid)) : false;
  return { status: partial ? "partial" as const : "ok" as const, label, mine, goalIds, totals, zeroOwn: goalIds.length === 0, canStart };
}
