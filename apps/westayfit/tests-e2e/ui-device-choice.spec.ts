import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

/**
 * WHOSE SCREEN IS THIS — the same QR, two different people, two different
 * endings.
 *
 *   CASE 1  "My own phone". The ordinary path, unchanged: the signpost, the
 *           ordinary sign-in, the ordinary contribution screen with no kiosk
 *           chrome on it, and — the claim — the person is STILL SIGNED IN
 *           when it is over, exactly as they would be anywhere else.
 *   CASE 2  "A shared screen here". The device is handed to /kiosk/<goalId>,
 *           the session the kiosk route already implements — its Finish, its
 *           countdown, its sign-out — and when that session ends the device
 *           holds nothing: no Firebase auth record, no kiosk key, no pending
 *           contribution, and no trace of who was just standing at it. Then
 *           the part only a second visit can establish: the same device,
 *           scanned again, is never offered a personal sign-in, and the one
 *           way back is there for a phone that answered by mistake.
 *   CASE 3  The signup path. A shared screen is never given an account: the
 *           question is asked BEFORE /join/<code> will offer "Sign up to
 *           join", and the shared answer leaves the browser with no account
 *           at all. And a join that did not come from an event QR is never
 *           asked anything, because that flow is untouched.
 *
 * "NOTHING LEFT BEHIND" IS READ OFF THE DEVICE, not inferred from the screen.
 * The Firebase Web SDK persists auth in IndexedDB (`firebaseLocalStorageDb`),
 * not localStorage, so `readAuthRecords` opens that database the way
 * tests-e2e/ui-kiosk.spec.ts does; a localStorage-only assertion would prove
 * nothing.
 *
 * WHAT THESE DO NOT ESTABLISH. Nothing here is evidence about who was holding
 * any device. The product makes no such claim and neither do these tests: the
 * question is answered by the person, and all that is proved is what each
 * answer then does.
 *
 * PARALLEL-SAFE BY CONSTRUCTION (the config is fullyParallel): every test
 * mints its own accounts, its own community and its own goal, so no two tests
 * share a total, a membership or a browser profile.
 *
 * Every name, total and credit below is fixture data seeded for the run.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'demo-wsf-local';
const ARTIFACTS_DIR = path.resolve(__dirname, 'artifacts', 'ui-device-choice');
const PHONE = { width: 390, height: 844 };

/** The literals src/deviceMode.ts exports; tests/device-mode.test.ts pins the
 * same strings on the other side, so the two cannot drift silently. */
const CHOICE_HEADING = 'Whose screen is this?';
const PERSONAL_LABEL = 'My own phone';
const PERSONAL_DESCRIPTION = 'You stay signed in, exactly as you would anywhere else.';
const SHARED_LABEL = 'A shared screen here';
const SHARED_DESCRIPTION =
  'You sign in, add your part, and finish. Nothing about you stays on this screen.';
const SHARED_DESCRIPTION_SIGNUP =
  'We won’t make an account on a screen other people use. You’ll go to that screen’s own page instead.';
const DEVICE_MODE_KEY = 'wsf.deviceMode';

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
  g: { goalId: string; title: string; target: number; unit: string; total: number }
): Promise<void> {
  const now = new Date();
  const endsInMs = 3 * 24 * 60 * 60_000;
  await firestoreWrite(`wsfGoals/${g.goalId}`, {
    ownerUid: { stringValue: ownerUid },
    communityGroupId: { stringValue: groupId },
    title: { stringValue: g.title },
    target: { integerValue: String(g.target) },
    unit: { stringValue: g.unit },
    status: { stringValue: 'active' },
    startsAt: tsField(new Date(now.getTime() + endsInMs - 14 * 24 * 60 * 60_000)),
    endsAt: tsField(new Date(now.getTime() + endsInMs)),
    timezone: { stringValue: 'America/New_York' },
    createdAt: tsField(now),
    updatedAt: tsField(now),
    // Authorized for display, so the kiosk start screen the shared answer
    // hands off to actually renders its hero rather than the refusal.
    aggregateDisplayAuthorized: { booleanValue: true },
  });
  await seedShards(g.goalId, g.total);
}

