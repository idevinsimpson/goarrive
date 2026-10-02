#!/usr/bin/env node
/** The unattended fast-path dispatcher (STAGING-FRESHNESS-DISPATCH): it dispatches once, only behind the owner's switch. */
import assert from 'node:assert/strict';
import { appendEvent } from '../../../tools/wsf-control/append.mjs';
import { targetTitle } from '../../../tools/wsf-control/fastpath.mjs';
import { A, C, D, E, F, GENESIS, SOURCE_ONLY, boot2, w2 } from '../../../tools/wsf-control/tests/helpers.mjs';
import { dispatchDecision, dispatchRun, retryProblem } from '../fastpath-dispatch.mjs';
import { WRITER_BOT } from '../resolve-ledger-target.mjs';

let passed = 0;
const test = async (n, f) => { await f(); passed += 1; console.log(`  ok  ${n}`); };
const add = (r, e) => appendEvent(r.eventsText, e, { expectHead: r.state?.ledgerHead ?? GENESIS });
const UI = ['apps/westayfit/app/(tabs)/index.tsx'];
const T = 'f'.repeat(40);

/** ALPHA integrated at E and targeted against the pin C; `enabled` records the owner's switch. */
function ledger({ enabled = true } = {}) {
  let r = [boot2(), w2('queue', { packet: 'ALPHA', owner: 'W3', completion: SOURCE_ONLY }), w2('release', { packet: 'ALPHA', inbox: 396 }),
    w2('ack', { packet: 'ALPHA', worker: 'W3' }), w2('deliver', { packet: 'ALPHA', pr: 12, subjectSha: A }), w2('review', { packet: 'ALPHA', reviewers: ['W7'] }),
    w2('review-pass', { packet: 'ALPHA', reviewer: 'W7' }), w2('accept', { packet: 'ALPHA', subjectSha: A })].reduce(add, { eventsText: '', state: null });
  const acc = JSON.parse(r.eventsText.trimEnd().split('\n').at(-1)).source.id;
  r = add(r, w2('integrate', { packet: 'ALPHA', mergeSha: E, acceptance: acc }));
  r = add(r, w2('set-target', { packet: 'ALPHA', appSha: E, pinSha: C }, { rule: 'R-FASTPATH', cls: 'derived', source: { kind: 'pull_request', id: 12, repo: 'example-org/example-repo' } }));
  if (enabled) r = add(r, w2('set-fastpath', { enabled: true }));
  return r.state;
}
const api = {
  async descends(base, head) { return (base === E && head === 'claude/wsf-dev') || (base === C && head === E); },
  async changedPaths(base, head) { return base === C && head === E ? UI : null; },
  async treeSha() { return T; },
};
const base = () => ({ state: ledger(), ledgerAuthor: WRITER_BOT, approval: { project: 'westayfit-staging', approvedAppSha: C }, served: { ok: false, status: 'mismatch' }, runs: [], api });

await test('it dispatches the verified target when the switch is on, the target is not served and was never sent', async () => {
  assert.deepEqual(await dispatchDecision(base()), { dispatch: { appSha: E, packet: 'ALPHA' } });
  const older = await dispatchDecision({ ...base(), runs: [{ id: 5, status: 'in_progress', title: targetTitle(F) }, { id: 4, status: 'completed', conclusion: 'success', title: 'WSF staging · mode=deploy' }] });
  assert.deepEqual(older, { dispatch: { appSha: E, packet: 'ALPHA' } }, 'a deploy of another target does not block: the concurrency group serializes the newest behind it');
});

await test('every other case is a named skip, and nothing is dispatched', async () => {
  const st = ledger();
  const cases = [
    [{ state: ledger({ enabled: false }) }, /not enabled in the ledger/],
    [{ state: { ...st, fastpath: { enabled: false } } }, /not enabled in the ledger/],
    [{ state: { ...st, stagingTarget: undefined } }, /holds no staging target/],
    [{ served: { ok: true, status: 'match' } }, /already names the target eeeeeeee \(FRESH\)/],
    [{ runs: null }, /could not be read; nothing is dispatched blind/],
    [{ runs: [{ id: 9, status: 'queued', title: targetTitle(E) }] }, /already queued \(run 9\)/],
    [{ runs: [{ id: 9, status: 'in_progress', title: targetTitle(E) }] }, /already in_progress \(run 9\)/],
    [{ runs: [{ id: 8, status: 'completed', conclusion: 'failure', title: targetTitle(E) }] }, /already ended failure \(run 8\); it is never re-sent automatically/],
    [{ runs: [{ id: 8, status: 'completed', conclusion: 'cancelled', title: targetTitle(E) }] }, /already ended cancelled/],
    [{ runs: [{ id: 7, status: 'completed', conclusion: 'success', title: targetTitle(E) }] }, /already deployed \(run 7\) though the marker does not name it/],
    [{ ledgerAuthor: 'someone' }, /does not verify: .*does not name wsf-control-writer\[bot\]/],
    [{ approval: { project: 'westayfit-staging', approvedAppSha: F } }, /does not verify: .*checked against the pin/],
    [{ api: { ...api, async changedPaths() { return [...UI, 'functions-westayfit/src/index.ts']; } } }, /does not verify: .*protected paths changed/],
    [{ api: { ...api, async treeSha(c) { return c === E ? '1'.repeat(40) : T; } } }, /does not verify: .*functions-westayfit tree changed/],
  ];
  for (const [over, re] of cases) {
    const d = await dispatchDecision({ ...base(), ...over });
    assert.equal(d.dispatch, undefined, String(re)); assert.match(d.skip, re);
  }
});

