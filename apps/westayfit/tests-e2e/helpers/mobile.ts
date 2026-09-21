import { randomBytes } from 'node:crypto';

import { expect, type Browser, type BrowserContext, type CDPSession, type Page } from '@playwright/test';

/**
 * MOBILE ACCEPTANCE HELPERS (Candidate D, A4).
 *
 * Everything here exists so ui-mobile-acceptance.spec.ts can ask the question a
 * person with a phone asks — "can I actually get to the thing and press it?" —
 * without Playwright answering it for us.
 *
 * The scrolling and hit-testing techniques are ported from the Candidate C
 * scroll receipt (`scratchpad/accept-c-scroll.mjs`, labelled there and here as a
 * MECHANICAL REACHABILITY BASELINE — NOT UX ACCEPTANCE). The rules that make the
 * evidence worth anything are kept:
 *
 *   * the screen under test is never driven with `locator.click()`,
 *     `locator.fill()`, `locator.tap()` or `scrollIntoViewIfNeeded()` — each of
 *     those auto-scrolls its target into view and would hide the exact defect
 *     this suite is for;
 *   * scrolling is ONLY a CDP `Input.dispatchTouchEvent` finger drag over the
 *     page centre ("touch") or `page.mouse.wheel` over the page centre
 *     ("wheel"), in 300 px steps;
 *   * an element is interacted with ONLY once `inView()`: its box is fully
 *     inside the viewport AND `document.elementFromPoint` at its centre resolves
 *     to it or a descendant. The interaction is then `page.touchscreen.tap(x, y)`
 *     at that centre.
 *
 * Fixture steps that are NOT the screen under test (signing in) use ordinary
 * locators, exactly as the Candidate C script did.
 */

// ---------------------------------------------------------------------------
// Emulator endpoints (same project and admin bypass every other spec uses).
// ---------------------------------------------------------------------------

export const AUTH_EMULATOR = 'http://127.0.0.1:9099';
export const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
export const PROJECT_ID = 'demo-wsf-local';

// ---------------------------------------------------------------------------
// Phone contexts. All three are touch phones; two are driven by a finger drag
// and one by the wheel, so both techniques are exercised inside a touch context.
// ---------------------------------------------------------------------------

export const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

export type ScrollMethod = 'touch' | 'wheel';

export type PhoneContextDef = {
  key: string;
  label: string;
  viewport: { width: number; height: number };
  userAgent?: string;
  method: ScrollMethod;
};

export const PHONE_CONTEXTS: readonly PhoneContextDef[] = [
  {
    key: 'A',
    label: '390x844 touch, iPhone UA, finger drag',
    viewport: { width: 390, height: 844 },
    userAgent: IPHONE_UA,
    method: 'touch',
  },
  {
    key: 'B',
    label: '390x664 touch, iPhone UA (reduced visual viewport), finger drag',
    viewport: { width: 390, height: 664 },
    userAgent: IPHONE_UA,
    method: 'touch',
  },
  {
    key: 'C',
    label: '360x800 touch, wheel',
    viewport: { width: 360, height: 800 },
    method: 'wheel',
  },
];

// ---------------------------------------------------------------------------
// Fixtures. Same shapes as ui-journey.spec.ts / ui-community-home.spec.ts.
// ---------------------------------------------------------------------------

export type FirestoreValue = {
  stringValue?: string;
  integerValue?: string;
  booleanValue?: boolean;
  timestampValue?: string;
};

