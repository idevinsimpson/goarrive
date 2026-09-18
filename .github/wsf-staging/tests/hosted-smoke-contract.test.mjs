#!/usr/bin/env node
/**
 * Static contract for hosted-package-e-smoke.mjs. The smoke needs a browser
 * and the deployed staging app, so its own behaviour cannot run here; what CAN
 * be checked is the shape of the failure injection, which is where run
 * 35248719827 went wrong: the list-goals abort was armed before the page had
 * proven its goals rendered, and it caught the page's own initial read.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SMOKE = fs.readFileSync(path.resolve('.github/wsf-staging/hosted-package-e-smoke.mjs'), 'utf8');
let passed = 0;
const test = (n, f) => { f(); passed += 1; console.log(`  ok  ${n}`); };

function fnBody(name) {
  const start = SMOKE.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} not found`);
  const next = SMOKE.indexOf('\nasync function ', start + 1);
  return SMOKE.slice(start, next === -1 ? undefined : next);
}
const body = fnBody('caseUncertainAndPerGoal');
const code = body.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const idx = (s) => { const i = code.indexOf(s); assert.notEqual(i, -1, `missing: ${s}`); return i; };

test('the uncertain case proves both toggles and both initial states rendered BEFORE any route is installed', () => {
  const firstRoute = idx('.route(');
  for (const proof of ['visible(toggleA', 'visible(toggleB', 'textEquals(stateA, \'Public display is not authorized', 'textEquals(stateB, \'Public display is not authorized']) {
    assert.ok(idx(proof) < firstRoute, `${proof} must come before the first route()`);
  }
});

test('the read block starts DISARMED and is armed only from inside the aborted write', () => {
  assert.match(code, /let blockRead = false;/);
  assert.equal(/let blockRead = true;/.test(code), false, 'the read block must not start armed');
  const writeRoute = code.slice(idx("route('**/wsfSetGoalDisplayAuthorization'"), idx("route('**/wsfListGoals'"));
  assert.match(writeRoute, /blockRead = true;/, 'blockRead must be armed inside the write handler');
  assert.match(writeRoute, /route\.abort\('failed'\)/);
  assert.match(writeRoute, /includes\(goalA\)/, 'only goal A\'s own write is the injected failure');
});

