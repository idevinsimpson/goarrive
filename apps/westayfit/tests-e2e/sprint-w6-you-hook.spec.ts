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
  seedVerifiedUser,
  signInVia,
  stampId,
  tsField,
} from './helpers/mobile';

/**
 * YOU-PARITY-1 — PHASE B: THE REAL ROUTE HOOK (on the development head `87997c58`:
 * accepted PERF-MOBILE-1 `ad3d2f88` + You / Progress Phase A `02f86fc2` / `92993f09`).
 *
 * `app/(tabs)/you.tsx` keeps PERF's reads, record and revalidation and now
 * renders `YouParityView`. These tests drive the REAL route against the
 * emulator and prove the three facts the adapter owns, plus PERF's refresh
 * truth reaching the view:
 *   1. canonical reads draw the reference order, own and shared apart;
 *   2. the period is written in the GOAL's time zone, not the device's;
 *   3. a shared total the list did not answer is unknown — never 0, no WE;
 *   4. Start moving only when a goal can take a contribution now;
 *   5. a failed revalidation keeps what was read, says so, and Retry re-reads;
 *   6. a goal helped in another community is listed under that community's
 *      name once the account's record holds it — never the lead — and the
 *      list is partial until then (Director #365 `5841997009`).
 *
 * EVIDENCE IS OPT-IN (WSF_CAPTURE_FRAMES=1): full-viewport route frames at
 * 390×844 and 390×640 — the persistent masthead, the page and the tab bar,
 * exactly as a member sees them — beside the frozen Lovable originals, with no
 * crop and no alignment.
 */

const OUT = path.resolve(__dirname, '../../../docs/design-target/review/you-parity-1');
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

/** Noon UTC, `days` from now: a different calendar day in GOAL_ZONE than in DEVICE_ZONE. */
function noonUtcIn(days: number): Date {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(12, 0, 0, 0);
  return d;
}

/**
 * The reference's own member: Alex M. in Oak Grove Together (23 members, no
 * named type), 25 of 241 / 500 squats, and 20 of 155 / 150 on a second goal.
 * `ownOnLead: false` seeds no own part anywhere; `leadEnded` puts the only
 * active goal's window in the past.
 */
