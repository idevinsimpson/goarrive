import path from 'node:path';

import { test, expect, type Browser } from '@playwright/test';

import {
  PROJECT_ID,
  stampId,
  seedVerifiedUser,
  seedProfile,
  seedCommunity,
  seedActiveGoal,
  seedShards,
  firestoreWrite,
  tsField,
  signInVia,
} from './helpers/mobile';

/**
 * VISUAL BASELINE — Community Home, as the deployed candidate renders it.
 *
 * This is a LOCAL RENDER of the same built artifact staging serves. It is not
 * a staging screenshot: the backend is the local emulator and the data is
 * synthetic. It exists so the visual pass has something inspectable to argue
 * from at the widths the owner named.
 */
const OUT = path.resolve(__dirname, '../../../docs/westayfit/visual-baseline-2026-09-19' + (process.env.WSF_CAPTURE_SUBDIR ? '/' + process.env.WSF_CAPTURE_SUBDIR : ''));

const WIDTHS = [
  { key: '360', width: 360, height: 800, mobile: true },
  { key: '390', width: 390, height: 844, mobile: true },
  { key: '430', width: 430, height: 932, mobile: true },
  { key: 'short-390x640', width: 390, height: 640, mobile: true },
  // 195px stands in for 200% text zoom, the same proxy ui-manage-event-first
  // uses: a real zoom would scale the screenshot as well as the layout.
  { key: 'large-text-195', width: 195, height: 844, mobile: true },
  { key: 'wide-1280', width: 1280, height: 800, mobile: false },
];

/** No horizontal clipping, asserted rather than eyeballed. */
async function expectNoHorizontalOverflow(page: import('@playwright/test').Page, where: string) {
  const report = await page.evaluate(() => {
    const doc = document.documentElement;
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.right > doc.clientWidth + 1 || r.left < -1) {
        offenders.push(`${el.tagName}.${String((el as HTMLElement).className).slice(0, 24)} left=${Math.round(r.left)} right=${Math.round(r.right)}`);
      }
    }
    return { docScrolls: doc.scrollWidth > doc.clientWidth + 1, clientWidth: doc.clientWidth, offenders: offenders.slice(0, 6) };
  });
  expect(report.docScrolls, `${where}: the document scrolls sideways`).toBe(false);
  expect(report.offenders, `${where}: elements outside the viewport`).toEqual([]);
}

async function shoot(browser: Browser, w: typeof WIDTHS[number], email: string, password: string, groupId: string, name: string) {
  const context = await browser.newContext({
    viewport: { width: w.width, height: w.height },
    deviceScaleFactor: 2,
    isMobile: w.mobile,
    hasTouch: w.mobile,
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });
  const page = await context.newPage();
  await signInVia(page, email, password);
  await page.goto(`/community/${groupId}`);
  await expect(page.getByTestId('wsf-community-goal-total-' + name)).toBeVisible({ timeout: 30_000 });
  // Let the progress settle so the capture is of a resolved state, not a spinner.
  await page.waitForTimeout(1500);
  await expectNoHorizontalOverflow(page, `Community Home at ${w.key}`);
  await page.screenshot({ path: path.join(OUT, `home-${w.key}-viewport.png`) });
  // fullPage is USELESS here: the app is a React Native Web ScrollView, so the
  // document never grows and `fullPage: true` returns a byte-identical copy of
  // the viewport. The first run of this spec produced ten files and five
  // distinct images. What is below the fold has to be reached by scrolling the
  // inner scroller, which is also the only honest way to see it.
  const scrolled = await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 4);
    if (!el) return null;
    el.scrollTop = el.scrollHeight;
    return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
  });
  if (scrolled && scrolled.scrollHeight > scrolled.clientHeight + 4) {
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `home-${w.key}-scrolled-to-end.png`) });
  }
  await context.close();
}

