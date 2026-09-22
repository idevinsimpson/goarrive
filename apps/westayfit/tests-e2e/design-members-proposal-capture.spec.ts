import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import {
  firestoreWrite,
  seedCommunity,
  seedMembership,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
  tsField,
} from './helpers/mobile';

/**
 * PROPOSAL EVIDENCE FOR `/community/[groupId]/members` AND THE ARRIVAL SHEET.
 *
 * This route has NO ACCEPTED DESIGN TARGET — the capability was authorised
 * before a frame for it was drawn — so these are ACTUAL captures of the
 * running product offered as the proposal, not an AFTER matched to a TARGET.
 * The route index records the route as uncovered for the same reason.
 *
 * CAPTURE, NOT VERIFICATION. It writes PNGs into docs/ and asserts only enough
 * to be sure it photographed the state it named. The behavioural assertions
 * live in `community-visibility.spec.ts`, which runs in the gate; this does
 * not, and must not be added there — an ordinary run should not pay for
 * eighteen rendered frames or rewrite committed evidence as a side effect.
 *
 * Run it deliberately:
 *   WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 \
 *   npm --prefix apps/westayfit run test:e2e -- \
 *     tests-e2e/design-members-proposal-capture.spec.ts
 */

/*
  RESOLVED FROM THIS FILE, not from the working directory. The run happens with
  cwd inside `apps/westayfit`, so a repo-relative literal quietly writes a
  parallel `apps/westayfit/docs/` tree — which is what the first run did, and
  it looks exactly like success until you list the directory you meant.
*/
const OUT = path.resolve(__dirname, '../../../docs/design-target/review/page-06-members');

/** The three phone classes every other package in this atlas is captured at. */
const CLASSES = [
  { w: 390, h: 640, label: '390x640' },
  { w: 390, h: 844, label: '390x844' },
  { w: 430, h: 932, label: '430x932' },
] as const;

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

async function seedVis(
  groupId: string,
  uid: string,
  role: 'foundingChampion' | 'member',
  visibility: 'private' | 'visible',
  prompted: boolean,
): Promise<void> {
  const now = new Date();
  await firestoreWrite(`wsfMemberships/${groupId}_${uid}`, {
    groupId: { stringValue: groupId },
    userId: { stringValue: uid },
    role: { stringValue: role },
    membershipStatus: { stringValue: 'active' },
    visibility: { stringValue: visibility },
    ...(prompted ? { visibilityPromptedAt: tsField(now) } : {}),
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });
}

type Fixture = {
  email: string;
  password: string;
  uid: string;
  /** Answered, with several members shown. */
  groupId: string;
  /** Answered, nobody shown. */
  quietId: string;
  /** Unanswered, so the arrival sheet is up. */
  freshId: string;
};

/**
 * REAL DOCUMENTS IN EVERY CASE — the same shapes the product writes. A frame
 * built from a fixture the product could not produce is a picture of nothing.
 */
async function seedAll(): Promise<Fixture> {
  const stamp = stampId();
  const email = `wsf-mcap-${stamp}@example.test`;
  const password = 'Str0ng-Passw0rd!';
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Casey Rivera');

  const groupId = `wsfmc${stamp}`.replace(/-/g, '');
  await seedCommunity({
    groupId,
    displayName: 'Riverside Runners',
    joinPolicy: 'private',
    members: [{ uid, role: 'member' }],
  });
  await seedVis(groupId, uid, 'member', 'visible', true);
  for (const [n, nm, role] of [
    ['a', 'Devon Marsh', 'foundingChampion'],
    ['b', 'Priya Raman', 'member'],
    ['c', 'Sam Okonkwo', 'member'],
    ['e', 'Tasha Bell', 'member'],
  ] as const) {
    await seedProfile(`${groupId}-${n}`, nm);
    await seedVis(groupId, `${groupId}-${n}`, role, 'visible', true);
  }
  // A member who chose NOT to be shown, and five who never answered: the
  // member count is a real roll over real rows, and the list is properly
  // shorter than it.
  await seedProfile(`${groupId}-d`, 'Quentin Ward');
  await seedVis(groupId, `${groupId}-d`, 'member', 'private', true);
  for (let i = 0; i < 5; i += 1) await seedMembership(groupId, `${groupId}-x${i}`, 'member');

  const quietId = `wsfmq${stamp}`.replace(/-/g, '');
  await seedCommunity({
    groupId: quietId,
    displayName: 'Westside Walkers',
    joinPolicy: 'private',
    members: [{ uid, role: 'member' }],
  });
  await seedVis(quietId, uid, 'member', 'private', true);
  for (let i = 0; i < 4; i += 1) await seedMembership(quietId, `${quietId}-y${i}`, 'member');

  const freshId = `wsfmf${stamp}`.replace(/-/g, '');
  await seedCommunity({
    groupId: freshId,
    displayName: 'Harbour Hikers',
    joinPolicy: 'private',
    members: [{ uid, role: 'member' }],
  });
  await seedVis(freshId, uid, 'member', 'private', false);
  for (let i = 0; i < 6; i += 1) await seedMembership(freshId, `${freshId}-z${i}`, 'member');

  return { email, password, uid, groupId, quietId, freshId };
}

