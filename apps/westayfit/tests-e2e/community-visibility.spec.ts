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
  /** Whether this member has already answered the question for this community. */
  prompted = false,
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
  // The caller starts PRIVATE — the product's default — and ALREADY ASKED, so
  // the arrival sheet does not sit over the cases that are about the
  // directory. The sheet has its own describe at the bottom of this file.
  await seedVisibleMembership(groupId, uid, 'foundingChampion', 'private', true);

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

    // One line says why the list is the length it is — the single thing a
    // member cannot work out for themselves and would otherwise get wrong.
    expect(text).toContain('Only members who choose to be visible are shown.');
    // And the page is not called "Who is here", which reads as live presence.
    expect(text).toContain('People here');
    expect(text).not.toContain('Who is here');
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

    /*
      THE TOGGLE'S STATE, read from `aria-checked` rather than from a colour or
      a sentence. The control announces itself as a switch, and that attribute
      is what a member using a screen reader actually gets.
    */
    const toggle = page.getByTestId('wsf-members-toggle');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click();

    // The settled value, read back from the server.
    await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 });
    await expect(page.getByTestId('wsf-members-list')).toContainText('Casey Caller');

    // A RELOAD IS THE REAL TEST. Optimistic local state would also have
    // redrawn the control; only a stored value survives a fresh read.
    await page.reload();
    await expect(page.getByTestId('wsf-members-ready')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId('wsf-members-toggle')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('wsf-members-list')).toContainText('Casey Caller');
  });

  test('and can take it back', async ({ page }) => {
    const f = await seedFixture();
    await openMembers(page, f);

    const toggle = page.getByTestId('wsf-members-toggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 });

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 20_000 });

    await page.reload();
    await expect(page.getByTestId('wsf-members-ready')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId('wsf-members-toggle')).toHaveAttribute('aria-checked', 'false');
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
    await expect(empty).toContainText('No one has chosen to show their name yet.');
    /*
      AND THE STANDING LINE IS STILL THERE. A member reading an empty list in a
      community of two must not conclude it is deserted. The page no longer
      spells that out in a paragraph — it says why the list is short, once, and
      that line has to be present in the EMPTY case too or the empty state
      reads as "nobody is here".
    */
    await expect(page.getByTestId('wsf-members-foot')).toContainText(
      'Only members who choose to be visible are shown.',
    );
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
    await expect(page.getByTestId('wsf-members-toggle')).toHaveAttribute('aria-checked', 'true', {
      timeout: 20_000,
    });

    await page.goto('/community');
    await expect(page.getByTestId('wsf-community-index-who')).toContainText('Your name is shown', {
      timeout: 25_000,
    });
  });
});

/* ── the arrival sheet ───────────────────────────────────────────────────── */

/**
 * THE ONE TIME A MEMBER IS ASKED, IN THE COMMUNITY IT IS ABOUT.
 *
 * Asked on ARRIVAL rather than in the Join flow: that flow is hardened and
 * freshly re-baselined, and carries its own privacy and destination-continuity
 * guarantees for people following a link while signed out. The membership is
 * created private by Join, exactly as before, and this sheet asks one screen
 * later where the member can already see which community it is about.
 *
 * The properties below are the ones that make it an invitation rather than a
 * gate: it does not block, declining is recorded so nobody is nagged, and
 * a rejoin asks again.
 */
async function seedUnpromptedMember(): Promise<{
  email: string;
  password: string;
  uid: string;
  groupId: string;
}> {
  const stamp = stampId();
  const email = `wsf-ask-${stamp}@example.test`;
  const password = 'Str0ng-Passw0rd!';
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Newly Arrived');
  const groupId = `wsfask${stamp}`.replace(/-/g, '');
  await seedCommunity({
    groupId,
    displayName: 'Riverside Runners',
    joinPolicy: 'private',
    members: [{ uid, role: 'foundingChampion' }],
  });
  // No `visibilityPromptedAt` — this is what a new join, a new community, a
  // rejoin, a reinstatement AND every legacy membership all look like.
  await seedVisibleMembership(groupId, uid, 'foundingChampion', 'private');
  return { email, password, uid, groupId };
}

