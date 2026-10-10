# W7 Check 87 instruments: LOVABLE-KIOSK-STATION-DRIVER-1 (inert)

Inert on this branch. These were written and run **outside the repository**, against **detached worktrees of #619 at
`a4768e02fc473696d26588493503501de08bcfa2`** (one for the suites, a second for mutants, plus the base `2709d764` for comparison) and, for instrument 1,
a worktree of the served candidate `ec162d17` built and run on the **local Firebase emulators** (project `demo-wsf-local`; Firestore 8080, Auth 9099, Functions 5001).
Nothing was pushed to the PR. They are evidence for **Check 87** (report §87). They change no product code and no other worker's file.
**No hosted system, no staging project, no Lovable project and no credential**: instrument 1 rewrites the kit's two hosted URLs to the emulators and uses the
emulators' literal bearer `owner` and a dummy API key. The kiosk and phone UI belong to the Lovable app, which is not here, so instrument 1 drives the callables the UI sends and
supplies the screen-derived verdict inputs as labelled stand-ins.

## What they prove

| # | Instrument | Result | Why it can fail |
|---|---|---|---|
| 1 | `run.mjs`: the PR's REAL fixture kit and REAL verdict functions against the REAL served backend (ec162d17) on the local emulators: 26 checks | **26 / 26** (after correcting one assertion of mine that was too strict, see §87) | do the callables answer the fields the verdicts read; does Leave end an active turn; does a refused Start write nothing; is every document the turn creates in the kit's manifest |
| 2 | `mut619.mjs`: 77 single-edit mutants judged by the PR's own kiosk suite | **75 / 77 killed**; survivors: the code alphabet and the code length (missing pins) | does the PR's own test notice a weakened check, for each verdict, pattern, write list and wiring step |
| 3 | `mut619s.mjs`: the same 77 mutants, parse-checked only (no kill is a syntax error) | 77 / 77 parse | is a "kill" a real test failure |
| 4 | `fuzz.mjs`: sentinel fuzz of the seven station verdicts: 28,000 texts | 0 of 28,000 texts carry an entry id, binding, secret, station id, join code, uid or line code | can a verdict print what the packet says it never prints |
| 5 | `lens2.mjs`: the seven PASS texts against the 200-character cap of `results()` | four of the seven PASS texts are cut at 200 characters (PN-1) | is the evidence text complete |
| 6 | `pin.mjs`: the REVIEWED_BUILD block, base against head | byte-identical (9,068 bytes), no diff hunk inside it | is the pin untouched |

## Instrument 1: `run.mjs`

```js
// W7 instrument for Check 87 (#619): the PR's REAL fixture kit and REAL verdict functions against the REAL served backend (ec162d17)
// on the LOCAL emulators (demo-wsf-local). The kiosk/phone UI is the Lovable app and is not here; everything the verdicts read from
// REQUESTS and RESPONSES is real, everything they read from the screen is supplied as a faithful stand-in and labelled.
// usage: node run.mjs <wsf-staging dir of the PR head>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , stagingDir] = process.argv;
const S = '/tmp/claude-0/-home-user-goarrive/7c5b4d17-88ae-5653-a067-ccc063331108/scratchpad';
const { createFixtureKit } = await import(pathToFileURL(path.join(stagingDir, 'journeys/fixture-kit.mjs')).href);
const K = await import(pathToFileURL(path.join(stagingDir, 'hosted-lovable-kiosk.mjs')).href);

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
const manifestFile = `${S}/real619/cleanup-${runTag}.json`;
const fixtures = createFixtureKit({ projectId: PROJECT, apiKey: 'fake-api-key', token: 'owner', runTag, cleanupManifest: manifestFile, fetchImpl, functionsBase: FN });

const results = [];
const check = (name, ok, seen) => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${seen ? `  — ${seen}` : ''}`); };

async function snapshot() {
  const r = await fetch(`${DOCS}:listCollectionIds`, { method: 'POST', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: '{}' });
  const ids = (await r.json()).collectionIds ?? [];
  const out = new Map();
  const walk = async (parent, id) => {
    let token = '';
    do {
      const l = await (await fetch(`${DOCS}${parent}/${id}?pageSize=300${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`, { headers: { authorization: 'Bearer owner' } })).json();
      for (const d of l.documents ?? []) out.set(d.name.split('/documents/')[1], d.updateTime);
      token = l.nextPageToken ?? '';
    } while (token);
  };
  for (const id of ids) await walk('', id);
  // one level of subcollections under the goal (recentAdditions)
  for (const k of [...out.keys()].filter((p) => /^wsfGoals\/[^/]+$/.test(p))) {
    const sub = await (await fetch(`${DOCS}/${k}:listCollectionIds`, { method: 'POST', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: '{}' })).json();
    for (const sid of sub.collectionIds ?? []) await walk(`/${k}`, sid);
  }
  return out;
}
const diff = (a, b) => ({ added: [...b.keys()].filter((k) => !a.has(k)), changed: [...b.keys()].filter((k) => a.has(k) && a.get(k) !== b.get(k)), removed: [...a.keys()].filter((k) => !b.has(k)) });
async function idTokenOf(acct) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: acct.email, password: acct.password, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error('sign-in failed');
  return j.idToken;
}
/** An exchange as the harness's callableLog reads it: { name, data, result, error }. */
async function ex(name, data, idToken) {
  const headers = { 'content-type': 'application/json', ...(idToken ? { authorization: `Bearer ${idToken}` } : {}) };
  const res = await fetch(`${FN}/${name}`, { method: 'POST', headers, body: JSON.stringify({ data }) });
  let parsed = null;
  try { parsed = JSON.parse(await res.text()); } catch { /* null */ }
  const error = parsed?.error?.status ?? (res.ok ? undefined : `HTTP_${res.status}`);
  return { name, data, result: error ? undefined : parsed?.result ?? null, error };
}
const ALIAS = K.LINE_ALIAS;

// ---- fixtures: the exact event the harness builds -----------------------------------------------------------------------
const ev = await fixtures.expoEvent('lk', { attendees: 1, target: 1000, seeded: 100, joinPolicy: 'public' });
const m = ev.attendees[0];
const tokM = await idTokenOf(m);
// the station: pairing, the Champion's approval (the kit), the claim - as the bound kiosk's own page does it
const pr = await ex('wsfStationRequestPairing', { goalId: ev.goalId });
await fixtures.approveStation(ev, pr.result.code, 1);
const cl = await ex('wsfStationClaimPairing', { pairingId: pr.result.pairingId });
const st = { stationId: cl.result.stationId, secret: cl.result.secret };
const stationState = () => ex('wsfTurnState', st);

const s0 = await snapshot();

