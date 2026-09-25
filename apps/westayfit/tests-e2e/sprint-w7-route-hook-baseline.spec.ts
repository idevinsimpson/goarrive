import { randomBytes } from 'node:crypto';

import { expect, test, type Page, type Route } from '@playwright/test';

import { FIRESTORE_EMULATOR, PROJECT_ID, seedProfile, seedShards, seedVerifiedUser, signInVia, stampId } from './helpers/mobile';

/**
 * W7 — CHECK 44: the You + Progress ROUTE-HOOK baseline (Director #434
 * `5841055703`), on exact served `0b460ce3f2f0766406100fef14d9a444c8cad43a`.
 * To be re-run unchanged as the Phase B adapter check once W6/W8's pure views
 * are hooked into `app/(tabs)/you.tsx` and `app/(tabs)/activity.tsx`.
 *
 * Every row is labelled:
 *   [FAIL-BEFORE]  a fact of the ACCEPTED hierarchy — frozen Lovable You
 *                  `642f830b…/src/demo/screens/you.tsx`, Progress
 *                  `09b8a73c…/src/demo/screens/progress.tsx` — and of the
 *                  Director's Phase B adapter rules (#456 `5841023890`,
 *                  `5841056153`). Expected to FAIL on `0b460ce3`; must pass
 *                  after the hook.
 *   [PRESERVE]     a canonical truth the current route already keeps. Must
 *                  pass now AND after the hook.
 *
 * ROUTE-LEVEL ONLY. Rows read visible text, order on screen and the routes'
 * public behaviour; no W6/W8 component name or testID is assumed. Each route
 * is COLD-LOADED (a full navigation) so no other tab's mounted scene is in the
 * page text. Emulators only (demo-wsf-local); synthetic accounts; Chromium at
 * 390x844. Reads marked INJECTED are forced with page.route.
 */

const BASE = process.env.WSF_PLAYWRIGHT_BASE_URL;
const LABEL = process.env.W7_LABEL ?? 'head';
test.skip(!BASE, 'Set WSF_PLAYWRIGHT_BASE_URL to the emulator-flagged build under test.');
test.use({ viewport: { width: 390, height: 844 } });

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const OWNER = { authorization: 'Bearer owner', 'content-type': 'application/json' };
const docUrl = (p: string, q = '') => `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${p}${q}`;
const ts = (d: Date) => ({ timestampValue: d.toISOString() });
const DAY = 864e5;

async function write(path: string, fields: Record<string, unknown>): Promise<void> {
  const res = await fetch(docUrl(path), { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields }) });
  if (!res.ok) throw new Error(`write ${path}: ${res.status} ${await res.text()}`);
}

type Person = { uid: string; email: string; password: string; name: string };
async function person(tag: string, name: string): Promise<Person> {
  const email = `wsf-w7c44-${tag}-${stampId()}@example.com`;
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
}

type G = { id: string; title: string; unit: string; target: number; shared: number; own: number; open: boolean; endsInDays: number };
async function goal(groupId: string, owner: string, member: string, g: G): Promise<void> {
  const now = Date.now();
  const fields: Record<string, unknown> = {
    ownerUid: { stringValue: owner }, communityGroupId: { stringValue: groupId }, title: { stringValue: g.title },
    target: { integerValue: String(g.target) }, unit: { stringValue: g.unit }, status: { stringValue: g.open ? 'active' : 'closed' },
    startsAt: ts(new Date(now - 20 * DAY)), endsAt: ts(new Date(now + g.endsInDays * DAY)), timezone: { stringValue: 'America/New_York' },
    createdAt: ts(new Date(now - 20 * DAY)), updatedAt: ts(new Date(now)),
  };
  if (!g.open) fields.closedAt = ts(new Date(now + g.endsInDays * DAY));
  await write(`wsfGoals/${g.id}`, fields);
  if (g.shared > 0) await seedShards(g.id, g.shared);
  if (g.own > 0) {
    await write(`wsfGoalMemberTotals/${g.id}_${member}`, { goalId: { stringValue: g.id }, userId: { stringValue: member }, total: { integerValue: String(g.own) } });
    // A real private contribution row exists, so a refused client read of it is not vacuous.
    await write(`wsfContributions/w7c44-${stampId()}`, {
      communityGroupId: { stringValue: groupId }, goalId: { stringValue: g.id }, userId: { stringValue: member },
      count: { integerValue: String(g.own) }, unit: { stringValue: g.unit }, createdAt: ts(new Date(now - DAY)),
    });
  }
}

