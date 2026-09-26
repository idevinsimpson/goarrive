#!/usr/bin/env node
/**
 * Reconcile the ledger against a supplied GitHub snapshot, BEFORE acting.
 *
 *   node tools/wsf-control/reconcile.mjs <control-state dir> <snapshot.json>
 *
 * Pure and report-only: it reads a state and a snapshot and returns findings.
 * It never mutates either, never writes, never posts and never appends. A
 * finding names who wins:
 *   - github: a FACT (a PR head, a merge, a close, the served SHA, a trigger's
 *     state). The ledger is behind; the suggested event records the fact.
 *   - ledger: a DECISION (a release, a review, an acceptance). GitHub shows
 *     something the ledger never decided; a Fable/L0 decision is needed, and
 *     nothing is inferred from the GitHub side.
 *
 * The snapshot is built by the session from GitHub (see
 * docs/westayfit/ops/CONTROL_STATE.md) and holds pointers only:
 *
 *   { "schemaVersion": 1,
 *     "prs": { "<n>": { "state": "open"|"closed", "merged": bool, "headSha": "<40>",
 *                       "mergeSha": "<40>"?, "changedSinceSubject": ["path", ...]? } },
 *     "inboxHandoffs": [ { "inbox": <n>, "commentId": <n>, "packet": "<ID>" } ],
 *     "pin": { "approvedAppSha": "<40>" }?,
 *     "staging": { "servedSha": "<40>" }?,
 *     "triggers": { "W3": { "enabled": bool } }?,
 *     "externalConditions": { "<ID>": bool }? }
 *
 * `changedSinceSubject` is the list of paths changed between the packet's
 * subjectSha and the PR's current head. With it, a head move is classified:
 * the subject is stale only when a changed path is inside the packet's
 * subjectPaths; otherwise the move is evidence/doc practice and the reviewed
 * subject still stands. Without it, the classification is reported as unknown.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RE, isTerminal, screen } from './schema.mjs';
import { invariants, checkDir } from './check.mjs';
import { byId, workerWatch } from './derive.mjs';

export class SnapshotError extends Error {}

const TOP = ['schemaVersion', 'prs', 'inboxHandoffs', 'pin', 'staging', 'triggers', 'externalConditions'];
const PR_KEYS = ['state', 'merged', 'headSha', 'mergeSha', 'changedSinceSubject'];
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const posInt = (v) => Number.isInteger(v) && v > 0;

/** Problems with a snapshot's shape. It carries pointers and booleans only: no titles, bodies or prose. */
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
  if (snap.inboxHandoffs !== undefined) {
    if (!Array.isArray(snap.inboxHandoffs)) p.push('snapshot.inboxHandoffs must be a list');
    else snap.inboxHandoffs.forEach((h, i) => {
      if (!isObj(h) || Object.keys(h).sort().join() !== 'commentId,inbox,packet' || !posInt(h.inbox) || !posInt(h.commentId) || typeof h.packet !== 'string' || !RE.packet.test(h.packet)) {
        p.push(`snapshot.inboxHandoffs[${i}] must be exactly { inbox, commentId, packet }`);
      }
    });
  }
  for (const [k, field] of [['pin', 'approvedAppSha'], ['staging', 'servedSha']]) {
    if (snap[k] === undefined) continue;
    if (!isObj(snap[k]) || Object.keys(snap[k]).join() !== field || !RE.sha.test(String(snap[k][field]))) p.push(`snapshot.${k} must be exactly { ${field}: <40-character SHA> }`);
  }
  if (snap.triggers !== undefined) {
    if (!isObj(snap.triggers)) p.push('snapshot.triggers must be an object keyed by worker');
    else for (const [w, t] of Object.entries(snap.triggers)) {
      if (!RE.worker.test(w) || !isObj(t) || Object.keys(t).join() !== 'enabled' || typeof t.enabled !== 'boolean') p.push(`snapshot.triggers.${w} must be exactly { enabled: boolean }`);
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

const f = (kind, wins, fields) => ({ kind, wins, ...fields });

/** Findings for a (valid) state against a (valid) snapshot. Pure: reads both, mutates neither. */
export function reconcile(state, snap) {
  const problems = validateSnapshot(snap);
  if (problems.length) throw new SnapshotError(problems.join('; '));
  const out = [];
  const prs = snap.prs;

  for (const p of byId(state)) {
    if (p.pr === null) continue;
    const pr = prs[String(p.pr)];
    if (!pr) {
      if (!isTerminal(p)) out.push(f('pr-not-in-snapshot', 'github', { packet: p.id, pr: p.pr, detail: 'the snapshot has no facts for this PR; nothing about it is reconciled' }));
      continue;
    }
    if (pr.merged) {
      if (!['INTEGRATED', 'STAGED', 'WITHDRAWN'].includes(p.phase)) {
        out.push(p.phase === 'ACCEPTED'
          ? f('pr-merged-not-integrated', 'github', { packet: p.id, pr: p.pr, detail: `merged as ${pr.mergeSha}`, suggest: { type: 'integrate', packet: p.id, mergeSha: pr.mergeSha, by: 'L0' } })
          : f('pr-merged-without-acceptance', 'ledger', { packet: p.id, pr: p.pr, detail: `merged while the ledger says ${p.phase}; the ledger records no acceptance, and none is inferred` }));
      }
      continue;
    }
    if (pr.state === 'closed') {
      if (!isTerminal(p)) out.push(f('pr-closed-not-withdrawn', 'ledger', { packet: p.id, pr: p.pr, detail: `closed unmerged while the ledger says ${p.phase}; withdrawing or redelivering is a decision` }));
      continue;
    }
    if (isTerminal(p) || p.phase === 'INTEGRATED') continue;
    if (pr.headSha === p.artifact.prHeadSha) continue;
    out.push(f('pr-head-moved', 'github', { packet: p.id, pr: p.pr, detail: `head ${p.artifact.prHeadSha} → ${pr.headSha}`, suggest: { type: 'reconcile-head', packet: p.id, prHeadSha: pr.headSha } }));
    if (pr.headSha === p.artifact.subjectSha) continue;
    if (pr.changedSinceSubject === undefined) {
      out.push(f('subject-change-unknown', 'github', { packet: p.id, pr: p.pr, detail: 'no changedSinceSubject in the snapshot; whether the reviewed subject changed is not determined' }));
    } else {
      const touched = pr.changedSinceSubject.filter((x) => inSubject(x, p.subjectPaths));
      if (touched.length) {
        out.push(f('subject-stale', 'ledger', {
          packet: p.id, pr: p.pr,
          detail: `${touched.length} subject path(s) changed since ${p.artifact.subjectSha} (${touched.slice(0, 5).join(', ')}); ${p.phase} applies to the old subject until a successor deliver`,
        }));
      } else {
        out.push(f('evidence-moved', 'github', {
          packet: p.id, pr: p.pr,
          detail: `only non-subject paths changed since ${p.artifact.subjectSha}; the reviewed subject stands`,
          suggest: { type: 'record-evidence', packet: p.id, evidenceSha: pr.headSha },
        }));
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
    const known = [p.authority.queued, p.authority.released, p.authority.lastTransition];
    if (!known.includes(h.commentId)) {
      out.push(f('handoff-not-recorded', 'ledger', { packet: h.packet, inbox: h.inbox, commentId: h.commentId, detail: `the ledger's last decision for this packet is ${p.authority.lastTransition} (${p.phase})` }));
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

export function formatFinding(x) {
  const where = [x.packet && `packet=${x.packet}`, x.worker && `worker=${x.worker}`, x.pr && `pr=#${x.pr}`, x.inbox && `inbox=#${x.inbox}`, x.commentId && `comment=${x.commentId}`].filter(Boolean).join(' ');
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
  try { findings = reconcile(checked.state, snap); } catch (e) {
    if (!(e instanceof SnapshotError)) throw e;
    console.error(`::error::${e.message}`);
    console.log('RECONCILE=refused (the snapshot is malformed)');
    process.exit(2);
  }
  for (const x of findings) console.log(formatFinding(x));
  console.log(`RECONCILE findings=${findings.length} head=${checked.state.ledgerHead}`);
}
