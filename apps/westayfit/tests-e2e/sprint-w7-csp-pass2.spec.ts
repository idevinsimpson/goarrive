import { randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { FIRESTORE_EMULATOR, PROJECT_ID, seedProfile, seedShards, seedVerifiedUser, signInVia, stampId } from './helpers/mobile';

/**
 * W7 — CHECK 54: COMMUNITY-SETTINGS-PARITY-1 pass 2, changed dependencies only
 * (Director #434 `5846188045`), exact product `ffb517e5` against control
 * `0e5d6f38`. Measurement rows beside the unchanged H1 / H2 / H5, Check 45 / 43
 * and ui-app-shell runs:
 *
 *   M1  the shared top bar's body height on Home / Community / Progress / You,
 *       and an active-tab reselect is a no-op (same mounted root, no
 *       navigation, no callable).
 *   M2  Settings' drawn × Close: accessible name exactly "Close", a ≥ 44 px
 *       target.
 *   M3  currentFirst: with the remembered community SECOND in the server's
 *       wsfMyCommunities answer, it is shown first in the Community chips and
 *       in the Settings sections, and the server's answer order is unchanged.
 *   M4  roleFact: a founding Champion's Community fact reads "Champion"; the
 *       wider role wording (You / Community Home) is recorded as it stands.
 *   M5  the privacy hint's name is cache-only: the callables and Firestore reads
 *       issued while Settings opens are recorded (compared across builds); the
 *       name appears only when this account already read its profile, and a
 *       cold /settings/privacy shows the generic hint.
 *
 * Emulators only (demo-wsf-local); synthetic accounts; Chromium at 390x844.
 */

const BASE = process.env.WSF_PLAYWRIGHT_BASE_URL;
const LABEL = process.env.W7_LABEL ?? 'head';
test.skip(!BASE, 'Set WSF_PLAYWRIGHT_BASE_URL to the emulator-flagged build under test.');
test.use({ viewport: { width: 390, height: 844 } });

const OWNER = { authorization: 'Bearer owner', 'content-type': 'application/json' };
const docUrl = (p: string) => `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${p}`;
const ts = (d: Date) => ({ timestampValue: d.toISOString() });
const DAY = 864e5;

function measure(label: string, v: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`MEASURE ${label} (${LABEL}): ${JSON.stringify(v)}`);
}
async function write(path: string, fields: Record<string, unknown>): Promise<void> {
  const res = await fetch(docUrl(path), { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields }) });
  if (!res.ok) throw new Error(`write ${path}: ${res.status} ${await res.text()}`);
}

