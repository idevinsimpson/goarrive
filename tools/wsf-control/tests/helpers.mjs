/** Shared fixtures for the control-state suites: synthetic SHAs, comment ids and a ledger builder. */
import assert from 'node:assert/strict';
import { appendEvent } from '../append.mjs';

export const sha = (c) => c.repeat(40);
export const A = sha('a');
export const B = sha('b');
export const C = sha('c');
export const D = sha('d');
export const E = sha('e');

let passed = 0;
export const test = (name, fn) => { fn(); passed += 1; console.log(`  ok  ${name}`); };
export const done = (suite) => console.log(`${suite}: ${passed} passed`);

/** Append events in order (each without seq/prev); returns the final { eventsText, stateText, state }. */
export function build(events, start = '') {
  let r = { eventsText: start, stateText: null, state: null };
  let authority = 1000;
  for (const e of events) {
    authority += 1;
    r = appendEvent(r.eventsText, { actor: 'Fable', authority, ...e });
  }
  return r;
}

/** The standard program: W3 (inbox 396) and W7 (inbox 400), with W3 holding ALPHA on the critical path. */
export const BASE = [
  { type: 'init', actor: 'Director' },
  { type: 'set-canonical', developmentBranch: 'claude/wsf-dev', developmentSha: A, operationalMain: B },
  { type: 'set-staging', servedSha: C, runId: 11, runNumber: 7, rollbackSha: D },
  { type: 'register-worker', worker: 'W3', inbox: 396 },
  { type: 'register-worker', worker: 'W7', inbox: 400 },
  { type: 'queue', packet: 'ALPHA', owner: 'W3', subjectPaths: ['apps/wsf'], label: 'first packet' },
  { type: 'queue', packet: 'BETA', owner: 'W3' },
  { type: 'queue', packet: 'REF-1', owner: 'W7', kind: 'reference' },
  { type: 'set-critical-path', packet: 'ALPHA' },
];

export function refused(fn, re) {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  assert.ok(err, 'expected a refusal');
  assert.match(err.message, re);
  return err;
}

/** Deep-freeze a value so any mutation throws in strict mode. */
export function freeze(o) {
  if (o && typeof o === 'object') { Object.values(o).forEach(freeze); Object.freeze(o); }
  return o;
}
