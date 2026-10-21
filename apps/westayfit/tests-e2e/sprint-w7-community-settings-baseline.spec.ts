import { randomBytes } from 'node:crypto';

import { expect, test, type Page, type Route } from '@playwright/test';

import { FIRESTORE_EMULATOR, PROJECT_ID, seedProfile, seedShards, seedVerifiedUser, signInVia, stampId } from './helpers/mobile';

/**
 * W7 — CHECK 45: the Community + Settings ROUTE baseline (Director #434
 * `5841197717`), on exact served `0b460ce3f2f0766406100fef14d9a444c8cad43a`.
 * Re-run unchanged as the Phase B behaviour pass-after once W9's
 * COMMUNITY-SETTINGS-PARITY-1 lands.
 *
 *   [FAIL-BEFORE]  a fact of the ACCEPTED reference — frozen Lovable
 *                  `d4f60624…` `src/demo/screens/community.tsx` (banner, facts,
 *                  chips, This period, history, roster) and `src/demo/ui.tsx`
 *                  `Sheet` + `overlays.tsx` `PrivacySheet` (the Settings panel:
 *                  dialog, Close first, Escape / scrim close, focus trap and
 *                  return; Director #489 `5841078939`). Fails now; must pass
 *                  after the hook.
 *   [PRESERVE]     a canonical truth the current routes keep. Passes now and
 *                  after the hook.
 *
 * ROUTE-LEVEL ONLY: visible text, order on screen, dialog/focus behaviour and
 * the stored/served data. No W9/W4 component name or testID is assumed; the
 * privacy controls are found by their community heading and document order,
 * so the same rows drive today's pages and the future panel. The swallowed
 * save error and Check 43's privacy rows are CARRIED (accepted `8e5d5955`),
 * not re-run. Emulators only (demo-wsf-local); synthetic accounts; Chromium at
 * 390x844, plus the one row that differs at 390x640.
 */

const BASE = process.env.WSF_PLAYWRIGHT_BASE_URL;
const LABEL = process.env.W7_LABEL ?? 'head';
test.skip(!BASE, 'Set WSF_PLAYWRIGHT_BASE_URL to the emulator-flagged build under test.');
test.use({ viewport: { width: 390, height: 844 } });

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FUNCTIONS = 'http://127.0.0.1:5001';
const OWNER = { authorization: 'Bearer owner', 'content-type': 'application/json' };
const docUrl = (p: string) => `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${p}`;
const ts = (d: Date) => ({ timestampValue: d.toISOString() });
const DAY = 864e5;

async function write(path: string, fields: Record<string, unknown>): Promise<void> {
  const res = await fetch(docUrl(path), { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields }) });
  if (!res.ok) throw new Error(`write ${path}: ${res.status} ${await res.text()}`);
}
async function storedName(groupId: string, uid: string): Promise<string | null> {
  const res = await fetch(docUrl(`wsfMemberships/${groupId}_${uid}`), { headers: OWNER });
  if (!res.ok) return null;
  return ((await res.json()) as { fields?: Record<string, { stringValue?: string }> }).fields?.communityNameVisibility?.stringValue ?? null;
}
async function tokenFor(email: string, password: string): Promise<string> {
  const r = await fetch(`${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return ((await r.json()) as { idToken: string }).idToken;
}
async function call(name: string, data: unknown, token: string) {
  const r = await fetch(`${FUNCTIONS}/${PROJECT_ID}/us-central1/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ data }) });
  return ((await r.json()) as { result?: any }).result;
}

