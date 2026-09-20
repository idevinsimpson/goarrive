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
const WORKFLOW = fs.readFileSync('.github/workflows/wsf-player-journey.yml', 'utf8');
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
    'the workflow installs an engine the journey does not run');
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
  const body = JOURNEY.slice(JOURNEY.indexOf('async function caseQrLink('), JOURNEY.indexOf('// 2. THE PHONE KEEPS'));
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

test('the workflow deploys nothing, runs the 24-row suite nowhere, and keeps its own manifest', () => {
  assert.equal(/firebase deploy|hosting:channel|--only functions/.test(WORKFLOW), false,
    'the player-journey workflow must not deploy anything');
  assert.equal(/hosted-package-e-smoke/.test(WORKFLOW), false,
    'the player-journey workflow must not re-run the 24-row authorization suite');
  assert.ok(/wsf-player-evidence\/cleanup-manifest\.json/.test(WORKFLOW),
    'the workflow must use its own cleanup manifest, never the deploy workflow’s');
  assert.equal(/wsf-evidence\/cleanup-manifest\.json/.test(WORKFLOW), false,
    'the workflow points at the deploy workflow’s manifest, which would let one run adopt the other’s fixtures');
  assert.ok(/group: wsf-staging-deploy/.test(WORKFLOW),
    'the journey must not be able to run while a deployment replaces the build underneath it');
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
