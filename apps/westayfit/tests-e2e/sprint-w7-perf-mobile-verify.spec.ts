import { randomBytes } from 'node:crypto';

import { expect, test, type Page, type Route } from '@playwright/test';

import { FIRESTORE_EMULATOR, PROJECT_ID, seedProfile, seedShards, seedVerifiedUser, signInVia, stampId } from './helpers/mobile';

/**
 * W7 — PERF-MOBILE-1 TRUTH ROWS (prepared on base `0b460ce3` before W9's
 * delivery; Director #489 `5840930960`, `5841004020`, `5841108313`). The
 * timing / callable table stays Check 41B's unchanged harness
 * (`sprint-w7-perf-mobile-baseline.spec.ts`); this file proves what a member
 * read cache must NOT do while it makes things faster:
 *
 *   T1  ACCOUNT ISOLATION: A warms Progress and You, signs out IN THE PAGE,
 *       B signs in in the same document (marker-proved); no frame of B's
 *       session shows A's goal or A's own part.
 *   T2  REFUSAL (measure): after a membership is removed on the server and
 *       the member meets the refusal, what Progress shows for that community.
 *   T3  AFTER A CONFIRMED CONTRIBUTION, Progress and You (both mounted
 *       before it) show the server's own total once reads settle.
 *   T3b THE RACE: an own-credit read issued BEFORE the contribution is
 *       answered AFTER the receipt (INJECTED hold of a real server answer);
 *       once everything settles the screen shows the server's own total,
 *       never the older answer.
 *
 * On `0b460ce3` (no member cache for own reads) T1 is a preservation control
 * and T3 / T3b record the base behaviour. Emulators only; synthetic accounts;
 * Chromium at 390x844.
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
  test.info().annotations.push({ type: 'measure', description: `${label}: ${JSON.stringify(v)}` });
}
async function write(path: string, fields: Record<string, unknown>): Promise<void> {
  const res = await fetch(docUrl(path), { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields }) });
  if (!res.ok) throw new Error(`write ${path}: ${res.status} ${await res.text()}`);
}
async function storedOwn(goalId: string, uid: string): Promise<number | null> {
  const res = await fetch(docUrl(`wsfGoalMemberTotals/${goalId}_${uid}`), { headers: OWNER });
  if (!res.ok) return null;
  const f = ((await res.json()) as { fields?: { total?: { integerValue?: string; doubleValue?: number } } }).fields;
  return f?.total?.integerValue !== undefined ? Number(f.total.integerValue) : f?.total?.doubleValue ?? null;
}

type Fx = { email: string; password: string; uid: string; name: string; groupId: string; community: string; goalId: string; title: string };
/** One member in one community with one open goal (500 squats, shared 180) and an own total of `own`. */
async function member(tag: string, title: string, own: number): Promise<Fx> {
  const s = stampId();
  const email = `wsf-w7perf-${tag}-${s}@example.com`;
  const password = `Aa1!${randomBytes(6).toString('hex')}`;
  const name = `Perf ${tag.toUpperCase()} ${s.slice(-4)}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, name);
  const champ = await seedVerifiedUser(`wsf-w7perf-${tag}c-${s}@example.com`, password);
  await seedProfile(champ, `Champion ${s.slice(-4)}`);
  const groupId = `w7perf-${tag}-${s}`;
  const community = `Perf ${tag.toUpperCase()} Movers ${s.slice(-4)}`;
  const now = new Date();
  await write(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: community }, groupType: { stringValue: 'custom' }, joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: `JOIN${randomBytes(4).toString('hex')}` }, createdByUserId: { stringValue: champ },
    lifecycleStatus: { stringValue: 'active' }, isSample: { booleanValue: false }, createdAt: ts(now), updatedAt: ts(now),
  });
  for (const [u, role] of [[champ, 'foundingChampion'], [uid, 'member']] as const) {
    await write(`wsfMemberships/${groupId}_${u}`, {
      groupId: { stringValue: groupId }, userId: { stringValue: u }, role: { stringValue: role },
      membershipStatus: { stringValue: 'active' }, createdAt: ts(now), updatedAt: ts(now),
    });
  }
  const goalId = `w7perfg-${tag}-${s}`;
  await write(`wsfGoals/${goalId}`, {
    ownerUid: { stringValue: champ }, communityGroupId: { stringValue: groupId }, title: { stringValue: title },
    target: { integerValue: '500' }, unit: { stringValue: 'squats' }, status: { stringValue: 'active' },
    startsAt: ts(new Date(Date.now() - 7 * DAY)), endsAt: ts(new Date(Date.now() + 7 * DAY)), timezone: { stringValue: 'America/New_York' },
    createdAt: ts(now), updatedAt: ts(now),
  });
  await seedShards(goalId, 180);
  if (own > 0) await write(`wsfGoalMemberTotals/${goalId}_${uid}`, { goalId: { stringValue: goalId }, userId: { stringValue: uid }, total: { integerValue: String(own) } });
  return { email, password, uid, name, groupId, community, goalId, title };
}

/** Every frame's visible text is checked against a watch list; hits are recorded with a time. */
function textWatch() {
  const W = { watch: [] as string[], hits: [] as string[] };
  (window as unknown as { __w7t: typeof W }).__w7t = W;
  const tick = () => {
    if (W.watch.length && document.body) {
      const t = document.body.innerText;
      for (const w of W.watch) if (t.includes(w) && !W.hits.includes(w)) W.hits.push(w);
    }
    requestAnimationFrame(tick);
  };
  if (document.documentElement) requestAnimationFrame(tick);
  else addEventListener('DOMContentLoaded', () => requestAnimationFrame(tick));
}
const setWatch = (page: Page, w: string[]) => page.evaluate((x) => { const W = (window as unknown as { __w7t: { watch: string[]; hits: string[] } }).__w7t; W.watch = x; W.hits = []; }, w);
const hits = (page: Page) => page.evaluate(() => (window as unknown as { __w7t: { hits: string[] } }).__w7t.hits.slice());

const shown = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).first();
async function tab(page: Page, key: string) {
  await shown(page, `wsf-member-tab-${key}`).click({ timeout: 10_000 });
  await page.waitForTimeout(2_000);
}
/** The text of the visible route screen for a tab (falls back to the body). */
async function screenText(page: Page, rootId: string): Promise<string> {
  const root = page.locator(`[data-testid="${rootId}"]:visible`).first();
  return ((await root.count()) ? await root.innerText({ timeout: 5_000 }).catch(() => '') : await page.locator('body').innerText()).replace(/\s+/g, ' ');
}
/** MOVE → one-goal sheet → count `n` → confirm → receipt → Close back to the tab underneath. */
async function contribute(page: Page, n: string): Promise<string | null> {
  await shown(page, 'wsf-member-tab-move').click({ timeout: 10_000 });
  await shown(page, 'wsf-contribute-skip-timer').click({ timeout: 30_000 });
  await shown(page, 'wsf-contribute-entry').fill(n);
  await shown(page, 'wsf-contribute-review').click({ timeout: 10_000 });
  await shown(page, 'wsf-contribute-submit').click({ timeout: 20_000 });
  await expect(shown(page, 'wsf-contribute-receipt')).toBeVisible({ timeout: 30_000 });
  const variant = await shown(page, 'wsf-contribute-receipt').getAttribute('data-variant', { timeout: 5_000 });
  const close = page.locator('[data-testid="wsf-contribute-close"]:visible');
  await ((await close.count()) ? close.first() : shown(page, 'wsf-contribute-back')).click({ timeout: 10_000 });
  await page.waitForTimeout(2_500);
  return variant;
}
const ownShown = (t: string, n: number) => new RegExp(`\\b${n}\\s*squats\\b`, 'i').test(t);

test.describe(`W7 PERF-MOBILE-1 truth rows (${LABEL})`, () => {
  test('T1 account isolation: B never sees A’s goal or own part in the same document', async ({ page }) => {
    test.setTimeout(240_000);
    await page.addInitScript(textWatch);
    const a = await member('a', 'Alpha Only Squats', 35);
    const b = await member('b', 'Bravo Only Squats', 7);
    await signInVia(page, a.email, a.password);
    await expect(shown(page, 'wsf-community')).toBeVisible({ timeout: 40_000 });
    await tab(page, 'activity');
    await tab(page, 'you');
    const aSaw = { progress: await screenText(page, 'wsf-activity'), you: await screenText(page, 'wsf-you') };
    await shown(page, 'wsf-member-topbar-menu-button').click({ timeout: 10_000 });
    await shown(page, 'wsf-member-topbar-menu-signout').click({ timeout: 10_000 });
    await page.waitForTimeout(2_000);
    await page.evaluate(() => { (window as unknown as { __w7doc: string }).__w7doc = 'A-document'; });
    await setWatch(page, [a.title, a.community, a.name]);
    await page.evaluate(() => { history.pushState({}, '', '/signin'); dispatchEvent(new PopStateEvent('popstate', { state: {} })); });
    await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('wsf-signin-email').fill(b.email);
    await page.getByTestId('wsf-signin-password').fill(b.password);
    await page.getByTestId('wsf-signin-submit').click();
    await expect(shown(page, 'wsf-community')).toBeVisible({ timeout: 40_000 });
    await tab(page, 'activity');
    const bProgress = await screenText(page, 'wsf-activity');
    await tab(page, 'you');
    const bYou = await screenText(page, 'wsf-you');
    const same = (await page.evaluate(() => (window as unknown as { __w7doc?: string }).__w7doc ?? 'reloaded')) === 'A-document';
    const r = {
      sameDocument: same,
      aWarmed: { progressHadA: aSaw.progress.includes(a.title), youHadA: aSaw.you.includes(a.title) },
      aTextSeenInBSession: await hits(page),
      bProgressShowsOwn: ownShown(bProgress, 7) && bProgress.includes(b.title),
      bYouShowsOwn: ownShown(bYou, 7),
      a35InB: ownShown(bProgress, 35) || ownShown(bYou, 35),
    };
    measure('T1 isolation', r);
    expect(r.sameDocument, 'the isolation proof needs one document').toBe(true);
    expect(r.aWarmed.progressHadA && r.aWarmed.youHadA, 'fixture: A warmed both routes').toBe(true);
    expect.soft(r.aTextSeenInBSession, 'no frame of B’s session shows A').toEqual([]);
    expect.soft(r.a35InB, 'A’s own part never appears for B').toBe(false);
    expect.soft(r.bProgressShowsOwn && r.bYouShowsOwn, 'B sees B’s own part').toBe(true);
  });

  test('T2 refusal (measure): Progress after the member meets a refusal for a community', async ({ page }) => {
    test.setTimeout(200_000);
    const m = await member('r', 'Refused Goal Squats', 9);
    await signInVia(page, m.email, m.password);
    await expect(shown(page, 'wsf-community')).toBeVisible({ timeout: 40_000 });
    await tab(page, 'activity');
    const before = await screenText(page, 'wsf-activity');
    await fetch(docUrl(`wsfMemberships/${m.groupId}_${m.uid}`), { method: 'DELETE', headers: OWNER });
    await tab(page, 'home');
    await page.waitForTimeout(3_000);
    const home = await screenText(page, 'wsf-community');
    await tab(page, 'activity');
    await page.waitForTimeout(2_000);
    const after = await screenText(page, 'wsf-activity');
    measure('T2 refusal', {
      progressBefore: before.includes(m.title), homeAfterRemoval: home.slice(0, 160),
      progressAfterRefusal: { goalStillShown: after.includes(m.title), text: after.slice(0, 200) },
    });
  });

  test('T3 after a confirmed contribution, mounted Progress and You show the server’s own total', async ({ page }) => {
    test.setTimeout(240_000);
    const m = await member('c', 'Charlie Squats', 35);
    await signInVia(page, m.email, m.password);
    await expect(shown(page, 'wsf-community')).toBeVisible({ timeout: 40_000 });
    await tab(page, 'activity');
    await tab(page, 'you');
    const before = { progress35: ownShown(await screenText(page, 'wsf-activity'), 35), you35: ownShown(await screenText(page, 'wsf-you'), 35) };
    await tab(page, 'activity');
    const variant = await contribute(page, '20');
    const server = await storedOwn(m.goalId, m.uid);
    await page.waitForTimeout(3_000);
    const progress = await screenText(page, 'wsf-activity');
    await tab(page, 'you');
    await page.waitForTimeout(2_000);
    const you = await screenText(page, 'wsf-you');
    const r = {
      before, receipt: variant, serverOwn: server,
      progress: { shows55: ownShown(progress, 55), shows35: ownShown(progress, 35) },
      you: { shows55: ownShown(you, 55), shows35: ownShown(you, 35) },
    };
    measure('T3 receipt freshness', r);
    expect(before.progress35 && before.you35 && variant === 'ordinary' && server === 55, 'fixture: 35 shown, a confirmed receipt, server 55').toBe(true);
    expect.soft(r.progress.shows55 && !r.progress.shows35, 'Progress shows the server’s own total after the receipt').toBe(true);
    expect.soft(r.you.shows55 && !r.you.shows35, 'You shows the server’s own total after the receipt').toBe(true);
  });

  test('T3b race: an own-credit answer issued before the receipt and delivered after it never wins', async ({ page }) => {
    test.setTimeout(240_000);
    const m = await member('d', 'Delta Squats', 35);
    const hold = { armed: false, captured: 0, release: null as null | (() => void) };
    await page.route('**/wsfMyContribution', async (route: Route) => {
      if (!hold.armed || !(route.request().postData() ?? '').includes(m.goalId)) return route.continue();
      hold.armed = false;
      const res = await route.fetch(); // the REAL server answer at issue time (35) ...
      hold.captured += 1;
      await new Promise<void>((resolve) => { hold.release = resolve; });
      return route.fulfill({ response: res }); // ... delivered after the receipt (INJECTED delay)
    });
    await signInVia(page, m.email, m.password);
    await expect(shown(page, 'wsf-community')).toBeVisible({ timeout: 40_000 });
    hold.armed = true;
    await shown(page, 'wsf-member-tab-you').click({ timeout: 10_000 }); // You's first own read is issued and held
    await expect.poll(() => hold.captured, { timeout: 20_000 }).toBe(1);
    const variant = await contribute(page, '20');
    const server = await storedOwn(m.goalId, m.uid);
    hold.release?.();
    await page.waitForTimeout(4_000);
    const you = await screenText(page, 'wsf-you');
    await tab(page, 'activity');
    const progress = await screenText(page, 'wsf-activity');
    const r = { heldAnswers: hold.captured, receipt: variant, serverOwn: server, you: { shows55: ownShown(you, 55), shows35: ownShown(you, 35) }, progress: { shows55: ownShown(progress, 55), shows35: ownShown(progress, 35) } };
    measure('T3b race', r);
    expect(variant === 'ordinary' && server === 55, 'fixture: a confirmed receipt, server 55').toBe(true);
    expect.soft(r.you.shows55 && !r.you.shows35, 'You: the older in-flight answer does not win').toBe(true);
    expect.soft(r.progress.shows55 && !r.progress.shows35, 'Progress: the server’s own total').toBe(true);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});
