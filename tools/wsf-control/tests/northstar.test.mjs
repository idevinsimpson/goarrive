/**
 * NORTHSTAR-MIRROR-INTAKE-1: the #578 receiver, offline. The fail-closed v1 parser (the producer's real shapes as
 * fixtures), the desired-revision reducer (newest only, coalescing), the one derived mirror packet (queue + release when
 * W9 is free, its frozen target, then one release wake), mirroredThrough moving only on integration, the derived-rule
 * guards in the reducer, and the #578 comment trigger boundary.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { appendEvent, Refused } from '../append.mjs';
import { reduce } from '../reduce.mjs';
import { balls, desiredLine, line, mirrorLines, wakeLines } from '../router.mjs';
import { FEED_AUTHOR, MIRROR_REVIEW, mirrorPacketId, mirrorPlan, northstarStatus, parseDelta } from '../northstar.mjs';
import { REPO, boot2, done, sha, test, w2 } from './helpers.mjs';

const S1 = 'b84a4689c671681946a75b34334e44fa8a88af31';
const S2 = '3c84c93c321136a0abca5811e9cf4371b63efdc7';
const S3 = '8457358e92c613eea9bd0a43a701c2d58bebd5af';
const T = '2026-10-07T01:43:55Z';

/** A v1 delta body as the bridge writes it (#578 6029083187 shape); `over` replaces whole lines by key. */
function body({ from = 'c3a071b577d845072e1fa276c2d13c5e2f0af8db', to = S2, mirror = 'true', native = 'true', routes = ['/review/north-star/home-active', '/review/north-star'], notes = ['AI first-step stays owner-test only and web-first.'], extra = [] } = {}) {
  return [
    'NORTHSTAR_DELTA', `northstar_from: ${from}`, `northstar_to: ${to}`, `mirror: ${mirror}`, `native_relevant: ${native}`,
    'changed_journeys:', '  - first-run-tour', '  - shared-goal-link',
    'reference_routes:', ...routes.map((r) => `  - ${r}`),
    'viewports:', '  - 390x844', '  - 390x640',
    'summary:', "  - First-run tour v2: four steps built from the selected community's real goal.",
    'behavior_contract:', '  - Tour never interrupts MOVE/camera/confirmation and closes if MOVE opens.',
    'truth_invariants:', '  - Nothing counts before confirmation.',
    'native_scope_hint:', '  - Tour v2 content + account-scoped seen flag',
    'acceptance:', '  - functional', '  - truth', '  - visual', '  - reduced-motion',
    'notes:', ...notes.map((n) => `  - ${n}`),
    ...extra,
  ].join('\n');
}
let cid = 6029083000;
const delta = (b = body(), over = {}) => ({ id: (cid += 1), body: b, author: FEED_AUTHOR, association: 'OWNER', createdAt: T, updatedAt: T, ...over });

test('parser: the producer\'s v1 shape is accepted, with exact SHA and routes', () => {
  const c = delta();
  const r = parseDelta(c);
  assert.equal(r.ok, true);
  assert.deepEqual(r.delta, { commentId: c.id, sha: S2, from: 'c3a071b577d845072e1fa276c2d13c5e2f0af8db', routes: ['/review/north-star/home-active', '/review/north-star'] });
  assert.equal(parseDelta(delta(body({ from: 'none' }))).delta.from, null, 'a first revision');
  assert.equal(parseDelta(delta(`${body()}\n`)).ok, true, 'a trailing newline');
});

test('parser: valid deltas that never wake a product worker are skipped, with the reason', () => {
  const tooling = body({ native: 'false', routes: ['none'], notes: ['Bridge/tooling only; native router must not wake W9 for this revision.'] });
  assert.deepEqual([parseDelta(delta(tooling)).kind, parseDelta(delta(tooling)).reason], ['skipped', 'tooling-only (native_relevant: false)']);
  assert.equal(parseDelta(delta(body({ mirror: 'false' }))).reason, 'mirror: false');
  for (const n of ['experiment only', 'Do not mirror this one', 'hold native until Friday', 'prototype only']) {
    assert.equal(parseDelta(delta(body({ notes: [n] }))).reason, 'an explicit owner hold in notes', n);
  }
});

