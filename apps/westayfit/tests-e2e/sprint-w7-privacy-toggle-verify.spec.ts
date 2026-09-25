import { randomBytes } from 'node:crypto';

import { expect, test, type Page, type Route } from '@playwright/test';

import { FIRESTORE_EMULATOR, PROJECT_ID, seedProfile, seedVerifiedUser, signInVia, stampId } from './helpers/mobile';

/**
 * W7 — CHECK 43: PRIVACY-TOGGLE emulator proof on exact served build
 * `0b460ce3f2f0766406100fef14d9a444c8cad43a` (L0 #434 `5840570251`; Director
 * bug #365 `5840495639`, rows #396 `5840491600`). Emulators only
 * (demo-wsf-local); synthetic accounts; Chromium web. Transport on staging is
 * NOT measurable here: this proves everything except transport.
 *
 *   U1  FAIL-FIRST: `wsfSetCommunityVisibility` fails on the Settings privacy
 *       screen — (a) refused (INJECTED 403), (b) lost before the server
 *       (INJECTED abort), (c) landed but its reply lost (INJECTED
 *       fetch-then-abort), (d) a REAL refusal (the membership is removed on the
 *       server first). Recorded per frame: whether an error is ever painted,
 *       for how long, whether it is still visible once the switch rests on the
 *       stored value, and the switch against the stored document. The contract
 *       asserted is the Director's (a failed save keeps a visible error; the
 *       stored value is what renders), so on `0b460ce3` the error rows are
 *       EXPECTED TO FAIL: they are the fail-before for W9's cp3.
 *   U1c POSITIVE CONTROL: a persistent error (the communities read fails,
 *       INJECTED) is seen by the same instrument, so a "no error" reading is
 *       not the instrument's blindness.
 *   R   the Director's rows 1–4 and 6 through the real screen and callables:
 *       name OFF persists across a reload; name OFF + activity ON settles (an
 *       anonymous row, counted); activity OFF persists (no row, still counted);
 *       community A leaves community B unchanged; what another member reads
 *       follows the stored value; the public display paths carry no identity.
 *   R5  a nonmember's (and a signed-out) set is refused and writes nothing.
 */

const BASE = process.env.WSF_PLAYWRIGHT_BASE_URL;
const LABEL = process.env.W7_LABEL ?? 'head';
test.skip(!BASE, 'Set WSF_PLAYWRIGHT_BASE_URL to the emulator-flagged build under test.');

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FUNCTIONS_EMULATOR = 'http://127.0.0.1:5001';
const OWNER = { authorization: 'Bearer owner', 'content-type': 'application/json' };
const NAME_VIS = 'communityNameVisibility';
const ACTIVITY_VIS = 'communityActivityVisibility';

function measure(label: string, value: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`MEASURE ${label} (${LABEL}): ${JSON.stringify(value)}`);
  test.info().annotations.push({ type: 'measure', description: `${label}: ${JSON.stringify(value)}` });
}

// ── emulator helpers (the genuine callable path; fixtures by REST) ─────────

type CallResult = { ok: boolean; status: number; result?: any; code?: string };

async function idTokenFor(email: string, password: string): Promise<string> {
  const res = await fetch(`${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { idToken: string }).idToken;
}

async function call(name: string, data: unknown, idToken?: string): Promise<CallResult> {
  const res = await fetch(`${FUNCTIONS_EMULATOR}/${PROJECT_ID}/us-central1/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(idToken ? { authorization: `Bearer ${idToken}` } : {}) },
    body: JSON.stringify({ data }),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) return { ok: false, status: res.status, code: body?.error?.status, result: body?.error };
  return { ok: true, status: res.status, result: body?.result };
}

const docUrl = (p: string, q = '') => `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${p}${q}`;

async function write(docPath: string, fields: Record<string, unknown>, mask?: string[]): Promise<void> {
  const q = mask?.length ? '?' + mask.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&') : '';
  const res = await fetch(docUrl(docPath, q), { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields }) });
  if (!res.ok) throw new Error(`write ${docPath} failed: ${res.status} ${await res.text()}`);
}

/** The stored document, straight from the emulator (null when absent). */
async function readDoc(docPath: string): Promise<Record<string, any> | null> {
  const res = await fetch(docUrl(docPath), { headers: OWNER });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`read ${docPath} failed: ${res.status}`);
  return ((await res.json()) as { fields?: Record<string, any> }).fields ?? {};
}

