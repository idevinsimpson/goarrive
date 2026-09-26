#!/usr/bin/env node
/**
 * The program view for the global Fable loop: the critical path, the
 * transitions waiting on Fable/L0, and what reconcile found. Read-only; it
 * lists what needs a decision and makes none. It never posts, merges, deploys
 * or appends.
 *
 *   node tools/wsf-control/program-view.mjs <control-state dir> [--snapshot <snapshot.json>]
 *
 * Without a snapshot, external blockers are never reported cleared and no
 * GitHub facts are reconciled; the view says so.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REVIEWER_OWNED, WORKER_OWNED } from './schema.mjs';
import { checkDir } from './check.mjs';
import { byId, neededTransitions } from './derive.mjs';
import { SnapshotError, formatFinding, reconcile } from './reconcile.mjs';

/** The view's lines. `snapshot` is optional. */
export function programView(s, snapshot = null) {
  const out = [];
  const cp = s.criticalPath ? s.packets[s.criticalPath] : null;
  out.push(`CRITICAL_PATH=${cp ? `${s.criticalPath} phase=${cp.phase} owner=${cp.owner}${cp.pr ? ` pr=#${cp.pr}` : ''}` : 'none'}`);
  const needed = neededTransitions(s, snapshot);
  for (const n of needed) out.push(`NEEDS_TRANSITION ${n.packet} event=${n.event} by=${n.by} :: ${n.why}`);
  const packets = byId(s).filter((p) => p.kind === 'work');
  for (const p of packets.filter((x) => x.phase === 'ACCEPTED')) out.push(`ACCEPTED_NOT_INTEGRATED ${p.id} subject=${p.artifact.subjectSha}${p.pr ? ` pr=#${p.pr}` : ''}`);
  for (const p of packets.filter((x) => x.phase === 'INTEGRATED' && x.track === 'product')) out.push(`INTEGRATED_NOT_STAGED ${p.id} merge=${p.artifact.mergeSha}`);
  for (const n of needed.filter((x) => x.event === 'unblock')) out.push(`BLOCKERS_CLEARED ${n.packet}`);
  const findings = snapshot ? reconcile(s, snapshot) : [];
  for (const x of findings.filter((y) => ['watch-on-without-work', 'work-without-watch', 'trigger-for-unknown-worker'].includes(y.kind))) {
    out.push(`WATCH_INCONSISTENT ${x.worker} ${x.kind}`);
  }
  for (const x of findings) out.push(formatFinding(x));
  if (!snapshot) out.push('SNAPSHOT=none (external blockers not evaluated; GitHub facts not reconciled)');
  const moving = packets.some((p) => WORKER_OWNED.includes(p.phase) || REVIEWER_OWNED.includes(p.phase));
  out.push(`PROGRAM_WATCH=${moving || needed.length > 0 || findings.length > 0 ? 'on' : 'off'}`);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [dir, flag, file] = process.argv.slice(2);
  if (!dir || (flag && (flag !== '--snapshot' || !file))) { console.error('usage: program-view.mjs <control-state dir> [--snapshot <snapshot.json>]'); process.exit(2); }
  const checked = checkDir(dir);
  if (!checked.ok) { for (const p of checked.problems) console.error(`::error::${p}`); console.log('PROGRAM_VIEW=refused (the control state is invalid)'); process.exit(2); }
  let snap = null;
  if (flag) {
    try { snap = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { console.log('PROGRAM_VIEW=refused (the snapshot is missing or is not JSON)'); process.exit(2); }
  }
  try { console.log(programView(checked.state, snap).join('\n')); } catch (e) {
    if (!(e instanceof SnapshotError)) throw e;
    console.error(`::error::${e.message}`);
    console.log('PROGRAM_VIEW=refused (the snapshot is malformed)');
    process.exit(2);
  }
}
