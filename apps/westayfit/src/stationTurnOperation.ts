/**
 * THE STATION'S TURN COMMANDS, each bound to the TURN it was pressed for.
 *
 * KIOSK-EXPECTED-TURN-NATIVE-CALLER-RECOVERY-1 (Director #365 6059919550, the
 * scope of 6044059165). The server (#587, docs/westayfit/qa/kiosk-expected-
 * turn-1.md) now requires every Start, "Let them go" and Record to name the
 * turn it is for, as `expectedTurn` — the station-only `assigned.turnRef` it
 * minted when that person was called. This module is the client half of that
 * contract, and the reason it exists is ONE hazard:
 *
 *   A Record for visitor A whose answer was lost, retried after the screen has
 *   moved on to visitor B, must still be A's Record. A client that retried
 *   with "the newest ref" would send B's binding with A's count — the server
 *   cannot tell whose count it is, records it TO B, and the goal counts it
 *   twice.
 *
 * So:
 *  - An OPERATION is captured, immutably, at the moment it is pressed: which
 *    command, which turn (`expectedTurn`), and for Record the reviewed count.
 *    A retry resends exactly that, whatever the screen shows by then.
 *  - The VISIBLE turn (what polls and answers say the hall is) and the PENDING
 *    operation are separate. The hall may move to B while A's Record is still
 *    unanswered, and A's answer, when it comes, is read from A's own receipt —
 *    never painted onto B, never clearing B's count.
 *  - ONE command is in flight at a time, guarded here rather than in React
 *    state, so a double tap cannot send twice before a re-render.
 *  - Every answer is bound to the session (credential + goal + station) and to
 *    its own sequence: an answer from before a revocation, an unpairing or a
 *    goal switch is dropped whole, and an older hall can never repaint a newer
 *    one, whichever of a poll and a command answers first.
 *  - A server that does not hand out the binding is an OLD server: these three
 *    commands are unavailable against it and are never sent without one.
 *
 * It holds no React state, renders nothing and reaches the network only
 * through the `send` it is given, so all of it is tested on its own.
 */
import {
  isStationTurnRef,
  turnCountValue,
  TURN_NEEDS_UPDATE_MESSAGE,
  TURN_NOT_RUNNING_MESSAGE,
  TURN_STALE_MESSAGE,
  type HallAssignment,
  type HallResult,
  type TurnStatus,
} from './turnContract';

/** The three commands that act on ONE turn, and so must name it. */
export type StationTurnCommand = 'wsfStartTurn' | 'wsfCompleteTurn' | 'wsfCancelTurn';
/** Every callable the station sends with its credential. */
export type StationCallable = StationTurnCommand | 'wsfCallNext' | 'wsfTurnState';

/** The hall as a station sees it: the shared shape plus its own binding. */
export type StationHall = {
  stationId: string;
  stationLabel: string;
  assigned: (HallAssignment & { turnRef: string | null }) | null;
  result: HallResult | null;
  waitingCount: number;
};

/** A Record's own receipt — the whitelist the server sends (#587), nothing more. */
export type StationReceipt = {
  entryId: string;
  goalId: string;
  addedCount: number;
  unit: string;
  alreadyRecorded: boolean;
  sharedTotal: number | null;
  target: number | null;
  status: string | null;
  crossedTarget: boolean | null;
};

/** Who this screen is, for as long as it is that: one credential on one goal. */
export type StationSessionInput = { goalId: string; stationId: string; secret: string };
type StationSession = Readonly<StationSessionInput & { generation: number }>;

/** One pressed command, frozen at the press. Never edited; resent as is. */
export type PendingOperation = Readonly<{
  id: number;
  command: StationTurnCommand;
  expectedTurn: string;
  /** The reviewed count, for Record only. */
  count: number | null;
  /** The turn's short public code, for the screen's own words. Never a name. */
  code: string;
  /** The session it was pressed in. */
  generation: number;
}>;

/** Why a definite failure ended an operation, or that its answer was lost. */
export type FailureKind = 'stale' | 'notRunning' | 'needsUpdate' | 'revoked' | 'lost' | 'refused';

const ASSIGNED_STATES = new Set<TurnStatus>(['assigned', 'ready', 'active']);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/**
 * A station answer's hall, or null when it is not one. Strict on purpose: a
 * malformed answer is ignored (the screen keeps what it last confirmed) rather
 * than half-painted. `turnRef` is kept only when it is a well-formed binding.
 */
