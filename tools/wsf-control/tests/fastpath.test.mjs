/** Step 7 (STAGING-FRESHNESS-FASTPATH): preview eligibility, the §9.3 invariants, the ledger target and the writer's decision. */
import assert from 'node:assert/strict';
import { appendEvent } from '../append.mjs';
import { checkTexts } from '../check.mjs';
import { serialize } from '../reduce.mjs';
import { renderCurrent } from '../render-current.mjs';
import fs from 'node:fs';
import { DEPLOY_TITLE, MEMBER_VISIBLE, PROTECTED_PREFIXES, STAGING_URL, STAGING_WORKFLOW, fastPathReasons, freshnessFacts, integrations, previewEligible, protectedPath, servedOf, targetDecision } from '../fastpath.mjs';
import { PROTECTED_PATHS } from '../../../.github/wsf-staging/pin-candidate.mjs';
import { A, B, C, D, E, F, GENESIS, SOURCE_ONLY, atest, boot2, done, refused, test, w2 } from './helpers.mjs';
import { fastpathReads } from '../router-run.mjs';
import { gitHubClient } from '../github.mjs';

const add = (r, e) => appendEvent(r.eventsText, e, { expectHead: r.state?.ledgerHead ?? GENESIS });
const build = (...events) => events.reduce(add, { eventsText: '', state: null });
const UI = ['apps/westayfit/app/(tabs)/index.tsx', 'apps/westayfit/components/Card.tsx'];

/** ALPHA integrated at merge E on PR 12; staging serves the pin C (boot2's set-staging). */
function integrated(merge = E, packet = 'ALPHA', pr = 12, base = null) {
  const r0 = base ?? build(boot2());
  return [
    w2('queue', { packet, owner: 'W3', completion: SOURCE_ONLY }), w2('release', { packet, inbox: 396 }), w2('ack', { packet, worker: 'W3' }),
    w2('deliver', { packet, pr, subjectSha: A }), w2('review', { packet, reviewers: ['W7'] }), w2('review-pass', { packet, reviewer: 'W7' }), w2('accept', { packet, subjectSha: A }),
    w2('integrate', { packet, mergeSha: merge, acceptance: 0 }),
  ].reduce((r, e) => {
    if (e.type === 'integrate') e.acceptance = JSON.parse(r.eventsText.trimEnd().split('\n').at(-1)).source.id;
    return add(r, e);
  }, r0);
}

test('preview eligibility: only a merge that changes apps/westayfit/** is member-visible', () => {
  assert.equal(previewEligible(UI), true);
  assert.equal(previewEligible(['docs/x.md', 'tools/wsf-control/router.mjs', '.github/wsf-staging/a.mjs']), false);
  assert.equal(previewEligible([]), false);
  assert.equal(previewEligible(null), false, 'an unread diff is never eligible');
});

test('the protected set covers every PROTECTED_PATHS entry of the pin generator, and the §9.3 names anywhere', () => {
  for (const x of PROTECTED_PATHS) {
    assert.ok(PROTECTED_PREFIXES.includes(x), `${x} is missing from the writer's list`);
    assert.equal(protectedPath(x.endsWith('/') ? `${x}a/b.ts` : x), true, x);
  }
  for (const p of ['apps/westayfit/app.config.ts', 'apps/westayfit/package-lock.json', 'apps/westayfit/yarn.lock', 'apps/westayfit/firebase.extra.json', 'apps/westayfit/storage.rules', 'apps/westayfit/sub/firestore.indexes.json']) {
    assert.equal(protectedPath(p), true, p);
  }
  for (const p of UI) assert.equal(protectedPath(p), false, p);
  assert.equal(MEMBER_VISIBLE, 'apps/westayfit/');
});

