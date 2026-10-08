#!/usr/bin/env node
/**
 * LOVABLE-KIOSK-HOSTED-PROOF-1 (Director #365 6044515892, release 6044894488): the signed-in kiosk proof against the
 * Lovable Web Twin, run ONLY by the `lovable-kiosk` mode of the trusted staging workflow. Proof only: it builds and
 * deploys nothing, and it never runs against any host but LOVABLE_URL or any project but westayfit-staging.
 *
 *   --bind     credential-free (the gate job): read the host's served assets, hash every one, and compare the set to
 *              REVIEWED_BUILD below. Exit 0 only on an exact match. An empty REVIEWED_BUILD (nothing reviewed yet), a
 *              missing, extra or changed asset, or an unreadable host refuses BEFORE any credential exists, and prints
 *              the observed manifest (names and sha256 only) so a reviewed commit can pin it.
 *   --run      credentialed (the lovable-kiosk job): bind again (drift since the gate refuses), then seed run-tagged
 *              fixtures with the EXISTING kit (journeys/fixture-kit.mjs) and drive the real Lovable UI. Every browser
 *              context routes every request through codeGuard: each document and /assets/ script or stylesheet the
 *              browser loads must carry its reviewed digest (fulfilled with exactly the hashed bytes), and nothing else
 *              executable is loaded; a refusal fails host-build and stops the journey before the next step. The
 *              browser runs with no cloud or workflow credential in its environment. Every row is PASS, FAIL or
 *              BLOCKED; results are written in `finally`; exit 0 only when every row passed.
 *   --require  after blocking cleanup and the evidence scan: recompute the verdict from the written results and the
 *              cleanup and scan outcomes. Exit 0 only on every row PASS, cleanup success and scan success.
 *
 * WHAT IS NOT CLAIMED (rows stay BLOCKED, named):
 *  - the station turn rows (queue place, call, phone-ready, expected-turn start, 60-second round, review, station
 *    Finish): the safe station backend (#587) is not accepted or served, and an older station path is never driven;
 *  - the genuinely unverified account: the existing kit creates verified accounts only (#396 6043231980), and no
 *    verification is faked;
 *  - the Champion's approval is the kit's Champion callable (tracked for cleanup), not the Champion UI.
 * Visitors A and B are kit accounts that are NOT members of the event community: they join through the real QR link.
 *
 * Secrets: account passwords exist only in memory (the kit's), never in a result, log line or file. Identities are
 * recorded as a short sha256 of the uid. Nothing here writes to the Lovable project.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export const LOVABLE_URL = 'https://we-stay-fit-foundation-trial.lovable.app';
export const PROJECT_ID = 'westayfit-staging';
/**
 * The reviewed served build: the sha256 of the entry page itself (its inline scripts and the asset list it loads) and
 * asset name -> sha256 of its bytes. EMPTY until a reviewed commit pins the manifest a `--bind` run printed; while
 * empty, every run stops in the credential-free gate. An observed digest is evidence for review, never self-approval.
 */
export const REVIEWED_BUILD = Object.freeze({ indexSha256: null, assets: Object.freeze({}) });
/** At most this many assets are read when walking the served build. */
export const MAX_ASSETS = 150;
/**
 * The only other origins the journey's pages may reach, and only for data (xhr, fetch, eventsource), never for a
 * document or a script: Firebase Auth, Firestore and the staging callables.
 */
export const API_ORIGINS = Object.freeze([
  'https://identitytoolkit.googleapis.com',
  'https://securetoken.googleapis.com',
  'https://firestore.googleapis.com',
  `https://us-central1-${PROJECT_ID}.cloudfunctions.net`,
]);

export const ROWS = Object.freeze([
  ['host-build', 'the exact Lovable host serves exactly the reviewed entry page and asset digests, at bind AND for every document, script and stylesheet the browser loads; nothing else executable is loaded'],
  ['fixture-provenance', 'the event community, goal, Champion and visitors A and B are run-tagged kit fixtures in the cleanup manifest'],
  ['qr-join', 'visitor A, not a member, joins the event community through the kiosk QR link on the Lovable host'],
  ['queue-place', 'the visitor takes one place in the station line'],
  ['call', 'the station calls the visitor'],
  ['phone-ready', 'the visitor taps ready on the phone'],
  ['expected-turn-start', 'the station starts the expected turn'],
  ['round-60s', 'the 60-second round runs and writes nothing at timer end'],
  ['review', 'the station shows the round for review'],
  ['contribution-7', 'visitor A sends exactly one wsfContribute for this goal with count 7 and a fresh attempt id'],
  ['operation-receipt', 'that request\'s own response: 7 added, alreadyRecorded false, an integer own credit and shared total in the goal\'s unit, and the screen shows exactly that total'],
  ['own-history-shared', 'fresh reads for the selected test goal: own credit up by exactly 7 and equal to the receipt, the shared total equal to the receipt, and the exact entry in A\'s own history'],
  ['reopen-static', 'reopening MOVE on the same goal shows the recorded state and sends no second contribution'],
  ['account-isolation', 'A -> B -> A: B\'s context, own history and pending MOVE carry nothing of A; A returns in fresh storage with the same identity and the same record'],
  ['station-finish', 'station Finish leaves no previous visitor for the next one'],
  ['organizer-ui-approval', 'the Champion approves the kiosk code through the Manage community UI'],
  ['unverified-account', 'a genuinely unverified account joins and contributes'],
  ['cleanup-tracking', 'every product-written document (membership, contribution) is in the cleanup manifest before cleanup'],
].map(([id, expected]) => Object.freeze({ id, expected })));
const STATION_BLOCK = 'the safe station backend (#587) is not accepted or served; an older station path is never driven';
export const FIXED_BLOCKED = Object.freeze({
  'queue-place': STATION_BLOCK, call: STATION_BLOCK, 'phone-ready': STATION_BLOCK, 'expected-turn-start': STATION_BLOCK,
  'round-60s': STATION_BLOCK, review: STATION_BLOCK, 'station-finish': STATION_BLOCK,
  'unverified-account': 'the existing fixture kit creates verified accounts only (#396 6043231980); verification is never faked',
  'organizer-ui-approval': 'the station is approved through the kit\'s Champion callable as fixture preparation (tracked for cleanup); a UI approval would create a station record the kit cannot track',
});

