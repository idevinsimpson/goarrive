import { randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

/**
 * The goal-creation form itself (app/goals/new.tsx), in a real browser against
 * the isolated emulator suite (project `demo-wsf-local`).
 *
 * e5-community-goal-seam.spec.ts drives the happy path with every default; this
 * spec covers what that leaves out: the duration option rows and their derived
 * lines, the Custom start/end date-time controls, every field-validation
 * message and its timing (nothing before a submit, the first refused field
 * focused on submit), the live "5,000 squats" definition and the summary card,
 * the time-zone line in words and the Change rows, the no-community state, and
 * — by reading the created document back from Firestore — that the callable
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
const START_ERROR = 'Choose when the goal starts.';
const END_ERROR = 'Choose when the goal ends.';
const ORDER_ERROR = 'The end must be after the start.';
// The value a datetime-local control holds: what the page prefills and what
// `fill` must be given.
const CONTROL_VALUE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const REPEAT_ONCE = 'Each member records one contribution toward this goal.';
const REPEAT_MULTIPLE =
  'Each member can record as many contributions as they like while the goal is open.';
// Every inline validation message on the form carries a `wsf-new-goal-*-error` testID.
const ANY_FIELD_ERROR = '[data-testid^="wsf-new-goal-"][data-testid$="-error"]';

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

    // ---- defaults: community by name, 1 week, starts now, zone in words ----
    expect(await page.getByTestId('wsf-new-goal-form').getAttribute('data-group-id')).toBe(groupId);
    // No id is printed anywhere a Champion reads; the community is named.
    await expect(page.getByTestId('wsf-new-goal-form')).not.toContainText(groupId);
    await expect(page.getByTestId('wsf-new-goal-community')).toHaveText('E5 form community');
    await expect(page.getByTestId('wsf-new-goal-duration-1w')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('wsf-new-goal-duration-2w')).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('wsf-new-goal-starts-line')).toHaveText(/^Starts today at /);
    await expect(page.getByTestId('wsf-new-goal-ends-line')).toHaveText(/^Ends /);
    const zoneLine = page.getByTestId('wsf-new-goal-timezone-line');
    await expect(zoneLine).toBeVisible();
    await expect(zoneLine).toHaveText(/^Times are in [A-Za-z][A-Za-z\- ]+$/);
    await expect(zoneLine).not.toContainText('_');
    await expect(zoneLine).not.toContainText('/');
    await expect(page.getByTestId('wsf-new-goal-starts-at')).toHaveCount(0);
    await expect(page.getByTestId('wsf-new-goal-ends-at')).toHaveCount(0);
    // The repeat rows carry their consequences; "once" is the default.
    await expect(page.getByTestId('wsf-new-goal-repeat-once')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('wsf-new-goal-repeat-once-description')).toHaveText(REPEAT_ONCE);
    await expect(page.getByTestId('wsf-new-goal-repeat-multiple-description')).toHaveText(REPEAT_MULTIPLE);
    // The summary above the CTA already names the community and says what is
    // still missing; no validation message shows before a submit attempt.
    const summary = page.getByTestId('wsf-new-goal-summary');
    await expect(summary).toContainText('E5 form community');
    await expect(summary).toContainText('Not named yet');
    await expect(summary).toContainText('One contribution per member');
    await expect(page.locator(ANY_FIELD_ERROR)).toHaveCount(0);

    // ---- empty submit: three messages, the first refused field focused, nothing created ----
    await page.getByTestId('wsf-new-goal-submit').click();
    await expect(page.getByTestId('wsf-new-goal-title-error')).toHaveText(TITLE_ERROR);
    await expect(page.getByTestId('wsf-new-goal-target-error')).toHaveText(TARGET_ERROR);
    await expect(page.getByTestId('wsf-new-goal-unit-error')).toHaveText(UNIT_ERROR);
    await expect(page.getByTestId('wsf-new-goal-title')).toBeFocused();
    await expect(page.getByTestId('wsf-new-goal-created')).toHaveCount(0);

    // ---- target: not a whole number, then zero ----
    for (const bad of ['12.5', '0']) {
      await page.getByTestId('wsf-new-goal-target').fill(bad);
      // Typing clears the message; submitting brings it back, and the focus
      // goes to the first refused field (the still-empty name), not the last.
      await expect(page.getByTestId('wsf-new-goal-target-error')).toHaveCount(0);
      await page.getByTestId('wsf-new-goal-submit').click();
      await expect(page.getByTestId('wsf-new-goal-target-error')).toHaveText(TARGET_ERROR);
      await expect(page.getByTestId('wsf-new-goal-title')).toBeFocused();
    }

    // ---- Custom: two date-time controls; the end prefilled from the preset ----
    await page.getByTestId('wsf-new-goal-duration-custom').click();
    await expect(page.getByTestId('wsf-new-goal-duration-custom')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('wsf-new-goal-starts-at')).toBeVisible();
    await expect(page.getByTestId('wsf-new-goal-ends-at')).toBeVisible();
    await expect(page.getByTestId('wsf-new-goal-starts-at')).toHaveAttribute('type', 'datetime-local');
    await expect(page.getByTestId('wsf-new-goal-ends-at')).toHaveAttribute('type', 'datetime-local');
    await expect(page.getByTestId('wsf-new-goal-starts-at')).toHaveValue(CONTROL_VALUE);
    await expect(page.getByTestId('wsf-new-goal-ends-at')).toHaveValue(CONTROL_VALUE);
    // Nothing tells the Champion how to type a date: the control is the format.
    await expect(page.getByTestId('wsf-new-goal-form')).not.toContainText(/year-month-day/i);

    // End one hour before the start.
    await page.getByTestId('wsf-new-goal-starts-at').fill('2026-10-02T15:00');
    await page.getByTestId('wsf-new-goal-ends-at').fill('2026-10-02T14:00');
    // The review card never reads a refused window back as "what your
    // community will see": the Ends row says the end must be after the start.
    await expect(summary).toContainText('must be after the start');
    await page.getByTestId('wsf-new-goal-submit').click();
    await expect(page.getByTestId('wsf-new-goal-ends-error')).toHaveText(ORDER_ERROR);
    await expect(summary).toContainText('must be after the start');

    // A cleared end: the control cannot hold "next tuesday" or Feb 30, so the
    // one unreadable state left is nothing chosen.
    await page.getByTestId('wsf-new-goal-ends-at').fill('');
    await expect(page.getByTestId('wsf-new-goal-ends-error')).toHaveCount(0);
    await page.getByTestId('wsf-new-goal-submit').click();
    await expect(page.getByTestId('wsf-new-goal-ends-error')).toHaveText(END_ERROR);
    await expect(page.getByTestId('wsf-new-goal-ends-line')).toHaveCount(0);
    // A cleared start.
    await page.getByTestId('wsf-new-goal-starts-at').fill('');
    await page.getByTestId('wsf-new-goal-ends-at').fill('2026-10-09T14:00');
    await page.getByTestId('wsf-new-goal-submit').click();
    await expect(page.getByTestId('wsf-new-goal-starts-error')).toHaveText(START_ERROR);
    // The end is read fine: the end line renders and carries no error.
    await expect(page.getByTestId('wsf-new-goal-ends-line')).toHaveText(/^Ends /);
    await expect(page.getByTestId('wsf-new-goal-ends-error')).toHaveCount(0);

    // ---- back to a preset with the start still cleared ----
    // The preset starts now again; the empty start does not ride along and
    // stop the submit silently.
    await page.getByTestId('wsf-new-goal-duration-1w').click();
    await expect(page.getByTestId('wsf-new-goal-starts-at')).toHaveCount(0);
    await expect(page.getByTestId('wsf-new-goal-starts-error')).toHaveCount(0);
    await expect(page.getByTestId('wsf-new-goal-starts-line')).toHaveText(/^Starts today at /);
    await expect(page.getByTestId('wsf-new-goal-ends-line')).toHaveText(/^Ends /);

    // ---- a valid 2-week goal, read back as one phrase before it is sent ----
    await page.getByTestId('wsf-new-goal-title').fill('E5 form goal, two weeks');
    await page.getByTestId('wsf-new-goal-unit').fill('squats');
    await page.getByTestId('wsf-new-goal-target').fill('12500');
    // Numbers are grouped for reading; the stored value (below) is untouched.
    await expect(page.getByTestId('wsf-new-goal-definition')).toHaveText('12,500 squats');
    await page.getByTestId('wsf-new-goal-target').fill('750');
    await expect(page.getByTestId('wsf-new-goal-definition')).toHaveText('750 squats');
    await page.getByTestId('wsf-new-goal-duration-2w').click();
    await expect(page.getByTestId('wsf-new-goal-duration-2w')).toHaveAttribute('aria-checked', 'true');
    await expect(summary).toContainText('E5 form goal, two weeks');
    await expect(summary).toContainText('750 squats');
    await expect(summary).not.toContainText('Not named yet');
    await expect(summary).not.toContainText('Not set yet');
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
    // The next useful action leads; the phone and big-screen links are there
    // with a purpose each; a natural path back to the community.
    // One control for the contribute page, carrying both its label and its
    // href (it used to be a button plus a second link on the same route).
    await expect(page.getByTestId('wsf-new-goal-goto-contribute')).toHaveText('Open the contribute page');
    await expect(page.getByTestId('wsf-new-goal-goto-contribute')).toHaveAttribute('href', `/contribute/${goalId}`);
    await expect(page.getByTestId('wsf-new-goal-contribute-link')).toHaveCount(0);
    await expect(page.getByTestId('wsf-new-goal-display-link')).toHaveAttribute('href', `/display/${goalId}`);
    // Exactly one control on the screen points at the contribute page.
    expect(await page.locator(`[href="/contribute/${goalId}"]`).count()).toBe(1);
    await expect(page.getByTestId('wsf-new-goal-back')).toHaveAttribute('href', `/community/${groupId}`);

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

  // The whole point of this block: a Champion in a real, non-UTC zone. The
  // screen reads their chosen times in that zone, sends the instants those
  // times mean there, and stores that zone — the three can never disagree,
  // because there is nothing to pick and nothing to convert between.
  test.describe('for a Champion whose device is on Eastern time', () => {
    test.use({ timezoneId: 'America/New_York' });

    test('the words, the submitted instants and the stored zone all agree, with nothing to choose', async ({
      page,
    }) => {
      const { email, password, groupId } = await seedChampionWithCommunity();
      await signInVia(page, email, password);
      await openFormFromCommunity(page, groupId);

      // ---- The zone is a stated fact, not a decision ----
      const browserZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
      expect(browserZone).toBe('America/New_York');
      await expect(page.getByTestId('wsf-new-goal-timezone-line')).toHaveText('Times are in Eastern Time');
      // Nothing to type, nothing to open, nothing to pick: no free-text zone
      // field, no Change control, no zone rows anywhere on the page.
      await expect(page.getByTestId('wsf-new-goal-timezone')).toHaveCount(0);
      await expect(page.getByTestId('wsf-new-goal-timezone-change')).toHaveCount(0);
      await expect(page.getByTestId('wsf-new-goal-timezone-choices')).toHaveCount(0);
      await expect(page.locator('[data-testid^="wsf-new-goal-timezone-option-"]')).toHaveCount(0);
      await expect(page.getByTestId('wsf-new-goal-summary')).toContainText('Eastern Time');
      await expect(page.getByTestId('wsf-new-goal-timezone-error')).toHaveCount(0);

      await page.getByTestId('wsf-new-goal-title').fill('E5 form goal, Eastern');
      await page.getByTestId('wsf-new-goal-target').fill('40');
      await page.getByTestId('wsf-new-goal-unit').fill('miles');
      await expect(page.getByTestId('wsf-new-goal-definition')).toHaveText('40 miles');

      // ---- Custom: a chosen start and end, more than once ----
      await page.getByTestId('wsf-new-goal-duration-custom').click();
      await page.getByTestId('wsf-new-goal-starts-at').fill('2026-10-02T15:00');
      await page.getByTestId('wsf-new-goal-ends-at').fill('2026-10-09T14:00');
      // 3:00 PM and 2:00 PM as the Champion chose them, read back in Eastern
      // words: the end on the page, and both on the review summary (under
      // Custom the start is the control itself, so the page states it there).
      // The separator before PM is a narrow no-break space in some engines.
      await expect(page.getByTestId('wsf-new-goal-ends-line')).toHaveText(
        /^Ends Friday, Oct 9( \d{4})? at 2:00[\s\u202f]?PM$/
      );
      const summary = page.getByTestId('wsf-new-goal-summary');
      await expect(summary).toContainText(/Friday, Oct 2( \d{4})? at 3:00[\s\u202f]?PM/);
      await expect(summary).toContainText(/Friday, Oct 9( \d{4})? at 2:00[\s\u202f]?PM/);
      await page.getByTestId('wsf-new-goal-repeat-multiple').click();
      await expect(page.getByTestId('wsf-new-goal-repeat-multiple')).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByTestId('wsf-new-goal-repeat-once')).toHaveAttribute('aria-checked', 'false');
      await expect(page.getByTestId('wsf-new-goal-repeat-multiple-description')).toHaveText(REPEAT_MULTIPLE);
      await expect(summary).toContainText('Members can contribute again');
      await page.getByTestId('wsf-new-goal-submit').click();
      const created = page.getByTestId('wsf-new-goal-created');
      await expect(created).toBeVisible({ timeout: 20_000 });
      const goalId = (await created.getAttribute('data-goal-id')) ?? '';
      expect(goalId).toMatch(/^\S+$/);

      // The instants are exactly what 3:00 PM and 2:00 PM mean in Eastern —
      // 19:00Z and 18:00Z on those October days — and the stored zone is the
      // same zone the page named in words.
      const expectedStart = await page.evaluate(() => new Date(2026, 9, 2, 15, 0, 0, 0).toISOString());
      const expectedEnd = await page.evaluate(() => new Date(2026, 9, 9, 14, 0, 0, 0).toISOString());
      expect(expectedStart).toBe('2026-10-02T19:00:00.000Z');
      expect(expectedEnd).toBe('2026-10-09T18:00:00.000Z');
      const doc = await firestoreRead(`wsfGoals/${goalId}`);
      expect(new Date(doc.startsAt.timestampValue).toISOString()).toBe(expectedStart);
      expect(new Date(doc.endsAt.timestampValue).toISOString()).toBe(expectedEnd);
      expect(doc.timezone.stringValue).toBe('America/New_York');
      expect(doc.timezone.stringValue).toBe(browserZone);
      expect(doc.repeatPolicy.stringValue).toBe('multiple');
      expect(doc.target.integerValue).toBe('40');
      expect(doc.unit.stringValue).toBe('miles');
    });
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
      'Choose a community before starting a goal.'
    );
    await expect(page.getByTestId('wsf-new-goal-no-community')).toContainText(
      'Open the community the goal is for, then tap Start a goal there.'
    );
    // No field, no id, no submit: the one action is the list of communities.
    await expect(form.locator('input')).toHaveCount(0);
    await expect(page.getByTestId('wsf-new-goal-submit')).toHaveCount(0);
    await expect(page.getByTestId('wsf-new-goal-summary')).toHaveCount(0);
    await expect(form).not.toContainText(/\bID\b/);
    await expect(page.getByTestId('wsf-new-goal-home')).toHaveText('Go to your communities');
    await expect(page.getByTestId('wsf-new-goal-home')).toHaveAttribute('href', '/');
    await page.getByTestId('wsf-new-goal-home').click();
    await expect(page.getByTestId('wsf-home-signed-in')).toBeVisible({ timeout: 20_000 });
  });
});