type P = { uid: string; email: string; password: string; name: string };
async function person(tag: string, name: string): Promise<P> {
  const email = `wsf-w7c45-${tag}-${stampId()}@example.com`;
  const password = `Aa1!${randomBytes(6).toString('hex')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, name);
  return { uid, email, password, name };
}
async function community(id: string, name: string, champ: string, members: Array<[string, 'member' | 'foundingChampion', Record<string, unknown>?]>) {
  const now = new Date();
  await write(`wsfCommunityGroups/${id}`, {
    displayName: { stringValue: name }, groupType: { stringValue: 'custom' }, joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: `JOIN${randomBytes(4).toString('hex')}` }, createdByUserId: { stringValue: champ },
    lifecycleStatus: { stringValue: 'active' }, isSample: { booleanValue: false }, createdAt: ts(now), updatedAt: ts(now),
  });
  for (const [uid, role, extra] of members) {
    await write(`wsfMemberships/${id}_${uid}`, {
      groupId: { stringValue: id }, userId: { stringValue: uid }, role: { stringValue: role },
      membershipStatus: { stringValue: 'active' }, createdAt: ts(now), updatedAt: ts(now), ...(extra ?? {}),
    });
  }
}
async function goal(id: string, groupId: string, owner: string, title: string, unit: string, target: number, shared: number, open: boolean, endsInDays: number) {
  const now = Date.now();
  const f: Record<string, unknown> = {
    ownerUid: { stringValue: owner }, communityGroupId: { stringValue: groupId }, title: { stringValue: title },
    target: { integerValue: String(target) }, unit: { stringValue: unit }, status: { stringValue: open ? 'active' : 'closed' },
    startsAt: ts(new Date(now - 20 * DAY)), endsAt: ts(new Date(now + endsInDays * DAY)), timezone: { stringValue: 'America/New_York' },
    aggregateDisplayAuthorized: { booleanValue: true }, createdAt: ts(new Date(now - 20 * DAY)), updatedAt: ts(new Date(now)),
  };
  if (!open) f.closedAt = ts(new Date(now + endsInDays * DAY));
  await write(`wsfGoals/${id}`, f);
  if (shared > 0) await seedShards(id, shared);
}

/**
 * M is a member of C1 (current) and C2; O is C1's Champion; Q is in C1 with
 * her NAME PRIVATE. C3 exists without M; M's C4 membership is removed.
 * C1 goals: G1 open (180/500), G2 reached-open (130/120 minutes),
 * R closed-reached (230/200), U closed-unfinished (150/400).
 */
async function fixture(tag: string) {
  const s = stampId();
  const k = s.slice(-4);
  const m = await person(`${tag}m`, `Mara Member ${k}`);
  const o = await person(`${tag}o`, `Olu Champion ${k}`);
  const q = await person(`${tag}q`, `Quinn Private ${k}`);
  const c = (n: string, name: string) => ({ id: `w7c45${n}-${s}${tag}`, name: `${name} ${k}` });
  const c1 = c('c1', 'W7 Harbor Movers'), c2 = c('c2', 'W7 Summit Walkers'), c3 = c('c3', 'W7 Stranger Club'), c4 = c('c4', 'W7 Former Friends');
  await community(c1.id, c1.name, o.uid, [[o.uid, 'foundingChampion'], [m.uid, 'member'], [q.uid, 'member', { communityNameVisibility: { stringValue: 'private' } }]]);
  await community(c2.id, c2.name, o.uid, [[o.uid, 'foundingChampion'], [m.uid, 'member']]);
  await community(c3.id, c3.name, o.uid, [[o.uid, 'foundingChampion']]);
  await community(c4.id, c4.name, o.uid, [[o.uid, 'foundingChampion'], [m.uid, 'member', { membershipStatus: { stringValue: 'removed' } }]]);
  const g = {
    G1: { id: `w7c45G1-${s}${tag}`, title: `Harbor Squat Month ${k}` },
    G2: { id: `w7c45G2-${s}${tag}`, title: `Minutes Together ${k}` },
    R: { id: `w7c45R-${s}${tag}`, title: `Spring Squat Sprint ${k}` },
    U: { id: `w7c45U-${s}${tag}`, title: `Winter Squat Stretch ${k}` },
    C2: { id: `w7c45C2-${s}${tag}`, title: `Summit Steps ${k}` },
  };
  await goal(g.G1.id, c1.id, o.uid, g.G1.title, 'squats', 500, 180, true, 5);
  await goal(g.G2.id, c1.id, o.uid, g.G2.title, 'minutes', 120, 130, true, 9);
  await goal(g.R.id, c1.id, o.uid, g.R.title, 'squats', 200, 230, false, -3);
  await goal(g.U.id, c1.id, o.uid, g.U.title, 'squats', 400, 150, false, -10);
  await goal(g.C2.id, c2.id, o.uid, g.C2.title, 'steps', 1000, 200, true, 6);
  return { m, o, q, c1, c2, c3, c4, g };
}
type Fx = Awaited<ReturnType<typeof fixture>>;

// ── helpers ────────────────────────────────────────────────────────────────

type Row = { kind: 'FAIL-BEFORE' | 'PRESERVE'; id: string; ok: boolean };
function rows() {
  const out: Row[] = [];
  const add = (kind: Row['kind'], id: string, ok: boolean, detail?: unknown) => {
    out.push({ kind, id, ok });
    expect.soft(ok, `[${kind}] ${id}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`).toBe(true);
  };
  return { out, fb: (id: string, ok: boolean, d?: unknown) => add('FAIL-BEFORE', id, ok, d), pv: (id: string, ok: boolean, d?: unknown) => add('PRESERVE', id, ok, d) };
}
function report(label: string, r: Row[]) {
  const s = {
    failBefore: { pass: r.filter((x) => x.kind === 'FAIL-BEFORE' && x.ok).map((x) => x.id), fail: r.filter((x) => x.kind === 'FAIL-BEFORE' && !x.ok).map((x) => x.id) },
    preserve: { pass: r.filter((x) => x.kind === 'PRESERVE' && x.ok).map((x) => x.id), fail: r.filter((x) => x.kind === 'PRESERVE' && !x.ok).map((x) => x.id) },
  };
  // eslint-disable-next-line no-console
  console.log(`MEASURE ${label} (${LABEL}): ${JSON.stringify(s)}`);
}
function note(label: string, v: unknown) {
  // eslint-disable-next-line no-console
  console.log(`MEASURE ${label} (${LABEL}): ${JSON.stringify(v)}`);
}
const remember = (page: Page, uid: string, groupId: string) =>
  page.evaluate(([u, g]) => localStorage.setItem(`wsf.currentCommunity.${u}`, g), [uid, groupId] as const);

async function settle(page: Page, must: string, max = 30_000): Promise<string> {
  const t0 = Date.now();
  let last = '';
  let since = Date.now();
  while (Date.now() - t0 < max) {
    const t = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
    if (t !== last) { last = t; since = Date.now(); }
    if (t.includes(must) && Date.now() - since >= 1_200 && !/Loading/i.test(t)) return t;
    await page.waitForTimeout(150);
  }
  return last;
}
async function cold(page: Page, path: string, must: string) { await page.goto(path); return settle(page, must); }
async function topOf(page: Page, text: string | RegExp): Promise<number | null> {
  const loc = page.getByText(text);
  const n = await loc.count();
  for (let i = 0; i < n; i += 1) {
    const b = await loc.nth(i).boundingBox().catch(() => null);
    if (b && b.height > 0 && b.width > 0) return b.y;
  }
  return null;
}
const has = (t: string, re: RegExp | string) => (typeof re === 'string' ? t.includes(re) : re.test(t));
/** The text between `title` and the next of `others` (the goal's own row, route-level). */
function segment(t: string, title: string, others: string[]): string | null {
  const i = t.indexOf(title);
  if (i < 0) return null;
  const rest = t.slice(i + title.length);
  const ends = others.map((o) => rest.indexOf(o)).filter((x) => x >= 0);
  return rest.slice(0, ends.length ? Math.min(...ends) : 160);
}
const dialog = (page: Page) => page.locator('[role="dialog"]:visible, [aria-modal="true"]:visible').first();
const activeInfo = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    const d = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]')).find((e) => (e as HTMLElement).offsetParent !== null || e.getBoundingClientRect().height > 0);
    return {
      inDialog: !!(d && a && d.contains(a)),
      label: (a?.getAttribute('aria-label') ?? a?.innerText ?? a?.tagName ?? '').trim().slice(0, 40),
    };
  });

/** Open Settings from You's own Settings control; returns whether a dialog opened. */
async function openSettings(page: Page): Promise<boolean> {
  const trigger = page.getByText(/^Settings$/).first();
  await trigger.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => undefined);
  await trigger.click({ timeout: 5_000 });
  await page.waitForTimeout(1_200);
  return (await dialog(page).count()) > 0;
}
/** The name switch for a community: the first switch after that community's heading, in document order. */
async function nameSwitchState(page: Page, communityName: string): Promise<'on' | 'off' | 'absent'> {
  return page.evaluate((cn) => {
    const root = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]')).find((e) => e.getBoundingClientRect().height > 0) ?? document.body;
    const heads = Array.from(root.querySelectorAll('*')).filter((e) => e.childElementCount === 0 && (e as HTMLElement).innerText?.trim() === cn && (e as HTMLElement).offsetParent !== null);
    const h = heads[0];
    if (!h) return 'absent';
    const sw = Array.from(root.querySelectorAll('input[type="checkbox"], [role="switch"]')).find((x) => h.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING) as Element | undefined;
    if (!sw) return 'absent';
    const on = sw instanceof HTMLInputElement ? sw.checked : sw.getAttribute('aria-checked') === 'true';
    return on ? 'on' : 'off';
  }, communityName);
}
async function flipName(page: Page, communityName: string): Promise<boolean> {
  const handle = await page.evaluateHandle((cn) => {
    const root = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]')).find((e) => e.getBoundingClientRect().height > 0) ?? document.body;
    const heads = Array.from(root.querySelectorAll('*')).filter((e) => e.childElementCount === 0 && (e as HTMLElement).innerText?.trim() === cn && (e as HTMLElement).offsetParent !== null);
    const h = heads[0];
    if (!h) return null;
    return Array.from(root.querySelectorAll('input[type="checkbox"], [role="switch"]')).find((x) => h.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING) ?? null;
  }, communityName);
  const el = handle.asElement();
  if (!el) return false;
  await el.click({ force: true, timeout: 5_000 });
  return true;
}
/** Reach the privacy controls from You, through whatever surface exists (panel, or Settings page → Privacy). */
async function reachPrivacy(page: Page, fx: Fx): Promise<void> {
  await openSettings(page);
  if ((await nameSwitchState(page, fx.c1.name)) === 'absent') {
    const row = page.getByText(/^Privacy$/).first();
    if (await row.count()) { await row.click({ timeout: 5_000 }); await page.waitForTimeout(1_500); }
  }
  await expect.poll(() => nameSwitchState(page, fx.c1.name), { timeout: 20_000 }).not.toBe('absent');
}

// ═══════════════════════════════════════════════════════════════════════════
// 45A — COMMUNITY
// ═══════════════════════════════════════════════════════════════════════════

test.describe(`W7 Check 45A · Community route baseline (${LABEL})`, () => {
  test('A1 populated Community tab: hierarchy (fail-before) and truths (preserve)', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await fixture('a1');
    const { fb, pv, out } = rows();
    await signInVia(page, fx.m.email, fx.m.password);
    await remember(page, fx.m.uid, fx.c1.id);
    const t = await cold(page, '/community', fx.c1.name);
    note('A1 Community text', t.replace(/\s+/g, ' ').slice(0, 1000));

    const name = await topOf(page, fx.c1.name);
    const yours = await topOf(page, /^Your communities$/i);
    const title = await topOf(page, /^Community$/);
    fb('C-F1 the community identity banner leads (its name above the switcher and any page title)',
      name !== null && (yours === null || name < yours) && (title === null || name < title), { name, yours, title });
    const mem = await topOf(page, /^Members$/), role = await topOf(page, /^Your role$/i), goals = await topOf(page, /^Goals$/);
    fb('C-F2 facts in order: Members / Your role / Goals', mem !== null && role !== null && goals !== null && mem <= role && role <= goals, { mem, role, goals });
    fb('C-F3 chips for both joined communities plus Join and Start',
      (await page.getByText(/^\s*Join\s*$/).count()) > 0 && (await page.getByText(/^\s*Start\s*$/).count()) > 0 && has(t, fx.c2.name));
    fb('C-F4 "This period" with the current goal', has(t, /this period/i) && (has(t, fx.g.G1.title) || has(t, fx.g.G2.title)));
    fb('C-F5 "Goal history" / "What we’ve done together" with the closed goals', has(t, /goal history/i) && has(t, /what we.ve done together/i) && has(t, fx.g.R.title) && has(t, fx.g.U.title));
    const hist = await topOf(page, /what we.ve done together/i), roster = await topOf(page, /^3 people$/i);
    fb('C-F6 the Members roster ("3 people") comes after history', hist !== null && roster !== null && roster > hist, { hist, roster });
    const period = await topOf(page, /this period/i);
    fb('C-F7 the first 390x844 screen holds the banner, the facts and This period (no utility stack first)',
      name !== null && mem !== null && period !== null && period < 844 && name < period, { name, mem, period });

    pv('C-P1 no invented place / descriptor / sample copy', !/sample member|design prototype|fictional|sample community/i.test(t));
    pv('C-P2 switch offers real memberships only (C1, C2; never C3 or a removed C4)', has(t, fx.c1.name) && has(t, fx.c2.name) && !has(t, fx.c3.name) && !has(t, fx.c4.name));
    pv('C-P3 a name-private member is never named here', !has(t, fx.q.name));
    pv('C-P4 no rank / streak / score', !/\b\d+(st|nd|rd|th)\s+place\b|\bstreak of\b|\branked\b|\bscore:/i.test(t));
    report('A1 Community populated', out);
  });

  test('A2 at 390x640 the first screen reaches This period and the current goal', async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 390, height: 640 });
    const fx = await fixture('a2');
    const { fb, out } = rows();
    await signInVia(page, fx.m.email, fx.m.password);
    await remember(page, fx.m.uid, fx.c1.id);
    await cold(page, '/community', fx.c1.name);
    const period = await topOf(page, /this period/i);
    const goalTop = Math.min(...[await topOf(page, fx.g.G1.title), await topOf(page, fx.g.G2.title)].filter((x): x is number => x !== null), 1e9);
    fb('C-F8 390x640: This period and the current goal title are in the first viewport', period !== null && period < 640 && goalTop < 640, { period, goalTop });
    report('A2 Community 390x640', out);
  });

  test('A3 truths: lifecycles distinct, roster follows privacy, warm entry paints no skeleton, public boundary', async ({ page, browser }) => {
    test.setTimeout(220_000);
    const fx = await fixture('a3');
    const { pv, out } = rows();
    await signInVia(page, fx.m.email, fx.m.password);
    await remember(page, fx.m.uid, fx.c1.id);
    // Lifecycles: wherever the community's history is drawn (the Community tab after the hook; Community Home today).
    let t = await cold(page, '/community', fx.c1.name);
    let where = '/community';
    if (!has(t, fx.g.R.title)) { t = await cold(page, `/community/${fx.c1.id}`, fx.c1.name); where = `/community/${fx.c1.id}`; }
    const titles = [fx.g.G1.title, fx.g.G2.title, fx.g.R.title, fx.g.U.title];
    const segR = segment(t, fx.g.R.title, titles), segU = segment(t, fx.g.U.title, titles);
    note('A3 lifecycle segments', { where, segR, segU });
    pv('C-P5 closed-reached and closed-unfinished stay distinct (U never reads reached)',
      segR !== null && segU !== null && /reached/i.test(segR) && !/\breached\b/i.test(segU.replace(/not reached|unreached/gi, '')), { segR, segU });
    // Roster: named members only; the private member counted, never named.
    const rt = await cold(page, `/community/${fx.c1.id}/members`, fx.o.name);
    note('A3 roster text', rt.replace(/\s+/g, ' ').slice(0, 400));
    pv('C-P6 roster names O and M, never the name-private Q', has(rt, fx.o.name) && (has(rt, fx.m.name) || /\byou\b/i.test(rt)) && !has(rt, fx.q.name));
    // Warm entry: Home -> Community tab, in app; no full loading frame.
    await cold(page, `/community/${fx.c1.id}`, fx.c1.name);
    await page.evaluate(() => {
      const W = { seen: [] as string[] };
      (window as unknown as { __w7l: typeof W }).__w7l = W;
      const tick = () => { const b = document.body?.innerText ?? ''; if (/Loading your communities|Loading…|Loading\.\.\./.test(b) && !W.seen.length) W.seen.push(b.slice(0, 60)); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    await page.locator('[data-testid="wsf-member-tab-community"]:visible').first().click({ timeout: 10_000 });
    await page.waitForTimeout(3_000);
    const seen = await page.evaluate(() => (window as unknown as { __w7l: { seen: string[] } }).__w7l.seen);
    pv('C-P7 warm entry from Home paints no full loading frame', seen.length === 0, seen);
    // Public boundary: the signed-out display carries no member name.
    const anon = await browser.newContext({ baseURL: BASE });
    const dp = await anon.newPage();
    await dp.goto(`/display/${fx.g.G1.id}`);
    await dp.waitForTimeout(5_000);
    const dt = await dp.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
    await anon.close();
    pv('C-P8 the public display names nobody', !has(dt, fx.m.name) && !has(dt, fx.o.name) && !has(dt, fx.q.name), dt.replace(/\s+/g, ' ').slice(0, 120));
    report('A3 Community truths', out);
  });

  test('A4 failed reads (INJECTED): nothing guessed, no Living WE on an unknown total', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await fixture('a4');
    const { fb, pv, out } = rows();
    await signInVia(page, fx.m.email, fx.m.password);
    await remember(page, fx.m.uid, fx.c1.id);
    await page.route('**/wsfMyCommunities', (r: Route) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"status":"INTERNAL","message":"injected"}}' }));
    const t1 = await cold(page, '/community', 'Community');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    note('A4 communities failed', t1.replace(/\s+/g, ' ').slice(0, 300));
    pv('C-P9 communities read fails: no count / role / goals guessed', !/\b0\s+members?\b|Members\s*0\b|Goals\s*0\b/i.test(t1) && /try again|retry/i.test(t1));
    await page.route('**/wsfListGoals', (r: Route) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"status":"INTERNAL","message":"injected"}}' }));
    const t2 = await cold(page, '/community', fx.c1.name);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    note('A4 goals failed', t2.replace(/\s+/g, ' ').slice(0, 300));
    pv('C-P10 goals read fails: no "no goal" claim and no goal count guessed', !/no goal running|no active goal|Goals\s*0\b/i.test(t2));
    // Unknown shared total: strip it everywhere it can come from.
    await page.route('**/wsfListGoals', async (r: Route) => {
      const res = await r.fetch();
      const j = (await res.json()) as { result?: { goals?: Array<Record<string, unknown>> } };
      for (const g of j.result?.goals ?? []) { delete g.sharedTotal; delete g.total; }
      await r.fulfill({ response: res, json: j });
    });
    for (const n of ['wsfGoalPulse', 'wsfGoalRecentAdditions']) await page.route(`**/${n}`, (r: Route) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"status":"INTERNAL","message":"injected"}}' }));
    const t3 = await cold(page, '/community', fx.c1.name);
    const weLoc = page.locator('[role="img"][aria-label*="filled"]:visible');
    const we = await weLoc.count();
    const weLabels = await weLoc.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    note('A4 total unknown', { we, weLabels, text: t3.replace(/\s+/g, ' ').slice(0, 300) });
    // Director listed this as PRESERVE; measured FAILING on 0b460ce3 (community/index.tsx:505-506 draws the
    // Living WE at `sharedTotal ?? 0`), so it is labelled FAIL-BEFORE: a latent gap the hook must close.
    fb('C-F9 unknown total: no Living WE instrument (and no "0 of 500")', we === 0 && !/\b0\s*(of|\/)\s*500\b/.test(t3), { we, weLabels });
    report('A4 Community failed reads', out);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 45B — SETTINGS
// ═══════════════════════════════════════════════════════════════════════════

test.describe(`W7 Check 45B · Settings baseline (${LABEL})`, () => {
  test('B1 Settings is a panel over the mounted You: dialog, Close first, Escape / scrim, focus trap and return', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await fixture('b1');
    const { fb, out } = rows();
    await signInVia(page, fx.m.email, fx.m.password);
    await remember(page, fx.m.uid, fx.c1.id);
    await cold(page, '/you', fx.m.name);
    const opened = await openSettings(page);
    const d = dialog(page);
    const dText = opened ? await d.innerText({ timeout: 3_000 }).catch(() => '') : '';
    const switchesInDialog = opened ? await d.locator('input[type="checkbox"], [role="switch"]').count() : 0;
    note('B1 after Settings', { opened, path: new URL(page.url()).pathname, dText: dText.replace(/\s+/g, ' ').slice(0, 200), switchesInDialog });
    fb('S-F1 Settings opens as a dialog over the still-mounted You', opened && (await page.getByText(fx.m.name).count()) > 0);
    fb('S-F2 the panel is titled Settings and holds both communities’ controls (≥ 4 switches)', opened && /\bSettings\b/.test(dText) && has(dText, fx.c1.name) && has(dText, fx.c2.name) && switchesInDialog >= 4);
    const first = await activeInfo(page);
    fb('S-F3 focus enters on Close', first.inDialog && /close/i.test(first.label), first);
    // Escape closes; focus returns to the trigger.
    if (opened) { await page.keyboard.press('Escape'); await page.waitForTimeout(700); }
    const afterEsc = { open: (await dialog(page).count()) > 0, focus: await activeInfo(page) };
    fb('S-F4 Escape closes it and focus returns to Settings', opened && !afterEsc.open && /^settings/i.test(afterEsc.focus.label), afterEsc);
    // Scrim closes; focus returns.
    let scrim = { reopened: false, open: true, focus: { inDialog: false, label: '' } };
    if (opened) {
      await cold(page, '/you', fx.m.name);
      scrim.reopened = await openSettings(page);
      await page.mouse.click(8, 420);
      await page.waitForTimeout(700);
      scrim = { ...scrim, open: (await dialog(page).count()) > 0, focus: await activeInfo(page) };
    }
    fb('S-F5 a scrim press closes it and focus returns to Settings', scrim.reopened && !scrim.open && /^settings/i.test(scrim.focus.label), scrim);
    // Focus trap.
    let trapped = false;
    if (opened) {
      await cold(page, '/you', fx.m.name);
      if (await openSettings(page)) {
        trapped = true;
        for (let i = 0; i < 25; i += 1) { await page.keyboard.press('Tab'); if (!(await activeInfo(page)).inDialog) { trapped = false; break; } }
      }
    }
    fb('S-F6 Tab stays inside the panel (25 presses)', trapped);
    report('B1 Settings panel', out);
  });

  test('B2 truths through whatever Settings surface exists: name OFF in C1 is stored, C2 untouched, others read it', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await fixture('b2');
    const { pv, out } = rows();
    await signInVia(page, fx.m.email, fx.m.password);
    await remember(page, fx.m.uid, fx.c1.id);
    await cold(page, '/you', fx.m.name);
    await reachPrivacy(page, fx);
    const before = { c1: await nameSwitchState(page, fx.c1.name), c2: await nameSwitchState(page, fx.c2.name) };
    const flipped = await flipName(page, fx.c1.name);
    await page.waitForTimeout(2_500);
    const stored = { c1: await storedName(fx.c1.id, fx.m.uid), c2: await storedName(fx.c2.id, fx.m.uid) };
    const oToken = await tokenFor(fx.o.email, fx.o.password);
    const members = await call('wsfCommunityMembers', { groupId: fx.c1.id }, oToken);
    const oSeesM = ((members?.members ?? []) as { displayName: string }[]).some((x) => x.displayName === fx.m.name);
    await cold(page, '/you', fx.m.name);
    await reachPrivacy(page, fx);
    const after = { c1: await nameSwitchState(page, fx.c1.name), c2: await nameSwitchState(page, fx.c2.name) };
    note('B2 privacy', { before, flipped, stored, oSeesM, after });
    pv('S-P1 name OFF in C1 is stored, and the switch shows the stored value after reopening', before.c1 === 'on' && flipped && stored.c1 === 'private' && after.c1 === 'off');
    pv('S-P2 C2 is untouched (stored and shown)', stored.c2 === null && after.c2 === 'on');
    pv('S-P3 another member no longer sees M named in C1', !oSeesM);
    report('B2 Settings truths', out);
  });
});