// ---- queue-place --------------------------------------------------------------------------------------------------------
const qrJoin = await ex('wsfJoinCommunity', { joinCode: ev.joinCode }, tokM);
const sQr = await snapshot();
check('real: the control (a member) opening the kiosk QR gets alreadyMember true and writes NOTHING', qrJoin.result?.alreadyMember === true && qrJoin.result.groupId === ev.groupId && diff(s0, sQr).added.length === 0 && diff(s0, sQr).changed.length === 0);
const join1 = await ex('wsfJoinTurnLine', { goalId: ev.goalId, calledName: ALIAS }, tokM);
const place = join1.result;
check('real: wsfJoinTurnLine answers entryId/code/calledName/status/goalId/alreadyInLine in the shape the verdict reads', place && ['entryId', 'code', 'calledName', 'status', 'goalId', 'alreadyInLine'].every((k) => k in place) && place.status === 'waiting' && place.alreadyInLine === false && place.goalId === ev.goalId, JSON.stringify(Object.keys(place ?? {})));
const join2 = await ex('wsfJoinTurnLine', { goalId: ev.goalId, calledName: ALIAS }, tokM);
check('real: a second join is alreadyInLine true and the same place (the harness\'s FAIL case is real)', join2.result?.alreadyInLine === true && join2.result.entryId === place.entryId);
const trackedEntry = await fixtures.trackPlace(ev, m);
check('real: the kit\'s trackPlace returns exactly the entry the join answered', trackedEntry === place.entryId);
const hall1 = await stationState();
check('real: the station\'s wsfTurnState counts 1 waiting and holds nobody', hall1.result?.waitingCount === 1 && hall1.result.assigned === null && hall1.result.result === null);
const qp = K.queuePlaceVerdict({ qrJoin, joins: [join1, join2].slice(0, 1), goalId: ev.goalId, phoneLine: 'waiting', phoneText: `You are in line. Code ${place.code}. Please wait.`, stationWaiting: hall1.result.waitingCount, trackedEntry });
check('verdict: queuePlaceVerdict PASSES on the real exchanges (screen inputs stood in)', qp.ok, qp.seen.slice(0, 80));
const qpBad = K.queuePlaceVerdict({ qrJoin, joins: [join1, join2], goalId: ev.goalId, phoneLine: 'waiting', phoneText: `Code ${place.code}.`, stationWaiting: 1, trackedEntry });
check('verdict: two real join requests FAIL queue-place (a second tap is caught)', !qpBad.ok);

// ---- call ---------------------------------------------------------------------------------------------------------------
const call = await ex('wsfCallNext', st);
const asg = call.result?.assigned;
check('real: wsfCallNext answers called true and assigned {calledName, code, state:assigned, turnRef}', call.result?.called === true && asg?.calledName === ALIAS && asg.code === place.code && asg.state === 'assigned' && K.TURN_REF.test(String(asg.turnRef)));
const turnRef = asg?.turnRef;
const cv = K.callVerdict({ calls: [call], place, heading: `Calling ${ALIAS}`, phoneLine: 'assigned', phoneText: `The kiosk is calling ${ALIAS}. Tap I’m here.` });
check('verdict: callVerdict PASSES on the real call', cv.ok, cv.seen.slice(0, 70));
const cvNoRef = K.callVerdict({ calls: [{ ...call, result: { ...call.result, assigned: { ...asg, turnRef: null } } }], place, heading: `Calling ${ALIAS}`, phoneLine: 'assigned', phoneText: `is calling ${ALIAS}.` });
check('verdict: the same call with its turnRef removed FAILS', !cvNoRef.ok);

// ---- phone-ready --------------------------------------------------------------------------------------------------------
const ready = await ex('wsfTurnReady', { entryId: place.entryId }, tokM);
const hall2 = await stationState();
check('real: wsfTurnReady answers status ready; the station\'s line then shows THIS turn ready with the same turnRef', ready.result?.status === 'ready' && hall2.result?.assigned?.state === 'ready' && hall2.result.assigned.turnRef === turnRef);
const rv = K.readyVerdict({ readies: [ready], place, turnRef, hall: hall2.result, heading: `${ALIAS} is here`, startShown: true });
check('verdict: readyVerdict PASSES on the real exchanges', rv.ok, rv.seen.slice(0, 70));

// ---- expected-turn-start ------------------------------------------------------------------------------------------------
const before = await snapshot();
const noRef = await ex('wsfStartTurn', st);
const wrongRef = await ex('wsfStartTurn', { ...st, expectedTurn: `tr_${'A'.repeat(22)}` });
const afterNeg = await snapshot();
const hallNeg = await stationState();
check('real: a Start with NO expectedTurn is refused (an older station path cannot start a turn)', noRef.error !== undefined && !noRef.result, noRef.error);
check('real: a Start with ANOTHER turn\'s binding does not start the called turn', !(wrongRef.result?.started === true) && hallNeg.result?.assigned?.state === 'ready', wrongRef.error ?? `started=${wrongRef.result?.started}`);
check('real: neither refused Start wrote anything', diff(before, afterNeg).added.length === 0 && diff(before, afterNeg).changed.length === 0);
const start = await ex('wsfStartTurn', { ...st, expectedTurn: turnRef });
check('real: the Start carrying the called turn\'s binding answers started true and that turn active', start.result?.started === true && start.result.assigned?.turnRef === turnRef && start.result.assigned.state === 'active');
const sv = K.startVerdict({ starts: [start], turnRef, phase: 'countdown' });
check('verdict: startVerdict PASSES on the real Start', sv.ok, sv.seen.slice(0, 70));
const svNo = K.startVerdict({ starts: [noRef.error ? { name: 'wsfStartTurn', data: {}, error: noRef.error } : noRef], turnRef, phase: 'countdown' });
check('verdict: startVerdict FAILS a Start with no expectedTurn (named an older path)', !svNo.ok && /older station path/.test(svNo.seen));
let trackErr = null;
try { await fixtures.trackStationTurn(ev, m, place.entryId); } catch (e) { trackErr = String(e?.message ?? e); }
console.log(`      (kit trackStationTurn after the Start: ${trackErr ?? 'tracked an attempt'})`);

// ---- round-60s / review: the only server-visible facts are "nothing is written while the round runs" --------------------
const sRound0 = await snapshot();
await new Promise((r) => setTimeout(r, 4000)); // a short stand-in for the round; the 60 s is the station's own clock
const hallRound = await stationState();
const sRound1 = await snapshot();
check('real: while the turn is active, polling the station writes nothing (no completion is sent by the server on its own)', diff(sRound0, sRound1).added.length === 0 && diff(sRound0, sRound1).changed.length === 0 && hallRound.result?.assigned?.state === 'active');