test('§9.3: descends from the pin, a complete non-empty diff, member-visible only, no protected path; each failure is a reason', () => {
  const T = 'f'.repeat(40);
  const ok = { pinSha: C, candidateSha: E, descends: true, paths: UI, functionsTree: { pin: T, candidate: T } };
  assert.deepEqual(fastPathReasons(ok), []);
  assert.match(fastPathReasons({ ...ok, functionsTree: { pin: T, candidate: '1'.repeat(40) } }).join(), /the functions-westayfit tree changed \(ffffffff → 11111111\)/);
  assert.match(fastPathReasons({ ...ok, functionsTree: { pin: T, candidate: '' } }).join(), /tree changed \(ffffffff → absent\)/);
  assert.match(fastPathReasons({ ...ok, functionsTree: { pin: T, candidate: null } }).join(), /tree could not be compared/);
  assert.match(fastPathReasons({ ...ok, functionsTree: undefined }).join(), /tree could not be compared/);
  assert.match(fastPathReasons({ ...ok, descends: false }).join(), /does not descend from the pin/);
  assert.match(fastPathReasons({ ...ok, descends: null }).join(), /could not be read/);
  assert.match(fastPathReasons({ ...ok, paths: null }).join(), /could not be read in full/);
  assert.match(fastPathReasons({ ...ok, paths: [] }).join(), /is empty/);
  assert.match(fastPathReasons({ ...ok, paths: [...UI, 'docs/a.md'] }).join(), /paths outside apps\/westayfit\/ changed: docs\/a\.md/);
  assert.match(fastPathReasons({ ...ok, paths: [...UI, 'functions-westayfit/src/index.ts'] }).join(), /protected paths changed: functions-westayfit/);
  assert.match(fastPathReasons({ ...ok, paths: [...UI, 'apps/westayfit/app.json'] }).join(), /protected paths changed: apps\/westayfit\/app\.json/);
});