type Person = { uid: string; email: string; password: string; name: string };
async function person(tag: string, name: string): Promise<Person> {
  const email = `wsf-w7c54-${tag}-${stampId()}@example.com`;
  const password = `Aa1!${randomBytes(6).toString('hex')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, name);
  return { uid, email, password, name };
}
async function community(groupId: string, name: string, champ: string, members: string[]): Promise<void> {
  const now = new Date();
  await write(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: name }, groupType: { stringValue: 'custom' }, joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: `JOIN${randomBytes(4).toString('hex')}` }, createdByUserId: { stringValue: champ },
    lifecycleStatus: { stringValue: 'active' }, isSample: { booleanValue: false }, createdAt: ts(now), updatedAt: ts(now),
  });
  for (const [uid, role] of [[champ, 'foundingChampion'], ...members.map((m) => [m, 'member'])] as const) {
    await write(`wsfMemberships/${groupId}_${uid}`, {
      groupId: { stringValue: groupId }, userId: { stringValue: uid }, role: { stringValue: role },
      membershipStatus: { stringValue: 'active' }, createdAt: ts(now), updatedAt: ts(now),
    });
  }
  const goalId = `${groupId}-g`;
  await write(`wsfGoals/${goalId}`, {
    ownerUid: { stringValue: champ }, communityGroupId: { stringValue: groupId }, title: { stringValue: `${name} Squats` },
    target: { integerValue: '500' }, unit: { stringValue: 'squats' }, status: { stringValue: 'active' },
    startsAt: ts(new Date(Date.now() - 5 * DAY)), endsAt: ts(new Date(Date.now() + 5 * DAY)), timezone: { stringValue: 'America/New_York' },
    createdAt: ts(now), updatedAt: ts(now),
  });
  await seedShards(goalId, 120);
}

async function fixture(tag: string) {
  const s = stampId();
  const k = s.slice(-4);
  const m = await person(`${tag}m`, `Mara Pass ${k}`);
  const o = await person(`${tag}o`, `Olu Founder ${k}`);
  const c1 = { id: `w7c54a-${s}${tag}`, name: `W7 Alder Movers ${k}` };
  const c2 = { id: `w7c54b-${s}${tag}`, name: `W7 Birch Walkers ${k}` };
  await community(c1.id, c1.name, o.uid, [m.uid]);
  await community(c2.id, c2.name, o.uid, [m.uid]);
  return { m, o, c1, c2 };
}
const remember = (page: Page, uid: string, groupId: string) =>
  page.evaluate(([u, g]) => localStorage.setItem(`wsf.currentCommunity.${u}`, g), [uid, groupId] as const);
const shown = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).first();
const TAB_ROOT: Record<string, string> = { home: 'wsf-community', community: 'wsf-community-index', activity: 'wsf-activity', you: 'wsf-you' };
/** Index in the visible text of each name, in the given container (−1 when absent). */
async function order(page: Page, rootSel: string, names: string[]) {
  const t = await page.locator(rootSel).first().innerText({ timeout: 5_000 }).catch(() => '');
  return names.map((n) => t.indexOf(n));
}

test.describe(`W7 Check 54 · CSP pass 2 (${LABEL})`, () => {
  test('M1 top bar body height on four tabs; M2 × Close; active-tab reselect is a no-op', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await fixture('m1');
    await page.goto('/');
    await remember(page, fx.m.uid, fx.c1.id);
    await signInVia(page, fx.m.email, fx.m.password);
    await expect(shown(page, 'wsf-community')).toBeVisible({ timeout: 40_000 });
    const heights: Record<string, number | null> = {};
    for (const k of ['home', 'community', 'activity', 'you']) {
      await shown(page, `wsf-member-tab-${k}`).click({ timeout: 10_000 });
      await expect(shown(page, TAB_ROOT[k]!)).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(800);
      heights[k] = await page.evaluate(() => {
        const el = Array.from(document.querySelectorAll('[data-testid="wsf-member-topbar"]')).find((e) => e.getBoundingClientRect().height > 0);
        return el ? Math.round(el.getBoundingClientRect().height) : null;
      });
    }
    // Reselect the active tab (You): the same mounted root, no navigation, no callable.
    const calls: string[] = [];
    page.on('request', (r) => { if (new URL(r.url()).port === '5001') calls.push(r.url()); });
    const before = await page.evaluate(() => { const el = document.querySelector('[data-testid="wsf-you"]') as HTMLElement & { __w7?: number }; if (el) el.__w7 = 1; return { url: location.pathname, history: history.length }; });
    await shown(page, 'wsf-member-tab-you').click({ timeout: 10_000 });
    await page.waitForTimeout(1_500);
    const after = await page.evaluate(() => ({ url: location.pathname, history: history.length, sameRoot: (document.querySelector('[data-testid="wsf-you"]') as (HTMLElement & { __w7?: number }) | null)?.__w7 === 1 }));
    // × Close.
    await shown(page, 'wsf-you-settings').click({ timeout: 10_000 });
    await page.waitForTimeout(900);
    const close = page.locator('[data-testid="wsf-settings-panel"]:visible').getByRole('button', { name: 'Close', exact: true }).first();
    const closeBox = (await close.count()) ? await close.boundingBox() : null;
    const closeText = (await shown(page, 'wsf-settings-close').innerText({ timeout: 3_000 }).catch(() => '')).replace(/\s+/g, ' ').trim();
    measure('M1 top bar + reselect + close', { heights, reselect: { before, after, callables: calls.length }, close: { found: !!closeBox, w: closeBox && Math.round(closeBox.width), h: closeBox && Math.round(closeBox.height), text: closeText } });
  });

  test('M3 currentFirst: the remembered community (second in the server answer) leads chips and Settings; the answer order is unchanged', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await fixture('m3');
    const answers: string[][] = [];
    page.on('response', async (res) => {
      if (!res.url().endsWith('/wsfMyCommunities')) return;
      const j = (await res.json().catch(() => null)) as { result?: { items?: Array<{ groupId: string }> } } | null;
      if (j?.result?.items) answers.push(j.result.items.map((i) => i.groupId));
    });
    await page.goto('/');
    await signInVia(page, fx.m.email, fx.m.password);
    await page.waitForTimeout(3_000);
    const serverOrder = answers[0] ?? [];
    const second = serverOrder[1] ?? fx.c2.id;
    const secondName = second === fx.c1.id ? fx.c1.name : fx.c2.name;
    const firstName = second === fx.c1.id ? fx.c2.name : fx.c1.name;
    await remember(page, fx.m.uid, second);
    await page.goto('/community');
    await expect(shown(page, 'wsf-community-index')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(2_500);
    const chipOrder = await page.evaluate(([a, b]) => {
      const root = Array.from(document.querySelectorAll('[data-testid="wsf-community-index"]')).find((e) => e.getBoundingClientRect().height > 0) as HTMLElement | undefined;
      const t = root?.innerText ?? '';
      const i = t.search(/YOUR COMMUNITIES/i);
      const tail = i >= 0 ? t.slice(i) : t;
      return [tail.indexOf(a!), tail.indexOf(b!)];
    }, [secondName, firstName]);
    await page.goto('/you');
    await expect(shown(page, 'wsf-you')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(1_500);
    await shown(page, 'wsf-you-settings').click({ timeout: 10_000 });
    await page.waitForTimeout(1_500);
    const settingsOrder = await order(page, '[data-testid="wsf-settings-panel"]', [secondName, firstName]);
    measure('M3 currentFirst', { serverOrder: serverOrder.map((g) => (g === fx.c1.id ? 'C1' : g === fx.c2.id ? 'C2' : g)), allAnswers: answers.map((a) => a.map((g) => (g === fx.c1.id ? 'C1' : 'C2'))), remembered: second === fx.c1.id ? 'C1' : 'C2', chipsIdx: { remembered: chipOrder[0], other: chipOrder[1] }, settingsIdx: { remembered: settingsOrder[0], other: settingsOrder[1] } });
  });

  test('M4 roleFact: a founding Champion reads "Champion" on the Community fact; wider wording recorded', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await fixture('m4');
    await page.goto('/');
    await remember(page, fx.o.uid, fx.c1.id);
    await signInVia(page, fx.o.email, fx.o.password);
    await expect(shown(page, 'wsf-community')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(2_000);
    const home = (await shown(page, 'wsf-community').innerText({ timeout: 5_000 }).catch(() => '')).replace(/\s+/g, ' ');
    await shown(page, 'wsf-member-tab-community').click({ timeout: 10_000 });
    await expect(shown(page, 'wsf-community-index')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2_000);
    const comm = (await shown(page, 'wsf-community-index').innerText({ timeout: 5_000 }).catch(() => '')).replace(/\s+/g, ' ');
    await shown(page, 'wsf-member-tab-you').click({ timeout: 10_000 });
    await expect(shown(page, 'wsf-you')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2_000);
    const you = (await shown(page, 'wsf-you').innerText({ timeout: 5_000 }).catch(() => '')).replace(/\s+/g, ' ');
    const roleNear = (t: string) => { const i = t.search(/YOUR ROLE|ROLE/i); return i < 0 ? null : t.slice(i, i + 40); };
    measure('M4 role wording', {
      communityFact: roleNear(comm), communityHasFounding: /Founding Champion/i.test(comm),
      you: roleNear(you), youHasFounding: /Founding Champion/i.test(you),
      communityHomeHasFounding: /Founding Champion/i.test(home), communityHomeHasChampion: /\bChampion\b/.test(home),
    });
  });

  test('M5 privacy hint name is cache-only: reads while Settings opens; named only when already read; cold /settings/privacy generic', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await fixture('m5');
    await page.goto('/');
    await remember(page, fx.m.uid, fx.c1.id);
    await signInVia(page, fx.m.email, fx.m.password);
    await expect(shown(page, 'wsf-community')).toBeVisible({ timeout: 40_000 });
    await shown(page, 'wsf-member-tab-you').click({ timeout: 10_000 });
    await expect(shown(page, 'wsf-you')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2_000);
    const reqs: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.port === '5001') reqs.push(`callable ${u.pathname.split('/').pop()}`);
      else if (u.port === '8080' && !/Listen\/channel/.test(u.pathname)) reqs.push(`firestore ${r.method()} ${u.pathname.replace(/.*documents\//, '').replace(/\/[^/]*$/, '/…')}`);
      else if (u.port === '8080') reqs.push('listen');
    });
    await shown(page, 'wsf-you-settings').click({ timeout: 10_000 });
    await page.waitForTimeout(2_500);
    const warmHint = (await page.locator(`[data-testid="wsf-privacy-panel-name-${fx.c1.id}-hint"]`).first().innerText({ timeout: 3_000 }).catch(() => '')).trim();
    const openReqs = reqs.slice();
    // Cold: a fresh document straight to /settings/privacy; the profile has not been read in it.
    await page.goto('/settings/privacy');
    await page.waitForTimeout(4_000);
    const coldHint = (await page.locator(`[data-testid="wsf-privacy-panel-name-${fx.c1.id}-hint"]`).first().innerText({ timeout: 5_000 }).catch(() => '')).trim();
    measure('M5 hint', { warmHint, warmNamed: warmHint.includes(fx.m.name), coldHint, coldNamed: coldHint.includes(fx.m.name), openReqs: openReqs.sort() });
  });
});
