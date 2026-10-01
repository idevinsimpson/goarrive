#!/usr/bin/env node
/** The gate's fast-path resolver (STAGING-FRESHNESS-FASTPATH): it re-verifies the ledger target and refuses otherwise. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { appendEvent } from '../../../tools/wsf-control/append.mjs';
import { serialize } from '../../../tools/wsf-control/reduce.mjs';
import { STATE_REF } from '../../../tools/wsf-control/gitstate.mjs';
import { A, C, D, E, F, GENESIS, SOURCE_ONLY, boot2, w2 } from '../../../tools/wsf-control/tests/helpers.mjs';
import { WRITER_BOT, resolveLedgerTarget } from '../resolve-ledger-target.mjs';

let passed = 0;
const test = async (n, f) => { await f(); passed += 1; console.log(`  ok  ${n}`); };
const add = (r, e) => appendEvent(r.eventsText, e, { expectHead: r.state?.ledgerHead ?? GENESIS });
const UI = ['apps/westayfit/app/(tabs)/index.tsx'];

/** A ledger whose staging serves the pin C (boot2's set-staging, rollback D) and whose target is ALPHA's merge E. */
function ledger() {
  let r = [boot2(), w2('queue', { packet: 'ALPHA', owner: 'W3', completion: SOURCE_ONLY }), w2('release', { packet: 'ALPHA', inbox: 396 }),
    w2('ack', { packet: 'ALPHA', worker: 'W3' }), w2('deliver', { packet: 'ALPHA', pr: 12, subjectSha: A }), w2('review', { packet: 'ALPHA', reviewers: ['W7'] }),
    w2('review-pass', { packet: 'ALPHA', reviewer: 'W7' }), w2('accept', { packet: 'ALPHA', subjectSha: A })].reduce(add, { eventsText: '', state: null });
  const acc = JSON.parse(r.eventsText.trimEnd().split('\n').at(-1)).source.id;
  r = add(r, w2('integrate', { packet: 'ALPHA', mergeSha: E, acceptance: acc }));
  return add(r, w2('set-target', { packet: 'ALPHA', appSha: E, pinSha: C }, { rule: 'R-FASTPATH', cls: 'derived', source: { kind: 'pull_request', id: 12, repo: 'example-org/example-repo' } }));
}
const approval = { project: 'westayfit-staging', approvedAppSha: C, expectedPriorFunctions: 49 };
/** A compare API answering only the three questions the resolver may ask, exactly. */
const apiOf = ({ devHas = true, fromPin = true, paths = UI } = {}) => ({
  async descends(base, head) { if (base === E && head === 'claude/wsf-dev') return devHas; if (base === C && head === E) return fromPin; throw new Error(`unexpected descends(${base}, ${head})`); },
  async changedPaths(base, head) { if (base === C && head === E) return paths; throw new Error(`unexpected changedPaths(${base}, ${head})`); },
});
const ok = () => ({ approval, state: ledger().state, ledgerAuthor: WRITER_BOT, requested: '', mode: 'deploy', api: apiOf() });

await test('the ledger target, re-verified, is the candidate', async () => {
  assert.deepEqual(await resolveLedgerTarget(ok()), { ok: true, appSha: E, packet: 'ALPHA', pin: C });
  assert.equal((await resolveLedgerTarget({ ...ok(), requested: E })).ok, true, 'a confirming app_sha is accepted');
});

