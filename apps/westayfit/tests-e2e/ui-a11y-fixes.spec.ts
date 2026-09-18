import { randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

/**
 * PROOF FOR THE ACCESSIBILITY / RESPONSIVE CORRECTIONS.
 *
 * One test per defect group, each written so that it FAILS on the tree before
 * the fix and passes after it. Nothing here is a style opinion: every
 * assertion is a programmatic fact a screen reader, a thumb or a fixed-size
 * screen depends on.
 *
 *   (a) the Champion tools sheet is a dialog with a name
 *   (b) every surface has exactly one top-level heading
 *   (c) a refused entry announces itself
 *   (d) no interactive target below the owner's 44 px
 *   (e) the entry field's keyboard and its placeholder contrast
 *   (f) the display, which cannot scroll, keeps long confirmed strings on
 *       screen at both layouts
 *   (g) two goals in the sheet do not share one accessible name
 *
 * Fixtures are seeded by direct emulator writes, as in tests-e2e/ui-qa.spec.ts
 * and tests-e2e/ui-display.spec.ts; the helpers are copied rather than shared,
 * so this spec never depends on another spec's file.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'demo-wsf-local';
const PHONE = { width: 390, height: 844 };
const WIDE = { width: 1440, height: 900 };
const MIN_TARGET_PX = 44;

// Longer than anything on an approved fixture, and plausible: a real
// community name, a real goal title, a real unit.
const LONG_COMMUNITY = 'Maple Street Movers and the Greater Riverside Neighbourhood Walking Society Ltd.'; // 80
const LONG_TITLE =
  'Squats, lunges, planks and long evening walks together across the whole of September and all of October 2026 — every day'; // 120
const LONG_UNIT = 'kilometres walked round the neighborhood'; // 40

async function seedVerifiedUser(email: string, password: string): Promise<string> {
  const headers = { authorization: 'Bearer owner', 'content-type': 'application/json' };
  const base = `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1`;
  const signup = await fetch(`${base}/accounts:signUp?key=fake-api-key`, {
    method: 'POST', headers, body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!signup.ok) throw new Error(`emulator signUp failed: ${signup.status}`);
  const { localId } = (await signup.json()) as { localId: string };
  await fetch(`${base}/accounts:update`, { method: 'POST', headers, body: JSON.stringify({ localId, emailVerified: true }) });
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

type GoalSeed = {
  key: string;
  title: string;
  target: number;
  unit: string;
  total: number;
  status?: 'active' | 'closed';
  authorized?: boolean;
};

type Fx = {
  stamp: string;
  groupId: string;
  championUid: string;
  championEmail: string;
  memberEmail: string;
  password: string;
  goals: Record<string, string>;
};

async function seedGoal(fx: Fx, g: GoalSeed): Promise<string> {
  const goalId = `a11y-${g.key}-${fx.stamp}`;
  const now = new Date();
  const closed = g.status === 'closed';
  const fields: Record<string, unknown> = {
    ownerUid: { stringValue: fx.championUid },
    communityGroupId: { stringValue: fx.groupId },
    title: { stringValue: g.title },
    target: { integerValue: String(g.target) },
    unit: { stringValue: g.unit },
    status: { stringValue: closed ? 'closed' : 'active' },
    startsAt: tsField(new Date(now.getTime() - (closed ? 34 : 3) * 24 * 60 * 60_000)),
    endsAt: tsField(new Date(now.getTime() + (closed ? -20 : 3) * 24 * 60 * 60_000)),
    timezone: { stringValue: 'America/New_York' },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  };
  if (g.authorized) fields.aggregateDisplayAuthorized = { booleanValue: true };
  await firestoreWrite(`wsfGoals/${goalId}`, fields);
  if (g.total > 0) await firestoreWrite(`wsfGoalCounters/${goalId}/shards/0`, { count: { integerValue: String(g.total) } });
  fx.goals[g.key] = goalId;
  return goalId;
}

async function seed(tag: string, goals: GoalSeed[]): Promise<Fx> {
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const password = 'a11y-password';
  const championEmail = `wsf-a11y-champ-${tag}-${stamp}@example.com`;
  const memberEmail = `wsf-a11y-member-${tag}-${stamp}@example.com`;
  const championUid = await seedVerifiedUser(championEmail, password);
  const memberUid = await seedVerifiedUser(memberEmail, password);
  const now = new Date();
  for (const [uid, name] of [[championUid, 'Fixture Champion'], [memberUid, 'Fixture Member']] as const) {
    await firestoreWrite(`wsfMemberProfiles/${uid}`, {
      displayName: { stringValue: name }, createdAt: tsField(now), updatedAt: tsField(now),
    });
  }
  const groupId = `a11y-${tag}-${stamp}`;
  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: 'Maple Street Movers' },
    groupType: { stringValue: 'familyFriends' },
    joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: randomBytes(6).toString('base64url') },
    createdByUserId: { stringValue: championUid },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });
  for (const [uid, role] of [[championUid, 'foundingChampion'], [memberUid, 'member']] as const) {
    await firestoreWrite(`wsfMemberships/${groupId}_${uid}`, {
      groupId: { stringValue: groupId }, userId: { stringValue: uid }, role: { stringValue: role },
      membershipStatus: { stringValue: 'active' }, createdAt: tsField(now), updatedAt: tsField(now),
    });
  }
  const fx: Fx = { stamp, groupId, championUid, championEmail, memberEmail, password, goals: {} };
  for (const g of goals) await seedGoal(fx, g);
  return fx;
}

/** A community with one ordinary goal, authorized for public display. */
function ordinaryGoals(): GoalSeed[] {
  return [{ key: 'main', title: 'Squats together this week', target: 500, unit: 'squats', total: 241, authorized: true }];
}

/**
 * Every interactive element whose rendered box is smaller than `min` in
 * either direction. Uses getClientRects so a link broken across two lines is
 * judged on its largest fragment, and skips anything hidden from assistive
 * technology or explicitly not a control.
 */
async function undersizedTargets(page: Page, min: number): Promise<string[]> {
  return page.evaluate((limit) => {
    const nodes = Array.from(
      document.querySelectorAll('a[href], input, button, [role="button"], [role="link"]')
    ) as HTMLElement[];
    const out: string[] = [];
    for (const el of nodes) {
      if (el.closest('[aria-hidden="true"]')) continue;
      const role = el.getAttribute('role');
      if (role === 'none' || role === 'presentation') continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const rects = Array.from(el.getClientRects());
      if (!rects.length) continue;
      const w = Math.max(...rects.map((r) => r.width));
      const h = Math.max(...rects.map((r) => r.height));
      if (w + 0.5 < limit || h + 0.5 < limit) {
        const id = el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.tagName;
        out.push(`${id} ${Math.round(w)}×${Math.round(h)} "${(el.textContent ?? '').trim().slice(0, 32)}"`);
      }
    }
    return out;
  }, min);
}

/**
 * Display testIDs that do not fit inside the display's own canvas.
 *
 * The display never scrolls, so "fits" is not about the document height: the
 * canvas is a flex page with fixed padding, and content that outgrows it
 * spills past that padding — over the wordmark at the top, past the bottom
 * edge, or (on the wide layout, whose body centres its rows) off both ends at
 * once. The padded content box is therefore the frame every element has to
 * stay inside, and the viewport is checked too.
 */
async function nodesOutsideCanvas(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="wsf-display-screen"]') as HTMLElement | null;
    if (!root) return ['wsf-display-screen: not rendered'];
    const cs = getComputedStyle(root);
    const rr = root.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const box = {
      top: Math.max(rr.top + parseFloat(cs.paddingTop), 0),
      bottom: Math.min(rr.bottom - parseFloat(cs.paddingBottom), vh),
      left: Math.max(rr.left + parseFloat(cs.paddingLeft), 0),
      right: Math.min(rr.right - parseFloat(cs.paddingRight), vw),
    };
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('[data-testid^="wsf-display-"]')) as HTMLElement[]) {
      if (el === root) continue;
      if (!el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      const over: string[] = [];
      if (r.top < box.top - 0.5) over.push(`top ${Math.round(r.top)}<${Math.round(box.top)}`);
      if (r.left < box.left - 0.5) over.push(`left ${Math.round(r.left)}<${Math.round(box.left)}`);
      if (r.bottom > box.bottom + 0.5) over.push(`bottom ${Math.round(r.bottom)}>${Math.round(box.bottom)}`);
      if (r.right > box.right + 0.5) over.push(`right ${Math.round(r.right)}>${Math.round(box.right)}`);
      if (over.length) out.push(`${el.getAttribute('data-testid')}: ${over.join(', ')}`);
    }
    return out;
  });
}

