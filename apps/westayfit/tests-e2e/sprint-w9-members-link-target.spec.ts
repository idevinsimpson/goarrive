import { expect, test } from '@playwright/test';

import {
  seedActiveGoal,
  seedCommunity,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * W9 — THE MEMBERS LINK IS A TOUCH TARGET.
 *
 * "See everyone in this community" measured **350×43** — one pixel under the
 * 44 px floor. `ui-a11y` R3 and `ui-a11y-fixes` (d) both reported it, and they
 * reported it on the BASE build too: `740a763` was checked out, built and run
 * to establish that it arrived with the presence work rather than with this
 * migration. The Director released the correction into this branch anyway
 * (`5795101998`), because the community-detail file is reserved to W9 while
 * the shell migration is in flight, and handing the same file back mid-flight
 * would be worse than fixing it here.
 *
 * WHY A FILE OF ITS OWN. The two suites above scan whole surfaces and report
 * whatever they find, which is the right shape for a sweep and the wrong shape
 * for a fix: they would go green if the control disappeared entirely. This
 * measures the control itself, by name, and says what it measured. A 43 px
 * mutant of `minHeight` fails here — that was checked, not assumed.
 *
 * It is a MINIMUM, not a height: the assertion is `>= 44`, so the row is free
 * to grow with its own content, with longer copy, or at larger text.
 */

const PHONE = { width: 390, height: 844 };
const MIN_TOUCH_TARGET_PX = 44;

test('the community members link is at least 44px tall where a thumb lands', async ({
  browser,
}) => {
  test.setTimeout(240_000);

  const stamp = stampId();
  const email = `wsf-w9-target-${stamp}@example.com`;
  const password = 'Sup3rSecret!23';
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Alex Rivera');
  const groupId = `w9target-${stamp}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'private',
    members: [{ uid, role: 'member' }],
  });
  await seedActiveGoal({
    goalId: `w9targetgoal-${stamp}`,
    groupId,
    ownerUid: uid,
    title: 'October Squat Challenge',
    target: 5000,
    unit: 'squats',
    total: 1847,
  });

  const context = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await signInVia(page, email, password);
    await page.goto(`/community/${groupId}`);
    const link = page.getByTestId('wsf-community-members-link');
    await expect(link).toBeVisible({ timeout: 40_000 });

    /*
      BRING IT INTO THE CLEAR FIRST. At the arrival scroll this row happens to
      sit under the raised MOVE control, and a hit test there would be
      measuring the bar's overhang rather than the row — the shell's bottom
      inset exists exactly so a member can scroll it clear. So the row is
      centred in the viewport, the way a member scrolls to something they are
      about to press, and then measured.
    */
    await page.evaluate((id) => {
      document.querySelector(`[data-testid="${id}"]`)?.scrollIntoView({ block: 'center' });
    }, 'wsf-community-members-link');
    await page.waitForTimeout(400);

    const box = (await link.boundingBox())!;
    // eslint-disable-next-line no-console
    console.log(
      `[W9] members link: ${Math.round(box.width)}x${Math.round(box.height)} at ${PHONE.width}x${PHONE.height}`,
    );
    expect(
      Math.round(box.height),
      `"See everyone in this community" is ${Math.round(box.height)}px tall, under the ${MIN_TOUCH_TARGET_PX}px floor`,
    ).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);

    /*
      AND IT IS THE LINK THAT IS BIG, not an ancestor around it. A parent with
      padding satisfies a box measurement while leaving the pressable itself
      small, so the point a thumb lands on has to resolve to this control.
    */
    const hit = await page.evaluate((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!(el instanceof HTMLElement)) return 'missing';
      const r = el.getBoundingClientRect();
      const points = [r.y + 4, r.y + r.height / 2, r.y + r.height - 4];
      return points.every((y) => {
        const top = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(y));
        return top instanceof Node && el.contains(top);
      })
        ? 'all'
        : 'partial';
    }, 'wsf-community-members-link');
    expect(
      hit,
      'the top, middle and bottom of the members link do not all belong to it',
    ).toBe('all');

    // Nothing else about the row moved: same words, same destination.
    await expect(link).toHaveText(/See everyone in this community/);
    await expect(link).toHaveAttribute('aria-label', 'See everyone in this community');
  } finally {
    await context.close();
  }
});
