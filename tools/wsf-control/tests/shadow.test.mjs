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
import { MAX_ATTEMPTS, bootstrapEvent, formatReport, runShadow, writerPinProblem } from '../shadow-run.mjs';
import { DECISION_OWNER, decisionBlock, decisionIntake, derivedFacts, SHADOW_PLACEHOLDER } from '../shadow.mjs';
import { redact, tokenGitEnv, STATE_REF } from '../gitstate.mjs';
import { gitHubClient } from '../github.mjs';
import { STEP5_PERMISSIONS, appJwt, installationToken, AppTokenError } from '../app-token.mjs';
import { health } from '../health-view.mjs';
import { freshness } from '../freshness-view.mjs';
import { autonomy } from '../autonomy-view.mjs';
import { checkTexts } from '../check.mjs';
import { reduce } from '../reduce.mjs';
import { appendEvent } from '../append.mjs';
import { A, B, C, D, E, F, REPO, atest as runAsync, boot2, done, sha, test } from './helpers.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-shadow-'));
const git = (cwd, ...args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
const RUNNING = sha('9');
const AUTHOR = { name: 'wsf-control-writer[bot]', email: '5098407+wsf-control-writer[bot]@users.noreply.github.com' };
const BOT = 'wsf-control-writer[bot]';
const OWNER = { author: 'idevinsimpson', association: 'OWNER' };

/** The bootstrap input as the reviewed file carries it: one work packet delivered on PR 12. */
function input() {
  const b = boot2();
  const { schema, type, actor, source, authority, ...fields } = b;
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
const run = (over) => runShadow({ author: AUTHOR, runningSha: RUNNING, sameTree: () => true, bootstrapInput: input(), workdir: tmp(), controlInboxComments: [], botLogin: BOT, ...over });
const remoteEvents = (remote) => git(os.tmpdir(), '--git-dir', remote, 'show', `refs/heads/${STATE_REF}:events.jsonl`);

const asyncTests = [];
const atest = (name, fn) => asyncTests.push([name, fn]);

atest('first run bootstraps the absent ref once as the App, records its own shadow comment, then renders into it', async () => {
  const remote = bareRemote(); const gh = fakeGh();
  const r = await run({ remote, gh });
  assert.equal(r.outcome, 'written'); assert.equal(r.bootstrapped, true); assert.equal(r.attempts, 1);
  assert.deepEqual(r.appended, ['bootstrap:MANUAL:bootstrap', 'set-shadow-surface:R-SHADOW-SURFACE:shadow-comment-801']);
  assert.equal(gh.calls.created, 1); assert.equal(r.surface, 'edited');
  const log = git(os.tmpdir(), '--git-dir', remote, 'log', '--format=%an <%ae>|%cn', `refs/heads/${STATE_REF}`);
  assert.equal(log, `${AUTHOR.name} <${AUTHOR.email}>|${AUTHOR.name}`, 'the state commit is authored and committed as the App bot');
  const text = remoteEvents(remote) + '\n';
  assert.equal(reduce(text).surfaces.shadow.commentId, 801);
  assert.match(gh.comments.get(801).body, /^<!-- wsf-control ledgerHead=/);
  assert.ok(checkTexts(text, git(os.tmpdir(), '--git-dir', remote, 'show', `refs/heads/${STATE_REF}:state.json`) + '\n').ok);
});

atest('a second run with nothing new writes nothing, creates no comment and leaves the surface ok; the bootstrap is never re-run', async () => {
  const remote = bareRemote(); const gh = fakeGh();
  await run({ remote, gh });
  const before = git(os.tmpdir(), '--git-dir', remote, 'rev-parse', `refs/heads/${STATE_REF}`);
  const r = await run({ remote, gh });
  assert.equal(r.outcome, 'unchanged'); assert.equal(r.bootstrapped, false); assert.equal(r.surface, 'ok'); assert.equal(gh.calls.created, 1);
  assert.equal(git(os.tmpdir(), '--git-dir', remote, 'rev-parse', `refs/heads/${STATE_REF}`), before, 'the ref did not move');
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
  assert.ok(checkTexts(`${remoteEvents(remote)}\n`, `${git(os.tmpdir(), '--git-dir', remote, 'show', `refs/heads/${STATE_REF}:state.json`)}\n`).ok, 'the ledger is one valid chain, never merged');
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
  const before = git(os.tmpdir(), '--git-dir', remote, 'rev-parse', `refs/heads/${STATE_REF}`);
  gh.setHead(E);
  const r = await run({ remote, gh, runningSha: sha('8'), sameTree: () => false });
  assert.equal(r.outcome, 'refused'); assert.match(r.exception, /writer-code-unpinned/);
  assert.equal(git(os.tmpdir(), '--git-dir', remote, 'rev-parse', `refs/heads/${STATE_REF}`), before);
});

atest('an invalid remote ledger stops the run before any write (CONTROL_STATE=invalid), and the surface is not touched', async () => {
  const remote = bareRemote(); const gh = fakeGh();
  await run({ remote, gh });
  const w = tmp();
  git(w, 'clone', '-q', '-b', STATE_REF, remote, '.');
  fs.appendFileSync(path.join(w, 'events.jsonl'), '{"not":"an event"}\n');
  git(w, '-c', 'user.name=x', '-c', 'user.email=x@example.invalid', 'commit', '-qam', 'corrupt');
  git(w, 'push', '-q', 'origin', `HEAD:refs/heads/${STATE_REF}`);
  const edits = gh.calls.edited;
  const r = await run({ remote, gh });
  assert.equal(r.outcome, 'refused'); assert.match(r.exception, /CONTROL_STATE=invalid/); assert.equal(gh.calls.edited, edits);
});

atest('decision intake: one fenced block in the control inbox becomes a MANUAL line on that comment; the writer\'s own comments are never read as decisions', async () => {
  const remote = bareRemote(); const gh = fakeGh();
  await run({ remote, gh });
  const block = (o) => `L0 decision.\n\n\`\`\`wsf-control-decision\n${JSON.stringify(o)}\n\`\`\``;
  const comments = [
    { id: 901, author: 'idevinsimpson', association: 'OWNER', body: block({ type: 'review', packet: 'ALPHA', reviewers: ['W7'] }) },
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
  const contracts = [{ id: 'writer', path: 'tools/wsf-control', sha: sha('7') }];
  const comments = [
    { id: 911, author: 'external-user', association: 'NONE', body: block({ type: 'review', packet: 'ALPHA', reviewers: ['W7'] }) },
    { id: 912, author: 'external-user', association: 'NONE', body: block({ type: 'set-contracts', contracts }) },
    { id: 913, author: 'external-user', association: 'OWNER', body: block({ type: 'review', packet: 'ALPHA', reviewers: ['W7'] }) },
    { id: 914, author: DECISION_OWNER, association: 'COLLABORATOR', body: block({ type: 'set-contracts', contracts }) },
  ];
  const r = await run({ remote, gh, controlInboxComments: comments });
  assert.equal(r.outcome, 'unchanged'); assert.deepEqual(r.appended, []);
  assert.deepEqual(r.intakeRefused.map((x) => x.commentId), [911, 912, 913, 914]);
  assert.match(r.intakeRefused[0].reason, /"external-user" is not the repository owner/);
  assert.match(r.intakeRefused[3].reason, /author_association "COLLABORATOR" is not OWNER/);
  assert.ok(formatReport(r).includes('INTAKE_REFUSED comment=912 :: author "external-user" is not the repository owner'));
  assert.equal(remoteEvents(remote), before, 'no ledger mutation');
  assert.equal(pins(), contractsBefore, 'the writer and workflow pins did not move');
});

atest('Check 71 F1: the comment-reading path carries each author\'s login and author_association, and a missing one as null', async () => {
  const raw = [
    { id: 1, body: 'a', user: { login: 'idevinsimpson' }, author_association: 'OWNER' },
    { id: 2, body: 'b', user: { login: 'external-user' }, author_association: 'NONE' },
    { id: 3, body: 'c', user: null },
  ];
  const fetchImpl = async (url) => ({ ok: true, status: 200, json: async () => (url.includes('/issues/comments/') ? raw[0] : raw) });
  const gh = gitHubClient({ token: 't', repo: REPO, fetchImpl });
  assert.deepEqual(await gh.recentComments(365), [
    { id: 1, body: 'a', author: 'idevinsimpson', association: 'OWNER' },
    { id: 2, body: 'b', author: 'external-user', association: 'NONE' },
    { id: 3, body: 'c', author: null, association: null },
  ]);
  assert.deepEqual(await gh.comment(1), { id: 1, body: 'a', author: 'idevinsimpson', association: 'OWNER' });
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
  const t = appendEvent('', bootstrapEvent(input(), RUNNING), { expectHead: '0'.repeat(64) });
  const facts = derivedFacts(t.state, { schemaVersion: 1, prs: { 12: { state: 'open', merged: false, headSha: B, changedSinceSubject: ['apps/wsf/x.ts'] } }, runs: {} });
  assert.deepEqual(facts.map((e) => e.type), ['reconcile-head'], 'the head is a fact; the subject change is a decision (subject-stale), not recorded');
});

test('writer pin: no pin, or a running commit whose writer paths differ from the pin, refuses', () => {
  const t = appendEvent('', bootstrapEvent(input(), RUNNING), { expectHead: '0'.repeat(64) }).state;
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
asyncUnits.push(['the installation token is requested DOWN-SCOPED: this repository only, Step-5 permissions, never Actions write', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, body: init.body ? JSON.parse(init.body) : null });
    const json = url.endsWith('/app') ? { slug: 'wsf-control-writer' } : url.endsWith('/installation') ? { id: 77 } : { token: 'ghs_test', expires_at: '2026-09-27T19:00:00Z' };
    return { ok: true, status: 200, json: async () => json }; };
  const r = await installationToken({ appId: 5098407, privateKeyPem: privateKey, repo: 'idevinsimpson/goarrive', fetchImpl });
  assert.equal(r.slug, 'wsf-control-writer');
  const post = seen.find((x) => x.url.includes('/access_tokens'));
  assert.deepEqual(post.body, { repositories: ['goarrive'], permissions: STEP5_PERMISSIONS });
  assert.equal(STEP5_PERMISSIONS.actions, 'read');
}]);
asyncUnits.push(['a missing or invalid key fails closed with a message that carries no key material', async () => {
  await assert.rejects(installationToken({ appId: 1, privateKeyPem: '', repo: 'a/b' }), (e) => e instanceof AppTokenError && /not available/.test(e.message));
  await assert.rejects(installationToken({ appId: 1, privateKeyPem: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----', repo: 'a/b' }), (e) => e instanceof AppTokenError && !/AAAA/.test(e.message));
}]);
for (const [n, f] of asyncUnits) await runAsync(n, f);

test('health: UNKNOWN without facts, DOWN when the writer is silent, DEGRADED when unpinned, OK only with fresh positive evidence; residuals always shown', () => {
  const s = appendEvent('', bootstrapEvent(input(), RUNNING), { expectHead: '0'.repeat(64) }).state;
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
  const s = appendEvent('', bootstrapEvent(input(), RUNNING), { expectHead: '0'.repeat(64) }).state;
  assert.equal(freshness(s, { candidateSha: A, servedSha: A }).label, 'FRESH');
  assert.equal(freshness(s, { candidateSha: B, servedSha: A, activeRun: { id: 2, status: 'in_progress' } }).label, 'DEPLOYING');
  const blocked = freshness(s, { candidateSha: B, servedSha: A, lastRun: { id: 3, conclusion: 'failure' } });
  assert.equal(blocked.label, 'BLOCKED'); assert.ok(blocked.lines.some((l) => l.includes(`KNOWN_GOOD=${A}`) && l.includes('ROLLBACK=')));
  assert.ok(freshness(s, { candidateSha: B, servedSha: A }).lines.includes('ACTIONABLE=on reason=the candidate is not served and nothing is deploying'));
  assert.equal(freshness(s, null).label, 'UNKNOWN');
  assert.ok(freshness(s, { candidateSha: A, servedSha: A }).lines.includes('JOURNEY_VERIFICATION ALPHA=PENDING'), 'FRESH staging, journey still PENDING');
});

test('autonomy counts post-bootstrap lines toward the Step-5 exit, by authority class and rule, and says what it cannot measure', () => {
  const t = appendEvent('', bootstrapEvent(input(), RUNNING), { expectHead: '0'.repeat(64) });
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
  const r = decisionIntake(s, bad.map((w, i) => ({ id: 10 + i, ...w, body: d })));
  assert.equal(r.events.length, 0);
  assert.equal(r.refused.length, bad.length);
  assert.match(r.refused.find((x) => x.commentId === 10 + bad.findIndex((w) => !('association' in w))).reason, /author_association null is not OWNER/);
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

done('shadow');