async function seedAlex(label: string, opts: { ownOnLead?: boolean; leadEnded?: boolean } = {}) {
  const id = stampId();
  const email = `wsf-${label}-${id}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Alex M.');
  const groupId = `${label}g-${id}`;
  await seedCommunity({
    groupId,
    displayName: 'Oak Grove Together',
    joinPolicy: 'inviteOnly',
    groupType: 'custom',
    members: [
      { uid, role: 'member' },
      ...Array.from({ length: 22 }, (_, i) => ({ uid: `${label}-other-${i}-${id}`, role: 'member' as const })),
    ],
  });
  const lead = `${label}lead-${id}`;
  const leadEnds = opts.leadEnded ? new Date(Date.now() - 2 * DAY) : noonUtcIn(2);
  await seedActiveGoal({
    goalId: lead,
    groupId,
    ownerUid: uid,
    title: '500 squats together',
    target: 500,
    unit: 'squats',
    total: 241,
    timezone: GOAL_ZONE,
    endsAt: leadEnds,
  });
  if (opts.ownOnLead !== false) {
    await seedOwnCredit(lead, uid, 25);
    const other = `${label}other-${id}`;
    await seedActiveGoal({
      goalId: other,
      groupId,
      ownerUid: uid,
      title: '150 squats this week',
      target: 150,
      unit: 'squats',
      total: 155,
      timezone: GOAL_ZONE,
      endsAt: noonUtcIn(6),
    });
    await seedOwnCredit(other, uid, 20);
  }
  return { email, password, uid, groupId, lead, leadEnds };
}

async function openYou(page: Page) {
  await page.goto('/you');
  await expect(page.getByTestId('wsf-you-identity')).toBeVisible({ timeout: 40_000 });
}

test.describe('YOU-PARITY-1 · Phase B · the real route', () => {
  test('canonical reads draw the reference order, own and shared apart, the period in the goal zone', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const fx = await seedAlex('ywh1');
    const { context, page } = await phone(browser, { width: 390, height: 844 });
    await signInVia(page, fx.email, fx.password);
    await openYou(page);

    await expect(page.getByTestId('wsf-you-name')).toHaveText('Alex M.');
    await expect(page.getByTestId('wsf-you-community')).toContainText('Oak Grove Together');
    await expect(page.getByTestId('wsf-you-community')).toContainText('23 members');
    // A custom type prints no filler line.
    await expect(page.getByTestId('wsf-you-community')).not.toContainText('Community');
    await expect(page.getByTestId('wsf-you-lead-shared')).toHaveText('241 / 500 confirmed');
    await expect(page.getByTestId('wsf-you-lead-own')).toContainText('25');
    await expect(page.getByTestId('wsf-you-lead-we')).toBeVisible();

    // The second goal is a row under its own community, its period written in
    // the GOAL's zone: noon UTC is already the next day in Kiritimati.
    const row = page.locator('[data-testid^="wsf-you-row-"]').first();
    const ends = noonUtcIn(6);
    const inGoal = new Intl.DateTimeFormat('en-US', { timeZone: GOAL_ZONE, weekday: 'short', month: 'short', day: 'numeric' }).format(ends);
    const onDevice = new Intl.DateTimeFormat('en-US', { timeZone: DEVICE_ZONE, weekday: 'short', month: 'short', day: 'numeric' }).format(ends);
    expect(inGoal).not.toBe(onDevice);
    await expect(row).toContainText(`Oak Grove Together · Ends ${inGoal}`);
    await expect(row).not.toContainText(onDevice);
    await expect(row).toContainText('REACHED · STILL OPEN');

    // Reference order, account last.
    const y = async (id: string) => (await page.getByTestId(id).first().boundingBox())!.y;
    expect(await y('wsf-you-identity')).toBeLessThan(await y('wsf-you-community'));
    expect(await y('wsf-you-community')).toBeLessThan(await y('wsf-you-lead'));
    expect(await y('wsf-you-lead')).toBeLessThan(await y('wsf-you-others'));
    expect(await y('wsf-you-others')).toBeLessThan(await y('wsf-you-account'));
    await context.close();
  });

  test('a cold goals-read failure keeps the resolved community; a memberships failure claims none (Y-F10)', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const fx = await seedAlex('ywh7');
    const { context, page } = await phone(browser, { width: 390, height: 844 });
    await signInVia(page, fx.email, fx.password);

    // Cold: the reload leaves nothing in the account's record. Memberships
    // answer; the goals read does not.
    await page.route('**/wsfListGoals**', (route: Route) => route.abort('failed'));
    await openYou(page);
    await expect(page.getByTestId('wsf-you-failed')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('wsf-you-community')).toContainText('Oak Grove Together');
    await expect(page.getByTestId('wsf-you-failed')).toContainText('Your identity and community are still here.');
    await expect(page.getByTestId('wsf-you-retry')).toBeVisible();
    await expect(page.getByTestId('wsf-you-failed')).not.toContainText(/\b0\b/);
    await page.unroute('**/wsfListGoals**');

    // Memberships unknown: no community is claimed.
    await page.route('**/wsfMyCommunities**', (route: Route) => route.abort('failed'));
    await openYou(page);
    await expect(page.getByTestId('wsf-you-failed')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('wsf-you-community')).toHaveCount(0);
    await expect(page.getByTestId('wsf-you-failed')).toContainText('Your identity is still here.');
    await context.close();
  });

  test('a shared total the list did not answer is unknown: no number, no Living WE, never 0', async ({ browser }) => {
    test.setTimeout(240_000);
    const fx = await seedAlex('ywh2');
    const { context, page } = await phone(browser, { width: 390, height: 844 });
    // Every goal list this page sees arrives without sharedTotal.
    await page.route('**/wsfListGoals**', async (route: Route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { result?: { goals?: Array<Record<string, unknown>> } };
      for (const g of body.result?.goals ?? []) delete g.sharedTotal;
      await route.fulfill({ response, json: body });
    });
    await signInVia(page, fx.email, fx.password);
    await openYou(page);

    await expect(page.getByTestId('wsf-you-lead-shared-unknown')).toHaveText('Not available right now');
    await expect(page.getByTestId('wsf-you-lead-shared')).toHaveCount(0);
    await expect(page.getByTestId('wsf-you-lead-we')).toHaveCount(0);
    await expect(page.getByTestId('wsf-you-lead-status')).toHaveText('OPEN');
    await expect(page.getByTestId('wsf-you-lead-own')).toContainText('25');
    await expect(page.getByTestId('wsf-you-lead')).not.toContainText('0 / 500');
    const row = page.locator('[data-testid^="wsf-you-row-"]').first();
    await expect(row).toContainText('Unknown');
    await expect(row).not.toContainText('REACHED');
    await context.close();
  });

  test('Start moving only when a goal can take a contribution now', async ({ browser }) => {
    test.setTimeout(240_000);
    // An active goal whose window is over cannot take a contribution.
    const ended = await seedAlex('ywh3', { ownOnLead: false, leadEnded: true });
    let { context, page } = await phone(browser, { width: 390, height: 844 });
    await signInVia(page, ended.email, ended.password);
    await openYou(page);
    await expect(page.getByTestId('wsf-you-nothing-yet')).toHaveAttribute('data-state', 'no-eligible-goal');
    await expect(page.getByTestId('wsf-you-start-moving')).toHaveCount(0);
    await context.close();

    // The same, in window: Start moving is offered and opens MOVE.
    const open = await seedAlex('ywh4', { ownOnLead: false });
    ({ context, page } = await phone(browser, { width: 390, height: 844 }));
    await signInVia(page, open.email, open.password);
    await openYou(page);
    const start = page.getByTestId('wsf-you-start-moving');
    await expect(start).toBeVisible();
    await start.click();
    // MOVE (W9): with one goal open it goes straight to that goal's contribution.
    await expect(page).toHaveURL(new RegExp(`/(move|contribute/${open.lead}\\?.*mode=move)`));
    await context.close();
  });

  test('a failed revalidation keeps what was read, says so, and Retry reads again', async ({ browser }) => {
    test.setTimeout(240_000);
    const fx = await seedAlex('ywh5');
    const { context, page } = await phone(browser, { width: 390, height: 844 });
    await signInVia(page, fx.email, fx.password);
    // Home fills this account's record; You then opens on it (PERF-MOBILE-1).
    await expect(page.getByTestId('wsf-member-tab-you')).toBeVisible({ timeout: 40_000 });
    // Past PERF's same-load reuse window, so opening You re-reads.
    await page.waitForTimeout(11_000);
    let block = true;
    await page.route(/wsf(MyCommunities|ListGoals|MyContribution)/, (route: Route) =>
      block ? route.abort('failed') : route.fallback(),
    );
    await page.getByTestId('wsf-member-tab-you').click();
    await expect(page.getByTestId('wsf-you-stale')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('wsf-you-stale')).toContainText('This is what was last read.');
    await expect(page.getByTestId('wsf-you-lead-own')).toContainText('25');
    block = false;
    await page.getByTestId('wsf-you-stale-retry').click();
    await expect(page.getByTestId('wsf-you-stale')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId('wsf-you-lead-shared')).toHaveText('241 / 500 confirmed');
    await context.close();
  });

  test("a goal helped in another community: partial until the record holds it, then listed under its own name, never the lead", async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    // Alex in Oak Grove Together (current) and Harbor Lunch Crew. Harbor's goal
    // ends SOONER than Oak's lead, so a global soonest-first would lead with it.
    const fx = await seedAlex('ywh6');
    const harbor = `ywh6h-${stampId()}`;
    await seedCommunity({
      groupId: harbor,
      displayName: 'Harbor Lunch Crew',
      joinPolicy: 'inviteOnly',
      groupType: 'custom',
      members: [{ uid: fx.uid, role: 'member' }],
    });
    const lunch = `ywh6lunch-${stampId()}`;
    await seedActiveGoal({
      goalId: lunch,
      groupId: harbor,
      ownerUid: fx.uid,
      title: 'Lunch-break laps',
      target: 40,
      unit: 'laps',
      total: 12,
      timezone: GOAL_ZONE,
      endsAt: noonUtcIn(1),
    });
    await seedOwnCredit(lunch, fx.uid, 3);

    const { context, page } = await phone(browser, { width: 390, height: 844 });
    await context.addInitScript(
      ([uid, groupId]) => window.localStorage.setItem(`wsf.currentCommunity.${uid}`, groupId),
      [fx.uid, fx.groupId],
    );
    await signInVia(page, fx.email, fx.password);
    await expect(page.getByTestId('wsf-member-tab-you')).toBeVisible({ timeout: 40_000 });

    // No read has brought Harbor's goals in: the list says it may be short and invents nothing.
    await page.getByTestId('wsf-member-tab-you').click();
    await expect(page.getByTestId('wsf-you-lead')).toContainText('500 squats together', { timeout: 40_000 });
    await expect(page.getByTestId('wsf-you-partial')).toBeVisible();
    await expect(page.getByTestId(`wsf-you-row-${lunch}`)).toHaveCount(0);

    // Progress reads every joined community into the account's record.
    await page.getByTestId('wsf-member-tab-activity').click();
    await expect(page.getByText('Lunch-break laps').first()).toBeVisible({ timeout: 40_000 });

    // Back on You: Harbor's goal under its own name; Oak's goal still leads; complete.
    await page.getByTestId('wsf-member-tab-you').click();
    await expect(page.getByTestId(`wsf-you-row-${lunch}`)).toContainText('Harbor Lunch Crew', { timeout: 20_000 });
    await expect(page.getByTestId(`wsf-you-row-${lunch}`)).toContainText('Lunch-break laps');
    await expect(page.getByTestId(`wsf-you-row-${lunch}`)).not.toContainText('Oak Grove Together');
    await expect(page.getByTestId('wsf-you-lead')).toContainText('500 squats together');
    await expect(page.getByTestId('wsf-you-lead')).not.toContainText('Lunch-break laps');
    await expect(page.getByTestId('wsf-you-partial')).toHaveCount(0);
    await context.close();
  });
});

test.describe('YOU-PARITY-1 · Phase B · route evidence', () => {
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
      const fx = await seedAlex(`ywe${vp.height}`);
      const { context, page } = await phone(browser, vp, 1);
      await signInVia(page, fx.email, fx.password);
      await openYou(page);
      await expect(page.getByTestId('wsf-you-lead-shared')).toHaveText('241 / 500 confirmed');
      await page.waitForTimeout(700);
      const name = `route-you-normal-${vp.width}x${vp.height}`;
      const file = path.join(dir, `${name}.png`);
      await page.screenshot({ path: file });
      const lovable = path.join(OUT, 'lovable-642f830b', `you-normal-${vp.width}x${vp.height}.png`);
      const side = await sideBySide(page, lovable, file, path.join(dir, `cmp-${name}-full-side-by-side.png`));
      manifest.push({
        state: 'normal',
        viewport: `${vp.width}x${vp.height}`,
        route: path.relative(OUT, file),
        routeSha256: sha256(file),
        lovable: path.relative(OUT, lovable),
        lovableSha256: sha256(lovable),
        sideBySide: path.relative(OUT, side.file),
        differingPixelShareFullFrame: Number(side.share.toFixed(4)),
        note: 'full viewport, no crop, no alignment; shell masthead and tab bar are the real ones',
      });
      await context.close();
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify({ lovableRef: '642f830baa1153b0d9465dc75690028768083fb7', source: 'app/(tabs)/you.tsx on 87997c58 (PERF ad3d2f88 + Phase A 02f86fc2 / 92993f09) + YouParityView', frames: manifest }, null, 2)}\n`);
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
