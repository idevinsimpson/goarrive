/**
 * Ledger → state. The ledger (events.jsonl) is the input; state.json is derived
 * output and is never hand-edited: `serialize(reduce(events)) === state.json`
 * is checked by check.mjs.
 *
 * Each line's `prev` is the sha256 of the previous line's exact text (GENESIS
 * for the bootstrap line), and `seq` counts from 1, so a removed, reordered,
 * edited or concurrently appended line breaks the chain and the whole ledger
 * is refused. Each line's `id` is its event identity (schema.mjs eventId), and
 * no identity appears twice.
 */
import fs from 'node:fs';
import { GENESIS, eventId, sha256, validateEvent } from './schema.mjs';
import { applyEvent, emptyState } from './transitions.mjs';

export { sha256 };
export class LedgerError extends Error {}

/** Split a ledger file into lines; a trailing newline is required and blank lines are not allowed. */
export function ledgerLines(text) {
  if (text === '') return [];
  if (!text.endsWith('\n')) throw new LedgerError('the ledger must end with a newline');
  const lines = text.slice(0, -1).split('\n');
  lines.forEach((l, i) => { if (l.trim() === '') throw new LedgerError(`ledger line ${i + 1} is blank`); });
  return lines;
}

/** Every head the ledger has had, oldest first (the head after each line). */
export const ledgerHeads = (text) => ledgerLines(text).map(sha256);

/** Reduce ledger text to a state, verifying every line's shape, identity, chain and legality. */
export function reduce(text) {
  let state = emptyState();
  let prev = GENESIS;
  const ids = new Set();
  for (const [i, line] of ledgerLines(text).entries()) {
    let e;
    try { e = JSON.parse(line); } catch { throw new LedgerError(`ledger line ${i + 1} is not JSON`); }
    const problems = validateEvent(e);
    if (problems.length) throw new LedgerError(`ledger line ${i + 1}: ${problems.join('; ')}`);
    if (e.seq !== i + 1) throw new LedgerError(`ledger line ${i + 1}: seq is ${e.seq}, expected ${i + 1}`);
    if (e.prev !== prev) throw new LedgerError(`ledger line ${i + 1}: prev does not match the previous line (the chain is broken)`);
    if (e.id !== eventId(e)) throw new LedgerError(`ledger line ${i + 1}: id is not the event's identity`);
    if (ids.has(e.id)) throw new LedgerError(`ledger line ${i + 1}: the same event identity is recorded twice`);
    ids.add(e.id);
    try { state = applyEvent(state, e); } catch (err) { throw new LedgerError(`ledger line ${i + 1} (${e.type}): ${err.message}`); }
    prev = sha256(line);
    state.ledgerHead = prev;
  }
  return state;
}

const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));

/** The canonical, byte-stable serialization of a state (packets, workers and queues in key order). */
export function serialize(state) {
  return `${JSON.stringify({ ...state, workers: sortKeys(state.workers), queue: sortKeys(state.queue), packets: sortKeys(state.packets) }, null, 2)}\n`;
}

export const readLedger = (path) => (fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '');
