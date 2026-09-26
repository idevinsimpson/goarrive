#!/usr/bin/env node
/**
 * Validates the social-demo-seed dispatch inputs BEFORE the job authenticates.
 *
 * The inputs arrive ONLY through the environment (DEMO_ACTION,
 * DEMO_OWNER_UID, DEMO_PLAN_DIGEST); the workflow never interpolates them into
 * shell text. This script is the single place they are judged, and it writes
 * back only values it constructed itself: the seed flag comes from a fixed
 * table, never from the input string.
 *
 *   plan    read-only; the default
 *   apply   requires DEMO_PLAN_DIGEST, the PLAN_DIGEST of a reviewed plan
 *   verify  read-only
 *
 * There is deliberately no cleanup or reanchor action in this mode.
 */
import fs from 'node:fs';

const FLAGS = Object.freeze({ plan: '--plan', apply: '--apply', verify: '--verify' });
// Firebase Auth uids: 1-128 characters. Accepted here: letters, digits, '_' and
// '-', which covers generated uids and excludes every shell and path
// metacharacter. The fixture's synthetic prefix is refused: the owner is a
// real account, never one of the sample members.
const UID = /^[A-Za-z0-9_-]{1,128}$/;
const DIGEST = /^[0-9a-f]{64}$/;

export function validate(env) {
  const action = env.DEMO_ACTION ?? '';
  const uid = env.DEMO_OWNER_UID ?? '';
  const digest = env.DEMO_PLAN_DIGEST ?? '';
  if (!Object.prototype.hasOwnProperty.call(FLAGS, action)) return { error: 'demo_action must be exactly plan, apply or verify' };
  if (uid === '') return { error: 'demo_owner_uid is required: the uid of the owner\'s existing, verified staging account (never a display name)' };
  if (!UID.test(uid)) return { error: 'demo_owner_uid must be 1-128 characters of letters, digits, "_" or "-"' };
  if (uid.startsWith('wsfdemo-')) return { error: 'demo_owner_uid carries the synthetic-member prefix; the owner is a real account' };
  if (action === 'apply') {
    if (!DIGEST.test(digest)) return { error: 'apply requires demo_plan_digest: the 64-hex PLAN_DIGEST printed by a reviewed plan run for this owner' };
  } else if (digest !== '') {
    return { error: `demo_plan_digest is only for apply; refusing a ${action} that carries one` };
  }
  return { action, flag: FLAGS[action], uid, digest };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const r = validate(process.env);
  if (r.error) { console.error(`::error::${r.error}`); process.exit(1); }
  const out = process.env.GITHUB_OUTPUT;
  if (!out) { console.error('::error::GITHUB_OUTPUT is not set'); process.exit(1); }
  fs.appendFileSync(out, `action=${r.action}\nflag=${r.flag}\n`);
  console.log(`SOCIAL_DEMO_ACTION=${r.action}`);
  console.log('SOCIAL_DEMO_OWNER_UID=validated');
}
