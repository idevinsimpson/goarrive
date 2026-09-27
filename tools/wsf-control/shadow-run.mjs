#!/usr/bin/env node
/**
 * ONE STEP-5 SHADOW RUN of the wsf-control-writer App (AUTONOMY-STATE-1B; memo §2.3, §4.1, §12).
 *
 *   node tools/wsf-control/shadow-run.mjs --dry-run <bootstrap.v2.json> <out dir>
 *       No network, no git: build the v2 bootstrap from the input file and check it.
 *   node tools/wsf-control/shadow-run.mjs --live
 *       In Actions only, in environment wsf-control-writer: WSF_CONTROL_WRITER_PRIVATE_KEY (the App key,
 *       main-only), WSF_CONTROL_WRITER_APP_ID, GITHUB_REPOSITORY and GITHUB_SHA (the main commit this run
 *       executes). The installation token is minted in process (app-token.mjs) and never printed.
 *
 * A live run, every time, in this order (memo §4.1):
 *   1. fetch the protected ref; bootstrap it from bootstrap.v2.json only when it does not exist;
 *   2. check the ledger (anything but valid stops: CONTROL_STATE=invalid, no write);
 *   3. refuse to append when this writer's code is not the pinned version (writer-code pin, §4.4);
 *   4. build the snapshot ITSELF from GitHub, reconcile against the SHADOW surface;
 *   5. append the Step-5 fact lines and the recorded control-inbox decisions, through append.mjs;
 *   6. commit as the App and push FAST-FORWARD ONLY; a refused push re-reads and re-derives (≤ 3 attempts,
 *      then CONTROL_EXCEPTION writer-contention and no further write);
 *   7. only after the push: render and edit ONLY the App's own shadow CURRENT comment in place.
 * It never touches the human CURRENT, never routes, reviews, accepts, releases or wakes, never dispatches.
 * It prints closed KEY=value lines and never prints a token, a header or a comment body.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { appendEvent, Refused } from './append.mjs';
import { checkTexts } from './check.mjs';
import { ledgerHeads, reduce, serialize } from './reduce.mjs';
import { renderCurrent, renderHashes } from './render-current.mjs';
import { surfaceEvidence } from './current-surface.mjs';
import { surfaceStatus } from './reconcile.mjs';
import { GENESIS, LATEST_SCHEMA, WRITER_APP, isTerminal } from './schema.mjs';
import { RULES } from './rules.mjs';
import { SHADOW_PLACEHOLDER, decisionIntake, derivedFacts, shadowSurfaceEvent } from './shadow.mjs';
import { STATE_REF, checkoutState, commitState, pushFastForward, readStateFile, redact, tokenGitEnv } from './gitstate.mjs';

export const MAX_ATTEMPTS = 3;
/** The contracts whose pinned version must equal the running writer (memo §4.4). */
export const WRITER_CONTRACTS = Object.freeze(['writer', 'writer-workflow']);

/** The v2 bootstrap line from the reviewed input file, contracts pinned at the commit the writer runs from. */
export function bootstrapEvent(input, runningSha) {
  if (!input || typeof input !== 'object' || !input.bootstrap || !Number.isInteger(input.authorizedBy)) throw new Refused('bootstrap.v2.json must carry authorizedBy and bootstrap');
  const b = input.bootstrap;
  const contracts = (input.contractPaths ?? []).map((c) => ({ id: c.id, path: c.path, commit: runningSha }));
  return {
    schema: LATEST_SCHEMA, type: 'bootstrap', actor: WRITER_APP,
    source: { kind: 'comment', id: input.authorizedBy, repo: b.repository },
    authority: { class: 'manual', rule: 'MANUAL', evidence: [{ kind: 'comment', id: input.authorizedBy }] },
    ...b, ...(contracts.length ? { contracts } : {}),
  };
}

