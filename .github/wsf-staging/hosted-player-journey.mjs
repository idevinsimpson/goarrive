#!/usr/bin/env node
/**
 * THE BROWSER/PLAYER JOURNEY, AGAINST DEPLOYED STAGING.
 *
 * WHAT THIS EXISTS FOR. The 24-row Package E suite proves the turn SERVICE:
 * callables, authorization, arithmetic, privacy and cleanup. It opens no
 * browser against the player, so a green service row says nothing about what
 * a person at the event actually meets. Runs 28-32 were repeatedly at risk of
 * being read as end-to-end readiness; they are not, and this file is the
 * separate gate.
 *
 * WHAT IT DOES NOT PROVE, stated here so no receipt has to be read carefully
 * to find out:
 *   - It is not proof of verification-EMAIL delivery. Every phone identity
 *     here is a preverified synthetic fixture account. What is proven is that
 *     a person can sign in from the scanned event and reach it as a member,
 *     not that a real person could receive and follow a verification mail.
 *   - It DOES assert that the scanned event survives sign-in, and it asserts
 *     it of the PRODUCT. The build this was first written against dropped the
 *     event: its sign-in link was a plain `href="/signin"` and sign-in ended
 *     with `router.replace(nextRouteAfterAuth('/'))`, which carried a pending
 *     JOIN code or a kiosk return goal and nothing else. An interim version of
 *     this file navigated back with `page.goto` and said so honestly — but a
 *     green run then proved only that the harness could find the event, which
 *     is not something anyone standing at one can do. It now waits for the
 *     address to become the scanned event on its own, and a build without the
 *     return fails here rather than passing quietly.
 *   - It is not proof of an authorized movement VIDEO. The product's default
 *     is its own poster/fallback drawing; a poster pass is a poster pass.
 *   - It is Chromium. Playwright's WebKit is an automated engine, not Safari,
 *     and this file never labels it Safari.
 *
 * CLEANUP. Every document and account is tracked BEFORE the mutation that
 * creates it, into the same manifest contract cleanup-synthetic.mjs already
 * enforces: tagged paths by run tag, server-named paths by a `via` identifier
 * this run has already proven is its own. Nothing here is deleted by this
 * file; the workflow's existing cleanup step is the only deleter.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const requireFromApp = createRequire(path.resolve('apps/westayfit/package.json'));
const { chromium } = requireFromApp('@playwright/test');

const PROJECT_ID = 'westayfit-staging';
const EXPECTED_SHA = process.env.WSF_APPROVED_SHA;
if (!/^[0-9a-f]{40}$/.test(EXPECTED_SHA || '')) throw new Error('WSF_APPROVED_SHA is required');
const BASE_URL = 'https://westayfit-staging--staging-4a616y5m.web.app';
const FUNCTIONS_BASE = `https://us-central1-${PROJECT_ID}.cloudfunctions.net`;
const OAUTH = process.env.WSF_GOOGLE_ACCESS_TOKEN;
const SDK_FILE = process.env.WSF_SDK_CONFIG_FILE;
const RESULT_DIR = process.env.WSF_RESULT_DIR || path.resolve('wsf-player-results');
const SHOT_DIR = path.join(RESULT_DIR, 'screenshots');
const CLEANUP_MANIFEST = process.env.WSF_CLEANUP_MANIFEST;

if (!OAUTH) throw new Error('WSF_GOOGLE_ACCESS_TOKEN is required');
if (!SDK_FILE) throw new Error('WSF_SDK_CONFIG_FILE is required');
if (!CLEANUP_MANIFEST) throw new Error('WSF_CLEANUP_MANIFEST is required');

process.umask(0o077);
fs.mkdirSync(SHOT_DIR, { recursive: true, mode: 0o700 });
const sdkRaw = JSON.parse(fs.readFileSync(SDK_FILE, 'utf8'));
const sdk = sdkRaw?.result?.sdkConfig ?? sdkRaw?.sdkConfig ?? sdkRaw?.result ?? sdkRaw;
if (sdk?.projectId !== PROJECT_ID || typeof sdk?.apiKey !== 'string') {
  throw new Error('Protected SDK metadata is not the staging Web App config');
}
const API_KEY = sdk.apiKey;

const runTag = `e5j-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
const cleanup = { users: new Set(), docs: new Set(), linked: new Map() };
function persistCleanup() {
  fs.mkdirSync(path.dirname(CLEANUP_MANIFEST), { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    CLEANUP_MANIFEST,
    JSON.stringify({
      project: PROJECT_ID,
      runTag,
      users: [...cleanup.users],
      docs: [...cleanup.docs],
      linkedDocs: [...cleanup.linked].map(([docPath, via]) => ({ path: docPath, via })),
    }, null, 2) + '\n',
    { mode: 0o600 }
  );
  fs.chmodSync(CLEANUP_MANIFEST, 0o600);
}
function trackUser(uid) { cleanup.users.add(uid); persistCleanup(); }
function trackDoc(docPath) { cleanup.docs.add(docPath); persistCleanup(); }
/** A document the SERVER named, claimed through an identifier this run owns. */
function trackLinked(docPath, via) { cleanup.linked.set(docPath, via); persistCleanup(); }

