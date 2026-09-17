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
 *   MANIFEST_UNUSABLE  absent or malformed — scope unknown, nothing claimed
 *
 * The old code collapsed the last two into `manifestFound: false, errors: []`
 * and exited 0. A missing manifest is the case where cleanup is least able to
 * promise anything, so it is the one case that must never look like success.
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

// ---- manifest ------------------------------------------------------------
if (!fs.existsSync(MANIFEST)) {
  finish('MANIFEST_UNUSABLE', {
    reason: 'manifest file absent — the scope of what was created is unknown',
    manifestPreserved: false,
    recovery: 'Identify run-tagged fixtures (wsfMemberProfiles/e5h-*, wsfCommunityGroups/e5h-*) by console query before the next run.',
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

// Every identifier must carry this run's tag. A manifest entry that does not is
// not this run's to delete.
const strayDocs = docs.filter((d) => !d.includes(runTag));
const strayUsers = users.filter((u) => !u.includes(runTag));
if (strayDocs.length || strayUsers.length) {
  finish('MANIFEST_UNUSABLE', {
    reason: `manifest contains ${strayDocs.length + strayUsers.length} identifiers not tagged ${runTag}`,
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

let usersRequested = users.length;
let usersReportedDeleted = 0;
if (users.length) {
  try {
    const { parsed } = await api(`${identityBase}/accounts:batchDelete`, {
      method: 'POST',
      body: { localIds: users, force: true },
    });
    // batchDelete returns {} on full success and {errors:[{index,message}]} on
    // partial failure. Absence of `errors` only means success when the body is
    // a real parsed object, which `api` has now guaranteed.
    const failures = Array.isArray(parsed?.errors) ? parsed.errors : [];
    if (parsed?.errors !== undefined && !Array.isArray(parsed.errors)) {
      problems.push('Auth batchDelete returned an errors field of unexpected type');
    } else if (failures.length) {
      problems.push(`Auth batchDelete reported ${failures.length} per-user failures`);
      usersReportedDeleted = Math.max(0, users.length - failures.length);
    } else {
      usersReportedDeleted = users.length;
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

const stillPresentUsers = [];
if (users.length) {
  try {
    const { parsed } = await api(`${identityBase}/accounts:lookup`, {
      method: 'POST',
      body: { localId: users },
    });
    const remaining = Array.isArray(parsed?.users) ? parsed.users : [];
    for (const u of remaining) if (u?.localId) stillPresentUsers.push(u.localId);
  } catch (e) {
    problems.push(`verify users: ${e.message}`);
  }
}

const complete = problems.length === 0 && stillPresentDocs.length === 0 && stillPresentUsers.length === 0;

if (complete) {
  fs.rmSync(MANIFEST, { force: true });
  finish('COMPLETE', {
    requestedDocuments: docs.length,
    documentsDeleted: docsDeleted,
    documentsAlreadyAbsent: docsAlreadyGone,
    requestedUsers: usersRequested,
    usersDeleted: usersReportedDeleted,
    manifestPreserved: false,
  }, 0);
}

// Incomplete: the manifest is the only record of what remains, so it stays.
finish('INCOMPLETE', {
  requestedDocuments: docs.length,
  documentsDeleted: docsDeleted,
  documentsAlreadyAbsent: docsAlreadyGone,
  requestedUsers: usersRequested,
  usersDeleted: usersReportedDeleted,
  unresolvedDocuments: stillPresentDocs.length,
  unresolvedUsers: stillPresentUsers.length,
  // Run-tagged identifiers are not secret and are exactly what recovery needs.
  unresolvedDocumentPaths: stillPresentDocs,
  unresolvedUserIds: stillPresentUsers,
  problems,
  manifestPreserved: true,
  recovery: `Re-run cleanup with WSF_CLEANUP_MANIFEST pointing at the retained manifest for run ${runTag}.`,
}, 1);
