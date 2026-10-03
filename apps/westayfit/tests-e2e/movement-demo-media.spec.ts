/**
 * EXPO-MOVEMENT-VIDEO-1 — a looping movement demonstration in the EXISTING
 * player's media slot, and nothing else.
 *
 * What is being guarded:
 *   1. A movement with NO approved clip keeps the drawn movement guide exactly
 *      as it was. There is no approved production clip in this repository
 *      today, so that is every real movement — and nothing may imply a video.
 *   2. A movement WITH a clip shows its poster first, then a muted, inline,
 *      looping demonstration that plays only while the round runs, pauses with
 *      it, and goes back to the poster when the round is reset.
 *   3. A clip that will not play (rejected `play()`, a load error, a missing
 *      poster) retries a bounded number of times and then settles on the
 *      poster, or on the drawn guide — never a spinner, never a blank.
 *   4. Reduced motion shows the poster and never plays.
 *   5. THE VIDEO DRIVES NOTHING. `ended`, `timeupdate`, a loop or a pause on
 *      the video never starts a round, mints an attempt, counts anything,
 *      records anything, or moves the clock.
 *
 * THE CLIP IS A TEST-ONLY FIXTURE. No approved movement clip exists, so the
 * playback proof uses a clip GENERATED IN THE BROWSER at test time — a moving
 * bar under the words "TEST FIXTURE — not a movement demonstration" on every
 * frame — served through a route and injected through the emulator-only test
 * catalog. It is never written into the app or the repository, and it is not
 * a demonstration of any exercise.
 *
 * Captures (WSF_MOVEMENT_MEDIA_LABEL=before|after) are written to
 * tests-e2e/artifacts/movement-demo-media/ and are not committed by the run.
 *
 * Emulator fixture data only: synthetic accounts, a synthetic community.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import {
  callAs,
  contributionsOf,
  openEnrolledStation,
  openPhone,
  seedExpoEvent,
  shardTotal,
  turnEntriesOf,
  type ExpoFixture,
} from './helpers/expo-attendee-fixtures';

test.describe.configure({ timeout: 240_000 });

const ARTIFACTS = path.resolve(__dirname, 'artifacts', 'movement-demo-media');
const LABEL = process.env.WSF_MOVEMENT_MEDIA_LABEL;
const FIXTURE_PREFIX = '/__wsf-test-fixture__/';
const FIXTURE_CLIP = `${FIXTURE_PREFIX}squats-demo.webm`;
const FIXTURE_POSTER = `${FIXTURE_PREFIX}squats-poster.png`;

/** The callables a video must never cause. */
const SIDE_EFFECT_CALLABLES =
  /wsfContribute|wsfStartTurn|wsfCompleteTurn|wsfCompleteMyTurn|wsfJoinTurnLine|wsfTurnReady|wsfCallNext/;

// ---------------------------------------------------------------------------
// The test-only fixture, generated once per worker in a blank page.
// ---------------------------------------------------------------------------

type FixtureBytes = { clip: Buffer; poster: Buffer };
let fixtureBytes: FixtureBytes | null = null;

