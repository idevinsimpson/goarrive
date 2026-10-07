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
  ownCreditOf, receiptVerdict, requireVerdict, results, runJourney, servedManifest, sharedOf, showsNumber,
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

test('binding: empty reviewed manifest BLOCKED; exact PASS; a changed entry page, or changed, extra or missing assets FAIL', () => {
  assert.equal(Object.keys(REVIEWED_BUILD.assets).length, 0, 'nothing is reviewed yet, so every run stops in the gate');
  assert.equal(REVIEWED_BUILD.indexSha256, null);
  const INDEX = sha(SITE['/']);
  const seen = { indexSha256: INDEX, assets: OBSERVED };
  assert.equal(bindBuild(seen).status, 'BLOCKED');
  assert.equal(bindBuild(seen, { assets: { ...OBSERVED } }).status, 'BLOCKED', 'assets without the entry page digest are not a reviewed manifest');
  assert.equal(bindBuild(seen, { indexSha256: INDEX, assets: {} }).status, 'BLOCKED', 'an entry page digest without assets is not a reviewed manifest');
  const reviewed = { indexSha256: INDEX, assets: { ...OBSERVED } };
  assert.equal(bindBuild(seen, reviewed).status, 'PASS');
  assert.equal(bindBuild({ indexSha256: sha(SITE['/'] + '<script>alert(1)</script>'), assets: OBSERVED }, reviewed).status, 'FAIL', 'identical assets behind a changed entry page (inline script) do not pass');
  assert.equal(bindBuild({ assets: OBSERVED }, reviewed).status, 'FAIL', 'no observed entry digest');
  assert.equal(bindBuild({ indexSha256: INDEX, assets: { ...OBSERVED, 'shell-AAA.js': sha('changed') } }, reviewed).status, 'FAIL');
  assert.equal(bindBuild({ indexSha256: INDEX, assets: { ...OBSERVED, 'extra-ZZZ.js': sha('x') } }, reviewed).status, 'FAIL');
  const { 'index-CCC.css': _, ...missing } = OBSERVED;
  assert.equal(bindBuild({ indexSha256: INDEX, assets: missing }, reviewed).status, 'FAIL');
  const lines = bindLines(seen, bindBuild(seen));
  assert.match(lines[0], /^LOVABLE_BUILD=BLOCKED/);
  assert.equal(lines[1], `LOVABLE_OBSERVED_INDEX ${INDEX}`);
  assert.deepEqual(lines.slice(2), Object.entries(OBSERVED).map(([n, d]) => `LOVABLE_OBSERVED_ASSET ${n} ${d}`), 'names and digests only, never content');
});

// ---- receipt, results and verdict ------------------------------------------------------------------
// The connected app's canonical wsfContribute exchange: the request carries goal, attempt and count; the response
// carries only {addedCount, ownCredit, alreadyRecorded, sharedTotal, target, unit, status, crossedTarget}.
const CANON_REQ = { goalId: 'g', attemptId: 'at1', count: 7 };
const CANON_RES = { addedCount: 7, ownCredit: 7, alreadyRecorded: false, sharedTotal: 107, target: 5000, unit: 'squats', status: 'active', crossedTarget: false };
const want = (screenText) => ({ goalId: 'g', amount: 7, unit: 'squats', screenText });

test('receipt (reproducer #365 6045688233): the canonical response is accepted; a replay or the wrong screen total is not', () => {
  const ok = receiptVerdict({ data: CANON_REQ, result: CANON_RES }, want('+7 squats · Together 107 squats'));
  assert.equal(ok.ok, true, ok.seen);
  assert.equal(ok.attemptId, 'at1', 'the attempt comes from the request');
  assert.equal(ok.shared, 107);
  assert.equal(receiptVerdict({ data: CANON_REQ, result: { ...CANON_RES, alreadyRecorded: true } }, want('Together 107 squats')).ok, false, 'replay');
  for (const screen of ['Together 100 squats', 'Together 1,107 squats', 'Together 1070 squats', 'Together 10.7 squats']) {
    assert.equal(receiptVerdict({ data: CANON_REQ, result: CANON_RES }, want(screen)).ok, false, screen);
  }
});