// ---- (a) the sheet is a named dialog ---------------------------------------

test('(a) the Champion tools sheet is a dialog with an accessible name', async ({ browser }) => {
  test.setTimeout(180_000);
  const fx = await seed('dialog', ordinaryGoals());
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  try {
    await signInVia(page, fx.championEmail, fx.password);
    await page.goto(`/community/${fx.groupId}`);
    await expect(page.getByTestId('wsf-community-manage')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('wsf-community-manage').click();
    await expect(page.getByTestId('wsf-community-manage-panel')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Champion tools' })).toBeVisible();
  } finally {
    await ctx.close();
  }
});

// ---- (b) one top-level heading per surface ---------------------------------

test('(b) each surface has exactly one level-1 heading', async ({ browser }) => {
  test.setTimeout(240_000);
  const fx = await seed('heads', ordinaryGoals());
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  try {
    await signInVia(page, fx.memberEmail, fx.password);

    await page.goto(`/community/${fx.groupId}`);
    await expect(page.getByTestId('wsf-community-name')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 }), 'Community Home').toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Maple Street Movers');

    await page.goto(`/contribute/${fx.goals.main}?groupId=${fx.groupId}&mode=record`);
    await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1 }), 'contribute: enter').toHaveCount(1);

    await page.goto(`/display/${fx.goals.main}`);
    await expect(page.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1 }), 'display').toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Squats together this week');
  } finally {
    await ctx.close();
  }
});