export function parseStationHall(data: unknown): StationHall | null {
  if (!isObject(data)) return null;
  const { stationId, stationLabel, assigned, result, waitingCount } = data;
  if (typeof stationId !== 'string' || typeof stationLabel !== 'string' || !isCount(waitingCount)) return null;
  let a: StationHall['assigned'] = null;
  if (assigned !== null && assigned !== undefined) {
    if (!isObject(assigned)) return null;
    const { code, calledName, state, readySecondsLeft, activityUnit, activityTitle, turnRef } = assigned;
    if (typeof code !== 'string' || typeof calledName !== 'string' || !ASSIGNED_STATES.has(state as TurnStatus)) return null;
    if (readySecondsLeft !== null && readySecondsLeft !== undefined && !isFiniteNumber(readySecondsLeft)) return null;
    a = {
      code,
      calledName,
      state: state as 'assigned' | 'ready' | 'active',
      readySecondsLeft: isFiniteNumber(readySecondsLeft) ? readySecondsLeft : null,
      activityUnit: typeof activityUnit === 'string' ? activityUnit : '',
      activityTitle: typeof activityTitle === 'string' ? activityTitle : '',
      turnRef: isStationTurnRef(turnRef) ? turnRef : null,
    };
  }
  let r: HallResult | null = null;
  if (result !== null && result !== undefined) {
    if (!isObject(result)) return null;
    if (typeof result.code !== 'string' || !isFiniteNumber(result.amount) || typeof result.unit !== 'string' || !isFiniteNumber(result.secondsLeft)) return null;
    r = { code: result.code, amount: result.amount, unit: result.unit, secondsLeft: result.secondsLeft };
  }
  return { stationId, stationLabel, assigned: a, result: r, waitingCount };
}

/**
 * A Record answer's OWN receipt, or null. The receipt must name an entry, the
 * same one the answer names, and carry a whole positive amount and a unit; the
 * shared fields are numbers or null, never invented. Anything else is not a
 * receipt — and a Record without one is NOT treated as success with the count
 * the screen sent (there is no submitted-count fallback): it stays unanswered,
 * and the retry asks again.
 */
export function parseStationReceipt(data: unknown): { entryId: string; receipt: StationReceipt } | null {
  if (!isObject(data) || !isObject(data.receipt)) return null;
  const entryId = data.entryId;
  const r = data.receipt;
  if (typeof entryId !== 'string' || entryId === '' || r.entryId !== entryId) return null;
  if (typeof r.goalId !== 'string' || r.goalId === '' || typeof r.unit !== 'string') return null;
  if (!Number.isInteger(r.addedCount) || (r.addedCount as number) < 1 || typeof r.alreadyRecorded !== 'boolean') return null;
  const numOrNull = (v: unknown) => (v === null ? null : isFiniteNumber(v) ? v : undefined);
  const sharedTotal = numOrNull(r.sharedTotal);
  const target = numOrNull(r.target);
  if (sharedTotal === undefined || target === undefined) return null;
  if (r.status !== null && typeof r.status !== 'string') return null;
  if (r.crossedTarget !== null && typeof r.crossedTarget !== 'boolean') return null;
  return {
    entryId,
    receipt: {
      entryId,
      goalId: r.goalId,
      addedCount: r.addedCount as number,
      unit: r.unit,
      alreadyRecorded: r.alreadyRecorded,
      sharedTotal,
      target,
      status: r.status as string | null,
      crossedTarget: r.crossedTarget as boolean | null,
    },
  };
}

/** The exact request an operation sends: the credential, the binding it was pressed with, and for Record its count. */
export function commandPayload(op: PendingOperation, session: StationSessionInput): Record<string, unknown> {
  const base = { stationId: session.stationId, secret: session.secret };
  return op.command === 'wsfCompleteTurn'
    ? { ...base, count: op.count, expectedTurn: op.expectedTurn }
    : { ...base, expectedTurn: op.expectedTurn };
}

const LOST_CODES = new Set(['internal', 'unavailable', 'deadline-exceeded', 'unknown', 'cancelled', 'resource-exhausted', 'aborted']);

/**
 * What a command's failure means. A DEFINITE refusal ends the operation (its
 * answer is known: nothing was, or it was already, done); a LOST answer does
 * not, and the operation stays to be resent exactly. The binding refusals are
 * matched on the server's own sentences (copied in turnContract).
 */
export function classifyCommandFailure(e: unknown): { kind: FailureKind; message: string | null } {
  const raw = isObject(e) && typeof e.code === 'string' ? e.code : '';
  const code = raw.startsWith('functions/') ? raw.slice('functions/'.length) : raw;
  const message = isObject(e) && typeof e.message === 'string' ? e.message : '';
  if (!code || LOST_CODES.has(code)) return { kind: 'lost', message: null };
  if (code === 'permission-denied') return { kind: 'revoked', message: null };
  if (code === 'failed-precondition' && message === TURN_STALE_MESSAGE) return { kind: 'stale', message };
  if (code === 'failed-precondition' && message === TURN_NOT_RUNNING_MESSAGE) return { kind: 'notRunning', message };
  if (code === 'invalid-argument' && message === TURN_NEEDS_UPDATE_MESSAGE) return { kind: 'needsUpdate', message };
  return { kind: 'refused', message: message || null };
}

