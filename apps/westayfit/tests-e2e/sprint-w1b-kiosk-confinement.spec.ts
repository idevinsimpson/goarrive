import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';

import { KIOSK_IDLE_MS } from '../src/kioskSession';
import { saveFrame } from './helpers/capture';
import {
  firestoreWrite,
  seedProfile,
  seedShards,
  seedVerifiedUser,
  signInVia,
  stampId,
  tsField,
} from './helpers/mobile';

/**
 * KIOSK CONFINEMENT — the correction, and the evidence for it.
 *
 * THE DEFECT. W5's navigation probe (#395 `5786446834`) measured it on this
 * exact shell: the kiosk rides the ordinary contribution route as
 * `/contribute/<goalId>?kiosk=1`, the app shell decides where its tab bar
 * belongs from the PATHNAME alone, `/contribute` is a member prefix — so the
 * bar renders over a kiosk session. One press of **You** landed the device on
 * the visitor's own member page, still signed in, showing their name and email,
 * with no `Finish` anywhere and no idle countdown, because both are children of
 * the contribution screen that had just unmounted.
 *
 * WHAT THIS FILE ASSERTS is the contract, not the absence of one click target:
 *
 *   1. the kiosk journey offers NO ordinary member navigation — no tab bar, no
 *      destination, no raised MOVE, and no "back to home" on any of the states
 *      the kiosk can land on;
 *   2. `Finish` is reachable AND legible on every one of those screens, dark
 *      receipt included — a control nobody can see is not an exit;
 *   3. the behaviours the correction must not cost: the unknown outcome still
 *      keeps its account-scoped attempt, the failed sign-out still refuses to
 *      show a resting screen, and the 90-second countdown with `Stay` still
 *      runs on a terminal screen;
 *   4. ORDINARY personal contribution is untouched and keeps its tabs.
 *
 * THE BOUNDARY, STATED RATHER THAN OVERSOLD. This is confinement of the app's
 * OWN navigation. It is not a device or browser lockdown and nothing here
 * claims one: the last test drives the browser straight to `/you` by URL and
 * asserts that it still works, because that is the true edge of what a web app
 * can enforce and a reader of this evidence should see it measured rather than
 * assumed away.
 *
 * MATCHED BEFORE / AFTER, ON ONE BRANCH. `WSF_CONFINEMENT_BEFORE=1` only moves
 * the output into `before/`. It is used once, against the UNPATCHED product at
 * `d0477cc`, so the defect is photographed at the same viewports as its
 * correction; the contract assertions then fail there, by design, and that
 * failure is the defect. At this branch's head the same file passes.
 *
 * Writes are gated on `WSF_CAPTURE_FRAMES`; the assertions run on every pass.
 */

const BEFORE = /^(1|true)$/i.test(process.env.WSF_CONFINEMENT_BEFORE ?? '');
const OUT = path.resolve(
  __dirname,
  '../../../docs/design-target/review/kiosk-confinement-correction',
  BEFORE ? 'before' : 'after'
);

/** The class batch-e draws a venue screen at. */
const TABLET = { width: 800, height: 1280 };
/** The repository's established short phone — the height that catches controls
 *  pushed under chrome. */
const SHORT_PHONE = { width: 390, height: 640 };

const COMMUNITY = 'Maple Street Movers';
const GOAL_TITLE = 'Squats together this week';
const TARGET = 500;
const UNIT = 'squats';
const START_TOTAL = 241;
const ADDED = 20;
const NEW_TOTAL = START_TOTAL + ADDED;
const VISITOR = 'Alex Rivera';

const DAY = 24 * 60 * 60_000;

/**
 * A MOUNT MARKER, NOT A RE-RENDER GUESS. React replaces the host node when a
 * screen remounts, so an attribute planted on that node survives exactly when
 * the screen did. Returns false when it could not be planted — a probe that
 * cannot measure must never report the safe answer, which is the failure this
 * sprint has now caught in a contrast probe, an auth probe and a fold probe.
 */
async function markMountedContext(page: Page, testId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return false;
    el.setAttribute('data-w1b-mounted', '1');
    return el.getAttribute('data-w1b-mounted') === '1';
  }, testId);
}

async function mountMarkSurvives(page: Page, testId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    return Boolean(el && el.getAttribute('data-w1b-mounted') === '1');
  }, testId);
}