export function stampId(): string {
  return `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
}

export function tsField(d: Date): { timestampValue: string } {
  return { timestampValue: d.toISOString() };
}

export async function seedVerifiedUser(email: string, password: string): Promise<string> {
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

export async function firestoreWrite(
  docPath: string,
  fields: Record<string, unknown>
): Promise<void> {
  const url = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`emulator write ${docPath} failed: ${res.status} ${await res.text()}`);
}

export async function firestoreRead(docPath: string): Promise<Record<string, FirestoreValue>> {
  const url = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}`;
  const res = await fetch(url, { headers: { authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`emulator read ${docPath} failed: ${res.status}`);
  const body = (await res.json()) as { fields?: Record<string, FirestoreValue> };
  if (!body.fields) throw new Error(`emulator read ${docPath}: no fields`);
  return body.fields;
}

export async function seedProfile(uid: string, displayName: string): Promise<void> {
  const now = new Date();
  await firestoreWrite(`wsfMemberProfiles/${uid}`, {
    displayName: { stringValue: displayName },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });
}

export async function seedMembership(
  groupId: string,
  uid: string,
  role: 'foundingChampion' | 'member'
): Promise<void> {
  const now = new Date();
  await firestoreWrite(`wsfMemberships/${groupId}_${uid}`, {
    groupId: { stringValue: groupId },
    userId: { stringValue: uid },
    role: { stringValue: role },
    membershipStatus: { stringValue: 'active' },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });
}

export type CommunityFixture = { groupId: string; joinCode: string };

export async function seedCommunity(opts: {
  groupId: string;
  displayName: string;
  joinPolicy: 'public' | 'inviteOnly' | 'private';
  groupType?: 'familyFriends' | 'custom';
  members: Array<{ uid: string; role: 'foundingChampion' | 'member' }>;
}): Promise<CommunityFixture> {
  const now = new Date();
  const joinCode = randomBytes(16).toString('base64url');
  await firestoreWrite(`wsfCommunityGroups/${opts.groupId}`, {
    displayName: { stringValue: opts.displayName },
    groupType: { stringValue: opts.groupType ?? 'familyFriends' },
    joinPolicy: { stringValue: opts.joinPolicy },
    joinCode: { stringValue: joinCode },
    createdByUserId: { stringValue: opts.members[0]!.uid },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
    createdAt: tsField(new Date(now.getTime() - 40 * 24 * 60 * 60_000)),
    updatedAt: tsField(now),
  });
  for (const m of opts.members) await seedMembership(opts.groupId, m.uid, m.role);
  return { groupId: opts.groupId, joinCode };
}

/** Spreads a total across the ten counter shards the way real writes do. */
export async function seedShards(goalId: string, total: number): Promise<void> {
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

export async function seedActiveGoal(opts: {
  goalId: string;
  groupId: string;
  ownerUid: string;
  title: string;
  target: number;
  unit: string;
  total: number;
  timezone?: string;
  /** Defaults to a week out, which is what every caller before this wanted. */
  endsAt?: Date;
}): Promise<void> {
  const now = new Date();
  await firestoreWrite(`wsfGoals/${opts.goalId}`, {
    ownerUid: { stringValue: opts.ownerUid },
    communityGroupId: { stringValue: opts.groupId },
    title: { stringValue: opts.title },
    target: { integerValue: String(opts.target) },
    unit: { stringValue: opts.unit },
    status: { stringValue: 'active' },
    startsAt: tsField(new Date(now.getTime() - 7 * 24 * 60 * 60_000)),
    endsAt: tsField(opts.endsAt ?? new Date(now.getTime() + 7 * 24 * 60 * 60_000)),
    timezone: { stringValue: opts.timezone ?? 'America/New_York' },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });
  await seedShards(opts.goalId, opts.total);
}

/** Fixture sign-in. NOT a screen under test, so ordinary locators are fine. */
export async function signInVia(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/signin');
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-signin-email').fill(email);
  await page.getByTestId('wsf-signin-password').fill(password);
  await page.getByTestId('wsf-signin-submit').click();
  await page.waitForURL(/\/(profile-setup)?$/, { timeout: 20_000 });
}

// ---------------------------------------------------------------------------
// A phone run: the page, its scroll technique, and (for touch) a CDP session.
// ---------------------------------------------------------------------------

export type MobileRun = {
  key: string;
  label: string;
  method: ScrollMethod;
  page: Page;
  context: BrowserContext;
  cdp: CDPSession | null;
};

export async function openPhone(
  browser: Browser,
  def: PhoneContextDef,
  extra: { timezoneId?: string; baseURL?: string } = {}
): Promise<MobileRun> {
  const context = await browser.newContext({
    viewport: def.viewport,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
    ...(def.userAgent ? { userAgent: def.userAgent } : {}),
    ...(extra.timezoneId ? { timezoneId: extra.timezoneId } : {}),
    // Passed explicitly: a context built straight off `browser` should not have
    // to rely on the runner merging the config's `use.baseURL` into it.
    ...(extra.baseURL ? { baseURL: extra.baseURL } : {}),
  });
  const page = await context.newPage();
  const cdp = def.method === 'touch' ? await context.newCDPSession(page) : null;
  return { key: def.key, label: def.label, method: def.method, page, context, cdp };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const STEP_PX = 300;
const MAX_STEPS = 40;

// ---------------------------------------------------------------------------
// In-page measurement. Every one of these is a plain `page.evaluate` — nothing
// is installed on `window`, and nothing here moves the page.
// ---------------------------------------------------------------------------

/** How an element is named: by testID (the visible instance) or by exact leaf text. */
export type ElementSpec = { testId?: string; text?: string; nth?: number };

export type ElementState = {
  found: boolean;
  box: { x: number; y: number; w: number; h: number };
  cx: number;
  cy: number;
  inside: boolean;
  covered: boolean;
  inView: boolean;
  hit: string | null;
  scrollTop: number | null;
  vw: number;
  vh: number;
  text: string;
};

export async function elementState(page: Page, spec: ElementSpec): Promise<ElementState> {
  return page.evaluate((s: ElementSpec): ElementState => {
    const visible = (e: Element): boolean => {
      const he = e as HTMLElement;
      if (he.getClientRects().length === 0) return false;
      const cs = getComputedStyle(he);
      return cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const isScroller = (el: Element): boolean => {
      const cs = getComputedStyle(el);
      return (
        (cs.overflowY === 'auto' || cs.overflowY === 'scroll') &&
        el.scrollHeight > el.clientHeight + 1
      );
    };
    const mainScroller = (): Element | null => {
      const c = Array.from(document.querySelectorAll('*')).filter(isScroller);
      c.sort((a, b) => b.scrollHeight - a.scrollHeight);
      return c[0] ?? null;
    };
    let el: Element | null = null;
    if (s.testId) {
      const all = Array.from(document.querySelectorAll(`[data-testid="${s.testId}"]`));
      const shown = all.filter(visible);
      const pool = shown.length > 0 ? shown : all;
      el = pool[s.nth ?? 0] ?? null;
    } else if (s.text) {
      const hits = Array.from(document.querySelectorAll('body *')).filter(
        (e) => e.childElementCount === 0 && (e.textContent || '').trim() === s.text && visible(e)
      );
      el = hits[s.nth ?? 0] ?? null;
    }
    const sc = mainScroller();
    const scrollTop = sc ? sc.scrollTop : null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!el) {
      return {
        found: false,
        box: { x: 0, y: 0, w: 0, h: 0 },
        cx: 0,
        cy: 0,
        inside: false,
        covered: false,
        inView: false,
        hit: null,
        scrollTop,
        vw,
        vh,
        text: '',
      };
    }
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    const covered = !(hit && (hit === el || el.contains(hit)));
    const inside =
      r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= vh && r.left >= 0 && r.right <= vw;
    return {
      found: true,
      box: {
        x: Math.round(r.left * 10) / 10,
        y: Math.round(r.top * 10) / 10,
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
      },
      cx,
      cy,
      inside,
      covered,
      inView: inside && !covered,
      hit: hit ? hit.getAttribute('data-testid') || hit.tagName.toLowerCase() : null,
      scrollTop,
      vw,
      vh,
      text: (el.textContent || '').trim().slice(0, 160),
    };
  }, spec);
}

export async function mainScrollTop(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const isScroller = (el: Element): boolean => {
      const cs = getComputedStyle(el);
      return (
        (cs.overflowY === 'auto' || cs.overflowY === 'scroll') &&
        el.scrollHeight > el.clientHeight + 1
      );
    };
    const c = Array.from(document.querySelectorAll('*')).filter(isScroller);
    c.sort((a, b) => b.scrollHeight - a.scrollHeight);
    return c[0] ? c[0].scrollTop : null;
  });
}

/** Waits for the scroller to stop moving (no fling left), then reports where it is. */
async function settle(page: Page): Promise<number | null> {
  let last = await mainScrollTop(page);
  const started = Date.now();
  let stable = 0;
  while (Date.now() - started < 1500) {
    await sleep(70);
    const now = await mainScrollTop(page);
    if (now === last) {
      stable += 1;
      if (stable >= 2) break;
    } else {
      stable = 0;
      last = now;
    }
  }
  return last;
}

/** One finger drag, via CDP touch events. No fling: the finger rests before lifting. */
async function touchDrag(cdp: CDPSession, x: number, y0: number, y1: number): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
  const n = 6;
  for (let i = 1; i <= n; i += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y0 + ((y1 - y0) * i) / n }],
    });
    await sleep(35);
  }
  await sleep(160);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y1 }] });
  await sleep(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** Scrolls by `dy` CSS px over the page centre with the run's technique. */
async function scrollBy(run: MobileRun, dy: number): Promise<number> {
  const size = run.page.viewportSize();
  const vw = size?.width ?? 390;
  const vh = size?.height ?? 844;
  const cx = vw / 2;
  const cy = vh / 2;
  const before = (await mainScrollTop(run.page)) ?? 0;
  if (run.method === 'wheel' || !run.cdp) {
    await run.page.mouse.move(cx, cy);
    await run.page.mouse.wheel(0, dy);
  } else {
    const half = Math.min(Math.abs(dy) / 2, vh / 2 - 40);
    const y0 = dy > 0 ? cy + half : cy - half;
    const y1 = dy > 0 ? cy - half : cy + half;
    await touchDrag(run.cdp, cx, y0, y1);
  }
  const after = (await settle(run.page)) ?? 0;
  return after - before;
}

export type ReachResult = {
  /** null when the element came into view; otherwise why it did not. */
  reason: string | null;
  steps: number;
  state: ElementState;
};

/**
 * Human-style reachability: drag or wheel in 300 px steps (down when the target
 * is below the viewport, up when above) until it is fully inside the viewport
 * and nothing covers its centre. Never auto-scrolls.
 */
export async function scrollUntilVisible(
  run: MobileRun,
  spec: ElementSpec,
  name: string,
  maxSteps = MAX_STEPS
): Promise<ReachResult> {
  const { page } = run;
  let st = await elementState(page, spec);
  if (!st.found) {
    return { reason: `${name}: element not found (${JSON.stringify(spec)})`, steps: 0, state: st };
  }
  let steps = 0;
  let stuck = 0;
  while (!st.inView) {
    if (steps >= maxSteps) {
      return {
        reason: `${name}: still not in view after ${maxSteps} ${run.method} step(s) (box=${JSON.stringify(st.box)} covered=${st.covered} hit=${st.hit})`,
        steps,
        state: st,
      };
    }
    let dy: number;
    if (st.box.y < 0) dy = -STEP_PX;
    else if (st.box.y + st.box.h > st.vh) dy = STEP_PX;
    else if (st.covered) {
      dy = STEP_PX;
      stuck += 1;
      if (stuck > 2) {
        return {
          reason: `${name}: inside the viewport but covered by <${st.hit}> at its centre`,
          steps,
          state: st,
        };
      }
    } else dy = STEP_PX;
    const moved = await scrollBy(run, dy);
    steps += 1;
    st = await elementState(page, spec);
    if (moved === 0 && !st.inView) {
      stuck += 1;
      if (stuck >= 3) {
        return {
          reason: `${name}: the scroller stopped moving (scrollTop=${st.scrollTop}) before it came into view (box=${JSON.stringify(st.box)})`,
          steps,
          state: st,
        };
      }
    }
  }
  return { reason: null, steps, state: st };
}

/** Taps an element at its centre by coordinates — only once it is in view. */
export async function tapInView(
  run: MobileRun,
  spec: ElementSpec,
  name: string
): Promise<ElementState> {
  const st = await elementState(run.page, spec);
  if (!st.found) throw new Error(`${name}: not found`);
  if (!st.inView) {
    throw new Error(
      `${name}: refusing to tap while not in view (box=${JSON.stringify(st.box)} covered=${st.covered})`
    );
  }
  await run.page.touchscreen.tap(st.cx, st.cy);
  return st;
}

/** Scrolls to a control, taps it, and reports whether the scroll succeeded. */
export async function reachAndTap(
  run: MobileRun,
  spec: ElementSpec,
  name: string
): Promise<ReachResult> {
  const reach = await scrollUntilVisible(run, spec, name);
  if (reach.reason === null) await tapInView(run, spec, name);
  return reach;
}

/** Focuses a text field by tapping it, then types. Never uses locator.fill(). */
export async function typeInto(
  run: MobileRun,
  testId: string,
  name: string,
  text: string
): Promise<{ focusMethod: string; value: string }> {
  const { page } = run;
  const st = await tapInView(run, { testId }, name);
  await sleep(120);
  const focusedId = (): Promise<string | null> =>
    page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
  let focusMethod = 'touchscreen.tap';
  let focused = (await focusedId()) === testId;
  if (!focused) {
    // Recorded honestly: a coordinate mouse click at exactly the same point.
    await page.mouse.click(st.cx, st.cy);
    await sleep(120);
    focusMethod = 'touchscreen.tap did not focus; mouse.click at the same point';
    focused = (await focusedId()) === testId;
  }
  if (!focused) throw new Error(`${name}: could not focus the field by tapping its centre`);
  await page.keyboard.type(text, { delay: 12 });
  const value = await page.evaluate(
    (id) => (document.querySelector(`[data-testid="${id}"]`) as HTMLInputElement | null)?.value ?? '',
    testId
  );
  return { focusMethod, value };
}

// ---------------------------------------------------------------------------
// The acceptance measurements themselves.
// ---------------------------------------------------------------------------

/**
 * The top of the product area: the bottom of the staging strip when a build
 * carries one, otherwise the top of the viewport.
 */
export async function productAreaTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const strip = document.querySelector('[data-testid="wsf-staging-banner"]');
    if (!strip) return 0;
    const r = strip.getBoundingClientRect();
    return r.height > 0 ? r.bottom : 0;
  });
}

