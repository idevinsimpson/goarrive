#!/usr/bin/env node
/**
 * THE ONLY WRITER. Appends one authorized event to the ledger and rewrites the
 * derived state, or changes nothing.
 *
 *   node tools/wsf-control/append.mjs <dir> <event.json> --expect-head <ledgerHead you read>
 *
 * The event file carries type, actor (a ledger writer: Fable or L0), source
 * (the typed GitHub reference that authorizes or proves it) and the type's
 * fields. This script assigns `seq`, `id` and `prev`, then:
 *
 *  1. Retry safety. If an event with the same identity is already recorded:
 *     the same payload is a NO-OP that returns the current head (a retry after
 *     an uncertain push finds its event already landed); a different payload
 *     is a conflict and is refused.
 *  2. Concurrency. `--expect-head` is required (64 zeros for an empty ledger).
 *     A writer that read an older head is refused, re-reads and reconciles.
 *  3. Legality. The new ledger must reduce cleanly and the new state pass every
 *     invariant.
 *
 * Both files are written to temporaries and renamed into place, ledger last:
 * a crash leaves either the old pair or a state that check.mjs flags as stale.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkTexts, invariants } from './check.mjs';
import { reduce, readLedger, serialize, sha256, ledgerLines } from './reduce.mjs';
import { GENESIS, RE, eventId, payloadOf } from './schema.mjs';

export class Refused extends Error {}

/**
 * Pure: current ledger text + event → { noop, eventsText, stateText, state, seq },
 * or throws Refused.
 */
export function appendEvent(eventsText, event, { expectHead } = {}) {
  let current;
  try { current = reduce(eventsText); } catch (e) { throw new Refused(`the existing ledger is invalid: ${e.message}`); }
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Refused('the event must be a JSON object');
  for (const k of ['seq', 'id', 'prev']) if (Object.hasOwn(event, k)) throw new Refused('seq, id and prev are assigned by append.mjs, not supplied');
  const lines = ledgerLines(eventsText);
  const id = eventId(event);
  const existing = lines.map((l) => JSON.parse(l)).find((x) => x.id === id);
  if (existing) {
    if (payloadOf(existing) === payloadOf(event)) {
      return { noop: true, eventsText, stateText: serialize(current), state: current, seq: existing.seq };
    }
    throw new Refused(`conflict: event identity ${id.slice(0, 12)} (${event.type} from ${event.source?.kind} ${event.source?.id}) is already recorded at seq ${existing.seq} with a different payload`);
  }
  if (typeof expectHead !== 'string' || !RE.hash.test(expectHead)) throw new Refused('expectHead (the ledger head you read, or 64 zeros for an empty ledger) is required');
  if (expectHead !== current.ledgerHead) {
    throw new Refused(`the ledger head is ${current.ledgerHead.slice(0, 12)}, not the expected ${expectHead.slice(0, 12)}: another decision was recorded; re-read and reconcile`);
  }
  const full = { seq: lines.length + 1, id, ...event, prev: lines.length ? sha256(lines[lines.length - 1]) : GENESIS };
  const nextText = `${eventsText}${JSON.stringify(full)}\n`;
  let state;
  try { state = reduce(nextText); } catch (e) { throw new Refused(e.message); }
  const problems = invariants(state);
  if (problems.length) throw new Refused(`the event would break an invariant: ${problems.join('; ')}`);
  return { noop: false, eventsText: nextText, stateText: serialize(state), state, seq: full.seq };
}

export function appendToDir(dir, event, opts = {}) {
  const eventsPath = path.join(dir, 'events.jsonl');
  const statePath = path.join(dir, 'state.json');
  const eventsText = readLedger(eventsPath);
  if (eventsText !== '' || fs.existsSync(statePath)) {
    const existing = checkTexts(eventsText, fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf8') : '');
    if (!existing.ok) throw new Refused(`the control state is not valid before this append: ${existing.problems.join('; ')}`);
  }
  const r = appendEvent(eventsText, event, opts);
  if (r.noop) return r;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${statePath}.tmp`, r.stateText);
  fs.writeFileSync(`${eventsPath}.tmp`, r.eventsText);
  fs.renameSync(`${statePath}.tmp`, statePath);
  fs.renameSync(`${eventsPath}.tmp`, eventsPath);
  return r;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [dir, eventFile, flag, head, ...extra] = process.argv.slice(2);
  if (!dir || !eventFile || flag !== '--expect-head' || !head || extra.length) {
    console.error('usage: append.mjs <dir> <event.json> --expect-head <ledgerHead>');
    process.exit(1);
  }
  try {
    let event;
    try { event = JSON.parse(fs.readFileSync(eventFile, 'utf8')); } catch { throw new Refused('the event file is missing or is not JSON'); }
    const r = appendToDir(dir, event, { expectHead: head });
    console.log(r.noop
      ? `APPEND=noop (already recorded as seq=${r.seq}) head=${r.state.ledgerHead}`
      : `APPENDED seq=${r.seq} type=${event.type} head=${r.state.ledgerHead}`);
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    console.error(`::error::${e.message}`);
    console.log('APPEND=refused (nothing written)');
    process.exit(1);
  }
}