/** Remember which community Home opens, so `/community` shows the right card. */
async function rememberCurrent(page: Page, uid: string, groupId: string): Promise<void> {
  await page.evaluate(
    ([u, g]) => window.localStorage.setItem(`wsf.currentCommunity.${u}`, g),
    [uid, groupId],
  );
}

for (const c of CLASSES) {
  test.describe(`members proposal · ${c.label}`, () => {
    test.use({ userAgent: IPHONE_UA, viewport: { width: c.w, height: c.h } });

    test('captures the six states', async ({ page }) => {
      const f = await seedAll();
      await signInVia(page, f.email, f.password);
      await rememberCurrent(page, f.uid, f.groupId);

      // 1 · the Community card, with the compact Members preview.
      await page.goto('/community');
      await expect(page.getByTestId('wsf-community-index-current')).toBeVisible({
        timeout: 25_000,
      });
      await expect(page.getByTestId('wsf-community-index-members')).toBeVisible();
      await page.waitForTimeout(700);
      await page.screenshot({
        path: `${OUT}/ACTUAL-community-card-${c.label}.png`,
        fullPage: true,
      });

      // 2 · Members, the viewer visible.
      await page.goto(`/community/${f.groupId}/members`);
      await expect(page.getByTestId('wsf-members-ready')).toBeVisible({ timeout: 25_000 });
      await expect(page.getByTestId('wsf-members-toggle')).toHaveAttribute('aria-checked', 'true');
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/ACTUAL-members-visible-${c.label}.png`, fullPage: true });

      // 3 · the save in flight, from a real click on the real control.
      const toggle = page.getByTestId('wsf-members-toggle');
      await toggle.click();
      await page.screenshot({ path: `${OUT}/ACTUAL-members-saving-${c.label}.png`, fullPage: true });
      await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 20_000 });

      // 4 · Members, the viewer private — and therefore not in the list.
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/ACTUAL-members-private-${c.label}.png`, fullPage: true });

      // 5 · a failed save. The callable is refused at the network edge, so the
      // failure is the product's own path and not a mocked component state.
      await page.route('**/wsfSetCommunityVisibility', (r) => r.abort());
      await toggle.click();
      await expect(page.getByTestId('wsf-members-save-failed')).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `${OUT}/ACTUAL-members-savefailed-${c.label}.png`,
        fullPage: true,
      });
      await page.unroute('**/wsfSetCommunityVisibility');

      // 6 · nobody shown. A real community with real members, none visible.
      await page.goto(`/community/${f.quietId}/members`);
      await expect(page.getByTestId('wsf-members-empty')).toBeVisible({ timeout: 25_000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/ACTUAL-members-nobody-${c.label}.png`, fullPage: true });

      // 7 · the first-arrival sheet, off — over a Home that still works.
      await page.goto(`/community/${f.freshId}`);
      await expect(page.getByTestId('wsf-visibility-arrival')).toBeVisible({ timeout: 25_000 });
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${OUT}/ACTUAL-arrival-off-${c.label}.png` });

      // 8 · the same sheet, on.
      await page.getByTestId('wsf-visibility-arrival-toggle').click();
      await expect(page.getByTestId('wsf-visibility-arrival-toggle')).toHaveAttribute(
        'aria-checked',
        'true',
        { timeout: 20_000 },
      );
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/ACTUAL-arrival-on-${c.label}.png` });
    });
  });
}
