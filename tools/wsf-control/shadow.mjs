/**
 * The Step-5 shadow reconcile, as pure functions (AUTONOMY-STATE-1B; accepted A+ memo §4.1, §12).
 *
 * A run takes the checked state and a GitHub snapshot the WRITER built itself,
 * and returns the v2 lines it may append. The caller never supplies an event:
 *
 *  - facts it derives on its own, under a Step-5 rule (rules.mjs SHADOW_DERIVED):
 *      reconcile-head   (R-RECONCILE-HEAD)  a delivered PR's head moved;
 *      record-evidence  (R-RECORD-EVIDENCE) only non-subject paths changed;
 *      stage            (R-STAGE)           a STAGED packet's own hosted run served its merge;
 *  - decisions it records, never derives: a Director/L0 decision posted in the control
 *    inbox as exactly one fenced `wsf-control-decision` block, recorded as class
 *    manual, rule MANUAL, source that comment (memo §3.1 manual-v1). The block names
 *    the event type and its fields only; the writer supplies actor, source, schema and
 *    authority, so a block cannot claim a class, a rule or another source. Only the
 *    repository owner's account may decide: the comment's author login must be exactly
 *    DECISION_OWNER and its author_association exactly OWNER (anything else, missing
 *    included, is refused), and the comment must be unedited (created_at === updated_at):
 *    a write collaborator can edit an owner comment while GitHub keeps the owner as its
 *    author, so an edited comment never decides (F1-R2a). To change a decision, the owner
 *    posts a new comment. Which role inside that account wrote it is not proven
 *    (accepted residual (a)); the class says so.
 *
 * Nothing here routes, reviews, accepts, releases or wakes: those rules are Step 6.
 * Every returned line is still appended through append.mjs, which reduces and
 * checks it; an illegal one is refused there and reported, never forced.
 */
import { SHADOW_DERIVED, RULES } from './rules.mjs';
import { LATEST_SCHEMA, WRITER_APP, EVENT_FIELDS } from './schema.mjs';
import { reconcile } from './reconcile.mjs';

/** The fenced block a Director/L0 decision is posted in. One per comment; anything else in the comment is prose. */
export const DECISION_FENCE = 'wsf-control-decision';
/** The one account whose control-inbox decisions are recorded (Check 71 F1): a public repository's other accounts never decide. */
export const DECISION_OWNER = 'idevinsimpson';
/** Why a comment's author may not decide, or null when it may. Fail closed: a missing login or association refuses. */
export function decisionAuthorProblem(c) {
  if (c.author !== DECISION_OWNER) return `author ${JSON.stringify(c.author ?? null)} is not the repository owner; only ${DECISION_OWNER} decides`;
  if (c.association !== 'OWNER') return `author_association ${JSON.stringify(c.association ?? null)} is not OWNER`;
  return null;
}
/**
 * Why a comment's text may not be trusted as the owner's, or null when it may (F1-R2a). GitHub keeps the original
 * author on an edit by anyone with write access, so only an unedited comment decides. Stable reasons, fail closed.
 */
export function decisionEditProblem(c) {
  const ts = (v) => typeof v === 'string' && v.length > 0;
  if (!ts(c.createdAt) || !ts(c.updatedAt)) return 'comment-timestamps-missing: created_at and updated_at are both required to prove the comment is unedited';
  if (c.createdAt !== c.updatedAt) return `edited-comment: updated ${c.updatedAt} after created ${c.createdAt}; an edited comment never decides, post a new comment`;
  return null;
}
/** Decisions the writer records from the control inbox. Bootstrap, upgrades and its own surface are never taken from a comment. */
export const INTAKE_TYPES = Object.freeze(Object.keys(EVENT_FIELDS).filter((t) => !['bootstrap', 'schema-upgrade', 'set-shadow-surface'].includes(t)));

const v2 = (repo, type, fields, source, rule, evidence) => ({
  schema: LATEST_SCHEMA, type, actor: WRITER_APP, source: { ...source, repo },
  authority: { class: RULES[rule].class, rule, evidence }, ...fields,
});

/**
 * The fact lines a Step-5 run derives from reconcile findings. Only `wins=github` findings whose suggestion is a
 * Step-5 rule; every other finding is reported, not acted on. Deterministic order: reconcile's (packet id order).
 */
