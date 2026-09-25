#!/usr/bin/env node
/**
 * PRIVACY-POSTOP-VERIFY-1 — the per-community privacy switches, verified end
 * to end at the callable boundary, the moment the setter can be reached.
 *
 * WHY IT EXISTS. On the served build, "Show my name" / "Show my
 * contributions" do not persist: wsfSetCommunityVisibility is deployed but
 * transport-SHUT (invoker IAM check enabled), so the client never reaches it.
 * Opening the transport is an operator action (OPERATOR-HANDOFF-social-
 * staging.md, Operation 2). This harness is what runs AFTER that read-back:
 * it proves, with synthetic members, that the setter persists, that the
 * stored choice governs what other members see, and that nothing leaks to
 * anonymous readers — or it says exactly which precondition is still missing.
 *
 * FIRST, TRANSPORT — AND NOTHING IS WRITTEN WHILE THE SETTER IS SHUT. Each of
 * the three social services is probed with an unauthenticated call, which
 * writes nothing. A callable-shaped answer (UNAUTHENTICATED) means the request
 * reached the function; a bare 401/403 with no callable body means Cloud Run
 * refused it before any code ran. If the setter is SHUT every row is BLOCKED
 * and the run exits 3 without creating a single fixture.
 *
 * THE INDEX. wsfCommunityActivity needs the wsfContributions composite index.
 * The function does not catch a missing-index error, so the caller sees a
 * generic INTERNAL, which cannot be told apart from any other server error
 * from outside. An INTERNAL activity read therefore makes the rows that need
 * activity BLOCKED — never PASS, never silently FAIL — and is resolved by the
 * index's own READY read-back.
 *
 * THE SEVEN ROWS (Director #396 5840491600 / 5840669584):
 *   1 name OFF persists across a reload (the member's own re-read)
 *   2 activity OFF persists across a reload
 *   3 name OFF + activity ON: the member's movement shows, anonymously
 *   4 community A's choice does not change community B, both directions
 *   5 a non-member cannot set, list or read the community's social data
 *   6 the CURRENT choice governs what other members see, while aggregates
 *     (member count, the goal total, people moved today) still count them
 *   7 the public display reads carry no member identity
 *
 * VERDICT. PASS only when all seven pass: exit 0. Any FAIL: exit 1. No FAIL
 * but something BLOCKED: exit 3. SOCIAL_PRIVACY_READY=true is printed only on
 * a full pass; every other outcome prints false.
 *
 * TARGETS. `WSF_PRIVACY_TARGET=staging` (the workflow's social-privacy mode)
 * or `emulator` (local proof: FIRESTORE_EMULATOR_HOST,
 * FIREBASE_AUTH_EMULATOR_HOST, WSF_FUNCTIONS_EMULATOR_HOST and a demo-*
 * WSF_PRIVACY_PROJECT). Nothing else is accepted.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const SOCIAL_SERVICES = Object.freeze([
  'wsfSetCommunityVisibility',
  'wsfCommunityMembers',
  'wsfCommunityActivity',
]);

/**
 * What an UNAUTHENTICATED probe's answer says about transport.
 *   open    — a callable-protocol answer: the request reached the function
 *   shut    — 401/403 with no callable body: refused before any code ran
 *   unknown — anything else (5xx, network, a shape this file does not know)
 */
export function classifyTransport(status, bodyText) {
  let body = null;
  try { body = bodyText ? JSON.parse(bodyText) : null; } catch { body = null; }
  const callableShaped =
    body !== null && typeof body === 'object' &&
    (typeof body?.error?.status === 'string' || Object.prototype.hasOwnProperty.call(body, 'result'));
  if (callableShaped) return 'open';
  if (status === 401 || status === 403) return 'shut';
  return 'unknown';
}

/** A row's status from its sub-checks: any fail → FAIL; else any blocked → BLOCKED; else PASS. */
export function rowStatus(checks) {
  if (checks.length === 0) return 'BLOCKED';
  if (checks.some((c) => c.status === 'FAIL')) return 'FAIL';
  if (checks.some((c) => c.status === 'BLOCKED')) return 'BLOCKED';
  return 'PASS';
}

/** The run's verdict and exit code from the seven row statuses. */
export function verdict(rows) {
  const s = Object.values(rows);
  if (s.length !== 7) return { verdict: 'fail', exit: 1 };
  if (s.some((x) => x === 'FAIL')) return { verdict: 'fail', exit: 1 };
  if (s.some((x) => x !== 'PASS')) return { verdict: 'blocked', exit: 3 };
  return { verdict: 'pass', exit: 0 };
}

