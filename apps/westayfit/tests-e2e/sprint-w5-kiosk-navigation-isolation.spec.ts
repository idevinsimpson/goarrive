import { randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

/**
 * W5 PROBE — THE KIOSK NAVIGATION SEAM.
 *
 * W1B reported (#423) that the member shell's bottom bar is on screen during
 * a kiosk contribution. A BAR'S EXISTENCE IS NOT BY ITSELF AN IDENTITY LEAK,
 * so this probe does not assert on the bar. It asks the two questions a bar
 * cannot answer on its own:
 *
 *   1. WHAT DOES AN ORDINARY TAP ACTUALLY PERMIT? A visitor signs in at the
 *      shared device and taps a destination in the chrome. Does that land on
 *      a surface that names the account, and does anything there still end
 *      the session? A door that leads back into the same flow is a wart; a
 *      door onto somebody's identity with no way out is the thing the kiosk
 *      exists to prevent.
 *
 *   2. DOES THE DEVICE CLEAR THE VISITOR WHEN IT COMES BACK TO REST? The
 *      start screen signs out whoever is still attached when the kiosk comes
 *      to rest on it (app/kiosk/[goalId].tsx). If that holds after a tab tap
 *      and a Back, the seam is a navigation defect and not a carry-over of
 *      one visitor into the next.
 *
 * WHAT IS KEPT SEPARATE. An UNRESOLVED attempt surviving the session is not
 * leaked state: it is the member's own record, keyed to their uid, and the
 * kiosk is required to preserve it (src/kioskSession.ts). The second test
 * asserts that preservation and the kiosk-owned reset in the same breath, so
 * neither can be mistaken for the other.
 *
 * ATTACHMENT IS READ FROM THE AUTH STORE, NOT FROM THE SCREEN. A surface that
 * shows no name may still be signed in; `readAuthRecords` opens the Firebase
 * web SDK's IndexedDB store, which is what the next visitor would inherit.
 *
 * Every account, community, goal and total below is fixture data seeded into
 * the local emulators for the run.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'demo-wsf-local';
const PHONE = { width: 390, height: 844 };
/** The contribution callable, for the one case that has to lose its answer. */
const CONTRIBUTE_CALLABLE = /wsfContribute/;

async function seedVerifiedUser(email: string, password: string): Promise<string> {
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

async function firestoreWrite(docPath: string, fields: Record<string, unknown>): Promise<void> {
  const url =
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}` +
    `/databases/(default)/documents/${docPath}`;
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

async function seedGoal(
  groupId: string,
  ownerUid: string,
  goalId: string,
  total: number,
  status: 'active' | 'closed' = 'active'
): Promise<void> {
  const now = new Date();
  // A closed goal's window is in the past; an active one's is still open.
  const endsInMs = status === 'closed' ? -1 * 24 * 60 * 60_000 : 3 * 24 * 60 * 60_000;
  await firestoreWrite(`wsfGoals/${goalId}`, {
    ownerUid: { stringValue: ownerUid },
    communityGroupId: { stringValue: groupId },
    title: { stringValue: 'Squats together this week' },
    target: { integerValue: '500' },
    unit: { stringValue: 'squats' },
    status: { stringValue: status },
    startsAt: tsField(new Date(now.getTime() + endsInMs - 14 * 24 * 60 * 60_000)),
    endsAt: tsField(new Date(now.getTime() + endsInMs)),
    timezone: { stringValue: 'America/New_York' },
    aggregateDisplayAuthorized: { booleanValue: true },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });
  await seedShards(goalId, total);
}

async function seedProfile(uid: string, displayName: string): Promise<void> {
  const now = new Date();
  await firestoreWrite(`wsfMemberProfiles/${uid}`, {
    displayName: { stringValue: displayName },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });
}

async function seedCommunity(
  tag: string,
  members: Array<{ uid: string; role: 'foundingChampion' | 'member' }>
): Promise<string> {
  const now = new Date();
  const groupId = `w5kn-${tag}`;
  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: 'Maple Street Movers' },
    groupType: { stringValue: 'familyFriends' },
    joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: randomBytes(12).toString('base64url') },
    createdByUserId: { stringValue: members[0]!.uid },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
    createdAt: tsField(new Date(now.getTime() - 40 * 24 * 60 * 60_000)),
    updatedAt: tsField(now),
  });
  for (const m of members) {
    await firestoreWrite(`wsfMemberships/${groupId}_${m.uid}`, {
      groupId: { stringValue: groupId },
      userId: { stringValue: m.uid },
      role: { stringValue: m.role },
      membershipStatus: { stringValue: 'active' },
      createdAt: tsField(now),
      updatedAt: tsField(now),
    });
  }
  return groupId;
}

type Fx = {
  stamp: string;
  password: string;
  goalId: string;
  groupId: string;
  championUid: string;
  memberEmail: string;
  memberName: string;
  memberUid: string;
  /** The next person in the queue. Deliberately not a variation on the first
   *  visitor's name, so a `not.toContain` about A cannot pass or fail because
   *  of B's own screen. */
  visitorEmail: string;
  visitorName: string;
  visitorUid: string;
};

async function seedBase(tag: string): Promise<Fx> {
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const password = 'w5kn-password';
  const memberEmail = `wsf-w5kn-member-${tag}-${stamp}@example.com`;
  const championEmail = `wsf-w5kn-champ-${tag}-${stamp}@example.com`;
  const visitorEmail = `wsf-w5kn-second-${tag}-${stamp}@example.com`;
  const championUid = await seedVerifiedUser(championEmail, password);
  const memberUid = await seedVerifiedUser(memberEmail, password);
  const visitorUid = await seedVerifiedUser(visitorEmail, password);
  const memberName = 'Fixture Kiosk Visitor';
  const visitorName = 'Dana Second Walkup';
  await seedProfile(championUid, 'Fixture Champion');
  await seedProfile(memberUid, memberName);
  await seedProfile(visitorUid, visitorName);
  const groupId = await seedCommunity(`${tag}-${stamp}`, [
    { uid: championUid, role: 'foundingChampion' },
    { uid: memberUid, role: 'member' },
    { uid: visitorUid, role: 'member' },
  ]);
  const goalId = `w5kn-goal-${tag}-${stamp}`;
  await seedGoal(groupId, championUid, goalId, 241);
  return {
    stamp,
    password,
    goalId,
    groupId,
    championUid,
    memberEmail,
    memberName,
    memberUid,
    visitorEmail,
    visitorName,
    visitorUid,
  };
}

/**
 * The accounts Firebase Auth has persisted for this origin. The web SDK's
 * default persistence is IndexedDB, so this — not the screen, and not
 * localStorage — is what the next visitor would walk up to.
 *
 * IT REPORTS A FAILED INSPECTION AS A FAILED INSPECTION.
 *
 * The first version of this helper resolved `[]` on every error path, which is
 * the single worst thing a probe of this kind can do: a store that could not be
 * opened would have read as "nobody is signed in", and the sign-out-failure
 * case below deliberately breaks IndexedDB. An empty store and an unreadable
 * store are different facts and are kept different here; `authKeys` throws
 * rather than let the second pass for the first.
 */
type AuthProbe = { ok: true; keys: string[] } | { ok: false; error: string };

async function readAuthRecords(page: Page): Promise<AuthProbe> {
  return page.evaluate(
    () =>
      new Promise<AuthProbe>((resolve) => {
        let req: IDBOpenDBRequest;
        try {
          req = indexedDB.open('firebaseLocalStorageDb');
        } catch (e) {
          resolve({ ok: false, error: `open threw: ${String(e)}` });
          return;
        }
        req.onerror = () => resolve({ ok: false, error: 'open failed' });
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('firebaseLocalStorage')) {
            db.close();
            // A store that was never created is a genuinely empty device.
            resolve({ ok: true, keys: [] });
            return;
          }
          let all: IDBRequest<IDBValidKey[]>;
          try {
            all = db
              .transaction('firebaseLocalStorage', 'readonly')
              .objectStore('firebaseLocalStorage')
              .getAllKeys();
          } catch (e) {
            db.close();
            resolve({ ok: false, error: `readonly transaction threw: ${String(e)}` });
            return;
          }
          all.onsuccess = () => {
            db.close();
            resolve({ ok: true, keys: (all.result as unknown[]).map(String) });
          };
          all.onerror = () => {
            db.close();
            resolve({ ok: false, error: 'getAllKeys failed' });
          };
        };
      })
  );
}

/** The persisted accounts, or a thrown error. Never a silent empty list. */
async function authKeys(page: Page): Promise<string[]> {
  const probe = await readAuthRecords(page);
  if (!probe.ok) {
    throw new Error(
      `auth store could not be inspected (${probe.error}) — this is NOT evidence of a signed-out device`
    );
  }
  return probe.keys;
}

async function signedInAccounts(page: Page): Promise<string[]> {
  return (await authKeys(page)).filter((k) => k.startsWith('firebase:authUser:'));
}

async function readStorage(page: Page): Promise<{ local: string[]; session: string[] }> {
  return page.evaluate(() => ({
    local: Object.keys(window.localStorage),
    session: Object.keys(window.sessionStorage),
  }));
}

/**
 * EVERY WAY OUT OF THE KIOSK SESSION THAT A THUMB CAN REACH.
 *
 * The contract, expressed once and reused on every kiosk screen. It enumerates
 * the page's interactive elements, keeps only the ones whose centre actually
 * resolves to themselves under `elementFromPoint`, and reports two kinds of
 * offender:
 *
 *   @outside-screen  chrome that is not part of the screen or the kiosk's own
 *                    controls — a tab bar, a drawer, anything persistent.
 *   ->/href          a link that leaves the kiosk's own routes, wherever it
 *                    sits. "Back to home" inside the card is an exit even
 *                    though it is inside the card.
 *
 * Asserting on this rather than on a testID is the whole point: a renamed bar,
 * a restyled bar, or a bar moved into a drawer all fail it, and none of them
 * fail a check that `wsf-member-tabs` is gone.
 */
async function escapeControls(page: Page, roots: string[]): Promise<string[]> {
  return page.evaluate((rootSels) => {
    const allowed = [
      ...rootSels,
      '[data-testid="wsf-kiosk-finish-chrome"]',
      '[data-testid="wsf-kiosk-finish-bar"]',
    ];
    const out: string[] = [];
    const els = Array.from(
      document.querySelectorAll(
        'a[href], button, input, select, textarea, [role="link"], [role="button"], [tabindex]:not([tabindex="-1"])'
      )
    );
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) continue;
      const hit = document.elementFromPoint(cx, cy);
      if (!hit || !(el === hit || el.contains(hit))) continue;
      const id = el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.tagName;
      if (!allowed.some((sel) => el.closest(sel))) {
        out.push(`${id}@outside-screen`);
        continue;
      }
      const href = el.getAttribute('href');
      if (href != null && !/^\/contribute\//.test(href) && !/^\/kiosk\//.test(href)) {
        out.push(`${id}->${href}`);
      }
    }
    return out;
  }, roots);
}

/**
 * CONTRAST, MEASURED THE WAY A READER ACTUALLY SEES IT.
 *
 * Two things a naive reading gets wrong, and both of them here:
 *
 * TRANSLUCENT TEXT. A caption at `rgba(247,245,240,0.78)` is not that colour on
 * screen — it is that colour composited over whatever is behind it. Comparing
 * the raw value against the background reports a ratio nobody experiences.
 * The alpha is composited before the luminance is taken.
 *
 * THE FLOOR DEPENDS ON THE TEXT. WCAG AA is 3:1 for large text (>=24px, or
 * >=18.66px when bold) and 4.5:1 for everything else. A countdown at 14px does
 * not get to be judged by the headline's standard, so the floor is chosen per
 * control from its own computed size and weight rather than fixed at the most
 * forgiving number.
 */
type ContrastReading = {
  present: boolean;
  ratio: number;
  fontSize: number;
  weight: number;
  floor: number;
  fg: string;
  bg: string;
};

async function measureContrast(page: Page, testIds: string[]): Promise<Record<string, ContrastReading>> {
  return page.evaluate((ids) => {
    const parse = (c: string): [number, number, number, number] => {
      const m = c.match(/-?[\d.]+/g);
      if (!m) return [0, 0, 0, 1];
      return [Number(m[0]), Number(m[1]), Number(m[2]), m[3] === undefined ? 1 : Number(m[3])];
    };
    const over = (
      fg: [number, number, number, number],
      bg: [number, number, number, number]
    ): [number, number, number] => [
      fg[3] * fg[0] + (1 - fg[3]) * bg[0],
      fg[3] * fg[1] + (1 - fg[3]) * bg[1],
      fg[3] * fg[2] + (1 - fg[3]) * bg[2],
    ];
    const lum = ([r, g, b]: [number, number, number]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const out: Record<string, ContrastReading> = {};
    for (const id of ids) {
      const host = document.querySelector(`[data-testid="${id}"]`);
      if (!host) {
        out[id] = { present: false, ratio: 0, fontSize: 0, weight: 0, floor: 0, fg: '', bg: '' };
        continue;
      }
      // The colour lives on the text node's element; a Pressable is a
      // transparent wrapper around it.
      const textEl =
        host.textContent && host.children.length
          ? (Array.from(host.querySelectorAll('*')).find((n) => n.textContent?.trim()) ?? host)
          : host;
      const cs = getComputedStyle(textEl);
      const fg = parse(cs.color);
      // The first ancestor that actually paints something, composited down in
      // case that one is itself translucent.
      let node: Element | null = textEl;
      let bg: [number, number, number] = [255, 255, 255];
      const stack: [number, number, number, number][] = [];
      while (node) {
        const c = parse(getComputedStyle(node).backgroundColor);
        if (c[3] > 0) {
          stack.push(c);
          if (c[3] === 1) break;
        }
        node = node.parentElement;
      }
      for (let i = stack.length - 1; i >= 0; i -= 1) bg = over(stack[i], [...bg, 1] as [number, number, number, number]);
      const painted = over(fg, [...bg, 1] as [number, number, number, number]);
      const fontSize = parseFloat(cs.fontSize) || 0;
      const weight = Number(cs.fontWeight) || 400;
      const large = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
      const a = lum(painted);
      const b = lum(bg);
      out[id] = {
        present: true,
        ratio: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100,
        fontSize,
        weight,
        floor: large ? 3 : 4.5,
        fg: cs.color,
        bg: `rgb(${bg.map((v) => Math.round(v)).join(',')})`,
      };
    }
    return out;
  }, testIds);
}

/** The walk-up, up to the point a visitor is signed in and looking at the
 *  kiosk's contribution entry screen. */
async function walkUpAndSignIn(page: Page, fx: Fx): Promise<void> {
  await page.goto(`/kiosk/${fx.goalId}`);
  await expect(page.getByTestId('wsf-kiosk-screen')).toBeVisible({ timeout: 25_000 });
  await page.getByTestId('wsf-kiosk-start').click();
  await page.waitForURL(/\/contribute\/.*kiosk=1/, { timeout: 25_000 });
  await expect(page.getByTestId('wsf-contribute-signed-out')).toBeVisible({ timeout: 25_000 });
  await page.getByTestId('wsf-contribute-signin-link').click();
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 25_000 });
  await page.getByTestId('wsf-signin-email').fill(fx.memberEmail);
  await page.getByTestId('wsf-signin-password').fill(fx.password);
  await page.getByTestId('wsf-signin-submit').click();
  await page.waitForURL(/\/contribute\/.*kiosk=1/, { timeout: 30_000 });
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 30_000 });
}

test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

// ---- CASE 1 ---------------------------------------------------------------
test('an ordinary tap from the kiosk contribution screen stays inside the kiosk session', async ({
  page,
}) => {
  test.setTimeout(300_000);
  // W5-K1. RETIRED at product 50806fa: the shell no longer renders over the
  // kiosk's contribution screen, so this case now takes its early return and
  // passes because THERE IS NOTHING TO TAP. That is a weak pass by
  // construction, and it is left exactly as it was written rather than
  // rewritten into a stronger one -- it is the historical record of the
  // defect, and W5-K4 is what actually holds the line now.
  const fx = await seedBase('taps');
  await walkUpAndSignIn(page, fx);

  // The kiosk's own chrome is shaped as designed: no Back into the member's
  // community, and a Finish that ends the session.
  await expect(page.getByTestId('wsf-contribute-back')).toHaveCount(0);
  await expect(page.getByTestId('wsf-kiosk-finish-chrome')).toBeVisible();

  // The measurement, not the verdict: is there any other chrome on screen?
  const tabs = page.getByTestId('wsf-member-tabs');
  const tabsPresent = (await tabs.count()) > 0;
  test.info().annotations.push({
    type: 'kiosk-shell-chrome',
    description: `member tab bar present on /contribute/${fx.goalId}?kiosk=1: ${tabsPresent}`,
  });
  if (!tabsPresent) {
    // Nothing to tap: the seam does not reproduce on this head and there is
    // no further question to ask.
    return;
  }

  // The bar is real chrome, not an offscreen node: it is hit-testable where
  // a thumb would land.
  const you = page.getByTestId('wsf-member-tab-you');
  await expect(you).toBeVisible();
  const box = (await you.boundingBox())!;
  const reachable = await page.evaluate(
    ([x, y]) => {
      const hit = document.elementFromPoint(x as number, y as number);
      const bar = document.querySelector('[data-testid="wsf-member-tabs"]');
      return Boolean(hit && bar && bar.contains(hit));
    },
    [box.x + box.width / 2, box.y + box.height / 2]
  );
  expect(reachable, 'the tab is under the thumb, not merely in the DOM').toBe(true);

  // THE TAP. One press, no gestures, nothing a visitor would not do.
  await you.click();
  await page.waitForURL(/\/you\b/, { timeout: 25_000 });
  await expect(page.getByTestId('wsf-you')).toBeVisible({ timeout: 25_000 });
  // SETTLED, NOT MERELY MOUNTED. `wsf-you` is on screen while the profile is
  // still loading, and reading its text then would report "the visitor is not
  // named here" about a spinner. Wait for one of the screen's terminal states
  // — identity, signed-out, or no-community — before measuring anything.
  await expect
    .poll(
      async () =>
        (await page.getByTestId('wsf-you-identity').count()) +
        (await page.getByTestId('wsf-you-signed-out').count()) +
        (await page.getByTestId('wsf-you-no-community').count()),
      { timeout: 25_000, intervals: [100] }
    )
    .toBeGreaterThan(0);

  const landedText = await page.getByTestId('wsf-you').innerText();
  const attachedThere = await signedInAccounts(page);
  const wayOut =
    (await page.getByTestId('wsf-kiosk-finish').count()) +
    (await page.getByTestId('wsf-kiosk-finish-chrome').count());
  const emailShown =
    (await page.getByTestId('wsf-you-email').count()) > 0 &&
    (await page.getByTestId('wsf-you-email').innerText()).includes(fx.memberEmail);
  const signOutOffered = (await page.getByTestId('wsf-you-signout').count()) > 0;
  test.info().annotations.push({
    type: 'kiosk-tap-outcome',
    description:
      `url=${new URL(page.url()).pathname} ` +
      `namesVisitor=${landedText.includes(fx.memberName)} emailShown=${emailShown} ` +
      `signOutOffered=${signOutOffered} ` +
      `stillAttached=${attachedThere.length > 0} kioskFinishControls=${wayOut}`,
  });

  // The second ordinary tap, recorded for the same reason as the first: what
  // one press permits is the whole question, and Progress is the member's own
  // recorded movement rather than a public surface.
  if ((await page.getByTestId('wsf-member-tab-activity').count()) > 0) {
    await page.getByTestId('wsf-member-tab-activity').click();
    await page.waitForURL(/\/activity\b/, { timeout: 25_000 });
    await expect(page.getByTestId('wsf-activity')).toBeVisible({ timeout: 25_000 });
    const privateSurface = (await page.getByTestId('wsf-activity-signed-out').count()) === 0;
    test.info().annotations.push({
      type: 'kiosk-tap-outcome-progress',
      description:
        `url=${new URL(page.url()).pathname} ` +
        `rendersAsSignedIn=${privateSurface} ` +
        `stillAttached=${(await signedInAccounts(page)).length > 0} ` +
        `kioskFinishControls=${await page.getByTestId('wsf-kiosk-finish').count()}`,
    });
  }

  // The two facts that decide whether this is a wart or a leak. Either one
  // alone is survivable; together they are a shared device sitting on
  // somebody's identity with nothing on screen that ends the session.
  expect(
    landedText.includes(fx.memberName) || landedText.includes(fx.memberEmail),
    'a tap from the kiosk flow must not land on a surface that names the visitor'
  ).toBe(false);
  expect(wayOut, 'wherever a tap lands, the kiosk session must still be endable').toBeGreaterThan(0);
});

// ---- CASE 2 ---------------------------------------------------------------
test('after a tap away and a Back, the device clears the visitor before the next one starts', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const fx = await seedBase('rest');
  await walkUpAndSignIn(page, fx);

  // The account IS attached at this point — that is what makes everything
  // after it mean something.
  expect((await signedInAccounts(page)).length).toBeGreaterThan(0);

  const tabsPresent = (await page.getByTestId('wsf-member-tabs').count()) > 0;
  if (tabsPresent) {
    await page.getByTestId('wsf-member-tab-you').click();
    await page.waitForURL(/\/you\b/, { timeout: 25_000 });
    await expect(page.getByTestId('wsf-you')).toBeVisible({ timeout: 25_000 });
    // BACK, from where the tap left the visitor. The tabs navigate with
    // `replace`, so the entry this returns to is the kiosk start screen.
    await page.goBack();
  } else {
    await page.goBack();
  }

  // THE DEVICE COMES TO REST. Whether Back landed there or not, the next
  // person's walk-up begins at the kiosk's own URL, so that is where the
  // reset has to hold.
  await page.goto(`/kiosk/${fx.goalId}`);
  await expect(page.getByTestId('wsf-kiosk-screen')).toBeVisible({ timeout: 25_000 });

  // 1. Auth attachment, read from the store rather than from the screen.
  await expect
    .poll(async () => (await signedInAccounts(page)).length, { timeout: 20_000, intervals: [200] })
    .toBe(0);
  // 2. The kiosk's own handoff key is gone.
  const atRest = await readStorage(page);
  expect(atRest.session).not.toContain('wsf.kioskReturnGoalId');
  // 3. Nothing on the start screen names who was just here.
  const startText = await page.getByTestId('wsf-kiosk-screen').innerText();
  expect(startText).not.toContain(fx.memberName);
  expect(startText).not.toContain(fx.memberEmail);

  // 4. THE SECOND SYNTHETIC VISITOR. They press the one action and must meet
  //    the sign-in gate, not the previous visitor's session.
  await page.getByTestId('wsf-kiosk-start').click();
  await expect(page.getByTestId('wsf-contribute-signed-out')).toBeVisible({ timeout: 25_000 });
  const gateText = await page.getByTestId('wsf-contribute-signed-out').innerText();
  expect(gateText).not.toContain(fx.memberName);
  expect(gateText).not.toContain(fx.memberEmail);

  // 5. And signing in as themselves gets them their own session.
  await page.getByTestId('wsf-contribute-signin-link').click();
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 25_000 });
  await page.getByTestId('wsf-signin-email').fill(fx.visitorEmail);
  await page.getByTestId('wsf-signin-password').fill(fx.password);
  await page.getByTestId('wsf-signin-submit').click();
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 30_000 });
  const entryText = await page.getByTestId('wsf-contribute-entry-screen').innerText();
  expect(entryText).not.toContain(fx.memberName);
  expect(entryText).not.toContain(fx.memberEmail);
});

// ---- CASE 3 ---------------------------------------------------------------
test('an unresolved attempt survives the visitor leaving, and kiosk-owned state does not', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const fx = await seedBase('unresolved');
  await walkUpAndSignIn(page, fx);

  // The request leaves and is served; the answer never gets back. Nobody —
  // not the visitor, not the device — knows whether it was recorded.
  await page.route(CONTRIBUTE_CALLABLE, async (route) => {
    await route.fetch();
    await route.abort('connectionfailed');
  });
  await page.getByTestId('wsf-contribute-entry').fill('13');
  await page.getByTestId('wsf-contribute-review').click();
  await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible({ timeout: 25_000 });
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 40_000 });
  await page.unroute(CONTRIBUTE_CALLABLE);

  // The member's own record of that attempt, keyed to the goal AND their uid.
  const pendingKey = `wsf.pendingContribution.${fx.goalId}.${fx.memberUid}`;
  expect((await readStorage(page)).local).toContain(pendingKey);

  // The visitor leaves the flow the way this probe is about — by chrome if
  // there is any, otherwise straight back to the device's start screen.
  if ((await page.getByTestId('wsf-member-tabs').count()) > 0) {
    await page.getByTestId('wsf-member-tab-activity').click();
    await page.waitForURL(/\/activity\b/, { timeout: 25_000 });
  }
  await page.goto(`/kiosk/${fx.goalId}`);
  await expect(page.getByTestId('wsf-kiosk-screen')).toBeVisible({ timeout: 25_000 });

  // KIOSK-OWNED STATE GOES.
  await expect
    .poll(async () => (await signedInAccounts(page)).length, { timeout: 20_000, intervals: [200] })
    .toBe(0);
  const atRest = await readStorage(page);
  expect(atRest.session).not.toContain('wsf.kioskReturnGoalId');

  // THE MEMBER'S UNRESOLVED ATTEMPT STAYS. It is scoped to a uid that is no
  // longer signed in, is only ever read back by that same uid, and is the one
  // artefact that lets them replay the SAME attempt instead of booking a
  // second contribution. Erasing it to make the device look clean would be
  // the defect, not the fix.
  expect(atRest.local).toContain(pendingKey);

  // And it is not something the next visitor can see or inherit: the gate
  // names nobody, and the record stays out of their session.
  await page.getByTestId('wsf-kiosk-start').click();
  await expect(page.getByTestId('wsf-contribute-signed-out')).toBeVisible({ timeout: 25_000 });
  await page.getByTestId('wsf-contribute-signin-link').click();
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 25_000 });
  await page.getByTestId('wsf-signin-email').fill(fx.visitorEmail);
  await page.getByTestId('wsf-signin-password').fill(fx.password);
  await page.getByTestId('wsf-signin-submit').click();
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 30_000 });
  const entryText = await page.getByTestId('wsf-contribute-entry-screen').innerText();
  expect(entryText).not.toContain('13');
  expect(entryText).not.toContain(fx.memberName);
  // B never sees A's row, and the reconcile offer is A's alone.
  await expect(page.getByTestId('wsf-contribute-reconcile')).toHaveCount(0);
});

// ---- CASE 4 ---------------------------------------------------------------
/*
  THE CONTRACT, NOT THE LOCATOR.

  The obvious way to "fix" the seam is to stop rendering the shell over
  /contribute, and the obvious way to verify that is to assert the bar's
  testID is gone. Both are traps: the first breaks ordinary member navigation
  (CASE 5 is the control that catches it), and the second passes for any
  rename, any restyle, and any bar that is merely moved offscreen while still
  reachable by a tab press.

  So this asks the question the contract is actually about: from the kiosk's
  contribution screen, is there ANY hit-testable control that is not part of
  the kiosk session? It enumerates every interactive element on the page,
  keeps the ones a thumb can actually reach, and allows only the screen's own
  content and the kiosk's own controls. A bar under another name, a drawer, a
  wordmark that navigates — all of them fail this, and none of them fail a
  locator check.
*/
test('nothing hit-testable on the kiosk contribution screen leads out of the kiosk session', async ({
  page,
}) => {
  test.setTimeout(300_000);
  // W5-K4. RETIRED at product 50806fa: ordinary passing coverage now.
  const fx = await seedBase('contract');
  await walkUpAndSignIn(page, fx);

  const offenders = await escapeControls(page, [
    '[data-testid="wsf-contribute-entry-screen"]',
    '[data-testid="wsf-contribute-context"]',
  ]);

  test.info().annotations.push({
    type: 'kiosk-escape-controls',
    description: offenders.length ? offenders.join(' | ') : 'none',
  });
  expect(
    offenders,
    'every reachable control on a kiosk contribution screen belongs to the kiosk session'
  ).toEqual([]);
});

// ---- CASE 5 ---------------------------------------------------------------
/*
  THE CONTROL CASE, and the reason CASE 4 cannot be trusted on its own.

  The shell is supposed to be on an ordinary member's contribution screen —
  that is a member surface, reached from their own community, and the bar is
  how they leave it. A patch that closes the kiosk seam by dropping
  /contribute from the shell's prefixes would turn CASE 4 green and take this
  with it. This must pass BEFORE the patch and AFTER it; it is the half of the
  contract that says what must not change.
*/
test('the shell is unchanged for an ordinary member: /contribute without the kiosk flag still wears it', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const fx = await seedBase('ordinary');

  // The ordinary way in. Signing in from a bare /contribute/<goalId> does NOT
  // return there — with no kiosk handoff key there is nothing for
  // nextRouteAfterAuth() to read, so the member lands on their community, the
  // way any member arriving without a destination does. That is the ordinary
  // journey, so this follows it and then opens the goal the way a member
  // would, rather than asserting a return that the product never promised.
  await page.goto(`/contribute/${fx.goalId}`);
  await expect(page.getByTestId('wsf-contribute-signed-out')).toBeVisible({ timeout: 25_000 });
  await page.getByTestId('wsf-contribute-signin-link').click();
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 25_000 });
  await page.getByTestId('wsf-signin-email').fill(fx.memberEmail);
  await page.getByTestId('wsf-signin-password').fill(fx.password);
  await page.getByTestId('wsf-signin-submit').click();
  await page.waitForURL(/\/community\//, { timeout: 30_000 });
  await expect
    .poll(async () => (await signedInAccounts(page)).length, { timeout: 25_000, intervals: [200] })
    .toBeGreaterThan(0);

  await page.goto(`/contribute/${fx.goalId}`);
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 30_000 });
  expect(page.url()).not.toMatch(/kiosk=/);

  // The member's own chrome: the shell, and the Back the kiosk deliberately
  // replaces. Neither is a kiosk control.
  await expect(page.getByTestId('wsf-member-tabs')).toBeVisible();
  await expect(page.getByTestId('wsf-contribute-back')).toBeVisible();
  await expect(page.getByTestId('wsf-kiosk-finish-chrome')).toHaveCount(0);
  await expect(page.getByTestId('wsf-kiosk-finish')).toHaveCount(0);

  // And the four destinations still work as destinations for the member whose
  // screen this is.
  await page.getByTestId('wsf-member-tab-you').click();
  await page.waitForURL(/\/you\b/, { timeout: 25_000 });
  await expect
    .poll(async () => page.getByTestId('wsf-you-identity').count(), {
      timeout: 25_000,
      intervals: [100],
    })
    .toBeGreaterThan(0);
  await expect(page.getByTestId('wsf-member-tabs')).toBeVisible();
  await page.getByTestId('wsf-member-tab-activity').click();
  await page.waitForURL(/\/activity\b/, { timeout: 25_000 });
  await expect(page.getByTestId('wsf-activity')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('wsf-member-tabs')).toBeVisible();
});

// ---- CASE 6 ---------------------------------------------------------------
/*
  BROWSER BACK, WITH ITS ACTUAL SCOPE.

  What is claimed: the history entry behind the kiosk's contribution screen is
  the kiosk's own start screen, and arriving there resets the device.

  What is NOT claimed, and what this test must not be read as: that a browser
  can be prevented from going anywhere else, that a visitor cannot type a URL,
  or that the device is locked down. A kiosk in a browser has no such power
  and this feature never claims it. The reset is what holds, not the cage.
*/
test('browser Back from the kiosk contribution screen lands on the start screen and resets it', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const fx = await seedBase('back');
  await walkUpAndSignIn(page, fx);
  expect((await signedInAccounts(page)).length).toBeGreaterThan(0);

  await page.goBack();
  await page.waitForURL(new RegExp(`/kiosk/${fx.goalId}$`), { timeout: 25_000 });
  await expect(page.getByTestId('wsf-kiosk-screen')).toBeVisible({ timeout: 25_000 });

  await expect
    .poll(async () => (await signedInAccounts(page)).length, { timeout: 20_000, intervals: [200] })
    .toBe(0);
  expect((await readStorage(page)).session).not.toContain('wsf.kioskReturnGoalId');
  const startText = await page.getByTestId('wsf-kiosk-screen').innerText();
  expect(startText).not.toContain(fx.memberName);
  expect(startText).not.toContain(fx.memberEmail);
});

// ---- CASE 7 ---------------------------------------------------------------
/*
  FINISH IS REACHABLE, AND THE START SCREEN IS NEVER REACHED WHILE ATTACHED.

  Two halves of one rule. Finish has to be on the screens a kiosk session can
  come to rest on — a patch that hides the shell but also loses Finish has not
  fixed anything — and the device may only arrive back at its start screen
  when the account has actually gone.

  WHAT THIS CANNOT ESTABLISH, stated rather than implied. `runKioskFinish`
  reports a FAILED sign-out and keeps the visitor on the receipt with
  "We couldn't sign you out" (`wsf-kiosk-finish-error`) instead of a start
  screen that lies. Firebase's web `signOut` clears local persistence and does
  not depend on a reachable server, so this harness has no way to make it fail
  without editing product code, which this branch does not do. The rule is
  asserted as the coupling it produces — start screen implies detached — and
  the failure branch's own unit coverage is in tests/kiosk-session.test.ts.
*/
test('Finish is reachable on a kiosk screen, and the start screen is only reached detached', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const fx = await seedBase('finish');
  await walkUpAndSignIn(page, fx);

  // Reachable where a thumb lands, on the screen the session is resting on.
  const chromeFinish = page.getByTestId('wsf-kiosk-finish-chrome');
  await expect(chromeFinish).toBeVisible();
  const box = (await chromeFinish.boundingBox())!;
  const reachable = await page.evaluate(
    ([x, y]) => {
      const hit = document.elementFromPoint(x as number, y as number);
      const finish = document.querySelector('[data-testid="wsf-kiosk-finish-chrome"]');
      return Boolean(hit && finish && (finish === hit || finish.contains(hit)));
    },
    [box.x + box.width / 2, box.y + box.height / 2]
  );
  expect(reachable, 'Finish is under the thumb, not merely in the DOM').toBe(true);

  expect((await signedInAccounts(page)).length).toBeGreaterThan(0);
  await chromeFinish.click();
  await page.waitForURL(new RegExp(`/kiosk/${fx.goalId}$`), { timeout: 25_000 });
  await expect(page.getByTestId('wsf-kiosk-screen')).toBeVisible({ timeout: 25_000 });

  // THE COUPLING. The device is at its start screen, so the account must be
  // gone — not "gone shortly", and not "gone from the screen".
  await expect
    .poll(async () => (await signedInAccounts(page)).length, { timeout: 20_000, intervals: [200] })
    .toBe(0);
  await expect(page.getByTestId('wsf-kiosk-finish-error')).toHaveCount(0);
  const atRest = await readStorage(page);
  expect(atRest.session).not.toContain('wsf.kioskReturnGoalId');
  // Nothing was submitted this session, so there is no attempt to preserve.
  expect(atRest.local.some((k) => k.startsWith('wsf.pendingContribution.'))).toBe(false);
});

// ---- CASE 8 ---------------------------------------------------------------
/*
  THE SIGN-OUT THAT FAILS.

  I reported this as unreachable from a browser harness without editing product
  code. THAT WAS WRONG, and the correction is W1B's: Firebase Auth signs out by
  REMOVING its persisted record from IndexedDB, so failing only the readwrite
  transaction on `firebaseLocalStorage` makes sign-out reject while leaving
  every readonly inspection — including this test's own — working. No network
  fault, no product edit. The recipe is theirs
  (sprint-w1b-kiosk-capture.spec.ts at be3ff1b); this is my own independent run
  of it, with the positive control their capture did not need.

  WHY THE READONLY HALF MATTERS SO MUCH HERE. If the injection broke reads too,
  `authKeys` would report an unreadable store — and the first version of that
  helper would have resolved `[]` and called it "signed out", turning the exact
  failure under test into a pass. It now throws instead. This test is the
  reason that was fixed.
*/
test('a failed sign-out keeps the device attached and says so, and Finish still works once it can', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const fx = await seedBase('signoutfail');
  await walkUpAndSignIn(page, fx);

  // A REAL, CONFIRMED contribution first: the failure under test is the
  // sign-out, not the write.
  await page.getByTestId('wsf-contribute-entry').fill('9');
  await page.getByTestId('wsf-contribute-review').click();
  await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible({ timeout: 25_000 });
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 40_000 });
  expect((await signedInAccounts(page)).length).toBeGreaterThan(0);

  // ── THE INJECTION ─────────────────────────────────────────────────────────
  // Only the removal is made to fail. Readonly access is deliberately left
  // alone, because the observation below has to keep working.
  await page.evaluate(() => {
    const proto = IDBDatabase.prototype as IDBDatabase & {
      __wsfOriginalTransaction?: IDBDatabase['transaction'];
    };
    proto.__wsfOriginalTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function patched(
      this: IDBDatabase,
      names: string | string[] | DOMStringList,
      mode?: IDBTransactionMode,
      options?: IDBTransactionOptions
    ): IDBTransaction {
      const list = typeof names === 'string' ? [names] : Array.from(names as string[]);
      if (mode === 'readwrite' && list.includes('firebaseLocalStorage')) {
        throw new DOMException('injected storage fault', 'InvalidStateError');
      }
      return proto.__wsfOriginalTransaction!.call(this, names as string[], mode, options);
    } as typeof IDBDatabase.prototype.transaction;
  });

  await page.getByTestId('wsf-kiosk-finish').click();

  // 1. AN ACTUAL ERROR, in the product's own words.
  await expect(page.getByTestId('wsf-kiosk-finish-error')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('wsf-kiosk-finish-error')).toHaveText(
    'We couldn’t sign you out. Don’t leave this device signed in — try Finish again.'
  );
  // 2. NO FALSE REST. The start screen stays mounted underneath the pushed
  //    contribution route; what must not happen is the visitor being shown it.
  await expect(page.getByTestId('wsf-kiosk-screen')).toBeHidden();
  expect(page.url()).toContain('/contribute/');
  expect(page.url()).toContain('kiosk=1');
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible();
  // 3. FINISH IS OFFERED AGAIN rather than left spinning.
  await expect(page.getByTestId('wsf-kiosk-finish')).toHaveText('Finish');
  await expect(page.getByTestId('wsf-kiosk-finish')).toBeEnabled();
  // 4. A SUCCESSFUL READONLY OBSERVATION of the still-attached account. The
  //    probe has to come back OK for this to mean anything — an unreadable
  //    store would throw, and would not be allowed to read as "signed out".
  const duringFault = await readAuthRecords(page);
  expect(duringFault.ok, 'readonly inspection must survive the injected fault').toBe(true);
  expect((await signedInAccounts(page)).length).toBeGreaterThan(0);

  // ── THE POSITIVE CONTROL ──────────────────────────────────────────────────
  // Remove the fault in place — not by reloading, which would also drop the
  // page state and prove less — and press Finish again. A device that refuses
  // while it cannot sign out must still finish once it can; a permanently
  // stuck kiosk would be its own defect.
  await page.evaluate(() => {
    const proto = IDBDatabase.prototype as IDBDatabase & {
      __wsfOriginalTransaction?: IDBDatabase['transaction'];
    };
    if (proto.__wsfOriginalTransaction) {
      IDBDatabase.prototype.transaction = proto.__wsfOriginalTransaction;
      delete proto.__wsfOriginalTransaction;
    }
  });
  await page.getByTestId('wsf-kiosk-finish').click();
  await page.waitForURL(new RegExp(`/kiosk/${fx.goalId}$`), { timeout: 25_000 });
  await expect(page.getByTestId('wsf-kiosk-screen')).toBeVisible({ timeout: 25_000 });
  await expect
    .poll(async () => (await signedInAccounts(page)).length, { timeout: 20_000, intervals: [200] })
    .toBe(0);
  expect((await readStorage(page)).session).not.toContain('wsf.kioskReturnGoalId');
  // A confirmed contribution leaves no unresolved record for anyone.
  expect((await readStorage(page)).local.some((k) => k.startsWith('wsf.pendingContribution.'))).toBe(
    false
  );
  // And the next visitor meets the gate, not the previous account.
  await page.getByTestId('wsf-kiosk-start').click();
  await expect(page.getByTestId('wsf-contribute-signed-out')).toBeVisible({ timeout: 25_000 });
});

// ---- CASE 9 ---------------------------------------------------------------
/*
  THE BOUNDED STATES, not just the entry screen.

  W1B found in-app exits on the error and missing-goal states. The source says
  the same thing plainly: `wsf-contribute-load-error` and
  `wsf-contribute-not-found` each render a `wsf-contribute-home` link to `/`
  with no `kiosk` condition on it, while the refused and pending states DO gate
  their Back on the flag. So a kiosk session that fails to load, or is pointed
  at a goal this account cannot see, offers a door out that the same session
  does not offer when everything works.

  This runs the same contract across those states and the confirmed receipt, so
  a patch cannot be verified on the happy path alone.
*/
test('no kiosk state offers a way out: receipt, missing goal, closed goal and load error', async ({
  page,
}) => {
  test.setTimeout(300_000);
  // W5-K9. RETIRED at product 50806fa: ordinary passing coverage now.
  const fx = await seedBase('states');
  await walkUpAndSignIn(page, fx);

  const found: Record<string, string[]> = {};

  // -- the confirmed receipt (the dark screen) -------------------------------
  await page.getByTestId('wsf-contribute-entry').fill('4');
  await page.getByTestId('wsf-contribute-review').click();
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 40_000 });
  found.receipt = await escapeControls(page, ['[data-testid="wsf-contribute-receipt"]']);

  // -- a goal this account cannot see ---------------------------------------
  await page.goto(`/contribute/w5kn-no-such-goal-${fx.stamp}?kiosk=1`);
  await expect
    .poll(
      async () =>
        (await page.getByTestId('wsf-contribute-not-found').count()) +
        (await page.getByTestId('wsf-contribute-load-error').count()),
      { timeout: 30_000, intervals: [200] }
    )
    .toBeGreaterThan(0);
  found.missingGoal = await escapeControls(page, [
    '[data-testid="wsf-contribute-not-found"]',
    '[data-testid="wsf-contribute-load-error"]',
  ]);

  // -- a CLOSED goal ---------------------------------------------------------
  const closedGoalId = `w5kn-closed-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, closedGoalId, 500, 'closed');
  await page.goto(`/contribute/${closedGoalId}?kiosk=1`);
  await expect
    .poll(
      async () =>
        // `wsf-contribute-closed` is the closed goal's own state. The first
        // version of this poll listed the entry screen and the two failure
        // cards and timed out on a state it had simply never named -- a gap in
        // this test, not a finding about the product.
        (await page.getByTestId('wsf-contribute-closed').count()) +
        (await page.getByTestId('wsf-contribute-entry-screen').count()) +
        (await page.getByTestId('wsf-contribute-not-found').count()) +
        (await page.getByTestId('wsf-contribute-load-error').count()),
      { timeout: 30_000, intervals: [200] }
    )
    .toBeGreaterThan(0);
  found.closedGoal = await escapeControls(page, [
    '[data-testid="wsf-contribute-closed"]',
    '[data-testid="wsf-contribute-entry-screen"]',
    '[data-testid="wsf-contribute-context"]',
    '[data-testid="wsf-contribute-not-found"]',
    '[data-testid="wsf-contribute-load-error"]',
  ]);

  // -- the goal cannot be loaded at all --------------------------------------
  await page.route(/wsfGoalPulse/, (route) => route.abort('connectionfailed'));
  await page.goto(`/contribute/${fx.goalId}?kiosk=1`);
  await expect
    .poll(
      async () =>
        (await page.getByTestId('wsf-contribute-load-error').count()) +
        (await page.getByTestId('wsf-contribute-not-found').count()),
      { timeout: 30_000, intervals: [200] }
    )
    .toBeGreaterThan(0);
  found.loadError = await escapeControls(page, [
    '[data-testid="wsf-contribute-load-error"]',
    '[data-testid="wsf-contribute-not-found"]',
  ]);
  await page.unroute(/wsfGoalPulse/);

  test.info().annotations.push({
    type: 'kiosk-escape-controls-by-state',
    description: Object.entries(found)
      .map(([k, v]) => `${k}=[${v.join(', ') || 'none'}]`)
      .join(' | '),
  });
  expect(found, 'no kiosk state may offer a control that leaves the session').toEqual({
    receipt: [],
    missingGoal: [],
    closedGoal: [],
    loadError: [],
  });
});

