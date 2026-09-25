#!/usr/bin/env node
/**
 * The two helpers the social-demo-seed mode runs before and around the seed:
 * the input validator (judged before any credential exists) and the digest
 * that binds an apply to a reviewed plan. Hostile inputs are the point.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validate } from '../social-demo-inputs.mjs';
import { planDigest } from '../social-demo-plan-digest.mjs';

let passed = 0;
const test = (n, f) => { f(); passed += 1; console.log(`  ok  ${n}`); };
const UID = 'AbCdEf0123456789xyzUVW012345';
const DIG = 'a'.repeat(64);
const SHA = 'b'.repeat(40);

test('plan and verify with a plain uid are accepted, and the flag comes from a fixed table', () => {
  assert.deepEqual(validate({ DEMO_ACTION: 'plan', DEMO_OWNER_UID: UID }), { action: 'plan', flag: '--plan', uid: UID, digest: '' });
  assert.equal(validate({ DEMO_ACTION: 'verify', DEMO_OWNER_UID: UID }).flag, '--verify');
  assert.equal(validate({ DEMO_ACTION: 'apply', DEMO_OWNER_UID: UID, DEMO_PLAN_DIGEST: DIG }).flag, '--apply');
});

test('any action outside plan / apply / verify is refused, including cleanup, reanchor and flag-shaped text', () => {
  for (const a of ['', 'cleanup', 'reanchor', '--apply', 'apply --cleanup', 'Plan', 'plan\n', 'toString', '__proto__', 'constructor']) {
    assert.ok(validate({ DEMO_ACTION: a, DEMO_OWNER_UID: UID }).error, `accepted action ${JSON.stringify(a)}`);
  }
});

test('hostile owner uids are refused: empty, shell, path, newline, space, quote, too long, synthetic prefix', () => {
  const bad = ['', '$(id)', '`id`', 'a;b', 'a b', "a'b", 'a"b', 'a\nb', '../etc', 'a/b', 'a|b', 'a&b', '-'.repeat(0), 'x'.repeat(129), 'wsfdemo-m01', 'uid\u0000'];
  for (const uid of bad) {
    assert.ok(validate({ DEMO_ACTION: 'plan', DEMO_OWNER_UID: uid }).error, `accepted uid ${JSON.stringify(uid)}`);
  }
  assert.equal(validate({ DEMO_ACTION: 'plan', DEMO_OWNER_UID: 'x'.repeat(128) }).error, undefined, '128 characters is the Firebase limit and allowed');
});

test('apply needs a 64-hex digest; plan and verify refuse to carry one', () => {
  for (const d of ['', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), `${'a'.repeat(63)}g`, `${DIG}\n`]) {
    assert.ok(validate({ DEMO_ACTION: 'apply', DEMO_OWNER_UID: UID, DEMO_PLAN_DIGEST: d }).error, `apply accepted digest ${JSON.stringify(d)}`);
  }
  assert.ok(validate({ DEMO_ACTION: 'plan', DEMO_OWNER_UID: UID, DEMO_PLAN_DIGEST: DIG }).error);
  assert.ok(validate({ DEMO_ACTION: 'verify', DEMO_OWNER_UID: UID, DEMO_PLAN_DIGEST: DIG }).error);
});

test('the validator CLI writes only fixed values to GITHUB_OUTPUT and never prints the uid', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-sd-'));
  const out = path.join(d, 'out');
  fs.writeFileSync(out, '');
  const r = spawnSync(process.execPath, [path.resolve('.github/wsf-staging/social-demo-inputs.mjs')], { encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: out, DEMO_ACTION: 'plan', DEMO_OWNER_UID: UID, DEMO_PLAN_DIGEST: '' } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(out, 'utf8'), 'action=plan\nflag=--plan\n');
  assert.equal(r.stdout.includes(UID), false, 'the uid is not echoed');
  const bad = spawnSync(process.execPath, [path.resolve('.github/wsf-staging/social-demo-inputs.mjs')], { encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: out, DEMO_ACTION: 'apply', DEMO_OWNER_UID: UID, DEMO_PLAN_DIGEST: '' } });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /apply requires demo_plan_digest/);
});

const receipt = (over = {}) => ({
  fixtureId: 'SOCIAL-STAGING-DEMO-1', project: 'westayfit-staging', mode: 'plan', ownerUid: UID,
  classes: { absent: ['wsfGoals/wsfdemo-goal-movers-squats', 'wsfMemberProfiles/wsfdemo-m01'], reanchor: [], unchanged: [], drift: [], foreign: [] },
  ...over,
});

test('the digest is stable across path order and changes with the owner, the commit, the project or any class', () => {
  const base = planDigest(receipt(), SHA);
  assert.match(base, /^[0-9a-f]{64}$/);
  const shuffled = receipt({ classes: { ...receipt().classes, absent: [...receipt().classes.absent].reverse() } });
  assert.equal(planDigest(shuffled, SHA), base, 'order of paths does not matter');
  const variants = [
    planDigest(receipt({ ownerUid: 'someoneElse0123456789abcdef' }), SHA),
    planDigest(receipt(), 'c'.repeat(40)),
    planDigest(receipt({ project: 'goarrive' }), SHA),
    planDigest(receipt({ classes: { ...receipt().classes, drift: ['wsfGoals/wsfdemo-goal-movers-squats'] } }), SHA),
    planDigest(receipt({ classes: { ...receipt().classes, absent: ['wsfMemberProfiles/wsfdemo-m01'] } }), SHA),
  ];
  for (const v of variants) assert.notEqual(v, base);
  assert.equal(new Set(variants).size, variants.length);
});

function digestCli(rcpt, env) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-sd-'));
  const f = path.join(d, 'plan-receipt.json');
  fs.writeFileSync(f, JSON.stringify(rcpt));
  return spawnSync(process.execPath, [path.resolve('.github/wsf-staging/social-demo-plan-digest.mjs'), f], { encoding: 'utf8', env: { ...process.env, ...env } });
}

test('the digest CLI prints the digest for a plan, and matches only the reviewed one', () => {
  const r = digestCli(receipt(), { WSF_OPERATIONAL_SHA: SHA, DEMO_PLAN_DIGEST: '' });
  assert.equal(r.status, 0, r.stderr);
  const printed = /^PLAN_DIGEST=([0-9a-f]{64})$/m.exec(r.stdout)[1];
  assert.equal(printed, planDigest(receipt(), SHA));
  const same = digestCli(receipt(), { WSF_OPERATIONAL_SHA: SHA, DEMO_PLAN_DIGEST: printed });
  assert.equal(same.status, 0);
  assert.match(same.stdout, /PLAN_DIGEST_MATCHES_REVIEWED_PLAN=true/);
  const other = digestCli(receipt(), { WSF_OPERATIONAL_SHA: SHA, DEMO_PLAN_DIGEST: 'f'.repeat(64) });
  assert.equal(other.status, 1);
  assert.match(other.stderr, /does not match the reviewed plan digest; nothing is applied/);
});

test('no digest for a plan that found foreign documents, for a non-plan receipt, or without a 40-hex commit', () => {
  const foreign = digestCli(receipt({ classes: { ...receipt().classes, foreign: ['wsfMemberProfiles/wsfdemo-m03'] } }), { WSF_OPERATIONAL_SHA: SHA });
  assert.equal(foreign.status, 1);
  assert.match(foreign.stderr, /foreign documents; no digest is issued/);
  assert.equal(/PLAN_DIGEST=/.test(foreign.stdout), false);
  assert.equal(digestCli(receipt({ mode: 'apply' }), { WSF_OPERATIONAL_SHA: SHA }).status, 1);
  assert.equal(digestCli(receipt(), { WSF_OPERATIONAL_SHA: 'main' }).status, 1);
});

test('a realistic seed receipt passes the existing evidence scan', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-sd-ev-'));
  fs.writeFileSync(path.join(d, 'plan-receipt.json'), JSON.stringify({ ...receipt(), anchor: '2026-09-25T16:00:00.000Z' }, null, 2));
  const r = spawnSync(process.execPath, [path.resolve('.github/wsf-staging/scan-evidence.mjs'), d], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

console.log(`\nsocial-demo-seed: ${passed} passed`);
