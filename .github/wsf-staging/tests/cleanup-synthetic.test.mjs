#!/usr/bin/env node
/**
 * Cleanup regressions, driven against a local stateful fake of the two Google
 * APIs the script touches (Identity Toolkit lookup/batchDelete, Firestore
 * GET/DELETE).
 *
 * Two lessons shaped this file. First, an HTTP 200 whose body is HTML must
 * never read as success. Second — run 35248719827 — Firebase Auth localIds
 * are random and never contain the run tag, so provenance has to come from
 * the account's synthetic email, established by lookup BEFORE any deletion.
 * The fixtures here use realistic 28-character uids for that reason.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const CLEANUP = path.resolve('.github/wsf-staging/cleanup-synthetic.mjs');
const RUN_TAG = 'e5h-testrun01';
const OTHER_TAG = 'e5h-someotherrun';
let passed = 0;

// Firebase-style localId: 28 alphanumerics, no run tag anywhere in it.
function firebaseUid() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(28);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  assert.equal(out.includes('e5h-'), false);
  return out;
}
// The email shape hosted-package-e-smoke.mjs creates: wsf-<runTag>-<label>-<hex>@example.com
const syntheticEmail = (tag, label) => `wsf-${tag}-${label}-${crypto.randomBytes(2).toString('hex')}@example.com`;

/**
 * Stateful fake: `accounts` is uid → email for existing Auth users, `docs` the
 * set of existing Firestore paths. `calls` records every mutating request so
 * a test can prove nothing was deleted. `behave` overrides specific endpoints.
 */
