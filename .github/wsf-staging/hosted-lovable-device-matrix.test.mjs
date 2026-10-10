#!/usr/bin/env node
/**
 * hosted-lovable-device-matrix.mjs, offline: the reviewed-build pin, the rows and the matrix, the verdict rules, the
 * cleanup merge against the cleaner's own provenance rules, the CLI's credential-free bind, and the journey at the four
 * viewports against a scripted fake of the Lovable UI and the existing fixture kit. No network, no credential, no
 * browser.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CELLS, COPY, FIXTURE_UNIT, FRESH_UPDATED_RE, LOVABLE_URL, PROJECT_ID, REVIEWED_BUILD, ROWS, SEL, VIEWPORTS, VISITOR_INITIALS, VISITOR_NAME, accountLookup, allPassed, cli,
  displayNumber, displayVerdict, matrixLines, mergeExtras, requireVerdict, results, runMatrix, stepVerdict, visitorEmail,
} from './hosted-lovable-device-matrix.mjs';
import * as kiosk from './hosted-lovable-kiosk.mjs';

let passed = 0;
const pending = [];
const test = (name, fn) => pending.push([name, fn]);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---- the pin, the host and the rows --------------------------------------------------------------
test('one pin for both proofs: REVIEWED_BUILD is the kiosk harness\'s shipped pin, and another build fails it', () => {
  assert.equal(REVIEWED_BUILD, kiosk.REVIEWED_BUILD, 'the same object, not a copy');
  assert.equal(kiosk.bindBuild({ documents: REVIEWED_BUILD.documents, assets: REVIEWED_BUILD.assets, refusals: [] }, REVIEWED_BUILD).status, 'PASS');
  assert.equal(kiosk.bindBuild({ documents: FAKE_REVIEWED.documents, assets: { 'a.js': sha('a') }, refusals: [] }, REVIEWED_BUILD).status, 'FAIL');
  for (const p of ['/', '/?join=x&goal=y', '/display/e5cgoal-e5c-t-1-dm1']) assert.ok(kiosk.matchTemplate(new URL(`${LOVABLE_URL}${p}`).pathname), `the matrix loads ${p}, a reviewed route template`);
  assert.equal(LOVABLE_URL, 'https://we-stay-fit-foundation-trial.lovable.app');
  assert.equal(PROJECT_ID, 'westayfit-staging');
});

test('the four viewports of the queue, and every cell at every viewport between the run rows', () => {
  assert.deepEqual(VIEWPORTS.map((v) => [v.width, v.height]), [[360, 640], [390, 844], [820, 1180], [1440, 900]]);
  assert.equal(new Set(VIEWPORTS.map((v) => v.id)).size, 4);
  assert.deepEqual(CELLS.map((c) => c.id), ['landing', 'display', 'invite-link', 'signup', 'unverified-participation', 'invite-join', 'camera-fallback', 'progress-you', 'memberships']);
  assert.equal(ROWS.length, 3 + CELLS.length * VIEWPORTS.length);
  assert.deepEqual([ROWS[0].id, ROWS[1].id, ROWS.at(-1).id], ['host-build', 'fixture-provenance', 'cleanup-tracking']);
  assert.equal(new Set(ROWS.map((r) => r.id)).size, ROWS.length, 'row ids are unique');
  for (const v of VIEWPORTS) for (const c of CELLS) assert.ok(ROWS.some((r) => r.id === `${c.id}@${v.id}` && r.expected.startsWith(v.label)), `${c.id}@${v.id}`);
});

test('results: every row in order, unreached rows BLOCKED by name; text is scrubbed; screenshots stay relative', () => {
  const doc = results({ 'host-build': { status: 'PASS', seen: 'x' }, 'landing@v390': { status: 'PASS', seen: 'ok', shots: ['shots/v390-landing.png', '../escape.png', '/abs.png', 'shots/x/../y.png'] } });
  assert.deepEqual(doc.rows.map((r) => r.id), ROWS.map((r) => r.id));
  assert.equal(doc.rows.find((r) => r.id === 'display@v360').status, 'BLOCKED');
  assert.equal(doc.rows.find((r) => r.id === 'display@v360').seen, 'not reached');
  assert.deepEqual(doc.rows.find((r) => r.id === 'landing@v390').shots, ['shots/v390-landing.png'], 'only plain files under shots/ are recorded');
  assert.equal('shots' in doc.rows.find((r) => r.id === 'display@v360'), false);
  assert.deepEqual(doc.viewports, VIEWPORTS.map(({ id, width, height }) => ({ id, width, height })));
  assert.equal(allPassed(doc), false);
  assert.equal(allPassed(results(Object.fromEntries(ROWS.map((r) => [r.id, { status: 'PASS', seen: '' }])))), true);
  const leaky = JSON.stringify(results({ 'signup@v360': { status: 'FAIL', seen: 'as wsf-e5c-x-dmv360-ab12@example.com via /?join=SECRETCODE&goal=g' } }));
  assert.doesNotMatch(leaky, /@example\.com|SECRETCODE/, 'emails and query values (a join code) are scrubbed');
});

test('require and the matrix: PASS only on every row PASS, cleanup success and scan success; each cell reads across the viewports', () => {
  const all = results(Object.fromEntries(ROWS.map((r) => [r.id, { status: 'PASS', seen: '' }])));
  assert.equal(requireVerdict(all, { cleanup: 'success', scan: 'success' }).ok, true);
  assert.equal(requireVerdict(all, { cleanup: 'failure', scan: 'success' }).ok, false);
  assert.equal(requireVerdict(all, { cleanup: 'success', scan: 'failure' }).ok, false);
  assert.equal(requireVerdict(all, { cleanup: 'success' }).ok, false, 'an unknown scan outcome is not success');
  const blocked = results({ ...Object.fromEntries(ROWS.map((r) => [r.id, { status: 'PASS', seen: '' }])), 'camera-fallback@v820': { status: 'BLOCKED', seen: 'x' } });
  const v = requireVerdict(blocked, { cleanup: 'success', scan: 'success' });
  assert.equal(v.ok, false);
  assert.ok(v.lines.includes('LOVABLE_DEVICE_MATRIX=BLOCKED'));
  assert.ok(v.lines.includes('LOVABLE_DEVICE_CELL camera-fallback: v360=PASS v390=PASS v820=BLOCKED v1440=PASS'));
  const failed = results({ 'landing@v360': { status: 'FAIL', seen: 'x' } });
  assert.ok(requireVerdict(failed, { cleanup: 'success', scan: 'success' }).lines.includes('LOVABLE_DEVICE_MATRIX=FAIL'));
  assert.ok(requireVerdict(null, {}).lines.includes('LOVABLE_DEVICE_MATRIX=FAIL'), 'no results is a FAIL, never a pass');
  assert.equal(matrixLines(null).length, CELLS.length);
});

// ---- the visitor accounts against the cleaner's own provenance rules -------------------------------
/** cleanup-synthetic.mjs's user pattern and its rule for the one untagged document shape, restated as it reads them. */
const cleanerEmail = (runTag) => new RegExp(`^wsf-${runTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-[^@\\s]*@example\\.com$`, 'i');
function cleanerAdmits(m) {
  const users = new Set(m.users);
  const memberUids = new Set(m.docs.filter((d) => d.includes(m.runTag)).map((d) => /^wsfMemberships\/[^/]+_([^/_]+)$/.exec(d)?.[1]).filter(Boolean));
  const docs = m.docs.every((d) => d.includes(m.runTag) || ((u) => u && users.has(u) && memberUids.has(u))(/^wsfMemberProfiles\/([^/]+)$/.exec(d)?.[1]));
  const linked = (m.linkedDocs ?? []).every((l) => !m.docs.includes(l.path) && (l.via.includes(m.runTag) || users.has(l.via)));
  return docs && linked;
}

test('the visitor email is exactly the cleaner\'s provenance pattern for this run, and another run\'s never is', () => {
  const tag = 'e5c-mx1abc-0a1b2c';
  for (const v of VIEWPORTS) assert.match(visitorEmail(tag, v.id), cleanerEmail(tag), v.id);
  assert.match(visitorEmail(tag, 'v360', 'ab12'), /^wsf-e5c-mx1abc-0a1b2c-dmv360-ab12@example\.com$/);
  assert.doesNotMatch(visitorEmail('e5c-other-111111', 'v360'), cleanerEmail(tag));
});

