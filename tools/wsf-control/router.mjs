/**
 * The Step-6 router, as pure functions (AUTONOMY-ROUTER-1C; accepted A+ memo §3.2, §5.2, §6, §7).
 *
 * First bounded workflow: delivery → independent-review assignment → reviewer wake, and a
 * PASS or finding returning the ball. Every function here reads the ledger (and, for the
 * wake clock, GitHub comment timestamps the writer read itself) and returns the lines the
 * writer may append. Nothing here posts, pushes or reads the network.
 *
 *  - balls        who holds a ball now, and since which ledger head: the owner of a work packet in a
 *                 worker-owned phase (RELEASED, ACKED, CHANGES_REQUESTED), and each outstanding W#
 *                 reviewer of an UNDER_REVIEW one. An ACK keeps the same ball (and the same wake).
 *  - wakeId       sha256(ledger head that set the ball, worker, packet, phase) (memo §6.2): the
 *                 same ball re-derived is the same wake, so it is never requested or posted twice;
 *                 a new ball is a new wake.
 *  - R-WAKE       a ball with no recorded wake gets one.
 *  - R-ROUTE-REVIEW  a DELIVERED work packet is assigned the first free eligible W# reviewers
 *                 its policy requires, in worker-id order; never its owner; one ball per worker.
 *                 Too few free reviewers: nothing is written and AWAITING_REVIEWER is reported.
 *  - R-FINDING-HANDBACK  a pending finding is applied once its owner holds no other ball.
 *  - R-INTEGRATE  an ACCEPTED work packet whose PR GitHub merged is INTEGRATED at that merge, derived in the same run
 *                 that records the acceptance (or in the first run after a later merge), once: the merged head must be
 *                 the accepted head and the merge commit must contain it. Anything else is reported, never recorded.
 *  - R-WAKE-RETRY / R-WAKE-TIMEOUT  15 minutes after the wake comment with no ACK and the ball
 *                 still the worker's (not superseded): one re-post; 15 minutes after that: a timeout,
 *                 reported as CONTROL_EXCEPTION wake-undelivered until the ball moves on. The ledger
 *                 stores no clock.
 */
import { emptyState } from './transitions.mjs';
import { applyLine, ledgerLines } from './reduce.mjs';
import { DEFAULT_REVIEW, LATEST_SCHEMA, RE, WRITER_APP, canon, holders, sha256 } from './schema.mjs';
import { RULES } from './rules.mjs';
import { neededTransitions, workerWatch } from './derive.mjs';
import { mirrorPlan } from './northstar.mjs';

/** The rules the Step-6 writer derives or records by itself. Everything else still needs a recorded decision. */
export const ROUTER_RULES = Object.freeze(['R-FASTPATH', 'R-INTEGRATE', 'R-ROUTE-REVIEW', 'R-FINDING-HANDBACK', 'R-WAKE', 'R-WAKE-DELIVERED', 'R-WAKE-RETRY', 'R-WAKE-TIMEOUT', 'A-ACK', 'A-DELIVER', 'A-PASS', 'A-FINDING', 'A-WAKE-ACK', 'R-NORTHSTAR-DELTA', 'R-NORTHSTAR-QUEUE', 'R-NORTHSTAR-RELEASE']);
/** Minutes without an ACK before the one retry, and again before the timeout (memo §6.2). */
export const WAKE_ACK_MINUTES = 15;

const W_RE = /^W[1-9][0-9]?$/;

/** A v2 line the writer appends, with its rule's class. */
export function line(repo, type, fields, source, rule, evidence) {
  if (!ROUTER_RULES.includes(rule)) throw new Error(`the Step-6 writer does not derive ${rule}`);
  return {
    schema: LATEST_SCHEMA, type, actor: WRITER_APP, source: { kind: source.kind, id: source.id, repo },
    authority: { class: RULES[rule].class, rule, evidence: evidence.map((r) => ({ kind: r.kind, id: r.id })) }, ...fields,
  };
}


/**
 * Per packet and holder, the ball it holds now: the ledger head and source of the line at which it became a holder,
 * and the phase then. A holder keeps the same ball while it holds it (a release ACKed is the same ball, so the same
 * wake); leaving and coming back (a handback after review) is a new ball, so a new wake.
 * Replays the (already checked) ledger; returns { state, since: { [packet]: { [worker]: { head, source, phase } } } }.
 */
export function ballHistory(eventsText) {
  let s = emptyState();
  const since = {};
  for (const text of ledgerLines(eventsText)) {
    const e = JSON.parse(text);
    // Every packet is compared, not only the one a line names: a bootstrap imports balls without naming a packet.
    const before = Object.fromEntries(Object.entries(s.packets).map(([id, p]) => [id, holders(p)]));
    s = applyLine(s, e);
    s.ledgerHead = sha256(text);
    for (const [id, p] of Object.entries(s.packets)) {
      const now = holders(p);
      const was = before[id] ?? [];
      const kept = Object.fromEntries(Object.entries(since[id] ?? {}).filter(([w]) => now.includes(w)));
      for (const w of now.filter((x) => !was.includes(x))) kept[w] = { head: s.ledgerHead, source: e.source, phase: p.phase };
      since[id] = kept;
    }
  }
  return { state: s, since };
}

