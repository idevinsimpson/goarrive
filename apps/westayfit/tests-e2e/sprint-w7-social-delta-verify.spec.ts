import { randomBytes } from 'node:crypto';

import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  FIRESTORE_EMULATOR,
  IPHONE_UA,
  PROJECT_ID,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * W7 — THE FOCUSED DOM DELTA on W8's final successor **`bfc422a`**.
 *
 * Scope is the four rendering files that moved since `60604ca`, and nothing
 * else: the privacy contract is NOT reopened here — the 14/14 at `60604ca` is
 * the Director's functional acceptance and this file does not re-litigate it.
 * The backend delta over `60604ca` is one comment-only commit, verified by
 * diff (every changed line in `functions-westayfit/` is a comment or blank).
 *
 * THE HEADLINE IS THE SEPARATION OF ZERO FROM NULL. `null` means the server
 * could not establish the count; `0` means it established that nobody has
 * moved yet in the goal's own day. Collapsing the two is exactly the failure
 * the whole feature exists to avoid, so all three states get their own
 * fixture: a proven zero, an unprovable null, and a real count.
 *
 * MEASURED THE WAY THE FAILURE DEMANDS. W8's own report says its fold guard
 * reported safety three times when there was none: it measured against 844
 * instead of the floating tab bar, it ran in a bare browser context while the
 * evidence was shot on an emulated phone, and its fixture was the easy case.
 * So this file runs as an emulated iPhone, measures the first momentum row
 * against the TAB BAR'S OWN BOX rather than against viewport arithmetic, and
 * seeds the hard fixture — a community with presence, a moved-today line and
 * a real feed.
 */

const OWNER = { authorization: 'Bearer owner', 'content-type': 'application/json' };
const AUTH_EMULATOR = 'http://127.0.0.1:9099';

/** The clause the Director had removed from the primary surfaces. */
const PRIVACY_CLAUSE = /choose not to be listed/i;

const ts = (d: Date) => ({ timestampValue: d.toISOString() });

async function write(docPath: string, fields: Record<string, unknown>): Promise<void> {
  const res = await fetch(
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}`,
    { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields }) },
  );
  if (!res.ok) throw new Error(`write ${docPath} failed: ${res.status} ${await res.text()}`);
}

type Person = { uid: string; email: string; password: string; name: string };

async function person(tag: string, name: string): Promise<Person> {
  const email = `wsf-w7dd-${tag}-${stampId()}@example.com`;
  const password = `Aa1!${randomBytes(6).toString('hex')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, name);
  return { uid, email, password, name };
}

async function membership(
  groupId: string,
  uid: string,
  role: 'foundingChampion' | 'member',
  vis?: { name?: string; activity?: string },
): Promise<void> {
  const now = new Date();
  const fields: Record<string, unknown> = {
    groupId: { stringValue: groupId },
    userId: { stringValue: uid },
    role: { stringValue: role },
    membershipStatus: { stringValue: 'active' },
    createdAt: ts(now),
    updatedAt: ts(now),
  };
  if (vis?.name) fields.communityNameVisibility = { stringValue: vis.name };
  if (vis?.activity) fields.communityActivityVisibility = { stringValue: vis.activity };
  await write(`wsfMemberships/${groupId}_${uid}`, fields);
}

async function communityDoc(groupId: string, displayName: string, createdBy: string): Promise<void> {
  const now = new Date();
  await write(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: displayName },
    groupType: { stringValue: 'custom' },
    joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: `JOIN${randomBytes(4).toString('hex')}` },
    createdByUserId: { stringValue: createdBy },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
    createdAt: ts(now),
    updatedAt: ts(now),
  });
}

/** One active goal, so it is the featured one the momentum block reads. */
async function goalDoc(opts: {
  goalId: string;
  groupId: string;
  ownerUid: string;
  timezone: string;
}): Promise<void> {
  const now = Date.now();
  await write(`wsfGoals/${opts.goalId}`, {
    ownerUid: { stringValue: opts.ownerUid },
    communityGroupId: { stringValue: opts.groupId },
    title: { stringValue: 'Squats together this week' },
    target: { integerValue: '500' },
    unit: { stringValue: 'squats' },
    status: { stringValue: 'active' },
    startsAt: ts(new Date(now - 6 * 24 * 3_600_000)),
    endsAt: ts(new Date(now + 6 * 24 * 3_600_000)),
    timezone: { stringValue: opts.timezone },
    createdAt: ts(new Date(now)),
    updatedAt: ts(new Date(now)),
  });
  await write(`wsfGoalCounters/${opts.goalId}/shards/0`, { count: { integerValue: '120' } });
}

