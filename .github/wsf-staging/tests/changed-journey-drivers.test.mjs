#!/usr/bin/env node
/**
 * The Community and Settings drivers and their fixture kit, hermetically.
 *
 * - The kit runs for real against an in-memory Identity Toolkit / Firestore,
 *   and its cleanup manifest is then handed to the REAL cleanup-synthetic.mjs
 *   over a local fake API: it must come back COMPLETE, with every account and
 *   document it created removed and read back.
 * - The drivers run for real against a scripted page that models the
 *   product's rendered contract at 938e00d8 (test IDs, role="switch",
 *   aria-checked, aria-pressed, the copy the drivers read). A faithful model
 *   passes; each seeded product defect fails the assertion that names it.
 *
 * What this cannot prove is that staging renders that contract: that is what
 * the hosted run is for, and the report says so.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createFixtureKit } from '../journeys/fixture-kit.mjs';
import { drivers } from '../journeys/index.mjs';
import { runHook } from '../hosted-changed-journeys.mjs';
import { isOwnedRunTag } from '../run-tag.mjs';

const CLEANUP = path.resolve('.github/wsf-staging/cleanup-synthetic.mjs');
const EXAMPLE = path.resolve('.github/wsf-staging/journeys/examples/community-settings-parity-1.json');
const PROJECT = 'westayfit-staging';
const RUN_TAG = 'e5c-testrun01';
let passed = 0;
const test = async (n, f) => { await f(); passed += 1; console.log(`  ok  ${n}`); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-cjd-'));

// ---- an in-memory Identity Toolkit + Firestore --------------------------------------
function backend() {
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
function serve(be) {
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
      if (req.method === 'DELETE') { if (!be.docs.has(p)) return json(404, { error: { status: 'NOT_FOUND' } }); be.docs.delete(p); return json(200, {}); }
      if (req.method === 'GET') return be.docs.has(p) ? json(200, { name: p, fields: be.docs.get(p) }) : json(404, { error: { status: 'NOT_FOUND' } });
      return json(400, { error: { status: 'UNEXPECTED' } });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}
function runCleanup(base, manifest, receipt) {
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
function kitFor(dir, be) {
  return createFixtureKit({
    projectId: PROJECT, apiKey: 'test-api-key', token: 'admin-token', runTag: RUN_TAG,
    cleanupManifest: path.join(dir, 'cleanup-manifest.json'), fetchImpl: be.fetchImpl,
    now: () => new Date('2026-09-26T12:00:00Z'),
  });
}

// ---- a scripted page modelling the product's rendered contract ------------------------
function fakeApp(fx, bugs = {}) {
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
    reload: async () => {},
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
function harness(bugs) {
  const dir = tmp();
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
async function drive(name, bugs = {}) {
  const h = harness(bugs);
  const r = await drivers[name]({ page: h.page, baseUrl: 'https://staging.example.test', journey: { id: name }, fixtures: h.fixtures });
  return { ...h, r, failed: r.assertions.filter((a) => !a.ok).map((a) => a.expected) };
}

// ---- the fixture kit ------------------------------------------------------------------
await test('the kit tracks every account and document BEFORE the request that creates it', async () => {
  const dir = tmp();
  const be = backend();
  const manifestPath = path.join(dir, 'cleanup-manifest.json');
  const inner = be.fetchImpl;
  be.fetchImpl = async (url, opts) => {
    const m = /\/documents\/(.+)$/.exec(url);
    if (m && opts.method === 'PATCH') {
      const tracked = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).docs;
      assert.ok(tracked.includes(decodeURIComponent(m[1])), `${m[1]} was written before it was tracked`);
    }
    return inner(url, opts);
  };
  const kit = kitFor(dir, be);
  assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).docs, [], 'an empty manifest exists before anything is created');
  await kit.memberInTwoCommunities('community');
  assert.equal(be.docs.size, JSON.parse(fs.readFileSync(manifestPath, 'utf8')).docs.length);
});

await test('every fixture request is admin-scoped and the manifest never holds the email or password', async () => {
  const dir = tmp();
  const be = backend();
  const fx = await kitFor(dir, be).memberInTwoCommunities('settings');
  assert.ok(be.requests.every((q) => q.admin), 'a fixture write without the admin token would be a product call, not a fixture');
  const text = fs.readFileSync(path.join(dir, 'cleanup-manifest.json'), 'utf8');
  assert.equal(text.includes(fx.member.password), false);
  assert.equal(text.includes('@example.com'), false);
  assert.equal((fs.statSync(path.join(dir, 'cleanup-manifest.json')).mode & 0o777).toString(8), '600');
  assert.match(fx.member.email, new RegExp(`^wsf-${RUN_TAG}-settings-[0-9a-f]{4}@example\\.com$`));
  assert.equal(fx.setupId.includes('@'), false);
});

await test('the kit seeds the facts the drivers assert: roles, visibilities, goals in their window', async () => {
  const dir = tmp();
  const be = backend();
  const fx = await kitFor(dir, be).memberInTwoCommunities('community');
  const f = (p) => be.docs.get(p);
  assert.equal(f(`wsfMemberships/${fx.a.id}_${fx.member.uid}`).role.stringValue, 'member');
  assert.equal(f(`wsfMemberships/${fx.a.id}_${fx.member.uid}`).communityNameVisibility.stringValue, 'private');
  assert.equal(f(`wsfMemberships/${fx.b.id}_${fx.member.uid}`).role.stringValue, 'foundingChampion');
  assert.equal(f(`wsfMemberships/${fx.b.id}_${fx.member.uid}`).communityActivityVisibility.stringValue, 'private');
  assert.equal([...be.docs.keys()].filter((p) => p.startsWith(`wsfMemberships/${fx.a.id}_`)).length, fx.a.members);
  assert.equal([...be.docs.keys()].filter((p) => p.startsWith(`wsfMemberships/${fx.b.id}_`)).length, fx.b.members);
  for (const c of [fx.a, fx.b]) {
    const g = f(`wsfGoals/${c.goalId}`);
    assert.equal(g.title.stringValue, c.goalTitle);
    assert.equal(g.communityGroupId.stringValue, c.id);
    assert.ok(new Date(g.startsAt.timestampValue) < new Date('2026-09-26T12:00:00Z') && new Date(g.endsAt.timestampValue) > new Date('2026-09-26T12:00:00Z'));
  }
});

await test('the REAL cleaner accepts the kit\'s manifest and removes everything it created, read back', async () => {
  const dir = tmp();
  const be = backend();
  const kit = kitFor(dir, be);
  await kit.memberInTwoCommunities('community');
  await kit.memberInTwoCommunities('settings');
  const created = { users: be.accounts.size, docs: be.docs.size };
  assert.ok(isOwnedRunTag(RUN_TAG));
  const { server, base } = await serve(be);
  const r = await runCleanup(base, kit.manifestPath, path.join(dir, 'receipt.json'));
  server.close();
  assert.equal(r.receipt.status, 'COMPLETE', r.out);
  assert.equal(r.receipt.usersDeleted, created.users);
  assert.equal(r.receipt.documentsDeleted, created.docs);
  assert.equal(be.accounts.size + be.docs.size, 0, 'nothing the kit created is left behind');
});

// ---- the drivers against a faithful model -----------------------------------------------
await test('COMMUNITY on a faithful model: real actions, every assertion holds', async () => {
  const { r, failed } = await drive('community');
  assert.deepEqual(failed, []);
  assert.ok(r.assertions.length >= 10, `${r.assertions.length} assertions`);
  assert.deepEqual(r.actionsPerformed.map((a) => a.split(' ')[0]), ['signed', 'opened', 'pressed', 'reloaded']);
  assert.match(r.setupId, /member of A, founding Champion of B/);
});

await test('SETTINGS on a faithful model: real actions, every assertion holds', async () => {
  const { r, failed, app } = await drive('settings');
  assert.deepEqual(failed, []);
  assert.ok(r.assertions.length >= 10, `${r.assertions.length} assertions`);
  assert.ok(r.actionsPerformed.includes('pressed × Close'));
  assert.equal(app().st.panel, false);
});

await test('SETTINGS selects the community it needs through the product, not by writing storage', async () => {
  const { r, app } = await drive('settings');
  assert.deepEqual(app().st.pressed.length, 1, 'the chip was pressed once');
  assert.ok(r.actionsPerformed.some((a) => a.startsWith('pressed the Summit Journey Club chip')));
});

// ---- each seeded product defect fails the assertion that names it -------------------------
const DEFECTS = [
  ['community', { chipIgnored: true }, /after switching, the banner names/],
  ['community', { foundingLabel: true }, /Your role fact reads Champion/],
  ['settings', { settingsIgnoresSelection: true, serverOrderBFirst: false }, /privacy sections list Summit Journey Club first/],
  ['settings', { nameAlwaysOn: true }, /Harbor Journey Crew: the name switch shows the stored value \(off\)/],
  ['settings', { noAnonymousHint: true }, /a private name is explained as "Anonymous member"/],
  ['settings', { closeBroken: true }, /Close dismisses the panel/],
];
for (const [name, bugs, re] of DEFECTS) {
  await test(`${name.toUpperCase()} fails on a seeded defect: ${Object.keys(bugs).filter((k) => bugs[k]).join(', ')}`, async () => {
    const { failed } = await drive(name, bugs);
    assert.ok(failed.some((f) => re.test(f)), `expected a failed assertion matching ${re}; failed: ${failed.join(' | ') || 'none'}`);
  });
}

await test('a sign-in that does not leave /signin throws; the driver does not continue signed out', async () => {
  const h = harness({});
  h.fixtures.signIn = (page, baseUrl, member) => h.kit.signIn(h.app().page, baseUrl, { ...member, password: 'wrong' });
  await assert.rejects(
    drivers.community({ page: h.page, baseUrl: 'https://staging.example.test', journey: { id: 'community' }, fixtures: h.fixtures }),
    /waitForURL/,
  );
});

// ---- through the hook, with the real registry and the example manifest ----------------------
await test('the hook runs both registered drivers from the example manifest: PASSED, with actions, assertions and screenshots', async () => {
  const d = tmp();
  const manifest = JSON.parse(fs.readFileSync(EXAMPLE, 'utf8'));
  fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify(manifest));
  const hs = {};
  const env = {
    WSF_JOURNEY_MANIFEST: path.join(d, 'manifest.json'), WSF_STAGING_URL: 'https://staging.example.test',
    WSF_APPROVED_SHA: manifest.productSha, WSF_RESULT_DIR: path.join(d, 'evidence'),
  };
  const browser = {
    newContext: async () => ({ newPage: async () => new Proxy({}, { get: (_, k) => (k === 'then' ? undefined : (...a) => hs.current.page[k](...a)) }), close: async () => {} }),
    close: async () => {},
  };
  let fixturesMade = 0;
  const r = await runHook(env, {
    fetch: async () => ({ ok: true, text: async () => `commit ${manifest.productSha.slice(0, 7)}` }),
    launch: async () => browser,
    fixtures: () => {
      fixturesMade += 1;
      const h = harness({});
      hs.current = { get page() { return h.app().page; } };
      return h.fixtures;
    },
  });
  assert.equal(fixturesMade, 1, 'one fixture kit per run');
  assert.ok(r.lines.includes('CHANGED_JOURNEY_SMOKE=PASSED'), r.lines.join('\n'));
  for (const x of r.results.results) {
    assert.equal(x.status, 'passed', `${x.journeyId}: ${x.reason}`);
    assert.ok(x.actionsPerformed.length >= 4 && x.assertions.length >= 10);
    assert.equal(x.artifact, `changed-journeys/${x.journeyId}.png`);
  }
  const card = fs.readFileSync(path.join(d, 'evidence', 'changed-journeys', 'owner-test-card.md'), 'utf8');
  assert.match(card, /Hosted changed-journey status: PASSED \(2 passed/);
  assert.match(card, /Device review: NOT RUN — Devin's verdict/);
});

console.log(`\nchanged-journey-drivers: ${passed} passed`);
