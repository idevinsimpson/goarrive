#!/usr/bin/env node
/**
 * THE UNATTENDED FAST-PATH DISPATCH (STAGING-FRESHNESS-DISPATCH; Director ruling #365 5940481437, Option B).
 *
 * Runs in its own minimal job of the main-only reconcile workflow, after the writer job, with that job's own
 * workflow token (`contents: read`, `actions: write`) and nothing else: no App key, no cloud credential. It may do one
 * thing: dispatch the EXISTING `wsf-staging-deploy.yml` from main in `target_source=ledger` mode for the ledger's
 * staging target. The staging workflow's gate then re-verifies that target before anything is fetched or deployed;
 * nothing here replaces it.
 *
 * It dispatches only when every condition holds, and otherwise reports why and does nothing:
 *   1. the ledger checks (by the caller) and its head names the App as author;
 *   2. the owner's standing switch is on: a recorded `set-fastpath {enabled: true}` (memo §9.5). Absent or off: the
 *      reviewed pin path is the only path;
 *   3. there is a staging target, and the hosted marker does not already name it;
 *   4. no deploy of this exact target exists among the recent staging runs: queued or running (no duplicate),
 *      succeeded (never re-sent), or failed (never re-sent after a failure; a new target or a recorded decision is
 *      required, memo §9.4). A run that cannot be read is a refusal, not a guess;
 *   5. resolve-ledger-target.mjs's own checks hold now (the same function the gate runs).
 * A running deploy of an older target does not block: GitHub's concurrency group serializes the newest behind it and
 * replaces an older pending run (coalescing, Phase D row 13).
 *
 * Output: FASTPATH_DISPATCH=dispatched target=… | FASTPATH_DISPATCH=skipped reason=…  Exit 1 only on an unexpected
 * failure of the dispatch call itself; a skip is a normal, reported outcome.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkDir } from '../../tools/wsf-control/check.mjs';
import { STAGING_URL, STAGING_WORKFLOW, targetTitle } from '../../tools/wsf-control/fastpath.mjs';
import { gitHubClient } from '../../tools/wsf-control/github.mjs';
import { readServedMarker } from './check-served-marker.mjs';
import { resolveLedgerTarget } from './resolve-ledger-target.mjs';

/** How many recent staging runs are read to find an earlier deploy of the same target. */
export const RUN_WINDOW = 100;
const s8 = (x) => String(x).slice(0, 8);

/**
 * The decision, from facts only: { dispatch: { appSha, packet } } or { skip: reason }.
 * `served` is readServedMarker's result for the target ({ ok, status }); `runs` the recent staging runs (or null).
 */
export async function dispatchDecision({ state, ledgerAuthor, approval, served, runs, api }) {
  if (!state?.fastpath?.enabled) return { skip: 'unattended fast-path dispatch is not enabled in the ledger (no set-fastpath {enabled: true}); the reviewed pin path applies' };
  const t = state.stagingTarget;
  if (!t) return { skip: 'the ledger holds no staging target' };
  if (served?.ok === true) return { skip: `the hosted marker already names the target ${s8(t.appSha)} (FRESH)` };
  if (!Array.isArray(runs)) return { skip: 'the recent staging runs could not be read; nothing is dispatched blind' };
  const mine = runs.filter((r) => r.title === targetTitle(t.appSha));
  const active = mine.find((r) => r.status !== 'completed');
  if (active) return { skip: `a deploy of the target ${s8(t.appSha)} is already ${active.status} (run ${active.id})` };
  const failed = mine.find((r) => r.conclusion !== 'success');
  if (failed) return { skip: `a deploy of the target ${s8(t.appSha)} already ended ${failed.conclusion} (run ${failed.id}); it is never re-sent automatically (BLOCKED until a new target or a recorded decision)` };
  if (mine.length) return { skip: `the target ${s8(t.appSha)} was already deployed (run ${mine[0].id}) though the marker does not name it; not re-sent` };
  const v = await resolveLedgerTarget({ approval, state, ledgerAuthor, requested: t.appSha, mode: 'deploy', api });
  if (!v.ok) return { skip: `the target does not verify: ${v.reason}` };
  return { dispatch: { appSha: v.appSha, packet: v.packet } };
}

/** The one write this job makes: the existing staging workflow, from main, in ledger mode, confirming the target. */
export async function dispatchRun({ token, repo, appSha, fetchImpl = globalThis.fetch }) {
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/actions/workflows/${STAGING_WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'wsf-fastpath-dispatch' },
    body: JSON.stringify({ ref: 'main', inputs: { mode: 'deploy', target_source: 'ledger', app_sha: appSha } }),
  });
  if (res.status !== 204) throw new Error(`the dispatch returned HTTP ${res.status}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [approvalPath, ledgerDir] = process.argv.slice(2);
  const skip = (reason) => { console.log(`FASTPATH_DISPATCH=skipped reason=${reason}`); process.exit(0); };
  const run = async () => {
    const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, GITHUB_REF: ref } = process.env;
    if (ref !== 'refs/heads/main') skip(`not on main (${ref})`);
    let approval;
    try { approval = JSON.parse(fs.readFileSync(approvalPath, 'utf8')); } catch { skip('the approved-candidate file could not be read'); }
    const checked = checkDir(ledgerDir || '');
    if (!checked.ok) skip(`the control ledger does not check: ${checked.problems.slice(0, 2).join('; ')}`);
    const state = checked.state;
    if (!token) skip('no workflow token');
    const gh = gitHubClient({ token, repo });
    const served = state.stagingTarget ? await readServedMarker({ stagingUrl: STAGING_URL, approvedSha: state.stagingTarget.appSha }) : null;
    let runs = null;
    try { runs = await gh.workflowRuns(STAGING_WORKFLOW, RUN_WINDOW); } catch { runs = null; }
    const d = await dispatchDecision({ state, ledgerAuthor: process.env.WSF_LEDGER_AUTHOR, approval, served, runs, api: gh });
    if (d.skip) skip(d.skip);
    await dispatchRun({ token, repo, appSha: d.dispatch.appSha });
    console.log(`FASTPATH_DISPATCH=dispatched target=${d.dispatch.appSha} packet=${d.dispatch.packet} ledgerHead=${state.ledgerHead}`);
  };
  run().catch((e) => { console.error(`::error::${e?.message ?? 'fast-path dispatch failed'}`); console.log('FASTPATH_DISPATCH=error'); process.exit(1); });
}
