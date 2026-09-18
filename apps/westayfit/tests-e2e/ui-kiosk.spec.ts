import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

/**
 * KIOSK MODE — one goal, one shared device, many separate visitors.
 *
 * Drives the real thing against the emulators with SYNTHETIC fixtures:
 *   CASE 1  the whole walk-up — start screen, the existing sign-in, the
 *           existing contribution flow, Finish — and then the claim that
 *           makes a kiosk a kiosk: after Finish the device is signed out,
 *           carries no text identifying the previous visitor, and holds no
 *           kiosk session key or Firebase auth record. Then the claim that
 *           only a SECOND person can establish: visitor B walks up to the
 *           same device in the same browser, signs in as themselves, and
 *           gets their OWN session — zero own-credit, nothing of A's left
 *           mid-flight — while the shared total keeps A's effort, because
 *           that belongs to the community and not to A.
 *   CASE 2  a goal that is NOT display-authorized shows the public display's
 *           generic refusal, word for word, and never the goal.
 *   CASE 3  nobody touches the receipt: the countdown runs down and performs
 *           the same Finish by itself, and "Stay" puts it back.
 *
 * WHAT THESE DO NOT ESTABLISH. Nothing here is evidence that the person who
 * tapped is the person who moved — the kiosk makes no such claim and neither
 * do these tests. They cover a shared surface's hygiene, not verification.
 *
 * Every name, total and credit below is fixture data seeded for the run.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'demo-wsf-local';
const ARTIFACTS_DIR = path.resolve(__dirname, 'artifacts', 'ui-kiosk');
const PHONE = { width: 390, height: 844 };

/** The kiosk's idle window, in step with KIOSK_IDLE_MS in src/kioskSession.ts. */
const IDLE_MS = 90_000;

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

type GoalSeed = {
  goalId: string;
  title: string;
  target: number;
  unit: string;
  total: number;
  displayAuthorized: boolean;
};

async function seedGoal(groupId: string, ownerUid: string, g: GoalSeed): Promise<void> {
  const now = new Date();
  const endsInMs = 3 * 24 * 60 * 60_000;
  const fields: Record<string, unknown> = {
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
  };
  if (g.displayAuthorized) fields.aggregateDisplayAuthorized = { booleanValue: true };
  await firestoreWrite(`wsfGoals/${g.goalId}`, fields);
  await seedShards(g.goalId, g.total);
}

async function seedCommunity(
  tag: string,
  displayName: string,
  members: Array<{ uid: string; role: 'foundingChampion' | 'member' }>
): Promise<string> {
  const now = new Date();
  const groupId = `uiK-${tag}`;
  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: displayName },
    groupType: { stringValue: 'familyFriends' },
    joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: randomBytes(6).toString('base64url') },
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

type Fx = {
  stamp: string;
  password: string;
  memberEmail: string;
  memberName: string;
  memberUid: string;
  /** The SECOND walk-up. A separate verified account with its own profile and
   *  its own active membership — the next person in the queue, not a second
   *  session of the first one. */
  visitorEmail: string;
  visitorName: string;
  visitorUid: string;
  championUid: string;
  groupId: string;
};

async function seedBase(tag: string): Promise<Fx> {
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const password = 'uiK-password';
  const memberEmail = `wsf-uiK-member-${tag}-${stamp}@example.com`;
  const championEmail = `wsf-uiK-champ-${tag}-${stamp}@example.com`;
  // Deliberately NOT a variation on the first visitor's name: the assertions
  // below use `not.toContain`, and one name that is a substring of the other
  // would make B's own screen fail a check about A.
  const visitorEmail = `wsf-uiK-second-${tag}-${stamp}@example.com`;
  const championUid = await seedVerifiedUser(championEmail, password);
  const memberUid = await seedVerifiedUser(memberEmail, password);
  const visitorUid = await seedVerifiedUser(visitorEmail, password);
  const memberName = 'Fixture Kiosk Visitor';
  const visitorName = 'Dana Second Walkup';
  await seedProfile(championUid, 'Fixture Champion');
  await seedProfile(memberUid, memberName);
  await seedProfile(visitorUid, visitorName);
  const groupId = await seedCommunity(`${tag}-${stamp}`, 'Maple Street Movers', [
    { uid: championUid, role: 'foundingChampion' },
    { uid: memberUid, role: 'member' },
    { uid: visitorUid, role: 'member' },
  ]);
  return {
    stamp,
    password,
    memberEmail,
    memberName,
    memberUid,
    visitorEmail,
    visitorName,
    visitorUid,
    championUid,
    groupId,
  };
}