/** What happened to a press, a retry or a Call next. */
export type CommandResult =
  | { kind: 'busy' }
  | { kind: 'noSession' }
  | { kind: 'noTurn' }
  | { kind: 'unavailable' }
  | { kind: 'badCount' }
  | { kind: 'otherPending'; pending: PendingOperation }
  | { kind: 'dropped' }
  | { kind: 'done'; op: PendingOperation; hall: StationHall | null }
  | { kind: 'recorded'; op: PendingOperation; entryId: string; receipt: StationReceipt; hall: StationHall | null }
  | { kind: 'lost'; op: PendingOperation; hall: StationHall | null }
  | { kind: 'failed'; op: PendingOperation | null; failure: FailureKind; message: string | null; error: unknown }
  | { kind: 'called'; hall: StationHall | null; blockedMessage: string | null };

/** The command a press means for a turn in a given state, or null if it means none. */
const COMMAND_STATE: Record<StationTurnCommand, ReadonlySet<string>> = {
  wsfStartTurn: new Set(['ready']),
  wsfCompleteTurn: new Set(['active']),
  wsfCancelTurn: new Set(['assigned', 'ready', 'active']),
};

export type HallTicket = Readonly<{ seq: number; generation: number }>;

/**
 * The station's command controller. One per screen; `setSession` whenever the
 * credential or goal changes (including to none).
 */
export function createStationTurnController(deps: { send: (name: StationCallable, payload: Record<string, unknown>) => Promise<unknown> }) {
  let generation = 0;
  let session: StationSession | null = null;
  let inFlight = false;
  let pending: PendingOperation | null = null;
  let opIds = 0;
  let issued = 0;
  let applied = 0;

  const live = (g: number) => session !== null && session.generation === g;

  /**
   * A new session (or none) drops everything bound to the old one: no adoption
   * across a revocation, unpairing or goal switch. Returns whether it changed.
   */
  function setSession(next: StationSessionInput | null): boolean {
    const same = session !== null && next !== null && session.goalId === next.goalId && session.stationId === next.stationId && session.secret === next.secret;
    if (same || (session === null && next === null)) return false;
    generation += 1;
    session = next ? Object.freeze({ ...next, generation }) : null;
    pending = null;
    inFlight = false;
    return true;
  }

  /** Taken BEFORE a read or command is sent; only a later ticket may repaint. */
  function issueTicket(): HallTicket | null {
    return session ? Object.freeze({ seq: ++issued, generation: session.generation }) : null;
  }

  /**
   * The hall to paint from an answer, or null: another session's, older than
   * one already painted, or malformed. A newer hall can also SETTLE an
   * unanswered Start or "Let them go" whose effect it shows (that turn running,
   * or no longer this screen's) — but never a Record, whose result is only
   * ever read from its own receipt.
   */
  function acceptHall(ticket: HallTicket | null, data: unknown): StationHall | null {
    if (!ticket || !live(ticket.generation) || ticket.seq <= applied) return null;
    const hall = parseStationHall(data);
    if (!hall) return null;
    applied = ticket.seq;
    if (pending && !inFlight) {
      const shown = hall.assigned?.turnRef === pending.expectedTurn ? hall.assigned : null;
      if (pending.command === 'wsfStartTurn' && shown?.state === 'active') pending = null;
      else if (pending.command === 'wsfCancelTurn' && !shown) pending = null;
    }
    return hall;
  }

  async function sendOperation(op: PendingOperation): Promise<CommandResult> {
    const s = session;
    if (!s || s.generation !== op.generation) return { kind: 'dropped' };
    inFlight = true;
    const ticket = issueTicket();
    let data: unknown;
    try {
      data = await deps.send(op.command, commandPayload(op, s));
    } catch (e) {
      if (!live(op.generation)) return { kind: 'dropped' };
      inFlight = false;
      const f = classifyCommandFailure(e);
      if (f.kind === 'lost') return { kind: 'lost', op, hall: null };
      if (pending?.id === op.id) pending = null;
      return { kind: 'failed', op, failure: f.kind, message: f.message, error: e };
    }
    if (!live(op.generation)) return { kind: 'dropped' };
    inFlight = false;
    const hall = acceptHall(ticket, data);
    if (op.command === 'wsfCompleteTurn') {
      const rec = parseStationReceipt(data);
      // No receipt, no success: the screen never claims the count it sent.
      if (!rec) return { kind: 'lost', op, hall };
      if (pending?.id === op.id) pending = null;
      return { kind: 'recorded', op, entryId: rec.entryId, receipt: rec.receipt, hall };
    }
    if (pending?.id === op.id) pending = null;
    return { kind: 'done', op, hall };
  }

  /**
   * A press of Start, Record or "Let them go" against the turn the screen SHOWS
   * at the press. It captures that turn's binding (and Record's count) once.
   * While an earlier operation is still unanswered, a press for the same turn
   * resends THAT operation exactly; a press for another turn waits for it.
   */
  async function press(command: StationTurnCommand, visible: StationHall | null, countText?: string | null): Promise<CommandResult> {
    if (inFlight) return { kind: 'busy' };
    const s = session;
    if (!s) return { kind: 'noSession' };
    const assigned = visible?.assigned ?? null;
    if (!assigned || !COMMAND_STATE[command].has(assigned.state)) return { kind: 'noTurn' };
    if (!isStationTurnRef(assigned.turnRef)) return { kind: 'unavailable' };
    if (pending) {
      if (pending.expectedTurn === assigned.turnRef && pending.command === command) return sendOperation(pending);
      return { kind: 'otherPending', pending };
    }
    let count: number | null = null;
    if (command === 'wsfCompleteTurn') {
      count = turnCountValue(countText ?? null);
      if (count === null) return { kind: 'badCount' };
    }
    const op: PendingOperation = Object.freeze({
      id: ++opIds,
      command,
      expectedTurn: assigned.turnRef,
      count,
      code: assigned.code,
      generation: s.generation,
    });
    pending = op;
    return sendOperation(op);
  }

  /** Resend the unanswered operation, exactly as it was pressed. */
  async function retry(): Promise<CommandResult> {
    if (inFlight) return { kind: 'busy' };
    if (!pending) return { kind: 'noTurn' };
    return sendOperation(pending);
  }

  /** Call next: no binding (it creates one), and allowed while an earlier operation is unanswered. */
  async function callNext(): Promise<CommandResult> {
    if (inFlight) return { kind: 'busy' };
    const s = session;
    if (!s) return { kind: 'noSession' };
    inFlight = true;
    const ticket = issueTicket();
    const g = s.generation;
    let data: unknown;
    try {
      data = await deps.send('wsfCallNext', { stationId: s.stationId, secret: s.secret });
    } catch (e) {
      if (!live(g)) return { kind: 'dropped' };
      inFlight = false;
      const f = classifyCommandFailure(e);
      return { kind: 'failed', op: null, failure: f.kind, message: f.message, error: e };
    }
    if (!live(g)) return { kind: 'dropped' };
    inFlight = false;
    const blocked = isObject(data) && typeof data.blockedMessage === 'string' && data.blockedMessage ? data.blockedMessage : null;
    return { kind: 'called', hall: acceptHall(ticket, data), blockedMessage: blocked };
  }

  return {
    setSession,
    issueTicket,
    acceptHall,
    press,
    retry,
    callNext,
    pending: () => pending,
    busy: () => inFlight,
  };
}