test('cleanup merge: a visitor uid, its tagged membership and its linked profile are admitted; untagged or foreign entries refuse the whole merge', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-dm-'));
  const file = path.join(dir, 'cleanup-manifest.json');
  const tag = 'e5c-mx1abc-0a1b2c';
  const group = `e5cgrp-${tag}-dm`;
  fs.writeFileSync(file, JSON.stringify({ project: PROJECT_ID, runTag: tag, users: [], docs: [`wsfCommunityGroups/${group}`], linkedDocs: [] }));
  const uid = 'Uid0visitorA1';
  const counts = mergeExtras(file, { users: [uid], docs: [`wsfMemberships/${group}_${uid}`, `wsfMemberProfiles/${uid}`] });
  assert.deepEqual(counts, { users: 1, docs: 3, linked: 0 });
  assert.deepEqual(mergeExtras(file, { users: [uid], docs: [`wsfMemberProfiles/${uid}`] }), counts, 'a repeated merge is a no-op');
  assert.equal(cleanerAdmits(JSON.parse(fs.readFileSync(file, 'utf8'))), true);
  // A join answered for another community: claimed as linked through the visitor's uid.
  mergeExtras(file, { linked: [{ path: `wsfMemberships/someOtherGroup_${uid}`, via: uid }] });
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(m.linkedDocs, [{ path: `wsfMemberships/someOtherGroup_${uid}`, via: uid }]);
  assert.equal(cleanerAdmits(m), true);
  const before = fs.readFileSync(file, 'utf8');
  for (const bad of [
    { docs: ['wsfMemberProfiles/NotAListedUser1'] }, { docs: ['wsfGoals/untagged'] }, { docs: [`../wsfGoals/${tag}`] }, { docs: [`/wsfGoals/${tag}`] },
    { users: ['bad uid!'] }, { users: [''] }, { linked: [{ path: 'wsfMemberships/x_y', via: 'NotAListedUser1' }] }, { linked: [{ path: 'wsfGoals/x', via: uid }] },
  ]) {
    assert.throws(() => mergeExtras(file, bad), /without this run's provenance/, JSON.stringify(bad));
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'a refused merge writes nothing');
  }
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

// ---- the journey against a scripted fake of the Lovable UI ------------------------------------------
/**
 * A scripted fake of the connected Web Twin (the member flow as src/wsf/* renders it at 397c3b60), the Playwright
 * surface the journey uses, and the existing kit. Every page load goes through the context's route handler like
 * Playwright delivers it; every callable is a request and its OWN response, delivered to the page's listeners; the
 * product's sign-up answers with the account's localId. `bug` switches on one defect at a time.
 */
/** A document as the TanStack Start host serves it (HTML-VARIANCE-1): a per-request context token and per-request u: timestamps, and the route's own params. */
let served = 0;
/** The hosting's two preview screenshot links on a deep link (step C; DEEPLINK-DRIFT-CONFIRM-1, #394 6093468966). */
const SHOT_URL = 'https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/lovp_372ahwppkw9debd61922xf2ayz/a74c72a1c0451cab76648ebdb57437a9_1791601764778.png';
const SHOT_TAGS = `<meta property="og:image" content="${SHOT_URL}"><meta name="twitter:image" content="${SHOT_URL}">`;
function servedDoc(pathname, extra = '') {
  served += 1;
  const ts = `${1 + crypto.randomInt(9)}${String(crypto.randomInt(1e12)).padStart(12, '0')}`; // any 13 digits, per request
  const segs = pathname.split('/').filter(Boolean);
  const route = pathname === '/' ? '/' : segs[0] === 'display' ? '/display/$goalId' : '/kiosk/$communityId/$goalId';
  const ids = segs.slice(1);
  return `<!DOCTYPE html><html><head><link rel="stylesheet" href="/assets/index-CCC.css">`
    + `<script src="/__l5e/events.a1b2c3d4e5f60718.js" data-context-token="ctx.${crypto.randomBytes(12).toString('base64url')}" defer></script><script src="/~flock.js" defer></script>`
    + `${route === '/' ? '' : SHOT_TAGS}</head>`
    + `<body><main data-route="${route}"${ids.map((v, i) => ` data-p${i}="${v}"`).join('')}>\u0000</main>${extra}`
    + `<script data-tsr-stream-part="">$_TSR.router.matches=[{i:"__root__",u:${ts},x:"\u0000"},{i:"${route}${ids.length ? pathname : ''}",u:${ts}}]</script>`
    + `<script type="module" src="/assets/shell-AAA.js"></script></body></html>`;
}
const FAKE_ASSETS = { '/assets/shell-AAA.js': 'export const shell=1;', '/assets/index-CCC.css': 'body{}' };
const canonOf = (p) => { const d = kiosk.canonicalDocument(servedDoc(p), `${LOVABLE_URL}${p}`); return { sha256: d.sha256, streamU: d.streamU, nul: d.nul, img: d.img }; };
const FAKE_REVIEWED = Object.freeze({
  documents: Object.freeze({ '/': canonOf('/'), '/display/$goalId': canonOf('/display/ga1-wsf-bind-probe'), '/kiosk/$communityId/$goalId': canonOf('/kiosk/ca1-wsf-bind-probe/ga1-wsf-bind-probe') }),
  assets: Object.freeze(Object.fromEntries(Object.entries(FAKE_ASSETS).map(([p, b]) => [p.slice(8), sha(b)]))),
});
const EVENTS_SCRIPT = `${LOVABLE_URL}/__l5e/events.a1b2c3d4e5f60718.js`;
const FLOCK_SCRIPT = `${LOVABLE_URL}/~flock.js`;
const TAG = 'e5c-mx1abc-0a1b2c';

function twin(bug = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-dm-'));
  const manifest = path.join(dir, 'cleanup-manifest.json');
  const shotsDir = path.join(dir, 'shots');
  fs.mkdirSync(shotsDir);
  const server = { requests: [], groups: {}, goals: {}, profiles: {}, members: {}, contexts: [], kitCalls: [], kitAfterContext: 0, docs: [], routed: 0, passwordFills: 0, accounts: 0 };
  // The kit: the real one writes its manifest first and tracks every document before it writes it.
  const persist = () => fs.writeFileSync(manifest, JSON.stringify({ project: PROJECT_ID, runTag: TAG, users: [], docs: server.docs, linkedDocs: [] }), { mode: 0o600 });
  persist();
  const fixtures = {
    async joinableEvent(label, { target, seeded }) {
      server.kitCalls.push(label);
      if (server.contexts.length) server.kitAfterContext += 1;
      const groupId = `e5cgrp-${TAG}-${label}`;
      const goalId = `e5cgoal-${TAG}-${label}`;
      const joinCode = crypto.randomBytes(18).toString('base64url');
      server.docs.push(`wsfCommunityGroups/${groupId}`, `wsfMemberships/${groupId}_e5cchamp-${TAG}-${label}`, `wsfGoals/${goalId}`, `wsfMarkers/${TAG}-${label}`);
      persist();
      server.groups[groupId] = { joinCode, name: 'Fixture Open Community' };
      server.goals[goalId] = { groupId, title: 'Fixture Open Squats', target, seeded, display: !bug.displayNotAuthorized };
      return { setupId: `${label}: one synthetic public community`, groupId, goalId, joinCode, markerSlug: `${TAG}-${label}`, communityName: 'Fixture Open Community', goalTitle: 'Fixture Open Squats', target, seeded };
    },
  };
  const serve = (url) => {
    const u = new URL(url);
    if (u.origin !== LOVABLE_URL) return { status: 200, body: 'globalThis.foreign = 1;' };
    if (u.pathname.startsWith('/assets/')) return Object.hasOwn(FAKE_ASSETS, u.pathname) ? { status: 200, body: FAKE_ASSETS[u.pathname] } : { status: 404, body: '' };
    return { status: 200, body: servedDoc(u.pathname) };
  };
  async function load(context, url, type, navigation) {
    let outcome = 'unhandled';
    const route = {
      request: () => ({ url: () => url, resourceType: () => type, isNavigationRequest: () => navigation }),
      async fetch() { const r = serve(url); return { status: () => r.status, headers: () => ({ 'content-type': new URL(url).pathname.startsWith('/assets/') ? 'text/javascript' : 'text/html; charset=utf-8' }), body: async () => Buffer.from(r.body) }; },
      async fulfill() { outcome = 'fulfilled'; },
      async continue() { outcome = 'continued'; },
      async abort() { outcome = 'aborted'; },
    };
    assert.equal(context.handlers.length, 1, 'every context routes every request through the guard');
    server.routed += 1;
    await context.handlers[0](route);
    return outcome;
  }
  async function pageLoad(context, url) {
    if ((await load(context, url, 'document', true)) !== 'fulfilled') throw new Error(`page.goto: net::ERR_BLOCKED_BY_CLIENT at ${new URL(url).origin}${new URL(url).pathname}`);
    const subs = [[EVENTS_SCRIPT, 'script'], [FLOCK_SCRIPT, 'script'], [`${LOVABLE_URL}/assets/shell-AAA.js`, 'script'], [`${LOVABLE_URL}/assets/index-CCC.css`, 'stylesheet'], [`${LOVABLE_URL}/favicon.ico`, 'image']];
    if (bug.foreignOnJoin && new URL(url).searchParams.has('join')) subs.push(['https://cdn.example.test/join.js', 'script']);
    if (bug.foreignOnDisplay && new URL(url).pathname.startsWith('/display/')) subs.push(['https://cdn.example.test/display.js', 'script']);
    if (bug.foreignOnSecondInvite && new URL(url).searchParams.get('goal')?.endsWith('-dm2')) subs.push(['https://cdn.example.test/second.js', 'script']);
    for (const [s, t] of subs) await load(context, s, t, false);
  }
  const browser = {
    closed: 0,
    async newContext(opts) {
      server.contexts.push(opts);
      const store = { session: {}, local: {}, uid: null };
      const context = {
        handlers: [],
        async route(pattern, handler) { assert.equal(pattern, '**/*'); context.handlers.push(handler); },
        async newPage() { return page(store, context, opts); },
        async close() { browser.closed += 1; },
      };
      return context;
    },
  };
  function page(store, context, opts) {
    const listeners = { request: [], response: [] };
    let url = 'about:blank';
    let view = 'blank';
    let display = null;
    let card = null; // { stage, groupId, goalId }
    let cam = false;
    let sheet = false;
    let tab = 'home';
    let tourSeen = false; // the tour shows over Home until Skip, Close or Escape marks it seen; opening MOVE hides it unseen
    let joins = 0;
    let notice = false;
    let name = '';
    const typed = {};
    let current = null;
    /** What the network answers later: delivered one per waitForTimeout, so a driver that does not wait never sees it. */
    const later = [];
    const emit = (name, data, result, error) => {
      const req = { url: () => `https://us-central1-westayfit-staging.cloudfunctions.net/${name}`, method: () => 'POST', postData: () => JSON.stringify({ data }) };
      server.requests.push({ name, data, uid: store.uid });
      for (const f of listeners.request) f(req);
      const res = { url: () => req.url(), request: () => req, json: async () => (error ? { error: { status: error } } : { result }) };
      for (const f of listeners.response) f(res);
    };
    const groupByCode = (code) => Object.entries(server.groups).find(([, g]) => g.joinCode === code)?.[0];
    const memberships = () => server.members[store.uid] ?? [];
    /** The app's own membership read (the canonical hydrate), by group id. */
    const hydrate = () => {
      const ids = bug.readShort ? memberships().slice(-1) : memberships();
      emit('wsfMyCommunities', {}, { items: ids.map((groupId) => ({ groupId, displayName: server.groups[groupId]?.name ?? 'Other', role: 'member' })) });
    };
    const enterShell = () => {
      view = 'shell';
      tab = 'home';
      hydrate();
      const code = store.session['wsf.pendingJoinCode'];
      if (code) {
        const g = groupByCode(code);
        card = { stage: 'preview', groupId: g, goalId: store.session['wsf.pendingJoinGoal'] };
        emit('wsfPreviewCommunity', { joinCode: code }, g ? { displayName: server.groups[g].name, joinPolicy: 'public' } : null, g ? null : 'NOT_FOUND');
        if (bug.autoJoin && g) {
          // The "Nothing is joined until you tap Join" regression: the product joins on its own when the card opens.
          server.members[store.uid] = [...new Set([...memberships(), g])];
          emit('wsfJoinCommunity', { joinCode: code }, { groupId: g, alreadyMember: false });
        }
      }
    };
    /** Every element the current view renders: the selectors it answers to, role/name/label, text, attributes, actions. */
    function render() {
      const els = [];
      const tour = !!bug.tour && !tourSeen && view === 'shell' && tab === 'home' && !cam && !sheet;
      const blocked = (f) => () => { if (!tour) f(); }; // the tour card sits over the join card and the navigation
      const add = (e) => els.push({ visible: true, sels: [], ...e });
      if (view === 'signin' || view === 'signup' || view === 'profile') add({ sels: ['body'], text: bug.sampleData ? 'Sample data · Welcome back' : 'STAGING · Firebase staging Welcome back' });
      if (view === 'signin') {
        add({ sels: [SEL.signIn] });
        add({ sels: [`${SEL.signIn} h1`], text: COPY.welcome });
        add({ sels: [`button:has-text("${COPY.toSignUp}")`], role: 'button', name: COPY.toSignUp, onClick: () => { view = 'signup'; } });
      }
      if (view === 'signup') {
        add({ role: 'heading', name: COPY.createTitle });
        add({ label: 'Email', onFill: (v) => { typed.email = v; } });
        add({ label: 'Password', onFill: (v) => { typed.password = v; server.passwordFills += 1; } });
        add({ role: 'button', name: COPY.createSubmit, onClick: () => {
          server.accounts += 1;
          store.uid = `UidVisitor${server.accounts}`;
          server.signups = [...(server.signups ?? []), { email: typed.email, uid: store.uid }];
          const req = { url: () => 'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=AIzaFAKE', method: () => 'POST', postData: () => '{}' };
          for (const f of listeners.request) f(req);
          if (!bug.noSignupResponse) {
            const res = { url: () => req.url(), request: () => req, json: async () => ({ localId: store.uid, idToken: 'not-a-token' }) };
            later.push(() => { for (const f of listeners.response) f(res); });
          }
          view = 'profile';
          const ok = !!bug.sendOk;
          emit('wsfSendVerificationEmail', {}, ok ? { sent: true } : null, ok ? null : 'INTERNAL');
          notice = bug.dishonestNotice ? ok : !ok;
          if (bug.sendOkNotice) notice = true;
        } });
      }
      if (view === 'profile') {
        // The step eyebrow as db3fd2f2 serves it: its text is "Step 2 of 2", and `.eyebrow { text-transform: uppercase }`
        // makes innerText "STEP 2 OF 2" (`content` is textContent, `text` is innerText).
        const stepCopy = bug.wrongStep ? 'Step 3 of 3' : bug.upperStep ? 'STEP 2 OF 2' : COPY.stepUnverified;
        // `hiddenStep`: the eyebrow is in the DOM with its copy but `visibility: hidden` (no innerText, still textContent).
        add({ sels: [SEL.profileSetup], text: `${bug.hiddenStep ? '' : `${stepCopy.toUpperCase()} `}What should your community call you?` });
        add({ sels: [SEL.profileStep], content: stepCopy, text: bug.hiddenStep ? '' : stepCopy.toUpperCase(), visible: !bug.hiddenStep, attrs: { 'aria-label': stepCopy } });
        if (notice) add({ sels: [SEL.verifySendNotice], text: `${bug.wrongNoticeText ? 'Email sent' : COPY.sendFailed} (Could not send the verification email. Try again shortly.). Some communities need a verified email before you can continue.` });
        add({ label: COPY.nameLabel, onFill: (v) => { name = v; } });
        add({ role: 'button', name: COPY.nameSubmit, onClick: () => {
          if (bug.saveRefused) { emit('wsfSaveProfile', { displayName: name }, null, 'FAILED_PRECONDITION'); return; }
          if (bug.saveError) { emit('wsfSaveProfile', { displayName: name }, null, 'INTERNAL'); return; }
          server.profiles[store.uid] = name;
          emit('wsfSaveProfile', { displayName: name }, { created: true });
          enterShell();
        } });
      }
      if (view === 'display') {
        const g = server.goals[display];
        const state = g?.display ? 'live' : 'notAuthorized';
        add({ sels: [SEL.display], attrs: { 'data-display': state } });
        if (state === 'live') {
          // The markup of db3fd2f2's public-display-view.tsx: community line, h1, total (`strong` + `span`), two freshness lines.
          const n = (x) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 3 }).format(x);
          const name = server.groups[g.groupId].name;
          const of = bug.oldTotal ? `/ ${g.target} confirmed` : `of ${n(g.target)} squats`;
          const fresh = [bug.freshOther ? 'Live · confirmed totals (beta)' : COPY.live, 'updated 3 s ago'];
          // `hiddenCommunity`: the community line is in the DOM with its name but `visibility: hidden`.
          if (!bug.noCommunity) add({ sels: [SEL.displayCommunity], text: bug.hiddenCommunity ? '' : name, content: name, visible: !bug.hiddenCommunity });
          add({ sels: [SEL.displayTitle], text: g.title });
          // `hiddenUpdated`: the second freshness line is in the DOM with its copy but `visibility: hidden`.
          const seenFresh = bug.hiddenUpdated ? fresh.slice(0, 1) : fresh;
          add({ sels: ['main.public-display'], text: `${bug.noCommunity || bug.hiddenCommunity ? '' : `${name} `}${g.title} ${n(g.seeded)} ${of} ${seenFresh.join(' ')} To join: ask a helper or scan the kiosk’s code` });
          add({ sels: [SEL.displayTotalNumber], text: n(g.seeded) });
          add({ sels: [SEL.displayTotalOf], text: of });
          add({ sels: [SEL.displayFreshness], text: seenFresh.join(' ') });
          fresh.forEach((f, i) => add({ sels: [SEL.displayFreshLines], text: i && bug.hiddenUpdated ? '' : f, content: f, visible: !(i && bug.hiddenUpdated) }));
        }
      }
      if (view === 'shell') {
        add({ sels: [SEL.nav] });
        if (tour) add({ sels: [SEL.tourCard] }, add({ role: 'button', name: 'Skip tour', onClick: () => { tourSeen = true; } }));
        if (card) {
          const g = server.groups[card.groupId];
          add({ sels: [SEL.joinCard, `${SEL.joinCard}[data-connected-join="${card.stage}"]`], text: card.stage === 'preview' ? `Join ${g?.name ?? 'this community'}? Nothing is joined until you tap Join.` : 'You’re in. How do you want to move?' });
          if (card.stage === 'preview') add({ within: SEL.joinCard, role: 'button', name: 'Join', onClick: blocked(() => {
            const already = memberships().includes(card.groupId);
            joins += 1;
            const gid = bug.joinOther ? `someOtherGroup${joins}` : card.groupId;
            server.members[store.uid] = [...memberships(), gid];
            current = gid;
            if (bug.manifestLostOnJoin) fs.rmSync(manifest, { force: true });
            emit('wsfJoinCommunity', { joinCode: store.session['wsf.pendingJoinCode'] }, { groupId: gid, alreadyMember: already || !!bug.alreadyMember });
            // A double-submitted Join: a second request the server answers as already a member.
            if (bug.doubleJoin) emit('wsfJoinCommunity', { joinCode: store.session['wsf.pendingJoinCode'] }, { groupId: gid, alreadyMember: true });
            hydrate();
            card.stage = 'choose';
          }) });
          if (card.stage === 'choose') add({ sels: [SEL.movePhone], role: 'button', name: 'Move on my phone', onClick: blocked(() => { card = null; delete store.session['wsf.pendingJoinCode']; delete store.session['wsf.pendingJoinGoal']; cam = true; }) });
        }
        if (cam) {
          add({ sels: [SEL.camScreen] });
          add({ sels: [SEL.camNote], text: bug.noPrivacy ? 'Camera on' : COPY.camNote });
          add({ sels: [SEL.camPanel], text: bug.modelFail ? 'Movement counter couldn’t start Try again' : `${COPY.noCamera} You can still enter your squats by hand. ${COPY.manual}` });
          if (!bug.modelFail) add({ role: 'button', name: COPY.manual, onClick: () => { cam = false; sheet = true; } });
        }
        if (sheet) add({ sels: [SEL.sheet], text: `Start moving ${COPY.manualSheet} Back Review` });
        for (const t of ['home', 'community', 'progress', 'you']) add({ sels: [SEL.tab(t)], onClick: blocked(() => { tab = t; }) });
        if (tab === 'home') {
          const homeGroup = bug.homeStale ? memberships()[0] : current;
          const g = Object.values(server.goals).find((x) => x.groupId === homeGroup);
          add({ sels: [SEL.panel('Home')], text: g ? `Your community ${server.groups[homeGroup].name} ${g.title} ${g.seeded} / ${g.target} confirmed Start moving` : 'Find your people' });
        }
        if (tab === 'progress') add({ sels: [SEL.panel('Progress')] }, bug.noEmpty || add({ sels: [SEL.progressEmpty] }), bug.noEmpty || add({ sels: [`${SEL.progressEmpty} h2`], text: COPY.progressEmpty }));
        if (tab === 'you') {
          const mine = memberships();
          add({ sels: [SEL.panel('You')] });
          if (!bug.noReminder) add({ sels: [SEL.verifyNotice], text: `${COPY.verifyReminder} You can keep moving. Confirming your email makes sure it’s really yours. Send email I’ve verified Later` });
          const cur = current ? (server.groups[current]?.name ?? 'Other') : '';
          add({ sels: [SEL.belongingTitle], text: cur });
          add({ sels: [SEL.belongingBand], text: `Your current community ${cur} Role Member Community 2 members` });
          const words = (server.profiles[store.uid] ?? '').split(/\s+/).filter(Boolean);
          add({ sels: [SEL.portraitInitials], text: words.length ? `${words[0][0]}${words.at(-1)[0]}`.toUpperCase() : '' });
          const listed = bug.dupList ? mine.map(() => current) : mine;
          if (mine.length > 1 && !bug.noList) for (const g of listed) add({ sels: [SEL.memberships], text: `${server.groups[g]?.name ?? 'Other'} Member${g === current || bug.bothCurrent ? ' · current' : ''}` });
        }
      }
      return els;
    }
    function locator(match, scope = null, filterText = null, index = null) {
      const all = () => {
        let els = render().filter((e) => match(e) && (scope === null || e.within === scope));
        if (filterText !== null) els = els.filter((e) => String(e.text ?? '').includes(filterText));
        return index === null ? els : els.slice(index, index + 1);
      };
      const one = () => { const e = all()[0]; if (!e) throw new Error('locator: no element'); return e; };
      return {
        first: () => locator(match, scope, filterText, 0),
        nth: (i) => locator(match, scope, filterText, i),
        filter: ({ hasText }) => locator(match, scope, hasText, index),
        getByRole: (role, { name, exact } = {}) => locator((e) => e.role === role && (exact ? e.name === name : String(e.name ?? '').includes(name)), match.sel ?? null),
        count: async () => all().length,
        isVisible: async () => all().some((e) => e.visible),
        innerText: async () => one().text ?? '',
        textContent: async () => one().content ?? one().text ?? '',
        getAttribute: async (n) => one().attrs?.[n] ?? null,
        click: async () => { const e = one(); if (e.onClick) e.onClick(); },
        fill: async (v) => { const e = one(); if (e.onFill) e.onFill(v); },
        waitFor: async () => { if (!all().some((e) => e.visible)) throw new Error('locator.waitFor: Timeout exceeded'); },
      };
    }
    const bySel = (sel) => { const parts = sel.split(', '); const m = (e) => parts.some((p) => e.sels.includes(p)); m.sel = sel; return m; };
    return {
      on: (ev, f) => { listeners[ev].push(f); },
      url: () => url,
      async goto(to) {
        await pageLoad(context, to);
        const u = new URL(to);
        url = to;
        cam = false; sheet = false; tab = 'home';
        if (u.pathname.startsWith('/display/')) {
          view = 'display';
          display = u.pathname.slice('/display/'.length);
          emit('wsfGoalPulse', { goalId: display }, server.goals[display]?.display ? { sharedTotal: server.goals[display].seeded } : null, server.goals[display]?.display ? null : 'NOT_FOUND');
          return;
        }
        const join = u.searchParams.get('join');
        if (join && /^[A-Za-z0-9_-]{16,128}$/.test(join)) {
          store.session['wsf.pendingJoinCode'] = join;
          if (u.searchParams.get('goal')) store.session['wsf.pendingJoinGoal'] = u.searchParams.get('goal');
          if (!bug.noStrip) url = `${u.origin}/`;
          if (bug.dropPending) delete store.session['wsf.pendingJoinCode'];
        }
        if (!store.uid) view = 'signin';
        else if (!server.profiles[store.uid]) view = 'profile';
        else enterShell();
      },
      locator: (sel) => locator(bySel(sel)),
      getByRole: (role, { name, exact } = {}) => locator((e) => e.role === role && !e.within && (exact ? e.name === name : String(e.name ?? '').includes(name))),
      getByLabel: (label) => locator((e) => e.label === label),
      keyboard: { press: async (key) => {
        assert.equal(key, 'Escape');
        if (sheet || cam) { if (bug.contributeOnCancel) emit('wsfContribute', { goalId: 'g', attemptId: 'a', count: 1 }, { addedCount: 1 }); sheet = false; cam = false; } else if (bug.tour && view === 'shell' && tab === 'home') tourSeen = true;
      } },
      async evaluate(fn, arg) {
        const prev = globalThis.sessionStorage;
        globalThis.sessionStorage = { getItem: (k) => (Object.hasOwn(store.session, k) ? store.session[k] : null) };
        try { return fn(arg); } finally { if (prev === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = prev; }
      },
      async screenshot({ path: p }) { assert.ok(p.startsWith(shotsDir), 'screenshots stay in the evidence directory'); fs.writeFileSync(p, `PNG ${view} ${opts.viewport.width}x${opts.viewport.height}`); },
      async waitForTimeout() { const f = later.shift(); if (f) f(); },
    };
  }
  return { server, browser, fixtures, manifest, shotsDir, dir };
}
const statusOf = (rows, id) => rows[id]?.status;
const cellsAt = (rows, cell) => VIEWPORTS.map((v) => statusOf(rows, `${cell}@${v.id}`));

