/**
 * Movement selection — which movements a goal can be built from, and how one
 * or several of them map onto the goal contracts that already exist.
 *
 * Kept out of the route module for the same reason as `combinedSetup.ts`: the
 * rules that most need testing live here as plain functions, and the picker
 * component (`src/ui/MovementPicker.tsx`) and any screen that mounts it read
 * the same answers.
 *
 * WHAT "SUPPORTED" MEANS. A movement is listed here only when the app already
 * ships a counting guide for it in `activityGuides.ts`. The catalog never
 * promises guidance that does not exist, and it is never inferred from a
 * free-text unit: a Champion who types "burpees" keeps typing it, exactly as
 * before, and gets the generic guide the contribution screen already gives.
 *
 * THE CONTRACT RULE. Nothing here calls anything. It decides which EXISTING
 * callable payload a selection becomes, or that it becomes none:
 *
 *   • one movement             → one `wsfCreateGoal`, the movement's own unit and
 *                                its own counting guide (`activityGuideKey`);
 *   • several movements        → NOT SUBMITTABLE today. The existing contract has
 *                                no field that keeps more than one movement: a
 *                                joined unit, a title or one generic guide key
 *                                would be a string pretending to be persisted
 *                                multi-movement support (Director #456
 *                                `5834379218`). The picker can still hold several
 *                                for the screen that will support them; the
 *                                mapping refuses to turn them into a payload.
 *   • movements counted        → refused as well, and said so first: repetitions,
 *     differently                steps and laps are never added together.
 *
 * THE SEAM THIS NEEDS is proposed for review in
 * docs/design-target/review/movement-pills-1/README.md ("Proposed seam"):
 * validated movement ids stored on the goal, read back on reload, chosen in
 * MOVE with that movement's own guide, and recorded per contribution. Nothing
 * of it is built here.
 */

import { ACTIVITY_GUIDES } from './activityGuides';

/** How one of a movement is counted. Different kinds are never added. */
export type CountKind = 'repetitions' | 'steps' | 'laps';

export type MovementKey = 'squats' | 'push-ups' | 'sit-ups' | 'steps' | 'laps';

export type Movement = {
  key: MovementKey;
  /** The pill's words. */
  label: string;
  /** What the goal records as its unit when this is the only movement. */
  unit: string;
  /** One of it, for the review sentence: "every squat". */
  one: string;
  countKind: CountKind;
};

/**
 * In the order the pills are drawn. A selection is always reported in THIS
 * order, never in tap order, so the same choice always produces the same unit.
 */
export const MOVEMENTS: readonly Movement[] = [
  { key: 'squats', label: 'Squats', unit: 'squats', one: 'squat', countKind: 'repetitions' },
  { key: 'push-ups', label: 'Push-ups', unit: 'push-ups', one: 'push-up', countKind: 'repetitions' },
  { key: 'sit-ups', label: 'Sit-ups', unit: 'sit-ups', one: 'sit-up', countKind: 'repetitions' },
  { key: 'steps', label: 'Steps', unit: 'steps', one: 'step', countKind: 'steps' },
  { key: 'laps', label: 'Laps', unit: 'laps', one: 'lap', countKind: 'laps' },
];

/** The server's own limit on a goal's unit (`normalizeGoalUnit`). */
export const UNIT_MAX_LENGTH = 40;

const BY_KEY: ReadonlyMap<string, Movement> = new Map(MOVEMENTS.map((m) => [m.key, m]));

export function isMovementKey(v: unknown): v is MovementKey {
  return typeof v === 'string' && BY_KEY.has(v);
}

/** Known keys only, each once, in catalog order. Anything else is dropped. */
export function normalizeSelection(keys: readonly unknown[]): MovementKey[] {
  const chosen = new Set(keys.filter(isMovementKey));
  return MOVEMENTS.filter((m) => chosen.has(m.key)).map((m) => m.key);
}

/** Pressing a pill: on if it was off, off if it was on. Never a duplicate. */
export function toggleMovement(keys: readonly MovementKey[], key: MovementKey): MovementKey[] {
  const current = normalizeSelection(keys);
  return current.includes(key)
    ? current.filter((k) => k !== key)
    : normalizeSelection([...current, key]);
}

export type SelectionContract =
  /** Nothing picked: the form's own free-text unit decides, as it always has. */
  | { kind: 'none' }
  /** Maps onto one `wsfCreateGoal` call. */
  | {
      kind: 'individual';
      movements: [MovementKey];
      unit: string;
      activityGuideKey: string;
      /** The review's sentence about how the count works. */
      countSentence: string;
    }
  /** Counted differently: no payload, and the sentence that says why. */
  | { kind: 'mixed'; movements: MovementKey[]; kinds: CountKind[]; message: string }
  /**
   * Several movements counted the same way: no payload. The existing goal
   * contract cannot keep them, so nothing is sent until the reviewed seam
   * exists.
   */
  | { kind: 'several'; movements: MovementKey[]; message: string };

function listInWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/**
 * The one decision the form makes before it lets a Champion submit.
 * Pure: the same selection always gives the same answer.
 */
export function mapMovementSelection(keys: readonly unknown[]): SelectionContract {
  const movements = normalizeSelection(keys).map((k) => BY_KEY.get(k)!);
  if (movements.length === 0) return { kind: 'none' };

  const kinds = [...new Set(movements.map((m) => m.countKind))];
  if (kinds.length > 1) {
    return {
      kind: 'mixed',
      movements: movements.map((m) => m.key),
      kinds,
      message: `${capitalize(listInWords(movements.map((m) => m.unit)))} are counted differently, so they can’t share one total. Choose one movement.`,
    };
  }

  if (movements.length === 1) {
    const only = movements[0]!;
    return {
      kind: 'individual',
      movements: [only.key],
      unit: only.unit,
      activityGuideKey: only.key,
      countSentence: `Every ${only.one} counts once.`,
    };
  }

  return {
    kind: 'several',
    movements: movements.map((m) => m.key),
    message: 'A goal with several movements can’t be started yet. Choose one movement.',
  };
}

/** Only an `individual` answer may be submitted. */
export function isSubmittable(c: SelectionContract): c is Extract<SelectionContract, { kind: 'individual' }> {
  return c.kind === 'individual';
}

/** Every catalog movement has a real counting guide; asserted by the tests. */
export function hasCountingGuide(key: MovementKey): boolean {
  return Object.prototype.hasOwnProperty.call(ACTIVITY_GUIDES, key);
}
