import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * ACCESSIBILITY CONTRACT across the three member-facing surfaces —
 * Community Home, the contribution flow and the public display.
 *
 * Everything here is deterministic and runs against the emulators with
 * SYNTHETIC fixtures written directly to Firestore, so the server maxima a
 * real Champion could actually store are exercised: community displayName 80
 * characters, goal title 120, unit 40.
 *
 * What this file proves automatically:
 *   R1  long names at 390 / 360 / 320 / 195 CSS px never push the page wider
 *       than the viewport, and nothing is clipped inside its own box
 *   R2  every element of the distant display sits inside the screen at
 *       1440×900 and at 390×844, with the longest names a Champion can store
 *   R3  every control is at least 44×44 CSS px (plus axe's target-size rule)
 *   R4  every Tab stop is reachable with real Tab presses and shows a focus
 *       ring, and the controls that matter are on the path
 *   R5  the Manage sheet is a named modal dialog that traps focus, blocks the
 *       page behind it, and returns focus to its opener on Escape
 *   R6  with prefers-reduced-motion nothing animates, and the Living WE shows
 *       its true fill on first paint rather than growing into place
 *   R7  axe-core reports no WCAG 2.0/2.1/2.2 A or AA violation, the page has
 *       a title and one level-1 heading, the mark carries its numbers, and no
 *       two controls share an ambiguous accessible name
 *   R8  an entry error is announced, and the receipt is a polite live region
 *   R9  the number field asks for the numeric keypad and is 16 px or larger,
 *       so iOS does not zoom the page on focus
 *   R10 a greyscale artifact is recorded for human review, paired with
 *       deterministic assertions that every number also exists as text
 *
 * WHAT THIS FILE CANNOT DECIDE — these stay MANUAL, and no assertion here
 * should be read as covering them:
 *   - 200 % TEXT-ONLY zoom. The 195 px and 320 px widths stand in for the
 *     reflow a 200 % page zoom produces (CSS pixels halve); they do NOT
 *     exercise a browser's text-only zoom, which grows type without changing
 *     the viewport. Someone has to set text scaling to 200 % and look.
 *   - FOCUS-RING VISIBILITY AGAINST NAVY. R4 proves a ring is COMPUTED. It
 *     cannot judge whether the ring is discernible on the navy hero, on the
 *     navy display canvas or against the green primary button. A human must
 *     tab through both surfaces and confirm the ring is visible on every one.
 *   - THE GREYSCALE VERDICT. R10 writes the screenshots; it does not decide
 *     that the screens still read without colour. A person looks at
 *     tests-e2e/artifacts/ui-a11y/greyscale-*.png and says yes or no.
 *   - iOS ZOOM-ON-FOCUS. R9 checks the two properties that cause it
 *     (inputmode/enterkeyhint and a ≥ 16 px font). Only a real iPhone proves
 *     Safari leaves the viewport alone.
 *   - A REAL SCREEN-READER PASS. axe is a linter. VoiceOver and TalkBack
 *     reading the contribution flow end to end is a separate, human job.
 *
 * HOW FAILURES READ. Where a rule applies to many states (R2, R3, R7a, R7b)
 * every state is measured before anything is asserted, and the single
 * assertion at the end prints the whole inventory. A first broken screen must
 * not hide the four behind it. R5 and R7 are split into an "announces itself"
 * test and a "behaves correctly" test for the same reason: a missing name and
 * a broken focus trap are different promises with different fixes.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const FUNCTIONS_EMULATOR = 'http://127.0.0.1:5001';
const PROJECT_ID = 'demo-wsf-local';
const ARTIFACTS_DIR = path.resolve(__dirname, 'artifacts', 'ui-a11y');

const PHONE = { width: 390, height: 844 };
const WIDE = { width: 1440, height: 900 };
/** The minimum target size WCAG 2.2 AA (2.5.8) asks for, in CSS pixels. */
const MIN_TARGET = 44;

// ---------------------------------------------------------------------------
// Fixture text at the exact server maxima.
//
// Padded with " Wm" so the filler still offers break opportunities — the
// unbroken-token case is a fixture of its own, below, and must not be smeared
// across every other assertion. A trailing space is replaced so the string is
// exactly at the maximum AND never ends in whitespace that text assertions
// would have to normalise.
// ---------------------------------------------------------------------------
function exactly(base: string, n: number, filler: string): string {
  const s = base.padEnd(n, filler).slice(0, n);
  return s.endsWith(' ') ? `${s.slice(0, n - 1)}x` : s;
}

/** 80 characters: the community displayName maximum. */
const NAME_80 = exactly('Maple Street Movers Neighbourhood Association', 80, ' Wm');
/** 120 characters: the goal title maximum. */
const TITLE_120 = exactly('Squats together this week across the whole neighbourhood', 120, ' Wm');
/** 40 characters: the goal unit maximum. */
const UNIT_40 = exactly('squats', 40, ' Wm');
/** 90 characters with no break opportunity at all, inside the 120 maximum. */
const TOKEN_90 = exactly('Sq', 90, 'u');

// ---------------------------------------------------------------------------
// Emulator seeding. Copied rather than imported: a spec that reaches into
// another spec's helpers makes both of them fragile.
// ---------------------------------------------------------------------------
function callableUrl(name: string): string {
  return `${FUNCTIONS_EMULATOR}/${PROJECT_ID}/us-central1/${name}`;
}

async function seedVerifiedUser(email: string, password: string): Promise<string> {
  const headers = { authorization: 'Bearer owner', 'content-type': 'application/json' };
  const base = `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1`;
  const signup = await fetch(`${base}/accounts:signUp?key=fake-api-key`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!signup.ok) throw new Error(`emulator signUp failed: ${signup.status}`);
  const { localId } = (await signup.json()) as { localId: string };
  await fetch(`${base}/accounts:update`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ localId, emailVerified: true }),
  });
  return localId;
}

