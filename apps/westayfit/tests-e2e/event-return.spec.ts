import { randomBytes } from 'node:crypto';
import { mkdirSync as eaeMkdir } from 'node:fs';
import eaePath from 'node:path';

import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * PAST THE VERIFY GATE, WITHOUT RACING IT (EXPO-ACCOUNT-ENTRY-1).
 *
 * verify-email refreshes the user on its own and moves on as soon as the
 * address is verified. The shared `clearVerifyGate` clicks "I have verified"
 * as soon as it is visible, which races that auto-advance: the click either
 * waits on a button that has gone, or lands on whatever the next screen has at
 * that spot — profile-setup's "Sign out" — and signs the new account out.
 * Measured: about one run in three, on the base build as well. So this waits
 * for the screen to move on by itself first, and asks only if it has not.
 */
async function passVerifyGate(page: Page, destination: string, timeout = 30_000): Promise<void> {
  const target = page.getByTestId(destination);
  try {
    await target.waitFor({ state: 'visible', timeout: 10_000 });
    return;
  } catch {
    // Still on verify-email: ask once, bounded, and only while it is there.
  }
  const check = page.getByTestId('wsf-verify-check');
  if (await check.isVisible().catch(() => false)) {
    await check.click({ timeout: 3_000 }).catch(() => {});
  }
  await expect(target).toBeVisible({ timeout });
}



