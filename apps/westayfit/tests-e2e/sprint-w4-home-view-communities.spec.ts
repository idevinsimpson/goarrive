import { randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import {
  seedCommunity,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * `/?view=communities` — ONE NAVIGATION ASKS HOME NOT TO OPEN A COMMUNITY.
 *
 * Home opening the member's community is right almost always and stays the
 * default; these tests assert that as hard as they assert the opt-in, because
 * a query param that quietly changed the default would be the actual defect.
 *
 * The case the opt-in exists for is the last one in this file: a member who
 * already has a community, creates another, and loses the response. Today
 * `wsfCreateCommunity` has no attempt key, so "it was created" and "it was
 * not" render the SAME screen — Home opens the remembered community either
 * way and the member cannot tell. The list is the only thing that answers it.
 *
 * No frames here. This is behaviour, and it is asserted, not photographed.
 */

/** The module's own documented per-account key (`src/currentCommunity.ts`). */
const REMEMBERED_KEY = (uid: string) => `wsf.currentCommunity.${uid}`;

type Member = { uid: string; email: string; password: string };

async function newMember(): Promise<Member> {
  const email = `wsf-hv-${stampId()}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'View Communities Member');
  return { uid, email, password };
}

async function community(uid: string, displayName: string): Promise<string> {
  const groupId = `hv-${stampId()}`;
  await seedCommunity({
    groupId,
    displayName,
    joinPolicy: 'private',
    members: [{ uid, role: 'foundingChampion' }],
  });
  return groupId;
}

/** Home, with whatever query the case is about, from a cold navigation. */
async function openHome(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.getByTestId('wsf-home')).toBeVisible({ timeout: 25_000 });
}

/** The list is on screen and Home did not navigate away from itself. */
async function expectsList(page: Page): Promise<void> {
  await expect(page.getByTestId('wsf-home-my-list')).toBeVisible({ timeout: 20_000 });
  expect(new URL(page.url()).pathname, 'Home navigated away instead of listing').toBe('/');
  expect(
    await page.getByTestId('wsf-home-opening-community').count(),
    'Home is still opening a community while showing the list',
  ).toBe(0);
}

/** Home opened a community, which is what it does by default. */
async function expectsOpened(page: Page, groupId: string): Promise<void> {
  await page.waitForURL(new RegExp(`/community/${groupId}\\b`), { timeout: 25_000 });
}

test.describe('/?view=communities', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('with no communities, the param changes nothing', async ({ page }) => {
    test.setTimeout(150_000);
    const me = await newMember();
    await signInVia(page, me.email, me.password);

    await openHome(page);
    await expect(page.getByTestId('wsf-home-my-empty')).toBeVisible({ timeout: 20_000 });

    await openHome(page, '?view=communities');
    await expect(page.getByTestId('wsf-home-my-empty')).toBeVisible({ timeout: 20_000 });
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('with one community, bare / still opens it and the param lists it', async ({ page }) => {
    test.setTimeout(150_000);
    const me = await newMember();
    const only = await community(me.uid, 'The Only One');
    await signInVia(page, me.email, me.password);

    // THE DEFAULT, ASSERTED FIRST. If this ever stops holding, the opt-in has
    // stopped being an opt-in.
    await page.goto('/');
    await expectsOpened(page, only);

    await openHome(page, '?view=communities');
    await expectsList(page);
    await expect(page.getByText('The Only One').first()).toBeVisible();
  });

  test('an unrecognised or empty view value keeps the default', async ({ page }) => {
    test.setTimeout(150_000);
    const me = await newMember();
    const only = await community(me.uid, 'Default Holds');
    await signInVia(page, me.email, me.password);

    for (const q of ['?view=banana', '?view=', '?view=Communities', '?viewer=communities']) {
      await page.goto(`/${q}`);
      await expectsOpened(page, only);
    }
  });

  test('signed out, the param does not reveal a list', async ({ page }) => {
    test.setTimeout(120_000);
    await openHome(page, '?view=communities');
    await expect(page.getByTestId('wsf-home-signed-out')).toBeVisible({ timeout: 20_000 });
    expect(
      await page.getByTestId('wsf-home-my-list').count(),
      'a signed-out visitor was shown a community list',
    ).toBe(0);
  });

  /**
   * THE CASE THE OPT-IN EXISTS FOR.
   *
   * A member already in a community "creates" another and never learns the
   * outcome. The remembered community is the OLD one, so bare Home opens that
   * — identical to what it would have shown had the create never happened.
   * Only the list distinguishes the two.
   */
  test('a remembered community is opened by default and does not hide the new one', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const me = await newMember();
    const older = await community(me.uid, 'Harbor Walkers');
    const newer = await community(me.uid, 'Riverside Church');
    await signInVia(page, me.email, me.password);

    // Remember the OLDER one, the way opening it would have.
    await page.goto('/');
    await page.evaluate(
      ([key, value]) => window.localStorage.setItem(key, value),
      [REMEMBERED_KEY(me.uid), older] as const,
    );

    // Bare Home opens the remembered community even though there are two —
    // this is the screen that cannot tell the member what happened.
    await page.goto('/');
    await expectsOpened(page, older);

    // The opt-in shows both, including the one that is not remembered.
    await openHome(page, '?view=communities');
    await expectsList(page);
    await expect(page.getByText('Harbor Walkers').first()).toBeVisible();
    await expect(page.getByText('Riverside Church').first()).toBeVisible();

    // And it did not forget anything: bare Home still opens the remembered one.
    await page.goto('/');
    await expectsOpened(page, older);
    expect(
      await page.evaluate((key) => window.localStorage.getItem(key), REMEMBERED_KEY(me.uid)),
      'passing through the list changed which community is remembered',
    ).toBe(older);
  });
});