async function generateFixture(browser: Browser): Promise<FixtureBytes> {
  if (fixtureBytes) return fixtureBytes;
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setContent('<canvas id="c" width="320" height="240"></canvas>');
  const out = await page.evaluate(async () => {
    const canvas = document.getElementById('c') as HTMLCanvasElement;
    const g = canvas.getContext('2d')!;
    const draw = (t: number) => {
      g.fillStyle = '#10213F';
      g.fillRect(0, 0, 320, 240);
      g.fillStyle = '#F7F5F0';
      g.font = 'bold 18px sans-serif';
      g.fillText('TEST FIXTURE', 20, 40);
      g.font = '13px sans-serif';
      g.fillText('not a movement demonstration', 20, 62);
      g.fillStyle = '#7BC67E';
      g.fillRect(20 + ((t / 8) % 260), 150, 40, 40);
    };
    draw(0);
    const poster = canvas.toDataURL('image/png');
    const stream = canvas.captureStream(25);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
    recorder.start(100);
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const frame = () => {
        const t = performance.now() - t0;
        draw(t);
        if (t < 2_000) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    recorder.stop();
    await done;
    const blob = new Blob(chunks, { type: 'video/webm' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (const b of buf) bin += String.fromCharCode(b);
    return { clip: btoa(bin), poster: poster.split(',')[1]! };
  });
  await context.close();
  fixtureBytes = { clip: Buffer.from(out.clip, 'base64'), poster: Buffer.from(out.poster, 'base64') };
  expect(fixtureBytes.clip.length, 'the fixture clip was generated').toBeGreaterThan(1_000);
  return fixtureBytes;
}

/**
 * Serve the fixture and register it in the emulator-only test catalog for ONE
 * exact variant. `clipStatus`/`posterStatus` let a test break either file.
 */
async function useFixture(
  context: BrowserContext,
  bytes: FixtureBytes,
  opts: { variant?: string; clipStatus?: number; posterStatus?: number; clipUri?: string } = {},
): Promise<void> {
  await context.route(`**${FIXTURE_PREFIX}**`, async (route) => {
    const url = route.request().url();
    if (url.endsWith('.webm')) {
      if (opts.clipStatus && opts.clipStatus !== 200) return route.fulfill({ status: opts.clipStatus, body: '' });
      return route.fulfill({ status: 200, contentType: 'video/webm', body: bytes.clip });
    }
    if (opts.posterStatus && opts.posterStatus !== 200) return route.fulfill({ status: opts.posterStatus, body: '' });
    return route.fulfill({ status: 200, contentType: 'image/png', body: bytes.poster });
  });
  await context.addInitScript(
    (entry) => {
      (window as unknown as { __WSF_TEST_DEMO_MEDIA__?: unknown }).__WSF_TEST_DEMO_MEDIA__ = [entry];
    },
    {
      variant: opts.variant ?? 'squats',
      posterUri: FIXTURE_POSTER,
      clipUri: opts.clipUri ?? FIXTURE_CLIP,
      source: 'TEST FIXTURE — generated in the browser; not a movement demonstration',
    },
  );
}

/** Count every play() call, and optionally make every one of them reject. */
async function instrumentPlay(context: BrowserContext, reject: boolean): Promise<void> {
  await context.addInitScript((shouldReject) => {
    const w = window as unknown as { __wsfPlayCalls: number };
    w.__wsfPlayCalls = 0;
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) {
      w.__wsfPlayCalls += 1;
      if (shouldReject) return Promise.reject(new DOMException('blocked by test', 'NotAllowedError'));
      return original.call(this);
    };
  }, reject);
}

async function snap(page: Page, name: string): Promise<void> {
  if (!LABEL) return;
  mkdirSync(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS, `${LABEL}-${name}.png`), fullPage: false });
}

async function openMove(browser: Browser, fx: ExpoFixture, viewport = { width: 390, height: 844 }) {
  const phone = await openPhone(browser, fx.attendees[0]!);
  await phone.page.setViewportSize(viewport);
  return phone;
}

async function gotoMove(page: Page, goalId: string): Promise<void> {
  await page.goto(`/move/${goalId}`);
  await expect(page.getByTestId('wsf-move-start')).toBeVisible({ timeout: 40_000 });
}

const demoState = (page: Page, prefix = 'wsf-move') =>
  page.getByTestId(`${prefix}-demo`).getAttribute('data-demo-state');

async function videoFacts(page: Page, prefix = 'wsf-move') {
  return page.getByTestId(`${prefix}-video`).evaluate((v: HTMLVideoElement) => ({
    paused: v.paused,
    muted: v.muted,
    loop: v.loop,
    playsInline: v.playsInline,
    autoplay: v.autoplay,
    controls: v.controls,
    currentTime: v.currentTime,
    src: v.currentSrc || v.getAttribute('src') || '',
  }));
}

