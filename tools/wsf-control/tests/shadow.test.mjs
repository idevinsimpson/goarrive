/**
 * The Step-5 shadow writer (AUTONOMY-STATE-1B) against a REAL local bare repository standing in for the
 * protected ref, and a fake GitHub: bootstrap once, idempotent re-runs, fast-forward-only CAS under a
 * concurrent writer, bounded contention, the writer-code pin, an invalid ledger, decision intake, and the
 * App-token and view units. No network.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BOOTSTRAP_MAX_AGE_MS, MAX_ATTEMPTS, bootstrapEvent, formatReport, recoveryProblem, runShadow, writerPinProblem } from '../shadow-run.mjs';
import { shadowSurfaceEvent, DECISION_OWNER, decisionBlock, decisionIntake, derivedFacts, SHADOW_PLACEHOLDER, stagingProofLines } from '../shadow.mjs';
import { appendAll } from '../append-all.mjs';
import { targetTitle } from '../fastpath.mjs';
import { redact, tokenGitEnv, STATE_REF, predecessorRef } from '../gitstate.mjs';
import { GitHubError, PAGE, gitHubClient, isTransportError } from '../github.mjs';
import { STEP5_PERMISSIONS, appJwt, installationToken, AppTokenError } from '../app-token.mjs';
import { health } from '../health-view.mjs';
import { freshness } from '../freshness-view.mjs';
import { autonomy } from '../autonomy-view.mjs';
import { checkTexts } from '../check.mjs';
import { renderCurrent } from '../render-current.mjs';
import { reduce, serialize } from '../reduce.mjs';
import { appendEvent } from '../append.mjs';
import { A, B, C, D, E, F, REPO, SOURCE_ONLY, atest as runAsync, boot, boot2, done, refused, sha, test, w2 } from './helpers.mjs';
import { validateEvent } from '../schema.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-shadow-'));
const git = (cwd, ...args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
const RUNNING = sha('9');
const AUTHOR = { name: 'wsf-control-writer[bot]', email: '5098407+wsf-control-writer[bot]@users.noreply.github.com' };
const BOT = 'wsf-control-writer[bot]';
/** The base ref: the writer tests below exercise it directly (it has no predecessor). Recovery tests use STATE_REF. */
const BASE = 'wsf-control-state';
/** The run clock: one hour after the fixture's asOf, so the input is fresh. */
const NOW = Date.parse('2026-09-26T18:00:00Z');
/** A comment as GitHub returns it when never edited: created_at === updated_at. */
const POSTED = { createdAt: '2026-09-28T12:00:00Z', updatedAt: '2026-09-28T12:00:00Z' };
const OWNER = { author: 'idevinsimpson', association: 'OWNER', ...POSTED };

/** The bootstrap input as the reviewed file carries it: one work packet delivered on PR 12. */
function input() {
  const b = boot2();
  const { schema, type, actor, source, authority, ...fields } = b;
  delete fields.canonical.operationalMain; // derived from the running commit, never imported
  fields.packets = { ALPHA: { owner: 'W3', completion: { terminal: 'VERIFIED', proofType: 'journey-activation' }, phase: 'DELIVERED', refs: [{ kind: 'comment', id: 700, repo: REPO }], pr: 12, artifact: { subjectSha: A }, subjectPaths: ['apps/wsf'] } };
  return { authorizedBy: 700, bootstrap: fields, contractPaths: [{ id: 'writer', path: 'tools/wsf-control' }, { id: 'writer-workflow', path: '.github/workflows/wsf-control-reconcile.yml' }] };
}

/** A fake GitHub holding PR 12 at `head`, the control-inbox comments, and the comments the writer makes. */
function fakeGh({ head = A, onComment = null } = {}) {
  const comments = new Map();
  let next = 800;
  const calls = { created: 0, edited: 0 };
  return {
    calls, comments,
    async pull() { return { state: 'open', merged: false, headSha: head }; },
    async changedPaths() { return ['docs/evidence.md']; },
    async run() { return null; },
    async comment(id) { onComment?.(); const c = comments.get(id); return c ? { id, body: c.body, author: c.author } : null; },
    async createComment(_issue, body) { next += 1; comments.set(next, { body, author: BOT }); calls.created += 1; return { id: next }; },
    async editComment(id, body) { comments.get(id).body = body; calls.edited += 1; },
    setHead(h) { head = h; },
  };
}
function bareRemote() {
  const d = tmp();
  git(d, 'init', '-q', '--bare', 'remote.git');
  return path.join(d, 'remote.git');
}
// The Step-5 shadow pipeline's tests pin its exact lines with routing off; router.test.mjs runs the writer with it on.
const run = (over) => runShadow({ route: false, ref: BASE, now: NOW, author: AUTHOR, runningSha: RUNNING, sameTree: () => true, bootstrapInput: input(), workdir: tmp(), controlInboxComments: [], botLogin: BOT, ...over });
const remoteEvents = (remote, ref = BASE) => git(os.tmpdir(), '--git-dir', remote, 'show', `refs/heads/${ref}:events.jsonl`);

const asyncTests = [];
const atest = (name, fn) => asyncTests.push([name, fn]);

atest('first run bootstraps the absent ref once as the App, records its own shadow comment, then renders into it', async () => {
  const remote = bareRemote(); const gh = fakeGh();
  const r = await run({ remote, gh });
  assert.equal(r.outcome, 'written'); assert.equal(r.bootstrapped, true); assert.equal(r.attempts, 1);
  assert.deepEqual(r.appended, ['bootstrap:MANUAL:bootstrap', 'set-shadow-surface:R-SHADOW-SURFACE:shadow-comment-801']);
  assert.equal(gh.calls.created, 1); assert.equal(r.surface, 'edited');
  const log = git(os.tmpdir(), '--git-dir', remote, 'log', '--format=%an <%ae>|%cn', `refs/heads/${BASE}`);
  assert.equal(log, `${AUTHOR.name} <${AUTHOR.email}>|${AUTHOR.name}`, 'the state commit is authored and committed as the App bot');
  const text = remoteEvents(remote) + '\n';
  assert.equal(reduce(text).surfaces.shadow.commentId, 801);
  assert.match(gh.comments.get(801).body, /^<!-- wsf-control ledgerHead=/);
  assert.ok(checkTexts(text, git(os.tmpdir(), '--git-dir', remote, 'show', `refs/heads/${BASE}:state.json`) + '\n').ok);
});

atest('a second run with nothing new writes nothing, creates no comment and leaves the surface ok; the bootstrap is never re-run', async () => {
  const remote = bareRemote(); const gh = fakeGh();
  await run({ remote, gh });
  const before = git(os.tmpdir(), '--git-dir', remote, 'rev-parse', `refs/heads/${BASE}`);
  const r = await run({ remote, gh });
  assert.equal(r.outcome, 'unchanged'); assert.equal(r.bootstrapped, false); assert.equal(r.surface, 'ok'); assert.equal(gh.calls.created, 1);
  assert.equal(git(os.tmpdir(), '--git-dir', remote, 'rev-parse', `refs/heads/${BASE}`), before, 'the ref did not move');
});

atest('a moved PR head is recorded as a derived fact (R-RECONCILE-HEAD on the commit, R-RECORD-EVIDENCE when only evidence moved), once', async () => {
  const remote = bareRemote(); const gh = fakeGh();
  await run({ remote, gh });
  gh.setHead(B);
  const r = await run({ remote, gh });
  assert.deepEqual(r.appended, ['reconcile-head:R-RECONCILE-HEAD:ALPHA', 'record-evidence:R-RECORD-EVIDENCE:ALPHA']);
  const again = await run({ remote, gh });
  assert.equal(again.outcome, 'unchanged');
  const s = reduce(`${remoteEvents(remote)}\n`);
  assert.equal(s.packets.ALPHA.artifact.subjectSha, A, 'the subject never moves on a fact');
  assert.equal(s.packets.ALPHA.artifact.prHeadSha, B);
});

atest('CAS: a concurrent writer moves the ref between read and push; the push is refused, the run re-reads and wins on attempt 2', async () => {
  const remote = bareRemote(); const gh = fakeGh();
  await run({ remote, gh });
  gh.setHead(C);
  let raced = false;
  const other = fakeGh({ head: D });
  const gh2 = { ...gh, async comment(id) {
    if (!raced) { raced = true; await run({ remote, gh: { ...other, comments: gh.comments, comment: gh.comment, editComment: gh.editComment } }); }
    return gh.comment(id);
  } };
  const r = await run({ remote, gh: gh2 });
  assert.equal(r.outcome, 'written'); assert.equal(r.attempts, 2);
  const s = reduce(`${remoteEvents(remote)}\n`);
  assert.equal(s.packets.ALPHA.artifact.prHeadSha, C, 'the winner re-derived on top of the concurrent line');
  assert.ok(checkTexts(`${remoteEvents(remote)}\n`, `${git(os.tmpdir(), '--git-dir', remote, 'show', `refs/heads/${BASE}:state.json`)}\n`).ok, 'the ledger is one valid chain, never merged');
});

atest(`bounded contention: a ref that moves on every attempt ends in CONTROL_EXCEPTION writer-contention after ${MAX_ATTEMPTS} attempts`, async () => {
  const remote = bareRemote(); const gh = fakeGh();
  await run({ remote, gh });
  let n = 0;
  const heads = [sha('1'), sha('2'), sha('3'), sha('4')];
  const gh2 = { ...gh, async comment(id) { const other = fakeGh({ head: heads[n] }); n += 1; await run({ remote, gh: { ...other, comments: gh.comments, comment: gh.comment, editComment: gh.editComment } }); return gh.comment(id); } };
  gh.setHead(F);
  const r = await run({ remote, gh: gh2 });
  assert.equal(r.outcome, 'refused'); assert.equal(r.attempts, MAX_ATTEMPTS); assert.match(r.exception, /writer-contention/);
});

atest('an unpinned writer refuses to append: nothing is pushed', async () => {
  const remote = bareRemote(); const gh = fakeGh();
  await run({ remote, gh });
  const before = git(os.tmpdir(), '--git-dir', remote, 'rev-parse', `refs/heads/${BASE}`);
  gh.setHead(E);
  const r = await run({ remote, gh, runningSha: sha('8'), sameTree: () => false });
  assert.equal(r.outcome, 'refused'); assert.match(r.exception, /writer-code-unpinned/);
  assert.equal(git(os.tmpdir(), '--git-dir', remote, 'rev-parse', `refs/heads/${BASE}`), before);
});

atest('an invalid remote ledger stops the run before any write (CONTROL_STATE=invalid), and the surface is not touched', async () => {
  const remote = bareRemote(); const gh = fakeGh();
  await run({ remote, gh });
  const w = tmp();
  git(w, 'clone', '-q', '-b', BASE, remote, '.');
  fs.appendFileSync(path.join(w, 'events.jsonl'), '{"not":"an event"}\n');
  git(w, '-c', 'user.name=x', '-c', 'user.email=x@example.invalid', 'commit', '-qam', 'corrupt');
  git(w, 'push', '-q', 'origin', `HEAD:refs/heads/${BASE}`);
  const edits = gh.calls.edited;
  const r = await run({ remote, gh });
  assert.equal(r.outcome, 'refused'); assert.match(r.exception, /CONTROL_STATE=invalid/); assert.equal(gh.calls.edited, edits);
});

atest('decision intake: one fenced block in the control inbox becomes a MANUAL line on that comment; the writer\'s own comments are never read as decisions', async () => {
  const remote = bareRemote(); const gh = fakeGh();
  await run({ remote, gh });
  const block = (o) => `L0 decision.\n\n\`\`\`wsf-control-decision\n${JSON.stringify(o)}\n\`\`\``;
  const comments = [
    { id: 901, ...OWNER, body: block({ type: 'review', packet: 'ALPHA', reviewers: ['W7'] }) },
    { id: 902, author: BOT, body: block({ type: 'finding', packet: 'ALPHA' }) },
  ];
  const r = await run({ remote, gh, controlInboxComments: comments });
  assert.deepEqual(r.appended, ['review:MANUAL:comment-901']);
  assert.deepEqual(r.intakeRefused, [], 'the App bot\'s own comment is skipped, not refused');
  const line = remoteEvents(remote).split('\n').map((l) => JSON.parse(l)).find((e) => e.type === 'review');
  assert.deepEqual(line.source, { kind: 'comment', id: 901, repo: REPO });
  assert.deepEqual(line.authority, { class: 'manual', rule: 'MANUAL', evidence: [{ kind: 'comment', id: 901 }] });
  assert.equal((await run({ remote, gh, controlInboxComments: comments })).outcome, 'unchanged', 'a re-read decision is the same identity: a no-op');
});

