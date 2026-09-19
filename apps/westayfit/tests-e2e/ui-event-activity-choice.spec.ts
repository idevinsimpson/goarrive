/**
 * THE SCANNED JOURNEY — event AND activity, a real account, and a line that
 * nobody is in until they say so.
 *
 * The approved journey, in the order a person meets it: they scan the code on
 * the screen in the room; their phone keeps BOTH what event it was and what
 * activity that screen was running, across a real signup, a real email
 * verification, a real profile and a real join; and only AFTER they have said
 * what they are here to do are they offered "Use my phone" or "Join the kiosk
 * queue".
 *
 * WHAT THIS FILE PROVES, and how:
 *
 *   1. BOTH HALVES SURVIVE A REAL ROUND TRIP. Not a reload — a signup, a
 *      verification, a profile and a join, four routes that each replace the
 *      page and lose the query string. The proof is the address the join lands
 *      on and what the screen then names, not a storage key read out of the
 *      browser: storage is the mechanism, and a mechanism is not the claim.
 *   2. THE TWO WAYS ON DO NOT EXIST UNTIL AN ACTIVITY IS SELECTED. Asserted as
 *      `toHaveCount(0)` — absent, not merely disabled or off-screen — at every
 *      point before the tap, and present immediately after it.
 *   3. NOTHING PUTS ANYBODY IN A LINE EXCEPT THE CONFIRMATION. The queue is
 *      read from FIRESTORE, by query, at five separate moments: after the
 *      scan, after the join lands, after the activity is selected, after the
 *      choice is on screen, and after the name control is open. It is empty at
 *      all five. It holds exactly one row — under the name the person chose,
 *      never their account name — only after "Join the kiosk queue" is
 *      confirmed. No screen is asked whether anybody is in the line; the line
 *      is asked.
 *   4. "USE MY PHONE" IS THE CONTRIBUTION FLOW THAT ALREADY EXISTS, with no
 *      kiosk session on it — the ordinary entry screen at the ordinary
 *      address.
 *
 * WHAT IT DOES NOT CLAIM. Nothing here is evidence about who was holding any
 * device, and nothing about the person is stored by carrying an activity: the
 * activity is a label the event already publishes, it is a selection rather
 * than a fact about anybody, and it leaves with the journey.
 *
 * PARALLEL-SAFE BY CONSTRUCTION (the config is fullyParallel): every test
 * mints its own accounts, its own community and its own goal, and the queue
 * query is filtered to that goal, so two tests running at once cannot see each
 * other's line.
 *
 * CAPTURES are written to tests-e2e/artifacts/ui-event-activity-choice/ in the
 * shape move-follow-along.spec.ts established. Nothing here asserts on an
 * image; a capture is evidence, never a reason a test passes.
 *
 * Every name, address, total and community below is fixture data minted for
 * the run inside the emulator.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ timeout: 240_000 });

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'demo-wsf-local';
const ARTIFACTS_DIR = path.resolve(__dirname, 'artifacts', 'ui-event-activity-choice');
const PHONE = { width: 390, height: 844 };
const PASSWORD = 'uiEA-password';

test.use({ viewport: PHONE });

/**
 * The literals src/eventActivity.ts exports. tests/event-activity.test.ts pins
 * the same strings on the other side, so the words on the screen and the words
 * in the module cannot drift apart silently — and the two the Director named
 * cannot be quietly reworded.
 */
const ACTIVITY_HEADING = 'What are you here to do?';
const CHOICE_HEADING = 'Where do you want to do it?';
const PHONE_LABEL = 'Use my phone';
const QUEUE_LABEL = 'Join the kiosk queue';
const CHOICE_NOTE =
  'Opening either one puts nobody in a line. You are in the line only once you confirm the name the screen will call.';

const PHONE_VIEWPORTS = [
  { label: 'phone-360', width: 360, height: 844 },
  { label: 'phone-390', width: 390, height: 844 },
  { label: 'phone-430', width: 430, height: 932 },
  { label: 'phone-390x640', width: 390, height: 640 },
];

// ---- the emulator, seeded and read directly ---------------------------------

const OWNER = { authorization: 'Bearer owner', 'content-type': 'application/json' };

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

/** Mark an address verified the way the mail link would, so the REAL verify
 * gate is passed rather than bypassed: the screen still has to re-check. */
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
  if (!res.ok) {
    throw new Error(`emulator write ${docPath} failed: ${res.status} ${await res.text()}`);
  }
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
    aggregateDisplayAuthorized: { booleanValue: true },
  });
  await seedShards(g.goalId, g.total);
}

