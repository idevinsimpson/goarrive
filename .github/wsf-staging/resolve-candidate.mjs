#!/usr/bin/env node
/**
 * Decide which application commit this run is allowed to deploy.
 *
 * A 40-hex `app_sha` proves syntax, not approval — every commit on every branch
 * and every fork is 40 hex characters. Approval lives in
 * approved-candidate.json on the default branch, where changing it is a
 * reviewed change, and this script is the only thing that grants it.
 *
 * The approval file is read from the OPERATIONAL checkout (the commit the
 * workflow itself ran from), never from the candidate. A candidate that could
 * ship its own approval file would be approving itself.
 *
 * Runs before the candidate is fetched, so an unapproved commit's code is never
 * checked out and no cloud credential is ever requested for it.
 */
import fs from 'node:fs';

const approvalPath = process.argv[2];
const requested = (process.env.WSF_REQUESTED_SHA || '').trim();

function fail(message) {
  console.error(`::error::${message}`);
  console.error('CANDIDATE=refused');
  process.exit(1);
}

let approval;
try {
  approval = JSON.parse(fs.readFileSync(approvalPath, 'utf8'));
} catch {
  fail('the approved-candidate file is missing or unreadable; refusing to deploy anything');
}

const approved = String(approval?.approvedAppSha || '');
if (!/^[0-9a-f]{40}$/.test(approved)) {
  fail('the approved-candidate file does not contain a valid 40-character commit SHA');
}
if (approval?.project !== 'westayfit-staging') {
  fail('the approved-candidate file does not name westayfit-staging');
}

// An empty request means "deploy whatever is approved", which is the ordinary
// case. A non-empty request must match exactly — it is a confirmation, not a
// selection.
if (requested !== '' && requested !== approved) {
  if (!/^[0-9a-f]{40}$/.test(requested)) {
    fail('app_sha must be a full 40-character lowercase hex commit SHA');
  }
  fail(
    `app_sha ${requested} is syntactically valid but is NOT the approved candidate. ` +
      `Approved: ${approved}. To deploy a different commit, update ` +
      `.github/wsf-staging/approved-candidate.json on the default branch and have that change reviewed.`
  );
}

console.log(`CANDIDATE=${approved}`);
console.log(`CANDIDATE_LABEL=${approval.packageLabel || 'unlabelled'}`);
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `app_sha=${approved}\n`);
}