atest('Check 71 F1: a valid decision block from any account but the owner is refused, reported and never appended; set-contracts cannot move the pins', async () => {
  const remote = bareRemote(); const gh = fakeGh();
  await run({ remote, gh });
  const before = remoteEvents(remote);
  const pins = () => JSON.stringify(reduce(`${remoteEvents(remote)}\n`).contracts);
  const contractsBefore = pins();
  assert.notEqual(contractsBefore, undefined);
  const block = (o) => `\`\`\`wsf-control-decision\n${JSON.stringify(o)}\n\`\`\``;
  const contracts = [{ id: 'writer', path: 'tools/wsf-control', commit: sha('7') }, { id: 'writer-workflow', path: '.github/workflows/wsf-control-reconcile.yml', commit: sha('7') }];
  const comments = [
    { id: 911, author: 'external-user', association: 'NONE', ...POSTED, body: block({ type: 'review', packet: 'ALPHA', reviewers: ['W7'] }) },
    { id: 912, author: 'external-user', association: 'NONE', ...POSTED, body: block({ type: 'set-contracts', contracts }) },
    { id: 913, author: 'external-user', association: 'OWNER', ...POSTED, body: block({ type: 'review', packet: 'ALPHA', reviewers: ['W7'] }) },
    { id: 914, author: DECISION_OWNER, association: 'COLLABORATOR', ...POSTED, body: block({ type: 'set-contracts', contracts }) },
  ];
  const r = await run({ remote, gh, controlInboxComments: comments });
  assert.equal(r.outcome, 'unchanged'); assert.deepEqual(r.appended, []);
  assert.deepEqual(r.intakeRefused.map((x) => x.commentId), [911, 912, 913, 914]);
  assert.match(r.intakeRefused[0].reason, /"external-user" is not the repository owner/);
  assert.match(r.intakeRefused[3].reason, /author_association "COLLABORATOR" is not OWNER/);
  assert.ok(formatReport(r).includes('INTAKE_REFUSED comment=912 :: author "external-user" is not the repository owner'));
  assert.equal(remoteEvents(remote), before, 'no ledger mutation');
  assert.equal(pins(), contractsBefore, 'the writer and workflow pins did not move');
  // The fixture itself is schema-valid: from the owner, unedited, the same set-contracts block is appended through the
  // writer (append.mjs validates it) and moves the pins, so above only the author gate refused it.
  const valid = await run({ remote, gh, controlInboxComments: [{ id: 915, ...OWNER, body: block({ type: 'set-contracts', contracts }) }] });
  assert.deepEqual(valid.refused, [], 'the attack fixture must be a valid set-contracts');
  assert.deepEqual(valid.appended, ['set-contracts:MANUAL:comment-915']);
  assert.notEqual(pins(), contractsBefore);
});

atest('Check 71 F1-R2a: an edited owner comment never decides; review and set-contracts are refused, the ledger and pins do not move; the unedited control is recorded', async () => {
  const remote = bareRemote(); const gh = fakeGh();
  await run({ remote, gh });
  const before = remoteEvents(remote);
  const pins = () => JSON.stringify(reduce(`${remoteEvents(remote)}\n`).contracts);
  const contractsBefore = pins();
  const block = (o) => `\`\`\`wsf-control-decision\n${JSON.stringify(o)}\n\`\`\``;
  const contracts = [{ id: 'writer', path: 'tools/wsf-control', commit: sha('7') }, { id: 'writer-workflow', path: '.github/workflows/wsf-control-reconcile.yml', commit: sha('7') }];
  // What a write collaborator's edit of an owner comment looks like: author and association unchanged, updated_at moved.
  const EDITED = { ...OWNER, updatedAt: '2026-09-28T12:05:00Z' };
  const attack = [
    { id: 921, ...EDITED, body: block({ type: 'review', packet: 'ALPHA', reviewers: ['W7'] }) },
    { id: 922, ...EDITED, body: block({ type: 'set-contracts', contracts }) },
    { id: 923, ...OWNER, createdAt: null, body: block({ type: 'review', packet: 'ALPHA', reviewers: ['W7'] }) },
    { id: 924, author: DECISION_OWNER, association: 'OWNER', body: block({ type: 'set-contracts', contracts }) },
  ];
  const r = await run({ remote, gh, controlInboxComments: attack });
  assert.equal(r.outcome, 'unchanged'); assert.deepEqual(r.appended, []);
  assert.deepEqual(r.intakeRefused.map((x) => x.commentId), [921, 922, 923, 924]);
  assert.match(r.intakeRefused[0].reason, /^edited-comment: /);
  assert.match(r.intakeRefused[1].reason, /^edited-comment: /);
  assert.match(r.intakeRefused[2].reason, /^comment-timestamps-missing: /);
  assert.match(r.intakeRefused[3].reason, /^comment-timestamps-missing: /);
  assert.ok(formatReport(r).includes('INTAKE_REFUSED comment=922 :: edited-comment: '));
  assert.equal(remoteEvents(remote), before, 'no ledger mutation');
  assert.equal(pins(), contractsBefore, 'the writer and workflow pins did not move');
  // Control: the same two blocks, never edited, from the owner, are recorded and the pins move.
  const ok = await run({ remote, gh, controlInboxComments: [{ id: 931, ...OWNER, body: attack[0].body }, { id: 932, ...OWNER, body: attack[1].body }] });
  assert.deepEqual(ok.appended, ['review:MANUAL:comment-931', 'set-contracts:MANUAL:comment-932']);
  assert.notEqual(pins(), contractsBefore);
});

atest('Check 71 F1: the comment-reading path carries each author\'s login and author_association, and a missing one as null', async () => {
  const raw = [
    { id: 1, body: 'a', user: { login: 'idevinsimpson' }, author_association: 'OWNER', created_at: '2026-09-28T12:00:00Z', updated_at: '2026-09-28T12:00:00Z' },
    { id: 2, body: 'b', user: { login: 'external-user' }, author_association: 'NONE', created_at: '2026-09-28T12:00:00Z', updated_at: '2026-09-28T12:07:00Z' },
    { id: 3, body: 'c', user: null },
  ];
  const fetchImpl = async (url) => ({ ok: true, status: 200, json: async () => (url.includes('/issues/comments/') ? raw[0] : /\/issues\/365$/.test(url) ? { comments: raw.length } : raw) });
  const gh = gitHubClient({ token: 't', repo: REPO, fetchImpl });
  assert.deepEqual(await gh.recentComments(365), [
    { id: 1, body: 'a', author: 'idevinsimpson', association: 'OWNER', createdAt: '2026-09-28T12:00:00Z', updatedAt: '2026-09-28T12:00:00Z' },
    { id: 2, body: 'b', author: 'external-user', association: 'NONE', createdAt: '2026-09-28T12:00:00Z', updatedAt: '2026-09-28T12:07:00Z' },
    { id: 3, body: 'c', author: null, association: null, createdAt: null, updatedAt: null },
  ]);
  assert.deepEqual(await gh.comment(1), { id: 1, body: 'a', author: 'idevinsimpson', association: 'OWNER', createdAt: '2026-09-28T12:00:00Z', updatedAt: '2026-09-28T12:00:00Z' });
});

// ---- CONTROL-RECENT-COMMENTS-SAFE-READ-1: newest-comment reads are bounded ----------------------------------------
/**
 * A conversation as the REST API serves it: GET /issues/N gives its comment count, GET /issues/N/comments pages it
 * oldest-first. Every request, every attempt and the bytes served are counted. `afterCount` runs once, right after the
 * count is read, to model a comment that lands (or is deleted) between the count and the pages; `afterPage` runs after
 * every page served, to model one deleted between two page reads. Transport models (runs 37493661423, 37494992451):
 * `socketLimit` loses the socket on any single response body larger than that many bytes; `dropOnce(u)` loses it once,
 * on the first request it matches (a pooled connection the server closed). A lost socket throws, as undici does.
 */
