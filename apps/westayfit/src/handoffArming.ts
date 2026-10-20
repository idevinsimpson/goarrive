/**
 * ARMING A POST-AUTH DESTINATION ON A SHARED OR WALK-UP SCREEN (NATIVE-STATE-2).
 *
 * The terminal auth hop routes by a fixed precedence (src/pendingJoinCode.ts
 * `nextRouteAfterAuth`): join code, then event return, then kiosk return,
 * then marker return. A fixed order is only right if nothing stale sits above
 * the destination somebody has just armed. On web a stale record lives as
 * long as the tab; on a phone it lives for up to two hours across app kills
 * (src/storage/sessionKv.native.ts) — so a visitor who taps Contribute on a
 * kiosk could otherwise be routed to an event return an earlier visitor
 * abandoned, onto the personal event screen, where Finish is never offered.
 *
 * So the sites that arm the LOWER-ranked destinations clear every competing
 * one when they arm their own, and a shared screen at rest clears them all.
 * (The two higher-ranked ones need no such step: a join code outranks
 * everything, and the event screen hands a shared device to the kiosk before
 * it arms anything — src/deviceMode.ts.)
 *
 * Every clear and the arming write are ISSUED together and synchronously, so
 * on web the new destination is in sessionStorage the moment this returns,
 * exactly as when the screens called `set*` directly.
 */
import { clearEventReturn } from './eventReturn';
import { clearKioskReturnGoal, setKioskReturnGoal } from './kioskSession';
import { clearMarkerReturn, setMarkerReturn } from './markerEntry';
import { clearPendingJoinCode } from './pendingJoinCode';

/**
 * The kiosk's Contribute: its return is THE destination now. Unowned on
 * purpose — the kiosk start screen is signed out by design, so the return is
 * the handoff for the visitor about to sign in. Resolves whether the device
 * kept the kiosk return.
 */
export function armKioskReturn(goalId: string): Promise<boolean> {
  const cleared = [clearPendingJoinCode(), clearEventReturn(), clearMarkerReturn()];
  const armed = setKioskReturnGoal(goalId, null);
  return Promise.all([armed, ...cleared]).then(([kept]) => kept);
}

/**
 * A printed marker's return, on the way into an identity step. Owned by the
 * account looking at the marker (null: signed out, the handoff for whoever
 * signs in next). Resolves whether the device kept it.
 */
export function armMarkerReturn(slug: string, uid: string | null, now: number = Date.now()): Promise<boolean> {
  const cleared = [clearPendingJoinCode(), clearEventReturn(), clearKioskReturnGoal()];
  const armed = setMarkerReturn(slug, now, uid);
  return Promise.all([armed, ...cleared]).then(([kept]) => kept);
}

/**
 * A shared screen has come to rest: nothing an earlier visitor armed may
 * route the next one. Resolves whether every clear was kept.
 */
export function resetSharedScreenHandoffs(): Promise<boolean> {
  return Promise.all([clearPendingJoinCode(), clearEventReturn(), clearMarkerReturn(), clearKioskReturnGoal()]).then(
    (results) => results.every(Boolean)
  );
}