test('the injected write and the reconciliation read are both counted and asserted', () => {
  assert.match(code, /blocked\.writes \+= 1/);
  assert.match(code, /blocked\.reads \+= 1/);
  assert.match(code, /assert\(blocked\.writes >= 1/);
  assert.match(code, /assert\(blocked\.reads >= 1/);
  // The counters are asserted after the unconfirmed state has appeared, so
  // they prove the failure that was exercised is the one that was intended.
  assert.ok(idx('assert(blocked.writes >= 1') > idx("textContains(unsettledA, 'could not confirm'"));
});

test('the acceptance assertions of the case are intact', () => {
  for (const kept of [
    "textContains(unsettledA, 'could not confirm'",
    "textContains(toggleA, 'Try again: authorize public display')",
    "readAuthorization(goalA)) === false",
    "readAuthorization(goalB)) === true, 'Goal B authorization did not persist'",
    "textEquals(stateA, 'Public display is not authorized for this goal.')",
    "readAuthorization(goalA)) === true, 'Goal A retry did not send its intended value'",
    "readAuthorization(goalB)) === true, 'Goal A retry changed goal B'",
    "check('uncertain-result honesty', 'PASS'",
    "check('per-goal outcome isolation', 'PASS'",
  ]) idx(kept);
  assert.match(code, /blockWrite = false;\s*\n\s*blockRead = false;/, 'both blocks are disabled before goal B');
});

test('no fixed sleep was used as the fix', () => {
  assert.equal(/setTimeout/.test(code), false, 'the uncertain case must not wait on a fixed sleep');
});

/**
 * The UI-candidate compatibility delta (sections A–G). These are the parts of
 * the smoke that a future edit could quietly undo without any local suite
 * noticing, because they only fail against the deployed app: the Manage sheet
 * that now carries the Champion controls, the approved public-pulse shape, and
 * the refusal assertions that must stay paired with every refusal check.
 */
test('every Champion arrival on Community Home opens the Manage sheet before touching a display control', () => {
  const lines = SMOKE.split('\n');
  let arrivals = 0;
  lines.forEach((line, i) => {
    const arrival =
      /await champion\.goto\(`\$\{BASE_URL\}\/community\//.test(line) || /await champion\.reload\(\);/.test(line);
    if (!arrival) return;
    arrivals += 1;
    assert.match(
      lines[i + 1] ?? '',
      /await openManage\(champion\);/,
      `line ${i + 1} navigates the Champion to Community Home without opening the Manage sheet`
    );
  });
  assert.ok(arrivals >= 4, `expected every Champion arrival to be covered, saw ${arrivals}`);
  assert.match(SMOKE, /getByTestId\('wsf-community-manage'\)/);
  assert.match(SMOKE, /getByTestId\('wsf-community-manage-panel'\)/);
});

test('the approved public goal-pulse shape is pinned as a whole key set, not as a denylist', () => {
  const approved = SMOKE.match(/const APPROVED_PULSE_KEYS = \[([^\]]*)\]/);
  assert.ok(approved, 'APPROVED_PULSE_KEYS missing');
  const keys = [...approved[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(keys, [
    'communityDisplayName', 'endsAt', 'goalTitle', 'sharedTotal',
    'startsAt', 'status', 'target', 'timezone', 'unit',
  ]);
  assert.deepEqual(keys, [...keys].sort(), 'the approved list is compared against a sorted key list');
  assert.match(SMOKE, /JSON\.stringify\(pulseKeys\) === JSON\.stringify\(APPROVED_PULSE_KEYS\)/);
  // The pre-existing narrower assertion is kept, not replaced by the shape check.
  assert.match(SMOKE, /!\('contributorCount' in publicPulseData\)/);
  for (const leaked of ['joinCode', 'joinPolicy', 'groupType', 'createdByUserId', 'memberCount', 'contributorCount']) {
    assert.ok(SMOKE.includes(`'${leaked}'`), `the named no-leak list lost ${leaked}`);
  }
});

test('every display refusal is also checked for a context leak', () => {
  const refusals = SMOKE.split("visible(display.getByTestId('wsf-display-not-available')").length - 1;
  const leakChecks = SMOKE.split('assertNoContextLeak(display').length - 1;
  assert.ok(refusals > 0, 'the refusal checks disappeared');
  assert.equal(leakChecks, refusals, `${refusals} refusal checks but ${leakChecks} no-leak checks`);
  assert.match(SMOKE, /getByText\(fx\.communityDisplayName\)\.count\(\)\) === 0/);
  assert.match(SMOKE, /getByText\(`Package E \$\{fx\.label\} goal 1`\)\.count\(\)\) === 0/);
});

test('the display window is pinned in the goal\u2019s own zone, recomputed on every poll', () => {
  assert.match(SMOKE, /const GOAL_ZONE = 'America\/New_York';/);
  assert.match(SMOKE, /timezone: 'America\/New_York',/, 'the fixture must seed the zone the labels are pinned to');
  assert.match(SMOKE, /expectedActiveWindowLabel\(fx\.endsAtIso\)/);
  assert.match(SMOKE, /expectedPeriodLabel\(fx\.startsAtIso, fx\.endsAtIso\)/);
  // A captured expectation would be the stale side of a midnight boundary.
  assert.match(SMOKE, /async function textEqualsLive\(locator, compute,/);
  assert.match(SMOKE, /\(text\) => text\.trim\(\) === compute\(\)/);
});

test('the member-facing copy matches the approved UI', () => {
  for (const kept of [
    "textEquals(member.getByTestId('wsf-contribute-own-credit'), 'Your total on this goal: 137 squats')",
    "textEquals(member.getByTestId('wsf-contribute-shared-total'), '137 of 5,000 squats')",
    "textEquals(state, 'Public display is not authorized for this goal.')",
    "textContains(state, 'Public display is authorized for this goal.')",
    "textContains(champion.getByTestId('wsf-goal-display-auth-confirmed-absent'), 'Public display has been removed')",
  ]) assert.ok(SMOKE.includes(kept), `missing: ${kept}`);
});

test('the Champion-only boundary covers the surface that now carries the controls', () => {
  assert.match(SMOKE, /getByTestId\(`wsf-goal-display-auth-\$\{goalId\}`\)\.count\(\)\) === 0/);
  assert.match(SMOKE, /getByTestId\('wsf-community-manage'\)\.count\(\)\) === 0/);
});

/**
 * D-5 and D-1. Two cases that reach parts of the deployed system nothing else
 * in this suite touches: the Firestore ruleset (which every callable path
 * bypasses) and the signup gate (which every other case skips by minting its
 * accounts through the admin API). Both handle material the run must not keep.
 */
test('both new cases exist and are registered in the suite', () => {
  for (const name of ['clientReadGroup', 'caseD5MembershipStatusRules', 'caseD1SignupGate']) {
    assert.ok(SMOKE.includes(`async function ${name}(`), `${name} is missing`);
  }
  const main = SMOKE.slice(SMOKE.indexOf('browser = await chromium.launch('));
  for (const call of ["await isolated('membership status rules (D-5)', () => caseD5MembershipStatusRules());", 'await caseD1SignupGate(browser);']) {
    assert.ok(main.includes(call), `the suite never runs ${call}`);
  }
  for (const name of ['membership status rules (D-5)', 'signup verification gate (D-1)']) {
    assert.ok(SMOKE.includes(`check('${name}', 'PASS'`), `check ${name} missing`);
  }
});

test('the D-5 read is made with an end-user ID token, never the admin OAuth token', () => {
  const fn = SMOKE.slice(
    SMOKE.indexOf('async function clientReadGroup('),
    SMOKE.indexOf('async function caseD5MembershipStatusRules(')
  );
  assert.match(fn, /bearer: idToken/, 'the client read must carry the member\u2019s own ID token');
  assert.equal(/oauth:\s*true/.test(fn), false, 'a rules assertion must not be made on admin privilege');
  // The two identities are kept apart at the transport, not by convention.
  assert.match(SMOKE, /if \(oauth && bearer\) throw new Error/);
  const body = fnBody('caseD5MembershipStatusRules');
  assert.match(body, /signInToken\(fx\.member\)/);
  assert.match(body, /signInToken\(fx\.outsider\)/);
  assert.equal(/oauth:\s*true/.test(body), false, 'the case itself must not read the group with the admin token');
});

test('D-5 uses the membership status strings the product writes, and names the cause when they are not enforced', () => {
  assert.match(SMOKE, /const MEMBERSHIP_ACTIVE = 'active';/);
  assert.match(SMOKE, /const MEMBERSHIP_REMOVED = 'removed';/);
  assert.match(SMOKE, /const MEMBERSHIP_DEPARTED = 'departed';/);
  const body = fnBody('caseD5MembershipStatusRules');
  assert.match(body, /\[MEMBERSHIP_REMOVED, MEMBERSHIP_DEPARTED\]/);
  assert.match(
    body,
    /staging ruleset is not status-aware \(D-5 rules not deployed to \$\{PROJECT_ID\}\)/,
    'a 200 on a non-active membership must name its cause'
  );
  // The refusal is pinned to the verdict, not merely to "not 200".
  assert.match(body, /=== 403 && after\.body\?\.error\?\.status === 'PERMISSION_DENIED'/);
  assert.match(body, /asOutsider\.status === 403 && asOutsider\.body\?\.error\?\.status === 'PERMISSION_DENIED'/);
});

test('the join code is asserted by existence only and never emitted', () => {
  const lines = SMOKE.split('\n');
  let seen = 0;
  lines.forEach((line, i) => {
    if (!/joinCode/i.test(line)) return;
    seen += 1;
    assert.equal(
      /console\.|diagnostics\.push|results\.push|check\(|snap\(|writeFileSync/.test(line),
      false,
      `line ${i + 1} carries a join code into output`
    );
    assert.equal(
      /(?:const|let|var)\s+\w+\s*=[^=].*joinCode/.test(line),
      false,
      `line ${i + 1} reads the join code into a variable`
    );
  });
  assert.ok(seen > 0, 'the join code assertions disappeared');
  assert.match(SMOKE, /fields\?\.joinCode !== undefined/, 'the 200 case must assert presence, not value');
  assert.match(SMOKE, /REDACTED_JOIN_CODE/, 'sanitize must redact a join code out of any diagnostic');
});

test('the signup gate case sends no mail and owns the account it creates', () => {
  const body = fnBody('caseD1SignupGate');
  assert.match(body, /route\('\*\*\/wsfSendVerificationEmail'/, 'the send callable must be routed');
  assert.match(body, /status: 503/);
  assert.equal(/route\.continue\(\)/.test(body), false, 'the send callable must never be allowed through');
  // cleanup-synthetic.mjs validates an Auth account by its address before it
  // will delete it, so the address shape is part of the cleanup contract.
  assert.match(body, /`wsf-\$\{suffix\}@example\.com`/);
  assert.match(body, /\$\{runTag\}-d1signup-/);
  assert.match(body, /trackUser\(uid\)/);
  assert.match(body, /synthetic\.users\.push\(uid\)/);
  // The lookup runs in a finally, so a failed gate assertion still hands the
  // account to cleanup.
  assert.ok(body.indexOf('} finally {') < body.indexOf('trackUser(uid)'), 'the account must be tracked from a finally');
});

test('the D-1 gate is asserted to HOLD, not merely to appear', () => {
  const body = fnBody('caseD1SignupGate');
  assert.match(body, /getByTestId\('wsf-signup-displayName'\)/);
  assert.match(body, /getByTestId\('wsf-signup-email'\)/);
  assert.match(body, /getByTestId\('wsf-signup-password'\)/);
  assert.match(body, /getByTestId\('wsf-signup-submit'\)\.click\(\)/);
  assert.match(body, /visible\(page\.getByTestId\('wsf-verify'\), 30_000\)/);
  assert.match(body, /staysAbsent\(page\.getByTestId\('wsf-signup'\), 6_000\)/);
  assert.match(body, /page\.url\(\)\.includes\('\/verify-email'\)/);
});

test('the untouched cases still carry their acceptance checks', () => {
  for (const name of ['round-trip display authorization', 'display session lifecycle', 'closed-goal authorization lifecycle',
    'legacy challenge pulse boundary', 'protected own-credit read', 'former Member history and replay',
    'stale-response admission control', 'explicit fresh-session recovery', 'correct staging build', 'targeted synthetic cleanup']) {
    assert.ok(SMOKE.includes(`check('${name}', 'PASS'`), `check ${name} missing`);
  }
});

console.log(`\nhosted-smoke-contract: ${passed} passed`);

test('the D-5 verdict is isolated: its failure is its own row and cannot stop the D-1 gate check or the visual proof', () => {
  const main = SMOKE.slice(SMOKE.indexOf('browser = await chromium.launch('));
  const d5 = main.indexOf("await isolated('membership status rules (D-5)', () => caseD5MembershipStatusRules());");
  const d1 = main.indexOf('await caseD1SignupGate(browser);');
  const visual = main.indexOf('await caseVisualProof(browser);');
  assert.ok(d5 >= 0, 'D-5 is not run through isolated()');
  assert.ok(d1 > d5 && visual > d1, 'D-1 and the visual proof must run after the isolated D-5 case');
  assert.ok(!/\n\s*await caseD5MembershipStatusRules\(\);/.test(main), 'D-5 is still run bare somewhere in the suite');
  const iso = SMOKE.slice(SMOKE.indexOf('async function isolated('), SMOKE.indexOf('async function verifyHostedBuild('));
  assert.ok(iso.includes("check(name, 'FAIL'"), 'an isolated failure must still be a FAIL row');
  assert.ok(iso.includes('diagnostics.push('), 'an isolated failure must keep its diagnostics');
  // Only D-5 is isolated: every other case still aborts the suite.
  assert.strictEqual((main.match(/await isolated\(/g) || []).length, 1, 'isolated() must wrap exactly one case');
});

test('the visual proof captures every owner-required surface on a phone, the display wide, from a synthetic fixture it owns', () => {
  const body = SMOKE.slice(SMOKE.indexOf('async function caseVisualProof('), SMOKE.indexOf('async function isolated('));
  assert.ok(body.includes("seedFixture('visual'"), 'the visual proof must use its own run-tagged synthetic fixture');
  const shots = {
    champion: ['10-phone-champion-manage-authorized'],
    member: ['11-phone-community-home', '12-phone-contribution-entry', '13-phone-contribution-review', '14-phone-contribution-confirmed'],
    displayPhone: ['15-phone-public-display'],
    displayWide: ['16-wide-authorized-display'],
  };
  for (const [page, names] of Object.entries(shots)) {
    for (const name of names) assert.ok(body.includes(`snap(${page}, '${name}')`), `${name} missing on ${page}`);
  }
  assert.ok(SMOKE.includes('viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true'), 'the phone context is not a realistic phone');
  assert.ok(SMOKE.includes('viewport: { width: 1280, height: 800 }'), 'the wide context is missing');
  for (const ctx of ['championCtx', 'memberCtx', 'displayPhoneCtx']) assert.ok(body.includes(`const ${ctx} = await browser.newContext(PHONE_CONTEXT);`), `${ctx} is not a phone`);
  assert.ok(body.includes('const displayWideCtx = await browser.newContext(WIDE_CONTEXT);'), 'the wide display is not wide');
  // Every capture is of an asserted state, not a hopeful screenshot.
  assert.ok(body.includes("textEquals(member.getByTestId('wsf-contribute-shared-total'), '25 of 5,000 squats'"), 'the confirmed capture is not asserted');
  assert.ok(body.includes("textEquals(displayPhone.getByTestId('wsf-display-shared-total'), '25'"), 'the phone display capture is not asserted');
  assert.ok(body.includes("textEquals(displayWide.getByTestId('wsf-display-shared-total'), '25'"), 'the wide display capture is not asserted');
  assert.ok(body.includes("assert((await readAuthorization(goalId)) === true"), 'the authorization behind the display captures is not confirmed in stored state');
  // The one contribution the browser records is owned by cleanup.
  assert.ok(body.includes("member.route('**/wsfContribute'"), 'the attempt id is not read off the request');
  assert.ok(body.includes('trackDoc(`wsfContributions/${goalId}_${fx.member.uid}_${attemptId}`)'), 'the contribution is not tracked for cleanup');
  assert.ok(body.includes('trackDoc(`wsfGoalMemberTotals/${goalId}_${fx.member.uid}`)'), 'the member total is not tracked for cleanup');
  assert.ok(body.includes("check('visual proof captures', 'PASS'"), 'the visual proof has no PASS row');
  assert.ok(SMOKE.includes('await caseVisualProof(browser);'), 'the suite never runs the visual proof');
});
