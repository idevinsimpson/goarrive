import { randomBytes } from 'node:crypto';

import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';

/**
 * CHAMPION TOOLS — the failures around the edges of the display permission.
 *
 * e5-display-authorization drives the happy path and the lost response. This
 * file drives what happens to the REPORT of an outcome when the goal list
 * around it moves: every one of these operations reloads the list, and the
 * notice, the retry and the confirmation all used to live inside the card that
 * reload could take away.
 *
 *   D-7   a failed reload must not take the read-back warning with it
 *   D-7b  a successful authorize whose reload fails is still reported
 *   D-5   a revoke on a CLOSED goal is confirmed by the goal's ABSENCE from
 *         wsfListGoals, not reported as "we could not confirm"
 *   D-3   a sample community's authorized goal says that no public display
 *         will show it — because the server refuses every such display read
 *   D-2   an `active` goal whose window has passed does not claim to be open
 *
 * Synthetic throughout: disposable verified users and documents seeded to the
 * emulators under the admin bypass. Helpers are copied rather than imported —
 * a spec file that imports another spec file runs it.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'demo-wsf-local';

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

async function firestoreWrite(
  docPath: string,
  fields: Record<string, unknown>,
  updateMask?: string[]
): Promise<void> {
  const mask = updateMask?.length
    ? '?' + updateMask.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&')
    : '';
  const url =
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}` +
    `/databases/(default)/documents/${docPath}${mask}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    throw new Error(`emulator write ${docPath} failed: ${res.status} ${await res.text()}`);
  }
}

/** The STORED permission, read straight from the emulator — never from the
 *  screen that is itself under test. */
async function readGoalAuthorization(goalId: string): Promise<boolean> {
  const url =
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}` +
    `/databases/(default)/documents/wsfGoals/${goalId}`;
  const res = await fetch(url, { headers: { authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`emulator read failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as {
    fields?: { aggregateDisplayAuthorized?: { booleanValue?: boolean } };
  };
  return body.fields?.aggregateDisplayAuthorized?.booleanValue === true;
}

function tsField(d: Date): { timestampValue: string } {
  return { timestampValue: d.toISOString() };
}

async function seedShards(goalId: string, total: number): Promise<void> {
  const per = Math.floor(total / 10);
  let rest = total - per * 10;
  for (let i = 0; i < 10; i += 1) {
    const count = per + (rest > 0 ? 1 : 0);
    if (rest > 0) rest -= 1;
    if (count === 0) continue;
    await firestoreWrite(`wsfGoalCounters/${goalId}/shards/${i}`, {
      count: { integerValue: String(count) },
    });
  }
}

const GOAL_TITLE = 'Champion torture goal';

type Fixture = {
  groupId: string;
  goalId: string;
  championUid: string;
  memberUid: string;
  championEmail: string;
  memberEmail: string;
  password: string;
};

type FixtureOpts = {
  authorized?: boolean;
  status?: 'active' | 'closed';
  isSample?: boolean;
  /** Offset of the window's end from now. Negative is a window already past. */
  endsInMs?: number;
  total?: number;
};

