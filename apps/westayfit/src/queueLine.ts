/**
 * THE LINE ITSELF — ordering, place-keeping and the words for both.
 *
 * The naming half lives in src/queueName.ts. This is the other pure half: how
 * a line is ordered, how many of it a screen shows, and what a person and a
 * room are told. It holds no queue state, reaches no network, and can be
 * reasoned about — and tested — on its own.
 *
 * TWO RULES IT EXISTS TO KEEP:
 *
 *   1. A LINE IS ORDERED BY ITS ALLOCATED POSITION AND BY NOTHING ELSE. Not by
 *      when a document happens to come back, not by its id, and not by a
 *      timestamp two writes a millisecond apart can report identically. The
 *      server hands out `position` from one counter; this is where that number
 *      becomes the order a room sees.
 *   2. NOTHING ABOUT A TURN DEPENDS ON SEEING OR HEARING IT. `announceCall`
 *      produces the one sentence that is BOTH printed in the largest type on
 *      the station and read out by an ARIA live region, so what a screen shows
 *      and what a screen reader says can never drift apart.
 */

/** Exactly what a caller may ever be told about somebody else's place in line.
 * No uid. The server's `publicQueueEntry` is the other end of this contract. */
export type QueueEntryPublic = { entryId: string; calledName: string; position: number };

export type QueueStatus = 'waiting' | 'called' | 'done' | 'left';

/** The two statuses that mean a person still holds a place in the line. */
export function isLiveQueueStatus(status: string | null | undefined): boolean {
  return status === 'waiting' || status === 'called';
}

/**
 * Oldest first.
 *
 * Copies before sorting: the caller's array is very often React state, and a
 * sort in place is a mutation React cannot see.
 */
export function orderByPosition<T extends { position: number }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => a.position - b.position);
}

/**
 * How many of the line a screen shows after the person being called.
 *
 * Four, because the point of showing the next few is "am I soon?", which four
 * answers and twenty does not — and because a screen that prints the whole
 * line prints the whole room's names at once.
 */
export const NEXT_UP_SHOWN = 4;

export function nextUp(
  waiting: readonly QueueEntryPublic[],
  limit: number = NEXT_UP_SHOWN
): QueueEntryPublic[] {
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
  return orderByPosition(waiting).slice(0, max);
}

/**
 * The one sentence a turn is announced with — printed AND read aloud.
 *
 * `null` when nobody is up: an empty line is a normal state at an event, and a
 * live region that announces emptiness interrupts a screen reader for nothing.
 */
export function announceCall(
  serving: QueueEntryPublic | null | undefined,
  stationLabel?: string | null
): string | null {
  const name = serving?.calledName?.trim();
  if (!name) return null;
  const label = stationLabel?.trim();
  return label ? `${name} — it’s your turn at ${label}.` : `${name} — it’s your turn.`;
}

/** The same sentence for the person's own phone, which already knows it is
 * about them. */
export function announceYourTurn(stationLabel?: string | null): string {
  const label = stationLabel?.trim();
  return label ? `It’s your turn — go to ${label}.` : 'It’s your turn.';
}

/**
 * Where somebody is, in words rather than an ordinal.
 *
 * Deliberately NOT "you are number 7": `position` is an allocation counter, not
 * a place in the line — the people in front may have left — so printing it
 * would tell somebody something untrue. What is true, and what they want, is
 * how many are in front of them right now.
 */
export function describePlaceInLine(opts: {
  status: QueueStatus;
  ahead: number;
  stationLabel?: string | null;
}): string {
  if (opts.status === 'called') return announceYourTurn(opts.stationLabel);
  if (opts.status !== 'waiting') return 'You’re not in the line.';
  const ahead = Number.isFinite(opts.ahead) && opts.ahead > 0 ? Math.floor(opts.ahead) : 0;
  if (ahead === 0) return 'You’re next.';
  if (ahead === 1) return '1 person ahead of you.';
  return `${ahead} people ahead of you.`;
}

/** How long the line is, for the screen in the room. */
export function describeLineLength(waitingCount: number): string {
  const n = Number.isFinite(waitingCount) && waitingCount > 0 ? Math.floor(waitingCount) : 0;
  if (n === 0) return 'Nobody is waiting.';
  if (n === 1) return '1 person waiting.';
  return `${n} people waiting.`;
}
