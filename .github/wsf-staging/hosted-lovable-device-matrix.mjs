#!/usr/bin/env node
/**
 * LOVABLE-DEVICE-QA-1 (queue #365 6078892265, release 6079513029; route (a) #394 6078737368): the accepted Web Twin
 * member journeys on the Lovable host at four viewports, run ONLY by the `lovable-device-matrix` mode of the trusted
 * staging workflow. Proof only: it builds and deploys nothing, and it never runs against any host but LOVABLE_URL or any
 * project but westayfit-staging. It is the lovable-kiosk proof's shape, and it reuses that harness's reviewed host
 * check, served-build binding, code guard, callable log and browser environment rather than restating them.
 *
 *   --bind     credential-free (the gate job): the kiosk harness's route-aware bind (its BIND_PROBES documents, each
 *              reduced to its template's canonical form, and every served asset hashed) compared to the shared
 *              REVIEWED_BUILD. Exit 0 only on an exact match. An empty REVIEWED_BUILD (nothing reviewed yet), a changed
 *              document, a missing, extra or changed asset, a document reference the code guard would refuse, or an
 *              unreadable host refuses BEFORE any credential exists, and prints the observed manifest (templates, names
 *              and sha256 only) so a reviewed commit can pin it.
 *   --run      credentialed (the lovable-device-matrix job): bind again, seed TWO run-tagged joinable communities with the
 *              EXISTING kit (journeys/fixture-kit.mjs), then at each viewport drive one synthetic visitor through the
 *              product: the signed-out landing and the display, the invite link, sign-up, the honest verification send
 *              state, the profile, the join, the camera screen and its manual fallback (cancelled), Progress and You.
 *              Every browser context routes its requests through the kiosk harness's codeGuard (Playwright routes all
 *              but a WebSocket handshake and the redirect hops of a continued request, which carry data). One screenshot per
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
  LOVABLE_URL, PROJECT_ID, REVIEWED_BUILD, bindBuild, bindLines, browserEnv, callableLog, checkBase, codeGuard, hostBuildRow, idHash, seenLine, servedManifest, showsNumber,
} from './hosted-lovable-kiosk.mjs';

/**
 * The reviewed served build is the kiosk harness's (LOVABLE-REVIEWED-BUILD-1): one pin of the one Lovable build both
 * proofs drive, so a later publish needs only one new value. Its route templates cover this matrix's documents (`/`,
 * `/` with an invite query, `/display/<goal>`).
 */
export { LOVABLE_URL, PROJECT_ID, REVIEWED_BUILD };

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
  ['memberships', 'a second invite link makes exactly one join, into the second fixture community; Home then shows that community\'s goal; the app\'s own membership read holds both fixture communities; You lists exactly two memberships, exactly one current'],
].map(([id, expected]) => Object.freeze({ id, expected })));