test('set-target: only an INTEGRATED work packet\'s own merge, never the pin, never the same target twice; CURRENT says so only when set', () => {
  const r = integrated();
  const before = renderCurrent(r.state);
  assert.equal(before.includes('Staging target'), false, 'a ledger without a target renders as before');
  const t = w2('set-target', { packet: 'ALPHA', appSha: E, pinSha: C }, { rule: 'R-FASTPATH', cls: 'derived', source: { kind: 'pull_request', id: 12, repo: 'example-org/example-repo' } });
  const r1 = add(r, t);
  assert.deepEqual(r1.state.stagingTarget, { packet: 'ALPHA', appSha: E, pinSha: C });
  assert.deepEqual(r1.state.packets.ALPHA.authority.lastTransition, r.state.packets.ALPHA.authority.lastTransition, 'the target is not a packet transition');
  assert.ok(checkTexts(r1.eventsText, serialize(r1.state)).ok);
  assert.ok(renderCurrent(r1.state).includes(`Staging target (fast path): \`${E}\` (ALPHA), checked against the full-path pin \`${C}\``));
  assert.equal(add(r1, { ...t }).eventsText, r1.eventsText, 'the identical line again is an idempotent no-op');
  refused(() => add(r1, w2('set-target', { packet: 'ALPHA', appSha: E, pinSha: C })), /already the staging target/);
  refused(() => add(r, w2('set-target', { packet: 'ALPHA', appSha: F, pinSha: C })), /is not ALPHA's merge/);
  refused(() => add(r, w2('set-target', { packet: 'ALPHA', appSha: E, pinSha: E })), /the target is the full-path pin itself/);
  const notYet = build(boot2(), w2('queue', { packet: 'BETA', owner: 'W3', completion: SOURCE_ONLY }));
  refused(() => add(notYet, w2('set-target', { packet: 'BETA', appSha: E, pinSha: C })), /only an INTEGRATED packet's merge/);
});

test('integrations: newest first, INTEGRATED work packets with a PR and a merge only', () => {
  const r = integrated(F, 'BETA', 13, integrated(E, 'ALPHA', 12));
  assert.deepEqual(integrations(r.state, r.eventsText).map((x) => [x.packet, x.mergeSha, x.pr]), [['BETA', F, 13], ['ALPHA', E, 12]]);
});

test('targetDecision: every reason it does not target is closed and named; the target line is R-FASTPATH on the PR', () => {
  const r = integrated();
  const s = r.state;
  const cand = { packet: 'ALPHA', mergeSha: E, pr: 12 };
  const reads = { pin: { sha: C }, candidate: cand, descends: true, paths: UI, functionsTree: { pin: 'f'.repeat(40), candidate: 'f'.repeat(40) }, unknown: null };
  assert.match(targetDecision(s, { ...reads, pin: null }).report, /^NONE reason=the full-path pin/);
  assert.match(targetDecision(s, { ...reads, unknown: 'PR #12 (ALPHA) could not be read' }).report, /^NONE reason=PR #12/);
  assert.match(targetDecision(s, { ...reads, candidate: null }).report, /^NONE reason=no integrated preview-eligible merge/);
  assert.match(targetDecision(s, { ...reads, candidate: { ...cand, mergeSha: C } }).report, /is the full-path pin/);
  assert.match(targetDecision({ ...s, staging: { ...s.staging, servedSha: D } }, reads).report, /^FULL_PATH_REQUIRED .* is not the recorded served full-path deploy/);
  assert.match(targetDecision({ ...s, staging: null }, reads).report, /set-staging none/);
  assert.match(targetDecision(s, { ...reads, paths: [...UI, 'firestore.rules'] }).report, /^FULL_PATH_REQUIRED candidate=e+ packet=ALPHA reason=.*protected paths changed: firestore\.rules/);
  const d = targetDecision(s, reads);
  assert.deepEqual({ type: d.line.type, packet: d.line.packet, appSha: d.line.appSha, pinSha: d.line.pinSha, source: d.line.source.kind, rule: d.line.authority.rule }, { type: 'set-target', packet: 'ALPHA', appSha: E, pinSha: C, source: 'pull_request', rule: 'R-FASTPATH' });
  assert.deepEqual(d.line.authority.evidence, [{ kind: 'pull_request', id: 12 }, { kind: 'commit', id: E }, { kind: 'commit', id: C }]);
  const r1 = add(r, d.line);
  assert.match(targetDecision(r1.state, reads).report, /^HELD target=e+ packet=ALPHA$/, 'the same target is held, never re-recorded');
});

test('coalescing: a newer eligible merge replaces the held target; the older one is never targeted again', () => {
  let r = integrated();
  const reads = (c, m) => ({ pin: { sha: C }, candidate: { packet: c, mergeSha: m, pr: c === 'ALPHA' ? 12 : 13 }, descends: true, paths: UI, functionsTree: { pin: 'f'.repeat(40), candidate: 'f'.repeat(40) }, unknown: null });
  r = add(r, targetDecision(r.state, reads('ALPHA', E)).line);
  r = integrated(F, 'BETA', 13, r);
  const d = targetDecision(r.state, reads('BETA', F));
  r = add(r, d.line);
  assert.deepEqual(r.state.stagingTarget, { packet: 'BETA', appSha: F, pinSha: C });
  assert.ok(checkTexts(r.eventsText, serialize(r.state)).ok);
});

test('the writer\'s staging constants are the workflow\'s: its STAGING_URL, and the run title it gives a deploy', () => {
  const yml = fs.readFileSync(new URL('../../../.github/workflows/wsf-staging-deploy.yml', import.meta.url), 'utf8');
  assert.ok(yml.includes(`  STAGING_URL: ${STAGING_URL}\n`), 'STAGING_URL differs from the workflow env');
  assert.ok(yml.includes(`run-name: "WSF staging · mode=\${{ inputs.mode || 'deploy' }}"\n`), 'the run-name changed');
  assert.equal(DEPLOY_TITLE, 'WSF staging · mode=deploy');
  assert.equal(STAGING_WORKFLOW, 'wsf-staging-deploy.yml');
});

test('servedOf and freshnessFacts: the verifier\'s 7-character rule; the candidate is the pin when nothing newer is eligible', () => {
  assert.equal(servedOf(`build ${E.slice(0, 7)}`, [F, E, C]), E);
  assert.equal(servedOf('build unknown', [F, E, C]), null);
  assert.equal(servedOf(null, [E]), null);
  const s = integrated().state;
  const f = freshnessFacts(s, { pin: { sha: C }, candidate: null }, { health: `x ${C.slice(0, 7)}`, runs: null });
  assert.deepEqual(f, { candidateSha: C, servedSha: C, activeRun: null, lastRun: null, runs: 'unread' });
  const g = freshnessFacts(s, { pin: { sha: C }, candidate: { mergeSha: E } }, { health: `x ${C.slice(0, 7)}`, runs: [
    { id: 3, status: 'queued', title: DEPLOY_TITLE }, { id: 2, status: 'completed', conclusion: 'success', title: DEPLOY_TITLE }] });
  assert.deepEqual([g.candidateSha, g.servedSha, g.activeRun, g.lastRun, g.runs], [E, C, { id: 3, status: 'queued' }, { id: 2, conclusion: 'success' }, 'classified']);
});

const asyncTests = [];
asyncTests.push(['fastpathReads: an unreadable newest merge stops the search (never an older one); a newer docs-only merge is skipped; the pin is read at the running main', async () => {
  const r = integrated(F, 'BETA', 13, integrated(E, 'ALPHA', 12));
  const gh = (own) => ({
    async fileText(p, ref) { assert.equal(ref, B); return JSON.stringify({ project: 'westayfit-staging', approvedAppSha: C }); },
    async pull() { return { baseRef: 'claude/wsf-dev' }; },
    async changedPaths(from, to) { if (from === `${to}^1`) return own[to]; if (from === C) return UI; return null; },
    async descends() { return true; },
    async treeSha() { return 'f'.repeat(40); },
  });
  const stop = await fastpathReads(gh({ [F]: null, [E]: UI }), r.state, r.eventsText, B);
  assert.equal(stop.candidate, null, 'an older merge is never tried when the newest cannot be read');
  assert.match(stop.unknown, /whether BETA's merge f+ is member-visible could not be read/);
  const skip = await fastpathReads(gh({ [F]: ['docs/x.md'], [E]: UI }), r.state, r.eventsText, B);
  assert.deepEqual([skip.candidate?.packet, skip.descends, skip.paths, skip.unknown], ['ALPHA', true, UI, null], 'a docs-only newer merge never lags; the newest ELIGIBLE one is the candidate');
  assert.deepEqual(skip.functionsTree, { pin: 'f'.repeat(40), candidate: 'f'.repeat(40) });
}]);
asyncTests.push(['W4 F1: a rename reports BOTH paths, so a move out of functions-westayfit/ into apps/westayfit/ is not member-visible-only; the tree read is exact', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url.replace('https://api.github.com/repos/o/r', ''));
    const body = url.includes('/compare/') ? { status: 'ahead', files: [
      { filename: 'apps/westayfit/src/ui/Card.tsx', status: 'modified' },
      { filename: 'apps/westayfit/src/legacy/index.ts', previous_filename: 'functions-westayfit/src/index.ts', status: 'renamed' }] }
      : url.includes('/git/commits/') ? { tree: { sha: '9'.repeat(40) } }
      : url.includes('/git/trees/') ? { tree: [{ path: 'apps', type: 'tree', sha: '8'.repeat(40) }, { path: 'functions-westayfit', type: 'tree', sha: '7'.repeat(40) }] } : null;
    return { status: 200, ok: true, json: async () => body };
  };
  const gh = gitHubClient({ token: 't', repo: 'o/r', fetchImpl });
  const paths = await gh.changedPaths(C, E);
  assert.deepEqual(paths, ['apps/westayfit/src/ui/Card.tsx', 'functions-westayfit/src/index.ts', 'apps/westayfit/src/legacy/index.ts']);
  const reasons = fastPathReasons({ pinSha: C, candidateSha: E, descends: true, paths, functionsTree: { pin: '7'.repeat(40), candidate: '7'.repeat(40) } });
  assert.match(reasons.join('; '), /paths outside apps\/westayfit\/ changed: functions-westayfit\/src\/index\.ts/);
  assert.match(reasons.join('; '), /protected paths changed: functions-westayfit\/src\/index\.ts/);
  assert.equal(await gh.treeSha(E, 'functions-westayfit'), '7'.repeat(40));
  assert.equal(await gh.treeSha(E, 'functions'), '', 'an absent directory is empty, not unknown');
  assert.ok(calls.includes(`/git/commits/${E}`));
}]);
for (const [n, f] of asyncTests) await atest(n, f);

done('fastpath');
