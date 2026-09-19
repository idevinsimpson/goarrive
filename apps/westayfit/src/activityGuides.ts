/**
 * Guided activity rules — a DATA TABLE, not per-activity UI.
 *
 * A goal's `unit` is free text the Champion typed (wsfCreateGoal accepts
 * 1..40 chars, any script). This module turns that free text into a
 * normalized key, looks the key up in one table, and returns a guide. The
 * contribution screen renders whatever comes back; it knows nothing about
 * squats, steps or laps.
 *
 * WHAT THESE GUIDES ARE, AND ARE NOT.
 *
 * They are counting rules: when does one of these count as one. That is the
 * only question the app has any standing to answer, because the number the
 * member types is the only thing it records.
 *
 * They are NOT instruction, coaching, or anything medical. Nothing here says
 * an activity is safe or unsafe, how deep or how fast to go, what it does to
 * a body, or what anyone should attempt. There is no "consult a doctor"
 * boilerplate either — that sentence is itself a health claim about an
 * activity we make no claims about. `GUIDE_BANNED_WORDS` is enforced over
 * every string in this file by tests/activity-guides.test.ts.
 *
 * They do NOT change what the count means. The member counts their own
 * effort and nothing verifies it — the same truth the entry and movement
 * screens already state. `SELF_COUNT_NOTE` is the one line the guide adds,
 * and it restates that rather than contradicting it.
 */

export type ActivityGuide = {
  /** The normalized key this guide is filed under. */
  key: string;
  /** Short noun phrase for the guide itself; the section heading is built from the goal's unit. */
  title: string;
  /** 2..4 short counting rules, rendered in order. */
  rules: readonly string[];
  /** What counts, said plainly. */
  counts: string;
  /** What does not count, said plainly. */
  doesNotCount: string;
  /**
   * Where this guide came from. Today there is exactly one source: the
   * defaults that ship with the app. A future community-authored or
   * Champion-authored guide would carry its own marker here, so a screen (or
   * a reviewer) can always tell whose words it is showing.
   */
  source: 'wsf-default';
};

/**
 * Words that must not appear in any guide string. Enforced as whole words —
 * "closed" contains the letters of "lose" and is not a claim about anything.
 */
export const GUIDE_BANNED_WORDS = [
  'safe',
  'safely',
  'injury',
  'doctor',
  'calorie',
  'burn',
  'lose',
  'medical',
  'health',
] as const;

/**
 * The one sentence the guide adds about the count itself. It restates what
 * the movement screen already says ("Count your own <unit>…") and the timer
 * caption already disclaims: this is the member's own count, and the app does
 * not check it.
 */
export const SELF_COUNT_NOTE = 'You count your own. Nothing here checks it.';

// ---- normalization ----------------------------------------------------------

/**
 * Lowercase, trim, collapse whitespace, drop everything that is not a letter,
 * a digit, a space or a hyphen, and join the words with hyphens.
 *
 * Unicode letters survive: a unit typed as "Sentadillas" slugs to
 * "sentadillas", which is simply a key with no default guide yet.
 */
