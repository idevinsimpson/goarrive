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
 * W7 — INDEPENDENT VERIFICATION of `/?view=communities` (PR #432, head
 * `de8f567`). This file is a CHECK, not the feature's own suite: it is written
 * against the contract the candidate states in prose, by a worker that did not
 * write the candidate, and it deliberately does NOT re-run W4's
 * `sprint-w4-home-view-communities.spec.ts`. Where the two overlap, the
 * overlap is the point — two independent readings of the same claim.
 *
 * The contract being checked, in the candidate's own words:
 *
 *   1. Home opening the member's community STAYS THE DEFAULT. Bare `/`
 *      behaves exactly as it did.
 *   2. ONLY the exact single value `view=communities` opts out of that one
 *      navigation's automatic selection. "An opt-in that could fire by
 *      accident would be a change to the default wearing a query string."
 *   3. Specifically, "the array expo-router returns for a repeated `?view=`"
 *      keeps today's behaviour. THE CANDIDATE'S OWN SPEC DOES NOT EXERCISE A
 *      REPEATED PARAM — its four default-preserving variants are `banana`,
 *      empty, wrong case and a wrong key. The repeated cases below are the
 *      untested half of that sentence, and they are why this file exists.
 *   4. Nothing is written and nothing is remembered. `resolveCurrentCommunity`
 *      is a pure read, so the claim is checkable directly: after a navigation
 *      through the list, the per-account key must be exactly as it was —
 *      INCLUDING still absent when it was absent, which is the case the
 *      candidate's spec does not cover.
 *   5. The signed-out gate is untouched and still applied with the param
 *      present.
 *
 * This is behaviour. No frames are captured and no screenshot is rebaselined.
 *
 * NOTE ON BASE: this file asserts behaviour that only exists on the candidate.
 * Run it against #432's head (or a local merge of it); on the unmodified
 * `claude/wsf-app-shell` base the opt-in cases fail by design, because there
 * the param does nothing.
 */

/** The module's own documented per-account key (`src/currentCommunity.ts`). */
const rememberedKey = (uid: string) => `wsf.currentCommunity.${uid}`;

type Member = { uid: string; email: string; password: string };