/** Every browser-storage key the page can see, by area. */
async function readStorage(page: Page): Promise<{ local: string[]; session: string[] }> {
  return page.evaluate(() => ({
    local: Object.keys(window.localStorage),
    session: Object.keys(window.sessionStorage),
  }));
}

test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

// ---- CASE 1 ---------------------------------------------------------------
test('a whole walk-up: start → sign in → contribute → Finish → start, with nothing left behind', async ({
  page,
}) => {
  // Two complete walk-ups in one test, each with its own sign-in round trip.
  test.setTimeout(300_000);
  const fx = await seedBase('walkup');
  const goalId = `uiK-goal-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, {
    goalId,
    title: 'Squats together this week',
    target: 500,
    unit: 'squats',
    total: 241,
    displayAuthorized: true,
  });

  // ---- the start screen: the public hero, one action, no identity ---------
  await page.goto(`/kiosk/${goalId}`);
  await expect(page.getByTestId('wsf-kiosk-screen')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-kiosk-community')).toHaveText('Maple Street Movers');
  await expect(page.getByTestId('wsf-kiosk-goal-title')).toHaveText('Squats together this week');
  await expect(page.getByTestId('wsf-kiosk-shared-total')).toHaveText('241');
  await expect(page.getByTestId('wsf-kiosk-total-line')).toHaveText('241 of 500 squats');
  await expect(page.getByTestId('wsf-kiosk-percent')).toHaveText('48.2% complete');
  await expect(page.getByTestId('wsf-kiosk-start')).toHaveText('Contribute here');
  // The action is a real touch target.
  const startBox = await page.getByTestId('wsf-kiosk-start').boundingBox();
  expect(startBox!.height).toBeGreaterThanOrEqual(44);
  // It never claims to witness anything.
  const startText = await page.getByTestId('wsf-kiosk-screen').innerText();
  expect(startText).not.toMatch(/verif|confirm(ed|s) that you|we saw|proof|witness|scan your/i);
  await snap(page, '01-start');

  // ---- the EXISTING sign-in, reached from the kiosk -----------------------
  await page.getByTestId('wsf-kiosk-start').click();
  await page.waitForURL(/\/contribute\/.*kiosk=1/, { timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-signed-out')).toBeVisible({ timeout: 20_000 });
  await snap(page, '02-sign-in-gate');
  await page.getByTestId('wsf-contribute-signin-link').click();
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-signin-email').fill(fx.memberEmail);
  await page.getByTestId('wsf-signin-password').fill(fx.password);
  await page.getByTestId('wsf-signin-submit').click();

  // THE HANDOFF KEY HAS TO SURVIVE THE ROUND TRIP. It is the only thing
  // nextRouteAfterAuth() (src/pendingJoinCode.ts) can read to send this
  // visitor back to the kiosk's contribution screen instead of home, and the
  // whole hop is client-side — so the kiosk start screen is still mounted
  // underneath and anything it does on an auth change happens right here.
  // Sampled from the submit until the post-auth navigation lands, so a screen
  // that wipes the key mid-flight fails at the cause rather than twenty
  // seconds later at a URL that never arrives.
  const returnKeySamples: string[] = [];
  await expect
    .poll(
      async () => {
        const held = await page
          .evaluate(() => window.sessionStorage.getItem('wsf.kioskReturnGoalId'))
          // No document navigation happens on this hop, so the context should
          // never go away here; if it ever does, that is not the key going.
          .catch(() => '<context-unavailable>');
        returnKeySamples.push(held ?? '<cleared>');
        return page.url();
      },
      { timeout: 20_000, intervals: [50] }
    )
    .toMatch(/\/contribute\/.*kiosk=1/);
  // Never cleared at any point between the submit and the landing, and still
  // naming THIS goal when the routing read it.
  expect(returnKeySamples).not.toContain('<cleared>');
  expect(returnKeySamples[returnKeySamples.length - 1]).toBe(goalId);

  // Post-auth routing returns to the kiosk's contribution screen, not home.
  await page.waitForURL(/\/contribute\/.*kiosk=1/, { timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
  // A kiosk offers no way to wander into the signed-in member's community.
  await expect(page.getByTestId('wsf-contribute-back')).toHaveCount(0);
  await expect(page.getByTestId('wsf-kiosk-finish-chrome')).toBeVisible();
  await snap(page, '03-entry');

  // ---- the EXISTING self-counted entry ------------------------------------
  await page.getByTestId('wsf-contribute-entry').fill('20');
  await page.getByTestId('wsf-contribute-review').click();
  await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible();
  await page.getByTestId('wsf-contribute-submit').click();

  // ---- the receipt, with a prominent Finish and a countdown ---------------
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('261 of 500 squats');
  await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText(
    'Your total on this goal: 20 squats'
  );
  await expect(page.getByTestId('wsf-kiosk-finish')).toHaveText('Finish');
  const finishBox = await page.getByTestId('wsf-kiosk-finish').boundingBox();
  expect(finishBox!.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByTestId('wsf-kiosk-finish-explainer')).toHaveText(
    'Finish signs you out and returns this device to its start screen.'
  );
  await expect(page.getByTestId('wsf-kiosk-countdown')).toHaveText(/^Finishing in \d+ seconds?$/);
  await expect(page.getByTestId('wsf-kiosk-stay')).toBeVisible();
  // A confirmed receipt is not an unresolved one: no "check it from your own
  // device" line, because there is nothing left to check.
  await expect(page.getByTestId('wsf-kiosk-unresolved-note')).toHaveCount(0);
  await snap(page, '04-receipt-with-finish');

  // The account IS signed in at this moment — that is what makes the next
  // assertion mean something.
  const before = await readStorage(page);
  expect(before.local.some((k) => k.startsWith('firebase:authUser:'))).toBe(true);

  // ---- Finish --------------------------------------------------------------
  await page.getByTestId('wsf-kiosk-finish').click();
  await page.waitForURL(new RegExp(`/kiosk/${goalId}$`), { timeout: 20_000 });
  await expect(page.getByTestId('wsf-kiosk-screen')).toBeVisible({ timeout: 20_000 });
  await snap(page, '05-back-at-start');

  // 1. Signed out.
  const after = await readStorage(page);
  expect(after.local.some((k) => k.startsWith('firebase:authUser:'))).toBe(false);
  // 2. The kiosk's own session key is gone.
  expect(after.session).not.toContain('wsf.kioskReturnGoalId');
  // 3. A confirmed contribution leaves no pending record for anyone.
  expect(after.local.some((k) => k.startsWith('wsf.pendingContribution.'))).toBe(false);
  // 4. Nothing on screen identifies who was just here.
  const startAgain = await page.getByTestId('wsf-kiosk-screen').innerText();
  expect(startAgain).not.toContain(fx.memberEmail);
  expect(startAgain).not.toContain(fx.memberName);
  expect(startAgain).not.toMatch(/Your total|Recorded|20 squats/);
  // 5. And the next visitor starts at the sign-in gate, not inside a session.
  await page.getByTestId('wsf-kiosk-start').click();
  await expect(page.getByTestId('wsf-contribute-signed-out')).toBeVisible({ timeout: 20_000 });
  await snap(page, '06-next-visitor-signed-out');

  // 6. A reload of the kiosk start screen is also a reset: the same start,
  //    still signed out.
  await page.goto(`/kiosk/${goalId}`);
  await expect(page.getByTestId('wsf-kiosk-screen')).toBeVisible({ timeout: 20_000 });
  const afterReload = await readStorage(page);
  expect(afterReload.local.some((k) => k.startsWith('firebase:authUser:'))).toBe(false);

  // ---- THE SECOND WALK-UP -------------------------------------------------
  // Everything above is one person's session ending tidily. This is the claim
  // that needs two people: the next person to touch this device gets their
  // own session on it, and inherits nothing of the first person's except the
  // shared total, which was never the first person's to begin with.
  await page.getByTestId('wsf-kiosk-start').click();
  await page.waitForURL(/\/contribute\/.*kiosk=1/, { timeout: 20_000 });
  // B starts where every visitor starts: at the gate, not inside A's session.
  await expect(page.getByTestId('wsf-contribute-signed-out')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-contribute-signin-link').click();
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-signin-email').fill(fx.visitorEmail);
  await page.getByTestId('wsf-signin-password').fill(fx.password);
  await page.getByTestId('wsf-signin-submit').click();

  // The same post-auth return, for the second person in a row.
  await page.waitForURL(/\/contribute\/.*kiosk=1/, { timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-back')).toHaveCount(0);
  await expect(page.getByTestId('wsf-kiosk-finish-chrome')).toBeVisible();
  await snap(page, '07-second-visitor-entry');

  // NOTHING OF A. Not their address, not their name, not their credit.
  const bEntryText = await page.getByTestId('wsf-contribute-screen').innerText();
  expect(bEntryText).not.toContain(fx.memberEmail);
  expect(bEntryText).not.toContain(fx.memberName);
  expect(bEntryText).not.toContain('20 squats');
  expect(bEntryText).not.toMatch(/Recorded|Already recorded/);
  // B's own credit is B's own: the line renders above the entry card
  // (app/contribute/[goalId].tsx — renderCompactProgress) and reads zero for
  // a member who has never contributed to this goal.
  await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText(
    'Your total on this goal: 0 squats'
  );
  // A's twenty IS in the shared total, and belongs there: it is the
  // community's progress, not A's identity.
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText(
    '261 of 500 squats',
    { timeout: 20_000 }
  );
  // And nothing of A's is left mid-flight for B to inherit, resolve or be
  // asked about.
  await expect(page.getByTestId('wsf-contribute-pending')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-reconcile')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-receipt')).toHaveCount(0);
  await expect(page.getByTestId('wsf-kiosk-unresolved-note')).toHaveCount(0);
  const storageForB = await readStorage(page);
  expect(storageForB.local.some((k) => k.startsWith('wsf.pendingContribution.'))).toBe(false);

  // ---- B's own contribution, counted on top of A's ------------------------
  await page.getByTestId('wsf-contribute-entry').fill('5');
  await page.getByTestId('wsf-contribute-review').click();
  await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible();
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 30_000 });
  // 241 seeded + A's 20 + B's 5. Both walk-ups are in the community's total.
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('266 of 500 squats');
  // B is credited with B's five and with none of A's twenty.
  await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText(
    'Your total on this goal: 5 squats'
  );
  const bReceiptText = await page.getByTestId('wsf-contribute-screen').innerText();
  expect(bReceiptText).not.toContain(fx.memberEmail);
  expect(bReceiptText).not.toContain(fx.memberName);
  expect(bReceiptText).not.toContain('20 squats');
  await snap(page, '08-second-visitor-receipt');

  // ---- B Finishes, and the device is clean for whoever is third -----------
  await page.getByTestId('wsf-kiosk-finish').click();
  await page.waitForURL(new RegExp(`/kiosk/${goalId}$`), { timeout: 20_000 });
  await expect(page.getByTestId('wsf-kiosk-screen')).toBeVisible({ timeout: 20_000 });
  const afterB = await readStorage(page);
  expect(afterB.local.some((k) => k.startsWith('firebase:authUser:'))).toBe(false);
  expect(afterB.session).not.toContain('wsf.kioskReturnGoalId');
  expect(afterB.local.some((k) => k.startsWith('wsf.pendingContribution.'))).toBe(false);
  const startAfterB = await page.getByTestId('wsf-kiosk-screen').innerText();
  expect(startAfterB).not.toContain(fx.visitorEmail);
  expect(startAfterB).not.toContain(fx.visitorName);
  expect(startAfterB).not.toContain(fx.memberEmail);
  expect(startAfterB).not.toContain(fx.memberName);
  expect(startAfterB).not.toMatch(/Your total|Recorded|20 squats|5 squats/);
  // The public hero has moved with the community, and says only that.
  await expect(page.getByTestId('wsf-kiosk-shared-total')).toHaveText('266', { timeout: 20_000 });
  await expect(page.getByTestId('wsf-kiosk-total-line')).toHaveText('266 of 500 squats');
  await snap(page, '09-clean-after-second-visitor');
});

// ---- CASE 2 ---------------------------------------------------------------
test('an unauthorized goal shows the display’s generic refusal, word for word', async ({ page }) => {
  test.setTimeout(180_000);
  const fx = await seedBase('unauth');
  const goalId = `uiK-goal-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, {
    goalId,
    title: 'Squats together this week',
    target: 500,
    unit: 'squats',
    total: 241,
    displayAuthorized: false,
  });

  await page.goto(`/kiosk/${goalId}`);
  await expect(page.getByTestId('wsf-kiosk-not-available')).toBeVisible({ timeout: 20_000 });
  const kioskRefusal = await page.getByTestId('wsf-kiosk-not-available').innerText();
  expect(kioskRefusal).toContain('Nothing to show here');
  expect(kioskRefusal).toContain('This display isn’t currently available.');
  // Nothing about the goal, the community or WHY.
  expect(kioskRefusal).not.toContain('Squats together this week');
  expect(kioskRefusal).not.toContain('Maple Street Movers');
  expect(kioskRefusal).not.toContain('241');
  expect(kioskRefusal).not.toMatch(/authoriz|permission|champion|not found|doesn’t exist/i);
  // There is no way into the flow from a refusal.
  await expect(page.getByTestId('wsf-kiosk-start')).toHaveCount(0);
  await snap(page, '10-refusal');

  // The public display, on the same goal, says the same thing.
  await page.goto(`/display/${goalId}`);
  await expect(page.getByTestId('wsf-display-not-available')).toBeVisible({ timeout: 20_000 });
  const displayRefusal = await page.getByTestId('wsf-display-not-available').innerText();
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  expect(norm(kioskRefusal)).toBe(norm(displayRefusal));

  // A goal id that was never a goal is refused identically — no oracle.
  await page.goto('/kiosk/uiK-goal-does-not-exist');
  await expect(page.getByTestId('wsf-kiosk-not-available')).toBeVisible({ timeout: 20_000 });
  expect(norm(await page.getByTestId('wsf-kiosk-not-available').innerText())).toBe(norm(kioskRefusal));
});

