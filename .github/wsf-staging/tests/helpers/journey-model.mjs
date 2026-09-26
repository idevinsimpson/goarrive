/**
 * Shared test model for the changed-journey drivers: an in-memory Identity
 * Toolkit + Firestore (also served over HTTP in the shape cleanup-synthetic.mjs
 * speaks), the real fixture kit bound to it, and a scripted page modelling the
 * product's rendered contract at 938e00d8. Used by changed-journey-drivers and
 * journey-activation. Test code only.
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
  const docs = new Map(); // path -> fields
  const requests = [];
  let n = 0;
  const reply = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
  const fetchImpl = async (url, { method = 'GET', headers = {}, body } = {}) => {
    const parsed = body ? JSON.parse(body) : undefined;
    requests.push({ url, method, admin: headers.authorization === 'Bearer admin-token', body: parsed });
    if (url.includes('accounts:signUp')) {
      const uid = `Uid${String(++n).padStart(25, '0')}`;
      accounts.set(uid, parsed.email);
      return reply(200, { localId: uid });
    }
    const m = /\/documents\/(.+)$/.exec(url);
    if (m && method === 'PATCH') { docs.set(decodeURIComponent(m[1]), parsed.fields); return reply(200, {}); }
    return reply(404, { error: { status: 'NOT_FOUND' } });
  };
  return { accounts, docs, requests, fetchImpl };
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
  const st = { signedIn: false, path: '/', selected: null, panel: false, typed: {}, pressed: [] };
  const serverOrder = bugs.serverOrderBFirst ? [fx.b, fx.a] : [fx.a, fx.b];
  const current = () => st.selected || serverOrder[0];
  const onTabs = () => st.signedIn && ['/', '/community', '/you'].includes(st.path);
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
    goto: async (url) => { st.path = new URL(url).pathname; },
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
