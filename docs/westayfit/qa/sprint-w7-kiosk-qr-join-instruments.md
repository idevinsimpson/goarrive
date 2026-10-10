# W7 Check 86 instruments: LOVABLE-KIOSK-QR-JOIN-1 (inert)

Inert on this branch. These were written and run **outside the repository**, against **detached worktrees of #617 at
`127e91a73f2837aecfb977aed298b3e91387ce46`** (one for the suites, a second for mutants, plus the base `9b2e89e8` for comparison) and, for instrument 1,
a worktree of the served candidate `ec162d17` built and run on the **local Firebase emulators** (project `demo-wsf-local`; Firestore 8080, Auth 9099, Functions 5001).
Nothing was pushed to the PR. They are evidence for **Check 86** (report §86). They change no product code and no other worker's file.
**No hosted system, no staging project, no Lovable project and no credential**: instrument 1 rewrites the kit's two hosted URLs to the emulators and uses the
emulators' literal bearer `owner` and a dummy API key; the rest are hermetic or local Chromium.

## What they prove

| # | Instrument | Result | Why it can fail |
|---|---|---|---|
| 1 | `run.mjs`: the PR's REAL fixture kit and the REAL served backend (ec162d17) on the local emulators: 22 checks | **22 / 22** | does the kit return the code the station shows; does the join write exactly the tracked document; does a public event change what B can read |
| 2 | `prop.mjs`: differential property test of qrJoinProblem against the predicate it replaced and an independent oracle | 5,748 URL cases + non-URL and kit-code variants: **0** verdict differences from the oracle, **0** acceptances the old predicate refused, **0** leaks | is the new verdict exactly the old predicate plus code equality, and nothing else |
| 3 | `trunc.mjs`: every truncated prefix (1..21 characters) of the kit's code in the QR | all 21 truncations refused with the expected named reason (Node 20 and 22) | a QR carrying a shorter, still code-shaped value |
| 4 | `mut617.mjs`: 35 single-edit mutants judged by the PR's own suites | **30 / 35 killed**; survivors: Q5, J6, J8 (missing pins), J9 and X6 (equivalent) | does the PR's own test notice a weakened check |
| 5 | `mut617c.mjs`: 2 more cap mutants | **2 / 2 killed** | the PN-1 cap boundary |
| 6 | `mut617g.mjs`: 4 mutants, each removing a guard.check() that precedes a sign-in; run on the head and on the base | **3 / 4 killed** on the head; the survivor (G3) survives identically on the base | is the "nothing typed into an unreviewed build" contract still enforced at each sign-in |
| 7 | `vis.mjs`: the PR's real exactText, extracted verbatim, against real Chromium on 12 hidden-leaf variants and nth | 12 / 12 cases as expected; hidden-in-other-ways leaves are still read (PN-5) | does isVisible() close PN-4 in the engine the matrix drives |
| 8 | `vis2.mjs`: isVisible() on a nonexistent nth match in real Chromium | `false`, no throw (X6 is equivalent) | is the off-by-one mutant really equivalent |
| 9 | `evtext.mjs`: the new seen texts through EVIDENCE_SCAN_RULES, seenLine and scan-evidence.mjs | 10 texts, 0 rule hits, 0 withheld, `EVIDENCE_SCAN=clean` | can the new texts be refused by the scan or carry a credential shape |
| 10 | `pin.mjs`: the REVIEWED_BUILD block, base against head | byte-identical (9,068 bytes), no diff hunk inside it | is the pin untouched |

## Instrument 1: `run.mjs`

