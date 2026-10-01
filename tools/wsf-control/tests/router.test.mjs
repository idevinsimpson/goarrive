/**
 * The Step-6 router (AUTONOMY-ROUTER-1C) end to end: the real writer against a REAL local bare repository standing in
 * for the protected ref, and a fake GitHub holding every worker inbox. Delivery → review routing → reviewer wake,
 * PASS and finding returning the ball, the lost-wake drill (retry → timeout → exception, packet kept), zero duplicate
 * wakes, adversarial reports (wrong inbox, stale or foreign wakeId, wrong subject, third-party or edited comment,
 * unverifiable delivery, owner self-review), routing capacity and eligibility, the writer re-pin, and the live
 * `wsf-control-state-2` ledger (fixture) staying valid and byte-stable under the new code. No network.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { formatReport, runShadow } from '../shadow-run.mjs';
import { reduce, serialize } from '../reduce.mjs';
import { checkTexts } from '../check.mjs';
import { renderCurrent } from '../render-current.mjs';
import { programView } from '../program-view.mjs';
import { workerView } from '../worker-view.mjs';
import { balls, integrateLines, progressionLine, wakeIdOf } from '../router.mjs';
import { postWakes, wakeMarker } from '../router-run.mjs';
import { workerBlock } from '../worker-intake.mjs';
import { INTAKE_TYPES } from '../shadow.mjs';
import { WAKE_EVENTS, eventId } from '../schema.mjs';
import { STATE_REF } from '../gitstate.mjs';
import * as appendMod from '../append.mjs';
import { A, B, C, D, atest as runAsync, done, sha, test } from './helpers.mjs';

const REPO = 'idevinsimpson/goarrive';
const BOT = 'wsf-control-writer[bot]';
const AUTHOR = { name: BOT, email: `1+${BOT}@users.noreply.github.com` };
const RUNNING = sha('9');
const ASOF = '2026-09-29T03:00:00Z';
const T0 = Date.parse('2026-09-29T04:00:00Z');
const REF = 'wsf-control-state';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-router-'));
const git = (...args) => { const r = spawnSync('git', args, { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };

/** W3 owns ALPHA, released to it; W4 is a security reviewer only; W7 is undeclared (eligible for any class). */
function input() {
  return {
    authorizedBy: 700,
    bootstrap: {
      repository: REPO, asOf: ASOF,
      surfaces: { controlInbox: { pr: 365 }, current: { pr: 365, commentId: 9001 } },
      canonical: { developmentBranch: 'claude/wsf-dev', developmentSha: A },
      workers: { W3: { inbox: 396 }, W4: { inbox: 394, classes: ['security'] }, W7: { inbox: 434 } },
      queue: { W3: [], W4: [], W7: [] },
      packets: { ALPHA: { owner: 'W3', completion: { terminal: 'INTEGRATED', proofType: 'source-only' }, phase: 'RELEASED', refs: [{ kind: 'comment', id: 700, repo: REPO }], releasedBy: 700, inbox: 396, label: 'router fixture' } },
    },
    contractPaths: [{ id: 'writer', path: 'tools/wsf-control' }, { id: 'writer-workflow', path: '.github/workflows/wsf-control-reconcile.yml' }],
  };
}

/** A fake GitHub: every inbox, one comment id sequence (ids only grow, as on GitHub), PRs, and a clock. */
function fakeGh() {
  const inboxes = new Map();
  const prs = new Map();
  let next = 800;
  const clock = { now: T0 };
  const calls = { created: [], edited: 0 };
  const iso = () => new Date(clock.now).toISOString().replace('.000Z', 'Z');
  const all = () => [...inboxes.values()].flat();
  const gh = {
    clock, calls, inboxes, prs,
    inbox: (n) => inboxes.get(n) ?? [],
    /** A comment by the repository owner's account, unedited unless told otherwise. */
    post(issue, body, over = {}) {
      next += 1;
      const c = { id: next, body, author: 'idevinsimpson', association: 'OWNER', createdAt: iso(), updatedAt: iso(), ...over };
      inboxes.set(issue, [...gh.inbox(issue), c]);
      return c;
    },
    async pull(n) { const p = prs.get(n); return p ? { merged: false, ...p } : null; },
    async descends(base, head) { const f = prs.get('descends'); return f ? f(base, head) : true; },
    async changedPaths() { return []; },
    async run() { return null; },
    async comment(id) { const c = all().find((x) => x.id === id); return c ? { id, body: c.body, author: c.author } : null; },
    async createComment(issue, body) {
      next += 1;
      inboxes.set(issue, [...gh.inbox(issue), { id: next, body, author: BOT, association: 'NONE', createdAt: iso(), updatedAt: iso() }]);
      calls.created.push({ issue, id: next });
      return { id: next };
    },
    async editComment(id, body) { all().find((x) => x.id === id).body = body; calls.edited += 1; },
  };
  return gh;
}
function bareRemote() { const d = tmp(); git('init', '-q', '--bare', path.join(d, 'r.git')); return path.join(d, 'r.git'); }
const events = (remote) => `${git('--git-dir', remote, 'show', `refs/heads/${REF}:events.jsonl`)}\n`;
const state = (remote) => reduce(events(remote));
const run = (remote, gh, over = {}) => runShadow({
  gh, remote, author: AUTHOR, runningSha: RUNNING, sameTree: () => true, bootstrapInput: input(), workdir: tmp(), ref: REF, botLogin: BOT,
  now: gh.clock.now, controlInboxComments: gh.inbox(365), readInbox: async (n) => gh.inbox(n), ...over,
});
const block = (o) => `W# report.\n\n\`\`\`wsf-control-worker\n${JSON.stringify(o)}\n\`\`\``;
const wakesOf = (s, worker) => Object.entries(s.wakes ?? {}).filter(([, w]) => w.worker === worker).map(([id, w]) => ({ id, ...w }));
const appCommentsIn = (gh, n) => gh.inbox(n).filter((c) => c.author === BOT);

/** Bootstrap, ACK and deliver: returns { remote, gh, w3Wake, reviewWake } with ALPHA UNDER_REVIEW by W7 at subject A. */
async function delivered() {
  const remote = bareRemote(); const gh = fakeGh();
  gh.prs.set(12, { state: 'open', headSha: A, baseSha: B });
  await run(remote, gh);
  const w3Wake = wakesOf(state(remote), 'W3')[0].id;
  gh.post(396, block({ type: 'ack', packet: 'ALPHA', wakeId: w3Wake }));
  await run(remote, gh);
  gh.post(396, block({ type: 'deliver', packet: 'ALPHA', wakeId: w3Wake, pr: 12, subjectSha: A }));
  await run(remote, gh);
  const reviewWake = wakesOf(state(remote), 'W7')[0].id;
  return { remote, gh, w3Wake, reviewWake };
}

