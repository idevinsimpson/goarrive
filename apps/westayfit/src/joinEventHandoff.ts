/**
 * THE EVENT A NEWCOMER ARRIVED FROM — the member side of a join QR.
 *
 * A screen at an event shows `/join/<code>?event=<goalId>&activity=<label>`.
 * Somebody who scans it signed out goes through sign-up, verification and
 * profile setup — routes that each replace the page and drop the query string
 * — before the join happens. These two records carry the event and the
 * activity across that round trip so the finished join lands at the event the
 * person walked up to, with what the room was doing, rather than at a page
 * that has forgotten both.
 *
 * SPLIT OUT OF src/stationSession.ts (NATIVE-STATE-3). They lived beside the
 * station credential, but they are not the station's: they belong to a member
 * journey, are written and read only by the join route, and never shared a key
 * with the station device's own session, secret or pairing. Moving them here
 * changed nothing about the station path; stationSession.ts re-exports these
 * accessors (their signatures now take the join code, and the activity's the
 * goal id too).
 *
 * KEPT LIKE EVERY OTHER POST-AUTH DESTINATION (src/postAuthDestination.ts):
 *   - WEB: sessionStorage under the same two keys, read synchronously, as
 *     JSON bound to the join code (and the activity to its goal; FORMAT
 *     below). A closed tab must not carry an event into the next thing this
 *     browser does.
 *   - iOS / ANDROID: AsyncStorage with a two-hour expiry, read at launch, so a
 *     scan survives the app being killed mid-sign-up (the member is in their
 *     mail app verifying their address) and still ends at the event. The
 *     expiry holds in a long-running process too (src/storage/mirror.ts).
 *   - WHOSE: stashed signed out, the context is the handoff for whoever signs
 *     in next; stashed while an account is signed in, it is that account's
 *     alone, never applied to another account's join, and cleared when that
 *     account's session ends.
 *
 * BOUND TO THE JOIN CODE IT ARRIVED WITH. Each record stores the code of the
 * join link it came on, and the finished join applies the context ONLY when
 * the join it completed was for that same code. Without this, somebody who
 * scanned an event's join QR, walked away, and later joined a different
 * community (in the same tab, or within the two hours on a phone) landed on
 * the abandoned event instead of their new community. A record that names a
 * different code — or none, as every record written before this rule did —
 * is discarded at the join and never routes anywhere.
 *
 * AND THE ACTIVITY TO ITS GOAL. The join code alone was not enough: two event
 * QRs can carry the same join code, and a second scan WITHOUT an activity
 * (a bare QR — the station falls back to one when the unit does not fit, and
 * a goal may have no unit) used to leave the first scan's activity in place,
 * so goal G2's page said "Counted in Squats" for an activity only G1 had
 * published. The activity record now names its goal, and is applied only to
 * that goal; the join route also clears it when an event arrives without one.
 *
 * ACCEPTED LIMITS. (1) A return trip cannot be told apart from a fresh plain
 * visit: after an abandoned event scan for code X, a plain invite link for
 * the SAME code X (or one whose `?event=` is not a goal id) writes nothing, so
 * the earlier context still applies to that join — within the tab, or the
 * two hours on a phone. A join of any OTHER code never sees it. (2) Records
 * written by the build before this format (bare values) are discarded at
 * deploy: somebody mid-sign-up across the deploy lands on the community they
 * joined rather than the event. (3) A consumed context survives if the
 * device refuses its removal twice and the overwrite — or refuses one removal
 * while a newer write lands that the device also refuses (that write counts
 * as newer, so the discard stops). It can then apply once more to a later
 * join of the same code, within the expiry.
 *
 * FORMAT: `{"goalId":…,"joinCode":…}` and
 * `{"activity":…,"goalId":…,"joinCode":…}`, plus `"owner":…` when an account
 * stashed it. (These were the bare goal id and the bare label before; a bare
 * value left over from then reads as code-less, and is discarded.) A JSON
 * object without its field — including `DISCARDED_RECORD`, what is left when
 * a record could not be removed — decodes as nothing.
 *
 * WHAT IS IN THEM. A goal id — the value that was already in the URL — and an
 * activity label, the event's own published word for what it counts. Nothing
 * about the person, no station secret, no pairing id, no authority.
 */
import { readActivityLabel } from './eventActivity';
import { clearPendingJoinCode, isJoinCodeShape } from './pendingJoinCode';
import { definePostAuthDestination, postAuthDestinationsReady } from './postAuthDestination';