// ---- STAGING-FASTPATH-FAILED-TARGET-RETRY-FIX (#365 5954205876) -------------------------------------------------------

const FAILED = 37012494776;
/** The recovery case: ALPHA's target E (pin C) failed in run FAILED; FIX integrated at D (the repair); the owner authorized. */
function retryLedger({ authorize = true, failedRun = FAILED } = {}) {
  let r = { eventsText: '', state: null };
  const integrateIt = (id, merge, pr) => {
    r = [w2('queue', { packet: id, owner: 'W3', completion: SOURCE_ONLY }), w2('release', { packet: id, inbox: 396 }), w2('ack', { packet: id, worker: 'W3' }),
      w2('deliver', { packet: id, pr, subjectSha: A }), w2('review', { packet: id, reviewers: ['W7'] }), w2('review-pass', { packet: id, reviewer: 'W7' }),
      w2('accept', { packet: id, subjectSha: A })].reduce(add, r);
    r = add(r, w2('integrate', { packet: id, mergeSha: merge, acceptance: JSON.parse(r.eventsText.trimEnd().split('\n').at(-1)).source.id }));
  };
  r = add(r, boot2());
  integrateIt('ALPHA', E, 12);
  r = add(r, w2('set-target', { packet: 'ALPHA', appSha: E, pinSha: C }, { rule: 'R-FASTPATH', cls: 'derived', source: { kind: 'pull_request', id: 12, repo: 'example-org/example-repo' } }));
  r = add(r, w2('set-fastpath', { enabled: true }));
  integrateIt('FIX', D, 555);
  if (authorize) r = add(r, w2('authorize-retry', { packet: 'ALPHA', appSha: E, failedRun, repairPacket: 'FIX', repairSha: D }));
  return r.state;
}
const retryApi = (over = {}) => ({ ...api, async descends(base, head) { if (base === D && head === 'main') return 'onMain' in over ? over.onMain : true; return api.descends(base, head); }, ...over.api });
const failedRun = (id = FAILED, conclusion = 'failure') => ({ id, status: 'completed', conclusion, title: targetTitle(E) });
const retryBase = () => ({ ...base(), state: retryLedger(), runs: [failedRun()], api: retryApi() });

await test('RETRY: the exact recovery case dispatches once: the authorized failed run is the newest attempt, the repair is integrated and on main', async () => {
  assert.deepEqual(await dispatchDecision(retryBase()), { dispatch: { appSha: E, packet: 'ALPHA', retryOf: FAILED } });
  const other = await dispatchDecision({ ...retryBase(), runs: [{ id: FAILED + 5, status: 'completed', conclusion: 'success', title: targetTitle(F) }, failedRun()] });
  assert.deepEqual(other, { dispatch: { appSha: E, packet: 'ALPHA', retryOf: FAILED } }, 'another target\'s newer run is not an attempt at this one');
  const unsorted = await dispatchDecision({ ...retryBase(), runs: [failedRun(FAILED - 9), failedRun()] });
  assert.equal(unsorted.dispatch?.retryOf, FAILED, 'newest is by run id, whatever the listing order');
});

await test('RETRY: without a recorded authorization a failed target stays BLOCKED (the default)', async () => {
  const d = await dispatchDecision({ ...retryBase(), state: retryLedger({ authorize: false }) });
  assert.match(d.skip, /already ended failure \(run 37012494776\); it is never re-sent automatically \(BLOCKED until a new target or a recorded decision\): no authorize-retry is recorded/);
});

