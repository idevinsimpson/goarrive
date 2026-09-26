#!/usr/bin/env node
/**
 * Reconcile the ledger against a supplied GitHub snapshot, BEFORE acting.
 *
 *   node tools/wsf-control/reconcile.mjs <control-state dir> <snapshot.json>
 *
 * Pure and report-only: it reads a state and a snapshot and returns findings.
 * It never mutates either, never writes, never posts and never appends. A
 * finding names who wins:
 *   - github: a FACT (a PR head, a merge, a close, a run's conclusion, the
 *     served SHA, a check-in's state). The ledger is behind; the suggested
 *     event records the fact.
 *   - ledger: a DECISION (a release, a review, an acceptance). GitHub shows
 *     something the ledger never decided; a Fable/L0 decision is needed, and
 *     nothing is inferred from the GitHub side.
 *   - exception: the control surface itself is not as recorded. Fail closed:
 *     nothing is edited or re-created until a decision resolves it.
 *
 * The snapshot shape is in docs/westayfit/ops/CONTROL_STATE.md. It holds
 * pointers and closed values only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RE, isTerminal, screen, sha256 } from './schema.mjs';
import { invariants, checkDir } from './check.mjs';
import { byId, workerWatch } from './derive.mjs';
import { ledgerHeads } from './reduce.mjs';
import { renderCurrent, renderHashes } from './render-current.mjs';

export class SnapshotError extends Error {}

const TOP = ['schemaVersion', 'prs', 'runs', 'inboxHandoffs', 'currentSurface', 'pin', 'staging', 'triggers', 'externalConditions'];
const PR_KEYS = ['state', 'merged', 'headSha', 'mergeSha', 'changedSinceSubject'];
const RUN_STATUS = ['queued', 'in_progress', 'completed'];
const RUN_CONCLUSIONS = ['success', 'failure', 'cancelled', 'timed_out', 'skipped', 'neutral', 'action_required', 'startup_failure', 'stale'];
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const posInt = (v) => Number.isInteger(v) && v > 0;
const keysAre = (v, keys) => isObj(v) && Object.keys(v).sort().join() === [...keys].sort().join();

/** Problems with a snapshot's shape. It carries pointers and closed values only: no titles, bodies or prose. */
export function validateSnapshot(snap) {
  const p = [];
  if (!isObj(snap)) return ['the snapshot must be a JSON object'];
  if (snap.schemaVersion !== 1) p.push('snapshot schemaVersion must be 1');
  for (const k of Object.keys(snap)) if (!TOP.includes(k)) p.push(`snapshot: unknown key ${JSON.stringify(k)}`);
  if (!isObj(snap.prs)) p.push('snapshot.prs must be an object keyed by PR number');
  else {
    for (const [n, pr] of Object.entries(snap.prs)) {
      if (!/^[1-9][0-9]*$/.test(n)) { p.push(`snapshot.prs: ${JSON.stringify(n)} is not a PR number`); continue; }
      if (!isObj(pr)) { p.push(`snapshot.prs.${n} must be an object`); continue; }
      for (const k of Object.keys(pr)) if (!PR_KEYS.includes(k)) p.push(`snapshot.prs.${n}: unknown key ${JSON.stringify(k)} (the snapshot holds pointers, not PR text)`);
      if (!['open', 'closed'].includes(pr.state)) p.push(`snapshot.prs.${n}.state must be open or closed`);
      if (typeof pr.merged !== 'boolean') p.push(`snapshot.prs.${n}.merged must be a boolean`);
      if (pr.merged && pr.state !== 'closed') p.push(`snapshot.prs.${n}: a merged PR is closed`);
      if (typeof pr.headSha !== 'string' || !RE.sha.test(pr.headSha)) p.push(`snapshot.prs.${n}.headSha must be a 40-character SHA`);
      if (pr.mergeSha !== undefined && (typeof pr.mergeSha !== 'string' || !RE.sha.test(pr.mergeSha))) p.push(`snapshot.prs.${n}.mergeSha must be a 40-character SHA`);
      if (pr.merged && pr.mergeSha === undefined) p.push(`snapshot.prs.${n}: a merged PR needs its mergeSha`);
      if (pr.changedSinceSubject !== undefined && !(Array.isArray(pr.changedSinceSubject) && pr.changedSinceSubject.every((x) => typeof x === 'string' && RE.path.test(x) && x !== '*'))) {
        p.push(`snapshot.prs.${n}.changedSinceSubject must be a list of repository paths`);
      }
    }
  }
  if (snap.runs !== undefined) {
    if (!isObj(snap.runs)) p.push('snapshot.runs must be an object keyed by run id');
    else for (const [id, r] of Object.entries(snap.runs)) {
      if (!/^[1-9][0-9]*$/.test(id) || !keysAre(r, ['status', 'conclusion']) || !RUN_STATUS.includes(r.status) ||
        (r.status === 'completed' ? !RUN_CONCLUSIONS.includes(r.conclusion) : r.conclusion !== null)) {
        p.push(`snapshot.runs.${id} must be exactly { status: queued|in_progress|completed, conclusion: a GitHub conclusion once completed, else null }`);
      }
    }
  }
  if (snap.inboxHandoffs !== undefined) {
    if (!Array.isArray(snap.inboxHandoffs)) p.push('snapshot.inboxHandoffs must be a list');
    else snap.inboxHandoffs.forEach((h, i) => {
      if (!keysAre(h, ['commentId', 'inbox', 'packet']) || !posInt(h.inbox) || !posInt(h.commentId) || typeof h.packet !== 'string' || !RE.packet.test(h.packet)) {
        p.push(`snapshot.inboxHandoffs[${i}] must be exactly { inbox, commentId, packet }`);
      }
    });
  }
  if (snap.currentSurface !== undefined) {
    const c = snap.currentSurface;
    const keys = isObj(c) ? Object.keys(c) : [];
    if (!isObj(c) || !['commentId', 'exists', 'markerHead'].every((k) => keys.includes(k)) || keys.some((k) => !['commentId', 'exists', 'markerHead', 'bodySha256'].includes(k)) ||
      !posInt(c.commentId) || typeof c.exists !== 'boolean' ||
      !(c.markerHead === null || (typeof c.markerHead === 'string' && RE.hash.test(c.markerHead))) ||
      (c.bodySha256 !== undefined && c.bodySha256 !== null && typeof c.bodySha256 !== 'string')) {
      // bodySha256's presence and form are judged by surfaceStatus: missing, null or malformed evidence is a
      // closed CURRENT_SURFACE=exception, not a refused snapshot, so every other finding is still reported.
      p.push('snapshot.currentSurface must be exactly { commentId, exists: boolean, markerHead: <64-hex> | null, bodySha256: <64-hex> | null }');
    }
  }
  for (const [k, field] of [['pin', 'approvedAppSha'], ['staging', 'servedSha']]) {
    if (snap[k] === undefined) continue;
    if (!keysAre(snap[k], [field]) || !RE.sha.test(String(snap[k][field]))) p.push(`snapshot.${k} must be exactly { ${field}: <40-character SHA> }`);
  }
  if (snap.triggers !== undefined) {
    if (!isObj(snap.triggers)) p.push('snapshot.triggers must be an object keyed by worker');
    else for (const [w, t] of Object.entries(snap.triggers)) {
      if (!RE.worker.test(w) || !keysAre(t, ['enabled']) || typeof t.enabled !== 'boolean') p.push(`snapshot.triggers.${w} must be exactly { enabled: boolean }`);
    }
  }
  if (snap.externalConditions !== undefined) {
    if (!isObj(snap.externalConditions)) p.push('snapshot.externalConditions must be an object');
    else for (const [id, v] of Object.entries(snap.externalConditions)) {
      if (!RE.packet.test(id) || typeof v !== 'boolean') p.push(`snapshot.externalConditions.${id} must be a boolean`);
    }
  }
  p.push(...screen(snap).map((x) => `snapshot ${x}`));
  return p;
}

