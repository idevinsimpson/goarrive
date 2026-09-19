import { describe, expect, it } from 'vitest';

import {
  NEXT_UP_SHOWN,
  announceCall,
  announceYourTurn,
  describeLineLength,
  describePlaceInLine,
  isLiveQueueStatus,
  nextUp,
  orderByPosition,
  type QueueEntryPublic,
} from '../src/queueLine';

const entry = (position: number, calledName = `P${position}`): QueueEntryPublic => ({
  entryId: `e${position}`,
  calledName,
  position,
});

describe('orderByPosition', () => {
  // The rule the whole module exists for: a line is ordered by the number the
  // server allocated, never by the order documents came back in.
  it('puts the oldest place first whatever order it was handed', () => {
    const shuffled = [entry(7), entry(2), entry(19), entry(3)];
    expect(orderByPosition(shuffled).map((e) => e.position)).toEqual([2, 3, 7, 19]);
  });

  it('sorts numerically, not as strings', () => {
    expect(orderByPosition([entry(10), entry(9), entry(100)]).map((e) => e.position)).toEqual([
      9, 10, 100,
    ]);
  });

  // The caller's array is very often React state, and a sort in place is a
  // mutation React cannot see.
  it('never mutates what it was given', () => {
    const original = [entry(3), entry(1)];
    const copy = [...original];
    orderByPosition(original);
    expect(original).toEqual(copy);
  });

  it('handles an empty line', () => {
    expect(orderByPosition([])).toEqual([]);
  });
});

describe('nextUp', () => {
  it('shows the few after the one being called, oldest first', () => {
    const waiting = [entry(9), entry(4), entry(6), entry(21), entry(11), entry(30)];
    expect(nextUp(waiting).map((e) => e.position)).toEqual([4, 6, 9, 11]);
    expect(nextUp(waiting)).toHaveLength(NEXT_UP_SHOWN);
  });

  it('shows the whole line when the line is shorter than the window', () => {
    expect(nextUp([entry(2), entry(1)]).map((e) => e.position)).toEqual([1, 2]);
  });

  // A screen that prints the whole line prints the whole room's names at once.
  it('never shows more than it was asked for, for any line length', () => {
    const long = Array.from({ length: 200 }, (_, i) => entry(i + 1));
    expect(nextUp(long)).toHaveLength(NEXT_UP_SHOWN);
    expect(nextUp(long, 2).map((e) => e.position)).toEqual([1, 2]);
  });

  it('shows nobody when asked for nobody', () => {
    for (const bad of [0, -3, Number.NaN]) {
      expect(nextUp([entry(1), entry(2)], bad)).toEqual([]);
    }
  });
});

describe('isLiveQueueStatus', () => {
  it('counts waiting and called as still holding a place', () => {
    expect(isLiveQueueStatus('waiting')).toBe(true);
    expect(isLiveQueueStatus('called')).toBe(true);
  });

  // The "already in line" case: done and left are not in line, so a person in
  // either state may join again.
  it('counts done, left and nothing at all as out of the line', () => {
    for (const s of ['done', 'left', '', null, undefined, 'WAITING']) {
      expect(isLiveQueueStatus(s), String(s)).toBe(false);
    }
  });
});

describe('announceCall', () => {
  // ONE sentence, printed in the largest type on the screen AND read by the
  // ARIA live region, so what is shown and what is said cannot drift apart.
  it('names the person and, when there are two screens, which one', () => {
    expect(announceCall(entry(3, 'Devin'), 'Station 2')).toBe(
      'Devin — it’s your turn at Station 2.'
    );
    expect(announceCall(entry(3, 'D.S.'))).toBe('D.S. — it’s your turn.');
    expect(announceCall(entry(3, 'Devin'), '   ')).toBe('Devin — it’s your turn.');
  });

  // An empty line is a normal state at an event; a live region that announces
  // emptiness interrupts a screen reader for nothing.
  it('says nothing at all when nobody is up', () => {
    expect(announceCall(null)).toBeNull();
    expect(announceCall(undefined)).toBeNull();
    expect(announceCall(entry(1, '   '))).toBeNull();
  });

  it('announces exactly the chosen label and never anything else about them', () => {
    const sentence = announceCall(entry(12, 'D.S.'), 'Station 1')!;
    expect(sentence).toContain('D.S.');
    expect(sentence).not.toContain('12');
    expect(sentence).not.toContain('e12');
  });
});

describe('describePlaceInLine', () => {
  it('says how many are in front, in words that read as English', () => {
    expect(describePlaceInLine({ status: 'waiting', ahead: 0 })).toBe('You’re next.');
    expect(describePlaceInLine({ status: 'waiting', ahead: 1 })).toBe('1 person ahead of you.');
    expect(describePlaceInLine({ status: 'waiting', ahead: 6 })).toBe('6 people ahead of you.');
  });

  it('tells a called person where to go when there are two screens', () => {
    expect(describePlaceInLine({ status: 'called', ahead: 0, stationLabel: 'Station 2' })).toBe(
      'It’s your turn — go to Station 2.'
    );
    expect(describePlaceInLine({ status: 'called', ahead: 0 })).toBe('It’s your turn.');
  });

  it('is honest about not being in the line', () => {
    expect(describePlaceInLine({ status: 'left', ahead: 0 })).toBe('You’re not in the line.');
    expect(describePlaceInLine({ status: 'done', ahead: 3 })).toBe('You’re not in the line.');
  });

  // `position` is an allocation counter, not a place: the people in front may
  // have left. Printing it would tell somebody something untrue.
  it('never prints a raw position as if it were a place in line', () => {
    for (const ahead of [0, 1, 2, 40]) {
      const text = describePlaceInLine({ status: 'waiting', ahead });
      expect(text).not.toMatch(/number|#/i);
    }
  });

  it('treats a nonsense count as nobody in front rather than as an error', () => {
    for (const ahead of [-1, Number.NaN, -0.5]) {
      expect(describePlaceInLine({ status: 'waiting', ahead })).toBe('You’re next.');
    }
  });
});

describe('describeLineLength', () => {
  it('counts the line in English', () => {
    expect(describeLineLength(0)).toBe('Nobody is waiting.');
    expect(describeLineLength(1)).toBe('1 person waiting.');
    expect(describeLineLength(12)).toBe('12 people waiting.');
  });

  it('treats a nonsense count as an empty line', () => {
    for (const n of [-4, Number.NaN]) expect(describeLineLength(n)).toBe('Nobody is waiting.');
  });
});

describe('announceYourTurn', () => {
  it('says where to go when it knows, and simply says it when it does not', () => {
    expect(announceYourTurn('Station 1')).toBe('It’s your turn — go to Station 1.');
    expect(announceYourTurn(null)).toBe('It’s your turn.');
    expect(announceYourTurn('  ')).toBe('It’s your turn.');
  });
});
