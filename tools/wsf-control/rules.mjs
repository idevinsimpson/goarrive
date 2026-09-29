/**
 * The named derivation rules of schema v2 (accepted A+ memo §3.1–§3.2, §8).
 *
 * Every v2 ledger line carries `authority: { class, rule, evidence }`. The rule
 * must be listed here, with that class, for that event type. This table is the
 * single source: the reducer, check.mjs and the shadow writer all read it, and
 * there is no second copy (memo §10.3 rejects a separate JSON for it).
 *
 * `step` is the program step from which the trusted writer may DERIVE the rule on
 * its own. Step 5 (AUTONOMY-STATE-1B) is shadow reconcile only: the writer
 * records bootstrap and pure GitHub facts, never a routing, review, acceptance
 * or wake transition. A rule with a later step is still a legal line when a
 * recorded decision (class manual) carries it; the writer just never derives it.
 */
export const RULES = Object.freeze({
  // Pure GitHub facts: the writer re-derives them itself (Step 5 shadow set).
  'R-RECONCILE-HEAD': { class: 'derived', events: ['reconcile-head'], step: 5, what: 'a delivered PR\'s head moved; the subject does not' },
  'R-RECORD-EVIDENCE': { class: 'derived', events: ['record-evidence'], step: 5, what: 'only paths outside the subject changed since the subject' },
  'R-STAGE': { class: 'derived', events: ['stage'], step: 5, what: 'the hosted proof run of a STAGED packet served its integrated subject' },
  'R-SHADOW-SURFACE': { class: 'derived', events: ['set-shadow-surface'], step: 5, what: 'the writer created its shadow CURRENT comment' },
  // Routing and progression: Step 6 onward.
  'R-RELEASE-NEXT': { class: 'derived', events: ['release'], step: 6, what: 'the owner holds no ball and this is its one NEXT' },
  'R-RETRACT': { class: 'derived', events: ['retract-release'], step: 6, what: 'a recorded hold before the owner ACKed' },
  'R-DELIVER-1': { class: 'derived', events: ['deliver'], step: 6, what: 'the named SHA exists, is the PR head, and descends from the recorded base' },
  'R-ROUTE-REVIEW': { class: 'derived', events: ['review'], step: 6, what: 'the packet review policy and free eligible reviewers' },
  'R-FINDING-HANDBACK': { class: 'derived', events: ['finding', 'apply-finding'], step: 6, what: 'a structurally valid W# finding hands the ball back' },
  'R-PREEMPT': { class: 'derived', events: ['retract-release', 'block', 'apply-finding'], step: 6, what: 'an in-flight correction preempts the same owner\'s newer work (memo §8)' },
  'R-AUTO-ADVANCE': { class: 'derived', events: ['accept'], step: 6, what: 'owner event-driven serialization: technical packet, every required W# pass, subject unchanged' },
  'R-INTEGRATE': { class: 'derived', events: ['integrate'], step: 6, what: 'GitHub merged the accepted subject; the merge itself stays L0\'s' },
  'R-PROOF-PASS': { class: 'derived', events: ['proof-pass'], step: 6, what: 'the proof run concluded success with its markers' },
  'R-PROOF-FAIL': { class: 'derived', events: ['proof-fail'], step: 6, what: 'the proof run failed under the packet\'s pre-approved failure contract' },
  'R-UNBLOCK-MILESTONE': { class: 'derived', events: ['unblock'], step: 6, what: 'every packet blocker reached its milestone' },
  'R-UNBLOCK-RESOLVER': { class: 'derived', events: ['unblock'], step: 6, what: 'a machine-resolvable external condition cleared by its named resolver' },
  'R-FASTPATH': { class: 'derived', events: ['begin-proof', 'stage'], step: 7, what: 'fast-path invariants hold and the writer made the dispatch' },
  // Wakes (memo §3.2 "wake, wake-retry, wake-timeout (new) | derived | §6"; receipt model §6.2).
  'R-WAKE': { class: 'derived', events: ['wake'], step: 6, what: 'a worker now holds a ball it has not been woken for (release, handback or review assignment)' },
  'R-WAKE-DELIVERED': { class: 'derived', events: ['wake-delivered'], step: 6, what: 'the App posted the wake comment carrying the wakeId in the worker\'s inbox' },
  'R-WAKE-RETRY': { class: 'derived', events: ['wake-retry'], step: 6, what: 'no ACK 15 minutes after the wake comment, and the ball is still the worker\'s: one re-post' },
  'R-WAKE-TIMEOUT': { class: 'derived', events: ['wake-timeout'], step: 6, what: 'no ACK 15 minutes after the re-post: CONTROL_EXCEPTION wake-undelivered' },
  // Worker facts: recorded from the worker's canonical inbox, author not proven (accepted residual (a)).
  'A-ACK': { class: 'attested', events: ['ack'], step: 6, what: 'the owner ACKed in its canonical inbox' },
  'A-DELIVER': { class: 'attested', events: ['deliver'], step: 6, what: 'the owner delivered a named SHA in its canonical inbox' },
  'A-PASS': { class: 'attested', events: ['review-pass'], step: 6, what: 'the assigned reviewer passed, quoting its assignment' },
  'A-FINDING': { class: 'attested', events: ['finding'], step: 6, what: 'the assigned reviewer found, quoting its assignment' },
  'A-WAKE-ACK': { class: 'attested', events: ['wake-ack'], step: 6, what: 'the woken worker quoted the wakeId in its canonical inbox, after the wake comment' },
  // Owner decisions through the approval-gated decision workflow only.
  'R-OWNER-DECISION': { class: 'protected-human', events: ['accept', 'unblock'], step: 6, what: 'an owner decision approved in the GitHub environment gate' },
  // Director/L0 decisions recorded as they are today: attested from the control inbox, labelled manual.
  'MANUAL': { class: 'manual', events: null, step: 5, what: 'a Director/L0 decision recorded from the control inbox (manual-v1)' },
});

/** The rules the Step-5 shadow writer may derive by itself. Everything else it records only from a decision. */
export const SHADOW_DERIVED = Object.freeze(Object.keys(RULES).filter((r) => RULES[r].class === 'derived' && RULES[r].step <= 5));

/** Problems with a v2 authority block for an event type; empty means it names a rule that may carry this line. */
export function authorityProblems(type, a, { refOk }) {
  const out = [];
  if (!a || typeof a !== 'object' || Array.isArray(a)) return ['authority must be { class, rule, evidence }'];
  const keys = Object.keys(a).sort().join();
  if (keys !== 'class,evidence,rule') out.push('authority must be exactly { class, rule, evidence }');
  const r = RULES[a.rule];
  if (!r) return [...out, `authority.rule ${JSON.stringify(a.rule)} is not a named rule`];
  if (a.class !== r.class) out.push(`authority.rule ${a.rule} is of class ${r.class}, not ${JSON.stringify(a.class)}`);
  if (r.events && !r.events.includes(type)) out.push(`authority.rule ${a.rule} does not derive a ${type} event (it derives ${r.events.join(', ')})`);
  if (!Array.isArray(a.evidence) || a.evidence.length === 0 || a.evidence.length > 10 || !a.evidence.every(refOk)) {
    out.push('authority.evidence must be 1–10 typed refs { kind, id }');
  }
  return out;
}
