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

async function seedGoal(groupId: string, ownerUid: string, goalId: string, total: number): Promise<void> {
  const now = new Date();
  const endsInMs = 3 * 24 * 60 * 60_000;
  await firestoreWrite(`wsfGoals/${goalId}`, {
    ownerUid: { stringValue: ownerUid },
    communityGroupId: { stringValue: groupId },
    title: { stringValue: 'Squats together this week' },
    target: { integerValue: '500' },
    unit: { stringValue: 'squats' },
    status: { stringValue: 'active' },
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
  // W5-K1. Expected to fail while the seam is open, and `fail` rather than
  // `skip` so the body still runs: this retires itself the moment the shell
  // stops rendering over the kiosk's contribution screen. A suite that went
  // green by ignoring the case would tell a future reviewer nothing.
  test.fail();
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
  // W5-K4. Expected to fail while the seam is open; `fail`, not `skip`, so the
  // body runs and this becomes ordinary passing coverage the day a patch lands.
  test.fail();
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
test('no kiosk state offers a way out: missing goal, load error and the confirmed receipt', async ({
  page,
}) => {
  test.setTimeout(300_000);
  // W5-K9. Expected to fail while the seam is open.
  test.fail();
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
    loadError: [],
  });
});

// ---- CASE 10 --------------------------------------------------------------
/*
  FINISH HAS TO BE LEGIBLE, not merely rendered.

  W1B reported the chrome Finish invisible on dark receipts. The source agrees:
  `renderChrome`'s non-kiosk Back applies `chromeLinkTextDark` (cream) when the
  tone is dark, and the kiosk branch beside it applies `chromeLinkText` (navy)
  with no dark variant — so on a receipt whose tone is 'dark' the kiosk's own
  way out is navy on navy.

  `toBeVisible()` passes for that, which is exactly why this measures contrast
  instead. The threshold is WCAG AA for large text (3:1) — deliberately the
  lenient one, so this cannot be dismissed as a strict-standard quibble; the
  measured value today is far below even that.
*/
test('the kiosk Finish in the chrome is legible on the dark receipt', async ({ page }) => {
  test.setTimeout(300_000);
  // W5-K10. Expected to fail until the dark tone reaches the kiosk branch.
  test.fail();
  const fx = await seedBase('legible');
  await walkUpAndSignIn(page, fx);
  await page.getByTestId('wsf-contribute-entry').fill('6');
  await page.getByTestId('wsf-contribute-review').click();
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('wsf-kiosk-finish-chrome')).toBeVisible();

  const contrast = await page.evaluate(() => {
    const parse = (c: string): [number, number, number] => {
      const m = c.match(/-?[\d.]+/g);
      if (!m) return [0, 0, 0];
      return [Number(m[0]), Number(m[1]), Number(m[2])];
    };
    const lum = ([r, g, b]: [number, number, number]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const el = document.querySelector('[data-testid="wsf-kiosk-finish-chrome"]')!;
    // The label carries the colour; the pressable itself is transparent.
    const label = el.querySelector('*') ?? el;
    const fg = parse(getComputedStyle(label).color);
    // Walk up for the first ancestor that actually paints a background.
    let node: Element | null = el;
    let bg: [number, number, number] = [255, 255, 255];
    while (node) {
      const c = getComputedStyle(node).backgroundColor;
      if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) {
        bg = parse(c);
        break;
      }
      node = node.parentElement;
    }
    const a = lum(fg);
    const b = lum(bg);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    return { ratio: Math.round(ratio * 100) / 100, fg, bg };
  });

  test.info().annotations.push({
    type: 'kiosk-finish-chrome-contrast',
    description: `ratio=${contrast.ratio} fg=${contrast.fg.join(',')} bg=${contrast.bg.join(',')}`,
  });
  expect(contrast.ratio, 'the kiosk chrome Finish must be readable on the receipt it sits on').toBeGreaterThanOrEqual(3);
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
  // W5-K11. Expected to fail while the seam is open: at this head the shell
  // does not read the flag at all, so it renders over `?kiosk=1` and the two
  // readers disagree on the product's own URL.
  test.fail();
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