/**
 * THE MARKER ON THE INSTANCE THE MEMBER IS ACTUALLY LOOKING AT.
 *
 * `mountMarkSurvives` above reads `document.querySelector`, which returns the
 * FIRST match. Measured on this build, that is a false positive: after Back,
 * the original marked screen is still in the document but HIDDEN behind a new
 * unmarked one, so the marker "survives" while the member is looking at a
 * screen that was just built. The marker proves a node persisted; it does not
 * prove that node is the one on screen.
 *
 * So this reads the marker on the VISIBLE instance, and the caller records the
 * instance count beside it. Reported to W1B, whose block this extends rather
 * than replaces — the limit they stated ("it proves the host node persisted")
 * turns out to have this sharper edge.
 */
async function visibleMarkSurvives(page: Page, testId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const all = Array.from(document.querySelectorAll(`[data-testid="${id}"]`));
    const shown = all.find((el) => (el as HTMLElement).offsetParent !== null) ?? null;
    return Boolean(shown && shown.getAttribute('data-w1b-mounted') === '1');
  }, testId);
}

/**
 * The offset of whichever ancestor actually scrolls, or `null` when nothing
 * does — so an unscrollable page is reported as unmeasured rather than as a
 * tidy zero that would match any other zero.
 */
async function contextScroll(page: Page, testId: string): Promise<number | null> {
  return page.evaluate((id) => {
    let el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
    while (el) {
      if (el.scrollHeight > el.clientHeight + 1) return el.scrollTop;
      el = el.parentElement;
    }
    return null;
  }, testId);
}

function frame(name: string): string {
  mkdirSync(OUT, { recursive: true });
  return path.join(OUT, name);
}

type Fixture = {
  email: string;
  password: string;
  uid: string;
  groupId: string;
  goalId: string;
};