/** Every row: the three run rows, then each cell at each viewport (`<cell>@<viewport>`). */
export const ROWS = Object.freeze([
  Object.freeze({ id: 'host-build', expected: 'the exact Lovable host serves exactly the reviewed canonical document of every route template and every reviewed asset digest, at bind AND for every document, script and stylesheet the browser loads; the host\'s own scripts are blocked; nothing else executable is loaded' }),
  Object.freeze({ id: 'fixture-provenance', expected: 'the joinable community and goal are run-tagged kit fixtures in the cleanup manifest, and every visitor account is in it before its next step' }),
  ...VIEWPORTS.flatMap((v) => CELLS.map((c) => Object.freeze({ id: `${c.id}@${v.id}`, expected: `${v.label}: ${c.expected}` }))),
  Object.freeze({ id: 'cleanup-tracking', expected: 'every visitor account and every product-written document is in the cleanup manifest before cleanup' }),
]);

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
  for (const r of rows) lines.push(`LOVABLE_DEVICE_ROW ${r.id}=${r.status}`, seenLine('LOVABLE_DEVICE_SEEN', r.id, r.seen));
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
// whatever REVIEWED_BUILD pins; a pinned build whose screens moved fails its cells by name. The display and the name
// step were re-read from the served build db3fd2f2 (LOVABLE-MATRIX-ALIGN-1, #365 6096204665):
// src/wsf/display/public-display-view.tsx:40-52, public-display.ts:42-50 (en-GB numbers), member-entry-screen.tsx:83-88,
// and src/styles.css:56, which sets `.eyebrow` to text-transform: uppercase.
export const SEL = Object.freeze({
  signIn: '[data-entry-step="signIn"]',
  profileSetup: '[data-entry-step="profileSetup"]',
  verifySendNotice: '[data-testid="profile-verify-notice"]',
  display: 'main.public-display[data-display]',
  displayCommunity: 'main.public-display p.public-display-community',
  displayTitle: 'main.public-display h1',
  displayTotalNumber: '[data-testid="display-total"] strong',
  displayTotalOf: '[data-testid="display-total"] span',
  displayFreshness: '[data-testid="display-freshness"]',
  displayFreshLines: '[data-testid="display-freshness"] p',
  profileStep: '[data-entry-step="profileSetup"] p.eyebrow',
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
/** The display's second freshness line while live: "updated N s ago" (public-display-view.tsx:49). */
export const FRESH_UPDATED_RE = /^updated \d+ s ago$/;
/** The unit the kit's joinableEvent goals carry (journeys/fixture-kit.mjs, held by a test). */
export const FIXTURE_UNIT = 'squats';
/** A number as the display formats it: Intl en-GB, at most 3 fraction digits (public-display.ts:44). */
export const displayNumber = (n) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 3 }).format(n);
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
/**
 * A leaf element's exact copy: its text content with white space collapsed, or '' at once when it is absent. Unlike
 * innerText it ignores CSS text-transform (the served `.eyebrow` is uppercase, so innerText reads "STEP 2 OF 2").
 * Only for an element compared to exact copy: a container's text content runs its block children together.
 */