async function seedFixture(tag: string, opts: FixtureOpts = {}): Promise<Fixture> {
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const password = 'torture-password';
  const championEmail = `wsf-tor-champ-${tag}-${stamp}@example.com`;
  const memberEmail = `wsf-tor-member-${tag}-${stamp}@example.com`;
  const championUid = await seedVerifiedUser(championEmail, password);
  const memberUid = await seedVerifiedUser(memberEmail, password);

  const now = new Date();
  const groupId = `torgrp-${stamp}`;
  const goalId = `torgoal-${stamp}`;
  const endsInMs = opts.endsInMs ?? 60 * 60_000;

  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: 'Champion torture community' },
    groupType: { stringValue: 'custom' },
    joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: randomBytes(6).toString('base64url') },
    createdByUserId: { stringValue: championUid },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: opts.isSample === true },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });

  for (const [uid, role] of [
    [championUid, 'foundingChampion'],
    [memberUid, 'member'],
  ] as const) {
    await firestoreWrite(`wsfMemberships/${groupId}_${uid}`, {
      groupId: { stringValue: groupId },
      userId: { stringValue: uid },
      role: { stringValue: role },
      membershipStatus: { stringValue: 'active' },
      createdAt: tsField(now),
      updatedAt: tsField(now),
    });
    await firestoreWrite(`wsfMemberProfiles/${uid}`, {
      displayName: { stringValue: uid },
      createdAt: tsField(now),
      updatedAt: tsField(now),
    });
  }

  const fields: Record<string, unknown> = {
    ownerUid: { stringValue: championUid },
    communityGroupId: { stringValue: groupId },
    title: { stringValue: GOAL_TITLE },
    target: { integerValue: '500' },
    unit: { stringValue: 'squats' },
    status: { stringValue: opts.status ?? 'active' },
    startsAt: tsField(new Date(now.getTime() + endsInMs - 14 * 24 * 60 * 60_000)),
    endsAt: tsField(new Date(now.getTime() + endsInMs)),
    timezone: { stringValue: 'America/New_York' },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  };
  // Absent, not false, when it is off: an existing goal carries no such field.
  if (opts.authorized) fields.aggregateDisplayAuthorized = { booleanValue: true };
  await firestoreWrite(`wsfGoals/${goalId}`, fields);
  if (opts.total) await seedShards(goalId, opts.total);

  return { groupId, goalId, championUid, memberUid, championEmail, memberEmail, password };
}

async function signInVia(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/signin');
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('wsf-signin-email').fill(email);
  await page.getByTestId('wsf-signin-password').fill(password);
  await page.getByTestId('wsf-signin-submit').click();
  await page.waitForURL(/\/(profile-setup)?$/, { timeout: 15_000 });
}

async function openManage(page: Page): Promise<void> {
  const manage = page.getByTestId('wsf-community-manage');
  await expect(manage).toBeVisible({ timeout: 20_000 });
  await manage.click();
  await expect(page.getByTestId('wsf-community-manage-panel')).toBeVisible({ timeout: 20_000 });
}

const RELOAD_FAILED_COPY = 'Goals could not be loaded, so there is nothing to manage yet.';

// ─────────────────────────────────────────────────────────────────────────────

test('D-7: a failed goals reload must not take the read-back warning with it', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const fx = await seedFixture('d7', { authorized: true });

  const ctx: BrowserContext = await browser.newContext();
  const champion = await ctx.newPage();
  await signInVia(champion, fx.championEmail, fx.password);
  await champion.goto(`/community/${fx.groupId}`);
  await openManage(champion);

  const stateText = champion.getByTestId(`wsf-goal-display-auth-state-${fx.goalId}`);
  await expect(stateText).toContainText('Public display is authorized for this goal.', {
    timeout: 20_000,
  });

  // The write is lost; the read-back SUCCEEDS and says the permission is still
  // on, so the outcome is the known one — "that change did not take effect".
  // The reload that outcome triggers then fails, which is the whole point: the
  // warning must not leave with the card.
  let blockWrite = true;
  await champion.route('**/wsfSetGoalDisplayAuthorization', async (route: Route) => {
    if (blockWrite) return route.abort('failed');
    return route.continue();
  });
  let armed = false;
  let listCalls = 0;
  await champion.route('**/wsfListGoals', async (route: Route) => {
    if (!armed) return route.continue();
    listCalls += 1;
    // 1 = the read-back, which settles the outcome. 2 = the reload the settled
    // outcome triggers, which is the one that takes the card away.
    if (listCalls === 1) return route.continue();
    return route.abort('failed');
  });

  armed = true;
  await champion.getByTestId(`wsf-goal-display-auth-toggle-${fx.goalId}`).click();

  // The reload really did fail, and the sheet says so...
  await expect(champion.getByText(RELOAD_FAILED_COPY)).toBeVisible({ timeout: 30_000 });
  // ...and the outcome of the Champion's action is STILL on screen, in the
  // same words and with its Dismiss, next to the failure that removed its card.
  await expect(champion.getByTestId(`wsf-goal-display-auth-unsettled-${fx.goalId}`)).toHaveText(
    'That change did not take effect. Public display is still authorized for this goal.'
  );
  await expect(champion.getByTestId(`wsf-goal-display-auth-dismiss-${fx.goalId}`)).toBeVisible();
  await expect(champion.getByText(RELOAD_FAILED_COPY)).toBeVisible();
  expect(listCalls, 'the read-back and the reload are two separate calls').toBeGreaterThanOrEqual(2);
  // The card itself is gone — this is the orphaned report, not the card.
  await expect(stateText).toHaveCount(0);
  // And the permission really is unchanged, so the warning is also true.
  expect(await readGoalAuthorization(fx.goalId)).toBe(true);

  // ---- the retry is reachable from the orphaned notice ---------------------
  blockWrite = false;
  armed = false;
  const retry = champion.getByTestId(`wsf-goal-display-auth-toggle-${fx.goalId}`);
  // Labelled with the value that was ASKED FOR — off — not the inverse of a
  // card that is not even rendered.
  await expect(retry).toHaveText('Try again: remove public display');
  await retry.click();
  await expect(stateText).toHaveText('Public display is not authorized for this goal.', {
    timeout: 30_000,
  });
  expect(await readGoalAuthorization(fx.goalId)).toBe(false);

  await ctx.close();
});

