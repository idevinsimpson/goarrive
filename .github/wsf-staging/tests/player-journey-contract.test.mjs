#!/usr/bin/env node
/**
 * The browser/player journey's contract.
 *
 * WHY THIS FILE EXISTS AT ALL. The journey itself cannot run here: it drives
 * browsers against deployed staging, and the player component it asserts on
 * (`apps/westayfit/src/ui/FollowAlongCard.tsx`) does not exist on this branch
 * — it lives only on the approved candidate. So every guarantee this proof is
 * supposed to carry is pinned HERE, in text, where an edit that quietly
 * removes one fails locally instead of on a hosted run nobody wants to spend
 * twice.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const JOURNEY = fs.readFileSync('.github/wsf-staging/hosted-player-journey.mjs', 'utf8');
// The journey is a MODE of the deploy workflow, not a workflow of its own: the
// workload identity provider's attribute condition pins workflow_ref to
// wsf-staging-deploy.yml, so a standalone file could never authenticate
// (FEDERATION-PLAN.md). WORKFLOW is that file's player-journey JOB — the
// assertions below are about the player path, not about the deploy path that
// shares the file.
const WORKFLOW_FILE = fs.readFileSync('.github/workflows/wsf-staging-deploy.yml', 'utf8');
const WORKFLOW = (() => {
  const start = WORKFLOW_FILE.indexOf('\n  player-journey:\n');
  assert.notEqual(start, -1, 'the deploy workflow no longer carries a player-journey job');
  const rest = WORKFLOW_FILE.slice(start + 1);
  const nextJob = /\n {2}[a-z][a-z0-9-]*:\n/.exec(rest.slice(1));
  let block = nextJob ? rest.slice(0, nextJob.index + 1) : rest;
  // A job's banner comment sits ABOVE its `name:` line, so cutting at the next
  // job header carries THAT job's banner into this slice. Every "the player
  // job does not do X" check below is a regex over this text, and a
  // neighbour's prose is not the player job's code — the `cleanup-recovery`
  // banner alone names the journey, the 24-row suite and a deployment. So
  // trailing comment and blank lines are dropped and these checks read the
  // player job and nothing else.
  const lines = block.split('\n');
  while (lines.length && /^\s*(#.*)?$/.test(lines[lines.length - 1])) lines.pop();
  block = lines.join('\n');
  // The slice must be exactly one job, and it must be the right one.
  assert.equal(/\n {2}[a-z][a-z0-9-]*:\n/.test(block.slice(1)), false,
    'the player-journey slice swallowed the job after it');
  assert.ok(/hosted-player-journey\.mjs/.test(block), 'the player-journey slice is not the player job');
  // It must end on the job's own last line — the check that catches a trim
  // which ate into the job itself, or stopped inside somebody else's banner.
  const last = block.split('\n').pop();
  assert.match(last, /\S/, 'the slice ends on a blank line');
  assert.equal(/^\s*#/.test(last), false, 'the slice still ends inside a comment');
  return block;
})();
const SMOKE = fs.readFileSync('.github/wsf-staging/hosted-package-e-smoke.mjs', 'utf8');

test('the journey never claims Safari, and names the engine it actually ran', () => {
  // Every mention of Safari must be a DENIAL of it. Rather than guess at the
  // wording, each occurrence is checked against the words just before it — a
  // sentence that introduced Safari as something this proof covers would have
  // no negation in front of it and would fail here.
  for (const match of JOURNEY.matchAll(/Safari/g)) {
    const before = JOURNEY.slice(Math.max(0, match.index - 80), match.index);
    assert.ok(
      /\b(not|never|NOT|no)\b/i.test(before),
      `"Safari" appears without a denial in front of it: ...${before.slice(-60)}Safari`
    );
  }
  assert.ok(/NOT Safari/.test(JOURNEY), 'the journey does not say plainly that it is not Safari');
  assert.ok(/ENGINE=/.test(JOURNEY), 'the journey does not print the engine it ran');
  assert.ok(/chromium\.launch\(/.test(JOURNEY), 'the journey does not launch Chromium');
  assert.equal(/webkit\.launch\(|firefox\.launch\(/.test(JOURNEY), false,
    'the journey launches an engine it does not name in its receipt');
  assert.ok(/chromium/.test(WORKFLOW) && !/webkit/.test(WORKFLOW),
    'the player job installs an engine the journey does not run');
});

test('the journey disclaims what it cannot prove', () => {
  // A proof that does not say what it is not gets read as proof of everything.
  assert.ok(/verification-EMAIL delivery|verification-email delivery/i.test(JOURNEY),
    'the journey does not disclaim verification-email delivery');
  assert.ok(/preverified/i.test(JOURNEY), 'the journey does not label its identities as preverified fixtures');
  assert.ok(/poster\/fallback|poster pass is a poster pass|authorized movement VIDEO/i.test(JOURNEY),
    'the journey does not disclaim an authorized movement video');
  assert.ok(/opens no browser against the player|says nothing about what/i.test(JOURNEY),
    'the journey does not say why it exists separately from the service suite');
});

test('every document and account is tracked BEFORE the write that creates it', () => {
  const put = JOURNEY.slice(JOURNEY.indexOf('async function putDoc('), JOURNEY.indexOf('const getDoc ='));
  assert.ok(put.indexOf('trackDoc(docPath)') < put.indexOf('jsonRequest('),
    'putDoc writes before it tracks, so a crash mid-write leaks the document');
  const create = JOURNEY.slice(JOURNEY.indexOf('async function createVerifiedUser('), JOURNEY.indexOf('async function signInToken('));
  assert.ok(create.indexOf('trackUser(uid)') < create.indexOf('return { uid'),
    'createVerifiedUser returns before it tracks the account');
  // The server-named documents the journey cannot predict.
  for (const linked of ['wsfCombinedGoals/', 'wsfKioskStations/', 'wsfTurnEntries/', 'wsfTurnLines/', 'wsfTurnMembers/', 'wsfTurnReceipts/']) {
    assert.ok(JOURNEY.includes(`trackLinked(\`${linked}`), `${linked} is never tracked, so cleanup cannot claim it`);
  }
  // The random shard indexes: the journey cannot know which one was written.
  assert.ok(/shard < 10/.test(JOURNEY), 'the journey does not track all ten counter shards');
});

test('the manifest contract is exactly the one cleanup-synthetic enforces', () => {
  const journeyManifest = JOURNEY.slice(JOURNEY.indexOf('function persistCleanup()'), JOURNEY.indexOf('function trackUser('));
  const smokeManifest = SMOKE.slice(SMOKE.indexOf('function persistCleanup()'), SMOKE.indexOf('function trackUser('));
  // Compared rather than eyeballed: these two files write the same file format
  // for the same cleaner, and a silent divergence would not fail anywhere else.
  assert.equal(journeyManifest.trim(), smokeManifest.trim(),
    'the journey writes a different cleanup manifest than the suite the cleaner was built for');
});

test('the redaction rules match the suite that already passes the scanner', () => {
  const journeySanitize = JOURNEY.slice(JOURNEY.indexOf('function sanitize('), JOURNEY.indexOf('async function jsonRequest('));
  for (const rule of ['REDACTED_API_KEY', 'Bearer [REDACTED]', 'SYNTHETIC_EMAIL', 'REDACTED_JOIN_CODE']) {
    assert.ok(journeySanitize.includes(rule), `the journey does not redact ${rule}`);
  }
});

test('the scanned link is read off the screen and carries no authority', () => {
  const body = JOURNEY.slice(JOURNEY.indexOf('async function caseQrLink('), JOURNEY.indexOf('// 2. THE PHONE GETS'));
  assert.ok(/getAttribute\('data-qr-url'\)/.test(body),
    'the link must be read from the served screen, not constructed by the harness');
  for (const forbidden of ['secret', 'token', 'pairing', 'station']) {
    assert.ok(body.includes(`'${forbidden}'`), `the link is not checked for "${forbidden}"`);
  }
  assert.ok(/=== BASE_URL/.test(body), 'the link origin is not checked against staging');
  // Looking is not joining: the line is read before AND after the scan.
  assert.ok(body.indexOf('line before the scan') < body.indexOf('line after the scan'),
    'the journey does not prove the scan left the line untouched');
});

test('two independent participants are actually driven, not just seeded', () => {
  // The acceptance asked for independent phone accounts. Seeding a second
  // account and never opening a browser for it let the two-screen assertion
  // pass for the wrong reason: with one person in the line, the second screen
  // shows NOBODY, and "not showing the first person's code" is true of an
  // empty screen.
  assert.ok(/async function joinSecondPhone\(/.test(JOURNEY), 'the second phone is never driven as a participant');
  // `await` on purpose: the DECLARATION reads `async function
  // joinSecondPhone(browser, fx, qrUrl)`, so a bare name-and-arguments regex
  // matched it and the first version of this check passed with the call site
  // deleted. It is the call that has to exist.
  assert.ok(/await joinSecondPhone\(/.test(JOURNEY), 'the second phone is defined but never called');
  const mainBody = JOURNEY.slice(JOURNEY.indexOf('async function main('));
  assert.ok(/await joinSecondPhone\(/.test(mainBody), 'the second phone is never driven from the run itself');
  assert.ok(
    /caseTwoScreens\(fx, screenOne, screenTwo, phone, secondPhone\)/.test(mainBody),
    'the two-screen case is not given the second participant'
  );
  const body = JOURNEY.slice(JOURNEY.indexOf('async function caseTwoScreens('), JOURNEY.indexOf('// 4. READY ON THE PHONE'));
  assert.ok(
    /secondCode\.length > 0/.test(body),
    'the second screen must be proven to have called SOMEBODY, or an empty screen passes'
  );
  assert.ok(
    /secondCode !== shortCode\.trim\(\)/.test(body),
    'the two screens must be proven to hold DIFFERENT participants'
  );
  assert.ok(
    /firstHallAgain\.includes\(secondCode\)/.test(body),
    'the first screen is never re-checked for the second participant, so a cross-surface leak would pass'
  );
});

test('the hall is checked for what a room must never read', () => {
  const body = JOURNEY.slice(JOURNEY.indexOf('async function caseTwoScreens('), JOURNEY.indexOf('// 4. READY ON THE PHONE'));
  assert.ok(/\.email\)/.test(body), 'the hall is not checked for an email address');
  assert.ok(/\.uid\)/.test(body), 'the hall is not checked for a uid');
  assert.ok(/full name/.test(body), 'the hall is not checked for a full name');
  assert.ok(/two screens claimed one person/.test(body),
    'the journey does not prove two screens cannot hold the same person');
});

test('the player is asserted on BOTH surfaces, and the binding is read from the server', () => {
  const body = JOURNEY.slice(JOURNEY.indexOf('async function casePlayer('), JOURNEY.indexOf('// 5. REVIEW, RECEIPT'));
  assert.ok(body.includes("'wsf-station-move'") && body.includes("'wsf-queue-move'"),
    'the player must be asserted on the screen and on the phone, not one of them');
  for (const part of ['-figure', '-media-label', '-timer', '-round', '-stage']) {
    assert.ok(body.includes(part), `the player's ${part} is never asserted`);
  }
  for (const control of ['move-start', 'move-pause', 'move-stop']) {
    assert.ok(body.includes(control), `the player's ${control} is never exercised`);
  }
  // THE DEFAULT ROUND IS PINNED TO A NUMBER, NOT SAMPLED.
  //
  // The first version of the journey waited four seconds and checked the
  // timer contained a digit, which a 30-, 45- or arbitrary-length round would
  // all have passed. The ready-state timer renders the round's own length, so
  // the number is read exactly — and this assertion exists so that a later
  // edit cannot quietly go back to sampling.
  assert.ok(
    /const EXPECTED_ROUND_SECONDS = 60;/.test(JOURNEY),
    'the journey no longer names the expected default round length'
  );
  assert.ok(
    /readyTimer === `\$\{EXPECTED_ROUND_SECONDS\}s`/.test(body),
    'the default round length must be compared exactly against the rendered ready-state timer'
  );
  assert.ok(
    /remaining <= EXPECTED_ROUND_SECONDS && remaining >= EXPECTED_ROUND_SECONDS - 15/.test(body),
    'the running round must be checked against the expected length, not merely for a digit'
  );
  assert.equal(
    /\/\\d\/\.test\(running\)/.test(body),
    false,
    'a "the timer contains a digit" check cannot stand in for the round length'
  );

  // THE COUNTDOWN MUST BEGIN AT THREE, not merely be at-or-below three.
  // Accepting 1..3 would have passed a one-second countdown while the receipt
  // said "a count of three".
  assert.ok(
    /const EXPECTED_COUNTDOWN_SECONDS = 3;/.test(JOURNEY),
    'the journey no longer names the expected countdown as three'
  );
  assert.ok(
    /highest === EXPECTED_COUNTDOWN_SECONDS/.test(body),
    'the countdown must be proven to BEGIN at the expected value, not merely to be at or below it'
  );
  assert.equal(
    /countValue >= 1 && countValue <= EXPECTED_COUNTDOWN_SECONDS/.test(body),
    false,
    'a range check cannot stand in for proving where the countdown began'
  );

  // THE STATION MUST BE RUNNING THE ROUND, NOT PARKED ON ITS READY SCREEN.
  // A ready-state timer never moves, so a decrease is the proof; agreement
  // with the phone's remaining time is what makes it the SAME round.
  assert.ok(
    /wsf-station-move-timer/.test(body),
    'the station player’s own timer is never read during the round'
  );
  assert.ok(
    /Number\(stationSecondMatch\[1\]\) < stationRemaining/.test(body),
    'the station timer must be shown to DECREASE, or a screen parked on its ready state passes'
  );
  assert.ok(
    /Math\.abs\(stationRemaining - remaining\) <= 5/.test(body),
    'the station and the phone must be checked against the same round'
  );

  // THE QR CLAIM IS ABOUT MOVEMENT, SO IT IS ASSERTED DURING MOVEMENT.
  const startAt = body.indexOf("'wsf-queue-move-start'");
  const qrAt = body.indexOf("'wsf-station-qr'");
  assert.notEqual(startAt, -1, 'the journey no longer starts the round');
  assert.ok(qrAt > startAt, 'the join QR must be asserted AFTER the round starts, not before it');
  // And continuity during the round comes from the server's entry, not from
  // whatever the pre-start screen happened to show.
  const midAt = body.indexOf('mid-round the entry is');
  assert.ok(midAt > startAt, 'the journey does not check the attempt is still active DURING the round');
  assert.ok(
    /midRound\.body\?\.fields\?\.attemptStationId/.test(body),
    'mid-round station binding is not read from the server-written entry'
  );
  // The binding claim must come from the entry the server wrote, because each
  // surface's own account of itself is not evidence about the other.
  assert.ok(/getDoc\(`wsfTurnEntries\//.test(body) && /attemptStationId/.test(body),
    'phone-and-screen binding is not read from the server-written entry');
});

test('the screen clears by waiting out the real window, not by trusting a constant', () => {
  const body = JOURNEY.slice(JOURNEY.indexOf('async function caseReceiptAndClear('));
  assert.ok(/RESULT_WINDOW_MS \+ /.test(body),
    'the journey does not wait past the real result window before claiming the screen cleared');
  assert.ok(body.indexOf('anonymous-result') < body.indexOf('cleared'),
    'the result must be seen present before it is claimed absent');
  assert.ok(/the phone lost its own receipt/.test(body),
    'the journey does not prove the phone keeps its receipt after the screen forgets the person');
});

test('captures are labelled by surface and width, and both widths are used', () => {
  assert.ok(/const name = `\$\{surface\}-\$\{width\}-\$\{label\}\.png`/.test(JOURNEY),
    'captures are not labelled by surface and width');
  assert.ok(/'phone', 390/.test(JOURNEY), 'no capture is taken at 390');
  assert.ok(/'station', 1280/.test(JOURNEY), 'no capture is taken at 1280');
  assert.ok(/CAPTURES=/.test(JOURNEY), 'the receipt does not report how many captures were taken');
  for (const state of ['scanned-event', 'waiting-with-place', 'called', 'ready', 'player-ready', 'review', 'receipt', 'cleared']) {
    assert.ok(JOURNEY.includes(state), `no capture is labelled for the ${state} state`);
  }
});

test('the player job deploys nothing, runs the 24-row suite nowhere, and keeps its own manifest', () => {
  assert.equal(/firebase deploy|hosting:channel|--only functions/.test(WORKFLOW), false,
    'player mode must not deploy anything');
  assert.equal(/hosted-package-e-smoke/.test(WORKFLOW), false,
    'player mode must not re-run the 24-row authorization suite');
  assert.ok(/wsf-player-evidence\/cleanup-manifest\.json/.test(WORKFLOW),
    'the player job must use its own cleanup manifest, never the hosted suite’s');
  assert.equal(/wsf-evidence\/cleanup-manifest\.json/.test(WORKFLOW), false,
    'the player job points at the hosted suite’s manifest, which would let one run adopt the other’s fixtures');
  assert.ok(/^concurrency:\n {2}group: wsf-staging-deploy$/m.test(WORKFLOW_FILE),
    'the journey must not be able to run while a deployment replaces the build underneath it');
  // And the mode itself must not build or deploy: the job is gated on it.
  assert.ok(/^ {4}if: \$\{\{ inputs\.mode == 'player-journey' \}\}$/m.test(WORKFLOW),
    'the player job must run only in player mode');
  // Cleanup and the redacting scan both run even when the journey fails.
  const cleanupAt = WORKFLOW.indexOf('Remove synthetic fixtures');
  const scanAt = WORKFLOW.indexOf('Scan evidence before upload');
  const uploadAt = WORKFLOW.indexOf('name: wsf-player-evidence\n          path:');
  assert.ok(cleanupAt > 0 && scanAt > cleanupAt, 'the evidence scan must run after cleanup');
  assert.ok(uploadAt === -1 || scanAt < uploadAt, 'evidence must be scanned before it is uploaded');
  assert.ok(/steps\.scan-player-evidence\.outcome == 'success'/.test(WORKFLOW),
    'rejected evidence must never be uploaded');
  assert.ok(/the browser\/player journey did not pass/.test(WORKFLOW),
    'a failed journey must not leave a green run');
});

test('the entry abandoned by Leave is tracked before it is abandoned', () => {
  // Leaving marks the first entry `left`; rejoining mints a SECOND random
  // document. Reading the id only after the rejoin tracked the second and
  // left the first on staging, with no way to recover its id afterwards.
  const body = JOURNEY.slice(
    JOURNEY.indexOf('async function casePhoneChoosesQueue('),
    JOURNEY.indexOf('// 3. TWO SCREENS')
  );
  const captureAt = body.indexOf('const firstEntryId');
  const leaveAt = body.indexOf("getByTestId('wsf-queue-leave').click()");
  assert.notEqual(captureAt, -1, 'the abandoned entry id is never captured');
  assert.ok(captureAt < leaveAt, 'the abandoned entry must be tracked BEFORE Leave is pressed');
  assert.ok(
    /trackLinked\(`wsfTurnEntries\/\$\{firstEntryId\}`/.test(body),
    'the abandoned entry is captured but never added to the manifest'
  );
  assert.ok(
    /mine\.turn\.entryId !== firstEntryId/.test(body),
    'the rejoined entry is never proven to be a different place'
  );
});

test('both claimed pairing documents are tracked, from the station the server wrote', () => {
  // wsfApproveStation returns { stationId, slot, label, goalId } and no
  // pairingId, so an `approved.pairingId` branch can never run: two pairing
  // documents were left on staging in `claimed` state by every run.
  // Comments stripped: the journey EXPLAINS that wsfApproveStation returns no
  // pairingId, and a naive search matched that sentence rather than any code.
  // A check that fires on its own documentation is not a check — this is the
  // second time on this file, so it is worth doing properly.
  const journeyCode = JOURNEY
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.equal(
    /approved\.pairingId/.test(journeyCode),
    false,
    'wsfApproveStation returns no pairingId; a branch reading one is dead code'
  );
  const body = JOURNEY.slice(JOURNEY.indexOf('async function enrolScreen('), JOURNEY.indexOf('async function caseQrLink('));
  assert.ok(
    /getDoc\(`wsfKioskStations\/\$\{approved\.stationId\}`\)/.test(body),
    'the pairing id must be read back from the station document'
  );
  assert.ok(
    /trackLinked\(`wsfKioskPairings\/\$\{pairingId\}`/.test(body),
    'the claimed pairing is never added to the manifest'
  );
  // Validated before it is claimed, so a wrong id cannot enter the manifest.
  assert.ok(/pairingDoc\.body\?\.fields\?\.goalId/.test(body), 'the pairing is not checked against this run’s goal');
  assert.ok(/pairingDoc\.body\?\.fields\?\.stationId/.test(body), 'the pairing is not checked against the approved station');
  // enrolScreen runs once per station, so tracking inside it covers both.
  assert.ok(/enrolScreen\(browser, fx, 1\)/.test(JOURNEY) && /enrolScreen\(browser, fx, 2\)/.test(JOURNEY),
    'both screens must go through the same enrolment path');
});

test('no capture can carry a working enrolment code', () => {
  // scan-evidence.mjs lists PNGs as UNSCANNABLE and exits clean — it cannot
  // read pixels — so a legible six-character approval code in a screenshot
  // would be uploaded as a working credential with nothing to catch it.
  const body = JOURNEY.slice(JOURNEY.indexOf('async function enrolScreen('), JOURNEY.indexOf('async function caseQrLink('));
  const redactAt = body.indexOf("'wsf-station-pairing-code'");
  // The journey carries the escape SEQUENCE in its source, not the rendered
  // character, so this looks for the text that is actually in the file.
  const maskAt = body.indexOf('\\u2588');
  const snapAt = body.indexOf("await snap(page, 'station', 1280, `0${slot}-pairing");
  assert.notEqual(maskAt, -1, 'the pairing code is never masked');
  assert.ok(maskAt < snapAt, 'the code must be masked BEFORE the capture is taken');
  assert.ok(redactAt !== -1, 'the code element is never located for redaction');
  // The capture's own name has to say the code is not in it.
  assert.ok(
    /pairing-code-redacted/.test(body),
    'the capture must be labelled as redacted, so no reader assumes the code is present and valid'
  );
});

// ---- the order the served build actually puts on screen ---------------------
// Run 35495928362 timed out after 73 seconds waiting for `wsf-event-title` on
// the first cold open of the scanned link. That screen cannot appear there:
// a fresh browser is asked whose screen it is before anything else, and a
// visitor with no session then gets `wsf-event-signed-out`. These pin the real
// order so no edit can quietly assume the old one again.

const sliceFn = (name, end) =>
  JOURNEY.slice(JOURNEY.indexOf(`async function ${name}(`), end ? JOURNEY.indexOf(end) : undefined);

/**
 * The same slice with comments removed.
 *
 * Comments in this file quote the defects these checks look for — the
 * reachMemberEvent banner says in prose that an earlier version "navigated
 * back with `page.goto(qrUrl)`" — so a check that counts occurrences must
 * count CODE. Three separate checks in this suite have been written against
 * prose by accident and had to be fixed after the fact; a named helper is
 * cheaper than remembering.
 */