/** Is a repository path inside one of a packet's subject paths? '*' is the whole tree; others are a file or directory prefix. */
export function inSubject(file, subjectPaths) {
  return subjectPaths.some((s) => s === '*' || file === s || file.startsWith(s.endsWith('/') ? s : `${s}/`));
}

/**
 * The CURRENT comment the ledger points at, checked before anyone edits it.
 * Three closed outcomes:
 *   ok        the recorded comment exists and carries this head's marker (and,
 *             when the snapshot gives its body hash, this head's rendering);
 *   stale     it carries an EARLIER head of this ledger: the recoverable
 *             crash window (ledger pushed, CURRENT not yet edited). Actionable:
 *             render from the present ledger and edit that comment in place;
 *   exception missing, unreported, another comment, unmarked, a head this
 *             ledger never had, or a body that is not its marker's rendering
 *             (hand-edited, or unverifiable). Fails closed: no edit, no
 *             replacement comment.
 * `heads` is every head the ledger has had; `renders` maps a head to the
 * sha256 of its CURRENT rendering (by default only the present head's).
 */
export function surfaceStatus(state, snap, opts = {}) {
  const { heads = [state.ledgerHead], renders = { [state.ledgerHead]: sha256(renderCurrent(state)) } } = Array.isArray(opts) ? { heads: opts } : opts;
  const exception = (detail) => ({ ok: false, status: 'exception', detail });
  const want = state.surfaces?.current;
  if (!want) return exception('the ledger records no CURRENT surface');
  const c = snap.currentSurface;
  if (!c) return exception('the snapshot does not report the CURRENT comment; it is not edited unchecked');
  if (c.commentId !== want.commentId) return exception(`the snapshot checked comment ${c.commentId}, but the ledger's CURRENT is comment ${want.commentId}`);
  if (!c.exists) return exception(`CURRENT comment ${want.commentId} is missing; it is not re-created without a set-surfaces decision`);
  if (c.markerHead === null) return exception(`CURRENT comment ${want.commentId} carries no control marker`);
  if (!heads.includes(c.markerHead)) return exception(`CURRENT comment ${want.commentId} carries a marker for ${c.markerHead.slice(0, 12)}, which is not a head of this ledger`);
  // Body integrity is required, not optional: a marker alone never makes a surface ok or stale.
  if (c.bodySha256 === undefined || c.bodySha256 === null) return exception(`CURRENT comment ${want.commentId}'s body integrity evidence (bodySha256) is missing or unavailable; build the snapshot entry with current-surface.mjs from the exact body`);
  if (!RE.hash.test(c.bodySha256)) return exception(`CURRENT comment ${want.commentId}'s body integrity evidence (bodySha256) is malformed`);
  {
    const expected = renders[c.markerHead];
    if (!expected) return exception(`CURRENT comment ${want.commentId}'s body cannot be checked against the rendering of ${c.markerHead.slice(0, 12)}`);
    if (expected !== c.bodySha256) return exception(`CURRENT comment ${want.commentId} is not the rendering of the head its marker names (hand-edited)`);
  }
  if (c.markerHead !== state.ledgerHead) {
    return { ok: false, status: 'stale', detail: `CURRENT comment ${want.commentId} was rendered from ${c.markerHead.slice(0, 12)}; the ledger head is ${state.ledgerHead.slice(0, 12)}. Render from the present ledger and edit that comment in place; create no new comment` };
  }
  return { ok: true, status: 'ok', detail: 'current' };
}

