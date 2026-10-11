/**
 * KIOSK-GUEST-MOVE-1 (#365 6111692291): a walk-up guest's squats at a paired
 * kiosk count toward that station's goal.
 *
 * The owner approved this (17:11Z, relayed in the queue): anonymous guest kiosk
 * squats count toward the community goal, and guests never earn raffle tickets.
 * Counsel sign-off (GUEST-ENTRIES-OK) is still open; production enablement is
 * the owner's call.
 *
 * This module holds the parts that need nothing from index.ts: the names, the
 * limits, the per-station window and the receipt. The callable itself,
 * `wsfStationGuestContribute`, is at the end of index.ts, because it reuses the
 * station and goal helpers that are private to that file.
 *
 * WHAT A GUEST MOVE IS:
 *   - one document in its OWN collection, wsfKioskGuestMoves, never in
 *     wsfContributions. No uid, no name, no device detail. That collection is
 *     not a raffle source (expo-prize reads only wsfContributions/{goalId}_
 *     {uid}_{attemptId}), not the activity feed's scan, and not a member's
 *     history, so a guest can never earn a ticket, never appear as a person,
 *     and never disturb a member's own records;
 *   - the goal's shared total moving exactly as a member's contribution moves
 *     it: one goal shard, one recent-addition line, the combined parent credit
 *     when the goal is a child of an active combined goal, the pulse cache
 *     dropped, and the target-crossing event claimed.
 */

/** The value of `source` on every guest move and guest parent credit. */
export const GUEST_SOURCE = 'kioskGuest' as const;

/** One document per station and attempt. Server-only (catch-all deny). */
export const GUEST_MOVES_COLLECTION = 'wsfKioskGuestMoves';

/** One document per station: its guest-recording window. Server-only. */
export const GUEST_LIMITS_COLLECTION = 'wsfStationGuestLimits';

/**
 * The per-station rate limit: at most GUEST_RATE_MAX new guest moves in a
 * fixed GUEST_RATE_WINDOW_MS window. A real guest set takes far longer than ten
 * seconds, so this never slows an honest kiosk; it bounds what a leaked station
 * secret can add. Replays and refusals are never charged.
 */
export const GUEST_RATE_WINDOW_MS = 60_000;
export const GUEST_RATE_MAX = 6;

export const GUEST_BUSY_MESSAGE =
  'Someone is in line for this station. Guests can move once the line is clear.';
export const GUEST_RATE_MESSAGE =
  'This station is recording guests too quickly. Try again in a minute.';
export const GUEST_ONCE_MESSAGE =
  'This goal takes one contribution from each member, so guests cannot add to it.';
export const GUEST_NOT_PUBLIC_MESSAGE =
  'This goal is not shown publicly, so guests cannot add to it.';

/**
 * The guest move's document id. Station ids are server-minted auto-ids (no
 * `_`), and the attempt id is the caller's, so a station can replay only its
 * own attempts.
 */
export function guestMoveId(stationId: string, attemptId: string): string {
  return `${stationId}_${attemptId}`;
}

/**
 * The name of the guest move's recent-addition line and of its combined
 * parent credit. `~` is outside what normalizeStringId and normalizeAttemptId
 * admit, so no member's line or credit (named by the bare attemptId, or by
 * `${goalId}_${uid}_${attemptId}`) can ever have this name, and a station can
 * never overwrite a member's.
 */
export function guestLinkId(stationId: string, attemptId: string): string {
  return `${GUEST_SOURCE}~${stationId}~${attemptId}`;
}

export type GuestRateWindow = { windowStartMs: number; count: number };

/**
 * The station's window after one more guest move at `now`, or null when the
 * window is full. A missing, unreadable or expired window starts a new one.
 *
 * A window that starts a little AFTER `now` is the current window, not an
 * unreadable one: racing moves read the clock before they queue on this
 * document, so a move can find the window a later-clocked move just opened.
 * Resetting there would let every racing move start its own window and pass
 * the cap. Only a start more than one whole window ahead is treated as
 * unreadable and replaced, so a bad value can hold a station for at most two
 * windows.
 */
export function nextGuestRateWindow(prev: unknown, now: number): GuestRateWindow | null {
  const p = (prev ?? null) as { windowStartMs?: unknown; count?: unknown } | null;
  const start =
    typeof p?.windowStartMs === 'number' && Number.isFinite(p.windowStartMs) ? p.windowStartMs : null;
  const count =
    typeof p?.count === 'number' && Number.isInteger(p.count) && p.count >= 0 ? p.count : 0;
  if (start === null || start - now > GUEST_RATE_WINDOW_MS || now - start >= GUEST_RATE_WINDOW_MS) {
    return { windowStartMs: now, count: 1 };
  }
  if (count >= GUEST_RATE_MAX) return null;
  return { windowStartMs: start, count: count + 1 };
}

/** What is stored for one guest move. No uid, no name, no device detail. */
export type GuestMoveDoc = {
  source: typeof GUEST_SOURCE;
  stationId: string;
  attemptId: string;
  goalId: string;
  communityGroupId: string;
  unit: string;
  count: number;
  shardIndex: number;
};

/**
 * The answer (the web's GUEST_MOVE_PORT). `recorded` and `alreadyRecorded` are
 * exact opposites: this call wrote the move, or an earlier call with the same
 * attemptId did. `after` is the goal's shared total read just after the move
 * committed, so it can include other moves that landed at the same moment;
 * `before` is `after - amount`, given only for a move this call recorded, and
 * never a separate reading. The four shared fields are null when the goal's
 * total may not be shown publicly. A new guest move is refused on such a goal,
 * so that happens only on a replay after the goal stopped being public.
 */
export type GuestContributeResponse = {
  recorded: boolean;
  alreadyRecorded: boolean;
  amount: number;
  unit: string;
  before: number | null;
  after: number | null;
  target: number | null;
  status: string | null;
};

export function guestReceipt(args: {
  fresh: boolean;
  amount: number;
  unit: string;
  shared: { total: number; target: number; status: string } | null;
}): GuestContributeResponse {
  const { fresh, amount, unit, shared } = args;
  return {
    recorded: fresh,
    alreadyRecorded: !fresh,
    amount,
    unit,
    before: shared && fresh ? Math.max(0, shared.total - amount) : null,
    after: shared ? shared.total : null,
    target: shared ? shared.target : null,
    status: shared ? shared.status : null,
  };
}