```js
// W7 instrument for Check 86 (#617): run the PR's REAL fixture kit (public expo event) against the REAL served backend
// (ec162d17) on the LOCAL emulators (demo-wsf-local). Nothing here reaches a hosted system; the kit's hosted URLs are
// rewritten to the emulators. usage: node run.mjs <wsf-staging dir of the PR head>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , stagingDir] = process.argv;
const S = '/tmp/claude-0/-home-user-goarrive/7c5b4d17-88ae-5653-a067-ccc063331108/scratchpad';
const { createFixtureKit } = await import(pathToFileURL(path.join(stagingDir, 'journeys/fixture-kit.mjs')).href);
const kiosk = await import(pathToFileURL(path.join(stagingDir, 'hosted-lovable-kiosk.mjs')).href);

const PROJECT = 'demo-wsf-local';
const FS = 'http://127.0.0.1:8080', AUTH = 'http://127.0.0.1:9099', FN = `http://127.0.0.1:5001/${PROJECT}/us-central1`;
const DOCS = `${FS}/v1/projects/${PROJECT}/databases/(default)/documents`;
const rewrite = (url) => {
  const u = String(url);
  let m;
  if ((m = /^https:\/\/firestore\.googleapis\.com\/(.*)$/.exec(u))) return `${FS}/${m[1]}`;
  if ((m = /^https:\/\/identitytoolkit\.googleapis\.com\/(.*)$/.exec(u))) return `${AUTH}/identitytoolkit.googleapis.com/${m[1]}`;
  return u;
};
const fetchImpl = async (url, init) => {
  const target = rewrite(url);
  const res = await fetch(target, init);
  if (/accounts:signUp/.test(target) && init?.body && res.ok) {
    const sent = JSON.parse(init.body);
    if (sent.emailVerified) {
      const { localId } = await res.clone().json();
      await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:update`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ localId, emailVerified: true }),
      });
    }
  }
  return res;
};
const runTag = `w7-${Date.now().toString(36)}`;
const manifest = `${S}/real617/cleanup-${runTag}.json`;
const fixtures = createFixtureKit({ projectId: PROJECT, apiKey: 'fake-api-key', token: 'owner', runTag, cleanupManifest: manifest, fetchImpl, functionsBase: FN });

const results = [];
const check = (name, ok, seen) => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${seen ? `  — ${seen}` : ''}`); };

const fsGet = async (p) => { const r = await fetch(`${DOCS}/${p}`, { headers: { authorization: 'Bearer owner' } }); return r.status === 404 ? null : r.json(); };
async function snapshot() {
  const r = await fetch(`${DOCS}:listCollectionIds`, { method: 'POST', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: '{}' });
  const ids = (await r.json()).collectionIds ?? [];
  const out = new Map();
  for (const id of ids) {
    let token = '';
    do {
      const l = await (await fetch(`${DOCS}/${id}?pageSize=300${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`, { headers: { authorization: 'Bearer owner' } })).json();
      for (const d of l.documents ?? []) out.set(d.name.split('/documents/')[1], d.updateTime);
      token = l.nextPageToken ?? '';
    } while (token);
  }
  return out;
}
async function fn(name, data, idToken) {
  const headers = { 'content-type': 'application/json', ...(idToken ? { authorization: `Bearer ${idToken}` } : {}) };
  const res = await fetch(`${FN}/${name}`, { method: 'POST', headers, body: JSON.stringify({ data }) });
  let parsed = null;
  try { parsed = JSON.parse(await res.text()); } catch { /* keep null */ }
  return { ok: res.ok && !parsed?.error, status: parsed?.error?.status ?? (res.ok ? 'OK' : `HTTP_${res.status}`), result: parsed?.result ?? null };
}
async function idTokenOf(acct) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: acct.email, password: acct.password, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error('sign-in failed');
  return j.idToken;
}
const sv = (f) => f?.stringValue;
const stationCode = async (ev) => {
  const pr = await fn('wsfStationRequestPairing', { goalId: ev.goalId });
  if (!pr.ok) throw new Error(`pairing refused ${pr.status}`);
  const { pairingId, code } = pr.result;
  await fixtures.approveStation(ev, code, 1);
  const cl = await fn('wsfStationClaimPairing', { pairingId });
  if (!cl.ok) throw new Error(`claim refused ${cl.status}`);
  const st = await fn('wsfStationState', { stationId: cl.result.stationId, secret: cl.result.secret });
  return st;
};

// ---- 1. the kit: the exact options the harness passes, and the options it must refuse -------------------------------
const pub = await fixtures.expoEvent('lk', { attendees: 1, target: 1000, seeded: 100, joinPolicy: 'public' });
const priv = await fixtures.expoEvent('pv', { attendees: 1, target: 1000, seeded: 100 });
check('kit: public event returns a join code (string, 16-128 base64url)', typeof pub.joinCode === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(pub.joinCode));
check('kit: private event returns NO join code', !('joinCode' in priv) && priv.joinCode === undefined);
const pubGroup = await fsGet(`wsfCommunityGroups/${pub.groupId}`);
const privGroup = await fsGet(`wsfCommunityGroups/${priv.groupId}`);
check('kit: the community written is joinPolicy public, and its stored joinCode is the returned one', sv(pubGroup?.fields?.joinPolicy) === 'public' && sv(pubGroup?.fields?.joinCode) === pub.joinCode);
check('kit: the private community is still private (omitted option is unchanged)', sv(privGroup?.fields?.joinPolicy) === 'private');
check('kit: groupId and goalId carry the run tag (cleanup manifest will accept paths built from them)', pub.groupId.includes(runTag) && pub.goalId.includes(runTag));
let threw = false;
const before = await snapshot();
try { await fixtures.expoEvent('bad', { attendees: 1, target: 1, seeded: 1, joinPolicy: 'inviteOnly' }); } catch (e) { threw = /joinPolicy is either omitted/.test(String(e?.message)); }
const afterBad = await snapshot();
check('kit: joinPolicy inviteOnly throws before anything is created', threw && afterBad.size === before.size);

// ---- 2. the served backend: only a link-joinable event's approved station shows the join code ------------------------
const stPub = await stationCode(pub);
const stPriv = await stationCode(priv);
check('server: the PUBLIC event\'s approved station state carries a join code equal to the kit\'s', stPub.ok && stPub.result.joinCode === pub.joinCode);
check('server: the PRIVATE event\'s approved station state carries joinCode null', stPriv.ok && stPriv.result.joinCode === null);

