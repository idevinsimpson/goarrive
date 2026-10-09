#!/usr/bin/env node
/**
 * LOVABLE-DEVICE-QA-1 (queue #365 6078892265, release 6079513029; route (a) #394 6078737368): the accepted Web Twin
 * member journeys on the Lovable host at four viewports, run ONLY by the `lovable-device-matrix` mode of the trusted
 * staging workflow. Proof only: it builds and deploys nothing, and it never runs against any host but LOVABLE_URL or any
 * project but westayfit-staging. It is the lovable-kiosk proof's shape, and it reuses that harness's reviewed host
 * check, served-build binding, code guard, callable log and browser environment rather than restating them.
 *
 *   --bind     credential-free (the gate job): read the host's served assets, hash every one, and compare the set to
 *              REVIEWED_BUILD below. Exit 0 only on an exact match. An empty REVIEWED_BUILD (nothing reviewed yet), a
 *              missing, extra or changed asset, or an unreadable host refuses BEFORE any credential exists, and prints
 *              the observed manifest (names and sha256 only) so a reviewed commit can pin it.
 *   --run      credentialed (the lovable-device-matrix job): bind again, seed ONE run-tagged joinable community with the
 *              EXISTING kit (journeys/fixture-kit.mjs), then at each viewport drive one synthetic visitor through the
 *              product: the signed-out landing and the display, the invite link, sign-up, the honest verification send
 *              state, the profile, the join, the camera screen and its manual fallback (cancelled), Progress and You.
 *              Every browser context routes every request through the kiosk harness's codeGuard. One screenshot per
 *              cell. Every cell is PASS, FAIL or BLOCKED; results are written in `finally`; exit 0 only when every row
 *              passed.
 *   --require  after blocking cleanup and the evidence scan: recompute the verdict from the written results and the
 *              cleanup and scan outcomes. Exit 0 only on every row PASS, cleanup success and scan success.
 *
 * THE VISITOR ACCOUNTS. Each viewport's visitor signs up through the product's own form with a run-specific synthetic
 * email `wsf-<runTag>-dm<viewport>-<hex>@example.com` (the cleaner's provenance pattern) and a password held in memory
 * only. Its uid exists only once the product's sign-up returns it, so it is taken from that response and written to
 * the cleanup manifest at once, together with the two documents the product may then write for it
 * (`wsfMemberProfiles/<uid>`, linked through the run-tagged `wsfMemberships/<fixture group>_<uid>`), before the next
 * step. A join answered for any other community is claimed as a linked document through that uid.
 *
 * WHAT IS NOT CLEANED, named: `wsfVerificationSends/<uid>` (three integer counters the product's verification send
 * keeps per uid; no uid field, so the cleaner cannot prove it and it is left, keyed by a deleted account) and the
 * shared per-IP `wsfPreviewRateLimits` bucket the invite preview counts against.
 *
 * Secrets: account passwords exist only in memory, never in a result, log line or file. The invite link carries the
 * fixture community's join code, so it is built in memory and never written or printed. Identities are recorded as a
 * short sha256 of the uid. Nothing here writes to the Lovable project.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import {
  LOVABLE_URL, PROJECT_ID, bindBuild, bindLines, browserEnv, callableLog, checkBase, codeGuard, hostBuildRow, idHash, servedManifest, showsNumber,
} from './hosted-lovable-kiosk.mjs';

export { LOVABLE_URL, PROJECT_ID };
/**
 * The reviewed served build for this proof: the sha256 of the entry page and asset name -> sha256 of its bytes. EMPTY
 * until a reviewed commit pins the manifest a `--bind` run printed; while empty, every run stops in the credential-free
 * gate. An observed digest is evidence for review, never self-approval.
 */
export const REVIEWED_BUILD = Object.freeze({ indexSha256: null, assets: Object.freeze({}) });

/** The four viewports of the queue, in order. */
export const VIEWPORTS = Object.freeze([
  Object.freeze({ id: 'v360', label: 'small phone 360x640', width: 360, height: 640, touch: true }),
  Object.freeze({ id: 'v390', label: 'phone 390x844', width: 390, height: 844, touch: true }),
  Object.freeze({ id: 'v820', label: 'tablet 820x1180', width: 820, height: 1180, touch: true }),
  Object.freeze({ id: 'v1440', label: 'desktop 1440x900', width: 1440, height: 900, touch: false }),
]);

/** The journey cells measured at every viewport, in the order the visitor meets them. */
export const CELLS = Object.freeze([
  ['landing', 'signed out, the landing is the product sign-in with a way to create an account, and shows no sample data'],
  ['display', 'signed out, /display for the fixture goal shows its community, its title, its seeded shared total of its target, and live confirmed totals'],
  ['invite-link', 'signed out, the invite link opens the sign-in, removes the code from the address bar and holds the join for this tab'],
  ['signup', 'the visitor creates an account through the product form and reaches the name step; the verification send state is honest (a notice exactly when the send failed)'],
  ['unverified-participation', 'still unverified, the visitor saves a profile through the product and enters the member app'],
  ['invite-join', 'the held invite previews the fixture community and the visitor joins it: one join into this community, not already a member, then the phone choice'],
  ['camera-fallback', 'MOVE opens the squat camera screen with its privacy copy; with no camera the manual fallback is offered; cancelling sends no contribution'],
  ['progress-you', 'Progress shows the first-contribution empty state; You shows the verify reminder, the fixture community as Member, and the initials avatar'],
  ['memberships', 'a second invite link joins a second fixture community, and You lists both memberships'],
].map(([id, expected]) => Object.freeze({ id, expected })));