// ---- CASE 10 --------------------------------------------------------------
/*
  EVERY KIOSK CONTROL HAS TO BE LEGIBLE, ON BOTH TONES.

  W1B reported the chrome Finish invisible on dark receipts. `toBeVisible()`
  passes for navy on navy, so this measures contrast instead — composited for
  translucency, and against the floor each control's own size and weight earns
  (3:1 for large text, 4.5:1 otherwise) rather than the most forgiving number.

  Both tones, because a fix that only repaints the dark receipt leaves the same
  controls on the light terminal states, and the unresolved notice lives there.
  The sign-out warning is reached the only way it can be — by injecting the
  storage fault, exactly as W5-K8 does.
*/
const DARK_SURFACE_CONTROLS = [
  'wsf-kiosk-finish-chrome',
  'wsf-kiosk-finish',
  'wsf-kiosk-finish-explainer',
  'wsf-kiosk-countdown',
  'wsf-kiosk-stay',
];

function belowFloor(readings: Record<string, ContrastReading>): string[] {
  return Object.entries(readings)
    .filter(([, r]) => r.present && r.ratio < r.floor)
    .map(([id, r]) => `${id}(ratio=${r.ratio} floor=${r.floor} ${r.fontSize}px/${r.weight} fg=${r.fg} bg=${r.bg})`);
}

