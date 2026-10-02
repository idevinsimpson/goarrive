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
import { shadowSurfaceEvent, DECISION_OWNER, decisionBlock, decisionIntake, derivedFacts, SHADOW_PLACEHOLDER } from '../shadow.mjs';
import { redact, tokenGitEnv, STATE_REF, predecessorRef } from '../gitstate.mjs';
import { gitHubClient } from '../github.mjs';
import { STEP5_PERMISSIONS, appJwt, installationToken, AppTokenError } from '../app-token.mjs';
import { health } from '../health-view.mjs';
import { freshness } from '../freshness-view.mjs';
import { autonomy } from '../autonomy-view.mjs';
import { checkTexts } from '../check.mjs';
import { renderCurrent } from '../render-current.mjs';
import { reduce, serialize } from '../reduce.mjs';
import { appendEvent } from '../append.mjs';
import { A, B, C, D, E, F, REPO, atest as runAsync, boot, boot2, done, sha, test } from './helpers.mjs';
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
  const fetchImpl = async (url) => ({ ok: true, status: 200, json: async () => (url.includes('/issues/comments/') ? raw[0] : raw) });
  const gh = gitHubClient({ token: 't', repo: REPO, fetchImpl });
  assert.deepEqual(await gh.recentComments(365), [
    { id: 1, body: 'a', author: 'idevinsimpson', association: 'OWNER', createdAt: '2026-09-28T12:00:00Z', updatedAt: '2026-09-28T12:00:00Z' },
    { id: 2, body: 'b', author: 'external-user', association: 'NONE', createdAt: '2026-09-28T12:00:00Z', updatedAt: '2026-09-28T12:07:00Z' },
    { id: 3, body: 'c', author: null, association: null, createdAt: null, updatedAt: null },
  ]);
  assert.deepEqual(await gh.comment(1), { id: 1, body: 'a', author: 'idevinsimpson', association: 'OWNER', createdAt: '2026-09-28T12:00:00Z', updatedAt: '2026-09-28T12:00:00Z' });
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

done('shadow');