// ---------------------------------------------------------------------------
// Captures: BEFORE on the base, AFTER on the subject, same fixtures.
// ---------------------------------------------------------------------------

test('capture: the player at 390x640, 390x844 and on the station canvas (fixture labelled)', async ({ browser }) => {
  test.skip(!LABEL, 'capture producer: set WSF_MOVEMENT_MEDIA_LABEL=before|after');
  const bytes = await generateFixture(browser);
  const fx = await seedExpoEvent({ tag: `mvcap${LABEL}`, attendees: ['Fixture Mover', 'Fixture Turn'], target: 1000, seededTotal: 120 });
  for (const vp of [
    { width: 390, height: 640 },
    { width: 390, height: 844 },
  ]) {
    const phone = await openMove(browser, fx, vp);
    try {
      await useFixture(phone.context, bytes);
      await gotoMove(phone.page, fx.goalId);
      await phone.page.waitForTimeout(1_500);
      await snap(phone.page, `move-ready-${vp.width}x${vp.height}`);
      await phone.page.getByTestId('wsf-move-start').click();
      await phone.page.waitForTimeout(5_000);
      await snap(phone.page, `move-round-${vp.width}x${vp.height}`);
    } finally {
      await phone.context.close();
    }
  }

  const station = await openEnrolledStation(browser, fx, 1);
  try {
    await useFixture(station.context, bytes);
    await station.page.reload();
    await expect(station.page.getByTestId('wsf-station-screen')).toBeVisible({ timeout: 40_000 });
    const who = fx.attendees[1]!;
    const join = await callAs<{ entryId: string }>(who.email, 'wsfJoinTurnLine', { goalId: fx.goalId, calledName: 'Fixture T' });
    expect(join.ok).toBe(true);
    if (!join.ok) return;
    await station.page.getByTestId('wsf-station-call-next').click();
    await expect(station.page.getByTestId('wsf-station-queue-serving')).toHaveText('Fixture T', { timeout: 25_000 });
    expect((await callAs(who.email, 'wsfTurnReady', { entryId: join.result.entryId })).ok).toBe(true);
    await expect(station.page.getByTestId('wsf-station-turn-action')).toBeEnabled({ timeout: 25_000 });
    await station.page.getByTestId('wsf-station-turn-action').click();
    await expect(station.page.getByTestId('wsf-station-move-start')).toBeVisible({ timeout: 25_000 });
    await station.page.waitForTimeout(1_500);
    await snap(station.page, 'station-turn-ready-1280x720');
    await station.page.getByTestId('wsf-station-move-start').click();
    await station.page.waitForTimeout(5_000);
    await snap(station.page, 'station-turn-round-1280x720');
  } finally {
    await station.context.close();
  }
});

// ---------------------------------------------------------------------------
// Behaviour.
// ---------------------------------------------------------------------------

test('a movement with no approved clip keeps the drawn guide, and nothing on the page is a video', async ({ browser }) => {
  const fx = await seedExpoEvent({ tag: 'mvnone', attendees: ['Fixture Mover'], target: 1000, seededTotal: 0 });
  const phone = await openMove(browser, fx);
  try {
    await gotoMove(phone.page, fx.goalId);
    await expect(phone.page.getByTestId('wsf-move-figure-image')).toBeVisible();
    await expect(phone.page.getByTestId('wsf-move-media-label')).toHaveText('Movement guide');
    await expect(phone.page.getByTestId('wsf-move-media-note')).toHaveText('Demonstration only — count your own reps.');
    expect(await phone.page.locator('video').count()).toBe(0);
    await phone.page.getByTestId('wsf-move-start').click();
    await phone.page.waitForTimeout(1_500);
    expect(await phone.page.locator('video').count()).toBe(0);
    phone.assertNoCrash('/move without a clip');
  } finally {
    await phone.context.close();
  }
});

