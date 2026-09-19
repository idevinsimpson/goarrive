/**
 * "THE SAME PLAYER RUNS ON PHONE OR STATION", pinned as a fact about the
 * source rather than as a sentence in a comment.
 *
 * The cheapest way to satisfy that requirement dishonestly is to build a
 * second player — a stripped one for the station, a "simplified" one for the
 * phone — that looks the same in a screenshot and drifts within a week. These
 * tests make that show up as a failure rather than as a surprise at an event.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { followAlongStatusLine } from '../src/followAlongSession';

const root = join(__dirname, '..');

const sources: string[] = [];
const walk = (dir: string) => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (full.endsWith('.tsx') || full.endsWith('.ts')) sources.push(full);
  }
};
walk(join(root, 'app'));
walk(join(root, 'src'));

const rel = (f: string) => f.slice(root.length + 1);

describe('one player, three hosts', () => {
  it('is mounted by the move route, the station and the phone — and nowhere else', () => {
    const hosts = sources
      .filter((f) => rel(f) !== join('src', 'ui', 'FollowAlongCard.tsx'))
      .filter((f) => readFileSync(f, 'utf8').includes('<FollowAlongCard'))
      .map(rel)
      .sort();
    expect(hosts).toEqual(
      [
        join('app', 'move', '[goalId].tsx'),
        join('app', 'queue', '[goalId].tsx'),
        join('app', 'station', '[goalId].tsx'),
      ].sort()
    );
  });

  it('and every one of them drives it from the shared session', () => {
    for (const host of [
      join('app', 'move', '[goalId].tsx'),
      join('app', 'queue', '[goalId].tsx'),
      join('app', 'station', '[goalId].tsx'),
    ]) {
      const src = readFileSync(join(root, host), 'utf8');
      expect(src, `${host} mounts the card without the shared session`).toContain(
        'useFollowAlongSession('
      );
    }
  });

  /**
   * THE INVARIANT THE PLAYER EXISTS UNDER, and the one this wiring was most
   * likely to break. No credit comes from elapsed time or a finished round:
   * the player has no control that sends a number, and putting it next to a
   * station's record panel must not have given it one.
   */
  it('cannot record anything, on any host', () => {
    const player = [
      readFileSync(join(root, 'src', 'ui', 'FollowAlongCard.tsx'), 'utf8'),
      readFileSync(join(root, 'src', 'followAlongSession.ts'), 'utf8'),
    ].join('\n');
    for (const forbidden of [
      'httpsCallable',
      'wsfContribute',
      'wsfCompleteTurn',
      'wsfCompleteMyTurn',
      'getFirebaseFunctions',
    ]) {
      expect(player, `the player must not be able to call ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe('followAlongStatusLine', () => {
  // The station's side panel and the player's own card print this same
  // sentence. A second copy of the wording is a second thing to get wrong.
  it('says where the round is, in every phase', () => {
    expect(
      followAlongStatusLine({ phase: 'ready', length: 'short', running: false, remainingMs: 0 })
    ).toContain('Not started');
    expect(
      followAlongStatusLine({ phase: 'countdown', length: 'short', running: true, remainingMs: 2_000 })
    ).toBe('Starting in 2');
    expect(
      followAlongStatusLine({ phase: 'round', length: 'short', running: true, remainingMs: 30_000 })
    ).toBe('30 left in this round');
    expect(
      followAlongStatusLine({ phase: 'round', length: 'short', running: false, remainingMs: 30_000 })
    ).toBe('Paused · 30 left in this round');
    expect(
      followAlongStatusLine({ phase: 'finished', length: 'full', running: false, remainingMs: 0 })
    ).toBe('Round finished · enter your own count');
  });

  it('names the length it is about to run, so Start is never a surprise', () => {
    const short = followAlongStatusLine({
      phase: 'ready',
      length: 'short',
      running: false,
      remainingMs: 0,
    });
    const full = followAlongStatusLine({
      phase: 'ready',
      length: 'full',
      running: false,
      remainingMs: 0,
    });
    expect(short).not.toBe(full);
  });
});