/**
 * THE SCANNED EVENT SURVIVES THE AUTH ROUND TRIP — asserted of the PRODUCT.
 *
 * The defect: a visitor scanned the QR at an event, landed on
 * `/event/<goalId>`, was told they needed an account, and signed in — and the
 * app put them on its home page. `nextRouteAfterAuth` carried a pending join
 * code and a kiosk return goal, and nothing else.
 *
 * Only a browser can establish this: it is a property of a navigation sequence
 * across four routes and a storage handoff, not of any single function.
 * `tests/event-return.test.ts` pins what may be stored and what a read
 * refuses; this pins that the return happens, that it lands somewhere USABLE,
 * and that the harness never navigates there itself.
 *
 * A REAL EVENT, NOT A FABRICATED ID. The first case seeds a community, a goal
 * and an ACTIVE MEMBERSHIP, so the return has to reach the member view —
 * `wsf-event-member` — and not merely an address. An earlier version of this
 * file asserted the URL alone against a goal that did not exist, which proved
 * the router could be steered and nothing about whether the event was usable.
 *
 * WHAT IT DOES NOT COVER. Choosing an ACTIVITY is not part of this handoff and
 * is not tested here. The scanned journey that carries event AND activity
 * through a real signup, verification, profile and join already exists and is
 * proven by `ui-event-activity-choice.spec.ts`; selecting the activity stays
 * an explicit decision once the visitor is back.
 *
 * NOT A MAIL PROOF. Verification is completed through the Auth emulator's
 * admin API. No message is sent, received or clicked.
 *
 * Requires the emulator suite from firebase.westayfit.emulators.json and a web
 * build made with EXPO_PUBLIC_WSF_AUTH_ENABLED=1 and
 * EXPO_PUBLIC_WSF_USE_EMULATORS=1 — the same shape as the rest of tests-e2e/.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'demo-wsf-local';
const PASSWORD = 'evtReturn-password';
const OWNER = { authorization: 'Bearer owner', 'content-type': 'application/json' };

// Copied rather than imported: the tests-e2e/ suite keeps each spec
// self-contained, as ui-event-activity-choice.spec.ts and mu2-flow.spec.ts do.
async function seedVerifiedUser(email: string, password: string): Promise<string> {
  const base = `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1`;
  const signup = await fetch(`${base}/accounts:signUp?key=fake-api-key`, {
    method: 'POST',
    headers: OWNER,
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!signup.ok) throw new Error(`emulator signUp failed: ${signup.status} ${await signup.text()}`);
  const { localId } = (await signup.json()) as { localId: string };
  const update = await fetch(`${base}/accounts:update`, {
    method: 'POST',
    headers: OWNER,
    body: JSON.stringify({ localId, emailVerified: true }),
  });
  if (!update.ok) throw new Error(`emulator verify failed: ${update.status} ${await update.text()}`);
  return localId;
}

async function markEmailVerified(email: string): Promise<string> {
  const base = `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1`;
  const lookup = await fetch(`${base}/projects/${PROJECT_ID}/accounts:query`, {
    method: 'POST',
    headers: OWNER,
    body: JSON.stringify({}),
  });
  const { userInfo = [] } = (await lookup.json()) as {
    userInfo?: { localId: string; email?: string }[];
  };
  const user = userInfo.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error(`no emulator account for ${email}`);
  await fetch(`${base}/projects/${PROJECT_ID}/accounts:update`, {
    method: 'POST',
    headers: OWNER,
    body: JSON.stringify({ localId: user.localId, emailVerified: true }),
  });
  return user.localId;
}

async function firestoreWrite(docPath: string, fields: Record<string, unknown>): Promise<void> {
  const url =
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}`;
  const res = await fetch(url, { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields }) });
  if (!res.ok) throw new Error(`emulator write ${docPath} failed: ${res.status} ${await res.text()}`);
}

const tsField = (d: Date) => ({ timestampValue: d.toISOString() });

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

async function seedProfile(uid: string, displayName: string): Promise<void> {
  const now = new Date();
  await firestoreWrite(`wsfMemberProfiles/${uid}`, {
    displayName: { stringValue: displayName },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });
}

/** A real community, a real goal, and real ACTIVE memberships. */
async function seedEvent(tag: string, members: { uid: string; role: 'foundingChampion' | 'member' }[]) {
  const stamp = `${tag}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const groupId = `evtReturn-${stamp}`;
  const now = new Date();
  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: 'Return Hall Movers' },
    groupType: { stringValue: 'familyFriends' },
    joinPolicy: { stringValue: 'public' },
    joinCode: { stringValue: randomBytes(16).toString('base64url') },
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
  const goalId = `evtReturn-goal-${stamp}`;
  const endsInMs = 3 * 24 * 60 * 60_000;
  await firestoreWrite(`wsfGoals/${goalId}`, {
    ownerUid: { stringValue: members[0]!.uid },
    communityGroupId: { stringValue: groupId },
    title: { stringValue: 'Return Hall Squat Challenge' },
    target: { integerValue: '500' },
    unit: { stringValue: 'squats' },
    status: { stringValue: 'active' },
    startsAt: tsField(new Date(now.getTime() + endsInMs - 14 * 24 * 60 * 60_000)),
    endsAt: tsField(new Date(now.getTime() + endsInMs)),
    timezone: { stringValue: 'America/New_York' },
    createdAt: tsField(now),
    updatedAt: tsField(now),
    aggregateDisplayAuthorized: { booleanValue: true },
  });
  await seedShards(goalId, 100);
  return { stamp, groupId, goalId };
}

/**
 * The VISIBLE element with this testID.
 *
 * expo-router keeps the previous route mounted while the next one takes over,
 * so an event-screen state container can exist twice — once hidden in the
 * outgoing page and once live. A bare getByTestId then either trips strict
 * mode or resolves to the hidden one, and an absence check would be satisfied
 * by a stale node nobody can see. Every assertion about what is ON SCREEN
 * goes through here.
 */
const shown = (page: Page, testId: string) => page.locator(`[data-testid="${testId}"]:visible`);

/** The device question is asked before anything else on a fresh browser. */
async function answerOwnPhone(page: Page): Promise<void> {
  await expect(shown(page, 'wsf-device-choice')).toBeVisible({ timeout: 20_000 });
  await page.locator('[data-testid="wsf-device-choice-personal"]:visible').click();
}

test('a MEMBER who signs in from a scanned event is returned to it, and it is usable', async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString(36);
  const email = `wsf-evtReturn-member-${stamp}@example.com`;
  const uid = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(uid, 'Returning Member');
  const champUid = await seedVerifiedUser(`wsf-evtReturn-champ-${stamp}@example.com`, PASSWORD);
  await seedProfile(champUid, 'Fixture Champion');
  const { goalId } = await seedEvent('member', [
    { uid: champUid, role: 'foundingChampion' },
    { uid, role: 'member' },
  ]);

  // THE SCAN, in a browser that has never seen the app.
  await page.goto(`/event/${goalId}`);
  await answerOwnPhone(page);
  await expect(shown(page, 'wsf-event-signed-out')).toBeVisible({ timeout: 20_000 });
  // A visitor with no session is never shown the member view.
  await expect(shown(page, 'wsf-event-member')).toHaveCount(0);

  await page.getByTestId('wsf-event-signin').click();
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-signin-email').fill(email);
  await page.getByTestId('wsf-signin-password').fill(PASSWORD);
  await page.getByTestId('wsf-signin-submit').click();

  // THE ASSERTION. Nothing below navigates; the product's own redirect is the
  // only thing that can satisfy this.
  await expect(page).toHaveURL(new RegExp(`/event/${goalId}(\\?|$|#)`), { timeout: 30_000 });
  // And it is USABLE, not merely an address: the member view, with the event
  // named on it.
  await expect(shown(page, 'wsf-event-member')).toBeVisible({ timeout: 30_000 });
  await expect(shown(page, 'wsf-event-title')).toBeVisible();
  // The device answer is remembered per browser and must survive the trip.
  await expect(shown(page, 'wsf-device-choice')).toHaveCount(0);
  // AND THE HANDOFF IS SPENT. It has delivered them; leaving it live would
  // replay this event on some later, unrelated sign-in.
  await expect
    .poll(() => page.evaluate(() => window.sessionStorage.getItem('wsf.eventReturn')))
    .toBeNull();
  // NOTE, because the obvious assertion here would be wrong: this fixture is a
  // ONE-activity event, and `initialSelection` deliberately picks the sole
  // option, so the where-panel is on screen immediately. The "no way on until
  // an activity is chosen" contract is about events that offer a choice, and
  // it is proven where it belongs — ui-event-activity-choice.spec.ts and the
  // hosted player journey, both of which use multi-activity events.
});

