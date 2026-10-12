import { readFileSync } from 'node:fs';
import * as nodePath from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildFollowAlongPlan, mediaPresentation } from '../src/followAlong';
import {
  APPROVED_DEMO_MEDIA,
  DEMO_MEDIA_ASSET_DEPENDENCY,
  DEMO_RETRY_LIMIT,
  demoMediaCatalog,
  demoMediaFor,
  demoPlaybackFor,
  demoVariantKey,
  isAllowedDemoUri,
  shouldRetryDemo,
  testDemoMediaCatalog,
  TEST_FIXTURE_PREFIX,
  type DemoMediaEntry,
} from '../src/movementDemoMedia';

const fixture: DemoMediaEntry = {
  variant: 'squats',
  posterUri: `${TEST_FIXTURE_PREFIX}squats-poster.png`,
  clipUri: `${TEST_FIXTURE_PREFIX}squats-demo.webm`,
  source: 'TEST FIXTURE — not a movement demonstration',
};
const loopback = (media: unknown) => ({ location: { hostname: '127.0.0.1' }, __WSF_TEST_DEMO_MEDIA__: media });

describe('the approved catalog is the truth, and today it is empty', () => {
  it('ships no clip: no approved movement demonstration exists yet, and the gap is named', () => {
    expect(APPROVED_DEMO_MEDIA).toEqual([]);
    expect(DEMO_MEDIA_ASSET_DEPENDENCY).toMatch(/No approved movement demonstration clip exists yet/);
  });

  it('every real movement keeps the drawn guide: no media, presented as the fallback', () => {
    for (const unit of ['squats', 'push-ups', 'sit-ups', 'steps', 'minutes', 'laps', 'reps', 'jumping jacks']) {
      const media = demoMediaFor(unit, demoMediaCatalog());
      expect(media).toEqual({ kind: 'none' });
      expect(mediaPresentation(buildFollowAlongPlan({ unit, media }).media).kind).toBe('fallback');
    }
  });
});

describe('exact variants only — no implicit movement equivalence', () => {
  it('normalises only case and spacing', () => {
    expect(demoVariantKey('  Squats ')).toBe('squats');
    expect(demoVariantKey('Jump   Squats')).toBe('jump squats');
    expect(demoVariantKey(null)).toBe('');
  });

  it('a clip for "squats" is not a clip for "squat", "jump squats" or "air squats"', () => {
    expect(demoMediaFor('squats', [fixture])).toEqual({ kind: 'poster', posterUri: fixture.posterUri, clipUri: fixture.clipUri });
    expect(demoMediaFor('SQUATS', [fixture]).kind).toBe('poster');
    for (const other of ['squat', 'jump squats', 'air squats', 'squats!', 'push-ups', '']) {
      expect(demoMediaFor(other, [fixture])).toEqual({ kind: 'none' });
    }
  });

  it('a supplied poster and clip reach the player as the supplied presentation, label and note unchanged', () => {
    const p = mediaPresentation(buildFollowAlongPlan({ unit: 'squats', media: demoMediaFor('squats', [fixture]) }).media);
    expect(p).toMatchObject({ kind: 'supplied', label: 'Movement guide', note: 'Demonstration only — count your own reps.' });
    expect(p.clipUri).toBe(fixture.clipUri);
    expect(p.posterUri).toBe(fixture.posterUri);
  });
});

describe('addresses: same-origin, under one prefix, nothing else', () => {
  it('accepts a plain packaged path', () => {
    expect(isAllowedDemoUri('/media/movements/squats@v1.webm', '/media/movements/')).toBe(true);
  });
  it.each([
    'https://evil.example/squats.webm',
    '//evil.example/squats.webm',
    'data:video/webm;base64,AAAA',
    'blob:http://127.0.0.1/abc',
    '/media/movements/../secret.webm',
    '/media/movements/a.webm?x=1',
    '/media/movements/',
    '/other/squats.webm',
    'gs://goarrive/clip.mp4',
  ])('refuses %s', (uri) => {
    expect(isAllowedDemoUri(uri, '/media/movements/')).toBe(false);
  });
});

