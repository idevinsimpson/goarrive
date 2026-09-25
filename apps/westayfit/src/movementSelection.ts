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
 *   • one movement            → one `wsfCreateGoal`, the movement's own unit and
 *                               its own counting guide;
 *   • several movements that   → still ONE `wsfCreateGoal`: one goal, one total,
 *     are counted the same way   the unit naming every movement chosen and the
 *                               review saying in words that each one counts
 *                               once toward the same total. One write, so no
 *                               child goal can be left behind by a failure;
 *   • movements counted        → nothing. Repetitions, steps and laps are not the
 *     differently                same thing and are never added together. The
 *                               form says why and does not submit.
 *
 * WHAT IS DELIBERATELY NOT HERE. A goal with a separate total per movement AND
 * one combined total (`wsfCreateCombinedGoal`) needs its child goals to exist
 * first. Creating them from this form would be several separate writes with no
 * idempotency key, so a failure part-way could leave some children created and
 * a retry could create them twice. That needs a server contract that creates
 * the children and the combined goal together; it is reported for review, not
 * approximated here.
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

/**
 * The counting guide a goal made of several same-kind movements carries. It
 * is a guide the table already has, phrased for any movement ("Count one rep
 * each time you complete the movement"), so no guide is invented for a mix.
 */
const SHARED_GUIDE_KEY: Readonly<Record<CountKind, string>> = {
  repetitions: 'reps',
  steps: 'steps',
  laps: 'laps',
};

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
      movements: MovementKey[];
      unit: string;
      activityGuideKey: string;
      /** True when several movements share the one total. */
      shared: boolean;
      /** The review's sentence about how the count works. */
      countSentence: string;
    }
  /** Counted differently: no payload, and the sentence that says why. */
  | { kind: 'mixed'; movements: MovementKey[]; kinds: CountKind[]; message: string };

function listInWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/** The unit a same-kind group records: every movement named, within the server's limit. */
function sharedUnit(movements: readonly Movement[]): string {
  const named = movements.map((m) => m.unit).join(' + ');
  if (named.length <= UNIT_MAX_LENGTH) return named;
  // Not reachable with today's catalog (the longest same-kind group is 27
  // characters); kept so a longer catalog degrades to an honest unit rather
  // than one the server refuses.
  return SHARED_GUIDE_KEY[movements[0]!.countKind];
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
      message: `${capitalize(listInWords(movements.map((m) => m.unit)))} are counted differently, so they can’t share one total. Choose movements counted the same way, or start a separate goal for each.`,
    };
  }

  if (movements.length === 1) {
    const only = movements[0]!;
    return {
      kind: 'individual',
      movements: [only.key],
      unit: only.unit,
      activityGuideKey: only.key,
      shared: false,
      countSentence: `Every ${only.one} counts once.`,
    };
  }

  return {
    kind: 'individual',
    movements: movements.map((m) => m.key),
    unit: sharedUnit(movements),
    activityGuideKey: SHARED_GUIDE_KEY[kinds[0]!],
    shared: true,
    countSentence: `Every ${listInWords(movements.map((m) => m.one))} counts once toward the same total.`,
  };
}

/** Every catalog movement has a real counting guide; asserted by the tests. */
export function hasCountingGuide(key: MovementKey): boolean {
  return Object.prototype.hasOwnProperty.call(ACTIVITY_GUIDES, key);
}