/**
 * The populated fixture: M in one community (C1) with five goals.
 *   open A   500 squats, shared 180, own 35, ends in 3 days  -> OPEN, the lead
 *   open B   120 minutes, shared 130, own 12, ends in 6 days -> REACHED · STILL OPEN
 *   open Z   300 steps, shared 50, own 0                      -> never a personal row
 *   closed R 200 squats, shared 230, own 20                   -> CLOSED · REACHED
 *   closed U 400 squats, shared 150, own 18                   -> CLOSED · UNFINISHED
 * Own totals by unit: 73 squats, 12 minutes (a blended sum would be 85).
 */
async function populated(tag: string, extraCommunity = false) {
  const s = stampId();
  const m = await person(`${tag}m`, `Mara Baseline ${s.slice(-4)}`);
  const o = await person(`${tag}o`, `Olu Champion ${s.slice(-4)}`);
  const c1 = { id: `w7c44c1-${s}${tag}`, name: `W7 Harbor Movers ${s.slice(-4)}` };
  await community(c1.id, c1.name, o.uid, [m.uid]);
  const goals: Record<'A' | 'B' | 'Z' | 'R' | 'U', G> = {
    A: { id: `w7c44A-${s}${tag}`, title: 'Harbor Squat Month', unit: 'squats', target: 500, shared: 180, own: 35, open: true, endsInDays: 3 },
    B: { id: `w7c44B-${s}${tag}`, title: 'Minutes Together', unit: 'minutes', target: 120, shared: 130, own: 12, open: true, endsInDays: 6 },
    Z: { id: `w7c44Z-${s}${tag}`, title: 'Steps Nobody Took', unit: 'steps', target: 300, shared: 50, own: 0, open: true, endsInDays: 9 },
    R: { id: `w7c44R-${s}${tag}`, title: 'Spring Squat Sprint', unit: 'squats', target: 200, shared: 230, own: 20, open: false, endsInDays: -3 },
    U: { id: `w7c44U-${s}${tag}`, title: 'Winter Squat Stretch', unit: 'squats', target: 400, shared: 150, own: 18, open: false, endsInDays: -10 },
  };
  for (const g of Object.values(goals)) await goal(c1.id, o.uid, m.uid, g);
  let c2: { id: string; name: string } | null = null;
  if (extraCommunity) {
    c2 = { id: `w7c44c2-${s}${tag}`, name: `W7 Summit Walkers ${s.slice(-4)}` };
    await community(c2.id, c2.name, o.uid, [m.uid]);
  }
  return { m, o, c1, c2, goals };
}

/** A member with NO own credit, in one community whose goals are open (eligible) or all closed (not eligible). */
async function zeroOwn(tag: string, eligible: boolean) {
  const s = stampId();
  const m = await person(`${tag}m`, `Nell Zero ${s.slice(-4)}`);
  const o = await person(`${tag}o`, `Olu Champion ${s.slice(-4)}`);
  const c = { id: `w7c44z-${s}${tag}`, name: `W7 Quiet Circle ${s.slice(-4)}` };
  await community(c.id, c.name, o.uid, [m.uid]);
  await goal(c.id, o.uid, m.uid, eligible
    ? { id: `w7c44E-${s}${tag}`, title: 'Open Plank Week', unit: 'minutes', target: 300, shared: 40, own: 0, open: true, endsInDays: 5 }
    : { id: `w7c44X-${s}${tag}`, title: 'Closed Plank Week', unit: 'minutes', target: 300, shared: 40, own: 0, open: false, endsInDays: -4 });
  return { m, c };
}

// ── measurement helpers ────────────────────────────────────────────────────

