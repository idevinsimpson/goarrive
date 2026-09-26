import { randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { FIRESTORE_EMULATOR, PROJECT_ID, seedProfile, seedShards, seedVerifiedUser, signInVia, stampId } from './helpers/mobile';

/**
 * W7 — CHECK 50: the You (#503) and Progress (#504) Phase B route QA rows that
 * Check 44 (`sprint-w7-route-hook-baseline.spec.ts`, the pass-after) does not
 * already carry (Director release #434 `5843356920`; lead ruling #503
 * `5843356469`).
 *
 *   Q1  You, two communities, the other one already in the account's record:
 *       the lead is the SELECTED community's soonest-ending credited open goal,
 *       even when the other community's goal ends sooner; the other
 *       community's credited goal is listed with ITS OWN community's name and
 *       period.
 *   Q2  You, two communities, the other one NOT in the record (cold /you):
 *       the list says it is partial; nothing is invented for the other
 *       community; no read is fanned out to it.
 *   Q3  You and Progress write a goal's period in the GOAL's time zone
 *       (periodLabel pass-through): a goal whose end falls on a different
 *       calendar day in its zone than in the browser's.
 *
 * Corrections after the first runs, disclosed in report §50:
 *   · Q3's two rows were written as PRESERVE; the control prints no period on
 *     either route, so they are FAIL-BEFORE.
 *   · Q-F6 first put the zoned goal in You's LEAD, which by the accepted view
 *     never prints a period; the zoned goal is now a secondary row.
 *   · Q-F5 compared the name case-sensitively; the hero upper-cases it.
 *
 * Row labels as in Check 44: [FAIL-BEFORE] must fail on the control
 * `87997c58` and pass on the candidate; [PRESERVE] must pass on both.
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

async function write(path: string, fields: Record<string, unknown>): Promise<void> {
  const res = await fetch(docUrl(path), { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields }) });
  if (!res.ok) throw new Error(`write ${path}: ${res.status} ${await res.text()}`);
}

type Person = { uid: string; email: string; password: string };
async function person(tag: string, name: string): Promise<Person> {
  const email = `wsf-w7c50-${tag}-${stampId()}@example.com`;
  const password = `Aa1!${randomBytes(6).toString('hex')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, name);
  return { uid, email, password };
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

type G = { id: string; title: string; unit: string; target: number; shared: number; own: number; open: boolean; endsAt: Date; tz?: string };
async function goal(groupId: string, owner: string, member: string, g: G): Promise<void> {
  const now = Date.now();
  const fields: Record<string, unknown> = {
    ownerUid: { stringValue: owner }, communityGroupId: { stringValue: groupId }, title: { stringValue: g.title },
    target: { integerValue: String(g.target) }, unit: { stringValue: g.unit }, status: { stringValue: g.open ? 'active' : 'closed' },
    startsAt: ts(new Date(now - 20 * DAY)), endsAt: ts(g.endsAt), timezone: { stringValue: g.tz ?? 'America/New_York' },
    createdAt: ts(new Date(now - 20 * DAY)), updatedAt: ts(new Date(now)),
  };
  if (!g.open) fields.closedAt = ts(g.endsAt);
  await write(`wsfGoals/${g.id}`, fields);
  if (g.shared > 0) await seedShards(g.id, g.shared);
  if (g.own > 0) {
    await write(`wsfGoalMemberTotals/${g.id}_${member}`, { goalId: { stringValue: g.id }, userId: { stringValue: member }, total: { integerValue: String(g.own) } });
  }
}

const inDays = (d: number) => new Date(Date.now() + d * DAY);
/** "Ends Tue, Sep 29" — src/ui/dates' form for a day that is not today, written in `tz`. */
const endsLabel = (d: Date, tz: string) => `Ends ${new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(d)}`;

/** M in C1 (selected) and C2. C2's credited goal ends SOONER than either of C1's. */
async function twoCommunities(tag: string) {
  const s = stampId();
  const m = await person(`${tag}m`, `Mara Route ${s.slice(-4)}`);
  const o = await person(`${tag}o`, `Olu Champion ${s.slice(-4)}`);
  const c1 = { id: `w7c50c1-${s}${tag}`, name: `W7 Harbor Movers ${s.slice(-4)}` };
  const c2 = { id: `w7c50c2-${s}${tag}`, name: `W7 Lunch Crew ${s.slice(-4)}` };
  await community(c1.id, c1.name, o.uid, [m.uid]);
  await community(c2.id, c2.name, o.uid, [m.uid]);
  const A1: G = { id: `w7c50A1-${s}${tag}`, title: `Harbor Squats ${s.slice(-4)}`, unit: 'squats', target: 500, shared: 180, own: 35, open: true, endsAt: inDays(8.3) };
  const A2: G = { id: `w7c50A2-${s}${tag}`, title: `Harbor Minutes ${s.slice(-4)}`, unit: 'minutes', target: 120, shared: 40, own: 12, open: true, endsAt: inDays(12.3) };
  const B1: G = { id: `w7c50B1-${s}${tag}`, title: `Lunch Laps ${s.slice(-4)}`, unit: 'laps', target: 300, shared: 90, own: 7, open: true, endsAt: inDays(2.3) };
  for (const g of [A1, A2]) await goal(c1.id, o.uid, m.uid, g);
  await goal(c2.id, o.uid, m.uid, B1);
  return { m, c1, c2, A1, A2, B1 };
}

async function remember(page: Page, uid: string, groupId: string) {
  await page.evaluate(([u, g]) => localStorage.setItem(`wsf.currentCommunity.${u}`, g), [uid, groupId] as const);
}

/** Visible text of the member's page, once it contains `must` and has stopped changing for 1.2 s. */
async function settledText(page: Page, rootId: string, must: string): Promise<string> {
  const t0 = Date.now();
  let last = '';
  let since = Date.now();
  while (Date.now() - t0 < 30_000) {
    const t = await page.locator(`[data-testid="${rootId}"]:visible`).first().innerText({ timeout: 5_000 }).catch(() => '');
    if (t !== last) { last = t; since = Date.now(); }
    if (t.includes(must) && Date.now() - since >= 1_200) return t;
    await page.waitForTimeout(150);
  }
  return last;
}

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
}
function note(label: string, v: unknown) {
  // eslint-disable-next-line no-console
  console.log(`MEASURE ${label} (${LABEL}): ${JSON.stringify(v)}`);
}
/** The text between `title` and the next 160 characters: what the row says about itself. */
const after = (t: string, title: string) => { const i = t.indexOf(title); return i < 0 ? '' : t.slice(i, i + title.length + 160); };

