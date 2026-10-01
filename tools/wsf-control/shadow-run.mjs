#!/usr/bin/env node
/**
 * ONE STEP-5 SHADOW RUN of the wsf-control-writer App (AUTONOMY-STATE-1B; memo §2.3, §4.1, §12).
 *
 *   node tools/wsf-control/shadow-run.mjs --dry-run <bootstrap.v2.json> <out dir>
 *       No network, no git: build the v2 bootstrap from the input file and check it.
 *   node tools/wsf-control/shadow-run.mjs --live
 *       In Actions only, in environment wsf-control-writer: WSF_CONTROL_WRITER_PRIVATE_KEY (the App key,
 *       main-only), WSF_CONTROL_WRITER_APP_ID and GITHUB_REPOSITORY. The running commit is the checkout's
 *       HEAD (the code that executes), never the event's GITHUB_SHA. The token is minted in process
 *       (app-token.mjs) and never printed.
 *
 * A live run, every time, in this order (memo §4.1):
 *   1. fetch the protected ref; bootstrap it from bootstrap.v2.json only when it does not exist. A bootstrap is
 *      refused when its input is stale (asOf older than BOOTSTRAP_MAX_AGE_MS, or in the future), and the
 *      operational-main SHA is DERIVED (the commit that runs), never imported. On a recovery ref (-2, -3, …)
 *      the predecessor must exist, check, and hold nothing after its bootstrap but the App's own
 *      set-shadow-surface line; the new bootstrap names it in `supersedes` and reuses its shadow comment;
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
import { STATE_REF, checkoutState, commitState, predecessorRef, pushFastForward, readStateFile, redact, tokenGitEnv } from './gitstate.mjs';
import { appendAll } from './append-all.mjs';
import { mergeReads, postWakes, prReads, routerAppend, workerComments } from './router-run.mjs';

export const MAX_ATTEMPTS = 3;
/** The contracts whose pinned version must equal the running writer (memo §4.4). */
export const WRITER_CONTRACTS = Object.freeze(['writer', 'writer-workflow']);

/**
 * How old a bootstrap input may be when a run imports it. The input states program CURRENT at its `asOf`; an
 * input older than this was reviewed against a program that has since moved (run 50 imported a 28-hour-old
 * snapshot), so it is refused, not imported: the integrator refreshes asOf and the packets in a reviewed change.
 */
export const BOOTSTRAP_MAX_AGE_MS = 6 * 60 * 60 * 1000;
/** Clock skew tolerated for an asOf slightly ahead of the runner. */
export const BOOTSTRAP_MAX_SKEW_MS = 5 * 60 * 1000;

/**
 * The v2 bootstrap line from the reviewed input file, contracts pinned at the commit the writer runs from.
 * Fails closed on a stale or future input. The operational-main SHA is the running commit (the job checks out
 * `main`), so the input must not carry one: a SHA written into a file on main is stale once that file merges.
 */
export function bootstrapEvent(input, runningSha, { now = Date.now(), supersedes = null } = {}) {
  if (!input || typeof input !== 'object' || !input.bootstrap || !Number.isInteger(input.authorizedBy)) throw new Refused('bootstrap.v2.json must carry authorizedBy and bootstrap');
  const b = input.bootstrap;
  const asOf = Date.parse(b.asOf);
  if (!Number.isFinite(asOf)) throw new Refused('bootstrap-stale: the input carries no parseable asOf');
  if (asOf > now + BOOTSTRAP_MAX_SKEW_MS) throw new Refused(`bootstrap-stale: asOf ${b.asOf} is in the future`);
  if (now - asOf > BOOTSTRAP_MAX_AGE_MS) throw new Refused(`bootstrap-stale: asOf ${b.asOf} is older than ${BOOTSTRAP_MAX_AGE_MS / 3600000} hours; refresh asOf and the packets to program CURRENT in a reviewed change`);
  if (b.canonical && Object.hasOwn(b.canonical, 'operationalMain')) throw new Refused('bootstrap input: canonical.operationalMain is derived from the running commit; the input must not carry it');
  const contracts = (input.contractPaths ?? []).map((c) => ({ id: c.id, path: c.path, commit: runningSha }));
  return {
    schema: LATEST_SCHEMA, type: 'bootstrap', actor: WRITER_APP,
    source: { kind: 'comment', id: input.authorizedBy, repo: b.repository },
    authority: { class: 'manual', rule: 'MANUAL', evidence: [{ kind: 'comment', id: input.authorizedBy }] },
    ...b,
    ...(b.canonical ? { canonical: { ...b.canonical, operationalMain: runningSha } } : {}),
    ...(contracts.length ? { contracts } : {}),
    ...(supersedes ? { supersedes } : {}),
  };
}

