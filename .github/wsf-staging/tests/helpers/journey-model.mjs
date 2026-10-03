/**
 * Shared test model for the changed-journey drivers: an in-memory Identity
 * Toolkit + Firestore (also served over HTTP in the shape cleanup-synthetic.mjs
 * speaks), the real fixture kit bound to it, and a scripted page modelling the
 * product's rendered contract: Community and Settings at 938e00d8, and Home
 * (/community/<groupId>) with its contribute screens at a3127651
 * (HOME-NORTHSTAR-PARITY-1). Used by changed-journey-drivers,
 * journey-activation and home-journey. Test code only.
 *
 * expoHarness (EXPO-ATTENDEE-HOSTED-DRIVERS-1) adds the expo attendee surfaces
 * at 5705dc3b: the event page, the member's queue page, enrolled station
 * screens, the contribution screen (phone and kiosk mode) and the shared kiosk,
 * each device its own context over ONE modelled turn service. The service
 * writes the same documents the product's callables write, so the REAL
 * cleaner can show that a driver tracked every one of them.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createFixtureKit } from '../../journeys/fixture-kit.mjs';

const CLEANUP = path.resolve('.github/wsf-staging/cleanup-synthetic.mjs');
const PROJECT = 'westayfit-staging';
export const RUN_TAG = 'e5c-testrun01';
export const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-cjd-'));

// ---- an in-memory Identity Toolkit + Firestore --------------------------------------
export function backend() {
  const accounts = new Map(); // uid -> email
  const passwords = new Map(); // email -> password (the model's sign-in only)
  const docs = new Map(); // path -> fields
  const requests = [];
  const callables = {}; // name -> (data, uid) => result, installed by expoServer
  let n = 0;
  const reply = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
  const fetchImpl = async (url, { method = 'GET', headers = {}, body } = {}) => {
    const parsed = body ? JSON.parse(body) : undefined;
    requests.push({ url, method, admin: headers.authorization === 'Bearer admin-token', body: parsed });
    if (url.includes('accounts:signUp')) {
      const uid = `Uid${String(++n).padStart(25, '0')}`;
      accounts.set(uid, parsed.email);
      passwords.set(parsed.email, parsed.password);
      return reply(200, { localId: uid });
    }
    if (url.includes('accounts:signInWithPassword')) {
      const uid = [...accounts].find(([, e]) => e === parsed.email)?.[0];
      if (!uid || passwords.get(parsed.email) !== parsed.password) return reply(400, { error: { message: 'INVALID_LOGIN_CREDENTIALS' } });
      return reply(200, { idToken: `tok:${uid}` });
    }
    const fn = /\/(wsf[A-Za-z]+)$/.exec(new URL(url).pathname)?.[1];
    if (fn && callables[fn]) {
      const uid = /^Bearer tok:(.+)$/.exec(headers.authorization || '')?.[1] || null;
      try { return reply(200, { result: callables[fn](parsed?.data || {}, uid) }); } catch (e) { return reply(400, { error: { status: e.status || 'FAILED_PRECONDITION', message: e.message } }); }
    }
    const m = /\/documents\/([^?]+)/.exec(url);
    if (m && method === 'PATCH') {
      const p = decodeURIComponent(m[1]);
      const mask = [...new URL(url).searchParams.getAll('updateMask.fieldPaths')];
      docs.set(p, mask.length ? { ...(docs.get(p) || {}), ...parsed.fields } : parsed.fields);
      return reply(200, {});
    }
    if (m && method === 'GET') {
      const p = decodeURIComponent(m[1]);
      return docs.has(p) ? reply(200, { name: p, fields: docs.get(p) }) : reply(404, { error: { status: 'NOT_FOUND' } });
    }
    return reply(404, { error: { status: 'NOT_FOUND' } });
  };
  return { accounts, passwords, docs, requests, callables, fetchImpl };
}

/** The same state served over HTTP in the shape cleanup-synthetic.mjs speaks. */
export function serve(be, { failDeletes = false } = {}) {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const json = (s, b) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
      const body = raw ? JSON.parse(raw) : {};
      if (req.url.includes('accounts:lookup')) {
        const users = (body.localId || []).filter((id) => be.accounts.has(id)).map((id) => ({ localId: id, email: be.accounts.get(id) }));
        return json(200, users.length ? { users } : {});
      }
      if (req.url.includes('accounts:batchDelete')) { for (const id of body.localIds || []) be.accounts.delete(id); return json(200, {}); }
      const m = /\/documents\/(.+)$/.exec(req.url);
      const p = m ? decodeURIComponent(m[1]) : null;
      if (req.method === 'DELETE' && failDeletes) return json(503, { error: { status: 'UNAVAILABLE' } });
      if (req.method === 'DELETE') { if (!be.docs.has(p)) return json(404, { error: { status: 'NOT_FOUND' } }); be.docs.delete(p); return json(200, {}); }
      if (req.method === 'GET') return be.docs.has(p) ? json(200, { name: p, fields: be.docs.get(p) }) : json(404, { error: { status: 'NOT_FOUND' } });
      return json(400, { error: { status: 'UNEXPECTED' } });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}
export function runCleanup(base, manifest, receipt) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLEANUP], {
      env: { ...process.env, WSF_GOOGLE_ACCESS_TOKEN: 'test-token', WSF_CLEANUP_MANIFEST: manifest, WSF_CLEANUP_RECEIPT: receipt, WSF_API_BASE: base },
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out, receipt: JSON.parse(fs.readFileSync(receipt, 'utf8')) }));
  });
}
export function kitFor(dir, be) {
  return createFixtureKit({
    projectId: PROJECT, apiKey: 'test-api-key', token: 'admin-token', runTag: RUN_TAG,
    cleanupManifest: path.join(dir, 'cleanup-manifest.json'), fetchImpl: be.fetchImpl,
    now: () => new Date('2026-09-26T12:00:00Z'),
  });
}