test('capture Community Home across the width matrix', async ({ browser }) => {
  test.setTimeout(240_000);
  const stamp = stampId();
  const email = `wsf-vb-${stamp}@example.com`;
  const password = 'Sup3rSecret!23';
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Alex Rivera');

  const groupId = `vb-${stamp}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'inviteOnly',
    groupType: 'custom',
    members: [{ uid, role: 'member' }],
  });

  const goalId = `vbgoal-${stamp}`;
  await seedActiveGoal({
    goalId,
    groupId,
    ownerUid: uid,
    title: 'October Squat Challenge',
    target: 5000,
    unit: 'squats',
    total: 1847,
    timezone: 'America/New_York',
  });
  await seedShards(goalId, 1847);

  // A personal contribution, so "Your part" has something real to show.
  const now = new Date();
  await firestoreWrite(`wsfGoalMemberTotals/${goalId}_${uid}`, {
    goalId: { stringValue: goalId },
    userId: { stringValue: uid },
    total: { integerValue: '137' },
    updatedAt: tsField(now),
  });

  require('node:fs').writeFileSync('/tmp/vb-creds.json', JSON.stringify({ email, password, groupId, goalId }));

  for (const w of WIDTHS) {
    await shoot(browser, w, email, password, groupId, goalId);
    console.log(`captured ${w.key}`);
  }
  console.log(`PROJECT=${PROJECT_ID} OUT=${OUT}`);
});


test('the primary action is keyboard reachable and shows a visible focus state', async ({ browser }) => {
  test.setTimeout(120_000);
  const fx = JSON.parse(require('node:fs').readFileSync('/tmp/vb-creds.json', 'utf8'));
  const context = await browser.newContext({ viewport: { width: 390, height: 640 }, deviceScaleFactor: 2, locale: 'en-US', timezoneId: 'America/New_York' });
  const page = await context.newPage();
  await signInVia(page, fx.email, fx.password);
  await page.goto(`/community/${fx.groupId}`);
  const primary = page.getByTestId(`wsf-community-goal-link-${fx.goalId}`);
  await expect(primary).toBeVisible({ timeout: 30_000 });

  // Tab until the primary action holds focus. If it is not reachable this
  // fails rather than quietly passing on a mouse-only control.
  let focused = false;
  for (let i = 0; i < 40 && !focused; i += 1) {
    await page.keyboard.press('Tab');
    focused = await primary.evaluate((el) => el === document.activeElement || el.contains(document.activeElement));
  }
  expect(focused, 'the primary action is not reachable by keyboard').toBe(true);

  // A focus ring that is invisible is not a focus state.
  const ring = await primary.evaluate((el) => {
    const cs = getComputedStyle(el as HTMLElement);
    return { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, boxShadow: cs.boxShadow };
  });
  const hasRing = (ring.outlineStyle !== 'none' && parseFloat(ring.outlineWidth) > 0) || (ring.boxShadow !== 'none' && ring.boxShadow !== '');
  expect(hasRing, `focused primary action has no visible focus indicator: ${JSON.stringify(ring)}`).toBe(true);
  await page.screenshot({ path: path.join(OUT, 'home-390x640-primary-focused.png') });
  await context.close();
});

test('a long community name does not push the primary action off a short phone', async ({ browser }) => {
  test.setTimeout(180_000);
  const stamp = stampId();
  const email = `wsf-vbl-${stamp}@example.com`;
  const password = 'Sup3rSecret!23';
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Alex Rivera');
  const groupId = `vbl-${stamp}`;
  // 80 characters — the longest name the product stores.
  const longName = 'Alpharetta Morning Movers and Neighbourhood Wellness Collective Chapter Twelve';
  await seedCommunity({ groupId, displayName: longName, joinPolicy: 'inviteOnly', groupType: 'custom', members: [{ uid, role: 'member' }] });
  const goalId = `vblgoal-${stamp}`;
  await seedActiveGoal({ goalId, groupId, ownerUid: uid, title: 'A Long October Squat and Movement Challenge', target: 5000, unit: 'squats', total: 1847, timezone: 'America/New_York' });
  await seedShards(goalId, 1847);

  const context = await browser.newContext({ viewport: { width: 390, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US', timezoneId: 'America/New_York', reducedMotion: 'reduce' });
  const page = await context.newPage();
  await signInVia(page, email, password);
  await page.goto(`/community/${groupId}`);
  await expect(page.getByTestId(`wsf-community-goal-total-${goalId}`)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  await expectNoHorizontalOverflow(page, 'long name at 390x640');

  const box = await page.getByTestId(`wsf-community-goal-link-${goalId}`).boundingBox();
  expect(box, 'the primary action has no box').not.toBeNull();
  console.log(`LONG-NAME start-moving top=${Math.round(box!.y)} bottom=${Math.round(box!.y + box!.height)} viewport=640`);
  expect(box!.y + box!.height, 'the long-name case pushes the primary action off a 390x640 phone').toBeLessThanOrEqual(640);
  await page.screenshot({ path: path.join(OUT, 'home-390x640-long-name.png') });
  await context.close();
});
