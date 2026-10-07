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
 *              fixtures with the EXISTING kit (journeys/fixture-kit.mjs) and drive the real Lovable UI. Every row is
 *              PASS, FAIL or BLOCKED; results are written in `finally`; exit 0 only when every row passed.
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
 * The reviewed served build: asset name -> sha256 of its bytes. EMPTY until a reviewed commit pins the manifest a
 * `--bind` run printed; while empty, every run stops in the credential-free gate.
 */
export const REVIEWED_BUILD = Object.freeze({ assets: Object.freeze({}) });
/** At most this many assets are read when walking the served build. */
export const MAX_ASSETS = 150;

export const ROWS = Object.freeze([
  ['host-build', 'the exact Lovable host serves exactly the reviewed asset digests'],
  ['fixture-provenance', 'the event community, goal, Champion and visitors A and B are run-tagged kit fixtures in the cleanup manifest'],
  ['qr-join', 'visitor A, not a member, joins the event community through the kiosk QR link on the Lovable host'],
  ['queue-place', 'the visitor takes one place in the station line'],
  ['call', 'the station calls the visitor'],
  ['phone-ready', 'the visitor taps ready on the phone'],
  ['expected-turn-start', 'the station starts the expected turn'],
  ['round-60s', 'the 60-second round runs and writes nothing at timer end'],
  ['review', 'the station shows the round for review'],
  ['contribution-7', 'visitor A records exactly 7 from the phone'],
  ['operation-receipt', 'the decoded wsfContribute receipt names this goal, an attempt, 7 added and a shared total the screen shows'],
  ['own-history-shared', 'a fresh read shows A\'s own total up by exactly 7 and the receipt\'s shared total'],
  ['reopen-static', 'reopening shows no replayed receipt and sends no second contribution'],
  ['account-isolation', 'A -> B -> A in one browser: B sees none of A, A returns with the same identity and own total'],
  ['station-finish', 'station Finish leaves no previous visitor for the next one'],
  ['unverified-account', 'a genuinely unverified account joins and contributes'],
].map(([id, expected]) => Object.freeze({ id, expected })));
const STATION_BLOCK = 'the safe station backend (#587) is not accepted or served; an older station path is never driven';
export const FIXED_BLOCKED = Object.freeze({
  'queue-place': STATION_BLOCK, call: STATION_BLOCK, 'phone-ready': STATION_BLOCK, 'expected-turn-start': STATION_BLOCK,
  'round-60s': STATION_BLOCK, review: STATION_BLOCK, 'station-finish': STATION_BLOCK,
  'unverified-account': 'the existing fixture kit creates verified accounts only (#396 6043231980); verification is never faked',
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
  if (!Object.keys(want).length) return { status: 'BLOCKED', reason: 'no reviewed digest manifest is pinned yet (REVIEWED_BUILD is empty)' };
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
  return [`LOVABLE_BUILD=${verdict.status} (${verdict.reason})`, ...(observed ? Object.entries(observed.assets).map(([n, d]) => `LOVABLE_OBSERVED_ASSET ${n} ${d}`) : [])];
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

/** The receipt row from a decoded wsfContribute result. */
export function receiptVerdict(result, { goalId, amount, screenText }) {
  const rec = result && typeof result === 'object' ? (result.receipt ?? result) : {};
  const shared = rec.sharedTotal;
  const ok = rec.addedCount === amount && Number.isInteger(shared) && typeof (rec.attemptId ?? result?.attemptId) === 'string'
    && (rec.goalId === undefined || rec.goalId === goalId) && String(screenText ?? '').replace(/,/g, '').includes(String(shared));
  return { ok, shared: Number.isInteger(shared) ? shared : null, attemptId: rec.attemptId ?? result?.attemptId ?? null,
    seen: `addedCount=${rec.addedCount} sharedTotal=${shared} attempt=${(rec.attemptId ?? result?.attemptId) ? 'yes' : 'no'} goal=${rec.goalId === undefined ? 'unstated' : rec.goalId === goalId ? 'this' : 'other'}` };
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
const PHONE = { width: 390, height: 844 };
async function uidOf(page) {
  return page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith('firebase:authUser')) { try { return JSON.parse(localStorage.getItem(k)).uid || null; } catch { /* next */ } }
    }
    return null;
  });
}
async function signIn(page, account) {
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(6000);
}
function callables(page) {
  const by = {};
  page.on('response', async (r) => {
    const m = /\/(wsf[A-Za-z]+)(?:\?|$)/.exec(r.url());
    if (!m || r.request().method() !== 'POST') return;
    try { const b = await r.json(); (by[m[1]] ||= []).push(b?.result ?? null); } catch { /* not JSON */ }
  });
  return { last: (n) => (by[n] ?? []).at(-1) ?? null, count: (n) => (by[n] ?? []).length };
}
const ownTotal = (v) => (v && typeof v === 'object' ? (Number.isInteger(v.total) ? v.total : Number.isInteger(v.ownTotal) ? v.ownTotal : null) : null);