const codeOfFn = (name, end) =>
  sliceFn(name, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');

test('the cold scan answers the device question and lands signed OUT, never on the member view', () => {
  const body = sliceFn('caseQrLink', '// 2. THE PHONE GETS');
  const deviceAt = body.indexOf('answerOwnPhone(coldPage');
  const signedOutAt = body.indexOf("'wsf-event-signed-out'");
  assert.notEqual(deviceAt, -1, 'the cold scan never answers the device question');
  assert.notEqual(signedOutAt, -1, 'the cold scan never reaches the signed-out landing');
  assert.ok(deviceAt < signedOutAt, 'the device question comes before the signed-out landing');
  // The member view is what run 33 waited for here. It may only be asserted
  // ABSENT in this case.
  const titleUses = [...body.matchAll(/wsf-event-title/g)].map((m) => m.index);
  for (const at of titleUses) {
    const line = body.slice(body.lastIndexOf('\n', at) + 1, body.indexOf('\n', at));
    assert.match(line, /count\(\)\) === 0|count\(\) === 0/,
      `the cold scan waits for the member view: ${line.trim()}`);
  }
  assert.ok(body.indexOf('line before the scan') < body.indexOf('line after the scan'),
    'the journey does not prove the scan left the line untouched');
});

test('the device question is answered before anything else on every phone that opens the link cold', () => {
  const helper = sliceFn('answerOwnPhone', 'async function reachMemberEvent(');
  // Both answers must be on screen: "chose personal" is meaningless if only
  // one option was ever rendered.
  assert.match(helper, /wsf-device-choice-personal/);
  assert.match(helper, /wsf-device-choice-shared/);
  assert.ok(
    helper.indexOf("'wsf-device-choice-shared'") < helper.indexOf(".getByTestId('wsf-device-choice-personal').click()"),
    'the shared option must be proven present before the personal one is clicked'
  );

  const reach = sliceFn('reachMemberEvent', 'async function chooseActivityByTitle(');
  // The last marker is the helper, not the raw testID: run 36's fix moved the
  // event-title wait behind visibleEventTitle(). The ORDER is what this checks,
  // and it is unchanged.
  const order = ['answerOwnPhone(', "'wsf-event-signed-out'", "'wsf-event-signin'", 'signInOnPage(', 'memberRoot('];
  let previous = -1;
  for (const marker of order) {
    const at = reach.indexOf(marker);
    assert.notEqual(at, -1, `reachMemberEvent never does: ${marker}`);
    assert.ok(at > previous, `reachMemberEvent is out of order at ${marker}`);
    previous = at;
  }
});

