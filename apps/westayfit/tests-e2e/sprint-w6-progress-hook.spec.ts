import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { expect, test, type Browser, type Page, type Route } from '@playwright/test';

import { CAPTURE_FRAMES } from './helpers/capture';
import {
  firestoreWrite,
  seedActiveGoal,
  seedCommunity,
  seedProfile,
  seedShards,
  seedVerifiedUser,
  signInVia,
  stampId,
  tsField,
} from './helpers/mobile';

/**
 * PROGRESS-PARITY-1 — PHASE B: THE REAL ROUTE HOOK (on the development head `87997c58`:
 * accepted PERF-MOBILE-1 `ad3d2f88` + You / Progress Phase A `02f86fc2` / `92993f09`).
 *
 * `app/(tabs)/activity.tsx` keeps PERF's reads, record and revalidation and
 * now renders `ProgressParityView`. These tests drive the REAL route against
 * the emulator and prove what the adapter owns, plus PERF's refresh truth
 * reaching the view:
 *   1. one private total per unit, the summary, the honest receipt line, and
 *      each goal's YOURS / SHARED with its period in the GOAL's zone;
 *   2. a shared total the list did not answer is Unknown — never 0, never reached;
 *   3. Start moving only when some goal can take a contribution now;
 *   4. a failed revalidation keeps what was read, says so, and Retry re-reads.
 *
 * EVIDENCE IS OPT-IN (WSF_CAPTURE_FRAMES=1): full-viewport route frames — the
 * persistent masthead, the page and the tab bar — at 390×844 beside the frozen
 * Lovable original with no crop and no alignment, and at 390×640 (the
 * reference publishes no populated 640 original).
 */

const OUT = path.resolve(__dirname, '../../../docs/design-target/review/progress-parity-1');
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const DEVICE_ZONE = 'America/New_York';
/** UTC+14 all year: 12:00Z is already tomorrow there, and still today in New York. */
const GOAL_ZONE = 'Pacific/Kiritimati';
const DAY = 24 * 60 * 60_000;

async function phone(browser: Browser, viewport: { width: number; height: number }, dpr = 2) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: dpr,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
    userAgent: IPHONE_UA,
    timezoneId: DEVICE_ZONE,
  });
  return { context, page: await context.newPage() };
}

async function seedOwnCredit(goalId: string, uid: string, total: number): Promise<void> {
  await firestoreWrite(`wsfGoalMemberTotals/${goalId}_${uid}`, {
    goalId: { stringValue: goalId },
    userId: { stringValue: uid },
    total: { integerValue: String(total) },
    contributionCount: { integerValue: '1' },
    updatedAt: tsField(new Date()),
  });
}

async function seedClosedGoal(o: {
  goalId: string;
  groupId: string;
  ownerUid: string;
  title: string;
  target: number;
  unit: string;
  total: number;
  endsAt: Date;
}): Promise<void> {
  await firestoreWrite(`wsfGoals/${o.goalId}`, {
    ownerUid: { stringValue: o.ownerUid },
    communityGroupId: { stringValue: o.groupId },
    title: { stringValue: o.title },
    target: { integerValue: String(o.target) },
    unit: { stringValue: o.unit },
    status: { stringValue: 'closed' },
    startsAt: tsField(new Date(o.endsAt.getTime() - 30 * DAY)),
    endsAt: tsField(o.endsAt),
    closedAt: tsField(o.endsAt),
    timezone: { stringValue: GOAL_ZONE },
    createdAt: tsField(new Date(o.endsAt.getTime() - 30 * DAY)),
    updatedAt: tsField(o.endsAt),
  });
  await seedShards(o.goalId, o.total);
}

function noonUtcIn(days: number): Date {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(12, 0, 0, 0);
  return d;
}

/**
 * The reference's member: Alex M., two communities, 145 squats recorded across
 * four goals — two open (one reached), one closed reached, one closed short.
 * `noOwn` seeds goals but no own part; `ended` puts the only active goal's
 * window in the past; `single` keeps to Oak Grove alone (so reading the
 * current community fills everything Progress needs from the record).
 */
