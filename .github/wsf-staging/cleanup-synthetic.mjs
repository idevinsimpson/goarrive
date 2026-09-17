#!/usr/bin/env node
/**
 * Remove the synthetic fixtures a hosted run created, and report honestly
 * whether that actually happened.
 *
 * The version this replaces turned every unreadable response into `{}` and
 * then read success out of it: `(response.errors || []).length === 0` is true
 * for an empty object, so an HTTP 200 carrying an HTML error page — a proxy
 * notice, a login redirect — reported `deletedUsers: <all of them>`. Cleanup
 * that cannot fail is not cleanup; it is a receipt generator.
 *
 * Four outcomes, deliberately distinct, because operators act differently on
 * each:
 *   NO_FIXTURES  the manifest exists and records nothing to remove
 *   COMPLETE     everything in the manifest is gone, confirmed by reading back
 *   INCOMPLETE   something remains; the manifest is PRESERVED for recovery
 *   MANIFEST_UNUSABLE  absent, malformed, or not provably this run's — scope
 *                unknown or unsafe, nothing deleted, nothing claimed
 *
 * Provenance. Run 35248719827 showed that "every identifier contains the run
 * tag" is the wrong rule: Firebase Auth localIds are random, and the profile
 * document keyed by one (wsfMemberProfiles/<uid>) inherits that. The rule is
 * now:
 *   - an ordinary Firestore path must contain the run tag;
 *   - an Auth user need not — but before ANY deletion its account is looked
 *     up and its email must match the run-specific synthetic pattern the
 *     hosted harness creates, wsf-<runTag>-…@example.com; an already-absent
 *     account is "already absent", not unsafe;
 *   - wsfMemberProfiles/<uid> is the ONE untagged document shape allowed, and
 *     only when <uid> is in manifest.users AND the manifest carries a
 *     run-tagged wsfMemberships/…_<uid> path for that same uid.
 * The whole manifest is validated first. One unsafe identifier means
 * MANIFEST_UNUSABLE with zero deletions attempted.
 */
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ID = 'westayfit-staging';
const TOKEN = process.env.WSF_GOOGLE_ACCESS_TOKEN;
const MANIFEST = process.env.WSF_CLEANUP_MANIFEST;
const RECEIPT = process.env.WSF_CLEANUP_RECEIPT;
const API = process.env.WSF_API_BASE || '';

if (!TOKEN) throw new Error('WSF_GOOGLE_ACCESS_TOKEN is required');
if (!MANIFEST) throw new Error('WSF_CLEANUP_MANIFEST is required');
if (!RECEIPT) throw new Error('WSF_CLEANUP_RECEIPT is required');
process.umask(0o077);

