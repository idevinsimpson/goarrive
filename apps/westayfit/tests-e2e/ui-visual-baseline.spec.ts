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
  { key: 'wide-1280', width: 1280, height: 800, mobile: false },
];

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