// ---- 3. what the harness\'s qrJoinProblem decides, on the REAL code ----------------------------------------------------
const LOVABLE = kiosk.LOVABLE_URL ?? null;
const hostFromHarness = (await import('node:fs')).readFileSync(path.join(stagingDir, 'hosted-lovable-kiosk.mjs'), 'utf8').match(/const LOVABLE_URL = '([^']+)'/)?.[1] ?? null;
const base = hostFromHarness;
const goodQr = `${base}/?join=${encodeURIComponent(stPub.result.joinCode)}&goal=${encodeURIComponent(pub.goalId)}`;
check('qrJoinProblem: the real station\'s code, in the QR shape the matrix uses, is accepted (null)', kiosk.qrJoinProblem(goodQr, pub) === null, `host ${base}`);
check('qrJoinProblem: the PRIVATE event\'s (null) code can never be accepted', kiosk.qrJoinProblem(`${base}/?join=${'A'.repeat(22)}&goal=${priv.goalId}`, { ...priv, joinCode: undefined }) !== null);
check('qrJoinProblem: event P\'s real code in event Q\'s QR is refused (other community\'s code)', kiosk.qrJoinProblem(`${base}/?join=${encodeURIComponent(pub.joinCode)}&goal=${pub.goalId}`, { ...pub, joinCode: crypto.randomUUID().replace(/-/g, '') }) !== null);

// ---- 4. visitor A joins through the real callable with the QR\'s code; exact documents written -----------------------
const A = (await fixtures.memberInTwoCommunities('lka')).member;
const B = (await fixtures.memberInTwoCommunities('lkb')).member;
const tokA = await idTokenOf(A);
const tokB = await idTokenOf(B);
const joinCodeFromQr = new URL(goodQr).searchParams.get('join');
const pre = await snapshot();
const preList = await fn('wsfListGoals', { groupId: pub.groupId }, tokA);
const j1 = await fn('wsfJoinCommunity', { joinCode: joinCodeFromQr }, tokA);
const post = await snapshot();
const added = [...post.keys()].filter((k) => !pre.has(k));
const changed = [...post.keys()].filter((k) => pre.has(k) && pre.get(k) !== post.get(k));
const removed = [...pre.keys()].filter((k) => !post.has(k));
check('server: before the join A (non-member) is refused wsfListGoals for the public event', !preList.ok && preList.status === 'NOT_FOUND', preList.status);
check('server: A joins the public event with the QR\'s code: this community, alreadyMember false', j1.ok && j1.result.groupId === pub.groupId && j1.result.alreadyMember === false, `${j1.status}`);
const trackedPath = `wsfMemberships/${pub.groupId}_${A.uid}`;
check('server: the join adds EXACTLY one document, the path the harness tracks', added.length === 1 && added[0] === trackedPath && removed.length === 0, `added ${JSON.stringify(added.map((p) => p.replace(/_[A-Za-z0-9]+$/, '_<uid>')))}`);
check('server: nothing existing is modified by the join (no counter or profile write)', changed.length === 0, `changed ${changed.length}`);
const j2 = await fn('wsfJoinCommunity', { joinCode: joinCodeFromQr }, tokA);
check('server: a second join by A is alreadyMember true (the harness\'s FAIL case is real)', j2.ok && j2.result.alreadyMember === true);
const postList = await fn('wsfListGoals', { groupId: pub.groupId }, tokA);
check('server: after the join A can list the public event\'s goals', postList.ok);