describe('the test catalog is emulator-and-loopback only', () => {
  it('is read on an emulator build served from loopback', () => {
    expect(testDemoMediaCatalog('1', loopback([fixture]))).toEqual([fixture]);
    expect(testDemoMediaCatalog('true', loopback([fixture]))).toHaveLength(1);
  });
  it('is ignored on any other build or host', () => {
    expect(testDemoMediaCatalog(undefined, loopback([fixture]))).toEqual([]);
    expect(testDemoMediaCatalog('0', loopback([fixture]))).toEqual([]);
    expect(testDemoMediaCatalog('1', { location: { hostname: 'westayfit-app.web.app' }, __WSF_TEST_DEMO_MEDIA__: [fixture] })).toEqual([]);
    expect(testDemoMediaCatalog('1', undefined)).toEqual([]);
  });
  it('drops an entry that points outside the fixture prefix, wholesale', () => {
    expect(testDemoMediaCatalog('1', loopback([{ ...fixture, clipUri: 'https://evil.example/x.webm' }]))).toEqual([]);
    expect(testDemoMediaCatalog('1', loopback([{ ...fixture, posterUri: '/media/movements/p.png' }]))).toEqual([]);
    expect(testDemoMediaCatalog('1', loopback('not a list'))).toEqual([]);
  });
});

describe('playback follows the round, and is bounded', () => {
  it('plays only while the round runs', () => {
    expect(demoPlaybackFor('ready', false)).toBe('idle');
    expect(demoPlaybackFor('countdown', true)).toBe('running');
    expect(demoPlaybackFor('round', true)).toBe('running');
    expect(demoPlaybackFor('round', false)).toBe('held');
    expect(demoPlaybackFor('finished', false)).toBe('idle');
  });
  it('retries at most DEMO_RETRY_LIMIT times', () => {
    expect(DEMO_RETRY_LIMIT).toBe(2);
    expect([1, 2, 3, 4].map(shouldRetryDemo)).toEqual([true, true, false, false]);
    expect(shouldRetryDemo(0)).toBe(false);
    expect(shouldRetryDemo(Number.NaN)).toBe(false);
  });
});

describe('the media can reach nothing that counts', () => {
  const src = (p: string) => readFileSync(nodePath.resolve(__dirname, '..', p), 'utf8');

  it('the web player listens to no video event but `error`, and takes no callback from the round', () => {
    const web = src('src/ui/MovementDemoMedia.web.tsx');
    const listeners = [...web.matchAll(/addEventListener\('([a-z]+)'/g)].map((m) => m[1]);
    expect(listeners.sort()).toEqual(['error', 'visibilitychange']);
    expect(web).not.toMatch(/\bon(Ended|TimeUpdate|Play|Pause|Seeked|Loop)\b/);
    expect(web).not.toMatch(/onRound|onStart|onStop|attemptId|wsfContribute|httpsCallable/);
  });

  it('the shared props carry state into the media and no function back out', () => {
    const native = src('src/ui/MovementDemoMedia.tsx');
    const props = native.slice(native.indexOf('export type MovementDemoMediaProps'), native.indexOf('};', native.indexOf('export type MovementDemoMediaProps')));
    expect(props).not.toMatch(/=>|\(\)/);
  });

  it('the card wires the media to the round state only', () => {
    const card = src('src/ui/FollowAlongCard.tsx');
    const block = card.slice(card.indexOf('<MovementDemoMedia'), card.indexOf('/>', card.indexOf('<MovementDemoMedia')));
    expect(block).toMatch(/playback=\{demoPlaybackFor\(phase, running\)\}/);
    expect(block).not.toMatch(/onStart|onStop|onPause|onResume|onStartOver|onRound/);
  });
});