test('every kiosk control is legible on the dark receipt and on the light terminal states', async ({
  page,
}) => {
  test.setTimeout(300_000);
  // W5-K10. RETIRED at product 50806fa: ordinary passing coverage now.
  const fx = await seedBase('legible');
  await walkUpAndSignIn(page, fx);

  // ---- the DARK surface: the confirmed receipt ----------------------------
  await page.getByTestId('wsf-contribute-entry').fill('6');
  await page.getByTestId('wsf-contribute-review').click();
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 40_000 });
  const dark = await measureContrast(page, DARK_SURFACE_CONTROLS);

  // The sign-out warning only exists once sign-out has actually failed.
  await page.evaluate(() => {
    const proto = IDBDatabase.prototype as IDBDatabase & {
      __wsfOriginalTransaction?: IDBDatabase['transaction'];
    };
    proto.__wsfOriginalTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function patched(
      this: IDBDatabase,
      names: string | string[] | DOMStringList,
      mode?: IDBTransactionMode,
      options?: IDBTransactionOptions
    ): IDBTransaction {
      const list = typeof names === 'string' ? [names] : Array.from(names as string[]);
      if (mode === 'readwrite' && list.includes('firebaseLocalStorage')) {
        throw new DOMException('injected storage fault', 'InvalidStateError');
      }
      return proto.__wsfOriginalTransaction!.call(this, names as string[], mode, options);
    } as typeof IDBDatabase.prototype.transaction;
  });
  await page.getByTestId('wsf-kiosk-finish').click();
  await expect(page.getByTestId('wsf-kiosk-finish-error')).toBeVisible({ timeout: 40_000 });
  const warning = await measureContrast(page, ['wsf-kiosk-finish-error']);
  await page.evaluate(() => {
    const proto = IDBDatabase.prototype as IDBDatabase & {
      __wsfOriginalTransaction?: IDBDatabase['transaction'];
    };
    if (proto.__wsfOriginalTransaction) {
      IDBDatabase.prototype.transaction = proto.__wsfOriginalTransaction;
      delete proto.__wsfOriginalTransaction;
    }
  });

  // ---- the LIGHT surface: an unresolved attempt ---------------------------
  const fx2 = await seedBase('legible-light');
  await walkUpAndSignIn(page, fx2);
  await page.route(CONTRIBUTE_CALLABLE, async (route) => {
    await route.fetch();
    await route.abort('connectionfailed');
  });
  await page.getByTestId('wsf-contribute-entry').fill('5');
  await page.getByTestId('wsf-contribute-review').click();
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 40_000 });
  await page.unroute(CONTRIBUTE_CALLABLE);
  const light = await measureContrast(page, [
    ...DARK_SURFACE_CONTROLS,
    'wsf-kiosk-unresolved-note',
  ]);

  const describe = (label: string, r: Record<string, ContrastReading>) =>
    `${label}: ` +
    Object.entries(r)
      .map(([id, v]) => (v.present ? `${id}=${v.ratio}/${v.floor}` : `${id}=absent`))
      .join(' ');
  test.info().annotations.push({
    type: 'kiosk-control-contrast',
    description: [describe('dark', dark), describe('warning', warning), describe('light', light)].join(
      ' | '
    ),
  });

  // Finish must exist on both tones — a legible control that is not there is
  // not a pass.
  expect(dark['wsf-kiosk-finish-chrome'].present, 'chrome Finish on the receipt').toBe(true);
  expect(light['wsf-kiosk-finish'].present, 'Finish on the light terminal state').toBe(true);
  expect({
    dark: belowFloor(dark),
    warning: belowFloor(warning),
    light: belowFloor(light),
  }).toEqual({ dark: [], warning: [], light: [] });
});