async function seedAlex(label: string, opts: { noOwn?: boolean; ended?: boolean; single?: boolean } = {}) {
  const id = stampId();
  const email = `wsf-${label}-${id}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Alex M.');
  const oak = `${label}oak-${id}`;
  await seedCommunity({ groupId: oak, displayName: 'Oak Grove Together', joinPolicy: 'inviteOnly', groupType: 'custom', members: [{ uid, role: 'member' }] });
  const lead = `${label}500-${id}`;
  await seedActiveGoal({
    goalId: lead,
    groupId: oak,
    ownerUid: uid,
    title: '500 squats together',
    target: 500,
    unit: 'squats',
    total: 241,
    timezone: GOAL_ZONE,
    endsAt: opts.ended ? new Date(Date.now() - 2 * DAY) : noonUtcIn(2),
  });
  if (opts.noOwn) return { email, password, uid, lead };
  await seedOwnCredit(lead, uid, 25);
  if (opts.single) return { email, password, uid, lead };
  const harbor = `${label}harbor-${id}`;
  await seedCommunity({ groupId: harbor, displayName: 'Harbor Lunch Crew', joinPolicy: 'inviteOnly', groupType: 'custom', members: [{ uid, role: 'member' }] });
  const week = `${label}150-${id}`;
  await seedActiveGoal({ goalId: week, groupId: harbor, ownerUid: uid, title: '150 squats this week', target: 150, unit: 'squats', total: 155, timezone: GOAL_ZONE, endsAt: noonUtcIn(6) });
  await seedOwnCredit(week, uid, 20);
  const aug = `${label}aug-${id}`;
  await seedClosedGoal({ goalId: aug, groupId: oak, ownerUid: uid, title: '1,000 squats in August', target: 1000, unit: 'squats', total: 1024, endsAt: new Date(Date.now() - 26 * DAY) });
  await seedOwnCredit(aug, uid, 60);
  const jul = `${label}jul-${id}`;
  await seedClosedGoal({ goalId: jul, groupId: oak, ownerUid: uid, title: '800 squats in July', target: 800, unit: 'squats', total: 612, endsAt: new Date(Date.now() - 57 * DAY) });
  await seedOwnCredit(jul, uid, 40);
  return { email, password, uid, lead, week, aug, jul };
}

async function openProgress(page: Page) {
  await page.goto('/activity');
  await expect(page.getByTestId('wsf-activity-title')).toBeVisible({ timeout: 40_000 });
}

test.describe('PROGRESS-PARITY-1 · Phase B · the real route', () => {
  test('one total per unit, the summary, the honest receipt line, YOURS / SHARED with the period in the goal zone', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const fx = await seedAlex('pwh1');
    const { context, page } = await phone(browser, { width: 390, height: 844 });
    await signInVia(page, fx.email, fx.password);
    await openProgress(page);
    await expect(page.getByTestId('wsf-activity-rows')).toBeVisible({ timeout: 40_000 });

    // The name comes only from what this account has already read (no new
    // read on Progress): opened directly, before any profile read, the
    // eyebrow says whose page it is without guessing a name...
    await expect(page.getByText('PRIVATE TO YOU', { exact: true })).toBeVisible();
    await expect(page.getByTestId('wsf-activity-total-0')).toHaveAttribute('aria-label', '145 squats recorded');
    await expect(page.getByTestId('wsf-activity-total-1')).toHaveCount(0);
    await expect(page.getByTestId('wsf-activity-summary')).toHaveText('Across 4 goals in 2 communities. Each unit stays separate.');
    await expect(page.getByTestId('wsf-activity-privacy')).toHaveCount(1);
    await expect(page.getByTestId('wsf-activity-receipts-unavailable')).toBeVisible();
    await expect(page.locator('[data-testid^="wsf-activity-receipt-"]')).toHaveCount(0);

    await expect(page.getByTestId(`wsf-activity-goal-${fx.lead}-yours`)).toHaveText('YOURS25 squats');
    await expect(page.getByTestId(`wsf-activity-goal-${fx.lead}-shared`)).toHaveText('SHARED241 / 500 squats');
    await expect(page.getByTestId(`wsf-activity-goal-${fx.week}`)).toContainText('REACHED · STILL OPEN');
    await expect(page.getByTestId(`wsf-activity-goal-${fx.week}`)).toContainText('Harbor Lunch Crew');
    await expect(page.getByTestId(`wsf-activity-goal-${fx.aug}`)).toContainText('CLOSED · REACHED');
    await expect(page.getByTestId(`wsf-activity-goal-${fx.jul}`)).toContainText('CLOSED · UNFINISHED');
    // Open goals soonest-ending first (the lead ends in 2 days, Harbor's in 6), then finished.
    const order = await page.locator('[data-testid^="wsf-activity-goal-"]:not([data-testid$="-yours"]):not([data-testid$="-shared"])').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(order).toEqual([fx.lead, fx.week, fx.aug, fx.jul].map((id) => `wsf-activity-goal-${id}`));

    const ends = noonUtcIn(2);
    const inGoal = new Intl.DateTimeFormat('en-US', { timeZone: GOAL_ZONE, weekday: 'short', month: 'short', day: 'numeric' }).format(ends);
    const onDevice = new Intl.DateTimeFormat('en-US', { timeZone: DEVICE_ZONE, weekday: 'short', month: 'short', day: 'numeric' }).format(ends);
    expect(inGoal).not.toBe(onDevice);
    await expect(page.getByTestId(`wsf-activity-goal-${fx.lead}`)).toContainText(`Oak Grove Together · Ends ${inGoal}`);

    // ...and once You has read the profile, the name is there on return.
    await page.getByTestId('wsf-member-tab-you').click();
    await expect(page.getByTestId('wsf-you-name')).toHaveText('Alex M.', { timeout: 40_000 });
    await page.getByTestId('wsf-member-tab-activity').click();
    await expect(page.getByText('PRIVATE TO YOU · ALEX M.')).toBeVisible();
    await context.close();
  });

  test('a shared total the list did not answer is Unknown: never 0, never reached', async ({ browser }) => {
    test.setTimeout(240_000);
    const fx = await seedAlex('pwh2');
    const { context, page } = await phone(browser, { width: 390, height: 844 });
    await page.route('**/wsfListGoals**', async (route: Route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { result?: { goals?: Array<Record<string, unknown>> } };
      for (const g of body.result?.goals ?? []) delete g.sharedTotal;
      await route.fulfill({ response, json: body });
    });
    await signInVia(page, fx.email, fx.password);
    await openProgress(page);
    await expect(page.getByTestId('wsf-activity-rows')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId(`wsf-activity-goal-${fx.lead}-shared`)).toHaveText('SHAREDUnknown');
    await expect(page.getByTestId(`wsf-activity-goal-${fx.week}`)).toContainText('OPEN');
    await expect(page.getByTestId(`wsf-activity-goal-${fx.week}`)).not.toContainText('REACHED');
    await expect(page.getByTestId(`wsf-activity-goal-${fx.aug}`)).toContainText('CLOSED · RESULT UNAVAILABLE');
    await expect(page.getByTestId('wsf-activity-goals')).not.toContainText('0 / ');
    // Own parts are known and still add up.
    await expect(page.getByTestId('wsf-activity-total-0')).toHaveAttribute('aria-label', '145 squats recorded');
    await context.close();
  });

  test('Start moving only when some goal can take a contribution now', async ({ browser }) => {
    test.setTimeout(240_000);
    const ended = await seedAlex('pwh3', { noOwn: true, ended: true });
    let { context, page } = await phone(browser, { width: 390, height: 844 });
    await signInVia(page, ended.email, ended.password);
    await openProgress(page);
    await expect(page.getByTestId('wsf-activity-empty')).toHaveAttribute('data-state', 'no-open-goal', { timeout: 40_000 });
    await expect(page.getByTestId('wsf-activity-empty')).toContainText('your community has no goal accepting contributions');
    await expect(page.getByTestId('wsf-activity-start')).toHaveCount(0);
    await context.close();

    const open = await seedAlex('pwh4', { noOwn: true });
    ({ context, page } = await phone(browser, { width: 390, height: 844 }));
    await signInVia(page, open.email, open.password);
    await openProgress(page);
    await expect(page.getByTestId('wsf-activity-empty')).toHaveAttribute('data-state', 'first-eligible', { timeout: 40_000 });
    await page.getByTestId('wsf-activity-start').click();
    await expect(page).toHaveURL(new RegExp(`/(move|contribute/${open.lead}\\?.*mode=move)`));
    await context.close();
  });

  test('a failed revalidation keeps what was read, says so, and Retry reads again', async ({ browser }) => {
    test.setTimeout(240_000);
    // One community: You reads its goals and own parts, which is everything
    // Progress needs to open on the record (PERF-MOBILE-1).
    const fx = await seedAlex('pwh5', { single: true });
    const { context, page } = await phone(browser, { width: 390, height: 844 });
    await signInVia(page, fx.email, fx.password);
    // You fills this account's record; Progress then opens on it (PERF-MOBILE-1).
    await expect(page.getByTestId('wsf-member-tab-activity')).toBeVisible({ timeout: 40_000 });
    await page.getByTestId('wsf-member-tab-you').click();
    await expect(page.getByTestId('wsf-you-identity')).toBeVisible({ timeout: 40_000 });
    // Past PERF's same-load reuse window, so opening Progress re-reads.
    await page.waitForTimeout(11_000);
    let block = true;
    await page.route(/wsf(MyCommunities|ListGoals|MyContribution)/, (route: Route) =>
      block ? route.abort('failed') : route.fallback(),
    );
    await page.getByTestId('wsf-member-tab-activity').click();
    await expect(page.getByTestId('wsf-activity-stale')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('wsf-activity-stale')).toContainText('This is what was last read.');
    block = false;
    await page.getByTestId('wsf-activity-stale-retry').click();
    await expect(page.getByTestId('wsf-activity-stale')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId('wsf-activity-rows')).toBeVisible();
    await context.close();
  });
});

test.describe('PROGRESS-PARITY-1 · Phase B · route evidence', () => {
  test('full-viewport route frames beside the frozen reference', async ({ browser }) => {
    test.skip(!CAPTURE_FRAMES, 'evidence is written only under WSF_CAPTURE_FRAMES=1');
    test.setTimeout(300_000);
    const dir = path.join(OUT, 'route');
    fs.mkdirSync(dir, { recursive: true });
    const manifest: Array<Record<string, unknown>> = [];
    for (const vp of [
      { width: 390, height: 844 },
      { width: 390, height: 640 },
    ]) {
      const fx = await seedAlex(`pwe${vp.height}`);
      const { context, page } = await phone(browser, vp, 1);
      await signInVia(page, fx.email, fx.password);
      await openProgress(page);
      await expect(page.getByTestId('wsf-activity-total-0')).toHaveAttribute('aria-label', '145 squats recorded', { timeout: 40_000 });
      await page.waitForTimeout(700);
      const name = `route-progress-populated-${vp.width}x${vp.height}`;
      const file = path.join(dir, `${name}.png`);
      await page.screenshot({ path: file });
      const entry: Record<string, unknown> = {
        state: 'populated',
        viewport: `${vp.width}x${vp.height}`,
        route: path.relative(OUT, file),
        routeSha256: sha256(file),
        note: 'full viewport, no crop, no alignment; shell masthead and tab bar are the real ones',
      };
      const lovable = path.join(OUT, 'lovable-09b8a73c', `progress-populated-${vp.width}x${vp.height}.png`);
      if (fs.existsSync(lovable)) {
        const side = await sideBySide(page, lovable, file, path.join(dir, `cmp-${name}-full-side-by-side.png`));
        Object.assign(entry, {
          lovable: path.relative(OUT, lovable),
          lovableSha256: sha256(lovable),
          sideBySide: path.relative(OUT, side.file),
          differingPixelShareFullFrame: Number(side.share.toFixed(4)),
        });
      } else {
        entry.lovable = null;
      }
      manifest.push(entry);
      await context.close();
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify({ lovableRef: '09b8a73cc4e661115e52cb1ec4aebcb625c5fc9a', source: 'app/(tabs)/activity.tsx on 87997c58 (PERF ad3d2f88 + Phase A 02f86fc2 / 92993f09) + ProgressParityView', frames: manifest }, null, 2)}\n`);
  });
});

