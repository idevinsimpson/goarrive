import { useFocusEffect } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * ROUTE-SCOPED ACTIONS IN THE PERSISTENT MENU.
 *
 * WHY THIS EXISTS. Community Home carried its own chrome row for one control,
 * Manage. Under a persistent top bar that row is a second masthead: a Champion
 * paid for two rows where a member pays for one, and the goal hero fell out of
 * the 220px product-area budget because of it. The Director's ruling is that
 * the TRIGGER moves into the bar's existing menu and the row goes — a
 * relocation, not a management redesign.
 *
 * WHAT IT IS NOT. It is not a second Manage implementation, and it does not
 * hold the sheet's state. The screen keeps its sheet, its state and its
 * behaviour exactly as they were; all that travels through here is a label and
 * a callback that flips the screen's own `manageOpen`.
 *
 * THE STALE-ACTION RULE IS THE WHOLE DESIGN. The tabs stay mounted on purpose,
 * so "the screen is mounted" is NOT the same question as "the member is
 * looking at it": a community detail sitting mounted under the Progress tab
 * would otherwise keep offering Manage from a screen nobody is on. So
 * registration is tied to FOCUS, through `useFocusEffect` — it happens when
 * the screen becomes focused and is undone when it blurs, on a tab switch, a
 * push, or an unmount. A `scope` string (the account and the community) tears
 * the registration down and rebuilds it when either changes, and the provider
 * empties itself outright when the account does, so nothing can outlive the
 * thing that registered it.
 */
export type MemberShellAction = {
  /** Stable across communities: it names the KIND of action, and the testID. */
  key: string;
  label: string;
  onPress: () => void;
};

type Registry = {
  actions: readonly MemberShellAction[];
  register: (action: MemberShellAction) => () => void;
};

const EMPTY: readonly MemberShellAction[] = [];

const MemberShellActionsContext = createContext<Registry | null>(null);

export function MemberShellActionsProvider({
  ownerUid,
  children,
}: {
  /** Whose shell this is. A change empties the registry before anything else. */
  ownerUid: string | null;
  children: ReactNode;
}) {
  const [actions, setActions] = useState<readonly MemberShellAction[]>(EMPTY);

  useEffect(() => {
    setActions(EMPTY);
  }, [ownerUid]);

  const register = useCallback((action: MemberShellAction) => {
    setActions((prev) => [...prev.filter((a) => a.key !== action.key), action]);
    return () => setActions((prev) => prev.filter((a) => a.key !== action.key));
  }, []);

  const value = useMemo<Registry>(() => ({ actions, register }), [actions, register]);
  return (
    <MemberShellActionsContext.Provider value={value}>{children}</MemberShellActionsContext.Provider>
  );
}

/** What the shell should offer for the screen the member is actually on. */
export function useMemberShellActions(): readonly MemberShellAction[] {
  return useContext(MemberShellActionsContext)?.actions ?? EMPTY;
}

/**
 * Offer `action` in the member shell's menu for as long as THIS screen is the
 * focused one. `null` offers nothing, which is how a screen says "not for this
 * member" without a second code path.
 *
 * `scope` is not shown anywhere: it is the identity of what the action belongs
 * to — the account and the community — so that changing either unregisters the
 * old action before the new one exists.
 */
export function useMemberShellAction(action: MemberShellAction | null, scope: string): void {
  const registry = useContext(MemberShellActionsContext);
  const register = registry?.register;

  // The callback is read through a ref so a re-render with a new closure does
  // not churn the registration, and so the action can never fire an older
  // render's handler.
  const latest = useRef(action);
  latest.current = action;

  const key = action?.key ?? null;
  const label = action?.label ?? null;

  useFocusEffect(
    useCallback(() => {
      if (!register || !key || !label) return undefined;
      return register({ key, label, onPress: () => latest.current?.onPress() });
    }, [register, key, label, scope]),
  );
}
