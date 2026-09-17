#!/usr/bin/env node
/**
 * Recovery-only gates for the one preserved manifest of hosted run
 * 35248719827.
 *
 *   verify-manifest <pins.json> <manifest.json> <out-verification.json>
 *     Fails closed unless the manifest FILE is byte-for-byte the reviewed one
 *     (SHA-256), names the staging project and the expected run tag, and
 *     carries exactly the expected number of users and documents, all unique
 *     strings. Runs BEFORE any Google credential exists. Writes a small
 *     verification record (hash and counts only) for the evidence artifact.
 *
 *   verify-receipt <pins.json> <receipt.json>
 *     Fails unless the cleanup receipt is COMPLETE for exactly the pinned
 *     counts with nothing unresolved and the manifest removed — i.e. every
 *     requested document and user was independently read back as absent.
 *
 * The pins file is committed and reviewed; nothing here is taken from a
 * workflow input.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [, , command, pinsPath, subjectPath, outPath] = process.argv;

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}
function readJson(file, what) {
  let raw;
  try { raw = fs.readFileSync(file); } catch { fail(`${what} is not readable: ${file}`); }
  let parsed;
  try { parsed = JSON.parse(raw.toString('utf8')); } catch { fail(`${what} is not JSON`); }
  return { raw, parsed };
}
function loadPins() {
  const { parsed: pins } = readJson(pinsPath, 'recovery record');
  const ok = Number.isInteger(pins.runId) && pins.runId > 0
    && typeof pins.artifactName === 'string' && pins.artifactName.length
    && /^[0-9a-f]{64}$/.test(pins.sha256 || '')
    && pins.project === 'westayfit-staging'
    && /^e5h-[A-Za-z0-9_-]+$/.test(pins.runTag || '')
    && Number.isInteger(pins.users) && pins.users >= 0
    && Number.isInteger(pins.documents) && pins.documents >= 0;
  if (!ok) fail('recovery record is malformed or does not name the staging project');
  return pins;
}

if (command === 'verify-manifest') {
  if (!pinsPath || !subjectPath || !outPath) fail('usage: verify-manifest <pins.json> <manifest.json> <out-verification.json>');
  const pins = loadPins();
  const { raw, parsed: manifest } = readJson(subjectPath, 'preserved manifest');
  const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
  const problems = [];
  if (sha256 !== pins.sha256) problems.push('SHA-256 does not match the reviewed manifest');
  if (manifest?.project !== pins.project) problems.push('project does not match');
  if (manifest?.runTag !== pins.runTag) problems.push('runTag does not match');
  const users = Array.isArray(manifest?.users) ? manifest.users : null;
  const docs = Array.isArray(manifest?.docs) ? manifest.docs : null;
  if (!users || !docs) problems.push('users/docs are not arrays');
  else {
    if (users.length !== pins.users) problems.push(`users count ${users.length} != ${pins.users}`);
    if (docs.length !== pins.documents) problems.push(`documents count ${docs.length} != ${pins.documents}`);
    if (!users.every((u) => typeof u === 'string' && u.length)) problems.push('users contains a non-string');
    if (!docs.every((d) => typeof d === 'string' && d.length)) problems.push('docs contains a non-string');
    if (new Set(users).size !== users.length) problems.push('users contains duplicates');
    if (new Set(docs).size !== docs.length) problems.push('docs contains duplicates');
  }
  if (problems.length) fail(`preserved manifest refused (${problems.length}): ${problems.join('; ')}`);
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true, mode: 0o700 });
  fs.writeFileSync(outPath, JSON.stringify({
    verifiedAt: new Date().toISOString(),
    runId: pins.runId,
    artifactName: pins.artifactName,
    sha256,
    project: pins.project,
    runTag: pins.runTag,
    users: users.length,
    documents: docs.length,
  }, null, 2) + '\n', { mode: 0o600 });
  console.log(`RECOVERY_MANIFEST=verified sha256=${sha256} users=${users.length} documents=${docs.length}`);
  process.exit(0);
}

if (command === 'verify-receipt') {
  if (!pinsPath || !subjectPath) fail('usage: verify-receipt <pins.json> <receipt.json>');
  const pins = loadPins();
  const { parsed: receipt } = readJson(subjectPath, 'cleanup receipt');
  const problems = [];
  if (receipt?.status !== 'COMPLETE') problems.push(`status is ${receipt?.status ?? 'absent'}, not COMPLETE`);
  if (receipt?.project !== pins.project) problems.push('receipt project does not match');
  if (receipt?.requestedUsers !== pins.users) problems.push(`requestedUsers ${receipt?.requestedUsers} != ${pins.users}`);
  if (receipt?.requestedDocuments !== pins.documents) problems.push(`requestedDocuments ${receipt?.requestedDocuments} != ${pins.documents}`);
  if ((receipt?.unresolvedUsers ?? 0) !== 0) problems.push(`unresolvedUsers ${receipt.unresolvedUsers}`);
  if ((receipt?.unresolvedDocuments ?? 0) !== 0) problems.push(`unresolvedDocuments ${receipt.unresolvedDocuments}`);
  if (receipt?.manifestPreserved !== false) problems.push('manifest was not removed, so COMPLETE was not proven');
  if (problems.length) fail(`recovery receipt refused (${problems.length}): ${problems.join('; ')}`);
  console.log(`RECOVERY_RECEIPT=complete requestedUsers=${receipt.requestedUsers} usersAlreadyAbsent=${receipt.usersAlreadyAbsent} usersDeleted=${receipt.usersDeleted} requestedDocuments=${receipt.requestedDocuments} documentsAlreadyAbsent=${receipt.documentsAlreadyAbsent} documentsDeleted=${receipt.documentsDeleted}`);
  process.exit(0);
}

fail('usage: recovery-35248719827.mjs verify-manifest|verify-receipt …');
