#!/usr/bin/env node
/**
 * THE FAST-PATH CANDIDATE: the staging target the control ledger holds, re-verified here before anything is fetched.
 * (STAGING-FRESHNESS-FASTPATH; accepted A+ memo §9.2.1 and §9.3.)
 *
 * The ordinary path (resolve-candidate.mjs) deploys the commit a REVIEWED pin file names. The fast path deploys,
 * instead, the newest accepted and integrated member-visible merge the control writer recorded as `set-target` on the
 * protected state ref, and only when that merge differs from the reviewed pin in nothing but member-visible source.
 * This script is the gate's own check of that claim, made before the candidate is fetched and before any credential
 * exists. It trusts nothing the writer decided:
 *
 *   1. the ledger checks (tools/wsf-control/check.mjs, run by the caller) and its head commit is the App's;
 *   2. the target was checked against THIS pin: the approved-candidate.json of the commit this workflow runs from;
 *   3. that pin is the recorded served full-path deploy (set-staging), with its rollback SHA;
 *   4. the target is an INTEGRATED packet's own merge, and the canonical development branch contains it;
 *   5. the §9.3 invariants hold again, from GitHub's own compare: the target descends from the pin and every changed
 *      path is member-visible source outside every protected path (tools/wsf-control/fastpath.mjs, one definition).
 *
 * Any failure refuses the run: nothing is fetched, built or deployed, and the candidate takes the reviewed path.
 * Runs only in `deploy` mode. Exit 0 = CANDIDATE=<sha>. Exit 1 = CANDIDATE=refused.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkDir } from '../../tools/wsf-control/check.mjs';
import { fastPathReasons } from '../../tools/wsf-control/fastpath.mjs';
import { gitHubClient } from '../../tools/wsf-control/github.mjs';

export const WRITER_BOT = 'wsf-control-writer[bot]';
const SHA = /^[0-9a-f]{40}$/;
const s8 = (x) => String(x).slice(0, 8);

/** Pure apart from the two GitHub reads in `api` ({ descends(base, head), changedPaths(base, head) }). */
export async function resolveLedgerTarget({ approval, state, ledgerAuthor, requested = '', mode, api }) {
  const refuse = (reason) => ({ ok: false, reason });
  if (mode !== 'deploy') return refuse(`target_source=ledger deploys; it is refused in mode ${JSON.stringify(mode)}`);
  if (ledgerAuthor !== WRITER_BOT) return refuse(`the control ledger head was not written by ${WRITER_BOT} (author ${JSON.stringify(ledgerAuthor)})`);
  const t = state?.stagingTarget;
  if (!t) return refuse('the control ledger holds no staging target');
  if (approval?.project !== 'westayfit-staging' || !SHA.test(String(approval?.approvedAppSha))) return refuse('the approved-candidate file does not name a westayfit-staging commit');
  const pin = approval.approvedAppSha;
  if (t.pinSha !== pin) return refuse(`the target ${s8(t.appSha)} was checked against the pin ${s8(t.pinSha)}, not this run's pin ${s8(pin)}`);
  if (!state.staging || state.staging.servedSha !== pin || !SHA.test(String(state.staging.rollbackSha))) {
    return refuse(`the pin ${s8(pin)} is not the recorded served full-path deploy with a rollback SHA`);
  }
  const p = state.packets?.[t.packet];
  if (!p || p.kind !== 'work' || p.phase !== 'INTEGRATED' || p.artifact?.mergeSha !== t.appSha) return refuse(`the target ${s8(t.appSha)} is not ${t.packet}'s integrated merge`);
  if (requested !== '' && requested !== t.appSha) return refuse(`app_sha ${requested} is not the ledger target ${t.appSha}`);
  const dev = state.canonical?.developmentBranch;
  if (!dev) return refuse('the control ledger records no canonical development branch');
  if ((await api.descends(t.appSha, dev)) !== true) return refuse(`the development branch ${dev} does not contain the target ${s8(t.appSha)}`);
  const reasons = fastPathReasons({ pinSha: pin, candidateSha: t.appSha, descends: await api.descends(pin, t.appSha), paths: await api.changedPaths(pin, t.appSha) });
  if (reasons.length) return refuse(`the fast-path invariants do not hold: ${reasons.join('; ')}`);
  return { ok: true, appSha: t.appSha, packet: t.packet, pin };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [approvalPath, ledgerDir] = process.argv.slice(2);
  const fail = (m) => { console.error(`::error::${m}`); console.error('CANDIDATE=refused'); process.exit(1); };
  const run = async () => {
    let approval;
    try { approval = JSON.parse(fs.readFileSync(approvalPath, 'utf8')); } catch { fail('the approved-candidate file is missing or unreadable'); }
    const checked = checkDir(ledgerDir || '');
    if (!checked.ok) fail(`the control ledger does not check: ${checked.problems.slice(0, 3).join('; ')}`);
    const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo } = process.env;
    const r = await resolveLedgerTarget({
      approval, state: checked.state, ledgerAuthor: process.env.WSF_LEDGER_AUTHOR,
      requested: (process.env.WSF_REQUESTED_SHA || '').trim(), mode: process.env.WSF_INPUT_MODE,
      // The compare reads are the only network use, made with the gate's own read-only token, after every local check.
      api: token ? gitHubClient({ token, repo }) : { descends: () => { throw new Error('GITHUB_TOKEN is required for the compare reads'); }, changedPaths: () => { throw new Error('GITHUB_TOKEN is required for the compare reads'); } },
    });
    if (!r.ok) fail(`${r.reason}. Nothing is fetched or deployed; the candidate takes the reviewed pin path.`);
    console.log(`CANDIDATE=${r.appSha}`);
    console.log(`CANDIDATE_SOURCE=ledger packet=${r.packet} pin=${r.pin} ledgerHead=${checked.state.ledgerHead}`);
    console.log('FASTPATH=true');
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `app_sha=${r.appSha}\nfastpath=true\n`);
  };
  run().catch((e) => fail(e?.message ?? 'the ledger target could not be resolved'));
}
