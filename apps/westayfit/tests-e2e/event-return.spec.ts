import { randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

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
  await page.getByTestId('wsf-verify-check').click();
  await expect(page.getByTestId('wsf-profile')).toBeVisible({ timeout: 20_000 });
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