async function exactText(page, sel, index = 0) {
  const l = page.locator(sel);
  try { return (await l.count()) > index ? clean(await l.nth(index).textContent()) : ''; } catch { return ''; }
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
/** The `index`-th exchange of a callable once it has its response (null within `ms`): the request a given tap sent,
 *  never an earlier or later one. */
async function nth(page, log, name, index, ms = T.settle) {
  for (let waited = 0; waited <= ms; waited += 500) {
    const e = log.of(name)[index];
    if (e && e.result !== undefined) return e;
    await page.waitForTimeout(500);
  }
  return null;
}
const SIGNUP_PATH = '/v1/accounts:signUp';
const quoted = (t) => (t ? `"${t.length > 40 ? `${t.slice(0, 39)}…` : t}"` : 'absent');

/**
 * The signed-out display's verdict against the served build db3fd2f2, from what was read: the state, the title and
 * the seeded number in the page text (as before), the community line, the total as the product formats it (`strong`
 * the seeded total, `span` exactly "of {target} {unit}"), and exactly two freshness lines, "Live · confirmed totals"
 * then "updated N s ago". The seen text names what was read wherever it differs.
 */
export function displayVerdict(read, fx) {
  const want = { total: displayNumber(fx.seeded), of: `of ${displayNumber(fx.target)} ${FIXTURE_UNIT}` };
  const fresh = Array.isArray(read.fresh) ? read.fresh : [];
  const freshOk = fresh.length === 2 && fresh[0] === COPY.live && FRESH_UPDATED_RE.test(fresh[1]);
  const ok = read.state === 'live' && read.title === fx.goalTitle && showsNumber(read.page, fx.seeded)
    && read.community === fx.communityName && read.total === want.total && read.of === want.of && freshOk;
  const seen = [
    `display state ${read.state}`,
    `title ${read.title === fx.goalTitle ? 'the fixture goal' : quoted(read.title)}`,
    `community ${read.community === fx.communityName ? 'the fixture community' : quoted(read.community)}`,
    `total ${read.total === want.total ? `the seeded ${want.total}` : quoted(read.total)} ${read.of === want.of ? want.of : quoted(read.of)}${showsNumber(read.page, fx.seeded) ? '' : ' (not in the page text)'}`,
    `freshness ${fresh.length ? fresh.map((f) => quoted(f)).join(' / ') : 'absent'}`,
  ].join('; ');
  return { ok, seen };
}

/** The name step's count, read as text (never innerText): exactly "Step 2 of 2" for an unverified visitor. */
export const stepVerdict = (text) => text === COPY.stepUnverified;

/**
 * The matrix. `fixtures` is the existing kit; two joinable fixture communities are made first (the kit writes nothing
 * after that), then each viewport runs one visitor in a fresh browser context. Every row it reaches is recorded; the
 * visitor's account and the documents the product may write for it are tracked from the sign-up RESPONSE, before the
 * next step. A refusal by the code guard stops the whole matrix; any other failure stops that viewport only.
 */
export async function runMatrix({ browser, fixtures, runTag, base, reviewed = REVIEWED_BUILD, shotsDir, manifest, lookup = null }) {
  const rows = {};
  const set = (id, status, seen, ...shots) => { rows[id] = { status, seen, shots: shots.filter(Boolean) }; };
  const extras = { users: [], docs: [], linked: [] };
  let trackingFailed = null;
  const guard = codeGuard(reviewed);
  const contexts = [];
  /** Track at once: the manifest names the account before the product writes anything for it. A refused write is
   *  recorded as a tracking failure (cleanup-tracking then FAILs) and stops the viewport. */
  const track = (part, where) => {
    for (const k of ['users', 'docs', 'linked']) for (const v of part[k] ?? []) if (!extras[k].some((x) => JSON.stringify(x) === JSON.stringify(v))) extras[k].push(v);
    try { mergeExtras(manifest, part); } catch (e) { trackingFailed ??= `${where}: the cleanup manifest refused the entry (${short(e)})`; throw e; }
  };
  const visitorDocs = (id) => [`wsfMemberships/${one.groupId}_${id}`, `wsfMemberships/${two.groupId}_${id}`, `wsfMemberProfiles/${id}`];
  let one = null;
  let two = null;
  try {
    one = await fixtures.joinableEvent('dm1', { target: 500, seeded: 120 });
    two = await fixtures.joinableEvent('dm2', { target: 300, seeded: 40 });
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
            track({ users: [id], docs: visitorDocs(id) }, vp.id);
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
        const heading = await exactText(page, `${SEL.signIn} h1`);
        const landingOk = heading === COPY.welcome && toSignUp && !/sample data/i.test(landingText);
        cell('landing', landingOk ? 'PASS' : 'FAIL', `sign-in heading ${heading || 'absent'}; create-account entry ${toSignUp ? 'shown' : 'absent'}; sample data ${/sample data/i.test(landingText) ? 'SHOWN' : 'absent'}`, await shoot(page, 'landing'));

        // 2. The signed-out display of the first fixture goal.
        reached = 'display';
        await page.goto(`${base}/display/${one.goalId}`);
        guard.check();
        for (let waited = 0; waited < T.step; waited += 1000) {
          if (['live', 'stale', 'notAuthorized', 'notConnected'].includes(await attrOf(page, SEL.display, 'data-display'))) break;
          await page.waitForTimeout(1000);
        }
        const freshCount = await page.locator(SEL.displayFreshLines).count().catch(() => 0);
        const fresh = [];
        for (let i = 0; i < freshCount; i += 1) fresh.push(await exactText(page, SEL.displayFreshLines, i));
        const disp = displayVerdict({
          state: await attrOf(page, SEL.display, 'data-display'), page: await textOf(page, 'main.public-display'), title: await exactText(page, SEL.displayTitle),
          community: await exactText(page, SEL.displayCommunity), total: await exactText(page, SEL.displayTotalNumber), of: await exactText(page, SEL.displayTotalOf), fresh,
        }, one);
        cell('display', disp.ok ? 'PASS' : 'FAIL', disp.seen, await shoot(page, 'display'));

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
        // A lost sign-up answer: the account may exist all the same, under this run's synthetic email. Look it up and
        // track what is found; only a failed lookup leaves an account the manifest cannot name.
        let byLookup = false;
        if (!uid && lookup) {
          let found = null;
          try { found = await lookup(email); } catch (e) { trackingFailed ??= `${vp.id}: the sign-up answer was not seen and the account lookup failed (${short(e)})`; }
          if (found?.length) {
            track({ users: found, docs: found.flatMap(visitorDocs) }, vp.id);
            uid = found[0];
            byLookup = true;
          }
          if (found && !found.length) throw new Error('the product\'s sign-up created no account (none under this run\'s synthetic email)');
        }
        if (!uid) {
          trackingFailed ??= `${vp.id}: the sign-up answer was not seen and no lookup could name the account`;
          throw new Error('the product\'s sign-up returned no account');
        }
        await waitShown(page, SEL.profileSetup, T.step);
        const send = await settled(page, log, 'wsfSendVerificationEmail');
        const sentOk = send?.result?.sent === true;
        let notice = await shown(page, SEL.verifySendNotice);
        for (let waited = 0; !sentOk && !notice && waited < T.settle; waited += 500) { await page.waitForTimeout(500); notice = await shown(page, SEL.verifySendNotice); }
        const noticeText = notice ? await textOf(page, SEL.verifySendNotice) : '';
        const step = await exactText(page, SEL.profileStep);
        const honest = send !== null && (sentOk ? !notice : notice && noticeText.startsWith(COPY.sendFailed));
        cell('signup', honest && stepVerdict(step) ? 'PASS' : 'FAIL',
          `account ${idHash(uid)} created and tracked${byLookup ? ' (by lookup: the sign-up answer was not seen)' : ''}; verification send ${send === null ? 'not seen' : sentOk ? 'sent' : `refused (${send.error ?? 'no result'})`}; notice ${notice ? 'shown' : 'absent'}; name step ${stepVerdict(step) ? COPY.stepUnverified : `step count ${quoted(step)}`}`, await shoot(page, 'signup'));

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
        // "Nothing is joined until you tap Join": count the join requests before the tap, read the one THIS tap sent.
        const joinsBefore = log.sent('wsfJoinCommunity');
        await page.locator(SEL.joinCard).getByRole('button', { name: 'Join', exact: true }).first().click();
        const joined = await nth(page, log, 'wsfJoinCommunity', joinsBefore, T.step);
        await page.waitForTimeout(1000); // a second send would surface here
        const joinsAfter = log.sent('wsfJoinCommunity');
        const groupId = joined?.result?.groupId;
        if (typeof groupId === 'string' && groupId && groupId !== one.groupId) track({ linked: [{ path: `wsfMemberships/${groupId}_${uid}`, via: uid }] }, vp.id);
        const phone = await page.locator(SEL.movePhone).first().waitFor({ state: 'visible', timeout: T.step }).then(() => true, () => false);
        cell('invite-join', joinsBefore === 0 && joinsAfter === 1 && previewText.includes(`Join ${one.communityName}?`) && !preview?.error && groupId === one.groupId && joined.result.alreadyMember === false && phone ? 'PASS' : 'FAIL',
          `join requests before the tap ${joinsBefore}, after ${joinsAfter}; preview ${previewText.includes(`Join ${one.communityName}?`) ? 'names the fixture community' : 'does not name it'}; the tap's join ${groupId === one.groupId ? 'into this community' : joined?.error ? `refused (${joined.error})` : 'not into this community'}, alreadyMember=${joined?.result?.alreadyMember}; phone choice ${phone ? 'shown' : 'absent'}`, await shoot(page, 'invite-join'));

        // 7. MOVE on the phone: the squat camera screen, its privacy copy, the no-camera fallback, then cancel.
        reached = 'camera-fallback';
        await dismissTour(page);
        await page.locator(SEL.movePhone).first().click();
        await waitShown(page, SEL.camScreen, T.step);
        const note = await exactText(page, SEL.camNote);
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
        const emptyText = empty ? await exactText(page, `${SEL.progressEmpty} h2`) : '';
        const progressShot = await shoot(page, 'progress');
        await dismissTour(page);
        await page.locator(SEL.tab('you')).first().click();
        await waitShown(page, SEL.panel('You'), T.step);
        const reminder = await shown(page, SEL.verifyNotice) && (await textOf(page, SEL.verifyNotice)).includes(COPY.verifyReminder);
        const community = await exactText(page, SEL.belongingTitle);
        const role = (await textOf(page, SEL.belongingBand)).includes(COPY.member);
        const initials = await exactText(page, SEL.portraitInitials);
        const youShot = await shoot(page, 'you');
        cell('progress-you', emptyText === COPY.progressEmpty && reminder && community === one.communityName && role && initials === VISITOR_INITIALS ? 'PASS' : 'FAIL',
          `Progress ${emptyText === COPY.progressEmpty ? 'shows the first-contribution empty state' : 'without the empty state'}; You: verify reminder ${reminder ? 'shown' : 'absent'}, community ${community === one.communityName ? 'the fixture community' : 'other'}${role ? ' as Member' : ''}, initials ${initials === VISITOR_INITIALS ? 'derived from the name' : 'other'}`, progressShot, youShot);

        // 9. A second invite link in the same tab: a second community, and You lists both memberships.
        reached = 'memberships';
        await page.goto(`${base}/?join=${encodeURIComponent(two.joinCode)}&goal=${encodeURIComponent(two.goalId)}`);
        guard.check();
        await page.locator(`${SEL.joinCard}[data-connected-join="preview"]`).first().waitFor({ state: 'visible', timeout: T.boot });
        await dismissTour(page); // the tour can open over the join card
        const secondBefore = log.sent('wsfJoinCommunity');
        await page.locator(SEL.joinCard).getByRole('button', { name: 'Join', exact: true }).first().click();
        const second = await nth(page, log, 'wsfJoinCommunity', secondBefore, T.step);
        await page.waitForTimeout(1000);
        const secondAfter = log.sent('wsfJoinCommunity');
        const g2 = second?.result?.groupId;
        if (typeof g2 === 'string' && g2 && g2 !== two.groupId) track({ linked: [{ path: `wsfMemberships/${g2}_${uid}`, via: uid }] }, vp.id);
        // The phone choice opens MOVE; close the camera at once, sending nothing.
        if (await page.locator(SEL.movePhone).first().waitFor({ state: 'visible', timeout: T.step }).then(() => true, () => false)) {
          await dismissTour(page);
          await page.locator(SEL.movePhone).first().click();
          await page.waitForTimeout(1500);
          await page.keyboard.press('Escape');
          await page.waitForTimeout(1500);
        }
        await dismissTour(page);
        // The two fixture communities share the kit's name, and You renders names only, so they are told apart where
        // they differ: the server's answer to the tap, Home's goal (the second is 40 of 300, the first 120 of 500), and
        // the app's own membership read (wsfMyCommunities, by group id).
        await page.locator(SEL.tab('home')).first().click();
        await page.waitForTimeout(1000);
        const homeText = await textOf(page, SEL.panel('Home'));
        const homeIsSecond = showsNumber(homeText, two.seeded) && homeText.includes(`/ ${two.target.toLocaleString('en-US')} confirmed`);
        const mine = log.last('wsfMyCommunities')?.result?.items;
        const readIds = Array.isArray(mine) ? mine.map((x) => x?.groupId) : [];
        const readBoth = readIds.length === 2 && readIds.includes(one.groupId) && readIds.includes(two.groupId);
        await page.locator(SEL.tab('you')).first().click();
        await waitShown(page, SEL.panel('You'), T.step);
        const list = page.locator(SEL.memberships);
        const n = await list.count().catch(() => 0);
        const names = [];
        for (let i = 0; i < n; i += 1) names.push(clean(await list.nth(i).innerText()));
        const currentRows = names.filter((t) => /current/.test(t)).length;
        const listOk = n === 2 && currentRows === 1 && names.every((t) => t.includes(two.communityName));
        cell('memberships', secondBefore === 1 && secondAfter === 2 && g2 === two.groupId && second.result.alreadyMember === false && homeIsSecond && readBoth && listOk && log.sent('wsfContribute') === 0 ? 'PASS' : 'FAIL',
          `join requests before the tap ${secondBefore}, after ${secondAfter}; the tap's join ${g2 === two.groupId ? 'into the second community' : second?.error ? `refused (${second.error})` : 'not into the second community'}; Home ${homeIsSecond ? 'shows the second community\'s goal' : 'does not show the second community\'s goal'}; membership read ${readBoth ? 'holds both fixture communities' : `holds ${readIds.length} group(s)`}; You lists ${n} membership(s), ${currentRows} current; contribution requests ${log.sent('wsfContribute')}`, await shoot(page, 'memberships'));
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
/** An admin read of accounts by email (the kit's own lookup): the uids found, [] for none; never echoes a body. */
export function accountLookup(token, fetchImpl = fetch) {
  return async (email) => {
    const res = await fetchImpl(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:lookup`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ email: [email] }),
    });
    if (!res.ok) throw new Error(`the account lookup answered HTTP ${res.status}`);
    const body = await res.json();
    if (body?.users !== undefined && !Array.isArray(body.users)) throw new Error('the account lookup returned users of an unexpected type');
    return (body?.users ?? []).map((u) => u?.localId).filter((x) => typeof x === 'string' && /^[A-Za-z0-9]{6,128}$/.test(x));
  };
}

export async function cli(mode, env, { fetchImpl = fetch, lookupFetch = fetch, reviewed = REVIEWED_BUILD, importKit = () => import('./journeys/fixture-kit.mjs'), launch = launchChromium, say = (l) => console.log(l), journey = runMatrix } = {}) {
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
    run = await journey({ browser, fixtures, runTag, base: b.base, reviewed, shotsDir: path.join(dir, 'shots'), manifest: env.WSF_CLEANUP_MANIFEST, lookup: accountLookup(env.WSF_GOOGLE_ACCESS_TOKEN, lookupFetch) });
  } catch (e) {
    rows['fixture-provenance'] ??= { status: 'FAIL', seen: `stopped before the journey: ${short(e)}` };
  } finally {
    if (browser) await browser.close().catch(() => {});
    // Whatever was tracked is merged again (a union); an account the journey could not track FAILS the row whether or
    // not anything else was tracked, because the cleaner deletes only the accounts its manifest names.
    const x = run.extras ?? { users: [], docs: [], linked: [] };
    let merged = null;
    let mergeError = null;
    if (x.users.length || x.docs.length || x.linked.length) {
      try {
        if (!env.WSF_CLEANUP_MANIFEST) throw new Error('no cleanup manifest');
        merged = mergeExtras(env.WSF_CLEANUP_MANIFEST, x);
      } catch (e) { mergeError = e; }
    }
    if (mergeError) rows['cleanup-tracking'] = { status: 'FAIL', seen: `the visitor accounts and their documents could not be added to the cleanup manifest: ${short(mergeError)}` };
    else if (run.trackingFailed) rows['cleanup-tracking'] = { status: 'FAIL', seen: `an account the product created may be missing from the cleanup manifest: ${run.trackingFailed}` };
    else if (merged) rows['cleanup-tracking'] = { status: 'PASS', seen: `${x.users.length} visitor account(s), ${x.docs.length} product document(s) and ${x.linked.length} linked document(s) tracked; manifest ${merged.users} users, ${merged.docs} documents, ${merged.linked} linked` };
    else if (run.rows['fixture-provenance']) rows['cleanup-tracking'] = { status: 'PASS', seen: 'no visitor account was tracked and none went untracked, so nothing product-written to add' };
    doc = results({ ...run.rows, ...rows, 'host-build': hostBuildRow(verdict, run.served) });
    fs.writeFileSync(path.join(dir, 'results.json'), `${JSON.stringify(doc, null, 2)}\n`);
    for (const l of matrixLines(doc)) say(l);
    for (const r of doc.rows) { say(`LOVABLE_DEVICE_ROW ${r.id}=${r.status}`); say(seenLine('LOVABLE_DEVICE_SEEN', r.id, r.seen)); }
  }
  return allPassed(doc) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await cli(process.argv[2], process.env);
}