// ---- a scripted page modelling the product's rendered contract ------------------------
export function fakeApp(fx, bugs = {}) {
  const st = { signedIn: false, path: '/', search: '', history: [], lastHome: null, sheet: null, selected: null, panel: false, typed: {}, pressed: [] };
  const serverOrder = bugs.serverOrderBFirst ? [fx.b, fx.a] : [fx.a, fx.b];
  const current = () => st.selected || serverOrder[0];
  const homeOf = (p) => [fx.a, fx.b].find((c) => p === `/community/${c.id}`) || null;
  const onTabs = () => st.signedIn && (['/', '/community', '/you'].includes(st.path) || homeOf(st.path) !== null);
  const go = (p, search = '') => { st.history.push({ path: st.path, search: st.search }); st.path = p; st.search = search; if (homeOf(p)) st.lastHome = p; };
  // The seeded goal facts the product would read back (fixture-kit.mjs: A 500 / 120, B 1000 / 200, squats).
  const seeded = (c) => (c === fx.a ? { target: 500, shared: 120 } : { target: 1000, shared: 200 });
  const block = (c) => [c.name, c === fx.b ? 'CHAMPION' : '', 'Show my name and initials',
    c.nameVisible ? 'Members see “Jordan Journey”' : (bugs.noAnonymousHint ? 'Hidden' : 'Members see “Anonymous member”'),
    'Show my individual activity'].filter(Boolean).join('\n');
  function node(id) {
    if (st.path === '/signin') {
      if (id === 'wsf-signin-email' || id === 'wsf-signin-password') return { fill: (v) => { st.typed[id] = v; } };
      if (id === 'wsf-signin-submit') {
        return { click: () => {
          if (st.typed['wsf-signin-email'] === fx.member.email && st.typed['wsf-signin-password'] === fx.member.password) { st.signedIn = true; st.path = '/'; }
        } };
      }
    }
    if (id === 'wsf-member-tab-you' && onTabs()) return { click: () => { st.path = '/you'; } };
    // HOME at a3127651: /community/<groupId> in the Home tab's stack.
    if (id === 'wsf-member-tab-community' && onTabs()) return { click: () => go('/community') };
    if (id === 'wsf-member-tab-home' && onTabs()) return { click: () => go(bugs.homeTabLosesCommunity ? '/' : (st.lastHome || '/')) };
    const home = st.signedIn ? homeOf(st.path) : null;
    if (home) {
      const c = bugs.homeShowsOther ? (home === fx.a ? fx.b : fx.a) : home;
      const n = seeded(c);
      const g = c.goalId;
      if (id === 'wsf-community-name') return { text: () => c.name };
      if (id === `wsf-community-goal-title-${g}`) return { text: () => c.goalTitle };
      if (bugs.otherGoalLeaks && id === `wsf-community-goal-title-${(c === fx.a ? fx.b : fx.a).goalId}`) return { text: () => 'leaked' };
      // The pill's text is "Open · Ends Thu, Oct 1"; its served style (heroStatePill, textTransform: uppercase)
      // makes innerText read it in capitals, as run 57 measured. The model reads it the way the served page does.
      if (id === `wsf-community-goal-period-${g}`) return { text: () => (bugs.windowClosed ? 'Ended Sep 20' : 'Open · Ends Thu, Oct 1').toUpperCase() };
      if (id === `wsf-community-goal-total-${g}`) return { text: () => `${bugs.totalOff ? n.shared + 1 : n.shared} of ${n.target} squats` };
      if (id === `wsf-community-your-part-${g}`) {
        const own = bugs.fabricatedOwn ? `You’ve added ${n.shared} squats`
          : bugs.ownFigureBesideZero ? `Your first contribution counts here.\nYou’ve added ${n.shared} squats` : 'Your first contribution counts here.';
        return { text: () => `Your contribution to this goal\n${own}\nPart of our shared ${n.shared}` };
      }
      if (id === `wsf-community-your-part-shared-${g}`) return { text: () => `Part of our shared ${bugs.sharedBlended ? 0 : n.shared}` };
      if (id === `wsf-community-goal-link-${g}` && !bugs.noStart) {
        return { attrs: { 'aria-label': 'Start moving' }, click: () => { if (bugs.startGoesNowhere) return; if (bugs.moveAsPage) go(`/contribute/${g}`, `?groupId=${c.id}&mode=move`); else st.sheet = c; } };
      }
      if (id === `wsf-community-goal-record-${g}`) {
        return { attrs: { 'aria-label': bugs.recordUnlabelled ? 'I already moved' : 'Already moved? Record squats' }, click: () => go(`/contribute/${g}`, `?groupId=${c.id}&mode=${bugs.recordOpensMove ? 'move' : 'record'}`) };
      }
    }
    // MOVE's sheet at a3127651: a scrim and panel over the still-mounted Home, whose one exit is Close
    // (wsf-contribute-close). No page chrome, so no wsf-contribute-back inside it.
    if (st.sheet) {
      if (id === 'wsf-contribute-sheet') return {};
      if (id === 'wsf-contribute-move-screen') return {};
      if (id === 'wsf-contribute-goal-title') return { text: () => st.sheet.goalTitle };
      if (id === 'wsf-contribute-close') return { click: () => { if (!bugs.closeBroken) st.sheet = null; } };
      if (bugs.sheetDrawsBack && id === 'wsf-contribute-back') return { click: () => { st.sheet = null; } };
      return null;
    }
    const contributing = st.signedIn ? [fx.a, fx.b].find((c) => st.path === `/contribute/${c.goalId}`) : null;
    if (contributing) {
      const mode = new URLSearchParams(st.search).get('mode');
      if (id === 'wsf-contribute-move-screen' && mode === 'move') return {};
      if (id === 'wsf-contribute-entry-screen' && mode !== 'move') return {};
      if (id === 'wsf-contribute-goal-title') return { text: () => contributing.goalTitle };
      if (id === 'wsf-contribute-back' && !bugs.recordLosesBack) {
        return { click: () => { const prev = st.history.pop(); if (bugs.backLost || !prev) { st.path = '/'; st.search = ''; } else { st.path = prev.path; st.search = prev.search; } } };
      }
    }
    if (st.signedIn && st.path === '/community') {
      const c = current();
      if (id === 'wsf-parity-name') return { text: () => c.name };
      if (id === 'wsf-parity-fact-members') return { text: () => `Members\n${c.members}` };
      if (id === 'wsf-parity-fact-role') return { text: () => `Your role\n${bugs.foundingLabel && c === fx.b ? 'Founding Champion' : c.roleText}` };
      if (id === 'wsf-parity-period-title') return { text: () => c.goalTitle };
      for (const x of [fx.a, fx.b]) {
        if (id === `wsf-parity-chip-${x.id}`) {
          return { attrs: { 'aria-pressed': String(current() === x) }, click: () => { st.pressed.push(x.id); if (!bugs.chipIgnored) st.selected = x; } };
        }
      }
    }
    if (st.signedIn && st.path === '/you') {
      if (id === 'wsf-you-settings') return { click: () => { st.panel = true; } };
      if (st.panel) {
        if (id === 'wsf-settings-panel') return {};
        if (id === 'wsf-settings-close') return { click: () => { if (!bugs.closeBroken) st.panel = false; } };
        for (const c of [fx.a, fx.b]) {
          const nameOn = bugs.nameAlwaysOn ? true : c.nameVisible;
          if (id === `wsf-privacy-panel-name-${c.id}`) return { role: 'switch', attrs: { 'aria-checked': String(nameOn) } };
          if (id === `wsf-privacy-panel-activity-${c.id}`) return { role: 'switch', attrs: { 'aria-checked': String(c.activityVisible) } };
          if (id === `wsf-privacy-panel-block-${c.id}`) return { text: () => block(c) };
        }
      }
    }
    return null;
  }
  function locator(selector) {
    const find = () => {
      const id = /data-testid="([^"]+)"/.exec(selector)?.[1];
      const role = /\[role="([^"]+)"\]/.exec(selector)?.[1];
      const n = id ? node(id) : null;
      return n && (!role || n.role === role) ? n : null;
    };
    const must = () => { const n = find(); if (!n) throw new Error(`locator.waitFor: Timeout exceeded waiting for ${selector}`); return n; };
    const loc = {
      first: () => loc,
      count: async () => (find() ? 1 : 0),
      innerText: async () => { const n = must(); return n.text ? n.text() : ''; },
      getAttribute: async (k) => must().attrs?.[k] ?? null,
      click: async () => { const n = must(); if (!n.click) throw new Error(`${selector} is not clickable`); n.click(); },
      fill: async (v) => must().fill(v),
      isVisible: async () => Boolean(find()),
      waitFor: async ({ state = 'visible' } = {}) => {
        if (state === 'detached' || state === 'hidden') { if (find()) throw new Error(`${selector} is still attached`); return; }
        must();
      },
    };
    return loc;
  }
  const page = {
    // A navigation (a cold load) never keeps a sheet: it is presented only over a warm tab.
    goto: async (url) => { const u = new URL(url); st.sheet = null; go(u.pathname, u.search); },
    // A reload keeps the product's remembered selection; the seeded defect drops it.
    reload: async () => { if (bugs.reloadLosesSelection) st.selected = null; },
    waitForTimeout: async () => {},
    waitForURL: async (pred) => { if (!pred(new URL(`https://staging.example.test${st.path}`))) throw new Error('page.waitForURL: Timeout exceeded'); },
    locator,
    getByTestId: (id) => locator(`[data-testid="${id}"]`),
    evaluate: async () => {
      if (!st.panel) return [];
      const sel = bugs.settingsIgnoresSelection ? serverOrder[0] : current();
      return [sel, ...[fx.a, fx.b].filter((c) => c !== sel)].map((c) => c.id);
    },
    screenshot: async ({ path: p }) => { fs.writeFileSync(p, 'png'); },
  };
  return { page, st };
}

