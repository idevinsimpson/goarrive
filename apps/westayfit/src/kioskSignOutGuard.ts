/**
 * NATIVE-MEMBER-1 F-4 (MF-08 interim). THE KIOSK START SCREEN DOES NOT SIGN A
 * PHONE'S OWNER OUT WITHOUT ASKING.
 *
 * The kiosk start screen is a signed-out screen: an account still attached
 * when it comes to rest is a visitor who left without Finish, and on a shared
 * venue device the account must go before the next person arrives. That is
 * right for the browser at an event, and it stays exactly as it is on the web.
 *
 * In the app the same route can open on a Champion's or member's OWN phone
 * (a `westayfit://kiosk/<goalId>` link, the event screen's shared-device
 * answer), where silently ending their session is the bug MF-08 describes.
 * Until the kiosk session itself is durable on native (ST-05), the app tells
 * the two apart by the one fact it has: did the account arrive through THIS
 * kiosk's own "Contribute" hand-off in this process? Then it is a kiosk
 * visitor and goes, as on the web. Otherwise the screen asks first.
 *
 * The note lives in memory only and holds no account id and nothing about
 * anybody: just which kiosk handed off, and when. It counts only
 *   · back at the start screen of THE SAME goal, and
 *   · within KIOSK_HANDOFF_TTL_MS of the Contribute press,
 * and it is spent on the next arrival at any kiosk start screen. So a
 * visitor who taps Contribute and then ends up somewhere else (in the app,
 * after sign-in, ST-05 lands them on member Home, not back here) leaves no
 * note that could later skip the question for an account opening another
 * kiosk link, or the same one long after.
 *
 * heads-10 C7-1. THE NOTE DIES WITH THE PROCESS; THE KIOSK SESSION DOES NOT.
 * When the OS kills a phone mid-session (verify-email, /contribute?kiosk=1),
 * the launch guard brings it back to this start screen with the visitor still
 * signed in (state's durable marker, src/kioskSession.ts). The memory note is
 * gone, so it used to ask, and "Stay signed in" left the previous visitor on
 * member Home (ST-05 case 5). An open kiosk-session marker for THIS goal is
 * now kiosk evidence in its own right: the device says a kiosk session is
 * open here, so whoever is signed in is its visitor and goes, without asking.
 * A marker for another goal is no evidence (the screen asks), and the web
 * never has one (readKioskSession is null there).
 */

/**
 * 15 minutes: a walk-up sign-in (or new account) and one self-counted entry.
 * Past that the account at the start screen is no longer clearly the visitor
 * this kiosk handed off, and the screen asks. Asking is the safe failure: a
 * confirmation, never a silent sign-out.
 */
export const KIOSK_HANDOFF_TTL_MS = 15 * 60 * 1000;

let handoff: { goalId: string; at: number } | null = null;

/** The start screen's Contribute for `goalId`: an account arriving back here soon is a kiosk visitor. */
export function noteKioskHandoff(goalId: string, now: number = Date.now()): void {
  handoff = { goalId, at: now };
}

export type KioskStartDecision = 'none' | 'signOut' | 'ask';

/**
 * What the start screen for `goalId` does on arrival. Spends the hand-off note.
 *   none     nobody is signed in;
 *   signOut  the web; a visitor who came through this goal's kiosk hand-off
 *            within KIOSK_HANDOFF_TTL_MS; or (C7-1) a device whose open
 *            kiosk-session marker, `openKioskSession` (src/kioskSession.ts
 *            `readKioskSession()`), names this goal;
 *   ask      the app, with any other account: confirm before signing out.
 */
export function decideKioskStart(
  os: string,
  signedIn: boolean,
  goalId: string | null | undefined,
  now: number = Date.now(),
  openKioskSession: string | null = null,
): KioskStartDecision {
  const note = handoff;
  handoff = null;
  if (!signedIn) return 'none';
  if (os === 'web') return 'signOut';
  if (typeof goalId === 'string' && openKioskSession === goalId) return 'signOut';
  const age = note ? now - note.at : -1;
  const visitor = note !== null && typeof goalId === 'string' && note.goalId === goalId && age >= 0 && age <= KIOSK_HANDOFF_TTL_MS;
  return visitor ? 'signOut' : 'ask';
}
