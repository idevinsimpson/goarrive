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
 * WHO IS HERE (`/community/[groupId]/members`) — BEHAVIOUR ON THE RUNNING
 * PRODUCT.
 *
 * The privacy properties themselves are enforced in the callables and pinned
 * by `functions-westayfit/tests/callable/wsf-community-visibility.test.ts`,
 * which is where a leak would actually be caught. This file asserts the
 * things only a real browser against a real emulator can show:
 *
 *   · The page renders nobody until somebody has chosen, and says WHY in
 *     words that do not read as "nobody is here".
 *   · A member's own choice round-trips through the real callable and is
 *     visible to another member's session afterwards.
 *   · A PRIVATE member's name is not in the delivered HTML — not merely
 *     hidden by a style, which a screenshot could not tell apart.
 *   · No uid reaches the page, in any element, at any point.
 *
 * NOT A CAPTURE SPEC. It writes no PNGs; the frames are a separate run.
 */

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

/** Seed a membership with an explicit `visibility`, the way the server writes it. */
async function seedVisibleMembership(
  groupId: string,
  uid: string,
  role: 'foundingChampion' | 'member',
  visibility: 'private' | 'visible',
): Promise<void> {
  const now = new Date();
  await firestoreWrite(`wsfMemberships/${groupId}_${uid}`, {
    groupId: { stringValue: groupId },
    userId: { stringValue: uid },
    role: { stringValue: role },
    membershipStatus: { stringValue: 'active' },
    visibility: { stringValue: visibility },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });
}

type Fixture = {
  email: string;
  password: string;
  uid: string;
  groupId: string;
  /** Another member, named. */
  namedUid: string;
  namedName: string;
  /** Another member, private. */
  quietUid: string;
  quietName: string;
};

/**
 * One community, three members: the signed-in caller (private), somebody
 * named, and somebody private. Every row is a document the product itself
 * would have written.
 */
async function seedFixture(): Promise<Fixture> {
  const stamp = stampId();
  const email = `wsf-vis-${stamp}@example.test`;
  const password = 'Str0ng-Passw0rd!';
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Casey Caller');

  const groupId = `wsfvis${stamp}`.replace(/-/g, '');
  await seedCommunity({
    groupId,
    displayName: 'Riverside Runners',
    joinPolicy: 'private',
    members: [{ uid, role: 'foundingChampion' }],
  });
  // The caller starts PRIVATE, which is the product's default and the state a
  // member arrives in.
  await seedVisibleMembership(groupId, uid, 'foundingChampion', 'private');

  const namedUid = `${groupId}-named`;
  const namedName = 'Devon Named';
  await seedProfile(namedUid, namedName);
  await seedVisibleMembership(groupId, namedUid, 'member', 'visible');

  const quietUid = `${groupId}-quiet`;
  const quietName = 'Quentin Quiet';
  await seedProfile(quietUid, quietName);
  await seedVisibleMembership(groupId, quietUid, 'member', 'private');

  // A legacy row with NO visibility field at all — every membership written
  // before this feature looks like this.
  const legacyUid = `${groupId}-legacy`;
  await seedProfile(legacyUid, 'Lee Legacy');
  await seedMembership(groupId, legacyUid, 'member');

  localStorageSeed.set(uid, groupId);
  return { email, password, uid, groupId, namedUid, namedName, quietUid, quietName };
}

/** What `rememberCurrentCommunity()` writes, so Community opens on this one. */
const localStorageSeed = new Map<string, string>();

async function openMembers(page: Page, f: Fixture): Promise<void> {
  await signInVia(page, f.email, f.password);
  await page.evaluate(
    ([uid, groupId]) => window.localStorage.setItem(`wsf.currentCommunity.${uid}`, groupId),
    [f.uid, f.groupId],
  );
  await page.goto(`/community/${f.groupId}/members`);
  await expect(page.getByTestId('wsf-members-ready')).toBeVisible({ timeout: 25_000 });
}

test.use({ userAgent: IPHONE_UA, viewport: { width: 390, height: 844 } });