async function contribution(opts: {
  groupId: string;
  goalId: string;
  userId: string;
  count: number;
  minutesAgo: number;
}): Promise<void> {
  await write(`wsfContributions/w7d-${stampId()}`, {
    communityGroupId: { stringValue: opts.groupId },
    goalId: { stringValue: opts.goalId },
    userId: { stringValue: opts.userId },
    count: { integerValue: String(opts.count) },
    unit: { stringValue: 'squats' },
    createdAt: ts(new Date(Date.now() - opts.minutesAgo * 60_000)),
  });
}

/**
 * A community whose featured goal's day is resolvable and well inside its
 * window, so `contributorsToday` is a PROVEN number rather than a null.
 * `movers` decides whether that proven number is zero or not.
 */
async function scene(opts: {
  members: number;
  movers: { name: string; vis?: { name?: string; activity?: string } }[];
  timezone?: string;
}): Promise<{ champ: Person; groupId: string; goalId: string; people: Person[] }> {
  const champ = await person('champ', 'Ada Champion');
  const groupId = `w7dd-${stampId()}`;
  const goalId = `w7g-${stampId()}`;
  await communityDoc(groupId, 'Maple Street Movers', champ.uid);
  await membership(groupId, champ.uid, 'foundingChampion');
  const people: Person[] = [];
  for (let i = 1; i < opts.members; i += 1) {
    const mover = opts.movers[i - 1];
    const p = await person(`m${i}`, mover ? mover.name : `Member ${i}`);
    await membership(groupId, p.uid, 'member', mover?.vis);
    people.push(p);
  }
  await goalDoc({ goalId, groupId, ownerUid: champ.uid, timezone: opts.timezone ?? 'America/New_York' });
  for (let i = 0; i < opts.movers.length; i += 1) {
    const p = people[i];
    if (!p) continue;
    await contribution({ groupId, goalId, userId: p.uid, count: 60 - i * 5, minutesAgo: 30 + i * 10 });
  }
  return { champ, groupId, goalId, people };
}

async function openCommunity(page: Page, groupId: string): Promise<void> {
  await page.goto(`/community/${groupId}`);
  await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 25_000 });
  // Both social reads must have resolved before anything is measured: W8's own
  // fourth defect was assertions that passed because the data had not arrived.
  await expect(page.getByTestId('wsf-community-hero-presence')).toBeVisible({ timeout: 25_000 });
}

async function expectHittable(target: Locator, what: string): Promise<void> {
  await expect(target, `${what} is not visible`).toBeVisible({ timeout: 20_000 });
  const covered = await target.evaluate((el) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return 'zero-sized';
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit) return 'nothing at its centre';
    if (hit === el || el.contains(hit) || hit.contains(el)) return null;
    return `covered by <${hit.tagName.toLowerCase()}>`;
  });
  expect(covered, `${what} cannot be pressed: ${covered}`).toBeNull();
}

// An emulated iPhone, not a bare browser context — the difference W8's own
// guard was blind to.
test.use({
  viewport: { width: 390, height: 844 },
  userAgent: IPHONE_UA,
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
});

