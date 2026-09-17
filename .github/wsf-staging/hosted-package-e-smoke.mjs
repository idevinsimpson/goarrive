#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const requireFromApp = createRequire(path.resolve('apps/westayfit/package.json'));
const { chromium } = requireFromApp('@playwright/test');

const PROJECT_ID = 'westayfit-staging';
// Supplied by the workflow from the reviewed approval file, so the smoke
// cannot drift from the candidate actually deployed.
const EXPECTED_SHA = process.env.WSF_APPROVED_SHA;
if (!/^[0-9a-f]{40}$/.test(EXPECTED_SHA || '')) throw new Error('WSF_APPROVED_SHA is required');
const BASE_URL = 'https://westayfit-staging--staging-4a616y5m.web.app';
const FUNCTIONS_BASE = `https://us-central1-${PROJECT_ID}.cloudfunctions.net`;
const OAUTH = process.env.WSF_GOOGLE_ACCESS_TOKEN;
const SDK_FILE = process.env.WSF_SDK_CONFIG_FILE;
const RESULT_DIR = process.env.WSF_RESULT_DIR || path.resolve('wsf-package-e-results');
const SHOT_DIR = path.join(RESULT_DIR, 'screenshots');
const CLEANUP_MANIFEST = process.env.WSF_CLEANUP_MANIFEST;

if (!OAUTH) throw new Error('WSF_GOOGLE_ACCESS_TOKEN is required');
if (!SDK_FILE) throw new Error('WSF_SDK_CONFIG_FILE is required');
if (!CLEANUP_MANIFEST) throw new Error('WSF_CLEANUP_MANIFEST is required');

process.umask(0o077);
fs.mkdirSync(SHOT_DIR, { recursive: true, mode: 0o700 });
const sdkRaw = JSON.parse(fs.readFileSync(SDK_FILE, 'utf8'));
const sdk = sdkRaw?.result?.sdkConfig ?? sdkRaw?.sdkConfig ?? sdkRaw?.result ?? sdkRaw;
if (sdk?.projectId !== PROJECT_ID || typeof sdk?.apiKey !== 'string') throw new Error('Protected SDK metadata is not the staging Web App config');
const API_KEY = sdk.apiKey;

const runTag = `e5h-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
const cleanup = { users: new Set(), docs: new Set() };
function persistCleanup() {
  fs.mkdirSync(path.dirname(CLEANUP_MANIFEST), { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    CLEANUP_MANIFEST,
    JSON.stringify({ project: PROJECT_ID, runTag, users: [...cleanup.users], docs: [...cleanup.docs] }, null, 2) + '\n',
    { mode: 0o600 }
  );
  fs.chmodSync(CLEANUP_MANIFEST, 0o600);
}
function trackUser(uid) {
  cleanup.users.add(uid);
  persistCleanup();
}
function trackDoc(docPath) {
  cleanup.docs.add(docPath);
  persistCleanup();
}
const results = [];
const diagnostics = [];
const synthetic = { runTag, groups: [], goals: [], challenges: [], users: [] };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function check(name, status, detail = '') {
  results.push({ name, status, detail });
  console.log(`${status} ${name}${detail ? ` — ${detail}` : ''}`);
}
function sanitize(value) {
  return String(value)
    .replaceAll(API_KEY, '[REDACTED_API_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/[A-Za-z0-9._%+-]+@example\.com/gi, '[SYNTHETIC_EMAIL]')
    .slice(0, 1000);
}
async function jsonRequest(url, { method = 'GET', oauth = false, body, allow = [] } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (oauth) headers.authorization = `Bearer ${OAUTH}`;
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
function fields(record) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, fv(value)]));
}
function firestoreUrl(docPath) {
  return `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}`;
}
async function putDoc(docPath, record, updateMask = null) {
  const mask = updateMask?.length ? `?${updateMask.map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`).join('&')}` : '';
  trackDoc(docPath);
  await jsonRequest(`${firestoreUrl(docPath)}${mask}`, { method: 'PATCH', oauth: true, body: { fields: fields(record) } });
}
async function getDoc(docPath, allow = []) {
  return jsonRequest(firestoreUrl(docPath), { oauth: true, allow });
}
async function deleteDoc(docPath) {
  await jsonRequest(firestoreUrl(docPath), { method: 'DELETE', oauth: true, allow: [404] });
}
async function readAuthorization(goalId) {
  const response = await getDoc(`wsfGoals/${goalId}`);
  return response.body?.fields?.aggregateDisplayAuthorized?.booleanValue === true;
}
async function setMembershipStatus(groupId, uid, status) {
  await putDoc(`wsfMemberships/${groupId}_${uid}`, { membershipStatus: status, updatedAt: new Date() }, ['membershipStatus', 'updatedAt']);
}
async function closeGoal(goalId) {
  await putDoc(`wsfGoals/${goalId}`, { status: 'closed', updatedAt: new Date() }, ['status', 'updatedAt']);
}