export type StationTurnController = ReturnType<typeof createStationTurnController>;

/**
 * The count box belongs to ONE turn. An answer for an operation clears it only
 * when the box was typed for that operation's turn, so A's late answer can
 * never empty what is being typed for B; and a box typed for one turn shows
 * nothing once the screen is on another.
 */
export type TurnCountInput = Readonly<{ turnRef: string | null; text: string }>;
export function countInputFor(input: TurnCountInput, visibleTurnRef: string | null | undefined): string {
  return input.turnRef !== null && input.turnRef === (visibleTurnRef ?? null) ? input.text : '';
}
export function countInputAfter(input: TurnCountInput, op: PendingOperation): TurnCountInput {
  return input.turnRef === op.expectedTurn ? { turnRef: null, text: '' } : input;
}

/** The screen's own words for an operation it is still waiting on. A code, never a name. */
export function describePendingOperation(op: PendingOperation): string {
  const what = op.command === 'wsfCompleteTurn' ? `the result (${op.count})` : op.command === 'wsfStartTurn' ? 'the start' : '“Let them go”';
  return `No answer yet for ${op.code.toUpperCase()}. “Try again” sends ${what} again for that turn — it can’t count twice.`;
}
/** And for an operation that must wait until an earlier one is answered. */
export function describeOtherPending(op: PendingOperation): string {
  return `Finish checking ${op.code.toUpperCase()} first — tap “Try again”.`;
}
/** Against a server that does not bind turns: the three commands are unavailable, never sent unbound. */
export const TURN_COMMANDS_UNAVAILABLE = 'This screen can’t start or record turns until the event’s server is updated.';
/** A Record's result, from ITS OWN receipt: the code it was pressed for and the amount the server recorded. */
export function describeRecordedOperation(op: PendingOperation, receipt: StationReceipt): string {
  const unit = receipt.unit.trim();
  return unit ? `${op.code.toUpperCase()} · ${receipt.addedCount} ${unit} recorded.` : `${op.code.toUpperCase()} · ${receipt.addedCount} recorded.`;
}