function slug(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .trim()
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** English plural -> singular, for the ordinary cases only. */
function singularize(s: string): string {
  if (s.length <= 2) return s;
  if (/ies$/.test(s)) return `${s.slice(0, -3)}y`;
  if (/(ch|sh|s|x|z)es$/.test(s)) return s.slice(0, -2);
  if (/ss$/.test(s)) return s;
  if (/s$/.test(s)) return s.slice(0, -1);
  return s;
}

/** Singular -> plural, the inverse of `singularize` for the same ordinary cases. */
function pluralize(s: string): string {
  if (s === '') return s;
  if (/[^aeiou]y$/.test(s)) return `${s.slice(0, -1)}ies`;
  if (/(ch|sh|s|x|z)$/.test(s)) return `${s}es`;
  return `${s}s`;
}

/**
 * Common ways of writing the same activity, folded onto one canonical key.
 * Keys here are already slugged and singular; the lookup tries the slug, its
 * singular, and that singular's plural, so "Push Ups", "push-up", "pushups"
 * and "press-ups" all land on `push-ups`.
 */
const SYNONYMS: Readonly<Record<string, string>> = {
  'push-up': 'push-ups',
  pushup: 'push-ups',
  'press-up': 'push-ups',
  pressup: 'push-ups',
  'sit-up': 'sit-ups',
  situp: 'sit-ups',
  crunch: 'sit-ups',
  'body-weight-squat': 'squats',
  'bodyweight-squat': 'squats',
  'air-squat': 'squats',
  squat: 'squats',
  step: 'steps',
  pace: 'steps',
  minute: 'minutes',
  min: 'minutes',
  'active-minute': 'minutes',
  'moving-minute': 'minutes',
  lap: 'laps',
  length: 'laps',
  circuit: 'laps',
  rep: 'reps',
  repetition: 'reps',
};

/**
 * The key a goal's unit maps to.
 *
 * Documented rules, applied in this order:
 *   1. lowercase, trim, collapse whitespace and punctuation -> hyphenated slug
 *   2. synonym folding (SYNONYMS), tried on the slug and on its singular
 *   3. singular/plural folding, so "squat" and "squats" are one key
 *   4. anything left over normalizes to its hyphenated plural slug and simply
 *      has no default guide yet — it is a key, not an error
 *
 * Empty or punctuation-only input returns '' (no key).
 */
export function normalizeActivityKey(unit: string): string {
  if (typeof unit !== 'string') return '';
  const base = slug(unit);
  if (base === '') return '';
  const singular = singularize(base);
  const plural = pluralize(singular);
  for (const candidate of [base, singular, plural]) {
    const folded = SYNONYMS[candidate];
    if (folded) return folded;
    if (Object.prototype.hasOwnProperty.call(ACTIVITY_GUIDES, candidate)) return candidate;
  }
  return plural;
}

// ---- the table --------------------------------------------------------------

export const ACTIVITY_GUIDES: Readonly<Record<string, ActivityGuide>> = {
  squats: {
    key: 'squats',
    title: 'Counting squats',
    rules: [
      'Count one squat when you stand back up.',
      'Count only the squats you finished.',
      'Rest when you want to. The count picks up where you left it.',
    ],
    counts: 'A squat counts when you go down and stand back up.',
    doesNotCount: 'A squat you stopped partway through does not count.',
    source: 'wsf-default',
  },
  'push-ups': {
    key: 'push-ups',
    title: 'Counting push-ups',
    rules: [
      'Count one push-up when your arms are straight again.',
      'Count only the push-ups you finished.',
      'Rest when you want to. The count picks up where you left it.',
    ],
    counts: 'A push-up counts when you lower down and come all the way back up.',
    doesNotCount: 'A push-up you stopped partway through does not count.',
    source: 'wsf-default',
  },
  'sit-ups': {
    key: 'sit-ups',
    title: 'Counting sit-ups',
    rules: [
      'Count one sit-up when you are back down again.',
      'Count only the sit-ups you finished.',
    ],
    counts: 'A sit-up counts when you come up and return to where you started.',
    doesNotCount: 'A sit-up you stopped partway through does not count.',
    source: 'wsf-default',
  },
  steps: {
    key: 'steps',
    title: 'Counting steps',
    rules: [
      'Count each step you take.',
      'A step counter you already use is fine to read from.',
      'Enter the steps for this session, not your total for the day.',
    ],
    counts: 'Steps you took yourself count.',
    doesNotCount: 'Steps someone else took do not count.',
    source: 'wsf-default',
  },
  minutes: {
    key: 'minutes',
    title: 'Counting minutes',
    rules: [
      'Count whole minutes of the activity.',
      'Round down. A part minute is not a minute.',
      'Leave out the time you spent stopped.',
    ],
    counts: 'Time you spent doing the activity counts.',
    doesNotCount: 'Time spent getting ready or stopped does not count.',
    source: 'wsf-default',
  },
  laps: {
    key: 'laps',
    title: 'Counting laps',
    rules: [
      'Count one lap each time you finish the full distance.',
      'Count only the laps you finished.',
    ],
    counts: 'A lap counts when you reach the end of the lap you set out to do.',
    doesNotCount: 'A part lap does not count.',
    source: 'wsf-default',
  },
  reps: {
    key: 'reps',
    title: 'Counting reps',
    rules: [
      'Count one rep each time you complete the movement.',
      'Count only the reps you finished.',
    ],
    counts: 'A rep counts when the movement is complete.',
    doesNotCount: 'A part rep does not count.',
    source: 'wsf-default',
  },
};

/**
 * The guide for a unit with no entry in the table. Nothing is hardcoded to one
 * activity: an unknown unit still gets the same shape, phrased with the unit
 * the Champion typed.
 */
export function genericGuide(unit: string): ActivityGuide {
  const label = typeof unit === 'string' ? unit.trim() : '';
  const key = normalizeActivityKey(label);
  return {
    key,
    title: label ? `Counting ${label}` : 'Counting',
    rules: [
      label ? `Count each completed ${label} once.` : 'Count each completed one once.',
      'Count only what you finished.',
    ],
    counts: 'What you finished counts.',
    doesNotCount: 'What you started and did not finish does not count.',
    source: 'wsf-default',
  };
}

/**
 * The guide to show for a goal.
 *
 * `activityGuideKey` is the per-goal override: a string the goal document may
 * carry (server-validated, <= 40 chars). When it normalizes to a key the table
 * knows, it WINS over the unit. When it is absent, empty, or names nothing the
 * table has, the unit-derived key decides — an override is never allowed to
 * leave the member with no guide at all.
 */
export function selectActivityGuide(input: {
  unit: string;
  activityGuideKey?: string | null;
}): ActivityGuide {
  const override = input.activityGuideKey;
  if (typeof override === 'string' && override.trim() !== '') {
    const overrideKey = normalizeActivityKey(override);
    const overridden = ACTIVITY_GUIDES[overrideKey];
    if (overridden) return overridden;
  }
  const key = normalizeActivityKey(input.unit ?? '');
  return ACTIVITY_GUIDES[key] ?? genericGuide(input.unit ?? '');
}

/** The section heading, always in the goal's own words. */
export function guideHeading(unit: string): string {
  const label = typeof unit === 'string' ? unit.trim() : '';
  return label ? `How we count ${label}` : 'How we count';
}