test.describe('being asked, once, in the community it is about', () => {
  test('a member who has not been asked is asked on arrival, naming the community', async ({
    page,
  }) => {
    const f = await seedUnpromptedMember();
    await signInVia(page, f.email, f.password);
    await page.goto(`/community/${f.groupId}`);

    const sheet = page.getByTestId('wsf-visibility-arrival');
    await expect(sheet).toBeVisible({ timeout: 25_000 });
    // THE COMMUNITY'S NAME IS IN THE QUESTION. This is the whole reason it is
    // not an account-level onboarding step — and it is in the control's own
    // label, not a title above it, so the question IS the toggle.
    await expect(page.getByTestId('wsf-visibility-arrival-toggle')).toContainText(
      'Show my name in Riverside Runners',
    );
    // And it is OFF until they turn it on.
    await expect(page.getByTestId('wsf-visibility-arrival-toggle')).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  test('IT DOES NOT BLOCK — Home is behind it and Continue leaves the member private', async ({
    page,
  }) => {
    const f = await seedUnpromptedMember();
    await signInVia(page, f.email, f.password);
    await page.goto(`/community/${f.groupId}`);
    await expect(page.getByTestId('wsf-visibility-arrival')).toBeVisible({ timeout: 25_000 });

    // Home itself is loaded and present underneath, not replaced by a gate.
    await expect(page.getByTestId('wsf-community')).toBeVisible();

    await page.getByTestId('wsf-visibility-arrival-continue').click();
    await expect(page.getByTestId('wsf-visibility-arrival')).toBeHidden({ timeout: 20_000 });

    // Continuing with the toggle off is an answer, and the answer is private.
    await page.goto(`/community/${f.groupId}/members`);
    await expect(page.getByTestId('wsf-members-ready')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId('wsf-members-toggle')).toHaveAttribute('aria-checked', 'false');
    expect(await page.evaluate(() => document.body.innerText)).not.toContain('Newly Arrived');
  });

  test('THE SHEET DOES NOT COVER THE WAY OUT', async ({ page }) => {
    /*
      THE BUG THIS EXISTS FOR. Passing taps through the area around the sheet
      stops it swallowing the whole page, but the sheet's own body still sits
      on whatever is at the foot of it — and on Home that is "Membership
      options", the disclosure a member opens to LEAVE a community. A privacy
      invitation that covers the way out is the worst thing it could cover,
      and the leave flow hung on exactly that control for a full test timeout
      before Home learned to reserve room for the sheet.

      Asserted with a real click rather than `toBeVisible`, because visibility
      is not the property that broke: the control had a perfectly good
      bounding box the whole time. It simply could not be tapped.
    */
    /*
      An ORDINARY MEMBER, not a Champion. A sole Champion has "Manage" rather
      than "Membership options" and cannot leave at all (D7), so they are
      precisely the one person for whom this control does not exist — and
      seeding one is how the first version of this guard failed for a reason
      that had nothing to do with the sheet.
    */
    const stamp = stampId();
    const email = `wsf-wayout-${stamp}@example.test`;
    const password = 'Str0ng-Passw0rd!';
    const uid = await seedVerifiedUser(email, password);
    await seedProfile(uid, 'Leaving Member');
    const groupId = `wsfout${stamp}`.replace(/-/g, '');
    const champUid = `${groupId}-champ`;
    await seedCommunity({
      groupId,
      displayName: 'Riverside Runners',
      joinPolicy: 'public',
      members: [{ uid: champUid, role: 'foundingChampion' }],
    });
    await seedProfile(champUid, 'The Champion');
    await seedVisibleMembership(groupId, champUid, 'foundingChampion', 'private', true);
    // Unanswered, so the sheet is up.
    await seedVisibleMembership(groupId, uid, 'member', 'private');

    await signInVia(page, email, password);
    await page.goto(`/community/${groupId}`);
    await expect(page.getByTestId('wsf-visibility-arrival')).toBeVisible({ timeout: 25_000 });

    const options = page.getByTestId('wsf-community-membership-toggle');
    // `click()` performs Playwright's hit-target check, so this fails if the
    // sheet is on top of it — which is the whole point.
    await options.click({ timeout: 15_000 });
    await expect(page.getByTestId('wsf-community-leave')).toBeVisible({ timeout: 15_000 });
  });

  test('DECLINING IS AN ANSWER — the question does not come back', async ({ page }) => {
    /*
      THE ASSERTION THAT KEEPS THIS AN INVITATION. If only "visible" were
      recorded, every member who declined would be asked again on every single
      arrival — the person who most clearly said no would be the one the
      product pestered. Recording the decline is what makes it one-time.
    */
    const f = await seedUnpromptedMember();
    await signInVia(page, f.email, f.password);
    await page.goto(`/community/${f.groupId}`);
    await expect(page.getByTestId('wsf-visibility-arrival')).toBeVisible({ timeout: 25_000 });
    await page.getByTestId('wsf-visibility-arrival-continue').click();
    await expect(page.getByTestId('wsf-visibility-arrival')).toBeHidden({ timeout: 20_000 });

    // A FULL RELOAD, not a client-side navigation: the local dismissal flag is
    // gone, so only the stored answer can keep the sheet away.
    await page.reload();
    await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId('wsf-visibility-arrival')).toBeHidden();
  });

  test('accepting from the sheet publishes the member, and is not asked again', async ({
    page,
  }) => {
    const f = await seedUnpromptedMember();
    await signInVia(page, f.email, f.password);
    await page.goto(`/community/${f.groupId}`);
    await expect(page.getByTestId('wsf-visibility-arrival')).toBeVisible({ timeout: 25_000 });

    await page.getByTestId('wsf-visibility-arrival-toggle').click();
    await expect(page.getByTestId('wsf-visibility-arrival-toggle')).toHaveAttribute(
      'aria-checked',
      'true',
      { timeout: 20_000 },
    );
    await page.getByTestId('wsf-visibility-arrival-continue').click();
    await expect(page.getByTestId('wsf-visibility-arrival')).toBeHidden({ timeout: 20_000 });

    await page.reload();
    await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId('wsf-visibility-arrival')).toBeHidden();

    await page.goto(`/community/${f.groupId}/members`);
    await expect(page.getByTestId('wsf-members-ready')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId('wsf-members-toggle')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('wsf-members-list')).toContainText('Newly Arrived');
  });

  test('a member who has already answered is never asked again', async ({ page }) => {
    const f = await seedFixture();
    await signInVia(page, f.email, f.password);
    await page.goto(`/community/${f.groupId}`);
    await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId('wsf-visibility-arrival')).toBeHidden();
  });

  test('the sheet and the settings page ask the SAME question in the same words', async ({
    page,
  }) => {
    /*
      A privacy control phrased one way on arrival and another way in settings
      teaches a member that they mean different things. They are the same
      setting and they say the same sentence, which is why both render the same
      component.
    */
    const f = await seedUnpromptedMember();
    await signInVia(page, f.email, f.password);

    await page.goto(`/community/${f.groupId}`);
    await expect(page.getByTestId('wsf-visibility-arrival')).toBeVisible({ timeout: 25_000 });
    const onArrival = page.getByTestId('wsf-visibility-arrival-toggle');
    // Same control: a switch, off, with the same verb and the same direction.
    await expect(onArrival).toHaveAttribute('role', 'switch');
    await expect(onArrival).toHaveAttribute('aria-checked', 'false');
    /*
      The ONLY permitted difference between the two surfaces is which phrase
      points at the community, and it may only ever get MORE specific: the
      sheet names it outright because the question arrives on its own, the
      settings page says "this community" because the screen around it has
      already said which. Any other divergence — a different verb, a different
      direction, a second question — is the drift this pins.

      Asserted HERE, before navigating: a locator checked after its page has
      gone is a locator that can only ever report a stale answer.
    */
    await expect(onArrival).toContainText('Show my name in Riverside Runners');

    await page.getByTestId('wsf-visibility-arrival-continue').click();
    await page.goto(`/community/${f.groupId}/members`);
    await expect(page.getByTestId('wsf-members-ready')).toBeVisible({ timeout: 25_000 });

    const inSettings = page.getByTestId('wsf-members-toggle');
    await expect(inSettings).toHaveAttribute('role', 'switch');
    await expect(inSettings).toHaveAttribute('aria-checked', 'false');
    await expect(inSettings).toContainText('Show my name in this community');
    await expect(page.getByTestId('wsf-members-own')).toContainText(
      'members of Riverside Runners can see your name and role',
    );
  });

  test('the answer is per community — answering one does not answer another', async ({ page }) => {
    const a = await seedUnpromptedMember();
    // A second community for the SAME member, also unanswered.
    const stamp = stampId();
    const groupB = `wsfaskb${stamp}`.replace(/-/g, '');
    await seedCommunity({
      groupId: groupB,
      displayName: 'Westside Walkers',
      joinPolicy: 'private',
      members: [{ uid: a.uid, role: 'member' }],
    });
    await seedVisibleMembership(groupB, a.uid, 'member', 'private');

    await signInVia(page, a.email, a.password);
    await page.goto(`/community/${a.groupId}`);
    await expect(page.getByTestId('wsf-visibility-arrival')).toBeVisible({ timeout: 25_000 });
    await page.getByTestId('wsf-visibility-arrival-toggle').click();
    await expect(page.getByTestId('wsf-visibility-arrival-toggle')).toHaveAttribute(
      'aria-checked',
      'true',
      { timeout: 20_000 },
    );
    await page.getByTestId('wsf-visibility-arrival-continue').click();
    await expect(page.getByTestId('wsf-visibility-arrival')).toBeHidden({ timeout: 20_000 });

    /*
      THE OTHER COMMUNITY ASKS ITS OWN QUESTION, and the toggle there is OFF.
      A member glad to be named among the runners has said nothing at all about
      the walkers, and a visible choice must never carry across.
    */
    await page.goto(`/community/${groupB}`);
    const sheet = page.getByTestId('wsf-visibility-arrival');
    await expect(sheet).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId('wsf-visibility-arrival-toggle')).toContainText(
      'Show my name in Westside Walkers',
    );
    await expect(page.getByTestId('wsf-visibility-arrival-toggle')).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });
});