test('a NEW account is returned to the scanned event after verifying, and the screen is honest that they are not a member', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString(36);
  const champUid = await seedVerifiedUser(`wsf-evtReturn-champ2-${stamp}@example.com`, PASSWORD);
  await seedProfile(champUid, 'Fixture Champion');
  const { goalId } = await seedEvent('newcomer', [{ uid: champUid, role: 'foundingChampion' }]);
  const email = `wsf-evtReturn-newcomer-${stamp}@example.com`;

  await page.goto(`/event/${goalId}`);
  await answerOwnPhone(page);
  await expect(shown(page, 'wsf-event-signed-out')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-event-signup').click();

  // signup -> verify-email -> profile-setup: three routes away from the event.
  await expect(page.getByTestId('wsf-signup')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-signup-displayName').fill('New At The Event');
  await page.getByTestId('wsf-signup-email').fill(email);
  await page.getByTestId('wsf-signup-password').fill(PASSWORD);
  await page.getByTestId('wsf-signup-submit').click();
  await expect(page.getByTestId('wsf-verify')).toBeVisible({ timeout: 20_000 });

  // The interim gates must NOT bounce back early — the profile has to exist
  // first. Standing on verify-email is the proof the return waited.
  await expect(page).toHaveURL(/verify-email/, { timeout: 20_000 });

  await markEmailVerified(email);
  await passVerifyGate(page, 'wsf-profile', 20_000);
  await page.getByTestId('wsf-profile-displayName').fill('New At The Event');
  await page.getByTestId('wsf-profile-termsCheckbox').click();
  await page.getByTestId('wsf-profile-submit').click();

  await expect(page).toHaveURL(new RegExp(`/event/${goalId}(\\?|$|#)`), { timeout: 30_000 });

  // HONEST ABOUT WHAT THIS IS. A brand-new account belongs to no community, so
  // the event is NOT usable to them yet and the screen says so. This case
  // proves the return survives the longest auth path; JOINING is the scanned
  // /join/<code> journey, proven in ui-event-activity-choice.spec.ts, and is
  // not claimed here.
  await expect(shown(page, 'wsf-event-not-member')).toBeVisible({ timeout: 30_000 });
  await expect(shown(page, 'wsf-event-member')).toHaveCount(0);
  // NOT being a member is still a TERMINAL outcome: the handoff delivered
  // them here and must be spent. This is the case that left it live — a
  // brand-new account belongs to no community, so consuming only on `member`
  // meant signing out and back in replayed the event.
  await expect
    .poll(() => page.evaluate(() => window.sessionStorage.getItem('wsf.eventReturn')))
    .toBeNull();
});

test('a stored return that cannot be vouched for sends nobody anywhere', async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString(36);
  const email = `wsf-evtReturn-tampered-${stamp}@example.com`;
  const uid = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(uid, 'Tampered Return');

  await page.goto('/signin');
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 20_000 });
  // A record nothing legitimate would ever write: an off-site address where a
  // goal id belongs.
  await page.evaluate(() => {
    window.sessionStorage.setItem(
      'wsf.eventReturn',
      JSON.stringify({ goalId: 'https://evil.example.com/steal', at: Date.now() })
    );
  });
  await page.getByTestId('wsf-signin-email').fill(email);
  await page.getByTestId('wsf-signin-password').fill(PASSWORD);
  await page.getByTestId('wsf-signin-submit').click();

  await expect(page.getByTestId('wsf-home-signout')).toBeVisible({ timeout: 30_000 });
  await expect(page).not.toHaveURL(/evil\.example\.com/);
  await expect(page).not.toHaveURL(/\/event\//);
  // Still on the app's own origin, which is the point of storing an id and
  // building the route rather than storing somebody's URL.
  const landed = new URL(page.url());
  const expected = new URL(String(process.env.WSF_PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5010'));
  expect(landed.host).toBe(expected.host);
});

// ─────────────────────────────────────────────────────────────────────────────
// EXPO-ACCOUNT-ENTRY-1 (Director #365 `5961761581`).
//
// The event's own entry seam, from a fresh browser: the visitor is told the
// two ways in before they are asked for an account, a wrong account is never
// a dead end, and an interrupted round trip still comes back to the event.
// Verified-email ownership is untouched: every account here is verified
// through the Auth emulator's admin API, exactly as the cases above do.
//
// CAPTURES are gated on WSF_EAE_CAPTURE_DIR (full viewport, 390×640 and
// 390×844, each after its state's assertions). WSF_EAE_STAGE=BEFORE runs the
// same journeys against the unchanged base for ACTUAL BEFORE, skipping only
// the assertions about controls and copy the base does not have yet.
// ─────────────────────────────────────────────────────────────────────────────
const EAE_DIR = process.env.WSF_EAE_CAPTURE_DIR ?? '';
const EAE_BEFORE = process.env.WSF_EAE_STAGE === 'BEFORE';
const EAE_VIEWPORTS = [
  { label: '390x844', width: 390, height: 844 },
  { label: '390x640', width: 390, height: 640 },
];
// The event landing's two ways on (Director scope delta #497 `5962179622`),
// copied as ui-event-activity-choice.spec.ts copies them, so a change to the
// product's words is a visible change here.
const EAE_PHONE_LABEL = 'Move on my phone';
const EAE_QUEUE_LABEL = 'Use a kiosk';

async function eaeSnap(page: Page, state: string, bringIntoView?: Locator): Promise<void> {
  if (!EAE_DIR) return;
  eaeMkdir(EAE_DIR, { recursive: true });
  const before = page.viewportSize();
  for (const v of EAE_VIEWPORTS) {
    await page.setViewportSize({ width: v.width, height: v.height });
    // A state further down the page is framed so its last element is in view.
    if (bringIntoView) await bringIntoView.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await page.screenshot({ path: eaePath.join(EAE_DIR, `${state}-${v.label}.png`), fullPage: false });
  }
  if (before) await page.setViewportSize(before);
}

async function signInAs(page: Page, email: string): Promise<void> {
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-signin-email').fill(email);
  await page.getByTestId('wsf-signin-password').fill(PASSWORD);
  await page.getByTestId('wsf-signin-submit').click();
}

test('EAE signed out: the event names both ways in and says what an account takes, and no way on is a live control yet', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const stamp = Date.now().toString(36);
  const champUid = await seedVerifiedUser(`wsf-eae-champ-${stamp}@example.com`, PASSWORD);
  await seedProfile(champUid, 'Fixture Champion');
  const { goalId } = await seedEvent('eae-ways', [{ uid: champUid, role: 'foundingChampion' }]);

  await page.goto(`/event/${goalId}`);
  await answerOwnPhone(page);
  const signedOut = shown(page, 'wsf-event-signed-out');
  await expect(signedOut).toBeVisible({ timeout: 20_000 });
  // The member-only controls do not exist signed out: nothing here is a way on.
  await expect(shown(page, 'wsf-event-add')).toHaveCount(0);
  await expect(shown(page, 'wsf-event-queue-start')).toHaveCount(0);
  if (!EAE_BEFORE) {
    const ways = shown(page, 'wsf-event-ways');
    await expect(ways).toBeVisible();
    await expect(ways).toContainText(EAE_PHONE_LABEL);
    await expect(ways).toContainText(EAE_QUEUE_LABEL);
    await expect(ways).toContainText('once you’re signed in');
    // Honest about the one wait an account involves, without promising it away.
    await expect(shown(page, 'wsf-event-account-note')).toContainText('confirm your email');
    await expect(shown(page, 'wsf-event-account-note')).toContainText('this page');
  }
  await expect(shown(page, 'wsf-event-signup')).toBeVisible();
  await expect(shown(page, 'wsf-event-signin')).toBeVisible();
  await eaeSnap(page, 'event-signed-out');
});