const short = (e) => String(e?.message || e).split('\n')[0].replace(/[?&][A-Za-z]+=[^&\s"']+/g, '?…').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>').slice(0, 200);
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export const idHash = (uid) => (typeof uid === 'string' && uid ? sha256(uid).slice(0, 16) : null);

/** The base URL, refused unless it is exactly the one allowed host. */
export function checkBase(raw) {
  let u;
  try { u = new URL(raw); } catch { return { ok: false, reason: 'not a URL' }; }
  if (u.protocol !== 'https:' || u.origin !== LOVABLE_URL || !['', '/'].includes(u.pathname) || u.search || u.hash || u.username || u.password) {
    return { ok: false, reason: `not exactly ${LOVABLE_URL}` };
  }
  return { ok: true, base: LOVABLE_URL };
}

/** Every same-origin asset the served build loads, by name, with the sha256 of its bytes. Bounded; never follows another origin. */
export async function servedManifest(fetchImpl, base = LOVABLE_URL) {
  const get = async (p) => {
    const res = await fetchImpl(`${base}${p}`, { redirect: 'error', headers: { 'user-agent': 'wsf-lovable-kiosk-bind' } });
    if (!res.ok) throw new Error(`${p} answered HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  };
  const html = (await get('/')).toString('utf8');
  // Same-origin references only: `assets/x.js` or `/assets/x.js` right after a quote, parenthesis or space (never the
  // path inside another origin's URL), and, inside a chunk, Vite's sibling imports `./x.js` (which live in /assets/).
  const refs = (text, inChunk = false) => [
    ...[...text.matchAll(/(?:^|["'(\s])\/?(assets\/[A-Za-z0-9_.-]+\.(?:js|css))/g)].map((m) => `/${m[1]}`),
    ...(inChunk ? [...text.matchAll(/["']\.\/([A-Za-z0-9_.-]+\.(?:js|css))["']/g)].map((m) => `/assets/${m[1]}`) : []),
  ];
  const queue = [...new Set(refs(html))];
  const assets = {};
  while (queue.length) {
    const p = queue.shift();
    const name = p.slice('/assets/'.length);
    if (Object.hasOwn(assets, name)) continue;
    if (Object.keys(assets).length >= MAX_ASSETS) throw new Error(`more than ${MAX_ASSETS} assets; refusing a partial manifest`);
    const body = await get(p);
    assets[name] = sha256(body);
    if (p.endsWith('.js')) for (const r of refs(body.toString('utf8'), true)) if (!Object.hasOwn(assets, r.slice(8)) && !queue.includes(r)) queue.push(r);
  }
  if (!Object.keys(assets).length) throw new Error('the served page names no asset');
  return { indexSha256: sha256(Buffer.from(html)), assets: Object.fromEntries(Object.entries(assets).sort(([a], [b]) => (a < b ? -1 : 1))) };
}

/** The observed build against the reviewed one: PASS only on the same names with the same digests. */
export function bindBuild(observed, reviewed = REVIEWED_BUILD) {
  const want = reviewed?.assets ?? {};
  if (!Object.keys(want).length || !/^[0-9a-f]{64}$/.test(String(reviewed?.indexSha256))) return { status: 'BLOCKED', reason: 'no reviewed digest manifest is pinned yet (REVIEWED_BUILD needs the entry page and every asset)' };
  if (observed?.indexSha256 !== reviewed.indexSha256) return { status: 'FAIL', reason: 'the served entry page differs from the reviewed one (inline or loaded executable content changed)' };
  const got = observed?.assets ?? {};
  const missing = Object.keys(want).filter((n) => !Object.hasOwn(got, n));
  const extra = Object.keys(got).filter((n) => !Object.hasOwn(want, n));
  const changed = Object.keys(want).filter((n) => Object.hasOwn(got, n) && got[n] !== want[n]);
  if (missing.length || extra.length || changed.length) {
    return { status: 'FAIL', reason: `the served build differs from the reviewed one: ${missing.length} missing, ${extra.length} unreviewed, ${changed.length} changed (${[...missing, ...extra, ...changed].slice(0, 5).join(', ')})` };
  }
  return { status: 'PASS', reason: `${Object.keys(want).length} reviewed assets served exactly` };
}

/** The lines a bind prints: the verdict, then the observed manifest (names and digests only). */
export function bindLines(observed, verdict) {
  return [`LOVABLE_BUILD=${verdict.status} (${verdict.reason})`, ...(observed ? [`LOVABLE_OBSERVED_INDEX ${observed.indexSha256}`] : []), ...(observed ? Object.entries(observed.assets).map(([n, d]) => `LOVABLE_OBSERVED_ASSET ${n} ${d}`) : [])];
}

const PASSIVE_TYPES = new Set(['image', 'font', 'media', 'manifest', 'texttrack', 'xhr', 'fetch', 'eventsource']);
const DATA_TYPES = new Set(['xhr', 'fetch', 'eventsource']);
/**
 * What the browser may load (#589 W9 finding #497 6051520120: the digest must bind what EXECUTES, not a neighbouring
 * fetch). On the Lovable host: every document (each navigation, SPA deep links included) must be the reviewed entry
 * page; every script or stylesheet must be a reviewed /assets/ file with its reviewed digest; passive types pass.
 * Elsewhere: only data requests to API_ORIGINS pass. Everything else is refused. `what` never carries a query.
 */
export function classifyRequest({ url, type, navigation }, reviewed = REVIEWED_BUILD) {
  let u;
  try { u = new URL(url); } catch { return { action: 'abort', reason: `${type} with an unreadable URL` }; }
  const what = `${type} ${u.origin}${u.pathname}`;
  if (u.origin === LOVABLE_URL) {
    if (navigation || type === 'document') return { action: 'verify', want: reviewed?.indexSha256 ?? null, what };
    if (type === 'script' || type === 'stylesheet') {
      const name = /^\/assets\/([A-Za-z0-9_.-]+)$/.exec(u.pathname)?.[1];
      return name && Object.hasOwn(reviewed?.assets ?? {}, name) ? { action: 'verify', want: reviewed.assets[name], what } : { action: 'abort', reason: `${what} is not a reviewed asset` };
    }
    return PASSIVE_TYPES.has(type) ? { action: 'continue', what } : { action: 'abort', reason: `${what} is not a permitted resource type` };
  }
  if (API_ORIGINS.includes(u.origin) && !navigation && DATA_TYPES.has(type)) return { action: 'continue', what };
  return { action: 'abort', reason: `${what} is outside the reviewed build and the permitted API origins` };
}

/**
 * The served-code guard, routed on EVERY browser context of the journey (service workers blocked, so none can answer
 * around it). A verified response is fetched once, hashed, and fulfilled with exactly the hashed bytes; a redirect, an
 * error status, a different digest, an unreviewed or foreign script or document is aborted and recorded. `check()`
 * throws once anything was refused, so the journey stops before the next step (a sign-in included).
 */
export function codeGuard(reviewed = REVIEWED_BUILD) {
  const violations = [];
  let verified = 0;
  async function handle(route) {
    const req = route.request();
    const c = classifyRequest({ url: req.url(), type: req.resourceType(), navigation: req.isNavigationRequest() }, reviewed);
    const refuse = async (reason) => { violations.push(reason); try { await route.abort('blockedbyclient'); } catch { /* the page may be gone */ } };
    if (c.action === 'continue') { try { await route.continue(); } catch { /* the page may be gone */ } return; }
    if (c.action === 'abort') { await refuse(c.reason); return; }
    if (!/^[0-9a-f]{64}$/.test(String(c.want))) { await refuse(`${c.what}: no reviewed digest is pinned`); return; }
    let res;
    let body;
    try { res = await route.fetch({ maxRedirects: 0 }); body = await res.body(); } catch (e) { await refuse(`${c.what} could not be read: ${short(e)}`); return; }
    if (res.status() !== 200) { await refuse(`${c.what} answered HTTP ${res.status()}, not the reviewed file`); return; }
    if (sha256(body) !== c.want) { await refuse(`${c.what} differs from its reviewed digest`); return; }
    verified += 1;
    try { await route.fulfill({ response: res, body }); } catch { /* the page may be gone */ }
  }
  return {
    handle,
    check() { if (violations.length) throw new Error(`the browser was served code outside the reviewed build: ${violations[0]}`); },
    summary: () => ({ verified, violations: [...violations] }),
  };
}

/** The host-build row: PASS only when the bind matched AND the browser executed only verified documents and assets. */
export function hostBuildRow(bind, served) {
  if (bind?.status !== 'PASS') return { status: bind?.status ?? 'FAIL', seen: bind?.reason ?? 'no bind verdict' };
  if (served?.violations?.length) return { status: 'FAIL', seen: `bind matched, but the browser was served ${served.violations.length} unreviewed request(s): ${served.violations.slice(0, 3).join('; ')}` };
  if (!(served?.verified > 0)) return { status: 'FAIL', seen: 'bind matched, but the browser loaded no verified document' };
  return { status: 'PASS', seen: `bind matched; ${served.verified} document/asset response(s) the browser loaded matched their reviewed digests; nothing else executable was loaded` };
}

/** A --run's results: the journey's rows and the CLI's own, with host-build always from the bind AND what the browser was served. */
export function runResults(bind, journey, rows = {}) {
  return results({ ...journey?.rows, ...rows, 'host-build': hostBuildRow(bind, journey?.served) });
}

/** The browser's environment: the runner's, without any cloud or workflow credential (defence in depth; #589 W9 N2). */
export function browserEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !/^(WSF_GOOGLE_|GOOGLE_|CLOUDSDK_|ACTIONS_ID_TOKEN_REQUEST_|ACTIONS_RUNTIME_|GITHUB_TOKEN$|GH_TOKEN$)/.test(k)));
}

/** The results document: every row, in order, with its status and what was seen. */
export function results(rows, extra = {}) {
  const out = ROWS.map(({ id, expected }) => {
    const r = rows[id] ?? (FIXED_BLOCKED[id] ? { status: 'BLOCKED', seen: FIXED_BLOCKED[id] } : { status: 'BLOCKED', seen: 'not reached' });
    return { id, expected, status: r.status, seen: short(r.seen ?? '') };
  });
  return { schemaVersion: 1, host: LOVABLE_URL, project: PROJECT_ID, rows: out, ...extra };
}
export const allPassed = (doc) => Array.isArray(doc?.rows) && doc.rows.length === ROWS.length && doc.rows.every((r) => r.status === 'PASS');

/** Does `text` show the whole number `n` (en-US grouping or none), not merely contain its digits? */
export function showsNumber(text, n) {
  if (!Number.isInteger(n)) return false;
  const t = String(text ?? '');
  return [n.toLocaleString('en-US'), String(n)].some((f) => new RegExp(`(^|[^\\d,.])${f.replace(/[,.]/g, '\\$&')}(?![\\d,.]*\\d)`).test(t));
}

/**
 * The receipt row from ONE paired callable exchange: the wsfContribute REQUEST this page sent (goalId, attemptId,
 * count) and that request's own RESPONSE (addedCount, ownCredit, alreadyRecorded, sharedTotal, target, unit, status,
 * crossedTarget). The attempt and goal come from the request; nothing is read from a field the response never has.
 */
export function receiptVerdict(exchange, { goalId, amount, unit, screenText }) {
  const q = exchange?.data ?? {};
  const r = exchange?.result;
  const okReq = q.goalId === goalId && q.count === amount && typeof q.attemptId === 'string' && q.attemptId !== '';
  const okRes = !!r && typeof r === 'object' && r.addedCount === amount && r.alreadyRecorded === false
    && Number.isInteger(r.ownCredit) && Number.isInteger(r.sharedTotal) && r.unit === unit;
  const okScreen = okRes && showsNumber(screenText, r.sharedTotal) && String(screenText ?? '').includes(unit);
  return {
    ok: okReq && okRes && okScreen, attemptId: okReq ? q.attemptId : null,
    shared: okRes ? r.sharedTotal : null, ownCredit: okRes ? r.ownCredit : null,
    seen: `request ${okReq ? 'this goal, count ' + amount + ', an attempt' : 'not this goal/count/attempt'}; response addedCount=${r?.addedCount} alreadyRecorded=${r?.alreadyRecorded} unit=${r?.unit === unit ? 'the goal unit' : 'other'} shared=${r?.sharedTotal}; screen ${okScreen ? 'shows exactly that total' : 'does not show exactly that total'}`,
  };
}

/** The selected-goal own credit from a paired wsfMyContribution exchange, or null (never 0 by default). */
export const ownCreditOf = (exchange, goalId) => (exchange?.data?.goalId === goalId && Number.isInteger(exchange?.result?.ownCredit) ? exchange.result.ownCredit : null);
/** The selected-goal shared total from a paired wsfGoalPulse exchange, or null. */
export const sharedOf = (exchange, goalId) => (exchange?.data?.goalId === goalId && Number.isInteger(exchange?.result?.sharedTotal) ? exchange.result.sharedTotal : null);

/**
 * Every wsf* callable this page sends, each REQUEST paired with its own RESPONSE by Playwright's request identity.
 * `onResult(exchange)` runs as each response is decoded, so cleanup tracking never depends on a later assertion.
 * Bodies stay in memory; nothing here is written or logged.
 */
export function callableLog(page, onResult = () => {}) {
  const all = [];
  page.on('request', (req) => {
    let name;
    try { name = /\/(wsf[A-Za-z]+)$/.exec(new URL(req.url()).pathname)?.[1]; } catch { name = null; }
    if (!name || req.method() !== 'POST') return;
    let data = null;
    try { data = JSON.parse(req.postData() || '{}')?.data ?? null; } catch { data = null; }
    all.push({ name, req, data, result: undefined, error: null });
  });
  page.on('response', async (res) => {
    const e = all.find((x) => x.req === res.request());
    if (!e) return;
    try { const b = await res.json(); e.result = b?.result ?? null; e.error = b?.error?.status ?? null; } catch { e.result = null; e.error = 'unreadable'; }
    try { onResult(e); } catch { /* tracking failures surface through the cleanup-tracking row */ }
  });
  const of = (name, goalId) => all.filter((x) => x.name === name && (goalId === undefined || x.data?.goalId === goalId));
  return { of, last: (name, goalId) => of(name, goalId).filter((x) => x.result !== undefined).at(-1) ?? null, sent: (name, goalId) => of(name, goalId).length };
}

/** The product-written documents this run must clean up, added to the kit's manifest after its last write. Run-tagged paths only. */
export function mergeIntoManifest(file, docs) {
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  const bad = docs.filter((d) => typeof d !== 'string' || !d.includes(m.runTag) || d.includes('..') || d.startsWith('/'));
  if (bad.length) throw new Error(`refusing ${bad.length} untagged cleanup path(s)`);
  m.docs = [...new Set([...(m.docs ?? []), ...docs])];
  fs.writeFileSync(file, `${JSON.stringify(m, null, 2)}\n`, { mode: 0o600 });
  return m.docs.length;
}

// ---- the browser journey ----------------------------------------------------------------------
// Selectors and flow are the connected Lovable app's own (src/wsf/kiosk/*, src/demo/move.tsx, together.tsx, shell),
// read at the donor project's HEAD; nothing here is a guess the page cannot confirm.
const PHONE = { width: 390, height: 844 };
const GOAL_TITLE = 'Fixture Expo Squats';
const COMMUNITY = 'Fixture Expo Community';
const UNIT = 'squats';

/** The signed-in Firebase uid of this page: IndexedDB persistence first (the SDK default), then localStorage. */
async function uidOf(page) {
  return page.evaluate(async () => {
    try {
      const rows = await new Promise((resolve) => {
        const open = indexedDB.open('firebaseLocalStorageDb');
        open.onerror = () => resolve([]);
        open.onsuccess = () => {
          try {
            const req = open.result.transaction('firebaseLocalStorage', 'readonly').objectStore('firebaseLocalStorage').getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
          } catch { resolve([]); }
        };
      });
      for (const r of rows) if (r?.value?.uid) return r.value.uid;
    } catch { /* fall through */ }
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith('firebase:authUser')) { try { return JSON.parse(localStorage.getItem(k)).uid || null; } catch { /* next */ } }
    }
    return null;
  });
}
const visible = async (loc) => (await loc.count()) > 0;
/** The first-run tour can open over Home; its own Skip closes it, so later name-based clicks reach the product. */
async function skipTour(page) {
  const skip = page.getByRole('button', { name: 'Skip tour' });
  if (await visible(skip)) await skip.first().click();
}
async function signIn(page, account) {
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForTimeout(6000);
}
async function signOut(page) {
  await page.getByRole('button', { name: 'Open menu' }).first().click();
  await page.getByRole('button', { name: /^Sign out/ }).first().click();
  await page.waitForTimeout(3000);
}
/** The test community, chosen explicitly when the account belongs to several and none is remembered. */
async function chooseCommunity(page) {
  const nav = page.getByRole('navigation', { name: 'Your communities' });
  if (await visible(nav)) await nav.getByRole('button', { name: new RegExp(`^${COMMUNITY}`) }).first().click();
  await page.waitForTimeout(4000);
  await skipTour(page);
}
/** The Progress tab's row for the test goal: its exact own and shared text, or null. */
async function progressRow(page) {
  await page.locator('[data-tab="progress"]').first().click();
  await page.waitForTimeout(2000);
  const row = page.locator('ul.goal-history li').filter({ hasText: GOAL_TITLE });
  return (await visible(row)) ? (await row.first().innerText()).replace(/\s+/g, ' ') : null;
}
/** Leave MOVE's camera or instructions step for the count step (start mode on a squats goal opens the camera). */
async function toCountStep(page) {
  for (const name of ['Count by hand instead', 'Enter reps manually', 'I’m done — enter my count']) {
    const b = page.getByRole('button', { name });
    if (await visible(b)) { await b.first().click(); break; }
  }
}

/**
 * The journey. `fixtures` is the existing kit; every row it reaches is recorded; product writes are tracked from
 * their REQUESTS as they are sent, so a later failed assertion never leaves an untracked document. Every browser
 * context it opens is closed in `finally`, on every return.
 */
export async function runJourney({ browser, fixtures, base, amount = 7, reviewed = REVIEWED_BUILD }) {
  const rows = {};
  const set = (id, ok, seen, status) => { rows[id] = { status: status ?? (ok ? 'PASS' : 'FAIL'), seen }; };
  const productDocs = [];
  const contexts = [];
  const guard = codeGuard(reviewed);
  const ctx = async (viewport = PHONE) => {
    const c = await browser.newContext({ viewport, locale: 'en-US', serviceWorkers: 'block' });
    contexts.push(c);
    await c.route('**/*', guard.handle);
    return c;
  };
  try {
    const ev = await fixtures.expoEvent('lk', { attendees: 0, target: 1000, seeded: 100 });
    const a = (await fixtures.memberInTwoCommunities('lka')).member;
    const b = (await fixtures.memberInTwoCommunities('lkb')).member;
    set('fixture-provenance', true, `${ev.setupId}; visitors A and B are kit accounts outside this community`);
    /** Track what A's page writes, from the request itself (the path is fixed by the request), before any reply. */
    const trackA = (page) => {
      page.on('request', (req) => {
        let name; let data;
        try { name = /\/(wsf[A-Za-z]+)$/.exec(new URL(req.url()).pathname)?.[1]; data = JSON.parse(req.postData() || '{}')?.data; } catch { return; }
        if (name === 'wsfJoinCommunity' && !productDocs.includes(`wsfMemberships/${ev.groupId}_${a.uid}`)) productDocs.push(`wsfMemberships/${ev.groupId}_${a.uid}`);
        if (name === 'wsfContribute' && data?.goalId === ev.goalId && typeof data.attemptId === 'string') fixtures.trackContribution(ev, a, data.attemptId);
      });
    };

    // The kiosk shows its code; the Champion's approval is fixture preparation (the kit's tracked callable).
    const kiosk = await (await ctx({ width: 1280, height: 800 })).newPage();
    await kiosk.goto(`${base}/kiosk/${ev.groupId}/${ev.goalId}`);
    guard.check();
    let joinUrl = null;
    try {
      const codeEl = kiosk.getByTestId('kiosk-pair-code');
      await codeEl.waitFor({ timeout: 30_000 });
      const code = (await codeEl.innerText()).replace(/\s+/g, '');
      if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) { set('qr-join', false, 'the kiosk code is not a pairing code'); return { rows, productDocs, served: guard.summary() }; }
      await fixtures.approveStation(ev, code, 1);
      const qr = kiosk.locator('svg[data-testid="kiosk-qr"]');
      await qr.waitFor({ timeout: 40_000 });
      const raw = await qr.getAttribute('data-join-url');
      const u = raw ? new URL(raw) : null;
      joinUrl = u && u.origin === LOVABLE_URL && u.pathname === '/' && /^[A-Za-z0-9_-]{16,128}$/.test(u.searchParams.get('join') ?? '') && u.searchParams.get('goal') === ev.goalId ? u.href : null;
    } catch (e) {
      const noCode = await visible(kiosk.getByText('This goal has no join code to show.'));
      set('qr-join', false, noCode ? 'the kiosk shows no join code for this community (the kit cannot make a link-joinable community)' : `the kiosk did not reach a QR join link: ${short(e)}`, noCode ? 'BLOCKED' : 'FAIL');
      return { rows, productDocs, served: guard.summary() };
    }
    if (!joinUrl) { set('qr-join', false, 'the QR carries no same-host join link for this goal'); return { rows, productDocs, served: guard.summary() }; }

    // Visitor A: the real QR link, the product sign-in, the deliberate Join, then MOVE on the phone.
    const pageA = await (await ctx()).newPage();
    trackA(pageA);
    const logA = callableLog(pageA);
    await pageA.goto(joinUrl);
    guard.check(); // nothing is typed into a page that loaded anything unreviewed
    await signIn(pageA, a);
    if ((await uidOf(pageA)) !== a.uid) { set('qr-join', false, 'the sign-in did not complete as visitor A'); return { rows, productDocs, served: guard.summary() }; }
    const banner = pageA.locator('[data-connected-join]');
    const join = banner.getByRole('button', { name: 'Join', exact: true });
    if (!(await visible(join))) { set('qr-join', false, 'no Join for a visitor who is not a member'); return { rows, productDocs, served: guard.summary() }; }
    await join.click();
    await pageA.waitForTimeout(5000);
    const joined = logA.last('wsfJoinCommunity');
    const phone = pageA.getByTestId('join-move-phone');
    set('qr-join', joined?.result?.groupId === ev.groupId && joined.result.alreadyMember === false && await visible(phone),
      `join ${joined?.result?.groupId === ev.groupId ? 'into this community' : 'not into this community'}, alreadyMember=${joined?.result?.alreadyMember}; phone choice ${await visible(phone) ? 'shown' : 'absent'}`);
    if (rows['qr-join'].status !== 'PASS') return { rows, productDocs, served: guard.summary() };
    const ownBefore = ownCreditOf(logA.last('wsfMyContribution', ev.goalId), ev.goalId);
    await phone.click();
    await pageA.waitForTimeout(3000);
    await toCountStep(pageA);
    await pageA.locator('input[inputmode=numeric]').first().fill(String(amount));
    await pageA.getByRole('button', { name: 'Review', exact: true }).first().click();
    await pageA.getByTestId('confirm').click();
    const receipt = pageA.locator('section.together-receipt');
    await receipt.waitFor({ timeout: 20_000 });
    await pageA.waitForTimeout(1500);
    const sent = logA.of('wsfContribute');
    const ex = sent.at(-1) ?? null;
    const screen = (await receipt.innerText()).replace(/\s+/g, ' ');
    const r = receiptVerdict(ex, { goalId: ev.goalId, amount, unit: UNIT, screenText: screen });
    const sameAttempt = r.attemptId !== null && (await receipt.getAttribute('data-attempt')) === r.attemptId;
    set('contribution-7', sent.length === 1 && r.attemptId !== null && sameAttempt, `${sent.length} contribution request(s); receipt ${sameAttempt ? 'bound to that request\'s attempt' : 'not bound to that request\'s attempt'}`);
    set('operation-receipt', r.ok && sameAttempt && showsNumber(screen, amount), r.seen);
    await pageA.getByTestId('together-done').click();
    await pageA.waitForTimeout(1500);
    await skipTour(pageA);

    // Fresh reads for the selected test goal, and the exact Progress row.
    await pageA.reload();
    guard.check();
    await pageA.waitForTimeout(6000);
    await skipTour(pageA);
    const ownAfter = ownCreditOf(logA.last('wsfMyContribution', ev.goalId), ev.goalId);
    const shared = sharedOf(logA.last('wsfGoalPulse', ev.goalId), ev.goalId);
    const before = ownBefore ?? 0; // a fresh account on a goal this run created: provably 0 when not read
    const row = await progressRow(pageA);
    const rowOk = row !== null && row.includes(`${(ownAfter ?? NaN).toLocaleString('en-US')} ${UNIT}`) && showsNumber(row, shared);
    if (ownAfter === null || shared === null) set('own-history-shared', false, `own ${ownAfter} shared ${shared}: a selected-goal read is missing`, 'BLOCKED');
    else set('own-history-shared', ownAfter === before + amount && ownAfter === r.ownCredit && shared === r.shared && rowOk,
      `own ${before}${ownBefore === null ? ' (fresh, unread)' : ''} -> ${ownAfter} vs receipt ${r.ownCredit}; shared ${shared} vs receipt ${r.shared}; Progress row ${rowOk ? 'exact' : 'missing or different'}`);

    // Reopen MOVE on the same goal: a fresh draft, nothing replayed, no pending attempt, no second request.
    await pageA.locator('[data-tab="home"]').first().click();
    await pageA.getByRole('button', { name: 'MOVE — add a contribution' }).first().click();
    await pageA.waitForTimeout(2000);
    const pending = await pageA.evaluate((k) => localStorage.getItem(k), `wsf.pendingContribution.${ev.goalId}.${a.uid}`);
    const replayed = await visible(pageA.locator('section.together-receipt'));
    set('reopen-static', !replayed && pending === null && logA.sent('wsfContribute') === 1,
      `receipt replayed ${replayed}; pending attempt ${pending === null ? 'none' : 'present'}; contribution requests ${logA.sent('wsfContribute')}`);
    await pageA.keyboard.press('Escape');

    // A -> B in the same browser storage, then A again in fresh storage with the test community chosen explicitly.
    await signOut(pageA);
    const logB = callableLog(pageA);
    await pageA.goto(`${base}/`);
    guard.check();
    await signIn(pageA, b);
    await skipTour(pageA);
    const uidB = await uidOf(pageA);
    const pendingJoin = await pageA.evaluate(() => ['wsf.pendingJoinCode', 'wsf.pendingJoinGoal'].filter((k) => sessionStorage.getItem(k) !== null).length);
    const bRow = await progressRow(pageA);
    const bReadsA = logB.sent('wsfMyContribution', ev.goalId) + logB.sent('wsfGoalPulse', ev.goalId);
    const bClean = uidB === b.uid && pendingJoin === 0 && bRow === null && bReadsA === 0 && !(await visible(pageA.locator('section.together-receipt')));
    const pageA2 = await (await ctx()).newPage();
    const logA2 = callableLog(pageA2);
    await pageA2.goto(`${base}/`);
    guard.check();
    await signIn(pageA2, a);
    await chooseCommunity(pageA2);
    const back = await uidOf(pageA2);
    const own2 = ownCreditOf(logA2.last('wsfMyContribution', ev.goalId), ev.goalId);
    const row2 = await progressRow(pageA2);
    set('account-isolation', bClean && back === a.uid && own2 === ownAfter && row2 === row,
      `B ${uidB === b.uid ? 'signed in' : 'not signed in'}, pending join keys ${pendingJoin}, test-goal reads ${bReadsA}, Progress row ${bRow === null ? 'absent' : 'present'}; A back as ${idHash(back) === idHash(a.uid) ? 'the same identity' : 'another identity'}, own ${own2} vs ${ownAfter}, row ${row2 === row ? 'the same' : 'different'}`);
  } catch (e) {
    for (const id of ['fixture-provenance', 'qr-join', 'contribution-7', 'operation-receipt', 'own-history-shared', 'reopen-static', 'account-isolation']) rows[id] ??= { status: 'FAIL', seen: `stopped: ${short(e)}` };
  } finally {
    await Promise.all(contexts.map((c) => c.close().catch(() => {})));
  }
  return { rows, productDocs, served: guard.summary() };
}

/** The verdict after cleanup and the scan: PASS only when every row passed and both outcomes are success. */
export function requireVerdict(doc, { cleanup, scan }) {
  const lines = [];
  const rows = Array.isArray(doc?.rows) ? doc.rows : [];
  for (const r of rows) lines.push(`LOVABLE_ROW ${r.id}=${r.status}`);
  const n = (s) => rows.filter((r) => r.status === s).length;
  lines.push(`LOVABLE_ROWS=${n('PASS')} PASS, ${n('FAIL')} FAIL, ${n('BLOCKED')} BLOCKED`);
  lines.push(`LOVABLE_CLEANUP=${cleanup || 'unknown'}`, `LOVABLE_EVIDENCE_SCAN=${scan || 'unknown'}`);
  const ok = allPassed(doc) && cleanup === 'success' && scan === 'success';
  lines.push(`LOVABLE_KIOSK_PROOF=${ok ? 'PASS' : rows.length && n('FAIL') === 0 && n('BLOCKED') > 0 ? 'BLOCKED' : 'FAIL'}`);
  return { ok, lines };
}

// ---- CLI ----------------------------------------------------------------------------------------
async function cli(mode, env) {
  const say = (l) => console.log(l);
  if (mode === '--require') {
    let doc = null;
    try { doc = JSON.parse(fs.readFileSync(path.join(env.WSF_RESULT_DIR, 'lovable-kiosk', 'results.json'), 'utf8')); } catch { /* no results */ }
    const v = requireVerdict(doc, { cleanup: env.WSF_CLEANUP_OUTCOME, scan: env.WSF_SCAN_OUTCOME });
    v.lines.forEach(say);
    return v.ok ? 0 : 1;
  }
  const b = checkBase(env.WSF_LOVABLE_URL);
  if (!b.ok || env.WSF_PROJECT !== PROJECT_ID) { say(`LOVABLE_BUILD=FAIL (${b.ok ? 'the project is not westayfit-staging' : b.reason})`); return 1; }
  let observed = null;
  let verdict;
  try { observed = await servedManifest(fetch, b.base); verdict = bindBuild(observed); } catch (e) { verdict = { status: 'FAIL', reason: `the served build could not be read: ${short(e)}` }; }
  bindLines(observed, verdict).forEach(say);
  if (mode === '--bind') return verdict.status === 'PASS' ? 0 : 1;
  if (mode !== '--run') { say('usage: hosted-lovable-kiosk.mjs --bind | --run | --require'); return 2; }
  const dir = path.join(env.WSF_RESULT_DIR, 'lovable-kiosk');
  fs.mkdirSync(dir, { recursive: true });
  const rows = { 'host-build': { status: verdict.status, seen: verdict.reason } };
  let journey = { rows: {}, productDocs: [] };
  let browser = null;
  let doc = null;
  try {
    if (verdict.status !== 'PASS') return 1;
    const { createFixtureKit } = await import('./journeys/fixture-kit.mjs');
    let sdk;
    try { const raw = JSON.parse(fs.readFileSync(env.WSF_SDK_CONFIG_FILE, 'utf8')); sdk = raw?.result?.sdkConfig ?? raw?.sdkConfig ?? raw?.result ?? raw; } catch { sdk = null; }
    if (sdk?.projectId !== PROJECT_ID || typeof sdk?.apiKey !== 'string' || !env.WSF_GOOGLE_ACCESS_TOKEN || !env.WSF_CLEANUP_MANIFEST) throw new Error('the staging fixture inputs are missing');
    const runTag = `e5c-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const fixtures = createFixtureKit({ projectId: PROJECT_ID, apiKey: sdk.apiKey, token: env.WSF_GOOGLE_ACCESS_TOKEN, runTag, cleanupManifest: env.WSF_CLEANUP_MANIFEST });
    say(`LOVABLE_RUN_TAG=${runTag}`);
    const { chromium } = createRequire(path.resolve('apps/westayfit/package.json'))('@playwright/test');
    browser = await chromium.launch({ env: browserEnv(process.env) });
    journey = await runJourney({ browser, fixtures, base: b.base });
  } catch (e) {
    rows['fixture-provenance'] ??= { status: 'FAIL', seen: `stopped before the journey: ${short(e)}` };
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (journey.productDocs.length) {
      try {
        if (!env.WSF_CLEANUP_MANIFEST) throw new Error('no cleanup manifest');
        const total = mergeIntoManifest(env.WSF_CLEANUP_MANIFEST, journey.productDocs);
        rows['cleanup-tracking'] = { status: 'PASS', seen: `${journey.productDocs.length} product-written document(s) added; ${total} in the manifest` };
      } catch (e) { rows['cleanup-tracking'] = { status: 'FAIL', seen: `the product-written documents could not be added to the cleanup manifest: ${short(e)}` }; }
    } else if (journey.rows['fixture-provenance']) rows['cleanup-tracking'] = { status: 'PASS', seen: 'nothing product-written to add' };
    doc = runResults(verdict, journey, rows);
    fs.writeFileSync(path.join(dir, 'results.json'), `${JSON.stringify(doc, null, 2)}\n`);
    for (const r of doc.rows) say(`LOVABLE_ROW ${r.id}=${r.status}`);
  }
  return allPassed(doc) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await cli(process.argv[2], process.env);
}