// ---- CASE 3 ---------------------------------------------------------------
test('nobody touches it: the countdown finishes the session, and Stay puts it back', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const fx = await seedBase('idle');
  const goalId = `uiK-goal-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, {
    goalId,
    title: 'Squats together this week',
    target: 500,
    unit: 'squats',
    total: 100,
    displayAuthorized: true,
  });

  await page.goto(`/kiosk/${goalId}`);
  await page.getByTestId('wsf-kiosk-start').click();
  await expect(page.getByTestId('wsf-contribute-signed-out')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-contribute-signin-link').click();
  await page.getByTestId('wsf-signin-email').fill(fx.memberEmail);
  await page.getByTestId('wsf-signin-password').fill(fx.password);
  await page.getByTestId('wsf-signin-submit').click();
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-contribute-entry').fill('5');
  await page.getByTestId('wsf-contribute-review').click();
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 30_000 });

  // It counts DOWN, visibly.
  const readSeconds = async (): Promise<number> => {
    const text = await page.getByTestId('wsf-kiosk-countdown').innerText();
    return Number(/(\d+)/.exec(text)![1]);
  };
  const first = await readSeconds();
  expect(first).toBeGreaterThan(80);
  await page.waitForTimeout(4_000);
  const second = await readSeconds();
  expect(second).toBeLessThan(first);
  await snap(page, '20-countdown-running');

  // "Stay" is a NEW deadline, not a pause.
  await page.getByTestId('wsf-kiosk-stay').click();
  await expect
    .poll(readSeconds, { timeout: 5_000 })
    .toBeGreaterThan(second);
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible();

  // Then leave it alone. The session ends by itself, and ends the same way
  // Finish does.
  await page.waitForURL(new RegExp(`/kiosk/${goalId}$`), { timeout: IDLE_MS + 30_000 });
  await expect(page.getByTestId('wsf-kiosk-screen')).toBeVisible({ timeout: 20_000 });
  const after = await readStorage(page);
  expect(after.local.some((k) => k.startsWith('firebase:authUser:'))).toBe(false);
  expect(after.session).not.toContain('wsf.kioskReturnGoalId');
  const startAgain = await page.getByTestId('wsf-kiosk-screen').innerText();
  expect(startAgain).not.toContain(fx.memberEmail);
  expect(startAgain).not.toContain(fx.memberName);
  await snap(page, '21-idle-finished');
});