export const wakeIdOf = ({ head, worker, packet, phase }) => sha256(canon({ head, worker, packet, phase }));

const REASON = { RELEASED: 'release', ACKED: 'release', CHANGES_REQUESTED: 'handback', UNDER_REVIEW: 'review' };

/** Every ball that wakes a worker, in packet then worker order. */
export function balls(eventsText) {
  const { state: s, since } = ballHistory(eventsText);
  const out = [];
  for (const id of Object.keys(s.packets).sort()) {
    for (const worker of holders(s.packets[id])) {
      const at = since[id]?.[worker];
      if (!at) continue;
      out.push({ packet: id, worker, phase: at.phase, reason: REASON[at.phase], head: at.head, source: at.source, wakeId: wakeIdOf({ head: at.head, worker, packet: id, phase: at.phase }) });
    }
  }
  return out;
}

/** R-WAKE: the wake lines for balls that have none yet. */
export function wakeLines(state, eventsText) {
  return balls(eventsText).filter((b) => !state.wakes?.[b.wakeId]).map((b) => line(state.repository, 'wake',
    { wakeId: b.wakeId, packet: b.packet, worker: b.worker, reason: b.reason }, b.source, 'R-WAKE', [b.source]));
}

/**
 * R-ROUTE-REVIEW for one DELIVERED packet: { line } or { awaiting: [eligible] }. The policy's classes are
 * filled in order; a worker that declares classes must hold the class, an undeclared worker is eligible
 * (as in 1A); a worker holding any ball is not free; the owner never reviews its own packet.
 */
export function routeReview(state, id) {
  const p = state.packets[id];
  const policy = p.review ?? DEFAULT_REVIEW;
  if (!policy.workerReviews.length) return { none: 'the policy requires no W# review' };
  const src = p.authority.lastTransition;
  if (!src || src.kind !== 'comment') return { awaiting: [], why: 'the delivery does not rest on a comment' };
  const chosen = [];
  const eligibleAll = [];
  for (const need of policy.workerReviews) {
    const eligible = Object.keys(state.workers).sort().filter((w) => w !== p.owner && !chosen.includes(w)
      && (!state.workers[w].classes || state.workers[w].classes.includes(need.class)));
    eligibleAll.push(...eligible.filter((w) => !eligibleAll.includes(w)));
    const free = eligible.filter((w) => !workerWatch(state, w)).slice(0, need.count);
    if (free.length < need.count) return { awaiting: eligibleAll, why: `too few free ${need.class} reviewers` };
    chosen.push(...free);
  }
  return { line: line(state.repository, 'review', { packet: id, reviewers: chosen }, src, 'R-ROUTE-REVIEW', [src]) };
}

/** The Step-6 progression lines on this state, one at a time (each changes who is free). */
export function progressionLine(state) {
  for (const id of Object.keys(state.packets).sort()) {
    const p = state.packets[id];
    if (p.kind === 'work' && p.phase === 'DELIVERED' && !p.pendingFinding) {
      const r = routeReview(state, id);
      if (r.line) return { line: r.line, label: `route-${id}` };
    }
  }
  for (const t of neededTransitions(state).filter((x) => x.event === 'apply-finding')) {
    const p = state.packets[t.packet];
    const src = p.pendingFinding;
    return { line: line(state.repository, 'apply-finding', { packet: t.packet }, src, 'R-FINDING-HANDBACK', [src]), label: `handback-${t.packet}` };
  }
  return null;
}

/** ACCEPTED work packets with a PR: the ones whose merge the writer reads to derive R-INTEGRATE, in packet order. */
export const integrateCandidates = (state) => Object.keys(state.packets).sort()
  .filter((id) => { const p = state.packets[id]; return p.kind === 'work' && p.phase === 'ACCEPTED' && p.pr !== null && p.authority.accepted?.kind === 'comment'; });

/**
 * R-INTEGRATE on this state. `merges` is the writer's own read per candidate packet:
 * { merged, mergeSha, headSha, contains } (contains: the merge commit descends from the accepted head; null if unread),
 * or null when the PR could not be read. Returns { lines, unverified: [{ packet, reason }] }. A PR not merged yet is
 * neither: the packet simply stays ACCEPTED until a later run reads the merge.
 */
