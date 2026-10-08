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
  API_ORIGINS, FIXED_BLOCKED, LOVABLE_URL, REVIEWED_BUILD, ROWS, allPassed, bindBuild, bindLines, browserEnv, checkBase, classifyRequest,
  codeGuard, hostBuildRow, idHash, mergeIntoManifest, ownCreditOf, receiptVerdict, requireVerdict, results, runJourney, runResults, servedManifest,
  sharedOf, showsNumber,
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
/** The served build the fake host serves, and its reviewed manifest (what a pinned REVIEWED_BUILD would hold). */
const FAKE_INDEX = '<!doctype html><script type="module" src="/assets/shell-AAA.js"></script><link rel="stylesheet" href="/assets/index-CCC.css">';
const FAKE_ASSETS = { '/assets/shell-AAA.js': 'export const shell=1;', '/assets/kiosk-BBB.js': 'export const kiosk=1;', '/assets/index-CCC.css': 'body{}' };
const FAKE_REVIEWED = Object.freeze({ indexSha256: sha(FAKE_INDEX), assets: Object.freeze(Object.fromEntries(Object.entries(FAKE_ASSETS).map(([p, b]) => [p.slice(8), sha(b)]))) });

function lovable(bug = {}) {
  const goalId = 'e5cgoal-e5c-t-1-lk';
  const groupId = 'e5cgrp-e5c-t-1-lk';
  const server = { shared: 100, own: {}, members: new Set(), contributions: 0, approved: false, requests: [], contextOpts: [], routed: 0, docs: 0, loads: [], passwordFills: 0 };
  const accounts = {};
  let ctxCount = 0;
  /** What the host answers for one URL. Drift, a different deep link, a redirect and a changed chunk are switchable. */
  const serve = (url) => {
    const u = new URL(url);
    if (u.origin !== LOVABLE_URL) return { status: 200, body: 'globalThis.foreign = 1;' };
    if (u.pathname.startsWith('/assets/')) {
      if (!Object.hasOwn(FAKE_ASSETS, u.pathname)) return { status: bug.extraChunk && u.pathname === '/assets/extra-ZZZ.js' ? 200 : 404, body: 'export const extra=1;' };
      return { status: 200, body: bug.changedChunk && u.pathname === '/assets/kiosk-BBB.js' ? 'export const kiosk=2;' : FAKE_ASSETS[u.pathname] };
    }
    server.docs += 1;
    if (bug.redirectDoc) return { status: 302, body: '' };
    if (bug.deepLinkDiffers && u.pathname.startsWith('/kiosk/')) return { status: 200, body: `${FAKE_INDEX}<script>inline()</script>` };
    if (bug.driftAfter && server.docs > bug.driftAfter) return { status: 200, body: `${FAKE_INDEX}<!-- republished -->` };
    return { status: 200, body: FAKE_INDEX };
  };
  /** One browser request through the context's route handler, as Playwright delivers it; resolves to what the handler did. */
  async function load(context, url, type, navigation) {
    let outcome = 'unhandled';
    const route = {
      request: () => ({ url: () => url, resourceType: () => type, isNavigationRequest: () => navigation }),
      async fetch(o) { assert.equal(o?.maxRedirects, 0, 'a verified response never follows a redirect'); const r = serve(url); return { status: () => r.status, body: async () => Buffer.from(r.body) }; },
      async fulfill({ body }) { outcome = 'fulfilled'; server.loads.push({ url, type, body: String(body) }); },
      async continue() { outcome = 'continued'; },
      async abort() { outcome = 'aborted'; },
    };
    assert.equal(context.handlers.length, 1, 'every context routes every request through the guard');
    server.routed += 1;
    await context.handlers[0](route);
    return outcome;
  }
  /** A page load: the document, then what it loads (the kiosk chunk on the kiosk route), plus any injected defect. */
  async function pageLoad(context, url) {
    if ((await load(context, url, 'document', true)) !== 'fulfilled') throw new Error(`page.goto: net::ERR_BLOCKED_BY_CLIENT at ${new URL(url).origin}${new URL(url).pathname}`);
    const subs = [[`${LOVABLE_URL}/assets/shell-AAA.js`, 'script'], [`${LOVABLE_URL}/assets/index-CCC.css`, 'stylesheet'], [`${LOVABLE_URL}/favicon.ico`, 'image']];
    if (new URL(url).pathname.startsWith('/kiosk/')) subs.push([`${LOVABLE_URL}/assets/kiosk-BBB.js`, 'script']);
    if (bug.foreignScript) subs.push(['https://cdn.example.test/x.js', 'script']);
    if (bug.foreignOnJoin && new URL(url).searchParams.has('join')) subs.push(['https://cdn.example.test/join.js', 'script']);
    if (bug.extraChunk) subs.push([`${LOVABLE_URL}/assets/extra-ZZZ.js`, 'script']);
    for (const [s, t] of subs) await load(context, s, t, false);
  }
  const browser = {
    async newContext(opts) {
      ctxCount += 1;
      server.contextOpts.push(opts);
      const store = { local: {}, session: {}, idbUid: null };
      let closed = false;
      const context = {
        handlers: [],
        async route(pattern, handler) { assert.equal(pattern, '**/*'); context.handlers.push(handler); },
        async newPage() { return page(store, context); },
        async close() { closed = true; browser.closed += 1; },
        get closed() { return closed; },
      };
      return context;
    },
    closed: 0,
  };
  function page(store, context) {
    let current = null;
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
          else if (key === 'label:Password') { server.passwordFills += 1; if (accounts[email]?.password !== v) throw new Error('wrong password'); }
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
            if (bug.lateForeignScript) await load(context, 'https://cdn.example.test/late.js', 'script', false);
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
        await pageLoad(context, url.href);
        current = url.href;
        if (url.pathname.startsWith('/kiosk/')) { view = 'kiosk'; return; }
        if (url.searchParams.get('join')) { store.session['wsf.pendingJoinCode'] = url.searchParams.get('join'); store.session['wsf.pendingJoinGoal'] = url.searchParams.get('goal'); }
        view = 'home'; move = null; hydrate();
      },
      async reload() { await pageLoad(context, current); move = null; hydrate(); },
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
  const { rows, productDocs, served } = await runJourney({ browser: L.browser, fixtures: L.fixtures, base: LOVABLE_URL, reviewed: FAKE_REVIEWED });
  assert.deepEqual(served.violations, [], 'the browser loaded only the reviewed build');
  assert.equal(hostBuildRow({ status: 'PASS', reason: 'bind' }, served).status, 'PASS');
  assert.equal(served.verified, L.server.loads.length);
  const reviewedDigests = new Set([FAKE_REVIEWED.indexSha256, ...Object.values(FAKE_REVIEWED.assets)]);
  assert.ok(L.server.loads.length >= 10 && L.server.loads.every((x) => reviewedDigests.has(sha(x.body))), 'every executed document and asset is fulfilled with exactly the reviewed bytes');
  assert.ok(L.server.contextOpts.length === L.opened() && L.server.contextOpts.every((o) => o.serviceWorkers === 'block'), 'no service worker can answer around the guard');
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
    const { rows } = await runJourney({ browser: L.browser, fixtures: L.fixtures, base: LOVABLE_URL, reviewed: FAKE_REVIEWED });
    assert.equal(statusOf(rows, row), 'FAIL', `${JSON.stringify(bug)} must fail ${row}: ${rows[row]?.seen}`);
    if (bug.qrOrigin) assert.match(rows['qr-join'].seen, /the QR carries no same-host join link/, 'refused by the QR check itself, before any navigation');
    assert.equal(L.browser.closed, L.opened(), `${JSON.stringify(bug)}: every context is closed`);
  }
});