export type ScrollTrapReport = {
  ctaFound: boolean;
  bodyScrolls: boolean;
  documentScrollHeight: number;
  documentClientHeight: number;
  /** Scroll containers (overflow-y auto/scroll) that wrap the CTA — diagnostic. */
  ctaScrollAncestors: string[];
  /** Ancestors of the CTA that are actually scrolling. One, or none when the page fits. */
  ctaActiveScrollAncestors: string[];
  /** Elements that are actually scrolling right now, anywhere on the page. */
  activeScrollers: string[];
  /** Any scroller that is NOT an ancestor of the CTA — a nested scroll trap. */
  activeScrollersOutsideCta: string[];
  /** Ancestors of the CTA that clip their own content vertically. */
  ctaClippingAncestors: string[];
};

export async function scrollTrapReport(page: Page, ctaTestId: string): Promise<ScrollTrapReport> {
  return page.evaluate((id: string): ScrollTrapReport => {
    const describe = (el: Element): string =>
      `${el.tagName.toLowerCase()}[data-testid=${el.getAttribute('data-testid') ?? '-'}]` +
      ` overflowY=${getComputedStyle(el).overflowY} clientHeight=${el.clientHeight}` +
      ` scrollHeight=${el.scrollHeight}`;
    const visible = (e: Element): boolean => (e as HTMLElement).getClientRects().length > 0;
    const cta =
      Array.from(document.querySelectorAll(`[data-testid="${id}"]`)).find(visible) ?? null;
    const se = document.scrollingElement ?? document.documentElement;
    const ancestors: Element[] = [];
    let e: Element | null = cta ? cta.parentElement : null;
    while (e) {
      ancestors.push(e);
      e = e.parentElement;
    }
    const isBoxy = (el: Element): boolean =>
      el !== document.body && el !== document.documentElement && el.clientHeight > 0;
    const isScrollContainer = (el: Element): boolean => {
      const cs = getComputedStyle(el);
      return isBoxy(el) && (cs.overflowY === 'auto' || cs.overflowY === 'scroll');
    };
    const isActiveScroller = (el: Element): boolean =>
      isScrollContainer(el) && el.scrollHeight > el.clientHeight + 1;
    const everyElement = Array.from(document.querySelectorAll('*'));
    const active = everyElement.filter(isActiveScroller);
    const ancestorSet = new Set(ancestors);
    return {
      ctaFound: Boolean(cta),
      bodyScrolls: se.scrollHeight > se.clientHeight + 1,
      documentScrollHeight: se.scrollHeight,
      documentClientHeight: se.clientHeight,
      ctaScrollAncestors: ancestors.filter(isScrollContainer).map(describe),
      ctaActiveScrollAncestors: ancestors.filter(isActiveScroller).map(describe),
      activeScrollers: active.map(describe),
      activeScrollersOutsideCta: active.filter((el) => !ancestorSet.has(el)).map(describe),
      ctaClippingAncestors: ancestors
        .filter((el) => {
          const cs = getComputedStyle(el);
          return (
            (cs.overflowY === 'hidden' || cs.overflowY === 'clip') &&
            el.scrollHeight > el.clientHeight + 1
          );
        })
        .map(describe),
    };
  }, ctaTestId);
}