test('every participant reaches the event through that helper — nobody shortcuts to the member view', () => {
  for (const [fn, end] of [['casePhoneChoosesQueue', '// 3.'], ['joinSecondPhone', '/** Every element whose testID']]) {
    const body = sliceFn(fn, end);
    assert.match(body, /await reachMemberEvent\(/, `${fn} does not go through reachMemberEvent`);
    assert.equal(/getByTestId\('wsf-event-signin'\)\.click\(\)/.test(body), false,
      `${fn} drives sign-in itself instead of through the helper that pins the order`);
  }
});

test('BOTH participants choose an activity explicitly, and the where-panel is proven absent until they do', () => {
  // The second phone never chose one. The where-panel — and so the queue
  // button it contains — is not rendered until an activity is selected, so
  // that participant could never have reached the line at all.
  for (const [fn, end] of [['casePhoneChoosesQueue', '// 3.'], ['joinSecondPhone', '/** Every element whose testID']]) {
    const body = sliceFn(fn, end);
    const chooseAt = body.indexOf('chooseActivityByTitle(');
    const queueAt = body.indexOf("'wsf-event-queue-start'");
    assert.notEqual(chooseAt, -1, `${fn} never chooses an activity`);
    assert.notEqual(queueAt, -1, `${fn} never chooses the queue`);
    assert.ok(chooseAt < queueAt, `${fn} reaches for the queue before choosing an activity`);
  }
  const helper = sliceFn('chooseActivityByTitle', 'async function joinSecondPhone(');
  assert.match(helper, /wsf-event-choice'\)\.count\(\)\) === 0/,
    'the where-panel must be proven absent before an activity is chosen, or "choosing" proves nothing');
  assert.ok(
    helper.indexOf('count()) === 0') < helper.indexOf('.click()'),
    'the absence check must come before the click'
  );
});

test('the rejoin chooses an activity again, because nothing is preselected on a fresh load', () => {
  const body = sliceFn('casePhoneChoosesQueue', '// 3.');
  const leaveAt = body.indexOf("'wsf-queue-leave'");
  const rejoinChoose = body.indexOf('chooseActivityByTitle(', leaveAt);
  const rejoinQueue = body.indexOf("'wsf-event-queue-start'", leaveAt);
  assert.notEqual(leaveAt, -1, 'the phone never leaves the line');
  assert.notEqual(rejoinChoose, -1, 'the rejoin never chooses an activity again');
  assert.ok(rejoinChoose < rejoinQueue, 'the rejoin reaches for the queue before choosing an activity');
  // And the device question must NOT be asked again in a browser that answered.
  assert.match(body.slice(leaveAt), /visibleCount\(page, 'wsf-event-device-choice'\)\) === 0/,
    'the rejoin does not prove the remembered device answer was honoured');
});

