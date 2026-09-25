import { expect, test, type Page, type Request } from '@playwright/test';

import {
  FIRESTORE_EMULATOR,
  PROJECT_ID,
  seedCommunity,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * W7 — CHECK 38: independent focused check of W6's MOVEMENT-PILLS-1 (#483),
 * exact `eeb5eed02d1f8f3beb1ee9a4c5368f575de98527` (L0 #434 `5836118476`;
 * Director `5836100138`, clarification `5836170056`).
 *
 *   M1  single choice: Squats then Push-ups REPLACES; exactly one radio checked;
 *       one wsfCreateGoal with push-ups' own unit and guide key; both read back
 *       from the emulator, then after a reload in the product (community total
 *       unit and the contribution screen's counting guide).
 *   M2  unsupported multi / mixed state: INJECTED through the picker's own
 *       onChange (a state the rendered single-choice route cannot reach). The
 *       reason is on screen, submit is off, a forced press and the submit
 *       handler itself send nothing. On `03cfddba` the same selection was a real
 *       journey and sent the joined unit (fail-before, W7_LABEL=03cfddba).
 *   M3  Something else: reachable after a movement, restores the typed draft
 *       across toggling, >= 44 px, and a typed unit sends no guide key.
 *   M4  keyboard and semantics: Tab reaches every pill and Something else,
 *       Space selects, aria-checked, roles and accessible names.
 *   M5  390x640: goal phrase, last pill row and primary action reachable by
 *       ordinary page scrolling.
 * Synthetic accounts; emulators only (demo-wsf-local).
 */

const BASE = process.env.WSF_PLAYWRIGHT_BASE_URL;
const LABEL = process.env.W7_LABEL ?? 'head';
test.skip(!BASE, 'Set WSF_PLAYWRIGHT_BASE_URL to the emulator-flagged build under test.');

const TITLE = 'W7 movement check';
type Fx = { email: string; password: string; groupId: string };

async function seedChampion(tag: string): Promise<Fx> {
  const stamp = stampId();
  const email = `w7c38.${tag}.${stamp}@example.invalid`;
  const password = 'w7-movement-passw0rd';
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, `W7 Champion ${stamp}`);
  const groupId = `w7c38${tag}_${stamp}`;
  await seedCommunity({ groupId, displayName: 'Harbor Walkers', joinPolicy: 'private', members: [{ uid, role: 'foundingChampion' }] });
  return { email, password, groupId };
}

async function openForm(page: Page, fx: Fx): Promise<void> {
  await signInVia(page, fx.email, fx.password);
  await page.goto(`/community/${fx.groupId}`);
  await expect(page.getByTestId('wsf-community-no-goal')).toBeVisible({ timeout: 25_000 });
  await page.getByTestId('wsf-community-start-goal').click();
  await page.waitForURL(/\/goals\/new/, { timeout: 20_000 });
  await expect(page.getByTestId('wsf-new-goal-form')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-new-goal-title').fill(TITLE);
  await page.getByTestId('wsf-new-goal-target').fill('1200');
}

function watchCreateGoal(page: Page): Array<Record<string, unknown>> {
  const sent: Array<Record<string, unknown>> = [];
  page.on('request', (req: Request) => {
    if (req.method() === 'POST' && req.url().includes('/wsfCreateGoal')) {
      sent.push(((req.postDataJSON() as { data?: Record<string, unknown> } | null)?.data) ?? {});
    }
  });
  return sent;
}

type Fields = Record<string, { stringValue?: string; integerValue?: string }>;
async function goalsIn(groupId: string): Promise<Array<{ id: string; f: Fields }>> {
  const res = await fetch(`${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`, {
    method: 'POST',
    headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'wsfGoals' }], where: { fieldFilter: { field: { fieldPath: 'communityGroupId' }, op: 'EQUAL', value: { stringValue: groupId } } } } }),
  });
  const rows = (await res.json()) as Array<{ document?: { name: string; fields: Fields } }>;
  return rows.filter((r) => r.document).map((r) => ({ id: r.document!.name.split('/').pop()!, f: r.document!.fields }));
}

const pill = (page: Page, key: string) => page.getByTestId(`wsf-new-goal-movements-${key}`);
const KEYS = ['squats', 'push-ups', 'sit-ups', 'steps', 'laps'];

