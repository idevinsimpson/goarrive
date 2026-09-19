/**
 * THE TURN CONTRACT, on the client side — the state machine, the words, and
 * the one rule about what a hall may see.
 *
 * It holds no state, reaches no network and renders nothing, so the whole of
 * it can be reasoned about — and tested — on its own. The server's half is the
 * TURN CONTRACT section of functions-westayfit/src/index.ts, and the two are
 * deliberately copies rather than a shared package: the client cannot be the
 * only place a rule is enforced, because the client is not the only possible
 * caller. Both are pinned by tests.
 *
 * THE STATE MACHINE, in one place:
 *
 *      (not in line)
 *           │  join, naming yourself           ONE PLACE PER ACCOUNT
 *           ▼                                  PER EVENT — not per activity
 *       waiting ──────── you leave ──────────────────────► left
 *           │  a station calls you
 *           ▼
 *      assigned ──────── 45 s lease lapses ───────────────► noShow
 *           │  YOU tap “I’m ready”            (your place comes back;
 *           ▼                                  get in line again)
 *        ready ───────── you leave, or the station cancels ► left
 *           │  the station starts you: ONE attempt is minted
 *           ▼  and bound to station + account + activity
 *       active ───────── you leave, or the station cancels ► left
 *           │  finish — from the station OR from your phone,
 *           ▼  recording that one attempt, idempotently
 *         done ───────── 10 s of result, then every name is gone
 *                        (your receipt stays recoverable)
 *
 * WHAT THE HALL MAY SEE, and the reason this module exists: the currently
 * assigned first name or alias, plus a short code — and nothing about anybody
 * else. `hallVisibleNames` is the one function that says which names a screen
 * would print, so a test can assert there is never more than one.
 */

/** Every state a turn can be in. There is no eighth. */
export type TurnStatus =
  | 'waiting'
  | 'assigned'
  | 'ready'
  | 'active'
  | 'done'
  | 'noShow'
  | 'left';

/** The four that mean this person still holds their one place at the event. */
export function isTurnLive(status: string | null | undefined): boolean {
  return (
    status === 'waiting' || status === 'assigned' || status === 'ready' || status === 'active'
  );
}

/**
 * FORTY-FIVE SECONDS. The same number as the server's TURN_READY_LEASE_MS,
 * written here so a screen can count down without asking, and never used to
 * DECIDE anything: the server's instant is the only authority on whether a
 * lease has lapsed. A client that counts to zero asks again; it does not
 * conclude.
 */
export const READY_LEASE_SECONDS = 45;

/** Ten seconds of result on the hall screen, and then nothing. */
export const RESULT_VISIBLE_SECONDS = 10;

/** What the hall is handed for the one person it is serving. No uid, no
 * entryId, no position — and no list, at any depth. */
export type HallAssignment = {
  code: string;
  calledName: string;
  state: 'assigned' | 'ready' | 'active';
  readySecondsLeft: number | null;
  /** What this turn is for, so the screen runs that movement's follow-along.
   * A combined event's line holds people who chose different activities, so a
   * station cannot infer it from its own address. Names an activity, never a
   * person. */
  activityUnit: string;
};

/** The ten-second result. A code and a number — never a name. */
export type HallResult = { code: string; amount: number; unit: string; secondsLeft: number };

export type HallState = {
  stationId: string;
  stationLabel: string;
  assigned: HallAssignment | null;
  result: HallResult | null;
  waitingCount: number;
};

/**
 * THE ASSERTION SURFACE. Every name a screen would print, given a state.
 *
 * There is exactly one place a name can come from — the assigned person — so
 * this returns at most one string. It exists so a test can say "however this
 * screen is driven, it never prints two names", and so that a future change
 * that reintroduced a waiting list would have to change THIS function to keep
 * its tests passing, which is the point.
 */
export function hallVisibleNames(state: HallState | null | undefined): string[] {
  const name = state?.assigned?.calledName?.trim();
  return name ? [name] : [];
}

/**
 * The one sentence a turn is announced with — printed in the largest type AND
 * read out by an ARIA live region, so what a screen shows and what a screen
 * reader says cannot drift apart.
 *
 * `null` when nobody is up: an empty line is a normal state at an event, and a
 * live region that announces emptiness interrupts a screen reader for nothing.
 */
export function announceHallTurn(
  state: HallState | null | undefined,
  stationLabel?: string | null
): string | null {
  const assigned = state?.assigned;
  const name = assigned?.calledName?.trim();
  if (!assigned || !name) return null;
  const label = (stationLabel ?? state?.stationLabel ?? '').trim();
  const where = label ? ` at ${label}` : '';
  if (assigned.state === 'active') return `${name} · ${assigned.code} — running now${where}.`;
  if (assigned.state === 'ready') return `${name} · ${assigned.code} — ready${where}.`;
  return `${name} · ${assigned.code} — it’s your turn${where}.`;
}