/** The real kit's fixtures, with a page built for them once they exist. */
export function harness(bugs, { dir = tmp() } = {}) {
  const be = backend();
  const kit = kitFor(dir, be);
  let app = null;
  const fixtures = {
    memberInTwoCommunities: async (label) => { const fx = await kit.memberInTwoCommunities(label); app = fakeApp(fx, bugs); return fx; },
    signIn: (page, baseUrl, member) => kit.signIn(app.page, baseUrl, member),
  };
  // The driver receives a proxy page that forwards to the app built after seeding.
  const page = new Proxy({}, { get: (_, k) => (k === 'then' ? undefined : (...a) => app.page[k](...a)) });
  return { dir, be, kit, fixtures, page, app: () => app };
}

// ═════════════════════════════════════════════════════════════════════════════
// EXPO-ATTENDEE-HOSTED-DRIVERS-1: the expo attendee surfaces at 5705dc3b.
// ═════════════════════════════════════════════════════════════════════════════
const NO_SHOW_SENTENCE = 'The screen called you and the 45 seconds ran out, so it moved on. Get back in line and it will call you again.';
const LEASE_MS = 45_000;
const RESULT_MS = 10_000;
const KIOSK_IDLE_MS = 90_000;
const intOf = (f) => Number(f?.integerValue ?? 0);
const fmt = (n) => n.toLocaleString('en-US');
const fail = (message, status = 'FAILED_PRECONDITION') => Object.assign(new Error(message), { status });
const rand = (() => { let i = 0; return (p) => `${p}${String(++i).padStart(6, '0')}`; })();