type Row = { kind: 'FAIL-BEFORE' | 'PRESERVE'; id: string; ok: boolean; detail?: unknown };
function rows() {
  const out: Row[] = [];
  const add = (kind: Row['kind'], id: string, ok: boolean, detail?: unknown) => {
    out.push({ kind, id, ok, detail });
    expect.soft(ok, `[${kind}] ${id}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`).toBe(true);
  };
  return { out, fb: (id: string, ok: boolean, d?: unknown) => add('FAIL-BEFORE', id, ok, d), pv: (id: string, ok: boolean, d?: unknown) => add('PRESERVE', id, ok, d) };
}
function report(label: string, r: Row[]) {
  const summary = {
    failBefore: { pass: r.filter((x) => x.kind === 'FAIL-BEFORE' && x.ok).map((x) => x.id), fail: r.filter((x) => x.kind === 'FAIL-BEFORE' && !x.ok).map((x) => x.id) },
    preserve: { pass: r.filter((x) => x.kind === 'PRESERVE' && x.ok).map((x) => x.id), fail: r.filter((x) => x.kind === 'PRESERVE' && !x.ok).map((x) => x.id) },
  };
  // eslint-disable-next-line no-console
  console.log(`MEASURE ${label} (${LABEL}): ${JSON.stringify(summary)}`);
  test.info().annotations.push({ type: 'measure', description: `${label}: ${JSON.stringify(summary)}` });
}
function note(label: string, v: unknown) {
  // eslint-disable-next-line no-console
  console.log(`MEASURE ${label} (${LABEL}): ${JSON.stringify(v)}`);
}

/** Cold-load a route and wait until the visible text contains `must` and has stopped changing for 1.2 s. */
async function coldText(page: Page, path: string, must: string): Promise<string> {
  await page.goto(path);
  const t0 = Date.now();
  let last = '';
  let stableSince = Date.now();
  while (Date.now() - t0 < 30_000) {
    const t = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
    if (t !== last) { last = t; stableSince = Date.now(); }
    if (t.includes(must) && Date.now() - stableSince >= 1_200 && !/Loading/i.test(t)) return t;
    await page.waitForTimeout(150);
  }
  return last;
}
const has = (t: string, re: RegExp | string) => (typeof re === 'string' ? t.includes(re) : re.test(t));
/** Top edge of the first visible element whose own text contains `text` (null when none). */
async function topOf(page: Page, text: string): Promise<number | null> {
  const loc = page.getByText(text, { exact: false });
  const n = await loc.count();
  for (let i = 0; i < n; i += 1) {
    const b = await loc.nth(i).boundingBox().catch(() => null);
    if (b && b.height > 0) return b.y;
  }
  return null;
}
const NO_RANK = /\b\d+(st|nd|rd|th)\s+place\b|#\s?\d+\b|\bstreak of\b|\b\d+[- ]day streak\b|\bscore:\s*\d|\branked\b|\byou moved us\b/i;
const reachable = async (page: Page, re: RegExp) => {
  const loc = page.getByText(re).first();
  if (!(await loc.count())) return false;
  await loc.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => undefined);
  return loc.isVisible();
};

