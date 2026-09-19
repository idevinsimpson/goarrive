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
function trackUser(uid) {
  cleanup.users.add(uid);
  persistCleanup();
}
function trackDoc(docPath) {
  cleanup.docs.add(docPath);
  persistCleanup();
}
/**
 * A document the SERVER named, which therefore cannot carry the run tag.
 *
 * Firestore auto-ids and the lineIds derived from them (`setup__{setupId}`)
 * are unpredictable, so cleanup's tag-in-path rule can never admit them — and
 * under that rule ONE such path made the whole manifest unusable and the run
 * deleted nothing at all. `via` is an identifier this run has already proven
 * is its own: a run-tagged id, or an Auth uid whose synthetic email cleanup
 * checks. Cleanup admits the path only if that identifier is in the path or
 * in the stored document, so this is a narrower claim than a tagged path, not
 * a broader one.
 */
function trackLinked(docPath, via) {
  cleanup.linked.set(docPath, via);
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
    // The same credential as the tail of a join link — the string the W8 QR
    // encodes (data-qr-url) and a mismatch there would otherwise print.
    .replace(/\/join\/[A-Za-z0-9_-]+/g, '/join/[REDACTED_JOIN_CODE]')
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

async function seedFixture(label, goals = 1, includeChallenge = false, { joinPolicy = 'private' } = {}) {
  const champion = await createVerifiedUser(`${label}-champion`);
  const member = await createVerifiedUser(`${label}-member`);
  const outsider = await createVerifiedUser(`${label}-outsider`);
  const stamp = `${runTag}-${label}`;
  const groupId = `e5grp-${stamp}`.slice(0, 120);
  const now = new Date();
  const started = new Date(now.getTime() - 60_000);
  const ends = new Date(now.getTime() + 3_600_000);

  // private by default: a fixture nobody can walk into by link. A row that
  // needs the product's link-joinable surfaces (W8's QR) opts into
  // 'inviteOnly'. The product mints a join code for every policy, private
  // included (src/ui/joinLink.ts), and the server admits by code only when it
  // has the shape normalizeJoinCode accepts — 16–128 base64url characters
  // (functions-westayfit/src/index.ts). 16 random bytes encode to 22, so the
  // code seeded here is one the product would actually honour, not a stub.
  const community = {
    displayName: `Package E ${label}`,
    groupType: 'custom',
    joinPolicy,
    joinCode: crypto.randomBytes(16).toString('base64url'),
    createdByUserId: champion.uid,
    lifecycleStatus: 'active',
    isSample: false,
    createdAt: now,
    updatedAt: now,
  };
  await putDoc(`wsfCommunityGroups/${groupId}`, community);
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
    // On the fixture, never in a diagnostic: sanitize() redacts it, and the
    // only reader is the W8 assertion of WHICH link the QR encodes.
    joinCode: community.joinCode,
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

// ---- Candidate B workstreams (2026-09-18, owner-authorized hosted checks) ----
// Each case below mirrors a green local spec and runs on its OWN isolated row:
// a harness mistake here must never hide a Package E, D-5 or D-1 verdict.
// Every synthetic write they cause is tracked for cleanup.

async function authorizeDisplay(fx, goalId) {
  const token = await signInToken(fx.champion);
  const r = await callFunction('wsfSetGoalDisplayAuthorization', { goalId, authorized: true }, token);
  assert(r.ok, `Fixture authorization via the product callable failed: HTTP ${r.status}`);
  assert((await readAuthorization(goalId)) === true, 'Fixture authorization did not persist');
}
function trackContribution(goalId, uid, attemptId) {
  trackDoc(`wsfContributions/${goalId}_${uid}_${attemptId}`);
  trackDoc(`wsfGoalMemberTotals/${goalId}_${uid}`);
  trackDoc(`wsfGoals/${goalId}/recentAdditions/${attemptId}`);
}
async function contributeAs(fx, user, goalId, attemptId, count) {
  trackContribution(goalId, user.uid, attemptId);
  const token = await signInToken(user);
  return callFunction('wsfContribute', { goalId, attemptId, count }, token);
}
/** Firebase Auth's persisted records (IndexedDB), the same read the local kiosk spec makes. */
async function readAuthRecords(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('firebaseLocalStorageDb');
    req.onerror = () => resolve([]);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('firebaseLocalStorage')) { db.close(); resolve([]); return; }
      const all = db.transaction('firebaseLocalStorage', 'readonly').objectStore('firebaseLocalStorage').getAllKeys();
      all.onsuccess = () => { db.close(); resolve(all.result.map(String)); };
      all.onerror = () => { db.close(); resolve([]); };
    };
  }));
}

// W2 — recent public additions: amount + minute only, gated exactly like the
// pulse, and the ONE new callable's hosted transport (the reason run 3 failed).
async function caseW2RecentAdditions() {
  const fx = await seedFixture('w2', 2, false);
  const [authorized, unauthorized] = fx.goalIds;
  await authorizeDisplay(fx, authorized);
  const attemptId = `attempt-${runTag}-w2`;
  const first = await contributeAs(fx, fx.member, authorized, attemptId, 12);
  assert(first.ok, `W2 fixture contribution failed: HTTP ${first.status}`);

  const anon = await callFunction('wsfGoalRecentAdditions', { goalId: authorized });
  assert(anon.status !== 403 && anon.status !== 401, `wsfGoalRecentAdditions is not publicly invokable on staging: HTTP ${anon.status} (transport)`);
  assert(anon.ok, `wsfGoalRecentAdditions failed: HTTP ${anon.status} ${sanitize(JSON.stringify(anon.body).slice(0, 200))}`);
  const data = callableData(anon);
  assert(Object.keys(data || {}).join(',') === 'additions', `Recent additions carried keys other than 'additions': ${Object.keys(data || {}).join(',')}`);
  assert(Array.isArray(data.additions) && data.additions.length >= 1, 'The recorded contribution is missing from the recent tail');
  const entry = data.additions[0];
  assert(Object.keys(entry).sort().join(',') === 'amount,at,unit', `An addition carried unapproved keys: ${Object.keys(entry).sort().join(',')}`);
  assert(entry.amount === 12 && entry.unit === 'squats' && typeof entry.at === 'string', 'The addition does not describe the contribution');
  const json = JSON.stringify(data);
  assert(!json.includes(fx.member.uid) && !json.includes(fx.champion.uid) && !json.includes(attemptId), 'Recent additions leaked an identity or attempt id');

  const refused = await callFunction('wsfGoalRecentAdditions', { goalId: unauthorized });
  assert(isNotFound(refused), `An unauthorized goal's recent additions were not refused generically: HTTP ${refused.status}`);
  check('recent public additions (W2)', 'PASS', 'new callable publicly reachable; amount/unit/minute only; unauthorized goal refused generically');
  return fx;
}