// ---- station-finish: the phone leaves an ACTIVE turn ----------------------------------------------------------------------
const sPreLeave = await snapshot();
const leave = await ex('wsfLeaveTurnLine', { entryId: place.entryId }, tokM);
const hall3 = await stationState();
const sPost = await snapshot();
const dLeave = diff(sPreLeave, sPost); console.log('      leave diff:', JSON.stringify({ added: dLeave.added.map((p) => p.replace(/[A-Za-z0-9_-]{20,}/g, '<id>')), changed: dLeave.changed.map((p) => p.replace(/[A-Za-z0-9_-]{20,}/g, '<id>')), removed: dLeave.removed.map((p) => p.replace(/[A-Za-z0-9_-]{20,}/g, '<id>')) }));
check('real: wsfLeaveTurnLine on an ACTIVE turn answers status left (the packet\'s section 2 claim)', leave.result?.status === 'left' && leave.result.entryId === place.entryId, leave.error);
check('real: afterwards the station holds no turn and no result and counts 0 waiting', hall3.result?.assigned === null && hall3.result?.result === null && hall3.result?.waitingCount === 0);
const dAll = diff(s0, sPost);
const contribDocs = [...dAll.added, ...dAll.changed].filter((p) => /ontribution|MemberTotals|recentAdditions|GoalShards|Shard/i.test(p));
check('real: the whole turn wrote NO contribution of any kind (no ledger row, member total, recent addition or shard)', contribDocs.length === 0, `${[...dAll.added, ...dAll.changed].length} docs touched`);
check('real: the leave is one line change: it adds nothing, updates the entry and the station, and removes only the member\'s one-place lock (a tracked doc; cleanup counts an absent doc as already gone)', dLeave.added.length === 0 && dLeave.changed.every((p) => /^wsfTurnEntries\//.test(p) || /^wsfKioskStations\//.test(p)) && dLeave.removed.every((p) => /^wsfTurnMembers\//.test(p)), JSON.stringify({ changed: dLeave.changed.map((p) => p.replace(/\/.*/, '/…')), removed: dLeave.removed.map((p) => p.replace(/\/.*/, '/…')) }));
const mark = { turnContributions: [] };
const fv = K.finishVerdict({ leaves: [leave], place, end: 'ended', endText: 'Turn ended', phase: 'idle', callNextShown: true, stationText: 'Call next 0 waiting', hall: hall3.result, turnContributions: mark.turnContributions });
check('verdict: finishVerdict PASSES on the real leave and the real post-leave station state', fv.ok, fv.seen.slice(0, 70));

// ---- cleanup completeness: every document the turn created is in the kit's manifest --------------------------------------
const man = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const listed = new Set([...(man.docs ?? []), ...((man.linkedDocs ?? []).map((l) => l.path))]);
const created = [...dAll.added].filter((p) => !p.startsWith('wsfRateLimits') );
const orphan = created.filter((p) => !listed.has(p));
check('cleanup: every document created since the event was made (the whole turn) is covered by the kit\'s manifest', orphan.length === 0, orphan.length ? `NOT covered: ${orphan.map((p) => p.replace(/[A-Za-z0-9_-]{20,}/g, '<id>')).join(', ')}` : `${created.length} created, all covered`);
// the same, for the documents the TURN itself added (after the QR step)
const turnAdded = diff(sQr, sPost).added;
const turnOrphan = turnAdded.filter((p) => !listed.has(p));
check('cleanup: the documents the turn added are covered', turnOrphan.length === 0, `${turnAdded.length} added: ${turnAdded.map((p) => p.split('/')[0]).join(', ')}${turnOrphan.length ? `; NOT covered: ${turnOrphan.map((p) => p.split('/')[0]).join(', ')}` : ''}`);

const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} passed${bad.length ? `; FAILED: ${bad.map((r) => r.name).join(' | ')}` : ''}`);
process.exit(bad.length ? 1 : 0);
```

## Instrument 2: `mut619.mjs`

```js
// W7 Check 87 instrument: fixed-purpose mutants of #619 (the station-turn driver), one edit at a time in a scratch worktree, judged by the
// PR's own kiosk suite; restored after each. usage: node mut619.mjs <worktree root>
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const root = process.argv[2];
const K = `${root}/.github/wsf-staging/hosted-lovable-kiosk.mjs`;
const KT = `${root}/.github/wsf-staging/tests/hosted-lovable-kiosk.test.mjs`;
const orig = fs.readFileSync(K, 'utf8');
const M = [
  // queue-place
  ['Q1 qr join: alreadyMember not required', "if (qrJoin?.result?.alreadyMember !== true) bad.push(", "if (false) bad.push("],
  ['Q2 more than one line join allowed', "if (joins.length !== 1) bad.push(`${joins.length} line join request(s)`);", ""],
  ['Q3 another goal/name accepted', "if (j && (j.data?.goalId !== goalId || j.data?.calledName !== LINE_ALIAS)) bad.push('the line join names another goal or another name');", ""],
  ['Q4 status waiting not required', "r.status !== 'waiting' || r.alreadyInLine !== false || r.goalId !== goalId", "r.alreadyInLine !== false || r.goalId !== goalId"],
  ['Q5 alreadyInLine not required false', "r.status !== 'waiting' || r.alreadyInLine !== false || r.goalId !== goalId", "r.status !== 'waiting' || r.goalId !== goalId"],
  ['Q6 answer for another goal accepted', "r.status !== 'waiting' || r.alreadyInLine !== false || r.goalId !== goalId", "r.status !== 'waiting' || r.alreadyInLine !== false"],
  ['Q7 line code shape not checked', "if (!TURN_CODE.test(String(r.code ?? ''))) bad.push('the answer carries no line code');", ""],
  ['Q8 untracked place accepted', "if (trackedEntry !== r.entryId) bad.push('the place is not tracked for cleanup');", ""],
  ['Q9 phone code not required on screen', "String(phoneText ?? '').includes(`Code ${r.code}.`)", "true"],
  ['Q10 station may count any number waiting', "if (stationWaiting !== 1) bad.push(", "if (stationWaiting === null) bad.push("],
  // call
  ['C1 several Call next allowed', "if (calls.length !== 1) bad.push(`${calls.length} Call next request(s)`);", ""],
  ['C2 called:true not required', "if (c?.result?.called !== true) bad.push(", "if (false) bad.push("],
  ['C3 another code accepted', "a.code !== place?.code || ", ""],
  ['C4 state not required assigned', "a.state !== 'assigned' || !TURN_REF.test", "!TURN_REF.test"],
  ['C5 turn binding not required', "|| !TURN_REF.test(String(a.turnRef ?? ''))) {\n    bad.push(`the called turn", ") {\n    bad.push(`the called turn"],
  ['C6 station heading not required', "if (heading !== `Calling ${LINE_ALIAS}`) bad.push(", "if (false) bad.push("],
  ['C7 phone line not required assigned', "if (phoneLine !== 'assigned' || !String(phoneText ?? '').includes(`is calling ${LINE_ALIAS}.`)) bad.push(", "if (false) bad.push("],
  // ready
  ['R1 several I\'m here allowed', "if (readies.length !== 1) bad.push(", "if (false) bad.push("],
  ['R2 another place accepted', "if (x && x.data?.entryId !== place?.entryId) bad.push('I\\'m here names another place');", ""],
  ['R3 ready status not required', "if (x?.result?.status !== 'ready') bad.push(", "if (false) bad.push("],
  ['R4 station hall may show another turn', "if (!a || a.state !== 'ready' || a.turnRef !== turnRef) bad.push(", "if (!a || a.state !== 'ready') bad.push("],
  ['R5 station hall state not required ready', "if (!a || a.state !== 'ready' || a.turnRef !== turnRef) bad.push(", "if (!a || a.turnRef !== turnRef) bad.push("],
  ['R6 Start button not required', "if (heading !== `${LINE_ALIAS} is here` || !startShown) bad.push(", "if (heading !== `${LINE_ALIAS} is here`) bad.push("],
  // expected-turn-start
  ['S1 several Starts allowed', "if (starts.length !== 1) bad.push(`${starts.length} Start request(s)`);", ""],
  ['S2 missing expectedTurn accepted', "if (!d || !Object.hasOwn(d, 'expectedTurn')) bad.push(", "if (false) bad.push("],
  ['S3 expectedTurn shape not checked', "else if (!TURN_REF.test(String(d.expectedTurn ?? ''))) bad.push(", "else if (false) bad.push("],
  ['S4 expectedTurn may differ from called turn', "else if (d.expectedTurn !== turnRef) bad.push(", "else if (false) bad.push("],
  ['S5 started:true not required', "if (s.result?.started !== true || !a ||", "if (!a ||"],
  ['S6 answer for another turn accepted', "a.turnRef !== d?.expectedTurn || a.state !== 'active'", "a.state !== 'active'"],
  ['S7 answer state not required active', "a.turnRef !== d?.expectedTurn || a.state !== 'active'", "a.turnRef !== d?.expectedTurn"],
  ['S8 station phase not required', "if (phase !== 'countdown' && phase !== 'active') bad.push(`the station shows the ${phase ?? 'missing'} phase`);\n  return verdict(bad, 'one Start", "return verdict(bad, 'one Start"],
  // round
  ['T1 timer opening not required 60s', "if (firstTimer !== `${60}s`) bad.push(", "if (false) bad.push("],
  ['T2 review phase not required', "if (phase !== 'review') bad.push(`the round ended in the ${phase ?? 'missing'} phase`);\n  else if", "if (false) bad.push('x');\n  else if"],
  ['T3 round minimum 58s -> 30s', "export const ROUND_MIN_MS = 58_000;", "export const ROUND_MIN_MS = 30_000;"],
  ['T4 round minimum 58s -> 62s', "export const ROUND_MIN_MS = 58_000;", "export const ROUND_MIN_MS = 62_000;"],
  ['T5 writes ignored', "if (writes.length) bad.push(", "if (false) bad.push("],
  ['T6 Complete not a write', "'wsfContribute', 'wsfCompleteTurn', 'wsfCompleteMyTurn', 'wsfCancelTurn',", "'wsfContribute', 'wsfCompleteMyTurn', 'wsfCancelTurn',"],
  ['T7 phone Complete not a write', "'wsfContribute', 'wsfCompleteTurn', 'wsfCompleteMyTurn', 'wsfCancelTurn',", "'wsfContribute', 'wsfCompleteTurn', 'wsfCancelTurn',"],
  ['T8 Cancel not a write', "'wsfCompleteMyTurn', 'wsfCancelTurn', 'wsfLeaveTurnLine',", "'wsfCompleteMyTurn', 'wsfLeaveTurnLine',"],
  ['T9 line join not a write', "'wsfTurnReady', 'wsfJoinTurnLine', 'wsfJoinCommunity']", "'wsfTurnReady', 'wsfJoinCommunity']"],
  ['T10 settle after the round removed', "await kiosk.waitForTimeout(3000); // what a timer end would send has been sent", ""],
  ['T11 round writes counted from the turn start, not the Start', "const roundFrom = { k: logK.mark(), p: logP.mark() };", "const roundFrom = { k: 0, p: 0 };"],
  // review
  ['V1 review phase not required', "if (phase !== 'review') bad.push(`the station shows the ${phase ?? 'missing'} phase`);\n  if (heading !== 'Review the count')", "if (heading !== 'Review the count')"],
  ['V2 review heading not required', "if (heading !== 'Review the count') bad.push(", "if (false) bad.push("],
  ['V3 Contribute not required', "if (!countShown || !contributeShown) bad.push(", "if (!countShown) bad.push("],
  ['V4 phone note not required', "if (note !== REVIEW_PHONE_NOTE) bad.push(", "if (false) bad.push("],
  // station-finish
  ['F1 several leaves allowed', "if (leaves.length !== 1) bad.push(`${leaves.length} leave request(s)`);", ""],
  ['F2 another place / switch accepted', "if (l && (l.data?.entryId !== place?.entryId || l.data?.switchingToPhone === true)) bad.push('the leave names another place or switches to the phone');", ""],
  ['F3 left status not required', "if (l && l.result?.status !== 'left') bad.push(", "if (false) bad.push("],
  ['F4 recorded accepted as ended', "if (end !== 'ended' || endText !== 'Turn ended') bad.push(", "if (false) bad.push("],
  ['F5 idle phase not required', "if (phase !== 'idle' || !callNextShown) bad.push(", "if (!callNextShown) bad.push("],
  ['F6 Call next not required', "if (phase !== 'idle' || !callNextShown) bad.push(", "if (phase !== 'idle') bad.push("],
  ['F7 previous name on screen accepted', "if (text.includes(LINE_ALIAS) || (", "if (false || ("],
  ['F8 previous code on screen accepted', "|| (TURN_CODE.test(String(place?.code ?? '')) && new RegExp(`\\\\b${place.code}\\\\b`).test(text))) bad.push(", "|| false) bad.push("],
  ['F9 line still holding a turn accepted', "if (hall?.assigned !== null || hall?.result !== null) bad.push(", "if (false) bad.push("],
  ['F10 contributions since the turn ignored', "if (turnContributions.length) bad.push(", "if (false) bad.push("],
  ['F11 station Complete not a contribution', "export const CONTRIBUTION_WRITES = Object.freeze(['wsfContribute', 'wsfCompleteTurn', 'wsfCompleteMyTurn']);", "export const CONTRIBUTION_WRITES = Object.freeze(['wsfContribute', 'wsfCompleteMyTurn']);"],
  ['F12 phone Complete not a contribution', "export const CONTRIBUTION_WRITES = Object.freeze(['wsfContribute', 'wsfCompleteTurn', 'wsfCompleteMyTurn']);", "export const CONTRIBUTION_WRITES = Object.freeze(['wsfContribute', 'wsfCompleteTurn']);"],
  // patterns
  ['P1 code alphabet admits I and O', "const TURN_CODE = /^[A-HJ-NP-Z2-9]{3}$/;", "const TURN_CODE = /^[A-Z2-9]{3}$/;"],
  ['P2 code length 3 -> 2..4', "const TURN_CODE = /^[A-HJ-NP-Z2-9]{3}$/;", "const TURN_CODE = /^[A-HJ-NP-Z2-9]{2,4}$/;"],
  ['P3 binding floor 16 -> 1', "export const TURN_REF = /^tr_[A-Za-z0-9_-]{16,64}$/;", "export const TURN_REF = /^tr_[A-Za-z0-9_-]{1,64}$/;"],
  ['P4 binding ceiling 64 -> 200', "export const TURN_REF = /^tr_[A-Za-z0-9_-]{16,64}$/;", "export const TURN_REF = /^tr_[A-Za-z0-9_-]{16,200}$/;"],
  // driver wiring
  ['D1 no guard.check on the control\'s join page', "await phone.goto(joinUrl);\n  guard.check(); // nothing is typed into a page that loaded anything unreviewed\n", "await phone.goto(joinUrl);\n"],
  ['D2 trackPlace never called', "try { trackedEntry = await fixtures.trackPlace(ev, m); } catch { trackedEntry = null; }", "trackedEntry = place.entryId;"],
  ['D3 trackStationTurn never called', "try { await fixtures.trackStationTurn(ev, m, place.entryId); } catch { /* no attempt was minted: a turn that never started writes nothing */ }", ""],
  ['D4 not waiting for the station to count the place', "await wait(kiosk, async () => logK.since(beforeJoin).some((x) => x.name === 'wsfTurnState' && x.result?.waitingCount >= 1), 20_000);", ""],
  ['D5 not waiting for the station to show ready', "await wait(kiosk, async () => hall()?.assigned?.state === 'ready' && (await heading()) === `${LINE_ALIAS} is here` && visible(startButton), 20_000);", ""],
  ['D6 round loop never reads the first timer', "firstTimer = await textOf(timer); }", "firstTimer = `${60}s`; }"],
  ['D7 leave pressed before the review is measured', "const rw = reviewVerdict(", "await phone.getByRole('button', { name: 'Leave line', exact: true }).click(); const rw = reviewVerdict("],
  ['D8 station rows left out of the stopped list', "'account-isolation', ...STATION_ROWS]", "'account-isolation']"],
  ['D9 the journey ignores the injected clock', "export async function runJourney({ browser, fixtures, base, amount = 7, reviewed = REVIEWED_BUILD, now = () => Date.now() }) {", "export async function runJourney({ browser, fixtures, base, amount = 7, reviewed = REVIEWED_BUILD }) { const now = () => Date.now();"],
  ['D10 cli drops the injected clock', "journey = await runJourney({ browser, fixtures, base: b.base, reviewed, now });", "journey = await runJourney({ browser, fixtures, base: b.base, reviewed });"],
  ['D11 station turn never driven', "await driveStationTurn({ kiosk, logK, phone: pageM2, logP: logM2, joinUrl, ev, m, fixtures, guard, rows, set, now });", ""],
  ['D12 station turn driven on the kiosk page for the phone', "await driveStationTurn({ kiosk, logK, phone: pageM2, logP: logM2, joinUrl, ev, m, fixtures, guard, rows, set, now });", "await driveStationTurn({ kiosk, logK, phone: pageM2, logP: logK, joinUrl, ev, m, fixtures, guard, rows, set, now });"],
  ['D13 no QR: station rows not failed by name', "if (!joinUrl) { notReached(set, rows, 'queue-place',", "if (!joinUrl) { if (false) notReached(set, rows, 'queue-place',"],
  ['D14 no panel: station rows not failed by name', "if (!(await visible(panel))) { notReached(set, rows, 'queue-place',", "if (!(await visible(panel))) { if (false) notReached(set, rows, 'queue-place',"],
  ['D15 FIXED_BLOCKED restored for the station rows (BLOCKED, not FAIL)', "export const FIXED_BLOCKED = Object.freeze({\n  'unverified-account'", "export const FIXED_BLOCKED = Object.freeze({\n  'queue-place': 'x', call: 'x', 'phone-ready': 'x', 'expected-turn-start': 'x', 'round-60s': 'x', review: 'x', 'station-finish': 'x',\n  'unverified-account'"],
];
let killed = 0; const survived = [], unapplied = [];
for (const [name, find, rep] of M) {
  const n = orig.split(find).length - 1;
  if (n !== 1) { unapplied.push(`${name} (${n}x)`); continue; }
  fs.writeFileSync(K, orig.replace(find, () => rep));
  const r = spawnSync(process.execPath, [KT], { cwd: root, encoding: 'utf8', timeout: 300_000 });
  fs.writeFileSync(K, orig);
  const dead = r.status !== 0;
  console.log(`${dead ? 'KILLED  ' : 'SURVIVED'} ${name}`);
  if (dead) killed++; else survived.push(name);
}
console.log(`\n${killed}/${M.length - unapplied.length} killed; survivors: ${survived.length ? survived.join(' | ') : 'none'}; unapplied: ${unapplied.length ? unapplied.join(' | ') : 'none'}`);
fs.writeFileSync(K, orig);
```

## Instrument 3: `mut619s.mjs`

```js
// W7 Check 87 instrument: fixed-purpose mutants of #619 (the station-turn driver), one edit at a time in a scratch worktree, judged by the
// PR's own kiosk suite; restored after each. usage: node mut619.mjs <worktree root>
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const root = process.argv[2];
const K = `${root}/.github/wsf-staging/hosted-lovable-kiosk.mjs`;
const KT = `${root}/.github/wsf-staging/tests/hosted-lovable-kiosk.test.mjs`;
const orig = fs.readFileSync(K, 'utf8');
const M = [
  // queue-place
  ['Q1 qr join: alreadyMember not required', "if (qrJoin?.result?.alreadyMember !== true) bad.push(", "if (false) bad.push("],
  ['Q2 more than one line join allowed', "if (joins.length !== 1) bad.push(`${joins.length} line join request(s)`);", ""],
  ['Q3 another goal/name accepted', "if (j && (j.data?.goalId !== goalId || j.data?.calledName !== LINE_ALIAS)) bad.push('the line join names another goal or another name');", ""],
  ['Q4 status waiting not required', "r.status !== 'waiting' || r.alreadyInLine !== false || r.goalId !== goalId", "r.alreadyInLine !== false || r.goalId !== goalId"],
  ['Q5 alreadyInLine not required false', "r.status !== 'waiting' || r.alreadyInLine !== false || r.goalId !== goalId", "r.status !== 'waiting' || r.goalId !== goalId"],
  ['Q6 answer for another goal accepted', "r.status !== 'waiting' || r.alreadyInLine !== false || r.goalId !== goalId", "r.status !== 'waiting' || r.alreadyInLine !== false"],
  ['Q7 line code shape not checked', "if (!TURN_CODE.test(String(r.code ?? ''))) bad.push('the answer carries no line code');", ""],
  ['Q8 untracked place accepted', "if (trackedEntry !== r.entryId) bad.push('the place is not tracked for cleanup');", ""],
  ['Q9 phone code not required on screen', "String(phoneText ?? '').includes(`Code ${r.code}.`)", "true"],
  ['Q10 station may count any number waiting', "if (stationWaiting !== 1) bad.push(", "if (stationWaiting === null) bad.push("],
  // call
  ['C1 several Call next allowed', "if (calls.length !== 1) bad.push(`${calls.length} Call next request(s)`);", ""],
  ['C2 called:true not required', "if (c?.result?.called !== true) bad.push(", "if (false) bad.push("],
  ['C3 another code accepted', "a.code !== place?.code || ", ""],
  ['C4 state not required assigned', "a.state !== 'assigned' || !TURN_REF.test", "!TURN_REF.test"],
  ['C5 turn binding not required', "|| !TURN_REF.test(String(a.turnRef ?? ''))) {\n    bad.push(`the called turn", ") {\n    bad.push(`the called turn"],
  ['C6 station heading not required', "if (heading !== `Calling ${LINE_ALIAS}`) bad.push(", "if (false) bad.push("],
  ['C7 phone line not required assigned', "if (phoneLine !== 'assigned' || !String(phoneText ?? '').includes(`is calling ${LINE_ALIAS}.`)) bad.push(", "if (false) bad.push("],
  // ready
  ['R1 several I\'m here allowed', "if (readies.length !== 1) bad.push(", "if (false) bad.push("],
  ['R2 another place accepted', "if (x && x.data?.entryId !== place?.entryId) bad.push('I\\'m here names another place');", ""],
  ['R3 ready status not required', "if (x?.result?.status !== 'ready') bad.push(", "if (false) bad.push("],
  ['R4 station hall may show another turn', "if (!a || a.state !== 'ready' || a.turnRef !== turnRef) bad.push(", "if (!a || a.state !== 'ready') bad.push("],
  ['R5 station hall state not required ready', "if (!a || a.state !== 'ready' || a.turnRef !== turnRef) bad.push(", "if (!a || a.turnRef !== turnRef) bad.push("],
  ['R6 Start button not required', "if (heading !== `${LINE_ALIAS} is here` || !startShown) bad.push(", "if (heading !== `${LINE_ALIAS} is here`) bad.push("],
  // expected-turn-start
  ['S1 several Starts allowed', "if (starts.length !== 1) bad.push(`${starts.length} Start request(s)`);", ""],
  ['S2 missing expectedTurn accepted', "if (!d || !Object.hasOwn(d, 'expectedTurn')) bad.push(", "if (false) bad.push("],
  ['S3 expectedTurn shape not checked', "else if (!TURN_REF.test(String(d.expectedTurn ?? ''))) bad.push(", "else if (false) bad.push("],
  ['S4 expectedTurn may differ from called turn', "else if (d.expectedTurn !== turnRef) bad.push(", "else if (false) bad.push("],
  ['S5 started:true not required', "if (s.result?.started !== true || !a ||", "if (!a ||"],
  ['S6 answer for another turn accepted', "a.turnRef !== d?.expectedTurn || a.state !== 'active'", "a.state !== 'active'"],
  ['S7 answer state not required active', "a.turnRef !== d?.expectedTurn || a.state !== 'active'", "a.turnRef !== d?.expectedTurn"],
  ['S8 station phase not required', "if (phase !== 'countdown' && phase !== 'active') bad.push(`the station shows the ${phase ?? 'missing'} phase`);\n  return verdict(bad, 'one Start", "return verdict(bad, 'one Start"],
  // round
  ['T1 timer opening not required 60s', "if (firstTimer !== `${60}s`) bad.push(", "if (false) bad.push("],
  ['T2 review phase not required', "if (phase !== 'review') bad.push(`the round ended in the ${phase ?? 'missing'} phase`);\n  else if", "if (false) bad.push('x');\n  else if"],
  ['T3 round minimum 58s -> 30s', "export const ROUND_MIN_MS = 58_000;", "export const ROUND_MIN_MS = 30_000;"],
  ['T4 round minimum 58s -> 62s', "export const ROUND_MIN_MS = 58_000;", "export const ROUND_MIN_MS = 62_000;"],
  ['T5 writes ignored', "if (writes.length) bad.push(", "if (false) bad.push("],
  ['T6 Complete not a write', "'wsfContribute', 'wsfCompleteTurn', 'wsfCompleteMyTurn', 'wsfCancelTurn',", "'wsfContribute', 'wsfCompleteMyTurn', 'wsfCancelTurn',"],
  ['T7 phone Complete not a write', "'wsfContribute', 'wsfCompleteTurn', 'wsfCompleteMyTurn', 'wsfCancelTurn',", "'wsfContribute', 'wsfCompleteTurn', 'wsfCancelTurn',"],
  ['T8 Cancel not a write', "'wsfCompleteMyTurn', 'wsfCancelTurn', 'wsfLeaveTurnLine',", "'wsfCompleteMyTurn', 'wsfLeaveTurnLine',"],
  ['T9 line join not a write', "'wsfTurnReady', 'wsfJoinTurnLine', 'wsfJoinCommunity']", "'wsfTurnReady', 'wsfJoinCommunity']"],
  ['T10 settle after the round removed', "await kiosk.waitForTimeout(3000); // what a timer end would send has been sent", ""],
  ['T11 round writes counted from the turn start, not the Start', "const roundFrom = { k: logK.mark(), p: logP.mark() };", "const roundFrom = { k: 0, p: 0 };"],
  // review
  ['V1 review phase not required', "if (phase !== 'review') bad.push(`the station shows the ${phase ?? 'missing'} phase`);\n  if (heading !== 'Review the count')", "if (heading !== 'Review the count')"],
  ['V2 review heading not required', "if (heading !== 'Review the count') bad.push(", "if (false) bad.push("],
  ['V3 Contribute not required', "if (!countShown || !contributeShown) bad.push(", "if (!countShown) bad.push("],
  ['V4 phone note not required', "if (note !== REVIEW_PHONE_NOTE) bad.push(", "if (false) bad.push("],
  // station-finish
  ['F1 several leaves allowed', "if (leaves.length !== 1) bad.push(`${leaves.length} leave request(s)`);", ""],
  ['F2 another place / switch accepted', "if (l && (l.data?.entryId !== place?.entryId || l.data?.switchingToPhone === true)) bad.push('the leave names another place or switches to the phone');", ""],
  ['F3 left status not required', "if (l && l.result?.status !== 'left') bad.push(", "if (false) bad.push("],
  ['F4 recorded accepted as ended', "if (end !== 'ended' || endText !== 'Turn ended') bad.push(", "if (false) bad.push("],
  ['F5 idle phase not required', "if (phase !== 'idle' || !callNextShown) bad.push(", "if (!callNextShown) bad.push("],
  ['F6 Call next not required', "if (phase !== 'idle' || !callNextShown) bad.push(", "if (phase !== 'idle') bad.push("],
  ['F7 previous name on screen accepted', "if (text.includes(LINE_ALIAS) || (", "if (false || ("],
  ['F8 previous code on screen accepted', "|| (TURN_CODE.test(String(place?.code ?? '')) && new RegExp(`\\\\b${place.code}\\\\b`).test(text))) bad.push(", "|| false) bad.push("],
  ['F9 line still holding a turn accepted', "if (hall?.assigned !== null || hall?.result !== null) bad.push(", "if (false) bad.push("],
  ['F10 contributions since the turn ignored', "if (turnContributions.length) bad.push(", "if (false) bad.push("],
  ['F11 station Complete not a contribution', "export const CONTRIBUTION_WRITES = Object.freeze(['wsfContribute', 'wsfCompleteTurn', 'wsfCompleteMyTurn']);", "export const CONTRIBUTION_WRITES = Object.freeze(['wsfContribute', 'wsfCompleteMyTurn']);"],
  ['F12 phone Complete not a contribution', "export const CONTRIBUTION_WRITES = Object.freeze(['wsfContribute', 'wsfCompleteTurn', 'wsfCompleteMyTurn']);", "export const CONTRIBUTION_WRITES = Object.freeze(['wsfContribute', 'wsfCompleteTurn']);"],
  // patterns
  ['P1 code alphabet admits I and O', "const TURN_CODE = /^[A-HJ-NP-Z2-9]{3}$/;", "const TURN_CODE = /^[A-Z2-9]{3}$/;"],
  ['P2 code length 3 -> 2..4', "const TURN_CODE = /^[A-HJ-NP-Z2-9]{3}$/;", "const TURN_CODE = /^[A-HJ-NP-Z2-9]{2,4}$/;"],
  ['P3 binding floor 16 -> 1', "export const TURN_REF = /^tr_[A-Za-z0-9_-]{16,64}$/;", "export const TURN_REF = /^tr_[A-Za-z0-9_-]{1,64}$/;"],
  ['P4 binding ceiling 64 -> 200', "export const TURN_REF = /^tr_[A-Za-z0-9_-]{16,64}$/;", "export const TURN_REF = /^tr_[A-Za-z0-9_-]{16,200}$/;"],
  // driver wiring
  ['D1 no guard.check on the control\'s join page', "await phone.goto(joinUrl);\n  guard.check(); // nothing is typed into a page that loaded anything unreviewed\n", "await phone.goto(joinUrl);\n"],
  ['D2 trackPlace never called', "try { trackedEntry = await fixtures.trackPlace(ev, m); } catch { trackedEntry = null; }", "trackedEntry = place.entryId;"],
  ['D3 trackStationTurn never called', "try { await fixtures.trackStationTurn(ev, m, place.entryId); } catch { /* no attempt was minted: a turn that never started writes nothing */ }", ""],
  ['D4 not waiting for the station to count the place', "await wait(kiosk, async () => logK.since(beforeJoin).some((x) => x.name === 'wsfTurnState' && x.result?.waitingCount >= 1), 20_000);", ""],
  ['D5 not waiting for the station to show ready', "await wait(kiosk, async () => hall()?.assigned?.state === 'ready' && (await heading()) === `${LINE_ALIAS} is here` && visible(startButton), 20_000);", ""],
  ['D6 round loop never reads the first timer', "firstTimer = await textOf(timer); }", "firstTimer = `${60}s`; }"],
  ['D7 leave pressed before the review is measured', "const rw = reviewVerdict(", "await phone.getByRole('button', { name: 'Leave line', exact: true }).click(); const rw = reviewVerdict("],
  ['D8 station rows left out of the stopped list', "'account-isolation', ...STATION_ROWS]", "'account-isolation']"],
  ['D9 the journey ignores the injected clock', "export async function runJourney({ browser, fixtures, base, amount = 7, reviewed = REVIEWED_BUILD, now = () => Date.now() }) {", "export async function runJourney({ browser, fixtures, base, amount = 7, reviewed = REVIEWED_BUILD }) { const now = () => Date.now();"],
  ['D10 cli drops the injected clock', "journey = await runJourney({ browser, fixtures, base: b.base, reviewed, now });", "journey = await runJourney({ browser, fixtures, base: b.base, reviewed });"],
  ['D11 station turn never driven', "await driveStationTurn({ kiosk, logK, phone: pageM2, logP: logM2, joinUrl, ev, m, fixtures, guard, rows, set, now });", ""],
  ['D12 station turn driven on the kiosk page for the phone', "await driveStationTurn({ kiosk, logK, phone: pageM2, logP: logM2, joinUrl, ev, m, fixtures, guard, rows, set, now });", "await driveStationTurn({ kiosk, logK, phone: pageM2, logP: logK, joinUrl, ev, m, fixtures, guard, rows, set, now });"],
  ['D13 no QR: station rows not failed by name', "if (!joinUrl) { notReached(set, rows, 'queue-place',", "if (!joinUrl) { if (false) notReached(set, rows, 'queue-place',"],
  ['D14 no panel: station rows not failed by name', "if (!(await visible(panel))) { notReached(set, rows, 'queue-place',", "if (!(await visible(panel))) { if (false) notReached(set, rows, 'queue-place',"],
  ['D15 FIXED_BLOCKED restored for the station rows (BLOCKED, not FAIL)', "export const FIXED_BLOCKED = Object.freeze({\n  'unverified-account'", "export const FIXED_BLOCKED = Object.freeze({\n  'queue-place': 'x', call: 'x', 'phone-ready': 'x', 'expected-turn-start': 'x', 'round-60s': 'x', review: 'x', 'station-finish': 'x',\n  'unverified-account'"],
];
let killed = 0; const survived = [], unapplied = [];
for (const [name, find, rep] of M) {
  const n = orig.split(find).length - 1;
  if (n !== 1) { unapplied.push(`${name} (${n}x)`); continue; }
  fs.writeFileSync(K, orig.replace(find, () => rep));
  const r = spawnSync(process.execPath, ['--check', K], { cwd: root, encoding: 'utf8' });
  fs.writeFileSync(K, orig);
  const dead = r.status === 0; /* here 'dead' means: the mutant PARSES */
  console.log(`${dead ? 'PARSES  ' : 'SYNTAX-ERR'} ${name}`);
  if (dead) killed++; else survived.push(name);
}
console.log(`\n${killed}/${M.length - unapplied.length} killed; survivors: ${survived.length ? survived.join(' | ') : 'none'}; unapplied: ${unapplied.length ? unapplied.join(' | ') : 'none'}`);
fs.writeFileSync(K, orig);
```

## Instrument 4: `fuzz.mjs`

```js
// W7 Check 87 instrument: sentinel fuzz of the seven station verdicts. Whatever is wrong, no verdict text may carry an entry id,
// a turn binding, a line code, a station id/secret, a join code or a uid. Screen text (headings, notes) may be quoted by design.
import { pathToFileURL } from 'node:url';
const K = await import(pathToFileURL(`${process.argv[2]}/hosted-lovable-kiosk.mjs`).href);
const S = { entry: 'ENTRYSENTINEL0123456789abcdef', ref: 'tr_REFSENTINEL0123456789abcdef', code: 'K7Q', sec: 'SECRETSENTINEL0123456789abcdef', sid: 'STATIONSENTINEL0123456789', join: 'JOINSENTINEL0123456789abcd', uid: 'UIDSENTINEL0123456789' };
const SENT = [S.entry, S.ref, S.sec, S.sid, S.join, S.uid, 'tr_REF'];
const A = K.LINE_ALIAS;
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const maybe = (v, alt, p = 0.25) => (rnd() < p ? alt : v);
const place = (p) => ({ entryId: maybe(S.entry, pick([undefined, '', 5]), p), code: maybe(S.code, pick(['ZZ', 'k7q', undefined]), p), goalId: maybe('g1', 'g2', p), status: maybe('waiting', 'assigned', p), alreadyInLine: maybe(false, true, p) });
const ex = (name, data, result, error = null) => ({ name, data: { stationId: S.sid, secret: S.sec, entryId: S.entry, ...data }, result, error });
const texts = [];
const keep = (v) => { texts.push(v.seen); };
for (let i = 0; i < 4000; i++) {
  const p = 0.3;
  const pl = place(p);
  keep(K.queuePlaceVerdict({
    qrJoin: maybe(ex('wsfJoinCommunity', { joinCode: S.join }, { alreadyMember: true, groupId: 'x' }), ex('wsfJoinCommunity', { joinCode: S.join }, null, 'NOT_FOUND'), p),
    joins: pick([[], [ex('wsfJoinTurnLine', { goalId: 'g1', calledName: A }, pl)], [ex('wsfJoinTurnLine', { goalId: 'g1', calledName: 'Other' }, pl, 'UNAUTHENTICATED'), ex('wsfJoinTurnLine', { goalId: 'g1', calledName: A }, pl)]]),
    goalId: 'g1', phoneLine: maybe('waiting', pick([null, 'assigned']), p), phoneText: maybe(`Code ${S.code}.`, `Code ${S.code} ${S.entry}`, p), stationWaiting: maybe(1, pick([0, 2, null]), p), trackedEntry: maybe(S.entry, null, p),
  }));
  const asg = { calledName: maybe(A, 'X', p), code: maybe(S.code, 'AAA', p), state: maybe('assigned', 'ready', p), turnRef: maybe(S.ref, pick([null, 'bad', S.entry]), p) };
  keep(K.callVerdict({ calls: pick([[], [ex('wsfCallNext', {}, { called: true, assigned: asg })], [ex('wsfCallNext', {}, null, 'FAILED_PRECONDITION')], [ex('wsfCallNext', {}, { called: false, assigned: null }), ex('wsfCallNext', {}, { called: true, assigned: asg })]]), place: { entryId: S.entry, code: S.code }, heading: maybe(`Calling ${A}`, "Calling Someone", p), phoneLine: maybe('assigned', null, p), phoneText: maybe(`is calling ${A}.`, 'zzz', p) }));
  keep(K.readyVerdict({ readies: pick([[], [ex('wsfTurnReady', { entryId: maybe(S.entry, 'other', p) }, { status: maybe('ready', 'assigned', p) })]]), place: { entryId: S.entry, code: S.code }, turnRef: S.ref, hall: pick([null, { assigned: { state: maybe('ready', 'assigned', p), turnRef: maybe(S.ref, 'tr_other0000000000000000', p) } }]), heading: maybe(`${A} is here`, 'x', p), startShown: maybe(true, false, p) }));
  const exp = maybe(S.ref, pick([undefined, 'tr_other0000000000000000', S.entry, 'x']), p);
  keep(K.startVerdict({ starts: pick([[], [ex('wsfStartTurn', exp === undefined ? {} : { expectedTurn: exp }, { started: maybe(true, false, p), assigned: { turnRef: maybe(S.ref, 'tr_other0000000000000000', p), state: maybe('active', 'ready', p) } })], [ex('wsfStartTurn', { expectedTurn: S.ref }, null, 'FAILED_PRECONDITION')]]), turnRef: S.ref, phase: pick(['countdown', 'active', 'idle', null]) }));
  keep(K.roundVerdict({ firstTimer: maybe('60s', pick(['30s', null, 'zzz']), p), elapsedMs: pick([null, 1000, 57000, 58000, 61000]), phase: pick(['review', 'active', null]), writes: pick([[], ['wsfCompleteTurn'], ['wsfContribute', 'wsfLeaveTurnLine']]) }));
  keep(K.reviewVerdict({ phase: pick(['review', 'idle', null]), heading: maybe('Review the count', 'x', p), countShown: maybe(true, false, p), contributeShown: maybe(true, false, p), note: maybe(K.REVIEW_PHONE_NOTE, 'x', p) }));
  keep(K.finishVerdict({ leaves: pick([[], [ex('wsfLeaveTurnLine', { entryId: maybe(S.entry, 'o', p), switchingToPhone: maybe(false, true, p) }, { status: maybe('left', 'recorded', p) })], [ex('wsfLeaveTurnLine', {}, null, 'NOT_FOUND')]]), place: { entryId: S.entry, code: S.code }, end: maybe('ended', pick(['recorded', null]), p), endText: maybe('Turn ended', 'x', p), phase: pick(['idle', 'review', null]), callNextShown: maybe(true, false, p), stationText: pick(['Call next', `Call next ${A}`, `Call next ${S.code}`]), hall: pick([{ assigned: null, result: null }, { assigned: { turnRef: S.ref }, result: null }, { assigned: null, result: { code: S.code, amount: 7 } }, null]), turnContributions: pick([[], ['wsfCompleteMyTurn']]) }));
}
const leaks = texts.filter((t) => SENT.some((s) => t.includes(s)) || /\bK7Q\b/.test(t));
const distinct = new Set(texts).size;
console.log(`verdict texts ${texts.length}, distinct ${distinct}; texts carrying an entry id, binding, secret, station id, join code, uid or the line code: ${leaks.length}${leaks.length ? ' e.g. ' + leaks[0].slice(0, 160) : ''}`);
process.exit(leaks.length ? 1 : 0);
```

## Instrument 5: `lens2.mjs`

```js
import { pathToFileURL } from 'node:url';
const K = await import(pathToFileURL(`${process.argv[2]}/hosted-lovable-kiosk.mjs`).href);
const A = K.LINE_ALIAS, ref = 'tr_' + 'a'.repeat(22);
const ex = (name, data, result) => ({ name, data, result, error: null });
const place = { entryId: 'e1', code: 'K7Q', goalId: 'g1', status: 'waiting', alreadyInLine: false };
const pass = {
  'queue-place': K.queuePlaceVerdict({ qrJoin: ex('j', {}, { alreadyMember: true }), joins: [ex('j', { goalId: 'g1', calledName: A }, place)], goalId: 'g1', phoneLine: 'waiting', phoneText: 'Code K7Q.', stationWaiting: 1, trackedEntry: 'e1' }),
  call: K.callVerdict({ calls: [ex('c', {}, { called: true, assigned: { calledName: A, code: 'K7Q', state: 'assigned', turnRef: ref } })], place, heading: `Calling ${A}`, phoneLine: 'assigned', phoneText: `is calling ${A}.` }),
  'phone-ready': K.readyVerdict({ readies: [ex('r', { entryId: 'e1' }, { status: 'ready' })], place, turnRef: ref, hall: { assigned: { state: 'ready', turnRef: ref } }, heading: `${A} is here`, startShown: true }),
  'expected-turn-start': K.startVerdict({ starts: [ex('s', { expectedTurn: ref }, { started: true, assigned: { turnRef: ref, state: 'active' } })], turnRef: ref, phase: 'countdown' }),
  'round-60s': K.roundVerdict({ firstTimer: '60s', elapsedMs: 60000, phase: 'review', writes: [] }),
  review: K.reviewVerdict({ phase: 'review', heading: 'Review the count', countShown: true, contributeShown: true, note: K.REVIEW_PHONE_NOTE }),
  'station-finish': K.finishVerdict({ leaves: [ex('l', { entryId: 'e1' }, { status: 'left' })], place, end: 'ended', endText: 'Turn ended', phase: 'idle', callNextShown: true, stationText: 'Call next', hall: { assigned: null, result: null }, turnContributions: [] }),
};
for (const [id, v] of Object.entries(pass)) {
  const stored = K.results({ [id]: { status: 'PASS', seen: v.seen } }).rows.find((r) => r.id === id).seen;
  console.log(`${id.padEnd(20)} PASS ${v.ok} seen ${String(v.seen.length).padStart(3)} chars, stored ${stored.length}${stored.length < v.seen.length ? `  (cut; stored ends "${stored.slice(-30)}")` : ''}`);
}
```

## Instrument 6: `pin.mjs`

```js
import fs from 'node:fs'; import crypto from 'node:crypto';
for (const [tag, dir] of [['base', 'wt-619b'], ['head', 'wt-619']]) {
  const src = fs.readFileSync(`${dir}/.github/wsf-staging/hosted-lovable-kiosk.mjs`, 'utf8');
  const i = src.indexOf('export const REVIEWED_BUILD');
  const j = src.indexOf('\n});', i) + 4;
  const block = src.slice(i, j);
  console.log(tag, 'REVIEWED_BUILD block bytes', block.length, 'sha256', crypto.createHash('sha256').update(block).digest('hex').slice(0, 16));
}
```
