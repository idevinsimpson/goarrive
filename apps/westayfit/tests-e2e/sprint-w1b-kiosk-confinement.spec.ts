import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';

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

  test('ordinary personal contribution is untouched and keeps its tabs', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seedKiosk('d');
    // The same route and the same account, WITHOUT the kiosk flag: a member on
    // their own phone. The correction is scoped to the kiosk context, and this
    // is what proves it.
    await signInVia(page, fx.email, fx.password);
    await page.goto(`/contribute/${fx.goalId}?groupId=${fx.groupId}`);
    await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 40_000 });

    await expect(page.getByTestId('wsf-member-tabs')).toBeVisible();
    for (const key of ['home', 'community', 'activity', 'you', 'move']) {
      await expect(page.getByTestId(`wsf-member-tab-${key}`)).toBeVisible();
    }
    // Present is not the same as reachable: the bar has to own the point a
    // thumb actually lands on, which is how W5 measured it.
    const box = await page.getByTestId('wsf-member-tab-you').boundingBox();
    expect(box, 'the You tab has a box').not.toBeNull();
    const hit = await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return Boolean(el?.closest('[data-testid="wsf-member-tabs"]'));
      },
      { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 }
    );
    expect(hit, 'an ordinary member can still reach their own tabs').toBe(true);
    await page.waitForTimeout(500);
    await saveFrame(page, frame('ordinary-contribution-keeps-its-tabs-tablet-800x1280.png'));
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
    await expect(page.getByTestId('wsf-member-tabs')).toBeVisible();
    await expect(page.getByTestId('wsf-kiosk-finish-chrome')).toHaveCount(0);
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
