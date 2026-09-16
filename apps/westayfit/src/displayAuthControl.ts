/**
 * The display-permission control's operation state, and the rules that govern
 * it. Pure, so the properties below are tested directly rather than inferred
 * from what a screen happens to render.
 *
 * TWO THINGS LIVE HERE, for the same reason.
 *
 * The value a retry sends. Whenever a retry is offered, the card happens to be
 * showing the negation of the value that was asked for, so "send the intended
 * value" and "send the inverse of what the card shows" compute the same answer
 * and a defect in that choice is invisible from the screen. That coincidence
 * is a property of today's screen, not of the rule; the moment the goal list
 * can refresh on its own the two diverge and inverting undoes a request that
 * succeeded.
 *
 * Which operations may still change the screen. One shared slot for every goal
 * card meant starting an action on goal B erased goal A's unresolved outcome —
 * its warning, its intended retry value, and the disabled state of its control
 * — while A's request was still in flight. Outcomes are per goal and survive
 * until they are settled or explicitly dismissed.
 *
 * GENERATION, not just uid and groupId. Comparing account and community alone
 * cannot tell A → B → A apart from never having left A, nor leaving and
 * returning. A generation counter can: it increases every time the context is
 * (re-)established, so an operation started in an earlier visit is recognisably
 * not the current one even when the account and community match exactly.
 */

export type DisplayAuthOutcome =
  | { kind: 'saving'; intended: boolean; title: string }
  | { kind: 'unconfirmed'; intended: boolean; title: string }
  | { kind: 'failed'; intended: boolean; title: string }
  | { kind: 'confirmed'; intended: boolean; title: string };

/** An outcome that still has something to say and offers a retry. */
export type UnsettledDisplayAuth =
  | { kind: 'unconfirmed'; intended: boolean; title: string }
  | { kind: 'failed'; intended: boolean; title: string };

export type DisplayAuthState = {
  /** Increases whenever the account or community context is (re-)established. */
  generation: number;
  /** Keyed by goalId. Absent means nothing is outstanding for that goal. */
  byGoal: Record<string, DisplayAuthOutcome>;
};

/** A started operation's identity. It is stale unless all three still match. */
export type OperationScope = {
  generation: number;
  groupId: string;
  uid: string | null;
  goalId: string;
};

export const initialDisplayAuthState: DisplayAuthState = { generation: 0, byGoal: {} };

/**
 * A new account/community context. Every outcome from the previous context is
 * dropped — a permission message or confirmation about another community must
 * never survive the move — and the generation advances so nothing outstanding
 * from the old context can write here again.
 */
export function beginContext(state: DisplayAuthState): DisplayAuthState {
  return { generation: state.generation + 1, byGoal: {} };
}

/** True when this operation is still the current context's. */
export function operationIsCurrent(
  state: DisplayAuthState,
  scope: OperationScope,
  current: { groupId: string; uid: string | null }
): boolean {
  return (
    scope.generation === state.generation &&
    scope.groupId === current.groupId &&
    scope.uid === current.uid
  );
}

/** Mark one goal as saving. Every other goal's outcome is left exactly as it is. */
export function startOperation(
  state: DisplayAuthState,
  scope: OperationScope,
  intended: boolean,
  title: string
): DisplayAuthState {
  if (scope.generation !== state.generation) return state;
  return {
    generation: state.generation,
    byGoal: { ...state.byGoal, [scope.goalId]: { kind: 'saving', intended, title } },
  };
}

/**
 * Record an operation's outcome against its own goal only.
 *
 * A result from a superseded generation is discarded rather than applied: it
 * belongs to a context the screen has left, and applying it would resurrect an
 * old operation or overwrite a newer one.
 */
export function settleOperation(
  state: DisplayAuthState,
  scope: OperationScope,
  outcome: DisplayAuthOutcome
): DisplayAuthState {
  if (scope.generation !== state.generation) return state;
  return {
    generation: state.generation,
    byGoal: { ...state.byGoal, [scope.goalId]: outcome },
  };
}

/** Explicitly abandon one goal's outcome. The only way an unresolved outcome
 *  leaves the screen other than being settled. */
export function dismissOutcome(state: DisplayAuthState, goalId: string): DisplayAuthState {
  if (!(goalId in state.byGoal)) return state;
  const byGoal = { ...state.byGoal };
  delete byGoal[goalId];
  return { generation: state.generation, byGoal };
}

export function outcomeFor(state: DisplayAuthState, goalId: string): DisplayAuthOutcome | null {
  return state.byGoal[goalId] ?? null;
}

/** The unsettled outcome for this goal, or null. Scoped by goalId so one
 *  goal's pending state never appears on another goal's card. */
export function unsettledFor(
  state: DisplayAuthState,
  goalId: string
): UnsettledDisplayAuth | null {
  const outcome = state.byGoal[goalId];
  if (!outcome) return null;
  if (outcome.kind !== 'unconfirmed' && outcome.kind !== 'failed') return null;
  return outcome;
}

/** Confirmed outcomes whose goal is no longer in the list. Revoking on a closed
 *  goal removes the only thing keeping it there, so the card that would have
 *  reported the success is gone at the moment it succeeds. */
export function confirmedButAbsent(
  state: DisplayAuthState,
  listedGoalIds: readonly string[]
): { goalId: string; intended: boolean; title: string }[] {
  const listed = new Set(listedGoalIds);
  return Object.entries(state.byGoal)
    .filter(([goalId, o]) => o.kind === 'confirmed' && !listed.has(goalId))
    .map(([goalId, o]) => ({ goalId, intended: o.intended, title: o.title }));
}

/**
 * The explicit value the control sends.
 *
 * With nothing unsettled it is a toggle of the permission currently shown.
 * With something unsettled it is the value that was ASKED FOR, carried through
 * unchanged — never re-derived from the card, whose value may be stale,
 * already equal to the intended one, or both.
 */
export function displayAuthValueToSend(
  unsettled: UnsettledDisplayAuth | null,
  currentlyAuthorized: boolean
): boolean {
  if (unsettled) return unsettled.intended;
  return !currentlyAuthorized;
}