// ---- CASE 11 --------------------------------------------------------------
/*
  THE SHELL AND THE SCREEN HAVE TO AGREE ABOUT WHAT ROUTE THIS IS.
  And what a repeated query parameter actually does, measured rather than
  assumed.

  Kiosk mode is decided twice, by two components reading the same URL:
  `MemberTabBar` decides whether to render, and the contribution screen decides
  whether to show Finish instead of Back. Two readers of one input is two
  chances to disagree, and a disagreement here is not cosmetic — it produces a
  surface that is NEITHER: no bar, no Finish, and an ordinary Back into the
  signed-in member's community, on a device that is standing in a room.

  WHAT THIS ASSERTS, in a form that does not presume how anyone fixes it:

    agreement   the screen is in kiosk mode exactly when the shell is absent
    if kiosk    no control leads out of the session, and Finish is reachable
    if member   it is a COHERENT member surface — shell AND Back — so nobody
                is stranded on a screen with no way anywhere

  The third clause is what stops "hide everything" counting as a fix.

  ON THE DUPLICATED PARAMETER. Whether `?kiosk=1&kiosk=1` even reaches the app
  as an array is a property of the router and the static export, not something
  to be taken on faith from the source of either reader. So this measures the
  observable consequence for each URL shape and records it. If repeated
  parameters never arrive as arrays here, that is worth knowing plainly, and
  this test is how it gets known rather than argued.
*/
const KIOSK_URL_SHAPES = [
  { name: 'single', query: 'kiosk=1', kioskIntended: true },
  { name: 'repeated-same', query: 'kiosk=1&kiosk=1', kioskIntended: true },
  { name: 'repeated-mixed-forms', query: 'kiosk=true&kiosk=1', kioskIntended: true },
  { name: 'explicitly-off', query: 'kiosk=0', kioskIntended: false },
] as const;

