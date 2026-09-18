import { randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

/**
 * The goal-creation form itself (app/goals/new.tsx), in a real browser against
 * the isolated emulator suite (project `demo-wsf-local`).
 *
 * e5-community-goal-seam.spec.ts drives the happy path with every default; this
 * spec covers what that leaves out: the duration presets and their derived
 * lines, the Custom start/end inputs, every field-validation message, the
 * time-zone line in words and the Change panel, the no-community state, and —
 * by reading the created document back from Firestore — that the callable
 * request shape (ISO instants for start and end, the IANA zone, the repeat
 * policy) survived the redesign.
 *
 * LABEL FOR THESE RESULTS: post-admission integration tested with
 * fixture-seeded membership. Nothing here exercises invitations or joining.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'demo-wsf-local';

const TITLE_ERROR = 'Give your goal a name.';
const TARGET_ERROR = 'Enter a whole number greater than zero.';
const UNIT_ERROR = "Say what you're counting, like squats or miles.";
const DATE_ERROR = 'Write the day as year-month-day, then the time, like 2026-09-25 2:00 PM.';
const ORDER_ERROR = 'The end must be after the start.';
const TYPED_VALUE = /^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2} [AP]M$/;

async function seedVerifiedUser(email: string, password: string): Promise<string> {
  const headers = { authorization: 'Bearer owner', 'content-type': 'application/json' };
  const base = `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1`;
  const signup = await fetch(`${base}/accounts:signUp?key=fake-api-key`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!signup.ok) throw new Error(`emulator signUp failed: ${signup.status} ${await signup.text()}`);
  const { localId } = (await signup.json()) as { localId: string };
  const update = await fetch(`${base}/accounts:update`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ localId, emailVerified: true }),
  });
  if (!update.ok) throw new Error(`emulator verify failed: ${update.status} ${await update.text()}`);
  return localId;
}

async function firestoreWrite(docPath: string, fields: Record<string, unknown>): Promise<void> {
  const url = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`emulator write ${docPath} failed: ${res.status} ${await res.text()}`);
}

async function firestoreRead(docPath: string): Promise<Record<string, any>> {
  const url = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}`;
  const res = await fetch(url, { headers: { authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`emulator read ${docPath} failed: ${res.status}`);
  const fields = ((await res.json()) as { fields?: Record<string, any> }).fields;
  if (!fields) throw new Error(`emulator read ${docPath}: no fields`);
  return fields;
}

function tsField(d: Date): { timestampValue: string } {
  return { timestampValue: d.toISOString() };
}

/** One community with a founding Champion and an ordinary member, no goal. */
async function seedCommunity(championUid: string, memberUid: string): Promise<string> {
  const now = new Date();
  const groupId = `e5form-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: 'E5 form community' },
    groupType: { stringValue: 'custom' },
    joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: randomBytes(6).toString('base64url') },
    createdByUserId: { stringValue: championUid },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });
  const roles: [string, string][] = [
    [championUid, 'foundingChampion'],
    [memberUid, 'member'],
  ];
  for (const [uid, role] of roles) {
    await firestoreWrite(`wsfMemberships/${groupId}_${uid}`, {
      groupId: { stringValue: groupId },
      userId: { stringValue: uid },
      role: { stringValue: role },
      membershipStatus: { stringValue: 'active' },
      createdAt: tsField(now),
      updatedAt: tsField(now),
    });
    await firestoreWrite(`wsfMemberProfiles/${uid}`, {
      displayName: { stringValue: `E5 form ${role}` },
      createdAt: tsField(now),
      updatedAt: tsField(now),
    });
  }
  return groupId;
}

async function seedChampionWithCommunity(): Promise<{
  email: string;
  password: string;
  groupId: string;
}> {
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const password = `Aa1!${randomBytes(6).toString('hex')}`;
  const email = `e5form-champ-${stamp}@example.com`;
  const championUid = await seedVerifiedUser(email, password);
  const memberUid = await seedVerifiedUser(`e5form-member-${stamp}@example.com`, password);
  const groupId = await seedCommunity(championUid, memberUid);
  return { email, password, groupId };
}

async function signInVia(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/signin');
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('wsf-signin-email').fill(email);
  await page.getByTestId('wsf-signin-password').fill(password);
  await page.getByTestId('wsf-signin-submit').click();
  await page.waitForURL(/\/(profile-setup)?$/, { timeout: 15_000 });
}

/** The real way in: the community page's own Start a goal control. */
async function openFormFromCommunity(page: Page, groupId: string): Promise<void> {
  await page.goto(`/community/${groupId}`);
  await expect(page.getByTestId('wsf-community-no-goal')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-community-start-goal').click();
  await page.waitForURL(/\/goals\/new/, { timeout: 20_000 });
  await expect(page.getByTestId('wsf-new-goal-form')).toBeVisible({ timeout: 20_000 });
}

test.describe('goal creation form', () => {
  test('defaults, every validation message, Custom dates, and the stored 2-week goal', async ({
    page,
  }) => {
    const { email, password, groupId } = await seedChampionWithCommunity();
    await signInVia(page, email, password);
    await openFormFromCommunity(page, groupId);

    // ---- defaults: community implicit, 1 week, starts now, zone in words ----
    expect(await page.getByTestId('wsf-new-goal-form').getAttribute('data-group-id')).toBe(groupId);
    // No id is printed anywhere a Champion reads.
    await expect(page.getByTestId('wsf-new-goal-form')).not.toContainText(groupId);
    await expect(page.getByTestId('wsf-new-goal-duration-1w')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('wsf-new-goal-duration-2w')).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByTestId('wsf-new-goal-starts-line')).toHaveText(/^Starts today at /);
    await expect(page.getByTestId('wsf-new-goal-ends-line')).toHaveText(/^Ends /);
    const zoneLine = page.getByTestId('wsf-new-goal-timezone-line');
    await expect(zoneLine).toBeVisible();
    await expect(zoneLine).toHaveText(/^Times are in [A-Za-z][A-Za-z\- ]+$/);
    await expect(zoneLine).not.toContainText('_');
    await expect(zoneLine).not.toContainText('/');
    await expect(page.getByTestId('wsf-new-goal-starts-at')).toHaveCount(0);
    await expect(page.getByTestId('wsf-new-goal-ends-at')).toHaveCount(0);

    // ---- empty submit: three messages, nothing created ----
    await page.getByTestId('wsf-new-goal-submit').click();
    await expect(page.getByTestId('wsf-new-goal-title-error')).toHaveText(TITLE_ERROR);
    await expect(page.getByTestId('wsf-new-goal-target-error')).toHaveText(TARGET_ERROR);
    await expect(page.getByTestId('wsf-new-goal-unit-error')).toHaveText(UNIT_ERROR);
    await expect(page.getByTestId('wsf-new-goal-created')).toHaveCount(0);

    // ---- target: not a whole number, then zero ----
    for (const bad of ['12.5', '0']) {
      await page.getByTestId('wsf-new-goal-target').fill(bad);
      // Typing clears the message; submitting brings it back.
      await expect(page.getByTestId('wsf-new-goal-target-error')).toHaveCount(0);
      await page.getByTestId('wsf-new-goal-submit').click();
      await expect(page.getByTestId('wsf-new-goal-target-error')).toHaveText(TARGET_ERROR);
    }

    // ---- Custom: both ends typed; the end prefilled from the preset ----
    await page.getByTestId('wsf-new-goal-duration-custom').click();
    await expect(page.getByTestId('wsf-new-goal-duration-custom')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('wsf-new-goal-starts-at')).toBeVisible();
    await expect(page.getByTestId('wsf-new-goal-ends-at')).toBeVisible();
    await expect(page.getByTestId('wsf-new-goal-starts-at')).toHaveValue(TYPED_VALUE);
    await expect(page.getByTestId('wsf-new-goal-ends-at')).toHaveValue(TYPED_VALUE);

    // End one hour before the start.
    await page.getByTestId('wsf-new-goal-starts-at').fill('2026-10-02 3:00 PM');
    await page.getByTestId('wsf-new-goal-ends-at').fill('2026-10-02 2:00 PM');
    await page.getByTestId('wsf-new-goal-submit').click();
    await expect(page.getByTestId('wsf-new-goal-ends-error')).toHaveText(ORDER_ERROR);

    // Unreadable end, then a calendar day that does not exist, then 13 PM.
    for (const bad of ['next tuesday', '2026-02-30 10:00', '2026-10-09 13:00 PM']) {
      await page.getByTestId('wsf-new-goal-ends-at').fill(bad);
      await page.getByTestId('wsf-new-goal-submit').click();
      await expect(page.getByTestId('wsf-new-goal-ends-error')).toHaveText(DATE_ERROR);
      await expect(page.getByTestId('wsf-new-goal-ends-line')).toHaveCount(0);
    }
    // Unreadable start.
    await page.getByTestId('wsf-new-goal-starts-at').fill('friday');
    await page.getByTestId('wsf-new-goal-ends-at').fill('2026-10-09 14:00');
    await page.getByTestId('wsf-new-goal-submit').click();
    await expect(page.getByTestId('wsf-new-goal-starts-error')).toHaveText(DATE_ERROR);
    // The 24-hour form is read fine: the end line renders and carries no error.
    await expect(page.getByTestId('wsf-new-goal-ends-line')).toHaveText(/^Ends /);
    await expect(page.getByTestId('wsf-new-goal-ends-error')).toHaveCount(0);

    // ---- back to a preset with an unreadable start still typed ----
    // The preset starts now again; the bad text does not ride along and stop
    // the submit silently.
    await page.getByTestId('wsf-new-goal-duration-1w').click();
    await expect(page.getByTestId('wsf-new-goal-starts-at')).toHaveCount(0);
    await expect(page.getByTestId('wsf-new-goal-starts-error')).toHaveCount(0);
    await expect(page.getByTestId('wsf-new-goal-starts-line')).toHaveText(/^Starts today at /);
    await expect(page.getByTestId('wsf-new-goal-ends-line')).toHaveText(/^Ends /);

    // ---- a valid 2-week goal ----
    await page.getByTestId('wsf-new-goal-title').fill('E5 form goal, two weeks');
    await page.getByTestId('wsf-new-goal-target').fill('750');
    await page.getByTestId('wsf-new-goal-unit').fill('squats');
    await page.getByTestId('wsf-new-goal-duration-2w').click();
    await expect(page.getByTestId('wsf-new-goal-duration-2w')).toHaveAttribute('aria-selected', 'true');
    const browserZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    await page.getByTestId('wsf-new-goal-submit').click();

    const created = page.getByTestId('wsf-new-goal-created');
    await expect(created).toBeVisible({ timeout: 20_000 });
    const goalId = (await created.getAttribute('data-goal-id')) ?? '';
    expect(goalId, 'the goal id created through the interface').toMatch(/^\S+$/);
    expect(await created.getAttribute('data-group-id')).toBe(groupId);
    await expect(created).toContainText('E5 form goal, two weeks');
    await expect(created).toContainText('750 squats');
    // The confirmation prints neither id.
    await expect(created).not.toContainText(goalId);
    await expect(created).not.toContainText(groupId);
    // A natural path back to the community.
    await expect(page.getByTestId('wsf-new-goal-back').first()).toHaveAttribute(
      'href',
      `/community/${groupId}`
    );

    // ---- the stored document: the request shape the callable received ----
    const doc = await firestoreRead(`wsfGoals/${goalId}`);
    expect(doc.communityGroupId.stringValue).toBe(groupId);
    expect(doc.title.stringValue).toBe('E5 form goal, two weeks');
    expect(doc.target.integerValue).toBe('750');
    expect(doc.unit.stringValue).toBe('squats');
    expect(doc.repeatPolicy.stringValue).toBe('once');
    expect(doc.timezone.stringValue).toBe(browserZone);
    const startsAt = new Date(doc.startsAt.timestampValue);
    const endsAt = new Date(doc.endsAt.timestampValue);
    expect(endsAt.getTime() - startsAt.getTime()).toBe(14 * 24 * 60 * 60 * 1000);
    // "Starts now": on the quarter hour, within the last 15 minutes plus a
    // little test time, never in the future.
    expect(startsAt.getUTCMinutes() % 15).toBe(0);
    expect(startsAt.getUTCSeconds()).toBe(0);
    const ageMs = Date.now() - startsAt.getTime();
    expect(ageMs).toBeGreaterThanOrEqual(0);
    expect(ageMs).toBeLessThan(20 * 60 * 1000);
  });

  test('a chosen time zone and typed Custom times reach the callable as the IANA zone and ISO instants', async ({
    page,
  }) => {
    const { email, password, groupId } = await seedChampionWithCommunity();
    await signInVia(page, email, password);
    await openFormFromCommunity(page, groupId);

    // ---- Change: zones in words; the device's own zone is the selected one ----
    const browserZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    const optionId = (tz: string) => `wsf-new-goal-timezone-option-${tz.replace(/[^A-Za-z0-9]+/g, '-')}`;
    await expect(page.getByTestId('wsf-new-goal-timezone')).toHaveCount(0);
    await page.getByTestId('wsf-new-goal-timezone-change').click();
    await expect(page.getByTestId('wsf-new-goal-timezone-change')).toHaveCount(0);
    await expect(page.getByTestId(optionId(browserZone))).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId(optionId('America/New_York'))).toHaveAttribute('aria-selected', 'false');
    // Every choice reads as words, never as an identifier.
    const optionTexts = await page.locator('[data-testid^="wsf-new-goal-timezone-option-"]').allInnerTexts();
    expect(optionTexts.length).toBeGreaterThanOrEqual(8);
    for (const text of optionTexts) {
      expect(text).toMatch(/^[A-Za-z][A-Za-z\- ]+$/);
    }

    await page.getByTestId(optionId('America/New_York')).click();
    await expect(page.getByTestId(optionId('America/New_York'))).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('wsf-new-goal-timezone-line')).toHaveText('Times are in Eastern Time');
    await expect(page.getByTestId('wsf-new-goal-timezone')).toHaveValue('America/New_York');

    // A zone nobody recognises is refused with a sentence, not a code.
    await page.getByTestId('wsf-new-goal-title').fill('E5 form goal, Eastern');
    await page.getByTestId('wsf-new-goal-target').fill('40');
    await page.getByTestId('wsf-new-goal-unit').fill('miles');
    await page.getByTestId('wsf-new-goal-timezone').fill('Mars/Olympus_Mons');
    await page.getByTestId('wsf-new-goal-submit').click();
    await expect(page.getByTestId('wsf-new-goal-timezone-error')).toContainText(
      "We don't recognise that time zone."
    );
    await expect(page.getByTestId('wsf-new-goal-created')).toHaveCount(0);
    await page.getByTestId('wsf-new-goal-timezone').fill('');
    await page.getByTestId('wsf-new-goal-submit').click();
    await expect(page.getByTestId('wsf-new-goal-timezone-error')).toHaveText('Choose a time zone.');
    await page.getByTestId(optionId('America/New_York')).click();
    await expect(page.getByTestId('wsf-new-goal-timezone-error')).toHaveCount(0);

    // ---- Custom: a 12-hour start and a 24-hour end, more than once ----
    await page.getByTestId('wsf-new-goal-duration-custom').click();
    await page.getByTestId('wsf-new-goal-starts-at').fill('2026-10-02 3:00 PM');
    await page.getByTestId('wsf-new-goal-ends-at').fill('2026-10-09 14:00');
    await expect(page.getByTestId('wsf-new-goal-ends-line')).toHaveText(/^Ends Friday, Oct 9 at /);
    await page.getByTestId('wsf-new-goal-repeat-multiple').click();
    await expect(page.getByTestId('wsf-new-goal-repeat-caption')).toHaveText(
      'Each member can record as many contributions as they like while the goal is open.'
    );
    await page.getByTestId('wsf-new-goal-submit').click();
    const created = page.getByTestId('wsf-new-goal-created');
    await expect(created).toBeVisible({ timeout: 20_000 });
    const goalId = (await created.getAttribute('data-goal-id')) ?? '';
    expect(goalId).toMatch(/^\S+$/);

    // The typed local times, read in the browser's zone, as ISO instants; the
    // chosen zone as its IANA identifier; the repeat policy as chosen.
    const expectedStart = await page.evaluate(() => new Date(2026, 9, 2, 15, 0, 0, 0).toISOString());
    const expectedEnd = await page.evaluate(() => new Date(2026, 9, 9, 14, 0, 0, 0).toISOString());
    const doc = await firestoreRead(`wsfGoals/${goalId}`);
    expect(new Date(doc.startsAt.timestampValue).toISOString()).toBe(expectedStart);
    expect(new Date(doc.endsAt.timestampValue).toISOString()).toBe(expectedEnd);
    expect(doc.timezone.stringValue).toBe('America/New_York');
    expect(doc.repeatPolicy.stringValue).toBe('multiple');
    expect(doc.target.integerValue).toBe('40');
    expect(doc.unit.stringValue).toBe('miles');
  });

  test('opened without a community, the screen points back to the community page and asks for nothing', async ({
    page,
  }) => {
    const { email, password } = await seedChampionWithCommunity();
    await signInVia(page, email, password);
    await page.goto('/goals/new');
    const form = page.getByTestId('wsf-new-goal-form');
    await expect(form).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('wsf-new-goal-no-community')).toBeVisible();
    await expect(page.getByTestId('wsf-new-goal-no-community')).toContainText(
      'Open your community page and tap Start a goal.'
    );
    // No field, no id, no submit: the way forward is the community page or home.
    await expect(form.locator('input')).toHaveCount(0);
    await expect(page.getByTestId('wsf-new-goal-submit')).toHaveCount(0);
    await expect(form).not.toContainText(/\bID\b/);
    await expect(page.getByTestId('wsf-new-goal-home')).toHaveAttribute('href', '/');
    await page.getByTestId('wsf-new-goal-home').click();
    await expect(page.getByTestId('wsf-home-signed-in')).toBeVisible({ timeout: 20_000 });
  });
});