/** Every row: the three run rows, then each cell at each viewport (`<cell>@<viewport>`). */
export const ROWS = Object.freeze([
  Object.freeze({ id: 'host-build', expected: 'the exact Lovable host serves exactly the reviewed entry page and asset digests, at bind AND for every document, script and stylesheet the browser loads; nothing else executable is loaded' }),
  Object.freeze({ id: 'fixture-provenance', expected: 'the joinable community and goal are run-tagged kit fixtures in the cleanup manifest, and every visitor account is in it before its next step' }),
  ...VIEWPORTS.flatMap((v) => CELLS.map((c) => Object.freeze({ id: `${c.id}@${v.id}`, expected: `${v.label}: ${c.expected}` }))),
  Object.freeze({ id: 'cleanup-tracking', expected: 'every visitor account and every product-written document is in the cleanup manifest before cleanup' }),
]);

/**
 * The documents the journey navigates to, probed in the credential-free bind. The code guard verifies EVERY document
 * the browser loads against the entry page's reviewed digest, which holds only if the host serves the same bytes for
 * every path and every request (a single-page shell). The Web Twin is a TanStack Start app, so whether `/` is stable
 * between requests and whether a deep link is the same shell is a fact of the served host that source cannot settle.
 * The probe prints it, names and verdicts only, and never changes the bind verdict. Fixed placeholder ids, never a
 * fixture's.
 */
export const DOCUMENT_PROBES = Object.freeze([
  ['the entry page, fetched again', '/'],
  ['a /display/ deep link', '/display/wsfDocumentProbe'],
  ['the entry page with an invite query', '/?join=wsfDocumentProbe0000&goal=wsfDocumentProbe'],
]);
export async function documentProbe(fetchImpl, base, indexSha256) {
  const lines = [];
  for (const [label, p] of DOCUMENT_PROBES) {
    try {
      const res = await fetchImpl(`${base}${p}`, { redirect: 'error', headers: { 'user-agent': 'wsf-lovable-device-bind' } });
      if (!res.ok) { lines.push(`LOVABLE_DOCUMENT_PROBE ${label}: HTTP ${res.status}`); continue; }
      const same = crypto.createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex') === indexSha256;
      lines.push(`LOVABLE_DOCUMENT_PROBE ${label}: ${same ? 'the same bytes as the entry page' : 'DIFFERENT bytes from the entry page (the code guard would refuse this document)'}`);
    } catch (e) { lines.push(`LOVABLE_DOCUMENT_PROBE ${label}: unreadable (${short(e)})`); }
  }
  return lines;
}