test('EAE wrong account: a non-member account is told which account it is and can switch, and the event comes back for the right one', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const stamp = Date.now().toString(36);
  const rightEmail = `wsf-eae-right-${stamp}@example.com`;
  const wrongEmail = `wsf-eae-wrong-${stamp}@example.com`;
  const rightUid = await seedVerifiedUser(rightEmail, PASSWORD);
  await seedProfile(rightUid, 'Right Account');
  const wrongUid = await seedVerifiedUser(wrongEmail, PASSWORD);
  await seedProfile(wrongUid, 'Wrong Account');
  const champUid = await seedVerifiedUser(`wsf-eae-champ3-${stamp}@example.com`, PASSWORD);
  await seedProfile(champUid, 'Fixture Champion');
  const { goalId } = await seedEvent('eae-wrong', [
    { uid: champUid, role: 'foundingChampion' },
    { uid: rightUid, role: 'member' },
  ]);

  await page.goto(`/event/${goalId}`);
  await answerOwnPhone(page);
  await expect(shown(page, 'wsf-event-signed-out')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-event-signin').click();
  await signInAs(page, wrongEmail);

  // The wrong account is returned to the event and told, honestly, it is not in.
  await expect(page).toHaveURL(new RegExp(`/event/${goalId}(\\?|$|#)`), { timeout: 30_000 });
  await expect(shown(page, 'wsf-event-not-member')).toBeVisible({ timeout: 30_000 });
  await eaeSnap(page, 'event-not-member');
  if (EAE_BEFORE) return;
  // WHICH account this is, so a person can see they used the wrong one.
  await expect(shown(page, 'wsf-event-not-member-account')).toContainText(wrongEmail);
  // And a way out that is not "Back to home".
  const sw = shown(page, 'wsf-event-switch-account');
  await expect(sw).toBeVisible();
  await sw.click();

  // Signed out, on sign-in, with the event re-armed for the next account.
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 20_000 });
  await signInAs(page, rightEmail);
  await expect(page).toHaveURL(new RegExp(`/event/${goalId}(\\?|$|#)`), { timeout: 30_000 });
  await expect(shown(page, 'wsf-event-member')).toBeVisible({ timeout: 30_000 });
  await expect(shown(page, 'wsf-event-not-member')).toHaveCount(0);
  // Spent again: it delivered the right person and must not replay.
  await expect
    .poll(() => page.evaluate(() => window.sessionStorage.getItem('wsf.eventReturn')))
    .toBeNull();

  // A RETURNING member opening the event again goes straight in: no device
  // question (remembered per browser), no sign-in, no onboarding.
  await page.goto(`/event/${goalId}`);
  await expect(shown(page, 'wsf-event-member')).toBeVisible({ timeout: 30_000 });
  await expect(shown(page, 'wsf-device-choice')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/event/${goalId}(\\?|$|#)`));
});