// W3 — repeat policy is enforced by the server: 'once' refuses a second
// attempt but keeps the first's replay; an absent policy stays 'multiple'.
async function caseW3RepeatPolicy() {
  const fx = await seedFixture('w3', 2, false);
  const [onceGoal, legacyGoal] = fx.goalIds;
  await putDoc(`wsfGoals/${onceGoal}`, { repeatPolicy: 'once', updatedAt: new Date() }, ['repeatPolicy', 'updatedAt']);

  const a1 = await contributeAs(fx, fx.member, onceGoal, `attempt-${runTag}-w3-a1`, 5);
  assert(a1.ok && callableData(a1)?.ownCredit === 5, `First 'once' contribution failed: HTTP ${a1.status}`);
  const a2 = await contributeAs(fx, fx.member, onceGoal, `attempt-${runTag}-w3-a2`, 5);
  assert(!a2.ok && a2.body?.error?.status === 'FAILED_PRECONDITION', `A second contribution to a 'once' goal was not refused with FAILED_PRECONDITION: HTTP ${a2.status}`);
  const replay = await contributeAs(fx, fx.member, onceGoal, `attempt-${runTag}-w3-a1`, 5);
  assert(replay.ok && callableData(replay)?.alreadyRecorded === true && callableData(replay)?.ownCredit === 5, 'Replaying the recorded attempt lost its receipt');

  const l1 = await contributeAs(fx, fx.member, legacyGoal, `attempt-${runTag}-w3-l1`, 3);
  const l2 = await contributeAs(fx, fx.member, legacyGoal, `attempt-${runTag}-w3-l2`, 4);
  assert(l1.ok && l2.ok && callableData(l2)?.ownCredit === 7, 'A goal without a stored policy did not keep accepting contributions (absent must mean multiple)');
  check('repeat policy (W3)', 'PASS', "'once' refused the second attempt (FAILED_PRECONDITION) and kept the first's replay; absent policy accepted both");
  return fx;
}

// W5 — the crossing is a one-time goal-level event and NO attempt is credited.
async function caseW5ReachedState() {
  const fx = await seedFixture('w5', 1, false);
  const goalId = fx.goalIds[0];
  await putDoc(`wsfGoals/${goalId}`, { crossingTracked: true, updatedAt: new Date() }, ['crossingTracked', 'updatedAt']);
  const r = await contributeAs(fx, fx.member, goalId, `attempt-${runTag}-w5`, 5000);
  assert(r.ok && callableData(r)?.sharedTotal === 5000, `Crossing contribution failed: HTTP ${r.status}`);
  assert(callableData(r)?.crossedTarget !== true, 'A member was told their attempt crossed the line');
  const goal = (await getDoc(`wsfGoals/${goalId}`)).body?.fields || {};
  assert(typeof goal.reachedAt?.timestampValue === 'string', 'The goal did not record reachedAt');
  assert(goal.reachedSharedTotal?.integerValue === '5000', `reachedSharedTotal is not 5000: ${JSON.stringify(goal.reachedSharedTotal)}`);
  assert(goal.reachedAttemptId && 'nullValue' in goal.reachedAttemptId, 'reachedAttemptId was credited to an attempt');
  const listed = await callFunction('wsfListGoals', { groupId: fx.groupId }, await signInToken(fx.member));
  const row = (callableData(listed)?.goals || []).find((g) => g.goalId === goalId);
  assert(row && typeof row.reachedAt === 'string', 'wsfListGoals does not carry the reached state to members');
  check('target-crossing event (W5)', 'PASS', 'one goal-level reachedAt/reachedSharedTotal recorded; reachedAttemptId null; crossedTarget never true; listed to members');
  return fx;
}

// W6 — durable history: closed goals return to active members on request only.
async function caseW6History() {
  const fx = await seedFixture('w6', 2, false);
  const [activeGoal, closedGoal] = fx.goalIds;
  await closeGoal(closedGoal);
  const memberToken = await signInToken(fx.member);
  const plain = callableData(await callFunction('wsfListGoals', { groupId: fx.groupId }, memberToken))?.goals || [];
  assert(plain.some((g) => g.goalId === activeGoal) && !plain.some((g) => g.goalId === closedGoal), 'The plain list changed shape (closed goal present or active goal missing)');
  const history = callableData(await callFunction('wsfListGoals', { groupId: fx.groupId, includeHistory: true }, memberToken))?.goals || [];
  const closedRow = history.find((g) => g.goalId === closedGoal);
  assert(closedRow && closedRow.status === 'closed', 'includeHistory did not return the closed goal');
  const outsider = await callFunction('wsfListGoals', { groupId: fx.groupId, includeHistory: true }, await signInToken(fx.outsider));
  assert(isNotFound(outsider), `An unrelated account could read history: HTTP ${outsider.status}`);
  const pulse = await callFunction('wsfGoalPulse', { goalId: closedGoal });
  assert(isNotFound(pulse), 'A closed, never-authorized goal answered a public pulse');
  check('durable history (W6)', 'PASS', 'closed goal absent from the plain list, present with includeHistory for an active member, refused to an outsider; public pulse untouched');
  return fx;
}