// ---- 5. the harness\'s own tracking + manifest merge on the REAL manifest ---------------------------------------------
const merged = kiosk.mergeIntoManifest(manifest, [trackedPath]);
const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
const tagged = m.docs.includes(trackedPath) && trackedPath.includes(m.runTag);
const rx = /^wsfMemberships\/([^/]+)_([^/_]+)$/.exec(trackedPath);
check('manifest: the tracked membership merges into the kit\'s real manifest, run-tagged, uid in manifest.users', tagged && rx && m.users.includes(rx[2]), `${merged} docs`);
check('manifest: productDocsSeen names it by kind and never by id/uid', (() => { const t = kiosk.productDocsSeen([trackedPath], merged); return /visitor A's membership of the event community/.test(t) && !t.includes(A.uid) && !t.includes(pub.groupId); })());

// ---- 6. isolation: B (non-member) reads the same on the public event as on the private one --------------------------------
const bq = async (ev) => ({
  list: (await fn('wsfListGoals', { groupId: ev.groupId }, tokB)).status,
  mine: (await fn('wsfMyContribution', { goalId: ev.goalId }, tokB)).status,
  pulse: await fn('wsfGoalPulse', { goalId: ev.goalId }, tokB),
});
const bPub = await bq(pub), bPriv = await bq(priv);
check('isolation: B\'s wsfListGoals and wsfMyContribution are refused identically on the public and the private event', bPub.list === bPriv.list && bPub.mine === bPriv.mine && bPub.list !== 'OK' && bPub.mine !== 'OK', `${bPub.list}/${bPub.mine} vs ${bPriv.list}/${bPriv.mine}`);
const strip = (r) => JSON.stringify(Object.keys(r.result ?? {}).sort());
check('isolation: B\'s wsfGoalPulse has the same status and field set on both events (display authorization only)', bPub.pulse.status === bPriv.pulse.status && strip(bPub.pulse) === strip(bPriv.pulse), `${bPub.pulse.status} ${strip(bPub.pulse)}`);
const prevB = await fn('wsfPreviewCommunity', { joinCode: 'x'.repeat(22) }, tokB);
check('isolation: B without the code gets no community from wsfPreviewCommunity (guess refused)', !prevB.ok || prevB.result == null || JSON.stringify(prevB.result).indexOf(pub.groupId) === -1);

const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} passed${bad.length ? `; FAILED: ${bad.map((r) => r.name).join(' | ')}` : ''}`);
process.exit(bad.length ? 1 : 0);
```

## Instrument 2: `prop.mjs`

```js
// W7 Check 86 instrument: differential property test of qrJoinProblem (#617) against the predicate it replaced (main 9b2e89e8).
import { pathToFileURL } from 'node:url';
const dir = process.argv[2];
const { qrJoinProblem, LOVABLE_URL } = await import(pathToFileURL(`${dir}/hosted-lovable-kiosk.mjs`).href);
const H = LOVABLE_URL;
const GOAL = 'e5cgoal-run-lk', CODE = 'Abcdefghijklmnop_-1234', OTHER = 'Zyxwvutsrqponmlk_-9876';
const ev = { goalId: GOAL, joinCode: CODE };
// the old predicate, verbatim from main: throws on an unparsable URL (the old code's catch took it).
const oldAccepts = (raw, e) => {
  const u = raw ? new URL(raw) : null;
  return !!(u && u.origin === LOVABLE_URL && u.pathname === '/' && /^[A-Za-z0-9_-]{16,128}$/.test(u.searchParams.get('join') ?? '') && u.searchParams.get('goal') === e.goalId);
};
// independent oracle written from the packet's stated contract (not from the code)
const oracle = (raw, e) => {
  let u; try { u = new URL(String(raw ?? '')); } catch { return false; }
  return u.origin === H && u.pathname === '/' && u.searchParams.get('goal') === e.goalId
    && /^[A-Za-z0-9_-]{16,128}$/.test(u.searchParams.get('join') ?? '')
    && typeof e.joinCode === 'string' && e.joinCode !== '' && u.searchParams.get('join') === e.joinCode;
};
const hosts = [H, H.replace('https:', 'http:'), 'https://we-stay-fit-foundation-trial.lovable.app:443', 'https://we-stay-fit-foundation-trial.lovable.app:8443', 'https://WE-STAY-FIT-FOUNDATION-TRIAL.lovable.app', 'https://we-stay-fit-foundation-trial.lovable.app.', 'https://u:p@we-stay-fit-foundation-trial.lovable.app', 'https://evil.example', 'https://we-stay-fit-foundation-trial.lovable.app.evil.example', 'https://evil.example@we-stay-fit-foundation-trial.lovable.app', 'https://we-stay-fit-foundation-trial.lovable.app@evil.example', 'javascript:alert(1)', ''];
const paths = ['/', '', '//', '/x', '/?', '/./', '/%2F'];
const qs = [
  `join=${CODE}&goal=${GOAL}`, `goal=${GOAL}&join=${CODE}`, `join=${OTHER}&goal=${GOAL}`, `join=${CODE}&goal=other`, `join=${CODE}`, `goal=${GOAL}`, ``,
  `join=${CODE}&join=${OTHER}&goal=${GOAL}`, `join=${OTHER}&join=${CODE}&goal=${GOAL}`, `join=${CODE}&goal=${GOAL}&goal=x`, `join=${CODE.slice(0, 15)}&goal=${GOAL}`, `join=${CODE}x&goal=${GOAL}`,
  `join=${CODE.toLowerCase()}&goal=${GOAL}`, `join=${encodeURIComponent(CODE)}&goal=${GOAL}`, `join=%41bcdefghijklmnop_-1234&goal=${GOAL}`, `join=${CODE}&goal=${GOAL}&x=1`, `JOIN=${CODE}&goal=${GOAL}`,
  `join=${CODE}%20&goal=${GOAL}`, `join=${CODE}&goal=${GOAL}%20`, `join[]=${CODE}&goal=${GOAL}`, `join=${CODE};goal=${GOAL}`,
];
const hashes = ['', '#x', '#join=' + OTHER];
let n = 0, newAcc = 0, oldAcc = 0, viol = [], notTighter = [], oracleMis = [];
const accepted = [];
for (const h of hosts) for (const p of paths) for (const q of qs) for (const hs of hashes) {
  const raw = `${h}${p}${q ? '?' + q : ''}${hs}`;
  n += 1;
  let oa; try { oa = oldAccepts(raw, ev); } catch { oa = 'throws'; }
  const na = qrJoinProblem(raw, ev) === null;
  const or = oracle(raw, ev);
  if (na) { newAcc += 1; accepted.push(raw); }
  if (oa === true) oldAcc += 1;
  if (na && oa !== true) notTighter.push(raw);
  if (na !== or) oracleMis.push(raw);
  if (oa === true && !na && !(new URL(raw).searchParams.get('join') !== CODE)) viol.push(raw); // old-accepted, new-refused, yet code equal
}
// non-URL / non-string inputs
for (const raw of [null, undefined, '', 'not a url', 42, {}, [], 'https://']) { n += 1; if (qrJoinProblem(raw, ev) === null) oracleMis.push(String(raw)); }
// ev variants
const evs = [{ goalId: GOAL }, { goalId: GOAL, joinCode: '' }, { goalId: GOAL, joinCode: null }, { goalId: GOAL, joinCode: 12345678901234567 }, { goalId: undefined, joinCode: CODE }, undefined, null];
const good = `${H}/?join=${CODE}&goal=${GOAL}`;
for (const e of evs) { n += 1; const r = qrJoinProblem(good, e); if (r === null) oracleMis.push(`ev ${JSON.stringify(e)}`); }
// printed text never carries either code
const leaks = [];
for (const raw of accepted.length ? [] : []) leaks.push(raw);
for (const h of hosts) for (const q of qs) { const r = qrJoinProblem(`${h}/?${q}`, ev); if (typeof r === 'string' && (r.includes(CODE) || r.includes(OTHER) || r.includes(GOAL))) leaks.push(r); }
console.log(`cases ${n}; old accepted ${oldAcc}; new accepted ${newAcc}`);
console.log(`new accepts something the old refused: ${notTighter.length}`);
console.log(`old-accepted, code equal, yet new refused: ${viol.length}`);
console.log(`verdict != independent oracle: ${oracleMis.length}${oracleMis.length ? ' e.g. ' + oracleMis.slice(0, 3).join(' | ') : ''}`);
console.log(`problem text carrying a code or goal id: ${leaks.length}`);
console.log('distinct URL shapes the NEW verdict accepts:');
const shapes = new Map();
for (const raw of accepted) { const u = new URL(raw); const k = `${u.protocol}//${u.username ? 'USERINFO@' : ''}${u.hostname}${u.port ? ':' + u.port : ''}${u.hash ? ' +fragment' : ''} q=${[...u.searchParams.keys()].join(',')}`; shapes.set(k, (shapes.get(k) ?? 0) + 1); }
for (const [k, v] of shapes) console.log(`  ${v}x  ${k}`);
process.exit(notTighter.length || viol.length || oracleMis.length || leaks.length ? 1 : 0);
```

## Instrument 3: `trunc.mjs`

```js
import { pathToFileURL } from 'node:url';
const { qrJoinProblem, LOVABLE_URL } = await import(pathToFileURL(`${process.argv[2]}/hosted-lovable-kiosk.mjs`).href);
const ev = { goalId: 'g-1', joinCode: 'Kj3_q-9ZxYwV8uTs7rQp6o' };
let ok = true;
for (let n = 1; n < ev.joinCode.length; n++) {
  const r = qrJoinProblem(`${LOVABLE_URL}/?join=${ev.joinCode.slice(0, n)}&goal=g-1`, ev);
  const want = n < 16 ? "the QR's join value is not a join code (not printed)" : "the QR's join code is not this community's (neither code is printed)";
  if (r !== want) { ok = false; console.log('MISMATCH', n, r); }
}
console.log('truncated-prefix lengths 1..21 each refused with the expected named reason:', ok);
```

## Instrument 4: `mut617.mjs`

```js
// W7 Check 86 instrument: fixed-purpose mutants of #617 applied one at a time to a scratch worktree, run against the PR's own
// suites, restored after each. usage: node mut617.mjs <worktree root>
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const root = process.argv[2];
const K = `${root}/.github/wsf-staging/hosted-lovable-kiosk.mjs`;
const M = `${root}/.github/wsf-staging/hosted-lovable-device-matrix.mjs`;
const origK = fs.readFileSync(K, 'utf8'), origM = fs.readFileSync(M, 'utf8');
const suite = (f) => spawnSync(process.execPath, [f], { cwd: root, encoding: 'utf8', timeout: 240_000 });
const KT = `${root}/.github/wsf-staging/tests/hosted-lovable-kiosk.test.mjs`, MT = `${root}/.github/wsf-staging/hosted-lovable-device-matrix.test.mjs`;
const mutants = [
  // qrJoinProblem branches (the packet's own territory; my edits, not its catalogue)
  ['Q1 origin check removed', K, "u.origin !== LOVABLE_URL || u.pathname !== '/' ||", "u.pathname !== '/' ||"],
  ['Q2 path check removed', K, "|| u.pathname !== '/' || u.searchParams.get('goal')", "|| u.searchParams.get('goal')"],
  ['Q3 goal check removed', K, " || u.searchParams.get('goal') !== ev?.goalId) return 'the QR carries no same-host", ") return 'the QR carries no same-host"],
  ['Q4 code length floor 16 -> 1', K, "/^[A-Za-z0-9_-]{16,128}$/.test(code)", "/^[A-Za-z0-9_-]{1,128}$/.test(code)"],
  ['Q5 equality -> kit code startsWith QR code', K, "if (code !== ev.joinCode) return", "if (!ev.joinCode.startsWith(code)) return"],
  ['Q6 equality -> QR code startsWith kit code', K, "if (code !== ev.joinCode) return", "if (!code.startsWith(ev.joinCode)) return"],
  ['Q7 equality case-insensitive', K, "if (code !== ev.joinCode) return", "if (code.toLowerCase() !== ev.joinCode.toLowerCase()) return"],
  ['Q8 equality on the first 8 characters only', K, "if (code !== ev.joinCode) return", "if (code.slice(0, 8) !== ev.joinCode.slice(0, 8)) return"],
  ['Q9 equality check removed', K, "  if (code !== ev.joinCode) return 'the QR\\'s join code is not this community\\'s (neither code is printed)';\n", ""],
  ['Q10 kit-code presence check removed', K, "  if (typeof ev?.joinCode !== 'string' || !ev.joinCode) return 'the kit returned no join code for its public event';\n", ""],
  ['Q11 problem text prints both codes', K, "'the QR\\'s join code is not this community\\'s (neither code is printed)'", "`the QR's join code ${code} is not this community's ${ev.joinCode}`"],
  ['Q12 unparsable URL passes', K, "catch { return 'the QR carries no join link'; }", "catch { return null; }"],
  // journey wiring
  ['J1 public option dropped from expoEvent', K, ", seeded: 100, joinPolicy: 'public' }", ", seeded: 100 }"],
  ['J2 QR problem ignored', K, "if (problem) set('qr-join', false, problem);\n        else joinUrl = new URL(raw).href;", "joinUrl = new URL(raw).href;"],
  ['J3 no-QR on a public event is BLOCKED', K, "short(e)}`);\n    }\n    if (joinUrl)", "short(e)}`, noCode ? 'BLOCKED' : 'FAIL');\n    }\n    if (joinUrl)"],
  ['J4 no-QR text changed (no kiosk text quoted)', K, "`the kiosk of this public (link-joinable) event shows \"${NO_JOIN_CODE}\"`", "'the kiosk shows no QR'"],
  ['J5 membership tracking dropped', K, "track(pageA, a, { join: true });", "track(pageA, a);"],
  ['J6 alreadyMember accepted when undefined', K, "joined.result.alreadyMember === false && phone", "joined.result.alreadyMember !== true && phone"],
  ['J7 wrong community accepted', K, "joined?.result?.groupId === ev.groupId && joined.result.alreadyMember === false", "joined.result.alreadyMember === false"],
  ['J8 phone choice not required', K, "joined.result.alreadyMember === false && phone,", "joined.result.alreadyMember === false,"],
  ['J9 joinUrl built from the raw string, not href', K, "else joinUrl = new URL(raw).href;", "else joinUrl = raw;"],
  // cleanup naming
  ['C1 productDocsSeen prints the path', K, "'visitor A\\'s membership of the event community, from the QR join' : 'a product-written document'", "p : 'a product-written document'"],
  ['C2 productDocsSeen count uses the manifest total', K, "return `${docs.length} product-written document(s) added", "return `${total} product-written document(s) added"],
  ['C3 cli keeps the old cleanup text', K, "seen: productDocsSeen(journey.productDocs, total) }", "seen: `${journey.productDocs.length} product-written document(s) added; ${total} in the manifest` }"],
  ['C4 productDocsSeen: non-membership path named as membership', K, "(/^wsfMemberships\\/[^/]+$/.test(p) ?", "(/^wsf[A-Za-z]+\\/[^/]+$/.test(p) ?"],
  // PN-1 seenLine cap
  ['P1 cap SEEN_MAX -> SEEN_MAX+1 kept', K, "slice(0, SEEN_MAX - 1)", "slice(0, SEEN_MAX)"],
  ['P2 cap counts UTF-16 units not code points', K, "Array.from(t).length > SEEN_MAX) t = `${Array.from(t).slice(0, SEEN_MAX - 1).join('')}…`", "t.length > SEEN_MAX) t = `${t.slice(0, SEEN_MAX - 1)}…`"],
  ['P3 cap > -> >=', K, "Array.from(t).length > SEEN_MAX", "Array.from(t).length >= SEEN_MAX"],
  ['P4 logSafe removed from seenLine', K, "return logSafe(`${prefix} ${id} ${t || '(none)'}`);", "return `${prefix} ${id} ${t || '(none)'}`;"],
  // PN-4 matrix visibility
  ['X1 exactText reads hidden leaves', M, "return (await leaf.isVisible()) ? clean(await leaf.textContent()) : '';", "return clean(await leaf.textContent());"],
  ['X2 exactText checks first match visible', M, "(await leaf.isVisible())", "(await l.first().isVisible())"],
  ['X3 exactText returns text for a hidden leaf only', M, "(await leaf.isVisible()) ?", "(!(await leaf.isVisible())) ?"],
  ['X4 exactText uses innerText', M, "clean(await leaf.textContent())", "clean(await leaf.innerText())"],
  ['X5 exactText ignores the index', M, "const leaf = l.nth(index);", "const leaf = l.first();"],
  ['X6 exactText count bound >= (equiv?)', M, "if ((await l.count()) <= index) return '';", "if ((await l.count()) < index) return '';"],
];
let killed = 0, survived = [], bad = [];
for (const [name, file, find, rep] of mutants) {
  const src = file === K ? origK : origM;
  const n = src.split(find).length - 1;
  if (n !== 1) { bad.push(`${name}: pattern matched ${n}x`); continue; }
  fs.writeFileSync(file, src.replace(find, () => rep));
  const k = suite(KT), m = suite(MT);
  fs.writeFileSync(K, origK); fs.writeFileSync(M, origM);
  const dead = k.status !== 0 || m.status !== 0;
  const by = k.status !== 0 ? 'kiosk' : m.status !== 0 ? 'matrix' : '-';
  console.log(`${dead ? 'KILLED  ' : 'SURVIVED'} ${name}  [${by}]`);
  if (dead) killed++; else survived.push(name);
}
console.log(`\n${killed}/${mutants.length - bad.length} killed; survivors: ${survived.length ? survived.join(' | ') : 'none'}; unapplied: ${bad.length ? bad.join(' | ') : 'none'}`);
fs.writeFileSync(K, origK); fs.writeFileSync(M, origM);
```

## Instrument 5: `mut617c.mjs`

```js
import fs from 'node:fs'; import { spawnSync } from 'node:child_process';
const root = process.argv[2]; const K = `${root}/.github/wsf-staging/hosted-lovable-kiosk.mjs`; const KT = `${root}/.github/wsf-staging/tests/hosted-lovable-kiosk.test.mjs`;
const orig = fs.readFileSync(K, 'utf8');
for (const [name, find, rep] of [
  ['P5 cap lets 301 through (> SEEN_MAX + 1)', 'Array.from(t).length > SEEN_MAX)', 'Array.from(t).length > SEEN_MAX + 1)'],
  ['P6 cap keeps 298 + ellipsis (SEEN_MAX - 2)', 'slice(0, SEEN_MAX - 1)', 'slice(0, SEEN_MAX - 2)'],
]) {
  if (orig.split(find).length !== 2) { console.log('UNAPPLIED', name); continue; }
  fs.writeFileSync(K, orig.replace(find, () => rep)); const r = spawnSync(process.execPath, [KT], { cwd: root, encoding: 'utf8' }); fs.writeFileSync(K, orig);
  console.log(r.status !== 0 ? 'KILLED  ' : 'SURVIVED', name);
}
```

## Instrument 6: `mut617g.mjs`

```js
// W7 Check 86 instrument: removing each guard.check() that precedes a sign-in; the PR's guard contract must kill each.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const root = process.argv[2];
const K = `${root}/.github/wsf-staging/hosted-lovable-kiosk.mjs`;
const KT = `${root}/.github/wsf-staging/tests/hosted-lovable-kiosk.test.mjs`;
const orig = fs.readFileSync(K, 'utf8');
const sites = [
  ['G1 A: guard.check() after the join-page goto', "await pageA.goto(joinUrl);\n      guard.check(); // nothing is typed into a page that loaded anything unreviewed\n", "await pageA.goto(joinUrl);\n"],
  ['G2 control: guard.check() after the home goto', "await pageM.goto(`${base}/`);\n    guard.check(); // nothing is typed into a page that loaded anything unreviewed\n    await signIn(pageM, m);", "await pageM.goto(`${base}/`);\n    await signIn(pageM, m);"],
  ['G3 B: guard.check() after the home goto', "await pageM.goto(`${base}/`);\n    guard.check();\n    await signIn(pageM, b);", "await pageM.goto(`${base}/`);\n    await signIn(pageM, b);"],
  ['G4 kiosk: guard.check() after the kiosk goto', "await kiosk.goto(`${base}/kiosk/${ev.groupId}/${ev.goalId}`);\n    guard.check();\n", "await kiosk.goto(`${base}/kiosk/${ev.groupId}/${ev.goalId}`);\n"],
];
for (const [name, find, rep] of sites) {
  const n = orig.split(find).length - 1;
  if (n !== 1) { console.log(`UNAPPLIED ${name} (${n}x)`); continue; }
  fs.writeFileSync(K, orig.replace(find, () => rep));
  const r = spawnSync(process.execPath, [KT], { cwd: root, encoding: 'utf8', timeout: 240_000 });
  fs.writeFileSync(K, orig);
  console.log(`${r.status !== 0 ? 'KILLED  ' : 'SURVIVED'} ${name}`);
}
fs.writeFileSync(K, orig);
```

## Instrument 7: `vis.mjs`

```js
// W7 Check 86 instrument: the PR's REAL exactText (extracted verbatim from the head source) against REAL Chromium, on leaves hidden in each way.
import fs from 'node:fs'; import { createRequire } from 'node:module';
const S = '/tmp/claude-0/-home-user-goarrive/7c5b4d17-88ae-5653-a067-ccc063331108/scratchpad';
const { chromium } = createRequire(`${S}/wt-A/apps/westayfit/package.json`)('playwright-core');
const src = fs.readFileSync(`${process.argv[2]}/hosted-lovable-device-matrix.mjs`, 'utf8');
const clean = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
const fnSrc = src.slice(src.indexOf('async function exactText'), src.indexOf('async function attrOf'));
const exactText = new Function('clean', `${fnSrc}; return exactText;`)(clean);
const cases = [
  ['visible', '<p class="x">Step 2 of 2</p>', 'Step 2 of 2'],
  ['text-transform uppercase (innerText would read STEP)', '<p class="x" style="text-transform:uppercase">Step 2 of 2</p>', 'Step 2 of 2'],
  ['visibility:hidden', '<p class="x" style="visibility:hidden">Step 2 of 2</p>', ''],
  ['display:none', '<p class="x" style="display:none">Step 2 of 2</p>', ''],
  ['hidden attribute', '<p class="x" hidden>Step 2 of 2</p>', ''],
  ['ancestor display:none', '<div style="display:none"><p class="x">Step 2 of 2</p></div>', ''],
  ['ancestor visibility:hidden', '<div style="visibility:hidden"><p class="x">Step 2 of 2</p></div>', ''],
  ['zero-size box', '<p class="x" style="width:0;height:0;overflow:hidden;padding:0;margin:0">Step 2 of 2</p>', ''],
  ['opacity:0', '<p class="x" style="opacity:0">Step 2 of 2</p>', 'Step 2 of 2 (READ)'],
  ['off-screen (left:-9999px)', '<p class="x" style="position:absolute;left:-9999px">Step 2 of 2</p>', 'Step 2 of 2 (READ)'],
  ['clipped sr-only (1px)', '<p class="x" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Step 2 of 2</p>', 'Step 2 of 2 (READ)'],
  ['color equals background', '<p class="x" style="color:#fff;background:#fff">Step 2 of 2</p>', 'Step 2 of 2 (READ)'],
];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await (await browser.newContext()).newPage();
let bad = 0;
for (const [name, html, want] of cases) {
  await page.setContent(`<body style="background:#fff">${html}</body>`);
  const got = await exactText(page, '.x');
  const expect = want.replace(' (READ)', '');
  const ok = got === expect;
  if (!ok) bad++;
  console.log(`${ok ? 'ok ' : 'BAD'} ${name.padEnd(52)} -> ${JSON.stringify(got)}${want.includes('(READ)') ? '   [read as visible copy: a leaf the visitor cannot see is still read]' : ''}`);
}
// nth() leaf: first visible, second hidden
await page.setContent('<body><p class="y">A</p><p class="y" style="visibility:hidden">B</p></body>');
const n0 = await exactText(page, '.y', 0), n1 = await exactText(page, '.y', 1), n2 = await exactText(page, '.y', 2);
console.log(`nth: index0 ${JSON.stringify(n0)} (want "A"), index1 ${JSON.stringify(n1)} (want ""), index2 ${JSON.stringify(n2)} (want "")`);
if (n0 !== 'A' || n1 !== '' || n2 !== '') bad++;
await browser.close();
process.exit(bad ? 1 : 0);
```

## Instrument 8: `vis2.mjs`

```js
import { createRequire } from 'node:module';
const { chromium } = createRequire('/tmp/claude-0/-home-user-goarrive/7c5b4d17-88ae-5653-a067-ccc063331108/scratchpad/wt-A/apps/westayfit/package.json')('playwright-core');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await (await browser.newContext()).newPage();
await page.setContent('<body><p class="y">A</p><p class="y">B</p></body>');
const l = page.locator('.y');
console.log('count', await l.count(), '| nth(2).isVisible() on a nonexistent match ->', await l.nth(2).isVisible(), '| no-match locator isVisible ->', await page.locator('.nope').isVisible());
await browser.close();
```

## Instrument 9: `evtext.mjs`

```js
import fs from 'node:fs'; import { pathToFileURL } from 'node:url';
const dir = process.argv[2], out = process.argv[3];
const k = await import(pathToFileURL(`${dir}/hosted-lovable-kiosk.mjs`).href);
const ev = { goalId: 'e5cgoal-run-lk', joinCode: 'Kj3_q-9ZxYwV8uTs7rQp6o' };
const H = k.LOVABLE_URL;
const texts = [
  k.qrJoinProblem(null, ev), k.qrJoinProblem('x', ev), k.qrJoinProblem(`${H}/?goal=other&join=${ev.joinCode}`, ev), k.qrJoinProblem(`${H}/?goal=${ev.goalId}&join=abc`, ev),
  k.qrJoinProblem(`${H}/?goal=${ev.goalId}&join=Zz9_q-9ZxYwV8uTs7rQp6o`, ev), k.qrJoinProblem(`${H}/?goal=${ev.goalId}&join=${ev.joinCode}`, {}),
  k.productDocsSeen(['wsfMemberships/e5cgrp-t-lk_uidx'], 12), k.productDocsSeen(['wsfFoo/bar'], 3),
  `the kiosk of this public (link-joinable) event shows "This goal has no join code to show."`,
  'join into this community, alreadyMember=false; phone choice shown',
].map((t) => String(t));
const rules = k.EVIDENCE_SCAN_RULES;
const hits = texts.filter((t) => rules.some((re) => re.test(t)));
const lines = texts.map((t, i) => k.seenLine('LOVABLE_SEEN', ['qr-join', 'cleanup-tracking'][i % 2], t));
console.log(`texts ${texts.length}; EVIDENCE_SCAN_RULES hits ${hits.length}; withheld by seenLine ${lines.filter((l) => /withheld/.test(l)).length}`);
fs.writeFileSync(out, JSON.stringify({ rows: texts.map((t, i) => ({ id: `r${i}`, seen: t })) }, null, 2));
```

## Instrument 10: `pin.mjs`

```js
import fs from 'node:fs'; import crypto from 'node:crypto';
for (const [tag, dir] of [['base', 'wt-617b'], ['head', 'wt-617']]) {
  const src = fs.readFileSync(`${dir}/.github/wsf-staging/hosted-lovable-kiosk.mjs`, 'utf8');
  const i = src.indexOf('export const REVIEWED_BUILD');
  const j = src.indexOf('\n});', i) + 4;
  const block = src.slice(i, j);
  console.log(tag, 'REVIEWED_BUILD block bytes', block.length, 'sha256', crypto.createHash('sha256').update(block).digest('hex').slice(0, 16));
}
```
