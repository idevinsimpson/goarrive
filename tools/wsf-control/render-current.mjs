#!/usr/bin/env node
/**
 * Render CURRENT.md, the human-readable view of the control state. Derived,
 * deterministic and byte-stable: the same state always renders the same bytes,
 * and the first line embeds the ledger head it was rendered from.
 *
 *   node tools/wsf-control/render-current.mjs <dir>                   # print
 *   node tools/wsf-control/render-current.mjs <dir> --out <file>      # write
 *   node tools/wsf-control/render-current.mjs <dir> --verify <file>   # CURRENT=current | stale | hand-edited
 *
 * CURRENT.md is never edited by hand and is never read back as input: a
 * decision goes through append.mjs, then CURRENT is re-rendered.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkDir } from './check.mjs';
import { byId, fmtRef, workerBuckets, workerWatch } from './derive.mjs';
import { ledgerLines, reduce, sha256 } from './reduce.mjs';

export const MARKER = /^<!-- wsf-control ledgerHead=([0-9a-f]{64}) events=(\d+) /;
/**
 * The three v1 residuals the Director accepted with architecture A+ (#530 5856346657). A v2 rendering always shows
 * them: the control plane never presents a boundary stronger than the one it has.
 */
export const ACCEPTED_RESIDUALS = Object.freeze([
  'worker-origin facts are ATTESTED, not identity-authenticated: every role posts as the same GitHub user',
  'the writer boundary is only as strong as operational main: a malicious writer change is detected (writer-code pin), not prevented',
  'a dead worker session is a typed wake-undelivered exception that a human or the Director reassigns; it is never respawned automatically',
]);
const s8 = (x) => (x ? x.slice(0, 8) : '—');
const cell = (x) => String(x ?? '—').replace(/\|/g, '\\|');

/** The CURRENT.md text for a state. */
/** The recovery ref that supersedes `ref` (wsf-control-state → -2, -N → -(N+1)). */
const successorRef = (ref) => { const m = /-(\d+)$/.exec(ref); return `wsf-control-state-${m ? Number(m[1]) + 1 : 2}`; };