test('journey: every cell PASSES at all four viewports; each visitor is tracked from its sign-up response; nothing is contributed; the code never reaches a result', async () => {
  const t = twin();
  const out = await runMatrix({ browser: t.browser, fixtures: t.fixtures, runTag: TAG, base: LOVABLE_URL, reviewed: FAKE_REVIEWED, shotsDir: t.shotsDir, manifest: t.manifest });
  for (const v of VIEWPORTS) for (const c of CELLS) assert.equal(statusOf(out.rows, `${c.id}@${v.id}`), 'PASS', `${c.id}@${v.id}: ${out.rows[`${c.id}@${v.id}`]?.seen}`);
  assert.equal(statusOf(out.rows, 'fixture-provenance'), 'PASS');
  assert.deepEqual(t.server.kitCalls, ['dm1', 'dm2']);
  assert.equal(t.server.kitAfterContext, 0, 'the kit writes nothing once a browser context exists, so it never overwrites the visitor tracking');
  assert.deepEqual(t.server.contexts.map((o) => [o.viewport.width, o.viewport.height, o.serviceWorkers, o.hasTouch]), [[360, 640, 'block', true], [390, 844, 'block', true], [820, 1180, 'block', true], [1440, 900, 'block', false]]);
  assert.equal(t.browser.closed, 4, 'every context is closed');
  assert.equal(t.server.requests.filter((r) => r.name === 'wsfContribute').length, 0);
  // Each visitor: this run's synthetic email, in the manifest with both memberships and its profile before any save.
  assert.equal(t.server.signups.length, 4);
  for (const [i, s] of t.server.signups.entries()) assert.match(s.email, new RegExp(`^wsf-${TAG}-dm${VIEWPORTS[i].id}-[0-9a-f]{4}@example\\.com$`));
  const m = JSON.parse(fs.readFileSync(t.manifest, 'utf8'));
  assert.deepEqual(m.users.sort(), t.server.signups.map((s) => s.uid).sort());
  for (const { uid } of t.server.signups) for (const d of [`wsfMemberships/e5cgrp-${TAG}-dm1_${uid}`, `wsfMemberships/e5cgrp-${TAG}-dm2_${uid}`, `wsfMemberProfiles/${uid}`]) assert.ok(m.docs.includes(d), d);
  assert.ok(m.docs.includes(`wsfGoals/e5cgoal-${TAG}-dm1`), 'the kit\'s own documents are kept');
  assert.equal(cleanerAdmits(m), true);
  assert.equal(out.trackingFailed, null);
  assert.deepEqual(out.extras.users.sort(), m.users.sort());
  // Evidence: screenshots per cell inside the evidence directory; results carry no code, email or password.
  for (const v of VIEWPORTS) for (const c of CELLS) for (const s of out.rows[`${c.id}@${v.id}`].shots) assert.ok(fs.existsSync(path.join(t.dir, s)), s);
  for (const v of VIEWPORTS) for (const c of CELLS) assert.ok(out.rows[`${c.id}@${v.id}`].shots.length >= 1, `${c.id}@${v.id} has its screenshot`);
  assert.equal(out.rows['progress-you@v390'].shots.length, 2, 'Progress and You each have a screenshot');
  const doc = JSON.stringify(results(out.rows));
  for (const code of Object.values(t.server.groups).map((g) => g.joinCode)) assert.equal(doc.includes(code), false, 'the join code never reaches a result');
  assert.doesNotMatch(doc, /@example\.com|Wsf!/);
  assert.equal(out.served.violations.length, 0);
  assert.ok(out.served.verified > 0);
  assert.ok(out.served.blocked.length >= VIEWPORTS.length * 8 && out.served.blocked.every((w) => w === `script ${EVENTS_SCRIPT}` || w === `script ${FLOCK_SCRIPT}`), 'the host\'s own scripts are blocked on every page load, never run');
});

