/** Schema v2 (AUTONOMY-STATE-1B): provenance, review policy, contract pins, DELIVERED-SUCCESSOR, R-PREEMPT, fail-closed versions. */
import assert from 'node:assert/strict';
import { appendEvent } from '../append.mjs';
import { invariants } from '../check.mjs';
import { blockerCleared, neededTransitions } from '../derive.mjs';
import { reduce, serialize } from '../reduce.mjs';
import { renderCurrent, ACCEPTED_RESIDUALS } from '../render-current.mjs';
import { DEFAULT_REVIEW, RE, canon, eventId, sha256 } from '../schema.mjs';
import { inSubject } from '../reconcile.mjs';
import { A, B, C, D, E, GENESIS, REPO, SOURCE_ONLY, boot, boot2, comment, commit, done, refused, test, w2 } from './helpers.mjs';

const add = (r, e) => appendEvent(r.eventsText, e, { expectHead: r.state?.ledgerHead ?? GENESIS });
const build = (...events) => events.reduce(add, { eventsText: '', state: null });
const WORK = { terminal: 'VERIFIED', proofType: 'journey-activation' };

test('a v2 bootstrap reduces to a schema-2 state; contracts are pinned in id order', () => {
  const r = build(boot2({ contracts: [{ id: 'writer', path: 'tools/wsf-control', commit: A }, { id: 'control-state', path: 'docs/c.md', commit: B }] }));
  assert.equal(r.state.schemaVersion, 2);
  assert.deepEqual(r.state.contracts.map((c) => c.id), ['control-state', 'writer']);
  assert.deepEqual(invariants(r.state), []);
});

test('an unknown schema version fails closed, before anything else is read; an explicit schema:1 is not a v1 line', () => {
  refused(() => build({ ...boot2(), schema: 3 }), /unknown schema version 3.*fail closed/);
  refused(() => build({ ...boot2(), schema: 1 }), /unknown schema version 1/);
});

test('a checker fails closed on a state whose schemaVersion it does not know', () => {
  const r = build(boot2());
  assert.match(invariants({ ...r.state, schemaVersion: 7 })[0], /not one this reader knows.*fail closed/);
});

test('only the App writes a v2 line; a Fable or L0 actor is refused', () => {
  refused(() => build({ ...boot2(), actor: 'Fable' }), /is not the v2 ledger writer/);
});

test('a v2 line needs an authority block naming a real rule of the right class that derives this type', () => {
  const b = boot2();
  refused(() => build({ ...b, authority: undefined }), /authority must be/);
  refused(() => build({ ...b, authority: { ...b.authority, rule: 'R-INVENTED' } }), /not a named rule/);
  refused(() => build({ ...b, authority: { ...b.authority, class: 'derived' } }), /is of class manual/);
  const r = build(b, w2('queue', { packet: 'ALPHA', owner: 'W3', completion: WORK }));
  refused(() => add(r, w2('reconcile-head', { packet: 'ALPHA', prHeadSha: C }, { rule: 'R-RECORD-EVIDENCE', cls: 'derived', source: commit(C) })), /does not derive a reconcile-head/);
  refused(() => add(r, { ...w2('queue', { packet: 'GAMMA', owner: 'W7', completion: WORK }), authority: { class: 'manual', rule: 'MANUAL', evidence: [] } }), /evidence must be 1–10/);
});

test('versions never mix: a v1 line in a v2 ledger and a v2 line in a v1 ledger are refused', () => {
  const r2 = build(boot2());
  refused(() => add(r2, { type: 'queue', actor: 'Fable', source: comment(77), packet: 'ALPHA', owner: 'W3', completion: WORK }), /schema 1 line in a schema 2 ledger/);
  const r1 = build(boot());
  refused(() => add(r1, w2('queue', { packet: 'ALPHA', owner: 'W3', completion: WORK })), /schema 2 line in a schema 1 ledger/);
});

test('schema-upgrade moves a v1 ledger to v2 once; afterwards v1 lines are refused and packets carry the v2 fields', () => {
  let r = build(boot(), { type: 'queue', actor: 'Fable', source: comment(90), packet: 'ALPHA', owner: 'W3', completion: WORK });
  r = add(r, w2('schema-upgrade', { to: 2 }));
  assert.equal(r.state.schemaVersion, 2);
  assert.equal(r.state.packets.ALPHA.deliveries, 0);
  refused(() => add(r, { type: 'queue', actor: 'Fable', source: comment(91), packet: 'BETA', owner: 'W7', completion: WORK }), /schema 1 line in a schema 2 ledger/);
  refused(() => add(r, w2('schema-upgrade', { to: 2 })), /already schema 2/);
});