test('journey: a contribution whose assertions fail is still tracked for cleanup; an early stop closes the kiosk', async () => {
  let L = lovable({ addedCount: 6 });
  let r = await runJourney({ browser: L.browser, fixtures: L.fixtures, base: LOVABLE_URL, reviewed: FAKE_REVIEWED });
  assert.equal(statusOf(r.rows, 'operation-receipt'), 'FAIL');
  assert.equal(L.tracked.contributions.length, 1, 'tracked though the receipt failed');
  L = lovable({ approvalLost: true });
  r = await runJourney({ browser: L.browser, fixtures: L.fixtures, base: LOVABLE_URL, reviewed: FAKE_REVIEWED });
  assert.equal(statusOf(r.rows, 'qr-join'), 'FAIL');
  assert.equal(L.server.contributions, 0);
  assert.deepEqual(r.productDocs, []);
  assert.equal(L.browser.closed, L.opened(), 'the kiosk context is closed on the early return');
  L = lovable({ noJoinCode: true });
  r = await runJourney({ browser: L.browser, fixtures: L.fixtures, base: LOVABLE_URL, reviewed: FAKE_REVIEWED });
  assert.equal(statusOf(r.rows, 'qr-join'), 'BLOCKED', 'a community the kit cannot make link-joinable is BLOCKED, not passed');
});