test.describe('W7 delta on bfc422a — zero vs null, and the corrected pages', () => {
  /**
   * A PROVEN ZERO IS RENDERED. The goal is live, its zone resolves and its
   * window covers now — the server can establish the count, and the count is
   * nobody. The screen must say so.
   */
  test('a proven zero renders “0 people moved today”', async ({ page }) => {
    test.setTimeout(180_000);
    const { champ, groupId } = await scene({ members: 6, movers: [] });
    await signInVia(page, champ.email, champ.password);
    await openCommunity(page, groupId);

    await expect(
      page.getByTestId('wsf-community-contributors-today'),
      'a proven zero was suppressed — "known zero" collapsed into "unknown"',
    ).toHaveText('0 people moved today', { timeout: 20_000 });
  });

  /**
   * AND ONLY `null` IS SILENCE. Same page, same shape, but the goal's stored
   * zone cannot be resolved, so the server cannot establish the day at all.
   */
  test('an unresolvable zone renders no moved-today line at all', async ({ page }) => {
    test.setTimeout(180_000);
    const { champ, groupId } = await scene({
      members: 6,
      movers: [{ name: 'Dana Whitfield' }],
      timezone: 'Not/ARealZone',
    });
    await signInVia(page, champ.email, champ.password);
    await openCommunity(page, groupId);

    // The feed still renders — only the aggregate is withheld.
    await expect(page.getByTestId('wsf-momentum-row').first()).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByTestId('wsf-community-contributors-today'),
      'a line was rendered for a count the server could not establish',
    ).toHaveCount(0);
  });

  /**
   * A real count still reads as a count. Singular and plural are separate
   * tests rather than two sign-ins in one: signing in again while already
   * signed in never reaches /signin, so the second half would have been
   * measuring the first half's session.
   */
  test('one mover renders in the singular', async ({ page }) => {
    test.setTimeout(180_000);
    const { champ, groupId } = await scene({ members: 6, movers: [{ name: 'Dana Whitfield' }] });
    await signInVia(page, champ.email, champ.password);
    await openCommunity(page, groupId);
    await expect(page.getByTestId('wsf-community-contributors-today')).toHaveText(
      '1 person moved today',
      { timeout: 20_000 },
    );
  });

  test('two movers render in the plural', async ({ page }) => {
    test.setTimeout(180_000);
    const { champ, groupId } = await scene({
      members: 6,
      movers: [{ name: 'Dana Whitfield' }, { name: 'Ray Okafor' }],
    });
    await signInVia(page, champ.email, champ.password);
    await openCommunity(page, groupId);
    await expect(page.getByTestId('wsf-community-contributors-today')).toHaveText(
      '2 people moved today',
      { timeout: 20_000 },
    );
  });

  /**
   * COMMUNITY — the corrections, and the fold measured against the thing that
   * actually covers the page.
   */
  test('Community: 6 members with no privacy clause, counts above the hero, first row clear of the tab bar', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const { champ, groupId } = await scene({
      members: 6,
      movers: [{ name: 'Dana Whitfield' }, { name: 'Ray Okafor' }],
    });
    await signInVia(page, champ.email, champ.password);
    await openCommunity(page, groupId);

    // The real count, said simply, on the primary surface.
    await expect(page.getByTestId('wsf-community-hero-presence')).toHaveText('6 members');
    const body = await page.locator('body').innerText();
    expect(body, 'the privacy clause is still on the primary surface').not.toMatch(PRIVACY_CLAUSE);

    // Both facts sit ABOVE the goal hero, and they are different facts.
    const presence = (await page.getByTestId('wsf-community-hero-presence').boundingBox())!;
    const moved = (await page.getByTestId('wsf-community-contributors-today').boundingBox())!;
    const hero = (await page.getByTestId('wsf-community-goal-hero').boundingBox())!;
    expect(presence.y, 'the member count is not above the goal hero').toBeLessThan(hero.y);
    expect(moved.y, 'the moved-today line is not above the goal hero').toBeLessThan(hero.y);
    expect(moved.y, 'the two counts were merged into one line').toBeGreaterThan(presence.y);

    // THE FOLD, MEASURED AGAINST THE FLOATING TAB BAR — not against 844.
    // The bar floats over the page, so a row at y=770 is "inside the viewport"
    // by arithmetic and invisible in practice.
    const tabs = (await page.getByTestId('wsf-member-tabs').boundingBox())!;
    expect(tabs, 'the tab bar has no box to measure against').toBeTruthy();
    const firstRow = (await page.getByTestId('wsf-momentum-row').first().boundingBox())!;
    expect(
      firstRow.y + firstRow.height,
      'the first momentum row is under the floating tab bar on the initial viewport',
    ).toBeLessThanOrEqual(tabs.y);
    // ...and it is genuinely on screen, not merely above the bar.
    await expectHittable(page.getByTestId('wsf-momentum-row').first(), 'the first momentum row');

    // Start moving: full width and reachable.
    const start = page.getByTestId(/^wsf-community-goal-link-/);
    await expectHittable(start, 'Start moving');
    await expect(start).toHaveText('Start moving');
    const startBox = (await start.boundingBox())!;
    expect(
      startBox.width,
      'Start moving is no longer full width',
    ).toBeGreaterThan(390 * 0.8);
  });

  /**
   * THE FEED'S TWO PRIVACY STATES, on the corrected page: an anonymous row is
   * a row, and a private activity is no row at all.
   */
  test('Community: “Anonymous member” for a hidden name, and no row for private activity', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const { champ, groupId } = await scene({
      members: 6,
      movers: [
        { name: 'Masked Mover', vis: { name: 'private', activity: 'visible' } },
        { name: 'Hidden Mover', vis: { activity: 'private' } },
        { name: 'Open Mover' },
      ],
    });
    await signInVia(page, champ.email, champ.password);
    await openCommunity(page, groupId);

    await expect(page.getByTestId('wsf-momentum-row').first()).toBeVisible({ timeout: 20_000 });
    const feed = await page.getByTestId('wsf-community-momentum-card').innerText();
    expect(feed, 'a name-private mover is not shown as Anonymous member').toContain(
      'Anonymous member',
    );
    expect(feed, 'a name-private mover was named').not.toContain('Masked Mover');
    expect(feed, 'an activity-private mover has a row').not.toContain('Hidden Mover');
    expect(feed, 'the visible mover lost their name').toContain('Open Mover');
    // The copy that used to be here is gone.
    expect(feed).not.toMatch(/\bA member\b/);
  });

  /** MEMBERS — heading, no Settings row, no privacy clause while people are listed. */
  test('Members: the heading, the removed Settings row, and no privacy clause', async ({ page }) => {
    test.setTimeout(240_000);
    const { champ, groupId } = await scene({ members: 6, movers: [{ name: 'Dana Whitfield' }] });
    await signInVia(page, champ.email, champ.password);

    await page.goto(`/community/${groupId}/members`);
    await expect(page.getByTestId('wsf-members-screen')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId('wsf-members-panel')).toBeVisible({ timeout: 25_000 });

    await expect(page.getByText('Members', { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('wsf-members-count')).toHaveText('6 members');

    const body = await page.locator('body').innerText();
    expect(body, 'the privacy clause is still on the inhabited Members page').not.toMatch(
      PRIVACY_CLAUSE,
    );
    expect(body, 'the Your-visibility row is still on Members').not.toMatch(
      /Your visibility here/i,
    );
    // People are listed, so the quiet empty state must NOT be showing.
    await expect(page.getByTestId('wsf-members-none-listed')).toHaveCount(0);
    expect(await page.getByTestId('wsf-member-row').count()).toBeGreaterThan(0);
  });

  /** ...and the one quiet empty state, only when every member is private. */
  test('Members: the quiet empty state appears only when everyone is private', async ({ page }) => {
    test.setTimeout(240_000);
    const champ = await person('champ', 'Ada Champion');
    const groupId = `w7dd-${stampId()}`;
    await communityDoc(groupId, 'Maple Street Movers', champ.uid);
    await membership(groupId, champ.uid, 'foundingChampion', { name: 'private' });
    for (let i = 1; i < 6; i += 1) {
      const p = await person(`p${i}`, `Private ${i}`);
      await membership(groupId, p.uid, 'member', { name: 'private' });
    }
    await signInVia(page, champ.email, champ.password);

    await page.goto(`/community/${groupId}/members`);
    await expect(page.getByTestId('wsf-members-panel')).toBeVisible({ timeout: 25_000 });
    await expect(
      page.getByTestId('wsf-members-none-listed'),
      'the all-private community has no explanation at all',
    ).toBeVisible();
    expect(await page.getByTestId('wsf-member-row').count()).toBe(0);
    // The count is still the truth: everyone is hidden, nobody is gone.
    await expect(page.getByTestId('wsf-members-count')).toHaveText('6 members');
  });

  /**
   * SETTINGS / PRIVACY — behaviour unchanged, and the note quotes the feed's
   * own words.
   *
   * The note is conditional, not decorative: it renders only for the one
   * combination it describes — name private WITH activity visible — which is
   * exactly the state that produces an anonymous row. So the fixture puts the
   * Champion in that state rather than expecting the sentence unconditionally.
   */
  test('Settings / Privacy still works, and its note quotes “Anonymous member”', async ({ page }) => {
    test.setTimeout(240_000);
    const champ = await person('champ', 'Ada Champion');
    const groupId = `w7dd-${stampId()}`;
    await communityDoc(groupId, 'Maple Street Movers', champ.uid);
    await membership(groupId, champ.uid, 'foundingChampion', {
      name: 'private',
      activity: 'visible',
    });
    await signInVia(page, champ.email, champ.password);

    await page.goto('/you');
    await expectHittable(page.getByTestId('wsf-you-settings'), 'the You settings row');
    await page.getByTestId('wsf-you-settings').click();
    await page.waitForURL(/\/settings$/, { timeout: 25_000 });
    await expectHittable(page.getByTestId('wsf-settings-privacy-row'), 'the privacy row');
    await page.getByTestId('wsf-settings-privacy-row').click();
    await page.waitForURL(/\/settings\/privacy$/, { timeout: 25_000 });
    await expect(page.getByTestId('wsf-privacy-screen')).toBeVisible({ timeout: 25_000 });
    // Wait for the real screen rather than its loading state: reading the DOM
    // before the communities resolve is the same class of mistake W8 found in
    // its own guard, and it would have been my own here.
    await expect(page.getByTestId('wsf-privacy-loading')).toHaveCount(0, { timeout: 25_000 });

    // The community's own block is on screen, and its controls are real.
    await expect(page.getByTestId(`wsf-privacy-block-${groupId}`)).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId(`wsf-privacy-name-${groupId}`)).toBeVisible();
    await expect(page.getByTestId(`wsf-privacy-activity-${groupId}`)).toBeVisible();

    await expect(
      page.getByTestId(`wsf-privacy-note-${groupId}`),
      'the privacy note no longer quotes the words the feed actually uses',
    ).toContainText('Anonymous member', { timeout: 20_000 });
  });
});
