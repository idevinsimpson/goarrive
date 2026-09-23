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
 */
async function readAuthRecords(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const req = indexedDB.open('firebaseLocalStorageDb');
        req.onerror = () => resolve([]);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('firebaseLocalStorage')) {
            db.close();
            resolve([]);
            return;
          }
          const all = db
            .transaction('firebaseLocalStorage', 'readonly')
            .objectStore('firebaseLocalStorage')
            .getAllKeys();
          all.onsuccess = () => {
            db.close();
            resolve((all.result as unknown[]).map(String));
          };
          all.onerror = () => {
            db.close();
            resolve([]);
          };
        };
      })
  );
}

async function signedInAccounts(page: Page): Promise<string[]> {
  return (await readAuthRecords(page)).filter((k) => k.startsWith('firebase:authUser:'));
}

async function readStorage(page: Page): Promise<{ local: string[]; session: string[] }> {
  return page.evaluate(() => ({
    local: Object.keys(window.localStorage),
    session: Object.keys(window.sessionStorage),
  }));
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

  const offenders = await page.evaluate(() => {
    const within = (el: Element, sel: string) => Boolean(el.closest(sel));
    // The screen's own content, and the two controls the kiosk owns. The
    // wordmark is allowed because it is a static mark on this route — if it
    // ever becomes a link, it is an escape and this list must not excuse it,
    // so it is matched on its own testID rather than by tag.
    const allowed = [
      '[data-testid="wsf-contribute-entry-screen"]',
      '[data-testid="wsf-contribute-context"]',
      '[data-testid="wsf-kiosk-finish-chrome"]',
      '[data-testid="wsf-kiosk-finish-bar"]',
    ];
    const interactive = Array.from(
      document.querySelectorAll(
        'a[href], button, input, select, textarea, [role="link"], [role="button"], [tabindex]:not([tabindex="-1"])'
      )
    );
    const out: string[] = [];
    for (const el of interactive) {
      if (allowed.some((sel) => within(el, sel))) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) continue;
      // Reachable by a thumb, not merely present: the point a press would
      // land on has to resolve to this control.
      const hit = document.elementFromPoint(cx, cy);
      if (!hit || !(el === hit || el.contains(hit))) continue;
      const id = el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.tagName;
      out.push(`${id}@${Math.round(cx)},${Math.round(cy)}`);
    }
    return out;
  });

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