test('a v2-only event or field on a v1 line is malformed', () => {
  const r = build(boot());
  refused(() => add(r, { type: 'set-contracts', actor: 'Fable', source: comment(92), contracts: [{ id: 'x1', path: 'a', commit: A }] }), /schema v2 event/);
  refused(() => add(r, { type: 'queue', actor: 'Fable', source: comment(93), packet: 'ALPHA', owner: 'W3', completion: WORK, review: DEFAULT_REVIEW }), /review is a schema v2 field/);
});

test('v1 identities are unchanged byte for byte; a v2 identity also names the rule', () => {
  const e = { type: 'queue', actor: 'Fable', source: comment(95), packet: 'ALPHA', owner: 'W3', completion: WORK };
  assert.equal(eventId(e), sha256(canon({ v: 1, type: 'queue', subject: 'ALPHA', source: { kind: 'comment', id: 95, repo: REPO } })));
  const f = w2('reconcile-head', { packet: 'ALPHA', prHeadSha: C }, { rule: 'R-RECONCILE-HEAD', cls: 'derived', source: commit(C) });
  const g = { ...f, authority: { ...f.authority, rule: 'MANUAL', class: 'manual' } };
  assert.notEqual(eventId(f), eventId(g));
});

// ---- review policy (memo §7) -------------------------------------------------------------------------
function delivered(policy) {
  return build(boot2(), w2('queue', { packet: 'ALPHA', owner: 'W3', completion: WORK, ...(policy ? { review: policy } : {}) }),
    w2('release', { packet: 'ALPHA', inbox: 396 }), w2('ack', { packet: 'ALPHA', worker: 'W3' }), w2('deliver', { packet: 'ALPHA', pr: 12, subjectSha: A }));
}

test('a work packet without a policy gets the fail-closed default (one ops-source, then the Director); a reference gets none', () => {
  const r = build(boot2(), w2('queue', { packet: 'ALPHA', owner: 'W3', completion: WORK }), w2('queue', { packet: 'REF-1', owner: 'W7', kind: 'reference', completion: SOURCE_ONLY }));
  assert.deepEqual(r.state.packets.ALPHA.review, DEFAULT_REVIEW);
  assert.equal(r.state.packets['REF-1'].review, null);
});