async function seedCommunity(
  tag: string,
  displayName: string,
  joinCode: string,
  members: Array<{ uid: string; role: 'foundingChampion' | 'member' }>
): Promise<string> {
  const now = new Date();
  const groupId = `uiEA-${tag}`;
  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: displayName },
    groupType: { stringValue: 'familyFriends' },
    // Admission policy is untouched by this feature: a link admits to public
    // and inviteOnly alike, and this fixture uses the ordinary public case.
    joinPolicy: { stringValue: 'public' },
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

/**
 * THE LINE ITSELF, read from the store it lives in.
 *
 * The claim "no queue row exists yet" is about the line, so it is asked of
 * the line: a structured query over `wsfTurnEntries` filtered to this run's
 * own goal. Asking a screen instead would prove only that a screen was not
 * showing something, which is a different and much weaker sentence.
 *
 * The line is keyed per EVENT now, not per goal, so one account cannot sit in
 * several activity queues at once. The chosen child activity rides on the
 * entry as `goalId`, which is what this filter asks for — the same question
 * this helper always asked, at the address the entry actually has.
 */
async function queueRows(goalId: string): Promise<{ calledName: string; status: string }[]> {
  const url =
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`;
  const res = await fetch(url, {
    method: 'POST',
    headers: OWNER,
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'wsfTurnEntries' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'goalId' },
            op: 'EQUAL',
            value: { stringValue: goalId },
          },
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`queue read failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as {
    document?: { fields?: Record<string, { stringValue?: string }> };
  }[];
  return body
    .filter((row) => row.document)
    .map((row) => ({
      calledName: row.document!.fields?.calledName?.stringValue ?? '',
      status: row.document!.fields?.status?.stringValue ?? '',
    }));
}

async function snap(page: Page, name: string): Promise<void> {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, `${name}.png`), fullPage: false });
}

/** One state at every phone size, then the viewport put back exactly as it
 * was. No assertion is made about any of these images. */
async function snapPhoneWidths(page: Page, name: string): Promise<void> {
  const before = page.viewportSize();
  for (const v of PHONE_VIEWPORTS) {
    await page.setViewportSize({ width: v.width, height: v.height });
    await snap(page, `${v.label}-${name}`);
  }
  if (before) await page.setViewportSize(before);
}