const firestoreBase = `${API || 'https://firestore.googleapis.com'}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const identityBase = `${API || 'https://identitytoolkit.googleapis.com'}/v1/projects/${PROJECT_ID}`;

/**
 * A response is only usable when the transport succeeded AND the body is the
 * shape this API is documented to return. `expect` names the required shape;
 * anything else raises rather than degrading to an empty object.
 */
async function api(url, { method = 'GET', body, allowStatus = [], expect = 'object' } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`${method} transport failure: ${e.code || e.name || 'error'}`);
  }
  const text = await response.text();

  if (!response.ok && !allowStatus.includes(response.status)) {
    // Do not echo the body: an error page can carry request headers.
    throw new Error(`${method} returned HTTP ${response.status}`);
  }
  if (allowStatus.includes(response.status)) return { status: response.status, parsed: null };

  let parsed;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    // THE BUG THIS FILE EXISTS FOR. Previously: `catch { parsed = {} }`.
    throw new Error(`${method} returned HTTP ${response.status} with a body that is not JSON`);
  }
  if (expect === 'object' && (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))) {
    throw new Error(`${method} returned HTTP ${response.status} with an unexpected body shape`);
  }
  return { status: response.status, parsed };
}

function finish(status, extra, exitCode) {
  const receipt = {
    completedAt: new Date().toISOString(),
    project: PROJECT_ID,
    status,
    ...extra,
  };
  // A smoke that dies before creating the evidence directory must still get
  // a receipt: without this, the honest MANIFEST_UNUSABLE outcome below was
  // replaced by an ENOENT crash and the run showed no cleanup result at all.
  fs.mkdirSync(path.dirname(RECEIPT), { recursive: true, mode: 0o700 });
  fs.writeFileSync(RECEIPT, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  console.log(`CLEANUP_STATUS=${status}`);
  for (const [k, v] of Object.entries(extra)) {
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
      console.log(`CLEANUP_${k.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase()}=${v}`);
    }
  }
  process.exit(exitCode);
}

/**
 * Look up the requested Auth users. Returns a Map of localId → account for
 * the ones that exist; absent ones are simply not in the map. `{}` (no
 * `users` key) is the documented "none found" response.
 */
async function lookupUsers(localIds) {
  if (!localIds.length) return new Map();
  const { parsed } = await api(`${identityBase}/accounts:lookup`, { method: 'POST', body: { localId: localIds } });
  if (parsed.users !== undefined && !Array.isArray(parsed.users)) {
    throw new Error('Auth lookup returned a users field of unexpected type');
  }
  const present = new Map();
  for (const u of parsed.users || []) {
    if (u && typeof u.localId === 'string') present.set(u.localId, u);
  }
  return present;
}

// ---- manifest ------------------------------------------------------------
if (!fs.existsSync(MANIFEST)) {
  finish('MANIFEST_UNUSABLE', {
    reason: 'manifest file absent — the scope of what was created is unknown',
    manifestPreserved: false,
    recovery: 'Identify run-tagged fixtures (wsfCommunityGroups/e5grp-<runTag>-*, wsfGoals/e5goal-<runTag>-*) and Auth users with emails wsf-<runTag>-*@example.com by console query before the next run.',
  }, 1);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
} catch {
  finish('MANIFEST_UNUSABLE', { reason: 'manifest is not readable JSON', manifestPreserved: true }, 1);
}
const runTag = String(manifest?.runTag || '');
if (manifest?.project !== PROJECT_ID || !/^e5h-[A-Za-z0-9_-]+$/.test(runTag)) {
  // Refuse to delete anything against a manifest whose identity does not check
  // out. A broadened predicate here would clear records this run never made.
  finish('MANIFEST_UNUSABLE', { reason: 'manifest identity check failed', manifestPreserved: true }, 1);
}

const docs = [...new Set(manifest.docs || [])].filter((v) => typeof v === 'string' && v.length);
const users = [...new Set(manifest.users || [])].filter((v) => typeof v === 'string' && v.length);
const userSet = new Set(users);

// ---- provenance: validate EVERYTHING before deleting ANYTHING -------------
const unsafe = [];

// Documents. Tagged paths are this run's by construction. The single untagged
// shape allowed is the profile keyed by a synthetic uid, and only when the
// manifest itself ties that uid to this run through a tagged membership.
const membershipUids = new Set();
for (const d of docs) {
  const m = /^wsfMemberships\/([^/]+)_([^/_]+)$/.exec(d);
  if (m && d.includes(runTag)) membershipUids.add(m[2]);
}
let profileDocumentsLinked = 0;
for (const d of docs) {
  if (d.includes(runTag)) continue;
  const profile = /^wsfMemberProfiles\/([^/]+)$/.exec(d);
  if (!profile) { unsafe.push(`document ${d}: not tagged ${runTag}`); continue; }
  const uid = profile[1];
  if (!userSet.has(uid)) { unsafe.push(`document ${d}: profile uid is not in manifest.users`); continue; }
  if (!membershipUids.has(uid)) { unsafe.push(`document ${d}: no run-tagged wsfMemberships path links this uid to ${runTag}`); continue; }
  profileDocumentsLinked += 1;
}

// Users. A localId is random and proves nothing; the account's synthetic
// email does. Lookup is a read, so it is safe before validation completes.
const emailPattern = new RegExp(`^wsf-${runTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-[^@\\s]*@example\\.com$`, 'i');
let presentBefore = new Map();
try {
  presentBefore = await lookupUsers(users);
} catch (e) {
  finish('MANIFEST_UNUSABLE', {
    reason: `could not establish Auth user provenance before deletion: ${e.message}`,
    manifestPreserved: true,
  }, 1);
}
let usersVerifiedByEmail = 0;
let usersAlreadyAbsent = 0;
for (const uid of users) {
  const account = presentBefore.get(uid);
  if (!account) { usersAlreadyAbsent += 1; continue; }
  const email = typeof account.email === 'string' ? account.email : '';
  if (!emailPattern.test(email)) {
    // Never print the email: it is either someone else's or misattributed.
    unsafe.push(`user ${uid}: existing account email does not match the ${runTag} synthetic pattern`);
    continue;
  }
  usersVerifiedByEmail += 1;
}

if (unsafe.length) {
  finish('MANIFEST_UNUSABLE', {
    reason: `${unsafe.length} identifier(s) failed provenance validation for ${runTag}; nothing was deleted`,
    unsafeIdentifiers: unsafe.length,
    // Identifiers are run-scoped paths or opaque uids, never emails.
    unsafeDetails: unsafe.slice(0, 20),
    manifestPreserved: true,
  }, 1);
}

if (!docs.length && !users.length) {
  finish('NO_FIXTURES', { requestedDocuments: 0, requestedUsers: 0, manifestPreserved: false }, 0);
}

// ---- delete --------------------------------------------------------------
const problems = [];
let docsDeleted = 0;
let docsAlreadyGone = 0;

// Deepest paths first, so a subcollection document is removed before its parent.
for (const docPath of [...docs].sort((a, b) => b.split('/').length - a.split('/').length)) {
  try {
    const r = await api(`${firestoreBase}/${docPath}`, { method: 'DELETE', allowStatus: [404] });
    if (r.status === 404) docsAlreadyGone += 1;
    else docsDeleted += 1;
  } catch (e) {
    problems.push(`document ${docPath}: ${e.message}`);
  }
}

// Only accounts that exist AND passed the email check are sent for deletion.
const usersToDelete = users.filter((uid) => presentBefore.has(uid));
let usersReportedDeleted = 0;
if (usersToDelete.length) {
  try {
    const { parsed } = await api(`${identityBase}/accounts:batchDelete`, {
      method: 'POST',
      body: { localIds: usersToDelete, force: true },
    });
    // batchDelete returns {} on full success and {errors:[{index,message}]} on
    // partial failure. Absence of `errors` only means success when the body is
    // a real parsed object, which `api` has now guaranteed.
    const failures = Array.isArray(parsed?.errors) ? parsed.errors : [];
    if (parsed?.errors !== undefined && !Array.isArray(parsed.errors)) {
      problems.push('Auth batchDelete returned an errors field of unexpected type');
    } else if (failures.length) {
      problems.push(`Auth batchDelete reported ${failures.length} per-user failures`);
      usersReportedDeleted = Math.max(0, usersToDelete.length - failures.length);
    } else {
      usersReportedDeleted = usersToDelete.length;
    }
  } catch (e) {
    problems.push(`Auth batchDelete: ${e.message}`);
  }
}

// ---- read back: deletion is confirmed, never assumed ---------------------
const stillPresentDocs = [];
for (const docPath of docs) {
  try {
    const r = await api(`${firestoreBase}/${docPath}`, { allowStatus: [404] });
    if (r.status !== 404) stillPresentDocs.push(docPath);
  } catch (e) {
    problems.push(`verify document ${docPath}: ${e.message}`);
  }
}

// Every requested user, not only the ones deleted this pass: COMPLETE means
// none of them exist any more.
const stillPresentUsers = [];
if (users.length) {
  try {
    const remaining = await lookupUsers(users);
    for (const uid of remaining.keys()) stillPresentUsers.push(uid);
  } catch (e) {
    problems.push(`verify users: ${e.message}`);
  }
}

const complete = problems.length === 0 && stillPresentDocs.length === 0 && stillPresentUsers.length === 0;
const counts = {
  requestedDocuments: docs.length,
  documentsDeleted: docsDeleted,
  documentsAlreadyAbsent: docsAlreadyGone,
  profileDocumentsLinked,
  requestedUsers: users.length,
  usersVerifiedByEmail,
  usersAlreadyAbsent,
  usersDeleted: usersReportedDeleted,
};

if (complete) {
  fs.rmSync(MANIFEST, { force: true });
  finish('COMPLETE', { ...counts, manifestPreserved: false }, 0);
}

// Incomplete: the manifest is the only record of what remains, so it stays.
finish('INCOMPLETE', {
  ...counts,
  unresolvedDocuments: stillPresentDocs.length,
  unresolvedUsers: stillPresentUsers.length,
  // Run-tagged identifiers and opaque uids are not secret and are exactly what
  // recovery needs.
  unresolvedDocumentPaths: stillPresentDocs,
  unresolvedUserIds: stillPresentUsers,
  problems,
  manifestPreserved: true,
  recovery: `Re-run cleanup with WSF_CLEANUP_MANIFEST pointing at the retained manifest for run ${runTag}.`,
}, 1);