async function seedKiosk(tag: string): Promise<Fixture> {
  const stamp = `${tag}${stampId()}`.replace(/-/g, '');
  const email = `wsf-w1b-conf-${stamp}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, VISITOR);

  const groupId = `w1bc${stamp}`;
  const now = new Date();
  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: COMMUNITY },
    groupType: { stringValue: 'familyFriends' },
    joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: randomBytes(6).toString('base64url') },
    createdByUserId: { stringValue: uid },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
    createdAt: tsField(new Date(now.getTime() - 40 * DAY)),
    updatedAt: tsField(now),
  });
  await firestoreWrite(`wsfMemberships/${groupId}_${uid}`, {
    groupId: { stringValue: groupId },
    userId: { stringValue: uid },
    role: { stringValue: 'foundingChampion' },
    membershipStatus: { stringValue: 'active' },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });

  const goalId = `${groupId}g`;
  await firestoreWrite(`wsfGoals/${goalId}`, {
    ownerUid: { stringValue: uid },
    communityGroupId: { stringValue: groupId },
    title: { stringValue: GOAL_TITLE },
    target: { integerValue: String(TARGET) },
    unit: { stringValue: UNIT },
    status: { stringValue: 'active' },
    startsAt: tsField(new Date(now.getTime() - 4 * DAY)),
    endsAt: tsField(new Date(now.getTime() + 3 * DAY)),
    repeatPolicy: { stringValue: 'multiple' },
    timezone: { stringValue: 'America/New_York' },
    aggregateDisplayAuthorized: { booleanValue: true },
    createdAt: tsField(new Date(now.getTime() - 4 * DAY)),
    updatedAt: tsField(now),
  });
  await seedShards(goalId, START_TOTAL);

  return { email, password, uid, groupId, goalId };
}

// ---- legibility, measured rather than eyeballed ----------------------------

type Rgba = { r: number; g: number; b: number; a: number };

function parseColour(css: string): Rgba {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?/.exec(css);
  if (!m) throw new Error(`not an rgb colour: ${css}`);
  return {
    r: Number(m[1]),
    g: Number(m[2]),
    b: Number(m[3]),
    a: m[4] === undefined ? 1 : Number(m[4]),
  };
}

/**
 * TRANSLUCENT TEXT IS MEASURED AS IT LANDS, NOT AS IT IS DECLARED.
 *
 * The product's muted-on-navy is `rgba(247,245,240,0.78)`. Reading those three
 * channels and dropping the alpha would score it as near-white on navy -- about
 * 15:1, when what a visitor actually sees is roughly 9.6:1. The error is in the
 * direction that matters: it would let this file certify text as legible that
 * had never been measured. So the foreground is composited over the background
 * it sits on before anything is computed.
 */
function composite(fg: Rgba, bg: Rgba): Rgba {
  return {
    r: fg.a * fg.r + (1 - fg.a) * bg.r,
    g: fg.a * fg.g + (1 - fg.a) * bg.g,
    b: fg.a * fg.b + (1 - fg.a) * bg.b,
    a: 1,
  };
}

/** WCAG relative luminance of an opaque colour. */
function luminance({ r, g, b }: Rgba): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(fgCss: string, bgCss: string): number {
  const bg = parseColour(bgCss);
  const fg = composite(parseColour(fgCss), bg);
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The colour a control's own text renders in, and the colour actually painted
 * behind it. The background is resolved by walking up from the element until a
 * non-transparent background is found, because the screen paints the tone and
 * the control itself is transparent.
 */
async function colours(page: Page, testId: string): Promise<{ fg: string; bg: string }> {
  return page.getByTestId(testId).evaluate((el: Element) => {
    // The deepest node that actually carries the label. React Native Web wraps
    // a Text in layout divs whose own computed colour is the document default
    // -- reading one of those measured black on navy and said a fixed control
    // was still broken.
    const leaf =
      Array.from(el.querySelectorAll('*')).find(
        (n) => n.children.length === 0 && (n.textContent ?? '').trim() !== ''
      ) ?? el;
    const fg = getComputedStyle(leaf).color;
    let node: Element | null = el;
    let bg = 'rgba(0, 0, 0, 0)';
    while (node) {
      const c = getComputedStyle(node).backgroundColor;
      if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) {
        bg = c;
        break;
      }
      node = node.parentElement;
    }
    return { fg, bg };
  });
}

/** A control a visitor has to be able to act on has to be readable first. */
async function expectLegible(page: Page, testId: string, floor = 4.5): Promise<number> {
  const { fg, bg } = await colours(page, testId);
  const ratio = contrast(fg, bg);
  expect(ratio, `${testId} renders ${fg} on ${bg}`).toBeGreaterThanOrEqual(floor);
  return ratio;
}

// ---- the contract ----------------------------------------------------------

/** No ordinary member navigation, by any of the names it goes under. */
async function expectNoMemberNavigation(page: Page): Promise<void> {
  await expect(page.getByTestId('wsf-member-tabs')).toHaveCount(0);
  for (const key of ['home', 'community', 'activity', 'you', 'move']) {
    await expect(page.getByTestId(`wsf-member-tab-${key}`)).toHaveCount(0);
  }
  // The links the contribution screen itself can offer.
  await expect(page.getByTestId('wsf-contribute-home')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-back')).toHaveCount(0);
  // Nothing anywhere on the screen points at a member destination. Stronger
  // than a testID sweep: it reads every anchor the page actually rendered.
  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href') ?? '')
  );
  for (const href of hrefs) {
    expect(
      /^\/(you|activity|community|move|start-community)?$/.test(href.split('?')[0]) &&
        href.split('?')[0] !== '',
      `a kiosk screen offered ${href}`
    ).toBe(false);
  }
}

/** The way out is present, and it can be read. */
async function expectFinishUsable(page: Page): Promise<void> {
  await expect(page.getByTestId('wsf-kiosk-finish-chrome')).toBeVisible();
  await expectLegible(page, 'wsf-kiosk-finish-chrome');
}

async function walkUpToEntry(page: Page, fx: Fixture): Promise<void> {
  await page.goto(`/kiosk/${fx.goalId}`);
  await expect(page.getByTestId('wsf-kiosk-screen')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('wsf-kiosk-percent')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('wsf-kiosk-start').click();
  await expect(page.getByTestId('wsf-contribute-signed-out')).toBeVisible({ timeout: 40_000 });
  await page.getByTestId('wsf-contribute-signin-link').click();
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('wsf-signin-email').fill(fx.email);
  await page.getByTestId('wsf-signin-password').fill(fx.password);
  await page.getByTestId('wsf-signin-submit').click();
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 40_000 });
}

async function contributeToReceipt(page: Page): Promise<void> {
  await page.getByTestId('wsf-contribute-entry').fill(String(ADDED));
  await page.getByTestId('wsf-contribute-review').click();
  await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible();
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText(
    `${NEW_TOTAL} of ${TARGET} ${UNIT}`
  );
}

for (const klass of [
  { key: 'tablet-800x1280', viewport: TABLET },
  { key: 'short-phone-390x640', viewport: SHORT_PHONE },
] as const) {
  test.describe(`kiosk confinement · ${klass.key}`, () => {
    test.use({ viewport: klass.viewport, deviceScaleFactor: 2 });

    test(`entry offers no way into the visitor's account · ${klass.key}`, async ({ page }) => {
      test.setTimeout(300_000);
      const fx = await seedKiosk('a');
      await walkUpToEntry(page, fx);
      await page.waitForTimeout(600);
      // The frame is written BEFORE the contract is asserted, so a run against
      // the unpatched product photographs the defect and then fails on it.
      await saveFrame(page, frame(`kiosk-entry-${klass.key}.png`));
      await expectNoMemberNavigation(page);
      await expectFinishUsable(page);
    });

    test(`the dark receipt offers no way into the visitor's account · ${klass.key}`, async ({
      page,
    }) => {
      test.setTimeout(300_000);
      const fx = await seedKiosk('r');
      await walkUpToEntry(page, fx);
      await contributeToReceipt(page);
      await expect(page.getByTestId('wsf-kiosk-finish')).toHaveText('Finish');
      await expect(page.getByTestId('wsf-kiosk-countdown')).toHaveText(
        /^Finishing in \d+ seconds?$/
      );
      await page.waitForTimeout(600);
      await saveFrame(page, frame(`kiosk-receipt-${klass.key}.png`));

      await expectNoMemberNavigation(page);
      await expectFinishUsable(page);
      // The end-of-session controls on the navy screen, each measured. `Stay`
      // and the chrome `Finish` were both drawn in the background's own colour.
      await expectLegible(page, 'wsf-kiosk-stay');
      await expectLegible(page, 'wsf-kiosk-finish');
      // The instructions -- what Finish does to the visitor's account, and how
      // long they have -- are held at the control floor, not a lower one.
      await expectLegible(page, 'wsf-kiosk-finish-explainer');
      await expectLegible(page, 'wsf-kiosk-countdown');

      // Confinement that cost the visitor their way out would be worse than
      // the defect.
      await page.getByTestId('wsf-kiosk-finish').click();
      await expect(page.getByTestId('wsf-kiosk-screen')).toBeVisible({ timeout: 40_000 });
      await expect(page.getByTestId('wsf-kiosk-total-line')).toHaveText(
        `${NEW_TOTAL} of ${TARGET} ${UNIT}`
      );
      const rested = await page.getByTestId('wsf-kiosk-screen').innerText();
      expect(rested).not.toContain(VISITOR);
    });
  });
}

