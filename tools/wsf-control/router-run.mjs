/**
 * The Step-6 part of a writer run (AUTONOMY-ROUTER-1C): worker facts in, routing and wakes out.
 *
 * Order inside one run, after the Director/L0 decisions:
 *   0. integration: an ACCEPTED packet whose PR is merged (R-INTEGRATE), so an acceptance recorded in this run, or a
 *      merge that landed since the last one, is integrated now and not left for some later trigger;
 *   1. worker reports from every registered inbox, oldest comment first (worker-intake.mjs);
 *   2. progression, one line at a time: review routing (R-ROUTE-REVIEW), handback (R-FINDING-HANDBACK);
 *   3. a wake for every ball without one (R-WAKE);
 *   4. the wake clock: one retry, then a timeout (R-WAKE-RETRY, R-WAKE-TIMEOUT).
 * The caller pushes those lines, then posts the wake comments (idempotently, found again by their marker)
 * and records wake-delivered for each in a second push. Everything here but the PR reads and the posting is pure.
 */
import { appendAll } from './append-all.mjs';
import { balls, integrateCandidates, integrateLines, progressionLine, wakeLines, wakeTimerLines, wakeExceptions, wakesToPost, awaitingReviewers, line } from './router.mjs';
import { workerBlock, workerReport, WORKER_FENCE } from './worker-intake.mjs';

/** Comment ids the ledger already rests on (as sources): a re-read of one of them is a no-op. */
export const recordedComments = (eventsText) => new Set(eventsText.trimEnd().split('\n').filter(Boolean).map((l) => JSON.parse(l).source).filter((s) => s.kind === 'comment').map((s) => s.id));

/** Every non-App comment of every registered worker inbox, as [{ worker, comment }], oldest first. */
export function workerComments(state, inboxes, botLogin) {
  const out = [];
  for (const [w, { inbox }] of Object.entries(state.workers)) for (const c of inboxes[inbox] ?? []) if (c.author !== botLogin) out.push({ worker: w, comment: c });
  return out.sort((a, b) => a.comment.id - b.comment.id);
}

/** The writer's own reads of every PR a deliver report names: { [pr]: { state, headSha, descends } | null }. */
export async function prReads(gh, items) {
  const out = {};
  for (const { comment } of items) {
    const blk = workerBlock(comment.body);
    if (!blk?.value || blk.value.type !== 'deliver' || Object.hasOwn(out, blk.value.pr)) continue;
    const pr = await gh.pull(blk.value.pr);
    out[blk.value.pr] = pr ? { state: pr.state, headSha: pr.headSha, descends: pr.baseSha ? await gh.descends(pr.baseSha, blk.value.subjectSha) : null } : null;
  }
  return out;
}

/** The writer's own reads of every ACCEPTED packet's PR: { [packet]: { merged, mergeSha, headSha, contains } | null }. */
export async function mergeReads(gh, state) {
  const out = {};
  for (const id of integrateCandidates(state)) {
    const p = state.packets[id];
    const pr = await gh.pull(p.pr);
    if (!pr) { out[id] = null; continue; }
    const head = p.artifact.prHeadSha ?? p.artifact.subjectSha;
    const contains = pr.merged && pr.mergeSha && pr.headSha === head ? await gh.descends(head, pr.mergeSha) : null;
    out[id] = { merged: pr.merged === true, mergeSha: pr.mergeSha ?? null, headSha: pr.headSha, contains };
  }
  return out;
}

/**
 * Steps 0–4 on (eventsText, state). Returns the new texts, what was appended and refused, the worker reports
 * refused, packets awaiting a reviewer, open wake exceptions, and wake comments whose time could not be read.
 */
