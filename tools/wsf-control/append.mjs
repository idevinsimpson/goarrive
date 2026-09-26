#!/usr/bin/env node
/**
 * THE ONLY WRITER. Appends one authorized decision to the ledger and rewrites
 * the derived state, or changes nothing.
 *
 *   node tools/wsf-control/append.mjs <dir> <event.json> [--expect-head <sha256>]
 *
 * The event file carries type, actor, authority (the GitHub comment id that
 * authorized the decision) and the type's fields. This script fills in `seq`
 * and `prev`, then refuses unless the new ledger reduces cleanly and the new
 * state passes every invariant. `--expect-head` is optimistic concurrency: a
 * writer that read an older head is refused, re-reads and reconciles.
 *
 * Both files are written to temporaries and renamed into place, ledger last:
 * a crash leaves either the old pair or a state that check.mjs flags as
 * stale, never a ledger line without its reduction silently accepted.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkTexts, invariants } from './check.mjs';
import { reduce, readLedger, serialize, sha256, ledgerLines } from './reduce.mjs';
import { GENESIS } from './schema.mjs';

export class Refused extends Error {}

/** Pure: current ledger text + event → { eventsText, stateText, state }, or throws Refused. */
export function appendEvent(eventsText, event, { expectHead } = {}) {
  let current;
  try { current = reduce(eventsText); } catch (e) { throw new Refused(`the existing ledger is invalid: ${e.message}`); }
  if (expectHead !== undefined && expectHead !== current.ledgerHead) {
    throw new Refused(`the ledger head is ${current.ledgerHead.slice(0, 12)}, not the expected ${String(expectHead).slice(0, 12)}: another decision was recorded; re-read and reconcile`);
  }
  if (event && (Object.hasOwn(event, 'seq') || Object.hasOwn(event, 'prev'))) throw new Refused('seq and prev are assigned by append.mjs, not supplied');
  const lines = ledgerLines(eventsText);
  const full = { seq: lines.length + 1, ...event, prev: lines.length ? sha256(lines[lines.length - 1]) : GENESIS };
  const line = JSON.stringify(full);
  const nextText = `${eventsText}${line}\n`;
  let state;
  try { state = reduce(nextText); } catch (e) { throw new Refused(e.message); }
  const problems = invariants(state);
  if (problems.length) throw new Refused(`the event would break an invariant: ${problems.join('; ')}`);
  return { eventsText: nextText, stateText: serialize(state), state };
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
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${statePath}.tmp`, r.stateText);
  fs.writeFileSync(`${eventsPath}.tmp`, r.eventsText);
  fs.renameSync(`${statePath}.tmp`, statePath);
  fs.renameSync(`${eventsPath}.tmp`, eventsPath);
  return r;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [dir, eventFile, ...rest] = process.argv.slice(2);
  const at = rest.indexOf('--expect-head');
  if (!dir || !eventFile || (rest.length && at === -1)) { console.error('usage: append.mjs <dir> <event.json> [--expect-head <sha256>]'); process.exit(1); }
  try {
    let event;
    try { event = JSON.parse(fs.readFileSync(eventFile, 'utf8')); } catch { throw new Refused('the event file is missing or is not JSON'); }
    const r = appendToDir(dir, event, at === -1 ? {} : { expectHead: rest[at + 1] });
    console.log(`APPENDED seq=${r.state.eventCount} type=${event.type} head=${r.state.ledgerHead}`);
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    console.error(`::error::${e.message}`);
    console.log('APPEND=refused (nothing written)');
    process.exit(1);
  }
}