/**
 * R1, reused from ui-a11y.spec.ts: nothing wider than the viewport and nothing
 * past its right edge.
 */
export async function noOverflow(page: Page, width: number, label: string): Promise<void> {
  const o = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('body *')) as HTMLElement[];
    const w = document.documentElement.clientWidth;
    const offenders = all
      .filter(
        (e) => e.getBoundingClientRect().right > w + 1 && getComputedStyle(e).position !== 'fixed'
      )
      .map(
        (e) =>
          `${e.getAttribute('data-testid') ?? e.tagName}@${Math.round(e.getBoundingClientRect().right)} "${(e.textContent || '').trim().slice(0, 40)}"`
      );
    return { sw: document.documentElement.scrollWidth, cw: w, offenders };
  });
  expect(o.sw, `${label}: no horizontal scroll at ${width}`).toBeLessThanOrEqual(width);
  expect(o.offenders, `${label}: no element past the right edge at ${width}`).toEqual([]);
}

/**
 * Every visible text node that leaks a join URL or a token-like run of 16 or
 * more base64url characters. Form controls are excluded (their value is a
 * property, and a member typing a code is not a leak), and attributes — such as
 * the invite card's `data-invite-url` — are not text nodes at all.
 */
export async function visibleSecretOffenders(
  page: Page,
  rootTestId?: string
): Promise<string[]> {
  return page.evaluate((rootId: string | null) => {
    const out: string[] = [];
    const TOKEN = /[A-Za-z0-9_-]{16,}/;
    const JOIN_URL = /https?:\/\/[^\s]*\/join\//i;
    const root = rootId
      ? (Array.from(document.querySelectorAll(`[data-testid="${rootId}"]`)).find(
          (e) => (e as HTMLElement).getClientRects().length > 0
        ) ?? null)
      : document.body;
    if (!root) return [`scan root [data-testid="${rootId}"] is not on the page`];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.nextNode();
    while (node) {
      const text = (node.nodeValue || '').trim();
      const parent = node.parentElement;
      if (text && parent && !parent.closest('input, textarea, select')) {
        const cs = getComputedStyle(parent);
        const shown =
          parent.getClientRects().length > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
        if (shown) {
          const where = `<${parent.tagName.toLowerCase()} data-testid=${parent.getAttribute('data-testid') ?? '-'}>`;
          if (JOIN_URL.test(text)) out.push(`join URL in ${where}: "${text.slice(0, 90)}"`);
          else {
            const m = TOKEN.exec(text);
            if (m) out.push(`token-like run "${m[0]}" in ${where}: "${text.slice(0, 90)}"`);
          }
        }
      }
      node = walker.nextNode();
    }
    return out;
  }, rootTestId ?? null);
}

