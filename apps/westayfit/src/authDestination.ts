import { readEventReturn } from './eventReturn';
import { readKioskReturnGoal } from './kioskSession';
import { readPendingJoinCode } from './pendingJoinCode';

/**
 * THE DESTINATION A GATE IS CARRYING, AS A KIND — NEVER AS A NAME.
 *
 * `nextRouteAfterAuth` resolves three destinations, and the identity screens
 * want to SAY which one is waiting so a member knows the round trip has not
 * been lost. But a pending join code is opaque and a pending event is a goal
 * id: naming the community or the goal needs a read a signed-out visitor may
 * not be entitled to make.
 *
 * So this reports the KIND and what will happen, which is true from session
 * storage alone and discloses nothing about a community the reader has not
 * been authorized to see. The order matches `nextRouteAfterAuth` exactly; if
 * these two ever disagree, a screen promises one destination and the router
 * delivers another.
 *
 * This READS only. Resolution and consumption stay in `nextRouteAfterAuth`,
 * on the terminal hop.
 */
export type AuthDestinationKind = 'join' | 'event' | 'kiosk';

export function readAuthDestinationKind(): AuthDestinationKind | null {
  if (readPendingJoinCode()) return 'join';
  if (readEventReturn()) return 'event';
  if (readKioskReturnGoal()) return 'kiosk';
  return null;
}

type Card = { label: string; line: string; note: string };

/**
 * `waiting` is the copy for a gate the member has just arrived at; `still` is
 * for a later gate in the same run, where the point is that it is STILL there
 * several steps on.
 */
export function authDestinationCard(
  kind: AuthDestinationKind,
  stage: 'waiting' | 'still' = 'waiting'
): Card {
  const label = stage === 'still' ? 'Still waiting for you' : 'Waiting for you';
  switch (kind) {
    case 'join':
      return {
        label,
        line: 'An invitation to a community',
        note:
          stage === 'still'
            ? 'This is the last step before it opens.'
            : 'You opened an invitation before signing in. It is still here.',
      };
    case 'event':
      return {
        label,
        line: 'The event you scanned',
        note:
          stage === 'still'
            ? 'This is the last step before it opens.'
            : 'You scanned a code before signing in. You will land back on it, not on home.',
      };
    case 'kiosk':
      return {
        label,
        line: 'The screen you started at',
        note:
          stage === 'still'
            ? 'This is the last step before it opens.'
            : // THE ONE THE WORDING MATTERS MOST FOR. The person is standing at
              // a shared device, and what they most need to know is that
              // finishing here does not leave them signed in on it.
              'You will land back on it to enter your count. Finishing signs you out of this device.',
      };
  }
}

/** The heading a gate uses when it is carrying a destination. */
export function authReturnHeading(kind: AuthDestinationKind): {
  heading: string;
  intro: string;
} {
  if (kind === 'join') {
    return {
      heading: 'Welcome back.',
      intro: 'Sign in and we will take you straight back to the invitation.',
    };
  }
  if (kind === 'event') {
    return {
      heading: 'Nearly there.',
      intro: 'Sign in and we will take you straight back to the event you scanned.',
    };
  }
  return {
    heading: 'Nearly there.',
    intro: 'Sign in and we will take you straight back to the screen you started at.',
  };
}