const results = [];
function assert(condition, message) { if (!condition) throw new Error(message); }
function check(name, status, detail = '') {
  results.push({ name, status, detail });
  console.log(`${status} ${name}${detail ? ` — ${detail}` : ''}`);
}
function sanitize(value) {
  return String(value)
    .replaceAll(API_KEY, '[REDACTED_API_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/[A-Za-z0-9._%+-]+@example\.com/gi, '[SYNTHETIC_EMAIL]')
    .replace(/("joinCode"\s*:\s*)(\{[^{}]*\}|"[^"]*")/gi, '$1"[REDACTED_JOIN_CODE]"')
    .replace(/\/join\/[A-Za-z0-9_-]+/g, '/join/[REDACTED_JOIN_CODE]')
    .slice(0, 1000);
}

async function jsonRequest(url, { method = 'GET', oauth = false, bearer = null, body, allow = [] } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (oauth && bearer) throw new Error('A request is either admin-scoped or end-user-scoped, never both');
  if (oauth) headers.authorization = `Bearer ${OAUTH}`;
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { parseError: true }; }
  if (!response.ok && !allow.includes(response.status)) {
    const code = parsed?.error?.status || parsed?.error?.message || `HTTP_${response.status}`;
    throw new Error(`${method} request failed: ${response.status} ${sanitize(code)}`);
  }
  return { status: response.status, ok: response.ok, body: parsed };
}
function fv(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number' && Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === 'number') return { doubleValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  throw new Error(`Unsupported Firestore value type: ${typeof value}`);
}
const fields = (record) => Object.fromEntries(Object.entries(record).map(([k, v]) => [k, fv(v)]));
const firestoreUrl = (docPath) =>
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}`;
async function putDoc(docPath, record) {
  // TRACKED BEFORE THE WRITE. A document created and then tracked is a
  // document that leaks whenever the write succeeds and the process dies.
  trackDoc(docPath);
  await jsonRequest(firestoreUrl(docPath), { method: 'PATCH', oauth: true, body: { fields: fields(record) } });
}
const getDoc = (docPath, allow = []) => jsonRequest(firestoreUrl(docPath), { oauth: true, allow });

async function createVerifiedUser(label) {
  const suffix = `${runTag}-${label}-${crypto.randomBytes(2).toString('hex')}`;
  const email = `wsf-${suffix}@example.com`;
  const password = `Wsf!${crypto.randomBytes(18).toString('base64url')}`;
  const response = await jsonRequest(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(API_KEY)}`,
    {
      method: 'POST',
      oauth: true,
      body: {
        targetProjectId: PROJECT_ID, email, password,
        displayName: `WSF ${label}`, emailVerified: true, disabled: false, returnSecureToken: false,
      },
    }
  );
  const uid = response.body?.localId;
  assert(typeof uid === 'string' && uid.length > 0, 'Auth create did not return localId');
  trackUser(uid);
  return { uid, email, password, label };
}
async function signInToken(user) {
  const response = await jsonRequest(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(API_KEY)}`,
    { method: 'POST', body: { email: user.email, password: user.password, returnSecureToken: true } }
  );
  assert(typeof response.body?.idToken === 'string', 'Synthetic sign-in did not return idToken');
  return response.body.idToken;
}
async function callFunction(name, data, idToken = null) {
  const headers = { 'content-type': 'application/json' };
  if (idToken) headers.authorization = `Bearer ${idToken}`;
  const response = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method: 'POST', headers, body: JSON.stringify({ data }),
  });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { parseError: true }; }
  return { status: response.status, ok: response.ok, body };
}
function callFailure(step, response) {
  // A closed door and an application refusal are different failures and the
  // receipt must say which — a transport block must never read as a product bug.
  if (response.ok) return null;
  const status = response.body?.error?.status;
  if (response.status === 403 && !status) return `${step}: TRANSPORT refusal (403 before the handler)`;
  return `${step}: application refusal (${status || `HTTP_${response.status}`})`;
}
async function call(step, name, data, idToken = null) {
  const response = await callFunction(name, data, idToken);
  const failure = callFailure(step, response);
  if (failure) throw new Error(failure);
  return response.body?.result ?? response.body?.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE FIXTURE: one community, two activities, one combined event.
//
// Seeded through the privileged path for the community and goals (as the
// 24-row suite does), and through the product's OWN callables for everything
// the product owns: the combined event, the display authorization, the
// station enrolment. A fixture written behind the product's back would prove
// the harness, not the product.
// ─────────────────────────────────────────────────────────────────────────────
async function seedEvent() {
  const champion = await createVerifiedUser('champion');
  const phoneOne = await createVerifiedUser('phone-one');
  const phoneTwo = await createVerifiedUser('phone-two');

  const groupId = `e5jgrp-${runTag}`.slice(0, 120);
  const now = new Date();
  const started = new Date(now.getTime() - 60_000);
  const ends = new Date(now.getTime() + 3_600_000);

  await putDoc(`wsfCommunityGroups/${groupId}`, {
    displayName: `Player journey ${runTag}`,
    groupType: 'custom',
    joinPolicy: 'private',
    joinCode: crypto.randomBytes(16).toString('base64url'),
    createdByUserId: champion.uid,
    lifecycleStatus: 'active',
    isSample: false,
    createdAt: now,
    updatedAt: now,
  });
  for (const [user, role] of [[champion, 'foundingChampion'], [phoneOne, 'member'], [phoneTwo, 'member']]) {
    await putDoc(`wsfMemberships/${groupId}_${user.uid}`, {
      groupId, userId: user.uid, role, membershipStatus: 'active', createdAt: now, updatedAt: now,
    });
    // The called name a public screen may show comes from this profile, so it
    // is a name a real room could see: a first name, never an email.
    await putDoc(`wsfMemberProfiles/${user.uid}`, {
      displayName: role === 'foundingChampion' ? 'Robin Fields' : (user.label === 'phone-one' ? 'Alex Rivera' : 'Sam Okonkwo'),
      createdAt: now, updatedAt: now,
    });
  }

  const activities = [];
  for (const [index, title] of [[1, 'Squats round'], [2, 'Step-ups round']]) {
    const goalId = `e5jgoal-${runTag}-${index}`.slice(0, 120);
    await putDoc(`wsfGoals/${goalId}`, {
      ownerUid: champion.uid,
      communityGroupId: groupId,
      title,
      target: 2000,
      unit: index === 1 ? 'squats' : 'step-ups',
      status: 'active',
      startsAt: started,
      endsAt: ends,
      timezone: 'America/New_York',
      createdAt: now,
      updatedAt: now,
    });
    for (let shard = 0; shard < 10; shard += 1) trackDoc(`wsfGoalCounters/${goalId}/shards/${shard}`);
    activities.push({ goalId, title });
  }

  const championToken = await signInToken(champion);
  // THE PARENT'S WINDOW IS THE CHILDREN'S. wsfCreateCombinedGoal refuses a
  // parent that starts after its own children (index.ts COMBINED_WINDOW_MESSAGE),
  // and run 28 died on exactly that because the row re-read the clock.
  const combined = await call('create combined event', 'wsfCreateCombinedGoal', {
    communityGroupId: groupId,
    title: `Player journey ${runTag}`,
    unit: 'movements',
    target: 4000,
    startsAt: started.toISOString(),
    endsAt: ends.toISOString(),
    timezone: 'America/New_York',
    childGoalIds: activities.map((a) => a.goalId),
  }, championToken);
  assert(typeof combined?.setupId === 'string' && combined.setupId, 'combined setup id missing');
  const setupId = combined.setupId;
  trackLinked(`wsfCombinedGoals/${setupId}`, groupId);
  for (const activity of activities) {
    trackDoc(`wsfCombinedGoalClaims/${activity.goalId}`);
    for (let shard = 0; shard < 10; shard += 1) {
      trackDoc(`wsfCombinedCounters/${setupId}/shards/${activity.goalId}_${shard}`);
    }
  }

  // A SCREEN IS A DISPLAY. wsfStationState serves the hall through the display
  // route, which is gated on the goal's own aggregateDisplayAuthorized — a
  // station holds no membership. Run 29 died here. Only the activity the
  // screens stand on is authorized.
  await call('authorize display', 'wsfSetGoalDisplayAuthorization', {
    goalId: activities[0].goalId, authorized: true,
  }, championToken);

  return { groupId, activities, setupId, champion, championToken, phoneOne, phoneTwo, startedIso: started.toISOString(), endsIso: ends.toISOString() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Browser helpers. Every capture is labelled with its surface and width, so a
// reviewer can tell a 390 phone from a 1280 screen without opening the file.
// ─────────────────────────────────────────────────────────────────────────────
const PHONE = { locale: 'en-US', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const SCREEN = { locale: 'en-US', viewport: { width: 1280, height: 800 } };
const captures = [];
async function snap(page, surface, width, label) {
  const name = `${surface}-${width}-${label}.png`;
  await page.screenshot({ path: path.join(SHOT_DIR, name) });
  captures.push(name);
  return name;
}
async function visible(locator, timeout = 30_000) {
  await locator.waitFor({ state: 'visible', timeout });
  return locator;
}
async function textOf(locator, timeout = 30_000) {
  await visible(locator, timeout);
  return ((await locator.innerText()) || '').trim();
}
async function contains(locator, expected, timeout = 30_000) {
  const actual = await textOf(locator, timeout);
  assert(actual.includes(expected), `expected text containing "${expected}", found "${sanitize(actual)}"`);
  return actual;
}
async function signInOnPage(page, user) {
  await visible(page.getByTestId('wsf-signin-email'));
  await page.getByTestId('wsf-signin-email').fill(user.email);
  await page.getByTestId('wsf-signin-password').fill(user.password);
  await page.getByTestId('wsf-signin-submit').click();
}

// ─────────────────────────────────────────────────────────────────────────────
// THE ORDER THE SERVED BUILD ACTUALLY PUTS ON SCREEN.
//
// Run 33 (35495928362) timed out after 73 seconds waiting for
// `wsf-event-title` on the first cold open of the scanned link. That screen
// cannot appear there, and never could: this file asserted an order the
// product does not have. Read out of the candidate's own source at the SHA
// staging serves (app/event/[goalId].tsx, src/deviceMode.ts,
// src/eventActivity.ts, src/pendingJoinCode.ts), the order is:
//
//   1. `wsf-event-loading`        storage has not been read yet
//   2. `wsf-event-device-choice`  the device question, BEFORE any membership
//                                 call, any sign-in and any account — the
//                                 component inside it is `wsf-device-choice`,
//                                 its answers `-personal` and `-shared`
//   3. `wsf-event-signed-out`     a visitor with no session: an account
//                                 invitation, not the event
//   4. `wsf-event-title`          the member view, and only here
//
// Two further facts, established the same way, each of which would have
// failed a later step of this journey even with the device question handled:
//
//   - The activity is NOT preselected for a two-activity event
//     (`initialSelection` returns null unless exactly one is offered), and the
//     WHERE panel — `wsf-event-choice`, and so `wsf-event-queue-start` — is
//     rendered ONLY once an activity is selected. That applies on every fresh
//     load, including the one after leaving the line.
//   - Signing in from the event COMES BACK to it, and the product does that
//     itself. On the build this file was first written against it did not:
//     the link was a plain `href="/signin"` and sign-in ended with
//     `router.replace(nextRouteAfterAuth('/'))`, which carried a pending JOIN
//     code or a kiosk return goal and nothing else, so the phone landed on the
//     app's home with the scanned event lost. That is fixed in the product
//     (`src/eventReturn.ts`, merged as 6b257c3): a validated goal id is stored,
//     never a route, and the terminal outcome spends it. This journey asserts
//     that return and performs no navigation of its own after sign-in — see
//     reachMemberEvent.
// ─────────────────────────────────────────────────────────────────────────────

/** The device question, answered as somebody's own phone. */
async function answerOwnPhone(page, { capture = null } = {}) {
  await visible(page.getByTestId('wsf-event-device-choice'), 45_000);
  await visible(page.getByTestId('wsf-device-choice'));
  // Both answers are offered. A screen that only ever showed one would make
  // "chose personal" meaningless.
  await visible(page.getByTestId('wsf-device-choice-personal'));
  await visible(page.getByTestId('wsf-device-choice-shared'));
  if (capture) await snap(page, 'phone', 390, capture);
  await page.getByTestId('wsf-device-choice-personal').click();
}

/**
 * Open the scanned link on a phone that has never seen the app, answer the
 * device question, sign in, and come back to the event as a member.
 *
 * The return is explicit because the product does not do it: see above.
 */
async function reachMemberEvent(page, qrUrl, user, { captures = {} } = {}) {
  await page.goto(qrUrl, { waitUntil: 'domcontentloaded' });
  await answerOwnPhone(page, { capture: captures.deviceChoice ?? null });

  // A visitor with no session is invited to make an account. This is the
  // scanned event's real landing, and it is NOT the member view.
  await visible(page.getByTestId('wsf-event-signed-out'), 45_000);
  await visible(page.getByTestId('wsf-event-signup'));
  if (captures.signedOut) await snap(page, 'phone', 390, captures.signedOut);

  await page.getByTestId('wsf-event-signin').click();
  await signInOnPage(page, user);

  // THE PRODUCT BRINGS THEM BACK. This journey does not.
  //
  // An earlier version of this function navigated back with `page.goto(qrUrl)`
  // and asserted that the product had NOT returned. That encoded the defect:
  // a green run proved the harness could find its way to the event, which is
  // not a thing anyone at an event can do. The contract is that scanning,
  // signing in and arriving is ONE journey, so the only honest assertion is
  // that the address changes to the scanned event on its own.
  //
  // Nothing here touches the address bar between the sign-in submit and this
  // wait, so a pass cannot be the harness's own navigation.
  const expectedPath = new URL(qrUrl).pathname;
  await page.waitForURL(
    (url) => url.pathname === expectedPath,
    { timeout: 60_000 }
  );
  const landed = new URL(page.url()).pathname;
  assert(
    landed === expectedPath,
    `sign-in did not come back to the scanned event: landed on ${landed}, expected ${expectedPath}`
  );

  // The device answer is remembered per browser, so the question is not asked
  // again — and the member view is what a signed-in member sees.
  await visible(page.getByTestId('wsf-event-title'), 60_000);
  assert(
    (await page.getByTestId('wsf-event-device-choice').count()) === 0,
    'the device question was asked again after sign-in, in a browser that already answered it'
  );
  return landed;
}

/**
 * Choose an activity BY THE TITLE A PERSON READS, never by a guessed testID:
 * the option ids are slugs of labels. The WHERE panel does not exist until
 * this has happened.
 */
async function chooseActivityByTitle(page, title) {
  await visible(page.getByTestId('wsf-event-activity'), 45_000);
  const optionIds = (await testIdsWithPrefix(page, 'wsf-event-activity-'))
    .filter((id) => id !== 'wsf-event-activity-options' && id !== 'wsf-event-activity-none');
  assert(optionIds.length === 2, `a two-activity event offered ${optionIds.length} options`);
  // Nothing is chosen for a two-activity event, so the WHERE panel must be
  // absent right now. If it were already there, "choosing" would prove nothing.
  assert(
    (await page.getByTestId('wsf-event-choice').count()) === 0,
    'the where-panel is on screen before any activity was chosen'
  );
  let chosenId = null;
  for (const id of optionIds) {
    if ((await textOf(page.getByTestId(id))).includes(title)) chosenId = id;
  }
  assert(chosenId, `no option named "${title}"`);
  await page.getByTestId(chosenId).click();
  await visible(page.getByTestId('wsf-event-choice'));
  await contains(page.getByTestId('wsf-event-choice-activity'), title);
  return chosenId;
}
/**
 * A SECOND INDEPENDENT PARTICIPANT, on their own account and their own phone.
 *
 * The acceptance asked for independent 390px phone accounts, and the first
 * version seeded `phoneTwo` and never opened a browser for them. That left
 * the two-screen assertion able to pass for the wrong reason: with one person
 * in the line, the second screen shows nobody, and "the second screen is not
 * showing the first person's code" is true of an empty screen.
 */
async function joinSecondPhone(browser, fx, qrUrl) {
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  // A SEPARATE BROWSER, so this phone answers the device question on its own
  // account — the first phone's answer is stored per browser and cannot carry.
  await reachMemberEvent(page, qrUrl, fx.phoneTwo);
  // AND IT CHOOSES ITS OWN ACTIVITY. The earlier version went straight for
  // the queue button, which is not rendered until an activity is selected —
  // so this participant could never have reached the line at all.
  await chooseActivityByTitle(page, fx.activities[0].title);
  await page.getByTestId('wsf-event-queue-start').click();
  await visible(page.getByTestId('wsf-event-queue-panel'));
  await page.getByTestId('wsf-event-queue-name-first').click();
  await page.getByTestId('wsf-event-queue-join').click();
  await visible(page.getByTestId('wsf-queue-standing'), 60_000);
  const token = await signInToken(fx.phoneTwo);
  const mine = await call('second phone place', 'wsfMyTurn', { goalId: fx.activities[0].goalId }, token);
  assert(mine?.turn?.entryId, 'the second phone joined and the server does not have it in the line');
  trackLinked(`wsfTurnEntries/${mine.turn.entryId}`, fx.activities[0].goalId);
  trackLinked(`wsfTurnMembers/${`setup__${fx.setupId}`}__${fx.phoneTwo.uid}`, fx.phoneTwo.uid);
  trackLinked(`wsfTurnReceipts/${`setup__${fx.setupId}`}__${fx.phoneTwo.uid}`, fx.phoneTwo.uid);
  await snap(page, 'phone', 390, '20-second-phone-waiting');
  return { context, page, entryId: mine.turn.entryId, code: mine.turn.code ?? null };
}

/** Every element whose testID starts with a prefix, as ids. */
async function testIdsWithPrefix(page, prefix) {
  return page.evaluate((p) => Array.from(document.querySelectorAll(`[data-testid^="${p}"]`))
    .map((el) => el.getAttribute('data-testid')), prefix);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE SCREEN ENROLS ITSELF, AND THE LINK IT SHOWS IS THE REAL ONE.
//
// Both screens pair through the station page's own UI. The Champion approves
// through the product's callable — the approval is a Champion action, not a
// screen action, and this file's subject is the screen and the phone.
// ─────────────────────────────────────────────────────────────────────────────
async function enrolScreen(browser, fx, slot) {
  const context = await browser.newContext(SCREEN);
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/station/${fx.activities[0].goalId}`, { waitUntil: 'domcontentloaded' });
  const code = (await textOf(page.getByTestId('wsf-station-pairing-code'))).replace(/\s+/g, '');
  assert(/^[A-Z0-9]{6}$/.test(code), `station ${slot} showed no six-character pairing code`);

  // THE CAPTURE MUST NOT CARRY A WORKING ENROLMENT CREDENTIAL.
  //
  // This screenshot was uploaded with the live six-character approval code
  // legible in it. scan-evidence.mjs cannot read pixels — it lists PNGs as
  // UNSCANNABLE and exits clean — so the redaction gate never looked at them,
  // and anyone with the artifact could have enrolled a screen on this goal.
  // The code element is replaced with a visible redaction before the shutter,
  // so the pairing LAYOUT is still evidence and the credential is not in it.
  await page.evaluate((testId) => {
    const el = document.querySelector(`[data-testid="${testId}"]`);
    if (el) el.textContent = '\u2588\u2588\u2588\u2588\u2588\u2588';
  }, 'wsf-station-pairing-code');
  await snap(page, 'station', 1280, `0${slot}-pairing-code-redacted`);

  const approved = await call(`approve screen ${slot}`, 'wsfApproveStation', {
    goalId: fx.activities[0].goalId, code, slot,
  }, fx.championToken);
  assert(approved?.slot === slot, `screen ${slot} was approved into slot ${approved?.slot}`);
  trackLinked(`wsfKioskStations/${approved.stationId}`, fx.activities[0].goalId);

  // THE PAIRING DOCUMENT, READ FROM THE STATION THE SERVER JUST WROTE.
  //
  // wsfApproveStation returns { stationId, slot, label, goalId } and NO
  // pairingId, so the `if (approved.pairingId)` this replaces could never be
  // true: two pairing documents were left on staging by every run, in
  // `claimed` state. StationDoc carries `pairingId` (it is how revocation
  // reaches the in-transit secret), so it is read back from there — and
  // validated against this run's goal and station before it is claimed, so a
  // wrong id can never be added to the manifest.
  const stationDoc = await getDoc(`wsfKioskStations/${approved.stationId}`);
  const pairingId = stationDoc.body?.fields?.pairingId?.stringValue;
  assert(typeof pairingId === 'string' && pairingId, `screen ${slot}: the station carries no pairingId to clean up`);
  const pairingDoc = await getDoc(`wsfKioskPairings/${pairingId}`);
  assert(
    pairingDoc.body?.fields?.goalId?.stringValue === fx.activities[0].goalId,
    `screen ${slot}: the pairing names a different goal than this run's`
  );
  assert(
    pairingDoc.body?.fields?.stationId?.stringValue === approved.stationId,
    `screen ${slot}: the pairing names a different station than the one approved`
  );
  trackLinked(`wsfKioskPairings/${pairingId}`, fx.activities[0].goalId);
  // The screen claims its own secret in-page. It is enrolled when it stops
  // showing a pairing code and starts showing the event.
  await visible(page.getByTestId('wsf-station-hero'), 60_000);
  await snap(page, 'station', 1280, `0${slot}-enrolled`);
  return { slot, stationId: approved.stationId, context, page };
}