async function checkedPills(page: Page): Promise<string[]> {
  const on: string[] = [];
  for (const k of [...KEYS, 'something-else']) {
    if (!(await pill(page, k).count())) continue; // absent on builds without that pill
    if ((await pill(page, k).getAttribute('aria-checked', { timeout: 2_000 }).catch(() => null)) === 'true') on.push(k);
  }
  return on;
}

function measure(label: string, value: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`MEASURE ${label}: ${JSON.stringify(value)}`);
  test.info().annotations.push({ type: 'measure', description: `${label}: ${JSON.stringify(value)}` });
}

/**
 * INJECTED STATE. Find the React component that owns `testId`'s DOM node and
 * call a function prop on it. Used only to put the route into a selection the
 * rendered single-choice picker cannot produce, and to press a disabled submit.
 */
async function callProp(page: Page, testId: string, prop: string, arg?: unknown): Promise<string> {
  return page.evaluate(
    ([tid, name, a]) => {
      const el = document.querySelector(`[data-testid="${tid}"]`);
      if (!el) return 'no element';
      const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
      if (!key) return 'no fiber';
      for (let f = (el as unknown as Record<string, { return: unknown; memoizedProps?: Record<string, unknown> }>)[key]; f; f = f.return as typeof f) {
        const fn = f.memoizedProps?.[name as string];
        if (typeof fn === 'function') {
          (fn as (x?: unknown) => void)(a);
          return 'called';
        }
      }
      return 'no prop';
    },
    [testId, prop, arg] as const,
  );
}

