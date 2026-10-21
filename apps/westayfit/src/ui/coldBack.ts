import { SIGNED_OUT_HOME_RESET } from './signOutReset';

/**
 * INT-28 (W12-14) — ANDROID BACK FROM A COLD LINK GOES HOME, NOT OUT OF THE APP.
 *
 * A westayfit:// link (a join, a marker, Settings, a contribution) opened with
 * the app closed starts the root stack with that one route and nothing under
 * it, so Android Back left the app. The root layout's listener asks one
 * question: is the root stack one lone route a member reaches from Home? Then
 * it is reset to (tabs)/Home (the same RESET as the signed-out reset,
 * src/ui/signOutReset.ts) and the press is consumed. Anything else is passed
 * on: the venue and kiosk surfaces (kiosk, station, display, queue, event,
 * combined), the sign-in gates that route on by themselves (verify-email,
 * profile-setup), the tabs themselves, and any deeper stack.
 * Never a change to initialRouteName.
 *
 * THE ORDER, AS IT REALLY IS (RV13-641-F2). expo-router's navigation
 * container registers its Back listener a commit before the root layout
 * mounts, and Android calls the newest listener first, so this listener is
 * called BEFORE React Navigation's own Back. That is safe because it consumes
 * only a lone allowlisted leaf route, which React Navigation cannot pop; any
 * deeper stack is passed on, and React Navigation goes back. Screen handlers
 * registered through expo-router's useFocusEffect (INT-19 on the contribution
 * screen) register after both, so they still run first.
 */

/** The root routes a member reaches from Home, by their expo-router names. */
export const COLD_BACK_ROUTES: ReadonlySet<string> = new Set([
  'join/[joinCode]',
  'go/[markerSlug]',
  'settings',
  'settings/privacy',
  'signin',
  'signup',
  'reset-password',
  'start-community',
  'goals/new',
  'move/index',
  'contribute/[goalId]',
]);

type NavState = {
  key?: string;
  index?: number;
  routes?: ReadonlyArray<{ name: string; params?: object; state?: NavState }>;
};
export type ColdBackRootState = NavState | null | undefined;

/** expo-router renders the root layout as the one screen of an internal navigator, named this. */
const ROOT_SLOT = '__root';

/**
 * The app's root Stack (the one app/_layout.tsx renders): inside expo-router's
 * internal root slot when that navigator's state is given (what the root
 * layout's own navigation object reports), or the state itself when it
 * already is that Stack's.
 */
export function appRootState(rootState: ColdBackRootState): NavState | null {
  const routes = rootState?.routes ?? [];
  if (routes.length === 1 && routes[0]!.name === ROOT_SLOT) return routes[0]!.state ?? null;
  return rootState ?? null;
}

/** The reset to Home for a lone, allowlisted root route; null otherwise. Pure. */
export function coldBackReset(rootState: ColdBackRootState): typeof SIGNED_OUT_HOME_RESET | null {
  const routes = appRootState(rootState)?.routes ?? [];
  if (routes.length !== 1) return null;
  const route = routes[0]!;
  if (!COLD_BACK_ROUTES.has(route.name)) return null;
  // A kiosk's contribution belongs to the kiosk, never to member Home.
  const params = (route.params ?? {}) as { kiosk?: unknown };
  if (route.name === 'contribute/[goalId]' && params.kiosk !== undefined && params.kiosk !== null && params.kiosk !== '') return null;
  return SIGNED_OUT_HOME_RESET;
}

export type ColdBackAction = typeof SIGNED_OUT_HOME_RESET & { target: string };

/**
 * The hardwareBackPress handler, given the root layout's navigation object
 * (its screen in expo-router's internal root navigator): resets a lone
 * allowlisted root route to Home (the RESET addressed to the app's root
 * Stack by its state key, which React Navigation hands down to that child
 * navigator) and consumes the press; otherwise passes it on (returns false)
 * to the next listener, React Navigation's, and then Android. Nothing while
 * the Stack's state has no key yet.
 */
export function coldBackHandler(navigation: {
  getState: () => ColdBackRootState;
  dispatch: (action: ColdBackAction) => void;
}): () => boolean {
  return () => {
    const rootState = navigation.getState();
    const reset = coldBackReset(rootState);
    const target = appRootState(rootState)?.key;
    if (!reset || !target) return false;
    navigation.dispatch({ ...reset, target });
    return true;
  };
}
