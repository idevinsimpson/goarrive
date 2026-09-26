import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { expect, test, type FrameLocator, type Page } from '@playwright/test';

import { CAPTURE_FRAMES } from './helpers/capture';
import { firestoreWrite, seedProfile, seedShards, seedVerifiedUser, signInVia, stampId, tsField } from './helpers/mobile';

/**
 * W9 — COMMUNITY-SETTINGS-PARITY-1: THE FRAMES.
 *
 *   WSF_CSP_STAGE=BEFORE     the lane's base product, PERF successor 889e9775, served
 *   WSF_CSP_STAGE=CANDIDATE  this checkpoint's build, served
 *
 * One meaningful fixture (the shape W7's Check 45 uses): the member is in two
 * communities; the current one has a featured open goal, a second open goal
 * that is reached, one closed goal reached and one closed unfinished, a
 * Champion, and a member whose name is private.
 *
 * States at 390x640 and 390x844:
 *   community              the Community tab, settled
 *   community-lower        the same tab scrolled to history and the roster
 *   settings-open          Settings opened from You's own Settings row, settled
 * CANDIDATE only, at both sizes:
 *   switch-{000,050}ms / switch-settled   the second community's chip pressed:
 *                          the frame straight after the press, 50 ms later, and
 *                          settled -- the heading and every figure under it
 *                          belong to the chosen community in each
 *   settings-entry-{000,120,240}ms / settings-exit-{000,090,170}ms  the panel's
 *                          own CSS animations paused at fixed times; the exit's
 *                          180 ms navigation timer held while photographed, then
 *                          released (labelled instrumentation)
 *   settings-closed        after Close: the panel gone, focus back on You's
 *                          Settings row (receipt: the focused element)
 *   reduced-settings-open / reduced-settings-closed  the same with
 *                          prefers-reduced-motion: no animation runs, and Close
 *                          dismisses without the 180 ms wait (receipt: both)
 *
 * Each frame carries its stage, the served build's commit and "NOT ACCEPTED";
 * writes only with WSF_CAPTURE_FRAMES=1. Everything is SYNTHETIC.
 *
 *   WSF_CSP_CHECKPOINT=cp3   names a later checkpoint's frames apart
 *                            (`CANDIDATE-cp3-…`), so an earlier checkpoint's
 *                            committed frames are kept, not overwritten
 */

const OUT = path.resolve(__dirname, '../../../docs/design-target/review/community-settings-parity-1');
const STAGE = (process.env.WSF_CSP_STAGE ?? 'CANDIDATE').toUpperCase();
if (STAGE !== 'BEFORE' && STAGE !== 'CANDIDATE') throw new Error(`bad stage ${STAGE}`);
const CANDIDATE = STAGE === 'CANDIDATE';
const CHECKPOINT = (process.env.WSF_CSP_CHECKPOINT ?? '').trim();
if (CHECKPOINT && !/^cp[0-9]+$/.test(CHECKPOINT)) throw new Error(`bad checkpoint ${CHECKPOINT}`);
const PREFIX = CHECKPOINT ? `${STAGE}-${CHECKPOINT}` : STAGE;
const BASE_SHORT = '889e9775';
const BANNER = 18;
const DAY = 864e5;
const DEVICES = [
  { key: '390x640', width: 390, height: 640 },
  { key: '390x844', width: 390, height: 844 },
] as const;
type Device = (typeof DEVICES)[number];

