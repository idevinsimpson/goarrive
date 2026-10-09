import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { expect, test } from '@playwright/test';

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
 * EVIDENCE FOR ONE CORRECTION: the mini Living WE is gone from Community
 * Home's secondary and history rows.
 *
 * WHY THIS NEEDED ITS OWN CAPTURE. `page-01-home/AFTER-home-*.png` is the
 * accepted evidence for this route and it is byte-unchanged by the
 * correction — but not because nothing moved. That fixture seeds ONE active
 * goal, so the accepted frames contain no "Also under way" section and no
 * History section at all. They could neither regress nor demonstrate the
 * change, and an intact evidence check over them would have been a true
 * statement about the wrong thing.
 *
 * So this seeds the case the accepted frames do not cover — a featured goal,
 * a second open goal, and two closed ones — and photographs it.
 *
 * GATED. Set WSF_CAPTURE_FRAMES=1 to regenerate deliberately; an ordinary run
 * asserts the rule and writes nothing.
 */

const OUT = path.resolve(
  __dirname,
  '../../../docs/design-target/review/page-01-home/correction-2026-09-22'
);

const CAPTURE_FRAMES = process.env.WSF_CAPTURE_FRAMES === '1';

const CLASSES = [
  { w: 390, h: 640, label: '390x640' },
  { w: 390, h: 844, label: '390x844' },
  { w: 430, h: 932, label: '430x932' },
] as const;

async function seedClosed(opts: {
  goalId: string;
  groupId: string;
  ownerUid: string;
  title: string;
  target: number;
  unit: string;
  total: number;
  endedDaysAgo: number;
}): Promise<void> {
  const ended = new Date(Date.now() - opts.endedDaysAgo * 24 * 60 * 60_000);
  await firestoreWrite(`wsfGoals/${opts.goalId}`, {
    ownerUid: { stringValue: opts.ownerUid },
    communityGroupId: { stringValue: opts.groupId },
    title: { stringValue: opts.title },
    target: { integerValue: String(opts.target) },
    unit: { stringValue: opts.unit },
    status: { stringValue: 'closed' },
    startsAt: tsField(new Date(ended.getTime() - 14 * 24 * 60 * 60_000)),
    endsAt: tsField(ended),
    closedAt: tsField(ended),
    ...(opts.total >= opts.target
      ? { reachedAt: tsField(new Date(ended.getTime() - 2 * 60 * 60_000)) }
      : {}),
    timezone: { stringValue: 'America/New_York' },
    createdAt: tsField(new Date(ended.getTime() - 14 * 24 * 60 * 60_000)),
    updatedAt: tsField(ended),
  });
  await seedShards(opts.goalId, opts.total);
}