export function integrateLines(state, merges) {
  const lines = [];
  const unverified = [];
  for (const id of integrateCandidates(state)) {
    if (!Object.hasOwn(merges, id)) continue;
    const p = state.packets[id];
    const m = merges[id];
    const no = (reason) => unverified.push({ packet: id, reason: `PR #${p.pr}: ${reason}` });
    if (!m) { no('could not be read'); continue; }
    if (!m.merged) continue;
    const head = p.artifact.prHeadSha ?? p.artifact.subjectSha;
    if (!RE.sha.test(String(m.mergeSha))) { no('merged, but GitHub names no merge commit'); continue; }
    if (m.headSha !== head) { no(`merged head ${String(m.headSha).slice(0, 8)} is not the accepted head ${String(head).slice(0, 8)}`); continue; }
    if (m.contains !== true) { no(`merge ${m.mergeSha.slice(0, 8)} ${m.contains === false ? 'does not contain' : 'could not be checked against'} the accepted head ${head.slice(0, 8)}`); continue; }
    const pr = { kind: 'pull_request', id: p.pr };
    lines.push(line(state.repository, 'integrate', { packet: id, mergeSha: m.mergeSha, acceptance: p.authority.accepted.id }, pr, 'R-INTEGRATE',
      [pr, { kind: 'commit', id: m.mergeSha }, { kind: 'comment', id: p.authority.accepted.id }]));
  }
  return { lines, unverified };
}

/**
 * NORTHSTAR-MIRROR-INTAKE-1. R-NORTHSTAR-DELTA: the desired-revision line for one verified #578 delta
 * (northstar.mjs parseDelta, then the writer's own read-only reachability reads). It rests on the feed comment.
 */
export function desiredLine(state, delta) {
  const src = { kind: 'comment', id: delta.commentId };
  return line(state.repository, 'northstar-desired', { sha: delta.sha, routes: [...delta.routes] }, src, 'R-NORTHSTAR-DELTA', [src]);
}

/**
 * R-NORTHSTAR-QUEUE then R-NORTHSTAR-RELEASE: the one mirror packet for the desired revision, queued and released to its
 * owner in the same run, when no mirror packet is live and the owner holds no ball and no NEXT. The R-WAKE that follows
 * wakes it. Returns { lines, plan }; nothing when the plan waits.
 */
export function mirrorLines(state) {
  const plan = mirrorPlan(state);
  if (!plan.queue) return { lines: [], plan };
  return {
    plan,
    lines: [
      line(state.repository, 'queue', plan.queue, plan.source, 'R-NORTHSTAR-QUEUE', [plan.source]),
      line(state.repository, 'release', plan.release, plan.source, 'R-NORTHSTAR-RELEASE', [plan.source]),
    ],
  };
}

/** Packets waiting on a reviewer this run could not assign, for program-view and the report. */
export function awaitingReviewers(state) {
  return Object.keys(state.packets).sort().filter((id) => state.packets[id].kind === 'work' && state.packets[id].phase === 'DELIVERED' && !state.packets[id].pendingFinding)
    .map((id) => ({ packet: id, ...routeReview(state, id) })).filter((r) => r.awaiting);
}

/**
 * R-WAKE-RETRY and R-WAKE-TIMEOUT. `commentTimes` maps an App wake comment id to its created_at, as the
 * writer read it from the worker's inbox; `now` is the run clock (ms). A wake whose ball has moved on is
 * never retried: the worker's WATCH is off for it. A comment the writer cannot see is reported, not guessed.
 */
export function wakeTimerLines(state, eventsText, commentTimes, now) {
  const out = [];
  const unknown = [];
  for (const [wakeId, w] of Object.entries(state.wakes ?? {})) {
    if (w.superseded || !['delivered', 'redelivered'].includes(w.status)) continue;
    const last = w.comments[w.comments.length - 1];
    const at = Date.parse(commentTimes[last] ?? '');
    if (!Number.isFinite(at)) { unknown.push({ wakeId, commentId: last }); continue; }
    if (now - at < WAKE_ACK_MINUTES * 60000) continue;
    const src = { kind: 'comment', id: last };
    out.push(line(state.repository, w.status === 'delivered' ? 'wake-retry' : 'wake-timeout', { wakeId, packet: w.packet }, src, w.status === 'delivered' ? 'R-WAKE-RETRY' : 'R-WAKE-TIMEOUT', [src]));
  }
  return { lines: out, unknown };
}

/**
 * The open wake exceptions: timed out, and the worker still holds that ball. A superseded wake (the reducer marks it
 * once the worker no longer holds the ball, e.g. after reassign-review) is resolved: writer and views agree on this set.
 */
export const openWakeTimeouts = (state) => Object.entries(state.wakes ?? {}).filter(([, w]) => w.status === 'timed-out' && !w.superseded);
/** CONTROL_EXCEPTION wake-undelivered lines, the same for the writer's report and program-view. */
export const wakeExceptions = (state) => openWakeTimeouts(state).map(([id, w]) => `wake-undelivered ${w.worker} ${w.packet} wake=${id.slice(0, 12)}`);

/** Wakes requested but not yet posted (or retried and not yet re-posted), still current: the writer posts these after its push. */
export const wakesToPost = (state) => Object.entries(state.wakes ?? {}).filter(([, w]) => !w.superseded && ['requested', 'retried'].includes(w.status)).map(([wakeId, w]) => ({ wakeId, ...w }));

export { RE, holders };