// W4 / W7 / W8 / W9 — member-facing flows, on a phone, mirroring the local specs.
async function caseW4W7W8Browser(browser) {
  // TWO open goals: the product's momentum line exists only across two or more
  // open goals (src/communityMomentum.ts: fewer than two -> no line at all).
  // Run 5 seeded one goal and waited for a line the product correctly never
  // renders — a fixture error in this harness, not a product defect.
  // inviteOnly, not the private default: the product draws the join QR only
  // under a link-joinable policy (src/ui/joinLink.ts LINK_JOINABLE_POLICIES =
  // public | inviteOnly) and renders wsf-community-qr-unavailable for a
  // private community — which is what run 6 waited on. Same class of fixture
  // error as the one-goal momentum: the product was right both times.
  const fx = await seedFixture('w478', 2, false, { joinPolicy: 'inviteOnly' });
  const [goalId, secondGoal] = fx.goalIds;
  await authorizeDisplay(fx, goalId);
  await authorizeDisplay(fx, secondGoal);
  await putDoc(`wsfGoals/${goalId}`, { activityGuideKey: 'squats', updatedAt: new Date() }, ['activityGuideKey', 'updatedAt']);
  const memberCtx = await browser.newContext(PHONE_CONTEXT);
  const championCtx = await browser.newContext(PHONE_CONTEXT);
  try {
    const member = await memberCtx.newPage();
    await signInPage(member, fx.member);
    await member.goto(`${BASE_URL}/community/${fx.groupId}`);
    await visible(member.getByTestId(`wsf-community-goal-link-${goalId}`), 30_000);
    // W7: honest momentum roll-up across the two open goals (both confirmed by
    // their pulses on a cold staging load, so allow 30 s), and the share
    // control for the featured authorized goal; no QR for a member.
    await visible(member.getByTestId('wsf-community-momentum'), 30_000);
    const momentum = await member.getByTestId('wsf-community-momentum').innerText();
    assert(/^\d+ of 2 open goals reached together\.$/.test(momentum.trim()), `Momentum line is not the two-goal roll-up: ${sanitize(momentum)}`);
    assert(!momentum.includes(fx.member.uid) && !momentum.includes(fx.champion.uid), 'Momentum copy leaked a uid');
    await visible(member.locator('[data-testid^="wsf-community-goal-share-"]').first());
    assert((await member.getByTestId('wsf-community-qr-section').count()) === 0, 'A member can see the Champion join QR section');
    assert((await member.getByTestId('wsf-community-manage').count()) === 0, 'A member has the Manage surface');
    await snap(member, '17-phone-community-home-w7-share-momentum');
    // W4: the counting guide on the entry screen, from the goal's guide key.
    await member.goto(`${BASE_URL}/contribute/${goalId}`);
    await visible(member.getByTestId('wsf-contribute-entry-screen'), 30_000);
    await visible(member.getByTestId('wsf-contribute-guide'));
    if ((await member.getByTestId('wsf-contribute-guide-panel').count()) === 0) await member.getByTestId('wsf-contribute-guide-toggle').click();
    await visible(member.getByTestId('wsf-contribute-guide-panel'));
    const guide = await member.getByTestId('wsf-contribute-guide-panel').innerText();
    assert(!/medical|doctor|diagnos|injur|treat/i.test(guide), 'The guide carries medical wording');
    await snap(member, '18-phone-contribution-guide-w4');
    // W8: the Champion's join QR lives inside Manage only.
    const champion = await championCtx.newPage();
    await signInPage(champion, fx.champion);
    await champion.goto(`${BASE_URL}/community/${fx.groupId}`);
    await openManage(champion);
    await visible(champion.getByTestId('wsf-community-qr-section'));
    await visible(champion.getByTestId('wsf-community-qr'));
    // The symbol is drawn on demand, after hydration, and carries the string
    // it encodes as data-qr-url (src/ui/JoinQrCode.tsx) — so the proof is
    // WHICH link the QR is, not that a picture appeared: the same
    // `${origin}/join/${joinCode}` the Copy link control puts on the clipboard
    // (src/ui/joinLink.ts buildJoinUrl), from the fixture's own code at the
    // origin the page was opened on.
    await champion.getByTestId('wsf-community-qr-toggle').click();
    await visible(champion.getByTestId('wsf-community-qr-symbol'));
    const qrUrl = await champion.getByTestId('wsf-community-qr-symbol').getAttribute('data-qr-url');
    assert(qrUrl === `${BASE_URL}/join/${fx.joinCode}`, `The QR symbol does not encode the fixture join link: ${sanitize(qrUrl)}`);
    await snap(champion, '19-phone-champion-join-qr-w8');
    check('guided rules, share + momentum, join QR (W4/W7/W8)', 'PASS', 'guide panel (non-medical) on entry; momentum + share control for the member, no QR/Manage on an inviteOnly community; Champion QR inside Manage encodes the fixture join link');
  } finally {
    await Promise.all([memberCtx, championCtx].map((ctx) => ctx.close().catch(() => undefined)));
  }
  return fx;
}

async function caseW9Kiosk(browser) {
  const fx = await seedFixture('w9', 1, false);
  const goalId = fx.goalIds[0];
  await authorizeDisplay(fx, goalId);
  const ctx = await browser.newContext(PHONE_CONTEXT);
  try {
    const page = await ctx.newPage();
    let attemptId = null;
    await page.route('**/wsfContribute', async (route) => {
      try { const body = JSON.parse(route.request().postData() || '{}'); if (typeof body?.data?.attemptId === 'string') attemptId = body.data.attemptId; } catch {}
      return route.continue();
    });
    await page.goto(`${BASE_URL}/kiosk/${goalId}`);
    await visible(page.getByTestId('wsf-kiosk-screen'), 30_000);
    await textEquals(page.getByTestId('wsf-kiosk-community'), fx.communityDisplayName);
    assert((await page.getByTestId('wsf-kiosk-screen').innerText()).match(/verif|witness|proof|scan your/i) === null, 'The kiosk claims to witness');
    await snap(page, '20-phone-kiosk-start-w9');
    await page.getByTestId('wsf-kiosk-start').click();
    await page.waitForURL(/\/contribute\/.*kiosk=1/, { timeout: 20_000 });
    await visible(page.getByTestId('wsf-contribute-signed-out'));
    await page.getByTestId('wsf-contribute-signin-link').click();
    await visible(page.getByTestId('wsf-signin-email'));
    await page.getByTestId('wsf-signin-email').fill(fx.member.email);
    await page.getByTestId('wsf-signin-password').fill(fx.member.password);
    await page.getByTestId('wsf-signin-submit').click();
    await page.waitForURL(/\/contribute\/.*kiosk=1/, { timeout: 20_000 });
    await visible(page.getByTestId('wsf-contribute-entry-screen'));
    assert((await page.getByTestId('wsf-contribute-back').count()) === 0, 'The kiosk offers a way into the member community');
    await page.getByTestId('wsf-contribute-entry').fill('7');
    await page.getByTestId('wsf-contribute-review').click();
    await visible(page.getByTestId('wsf-contribute-review-screen'));
    await page.getByTestId('wsf-contribute-submit').click();
    await visible(page.getByTestId('wsf-contribute-receipt'), 30_000);
    assert(typeof attemptId === 'string' && attemptId.length > 0, 'The kiosk contribution never sent an attempt id');
    trackContribution(goalId, fx.member.uid, attemptId);
    await visible(page.getByTestId('wsf-kiosk-finish'));
    assert((await readAuthRecords(page)).some((k) => k.startsWith('firebase:authUser:')), 'No signed-in account before Finish, so the reset below would prove nothing');
    await snap(page, '21-phone-kiosk-receipt-finish-w9');
    await page.getByTestId('wsf-kiosk-finish').click();
    await page.waitForURL(new RegExp(`/kiosk/${goalId}$`), { timeout: 20_000 });
    await visible(page.getByTestId('wsf-kiosk-screen'));
    assert(!(await readAuthRecords(page)).some((k) => k.startsWith('firebase:authUser:')), 'Finish left the account signed in');
    const session = await page.evaluate(() => Object.keys(window.sessionStorage));
    assert(!session.some((k) => k.startsWith('wsf.kiosk')), `Finish left kiosk keys behind: ${session.join(',')}`);
    await page.getByTestId('wsf-kiosk-start').click();
    await page.waitForURL(/\/contribute\/.*kiosk=1/, { timeout: 20_000 });
    await visible(page.getByTestId('wsf-contribute-signed-out'));
    await snap(page, '22-phone-kiosk-next-visitor-signed-out-w9');
    check('kiosk mode (W9)', 'PASS', 'start → sign in → contribute → Finish signed out and cleared kiosk keys; next visitor meets the sign-in gate');
  } finally {
    await ctx.close().catch(() => undefined);
  }
  return fx;
}

