#!/usr/bin/env node
/**
 * The digest that ties an APPLY to a REVIEWED PLAN.
 *
 *   node social-demo-plan-digest.mjs <plan-receipt.json>
 *     prints PLAN_DIGEST=<sha256>
 *   (with DEMO_PLAN_DIGEST set) exits 1 unless the digest equals it
 *
 * The digest covers the fixture, the project, the owner uid, the operational
 * commit the job runs from (WSF_OPERATIONAL_SHA) and every fixture path in
 * each class the plan found (create / reanchor / unchanged / drift / foreign).
 * So an apply runs only for the same owner, the same reviewed script and
 * fixture, and the same state of staging the operator reviewed; a plan that
 * found anything foreign never yields a usable digest.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';

export function planDigest(receipt, operationalSha) {
  const classes = Object.fromEntries(
    ['absent', 'reanchor', 'unchanged', 'drift', 'foreign'].map((k) => [k, [...(receipt.classes?.[k] ?? [])].sort()])
  );
  const canonical = JSON.stringify({
    fixtureId: receipt.fixtureId,
    project: receipt.project,
    ownerUid: receipt.ownerUid,
    operationalSha,
    classes,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  const sha = process.env.WSF_OPERATIONAL_SHA ?? '';
  const fail = (m) => { console.error(`::error::${m}`); process.exit(1); };
  if (!/^[0-9a-f]{40}$/.test(sha)) fail('WSF_OPERATIONAL_SHA must be the 40-hex operational commit');
  let receipt;
  try { receipt = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { fail('the plan receipt is missing or unreadable'); }
  if (receipt.mode !== 'plan') fail(`the receipt is from a ${receipt.mode} run, not a plan`);
  if ((receipt.classes?.foreign ?? []).length) fail('the plan found foreign documents; no digest is issued');
  const digest = planDigest(receipt, sha);
  console.log(`PLAN_DIGEST=${digest}`);
  const expected = process.env.DEMO_PLAN_DIGEST ?? '';
  if (expected !== '' && expected !== digest) fail('this plan does not match the reviewed plan digest; nothing is applied');
  if (expected !== '') console.log('PLAN_DIGEST_MATCHES_REVIEWED_PLAN=true');
}