/** The result line, for the ten seconds it is up. It names nobody. */
export function describeHallResult(result: HallResult | null | undefined): string | null {
  if (!result) return null;
  const unit = result.unit?.trim();
  return unit
    ? `${result.code} · ${result.amount} ${unit} recorded.`
    : `${result.code} · ${result.amount} recorded.`;
}

/** How long the line is, for the screen in the room. A count, never a list. */
export function describeWaitingCount(waitingCount: number): string {
  const n = Number.isFinite(waitingCount) && waitingCount > 0 ? Math.floor(waitingCount) : 0;
  if (n === 0) return 'Nobody is waiting.';
  if (n === 1) return '1 person waiting.';
  return `${n} people waiting.`;
}

/**
 * WHICH ONE CONTROL THE STATION OFFERS. Only working actions look actionable,
 * so this returns exactly one primary action for any state rather than a row
 * of buttons that mostly refuse.
 *
 *   - 'callNext'  — nobody is up. Call the next person.
 *   - 'awaitReady'— somebody is called and has not tapped yet. The screen
 *                   waits; it cannot start them, and it says why.
 *   - 'start'     — they tapped. Start their turn.
 *   - 'complete'  — their turn is running. Record it.
 */
export type StationAction = 'callNext' | 'awaitReady' | 'start' | 'complete';

export function stationAction(state: HallState | null | undefined): StationAction {
  const assigned = state?.assigned;
  if (!assigned) return 'callNext';
  if (assigned.state === 'active') return 'complete';
  if (assigned.state === 'ready') return 'start';
  return 'awaitReady';
}

/** The label on that one control. */
export function stationActionLabel(action: StationAction): string {
  if (action === 'complete') return 'Record this turn';
  if (action === 'start') return 'Start their turn';
  if (action === 'awaitReady') return 'Waiting for them to tap ready';
  return 'Call next';
}

/**
 * Where somebody is, in words rather than an ordinal.
 *
 * Deliberately NOT "you are number 7": the position the server allocates is a
 * counter, not a place in the line — the people in front may have left — so
 * printing it would tell somebody something untrue. What is true, and what
 * they want, is how many are in front of them right now.
 */
export function describeTurnPlace(opts: {
  status: TurnStatus;
  ahead: number;
  stationLabel?: string | null;
  readySecondsLeft?: number | null;
}): string {
  const label = opts.stationLabel?.trim();
  const where = label ? ` at ${label}` : '';
  if (opts.status === 'assigned') {
    const left = opts.readySecondsLeft;
    const seconds =
      typeof left === 'number' && Number.isFinite(left) && left > 0 ? Math.floor(left) : 0;
    return seconds > 0
      ? `It’s your turn${where}. Tap “I’m ready” within ${seconds}s.`
      : `It’s your turn${where}. Tap “I’m ready”.`;
  }
  if (opts.status === 'ready') return `You’re up${where}. Walk over — they’re expecting you.`;
  if (opts.status === 'active') return `Your turn is running${where}.`;
  if (opts.status !== 'waiting') return 'You’re not in the line.';
  const ahead = Number.isFinite(opts.ahead) && opts.ahead > 0 ? Math.floor(opts.ahead) : 0;
  if (ahead === 0) return 'You’re next.';
  if (ahead === 1) return '1 person ahead of you.';
  return `${ahead} people ahead of you.`;
}

/**
 * The sentence for a place that was lost to the lease.
 *
 * It says what happened and what to do, and it does not apologise for a timer
 * the person never saw: they were called, forty-five seconds passed, and the
 * line moved on. Getting back in is one tap.
 */
export const TURN_NO_SHOW_MESSAGE =
  'The screen called you and the 45 seconds ran out, so it moved on. Get back in line and it will call you again.';

/** The one sentence for a name a screen may not show. Mirrors the server's
 * TURN_NAME_REFUSED, deliberately as a copy. */
export const TURN_NAME_REFUSED =
  'Choose a name for the screen — up to 24 characters, and not an email address.';

/** The one sentence for an account that is already in this event's line under
 * a different activity. Mirrors the server's TURN_OTHER_ACTIVITY_MESSAGE. */
export const TURN_OTHER_ACTIVITY_MESSAGE =
  'You’re already in the line at this event. Finish or leave that turn first.';

/**
 * A code, as a screen prints it. Upper case and nothing else — the server
 * mints it from an alphabet with I, O, 0 and 1 removed, so there is nothing to
 * prettify and no separator to mistake for a character.
 */
export function formatTurnCode(code: string | null | undefined): string {
  return typeof code === 'string' ? code.trim().toUpperCase() : '';
}

/**
 * Whether a count typed at a station or on a phone is one the server will
 * take. The same bounds as normalizeContributionCount, so a screen refuses
 * locally exactly what the server would refuse remotely, and never the other
 * way round.
 */
export function isUsableTurnCount(raw: string | null | undefined): boolean {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!/^\d{1,6}$/.test(trimmed)) return false;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 1 && n <= 100000;
}

/** The number itself, or null when there is not one. */
export function turnCountValue(raw: string | null | undefined): number | null {
  return isUsableTurnCount(raw) ? Number((raw as string).trim()) : null;
}