/** The journey. `fixtures` is the existing kit; every row it reaches is recorded; nothing is thrown past a row. */
export async function runJourney({ browser, fixtures, base, amount = 7 }) {
  const rows = {};
  const set = (id, ok, seen, status) => { rows[id] = { status: status ?? (ok ? 'PASS' : 'FAIL'), seen }; };
  const productDocs = [];
  const ev = await fixtures.expoEvent('lk', { attendees: 0, target: 1000, seeded: 100 });
  const a = (await fixtures.memberInTwoCommunities('lka')).member;
  const b = (await fixtures.memberInTwoCommunities('lkb')).member;
  set('fixture-provenance', true, `${ev.setupId}; visitors A and B are kit accounts outside this community`);
  const ctx = async () => browser.newContext({ viewport: PHONE, locale: 'en-US' });
  // The kiosk shows its code; the Champion approves it (kit callable, tracked); the kiosk then shows its QR.
  const kioskCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
  let joinUrl = null;
  try {
    const kiosk = await kioskCtx.newPage();
    await kiosk.goto(`${base}/kiosk/${ev.groupId}/${ev.goalId}`);
    const codeEl = kiosk.getByTestId('kiosk-pair-code');
    await codeEl.waitFor({ timeout: 30_000 });
    await fixtures.approveStation(ev, (await codeEl.innerText()).replace(/\s+/g, ''), 1);
    const qr = kiosk.getByTestId('kiosk-qr');
    await qr.waitFor({ timeout: 40_000 });
    const url = await qr.getAttribute('data-join-url');
    const u = url ? new URL(url, base) : null;
    joinUrl = u && u.origin === LOVABLE_URL && u.search.includes('join=') && url.includes(ev.goalId) ? u.href : null;
  } catch (e) { set('qr-join', false, `the kiosk did not reach a QR join link: ${short(e)}`, 'FAIL'); }
  if (!joinUrl) { rows['qr-join'] ??= { status: 'FAIL', seen: 'the QR carries no same-host join link for this goal' }; return { rows, productDocs }; }
  const pa = await ctx();
  let uidA = null;
  let ownAfter = null;
  try {
    const page = await pa.newPage();
    const calls = callables(page);
    await page.goto(joinUrl);
    await signIn(page, a);
    uidA = await uidOf(page);
    const join = page.getByRole('button', { name: 'Join', exact: true });
    if (!uidA || !(await join.count())) { set('qr-join', false, uidA ? 'no Join button for a non-member' : 'the sign-in did not complete'); return { rows, productDocs }; }
    await join.click();
    await page.waitForTimeout(5000);
    productDocs.push(`wsfMemberships/${ev.groupId}_${uidA}`);
    const phone = page.getByTestId('join-move-phone');
    set('qr-join', (await phone.count()) > 0, `joined; phone choice ${(await phone.count()) > 0 ? 'shown' : 'absent'}`);
    const ownBefore = ownTotal(calls.last('wsfMyContribution'));
    await phone.click();
    await page.getByRole('button', { name: 'Already moved' }).first().click();
    await page.locator('input[inputmode=numeric]').first().fill(String(amount));
    for (const n of ['Review', 'Continue', 'Next']) {
      const el = page.getByRole('button', { name: n, exact: true });
      if (await el.count()) { await el.first().click(); break; }
    }
    await page.getByRole('button', { name: 'Contribute' }).first().click();
    await page.locator('.together-receipt').waitFor({ timeout: 20_000 });
    const sent = calls.count('wsfContribute');
    const r = receiptVerdict(calls.last('wsfContribute'), { goalId: ev.goalId, amount, screenText: await page.locator('.together-receipt').innerText() });
    if (r.attemptId) fixtures.trackContribution(ev, { uid: uidA }, r.attemptId);
    set('contribution-7', sent === 1 && r.ok, `${sent} contribution request(s); ${r.seen}`);
    set('operation-receipt', r.ok, r.seen);
    await page.reload();
    await page.waitForTimeout(6000);
    ownAfter = ownTotal(calls.last('wsfMyContribution'));
    const pulse = calls.last('wsfGoalPulse');
    const shared = Number.isInteger(pulse?.sharedTotal) ? pulse.sharedTotal : null;
    set('own-history-shared', ownBefore !== null && ownAfter === ownBefore + amount && shared !== null && shared === r.shared,
      `own ${ownBefore} -> ${ownAfter}; shared re-read ${shared} vs receipt ${r.shared}`, ownAfter === null || shared === null ? 'BLOCKED' : undefined);
    set('reopen-static', (await page.locator('.together-receipt').count()) === 0 && calls.count('wsfContribute') === sent,
      `receipt replayed ${(await page.locator('.together-receipt').count()) > 0}; contributions sent ${calls.count('wsfContribute')}`);
    // A -> B in the same browser.
    await page.getByRole('button', { name: 'Menu' }).first().click();
    await page.getByRole('button', { name: 'Sign out' }).first().click();
    await page.waitForTimeout(3000);
    await page.goto(`${base}/`);
    await signIn(page, b);
    const uidB = await uidOf(page);
    const bClean = Boolean(uidB) && uidB !== uidA && (await page.locator('.together-receipt').count()) === 0;
    // B -> A in a fresh context.
    const pa2 = await ctx();
    try {
      const p2 = await pa2.newPage();
      const c2 = callables(p2);
      await p2.goto(`${base}/`);
      await signIn(p2, a);
      await p2.waitForTimeout(3000);
      const back = await uidOf(p2);
      const own2 = ownTotal(c2.last('wsfMyContribution'));
      set('account-isolation', bClean && back === uidA && own2 === ownAfter,
        `B distinct ${Boolean(uidB) && uidB !== uidA}; A back as ${idHash(back) === idHash(uidA) ? 'the same identity' : 'another identity'}; A own ${own2} vs ${ownAfter}`);
    } finally { await pa2.close().catch(() => {}); }
  } catch (e) {
    for (const id of ['qr-join', 'contribution-7', 'operation-receipt', 'own-history-shared', 'reopen-static', 'account-isolation']) rows[id] ??= { status: 'FAIL', seen: `stopped: ${short(e)}` };
  } finally {
    await pa.close().catch(() => {});
    await kioskCtx.close().catch(() => {});
  }
  return { rows, productDocs };
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
    browser = await chromium.launch();
    journey = await runJourney({ browser, fixtures, base: b.base });
  } catch (e) {
    rows['fixture-provenance'] ??= { status: 'FAIL', seen: `stopped before the journey: ${short(e)}` };
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (journey.productDocs.length && env.WSF_CLEANUP_MANIFEST) {
      try { say(`LOVABLE_CLEANUP_DOCS=${mergeIntoManifest(env.WSF_CLEANUP_MANIFEST, journey.productDocs)}`); } catch (e) { say(`LOVABLE_CLEANUP_MERGE=FAIL (${short(e)})`); }
    }
    const doc = results({ ...journey.rows, ...rows });
    fs.writeFileSync(path.join(dir, 'results.json'), `${JSON.stringify(doc, null, 2)}\n`);
    for (const r of doc.rows) say(`LOVABLE_ROW ${r.id}=${r.status}`);
  }
  return allPassed(results({ ...journey.rows, ...rows })) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await cli(process.argv[2], process.env);
}