async function caseQrLink(browser, fx, screenOne) {
  // THE LINK IS READ OFF THE SERVED SCREEN, not constructed by this file.
  const block = screenOne.page.getByTestId('wsf-station-qr-member');
  await visible(block);
  const url = await block.getAttribute('data-qr-url');
  assert(typeof url === 'string' && url, 'the screen shows no member QR link');
  const parsed = new URL(url);
  assert(`${parsed.protocol}//${parsed.host}` === BASE_URL, `the QR points at ${parsed.host}, not staging`);
  assert(parsed.pathname === `/event/${fx.activities[0].goalId}`, `the QR points at ${parsed.pathname}`);
  // NO AUTHORITY IN THE LINK. A link that carried a secret, a station id or a
  // token would be a credential printed on a wall.
  const lowered = url.toLowerCase();
  for (const forbidden of ['secret', 'token', 'key=', 'pairing', 'station', 'code=']) {
    assert(!lowered.includes(forbidden), `the QR link carries "${forbidden}"`);
  }
  await snap(screenOne.page, 'station', 1280, '02-member-qr');

  // IT RELOADS COLD, in a context that has never seen the app, and it does
  // not put anybody in the line.
  const before = await call('line before the scan', 'wsfMyTurn', { goalId: fx.activities[0].goalId }, await signInToken(fx.phoneOne));
  assert(!before?.turn, 'somebody was already in the line before the scan');
  const cold = await browser.newContext(PHONE);
  const coldPage = await cold.newPage();
  await coldPage.goto(url, { waitUntil: 'domcontentloaded' });
  // WHAT A COLD SCAN ACTUALLY REACHES. The device question first — before any
  // membership call, any sign-in and any account — then, once this phone says
  // it is somebody's own, the signed-out event landing. Run 33 waited here for
  // the member view, which a visitor with no session can never be shown.
  await answerOwnPhone(coldPage, { capture: '01-scanned-device-choice' });
  await visible(coldPage.getByTestId('wsf-event-signed-out'), 45_000);
  await snap(coldPage, 'phone', 390, '02-scanned-event-signed-out');
  // Nothing on that landing is the member view.
  assert(
    (await coldPage.getByTestId('wsf-event-title').count()) === 0,
    'the signed-out landing is showing the member view'
  );
  const after = await call('line after the scan', 'wsfMyTurn', { goalId: fx.activities[0].goalId }, await signInToken(fx.phoneOne));
  assert(!after?.turn, 'opening the scanned link enqueued somebody; looking is not joining');
  await cold.close();
  check('player journey — the scanned link', 'PASS',
    `read from the served screen; staging origin; /event/{goalId}; no secret, token, station id or code in it; reloads cold in a context that has never seen the app, which is asked whose screen it is BEFORE anything else and then shown the signed-out landing, never the member view; the line was empty before and after`);
  return url;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE PHONE GETS FROM A SCANNED LINK TO A PLACE IN THE LINE.
//
// Whose screen is this → an account → the event as a member → which activity
// → where. Every one of those is a step the served build puts in the way, in
// that order, and this case walks it.
//
// THE RETURN IS THE PRODUCT'S, AND THAT IS THE POINT. Scanning, signing in
// and arriving is one journey to the person doing it, so this case asserts the
// address becomes the scanned event by itself. It does not navigate back: a
// harness that walks itself to the destination proves nothing about whether
// anybody else could get there.
//
// PREVERIFIED-FIXTURE PROOF. The account is created already verified, so this
// proves nothing about verification-email delivery — a separate dependency,
// claimed nowhere in this file.
// ─────────────────────────────────────────────────────────────────────────────
async function casePhoneChoosesQueue(browser, fx, qrUrl) {
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();

  // Device question → signed-out landing → sign in → and the product brings
  // them back to the event by itself: see reachMemberEvent.
  const landedAfterSignIn = await reachMemberEvent(page, qrUrl, fx.phoneOne, {
    captures: { deviceChoice: '03-device-choice', signedOut: '04-signed-out-landing' },
  });
  await snap(page, 'phone', 390, '05-member-event');

  // THE ACTIVITY IS CHOSEN HERE, AFTER SIGN-IN, because the signed-out
  // landing does not offer one. The earlier version of this file chose an
  // activity before signing in and then claimed the choice survived the round
  // trip — a claim about a screen that was never on screen.
  await chooseActivityByTitle(page, fx.activities[0].title);
  await snap(page, 'phone', 390, '06-activity-chosen');

  // WHAT IS AND IS NOT CARRIED. Reported, not assumed: the event path writes
  // neither retained key (only /join/{code} does), so these are expected to be
  // null, and the assertion is that nothing points at a DIFFERENT goal.
  const carried = await page.evaluate(() => ({
    goalId: window.localStorage.getItem('wsf.pendingEventGoalId'),
    activity: window.localStorage.getItem('wsf.pendingEventActivity'),
  }));
  assert(carried.goalId === fx.activities[0].goalId || carried.goalId === null,
    'the retained event points at a different goal than the one scanned');

  // EXPLICITLY CHOOSING THE QUEUE. The event offers recording on the phone as
  // well; this is the choice, not a default.
  await visible(page.getByTestId('wsf-event-add'));
  await page.getByTestId('wsf-event-queue-start').click();
  await visible(page.getByTestId('wsf-event-queue-panel'));
  await snap(page, 'phone', 390, '07-queue-name-choice');
  // A public screen shows this name, so the person picks which form of it.
  await page.getByTestId('wsf-event-queue-name-first').click();
  await page.getByTestId('wsf-event-queue-join').click();

  await visible(page.getByTestId('wsf-queue-standing'), 60_000);
  const place = await textOf(page.getByTestId('wsf-queue-place'));
  const count = await textOf(page.getByTestId('wsf-queue-count'));
  assert(/\d/.test(place), `the waiting screen shows no real position: "${sanitize(place)}"`);
  assert(/\d/.test(count), `the waiting screen shows no real count: "${sanitize(count)}"`);
  await snap(page, 'phone', 390, '08-waiting-with-place');

  // CANCELLING IS AVAILABLE AND REAL, and rejoining restores a place.
  //
  // THE ABANDONED ENTRY IS TRACKED BEFORE IT IS ABANDONED.
  //
  // Leaving marks the first entry `left` and rejoining mints a SECOND random
  // document. Reading the entry id only after the rejoin tracked the second
  // and left the first behind on staging, every run. There is no way to
  // recover the id afterwards — the server named it and the member is no
  // longer on it — so it is captured here, while it is still theirs.
  const firstToken = await signInToken(fx.phoneOne);
  const beforeLeaving = await call('place before leaving', 'wsfMyTurn', { goalId: fx.activities[0].goalId }, firstToken);
  const firstEntryId = beforeLeaving?.turn?.entryId;
  assert(typeof firstEntryId === 'string' && firstEntryId, 'the phone is in the line with no entry id to clean up');
  trackLinked(`wsfTurnEntries/${firstEntryId}`, fx.activities[0].goalId);

  await visible(page.getByTestId('wsf-queue-leave'));
  await page.getByTestId('wsf-queue-leave').click();
  await visible(page.getByTestId('wsf-queue-not-in-line-reason'), 45_000);
  await snap(page, 'phone', 390, '09-left-the-line');
  await page.goto(qrUrl, { waitUntil: 'domcontentloaded' });
  // Signed in, and this browser has already said whose screen it is, so the
  // device question is not asked again — but the activity IS asked again: the
  // selection is component state, and nothing is preselected for a
  // two-activity event. Rejoining without choosing one would find no
  // where-panel and no queue button.
  await visible(page.getByTestId('wsf-event-title'), 45_000);
  assert(
    (await page.getByTestId('wsf-event-device-choice').count()) === 0,
    'the device question was asked again in a browser that already answered it'
  );
  await chooseActivityByTitle(page, fx.activities[0].title);
  await page.getByTestId('wsf-event-queue-start').click();
  await page.getByTestId('wsf-event-queue-name-first').click();
  await page.getByTestId('wsf-event-queue-join').click();
  await visible(page.getByTestId('wsf-queue-standing'), 60_000);
  // SWITCHING TO THE PHONE is offered as a way out that keeps the movement.
  await visible(page.getByTestId('wsf-queue-switch-to-phone'));
  await snap(page, 'phone', 390, '10-rejoined');

  // Every entry the server minted for this phone, tracked through the goal
  // this run created. Two joins means two entries; tracking only the last
  // would leave the first behind.
  const token = await signInToken(fx.phoneOne);
  const mine = await call('my place', 'wsfMyTurn', { goalId: fx.activities[0].goalId }, token);
  assert(mine?.turn, 'the phone rejoined and the server does not have it in the line');
  assert(typeof mine.turn.entryId === 'string', 'the place carries no entry id');
  // A rejoin is a NEW place at the back of the line, not the old one handed
  // back. If these were ever equal, the leave did not really leave.
  assert(
    mine.turn.entryId !== firstEntryId,
    'the rejoin returned the same entry, so leaving did not abandon a place'
  );
  trackLinked(`wsfTurnEntries/${mine.turn.entryId}`, fx.activities[0].goalId);
  const entry = await getDoc(`wsfTurnEntries/${mine.turn.entryId}`);
  const lineId = entry.body?.fields?.lineId?.stringValue;
  assert(typeof lineId === 'string' && lineId, 'the entry carries no lineId, so its line cannot be tracked');
  assert(lineId === `setup__${fx.setupId}`, `a combined event's line is setup__{setupId}; this one is ${lineId}`);
  trackLinked(`wsfTurnLines/${lineId}`, fx.groupId);
  trackLinked(`wsfTurnMembers/${lineId}__${fx.phoneOne.uid}`, fx.phoneOne.uid);
  trackLinked(`wsfTurnReceipts/${lineId}__${fx.phoneOne.uid}`, fx.phoneOne.uid);

  check('player journey — the phone chooses the queue', 'PASS',
    `preverified fixture account (NOT proof of verification-email delivery); asked whose screen this is before anything else and answered "my own phone"; the signed-out landing offered an account, not the event; after signing in the app returned to ${landedAfterSignIn} BY ITSELF, which is the scanned event's own address and not a navigation this journey performed; an activity was then chosen explicitly, and only then did the where-panel appear; recording on the phone was offered and the queue was chosen explicitly; a real position and count were shown; leaving emptied the place, and rejoining required choosing the activity again and took a new place`);
  return { context, page, lineId, entryId: mine.turn.entryId, code: mine.turn.code ?? null };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. TWO SCREENS CANNOT SURFACE THE SAME PERSON, AND NEITHER SHOWS A ROOM
//    ANYTHING IT SHOULD NOT.
// ─────────────────────────────────────────────────────────────────────────────
async function caseTwoScreens(fx, screenOne, screenTwo, phone, secondPhone) {
  await screenOne.page.getByTestId('wsf-station-call-next').click();
  await visible(screenOne.page.getByTestId('wsf-station-queue-serving'), 45_000);
  const servingOne = await textOf(screenOne.page.getByTestId('wsf-station-queue-serving'));
  const shortCode = await textOf(screenOne.page.getByTestId('wsf-station-queue-code'));
  assert(shortCode.trim().length > 0, 'the screen called somebody without showing a short code');
  await snap(screenOne.page, 'station', 1280, '03-called');

  // TWO REAL PEOPLE, ONE EACH.
  //
  // With only one participant in the line this assertion passed for the wrong
  // reason: the second screen showed NOBODY, and "not showing the first
  // person's code" is true of an empty screen. A second independent account
  // is now waiting on its own phone, so the second screen must be handed that
  // person — a different, non-empty code — and the two must never cross.
  await screenTwo.page.reload({ waitUntil: 'domcontentloaded' });
  await visible(screenTwo.page.getByTestId('wsf-station-hero'), 60_000);
  await screenTwo.page.getByTestId('wsf-station-call-next').click();
  await visible(screenTwo.page.getByTestId('wsf-station-queue-serving'), 45_000);
  const secondCode = (await textOf(screenTwo.page.getByTestId('wsf-station-queue-code'))).trim();
  assert(secondCode.length > 0, 'the second screen called nobody, so this proves nothing about two screens');
  assert(
    secondCode !== shortCode.trim(),
    'both screens are showing the same short code, so two screens claimed one person'
  );
  const secondHall = await screenTwo.page.innerText('body');
  assert(!secondHall.includes(shortCode.trim()), "the second screen is showing the first screen's participant");
  const firstHallAgain = await screenOne.page.innerText('body');
  assert(!firstHallAgain.includes(secondCode), "the first screen is showing the second screen's participant");
  // Neither screen may disclose either participant, whichever it is serving.
  for (const [label, hall] of [['first', firstHallAgain], ['second', secondHall]]) {
    for (const person of [fx.phoneOne, fx.phoneTwo]) {
      assert(!hall.includes(person.email), `the ${label} screen shows an email address`);
      assert(!hall.includes(person.uid), `the ${label} screen shows a uid`);
    }
  }
  await snap(screenTwo.page, 'station', 1280, '04-not-the-same-person');

  // WHAT A ROOM CAN READ. A first name or neutral alias and a short code —
  // never a queue of names, an email, or any identifier.
  const hall = await screenOne.page.innerText('body');
  assert(!hall.includes(fx.phoneOne.email), 'the hall shows an email address');
  assert(!hall.includes(fx.phoneOne.uid), 'the hall shows a uid');
  assert(!hall.includes(fx.phoneTwo.email), 'the hall shows another participant’s email');
  assert(!hall.includes('Okonkwo'), 'the hall shows a participant who is not being served');
  assert(!hall.includes('Rivera'), 'the hall shows a full name; a first name or alias is the contract');
  check('player journey — two screens, one person', 'PASS',
    `the first screen called and showed a short code; the second screen called into the same event and was not handed the same code; the hall carried no email, no uid, no full name and nobody but the person being served`);
  return { servingOne, shortCode: shortCode.trim() };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. READY ON THE PHONE, STARTED AT THE SCREEN, AND THE PLAYER ITSELF.
// ─────────────────────────────────────────────────────────────────────────────
async function casePlayer(fx, screenOne, phone) {
  await visible(phone.page.getByTestId('wsf-queue-called'), 60_000);
  await snap(phone.page, 'phone', 390, '11-called');
  // The person says they are ready; only then can the screen start them.
  await visible(phone.page.getByTestId('wsf-queue-ready-panel'));
  await phone.page.getByTestId('wsf-queue-ready').click();
  await snap(phone.page, 'phone', 390, '12-ready');

  await screenOne.page.getByTestId('wsf-station-turn-action').click();
  // BOTH SURFACES SHOW THE SAME ROUND. The player is one component with two
  // testID prefixes, so each is asserted on its own surface.
  for (const [page, prefix, surface, width] of [
    [screenOne.page, 'wsf-station-move', 'station', 1280],
    [phone.page, 'wsf-queue-move', 'phone', 390],
  ]) {
    await visible(page.getByTestId(`${prefix}-stage`), 60_000);
    // The poster/demo area, and what kind of media it is. The product's
    // default is its own drawing; an authorized video is a separate
    // dependency and this assertion never claims one.
    await visible(page.getByTestId(`${prefix}-figure`));
    const mediaLabel = await textOf(page.getByTestId(`${prefix}-media-label`));
    assert(mediaLabel.length > 0, `${surface}: the player shows no media label`);
    await visible(page.getByTestId(`${prefix}-round`));

    // THE DEFAULT ROUND IS SIXTY SECONDS, READ EXACTLY, NOT SAMPLED.
    //
    // The first version of this waited four seconds and checked the timer
    // contained a digit. A 30-second round, a 45-second round or an arbitrary
    // one would all have passed that. At `ready` the player renders the
    // round's own length (`${plan.roundSeconds}s`), so the default can be
    // read off the screen before anything starts and compared to the number.
    const readyTimer = (await textOf(page.getByTestId(`${prefix}-timer`))).trim();
    assert(
      readyTimer === `${EXPECTED_ROUND_SECONDS}s`,
      `${surface}: the default round reads "${sanitize(readyTimer)}", expected "${EXPECTED_ROUND_SECONDS}s"`
    );
    await snap(page, surface, width, '10-player-ready');
  }

  // THE COUNTDOWN BEGINS AT THREE, not merely somewhere at or below three.
  //
  // The previous version accepted any integer from 1 to 3, so a one-second
  // countdown would have passed while the receipt said "a count of three".
  // The count is sampled rapidly from the moment Start is pressed and the
  // HIGHEST value seen must be exactly the expected three: a countdown that
  // began at 1 never shows a 3, and one that began at 3 shows it within the
  // first second.
  await phone.page.getByTestId('wsf-queue-move-start').click();
  const seen = [];
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const raw = (await phone.page.getByTestId('wsf-queue-move-timer').innerText().catch(() => '')).trim();
    const value = Number(raw);
    if (Number.isInteger(value) && value > 0 && value <= EXPECTED_COUNTDOWN_SECONDS) seen.push(value);
    if (seen.includes(EXPECTED_COUNTDOWN_SECONDS)) break;
    await phone.page.waitForTimeout(60);
  }
  assert(seen.length > 0, 'no countdown was rendered at all after Start');
  const highest = Math.max(...seen);
  assert(
    highest === EXPECTED_COUNTDOWN_SECONDS,
    `the countdown began at ${highest}, expected ${EXPECTED_COUNTDOWN_SECONDS} — saw ${sanitize(seen.join(','))}`
  );
  await snap(phone.page, 'phone', 390, '13-countdown');

  // THE ROUND THE COUNTDOWN ENTERS IS THE SIXTY-SECOND ONE. Waiting past the
  // count, the timer must be a second count no greater than the default and
  // close to it — a 30-second round entered here would read 30s or less and
  // fail, which is exactly what the old "contains a digit" check allowed.
  await phone.page.waitForTimeout((EXPECTED_COUNTDOWN_SECONDS + 1) * 1_000);
  const running = (await textOf(phone.page.getByTestId('wsf-queue-move-timer'))).trim();
  const runningMatch = /^(\d+)s$/.exec(running);
  assert(runningMatch, `the running round timer reads "${sanitize(running)}", expected a seconds count`);
  const remaining = Number(runningMatch[1]);
  assert(
    remaining <= EXPECTED_ROUND_SECONDS && remaining >= EXPECTED_ROUND_SECONDS - 15,
    `the running round has ${remaining}s left, which is not a ${EXPECTED_ROUND_SECONDS}-second round a moment after it started`
  );
  await snap(phone.page, 'phone', 390, '14-round-running');

  // THE QR STAYS UP *DURING* MOVEMENT — asserted here, inside the running
  // round, not before Start. Somebody walking up mid-round can still join.
  await visible(screenOne.page.getByTestId('wsf-station-qr'), 30_000);

  // AND THE SCREEN IS RUNNING THE SAME ROUND, NOT PARKED ON ITS READY SCREEN.
  //
  // A station still showing its ready-state `60s` would have satisfied the
  // previous version: a visible QR plus a server document said nothing about
  // what the screen was actually displaying. A ready timer never moves, so
  // the proof is that the station's own timer DECREASES, and that it agrees
  // with the phone's remaining time — the same round, on both surfaces.
  const stationFirst = (await textOf(screenOne.page.getByTestId('wsf-station-move-timer'))).trim();
  const stationFirstMatch = /^(\d+)s$/.exec(stationFirst);
  assert(stationFirstMatch, `the station player reads "${sanitize(stationFirst)}", expected a seconds count`);
  const stationRemaining = Number(stationFirstMatch[1]);
  assert(
    Math.abs(stationRemaining - remaining) <= 5,
    `the station has ${stationRemaining}s left and the phone ${remaining}s — not the same round`
  );
  await screenOne.page.waitForTimeout(2_500);
  const stationSecond = (await textOf(screenOne.page.getByTestId('wsf-station-move-timer'))).trim();
  const stationSecondMatch = /^(\d+)s$/.exec(stationSecond);
  assert(stationSecondMatch, `the station player reads "${sanitize(stationSecond)}" a moment later`);
  assert(
    Number(stationSecondMatch[1]) < stationRemaining,
    `the station timer did not move (${stationRemaining}s then ${stationSecondMatch[1]}s), so the screen is parked rather than running the round`
  );
  // AND THE SCREEN IS STILL ON THIS ATTEMPT WHILE IT RUNS. Read from the
  // entry the server wrote rather than inferred from the pre-start screen:
  // continuity during the round is the claim, so it is checked during it.
  const midRound = await getDoc(`wsfTurnEntries/${phone.entryId}`);
  assert(
    midRound.body?.fields?.status?.stringValue === 'active',
    `mid-round the entry is ${midRound.body?.fields?.status?.stringValue}, not active`
  );
  assert(
    midRound.body?.fields?.attemptStationId?.stringValue === screenOne.stationId,
    'mid-round the attempt is bound to a different screen than the one running it'
  );
  await snap(screenOne.page, 'station', 1280, '04b-qr-during-movement');
  // Pause, resume, stop — the three controls a person needs mid-round.
  await visible(phone.page.getByTestId('wsf-queue-move-pause'));
  await phone.page.getByTestId('wsf-queue-move-pause').click();
  await visible(phone.page.getByTestId('wsf-queue-move-start'));
  await phone.page.getByTestId('wsf-queue-move-start').click();
  await visible(phone.page.getByTestId('wsf-queue-move-pause'));
  await visible(phone.page.getByTestId('wsf-queue-move-stop'));
  await phone.page.getByTestId('wsf-queue-move-stop').click();
  await snap(phone.page, 'phone', 390, '15-stopped');

  // PHONE AND SCREEN ARE ON THE SAME ATTEMPT. Read from the entry the server
  // wrote, not from either surface's own account of itself.
  const entry = await getDoc(`wsfTurnEntries/${phone.entryId}`);
  const attemptId = entry.body?.fields?.attemptId?.stringValue;
  const attemptStation = entry.body?.fields?.attemptStationId?.stringValue;
  assert(typeof attemptId === 'string' && attemptId, 'starting the turn minted no attempt id');
  assert(attemptStation === screenOne.stationId,
    'the attempt is bound to a different screen than the one that started it');
  trackDoc(`wsfContributions/${fx.activities[0].goalId}_${fx.phoneOne.uid}_${attemptId}`);
  trackDoc(`wsfGoalMemberTotals/${fx.activities[0].goalId}_${fx.phoneOne.uid}`);
  trackDoc(`wsfGoals/${fx.activities[0].goalId}/recentAdditions/${attemptId}`);
  trackDoc(`wsfCombinedCredits/${fx.activities[0].goalId}_${fx.phoneOne.uid}_${attemptId}`);

  check('player journey — ready, start and the round', 'PASS',
    `the phone said ready and the screen started the same session; both surfaces showed the poster/demo area, a media label, a timer and the round; the join QR stayed up during movement; a count of three preceded a running round; pause, resume and stop all responded; the entry binds the phone and the screen to one attempt`);
  return { attemptId };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. REVIEW, RECEIPT, AND A SCREEN THAT CLEARS ITSELF.
// ─────────────────────────────────────────────────────────────────────────────
const RECORDED = 12;
const RESULT_WINDOW_MS = 10_000;
/**
 * The product's own default, and the number this proof exists to pin.
 * `src/followAlong.ts` exports ROUND_SECONDS = 60, and the player renders it
 * as the timer's READY-state value (`${plan.roundSeconds}s`) — so the default
 * can be read off the rendered screen exactly, before anything starts, rather
 * than inferred from a stopwatch.
 */
const EXPECTED_ROUND_SECONDS = 60;
const EXPECTED_COUNTDOWN_SECONDS = 3;

async function caseReceiptAndClear(fx, screenOne, phone) {
  await visible(phone.page.getByTestId('wsf-queue-record-panel'), 45_000);
  await contains(phone.page.getByTestId('wsf-queue-turn-activity'), fx.activities[0].title);
  await snap(phone.page, 'phone', 390, '16-review');
  await phone.page.getByTestId('wsf-queue-record').fill(String(RECORDED));
  await snap(phone.page, 'phone', 390, '17-review-entered');
  await phone.page.getByTestId('wsf-queue-record').press('Enter');

  const amount = await textOf(phone.page.getByTestId('wsf-queue-receipt-amount'), 60_000);
  assert(amount.includes(String(RECORDED)), `the receipt reads "${sanitize(amount)}", expected ${RECORDED}`);
  await visible(phone.page.getByTestId('wsf-queue-receipt-scope'));
  await snap(phone.page, 'phone', 390, '18-receipt');

  // THE SCREEN SHOWS A RESULT AND NOTHING ELSE ABOUT THE PERSON.
  await visible(screenOne.page.getByTestId('wsf-station-queue-result'), 30_000);
  const result = await textOf(screenOne.page.getByTestId('wsf-station-queue-result'));
  assert(result.includes(String(RECORDED)), `the screen result reads "${sanitize(result)}"`);
  const hallAfter = await screenOne.page.innerText('body');
  assert(!hallAfter.includes('Rivera'), 'the screen still shows a name after recording');
  assert(!hallAfter.includes(fx.phoneOne.email), 'the screen shows an email after recording');
  assert(!hallAfter.includes(fx.phoneOne.uid), 'the screen shows a uid after recording');
  await snap(screenOne.page, 'station', 1280, '05-anonymous-result');

  // AND IT CLEARS ITSELF, proven by waiting past the real window rather than
  // by reading a constant.
  await screenOne.page.waitForTimeout(RESULT_WINDOW_MS + 5_000);
  await screenOne.page.getByTestId('wsf-station-recheck').click().catch(() => {});
  await screenOne.page.waitForTimeout(2_000);
  const cleared = await screenOne.page.innerText('body');
  assert(!cleared.includes(String(RECORDED)) || !(await screenOne.page.getByTestId('wsf-station-queue-result').count()),
    'the result is still on the screen after its window closed');
  await snap(screenOne.page, 'station', 1280, '06-cleared');

  // The phone keeps its receipt after the screen has forgotten the person.
  const stillThere = await textOf(phone.page.getByTestId('wsf-queue-receipt-amount'));
  assert(stillThere.includes(String(RECORDED)), 'the phone lost its own receipt when the screen cleared');
  await snap(phone.page, 'phone', 390, '19-receipt-retained');

  check('player journey — review, receipt and the cleared screen', 'PASS',
    `the review named the activity the person chose; ${RECORDED} was entered and the phone showed its own receipt; the screen showed the amount with no name, email or uid; after the real ten-second window the screen no longer carried the result, and the phone still did`);
}

// ─────────────────────────────────────────────────────────────────────────────
// THE RUN.
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  // THE ENGINE IS NAMED, AND IT IS NOT SAFARI. Playwright's WebKit is an
  // automated engine; calling it Safari would be a claim about a browser
  // nothing here ran.
  const browser = await chromium.launch();
  const engine = `Chromium ${browser.version()} (Playwright). NOT Safari, and no WebKit run is claimed.`;
  console.log(`ENGINE=${engine}`);
  let fx = null;
  const open = [];
  try {
    const health = await fetch(`${BASE_URL}/health`, { headers: { 'cache-control': 'no-cache' } });
    const marker = await health.text();
    assert(marker.includes(EXPECTED_SHA.slice(0, 7)),
      `staging is not serving the approved candidate ${EXPECTED_SHA.slice(0, 7)}`);
    check('player journey — correct staging build', 'PASS', `health marker ${EXPECTED_SHA.slice(0, 7)}`);

    fx = await seedEvent();
    const screenOne = await enrolScreen(browser, fx, 1);
    open.push(screenOne.context);
    const screenTwo = await enrolScreen(browser, fx, 2);
    open.push(screenTwo.context);

    const qrUrl = await caseQrLink(browser, fx, screenOne);
    const phone = await casePhoneChoosesQueue(browser, fx, qrUrl);
    open.push(phone.context);
    // A second independent participant, on their own account and phone, so the
    // two-screen case has two people to keep apart.
    const secondPhone = await joinSecondPhone(browser, fx, qrUrl);
    open.push(secondPhone.context);
    await caseTwoScreens(fx, screenOne, screenTwo, phone, secondPhone);
    await casePlayer(fx, screenOne, phone);
    await caseReceiptAndClear(fx, screenOne, phone);
  } catch (error) {
    check('player journey', 'FAIL', sanitize(error?.message || error));
  } finally {
    for (const context of open) await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  persistCleanup();
  const failures = results.filter((r) => r.status === 'FAIL').length;
  fs.writeFileSync(
    path.join(RESULT_DIR, 'player-journey-receipt.json'),
    JSON.stringify({ runTag, approvedSha: EXPECTED_SHA, engine, results, captures }, null, 2) + '\n',
    { mode: 0o600 }
  );
  console.log(`CAPTURES=${captures.length}`);
  console.log(`FAILURES=${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