/** Append lines one by one; a refused line is reported and skipped, never forced. Returns the new texts and a report. */
export function appendAll(eventsText, lines) {
  let text = eventsText;
  let state = text ? reduce(text) : null;
  const report = { appended: [], noop: 0, refused: [] };
  for (const { event, label } of lines) {
    try {
      const r = appendEvent(text, event, { expectHead: state?.ledgerHead ?? GENESIS });
      if (r.noop) { report.noop += 1; continue; }
      text = r.eventsText; state = r.state;
      report.appended.push(`${event.type}:${event.authority.rule}${label ? `:${label}` : ''}`);
    } catch (e) {
      if (!(e instanceof Refused)) throw e;
      report.refused.push({ label: label ?? event.type, reason: e.message });
    }
  }
  return { eventsText: text, state, report };
}

/** The writer-code pin check: the running commit must carry exactly the pinned writer paths. */
export function writerPinProblem(state, runningSha, sameTree) {
  const pins = (state.contracts ?? []).filter((c) => WRITER_CONTRACTS.includes(c.id));
  if (pins.length !== WRITER_CONTRACTS.length) return 'the ledger pins no writer version (contracts writer and writer-workflow)';
  for (const c of pins) if (c.commit !== runningSha && !sameTree(c.commit, runningSha, c.path)) return `${c.path} at the running commit ${runningSha.slice(0, 8)} differs from its pinned version ${c.commit.slice(0, 8)}; a recorded set-contracts decision must pin it first`;
  return null;
}

/** The snapshot the writer builds for itself: pointers and closed values only. */
export async function buildSnapshot(state, gh, { shadowBody = undefined } = {}) {
  const snap = { schemaVersion: 1, prs: {}, runs: {} };
  for (const [, p] of Object.entries(state.packets)) {
    if (p.pr === null || isTerminal(p)) continue;
    const pr = await gh.pull(p.pr);
    if (!pr) continue;
    const entry = { state: pr.state, merged: pr.merged, headSha: pr.headSha };
    if (pr.merged) entry.mergeSha = pr.mergeSha;
    if (p.artifact.subjectSha && pr.headSha !== p.artifact.subjectSha) {
      const changed = await gh.changedPaths(p.artifact.subjectSha, pr.headSha);
      if (changed) entry.changedSinceSubject = changed.filter((x) => x !== '*');
    }
    snap.prs[String(p.pr)] = entry;
  }
  for (const [, p] of Object.entries(state.packets)) {
    if (!p.proof) continue;
    const run = await gh.run(p.proof.runId);
    if (run) snap.runs[String(p.proof.runId)] = run;
  }
  if (state.surfaces?.shadow) snap.currentSurface = surfaceEvidence(state.surfaces.shadow.commentId, shadowBody ?? null);
  return snap;
}

/**
 * One run. Everything with a side effect is injected: `gh` (GitHub), `remote` + `gitEnv` (the state ref),
 * `author` (the App bot identity), `runningSha`, `sameTree`. Returns a closed report.
 */