test('the shell and the screen agree on kiosk mode for every shape of the flag', async ({
  page,
}) => {
  test.setTimeout(300_000);
  // W5-K11. RETIRED at product 50806fa: ordinary passing coverage now.
  const fx = await seedBase('shapes');
  await walkUpAndSignIn(page, fx);

  const observed: Record<string, string> = {};
  const disagreements: string[] = [];
  const stranded: string[] = [];
  const kioskWithEscapes: string[] = [];
  const lostKioskMode: string[] = [];

  for (const shape of KIOSK_URL_SHAPES) {
    await page.goto(`/contribute/${fx.goalId}?${shape.query}`);
    await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 30_000 });

    const screenKiosk =
      (await page.getByTestId('wsf-kiosk-finish-chrome').count()) +
        (await page.getByTestId('wsf-kiosk-finish-bar').count()) >
      0;
    const shell = (await page.getByTestId('wsf-member-tabs').count()) > 0;
    const memberBack = (await page.getByTestId('wsf-contribute-back').count()) > 0;
    const escapes = await escapeControls(page, [
      '[data-testid="wsf-contribute-entry-screen"]',
      '[data-testid="wsf-contribute-context"]',
    ]);

    observed[shape.name] =
      `screenKiosk=${screenKiosk} shell=${shell} back=${memberBack} escapes=${escapes.length}`;

    // 1. The two readers agree about what this route is.
    if (screenKiosk === shell) disagreements.push(`${shape.name}(${observed[shape.name]})`);
    // 2. A kiosk surface has no way out of the session.
    if (screenKiosk && escapes.length > 0) {
      kioskWithEscapes.push(`${shape.name}=[${escapes.join(', ')}]`);
    }
    // 3. A member surface is a WHOLE member surface. Neither-nor is the
    //    failure this case exists for: no Finish and no member chrome leaves a
    //    visitor on a shared device with nothing that ends or leaves anything.
    if (!screenKiosk && !(shell && memberBack)) {
      stranded.push(`${shape.name}(${observed[shape.name]})`);
    }
    // 4. A URL THAT SAYS KIOSK IS A KIOSK. The clauses above compare the two
    //    readers against each other, and two readers that are wrong in the
    //    same direction agree perfectly: a duplicated parameter that neither
    //    one recognises produces a tidy, consistent MEMBER screen on a device
    //    standing in a room — no Finish, no idle countdown, and a Back into
    //    the signed-in member's community. Agreement is not the same as being
    //    right, so the intent of each URL is asserted separately.
    if (shape.kioskIntended && !screenKiosk) {
      lostKioskMode.push(`${shape.name}(${observed[shape.name]})`);
    }
  }

  test.info().annotations.push({
    type: 'kiosk-flag-shapes',
    description: Object.entries(observed)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' | '),
  });

  /*
    ONE ASSERTION CARRYING ALL FOUR, deliberately. As four separate `expect`s
    the first failure ended the test and hid the rest — so a patch that fixed
    the disagreement would reveal the lost-kiosk-mode finding only on the NEXT
    run, which is how a reviewer ends up chasing one defect at a time. The
    whole verdict lands at once instead:

      disagreements    the two readers disagree about the same URL
      kioskWithEscapes a kiosk surface offers a way out of the session
      stranded         a non-kiosk surface is not a whole member surface
      lostKioskMode    a URL carrying the flag did not reach kiosk mode
  */
  expect({ disagreements, kioskWithEscapes, stranded, lostKioskMode }).toEqual({
    disagreements: [],
    kioskWithEscapes: [],
    stranded: [],
    lostKioskMode: [],
  });
});