/**
 * Why a predecessor ledger may NOT be superseded, or null when it may. Recovery is for a wrong bootstrap only
 * (CONTROL_STATE.md "Recovering a wrong bootstrap"): the ledger must check, and after its bootstrap hold nothing
 * but the App's own set-shadow-surface line. Any program transition (a fact, a decision, a finding) means the
 * ledger has history, and errors are then corrected by later lines, never by abandoning it.
 */
export function recoveryProblem(eventsText, stateText) {
  if (!eventsText) return 'the predecessor ref holds no ledger';
  const checked = checkTexts(eventsText, stateText);
  if (!checked.ok) return `the predecessor ledger does not check: ${checked.problems[0]}`;
  const events = eventsText.trimEnd().split('\n').map((l) => JSON.parse(l));
  if (events[0].type !== 'bootstrap') return 'the predecessor ledger does not start with a bootstrap';
  const later = events.slice(1).filter((e) => !(e.type === 'set-shadow-surface' && e.authority?.rule === 'R-SHADOW-SURFACE'));
  if (later.length) return `the predecessor ledger has ${later.length} post-bootstrap program line(s) (first: seq ${later[0].seq} ${later[0].type}); it has history and is corrected by later lines, never superseded`;
  return null;
}

/** The predecessor's heads and CURRENT renderings, for the shadow comment it rendered (null unless it is exactly the superseded ledger). */
function predecessorSurfaceHistory(remote, workdir, sup, gitEnv) {
  const dir = path.join(workdir, 'predecessor-surface');
  const sha = checkoutState(remote, dir, { env: gitEnv, ref: sup.ref });
  if (sha !== sup.commit) return null;
  const text = readStateFile(dir, 'events.jsonl');
  if (!text || reduce(text).ledgerHead !== sup.ledgerHead) return null;
  return { heads: ledgerHeads(text), renders: renderHashes(text) };
}

export { appendAll };

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
 * The re-pin an unpinned writer may record: an owner-authored, unedited set-contracts decision in the control inbox
 * after which the writer pins match the running commit. Returns { files, state, label } or null.
 */
export function repinLine(state, eventsText, controlInboxComments, botLogin, runningSha, sameTree) {
  const intake = decisionIntake(state, (controlInboxComments ?? []).filter((c) => c.author !== botLogin));
  for (const x of intake.events.filter((e) => e.event.type === 'set-contracts')) {
    const r = appendAll(eventsText, [{ event: x.event, label: `comment-${x.commentId}` }]);
    if (!r.report.appended.length || writerPinProblem(r.state, runningSha, sameTree)) continue;
    return { files: { 'events.jsonl': r.eventsText, 'state.json': serialize(r.state), 'CURRENT.md': `${renderCurrent(r.state)}\n` }, state: r.state, label: `set-contracts:MANUAL:comment-${x.commentId}` };
  }
  return null;
}

/**
 * One run. Everything with a side effect is injected: `gh` (GitHub), `remote` + `gitEnv` (the state ref),
 * `author` (the App bot identity), `runningSha`, `sameTree`. Returns a closed report.
 */