test('a clip shows its poster first, then a muted inline loop that plays only while the round runs', async ({ browser }) => {
  const bytes = await generateFixture(browser);
  const fx = await seedExpoEvent({ tag: 'mvplay', attendees: ['Fixture Mover'], target: 1000, seededTotal: 0 });
  const phone = await openMove(browser, fx);
  try {
    await useFixture(phone.context, bytes);
    await gotoMove(phone.page, fx.goalId);
    const { page } = phone;

    // READY: the poster is up, the video is loaded but not playing.
    await expect(page.getByTestId('wsf-move-poster')).toBeVisible();
    await expect(page.getByTestId('wsf-move-video')).toHaveCount(1);
    expect(await demoState(page)).toBe('poster');
    const ready = await videoFacts(page);
    expect(ready).toMatchObject({ paused: true, muted: true, loop: true, playsInline: true, autoplay: false, controls: false });
    expect(ready.src).toContain(FIXTURE_CLIP);
    // The visible instructions and the counting rule are unchanged.
    await expect(page.getByTestId('wsf-move-media-label')).toHaveText('Movement guide');
    await expect(page.getByTestId('wsf-move-media-note')).toHaveText('Demonstration only — count your own reps.');
    await expect(page.getByTestId('wsf-move-self-count')).toBeVisible();

    // START: it plays.
    await page.getByTestId('wsf-move-start').click();
    await expect.poll(() => demoState(page), { timeout: 15_000 }).toBe('playing');
    await expect.poll(async () => (await videoFacts(page)).currentTime, { timeout: 10_000 }).toBeGreaterThan(0.2);

    // PAUSE: it stops with the round.
    await page.getByTestId('wsf-move-pause').click();
    await expect.poll(async () => (await videoFacts(page)).paused, { timeout: 5_000 }).toBe(true);
    expect(await demoState(page)).toBe('paused');

    // RESUME: it plays again.
    await page.getByTestId('wsf-move-start').click();
    await expect.poll(async () => (await videoFacts(page)).paused, { timeout: 5_000 }).toBe(false);

    // STOP: paused and back to the first frame; the poster is up again.
    await page.getByTestId('wsf-move-stop').click();
    await expect(page.getByTestId('wsf-move-finished')).toBeVisible();
    await expect.poll(async () => (await videoFacts(page)).paused, { timeout: 5_000 }).toBe(true);
    await expect.poll(async () => (await videoFacts(page)).currentTime, { timeout: 5_000 }).toBeLessThan(0.05);
    expect(await demoState(page)).toBe('poster');
    phone.assertNoCrash('/move with the fixture');
  } finally {
    await phone.context.close();
  }
});

test('the video drives nothing: ended, timeupdate, a loop or a pause never start, time, count or record a round', async ({ browser }) => {
  const bytes = await generateFixture(browser);
  const fx = await seedExpoEvent({ tag: 'mvinert', attendees: ['Fixture Mover'], target: 1000, seededTotal: 50 });
  const phone = await openMove(browser, fx);
  try {
    await useFixture(phone.context, bytes);
    const calls: string[] = [];
    phone.page.on('request', (r) => {
      if (SIDE_EFFECT_CALLABLES.test(r.url())) calls.push(r.url());
    });
    await gotoMove(phone.page, fx.goalId);
    const { page } = phone;
    const fire = (names: string[]) =>
      page.getByTestId('wsf-move-video').evaluate((v: HTMLVideoElement, list: string[]) => {
        for (const n of list) v.dispatchEvent(new Event(n));
      }, names);

    // In READY: the events start nothing.
    await fire(['ended', 'timeupdate', 'seeked', 'play', 'playing', 'pause', 'ended']);
    await page.waitForTimeout(1_000);
    expect(await page.getByTestId('wsf-move-screen').getAttribute('data-phase')).toBe('ready');
    await expect(page.getByTestId('wsf-move-timer')).toHaveText('60s');
    await expect(page.getByTestId('wsf-move-start')).toHaveText('Start');

    // In the ROUND: the clock keeps its own time through every video event.
    await page.getByTestId('wsf-move-start').click();
    await expect.poll(async () => page.getByTestId('wsf-move-screen').getAttribute('data-phase'), { timeout: 10_000 }).toBe('round');
    const before = Number((await page.getByTestId('wsf-move-timer').innerText()).replace(/\D+/g, ''));
    await fire(['pause', 'ended', 'stalled', 'waiting', 'seeked', 'timeupdate', 'ended']);
    await page.waitForTimeout(2_200);
    const after = Number((await page.getByTestId('wsf-move-timer').innerText()).replace(/\D+/g, ''));
    expect(after, 'the round kept counting down').toBeLessThan(before);
    expect(after, 'and did not jump').toBeGreaterThan(before - 5);
    expect(await page.getByTestId('wsf-move-screen').getAttribute('data-phase')).toBe('round');
    await expect(page.getByTestId('wsf-move-interrupted')).toHaveCount(0);
    await expect(page.getByTestId('wsf-move-pause')).toBeVisible();

    // Nothing was sent and nothing was recorded.
    expect(calls).toEqual([]);
    expect(await contributionsOf(fx.goalId, fx.attendees[0]!.uid)).toEqual([]);
    expect(await shardTotal(fx.goalId)).toBe(50);
  } finally {
    await phone.context.close();
  }
});

