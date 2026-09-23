/**
 * Kiosk session — the rules a shared device has to obey, as plain functions.
 *
 * A kiosk is ONE goal on ONE device that many different people walk up to.
 * Everything here exists to make each of those walk-ups an independent
 * session: the handoff that survives the sign-in round trip, the countdown
 * that ends a session nobody is standing at, and the Finish plan that says
 * exactly what may and may not be erased when a session ends.
 *
 * Kept out of the route module for the same reason as pendingContribution.ts:
 * a file under a bracketed dynamic path cannot be imported by the test
 * harness, and these are the rules that most need testing directly.
 *
 * WHAT A KIOSK IS NOT. It is not a verification of anything. The device does
 * not know who is standing at it; it knows only that someone signed in with
 * their own credentials a moment ago. Same browser is not cross-device
 * proof, and no copy in this feature says or implies that it is.
 */

/** sessionStorage, not localStorage: a closed tab must not carry a kiosk
 * destination into the next thing this browser does. Same lifetime choice,
 * and the same reasoning, as src/pendingJoinCode.ts. */
const KIOSK_RETURN_KEY = 'wsf.kioskReturnGoalId';

/** Every browser-storage key this feature is allowed to own. Finish removes
 * exactly these and nothing else — see `kioskSessionStorageKeys`. */
export const KIOSK_SESSION_KEYS = [KIOSK_RETURN_KEY] as const;

/** 90 seconds on a terminal screen with nobody touching it. Long enough to
 * read a receipt twice; short enough that the next person does not find the
 * previous person's result waiting for them. */
export const KIOSK_IDLE_MS = 90_000;

/** The countdown repaints once a second; nothing about it needs to be finer. */
export const KIOSK_TICK_MS = 1_000;

/**
 * The generic refusal, byte-identical to app/display/[goalId].tsx.
 *
 * A kiosk pointed at a goal that is not display-authorized is not a public
 * surface, so it must not look like one, and it must not become an oracle
 * for which goal ids exist. It says exactly what the display says — same two
 * strings, same silence about the reason.
 *
 * These are a COPY, deliberately. The display route is approved as it
 * stands and is not edited to export them; tests/kiosk-session.test.ts
 * asserts the literals here, and tests-e2e/ui-kiosk.spec.ts asserts the two
 * surfaces render the same text.
 */
export const KIOSK_REFUSAL_HEADLINE = 'Nothing to show here';
export const KIOSK_REFUSAL_BODY = 'This display isn’t currently available.';

/** Matches the shapes goal ids actually take, and refuses anything that could
 * turn a stored value into a path traversal or a query of its own. */
function isGoalIdShape(goalId: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(goalId);
}

/** `/kiosk/<goalId>` — the start screen, and where every Finish returns to. */
export function kioskStartRoute(goalId: string): string {
  return `/kiosk/${encodeURIComponent(goalId)}`;
}

/**
 * `/contribute/<goalId>?kiosk=1` — the EXISTING contribution flow, flagged.
 *
 * A query parameter rather than a `/kiosk/<goalId>/contribute` sub-route:
 * expo-router's static export would emit a second bracketed directory that
 * needs its own `__dynamic` alias and its own hosting rewrite, and the
 * contribution screen would have to be mounted twice. The flag rides the
 * route the visitor is already on.
 */
export function kioskContributeRoute(goalId: string): string {
  return `/contribute/${encodeURIComponent(goalId)}?kiosk=1`;
}

/**
 * Whether a route parameter puts a journey in kiosk mode.
 *
 * ONE ANSWER, FOR EVERY READER. The shell decides whether to draw member
 * navigation and the contribution screen decides whether to offer Finish, and
 * they have to reach the same verdict from the same URL. When the array case
 * was normalised in the shell alone, `?kiosk=1&kiosk=x` produced the worst of
 * both: no tab bar, because the shell called it a kiosk, AND no Finish, because
 * the screen called it ordinary -- leaving a shared device with the screen's own
 * member exits and nothing to end the session with. The normalisation belongs
 * here, where both of them already look.
 *
 * FAIL CLOSED ON A REPEATED PARAMETER. A URL can carry the same key twice, and
 * the router hands that over as an array. Reading it as "not the flag" would
 * hand a shared device its ordinary navigation back for the price of one
 * duplicated query parameter, so ANY element saying kiosk makes it a kiosk.
 * Scalar behaviour is unchanged: '1' and 'true', nothing else.
 */
