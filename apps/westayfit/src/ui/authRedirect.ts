import { kioskStartRoute, readKioskReturnGoal, readKioskSession } from '../kioskSession';

/**
 * NATIVE-MEMBER-1 W16-7 (MF-16). What Sign in and Create account say on a
 * phone when the already-signed-in redirect could not read the account (no
 * connection): one sentence, shared so the two screens cannot drift. The web
 * keeps its Loading branch (an owner decision).
 */
export const REDIRECT_FAILED_SENTENCE = 'We couldn’t check your account. Check your connection and try again.';

/*
  RV14-642-F1 (heads-12, PRIVACY). THE WAY OUT NEVER TAKES A KIOSK TO HOME.

  The redirect-failed screen's way out was "Back to home": landAfterAuth('/'),
  which on a phone RESETS the root stack to member Home. At a phone kiosk the
  visitor reaches this screen signed in, over the kiosk start screen (the
  contribute gate's Sign in replaces, so the stack is [kiosk/<goal>, signin]).
  The reset wiped the kiosk and left the visitor signed in on member Home on a
  shared device, with no Finish and no 90 s idle sign-out (the ST-05 harm;
  the same class as RV12-641-F1, whose kiosk guard only sees a destination
  string, and '/' is not one).

  So while a kiosk session is open, the way out goes BACK TO THE KIOSK, never
  Home: router.dismissTo(/kiosk/<goal>) pops to the start screen already on the
  stack (or replaces this screen with it when it is not there, React
  Navigation's POP_TO), and the start screen, focused again, signs the visitor
  out: its marker names this goal (C7-1, src/kioskSignOutGuard.ts). The button
  says so instead of promising Home. With no kiosk session nothing changes:
  Home only, as before. The web never shows this screen.

  A kiosk session is open when either record says so: the device's durable
  marker (a phone; it has no expiry) or the kiosk return armed for whoever
  signs in next (two hours; for this account or for nobody in particular).
*/
export const REDIRECT_WAY_OUT_HOME = 'Back to home';
/** New copy (RV14-642-F1), listed for owner wording sign-off. */
export const REDIRECT_WAY_OUT_KIOSK = 'Back to the kiosk';

/** The goal of the kiosk session open on this device for `uid`, or null when there is none. */
export function openKioskGoal(uid: string | null): string | null {
  return readKioskSession() ?? readKioskReturnGoal(uid);
}

export type RedirectWayOutDeps = {
  /** The screen's landing (landAfterAuth): on a phone the root stack reset to Home only. */
  land: (next: string) => void;
  /** router.dismissTo. */
  dismissTo: (href: string) => void;
};

/**
 * The way out, pressed. Read again at the press, and it fails closed: the
 * kiosk the screen showed (`shownKioskGoal`) still counts if the records have
 * since gone quiet, so a button that said "Back to the kiosk" never lands Home.
 */
export function leaveRedirectFailed(
  uid: string | null,
  shownKioskGoal: string | null,
  { land, dismissTo }: RedirectWayOutDeps,
): void {
  const goal = openKioskGoal(uid) ?? shownKioskGoal;
  if (goal) {
    dismissTo(kioskStartRoute(goal));
    return;
  }
  land('/');
}