// Minted once, at load, in the same single-line shape as the other harnesses:
// cleanup-synthetic.test.mjs evaluates this exact line and requires the tag to
// be one run-tag.mjs owns, so the cleaner can never refuse this harness's run.
const runTag = `e5p-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;

function config(env) {
  const target = env.WSF_PRIVACY_TARGET;
  if (!target) throw new Error('WSF_PRIVACY_TARGET is required');
  if (target === 'staging') {
    if (!env.WSF_GOOGLE_ACCESS_TOKEN) throw new Error('WSF_GOOGLE_ACCESS_TOKEN is required');
    if (!env.WSF_SDK_CONFIG_FILE) throw new Error('WSF_SDK_CONFIG_FILE is required');
    if (!env.WSF_CLEANUP_MANIFEST) throw new Error('WSF_CLEANUP_MANIFEST is required');
    const raw = JSON.parse(fs.readFileSync(env.WSF_SDK_CONFIG_FILE, 'utf8'));
    const sdk = raw?.result?.sdkConfig ?? raw?.sdkConfig ?? raw?.result ?? raw;
    if (sdk?.projectId !== 'westayfit-staging' || typeof sdk?.apiKey !== 'string') {
      throw new Error('the SDK config is not the staging Web App config');
    }
    return {
      target,
      project: 'westayfit-staging',
      oauth: env.WSF_GOOGLE_ACCESS_TOKEN,
      apiKey: sdk.apiKey,
      firestore: 'https://firestore.googleapis.com/v1',
      identity: 'https://identitytoolkit.googleapis.com/v1',
      functions: 'https://us-central1-westayfit-staging.cloudfunctions.net',
      manifest: env.WSF_CLEANUP_MANIFEST,
      resultDir: env.WSF_RESULT_DIR || path.resolve('wsf-privacy-evidence'),
    };
  }
  if (target === 'emulator') {
    const project = env.WSF_PRIVACY_PROJECT || '';
    const fsHost = env.FIRESTORE_EMULATOR_HOST;
    const authHost = env.FIREBASE_AUTH_EMULATOR_HOST;
    const fnHost = env.WSF_FUNCTIONS_EMULATOR_HOST;
    if (!project.startsWith('demo-') || !fsHost || !authHost || !fnHost) {
      throw new Error('the emulator target needs a demo-* WSF_PRIVACY_PROJECT and all three emulator hosts');
    }
    return {
      target,
      project,
      oauth: 'owner',
      apiKey: 'emulator-api-key',
      firestore: `http://${fsHost}/v1`,
      identity: `http://${authHost}/identitytoolkit.googleapis.com/v1`,
      functions: `http://${fnHost}/${project}/us-central1`,
      manifest: env.WSF_CLEANUP_MANIFEST || null,
      resultDir: env.WSF_RESULT_DIR || path.resolve('wsf-privacy-evidence'),
    };
  }
  throw new Error("WSF_PRIVACY_TARGET must be 'staging' or 'emulator'");
}