test('display and name step (LOVABLE-MATRIX-ALIGN-1): the served db3fd2f2 markup passes; the old copy, an uppercase step, another freshness line or a missing community fails', () => {
  const fx = { communityName: 'Fixture Open Community', goalTitle: 'Fixture Open Squats', target: 500, seeded: 120 };
  // What db3fd2f2's public-display-view.tsx renders for that goal while live (the page text is innerText).
  const served = {
    state: 'live', title: fx.goalTitle, community: fx.communityName, total: '120', of: 'of 500 squats', fresh: ['Live · confirmed totals', 'updated 0 s ago'],
    page: 'Fixture Open Community Fixture Open Squats 120 of 500 squats Live · confirmed totals updated 0 s ago To join: ask a helper or scan the kiosk’s code',
  };
  const ok = displayVerdict(served, fx);
  assert.equal(ok.ok, true, ok.seen);
  assert.equal(ok.seen, 'display state live; title the fixture goal; community the fixture community; total the seeded 120 of 500 squats; freshness "Live · confirmed totals" / "updated 0 s ago"');
  // Numbers as the product formats them: Intl en-GB, at most 3 fraction digits.
  assert.equal(displayNumber(12345), '12,345');
  assert.equal(displayNumber(1234.56789), '1,234.568');
  const big = { ...fx, target: 100000, seeded: 12345 };
  assert.equal(displayVerdict({ ...served, total: '12,345', of: 'of 100,000 squats', page: 'x 12,345 of 100,000 squats' }, big).ok, true);
  for (const [why, change, seenRe] of [
    ['the old "/ 500 confirmed" text', { of: '/ 500 confirmed', page: served.page.replace('of 500 squats', '/ 500 confirmed') }, /total the seeded 120 "\/ 500 confirmed"/],
    ['a target not formatted as the product does', { ...{ total: '12345', of: 'of 100000 squats', page: 'x 12345 of 100000 squats' }, big: true }, /"12345" "of 100000 squats"/],
    ['another unit', { of: 'of 500 reps' }, /"of 500 reps"/],
    ['a missing community element', { community: '' }, /community absent/],
    ['another community', { community: 'Fixture Closed Community' }, /community "Fixture Closed Community"/],
    ['a freshness first line with any other text', { fresh: ['Live · confirmed totals (beta)', 'updated 0 s ago'] }, /freshness "Live · confirmed totals \(beta\)"/],
    ['a stale first line', { fresh: ['Last known progress — not live right now.', 'Last update 10:00:00 · 40 s ago'] }, /Last known progress/],
    ['a second line in another form', { fresh: ['Live · confirmed totals', 'updated just now'] }, /"updated just now"/],
    ['one freshness line', { fresh: ['Live · confirmed totals'] }, /freshness "Live · confirmed totals"$/],
    ['a third freshness line', { fresh: ['Live · confirmed totals', 'updated 0 s ago', 'extra'] }, /"extra"/],
    ['no freshness lines', { fresh: [] }, /freshness absent/],
    ['another state', { state: 'stale' }, /display state stale/],
    ['another title', { title: 'Other Goal' }, /title "Other Goal"/],
    ['a seeded total missing from the page text', { page: 'Fixture Open Community Fixture Open Squats of 500 squats' }, /\(not in the page text\)/],
    ['a total that is not the seeded one', { total: '121' }, /total "121"/],
  ]) {
    const { big: useBig, ...read } = change;
    const v = displayVerdict({ ...served, ...read }, useBig ? big : fx);
    assert.equal(v.ok, false, why);
    assert.match(v.seen, seenRe, why);
  }
  assert.ok(FRESH_UPDATED_RE.test('updated 12 s ago') && !FRESH_UPDATED_RE.test('updated 12 s ago.') && !FRESH_UPDATED_RE.test('xupdated 1 s ago'));
  // A long read is quoted shortly, never in full.
  assert.match(displayVerdict({ ...served, community: 'c'.repeat(300) }, fx).seen, new RegExp(`community "${'c'.repeat(39)}…"`));
  // The name step: exactly "Step 2 of 2", as text. innerText of the served `.eyebrow` reads "STEP 2 OF 2".
  assert.equal(stepVerdict('Step 2 of 2'), true);
  for (const t of ['STEP 2 OF 2', 'Step 3 of 3', 'Step 2 of 3', '', 'step 2 of 2', 'Step 2 of 2 ']) assert.equal(stepVerdict(t), false, JSON.stringify(t));
  assert.equal(SEL.profileStep, '[data-entry-step="profileSetup"] p.eyebrow');
  assert.equal(SEL.displayCommunity, 'main.public-display p.public-display-community');
  // The unit the display names is the one the kit's joinableEvent goals carry.
  const kit = fs.readFileSync(new URL('./journeys/fixture-kit.mjs', import.meta.url), 'utf8');
  const body = kit.slice(kit.indexOf('async function joinableEvent'), kit.indexOf('\n  }\n', kit.indexOf('async function joinableEvent')));
  assert.match(body, new RegExp(`unit: '${FIXTURE_UNIT}'`));
});

