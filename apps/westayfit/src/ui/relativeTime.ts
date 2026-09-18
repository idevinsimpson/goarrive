/**
 * How long ago a recent addition landed, said in the plainest words that are
 * still true.
 *
 * THE INPUT IS A MINUTE, NOT AN INSTANT. The server stores and publishes
 * `at` rounded down to the minute, so this helper cannot be more precise than
 * a minute and never pretends to be. "3 min ago" means the minute it landed in
 * was three minutes before the minute it is now, which is all anyone reading a
 * wall display needs and all the stored value supports.
 *
 * THE CLOCK IS THE DEVICE'S. There is no public server timestamp to compare
 * against, so the comparison is made against whatever the device believes the
 * time is. A device whose clock is wrong will say the wrong thing here; the
 * answer to that is to say something vague rather than something confidently
 * false, which is why a future `at` reads as "just now" rather than a negative
 * age or a refusal.
 */

/** Minute-granularity age of `at` as of `now`, or null if `at` is unusable. */
export function additionAgeLabel(at: string, now: Date): string | null {
  const landedMs = Date.parse(at);
  if (!Number.isFinite(landedMs)) return null;
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return null;

  // Both sides are floored to the minute before subtracting, so the label only
  // changes when the printed minute changes. Without this, an `at` of 12:00:00
  // compared against 12:00:59 and 12:01:01 would flip between "just now" and
  // "1 min ago" mid-minute for no visible reason.
  const minutes =
    Math.floor(nowMs / 60_000) - Math.floor(landedMs / 60_000);

  // A device clock behind the server's reads the addition as being in the
  // future. That is a clock problem, not a data problem, and the honest thing
  // a display can say about something it just heard about is "just now".
  if (minutes <= 0) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}

/**
 * The whole line: "+20 squats · 3 min ago".
 *
 * Returns null when the addition cannot be said truthfully — an unusable
 * instant, or an amount that is not a finite positive number. A line that
 * cannot be said is dropped, never filled in with a guess or a placeholder.
 *
 * `unit` is printed exactly as the server sent it. This helper does not
 * pluralize: the unit on a goal is already a plural noun the Champion wrote
 * ("squats", "minutes"), and inventing "1 squats" -> "1 squat" would be this
 * client editing a string it does not own.
 */
export function additionLine(
  addition: { amount: number; unit: string; at: string },
  now: Date
): string | null {
  const { amount, unit, at } = addition;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null;
  const age = additionAgeLabel(at, now);
  if (age === null) return null;
  const withUnit = unit ? `+${amount} ${unit}` : `+${amount}`;
  return `${withUnit} · ${age}`;
}