test('a required W# review is never skipped by a direct accept, and accept needs every required pass', () => {
  const r = delivered();
  refused(() => add(r, w2('accept', { packet: 'ALPHA', subjectSha: A })), /requires 1 W# pass\(es\); 0 recorded/);
  const r2 = add(add(r, w2('review', { packet: 'ALPHA', reviewers: ['W7'] })), w2('review-pass', { packet: 'ALPHA', reviewer: 'W7' }));
  assert.equal(add(r2, w2('accept', { packet: 'ALPHA', subjectSha: A })).state.packets.ALPHA.phase, 'ACCEPTED');
  const director = add(delivered(), w2('review', { packet: 'ALPHA', reviewers: ['Director'] }));
  refused(() => add(director, w2('accept', { packet: 'ALPHA', subjectSha: A })), /requires 1 W# pass/);
});

test('a policy with no worker review lets the Director accept directly; set-review-policy is a recorded decision', () => {
  const none = { workerReviews: [], appliesTo: 'docs', after: 'director' };
  assert.equal(add(delivered(none), w2('accept', { packet: 'ALPHA', subjectSha: A })).state.packets.ALPHA.phase, 'ACCEPTED');
  const r = add(delivered(), w2('set-review-policy', { packet: 'ALPHA', review: none }));
  assert.deepEqual(r.state.packets.ALPHA.review, none);
  assert.equal(add(r, w2('accept', { packet: 'ALPHA', subjectSha: A })).state.packets.ALPHA.phase, 'ACCEPTED');
});

test('a reviewer that declares classes must hold one the policy requires', () => {
  const r0 = build(boot2({ workers: { W3: { inbox: 396 }, W7: { inbox: 400, classes: ['journey-qa'] }, W5: { inbox: 395, classes: ['ops-source'] } }, queue: { W3: [], W7: [], W5: [] } }),
    w2('queue', { packet: 'ALPHA', owner: 'W3', completion: WORK }), w2('release', { packet: 'ALPHA', inbox: 396 }), w2('ack', { packet: 'ALPHA', worker: 'W3' }), w2('deliver', { packet: 'ALPHA', pr: 12, subjectSha: A }));
  refused(() => add(r0, w2('review', { packet: 'ALPHA', reviewers: ['W7'] })), /none of the classes/);
  assert.equal(add(r0, w2('review', { packet: 'ALPHA', reviewers: ['W5'] })).state.packets.ALPHA.phase, 'UNDER_REVIEW');
});

test('a v2 register-worker re-declares a registered worker\'s classes at the same inbox; its queue and reviews are kept; a v1 one, an inbox move and a no-op are refused', () => {
  const r0 = build(boot2({ workers: { W3: { inbox: 396 }, W7: { inbox: 400 } }, queue: { W3: [], W7: [] } }),
    w2('queue', { packet: 'ALPHA', owner: 'W3', completion: WORK }), w2('queue', { packet: 'BETA', owner: 'W7', completion: WORK }),
    w2('release', { packet: 'ALPHA', inbox: 396 }), w2('ack', { packet: 'ALPHA', worker: 'W3' }), w2('deliver', { packet: 'ALPHA', pr: 12, subjectSha: A }),
    w2('review', { packet: 'ALPHA', reviewers: ['W7'] }));
  const r1 = add(r0, w2('register-worker', { worker: 'W7', inbox: 400, classes: ['journey-qa'] }));
  assert.deepEqual(r1.state.workers.W7, { inbox: 400, classes: ['journey-qa'] });
  assert.deepEqual(r1.state.queue.W7, ['BETA'], 'the queue survives');
  assert.deepEqual(r1.state.packets.ALPHA.reviewers, ['W7'], 'a review already assigned is kept; classes gate only the next assignment');
  assert.deepEqual(invariants(r1.state), []);
  assert.deepEqual(add(r1, w2('register-worker', { worker: 'W7', inbox: 400, classes: ['ops-source'] })).state.workers.W7.classes, ['ops-source'], 'a same-size different set is a change');
  const r2 = add(r1, w2('register-worker', { worker: 'W7', inbox: 400 }));
  assert.deepEqual(r2.state.workers.W7, { inbox: 400 }, 'undeclared again: eligible for any class');
  refused(() => add(r1, w2('register-worker', { worker: 'W7', inbox: 434, classes: ['ops-source'] })), /keeps the inbox \(#434 refused\)/);
  refused(() => add(r1, w2('register-worker', { worker: 'W7', inbox: 400, classes: ['journey-qa'] })), /already declares journey-qa/);
  refused(() => add(r2, w2('register-worker', { worker: 'W7', inbox: 400 })), /already declares no classes/);
  refused(() => add(build(boot()), { type: 'register-worker', actor: 'Fable', source: comment(5), worker: 'W3', inbox: 396 }), /already registered/);
});

// ---- R-PREEMPT and DELIVERED-SUCCESSOR (memo §8) -----------------------------------------------------
/** ALPHA delivered and under W7's review; W3's BETA is released. */
function alphaBeta() {
  return build(boot2(),
    w2('queue', { packet: 'ALPHA', owner: 'W3', completion: WORK }), w2('release', { packet: 'ALPHA', inbox: 396 }), w2('ack', { packet: 'ALPHA', worker: 'W3' }),
    w2('deliver', { packet: 'ALPHA', pr: 12, subjectSha: A }), w2('review', { packet: 'ALPHA', reviewers: ['W7'] }),
    w2('queue', { packet: 'BETA', owner: 'W3', completion: WORK }), w2('release', { packet: 'BETA', inbox: 396 }));
}
const needed = (r) => neededTransitions(r.state).filter((n) => ['apply-finding', 'retract-release', 'block'].includes(n.event)).map((n) => `${n.packet}:${n.event}`);

test('a pending finding records the verdict without moving the ball; a second one, a delivery or an acceptance is refused', () => {
  const r = add(alphaBeta(), w2('finding', { packet: 'ALPHA', pending: true }));
  assert.equal(r.state.packets.ALPHA.phase, 'UNDER_REVIEW');
  assert.ok(r.state.packets.ALPHA.pendingFinding);
  refused(() => add(r, w2('finding', { packet: 'ALPHA', pending: true })), /already has a pending finding/);
  refused(() => add(r, w2('deliver', { packet: 'ALPHA', pr: 12, subjectSha: B })), /pending finding/);
});

test('R-PREEMPT, BETA RELEASED and not ACKed: retract BETA, then apply the finding', () => {
  let r = add(alphaBeta(), w2('finding', { packet: 'ALPHA', pending: true }));
  assert.deepEqual(needed(r), ['BETA:retract-release']);
  r = add(r, w2('retract-release', { packet: 'BETA' }));
  assert.deepEqual(needed(r), ['ALPHA:apply-finding']);
  r = add(r, w2('apply-finding', { packet: 'ALPHA' }));
  assert.equal(r.state.packets.ALPHA.phase, 'CHANGES_REQUESTED');
  assert.equal(r.state.packets.BETA.phase, 'QUEUED');
});

for (const betaPhase of ['ACKED', 'CHANGES_REQUESTED']) {
  test(`R-PREEMPT, BETA ${betaPhase}: block BETA on ALPHA≥DELIVERED-SUCCESSOR (work kept), apply, and BETA resumes only after ALPHA redelivers`, () => {
    let r = add(alphaBeta(), w2('ack', { packet: 'BETA', worker: 'W3' }));
    if (betaPhase === 'CHANGES_REQUESTED') {
      // BETA delivered and got a finding of its own before ALPHA's arrived: it is W3's ball again.
      r = add(r, w2('deliver', { packet: 'BETA', pr: 13, subjectSha: C }));
      r = add(r, w2('finding', { packet: 'BETA' }));
    }
    r = add(r, w2('finding', { packet: 'ALPHA', pending: true }));
    refused(() => add(r, w2('apply-finding', { packet: 'ALPHA' })), /holds 2/);
    assert.deepEqual(needed(r), ['BETA:block']);
    r = add(r, w2('block', { packet: 'BETA', blockedBy: [{ packet: 'ALPHA', until: 'DELIVERED-SUCCESSOR' }] }));
    assert.equal(r.state.packets.BETA.phaseBeforeBlock, betaPhase);
    assert.equal(r.state.packets.BETA.blockedBy[0].since, 1);
    assert.equal(r.state.packets.ALPHA.phase, 'UNDER_REVIEW');
    assert.equal(blockerCleared(r.state, r.state.packets.BETA.blockedBy[0]), false, 'the delivery BETA waits past is not its successor');
    r = add(r, w2('apply-finding', { packet: 'ALPHA' }));
    assert.equal(r.state.packets.ALPHA.phase, 'CHANGES_REQUESTED');
    assert.equal(blockerCleared(r.state, r.state.packets.BETA.blockedBy[0]), false, 'ALPHA has not redelivered');
    r = add(r, w2('deliver', { packet: 'ALPHA', pr: 12, subjectSha: D }));
    assert.equal(blockerCleared(r.state, r.state.packets.BETA.blockedBy[0]), true);
    const unblock = neededTransitions(r.state).find((n) => n.packet === 'BETA' && n.event === 'unblock');
    assert.equal(unblock.reactivates, 'W3');
    r = add(r, w2('unblock', { packet: 'BETA' }));
    assert.equal(r.state.packets.BETA.phase, betaPhase);
  });
}

test('R-PREEMPT, BETA itself BLOCKED or DELIVERED: the owner holds no other ball, so the finding applies at once', () => {
  for (const setup of [
    (r) => add(add(r, w2('ack', { packet: 'BETA', worker: 'W3' })), w2('block', { packet: 'BETA', blockedBy: [{ external: 'OWNER-X', condition: 'owner decision', owner: 'Owner', unblockWhen: 'decided' }] })),
    (r) => add(add(r, w2('ack', { packet: 'BETA', worker: 'W3' })), w2('deliver', { packet: 'BETA', pr: 13, subjectSha: C })),
  ]) {
    let r = add(setup(alphaBeta()), w2('finding', { packet: 'ALPHA', pending: true }));
    assert.deepEqual(needed(r), ['ALPHA:apply-finding']);
    r = add(r, w2('apply-finding', { packet: 'ALPHA' }));
    assert.equal(r.state.packets.ALPHA.phase, 'CHANGES_REQUESTED');
  }
});

test('DELIVERED-SUCCESSOR is a v2 milestone and never waits on a reference packet', () => {
  const r1 = build(boot(), { type: 'queue', actor: 'Fable', source: comment(96), packet: 'ALPHA', owner: 'W3', completion: WORK });
  refused(() => add(r1, { type: 'block', actor: 'Fable', source: comment(97), packet: 'ALPHA', blockedBy: [{ packet: 'ALPHA', until: 'DELIVERED-SUCCESSOR' }] }), /schema v2 milestone/);
  const r2 = build(boot2(), w2('queue', { packet: 'REF-1', owner: 'W7', kind: 'reference', completion: SOURCE_ONLY }), w2('queue', { packet: 'ALPHA', owner: 'W3', completion: WORK }));
  refused(() => add(r2, w2('block', { packet: 'ALPHA', blockedBy: [{ packet: 'REF-1', until: 'DELIVERED-SUCCESSOR' }] })), /reference packet and is never delivered/);
});

// ---- contracts, shadow surface, manual decisions, rendering -----------------------------------------
test('set-contracts replaces the pins; the shadow surface is never the human CURRENT comment', () => {
  let r = add(build(boot2()), w2('set-contracts', { contracts: [{ id: 'writer', path: 'tools/wsf-control', commit: E }] }));
  assert.equal(r.state.contracts[0].commit, E);
  refused(() => add(r, w2('set-shadow-surface', { pr: 365, commentId: 9001 }, { rule: 'R-SHADOW-SURFACE', cls: 'derived', source: comment(9001) })), /never the human CURRENT/);
  refused(() => add(r, w2('set-shadow-surface', { pr: 396, commentId: 42 }, { rule: 'R-SHADOW-SURFACE', cls: 'derived', source: comment(42) })), /control surface #365/);
  r = add(r, w2('set-shadow-surface', { pr: 365, commentId: 42 }, { rule: 'R-SHADOW-SURFACE', cls: 'derived', source: comment(42) }));
  assert.deepEqual(r.state.surfaces.shadow, { pr: 365, commentId: 42 });
});

test('a v2 MANUAL decision rests on its decision comment whatever its type; a derived integrate still needs the merge', () => {
  let r = add(add(add(delivered({ workerReviews: [], appliesTo: 'subject', after: 'director' }), w2('accept', { packet: 'ALPHA', subjectSha: A })), w2('record-evidence', { packet: 'ALPHA', evidenceSha: B })), w2('reconcile-head', { packet: 'ALPHA', prHeadSha: B }));
  const acc = r.state.packets.ALPHA.authority.accepted.id;
  refused(() => add(r, w2('integrate', { packet: 'ALPHA', mergeSha: C, acceptance: acc }, { rule: 'R-INTEGRATE', cls: 'derived', source: comment(98) })), /must rest on a pull_request or commit/);
  r = add(r, w2('integrate', { packet: 'ALPHA', mergeSha: C, acceptance: acc }));
  assert.equal(r.state.packets.ALPHA.phase, 'INTEGRATED');
});

test('a v2 rendering names the schema, the pins, the shadow surface and the three accepted residuals', () => {
  const r = add(build(boot2({ contracts: [{ id: 'writer', path: 'tools/wsf-control', commit: A }] })), w2('set-shadow-surface', { pr: 365, commentId: 42 }, { rule: 'R-SHADOW-SURFACE', cls: 'derived', source: comment(42) }));
  const text = renderCurrent(r.state);
  assert.match(text, /Schema: v2/);
  assert.match(text, /writer@aaaaaaaa/);
  assert.match(text, /SHADOW CURRENT\.\*\* This rendering is comment 42 on #365\. The human CURRENT \(comment 9001\) stays authoritative/);
  for (const x of ACCEPTED_RESIDUALS) assert.ok(text.includes(x));
  assert.equal(serialize(reduce(r.eventsText)), r.stateText, 'state.json is exactly the reduction');
});

// ---- CONTROL-EXPO-ROUTE-PATH-GRAMMAR (#365 5944949756; release 5944968693) ---------------------------------------------

/** The exact Expo Router files KIOSK-PAIRING-CLARITY-PROOF-1 reserves (#365 5944922457), which the old alphabet refused. */
const EXPO_ROUTES = ['apps/westayfit/app/station/[goalId].tsx', 'apps/westayfit/app/(tabs)/(home)/community/[groupId]/index.tsx'];

test('Expo Router paths: a queue reserves the exact route files with literal ( ) [ ]; they are stored as written', () => {
  const r = add(build(boot2()), w2('queue', { packet: 'ALPHA', owner: 'W3', completion: WORK, subjectPaths: [...EXPO_ROUTES, 'apps/westayfit/tests-e2e/station-enrollment.spec.ts'] }));
  assert.deepEqual(r.state.packets.ALPHA.subjectPaths, [...EXPO_ROUTES, 'apps/westayfit/tests-e2e/station-enrollment.spec.ts']);
  for (const p of [...EXPO_ROUTES, 'apps/westayfit/app/[...rest].tsx', 'apps/westayfit/app/(auth)/_layout.tsx']) assert.ok(RE.path.test(p), p);
  assert.equal(add(build(boot2()), w2('queue', { packet: 'ALPHA', owner: 'W3', completion: WORK, subjectPaths: ['*'] })).state.packets.ALPHA.subjectPaths[0], '*');
});

test('Expo Router paths: nothing else is widened; * stays the whole-field sentinel; ambiguity outside ( ) [ ] is still refused', () => {
  const bad = [
    '', 'apps/*', '*/x', 'a*b', '**', '* ', ' *', 'apps/west ayfit/x.tsx', 'apps/x.tsx ', '\tapps/x', 'apps\\x.tsx', 'apps/x?.tsx', 'apps/x.tsx?q=1',
    'apps/x.tsx#frag', 'apps/%5BgoalId%5D.tsx', 'apps/{a,b}.tsx', 'apps/{x}.tsx', 'apps/x}', 'apps/<x>.tsx', 'apps/x!.tsx', 'apps/x+y.tsx', 'apps/~x', 'apps/x:y', 'apps/x;y',
    'apps/x|y', 'apps/x&y', 'apps/$x', "apps/x'y", 'apps/x"y', 'apps/x`y', 'apps/x,y', 'apps/x=y', 'apps/x@y', 'apps/é.tsx', 'apps/x\ny', 'apps/x\u0000',
    `a${'b'.repeat(160)}`, 'https://example.org/x',
  ];
  for (const p of bad) {
    assert.equal(RE.path.test(p), false, `${JSON.stringify(p)} must stay malformed`);
    refused(() => add(build(boot2()), w2('queue', { packet: 'ALPHA', owner: 'W3', completion: WORK, subjectPaths: [p] })), /subjectPaths is malformed|forbidden|malformed/);
  }
  assert.ok(RE.path.test('a'.repeat(160)) && !RE.path.test('a'.repeat(161)), 'the length bound is unchanged');
  refused(() => add(build(boot2()), w2('queue', { packet: 'ALPHA', owner: 'W3', completion: WORK, subjectPaths: [] })), /subjectPaths is malformed/);
});

test('Expo Router paths: a contract pin keeps the old alphabet (its path is a git pathspec, where [ ] would glob)', () => {
  assert.ok(RE.contractPath.test('tools/wsf-control') && RE.contractPath.test('docs/westayfit/ops/CONTROL_STATE.md'));
  for (const p of [...EXPO_ROUTES, 'docs/[x].md', 'docs/(x).md', '*']) {
    assert.equal(RE.contractPath.test(p), false, p);
    refused(() => add(build(boot2()), w2('set-contracts', { contracts: [{ id: 'writer', path: p, commit: E }] })), /contracts is malformed|malformed/);
  }
});

test('Expo Router paths: a reservation matches literally (never as a glob) when a delivery\'s changed files are checked', () => {
  const [station, home] = EXPO_ROUTES;
  assert.equal(inSubject(station, EXPO_ROUTES), true);
  assert.equal(inSubject(home, EXPO_ROUTES), true);
  for (const sibling of ['apps/westayfit/app/station/g.tsx', 'apps/westayfit/app/station/goalId.tsx', 'apps/westayfit/app/station/[groupId].tsx',
    'apps/westayfit/app/tabs/home/community/[groupId]/index.tsx', 'apps/westayfit/app/(tabs)/(home)/community/x/index.tsx']) {
    assert.equal(inSubject(sibling, EXPO_ROUTES), false, sibling);
  }
  assert.equal(inSubject('apps/westayfit/app/(tabs)/(home)/community/[groupId]/members.tsx', ['apps/westayfit/app/(tabs)/(home)/community/[groupId]']), true, 'a directory reservation still covers its own files');
});

done('v2');
