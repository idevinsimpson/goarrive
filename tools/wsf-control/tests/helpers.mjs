/** Shared fixtures for the control-state suites: synthetic SHAs, sources and a ledger builder. */
import assert from 'node:assert/strict';
import { appendEvent } from '../append.mjs';

export const sha = (c) => c.repeat(40);
export const A = sha('a');
export const B = sha('b');
export const C = sha('c');
export const D = sha('d');
export const E = sha('e');
export const F = sha('f');
export const REPO = 'example-org/example-repo';
export const GENESIS = '0'.repeat(64);

let passed = 0;
export const test = (name, fn) => { fn(); passed += 1; console.log(`  ok  ${name}`); };
export const done = (suite) => console.log(`${suite}: ${passed} passed`);

/** Typed sources. Comment ids are synthetic. */
export const comment = (id) => ({ kind: 'comment', id, repo: REPO });
export const pull = (id) => ({ kind: 'pull_request', id, repo: REPO });
export const commit = (id) => ({ kind: 'commit', id, repo: REPO });
export const run = (id) => ({ kind: 'workflow_run', id, repo: REPO });

export const STAGED_HOSTED = { terminal: 'STAGED', proofType: 'hosted' };
export const VERIFIED_ACTIVATION = { terminal: 'VERIFIED', proofType: 'journey-activation' };
export const SOURCE_ONLY = { terminal: 'INTEGRATED', proofType: 'source-only' };

export const CURRENT_COMMENT = 9001;
/** A bootstrap with two workers and nothing imported; `over` replaces fields. */
export const boot = (over = {}) => ({
  type: 'bootstrap', actor: 'Fable', source: comment(100),
  repository: REPO, asOf: '2026-09-26T17:00:00Z',
  surfaces: { controlInbox: { pr: 365 }, current: { pr: 365, commentId: CURRENT_COMMENT } },
  canonical: { developmentBranch: 'claude/wsf-dev', developmentSha: A, operationalMain: B },
  staging: { servedSha: C, runId: 11, runNumber: 7, rollbackSha: D },
  workers: { W3: { inbox: 396 }, W7: { inbox: 400 } },
  queue: { W3: [], W7: [] },
  packets: {},
  ...over,
});

/** The standard program: W3 holds ALPHA (staged product) then BETA (verified tooling); W7 has a reference. */
export const BASE = [
  boot(),
  { type: 'queue', packet: 'ALPHA', owner: 'W3', completion: STAGED_HOSTED, subjectPaths: ['apps/wsf'], label: 'first packet' },
  { type: 'queue', packet: 'BETA', owner: 'W3', completion: VERIFIED_ACTIVATION },
  { type: 'queue', packet: 'REF-1', owner: 'W7', kind: 'reference', completion: SOURCE_ONLY },
  { type: 'set-critical-path', packet: 'ALPHA' },
];

let nextComment = 1000;
/** Append one event as Fable with the next synthetic comment as its source, at the current head. */
export function add(r, e) {
  nextComment += 1;
  return appendEvent(r.eventsText, { actor: 'Fable', source: comment(nextComment), ...e }, { expectHead: r.state?.ledgerHead ?? GENESIS });
}
export const chain = (r, ...events) => events.reduce(add, r);
export const build = (events) => chain({ eventsText: '', state: null }, ...events);

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