await test('RETRY is spent by its own dispatch and is never repeated: a queued, running, failed or successful newer attempt refuses', async () => {
  for (const [newer, re] of [
    [{ id: FAILED + 1, status: 'queued', title: targetTitle(E) }, /already queued \(run 37012494777\)/],
    [{ id: FAILED + 1, status: 'in_progress', title: targetTitle(E) }, /already in_progress/],
    [{ id: FAILED + 1, status: 'completed', conclusion: 'failure', title: targetTitle(E) }, /names run 37012494776, but the newest attempt at the target is run 37012494777: spent/],
    [{ id: FAILED + 1, status: 'completed', conclusion: 'success', title: targetTitle(E) }, /newest attempt at the target is run 37012494777/],
    [{ id: FAILED + 1, status: 'completed', conclusion: 'cancelled', title: targetTitle(E) }, /newest attempt at the target is run 37012494777/],
  ]) {
    const d = await dispatchDecision({ ...retryBase(), runs: [newer, failedRun()] });
    assert.equal(d.dispatch, undefined, String(re)); assert.match(d.skip, re);
  }
});

await test('RETRY refuses drift, a missing or non-failed run, an un-integrated or off-main repair, and still requires full verification', async () => {
  const st = retryLedger();
  const cases = [
    [{ runs: [failedRun(FAILED, 'cancelled')] }, /names run 37012494776, which ended cancelled, not failure/],
    [{ runs: [failedRun(FAILED, 'timed_out')] }, /ended timed_out, not failure/],
    [{ runs: [failedRun(FAILED - 1)] }, /names run 37012494776, but the newest attempt at the target is run 37012494775/],
    [{ runs: [] }, /an authorize-retry names run 37012494776 for the target eeeeeeee, but no attempt at that target is among the recent staging runs; nothing is re-sent blind/],
    [{ runs: [{ ...failedRun(), title: targetTitle(F) }] }, /no attempt at that target is among the recent staging runs/],
    [{ state: retryLedger({ failedRun: FAILED - 1 }) }, /names run 37012494775, but the newest attempt at the target is run 37012494776/],
    [{ state: { ...st, stagingRetry: { ...st.stagingRetry, appSha: F } } }, /the recorded authorize-retry is for ffffffff \(ALPHA\) against the pin cccccccc, not this target/],
    [{ state: { ...st, stagingRetry: { ...st.stagingRetry, packet: 'FIX' } } }, /is for eeeeeeee \(FIX\)/],
    [{ state: { ...st, stagingRetry: { ...st.stagingRetry, pinSha: F } } }, /against the pin ffffffff, not this target/],
    [{ state: { ...st, packets: { ...st.packets, FIX: { ...st.packets.FIX, phase: 'ACCEPTED' } } } }, /the repair FIX is not INTEGRATED at dddddddd/],
    [{ state: { ...st, packets: { ...st.packets, FIX: { ...st.packets.FIX, artifact: { ...st.packets.FIX.artifact, mergeSha: F } } } } }, /the repair FIX is not INTEGRATED at dddddddd/],
    [{ api: retryApi({ onMain: false }) }, /the repair merge dddddddd is not on main/],
    [{ api: retryApi({ onMain: null }) }, /the repair merge dddddddd is not readably on main/],
    [{ api: { ...retryApi(), async descends(b, h) { if (h === 'main') throw new Error('HTTP 502'); return api.descends(b, h); } } }, /not readably on main/],
    [{ state: { ...st, fastpath: { enabled: false } } }, /not enabled in the ledger/],
    [{ served: { ok: true, status: 'match' } }, /already names the target/],
    [{ api: retryApi({ api: { async changedPaths() { return [...UI, 'firestore.rules']; } } }) }, /does not verify: .*protected paths changed: firestore\.rules/],
    [{ ledgerAuthor: 'someone' }, /does not verify/],
  ];
  for (const [over, re] of cases) {
    const d = await dispatchDecision({ ...retryBase(), ...over });
    assert.equal(d.dispatch, undefined, String(re)); assert.match(d.skip, re);
  }
});

await test('retryProblem is null only for the exact authorized case', async () => {
  const st = retryLedger();
  assert.equal(await retryProblem({ state: st, t: st.stagingTarget, mine: [failedRun()], api: retryApi() }), null);
  assert.match(await retryProblem({ state: { ...st, stagingRetry: undefined }, t: st.stagingTarget, mine: [failedRun()], api: retryApi() }), /no authorize-retry is recorded/);
});

await test('the one write: the existing staging workflow, from main, ledger mode, confirming the target; anything but 204 fails', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return { status: 204 }; };
  await dispatchRun({ token: 't0k', repo: 'o/r', appSha: E, fetchImpl });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://api.github.com/repos/o/r/actions/workflows/wsf-staging-deploy.yml/dispatches');
  assert.equal(seen[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(seen[0].init.body), { ref: 'main', inputs: { mode: 'deploy', target_source: 'ledger', app_sha: E } });
  await assert.rejects(dispatchRun({ token: 't', repo: 'o/r', appSha: E, fetchImpl: async () => ({ status: 403 }) }), /HTTP 403/);
});

console.log(`\nfastpath-dispatch: ${passed} passed`);