async function seedCommunity(
  tag: string,
  displayName: string,
  joinPolicy: 'private' | 'public',
  joinCode: string,
  members: Array<{ uid: string; role: 'foundingChampion' | 'member' }>
): Promise<string> {
  const now = new Date();
  const groupId = `uiDC-${tag}`;
  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: displayName },
    groupType: { stringValue: 'familyFriends' },
    joinPolicy: { stringValue: joinPolicy },
    joinCode: { stringValue: joinCode },
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

async function seedProfile(uid: string, displayName: string): Promise<void> {
  const now = new Date();
  await firestoreWrite(`wsfMemberProfiles/${uid}`, {
    displayName: { stringValue: displayName },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });
}

async function snap(page: Page, name: string): Promise<void> {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, `${name}.png`), fullPage: false });
}

/**
 * The keys Firebase Auth has persisted for this origin — the same reader, and
 * the same reasoning, as tests-e2e/ui-kiosk.spec.ts. The web SDK's default
 * persistence is IndexedDB (`firebaseLocalStorageDb` / `firebaseLocalStorage`),
 * with localStorage only as a fallback, so a signed-in account shows up HERE
 * and not among localStorage keys. Opening the database creates it if absent;
 * an empty store reads as "nobody signed in", which is the assertion's point.
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

async function signedIn(page: Page): Promise<boolean> {
  return (await readAuthRecords(page)).some((k) => k.startsWith('firebase:authUser:'));
}

/** Every browser-storage key the page can see, by area, plus the device
 * answer's literal stored value. */
async function readStorage(
  page: Page
): Promise<{ local: string[]; session: string[]; deviceMode: string | null }> {
  return page.evaluate((key) => ({
    local: Object.keys(window.localStorage),
    session: Object.keys(window.sessionStorage),
    deviceMode: window.localStorage.getItem(key),
  }), DEVICE_MODE_KEY);
}

test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

