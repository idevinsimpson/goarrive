#!/usr/bin/env node
/**
 * hosted-lovable-kiosk.mjs, offline: the exact-host check, the served-build binding (empty, changed, extra, missing,
 * exact), the receipt and verdict rules, the run-tagged cleanup merge, and the journey against a scripted fake of the
 * Lovable UI and the existing fixture kit. No network, no credential, no browser.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FIXED_BLOCKED, LOVABLE_URL, REVIEWED_BUILD, ROWS, allPassed, bindBuild, bindLines, checkBase, idHash, mergeIntoManifest,
  receiptVerdict, requireVerdict, results, runJourney, servedManifest,
} from '../hosted-lovable-kiosk.mjs';

let passed = 0;
const pending = [];
const test = (name, fn) => pending.push([name, fn]);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---- host and build binding ----------------------------------------------------------------------
test('only exactly the Lovable host is accepted', () => {
  assert.deepEqual(checkBase(LOVABLE_URL), { ok: true, base: LOVABLE_URL });
  assert.equal(checkBase(`${LOVABLE_URL}/`).ok, true);
  for (const bad of ['http://we-stay-fit-foundation-trial.lovable.app', 'https://id-preview--e15b9fa0-b2a0-4314-bc21-9c573b8eceb1.lovable.app',
    `${LOVABLE_URL}/kiosk`, `${LOVABLE_URL}/?x=1`, `${LOVABLE_URL}#a`, 'https://user:pw@we-stay-fit-foundation-trial.lovable.app', 'https://we-stay-fit-foundation-trial.lovable.app.evil.test',
    'https://westayfit-staging--staging-4a616y5m.web.app', '', undefined, 'not a url']) {
    assert.equal(checkBase(bad).ok, false, String(bad));
  }
});

function site(files) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    assert.equal(init.redirect, 'error', 'redirects are never followed');
    const p = new URL(url).pathname;
    if (files[p] === undefined) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(files[p]) };
  };
  return { fetchImpl, calls };
}
const SITE = {
  '/': '<html><script type="module" src="/assets/shell-AAA.js"></script><link rel="stylesheet" href="/assets/index-CCC.css"></html>',
  '/assets/shell-AAA.js': 'import("./connected-kiosk-BBB.js");import "https://cdn.example.test/assets/evil.js";',
  '/assets/connected-kiosk-BBB.js': 'export const k=1;',
  '/assets/index-CCC.css': 'body{}',
};
const OBSERVED = { 'connected-kiosk-BBB.js': sha(SITE['/assets/connected-kiosk-BBB.js']), 'index-CCC.css': sha(SITE['/assets/index-CCC.css']), 'shell-AAA.js': sha(SITE['/assets/shell-AAA.js']) };

test('the served manifest walks same-origin assets only and hashes each one', async () => {
  const s = site(SITE);
  const m = await servedManifest(s.fetchImpl);
  assert.deepEqual(m.assets, OBSERVED);
  assert.equal(m.indexSha256, sha(SITE['/']));
  assert.ok(s.calls.every((u) => u.startsWith(`${LOVABLE_URL}/`)), 'never another origin');
  await assert.rejects(servedManifest(site({ ...SITE, '/assets/connected-kiosk-BBB.js': undefined }).fetchImpl), /HTTP 404|answered/);
  await assert.rejects(servedManifest(site({ '/': '<html></html>' }).fetchImpl), /names no asset/);
});

test('binding: empty reviewed manifest BLOCKED; exact PASS; changed, extra or missing FAIL', () => {
  assert.equal(Object.keys(REVIEWED_BUILD.assets).length, 0, 'nothing is reviewed yet, so every run stops in the gate');
  assert.equal(bindBuild({ assets: OBSERVED }).status, 'BLOCKED');
  const reviewed = { assets: { ...OBSERVED } };
  assert.equal(bindBuild({ assets: OBSERVED }, reviewed).status, 'PASS');
  assert.equal(bindBuild({ assets: { ...OBSERVED, 'shell-AAA.js': sha('changed') } }, reviewed).status, 'FAIL');
  assert.equal(bindBuild({ assets: { ...OBSERVED, 'extra-ZZZ.js': sha('x') } }, reviewed).status, 'FAIL');
  const { 'index-CCC.css': _, ...missing } = OBSERVED;
  assert.equal(bindBuild({ assets: missing }, reviewed).status, 'FAIL');
  const lines = bindLines({ assets: OBSERVED }, bindBuild({ assets: OBSERVED }));
  assert.match(lines[0], /^LOVABLE_BUILD=BLOCKED/);
  assert.deepEqual(lines.slice(1), Object.entries(OBSERVED).map(([n, d]) => `LOVABLE_OBSERVED_ASSET ${n} ${d}`), 'names and digests only, never content');
});

// ---- receipt, results and verdict ------------------------------------------------------------------
test('receipt: only this goal, an attempt, exactly 7 added and a shared total the screen shows', () => {
  const ok = { receipt: { goalId: 'g', attemptId: 'at1', addedCount: 7, sharedTotal: 1107 } };
  assert.equal(receiptVerdict(ok, { goalId: 'g', amount: 7, screenText: 'Together 1,107 squats' }).ok, true);
  for (const [name, r, screen] of [
    ['6 added', { receipt: { ...ok.receipt, addedCount: 6 } }, '1,107'], ['another goal', { receipt: { ...ok.receipt, goalId: 'h' } }, '1,107'],
    ['no attempt', { receipt: { ...ok.receipt, attemptId: undefined } }, '1,107'], ['screen disagrees', ok, '1,100'], ['no result', null, '1,107'],
    ['fractional total', { receipt: { ...ok.receipt, sharedTotal: 1107.5 } }, '1107.5'],
  ]) assert.equal(receiptVerdict(r, { goalId: 'g', amount: 7, screenText: screen }).ok, false, name);
});

test('results: every row in order; the station rows and the unverified account are BLOCKED by name unless measured', () => {
  const doc = results({ 'host-build': { status: 'PASS', seen: 'x' } });
  assert.deepEqual(doc.rows.map((r) => r.id), ROWS.map((r) => r.id));
  for (const id of Object.keys(FIXED_BLOCKED)) assert.equal(doc.rows.find((r) => r.id === id).status, 'BLOCKED', id);
  assert.match(doc.rows.find((r) => r.id === 'round-60s').seen, /#587/);
  assert.equal(doc.rows.find((r) => r.id === 'qr-join').seen, 'not reached');
  assert.equal(allPassed(doc), false);
  assert.equal(allPassed(results(Object.fromEntries(ROWS.map((r) => [r.id, { status: 'PASS', seen: '' }])))), true);
  assert.doesNotMatch(JSON.stringify(results({ 'qr-join': { status: 'FAIL', seen: 'sign in as wsf-e5c-x-lka-ab12@example.com?token=abc' } })), /@example\.com|token=abc/, 'emails and query values are scrubbed');
});

test('require: PASS only on every row PASS, cleanup success and scan success; BLOCKED and FAIL are named', () => {
  const all = results(Object.fromEntries(ROWS.map((r) => [r.id, { status: 'PASS', seen: '' }])));
  assert.equal(requireVerdict(all, { cleanup: 'success', scan: 'success' }).ok, true);
  for (const o of [{ cleanup: 'failure', scan: 'success' }, { cleanup: 'success', scan: 'failure' }, { cleanup: 'skipped', scan: 'success' }, {}]) assert.equal(requireVerdict(all, o).ok, false, JSON.stringify(o));
  const blocked = requireVerdict(results({ 'host-build': { status: 'PASS' } }), { cleanup: 'success', scan: 'success' });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.lines.includes('LOVABLE_KIOSK_PROOF=BLOCKED'));
  assert.ok(requireVerdict(results({ 'qr-join': { status: 'FAIL' } }), { cleanup: 'success', scan: 'success' }).lines.includes('LOVABLE_KIOSK_PROOF=FAIL'));
  assert.ok(requireVerdict(null, { cleanup: 'success', scan: 'success' }).lines.includes('LOVABLE_KIOSK_PROOF=FAIL'), 'no results is a failure');
});

test('cleanup merge: run-tagged product documents are added once; anything untagged refuses the whole merge', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-lk-')), 'm.json');
  fs.writeFileSync(file, JSON.stringify({ project: 'westayfit-staging', runTag: 'e5c-t-1', users: ['u'], docs: ['wsfGoals/e5cgoal-e5c-t-1-lk'], linkedDocs: [] }));
  assert.equal(mergeIntoManifest(file, ['wsfMemberships/e5cgrp-e5c-t-1-lk_uidA', 'wsfMemberships/e5cgrp-e5c-t-1-lk_uidA']), 2);
  for (const bad of [['wsfMemberships/realgroup_uidA'], ['../e5c-t-1/x'], ['/wsfMemberships/e5c-t-1']]) {
    assert.throws(() => mergeIntoManifest(file, bad), /untagged/);
  }
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).docs.length, 2, 'a refused merge writes nothing');
  assert.equal(idHash('uid-1'), sha('uid-1').slice(0, 16));
  assert.equal(idHash(''), null);
});

// ---- the journey against a scripted Lovable UI ------------------------------------------------------
/** A fake of the Lovable UI and backend: one server, many contexts; per-context localStorage holds the signed-in uid. */
function lovable({ addedCount = 7, replayReceipt = false, joinShown = true, bSeesA = false, resendOnReload = false, aReturnsAs = null, qrOrigin = LOVABLE_URL } = {}) {
  const server = { shared: 100, own: {}, members: new Set(), contributions: 0, pairCode: 'ABC123', approved: false };
  const accounts = {};
  const signIns = {};
  const browser = {
    contexts: 0,
    async newContext() {
      browser.contexts += 1;
      const storage = {};
      return {
        async newPage() { return page(storage); },
        async close() {},
      };
    },
  };
  function page(storage) {
    let url = '';
    let view = 'none';
    let receipt = false;
    let typed = 0;
    const listeners = [];
    const reply = (name, result) => { for (const f of listeners) f({ url: () => `${LOVABLE_URL}/api/${name}`, request: () => ({ method: () => 'POST' }), json: async () => ({ result }) }); };
    const uid = () => storage.uid ?? null;
    const readOwn = () => { if (uid()) reply('wsfMyContribution', { total: server.own[uid()] ?? 0 }); reply('wsfGoalPulse', { sharedTotal: server.shared }); };
    let email = '';
    const el = (key) => ({
      async waitFor() { if (!(await this.count())) throw new Error(`${key} never appeared`); },
      async count() {
        if (key === 'testid:kiosk-pair-code') return view === 'kiosk' ? 1 : 0;
        if (key === 'testid:kiosk-qr') return view === 'kiosk' && server.approved ? 1 : 0;
        if (key === 'role:Join') return joinShown && uid() && !server.members.has(uid()) && view === 'join' ? 1 : 0;
        if (key === 'testid:join-move-phone') return view === 'joined' ? 1 : 0;
        if (key === 'css:.together-receipt') return receipt ? 1 : 0;
        return 1;
      },
      first() { return this; },
      async innerText() { return key === 'testid:kiosk-pair-code' ? ` ${server.pairCode} ` : `Together ${server.shared.toLocaleString('en-US')} squats`; },
      async getAttribute() { return `${qrOrigin}/join?join=CODE&goal=${server.goalId}`; },
      async fill(v) {
        if (key === 'label:Email') email = v;
        else if (key === 'label:Password') { if (accounts[email]?.password !== v) throw new Error('wrong password'); }
        else typed = Number(v);
      },
      async click() {
        if (key === 'role:Sign in') { signIns[email] = (signIns[email] ?? 0) + 1; storage.uid = aReturnsAs && signIns[email] > 1 && email.includes('lka') ? aReturnsAs : accounts[email].uid; if (storage.uid === aReturnsAs) server.own[aReturnsAs] = server.own['uid-lka']; readOwn(); }
        else if (key === 'role:Join') { server.members.add(uid()); view = 'joined'; }
        else if (key === 'role:Contribute') {
          server.contributions += 1; server.shared += typed; server.own[uid()] = (server.own[uid()] ?? 0) + typed; receipt = true;
          reply('wsfContribute', { receipt: { goalId: server.goalId, attemptId: `at${server.contributions}`, addedCount, sharedTotal: server.shared } });
        } else if (key === 'role:Sign out') { delete storage.uid; receipt = bSeesA; }
      },
    });
    return {
      on(_, f) { listeners.push(f); },
      async goto(u) { url = u; view = u.includes('/kiosk/') ? 'kiosk' : u.includes('join=') ? 'join' : 'home'; if (!u.includes('/kiosk/')) readOwn(); },
      async reload() { receipt = replayReceipt; if (resendOnReload) reply('wsfContribute', { receipt: { goalId: server.goalId, attemptId: 'at-again', addedCount, sharedTotal: server.shared } }); readOwn(); },
      async waitForTimeout() {},
      async evaluate() { return uid(); },
      getByTestId: (id) => el(`testid:${id}`),
      getByRole: (_, o) => el(`role:${o.name}`),
      getByLabel: (l) => el(`label:${l}`),
      locator: (css) => el(`css:${css}`),
      url: () => url,
    };
  }
  const tracked = { contributions: [], approvals: 0 };
  const fixtures = {
    async expoEvent(label) { server.goalId = `e5cgoal-e5c-t-1-${label}`; return { setupId: `${label}: one synthetic community`, groupId: `e5cgrp-e5c-t-1-${label}`, goalId: server.goalId }; },
    async memberInTwoCommunities(label) { const m = { uid: `uid-${label}`, email: `wsf-e5c-t-1-${label}@example.com`, password: `pw-${label}` }; accounts[m.email] = m; return { member: m }; },
    async approveStation(ev, code, slot) { assert.equal(code, server.pairCode); assert.equal(slot, 1); server.approved = true; tracked.approvals += 1; return { stationId: 's1', slot }; },
    trackContribution(ev, member, attemptId) { tracked.contributions.push([member.uid, attemptId]); },
  };
  return { browser, fixtures, server, tracked };
}
const statusOf = (rows, id) => rows[id]?.status;