test('journey negatives: each defect fails exactly the cell that measures it, at every viewport', async () => {
  const run = async (bug) => {
    const t = twin(bug);
    return { t, out: await runMatrix({ browser: t.browser, fixtures: t.fixtures, runTag: TAG, base: LOVABLE_URL, reviewed: FAKE_REVIEWED, shotsDir: t.shotsDir, manifest: t.manifest }) };
  };
  for (const [bug, cell] of [
    [{ sampleData: true }, 'landing'], [{ displayNotAuthorized: true }, 'display'], [{ noStrip: true }, 'invite-link'], [{ dropPending: true }, 'invite-link'],
    [{ dishonestNotice: true }, 'signup'], [{ wrongStep: true }, 'signup'], [{ noPrivacy: true }, 'camera-fallback'], [{ modelFail: true }, 'camera-fallback'],
    [{ noReminder: true }, 'progress-you'], [{ noList: true }, 'memberships'], [{ noEmpty: true }, 'progress-you'],
    [{ sendOk: true, sendOkNotice: true }, 'signup'], [{ wrongNoticeText: true }, 'signup'],
    [{ bothCurrent: true }, 'memberships'], [{ dupList: true }, 'memberships'], [{ homeStale: true }, 'memberships'], [{ readShort: true }, 'memberships'],
    // LOVABLE-MATRIX-ALIGN-1: the expectations of the served build db3fd2f2.
    [{ oldTotal: true }, 'display'], [{ freshOther: true }, 'display'], [{ noCommunity: true }, 'display'], [{ upperStep: true }, 'signup'],
    // W7 PN-4 on #614: an exact-copy leaf the visitor cannot see (`visibility: hidden`) reads as absent.
    [{ hiddenCommunity: true }, 'display'], [{ hiddenStep: true }, 'signup'], [{ hiddenUpdated: true }, 'display'],
  ]) {
    const { out } = await run(bug);
    assert.deepEqual(cellsAt(out.rows, cell), ['FAIL', 'FAIL', 'FAIL', 'FAIL'], `${JSON.stringify(bug)} fails ${cell}`);
    const others = CELLS.filter((c) => c.id !== cell && !(bug.dropPending && ['invite-join', 'camera-fallback', 'progress-you', 'memberships'].includes(c.id)));
    for (const c of others) assert.deepEqual(cellsAt(out.rows, c.id), ['PASS', 'PASS', 'PASS', 'PASS'], `${JSON.stringify(bug)} leaves ${c.id}`);
  }
  // A join the product makes before the tap, a double-submitted tap, or an already-member answer fails the join, at both invites.
  for (const bug of [{ autoJoin: true }, { doubleJoin: true }, { alreadyMember: true }]) {
    const { out } = await run(bug);
    for (const cell of ['invite-join', 'memberships']) assert.deepEqual(cellsAt(out.rows, cell), ['FAIL', 'FAIL', 'FAIL', 'FAIL'], `${JSON.stringify(bug)} fails ${cell}`);
    for (const cell of ['landing', 'display', 'invite-link', 'signup', 'unverified-participation', 'camera-fallback', 'progress-you']) assert.deepEqual(cellsAt(out.rows, cell), ['PASS', 'PASS', 'PASS', 'PASS'], `${JSON.stringify(bug)} leaves ${cell}`);
  }
  assert.match((await run({ autoJoin: true })).out.rows['invite-join@v360'].seen, /join requests before the tap 1/);
  // The seen text names what was read where it differs.
  assert.match((await run({ oldTotal: true })).out.rows['display@v360'].seen, /total the seeded 120 "\/ 500 confirmed"/);
  assert.match((await run({ noCommunity: true })).out.rows['display@v360'].seen, /community absent/);
  assert.match((await run({ hiddenCommunity: true })).out.rows['display@v360'].seen, /community absent/);
  assert.match((await run({ hiddenStep: true })).out.rows['signup@v390'].seen, /name step step count absent$/);
  assert.match((await run({ hiddenUpdated: true })).out.rows['display@v360'].seen, /freshness "Live · confirmed totals" \/ absent/);
  assert.match((await run({ freshOther: true })).out.rows['display@v360'].seen, /freshness "Live · confirmed totals \(beta\)" \/ "updated 3 s ago"/);
  assert.match((await run({ upperStep: true })).out.rows['signup@v390'].seen, /name step step count "STEP 2 OF 2"/);
  assert.match((await run({ doubleJoin: true })).out.rows['invite-join@v360'].seen, /join requests before the tap 0, after 2/);
  // A manifest that refuses the linked claim for a foreign join is a tracking failure, not a silent stop.
  const lost = await run({ joinOther: true, manifestLostOnJoin: true });
  assert.match(lost.out.trackingFailed, /^v360: the cleanup manifest refused the entry/);
  assert.equal(statusOf(lost.out.rows, 'invite-join@v360'), 'FAIL');
  // Any other profile-save error is a FAIL, never BLOCKED (backend).
  const se = (await run({ saveError: true })).out;
  for (const cell of ['unverified-participation', 'invite-join', 'camera-fallback', 'progress-you', 'memberships']) assert.deepEqual(cellsAt(se.rows, cell), ['FAIL', 'FAIL', 'FAIL', 'FAIL'], cell);
  // An honest notice when the send succeeds is no notice at all.
  assert.deepEqual(cellsAt((await run({ sendOk: true })).out.rows, 'signup'), ['PASS', 'PASS', 'PASS', 'PASS']);
  // A contribution sent on cancel fails the camera cell (and the later cells that count contributions).
  const c = (await run({ contributeOnCancel: true })).out;
  assert.deepEqual(cellsAt(c.rows, 'camera-fallback'), ['FAIL', 'FAIL', 'FAIL', 'FAIL']);
  assert.deepEqual(cellsAt(c.rows, 'memberships'), ['FAIL', 'FAIL', 'FAIL', 'FAIL']);
  // The served backend refusing an unverified profile save is BLOCKED (backend), and so is everything it stops.
  const b = (await run({ saveRefused: true })).out;
  for (const cell of ['landing', 'display', 'invite-link', 'signup']) assert.deepEqual(cellsAt(b.rows, cell), ['PASS', 'PASS', 'PASS', 'PASS'], cell);
  for (const cell of ['unverified-participation', 'invite-join', 'camera-fallback', 'progress-you', 'memberships']) assert.deepEqual(cellsAt(b.rows, cell), ['BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED'], cell);
  assert.match(b.rows['unverified-participation@v360'].seen, /refuses an unverified profile save/);
  assert.match(b.rows['memberships@v360'].seen, /not reached: unverified-participation stopped this viewport/);
  // A join answered for another community fails the join and is claimed as linked through the visitor's uid.
  const o = await run({ joinOther: true });
  assert.deepEqual(cellsAt(o.out.rows, 'invite-join'), ['FAIL', 'FAIL', 'FAIL', 'FAIL']);
  const m = JSON.parse(fs.readFileSync(o.t.manifest, 'utf8'));
  for (const { uid } of o.t.server.signups) for (const n of [1, 2]) assert.ok(m.linkedDocs.some((l) => l.path === `wsfMemberships/someOtherGroup${n}_${uid}` && l.via === uid), `${uid} join ${n}`);
  assert.equal(cleanerAdmits(m), true);
  // The first-run tour is dismissed through its own Skip, and the cells still pass.
  const tour = (await run({ tour: true })).out;
  for (const c of CELLS) assert.deepEqual(cellsAt(tour.rows, c.id), ['PASS', 'PASS', 'PASS', 'PASS'], c.id);
});

test('journey: a sign-up whose response names no account stops that viewport before the profile step and is reported as untracked', async () => {
  const t = twin({ noSignupResponse: true });
  const out = await runMatrix({ browser: t.browser, fixtures: t.fixtures, runTag: TAG, base: LOVABLE_URL, reviewed: FAKE_REVIEWED, shotsDir: t.shotsDir, manifest: t.manifest });
  assert.deepEqual(cellsAt(out.rows, 'signup'), ['FAIL', 'FAIL', 'FAIL', 'FAIL']);
  assert.deepEqual(cellsAt(out.rows, 'unverified-participation'), ['FAIL', 'FAIL', 'FAIL', 'FAIL']);
  assert.match(out.trackingFailed, /the sign-up answer was not seen and no lookup could name the account/);
  assert.equal(t.server.requests.filter((r) => r.name === 'wsfSaveProfile').length, 0, 'no profile is saved for an account the manifest does not name');
});