for (const c of CLASSES) {
  test.describe(`home WE correction · ${c.label}`, () => {
    test.use({ viewport: { width: c.w, height: c.h } });

    test('one mark on the featured goal, none on the rows below it', async ({ page }) => {
      test.setTimeout(240_000);
      const stamp = stampId();
      const email = `wsf-hwe-${stamp}@example.com`;
      const password = `Pw-${randomBytes(9).toString('base64url')}`;
      const uid = await seedVerifiedUser(email, password);
      await seedProfile(uid, 'Alex Rivera');

      const groupId = `hwe${stamp}`.replace(/-/g, '');
      await seedCommunity({
        groupId,
        displayName: 'Maple Street Movers',
        joinPolicy: 'inviteOnly',
        members: [{ uid, role: 'foundingChampion' }],
      });

      /*
        WHICH GOAL IS FEATURED IS DECIDED BY `endsAt`, so both dates are set
        explicitly and far apart.

        The first version of this spec passed `endsInMs`, which is not a field
        `seedActiveGoal` has — Playwright transpiles without typechecking, so
        it ran, the property was dropped, and BOTH goals took the helper's
        default end a week out. Which one came back featured was then decided
        by nothing at all. The frames happened to come out right, which is the
        worst outcome: a flake that looks like evidence.
      */
      const now = Date.now();
      const featured = `hwef${stamp}`.replace(/-/g, '');
      await seedActiveGoal({
        goalId: featured,
        groupId,
        ownerUid: uid,
        title: 'Squats together this week',
        target: 500,
        unit: 'squats',
        total: 241,
        endsAt: new Date(now + 3 * 24 * 60 * 60_000),
      });
      // Secondary: still open, ends well after the hero — an "Also under way" row.
      const second = `hwes${stamp}`.replace(/-/g, '');
      await seedActiveGoal({
        goalId: second,
        groupId,
        ownerUid: uid,
        title: 'Minutes walked in September',
        target: 5000,
        unit: 'minutes',
        total: 1320,
        endsAt: new Date(now + 40 * 24 * 60 * 60_000),
      });
      // History: one reached, one short, so both closed results are in frame.
      await seedClosed({
        goalId: `hwec${stamp}`.replace(/-/g, ''),
        groupId,
        ownerUid: uid,
        title: 'August push-ups',
        target: 500,
        unit: 'push-ups',
        total: 515,
        endedDaysAgo: 20,
      });
      await seedClosed({
        goalId: `hwem${stamp}`.replace(/-/g, ''),
        groupId,
        ownerUid: uid,
        title: 'July stairs',
        target: 400,
        unit: 'flights',
        total: 90,
        endedDaysAgo: 50,
      });

      await signInVia(page, email, password);
      await page.goto(`/community/${groupId}`);
      await expect(page.getByTestId('wsf-community-name')).toHaveText('Maple Street Movers', {
        timeout: 40_000,
      });
      await expect(page.getByTestId(`wsf-community-goal-we-${featured}`)).toBeVisible({
        timeout: 40_000,
      });

      /*
        THE RULE, ASSERTED RATHER THAN ONLY PHOTOGRAPHED: exactly one Living WE
        on the screen, and it is the featured goal's. A count is what catches a
        mini mark creeping back onto a row — a screenshot review would have to
        notice its absence, which is the harder thing to see.
      */
      const marks = page.locator('[data-testid^="wsf-community-goal-we-"]');
      await expect(marks).toHaveCount(1);
      await expect(page.getByTestId(`wsf-community-goal-we-${second}`)).toHaveCount(0);
      /*
        And the ONE mark is on the goal this fixture meant to feature. Without
        this the count alone would pass with the two goals swapped, which is
        exactly the state the missing `endsAt` left them in.
      */
      await expect(page.getByTestId(`wsf-community-goal-we-${featured}`)).toHaveCount(1);
      await expect(page.getByTestId(`wsf-community-goal-card-${second}`)).toContainText(
        'Also under way'
      );

      // And the rows still carry their real numbers, so nothing was lost with
      // the mark — only a duplicate of what the text already says.
      await expect(page.getByTestId(`wsf-community-goal-total-${second}`)).toContainText(
        '1,320 of 5,000'
      );

      if (CAPTURE_FRAMES) {
        /*
          SCROLLED INTO FRAME, NOT `fullPage`. React Native Web scrolls inside
          an element rather than the document, so `fullPage: true` photographs
          the hero and stops at the fold — the first run of this spec produced
          three frames that showed none of the rows it exists to show. A
          capture is a claim about what is on screen, and the rows have to be
          brought there.
        */
        const bring = async (testID: string) => {
          await page.getByTestId(testID).evaluate((el) =>
            el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior })
          );
          await page.waitForTimeout(500);
        };

        await bring(`wsf-community-goal-card-${second}`);
        await page.screenshot({ path: path.join(OUT, `ACTUAL-home-alsounderway-${c.label}.png`) });

        await bring('wsf-community-history');
        await page.screenshot({ path: path.join(OUT, `ACTUAL-home-history-${c.label}.png`) });
      }
    });
  });
}