test('receipt: request this goal, count 7 and an attempt; response 7 added, not a replay, integer totals, the goal unit', () => {
  const screen = 'Together 107 squats';
  for (const [name, data, result] of [
    ['6 added', CANON_REQ, { ...CANON_RES, addedCount: 6 }],
    ['another goal', { ...CANON_REQ, goalId: 'h' }, CANON_RES],
    ['count 6 sent', { ...CANON_REQ, count: 6 }, CANON_RES],
    ['no attempt', { ...CANON_REQ, attemptId: undefined }, CANON_RES],
    ['empty attempt', { ...CANON_REQ, attemptId: '' }, CANON_RES],
    ['alreadyRecorded missing', CANON_REQ, { ...CANON_RES, alreadyRecorded: undefined }],
    ['other unit', CANON_REQ, { ...CANON_RES, unit: 'reps' }],
    ['fractional total', CANON_REQ, { ...CANON_RES, sharedTotal: 107.5 }],
    ['no own credit', CANON_REQ, { ...CANON_RES, ownCredit: undefined }],
    ['no result', CANON_REQ, null],
    ['no request', null, CANON_RES],
  ]) assert.equal(receiptVerdict({ data, result }, want(screen)).ok, false, name);
  assert.equal(receiptVerdict(null, want(screen)).ok, false, 'no exchange');
  assert.equal(receiptVerdict({ data: CANON_REQ, result: CANON_RES }, want('Together 107 reps')).ok, false, 'screen without the unit');
});