async function newMember(): Promise<Member> {
  const email = `wsf-w7hv-${stampId()}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'W7 Verification Member');
  return { uid, email, password };
}

async function community(uid: string, displayName: string): Promise<string> {
  const groupId = `w7hv-${stampId()}`;
  await seedCommunity({
    groupId,
    displayName,
    joinPolicy: 'private',
    members: [{ uid, role: 'foundingChampion' }],
  });
  return groupId;
}

/** Home stayed Home and is showing the member's communities. */
async function expectsList(page: Page, query: string): Promise<void> {
  await expect(page.getByTestId('wsf-home')).toBeVisible({ timeout: 25_000 });
  await expect(
    page.getByTestId('wsf-home-my-list'),
    `"${query}" did not reach the list`,
  ).toBeVisible({ timeout: 20_000 });
  expect(new URL(page.url()).pathname, `"${query}" navigated away from Home`).toBe('/');
}

/**
 * Home did what it does by default: opened a community. Asserted on the URL
 * AND on the absence of the list, so a screen that somehow rendered both
 * cannot read as a pass.
 */
async function expectsOpened(page: Page, groupId: string, query: string): Promise<void> {
  await page.waitForURL(new RegExp(`/community/${groupId}\\b`), { timeout: 25_000 });
  expect(
    await page.getByTestId('wsf-home-my-list').count(),
    `"${query}" showed the community list while opening a community`,
  ).toBe(0);
}

async function remembered(page: Page, uid: string): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), rememberedKey(uid));
}

test.describe('W7 verification — /?view=communities on PR #432', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /**
   * THE UNTESTED HALF OF THE CLAIM: a repeated `?view=`.
   *
   * Three shapes, each a plausible way a real link goes wrong — the same value
   * twice (a link built twice), the opt-in value arriving second after junk,
   * and the opt-in value arriving first and being followed by junk. The
   * candidate says every one of them keeps the default. A member with exactly
   * one community makes the default unmistakable: the community opens.
   */
  test('a repeated view param keeps the default, in every order', async ({ page }) => {
    test.setTimeout(240_000);
    const me = await newMember();
    const only = await community(me.uid, 'Repeated Param Community');
    await signInVia(page, me.email, me.password);

    for (const query of [
      '?view=communities&view=communities',
      '?view=banana&view=communities',
      '?view=communities&view=banana',
      '?view=&view=communities',
    ]) {
      await page.goto(`/${query}`);
      await expectsOpened(page, only, query);
    }
  });

  /** Repeated junk is still junk: nothing here resembles the opt-in. */
  test('a repeated unknown view param keeps the default', async ({ page }) => {
    test.setTimeout(180_000);
    const me = await newMember();
    const only = await community(me.uid, 'Repeated Junk Community');
    await signInVia(page, me.email, me.password);

    for (const query of ['?view=x&view=y', '?view=COMMUNITIES&view=Communities']) {
      await page.goto(`/${query}`);
      await expectsOpened(page, only, query);
    }
  });

  /**
   * The shape the F6 link will actually have. The opt-in is one param among
   * others, and the others must not disturb it — an opt-in that only worked
   * as the sole param would break the moment a caller added a `from=`.
   */
  test('the single exact value opts in, alongside unrelated params', async ({ page }) => {
    test.setTimeout(180_000);
    const me = await newMember();
    const only = await community(me.uid, 'Sole Community');
    await signInVia(page, me.email, me.password);

    // The default first, so the opt-in below is measured against it.
    await page.goto('/');
    await expectsOpened(page, only, '/ (bare)');

    for (const query of ['?view=communities', '?view=communities&from=create', '?from=x&view=communities']) {
      await page.goto(`/${query}`);
      await expectsList(page, query);
      await expect(page.getByText('Sole Community').first()).toBeVisible();
    }

    // And the default is intact afterwards.
    await page.goto('/');
    await expectsOpened(page, only, '/ (bare, after the opt-in)');
  });

  /**
   * "NOTHING IS WRITTEN, NOTHING IS REMEMBERED", checked from the absent
   * state, which is the direction that can actually regress: three
   * communities and no remembered one is exactly when a helpful
   * implementation would be tempted to pick one and record it.
   */
  test('passing through the list writes nothing when nothing was remembered', async ({ page }) => {
    test.setTimeout(180_000);
    const me = await newMember();
    await community(me.uid, 'Harborview Walkers');
    await community(me.uid, 'Riverside Steps');
    await community(me.uid, 'Northside Mornings');
    await signInVia(page, me.email, me.password);

    expect(await remembered(page, me.uid), 'a community was remembered before anything opened one').toBeNull();

    await page.goto('/?view=communities');
    await expectsList(page, '?view=communities');
    await expect(page.getByText('Harborview Walkers').first()).toBeVisible();
    await expect(page.getByText('Riverside Steps').first()).toBeVisible();
    await expect(page.getByText('Northside Mornings').first()).toBeVisible();

    expect(
      await remembered(page, me.uid),
      'the list navigation recorded a community the member never chose',
    ).toBeNull();
  });

  /**
   * THE CASE THE OPT-IN EXISTS FOR, with the remembered community deliberately
   * NEITHER the newest NOR the only one: three communities, the first one
   * remembered. Bare Home opens the remembered one and cannot tell the member
   * whether the newest exists; the opt-in lists all three; and what is
   * remembered survives the round trip untouched.
   */
  test('a remembered community that is not the newest still opens, and the list shows the rest', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const me = await newMember();
    const first = await community(me.uid, 'Oldest Circle');
    const middle = await community(me.uid, 'Middle Circle');
    const newest = await community(me.uid, 'Newest Circle');
    await signInVia(page, me.email, me.password);

    await page.evaluate(
      ([key, value]) => window.localStorage.setItem(key, value),
      [rememberedKey(me.uid), first] as const,
    );

    await page.goto('/');
    await expectsOpened(page, first, '/ (bare, remembered = oldest)');

    await page.goto('/?view=communities');
    await expectsList(page, '?view=communities');
    await expect(page.getByText('Oldest Circle').first()).toBeVisible();
    await expect(page.getByText('Middle Circle').first()).toBeVisible();
    await expect(page.getByText('Newest Circle').first()).toBeVisible();
    expect(await remembered(page, me.uid), 'the list changed which community is remembered').toBe(first);

    // The repeated form of the param must not quietly do the same thing.
    await page.goto('/?view=communities&view=communities');
    await expectsOpened(page, first, '?view=communities&view=communities');

    // And bare Home is still exactly what it was, pointing at the same one.
    await page.goto('/');
    await expectsOpened(page, first, '/ (bare, after the round trip)');
    expect(await remembered(page, me.uid), 'the round trip changed what is remembered').toBe(first);

    // The two communities the member never opened were never remembered.
    expect([middle, newest]).not.toContain(await remembered(page, me.uid));
  });

  /** Zero communities: the param is inert and the empty state is the empty state. */
  test('with no communities the param changes nothing and remembers nothing', async ({ page }) => {
    test.setTimeout(180_000);
    const me = await newMember();
    await signInVia(page, me.email, me.password);

    for (const query of ['', '?view=communities', '?view=communities&view=communities']) {
      await page.goto(`/${query}`);
      await expect(page.getByTestId('wsf-home-my-empty')).toBeVisible({ timeout: 20_000 });
      expect(new URL(page.url()).pathname, `"${query}" navigated away from Home`).toBe('/');
    }
    expect(await remembered(page, me.uid), 'a member with no communities was given a remembered one').toBeNull();
  });

  /**
   * The gate. A visitor who is not signed in must get the signed-out Home and
   * no list, with the param in every shape — including the repeated one, since
   * that is the shape this file exists to probe.
   */
  test('signed out, no shape of the param reveals a list', async ({ page }) => {
    test.setTimeout(180_000);

    for (const query of [
      '?view=communities',
      '?view=communities&view=communities',
      '?view=banana&view=communities',
    ]) {
      await page.goto(`/${query}`);
      await expect(page.getByTestId('wsf-home-signed-out')).toBeVisible({ timeout: 20_000 });
      expect(
        await page.getByTestId('wsf-home-my-list').count(),
        `"${query}" showed a signed-out visitor a community list`,
      ).toBe(0);
    }
  });
});