/** A member's stored visibility in one community; an absent field is 'visible' (the product's default). */
async function stored(groupId: string, uid: string): Promise<{ name: string; activity: string; raw: { name: string | null; activity: string | null } }> {
  const f = await readDoc(`wsfMemberships/${groupId}_${uid}`);
  const rawName = f?.[NAME_VIS]?.stringValue ?? null;
  const rawActivity = f?.[ACTIVITY_VIS]?.stringValue ?? null;
  return { name: rawName ?? 'visible', activity: rawActivity ?? 'visible', raw: { name: rawName, activity: rawActivity } };
}

const ts = (d: Date) => ({ timestampValue: d.toISOString() });

type Person = { uid: string; email: string; password: string; name: string; token: string };

async function person(tag: string, name: string): Promise<Person> {
  const email = `wsf-w7c43-${tag}-${stampId()}@example.com`;
  const password = `Aa1!${randomBytes(6).toString('hex')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, name);
  return { uid, email, password, name, token: await idTokenFor(email, password) };
}

async function communityDoc(groupId: string, displayName: string, createdBy: string): Promise<void> {
  const now = new Date();
  await write(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: displayName },
    groupType: { stringValue: 'custom' },
    joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: `JOIN${randomBytes(4).toString('hex')}` },
    createdByUserId: { stringValue: createdBy },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
    createdAt: ts(now),
    updatedAt: ts(now),
  });
}

async function membership(groupId: string, uid: string, role: 'foundingChampion' | 'member'): Promise<void> {
  const now = new Date();
  await write(`wsfMemberships/${groupId}_${uid}`, {
    groupId: { stringValue: groupId },
    userId: { stringValue: uid },
    role: { stringValue: role },
    membershipStatus: { stringValue: 'active' },
    createdAt: ts(now),
    updatedAt: ts(now),
  });
}

async function goalDoc(goalId: string, groupId: string, ownerUid: string): Promise<void> {
  const now = Date.now();
  await write(`wsfGoals/${goalId}`, {
    ownerUid: { stringValue: ownerUid },
    communityGroupId: { stringValue: groupId },
    title: { stringValue: 'W7 privacy goal' },
    target: { integerValue: '500' },
    unit: { stringValue: 'squats' },
    status: { stringValue: 'active' },
    startsAt: ts(new Date(now - 7 * 864e5)),
    endsAt: ts(new Date(now + 7 * 864e5)),
    timezone: { stringValue: 'UTC' },
    aggregateDisplayAuthorized: { booleanValue: true },
    createdAt: ts(new Date(now)),
    updatedAt: ts(new Date(now)),
  });
}

async function contribution(groupId: string, goalId: string, userId: string, count: number): Promise<void> {
  await write(`wsfContributions/w7c43-${stampId()}`, {
    communityGroupId: { stringValue: groupId },
    goalId: { stringValue: goalId },
    userId: { stringValue: userId },
    count: { integerValue: String(count) },
    unit: { stringValue: 'squats' },
    createdAt: ts(new Date(Date.now() - 60_000)),
  });
}

type Fx = { m: Person; o: Person; n: Person; a: string; b: string; goalA: string };

/** M (the member who toggles) and O (the Champion who looks) share communities A and B; N shares neither. */
async function fixture(tag: string): Promise<Fx> {
  const s = stampId();
  const m = await person(`${tag}m`, `Mara Toggle ${s.slice(-4)}`);
  const o = await person(`${tag}o`, `Olu Viewer ${s.slice(-4)}`);
  const n = await person(`${tag}n`, `Nia Outsider ${s.slice(-4)}`);
  const a = `w7c43a-${s}${tag}`;
  const b = `w7c43b-${s}${tag}`;
  await communityDoc(a, 'W7 Harbor Movers', o.uid);
  await communityDoc(b, 'W7 Summit Walkers', o.uid);
  for (const g of [a, b]) {
    await membership(g, o.uid, 'foundingChampion');
    await membership(g, m.uid, 'member');
  }
  const goalA = `w7c43g-${s}${tag}`;
  await goalDoc(goalA, a, o.uid);
  await contribution(a, goalA, m.uid, 15);
  await contribution(a, goalA, o.uid, 10);
  return { m, o, n, a, b, goalA };
}

/** What another member (O) reads about M in community `g`. */
async function othersView(fx: Fx, g: string) {
  const members = await call('wsfCommunityMembers', { groupId: g }, fx.o.token);
  const mine = await call('wsfMyCommunities', {}, fx.o.token);
  const out: Record<string, unknown> = {
    membersOk: members.ok,
    mNamedInMembers: members.ok ? (members.result.members as { displayName: string }[]).some((x) => x.displayName === fx.m.name) : null,
    memberCount: mine.ok ? (mine.result.items as { groupId: string; memberCount: number }[]).find((c) => c.groupId === g)?.memberCount ?? null : null,
    uidInPayload: JSON.stringify(members.result ?? {}).includes(fx.m.uid),
  };
  if (g === fx.a) {
    const act = await call('wsfCommunityActivity', { groupId: g, goalId: fx.goalA }, fx.o.token);
    const entries = (act.result?.entries ?? []) as { displayName: string | null; count?: number; amount?: number }[];
    out.activityOk = act.ok;
    out.activityEntries = entries.map((e) => e.displayName === fx.m.name ? 'M (named)' : e.displayName === fx.o.name ? 'O (named)' : e.displayName === null ? 'anonymous' : `other:${e.displayName}`);
    out.contributorsToday = act.result?.contributorsToday ?? null;
    out.activityUid = JSON.stringify(act.result ?? {}).includes(fx.m.uid);
  }
  return out;
}

// ── the screen ─────────────────────────────────────────────────────────────

/** Per-frame record of the error line, the loading line and every switch. */
function recorder() {
  type Ev = { k: string; id: string; t: number; v?: string };
  const W = { ev: [] as Ev[], last: {} as Record<string, string> };
  (window as unknown as { __w7p: typeof W }).__w7p = W;
  const vis = (el: Element | null) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const tick = () => {
    const t = Date.now();
    const obs: Record<string, string> = {};
    const err = document.querySelector('[data-testid="wsf-privacy-error"]');
    obs['error'] = vis(err) ? `shown:${(err as HTMLElement).innerText.trim().slice(0, 120)}` : 'none';
    obs['loading'] = vis(document.querySelector('[data-testid="wsf-privacy-loading"]')) ? 'shown' : 'none';
    for (const el of Array.from(document.querySelectorAll('[data-testid^="wsf-privacy-name-"], [data-testid^="wsf-privacy-activity-"]'))) {
      const input = el.querySelector('input') as HTMLInputElement | null;
      obs[el.getAttribute('data-testid') as string] = input ? (input.checked ? 'on' : 'off') : (el.getAttribute('aria-checked') ?? '?');
    }
    for (const [id, v] of Object.entries(obs)) if (W.last[id] !== v) { W.last[id] = v; W.ev.push({ k: 'state', id, v, t }); }
    requestAnimationFrame(tick);
  };
  if (document.documentElement) requestAnimationFrame(tick);
  else addEventListener('DOMContentLoaded', () => requestAnimationFrame(tick));
}
type PEv = { k: string; id: string; t: number; v?: string };
const events = (page: Page) => page.evaluate(() => (window as unknown as { __w7p: { ev: PEv[] } }).__w7p.ev);

const sw = (page: Page, kind: 'name' | 'activity', g: string) => page.locator(`[data-testid="wsf-privacy-${kind}-${g}"]`).first();
async function switchState(page: Page, kind: 'name' | 'activity', g: string): Promise<'on' | 'off' | 'absent'> {
  const loc = sw(page, kind, g);
  if (!(await loc.count())) return 'absent';
  return (await loc.evaluate((el) => {
    const i = el.querySelector('input') as HTMLInputElement | null;
    return i ? (i.checked ? 'on' : 'off') : el.getAttribute('aria-checked') === 'true' ? 'on' : 'off';
  })) as 'on' | 'off';
}
async function flip(page: Page, kind: 'name' | 'activity', g: string): Promise<void> {
  const input = sw(page, kind, g).locator('input');
  if (await input.count()) await input.first().click({ timeout: 10_000, force: true });
  else await sw(page, kind, g).click({ timeout: 10_000 });
}
async function openPrivacy(page: Page, fx: Fx): Promise<void> {
  await page.goto('/settings/privacy');
  await expect(sw(page, 'name', fx.a)).toBeVisible({ timeout: 40_000 });
  await expect(sw(page, 'name', fx.b)).toBeVisible({ timeout: 40_000 });
  await page.waitForTimeout(600);
}
const errorVisible = async (page: Page) => (await page.locator('[data-testid="wsf-privacy-error"]:visible').count()) > 0;

/** Summarise the per-frame record from `since`: error paint spans and switch transitions. */
function summarise(ev: PEv[], since: number, settleAt: number) {
  const after = ev.filter((e) => e.t >= since);
  const spans: string[] = [];
  let open: PEv | null = null;
  for (const e of after.filter((x) => x.id === 'error')) {
    if (e.v !== 'none' && !open) open = e;
    if (e.v === 'none' && open) { spans.push(`+${open.t - since}..+${e.t - since}ms (${e.t - open.t}ms) "${open.v!.slice(6)}"`); open = null; }
  }
  if (open) spans.push(`+${open.t - since}..still shown "${open.v!.slice(6)}"`);
  return {
    errorSpans: spans,
    errorEverPainted: spans.length > 0,
    loadingFlashes: after.filter((e) => e.id === 'loading' && e.v === 'shown').map((e) => `+${e.t - since}`),
    switchTimeline: after.filter((e) => e.id.startsWith('wsf-privacy-')).map((e) => `+${e.t - since} ${e.id.replace(/-w7c43a-.*/, '-A').replace(/-w7c43b-.*/, '-B')}=${e.v}`),
    settleAfterMs: settleAt - since,
  };
}

// ═══════════════════════════════════════════════════════════════════════════

test.describe(`W7 Check 43 · PRIVACY-TOGGLE (${LABEL})`, () => {
  for (const mode of ['refused', 'lost', 'landButDrop', 'realRefusal'] as const) {
    test(`U1 fail-first: a failed save (${mode}) — is the error still shown once the switch rests on the stored value?`, async ({ page }) => {
      test.setTimeout(180_000);
      const fx = await fixture(`u${mode.slice(0, 4)}`);
      await page.addInitScript(recorder);
      const g = mode === 'realRefusal' ? fx.b : fx.a;
      let hits = 0;
      if (mode !== 'realRefusal') {
        await page.route('**/wsfSetCommunityVisibility', async (route: Route) => {
          hits += 1;
          if (mode === 'refused') {
            // INJECTED: the server's refusal shape for a refused set.
            return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":{"status":"PERMISSION_DENIED","message":"You are not an active member of this community."}}' });
          }
          if (mode === 'lost') return route.abort('failed'); // INJECTED: never reaches the server
          const res = await route.fetch(); // INJECTED: the write lands ...
          void res;
          return route.abort('failed'); // ... and its reply is lost
        });
      }
      const answers: string[] = [];
      page.on('requestfinished', async (q) => {
        if (!q.url().includes('wsfSetCommunityVisibility')) return;
        const res = await q.response().catch(() => null);
        answers.push(`${res?.status() ?? 'no response'} ${((await res?.text().catch(() => '')) ?? '').slice(0, 140)}`);
      });
      page.on('requestfailed', (q) => { if (q.url().includes('wsfSetCommunityVisibility')) answers.push(`failed: ${q.failure()?.errorText}`); });
      await signInVia(page, fx.m.email, fx.m.password);
      await openPrivacy(page, fx);
      const before = await stored(g, fx.m.uid);
      const uiBefore = await switchState(page, 'name', g);
      if (mode === 'realRefusal') {
        // REAL: the membership is removed on the server after the screen has read it.
        await write(`wsfMemberships/${g}_${fx.m.uid}`, { membershipStatus: { stringValue: 'removed' } }, ['membershipStatus']);
      }
      const since = Date.now();
      await flip(page, 'name', g);
      await page.waitForTimeout(3_000);
      const settleAt = Date.now();
      const after = await stored(g, fx.m.uid);
      const uiAfter = await switchState(page, 'name', g);
      const s = summarise(await events(page), since, settleAt);
      const errorAtSettle = await errorVisible(page);
      const r = {
        mode,
        injectedHits: hits,
        setterAnswers: answers,
        storedBefore: before.raw,
        storedAfter: after.raw,
        switchBefore: uiBefore,
        switchAtSettle: uiAfter,
        switchEqualsStored: uiAfter === 'absent' ? 'row gone' : uiAfter === (after.name === 'visible' ? 'on' : 'off'),
        errorVisibleAtSettle: errorAtSettle,
        ...s,
      };
      measure(`U1 ${mode}`, r);
      // The Director's contract. On 0b460ce3 the error rows are the fail-before.
      if (uiAfter !== 'absent') expect.soft(r.switchEqualsStored, 'the switch shows the stored value').toBe(true);
      expect.soft(errorAtSettle, 'a failed save keeps a visible error once the switch is back on the stored value').toBe(true);
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    });
  }

  test('U1c positive control: a persistent error is seen by the same instrument', async ({ page }) => {
    test.setTimeout(120_000);
    const fx = await fixture('uctl');
    await page.addInitScript(recorder);
    await signInVia(page, fx.m.email, fx.m.password);
    await page.route('**/wsfMyCommunities', (route: Route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"status":"INTERNAL","message":"injected"}}' })); // INJECTED
    const since = Date.now();
    await page.goto('/settings/privacy');
    await page.waitForTimeout(4_000);
    const s = summarise(await events(page), since, Date.now());
    const r = { errorVisibleAtSettle: await errorVisible(page), ...s };
    measure('U1c control', r);
    expect(r.errorVisibleAtSettle, 'the instrument sees a persistent error').toBe(true);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('R rows 1–4 and 6: name OFF, name OFF + activity ON, activity OFF, A leaves B, what others read, public paths', async ({ page, browser }) => {
    test.setTimeout(300_000);
    const fx = await fixture('rows');
    await page.addInitScript(recorder);
    const sets: string[] = [];
    page.on('request', (q) => { if (q.url().includes('wsfSetCommunityVisibility')) sets.push(q.postData() ?? ''); });
    await signInVia(page, fx.m.email, fx.m.password);
    await openPrivacy(page, fx);
    const initial = { a: await stored(fx.a, fx.m.uid), b: await stored(fx.b, fx.m.uid), others: await othersView(fx, fx.a) };
    measure('R0 initial (defaults)', { storedA: initial.a.raw, storedB: initial.b.raw, uiA: [await switchState(page, 'name', fx.a), await switchState(page, 'activity', fx.a)], others: initial.others });
    expect(initial.others.mNamedInMembers, 'fixture: M named by default').toBe(true);

    const snapshot = async (label: string) => {
      const sa = await stored(fx.a, fx.m.uid);
      const sb = await stored(fx.b, fx.m.uid);
      const ui = {
        aName: await switchState(page, 'name', fx.a), aActivity: await switchState(page, 'activity', fx.a),
        bName: await switchState(page, 'name', fx.b), bActivity: await switchState(page, 'activity', fx.b),
      };
      const notes = {
        anonymousNoteA: await page.locator(`[data-testid="wsf-privacy-note-${fx.a}"]:visible`).count(),
        offNoteA: (await page.locator(`[data-testid="wsf-privacy-note-off-${fx.a}"]:visible`).first().innerText({ timeout: 1_000 }).catch(() => '')) || null,
      };
      const r = { storedA: sa.raw, storedB: sb.raw, ui, notes, othersA: await othersView(fx, fx.a), othersB: await othersView(fx, fx.b), error: await errorVisible(page) };
      measure(label, r);
      expect.soft(ui.aName, `${label}: A name switch = stored`).toBe(sa.name === 'visible' ? 'on' : 'off');
      expect.soft(ui.aActivity, `${label}: A activity switch = stored`).toBe(sa.activity === 'visible' ? 'on' : 'off');
      expect.soft(ui.bName, `${label}: B name switch = stored`).toBe(sb.name === 'visible' ? 'on' : 'off');
      expect.soft(ui.bActivity, `${label}: B activity switch = stored`).toBe(sb.activity === 'visible' ? 'on' : 'off');
      return { sa, sb, r };
    };

    // Row 1 + 3: name OFF (activity stays ON) → settle, then reload.
    await flip(page, 'name', fx.a);
    await page.waitForTimeout(2_500);
    await snapshot('R1/R3 name OFF, settled');
    await openPrivacy(page, fx);
    const r1 = await snapshot('R1/R3 name OFF, after reload');
    expect.soft(r1.sa.raw.name, 'row 1: name OFF persisted').toBe('private');
    expect.soft(r1.r.othersA.mNamedInMembers, 'row 1: M no longer named to others in A').toBe(false);
    expect.soft(r1.r.othersA.memberCount, 'row 1: still counted in A').toBe(2);
    expect.soft(r1.r.othersA.activityEntries, 'row 3: an anonymous row, not a missing one').toContain('anonymous');
    expect.soft(r1.r.notes.anonymousNoteA, 'row 3: the anonymous note is shown').toBe(1);
    expect.soft(r1.r.othersA.contributorsToday, 'row 3: still counted today').toBe(2);

    // Row 2: activity OFF → settle, then reload.
    await flip(page, 'activity', fx.a);
    await page.waitForTimeout(2_500);
    await openPrivacy(page, fx);
    const r2 = await snapshot('R2 activity OFF (name OFF), after reload');
    expect.soft(r2.sa.raw.activity, 'row 2: activity OFF persisted').toBe('private');
    expect.soft(r2.r.othersA.activityEntries, 'row 2: no row for M').not.toContain('anonymous');
    expect.soft(r2.r.othersA.activityEntries, 'row 2: no named row for M').not.toContain('M (named)');
    expect.soft(r2.r.othersA.contributorsToday, 'row 2: still counted today').toBe(2);

    // Row 3 again from the other side: name back ON with activity OFF.
    await flip(page, 'name', fx.a);
    await page.waitForTimeout(2_500);
    await openPrivacy(page, fx);
    const r3 = await snapshot('R3b name ON, activity OFF, after reload');
    expect.soft(r3.r.othersA.mNamedInMembers, 'the current preference is retroactive: named again').toBe(true);
    expect.soft(r3.r.othersA.activityEntries, 'activity still private').not.toContain('M (named)');

    // Row 4: B never changed.
    expect.soft(r3.sb.raw, 'row 4: B stored fields untouched').toEqual({ name: null, activity: null });
    expect.soft(r3.r.othersB.mNamedInMembers, 'row 4: M still named in B').toBe(true);
    for (const p of sets) expect.soft(JSON.parse(p).data.groupId, 'row 4: every set named A only').toBe(fx.a);
    measure('R4 set requests', sets.map((p) => JSON.parse(p).data));

    // Row 6: the public display paths carry no identity, with and without privacy.
    const pub: Record<string, unknown> = {};
    for (const name of ['wsfGoalRecentAdditions', 'wsfGoalPulse']) {
      const res = await call(name, { goalId: fx.goalA });
      const body = JSON.stringify(res.result ?? res);
      pub[name] = { ok: res.ok, mName: body.includes(fx.m.name), oName: body.includes(fx.o.name), mUid: body.includes(fx.m.uid) };
    }
    const anon = await browser.newContext({ baseURL: BASE });
    const dp = await anon.newPage();
    await dp.goto(`/display/${fx.goalA}`);
    await dp.waitForTimeout(6_000);
    const dText = await dp.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
    pub.displayPage = { chars: dText.length, mName: dText.includes(fx.m.name), oName: dText.includes(fx.o.name), sample: dText.replace(/\s+/g, ' ').slice(0, 160) };
    await anon.close();
    measure('R6 public paths', pub);
    for (const v of Object.values(pub)) {
      expect.soft((v as { mName: boolean }).mName, 'row 6: no member name on a public path').toBe(false);
      expect.soft((v as { oName: boolean }).oName, 'row 6: no member name on a public path').toBe(false);
    }
  });

  test('R5 a nonmember (and a signed-out caller) cannot set, and nothing is written', async () => {
    test.setTimeout(120_000);
    const fx = await fixture('r5');
    const before = await stored(fx.a, fx.m.uid);
    const non = await call('wsfSetCommunityVisibility', { groupId: fx.a, name: 'private' }, fx.n.token);
    const anon = await call('wsfSetCommunityVisibility', { groupId: fx.a, name: 'private' });
    const nDoc = await readDoc(`wsfMemberships/${fx.a}_${fx.n.uid}`);
    const after = await stored(fx.a, fx.m.uid);
    const nMembers = await call('wsfCommunityMembers', { groupId: fx.a }, fx.n.token);
    const r = {
      nonmember: { ok: non.ok, code: non.code, message: non.result?.message },
      signedOut: { ok: anon.ok, code: anon.code },
      nonmemberMembershipDocCreated: nDoc !== null,
      mStoredUnchanged: JSON.stringify(before.raw) === JSON.stringify(after.raw),
      nonmemberReadMembers: { ok: nMembers.ok, code: nMembers.code },
    };
    measure('R5 nonmember', r);
    expect(r.nonmember.ok, 'a nonmember set was accepted').toBe(false);
    expect(r.signedOut.code).toBe('UNAUTHENTICATED');
    expect(r.nonmemberMembershipDocCreated, 'a refused set wrote a membership row').toBe(false);
    expect(r.nonmemberReadMembers.ok, 'a nonmember read the members').toBe(false);
  });
});