test.describe(`W7 Check 38 · MOVEMENT-PILLS-1 (${LABEL})`, () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('M1 single choice: a second pick replaces the first; one request; read back', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await seedChampion('m1');
    const sent = watchCreateGoal(page);
    await openForm(page, fx);
    await pill(page, 'squats').click({ timeout: 10_000 });
    await pill(page, 'push-ups').click({ timeout: 10_000 });
    const checked = await checkedPills(page);
    const role = await page.getByTestId('wsf-new-goal-movements').getAttribute('role', { timeout: 2_000 }).catch(() => null);
    measure('M1 after Squats then Push-ups', { checked, role, chosen: await page.getByTestId('wsf-new-goal-unit-chosen').innerText({ timeout: 2_000 }).catch(() => null) });
    expect(checked, 'exactly the second pick is checked').toEqual(['push-ups']);
    const submit = page.getByTestId('wsf-new-goal-submit');
    await submit.scrollIntoViewIfNeeded();
    await submit.click();
    const created = page.getByTestId('wsf-new-goal-created');
    await expect(created).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1_000);
    const goals = await goalsIn(fx.groupId);
    measure('M1 request and server', { requests: sent, goals: goals.map((g) => ({ unit: g.f.unit?.stringValue, activityGuideKey: g.f.activityGuideKey?.stringValue ?? null })) });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ unit: 'push-ups', activityGuideKey: 'push-ups' });
    expect(goals).toHaveLength(1);
    expect(goals[0]!.f.unit?.stringValue).toBe('push-ups');
    expect(goals[0]!.f.activityGuideKey?.stringValue).toBe('push-ups');
    // Read back in the product after a reload: the community's goal and the contribution screen's guide.
    await page.goto(`/community/${fx.groupId}`);
    await page.reload();
    const total = page.locator(`[data-testid="wsf-community-goal-total-${goals[0]!.id}"]:visible`).first();
    await expect(total).toBeVisible({ timeout: 40_000 });
    const totalText = await total.innerText();
    await page.goto(`/contribute/${goals[0]!.id}?groupId=${fx.groupId}`);
    const guide = page.locator('[data-testid="wsf-contribute-guide"]:visible').first();
    await expect(guide).toBeVisible({ timeout: 40_000 });
    const toggle = page.locator('[data-testid="wsf-contribute-guide-toggle"]:visible').first();
    if (await toggle.count()) await toggle.click().catch(() => undefined);
    await page.waitForTimeout(500);
    const guideText = (await guide.innerText()).replace(/\s+/g, ' ').slice(0, 300);
    measure('M1 read back after reload', { communityTotal: totalText, guide: guideText });
    expect(totalText).toContain('push-ups');
    expect(guideText.toLowerCase()).toContain('push-up');
  });

  test('M2 unsupported several / mixed state (INJECTED): reason shown, nothing sent', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await seedChampion('m2');
    const sent = watchCreateGoal(page);
    await openForm(page, fx);
    const rows: Record<string, unknown> = {};
    for (const [name, sel] of [
      ['several', ['squats', 'push-ups']],
      ['mixed', ['squats', 'steps']],
    ] as const) {
      const inj = await callProp(page, 'wsf-new-goal-movements', 'onChange', sel);
      await page.waitForTimeout(400);
      const blocked = page.locator('[data-testid="wsf-new-goal-movements-blocked"]:visible, [data-testid="wsf-new-goal-movements-mixed"]:visible').first();
      const reason = await blocked.innerText({ timeout: 3_000 }).catch(() => null);
      const submit = page.getByTestId('wsf-new-goal-submit');
      await submit.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => undefined);
      const disabled = await submit.getAttribute('aria-disabled', { timeout: 2_000 }).catch(() => null);
      await submit.click({ force: true, timeout: 5_000 }).catch(() => undefined);
      await page.waitForTimeout(1_500);
      const afterForced = sent.length;
      // The submit handler itself, bypassing the disabled control (INJECTED).
      const pressed = await callProp(page, 'wsf-new-goal-submit', 'onPress');
      await page.waitForTimeout(2_000);
      const unitError = await page.locator('[data-testid="wsf-new-goal-unit-error"]:visible').first().innerText({ timeout: 2_000 }).catch(() => null);
      rows[name] = { injection: inj, checked: await checkedPills(page), reason, submitAriaDisabled: disabled, requestsAfterForcedClick: afterForced, handlerCall: pressed, requestsAfterHandler: sent.length, unitError, bodies: sent.map((b) => ({ unit: b.unit, activityGuideKey: b.activityGuideKey })) };
    }
    measure(`M2 injected state (${LABEL})`, rows);
    expect(sent, 'nothing is sent for a selection the contract cannot persist').toHaveLength(0);
  });

  test('M2r the same selection by real clicks (a live journey only on builds whose picker allows several)', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await seedChampion('m2r');
    const sent = watchCreateGoal(page);
    await openForm(page, fx);
    await pill(page, 'squats').click({ timeout: 10_000 });
    await pill(page, 'push-ups').click({ timeout: 10_000 });
    const checked = await checkedPills(page);
    const submit = page.getByTestId('wsf-new-goal-submit');
    await submit.scrollIntoViewIfNeeded();
    await submit.click({ timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(3_000);
    const goals = await goalsIn(fx.groupId);
    measure(`M2r real clicks Squats + Push-ups (${LABEL})`, { checked, requests: sent.map((b) => ({ unit: b.unit, activityGuideKey: b.activityGuideKey })), goals: goals.map((g) => ({ unit: g.f.unit?.stringValue, activityGuideKey: g.f.activityGuideKey?.stringValue ?? null })) });
    // Whatever was sent names exactly one movement with its own guide.
    for (const b of sent) {
      expect(String(b.unit), 'a joined unit was sent').not.toContain('+');
      expect(b.activityGuideKey, 'a generic guide key was sent').not.toBe('reps');
    }
  });

  test('M3 Something else: reachable after a movement, draft kept across toggling, >= 44 px, typed unit sends no guide', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await seedChampion('m3');
    const sent = watchCreateGoal(page);
    await openForm(page, fx);
    await page.getByTestId('wsf-new-goal-unit').fill('burpees');
    const trace: Array<Record<string, unknown>> = [];
    for (const key of ['laps', 'something-else', 'squats', 'sit-ups', 'something-else']) {
      await pill(page, key).click();
      await page.waitForTimeout(200);
      trace.push({
        pressed: key,
        checked: await checkedPills(page),
        field: await page.getByTestId('wsf-new-goal-unit').inputValue({ timeout: 1_000 }).catch(() => '(hidden)'),
        chosen: await page.getByTestId('wsf-new-goal-unit-chosen').innerText({ timeout: 1_000 }).catch(() => null),
        phrase: await page.getByTestId('wsf-new-goal-definition').innerText({ timeout: 1_000 }).catch(() => null),
      });
    }
    await pill(page, 'squats').click();
    const se = pill(page, 'something-else');
    await se.scrollIntoViewIfNeeded();
    const box = await se.boundingBox();
    const hit = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="wsf-new-goal-movements-something-else"]')!;
      const b = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2));
    });
    await se.click();
    const submit = page.getByTestId('wsf-new-goal-submit');
    await submit.scrollIntoViewIfNeeded();
    await submit.click();
    await expect(page.getByTestId('wsf-new-goal-created')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);
    const goals = await goalsIn(fx.groupId);
    measure('M3 Something else', { trace, box, reachableAtCentre: hit, requests: sent, goals: goals.map((g) => ({ unit: g.f.unit?.stringValue, activityGuideKey: g.f.activityGuideKey?.stringValue ?? null })) });
    expect(trace.filter((t) => t.pressed === 'something-else').every((t) => t.field === 'burpees')).toBe(true);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(hit).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.unit).toBe('burpees');
    expect('activityGuideKey' in sent[0]!).toBe(false);
    expect(goals[0]!.f.activityGuideKey).toBeUndefined();
  });

  test('M4 keyboard and semantics', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await seedChampion('m4');
    await openForm(page, fx);
    const names: Record<string, unknown> = {};
    for (const [k, n] of [['squats', 'Squats'], ['push-ups', 'Push-ups'], ['sit-ups', 'Sit-ups'], ['steps', 'Steps'], ['laps', 'Laps'], ['something-else', 'Something else']]) {
      names[k] = await page.getByRole('radio', { name: n, exact: true }).count();
    }
    const group = await page.getByRole('radiogroup', { name: 'Movements' }).count();
    await page.getByTestId('wsf-new-goal-target').focus();
    const order: string[] = [];
    for (let i = 0; i < 14; i += 1) {
      await page.keyboard.press('Tab');
      order.push(await page.evaluate(() => (document.activeElement?.closest('[data-testid]') as HTMLElement | null)?.getAttribute('data-testid') ?? document.activeElement?.tagName ?? 'none'));
    }
    await pill(page, 'sit-ups').focus();
    await page.keyboard.press('Space');
    const afterSpace = await checkedPills(page);
    await pill(page, 'something-else').focus();
    await page.keyboard.press('Space');
    const afterSpaceSE = await checkedPills(page);
    measure('M4 keyboard', { radiosByName: names, radiogroupNamedMovements: group, tabOrder: order, afterSpaceOnSitUps: afterSpace, afterSpaceOnSomethingElse: afterSpaceSE });
    for (const k of [...KEYS, 'something-else']) expect(order, `Tab reaches ${k}`).toContain(`wsf-new-goal-movements-${k}`);
    expect(Object.values(names).every((v) => v === 1)).toBe(true);
    expect(group).toBe(1);
    expect(afterSpace).toEqual(['sit-ups']);
    expect(afterSpaceSE).toEqual(['something-else']);
  });

  test('M5 390x640: phrase, last pill row and primary action reachable by page scrolling', async ({ browser }) => {
    test.setTimeout(200_000);
    const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 640 } });
    const page = await ctx.newPage();
    const fx = await seedChampion('m5');
    await openForm(page, fx);
    await pill(page, 'steps').click();
    const probe = async (id: string) =>
      page.evaluate((tid) => {
        const el = Array.from(document.querySelectorAll(`[data-testid="${tid}"]`)).find((e) => e.getBoundingClientRect().height > 0);
        if (!el) return 'absent';
        el.scrollIntoView({ block: 'center' });
        const b = el.getBoundingClientRect();
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        let scroller = 'document';
        for (let n: Element | null = el.parentElement; n; n = n.parentElement) {
          const o = getComputedStyle(n).overflowY;
          if (/(auto|scroll)/.test(o) && n.scrollHeight > n.clientHeight + 2) { scroller = (n.getAttribute('data-testid') ?? n.tagName) + ` h=${n.clientHeight}`; break; }
        }
        return `${Math.round(b.top)}-${Math.round(b.bottom)} ${el.contains(hit) ? 'reachable' : 'COVERED'} via ${scroller}`;
      }, id);
    const phraseAtOpen = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="wsf-new-goal-definition"]');
      if (!el) return 'absent';
      const b = el.getBoundingClientRect();
      return `${Math.round(b.top)}-${Math.round(b.bottom)} (viewport 640)`;
    });
    const r = {
      phraseAfterPick: phraseAtOpen,
      phrase: await probe('wsf-new-goal-definition'),
      lastPill: await probe('wsf-new-goal-movements-something-else'),
      submit: await probe('wsf-new-goal-submit'),
    };
    measure('M5 390x640', r);
    for (const v of [r.phrase, r.lastPill, r.submit]) expect(v).toContain('reachable');
    await ctx.close();
  });
});
