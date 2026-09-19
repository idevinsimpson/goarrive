/**
 * WHAT A SCREEN IN A ROOM IS ALLOWED TO CALL SOMEBODY.
 *
 * A queue puts a person's name on a screen in a room full of strangers. That
 * is the whole design problem; the rest of a queue is plumbing. So the name
 * shown is CHOSEN by the person as they get in line, never inferred from
 * their account, and what they choose is a label for one turn rather than a
 * fact about them.
 *
 * This module is only the naming half, deliberately: it holds no queue state,
 * reaches no network, and can be reasoned about — and tested — on its own.
 *
 * Three rules it enforces so no screen has to remember them:
 *   - a suggestion is a FIRST NAME at most. A surname never reaches a screen.
 *   - anything that looks like an address is refused outright, because the
 *     commonest way to put an email on a wall is to paste it into a name box.
 *   - the label is short enough to read from the back of a hall, and what
 *     cannot be read from the back of a hall is not serving anybody.
 */

/** Long enough for a real name, short enough to read at distance. */
export const CALL_NAME_MAX = 24;

/**
 * Collapse whatever was typed into something a screen can show, or '' if
 * there is nothing usable in it.
 *
 * Returning '' rather than throwing is the point: a name box is a place
 * people backspace, and an empty box is a normal state, not an error.
 */
export function normalizeCallName(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  // Control characters, including the ones a paste can carry invisibly.
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned.slice(0, CALL_NAME_MAX).trim();
}

/**
 * Whether this is a label a screen may show.
 *
 * An address is refused wholesale. Not because '@' is magic, but because the
 * single likeliest way somebody's email ends up projected on a wall is that
 * they pasted it into a name box without thinking, and no queue is worth
 * that.
 */
export function isUsableCallName(raw: string | null | undefined): boolean {
  const name = normalizeCallName(raw);
  if (!name) return false;
  if (name.includes('@')) return false;
  // A bare URL is the same mistake wearing a different coat.
  if (/https?:\/\//i.test(name)) return false;
  return true;
}

/**
 * The first word of a display name, and never any word after it.
 *
 * Empty when that word is not something a screen may show — an account whose
 * display name is an address is the case that matters. Offering a suggestion
 * the very next check would refuse is worse than offering none: it hands
 * somebody a value, lets them accept it, and then tells them no.
 */
export function firstNameOf(displayName: string | null | undefined): string {
  const name = normalizeCallName(displayName);
  if (!name) return '';
  const first = name.split(' ')[0] ?? '';
  return isUsableCallName(first) ? first : '';
}

/**
 * Initials, for somebody who would rather a room did not learn their name.
 *
 * At most two, because three is not anonymity and a longer string is not
 * either — it just looks like a name again.
 */
export function initialsOf(displayName: string | null | undefined): string {
  const name = normalizeCallName(displayName);
  if (!name) return '';
  const letters = name
    .split(' ')
    .map((part) => [...part][0] ?? '')
    .filter((ch) => /\p{L}|\p{N}/u.test(ch))
    .slice(0, 2)
    .map((ch) => ch.toLocaleUpperCase());
  if (!letters.length) return '';
  return `${letters.join('.')}.`;
}

/**
 * What the control offers. Both are suggestions and neither is a default the
 * person cannot see: whichever is pre-filled, the other is one tap away, and
 * the box is theirs to overwrite.
 *
 * `initials` is empty when a display name yields nothing to abbreviate, and a
 * screen must then simply not offer that choice rather than offer an empty
 * one.
 */
export function callNameSuggestions(displayName: string | null | undefined): {
  first: string;
  initials: string;
} {
  return { first: firstNameOf(displayName), initials: initialsOf(displayName) };
}