const f = (kind, wins, fields) => ({ kind, wins, ...fields });
const AFTER_MERGE = ['INTEGRATED', 'VERIFYING', 'VERIFIED', 'STAGED'];

/**
 * Findings for a (valid) state against a (valid) snapshot. Pure: reads both,
 * mutates neither. `heads` is every head the ledger has had (for the CURRENT
 * marker check); by default only the current one.
 */
export function reconcile(state, snap, { heads, renders } = {}) {
  const problems = validateSnapshot(snap);
  if (problems.length) throw new SnapshotError(problems.join('; '));
  const out = [];
  const prs = snap.prs;

  for (const p of byId(state)) {
    if (p.pr !== null) {
      const pr = prs[String(p.pr)];
      if (!pr) {
        if (!isTerminal(p)) out.push(f('pr-not-in-snapshot', 'github', { packet: p.id, pr: p.pr, detail: 'the snapshot has no facts for this PR; nothing about it is reconciled' }));
      } else if (pr.merged) {
        if (p.artifact.mergeSha === pr.mergeSha) { /* recorded */ } else if (p.phase === 'ACCEPTED') {
          out.push(f('pr-merged-not-integrated', 'github', { packet: p.id, pr: p.pr, detail: `merged as ${pr.mergeSha}`, suggest: { type: 'integrate', packet: p.id, mergeSha: pr.mergeSha, acceptance: p.authority.accepted?.id ?? null, by: 'L0' } }));
        } else if (p.artifact.mergeSha) {
          out.push(f('merge-drift', 'github', { packet: p.id, pr: p.pr, detail: `GitHub merged ${pr.mergeSha}; the ledger records ${p.artifact.mergeSha}` }));
        } else if (p.phase !== 'WITHDRAWN') {
          out.push(f('pr-merged-without-acceptance', 'ledger', { packet: p.id, pr: p.pr, detail: `merged while the ledger says ${p.phase}; the ledger records no acceptance, and none is inferred` }));
        }
      } else if (pr.state === 'closed') {
        if (!isTerminal(p)) out.push(f('pr-closed-not-withdrawn', 'ledger', { packet: p.id, pr: p.pr, detail: `closed unmerged while the ledger says ${p.phase}; withdrawing or redelivering is a decision` }));
      } else if (!isTerminal(p) && !AFTER_MERGE.includes(p.phase) && pr.headSha !== p.artifact.prHeadSha) {
        out.push(f('pr-head-moved', 'github', { packet: p.id, pr: p.pr, detail: `head ${p.artifact.prHeadSha} → ${pr.headSha}`, suggest: { type: 'reconcile-head', packet: p.id, prHeadSha: pr.headSha } }));
        if (pr.headSha !== p.artifact.subjectSha) {
          if (pr.changedSinceSubject === undefined) {
            out.push(f('subject-change-unknown', 'github', { packet: p.id, pr: p.pr, detail: 'no changedSinceSubject in the snapshot; whether the reviewed subject changed is not determined' }));
          } else {
            const touched = pr.changedSinceSubject.filter((x) => inSubject(x, p.subjectPaths));
            out.push(touched.length
              ? f('subject-stale', 'ledger', { packet: p.id, pr: p.pr, detail: `${touched.length} subject path(s) changed since ${p.artifact.subjectSha} (${touched.slice(0, 5).join(', ')}); ${p.phase} applies to the old subject until a successor deliver` })
              : f('evidence-moved', 'github', { packet: p.id, pr: p.pr, detail: `only non-subject paths changed since ${p.artifact.subjectSha}; the reviewed subject stands`, suggest: { type: 'record-evidence', packet: p.id, evidenceSha: pr.headSha } }));
          }
        }
      }
    }
    // Proof runs: GitHub is the authority for a run's conclusion; the ledger is never silently corrected.
    if (p.proof && snap.runs) {
      const run = snap.runs[String(p.proof.runId)];
      if (!run) {
        if (p.phase === 'VERIFYING') out.push(f('run-not-in-snapshot', 'github', { packet: p.id, run: p.proof.runId, detail: 'the snapshot has no facts for the proof run' }));
      } else if (p.proof.result === 'RUNNING' && run.status === 'completed') {
        out.push(f('proof-run-concluded', 'github', {
          packet: p.id, run: p.proof.runId, detail: `the ledger says RUNNING; the run concluded ${run.conclusion}`,
          suggest: run.conclusion === 'success'
            ? { type: p.completion.terminal === 'VERIFIED' ? 'proof-pass' : 'stage', packet: p.id, runId: p.proof.runId, by: 'L0' }
            : { type: 'proof-fail', packet: p.id, runId: p.proof.runId, by: 'Fable', source: 'a focused finding comment' },
        }));
      } else if (p.proof.result === 'PASS' && (run.status !== 'completed' || run.conclusion !== 'success')) {
        out.push(f('proof-result-drift', 'github', { packet: p.id, run: p.proof.runId, detail: `the ledger records PASS; the run is ${run.status}${run.conclusion ? ` (${run.conclusion})` : ''}` }));
      } else if (p.proof.result === 'FAIL' && run.status === 'completed' && run.conclusion === 'success') {
        out.push(f('proof-result-drift', 'github', { packet: p.id, run: p.proof.runId, detail: 'the ledger records FAIL; the run concluded success' }));
      }
    }
  }

  for (const h of snap.inboxHandoffs ?? []) {
    const p = state.packets[h.packet];
    const inboxOwner = Object.keys(state.workers).find((w) => state.workers[w].inbox === h.inbox) ?? null;
    if (!p) {
      out.push(f('handoff-without-packet', 'ledger', { packet: h.packet, inbox: h.inbox, commentId: h.commentId, detail: 'a handoff names a packet the ledger does not have; it is not work until a decision queues it' }));
      continue;
    }
    if (inboxOwner !== p.owner) {
      out.push(f('handoff-outside-canonical-inbox', 'ledger', { packet: h.packet, inbox: h.inbox, commentId: h.commentId, detail: `${p.owner}'s canonical inbox is #${state.workers[p.owner]?.inbox}` }));
      continue;
    }
    const known = [...Object.values(p.authority), ...p.importRefs].filter((r) => r && r.kind === 'comment').map((r) => r.id);
    if (!known.includes(h.commentId)) {
      out.push(f('handoff-not-recorded', 'ledger', { packet: h.packet, inbox: h.inbox, commentId: h.commentId, detail: `the ledger's last transition for this packet rests on ${p.authority.lastTransition?.kind}:${p.authority.lastTransition?.id} (${p.phase})` }));
    }
  }

  if (state.surfaces?.current) {
    const sfc = surfaceStatus(state, snap, { ...(heads ? { heads } : {}), ...(renders ? { renders } : {}) });
    if (sfc.status === 'exception') out.push(f('control-surface-exception', 'exception', { detail: sfc.detail }));
    if (sfc.status === 'stale') {
      out.push(f('current-surface-stale', 'ledger', { detail: sfc.detail, suggest: { action: 'render-current-and-edit-in-place', commentId: state.surfaces.current.commentId, head: state.ledgerHead } }));
    }
  }

  if (snap.pin && state.staging && snap.pin.approvedAppSha !== state.staging.servedSha) {
    out.push(f('pin-mismatch', 'github', { detail: `the approved pin is ${snap.pin.approvedAppSha}; the ledger's staging pointer is ${state.staging.servedSha}` }));
  }
  if (snap.staging && state.staging && snap.staging.servedSha !== state.staging.servedSha) {
    out.push(f('staging-mismatch', 'github', { detail: `staging serves ${snap.staging.servedSha}; the ledger's staging pointer is ${state.staging.servedSha}` }));
  }
  if ((snap.pin || snap.staging) && !state.staging) {
    out.push(f('staging-pointer-missing', 'github', { detail: 'the snapshot carries staging facts but the ledger has no staging pointer' }));
  }

  for (const [w, t] of Object.entries(snap.triggers ?? {})) {
    if (!state.workers[w]) { out.push(f('trigger-for-unknown-worker', 'ledger', { worker: w, detail: 'a check-in exists for a worker the ledger has not registered' })); continue; }
    const derived = workerWatch(state, w);
    if (t.enabled && !derived) out.push(f('watch-on-without-work', 'github', { worker: w, detail: 'the check-in is enabled but the worker holds no active or awaiting-review packet' }));
    if (!t.enabled && derived) out.push(f('work-without-watch', 'github', { worker: w, detail: 'the worker holds work but its check-in is disabled' }));
  }

  // A state that reduced from a valid ledger holds these; a supplied state that does not is reported, never repaired.
  for (const x of invariants(state)) out.push(f('queue-phase-inconsistent', 'ledger', { detail: x }));
  return out;
}