test.describe(`W7 Check 50 · You / Progress route QA (${LABEL})`, () => {
  test('Q1 You: the lead is the selected community’s; the other community’s goal is listed under its own name', async ({ page }) => {
    test.setTimeout(180_000);
    const { out, fb, pv } = rows();
    const fx = await twoCommunities('q1');
    await page.goto('/');
    await remember(page, fx.m.uid, fx.c2.id);
    await signInVia(page, fx.m.email, fx.m.password);
    // C2's Home puts C2's goals and the member's own part in them into the account's record.
    await expect(page.locator('[data-testid="wsf-community"]:visible').first()).toContainText(fx.B1.title, { timeout: 40_000 });
    await page.waitForTimeout(1_500);
    // Switch to C1 through the Community tab (same document, so the record stays).
    await page.locator('[data-testid="wsf-member-tab-community"]:visible').first().click();
    await page.locator(`[data-testid="wsf-community-index-row-${fx.c1.id}"]:visible`).first().click({ timeout: 20_000 });
    await expect(page.locator('[data-testid="wsf-community"]:visible').first()).toContainText(fx.A1.title, { timeout: 40_000 });
    await page.waitForTimeout(1_500);
    await page.locator('[data-testid="wsf-member-tab-you"]:visible').first().click();
    const t = await settledText(page, 'wsf-you', fx.A1.title);
    note('Q1 You text', t.replace(/\s+/g, ' ').slice(0, 900));
    const iA1 = t.indexOf(fx.A1.title), iA2 = t.indexOf(fx.A2.title), iB1 = t.indexOf(fx.B1.title), iC1 = t.indexOf(fx.c1.name);
    pv('Q-P1 the selected community is the one spoken for', iC1 >= 0 && t.indexOf(fx.c2.name) !== iC1, { iC1 });
    pv('Q-P2 the lead is the selected community’s soonest-ending credited goal (not the other community’s sooner one)',
      iA1 >= 0 && (iB1 < 0 || iA1 < iB1) && (iA2 < 0 || iA1 < iA2), { iA1, iA2, iB1 });
    fb('Q-F1 the other community’s credited goal is listed', iB1 >= 0, { iB1 });
    fb('Q-F2 …under its own community’s name', after(t, fx.B1.title).includes(fx.c2.name), after(t, fx.B1.title));
    fb('Q-F3 …with its own period', after(t, fx.B1.title).includes(endsLabel(fx.B1.endsAt, 'America/New_York')), after(t, fx.B1.title));
    pv('Q-P3 the other community’s goal carries no share of the selected community’s name', !after(t, fx.B1.title).includes(fx.c1.name));
    report('Q1 You lead and other community', out);
  });

  test('Q2 You: another community not yet in the record makes the list partial, never invented', async ({ page }) => {
    test.setTimeout(180_000);
    const { out, fb, pv } = rows();
    const fx = await twoCommunities('q2');
    await page.goto('/');
    await remember(page, fx.m.uid, fx.c1.id);
    await signInVia(page, fx.m.email, fx.m.password);
    await expect(page.locator('[data-testid="wsf-community"]:visible').first()).toContainText(fx.A1.title, { timeout: 40_000 });
    const calls: string[] = [];
    page.on('request', (r) => { const u = new URL(r.url()); if (u.port === '5001') calls.push(`${u.pathname.split('/').pop()} ${r.postData() ?? ''}`); });
    // A cold /you: this document's record has never read C2.
    await page.goto('/you');
    const t = await settledText(page, 'wsf-you', fx.A1.title);
    note('Q2 You text', t.replace(/\s+/g, ' ').slice(0, 900));
    note('Q2 callables', calls.map((c) => c.replace(/"(w7c50[^"]*)"/g, (_m, id: string) => (id.includes('c2') || id.includes('B1') ? '"C2…"' : '"C1…"'))));
    pv('Q-P4 nothing of the other community is invented', !t.includes(fx.B1.title) && !t.includes('laps'));
    fb('Q-F4 the list says it is partial', /could not be loaded|may be short|partial|may not be everything/i.test(t), t.replace(/\s+/g, ' ').slice(0, 300));
    pv('Q-P5 no read is fanned out to the other community', !calls.some((c) => c.includes(fx.c2.id) || c.includes(fx.B1.id)), calls.length);
    report('Q2 You partial', out);
  });

  test('Q3 You and Progress write the period in the goal’s own time zone', async ({ page }) => {
    test.setTimeout(180_000);
    const { out, fb } = rows();
    const s = stampId();
    const m = await person('q3m', `Tomo Zone ${s.slice(-4)}`);
    const o = await person('q3o', `Olu Champion ${s.slice(-4)}`);
    const c = { id: `w7c50z-${s}`, name: `W7 Tokyo Movers ${s.slice(-4)}` };
    await community(c.id, c.name, o.uid, [m.uid]);
    // 20:00 UTC, six days out: the next calendar day in Tokyo.
    const end = new Date(Date.now() + 6 * DAY); end.setUTCHours(20, 0, 0, 0);
    const Z: G = { id: `w7c50Z-${s}`, title: `Tokyo Squats ${s.slice(-4)}`, unit: 'squats', target: 400, shared: 60, own: 9, open: true, endsAt: end, tz: 'Asia/Tokyo' };
    // A sooner goal leads on You, so the zoned goal is a secondary row there: the accepted
    // You view writes a period on its secondary rows only, never on the lead card.
    const L: G = { id: `w7c50L-${s}`, title: `Tokyo Lead ${s.slice(-4)}`, unit: 'minutes', target: 100, shared: 20, own: 4, open: true, endsAt: inDays(2.3) };
    await goal(c.id, o.uid, m.uid, Z);
    await goal(c.id, o.uid, m.uid, L);
    const want = endsLabel(end, 'Asia/Tokyo'), utc = endsLabel(end, 'UTC');
    await page.goto('/');
    await remember(page, m.uid, c.id);
    await signInVia(page, m.email, m.password);
    await expect(page.locator('[data-testid="wsf-community"]:visible').first()).toContainText(Z.title, { timeout: 40_000 });
    await page.goto('/you');
    const tYou = await settledText(page, 'wsf-you', Z.title);
    await page.goto('/activity');
    const tProg = await settledText(page, 'wsf-activity', Z.title);
    note('Q3 labels', { want, utc, you: after(tYou, Z.title).replace(/\s+/g, ' '), progress: after(tProg, Z.title).replace(/\s+/g, ' ') });
    fb('Q-F6 You: a secondary row’s period is written in the goal’s zone', after(tYou, Z.title).includes(want) && !tYou.includes(utc), { want, utc });
    fb('Q-F7 Progress: the period is written in the goal’s zone', tProg.includes(want) && !tProg.includes(utc), { want, utc });
    report('Q3 period in the goal zone', out);
  });

  test('Q4 Progress names the member once the account has read the profile (warm, after You)', async ({ page }) => {
    test.setTimeout(180_000);
    const { out, fb } = rows();
    const fx = await twoCommunities('q4');
    await page.goto('/');
    await remember(page, fx.m.uid, fx.c1.id);
    await signInVia(page, fx.m.email, fx.m.password);
    await expect(page.locator('[data-testid="wsf-community"]:visible').first()).toContainText(fx.A1.title, { timeout: 40_000 });
    await page.locator('[data-testid="wsf-member-tab-you"]:visible').first().click();
    await settledText(page, 'wsf-you', fx.A1.title);
    await page.locator('[data-testid="wsf-member-tab-activity"]:visible').first().click();
    const t = await settledText(page, 'wsf-activity', fx.A1.title);
    const name = 'mara route'; // the hero upper-cases it: compare without case
    note('Q4 Progress hero (warm)', t.replace(/\s+/g, ' ').slice(0, 200));
    fb('Q-F5 warm: the private hero names the member', t.slice(0, 200).toLowerCase().includes(name), t.replace(/\s+/g, ' ').slice(0, 120));
    report('Q4 Progress name warm', out);
  });
});