await test('every claim is re-checked, and each failure refuses with its reason', async () => {
  const st = () => ledger().state;
  const cases = [
    [{ mode: 'player-journey' }, /refused in mode "player-journey"/],
    [{ mode: undefined }, /refused in mode undefined/],
    [{ ledgerAuthor: 'someone' }, /was not written by wsf-control-writer\[bot\]/],
    [{ state: { ...st(), stagingTarget: undefined } }, /holds no staging target/],
    [{ approval: { ...approval, approvedAppSha: F } }, /was checked against the pin c+, not this run's pin f+/],
    [{ approval: { ...approval, project: 'westayfit' } }, /does not name a westayfit-staging commit/],
    [{ state: { ...st(), staging: { ...st().staging, servedSha: D } } }, /is not the recorded served full-path deploy/],
    [{ state: { ...st(), staging: null } }, /is not the recorded served full-path deploy/],
    [{ state: (() => { const s = st(); s.packets.ALPHA.phase = 'VERIFYING'; return s; })() }, /is not ALPHA's integrated merge/],
    [{ state: (() => { const s = st(); s.packets.ALPHA.artifact.mergeSha = F; return s; })() }, /is not ALPHA's integrated merge/],
    [{ requested: F }, /app_sha f+ is not the ledger target e+/],
    [{ state: { ...st(), canonical: null } }, /records no canonical development branch/],
    [{ api: apiOf({ devHas: false }) }, /does not contain the target/],
    [{ api: apiOf({ devHas: null }) }, /does not contain the target/],
    [{ api: apiOf({ fromPin: false }) }, /invariants do not hold: lineage: e+ does not descend from the pin/],
    [{ api: apiOf({ paths: null }) }, /invariants do not hold: the diff .* could not be read in full/],
    [{ api: apiOf({ paths: [...UI, 'functions-westayfit/src/index.ts'] }) }, /protected paths changed: functions-westayfit/],
    [{ api: apiOf({ paths: [...UI, '.github/wsf-staging/verify-deployment.mjs'] }) }, /paths outside apps\/westayfit\/ changed/],
  ];
  for (const [over, re] of cases) {
    const r = await resolveLedgerTarget({ ...ok(), ...over });
    assert.equal(r.ok, false, String(re)); assert.match(r.reason, re);
  }
});

await test('CLI: a checked ledger dir, the bot author and the approval; it refuses before any network read when a local check fails', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-ledger-'));
  const r = ledger();
  fs.writeFileSync(path.join(d, 'events.jsonl'), r.eventsText); fs.writeFileSync(path.join(d, 'state.json'), serialize(r.state));
  const ap = path.join(d, 'approval.json'); fs.writeFileSync(ap, JSON.stringify(approval));
  const cli = (env, dir = d) => spawnSync(process.execPath, ['.github/wsf-staging/resolve-ledger-target.mjs', ap, dir], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
  const wrongAuthor = cli({ WSF_LEDGER_AUTHOR: 'someone', WSF_INPUT_MODE: 'deploy' });
  assert.equal(wrongAuthor.status, 1); assert.match(wrongAuthor.stderr, /was not written by wsf-control-writer\[bot\][\s\S]*CANDIDATE=refused/);
  const noToken = cli({ WSF_LEDGER_AUTHOR: WRITER_BOT, WSF_INPUT_MODE: 'deploy' });
  assert.equal(noToken.status, 1); assert.match(noToken.stderr, /GITHUB_TOKEN is required/);
  fs.writeFileSync(path.join(d, 'state.json'), '{}');
  const tampered = cli({ WSF_LEDGER_AUTHOR: WRITER_BOT, WSF_INPUT_MODE: 'deploy' });
  assert.equal(tampered.status, 1); assert.match(tampered.stderr, /the control ledger does not check/);
});

await test('the workflow checks out exactly the writer\'s state ref, as data, and selects the resolver only for target_source=ledger', () => {
  const yml = fs.readFileSync('.github/workflows/wsf-staging-deploy.yml', 'utf8');
  assert.ok(yml.includes(`          ref: ${STATE_REF}\n`), `the ledger checkout must name ${STATE_REF}`);
  assert.match(yml, /if \[ "\$WSF_TARGET_SOURCE" = "ledger" \]; then\n\s+export WSF_LEDGER_AUTHOR="\$\(git -C control-ledger log -1 --format=%an\)"\n\s+node \.github\/wsf-staging\/resolve-ledger-target\.mjs \.github\/wsf-staging\/approved-candidate\.json control-ledger\n\s+else\n\s+node \.github\/wsf-staging\/resolve-candidate\.mjs \.github\/wsf-staging\/approved-candidate\.json\n\s+fi/);
});

console.log(`\nresolve-ledger-target: ${passed} passed`);