/**
 * One modelled turn service over the backend's documents. It writes what the
 * product's callables write (stations, pairings, the line, entries, members,
 * receipts, contributions, member totals, recent additions) and NOTHING the
 * driver could not have named, so a cleanup that leaves the store empty proves
 * the driver tracked everything. `bugs` seeds product defects.
 */
export function expoServer(be, bugs = {}) {
  const S = { now: 0, pairings: new Map(), stations: new Map(), entries: new Map(), contributions: new Map() };
  const put = (p, f) => be.docs.set(p, f);
  const goal = (g) => {
    const f = be.docs.get(`wsfGoals/${g}`);
    if (!f) throw fail('no such goal', 'NOT_FOUND');
    return { target: intOf(f.target), status: f.status?.stringValue, unit: f.unit?.stringValue || 'squats' };
  };
  const seededTotal = (g) => [...be.docs].filter(([k]) => k.startsWith(`wsfGoalCounters/${g}/shards/`)).reduce((a, [, f]) => a + intOf(f.count), 0);
  const total = (g) => seededTotal(g) + [...S.contributions.values()].filter((c) => c.goalId === g).reduce((a, c) => a + c.count, 0);
  const own = (g, uid) => [...S.contributions.values()].filter((c) => c.goalId === g && c.uid === uid).reduce((a, c) => a + c.count, 0);
  const line = (g) => `goal__${g}`;
  const lapsed = (e) => e.status === 'assigned' && S.now >= e.leaseAt;
  const live = (e) => ['waiting', 'assigned', 'ready', 'active'].includes(e.status) && !lapsed(e);
  const end = (e, status, endedBy) => { e.status = status; e.endedBy = endedBy; be.docs.delete(`wsfTurnMembers/${line(e.goalId)}__${e.uid}`); };
  function contribute(g, uid, attemptId, count) {
    if (goal(g).status !== 'active' && !bugs.closedRecords) throw fail('This goal is closed.');
    const key = `${g}_${uid}_${attemptId}`;
    if (S.contributions.has(key) && !bugs.retryDoubleCounts) return { amount: S.contributions.get(key).count, alreadyRecorded: true };
    S.contributions.set(bugs.retryDoubleCounts && S.contributions.has(key) ? `${key}_again` : key, { goalId: g, uid, count });
    if (bugs.doubleCount) S.contributions.set(`${key}_dup`, { goalId: g, uid, count });
    put(`wsfContributions/${key}`, { goalId: { stringValue: g }, userId: { stringValue: uid }, attemptId: { stringValue: attemptId }, count: { integerValue: String(count) } });
    put(`wsfGoalMemberTotals/${g}_${uid}`, { total: { integerValue: String(own(g, uid)) } });
    put(`wsfGoals/${g}/recentAdditions/${attemptId}`, { count: { integerValue: String(count) } });
    return { amount: count, alreadyRecorded: false };
  }
  const stationFor = (id) => { const st = S.stations.get(id); if (!st) throw fail('not a station'); return st; };
  const serving = (st) => [...S.entries.values()].find((e) => e.stationId === st.id && live(e) && e.status !== 'waiting') || null;
  const waiting = (g) => [...S.entries.values()].filter((e) => e.goalId === g && e.status === 'waiting');
  const api = {
    S, total, own, goal, waiting, serving, live, lapsed,
    advance: (ms) => { S.now += ms; },
    requestPairing(g) {
      const id = rand('pair');
      const code = `PX${String(S.pairings.size + 1).padStart(4, '0')}`;
      S.pairings.set(code, { id, goalId: g, stationId: null });
      put(`wsfKioskPairings/${id}`, { goalId: { stringValue: g }, status: { stringValue: 'pending' } });
      return code;
    },
    join(g, uid, name) {
      const held = [...S.entries.values()].find((e) => e.goalId === g && e.uid === uid && live(e));
      if (held && bugs.joinOnOpen) { held.name = name; return held.id; }
      if (held) throw fail('already in line');
      if (!be.docs.has(`wsfTurnLines/${line(g)}`)) put(`wsfTurnLines/${line(g)}`, { goalId: { stringValue: g } });
      const id = rand('entry');
      // Codes are unique among this line's live entries (the product's rule); a
      // long-lived server across many runs must never run out of them.
      const taken = new Set([...S.entries.values()].filter((e) => e.goalId === g && live(e)).map((e) => e.code));
      const pool = ['K7Q', 'M3P', 'W9X', 'R4T', 'H2N', 'Z8C'];
      const code = bugs.sameCode ? 'K7Q' : pool.find((c) => !taken.has(c)) || `Q${'ABCDEFGHJKLMNPRSTUVWXYZ'[taken.size % 23]}${2 + (taken.size % 8)}`;
      S.entries.set(id, { id, goalId: g, uid, name, code, status: 'waiting', stationId: null, attemptId: null, leaseAt: null, result: null, endedBy: null, seq: S.entries.size });
      put(`wsfTurnEntries/${id}`, { goalId: { stringValue: g }, uid: { stringValue: uid } });
      put(`wsfTurnMembers/${line(g)}__${uid}`, { entryId: { stringValue: id } });
      return id;
    },
    myTurn(g, uid) {
      const mine = [...S.entries.values()].filter((e) => e.goalId === g && e.uid === uid).sort((a, b) => b.seq - a.seq)[0] || null;
      return mine;
    },
    callNext(stationId) {
      const st = stationFor(stationId);
      const held = serving(st);
      if (held) throw fail('This screen is still running a turn.');
      for (const e of S.entries.values()) if (e.stationId === st.id && lapsed(e)) end(e, 'noShow', 'lease');
      const next = waiting(st.goalId).sort((a, b) => a.seq - b.seq)[0];
      if (!next) throw fail('Nobody is waiting.');
      Object.assign(next, { status: 'assigned', stationId: st.id, leaseAt: S.now + (bugs.noShowNotEnded ? 1e12 : LEASE_MS) });
      return next;
    },
    ready(entryId) {
      const e = S.entries.get(entryId);
      if (!e || e.status !== 'assigned' || lapsed(e)) throw fail('not called');
      e.status = 'ready';
      if (bugs.readyOpensOther) for (const o of S.entries.values()) if (o !== e && o.status === 'assigned') o.status = 'ready';
    },
    start(stationId) {
      const st = stationFor(stationId);
      const e = serving(st);
      if (!e || e.status !== 'ready') throw fail('not ready');
      e.status = 'active';
      e.attemptId = rand('turn_');
      put(`wsfTurnEntries/${e.id}`, { goalId: { stringValue: e.goalId }, uid: { stringValue: e.uid }, attemptId: { stringValue: e.attemptId } });
      return e;
    },
    complete(stationId, count) {
      const st = stationFor(stationId);
      const e = [...S.entries.values()].find((x) => x.stationId === st.id && (x.status === 'active' || (x.status === 'done' && x.id === st.lastEntry)));
      if (!e) throw fail('no turn');
      const rec = contribute(e.goalId, e.uid, e.attemptId, count);
      e.result = rec.amount;
      if (e.status !== 'done') { end(e, 'done', 'result'); st.lastEntry = e.id; }
      put(`wsfTurnReceipts/${line(e.goalId)}__${e.uid}`, { amount: { integerValue: String(rec.amount) } });
      st.result = { code: e.code, amount: rec.amount, until: S.now + RESULT_MS, name: e.name };
      return rec;
    },
    leave(entryId, endedBy) {
      const e = S.entries.get(entryId);
      if (!e || !live(e)) throw fail('not in line');
      if (bugs.switchKeepsPlace && endedBy === 'memberToPhone') return;
      end(e, 'left', endedBy);
    },
    cancel(stationId) {
      const st = stationFor(stationId);
      const e = serving(st);
      if (!e) throw fail('nobody to let go');
      end(e, 'left', 'station');
      if (bugs.letGoReceipt) { put(`wsfTurnReceipts/${line(e.goalId)}__${e.uid}`, {}); e.result = 3; }
    },
    contribute,
  };
  be.callables.wsfApproveStation = ({ goalId, code, slot }) => {
    const pairing = S.pairings.get(code);
    if (!pairing || pairing.goalId !== goalId) throw fail('no such code');
    const id = rand('station');
    pairing.stationId = id;
    S.stations.set(id, { id, goalId, slot, label: `Station ${slot}`, result: null, lastEntry: null, pairingCode: code });
    put(`wsfKioskStations/${id}`, { goalId: { stringValue: goalId }, pairingId: { stringValue: pairing.id }, slot: { integerValue: String(slot) } });
    put(`wsfKioskPairings/${pairing.id}`, { goalId: { stringValue: goalId }, stationId: { stringValue: id }, status: { stringValue: 'claimed' } });
    return { stationId: id, slot, label: `Station ${slot}`, goalId };
  };
  be.callables.wsfMyTurn = ({ goalId }, uid) => {
    const e = api.myTurn(goalId, uid);
    return { turn: e && api.live(e) ? { entryId: e.id, code: e.code, status: e.status } : null, receipt: null };
  };
  return api;
}