// ---- CASE 1 ---------------------------------------------------------------
test('“My own phone”: the ordinary path, and still signed in at the end', async ({ page }) => {
  test.setTimeout(240_000);
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const password = 'uiDC-password';
  const email = `wsf-uiDC-own-${stamp}@example.com`;
  const memberName = 'Fixture Own Phone';
  const uid = await seedVerifiedUser(email, password);
  const championUid = await seedVerifiedUser(`wsf-uiDC-champ-own-${stamp}@example.com`, password);
  await seedProfile(uid, memberName);
  await seedProfile(championUid, 'Fixture Champion');
  const groupId = await seedCommunity(
    `own-${stamp}`,
    'Maple Street Movers',
    'private',
    randomBytes(6).toString('base64url'),
    [
      { uid: championUid, role: 'foundingChampion' },
      { uid, role: 'member' },
    ]
  );
  const goalId = `uiDC-goal-own-${stamp}`;
  await seedGoal(groupId, championUid, {
    goalId,
    title: 'Squats together this week',
    target: 500,
    unit: 'squats',
    total: 241,
  });

  // ---- the scan: the question, and nothing else --------------------------
  await page.goto(`/event/${goalId}`);
  await expect(page.getByTestId('wsf-event-device-choice')).toBeVisible({ timeout: 20_000 });
  const choice = await page.getByTestId('wsf-event-device-choice').innerText();
  expect(choice).toContain(CHOICE_HEADING);
  expect(choice).toContain(PERSONAL_LABEL);
  expect(choice).toContain(PERSONAL_DESCRIPTION);
  expect(choice).toContain(SHARED_LABEL);
  expect(choice).toContain(SHARED_DESCRIPTION);
  // Nothing has been offered or signed in yet: no way onward except the two
  // answers, and above all no join code anywhere near a question about a
  // device.
  await expect(page.getByTestId('wsf-event-signup')).toHaveCount(0);
  await expect(page.getByTestId('wsf-event-signin')).toHaveCount(0);
  await expect(page.getByTestId('wsf-event-add')).toHaveCount(0);
  expect(choice).not.toMatch(/join code|invite/i);
  expect(await signedIn(page)).toBe(false);
  // Both answers are real touch targets.
  for (const id of ['wsf-device-choice-personal', 'wsf-device-choice-shared']) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await snap(page, '01-question');

  // ---- the answer ---------------------------------------------------------
  await page.getByTestId('wsf-device-choice-personal').click();
  await expect(page.getByTestId('wsf-event-signed-out')).toBeVisible({ timeout: 20_000 });
  // It stayed on the event page; nothing was handed to a shared session.
  expect(new URL(page.url()).pathname).toBe(`/event/${goalId}`);
  expect((await readStorage(page)).deviceMode).toBe('personal');
  await expect(page.getByTestId('wsf-event-signup')).toBeVisible();
  await expect(page.getByTestId('wsf-event-signin')).toBeVisible();
  await snap(page, '02-own-phone-signpost');

  // ---- the ORDINARY sign-in ----------------------------------------------
  await page.getByTestId('wsf-event-signin').click();
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-signin-email').fill(email);
  await page.getByTestId('wsf-signin-password').fill(password);
  await page.getByTestId('wsf-signin-submit').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 30_000 });
  expect(await signedIn(page)).toBe(true);

  // ---- scanning again asks nothing: this device has answered --------------
  await page.goto(`/event/${goalId}`);
  await expect(page.getByTestId('wsf-event-member')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('wsf-event-device-choice')).toHaveCount(0);
  await expect(page.getByTestId('wsf-event-device-shared')).toHaveCount(0);
  await snap(page, '03-member-signpost');

  // ---- the ORDINARY contribution screen: no kiosk session on it -----------
  await page.getByTestId('wsf-event-add').click();
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 30_000 });
  expect(page.url()).not.toMatch(/kiosk=1/);
  await expect(page.getByTestId('wsf-kiosk-finish-chrome')).toHaveCount(0);
  await expect(page.getByTestId('wsf-kiosk-finish')).toHaveCount(0);
  await expect(page.getByTestId('wsf-kiosk-countdown')).toHaveCount(0);
  // A personal phone keeps the ordinary way back out of the flow.
  await expect(page.getByTestId('wsf-contribute-back')).toBeVisible();

  await page.getByTestId('wsf-contribute-entry').fill('20');
  await page.getByTestId('wsf-contribute-review').click();
  await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible();
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText(
    'Your total on this goal: 20 squats'
  );
  await snap(page, '04-own-phone-receipt');

  // ---- THE CLAIM: still signed in, and still on the ordinary path ---------
  expect(await signedIn(page)).toBe(true);
  await expect(page.getByTestId('wsf-kiosk-finish')).toHaveCount(0);
  const end = await readStorage(page);
  expect(end.deviceMode).toBe('personal');
  // The kiosk's own session key was never written on this path at all.
  expect(end.session).not.toContain('wsf.kioskReturnGoalId');

  // And a reload still finds the person signed in — the point of a personal
  // device, and the exact opposite of the shared one.
  await page.goto(`/event/${goalId}`);
  await expect(page.getByTestId('wsf-event-member')).toBeVisible({ timeout: 30_000 });
  expect(await signedIn(page)).toBe(true);
});