test('a station turn: the demo loops in the station player, its events neither start nor count the turn, and recording releases it', async ({ browser }) => {
  const bytes = await generateFixture(browser);
  const fx = await seedExpoEvent({ tag: 'mvstation', attendees: ['Fixture Turn'], target: 1000, seededTotal: 10 });
  const station = await openEnrolledStation(browser, fx, 1);
  try {
    await useFixture(station.context, bytes);
    await station.page.reload();
    await expect(station.page.getByTestId('wsf-station-screen')).toBeVisible({ timeout: 40_000 });
    const who = fx.attendees[0]!;
    const join = await callAs<{ entryId: string }>(who.email, 'wsfJoinTurnLine', { goalId: fx.goalId, calledName: 'Fixture T' });
    expect(join.ok).toBe(true);
    if (!join.ok) return;
    await station.page.getByTestId('wsf-station-call-next').click();
    await expect(station.page.getByTestId('wsf-station-queue-serving')).toHaveText('Fixture T', { timeout: 25_000 });

    // Called, not ready: the video's events do not start the turn.
    const calls: string[] = [];
    station.page.on('request', (r) => {
      if (/wsfStartTurn|wsfCompleteTurn|wsfContribute/.test(r.url())) calls.push(r.url());
    });
    expect((await callAs(who.email, 'wsfTurnReady', { entryId: join.result.entryId })).ok).toBe(true);
    await expect(station.page.getByTestId('wsf-station-turn-action')).toBeEnabled({ timeout: 25_000 });
    await station.page.getByTestId('wsf-station-turn-action').click();
    await expect(station.page.getByTestId('wsf-station-move-start')).toBeVisible({ timeout: 25_000 });
    calls.length = 0; // the deliberate Start above is the station's own press

    await expect(station.page.getByTestId('wsf-station-move-video')).toHaveCount(1);
    expect(await demoState(station.page, 'wsf-station-move')).toBe('poster');
    await station.page.getByTestId('wsf-station-move-video').evaluate((v: HTMLVideoElement) => {
      for (const n of ['ended', 'timeupdate', 'seeked', 'ended', 'pause']) v.dispatchEvent(new Event(n));
    });
    await station.page.waitForTimeout(1_000);
    await expect(station.page.getByTestId('wsf-station-move-start')).toBeVisible();
    expect(calls).toEqual([]);

    await station.page.getByTestId('wsf-station-move-start').click();
    await expect.poll(() => demoState(station.page, 'wsf-station-move'), { timeout: 15_000 }).toBe('playing');
    await station.page.getByTestId('wsf-station-move-video').evaluate((v: HTMLVideoElement) => {
      for (const n of ['ended', 'ended', 'timeupdate', 'pause']) v.dispatchEvent(new Event(n));
    });
    await station.page.waitForTimeout(1_500);
    expect(calls).toEqual([]);
    const [entry] = await turnEntriesOf(fx.goalId, who.uid);
    expect(entry?.status).toBe('active');
    expect(entry?.resultAmount).toBeNull();
    expect(await contributionsOf(fx.goalId, who.uid)).toEqual([]);
    expect(await shardTotal(fx.goalId)).toBe(10);

    // RELEASED ON THE WAY OUT. Recording the turn — the station's own press,
    // and the only thing that counts — takes the player off the hall screen.
    // The clip it was looping is paused and its source dropped.
    await station.page.getByTestId('wsf-station-move-video').evaluate((v: HTMLVideoElement) => {
      (window as unknown as { __wsfVideo: HTMLVideoElement }).__wsfVideo = v;
    });
    await station.page.getByTestId('wsf-station-move-stop').click();
    await station.page.getByTestId('wsf-station-turn-count').fill('12');
    await station.page.getByTestId('wsf-station-turn-action').click();
    await expect(station.page.getByTestId('wsf-station-move-video')).toHaveCount(0, { timeout: 25_000 });
    const released = await station.page.evaluate(() => {
      const v = (window as unknown as { __wsfVideo: HTMLVideoElement }).__wsfVideo;
      return { paused: v.paused, src: v.getAttribute('src'), connected: v.isConnected };
    });
    expect(released).toEqual({ paused: true, src: null, connected: false });
    // Exactly the one deliberate record, and none from the video.
    const rows = await contributionsOf(fx.goalId, who.uid);
    expect(rows).toHaveLength(1);
    expect(await shardTotal(fx.goalId)).toBe(22);
    station.assertNoCrash('the station with the fixture');
  } finally {
    await station.context.close();
  }
});