export function isKioskFlag(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((entry) => isKioskFlag(entry));
  return value === '1' || value === 'true';
}

export function setKioskReturnGoal(goalId: string): void {
  try {
    if (typeof window === 'undefined') return;
    const storage = window.sessionStorage;
    if (!storage) return;
    if (!isGoalIdShape(goalId)) return;
    storage.setItem(KIOSK_RETURN_KEY, goalId);
  } catch {
    // Private browsing / locked-down UA. The kiosk still works: the visitor
    // lands on home after signing in instead of back on the contribution
    // screen, which is a worse walk-up, not a broken or leaky one.
  }
}

export function readKioskReturnGoal(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.sessionStorage?.getItem(KIOSK_RETURN_KEY);
    if (raw == null) return null;
    return isGoalIdShape(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function clearKioskReturnGoal(): void {
  try {
    if (typeof window === 'undefined') return;
    window.sessionStorage?.removeItem(KIOSK_RETURN_KEY);
  } catch {
    // ignore
  }
}

/** The keys Finish is allowed to remove. Nothing else in storage is touched:
 * an unresolved attempt belongs to the member it was written for. */
export function kioskSessionStorageKeys(): readonly string[] {
  return KIOSK_SESSION_KEYS;
}

// ---- the countdown ---------------------------------------------------------

/**
 * Milliseconds left before the session ends by itself.
 *
 * Wall-clock difference, not a decremented counter: a backgrounded tab's
 * interval is throttled, and a counter that only moves when a timer fires
 * would leave a receipt on a dimmed kiosk for as long as the browser felt
 * like sleeping. Clamped at zero so an expired session never reports a
 * negative or a wrapped value.
 */
export function kioskRemainingMs(startedAt: number, now: number, totalMs = KIOSK_IDLE_MS): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(now)) return totalMs;
  const elapsed = now - startedAt;
  if (!(elapsed > 0)) return totalMs;
  const left = totalMs - elapsed;
  return left > 0 ? left : 0;
}

/** Whole seconds to show. Rounds UP, so "1 second" is on screen for the last
 * whole second rather than flicking to 0 while time is still left. */
export function kioskRemainingSeconds(remainingMs: number): number {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / 1000);
}

export function kioskCountdownExpired(remainingMs: number): boolean {
  return !(remainingMs > 0);
}

/**
 * What the countdown says. Plain, and about the DEVICE, not the person: it
 * promises to end the session, it does not thank anyone or claim anything
 * about what was recorded.
 */
export function kioskCountdownLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s === 0) return 'Finishing now…';
  return `Finishing in ${s} second${s === 1 ? '' : 's'}`;
}

// ---- Finish ----------------------------------------------------------------

/**
 * What the visitor's attempt ended as, from the kiosk's point of view.
 *
 * - `confirmed` — the server answered and the receipt is on screen.
 * - `refused`   — the server answered and definitively did not record it.
 * - `unresolved` — NOBODY KNOWS. The request left and no answer came back.
 * - `none`      — nothing was ever submitted on this device this session.
 */
export type KioskOutcome = 'confirmed' | 'refused' | 'unresolved' | 'none';

export type KioskFinishPlan = {
  /** Whether Finish may remove this account's stored attempt record. */
  clearPendingDraft: boolean;
  /** Always true. Ending a kiosk session and staying signed in is not a
   * thing this feature can offer: the next person would inherit the account. */
  signOut: true;
  /** Shown to the visitor before they walk away, or null when there is
   * nothing they need to know. */
  notice: string | null;
  /** Where the device goes next. */
  returnTo: string;
};