test('journey: a lost sign-up answer is recovered by looking the synthetic email up; a failed lookup is a tracking failure', async () => {
  const t = twin({ noSignupResponse: true });
  const asked = [];
  const lookup = async (email) => { asked.push(email); return t.server.signups.filter((x) => x.email === email).map((x) => x.uid); };
  const out = await runMatrix({ browser: t.browser, fixtures: t.fixtures, runTag: TAG, base: LOVABLE_URL, reviewed: FAKE_REVIEWED, shotsDir: t.shotsDir, manifest: t.manifest, lookup });
  for (const c of CELLS) assert.deepEqual(cellsAt(out.rows, c.id), ['PASS', 'PASS', 'PASS', 'PASS'], c.id);
  assert.match(out.rows['signup@v360'].seen, /by lookup: the sign-up answer was not seen/);
  assert.equal(out.trackingFailed, null);
  assert.deepEqual(asked, t.server.signups.map((x) => x.email), 'each viewport asks for its own synthetic email only');
  const m = JSON.parse(fs.readFileSync(t.manifest, 'utf8'));
  assert.deepEqual(m.users.sort(), t.server.signups.map((x) => x.uid).sort());
  assert.equal(cleanerAdmits(m), true);
  const f = twin({ noSignupResponse: true });
  const failed = await runMatrix({ browser: f.browser, fixtures: f.fixtures, runTag: TAG, base: LOVABLE_URL, reviewed: FAKE_REVIEWED, shotsDir: f.shotsDir, manifest: f.manifest, lookup: async () => { throw new Error('HTTP 503'); } });
  assert.deepEqual(cellsAt(failed.rows, 'signup'), ['FAIL', 'FAIL', 'FAIL', 'FAIL']);
  assert.match(failed.trackingFailed, /account lookup failed/);
});

test('journey: a cleanup manifest that refuses the visitor stops that viewport before the profile step and is a tracking failure', async () => {
  const t = twin();
  const out = await runMatrix({ browser: t.browser, fixtures: t.fixtures, runTag: TAG, base: LOVABLE_URL, reviewed: FAKE_REVIEWED, shotsDir: t.shotsDir, manifest: path.join(t.dir, 'missing', 'cleanup-manifest.json') });
  assert.deepEqual(cellsAt(out.rows, 'signup'), ['FAIL', 'FAIL', 'FAIL', 'FAIL']);
  assert.match(out.trackingFailed, /^v360: /);
  assert.equal(t.server.requests.filter((r) => r.name === 'wsfSaveProfile').length, 0);
});

test('guard: unreviewed code on the invite page fails host-build and stops the whole matrix before any account is created', async () => {
  const t = twin({ foreignOnJoin: true });
  const out = await runMatrix({ browser: t.browser, fixtures: t.fixtures, runTag: TAG, base: LOVABLE_URL, reviewed: FAKE_REVIEWED, shotsDir: t.shotsDir, manifest: t.manifest });
  assert.equal(out.served.violations.length, 1);
  assert.match(out.served.violations[0], /cdn\.example\.test\/join\.js/);
  assert.equal(kiosk.hostBuildRow({ status: 'PASS', reason: 'x' }, out.served).status, 'FAIL');
  assert.equal(statusOf(out.rows, 'landing@v360'), 'PASS');
  assert.equal(statusOf(out.rows, 'invite-link@v360'), 'FAIL');
  for (const v of VIEWPORTS.slice(1)) assert.equal(statusOf(out.rows, `landing@${v.id}`), 'FAIL', 'no later viewport runs');
  assert.equal(t.server.passwordFills, 0, 'nothing is typed after the guard refused');
  assert.equal(t.server.accounts, 0);
  assert.equal(t.browser.closed, 1);
  // The check follows every navigation: the display, and the second invite in the same tab.
  const d = twin({ foreignOnDisplay: true });
  const od = await runMatrix({ browser: d.browser, fixtures: d.fixtures, runTag: TAG, base: LOVABLE_URL, reviewed: FAKE_REVIEWED, shotsDir: d.shotsDir, manifest: d.manifest });
  assert.deepEqual([statusOf(od.rows, 'landing@v360'), statusOf(od.rows, 'display@v360'), statusOf(od.rows, 'landing@v390')], ['PASS', 'FAIL', 'FAIL']);
  assert.equal(d.server.accounts, 0);
  const s2 = twin({ foreignOnSecondInvite: true });
  const o2 = await runMatrix({ browser: s2.browser, fixtures: s2.fixtures, runTag: TAG, base: LOVABLE_URL, reviewed: FAKE_REVIEWED, shotsDir: s2.shotsDir, manifest: s2.manifest });
  assert.equal(statusOf(o2.rows, 'progress-you@v360'), 'PASS');
  assert.equal(statusOf(o2.rows, 'memberships@v360'), 'FAIL');
  assert.equal(statusOf(o2.rows, 'landing@v390'), 'FAIL', 'no later viewport runs');
  assert.equal(s2.server.accounts, 1, 'only the first viewport\'s visitor was created');
});

// ---- the CLI ----------------------------------------------------------------------------------------
/** The host as fetch sees it: each document rendered for its own path, unless `doc` says otherwise. */
function host(files = FAKE_ASSETS, doc = (p) => servedDoc(p)) {
  return async (url, init) => {
    assert.equal(init.redirect, 'error');
    const u = new URL(url);
    assert.equal(u.origin, LOVABLE_URL, 'never another origin');
    const p = u.pathname;
    const body = p.startsWith('/assets/') ? files[p] : doc(p);
    if (body === undefined) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? (p.startsWith('/assets/') ? 'text/javascript' : 'text/html; charset=utf-8') : null) }, arrayBuffer: async () => Buffer.from(body) };
  };
}