// ---- the served-code guard (#589 W9 finding #497 6051520120): bind what the browser EXECUTES ----------------------
test('guard negatives: drift after bind, a deep link with other bytes, a redirect, a foreign, unreviewed or changed script: refused, host-build FAIL, and the journey stops before any password is typed', async () => {
  for (const [bug, named] of [
    [{ driftAfter: 1 }, /document https:\/\/we-stay-fit-foundation-trial\.lovable\.app\/ differs from its reviewed digest/],
    [{ deepLinkDiffers: true }, /document https:\/\/we-stay-fit-foundation-trial\.lovable\.app\/kiosk\/e5cgrp-e5c-t-1-lk\/e5cgoal-e5c-t-1-lk differs/],
    [{ redirectDoc: true }, /answered HTTP 302, not the reviewed file/],
    [{ foreignScript: true }, /script https:\/\/cdn\.example\.test\/x\.js is outside the reviewed build/],
    [{ foreignOnJoin: true }, /script https:\/\/cdn\.example\.test\/join\.js is outside the reviewed build/],
    [{ extraChunk: true }, /script https:\/\/we-stay-fit-foundation-trial\.lovable\.app\/assets\/extra-ZZZ\.js is not a reviewed asset/],
    [{ changedChunk: true }, /assets\/kiosk-BBB\.js differs from its reviewed digest/],
  ]) {
    const L = lovable(bug);
    const r = await runJourney({ browser: L.browser, fixtures: L.fixtures, base: LOVABLE_URL, reviewed: FAKE_REVIEWED });
    const row = hostBuildRow({ status: 'PASS', reason: 'bind' }, r.served);
    assert.equal(row.status, 'FAIL', JSON.stringify(bug));
    assert.match(row.seen, named, JSON.stringify(bug));
    assert.doesNotMatch(row.seen, /join=|JOINCODE|\?/, 'no query in what is named');
    assert.equal(L.server.passwordFills, 0, `${JSON.stringify(bug)}: no password is typed into an unreviewed build`);
    if (!bug.driftAfter && !bug.foreignOnJoin) assert.equal(L.tracked.approvals, 0, `${JSON.stringify(bug)}: an unreviewed kiosk is never approved (it would receive the station secret)`);
    assert.equal(L.server.contributions, 0, `${JSON.stringify(bug)}: nothing is written`);
    assert.deepEqual(r.productDocs, []);
    assert.ok(!PASSING.some((id) => id !== 'fixture-provenance' && statusOf(r.rows, id) === 'PASS'), `${JSON.stringify(bug)}: no product row passes on an unreviewed build`);
    assert.equal(L.browser.closed, L.opened(), `${JSON.stringify(bug)}: every context is closed`);
  }
  // A foreign script requested later in the run (a lazy load) is refused too, and fails host-build after the fact.
  const late = lovable({ lateForeignScript: true });
  const r = await runJourney({ browser: late.browser, fixtures: late.fixtures, base: LOVABLE_URL, reviewed: FAKE_REVIEWED });
  assert.match(hostBuildRow({ status: 'PASS' }, r.served).seen, /script https:\/\/cdn\.example\.test\/late\.js is outside/);
  assert.equal(hostBuildRow({ status: 'PASS' }, r.served).status, 'FAIL');
  assert.ok(!late.server.loads.some((x) => x.url.includes('cdn.example.test')), 'the foreign script was never fulfilled');
  // The production default is REVIEWED_BUILD (empty here): the browser is refused the very first document.
  const empty = lovable();
  const e = await runJourney({ browser: empty.browser, fixtures: empty.fixtures, base: LOVABLE_URL });
  assert.match(hostBuildRow({ status: 'PASS' }, e.served).seen, /no reviewed digest is pinned/);
  assert.equal(empty.server.passwordFills, 0);
});