test('D-7b: a successful authorize whose reload fails is still reported', async ({ browser }) => {
  test.setTimeout(180_000);
  const fx = await seedFixture('d7b');

  const ctx: BrowserContext = await browser.newContext();
  const champion = await ctx.newPage();
  await signInVia(champion, fx.championEmail, fx.password);
  await champion.goto(`/community/${fx.groupId}`);
  await openManage(champion);

  const stateText = champion.getByTestId(`wsf-goal-display-auth-state-${fx.goalId}`);
  await expect(stateText).toHaveText('Public display is not authorized for this goal.', {
    timeout: 20_000,
  });

  // The write goes through untouched. Only the reload it triggers fails.
  let armed = false;
  await champion.route('**/wsfListGoals', async (route: Route) => {
    if (!armed) return route.continue();
    return route.abort('failed');
  });

  armed = true;
  await champion.getByTestId(`wsf-goal-display-auth-toggle-${fx.goalId}`).click();

  await expect(champion.getByText(RELOAD_FAILED_COPY)).toBeVisible({ timeout: 30_000 });
  // A public display has just been switched on. Losing the list is no reason
  // to leave that unsaid.
  await expect(
    champion.getByTestId(`wsf-goal-display-auth-confirmed-orphan-${fx.goalId}`)
  ).toHaveText(`Public display is now authorized for “${GOAL_TITLE}”.`);
  // It says only what was established: nothing about the goal having closed
  // or no longer being listed, which is not what happened here.
  await expect(
    champion.getByTestId(`wsf-goal-display-auth-confirmed-orphan-${fx.goalId}`)
  ).not.toContainText('no longer listed');
  expect(await readGoalAuthorization(fx.goalId)).toBe(true);

  await ctx.close();
});

test('DEFECT 5: a revoke on a closed goal is confirmed by its absence, not reported as unknown', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  // Closed AND authorized: the authorization is the only thing keeping this
  // goal in wsfListGoals, so a successful revoke removes it from the list.
  const fx = await seedFixture('d5', { authorized: true, status: 'closed', endsInMs: -60 * 60_000 });

  const ctx: BrowserContext = await browser.newContext();
  const champion = await ctx.newPage();
  await signInVia(champion, fx.championEmail, fx.password);
  await champion.goto(`/community/${fx.groupId}`);
  await openManage(champion);

  const toggle = champion.getByTestId(`wsf-goal-display-auth-toggle-${fx.goalId}`);
  await expect(champion.getByTestId(`wsf-goal-display-auth-state-${fx.goalId}`)).toContainText(
    'Public display is authorized for this goal.',
    { timeout: 20_000 }
  );

  // The request really reaches the server — the revoke SUCCEEDS — and only the
  // answer is lost. The read-back is left alone.
  await champion.route('**/wsfSetGoalDisplayAuthorization', async (route: Route) => {
    await route.fetch().catch(() => undefined);
    await route.abort('failed');
  });

  await toggle.click();

  // The goal is absent from wsfListGoals because the revoke worked. That is
  // the confirmation, not a failed read.
  await expect(champion.getByTestId('wsf-goal-display-auth-confirmed-absent')).toContainText(
    'Public display has been removed',
    { timeout: 30_000 }
  );
  await expect(
    champion.getByTestId(`wsf-goal-display-auth-unsettled-${fx.goalId}`)
  ).toHaveCount(0);
  await expect(champion.getByText('could not confirm')).toHaveCount(0);
  expect(await readGoalAuthorization(fx.goalId)).toBe(false);

  await ctx.close();
});