/** The event a scanned `/join/<code>?event=<goalId>` came from. */
export const PENDING_EVENT_KEY = 'wsf.pendingEventGoalId';
/** The activity that event was running, beside it, by the same mechanism. */
export const PENDING_EVENT_ACTIVITY_KEY = 'wsf.pendingEventActivity';

/** Goal ids as everywhere else here: nothing that could become a path of its own. */
function isIdShape(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

/**
 * A stored value, the join code it arrived with (null: a record from before
 * codes were kept) and — for the activity — the goal it belongs to (null:
 * a record that names none, which is never applied).
 */
type Bound = { value: string; joinCode: string | null; goalId?: string | null };

/**
 * Decode `{"<field>":…,"joinCode":…[,"goalId":…][,"owner":…]}`. A bare
 * (non-JSON) value from before the code was kept decodes as code-less, so it
 * is still found (and cleared) but never applied. A JSON object without its
 * field decodes as nothing.
 */
function decodeBound(
  raw: string,
  field: 'goalId' | 'activity',
  bare: (raw: string) => string | null,
  valid: (value: string) => string | null
) {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    v = undefined;
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (typeof o[field] !== 'string') return null;
    const value = valid(o[field] as string);
    if (!value) return null;
    const joinCode = typeof o.joinCode === 'string' && isJoinCodeShape(o.joinCode) ? o.joinCode : null;
    const goalId = field === 'activity' && typeof o.goalId === 'string' && isIdShape(o.goalId) ? o.goalId : null;
    const owner = o.owner === undefined ? null : typeof o.owner === 'string' && o.owner ? o.owner : undefined;
    if (owner === undefined) return null;
    return { value: { value, joinCode, ...(field === 'activity' ? { goalId } : {}) } as Bound, owner };
  }
  const value = bare(raw);
  return value ? { value: { value, joinCode: null, goalId: null } as Bound, owner: null } : null;
}

function encodeBound(field: 'goalId' | 'activity', bound: Bound, owner: string | null): string {
  return JSON.stringify({
    [field]: bound.value,
    ...(field === 'activity' ? { goalId: bound.goalId ?? null } : {}),
    joinCode: bound.joinCode,
    ...(owner ? { owner } : {}),
  });
}

const idOrNull = (v: string) => (isIdShape(v) ? v : null);

const pendingEvent = definePostAuthDestination<Bound>({
  key: PENDING_EVENT_KEY,
  decode: (raw) => decodeBound(raw, 'goalId', idOrNull, idOrNull),
  encode: (bound, owner) => encodeBound('goalId', bound, owner),
});

const pendingActivity = definePostAuthDestination<Bound>({
  key: PENDING_EVENT_ACTIVITY_KEY,
  // Re-checked on the way out as well as in: a hand-edited entry must not
  // become something this app will render or route with.
  decode: (raw) => decodeBound(raw, 'activity', readActivityLabel, readActivityLabel),
  encode: (bound, owner) => encodeBound('activity', bound, owner),
});

/**
 * Remember which event's QR a visitor followed, and the join code it came
 * with, so the join of THAT code can finish there. `ownerUid` is the account
 * signed in at this moment, or null. A value of the wrong shape is not
 * stored: the visitor then lands on their new community instead of the event
 * screen, which is a worse arrival, not a broken or leaky one.
 */
export function setPendingEventGoal(
  goalId: string,
  joinCode: string,
  ownerUid: string | null = null
): Promise<boolean> {
  if (!isIdShape(goalId) || !isJoinCodeShape(joinCode)) return Promise.resolve(false);
  return pendingEvent.write({ value: goalId, joinCode }, ownerUid);
}

/**
 * The event for `uid` (null: a signed-out reader) that arrived with
 * `joinCode`, or null — somebody else's, another code's, or a code-less
 * leftover.
 */
export function readPendingEventGoal(uid: string | null, joinCode: string): string | null {
  const bound = pendingEvent.read(uid);
  return bound && bound.joinCode !== null && bound.joinCode === joinCode ? bound.value : null;
}

export function clearPendingEventGoal(): Promise<boolean> {
  return pendingEvent.clear();
}

/**
 * Remember which ACTIVITY that event (`goalId`) was running, bound to the
 * same join code AND to that goal. Shape-checked by `readActivityLabel`,
 * which refuses control characters and anything past the cap outright; a
 * value that does not survive that check is simply not stored and the
 * journey finishes without an activity — less context, never a guessed one.
 */