function conversation(n, { afterCount = null, afterPage = null, failOn = null, count = undefined, socketLimit = Infinity, dropOnce = null } = {}) {
  const comments = Array.from({ length: n }, (_, i) => mkComment(i + 1));
  const log = []; let bytes = 0; let hook = afterCount; let dropped = false; let maxPage = 0;
  const lost = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } });
  const reply = (status, data) => {
    const text = JSON.stringify(data);
    if (text.length > socketLimit) throw lost();
    bytes += text.length;
    return { ok: status < 400, status, json: async () => JSON.parse(text) };
  };
  const fetchImpl = async (url) => {
    const u = new URL(url);
    log.push(u.pathname + u.search);
    if (dropOnce && !dropped && dropOnce(u)) { dropped = true; throw lost(); }
    if (failOn && failOn(u)) return reply(500, {});
    if (u.pathname === `/repos/${REPO}/issues/365`) {
      const out = reply(200, { number: 365, comments: count === undefined ? comments.length : count });
      if (hook) { const h = hook; hook = null; h(comments); }
      return out;
    }
    if (u.pathname === `/repos/${REPO}/issues/365/comments`) {
      const per = Number(u.searchParams.get('per_page')); const pg = Number(u.searchParams.get('page'));
      const page = comments.slice((pg - 1) * per, pg * per);
      maxPage = Math.max(maxPage, page.length);
      const out = reply(200, page);
      if (afterPage) afterPage(pg, comments);
      return out;
    }
    return reply(404, {});
  };
  const pageList = () => log.filter((l) => l.includes('/comments?')).map((l) => Number(/[?&]page=(\d+)/.exec(l)[1]));
  return { comments, log, pages: () => pageList().length, pageList, bytes: () => bytes, maxPage: () => maxPage, dropped: () => dropped, fetchImpl };
}
const mkComment = (id) => ({ id, body: `comment ${id} ${'x'.repeat(1200)}`, user: { login: id % 2 ? 'idevinsimpson' : 'wsf-control-writer[bot]' }, author_association: id % 2 ? 'OWNER' : 'NONE', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' });
const shape = (c) => ({ id: c.id, body: c.body, author: c.user?.login ?? null, association: c.author_association ?? null, createdAt: c.created_at ?? null, updatedAt: c.updated_at ?? null });
/** The original walk this packet replaced: from page 1 to the end, keep the newest `count`. */
async function unboundedRecentComments(fetchImpl, issue, count = 100) {
  let window = [];
  for (let page = 1; page <= 100; page += 1) {
    const res = await fetchImpl(`https://api.github.com/repos/${REPO}/issues/${issue}/comments?per_page=100&page=${page}`);
    const batch = (await res.json()) ?? [];
    window = window.concat(batch).slice(-count);
    if (batch.length < 100) break;
  }
  return window.map(shape);
}
/**
 * The #579 reader as integrated at e5416da1 (100-comment pages, no retry), kept to reproduce the residual: the same
 * descending window, with `per` comments to a page and no second attempt on a lost socket.
 */
async function hundredPageReader(fetchImpl, issue, count = 100, per = 100) {
  const get = async (route) => { const res = await fetchImpl(`https://api.github.com${route}`); if (res.status === 404) return null; if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); };
  const meta = await get(`/repos/${REPO}/issues/${issue}`);
  const lastPage = Math.max(1, Math.ceil(meta.comments / per));
  const read = async (n) => (await get(`/repos/${REPO}/issues/${issue}/comments?per_page=${per}&page=${n}`)) ?? [];
  let end = lastPage; let endBatch;
  for (;; end += 1) { endBatch = await read(end); if (endBatch.length < per) break; }
  const pages = new Map([[end, endBatch]]);
  const held = () => [...new Map([...pages.keys()].sort((x, y) => x - y).flatMap((k) => pages.get(k)).map((c) => [c.id, c])).values()];
  for (let first = end; held().length < count && first > 1;) { first -= 1; pages.set(first, await read(first)); }
  return held().slice(-count).map(shape);
}
const newest = (cs, k = 100) => cs.slice(-k).map(shape);
const client = (c) => gitHubClient({ token: 't', repo: REPO, fetchImpl: c.fetchImpl });

atest('SAFE-READ residual (runs 37493661423, 37494992451): the 100-comment, no-retry reader loses the socket; the 25-comment reader with one GET retry does not', async () => {
  // A socket that dies on any single body over 40 KB: 100 of #365's long comments (~130 KB here) kill it, 25 (~33 KB) do not.
  await assert.rejects(hundredPageReader(conversation(1234, { socketLimit: 40_000 }).fetchImpl, 365), /fetch failed/);
  const big = conversation(1234, { socketLimit: 40_000 });
  assert.deepEqual(await client(big).recentComments(365), newest(big.comments));
  // A pooled socket the server closed before the count request (the failing line in both runs): one GET retry recovers.
  await assert.rejects(hundredPageReader(conversation(1234, { dropOnce: (u) => u.pathname.endsWith('/issues/365') }).fetchImpl, 365), /fetch failed/);
  const pooled = conversation(1234, { dropOnce: (u) => u.pathname.endsWith('/issues/365') });
  assert.deepEqual(await client(pooled).recentComments(365), newest(pooled.comments));
  assert.ok(pooled.dropped());
  assert.equal(pooled.log.filter((l) => l.endsWith('/issues/365')).length, 2, 'the count request attempted exactly twice');
});

atest('SAFE-READ: no single comment response carries more than 25 comments, on any conversation size', async () => {
  assert.equal(PAGE, 25);
  for (const n of [0, 24, 25, 26, 99, 100, 101, 1000, 1234, 5060]) {
    const c = conversation(n);
    assert.deepEqual(await client(c).recentComments(365), newest(c.comments), `${n} comments`);
    assert.ok(c.maxPage() <= 25, `${n}: a page of ${c.maxPage()}`);
    assert.ok(c.log.filter((l) => l.includes('/comments?')).every((l) => l.includes('per_page=25&')), `${n}: every page asks for 25`);
  }
});

atest('SAFE-READ page math at 25: 0, 24, 25, 26, exact boundaries and the newest 100', async () => {
  const cases = [
    [0, [1]], [1, [1]], [24, [1]],
    [25, [1, 2, 1]], // a full final page: probe the empty next page, then read the window descending
    [26, [2, 1]],
    [99, [4, 3, 2, 1]], [100, [4, 5, 4, 3, 2, 1]], [101, [5, 4, 3, 2, 1]],
    [1000, [40, 41, 40, 39, 38, 37]], // exact boundary: the probe copy of page 40 is not trusted
    [1060, [43, 42, 41, 40, 39]], // partial final page of 10: the newest 100 span five pages
    [1234, [50, 49, 48, 47, 46]],
  ];
  for (const [n, pages] of cases) {
    const c = conversation(n);
    assert.deepEqual(await client(c).recentComments(365), newest(c.comments), `${n} comments`);
    assert.deepEqual(c.pageList(), pages, `${n}: pages read`);
  }
});

atest('SAFE-READ: on a 1,234-comment conversation the original walk reads all 13 hundred-pages; the bounded read returns the same newest 100 from 5 small pages', async () => {
  const old = conversation(1234);
  assert.deepEqual(await unboundedRecentComments(old.fetchImpl, 365), newest(old.comments));
  assert.equal(old.pages(), 13, 'the original implementation walks the whole conversation');
  const c = conversation(1234);
  const got = await client(c).recentComments(365, 100);
  assert.deepEqual(got, newest(c.comments), 'the newest 100, oldest first, every field carried');
  assert.deepEqual(c.log[0], `/repos/${REPO}/issues/365`);
  assert.equal(c.log.length, 6, 'the count and five 25-comment pages');
  assert.ok(c.bytes() * 5 < old.bytes(), `bounded ${c.bytes()} bytes vs unbounded ${old.bytes()}`);
  assert.equal(new Set(got.map((x) => x.id)).size, got.length, 'no duplicates');
});

atest('SAFE-READ: a conversation of 5,060 comments costs the same six requests as one of 360', async () => {
  for (const n of [360, 5060]) {
    const c = conversation(n);
    assert.deepEqual(await client(c).recentComments(365), newest(c.comments));
    assert.equal(c.pages(), 5, `${n}: five comment pages`);
    assert.equal(c.log.length, 6);
  }
});

atest('SAFE-READ: a comment deleted between two page reads is never a gap: the shifted one is read twice and kept once', async () => {
  let deleted = false;
  const c = conversation(1234, { afterPage: (pg, cs) => { if (pg === 50 && !deleted) { deleted = true; cs.splice(0, 1); } } });
  const got = await client(c).recentComments(365);
  assert.ok(deleted);
  assert.deepEqual(got, newest(c.comments), 'exactly the newest 100 that exist');
  assert.equal(new Set(got.map((x) => x.id)).size, 100, 'the comment that shifted onto the earlier page is not doubled');
});

atest('SAFE-READ: a comment that arrives between the count and the pages rolls onto a new page and is read; none is lost or doubled', async () => {
  const c = conversation(1000, { afterCount: (cs) => cs.push(mkComment(1001)) });
  const got = await client(c).recentComments(365);
  assert.deepEqual(got, newest(c.comments), 'the newest decision is the arrival itself');
  assert.equal(got.at(-1).id, 1001);
  assert.equal(new Set(got.map((x) => x.id)).size, 100);
  const d = conversation(999, { afterCount: (cs) => cs.push(mkComment(1000), mkComment(1001), mkComment(1002)) });
  assert.deepEqual(await client(d).recentComments(365), newest(d.comments));
});

atest('SAFE-READ (W9 finding #497 6019310772): an arrival after the count plus an older deletion between the forward probes never drops the newest', async () => {
  // Count 1000; comment 1001 arrives after the count; the counted last page (40 at 25 a page) is probed full; an older
  // comment is deleted before the next probe, so 1001 shifts back. The window must still be the true newest 100: 902..1001.
  let deleted = false;
  const c = conversation(1000, {
    afterCount: (cs) => cs.push(mkComment(1001)),
    afterPage: (pg, cs) => { if (pg === 40 && !deleted) { deleted = true; cs.splice(0, 1); } },
  });
  const got = await client(c).recentComments(365);
  assert.ok(deleted);
  assert.deepEqual(got.map((x) => x.id), Array.from({ length: 100 }, (_, i) => 902 + i), 'exactly 902..1001: no omission');
  assert.equal(new Set(got.map((x) => x.id)).size, 100, 'no duplicate');
  assert.deepEqual(got, newest(c.comments));
});

atest('SAFE-READ: comments deleted between the count and the pages widen the window backwards; more than the bound absorbs is refused', async () => {
  const c = conversation(1000, { afterCount: (cs) => cs.splice(100, 40) });
  const got = await client(c).recentComments(365);
  assert.deepEqual(got, newest(c.comments));
  assert.equal(got.length, 100);
  await assert.rejects(client(conversation(1000, { afterCount: (cs) => cs.splice(100, 150) })).recentComments(365), /could not be read in a bounded window/);
});

atest('SAFE-READ: small, empty and absent conversations', async () => {
  for (const n of [0, 1, 24, 25, 26, 99, 100, 101]) {
    const c = conversation(n);
    assert.deepEqual(await client(c).recentComments(365), newest(c.comments), `${n} comments`);
  }
  const gone = conversation(5);
  assert.deepEqual(await client(gone).recentComments(999), [], 'an absent conversation is empty, as before');
  const few = conversation(250);
  assert.deepEqual(await client(few).recentComments(365, 30), newest(few.comments, 30), 'a smaller count');
});

atest('SAFE-READ fails closed: a failing count or page, an unreadable count, a conversation that keeps growing, never a partial window', async () => {
  const read = (c) => client(c).recentComments(365);
  await assert.rejects(read(conversation(1234, { failOn: (u) => u.pathname.endsWith('/issues/365') })), /HTTP 500/);
  await assert.rejects(read(conversation(1234, { failOn: (u) => u.searchParams.get('page') === '50' })), /HTTP 500/);
  for (const bad of [null, -1, 1.5, '1234']) await assert.rejects(read(conversation(1234, { count: bad })), /no readable comment count/, String(bad));
  await assert.rejects(read(conversation(1000, { afterCount: (cs) => { for (let i = 1; i <= 75; i += 1) cs.push(mkComment(1000 + i)); } })), /kept growing/);
  // A count that claims far more than exists cannot be satisfied in the bounded window: refused, not returned short.
  await assert.rejects(read(conversation(150, { count: 2000 })), /could not be read in a bounded window/);
});

atest('GET-ONLY RETRY: one transport failure on a GET is retried once; a second surfaces; HTTP answers and mutations are never retried', async () => {
  const lost = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } });
  const ok = (data) => ({ ok: true, status: 200, json: async () => data });
  const raw = { id: 7, body: 'b', user: { login: 'idevinsimpson' }, author_association: 'OWNER', created_at: 't', updated_at: 't' };
  /** A fake that answers by a script, one entry per attempt, recording each attempt's method. */
  const scripted = (...steps) => { const seen = []; return { seen, fetchImpl: async (url, init) => { seen.push(init.method); const s = steps.shift(); if (s === 'lost') throw lost(); return s; } }; };
  const gh = (f) => gitHubClient({ token: 't', repo: REPO, fetchImpl: f.fetchImpl });

  const once = scripted('lost', ok(raw));
  assert.deepEqual(await gh(once).comment(7), { id: 7, body: 'b', author: 'idevinsimpson', association: 'OWNER', createdAt: 't', updatedAt: 't' }, 'the exact response, once');
  assert.deepEqual(once.seen, ['GET', 'GET']);

  // undici's own form for a body cut off mid-read: TypeError('terminated') caused by the socket error.
  const bodyCut = scripted({ ok: true, status: 200, json: async () => { throw Object.assign(new TypeError('terminated'), { cause: { code: 'UND_ERR_SOCKET' } }); } }, ok(raw));
  assert.equal((await gh(bodyCut).comment(7)).id, 7, 'a body cut off mid-read is a transport failure too');
  assert.deepEqual(bodyCut.seen, ['GET', 'GET']);

  const twice = scripted('lost', 'lost', ok(raw));
  await assert.rejects(gh(twice).comment(7), /fetch failed/);
  assert.deepEqual(twice.seen, ['GET', 'GET'], 'a second transport failure surfaces; there is no third attempt');

  const post = scripted('lost', ok({ id: 1 }));
  await assert.rejects(gh(post).createComment(396, 'x'), /fetch failed/, 'POST');
  assert.deepEqual(post.seen, ['POST'], 'POST is attempted exactly once');
  // CONTROL-CURRENT-PATCH-ACK-1: a lost PATCH answer is read back once, never re-sent (the read-back here shows other content).
  const patch = scripted('lost', ok({ ...raw, id: 5 }));
  await assert.rejects(gh(patch).editComment(5, 'x'), /unconfirmed/, 'PATCH');
  assert.deepEqual(patch.seen, ['PATCH', 'GET'], 'PATCH is attempted exactly once; its lost answer is read back, never re-sent');

  for (const status of [400, 403, 422, 500, 502, 503]) {
    const h = scripted({ ok: false, status, json: async () => ({}) }, ok(raw));
    await assert.rejects(gh(h).comment(7), new RegExp(`HTTP ${status}`));
    assert.deepEqual(h.seen, ['GET'], `HTTP ${status} is attempted exactly once`);
  }
  const absent = scripted({ ok: false, status: 404, json: async () => ({}) }, ok(raw));
  assert.equal(await gh(absent).comment(7), null);
  assert.deepEqual(absent.seen, ['GET'], '404 stays an answer: null, once');

  // W4 finding (#394 6021437625): only a TRANSPORT failure is retried. Programmer and application errors, and a body
  // that is not JSON, are thrown on their first attempt (a retry would hide them, not cure them).
  for (const [name, make] of [
    ['ReferenceError', () => { throw new ReferenceError('x is not defined'); }],
    ['RangeError', () => { throw new RangeError('out of range'); }],
    ['plain application Error', () => { throw new Error('application bug'); }],
    ['programmer TypeError', () => { throw new TypeError("Cannot read properties of undefined (reading 'x')"); }],
    ['SyntaxError from json()', () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token < in JSON'); } })],
  ]) {
    const seen = [];
    const g = gitHubClient({ token: 't', repo: REPO, fetchImpl: async (url, init) => { seen.push(init.method); if (seen.length > 1) return ok(raw); return make(); } });
    await assert.rejects(g.comment(7), (e) => !(e instanceof GitHubError) && !isTransportError(e), name);
    assert.deepEqual(seen, ['GET'], `${name}: attempted exactly once, never retried`);
  }
});