test('EAE interrupted: a reload at verify-email and at profile-setup still returns the new account to the event', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const stamp = Date.now().toString(36);
  const champUid = await seedVerifiedUser(`wsf-eae-champ4-${stamp}@example.com`, PASSWORD);
  await seedProfile(champUid, 'Fixture Champion');
  const { goalId } = await seedEvent('eae-interrupt', [{ uid: champUid, role: 'foundingChampion' }]);
  const email = `wsf-eae-interrupt-${stamp}@example.com`;

  await page.goto(`/event/${goalId}`);
  await answerOwnPhone(page);
  await expect(shown(page, 'wsf-event-signed-out')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-event-signup').click();
  await expect(page.getByTestId('wsf-signup')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-signup-displayName').fill('Interrupted Visitor');
  await page.getByTestId('wsf-signup-email').fill(email);
  await page.getByTestId('wsf-signup-password').fill(PASSWORD);
  await page.getByTestId('wsf-signup-submit').click();
  await expect(page.getByTestId('wsf-verify')).toBeVisible({ timeout: 20_000 });

  // INTERRUPTION 1: the page is reloaded while waiting for the email.
  await page.reload();
  await expect(page.getByTestId('wsf-verify')).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => window.sessionStorage.getItem('wsf.eventReturn'))).not.toBeNull();

  await markEmailVerified(email);
  await passVerifyGate(page, 'wsf-profile', 20_000);
  // INTERRUPTION 2: the profile form is reloaded half-filled.
  await page.getByTestId('wsf-profile-displayName').fill('Interrupted Visitor');
  await page.reload();
  await expect(page.getByTestId('wsf-profile')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('wsf-profile-displayName').fill('Interrupted Visitor');
  await page.getByTestId('wsf-profile-termsCheckbox').click();
  await page.getByTestId('wsf-profile-submit').click();

  await expect(page).toHaveURL(new RegExp(`/event/${goalId}(\\?|$|#)`), { timeout: 30_000 });
  await expect(shown(page, 'wsf-event-not-member')).toBeVisible({ timeout: 30_000 });
});