// ---- CASE 12 --------------------------------------------------------------
/*
  THE UNRESOLVED NOTICE, AFTER THE COPY CORRECTION.

  The old sentence — "Your attempt is saved to your account; check it from your
  own device." — promised portability the product cannot keep: the record that
  makes the SAME attempt replayable lives in this browser's localStorage, keyed
  to that uid, so another device signing into the same account finds nothing to
  replay. The replacement points at the only place the recovery actually
  exists, and names the cost of the alternative.

  This is a DELTA case, and it checks the thing a copy change can quietly break
  as well as the copy itself: that the screen carrying the new sentence still
  offers the recovery it now points at, still lets the visitor finish, and still
  keeps their record when they do.

  TWO VIEWPORTS, because the sentence got longer. A notice that wraps onto more
  lines pushes what is under it, and what is under it is Finish. 800x1280 is the
  tablet a kiosk actually stands on; 390x640 is the short phone that has already
  caught one control disappearing under the shell in this sprint.
*/
const UNRESOLVED_NOTICE_AT_6690370 =
  'You can try to confirm this contribution here before you finish. ' +
  'Entering it again elsewhere could count it twice.';

const KIOSK_VIEWPORTS = [
  { name: 'tablet-800x1280', width: 800, height: 1280 },
  { name: 'short-phone-390x640', width: 390, height: 640 },
] as const;

test('the unresolved notice makes no portability claim, and Finish survives it on both sizes', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const fx = await seedBase('notice');
  await walkUpAndSignIn(page, fx);

  // The request leaves and is served; the answer never comes back.
  await page.route(CONTRIBUTE_CALLABLE, async (route) => {
    await route.fetch();
    await route.abort('connectionfailed');
  });
  await page.getByTestId('wsf-contribute-entry').fill('11');
  await page.getByTestId('wsf-contribute-review').click();
  await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible({ timeout: 25_000 });
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 40_000 });
  await page.unroute(CONTRIBUTE_CALLABLE);

  // 1. THE SENTENCE ITSELF, exactly.
  await expect(page.getByTestId('wsf-kiosk-unresolved-note')).toHaveText(
    UNRESOLVED_NOTICE_AT_6690370
  );

  // 2. NO PORTABILITY CLAIM ANYWHERE ON THE SCREEN — not just in that one
  //    element. A promise moved into a neighbouring caption is still a promise.
  const screenText = await page.getByTestId('wsf-contribute-screen').innerText();
  for (const claim of [
    /your own device/i,
    /check it from/i,
    /saved to your account/i,
    /another device/i,
    /any device/i,
  ]) {
    expect(screenText, `the unresolved screen must not promise portability (${claim})`).not.toMatch(
      claim
    );
  }
  /*
    AND IT STILL SAYS PLAINLY THAT NOBODY KNOWS.

    My first version of this asserted the screen must not match /confirmed/ and
    friends. That was a bad instrument, not a finding: the screen's CORRECT
    wording is built out of that very word — "NOT CONFIRMED YET", "We couldn't
    confirm your contribution yet" — so a ban on it fails the honest copy and
    would pass copy that said "recorded!" instead. Banning vocabulary is not the
    same as banning a claim. The uncertainty is asserted positively instead,
    which is the property that actually matters.
  */
  expect(screenText).toMatch(/not confirmed yet/i);
  expect(screenText).toMatch(/don[’']t know whether this effort was recorded/i);

  // 3. THE RECOVERY THE SENTENCE POINTS AT IS ACTUALLY THERE.
  await expect(page.getByTestId('wsf-contribute-reconcile')).toBeVisible();
  await expect(page.getByTestId('wsf-contribute-reconcile')).toHaveText('Confirm this contribution');

  // 4. FINISH SURVIVES THE LONGER SENTENCE, at both sizes.
  for (const vp of KIOSK_VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await expect(page.getByTestId('wsf-kiosk-unresolved-note')).toHaveText(
      UNRESOLVED_NOTICE_AT_6690370
    );
    const finish = page.getByTestId('wsf-kiosk-finish');
    await expect(finish).toBeVisible();
    const box = (await finish.boundingBox())!;
    // Reachable: a real touch target, wholly on screen, and resolving to
    // itself where a thumb would land rather than to something over it.
    expect(box.height, `${vp.name}: Finish is a real touch target`).toBeGreaterThanOrEqual(44);
    expect(box.y, `${vp.name}: Finish's top is on screen`).toBeGreaterThanOrEqual(0);
    expect(
      box.y + box.height,
      `${vp.name}: Finish's bottom is on screen, not pushed off by the notice`
    ).toBeLessThanOrEqual(vp.height);
    const onTop = await page.evaluate(
      ([x, y]) => {
        const hit = document.elementFromPoint(x as number, y as number);
        const el = document.querySelector('[data-testid="wsf-kiosk-finish"]');
        return Boolean(hit && el && (el === hit || el.contains(hit)));
      },
      [box.x + box.width / 2, box.y + box.height / 2]
    );
    expect(onTop, `${vp.name}: Finish is under the thumb, not merely in the DOM`).toBe(true);
    // Legible where it sits, by the floor its own size and weight earn.
    const readings = await measureContrast(page, ['wsf-kiosk-finish', 'wsf-kiosk-unresolved-note']);
    test.info().annotations.push({
      type: `kiosk-unresolved-${vp.name}`,
      description: Object.entries(readings)
        .map(([id, r]) => `${id}=${r.ratio}/${r.floor}`)
        .join(' '),
    });
    expect(belowFloor(readings), `${vp.name}: every control on this screen is legible`).toEqual([]);
  }

  // 5. AND THE RECORD IS STILL KEPT WHEN THEY FINISH. The copy change points
  //    at a recovery, so the artefact that recovery depends on has to survive
  //    the way out — this is K3's rule, asserted on the screen the new sentence
  //    is printed on.
  const pendingKey = `wsf.pendingContribution.${fx.goalId}.${fx.memberUid}`;
  expect((await readStorage(page)).local).toContain(pendingKey);
  await page.getByTestId('wsf-kiosk-finish').click();
  await page.waitForURL(new RegExp(`/kiosk/${fx.goalId}$`), { timeout: 25_000 });
  await expect(page.getByTestId('wsf-kiosk-screen')).toBeVisible({ timeout: 25_000 });
  await expect
    .poll(async () => (await signedInAccounts(page)).length, { timeout: 20_000, intervals: [200] })
    .toBe(0);
  const atRest = await readStorage(page);
  expect(atRest.session).not.toContain('wsf.kioskReturnGoalId');
  expect(atRest.local, 'the unresolved record survives Finish').toContain(pendingKey);
});

