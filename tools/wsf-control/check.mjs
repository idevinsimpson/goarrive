#!/usr/bin/env node
/**
 * Validate a control-state directory: the ledger reduces cleanly (shape, chain,
 * legality), state.json is exactly its reduction (never hand-edited), and the
 * state invariants hold.
 *
 *   node tools/wsf-control/check.mjs <dir containing events.jsonl and state.json>
 *
 * Exit 0 = CONTROL_STATE=valid. Exit 1 = CONTROL_STATE=invalid, one line per problem.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DELIVERED_SUCCESSOR, KNOWN_SCHEMAS, RE, isTerminal, screen, unreachableBlocker } from './schema.mjs';
import { reduce, serialize } from './reduce.mjs';
import { workerBuckets } from './derive.mjs';

/** Invariants over a state. Returns problems; empty means sound. */
export function invariants(s) {
  const problems = [];
  // A state of a schema this reader does not know is refused whole: nothing below is trusted on it.
  if (!KNOWN_SCHEMAS.includes(s.schemaVersion)) return [`state schemaVersion ${JSON.stringify(s.schemaVersion)} is not one this reader knows (${KNOWN_SCHEMAS.join(', ')}); fail closed`];
  for (const w of Object.keys(s.workers).sort()) {
    const b = workerBuckets(s, w);
    if (b.active.length > 1) problems.push(`${w} holds ${b.active.length} worker-owned packets (${b.active.map((p) => p.id).join(', ')}); at most one`);
    for (const id of s.queue[w] || []) {
      const p = s.packets[id];
      if (!p) problems.push(`${w}'s queue names ${id}, which does not exist`);
      else if (p.phase !== 'QUEUED') problems.push(`${w}'s queue names ${id}, which is already ${p.phase}`);
      else if (p.owner !== w) problems.push(`${w}'s queue names ${id}, which belongs to ${p.owner}`);
    }
    if (new Set(s.queue[w] || []).size !== (s.queue[w] || []).length) problems.push(`${w}'s queue names a packet twice`);
    // One active review per W# reviewer, as one ACTIVE per implementer.
    const reviews = b.reviewing.map((p) => p.id);
    // One ball in total across implementation and review (ops: one ACTIVE NOW per worker).
    if (b.active.length >= 1 && reviews.length >= 1) {
      problems.push(`${w} holds ${b.active.length + reviews.length} balls (active ${b.active.map((p) => p.id).join(', ')}; reviewing ${reviews.join(', ')}); one ball per worker across implementation and review`);
    }
    if (reviews.length > 1) problems.push(`${w} is already reviewing ${reviews.length - 1} work packet (${reviews.slice(0, -1).join(', ')}); a W# reviewer holds at most one review (also asked: ${reviews.at(-1)})`);
    // Ops v1.2: one driving NEXT. Reference packets are exempt; they never drive the loop.
    const queuedWork = (s.queue[w] || []).filter((id) => s.packets[id]?.kind === 'work');
    if (queuedWork.length > 1) problems.push(`${w} has ${queuedWork.length} queued work packets (${queuedWork.join(', ')}); at most one NEXT`);
  }
  for (const [id, p] of Object.entries(s.packets)) {
    if (!s.workers[p.owner]) problems.push(`${id}: owner ${p.owner} is not a registered worker`);
    if (p.phase !== 'QUEUED' && p.phase !== 'WITHDRAWN' && p.inbox !== null && s.workers[p.owner] && p.inbox !== s.workers[p.owner].inbox) {
      problems.push(`${id}: released in #${p.inbox}, outside ${p.owner}'s canonical inbox #${s.workers[p.owner].inbox}`);
    }
    // Independent review: a W# implementation owner never reviews its own work packet.
    if (p.phase === 'UNDER_REVIEW' && p.kind === 'work' && p.reviewers.includes(p.owner)) problems.push(`${p.owner} cannot review its own work packet ${id}; review must be independent`);
    // Review passes belong to the current cycle: only assigned reviewers, and none once the ball is back with the owner.
    for (const r of p.reviewedBy || []) if (!p.reviewers.includes(r)) problems.push(`${id}: ${r} passed review but is not an assigned reviewer`);
    const cycle = p.phase === 'BLOCKED' ? p.phaseBeforeBlock : p.phase;
    if (['RELEASED', 'ACKED', 'DELIVERED', 'CHANGES_REQUESTED'].includes(cycle) && (p.reviewedBy || []).length) problems.push(`${id} is ${cycle} but still carries review passes (${p.reviewedBy.join(', ')}) from an ended review cycle`);
    if (p.phase === 'UNDER_REVIEW') for (const r of p.reviewers) if (RE.worker.test(r) && !s.workers[r]) problems.push(`reviewer ${r} of ${id} is not a registered worker`);
    if (p.phase === 'QUEUED' && !(s.queue[p.owner] || []).includes(id)) problems.push(`${id} is QUEUED but not in ${p.owner}'s queue`);
    for (const b of p.blockedBy.filter((x) => x.packet)) { const why = unreachableBlocker(s, id, b); if (why) problems.push(`${id}: ${why}`); }
    if (p.phase === 'VERIFYING' && p.proof?.result !== 'RUNNING') problems.push(`${id} is VERIFYING without a running proof`);
    if (s.schemaVersion === 2) {
      // A pending finding waits only on a packet the reviewers still hold; a DELIVERED-SUCCESSOR blocker remembers its base.
      if (p.pendingFinding && !['DELIVERED', 'UNDER_REVIEW'].includes(p.phase)) problems.push(`${id} carries a pending finding while ${p.phase}`);
      if (!Number.isInteger(p.deliveries) || p.deliveries < 0) problems.push(`${id}: deliveries must be a count`);
      for (const b of p.blockedBy.filter((x) => x.until === DELIVERED_SUCCESSOR)) if (!Number.isInteger(b.since)) problems.push(`${id}: a ${DELIVERED_SUCCESSOR} blocker must remember the delivery count it waits past`);
    } else if (p.blockedBy.some((x) => x.until === DELIVERED_SUCCESSOR)) problems.push(`${id}: ${DELIVERED_SUCCESSOR} is a schema v2 milestone`);
    for (const k of ['subjectSha', 'prHeadSha', 'evidenceSha', 'mergeSha']) {
      const v = p.artifact[k];
      if (v !== null && !RE.sha.test(v)) problems.push(`${id}: artifact.${k} is not a 40-character SHA`);
    }
  }
  if (s.criticalPath !== null) {
    const p = s.packets[s.criticalPath];
    if (!p) problems.push(`criticalPath ${s.criticalPath} does not exist`);
    else if (isTerminal(p)) problems.push(`criticalPath ${s.criticalPath} is terminal (${p.phase})`);
    else if (p.kind !== 'work') problems.push(`criticalPath ${s.criticalPath} is a reference packet`);
  }
  problems.push(...screen(s));
  return problems;
}

/** Validate ledger text and state text together. */
export function checkTexts(eventsText, stateText) {
  let state;
  try { state = reduce(eventsText); } catch (e) { return { ok: false, problems: [e.message], state: null }; }
  const problems = invariants(state);
  if (stateText !== serialize(state)) {
    problems.push('state.json is not the reduction of events.jsonl (it was hand-edited, or not regenerated after an append)');
  }
  return { ok: problems.length === 0, problems, state };
}

export function checkDir(dir) {
  const read = (f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : null);
  const events = read('events.jsonl');
  const state = read('state.json');
  if (events === null || state === null) return { ok: false, problems: [`${dir} must contain events.jsonl and state.json`], state: null };
  return checkTexts(events, state);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: check.mjs <control-state dir>'); process.exit(1); }
  const r = checkDir(dir);
  for (const p of r.problems) console.error(`::error::${p}`);
  console.log(`CONTROL_STATE=${r.ok ? 'valid' : 'invalid'}${r.state ? ` events=${r.state.eventCount} head=${r.state.ledgerHead.slice(0, 12)}` : ''}`);
  process.exit(r.ok ? 0 : 1);
}