test('showsNumber: the exact whole number, en-US grouped or plain, never a fragment of another number', () => {
  assert.equal(showsNumber('Together 1,107 squats', 1107), true);
  assert.equal(showsNumber('Together 1107 squats', 1107), true);
  for (const [t, n] of [['11,107', 1107], ['1,1070', 1107], ['1107.5', 1107], ['107', 1107], ['x', 1.5]]) assert.equal(showsNumber(t, n), false, t);
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
/**
 * A fake of the connected Lovable app and its backend, built from the app's own source (connected-kiosk, join, move,
 * together, progress, menu). One server; each context has its own storage. Every callable is a request object with
 * its OWN response, delivered to the page's listeners in that order. `bug` switches on one defect at a time.
 */
function lovable(bug = {}) {
  const goalId = 'e5cgoal-e5c-t-1-lk';
  const groupId = 'e5cgrp-e5c-t-1-lk';
  const server = { shared: 100, own: {}, members: new Set(), contributions: 0, approved: false, requests: [] };
  const accounts = {};
  let ctxCount = 0;
  const browser = {
    async newContext() {
      ctxCount += 1;
      const store = { local: {}, session: {}, idbUid: null };
      let closed = false;
      return { async newPage() { return page(store); }, async close() { closed = true; browser.closed += 1; }, get closed() { return closed; } };
    },
    closed: 0,
  };
  function page(store) {
    let view = 'blank';
    let move = null; // null | 'camera' | 'count' | 'review' | 'receipt'
    let attempt = null;
    let typed = 0;
    let email = '';
    let lastReceipt = null;
    const listeners = { request: [], response: [] };
    const uid = () => store.idbUid;
    const call = (name, data, result) => {
      const req = { url: () => `https://us-central1-westayfit-staging.cloudfunctions.net/${name}`, method: () => 'POST', postData: () => JSON.stringify({ data }) };
      server.requests.push({ name, data, uid: uid() });
      for (const f of listeners.request) f(req);
      const res = { request: () => req, json: async () => ({ result }) };
      for (const f of listeners.response) f(res);
    };
    const hydrate = () => {
      if (!uid()) return;
      const chosen = store.local[`wsf.currentCommunity.${uid()}`] ?? store.local[`wsf.pinnedDestination.${uid()}`];
      if (server.members.has(uid()) && chosen === groupId) {
        const drift = bug.aOwnOnReturn && uid() === 'uid-lka' && server.aSignIns >= 2 ? bug.aOwnOnReturn : 0;
        call('wsfMyContribution', { goalId }, { ownCredit: (server.own[uid()] ?? 0) + drift, unit: 'squats', repeatPolicy: 'multiple' });
        call('wsfGoalPulse', { goalId }, { sharedTotal: server.shared + (bug.pulseDrift ?? 0), target: 1000, unit: 'squats', status: 'active' });
      }
      if (bug.bReadsA && uid() === 'uid-lkb') call('wsfMyContribution', { goalId }, { ownCredit: 7, unit: 'squats', repeatPolicy: 'multiple' });
    };
    const fmt = (n) => n.toLocaleString('en-US');
    const progressText = () => {
      const show = (uid() && server.members.has(uid()) && (server.own[uid()] ?? 0) > 0) || (bug.bSeesRow && uid() === 'uid-lkb');
      return show ? `Fixture Expo Squats Yours ${fmt(server.own['uid-lka'] ?? 0)} squats Shared ${fmt(bug.rowTotal ?? server.shared + (bug.pulseDrift ?? 0))} / 1,000 squats` : null;
    };
    const el = (key, scope = null) => {
      const self = {
        first() { return self; },
        filter() { return self; },
        getByRole: (_, o) => el(`role:${o.name instanceof RegExp ? 'community' : o.name}`, key),
        async waitFor() { if (!(await self.count())) throw new Error(`${key} never appeared`); },
        async count() {
          switch (key) {
            case 'testid:kiosk-pair-code': return view === 'kiosk' ? 1 : 0;
            case 'css:svg[data-testid="kiosk-qr"]': return view === 'kiosk' && server.approved && !bug.noJoinCode ? 1 : 0;
            case 'text:This goal has no join code to show.': return view === 'kiosk' && bug.noJoinCode ? 1 : 0;
            case 'css:[data-connected-join]': case 'role:Join': return uid() && store.session['wsf.pendingJoinCode'] && !bug.noJoinButton ? 1 : 0;
            case 'testid:join-move-phone': return view === 'choose' ? 1 : 0;
            case 'css:section.together-receipt': return move === 'receipt' ? 1 : 0;
            case 'css:ul.goal-history li': return progressText() ? 1 : 0;
            case 'role:Skip tour': return 0;
            case 'role:Count by hand instead': return move === 'camera' ? 1 : 0;
            case 'role:Enter reps manually': case 'role:I’m done — enter my count': return 0;
            case 'nav:Your communities': return uid() && !store.local[`wsf.currentCommunity.${uid()}`] ? 1 : 0;
            default: return 1;
          }
        },
        async innerText() {
          if (key === 'testid:kiosk-pair-code') return 'ABC234';
          if (key === 'css:section.together-receipt') return lastReceipt;
          if (key === 'css:ul.goal-history li') return progressText();
          return '';
        },
        async getAttribute(name) {
          if (name === 'data-join-url') return `${bug.qrOrigin ?? LOVABLE_URL}/?join=JOINCODE0123456789&goal=${goalId}`;
          if (name === 'data-attempt') return bug.otherAttempt ? 'attempt-other0000' : attempt;
          return null;
        },
        async fill(v) {
          if (key === 'label:Email') email = v;
          else if (key === 'label:Password') { if (accounts[email]?.password !== v) throw new Error('wrong password'); }
          else typed = Number(v);
        },
        async click() {
          if (key === 'role:Sign in') { store.idbUid = bug.aReturnsAs && email.includes('lka') && server.signedA ? bug.aReturnsAs : accounts[email].uid; if (email.includes('lka')) { server.signedA = true; server.aSignIns = (server.aSignIns ?? 0) + 1; } if (store.idbUid === bug.aReturnsAs) { server.own[bug.aReturnsAs] = server.own['uid-lka']; server.members.add(bug.aReturnsAs); } hydrate(); }
          else if (key === 'role:Join') {
            const already = server.members.has(uid());
            server.members.add(uid());
            call('wsfJoinCommunity', { joinCode: store.session['wsf.pendingJoinCode'] }, { groupId: bug.otherGroup ? 'other-group' : groupId, alreadyMember: bug.alreadyMember ?? already });
            view = 'choose';
          } else if (key === 'testid:join-move-phone') {
            store.local[`wsf.pinnedDestination.${uid()}`] = groupId; delete store.session['wsf.pendingJoinCode']; delete store.session['wsf.pendingJoinGoal'];
            view = 'home'; hydrate(); move = 'camera'; attempt = `attempt-${server.contributions + 1}abcdefgh`;
          } else if (key === 'role:Count by hand instead') move = 'count';
          else if (key === 'role:Review') move = 'review';
          else if (key === 'testid:confirm') {
            server.contributions += 1;
            const added = bug.addedCount ?? typed;
            server.shared += added; server.own[uid()] = (server.own[uid()] ?? 0) + added;
            call('wsfContribute', { goalId: bug.otherGoal ? 'e5cgoal-other' : goalId, attemptId: attempt, count: typed },
              { addedCount: added, ownCredit: bug.receiptOwn ?? server.own[uid()], alreadyRecorded: !!bug.alreadyRecorded, sharedTotal: server.shared, target: 1000, unit: bug.unit ?? 'squats', status: 'active', crossedTarget: false });
            if (bug.doubleSend) call('wsfContribute', { goalId, attemptId: attempt, count: typed }, { addedCount: 0, ownCredit: server.own[uid()], alreadyRecorded: true, sharedTotal: server.shared, target: 1000, unit: 'squats', status: 'active', crossedTarget: false });
            if (bug.pendingLeft) store.local[`wsf.pendingContribution.${goalId}.${uid()}`] = '{}';
            move = 'receipt';
            lastReceipt = `YOU ADDED +${fmt(added)} squats ${fmt(bug.screenTotal ?? server.shared)} / 1,000 · shared total from the server`;
          } else if (key === 'testid:together-done') move = null;
          else if (key === 'role:MOVE — add a contribution') {
            move = bug.replayReceipt ? 'receipt' : 'camera'; attempt = `attempt-${server.contributions + 1}abcdefgh`;
            if (bug.resendOnReopen) call('wsfContribute', { goalId, attemptId: attempt, count: typed }, { addedCount: typed, ownCredit: server.own[uid()], alreadyRecorded: true, sharedTotal: server.shared, unit: 'squats' });
          } else if (key === 'role:Open menu') { /* opens the sheet */ }
          else if (key === 'role:/^Sign out/' || key === 'role:Sign out') { store.idbUid = null; }
          else if (key === 'role:community' && scope === 'nav:Your communities') { store.local[`wsf.currentCommunity.${uid()}`] = groupId; hydrate(); }
        },
      };
      return self;
    };
    return {
      on(type, f) { listeners[type]?.push(f); },
      async goto(u) {
        const url = new URL(u, LOVABLE_URL);
        if (url.pathname.startsWith('/kiosk/')) { view = 'kiosk'; return; }
        if (url.searchParams.get('join')) { store.session['wsf.pendingJoinCode'] = url.searchParams.get('join'); store.session['wsf.pendingJoinGoal'] = url.searchParams.get('goal'); }
        view = 'home'; move = null; hydrate();
      },
      async reload() { move = null; hydrate(); },
      async waitForTimeout() {},
      async evaluate(fn, arg) {
        const src = String(fn);
        if (src.includes('firebaseLocalStorageDb')) return uid();
        if (src.includes('sessionStorage')) return ['wsf.pendingJoinCode', 'wsf.pendingJoinGoal'].filter((k) => store.session[k] !== undefined).length;
        if (src.includes('localStorage.getItem')) return store.local[arg] ?? null;
        throw new Error('unexpected evaluate');
      },
      keyboard: { async press() { move = null; } },
      getByTestId: (id) => el(`testid:${id}`),
      getByRole: (role, o) => el(role === 'navigation' ? `nav:${o.name}` : `role:${o.name instanceof RegExp ? o.name.toString() : o.name}`),
      getByLabel: (l) => el(`label:${l}`),
      getByText: (t) => el(`text:${t}`),
      locator: (css) => el(`css:${css}`),
    };
  }
  const tracked = { contributions: [], approvals: 0 };
  const fixtures = {
    async expoEvent(label) { return { setupId: `${label}: one synthetic community`, groupId, goalId }; },
    async memberInTwoCommunities(label) { const m = { uid: `uid-${label}`, email: `wsf-e5c-t-1-${label}@example.com`, password: `pw-${label}` }; accounts[m.email] = m; return { member: m }; },
    async approveStation(ev, code, slot) { assert.equal(code, 'ABC234'); assert.equal(slot, 1); server.approved = !bug.approvalLost; tracked.approvals += 1; return { stationId: 's1', slot }; },
    trackContribution(ev, member, attemptId) { tracked.contributions.push([member.uid, attemptId]); },
  };
  return { browser, fixtures, server, tracked, opened: () => ctxCount };
}
const statusOf = (rows, id) => rows[id]?.status;
const PASSING = ['fixture-provenance', 'qr-join', 'contribution-7', 'operation-receipt', 'own-history-shared', 'reopen-static', 'account-isolation'];

test('journey: A joins through the QR, records 7 once (bound to its request), re-reads, reopens static, and A -> B -> A stays isolated', async () => {
  const L = lovable();
  const { rows, productDocs } = await runJourney({ browser: L.browser, fixtures: L.fixtures, base: LOVABLE_URL });
  for (const id of PASSING) assert.equal(statusOf(rows, id), 'PASS', `${id}: ${rows[id]?.seen}`);
  assert.equal(L.server.contributions, 1, 'exactly one contribution');
  assert.deepEqual(L.tracked.contributions, [['uid-lka', 'attempt-1abcdefgh']], 'the attempt is tracked from its request');
  assert.deepEqual(productDocs, ['wsfMemberships/e5cgrp-e5c-t-1-lk_uid-lka'], 'the join\'s membership is tracked from its request');
  assert.equal(L.browser.closed, L.opened(), 'every context is closed');
  for (const id of Object.keys(FIXED_BLOCKED)) assert.equal(rows[id], undefined, `${id} is never measured by the journey`);
  assert.doesNotMatch(JSON.stringify(results(rows)), /pw-lk|@example\.com|uid-lk|JOINCODE/, 'no password, email, raw uid or join code in the results');
});

test('journey negatives: each defect fails exactly the row that measures it; nothing is passed by default', async () => {
  const cases = [
    [{ addedCount: 6 }, 'operation-receipt'], [{ alreadyRecorded: true }, 'operation-receipt'], [{ screenTotal: 7 }, 'operation-receipt'],
    [{ unit: 'reps' }, 'operation-receipt'], [{ otherAttempt: true }, 'contribution-7'], [{ otherGoal: true }, 'contribution-7'],
    [{ rowTotal: 1 }, 'own-history-shared'], [{ replayReceipt: true }, 'reopen-static'], [{ resendOnReopen: true }, 'reopen-static'],
    [{ pendingLeft: true }, 'reopen-static'], [{ bReadsA: true }, 'account-isolation'], [{ bSeesRow: true }, 'account-isolation'],
    [{ aReturnsAs: 'uid-someone-else' }, 'account-isolation'], [{ otherGroup: true }, 'qr-join'], [{ noJoinButton: true }, 'qr-join'],
    [{ qrOrigin: 'https://evil.example.test' }, 'qr-join'], [{ alreadyMember: true }, 'qr-join'], [{ doubleSend: true }, 'contribution-7'],
    [{ receiptOwn: 8 }, 'own-history-shared'], [{ pulseDrift: 5 }, 'own-history-shared'], [{ aOwnOnReturn: 3 }, 'account-isolation'],
  ];
  for (const [bug, row] of cases) {
    const L = lovable(bug);
    const { rows } = await runJourney({ browser: L.browser, fixtures: L.fixtures, base: LOVABLE_URL });
    assert.equal(statusOf(rows, row), 'FAIL', `${JSON.stringify(bug)} must fail ${row}: ${rows[row]?.seen}`);
    assert.equal(L.browser.closed, L.opened(), `${JSON.stringify(bug)}: every context is closed`);
  }
});

test('journey: a contribution whose assertions fail is still tracked for cleanup; an early stop closes the kiosk', async () => {
  let L = lovable({ addedCount: 6 });
  let r = await runJourney({ browser: L.browser, fixtures: L.fixtures, base: LOVABLE_URL });
  assert.equal(statusOf(r.rows, 'operation-receipt'), 'FAIL');
  assert.equal(L.tracked.contributions.length, 1, 'tracked though the receipt failed');
  L = lovable({ approvalLost: true });
  r = await runJourney({ browser: L.browser, fixtures: L.fixtures, base: LOVABLE_URL });
  assert.equal(statusOf(r.rows, 'qr-join'), 'FAIL');
  assert.equal(L.server.contributions, 0);
  assert.deepEqual(r.productDocs, []);
  assert.equal(L.browser.closed, L.opened(), 'the kiosk context is closed on the early return');
  L = lovable({ noJoinCode: true });
  r = await runJourney({ browser: L.browser, fixtures: L.fixtures, base: LOVABLE_URL });
  assert.equal(statusOf(r.rows, 'qr-join'), 'BLOCKED', 'a community the kit cannot make link-joinable is BLOCKED, not passed');
});

test('canonical shapes: ownCredit is read for the selected goal only, and null is never a number', () => {
  assert.equal(ownCreditOf({ data: { goalId: 'g' }, result: { ownCredit: 7, unit: 'squats' } }, 'g'), 7);
  assert.equal(ownCreditOf({ data: { goalId: 'h' }, result: { ownCredit: 7 } }, 'g'), null, 'another goal');
  assert.equal(ownCreditOf({ data: { goalId: 'g' }, result: { total: 7 } }, 'g'), null, 'no invented field');
  assert.equal(ownCreditOf(null, 'g'), null);
  assert.equal(sharedOf({ data: { goalId: 'g' }, result: { sharedTotal: 107 } }, 'g'), 107);
  assert.equal(sharedOf({ data: { goalId: 'g' }, result: {} }, 'g'), null);
  assert.equal(sharedOf({ data: { goalId: 'h' }, result: { sharedTotal: 107 } }, 'g'), null, 'another goal');
  assert.equal(sharedOf({ data: { goalId: 'g' }, result: { sharedTotal: 107.5 } }, 'g'), null, 'not a whole number');
});

for (const [name, fn] of pending) { await fn(); passed += 1; console.log(`  ok  ${name}`); }
console.log(`hosted-lovable-kiosk: ${passed} passed`);