// ---- Station callable transport -------------------------------------------
// THE HOLE THIS CLOSES. A staging deploy went fully green twice while the
// seven station callables sat on `invoker_iam_check_enabled` — the identical
// transport state that produced `HTTP 403 (transport)` on
// wsfGoalRecentAdditions — because this script contained no reference to any
// of them. "Green" said the deploy succeeded and said nothing at all about
// whether the stations answer.
//
// WHAT IS PROVED: THE DOOR, NOT THE ROOM. Four of the seven are declared
// `invoker: 'public'` in functions-westayfit/src/index.ts, because a station
// device has no account and must reach them signed out. For those four, an
// anonymous POST refused at the TRANSPORT is a deploy fault. Their
// application-level answer is NOT asserted: 'invalid-argument', 'not-found',
// 'permission-denied' or an 'expired' status is the right answer to a
// synthetic request and is not a failure here.
//
// THE THREE CHAMPION-ONLY CALLABLES ARE DELIBERATELY NOT PROBED.
// wsfApproveStation, wsfListStations and wsfRevokeStation are not declared
// `invoker: 'public'`, so from outside, the refusal an anonymous caller is
// SUPPOSED to get and the refusal a broken transport produces are the same
// event: a 403 reads as "correctly closed" and as "unreachable, the Champion
// station UI is dead" equally well, and a check that passes either way cannot
// fail for the right reason. Asserting the opposite — that they answer 401
// from inside the handler — would assert a transport policy their declaration
// does not claim. So they are left out, and the gap is named in the receipt's
// limitations instead of being papered over with a check that always passes.
//
// NOTHING IS CREATED ON STAGING. Every payload below is refused before it
// writes, or reads and writes nothing:
//   * wsfStationRequestPairing is the one that WRITES (a wsfKioskPairings
//     document). It validates goalId BEFORE it touches Firestore, so a payload
//     carrying no goalId is refused 'invalid-argument' and no pairing document
//     is ever minted. A well-formed goalId would mint one, and a pairing
//     document's id is a random Firestore id with no run tag in it —
//     cleanup-synthetic.mjs refuses a manifest holding ANY untagged path and
//     then deletes NOTHING, so tracking a pairing would not clean it up, it
//     would break the cleanup of every other fixture in the run.
//   * wsfStationPairingStatus and wsfStationClaimPairing are handed an
//     obviously-synthetic id that no pairing has: status reads and answers
//     'expired', claim reads and throws 'not-found'. Neither writes.
//   * wsfStationState is sent a station id and NO secret, so it refuses at the
//     boundary before any station document is read or any lastSeenAt is
//     rewritten. No credential, station secret, pairing code or join code is
//     sent or logged by any of the four.
// The one write these calls do cause is the callables' own per-IP rate-limit
// counter, wsfStationRateLimits/<salted daily IP hash>, which the function
// writes for any station call, real or synthetic. It is not run-scoped fixture
// data, its key is a salted hash this script cannot compute, and it is the
// same document a real station's first poll writes.

/**
 * The refusal wsfStationState answers with when it is handed no live
 * credential. It is the ONE station callable whose correct anonymous answer —
 * 'permission-denied' — is HTTP 403, the same status a transport denial
 * carries, so status ALONE cannot tell the two apart for this one service and
 * a bare `status !== 403` there could only ever fail. Its own sentence can
 * tell them apart: the transport refuses before the container runs and cannot
 * produce it. The other three probes are decided on status alone.
 */
const STATION_REJECTED_MESSAGE = 'This screen is not enrolled.';
/** Run-tagged, obviously synthetic, and not the shape of any minted id. */
const STATION_PROBE_ID = `wsfsmoke-absent-${runTag}`;
const PUBLIC_STATION_PROBES = [
  // No goalId on purpose: refused before the pairing document is written.
  { name: 'wsfStationRequestPairing', data: {} },
  { name: 'wsfStationPairingStatus', data: { pairingId: STATION_PROBE_ID } },
  { name: 'wsfStationClaimPairing', data: { pairingId: STATION_PROBE_ID } },
  // No secret at all, so nothing credential-shaped crosses the wire.
  { name: 'wsfStationState', data: { stationId: STATION_PROBE_ID } },
];

/** null when the request reached the handler; the failure sentence when it did not. */
function stationTransportVerdict(name, response) {
  if (response.status !== 401 && response.status !== 403) return null;
  const error = response.body?.error;
  const answeredByHandler =
    response.status === 403 &&
    !!error &&
    typeof error === 'object' &&
    error.status === 'PERMISSION_DENIED' &&
    error.message === STATION_REJECTED_MESSAGE;
  if (answeredByHandler) return null;
  return `${name} is not publicly invokable on staging: HTTP ${response.status} (transport)`;
}

async function caseStationTransport() {
  const refused = [];
  for (const probe of PUBLIC_STATION_PROBES) {
    // Every probe runs: one closed door must not hide the other three.
    const verdict = stationTransportVerdict(probe.name, await callFunction(probe.name, probe.data));
    if (verdict) refused.push(verdict);
  }
  assert(refused.length === 0, refused.join('; '));
  check('station callable transport', 'PASS', `all ${PUBLIC_STATION_PROBES.length} unauthenticated-by-design station callables reached their handler anonymously; no pairing, station or fixture document created`);
  return null;
}

