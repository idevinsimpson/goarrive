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

test('the untouched cases still carry their acceptance checks', () => {
  for (const name of ['round-trip display authorization', 'display session lifecycle', 'closed-goal authorization lifecycle',
    'legacy challenge pulse boundary', 'protected own-credit read', 'former Member history and replay',
    'stale-response admission control', 'explicit fresh-session recovery', 'correct staging build', 'targeted synthetic cleanup']) {
    assert.ok(SMOKE.includes(`check('${name}', 'PASS'`), `check ${name} missing`);
  }
});

console.log(`\nhosted-smoke-contract: ${passed} passed`);