async function main() {
  const cfg = config(process.env);
  process.umask(0o077);
  fs.mkdirSync(cfg.resultDir, { recursive: true, mode: 0o700 });
  const cleanup = { users: new Set(), docs: new Set() };
  const persist = () => {
    if (!cfg.manifest) return;
    fs.mkdirSync(path.dirname(cfg.manifest), { recursive: true, mode: 0o700 });
    fs.writeFileSync(cfg.manifest, JSON.stringify({
      project: cfg.project, runTag, users: [...cleanup.users], docs: [...cleanup.docs], linkedDocs: [],
    }, null, 2) + '\n', { mode: 0o600 });
  };
  const trackDoc = (p) => { cleanup.docs.add(p); persist(); };
  const trackUser = (u) => { cleanup.users.add(u); persist(); };
  persist();

  const sanitize = (v) => String(v)
    .replaceAll(cfg.apiKey, '[REDACTED_API_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/[A-Za-z0-9._%+-]+@example\.com/gi, '[SYNTHETIC_EMAIL]')
    .replace(/("joinCode"\s*:\s*)("[^"]*"|\{[^{}]*\})/gi, '$1"[REDACTED_JOIN_CODE]"')
    .slice(0, 600);

  async function rest(url, { method = 'GET', body, allow = [] } = {}) {
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.oauth}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = {}; }
    if (!res.ok && !allow.includes(res.status)) {
      throw new Error(`${method} ${res.status} ${sanitize(parsed?.error?.status || parsed?.error?.message || '')}`);
    }
    return { status: res.status, body: parsed };
  }
  const fv = (v) => (typeof v === 'string' ? { stringValue: v }
    : typeof v === 'boolean' ? { booleanValue: v }
      : Number.isInteger(v) ? { integerValue: String(v) }
        : v instanceof Date ? { timestampValue: v.toISOString() }
          : (() => { throw new Error('unsupported value'); })());
  const docUrl = (p) => `${cfg.firestore}/projects/${cfg.project}/databases/(default)/documents/${p}`;
  async function putDoc(p, record) {
    trackDoc(p);
    await rest(docUrl(p), { method: 'PATCH', body: { fields: Object.fromEntries(Object.entries(record).map(([k, v]) => [k, fv(v)])) } });
  }
  async function getDoc(p) {
    const r = await rest(docUrl(p), { allow: [404] });
    return r.status === 404 ? null : r.body?.fields ?? {};
  }
  async function createUser(label) {
    const email = `wsf-${runTag}-${label}@example.com`;
    const password = `Wsf!${crypto.randomBytes(18).toString('base64url')}`;
    const r = await rest(`${cfg.identity}/accounts:signUp?key=${encodeURIComponent(cfg.apiKey)}`, {
      method: 'POST',
      body: { targetProjectId: cfg.project, email, password, displayName: `WSF ${label}`, emailVerified: true, disabled: false, returnSecureToken: false },
    });
    const uid = r.body?.localId;
    if (typeof uid !== 'string' || !uid) throw new Error('Auth create returned no localId');
    trackUser(uid);
    return { uid, email, password, label, displayName: `WSF ${runTag} ${label}` };
  }
  const tokens = new Map();
  async function token(user) {
    if (tokens.has(user.uid)) return tokens.get(user.uid);
    const res = await fetch(`${cfg.identity}/accounts:signInWithPassword?key=${encodeURIComponent(cfg.apiKey)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: user.password, returnSecureToken: true }),
    });
    const body = await res.json().catch(() => ({}));
    if (typeof body?.idToken !== 'string') throw new Error(`sign-in failed for the ${user.label}`);
    tokens.set(user.uid, body.idToken);
    return body.idToken;
  }
  async function call(name, data, user = null) {
    const headers = { 'content-type': 'application/json' };
    if (user) headers.authorization = `Bearer ${await token(user)}`;
    const res = await fetch(`${cfg.functions}/${name}`, { method: 'POST', headers, body: JSON.stringify({ data }) });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return { http: res.status, text, result: body?.result, error: body?.error?.status ?? null };
  }

  const rows = {};
  const detail = {};
  const out = (line) => console.log(line);
  out(`PRIVACY_TARGET=${cfg.target}`);
  out(`PRIVACY_RUN_TAG=${runTag}`);

  // ---- transport, unauthenticated, no writes ----
  const transport = {};
  for (const name of SOCIAL_SERVICES) {
    const r = await call(name, {});
    transport[name] = classifyTransport(r.http, r.text);
    out(`TRANSPORT ${name.toLowerCase()}=${transport[name]} (HTTP ${r.http}${r.error ? `, ${r.error}` : ''})`);
  }
  const setterOpen = transport.wsfSetCommunityVisibility === 'open';
  if (!setterOpen) {
    for (let i = 1; i <= 7; i += 1) {
      rows[`row${i}`] = 'BLOCKED';
      detail[`row${i}`] = [{ status: 'BLOCKED', note: `wsfsetcommunityvisibility transport is ${transport.wsfSetCommunityVisibility}; nothing was written` }];
    }
  } else {
    // ---- fixture: two communities, a champion, the member under test, an outsider ----
    const champion = await createUser('champion');
    const member = await createUser('member');
    const outsider = await createUser('outsider');
    const now = new Date();
    const A = `e5grp-${runTag}-a`;
    const B = `e5grp-${runTag}-b`;
    const goalA = `e5goal-${runTag}-a`;
    for (const u of [champion, member]) {
      await putDoc(`wsfMemberProfiles/${u.uid}`, { displayName: u.displayName, createdAt: now, updatedAt: now });
    }
    for (const g of [A, B]) {
      await putDoc(`wsfCommunityGroups/${g}`, {
        displayName: `Privacy check ${g.endsWith('-a') ? 'A' : 'B'}`, groupType: 'custom', joinPolicy: 'private',
        joinCode: crypto.randomBytes(16).toString('base64url'), createdByUserId: champion.uid,
        lifecycleStatus: 'active', isSample: false, createdAt: now, updatedAt: now,
      });
      for (const [u, role] of [[champion, 'foundingChampion'], [member, 'member']]) {
        await putDoc(`wsfMemberships/${g}_${u.uid}`, { groupId: g, userId: u.uid, role, membershipStatus: 'active', createdAt: now, updatedAt: now });
      }
    }
    await putDoc(`wsfGoals/${goalA}`, {
      ownerUid: champion.uid, communityGroupId: A, title: 'Privacy check goal', target: 1000, unit: 'squats',
      status: 'active', startsAt: new Date(now.getTime() - 60_000), endsAt: new Date(now.getTime() + 3_600_000),
      timezone: 'America/New_York', createdAt: now, updatedAt: now,
    });
    for (let s = 0; s < 10; s += 1) trackDoc(`wsfGoalCounters/${goalA}/shards/${s}`);
    const contribute = async (user, count, n) => {
      const attemptId = `${runTag}-${user.label}-${n}`;
      for (const p of [`wsfContributions/${goalA}_${user.uid}_${attemptId}`, `wsfGoalMemberTotals/${goalA}_${user.uid}`, `wsfGoals/${goalA}/recentAdditions/${attemptId}`]) trackDoc(p);
      const r = await call('wsfContribute', { goalId: goalA, attemptId, count }, user);
      if (r.error) throw new Error(`fixture contribution failed: ${r.error}`);
    };
    await contribute(member, 17, 1);
    await contribute(champion, 5, 1);
    const auth = await call('wsfSetGoalDisplayAuthorization', { goalId: goalA, authorized: true }, champion);
    if (auth.error) throw new Error(`fixture display authorization failed: ${auth.error}`);

    const checks = {};
    const add = (row, status, note) => { (checks[row] ||= []).push({ status, note }); };
    const expect = (row, ok, note) => add(row, ok ? 'PASS' : 'FAIL', note);
    const set = (user, groupId, patch) => call('wsfSetCommunityVisibility', { groupId, ...patch }, user);
    const mine = async (user, groupId) => {
      const r = await call('wsfMyCommunities', {}, user);
      return (r.result?.items || []).find((i) => i?.groupId === groupId) || null;
    };
    const stored = async (groupId, uid) => {
      const f = await getDoc(`wsfMemberships/${groupId}_${uid}`);
      return { name: f?.communityNameVisibility?.stringValue ?? null, activity: f?.communityActivityVisibility?.stringValue ?? null };
    };
    // What another member sees. `null` fields mean that read is not available
    // (transport or the index), which BLOCKS the rows that need it.
    const seenBy = async (viewer) => {
      const view = { members: null, activity: null, membersNote: '', activityNote: '' };
      if (transport.wsfCommunityMembers !== 'open') view.membersNote = `wsfcommunitymembers transport is ${transport.wsfCommunityMembers}`;
      else {
        const r = await call('wsfCommunityMembers', { groupId: A }, viewer);
        if (r.error) view.membersNote = `wsfCommunityMembers answered ${r.error}`; else view.members = r.result;
      }
      if (transport.wsfCommunityActivity !== 'open') view.activityNote = `wsfcommunityactivity transport is ${transport.wsfCommunityActivity}`;
      else {
        const r = await call('wsfCommunityActivity', { groupId: A, goalId: goalA }, viewer);
        if (r.error === 'INTERNAL') view.activityNote = 'wsfCommunityActivity answered INTERNAL — expected while the composite index has no READY read-back; resolve with that read-back';
        else if (r.error) view.activityNote = `wsfCommunityActivity answered ${r.error}`;
        else view.activity = r.result;
      }
      return view;
    };
    const named = (view, user) => (view.members?.members || []).some((m) => m?.displayName === user.displayName);
    const entries = (view) => view.activity?.entries || [];

    // Baseline under the default (absent = visible): the viewer sees the member.
    const base = await seenBy(champion);
    if (base.members) expect('row6', named(base, member), 'default: the member is listed by name');
    else add('row6', 'BLOCKED', base.membersNote);
    if (base.activity) expect('row6', entries(base).some((e) => e.amount === 17 && e.displayName === member.displayName), 'default: the member\'s 17 shows with their name');
    else add('row6', 'BLOCKED', base.activityNote);

    // Row 1 — name OFF persists.
    const r1 = await set(member, A, { name: 'private' });
    expect('row1', !r1.error && r1.result?.name === 'private' && r1.result?.activity === 'visible', `setter answered ${r1.error || JSON.stringify(r1.result)}`);
    const m1 = await mine(member, A);
    expect('row1', m1?.nameVisibility === 'private', `after a reload wsfMyCommunities says name=${m1?.nameVisibility}`);
    expect('row1', (await stored(A, member.uid)).name === 'private', 'the membership stores communityNameVisibility=private');

    // Row 3 — name OFF + activity ON: movement visible, anonymous.
    const v3 = await seenBy(champion);
    if (v3.members) expect('row3', !named(v3, member) && named(v3, champion), 'the member is not listed by name; the champion still is');
    else add('row3', 'BLOCKED', v3.membersNote);
    if (v3.activity) {
      expect('row3', entries(v3).some((e) => e.amount === 17 && e.displayName === null), 'the member\'s 17 shows with no name');
      expect('row3', !JSON.stringify(v3.activity).includes(member.displayName) && !JSON.stringify(v3.activity).includes(member.uid), 'no name or uid of the member anywhere in the activity payload');
    } else add('row3', 'BLOCKED', v3.activityNote);

    // Row 2 — activity OFF persists; the name choice is left alone.
    const r2 = await set(member, A, { activity: 'private' });
    expect('row2', !r2.error && r2.result?.activity === 'private' && r2.result?.name === 'private', `setter answered ${r2.error || JSON.stringify(r2.result)}`);
    const m2 = await mine(member, A);
    expect('row2', m2?.activityVisibility === 'private' && m2?.nameVisibility === 'private', `after a reload wsfMyCommunities says name=${m2?.nameVisibility} activity=${m2?.activityVisibility}`);
    expect('row2', (await stored(A, member.uid)).activity === 'private', 'the membership stores communityActivityVisibility=private');

    // Row 6 — with both OFF: hidden from others, still counted.
    const v6 = await seenBy(champion);
    if (v6.activity) {
      expect('row6', !entries(v6).some((e) => e.amount === 17), 'activity OFF: the member\'s 17 is not in the feed');
      expect('row6', entries(v6).some((e) => e.amount === 5 && e.displayName === champion.displayName), 'the champion\'s own row is unaffected');
      expect('row6', v6.activity.contributorsToday === null || v6.activity.contributorsToday === 2, `people moved today still counts the member (got ${v6.activity.contributorsToday})`);
    } else add('row6', 'BLOCKED', v6.activityNote);
    const cA = await mine(champion, A);
    expect('row6', cA?.memberCount === 2, `the member count stays truthful (got ${cA?.memberCount})`);
    const pulse = await call('wsfGoalPulse', { goalId: goalA });
    const total = pulse.result?.sharedTotal;
    expect('row6', total === 22, `the goal total still includes the member (got ${total === undefined ? `no total: ${pulse.error || 'shape'}` : total})`);

    // Row 4 — A's choices did not touch B; then B's choice does not touch A.
    const b1 = await mine(member, B);
    expect('row4', b1?.nameVisibility === 'visible' && b1?.activityVisibility === 'visible', `B still reads name=${b1?.nameVisibility} activity=${b1?.activityVisibility}`);
    const sb = await stored(B, member.uid);
    expect('row4', sb.name === null && sb.activity === null, 'B\'s membership carries no privacy field');
    const rb = await set(member, B, { name: 'private' });
    expect('row4', !rb.error && rb.result?.name === 'private', `B setter answered ${rb.error || JSON.stringify(rb.result)}`);
    const a4 = await stored(A, member.uid);
    expect('row4', a4.name === 'private' && a4.activity === 'private', 'A is unchanged by the change in B');

    // Row 6 (cont.) — the CURRENT choice governs: back to visible, visible again.
    const r6 = await set(member, A, { name: 'visible', activity: 'visible' });
    expect('row6', !r6.error && r6.result?.name === 'visible' && r6.result?.activity === 'visible', `restoring answered ${r6.error || JSON.stringify(r6.result)}`);
    const v6b = await seenBy(champion);
    if (v6b.members) expect('row6', named(v6b, member), 'restored: listed by name again');
    else add('row6', 'BLOCKED', v6b.membersNote);
    if (v6b.activity) expect('row6', entries(v6b).some((e) => e.amount === 17 && e.displayName === member.displayName), 'restored: the 17 shows with the name again');
    else add('row6', 'BLOCKED', v6b.activityNote);

    // Row 5 — a non-member is refused everywhere, and nothing is written for them.
    const o1 = await set(outsider, A, { name: 'private' });
    expect('row5', o1.error === 'PERMISSION_DENIED', `outsider setter answered ${o1.error || 'a result'}`);
    for (const name of ['wsfCommunityMembers', 'wsfCommunityActivity']) {
      if (transport[name] !== 'open') { add('row5', 'BLOCKED', `${name.toLowerCase()} transport is ${transport[name]}`); continue; }
      const r = await call(name, { groupId: A }, outsider);
      expect('row5', r.error === 'PERMISSION_DENIED', `outsider ${name} answered ${r.error || 'a result'}`);
    }
    expect('row5', (await getDoc(`wsfMemberships/${A}_${outsider.uid}`)) === null, 'no membership was created for the outsider');
    const u1 =await call('wsfSetCommunityVisibility', { groupId: A, name: 'private' });
    expect('row5', u1.error === 'UNAUTHENTICATED', `an anonymous setter call answered ${u1.error || 'a result'}`);

    // Row 7 — public display reads, with the member currently visible to members.
    const leaks = [member.displayName, member.uid, champion.displayName, champion.uid, member.email, champion.email];
    for (const [name, data] of [['wsfGoalPulse', { goalId: goalA }], ['wsfGoalRecentAdditions', { goalId: goalA }]]) {
      const r = await call(name, data);
      if (r.error) { add('row7', 'FAIL', `${name} (anonymous) answered ${r.error}`); continue; }
      const text = JSON.stringify(r.result);
      expect('row7', !leaks.some((s) => text.includes(s)), `${name} (anonymous) carries no member name, uid or email`);
    }
    for (const name of SOCIAL_SERVICES) {
      if (transport[name] !== 'open') { add('row7', 'BLOCKED', `${name.toLowerCase()} transport is ${transport[name]}`); continue; }
      const r = await call(name, { groupId: A, goalId: goalA });
      expect('row7', r.error === 'UNAUTHENTICATED', `${name} without a member identity answered ${r.error || 'a result'}`);
    }

    for (let i = 1; i <= 7; i += 1) {
      rows[`row${i}`] = rowStatus(checks[`row${i}`] || []);
      detail[`row${i}`] = checks[`row${i}`] || [];
    }
  }

  const titles = {
    row1: 'name OFF persists after reload',
    row2: 'activity OFF persists after reload',
    row3: 'name OFF + activity ON is anonymous',
    row4: 'community A does not change community B',
    row5: 'a non-member is denied',
    row6: 'the current choice governs; aggregates stay truthful',
    row7: 'no identity on public display reads',
  };
  for (let i = 1; i <= 7; i += 1) {
    const k = `row${i}`;
    out(`PRIVACY_ROW_${i}=${rows[k]} ${titles[k]}`);
    for (const c of detail[k]) if (c.status !== 'PASS') out(`  ${c.status} ${sanitize(c.note)}`);
  }
  const v = verdict(rows);
  out(`SOCIAL_PRIVACY_VERDICT=${v.verdict}`);
  out(`SOCIAL_PRIVACY_READY=${v.verdict === 'pass'}`);
  fs.writeFileSync(path.join(cfg.resultDir, 'social-privacy-receipt.json'), JSON.stringify({
    target: cfg.target, project: cfg.project, runTag, transport, rows,
    detail: Object.fromEntries(Object.entries(detail).map(([k, cs]) => [k, cs.map((c) => ({ status: c.status, note: sanitize(c.note) }))])),
    verdict: v.verdict,
  }, null, 2) + '\n', { mode: 0o600 });
  process.exitCode = v.exit;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(`::error::${String(e?.message || e).slice(0, 400)}`);
    console.log('SOCIAL_PRIVACY_VERDICT=fail');
    console.log('SOCIAL_PRIVACY_READY=false');
    process.exitCode = 1;
  });
}