test('DEFECT 3: a sample community says no public display will show its authorized goal — and none does', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const fx = await seedFixture('d3', { authorized: true, isSample: true, total: 241 });

  const ctx: BrowserContext = await browser.newContext();
  const champion = await ctx.newPage();
  await signInVia(champion, fx.championEmail, fx.password);
  await champion.goto(`/community/${fx.groupId}`);
  await openManage(champion);

  await expect(champion.getByTestId(`wsf-goal-display-auth-state-${fx.goalId}`)).toContainText(
    'Public display is authorized for this goal.',
    { timeout: 20_000 }
  );
  // The permission is real and the card still describes it truthfully. What
  // the card could not say before is that nothing will ever come of it here.
  await expect(champion.getByTestId(`wsf-goal-display-auth-sample-note-${fx.goalId}`)).toHaveText(
    'This community is sample data, so no public display will show it.'
  );

  // ---- and the server agrees: the display read is refused ------------------
  const displayCtx: BrowserContext = await browser.newContext();
  const display = await displayCtx.newPage();
  // The unknown-goal refusal first, so the sample refusal can be compared with
  // it rather than merely described.
  await display.goto(`/display/no-such-goal-${fx.goalId}`);
  await expect(display.getByTestId('wsf-display-not-available')).toBeVisible({ timeout: 20_000 });
  const unknownText = await display.getByTestId('wsf-display-not-available').innerText();

  await display.goto(`/display/${fx.goalId}`);
  await expect(display.getByTestId('wsf-display-not-available')).toBeVisible({ timeout: 20_000 });
  expect(await display.getByTestId('wsf-display-not-available').innerText()).toBe(unknownText);
  await expect(display.getByTestId('wsf-display-screen')).toHaveCount(0);
  const html = await display.content();
  expect(html).not.toContain('Champion torture community');
  expect(html).not.toContain(GOAL_TITLE);
  // The total, read off what is actually on screen: `241` occurs inside the
  // stylesheet's colour values, so the markup is the wrong place to ask.
  expect(await display.locator('body').innerText()).not.toContain('241');

  await ctx.close();
  await displayCtx.close();
});

test('DEFECT 2: an active goal whose window has passed does not claim to be open on Community Home', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  // Still `active` — nothing closes a goal automatically — with its end two
  // hours behind us.
  const fx = await seedFixture('d2', { endsInMs: -2 * 60 * 60_000, total: 241 });

  const ctx: BrowserContext = await browser.newContext();
  const member = await ctx.newPage();
  await signInVia(member, fx.memberEmail, fx.password);
  await member.goto(`/community/${fx.groupId}`);

  const period = member.getByTestId(`wsf-community-goal-period-${fx.goalId}`);
  await expect(period).toContainText('Ended', { timeout: 20_000 });
  const text = await period.innerText();
  expect(text.startsWith('Open')).toBe(false);
  expect(text).not.toContain('Open ·');
  // The contribution routes are deliberately untouched — the server is the
  // authority on whether a contribution is accepted. Only the label changed.
  await expect(member.getByTestId(`wsf-community-goal-link-${fx.goalId}`)).toBeVisible();

  await ctx.close();
});