const asyncTests = [];
const atest = (name, fn) => asyncTests.push([name, fn]);

atest('the first workflow: release wake → ACK → delivery → review routed to the free eligible reviewer → reviewer wake → PASS, with no manual handoff', async () => {
  const remote = bareRemote(); const gh = fakeGh();
  gh.prs.set(12, { state: 'open', headSha: A, baseSha: B });
  const r1 = await run(remote, gh);
  assert.equal(r1.outcome, 'written');
  assert.deepEqual(r1.appended, ['bootstrap:MANUAL:bootstrap', 'set-shadow-surface:R-SHADOW-SURFACE:shadow-comment-801', 'wake:R-WAKE:W3-release', 'wake-delivered:R-WAKE-DELIVERED:comment-802']);
  assert.deepEqual(state(remote).packets.ALPHA.authority.lastTransition, { kind: 'comment', id: 700 }, 'wake receipts never become a packet transition');
  const [w3] = wakesOf(state(remote), 'W3');
  assert.equal(w3.id, wakeIdOf({ head: reduce(events(remote).split('\n').slice(0, 1).join('\n') + '\n').ledgerHead, worker: 'W3', packet: 'ALPHA', phase: 'RELEASED' }), 'wakeId = sha256(head that set the ball, worker, packet, phase)');
  assert.ok(gh.inbox(396).find((c) => c.id === 802).body.startsWith(wakeMarker(w3.id, 1)), 'the wake comment is in W3\'s inbox and carries the marker');
  assert.match(gh.inbox(396).find((c) => c.id === 802).body, /First act: read `wsf-control-state-2`, run `check` and `worker-view W3`/);

  gh.post(396, block({ type: 'ack', packet: 'ALPHA', wakeId: w3.id }));
  const r2 = await run(remote, gh);
  assert.deepEqual(r2.appended, ['wake-ack:A-WAKE-ACK:W3-comment-803', 'ack:A-ACK:W3-comment-803']);
  assert.equal(state(remote).packets.ALPHA.phase, 'ACKED');

  gh.post(396, block({ type: 'deliver', packet: 'ALPHA', wakeId: w3.id, pr: 12, subjectSha: A }));
  const r3 = await run(remote, gh);
  assert.deepEqual(r3.appended, ['deliver:A-DELIVER:W3-comment-804', 'review:R-ROUTE-REVIEW:route-ALPHA', 'wake:R-WAKE:W7-review', 'wake-delivered:R-WAKE-DELIVERED:comment-805']);
  const s3 = state(remote);
  assert.deepEqual(s3.packets.ALPHA.reviewers, ['W7'], 'W4 declares only security; W7 is the first free eligible reviewer; never the owner');
  assert.equal(s3.packets.ALPHA.phase, 'UNDER_REVIEW');
  const deliver = events(remote).trimEnd().split('\n').map((l) => JSON.parse(l)).find((e) => e.type === 'deliver');
  assert.deepEqual(deliver.authority, { class: 'attested', rule: 'A-DELIVER', evidence: [{ kind: 'comment', id: 804 }, { kind: 'pull_request', id: 12 }, { kind: 'commit', id: A }] });
  const [w7] = wakesOf(s3, 'W7');
  assert.equal(w7.reason, 'review');
  assert.equal(appCommentsIn(gh, 434).length, 1, 'the reviewer wake is in W7\'s own inbox');
  assert.match(appCommentsIn(gh, 434)[0].body, new RegExp(`"type":"pass","packet":"ALPHA","wakeId":"${w7.id}","subjectSha":"${A}"`));
  assert.ok(workerView(s3, 'W7').includes('WATCH=on'));
  assert.ok(workerView(s3, 'W7').includes(`WAKE=${w7.id} packet=ALPHA reason=review status=delivered`));
  assert.ok(workerView(s3, 'W3').includes('WATCH=off'), 'the implementer waits: its WATCH is off');

  gh.post(434, block({ type: 'pass', packet: 'ALPHA', wakeId: w7.id, subjectSha: A }));
  const r4 = await run(remote, gh);
  assert.deepEqual(r4.appended, ['wake-ack:A-WAKE-ACK:W7-comment-806', 'review-pass:A-PASS:W7-comment-806']);
  const s4 = state(remote);
  assert.deepEqual(s4.packets.ALPHA.reviewedBy, ['W7']);
  assert.ok(workerView(s4, 'W7').includes('WATCH=off'), 'the PASS returns the ball: the reviewer holds nothing');
  assert.ok(programView(s4).some((l) => l.startsWith('AWAITING_ACCEPTANCE ALPHA')), 'acceptance stays the Director\'s');

  const r5 = await run(remote, gh);
  assert.equal(r5.outcome, 'unchanged'); assert.deepEqual(r5.appended, []); assert.deepEqual(r5.wakesPosted, []);
  assert.deepEqual(r5.intakeRefused, [], 'every accepted report re-read is a no-op, never a refusal');
  assert.equal(gh.calls.created.length, 3, 'shadow comment + two wakes: zero duplicates across five runs');
  assert.ok(checkTexts(events(remote), `${serialize(s4)}`).ok);
  assert.match(renderCurrent(s4), /\n## Wakes\n/);
});

atest('a finding hands the ball back: CHANGES_REQUESTED, a new handback wake for the owner, re-delivery re-routes with a new review wake', async () => {
  const { remote, gh, w3Wake, reviewWake } = await delivered();
  gh.post(434, block({ type: 'finding', packet: 'ALPHA', wakeId: reviewWake, subjectSha: A }));
  const r = await run(remote, gh);
  assert.deepEqual(r.appended.slice(0, 3), ['wake-ack:A-WAKE-ACK:W7-comment-806', 'finding:A-FINDING:W7-comment-806', 'wake:R-WAKE:W3-handback']);
  const s = state(remote);
  assert.equal(s.packets.ALPHA.phase, 'CHANGES_REQUESTED');
  const handback = wakesOf(s, 'W3').find((w) => w.reason === 'handback');
  assert.notEqual(handback.id, w3Wake, 'a new ball is a new wake');
  assert.ok(workerView(s, 'W3').includes('WATCH=on')); assert.ok(workerView(s, 'W7').includes('WATCH=off'));
  gh.prs.set(12, { state: 'open', headSha: C, baseSha: B });
  gh.post(396, block({ type: 'deliver', packet: 'ALPHA', wakeId: handback.id, pr: 12, subjectSha: C }));
  const r2 = await run(remote, gh);
  assert.ok(r2.appended.includes('review:R-ROUTE-REVIEW:route-ALPHA') && r2.appended.includes('wake:R-WAKE:W7-review'));
  const s2 = state(remote);
  assert.equal(s2.packets.ALPHA.artifact.subjectSha, C);
  const fresh = wakesOf(s2, 'W7').filter((w) => w.id !== reviewWake);
  assert.equal(fresh.length, 1, 'the second review is a second wake');
  // The reviewer's OLD assignment is stale: quoting it is refused, the new one passes.
  gh.post(434, block({ type: 'pass', packet: 'ALPHA', wakeId: reviewWake, subjectSha: C }));
  const r3 = await run(remote, gh);
  assert.match(r3.intakeRefused.at(-1).reason, /no longer W7's current ball \(stale assignment\)/);
  gh.post(434, block({ type: 'pass', packet: 'ALPHA', wakeId: fresh[0].id, subjectSha: C }));
  const r4 = await run(remote, gh);
  assert.ok(r4.appended.includes(`review-pass:A-PASS:W7-comment-${gh.inbox(434).at(-1).id}`));
});

atest('a finding while the owner holds another ball stays pending (the ball does not move), and is handed back once the owner is free', async () => {
  const { remote, gh, reviewWake } = await delivered();
  // W3 is given another ball: BETA queued and released to it by recorded decisions.
  const dec = (o) => `\`\`\`wsf-control-decision\n${JSON.stringify(o)}\n\`\`\``;
  gh.post(365, dec({ type: 'queue', packet: 'BETA', owner: 'W3', completion: { terminal: 'INTEGRATED', proofType: 'source-only' } }));
  gh.post(365, dec({ type: 'release', packet: 'BETA', inbox: 396 }));
  await run(remote, gh);
  assert.equal(state(remote).packets.BETA.phase, 'RELEASED');
  gh.post(434, block({ type: 'finding', packet: 'ALPHA', wakeId: reviewWake, subjectSha: A }));
  await run(remote, gh);
  const s = state(remote);
  assert.equal(s.packets.ALPHA.phase, 'UNDER_REVIEW', 'the owner holds BETA: the finding is recorded pending');
  assert.ok(s.packets.ALPHA.pendingFinding);
  assert.equal(progressionLine(s), null, 'no automatic preemption in this workflow: R-PREEMPT stays a Director step');
  assert.ok(programView(s).some((l) => /NEEDS_TRANSITION BETA event=retract-release/.test(l)), 'the view names the preempt step');
});

atest('the lost-wake drill: no ACK → one re-post at 15 min → timeout at 30 min → CONTROL_EXCEPTION wake-undelivered; the packet and its ball are kept; a late ACK resolves it', async () => {
  const { remote, gh, reviewWake } = await delivered();
  gh.clock.now += 14 * 60000 + 59000;
  assert.deepEqual((await run(remote, gh)).appended, [], 'not before 15 minutes');
  gh.clock.now += 1000;
  const r1 = await run(remote, gh);
  assert.deepEqual(r1.appended, ['wake-retry:R-WAKE-RETRY:wake-retry', `wake-delivered:R-WAKE-DELIVERED:comment-${appCommentsIn(gh, 434).at(-1).id}`]);
  assert.equal(appCommentsIn(gh, 434).length, 2);
  assert.ok(appCommentsIn(gh, 434)[1].body.startsWith(wakeMarker(reviewWake, 2)));
  gh.clock.now += 15 * 60000;
  const r2 = await run(remote, gh);
  assert.deepEqual(r2.appended, ['wake-timeout:R-WAKE-TIMEOUT:wake-timeout']);
  assert.deepEqual(r2.exceptions, [`wake-undelivered W7 ALPHA wake=${reviewWake.slice(0, 12)}`]);
  assert.ok(formatReport(r2).includes(`CONTROL_EXCEPTION wake-undelivered W7 ALPHA wake=${reviewWake.slice(0, 12)}`));
  const s = state(remote);
  assert.equal(s.packets.ALPHA.phase, 'UNDER_REVIEW', 'no lost packet'); assert.deepEqual(s.packets.ALPHA.reviewers, ['W7']);
  assert.ok(programView(s).includes(`CONTROL_EXCEPTION wake-undelivered W7 ALPHA wake=${reviewWake.slice(0, 12)}`));
  assert.ok(programView(s).includes('ACTIONABLE=on'));
  gh.clock.now += 60 * 60000;
  assert.deepEqual((await run(remote, gh)).appended, [], 'retries are bounded at one; nothing is posted after the timeout');
  assert.equal(appCommentsIn(gh, 434).length, 2);
  gh.post(434, block({ type: 'ack', packet: 'ALPHA', wakeId: reviewWake }));
  const r3 = await run(remote, gh);
  assert.deepEqual(r3.appended, [`wake-ack:A-WAKE-ACK:W7-comment-${gh.inbox(434).at(-1).id}`]);
  assert.deepEqual(r3.exceptions, []);
});

atest('adversarial reports are refused, reported, and never move a ball', async () => {
  const { remote, gh, w3Wake, reviewWake } = await delivered();
  const before = events(remote);
  const cases = [
    [396, { type: 'pass', packet: 'ALPHA', wakeId: reviewWake, subjectSha: A }, {}, /is W7's; a report counts only in that worker's inbox \(this is W3's\)/],
    [434, { type: 'pass', packet: 'ALPHA', wakeId: reviewWake, subjectSha: D }, {}, /names [0-9a-f]{8}, but the subject under review is/],
    [434, { type: 'pass', packet: 'ALPHA', wakeId: sha('e').padEnd(64, 'e'), subjectSha: A }, {}, /is not recorded/],
    [434, { type: 'pass', packet: 'ALPHA', wakeId: w3Wake, subjectSha: A }, {}, /is W3's; a report counts only in that worker's inbox/],
    [434, { type: 'pass', packet: 'ALPHA', wakeId: reviewWake, subjectSha: A }, { author: 'external-user', association: 'NONE' }, /not the repository owner/],
    [434, { type: 'pass', packet: 'ALPHA', wakeId: reviewWake, subjectSha: A }, { updatedAt: '2026-09-29T05:00:00Z' }, /^W7: edited-comment/],
    [434, { type: 'pass', packet: 'ALPHA', wakeId: reviewWake, subjectSha: A, extra: 1 }, {}, /refused extra/],
    [434, { type: 'accept', packet: 'ALPHA', wakeId: reviewWake }, {}, /"accept" is not a worker report/],
  ];
  for (const [inbox, o, over, re] of cases) {
    gh.post(inbox, block(o), over);
    const r = await run(remote, gh);
    assert.match(r.intakeRefused.find((x) => x.commentId === gh.inbox(inbox).at(-1).id)?.reason ?? 'none', re, JSON.stringify(o));
  }
  gh.post(434, `${block({ type: 'ack', packet: 'ALPHA', wakeId: reviewWake })}\n${block({ type: 'ack', packet: 'ALPHA', wakeId: reviewWake })}`);
  assert.match((await run(remote, gh)).intakeRefused.at(-1).reason, /2 wsf-control-worker blocks/);
  gh.post(434, 'I pass ALPHA, looks great.');
  const prose = await run(remote, gh);
  assert.equal(prose.intakeRefused.some((x) => x.commentId === gh.inbox(434).at(-1).id), false, 'prose is not a report');
  assert.equal(events(remote), before, 'no report moved the ledger');
  assert.deepEqual(state(remote).packets.ALPHA.reviewedBy, []);
});

atest('a report older than its wake comment is refused (ordering); a delivery the writer cannot verify is DELIVERY_UNVERIFIED and the ball stays', async () => {
  const remote = bareRemote(); const gh = fakeGh();
  const early = gh.post(396, 'placeholder');
  await run(remote, gh);
  const w3 = wakesOf(state(remote), 'W3')[0].id;
  early.body = block({ type: 'ack', packet: 'ALPHA', wakeId: w3 }); // an id smaller than the wake comment's
  assert.match((await run(remote, gh)).intakeRefused.at(-1).reason, /predates its wake comment/);
  gh.post(396, block({ type: 'ack', packet: 'ALPHA', wakeId: w3 }));
  await run(remote, gh);
  const bad = [
    [null, /PR #12 could not be read/],
    [{ state: 'closed', headSha: A, baseSha: B }, /PR #12 is closed, not open/],
    [{ state: 'open', headSha: C, baseSha: B }, /PR #12's head is [0-9a-f]{8}, not the named/],
  ];
  for (const [pr, re] of bad) {
    if (pr) gh.prs.set(12, pr); else gh.prs.delete(12);
    gh.post(396, block({ type: 'deliver', packet: 'ALPHA', wakeId: w3, pr: 12, subjectSha: A }));
    assert.match((await run(remote, gh)).intakeRefused.at(-1).reason, re);
  }
  gh.prs.set(12, { state: 'open', headSha: A, baseSha: B });
  gh.prs.set('descends', () => false);
  gh.post(396, block({ type: 'deliver', packet: 'ALPHA', wakeId: w3, pr: 12, subjectSha: A }));
  assert.match((await run(remote, gh)).intakeRefused.at(-1).reason, /does not descend from PR #12's base/);
  assert.equal(state(remote).packets.ALPHA.phase, 'ACKED', 'the ball stays with the worker');
  // A W# pass for its own packet: the owner's wake is not a review wake.
  gh.post(396, block({ type: 'pass', packet: 'ALPHA', wakeId: w3, subjectSha: A }));
  assert.match((await run(remote, gh)).intakeRefused.at(-1).reason, /a pass answers a review wake, not a release wake/);
});

atest('routing capacity and eligibility: no free eligible reviewer → AWAITING_REVIEWER and nothing written; the reviewer freed → routed', async () => {
  const remote = bareRemote(); const gh = fakeGh();
  gh.prs.set(12, { state: 'open', headSha: A, baseSha: B });
  const inp = input();
  inp.bootstrap.packets.GAMMA = { owner: 'W7', completion: { terminal: 'INTEGRATED', proofType: 'source-only' }, phase: 'RELEASED', refs: [{ kind: 'comment', id: 701, repo: REPO }], releasedBy: 701, inbox: 434 };
  await run(remote, gh, { bootstrapInput: inp });
  const s0 = state(remote);
  const w3 = wakesOf(s0, 'W3')[0].id;
  gh.post(396, block({ type: 'deliver', packet: 'ALPHA', wakeId: w3, pr: 12, subjectSha: A }));
  const r = await run(remote, gh, { bootstrapInput: inp });
  assert.ok(r.appended.includes('deliver:A-DELIVER:W3-comment-' + gh.inbox(396).at(-1).id));
  assert.equal(state(remote).packets.ALPHA.phase, 'DELIVERED', 'W7 holds GAMMA and W4 is not ops-source: nobody is free');
  assert.deepEqual(r.awaiting, ['ALPHA eligible=W7 (too few free ops-source reviewers)']);
  assert.ok(formatReport(r).includes('AWAITING_REVIEWER ALPHA eligible=W7 (too few free ops-source reviewers)'));
  // W7 delivers GAMMA: it no longer holds a ball, so ALPHA is routed to it (and GAMMA to nobody: W3 is ALPHA's owner, busy? no: W3 waits).
  const g = wakesOf(state(remote), 'W7')[0].id;
  gh.prs.set(13, { state: 'open', headSha: D, baseSha: B });
  gh.post(434, block({ type: 'deliver', packet: 'GAMMA', wakeId: g, pr: 13, subjectSha: D }));
  const r2 = await run(remote, gh, { bootstrapInput: inp });
  const s2 = state(remote);
  assert.deepEqual(s2.packets.ALPHA.reviewers, ['W7']);
  assert.deepEqual(s2.packets.GAMMA.reviewers, ['W3'], 'GAMMA goes to the next free eligible worker, never its owner W7');
  assert.equal(r2.appended.filter((x) => x.startsWith('wake:')).length, 2);
});

atest('delivery → QA without a manual handoff: the Director re-declares registered workers\' classes once, and every later delivery routes to the QA reviewer', async () => {
  const dec = (o) => `\`\`\`wsf-control-decision\n${JSON.stringify(o)}\n\`\`\``;
  const live = () => { const inp = input(); inp.bootstrap.workers.W4 = { inbox: 394 }; return inp; }; // the live shape: nobody declares classes
  // Without classes the default policy routes to the lowest free non-owner: W4, not QA.
  { const remote = bareRemote(); const gh = fakeGh();
    gh.prs.set(12, { state: 'open', headSha: A, baseSha: B });
    await run(remote, gh, { bootstrapInput: live() });
    gh.post(396, block({ type: 'deliver', packet: 'ALPHA', wakeId: wakesOf(state(remote), 'W3')[0].id, pr: 12, subjectSha: A }));
    await run(remote, gh, { bootstrapInput: live() });
    assert.deepEqual(state(remote).packets.ALPHA.reviewers, ['W4']); }
  const remote = bareRemote(); const gh = fakeGh();
  gh.prs.set(12, { state: 'open', headSha: A, baseSha: B });
  await run(remote, gh, { bootstrapInput: live() });
  gh.post(365, dec({ type: 'register-worker', worker: 'W4', inbox: 394, classes: ['security'] }));
  gh.post(365, dec({ type: 'register-worker', worker: 'W7', inbox: 434, classes: ['journey-qa', 'ops-source'] }));
  const r = await run(remote, gh, { bootstrapInput: live() });
  assert.deepEqual(r.appended.filter((x) => x.startsWith('register-worker:')), ['register-worker:MANUAL:comment-' + gh.inbox(365).at(-2).id, 'register-worker:MANUAL:comment-' + gh.inbox(365).at(-1).id]);
  const s = state(remote);
  assert.deepEqual(s.workers.W7, { inbox: 434, classes: ['journey-qa', 'ops-source'] });
  assert.equal(s.packets.ALPHA.phase, 'RELEASED', 'a re-registration moves no packet'); assert.deepEqual(s.queue.W7, []);
  assert.equal(wakesOf(s, 'W3').length, 1, 'and posts no new wake');
  // An inbox move and a no-op are refused, never recorded.
  const before = events(remote);
  gh.post(365, dec({ type: 'register-worker', worker: 'W7', inbox: 435, classes: ['ops-source'] }));
  gh.post(365, dec({ type: 'register-worker', worker: 'W7', inbox: 434, classes: ['ops-source', 'journey-qa'] }));
  const rr = await run(remote, gh, { bootstrapInput: live() });
  assert.equal(events(remote), before);
  assert.match(JSON.stringify(rr.refused), /keeps the inbox/); assert.match(JSON.stringify(rr.refused), /already declares journey-qa, ops-source/);
  gh.post(396, block({ type: 'deliver', packet: 'ALPHA', wakeId: wakesOf(state(remote), 'W3')[0].id, pr: 12, subjectSha: A }));
  await run(remote, gh, { bootstrapInput: live() });
  const s2 = state(remote);
  assert.deepEqual(s2.packets.ALPHA.reviewers, ['W7'], 'W4 now declares only security; W7 holds ops-source');
  assert.equal(appCommentsIn(gh, 434).length, 1, 'one QA wake'); assert.equal(appCommentsIn(gh, 394).length, 0, 'W4 is never woken');
});

/** ALPHA delivered at A on PR #12 and passed by W7: ACCEPTED once the Director's accept decision is read. */
async function passed() {
  const { remote, gh, reviewWake } = await delivered();
  gh.post(434, block({ type: 'pass', packet: 'ALPHA', wakeId: reviewWake, subjectSha: A }));
  await run(remote, gh);
  assert.equal(state(remote).packets.ALPHA.phase, 'UNDER_REVIEW');
  assert.deepEqual(state(remote).packets.ALPHA.reviewedBy, ['W7']);
  return { remote, gh };
}
const decide = (o) => `\`\`\`wsf-control-decision\n${JSON.stringify(o)}\n\`\`\``;
const MERGE = sha('5');

atest('R-INTEGRATE, same cycle: an acceptance read after the PR already merged is integrated in that same run, at the merge, once', async () => {
  const { remote, gh } = await passed();
  gh.prs.set(12, { state: 'closed', merged: true, headSha: A, baseSha: B, mergeSha: MERGE });
  gh.prs.set('descends', (base, head) => base === A && head === MERGE); // only "the merge descends from the accepted head"
  const acc = gh.post(365, decide({ type: 'accept', packet: 'ALPHA', subjectSha: A }));
  const r = await run(remote, gh);
  assert.deepEqual(r.appended, [`accept:MANUAL:comment-${acc.id}`, 'integrate:R-INTEGRATE:pr-12']);
  const s = state(remote);
  assert.equal(s.packets.ALPHA.phase, 'INTEGRATED'); assert.equal(s.packets.ALPHA.artifact.mergeSha, MERGE);
  const ln = JSON.parse(events(remote).trimEnd().split('\n').at(-1));
  assert.deepEqual(ln.authority, { class: 'derived', rule: 'R-INTEGRATE', evidence: [{ kind: 'pull_request', id: 12 }, { kind: 'commit', id: MERGE }, { kind: 'comment', id: acc.id }] });
  assert.deepEqual(ln.source, { kind: 'pull_request', id: 12, repo: REPO }); assert.equal(ln.acceptance, acc.id);
  // Idempotent: every later run, on any trigger, re-derives nothing.
  const before = events(remote);
  for (let i = 0; i < 3; i += 1) { const again = await run(remote, gh); assert.equal(again.outcome, 'unchanged'); assert.deepEqual(again.appended, []); }
  assert.equal(events(remote), before);
  assert.equal(appCommentsIn(gh, 396).length + appCommentsIn(gh, 434).length, 2, 'integration posts no wake');
});

atest('R-INTEGRATE, successor run: accepted while the PR is open stays ACCEPTED (nothing reported); the first run after the merge integrates it, once', async () => {
  const { remote, gh } = await passed();
  gh.post(365, decide({ type: 'accept', packet: 'ALPHA', subjectSha: A }));
  const r0 = await run(remote, gh);
  assert.equal(state(remote).packets.ALPHA.phase, 'ACCEPTED');
  assert.equal(r0.appended.some((x) => x.startsWith('integrate:')), false);
  assert.deepEqual(r0.integrateUnverified, [], 'an open PR is not a problem, only not yet merged');
  gh.prs.set(12, { state: 'closed', merged: true, headSha: A, baseSha: B, mergeSha: MERGE });
  const r1 = await run(remote, gh);
  assert.deepEqual(r1.appended, ['integrate:R-INTEGRATE:pr-12']);
  assert.equal((await run(remote, gh)).outcome, 'unchanged');
});

atest('R-INTEGRATE fails closed: a merged head that is not the accepted head, a merge that does not contain it, an unreadable PR or compare, a merge with no commit: reported, never recorded', async () => {
  const cases = [
    [{ state: 'closed', merged: true, headSha: D, baseSha: B, mergeSha: MERGE }, null, /merged head [0-9a-f]{8} is not the accepted head/],
    [{ state: 'closed', merged: true, headSha: A, baseSha: B, mergeSha: MERGE }, () => false, /does not contain the accepted head/],
    [{ state: 'closed', merged: true, headSha: A, baseSha: B, mergeSha: MERGE }, () => null, /could not be checked against the accepted head/],
    [undefined, null, /PR #12: could not be read/],
  ];
  for (const [pr, desc, re] of cases) {
    const { remote, gh } = await passed();
    gh.post(365, decide({ type: 'accept', packet: 'ALPHA', subjectSha: A }));
    if (pr) gh.prs.set(12, pr); else gh.prs.delete(12);
    if (desc) gh.prs.set('descends', desc);
    const r = await run(remote, gh);
    assert.equal(state(remote).packets.ALPHA.phase, 'ACCEPTED', String(re));
    assert.equal(r.appended.some((x) => x.startsWith('integrate:')), false, String(re));
    assert.match(r.integrateUnverified.join('\n'), re);
    assert.ok(formatReport(r).split('\n').some((l) => l.startsWith('INTEGRATE_UNVERIFIED ALPHA PR #12: ') && re.test(l)), String(re));
  }
});

test('integrateLines (pure): only ACCEPTED work packets with a comment acceptance; not merged → nothing; merged with no merge commit → reported', () => {
  const p = (phase, over = {}) => ({ kind: 'work', phase, pr: 12, artifact: { subjectSha: A, prHeadSha: A, mergeSha: null }, authority: { accepted: { kind: 'comment', id: 900 } }, ...over });
  const s = { repository: REPO, packets: { ALPHA: p('ACCEPTED'), BETA: p('UNDER_REVIEW'), GAMMA: p('ACCEPTED', { pr: null }), DELTA: p('ACCEPTED', { kind: 'reference' }) } };
  const ok = { merged: true, mergeSha: MERGE, headSha: A, contains: true };
  const all = { ALPHA: ok, BETA: ok, GAMMA: ok, DELTA: ok };
  assert.deepEqual(integrateLines(s, all).lines.map((l) => l.packet), ['ALPHA']);
  assert.deepEqual(integrateLines(s, { ALPHA: { ...ok, merged: false } }), { lines: [], unverified: [] });
  assert.deepEqual(integrateLines(s, {}), { lines: [], unverified: [] }, 'an unread packet is skipped, not guessed');
  assert.match(integrateLines(s, { ALPHA: { ...ok, mergeSha: null } }).unverified[0].reason, /GitHub names no merge commit/);
  const evid = { ...s, packets: { ALPHA: p('ACCEPTED', { artifact: { subjectSha: A, prHeadSha: D, mergeSha: null } }) } };
  assert.equal(integrateLines(evid, { ALPHA: { ...ok, headSha: D } }).lines.length, 1, 'a recorded evidence head (record-evidence) is the head that must have merged');
  assert.match(integrateLines(evid, { ALPHA: ok }).unverified[0].reason, /is not the accepted head/);
});

atest('the writer re-pin: an unpinned writer refuses everything but the owner\'s set-contracts that pins exactly the running writer; then it runs', async () => {
  const { remote, gh } = await delivered();
  const NEW = sha('8');
  const before = events(remote);
  const r0 = await run(remote, gh, { runningSha: NEW, sameTree: () => false });
  assert.equal(r0.outcome, 'refused'); assert.match(r0.exception, /^writer-code-unpinned/);
  const pinsAt = (c) => [{ id: 'writer', path: 'tools/wsf-control', commit: c }, { id: 'writer-workflow', path: '.github/workflows/wsf-control-reconcile.yml', commit: c }];
  const dec = (o) => `\`\`\`wsf-control-decision\n${JSON.stringify(o)}\n\`\`\``;
  gh.post(365, dec({ type: 'set-contracts', contracts: pinsAt(sha('7')) }));
  const r1 = await run(remote, gh, { runningSha: NEW, sameTree: () => false });
  assert.equal(r1.outcome, 'refused', 'a pin to some other version does not unlock the running writer');
  assert.equal(events(remote), before);
  gh.post(365, dec({ type: 'set-contracts', contracts: pinsAt(NEW) }), { author: 'external-user', association: 'NONE' });
  assert.equal((await run(remote, gh, { runningSha: NEW, sameTree: () => false })).outcome, 'refused', 'only the owner re-pins');
  gh.post(365, dec({ type: 'set-contracts', contracts: pinsAt(NEW) }));
  const r2 = await run(remote, gh, { runningSha: NEW, sameTree: () => false });
  assert.equal(r2.repinned, `set-contracts:MANUAL:comment-${gh.inbox(365).at(-1).id}`);
  assert.notEqual(r2.outcome, 'refused');
  assert.ok(formatReport(r2).includes('REPINNED set-contracts:MANUAL'));
  assert.deepEqual(state(remote).contracts.map((c) => c.commit), [NEW, NEW]);
  assert.equal((await run(remote, gh, { runningSha: NEW, sameTree: () => false })).outcome, 'unchanged');
});

atest('a wake whose ball has moved on is never retried or timed out (the worker\'s WATCH is off for it)', async () => {
  const remote = bareRemote(); const gh = fakeGh();
  await run(remote, gh);
  const dec = (o) => `\`\`\`wsf-control-decision\n${JSON.stringify(o)}\n\`\`\``;
  gh.post(365, dec({ type: 'withdraw', packet: 'ALPHA' }));
  await run(remote, gh);
  assert.equal(state(remote).packets.ALPHA.phase, 'WITHDRAWN');
  gh.clock.now += 40 * 60000;
  const r = await run(remote, gh);
  assert.deepEqual(r.appended, []); assert.deepEqual(r.exceptions, []);
  assert.equal(appCommentsIn(gh, 396).length, 1);
});

atest('a policy needing two reviewers routes two free eligible workers and wakes each once (the wakeId, not the packet, is a wake\'s identity)', async () => {
  const remote = bareRemote(); const gh = fakeGh();
  gh.prs.set(12, { state: 'open', headSha: A, baseSha: B });
  const inp = input();
  inp.bootstrap.workers.W5 = { inbox: 395 }; inp.bootstrap.queue.W5 = [];
  inp.bootstrap.packets.ALPHA.review = { workerReviews: [{ class: 'ops-source', count: 2 }], appliesTo: 'subject', after: 'director' };
  await run(remote, gh, { bootstrapInput: inp });
  const w3 = wakesOf(state(remote), 'W3')[0].id;
  gh.post(396, block({ type: 'deliver', packet: 'ALPHA', wakeId: w3, pr: 12, subjectSha: A }));
  const r = await run(remote, gh, { bootstrapInput: inp });
  const s = state(remote);
  assert.deepEqual(s.packets.ALPHA.reviewers, ['W5', 'W7']);
  assert.deepEqual(r.appended.filter((x) => x.startsWith('wake:')), ['wake:R-WAKE:W5-review', 'wake:R-WAKE:W7-review']);
  assert.equal(appCommentsIn(gh, 395).length, 1); assert.equal(appCommentsIn(gh, 434).length, 1);
  // One reviewer passes: the other keeps its ball and its wake (no re-wake).
  gh.post(395, block({ type: 'pass', packet: 'ALPHA', wakeId: wakesOf(s, 'W5')[0].id, subjectSha: A }));
  const r2 = await run(remote, gh, { bootstrapInput: inp });
  assert.deepEqual(r2.appended.filter((x) => x.startsWith('wake')), [`wake-ack:A-WAKE-ACK:W5-comment-${gh.inbox(395).at(-1).id}`]);
  assert.equal(appCommentsIn(gh, 434).length, 1);
  assert.deepEqual(balls(events(remote)).map((b) => b.worker), ['W7'], 'a reviewer that passed holds no ball');
});

atest('a posted wake whose receipt was lost is found again by its marker and recorded, never posted twice', async () => {
  const remote = bareRemote(); const gh = fakeGh();
  await run(remote, gh);
  const text = events(remote).trimEnd().split('\n');
  assert.equal(JSON.parse(text.at(-1)).type, 'wake-delivered');
  const lost = `${text.slice(0, -1).join('\n')}\n`; // the ledger as if the receipt push had lost its race
  const s = reduce(lost);
  const wk = await postWakes(gh, s, lost, { 396: gh.inbox(396) }, BOT);
  assert.equal(gh.calls.created.length, 2, 'shadow comment and the one wake: nothing new');
  assert.deepEqual(wk.lines.map((l) => l.commentId), [802]);
  assert.match(wk.posted[0], /\(found\)$/);
});

atest('a pending finding is handed back (R-FINDING-HANDBACK) once its owner delivers its other ball, with a handback wake', async () => {
  const { remote, gh, reviewWake } = await delivered();
  const dec = (o) => `\`\`\`wsf-control-decision\n${JSON.stringify(o)}\n\`\`\``;
  gh.post(365, dec({ type: 'queue', packet: 'BETA', owner: 'W3', completion: { terminal: 'INTEGRATED', proofType: 'source-only' } }));
  gh.post(365, dec({ type: 'release', packet: 'BETA', inbox: 396 }));
  await run(remote, gh);
  gh.post(434, block({ type: 'finding', packet: 'ALPHA', wakeId: reviewWake, subjectSha: A }));
  await run(remote, gh);
  const s = state(remote);
  assert.ok(workerView(s, 'W7').includes('WATCH=off'), 'the verdict is in: the reviewer holds nothing while the finding waits');
  assert.deepEqual(balls(events(remote)).filter((b) => b.packet === 'ALPHA'), [], 'nor does the router count it a ball');
  const beta = wakesOf(s, 'W3').find((w) => w.packet === 'BETA').id;
  gh.prs.set(14, { state: 'open', headSha: D, baseSha: B });
  gh.post(396, block({ type: 'deliver', packet: 'BETA', wakeId: beta, pr: 14, subjectSha: D }));
  const r = await run(remote, gh);
  assert.ok(r.appended.includes('apply-finding:R-FINDING-HANDBACK:handback-ALPHA'), r.appended.join());
  assert.ok(r.appended.includes('wake:R-WAKE:W3-handback'));
  const s2 = state(remote);
  assert.equal(s2.packets.ALPHA.phase, 'CHANGES_REQUESTED');
  assert.deepEqual(s2.packets.BETA.reviewers, ['W7'], 'BETA routes to the reviewer freed by its verdict');
});

atest('a policy needing two reviewers with only one free waits (AWAITING_REVIEWER); it never routes a short set', async () => {
  const remote = bareRemote(); const gh = fakeGh();
  gh.prs.set(12, { state: 'open', headSha: A, baseSha: B });
  const inp = input();
  inp.bootstrap.packets.ALPHA.review = { workerReviews: [{ class: 'ops-source', count: 2 }], appliesTo: 'subject', after: 'director' };
  await run(remote, gh, { bootstrapInput: inp });
  gh.post(396, block({ type: 'deliver', packet: 'ALPHA', wakeId: wakesOf(state(remote), 'W3')[0].id, pr: 12, subjectSha: A }));
  const r = await run(remote, gh, { bootstrapInput: inp });
  assert.equal(state(remote).packets.ALPHA.phase, 'DELIVERED');
  assert.deepEqual(r.awaiting, ['ALPHA eligible=W7 (too few free ops-source reviewers)']);
});

atest('C78-F1: a timeout resolved by reassign-review clears everywhere; the writer and both views agree, before and after the new reviewer passes', async () => {
  const { remote, gh, reviewWake } = await delivered();
  gh.clock.now += 15 * 60000; await run(remote, gh);
  gh.clock.now += 15 * 60000; const t = await run(remote, gh);
  assert.deepEqual(t.exceptions, [`wake-undelivered W7 ALPHA wake=${reviewWake.slice(0, 12)}`]);
  assert.ok(programView(state(remote)).includes('ACTIONABLE=on'));
  // The documented remedy: a Director reassign-review to W4. W4 is woken; W7's timed-out wake is superseded.
  const dec = (o) => `\`\`\`wsf-control-decision\n${JSON.stringify(o)}\n\`\`\``;
  gh.post(365, dec({ type: 'reassign-review', packet: 'ALPHA', reviewers: ['W4'] }));
  const r = await run(remote, gh);
  assert.ok(r.appended.includes('wake:R-WAKE:W4-review'), r.appended.join());
  assert.deepEqual(r.exceptions, [], 'the writer: resolved');
  const s = state(remote);
  assert.equal(s.wakes[reviewWake].superseded, true);
  const pv = programView(s);
  assert.equal(pv.some((l) => l.includes('wake-undelivered')), false, 'program-view: resolved (C78-F1)');
  assert.ok(pv.includes('ACTIONABLE=off'), pv.join('\n'));
  assert.equal(workerView(s, 'W7').some((l) => l.startsWith('WAKE=')), false, 'worker-view: the superseded wake is not presented as unanswered');
  assert.ok(workerView(s, 'W7').includes('WATCH=off'));
  // Nothing retries or re-reports the superseded wake, however long it waits (W4's own new wake runs its own clock).
  const w7Posts = appCommentsIn(gh, 434).length;
  gh.clock.now += 20 * 60000;
  const idle = await run(remote, gh);
  assert.deepEqual(idle.exceptions, []);
  assert.equal(state(remote).wakes[reviewWake].status, 'timed-out'); assert.equal(appCommentsIn(gh, 434).length, w7Posts, 'no re-post to W7');
  const w4 = wakesOf(state(remote), 'W4')[0].id;
  gh.post(394, block({ type: 'pass', packet: 'ALPHA', wakeId: w4, subjectSha: A }));
  const p = await run(remote, gh);
  assert.ok(p.appended.includes(`review-pass:A-PASS:W4-comment-${gh.inbox(394).at(-1).id}`));
  const s2 = state(remote);
  assert.equal(programView(s2).some((l) => l.includes('wake-undelivered')), false, 'still clear after the replacement reviewer passes');
  assert.ok(programView(s2).some((l) => l.startsWith('AWAITING_ACCEPTANCE ALPHA')));
  gh.post(434, block({ type: 'ack', packet: 'ALPHA', wakeId: reviewWake }));
  assert.match((await run(remote, gh)).intakeRefused.at(-1).reason, /stale assignment/, 'W7\'s late ACK answers a ball it no longer holds');
});

atest('the writer\'s exceptions and program-view\'s agree at every step of the drill (one definition)', async () => {
  const { remote, gh } = await delivered();
  for (const minutes of [0, 15, 15, 15, 60]) {
    gh.clock.now += minutes * 60000;
    const r = await run(remote, gh);
    const view = programView(state(remote)).filter((l) => l.startsWith('CONTROL_EXCEPTION wake-undelivered')).map((l) => l.replace('CONTROL_EXCEPTION ', ''));
    assert.deepEqual(view, r.exceptions);
  }
});

atest('PN-1 guards pinned: a wakeId for another packet, a reviewer delivering, an unreadable ancestry, a wake comment of unknown time', async () => {
  const { remote, gh, reviewWake } = await delivered();
  // K4: the wake's packet must be the report's packet.
  gh.post(434, block({ type: 'pass', packet: 'BETA', wakeId: reviewWake, subjectSha: A }));
  assert.match((await run(remote, gh)).intakeRefused.at(-1).reason, /is for ALPHA, not BETA/);
  // K7: only the owner delivers (the reviewer's wake is not a release or handback).
  gh.post(434, block({ type: 'deliver', packet: 'ALPHA', wakeId: reviewWake, pr: 12, subjectSha: A }));
  assert.match((await run(remote, gh)).intakeRefused.at(-1).reason, /W7 does not own ALPHA; only its owner delivers/);
  // K19: a wake comment whose time the writer cannot read is reported, never retried.
  gh.inboxes.set(434, gh.inbox(434).map((c) => (c.author === BOT ? { ...c, createdAt: undefined } : c)));
  gh.clock.now += 40 * 60000;
  const r = await run(remote, gh);
  assert.equal(r.appended.some((x) => x.startsWith('wake-retry')), false, 'no retry on an unknown clock');
  // K10: an ancestry GitHub cannot compare (null) is refused, not assumed.
  const r2 = bareRemote(); const g2 = fakeGh();
  g2.prs.set(12, { state: 'open', headSha: A, baseSha: B });
  g2.prs.set('descends', () => null);
  await run(r2, g2);
  g2.post(396, block({ type: 'deliver', packet: 'ALPHA', wakeId: wakesOf(state(r2), 'W3')[0].id, pr: 12, subjectSha: A }));
  assert.match((await run(r2, g2)).intakeRefused.at(-1).reason, /does not descend from PR #12's base/);
  assert.equal(state(r2).packets.ALPHA.phase, 'RELEASED');
});

// ---- pure units ---------------------------------------------------------------------------------------
test('wake receipts are never a Director decision, and the same ball re-derived is the same wake identity', () => {
  for (const t of WAKE_EVENTS) assert.equal(INTAKE_TYPES.includes(t), false, t);
  const e = { schema: 2, type: 'wake', wakeId: 'a'.repeat(64), packet: 'ALPHA', worker: 'W7', reason: 'review', source: { kind: 'comment', id: 1, repo: REPO }, authority: { class: 'derived', rule: 'R-WAKE', evidence: [{ kind: 'comment', id: 1 }] } };
  assert.equal(eventId(e), eventId({ ...e }));
  assert.notEqual(eventId(e), eventId({ ...e, wakeId: 'b'.repeat(64) }));
});

test('the reducer refuses a second wake with the same wakeId, even on another source', () => {
  const { appendEvent } = appendMod;
  const t = appendEvent('', { schema: 2, type: 'bootstrap', actor: 'wsf-control-writer', source: { kind: 'comment', id: 700, repo: REPO }, authority: { class: 'manual', rule: 'MANUAL', evidence: [{ kind: 'comment', id: 700 }] }, ...input().bootstrap, canonical: { ...input().bootstrap.canonical, operationalMain: RUNNING } }, { expectHead: '0'.repeat(64) });
  const wake = (id) => ({ schema: 2, type: 'wake', actor: 'wsf-control-writer', wakeId: 'f'.repeat(64), packet: 'ALPHA', worker: 'W3', reason: 'release', source: { kind: 'comment', id, repo: REPO }, authority: { class: 'derived', rule: 'R-WAKE', evidence: [{ kind: 'comment', id }] } });
  const u = appendEvent(t.eventsText, wake(700), { expectHead: t.state.ledgerHead });
  assert.throws(() => appendEvent(u.eventsText, wake(701), { expectHead: u.state.ledgerHead }), /already requested/);
});

test('workerBlock: exactly one block, a known type, exactly its fields', () => {
  assert.equal(workerBlock('prose'), null);
  assert.match(workerBlock('```wsf-control-worker\nnot json\n```').error, /not JSON/);
  assert.match(workerBlock(block({ type: 'ack', packet: 'ALPHA' })).error, /missing wakeId/);
  assert.match(workerBlock(block({ type: 'deliver', packet: 'ALPHA', wakeId: 'a'.repeat(64), pr: 0, subjectSha: A })).error, /pr must be a PR number/);
  assert.equal(workerBlock(block({ type: 'ack', packet: 'ALPHA', wakeId: 'a'.repeat(64) })).value.type, 'ack');
});

await (async () => {
  // postWakes is idempotent: a comment already carrying this attempt's marker is reused, never posted again.
  const s = { repository: REPO, workers: { W7: { inbox: 434 } }, packets: { ALPHA: { artifact: { subjectSha: A }, pr: 12, owner: 'W3' } }, wakes: { ['c'.repeat(64)]: { packet: 'ALPHA', worker: 'W7', reason: 'review', status: 'requested', comments: [], ack: null, superseded: true } } };
  const text = '';
  const gh = fakeGh();
  const noBalls = await postWakes(gh, s, text, {}, BOT);
  assert.deepEqual(noBalls.lines, [], 'a superseded wake (its ball moved on before the post) is never posted');
})();

test('the live wsf-control-state-2 ledger (fixture, 4 lines) still checks and renders byte for byte; its first router run would wake W3 for AUTONOMY-ROUTER-1C', () => {
  const dir = fileURLToPath(new URL('./fixtures/state2-live/', import.meta.url));
  const ev = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8');
  const s = reduce(ev);
  assert.ok(checkTexts(ev, fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).ok);
  assert.equal(`${renderCurrent(s)}\n`, fs.readFileSync(path.join(dir, 'CURRENT.md'), 'utf8'));
  assert.equal(Object.hasOwn(s, 'wakes'), false);
  const b = balls(ev);
  assert.deepEqual(b.map((x) => [x.worker, x.packet, x.reason]), [['W3', 'AUTONOMY-ROUTER-1C', 'release']]);
  assert.deepEqual(b[0].source, { kind: 'comment', id: 5882824399, repo: REPO }, 'the wake rests on the release comment');
});

for (const [n, f] of asyncTests) await runAsync(n, f);
done('router');
