#!/usr/bin/env node
/**
 * STAGING FRESHNESS and JOURNEY VERIFICATION, derived and read-only, as two separate
 * dimensions (autonomy contract v1.1; memo §9.1). Nothing here is stored.
 *
 *   node tools/wsf-control/freshness-view.mjs <control-state dir> <facts.json>
 *
 * facts: { "candidateSha": "<the newest preview-eligible accepted SHA; in Step 5 the approved pin>",
 *          "servedSha": "<the served marker>", "activeRun": null | { "id", "status" },
 *          "lastRun": null | { "id", "conclusion" } }
 *
 *   FRESH     served === candidate;
 *   DEPLOYING a staging run is queued or in progress;
 *   BLOCKED   the last run failed and nothing newer is running (the known-good served SHA and the
 *             ledger's rollback SHA are printed, never guessed);
 *   BEHIND    otherwise: the candidate is not served and nothing is deploying (ACTIONABLE).
 * Missing facts are UNKNOWN. JOURNEY_VERIFICATION is per journey-activation packet and never
 * changes the freshness label: a packet can be FRESH on staging while its journey is PENDING.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkDir } from './check.mjs';
import { byId } from './derive.mjs';

export function freshness(state, facts) {
  const lines = [];
  let label;
  if (!facts?.candidateSha || !facts?.servedSha) label = 'UNKNOWN';
  else if (facts.servedSha === facts.candidateSha) label = 'FRESH';
  else if (facts.activeRun && ['queued', 'in_progress'].includes(facts.activeRun.status)) label = 'DEPLOYING';
  else if (facts.lastRun && facts.lastRun.conclusion && facts.lastRun.conclusion !== 'success') label = 'BLOCKED';
  else label = 'BEHIND';
  lines.push(`STAGING_FRESHNESS=${label}`);
  if (facts?.servedSha) lines.push(`SERVED=${facts.servedSha}`);
  if (facts?.candidateSha) lines.push(`CANDIDATE=${facts.candidateSha}`);
  if (label === 'BLOCKED') lines.push(`KNOWN_GOOD=${facts.servedSha} ROLLBACK=${state.staging?.rollbackSha ?? 'not recorded'} FAILED_RUN=${facts.lastRun.id}`);
  if (label === 'BEHIND') lines.push('ACTIONABLE=on reason=the candidate is not served and nothing is deploying');
  for (const p of byId(state).filter((x) => x.completion.proofType === 'journey-activation')) {
    const j = p.phase === 'VERIFIED' ? 'VERIFIED' : p.phase === 'BLOCKED' || p.proof?.result === 'FAIL' ? 'BLOCKED' : 'PENDING';
    lines.push(`JOURNEY_VERIFICATION ${p.id}=${j}`);
  }
  return { label, lines };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [dir, file] = process.argv.slice(2);
  if (!dir) { console.error('usage: freshness-view.mjs <dir> <facts.json>'); process.exit(2); }
  const checked = checkDir(dir);
  if (!checked.ok) { console.log('STAGING_FRESHNESS=UNKNOWN reason=CONTROL_STATE=invalid'); process.exit(1); }
  const r = freshness(checked.state, file ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
  console.log(r.lines.join('\n'));
}