export async function runShadow({ gh, remote, gitEnv = {}, author, runningSha, sameTree, bootstrapInput, workdir, controlInboxComments, ref = STATE_REF, botLogin }) {
  const report = { outcome: null, attempts: 0, bootstrapped: false, appended: [], refused: [], intakeRefused: [], surface: null, head: null, exception: null };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    report.attempts = attempt;
    const dir = path.join(workdir, `attempt-${attempt}`);
    const remoteSha = checkoutState(remote, dir, { env: gitEnv, ref });
    let eventsText = readStateFile(dir, 'events.jsonl');
    const lines = [];
    if (!remoteSha) {
      lines.push({ event: bootstrapEvent(bootstrapInput, runningSha), label: 'bootstrap' });
    } else {
      const checked = checkTexts(eventsText, readStateFile(dir, 'state.json'));
      if (!checked.ok) return { ...report, outcome: 'refused', exception: `CONTROL_STATE=invalid: ${checked.problems[0]}` };
      const pin = writerPinProblem(checked.state, runningSha, sameTree);
      if (pin) return { ...report, outcome: 'refused', exception: `writer-code-unpinned: ${pin}` };
    }
    // Apply the bootstrap first (if any) so the fact and decision derivations see a real state.
    let { eventsText: afterBoot, state, report: r0 } = appendAll(eventsText, lines);
    if (r0.refused.length) return { ...report, outcome: 'refused', exception: `bootstrap refused: ${r0.refused[0].reason}` };
    eventsText = afterBoot;

    // The shadow surface: find the App's own comment (placeholder or rendering), or create it once.
    const more = [];
    if (!state.surfaces.shadow) {
      const mine = (controlInboxComments ?? []).find((c) => c.author === botLogin && (c.body.startsWith(SHADOW_PLACEHOLDER.split('\n')[0]) || c.body.startsWith('<!-- wsf-control ledgerHead=')));
      const commentId = mine ? mine.id : (await gh.createComment(state.surfaces.current.pr, SHADOW_PLACEHOLDER)).id;
      more.push({ event: shadowSurfaceEvent(state, commentId), label: `shadow-comment-${commentId}` });
    }
    const r1 = appendAll(eventsText, more);
    ({ eventsText, state } = r1);
    if (r1.report.refused.length) return { ...report, outcome: 'refused', exception: `shadow surface refused: ${r1.report.refused[0].reason}` };
    // Facts, derived by the writer from its own snapshot, against the shadow surface only.
    const shadowComment = state.surfaces.shadow ? await gh.comment(state.surfaces.shadow.commentId) : null;
    const snap = await buildSnapshot(state, gh, { shadowBody: shadowComment?.body });
    const facts = derivedFacts(state, snap, { heads: ledgerHeads(eventsText), renders: renderHashes(eventsText) }).map((event) => ({ event, label: event.packet }));
    // Director/L0 decisions posted as one fenced block in the control inbox.
    const intake = decisionIntake(state, (controlInboxComments ?? []).filter((c) => c.author !== botLogin));
    report.intakeRefused = intake.refused;
    const res = appendAll(eventsText, [...facts, ...intake.events.map((x) => ({ event: x.event, label: `comment-${x.commentId}` }))]);
    const allAppended = [...r0.appended, ...r1.report.appended, ...res.report.appended];
    const nextText = res.eventsText; state = res.state;
    report.refused = res.report.refused;
    const changed = nextText !== readStateFile(dir, 'events.jsonl');
    if (changed) {
      const files = { 'events.jsonl': nextText, 'state.json': serialize(state), 'CURRENT.md': `${renderCurrent(state)}\n` };
      commitState(dir, files, `wsf-control: ${allAppended.length} line(s), head ${state.ledgerHead.slice(0, 12)}`, author);
      const pushed = pushFastForward(dir, remote, { env: gitEnv, ref });
      if (!pushed.ok) {
        if (pushed.rejected && attempt < MAX_ATTEMPTS) continue; // a concurrent writer won; re-read and re-derive
        return { ...report, outcome: 'refused', exception: pushed.rejected ? 'writer-contention: the state ref moved on every attempt' : `push failed: ${redact(pushed.detail).split('\n')[0]}` };
      }
    }
    report.bootstrapped = !remoteSha;
    report.appended = allAppended;
    report.head = state.ledgerHead;
    // Only after the ledger is pushed: edit the App's own shadow comment in place, never another comment.
    if (state.surfaces.shadow) {
      const body = (await gh.comment(state.surfaces.shadow.commentId))?.body ?? null;
      const rendered = renderCurrent(state);
      const isPlaceholder = body !== null && body.startsWith(SHADOW_PLACEHOLDER.split('\n')[0]);
      const sfc = isPlaceholder ? { status: 'stale' } : surfaceStatus(state, { currentSurface: surfaceEvidence(state.surfaces.shadow.commentId, body) }, { heads: ledgerHeads(nextText), renders: renderHashes(nextText), surface: 'shadow' });
      if (sfc.status === 'exception') report.surface = `exception: ${sfc.detail}`;
      else if (body === rendered) report.surface = 'ok';
      else { await gh.editComment(state.surfaces.shadow.commentId, rendered); report.surface = 'edited'; }
    }
    report.outcome = changed ? 'written' : 'unchanged';
    return report;
  }
  return { ...report, outcome: 'refused', exception: 'writer-contention' };
}