export function setPendingEventActivity(
  activity: string,
  goalId: string,
  joinCode: string,
  ownerUid: string | null = null
): Promise<boolean> {
  const label = readActivityLabel(activity);
  if (!label || !isIdShape(goalId) || !isJoinCodeShape(joinCode)) return Promise.resolve(false);
  return pendingActivity.write({ value: label, goalId, joinCode }, ownerUid);
}

/** The activity for `uid` that arrived with `joinCode` FOR `goalId`, or null. */
export function readPendingEventActivity(uid: string | null, joinCode: string, goalId: string): string | null {
  const bound = pendingActivity.read(uid);
  if (!bound || bound.joinCode === null || bound.joinCode !== joinCode) return null;
  return bound.goalId != null && bound.goalId === goalId ? bound.value : null;
}

export function clearPendingEventActivity(): Promise<boolean> {
  return pendingActivity.clear();
}

export type JoinEventContext = { goalId: string | null; activity: string | null };

const NO_CONTEXT: JoinEventContext = { goalId: null, activity: null };

/**
 * THE END OF THE CARRYING — called once, by the join route, after the join of
 * `joinCode` has succeeded.
 *
 * Waits for the native launch read (immediate on web), reads the event and its
 * activity for the account that just joined AND for the code it just joined
 * with — the activity only if it belongs to that event — and discards BOTH
 * whatever they held, so the context is consumed once: a later call, a later
 * join or another account finds nothing. (Two takes running at the same
 * moment can both read it before either discards; the join route takes it
 * once per join.) A context from
 * another join code, a code-less leftover, one that belongs to another
 * account, or an activity without its event, is not applied — it is discarded
 * with the rest and never routes.
 *
 * "Discarded" is honoured, not assumed: a removal the device refuses is
 * retried once, and if it still refuses, the record is overwritten with one
 * that decodes as nothing (`discard()`, src/postAuthDestination.ts), so it
 * cannot apply again after a relaunch. Only a device that refuses the
 * removal twice AND the overwrite keeps it — and then only for the same join
 * code, within the expiry.
 */
export async function takeJoinEventContext(uid: string | null, joinCode: string): Promise<JoinEventContext> {
  const context = await readJoinEventContext(uid, joinCode);
  await discardJoinEventContext();
  return context;
}

/** The context for (uid, joinCode), after the native launch read. Reads only. */
async function readJoinEventContext(uid: string | null, joinCode: string): Promise<JoinEventContext> {
  await postAuthDestinationsReady();
  const goalId = readPendingEventGoal(uid, joinCode);
  const activity = goalId ? readPendingEventActivity(uid, joinCode, goalId) : null;
  return { goalId, activity };
}

function discardJoinEventContext(): Promise<unknown> {
  return Promise.all([pendingEvent.discard(), pendingActivity.discard()]);
}

/**
 * How long a finished join waits for the context before landing on the
 * community it joined. The join has already happened; a storage call that
 * stalls (each is bounded at 5 s by src/storage/keyQueue.ts, and a read is
 * tried twice) must not hold the member on "Joining…" for that long.
 */
export const JOIN_CONTEXT_WAIT_MS = 1_500;

/**
 * `takeJoinEventContext`, for the join route: only the READ is waited for,
 * and never longer than `ms` (past that, no context — the community
 * destination). The discards run in the background once the read has
 * answered, so a slow removal never costs the member their event. Whatever
 * the read found, it is still consumed, so it cannot apply to some later join
 * instead. Never rejects.
 */
export function takeJoinEventContextWithin(
  uid: string | null,
  joinCode: string,
  ms: number = JOIN_CONTEXT_WAIT_MS
): Promise<JoinEventContext> {
  return new Promise<JoinEventContext>((resolve) => {
    let settled = false;
    const finish = (context: JoinEventContext) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(context);
    };
    const timer = setTimeout(() => finish(NO_CONTEXT), ms);
    readJoinEventContext(uid, joinCode)
      .then(finish, () => finish(NO_CONTEXT))
      .finally(() => {
        void discardJoinEventContext();
      });
  });
}

/**
 * A SHARED SCREEN TAKES NO JOURNEY. When the device answers "shared", the
 * visitor is handed to the kiosk and no account is created here — so the
 * join code and the event context this page stashed belong to nobody. Left
 * behind, they would route the next walk-up who signs in on the kiosk to
 * `/join/<code>` and then the event (on a phone, for two hours across
 * restarts). Resolves whether all three were discarded.
 */
export function dropJoinJourney(): Promise<boolean> {
  return Promise.all([clearPendingJoinCode(), pendingEvent.discard(), pendingActivity.discard()]).then((r) =>
    r.every(Boolean)
  );
}