test('cli: --bind exits non-zero before any credential unless the served build is exactly the reviewed one; --run refuses a non-PASS bind before the kit or a browser', async () => {
  const env = { WSF_LOVABLE_URL: LOVABLE_URL, WSF_PROJECT: PROJECT_ID };
  const lines = [];
  assert.equal(await cli('--bind', env, { fetchImpl: host(), say: (l) => lines.push(l) }), 1, 'the fake host is not the shipped pin, so the gate stops');
  assert.match(lines[0], /^LOVABLE_BUILD=FAIL/);
  assert.deepEqual(lines.filter((l) => l.startsWith('LOVABLE_OBSERVED_DOCUMENT ')), Object.entries(FAKE_REVIEWED.documents).map(([t, d]) => `LOVABLE_OBSERVED_DOCUMENT ${t} ${d.sha256} u=2 nul=2 (stream part 1, other inline script 0, markup 1) img=${d.img} bom=no${d.img ? ' preview-image=a74c72a1c0451cab76648ebdb57437a9_1791601764778' : ''}`), 'the kiosk harness\'s route-aware bind, one canonical document per template');
  assert.equal(lines.filter((l) => l.startsWith('LOVABLE_DOCUMENT_PROBE ')).length, kiosk.BIND_PROBES.length);
  assert.ok(lines.every((l) => !/join=|\?/.test(l)), 'probe lines name the page, never its query');
  assert.equal(await cli('--bind', env, { fetchImpl: host(), reviewed: FAKE_REVIEWED, say: () => {} }), 0);
  // A server-rendered deep link that carries more than its own params is no longer only reported: the bind fails.
  const ssr = [];
  assert.equal(await cli('--bind', env, { fetchImpl: host(undefined, (p) => servedDoc(p, p.startsWith('/display/') ? `<p>${p.length}</p>` : '')), reviewed: FAKE_REVIEWED, say: (l) => ssr.push(l) }), 1, 'route data beyond the params stops the gate');
  assert.match(ssr[0], /^LOVABLE_BUILD=FAIL \(the served \/display\/\$goalId document differs/);
  assert.ok(ssr.some((l) => /^LOVABLE_OBSERVED_DOCUMENT \/display\/\$goalId UNBOUND \(its 2 loads reduce to 2 different canonical documents/.test(l)));
  assert.equal(await cli('--bind', env, { fetchImpl: host({ ...FAKE_ASSETS, '/assets/shell-AAA.js': 'changed' }), reviewed: FAKE_REVIEWED, say: () => {} }), 1);
  assert.equal(await cli('--bind', { ...env, WSF_PROJECT: 'goarrive' }, { fetchImpl: host(), reviewed: FAKE_REVIEWED, say: () => {} }), 1, 'never another project');
  assert.equal(await cli('--bind', { ...env, WSF_LOVABLE_URL: 'https://westayfit-staging.web.app' }, { fetchImpl: host(), reviewed: FAKE_REVIEWED, say: () => {} }), 1, 'never another host');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-dm-cli-'));
  let imported = 0; let launched = 0;
  const code = await cli('--run', { ...env, WSF_RESULT_DIR: dir }, { fetchImpl: host(), importKit: async () => { imported += 1; return {}; }, launch: async () => { launched += 1; return {}; }, say: () => {} });
  assert.equal(code, 1);
  assert.deepEqual([imported, launched], [0, 0], 'no kit and no browser behind a refused bind');
  const doc = JSON.parse(fs.readFileSync(path.join(dir, 'lovable-device-matrix', 'results.json'), 'utf8'));
  assert.equal(doc.rows[0].status, 'FAIL', 'host-build: the fake host is not the shipped pin');
  assert.equal(doc.rows.length, ROWS.length);
});

test('cli: a full --run with the fake kit and browser writes the matrix, tracks every visitor, and --require recomputes the verdict', async () => {
  const t = twin();
  const sdk = path.join(t.dir, 'sdk.json');
  fs.writeFileSync(sdk, JSON.stringify({ result: { sdkConfig: { projectId: PROJECT_ID, apiKey: 'demo' } } }));
  const env = { WSF_LOVABLE_URL: LOVABLE_URL, WSF_PROJECT: PROJECT_ID, WSF_RESULT_DIR: t.dir, WSF_SDK_CONFIG_FILE: sdk, WSF_GOOGLE_ACCESS_TOKEN: 'tok', WSF_CLEANUP_MANIFEST: t.manifest };
  const lines = [];
  const code = await cli('--run', env, {
    fetchImpl: host(), reviewed: FAKE_REVIEWED, say: (l) => lines.push(l), launch: async () => ({ ...t.browser, close: async () => {} }),
    importKit: async () => ({ createFixtureKit: (o) => { assert.equal(o.projectId, PROJECT_ID); assert.match(o.runTag, /^e5c-[0-9a-z]+-[0-9a-f]{6}$/); return t.fixtures; } }),
    journey: (o) => runMatrix({ ...o, runTag: TAG, shotsDir: t.shotsDir }),
  });
  const doc = JSON.parse(fs.readFileSync(path.join(t.dir, 'lovable-device-matrix', 'results.json'), 'utf8'));
  assert.equal(doc.rows.find((r) => r.id === 'cleanup-tracking').status, 'PASS', doc.rows.find((r) => r.id === 'cleanup-tracking').seen);
  assert.equal(doc.rows.find((r) => r.id === 'host-build').status, 'PASS');
  assert.equal(code, 0, lines.filter((l) => !/=PASS$/.test(l)).join(' | '));
  assert.ok(lines.includes(`LOVABLE_DEVICE_CELL landing: ${VIEWPORTS.map((v) => `${v.id}=PASS`).join(' ')}`));
  // LOVABLE-GUARD-PING-1 item 7: each status line, unchanged, is followed by that row's seen text, in --run and --require.
  const seenAfter = (out) => doc.rows.forEach((r) => {
    const at = out.indexOf(`LOVABLE_DEVICE_ROW ${r.id}=${r.status}`);
    assert.ok(at >= 0, r.id);
    assert.equal(out[at + 1], kiosk.seenLine('LOVABLE_DEVICE_SEEN', r.id, r.seen), r.id);
  });
  seenAfter(lines);
  assert.match(lines[lines.indexOf('LOVABLE_DEVICE_ROW display@v360=PASS') + 1], /^LOVABLE_DEVICE_SEEN display@v360 display state live; /);
  const req = [];
  assert.equal(await cli('--require', { WSF_RESULT_DIR: t.dir, WSF_CLEANUP_OUTCOME: 'success', WSF_SCAN_OUTCOME: 'success' }, { say: (l) => req.push(l) }), 0);
  assert.ok(req.includes('LOVABLE_DEVICE_MATRIX=PASS'));
  seenAfter(req);
  assert.equal(await cli('--require', { WSF_RESULT_DIR: t.dir, WSF_CLEANUP_OUTCOME: 'failure', WSF_SCAN_OUTCOME: 'success' }, { say: () => {} }), 1);
  assert.equal(await cli('--require', { WSF_RESULT_DIR: path.join(t.dir, 'nothing-here'), WSF_CLEANUP_OUTCOME: 'success', WSF_SCAN_OUTCOME: 'success' }, { say: () => {} }), 1);
});

/** A full --run of the CLI on the fake host, kit and browser. The account lookup is `lookupFetch`, or (lookupFromTwin)
 *  answered from the twin's own sign-ups; `journey(o, t)` replaces the matrix. */
async function cliRun(bug, { lookupFetch, lookupFromTwin = false, journey } = {}) {
  const t = twin(bug);
  if (lookupFromTwin) lookupFetch = lookupFrom(t);
  const sdk = path.join(t.dir, 'sdk.json');
  fs.writeFileSync(sdk, JSON.stringify({ result: { sdkConfig: { projectId: PROJECT_ID, apiKey: 'demo' } } }));
  const env = { WSF_LOVABLE_URL: LOVABLE_URL, WSF_PROJECT: PROJECT_ID, WSF_RESULT_DIR: t.dir, WSF_SDK_CONFIG_FILE: sdk, WSF_GOOGLE_ACCESS_TOKEN: 'tok', WSF_CLEANUP_MANIFEST: t.manifest };
  const code = await cli('--run', env, {
    fetchImpl: host(), lookupFetch, reviewed: FAKE_REVIEWED, say: () => {}, launch: async () => ({ ...t.browser, close: async () => {} }),
    importKit: async () => ({ createFixtureKit: () => t.fixtures }),
    journey: journey ? (o) => journey(o, t) : (o) => runMatrix({ ...o, runTag: TAG, shotsDir: t.shotsDir }),
  });
  const doc = JSON.parse(fs.readFileSync(path.join(t.dir, 'lovable-device-matrix', 'results.json'), 'utf8'));
  return { t, code, doc, row: (id) => doc.rows.find((r) => r.id === id) };
}
const lookupFrom = (t) => async (url, init) => {
  const email = JSON.parse(init.body).email[0];
  return { ok: true, status: 200, json: async () => ({ users: t.server.signups.filter((x) => x.email === email).map((x) => ({ localId: x.uid, email: x.email })) }) };
};

test('cli: an account the journey could not track FAILS cleanup-tracking, whatever else was tracked; a lookup that names it lets the cleaner have it', async () => {
  const lost = await cliRun({ noSignupResponse: true }, { lookupFetch: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  assert.equal(lost.code, 1);
  assert.equal(lost.row('cleanup-tracking').status, 'FAIL', lost.row('cleanup-tracking').seen);
  assert.match(lost.row('cleanup-tracking').seen, /may be missing from the cleanup manifest/);
  assert.equal(lost.t.server.accounts, 4, 'the product created four accounts');
  assert.equal(JSON.parse(fs.readFileSync(lost.t.manifest, 'utf8')).users.length, 0, 'none of them is in the manifest');
  // The same lost answers, with the lookup available: every account is found by its synthetic email and tracked.
  const rec = await cliRun({ noSignupResponse: true }, { lookupFromTwin: true });
  assert.equal(rec.row('cleanup-tracking').status, 'PASS', rec.row('cleanup-tracking').seen);
  assert.deepEqual(JSON.parse(fs.readFileSync(rec.t.manifest, 'utf8')).users.sort(), rec.t.server.signups.map((x) => x.uid).sort());
  assert.equal(rec.code, 0);
  // A refused manifest write during the journey also FAILS the row.
  const refused = await cliRun({}, { journey: (o, t) => runMatrix({ ...o, runTag: TAG, shotsDir: t.shotsDir, manifest: path.join(t.dir, 'missing', 'm.json') }) });
  assert.equal(refused.row('cleanup-tracking').status, 'FAIL');
  // Nothing created and nothing lost: the PASS says exactly that.
  const none = await cliRun({}, { journey: async () => ({ rows: { 'fixture-provenance': { status: 'PASS', seen: 'x' } }, extras: { users: [], docs: [], linked: [] }, trackingFailed: null, served: { verified: 1, violations: [] } }) });
  assert.equal(none.row('cleanup-tracking').status, 'PASS');
  assert.match(none.row('cleanup-tracking').seen, /no visitor account was tracked and none went untracked/);
  const silent = await cliRun({}, { journey: async () => ({ rows: { 'fixture-provenance': { status: 'PASS', seen: 'x' } }, extras: { users: [], docs: [], linked: [] }, trackingFailed: 'v360: lost', served: { verified: 1, violations: [] } }) });
  assert.equal(silent.row('cleanup-tracking').status, 'FAIL', 'an untracked account with nothing else tracked is still a FAIL');
});

test('cli: host-build in the written results joins the bind with what the browser was served', async () => {
  const bad = await cliRun({}, { journey: async () => ({ rows: {}, extras: { users: [], docs: [], linked: [] }, trackingFailed: null, served: { verified: 3, violations: ['script https://cdn.example.test/x.js is outside the reviewed build'] } }) });
  assert.equal(bad.row('host-build').status, 'FAIL');
  assert.match(bad.row('host-build').seen, /unreviewed request/);
  const none = await cliRun({}, { journey: async () => ({ rows: {}, extras: { users: [], docs: [], linked: [] }, trackingFailed: null, served: { verified: 0, violations: [] } }) });
  assert.equal(none.row('host-build').status, 'FAIL', 'a bind with no verified load is not a PASS');
});

test('accountLookup: the kit\'s admin read by email, uids only, never a body echoed', async () => {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ users: [{ localId: 'UidVisitor9', email: 'x' }, { localId: 'bad uid!' }, {}] }) }; };
  assert.deepEqual(await accountLookup('tok', f)('wsf-e5c-a-dmv360-ab12@example.com'), ['UidVisitor9']);
  assert.equal(calls[0].url, 'https://identitytoolkit.googleapis.com/v1/projects/westayfit-staging/accounts:lookup');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(calls[0].init.body), { email: ['wsf-e5c-a-dmv360-ab12@example.com'] });
  assert.deepEqual(await accountLookup('tok', async () => ({ ok: true, status: 200, json: async () => ({}) }))('e'), [], '{} is the documented none');
  await assert.rejects(accountLookup('tok', async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'secret detail' } }) }))('e'), (e) => /HTTP 403/.test(e.message) && !/secret detail/.test(e.message));
  await assert.rejects(accountLookup('tok', async () => ({ ok: true, status: 200, json: async () => ({ users: 'x' }) }))('e'), /unexpected type/);
});