// ---- PACKET 2: the idle-Finish contract (product 84acea5) ------------------
/*
  A kiosk session may now end itself from a SETTLED screen. The rule lives in
  `kioskMayFinishUnattended` and the screen supplies three facts: what the
  attempt settled as, whether one is still in flight, and whether the load
  itself has settled (closed / not-found / error).

  The cases below read the product's behaviour with this suite's own
  instruments. In particular the auth store is read through `authKeys`, which
  THROWS on an unreadable store rather than reporting an empty one — the fix
  the successor makes in product code is the same mistake my probe once made,
  and a detachment check that fails open would turn a failure to sign out into
  a pass.
*/

/** The kiosk-owned deadline, as the product's own countdown reports it. */
async function countdownSeconds(page: Page): Promise<number | null> {
  if ((await page.getByTestId('wsf-kiosk-countdown').count()) === 0) return null;
  const text = await page.getByTestId('wsf-kiosk-countdown').innerText();
  const m = text.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Signs in at the kiosk and leaves an UNRESOLVED attempt on the record. */
async function leaveUnresolvedAttempt(page: Page, fx: Fx, count: string): Promise<void> {
  await page.route(CONTRIBUTE_CALLABLE, async (route) => {
    await route.fetch();
    await route.abort('connectionfailed');
  });
  await page.getByTestId('wsf-contribute-entry').fill(count);
  await page.getByTestId('wsf-contribute-review').click();
  await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible({ timeout: 25_000 });
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 40_000 });
  await page.unroute(CONTRIBUTE_CALLABLE);
}

// ---- CASE 13 --------------------------------------------------------------
/*
  THE ORDERING THAT LOSES A REMINDER IF IT IS GOT WRONG.

  The contribution route returns its load-error branch BEFORE its pending one,
  so a goal that stops loading while an attempt is unresolved renders an error
  screen — one with no reconcile control on it at all. Two things follow, and
  this case checks both because each is worthless without the other:

    the COPY  must not point at a retry this screen cannot offer;
    the OUTCOME passed to Finish must be the LIVE one. Finishing as `none`
              would clear the stored reminder, destroying the only artefact
              that lets the member replay the same attempt.

  A screen that says the right thing while erasing the record would pass a
  copy check and still lose somebody's effort.
*/
test('a load failure over an unresolved attempt says what it can do, and Finish keeps the record', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const fx = await seedBase('loaderr-unresolved');
  await walkUpAndSignIn(page, fx);
  await leaveUnresolvedAttempt(page, fx, '17');

  const pendingKey = `wsf.pendingContribution.${fx.goalId}.${fx.memberUid}`;
  expect((await readStorage(page)).local).toContain(pendingKey);

  // Now the goal stops loading, with that attempt still unresolved.
  await page.route(/wsfGoalPulse/, (route) => route.abort('connectionfailed'));
  await page.goto(`/contribute/${fx.goalId}?kiosk=1`);
  await expect(page.getByTestId('wsf-contribute-load-error')).toBeVisible({ timeout: 40_000 });

  // 1. THE CONTEXTUAL NOTICE — it says why the retry is unavailable rather
  //    than pointing at a control that is not on this screen.
  await expect(page.getByTestId('wsf-kiosk-unresolved-note')).toHaveText(
    'We couldn’t load this goal to confirm your contribution. Entering it again elsewhere could count it twice.'
  );
  /*
    2. AND THE PROMISE IT DOES NOT MAKE.

    Read from the document body, not from `wsf-contribute-screen`: the screen
    wrapper takes its testID as an optional argument and the load-error branch
    passes none, so the first version of this line waited out the whole test
    timeout on an element that does not exist on this screen. My gap, found by
    running it.
  */
  const errorText = await page.locator('body').innerText();
  expect(errorText).not.toContain('You can try to confirm this contribution here before you finish.');
  await expect(page.getByTestId('wsf-contribute-reconcile')).toHaveCount(0);
  // 3. The session is still endable from here, and unattended.
  await expect(page.getByTestId('wsf-kiosk-finish')).toBeVisible();
  expect(await countdownSeconds(page)).not.toBeNull();

  // 4. THE LIVE OUTCOME. Finishing here must not erase the reminder.
  await page.getByTestId('wsf-kiosk-finish').click();
  await page.waitForURL(new RegExp(`/kiosk/${fx.goalId}$`), { timeout: 25_000 });
  await page.unroute(/wsfGoalPulse/);
  await expect
    .poll(async () => (await signedInAccounts(page)).length, { timeout: 20_000, intervals: [200] })
    .toBe(0);
  const atRest = await readStorage(page);
  expect(atRest.session).not.toContain('wsf.kioskReturnGoalId');
  expect(atRest.local, 'the unresolved reminder survives a Finish taken from the error screen').toContain(
    pendingKey
  );

  // 5. And the next visitor inherits nothing.
  await expect(page.getByTestId('wsf-kiosk-screen')).toBeVisible({ timeout: 25_000 });
  await page.getByTestId('wsf-kiosk-start').click();
  await expect(page.getByTestId('wsf-contribute-signed-out')).toBeVisible({ timeout: 25_000 });
});

// ---- CASE 14 --------------------------------------------------------------
/*
  WHERE THE DEADLINE MUST NOT EXIST.

  A screen with somebody standing at it mid-thought is not a rest state, and a
  request that has not answered is the one case where ending the session is how
  an outcome becomes unknowable. Four screens, asserted by the absence of the
  countdown itself rather than by reading the predicate — the predicate is
  W1B's to unit-test; what this suite owes is the behaviour on screen.
*/
test('the deadline does not exist on the initial load, entry, review, or with a request in flight', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const fx = await seedBase('ineligible');
  await walkUpAndSignIn(page, fx);

  const seen: Record<string, number | null> = {};

  // entry
  seen.entry = await countdownSeconds(page);
  // review
  await page.getByTestId('wsf-contribute-entry').fill('8');
  await page.getByTestId('wsf-contribute-review').click();
  await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible({ timeout: 25_000 });
  seen.review = await countdownSeconds(page);

  // in flight: the request leaves and is HELD, so the screen sits in its
  // sending state for as long as this test needs it to.
  let release: () => void = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route(CONTRIBUTE_CALLABLE, async (route) => {
    await held;
    // The route can be torn down around this handler; aborting a route that is
    // already handled is a harness race, not a finding, so it is swallowed
    // here rather than failing a case about countdowns.
    await route.abort('connectionfailed').catch(() => {});
  });
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-recording')).toBeVisible({ timeout: 25_000 });
  seen.inFlight = await countdownSeconds(page);
  /*
    Release the held request and let the screen settle BEFORE unrouting.
    Unrouting first handled the route out from under the pending handler, and
    its `route.abort` then threw "Route is already handled!" — my sequencing,
    not the product's behaviour.
  */
  release();
  await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 40_000 });
  await page.unroute(CONTRIBUTE_CALLABLE);

  // initial load: a fresh kiosk contribution whose pulse has not answered yet.
  const fx2 = await seedBase('ineligible-load');
  let releaseLoad: () => void = () => {};
  const heldLoad = new Promise<void>((r) => {
    releaseLoad = r;
  });
  await page.route(/wsfGoalPulse/, async (route) => {
    await heldLoad;
    await route.continue();
  });
  await page.goto(`/contribute/${fx2.goalId}?kiosk=1`);
  await expect(page.getByTestId('wsf-contribute-loading')).toBeVisible({ timeout: 25_000 });
  seen.initialLoad = await countdownSeconds(page);
  releaseLoad();
  await page.unroute(/wsfGoalPulse/);

  test.info().annotations.push({
    type: 'kiosk-deadline-ineligible',
    description: Object.entries(seen)
      .map(([k, v]) => `${k}=${v === null ? 'no-countdown' : v}`)
      .join(' '),
  });
  expect(seen).toEqual({ entry: null, review: null, inFlight: null, initialLoad: null });
});

// ---- CASE 15 --------------------------------------------------------------
/*
  THE DEADLINE ON THE THREE SETTLED SCREENS, AND WHAT `Stay` RENEWS.

  These three are the screens the successor adds the deadline to, and they are
  exactly the ones a shared device gets abandoned on: a goal that closed, one
  that cannot be found, one that would not load. The deadline is read from what
  the product's own countdown SAYS, so an altered KIOSK_IDLE_MS would show up
  here as a different number rather than passing silently.

  `Stay` must renew a WHOLE deadline, not top up the remainder — the test waits
  for the countdown to visibly fall first, so a `Stay` that merely paused it
  could not pass.
*/
const SETTLED_SCREENS = ['closed', 'notFound', 'loadError'] as const;

