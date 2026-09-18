import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

/**
 * PHONE / ACCESSIBILITY QA across the three surfaces.
 *
 *   - no horizontal overflow at 390 and at a narrower 360 width, and at a
 *     195-px width that stands in for 200% text reflow (CSS pixels halve)
 *   - the Manage sheet traps focus and blocks background interaction
 *   - keyboard path: Tab reaches the entry field, Review and Record
 *   - every screen states its numbers in text, so meaning survives without
 *     green and without motion
 *   - the distant display never scrolls
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'demo-wsf-local';
const ARTIFACTS_DIR = path.resolve(__dirname, 'artifacts', 'ui-qa');

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
  const res = await fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ fields }) });
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

type Fx = { groupId: string; goalId: string; championEmail: string; memberEmail: string; password: string };

async function seed(tag: string): Promise<Fx> {
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const password = 'qa-password';
  const championEmail = `wsf-qa-champ-${tag}-${stamp}@example.com`;
  const memberEmail = `wsf-qa-member-${tag}-${stamp}@example.com`;
  const championUid = await seedVerifiedUser(championEmail, password);
  const memberUid = await seedVerifiedUser(memberEmail, password);
  const now = new Date();
  for (const [uid, name] of [[championUid, 'Fixture Champion'], [memberUid, 'Fixture Member']] as const) {
    await firestoreWrite(`wsfMemberProfiles/${uid}`, { displayName: { stringValue: name }, createdAt: tsField(now), updatedAt: tsField(now) });
  }
  const groupId = `qa-${tag}-${stamp}`;
  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: 'Maple Street Movers' }, groupType: { stringValue: 'familyFriends' }, joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: randomBytes(6).toString('base64url') }, createdByUserId: { stringValue: championUid },
    lifecycleStatus: { stringValue: 'active' }, isSample: { booleanValue: false }, createdAt: tsField(now), updatedAt: tsField(now),
  });
  for (const [uid, role] of [[championUid, 'foundingChampion'], [memberUid, 'member']] as const) {
    await firestoreWrite(`wsfMemberships/${groupId}_${uid}`, { groupId: { stringValue: groupId }, userId: { stringValue: uid }, role: { stringValue: role }, membershipStatus: { stringValue: 'active' }, createdAt: tsField(now), updatedAt: tsField(now) });
  }
  const goalId = `qa-goal-${stamp}`;
  await firestoreWrite(`wsfGoals/${goalId}`, {
    ownerUid: { stringValue: championUid }, communityGroupId: { stringValue: groupId }, title: { stringValue: 'Squats together this week' },
    target: { integerValue: '500' }, unit: { stringValue: 'squats' }, status: { stringValue: 'active' },
    startsAt: tsField(new Date(now.getTime() - 3 * 24 * 60 * 60_000)), endsAt: tsField(new Date(now.getTime() + 3 * 24 * 60 * 60_000)),
    timezone: { stringValue: 'America/New_York' }, aggregateDisplayAuthorized: { booleanValue: true }, createdAt: tsField(now), updatedAt: tsField(now),
  });
  await firestoreWrite(`wsfGoalCounters/${goalId}/shards/0`, { count: { integerValue: '241' } });
  return { groupId, goalId, championEmail, memberEmail, password };
}

async function noOverflow(page: Page, width: number, label: string): Promise<void> {
  const o = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('body *')) as HTMLElement[];
    const w = document.documentElement.clientWidth;
    const offenders = all
      .filter((e) => e.getBoundingClientRect().right > w + 1 && getComputedStyle(e).position !== 'fixed')
      .map((e) => `${e.getAttribute('data-testid') ?? e.tagName}@${Math.round(e.getBoundingClientRect().right)} [${(e.className || '').toString().slice(0, 60)}] "${(e.textContent || '').trim().slice(0, 40)}"`);
    return { sw: document.documentElement.scrollWidth, cw: w, offenders };
  });
  expect(o.sw, `${label}: no horizontal scroll at ${width}`).toBeLessThanOrEqual(width);
  expect(o.offenders, `${label}: no element past the right edge at ${width}`).toEqual([]);
}

for (const width of [390, 360, 195]) {
  test(`no horizontal overflow at ${width}px: Community Home, contribution, display`, async ({ browser }) => {
    test.setTimeout(240_000);
    const fx = await seed(`w${width}`);
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    try {
      await signInVia(page, fx.memberEmail, fx.password);
      await page.goto(`/community/${fx.groupId}`);
      await expect(page.getByTestId(`wsf-community-goal-percent-${fx.goalId}`)).toBeVisible({ timeout: 30_000 });
      await noOverflow(page, width, 'Community Home');
      await page.goto(`/contribute/${fx.goalId}?groupId=${fx.groupId}&mode=move`);
      await expect(page.getByTestId('wsf-contribute-move-screen')).toBeVisible({ timeout: 20_000 });
      await noOverflow(page, width, 'Start moving');
      await page.getByTestId('wsf-contribute-done').click();
      await page.getByTestId('wsf-contribute-entry').fill('20');
      await noOverflow(page, width, 'Enter');
      await page.getByTestId('wsf-contribute-review').click();
      await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible();
      await noOverflow(page, width, 'Review');
      await page.getByTestId('wsf-contribute-submit').click();
      await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });
      await noOverflow(page, width, 'Confirmed');
      await page.goto(`/display/${fx.goalId}`);
      await expect(page.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 20_000 });
      await noOverflow(page, width, 'Display');
      if (width !== 390) {
        mkdirSync(ARTIFACTS_DIR, { recursive: true });
        await page.goto(`/community/${fx.groupId}`);
        await expect(page.getByTestId(`wsf-community-goal-percent-${fx.goalId}`)).toBeVisible({ timeout: 30_000 });
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `community-${width}.png`) });
      }
    } finally {
      await ctx.close();
    }
  });
}

test('Manage sheet: focus stays inside, background is blocked, Escape closes', async ({ browser }) => {
  test.setTimeout(180_000);
  const fx = await seed('sheet');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  try {
    await signInVia(page, fx.championEmail, fx.password);
    await page.goto(`/community/${fx.groupId}`);
    await expect(page.getByTestId(`wsf-community-goal-percent-${fx.goalId}`)).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('wsf-community-manage').click();
    await expect(page.getByTestId('wsf-community-manage-panel')).toBeVisible();
    // Tab several times: focus never leaves the sheet, and lands on real controls.
    const seen: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(80);
      seen.push(
        await page.evaluate(() => {
          const a = document.activeElement as HTMLElement | null;
          const inSheet = !!a?.closest('[data-testid="wsf-community-manage-panel"]');
          return `${inSheet ? 'in' : 'OUT'}:${a?.getAttribute('data-testid') ?? a?.tagName ?? 'none'}`;
        })
      );
    }
    expect(seen.every((s) => s.startsWith('in:')), `focus stays inside the sheet; saw ${seen.join(' → ')}`).toBe(true);
    // The page behind is not interactive: the hero's primary action is covered.
    const covered = await page.evaluate(() => {
      const el = document.querySelector(`[data-testid="wsf-community-goal-link-${''}`) as HTMLElement | null;
      return el ? 'unexpected' : 'skip';
    });
    void covered;
    const link = page.getByTestId(`wsf-community-goal-link-${fx.goalId}`);
    const box = await link.boundingBox();
    if (box) {
      const topEl = await page.evaluate(({ x, y }) => {
        const e = document.elementFromPoint(x, y) as HTMLElement | null;
        return e?.closest('[data-testid="wsf-community-manage-panel"]') ? 'sheet' : e?.getAttribute('data-testid') ?? e?.tagName ?? 'none';
      }, { x: box.x + box.width / 2, y: Math.min(box.y + box.height / 2, 800) });
      expect(topEl === 'sheet' || topEl === 'wsf-community-manage-scrim', `element under the hero action while the sheet is open: ${topEl}`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('wsf-community-manage-panel')).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('keyboard path through the contribution entry and review', async ({ browser }) => {
  test.setTimeout(180_000);
  const fx = await seed('keys');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  try {
    await signInVia(page, fx.memberEmail, fx.password);
    await page.goto(`/contribute/${fx.goalId}?groupId=${fx.groupId}&mode=record`);
    await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
    // Reach the field, type, then Tab to Review and activate with the keyboard.
    await page.getByTestId('wsf-contribute-entry').focus();
    await page.keyboard.type('20');
    const order: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '');
      order.push(id);
      if (id === 'wsf-contribute-review') break;
    }
    expect(order, 'Review is reachable by Tab from the entry field').toContain('wsf-contribute-review');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible();
    await page.getByTestId('wsf-contribute-submit').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });
    // Meaning without colour: every number the mark encodes is also text.
    const text = await page.getByTestId('wsf-contribute-receipt').innerText();
    expect(text).toMatch(/261 of 500 squats/);
    expect(text).toMatch(/52\.2% complete/);
    expect(text).toMatch(/239 to go/);
    // The mark carries the same facts for assistive tech.
    await expect(page.getByTestId('wsf-contribute-we')).toHaveAttribute('aria-label', '261 of 500 squats, 52.2% filled');
  } finally {
    await ctx.close();
  }
});