test('EAE not now: the cancel boundary forgets the event, so a later sign-in lands home', async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString(36);
  const email = `wsf-eae-notnow-${stamp}@example.com`;
  const uid = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(uid, 'Not Now');
  const champUid = await seedVerifiedUser(`wsf-eae-champ5-${stamp}@example.com`, PASSWORD);
  await seedProfile(champUid, 'Fixture Champion');
  const { goalId } = await seedEvent('eae-notnow', [
    { uid: champUid, role: 'foundingChampion' },
    { uid, role: 'member' },
  ]);

  await page.goto(`/event/${goalId}`);
  await answerOwnPhone(page);
  await expect(shown(page, 'wsf-event-signed-out')).toBeVisible({ timeout: 20_000 });
  // Starts the handoff, then thinks better of it and comes back.
  await page.getByTestId('wsf-event-signin').click();
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 20_000 });
  await page.goBack();
  await expect(shown(page, 'wsf-event-signed-out')).toBeVisible({ timeout: 20_000 });
  await page.getByText('Not now — back to home', { exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('wsf.eventReturn'))).toBeNull();

  await page.goto('/signin');
  await signInAs(page, email);
  // Signed in and moved on from sign-in, to the app's own Home — which for a
  // member of one community settles on that community — and NOT to the event.
  // (Not `wsf-home-signout`: that control exists only until Home settles.)
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 30_000 });
  await expect(page.getByRole('link', { name: 'Home, current' })).toBeVisible({ timeout: 30_000 });
  await expect(page).not.toHaveURL(/\/event\//);
  await expect(shown(page, 'wsf-event-member')).toHaveCount(0);
  await expect(shown(page, 'wsf-event-signed-out')).toHaveCount(0);
});