test('journey: A joins through the QR, records 7 once, re-reads, reopens static, and A -> B -> A stays isolated', async () => {
  const L = lovable();
  const { rows, productDocs } = await runJourney({ browser: L.browser, fixtures: L.fixtures, base: LOVABLE_URL });
  for (const id of ['fixture-provenance', 'qr-join', 'contribution-7', 'operation-receipt', 'own-history-shared', 'reopen-static', 'account-isolation']) assert.equal(statusOf(rows, id), 'PASS', `${id}: ${rows[id]?.seen}`);
  assert.equal(L.server.contributions, 1, 'exactly one contribution');
  assert.deepEqual(L.tracked.contributions, [['uid-lka', 'at1']], 'the attempt is tracked for cleanup');
  assert.deepEqual(productDocs, ['wsfMemberships/e5cgrp-e5c-t-1-lk_uid-lka'], 'the join\'s membership is tracked for cleanup');
  assert.equal(L.tracked.approvals, 1);
  for (const id of Object.keys(FIXED_BLOCKED)) assert.equal(rows[id], undefined, `${id} is never measured by the journey`);
  assert.doesNotMatch(JSON.stringify(results(rows)), /pw-lk|@example\.com|uid-lk/, 'no password, email or raw uid in the results');
});

test('journey: a wrong receipt, a replayed receipt, a missing Join and a leaking switch each fail their own row', async () => {
  let r = await runJourney({ ...lovable({ addedCount: 6 }), base: LOVABLE_URL });
  assert.equal(statusOf(r.rows, 'operation-receipt'), 'FAIL');
  assert.equal(statusOf(r.rows, 'contribution-7'), 'FAIL');
  r = await runJourney({ ...lovable({ replayReceipt: true }), base: LOVABLE_URL });
  assert.equal(statusOf(r.rows, 'reopen-static'), 'FAIL');
  r = await runJourney({ ...lovable({ joinShown: false }), base: LOVABLE_URL });
  assert.equal(statusOf(r.rows, 'qr-join'), 'FAIL');
  assert.equal(r.rows['contribution-7'], undefined, 'nothing is contributed without the join');
  assert.deepEqual(r.productDocs, []);
  r = await runJourney({ ...lovable({ bSeesA: true }), base: LOVABLE_URL });
  assert.equal(statusOf(r.rows, 'account-isolation'), 'FAIL');
  r = await runJourney({ ...lovable({ resendOnReload: true }), base: LOVABLE_URL });
  assert.equal(statusOf(r.rows, 'reopen-static'), 'FAIL', 'a second contribution on reopen fails');
  r = await runJourney({ ...lovable({ aReturnsAs: 'uid-someone-else' }), base: LOVABLE_URL });
  assert.equal(statusOf(r.rows, 'account-isolation'), 'FAIL', 'A must come back as the same identity');
  r = await runJourney({ ...lovable({ qrOrigin: 'https://evil.example.test' }), base: LOVABLE_URL });
  assert.equal(statusOf(r.rows, 'qr-join'), 'FAIL', 'a QR pointing at another host is never followed');
  assert.deepEqual(r.productDocs, []);
});

test('journey: a kiosk that never shows its QR stops before any visitor signs in', async () => {
  const L = lovable();
  L.fixtures.approveStation = async () => ({ stationId: 's1', slot: 1 }); // approval never lands
  const { rows, productDocs } = await runJourney({ browser: L.browser, fixtures: L.fixtures, base: LOVABLE_URL });
  assert.equal(statusOf(rows, 'qr-join'), 'FAIL');
  assert.equal(L.server.contributions, 0);
  assert.deepEqual(productDocs, []);
});

for (const [name, fn] of pending) { await fn(); passed += 1; console.log(`  ok  ${name}`); }
console.log(`hosted-lovable-kiosk: ${passed} passed`);