const short = (e) => String(e?.message || e).split('\n')[0].replace(/[?&][A-Za-z]+=[^&\s"']+/g, '?…').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>').slice(0, 200);

/** The results document: every row, in order, with its status, what was seen and its screenshots (relative paths). */
export function results(rows, extra = {}) {
  const out = ROWS.map(({ id, expected }) => {
    const r = rows[id] ?? { status: 'BLOCKED', seen: 'not reached' };
    const shots = (r.shots ?? []).filter((x) => typeof x === 'string' && /^shots\/[A-Za-z0-9_.-]+\.png$/.test(x));
    return { id, expected, status: r.status, seen: short(r.seen ?? ''), ...(shots.length ? { shots } : {}) };
  });
  return { schemaVersion: 1, host: LOVABLE_URL, project: PROJECT_ID, viewports: VIEWPORTS.map(({ id, width, height }) => ({ id, width, height })), rows: out, ...extra };
}
export const allPassed = (doc) => Array.isArray(doc?.rows) && doc.rows.length === ROWS.length && doc.rows.every((r) => r.status === 'PASS');

/** The matrix view a reader scans: one line per cell, viewports across. */
export function matrixLines(doc) {
  const rows = new Map((doc?.rows ?? []).map((r) => [r.id, r.status]));
  return CELLS.map((c) => `LOVABLE_DEVICE_CELL ${c.id}: ${VIEWPORTS.map((v) => `${v.id}=${rows.get(`${c.id}@${v.id}`) ?? 'BLOCKED'}`).join(' ')}`);
}

/** The verdict after cleanup and the scan: PASS only when every row passed and both outcomes are success. */
export function requireVerdict(doc, { cleanup, scan }) {
  const lines = [];
  const rows = Array.isArray(doc?.rows) ? doc.rows : [];
  for (const r of rows) lines.push(`LOVABLE_DEVICE_ROW ${r.id}=${r.status}`);
  lines.push(...matrixLines(doc));
  const n = (s) => rows.filter((r) => r.status === s).length;
  lines.push(`LOVABLE_DEVICE_ROWS=${n('PASS')} PASS, ${n('FAIL')} FAIL, ${n('BLOCKED')} BLOCKED`);
  lines.push(`LOVABLE_DEVICE_CLEANUP=${cleanup || 'unknown'}`, `LOVABLE_DEVICE_EVIDENCE_SCAN=${scan || 'unknown'}`);
  const ok = allPassed(doc) && cleanup === 'success' && scan === 'success';
  lines.push(`LOVABLE_DEVICE_MATRIX=${ok ? 'PASS' : rows.length && n('FAIL') === 0 && n('BLOCKED') > 0 ? 'BLOCKED' : 'FAIL'}`);
  return { ok, lines };
}

/** The run-specific synthetic email for a viewport's visitor: the cleaner's provenance pattern, wsf-<runTag>-…@example.com. */
export function visitorEmail(runTag, viewportId, hex = crypto.randomBytes(2).toString('hex')) {
  return `wsf-${runTag}-dm${viewportId}-${hex}@example.com`;
}

/**
 * Add the visitor accounts and the documents the product writes for them to the kit's cleanup manifest, by union, so a
 * repeated call is harmless. Users must be uids; documents must carry the run tag, except the one shape the cleaner
 * admits through a run-tagged membership (`wsfMemberProfiles/<uid>` of a listed user); a linked entry must name a
 * listed uid. Anything else refuses the whole merge, so a bad entry can never reach the cleaner.
 */
export function mergeExtras(file, { users = [], docs = [], linked = [] }) {
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  const allUsers = new Set([...(m.users ?? []), ...users]);
  const okUid = (u) => typeof u === 'string' && /^[A-Za-z0-9]{6,128}$/.test(u);
  const okDoc = (d) => typeof d === 'string' && !d.includes('..') && !d.startsWith('/') && (d.includes(m.runTag) || (/^wsfMemberProfiles\/([A-Za-z0-9]{6,128})$/.test(d) && allUsers.has(d.split('/')[1])));
  const bad = [...users.filter((u) => !okUid(u)), ...docs.filter((d) => !okDoc(d)),
    ...linked.filter((l) => !(typeof l?.path === 'string' && /^wsfMemberships\/[^/]+$/.test(l.path) && okUid(l.via) && allUsers.has(l.via)))];
  if (bad.length) throw new Error(`refusing ${bad.length} cleanup entr${bad.length === 1 ? 'y' : 'ies'} without this run's provenance`);
  m.users = [...allUsers];
  m.docs = [...new Set([...(m.docs ?? []), ...docs])];
  const have = new Set((m.linkedDocs ?? []).map((l) => l.path));
  m.linkedDocs = [...(m.linkedDocs ?? []), ...linked.filter((l) => !have.has(l.path) && !m.docs.includes(l.path))];
  fs.writeFileSync(file, `${JSON.stringify(m, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return { users: m.users.length, docs: m.docs.length, linked: m.linkedDocs.length };
}

// ---- the browser journey ----------------------------------------------------------------------
// Selectors, routes and copy are the connected Lovable app's own, read from the Lovable project at commit
// 397c3b600ee57b9074fc45b61a77286da14de08a (src/wsf/member-entry-screen.tsx, kiosk/connected-context.tsx,
// kiosk/connected-join.tsx, display/public-display-view.tsx, demo/move.tsx, camera-count.tsx, camera-flow.ts,
// screens/progress.tsx, screens/you.tsx, verify-notice-view.tsx, demo/shell.tsx, demo/tour.tsx). The served build is
// whatever REVIEWED_BUILD pins; a pinned build whose screens moved fails its cells by name.
export const SEL = Object.freeze({
  signIn: '[data-entry-step="signIn"]',
  profileSetup: '[data-entry-step="profileSetup"]',
  verifySendNotice: '[data-testid="profile-verify-notice"]',
  display: 'main.public-display[data-display]',
  displayEyebrow: 'main.public-display p.eyebrow',
  displayTitle: 'main.public-display h1',
  displayFreshness: '[data-testid="display-freshness"]',
  joinCard: '[data-connected-join]',
  movePhone: '[data-testid="join-move-phone"]',
  camScreen: '.cam-screen[aria-label="Squat camera counter"]',
  camNote: '.cam-screen p.cam-note',
  camPanel: '.cam-screen .cam-panel[role="alert"]',
  sheet: 'section[role="dialog"][aria-labelledby="surface-title"]',
  nav: 'nav.bottom-nav',
  tab: (t) => `nav.bottom-nav button[data-tab="${t}"]`,
  panel: (t) => `section[aria-label="${t}"]`,
  progressEmpty: 'section.progress-empty[data-state="first-eligible"]',
  verifyNotice: 'aside[data-testid="verify-notice"]',
  belongingTitle: '#belonging-title',
  belongingBand: 'section.belonging-band',
  portraitInitials: '[data-testid="you-portrait"] .avatar',
  memberships: '[data-testid="you-memberships"] li',
  tourCard: '.tour-card',
});
export const COPY = Object.freeze({
  welcome: 'Welcome back',
  toSignUp: 'New here? Create an account',
  createTitle: 'Create your account',
  createSubmit: 'Create account',
  stepUnverified: 'Step 2 of 2',
  sendFailed: 'We couldn’t send your verification email yet',
  nameLabel: 'Your name',
  nameSubmit: 'Continue',
  live: 'Live · confirmed totals',
  camNote: 'Camera estimate on this device · nothing is recorded or sent',
  noCamera: 'Camera isn’t available',
  manual: 'Enter reps manually',
  manualSheet: 'How many squats?',
  progressEmpty: 'Your first contribution will appear here',
  verifyReminder: 'Verify your email',
  member: 'Member',
});
/** The visitor's display name, and the initials the product derives from it (first letter of the first and last word). */
export const VISITOR_NAME = 'Device Visitor';
export const VISITOR_INITIALS = 'DV';
const T = { boot: 45_000, step: 30_000, settle: 20_000 };

const clean = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
async function shown(page, sel) {
  const l = page.locator(sel);
  try { return (await l.count()) > 0 && (await l.first().isVisible()); } catch { return false; }
}
/** The element's text, or '' at once when it is absent (innerText alone would wait out the action timeout). */
async function textOf(page, sel) {
  const l = page.locator(sel);
  try { return (await l.count()) ? clean(await l.first().innerText()) : ''; } catch { return ''; }
}
async function attrOf(page, sel, name) {
  const l = page.locator(sel);
  try { return (await l.count()) ? await l.first().getAttribute(name) : null; } catch { return null; }
}
async function waitShown(page, sel, timeout = T.step) {
  await page.locator(sel).first().waitFor({ state: 'visible', timeout });
}
const button = (page, name) => page.getByRole('button', { name, exact: true }).first();
/** The first-run tour opens over Home for a new member; its own Skip (or Escape) closes it so tab clicks reach the product. */
async function dismissTour(page) {
  if (await shown(page, SEL.tourCard)) {
    const skip = page.getByRole('button', { name: 'Skip tour', exact: true });
    if ((await skip.count()) > 0) await skip.first().click(); else await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
}
/** A callable's settled exchange: the latest request with a decoded response, or null within `ms`. */
async function settled(page, log, name, ms = T.settle) {
  for (let waited = 0; waited <= ms; waited += 500) {
    const e = log.last(name);
    if (e) return e;
    await page.waitForTimeout(500);
  }
  return null;
}
const SIGNUP_PATH = '/v1/accounts:signUp';

/**
 * The matrix. `fixtures` is the existing kit; two joinable fixture communities are made first (the kit writes nothing
 * after that), then each viewport runs one visitor in a fresh browser context. Every row it reaches is recorded; the
 * visitor's account and the documents the product may write for it are tracked from the sign-up RESPONSE, before the
 * next step. A refusal by the code guard stops the whole matrix; any other failure stops that viewport only.
 */
export async function runMatrix({ browser, fixtures, runTag, base, reviewed = REVIEWED_BUILD, shotsDir, manifest }) {
  const rows = {};
  const set = (id, status, seen, ...shots) => { rows[id] = { status, seen, shots: shots.filter(Boolean) }; };
  const extras = { users: [], docs: [], linked: [] };
  let trackingFailed = null;
  const guard = codeGuard(reviewed);
  const contexts = [];
  const track = (part) => {
    for (const k of ['users', 'docs', 'linked']) for (const v of part[k] ?? []) if (!extras[k].some((x) => JSON.stringify(x) === JSON.stringify(v))) extras[k].push(v);
    mergeExtras(manifest, part); // at once: the manifest names the account before the product writes anything for it
  };
  try {
    const one = await fixtures.joinableEvent('dm1', { target: 500, seeded: 120 });
    const two = await fixtures.joinableEvent('dm2', { target: 300, seeded: 40 });
    set('fixture-provenance', 'PASS', `${one.setupId}; ${two.setupId}; each viewport's visitor signs up through the product with this run's synthetic email and is tracked from the sign-up response`);
    for (const vp of VIEWPORTS) {
      const cell = (c, status, seen, ...shots) => set(`${c}@${vp.id}`, status, seen, ...shots);
      const shoot = async (page, c) => {
        const rel = `shots/${vp.id}-${c}.png`;
        try { await page.screenshot({ path: path.join(shotsDir, `${vp.id}-${c}.png`) }); return rel; } catch { return undefined; }
      };
      let reached = null; // the cell in progress, for the failure that stops this viewport
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, locale: 'en-US', serviceWorkers: 'block' });
      contexts.push(ctx);
      await ctx.route('**/*', guard.handle);
      try {
        const page = await ctx.newPage();
        page.setDefaultTimeout?.(T.step); // every action is bounded; the waits above name their own
        const log = callableLog(page);
        let uid = null;
        page.on('response', async (res) => {
          let u;
          try { u = new URL(res.url()); } catch { return; }
          if (u.origin !== 'https://identitytoolkit.googleapis.com' || u.pathname !== SIGNUP_PATH || res.request().method() !== 'POST') return;
          try {
            const body = await res.json();
            if (typeof body?.localId !== 'string' || !body.localId || uid) return;
            const id = body.localId;
            track({ users: [id], docs: [`wsfMemberships/${one.groupId}_${id}`, `wsfMemberships/${two.groupId}_${id}`, `wsfMemberProfiles/${id}`] });
            uid = id;
          } catch (e) { trackingFailed ??= `${vp.id}: ${short(e)}`; }
        });

        // 1. The signed-out landing.
        reached = 'landing';
        await page.goto(`${base}/`);
        guard.check();
        await waitShown(page, SEL.signIn, T.boot);
        const landingText = await textOf(page, 'body');
        const toSignUp = await shown(page, `button:has-text("${COPY.toSignUp}")`);
        const landingOk = (await textOf(page, `${SEL.signIn} h1`)) === COPY.welcome && toSignUp && !/sample data/i.test(landingText);
        cell('landing', landingOk ? 'PASS' : 'FAIL', `sign-in heading ${(await textOf(page, `${SEL.signIn} h1`)) || 'absent'}; create-account entry ${toSignUp ? 'shown' : 'absent'}; sample data ${/sample data/i.test(landingText) ? 'SHOWN' : 'absent'}`, await shoot(page, 'landing'));

        // 2. The signed-out display of the first fixture goal.
        reached = 'display';
        await page.goto(`${base}/display/${one.goalId}`);
        guard.check();
        for (let waited = 0; waited < T.step; waited += 1000) {
          if (['live', 'stale', 'notAuthorized', 'notConnected'].includes(await attrOf(page, SEL.display, 'data-display'))) break;
          await page.waitForTimeout(1000);
        }
        const state = await attrOf(page, SEL.display, 'data-display');
        const numbers = await textOf(page, 'main.public-display');
        const dispOk = state === 'live' && (await textOf(page, SEL.displayTitle)) === one.goalTitle && (await textOf(page, SEL.displayEyebrow)) === one.communityName
          && showsNumber(numbers, one.seeded) && numbers.includes(`/ ${one.target.toLocaleString('en-US')} confirmed`) && (await textOf(page, SEL.displayFreshness)) === COPY.live;
        cell('display', dispOk ? 'PASS' : 'FAIL', `display state ${state}; title ${(await textOf(page, SEL.displayTitle)) === one.goalTitle ? 'the fixture goal' : 'other'}; community ${(await textOf(page, SEL.displayEyebrow)) === one.communityName ? 'the fixture community' : 'other'}; total ${showsNumber(numbers, one.seeded) ? `the seeded ${one.seeded}` : 'not the seeded total'} of ${one.target}; freshness ${(await textOf(page, SEL.displayFreshness)) || 'absent'}`, await shoot(page, 'display'));

        // 3. The invite link, signed out: the code leaves the address bar and is held for this tab only.
        reached = 'invite-link';
        await page.goto(`${base}/?join=${encodeURIComponent(one.joinCode)}&goal=${encodeURIComponent(one.goalId)}`);
        guard.check();
        await waitShown(page, SEL.signIn, T.boot);
        await page.waitForTimeout(500);
        const stripped = !new URL(page.url()).searchParams.has('join');
        const held = await page.evaluate(([c, g]) => sessionStorage.getItem('wsf.pendingJoinCode') === c && sessionStorage.getItem('wsf.pendingJoinGoal') === g, [one.joinCode, one.goalId]);
        cell('invite-link', stripped && held ? 'PASS' : 'FAIL', `code ${stripped ? 'removed from' : 'LEFT IN'} the address bar; join ${held ? 'held' : 'not held'} for this tab`, await shoot(page, 'invite-link'));

        // 4. Sign-up through the product form; the account is tracked from the product's own response.
        reached = 'signup';
        await page.getByRole('button', { name: COPY.toSignUp }).first().click();
        await page.getByRole('heading', { name: COPY.createTitle }).first().waitFor({ state: 'visible', timeout: T.step });
        const email = visitorEmail(runTag, vp.id);
        const password = `Wsf!${crypto.randomBytes(18).toString('base64url')}`;
        await page.getByLabel('Email', { exact: true }).first().fill(email);
        await page.getByLabel('Password', { exact: true }).first().fill(password);
        await button(page, COPY.createSubmit).click();
        for (let waited = 0; !uid && waited < T.step; waited += 500) await page.waitForTimeout(500);
        if (!uid) {
          trackingFailed ??= `${vp.id}: the sign-up response named no account before the next step`;
          throw new Error('the product\'s sign-up returned no account');
        }
        await waitShown(page, SEL.profileSetup, T.step);
        const send = await settled(page, log, 'wsfSendVerificationEmail');
        const sentOk = send?.result?.sent === true;
        let notice = await shown(page, SEL.verifySendNotice);
        for (let waited = 0; !sentOk && !notice && waited < T.settle; waited += 500) { await page.waitForTimeout(500); notice = await shown(page, SEL.verifySendNotice); }
        const noticeText = notice ? await textOf(page, SEL.verifySendNotice) : '';
        const step = await textOf(page, SEL.profileSetup);
        const honest = send !== null && (sentOk ? !notice : notice && noticeText.startsWith(COPY.sendFailed));
        cell('signup', honest && step.includes(COPY.stepUnverified) ? 'PASS' : 'FAIL',
          `account ${idHash(uid)} created and tracked; verification send ${send === null ? 'not seen' : sentOk ? 'sent' : `refused (${send.error ?? 'no result'})`}; notice ${notice ? 'shown' : 'absent'}; name step ${step.includes(COPY.stepUnverified) ? COPY.stepUnverified : 'without the unverified step count'}`, await shoot(page, 'signup'));

        // 5. Still unverified: the profile save, then the member app.
        reached = 'unverified-participation';
        await page.getByLabel(COPY.nameLabel, { exact: true }).first().fill(VISITOR_NAME);
        await button(page, COPY.nameSubmit).click();
        const save = await settled(page, log, 'wsfSaveProfile', T.step);
        if (save?.error) {
          const backend = save.error === 'FAILED_PRECONDITION';
          cell('unverified-participation', backend ? 'BLOCKED' : 'FAIL', `wsfSaveProfile answered ${save.error}${backend ? ': the served backend refuses an unverified profile save' : ''}`, await shoot(page, 'unverified-participation'));
          throw Object.assign(new Error(`the profile save was refused (${save.error})`), { blocked: backend });
        }
        await waitShown(page, `${SEL.joinCard}, ${SEL.nav}`, T.boot);
        cell('unverified-participation', save ? 'PASS' : 'FAIL', `wsfSaveProfile ${save ? 'answered without error' : 'not seen'} while unverified; the member app opened`, await shoot(page, 'unverified-participation'));

        // 6. The held invite: preview, the deliberate Join, then the phone choice.
        reached = 'invite-join';
        await page.locator(`${SEL.joinCard}[data-connected-join="preview"]`).first().waitFor({ state: 'visible', timeout: T.step });
        const preview = await settled(page, log, 'wsfPreviewCommunity');
        const previewText = await textOf(page, SEL.joinCard);
        await dismissTour(page); // the tour can open over the join card
        await page.locator(SEL.joinCard).getByRole('button', { name: 'Join', exact: true }).first().click();
        const joined = await settled(page, log, 'wsfJoinCommunity', T.step);
        const groupId = joined?.result?.groupId;
        if (typeof groupId === 'string' && groupId && groupId !== one.groupId) track({ linked: [{ path: `wsfMemberships/${groupId}_${uid}`, via: uid }] });
        const phone = await page.locator(SEL.movePhone).first().waitFor({ state: 'visible', timeout: T.step }).then(() => true, () => false);
        cell('invite-join', previewText.includes(`Join ${one.communityName}?`) && !preview?.error && groupId === one.groupId && joined.result.alreadyMember === false && phone ? 'PASS' : 'FAIL',
          `preview ${previewText.includes(`Join ${one.communityName}?`) ? 'names the fixture community' : 'does not name it'}; join ${groupId === one.groupId ? 'into this community' : joined?.error ? `refused (${joined.error})` : 'not into this community'}, alreadyMember=${joined?.result?.alreadyMember}; phone choice ${phone ? 'shown' : 'absent'}`, await shoot(page, 'invite-join'));

        // 7. MOVE on the phone: the squat camera screen, its privacy copy, the no-camera fallback, then cancel.
        reached = 'camera-fallback';
        await dismissTour(page);
        await page.locator(SEL.movePhone).first().click();
        await waitShown(page, SEL.camScreen, T.step);
        const note = await textOf(page, SEL.camNote);
        const fallback = await page.locator(SEL.camPanel).first().waitFor({ state: 'visible', timeout: T.settle }).then(() => true, () => false);
        const panel = fallback ? await textOf(page, SEL.camPanel) : '';
        const camShot = await shoot(page, 'camera-fallback');
        let manualSheet = false;
        if (fallback && panel.includes(COPY.noCamera)) {
          await button(page, COPY.manual).click();
          manualSheet = await page.locator(SEL.sheet).filter({ hasText: COPY.manualSheet }).first().waitFor({ state: 'visible', timeout: T.step }).then(() => true, () => false);
        }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1500);
        const closed = !(await shown(page, SEL.sheet)) && !(await shown(page, SEL.camScreen));
        cell('camera-fallback', note === COPY.camNote && panel.includes(COPY.noCamera) && manualSheet && closed && log.sent('wsfContribute') === 0 ? 'PASS' : 'FAIL',
          `privacy copy ${note === COPY.camNote ? 'exact' : 'missing or different'}; ${panel.includes(COPY.noCamera) ? 'the no-camera fallback' : fallback ? 'another camera panel' : 'no fallback panel'}; manual entry ${manualSheet ? 'opened' : 'not reached'}; cancel ${closed ? 'closed MOVE' : 'left MOVE open'}; contribution requests ${log.sent('wsfContribute')}`, camShot);

        // 8. Progress and You.
        reached = 'progress-you';
        await dismissTour(page);
        await page.locator(SEL.tab('progress')).first().click();
        const empty = await page.locator(SEL.progressEmpty).first().waitFor({ state: 'visible', timeout: T.step }).then(() => true, () => false);
        const emptyText = empty ? await textOf(page, `${SEL.progressEmpty} h2`) : '';
        const progressShot = await shoot(page, 'progress');
        await dismissTour(page);
        await page.locator(SEL.tab('you')).first().click();
        await waitShown(page, SEL.panel('You'), T.step);
        const reminder = await shown(page, SEL.verifyNotice) && (await textOf(page, SEL.verifyNotice)).includes(COPY.verifyReminder);
        const community = await textOf(page, SEL.belongingTitle);
        const role = (await textOf(page, SEL.belongingBand)).includes(COPY.member);
        const initials = await textOf(page, SEL.portraitInitials);
        const youShot = await shoot(page, 'you');
        cell('progress-you', emptyText === COPY.progressEmpty && reminder && community === one.communityName && role && initials === VISITOR_INITIALS ? 'PASS' : 'FAIL',
          `Progress ${emptyText === COPY.progressEmpty ? 'shows the first-contribution empty state' : 'without the empty state'}; You: verify reminder ${reminder ? 'shown' : 'absent'}, community ${community === one.communityName ? 'the fixture community' : 'other'}${role ? ' as Member' : ''}, initials ${initials === VISITOR_INITIALS ? 'derived from the name' : 'other'}`, progressShot, youShot);

        // 9. A second invite link in the same tab: a second community, and You lists both memberships.
        reached = 'memberships';
        await page.goto(`${base}/?join=${encodeURIComponent(two.joinCode)}&goal=${encodeURIComponent(two.goalId)}`);
        guard.check();
        await page.locator(`${SEL.joinCard}[data-connected-join="preview"]`).first().waitFor({ state: 'visible', timeout: T.boot });
        const joinsBefore = log.sent('wsfJoinCommunity');
        await dismissTour(page); // the tour can open over the join card
        await page.locator(SEL.joinCard).getByRole('button', { name: 'Join', exact: true }).first().click();
        for (let waited = 0; log.of('wsfJoinCommunity').filter((x) => x.result !== undefined).length <= joinsBefore && waited < T.step; waited += 500) await page.waitForTimeout(500);
        const second = log.last('wsfJoinCommunity');
        const g2 = second?.result?.groupId;
        if (typeof g2 === 'string' && g2 && g2 !== two.groupId) track({ linked: [{ path: `wsfMemberships/${g2}_${uid}`, via: uid }] });
        // The phone choice opens MOVE; close the camera at once, sending nothing.
        if (await page.locator(SEL.movePhone).first().waitFor({ state: 'visible', timeout: T.step }).then(() => true, () => false)) {
          await dismissTour(page);
          await page.locator(SEL.movePhone).first().click();
          await page.waitForTimeout(1500);
          await page.keyboard.press('Escape');
          await page.waitForTimeout(1500);
        }
        await dismissTour(page);
        await page.locator(SEL.tab('you')).first().click();
        await waitShown(page, SEL.panel('You'), T.step);
        const list = page.locator(SEL.memberships);
        const n = await list.count().catch(() => 0);
        const names = [];
        for (let i = 0; i < n; i += 1) names.push(clean(await list.nth(i).innerText()));
        const both = n === 2 && names.every((t) => t.includes(two.communityName)) && names.some((t) => /current/.test(t));
        cell('memberships', g2 === two.groupId && second.result.alreadyMember === false && both && log.sent('wsfContribute') === 0 ? 'PASS' : 'FAIL',
          `second join ${g2 === two.groupId ? 'into the second community' : second?.error ? `refused (${second.error})` : 'not into the second community'}; You lists ${n} membership(s)${both ? ', one current' : ''}; contribution requests ${log.sent('wsfContribute')}`, await shoot(page, 'memberships'));
        reached = null;
      } catch (e) {
        if (guard.summary().violations.length) throw e; // unreviewed code: nothing more is typed anywhere
        const at = CELLS.findIndex((c) => c.id === reached);
        for (const c of CELLS.slice(Math.max(at, 0))) {
          const id = `${c.id}@${vp.id}`;
          if (rows[id]) continue;
          rows[id] = { status: e.blocked ? 'BLOCKED' : 'FAIL', seen: c.id === reached ? `stopped: ${short(e)}` : `not reached: ${reached} stopped this viewport` };
        }
      }
    }
  } catch (e) {
    rows['fixture-provenance'] ??= { status: 'FAIL', seen: `stopped: ${short(e)}` };
    for (const v of VIEWPORTS) for (const c of CELLS) rows[`${c.id}@${v.id}`] ??= { status: 'FAIL', seen: `stopped: ${short(e)}` };
  } finally {
    await Promise.all(contexts.map((c) => c.close().catch(() => {})));
  }
  return { rows, extras, trackingFailed, served: guard.summary() };
}

// ---- CLI ----------------------------------------------------------------------------------------
/** The real browser: the candidate's pinned Playwright, launched with no cloud or workflow credential in its environment. */
async function launchChromium() {
  const { chromium } = createRequire(path.resolve('apps/westayfit/package.json'))('@playwright/test');
  return chromium.launch({ env: browserEnv(process.env) });
}

/**
 * The CLI. Its exit code IS the gate: the workflow's bind steps stop the mode (before `config` mints anything, and
 * before the job authenticates) only through a non-zero `--bind`, and `--run` refuses a non-PASS bind before it
 * imports the kit or launches a browser. Exported with injectable edges so both are tested.
 */
export async function cli(mode, env, { fetchImpl = fetch, reviewed = REVIEWED_BUILD, importKit = () => import('./journeys/fixture-kit.mjs'), launch = launchChromium, say = (l) => console.log(l), journey = runMatrix } = {}) {
  if (mode === '--require') {
    let doc = null;
    try { doc = JSON.parse(fs.readFileSync(path.join(env.WSF_RESULT_DIR, 'lovable-device-matrix', 'results.json'), 'utf8')); } catch { /* no results */ }
    const v = requireVerdict(doc, { cleanup: env.WSF_CLEANUP_OUTCOME, scan: env.WSF_SCAN_OUTCOME });
    v.lines.forEach(say);
    return v.ok ? 0 : 1;
  }
  const b = checkBase(env.WSF_LOVABLE_URL);
  if (!b.ok || env.WSF_PROJECT !== PROJECT_ID) { say(`LOVABLE_BUILD=FAIL (${b.ok ? 'the project is not westayfit-staging' : b.reason})`); return 1; }
  let observed = null;
  let verdict;
  try { observed = await servedManifest(fetchImpl, b.base); verdict = bindBuild(observed, reviewed); } catch (e) { verdict = { status: 'FAIL', reason: `the served build could not be read: ${short(e)}` }; }
  bindLines(observed, verdict).forEach(say);
  if (observed) (await documentProbe(fetchImpl, b.base, observed.indexSha256)).forEach(say);
  if (mode === '--bind') return verdict.status === 'PASS' ? 0 : 1;
  if (mode !== '--run') { say('usage: hosted-lovable-device-matrix.mjs --bind | --run | --require'); return 2; }
  const dir = path.join(env.WSF_RESULT_DIR, 'lovable-device-matrix');
  fs.mkdirSync(path.join(dir, 'shots'), { recursive: true });
  const rows = { 'host-build': { status: verdict.status, seen: verdict.reason } };
  let run = { rows: {}, extras: { users: [], docs: [], linked: [] } };
  let browser = null;
  let doc = null;
  try {
    if (verdict.status !== 'PASS') return 1;
    const { createFixtureKit } = await importKit();
    let sdk;
    try { const raw = JSON.parse(fs.readFileSync(env.WSF_SDK_CONFIG_FILE, 'utf8')); sdk = raw?.result?.sdkConfig ?? raw?.sdkConfig ?? raw?.result ?? raw; } catch { sdk = null; }
    if (sdk?.projectId !== PROJECT_ID || typeof sdk?.apiKey !== 'string' || !env.WSF_GOOGLE_ACCESS_TOKEN || !env.WSF_CLEANUP_MANIFEST) throw new Error('the staging fixture inputs are missing');
    const runTag = `e5c-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const fixtures = createFixtureKit({ projectId: PROJECT_ID, apiKey: sdk.apiKey, token: env.WSF_GOOGLE_ACCESS_TOKEN, runTag, cleanupManifest: env.WSF_CLEANUP_MANIFEST });
    say(`LOVABLE_RUN_TAG=${runTag}`);
    browser = await launch();
    run = await journey({ browser, fixtures, runTag, base: b.base, reviewed, shotsDir: path.join(dir, 'shots'), manifest: env.WSF_CLEANUP_MANIFEST });
  } catch (e) {
    rows['fixture-provenance'] ??= { status: 'FAIL', seen: `stopped before the journey: ${short(e)}` };
  } finally {
    if (browser) await browser.close().catch(() => {});
    const x = run.extras ?? { users: [], docs: [], linked: [] };
    if (x.users.length || x.docs.length || x.linked.length) {
      try {
        if (!env.WSF_CLEANUP_MANIFEST) throw new Error('no cleanup manifest');
        const n = mergeExtras(env.WSF_CLEANUP_MANIFEST, x);
        rows['cleanup-tracking'] = run.trackingFailed
          ? { status: 'FAIL', seen: `a visitor was tracked late or not at all during the journey: ${run.trackingFailed}` }
          : { status: 'PASS', seen: `${x.users.length} visitor account(s), ${x.docs.length} product document(s) and ${x.linked.length} linked document(s) tracked; manifest ${n.users} users, ${n.docs} documents, ${n.linked} linked` };
      } catch (e) { rows['cleanup-tracking'] = { status: 'FAIL', seen: `the visitor accounts and their documents could not be added to the cleanup manifest: ${short(e)}` }; }
    } else if (run.rows['fixture-provenance']) rows['cleanup-tracking'] = { status: 'PASS', seen: 'no visitor account was created, so nothing product-written to add' };
    doc = results({ ...run.rows, ...rows, 'host-build': hostBuildRow(verdict, run.served) });
    fs.writeFileSync(path.join(dir, 'results.json'), `${JSON.stringify(doc, null, 2)}\n`);
    for (const l of matrixLines(doc)) say(l);
    for (const r of doc.rows) say(`LOVABLE_DEVICE_ROW ${r.id}=${r.status}`);
  }
  return allPassed(doc) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await cli(process.argv[2], process.env);
}