// ---- (c) the refusal announces itself --------------------------------------

test('(c) a refused entry is an alert', async ({ browser }) => {
  test.setTimeout(180_000);
  const fx = await seed('alert', ordinaryGoals());
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  try {
    await signInVia(page, fx.memberEmail, fx.password);
    await page.goto(`/contribute/${fx.goals.main}?groupId=${fx.groupId}&mode=record`);
    await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('wsf-contribute-review').click();
    await expect(page.getByTestId('wsf-contribute-error')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveText('Enter how many you completed.');
  } finally {
    await ctx.close();
  }
});

// ---- (d) touch targets -----------------------------------------------------

test('(d) no interactive target is under 44 px', async ({ browser }) => {
  test.setTimeout(300_000);
  const fx = await seed('target', ordinaryGoals());
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  try {
    await signInVia(page, fx.championEmail, fx.password);

    await page.goto(`/community/${fx.groupId}`);
    await expect(page.getByTestId(`wsf-community-goal-percent-${fx.goals.main}`)).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('wsf-community-details-toggle').click();
    await expect(page.getByTestId('wsf-community-details')).toBeVisible();
    expect(await undersizedTargets(page, MIN_TARGET_PX), 'Community Home, details expanded').toEqual([]);

    await page.getByTestId('wsf-community-manage').click();
    await expect(page.getByTestId('wsf-community-manage-panel')).toBeVisible();
    expect(await undersizedTargets(page, MIN_TARGET_PX), 'Champion tools sheet open').toEqual([]);
    await page.keyboard.press('Escape');

    await page.goto(`/contribute/${fx.goals.main}?groupId=${fx.groupId}&mode=record`);
    await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
    expect(await undersizedTargets(page, MIN_TARGET_PX), 'contribute: enter').toEqual([]);

    await page.getByTestId('wsf-contribute-entry').fill('12');
    await page.getByTestId('wsf-contribute-review').click();
    await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible();
    expect(await undersizedTargets(page, MIN_TARGET_PX), 'contribute: review').toEqual([]);

    await page.getByTestId('wsf-contribute-submit').click();
    await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });
    expect(await undersizedTargets(page, MIN_TARGET_PX), 'contribute: receipt').toEqual([]);

    await page.goto(`/display/${fx.goals.main}`);
    await expect(page.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 20_000 });
    expect(await undersizedTargets(page, MIN_TARGET_PX), 'display: phone').toEqual([]);
  } finally {
    await ctx.close();
  }
});

// ---- (e) the entry field ---------------------------------------------------