test('closed, missing and unloadable goals each carry the existing 90s deadline, and Stay renews it whole', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const fx = await seedBase('settled');
  await walkUpAndSignIn(page, fx);
  const closedGoalId = `w5kn-settled-closed-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, closedGoalId, 500, 'closed');

  const opened: Record<string, number | null> = {};
  const renewed: Record<string, number | null> = {};
  const fell: Record<string, number | null> = {};

  for (const screen of SETTLED_SCREENS) {
    if (screen === 'loadError') await page.route(/wsfGoalPulse/, (r) => r.abort('connectionfailed'));
    const target =
      screen === 'closed'
        ? closedGoalId
        : screen === 'notFound'
          ? `w5kn-absent-${fx.stamp}`
          : fx.goalId;
    await page.goto(`/contribute/${target}?kiosk=1`);
    await expect
      .poll(
        async () =>
          (await page.getByTestId('wsf-contribute-closed').count()) +
          (await page.getByTestId('wsf-contribute-not-found').count()) +
          (await page.getByTestId('wsf-contribute-load-error').count()),
        { timeout: 40_000, intervals: [200] }
      )
      .toBeGreaterThan(0);

    opened[screen] = await countdownSeconds(page);
    // Let it visibly fall, so "Stay renews" cannot pass on a paused timer.
    await expect
      .poll(async () => countdownSeconds(page), { timeout: 20_000, intervals: [500] })
      .toBeLessThan(opened[screen]! - 1);
    fell[screen] = await countdownSeconds(page);
    await page.getByTestId('wsf-kiosk-stay').click();
    await expect
      .poll(async () => countdownSeconds(page), { timeout: 10_000, intervals: [200] })
      .toBeGreaterThan(fell[screen]! + 1);
    renewed[screen] = await countdownSeconds(page);
    if (screen === 'loadError') await page.unroute(/wsfGoalPulse/);
  }

  test.info().annotations.push({
    type: 'kiosk-deadline-settled',
    description: SETTLED_SCREENS.map(
      (s) => `${s}: opened=${opened[s]} fell=${fell[s]} renewed=${renewed[s]}`
    ).join(' | '),
  });

  for (const screen of SETTLED_SCREENS) {
    // The EXISTING deadline, unchanged: 90 seconds, allowing only for the
    // second that can elapse between the screen settling and the read.
    expect(opened[screen], `${screen}: the deadline opens at the existing 90s`).toBeGreaterThanOrEqual(88);
    expect(opened[screen], `${screen}: the deadline is not longer than 90s`).toBeLessThanOrEqual(90);
    // A WHOLE deadline, not a top-up of what was left.
    expect(renewed[screen], `${screen}: Stay renews a whole deadline`).toBeGreaterThanOrEqual(88);
  }
});

// ---- CASE 16 --------------------------------------------------------------
/*
  THE DEADLINE ACTUALLY FIRES, AND A FAILED SIGN-OUT STILL REFUSES TO LIE.

  A countdown that reaches zero without detaching the account would be worse
  than no countdown at all, because the device would LOOK finished. So this one
  waits out a real deadline — the product reads `Date.now()`, and a faked clock
  would be testing the fake. Once, on one screen, and slow by design.

  The failed sign-out is exercised by pressing Finish with the storage fault
  injected rather than by waiting out a second deadline: it is the same
  `runKioskFinish` path, and a second 90-second wait would buy nothing.
*/
test('the deadline detaches the account by itself, and a failed sign-out on a settled screen says so', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const fx = await seedBase('deadline');
  await walkUpAndSignIn(page, fx);

  // --- the failed sign-out, on a settled screen -----------------------------
  await page.goto(`/contribute/w5kn-absent-${fx.stamp}?kiosk=1`);
  await expect(page.getByTestId('wsf-contribute-not-found')).toBeVisible({ timeout: 40_000 });
  expect((await signedInAccounts(page)).length).toBeGreaterThan(0);
  await page.evaluate(() => {
    const proto = IDBDatabase.prototype as IDBDatabase & {
      __wsfOriginalTransaction?: IDBDatabase['transaction'];
    };
    proto.__wsfOriginalTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function patched(
      this: IDBDatabase,
      names: string | string[] | DOMStringList,
      mode?: IDBTransactionMode,
      options?: IDBTransactionOptions
    ): IDBTransaction {
      const list = typeof names === 'string' ? [names] : Array.from(names as string[]);
      if (mode === 'readwrite' && list.includes('firebaseLocalStorage')) {
        throw new DOMException('injected storage fault', 'InvalidStateError');
      }
      return proto.__wsfOriginalTransaction!.call(this, names as string[], mode, options);
    } as typeof IDBDatabase.prototype.transaction;
  });
  await page.getByTestId('wsf-kiosk-finish').click();
  await expect(page.getByTestId('wsf-kiosk-finish-error')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('wsf-kiosk-screen')).toBeHidden();
  expect(page.url()).toContain('kiosk=1');
  // Read with THIS suite's probe, which throws on an unreadable store rather
  // than reporting an empty one. A fail-open read here would turn the failure
  // under test into a pass.
  const duringFault = await readAuthRecords(page);
  expect(duringFault.ok, 'readonly inspection survives the injected fault').toBe(true);
  expect((await signedInAccounts(page)).length).toBeGreaterThan(0);
  await page.evaluate(() => {
    const proto = IDBDatabase.prototype as IDBDatabase & {
      __wsfOriginalTransaction?: IDBDatabase['transaction'];
    };
    if (proto.__wsfOriginalTransaction) {
      IDBDatabase.prototype.transaction = proto.__wsfOriginalTransaction;
      delete proto.__wsfOriginalTransaction;
    }
  });

  /*
    --- and now the deadline, waited out for real ---------------------------

    On a CLOSED goal rather than the missing one used above. `/kiosk/<goalId>`
    for a goal that does not exist correctly renders the display's generic
    refusal, not the hero — so asserting the hero after the deadline was
    asserting the wrong screen for the fixture I had chosen. The deadline
    itself fired either way; this picks a fixture whose resting screen is the
    one the assertion is about.
  */
  const closedGoalId = `w5kn-deadline-closed-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, closedGoalId, 500, 'closed');
  await page.goto(`/contribute/${closedGoalId}?kiosk=1`);
  await expect(page.getByTestId('wsf-contribute-closed')).toBeVisible({ timeout: 40_000 });
  const opened = await countdownSeconds(page);
  expect(opened, 'the deadline is running on this screen').not.toBeNull();
  expect((await signedInAccounts(page)).length).toBeGreaterThan(0);

  // Nobody touches it. KIOSK_IDLE_MS is 90s; the wait is that plus slack.
  await page.waitForURL(new RegExp(`/kiosk/${closedGoalId}$`), { timeout: 150_000 });
  await expect(page.getByTestId('wsf-kiosk-screen')).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => (await signedInAccounts(page)).length, { timeout: 30_000, intervals: [250] })
    .toBe(0);
  const atRest = await readStorage(page);
  expect(atRest.session).not.toContain('wsf.kioskReturnGoalId');
  const startText = await page.getByTestId('wsf-kiosk-screen').innerText();
  expect(startText).not.toContain(fx.memberName);
  expect(startText).not.toContain(fx.memberEmail);
  await page.getByTestId('wsf-kiosk-start').click();
  await expect(page.getByTestId('wsf-contribute-signed-out')).toBeVisible({ timeout: 25_000 });
});

// ---- CASE 17 --------------------------------------------------------------
/*
  THE ORDINARY MEMBER IS NOT A KIOSK, ON THE SAME THREE SCREENS.

  The control case for this packet, and the likeliest collateral: a member who
  hits a closed goal, a missing one or a load failure on their OWN device must
  keep their navigation and must never be signed out by a timer they did not
  ask for.
*/
test('an ordinary member on a closed, missing or unloadable goal keeps navigation and is never timed out', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const fx = await seedBase('ordinary-settled');
  const closedGoalId = `w5kn-ord-closed-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, closedGoalId, 500, 'closed');

  // Sign in the ordinary way, then open each screen without the kiosk flag.
  await page.goto(`/contribute/${fx.goalId}`);
  await expect(page.getByTestId('wsf-contribute-signed-out')).toBeVisible({ timeout: 25_000 });
  await page.getByTestId('wsf-contribute-signin-link').click();
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 25_000 });
  await page.getByTestId('wsf-signin-email').fill(fx.memberEmail);
  await page.getByTestId('wsf-signin-password').fill(fx.password);
  await page.getByTestId('wsf-signin-submit').click();
  await page.waitForURL(/\/community\//, { timeout: 30_000 });
  await expect
    .poll(async () => (await signedInAccounts(page)).length, { timeout: 25_000, intervals: [200] })
    .toBeGreaterThan(0);

  const observed: Record<string, string> = {};
  for (const screen of SETTLED_SCREENS) {
    if (screen === 'loadError') await page.route(/wsfGoalPulse/, (r) => r.abort('connectionfailed'));
    const target =
      screen === 'closed'
        ? closedGoalId
        : screen === 'notFound'
          ? `w5kn-ord-absent-${fx.stamp}`
          : fx.goalId;
    await page.goto(`/contribute/${target}`);
    await expect
      .poll(
        async () =>
          (await page.getByTestId('wsf-contribute-closed').count()) +
          (await page.getByTestId('wsf-contribute-not-found').count()) +
          (await page.getByTestId('wsf-contribute-load-error').count()),
        { timeout: 40_000, intervals: [200] }
      )
      .toBeGreaterThan(0);

    const shell = (await page.getByTestId('wsf-member-tabs').count()) > 0;
    const wayOn =
      (await page.getByTestId('wsf-contribute-home').count()) +
      (await page.getByTestId('wsf-contribute-back').count());
    const countdown = await countdownSeconds(page);
    const attached = (await signedInAccounts(page)).length;
    observed[screen] = `shell=${shell} wayOn=${wayOn} countdown=${countdown ?? 'none'} attached=${attached}`;

    expect(shell, `${screen}: the member keeps the shell`).toBe(true);
    expect(wayOn, `${screen}: the member keeps a way on from this screen`).toBeGreaterThan(0);
    expect(countdown, `${screen}: an ordinary member is never on a deadline`).toBeNull();
    expect(attached, `${screen}: the member is not signed out`).toBeGreaterThan(0);
    if (screen === 'loadError') await page.unroute(/wsfGoalPulse/);
  }

  test.info().annotations.push({
    type: 'ordinary-member-settled-screens',
    description: SETTLED_SCREENS.map((s) => `${s}: ${observed[s]}`).join(' | '),
  });
});
