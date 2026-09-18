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
/**
 * Every browser context this suite opens.
 *
 * The product formats counts, percentages and goal windows with Intl and no
 * explicit locale, so the strings it renders are the RUNNER's locale. Pinning
 * en-US makes "137 of 5,000 squats" and "Ends today at 4:35 PM EDT" the same
 * strings on every runner; it pins nothing about time zone, which is the
 * goal's own and is asserted as such below.
 */
const CONTEXT_OPTIONS = { locale: 'en-US' };
// The owner's visual proof is taken at a realistic phone (the member's own
// surface) and at a wide screen (the authorized public display). Same locale
// pin; the viewport is the only difference from the assertion contexts.
const PHONE_CONTEXT = { ...CONTEXT_OPTIONS, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const WIDE_CONTEXT = { ...CONTEXT_OPTIONS, viewport: { width: 1280, height: 800 } };
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
    // A community join code is a credential: it admits its holder to a private
    // community. The D-5 case reads a community document with a real end-user
    // identity, so a failure there could otherwise carry the code into the
    // receipt. Both the Firestore REST shape and a bare string are redacted.
    .replace(/("joinCode"\s*:\s*)(\{[^{}]*\}|"[^"]*")/gi, '$1"[REDACTED_JOIN_CODE]"')
    .slice(0, 1000);
}
async function jsonRequest(url, { method = 'GET', oauth = false, bearer = null, body, allow = [] } = {}) {
  const headers = { 'content-type': 'application/json' };
  // `oauth` is the privileged fixture identity; `bearer` is a synthetic member's
  // own Firebase ID token, which is what makes a request subject to
  // firestore.rules. Conflating the two would let a rules assertion pass on
  // admin privilege, so one request is never both.
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
// The exact values the product writes — functions-westayfit/src/index.ts:57-59
// (MEMBERSHIP_ACTIVE / MEMBERSHIP_REMOVED / MEMBERSHIP_DEPARTED) and the
// statuses wsfRemoveMember and wsfLeaveCommunity store.
const MEMBERSHIP_ACTIVE = 'active';
const MEMBERSHIP_REMOVED = 'removed';
const MEMBERSHIP_DEPARTED = 'departed';

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
  // The fixture's own window instants and label travel with it. The display
  // renders the period in the GOAL's zone (America/New_York, seeded above),
  // so pinning that label needs the instants the harness actually wrote, and
  // the no-leak checks need the community display name it actually wrote.
  return {
    label,
    groupId,
    goalIds,
    challengeId,
    champion,
    member,
    outsider,
    communityDisplayName: `Package E ${label}`,
    startsAtIso: started.toISOString(),
    endsAtIso: ends.toISOString(),
  };
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

/**
 * The Champion's per-goal display controls are in the Manage sheet.
 *
 * Community Home carries one quiet "Manage" control; every
 * `wsf-goal-display-auth-*` element is inside the sheet it opens. Opening it
 * is the real interaction a Champion performs, so every Champion visit here
 * goes through it. Nothing about the assertions on those controls changes.
 */
async function openManage(page) {
  await visible(page.getByTestId('wsf-community-manage'));
  await page.getByTestId('wsf-community-manage').click();
  await visible(page.getByTestId('wsf-community-manage-panel'));
}

/**
 * The goal's published time zone, and the labels the display renders in it.
 *
 * seedFixture writes `timezone: 'America/New_York'` on every fixture goal, and
 * the display derives its window label in the GOAL's zone rather than the
 * reader's. The runner is UTC, so asserting the New York rendering exactly is
 * itself the proof that the zone came from the goal. These two functions are
 * faithful ports of the product's own rules (apps/westayfit/src/ui/dates.ts):
 * an open window reads "Open · Ends …", and the end is written as a clock time
 * when it falls on today's date IN THAT ZONE, otherwise as a weekday date.
 */
const GOAL_ZONE = 'America/New_York';
const LABEL_LOCALE = 'en-US';
function zoneYmd(date) {
  const parts = new Intl.DateTimeFormat(LABEL_LOCALE, {
    timeZone: GOAL_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
/** "Open · Ends today at 4:35 PM EDT" / "Open · Ends Sat, Sep 19". */
function expectedActiveWindowLabel(endsIso, now = new Date()) {
  const ends = new Date(endsIso);
  const ended = ends.getTime() < now.getTime();
  const verb = ended ? 'Ended' : 'Ends';
  const label =
    zoneYmd(ends) === zoneYmd(now)
      ? `${verb} today at ${new Intl.DateTimeFormat(LABEL_LOCALE, {
          timeZone: GOAL_ZONE,
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short',
        }).format(ends)}`
      : `${verb} ${new Intl.DateTimeFormat(LABEL_LOCALE, {
          timeZone: GOAL_ZONE,
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        }).format(ends)}`;
  return ended ? label : `Open · ${label}`;
}
/** "Sep 18 – 18" / "Sep 30 – Oct 1" — a closed goal's period, in the goal's zone. */
function expectedPeriodLabel(startIso, endIso, now = new Date()) {
  const a = new Date(startIso);
  const b = new Date(endIso);
  const [ay, am] = zoneYmd(a).split('-');
  const [by, bm] = zoneYmd(b).split('-');
  const [ny] = zoneYmd(now).split('-');
  const thisYear = ay === by && ay === ny;
  const md = new Intl.DateTimeFormat(LABEL_LOCALE, { timeZone: GOAL_ZONE, month: 'short', day: 'numeric' });
  const mdy = new Intl.DateTimeFormat(LABEL_LOCALE, { timeZone: GOAL_ZONE, month: 'short', day: 'numeric', year: 'numeric' });
  const dayOnly = new Intl.DateTimeFormat(LABEL_LOCALE, { timeZone: GOAL_ZONE, day: 'numeric' });
  if (!thisYear) return `${mdy.format(a)} \u2013 ${mdy.format(b)}`;
  if (am === bm) return `${md.format(a)} \u2013 ${dayOnly.format(b)}`;
  return `${md.format(a)} \u2013 ${md.format(b)}`;
}
/**
 * The expectation is RECOMPUTED on every poll, not captured once: the product
 * derives "today" from the clock at render time, so a value captured before
 * the poll began would be the stale side of a midnight boundary.
 */
async function textEqualsLive(locator, compute, describe, timeout = 20_000) {
  await pollText(locator, (text) => text.trim() === compute(), describe, timeout);
}

/**
 * A refused display must not name what it is refusing to show.
 *
 * The context fields (community name, goal title, period) are published only
 * to an authorized display; once the permission is gone the page must be the
 * same generic refusal an unknown goal id produces.
 */
async function assertNoContextLeak(page, fx, where) {
  assert(
    (await page.getByText(fx.communityDisplayName).count()) === 0,
    `Refused display leaked the community name (${where})`
  );
  assert(
    (await page.getByText(`Package E ${fx.label} goal 1`).count()) === 0,
    `Refused display leaked the goal title (${where})`
  );
}

async function caseRoundTrip(browser) {
  const fx = await seedFixture('roundtrip', 1, true);
  const goalId = fx.goalIds[0];
  const championCtx = await browser.newContext(CONTEXT_OPTIONS);
  const memberCtx = await browser.newContext(CONTEXT_OPTIONS);
  const displayCtx = await browser.newContext(CONTEXT_OPTIONS);
  try {
    const champion = await championCtx.newPage();
    const member = await memberCtx.newPage();
    const display = await displayCtx.newPage();
    await signInPage(champion, fx.champion);
    await signInPage(member, fx.member);

    await champion.goto(`${BASE_URL}/community/${fx.groupId}`);
    await openManage(champion);
    const control = champion.getByTestId(`wsf-goal-display-auth-${goalId}`);
    const toggle = champion.getByTestId(`wsf-goal-display-auth-toggle-${goalId}`);
    const state = champion.getByTestId(`wsf-goal-display-auth-state-${goalId}`);
    await visible(control);
    await textEquals(state, 'Public display is not authorized for this goal.');
    assert((await readAuthorization(goalId)) === false, 'Goal should default to display OFF');

    await display.goto(`${BASE_URL}/display/${goalId}`);
    await visible(display.getByTestId('wsf-display-not-available'));
    await assertNoContextLeak(display, fx, 'never authorized');
    await snap(display, '01-default-off-display-refused');

    await member.goto(`${BASE_URL}/community/${fx.groupId}`);
    await visible(member.getByTestId(`wsf-community-goal-link-${goalId}`));
    assert((await member.getByTestId(`wsf-goal-display-auth-${goalId}`).count()) === 0, 'Member unexpectedly has display authorization control');
    // The controls moved into the Champion-only Manage sheet, so the absence
    // of that surface is now part of the same boundary.
    assert((await member.getByTestId('wsf-community-manage').count()) === 0, 'Member unexpectedly has the Champion Manage surface');

    await toggle.click();
    await textContains(state, 'Public display is authorized for this goal.');
    assert((await readAuthorization(goalId)) === true, 'Champion authorization did not persist');
    await display.getByTestId('wsf-display-recheck').click();
    await visible(display.getByTestId('wsf-display-screen'), 30_000);
    assert((await display.getByTestId('wsf-display-shared-total').count()) === 1, 'Authorized display omitted shared total');
    assert((await display.getByText(fx.member.uid).count()) === 0, 'Display leaked member UID');
    assert((await display.getByText(fx.champion.uid).count()) === 0, 'Display leaked Champion UID');
    // An authorized display names what it is showing — and only that. The
    // context is the approved set, so it is asserted exactly.
    await textEquals(display.getByTestId('wsf-display-community'), fx.communityDisplayName);
    await textEquals(display.getByTestId('wsf-display-goal-title'), `Package E ${fx.label} goal 1`);
    // The window, in the GOAL's zone rather than this runner's.
    await textEqualsLive(
      display.getByTestId('wsf-display-period'),
      () => expectedActiveWindowLabel(fx.endsAtIso),
      `Expected the open window label in ${GOAL_ZONE}`,
      30_000
    );
    const publicPulse = await callFunction('wsfGoalPulse', { goalId });
    const publicPulseData = callableData(publicPulse);
    assert(publicPulse.ok && publicPulseData && !('contributorCount' in publicPulseData), 'Public goal pulse exposed contributorCount');
    // THE APPROVED PUBLIC CONTRACT, PINNED EXACTLY (owner decision 2026-09-18).
    // Four aggregate fields and five context fields, and nothing else: an
    // added key is a disclosure nobody approved, so the assertion is on the
    // whole key set rather than on a list of things that must be absent.
    const APPROVED_PULSE_KEYS = [
      'communityDisplayName',
      'endsAt',
      'goalTitle',
      'sharedTotal',
      'startsAt',
      'status',
      'target',
      'timezone',
      'unit',
    ];
    const pulseKeys = Object.keys(publicPulseData).sort();
    assert(
      JSON.stringify(pulseKeys) === JSON.stringify(APPROVED_PULSE_KEYS),
      `Public goal pulse shape drifted: ${pulseKeys.join(',')}`
    );
    assert(publicPulseData.communityDisplayName === fx.communityDisplayName, 'Public pulse community name mismatch');
    assert(publicPulseData.goalTitle === `Package E ${fx.label} goal 1`, 'Public pulse goal title mismatch');
    assert(publicPulseData.timezone === GOAL_ZONE, 'Public pulse did not publish the goal\u2019s stored zone');
    // Named individually as well, so a regression reads as the specific thing
    // that leaked rather than only as a shape mismatch.
    for (const field of ['joinCode', 'joinPolicy', 'groupType', 'createdByUserId', 'memberCount', 'contributorCount']) {
      assert(!(field in publicPulseData), `Public pulse leaked ${field}`);
    }
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
    await textEquals(member.getByTestId('wsf-contribute-own-credit'), 'Your total on this goal: 137 squats');
    // The shared line carries the target it is measured against; the fixture
    // target is 5,000 and counts are thousands-grouped.
    await textEquals(member.getByTestId('wsf-contribute-shared-total'), '137 of 5,000 squats');

    await toggle.click();
    await textEquals(state, 'Public display is not authorized for this goal.');
    await visible(display.getByTestId('wsf-display-not-available'), 30_000);
    await assertNoContextLeak(display, fx, 'after revocation stopped a running display');
    await visible(member.getByTestId('wsf-contribute-screen'));
    await snap(display, '04-running-display-stopped');

    await toggle.click();
    await textContains(state, 'Public display is authorized for this goal.');
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    await visible(display.getByTestId('wsf-display-not-available'));
    await assertNoContextLeak(display, fx, 'reauthorized session before Check again');
    await display.getByTestId('wsf-display-recheck').click();
    await textContains(display.getByTestId('wsf-display-shared-total'), '137', 30_000);
    await snap(display, '05-fresh-session-recovered');

    await closeGoal(goalId);
    await champion.reload();
    await openManage(champion);
    await visible(champion.getByTestId(`wsf-community-goal-closed-${goalId}`));
    await visible(champion.getByTestId(`wsf-goal-display-auth-${goalId}`));
    await display.reload();
    await visible(display.getByTestId('wsf-display-closed'));
    // A closed goal states its whole window rather than an end, still in the
    // goal's zone.
    await textEqualsLive(
      display.getByTestId('wsf-display-period'),
      () => expectedPeriodLabel(fx.startsAtIso, fx.endsAtIso),
      `Expected the closed window label in ${GOAL_ZONE}`,
      30_000
    );
    await champion.getByTestId(`wsf-goal-display-auth-toggle-${goalId}`).click();
    await textContains(champion.getByTestId('wsf-goal-display-auth-confirmed-absent'), 'Public display has been removed');
    await display.reload();
    await visible(display.getByTestId('wsf-display-not-available'));
    await assertNoContextLeak(display, fx, 'revoked on a closed goal');
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
  const ctx = await browser.newContext(CONTEXT_OPTIONS);
  try {
    const champion = await ctx.newPage();
    await signInPage(champion, fx.champion);
    await champion.goto(`${BASE_URL}/community/${fx.groupId}`);
    await openManage(champion);
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
  const championCtx = await browser.newContext(CONTEXT_OPTIONS);
  const memberCtx = await browser.newContext(CONTEXT_OPTIONS);
  const displayCtx = await browser.newContext(CONTEXT_OPTIONS);
  try {
    const champion = await championCtx.newPage();
    const member = await memberCtx.newPage();
    const display = await displayCtx.newPage();
    await signInPage(champion, fx.champion);
    await champion.goto(`${BASE_URL}/community/${fx.groupId}`);
    await openManage(champion);
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
    await assertNoContextLeak(display, fx, 'refusal reached the display first');
    await held2.route.fulfill({ status: held2.status, headers: held2.headers, body: held2.body });
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    await visible(display.getByTestId('wsf-display-not-available'));
    assert((await display.getByText('241').count()) === 0, 'Held stale success repainted protected total');
    // The held success carried the context fields too, so "not repainted"
    // has to cover the name as well as the number.
    await assertNoContextLeak(display, fx, 'held stale success released after refusal');

    await toggle.click();
    await textContains(state, 'Public display is authorized for this goal.');
    await visible(display.getByTestId('wsf-display-not-available'));
    await assertNoContextLeak(display, fx, 'reauthorized session before Check again');
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

/**
 * One community-document read, made as the synthetic member themself.
 *
 * Every other read in this suite goes through a callable (which enforces its
 * own membership checks) or through the privileged fixture identity (which
 * bypasses rules entirely). Neither exercises firestore.rules. This one is a
 * DIRECT client read carrying a Firebase ID token, which is the only way the
 * deployed ruleset is the thing under test.
 */
async function clientReadGroup(idToken, groupId) {
  return jsonRequest(firestoreUrl(`wsfCommunityGroups/${groupId}`), {
    bearer: idToken,
    // 401 is allowed only so an ID token the API would not accept fails as
    // that, with a message saying so, rather than as a rules verdict.
    allow: [401, 403, 404],
  });
}

/**
 * D-5 — membership STATUS, not membership existence, is what admits a reader.
 *
 * A membership row survives removal and departure with its status changed, so
 * a ruleset that checks only for the row's existence keeps a removed member
 * reading the community document — including its join code, which would let
 * them re-enter a community they were removed from. The rule under test is
 * wsfIsGroupMember in firestore.rules, which requires membershipStatus ==
 * 'active'.
 *
 * THE JOIN CODE IS NEVER READ. The 200 case asserts the field is PRESENT and
 * stops there: the value is not bound to a variable, not compared, not logged,
 * not screenshotted, and sanitize() redacts it from any diagnostic that might
 * otherwise carry it. Nothing here is restored — the whole fixture is deleted
 * by the run's own cleanup, which already owns every document putDoc touched.
 */
async function caseD5MembershipStatusRules() {
  const fx = await seedFixture('d5', 1, false);
  const memberToken = await signInToken(fx.member);
  const outsiderToken = await signInToken(fx.outsider);

  const asActive = await clientReadGroup(memberToken, fx.groupId);
  assert(asActive.status !== 401, 'Firestore REST did not accept the synthetic member ID token (401), so no rules verdict was obtained');
  assert(asActive.status === 200, `An ${MEMBERSHIP_ACTIVE} member could not read their own community document: HTTP ${asActive.status}`);
  assert(
    typeof asActive.body?.name === 'string' && asActive.body.name.endsWith(`/wsfCommunityGroups/${fx.groupId}`),
    'The client read did not return the community document it asked for'
  );
  assert(asActive.body?.fields?.joinCode !== undefined, 'The community document served to an active member is missing its join code field');

  // The two ways a membership ends. Both keep the row and change the status,
  // which is exactly the case an existence-only rule gets wrong.
  for (const status of [MEMBERSHIP_REMOVED, MEMBERSHIP_DEPARTED]) {
    await setMembershipStatus(fx.groupId, fx.member.uid, status);
    const after = await clientReadGroup(memberToken, fx.groupId);
    assert(
      after.status !== 200,
      `staging ruleset is not status-aware (D-5 rules not deployed to ${PROJECT_ID}): a '${status}' membership still read wsfCommunityGroups`
    );
    assert(
      after.status === 403 && after.body?.error?.status === 'PERMISSION_DENIED',
      `A '${status}' membership was refused with HTTP ${after.status} rather than 403 PERMISSION_DENIED`
    );
  }

  // No membership row at all — the same refusal, from the other direction.
  const asOutsider = await clientReadGroup(outsiderToken, fx.groupId);
  assert(
    asOutsider.status === 403 && asOutsider.body?.error?.status === 'PERMISSION_DENIED',
    `An unrelated signed-in account was not refused with 403 PERMISSION_DENIED: HTTP ${asOutsider.status}`
  );

  check('membership status rules (D-5)', 'PASS', `active member read allowed; '${MEMBERSHIP_REMOVED}', '${MEMBERSHIP_DEPARTED}' and an unrelated account each refused PERMISSION_DENIED`);
  return fx;
}

/**
 * D-1 — a brand-new account is held at the verification gate.
 *
 * The signup screen does not navigate on success; the auth listener moves the
 * member to /verify-email the moment the account exists, and the best-effort
 * verification send happens AFTER that. The property is that the gate holds:
 * a slow or failing send must not bounce the new member back to the form they
 * just completed, which is what a navigation tied to the send would do.
 *
 * NO MAIL LEAVES STAGING. wsfSendVerificationEmail is blocked in the browser,
 * so the request never reaches the function and nothing is delivered to the
 * synthetic address. That also makes the send's failure the exact condition
 * the gate has to survive.
 */
async function caseD1SignupGate(browser) {
  const ctx = await browser.newContext(CONTEXT_OPTIONS);
  try {
    const page = await ctx.newPage();
    let sendAttempts = 0;
    await page.route('**/wsfSendVerificationEmail', async (route) => {
      sendAttempts += 1;
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { status: 'UNAVAILABLE', message: 'Blocked by the hosted smoke: staging sends no verification mail.' },
        }),
      });
    });

    // The address is minted in the same wsf-<runTag>-…@example.com shape
    // createVerifiedUser uses, because cleanup-synthetic.mjs re-derives an Auth
    // account's provenance from its address before it will delete it. An
    // address the UI chose could not be cleaned up.
    const suffix = `${runTag}-d1signup-${crypto.randomBytes(2).toString('hex')}`;
    const email = `wsf-${suffix}@example.com`;
    const password = `Wsf!${crypto.randomBytes(18).toString('base64url')}`;

    await page.goto(`${BASE_URL}/signup`, { waitUntil: 'domcontentloaded' });
    await visible(page.getByTestId('wsf-signup'));
    await page.getByTestId('wsf-signup-displayName').fill('WSF d1 signup');
    await page.getByTestId('wsf-signup-email').fill(email);
    await page.getByTestId('wsf-signup-password').fill(password);
    await page.getByTestId('wsf-signup-submit').click();

    try {
      await visible(page.getByTestId('wsf-verify'), 30_000);
      // The gate has to HOLD, not merely appear: a single read here would pass
      // against a screen that flips back to the form on the next tick.
      await staysAbsent(page.getByTestId('wsf-signup'), 6_000);
      await visible(page.getByTestId('wsf-verify'), 5_000);
      assert(page.url().includes('/verify-email'), 'The verification gate did not hold the route');
      assert(sendAttempts >= 1, 'The signup screen never attempted the verification send, so the gate was not tested against a failing send');
    } finally {
      // Own the account whichever way the assertions went: a failed assertion
      // must not leave a synthetic Auth user behind. The uid is not knowable
      // in advance because the browser created the account.
      const lookup = await jsonRequest(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:lookup`, {
        method: 'POST',
        oauth: true,
        body: { email: [email] },
        allow: [400],
      });
      const uid = lookup.body?.users?.[0]?.localId;
      if (typeof uid === 'string' && uid.length > 0) {
        trackUser(uid);
        synthetic.users.push(uid);
      }
    }

    check('signup verification gate (D-1)', 'PASS', 'gate held 6s with no return to the signup form; verification send blocked in the browser');
  } finally {
    await ctx.close();
  }
}

/**
 * Visual proof — what the product looks like on staging, on a phone, with a
 * labelled synthetic fixture. Every capture is of a state the suite has
 * already asserted elsewhere; this case asserts only what makes each capture
 * honest (the screen it claims to show is the screen on it, the contribution
 * it shows was recorded, the display shows the recorded total), and it owns
 * the contribution it makes so cleanup removes it.
 */
async function caseVisualProof(browser) {
  const fx = await seedFixture('visual', 1, false);
  const goalId = fx.goalIds[0];
  const championCtx = await browser.newContext(PHONE_CONTEXT);
  const memberCtx = await browser.newContext(PHONE_CONTEXT);
  const displayPhoneCtx = await browser.newContext(PHONE_CONTEXT);
  const displayWideCtx = await browser.newContext(WIDE_CONTEXT);
  try {
    // The Champion authorizes the display through the product, on a phone.
    const champion = await championCtx.newPage();
    await signInPage(champion, fx.champion);
    await champion.goto(`${BASE_URL}/community/${fx.groupId}`);
    await openManage(champion);
    const toggle = champion.getByTestId(`wsf-goal-display-auth-toggle-${goalId}`);
    const state = champion.getByTestId(`wsf-goal-display-auth-state-${goalId}`);
    await visible(toggle, 30_000);
    await textEquals(state, 'Public display is not authorized for this goal.');
    await toggle.click();
    await textContains(state, 'Public display is authorized for this goal.', 30_000);
    assert((await readAuthorization(goalId)) === true, 'Visual fixture authorization did not persist');
    await snap(champion, '10-phone-champion-manage-authorized');

    // A member's Community Home and one whole contribution, on a phone.
    const member = await memberCtx.newPage();
    // The attempt id is minted in the browser; read it off the request so the
    // contribution and the member total are owned by cleanup like every other
    // synthetic write.
    let attemptId = null;
    await member.route('**/wsfContribute', async (route) => {
      try {
        const body = JSON.parse(route.request().postData() || '{}');
        if (typeof body?.data?.attemptId === 'string') attemptId = body.data.attemptId;
      } catch {
        // Not JSON — the callable will refuse it; the assertions below fail honestly.
      }
      return route.continue();
    });
    await signInPage(member, fx.member);
    await member.goto(`${BASE_URL}/community/${fx.groupId}`);
    await visible(member.getByTestId(`wsf-community-goal-link-${goalId}`), 30_000);
    assert((await member.getByTestId('wsf-community-manage').count()) === 0, 'Member unexpectedly has the Champion Manage surface');
    await snap(member, '11-phone-community-home');

    await member.goto(`${BASE_URL}/contribute/${goalId}`);
    await visible(member.getByTestId('wsf-contribute-entry-screen'), 30_000);
    await member.getByTestId('wsf-contribute-entry').fill('25');
    await snap(member, '12-phone-contribution-entry');
    await member.getByTestId('wsf-contribute-review').click();
    await visible(member.getByTestId('wsf-contribute-review-screen'));
    await snap(member, '13-phone-contribution-review');
    await member.getByTestId('wsf-contribute-submit').click();
    await visible(member.getByTestId('wsf-contribute-receipt'), 30_000);
    await textEquals(member.getByTestId('wsf-contribute-shared-total'), '25 of 5,000 squats', 30_000);
    await textEquals(member.getByTestId('wsf-contribute-own-credit'), 'Your total on this goal: 25 squats');
    assert(typeof attemptId === 'string' && attemptId.length > 0, 'The browser contribution never sent an attempt id');
    trackDoc(`wsfContributions/${goalId}_${fx.member.uid}_${attemptId}`);
    trackDoc(`wsfGoalMemberTotals/${goalId}_${fx.member.uid}`);
    await snap(member, '14-phone-contribution-confirmed');

    // The authorized public display, anonymous, phone then wide, showing the
    // total the member just recorded and none of the member.
    const displayPhone = await displayPhoneCtx.newPage();
    await displayPhone.goto(`${BASE_URL}/display/${goalId}`);
    await visible(displayPhone.getByTestId('wsf-display-screen'), 30_000);
    await textEquals(displayPhone.getByTestId('wsf-display-shared-total'), '25', 30_000);
    assert((await displayPhone.getByText(fx.member.uid).count()) === 0, 'Phone display leaked member UID');
    await snap(displayPhone, '15-phone-public-display');

    const displayWide = await displayWideCtx.newPage();
    await displayWide.goto(`${BASE_URL}/display/${goalId}`);
    await visible(displayWide.getByTestId('wsf-display-screen'), 30_000);
    await textEquals(displayWide.getByTestId('wsf-display-shared-total'), '25', 30_000);
    assert((await displayWide.getByText(fx.member.uid).count()) === 0, 'Wide display leaked member UID');
    await snap(displayWide, '16-wide-authorized-display');

    check('visual proof captures', 'PASS', 'phone: Champion Manage, Community Home, entry, review, confirmed; phone and wide authorized display — labelled synthetic fixture, contribution owned by cleanup');
  } finally {
    await Promise.all([championCtx, memberCtx, displayPhoneCtx, displayWideCtx].map((ctx) => ctx.close().catch(() => undefined)));
  }
  return fx;
}

/**
 * A case whose verdict depends on state this workflow does not deploy is
 * recorded on its own row and never stops the cases after it. D-5 is the one
 * such case: it asserts the RULESET staging is running, and the workflow
 * deploys functions and Hosting only. Run 35358182490 showed the cost of
 * letting it abort the suite — the D-1 gate check never ran.
 */
async function isolated(name, run) {
  try {
    return await run();
  } catch (error) {
    diagnostics.push(sanitize(error?.stack || error?.message || error));
    check(name, 'FAIL', sanitize(error?.message || error));
    return null;
  }
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
  await isolated('membership status rules (D-5)', () => caseD5MembershipStatusRules());
  await caseD1SignupGate(browser);
  await caseVisualProof(browser);
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
    'The D-5 case reads one community document with a synthetic member ID token so firestore.rules is the thing under test; the join code is asserted present and is never read, logged, screenshotted or retained.',
    'The D-1 case blocks wsfSendVerificationEmail in the browser, so staging sends no verification mail; the account it creates is tracked for cleanup by its run-tagged synthetic address.',
    'The D-5 case is isolated: its failure is its own row and the cases after it still run, because the ruleset it asserts is not deployed by this workflow.',
    'The visual-proof captures show a run-tagged synthetic community, goal and members only; the one contribution they record is removed by cleanup.',
  ],
  diagnostics,
};
fs.writeFileSync(path.join(RESULT_DIR, 'wsf-package-e-hosted-result.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
console.log(`RESULTS=${results.length}`);
console.log(`FAILURES=${failed.length}`);
console.log(`RUN_TAG=${runTag}`);
if (mainError || failed.length) process.exit(1);
