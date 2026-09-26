#!/usr/bin/env node
/**
 * The program view for the global Fable loop: the critical path, the
 * transitions waiting on Fable/L0, and what reconcile found. Read-only; it
 * lists what needs a decision and makes none. It never posts, merges, deploys
 * or appends.
 *
 *   node tools/wsf-control/program-view.mjs <control-state dir> [--snapshot <snapshot.json>]
 *
 * ACTIONABLE=on|off says whether any transition, handoff or update is needed
 * now. MONITOR=on is constant in v1: one lightweight global heartbeat stays
 * enabled even when nothing is actionable, so a dependency that clears while
 * every worker's WATCH is off is still noticed and the right worker is
 * reactivated. Only a separately accepted event mechanism may change that.
 *
 * Without a snapshot, external blockers are never reported cleared, run
 * conclusions are unknown and no GitHub facts are reconciled; the view says so.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkDir } from './check.mjs';
import { byId, neededTransitions } from './derive.mjs';
import { SnapshotError, formatFinding, reconcile } from './reconcile.mjs';
import { ledgerHeads } from './reduce.mjs';

/** The view's lines. `snapshot` is optional; `heads` is every head the ledger has had. */
export function programView(s, snapshot = null, { heads } = {}) {
  const out = [];
  const cp = s.criticalPath ? s.packets[s.criticalPath] : null;
  out.push(`CRITICAL_PATH=${cp ? `${s.criticalPath} phase=${cp.phase} owner=${cp.owner}${cp.pr ? ` pr=#${cp.pr}` : ''}` : 'none'}`);
  const needed = neededTransitions(s, snapshot);
  for (const n of needed) out.push(`NEEDS_TRANSITION ${n.packet} event=${n.event} by=${n.by}${n.reactivates ? ` reactivates=${n.reactivates}` : ''} :: ${n.why}`);
  const packets = byId(s).filter((p) => p.kind === 'work');
  for (const p of packets.filter((x) => x.phase === 'ACCEPTED')) out.push(`ACCEPTED_NOT_INTEGRATED ${p.id} subject=${p.artifact.subjectSha}${p.pr ? ` pr=#${p.pr}` : ''}`);
  for (const p of packets.filter((x) => ['INTEGRATED', 'VERIFYING'].includes(x.phase) && x.completion.terminal === 'VERIFIED')) {
    out.push(`INTEGRATED_NOT_VERIFIED ${p.id} merge=${p.artifact.mergeSha}${p.proof ? ` run=${p.proof.runId} result=${p.proof.result}` : ''}`);
  }
  for (const p of packets.filter((x) => ['INTEGRATED', 'VERIFYING'].includes(x.phase) && x.completion.terminal === 'STAGED')) out.push(`INTEGRATED_NOT_STAGED ${p.id} merge=${p.artifact.mergeSha}`);
  for (const n of needed.filter((x) => x.event === 'unblock')) out.push(`BLOCKERS_CLEARED ${n.packet}`);
  const findings = snapshot ? reconcile(s, snapshot, { heads }) : [];
  for (const x of findings.filter((y) => ['watch-on-without-work', 'work-without-watch', 'trigger-for-unknown-worker'].includes(y.kind))) {
    out.push(`WATCH_INCONSISTENT ${x.worker} ${x.kind}`);
  }
  for (const x of findings) out.push(formatFinding(x));
  if (!snapshot) out.push('SNAPSHOT=none (external blockers not evaluated; run conclusions unknown; GitHub facts not reconciled)');
  out.push(`CURRENT_SURFACE=${!snapshot ? 'unchecked' : findings.some((x) => x.kind === 'control-surface-exception') ? 'exception' : 'ok'}`);
  out.push(`ACTIONABLE=${needed.length > 0 || findings.length > 0 ? 'on' : 'off'}`);
  out.push('MONITOR=on');
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
  const heads = ledgerHeads(fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8'));
  try { console.log(programView(checked.state, snap, { heads }).join('\n')); } catch (e) {
    if (!(e instanceof SnapshotError)) throw e;
    console.error(`::error::${e.message}`);
    console.log('PROGRAM_VIEW=refused (the snapshot is malformed)');
    process.exit(2);
  }
}