test('EAE landing choice: a member sees Move on my phone and Use a kiosk, each goes where it always went, and neither joins a line', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const stamp = Date.now().toString(36);
  const email = `wsf-eae-choice-${stamp}@example.com`;
  const uid = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(uid, 'Choice Member');
  const champUid = await seedVerifiedUser(`wsf-eae-champ6-${stamp}@example.com`, PASSWORD);
  await seedProfile(champUid, 'Fixture Champion');
  const { goalId } = await seedEvent('eae-choice', [
    { uid: champUid, role: 'foundingChampion' },
    { uid, role: 'member' },
  ]);
  const joins: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('wsfJoinTurnLine')) joins.push(r.url());
  });

  await page.goto(`/event/${goalId}`);
  await answerOwnPhone(page);
  await expect(shown(page, 'wsf-event-signed-out')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-event-signin').click();
  await signInAs(page, email);
  await expect(shown(page, 'wsf-event-member')).toBeVisible({ timeout: 30_000 });
  // One-activity event: the sole activity is selected, so the choice is shown.
  const choice = shown(page, 'wsf-event-choice');
  await expect(choice).toBeVisible({ timeout: 20_000 });
  const phone = shown(page, 'wsf-event-add');
  const kiosk = shown(page, 'wsf-event-queue-start');
  if (!EAE_BEFORE) {
    for (const v of EAE_VIEWPORTS) {
      await page.setViewportSize({ width: v.width, height: v.height });
      await expect(phone).toHaveText(EAE_PHONE_LABEL);
      await expect(kiosk).toHaveText(EAE_QUEUE_LABEL);
    }
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await eaeSnap(page, 'event-choice', kiosk);

  // THE PHONE WAY is still the existing contribution route, unchanged.
  await expect(phone).toHaveAttribute('href', `/contribute/${goalId}`);
  await phone.click();
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 40_000 });
  expect(new URL(page.url()).pathname).toBe(`/contribute/${goalId}`);
  expect(joins, 'the phone way joins no line').toHaveLength(0);

  // Back on the event, with its context, and THE KIOSK WAY: it opens the
  // existing name control and still writes nothing until that is confirmed.
  await page.goBack();
  await expect(shown(page, 'wsf-event-member')).toBeVisible({ timeout: 30_000 });
  await expect(shown(page, 'wsf-event-title')).toBeVisible();
  await shown(page, 'wsf-event-queue-start').click();
  await expect(shown(page, 'wsf-event-queue-panel')).toBeVisible({ timeout: 10_000 });
  await expect(shown(page, 'wsf-event-queue-join')).toBeVisible();
  await page.waitForTimeout(500);
  expect(joins, 'opening the kiosk way joins no line').toHaveLength(0);
});