test('parser: refusals, one reason each (fail closed)', () => {
  const lines = body().split('\n');
  const swap = (i, j) => { const l = [...lines]; [l[i], l[j]] = [l[j], l[i]]; return l.join('\n'); };
  const cases = [
    [delta(body(), { author: 'external-user' }), /not posted by the owner/],
    [delta(body(), { association: 'COLLABORATOR' }), /not posted by the owner/],
    [delta(body(), { updatedAt: '2026-10-07T01:44:00Z' }), /edited/],
    [delta(body(), { createdAt: null, updatedAt: null }), /timestamps are missing/],
    [delta(body({ extra: ['surprise: yes'] })), /unknown key surprise/],
    [delta(body({ extra: ['notes:', '  - again'] })), /duplicate key notes/],
    [delta(swap(3, 4)), /out of order/],
    [delta(lines.filter((l) => !l.startsWith('mirror:')).join('\n')), /missing mirror/],
    [delta(body().replace('\n  - functional', '\n- functional')), /not a v1 key or list item/],
    [delta(body().replace('northstar_to:', 'northstar_to:  ')), /needs one inline value/],
    [delta(body().replace('viewports:', 'viewports: 390x844')), /viewports is a list/],
    [delta(body({ to: S2.slice(0, 39) })), /northstar_to is not an exact/],
    [delta(body({ to: S2.toUpperCase() })), /northstar_to is not an exact/],
    [delta(body({ from: 'abc' })), /northstar_from is neither/],
    [delta(body({ from: S2 })), /northstar_from equals northstar_to/],
    [delta(body({ mirror: 'yes' })), /mirror is neither true nor false/],
    [delta(body({ native: 'True' })), /native_relevant is neither/],
    [delta(body({ routes: ['none'] })), /names no reference route/],
    [delta(body({ routes: ['/review/north-star', 'none'] })), /mixes none/],
    [delta(body({ routes: ['/review/north-star', '/review/north-star'] })), /names an item twice/],
    [delta(body({ notes: ['x', 'x'] })), /^/], // duplicate free text is data, not refused: checked below
    [delta(body().replace('  - 390x640', '  - 390x844')), /viewports names an item twice/],
    [delta(body().replace('  - visual', '  - vibes')), /acceptance has a value outside v1/],
    [delta(body().replace('\r', '').replace('mirror: true', 'mirror: true\r')), /carriage return/],
  ];
  for (const [c, re] of cases.filter(([, re]) => String(re) !== '/^/')) {
    const r = parseDelta(c);
    assert.equal(r.ok, false, String(re));
    assert.equal(r.kind, 'refused', String(re));
    assert.match(r.reason, re);
  }
  assert.equal(parseDelta(delta(body({ notes: ['x', 'x'] }))).ok, true, 'notes are data; repeated prose is not a schema error');
  for (const r of ['/review/north-starx', '/review/north-star/', '/review/north-star/../admin', '/review/north-star//x', '/review/north-star/x?y=1',
    '/review/north-star/x#y', 'https://example.test/review/north-star', '/review/north-star/Home', '/review/other', ' /review/north-star', '/review/north-star/a b']) {
    const p = parseDelta(delta(body({ routes: [r] })));
    assert.equal(p.ok, false, r);
    assert.equal(p.kind, 'refused', r);
  }
});

test('parser: the bootstrap shape is not v1, and a non-delta comment (even a decision block) on #578 is ignored', () => {
  const boot = ['NORTHSTAR_DELTA', 'lovable_from: none', 'lovable_to: abc', 'status: completed'].join('\n');
  assert.equal(parseDelta(delta(boot)).kind, 'refused');
  const dec = '```wsf-control-decision\n{"type":"release","packet":"X","inbox":497}\n```';
  assert.equal(parseDelta(delta(dec)).kind, 'not-a-delta');
  assert.equal(parseDelta(delta('Looks good to me')).kind, 'not-a-delta');
  assert.equal(parseDelta(delta(body(), { author: 'external-user', body: dec })).kind, 'not-a-delta');
});

// ---- ledger: desired revision, coalescing, the derived mirror packet ----
const W = { W3: { inbox: 396, classes: ['ops-source'] }, W7: { inbox: 434, classes: ['journey-qa'] }, W9: { inbox: 497 } };
const Q = { W3: [], W7: [], W9: [] };
const start = () => appendEvent('', boot2({ workers: W, queue: Q }), { expectHead: '0'.repeat(64) });
const add = (r, e) => appendEvent(r.eventsText, e, { expectHead: r.state.ledgerHead });
const want = (r, e, re) => assert.throws(() => add(r, e), (err) => err instanceof Refused && re.test(err.message));
const dl = (r, id, s, routes = ['/review/north-star']) => desiredLine(r.state, { commentId: id, sha: s, routes });
/** Apply every line mirrorLines derives now. */
const mirror = (r) => mirrorLines(r.state).lines.reduce(add, r);