test('(e) the entry field asks for a number and its placeholder is legible', async ({ browser }) => {
  test.setTimeout(180_000);
  const fx = await seed('entry', ordinaryGoals());
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  try {
    await signInVia(page, fx.memberEmail, fx.password);
    await page.goto(`/contribute/${fx.goals.main}?groupId=${fx.groupId}&mode=record`);
    const entry = page.getByTestId('wsf-contribute-entry');
    await expect(entry).toBeVisible({ timeout: 20_000 });
    await expect(entry).toHaveAttribute('inputmode', 'numeric');
    await expect(entry).toHaveAttribute('enterkeyhint', 'done');
    // wsfTheme.colors.textMuted (#5A6B85): 4.97:1 on the cream field, where
    // the previous placeholder was 2.26:1.
    const colour = await entry.evaluate((el) => getComputedStyle(el, '::placeholder').color);
    expect(colour.replace(/\s/g, ''), 'placeholder colour is the muted token').toBe('rgb(90,107,133)');
  } finally {
    await ctx.close();
  }
});

// ---- (f) the display keeps long strings on screen ---------------------------

for (const [layoutName, viewport] of [['wide', WIDE], ['phone', PHONE]] as const) {
  test(`(f) ${layoutName} display holds a long name, title and unit on screen`, async ({ browser }) => {
    test.setTimeout(300_000);
    const fx = await seed('long', [
      { key: 'building', title: LONG_TITLE, target: 500, unit: LONG_UNIT, total: 241, authorized: true },
      { key: 'closedreached', title: LONG_TITLE, target: 500, unit: LONG_UNIT, total: 515, status: 'closed', authorized: true },
    ]);
    // The community name is what the display publishes, so it is the group's
    // own display name that has to be long.
    await firestoreWrite(`wsfCommunityGroups/${fx.groupId}`, { displayName: { stringValue: LONG_COMMUNITY } });
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    try {
      for (const state of ['building', 'closedreached'] as const) {
        await page.goto(`/display/${fx.goals[state]}`);
        await expect(page.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 25_000 });
        await expect(page.getByTestId('wsf-display-goal-title')).toHaveText(LONG_TITLE);
        await expect(page.getByTestId('wsf-display-screen')).toHaveAttribute('data-layout', layoutName);
        await page.waitForTimeout(250);
        expect(await nodesOutsideCanvas(page), `${layoutName}/${state}: everything inside the canvas`).toEqual([]);
        if (layoutName === 'wide') {
          const h = await page.evaluate(() => document.documentElement.scrollHeight);
          expect(h, `${layoutName}/${state}: no vertical scroll`).toBeLessThanOrEqual(WIDE.height);
        }
      }
    } finally {
      await ctx.close();
    }
  });
}

// ---- (g) two goals, two names ----------------------------------------------

test('(g) two goals in the sheet do not share one accessible name', async ({ browser }) => {
  test.setTimeout(180_000);
  const fx = await seed('names', [
    { key: 'squats', title: 'Squats together this week', target: 500, unit: 'squats', total: 241 },
    { key: 'minutes', title: 'Minutes walked in September', target: 5000, unit: 'minutes', total: 900 },
  ]);
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  try {
    await signInVia(page, fx.championEmail, fx.password);
    await page.goto(`/community/${fx.groupId}`);
    await expect(page.getByTestId('wsf-community-manage')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('wsf-community-manage').click();
    await expect(page.getByTestId(`wsf-goal-display-auth-toggle-${fx.goals.squats}`)).toBeVisible();
    await expect(page.getByTestId(`wsf-goal-display-auth-toggle-${fx.goals.minutes}`)).toBeVisible();
    // Both controls read "Authorize public display" on screen, and that is
    // fine: the goal each one belongs to is right above it. What must not
    // happen is two controls answering to the SAME name.
    const bare = await page.getByRole('button', { name: 'Authorize public display', exact: true }).count();
    expect(bare, 'no two controls answer to the same bare name').toBeLessThanOrEqual(1);
    await expect(
      page.getByRole('button', { name: /^Squats together this week: Authorize public display$/ })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /^Minutes walked in September: Authorize public display$/ })
    ).toBeVisible();
    // The visible text is untouched — the existing specs assert on it.
    await expect(page.getByTestId(`wsf-goal-display-auth-toggle-${fx.goals.squats}`)).toHaveText(
      'Authorize public display'
    );
  } finally {
    await ctx.close();
  }
});