test('a rejected play() retries a bounded number of times, then settles on the poster and the round still runs', async ({ browser }) => {
  const bytes = await generateFixture(browser);
  const fx = await seedExpoEvent({ tag: 'mvreject', attendees: ['Fixture Mover'], target: 1000, seededTotal: 0 });
  const phone = await openMove(browser, fx);
  try {
    await useFixture(phone.context, bytes);
    await instrumentPlay(phone.context, true);
    await gotoMove(phone.page, fx.goalId);
    const { page } = phone;
    await page.getByTestId('wsf-move-start').click();
    await expect.poll(() => demoState(page), { timeout: 15_000 }).toBe('fallback');
    const tries = await page.evaluate(() => (window as unknown as { __wsfPlayCalls: number }).__wsfPlayCalls);
    expect(tries).toBeGreaterThanOrEqual(1);
    expect(tries, 'bounded: one try plus at most two retries').toBeLessThanOrEqual(3);
    await page.waitForTimeout(2_500);
    expect(await page.evaluate(() => (window as unknown as { __wsfPlayCalls: number }).__wsfPlayCalls)).toBe(tries);
    await expect(page.getByTestId('wsf-move-poster')).toBeVisible();
    await expect(page.getByTestId('wsf-move-video')).toHaveCount(0);
    expect(await page.getByTestId('wsf-move-screen').getAttribute('data-phase')).toBe('round');
    await expect(page.getByTestId('wsf-move-pause')).toBeVisible();
  } finally {
    await phone.context.close();
  }
});

