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
  // W8 reads the URL the QR encodes, whose tail IS the code. It is held only
  // to compare, never printed raw: the one place it reaches a message is
  // through sanitize(), which redacts the /join/<code> shape as well.
  const qrLines = lines.filter((line) => /qrUrl/.test(line));
  assert.ok(qrLines.length > 0, 'the W8 QR URL read disappeared');
  for (const line of qrLines) {
    assert.equal(/console\.|diagnostics\.push|results\.push|check\(|snap\(|writeFileSync/.test(line), false, `a QR URL line carries the join link into output: ${line.trim()}`);
    if (/\$\{[^}]*qrUrl/.test(line)) assert.match(line, /\$\{sanitize\(qrUrl\)\}/, 'the QR URL may only enter a message through sanitize()');
  }
  assert.ok(SMOKE.includes("'/join/[REDACTED_JOIN_CODE]'"), 'sanitize must redact the /join/<code> tail of a join link');
});

test('W8 seeds a link-joinable community and proves WHICH link the QR encodes, with the member still seeing neither QR nor Manage', () => {
  const w478 = fnBody('caseW4W7W8Browser');
  // The product draws the join QR only for a link-joinable policy
  // (apps/westayfit/src/ui/joinLink.ts LINK_JOINABLE_POLICIES = public |
  // inviteOnly); run 35370740710 waited on a QR the product correctly never
  // renders for the private fixture default. Only this row opts in.
  assert.match(SMOKE, /async function seedFixture\(label, goals = 1, includeChallenge = false, \{ joinPolicy = 'private' \} = \{\}\)/, 'seedFixture must default to private and take the policy as an option');
  assert.ok(w478.includes("seedFixture('w478', 2, false, { joinPolicy: 'inviteOnly' })"), 'the W4/W7/W8 fixture must be seeded inviteOnly');
  assert.equal(SMOKE.split("joinPolicy: 'inviteOnly'").length - 1, 1, 'only the W4/W7/W8 row seeds a link-joinable community');
  assert.equal(/joinPolicy: 'public'/.test(SMOKE), false, 'no fixture is seeded public');
  // A code the server would admit: normalizeJoinCode (functions-westayfit)
  // requires 16–128 base64url characters; 16 random bytes encode to 22.
  assert.ok(SMOKE.includes("joinCode: crypto.randomBytes(16).toString('base64url')"), 'the fixture join code must have the shape normalizeJoinCode accepts');
  // The member assertions are unchanged and run against the SAME inviteOnly
  // fixture, so "no QR / no Manage" is proven on a community that has a link.
  const seed = w478.indexOf("seedFixture('w478'");
  for (const kept of [
    "assert((await member.getByTestId('wsf-community-qr-section').count()) === 0, 'A member can see the Champion join QR section');",
    "assert((await member.getByTestId('wsf-community-manage').count()) === 0, 'A member has the Manage surface');",
  ]) {
    assert.ok(w478.includes(kept), `member assertion lost: ${kept}`);
    assert.ok(w478.indexOf(kept) > seed, 'the member assertions must run against the inviteOnly fixture');
  }
  // Section -> block -> toggle -> symbol -> the URL it encodes, in that order,
  // compared exactly against the link the product builds for the staging
  // origin from the fixture's own code (src/ui/joinLink.ts buildJoinUrl).
  const steps = [
    "await openManage(champion);",
    "await visible(champion.getByTestId('wsf-community-qr-section'));",
    "await visible(champion.getByTestId('wsf-community-qr'));",
    "await champion.getByTestId('wsf-community-qr-toggle').click();",
    "await visible(champion.getByTestId('wsf-community-qr-symbol'));",
    "const qrUrl = await champion.getByTestId('wsf-community-qr-symbol').getAttribute('data-qr-url');",
    "assert(qrUrl === `${BASE_URL}/join/${fx.joinCode}`,",
    "await snap(champion, '19-phone-champion-join-qr-w8');",
  ];
  let last = -1;
  for (const step of steps) {
    const at = w478.indexOf(step);
    assert.ok(at !== -1, `W8 step missing: ${step}`);
    assert.ok(at > last, `W8 step out of order: ${step}`);
    last = at;
  }
  // No swallowed assertion and no faked visibility: the only catch in the
  // row is the context close in finally, and nothing pokes the DOM.
  const w478Code = w478.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.equal(/catch\s*\([^)]*\)\s*\{/.test(w478Code), false, 'the W8 assertions must not sit inside a catch block');
  assert.equal(/\.evaluate\(|force:\s*true|style\.display|addStyleTag|-unavailable/.test(w478Code), false, 'the QR must be seen as the product renders it');
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
  const isolatedNames = [...main.matchAll(/await isolated\('([^']+)'/g)].map((m) => m[1]);
  assert.deepStrictEqual(isolatedNames, [
    'station callable transport',
    'public dynamic route reload',
    'hosted turn-service contract',
    'membership status rules (D-5)',
    'recent public additions (W2)', 'repeat policy (W3)', 'target-crossing event (W5)', 'durable history (W6)',
    'guided rules, share + momentum, join QR (W4/W7/W8)', 'kiosk mode (W9)',
  ], 'only the station transport row, the route-reload row, the turn-contract row, D-5 and the candidate B rows are isolated; every Package E case still aborts the suite');
  assert.ok(main.indexOf("isolated('recent public additions (W2)'") > main.indexOf('await caseVisualProof(browser);'), 'the candidate B rows run after the Package E, D-5, D-1 and visual rows');
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


test('the candidate B hosted rows exist, each own their synthetic writes, and prove what they claim', () => {
  for (const name of ['caseW2RecentAdditions', 'caseW3RepeatPolicy', 'caseW5ReachedState', 'caseW6History', 'caseW4W7W8Browser', 'caseW9Kiosk']) {
    assert.ok(SMOKE.includes(`async function ${name}(`), `${name} is missing`);
  }
  const helper = SMOKE.slice(SMOKE.indexOf('function trackContribution('), SMOKE.indexOf('async function contributeAs('));
  for (const doc of ['wsfContributions/${goalId}_${uid}_${attemptId}', 'wsfGoalMemberTotals/${goalId}_${uid}', 'wsfGoals/${goalId}/recentAdditions/${attemptId}']) {
    assert.ok(helper.includes('trackDoc(`' + doc + '`)'), `contributions must track ${doc}`);
  }
  const w2 = fnBody('caseW2RecentAdditions');
  assert.ok(w2.includes("callFunction('wsfGoalRecentAdditions', { goalId: authorized })"), 'W2 must call the new callable anonymously');
  assert.ok(w2.includes("=== 'amount,at,unit'"), 'W2 must pin the addition shape exactly');
  assert.ok(w2.includes('isNotFound(refused)'), 'W2 must prove the generic refusal on an unauthorized goal');
  const w3 = fnBody('caseW3RepeatPolicy');
  assert.ok(w3.includes("a2.body?.error?.status === 'FAILED_PRECONDITION'"), 'W3 must prove the once refusal');
  assert.ok(w3.includes('ownCredit === 7'), 'W3 must prove absent = multiple');
  const w5 = fnBody('caseW5ReachedState');
  assert.ok(w5.includes("'nullValue' in goal.reachedAttemptId"), 'W5 must prove no attempt is credited');
  assert.ok(w5.includes('crossedTarget !== true'), 'W5 must prove no member is told they crossed');
  const w6 = fnBody('caseW6History');
  assert.ok(w6.includes('includeHistory: true') && w6.includes('isNotFound(outsider)') && w6.includes('isNotFound(pulse)'), 'W6 must prove the gate and the untouched pulse');
  const w9 = fnBody('caseW9Kiosk');
  assert.ok(w9.includes("readAuthRecords(page)).some((k) => k.startsWith('firebase:authUser:'))"), 'W9 must read the real auth persistence');
  assert.ok(w9.includes('trackContribution(goalId, fx.member.uid, attemptId)'), 'W9 must own the kiosk contribution');
  const w478 = fnBody('caseW4W7W8Browser');
  assert.ok(w478.includes("getByTestId('wsf-community-qr-section').count()) === 0"), 'W8 must prove the member has no QR section');
  assert.ok(w478.includes('/medical|doctor|diagnos|injur|treat/i'), 'W4 must check for medical wording');
});

/**
 * The station transport row. The hole it closes is the one nothing else in
 * this file could have caught: a green hosted run that never called a station
 * callable at all. These assertions exist so a later edit cannot quietly undo
 * it — by widening the probe set onto the three Champion-only callables (where
 * a refusal proves nothing), by softening the verdict into something that
 * cannot fail, or by giving a probe a payload that WRITES.
 */
const STATION_PROBE_BLOCK = SMOKE.slice(
  SMOKE.indexOf('const STATION_REJECTED_MESSAGE'),
  SMOKE.indexOf('async function caseStationTransport(')
);
const PUBLIC_STATIONS = ['wsfStationRequestPairing', 'wsfStationPairingStatus', 'wsfStationClaimPairing', 'wsfStationState'];
const CHAMPION_ONLY_STATIONS = ['wsfApproveStation', 'wsfListStations', 'wsfRevokeStation'];

test('the station transport row exists, runs first, and is isolated rather than able to abort the suite', () => {
  assert.ok(SMOKE.includes('async function caseStationTransport('), 'caseStationTransport is missing');
  assert.ok(SMOKE.includes("check('station callable transport', 'PASS'"), 'the station row has no PASS row');
  const main = SMOKE.slice(SMOKE.indexOf('browser = await chromium.launch('));
  const station = main.indexOf("await isolated('station callable transport', () => caseStationTransport());");
  assert.ok(station !== -1, 'the suite never runs the station transport row');
  assert.ok(station > main.indexOf('await verifyHostedBuild();'), 'the build check still runs first');
  assert.ok(station < main.indexOf('await caseRoundTrip(browser);'), 'the station row must run before the cases that can abort the suite');
  assert.ok(!/\n\s*await caseStationTransport\(\);/.test(main), 'the station row is still run bare somewhere');
});

test('exactly the four invoker:public station callables are probed, and the three Champion-only ones are not', () => {
  const probed = [...STATION_PROBE_BLOCK.matchAll(/name: '(wsf[A-Za-z]+)'/g)].map((m) => m[1]);
  assert.deepStrictEqual(probed, PUBLIC_STATIONS, 'the probe list is not exactly the four unauthenticated-by-design callables');
  for (const name of CHAMPION_ONLY_STATIONS) {
    assert.equal(
      new RegExp(`callFunction\\('${name}'|name: '${name}'`).test(SMOKE),
      false,
      `${name} is not invoker:'public'; an anonymous refusal of it cannot fail for the right reason, so it must not be probed`
    );
  }
  // The omission is stated in the receipt, not silently carried.
  assert.match(SMOKE, /The three Champion-only station callables \(wsfApproveStation, wsfListStations, wsfRevokeStation\) are NOT probed/);
});

test('no station probe can create anything on staging, and none carries a credential-shaped value', () => {
  // wsfStationRequestPairing is the only one that writes, and it validates
  // goalId before it touches Firestore: a payload with no goalId is refused
  // before a wsfKioskPairings document exists.
  assert.match(STATION_PROBE_BLOCK, /\{ name: 'wsfStationRequestPairing', data: \{\} \}/, 'the pairing request probe must carry no goalId');
  // wsfStationState refuses before it reads or rewrites a station document
  // when it is handed no secret; sending one would also put a credential-
  // shaped value on the wire.
  assert.match(STATION_PROBE_BLOCK, /\{ name: 'wsfStationState', data: \{ stationId: STATION_PROBE_ID \} \}/, 'the state probe must send a station id and no secret');
  assert.equal(/secret:/.test(STATION_PROBE_BLOCK), false, 'no station probe may send a secret');
  assert.equal(/code:|joinCode|pairingCode/.test(STATION_PROBE_BLOCK), false, 'no station probe may send a pairing or join code');
  // The ids are run-tagged and obviously synthetic, never a minted id.
  assert.match(SMOKE, /const STATION_PROBE_ID = `wsfsmoke-absent-\$\{runTag\}`;/);
  const body = fnBody('caseStationTransport');
  assert.equal(/trackDoc\(|trackUser\(|putDoc\(|seedFixture\(/.test(body), false, 'the station row must create nothing, so it has nothing to track');
  // The rate-limit counter the callables write for themselves is disclosed.
  assert.match(SMOKE, /wsfStationRateLimits\/<salted daily IP hash>/);
});

test('the station verdict names the service and status, and the only 403 it forgives is the handler’s own refusal', () => {
  const verdict = SMOKE.slice(
    SMOKE.indexOf('function stationTransportVerdict('),
    SMOKE.indexOf('async function caseStationTransport(')
  );
  // Same sentence W2 uses, so a failure reads the same way.
  assert.match(verdict, /\$\{name\} is not publicly invokable on staging: HTTP \$\{response\.status\} \(transport\)/);
  assert.match(SMOKE, /wsfGoalRecentAdditions is not publicly invokable on staging: HTTP \$\{anon\.status\} \(transport\)/, 'the W2 sentence this one follows disappeared');
  assert.match(verdict, /response\.status !== 401 && response\.status !== 403/, 'a 401 or a 403 is the failure, exactly as in W2');
  // wsfStationState's correct anonymous answer IS a 403, so status alone would
  // make its check unable to pass for the right reason. The narrow exception
  // is the handler's own sentence, which the transport cannot produce.
  assert.match(verdict, /response\.status === 403 &&/);
  assert.match(verdict, /error\.status === 'PERMISSION_DENIED'/);
  assert.match(verdict, /error\.message === STATION_REJECTED_MESSAGE/);
  assert.match(SMOKE, /const STATION_REJECTED_MESSAGE = 'This screen is not enrolled\.';/);
  const body = fnBody('caseStationTransport');
  // Not softened: no catch, no skip, no advisory status, and every probe runs.
  assert.equal(/catch\s*\(|'WARN'|'SKIP'|'ADVISORY'/.test(body), false, 'the station row must not swallow or downgrade its own failure');
  assert.match(body, /assert\(refused\.length === 0, refused\.join\('; '\)\)/, 'every closed door must be named, not just the first');
  assert.ok(body.indexOf('assert(refused.length === 0') < body.indexOf("check('station callable transport', 'PASS'"), 'the PASS row must come after the assertion');
});

/**
 * One case's source, and only that case's.
 *
 * Slicing to a fixed later function (`isolated`) made each case's assertions
 * depend on nothing being inserted between the two — so adding a case made a
 * DIFFERENT case's test fail, on an assertion about code that was not its own.
 * Ending at the next top-level async function keeps each slice to its subject.
 */
function caseSource(name) {
  const start = SMOKE.indexOf(`async function ${name}(`);
  if (start < 0) return '';
  const next = SMOKE.indexOf('\nasync function ', start + 1);
  return next < 0 ? SMOKE.slice(start) : SMOKE.slice(start, next);
}

test('the public dynamic route reload proves the ROUTE resolved, on absent ids, without writing anything', () => {
  const body = caseSource('caseDynamicRouteReload');
  assert.ok(body, 'there is no caseDynamicRouteReload');

  // The two routes nothing else in this suite loads. Named, so quietly
  // dropping one is a failure rather than a smaller probe list.
  const probes = SMOKE.slice(
    SMOKE.indexOf('const DYNAMIC_ROUTE_PROBES'),
    SMOKE.indexOf('async function caseDynamicRouteReload(')
  );
  assert.ok(probes.includes("route: '/combined'"), '/combined is not probed');
  assert.ok(probes.includes("route: '/station'"), '/station is not probed');
  assert.ok(probes.includes("title: 'Combined goal'"), 'the combined probe has no expected title');
  assert.ok(probes.includes("title: 'Station'"), 'the station probe has no expected title');

  // A 200 is not the assertion. Firebase Hosting answers an unmatched path
  // with a document of its own, so a status-only check would pass on a 404
  // page and on a neighbouring route's document alike.
  assert.ok(body.includes('status !== 200'), 'the row does not check the status at all');
  assert.ok(body.includes('<title>'), 'the row does not read the served document title, so it cannot tell which route answered');
  assert.ok(
    body.includes('!title.includes(probe.title)'),
    'the row does not compare the served title against the route it asked for'
  );

  // Absent, run-tagged ids: this must neither depend on real data existing
  // nor be able to create any.
  assert.ok(body.includes('wsfsmoke-absent-'), 'the probe ids are not absent and run-tagged');
  assert.ok(!/method:\s*'POST'/.test(body), 'a route reload must not POST');
  assert.ok(!body.includes('trackDoc('), 'the route reload must create nothing to clean up');
  assert.ok(!body.includes('callFunction('), 'the route reload must not call a callable; it is a Hosting check');

  // Every probe runs, and the PASS row comes after the assertion — the same
  // two properties the station transport row is held to.
  assert.match(body, /assert\(refused\.length === 0, refused\.join\('; '\)\)/, 'every unresolved route must be named, not just the first');
  assert.ok(
    body.indexOf('assert(refused.length === 0') < body.indexOf("check('public dynamic route reload', 'PASS'"),
    'the PASS row must come after the assertion'
  );
  assert.ok(body.includes('continue;'), 'one unreachable route must not hide the other');

  // And the receipt bounds what the row establishes.
  assert.ok(
    SMOKE.includes('The public dynamic route reload row proves only that Hosting resolves'),
    'the receipt does not bound what the route-reload row establishes'
  );
});

test('the hosted turn-service row drives the real journey with real identities, and separates transport from refusal', () => {
  const body = caseSource('caseTurnContract');
  assert.ok(body, 'there is no caseTurnContract');

  // Every callable the journey needs. Named individually, because a row that
  // quietly stopped exercising one of these would still look like a pass.
  for (const name of [
    'wsfCreateCombinedGoal', 'wsfStationRequestPairing', 'wsfApproveStation',
    'wsfStationClaimPairing', 'wsfStationState', 'wsfEventContext',
    'wsfMyTurn', 'wsfJoinTurnLine', 'wsfLeaveTurnLine', 'wsfCallNext', 'wsfTurnReady',
    'wsfStartTurn', 'wsfCompleteMyTurn', 'wsfCompleteTurn', 'wsfGoalPulse',
    'wsfCombinedGoalPulse',
  ]) {
    assert.ok(body.includes(`'${name}'`), `the turn row never calls ${name}`);
  }

  // TWO stations, and an approval step between asking and claiming.
  assert.ok(/for \(const slot of \[1, 2\]\)/.test(body), 'the row does not enrol two stations');
  assert.ok(body.includes('two stations were handed the same turn'), 'the row does not test claim exclusion');

  // The participant is a DIFFERENT identity from the Champion, and a third
  // identity proves the ready gate. Three tokens, three people.
  assert.ok(body.includes('championToken'), 'no Champion identity');
  assert.ok(body.includes('memberToken'), 'no participant identity');
  // Not merely that the token EXISTS — mutation-testing caught that: deleting
  // the call that uses it left the declaration behind and this passed. What
  // must be true is that the outsider is actually pointed at the ready gate.
  assert.ok(
    /wsfTurnReady'[^;]*outsiderToken/.test(body),
    'the ready gate is never exercised with an identity that is not the assigned participant'
  );
  // AND that the refusal is the product's INTENDED one. Any handler-shaped
  // error would pass before: an invalid-argument, a failed-precondition, a
  // rate limit. Only the generic not-found proves an entryId does not reveal
  // whose place it is.
  assert.match(SMOKE, /const TURN_GENERIC_REFUSAL = 'This link is not valid\.';/);
  assert.ok(
    body.includes("error?.status === 'NOT_FOUND'"),
    'the outsider refusal is not pinned to the generic not-found verdict'
  );
  assert.ok(
    body.includes('=== TURN_GENERIC_REFUSAL'),
    'the outsider refusal is not pinned to the generic sentence'
  );

  // LOOKING IS NOT JOINING, asserted before the join rather than after.
  assert.ok(
    body.indexOf('a scan must never enqueue') < body.indexOf("'join the line'"),
    'the row must prove the line is empty BEFORE it joins, or it proves nothing'
  );

  // SWITCH TO PHONE frees the event place, proven by the rejoin that follows.
  assert.ok(
    body.includes('switchingToPhone: true'),
    'the row never exercises switching to your own phone'
  );
  assert.ok(
    body.includes('the place was not freed when the participant switched to their own phone'),
    'the row does not prove that leaving actually frees the place'
  );

  // THE 45-SECOND LEASE IS WAITED OUT. A lease cannot be proven from a
  // response shape, so this row spends the real time.
  assert.match(SMOKE, /const TURN_LEASE_MS = 45_000;/);
  assert.ok(
    /setTimeout\(resolve, TURN_LEASE_MS \+ /.test(body),
    'the row never waits past the ready lease, so it cannot prove the lease expires'
  );
  assert.ok(
    body.includes('the 45-second lease expired and the phone is still holding a live turn'),
    'the row does not assert the turn is gone after the lease'
  );
  assert.ok(
    body.includes('a lapsed turn was handed back instead of recovering the place'),
    'the row does not prove the place is RECOVERED, only that the turn vanished'
  );

  // THE TEN-SECOND RESULT IS WAITED OUT TOO, and proven to disappear.
  assert.match(SMOKE, /const TURN_RESULT_MS = 10_000;/);
  assert.ok(
    /setTimeout\(resolve, TURN_RESULT_MS \+ /.test(body),
    'the row reads the result immediately and never waits past the window'
  );
  assert.ok(
    body.includes('the ten-second result is still on the screen after the window closed'),
    'the row does not prove the result expires'
  );

  // PHONE COMPLETION, and idempotency on BOTH surfaces.
  //
  // Each step is pinned to the callable it must actually use. Asserting on
  // the failure message alone was not enough — mutation-testing swapped the
  // retry's callable for wsfMyTurn and the message, and the name's presence
  // elsewhere in the row, both survived. This is the second time that exact
  // shape of weak assertion has turned up here.
  for (const [step, name] of [
    ['record the turn from the phone', 'wsfCompleteMyTurn'],
    ['retry from the phone', 'wsfCompleteMyTurn'],
    ['retry at the screen', 'wsfCompleteTurn'],
    ['leave the line for my own phone', 'wsfLeaveTurnLine'],
  ]) {
    assert.ok(
      body.includes(`'${step}', '${name}'`),
      `the "${step}" step does not call ${name}`
    );
  }
  assert.ok(body.includes('a phone retry recorded a second time'), 'phone idempotency is not asserted');
  assert.ok(
    body.includes('the screen recorded a second time what the phone had already recorded'),
    'cross-surface idempotency is not asserted'
  );

  // The arithmetic, including the activity nobody chose.
  assert.ok(body.includes('the activity nobody chose moved to'), 'the unchosen child is not asserted unchanged');
  assert.ok(body.includes('the combined parent holds'), 'the combined parent is not asserted');
  // Run 30 read the CHILD's field name off the PARENT and got undefined.
  // wsfGoalPulse returns sharedTotal; wsfCombinedGoalPulse returns
  // combinedTotal — the setup's own shards since activation, which is a
  // different quantity, not a synonym.
  assert.ok(
    /parent\?\.combinedTotal === TURN_COUNT/.test(body),
    'the combined parent must be read as combinedTotal, not sharedTotal'
  );
  assert.equal(
    /parent\?\.sharedTotal/.test(body),
    false,
    'sharedTotal is the child pulse field; reading it off the parent yields undefined'
  );
  // And the other half of the same contract: the CHILD pulses must keep
  // reading sharedTotal. Pinning only the parent would let a later edit
  // "fix" the children to combinedTotal and get undefined in the other
  // direction.
  assert.ok(
    /chosen\?\.sharedTotal === TURN_COUNT/.test(body),
    'the chosen child must be read as sharedTotal (wsfGoalPulse)'
  );
  assert.ok(
    /untouched\?\.sharedTotal === 0/.test(body),
    'the unchosen child must be read as sharedTotal (wsfGoalPulse)'
  );
  assert.equal(
    /(chosen|untouched)\?\.combinedTotal/.test(body),
    false,
    'combinedTotal is the parent field; reading it off a child yields undefined'
  );

  // THE TEN-SECOND READ MUST COME BEFORE THE ARITHMETIC.
  //
  // Run 31 failed with "no result at all" because the row spent three more
  // round-trips — two goal pulses and the combined pulse — inside the very
  // ten-second window it was about to measure. The product stamps
  // lastResult.atMillis at the last completion and serves the result only
  // while now - atMillis < TURN_RESULT_VISIBLE_MS, so a row that reads the
  // pulses first is timing staging, not testing the window.
  const stationRead = body.indexOf("'station state after recording'");
  const firstPulse = body.indexOf("'chosen activity pulse'");
  const combinedPulse = body.indexOf("'combined pulse'");
  assert.notEqual(stationRead, -1, 'the row no longer reads the station state after recording');
  assert.notEqual(firstPulse, -1, 'the row no longer reads the chosen activity pulse');
  assert.notEqual(combinedPulse, -1, 'the row no longer reads the combined pulse');
  assert.ok(
    stationRead < firstPulse && stationRead < combinedPulse,
    'the ten-second station result must be read BEFORE the pulses, or the row spends the window it is measuring'
  );
  // And the failure must say how long it waited, so "the window closed before
  // we looked" can never again be mistaken for "no result was written".
  assert.ok(
    /ms after the last completion returned/.test(body),
    'the ten-second failure does not report the elapsed time, so it cannot separate an expired window from a missing result'
  );
  assert.ok(
    /secondsLeft === 'number' && afterRecord\.result\.secondsLeft > 0/.test(body),
    'the row does not check that the result is served with time left on it'
  );

  // Privacy: a count, never a list, and no identifier of a real person.
  assert.ok(body.includes('waitingCount'), 'the row does not check the waiting count');
  assert.ok(body.includes("the hall disclosed a participant's email"), 'the row does not check for identity disclosure');

  // A closed door and an application refusal are different failures, and the
  // row must say which it hit — otherwise a transport block reads as a bug in
  // the product, which is the exact confusion this suite exists to prevent.
  const verdict = SMOKE.slice(SMOKE.indexOf('function turnCallFailure('), SMOKE.indexOf('async function turnCall('));
  assert.ok(verdict.includes('TRANSPORT'), 'the row cannot name a transport refusal');
  assert.ok(verdict.includes('application'), 'the row cannot name an application refusal');

  // And the PASS row comes last, after every assertion.
  assert.ok(
    body.lastIndexOf('assert(') < body.indexOf("check('hosted turn-service contract', 'PASS'"),
    'the PASS row must come after every assertion'
  );
});

/**
 * Cleanup, which is the half that can leave staging dirty.
 *
 * The turn journey writes documents the SERVER names — Firestore auto-ids and
 * the lineId derived from one. Under cleanup's tag-in-path provenance rule a
 * single untagged path is fatal to the WHOLE manifest: nothing is deleted, for
 * any case in the run. So these documents cannot simply be trackDoc()'d, and
 * a row that tracked none of them was not merely incomplete — it disabled
 * cleanup for the entire suite.
 */
test('every document the turn journey creates is tracked, by the route its id allows', () => {
  const body = caseSource('caseTurnContract');

  // Server-minted: claimed through an identifier this run has already proven.
  for (const [docPath, via] of [
    ['wsfCombinedGoals/${setupId}', 'fx.groupId'],
    ['wsfKioskPairings/${pairing.pairingId}', 'activityA'],
    ['wsfKioskStations/${approved.stationId}', 'activityA'],
    ['wsfTurnEntries/${joined.entryId}', 'activityA'],
    ['wsfTurnLines/${lineId}', 'fx.groupId'],
    ['wsfTurnMembers/${lineId}__${uid}', 'uid'],
    ['wsfTurnReceipts/${lineId}__${uid}', 'uid'],
  ]) {
    assert.ok(
      body.includes('trackLinked(`' + docPath + '`, ' + via + ')'),
      `${docPath} is created but never linked for cleanup`
    );
  }

  // Run-tagged, because they are keyed by the run-tagged goal id.
  for (const docPath of [
    'wsfCombinedGoalClaims/${child}',
    'wsfContributions/${activityA}_${uid}_${attemptId}',
    'wsfGoalMemberTotals/${activityA}_${uid}',
    'wsfGoals/${activityA}/recentAdditions/${attemptId}',
    'wsfCombinedCredits/${activityA}_${uid}_${attemptId}',
    'wsfCombinedCounters/${setupId}/shards/${child}_${shard}',
  ]) {
    assert.ok(body.includes('trackDoc(`' + docPath + '`)'), `${docPath} is created but never tracked for cleanup`);
  }

  // The combined shard index is random, so the row cannot know which one it
  // wrote and must carry all ten — for BOTH children, exactly as seedFixture
  // already does for wsfGoalCounters.
  assert.ok(
    /for \(const child of \[activityA, activityB\]\)/.test(body),
    'the claims and parent shards are not tracked for both children'
  );
  assert.ok(
    /for \(let shard = 0; shard < 10; shard \+= 1\)/.test(body),
    'the parent counter shards are not tracked across all ten indexes'
  );

  // EVERY entry, not just the last: this row joins three times.
  assert.ok(
    body.indexOf('trackLinked(`wsfTurnEntries/') < body.indexOf('return joined;'),
    'entries must be tracked by the shared join helper, so a rejoin cannot go untracked'
  );
  assert.ok((body.match(/await joinLine\(/g) || []).length >= 3, 'the row no longer joins more than once');

  // lineId and attemptId are in NO callable response. They are read off the
  // stored entry — which is also the only honest way to know what to clean.
  assert.ok(
    body.includes('getDoc(`wsfTurnEntries/${first.entryId}`)'),
    'the line is not discovered from the stored entry'
  );
  assert.ok(
    body.includes('fields?.attemptId?.stringValue'),
    'the attempt is not discovered from the stored entry'
  );
  assert.ok(
    body.includes('the entry carries no lineId, so its line cannot be tracked'),
    'a missing lineId must fail the row rather than silently skip its documents'
  );

  // The manifest must actually carry them, or none of the above reaches cleanup.
  assert.match(SMOKE, /function trackLinked\(docPath, via\)/);
  assert.match(SMOKE, /linkedDocs: \[\.\.\.cleanup\.linked\]\.map\(\(\[docPath, via\]\) => \(\{ path: docPath, via \}\)\)/);
});

test('the combined parent is created on the FIXTURE window, never a fresh clock reading', () => {
  // Run 28's only red row. The server enforces child.startsAt >=
  // combined.startsAt; seedFixture stamps the children at ITS now minus 60s,
  // so reading the clock again here put the parent AFTER its own children by
  // however long the seeding took, and the refusal was deterministic. The
  // instants the fixture actually wrote are the only ones that cannot drift.
  const body = caseSource('caseTurnContract');
  const call = body.slice(
    body.indexOf("'create combined goal'"),
    body.indexOf('}, championToken);')
  );
  assert.ok(call, 'the create-combined-goal call is gone');
  assert.ok(call.includes('startsAt: fx.startsAtIso'), 'the parent start is not the fixture\u2019s own instant');
  assert.ok(call.includes('endsAt: fx.endsAtIso'), 'the parent end is not the fixture\u2019s own instant');
  // The clock must not be read for this window at all — not as Date.now(),
  // not as a bare `new Date()`, and not through a variable computed from one.
  assert.equal(/Date\.now\(\)|new Date\(/.test(call), false, 'the parent window is computed from a clock reading');
  assert.equal(
    /const now = Date\.now\(\);/.test(body),
    false,
    'the case still reads the clock; the fixture window is the only safe source'
  );
  // And the fixture must still be the thing that carries those instants.
  assert.match(SMOKE, /startsAtIso: started\.toISOString\(\),/);
  assert.match(SMOKE, /endsAtIso: ends\.toISOString\(\),/);
});

test('the screens are put on a goal whose public display the Champion authorized', () => {
  // Run 29's red row. wsfStationState serves the hall through
  // readGoalPulseTotals(goalId, null) — as nobody — so it is gated on the
  // goal's own aggregateDisplayAuthorized. A station holds no membership, so
  // the member route is not available to it. Enrolling screens on an
  // unauthorized goal cannot work, and the product refusing it is correct.
  const body = caseSource('caseTurnContract');
  assert.ok(
    body.includes('await authorizeDisplay(fx, activityA)'),
    'the row puts screens on a goal whose public display was never authorized'
  );
  // Through the product's own Champion callable, never a direct write.
  const helper = SMOKE.slice(SMOKE.indexOf('async function authorizeDisplay('), SMOKE.indexOf('function trackContribution('));
  assert.match(helper, /callFunction\('wsfSetGoalDisplayAuthorization'/);
  assert.match(helper, /Fixture authorization did not persist/);
  // Before the screens enrol, not after they have already failed to read.
  assert.ok(
    body.indexOf('await authorizeDisplay(fx, activityA)') < body.indexOf('for (const slot of [1, 2])'),
    'the authorization must come before the screens enrol'
  );
  // ONLY the activity the screens are on. The unchosen activity must stay
  // unauthorized, or the arithmetic assertion stops proving a member read.
  assert.equal(
    /authorizeDisplay\(fx, activityB\)/.test(body),
    false,
    'the unchosen activity must not be display-authorized'
  );
});

test('the in-smoke cleanup deletes BOTH registers, not just the tagged one', () => {
  // cleanup.linked is a second register. A cleanupAll() that walked only
  // cleanup.docs would delete the run's own fixtures, leave every
  // server-named document behind, and still print its PASS row — while the
  // always-run recovery cleanup silently did the rest.
  const fn = SMOKE.slice(SMOKE.indexOf('async function cleanupAll('), SMOKE.indexOf('\nlet browser;'));
  assert.ok(fn, 'there is no cleanupAll');
  assert.ok(
    /\[\.\.\.cleanup\.docs, \.\.\.cleanup\.linked\.keys\(\)\]/.test(fn),
    'cleanupAll does not iterate the linked documents, so it cannot have removed them'
  );
  // Deepest first, so a subcollection document goes before its parent.
  assert.match(fn, /\.sort\(\(a, b\) => b\.split\('\/'\)\.length - a\.split\('\/'\)\.length\)/);
  assert.ok(fn.includes('await deleteUsers()'), 'cleanupAll no longer deletes the synthetic accounts');
  // The accounts go AFTER the documents: a uid-linked document is proven by
  // the manifest, not by a live account, but deleting the records first
  // keeps the in-smoke pass honest about what it removed.
  assert.ok(fn.indexOf('await deleteDoc(docPath)') < fn.indexOf('await deleteUsers()'));
});

test('the row and the receipt no longer claim to be end to end', () => {
  assert.equal(/turn contract end to end/.test(SMOKE), false, 'the old end-to-end row name survives');
  assert.ok(SMOKE.includes("check('hosted turn-service contract', 'PASS'"), 'the renamed row has no PASS row');
  assert.ok(
    SMOKE.includes('The hosted turn-service row is a SERVICE contract, not an end-to-end one.'),
    'the receipt does not say what kind of contract this row is'
  );
  assert.ok(
    SMOKE.includes('Independent browser and player proof of the expo journey is a SEPARATE gate'),
    'the receipt does not state that browser and player proof remains a separate gate'
  );
});

test('the green-run row count is pinned, and every row name is distinct', () => {
  const rows = [...SMOKE.matchAll(/check\('([^']+)', 'PASS'/g)].map((m) => m[1]);
  assert.equal(rows.length, 24, `a fully green run emits one row per PASS site; expected 24, found ${rows.length}`);
  assert.equal(new Set(rows).size, rows.length, 'two rows share a name, so RESULTS could not be read back per row');
  assert.ok(rows.includes('station callable transport'), 'the station transport row is not among the green rows');
  assert.match(SMOKE, /console\.log\(`RESULTS=\$\{results\.length\}`\);/);
  assert.match(SMOKE, /A fully green run emits 24 rows/, 'the script must pin the same count the harness does');
});

console.log(`\nhosted-smoke-contract: ${passed} passed`);