/** Every visible element carrying this testID. Hidden stack frames do not count. */
export async function visibleCount(page: Page, testId: string): Promise<number> {
  return visibleMatchingCount(page, `[data-testid="${testId}"]`);
}

/** Every visible element matching a CSS selector. */
export async function visibleMatchingCount(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel: string) => {
    return Array.from(document.querySelectorAll(sel)).filter((e) => {
      const he = e as HTMLElement;
      if (he.getClientRects().length === 0) return false;
      const cs = getComputedStyle(he);
      return cs.visibility !== 'hidden' && cs.display !== 'none';
    }).length;
  }, selector);
}

export type OptionRowReport = {
  testId: string | null;
  /**
   * aria-checked, which is the attribute ARIA allows on role="radio"
   * (aria-selected is not, and axe's aria-allowed-attr refuses it). It
   * carries exactly the same boolean the rows used to publish twice.
   */
  ariaChecked: string | null;
  role: string | null;
};

/** Every option row inside one radiogroup, with the state it exposes. */
export async function optionRows(page: Page, groupTestId: string): Promise<OptionRowReport[]> {
  return page.evaluate((id: string): OptionRowReport[] => {
    const group =
      Array.from(document.querySelectorAll(`[data-testid="${id}"]`)).find(
        (e) => (e as HTMLElement).getClientRects().length > 0
      ) ?? null;
    if (!group) return [];
    return Array.from(group.querySelectorAll('[role="radio"]')).map((el) => ({
      testId: el.getAttribute('data-testid'),
      ariaChecked: el.getAttribute('aria-checked'),
      role: el.getAttribute('role'),
    }));
  }, groupTestId);
}