atest('isTransportError: undici transport forms only', () => {
  const sock = { code: 'UND_ERR_SOCKET' };
  for (const e of [Object.assign(new TypeError('fetch failed'), { cause: sock }), new TypeError('fetch failed'), Object.assign(new TypeError('terminated'), { cause: sock }), new TypeError('terminated'),
    Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }), Object.assign(new Error('x'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })]) {
    assert.equal(isTransportError(e), true, `${e.constructor.name}: ${e.message}`);
  }
  for (const e of [new ReferenceError('x'), new RangeError('x'), new Error('application bug'), new SyntaxError('Unexpected token'), new TypeError("Cannot read properties of undefined"),
    Object.assign(new Error('x'), { code: 'ECONNRESET_LIKE' }), new GitHubError(500, 'x'), Object.assign(new GitHubError(502, 'x'), { cause: sock }), null, 'fetch failed', { message: 'fetch failed' }]) {
    assert.equal(isTransportError(e), false, String(e?.message ?? e));
  }
});

// ---- CONTROL-CURRENT-PATCH-ACK-1 (#365 6044027142): the CURRENT comment edit, acknowledged by status, never re-sent ----
// Run 37661819992 failed with `TypeError: fetch failed` at the PATCH (github.mjs await fetchImpl, via editComment and
// shadow-run's surface edit). The edit now never reads its 2xx body, and a lost answer is settled by one exact read-back.
const TOKEN = 'tok-NEVER-PRINTED-0001';
const SECRET_BODY = 'SECRET-RENDERED-BODY <!-- wsf-control ledgerHead=abc -->';
const lostPatch = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } });
const okNoRead = (onCancel = async () => {}) => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('the PATCH answer must never be parsed'); }, body: { cancel: onCancel } });
/** A comment server: one comment (id 5), PATCH and GET routed to `patch` / `get`; every attempt's method recorded. */
function commentServer({ patch, get = null, start = 'old body' } = {}) {
  const store = new Map([[5, start]]);
  const seen = [];
  const raw = (id) => ({ id, body: store.get(id), user: { login: BOT }, author_association: 'NONE', created_at: 't', updated_at: 't' });
  const fetchImpl = async (url, init) => {
    seen.push(init.method);
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
    const id = Number(new URL(url).pathname.split('/').pop());
    if (init.method === 'PATCH') return patch(store, id, JSON.parse(init.body).body);
    if (get) return get(store, id, raw);
    return store.has(id) ? { ok: true, status: 200, json: async () => raw(id) } : { ok: false, status: 404, json: async () => ({}) };
  };
  return { store, seen, client: gitHubClient({ token: TOKEN, repo: REPO, fetchImpl }) };
}
const patches = (seen) => seen.filter((m) => m === 'PATCH').length;
const noLeak = (e) => { const m = `${e?.message ?? ''}${e?.stack ?? ''}`; return !m.includes(TOKEN) && !m.includes(SECRET_BODY) && !m.includes('old body'); };

atest('PATCH-ACK: a 2xx edit is acknowledged by its status; the large or unreadable answer is never parsed, and a failing cancel is swallowed', async () => {
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  try {
    let cancelled = 0;
    const big = commentServer({ patch: (st, id, b) => { st.set(id, b); return okNoRead(async () => { cancelled += 1; }); } });
    assert.equal(await big.client.editComment(5, SECRET_BODY), 'acknowledged');
    assert.deepEqual(big.seen, ['PATCH'], 'one PATCH, no read');
    assert.equal(cancelled, 1, 'the unread answer is cancelled once');
    const badCancel = commentServer({ patch: (st, id, b) => { st.set(id, b); return okNoRead(() => Promise.reject(new Error('cancel failed'))); } });
    assert.equal(await badCancel.client.editComment(5, SECRET_BODY), 'acknowledged');
    const throwsCancel = commentServer({ patch: (st, id, b) => { st.set(id, b); return okNoRead(() => { throw new Error('sync cancel failure'); }); } });
    assert.equal(await throwsCancel.client.editComment(5, SECRET_BODY), 'acknowledged');
    const noBody = commentServer({ patch: (st, id, b) => { st.set(id, b); return { ok: true, status: 204, json: async () => { throw new Error('never'); } }; } });
    assert.equal(await noBody.client.editComment(5, SECRET_BODY), 'acknowledged', 'an answer with no stream is acknowledged too');
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(unhandled, [], 'no unhandled rejection');
  } finally { process.off('unhandledRejection', onUnhandled); }
});

atest('PATCH-ACK: a lost answer after the server APPLIED the exact edit is confirmed by one read-back; one PATCH', async () => {
  const s = commentServer({ patch: (st, id, b) => { st.set(id, b); throw lostPatch(); } });
  assert.equal(await s.client.editComment(5, SECRET_BODY), 'confirmed-by-readback');
  assert.deepEqual(s.seen, ['PATCH', 'GET']);
  assert.equal(s.store.get(5), SECRET_BODY);
});

atest('PATCH-ACK: every unconfirmed read-back fails closed with one PATCH and never overwrites: not applied, missing, other or newer, marker-only, failed', async () => {
  const marker = SECRET_BODY.slice(SECRET_BODY.indexOf('<!--'));
  const cases = [
    ['not applied (the old body is still there)', { patch: () => { throw lostPatch(); } }, ['PATCH', 'GET']],
    ['the comment is gone (404)', { patch: (st) => { st.delete(5); throw lostPatch(); } }, ['PATCH', 'GET']],
    ['a newer concurrent body', { patch: (st, id) => { st.set(id, `${SECRET_BODY}\nnewer`); throw lostPatch(); } }, ['PATCH', 'GET']],
    ['a matching marker but a different body', { patch: (st, id) => { st.set(id, marker); throw lostPatch(); } }, ['PATCH', 'GET']],
    ['the read-back answers HTTP 500', { patch: () => { throw lostPatch(); }, get: () => ({ ok: false, status: 500, json: async () => ({}) }) }, ['PATCH', 'GET']],
    ['the read-back loses its socket twice', { patch: () => { throw lostPatch(); }, get: () => { throw lostPatch(); } }, ['PATCH', 'GET', 'GET']],
    ['the read-back is malformed JSON', { patch: () => { throw lostPatch(); }, get: () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } }) }, ['PATCH', 'GET']],
    ['the read-back names another comment', { patch: (st, id, b) => { st.set(id, b); throw lostPatch(); }, get: (st, id, raw) => ({ ok: true, status: 200, json: async () => ({ ...raw(id), id: 6 }) }) }, ['PATCH', 'GET']],
  ];
  for (const [name, opts, seen] of cases) {
    const s = commentServer(opts);
    const before = s.store.get(5);
    await assert.rejects(s.client.editComment(5, SECRET_BODY), (e) => e instanceof GitHubError && !isTransportError(e) && /the edit is unconfirmed/.test(e.message) && noLeak(e), name);
    assert.deepEqual(s.seen, seen, name);
    assert.equal(patches(s.seen), 1, `${name}: exactly one PATCH`);
    if (name.startsWith('not applied')) assert.equal(s.store.get(5), before, 'nothing was overwritten');
  }
});

atest('PATCH-ACK: HTTP answers fail closed on their first attempt with no read-back (401, 403, 404, 422, 429, 5xx); a programmer error is thrown as it is', async () => {
  for (const status of [401, 403, 404, 422, 429, 500, 502, 503]) {
    let cancelled = 0;
    const s = commentServer({ patch: () => ({ ok: false, status, json: async () => { throw new Error('never read'); }, body: { cancel: async () => { cancelled += 1; } } }) });
    await assert.rejects(s.client.editComment(5, SECRET_BODY), (e) => e instanceof GitHubError && e.status === status && new RegExp(`HTTP ${status}`).test(e.message) && noLeak(e), String(status));
    assert.deepEqual(s.seen, ['PATCH'], `HTTP ${status}: one PATCH, no read-back, no retry`);
    assert.equal(cancelled, 1);
  }
  const bug = commentServer({ patch: () => { throw new TypeError("Cannot read properties of undefined (reading 'x')"); } });
  await assert.rejects(bug.client.editComment(5, SECRET_BODY), (e) => e instanceof TypeError && !(e instanceof GitHubError));
  assert.deepEqual(bug.seen, ['PATCH'], 'a programmer error is not a transport failure: no read-back');
});

atest('PATCH-ACK: POST creation still reads and returns its new id; GET reads are unchanged', async () => {
  const seen = [];
  const g = gitHubClient({ token: TOKEN, repo: REPO, fetchImpl: async (url, init) => { seen.push(init.method); return init.method === 'POST' ? { ok: true, status: 201, json: async () => ({ id: 4242 }) } : { ok: true, status: 200, json: async () => ({ id: 7, body: 'b', user: { login: 'x' } }) }; } });
  assert.deepEqual(await g.createComment(396, 'x'), { id: 4242 });
  assert.equal((await g.comment(7)).body, 'b');
  assert.deepEqual(seen, ['POST', 'GET']);
});

/** The writer end to end, its surface edit going through the REAL client over a fake transport. */
function patchWriterGh(mode) {
  const base = fakeGh();
  const state = { mode, patches: 0 };
  const fetchImpl = async (url, init) => {
    const id = Number(new URL(url).pathname.split('/').pop());
    if (init.method === 'PATCH') {
      state.patches += 1;
      const want = JSON.parse(init.body).body;
      if (state.mode === 'lost-unapplied') throw lostPatch();
      base.comments.get(id).body = want;
      if (state.mode === 'lost-applied') throw lostPatch();
      return okNoRead();
    }
    const c = base.comments.get(id);
    return c ? { ok: true, status: 200, json: async () => ({ id, body: c.body, user: { login: BOT }, created_at: 't', updated_at: 't' }) } : { ok: false, status: 404, json: async () => ({}) };
  };
  const real = gitHubClient({ token: TOKEN, repo: REPO, fetchImpl });
  return { gh: { ...base, editComment: (id, body) => real.editComment(id, body) }, base, state };
}

atest('PATCH-ACK end to end: the ledger is pushed, the CURRENT edit\'s answer is lost and unapplied: the run fails, claims no surface, and the next run repairs it with no duplicate line or comment', async () => {
  const remote = bareRemote();
  const w = patchWriterGh('lost-unapplied');
  await assert.rejects(run({ remote, gh: w.gh }), (e) => /the edit is unconfirmed/.test(e.message) && noLeak(e));
  assert.equal(w.state.patches, 1, 'one PATCH, never re-sent');
  const pushed = `${remoteEvents(remote)}\n`;
  assert.equal(reduce(pushed).eventCount, 2, 'the protected state advanced before the edit (bootstrap + surface)');
  assert.ok(w.base.comments.get(801).body.startsWith(SHADOW_PLACEHOLDER.split('\n')[0]), 'the comment still shows the placeholder: nothing claims it was rendered');
  w.state.mode = 'ok';
  const r = await run({ remote, gh: w.gh });
  assert.equal(r.outcome, 'unchanged', 'no ledger line is written twice');
  assert.equal(r.surface, 'edited');
  assert.equal(`${remoteEvents(remote)}\n`, pushed, 'the ledger is byte-identical');
  assert.equal(w.base.calls.created, 1, 'no second comment');
  assert.equal(w.state.patches, 2, 'the repair is the next run\'s single PATCH');
  assert.match(w.base.comments.get(801).body, /^<!-- wsf-control ledgerHead=/);
});