const sha256 = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** [reference | route] at full size, and the share of pixels whose summed channel difference exceeds 48. */
async function sideBySide(page: Page, lovable: string, route: string, out: string) {
  const a = `data:image/png;base64,${fs.readFileSync(lovable).toString('base64')}`;
  const b = `data:image/png;base64,${fs.readFileSync(route).toString('base64')}`;
  await page.setContent('<html><body style="margin:0"></body></html>');
  const r = await page.evaluate(
    async ([srcA, srcB]) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = reject;
          i.src = src;
        });
      const [ia, ib] = await Promise.all([load(srcA!), load(srcB!)]);
      const w = Math.max(ia.width, ib.width);
      const h = Math.max(ia.height, ib.height);
      const c = document.createElement('canvas');
      c.width = w * 2 + 12;
      c.height = h;
      const x = c.getContext('2d')!;
      x.fillStyle = '#fff';
      x.fillRect(0, 0, c.width, h);
      x.drawImage(ia, 0, 0);
      x.drawImage(ib, w + 12, 0);
      const d = document.createElement('canvas');
      d.width = w;
      d.height = h;
      const dx = d.getContext('2d')!;
      dx.drawImage(ia, 0, 0);
      dx.globalCompositeOperation = 'difference';
      dx.drawImage(ib, 0, 0);
      const px = dx.getImageData(0, 0, w, h).data;
      let n = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i]! + px[i + 1]! + px[i + 2]! > 48) n += 1;
      return { url: c.toDataURL('image/png'), share: n / (w * h) };
    },
    [a, b] as const,
  );
  fs.writeFileSync(out, Buffer.from(r.url.split(',')[1]!, 'base64'));
  return { file: out, share: r.share };
}
