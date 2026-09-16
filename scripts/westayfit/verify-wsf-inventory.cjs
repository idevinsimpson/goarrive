#!/usr/bin/env node
/**
 * Verify the WSF staging function inventory BY NAME after a deploy.
 *
 * A successful CLI exit is not a successful deployment. The CLI exits 0 having
 * deployed a subset, having skipped a function whose build failed upstream, and
 * having left an expected name absent. The only evidence that Package E landed
 * is that `wsfSetGoalDisplayAuthorization` exists and nothing that was there
 * before has gone.
 *
 * Counting to 23 is not that evidence either: 22 carried plus one unrelated
 * addition also counts to 23. Every name is checked individually.
 *
 * Usage: verify-wsf-inventory.cjs <functions-list.json> <before-names.txt>
 */
const fs = require('fs');

const EXPECTED = [
  'wsfAdjustGoal', 'wsfChallengePulse', 'wsfCheckIn', 'wsfContribute',
  'wsfCreateCommunity', 'wsfCreateGoal', 'wsfDesignateChampion', 'wsfGoalPulse',
  'wsfHealth', 'wsfJoinCommunity', 'wsfLeaveCommunity', 'wsfListChallenge',
  'wsfListGoals', 'wsfMyCommunities', 'wsfMyContribution', 'wsfPreviewCommunity',
  'wsfReinstateMember', 'wsfRemoveMember', 'wsfResetJoinCode', 'wsfSaveProfile',
  'wsfSendPasswordResetEmail', 'wsfSendVerificationEmail',
  'wsfSetGoalDisplayAuthorization',
];
const CREATED_BY_PACKAGE_E = 'wsfSetGoalDisplayAuthorization';

const [, , afterPath, beforePath] = process.argv;
const parsed = JSON.parse(fs.readFileSync(afterPath, 'utf8'));
const entries = parsed.result || parsed || [];
const after = entries.map((f) => f.id).filter((id) => id && id.startsWith('wsf'));
const before = fs.existsSync(beforePath)
  ? fs.readFileSync(beforePath, 'utf8').split('\n').filter(Boolean)
  : [];

const problems = [];

const missing = EXPECTED.filter((n) => !after.includes(n));
if (missing.length) problems.push(`expected but ABSENT: ${missing.join(', ')}`);

const unexpected = after.filter((n) => !EXPECTED.includes(n));
if (unexpected.length) problems.push(`present but NOT expected: ${unexpected.join(', ')}`);

// Anything that existed before and is gone now is a regression, whatever the
// total count says.
const lost = before.filter((n) => !after.includes(n));
if (lost.length) problems.push(`present before this deploy and now GONE: ${lost.join(', ')}`);

if (!after.includes(CREATED_BY_PACKAGE_E)) {
  problems.push(`${CREATED_BY_PACKAGE_E} is absent — Package E did not deploy`);
}

// wsfCheckIn must stay at zero minimum instances. A positive minimum is a
// standing cost, and the project-aware param that keeps it at zero on a
// non-production project is exactly the sort of thing a deploy can silently
// change.
const checkIn = entries.find((f) => f.id === 'wsfCheckIn');
if (checkIn) {
  const min = checkIn.minInstances ?? checkIn.serviceConfig?.minInstanceCount ?? 0;
  if (Number(min) !== 0) problems.push(`wsfCheckIn minInstances is ${min}, expected 0`);
  console.log(`wsfCheckIn minInstances: ${Number(min)}`);
} else {
  problems.push('wsfCheckIn not found — cannot confirm minInstances 0');
}

console.log(`before: ${before.length} WSF functions`);
console.log(`after:  ${after.length} WSF functions`);
console.log(`created this deploy: ${after.filter((n) => !before.includes(n)).join(', ') || '(none)'}`);

if (problems.length) {
  for (const p of problems) console.error(`::error::${p}`);
  process.exit(1);
}
console.log(`PASS — all ${EXPECTED.length} expected WSF functions present by name.`);
