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
const s8 = (x) => (x ? x.slice(0, 8) : '—');
const cell = (x) => String(x ?? '—').replace(/\|/g, '\\|');

/** The CURRENT.md text for a state. */
export function renderCurrent(s) {
  const L = [];
  L.push(`<!-- wsf-control ledgerHead=${s.ledgerHead} events=${s.eventCount} rendered by tools/wsf-control/render-current.mjs; do not edit -->`);
  L.push('# WSF control state: CURRENT');
  L.push('');
  L.push('Derived from `events.jsonl` on the `wsf-control-state` branch. Do not edit; record a decision with `append.mjs`, then re-render.');
  L.push('GitHub is the authority for facts (PR state, heads, CI, comments). This page records decisions and pointers only.');
  L.push('');
  L.push(`- Repository: \`${s.repository}\``);
  L.push(`- Ledger head: \`${s.ledgerHead}\` (${s.eventCount} events)`);
  L.push(`- Genesis: bootstrap as of ${s.asOf}. Packets whose origin is \`bootstrap\` were imported in their phase at that instant; the ledger did not observe their earlier transitions.`);
  L.push(s.surfaces
    ? `- Surfaces: control inbox #${s.surfaces.controlInbox.pr}; CURRENT is comment ${s.surfaces.current.commentId} on #${s.surfaces.current.pr}`
    : '- Surfaces: not recorded');
  L.push(s.canonical
    ? `- Canonical: development \`${s.canonical.developmentBranch}\` at \`${s.canonical.developmentSha}\`; operational main \`${s.canonical.operationalMain}\``
    : '- Canonical: not recorded');
  L.push(s.staging
    ? `- Staging: serves \`${s.staging.servedSha}\` (run ${s.staging.runId}, #${s.staging.runNumber}); rollback \`${s.staging.rollbackSha}\`${s.staging.pinPr ? `; pin PR #${s.staging.pinPr}` : ''}`
    : '- Staging: not recorded');
  L.push(`- Critical path: ${s.criticalPath ? `${s.criticalPath} (${s.packets[s.criticalPath].phase}, ${s.packets[s.criticalPath].owner})` : 'none'}`);
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
  for (const p of byId(s)) {
    const blockers = p.blockedBy.map((b) => (b.packet ? `${b.packet}≥${b.until}` : `${b.external} (${b.owner})`)).join('; ');
    const proof = p.proof ? `${p.proof.type} run ${p.proof.runId}: ${p.proof.result}` : '—';
    const rel = p.authority.released ? fmtRef(p.authority.released) : '—';
    L.push(`| ${p.id} | ${p.owner} | ${p.kind} | ${p.completion.terminal} (${p.completion.proofType}) | ${p.origin} | ${p.phase}${p.phaseBeforeBlock ? ` (from ${p.phaseBeforeBlock})` : ''} | ${p.pr ? `#${p.pr}` : '—'} | ${s8(p.artifact.subjectSha)} | ${s8(p.artifact.prHeadSha)} | ${s8(p.artifact.evidenceSha)} | ${s8(p.artifact.mergeSha)} | ${proof} | ${p.reviewers.join(', ') || '—'} | ${rel} | ${fmtRef(p.authority.lastTransition)} | ${cell(blockers || null)} | ${cell(p.label)} |`);
  }
  L.push('');
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
