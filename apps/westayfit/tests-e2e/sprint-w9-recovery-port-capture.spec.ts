import fs from 'node:fs';
import path from 'node:path';

import { expect, test, type Browser, type FrameLocator, type Page, type Route } from '@playwright/test';

import { CAPTURE_FRAMES } from './helpers/capture';
import {
  FIRESTORE_EMULATOR,
  PROJECT_ID,
  firestoreRead,
  firestoreWrite,
  seedActiveGoal,
  seedCommunity,
  seedMembership,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
  tsField,
} from './helpers/mobile';

/**
 * W9 — RECOVERY-PORT-1: THE CONTRIBUTION'S RECOVERY STATES, CAPTURED ON THE
 * REAL ROUTE (Director #365 `5821372374` §1; L0 #458 `5821470793`).
 *
 * TWO STAGES FROM ONE PRODUCER, as HOME-POLISH-1 did it:
 *   · MIGRATED — `/contribute/[goalId]` as it ships on the development base;
 *   · CANDIDATE — the route with this packet's recomposition.
 * `WSF_RECOVERY_PORT_STAGE` names which build is served; the served build's
 * own commit (on /health) is read, checked against the stage and printed in
 * the strip inside every PNG. Neither stage is an AFTER.
 *
 * THE STATES, AT 390x844 AND 390x640, each on its own fresh goal so every frame
 * starts from the same numbers (1,847 of 5,000 squats; the viewer's own 0):
 *   · review         — the step before anything is written;
 *   · unknown        — the reply to the write was lost (LABELLED INJECTION:
 *                      the server records it, the browser never hears back);
 *   · confirmed-replay — the same attempt, restored after a reload and sent
 *                      again by "Confirm this contribution": the server's own
 *                      answer, "already recorded", counted once;
 *   · confirmed      — an ordinary first write, answered normally;
 *   · refused        — a GENUINE refusal: a once-per-member goal the viewer
 *                      has already contributed to (no interception at all);
 *   · own-only       — the lost reply again, and the viewer removed from the
 *                      community before replaying it: the server answers about
 *                      the viewer's own effort only.
 * The pre-uid legacy orphan is checked but not photographed: the route
 * retires it and renders nothing for it (Director ruling `5821650392` §2).
 *
 * WHAT IT ASSERTS BESIDES THE PICTURES, on either build and whether or not
 * frames are written: each state is the state it is named for, in the words
 * the accepted specs pin; the unknown screen paints no shared figure and makes
 * no claim that the shared total is unaffected; the replay sends the SAME
 * attempt; the primary control is on screen and on top at both sizes; no
 * member tab bar or top bar is drawn on this route. WSF_CAPTURE_FRAMES only
 * gates the bytes on disk.
 *
 * Everything seeded here is SYNTHETIC: no person, community or goal is real.
 */

const OUT = path.resolve(__dirname, '../../../docs/design-target/review/recovery-port-1');

const STAGE = (process.env.WSF_RECOVERY_PORT_STAGE ?? 'CANDIDATE').toUpperCase();
if (STAGE !== 'MIGRATED' && STAGE !== 'CANDIDATE') {
  throw new Error(`WSF_RECOVERY_PORT_STAGE must be MIGRATED or CANDIDATE, not ${STAGE}`);
}

/** The development base this packet started from, as /health prints it. */
const BASE_SHORT = '6f994f5a';

function stripLabel(commit: string): string {
  return `${STAGE} BUILD ${commit} / NOT ACCEPTED`;
}

/** The strip's height, added on top of the device height. */
const BANNER = 18;

const DEVICES = [
  { key: '390x844', width: 390, height: 844 },
  { key: '390x640', width: 390, height: 640 },
] as const;

const PASSWORD = 'Sup3rSecret!23';
const TARGET = 5000;
const TOTAL = 1847;
const COMMUNITY = 'Alpharetta Morning Movers';

