/**
 * Device mode — whose screen is this, asked once and answered by the person
 * holding it.
 *
 * WHY THIS EXISTS. Two very different people scan the SAME QR on the screen in
 * the room: one is holding their own phone, and one is standing at a shared
 * device the venue put out. The link is identical, the browser is identical,
 * and nothing in the request tells them apart. Only the person knows, so the
 * person is asked — in one plain sentence, before an account is signed in or
 * created.
 *
 * WHAT EACH ANSWER MEANS, MECHANICALLY:
 *
 *   - `personal` — the ordinary path, unchanged in every respect. The visitor
 *     signs in and STAYS signed in, exactly as they would anywhere else in the
 *     app. Nothing about this module touches that path beyond letting it run.
 *   - `shared`   — the visitor is handed to `/kiosk/<goalId>`, the route that
 *     ALREADY implements a shared-device session: it signs the device out
 *     whenever it comes to rest on its start screen, its contribution flow
 *     carries Finish and the idle countdown, and its Finish clears the kiosk's
 *     own keys and signs out. This module builds that address with
 *     `kioskStartRoute` and does nothing else — there is exactly one shared
 *     session implementation in this app and it is not here.
 *
 * WHAT IS STORED, AND WHERE. One of two literal words, in this browser's
 * localStorage, under one key. It is a fact about a DEVICE, not about a
 * person: no uid, no name, no goal, no time, nothing that could identify
 * anybody, and it is never sent to a server or put in a URL. Nothing is
 * collected about anyone by asking this question.
 *
 * WHY localStorage AND NOT sessionStorage. Same reasoning as the station
 * credential in src/stationSession.ts, and the opposite of the kiosk return
 * goal in src/kioskSession.ts: what the answer identifies is the SCREEN, which
 * is still the same screen after a reload, a blanking and a browser restart,
 * and an expo is a long day. A shared device that forgot its own answer would
 * ask the next walk-up all over again; worse, a tab restored on a shared
 * device would default to the personal path.
 */

import { kioskStartRoute } from './kioskSession';

export type DeviceMode = 'personal' | 'shared';

/** The one browser-storage key this feature owns. */
export const DEVICE_MODE_KEY = 'wsf.deviceMode';

/** Both answers, in the order they are offered. There is no third. */
export const DEVICE_MODES = ['personal', 'shared'] as const;

export function isDeviceMode(value: unknown): value is DeviceMode {
  return value === 'personal' || value === 'shared';
}

function store(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    // Private browsing, a locked-down UA, or storage disabled entirely. The
    // question is simply asked again, which is the honest state for a device
    // that cannot remember its own answer.
    return null;
  }
}

/**
 * The answer this device has given, or null if it has not been asked — or
 * gave an answer this build no longer recognises, which is treated as no
 * answer rather than guessed at.
 */
export function readDeviceMode(): DeviceMode | null {
  try {
    const raw = store()?.getItem(DEVICE_MODE_KEY);
    return isDeviceMode(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Remember the answer. Returns whether it was actually remembered, because a
 * browser that refuses storage must not be told it succeeded: the caller still
 * acts on the answer it was just given, it simply has to ask again next time.
 */
export function saveDeviceMode(mode: DeviceMode): boolean {
  if (!isDeviceMode(mode)) return false;
  try {
    const storage = store();
    if (!storage) return false;
    storage.setItem(DEVICE_MODE_KEY, mode);
    return true;
  } catch {
    return false;
  }
}

/** Forget it, so the question is asked again. The one way back for a phone
 * that answered "shared" by mistake. */
export function clearDeviceMode(): void {
  try {
    store()?.removeItem(DEVICE_MODE_KEY);
  } catch {
    // ignore: nothing else reads this key.
  }
}

/** The shapes goal ids take here, and the same refusal, as every other stored
 * or routed id in this app: nothing that could become a path of its own. */
function isGoalIdShape(goalId: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(goalId);
}

/**
 * What a screen scanned into an event should do before it does anything else.
 *
 * - `ask`      — put the question on screen. Nothing has been signed in, no
 *                account has been created, and no server call has been made.
 * - `personal` — carry on with the ordinary path, exactly as before.
 * - `shared`   — hand off to `route`, which is always the EXISTING kiosk start
 *                screen for this goal.
 */
export type DeviceEntry =
  | { kind: 'ask' }
  | { kind: 'personal' }
  | { kind: 'shared'; route: string };

export function decideDeviceEntry(opts: {
  mode: DeviceMode | null;
  goalId: string | null | undefined;
}): DeviceEntry {
  const goalId = typeof opts.goalId === 'string' ? opts.goalId.trim() : '';
  // NO USABLE GOAL, SO NO SHARED SESSION TO HAND OFF TO. There is no kiosk
  // address to build, so there is nothing to offer and nothing to ask: the
  // ordinary path runs and shows its own answer for a goal it cannot load.
  // This should be unreachable from a QR — the links are built from a real
  // goal id by src/ui/eventLinks.ts — which is exactly why it is written down
  // rather than left to an `undefined` route string.
  if (!goalId || !isGoalIdShape(goalId)) return { kind: 'personal' };
  if (opts.mode === 'shared') return { kind: 'shared', route: kioskStartRoute(goalId) };
  if (opts.mode === 'personal') return { kind: 'personal' };
  return { kind: 'ask' };
}

// ---- the words on screen ----------------------------------------------------
//
// Here rather than in the component so the spec and the UI read the same
// literals, and so a copy change cannot pass silently.

export const DEVICE_CHOICE_HEADING = 'Whose screen is this?';
export const DEVICE_CHOICE_INTRO = 'It changes what happens when you’re finished.';

export const DEVICE_CHOICE_PERSONAL_LABEL = 'My own phone';
export const DEVICE_CHOICE_PERSONAL_DESCRIPTION =
  'You stay signed in, exactly as you would anywhere else.';

export const DEVICE_CHOICE_SHARED_LABEL = 'A shared screen here';
export const DEVICE_CHOICE_SHARED_DESCRIPTION =
  'You sign in, add your part, and finish. Nothing about you stays on this screen.';

/** The same option, on the page where the next step would be creating an
 * account. It says what will NOT happen, before the tap. */
export const DEVICE_CHOICE_SHARED_DESCRIPTION_SIGNUP =
  'We won’t make an account on a screen other people use. You’ll go to that screen’s own page instead.';

export const DEVICE_CHOICE_NOTE =
  'Your answer is remembered on this device only. It says nothing about you and is never sent anywhere.';

export const DEVICE_SHARED_TITLE = 'This is a shared screen';
export const DEVICE_SHARED_BODY =
  'Add your part here, then finish. Nothing about you stays on this screen.';
export const DEVICE_SHARED_CONTINUE = 'Add your part on this screen';
export const DEVICE_SHARED_RESET = 'This is my own phone';