atest('PATCH-ACK end to end: a lost answer to an APPLIED edit is confirmed by read-back; the run reports the edit and a re-run finds it ok', async () => {
  const remote = bareRemote();
  const w = patchWriterGh('lost-applied');
  const r = await run({ remote, gh: w.gh });
  assert.equal(r.surface, 'edited');
  assert.equal(w.state.patches, 1);
  w.state.mode = 'ok';
  const again = await run({ remote, gh: w.gh });
  assert.equal(again.outcome, 'unchanged');
  assert.equal(again.surface, 'ok', 'the confirmed edit is the rendering');
  assert.equal(w.state.patches, 1, 'nothing re-sent');
});

// ---- stale-bootstrap recovery (run 50: the first bootstrap imported a 28-hour-old input) ----------------------
const refSha = (remote, ref) => { const r = spawnSync('git', ['--git-dir', remote, 'rev-parse', '--verify', '-q', `refs/heads/${ref}`], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; };
/** The predecessor as run 50 left it: a bootstrap plus the App's own set-shadow-surface, rendered into its comment. */
async function staleBase() {
  const remote = bareRemote(); const gh = fakeGh();
  const r = await run({ remote, gh });
  assert.deepEqual(r.appended, ['bootstrap:MANUAL:bootstrap', 'set-shadow-surface:R-SHADOW-SURFACE:shadow-comment-801']);
  return { remote, gh, baseSha: refSha(remote, BASE), baseEvents: remoteEvents(remote) };
}
const LATER = NOW + 28 * 60 * 60 * 1000; // a day later, as run 50 was
/** The refreshed input: asOf one hour before the recovery run. */
const fresh = () => { const i = input(); i.bootstrap.asOf = new Date(LATER - 60 * 60 * 1000).toISOString().replace('.000Z', 'Z'); return i; };
const recover = (over) => run({ ref: STATE_REF, now: LATER, bootstrapInput: fresh(), ...over });

atest('recovery: the writer targets wsf-control-state-2, which supersedes the base ref by name (never by configuration)', async () => {
  assert.equal(STATE_REF, 'wsf-control-state-2');
  assert.equal(predecessorRef('wsf-control-state'), null);
  assert.equal(predecessorRef('wsf-control-state-2'), 'wsf-control-state');
  assert.equal(predecessorRef('wsf-control-state-3'), 'wsf-control-state-2');
  assert.equal(predecessorRef('wsf-control-state-10'), 'wsf-control-state-9');
  for (const bad of ['wsf-control-state-1', 'wsf-control-state-02', 'main', 'wsf-control-state-2x']) assert.throws(() => predecessorRef(bad), /not a control-state ref/);
});

atest('recovery: a stale input is refused before any write; the old ref is unchanged and -2 is not created', async () => {
  const { remote, gh, baseSha } = await staleBase();
  const calls = { ...gh.calls };
  const r = await recover({ remote, gh, bootstrapInput: input() }); // the original input, 29 hours old
  assert.equal(r.outcome, 'refused'); assert.match(r.exception, /^bootstrap refused: bootstrap-stale: asOf 2026-09-26T17:00:00Z is older than 6 hours/);
  assert.equal(refSha(remote, STATE_REF), null, 'no recovery ref'); assert.equal(refSha(remote, BASE), baseSha, 'the audit ref did not move');
  assert.deepEqual(gh.calls, calls, 'no comment created or edited');
});

atest('recovery: a fresh input bootstraps -2 through the writer, names the superseded ledger, derives operational main, and reuses the App\'s comment', async () => {
  const { remote, gh, baseSha, baseEvents } = await staleBase();
  const created = gh.calls.created;
  const r = await recover({ remote, gh });
  assert.equal(r.outcome, 'written', r.exception); assert.equal(r.bootstrapped, true);
  assert.deepEqual(r.appended, ['bootstrap:MANUAL:bootstrap', 'set-shadow-surface:R-SHADOW-SURFACE:shadow-comment-801'], 'the predecessor\'s comment 801, not a new one');
  assert.equal(gh.calls.created, created, 'no competing shadow CURRENT comment');
  assert.equal(r.surface, 'edited', 'the comment the predecessor rendered is a stale head of the superseded ledger: edited in place');
  const lines = remoteEvents(remote, STATE_REF).split('\n').map((l) => JSON.parse(l));
  const base = reduce(`${baseEvents}\n`);
  assert.deepEqual(lines[0].supersedes, { ref: BASE, commit: baseSha, ledgerHead: base.ledgerHead });
  assert.equal(lines[0].canonical.operationalMain, RUNNING, 'operational main is the running commit');
  assert.equal(lines[0].asOf, fresh().bootstrap.asOf);
  assert.equal(refSha(remote, BASE), baseSha, 'the audit ref is never written');
  assert.equal(remoteEvents(remote), baseEvents);
  const body = gh.comments.get(801).body;
  assert.ok(body.startsWith(`<!-- wsf-control ledgerHead=${reduce(`${remoteEvents(remote, STATE_REF)}\n`).ledgerHead}`), 'the comment now renders the -2 ledger');
  assert.match(body, /Supersedes: `wsf-control-state` at commit/);
  const again = await recover({ remote, gh });
  assert.equal(again.outcome, 'unchanged'); assert.equal(again.surface, 'ok');
});

atest('recovery: the crash window (-2 pushed, comment still the predecessor\'s rendering) is repaired by the next run, not stuck as an exception', async () => {
  const { remote, gh } = await staleBase();
  const oldBody = gh.comments.get(801).body;
  await recover({ remote, gh });
  gh.comments.get(801).body = oldBody; // as if the edit had not happened
  const r = await recover({ remote, gh });
  assert.equal(r.outcome, 'unchanged'); assert.equal(r.surface, 'edited');
});

atest('recovery: a comment carrying a head of neither ledger stays an exception (never edited)', async () => {
  const { remote, gh } = await staleBase();
  await recover({ remote, gh });
  const forged = `<!-- wsf-control ledgerHead=${'e'.repeat(64)} events=1 rendered by tools/wsf-control/render-current.mjs; do not edit -->\nforged`;
  gh.comments.get(801).body = forged;
  const r = await recover({ remote, gh });
  assert.match(r.surface, /^exception: .*not a head of this ledger/); assert.equal(gh.comments.get(801).body, forged);
});

atest('recovery: a predecessor with any post-bootstrap program line has history and is never superseded', async () => {
  const { remote, gh, baseSha } = await staleBase();
  const block = (o) => `\`\`\`wsf-control-decision\n${JSON.stringify(o)}\n\`\`\``;
  await run({ remote, gh, controlInboxComments: [{ id: 950, ...OWNER, body: block({ type: 'review', packet: 'ALPHA', reviewers: ['W7'] }) }] });
  const withHistory = refSha(remote, BASE);
  assert.notEqual(withHistory, baseSha);
  const r = await recover({ remote, gh });
  assert.equal(r.outcome, 'refused');
  assert.match(r.exception, /^recovery-refused: wsf-control-state: the predecessor ledger has 1 post-bootstrap program line\(s\) \(first: seq 3 review\)/);
  assert.equal(refSha(remote, STATE_REF), null); assert.equal(refSha(remote, BASE), withHistory);
});

atest('recovery: a missing predecessor refuses (a recovery ref never starts a ledger from nothing)', async () => {
  const remote = bareRemote(); const gh = fakeGh();
  const r = await recover({ remote, gh });
  assert.equal(r.outcome, 'refused'); assert.equal(r.exception, 'recovery-refused: wsf-control-state-2 supersedes wsf-control-state, which does not exist');
  assert.equal(refSha(remote, STATE_REF), null); assert.equal(gh.calls.created, 0);
});

atest('recovery: once superseded, a predecessor that moved is no longer vouched for; its new heads stay an exception', async () => {
  const { remote, gh } = await staleBase();
  await recover({ remote, gh });
  // The base ref moves after it was superseded (nothing may do this; the test proves the writer does not trust it).
  const block = (o) => `\`\`\`wsf-control-decision\n${JSON.stringify(o)}\n\`\`\``;
  await run({ remote, gh: fakeGh(), controlInboxComments: [{ id: 970, ...OWNER, body: block({ type: 'review', packet: 'ALPHA', reviewers: ['W7'] }) }] });
  const moved = reduce(`${remoteEvents(remote)}\n`);
  const body = renderCurrent(moved);
  gh.comments.get(801).body = body; // a rendering of a head the superseded ledger never had when it was superseded
  const r = await recover({ remote, gh });
  assert.match(r.surface, /^exception: .*not a head of this ledger/); assert.equal(gh.comments.get(801).body, body);
});

for (const [n, f] of asyncTests) await runAsync(n, f);

// ---- pure units ---------------------------------------------------------------------------------------
test('a decision block may carry only its event\'s own fields; bootstrap, upgrades, the writer\'s surface and two blocks are refused', () => {
  const s = reduce(appendEvent('', { ...boot2() }, { expectHead: '0'.repeat(64) }).eventsText);
  const blk = (o) => `\`\`\`wsf-control-decision\n${JSON.stringify(o)}\n\`\`\``;
  const r = decisionIntake(s, [
    { id: 1, ...OWNER, body: blk({ type: 'queue', packet: 'ALPHA', owner: 'W3', completion: { terminal: 'INTEGRATED', proofType: 'source-only' }, actor: 'Fable' }) },
    { id: 2, ...OWNER, body: blk({ type: 'bootstrap' }) },
    { id: 3, ...OWNER, body: blk({ type: 'set-shadow-surface', pr: 365, commentId: 3 }) },
    { id: 4, ...OWNER, body: `${blk({ type: 'withdraw', packet: 'X1' })}\n${blk({ type: 'withdraw', packet: 'X2' })}` },
    { id: 5, ...OWNER, body: '```wsf-control-decision\nnot json\n```' },
    { id: 6, ...OWNER, body: 'prose only' },
  ]);
  assert.equal(r.events.length, 0);
  assert.deepEqual(r.refused.map((x) => x.commentId), [1, 2, 3, 4, 5]);
  assert.match(r.refused[0].reason, /actor, source, schema and authority are the writer's/);
  assert.equal(decisionBlock('prose only'), null);
});

test('derived facts ignore every decision-shaped finding: a subject change on a delivered PR records nothing', () => {
  const t = appendEvent('', bootstrapEvent(input(), RUNNING, { now: NOW }), { expectHead: '0'.repeat(64) });
  const facts = derivedFacts(t.state, { schemaVersion: 1, prs: { 12: { state: 'open', merged: false, headSha: B, changedSinceSubject: ['apps/wsf/x.ts'] } }, runs: {} });
  assert.deepEqual(facts.map((e) => e.type), ['reconcile-head'], 'the head is a fact; the subject change is a decision (subject-stale), not recorded');
});

test('writer pin: no pin, or a running commit whose writer paths differ from the pin, refuses', () => {
  const t = appendEvent('', bootstrapEvent(input(), RUNNING, { now: NOW }), { expectHead: '0'.repeat(64) }).state;
  assert.equal(writerPinProblem(t, RUNNING, () => false), null);
  assert.match(writerPinProblem(t, sha('7'), () => false), /differs from its pinned version/);
  assert.equal(writerPinProblem(t, sha('7'), () => true), null, 'a new commit with the identical writer tree is the pinned version');
  assert.match(writerPinProblem({ contracts: null }, RUNNING, () => true), /pins no writer version/);
});

test('the token reaches git only as a base64 header value in GIT_CONFIG_*, and redact removes token and header shapes', () => {
  const env = tokenGitEnv('ghs_abcdefghijklmnopqrstuvwxyz0123');
  assert.ok(!Object.values(env).some((v) => v.includes('ghs_')), 'no raw token in any value');
  assert.equal(redact('AUTHORIZATION: basic eHg6eXk= and ghs_abcdefghijklmnopqrstuvwxyz0123 and x-access-token:ghs_zzz'), 'AUTHORIZATION: basic [redacted] and [redacted] and x-access-token:[redacted]');
});

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
test('App JWT: RS256, issuer = App id, nine-minute window from a minute ago, verifiable with the public key', () => {
  const now = Date.parse('2026-09-27T18:00:00Z');
  const [h, b, s] = appJwt(5098407, privateKey, now).split('.');
  const body = JSON.parse(Buffer.from(b, 'base64url'));
  assert.deepEqual(body, { iat: now / 1000 - 60, exp: now / 1000 + 540, iss: '5098407' });
  assert.ok(crypto.createVerify('RSA-SHA256').update(`${h}.${b}`).verify(publicKey, Buffer.from(s, 'base64url')));
});

const asyncUnits = [];
asyncUnits.push(['the installation token is requested DOWN-SCOPED: this repository only, exactly the accepted Step-5 permissions (pull requests write for the PR-conversation shadow comment), never Actions write', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, body: init.body ? JSON.parse(init.body) : null });
    const json = url.endsWith('/app') ? { slug: 'wsf-control-writer' } : url.endsWith('/installation') ? { id: 77 } : { token: 'ghs_test', expires_at: '2026-09-27T19:00:00Z' };
    return { ok: true, status: 200, json: async () => json }; };
  const r = await installationToken({ appId: 5098407, privateKeyPem: privateKey, repo: 'idevinsimpson/goarrive', fetchImpl });
  assert.equal(r.slug, 'wsf-control-writer');
  const post = seen.find((x) => x.url.includes('/access_tokens'));
  // Pinned as a literal, not by the constant itself: the accepted Step-5 writer boundary. Pull requests write is kept
  // because the accepted A+ contract requires it; run 9's HTTP 403 (while the token held read) has an unproven cause
  // pending a successor live App run. Nothing wider, and never Actions write.
  const accepted = { contents: 'write', issues: 'write', pull_requests: 'write', actions: 'read', metadata: 'read' };
  assert.deepEqual(post.body, { repositories: ['goarrive'], permissions: accepted });
  assert.deepEqual({ ...STEP5_PERMISSIONS }, accepted);
  assert.equal(STEP5_PERMISSIONS.actions, 'read');
}]);
asyncUnits.push(['a missing or invalid key fails closed with a message that carries no key material', async () => {
  await assert.rejects(installationToken({ appId: 1, privateKeyPem: '', repo: 'a/b' }), (e) => e instanceof AppTokenError && /not available/.test(e.message));
  await assert.rejects(installationToken({ appId: 1, privateKeyPem: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----', repo: 'a/b' }), (e) => e instanceof AppTokenError && !/AAAA/.test(e.message));
}]);
for (const [n, f] of asyncUnits) await runAsync(n, f);

test('health: UNKNOWN without facts, DOWN when the writer is silent, DEGRADED when unpinned, OK only with fresh positive evidence; residuals always shown', () => {
  const s = appendEvent('', bootstrapEvent(input(), RUNNING, { now: NOW }), { expectHead: '0'.repeat(64) }).state;
  const now = '2026-09-27T18:00:00Z';
  const okRun = { id: 1, status: 'completed', conclusion: 'success', createdAt: '2026-09-27T17:40:00Z' };
  assert.equal(health(s, null).label, 'UNKNOWN');
  assert.equal(health(s, { now, writerRuns: [{ ...okRun, createdAt: '2026-09-27T15:00:00Z' }], tokenOk: true, writerPin: 'ok' }).label, 'DOWN');
  assert.equal(health(s, { now, writerRuns: [okRun], tokenOk: true, writerPin: 'unpinned' }).label, 'DEGRADED');
  const ok = health(s, { now, writerRuns: [okRun], tokenOk: true, writerPin: 'ok' });
  assert.equal(ok.label, 'OK');
  assert.equal(ok.lines.filter((l) => l.startsWith('RESIDUAL ')).length, 3);
});

test('freshness and journey verification are separate: FRESH, DEPLOYING, BLOCKED (known-good and rollback explicit), BEHIND (actionable), UNKNOWN', () => {
  const s = appendEvent('', bootstrapEvent(input(), RUNNING, { now: NOW }), { expectHead: '0'.repeat(64) }).state;
  assert.equal(freshness(s, { candidateSha: A, servedSha: A }).label, 'FRESH');
  assert.equal(freshness(s, { candidateSha: B, servedSha: A, activeRun: { id: 2, status: 'in_progress' } }).label, 'DEPLOYING');
  const blocked = freshness(s, { candidateSha: B, servedSha: A, lastRun: { id: 3, conclusion: 'failure' } });
  assert.equal(blocked.label, 'BLOCKED'); assert.ok(blocked.lines.some((l) => l.includes(`KNOWN_GOOD=${A}`) && l.includes('ROLLBACK=')));
  assert.ok(freshness(s, { candidateSha: B, servedSha: A }).lines.includes('ACTIONABLE=on reason=the candidate is not served and nothing is deploying'));
  assert.equal(freshness(s, null).label, 'UNKNOWN');
  assert.ok(freshness(s, { candidateSha: A, servedSha: A }).lines.includes('JOURNEY_VERIFICATION ALPHA=PENDING'), 'FRESH staging, journey still PENDING');
});

test('autonomy counts post-bootstrap lines toward the Step-5 exit, by authority class and rule, and says what it cannot measure', () => {
  const t = appendEvent('', bootstrapEvent(input(), RUNNING, { now: NOW }), { expectHead: '0'.repeat(64) });
  const a = autonomy(t.eventsText);
  assert.equal(a.real, 0);
  assert.ok(a.lines.includes('SHADOW_EXIT events=0/10 not met'));
  assert.ok(a.lines.some((l) => l.startsWith('PHASE_E ') && l.includes('not measured until Step 6')));
  assert.ok(SHADOW_PLACEHOLDER.startsWith('<!-- wsf-control shadow-current placeholder'));
});

test('the reconcile workflow keeps its five triggers, gates the writer job on the main ref first, and never gains pull_request_target', () => {
  const y = fs.readFileSync(fileURLToPath(new URL('../../../.github/workflows/wsf-control-reconcile.yml', import.meta.url)), 'utf8');
  const on = y.slice(y.indexOf('\non:\n') + 5, y.indexOf('\npermissions:'));
  assert.deepEqual([...on.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]).sort(),
    ['issue_comment', 'pull_request', 'schedule', 'workflow_dispatch', 'workflow_run']);
  assert.ok(!y.split('\n').some((l) => !/^\s*#/.test(l) && l.includes('pull_request_target')), 'pull_request_target outside a comment');
  const job = y.slice(y.indexOf('\n  reconcile:\n'));
  const cond = job.slice(job.indexOf('    if:'), job.indexOf('    runs-on:'));
  // The guard is the whole condition's first conjunct: not ORed, and not nested inside the issue_comment branch.
  assert.match(cond, /^ {4}if: >-\s+github\.ref == 'refs\/heads\/main' &&\s+\(/);
  assert.equal((cond.match(/refs\/heads\/main/g) ?? []).length, 1);
  assert.ok(cond.includes("github.event.comment.user.login != 'wsf-control-writer[bot]' &&"), 'the App-bot loop skip stays explicit (the owner gate also excludes it)');
  assert.match(job, /^ {4}environment: wsf-control-writer$/m);
  assert.match(job, /^ {10}ref: main$/m);
  assert.match(y, /^ {2}group: wsf-control-writer\n {2}cancel-in-progress: false$/m);
});

test('Check 71 F1: only login idevinsimpson with author_association OWNER decides; every other association, and a missing one, is refused', () => {
  const s = reduce(appendEvent('', { ...boot2() }, { expectHead: '0'.repeat(64) }).eventsText);
  const blk = (o) => `\`\`\`wsf-control-decision\n${JSON.stringify(o)}\n\`\`\``;
  const d = blk({ type: 'review', packet: 'ALPHA', reviewers: ['W7'] });
  assert.equal(decisionIntake(s, [{ id: 1, ...OWNER, body: d }]).events.length, 1);
  const bad = [
    ...['COLLABORATOR', 'MEMBER', 'CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR', 'FIRST_TIMER', 'NONE', 'owner', '', null].map((association) => ({ author: DECISION_OWNER, association })),
    { author: DECISION_OWNER }, { author: 'someone-else', association: 'OWNER' }, { author: 'IdevinSimpson', association: 'OWNER' }, { association: 'OWNER' }, {},
  ];
  // Every case carries valid, unedited timestamps, so the author gate alone refuses it (F1-R2a must not mask F1).
  const r = decisionIntake(s, bad.map((w, i) => ({ id: 10 + i, ...POSTED, ...w, body: d })));
  assert.equal(r.events.length, 0);
  assert.equal(r.refused.length, bad.length);
  assert.ok(r.refused.every((x) => /is not the repository owner|is not OWNER/.test(x.reason)), 'each refusal is the author gate, not the timestamps');
  assert.match(r.refused.find((x) => x.commentId === 10 + bad.findIndex((w) => !('association' in w))).reason, /author_association null is not OWNER/);
});

test('Check 71 F1-R2a: a decision needs both timestamps, present and identical; anything else fails closed', () => {
  const s = reduce(appendEvent('', { ...boot2() }, { expectHead: '0'.repeat(64) }).eventsText);
  const d = `\`\`\`wsf-control-decision\n${JSON.stringify({ type: 'review', packet: 'ALPHA', reviewers: ['W7'] })}\n\`\`\``;
  const who = { author: DECISION_OWNER, association: 'OWNER' };
  assert.equal(decisionIntake(s, [{ id: 1, ...who, ...POSTED, body: d }]).events.length, 1);
  const T = '2026-09-28T12:00:00Z';
  const cases = [
    [{}, /^comment-timestamps-missing: /], [{ createdAt: T }, /^comment-timestamps-missing: /], [{ updatedAt: T }, /^comment-timestamps-missing: /],
    [{ createdAt: null, updatedAt: null }, /^comment-timestamps-missing: /], [{ createdAt: '', updatedAt: '' }, /^comment-timestamps-missing: /],
    [{ createdAt: 0, updatedAt: 0 }, /^comment-timestamps-missing: /],
    [{ createdAt: T, updatedAt: '2026-09-28T12:00:01Z' }, /^edited-comment: /], [{ createdAt: T, updatedAt: '2026-09-29T00:00:00Z' }, /^edited-comment: /],
  ];
  const r = decisionIntake(s, cases.map(([ts], i) => ({ id: 10 + i, ...who, ...ts, body: d })));
  assert.equal(r.events.length, 0);
  assert.equal(r.refused.length, cases.length);
  cases.forEach(([, re], i) => assert.match(r.refused[i].reason, re, `case ${i}`));
  // The author gate still runs first: a non-owner's edited comment is refused as a non-owner.
  assert.match(decisionIntake(s, [{ id: 99, author: 'goarrive-maia', association: 'COLLABORATOR', createdAt: T, updatedAt: '2026-09-28T13:00:00Z', body: d }]).refused[0].reason, /is not the repository owner/);
});

/** The job condition evaluated for a context (GitHub's expression subset this `if` uses: ==, !=, &&, ||, contains, fromJSON). */
function jobIf(yml, ctx) {
  const job = yml.slice(yml.indexOf('\n  reconcile:\n'));
  const text = job.slice(job.indexOf('    if: >-') + '    if: >-'.length, job.indexOf('    runs-on:'));
  const expr = text.replace(/fromJSON\(/g, 'JSON.parse(').replace(/([!=])=/g, '$1==')
    .replace(/\bgithub\.([A-Za-z_.]+)/g, (_, p) => `g(${JSON.stringify(p)})`);
  const g = (p) => p.split('.').reduce((o, k) => (o == null ? null : o[k] ?? null), ctx);
  return Boolean(new Function('g', 'contains', `return (${expr});`)(g, (a, v) => a.includes(v)));
}

test('Check 71 F1: the workflow starts the writer job for an owner comment only; a non-owner is refused even with a valid block', () => {
  const y = fs.readFileSync(fileURLToPath(new URL('../../../.github/workflows/wsf-control-reconcile.yml', import.meta.url)), 'utf8');
  const main = 'refs/heads/main';
  const comment = (login, association, issue = 365, ref = main) => ({ ref, event_name: 'issue_comment', event: { issue: { number: issue }, comment: { user: { login }, author_association: association, body: '```wsf-control-decision\n{"type":"review","packet":"ALPHA","reviewers":["W7"]}\n```' } } });
  assert.equal(jobIf(y, comment('idevinsimpson', 'OWNER')), true);
  for (const [login, assoc] of [['external-user', 'NONE'], ['external-user', 'OWNER'], ['idevinsimpson', 'COLLABORATOR'], ['idevinsimpson', 'MEMBER'], ['idevinsimpson', 'CONTRIBUTOR'], ['idevinsimpson', undefined], ['wsf-control-writer[bot]', 'NONE'], [undefined, undefined]]) {
    assert.equal(jobIf(y, comment(login, assoc)), false, `${login}/${assoc} must not start the job`);
  }
  assert.equal(jobIf(y, comment('idevinsimpson', 'OWNER', 532)), false, 'outside the six control inboxes');
  assert.equal(jobIf(y, comment('idevinsimpson', 'OWNER', 365, 'refs/pull/532/merge')), false, 'the main-ref guard still holds');
  for (const e of ['schedule', 'workflow_dispatch', 'workflow_run']) assert.equal(jobIf(y, { ref: main, event_name: e, event: {} }), true, `${e} on main is unchanged`);
  assert.equal(jobIf(y, { ref: 'refs/pull/532/merge', event_name: 'pull_request', event: {} }), false);
  assert.equal(jobIf(y, { ref: main, event_name: 'pull_request', event: {} }), true, 'a pull_request event on main is unchanged');
});

test('Check 71 F1-R2a: an edited owner comment starts the writer job only when the owner is the editor', () => {
  const y = fs.readFileSync(fileURLToPath(new URL('../../../.github/workflows/wsf-control-reconcile.yml', import.meta.url)), 'utf8');
  const ev = (action, sender) => ({ ref: 'refs/heads/main', event_name: 'issue_comment', event: { action, sender: sender === undefined ? undefined : { login: sender }, issue: { number: 365 }, comment: { user: { login: 'idevinsimpson' }, author_association: 'OWNER' } } });
  assert.equal(jobIf(y, ev('created', 'idevinsimpson')), true);
  assert.equal(jobIf(y, ev('edited', 'idevinsimpson')), true, 'the owner editing their own comment may start the job (intake still refuses the edited block)');
  for (const sender of ['goarrive-maia', 'external-user', 'wsf-control-writer[bot]', null, undefined]) assert.equal(jobIf(y, ev('edited', sender)), false, `an edit by ${sender} must not start the job`);
  assert.match(y, /\(github\.event\.action != 'edited' \|\| github\.event\.sender\.login == 'idevinsimpson'\) &&/);
});

test('bootstrap input: fresh within six hours, never in the future, and operational main is derived, never imported', () => {
  const at = (iso, now) => { const i = input(); i.bootstrap.asOf = iso; return () => bootstrapEvent(i, RUNNING, { now }); };
  const t0 = Date.parse('2026-09-28T12:00:00Z');
  assert.equal(BOOTSTRAP_MAX_AGE_MS, 6 * 60 * 60 * 1000);
  assert.equal(at('2026-09-28T06:00:00Z', t0)().canonical.operationalMain, RUNNING, 'exactly six hours old is still fresh');
  assert.throws(at('2026-09-28T05:59:59Z', t0), /bootstrap-stale: asOf 2026-09-28T05:59:59Z is older than 6 hours/);
  assert.throws(at('2026-09-28T12:05:01Z', t0), /bootstrap-stale: asOf .* is in the future/);
  assert.doesNotThrow(at('2026-09-28T12:04:59Z', t0), 'within the clock-skew allowance');
  assert.throws(at('not a time', t0), /bootstrap-stale: the input carries no parseable asOf/);
  const withMain = input(); withMain.bootstrap.asOf = '2026-09-28T11:00:00Z'; withMain.bootstrap.canonical.operationalMain = B;
  assert.throws(() => bootstrapEvent(withMain, RUNNING, { now: t0 }), /canonical\.operationalMain is derived from the running commit/);
  const e = at('2026-09-28T11:00:00Z', t0)();
  assert.equal(Object.hasOwn(e, 'supersedes'), false, 'only a recovery bootstrap names a predecessor');
});

test('recoveryProblem: only a bootstrap plus the App\'s own set-shadow-surface is recoverable; anything else is history', () => {
  const t = appendEvent('', bootstrapEvent(input(), RUNNING, { now: NOW }), { expectHead: '0'.repeat(64) });
  assert.equal(recoveryProblem(t.eventsText, serialize(t.state)), null, 'a bare bootstrap');
  const u = appendEvent(t.eventsText, shadowSurfaceEvent(t.state, 801), { expectHead: t.state.ledgerHead });
  assert.equal(recoveryProblem(u.eventsText, serialize(u.state)), null, 'bootstrap + surface (run 50)');
  const blk = decisionIntake(u.state, [{ id: 960, ...OWNER, body: '```wsf-control-decision\n{"type":"review","packet":"ALPHA","reviewers":["W7"]}\n```' }]).events[0].event;
  const v = appendEvent(u.eventsText, blk, { expectHead: u.state.ledgerHead });
  assert.match(recoveryProblem(v.eventsText, serialize(v.state)), /1 post-bootstrap program line\(s\) \(first: seq 3 review\)/);
  assert.match(recoveryProblem(u.eventsText, '{}\n'), /does not check/);
  assert.equal(recoveryProblem('', ''), 'the predecessor ref holds no ledger');
});

test('run 50 (fixture: the audit ref wsf-control-state at 92c37447): recoverable, rendered byte for byte by this code, so its App comment is a stale head', () => {
  const dir = fileURLToPath(new URL('./fixtures/run50/', import.meta.url));
  const ev = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8');
  const st = fs.readFileSync(path.join(dir, 'state.json'), 'utf8');
  const cur = fs.readFileSync(path.join(dir, 'CURRENT.md'), 'utf8');
  const s = reduce(ev);
  assert.equal(s.ledgerHead, 'f48d256eeea36639d991d1391e82558141d50fbc5558333b0df9a345941ea1eb');
  assert.equal(s.asOf, '2026-09-27T17:12:00Z', 'the stale snapshot run 50 imported');
  assert.equal(s.canonical.operationalMain, 'ace92b0b82d32dc6a13c764fef02e809d218adb7');
  assert.equal(s.surfaces.shadow.commentId, 5878724949);
  assert.equal(recoveryProblem(ev, st), null, 'a bootstrap and the App\'s set-shadow-surface only');
  assert.equal(`${renderCurrent(s)}\n`, cur, 'a ledger without supersedes renders exactly as before');
  assert.equal(Object.hasOwn(s, 'supersedes'), false);
});

test('supersedes is a schema v2 bootstrap field only, and its shape is closed', () => {
  // Shape only: the ledger position fields (seq, prev, id) are append.mjs's to assign.
  const shape = (e) => validateEvent(e).filter((x) => !/^(seq|prev|id) /.test(x));
  const sup = { ref: 'wsf-control-state', commit: A, ledgerHead: 'f'.repeat(64) };
  assert.ok(shape({ ...boot(), supersedes: sup }).some((x) => /supersedes is a schema v2 field/.test(x)), 'never on a v1 line');
  const v2 = bootstrapEvent(input(), RUNNING, { now: NOW, supersedes: sup });
  assert.deepEqual(shape(v2), []);
  assert.equal(appendEvent('', v2, { expectHead: '0'.repeat(64) }).state.supersedes.ref, 'wsf-control-state');
  for (const bad of [{ ...sup, ref: 'main' }, { ...sup, ref: 'wsf-control-state-1' }, { ...sup, commit: 'abc' }, { ...sup, ledgerHead: A }, { ...sup, extra: 1 }]) {
    assert.ok(shape({ ...v2, supersedes: bad }).length > 0, JSON.stringify(bad));
  }
});

test('authorize-retry is recorded from the owner\'s unedited decision block only, with exactly its own fields (MANUAL)', () => {
  const s0 = reduce(appendEvent('', { ...boot2() }, { expectHead: '0'.repeat(64) }).eventsText);
  const blk = (o) => `\`\`\`wsf-control-decision\n${JSON.stringify(o)}\n\`\`\``;
  const d = { type: 'authorize-retry', packet: 'KIOSK', appSha: sha('e'), failedRun: 37012494776, repairPacket: 'FIX', repairSha: sha('f') };
  const ok = decisionIntake(s0, [{ id: 7001, ...OWNER, body: blk(d) }]);
  assert.equal(ok.events.length, 1);
  const e = ok.events[0].event;
  assert.deepEqual([e.type, e.packet, e.appSha, e.failedRun, e.repairPacket, e.repairSha, e.authority.rule, e.authority.class, e.source.kind, e.source.id],
    ['authorize-retry', 'KIOSK', sha('e'), 37012494776, 'FIX', sha('f'), 'MANUAL', 'manual', 'comment', 7001]);
  const r = decisionIntake(s0, [
    { id: 7002, author: 'someone-else', association: 'OWNER', ...POSTED, body: blk(d) },
    { id: 7003, ...OWNER, updatedAt: '2026-09-28T12:05:00Z', body: blk(d) },
    { id: 7004, ...OWNER, body: blk({ ...d, once: true }) },
    { id: 7005, ...OWNER, body: blk({ ...d, actor: 'Fable' }) },
  ]);
  assert.equal(r.events.length, 0);
  assert.deepEqual(r.refused.map((x) => x.commentId), [7002, 7003, 7004, 7005]);
});

// ---- STAGING-PROOF-RECONCILE-ROUTING-FIX (#365 5956001618; release 5956038540) ----------------------------------------

const asyncTests2 = [];
const HOSTED = { terminal: 'STAGED', proofType: 'hosted' };
/** The run-60 shape: KIOSK (hosted STAGED) integrated at E and targeted against the pin C; its run 59 failed. */
function proofLedger({ completion = HOSTED } = {}) {
  const add = (r, e) => appendEvent(r.eventsText, e, { expectHead: r.state?.ledgerHead ?? '0'.repeat(64) });
  let r = [boot2(), w2('queue', { packet: 'KIOSK', owner: 'W3', completion }), w2('release', { packet: 'KIOSK', inbox: 396 }), w2('ack', { packet: 'KIOSK', worker: 'W3' }),
    w2('deliver', { packet: 'KIOSK', pr: 553, subjectSha: A }), w2('review', { packet: 'KIOSK', reviewers: ['W7'] }), w2('review-pass', { packet: 'KIOSK', reviewer: 'W7' }),
    w2('accept', { packet: 'KIOSK', subjectSha: A })].reduce(add, { eventsText: '', state: null });
  r = add(r, w2('integrate', { packet: 'KIOSK', mergeSha: E, acceptance: JSON.parse(r.eventsText.trimEnd().split('\n').at(-1)).source.id }));
  return add(r, w2('set-target', { packet: 'KIOSK', appSha: E, pinSha: C }, { rule: 'R-FASTPATH', cls: 'derived', source: { kind: 'pull_request', id: 553, repo: REPO } }));
}
const RUN59 = 37012494776;
const RUN60 = 37025084843;
const deploy = (id, conclusion = 'success', status = 'completed', appSha = E) => ({ id, status, conclusion: status === 'completed' ? conclusion : null, title: targetTitle(appSha) });
const MARKER = `{"ok":true,"build":"${E.slice(0, 7)}"}`;

test('staging proof: the exact run-60 case records begin-proof, stage and proof-pass on the run, and the packet is STAGED', () => {
  const r = proofLedger();
  const d = stagingProofLines(r.state, { runs: [deploy(RUN60), deploy(RUN59, 'failure')], health: MARKER });
  assert.deepEqual(d.lines.map((l) => [l.type, l.authority.rule, l.source.kind, l.source.id, l.runId]), [
    ['begin-proof', 'R-FASTPATH', 'workflow_run', RUN60, RUN60], ['stage', 'R-FASTPATH', 'workflow_run', RUN60, RUN60], ['proof-pass', 'R-PROOF-PASS', 'workflow_run', RUN60, RUN60]]);
  assert.equal(d.lines[0].proofType, 'hosted');
  assert.equal(d.lines[1].servedSha, E);
  assert.deepEqual(d.lines[2].evidenceRef, { kind: 'workflow_run', id: RUN60 });
  assert.equal(d.report, `RECORDED target=${E} packet=KIOSK run=${RUN60} lines=begin-proof,stage,proof-pass`);
  const unordered = stagingProofLines(r.state, { runs: [deploy(RUN59, 'failure'), deploy(RUN60)], health: MARKER });
  assert.equal(unordered.report, d.report, 'newest is by run id, whatever order the listing came in');
  const ap = appendAll(r.eventsText, d.lines.map((event) => ({ event })));
  assert.deepEqual(ap.report.refused, []);
  assert.equal(ap.state.packets.KIOSK.phase, 'STAGED');
  assert.deepEqual(ap.state.packets.KIOSK.served, { runId: RUN60, servedSha: E });
  assert.equal(ap.state.packets.KIOSK.proof.result, 'PASS');
  assert.ok(checkTexts(ap.eventsText, serialize(ap.state)).ok);
  // Idempotent: the next run (the event after the fallback, or the fallback after the event) adds nothing.
  const again = stagingProofLines(ap.state, { runs: [deploy(RUN60)], health: MARKER });
  assert.deepEqual([again.lines.length, again.report], [0, `DONE target=${E} packet=KIOSK run=${RUN60}`]);
  assert.equal(appendAll(ap.eventsText, d.lines.map((event) => ({ event }))).report.appended.length, 0, 'replaying the same lines appends nothing');
});

test('staging proof resumes a partly recorded sequence from where it stopped, and never re-records a step', () => {
  const r = proofLedger();
  const full = stagingProofLines(r.state, { runs: [deploy(RUN60)], health: MARKER }).lines;
  const afterBegin = appendAll(r.eventsText, [{ event: full[0] }]);
  assert.equal(afterBegin.state.packets.KIOSK.phase, 'VERIFYING');
  const rest = stagingProofLines(afterBegin.state, { runs: [deploy(RUN60)], health: MARKER });
  assert.deepEqual(rest.lines.map((l) => l.type), ['stage', 'proof-pass']);
  const afterStage = appendAll(afterBegin.eventsText, [{ event: rest.lines[0] }]);
  assert.deepEqual(stagingProofLines(afterStage.state, { runs: [deploy(RUN60)], health: MARKER }).lines.map((l) => l.type), ['proof-pass']);
});

test('staging proof fails closed: failed, running, stale, wrong-target and wrong-marker runs record nothing, each with its reason', () => {
  const r = proofLedger();
  const cases = [
    [{ runs: [deploy(RUN59, 'failure')], health: MARKER }, /^NONE .*the newest deploy of the target, run 37012494776, ended failure; nothing is recorded/],
    [{ runs: [deploy(RUN60, 'cancelled')], health: MARKER }, /ended cancelled/],
    [{ runs: [deploy(RUN60 + 1, 'failure'), deploy(RUN60)], health: MARKER }, /run 37025084844, ended failure/],
    [{ runs: [deploy(RUN60, null, 'in_progress')], health: MARKER }, /^WAITING .*run 37025084843 is in_progress/],
    [{ runs: [deploy(RUN60, null, 'queued')], health: MARKER }, /^WAITING .*is queued/],
    [{ runs: [deploy(RUN60, 'success', 'completed', F)], health: MARKER }, /^WAITING .*no deploy of the target among the recent staging runs/],
    [{ runs: [{ ...deploy(RUN60), title: 'WSF staging · mode=deploy' }], health: MARKER }, /no deploy of the target/],
    [{ runs: [], health: MARKER }, /no deploy of the target/],
    [{ runs: null, health: MARKER }, /^UNKNOWN .*could not be read/],
    [{ runs: [deploy(RUN60)], health: `{"build":"${F.slice(0, 7)}"}` }, /^NONE .*the hosted marker does not name the target; run 37025084843 is not recorded as served/],
    [{ runs: [deploy(RUN60)], health: null }, /the hosted marker could not be read/],
    // W4 #394 5956405530: the realistic wrong marker after a success is staging still serving the previous build.
    [{ runs: [deploy(RUN60)], health: `{"build":"${r.state.staging.servedSha.slice(0, 7)}"}` }, /the hosted marker does not name the target; run 37025084843 is not recorded as served/],
    [{ runs: [deploy(RUN60)], health: `{"build":"${r.state.staging.rollbackSha.slice(0, 7)}"}` }, /the hosted marker does not name the target; run 37025084843 is not recorded as served/],
  ];
  assert.deepEqual([r.state.staging.servedSha, r.state.staging.rollbackSha].map((x) => x === E), [false, false], 'the pointer and the rollback are not the target');
  for (const [facts, re] of cases) {
    const d = stagingProofLines(r.state, facts);
    assert.deepEqual(d.lines, [], String(re)); assert.match(d.report, re);
  }
  assert.deepEqual([stagingProofLines({ ...r.state, stagingTarget: undefined }, { runs: [deploy(RUN60)], health: MARKER }).report], ['NONE reason=the ledger holds no staging target']);
});

test('staging proof only for a hosted STAGED work packet at the target\'s merge, INTEGRATED or proving that same run', () => {
  const src = proofLedger({ completion: SOURCE_ONLY });
  assert.match(stagingProofLines(src.state, { runs: [deploy(RUN60)], health: MARKER }).report, /completes at INTEGRATED with a source-only proof, not a hosted STAGED proof/);
  const r = proofLedger();
  const s = r.state;
  const drift = { ...s, packets: { ...s.packets, KIOSK: { ...s.packets.KIOSK, artifact: { ...s.packets.KIOSK.artifact, mergeSha: F } } } };
  assert.match(stagingProofLines(drift, { runs: [deploy(RUN60)], health: MARKER }).report, /the target is not the packet's integrated merge/);
  assert.match(stagingProofLines({ ...s, packets: { ...s.packets, KIOSK: { ...s.packets.KIOSK, kind: 'reference' } } }, { runs: [deploy(RUN60)], health: MARKER }).report, /not the packet's integrated merge/);
  assert.match(stagingProofLines({ ...s, packets: { ...s.packets, KIOSK: { ...s.packets.KIOSK, phase: 'CHANGES_REQUESTED' } } }, { runs: [deploy(RUN60)], health: MARKER }).report, /the packet is CHANGES_REQUESTED/);
  // Already proving an OLDER run: the newer success is not silently swapped in.
  const proving = appendAll(r.eventsText, [{ event: w2('begin-proof', { packet: 'KIOSK', runId: RUN59, proofType: 'hosted' }) }]);
  assert.equal(proving.state.packets.KIOSK.phase, 'VERIFYING');
  assert.match(stagingProofLines(proving.state, { runs: [deploy(RUN60), deploy(RUN59, 'failure')], health: MARKER }).report, /^HELD .*the proof in progress is run 37012494776, not the newest successful deploy run 37025084843/);
});

test('the writer report carries the staging-proof line', () => {
  assert.ok(formatReport({ outcome: 'written', appended: [], refused: [], intakeRefused: [], stagingProof: `RECORDED target=${E} packet=KIOSK run=1 lines=proof-pass` }).includes(`STAGING_PROOF RECORDED target=${E} packet=KIOSK run=1 lines=proof-pass`));
});

// The writer run itself, with no workflow_run event (the scheduled fallback): it reads the runs and the marker and records
// the sequence; the next run, of any trigger, adds nothing.
asyncTests2.push(['staging proof, end to end: a scheduled run after a missed workflow_run wake records the run-60 sequence once', async () => {
  const remote = bareRemote();
  // Seed the remote with the run-60 ledger (target set, run 59 failed), writer pins at the running commit.
  const seed = (() => {
    const r = proofLedger();
    const pin = w2('set-contracts', { contracts: [{ id: 'writer', path: 'tools/wsf-control', commit: RUNNING }, { id: 'writer-workflow', path: '.github/workflows/wsf-control-reconcile.yml', commit: RUNNING }] });
    return appendEvent(r.eventsText, pin, { expectHead: r.state.ledgerHead });
  })();
  const d = tmp();
  git(d, 'init', '-q');
  fs.writeFileSync(path.join(d, 'events.jsonl'), seed.eventsText);
  fs.writeFileSync(path.join(d, 'state.json'), serialize(seed.state));
  fs.writeFileSync(path.join(d, 'CURRENT.md'), `${renderCurrent(seed.state)}\n`);
  git(d, 'add', '.');
  git(d, '-c', `user.name=${AUTHOR.name}`, '-c', `user.email=${AUTHOR.email}`, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'seed');
  git(d, 'push', '-q', remote, `HEAD:refs/heads/${BASE}`);
  const gh = {
    ...fakeGh(),
    async pull() { return null; },
    async descends() { return true; },
    async fileText() { return JSON.stringify({ project: 'westayfit-staging', approvedAppSha: C }); },
    async treeSha() { return 'f'.repeat(40); },
    async workflowRuns() { return [deploy(RUN60), deploy(RUN59, 'failure')]; },
  };
  const go = () => runShadow({ remote, route: true, ref: BASE, now: NOW, author: AUTHOR, runningSha: RUNNING, sameTree: () => true, bootstrapInput: input(), workdir: tmp(),
    controlInboxComments: [], botLogin: BOT, readInbox: async () => [], stagingHealth: async () => MARKER, gh });
  // A failed read records nothing and says why; routing is not stopped.
  const down = await runShadow({ remote, route: true, ref: BASE, now: NOW, author: AUTHOR, runningSha: RUNNING, sameTree: () => true, bootstrapInput: input(), workdir: tmp(),
    controlInboxComments: [], botLogin: BOT, readInbox: async () => [], stagingHealth: async () => MARKER,
    gh: { ...gh, async workflowRuns() { throw Object.assign(new Error('x'), { status: 502 }); } } });
  assert.match(down.stagingProof, /^UNKNOWN reason=staging reads failed \(HTTP 502\); nothing recorded$/);
  assert.deepEqual(down.appended.filter((x) => /begin-proof|stage|proof-pass/.test(x)), []);
  const r = await go();
  assert.deepEqual(r.appended.filter((x) => /begin-proof|stage|proof-pass/.test(x)), [`begin-proof:R-FASTPATH:run-${RUN60}`, `stage:R-FASTPATH:run-${RUN60}`, `proof-pass:R-PROOF-PASS:run-${RUN60}`]);
  assert.equal(r.stagingProof, `RECORDED target=${E} packet=KIOSK run=${RUN60} lines=begin-proof,stage,proof-pass`);
  assert.ok(formatReport(r).includes(`STAGING_PROOF RECORDED target=${E} packet=KIOSK run=${RUN60}`));
  const after = reduce(`${git(d, '--git-dir', remote, 'show', `refs/heads/${BASE}:events.jsonl`)}\n`);
  assert.equal(after.packets.KIOSK.phase, 'STAGED');
  assert.equal(after.staging.servedSha, seed.state.staging.servedSha, 'the staging pointer is not written (no derived rule carries set-staging)');
  const again = await go();
  assert.deepEqual(again.appended.filter((x) => /begin-proof|stage|proof-pass/.test(x)), []);
  assert.equal(again.stagingProof, `DONE target=${E} packet=KIOSK run=${RUN60}`);
}]);
for (const [n, f] of asyncTests2) await runAsync(n, f);

done('shadow');