type Fixture = { email: string; uid: string; groupId: string; goalId: string };

/** A PATCH that writes only the named fields (the shared helper replaces the document). */
async function patchFields(docPath: string, fields: Record<string, unknown>): Promise<void> {
  const mask = Object.keys(fields)
    .map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`)
    .join('&');
  const url = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}?${mask}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`emulator patch ${docPath} failed: ${res.status} ${await res.text()}`);
}

/** One viewer, one community, one fresh goal at 1,847 of 5,000 squats. */
async function seed(tag: string, opts: { once?: boolean } = {}): Promise<Fixture> {
  const stamp = `${stampId()}${tag}`;
  const email = `wsf-w9-rp-${stamp}@example.com`;
  const uid = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(uid, 'Alex Rivera');
  const groupId = `w9rp-${stamp}`;
  const goalId = `w9rpgoal-${stamp}`;
  const dana = `w9rp-dana-${stamp}`;
  await seedCommunity({
    groupId,
    displayName: COMMUNITY,
    joinPolicy: 'private',
    members: [{ uid, role: 'member' }],
  });
  await seedMembership(groupId, dana, 'foundingChampion');
  await seedProfile(dana, 'Dana Whitfield');
  await seedActiveGoal({
    goalId,
    groupId,
    ownerUid: dana,
    title: 'October Squat Challenge',
    target: TARGET,
    unit: 'squats',
    total: TOTAL,
  });
  if (opts.once) {
    // A once-per-member goal the viewer already contributed to, written the
    // way the server writes it: the refusal that follows is the server's own.
    await patchFields(`wsfGoals/${goalId}`, { repeatPolicy: { stringValue: 'once' } });
    await firestoreWrite(`wsfGoalMemberTotals/${goalId}_${uid}`, {
      goalId: { stringValue: goalId },
      userId: { stringValue: uid },
      total: { integerValue: '20' },
      contributionCount: { integerValue: '1' },
      updatedAt: tsField(new Date()),
    } as never);
  }
  return { email, uid, groupId, goalId };
}

/** The easel: a labelled strip flush above an iframe of the device size. */
async function easel(page: Page, width: number, height: number, src: string): Promise<{ stage: FrameLocator; label: string }> {
  await page.goto('/health');
  const commit = ((await page.getByTestId('wsf-health-commit').innerText()).match(/[0-9a-f]{7,40}/) ?? [''])[0];
  expect(commit, 'the served build carries no commit stamp').not.toBe('');
  if (STAGE === 'MIGRATED') {
    expect(commit, 'MIGRATED frames must come from the development base build').toBe(BASE_SHORT);
  } else {
    expect(commit, 'CANDIDATE frames must not come from the base build').not.toBe(BASE_SHORT);
  }
  const label = stripLabel(commit);
  await page.evaluate(
    ({ w, h, banner, label, source }) => {
      document.documentElement.style.background = '#FFFFFF';
      document.body.style.cssText = 'margin:0;padding:0;background:#FFFFFF';
      document.body.innerHTML = `
        <div data-testid="wsf-w9rp-frame"
             style="width:${w}px;height:${h + banner}px;background:#FFFFFF;overflow:hidden;">
          <div data-testid="wsf-w9rp-banner"
               style="height:${banner}px;width:${w}px;background:#0B1F35;color:#F7F5F0;
                      font:700 10px/${banner}px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
                      letter-spacing:.9px;text-align:center;box-sizing:border-box;
                      border-bottom:1px solid #F7F5F0;">${label}</div>
          <iframe id="wsf-w9rp-stage" name="wsf-w9rp-stage" src="${source}"
                  style="width:${w}px;height:${h}px;border:0;display:block;"></iframe>
        </div>`;
    },
    { w: width, h: height, banner: BANNER, label, source: src },
  );
  return { stage: page.frameLocator('#wsf-w9rp-stage'), label };
}

/** Reload what is inside the easel, as a member reloading the page would. */
async function reloadStage(page: Page): Promise<void> {
  await page.evaluate(() => {
    (document.getElementById('wsf-w9rp-stage') as HTMLIFrameElement).contentWindow!.location.reload();
  });
}

/** Past layout, the Living WE's decode and any phase scroll, so nothing moves under the shutter. */
async function settle(stage: FrameLocator): Promise<void> {
  await stage.locator('body').evaluate(() => new Promise((r) => setTimeout(r, 2_500)));
}

/**
 * The route draws its own chrome: no member tab bar and no top bar are in the
 * document on a cold arrival, and the page sits at its top when it lands.
 */
async function assertArrival(stage: FrameLocator, tag: string): Promise<void> {
  await expect(stage.getByTestId('wsf-member-tabs'), `${tag}: a tab bar on this route`).toHaveCount(0);
  await expect(stage.getByTestId('wsf-member-topbar'), `${tag}: a top bar on this route`).toHaveCount(0);
  await expect(stage.getByTestId('wsf-contribute-wordmark'), `${tag}: the wordmark`).toHaveCount(1);
  const arrival = await stage.locator('body').evaluate(() => {
    const scrolled = Array.from(document.querySelectorAll<HTMLElement>('*')).filter((el) => el.scrollTop > 0).length;
    return { scrolled, overflow: document.documentElement.scrollWidth - window.innerWidth };
  });
  expect(arrival.scrolled, `${tag}: a scroller is not at its top`).toBe(0);
  expect(arrival.overflow, `${tag}: the page scrolls sideways`).toBeLessThanOrEqual(0);
}

/** The control is inside the device, and it is the thing a finger at its centre touches. */
async function assertReachable(stage: FrameLocator, testId: string, tag: string): Promise<void> {
  const el = stage.getByTestId(testId);
  await expect(el, `${tag}: ${testId}`).toHaveCount(1);
  const reach = await el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { bottom: Math.round(r.bottom), height: Math.round(r.height), viewport: window.innerHeight, onTop: !!hit && node.contains(hit) };
  });
  expect(reach.bottom, `${tag}: ${testId} ends below the screen`).toBeLessThanOrEqual(reach.viewport);
  expect(reach.height, `${tag}: ${testId} is under 44px tall`).toBeGreaterThanOrEqual(44);
  expect(reach.onTop, `${tag}: ${testId} is covered at its centre`).toBe(true);
}

async function shoot(page: Page, label: string, name: string, device: (typeof DEVICES)[number]): Promise<void> {
  const frameEl = page.getByTestId('wsf-w9rp-frame');
  const box = (await frameEl.boundingBox())!;
  expect(Math.round(box.width), `${name} ${device.key}: frame width`).toBe(device.width);
  expect(Math.round(box.height), `${name} ${device.key}: frame height`).toBe(device.height + BANNER);
  await expect(page.getByTestId('wsf-w9rp-banner')).toHaveText(label);
  if (CAPTURE_FRAMES) {
    fs.mkdirSync(OUT, { recursive: true });
    await frameEl.screenshot({ path: path.join(OUT, `${STAGE}-${name}-${device.key}.png`) });
  }
}

function pendingKey(goalId: string, uid: string): string {
  return `wsf.pendingContribution.${goalId}.${uid}`;
}

async function storedRow(stage: FrameLocator, key: string): Promise<{ attemptId?: string; state?: string; count?: number } | null> {
  const raw = await stage.locator('body').evaluate((_n, k) => window.localStorage.getItem(k), key);
  return raw ? JSON.parse(raw) : null;
}

/** The write, under the flow's control: pass it, or let it land and lose the reply. */
function contributeRoute(page: Page) {
  const control = { mode: 'pass' as 'pass' | 'landButDrop', seen: [] as string[] };
  const ready = page.route('**/wsfContribute', async (route: Route) => {
    const body = route.request().postDataJSON() as { data?: { attemptId?: string } } | null;
    control.seen.push(body?.data?.attemptId ?? '?');
    if (control.mode === 'landButDrop') {
      // LABELLED INJECTION: the server records it; the browser never hears back.
      await route.fetch();
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  return { control, ready };
}

async function openEntry(stage: FrameLocator): Promise<void> {
  await expect(stage.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 60_000 });
  await stage.getByTestId('wsf-contribute-entry').fill('20');
  await stage.getByTestId('wsf-contribute-review').click();
  await expect(stage.getByTestId('wsf-contribute-review-screen')).toBeVisible({ timeout: 20_000 });
}

/** The unknown outcome, in the words the accepted specs pin, and nothing it must not say. */
async function assertUnknown(stage: FrameLocator, tag: string): Promise<void> {
  const pending = stage.getByTestId('wsf-contribute-pending');
  await expect(pending, `${tag}: pending`).toBeVisible({ timeout: 30_000 });
  await expect(pending).toContainText('We couldn’t confirm your contribution yet.');
  await expect(pending).toContainText('We don’t know whether this effort was recorded. Don’t record it again.');
  await expect(pending).toContainText('This sends the same attempt again. If it already reached us, it will not count twice.');
  await expect(stage.getByTestId('wsf-contribute-pending-count')).toHaveText('You entered 20 squats.');
  await expect(stage.getByTestId('wsf-contribute-reconcile')).toHaveText('Confirm this contribution');
  await expect(stage.getByTestId('wsf-contribute-discard-pending'), `${tag}: a discard control`).toHaveCount(0);
  await expect(stage.getByTestId('wsf-contribute-receipt')).toHaveCount(0);
  // No shared figure anywhere on the screen, and no claim that the shared total is untouched.
  for (const id of ['wsf-contribute-shared-total', 'wsf-contribute-context', 'wsf-contribute-we']) {
    await expect(stage.getByTestId(id), `${tag}: ${id} on the unknown screen`).toHaveCount(0);
  }
  const text = await stage.getByTestId('wsf-contribute-screen').innerText();
  expect(text, `${tag}: a shared figure on the unknown screen`).not.toMatch(/1,847|1,867|of 5,000/);
  expect(text, `${tag}: a status-read or discard word`).not.toMatch(/discard|check status|nothing was counted|remove this reminder/i);
  expect(text, `${tag}: a claim that the shared total is unaffected`).not.toMatch(
    /(not|isn’t|isn't) (yet )?(counted|included)[^.]{0,60}shared total/i,
  );
  await assertReachable(stage, 'wsf-contribute-reconcile', tag);
}

async function assertReview(stage: FrameLocator, tag: string, seen: string[]): Promise<void> {
  await expect(stage.getByTestId('wsf-contribute-review-screen')).toContainText('Review your contribution');
  await expect(stage.getByTestId('wsf-contribute-review-quantity')).toHaveText('20 squats');
  await expect(stage.getByTestId('wsf-contribute-submit')).toHaveText('Record 20 squats');
  await expect(stage.getByTestId('wsf-contribute-repeat-notice')).toHaveText(
    'This will be recorded toward this goal. You can add more later.',
  );
  await expect(stage.getByTestId('wsf-contribute-edit')).toHaveText('Edit');
  expect(seen.length, `${tag}: a write before Record`).toBe(0);
  await assertReachable(stage, 'wsf-contribute-submit', tag);
}

async function withViewer(browser: Browser, fx: Fixture, run: (page: Page) => Promise<void>): Promise<void> {
  const ctx = await browser.newContext({
    viewport: { width: 480, height: 940 },
    deviceScaleFactor: 2,
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });
  try {
    const page = await ctx.newPage();
    await signInVia(page, fx.email, PASSWORD);
    await run(page);
  } finally {
    await ctx.close();
  }
}

function contributeUrl(fx: Fixture): string {
  return `/contribute/${fx.goalId}?groupId=${fx.groupId}&mode=record`;
}

test.describe(`RECOVERY-PORT-1 · ${STAGE} captures of the contribution's recovery states`, () => {
  for (const device of DEVICES) {
    test(`review → unknown → restored → confirmed replay · ${device.key}`, async ({ browser }) => {
      test.setTimeout(300_000);
      const fx = await seed(`a${device.height}`);
      await withViewer(browser, fx, async (page) => {
        const { control, ready } = contributeRoute(page);
        await ready;
        await page.setViewportSize({ width: device.width + 60, height: device.height + BANNER + 60 });
        const { stage, label } = await easel(page, device.width, device.height, contributeUrl(fx));
        const tag = `${STAGE} ${device.key}`;

        await openEntry(stage);
        await settle(stage);
        await assertArrival(stage, `${tag} review`);
        await assertReview(stage, `${tag} review`, control.seen);
        await shoot(page, label, 'review', device);

        control.mode = 'landButDrop';
        await stage.getByTestId('wsf-contribute-submit').click();
        await assertUnknown(stage, `${tag} unknown`);
        const key = pendingKey(fx.goalId, fx.uid);
        const row = await storedRow(stage, key);
        expect(row?.state, `${tag}: the kept attempt`).toBe('unknown');
        expect(row?.attemptId, `${tag}: the kept attempt is the one sent`).toBe(control.seen[0]);
        await settle(stage);
        await assertArrival(stage, `${tag} unknown`);
        await shoot(page, label, 'unknown-INJECTED-REPLY-LOST', device);

        // Leave it and come back: the same attempt, restored, and nothing sent.
        control.mode = 'pass';
        const sentBefore = control.seen.length;
        await reloadStage(page);
        await assertUnknown(stage, `${tag} restored`);
        expect((await storedRow(stage, key))?.attemptId, `${tag}: a different attempt was restored`).toBe(row?.attemptId);
        await stage.locator('body').evaluate(() => new Promise((r) => setTimeout(r, 3_000)));
        expect(control.seen.length, `${tag}: restoring sent something`).toBe(sentBefore);

        // Confirm sends the SAME attempt again; the server says it already counted.
        await stage.getByTestId('wsf-contribute-reconcile').click();
        const receipt = stage.getByTestId('wsf-contribute-receipt');
        await expect(receipt).toHaveAttribute('data-variant', 'alreadyRecorded', { timeout: 30_000 });
        expect(control.seen[control.seen.length - 1], `${tag}: the replay is a different attempt`).toBe(control.seen[0]);
        await expect(stage.getByTestId('wsf-contribute-result-headline')).toHaveText('This contribution was already recorded.');
        await expect(stage.getByTestId('wsf-contribute-result-subline')).toHaveText('It counted once.');
        await expect(stage.getByTestId('wsf-contribute-shared-total')).toHaveText('1,867 of 5,000 squats');
        await expect(stage.getByTestId('wsf-contribute-own-credit')).toHaveText('Your total on this goal: 20 squats');
        expect(await storedRow(stage, key), `${tag}: the reminder outlived its receipt`).toBeNull();
        const member = await firestoreRead(`wsfGoalMemberTotals/${fx.goalId}_${fx.uid}`);
        expect(Number(member.total?.integerValue ?? 0), `${tag}: the replay counted twice`).toBe(20);
        await settle(stage);
        await assertArrival(stage, `${tag} replay`);
        await assertReachable(stage, 'wsf-contribute-back', `${tag} replay`);
        await shoot(page, label, 'confirmed-replay-INJECTED-REPLY-LOST', device);
      });
    });

    test(`confirmed (an ordinary first write) · ${device.key}`, async ({ browser }) => {
      test.setTimeout(240_000);
      const fx = await seed(`b${device.height}`);
      await withViewer(browser, fx, async (page) => {
        const { control, ready } = contributeRoute(page);
        await ready;
        await page.setViewportSize({ width: device.width + 60, height: device.height + BANNER + 60 });
        const { stage, label } = await easel(page, device.width, device.height, contributeUrl(fx));
        const tag = `${STAGE} ${device.key} confirmed`;
        await openEntry(stage);
        await stage.getByTestId('wsf-contribute-submit').click();
        const receipt = stage.getByTestId('wsf-contribute-receipt');
        await expect(receipt).toHaveAttribute('data-variant', 'ordinary', { timeout: 30_000 });
        expect(control.seen.length, `${tag}: one write`).toBe(1);
        await expect(receipt).toContainText('Recorded');
        await expect(stage.getByTestId('wsf-contribute-result-headline')).toHaveText('You added 20 squats.');
        await expect(stage.getByTestId('wsf-contribute-result-subline')).toHaveText('You moved us closer.');
        await expect(stage.getByTestId('wsf-contribute-shared-total')).toHaveText('1,867 of 5,000 squats');
        await expect(stage.getByTestId('wsf-contribute-percent')).toHaveText('37.3% complete');
        await expect(stage.getByTestId('wsf-contribute-status')).toHaveText('3,133 to go');
        await expect(stage.getByTestId('wsf-contribute-result-standing')).toHaveText(
          `${COMMUNITY} is now at 1,867 of 5,000 squats.`,
        );
        await expect(stage.getByTestId('wsf-contribute-own-credit')).toHaveText('Your total on this goal: 20 squats');
        await expect(stage.getByTestId('wsf-contribute-back')).toHaveText('Back to community');
        await settle(stage);
        await assertArrival(stage, tag);
        await assertReachable(stage, 'wsf-contribute-record-more', tag);
        await assertReachable(stage, 'wsf-contribute-back', tag);
        await shoot(page, label, 'confirmed', device);
      });
    });

    test(`refused (a once-per-member goal, genuine) · ${device.key}`, async ({ browser }) => {
      test.setTimeout(240_000);
      const fx = await seed(`c${device.height}`, { once: true });
      await withViewer(browser, fx, async (page) => {
        const { control, ready } = contributeRoute(page);
        await ready;
        await page.setViewportSize({ width: device.width + 60, height: device.height + BANNER + 60 });
        const { stage, label } = await easel(page, device.width, device.height, contributeUrl(fx));
        const tag = `${STAGE} ${device.key} refused`;
        await openEntry(stage);
        await stage.getByTestId('wsf-contribute-submit').click();
        const refused = stage.getByTestId('wsf-contribute-refused');
        await expect(refused).toHaveAttribute('data-reason', 'alreadyContributed', { timeout: 30_000 });
        expect(control.seen.length, `${tag}: one write`).toBe(1);
        await expect(stage.getByTestId('wsf-contribute-refused-headline')).toHaveText(
          'This goal takes one contribution from each member.',
        );
        await expect(stage.getByTestId('wsf-contribute-refused-body')).toHaveText(
          'Your 20 squats were not recorded. Your earlier contribution to this goal still counts.',
        );
        await expect(stage.getByTestId('wsf-contribute-back')).toHaveText('Back to community');
        await expect(stage.getByTestId('wsf-contribute-pending')).toHaveCount(0);
        expect(await storedRow(stage, pendingKey(fx.goalId, fx.uid)), `${tag}: a refused reminder kept`).toBeNull();
        expect(await refused.innerText(), `${tag}: an exclamation`).not.toContain('!');
        await settle(stage);
        await assertArrival(stage, tag);
        await assertReachable(stage, 'wsf-contribute-back', tag);
        await shoot(page, label, 'refused', device);
      });
    });

    test(`own-only receipt (membership lost before the replay) · ${device.key}`, async ({ browser }) => {
      test.setTimeout(300_000);
      const fx = await seed(`d${device.height}`);
      await withViewer(browser, fx, async (page) => {
        const { control, ready } = contributeRoute(page);
        await ready;
        await page.setViewportSize({ width: device.width + 60, height: device.height + BANNER + 60 });
        const { stage, label } = await easel(page, device.width, device.height, contributeUrl(fx));
        const tag = `${STAGE} ${device.key} own-only`;
        await openEntry(stage);
        control.mode = 'landButDrop';
        await stage.getByTestId('wsf-contribute-submit').click();
        await assertUnknown(stage, tag);
        await patchFields(`wsfMemberships/${fx.groupId}_${fx.uid}`, { membershipStatus: { stringValue: 'removed' } });
        control.mode = 'pass';
        await stage.getByTestId('wsf-contribute-reconcile').click();
        const receipt = stage.getByTestId('wsf-contribute-receipt');
        await expect(receipt).toHaveAttribute('data-variant', 'ownOnly', { timeout: 30_000 });
        expect(control.seen[control.seen.length - 1], `${tag}: the replay is a different attempt`).toBe(control.seen[0]);
        await expect(stage.getByTestId('wsf-contribute-result-headline')).toHaveText('This contribution was already recorded.');
        await expect(stage.getByTestId('wsf-contribute-own-credit')).toHaveText('Your total on this goal: 20 squats');
        for (const id of ['wsf-contribute-shared-total', 'wsf-contribute-we', 'wsf-contribute-record-more', 'wsf-contribute-not-found']) {
          await expect(stage.getByTestId(id), `${tag}: ${id}`).toHaveCount(0);
        }
        await expect(stage.getByTestId('wsf-contribute-back')).toHaveText('Back to home');
        const text = await stage.getByTestId('wsf-contribute-screen').innerText();
        expect(text, `${tag}: a shared or community fact`).not.toMatch(/of 5,000|Alpharetta|closer|%/);
        await settle(stage);
        await assertArrival(stage, tag);
        await assertReachable(stage, 'wsf-contribute-back', tag);
        await shoot(page, label, 'own-only-INJECTED-REPLY-LOST', device);
      });
    });
  }

  test('the pre-uid legacy row is retired, not adopted and not rendered (no frame)', async ({ browser }) => {
    test.setTimeout(180_000);
    const fx = await seed('e');
    await withViewer(browser, fx, async (page) => {
      const { control, ready } = contributeRoute(page);
      await ready;
      // A row written before the key carried a uid: it belongs to an account
      // the route cannot identify (seeded on the same origin, before arrival).
      await page.goto('/health');
      await page.evaluate((g) => {
        window.localStorage.setItem(
          `wsf.pendingContribution.${g}`,
          JSON.stringify({ goalId: g, attemptId: 'legacyrp0001', count: 30, ts: Date.now() - 86_400_000, state: 'unknown' }),
        );
      }, fx.goalId);
      const { stage } = await easel(page, 390, 844, contributeUrl(fx));
      await expect(stage.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 60_000 });
      await stage.locator('body').evaluate(() => new Promise((r) => setTimeout(r, 2_000)));
      await expect(stage.getByTestId('wsf-contribute-pending')).toHaveCount(0);
      await expect(stage.getByTestId('wsf-contribute-reconcile')).toHaveCount(0);
      expect(await stage.getByTestId('wsf-contribute-screen').innerText()).not.toMatch(/You entered|30 squats/);
      expect(await storedRow(stage, `wsf.pendingContribution.${fx.goalId}`), 'the legacy row was left in place').toBeNull();
      const orphan = await storedRow(stage, `wsf.pendingContribution.orphan.${fx.goalId}.legacyrp0001`);
      expect(orphan?.state, 'the legacy row was not preserved aside').toBe('unknown');
      expect(await storedRow(stage, pendingKey(fx.goalId, fx.uid)), 'the legacy row was adopted').toBeNull();
      expect(control.seen.length, 'the legacy row was sent').toBe(0);
    });
  });
});