// ---- CASE 2 ---------------------------------------------------------------
test('“A shared screen here”: the existing kiosk session, and an empty device when it ends', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const password = 'uiDC-password';
  const email = `wsf-uiDC-shared-${stamp}@example.com`;
  const memberName = 'Fixture Shared Walkup';
  const uid = await seedVerifiedUser(email, password);
  const championUid = await seedVerifiedUser(`wsf-uiDC-champ-sh-${stamp}@example.com`, password);
  await seedProfile(uid, memberName);
  await seedProfile(championUid, 'Fixture Champion');
  const groupId = await seedCommunity(
    `shared-${stamp}`,
    'Maple Street Movers',
    'private',
    randomBytes(6).toString('base64url'),
    [
      { uid: championUid, role: 'foundingChampion' },
      { uid, role: 'member' },
    ]
  );
  const goalId = `uiDC-goal-shared-${stamp}`;
  await seedGoal(groupId, championUid, {
    goalId,
    title: 'Squats together this week',
    target: 500,
    unit: 'squats',
    total: 100,
  });

  await page.goto(`/event/${goalId}`);
  await expect(page.getByTestId('wsf-event-device-choice')).toBeVisible({ timeout: 20_000 });

  // ---- the answer hands the device to the EXISTING kiosk route ------------
  await page.getByTestId('wsf-device-choice-shared').click();
  await page.waitForURL(new RegExp(`/kiosk/${goalId}$`), { timeout: 20_000 });
  await expect(page.getByTestId('wsf-kiosk-screen')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('wsf-kiosk-start')).toHaveText('Contribute here');
  expect((await readStorage(page)).deviceMode).toBe('shared');
  await snap(page, '10-handed-to-kiosk');

  // ---- and that route's session is the one that runs ----------------------
  await page.getByTestId('wsf-kiosk-start').click();
  await page.waitForURL(/\/contribute\/.*kiosk=1/, { timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-signed-out')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-contribute-signin-link').click();
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-signin-email').fill(email);
  await page.getByTestId('wsf-signin-password').fill(password);
  await page.getByTestId('wsf-signin-submit').click();
  await page.waitForURL(/\/contribute\/.*kiosk=1/, { timeout: 30_000 });
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 30_000 });
  // The kiosk's own chrome, from the kiosk's own implementation — not a
  // second one built for this feature.
  await expect(page.getByTestId('wsf-kiosk-finish-chrome')).toBeVisible();
  await expect(page.getByTestId('wsf-contribute-back')).toHaveCount(0);

  await page.getByTestId('wsf-contribute-entry').fill('7');
  await page.getByTestId('wsf-contribute-review').click();
  await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible();
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 30_000 });
  // The kiosk's exact recording, receipt and reset behaviour, unchanged.
  await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText(
    'Your total on this goal: 7 squats'
  );
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('107 of 500 squats');
  await expect(page.getByTestId('wsf-kiosk-finish')).toHaveText('Finish');
  await expect(page.getByTestId('wsf-kiosk-finish-explainer')).toHaveText(
    'Finish signs you out and returns this device to its start screen.'
  );
  await expect(page.getByTestId('wsf-kiosk-countdown')).toHaveText(/^Finishing in \d+ seconds?$/);
  // The account IS signed in at this moment — that is what makes the next
  // block mean something.
  expect(await signedIn(page)).toBe(true);
  await snap(page, '11-kiosk-receipt');

  // ---- Finish, then read the device ---------------------------------------
  await page.getByTestId('wsf-kiosk-finish').click();
  await page.waitForURL(new RegExp(`/kiosk/${goalId}$`), { timeout: 20_000 });
  await expect(page.getByTestId('wsf-kiosk-screen')).toBeVisible({ timeout: 20_000 });
  await snap(page, '12-empty-device');

  // 1. NOBODY IS SIGNED IN. Read out of IndexedDB, where the Web SDK actually
  //    keeps it.
  expect(await signedIn(page)).toBe(false);
  const after = await readStorage(page);
  // 2. The kiosk's own session key is gone.
  expect(after.session).not.toContain('wsf.kioskReturnGoalId');
  // 3. No contribution draft belonging to anybody.
  expect(after.local.some((k) => k.startsWith('wsf.pendingContribution.'))).toBe(false);
  // 4. Nothing this feature carries across a signup either.
  expect(after.session).not.toContain('wsf.pendingJoinCode');
  expect(after.session).not.toContain('wsf.pendingEventGoalId');
  // 5. THE WHOLE INVENTORY. The only thing this app has left anywhere on the
  //    device is the device's own answer about itself, and its entire value is
  //    the word "shared": no uid, no name, no goal, no time, nothing that
  //    could identify the person who just walked away.
  const wsfKeys = [...after.local, ...after.session].filter((k) => k.startsWith('wsf.'));
  expect(wsfKeys).toEqual([DEVICE_MODE_KEY]);
  expect(after.deviceMode).toBe('shared');
  // 6. And nothing on screen names who was just here.
  const startAgain = await page.getByTestId('wsf-kiosk-screen').innerText();
  expect(startAgain).not.toContain(email);
  expect(startAgain).not.toContain(memberName);
  expect(startAgain).not.toMatch(/Your total|Recorded|7 squats/);
  // The community's progress stays with the community, which is where it
  // belongs and the one thing that is not the visitor's to take away.
  await expect(page.getByTestId('wsf-kiosk-total-line')).toHaveText('107 of 500 squats');

  // ---- scanning this device again: never a personal sign-in ---------------
  await page.goto(`/event/${goalId}`);
  await expect(page.getByTestId('wsf-event-device-shared')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-event-signed-out')).toHaveCount(0);
  await expect(page.getByTestId('wsf-event-signup')).toHaveCount(0);
  await expect(page.getByTestId('wsf-event-signin')).toHaveCount(0);
  await expect(page.getByTestId('wsf-device-shared-continue')).toBeVisible();
  expect(await signedIn(page)).toBe(false);
  await snap(page, '13-standing-answer');

  // ---- the way back for a phone that answered by mistake ------------------
  await page.getByTestId('wsf-device-shared-reset').click();
  await expect(page.getByTestId('wsf-event-device-choice')).toBeVisible({ timeout: 20_000 });
  expect((await readStorage(page)).deviceMode).toBeNull();
});

