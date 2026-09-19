import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

/**
 * THE MEMBER JOURNEY, END TO END, AS ONE STORY.
 *
 *   This is my community → this is what we're doing → I add my part →
 *   it is confirmed once → I can see the shared result → the same truth
 *   appears on the authorized shared display.
 *
 * One synthetic community, one goal at 241 of 500, one member adding 20.
 * Every screen is captured at 390 × 844 in sequence, and the same numbers
 * are asserted on Community Home, the confirmed result, Community Home
 * again, and the public display. Fixture data throughout.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'demo-wsf-local';
const ARTIFACTS_DIR = path.resolve(__dirname, 'artifacts', 'ui-journey');
const PHONE = { width: 390, height: 844 };

async function seedVerifiedUser(email: string, password: string): Promise<string> {
  const headers = { authorization: 'Bearer owner', 'content-type': 'application/json' };
  const base = `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1`;
  const signup = await fetch(`${base}/accounts:signUp?key=fake-api-key`, {
    method: 'POST', headers, body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!signup.ok) throw new Error(`emulator signUp failed: ${signup.status}`);
  const { localId } = (await signup.json()) as { localId: string };
  const update = await fetch(`${base}/accounts:update`, {
    method: 'POST', headers, body: JSON.stringify({ localId, emailVerified: true }),
  });
  if (!update.ok) throw new Error(`emulator verify failed: ${update.status}`);
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

function tsField(d: Date): { timestampValue: string } {
  return { timestampValue: d.toISOString() };
}

async function signInVia(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/signin');
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('wsf-signin-email').fill(email);
  await page.getByTestId('wsf-signin-password').fill(password);
  await page.getByTestId('wsf-signin-submit').click();
  await page.waitForURL(/\/(profile-setup)?$/, { timeout: 15_000 });
}

async function snap(page: Page, name: string): Promise<void> {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, `${name}.png`), fullPage: false });
}

test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

test('the member journey, one story, one set of numbers', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const password = 'journey-password';
  const championEmail = `wsf-journey-champ-${stamp}@example.com`;
  const memberEmail = `wsf-journey-member-${stamp}@example.com`;
  const championUid = await seedVerifiedUser(championEmail, password);
  const memberUid = await seedVerifiedUser(memberEmail, password);
  const now = new Date();
  for (const [uid, name] of [[championUid, 'Fixture Champion'], [memberUid, 'Fixture Member']] as const) {
    await firestoreWrite(`wsfMemberProfiles/${uid}`, {
      displayName: { stringValue: name }, createdAt: tsField(now), updatedAt: tsField(now),
    });
  }
  const groupId = `journey-${stamp}`;
  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: 'Maple Street Movers' },
    groupType: { stringValue: 'familyFriends' },
    joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: randomBytes(6).toString('base64url') },
    createdByUserId: { stringValue: championUid },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
    createdAt: tsField(new Date(now.getTime() - 40 * 24 * 60 * 60_000)),
    updatedAt: tsField(now),
  });
  for (const [uid, role] of [[championUid, 'foundingChampion'], [memberUid, 'member']] as const) {
    await firestoreWrite(`wsfMemberships/${groupId}_${uid}`, {
      groupId: { stringValue: groupId }, userId: { stringValue: uid }, role: { stringValue: role },
      membershipStatus: { stringValue: 'active' }, createdAt: tsField(now), updatedAt: tsField(now),
    });
  }
  const goalId = `journey-goal-${stamp}`;
  await firestoreWrite(`wsfGoals/${goalId}`, {
    ownerUid: { stringValue: championUid },
    communityGroupId: { stringValue: groupId },
    title: { stringValue: 'Squats together this week' },
    target: { integerValue: '500' },
    unit: { stringValue: 'squats' },
    status: { stringValue: 'active' },
    startsAt: { timestampValue: '2026-09-15T04:00:00.000Z' },
    endsAt: { timestampValue: '2026-10-06T03:30:00.000Z' },
    timezone: { stringValue: 'America/New_York' },
    aggregateDisplayAuthorized: { booleanValue: true },
    createdAt: tsField(now), updatedAt: tsField(now),
  });
  // 241 across the shards.
  for (let i = 0; i < 10; i += 1) {
    await firestoreWrite(`wsfGoalCounters/${goalId}/shards/${i}`, { count: { integerValue: String(i === 0 ? 25 : 24) } });
  }

  // 1. THIS IS MY COMMUNITY / THIS IS WHAT WE'RE DOING.
  await signInVia(page, memberEmail, password);
  await page.goto(`/community/${groupId}`);
  await expect(page.getByTestId('wsf-community-name')).toHaveText('Maple Street Movers', { timeout: 20_000 });
  await expect(page.getByTestId(`wsf-community-goal-total-${goalId}`)).toHaveText('241 of 500 squats', { timeout: 30_000 });
  await expect(page.getByTestId(`wsf-community-goal-percent-${goalId}`)).toHaveText('48.2% complete');
  await expect(page.getByTestId(`wsf-community-goal-period-${goalId}`)).toHaveText('Open · Ends Mon, Oct 5');
  await snap(page, '01-community-home');

  // 2. I ADD MY PART — Start moving.
  await page.getByTestId(`wsf-community-goal-link-${goalId}`).click();
  await expect(page.getByTestId('wsf-contribute-move-screen')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-community')).toHaveText('Maple Street Movers', { timeout: 20_000 });
  await snap(page, '02-start-moving');

  // 3. Enter.
  await page.getByTestId('wsf-contribute-done').click();
  await page.getByTestId('wsf-contribute-plus-10').click();
  await page.getByTestId('wsf-contribute-plus-10').click();
  await expect(page.getByTestId('wsf-contribute-entry')).toHaveValue('20');
  await snap(page, '03-enter-result');

  // 4. Review.
  await page.getByTestId('wsf-contribute-review').click();
  await expect(page.getByTestId('wsf-contribute-review-quantity')).toHaveText('20 squats');
  await snap(page, '04-review');

  // 5. IT IS CONFIRMED ONCE / I CAN SEE THE SHARED RESULT.
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-result-headline')).toHaveText('You added 20 squats.');
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('261 of 500 squats');
  await expect(page.getByTestId('wsf-contribute-result-standing')).toHaveText('Maple Street Movers is now at 261 of 500 squats.');
  await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText('Your total on this goal: 20 squats');
  await snap(page, '05-confirmed');

  // 6. Back to community: the same truth.
  await page.getByTestId('wsf-contribute-back').click();
  // The stack keeps the earlier Community Home mounted (hidden) beneath the
  // new one, so the assertions read the visible, most recent instance.
  await expect(page.getByTestId('wsf-community-name').last()).toHaveText('Maple Street Movers', { timeout: 20_000 });
  await expect(page.getByTestId(`wsf-community-goal-total-${goalId}`).last()).toHaveText('261 of 500 squats', { timeout: 30_000 });
  await expect(page.getByTestId(`wsf-community-goal-percent-${goalId}`).last()).toHaveText('52.2% complete');
  await expect(page.getByTestId(`wsf-community-your-part-${goalId}`).last()).toContainText('You’ve added 20 squats');
  await snap(page, '06-community-home-after');

  // 7. THE SAME TRUTH ON THE AUTHORIZED SHARED DISPLAY — anonymous browser.
  const anon = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const display = await anon.newPage();
  try {
    await display.goto(`/display/${goalId}`);
    await expect(display.getByTestId('wsf-display-community')).toHaveText('Maple Street Movers', { timeout: 20_000 });
    await expect(display.getByTestId('wsf-display-goal-title')).toHaveText('Squats together this week');
    await expect(display.getByTestId('wsf-display-total-line')).toHaveText('261 of 500 squats');
    await expect(display.getByTestId('wsf-display-percent')).toHaveText('52.2% complete');
    await expect(display.getByTestId('wsf-display-period')).toHaveText('Open · Ends Mon, Oct 5');
    await expect(display.getByTestId('wsf-display-we')).toHaveAttribute('data-fill-ratio', '0.5220');
    const html = await display.content();
    expect(html).not.toContain(memberUid);
    expect(html).not.toContain('Your total');
    await snap(display, '07-public-display-phone');
  } finally {
    await anon.close();
  }
});
