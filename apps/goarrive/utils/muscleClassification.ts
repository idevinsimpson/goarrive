/**
 * muscleClassification.ts — primary/secondary muscle field helpers
 *
 * Movements store three related fields:
 *   - primaryMuscles: 1-3 muscles doing the main work
 *   - secondaryMuscles: assisting/stabilizing muscles
 *   - muscleGroups: union of both (back-compat — legacy readers and
 *     Firestore queries keep working unchanged)
 *
 * Legacy docs only have muscleGroups; those are treated as all-primary.
 */

export interface MuscleFields {
  primaryMuscles: string[];
  secondaryMuscles: string[];
  muscleGroups: string[];
}

/**
 * Reconcile a coach-selected union (the muscle-group picker) against the
 * known primary/secondary split. Removals drop from both lists; manual
 * additions are treated as primary (a coach tagging a muscle means the
 * movement targets it). Legacy docs (empty primary+secondary) resolve to
 * all-primary, matching the filter fallback.
 */
export function reconcileMuscleFields(
  selected: string[],
  primary: string[] = [],
  secondary: string[] = [],
): MuscleFields {
  const sel = Array.from(new Set(selected));
  const p = primary.filter((m) => sel.includes(m));
  const s = secondary.filter((m) => sel.includes(m) && !p.includes(m));
  const additions = sel.filter((m) => !p.includes(m) && !s.includes(m));
  return {
    primaryMuscles: [...p, ...additions],
    secondaryMuscles: s,
    muscleGroups: sel,
  };
}