/** The testID of whatever holds focus right now. */
export async function focusedTestId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
}

/**
 * How much of the first viewport one element occupies, as a fraction of the
 * viewport area, plus where its top sits. Used to prove a hero is dominant
 * rather than merely present.
 */
export async function firstViewportShare(
  page: Page,
  testId: string
): Promise<{ found: boolean; top: number; visibleHeight: number; share: number; vh: number }> {
  return page.evaluate((id: string) => {
    const el =
      Array.from(document.querySelectorAll(`[data-testid="${id}"]`)).find(
        (e) => (e as HTMLElement).getClientRects().length > 0
      ) ?? null;
    const vh = window.innerHeight;
    if (!el) return { found: false, top: 0, visibleHeight: 0, share: 0, vh };
    const r = el.getBoundingClientRect();
    const visibleHeight = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    return {
      found: true,
      top: Math.round(r.top * 10) / 10,
      visibleHeight: Math.round(visibleHeight * 10) / 10,
      share: Math.round((visibleHeight / vh) * 1000) / 1000,
      vh,
    };
  }, testId);
}

/**
 * GET PAST THE VERIFY GATE, WHICHEVER WAY THIS BUILD OFFERS.
 *
 * The gate has two ways through and which one applies depends on the send
 * outcome, not on the test:
 *
 *   · Where a verification send was ATTEMPTED, "I have verified" is offered
 *     and is the way on. A tap is what a person would do.
 *   · Where email is UNCONFIGURED that control is deliberately absent — there
 *     is no link to have followed — and the screen refreshes auth state on
 *     its own and continues once the address is verified.
 *
 * Both end in the same place, so callers wait for the destination rather than
 * insisting on a control. Call this only AFTER the account has actually been
 * verified out of band; it does not make anything true, it just stops the
 * test from depending on which path this build takes.
 *
 * Specs that exist to prove the MANUAL control still works should click it
 * directly rather than call this — this helper deliberately cannot tell you
 * which path it used.
 */
export async function clearVerifyGate(
  page: Page,
  destination: string,
  timeout = 25_000
): Promise<void> {
  const check = page.getByTestId('wsf-verify-check');
  // A short wait, not the full timeout: on the unconfigured path this control
  // never appears, and the passive refresh is already running.
  try {
    await check.waitFor({ state: 'visible', timeout: 3_000 });
    await check.click();
  } catch {
    // No control in this outcome. The screen is refreshing for itself.
  }
  await expect(page.getByTestId(destination)).toBeVisible({ timeout });
}