test('reducer: northstar-desired keeps only the newest revision; an older comment or the same SHA is refused', () => {
  let r = start();
  assert.equal(Object.hasOwn(r.state, 'northstar'), false, 'a ledger without the receiver is unchanged');
  r = add(r, dl(r, 6026116822, S1));
  assert.deepEqual(r.state.northstar, { desired: { sha: S1, routes: ['/review/north-star'], commentId: 6026116822 }, mirroredThrough: null });
  want(r, dl(r, 6026000000, S2), /is not newer than the desired revision's comment/);
  want(r, dl(r, 6029083187, S1), /already the desired revision/);
  const again = appendEvent(r.eventsText, dl(r, 6026116822, S1), { expectHead: r.state.ledgerHead });
  assert.equal(again.noop, true, 'the same feed comment re-derived is the same line');
  want(r, { ...dl(r, 6029083187, S2), routes: ['/review/north-star/'] }, /routes is missing or malformed/);
  want(r, { ...w2('northstar-desired', { sha: S2, routes: ['/review/north-star'] }), schema: undefined, authority: undefined, actor: 'Fable' }, /schema v2 event|actor|authority/);
});

test('the one mirror packet: W9 free → exactly one queue and one release, frozen target, then one release wake', () => {
  let r = start();
  r = add(r, dl(r, 6029083187, S2, ['/review/north-star/home-active', '/review/north-star']));
  const m = mirrorLines(r.state);
  assert.equal(m.lines.length, 2);
  assert.deepEqual(m.lines.map((l) => [l.type, l.authority.rule, l.source.id]), [['queue', 'R-NORTHSTAR-QUEUE', 6029083187], ['release', 'R-NORTHSTAR-RELEASE', 6029083187]]);
  r = mirror(r);
  const id = mirrorPacketId(S2);
  assert.equal(id, 'NORTHSTAR-MIRROR-3C84C93C');
  const p = r.state.packets[id];
  assert.equal(p.phase, 'RELEASED');
  assert.equal(p.owner, 'W9');
  assert.equal(p.inbox, 497);
  assert.deepEqual(p.northstar, { sha: S2, routes: ['/review/north-star/home-active', '/review/north-star'] });
  assert.deepEqual(p.review, MIRROR_REVIEW, 'one independent journey-qa review, then the Director');
  assert.deepEqual(p.completion, { terminal: 'INTEGRATED', proofType: 'source-only' });
  assert.equal(mirrorLines(r.state).lines.length, 0, 'idempotent: a re-run derives nothing more');
  const w = wakeLines(r.state, r.eventsText);
  assert.deepEqual(w.map((x) => [x.worker, x.packet, x.reason]), [['W9', id, 'release']], 'exactly one wake, to W9');
  assert.equal(balls(r.eventsText).filter((b) => b.worker === 'W9').length, 1);
  assert.match(northstarStatus(r.state), /desired=3c84c93c comment=6029083187 mirrored=unknown NORTHSTAR-MIRROR-3C84C93C is RELEASED on the desired revision/);
});

test('coalescing: newer revisions while a mirror is live never move it; after integration exactly one packet at the net newest', () => {
  let r = start();
  r = add(r, dl(r, 6026116822, S1));
  r = mirror(r);
  const first = mirrorPacketId(S1);
  const frozen = JSON.stringify(r.state.packets[first].northstar);
  r = add(r, w2('ack', { packet: first, worker: 'W9' }));
  r = add(r, dl(r, 6029083187, S2));
  r = add(r, dl(r, 6035672487, S3));
  assert.equal(r.state.northstar.desired.sha, S3, 'one pending target: the newest');
  assert.equal(JSON.stringify(r.state.packets[first].northstar), frozen, 'the ACTIVE target is byte-identical');
  assert.equal(mirrorLines(r.state).lines.length, 0, 'no second mirror while one is live');
  assert.equal(mirrorPlan(r.state).behind, first);
  assert.match(northstarStatus(r.state), /desired-behind active=NORTHSTAR-MIRROR-B84A4689@b84a4689/);
  // deliver → journey-qa review → pass → Director exact-head acceptance → integration
  r = add(r, w2('deliver', { packet: first, pr: 900, subjectSha: sha('a') }));
  assert.equal(r.state.northstar.mirroredThrough, null);
  r = add(r, w2('review', { packet: first, reviewers: ['W7'] }));
  r = add(r, w2('review-pass', { packet: first, reviewer: 'W7' }));
  const acc = w2('accept', { packet: first, subjectSha: sha('a') });
  r = add(r, acc);
  assert.equal(r.state.northstar.mirroredThrough, null, 'acceptance alone never advances mirroredThrough');
  r = add(r, w2('integrate', { packet: first, mergeSha: sha('b'), acceptance: acc.source.id }, { source: { kind: 'pull_request', id: 900, repo: REPO } }));
  assert.equal(r.state.northstar.mirroredThrough, S1, 'only to the packet\'s frozen SHA');
  const m = mirrorLines(r.state);
  assert.deepEqual(m.lines.map((l) => l.packet), [mirrorPacketId(S3), mirrorPacketId(S3)], 'the intermediate S2 is never queued');
  r = mirror(r);
  assert.equal(r.state.packets[mirrorPacketId(S2)], undefined);
  assert.equal(r.state.packets[mirrorPacketId(S3)].phase, 'RELEASED');
});

test('W9 busy, NEXT queued, or the revision already mirrored: nothing is derived', () => {
  let r = start();
  r = add(r, w2('queue', { packet: 'OTHER-1', owner: 'W9', completion: { terminal: 'INTEGRATED', proofType: 'source-only' } }));
  r = add(r, dl(r, 6029083187, S2));
  assert.match(mirrorPlan(r.state).wait, /W9's NEXT is OTHER-1/);
  r = add(r, w2('release', { packet: 'OTHER-1', inbox: 497 }));
  assert.match(mirrorPlan(r.state).wait, /W9 holds a ball \(OTHER-1\)/);
  assert.equal(mirrorLines(r.state).lines.length, 0);
  r = add(r, w2('withdraw', { packet: 'OTHER-1' }));
  assert.equal(mirrorLines(r.state).lines.length, 2, 'free again: eligible');
});

test('withdrawal of a mirror packet never advances mirroredThrough, and the same SHA is never re-queued', () => {
  let r = start();
  r = add(r, dl(r, 6029083187, S2));
  r = mirror(r);
  r = add(r, w2('withdraw', { packet: mirrorPacketId(S2) }));
  assert.equal(r.state.northstar.mirroredThrough, null);
  assert.match(mirrorPlan(r.state).wait, /already exists \(WITHDRAWN\)/);
  r = add(r, dl(r, 6035672487, S3));
  assert.equal(mirrorLines(r.state).lines.length, 2, 'a newer desired revision is a new packet');
});

test('a non-mirror packet\'s integration leaves mirroredThrough alone', () => {
  let r = start();
  r = add(r, dl(r, 6029083187, S2));
  r = add(r, w2('queue', { packet: 'PLAIN-1', owner: 'W3', completion: { terminal: 'INTEGRATED', proofType: 'source-only' }, review: { workerReviews: [], appliesTo: 'subject', after: 'director' } }));
  r = add(r, w2('release', { packet: 'PLAIN-1', inbox: 396 }));
  r = add(r, w2('deliver', { packet: 'PLAIN-1', pr: 901, subjectSha: sha('c') }));
  const acc = w2('accept', { packet: 'PLAIN-1', subjectSha: sha('c') });
  r = add(r, acc);
  r = add(r, w2('integrate', { packet: 'PLAIN-1', mergeSha: sha('d'), acceptance: acc.source.id }, { source: { kind: 'pull_request', id: 901, repo: REPO } }));
  assert.equal(r.state.northstar.mirroredThrough, null);
});

test('reducer guards: a derived queue or release that is not the plan is refused', () => {
  let r = start();
  r = add(r, dl(r, 6029083187, S2));
  const plan = mirrorPlan(r.state);
  const src = plan.source;
  const q = (fields) => line(r.state.repository, 'queue', { ...plan.queue, ...fields }, src, 'R-NORTHSTAR-QUEUE', [src]);
  want(r, q({ northstar: { sha: S3, routes: plan.queue.northstar.routes } }), /not the desired revision/);
  want(r, q({ northstar: { sha: S2, routes: ['/review/north-star/other'] } }), /not the desired revision/);
  want(r, q({ owner: 'W3' }), /derives only NORTHSTAR-MIRROR-3C84C93C for W9/);
  want(r, q({ packet: 'NORTHSTAR-MIRROR-XXXXXXXX' }), /derives only/);
  want(r, q({ review: { workerReviews: [{ class: 'ops-source', count: 1 }], appliesTo: 'subject', after: 'director' } }), /journey-qa review/);
  want(r, line(r.state.repository, 'queue', plan.queue, { kind: 'comment', id: 6029083188 }, 'R-NORTHSTAR-QUEUE', [{ kind: 'comment', id: 6029083188 }]), /rests on the desired revision's feed comment/);
  want(r, line(r.state.repository, 'queue', { packet: 'X-1', owner: 'W9', completion: { terminal: 'INTEGRATED', proofType: 'source-only' } }, src, 'R-NORTHSTAR-QUEUE', [src]), /queues only the desired North Star revision/);
  // A plain packet may not be released under the mirror rule.
  let p = add(r, w2('queue', { packet: 'PLAIN-2', owner: 'W3', completion: { terminal: 'INTEGRATED', proofType: 'source-only' } }));
  want(p, line(p.state.repository, 'release', { packet: 'PLAIN-2', inbox: 396 }, src, 'R-NORTHSTAR-RELEASE', [src]), /releases only a mirror packet/);
  // A second live mirror is refused even under MANUAL-free derivation.
  p = mirror(r);
  p = add(p, dl(p, 6035672487, S3));
  const q3 = { packet: mirrorPacketId(S3), owner: 'W9', completion: { terminal: 'INTEGRATED', proofType: 'source-only' }, kind: 'work', review: { ...MIRROR_REVIEW }, northstar: { sha: S3, routes: ['/review/north-star'] } };
  const s3 = { kind: 'comment', id: 6035672487 };
  want(p, line(p.state.repository, 'queue', q3, s3, 'R-NORTHSTAR-QUEUE', [s3]), /is a live mirror packet|must hold no ball/);
});

/** The reconcile job's `if`, evaluated for a context (same subset as shadow.test.mjs Check 71 F1). */
function jobIf(yml, ctx) {
  const job = yml.slice(yml.indexOf('\n  reconcile:\n'));
  const text = job.slice(job.indexOf('    if: >-') + '    if: >-'.length, job.indexOf('    runs-on:'));
  const expr = text.replace(/fromJSON\(/g, 'JSON.parse(').replace(/([!=])=/g, '$1==').replace(/\bgithub\.([A-Za-z_.]+)/g, (_, k) => `g(${JSON.stringify(k)})`);
  const g = (k) => k.split('.').reduce((o, x) => (o == null ? null : o[x] ?? null), ctx);
  return Boolean(new Function('g', 'contains', `return (${expr});`)(g, (a, v) => a.includes(v)));
}

test('trigger: an owner comment on #578 starts the writer; a non-owner, the bot, or a non-owner edit does not', () => {
  const y = fs.readFileSync(fileURLToPath(new URL('../../../.github/workflows/wsf-control-reconcile.yml', import.meta.url)), 'utf8');
  const ev = (login, association, { action = 'created', sender = login, issue = 578, ref = 'refs/heads/main' } = {}) => ({ ref, event_name: 'issue_comment', event: { action, sender: { login: sender }, issue: { number: issue }, comment: { user: { login }, author_association: association } } });
  assert.equal(jobIf(y, ev('idevinsimpson', 'OWNER')), true);
  for (const [login, assoc] of [['external-user', 'NONE'], ['idevinsimpson', 'COLLABORATOR'], ['wsf-control-writer[bot]', 'NONE']]) assert.equal(jobIf(y, ev(login, assoc)), false, `${login}/${assoc}`);
  assert.equal(jobIf(y, ev('idevinsimpson', 'OWNER', { action: 'edited', sender: 'external-user' })), false);
  assert.equal(jobIf(y, ev('idevinsimpson', 'OWNER', { ref: 'refs/pull/585/merge' })), false, 'main only');
  assert.equal(jobIf(y, ev('idevinsimpson', 'OWNER', { issue: 579 })), false, 'only the listed issues');
});

done('northstar');
