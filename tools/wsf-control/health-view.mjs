#!/usr/bin/env node
/**
 * CONTROL HEALTH, derived and read-only (accepted A+ memo §4.3). Not stored state.
 *
 *   node tools/wsf-control/health-view.mjs <control-state dir> [--facts <health.json>] [--capabilities <capabilities.v1.json>]
 *
 * The facts file holds what only GitHub knows, as closed values:
 *   { "now": "<instant>", "writerRuns": [{ "id", "status", "conclusion", "createdAt" }], "tokenOk": true|false,
 *     "writerPin": "ok"|"unpinned"|"unknown", "exceptions": ["writer-contention", ...] }
 *
 * CONTROL_HEALTH is OK only with fresh positive evidence: a successful writer run within the
 * fallback window, a minted token, the writer pinned and no open exception. Missing facts are
 * UNKNOWN, never OK. "Nothing actionable" is ACTIONABLE=off with CONTROL_HEALTH=OK; an unhealthy
 * writer is DEGRADED or DOWN, never quiet. The accepted residuals and every capability that is not
 * plainly supported are always printed: health never presents a boundary stronger than the real one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkDir } from './check.mjs';
import { ACCEPTED_RESIDUALS } from './render-current.mjs';

/** Twice the 30-minute schedule: a writer silent for longer than this is DOWN. */
export const WRITER_WINDOW_MS = 60 * 60 * 1000;

export function health(state, facts, capabilities = null) {
  const lines = [];
  const reasons = [];
  let label;
  if (!facts) {
    label = 'UNKNOWN';
    reasons.push('no health facts supplied: the writer\'s runs, token and pin are not known');
  } else {
    const now = Date.parse(facts.now);
    const ok = (facts.writerRuns ?? []).filter((r) => r.status === 'completed' && r.conclusion === 'success').sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    if (!ok) { label = 'DOWN'; reasons.push('no successful writer run on record'); }
    else if (!(now - Date.parse(ok.createdAt) <= WRITER_WINDOW_MS)) { label = 'DOWN'; reasons.push(`last successful writer run ${ok.id} is older than ${WRITER_WINDOW_MS / 60000} minutes`); }
    if (facts.tokenOk !== true) reasons.push('writer-token-unavailable');
    if (facts.writerPin !== 'ok') reasons.push(`writer-pin-${facts.writerPin ?? 'unknown'}`);
    for (const x of facts.exceptions ?? []) reasons.push(x);
    if (!label) label = reasons.length ? 'DEGRADED' : 'OK';
    if (ok) lines.push(`LAST_WRITER_RUN=${ok.id} at ${ok.createdAt}`);
  }
  lines.unshift(`CONTROL_HEALTH=${label}${reasons.length ? ` reasons=${reasons.join('; ')}` : ''}`);
  lines.push(`LEDGER schema=${state.schemaVersion} events=${state.eventCount} head=${state.ledgerHead}`);
  if (state.schemaVersion === 2) for (const r of ACCEPTED_RESIDUALS) lines.push(`RESIDUAL ${r}`);
  for (const c of capabilities?.capabilities ?? []) {
    const notPlain = capabilities.actors.filter((a) => c[a] !== 'supported').map((a) => `${a}=${c[a]}`);
    if (notPlain.length) lines.push(`CAPABILITY ${c.action} ${notPlain.join(' ')}`);
  }
  return { label, lines };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const dir = args[0];
  const opt = (k) => { const i = args.indexOf(k); return i > 0 ? args[i + 1] : null; };
  if (!dir) { console.error('usage: health-view.mjs <dir> [--facts <file>] [--capabilities <file>]'); process.exit(2); }
  const checked = checkDir(dir);
  if (!checked.ok) { console.log('CONTROL_HEALTH=DOWN reasons=CONTROL_STATE=invalid'); process.exit(1); }
  const read = (f) => (f ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
  const r = health(checked.state, read(opt('--facts')), read(opt('--capabilities')));
  console.log(r.lines.join('\n'));
  process.exit(r.label === 'OK' ? 0 : 1);
}
