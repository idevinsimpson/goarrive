#!/usr/bin/env node
/**
 * One worker's view: what it holds now, what it waits on, what is next, and
 * whether its check-in should be on. Read-only; it makes no judgment and
 * changes nothing.
 *
 *   node tools/wsf-control/worker-view.mjs <control-state dir> W3
 *
 * WATCH=on only while the worker holds the ball: a worker-owned packet it
 * implements, or an UNDER_REVIEW packet it is assigned to review. Its own
 * delivered packet waiting on someone else, a blocked packet and a reference
 * packet never keep WATCH on.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RE } from './schema.mjs';
import { checkDir } from './check.mjs';
import { fmtRef, workerBuckets, workerWatch } from './derive.mjs';

const line = (p) => [
  p.id, `phase=${p.phase}`, p.pr ? `pr=#${p.pr}` : null,
  p.artifact.subjectSha ? `subject=${p.artifact.subjectSha}` : null,
  p.artifact.prHeadSha && p.artifact.prHeadSha !== p.artifact.subjectSha ? `prHead=${p.artifact.prHeadSha}` : null,
  p.reviewers.length ? `reviewers=${p.reviewers.join(',')}` : null,
  p.proof ? `proof=${p.proof.runId}:${p.proof.result}` : null,
].filter(Boolean).join(' ');

/** The view's lines for one worker. */
export function workerView(s, worker) {
  if (!s.workers[worker]) throw new Error(`worker ${worker} is not registered`);
  const b = workerBuckets(s, worker);
  const out = [`WORKER=${worker} inbox=#${s.workers[worker].inbox}`];
  out.push(`ACTIVE_NOW=${b.active.length ? line(b.active[0]) : 'none'}`);
  if (b.reviewing.length === 0) out.push('REVIEWING=none');
  for (const p of b.reviewing) out.push(`REVIEWING=${line(p)} owner=${p.owner}`);
  for (const p of b.waiting) out.push(`WAITING=${p.id} phase=${p.phase} (waiting on review; does not keep WATCH on)`);
  for (const p of b.blocked) out.push(`BLOCKED=${p.id} (not work; does not keep WATCH on)`);
  out.push(`NEXT=${b.next ?? 'none'}`);
  out.push(`WATCH=${workerWatch(s, worker) ? 'on' : 'off'}`);
  for (const p of [...b.active, ...b.reviewing]) {
    out.push(`AUTHORITY ${p.id} origin=${p.origin} queued=${fmtRef(p.authority.queued)} released=${fmtRef(p.authority.released)} last=${fmtRef(p.authority.lastTransition)}`);
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [dir, worker] = process.argv.slice(2);
  if (!dir || !worker || !RE.worker.test(worker)) { console.error('usage: worker-view.mjs <control-state dir> W#'); process.exit(2); }
  const checked = checkDir(dir);
  if (!checked.ok) { for (const p of checked.problems) console.error(`::error::${p}`); console.log('WORKER_VIEW=refused (the control state is invalid)'); process.exit(2); }
  try { console.log(workerView(checked.state, worker).join('\n')); } catch (e) { console.error(`::error::${e.message}`); process.exit(2); }
}