function startFake({ accounts = new Map(), docs = new Set(), docFields = new Map(), behave = {} } = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
      const body = raw ? JSON.parse(raw) : {};
      if (req.url.includes('accounts:lookup')) {
        if (behave.lookup) return behave.lookup(req, res, body);
        const found = (body.localId || []).filter((id) => accounts.has(id)).map((id) => ({ localId: id, email: accounts.get(id) }));
        return json(200, found.length ? { users: found } : {});
      }
      if (req.url.includes('accounts:batchDelete')) {
        calls.push({ kind: 'batchDelete', ids: body.localIds || [] });
        if (behave.batchDelete) return behave.batchDelete(req, res, body, accounts);
        for (const id of body.localIds || []) accounts.delete(id);
        return json(200, {});
      }
      const m = /\/documents\/(.+)$/.exec(req.url);
      const docPath = m ? decodeURIComponent(m[1]) : null;
      if (req.method === 'DELETE') {
        calls.push({ kind: 'deleteDoc', path: docPath });
        if (behave.deleteDoc) return behave.deleteDoc(req, res, docPath, docs);
        if (!docs.has(docPath)) return json(404, { error: { status: 'NOT_FOUND' } });
        docs.delete(docPath);
        return json(200, {});
      }
      if (req.method === 'GET') {
        if (docs.has(docPath)) return json(200, { name: docPath, fields: docFields.get(docPath) ?? {} });
        return json(404, { error: { status: 'NOT_FOUND' } });
      }
      json(404, { error: { status: 'NOT_FOUND' } });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}`, calls, accounts, docs }));
  });
}
const mutations = (calls) => calls.filter((c) => c.kind === 'batchDelete' || c.kind === 'deleteDoc');

function writeManifest(dir, manifest) {
  const p = path.join(dir, 'manifest.json');
  fs.writeFileSync(p, JSON.stringify(manifest));
  return p;
}
// Must be async: the fake server runs in THIS process, so a synchronous child
// would block the event loop and the server could never answer it.
function runCleanup(base, manifestPath, receiptPath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLEANUP], {
      env: {
        ...process.env,
        WSF_GOOGLE_ACCESS_TOKEN: 'test-token',
        WSF_CLEANUP_MANIFEST: manifestPath,
        WSF_CLEANUP_RECEIPT: receiptPath,
        WSF_API_BASE: base,
      },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => {
      let receipt = null;
      try { receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')); } catch {}
      resolve({ code, out, err, receipt });
    });
  });
}
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-cl-'));

/**
 * One synthetic fixture exactly as seedFixture() in the smoke lays it down:
 * three users (champion, member, outsider), a group, memberships and profiles
 * for champion and member, N goals each with 10 counter shards, optionally a
 * challenge, plus whatever the case tracks afterwards.
 */
function fixture(tag, label, { goals = 1, challenge = false, contribution = false, challengeShards = false } = {}) {
  const users = { champion: firebaseUid(), member: firebaseUid(), outsider: firebaseUid() };
  const emails = new Map([
    [users.champion, syntheticEmail(tag, `${label}-champion`)],
    [users.member, syntheticEmail(tag, `${label}-member`)],
    [users.outsider, syntheticEmail(tag, `${label}-outsider`)],
  ]);
  const stamp = `${tag}-${label}`;
  const groupId = `e5grp-${stamp}`;
  const docs = [`wsfCommunityGroups/${groupId}`];
  for (const uid of [users.champion, users.member]) {
    docs.push(`wsfMemberships/${groupId}_${uid}`);
    docs.push(`wsfMemberProfiles/${uid}`);
  }
  const goalIds = [];
  for (let i = 1; i <= goals; i += 1) {
    const goalId = `e5goal-${stamp}-${i}`;
    goalIds.push(goalId);
    docs.push(`wsfGoals/${goalId}`);
    for (let s = 0; s < 10; s += 1) docs.push(`wsfGoalCounters/${goalId}/shards/${s}`);
  }
  if (challenge) {
    docs.push(`wsfChallenges/e5challenge-${stamp}`);
    if (challengeShards) for (let s = 0; s < 10; s += 1) docs.push(`wsfChallengeCounters/e5challenge-${stamp}/shards/${s}`);
  }
  if (contribution) {
    docs.push(`wsfContributions/${goalIds[0]}_${users.member}_att1`);
    docs.push(`wsfGoalMemberTotals/${goalIds[0]}_${users.member}`);
  }
  return { users, emails, docs, groupId, goalIds };
}
/** The three fixtures run 35248719827 created, in its manifest's shape. */
function runShapeManifest(tag = RUN_TAG) {
  const parts = [
    fixture(tag, 'roundtrip', { goals: 1, challenge: true, challengeShards: true, contribution: true }),
    fixture(tag, 'protected', { goals: 1, contribution: true }),
    fixture(tag, 'uncertain', { goals: 2 }),
  ];
  const users = parts.flatMap((p) => Object.values(p.users));
  const docs = parts.flatMap((p) => p.docs);
  const emails = new Map(parts.flatMap((p) => [...p.emails]));
  return { manifest: { project: 'westayfit-staging', runTag: tag, users, docs }, emails, parts };
}
function backendFor({ manifest, emails }, { everythingPresent = true } = {}) {
  return {
    accounts: new Map(everythingPresent ? [...emails] : []),
    docs: new Set(everythingPresent ? manifest.docs : []),
  };
}

// ---- the actual run shape ---------------------------------------------------

await test('the run-35248719827 manifest shape is exactly modelled: 9 random uids, 74 docs, 6 untagged profiles', async () => {
  const { manifest } = runShapeManifest();
  assert.equal(manifest.users.length, 9);
  assert.equal(manifest.docs.length, 74);
  const untagged = manifest.docs.filter((d) => !d.includes(RUN_TAG));
  assert.equal(untagged.length, 6);
  for (const d of untagged) assert.match(d, /^wsfMemberProfiles\/[A-Za-z0-9]{28}$/);
  for (const u of manifest.users) assert.equal(u.includes(RUN_TAG), false);
});

await test('that shape passes provenance and is cleaned COMPLETE with read-back', async () => {
  const d = tmp();
  const shape = runShapeManifest();
  const fake = await startFake(backendFor(shape));
  const mp = writeManifest(d, shape.manifest);
  const r = await runCleanup(fake.base, mp, path.join(d, 'receipt.json'));
  fake.server.close();
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(r.receipt.status, 'COMPLETE');
  assert.equal(r.receipt.requestedUsers, 9);
  assert.equal(r.receipt.usersVerifiedByEmail, 9);
  assert.equal(r.receipt.usersDeleted, 9);
  assert.equal(r.receipt.requestedDocuments, 74);
  assert.equal(r.receipt.documentsDeleted, 74);
  assert.equal(r.receipt.profileDocumentsLinked, 6);
  assert.equal(fake.accounts.size, 0, 'read-back: no Auth users remain');
  assert.equal(fake.docs.size, 0, 'read-back: no documents remain');
  assert.equal(fs.existsSync(mp), false);
});

await test('old-run recovery: the same shape against a backend where the smoke already removed everything proves clean', async () => {
  const d = tmp();
  const shape = runShapeManifest();
  const fake = await startFake(backendFor(shape, { everythingPresent: false }));
  const r = await runCleanup(fake.base, writeManifest(d, shape.manifest), path.join(d, 'receipt.json'));
  fake.server.close();
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(r.receipt.status, 'COMPLETE');
  assert.equal(r.receipt.usersAlreadyAbsent, 9);
  assert.equal(r.receipt.usersDeleted, 0);
  assert.equal(r.receipt.documentsAlreadyAbsent, 74);
  assert.equal(r.receipt.documentsDeleted, 0);
  assert.equal(fake.calls.filter((c) => c.kind === 'batchDelete').length, 0, 'nothing to batchDelete when no account exists');
});

// ---- Auth provenance --------------------------------------------------------

await test('a random uid whose looked-up synthetic email carries the run tag is accepted, deleted, and proven absent', async () => {
  const d = tmp();
  const uid = firebaseUid();
  const fake = await startFake({ accounts: new Map([[uid, syntheticEmail(RUN_TAG, 'solo-outsider')]]) });
  const r = await runCleanup(fake.base, writeManifest(d, { project: 'westayfit-staging', runTag: RUN_TAG, users: [uid], docs: [] }), path.join(d, 'receipt.json'));
  fake.server.close();
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(r.receipt.status, 'COMPLETE');
  assert.equal(r.receipt.usersVerifiedByEmail, 1);
  assert.equal(r.receipt.usersDeleted, 1);
  assert.deepEqual(fake.calls.filter((c) => c.kind === 'batchDelete').map((c) => c.ids), [[uid]]);
  assert.equal(fake.accounts.has(uid), false, 'read-back proves absence');
});

await test('an outsider uid with no profile or membership is still validated through its run-tagged email alone', async () => {
  const d = tmp();
  const fx = fixture(RUN_TAG, 'protected');
  const fake = await startFake({ accounts: new Map(fx.emails), docs: new Set(fx.docs) });
  // The outsider has an account but appears in no document path at all.
  assert.equal(fx.docs.some((p) => p.includes(fx.users.outsider)), false);
  const r = await runCleanup(fake.base, writeManifest(d, { project: 'westayfit-staging', runTag: RUN_TAG, users: Object.values(fx.users), docs: fx.docs }), path.join(d, 'receipt.json'));
  fake.server.close();
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(r.receipt.status, 'COMPLETE');
  assert.equal(r.receipt.usersVerifiedByEmail, 3);
  assert.equal(fake.accounts.has(fx.users.outsider), false);
});

await test('a random uid whose actual email belongs to ANOTHER run is refused before any deletion', async () => {
  const d = tmp();
  const fx = fixture(RUN_TAG, 'roundtrip');
  const accounts = new Map(fx.emails);
  accounts.set(fx.users.member, syntheticEmail(OTHER_TAG, 'roundtrip-member'));
  const fake = await startFake({ accounts, docs: new Set(fx.docs) });
  const mp = writeManifest(d, { project: 'westayfit-staging', runTag: RUN_TAG, users: Object.values(fx.users), docs: fx.docs });
  const r = await runCleanup(fake.base, mp, path.join(d, 'receipt.json'));
  fake.server.close();
  assert.equal(r.code, 1);
  assert.equal(r.receipt.status, 'MANIFEST_UNUSABLE');
  assert.equal(r.receipt.unsafeIdentifiers, 1);
  assert.equal(mutations(fake.calls).length, 0, 'zero deletions attempted');
  assert.equal(fake.accounts.size, 3, 'no account removed');
  assert.equal(fake.docs.size, fx.docs.length, 'no document removed');
  assert.equal(fs.existsSync(mp), true);
  assert.equal(JSON.stringify(r.receipt).includes('@example.com'), false, 'the mismatching email is never written to the receipt');
});

await test('a random uid whose actual email is not synthetic at all (a real-looking account) is refused before any deletion', async () => {
  const d = tmp();
  const uid = firebaseUid();
  const fake = await startFake({ accounts: new Map([[uid, 'someone@goa.fit']]) });
  const r = await runCleanup(fake.base, writeManifest(d, { project: 'westayfit-staging', runTag: RUN_TAG, users: [uid], docs: [] }), path.join(d, 'receipt.json'));
  fake.server.close();
  assert.equal(r.code, 1);
  assert.equal(r.receipt.status, 'MANIFEST_UNUSABLE');
  assert.equal(mutations(fake.calls).length, 0);
  assert.equal(fake.accounts.has(uid), true);
  assert.equal(r.out.includes('goa.fit') || JSON.stringify(r.receipt).includes('goa.fit'), false);
});

await test('a lookup that cannot establish provenance (HTML 200) refuses before any deletion', async () => {
  const d = tmp();
  const fx = fixture(RUN_TAG, 'protected');
  const fake = await startFake({
    accounts: new Map(fx.emails), docs: new Set(fx.docs),
    behave: { lookup: (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>Sign in</html>'); } },
  });
  const r = await runCleanup(fake.base, writeManifest(d, { project: 'westayfit-staging', runTag: RUN_TAG, users: Object.values(fx.users), docs: fx.docs }), path.join(d, 'receipt.json'));
  fake.server.close();
  assert.equal(r.code, 1);
  assert.equal(r.receipt.status, 'MANIFEST_UNUSABLE');
  assert.match(r.receipt.reason, /provenance/);
  assert.equal(mutations(fake.calls).length, 0);
});

// ---- profile documents ---------------------------------------------------------

await test('wsfMemberProfiles/<random uid> is accepted only through manifest.users plus a run-tagged membership', async () => {
  const d = tmp();
  const fx = fixture(RUN_TAG, 'roundtrip');
  const fake = await startFake({ accounts: new Map(fx.emails), docs: new Set(fx.docs) });
  const r = await runCleanup(fake.base, writeManifest(d, { project: 'westayfit-staging', runTag: RUN_TAG, users: Object.values(fx.users), docs: fx.docs }), path.join(d, 'receipt.json'));
  fake.server.close();
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(r.receipt.profileDocumentsLinked, 2);
  assert.equal(fake.docs.has(`wsfMemberProfiles/${fx.users.champion}`), false);
});

await test('an untagged profile whose uid is NOT in manifest.users is refused, nothing deleted', async () => {
  const d = tmp();
  const fx = fixture(RUN_TAG, 'roundtrip');
  const stranger = firebaseUid();
  const docs = [...fx.docs, `wsfMemberProfiles/${stranger}`];
  const fake = await startFake({ accounts: new Map(fx.emails), docs: new Set(docs) });
  const r = await runCleanup(fake.base, writeManifest(d, { project: 'westayfit-staging', runTag: RUN_TAG, users: Object.values(fx.users), docs }), path.join(d, 'receipt.json'));
  fake.server.close();
  assert.equal(r.code, 1);
  assert.equal(r.receipt.status, 'MANIFEST_UNUSABLE');
  assert.ok(r.receipt.unsafeDetails.some((s) => s.includes('not in manifest.users')));
  assert.equal(mutations(fake.calls).length, 0);
  assert.equal(fake.docs.size, docs.length);
});

await test('an untagged profile whose uid IS in manifest.users but has no run-tagged membership is refused, nothing deleted', async () => {
  const d = tmp();
  const fx = fixture(RUN_TAG, 'roundtrip');
  // The outsider is a synthetic user of this run, but no membership ties a
  // profile document to it, so a profile keyed by it is not provably ours.
  const docs = [...fx.docs, `wsfMemberProfiles/${fx.users.outsider}`];
  const fake = await startFake({ accounts: new Map(fx.emails), docs: new Set(docs) });
  const r = await runCleanup(fake.base, writeManifest(d, { project: 'westayfit-staging', runTag: RUN_TAG, users: Object.values(fx.users), docs }), path.join(d, 'receipt.json'));
  fake.server.close();
  assert.equal(r.code, 1);
  assert.equal(r.receipt.status, 'MANIFEST_UNUSABLE');
  assert.ok(r.receipt.unsafeDetails.some((s) => s.includes('no run-tagged wsfMemberships path')));
  assert.equal(mutations(fake.calls).length, 0);
});

await test('a membership tagged for ANOTHER run does not link a profile', async () => {
  const d = tmp();
  const uid = firebaseUid();
  const docs = [`wsfMemberships/e5grp-${OTHER_TAG}-x_${uid}`, `wsfMemberProfiles/${uid}`];
  const fake = await startFake({ accounts: new Map([[uid, syntheticEmail(RUN_TAG, 'x')]]), docs: new Set(docs) });
  const r = await runCleanup(fake.base, writeManifest(d, { project: 'westayfit-staging', runTag: RUN_TAG, users: [uid], docs }), path.join(d, 'receipt.json'));
  fake.server.close();
  assert.equal(r.code, 1);
  assert.equal(r.receipt.status, 'MANIFEST_UNUSABLE');
  assert.equal(r.receipt.unsafeIdentifiers, 2, 'both the foreign membership and the now-unlinked profile');
  assert.equal(mutations(fake.calls).length, 0);
});

await test('an ordinary untagged Firestore path is still refused, nothing deleted', async () => {
  const d = tmp();
  const fake = await startFake({ docs: new Set(['wsfCommunityGroups/founder-smoke-KEEP-ME']) });
  const mp = writeManifest(d, { project: 'westayfit-staging', runTag: RUN_TAG, docs: ['wsfCommunityGroups/founder-smoke-KEEP-ME'], users: [] });
  const r = await runCleanup(fake.base, mp, path.join(d, 'receipt.json'));
  fake.server.close();
  assert.equal(r.code, 1);
  assert.equal(r.receipt.status, 'MANIFEST_UNUSABLE');
  assert.equal(mutations(fake.calls).length, 0, 'nothing may be deleted against an untagged identifier');
  assert.equal(fs.existsSync(mp), true);
});

await test('one unsafe identifier among 74 good ones still means ZERO deletions', async () => {
  const d = tmp();
  const shape = runShapeManifest();
  shape.manifest.docs.push('wsfGoals/not-ours');
  const fake = await startFake(backendFor(shape));
  const r = await runCleanup(fake.base, writeManifest(d, shape.manifest), path.join(d, 'receipt.json'));
  fake.server.close();
  assert.equal(r.receipt.status, 'MANIFEST_UNUSABLE');
  assert.equal(mutations(fake.calls).length, 0);
  assert.equal(fake.docs.size, 75);
  assert.equal(fake.accounts.size, 9);
});

// ---- honest outcomes after deletion --------------------------------------------

await test('HTML body with HTTP 200 on batchDelete does NOT report success', async () => {
  const d = tmp();
  const fx = fixture(RUN_TAG, 'protected');
  const fake = await startFake({
    accounts: new Map(fx.emails), docs: new Set(fx.docs),
    behave: { batchDelete: (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body>Sign in to continue</body></html>'); } },
  });
  const r = await runCleanup(fake.base, writeManifest(d, { project: 'westayfit-staging', runTag: RUN_TAG, users: Object.values(fx.users), docs: fx.docs }), path.join(d, 'receipt.json'));
  fake.server.close();
  assert.equal(r.code, 1, 'an HTML 200 must fail cleanup');
  assert.equal(r.receipt.status, 'INCOMPLETE');
  assert.equal(r.receipt.usersDeleted, 0, 'must not claim users were deleted');
  assert.ok(r.receipt.problems.some((p) => /not JSON/.test(p)), 'must name the body-shape failure');
});

await test('records that survive deletion are reported, not glossed, and the manifest is preserved', async () => {
  const d = tmp();
  const fx = fixture(RUN_TAG, 'protected');
  const fake = await startFake({
    accounts: new Map(fx.emails), docs: new Set(fx.docs),
    // batchDelete "succeeds" but one account stays behind
    behave: { batchDelete: (req, res, body, accounts) => { for (const id of body.localIds) if (id !== fx.users.member) accounts.delete(id); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); } },
  });
  const mp = writeManifest(d, { project: 'westayfit-staging', runTag: RUN_TAG, users: Object.values(fx.users), docs: fx.docs });
  const r = await runCleanup(fake.base, mp, path.join(d, 'receipt.json'));
  fake.server.close();
  assert.equal(r.code, 1, 'a surviving record must fail cleanup');
  assert.equal(r.receipt.status, 'INCOMPLETE');
  assert.equal(r.receipt.unresolvedUsers, 1);
  assert.deepEqual(r.receipt.unresolvedUserIds, [fx.users.member]);
  assert.equal(fs.existsSync(mp), true, 'the recovery manifest must survive a failed cleanup');
});

await test('a document that survives deletion produces INCOMPLETE with its path listed', async () => {
  const d = tmp();
  const fx = fixture(RUN_TAG, 'protected');
  const sticky = `wsfGoals/${fx.goalIds[0]}`;
  const fake = await startFake({
    accounts: new Map(fx.emails), docs: new Set(fx.docs),
    behave: { deleteDoc: (req, res, docPath, docs) => { if (docPath !== sticky) docs.delete(docPath); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); } },
  });
  const r = await runCleanup(fake.base, writeManifest(d, { project: 'westayfit-staging', runTag: RUN_TAG, users: Object.values(fx.users), docs: fx.docs }), path.join(d, 'receipt.json'));
  fake.server.close();
  assert.equal(r.code, 1);
  assert.equal(r.receipt.status, 'INCOMPLETE');
  assert.deepEqual(r.receipt.unresolvedDocumentPaths, [sticky]);
});

await test('partial per-user failure is surfaced', async () => {
  const d = tmp();
  const fx = fixture(RUN_TAG, 'protected');
  const fake = await startFake({
    accounts: new Map(fx.emails), docs: new Set(fx.docs),
    behave: { batchDelete: (req, res, body, accounts) => { body.localIds.slice(1).forEach((id) => accounts.delete(id)); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ errors: [{ index: 0, message: 'NOT_DELETED' }] })); } },
  });
  const r = await runCleanup(fake.base, writeManifest(d, { project: 'westayfit-staging', runTag: RUN_TAG, users: Object.values(fx.users), docs: fx.docs }), path.join(d, 'receipt.json'));
  fake.server.close();
  assert.equal(r.code, 1);
  assert.equal(r.receipt.status, 'INCOMPLETE');
  assert.equal(r.receipt.usersDeleted, 2);
  assert.equal(r.receipt.unresolvedUsers, 1);
});

// ---- manifest states ---------------------------------------------------------------

await test('a missing manifest is MANIFEST_UNUSABLE, never a clean pass', async () => {
  const d = tmp();
  const r = await runCleanup('http://127.0.0.1:1', path.join(d, 'absent.json'), path.join(d, 'receipt.json'));
  assert.equal(r.code, 1, 'an absent manifest must not exit 0');
  assert.equal(r.receipt.status, 'MANIFEST_UNUSABLE');
  assert.match(r.out, /CLEANUP_STATUS=MANIFEST_UNUSABLE/);
});

await test('an empty manifest is NO_FIXTURES — distinct from a missing one', async () => {
  const d = tmp();
  const mp = writeManifest(d, { project: 'westayfit-staging', runTag: RUN_TAG, docs: [], users: [] });
  const r = await runCleanup('http://127.0.0.1:1', mp, path.join(d, 'receipt.json'));
  assert.equal(r.code, 0);
  assert.equal(r.receipt.status, 'NO_FIXTURES');
});

await test('malformed manifest JSON is refused and preserved', async () => {
  const d = tmp();
  const mp = path.join(d, 'manifest.json');
  fs.writeFileSync(mp, '{not json');
  const r = await runCleanup('http://127.0.0.1:1', mp, path.join(d, 'receipt.json'));
  assert.equal(r.code, 1);
  assert.equal(r.receipt.status, 'MANIFEST_UNUSABLE');
  assert.equal(r.receipt.manifestPreserved, true);
  assert.equal(fs.existsSync(mp), true);
});

await test('early smoke failure: no evidence dir, no manifest → a real MANIFEST_UNUSABLE receipt', async () => {
  // Run 35244445618: the smoke threw at module load, so the evidence directory
  // was never created. Cleanup then crashed with ENOENT writing its receipt,
  // and the run showed no cleanup outcome at all.
  const d = tmp();
  const evidence = path.join(d, 'wsf-evidence');
  assert.equal(fs.existsSync(evidence), false);
  const receiptPath = path.join(evidence, 'cleanup-receipt.json');
  const r = await runCleanup('http://127.0.0.1:1', path.join(evidence, 'cleanup-manifest.json'), receiptPath);
  assert.equal(r.code, 1, 'must still exit nonzero');
  assert.equal(fs.existsSync(receiptPath), true, 'the receipt must be written even though its directory did not exist');
  assert.equal(r.receipt.status, 'MANIFEST_UNUSABLE');
  assert.equal(r.receipt.manifestPreserved, false);
  assert.equal('usersDeleted' in r.receipt, false, 'must not claim any deletion');
  assert.equal('docsDeleted' in r.receipt, false, 'must not claim any deletion');
  assert.match(r.out, /CLEANUP_STATUS=MANIFEST_UNUSABLE/);
  assert.equal(/CLEANUP_STATUS=(COMPLETE|NO_FIXTURES)/.test(r.out), false);
  assert.equal(fs.statSync(evidence).mode & 0o777, 0o700, 'the created directory is restrictive');
  assert.equal(fs.statSync(receiptPath).mode & 0o777, 0o600);
});

/**
 * Server-minted documents, and why they cannot simply be tracked.
 *
 * The turn journey names its records with Firestore auto-ids, and its lineId
 * is derived from one (`setup__{setupId}`). None of them can ever carry the
 * run tag. Tracking them as ordinary paths does not merely fail to delete
 * them: ONE untagged path fails provenance, and a failed provenance check
 * deletes NOTHING — so the turn row would have taken every other case's
 * fixtures down with it. These rows pin both halves: the refusal, and the
 * linked-document route that replaces it.
 */
const S = (v) => ({ stringValue: v });

/** The turn journey's writes, split into the tag-safe ones and the minted
 * ones, laid out exactly as caseTurnContract creates them. */
function turnShape(tag = RUN_TAG) {
  const base = fixture(tag, 'turn', { goals: 2 });
  const [goalA] = base.goalIds;
  const member = base.users.member;
  const setupId = firebaseUid().slice(0, 20);
  const lineId = `setup__${setupId}`;
  const ids = { p1: firebaseUid().slice(0, 20), p2: firebaseUid().slice(0, 20), s1: firebaseUid().slice(0, 20), s2: firebaseUid().slice(0, 20), entry: firebaseUid().slice(0, 20), attempt: firebaseUid().slice(0, 20) };

  // Keyed by the run-tagged goal id, so these stay ordinary tagged paths.
  const tagged = [...base.docs];
  for (const g of base.goalIds) tagged.push(`wsfCombinedGoalClaims/${g}`);
  tagged.push(`wsfContributions/${goalA}_${member}_${ids.attempt}`);
  tagged.push(`wsfGoalMemberTotals/${goalA}_${member}`);
  tagged.push(`wsfGoals/${goalA}/recentAdditions/${ids.attempt}`);
  tagged.push(`wsfCombinedCredits/${goalA}_${member}_${ids.attempt}`);
  for (let i = 0; i < 10; i += 1) tagged.push(`wsfCombinedCounters/${setupId}/shards/${goalA}_${i}`);

  // Minted by the server. The content is what each record really carries.
  const fields = new Map([
    [`wsfCombinedGoals/${setupId}`, { communityGroupId: S(base.groupId) }],
    [`wsfKioskPairings/${ids.p1}`, { goalId: S(goalA) }],
    [`wsfKioskPairings/${ids.p2}`, { goalId: S(goalA) }],
    [`wsfKioskStations/${ids.s1}`, { goalId: S(goalA) }],
    [`wsfKioskStations/${ids.s2}`, { goalId: S(goalA) }],
    [`wsfTurnEntries/${ids.entry}`, { goalId: S(goalA), uid: S(member), lineId: S(lineId) }],
    [`wsfTurnLines/${lineId}`, { communityGroupId: S(base.groupId) }],
    [`wsfTurnMembers/${lineId}__${member}`, { entryId: S(ids.entry) }],
    [`wsfTurnReceipts/${lineId}__${member}`, { goalId: S(goalA) }],
  ]);
  const linkedDocs = [
    { path: `wsfCombinedGoals/${setupId}`, via: base.groupId },
    { path: `wsfKioskPairings/${ids.p1}`, via: goalA },
    { path: `wsfKioskPairings/${ids.p2}`, via: goalA },
    { path: `wsfKioskStations/${ids.s1}`, via: goalA },
    { path: `wsfKioskStations/${ids.s2}`, via: goalA },
    { path: `wsfTurnEntries/${ids.entry}`, via: goalA },
    { path: `wsfTurnLines/${lineId}`, via: base.groupId },
    { path: `wsfTurnMembers/${lineId}__${member}`, via: member },
    { path: `wsfTurnReceipts/${lineId}__${member}`, via: goalA },
  ];
  return { base, tagged, fields, linkedDocs, member, goalA, lineId, setupId };
}

async function runTurn({ tagged, fields, linkedDocs, base }, tweak = {}) {
  const manifest = {
    project: 'westayfit-staging',
    runTag: RUN_TAG,
    users: Object.values(base.users),
    docs: tweak.docs ?? tagged,
    ...(tweak.omitLinked ? {} : { linkedDocs: tweak.linkedDocs ?? linkedDocs }),
  };
  const present = new Set([...manifest.docs, ...fields.keys()]);
  for (const p of tweak.absent ?? []) present.delete(p);
  const fake = await startFake({
    // The smoke deletes the Auth accounts itself, so by the time the
    // always-run recovery cleanup validates the manifest they are usually
    // GONE. `noAccounts` is that ordinary case, not an exotic one.
    accounts: tweak.noAccounts ? new Map() : new Map([...base.emails]),
    docs: present,
    docFields: tweak.fields ?? fields,
  });
  const d = tmp();
  const r = await runCleanup(fake.base, writeManifest(d, manifest), path.join(d, 'receipt.json'));
  fake.server.close();
  return { r, fake, present };
}

await test('a server-minted path tracked as an ordinary doc fails provenance and deletes NOTHING', async () => {
  const shape = turnShape();
  // Exactly the manifest caseTurnContract built before this correction: the
  // minted paths sitting in `docs` alongside the tagged ones.
  const { r, fake } = await runTurn(shape, { docs: [...shape.tagged, ...shape.fields.keys()], omitLinked: true });
  assert.equal(r.receipt.status, 'MANIFEST_UNUSABLE');
  assert.equal(r.code, 1);
  assert.equal(mutations(fake.calls).length, 0, 'a failed provenance check must delete nothing at all');
  // The point that makes this release-blocking: the OTHER cases' fixtures die too.
  assert.match(r.receipt.reason, /failed provenance validation/);
  assert.ok(r.receipt.unsafeIdentifiers >= 9, `expected every minted path to be named, saw ${r.receipt.unsafeIdentifiers}`);
  assert.ok(r.receipt.unsafeDetails.some((d) => /wsfTurnEntries\/.*not tagged/.test(d)));
});

await test('the same documents, declared as linked, are verified and removed — and the run completes', async () => {
  const shape = turnShape();
  const { r, fake, present } = await runTurn(shape);
  assert.equal(r.receipt.status, 'COMPLETE', r.receipt.reason || '');
  assert.equal(r.code, 0);
  assert.equal(r.receipt.linkedDocumentsVerified, 9);
  assert.equal(r.receipt.linkedDocumentsAlreadyAbsent, 0);
  assert.equal(present.size, 0, 'every document must be gone');
  for (const p of shape.fields.keys()) {
    assert.ok(fake.calls.some((c) => c.kind === 'deleteDoc' && c.path === p), `${p} was never deleted`);
  }
});

await test('a linked document whose stored record does not reference its declared owner is refused', async () => {
  const shape = turnShape();
  const fields = new Map(shape.fields);
  // The same path, but the record belongs to somebody else's run.
  fields.set(`wsfTurnLines/${shape.lineId}`, { communityGroupId: S(`e5grp-${OTHER_TAG}-turn`) });
  const { r, fake } = await runTurn(shape, { fields });
  assert.equal(r.receipt.status, 'MANIFEST_UNUSABLE');
  assert.equal(mutations(fake.calls).length, 0, 'one unproven link must stop the whole run');
  assert.ok(r.receipt.unsafeDetails.some((d) => /does not reference/.test(d)));
});

await test('a linked owner that is neither run-tagged nor a uid this run owns is refused', async () => {
  const shape = turnShape();
  const linkedDocs = shape.linkedDocs.map((l, i) => (i === 0 ? { path: l.path, via: 'wsfCombinedGoals' } : l));
  const { r, fake } = await runTurn(shape, { linkedDocs });
  assert.equal(r.receipt.status, 'MANIFEST_UNUSABLE');
  assert.equal(mutations(fake.calls).length, 0);
  assert.ok(r.receipt.unsafeDetails.some((d) => /neither .*-tagged nor a uid this run owns/.test(d)));
  // A uid with no run-tagged membership behind it must not qualify either.
  const stranger = firebaseUid();
  const withStranger = shape.linkedDocs.map((l, i) => (i === 0 ? { path: l.path, via: stranger } : l));
  const bad = await runTurn(shape, { linkedDocs: withStranger });
  assert.equal(bad.r.receipt.status, 'MANIFEST_UNUSABLE');
  assert.equal(mutations(bad.fake.calls).length, 0);
});

await test('linkage by path needs no read, and a linked document already gone is not an obstacle', async () => {
  const shape = turnShape();
  // wsfTurnMembers carries only an entryId, so it is proven by the member uid
  // in its own path. Delete it from the backend first: an absent record must
  // still be admitted, or a row that failed late could never clean up.
  const memberDoc = `wsfTurnMembers/${shape.lineId}__${shape.member}`;
  const lineDoc = `wsfTurnLines/${shape.lineId}`;
  const { r, fake } = await runTurn(shape, { absent: [memberDoc, lineDoc] });
  assert.equal(r.receipt.status, 'COMPLETE', r.receipt.reason || '');
  // Eight of the nine are proven by content and one by its own path. The
  // path-proven one is admitted WITHOUT a read, so its absence is invisible
  // here; the content-proven one that is gone is counted as already absent.
  assert.equal(r.receipt.linkedDocumentsVerified, 8);
  assert.equal(r.receipt.linkedDocumentsAlreadyAbsent, 1);
  const reads = fake.calls.filter((c) => c.kind === 'deleteDoc');
  assert.ok(reads.some((c) => c.path === memberDoc), 'the path-linked document is still offered for deletion');
});

await test('a path already claimed as a tagged doc may not ALSO be declared linked', async () => {
  // Not a safety hole but a counting one: without the guard the path is
  // queued twice, deleted twice, and reported as both a tagged document and
  // a verified link. The first mutation of this test did not exercise the
  // guard at all — it used a foreign path, which the tag rule rejects on its
  // own, so the test passed with the guard deleted.
  const shape = turnShape();
  const doubled = shape.tagged[0];
  const { r, fake } = await runTurn(shape, {
    linkedDocs: [...shape.linkedDocs, { path: doubled, via: shape.goalA }],
  });
  assert.equal(r.receipt.status, 'MANIFEST_UNUSABLE');
  assert.equal(mutations(fake.calls).length, 0);
  assert.ok(r.receipt.unsafeDetails.some((d) => /already claimed as a tagged path/.test(d)));
});

/**
 * The uid-linked document AFTER the smoke has deleted its account.
 *
 * This is the normal path, not an edge: the smoke's own cleanupAll() deletes
 * the synthetic users, and cleanup-synthetic.mjs then always runs. A uid is
 * only email-verifiable while the account still exists, so a link that leans
 * on it alone would reject every successful run — turning a clean run into
 * MANIFEST_UNUSABLE. The manifest ties the uid to this run independently,
 * through its own run-tagged membership path, exactly as it does for a
 * member profile.
 */
await test('a uid-linked document still validates once the synthetic account is gone', async () => {
  const shape = turnShape();
  const { r, fake } = await runTurn(shape, { noAccounts: true });
  assert.equal(r.receipt.status, 'COMPLETE', r.receipt.reason || '');
  assert.equal(r.receipt.usersAlreadyAbsent, 3);
  assert.equal(r.receipt.usersVerifiedByEmail, 0, 'no account remains to verify by email');
  assert.equal(r.receipt.linkedDocumentsVerified, 9);
  const memberDoc = `wsfTurnMembers/${shape.lineId}__${shape.member}`;
  assert.ok(fake.calls.some((c) => c.kind === 'deleteDoc' && c.path === memberDoc), 'the uid-linked document was never deleted');
});

await test('the same case with the uid-linked document already absent is still COMPLETE', async () => {
  const shape = turnShape();
  const memberDoc = `wsfTurnMembers/${shape.lineId}__${shape.member}`;
  const { r } = await runTurn(shape, { noAccounts: true, absent: [memberDoc] });
  assert.equal(r.receipt.status, 'COMPLETE', r.receipt.reason || '');
  // The uid-linked document is proven by its own path, so an absent record
  // is admitted without a read rather than counted as already gone.
  assert.equal(r.receipt.linkedDocumentsVerified, 9);
  assert.equal(r.receipt.linkedDocumentsAlreadyAbsent, 0);
});

await test('a departed uid with no run-tagged membership behind it is still refused', async () => {
  // The membership path is what ties the uid to this run. Without it an
  // absent account proves nothing, and the link must not be admitted.
  const shape = turnShape();
  const stranger = firebaseUid();
  const linkedDocs = shape.linkedDocs.map((l) =>
    l.via === shape.member ? { path: l.path.replace(shape.member, stranger), via: stranger } : l
  );
  const { r, fake } = await runTurn(shape, { noAccounts: true, linkedDocs });
  assert.equal(r.receipt.status, 'MANIFEST_UNUSABLE');
  assert.equal(mutations(fake.calls).length, 0);
  assert.ok(r.receipt.unsafeDetails.some((d) => /neither .*-tagged nor .*uid/.test(d)));
});

// ---- the run tags this cleaner owns ----------------------------------------
// Run 35495928362's whole failure: the player journey minted `e5j-…` from its
// first line, this file only ever exercised `e5h-`, and the cleaner accepted
// `^e5h-` alone. Three synthetic users and fifty-one documents were created
// and none were removed. The predicate now lives in run-tag.mjs and BOTH
// harnesses' real tags are checked against it below.

await test('the player journey’s own e5j tag is accepted, cleaned COMPLETE, and read back', async () => {
  const d = tmp();
  const shape = runShapeManifest('e5j-testrun01');
  const fake = await startFake(backendFor(shape));
  const mp = writeManifest(d, shape.manifest);
  const r = await runCleanup(fake.base, mp, path.join(d, 'receipt.json'));
  fake.server.close();
  assert.equal(r.receipt.status, 'COMPLETE', `e5j must be cleanable: ${r.out}${r.err}`);
  assert.equal(r.receipt.usersDeleted, 9);
  assert.equal(r.receipt.documentsDeleted, 74);
  assert.equal(fake.accounts.size, 0);
  assert.equal(fake.docs.size, 0);
});

for (const tag of ['e5i-testrun01', 'e5hj-testrun01', 'xe5h-testrun01', 'e5jgrp-testrun01', 'e5j', 'e5j-', 'E5J-testrun01', 'testrun01']) {
  await test(`a lookalike run tag is still refused with zero deletions: ${JSON.stringify(tag)}`, async () => {
    const d = tmp();
    // A real, fully valid fixture set — only the tag is wrong. Nothing else
    // can be the reason it is refused.
    const shape = runShapeManifest('e5h-testrun01');
    const fake = await startFake(backendFor(shape));
    const r = await runCleanup(
      fake.base,
      writeManifest(d, { ...shape.manifest, runTag: tag }),
      path.join(d, 'receipt.json')
    );
    fake.server.close();
    assert.equal(r.receipt.status, 'MANIFEST_UNUSABLE', `${tag} must not be accepted`);
    assert.equal(mutations(fake.calls).length, 0, `${tag}: nothing may be deleted`);
    assert.equal(fake.accounts.size, 9, 'the accounts are untouched');
    assert.equal(fake.docs.size, 74, 'the documents are untouched');
  });
}

await test('EVERY harness’s real generated run tag is one the cleaner accepts', async () => {
  // The cross-check that did not exist. Each harness's tag expression is read
  // out of its own source and evaluated, so this compares what the harnesses
  // ACTUALLY mint against what the cleaner ACTUALLY accepts — not two copies
  // of a constant that were written to agree.
  const { isOwnedRunTag } = await import('../run-tag.mjs');
  const harnesses = [
    ['hosted-package-e-smoke.mjs', 'e5h-'],
    ['hosted-player-journey.mjs', 'e5j-'],
    ['social-privacy-postop.mjs', 'e5p-'],
  ];
  for (const [file, expectedPrefix] of harnesses) {
    const src = fs.readFileSync(path.resolve('.github/wsf-staging', file), 'utf8');
    const m = /^const runTag = (`[^`]+`);$/m.exec(src);
    assert.notEqual(m, null, `${file}: no single-line runTag assignment found — this check must be updated, not deleted`);
    // Evaluate the harness's own template with the same inputs it uses.
    const tag = new Function('Date', 'crypto', `return ${m[1]};`)(Date, crypto);
    assert.ok(tag.startsWith(expectedPrefix), `${file} mints ${tag}, which does not start with ${expectedPrefix}`);
    assert.ok(
      isOwnedRunTag(tag),
      `${file} mints ${tag}, which cleanup-synthetic.mjs REFUSES — this is exactly the defect that stranded run 35495928362's fixtures on staging`
    );
  }
});

await test('the owned-prefix list names every harness, so adding one cannot be a silent regex edit', async () => {
  const { OWNED_RUN_TAG_PREFIXES } = await import('../run-tag.mjs');
  assert.deepEqual(Object.keys(OWNED_RUN_TAG_PREFIXES).sort(), ['e5h-', 'e5j-', 'e5p-']);
  for (const [prefix, owner] of Object.entries(OWNED_RUN_TAG_PREFIXES)) {
    assert.ok(/\.mjs/.test(owner), `${prefix} does not name the harness that mints it`);
    assert.ok(
      fs.existsSync(path.resolve('.github/wsf-staging', owner.split(' ')[0])),
      `${prefix} names ${owner.split(' ')[0]}, which does not exist`
    );
  }
});

console.log(`\ncleanup-synthetic: ${passed} passed`);