async function person(tag: string, name: string) {
  const email = `wsf-w9csp-${tag}-${stampId()}@example.com`;
  const password = `Aa1!${crypto.randomBytes(6).toString('hex')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, name);
  return { uid, email, password, name };
}

async function community(
  id: string,
  name: string,
  groupType: string,
  joinPolicy: string,
  champ: string,
  members: Array<[string, 'member' | 'foundingChampion', Record<string, unknown>?]>,
) {
  const now = new Date();
  await firestoreWrite(`wsfCommunityGroups/${id}`, {
    displayName: { stringValue: name },
    groupType: { stringValue: groupType },
    joinPolicy: { stringValue: joinPolicy },
    joinCode: { stringValue: `JOIN${crypto.randomBytes(4).toString('hex')}` },
    createdByUserId: { stringValue: champ },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });
  for (const [uid, role, extra] of members) {
    await firestoreWrite(`wsfMemberships/${id}_${uid}`, {
      groupId: { stringValue: id },
      userId: { stringValue: uid },
      role: { stringValue: role },
      membershipStatus: { stringValue: 'active' },
      createdAt: tsField(now),
      updatedAt: tsField(now),
      ...(extra ?? {}),
    });
  }
}

async function goal(
  id: string,
  groupId: string,
  owner: string,
  title: string,
  unit: string,
  target: number,
  shared: number,
  open: boolean,
  endsInDays: number,
) {
  const now = Date.now();
  const f: Record<string, unknown> = {
    ownerUid: { stringValue: owner },
    communityGroupId: { stringValue: groupId },
    title: { stringValue: title },
    target: { integerValue: String(target) },
    unit: { stringValue: unit },
    status: { stringValue: open ? 'active' : 'closed' },
    startsAt: tsField(new Date(now - 20 * DAY)),
    endsAt: tsField(new Date(now + endsInDays * DAY)),
    timezone: { stringValue: 'America/New_York' },
    aggregateDisplayAuthorized: { booleanValue: true },
    createdAt: tsField(new Date(now - 20 * DAY)),
    updatedAt: tsField(new Date(now)),
  };
  if (!open) f.closedAt = tsField(new Date(now + endsInDays * DAY));
  await firestoreWrite(`wsfGoals/${id}`, f);
  if (shared > 0) await seedShards(id, shared);
}

async function fixture(tag: string) {
  const s = `${stampId()}${tag}`;
  const m = await person(`${tag}m`, 'Mara Ellis');
  const o = await person(`${tag}o`, 'Olu Adeyemi');
  const q = await person(`${tag}q`, 'Quinn Park');
  const c1 = { id: `w9cspc1-${s}`, name: 'Harbor Movers' };
  const c2 = { id: `w9cspc2-${s}`, name: 'Summit Walkers' };
  await community(c1.id, c1.name, 'familyFriends', 'inviteOnly', o.uid, [
    [o.uid, 'foundingChampion'],
    [m.uid, 'member'],
    [q.uid, 'member', { communityNameVisibility: { stringValue: 'private' } }],
  ]);
  await community(c2.id, c2.name, 'custom', 'private', o.uid, [
    [o.uid, 'foundingChampion'],
    [m.uid, 'member'],
  ]);
  await goal(`w9cspG1-${s}`, c1.id, o.uid, 'Harbor Squat Month', 'squats', 500, 180, true, 5);
  await goal(`w9cspG2-${s}`, c1.id, o.uid, 'Minutes Together', 'minutes', 120, 130, true, 9);
  await goal(`w9cspR-${s}`, c1.id, o.uid, 'Spring Squat Sprint', 'squats', 200, 230, false, -3);
  await goal(`w9cspU-${s}`, c1.id, o.uid, 'Winter Squat Stretch', 'squats', 400, 150, false, -10);
  await goal(`w9cspC2-${s}`, c2.id, o.uid, 'Summit Steps', 'steps', 1000, 200, true, 6);
  return { m, c1, c2 };
}

async function easel(page: Page, device: Device, src: string): Promise<{ stage: FrameLocator; label: string; commit: string }> {
  await page.goto('/health');
  const commit = ((await page.getByTestId('wsf-health-commit').innerText()).match(/[0-9a-f]{7,40}/) ?? [''])[0];
  expect(commit).not.toBe('');
  if (CANDIDATE) expect(commit).not.toBe(BASE_SHORT);
  else expect(commit).toBe(BASE_SHORT);
  const label = `${STAGE}${CHECKPOINT ? ` ${CHECKPOINT.toUpperCase()}` : ''} BUILD ${commit} / NOT ACCEPTED`;
  await page.evaluate(
    ({ w, h, banner, label, source }) => {
      document.documentElement.style.background = '#FFFFFF';
      document.body.style.cssText = 'margin:0;padding:0;background:#FFFFFF';
      document.body.innerHTML = `
        <div data-testid="wsf-w9csp-frame" style="width:${w}px;height:${h + banner}px;background:#FFFFFF;overflow:hidden;">
          <div data-testid="wsf-w9csp-banner"
               style="height:${banner}px;width:${w}px;background:#0B1F35;color:#F7F5F0;
                      font:700 10px/${banner}px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
                      letter-spacing:.9px;text-align:center;box-sizing:border-box;border-bottom:1px solid #F7F5F0;">${label}</div>
          <iframe id="wsf-w9csp-stage" src="${source}" style="width:${w}px;height:${h}px;border:0;display:block;"></iframe>
        </div>`;
    },
    { w: device.width, h: device.height, banner: BANNER, label, source: src },
  );
  return { stage: page.frameLocator('#wsf-w9csp-stage'), label, commit };
}

const files: string[] = [];

async function shoot(page: Page, device: Device, label: string, name: string, settle = 800): Promise<void> {
  await expect(page.getByTestId('wsf-w9csp-banner')).toHaveText(label);
  if (settle) await page.waitForTimeout(settle);
  const file = `${PREFIX}-${name}-${device.key}.png`;
  if (CAPTURE_FRAMES) {
    fs.mkdirSync(OUT, { recursive: true });
    await page.getByTestId('wsf-w9csp-frame').screenshot({ path: path.join(OUT, file) });
  }
  files.push(file);
}

function writeReceipt(name: string, device: Device, data: Record<string, unknown>): void {
  const frames = files.splice(0);
  if (!CAPTURE_FRAMES) return;
  const withDigests = {
    ...data,
    stage: STAGE,
    device: device.key,
    frames: frames.map((f) => ({
      file: f,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(OUT, f))).digest('hex'),
    })),
  };
  fs.writeFileSync(path.join(OUT, `${PREFIX}-${name}-${device.key}.json`), `${JSON.stringify(withDigests, null, 2)}\n`);
}

async function holdAnimationsAt(stage: FrameLocator, t: number): Promise<number> {
  return stage.locator('body').evaluate((_b, at) => {
    const anims = document.getAnimations().filter((a) => {
      const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
      return Boolean(target?.matches?.('[data-wsf-side-panel], [data-wsf-sheet-scrim]'));
    });
    anims.forEach((a) => {
      a.pause();
      a.currentTime = at;
    });
    return anims.length;
  }, t);
}

/** Holds every timer of exactly `ms` until `releaseTimers` (labelled instrumentation). */
async function holdTimers(stage: FrameLocator, ms: number): Promise<void> {
  await stage.locator('body').evaluate((_b, hold) => {
    const w = window as unknown as { __w9Held: (() => void)[]; __w9Orig: typeof setTimeout };
    w.__w9Held = [];
    w.__w9Orig = window.setTimeout;
    (window as unknown as { setTimeout: unknown }).setTimeout = ((fn: () => void, t?: number, ...rest: unknown[]) => {
      if (t === hold) {
        w.__w9Held.push(fn);
        return -1;
      }
      return w.__w9Orig(fn, t, ...(rest as []));
    }) as unknown;
  }, ms);
}

async function releaseTimers(stage: FrameLocator): Promise<number> {
  return stage.locator('body').evaluate(() => {
    const w = window as unknown as { __w9Held: (() => void)[]; __w9Orig: typeof setTimeout };
    (window as unknown as { setTimeout: unknown }).setTimeout = w.__w9Orig;
    const n = w.__w9Held.length;
    w.__w9Held.splice(0).forEach((fn) => fn());
    return n;
  });
}

/** What holds focus inside the app frame. */
async function focused(stage: FrameLocator): Promise<{ testId: string | null; label: string }> {
  return stage.locator('body').evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    return {
      testId: a?.getAttribute('data-testid') ?? null,
      label: (a?.getAttribute('aria-label') ?? a?.innerText ?? a?.tagName ?? '').trim().slice(0, 40),
    };
  });
}

async function openCommunity(page: Page, device: Device, fx: Awaited<ReturnType<typeof fixture>>) {
  await signInVia(page, fx.m.email, fx.m.password);
  await page.evaluate(([u, g]) => localStorage.setItem(`wsf.currentCommunity.${u}`, g), [fx.m.uid, fx.c1.id] as const);
  const easelled = await easel(page, device, '/community');
  await expect(easelled.stage.getByText('Harbor Squat Month').first()).toBeVisible({ timeout: 60_000 });
  return easelled;
}

async function openYou(stage: FrameLocator) {
  await stage.locator('[data-testid="wsf-member-tab-you"]:visible').last().click();
  await expect(stage.locator('[data-testid="wsf-you-settings"]:visible')).toBeVisible({ timeout: 40_000 });
}

test.describe(`COMMUNITY-SETTINGS-PARITY-1 frames · ${STAGE}`, () => {
  test.use({ viewport: { width: 600, height: 1100 }, deviceScaleFactor: 2 });

  for (const device of DEVICES) {
    test(`${device.key}: the Community tab, its lower half, switching, and Settings from You`, async ({ page }) => {
      test.setTimeout(300_000);
      const fx = await fixture(`s${device.height}`);
      const { stage, label, commit } = await openCommunity(page, device, fx);
      await shoot(page, device, label, 'community', 1_500);

      // W4's view scrolls itself: the scroller is the first scrollable element inside the tab.
      await stage.locator('[data-testid="wsf-community-index"]:visible').evaluate((root) => {
        const lower = root.querySelector('[data-testid="wsf-parity-history"]') as HTMLElement | null;
        const box = (Array.from(root.querySelectorAll('*')).find(
          (n) => (n as HTMLElement).scrollHeight > (n as HTMLElement).clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(n).overflowY),
        ) ?? root) as HTMLElement;
        box.scrollTop = lower
          ? lower.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 12
          : 600;
      });
      await shoot(page, device, label, 'community-lower', 600);
      await stage.locator('[data-testid="wsf-community-index"]:visible').evaluate((root) => {
        for (const n of Array.from(root.querySelectorAll('*'))) (n as HTMLElement).scrollTop = 0;
      });

      /*
        Switching: in every frame after the press, the heading and the period
        under it belong to ONE community -- never the new name over the old
        community's goal, or the reverse.
      */
      const switched: Record<string, { name: string; period: string }> = {};
      const pairNow = async () => ({
        name: await stage.locator('[data-testid="wsf-parity-name"]:visible').innerText(),
        period: await stage
          .locator('[data-testid="wsf-parity-period-title"]:visible, [data-testid="wsf-parity-goals-loading"]:visible')
          .first()
          .innerText(),
      });
      const coherent = ({ name, period }: { name: string; period: string }) =>
        (name === 'Harbor Movers' && period === 'Harbor Squat Month') ||
        (name === 'Summit Walkers' && (period === 'Summit Steps' || /^Loading /.test(period)));
      if (CANDIDATE) {
        await page.waitForTimeout(400);
        await stage.locator(`[data-testid="wsf-parity-chip-${fx.c2.id}"]:visible`).click();
        await shoot(page, device, label, 'switch-000ms', 0);
        switched.at000 = await pairNow();
        await page.waitForTimeout(50);
        await shoot(page, device, label, 'switch-050ms', 0);
        switched.at050 = await pairNow();
        await expect(stage.getByText('Summit Steps').first()).toBeVisible({ timeout: 40_000 });
        await shoot(page, device, label, 'switch-settled', 1_500);
        switched.settled = await pairNow();
        for (const [k, v] of Object.entries(switched)) expect(coherent(v), `${k}: ${JSON.stringify(v)}`).toBe(true);
        expect(switched.settled!.name).toBe('Summit Walkers');
      }

      await openYou(stage);
      await page.waitForTimeout(600);
      await stage.locator('[data-testid="wsf-you-settings"]:visible').click();
      // The base build's Settings is a page with a Privacy row; the candidate's
      // panel holds the controls themselves.
      await expect(
        CANDIDATE
          ? stage.getByText('Show my name').first()
          : stage.locator('[data-testid="wsf-settings-screen"]:visible').first(),
      ).toBeVisible({ timeout: 40_000 });
      await shoot(page, device, label, 'settings-open', 1_200);
      const panel = await stage.locator('[data-testid="wsf-settings-panel"]').count();
      writeReceipt('states', device, { commit, settingsPanel: panel, switched });
    });
  }

  for (const device of DEVICES) {
    test(`${device.key}: the Settings panel in and out, paused; focus back on Settings (CANDIDATE only)`, async ({ page }) => {
      test.skip(!CANDIDATE, 'the base build has no panel');
      test.setTimeout(300_000);
      const fx = await fixture(`t${device.height}`);
      const { stage, label, commit } = await openCommunity(page, device, fx);
      await openYou(stage);
      await page.waitForTimeout(800);

      await stage.locator('[data-testid="wsf-you-settings"]:visible').click();
      await expect(stage.locator('[data-testid="wsf-settings-panel"]')).toHaveCount(1, { timeout: 20_000 });
      const held: number[] = [];
      for (const t of [0, 120, 240]) {
        held.push(await holdAnimationsAt(stage, t));
        await shoot(page, device, label, `settings-entry-${String(t).padStart(3, '0')}ms`, 0);
      }
      await expect(stage.getByText('Show my name').first()).toBeVisible({ timeout: 40_000 });
      const firstFocus = await focused(stage);
      await page.waitForTimeout(300);
      await holdTimers(stage, 180);
      await stage.locator('[data-testid="wsf-settings-close"]:visible').click();
      for (const t of [0, 90, 170]) {
        held.push(await holdAnimationsAt(stage, t));
        await shoot(page, device, label, `settings-exit-${String(t).padStart(3, '0')}ms`, 0);
      }
      const released = await releaseTimers(stage);
      expect(released, 'exactly one exit was pending').toBe(1);
      await expect(stage.locator('[data-testid="wsf-settings-panel"]')).toHaveCount(0, { timeout: 8_000 });
      await page.waitForTimeout(400);
      const returned = await focused(stage);
      expect(returned.testId).toBe('wsf-you-settings');
      await shoot(page, device, label, 'settings-closed', 0);
      writeReceipt('settings-timeline', device, {
        commit,
        animationsHeldPerFrame: held,
        exitsReleased: released,
        focusOnOpen: firstFocus,
        focusAfterClose: returned,
      });
    });

    test(`${device.key}: reduced motion: Settings opens and closes with no animation and no wait (CANDIDATE only)`, async ({ page }) => {
      test.skip(!CANDIDATE, 'the base build has no panel');
      test.setTimeout(300_000);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const fx = await fixture(`r${device.height}`);
      const { stage, label, commit } = await openCommunity(page, device, fx);
      await openYou(stage);
      await page.waitForTimeout(800);

      await stage.locator('[data-testid="wsf-you-settings"]:visible').click();
      await expect(stage.locator('[data-testid="wsf-settings-panel"]')).toHaveCount(1, { timeout: 20_000 });
      const running = await stage.locator('body').evaluate(
        () =>
          document.getAnimations().filter((a) => {
            const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
            return Boolean(target?.matches?.('[data-wsf-side-panel], [data-wsf-sheet-scrim]'));
          }).length,
      );
      await expect(stage.getByText('Show my name').first()).toBeVisible({ timeout: 40_000 });
      await shoot(page, device, label, 'reduced-settings-open', 600);

      const closeMs = await stage.locator('body').evaluate(async () => {
        const btn = document.querySelector('[data-testid="wsf-settings-close"]') as HTMLElement;
        const t0 = performance.now();
        btn.click();
        while (document.querySelector('[data-testid="wsf-settings-panel"]') && performance.now() - t0 < 2_000) {
          await new Promise((r) => requestAnimationFrame(r));
        }
        return Math.round(performance.now() - t0);
      });
      await page.waitForTimeout(300);
      const returned = await focused(stage);
      expect(returned.testId).toBe('wsf-you-settings');
      await shoot(page, device, label, 'reduced-settings-closed', 0);
      writeReceipt('reduced-motion', device, {
        commit,
        panelAnimationsRunningOnOpen: running,
        closePressToPanelGoneMs: closeMs,
        focusAfterClose: returned,
      });
    });
  }
});
