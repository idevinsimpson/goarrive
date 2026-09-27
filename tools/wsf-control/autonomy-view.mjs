#!/usr/bin/env node
/**
 * AUTONOMY PROGRESS, derived from the ledger alone and read-only (memo §10.3). No dashboard,
 * no second store: every number is a count over events.jsonl.
 *
 *   node tools/wsf-control/autonomy-view.mjs <control-state dir>
 *
 * Step-5 exit (memo §12): at least 10 real post-bootstrap lines processed by the shadow writer,
 * with the shadow CURRENT matching the human CURRENT. The comparison itself is a reviewer's
 * judgment against the human CURRENT; this view only counts, and says what it cannot measure yet.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkDir } from './check.mjs';
import { ledgerLines } from './reduce.mjs';
import { schemaOf } from './schema.mjs';

export const SHADOW_EXIT_EVENTS = 10;

export function autonomy(eventsText) {
  const events = ledgerLines(eventsText).map((l) => JSON.parse(l));
  const v2 = events.filter((e) => schemaOf(e) === 2);
  const byClass = {}; const byRule = {};
  for (const e of v2) {
    byClass[e.authority.class] = (byClass[e.authority.class] ?? 0) + 1;
    byRule[e.authority.rule] = (byRule[e.authority.rule] ?? 0) + 1;
  }
  const real = v2.filter((e) => e.type !== 'bootstrap').length;
  const lines = [
    `EVENTS total=${events.length} v2=${v2.length} post-bootstrap=${real}`,
    `AUTHORITY ${Object.keys(byClass).sort().map((k) => `${k}=${byClass[k]}`).join(' ') || 'none'}`,
    `RULES ${Object.keys(byRule).sort().map((k) => `${k}=${byRule[k]}`).join(' ') || 'none'}`,
    `SHADOW_EXIT events=${real}/${SHADOW_EXIT_EVENTS} ${real >= SHADOW_EXIT_EVENTS ? 'count met (comparison with the human CURRENT is still a reviewed judgment)' : 'not met'}`,
    'PHASE_E wake→ACK, delivery→reviewer wake and finding→owner wake are not measured until Step 6 (no wakes in Step 5)',
  ];
  return { real, lines };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: autonomy-view.mjs <dir>'); process.exit(2); }
  const checked = checkDir(dir);
  if (!checked.ok) { console.log('AUTONOMY=refused (CONTROL_STATE=invalid)'); process.exit(1); }
  console.log(autonomy(fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8')).lines.join('\n'));
}