/** A community that admits by link, with one goal running one activity. */
async function seedEvent(tag: string, unit: string) {
  const stamp = `${tag}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const joinCode = randomBytes(16).toString('base64url');
  const championUid = await seedVerifiedUser(`wsf-uiEA-champ-${stamp}@example.com`, PASSWORD);
  await seedProfile(championUid, 'Fixture Champion');
  const groupId = await seedCommunity(stamp, 'Expo Hall Movers', joinCode, [
    { uid: championUid, role: 'foundingChampion' },
  ]);
  const goalId = `uiEA-goal-${stamp}`;
  await seedGoal(groupId, championUid, {
    goalId,
    title: 'Expo Squat Challenge',
    target: 500,
    unit,
    total: 100,
  });
  return { stamp, joinCode, groupId, goalId, championUid };
}

// ─────────────────────────────────────────────────────────────────────────────

test('the scanned journey: event and activity survive a real signup, and nothing is in the line until the queue is confirmed', async ({
  page,
}) => {
  const unit = 'squats';
  const { stamp, joinCode, goalId } = await seedEvent('journey', unit);
  const email = `wsf-uiEA-newcomer-${stamp}@example.com`;

  // ---- 1. THE SCAN --------------------------------------------------------
  // What the code on the screen in the room encodes for a newcomer: the
  // existing join link, the event named on it, and the activity that screen is
  // running. No secret, no token, no authority — three public values.
  const scanned =
    `/join/${encodeURIComponent(joinCode)}` +
    `?event=${encodeURIComponent(goalId)}&activity=${encodeURIComponent(unit)}`;
  await page.goto(scanned);

  // The safety question comes first and is answered as a phone. It is not this
  // journey's subject; it is simply in the way of it, and it is left alone.
  await expect(page.getByTestId('wsf-join-device-choice')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('wsf-device-choice-personal').click();
  await expect(page.getByTestId('wsf-join-signed-out')).toBeVisible({ timeout: 30_000 });
  await snap(page, '01-scanned-invitation');

  // A SCAN ALONE NEVER ENQUEUES. Nobody has an account yet, and the line is
  // empty — asked of the line, not of a screen.
  expect(await queueRows(goalId), 'a scan must create no queue row').toEqual([]);

  // ---- 2. A REAL ACCOUNT, A REAL VERIFICATION, A REAL PROFILE -------------
  await page.getByTestId('wsf-join-signup').click();
  await expect(page.getByTestId('wsf-signup')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('wsf-signup-displayName').fill('Dara Okonjo');
  await page.getByTestId('wsf-signup-email').fill(email);
  await page.getByTestId('wsf-signup-password').fill(PASSWORD);
  // Registered before the click so the best-effort mail round trip is never
  // missed; signup ships forward to verify-email either way.
  const sendSettled = page.waitForResponse((r) => r.url().includes('wsfSendVerificationEmail'));
  await page.getByTestId('wsf-signup-submit').click();
  await expect(page.getByTestId('wsf-verify')).toBeVisible({ timeout: 30_000 });
  await sendSettled;
  await markEmailVerified(email);
  await page.getByTestId('wsf-verify-check').click();

  await expect(page.getByTestId('wsf-profile')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('wsf-profile-termsCheckbox').click();
  await page.getByTestId('wsf-profile-submit').click();

  // ---- 3. BACK AT THE JOIN, AND THEN THE JOIN ITSELF ---------------------
  await expect(page.getByTestId('wsf-join-signed-in')).toBeVisible({ timeout: 40_000 });
  expect(page.url()).toContain(`/join/${encodeURIComponent(joinCode)}`);
  // The query string is GONE from the address by now — four routes have
  // replaced this page — which is exactly why the next assertion means
  // something.
  expect(new URL(page.url()).searchParams.get('activity')).toBeNull();
  expect(await queueRows(goalId), 'signing up must create no queue row').toEqual([]);

  await page.getByTestId('wsf-join-submit').click();

  // ---- 4. THE CLAIM: BOTH HALVES SURVIVED --------------------------------
  await page.waitForURL(new RegExp(`/event/${goalId}`), { timeout: 40_000 });
  const landed = new URL(page.url());
  expect(landed.pathname, 'the EVENT survived the round trip').toBe(`/event/${goalId}`);
  expect(landed.searchParams.get('activity'), 'the ACTIVITY survived the round trip').toBe(unit);

  await expect(page.getByTestId('wsf-event-member')).toBeVisible({ timeout: 40_000 });
  // And the screen names it, so this is context the person can see rather than
  // a value in an address bar.
  const activityBlock = page.getByTestId('wsf-event-activity');
  await expect(activityBlock).toBeVisible();
  await expect(activityBlock).toContainText(ACTIVITY_HEADING);
  await expect(page.getByTestId(`wsf-event-activity-${unit}`)).toBeVisible();
  await snap(page, '02-landed-activity-not-yet-chosen');
  await snapPhoneWidths(page, 'activity-step');

  // ---- 5. THE TWO WAYS ON DO NOT EXIST YET -------------------------------
  // A scan is how somebody got here, not what they decided: the carried
  // activity is OFFERED and is not selected.
  await expect(page.getByTestId(`wsf-event-activity-${unit}-indicator-dot`)).toHaveCount(0);
  await expect(page.getByTestId('wsf-event-choice')).toHaveCount(0);
  await expect(page.getByTestId('wsf-event-add')).toHaveCount(0);
  await expect(page.getByTestId('wsf-event-queue-start')).toHaveCount(0);
  await expect(page.getByText(PHONE_LABEL, { exact: true })).toHaveCount(0);
  await expect(page.getByText(QUEUE_LABEL, { exact: true })).toHaveCount(0);
  expect(await queueRows(goalId), 'landing on the event must create no queue row').toEqual([]);

  // ---- 6. THE ACTIVITY IS SELECTED, AND ONLY THEN THE TWO CHOICES --------
  await page.getByTestId(`wsf-event-activity-${unit}`).click();
  await expect(page.getByTestId(`wsf-event-activity-${unit}-indicator-dot`)).toBeVisible();

  const choice = page.getByTestId('wsf-event-choice');
  await expect(choice).toBeVisible({ timeout: 10_000 });
  await expect(choice).toContainText(CHOICE_HEADING);
  // The choice says back what was chosen, so the activity is visibly the
  // selection this journey carried and not a value in an address bar.
  await expect(page.getByTestId('wsf-event-choice-activity')).toHaveText(unit);
  // The Director's two sentences, exactly.
  await expect(page.getByTestId('wsf-event-add')).toHaveText(PHONE_LABEL);
  await expect(page.getByTestId('wsf-event-queue-start')).toHaveText(QUEUE_LABEL);
  await expect(page.getByTestId('wsf-event-choice-note')).toHaveText(CHOICE_NOTE);
  await snap(page, '03-two-choices');
  await snapPhoneWidths(page, 'two-choices');

  // CHOOSING AN ACTIVITY IS NOT JOINING A QUEUE.
  expect(await queueRows(goalId), 'selecting an activity must create no queue row').toEqual([]);

  // ---- 7. OPENING THE CHOICE IS NOT JOINING EITHER -----------------------
  await page.getByTestId('wsf-event-queue-start').click();
  const nameBox = page.getByTestId('wsf-event-queue-name');
  await expect(nameBox).toBeVisible({ timeout: 10_000 });
  // The EXISTING name choice, unchanged: the first name pre-filled and never a
  // surname, initials one tap away.
  await expect(nameBox).toHaveValue('Dara');
  await expect(page.getByTestId('wsf-event-queue-name-initials')).toContainText('D.O.');
  await snap(page, '04-name-choice-open');
  expect(await queueRows(goalId), 'opening the name choice must create no queue row').toEqual([]);

  // ---- 8. THE ONE TAP THAT CREATES A PLACE IN THE LINE -------------------
  await page.getByTestId('wsf-event-queue-name-initials').click();
  await expect(nameBox).toHaveValue('D.O.');
  await page.getByTestId('wsf-event-queue-join').click();
  await page.waitForURL(new RegExp(`/queue/${goalId}`), { timeout: 30_000 });
  await expect(page.getByTestId('wsf-queue-screen')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('wsf-queue-called-as')).toHaveText('D.O.');
  await snap(page, '05-in-the-line');

  // ONE row, and it carries the name they chose — not their account name, not
  // their surname, not their address.
  const rows = await queueRows(goalId);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.calledName).toBe('D.O.');
  expect(rows[0]!.status).toBe('waiting');
  expect(rows[0]!.calledName).not.toContain('Okonjo');
  expect(rows[0]!.calledName).not.toContain('@');
});

test('“Use my phone” is the contribution flow that already exists, and is offered on the same terms', async ({
  page,
}) => {
  const unit = 'squats';
  const { stamp, goalId, groupId } = await seedEvent('phone', unit);

  // A member of this community, already signed in: the branch of the journey
  // that has no round trip to make, arriving with the same carried context.
  const email = `wsf-uiEA-member-${stamp}@example.com`;
  const uid = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(uid, 'Ada Lovelace');
  await firestoreWrite(`wsfMemberships/${groupId}_${uid}`, {
    groupId: { stringValue: groupId },
    userId: { stringValue: uid },
    role: { stringValue: 'member' },
    membershipStatus: { stringValue: 'active' },
    createdAt: tsField(new Date()),
    updatedAt: tsField(new Date()),
  });

  await page.goto('/signin');
  await page.getByTestId('wsf-signin-email').fill(email);
  await page.getByTestId('wsf-signin-password').fill(PASSWORD);
  await page.getByTestId('wsf-signin-submit').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 40_000 });

  await page.goto(`/event/${goalId}?activity=${encodeURIComponent(unit)}`);
  // The safety question, answered as a phone, and then left alone.
  await expect(page.getByTestId('wsf-event-device-choice')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('wsf-device-choice-personal').click();
  await expect(page.getByTestId('wsf-event-member')).toBeVisible({ timeout: 40_000 });

  // Same rule for this branch: a carried activity is not a decision.
  await expect(page.getByTestId('wsf-event-add')).toHaveCount(0);
  await expect(page.getByTestId('wsf-event-queue-start')).toHaveCount(0);
  expect(await queueRows(goalId)).toEqual([]);

  await page.getByTestId(`wsf-event-activity-${unit}`).click();
  await expect(page.getByTestId('wsf-event-add')).toHaveText(PHONE_LABEL);

  // ---- and it lands in the ORDINARY contribution flow --------------------
  await page.getByTestId('wsf-event-add').click();
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 40_000 });
  expect(new URL(page.url()).pathname).toBe(`/contribute/${goalId}`);
  // No kiosk session on it: this is somebody's own phone.
  expect(page.url()).not.toMatch(/kiosk=1/);
  await expect(page.getByTestId('wsf-kiosk-finish-chrome')).toHaveCount(0);
  await expect(page.getByTestId('wsf-kiosk-finish')).toHaveCount(0);
  // And the ordinary way back out of the flow.
  await expect(page.getByTestId('wsf-contribute-back')).toBeVisible();
  await snap(page, '06-use-my-phone-contribution');

  // Taking the phone route puts nobody in a line.
  expect(await queueRows(goalId), '“Use my phone” must create no queue row').toEqual([]);
});