export function derivedFacts(state, snap, { heads, renders } = {}) {
  const repo = state.repository;
  const out = [];
  for (const x of reconcile(state, snap, { heads, renders, surface: 'shadow' })) {
    if (x.wins !== 'github' || !x.suggest?.type) continue;
    const p = state.packets[x.packet];
    if (x.suggest.type === 'reconcile-head' && SHADOW_DERIVED.includes('R-RECONCILE-HEAD')) {
      out.push(v2(repo, 'reconcile-head', { packet: x.packet, prHeadSha: x.suggest.prHeadSha }, { kind: 'commit', id: x.suggest.prHeadSha }, 'R-RECONCILE-HEAD',
        [{ kind: 'pull_request', id: p.pr }, { kind: 'commit', id: x.suggest.prHeadSha }]));
    } else if (x.suggest.type === 'record-evidence' && SHADOW_DERIVED.includes('R-RECORD-EVIDENCE')) {
      out.push(v2(repo, 'record-evidence', { packet: x.packet, evidenceSha: x.suggest.evidenceSha }, { kind: 'commit', id: x.suggest.evidenceSha }, 'R-RECORD-EVIDENCE',
        [{ kind: 'pull_request', id: p.pr }, { kind: 'commit', id: x.suggest.evidenceSha }]));
    } else if (x.suggest.type === 'stage' && SHADOW_DERIVED.includes('R-STAGE')) {
      // The deployment receipt only: the run concluded success AND the served marker is the packet's own merge.
      const served = snap.staging?.servedSha;
      if (served && served === p.artifact.mergeSha) {
        out.push(v2(repo, 'stage', { packet: x.packet, runId: x.suggest.runId, servedSha: served }, { kind: 'workflow_run', id: x.suggest.runId }, 'R-STAGE',
          [{ kind: 'workflow_run', id: x.suggest.runId }]));
      }
    }
  }
  return out;
}

/** The single decision block of a comment body, or null. More than one block is refused, never guessed between. */
export function decisionBlock(body) {
  const re = new RegExp(`^\`\`\`${DECISION_FENCE}[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n\`\`\`[ \\t]*$`, 'gm');
  const blocks = [...String(body).matchAll(re)];
  if (blocks.length === 0) return null;
  if (blocks.length > 1) return { error: `the comment carries ${blocks.length} ${DECISION_FENCE} blocks; one decision per comment` };
  try { return { value: JSON.parse(blocks[0][1]) }; } catch { return { error: `the ${DECISION_FENCE} block is not JSON` }; }
}

/**
 * Decision lines from control-inbox comments: [{ id, body, author, association, createdAt, updatedAt }] (the comment
 * id, its exact body, the author's login, GitHub's author_association and the comment's created_at and updated_at).
 * A block from anyone but the owner, or in an edited comment, is refused before it is read. Returns
 * { events, refused: [{ commentId, reason }] }. A refused block is reported (INTAKE_REFUSED) and never recorded.
 * Only envelope-free fields are taken from the block: type and that type's fields.
 */
export function decisionIntake(state, comments) {
  const repo = state.repository;
  const events = [];
  const refused = [];
  for (const c of [...comments].sort((a, b) => a.id - b.id)) {
    const blk = decisionBlock(c.body);
    if (!blk) continue;
    const who = decisionAuthorProblem(c) ?? decisionEditProblem(c);
    if (who) { refused.push({ commentId: c.id, reason: who }); continue; }
    if (blk.error) { refused.push({ commentId: c.id, reason: blk.error }); continue; }
    const d = blk.value;
    if (!d || typeof d !== 'object' || Array.isArray(d)) { refused.push({ commentId: c.id, reason: 'the decision must be a JSON object' }); continue; }
    if (!INTAKE_TYPES.includes(d.type)) { refused.push({ commentId: c.id, reason: `${JSON.stringify(d.type)} is not a decision the writer records from a comment` }); continue; }
    const [req, opt] = EVENT_FIELDS[d.type];
    const extra = Object.keys(d).filter((k) => k !== 'type' && !Object.hasOwn(req, k) && !Object.hasOwn(opt, k));
    if (extra.length) { refused.push({ commentId: c.id, reason: `the block may carry only the event's own fields; refused ${extra.join(', ')} (actor, source, schema and authority are the writer's)` }); continue; }
    const { type, ...fields } = d;
    events.push({ commentId: c.id, event: v2(repo, type, fields, { kind: 'comment', id: c.id }, 'MANUAL', [{ kind: 'comment', id: c.id }]) });
  }
  return { events, refused };
}

/** The line that records the writer's own shadow CURRENT comment once it has created it. */
export function shadowSurfaceEvent(state, commentId) {
  const pr = state.surfaces.current.pr;
  return v2(state.repository, 'set-shadow-surface', { pr, commentId }, { kind: 'comment', id: commentId }, 'R-SHADOW-SURFACE', [{ kind: 'comment', id: commentId }]);
}

/** The first line of the placeholder the writer posts before it can render (it carries no ledger marker, so it is never mistaken for a rendering). */
export const SHADOW_PLACEHOLDER = '<!-- wsf-control shadow-current placeholder; the writer replaces this with its rendering -->\nShadow CURRENT: being created by the wsf-control-writer App.';