/**
 * The unresolved notice is the longest string on any kiosk screen, and the
 * short phone is the class where wrapping fails first. Captured there for that
 * reason and no other -- the state itself is asserted in full at the tablet.
 */
test.describe('kiosk confinement · the unresolved notice at the short class', () => {
  test.use({ viewport: SHORT_PHONE, deviceScaleFactor: 2 });

  test('the notice wraps readably and Finish is still reachable under it', async ({ page }) => {
    test.setTimeout(300_000);
    const fx = await seedKiosk('g');
    await walkUpToEntry(page, fx);
    await page.getByTestId('wsf-contribute-entry').fill(String(ADDED));
    await page.getByTestId('wsf-contribute-review').click();
    await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible();
    await page.route('**/wsfContribute', (route: Route) => route.abort('failed'));
    await page.getByTestId('wsf-contribute-submit').click();
    await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 40_000 });

    await page.getByTestId('wsf-kiosk-finish').scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await saveFrame(page, frame('kiosk-unresolved-short-phone-390x640.png'));

    // Readable rather than clipped: the notice takes whole lines inside the
    // screen's own width, and nothing overflows it sideways.
    const box = await page.getByTestId('wsf-kiosk-unresolved-note').boundingBox();
    expect(box, 'the notice has a box').not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(SHORT_PHONE.width);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    );
    expect(overflow, 'no sideways scroll at the short class').toBe(false);

    // And the way out is still under it.
    await expect(page.getByTestId('wsf-kiosk-finish')).toBeVisible();
    await expect(page.getByTestId('wsf-kiosk-finish')).toBeEnabled();
    await expectNoMemberNavigation(page);
    await expectFinishUsable(page);
    await page.unroute('**/wsfContribute');
  });
});