export function renderCurrent(s) {
  const L = [];
  L.push(`<!-- wsf-control ledgerHead=${s.ledgerHead} events=${s.eventCount} rendered by tools/wsf-control/render-current.mjs; do not edit -->`);
  L.push('# WSF control state: CURRENT');
  L.push('');
  // A ledger without `supersedes` renders byte for byte as before: a recovery run checks its predecessor's comment
  // against the predecessor's renderings, recomputed by this code.
  const branch = s.supersedes ? successorRef(s.supersedes.ref) : 'wsf-control-state';
  L.push(`Derived from \`events.jsonl\` on the \`${branch}\` branch. Do not edit; record a decision with \`append.mjs\`, then re-render.`);
  L.push('GitHub is the authority for facts (PR state, heads, CI, comments). This page records decisions and pointers only.');
  L.push('');
  L.push(`- Repository: \`${s.repository}\``);
  L.push(`- Ledger head: \`${s.ledgerHead}\` (${s.eventCount} events)`);
  L.push(`- Genesis: bootstrap as of ${s.asOf}. Packets whose origin is \`bootstrap\` were imported in their phase at that instant; the ledger did not observe their earlier transitions.`);
  if (s.supersedes) L.push(`- Supersedes: \`${s.supersedes.ref}\` at commit \`${s.supersedes.commit}\` (ledger head \`${s.supersedes.ledgerHead}\`), a wrong bootstrap with no program history. It is kept unchanged as the audit record; nothing from it is replayed.`);
  L.push(s.surfaces
    ? `- Surfaces: control inbox #${s.surfaces.controlInbox.pr}; CURRENT is comment ${s.surfaces.current.commentId} on #${s.surfaces.current.pr}`
    : '- Surfaces: not recorded');
  L.push(s.canonical
    ? `- Canonical: development \`${s.canonical.developmentBranch}\` at \`${s.canonical.developmentSha}\`; operational main \`${s.canonical.operationalMain}\``
    : '- Canonical: not recorded');
  L.push(s.staging
    ? `- Staging: serves \`${s.staging.servedSha}\` (run ${s.staging.runId}, #${s.staging.runNumber}); rollback \`${s.staging.rollbackSha}\`${s.staging.pinPr ? `; pin PR #${s.staging.pinPr}` : ''}`
    : '- Staging: not recorded');
  // Step 7: only a ledger that holds a fast-path target says so, so every earlier ledger renders as before.
  if (s.stagingTarget) L.push(`- Staging target (fast path): \`${s.stagingTarget.appSha}\` (${s.stagingTarget.packet}), checked against the full-path pin \`${s.stagingTarget.pinSha}\``);
  L.push(`- Critical path: ${s.criticalPath ? `${s.criticalPath} (${s.packets[s.criticalPath].phase}, ${s.packets[s.criticalPath].owner})` : 'none'}`);
  if (s.schemaVersion === 2) {
    L.push('- Schema: v2. Every line is written by the `wsf-control-writer` App and names its authority class and rule.');
    L.push(s.contracts
      ? `- Contracts pinned: ${s.contracts.map((c) => `${c.id}@${s8(c.commit)} (\`${c.path}\`)`).join('; ')}`
      : '- Contracts pinned: none recorded');
    if (s.surfaces?.shadow) {
      L.push(`- **SHADOW CURRENT.** This rendering is comment ${s.surfaces.shadow.commentId} on #${s.surfaces.shadow.pr}. The human CURRENT (comment ${s.surfaces.current.commentId}) stays authoritative until Step 5 exits; nothing routes or wakes from this page.`);
    }
    L.push('');
    L.push('## Accepted residuals (A+, v1)');
    L.push('');
    for (const r of ACCEPTED_RESIDUALS) L.push(`- ${r}`);
  }
  L.push('');
  L.push('## Workers');
  L.push('');
  L.push('| Worker | Inbox | Active now | Reviewing | Waiting on review | Blocked | Next | Queue | WATCH |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const w of Object.keys(s.workers).sort()) {
    const b = workerBuckets(s, w);
    const ids = (xs) => (xs.length ? xs.map((p) => p.id).join(', ') : '—');
    L.push(`| ${w} | #${s.workers[w].inbox} | ${ids(b.active)} | ${ids(b.reviewing)} | ${ids(b.waiting)} | ${ids(b.blocked)} | ${b.next ?? '—'} | ${(s.queue[w] || []).join(', ') || '—'} | ${workerWatch(s, w) ? 'on' : 'off'} |`);
  }
  L.push('');
  L.push('## Packets');
  L.push('');
  L.push('| Packet | Owner | Kind | Completes at | Origin | Phase | PR | Subject | PR head | Evidence | Merge | Proof | Reviewers | Released by | Last transition | Blocked by | Label |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  const v2 = s.schemaVersion === 2;
  if (v2) {
    L.pop(); L.pop();
    L.push('| Packet | Owner | Kind | Completes at | Origin | Phase | PR | Subject | PR head | Evidence | Merge | Proof | Reviewers | Released by | Last transition | Blocked by | Label | Review policy | Pending finding |');
    L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  }
  for (const p of byId(s)) {
    const blockers = p.blockedBy.map((b) => (b.packet ? `${b.packet}≥${b.until}` : `${b.external} (${b.owner})`)).join('; ');
    const policy = p.review ? `${p.review.workerReviews.map((r) => `${r.count}×${r.class}`).join('+') || 'no W# review'} then ${p.review.after}` : '—';
    const tail = v2 ? ` ${cell(policy)} | ${p.pendingFinding ? fmtRef(p.pendingFinding) : '—'} |` : '';
    const proof = p.proof ? `${p.proof.type} run ${p.proof.runId}: ${p.proof.result}` : '—';
    const rel = p.authority.released ? fmtRef(p.authority.released) : '—';
    L.push(`| ${p.id} | ${p.owner} | ${p.kind} | ${p.completion.terminal} (${p.completion.proofType}) | ${p.origin} | ${p.phase}${p.phaseBeforeBlock ? ` (from ${p.phaseBeforeBlock})` : ''} | ${p.pr ? `#${p.pr}` : '—'} | ${s8(p.artifact.subjectSha)} | ${s8(p.artifact.prHeadSha)} | ${s8(p.artifact.evidenceSha)} | ${s8(p.artifact.mergeSha)} | ${proof} | ${p.reviewers.join(', ') || '—'} | ${rel} | ${fmtRef(p.authority.lastTransition)} | ${cell(blockers || null)} | ${cell(p.label)} |${tail}`);
  }
  L.push('');
  // Step 6: the wake receipts. Rendered only once a wake exists, so every earlier head renders byte for byte as before
  // (a recovery run and the surface check recompute those renderings with this code).
  if (s.wakes) {
    L.push('## Wakes');
    L.push('');
    L.push('| Wake | Worker | Packet | Reason | Status | Comments | ACK |');
    L.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const [id, w] of Object.entries(s.wakes)) L.push(`| ${id.slice(0, 12)} | ${w.worker} | ${w.packet} | ${w.reason} | ${w.status}${w.status === 'timed-out' ? ' (wake-undelivered)' : ''} | ${w.comments.join(', ') || '—'} | ${w.ack ? fmtRef(w.ack) : '—'} |`);
    L.push('');
  }
  return `${L.join('\n')}`;
}

/**
 * head → sha256 of the CURRENT rendering at that head, for every head the
 * ledger has had: reconcile checks a stale CURRENT comment's body against the
 * rendering its own marker names.
 */
export function renderHashes(eventsText) {
  const lines = ledgerLines(eventsText);
  const out = {};
  for (let i = 1; i <= lines.length; i += 1) {
    const s = reduce(`${lines.slice(0, i).join('\n')}\n`);
    out[s.ledgerHead] = sha256(renderCurrent(s));
  }
  return out;
}

/** Compare a CURRENT.md text with a state: current, stale (rendered from another head) or hand-edited. */
export function verifyCurrent(s, text) {
  if (text === renderCurrent(s)) return { status: 'current' };
  const m = MARKER.exec(text);
  if (m && m[1] !== s.ledgerHead) return { status: 'stale', detail: `rendered from ${m[1].slice(0, 12)}; the ledger head is ${s.ledgerHead.slice(0, 12)}` };
  return { status: 'hand-edited', detail: 'the text differs from the rendering of the ledger head it claims' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [dir, flag, file] = process.argv.slice(2);
  if (!dir || (flag && !['--out', '--verify'].includes(flag)) || (flag && !file)) {
    console.error('usage: render-current.mjs <dir> [--out <file> | --verify <file>]');
    process.exit(2);
  }
  const checked = checkDir(dir);
  if (!checked.ok) { for (const p of checked.problems) console.error(`::error::${p}`); console.log('CURRENT=refused (the control state is invalid)'); process.exit(2); }
  const text = renderCurrent(checked.state);
  if (!flag) process.stdout.write(text);
  else if (flag === '--out') { fs.writeFileSync(file, text); console.log(`CURRENT=rendered head=${checked.state.ledgerHead}`); }
  else {
    const r = verifyCurrent(checked.state, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
    if (r.detail) console.error(r.detail);
    console.log(`CURRENT=${r.status}`);
    process.exit(r.status === 'current' ? 0 : 1);
  }
}