export function routerAppend(eventsText, state, { items, prs, inboxes, botLogin, now, merges = {} }) {
  const appended = [];
  const refused = [];
  const intakeRefused = [];
  const add = (lines) => {
    const r = appendAll(eventsText, lines);
    eventsText = r.eventsText; state = r.state;
    appended.push(...r.report.appended); refused.push(...r.report.refused);
  };
  // 0. integration of accepted, merged packets
  const integ = integrateLines(state, merges);
  add(integ.lines.map((event) => ({ event, label: `pr-${event.source.id}` })));
  // 1. worker reports
  for (const { worker, comment } of items) {
    const current = new Set(balls(eventsText).map((b) => b.wakeId));
    const blk = workerBlock(comment.body);
    const res = workerReport(state, worker, comment, { current, recorded: recordedComments(eventsText), pr: blk?.value?.pr ? prs[blk.value.pr] ?? null : null });
    if (!res) continue;
    if (res.refused) intakeRefused.push({ commentId: comment.id, reason: `${worker}: ${res.refused}` });
    else add(res.lines.map((event) => ({ event, label: `${worker}-comment-${comment.id}` })));
  }
  // 2. progression, one line at a time (each changes who holds a ball), bounded
  for (let i = 0; i < 50; i += 1) {
    const next = progressionLine(state);
    if (!next) break;
    const before = appended.length;
    add([{ event: next.line, label: next.label }]);
    if (appended.length === before) break; // refused or a no-op: do not spin
  }
  // 3. wakes for balls without one
  add(wakeLines(state, eventsText).map((event) => ({ event, label: `${event.worker}-${event.reason}` })));
  // 4. the wake clock, from the App's own comment timestamps in the inboxes it posted to
  const times = {};
  for (const cs of Object.values(inboxes)) for (const c of cs) if (c.author === botLogin && c.createdAt) times[c.id] = c.createdAt;
  const timers = wakeTimerLines(state, eventsText, times, now);
  add(timers.lines.map((event) => ({ event, label: event.type })));
  return { eventsText, state, appended, refused, intakeRefused, awaiting: awaitingReviewers(state), exceptions: wakeExceptions(state), unknownTimes: timers.unknown, integrateUnverified: integ.unverified };
}

const REASON_TEXT = {
  release: (p, id) => `packet \`${id}\` is released to you`,
  handback: (p, id) => `packet \`${id}\` is handed back to you with a finding (subject \`${p.artifact.subjectSha}\`)`,
  review: (p, id) => `you are assigned the independent review of \`${id}\` at subject \`${p.artifact.subjectSha}\` (PR #${p.pr}, owner ${p.owner})`,
};

/** The marker a wake comment starts with; the writer finds a posted wake again by it (never by prose). */
export const wakeMarker = (wakeId, attempt) => `<!-- wsf-control wake ${wakeId} attempt=${attempt} -->`;

/** The App's wake comment: the worker-inbox wake template (SKILL.md "Worker-inbox wake"). */
export function wakeComment(state, wakeId, w, attempt) {
  const p = state.packets[w.packet];
  const report = w.reason === 'review'
    ? `{"type":"pass","packet":"${w.packet}","wakeId":"${wakeId}","subjectSha":"${p.artifact.subjectSha}"}`
    : `{"type":"ack","packet":"${w.packet}","wakeId":"${wakeId}"}`;
  return [
    wakeMarker(wakeId, attempt),
    `**WAKE ${w.worker}**: ${REASON_TEXT[w.reason](p, w.packet)}.${attempt > 1 ? ' (Re-post: the first wake had no ACK.)' : ''}`,
    '',
    `First act: read \`wsf-control-state-2\`, run \`check\` and \`worker-view ${w.worker}\`. If WATCH is off, stop and post nothing.`,
    'If WATCH is on, answer in this inbox with exactly one block, then work:',
    '',
    `\`\`\`${WORKER_FENCE}`,
    report,
    '```',
    '',
    w.reason === 'review'
      ? '`pass` or `finding`, quoting this wakeId and the subject. `ack` alone acknowledges the wake.'
      : '`ack` first; deliver later with `{"type":"deliver","packet":…,"wakeId":…,"pr":N,"subjectSha":"<PR head>"}`.',
  ].join('\n');
}

/**
 * Post every requested (or retried) wake whose ball is still current, once: an App comment already carrying
 * the marker for this attempt is reused. Returns the wake-delivered lines and what was posted.
 */
export async function postWakes(gh, state, eventsText, inboxes, botLogin) {
  const lines = [];
  const posted = [];
  for (const w of wakesToPost(state)) { // superseded wakes (the ball moved on before the post) are never posted
    const inbox = state.workers[w.worker].inbox;
    const attempt = w.comments.length + 1;
    const marker = wakeMarker(w.wakeId, attempt);
    const found = (inboxes[inbox] ?? []).find((c) => c.author === botLogin && c.body.startsWith(marker) && !w.comments.includes(c.id));
    const commentId = found ? found.id : (await gh.createComment(inbox, wakeComment(state, w.wakeId, w, attempt))).id;
    posted.push(`${w.worker} ${w.packet} attempt=${attempt} comment=${commentId}${found ? ' (found)' : ''}`);
    const src = { kind: 'comment', id: commentId };
    lines.push(line(state.repository, 'wake-delivered', { wakeId: w.wakeId, packet: w.packet, commentId }, src, 'R-WAKE-DELIVERED', [src]));
  }
  return { lines, posted };
}