/**
 * A device: its own context (signed-in account, device answer, offline flag,
 * routes, clock) and its pages, rendering the product's contract from the
 * shared service. Rendering is a fresh read of the service each time, the way
 * the product's 2- and 3-second polls are; an offline device, or a station
 * whose poll is aborted, keeps showing what it last saw.
 */
function expoDevice(be, server, bugs, browser, viewport) {
  const ctx = { uid: null, answered: false, offline: false, returnTo: null, viewport, pages: [], closed: false };
  const context = {
    newPage: async () => { const p = expoPage(be, server, bugs, ctx, context); ctx.pages.push(p); return p; },
    close: async () => { ctx.closed = true; },
    setOffline: async (v) => { ctx.offline = v; for (const p of ctx.pages) { if (v) p.__freeze(); else p.__thaw(); } },
    browser: () => browser,
    __ctx: ctx,
  };
  return context;
}

function expoPage(be, server, bugs, ctx, context) {
  const st = { path: 'about:blank', search: '', typed: {}, review: false, receipt: null, nameOpen: false, routes: [], listeners: [], frozen: null, pollAborted: false, lastStation: null, clock: null, deadline: null, stationError: null, stationCount: '', attemptSeq: 0, kioskSession: false };
  const S = server.S;
  const goalOf = () => /^\/(?:event|queue|station|contribute|kiosk)\/(.+)$/.exec(st.path)?.[1] || null;
  const kioskMode = () => new URLSearchParams(st.search).get('kiosk') === '1';
  const now = () => (st.clock ? st.clock.t : S.now);
  const emit = (url, body) => { for (const l of st.listeners) l({ url: () => url, postData: () => JSON.stringify(body) }); };
  const station = () => [...S.stations.values()].find((x) => x.pairingCode === st.pairing) || null;
  const go = (p, search = '') => { st.path = p; st.search = search; st.review = false; st.receipt = null; st.nameOpen = false; st.stationError = null; };
  const signOut = () => { ctx.uid = null; };
  function routeFor(name) { return st.routes.find((r) => r.matches(name)) || null; }
  /** A callable from this page: honours offline and page.route() like the network does. */
  async function invoke(name, fn) {
    if (ctx.offline) throw fail('offline', 'UNAVAILABLE');
    const r = routeFor(name);
    if (!r) return fn();
    let outcome = { kind: 'continue' };
    let fetched;
    await r.handler({
      fetch: async () => { fetched = fn(); return { status: () => 200 }; },
      abort: async () => { outcome = { kind: 'abort' }; },
      continue: async () => { outcome = { kind: 'continue' }; },
    });
    if (outcome.kind === 'abort') throw fail('internal', 'INTERNAL');
    return fetched === undefined ? fn() : fetched;
  }
  function kioskTick() {
    if (st.deadline !== null && st.receipt && kioskMode() && now() >= st.deadline && !bugs.countdownNoFinish) { st.deadline = null; signOut(); go(`/kiosk/${goalOf()}`); }
  }

  // ---- what each screen renders: id -> node ---------------------------------------------
  function render() {
    kioskTick();
    const N = new Map();
    const add = (id, node = {}) => N.set(id, node);
    const g = goalOf();
    if (st.path === '/signin') {
      add('wsf-signin-email', { fill: (v) => { st.typed.email = v; } });
      add('wsf-signin-password', { fill: (v) => { st.typed.password = v; } });
      add('wsf-signin-submit', { click: async () => {
        const uid = [...be.accounts].find(([, e]) => e === st.typed.email)?.[0];
        if (uid && be.passwords.get(st.typed.email) === st.typed.password) { ctx.uid = uid; const to = ctx.returnTo || '/'; ctx.returnTo = null; const [p, q] = to.split('?'); go(p, q ? `?${q}` : ''); }
      } });
      return N;
    }
    if (st.path.startsWith('/event/')) {
      if (!ctx.answered) { add('wsf-event-device-choice'); add('wsf-device-choice-personal', { text: 'My own phone', click: () => { ctx.answered = true; } }); return N; }
      if (!ctx.uid) { add('wsf-event-signed-out'); return N; }
      add('wsf-event-member');
      add('wsf-event-choice-activity', { text: bugs.activityNotSaid ? 'Choose an activity' : 'squats' });
      add('wsf-event-add', { text: 'Move on my phone', click: () => go(`/contribute/${g}`) });
      add('wsf-event-queue-start', { text: 'Use a kiosk', click: () => { st.nameOpen = true; if (bugs.joinOnOpen) server.join(g, ctx.uid, 'early'); } });
      if (st.nameOpen) {
        add('wsf-event-queue-name', { fill: (v) => { st.typed.name = v; } });
        add('wsf-event-queue-join', { click: async () => { await invoke('wsfJoinTurnLine', () => server.join(g, ctx.uid, st.typed.name)); if (!bugs.noQueuePage) go(`/queue/${g}`); } });
      }
      return N;
    }
    if (st.path.startsWith('/queue/')) {
      add('wsf-queue-screen');
      if (bugs.offlinePhoneClaims && ctx.offline) add('wsf-queue-receipt-amount', { text: '25 squats recorded.' });
      const e = server.myTurn(g, ctx.uid);
      if (e && server.live(e)) {
        if (e.status === 'waiting') {
          add('wsf-queue-waiting', { text: 'You’re in the line' });
          add('wsf-queue-switch-to-phone', { click: async () => { await invoke('wsfLeaveTurnLine', () => server.leave(e.id, 'memberToPhone')); go(`/contribute/${g}`); } });
        } else {
          const stn = S.stations.get(e.stationId);
          add('wsf-queue-called');
          add('wsf-queue-called-name', { text: e.name });
          add('wsf-queue-code', { text: e.code });
          add('wsf-queue-station', { text: `Go to ${bugs.wrongStationLabel ? 'Station 1' : stn.label}.` });
          if (e.status === 'assigned') add('wsf-queue-ready', { click: async () => invoke('wsfTurnReady', () => server.ready(e.id)) });
        }
      } else {
        const noShow = e && (e.status === 'noShow' || server.lapsed(e));
        if (e && e.status === 'done' && !bugs.receiptHidden) add('wsf-queue-receipt-amount', { text: `${e.result} squats recorded.` });
        if (e && e.result !== null && e.status === 'left' && bugs.letGoReceipt) add('wsf-queue-receipt-amount', { text: `${e.result} squats recorded.` });
        add('wsf-queue-not-in-line');
        add('wsf-queue-standing', { text: `${noShow && !bugs.noShowWording ? 'Your turn timed out' : 'You’re not in the line'}\n${noShow ? NO_SHOW_SENTENCE : 'Join from the event page.'}` });
        add('wsf-queue-not-in-line-reason', { text: noShow && !bugs.noShowWording ? NO_SHOW_SENTENCE : 'Join from the event page.' });
      }
      return N;
    }
    if (st.path.startsWith('/contribute/')) {
      add('wsf-contribute-screen');
      if (!ctx.uid) {
        add('wsf-contribute-signed-out');
        add('wsf-contribute-signin-link', { click: () => { ctx.returnTo = `${st.path}${st.search.replace(/^\?/, '?')}`; go('/signin'); } });
        return N;
      }
      const gl = server.goal(g);
      const shared = server.total(g) + (bugs.phoneStale && st.path === `/contribute/${g}` && !st.receipt ? -15 : 0);
      add('wsf-contribute-shared-total', { text: `${fmt(shared)} of ${fmt(gl.target)} squats` });
      add('wsf-contribute-own-credit', { text: `Your total on this goal: ${bugs.nextSeesPrevious && kioskMode() ? 20 : server.own(g, ctx.uid)} squats` });
      if (kioskMode()) add('wsf-kiosk-finish-chrome');
      if (bugs.finishOnPhone && !kioskMode()) add('wsf-kiosk-finish', { text: 'Finish' });
      if (st.receipt) {
        add('wsf-contribute-receipt');
        add('wsf-contribute-result-amount', { text: `You added ${st.receipt.amount} squats` });
        if (kioskMode()) {
          add('wsf-kiosk-finish', { text: 'Finish', click: () => { st.deadline = null; if (!bugs.finishKeepsSession) signOut(); go(`/kiosk/${g}`); } });
          const left = Math.max(0, Math.ceil((st.deadline - now()) / 1000));
          add('wsf-kiosk-countdown', { text: `Finishing in ${left} second${left === 1 ? '' : 's'}` });
          add('wsf-kiosk-stay', { click: () => { if (!bugs.stayIgnored) st.deadline = now() + KIOSK_IDLE_MS; } });
        }
      } else if (st.review) {
        add('wsf-contribute-review-screen');
        add('wsf-contribute-submit', { click: async () => {
          const attemptId = `att-${++st.attemptSeq}-${ctx.uid.slice(-4)}`;
          const count = Number(st.typed.count);
          emit(`https://us-central1-westayfit-staging.cloudfunctions.net/wsfContribute`, { data: { goalId: g, attemptId, count } });
          const rec = await invoke('wsfContribute', () => server.contribute(g, ctx.uid, attemptId, count));
          st.receipt = rec; st.review = false;
          if (kioskMode()) st.deadline = now() + KIOSK_IDLE_MS;
        } });
      } else {
        add('wsf-contribute-entry-screen');
        add('wsf-contribute-entry', { fill: (v) => { st.typed.count = v; } });
        add('wsf-contribute-review', { click: () => { st.review = true; } });
      }
      return N;
    }
    if (st.path.startsWith('/kiosk/')) {
      const gl = server.goal(g);
      add('wsf-kiosk-screen', { text: `Fixture Expo Community\nFixture Expo Squats\n${fmt(server.total(g))} of ${fmt(gl.target)} squats${bugs.finishKeepsCredit ? '\nYour total on this goal: 20 squats' : ''}` });
      add('wsf-kiosk-start', { text: 'Contribute here', click: () => { if (bugs.finishKeepsSession && ctx.uid) { go(`/contribute/${g}`, '?kiosk=1'); return; } signOut(); go(`/contribute/${g}`, '?kiosk=1'); } });
      add('wsf-kiosk-shared-total', { text: fmt(server.total(g)) });
      return N;
    }
    if (st.path.startsWith('/station/')) {
      const stn = station();
      if (!stn) { add('wsf-station-pairing-code', { text: st.pairing.split('').join(' ').replace(/ /g, '') }); return N; }
      const live = snapshotStation(stn);
      // The screen keeps a turn whose Record answer was lost, to try again; a
      // completion's own answer is what it shows as the result.
      const view = { ...live, serving: live.serving || st.heldTurn || null, result: st.localResult && S.now < st.localResult.until ? st.localResult : live.result };
      add('wsf-station-screen');
      add('wsf-station-label', { text: stn.label });
      add('wsf-station-total-line', { text: view.totalLine });
      add('wsf-station-percent', { text: view.percent });
      add('wsf-station-status', { text: view.status });
      add('wsf-station-queue-count', { text: view.count });
      if (view.result) add('wsf-station-queue-result', { text: `${view.result.code} · ${view.result.amount} squats recorded.` });
      if (view.serving) {
        add('wsf-station-queue-serving', { text: view.serving.name });
        add('wsf-station-queue-code', { text: view.serving.code });
        const active = view.serving.status === 'active';
        add('wsf-station-turn-action', {
          text: active ? 'Record this turn' : 'Start their turn',
          disabled: !active && view.serving.status !== 'ready',
          click: async () => {
            st.stationError = null;
            try {
              if (active) {
                const count = Number(st.stationCount);
                // Defect: a retry after a lost answer is "confirmed" from memory and never re-sent.
                const rec = bugs.retryLocalOnly && st.heldTurn ? { amount: count }
                  : await invoke('wsfCompleteTurn', () => server.complete(stn.id, count));
                st.localResult = { code: view.serving.code, amount: rec.amount, until: S.now + RESULT_MS };
                st.heldTurn = null;
                st.stationCount = '';
              } else await invoke('wsfStartTurn', () => server.start(stn.id));
            } catch (e) {
              st.stationError = e.message;
              if (active && !bugs.turnLostOnError) st.heldTurn = { ...view.serving };
              if (bugs.turnLostOnError) st.stationCount = '';
            }
          },
        });
        if (active) {
          add('wsf-station-turn-record');
          add('wsf-station-turn-count', { fill: (v) => { st.stationCount = v; }, value: () => st.stationCount });
        }
        add('wsf-station-turn-cancel', { text: 'Let them go', click: async () => invoke('wsfCancelTurn', () => server.cancel(stn.id)) });
      } else if (!view.result) add('wsf-station-queue-serving-empty', { text: 'Nobody is being served.' });
      add('wsf-station-call-next', { text: 'Call next', click: async () => {
        st.stationError = null;
        try { await invoke('wsfCallNext', () => server.callNext(stn.id)); } catch (e) { st.stationError = e.message; }
      } });
      if (st.stationError) add('wsf-station-queue-error', { text: st.stationError });
      if (view.anyName) add('wsf-station-leak', { text: view.anyName });
      return N;
    }
    return N;
  }
  function snapshotStation(stn) {
    if (st.pollAborted && st.lastStation) return st.lastStation;
    const gl = server.goal(stn.goalId);
    const t = server.total(stn.goalId) + (bugs.stationTotalStale ? -30 : 0);
    const n = server.waiting(stn.goalId).length + (bugs.phoneJoinsLine ? 1 : 0);
    const e = server.serving(stn);
    const result = stn.result && S.now < stn.result.until ? stn.result : null;
    const keepsName = bugs.hallKeepsName && stn.result;
    const view = {
      totalLine: `${fmt(t)} of ${fmt(gl.target)} squats`,
      percent: `${Math.min(100, Math.floor((t / gl.target) * 1000) / 10)}% complete`,
      status: t >= gl.target ? `${fmt(t - gl.target)} beyond our goal · still open` : `${fmt(gl.target - t)} to go`,
      count: n === 0 ? 'Nobody is waiting.' : n === 1 ? '1 person waiting.' : `${n} people waiting.`,
      serving: e ? { name: e.name, code: e.code, status: e.status } : null,
      result,
      anyName: keepsName ? `${stn.result.name} ${stn.result.code}` : (bugs.hallShowsName ? [...S.entries.values()].map((x) => x.name).join(' ') : null),
    };
    st.lastStation = view;
    return view;
  }

  function locator(selector) {
    const id = /data-testid="([^"]+)"/.exec(selector)?.[1];
    const find = () => {
      if (ctx.closed) return null;
      if (st.frozenNodes) return st.frozenNodes.get(id) || null;
      return render().get(id) || null;
    };
    const must = () => { const n = find(); if (!n) throw new Error(`locator: no ${selector}`); return n; };
    const loc = {
      first: () => loc,
      count: async () => (find() ? 1 : 0),
      innerText: async () => { const n = must(); return typeof n.text === 'function' ? n.text() : n.text || ''; },
      isDisabled: async () => must().disabled === true,
      inputValue: async () => must().value(),
      click: async () => { const n = must(); if (!n.click) throw new Error(`${selector} is not clickable`); if (n.disabled) throw new Error(`${selector} is disabled`); await n.click(); },
      fill: async (v) => must().fill(v),
      waitFor: async () => { must(); },
    };
    return loc;
  }
  const page = {
    goto: async (url) => {
      const u = new URL(url);
      go(u.pathname, u.search);
      if (u.pathname.startsWith('/station/')) st.pairing = server.requestPairing(goalOf());
    },
    url: () => `https://staging.example.test${st.path}${st.search}`,
    waitForTimeout: async (ms) => { server.advance(ms); },
    waitForURL: async (pred) => { if (!pred(new URL(page.url()))) throw new Error('page.waitForURL: Timeout exceeded'); },
    locator,
    getByTestId: (id) => locator(`[data-testid="${id}"]`),
    evaluate: async () => [...render().values()].map((n) => (typeof n.text === 'function' ? n.text() : n.text) || '').filter(Boolean).join('\n'),
    content: async () => [...render()].map(([id, n]) => `<div data-testid="${id}">${(typeof n.text === 'function' ? n.text() : n.text) || ''}</div>`).join(''),
    on: (ev, fn) => { if (ev === 'request') st.listeners.push(fn); },
    off: (ev, fn) => { st.listeners = st.listeners.filter((l) => l !== fn); },
    route: async (pattern, handler) => {
      const name = pattern.replace('**/', '');
      st.routes.push({ name, matches: (n) => n === name, handler });
      if (name === 'wsfTurnState') { st.pollAborted = true; }
    },
    unroute: async (pattern) => {
      const name = pattern.replace('**/', '');
      st.routes = st.routes.filter((r) => r.name !== name);
      if (name === 'wsfTurnState') st.pollAborted = false;
    },
    context: () => context,
    clock: {
      install: async () => { st.clock = { t: S.now }; },
      runFor: async (ms) => { st.clock.t += ms; kioskTick(); },
    },
    screenshot: async ({ path: p }) => { fs.writeFileSync(p, 'png'); },
    __freeze: () => { st.frozenNodes = render(); },
    __thaw: () => { st.frozenNodes = null; },
  };
  return page;
}

/** The real kit's expo fixtures over the backend, with the modelled service behind every device. */
export function expoHarness(bugs = {}, { dir = tmp() } = {}) {
  const be = backend();
  const server = expoServer(be, bugs);
  const kit = createFixtureKit({
    projectId: PROJECT, apiKey: 'test-api-key', token: 'admin-token', runTag: RUN_TAG,
    cleanupManifest: path.join(dir, 'cleanup-manifest.json'), fetchImpl: be.fetchImpl,
    now: () => new Date('2026-10-03T12:00:00Z'),
  });
  const opened = [];
  const browser = { newContext: async ({ viewport }) => { const c = expoDevice(be, server, bugs, browser, viewport); opened.push(c); return c; } };
  const root = expoDevice(be, server, bugs, browser, { width: 390, height: 844 });
  const rootPage = expoPage(be, server, bugs, root.__ctx, root);
  const fixtures = new Proxy(kit, {
    get: (k, name) => (name === 'signIn' ? (page, baseUrl, member) => kit.signIn(page, baseUrl, member) : k[name]),
  });
  return { dir, be, kit, server, fixtures, page: rootPage, opened };
}
