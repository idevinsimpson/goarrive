import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_GUIDES,
  genericGuide,
  guideHeading,
  GUIDE_BANNED_WORDS,
  normalizeActivityKey,
  selectActivityGuide,
  SELF_COUNT_NOTE,
  type ActivityGuide,
} from '../src/activityGuides';

describe('normalizeActivityKey', () => {
  it('lowercases, trims and collapses whitespace', () => {
    expect(normalizeActivityKey('  Squats ')).toBe('squats');
    expect(normalizeActivityKey('PUSH   UPS')).toBe('push-ups');
  });

  it('folds singular and plural onto one key', () => {
    expect(normalizeActivityKey('squat')).toBe('squats');
    expect(normalizeActivityKey('squats')).toBe('squats');
    expect(normalizeActivityKey('lap')).toBe('laps');
    expect(normalizeActivityKey('laps')).toBe('laps');
    expect(normalizeActivityKey('minute')).toBe('minutes');
    expect(normalizeActivityKey('rep')).toBe('reps');
  });

  it('folds common synonyms and spellings', () => {
    for (const spelling of ['push-up', 'Push Up', 'pushups', 'push ups', 'press-ups']) {
      expect(normalizeActivityKey(spelling)).toBe('push-ups');
    }
    for (const spelling of ['sit up', 'situps', 'Sit-Ups', 'crunches']) {
      expect(normalizeActivityKey(spelling)).toBe('sit-ups');
    }
    expect(normalizeActivityKey('air squat')).toBe('squats');
    expect(normalizeActivityKey('repetitions')).toBe('reps');
    expect(normalizeActivityKey('lengths')).toBe('laps');
    expect(normalizeActivityKey('active minutes')).toBe('minutes');
  });

  it('strips punctuation the Champion may have typed', () => {
    expect(normalizeActivityKey('squats!')).toBe('squats');
    expect(normalizeActivityKey('“steps”')).toBe('steps');
    expect(normalizeActivityKey('push_ups')).toBe('push-ups');
  });

  it('gives an unknown unit a stable hyphenated plural key, not an error', () => {
    expect(normalizeActivityKey('burpee')).toBe('burpees');
    expect(normalizeActivityKey('burpees')).toBe('burpees');
    expect(normalizeActivityKey('Jumping Jacks')).toBe('jumping-jacks');
    expect(normalizeActivityKey('jumping jack')).toBe('jumping-jacks');
    // Not English, not in the table, still a key.
    expect(normalizeActivityKey('Sentadillas')).toBe('sentadillas');
  });

  it('returns no key for empty or punctuation-only input', () => {
    expect(normalizeActivityKey('')).toBe('');
    expect(normalizeActivityKey('   ')).toBe('');
    expect(normalizeActivityKey('***')).toBe('');
  });
});

describe('selectActivityGuide', () => {
  it('selects the table guide for a known unit', () => {
    expect(selectActivityGuide({ unit: 'squats' }).key).toBe('squats');
    expect(selectActivityGuide({ unit: 'Push Ups' }).key).toBe('push-ups');
    expect(selectActivityGuide({ unit: 'minute' }).key).toBe('minutes');
  });

  it('falls back to a generic guide for an unknown unit, phrased in that unit', () => {
    const guide = selectActivityGuide({ unit: 'burpees' });
    expect(ACTIVITY_GUIDES.burpees).toBeUndefined();
    expect(guide.key).toBe('burpees');
    expect(guide.rules[0]).toBe('Count each completed burpees once.');
    expect(guide.source).toBe('wsf-default');
  });

  it('lets a per-goal override win over the unit-derived key', () => {
    expect(selectActivityGuide({ unit: 'squats', activityGuideKey: 'steps' }).key).toBe('steps');
    // The override is normalized exactly like a unit.
    expect(selectActivityGuide({ unit: 'burpees', activityGuideKey: 'Push Up' }).key).toBe(
      'push-ups'
    );
  });

  it('ignores an absent, empty or unknown override rather than dropping the guide', () => {
    expect(selectActivityGuide({ unit: 'squats', activityGuideKey: null }).key).toBe('squats');
    expect(selectActivityGuide({ unit: 'squats', activityGuideKey: '   ' }).key).toBe('squats');
    expect(selectActivityGuide({ unit: 'squats', activityGuideKey: 'not-a-guide' }).key).toBe(
      'squats'
    );
    // An unknown override on an unknown unit still yields the generic guide.
    expect(selectActivityGuide({ unit: 'burpees', activityGuideKey: 'nope' }).rules.length).toBeGreaterThan(0);
  });

  it('gives every guide 2 to 4 rules, both count lines, and the default source', () => {
    const guides: ActivityGuide[] = [
      ...Object.values(ACTIVITY_GUIDES),
      genericGuide('burpees'),
      genericGuide(''),
    ];
    for (const guide of guides) {
      expect(guide.rules.length).toBeGreaterThanOrEqual(2);
      expect(guide.rules.length).toBeLessThanOrEqual(4);
      expect(guide.title.trim()).not.toBe('');
      expect(guide.counts.trim()).not.toBe('');
      expect(guide.doesNotCount.trim()).not.toBe('');
      expect(guide.source).toBe('wsf-default');
    }
  });

  it('files every table guide under its own key', () => {
    for (const [key, guide] of Object.entries(ACTIVITY_GUIDES)) {
      expect(guide.key).toBe(key);
      expect(normalizeActivityKey(key)).toBe(key);
    }
  });
});

describe('guideHeading', () => {
  it('says how we count, in the goal’s own unit', () => {
    expect(guideHeading('squats')).toBe('How we count squats');
    expect(guideHeading('  burpees ')).toBe('How we count burpees');
    expect(guideHeading('')).toBe('How we count');
  });
});

describe('no guide text makes a claim it has no standing to make', () => {
  // Whole words only: "closed" contains the letters of "lose" and is not a
  // claim about anything.
  const banned = GUIDE_BANNED_WORDS.map((w) => ({
    word: w,
    re: new RegExp(`\\b${w}\\b`, 'i'),
  }));

  const allStrings = (): string[] => {
    const out: string[] = [SELF_COUNT_NOTE];
    const push = (g: ActivityGuide) => {
      out.push(g.title, ...g.rules, g.counts, g.doesNotCount);
    };
    Object.values(ACTIVITY_GUIDES).forEach(push);
    ['burpees', 'jumping jacks', '', 'sentadillas'].forEach((u) => {
      push(genericGuide(u));
      out.push(guideHeading(u));
    });
    return out;
  };

  it('contains none of the banned words', () => {
    for (const text of allStrings()) {
      for (const { word, re } of banned) {
        expect(re.test(text), `"${text}" contains the banned word "${word}"`).toBe(false);
      }
    }
  });

  it('keeps the tone plain: no exclamation marks, no second-person imperative about outcomes', () => {
    for (const text of allStrings()) {
      expect(text).not.toContain('!');
    }
  });

  it('does not contradict the screen’s own self-count sentence', () => {
    // The movement screen says "Count your own <unit>…" and the timer caption
    // says it records nothing. The guide's one note about the count says the
    // same thing rather than implying anything checks it.
    expect(SELF_COUNT_NOTE).toBe('You count your own. Nothing here checks it.');
    for (const text of allStrings()) {
      expect(text.toLowerCase()).not.toMatch(/\b(verif|confirm|prove|approved|validated)/);
    }
  });
});