/**
 * The one sentence an unresolved attempt gets.
 *
 * It states two true things and no more: the attempt is attached to their
 * account, and the place to resolve it is a device that is theirs. It does
 * not say it was recorded — that is exactly the fact nobody has.
 */
export const KIOSK_UNRESOLVED_NOTICE =
  'Your attempt is saved to your account; check it from your own device.';

/**
 * WHAT FINISH IS ALLOWED TO ERASE.
 *
 * A confirmed or definitively refused attempt has already been settled by
 * the contribution flow, and clearing its (already absent) record here is a
 * belt-and-braces removal of a draft that belongs to the session ending.
 *
 * AN UNRESOLVED ATTEMPT IS NOT ERASED. Its stored record is the only thing
 * that lets the member who made it replay the SAME attempt id later and get
 * the original receipt instead of booking a second contribution. Deleting it
 * to make the kiosk look clean would destroy the one artefact that keeps
 * their effort reconcilable. It stays, keyed to their account, and they are
 * told plainly where to go and see it.
 *
 * In every case the account is signed out and the kiosk-owned storage keys
 * go, so the next visitor inherits an empty device — an unresolved record
 * left behind is scoped to a uid that is no longer signed in, is only ever
 * read back by that same uid (src/pendingContribution.ts `pendingKey`), and
 * carries no name, address or other identifier.
 */
export function kioskFinishPlan(goalId: string, outcome: KioskOutcome): KioskFinishPlan {
  return {
    clearPendingDraft: outcome !== 'unresolved',
    signOut: true,
    notice: outcome === 'unresolved' ? KIOSK_UNRESOLVED_NOTICE : null,
    returnTo: kioskStartRoute(goalId),
  };
}

export type KioskFinishDeps = {
  /** firebase signOut, injected so the rule can be tested without auth. */
  signOut: () => Promise<void>;
  /** src/pendingContribution.ts `clearPendingIfAttempt` — the guarded clear
   * that refuses when the stored record is a DIFFERENT attempt. */
  clearPendingIfAttempt: (goalId: string, uid: string, attemptId: string) => boolean;
  /** Removes this feature's own storage keys. */
  clearKioskKeys: () => void;
};

export type KioskFinishInput = {
  goalId: string;
  outcome: KioskOutcome;
  /** The account signed in at the kiosk, if any. */
  uid: string | null;
  /** The attempt this session made, if any. */
  attemptId: string | null;
};

export type KioskFinishOutcome = KioskFinishPlan & {
  /** True only when a stored record was actually removed. */
  clearedPendingDraft: boolean;
  /** True when sign-out completed. False means the visitor must be told the
   * device did not finish, rather than shown a start screen that lies. */
  signedOut: boolean;
};

/**
 * Perform the Finish. Order matters:
 *
 * 1. The draft first, because clearing it needs the uid that is about to go.
 * 2. Kiosk keys second — they are ours and nothing else reads them.
 * 3. Sign-out LAST, and its failure is reported rather than swallowed. A
 *    kiosk that returned to its start screen while still signed in would
 *    hand the next visitor the previous visitor's account.
 */
export async function runKioskFinish(
  input: KioskFinishInput,
  deps: KioskFinishDeps
): Promise<KioskFinishOutcome> {
  const plan = kioskFinishPlan(input.goalId, input.outcome);
  let clearedPendingDraft = false;
  if (plan.clearPendingDraft && input.uid && input.attemptId) {
    try {
      clearedPendingDraft = deps.clearPendingIfAttempt(input.goalId, input.uid, input.attemptId);
    } catch {
      clearedPendingDraft = false;
    }
  }
  try {
    deps.clearKioskKeys();
  } catch {
    // best-effort; the keys are inert to every other surface.
  }
  let signedOut = false;
  try {
    await deps.signOut();
    signedOut = true;
  } catch {
    signedOut = false;
  }
  return { ...plan, clearedPendingDraft, signedOut };
}