// ---- CASE 3 ---------------------------------------------------------------
test('the signup path: a shared screen is never given an account, and an ordinary join is never asked', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const password = 'uiDC-password';
  const joinCode = randomBytes(16).toString('base64url');
  const championUid = await seedVerifiedUser(`wsf-uiDC-champ-join-${stamp}@example.com`, password);
  await seedProfile(championUid, 'Fixture Champion');
  const groupId = await seedCommunity(
    `join-${stamp}`,
    'Maple Street Movers',
    'public',
    joinCode,
    [{ uid: championUid, role: 'foundingChampion' }]
  );
  const goalId = `uiDC-goal-join-${stamp}`;
  await seedGoal(groupId, championUid, {
    goalId,
    title: 'Squats together this week',
    target: 500,
    unit: 'squats',
    total: 60,
  });
  const joinUrl = `/join/${encodeURIComponent(joinCode)}?event=${encodeURIComponent(goalId)}`;

  // ---- the newcomer QR asks before it offers an account -------------------
  await page.goto(joinUrl);
  await expect(page.getByTestId('wsf-join-device-choice')).toBeVisible({ timeout: 30_000 });
  const choice = await page.getByTestId('wsf-join-device-choice').innerText();
  expect(choice).toContain(CHOICE_HEADING);
  expect(choice).toContain(PERSONAL_LABEL);
  expect(choice).toContain(SHARED_LABEL);
  // On this page the shared option says what will NOT happen, before the tap.
  expect(choice).toContain(SHARED_DESCRIPTION_SIGNUP);
  // And there is no way to create an account until it has been answered.
  await expect(page.getByTestId('wsf-join-signup')).toHaveCount(0);
  await expect(page.getByTestId('wsf-join-signin')).toHaveCount(0);
  await expect(page.getByTestId('wsf-join-signed-out')).toHaveCount(0);
  await snap(page, '20-join-question');

  // ---- the shared answer: no account, handed to the kiosk -----------------
  await page.getByTestId('wsf-device-choice-shared').click();
  await page.waitForURL(new RegExp(`/kiosk/${goalId}$`), { timeout: 20_000 });
  await expect(page.getByTestId('wsf-kiosk-screen')).toBeVisible({ timeout: 30_000 });
  expect(await signedIn(page)).toBe(false);
  const afterShared = await readStorage(page);
  expect(afterShared.deviceMode).toBe('shared');
  await snap(page, '21-join-shared-handoff');

  // ---- the own-phone answer: the ordinary join screen, unchanged ----------
  await page.evaluate((key) => window.localStorage.removeItem(key), DEVICE_MODE_KEY);
  await page.goto(joinUrl);
  await expect(page.getByTestId('wsf-join-device-choice')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('wsf-device-choice-personal').click();
  await expect(page.getByTestId('wsf-join-signed-out')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('wsf-join-signup')).toBeVisible();
  await expect(page.getByTestId('wsf-join-signin')).toBeVisible();
  await expect(page.getByTestId('wsf-join-meta')).toBeVisible();
  expect((await readStorage(page)).deviceMode).toBe('personal');
  await snap(page, '22-join-own-phone');

  // ---- AND THE FLOW THAT MUST NOT HAVE CHANGED ----------------------------
  // A join that did not come from an event QR is never asked anything: no
  // `?event=`, no question, straight to the invitation it always showed.
  await page.evaluate((key) => window.localStorage.removeItem(key), DEVICE_MODE_KEY);
  await page.goto(`/join/${encodeURIComponent(joinCode)}`);
  await expect(page.getByTestId('wsf-join-signed-out')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('wsf-join-device-choice')).toHaveCount(0);
  await expect(page.getByTestId('wsf-join-device-shared')).toHaveCount(0);
  await expect(page.getByTestId('wsf-join-signup')).toBeVisible();
  expect((await readStorage(page)).deviceMode).toBeNull();
  await snap(page, '23-ordinary-join-untouched');
});