/**
 * PUBLIC DYNAMIC ROUTES, RELOADED COLD.
 *
 * `/combined/<setupId>` and `/station/<goalId>` are the two public routes this
 * suite never loaded. Everything else it drives — community, display,
 * contribute, kiosk — it reaches by navigating; these two it did not reach at
 * all, so nothing here proved that Hosting serves them on a DIRECT hit.
 *
 * That gap matters because of how the app is built. Expo's static export emits
 * one document per route and a `firebase.json` rewrite maps `/combined/**` and
 * `/station/**` onto it. A pasted address at an event is a direct GET, not a
 * navigation, so the rewrite is the only thing standing between a screen and a
 * 404 — and a rewrite that is missing or misspelt fails exactly here and
 * nowhere else. Local evidence cannot settle it: the emulator has its own
 * rewrite handling, and this harness does not treat emulator evidence as
 * hosted evidence.
 *
 * WHY THE TITLE AND NOT THE STATUS. Firebase Hosting answers an unmatched path
 * with its own document, and a check that accepted any 200 would pass on that
 * too. Each route's exported document carries its own `<title>`, so the title
 * is what distinguishes "Hosting resolved THIS route" from "Hosting served
 * something". A neighbouring route's document fails this check as loudly as a
 * 404 does, which is the point.
 *
 * READ-ONLY BY CONSTRUCTION. Two GETs for an HTML document. The ids are
 * run-tagged and deliberately absent, so no lookup can match one; nothing is
 * created, nothing is read back, and nothing needs cleaning up. It asserts
 * only that the route resolves — never that the id exists, never that the
 * screen behind it works, and never anything about callable transport.
 */
const DYNAMIC_ROUTE_PROBES = [
  { route: '/combined', title: 'Combined goal' },
  { route: '/station', title: 'Station' },
];