export async function runShadow({ gh, remote, gitEnv = {}, author, runningSha, sameTree, bootstrapInput, workdir, controlInboxComments, ref = STATE_REF, botLogin, now = Date.now(), readInbox = async () => [], route = true }) {
  const report = { outcome: null, attempts: 0, bootstrapped: false, appended: [], refused: [], intakeRefused: [], surface: null, head: null, exception: null, repinned: null, wakesPosted: [], awaiting: [], exceptions: [], deferred: null };
  let repinUsed = false;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    report.attempts = attempt;
    const dir = path.join(workdir, `attempt-${attempt}`);
    const remoteSha = checkoutState(remote, dir, { env: gitEnv, ref });
    let eventsText = readStateFile(dir, 'events.jsonl');
    const lines = [];
    let inherited = null; // the predecessor's shadow comment, reused instead of creating a competing surface
    if (!remoteSha) {
      let supersedes = null;
      const pred = predecessorRef(ref);
      if (pred) {
        const pdir = path.join(workdir, `attempt-${attempt}-predecessor`);
        const predSha = checkoutState(remote, pdir, { env: gitEnv, ref: pred });
        if (!predSha) return { ...report, outcome: 'refused', exception: `recovery-refused: ${ref} supersedes ${pred}, which does not exist` };
        const predEvents = readStateFile(pdir, 'events.jsonl');
        const why = recoveryProblem(predEvents, readStateFile(pdir, 'state.json'));
        if (why) return { ...report, outcome: 'refused', exception: `recovery-refused: ${pred}: ${why}` };
        const predState = reduce(predEvents);
        supersedes = { ref: pred, commit: predSha, ledgerHead: predState.ledgerHead };
        inherited = predState.surfaces?.shadow?.commentId ?? null;
      }
      try {
        lines.push({ event: bootstrapEvent(bootstrapInput, runningSha, { now, supersedes }), label: 'bootstrap' });
      } catch (e) {
        if (!(e instanceof Refused)) throw e;
        return { ...report, outcome: 'refused', exception: `bootstrap refused: ${e.message}` };
      }
    } else {
      const checked = checkTexts(eventsText, readStateFile(dir, 'state.json'));
      if (!checked.ok) return { ...report, outcome: 'refused', exception: `CONTROL_STATE=invalid: ${checked.problems[0]}` };
      const pin = writerPinProblem(checked.state, runningSha, sameTree);
      if (pin) {
        // The one thing an unpinned writer may record (memo §4.4): the owner's set-contracts decision that pins exactly
        // the writer code now running. Anything else waits; a decision pinning some other version is ignored here.
        const repin = repinLine(checked.state, eventsText, controlInboxComments, botLogin, runningSha, sameTree);
        if (!repin || repinUsed) return { ...report, outcome: 'refused', exception: `writer-code-unpinned: ${pin}` };
        commitState(dir, repin.files, `wsf-control: re-pin to ${runningSha.slice(0, 12)}, head ${repin.state.ledgerHead.slice(0, 12)}`, author);
        const pushed = pushFastForward(dir, remote, { env: gitEnv, ref });
        if (!pushed.ok) {
          if (pushed.rejected && attempt < MAX_ATTEMPTS) continue;
          return { ...report, outcome: 'refused', exception: pushed.rejected ? 'writer-contention: the state ref moved on every attempt' : `push failed: ${redact(pushed.detail).split('\n')[0]}` };
        }
        report.repinned = repin.label;
        repinUsed = true;
        attempt -= 1; // the re-pin is not a contention attempt: re-read the pinned ledger and run normally
        continue;
      }
    }
    // Apply the bootstrap first (if any) so the fact and decision derivations see a real state.
    let { eventsText: afterBoot, state, report: r0 } = appendAll(eventsText, lines);
    if (r0.refused.length) return { ...report, outcome: 'refused', exception: `bootstrap refused: ${r0.refused[0].reason}` };
    eventsText = afterBoot;

    // The shadow surface: find the App's own comment (placeholder or rendering), or create it once.
    const more = [];
    if (!state.surfaces.shadow) {
      const mine = (controlInboxComments ?? []).find((c) => c.author === botLogin && (c.body.startsWith(SHADOW_PLACEHOLDER.split('\n')[0]) || c.body.startsWith('<!-- wsf-control ledgerHead=')));
      const commentId = inherited ?? (mine ? mine.id : (await gh.createComment(state.surfaces.current.pr, SHADOW_PLACEHOLDER)).id);
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
    // A set-contracts that would unpin the running writer is never recorded: an older decision pinning some other
    // version, read again after a re-pin, must not lock the writer out (memo §4.4). It is reported instead.
    intake.events = intake.events.filter((x) => {
      if (x.event.type !== 'set-contracts' || !runningSha) return true;
      const pins = x.event.contracts.filter((c) => WRITER_CONTRACTS.includes(c.id));
      const ok = pins.length === WRITER_CONTRACTS.length && pins.every((c) => c.commit === runningSha || sameTree(c.commit, runningSha, c.path));
      if (!ok) report.intakeRefused.push({ commentId: x.commentId, reason: 'set-contracts would unpin the running writer; not recorded' });
      return ok;
    });
    const res = appendAll(eventsText, [...facts, ...intake.events.map((x) => ({ event: x.event, label: `comment-${x.commentId}` }))]);
    // Step 6 (AUTONOMY-ROUTER-1C): worker reports, review routing and handback, wakes and the wake clock.
    // `route` is off only in the Step-5 shadow tests, which pin that pipeline's exact lines; a live run always routes.
    const inboxes = {};
    if (route) for (const { inbox } of Object.values(res.state.workers)) inboxes[inbox] = await readInbox(inbox);
    const items = route ? workerComments(res.state, inboxes, botLogin) : [];
    // The merges are read on the state AFTER this run's decisions, so an acceptance recorded now is integrated now.
    const rr = route ? routerAppend(res.eventsText, res.state, { items, prs: await prReads(gh, items), inboxes, botLogin, now, merges: await mergeReads(gh, res.state) })
      : { eventsText: res.eventsText, state: res.state, appended: [], refused: [], intakeRefused: [], awaiting: [], exceptions: [], integrateUnverified: [] };
    report.integrateUnverified = rr.integrateUnverified.map((x) => `${x.packet} ${x.reason}`);
    report.intakeRefused = [...report.intakeRefused, ...rr.intakeRefused];
    report.awaiting = rr.awaiting.map((a) => `${a.packet} eligible=${a.awaiting.join(',') || 'none'} (${a.why})`);
    report.exceptions = rr.exceptions;
    const allAppended = [...r0.appended, ...r1.report.appended, ...res.report.appended, ...rr.appended];
    let nextText = rr.eventsText; state = rr.state;
    report.refused = [...res.report.refused, ...rr.refused];
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
    // Only after the ledger is pushed: post the wake comments, then record their delivery (a second CAS push).
    // A lost race here loses nothing: the next run finds each posted comment again by its marker.
    const wk = route ? await postWakes(gh, state, nextText, inboxes, botLogin) : { lines: [], posted: [] };
    report.wakesPosted = wk.posted;
    if (wk.lines.length) {
      const rd = appendAll(nextText, wk.lines.map((event) => ({ event, label: `comment-${event.commentId}` })));
      if (rd.report.appended.length) {
        commitState(dir, { 'events.jsonl': rd.eventsText, 'state.json': serialize(rd.state), 'CURRENT.md': `${renderCurrent(rd.state)}\n` }, `wsf-control: ${rd.report.appended.length} wake receipt(s), head ${rd.state.ledgerHead.slice(0, 12)}`, author);
        const pushed = pushFastForward(dir, remote, { env: gitEnv, ref });
        if (pushed.ok) { nextText = rd.eventsText; state = rd.state; allAppended.push(...rd.report.appended); }
        else report.deferred = `wake receipts not recorded this run (${pushed.rejected ? 'the ref moved' : 'push failed'}); the next run finds the posted comments by marker`;
      }
      report.refused.push(...rd.report.refused);
    }
    report.bootstrapped = !remoteSha;
    report.appended = allAppended;
    report.head = state.ledgerHead;
    // Only after the ledger is pushed: edit the App's own shadow comment in place, never another comment.
    if (state.surfaces.shadow) {
      const body = (await gh.comment(state.surfaces.shadow.commentId))?.body ?? null;
      const rendered = renderCurrent(state);
      const isPlaceholder = body !== null && body.startsWith(SHADOW_PLACEHOLDER.split('\n')[0]);
      const evidence = surfaceEvidence(state.surfaces.shadow.commentId, body);
      const known = { heads: ledgerHeads(nextText), renders: renderHashes(nextText) };
      // A recovery ledger renders into the comment its predecessor rendered: that ledger's heads, and only its, are
      // this surface's earlier heads (stale, edited in place). Any other foreign head stays an exception.
      if (!isPlaceholder && state.supersedes && evidence.markerHead && !known.heads.includes(evidence.markerHead)) {
        const prior = predecessorSurfaceHistory(remote, workdir, state.supersedes, gitEnv);
        if (prior) { known.heads = [...prior.heads, ...known.heads]; known.renders = { ...prior.renders, ...known.renders }; }
      }
      const sfc = isPlaceholder ? { status: 'stale' } : surfaceStatus(state, { currentSurface: evidence }, { ...known, surface: 'shadow' });
      if (sfc.status === 'exception') report.surface = `exception: ${sfc.detail}`;
      else if (body === rendered) report.surface = 'ok';
      else { await gh.editComment(state.surfaces.shadow.commentId, rendered); report.surface = 'edited'; }
    }
    report.outcome = changed || allAppended.length ? 'written' : 'unchanged';
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
  if (r.repinned) L.push(`REPINNED ${r.repinned}`);
  for (const x of r.wakesPosted ?? []) L.push(`WAKE_POSTED ${x}`);
  for (const x of r.awaiting ?? []) L.push(`AWAITING_REVIEWER ${x}`);
  for (const x of r.integrateUnverified ?? []) L.push(`INTEGRATE_UNVERIFIED ${x}`);
  for (const x of r.exceptions ?? []) L.push(`CONTROL_EXCEPTION ${x}`);
  if (r.deferred) L.push(`DEFERRED ${r.deferred}`);
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
    let event;
    try { event = bootstrapEvent(input, sha); } catch (e) {
      if (!(e instanceof Refused)) throw e;
      console.log(`DRY_RUN=refused :: ${e.message}`); process.exit(1);
    }
    const { eventsText, state, report } = appendAll('', [{ event, label: 'bootstrap' }]);
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
  const { WSF_CONTROL_WRITER_PRIVATE_KEY: pem, WSF_CONTROL_WRITER_APP_ID: appId, GITHUB_REPOSITORY: repo } = process.env;
  // The commit whose code is executing: the job checks out `main` at run time, which can be newer than the
  // event's GITHUB_SHA. The writer-code pin and the bootstrap pins must name what actually runs.
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  const runningSha = head.status === 0 && /^[0-9a-f]{40}$/.test(head.stdout.trim()) ? head.stdout.trim() : null;
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
    readInbox: (issue) => gh.recentComments(issue, 100),
  });
  console.log(formatReport(report));
  console.log(`WRITER=${botLogin} RUNNING_SHA=${runningSha}`);
  process.exit(report.outcome === 'refused' ? 1 : 0);
}
