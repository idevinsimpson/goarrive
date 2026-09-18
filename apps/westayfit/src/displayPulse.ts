/**
 * The answer wsfGoalPulse publishes, and the only equality the public display
 * is allowed to reason with.
 *
 * Response shape mirrors wsfGoalPulse in functions-westayfit: the four
 * aggregate fields, and — since the owner's publication decision of
 * 2026-09-18 — the five context fields a Champion's authorization also
 * publishes. Nothing about the display's context comes from the URL, the
 * query string or browser storage; only the server's answer names anything.
 */
export type GoalPulse = {
  sharedTotal: number;
  target: number;
  unit: string;
  status: 'active' | 'closed';
  communityDisplayName: string;
  goalTitle: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
};

/**
 * True only when two confirmed answers say THE SAME THING — all nine
 * published fields, not a subset. The display polls every 2 seconds and a
 * wall display is usually looking at an unchanged goal, so this is what lets
 * an unchanged tick keep the state object it already has instead of
 * allocating an identical one and repainting.
 *
 * It is deliberately a total field-by-field comparison rather than a total
 * check: `status` closing, a retitled goal or a republished window are all
 * changes the screen must show, and every one of them can arrive with the
 * total unmoved.
 *
 * It says nothing about freshness. Two equal pulses were still confirmed at
 * different instants, and the caller — not this function — decides whether
 * the receipt time it prints has changed.
 */
export function samePulse(a: GoalPulse, b: GoalPulse): boolean {
  return (
    a.sharedTotal === b.sharedTotal &&
    a.target === b.target &&
    a.unit === b.unit &&
    a.status === b.status &&
    a.communityDisplayName === b.communityDisplayName &&
    a.goalTitle === b.goalTitle &&
    a.startsAt === b.startsAt &&
    a.endsAt === b.endsAt &&
    a.timezone === b.timezone
  );
}

/**
 * One line of wsfGoalRecentAdditions — a DIFFERENT callable from wsfGoalPulse,
 * deliberately. The pulse's nine published fields are settled and this list is
 * not one of them; it is a separate disclosure reached by the same per-goal
 * authorization, so it is a separate request with its own answer.
 *
 * Three fields, and the type is closed on purpose: if the server ever grew a
 * fourth, this client would not carry it onto a screen by accident.
 */
export type GoalRecentAddition = { amount: number; unit: string; at: string };

/** The whole response. Exactly one key, and an empty list is a real answer. */
export type GoalRecentAdditions = { additions: GoalRecentAddition[] };