async function caseDynamicRouteReload() {
  // Absent on purpose, and run-tagged so it cannot collide with real data.
  const absentId = `wsfsmoke-absent-${runTag}`;
  const refused = [];
  for (const probe of DYNAMIC_ROUTE_PROBES) {
    const url = `${BASE_URL}${probe.route}/${absentId}`;
    let status;
    let body;
    try {
      const response = await fetch(url, { redirect: 'follow' });
      status = response.status;
      body = await response.text();
    } catch (error) {
      // Every probe runs: one unreachable route must not hide the other.
      refused.push(`${probe.route}/** did not answer a cold reload: ${sanitize(error?.message || error)}`);
      continue;
    }
    if (status !== 200) {
      refused.push(`${probe.route}/** did not answer a cold reload: HTTP ${status}`);
      continue;
    }
    const title = (/<title>([^<]*)<\/title>/.exec(body) || [, ''])[1];
    if (!title.includes(probe.title)) {
      refused.push(
        `${probe.route}/** resolved to a document titled "${title}", not the ${probe.title} route`
      );
    }
  }
  assert(refused.length === 0, refused.join('; '));
  check('public dynamic route reload', 'PASS', `${DYNAMIC_ROUTE_PROBES.map((p) => `${p.route}/**`).join(' and ')} each answered a direct cold GET with their own exported document; absent run-tagged ids, nothing created or read`);
  return null;
}

/**
 * THE TURN CONTRACT, HOSTED.
 *
 * Until this row existed the hosted suite had NOTHING for the turn journey —
 * not one reference to wsfEventContext, wsfJoinTurnLine, wsfTurnReady,
 * wsfMyTurn, wsfCallNext, wsfStartTurn, wsfCompleteTurn or wsfApproveStation.
 * Every claim about the queue rested on emulator evidence, which this harness
 * does not accept as hosted evidence, so "the queue works on staging" could
 * not be said truthfully either way.
 *
 * WHAT IT PROVES, in the order a room meets it: a Champion enrols TWO screens
 * on one event; a participant on an INDEPENDENT identity gets the event's
 * activities, is NOT in the line merely for having looked, joins explicitly,
 * is called, is the only one who may say ready, runs the turn on the screen,
 * and is recorded exactly once against the activity they chose and once
 * against the combined parent — with the activity they did NOT choose left
 * alone. Then the screen clears.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It never asserts a service is reachable by
 * probing it with an invalid payload; every call here is a real one with a
 * real identity. A transport failure and an application refusal are different
 * things and this row reports which it hit.
 *
 * WHILE THE TWELVE PARTICIPANT/CHAMPION CALLABLES ARE TRANSPORT-BLOCKED THIS
 * ROW FAILS, and that is the point: it turns "the queue is blocked" from a
 * sentence somebody has to remember into a row the board prints. It is
 * isolated, so its failure is its own row and every other case still runs.
 */
const TURN_COUNT = 12;
/** functions-westayfit/src/index.ts: TURN_READY_LEASE_MS and
 * TURN_RESULT_VISIBLE_MS. Both are waited out for real below — a lease and a
 * display window cannot be proven from a response shape. */
const TURN_LEASE_MS = 45_000;
const TURN_RESULT_MS = 10_000;
/** NOT_FOUND_MESSAGE. The same sentence an unknown id gets, which is the
 * point: an entryId must not reveal whose place it is. */
const TURN_GENERIC_REFUSAL = 'This link is not valid.';

/** Names what a call hit, so a closed door is never read as a refusal. */
function turnCallFailure(step, response) {
  if (response.ok) return null;
  const error = response.body?.error;
  const status = typeof error?.status === 'string' ? error.status : `HTTP ${response.status}`;
  const answeredByHandler = !!error && typeof error === 'object' && typeof error.status === 'string';
  const kind = answeredByHandler ? 'application' : 'TRANSPORT';
  return `${step}: ${kind} refusal (${status})`;
}

async function turnCall(step, name, data, idToken = null) {
  const response = await callFunction(name, data, idToken);
  const failure = turnCallFailure(step, response);
  if (failure) throw new Error(failure);
  return callableData(response);
}

async function caseTurnContract() {
  // Two activities, because the combined parent needs two children and the
  // whole point of one assertion below is that the UNCHOSEN one stays still.
  const fx = await seedFixture('turn', 2);
  const [activityA, activityB] = fx.goalIds;
  const championToken = await signInToken(fx.champion);
  const memberToken = await signInToken(fx.member);
  const outsiderToken = await signInToken(fx.outsider);
  const uid = fx.member.uid;

  // ── THE COMBINED EVENT ────────────────────────────────────────────────────
  //
  // THE PARENT WINDOW IS THE FIXTURE'S OWN, NOT A FRESH CLOCK READING.
  //
  // Run 28 failed here, and the product was right to refuse it. The server
  // enforces `child.startsAt >= combined.startsAt` (COMBINED_WINDOW_MESSAGE).
  // seedFixture() stamps the children at ITS now minus 60s; recomputing
  // `Date.now() - 60_000` here reads the clock again after the fixture has
  // created three accounts and written a dozen documents, so the parent began
  // AFTER its own children by however long that took, and the refusal was
  // FAILED_PRECONDITION every time. Reusing the instants the fixture actually
  // wrote makes the windows identical, which satisfies the bound at its
  // boundary and cannot drift with how slow the seeding was.
  const combined = await turnCall('create combined goal', 'wsfCreateCombinedGoal', {
    communityGroupId: fx.groupId,
    title: `Hosted turn ${runTag}`,
    unit: 'movements',
    target: 2000,
    startsAt: fx.startsAtIso,
    endsAt: fx.endsAtIso,
    timezone: 'UTC',
    childGoalIds: [activityA, activityB],
  }, championToken);
  assert(typeof combined?.setupId === 'string' && combined.setupId, 'combined setup id missing');
  const setupId = combined.setupId;
  // Minted by the server, so it can never carry the run tag: it is claimed
  // through the run-tagged community it names. Every id below is handled the
  // same way — see trackLinked().
  trackLinked(`wsfCombinedGoals/${setupId}`, fx.groupId);
  // The claim the contribution path reads to decide a credit, one per child,
  // and the parent's counter shards. The shard index is random
  // (COMBINED_SHARD_COUNT = 10), so the row cannot know which one it wrote.
  for (const child of [activityA, activityB]) {
    trackDoc(`wsfCombinedGoalClaims/${child}`);
    for (let shard = 0; shard < 10; shard += 1) {
      trackDoc(`wsfCombinedCounters/${setupId}/shards/${child}_${shard}`);
    }
  }

  // ── TWO SCREENS, ENROLLED THE WAY A CHAMPION ENROLS THEM ──────────────────
  const stations = [];
  for (const slot of [1, 2]) {
    const pairing = await turnCall(`station ${slot} pairing`, 'wsfStationRequestPairing', { goalId: activityA });
    assert(typeof pairing?.code === 'string', `station ${slot} pairing returned no code`);
    trackLinked(`wsfKioskPairings/${pairing.pairingId}`, activityA);
    // The Champion approves. This is wsfApproveStation — one of the twelve.
    const approved = await turnCall(`station ${slot} approval`, 'wsfApproveStation', {
      goalId: activityA, code: pairing.code, slot,
    }, championToken);
    assert(approved?.slot === slot, `station ${slot} approved into the wrong slot`);
    trackLinked(`wsfKioskStations/${approved.stationId}`, activityA);
    // Only the screen that asked may claim, and only it receives the secret.
    const claimed = await turnCall(`station ${slot} claim`, 'wsfStationClaimPairing', {
      pairingId: pairing.pairingId,
    });
    assert(typeof claimed?.secret === 'string' && claimed.secret, `station ${slot} got no secret`);
    assert(claimed.stationId === approved.stationId, `station ${slot} claimed a different station`);
    stations.push({ slot, stationId: claimed.stationId, secret: claimed.secret });
  }
  const [stationOne, stationTwo] = stations;

  // The enrolled screen knows its event without being told who is waiting.
  const enrolled = await turnCall('station state', 'wsfStationState', {
    stationId: stationOne.stationId, secret: stationOne.secret,
  });
  assert(enrolled?.goalId === activityA, 'the enrolled station is on the wrong goal');

  // ── THE PARTICIPANT, ON AN IDENTITY OF THEIR OWN ──────────────────────────
  const context = await turnCall('event context', 'wsfEventContext', { goalId: activityA }, memberToken);
  const offered = (context?.activities || []).map((a) => a.goalId).sort();
  assert(offered.length === 2, `a combined event must offer both activities; it offered ${offered.length}`);
  assert(offered.includes(activityA) && offered.includes(activityB), 'the event did not offer both activities');

  // LOOKING IS NOT JOINING. Reading the event must leave the line untouched.
  const beforeJoin = await turnCall('my turn before joining', 'wsfMyTurn', { goalId: activityA }, memberToken);
  assert(!beforeJoin?.turn, 'reading the event put somebody in the line; a scan must never enqueue');

  // Joining is the only way in, and every entry it mints is tracked — this
  // row joins three times, and a row that tracked only the last one would
  // leave the first two behind.
  async function joinLine(step) {
    const joined = await turnCall(step, 'wsfJoinTurnLine', {
      goalId: activityA, calledName: 'A.L.',
    }, memberToken);
    assert(typeof joined?.entryId === 'string' && joined.entryId, `${step} returned no entry`);
    trackLinked(`wsfTurnEntries/${joined.entryId}`, activityA);
    return joined;
  }

  const first = await joinLine('join the line');
  assert(first.alreadyInLine === false, 'the first join reported an existing place');

  // THE LINE, THE PLACE AND THE RECEIPT. lineId and attemptId are not in any
  // callable response, so they are DISCOVERED from the entry the server just
  // wrote — which is also the only honest way to know what to clean up.
  const firstEntry = await getDoc(`wsfTurnEntries/${first.entryId}`);
  const lineId = firstEntry.body?.fields?.lineId?.stringValue;
  assert(typeof lineId === 'string' && lineId, 'the entry carries no lineId, so its line cannot be tracked');
  assert(lineId === `setup__${setupId}`, `a combined event's line is setup__{setupId}; this one is ${lineId}`);
  trackLinked(`wsfTurnLines/${lineId}`, fx.groupId);
  trackLinked(`wsfTurnMembers/${lineId}__${uid}`, uid);
  trackLinked(`wsfTurnReceipts/${lineId}__${uid}`, uid);

  const afterJoin = await turnCall('my turn after joining', 'wsfMyTurn', { goalId: activityA }, memberToken);
  assert(afterJoin?.turn?.entryId === first.entryId, 'the phone cannot see the place it just took');

  // ── SWITCHING TO YOUR OWN PHONE GIVES THE PLACE BACK ──────────────────────
  // wsfLeaveTurnLine is unilateral and frees the event place. If it did not,
  // the rejoin below would report an existing place instead of a new one.
  const left = await turnCall('leave the line for my own phone', 'wsfLeaveTurnLine', {
    entryId: first.entryId, switchingToPhone: true,
  }, memberToken);
  assert(left?.status === 'left', `leaving left the turn in ${left?.status}`);
  const afterLeaving = await turnCall('my turn after leaving', 'wsfMyTurn', { goalId: activityA }, memberToken);
  assert(!afterLeaving?.turn, 'the place was not freed when the participant switched to their own phone');

  // ── THE 45-SECOND READY LEASE ACTUALLY EXPIRES ────────────────────────────
  // A call is an offer, not a summons. The participant is called and says
  // NOTHING; the place must come back on its own. This waits real time —
  // there is no way to prove a lease from a response shape.
  const lapsing = await joinLine('rejoin before the lease test');
  assert(lapsing.alreadyInLine === false, 'leaving did not free the place: the rejoin found one');
  const offering = await turnCall('call next (lease test)', 'wsfCallNext', {
    stationId: stationOne.stationId, secret: stationOne.secret,
  });
  assert(offering?.called === true, 'the station called next and nobody was assigned');
  assert(offering.assigned?.code === lapsing.code, 'the screen is showing a different code');
  const assigned = await turnCall('my turn while assigned', 'wsfMyTurn', { goalId: activityA }, memberToken);
  assert(assigned?.turn?.status === 'assigned', `being called left the turn in ${assigned?.turn?.status}`);
  assert(
    typeof assigned.turn.readySecondsLeft === 'number' && assigned.turn.readySecondsLeft > 0,
    'an assigned turn reports no ready countdown, so there is no lease to expire'
  );
  assert(
    assigned.turn.readySecondsLeft <= 45,
    `the ready lease is 45 seconds; the phone was offered ${assigned.turn.readySecondsLeft}`
  );
  await new Promise((resolve) => setTimeout(resolve, TURN_LEASE_MS + 5_000));
  const lapsed = await turnCall('my turn after the lease', 'wsfMyTurn', { goalId: activityA }, memberToken);
  assert(!lapsed?.turn, 'the 45-second lease expired and the phone is still holding a live turn');
  // And the place is genuinely recovered, not merely hidden: a rejoin mints a
  // NEW entry rather than handing back the abandoned one.
  const rejoined = await joinLine('rejoin after the no-show');
  assert(
    rejoined.alreadyInLine === false && rejoined.entryId !== lapsing.entryId,
    'a lapsed turn was handed back instead of recovering the place'
  );

  // ── THE CALL, AND WHO MAY ANSWER IT ───────────────────────────────────────
  const called = await turnCall('call next', 'wsfCallNext', {
    stationId: stationOne.stationId, secret: stationOne.secret,
  });
  assert(called?.called === true, 'the station called next and nobody was assigned');
  assert(called.assigned?.code === rejoined.code, 'the screen is showing a different code');

  // PRIVACY. A number of people waiting, never a list, at any depth.
  assert(typeof called.waitingCount === 'number', 'the hall did not report a waiting count');
  const hallJson = JSON.stringify(called);
  assert(!hallJson.includes(fx.member.email), "the hall disclosed a participant's email");
  assert(!hallJson.includes(uid), "the hall disclosed a participant's uid");

  // TWO STATIONS CANNOT CLAIM THE SAME TURN. The second screen calls into the
  // same event and must not be handed the person already assigned.
  const second = await turnCall('second station calls next', 'wsfCallNext', {
    stationId: stationTwo.stationId, secret: stationTwo.secret,
  });
  assert(
    second?.assigned?.code !== rejoined.code,
    'two stations were handed the same turn'
  );
  assert(
    second?.called === false,
    'the second screen reported calling somebody when the only participant was already assigned'
  );

  // ONLY THE ASSIGNED PARTICIPANT MAY SAY READY, and the refusal is the
  // product's own generic not-found — NOT merely "some application error".
  // An entryId must not become a way to learn whose place it is, so the
  // sentence a stranger gets is the sentence an unknown id gets.
  const outsiderReady = await callFunction('wsfTurnReady', { entryId: rejoined.entryId }, outsiderToken);
  const outsiderTransport = turnCallFailure('outsider ready', outsiderReady);
  assert(
    outsiderTransport !== null,
    'somebody who is not the assigned participant was allowed to say ready'
  );
  assert(outsiderTransport.includes('application'), outsiderTransport);
  assert(
    outsiderReady.body?.error?.status === 'NOT_FOUND',
    `the outsider refusal must be the generic not-found; it was ${outsiderReady.body?.error?.status}`
  );
  assert(
    outsiderReady.body?.error?.message === TURN_GENERIC_REFUSAL,
    'the outsider refusal does not use the generic sentence, so an entryId leaks whether it exists'
  );

  const ready = await turnCall('ready', 'wsfTurnReady', { entryId: rejoined.entryId }, memberToken);
  assert(ready?.status === 'ready', `ready left the turn in ${ready?.status}`);

  // ── THE TURN ITSELF: STARTED AT THE SCREEN, FINISHED ON THE PHONE ─────────
  const started = await turnCall('start the turn', 'wsfStartTurn', {
    stationId: stationOne.stationId, secret: stationOne.secret,
  });
  assert(started?.started === true, 'the station could not start the ready turn');
  assert(started.activity?.goalId === activityA, 'the screen started the wrong activity');

  // The attempt the station minted is on the entry. Discovering it is what
  // makes the contribution, the member total, the recent addition and the
  // combined credit nameable — and therefore cleanable.
  const startedEntry = await getDoc(`wsfTurnEntries/${rejoined.entryId}`);
  const attemptId = startedEntry.body?.fields?.attemptId?.stringValue;
  assert(typeof attemptId === 'string' && attemptId, 'starting the turn minted no attempt id on the entry');
  trackDoc(`wsfContributions/${activityA}_${uid}_${attemptId}`);
  trackDoc(`wsfGoalMemberTotals/${activityA}_${uid}`);
  trackDoc(`wsfGoals/${activityA}/recentAdditions/${attemptId}`);
  trackDoc(`wsfCombinedCredits/${activityA}_${uid}_${attemptId}`);

  // THE PHONE RECORDS IT. Same canonical attempt, from the person's own
  // identity rather than the station secret.
  const recorded = await turnCall('record the turn from the phone', 'wsfCompleteMyTurn', {
    entryId: rejoined.entryId, count: TURN_COUNT,
  }, memberToken);
  assert(
    recorded?.receipt?.addedCount === TURN_COUNT,
    `the phone recorded ${recorded?.receipt?.addedCount}, expected ${TURN_COUNT}`
  );
  assert(recorded.receipt.alreadyRecorded !== true, 'the first record claimed it had already happened');

  // IDEMPOTENT ON THE PHONE. A lost response, tapped again.
  const retried = await turnCall('retry from the phone', 'wsfCompleteMyTurn', {
    entryId: rejoined.entryId, count: TURN_COUNT,
  }, memberToken);
  assert(retried?.receipt?.alreadyRecorded === true, 'a phone retry recorded a second time');

  // AND IDEMPOTENT ACROSS THE TWO SURFACES. The screen that started the turn
  // presses its own button after the phone already finished: it is the same
  // attempt, so it must add nothing.
  const atStation = await turnCall('retry at the screen', 'wsfCompleteTurn', {
    stationId: stationOne.stationId, secret: stationOne.secret, count: TURN_COUNT,
  });
  assert(
    atStation?.recorded?.alreadyRecorded === true,
    'the screen recorded a second time what the phone had already recorded'
  );

  // ── THE ARITHMETIC: ONE CHILD, ONE PARENT, THE OTHER CHILD UNTOUCHED ──────
  // Read as the member. These goals are not display-authorized, so an
  // anonymous read would be refused for a reason that has nothing to do with
  // the arithmetic this row is checking.
  const chosen = await turnCall('chosen activity pulse', 'wsfGoalPulse', { goalId: activityA }, memberToken);
  const untouched = await turnCall('unchosen activity pulse', 'wsfGoalPulse', { goalId: activityB }, memberToken);
  const parent = await turnCall('combined pulse', 'wsfCombinedGoalPulse', { setupId }, memberToken);
  assert(chosen?.sharedTotal === TURN_COUNT, `the chosen activity holds ${chosen?.sharedTotal}, expected ${TURN_COUNT}`);
  assert(untouched?.sharedTotal === 0, `the activity nobody chose moved to ${untouched?.sharedTotal}`);
  assert(parent?.sharedTotal === TURN_COUNT, `the combined parent holds ${parent?.sharedTotal}, expected ${TURN_COUNT}`);

  // ── THE SCREEN CLEARS, AND THE RESULT IS NOT PERMANENT ────────────────────
  const afterRecord = await turnCall('station state after recording', 'wsfStationState', {
    stationId: stationOne.stationId, secret: stationOne.secret,
  });
  assert(!afterRecord?.assigned, 'the screen is still showing somebody after recording');
  assert(afterRecord?.result, 'the screen shows no result at all in the ten seconds after recording');
  assert(afterRecord.result.code === rejoined.code, 'the ten-second result names a different turn');
  assert(afterRecord.result.amount === TURN_COUNT, `the ten-second result shows ${afterRecord.result.amount}`);
  assert(!JSON.stringify(afterRecord.result).includes('A.L.'), 'the ten-second result shows a name');

  // TEN SECONDS, PROVEN BY WAITING PAST THEM. A result that never expired
  // would leave a code on a public screen for the rest of the event.
  await new Promise((resolve) => setTimeout(resolve, TURN_RESULT_MS + 3_000));
  const afterWindow = await turnCall('station state after the result window', 'wsfStationState', {
    stationId: stationOne.stationId, secret: stationOne.secret,
  });
  assert(
    !afterWindow?.result,
    'the ten-second result is still on the screen after the window closed'
  );

  check('hosted turn-service contract', 'PASS', `two stations enrolled and approved; an independent participant read the event without joining, joined explicitly, gave the place back by switching to their own phone, was called and let the 45-second lease expire and recovered their place, rejoined, was called, refused an outsider at the ready gate with the generic not-found, readied, started at the screen and recorded ${TURN_COUNT} from their phone once — a phone retry and a screen retry both added nothing; the chosen activity and the combined parent each hold ${TURN_COUNT}, the unchosen activity 0; the screen cleared and the ten-second result expired`);
  return null;
}
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
  // BOTH registers, or the run deletes its own fixtures and leaves the
  // server-named ones behind — and the always-run recovery cleanup then has
  // to do it, which is not what the PASS row below claims.
  const ordered = [...cleanup.docs, ...cleanup.linked.keys()]
    .sort((a, b) => b.split('/').length - a.split('/').length);
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
  // First, and isolated, on purpose. It needs no browser and no fixture, and
  // the failure it exists to catch must still be reported when a later
  // non-isolated case aborts the suite — "we did not know" is the whole
  // reason this row exists. Isolated is not advisory: the row is a FAIL row
  // and the run still exits non-zero.
  await isolated('station callable transport', () => caseStationTransport());
  // Same reasons as the row above: no browser, no fixture, and a failure
  // that must still be reported when a later case aborts the suite.
  await isolated('public dynamic route reload', () => caseDynamicRouteReload());
  // Isolated for the same reason, and for one more: while the twelve
  // participant/Champion callables are transport-blocked this row FAILS, and
  // that failure is the measurement. It must not take the rest of the suite
  // down with it.
  await isolated('hosted turn-service contract', () => caseTurnContract());
  await caseRoundTrip(browser);
  await caseProtectedReads();
  await caseUncertainAndPerGoal(browser);
  await caseDelayedDisplayResponses(browser);
  await isolated('membership status rules (D-5)', () => caseD5MembershipStatusRules());
  await caseD1SignupGate(browser);
  await caseVisualProof(browser);
  await isolated('recent public additions (W2)', () => caseW2RecentAdditions());
  await isolated('repeat policy (W3)', () => caseW3RepeatPolicy());
  await isolated('target-crossing event (W5)', () => caseW5ReachedState());
  await isolated('durable history (W6)', () => caseW6History());
  await isolated('guided rules, share + momentum, join QR (W4/W7/W8)', () => caseW4W7W8Browser(browser));
  await isolated('kiosk mode (W9)', () => caseW9Kiosk(browser));
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
    'The candidate B cases (W2, W3, W5, W6, W4/W7/W8, W9) each run on an isolated row; every contribution they record (and its recent-additions entry) is removed by cleanup.',
    'The hosted turn-service row is a SERVICE contract, not an end-to-end one. It drives the real callables with real identities — a Champion token, an independent participant token, an outsider token and two station secrets — and it waits out the 45-second ready lease and the ten-second result window rather than inferring them from a response shape. It records one genuine contribution, which cleanup removes with everything else it creates. It reports whether a refusal came from Cloud Run transport or from the application, because those are different failures and only one of them is a product defect.',
    'What the hosted turn-service row does NOT establish: nothing about a browser, a phone, a station screen, a scanned QR or anything a person sees or taps. It never opens a page. Independent browser and player proof of the expo journey is a SEPARATE gate and is not covered by this row passing.',
    'The public dynamic route reload row proves only that Hosting resolves /combined/** and /station/** to their own exported documents on a direct GET. It asserts nothing about the ids in those addresses, which are deliberately absent, and nothing about whether the screens behind them work.',
    "The station transport row proves only that the four callables declared invoker:'public' (wsfStationRequestPairing, wsfStationPairingStatus, wsfStationClaimPairing, wsfStationState) are reachable anonymously. It asserts nothing about their application-level answers, and it exercises no station end to end.",
    'The three Champion-only station callables (wsfApproveStation, wsfListStations, wsfRevokeStation) are NOT probed: they are not declared invoker:\'public\', so a transport denial and the refusal an anonymous caller is supposed to get are the same 403 from outside, and a check that passes either way could not fail for the right reason. Their transport remains unverified by this suite.',
    'The station probes create no pairing, station or fixture document: each is refused before it writes or reads nothing. They do cause the callables\' own per-IP rate-limit counter (wsfStationRateLimits/<salted daily IP hash>) to be written, which is the function\'s own bookkeeping, is not run-scoped, and cannot be addressed by this script.',
  ],
  diagnostics,
};
fs.writeFileSync(path.join(RESULT_DIR, 'wsf-package-e-hosted-result.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
// A fully green run emits 24 rows — one per check(..., 'PASS') site in this
// file. hosted-smoke-contract.test.mjs pins that number and the row names, so
// a row added or removed here has to be accounted for there in the same change.
console.log(`RESULTS=${results.length}`);
console.log(`FAILURES=${failed.length}`);
console.log(`RUN_TAG=${runTag}`);
if (mainError || failed.length) process.exit(1);