/** The closed CURRENT_SURFACE value for a set of findings: exception over stale over ok. */
export const surfaceLabel = (findings) => (findings.some((x) => x.kind === 'control-surface-exception') ? 'exception'
  : findings.some((x) => x.kind === 'current-surface-stale') ? 'stale' : 'ok');

export function formatFinding(x) {
  const where = [x.packet && `packet=${x.packet}`, x.worker && `worker=${x.worker}`, x.pr && `pr=#${x.pr}`, x.run && `run=${x.run}`, x.inbox && `inbox=#${x.inbox}`, x.commentId && `comment=${x.commentId}`].filter(Boolean).join(' ');
  const suggest = x.suggest ? ` suggest=${JSON.stringify(x.suggest)}` : '';
  return `FINDING kind=${x.kind} wins=${x.wins}${where ? ` ${where}` : ''} :: ${x.detail}${suggest}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [dir, snapFile] = process.argv.slice(2);
  if (!dir || !snapFile) { console.error('usage: reconcile.mjs <control-state dir> <snapshot.json>'); process.exit(2); }
  const checked = checkDir(dir);
  if (!checked.ok) { for (const p of checked.problems) console.error(`::error::${p}`); console.log('RECONCILE=refused (the control state is invalid)'); process.exit(2); }
  let snap;
  try { snap = JSON.parse(fs.readFileSync(snapFile, 'utf8')); } catch { console.log('RECONCILE=refused (the snapshot is missing or is not JSON)'); process.exit(2); }
  let findings;
  const eventsText = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8');
  try { findings = reconcile(checked.state, snap, { heads: ledgerHeads(eventsText), renders: renderHashes(eventsText) }); } catch (e) {
    if (!(e instanceof SnapshotError)) throw e;
    console.error(`::error::${e.message}`);
    console.log('RECONCILE=refused (the snapshot is malformed)');
    process.exit(2);
  }
  for (const x of findings) console.log(formatFinding(x));
  console.log(`CURRENT_SURFACE=${surfaceLabel(findings)}`);
  console.log(`RECONCILE findings=${findings.length} head=${checked.state.ledgerHead}`);
}