// ---- the workflow mode -------------------------------------------------------------------------------
test('workflow: the gate binds credential-free; the job binds again before it authenticates, cleans up blocking, scans before upload, and requires', () => {
  const y = fs.readFileSync(new URL('../workflows/wsf-staging-deploy.yml', import.meta.url), 'utf8');
  const code = (t) => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const jobBlock = (name) => { const at = y.indexOf(`\n  ${name}:\n`); const next = y.slice(at + 1).search(/\n {2}[a-z][a-z-]*:\n/); return y.slice(at, next < 0 ? undefined : at + 1 + next); };
  const steps = (job) => job.split(/\n {6}- /).slice(1).map((s) => `- ${s}`);
  const named = (job, n) => steps(job).find((s) => s.startsWith(`- name: ${n}\n`) || s.includes(`\n        name: ${n}\n`)) ?? '';
  // The mode exists, and every privileged job that runs it names it by equality.
  assert.match(y, /^ {10}- lovable-device-matrix$/m);
  for (const j of ['gate', 'config']) assert.match(jobBlock(j), /^ {4}if: \$\{\{[^\n]*inputs\.mode == 'lovable-device-matrix' \}\}$/m, j);
  // The gate: credential-free, and its bind is the device matrix's own.
  const gate = jobBlock('gate');
  assert.equal(/id-token/.test(code(gate)), false, 'the gate never holds an OIDC capability');
  const gateBind = named(gate, 'Bind the Lovable host\'s served build for the device matrix before any credentialed job');
  assert.match(gateBind, /if: \$\{\{ inputs\.mode == 'lovable-device-matrix' \}\}/);
  assert.match(gateBind, /WSF_LOVABLE_URL: https:\/\/we-stay-fit-foundation-trial\.lovable\.app\n/);
  assert.match(gateBind, /WSF_PROJECT: westayfit-staging\n/);
  assert.match(gateBind, /run: node \.github\/wsf-staging\/hosted-lovable-device-matrix\.mjs --bind\n/);
  // The job.
  const job = jobBlock('lovable-device-matrix');
  assert.match(job, /^ {4}needs: \[gate, config\]$/m);
  assert.match(job, /^ {4}if: \$\{\{ inputs\.mode == 'lovable-device-matrix' \}\}$/m, 'exact equality, never a negation');
  assert.match(job, /^ {4}environment: wsf-staging$/m);
  assert.match(job, /\n {4}permissions:\n {6}contents: read\n {6}id-token: write\n {4}steps:/, 'exactly contents: read and id-token: write');
  const names = steps(job).map((s) => (/^- (?:name: (.+)|uses: (\S+))/.exec(s) ?? [])[1] ?? (/^- (?:name: (.+)|uses: (\S+))/.exec(s) ?? [])[2]);
  const at = (n) => names.indexOf(n);
  for (const n of ['Bind the served build again before any credential or fixture', 'Authenticate to Google Cloud', 'Run the Lovable device matrix', 'Re-authenticate before cleanup', 'Remove the device matrix fixtures', 'Scan evidence before upload', 'Require the Lovable device matrix to have passed']) assert.ok(at(n) >= 0, n);
  assert.ok(at('Bind the served build again before any credential or fixture') < at('Install candidate dependencies without lifecycle scripts'), 'the bind runs before any install');
  assert.ok(at('Bind the served build again before any credential or fixture') < at('Authenticate to Google Cloud'), 'the bind runs before the credential');
  assert.ok(at('Authenticate to Google Cloud') < at('Run the Lovable device matrix'));
  assert.ok(at('Run the Lovable device matrix') < at('Remove the device matrix fixtures') && at('Remove the device matrix fixtures') < at('Scan evidence before upload'));
  assert.ok(at('Scan evidence before upload') < names.indexOf('actions/upload-artifact@330a01c490aca151604b8cf639adc76d48f6c5d4') && names.indexOf('actions/upload-artifact@330a01c490aca151604b8cf639adc76d48f6c5d4') < at('Require the Lovable device matrix to have passed'));
  assert.match(named(job, 'Bind the served build again before any credential or fixture'), /run: node ops\/\.github\/wsf-staging\/hosted-lovable-device-matrix\.mjs --bind/);
  assert.match(named(job, 'Run the Lovable device matrix'), /node \.\.\/ops\/\.github\/wsf-staging\/hosted-lovable-device-matrix\.mjs --run/);
  assert.match(named(job, 'Re-authenticate before cleanup'), /if: \$\{\{ always\(\) && steps\.bind\.outcome == 'success' \}\}/, 'no credential at all after a refused bind');
  const cleanup = named(job, 'Remove the device matrix fixtures');
  assert.match(cleanup, /if: always\(\)/);
  assert.match(cleanup, /node ops\/\.github\/wsf-staging\/cleanup-synthetic\.mjs/);
  assert.match(cleanup, /WSF_CLEANUP_MANIFEST: \$\{\{ github\.workspace \}\}\/wsf-lovable-device-evidence\/lovable-device-matrix\/cleanup-manifest\.json/);
  assert.equal(/\|\| true|continue-on-error/.test(cleanup), false, 'cleanup is blocking');
  assert.match(named(job, 'Scan evidence before upload'), /node ops\/\.github\/wsf-staging\/scan-evidence\.mjs "\$\{\{ github\.workspace \}\}\/wsf-lovable-device-evidence"/);
  const upload = steps(job).find((s) => s.startsWith('- uses: actions/upload-artifact@'));
  assert.match(upload, /if: \$\{\{ always\(\) && steps\.scan-lovable-device-evidence\.outcome == 'success' \}\}/, 'nothing is uploaded unless the scan passed');
  assert.match(upload, /name: wsf-lovable-device-evidence\n/);
  const req = named(job, 'Require the Lovable device matrix to have passed');
  assert.match(req, /if: always\(\)/);
  assert.match(req, /WSF_CLEANUP_OUTCOME: \$\{\{ steps\.cleanup\.outcome \}\}/);
  assert.match(req, /WSF_SCAN_OUTCOME: \$\{\{ steps\.scan-lovable-device-evidence\.outcome \}\}/);
  assert.match(req, /hosted-lovable-device-matrix\.mjs --require/);
  // No build, no deploy, no secret, no other host.
  const live = code(job);
  for (const bad of ['firebase deploy', 'firebase-tools', 'secrets.', 'pull_request_target', 'npx ', 'goarrive']) assert.equal(live.includes(bad), false, `the job must not carry ${bad}`);
  for (const l of live.split('\n').filter((x) => /npm (install|--prefix .* ci)/.test(x))) assert.match(l, /--ignore-scripts/, l.trim());
  assert.match(live, /google-auth-library@9\.15\.1/);
  assert.deepEqual([...live.matchAll(/WSF_LOVABLE_URL: (\S+)/g)].map((m) => m[1]), [LOVABLE_URL, LOVABLE_URL]);
});

test('workflow: the safety order is pinned: one evidence directory end to end, a blocking cleanup that nothing swallows, the bind id and no silenced step', () => {
  const y = fs.readFileSync(new URL('../workflows/wsf-staging-deploy.yml', import.meta.url), 'utf8');
  const jobAt = y.indexOf('\n  lovable-device-matrix:\n');
  const job = y.slice(jobAt, jobAt + 1 + y.slice(jobAt + 1).search(/\n {2}[a-z][a-z-]*:\n/));
  const liveOf = (t) => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const steps = job.split(/\n {6}- /).slice(1).map((x) => `- ${x}`);
  const step = (n) => liveOf(steps.find((x) => x.startsWith(`- name: ${n}\n`)) ?? '');
  const live = liveOf(job);
  const DIR = '${{ github.workspace }}/wsf-lovable-device-evidence';
  const values = (k) => [...live.matchAll(new RegExp(`^\\s+${k}: (.+)$`, 'gm'))].map((m) => m[1].trim());
  // Every path the job reads or writes evidence through is the ONE directory the scan reads and the upload sends.
  assert.deepEqual(values('WSF_RESULT_DIR'), [DIR, DIR], 'the run and the verdict read the scanned directory');
  assert.deepEqual(values('WSF_CLEANUP_MANIFEST'), [`${DIR}/lovable-device-matrix/cleanup-manifest.json`, `${DIR}/lovable-device-matrix/cleanup-manifest.json`], 'the run writes the manifest the cleanup reads');
  assert.deepEqual(values('WSF_CLEANUP_RECEIPT'), [`${DIR}/lovable-device-matrix/cleanup-receipt.json`]);
  const scan = step('Scan evidence before upload');
  assert.match(scan, /^\s+if: always\(\)$/m);
  assert.ok(scan.includes(`mkdir -p "${DIR}"`) && scan.includes(`node ops/.github/wsf-staging/scan-evidence.mjs "${DIR}"`), 'the scan reads exactly that directory');
  const upload = liveOf(steps.find((x) => x.startsWith('- uses: actions/upload-artifact@')) ?? '');
  assert.deepEqual([...upload.matchAll(/^\s+path: (.+)$/gm)].map((m) => m[1].trim()), ['wsf-lovable-device-evidence'], 'the upload sends that directory and nothing else');
  // The cleanup is BLOCKING (as C4 pins for hosted-verify): exact always(), the only early success before the cleaner, nothing after it.
  const cleanup = step('Remove the device matrix fixtures');
  assert.match(cleanup, /^\s+if: always\(\)$/m, 'cleanup runs whatever the run did');
  assert.match(cleanup, /^\s+id: cleanup$/m, 'the verdict reads this outcome');
  assert.equal(/continue-on-error/.test(cleanup), false, 'a failed cleanup fails the job');
  const noManifest = cleanup.indexOf('if [ ! -f "$WSF_CLEANUP_MANIFEST" ]; then');
  const cleaner = cleanup.indexOf('node ops/.github/wsf-staging/cleanup-synthetic.mjs');
  assert.ok(noManifest !== -1 && cleaner > noManifest);
  assert.equal((cleanup.match(/exit 0/g) || []).length, 1, 'exactly one success exit: the no-manifest branch');
  assert.ok(cleanup.indexOf('exit 0') < cleaner);
  const after = cleanup.slice(cleaner);
  assert.match(after, /^node ops\/\.github\/wsf-staging\/cleanup-synthetic\.mjs\s*$/m, 'the cleaner\'s exit status is the step\'s');
  assert.equal(/\|\||set \+e|; *true|exit 0/.test(after), false, 'nothing may swallow a cleanup failure');
  assert.match(cleanup, /^\s+set -euo pipefail$/m);
  // The bind: its id is what re-authentication reads; neither bind may be silenced; Authenticate is success-gated only.
  assert.match(step('Bind the served build again before any credential or fixture'), /^\s+id: bind$/m);
  assert.equal(/continue-on-error/.test(live), false, 'no step of the job may be silenced');
  const gate = y.slice(y.indexOf('\n  gate:\n'), y.indexOf('\n  config:\n'));
  const gateBind = liveOf(gate.split(/\n {6}- /).find((x) => x.startsWith('name: Bind the Lovable host\'s served build for the device matrix')) ?? '');
  assert.ok(gateBind.length > 0);
  assert.equal(/continue-on-error/.test(gateBind), false, 'an unbound build must stop the gate');
  assert.equal(/^\s+if:/m.test(step('Authenticate to Google Cloud')), false, 'success-gated: skipped after a failed bind');
  assert.match(step('Re-authenticate before cleanup'), /^\s+if: \$\{\{ always\(\) && steps\.bind\.outcome == 'success' \}\}$/m);
  assert.match(step('Require the Lovable device matrix to have passed'), /^\s+if: always\(\)$/m);
});

test('the harness reuses the kiosk proof\'s reviewed bind and code guard rather than restating them', () => {
  const src = fs.readFileSync(new URL('./hosted-lovable-device-matrix.mjs', import.meta.url), 'utf8');
  assert.match(src, /from '\.\/hosted-lovable-kiosk\.mjs';/);
  for (const own of ['function classifyRequest', 'function codeGuard', 'function servedManifest', 'function bindBuild', 'function checkBase', 'function canonicalDocument', 'function matchTemplate', 'BIND_PROBES = ', 'REVIEWED_BUILD = ', 'data-context-token', 'data-tsr-stream-part']) assert.equal(src.includes(own), false, own);
  assert.match(src, /await ctx\.route\('\*\*\/\*', guard\.handle\);/, 'every context routes every request through the guard');
  assert.match(src, /serviceWorkers: 'block'/);
  assert.equal(/userAgent|devices\[/.test(src), false, 'no mobile user agent: the viewport alone, so the Auth SDK loads nothing from another origin');
});

// ---- runner ---------------------------------------------------------------------------------------
for (const [name, fn] of pending) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL  ${name}`);
    throw e;
  }
}
console.log(`hosted-lovable-device-matrix: ${passed} passed`);