/** INJECTED: every goal in wsfListGoals comes back WITHOUT `sharedTotal` (the unknown-shared case). */
async function stripShared(page: Page) {
  await page.route('**/wsfListGoals', async (route: Route) => {
    const res = await route.fetch();
    const j = (await res.json()) as { result?: { goals?: Array<Record<string, unknown>> } };
    for (const g of j.result?.goals ?? []) delete g.sharedTotal;
    await route.fulfill({ response: res, json: j });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 44A — YOU
// ═══════════════════════════════════════════════════════════════════════════

test.describe(`W7 Check 44A · You route baseline (${LABEL})`, () => {
  test('A1 populated: hierarchy (fail-before) and canonical truths (preserve)', async ({ page }) => {
    test.setTimeout(180_000);
    const fx = await populated('a1');
    const { fb, pv, out } = rows();
    await signInVia(page, fx.m.email, fx.m.password);
    const t = await coldText(page, '/you', fx.c1.name);
    note('A1 You text', t.replace(/\s+/g, ' ').slice(0, 900));

    // [FAIL-BEFORE] the accepted hierarchy (Lovable you.tsx; Director adapter rules).
    fb('Y-F1 the community band reads "Your current community"', has(t, /your current community/i));
    fb('Y-F2 the lead reads "Your part in Living WE", "Shared position" and "Your exact confirmed part"',
      has(t, /your part in living we/i) && has(t, /shared position/i) && has(t, /your exact confirmed part/i));
    fb('Y-F3 "Other goals you helped" with Yours / Shared split', has(t, /other goals you helped/i) && has(t, /\byours\b/i) && has(t, /\bshared\b/i));
    fb('Y-F4 lifecycle status on other goals: REACHED · STILL OPEN, CLOSED · REACHED, CLOSED · UNFINISHED',
      has(t, /reached\s*·\s*still open/i) && has(t, /closed\s*·\s*reached/i) && has(t, /closed\s*·\s*unfinished/i));
    const band = await topOf(page, fx.c1.name);
    const email = await topOf(page, fx.m.email);
    const signOut = await topOf(page, 'Sign out');
    fb('Y-F5 no email / account hierarchy above the member story (email and Sign out sit below the community)',
      band !== null && (email === null || email > band) && (signOut === null || signOut > band), { band, email, signOut });

    // [PRESERVE] canonical truths.
    pv('Y-P1 member name leads', (await topOf(page, fx.m.name)) !== null && ((await topOf(page, fx.m.name)) ?? 1e9) < (band ?? -1));
    pv('Y-P2 current community and its member count shown', has(t, fx.c1.name) && has(t, /\b2\s+members\b/i));
    const a = await topOf(page, fx.goals.A.title);
    const b = await topOf(page, fx.goals.B.title);
    pv('Y-P3 the lead is the soonest-ending open goal with own credit (A before B)', a !== null && b !== null && a < b, { a, b });
    pv('Y-P4 own > 0 only: the zero-own goal is not a personal row', !has(t, fx.goals.Z.title));
    pv('Y-P5 exact own parts carry their own units', has(t, /35\s*squats/i) && has(t, /12\s*minutes/i));
    pv('Y-P6 no cross-unit sum (35 + 12 = 47)', !has(t, /\b47\b/));
    pv('Y-P7 a finished goal the member helped stays listed', has(t, fx.goals.R.title) && has(t, fx.goals.U.title));
    pv('Y-P8 no rank / streak / score / inferred impact', !NO_RANK.test(t));
    pv('Y-P9 Sign out reachable', await reachable(page, /^Sign out$/i));
    // Settings: a working affordance (route or panel).
    const settings = page.getByText(/^Settings$/).first();
    const settingsOk = (await settings.count()) > 0;
    if (settingsOk) {
      await settings.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => undefined);
      await settings.click({ timeout: 5_000 }).catch(() => undefined);
      await page.waitForTimeout(1_500);
    }
    const opened = new URL(page.url()).pathname.startsWith('/settings') || (await page.locator('[role="dialog"]:visible').count()) > 0;
    pv('Y-P10 Settings exists and opens', settingsOk && opened, { path: new URL(page.url()).pathname });
    report('A1 You populated', out);
  });

  test('A2 unknown shared total (INJECTED): never shown as 0', async ({ page }) => {
    test.setTimeout(150_000);
    const fx = await populated('a2');
    const { fb, pv, out } = rows();
    await signInVia(page, fx.m.email, fx.m.password);
    await stripShared(page);
    const t = await coldText(page, '/you', fx.c1.name);
    note('A2 You text (shared unknown)', t.replace(/\s+/g, ' ').slice(0, 700));
    const zeroOfTarget = /\b0\s*(of|\/)\s*500\b/i.test(t) || /\b0\s*(of|\/)\s*120\b/i.test(t);
    fb('Y-F6 an unknown shared total is never rendered as 0 of target', !zeroOfTarget, { zeroOfTarget });
    fb('Y-F7 an unknown shared total is stated as Unknown', has(t, /unknown/i));
    pv('Y-P11 own parts still exact while shared is unknown', has(t, /35\s*squats/i));
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    report('A2 You unknown shared', out);
  });

  test('A3 several communities: none remembered stays the chooser; a remembered one is used', async ({ page }) => {
    test.setTimeout(150_000);
    const fx = await populated('a3', true);
    const { pv, out } = rows();
    await signInVia(page, fx.m.email, fx.m.password);
    await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('wsf.currentCommunity.')) localStorage.removeItem(k); });
    const t = await coldText(page, '/you', fx.m.name);
    note('A3 You text (none remembered)', t.replace(/\s+/g, ' ').slice(0, 500));
    pv('Y-P12 none remembered: no community is spoken for (not the first item)', !has(t, fx.c1.name) && !has(t, fx.c2!.name) && !has(t, fx.goals.A.title));
    pv('Y-P13 none remembered: a way to choose is offered', await reachable(page, /choose|pick|which community/i));
    await coldText(page, `/community/${fx.c2!.id}`, fx.c2!.name);
    const t2 = await coldText(page, '/you', fx.c2!.name);
    pv('Y-P14 remembered: the remembered community is the current one', has(t2, fx.c2!.name) && !has(t2, fx.goals.A.title));
    report('A3 You several communities', out);
  });

  for (const eligible of [true, false]) {
    test(`A4 zero own, ${eligible ? 'an open goal exists' : 'no goal open'}`, async ({ page }) => {
      test.setTimeout(150_000);
      const fx = await zeroOwn(eligible ? 'a4e' : 'a4n', eligible);
      const { fb, pv, out } = rows();
      await signInVia(page, fx.m.email, fx.m.password);
      const t = await coldText(page, '/you', fx.c.name);
      note(`A4 You text (zero own, eligible=${eligible})`, t.replace(/\s+/g, ' ').slice(0, 500));
      if (eligible) fb('Y-F8 eligible: "Your first confirmed contribution can start here" + Start moving', has(t, /your first confirmed contribution can start here/i) && has(t, /start moving/i));
      else fb('Y-F9 not eligible: "No goal is open for contributions" + Open community', has(t, /no goal is open for contributions/i) && has(t, /open community/i));
      if (!eligible) pv('Y-P15 not eligible: no Start moving offered', !has(t, /start moving/i));
      pv('Y-P16 no own amount invented (no "0 minutes")', !has(t, /\b0\s*minutes\b/i));
      pv('Y-P17 Sign out reachable', await reachable(page, /^Sign out$/i));
      report(`A4 You zero own eligible=${eligible}`, out);
    });
  }

  test('A5 goals read fails (INJECTED): identity, community, Retry and Sign out survive', async ({ page }) => {
    test.setTimeout(150_000);
    const fx = await populated('a5');
    const { fb, pv, out } = rows();
    await signInVia(page, fx.m.email, fx.m.password);
    await page.route('**/wsfListGoals', (r: Route) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"status":"INTERNAL","message":"injected"}}' }));
    const t = await coldText(page, '/you', fx.m.name);
    note('A5 You text (goals read failed)', t.replace(/\s+/g, ' ').slice(0, 500));
    fb('Y-F10 the community stays on screen when the goals read fails', has(t, fx.c1.name));
    pv('Y-P18 identity survives', has(t, fx.m.name));
    pv('Y-P19 Retry offered', await reachable(page, /^(retry|try again)$/i));
    pv('Y-P20 no amount guessed as 0', !/\b0\s*(squats|minutes)\b/i.test(t));
    pv('Y-P21 Sign out reachable', await reachable(page, /^Sign out$/i));
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    report('A5 You goals failed', out);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 44B — PROGRESS
// ═══════════════════════════════════════════════════════════════════════════

test.describe(`W7 Check 44B · Progress route baseline (${LABEL})`, () => {
  test('B1 populated: hierarchy (fail-before) and canonical truths (preserve)', async ({ page }) => {
    test.setTimeout(180_000);
    const fx = await populated('b1');
    const { fb, pv, out } = rows();
    await signInVia(page, fx.m.email, fx.m.password);
    const t = await coldText(page, '/activity', fx.goals.A.title);
    note('B1 Progress text', t.replace(/\s+/g, ' ').slice(0, 900));

    fb('P-F1 own totals lead, per unit: 73 squats and 12 minutes recorded', has(t, /\b73\b[\s\S]{0,20}squats/i) && has(t, /\b12\b[\s\S]{0,20}minutes/i) && has(t, /recorded/i));
    const clar = await topOf(page, 'This personal summary is only for you');
    const firstGoal = await topOf(page, fx.goals.A.title);
    fb('P-F2 the privacy clarification sits in the hero, above the goal list', clar !== null && firstGoal !== null && clar < firstGoal, { clar, firstGoal });
    fb('P-F3 "Goals you helped" with Yours / Shared split', has(t, /goals you helped/i) && has(t, /\byours\b/i) && has(t, /\bshared\b/i));
    fb('P-F4 every lifecycle stated: OPEN, REACHED · STILL OPEN, CLOSED · REACHED, CLOSED · UNFINISHED',
      has(t, /\bopen\b/i) && has(t, /reached\s*·\s*still open/i) && has(t, /closed\s*·\s*reached/i) && has(t, /closed\s*·\s*unfinished/i));
    fb('P-F5 the member is named in the private hero', has(t, fx.m.name));

    pv('P-P1 title and subtitle', has(t, 'Your progress') && has(t, 'Your recorded contributions, by goal.'));
    pv('P-P2 no blended units (73 + 12 = 85 never shown)', !has(t, /\b85\b/));
    pv('P-P3 own > 0 only: the zero-own goal is absent', !has(t, fx.goals.Z.title));
    pv('P-P4 finished history stays', has(t, fx.goals.R.title) && has(t, fx.goals.U.title));
    pv('P-P5 no fabricated receipts: no "+35"-style dated rows, no relative times', !/\+\s?(35|12|20|18)\b/.test(t) && !/\b\d+\s*(minutes?|hours?|days?)\s+ago\b|\byesterday\b/i.test(t));
    pv('P-P6 the clarification is said once', (t.match(/This personal summary is only for you/g) ?? []).length === 1);
    pv('P-P7 no rank / streak / score', !NO_RANK.test(t));
    report('B1 Progress populated', out);
  });

  test('B2 unknown shared total (INJECTED): stated, never 0, never reached', async ({ page }) => {
    test.setTimeout(150_000);
    const fx = await populated('b2');
    const { fb, pv, out } = rows();
    await signInVia(page, fx.m.email, fx.m.password);
    await stripShared(page);
    const t = await coldText(page, '/activity', fx.goals.A.title);
    note('B2 Progress text (shared unknown)', t.replace(/\s+/g, ' ').slice(0, 700));
    fb('P-F6 an unknown shared total is stated as Unknown', has(t, /unknown/i));
    pv('P-P9 an unknown shared total is never rendered as 0 of target', !/\b0\s*(of|\/)\s*(500|120|200|400)\b/i.test(t) && !/\b0(\.0)?%/.test(t));
    pv('P-P10 nothing claimed reached on an unknown total', !/\bREACHED\b/.test(t) && !/reached\s*·|·\s*reached/i.test(t));
    pv('P-P11 own parts still exact', has(t, /35\s*squats/i));
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    report('B2 Progress unknown shared', out);
  });

  test('B3 one own-part read fails (INJECTED): partial, omitted goal not counted, Retry', async ({ page }) => {
    test.setTimeout(150_000);
    const fx = await populated('b3');
    const { fb, pv, out } = rows();
    await signInVia(page, fx.m.email, fx.m.password);
    await page.route('**/wsfMyContribution', async (r: Route) => {
      if ((r.request().postData() ?? '').includes(fx.goals.B.id)) return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"status":"INTERNAL","message":"injected"}}' });
      return r.continue();
    });
    const t = await coldText(page, '/activity', fx.goals.A.title);
    note('B3 Progress text (partial)', t.replace(/\s+/g, ' ').slice(0, 700));
    pv('P-P12 partial is stated', has(t, /partial|could not be read|may not be everything/i));
    pv('P-P13 the omitted goal is not shown or counted (no 12 minutes)', !has(t, fx.goals.B.title) && !has(t, /\b12\s*minutes\b/i));
    fb('P-F7 the partial state offers Retry', await reachable(page, /^(retry|try again)$/i));
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    report('B3 Progress partial', out);
  });

  test('B4 communities read fails (INJECTED): a truthful failure', async ({ page }) => {
    test.setTimeout(150_000);
    const fx = await populated('b4');
    const { pv, out } = rows();
    await signInVia(page, fx.m.email, fx.m.password);
    await page.route('**/wsfMyCommunities', (r: Route) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"status":"INTERNAL","message":"injected"}}' }));
    const t = await coldText(page, '/activity', 'Your progress');
    note('B4 Progress text (failure)', t.replace(/\s+/g, ' ').slice(0, 500));
    pv('P-P14 the failure is stated with Retry', has(t, /could(n’t| not) be loaded/i) && (await reachable(page, /^(retry|try again)$/i)));
    pv('P-P15 no amount guessed as 0 and no empty-state claim', !/\b0\s*(squats|minutes)\b/i.test(t) && !has(t, /your first contribution will appear here/i));
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    report('B4 Progress failure', out);
  });

  for (const eligible of [true, false]) {
    test(`B5 zero own, ${eligible ? 'an open goal exists' : 'no goal open'}`, async ({ page }) => {
      test.setTimeout(150_000);
      const fx = await zeroOwn(eligible ? 'b5e' : 'b5n', eligible);
      const { fb, pv, out } = rows();
      await signInVia(page, fx.m.email, fx.m.password);
      const t = await coldText(page, '/activity', 'Your progress');
      note(`B5 Progress text (zero own, eligible=${eligible})`, t.replace(/\s+/g, ' ').slice(0, 400));
      if (eligible) pv('P-P16 eligible: "Your first contribution will appear here" + Start moving', has(t, /your first contribution will appear here/i) && has(t, /start moving/i));
      else {
        fb('P-F8 not eligible: "No goal is open for contributions" + Open community', has(t, /no goal is open for contributions/i) && has(t, /open community/i));
        fb('P-F9 not eligible: Start moving is not offered', !has(t, /start moving/i));
      }
      pv('P-P17 no own amount invented', !/\b0\s*minutes\b/i.test(t));
      report(`B5 Progress zero own eligible=${eligible}`, out);
    });
  }

  test('B6 no client-readable private dated receipt source', async () => {
    test.setTimeout(120_000);
    const fx = await populated('b6');
    const { pv, out } = rows();
    const token = ((await (await fetch(`${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: fx.m.email, password: fx.m.password, returnSecureToken: true }),
    })).json()) as { idToken: string }).idToken;
    const bearer = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    // The rows exist (the owner can list them), so a refusal is not vacuous.
    const q = { structuredQuery: { from: [{ collectionId: 'wsfContributions' }], where: { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: fx.m.uid } } } } };
    const ownerQ = await fetch(`${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`, { method: 'POST', headers: OWNER, body: JSON.stringify(q) });
    const mineExist = ((await ownerQ.json()) as Array<{ document?: unknown }>).filter((x) => x.document).length;
    const memberList = await fetch(docUrl('wsfContributions', '?pageSize=5'), { headers: bearer });
    const memberQuery = await fetch(`${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`, {
      method: 'POST', headers: bearer,
      body: JSON.stringify(q),
    });
    const memberTotals = await fetch(docUrl(`wsfGoalMemberTotals/${fx.goals.A.id}_${fx.m.uid}`), { headers: bearer });
    const own = await fetch(`http://127.0.0.1:5001/${PROJECT_ID}/us-central1/wsfMyContribution`, { method: 'POST', headers: bearer, body: JSON.stringify({ data: { goalId: fx.goals.A.id } }) });
    const ownBody = ((await own.json()) as { result?: Record<string, unknown> }).result ?? {};
    const r = {
      contributionRowsForMember: mineExist,
      clientListStatus: memberList.status,
      clientQueryStatus: memberQuery.status,
      clientQueryBody: (await memberQuery.text()).slice(0, 160),
      clientMemberTotalsStatus: memberTotals.status,
      myContributionKeys: Object.keys(ownBody).sort(),
    };
    note('B6 private history source', r);
    pv('P-P18 the member has real contribution rows (non-vacuous)', mineExist >= 4, mineExist);
    pv('P-P19 a client list of wsfContributions is refused', r.clientListStatus === 403);
    pv('P-P20 a client query of the member’s own wsfContributions is refused', r.clientQueryStatus === 403 || /PERMISSION_DENIED/.test(r.clientQueryBody));
    pv('P-P21 wsfMyContribution carries no dated field', !r.myContributionKeys.some((k) => /at$|date|time|history|receipt/i.test(k)), r.myContributionKeys);
    report('B6 Progress private history source', out);
  });
});