async function firestoreWrite(
  docPath: string,
  fields: Record<string, unknown>,
  updateMask?: string[]
): Promise<void> {
  const mask = updateMask?.length
    ? '?' + updateMask.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&')
    : '';
  const url = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}${mask}`;
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

async function seedShards(goalId: string, total: number): Promise<void> {
  if (total <= 0) return;
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

async function signInVia(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/signin');
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('wsf-signin-email').fill(email);
  await page.getByTestId('wsf-signin-password').fill(password);
  await page.getByTestId('wsf-signin-submit').click();
  await page.waitForURL(/\/(profile-setup)?$/, { timeout: 15_000 });
}

type Fx = {
  stamp: string;
  groupId: string;
  championUid: string;
  memberUid: string;
  championEmail: string;
  memberEmail: string;
  password: string;
  joinCode: string;
};

/**
 * A community with a Champion and a member, both verified, both with a
 * profile so signing in lands on the home route rather than profile setup.
 * `inviteOnly` so the invite card — one of the surfaces R3 measures — is
 * actually on the page.
 */
async function seedCommunity(tag: string, displayName: string): Promise<Fx> {
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const password = 'a11y-password';
  const championEmail = `wsf-a11y-champ-${tag}-${stamp}@example.com`;
  const memberEmail = `wsf-a11y-member-${tag}-${stamp}@example.com`;
  const championUid = await seedVerifiedUser(championEmail, password);
  const memberUid = await seedVerifiedUser(memberEmail, password);
  const now = new Date();
  for (const [uid, name] of [
    [championUid, 'Fixture Champion'],
    [memberUid, 'Fixture Member'],
  ] as const) {
    await firestoreWrite(`wsfMemberProfiles/${uid}`, {
      displayName: { stringValue: name },
      createdAt: tsField(now),
      updatedAt: tsField(now),
    });
  }
  const groupId = `a11y-${tag}-${stamp}`;
  const joinCode = randomBytes(6).toString('base64url');
  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: displayName },
    groupType: { stringValue: 'familyFriends' },
    joinPolicy: { stringValue: 'inviteOnly' },
    joinCode: { stringValue: joinCode },
    createdByUserId: { stringValue: championUid },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });
  for (const [uid, role] of [
    [championUid, 'foundingChampion'],
    [memberUid, 'member'],
  ] as const) {
    await firestoreWrite(`wsfMemberships/${groupId}_${uid}`, {
      groupId: { stringValue: groupId },
      userId: { stringValue: uid },
      role: { stringValue: role },
      membershipStatus: { stringValue: 'active' },
      createdAt: tsField(now),
      updatedAt: tsField(now),
    });
  }
  return { stamp, groupId, championUid, memberUid, championEmail, memberEmail, password, joinCode };
}

type GoalSeed = {
  key: string;
  title: string;
  target: number;
  unit: string;
  total: number;
  status: 'active' | 'closed';
  /** Signed offset from now for `endsAt`; wsfListGoals sorts on it, so the
   *  smallest value is the goal Community Home features. */
  endsInMs: number;
  authorized: boolean;
};

const OPEN = 3 * 24 * 60 * 60_000;
const LONG_OPEN = 10 * 24 * 60 * 60_000;
const PAST = -20 * 24 * 60 * 60_000;

async function seedGoal(fx: Fx, g: GoalSeed): Promise<string> {
  const goalId = `a11y-${g.key}-${fx.stamp}`;
  const now = new Date();
  await firestoreWrite(`wsfGoals/${goalId}`, {
    ownerUid: { stringValue: fx.championUid },
    communityGroupId: { stringValue: fx.groupId },
    title: { stringValue: g.title },
    target: { integerValue: String(g.target) },
    unit: { stringValue: g.unit },
    status: { stringValue: g.status },
    startsAt: tsField(new Date(now.getTime() + g.endsInMs - 14 * 24 * 60 * 60_000)),
    endsAt: tsField(new Date(now.getTime() + g.endsInMs)),
    timezone: { stringValue: 'America/New_York' },
    aggregateDisplayAuthorized: { booleanValue: g.authorized },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });
  await seedShards(goalId, g.total);
  return goalId;
}

/** The goal every walk uses: 241 of 500, authorised, and featured. */
function mainGoal(title: string, unit: string): GoalSeed {
  return {
    key: 'main',
    title,
    target: 500,
    unit,
    total: 241,
    status: 'active',
    endsInMs: OPEN,
    authorized: true,
  };
}

// ---------------------------------------------------------------------------
// Measurement helpers. All of them report OFFENDERS, never a bare boolean: a
// failure has to say which element broke the rule.
// ---------------------------------------------------------------------------

/** R1. Nothing wider than the viewport, and nothing past its right edge. */
async function noOverflow(page: Page, width: number, label: string): Promise<void> {
  const o = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('body *')) as HTMLElement[];
    const w = document.documentElement.clientWidth;
    const offenders = all
      .filter((e) => e.getBoundingClientRect().right > w + 1 && getComputedStyle(e).position !== 'fixed')
      .map(
        (e) =>
          `${e.getAttribute('data-testid') ?? e.tagName}@${Math.round(e.getBoundingClientRect().right)} [${(e.className || '').toString().slice(0, 60)}] "${(e.textContent || '').trim().slice(0, 40)}"`
      );
    return { sw: document.documentElement.scrollWidth, cw: w, offenders };
  });
  expect(o.sw, `${label}: no horizontal scroll at ${width}`).toBeLessThanOrEqual(width);
  expect(o.offenders, `${label}: no element past the right edge at ${width}`).toEqual([]);
}

/**
 * R1, the other half. A page can pass `noOverflow` and still be unreadable:
 * a long name inside a clipping box is simply cut off instead of pushing the
 * layout out. Anything that clips its own content horizontally is reported.
 */
async function noHorizontalClipping(page: Page, label: string): Promise<void> {
  const offenders = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *')) as HTMLElement[]) {
      const st = getComputedStyle(el);
      if (st.overflow === 'visible') continue;
      if (el.scrollWidth > el.clientWidth + 1) {
        out.push(
          `${el.getAttribute('data-testid') ?? el.tagName} overflow=${st.overflow} scrollWidth=${el.scrollWidth} clientWidth=${el.clientWidth} "${(el.textContent || '').trim().slice(0, 40)}"`
        );
      }
    }
    return out;
  });
  expect(offenders, `${label}: nothing clipped horizontally inside its own box`).toEqual([]);
}

/**
 * R2. Every named element's rect is inside the viewport. Returns the
 * offenders so a caller can collect them across several states and fail once
 * with the whole picture rather than stopping at the first screen.
 */
async function offScreenElements(page: Page, testIds: string[]): Promise<string[]> {
  return page.evaluate((ids) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const out: string[] = [];
    for (const id of ids) {
      const els = Array.from(document.querySelectorAll(`[data-testid="${id}"]`)) as HTMLElement[];
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.top < -0.5 || r.bottom > vh + 0.5 || r.left < -0.5 || r.right > vw + 0.5) {
          out.push(
            `${id} top=${Math.round(r.top)} bottom=${Math.round(r.bottom)} left=${Math.round(r.left)} right=${Math.round(r.right)} (viewport ${vw}×${vh})`
          );
        }
      }
    }
    return out;
  }, testIds);
}

/**
 * R3. Controls smaller than `min` in either direction.
 *
 * getClientRects() rather than getBoundingClientRect(): a control whose label
 * wraps onto two lines has two boxes, and the target is the larger of them,
 * not their union. Presentational and hidden nodes are not targets.
 */
async function undersizedTargets(page: Page, min: number): Promise<string[]> {
  return page.evaluate((limit) => {
    const selector =
      'a[href], input, button, [role=button], [role=link], [role=checkbox], [role=textbox]';
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll(selector)) as HTMLElement[]) {
      if (el.closest('[aria-hidden="true"]')) continue;
      const role = el.getAttribute('role');
      if (role === 'none' || role === 'presentation') continue;
      const rects = Array.from(el.getClientRects());
      if (rects.length === 0) continue;
      const w = Math.max(...rects.map((r) => r.width));
      const h = Math.max(...rects.map((r) => r.height));
      if (w <= 0 || h <= 0) continue;
      if (w + 0.5 >= limit && h + 0.5 >= limit) continue;
      out.push(
        `${el.getAttribute('data-testid') ?? el.tagName}${role ? `[${role}]` : ''} ${Math.round(w)}×${Math.round(h)} "${(el.textContent || '').trim().slice(0, 32)}"`
      );
    }
    return out;
  }, min);
}

type TabStop = { id: string; ring: boolean };

/**
 * R4. Walks the real Tab order with real key presses — `.focus()` would prove
 * nothing about whether a control is REACHABLE — and reports what was focused
 * and whether that element renders a focus indicator.
 *
 * Stops when the cycle wraps back to an element already visited.
 */
async function tabStops(page: Page, max = 40): Promise<TabStop[]> {
  await page.evaluate(() => {
    (window as unknown as { __wsfTabSeen?: Element[] }).__wsfTabSeen = [];
  });
  const stops: TabStop[] = [];
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(40);
    const s = await page.evaluate(() => {
      const w = window as unknown as { __wsfTabSeen?: Element[] };
      w.__wsfTabSeen = w.__wsfTabSeen ?? [];
      const a = document.activeElement as HTMLElement | null;
      if (!a || a === document.body || a === document.documentElement) {
        return { id: 'BODY', ring: true, wrapped: false, offDocument: true };
      }
      const st = getComputedStyle(a);
      const ring =
        (st.outlineStyle !== 'none' &&
          (st.outlineStyle === 'auto' || Number.parseFloat(st.outlineWidth) > 0)) ||
        st.boxShadow !== 'none';
      const id =
        a.getAttribute('data-testid') ?? `${a.tagName}[${a.getAttribute('role') ?? ''}]`;
      const wrapped = w.__wsfTabSeen.includes(a);
      if (!wrapped) w.__wsfTabSeen.push(a);
      return { id, ring, wrapped, offDocument: false };
    });
    // Focus handed back to the browser's own chrome: the cycle is over if we
    // already collected something, otherwise keep going back into the page.
    if (s.offDocument) {
      if (stops.length) break;
      continue;
    }
    if (s.wrapped) break;
    stops.push({ id: s.id, ring: s.ring });
  }
  return stops;
}

/** R6. Elements the compositor is actually animating. */
async function animatingNodes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *')) as HTMLElement[]) {
      const st = getComputedStyle(el);
      if (st.animationName === 'none') continue;
      const durations = st.animationDuration.split(',').map((d) => Number.parseFloat(d) || 0);
      if (!durations.some((d) => d > 0)) continue;
      out.push(
        `${el.getAttribute('data-testid') ?? el.tagName} animation=${st.animationName} duration=${st.animationDuration}`
      );
    }
    return out;
  });
}

/** R7. axe violations, one readable line each. */
async function axeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return results.violations.map((v) => `${v.id}: ${v.nodes.length} — ${v.nodes[0]?.target}`);
}

async function axeRuleViolations(page: Page, rules: string[]): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withRules(rules).analyze();
  return results.violations.map((v) => `${v.id}: ${v.nodes.length} — ${v.nodes[0]?.target}`);
}

/** The contribution route re-pushes its own screen; take the live one. */
function live(page: Page, testId: string) {
  return page.getByTestId(testId).last();
}

async function snap(page: Page, name: string): Promise<void> {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, `${name}.png`), fullPage: false });
}

// ═══════════════════════════════════════════════════════════════════════════
// R1 — the longest names a Champion can store, at four widths, on all three
//      surfaces. 195 px stands in for 200 % page zoom (CSS pixels halve);
//      320 px is the narrowest phone still in the field.
// ═══════════════════════════════════════════════════════════════════════════

const R1_WIDTHS = [390, 360, 320, 195];
const R1_FIXTURES: Array<{ tag: string; title: string; label: string }> = [
  { tag: 'max', title: TITLE_120, label: 'maxima (80/120/40)' },
  { tag: 'tok', title: TOKEN_90, label: 'one unbroken 90-character token' },
];

for (const fixture of R1_FIXTURES) {
  for (const width of R1_WIDTHS) {
    test(`R1 ${fixture.label}: no overflow and no clipping at ${width}px on all three surfaces`, async ({
      browser,
    }) => {
      test.setTimeout(240_000);
      const fx = await seedCommunity(`r1${fixture.tag}${width}`, NAME_80);
      const goalId = await seedGoal(fx, mainGoal(fixture.title, UNIT_40));
      const ctx = await browser.newContext({
        viewport: { width, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      });
      const page = await ctx.newPage();
      try {
        await signInVia(page, fx.memberEmail, fx.password);

        // ---- Community Home ------------------------------------------------
        await page.goto(`/community/${fx.groupId}`);
        await expect(page.getByTestId(`wsf-community-goal-percent-${goalId}`)).toBeVisible({
          timeout: 30_000,
        });
        await noOverflow(page, width, 'Community Home');
        await noHorizontalClipping(page, 'Community Home');

        // ---- contribution: move → enter → review → receipt ------------------
        await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}&mode=move`);
        await expect(live(page, 'wsf-contribute-move-screen')).toBeVisible({ timeout: 20_000 });
        await noOverflow(page, width, 'Start moving');
        await noHorizontalClipping(page, 'Start moving');

        await live(page, 'wsf-contribute-done').click();
        await expect(live(page, 'wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
        await live(page, 'wsf-contribute-entry').fill('20');
        await noOverflow(page, width, 'Enter');
        await noHorizontalClipping(page, 'Enter');

        await live(page, 'wsf-contribute-review').click();
        await expect(live(page, 'wsf-contribute-review-screen')).toBeVisible();
        await noOverflow(page, width, 'Review');
        await noHorizontalClipping(page, 'Review');

        await live(page, 'wsf-contribute-submit').click();
        await expect(live(page, 'wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });
        await noOverflow(page, width, 'Confirmed');
        await noHorizontalClipping(page, 'Confirmed');

        // ---- public display -------------------------------------------------
        await page.goto(`/display/${goalId}`);
        await expect(page.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 20_000 });
        await noOverflow(page, width, 'Display');
        await noHorizontalClipping(page, 'Display');
      } finally {
        await ctx.close();
      }
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// R2 — the distant display is a screen, not a page: every element it renders
//      has to be ON it. Checked with the longest storable names, wide and
//      phone, in the four states that change the layout.
// ═══════════════════════════════════════════════════════════════════════════

const DISPLAY_TESTIDS = [
  'wsf-display-community',
  'wsf-display-goal-title',
  'wsf-display-period',
  'wsf-display-closed',
  'wsf-display-headline',
  'wsf-display-we',
  'wsf-display-total-line',
  'wsf-display-percent',
  'wsf-display-target',
  'wsf-display-remaining',
  'wsf-display-together',
  'wsf-display-confirmed-at',
  'wsf-display-stale',
];

const R2_STATES: GoalSeed[] = [
  { key: 'building', title: TITLE_120, target: 500, unit: UNIT_40, total: 241, status: 'active', endsInMs: OPEN, authorized: true },
  { key: 'zero', title: TITLE_120, target: 500, unit: UNIT_40, total: 0, status: 'active', endsInMs: OPEN, authorized: true },
  { key: 'reached', title: TITLE_120, target: 500, unit: UNIT_40, total: 515, status: 'active', endsInMs: OPEN, authorized: true },
  { key: 'closedreached', title: TITLE_120, target: 500, unit: UNIT_40, total: 515, status: 'closed', endsInMs: PAST, authorized: true },
];

for (const viewport of [WIDE, PHONE]) {
  test(`R2 display contains every element at ${viewport.width}×${viewport.height} with maximum-length names`, async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const fx = await seedCommunity(`r2w${viewport.width}`, NAME_80);
    const ids: Record<string, string> = {};
    for (const g of R2_STATES) ids[g.key] = await seedGoal(fx, g);
    const wide = viewport.width >= 900;
    const ctx = await browser.newContext({
      viewport,
      deviceScaleFactor: wide ? 1 : 2,
      isMobile: !wide,
      hasTouch: !wide,
    });
    const page = await ctx.newPage();
    const offScreen: Record<string, string[]> = {};
    const scrolls: Record<string, string> = {};
    try {
      for (const g of R2_STATES) {
        await page.goto(`/display/${ids[g.key]}`);
        await expect(page.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByTestId('wsf-display-screen')).toHaveAttribute(
          'data-layout',
          wide ? 'wide' : 'phone'
        );
        await expect(page.getByTestId('wsf-display-community')).toHaveText(NAME_80);
        await expect(page.getByTestId('wsf-display-goal-title')).toHaveText(TITLE_120);
        if (g.key === 'zero') {
          await expect(page.getByTestId('wsf-display-headline')).toHaveText('See what WE can do.');
        }
        if (g.key === 'closedreached') {
          await expect(page.getByTestId('wsf-display-closed')).toHaveCount(1);
        }
        const offenders = await offScreenElements(page, DISPLAY_TESTIDS);
        if (offenders.length) offScreen[g.key] = offenders;
        if (wide) {
          const box = await page.evaluate(() => ({
            h: document.documentElement.scrollHeight,
            w: document.documentElement.scrollWidth,
          }));
          if (box.h > WIDE.height || box.w > WIDE.width) {
            scrolls[g.key] = `scrollHeight=${box.h} scrollWidth=${box.w}`;
          }
        }
      }
      expect(
        offScreen,
        `${viewport.width}×${viewport.height}: every display element inside the screen`
      ).toEqual({});
      expect(scrolls, 'the distant display needs no scroll').toEqual({});
    } finally {
      await ctx.close();
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// R3 — touch targets. Every control a finger has to hit, on every state a
//      member or Champion can reach on a phone.
// ═══════════════════════════════════════════════════════════════════════════

test('R3 every control is at least 44×44 across Community Home, the sheet, the contribution flow and the display', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const fx = await seedCommunity('r3', NAME_80);
  const goalA = await seedGoal(fx, mainGoal(TITLE_120, UNIT_40));
  const goalB = await seedGoal(fx, {
    key: 'second',
    title: 'Minutes walked together',
    target: 5_000,
    unit: 'minutes',
    total: 1_200,
    status: 'active',
    endsInMs: LONG_OPEN,
    authorized: false,
  });
  const goalC = await seedGoal(fx, {
    key: 'third',
    title: 'Push-ups this month',
    target: 800,
    unit: 'push-ups',
    total: 90,
    status: 'active',
    endsInMs: LONG_OPEN + 60_000,
    authorized: false,
  });
  const ctx = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  // Collected across every state, so one run reports every undersized
  // control rather than stopping at the first screen that has one.
  const small: Record<string, string[]> = {};
  const record = async (surface: string) => {
    const offenders = await undersizedTargets(page, MIN_TARGET);
    if (offenders.length) small[surface] = offenders;
  };
  try {
    // The Champion sees the strict superset of a member's controls.
    await signInVia(page, fx.championEmail, fx.password);

    // ---- Community Home, fully expanded -------------------------------------
    await page.goto(`/community/${fx.groupId}`);
    await expect(page.getByTestId(`wsf-community-goal-percent-${goalA}`)).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId('wsf-community-details-toggle').click();
    await expect(page.getByTestId('wsf-community-details')).toBeVisible();
    await expect(page.getByTestId('wsf-community-invite')).toBeVisible();
    await record('Community Home');

    // ---- the Manage sheet ----------------------------------------------------
    await page.getByTestId('wsf-community-manage').click();
    await expect(page.getByTestId('wsf-community-manage-panel')).toBeVisible();
    await record('Manage sheet');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('wsf-community-manage-panel')).toHaveCount(0);

    // ---- contribution: move → enter → review → receipt ------------------------
    await page.goto(`/contribute/${goalA}?groupId=${fx.groupId}&mode=move`);
    await expect(live(page, 'wsf-contribute-move-screen')).toBeVisible({ timeout: 20_000 });
    await record('Start moving');

    await live(page, 'wsf-contribute-done').click();
    await expect(live(page, 'wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
    await record('Enter');

    await live(page, 'wsf-contribute-entry').fill('20');
    await live(page, 'wsf-contribute-review').click();
    await expect(live(page, 'wsf-contribute-review-screen')).toBeVisible();
    await record('Review');

    await live(page, 'wsf-contribute-submit').click();
    await expect(live(page, 'wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });
    await record('Receipt');

    // ---- unknown outcome (pending), on its own goal ---------------------------
    await page.route(callableUrl('wsfContribute'), async (route: Route) => {
      await route.abort('failed');
    });
    await page.goto(`/contribute/${goalB}?groupId=${fx.groupId}&mode=record`);
    await expect(live(page, 'wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
    await live(page, 'wsf-contribute-entry').fill('20');
    await live(page, 'wsf-contribute-review').click();
    await live(page, 'wsf-contribute-submit').click();
    await expect(live(page, 'wsf-contribute-pending')).toBeVisible({ timeout: 20_000 });
    await record('Pending');
    await page.unroute(callableUrl('wsfContribute'));

    // ---- definitive refusal, on a third goal ----------------------------------
    await page.goto(`/contribute/${goalC}?groupId=${fx.groupId}&mode=record`);
    await expect(live(page, 'wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
    await live(page, 'wsf-contribute-entry').fill('20');
    await live(page, 'wsf-contribute-review').click();
    await expect(live(page, 'wsf-contribute-review-screen')).toBeVisible();
    // The goal closes between the tap and the server running it, so the
    // refusal is deterministic and no poll can flip the screen first.
    await page.route(callableUrl('wsfContribute'), async (route: Route) => {
      await firestoreWrite(`wsfGoals/${goalC}`, { status: { stringValue: 'closed' } }, ['status']);
      await route.continue();
    });
    await live(page, 'wsf-contribute-submit').click();
    await expect(live(page, 'wsf-contribute-refused')).toBeVisible({ timeout: 20_000 });
    await record('Refused');
    await page.unroute(callableUrl('wsfContribute'));

    // ---- the public display on a phone -----------------------------------------
    await page.goto(`/display/${goalA}`);
    await expect(page.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 20_000 });
    await record('Display');

    expect(small, 'every control is at least 44×44 CSS pixels').toEqual({});
  } finally {
    await ctx.close();
  }
});

test('R3 axe agrees about target size on Community Home and the contribution entry', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const fx = await seedCommunity('r3axe', NAME_80);
  const goalId = await seedGoal(fx, mainGoal(TITLE_120, UNIT_40));
  const ctx = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  try {
    await signInVia(page, fx.championEmail, fx.password);
    await page.goto(`/community/${fx.groupId}`);
    await expect(page.getByTestId(`wsf-community-goal-percent-${goalId}`)).toBeVisible({
      timeout: 30_000,
    });
    expect(await axeRuleViolations(page, ['target-size']), 'Community Home: axe target-size').toEqual([]);

    await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}&mode=record`);
    await expect(live(page, 'wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
    expect(await axeRuleViolations(page, ['target-size']), 'Enter: axe target-size').toEqual([]);
  } finally {
    await ctx.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// R4 — keyboard reachability and a visible focus indicator. Real Tab presses
//      only: .focus() proves a control can HOLD focus, never that anyone can
//      GET to it.
// ═══════════════════════════════════════════════════════════════════════════

test('R4 every Tab stop shows a focus ring, and the controls that matter are on the path', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const fx = await seedCommunity('r4', NAME_80);
  const goalA = await seedGoal(fx, mainGoal(TITLE_120, UNIT_40));
  const goalB = await seedGoal(fx, {
    key: 'second',
    title: 'Minutes walked together',
    target: 5_000,
    unit: 'minutes',
    total: 1_200,
    status: 'active',
    endsInMs: LONG_OPEN,
    authorized: false,
  });
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  try {
    await signInVia(page, fx.championEmail, fx.password);
    await page.goto(`/community/${fx.groupId}`);
    await expect(page.getByTestId(`wsf-community-goal-percent-${goalA}`)).toBeVisible({
      timeout: 30_000,
    });
    // Nothing is clicked first: a click would move the sequential focus
    // starting point and the walk would silently begin halfway down the page.
    // The details rows carry no controls, so the collapsed page still holds
    // every control this walk expects.
    const homeStops = await tabStops(page, 40);
    const homeIds = homeStops.map((s) => s.id);
    expect(homeStops.length, `Community Home has Tab stops; saw ${homeIds.join(' → ')}`).toBeGreaterThan(0);
    expect(
      homeStops.filter((s) => !s.ring).map((s) => s.id),
      `every Community Home Tab stop shows a focus ring; order was ${homeIds.join(' → ')}`
    ).toEqual([]);
    for (const expected of [
      'wsf-community-manage',
      `wsf-community-goal-link-${goalA}`,
      `wsf-community-goal-record-${goalA}`,
      `wsf-community-goal-link-${goalB}`,
      'wsf-community-progress-refresh',
      'wsf-community-details-toggle',
    ]) {
      expect(homeIds, `${expected} is reachable by Tab; order was ${homeIds.join(' → ')}`).toContain(
        expected
      );
    }

    // The display's only control, on the state that offers it.
    await page.goto(`/display/no-such-goal-${fx.stamp}`);
    await expect(page.getByTestId('wsf-display-not-available')).toBeVisible({ timeout: 20_000 });
    const displayStops = await tabStops(page, 40);
    const displayIds = displayStops.map((s) => s.id);
    expect(displayIds, `Check again is reachable by Tab; order was ${displayIds.join(' → ')}`).toContain(
      'wsf-display-recheck'
    );
    expect(
      displayStops.filter((s) => !s.ring).map((s) => s.id),
      `every display Tab stop shows a focus ring; order was ${displayIds.join(' → ')}`
    ).toEqual([]);
  } finally {
    await ctx.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// R5 — the Manage sheet is a modal dialog, and behaves like one.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Split in two on purpose. The NAME is the assertion most likely to fail
 * today, and a failing name must not hide whether the trap, the scrim and
 * Escape work — those are separate promises with separate fixes.
 */
test('R5a the Manage sheet announces itself as a modal dialog called Champion tools', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const fx = await seedCommunity('r5a', NAME_80);
  const goalId = await seedGoal(fx, mainGoal(TITLE_120, UNIT_40));
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  try {
    await signInVia(page, fx.championEmail, fx.password);
    await page.goto(`/community/${fx.groupId}`);
    await expect(page.getByTestId(`wsf-community-goal-percent-${goalId}`)).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId('wsf-community-manage').click();
    await expect(page.getByTestId('wsf-community-manage-panel')).toBeVisible();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toHaveCount(1);
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    // The application root is OUTSIDE the dialog, so assistive technology is
    // not left reading the page behind an open sheet.
    const rootOutside = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      const root = document.getElementById('root');
      return { hasRoot: !!root, contained: !!(d && root && d.contains(root)) };
    });
    expect(rootOutside.hasRoot, 'the application root element exists').toBe(true);
    expect(rootOutside.contained, '#root is outside the dialog').toBe(false);
    await expect(page.getByRole('dialog', { name: 'Champion tools' })).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test('R5b the Manage sheet traps focus, blocks the page behind it, and returns focus on Escape', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const fx = await seedCommunity('r5b', NAME_80);
  const goalId = await seedGoal(fx, mainGoal(TITLE_120, UNIT_40));
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  try {
    await signInVia(page, fx.championEmail, fx.password);
    await page.goto(`/community/${fx.groupId}`);
    await expect(page.getByTestId(`wsf-community-goal-percent-${goalId}`)).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId('wsf-community-manage').click();
    await expect(page.getByTestId('wsf-community-manage-panel')).toBeVisible();

    // ---- the page behind is not reachable with a pointer ----------------------
    const link = page.getByTestId(`wsf-community-goal-link-${goalId}`);
    const box = await link.boundingBox();
    if (box) {
      const topEl = await page.evaluate(
        ({ x, y }) => {
          const e = document.elementFromPoint(x, y) as HTMLElement | null;
          return e?.closest('[data-testid="wsf-community-manage-panel"]')
            ? 'sheet'
            : (e?.getAttribute('data-testid') ?? e?.tagName ?? 'none');
        },
        { x: box.x + box.width / 2, y: Math.min(box.y + box.height / 2, PHONE.height - 40) }
      );
      expect(
        topEl === 'sheet' || topEl === 'wsf-community-manage-scrim',
        `element under the hero action while the sheet is open: ${topEl}`
      ).toBe(true);
    }

    // ---- Escape closes and hands focus back to the control that opened it ----
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('wsf-community-manage-panel')).toHaveCount(0);
    await expect
      .poll(
        () => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? 'none'),
        { timeout: 5_000, message: 'Escape returns focus to Manage' }
      )
      .toBe('wsf-community-manage');

    // ---- focus stays inside, at phone width and at 200 % reflow width --------
    for (const width of [390, 195]) {
      await page.setViewportSize({ width, height: 844 });
      await page.getByTestId('wsf-community-manage').click();
      await expect(page.getByTestId('wsf-community-manage-panel')).toBeVisible();
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
      expect(
        seen.every((s) => s.startsWith('in:')),
        `at ${width}px focus stays inside the sheet; saw ${seen.join(' → ')}`
      ).toBe(true);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('wsf-community-manage-panel')).toHaveCount(0);
    }
  } finally {
    await ctx.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// R6 — prefers-reduced-motion. Nothing moves, and the Living WE is already at
//      its confirmed fill the first time it is painted: a mark that grows
//      into place is motion AND a false intermediate reading.
// ═══════════════════════════════════════════════════════════════════════════

test.describe('R6 reduced motion', () => {
  // `reducedMotion` is no longer a top-level test option in the Playwright
  // this repo pins (1.62); it is set on the context, which is the same
  // browser-level preference the recipe asks for.
  test.use({ contextOptions: { reducedMotion: 'reduce' }, viewport: PHONE, deviceScaleFactor: 2 });

  test('nothing animates on Community Home or the display, and the WE starts at its true fill', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const fx = await seedCommunity('r6', NAME_80);
    const goalId = await seedGoal(fx, mainGoal(TITLE_120, UNIT_40));

    // Record the fill ratio the FIRST time the mark exists in the document,
    // before any effect could have moved it.
    await page.addInitScript(() => {
      const w = window as unknown as { __wsfFirstFill?: string | null };
      w.__wsfFirstFill = null;
      const capture = () => {
        if (w.__wsfFirstFill != null) return;
        const el = document.querySelector('[data-fill-ratio]');
        if (el) w.__wsfFirstFill = el.getAttribute('data-fill-ratio');
      };
      const start = () => {
        capture();
        new MutationObserver(capture).observe(document.documentElement, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['data-fill-ratio'],
        });
      };
      if (document.documentElement) start();
      else document.addEventListener('readystatechange', start, { once: true });
    });

    await signInVia(page, fx.memberEmail, fx.password);

    // ---- Community Home ------------------------------------------------------
    await page.goto(`/community/${fx.groupId}`);
    await expect(page.getByTestId(`wsf-community-goal-we-${goalId}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(`wsf-community-goal-percent-${goalId}`)).toHaveText('48.2% complete');
    await page.waitForTimeout(800); // settle: any transition would have started
    expect(await animatingNodes(page), 'Community Home animates nothing under reduced motion').toEqual([]);
    expect(
      await page.evaluate(() => document.getAnimations().length),
      'Community Home has no running animations under reduced motion'
    ).toBe(0);
    expect(
      await page.evaluate(() => (window as unknown as { __wsfFirstFill?: string | null }).__wsfFirstFill),
      'the WE is at its confirmed fill on first paint'
    ).toBe('0.4820');
    await expect(page.getByTestId(`wsf-community-goal-we-${goalId}`)).toHaveAttribute(
      'data-fill-ratio',
      '0.4820'
    );

    // ---- public display ------------------------------------------------------
    await page.goto(`/display/${goalId}`);
    await expect(page.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(800);
    expect(await animatingNodes(page), 'the display animates nothing under reduced motion').toEqual([]);
    expect(
      await page.evaluate(() => document.getAnimations().length),
      'the display has no running animations under reduced motion'
    ).toBe(0);
    await expect(page.getByTestId('wsf-display-we')).toHaveAttribute('data-fill-ratio', '0.4820');
  });

  test('while a contribution is recording, the only thing moving is inside the recording card', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const fx = await seedCommunity('r6rec', NAME_80);
    const goalId = await seedGoal(fx, mainGoal(TITLE_120, UNIT_40));
    await signInVia(page, fx.memberEmail, fx.password);

    // Hold the callable open long enough to inspect the in-flight state, then
    // fail it: the attempt lands on the pending screen, which is the honest
    // outcome of a request whose answer never arrived.
    await page.route(callableUrl('wsfContribute'), async (route: Route) => {
      await new Promise((resolve) => setTimeout(resolve, 8_000));
      await route.abort('failed');
    });

    await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}&mode=record`);
    await expect(live(page, 'wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
    await live(page, 'wsf-contribute-entry').fill('20');
    await live(page, 'wsf-contribute-review').click();
    await live(page, 'wsf-contribute-submit').click();
    await expect(live(page, 'wsf-contribute-recording')).toBeVisible({ timeout: 10_000 });

    const outside = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="wsf-contribute-recording"]');
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll('body *')) as HTMLElement[]) {
        const st = getComputedStyle(el);
        if (st.animationName === 'none') continue;
        const durations = st.animationDuration.split(',').map((d) => Number.parseFloat(d) || 0);
        if (!durations.some((d) => d > 0)) continue;
        if (card && card.contains(el)) continue;
        out.push(`${el.getAttribute('data-testid') ?? el.tagName} animation=${st.animationName}`);
      }
      for (const a of document.getAnimations()) {
        const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
        if (target && card && card.contains(target)) continue;
        out.push(`getAnimations: ${target?.tagName ?? 'unknown target'}`);
      }
      return out;
    });
    expect(outside, 'only the recording card animates while a contribution is in flight').toEqual([]);

    await expect(live(page, 'wsf-contribute-pending')).toBeVisible({ timeout: 20_000 });
    await page.unroute(callableUrl('wsfContribute'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R7 — axe, and the specific names and structures axe cannot judge.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A fixture with TWO goals still awaiting authorization, so the Manage sheet
 * really does render two controls whose only label is "Authorize public
 * display" — the ambiguity a screen-reader user meets, which cannot be seen
 * with one goal on the page.
 */
async function seedR7(tag: string): Promise<{ fx: Fx; goalA: string; goalB: string; goalC: string }> {
  const fx = await seedCommunity(tag, NAME_80);
  const goalA = await seedGoal(fx, mainGoal(TITLE_120, UNIT_40));
  const goalB = await seedGoal(fx, {
    key: 'second',
    title: 'Minutes walked together',
    target: 5_000,
    unit: 'minutes',
    total: 1_200,
    status: 'active',
    endsInMs: LONG_OPEN,
    authorized: false,
  });
  const goalC = await seedGoal(fx, {
    key: 'third',
    title: 'Push-ups this month',
    target: 800,
    unit: 'push-ups',
    total: 90,
    status: 'active',
    endsInMs: LONG_OPEN + 60_000,
    authorized: false,
  });
  return { fx, goalA, goalB, goalC };
}

test('R7a axe finds no WCAG A/AA violation on any state of any surface', async ({ browser }) => {
  test.setTimeout(300_000);
  const { fx, goalA, goalB, goalC } = await seedR7('r7a');
  const ctx = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  // Every surface is scanned before anything is asserted, so one run reports
  // the whole picture instead of the first screen that happens to fail.
  const found: Record<string, string[]> = {};
  const scan = async (surface: string) => {
    const wcag = await axeViolations(page);
    const named = await axeRuleViolations(page, ['aria-dialog-name', 'page-has-heading-one']);
    const all = [...wcag, ...named];
    if (all.length) found[surface] = all;
  };
  try {
    await signInVia(page, fx.championEmail, fx.password);

    await page.goto(`/community/${fx.groupId}`);
    await expect(page.getByTestId(`wsf-community-goal-percent-${goalA}`)).toBeVisible({
      timeout: 30_000,
    });
    await scan('Community Home');

    await page.getByTestId('wsf-community-manage').click();
    await expect(page.getByTestId('wsf-community-manage-panel')).toBeVisible();
    await expect(page.getByTestId(`wsf-goal-display-auth-toggle-${goalB}`)).toBeVisible();
    await expect(page.getByTestId(`wsf-goal-display-auth-toggle-${goalC}`)).toBeVisible();
    await scan('Manage sheet');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('wsf-community-manage-panel')).toHaveCount(0);

    await page.goto(`/contribute/${goalA}?groupId=${fx.groupId}&mode=record`);
    await expect(live(page, 'wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
    await scan('Enter');

    await live(page, 'wsf-contribute-entry').fill('20');
    await live(page, 'wsf-contribute-review').click();
    await expect(live(page, 'wsf-contribute-review-screen')).toBeVisible();
    await scan('Review');

    await live(page, 'wsf-contribute-submit').click();
    await expect(live(page, 'wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });
    await scan('Receipt');

    await page.goto(`/display/${goalA}`);
    await expect(page.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 20_000 });
    await scan('Display ready');

    await page.goto(`/display/no-such-goal-${fx.stamp}`);
    await expect(page.getByTestId('wsf-display-not-available')).toBeVisible({ timeout: 20_000 });
    await scan('Display unavailable');

    expect(found, 'axe: no WCAG 2.0/2.1/2.2 A or AA violation on any surface').toEqual({});
  } finally {
    await ctx.close();
  }
});

test('R7b every surface has a title, one level-1 heading, a named wordmark, and unambiguous controls', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const { fx, goalA, goalB, goalC } = await seedR7('r7b');
  const ctx = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const structure: Record<string, string> = {};
  const check = async (surface: string) => {
    const title = (await page.title()).trim();
    const h1 = await page.getByRole('heading', { level: 1 }).count();
    const wordmark = await page.getByRole('img', { name: 'We Stay Fit' }).count();
    const notes: string[] = [];
    if (title === '') notes.push('no document title');
    if (h1 !== 1) notes.push(`level-1 headings: ${h1}`);
    if (wordmark < 1) notes.push('no image named "We Stay Fit"');
    if (notes.length) structure[surface] = notes.join('; ');
  };
  try {
    await signInVia(page, fx.championEmail, fx.password);

    await page.goto(`/community/${fx.groupId}`);
    await expect(page.getByTestId(`wsf-community-goal-percent-${goalA}`)).toBeVisible({
      timeout: 30_000,
    });
    await check('Community Home');
    // The mark carries exactly the numbers the page prints beside it.
    await expect(page.getByTestId(`wsf-community-goal-we-${goalA}`)).toHaveAttribute(
      'aria-label',
      `241 of 500 ${UNIT_40}, 48.2% filled`
    );

    await page.getByTestId('wsf-community-manage').click();
    await expect(page.getByTestId('wsf-community-manage-panel')).toBeVisible();
    await expect(page.getByTestId(`wsf-goal-display-auth-toggle-${goalB}`)).toBeVisible();
    await expect(page.getByTestId(`wsf-goal-display-auth-toggle-${goalC}`)).toBeVisible();
    // Two goals await authorization, so a control whose whole name is
    // "Authorize public display" cannot say which goal it would publish.
    const ambiguous = await page.getByRole('button', { name: 'Authorize public display' }).count();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('wsf-community-manage-panel')).toHaveCount(0);

    await page.goto(`/contribute/${goalA}?groupId=${fx.groupId}&mode=record`);
    await expect(live(page, 'wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
    await check('Enter');

    await live(page, 'wsf-contribute-entry').fill('20');
    await live(page, 'wsf-contribute-review').click();
    await expect(live(page, 'wsf-contribute-review-screen')).toBeVisible();
    await check('Review');

    await live(page, 'wsf-contribute-submit').click();
    await expect(live(page, 'wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });
    await check('Receipt');

    await page.goto(`/display/${goalA}`);
    await expect(page.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 20_000 });
    await check('Display ready');

    await page.goto(`/display/no-such-goal-${fx.stamp}`);
    await expect(page.getByTestId('wsf-display-not-available')).toBeVisible({ timeout: 20_000 });
    await check('Display unavailable');

    expect(structure, 'each surface: a title, exactly one level-1 heading, a named wordmark').toEqual({});
    expect(ambiguous, 'each display-authorization control names its own goal').toBeLessThanOrEqual(1);
  } finally {
    await ctx.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// R8 — a change of state that is not announced did not happen, for anyone
//      who is not looking at that part of the screen.
// ═══════════════════════════════════════════════════════════════════════════

test('R8 the entry error is announced, and the receipt is a polite live region', async ({ browser }) => {
  test.setTimeout(180_000);
  const fx = await seedCommunity('r8', NAME_80);
  const goalId = await seedGoal(fx, mainGoal(TITLE_120, UNIT_40));
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  try {
    await signInVia(page, fx.memberEmail, fx.password);
    await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}&mode=record`);
    await expect(live(page, 'wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });

    // ---- an empty field, reviewed --------------------------------------------
    await live(page, 'wsf-contribute-review').click();
    await expect(live(page, 'wsf-contribute-error')).toHaveText('Enter how many you completed.');
    await expect(page.getByRole('alert')).toHaveText('Enter how many you completed.');

    // ---- a confirmed contribution ---------------------------------------------
    await live(page, 'wsf-contribute-entry').fill('20');
    await live(page, 'wsf-contribute-review').click();
    await expect(live(page, 'wsf-contribute-review-screen')).toBeVisible();
    await live(page, 'wsf-contribute-submit').click();
    await expect(live(page, 'wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });
    await expect(live(page, 'wsf-contribute-receipt')).toHaveAttribute('aria-live', 'polite');
  } finally {
    await ctx.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// R9 — the number field. The two properties that decide whether a phone
//      offers the right keypad and whether iOS Safari zooms the page.
// ═══════════════════════════════════════════════════════════════════════════

test('R9 the entry field asks for a numeric keypad, a done key, and never triggers iOS zoom', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const fx = await seedCommunity('r9', NAME_80);
  const goalId = await seedGoal(fx, mainGoal(TITLE_120, UNIT_40));
  const ctx = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  try {
    await signInVia(page, fx.memberEmail, fx.password);
    await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}&mode=record`);
    const entry = live(page, 'wsf-contribute-entry');
    await expect(entry).toBeVisible({ timeout: 20_000 });
    await expect(entry).toHaveAttribute('inputmode', 'numeric');
    await expect(entry).toHaveAttribute('enterkeyhint', 'done');
    const fontSize = await entry.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize, 'a field smaller than 16px makes iOS Safari zoom the page on focus').toBeGreaterThanOrEqual(16);
  } finally {
    await ctx.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// R10 — colour is never the only carrier. The assertions below are the test;
//       the greyscale screenshots are for a person to look at.
// ═══════════════════════════════════════════════════════════════════════════

test('R10 every number survives without colour (greyscale artifacts for human review)', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const fx = await seedCommunity('r10', NAME_80);
  const goalId = await seedGoal(fx, mainGoal(TITLE_120, UNIT_40));
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const grey = 'html{filter:grayscale(1)}';
  try {
    await signInVia(page, fx.memberEmail, fx.password);

    // ---- Community Home hero ---------------------------------------------------
    await page.goto(`/community/${fx.groupId}`);
    await expect(page.getByTestId(`wsf-community-goal-percent-${goalId}`)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId(`wsf-community-goal-total-${goalId}`)).toHaveText(
      `241 of 500 ${UNIT_40}`
    );
    await expect(page.getByTestId(`wsf-community-goal-percent-${goalId}`)).toHaveText('48.2% complete');
    await expect(page.getByTestId(`wsf-community-goal-status-${goalId}`)).toHaveText('259 to go');
    await page.addStyleTag({ content: grey });
    await page.waitForTimeout(300);
    await snap(page, 'greyscale-01-community-home-hero');

    // ---- the receipt -------------------------------------------------------------
    await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}&mode=record`);
    await expect(live(page, 'wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
    await live(page, 'wsf-contribute-entry').fill('20');
    await live(page, 'wsf-contribute-review').click();
    await live(page, 'wsf-contribute-submit').click();
    await expect(live(page, 'wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });
    await expect(live(page, 'wsf-contribute-shared-total')).toHaveText(`261 of 500 ${UNIT_40}`);
    await expect(live(page, 'wsf-contribute-percent')).toHaveText('52.2% complete');
    await expect(live(page, 'wsf-contribute-status')).toHaveText('239 to go');
    await expect(live(page, 'wsf-contribute-we')).toHaveAttribute(
      'aria-label',
      `261 of 500 ${UNIT_40}, 52.2% filled`
    );
    await page.addStyleTag({ content: grey });
    await page.waitForTimeout(300);
    await snap(page, 'greyscale-02-contribution-receipt');

    // ---- the display on a phone -----------------------------------------------------
    await page.goto(`/display/${goalId}`);
    await expect(page.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('wsf-display-total-line')).toHaveText(`261 of 500 ${UNIT_40}`);
    await expect(page.getByTestId('wsf-display-percent')).toHaveText('52.2% complete');
    await expect(page.getByTestId('wsf-display-remaining')).toHaveText('239 to go');
    await expect(page.getByTestId('wsf-display-confirmed-at')).toContainText('Confirmed');
    await page.addStyleTag({ content: grey });
    await page.waitForTimeout(300);
    await snap(page, 'greyscale-03-display-phone');
  } finally {
    await ctx.close();
  }
});