test('classifyRequest: the reviewed host verifies documents and /assets/ code; API origins pass data only; everything else is refused', () => {
  const R = FAKE_REVIEWED;
  const L = LOVABLE_URL;
  const c = (url, type, navigation = false) => classifyRequest({ url, type, navigation }, R);
  assert.deepEqual(c(`${L}/kiosk/g/x?join=SECRETCODE`, 'document', true), { action: 'verify', want: R.indexSha256, what: `document ${L}/kiosk/g/x` });
  assert.equal(c(`${L}/assets/shell-AAA.js`, 'script').want, R.assets['shell-AAA.js']);
  assert.equal(c(`${L}/assets/index-CCC.css`, 'stylesheet').want, R.assets['index-CCC.css']);
  for (const [url, type] of [[`${L}/favicon.ico`, 'image'], [`${L}/font.woff2`, 'font'], [`${L}/manifest.json`, 'manifest']]) assert.equal(c(url, type).action, 'continue', `${type}`);
  for (const o of API_ORIGINS) for (const t of ['fetch', 'xhr', 'eventsource']) assert.equal(c(`${o}/v1/x?key=abc`, t).action, 'continue', `${o} ${t}`);
  for (const [url, type, nav] of [
    [`${L}/assets/other-ZZZ.js`, 'script'], [`${L}/sw.js`, 'script'], [`${L}/elsewhere/shell-AAA.js`, 'script'], [`${L}/assets/sub/shell-AAA.js`, 'script'], [`${L}/assets/shell-AAA.js/../x.js`, 'script'], [`${L}/x`, 'websocket'],
    ['https://identitytoolkit.googleapis.com/x.js', 'script'], ['https://firestore.googleapis.com/', 'document', true], ['https://us-central1-westayfit-staging.cloudfunctions.net/x', 'image'],
    ['https://cdn.example.test/x.js', 'script'], ['https://fonts.googleapis.com/css', 'stylesheet'], ['https://evil.example.test/api', 'fetch'],
    ['https://we-stay-fit-foundation-trial.lovable.app.evil.test/', 'document', true], ['http://we-stay-fit-foundation-trial.lovable.app/', 'document', true], ['not a url', 'script'],
  ]) {
    const v = c(url, type, nav);
    assert.equal(v.action, 'abort', `${type} ${url}`);
    assert.doesNotMatch(v.reason, /key=|\?/, 'never a query');
  }
  assert.equal(classifyRequest({ url: `${L}/`, type: 'document', navigation: true }).want, null, 'the production default (empty) pins no document');
});

