import { describe, expect, it } from 'vitest';

import {
  CALL_NAME_MAX,
  callNameSuggestions,
  firstNameOf,
  initialsOf,
  isUsableCallName,
  normalizeCallName,
} from '../src/queueName';

describe('normalizeCallName', () => {
  it('collapses whatever was typed into something a screen can show', () => {
    expect(normalizeCallName('  Devin   Simpson ')).toBe('Devin Simpson');
    expect(normalizeCallName('Devin\tSimpson')).toBe('Devin Simpson');
    expect(normalizeCallName('Devin\nSimpson')).toBe('Devin Simpson');
  });

  // An empty box is a normal state — people backspace — so this returns ''
  // rather than throwing, and every caller has to handle '' anyway.
  it('treats nothing usable as nothing, never as an error', () => {
    for (const bad of ['', '   ', '\n\t', null, undefined, 42 as unknown as string]) {
      expect(normalizeCallName(bad)).toBe('');
    }
  });

  it('strips the control characters a paste can carry invisibly', () => {
    expect(normalizeCallName('De\u0007vin')).toBe('De vin');
    expect(normalizeCallName('\u0000Devin\u007F')).toBe('Devin');
  });

  it('is short enough to read from the back of a hall, and never ends ragged', () => {
    const long = 'Bartholomew Montgomery Fitzwilliam';
    const out = normalizeCallName(long);
    expect(out.length).toBeLessThanOrEqual(CALL_NAME_MAX);
    expect(out).toBe(out.trim());
    // The cut must not leave a dangling space where a word was severed.
    expect(out.endsWith(' ')).toBe(false);
  });
});

describe('isUsableCallName', () => {
  it('accepts ordinary names, including ones that are not English', () => {
    for (const name of ['Devin', 'Ana María', '田中', 'Ngozi', "O'Brien", 'Jean-Luc', 'R2']) {
      expect(isUsableCallName(name), name).toBe(true);
    }
  });

  // The single likeliest way an email ends up projected on a wall is somebody
  // pasting it into a name box without thinking.
  it('refuses an address outright', () => {
    expect(isUsableCallName('devin@example.com')).toBe(false);
    expect(isUsableCallName('  someone@somewhere  ')).toBe(false);
    expect(isUsableCallName('@devin')).toBe(false);
  });

  it('refuses a link, which is the same mistake in a different coat', () => {
    expect(isUsableCallName('https://example.com')).toBe(false);
    expect(isUsableCallName('HTTP://EXAMPLE.COM')).toBe(false);
  });

  it('refuses an empty box', () => {
    for (const bad of ['', '   ', null, undefined]) expect(isUsableCallName(bad)).toBe(false);
  });
});

describe('firstNameOf', () => {
  // The rule the whole module exists for: a surname never reaches a screen.
  it('returns the first word and never any word after it', () => {
    expect(firstNameOf('Devin Simpson')).toBe('Devin');
    expect(firstNameOf('Ana María Gómez Ruiz')).toBe('Ana');
    expect(firstNameOf('  Ngozi  ')).toBe('Ngozi');
  });

  it('has nothing to offer when there is nothing to offer', () => {
    for (const bad of ['', '   ', null, undefined]) expect(firstNameOf(bad)).toBe('');
  });

  it('never leaks the rest of the name, for any name', () => {
    const cases = ['Devin Simpson', 'Ana María Gómez', 'Jean-Luc Picard Jr'];
    for (const full of cases) {
      const rest = full.trim().split(/\s+/).slice(1);
      const first = firstNameOf(full);
      for (const word of rest) expect(first).not.toContain(word);
    }
  });
});

describe('initialsOf', () => {
  it('abbreviates to at most two, because three is not anonymity', () => {
    expect(initialsOf('Devin Simpson')).toBe('D.S.');
    expect(initialsOf('Ana María Gómez Ruiz')).toBe('A.M.');
    expect(initialsOf('Ngozi')).toBe('N.');
  });

  it('works on scripts without a Latin alphabet', () => {
    expect(initialsOf('田中 花子')).toBe('田.花.');
  });

  it('upper-cases, so two people do not read as different kinds of thing', () => {
    expect(initialsOf('devin simpson')).toBe('D.S.');
  });

  // A screen must not offer an empty choice; it must not offer the choice.
  it('is empty when there is nothing to abbreviate', () => {
    for (const bad of ['', '   ', '!!! ???', null, undefined]) expect(initialsOf(bad)).toBe('');
  });
});

describe('callNameSuggestions', () => {
  it('offers both, and marks the absent one as absent', () => {
    expect(callNameSuggestions('Devin Simpson')).toEqual({ first: 'Devin', initials: 'D.S.' });
    expect(callNameSuggestions('')).toEqual({ first: '', initials: '' });
  });

  it('never suggests something the screen would then refuse to show', () => {
    for (const name of ['Devin Simpson', 'Ana María Gómez', 'Ngozi', '田中 花子']) {
      const { first, initials } = callNameSuggestions(name);
      expect(isUsableCallName(first), `first of ${name}`).toBe(true);
      expect(isUsableCallName(initials), `initials of ${name}`).toBe(true);
    }
  });

  // Somebody whose display name IS an address must not be handed it back as a
  // suggestion. Offering a value the very next check refuses is worse than
  // offering none: it lets them accept it and then tells them no.
  it('offers no first name when the account name is an address, and initials instead', () => {
    const { first, initials } = callNameSuggestions('devin@example.com');
    expect(first).toBe('');
    expect(initials).toBe('D.');
    expect(isUsableCallName(initials)).toBe(true);
  });

  // The invariant behind it, over every account name this module can be given:
  // a suggestion is either empty or showable, and never anything else.
  it('never returns a suggestion that is neither empty nor showable', () => {
    const names = [
      'Devin Simpson', 'devin@example.com', 'https://example.com/me', '   ',
      '田中 花子', '!!! ???', 'Ana María Gómez Ruiz', '@handle', '',
    ];
    for (const name of names) {
      const { first, initials } = callNameSuggestions(name);
      for (const [label, value] of [['first', first], ['initials', initials]] as const) {
        expect(value === '' || isUsableCallName(value), `${label} of "${name}" = "${value}"`).toBe(
          true
        );
      }
    }
  });
});