test.describe('kiosk confinement · the states a correction could quietly break', () => {
  test.use({ viewport: TABLET, deviceScaleFactor: 2 });

  test('the unknown outcome keeps its guidance, its record and its confinement', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const fx = await seedKiosk('b');
    await walkUpToEntry(page, fx);

    await page.getByTestId('wsf-contribute-entry').fill(String(ADDED));
    await page.getByTestId('wsf-contribute-review').click();
    await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible();
    await page.route('**/wsfContribute', (route: Route) => route.abort('failed'));
    await page.getByTestId('wsf-contribute-submit').click();

    await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(600);
    await saveFrame(page, frame('kiosk-unresolved-tablet-800x1280.png'));
    // The state is unchanged by the correction.
    await expect(page.getByTestId('wsf-kiosk-unresolved-note')).toHaveText(
      'You can try to confirm this contribution here before you finish. Entering it again elsewhere could count it twice.'
    );
    await expect(page.getByTestId('wsf-contribute-reconcile')).toHaveText(
      'Confirm this contribution'
    );
    await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveCount(0);
    await expectNoMemberNavigation(page);
    await expectFinishUsable(page);
    // Light screen: the same controls must still read here.
    await expectLegible(page, 'wsf-kiosk-stay');
    await expectLegible(page, 'wsf-kiosk-finish');

    // Finish keeps the account-scoped attempt. The correction must not have
    // turned confinement into "clear everything on the way out".
    await page.getByTestId('wsf-kiosk-finish').click();
    await expect(page.getByTestId('wsf-kiosk-screen')).toBeVisible({ timeout: 40_000 });
    const kept = await page.evaluate(() =>
      Object.keys(window.localStorage).filter((k) => k.startsWith('wsf.pendingContribution.'))
    );
    expect(kept.length, 'the unresolved attempt is the member’s, not the device’s').toBe(1);
    expect(kept[0]).toContain(fx.uid);
    await page.unroute('**/wsfContribute');
  });

  test('a failed sign-out still refuses to show a resting screen, and now says so legibly', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const fx = await seedKiosk('c');
    await walkUpToEntry(page, fx);
    await contributeToReceipt(page);

    // Firebase Auth signs out by REMOVING its persisted user; only that
    // removal is made to fail.
    await page.evaluate(() => {
      const proto = IDBDatabase.prototype;
      const original = proto.transaction;
      proto.transaction = function patched(
        this: IDBDatabase,
        names: string | string[] | DOMStringList,
        mode?: IDBTransactionMode,
        options?: IDBTransactionOptions
      ): IDBTransaction {
        const list = typeof names === 'string' ? [names] : Array.from(names as string[]);
        if (mode === 'readwrite' && list.includes('firebaseLocalStorage')) {
          throw new DOMException('injected storage fault', 'InvalidStateError');
        }
        return original.call(this, names as string[], mode, options);
      } as typeof proto.transaction;
    });

    await page.getByTestId('wsf-kiosk-finish').click();
    await expect(page.getByTestId('wsf-kiosk-finish-error')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('wsf-kiosk-finish-error')).toHaveText(
      'We couldn’t sign you out. Don’t leave this device signed in — try Finish again.'
    );
    await page.waitForTimeout(600);
    await saveFrame(page, frame('kiosk-signout-failed-tablet-800x1280.png'));
    // The device stays put, offers Finish again — and there is still no way
    // into the account that is demonstrably still attached.
    await expect(page.getByTestId('wsf-kiosk-screen')).toBeHidden();
    await expect(page.getByTestId('wsf-kiosk-finish')).toBeEnabled();
    await expectNoMemberNavigation(page);
    await expectFinishUsable(page);
    // The warning is the whole point of the state; it has to be readable.
    await expectLegible(page, 'wsf-kiosk-finish-error');
  });

  test('ordinary personal contribution is untouched: no kiosk semantics, and its own way back', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.clock.install();
    const fx = await seedKiosk('d');

    // The same route and the same account WITHOUT the kiosk flag — reached the
    // way a member actually reaches it, FROM a mounted Community tab. A cold
    // `goto` would leave nothing to return to, and a return-assertion that
    // cannot fail is not a control. This is the part the shell migration makes
    // load-bearing: tabs are no longer on this screen to tell the two apart.
    await signInVia(page, fx.email, fx.password);
    await page.goto(`/community/${fx.groupId}`);
    const CONTEXT = `wsf-community-goal-record-${fx.goalId}`;
    const goalLink = page.getByTestId(CONTEXT);
    await expect(goalLink).toBeVisible({ timeout: 40_000 });

    expect(await markMountedContext(page, CONTEXT), 'the mount marker was planted').toBe(true);
    await goalLink.click();
    await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 40_000 });

    // 1 · NONE of the kiosk semantics. With no tab bar on any /contribute this
    //     absence set is the whole positive claim that the fix stayed scoped.
    for (const id of [
      'wsf-kiosk-finish-chrome',
      'wsf-kiosk-finish-bar',
      'wsf-kiosk-finish',
      'wsf-kiosk-countdown',
      'wsf-kiosk-stay',
    ]) {
      await expect(page.getByTestId(id)).toHaveCount(0);
    }

    // 2 · and no deadline: the whole 90 seconds pass and the member is still
    //     here, on the same screen, still signed in. The duration is the
    //     product's own; only the clock is driven.
    await page.clock.runFor(KIOSK_IDLE_MS + 5_000);
    await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible();
    expect(page.url()).toContain('/contribute/');

    // 3 · its own way back, present and reachable where a thumb lands — the
    //     same elementFromPoint method the tab assertion used, because present
    //     is not reachable.
    const back = page.getByTestId('wsf-contribute-back');
    await expect(back).toBeVisible();
    const box = await back.boundingBox();
    expect(box, 'the back control has a box').not.toBeNull();
    const hit = await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return Boolean(el?.closest('[data-testid="wsf-contribute-back"]'));
      },
      { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 }
    );
    expect(hit, 'an ordinary member can reach their way back').toBe(true);

    /*
      4 · IT RETURNS TO THE EXACT MOUNTED TAB, NOT TO A COPY OF IT.

      W1B's step 6, now asserted rather than recorded. The previous revision
      could only record it: `wsf-contribute-back` was a link to
      `/community/<groupId>`, and following it pushed a SECOND community screen
      while leaving the original mounted but hidden — measured as two instances
      with the visible one carrying no marker. The Director released the
      bounded fix for that (`5792030574`), so Back now pops the focused route
      and reveals the instance underneath, and this states the strong property.

      `:visible` rather than `.first()`: if the defect ever returns, the first
      match is the stale hidden screen and `.first()` would wait on a hidden
      element instead of failing on the claim.
    */
    await back.click();
    await expect(
      page.locator(`[data-testid="${CONTEXT}"]:visible`).first(),
      'Back returns the member to their community',
    ).toBeVisible({ timeout: 40_000 });
    expect(page.url(), 'and to the right one').toContain(`/community/${fx.groupId}`);

    expect(
      await page.getByTestId(CONTEXT).count(),
      'Back left more than one community screen in the document, so it pushed a copy rather than popping',
    ).toBe(1);
    expect(
      await visibleMarkSurvives(page, CONTEXT),
      'the community screen on show is not the one the member came from',
    ).toBe(true);
    /*
      5 · AND ITS SCROLL COMES BACK WITH IT — ASKED WHERE THERE IS A SCROLL TO
      ASK ABOUT.

      At 800x1280 this community page does not scroll at all — it fits, with
      nothing to restore — and it had about thirty pixels of travel before the
      empty chrome row came out of it. Thirty pixels is inside what a single
      re-flow can clamp away on the way back: measured, the page came back at 0
      from a 30, and comes back at 294 from a 294 when there is real travel. An
      equality asserted at the tablet class would therefore be reporting the
      re-flow, or nothing at all, and an inequality would be the weaker claim
      W1B has already caught me making quietly.

      W1B's residual (#436 `5792137856`), accepted, is inside this: an earlier
      revision of mine read the offset on ARRIVAL, before anything had
      scrolled, so the recorded pair was 0/0 and proved nothing in either
      direction. The offset is planted, and the browser's own clamp of it read
      back, before the member leaves.

      So the journey is made again at a phone height, on the SAME mounted
      screen — the viewport is resized rather than re-entered, so nothing is
      remounted and the marker planted at the top of this test still applies —
      and the claim is exact there: 430px of travel, the offset planted, the
      clamped value read back, and the value after Back equal to it.
    */
    await page.setViewportSize({ width: 390, height: 640 });
    await page.waitForTimeout(500);
    const phoneScrolled = await page.evaluate((id) => {
      let el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
      while (el) {
        if (el.scrollHeight > el.clientHeight + 1) {
          el.scrollTop = 240;
          return el.scrollTop;
        }
        el = el.parentElement;
      }
      return null;
    }, CONTEXT);
    expect(
      phoneScrolled,
      'the community page has real travel at a phone height, so the scroll claim can fail',
    ).toBeGreaterThanOrEqual(100);

    await page.getByTestId(CONTEXT).first().click();
    await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 40_000 });
    await page.getByTestId('wsf-contribute-back').click();
    await expect(
      page.locator(`[data-testid="${CONTEXT}"]:visible`).first(),
      'phone height: Back returns the member to their community',
    ).toBeVisible({ timeout: 40_000 });
    expect(
      await page.getByTestId(CONTEXT).count(),
      'phone height: Back pushed a copy rather than popping',
    ).toBe(1);
    expect(
      await visibleMarkSurvives(page, CONTEXT),
      'phone height: the community screen on show is not the one the member came from',
    ).toBe(true);
    expect(
      await contextScroll(page, CONTEXT),
      'its scroll did not come back with it',
    ).toBe(phoneScrolled);

    // And back to the class this test's frame is taken at.
    await page.setViewportSize({ width: 800, height: 1280 });
    await page.waitForTimeout(400);

    await page.waitForTimeout(500);
    await saveFrame(page, frame('ordinary-contribution-returns-to-its-tab-tablet-800x1280.png'));
  });

  test('a repeated ?kiosk parameter is one verdict, not two', async ({ page }) => {
    test.setTimeout(300_000);
    const fx = await seedKiosk('f');
    // A URL can carry the same key twice. The router hands that over as an
    // array, and while only the shell normalised it the two halves of one
    // journey disagreed: the shell called it a kiosk and hid the bar, the
    // screen called it ordinary and withheld Finish, leaving a shared device
    // with the screen's own member exits and nothing to end the session with.
    // Driven as a real navigation, not asserted on the predicate alone.
    await signInVia(page, fx.email, fx.password);
    await page.goto(`/contribute/${fx.goalId}?kiosk=1&kiosk=x`);
    await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 40_000 });

    await expectNoMemberNavigation(page);
    await expectFinishUsable(page);

    // And the same URL with no recognised value is an ORDINARY contribution:
    // failing closed must not mean treating every duplicate as a kiosk.
    await page.goto(`/contribute/${fx.goalId}?kiosk=0&kiosk=no`);
    await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 40_000 });
    /*
      The bar assertion that used to sit here is gone, not weakened:
      `/contribute` is barless for everyone now, so it discriminated nothing.
      The line below already carried "this is ordinary" on its own — a
      duplicate `?kiosk` with no recognised value must NOT be read as a kiosk,
      and the absence of the Finish chrome is exactly that claim.
    */
    await expect(page.getByTestId('wsf-kiosk-finish-chrome')).toHaveCount(0);
    await expect(page.getByTestId('wsf-contribute-back'), 'and it keeps its ordinary way back').toBeVisible();
  });

  test('the boundary: this is in-app confinement, not a device lockdown', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seedKiosk('e');
    await walkUpToEntry(page, fx);
    await expectNoMemberNavigation(page);

    // Said plainly, because the evidence should not imply more than it proves:
    // a web page cannot take the URL bar away from somebody who wants it. What
    // the correction removes is every route the PRODUCT offers out of a kiosk
    // session; typing an address is not one of them.
    await page.goto('/you');
    await expect(page.getByTestId('wsf-you')).toBeVisible({ timeout: 40_000 });
    // `wsf-you` is visible while the profile is still loading -- W5 corrected
    // its own instrument for exactly this and said so, so the wait is for the
    // name itself rather than for the container.
    await expect(page.getByTestId('wsf-you')).toContainText(VISITOR, { timeout: 40_000 });
  });
});