test('codeGuard: fulfils exactly the hashed bytes once verified; refuses a redirect, an error, other bytes or an unreadable answer; check() throws after any refusal', async () => {
  const route = (url, type, navigation, answer) => {
    const out = {};
    return { out, r: {
      request: () => ({ url: () => url, resourceType: () => type, isNavigationRequest: () => navigation }),
      async fetch(o) { out.maxRedirects = o?.maxRedirects; if (answer instanceof Error) throw answer; return { status: () => answer.status, body: async () => Buffer.from(answer.body) }; },
      async fulfill({ body }) { out.fulfilled = String(body); },
      async continue() { out.continued = true; },
      async abort(code) { out.aborted = code; },
    } };
  };
  const g = codeGuard(FAKE_REVIEWED);
  const ok = route(`${LOVABLE_URL}/kiosk/a/b`, 'document', true, { status: 200, body: FAKE_INDEX });
  await g.handle(ok.r);
  assert.deepEqual(ok.out, { maxRedirects: 0, fulfilled: FAKE_INDEX });
  const api = route('https://firestore.googleapis.com/v1/x', 'xhr', false, null);
  await g.handle(api.r);
  assert.deepEqual(api.out, { continued: true });
  g.check();
  assert.deepEqual(g.summary(), { verified: 1, violations: [] });
  for (const [answer, why] of [[{ status: 302, body: '' }, /HTTP 302/], [{ status: 500, body: FAKE_INDEX }, /HTTP 500/], [{ status: 200, body: `${FAKE_INDEX} ` }, /differs/], [new Error('net::ERR_FAILED https://x?token=abc'), /could not be read/]]) {
    const one = codeGuard(FAKE_REVIEWED);
    const x = route(`${LOVABLE_URL}/`, 'document', true, answer);
    await one.handle(x.r);
    assert.equal(x.out.aborted, 'blockedbyclient');
    assert.equal(x.out.fulfilled, undefined, 'nothing unverified is fulfilled');
    assert.match(one.summary().violations[0], why);
    assert.doesNotMatch(one.summary().violations[0], /token=abc/);
    assert.throws(() => one.check(), /served code outside the reviewed build/);
  }
  const foreign = codeGuard(FAKE_REVIEWED);
  const f = route('https://cdn.example.test/x.js', 'script', false, { status: 200, body: 'x' });
  await foreign.handle(f.r);
  assert.equal(f.out.maxRedirects, undefined, 'a refused request is never fetched');
  assert.equal(f.out.aborted, 'blockedbyclient');
});

test('runResults: host-build in the written results is the bind joined with what the browser was served, never the bind alone', () => {
  const allRows = Object.fromEntries(ROWS.map((r) => [r.id, { status: 'PASS', seen: '' }]));
  const clean = runResults({ status: 'PASS', reason: 'bind' }, { rows: allRows, served: { verified: 5, violations: [] } });
  assert.equal(clean.rows.find((r) => r.id === 'host-build').status, 'PASS');
  assert.equal(allPassed(clean), true);
  for (const journey of [{ rows: allRows, served: { verified: 5, violations: ['script https://cdn.example.test/x.js is outside'] } }, { rows: allRows }, { rows: { ...allRows, 'host-build': { status: 'PASS', seen: 'claimed by the journey' } }, served: { verified: 0, violations: [] } }]) {
    const doc = runResults({ status: 'PASS', reason: 'bind' }, journey, { 'cleanup-tracking': { status: 'PASS', seen: '' } });
    assert.equal(doc.rows.find((r) => r.id === 'host-build').status, 'FAIL', JSON.stringify(journey.served));
    assert.equal(allPassed(doc), false);
  }
  assert.equal(runResults({ status: 'BLOCKED', reason: 'nothing pinned' }, { rows: {} }).rows.find((r) => r.id === 'host-build').status, 'BLOCKED');
});

test('hostBuildRow and browserEnv: PASS needs the bind, a verified load and no refusal; the browser gets no cloud or workflow credential', () => {
  assert.deepEqual(hostBuildRow({ status: 'BLOCKED', reason: 'nothing pinned' }, { verified: 3, violations: [] }), { status: 'BLOCKED', seen: 'nothing pinned' });
  assert.equal(hostBuildRow({ status: 'PASS' }, undefined).status, 'FAIL', 'the browser never ran');
  assert.equal(hostBuildRow({ status: 'PASS' }, { verified: 0, violations: [] }).status, 'FAIL');
  assert.equal(hostBuildRow({ status: 'PASS' }, { verified: 4, violations: ['script x'] }).status, 'FAIL');
  assert.equal(hostBuildRow({ status: 'PASS' }, { verified: 4, violations: [] }).status, 'PASS');
  const env = browserEnv({ PATH: '/bin', HOME: '/h', WSF_RESULT_DIR: '/r', WSF_GOOGLE_ACCESS_TOKEN: 't', GOOGLE_APPLICATION_CREDENTIALS: '/k', GOOGLE_CLOUD_PROJECT: 'p', CLOUDSDK_AUTH_ACCESS_TOKEN_FILE: '/f', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'o', ACTIONS_ID_TOKEN_REQUEST_URL: 'u', ACTIONS_RUNTIME_TOKEN: 'r', GITHUB_TOKEN: 'g', GH_TOKEN: 'h' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/h', WSF_RESULT_DIR: '/r' });
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
