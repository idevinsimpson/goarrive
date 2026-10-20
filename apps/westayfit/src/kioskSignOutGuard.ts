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
 * The note lives in memory only and is spent on each arrival at the start
 * screen, so it never outlives the visitor it was made for. It holds no
 * account id and nothing about anybody.
 */

let handedOff = false;

/** The start screen's Contribute: the next account to arrive is a kiosk visitor. */
export function noteKioskHandoff(): void {
  handedOff = true;
}

export type KioskStartDecision = 'none' | 'signOut' | 'ask';

/**
 * What the start screen does on arrival. Spends the hand-off note.
 *   none     nobody is signed in;
 *   signOut  the web, or a visitor who came through this kiosk's hand-off;
 *   ask      the app, with an account that did not: confirm before signing out.
 */
export function decideKioskStart(os: string, signedIn: boolean): KioskStartDecision {
  const visitor = handedOff;
  handedOff = false;
  if (!signedIn) return 'none';
  if (os === 'web' || visitor) return 'signOut';
  return 'ask';
}