test.describe('who is here', () => {
  test('lists only the member who chose to be named', async ({ page }) => {
    const f = await seedFixture();
    await openMembers(page, f);

    const list = page.getByTestId('wsf-members-list');
    await expect(list).toBeVisible();
    await expect(list).toContainText(f.namedName);

    /*
      NOT `toBeHidden()`. A private member's name must not be IN THE DOCUMENT
      at all — a name delivered to the browser and hidden with CSS is a name
      the browser received, readable in devtools and in the page source, and a
      screenshot cannot tell the two apart. Asserting on the page's text
      content is the assertion that distinguishes them.
    */
    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText).toContain(f.namedName);
    expect(bodyText).not.toContain(f.quietName);
    expect(bodyText).not.toContain('Lee Legacy');
    // And the caller themself is private, so their own name is not in the list.
    expect(await list.innerText()).not.toContain('Casey Caller');
  });

  test('no uid reaches the page, in text or in any attribute', async ({ page }) => {
    const f = await seedFixture();
    await openMembers(page, f);
    /*
      THE WHOLE SERIALISED DOM, not just its text. A uid smuggled into a React
      key, a `data-*` attribute, an aria-label or a title would be invisible to
      an innerText check and is exactly the shape a well-meaning "add a stable
      key" change takes.
    */
    const html = await page.content();
    expect(html).not.toContain(f.namedUid);
    expect(html).not.toContain(f.quietUid);
    expect(html).not.toContain(f.uid);
  });

  test('the page states a choice, not a roster — and never a count of the hidden', async ({
    page,
  }) => {
    const f = await seedFixture();
    await openMembers(page, f);
    const text = await page.evaluate(() => document.body.innerText);

    // The eyebrow says what the list IS.
    expect(text).toContain('WHO CHOSE TO BE NAMED');
    /*
      The community has four active members and one is named. No arithmetic
      over those two numbers may appear — "1 of 4", "3 hidden", "3 others" —
      because each is "how many people are hiding", stated by the product.
    */
    for (const forbidden of ['1 of 4', '3 hidden', '3 others', 'of 4 members', '3 not shown']) {
      expect(text).not.toContain(forbidden);
    }
  });

  test('a member publishes themselves, and it survives a reload', async ({ page }) => {
    const f = await seedFixture();
    await openMembers(page, f);

    await expect(page.getByTestId('wsf-members-own')).toContainText('You are not named here.');
    await page.getByTestId('wsf-members-toggle').click();

    // The settled value, read back from the server.
    await expect(page.getByTestId('wsf-members-own')).toContainText('You are named here.', {
      timeout: 20_000,
    });
    await expect(page.getByTestId('wsf-members-list')).toContainText('Casey Caller');

    // A RELOAD IS THE REAL TEST. Optimistic local state would also have
    // redrawn the panel; only a stored value survives a fresh read.
    await page.reload();
    await expect(page.getByTestId('wsf-members-ready')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId('wsf-members-own')).toContainText('You are named here.');
    await expect(page.getByTestId('wsf-members-list')).toContainText('Casey Caller');
  });

  test('and can take it back', async ({ page }) => {
    const f = await seedFixture();
    await openMembers(page, f);

    await page.getByTestId('wsf-members-toggle').click();
    await expect(page.getByTestId('wsf-members-own')).toContainText('You are named here.', {
      timeout: 20_000,
    });

    await page.getByTestId('wsf-members-toggle').click();
    await expect(page.getByTestId('wsf-members-own')).toContainText('You are not named here.', {
      timeout: 20_000,
    });

    await page.reload();
    await expect(page.getByTestId('wsf-members-ready')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId('wsf-members-own')).toContainText('You are not named here.');
    const listText = await page.getByTestId('wsf-members-list').innerText();
    expect(listText).not.toContain('Casey Caller');
  });

  test('a community with nobody named says so without saying nobody is here', async ({ page }) => {
    const stamp = stampId();
    const email = `wsf-vis-empty-${stamp}@example.test`;
    const password = 'Str0ng-Passw0rd!';
    const uid = await seedVerifiedUser(email, password);
    await seedProfile(uid, 'Solo Member');
    const groupId = `wsfvise${stamp}`.replace(/-/g, '');
    await seedCommunity({
      groupId,
      displayName: 'Quiet Community',
      joinPolicy: 'private',
      members: [{ uid, role: 'foundingChampion' }],
    });
    await seedMembership(groupId, `${groupId}-other`, 'member');
    await seedProfile(`${groupId}-other`, 'Other Person');

    await signInVia(page, email, password);
    await page.goto(`/community/${groupId}/members`);
    await expect(page.getByTestId('wsf-members-ready')).toBeVisible({ timeout: 25_000 });

    const empty = page.getByTestId('wsf-members-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('has chosen to show their name');
    /*
      THE SENTENCE THAT MATTERS. A member reading this must not conclude the
      community is deserted — it has two members. The copy says the true thing
      explicitly rather than leaving the reader to infer the false one.
    */
    await expect(empty).toContainText('not the same as nobody being here');
    expect(await page.evaluate(() => document.body.innerText)).not.toContain('Other Person');
  });

  test('a stranger gets one refusal that does not say which secret it is keeping', async ({
    page,
  }) => {
    const f = await seedFixture();
    const stamp = stampId();
    const email = `wsf-vis-out-${stamp}@example.test`;
    const password = 'Str0ng-Passw0rd!';
    const outsiderUid = await seedVerifiedUser(email, password);
    await seedProfile(outsiderUid, 'Outside Person');
    const ownGroup = `wsfviso${stamp}`.replace(/-/g, '');
    await seedCommunity({
      groupId: ownGroup,
      displayName: 'Their Own Community',
      joinPolicy: 'private',
      members: [{ uid: outsiderUid, role: 'foundingChampion' }],
    });

    await signInVia(page, email, password);

    // A real community they are not in.
    await page.goto(`/community/${f.groupId}/members`);
    await expect(page.getByTestId('wsf-members-refused')).toBeVisible({ timeout: 25_000 });
    const notAMember = await page.evaluate(() => document.body.innerText);

    // A community that does not exist at all.
    await page.goto('/community/wsfvisnosuchgroupatall/members');
    await expect(page.getByTestId('wsf-members-refused')).toBeVisible({ timeout: 25_000 });
    const noSuchGroup = await page.evaluate(() => document.body.innerText);

    /*
      IDENTICAL, WORD FOR WORD. The server is careful to answer both with the
      same `permission-denied`; splitting them apart in the client — "you are
      not a member" versus "no such community" — would rebuild in the browser
      the community-existence oracle the server refused to provide.
    */
    expect(notAMember).toBe(noSuchGroup);
    expect(notAMember).not.toContain('Riverside Runners');
    expect(notAMember).not.toContain(f.namedName);
  });

  test('the shell marks this page as Community, not Home', async ({ page }) => {
    /*
      It lives under a community's path, so the prefix match that lights Home
      for `/community/<id>` would light it here too. But a member reaches this
      page from the COMMUNITY tab, and the bar says Community is "the people
      side". Lighting Home tells them they are somewhere they are not.
    */
    const f = await seedFixture();
    await openMembers(page, f);

    /*
      Asserted on the ACCESSIBILITY LABEL rather than a colour: the bar names
      the current destination "<label>, current" for a screen reader, and that
      is the property a member who cannot see the tint depends on.
    */
    await expect(page.getByTestId('wsf-member-tab-community')).toHaveAttribute(
      'aria-label',
      'Community, current',
    );
    await expect(page.getByTestId('wsf-member-tab-home')).toHaveAttribute('aria-label', 'Home');

    // And Home itself still lights Home — the rule narrowed one route, not the
    // whole prefix.
    await page.goto(`/community/${f.groupId}`);
    await expect(page.getByTestId('wsf-member-tab-home')).toHaveAttribute(
      'aria-label',
      'Home, current',
      { timeout: 25_000 },
    );
  });

  test('Community tells a member whether they are named, before they open the list', async ({
    page,
  }) => {
    const f = await seedFixture();
    await signInVia(page, f.email, f.password);
    await page.evaluate(
      ([uid, groupId]) => window.localStorage.setItem(`wsf.currentCommunity.${uid}`, groupId),
      [f.uid, f.groupId],
    );

    await page.goto('/community');
    const who = page.getByTestId('wsf-community-index-who');
    await expect(who).toBeVisible({ timeout: 25_000 });
    // Private by default, and SAID so rather than left for the member to find.
    await expect(who).toContainText('Your name is not shown');

    await who.click();
    await expect(page.getByTestId('wsf-members-ready')).toBeVisible({ timeout: 25_000 });
    await page.getByTestId('wsf-members-toggle').click();
    await expect(page.getByTestId('wsf-members-own')).toContainText('You are named here.', {
      timeout: 20_000,
    });

    await page.goto('/community');
    await expect(page.getByTestId('wsf-community-index-who')).toContainText('Your name is shown', {
      timeout: 25_000,
    });
  });
});