async function createVerifiedUser(label) {
  const suffix = `${runTag}-${label}-${crypto.randomBytes(2).toString('hex')}`;
  const email = `wsf-${suffix}@example.com`;
  const password = `Wsf!${crypto.randomBytes(18).toString('base64url')}`;
  const response = await jsonRequest(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(API_KEY)}`, {
    method: 'POST',
    oauth: true,
    body: {
      targetProjectId: PROJECT_ID,
      email,
      password,
      displayName: `WSF ${label}`,
      emailVerified: true,
      disabled: false,
      returnSecureToken: false,
    },
  });
  const uid = response.body?.localId;
  assert(typeof uid === 'string' && uid.length > 0, 'Auth create did not return localId');
  trackUser(uid);
  synthetic.users.push(uid);
  return { uid, email, password };
}
async function signInToken(user) {
  const response = await jsonRequest(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(API_KEY)}`, {
    method: 'POST',
    body: { email: user.email, password: user.password, returnSecureToken: true },
  });
  assert(typeof response.body?.idToken === 'string', 'Synthetic sign-in did not return idToken');
  return response.body.idToken;
}
async function deleteUsers() {
  if (cleanup.users.size === 0) return;
  const response = await jsonRequest(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:batchDelete`, {
    method: 'POST', oauth: true, body: { localIds: [...cleanup.users], force: true },
  });
  const errors = response.body?.errors || [];
  if (errors.length) throw new Error(`Synthetic Auth cleanup returned ${errors.length} errors`);
}

async function callFunction(name, data, idToken = null) {
  const headers = { 'content-type': 'application/json' };
  if (idToken) headers.authorization = `Bearer ${idToken}`;
  const response = await fetch(`${FUNCTIONS_BASE}/${name}`, { method: 'POST', headers, body: JSON.stringify({ data }) });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { parseError: true }; }
  return { status: response.status, ok: response.ok, body };
}
function callableData(response) {
  return response.body?.result ?? response.body?.data;
}
function isNotFound(response) {
  const status = response.body?.error?.status;
  return response.status === 404 && (status === 'NOT_FOUND' || status === 'not-found');
}

async function seedFixture(label, goals = 1, includeChallenge = false) {
  const champion = await createVerifiedUser(`${label}-champion`);
  const member = await createVerifiedUser(`${label}-member`);
  const outsider = await createVerifiedUser(`${label}-outsider`);
  const stamp = `${runTag}-${label}`;
  const groupId = `e5grp-${stamp}`.slice(0, 120);
  const now = new Date();
  const started = new Date(now.getTime() - 60_000);
  const ends = new Date(now.getTime() + 3_600_000);

  await putDoc(`wsfCommunityGroups/${groupId}`, {
    displayName: `Package E ${label}`,
    groupType: 'custom',
    joinPolicy: 'private',
    joinCode: crypto.randomBytes(8).toString('base64url'),
    createdByUserId: champion.uid,
    lifecycleStatus: 'active',
    isSample: false,
    createdAt: now,
    updatedAt: now,
  });
  for (const [user, role] of [[champion, 'foundingChampion'], [member, 'member']]) {
    await putDoc(`wsfMemberships/${groupId}_${user.uid}`, {
      groupId,
      userId: user.uid,
      role,
      membershipStatus: 'active',
      createdAt: now,
      updatedAt: now,
    });
    await putDoc(`wsfMemberProfiles/${user.uid}`, {
      displayName: `WSF ${label} ${role}`,
      createdAt: now,
      updatedAt: now,
    });
  }

  const goalIds = [];
  for (let index = 0; index < goals; index += 1) {
    const goalId = `e5goal-${stamp}-${index + 1}`.slice(0, 120);
    await putDoc(`wsfGoals/${goalId}`, {
      ownerUid: champion.uid,
      communityGroupId: groupId,
      title: `Package E ${label} goal ${index + 1}`,
      target: 5000,
      unit: 'squats',
      status: 'active',
      startsAt: started,
      endsAt: ends,
      timezone: 'America/New_York',
      createdAt: now,
      updatedAt: now,
    });
    goalIds.push(goalId);
    synthetic.goals.push(goalId);
    for (let shard = 0; shard < 10; shard += 1) trackDoc(`wsfGoalCounters/${goalId}/shards/${shard}`);
  }

  let challengeId = null;
  if (includeChallenge) {
    challengeId = `e5challenge-${stamp}`.slice(0, 120);
    await putDoc(`wsfChallenges/${challengeId}`, {
      groupId,
      title: `Package E ${label} challenge`,
      status: 'active',
      goalTarget: 10,
      startsAt: started,
      endsAt: ends,
    });
    synthetic.challenges.push(challengeId);
  }

  synthetic.groups.push(groupId);
  return { groupId, goalIds, challengeId, champion, member, outsider };
}

async function signInPage(page, user) {
  await page.goto(`${BASE_URL}/signin`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('wsf-signin-email').waitFor({ state: 'visible', timeout: 20_000 });
  await page.getByTestId('wsf-signin-email').fill(user.email);
  await page.getByTestId('wsf-signin-password').fill(user.password);
  await page.getByTestId('wsf-signin-submit').click();
  await page.waitForURL(/\/(profile-setup)?$/, { timeout: 20_000 });
}
async function snap(page, name) {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true });
}
async function visible(locator, timeout = 20_000) {
  await locator.waitFor({ state: 'visible', timeout });
}
/**
 * Bounded polling, not a single read.
 *
 * The previous pair waited for visibility and then read textContent ONCE. Every
 * value this suite cares about arrives asynchronously — a display total that
 * updates on the next poll, a permission line that flips after a callable
 * returns — so a single read races the thing under test and fails or passes on
 * timing rather than on behaviour. Re-reading until the value matches is what
 * Playwright's own retrying assertions do; this is that, without pulling in the
 * test runner.
 *
 * A fixed sleep would be the other way to "fix" this and is deliberately not
 * used: it is slower when things are fast and still wrong when they are slow.
 */
async function pollText(locator, predicate, describe, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let last = null;
  // Visibility first, so a missing element fails as missing rather than as a
  // text mismatch against null.
  await visible(locator, timeout);
  for (;;) {
    try {
      last = (await locator.textContent()) ?? '';
      if (predicate(last)) return last;
    } catch (error) {
      last = `<read failed: ${error.message}>`;
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert(false, `${describe}; last saw ${JSON.stringify(String(last).trim())}`);
}
async function textEquals(locator, expected, timeout = 20_000) {
  await pollText(
    locator,
    (text) => text.trim() === expected,
    `Expected text ${JSON.stringify(expected)}`,
    timeout
  );
}
async function textContains(locator, expected, timeout = 20_000) {
  await pollText(
    locator,
    (text) => text.includes(expected),
    `Expected text containing ${JSON.stringify(expected)}`,
    timeout
  );
}
/** For a value that must STAY absent/unchanged, not merely be absent once. */
async function staysAbsent(locator, durationMs = 6_000) {
  const deadline = Date.now() + durationMs;
  for (;;) {
    const count = await locator.count();
    assert(count === 0, `Expected the locator to remain absent, found ${count}`);
    if (Date.now() >= deadline) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function caseRoundTrip(browser) {
  const fx = await seedFixture('roundtrip', 1, true);
  const goalId = fx.goalIds[0];
  const championCtx = await browser.newContext();
  const memberCtx = await browser.newContext();
  const displayCtx = await browser.newContext();
  try {
    const champion = await championCtx.newPage();
    const member = await memberCtx.newPage();
    const display = await displayCtx.newPage();
    await signInPage(champion, fx.champion);
    await signInPage(member, fx.member);

    await champion.goto(`${BASE_URL}/community/${fx.groupId}`);
    const control = champion.getByTestId(`wsf-goal-display-auth-${goalId}`);
    const toggle = champion.getByTestId(`wsf-goal-display-auth-toggle-${goalId}`);
    const state = champion.getByTestId(`wsf-goal-display-auth-state-${goalId}`);
    await visible(control);
    await textEquals(state, 'Public display is not authorized for this goal.');
    assert((await readAuthorization(goalId)) === false, 'Goal should default to display OFF');

    await display.goto(`${BASE_URL}/display/${goalId}`);
    await visible(display.getByTestId('wsf-display-not-available'));
    await snap(display, '01-default-off-display-refused');

    await member.goto(`${BASE_URL}/community/${fx.groupId}`);
    await visible(member.getByTestId(`wsf-community-goal-link-${goalId}`));
    assert((await member.getByTestId(`wsf-goal-display-auth-${goalId}`).count()) === 0, 'Member unexpectedly has display authorization control');

    await toggle.click();
    await textContains(state, 'Public display is authorized for this goal.');
    assert((await readAuthorization(goalId)) === true, 'Champion authorization did not persist');
    await display.getByTestId('wsf-display-recheck').click();
    await visible(display.getByTestId('wsf-display-screen'), 30_000);
    assert((await display.getByTestId('wsf-display-shared-total').count()) === 1, 'Authorized display omitted shared total');
    assert((await display.getByText(fx.member.uid).count()) === 0, 'Display leaked member UID');
    assert((await display.getByText(fx.champion.uid).count()) === 0, 'Display leaked Champion UID');
    const publicPulse = await callFunction('wsfGoalPulse', { goalId });
    const publicPulseData = callableData(publicPulse);
    assert(publicPulse.ok && publicPulseData && !('contributorCount' in publicPulseData), 'Public goal pulse exposed contributorCount');
    await snap(champion, '02-champion-authorized-control');
    await snap(display, '03-authorized-display');

    const memberToken = await signInToken(fx.member);
    const attemptId = `attempt-${runTag}-roundtrip`;
    trackDoc(`wsfContributions/${goalId}_${fx.member.uid}_${attemptId}`);
    trackDoc(`wsfGoalMemberTotals/${goalId}_${fx.member.uid}`);
    const contribution = await callFunction('wsfContribute', { goalId, attemptId, count: 137 }, memberToken);
    const contributionData = callableData(contribution);
    assert(contribution.ok && contributionData?.ownCredit === 137 && contributionData?.sharedTotal === 137, 'Member contribution did not produce 137 personal/shared total');
    await member.goto(`${BASE_URL}/contribute/${goalId}`);
    await visible(member.getByTestId('wsf-contribute-screen'));
    await textEquals(member.getByTestId('wsf-contribute-own-credit'), 'Your confirmed credit: 137 squats');
    await textEquals(member.getByTestId('wsf-contribute-shared-total'), '137 squats');

    await toggle.click();
    await textEquals(state, 'Public display is not authorized for this goal.');
    await visible(display.getByTestId('wsf-display-not-available'), 30_000);
    await visible(member.getByTestId('wsf-contribute-screen'));
    await snap(display, '04-running-display-stopped');

    await toggle.click();
    await textContains(state, 'Public display is authorized for this goal.');
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    await visible(display.getByTestId('wsf-display-not-available'));
    await display.getByTestId('wsf-display-recheck').click();
    await textContains(display.getByTestId('wsf-display-shared-total'), '137', 30_000);
    await snap(display, '05-fresh-session-recovered');

    await closeGoal(goalId);
    await champion.reload();
    await visible(champion.getByTestId(`wsf-community-goal-closed-${goalId}`));
    await visible(champion.getByTestId(`wsf-goal-display-auth-${goalId}`));
    await display.reload();
    await visible(display.getByTestId('wsf-display-closed'));
    await champion.getByTestId(`wsf-goal-display-auth-toggle-${goalId}`).click();
    await textContains(champion.getByTestId('wsf-goal-display-auth-confirmed-absent'), 'Public display has been removed');
    await display.reload();
    await visible(display.getByTestId('wsf-display-not-available'));
    await snap(display, '06-closed-goal-revoked');

    const anonymousChallenge = await callFunction('wsfChallengePulse', { challengeId: fx.challengeId });
    assert(isNotFound(anonymousChallenge), `Anonymous challenge pulse was not refused generically: ${anonymousChallenge.status}`);

    check('round-trip display authorization', 'PASS', 'default off, Champion authorize/revoke, Member control absent');
    check('display session lifecycle', 'PASS', 'revocation stopped active display; Check again required after reauthorization');
    check('closed-goal authorization lifecycle', 'PASS', 'fixture-seeded closure retained control and allowed later revocation');
    check('legacy challenge pulse boundary', 'PASS', 'anonymous request received generic not-found');
  } finally {
    await Promise.allSettled([championCtx.close(), memberCtx.close(), displayCtx.close()]);
  }
  return fx;
}

async function caseProtectedReads() {
  const fx = await seedFixture('protected', 1, false);
  const goalId = fx.goalIds[0];
  const memberToken = await signInToken(fx.member);
  const outsiderToken = await signInToken(fx.outsider);
  const attemptId = `attempt-${runTag}-protected`;

  trackDoc(`wsfContributions/${goalId}_${fx.member.uid}_${attemptId}`);
  trackDoc(`wsfGoalMemberTotals/${goalId}_${fx.member.uid}`);
  const first = await callFunction('wsfContribute', { goalId, attemptId, count: 29 }, memberToken);
  assert(first.ok, `Initial synthetic contribution failed: ${first.status}`);
  const firstData = callableData(first);
  assert(firstData?.ownCredit === 29 && firstData?.sharedTotal === 29, 'Initial contribution totals were not 29/29');

  const outsider = await callFunction('wsfMyContribution', { goalId }, outsiderToken);
  assert(isNotFound(outsider), `Unrelated authenticated user could distinguish goal: ${outsider.status}`);

  await setMembershipStatus(fx.groupId, fx.member.uid, 'removed');
  const ownHistory = await callFunction('wsfMyContribution', { goalId }, memberToken);
  assert(ownHistory.ok && callableData(ownHistory)?.ownCredit === 29, 'Former Member lost own contribution history');

  const replay = await callFunction('wsfContribute', { goalId, attemptId, count: 29 }, memberToken);
  const replayData = callableData(replay);
  assert(replay.ok && replayData?.alreadyRecorded === true && replayData?.ownCredit === 29, 'Former Member replay did not preserve own receipt');
  for (const field of ['sharedTotal', 'target', 'unit', 'status']) {
    assert(!(field in replayData), `Former Member replay leaked ${field}`);
  }

  check('protected own-credit read', 'PASS', 'unrelated signed-in user received generic not-found');
  check('former Member history and replay', 'PASS', 'own 29 retained; current shared state omitted');
  return fx;
}

async function caseUncertainAndPerGoal(browser) {
  const fx = await seedFixture('uncertain', 2, false);
  const [goalA, goalB] = fx.goalIds;
  const ctx = await browser.newContext();
  try {
    const champion = await ctx.newPage();
    await signInPage(champion, fx.champion);
    await champion.goto(`${BASE_URL}/community/${fx.groupId}`);
    const toggleA = champion.getByTestId(`wsf-goal-display-auth-toggle-${goalA}`);
    const toggleB = champion.getByTestId(`wsf-goal-display-auth-toggle-${goalB}`);
    const stateA = champion.getByTestId(`wsf-goal-display-auth-state-${goalA}`);
    const stateB = champion.getByTestId(`wsf-goal-display-auth-state-${goalB}`);
    const unsettledA = champion.getByTestId(`wsf-goal-display-auth-unsettled-${goalA}`);

    // Prove the page reached its settled initial state BEFORE any failure is
    // armed. Run 35248719827 armed the list-goals abort straight after
    // navigation and caught the page's own initial read: the toggles never
    // rendered and the case timed out on a click unrelated to the behaviour
    // under test.
    await visible(toggleA, 30_000);
    await visible(toggleB, 30_000);
    await textEquals(stateA, 'Public display is not authorized for this goal.');
    await textEquals(stateB, 'Public display is not authorized for this goal.');

    // Failure injection tied to the action under test. Only goal A's own
    // authorization write is aborted, and the reconciliation read the app
    // issues after a failed write is armed from inside that abort — so no
    // initial or background list read can ever be the thing that failed.
    const blocked = { writes: 0, reads: 0 };
    let blockWrite = true;
    let blockRead = false;
    await champion.route('**/wsfSetGoalDisplayAuthorization', async (route) => {
      const forGoalA = (route.request().postData() || '').includes(goalA);
      if (!blockWrite || !forGoalA) return route.continue();
      blocked.writes += 1;
      blockRead = true;
      return route.abort('failed');
    });
    await champion.route('**/wsfListGoals', async (route) => {
      if (!blockRead) return route.continue();
      blocked.reads += 1;
      return route.abort('failed');
    });

    await toggleA.click();
    await textContains(unsettledA, 'could not confirm', 30_000);
    await textContains(toggleA, 'Try again: authorize public display');
    assert(blocked.writes >= 1, 'The intended authorization write for goal A was never intercepted');
    assert(blocked.reads >= 1, 'The reconciliation read after the failed write was never intercepted');
    assert((await readAuthorization(goalA)) === false, 'Blocked write unexpectedly changed goal A');

    blockWrite = false;
    blockRead = false;
    await toggleB.click();
    await textContains(stateB, 'Public display is authorized for this goal.', 30_000);
    assert((await readAuthorization(goalB)) === true, 'Goal B authorization did not persist');
    await textContains(unsettledA, 'could not confirm');
    await textContains(toggleA, 'Try again: authorize public display');
    await textEquals(stateA, 'Public display is not authorized for this goal.');

    await toggleA.click();
    await textContains(stateA, 'Public display is authorized for this goal.', 30_000);
    assert((await readAuthorization(goalA)) === true, 'Goal A retry did not send its intended value');
    assert((await readAuthorization(goalB)) === true, 'Goal A retry changed goal B');
    await snap(champion, '07-per-goal-unresolved-state');

    check('uncertain-result honesty', 'PASS', 'lost write/read reported unconfirmed; retry retained intended value');
    check('per-goal outcome isolation', 'PASS', 'goal A warning survived goal B success; both stored values correct');
  } finally {
    await ctx.close();
  }
  return fx;
}

async function caseDelayedDisplayResponses(browser) {
  const fx = await seedFixture('race', 1, false);
  const goalId = fx.goalIds[0];
  const championCtx = await browser.newContext();
  const memberCtx = await browser.newContext();
  const displayCtx = await browser.newContext();
  try {
    const champion = await championCtx.newPage();
    const member = await memberCtx.newPage();
    const display = await displayCtx.newPage();
    await signInPage(champion, fx.champion);
    await champion.goto(`${BASE_URL}/community/${fx.groupId}`);
    const toggle = champion.getByTestId(`wsf-goal-display-auth-toggle-${goalId}`);
    const state = champion.getByTestId(`wsf-goal-display-auth-state-${goalId}`);
    await visible(toggle);
    await toggle.click();
    await textContains(state, 'Public display is authorized for this goal.');

    await signInPage(member, fx.member);
    const memberToken = await signInToken(fx.member);
    const attemptId = `attempt-${runTag}-race`;
    trackDoc(`wsfContributions/${goalId}_${fx.member.uid}_${attemptId}`);
    trackDoc(`wsfGoalMemberTotals/${goalId}_${fx.member.uid}`);
    const contribution = await callFunction('wsfContribute', { goalId, attemptId, count: 241 }, memberToken);
    const contributionData = callableData(contribution);
    assert(contribution.ok && contributionData?.ownCredit === 241 && contributionData?.sharedTotal === 241, 'Member contribution did not produce 241 personal/shared total');

    let phase = 'pass';
    let request1 = null;
    let held2 = null;
    await display.route('**/wsfGoalPulse', async (route) => {
      if (phase === 'capture1' && !request1) {
        request1 = route;
        phase = 'capture2';
        return;
      }
      if (phase === 'capture2' && !held2) {
        const response = await route.fetch();
        held2 = { route, status: response.status(), headers: response.headers(), body: await response.text() };
        phase = 'sealed';
        return;
      }
      if (phase === 'sealed') return route.abort('failed');
      return route.continue();
    });

    await display.goto(`${BASE_URL}/display/${goalId}`);
    await textContains(display.getByTestId('wsf-display-shared-total'), '241');
    phase = 'capture1';
    const deadline = Date.now() + 30_000;
    while (!held2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    assert(held2 && request1, 'Did not capture both in-flight display requests');
    assert(held2.status === 200 && held2.body.includes('241'), 'Held response was not the protected successful total');

    await toggle.click();
    await textEquals(state, 'Public display is not authorized for this goal.');
    await request1.continue();
    await visible(display.getByTestId('wsf-display-not-available'), 30_000);
    await held2.route.fulfill({ status: held2.status, headers: held2.headers, body: held2.body });
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    await visible(display.getByTestId('wsf-display-not-available'));
    assert((await display.getByText('241').count()) === 0, 'Held stale success repainted protected total');

    await toggle.click();
    await textContains(state, 'Public display is authorized for this goal.');
    await visible(display.getByTestId('wsf-display-not-available'));
    phase = 'pass';
    await display.getByTestId('wsf-display-recheck').click();
    await textContains(display.getByTestId('wsf-display-shared-total'), '241', 30_000);
    await snap(display, '08-stale-success-refused-fresh-session-recovered');

    check('stale-response admission control', 'PASS', 'older protected success could not repaint after refusal');
    check('explicit fresh-session recovery', 'PASS', 'reauthorization alone stayed blank; Check again recovered');
  } finally {
    await Promise.allSettled([championCtx.close(), memberCtx.close(), displayCtx.close()]);
  }
  return fx;
}

async function verifyHostedBuild() {
  const response = await fetch(`${BASE_URL}/health`, { redirect: 'follow' });
  const text = await response.text();
  assert(response.ok, `Hosted health returned ${response.status}`);
  assert(text.includes(EXPECTED_SHA.slice(0, 7)), `Hosted health did not identify ${EXPECTED_SHA.slice(0, 7)}`);
  check('correct staging build', 'PASS', `health marker ${EXPECTED_SHA.slice(0, 7)}`);
}

async function cleanupAll() {
  const errors = [];
  for (const goalId of synthetic.goals) {
    for (let shard = 0; shard < 10; shard += 1) trackDoc(`wsfGoalCounters/${goalId}/shards/${shard}`);
  }
  for (const challengeId of synthetic.challenges) {
    for (let shard = 0; shard < 10; shard += 1) trackDoc(`wsfChallengeCounters/${challengeId}/shards/${shard}`);
  }
  const ordered = [...cleanup.docs].sort((a, b) => b.split('/').length - a.split('/').length);
  for (const docPath of ordered) {
    try { await deleteDoc(docPath); } catch (error) { errors.push(`${docPath}: ${sanitize(error.message)}`); }
  }
  try { await deleteUsers(); } catch (error) { errors.push(`Auth users: ${sanitize(error.message)}`); }
  if (errors.length) throw new Error(`Cleanup failed for ${errors.length} item(s): ${errors.slice(0, 5).join('; ')}`);
}

let browser;
let mainError = null;
try {
  browser = await chromium.launch({ headless: true });
  await verifyHostedBuild();
  await caseRoundTrip(browser);
  await caseProtectedReads();
  await caseUncertainAndPerGoal(browser);
  await caseDelayedDisplayResponses(browser);
} catch (error) {
  mainError = error;
  diagnostics.push(sanitize(error?.stack || error?.message || error));
  check('hosted Package E suite', 'FAIL', sanitize(error?.message || error));
} finally {
  if (browser) await browser.close().catch(() => undefined);
  try {
    await cleanupAll();
    check('targeted synthetic cleanup', 'PASS', 'run-created documents and Auth users removed');
  } catch (error) {
    diagnostics.push(sanitize(error?.stack || error?.message || error));
    check('targeted synthetic cleanup', 'FAIL', sanitize(error?.message || error));
    if (!mainError) mainError = error;
  }
}

const failed = results.filter((item) => item.status !== 'PASS');
const receipt = {
  completedAt: new Date().toISOString(),
  project: PROJECT_ID,
  sourceSha: EXPECTED_SHA,
  stagingUrl: BASE_URL,
  runTag,
  results,
  failures: failed.length,
  synthetic: {
    groups: synthetic.groups,
    goals: synthetic.goals,
    challenges: synthetic.challenges,
    userCount: synthetic.users.length,
    credentialsRetained: false,
  },
  cleanupCompleted: results.some((item) => item.name === 'targeted synthetic cleanup' && item.status === 'PASS'),
  privilegedFixtureBoundary: 'OAuth REST only for run-scoped setup, direct stored-state checks, one seeded closure, and targeted cleanup. Member/Champion/public authorization assertions used real browser or callable identities.',
  limitations: [
    'This hosted harness does not treat local emulator evidence as hosted evidence.',
    'The close-goal transition is fixture-seeded because the product has no close-goal control.',
    'No private credentials, tokens, passwords, Web API keys, or email-action links are retained.',
  ],
  diagnostics,
};
fs.writeFileSync(path.join(RESULT_DIR, 'wsf-package-e-hosted-result.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
console.log(`RESULTS=${results.length}`);
console.log(`FAILURES=${failed.length}`);
console.log(`RUN_TAG=${runTag}`);
if (mainError || failed.length) process.exit(1);