test('a clip that will not load falls back to the poster; a poster that will not load falls back to the drawn guide', async ({ browser }) => {
  const bytes = await generateFixture(browser);
  const fx = await seedExpoEvent({ tag: 'mvload', attendees: ['Fixture Mover', 'Fixture Two'], target: 1000, seededTotal: 0 });
  const a = await openMove(browser, fx);
  try {
    await useFixture(a.context, bytes, { clipStatus: 404 });
    await gotoMove(a.page, fx.goalId);
    await expect.poll(() => demoState(a.page), { timeout: 15_000 }).toBe('fallback');
    await expect(a.page.getByTestId('wsf-move-poster')).toBeVisible();
    await expect(a.page.getByTestId('wsf-move-video')).toHaveCount(0);
    await a.page.getByTestId('wsf-move-start').click();
    await expect(a.page.getByTestId('wsf-move-pause')).toBeVisible();
  } finally {
    await a.context.close();
  }
  const b = await openPhone(browser, fx.attendees[1]!);
  try {
    await useFixture(b.context, bytes, { clipStatus: 404, posterStatus: 404 });
    await gotoMove(b.page, fx.goalId);
    await expect(b.page.getByTestId('wsf-move-figure-image')).toBeVisible({ timeout: 15_000 });
    await expect(b.page.getByTestId('wsf-move-video')).toHaveCount(0);
    await expect(b.page.getByTestId('wsf-move-media-label')).toHaveText('Movement guide');
  } finally {
    await b.context.close();
  }
});

test('reduced motion shows the poster and never plays', async ({ browser }) => {
  const bytes = await generateFixture(browser);
  const fx = await seedExpoEvent({ tag: 'mvreduced', attendees: ['Fixture Mover'], target: 1000, seededTotal: 0 });
  const phone = await openMove(browser, fx);
  try {
    await useFixture(phone.context, bytes);
    await instrumentPlay(phone.context, false);
    await phone.page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoMove(phone.page, fx.goalId);
    await expect.poll(() => demoState(phone.page), { timeout: 10_000 }).toBe('static');
    await expect(phone.page.getByTestId('wsf-move-poster')).toBeVisible();
    await phone.page.getByTestId('wsf-move-start').click();
    await phone.page.waitForTimeout(2_000);
    await expect(phone.page.getByTestId('wsf-move-video')).toHaveCount(0);
    expect(await phone.page.evaluate(() => (window as unknown as { __wsfPlayCalls: number }).__wsfPlayCalls)).toBe(0);
  } finally {
    await phone.context.close();
  }
});

test('a hidden tab pauses the demo with the round', async ({ browser }) => {
  const bytes = await generateFixture(browser);
  const fx = await seedExpoEvent({ tag: 'mvhidden', attendees: ['Fixture Mover'], target: 1000, seededTotal: 0 });
  const phone = await openMove(browser, fx);
  try {
    await useFixture(phone.context, bytes);
    await gotoMove(phone.page, fx.goalId);
    const { page } = phone;
    await page.getByTestId('wsf-move-start').click();
    await expect.poll(() => demoState(page), { timeout: 15_000 }).toBe('playing');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.getByTestId('wsf-move-interrupted')).toBeVisible();
    await expect.poll(async () => (await videoFacts(page)).paused, { timeout: 5_000 }).toBe(true);

  } finally {
    await phone.context.close();
  }
});

test('only the exact approved variant gets the clip: no implicit movement equivalence, no outside address', async ({ browser }) => {
  const bytes = await generateFixture(browser);
  const fx = await seedExpoEvent({ tag: 'mvexact', attendees: ['Fixture Mover', 'Fixture Two'], target: 1000, seededTotal: 0 });
  // A clip registered for "squat" (singular) does not play for a "squats" goal.
  const a = await openMove(browser, fx);
  try {
    await useFixture(a.context, bytes, { variant: 'squat' });
    await gotoMove(a.page, fx.goalId);
    await expect(a.page.getByTestId('wsf-move-figure-image')).toBeVisible();
    expect(await a.page.locator('video').count()).toBe(0);
  } finally {
    await a.context.close();
  }
  // An entry pointing outside the app is refused outright.
  const b = await openPhone(browser, fx.attendees[1]!);
  try {
    await useFixture(b.context, bytes, { clipUri: 'https://evil.example/squats.webm' });
    await gotoMove(b.page, fx.goalId);
    await expect(b.page.getByTestId('wsf-move-figure-image')).toBeVisible();
    expect(await b.page.locator('video').count()).toBe(0);
  } finally {
    await b.context.close();
  }
});