test('no COMMENT contradicts what the code now asserts about the return', () => {
  // The check above reads code with comments stripped, which is exactly how a
  // stale comment survived: the file waited for the product's return while a
  // banner above it still said sign-in does not come back and "the journey
  // navigates back itself". Durable evidence that contradicts itself is worse
  // than none, so the prose gets its own check.
  //
  // Deliberately asymmetric: it bans PRESENT-TENSE claims that the product
  // loses the event. Past-tense history ("on the build this was first written
  // against it did not") is how the file explains why the assertion exists,
  // and must stay sayable.
  const comments = JOURNEY.split('\n')
    .filter((line) => /^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
  const contradictions = [
    /does NOT come back to the event/,
    /so the journey navigates back itself/,
    /this file navigates back/,
    /a navigation the product never makes/,
    /the return is the harness's/i,
  ];
  for (const pattern of contradictions) {
    const hit = pattern.exec(comments);
    assert.equal(hit, null,
      `a comment still claims the product does not return: ${JSON.stringify(hit?.[0])}`);
  }
  // And it must say, somewhere, that the product does the returning.
  assert.match(comments, /COMES BACK to it, and the product does that|THE RETURN IS THE PRODUCT'S/,
    'no comment states that the return is the product\u2019s own');
});

test('the PRODUCT brings the visitor back to the event — the harness must not do it for them', () => {
  // The defect this replaced: an interim version navigated back with
  // page.goto and asserted the product had NOT returned. A green run then
  // proved the harness could find the event, which is not something anybody
  // standing at one can do. Scanning, signing in and arriving is one journey
  // to the person doing it, so the address has to become the scanned event on
  // its own.
  // CODE, not prose: the banner above this helper quotes the page.goto the
  // old version used, and counting that would read the comment as a defect.
  const reach = codeOfFn('reachMemberEvent', 'async function chooseActivityByTitle(');
  const signInAt = reach.indexOf('signInOnPage(');
  assert.notEqual(signInAt, -1, 'reachMemberEvent never signs in');

  // Exactly ONE navigation in this helper, and it is the cold open BEFORE the
  // device question. Anything after the sign-in would be the harness walking
  // itself to the destination it is supposed to be testing.
  const navigations = [...reach.matchAll(/page\.goto\(/g)].map((m) => m.index);
  assert.equal(
    navigations.length,
    1,
    `reachMemberEvent navigates ${navigations.length} times; the cold open is the only one allowed`
  );
  assert.ok(navigations[0] < reach.indexOf('answerOwnPhone('), 'the one navigation must be the cold open');
  assert.ok(navigations[0] < signInAt, 'nothing may navigate after sign-in');

  // And it waits for the product's own arrival at the scanned path.
  assert.match(reach, /waitForURL/, 'the journey must wait for the product to arrive');
  assert.ok(reach.indexOf('waitForURL') > signInAt, 'the wait must come after sign-in');
  assert.match(reach, /url\.pathname === expectedPath/,
    'the wait must be for the scanned event’s own path, not merely for leaving /signin');
  assert.match(reach, /landed === expectedPath/, 'the landing must be asserted, not just awaited');
  // The device answer is remembered per browser, so arriving back must NOT be
  // asked the question again. Without this, a build that forgot the answer on
  // every navigation would still pass everything above.
  assert.match(reach, /visibleCount\(page, 'wsf-event-device-choice'\)\) === 0/,
    'the return does not prove the remembered device answer survived the auth round trip');

  // No receipt may describe the return as the harness's any more.
  const claims = JOURNEY.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(/this journey navigated back|navigates back itself/i.test(claims), false,
    'a receipt still describes the return as the harness’s own');
  const pass = JOURNEY.slice(JOURNEY.indexOf("check('player journey — the phone chooses the queue'"));
  assert.match(pass.slice(0, 1400), /BY ITSELF/,
    'the receipt does not say the return was the product’s own');
});

test('every positive post-arrival event read is scoped to the ONE visible member root', () => {
  // RUNS 36 AND 37, one control apart, same root cause: expo-router keeps the
  // OUTGOING route mounted under the incoming one, so the document holds two
  // copies of the event. Run 36 hit it on the title (strict mode refuses two
  // matches); run 37 hit it in chooseActivityByTitle, where a document-wide
  // querySelectorAll counted BOTH copies' activity options and a two-activity
  // event looked like four.
  //
  // This test exists so the class cannot come back one control at a time.
  //
  // CODE ONLY: the banner it protects quotes the bad patterns in prose.
  const code = JOURNEY.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  // 1. One helper resolves the visible member root.
  const helper = codeOfFn('memberRoot', 'async function visibleCount');
  assert.match(helper, /\[data-testid="wsf-event-member"\]:visible/,
    'memberRoot does not resolve the member root by visibility');
  assert.match(helper, /rootCount === 1/, 'memberRoot no longer asserts exactly ONE visible root');
  assert.match(helper, /titleCount === 1/, 'memberRoot no longer asserts exactly ONE visible title');
  assert.match(helper, /actual === expectedTitle/, 'memberRoot no longer asserts the title text');

  // 2. The prefix scan reads inside a root, never the whole document.
  const scan = codeOfFn('testIdsWithPrefix', 'async function enrolScreen');
  assert.equal(/document\.querySelectorAll/.test(scan), false,
    'testIdsWithPrefix is document-wide again, so it will count the retained route');
  assert.match(scan, /el\.querySelectorAll/, 'testIdsWithPrefix does not scan within the given root');

  // 3. THE CLASS RULE. Controls that only exist once a member has arrived may
  //    never be read page-scoped; they are descendants of the visible root.
  const AFTER_ARRIVAL = [
    'wsf-event-activity', 'wsf-event-choice', 'wsf-event-choice-activity', 'wsf-event-add',
    'wsf-event-queue-start', 'wsf-event-queue-panel', 'wsf-event-queue-name-first',
    'wsf-event-queue-join',
  ];
  for (const id of AFTER_ARRIVAL) {
    assert.equal(
      new RegExp(`\\bpage\\.getByTestId\\('${id}'`).test(code), false,
      `${id} is read page-scoped after member arrival; it must be a descendant of the visible member root`
    );
  }

  // 4. And the pre-arrival reads stay page-scoped, because there is no member
  //    root yet and scoping them to one would make them vacuous.
  for (const id of ['wsf-event-device-choice', 'wsf-event-signed-out', 'wsf-event-signup', 'wsf-event-signin']) {
    assert.match(code, new RegExp(`page\\.getByTestId\\('${id}'`),
      `${id} is no longer read page-scoped, but it is asserted before any member root exists`);
  }

  // 5. A fresh navigation re-resolves the root: the locator captured before a
  //    goto can be the copy that goto just hid.
  const queueCase = codeOfFn('casePhoneChoosesQueue', 'async function caseTwoScreens');
  const gotoAt = queueCase.indexOf('page.goto(qrUrl');
  assert.notEqual(gotoAt, -1, 'the rejoin no longer navigates');
  assert.ok(queueCase.slice(gotoAt).includes('memberRoot('),
    'the rejoin reuses a stale root instead of resolving the newly visible one');

  // 6. The second phone asserts the real event title, not undefined. This was
  //    a live defect: the call omitted the argument entirely.
  const second = codeOfFn('joinSecondPhone', 'async function testIdsWithPrefix');
  assert.match(second, /reachMemberEvent\(page, qrUrl, fx\.phoneTwo, fx\.eventTitle\)/,
    'the second phone does not pass the expected event title');
});

test('no comment still claims the product does not return, or that approve-station is unprobed', () => {
  assert.equal(
    /the product does not do it/i.test(JOURNEY), false,
    'the reachMemberEvent docstring still says the product does not perform the return'
  );
  const SMOKE = fs.readFileSync('.github/wsf-staging/hosted-package-e-smoke.mjs', 'utf8');
  // wsfApproveStation IS exercised: the turn row calls it with a Champion's
  // own ID token. Only wsfListStations and wsfRevokeStation are unprobed.
  assert.match(SMOKE, /wsfApproveStation'/, 'the turn row no longer calls wsfApproveStation');
  assert.equal(
    /\(wsfApproveStation, wsfListStations, wsfRevokeStation\) are NOT probed/.test(SMOKE), false,
    'the receipt still claims wsfApproveStation is not probed'
  );
});