/** The closed lines a run prints (no token, no header, no body). */
export function formatReport(r) {
  const L = [`SHADOW_RUN=${r.outcome}`, `ATTEMPTS=${r.attempts}`, `BOOTSTRAPPED=${r.bootstrapped}`, `APPENDED=${r.appended.length}`];
  for (const a of r.appended) L.push(`APPENDED_LINE ${a}`);
  for (const x of r.refused) L.push(`REFUSED_LINE ${x.label} :: ${x.reason}`);
  for (const x of r.intakeRefused) L.push(`INTAKE_REFUSED comment=${x.commentId} :: ${x.reason}`);
  if (r.head) L.push(`LEDGER_HEAD=${r.head}`);
  if (r.surface) L.push(`SHADOW_SURFACE=${r.surface}`);
  if (r.exception) L.push(`CONTROL_EXCEPTION ${r.exception}`);
  return L.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [mode, a, b] = process.argv.slice(2);
  if (mode === '--dry-run') {
    // No network and no git: the bootstrap line and its checks, exactly as a first live run would write them.
    const input = JSON.parse(fs.readFileSync(a, 'utf8'));
    const sha = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    const { eventsText, state, report } = appendAll('', [{ event: bootstrapEvent(input, sha), label: 'bootstrap' }]);
    if (report.refused.length) { console.log(`DRY_RUN=refused :: ${report.refused[0].reason}`); process.exit(1); }
    fs.mkdirSync(b, { recursive: true });
    fs.writeFileSync(path.join(b, 'events.jsonl'), eventsText);
    fs.writeFileSync(path.join(b, 'state.json'), serialize(state));
    fs.writeFileSync(path.join(b, 'CURRENT.md'), `${renderCurrent(state)}\n`);
    const c = checkTexts(eventsText, serialize(state));
    console.log(`DRY_RUN=${c.ok ? 'valid' : 'invalid'} schema=${state.schemaVersion} events=${state.eventCount} head=${state.ledgerHead} rule=${RULES.MANUAL.class}/MANUAL pinnedAt=${sha.slice(0, 12)}`);
    process.exit(c.ok ? 0 : 1);
  }
  if (mode !== '--live') { console.error('usage: shadow-run.mjs --dry-run <bootstrap.v2.json> <out dir> | --live'); process.exit(2); }
  // The key arrives only from the main-only environment; the token is minted here, down-scoped, and never printed.
  const { WSF_CONTROL_WRITER_PRIVATE_KEY: pem, WSF_CONTROL_WRITER_APP_ID: appId, GITHUB_REPOSITORY: repo, GITHUB_SHA: runningSha } = process.env;
  const { installationToken, AppTokenError } = await import('./app-token.mjs');
  let token; let slug;
  try { ({ token, slug } = await installationToken({ appId, privateKeyPem: pem, repo })); } catch (e) {
    console.log('SHADOW_RUN=refused');
    console.log(`CONTROL_EXCEPTION writer-token-unavailable: ${e instanceof AppTokenError ? e.message : 'the token could not be minted'}`);
    process.exit(1);
  }
  if (!repo || !runningSha) { console.log('SHADOW_RUN=refused'); console.log('CONTROL_EXCEPTION writer-context-missing'); process.exit(1); }
  // Defence in depth: the token is never printed, but the runner redacts it from the log should it ever appear.
  if (process.env.GITHUB_ACTIONS === 'true') console.log(`::add-mask::${token}`);
  const { gitHubClient } = await import('./github.mjs');
  const gh = gitHubClient({ token, repo });
  const botId = await gh.botUserId(slug);
  const botLogin = `${slug}[bot]`;
  const author = { name: botLogin, email: `${botId}+${botLogin}@users.noreply.github.com` };
  const sameTree = (x, y, p) => spawnSync('git', ['diff', '--quiet', x, y, '--', p]).status === 0;
  const input = JSON.parse(fs.readFileSync('docs/westayfit/ops/control/bootstrap.v2.json', 'utf8'));
  const inbox = input.bootstrap.surfaces.controlInbox.pr;
  const report = await runShadow({
    gh, remote: `https://github.com/${repo}.git`, gitEnv: tokenGitEnv(token), author, runningSha, sameTree,
    bootstrapInput: input, workdir: fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-control-')), controlInboxComments: await gh.recentComments(inbox, 100), botLogin,
  });
  console.log(formatReport(report));
  console.log(`WRITER=${botLogin} RUNNING_SHA=${runningSha}`);
  process.exit(report.outcome === 'refused' ? 1 : 0);
}
