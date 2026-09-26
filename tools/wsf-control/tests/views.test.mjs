#!/usr/bin/env node
/** The read-only side: worker-view, program-view, reconcile and CURRENT rendering. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { A, B, C, D, E, BASE, build, done, freeze, refused, test } from './helpers.mjs';
import { appendEvent, appendToDir } from '../append.mjs';
import { workerWatch } from '../derive.mjs';
import { reconcile, validateSnapshot, inSubject } from '../reconcile.mjs';
import { renderCurrent, verifyCurrent } from '../render-current.mjs';
import { workerView } from '../worker-view.mjs';
import { programView } from '../program-view.mjs';

const TOOLS = path.resolve('tools/wsf-control');
const run = (script, args) => spawnSync(process.execPath, [path.join(TOOLS, script), ...args], { encoding: 'utf8' });
const add = (r, e) => appendEvent(r.eventsText, { actor: 'Fable', authority: 7000 + r.state.eventCount, ...e });
const chain = (r, ...events) => events.reduce(add, r);
const base = () => build(BASE);
const released = () => add(base(), { type: 'release', packet: 'ALPHA', inbox: 396 });
const delivered = () => add(released(), { type: 'deliver', packet: 'ALPHA', pr: 520, subjectSha: A });
const snap = (extra = {}) => ({ schemaVersion: 1, prs: {}, ...extra });
const openPr = (headSha, more = {}) => ({ state: 'open', merged: false, headSha, ...more });
const kinds = (fs_) => fs_.map((x) => x.kind).sort();

// ---- required: a blocked or reference packet does not keep WATCH on ----
test('WATCH is off with only queued work, on while a packet is released', () => {
  assert.equal(workerWatch(base().state, 'W3'), false);
  assert.equal(workerWatch(released().state, 'W3'), true);
});
test('a blocked packet does not keep WATCH on', () => {
  const r = add(released(), { type: 'block', packet: 'ALPHA', blockedBy: [{ external: 'OWNER-DEVICE', condition: 'device check', owner: 'Owner', unblockWhen: 'owner verdict' }] });
  assert.equal(workerWatch(r.state, 'W3'), false);
  const v = workerView(r.state, 'W3');
  assert.ok(v.includes('WATCH=off'));
  assert.ok(v.includes('ACTIVE_NOW=none'));
  assert.ok(v.includes('BLOCKED=ALPHA (not work; does not keep WATCH on)'));
});
test('a reference packet does not keep WATCH on, even when released', () => {
  const r = add(base(), { type: 'release', packet: 'REF-1', inbox: 400 });
  assert.equal(r.state.packets['REF-1'].phase, 'RELEASED');
  assert.equal(workerWatch(r.state, 'W7'), false);
  assert.ok(workerView(r.state, 'W7').includes('WATCH=off'));
});
test('WATCH stays on while delivered work awaits a near-term review, and goes off on acceptance', () => {
  const r = delivered();
  assert.equal(workerWatch(r.state, 'W3'), true);
  assert.equal(workerWatch(add(r, { type: 'accept', packet: 'ALPHA', subjectSha: A }).state, 'W3'), false);
});

// ---- worker-view ----
test('worker-view prints one ACTIVE NOW, the packets awaiting review, NEXT, WATCH and the authority ids', () => {
  let r = add(delivered(), { type: 'review', packet: 'ALPHA', reviewers: ['Fable', 'W7'] });
  r = add(r, { type: 'release', packet: 'BETA', inbox: 396 });
  const v = workerView(r.state, 'W3');
  const betaReleased = r.state.packets.BETA.authority.released;
  assert.deepEqual(v, [
    'WORKER=W3 inbox=#396',
    'ACTIVE_NOW=BETA phase=RELEASED',
    `AWAITING_REVIEW=ALPHA phase=UNDER_REVIEW pr=#520 subject=${A} reviewers=Fable,W7`,
    'NEXT=none',
    'WATCH=on',
    `AUTHORITY BETA queued=${r.state.packets.BETA.authority.queued} released=${betaReleased} lastDecision=${betaReleased}`,
    `AUTHORITY ALPHA queued=${r.state.packets.ALPHA.authority.queued} released=${r.state.packets.ALPHA.authority.released} lastDecision=${r.state.packets.ALPHA.authority.lastTransition}`,
  ]);
});
test('worker-view shows NEXT from the ordered queue', () => {
  const v = workerView(base().state, 'W3');
  assert.ok(v.includes('ACTIVE_NOW=none'));
  assert.ok(v.includes('NEXT=ALPHA'));
  assert.ok(v.includes('WATCH=off'));
});
test('a queued reference packet is never NEXT and asks for no release', () => {
  const s = base().state;
  assert.deepEqual(s.queue.W7, ['REF-1']);
  assert.ok(workerView(s, 'W7').includes('NEXT=none'));
  assert.ok(!programView(s).some((l) => l.includes('REF-1')));
});

// ---- program-view ----
test('program-view lists the critical path and the transitions waiting on Fable/L0', () => {
  let r = chain(base(),
    { type: 'release', packet: 'ALPHA', inbox: 396 },
    { type: 'deliver', packet: 'ALPHA', pr: 520, subjectSha: A },
    { type: 'accept', packet: 'ALPHA', subjectSha: A });
  let v = programView(r.state);
  assert.equal(v[0], 'CRITICAL_PATH=ALPHA phase=ACCEPTED owner=W3 pr=#520');
  assert.ok(v.includes('NEEDS_TRANSITION ALPHA event=integrate by=L0 :: accepted but not integrated'));
  assert.ok(v.includes('NEEDS_TRANSITION BETA event=release by=Fable :: W3 holds no active packet and BETA is next'));
  assert.ok(v.includes(`ACCEPTED_NOT_INTEGRATED ALPHA subject=${A} pr=#520`));
  assert.ok(v.includes('SNAPSHOT=none (external blockers not evaluated; GitHub facts not reconciled)'));
  assert.equal(v.at(-1), 'PROGRAM_WATCH=on');
  r = add(r, { type: 'integrate', packet: 'ALPHA', mergeSha: B });
  v = programView(r.state);
  assert.ok(v.includes(`INTEGRATED_NOT_STAGED ALPHA merge=${B}`));
  assert.ok(v.includes('NEEDS_TRANSITION ALPHA event=stage by=L0 :: integrated but not staged'));
});
test('program-view reports blockers cleared only per the supplied snapshot', () => {
  const r = add(released(), { type: 'block', packet: 'ALPHA', blockedBy: [{ external: 'OWNER-DEVICE', condition: 'device check', owner: 'Owner', unblockWhen: 'owner verdict' }] });
  assert.ok(!programView(r.state).some((l) => l.startsWith('BLOCKERS_CLEARED')));
  assert.ok(!programView(r.state, snap({ externalConditions: { 'OWNER-DEVICE': false } })).some((l) => l.startsWith('BLOCKERS_CLEARED')));
  assert.ok(programView(r.state, snap({ externalConditions: { 'OWNER-DEVICE': true } })).includes('BLOCKERS_CLEARED ALPHA'));
});
test('a packet blocker clears on the blocking packet\'s phase', () => {
  let r = chain(released(),
    { type: 'deliver', packet: 'ALPHA', pr: 520, subjectSha: A },
    { type: 'release', packet: 'BETA', inbox: 396 },
    { type: 'block', packet: 'BETA', blockedBy: [{ packet: 'ALPHA', until: 'INTEGRATED' }] });
  assert.ok(!programView(r.state).includes('BLOCKERS_CLEARED BETA'));
  r = add(r, { type: 'accept', packet: 'ALPHA', subjectSha: A });
  assert.ok(!programView(r.state).includes('BLOCKERS_CLEARED BETA'));
  r = add(r, { type: 'integrate', packet: 'ALPHA', mergeSha: B });
  assert.ok(programView(r.state).includes('BLOCKERS_CLEARED BETA'));
});
test('program-view flags inconsistent WATCH from the snapshot\'s check-in state', () => {
  const v = programView(released().state, snap({ triggers: { W3: { enabled: false }, W7: { enabled: true } } }));
  assert.ok(v.includes('WATCH_INCONSISTENT W3 work-without-watch'));
  assert.ok(v.includes('WATCH_INCONSISTENT W7 watch-on-without-work'));
});
test('PROGRAM_WATCH is off when everything left is blocked on an uncleared external condition', () => {
  const r = chain(base(),
    { type: 'withdraw', packet: 'BETA' },
    { type: 'release', packet: 'ALPHA', inbox: 396 },
    { type: 'block', packet: 'ALPHA', blockedBy: [{ external: 'OWNER-DEVICE', condition: 'device check', owner: 'Owner', unblockWhen: 'owner verdict' }] });
  assert.equal(programView(r.state).at(-1), 'PROGRAM_WATCH=off');
  assert.equal(programView(r.state, snap({ externalConditions: { 'OWNER-DEVICE': true } })).at(-1), 'PROGRAM_WATCH=on');
});

// ---- reconcile ----
test('reconcile never mutates the state or the snapshot (deep-frozen inputs, identical after)', () => {
  const r = delivered();
  const state = freeze(JSON.parse(r.stateText));
  const s = freeze(snap({
    prs: { 520: openPr(B, { changedSinceSubject: ['apps/wsf/x.ts'] }) },
    inboxHandoffs: [{ inbox: 396, commentId: 99, packet: 'GHOST' }],
    pin: { approvedAppSha: D }, staging: { servedSha: D }, triggers: { W3: { enabled: false } },
  }));
  const before = [JSON.stringify(state), JSON.stringify(s)];
  const out = reconcile(state, s);
  assert.ok(out.length >= 5);
  assert.deepEqual([JSON.stringify(state), JSON.stringify(s)], before);
  assert.equal(programView(state, s).at(-1), 'PROGRAM_WATCH=on');
});
test('reconcile: a head move inside the subject paths makes the subject stale; the ledger decides what follows', () => {
  const out = reconcile(delivered().state, snap({ prs: { 520: openPr(B, { changedSinceSubject: ['apps/wsf/screen.tsx', 'docs/x.md'] }) } }));
  assert.deepEqual(kinds(out), ['pr-head-moved', 'subject-stale']);
  const stale = out.find((x) => x.kind === 'subject-stale');
  assert.equal(stale.wins, 'ledger');
  assert.match(stale.detail, /1 subject path\(s\) changed .*apps\/wsf\/screen\.tsx/);
  assert.deepEqual(out.find((x) => x.kind === 'pr-head-moved').suggest, { type: 'reconcile-head', packet: 'ALPHA', prHeadSha: B });
});
test('reconcile: a head move outside the subject paths is evidence movement; the subject stands', () => {
  const out = reconcile(delivered().state, snap({ prs: { 520: openPr(B, { changedSinceSubject: ['docs/westayfit/evidence.md', 'apps/wsfx/y.ts'] }) } }));
  assert.deepEqual(kinds(out), ['evidence-moved', 'pr-head-moved']);
  assert.deepEqual(out.find((x) => x.kind === 'evidence-moved').suggest, { type: 'record-evidence', packet: 'ALPHA', evidenceSha: B });
});
test('reconcile: without changedSinceSubject the classification is reported unknown, never guessed', () => {
  assert.deepEqual(kinds(reconcile(delivered().state, snap({ prs: { 520: openPr(B) } }))), ['pr-head-moved', 'subject-change-unknown']);
});
test('reconcile: a head that matches the ledger is not a finding; after reconcile-head it is quiet', () => {
  assert.deepEqual(reconcile(delivered().state, snap({ prs: { 520: openPr(A) } })), []);
  const r = add(delivered(), { type: 'reconcile-head', packet: 'ALPHA', prHeadSha: B });
  assert.deepEqual(reconcile(r.state, snap({ prs: { 520: openPr(B) } })), []);
});
test('reconcile: merge and close drift', () => {
  const accepted = add(delivered(), { type: 'accept', packet: 'ALPHA', subjectSha: A });
  const merged = { state: 'closed', merged: true, headSha: A, mergeSha: E };
  const m1 = reconcile(accepted.state, snap({ prs: { 520: merged } }));
  assert.deepEqual(m1.map((x) => [x.kind, x.wins]), [['pr-merged-not-integrated', 'github']]);
  assert.deepEqual(m1[0].suggest, { type: 'integrate', packet: 'ALPHA', mergeSha: E, by: 'L0' });
  assert.deepEqual(reconcile(delivered().state, snap({ prs: { 520: merged } })).map((x) => [x.kind, x.wins]), [['pr-merged-without-acceptance', 'ledger']]);
  assert.deepEqual(kinds(reconcile(delivered().state, snap({ prs: { 520: { state: 'closed', merged: false, headSha: A } } }))), ['pr-closed-not-withdrawn']);
  assert.deepEqual(kinds(reconcile(delivered().state, snap())), ['pr-not-in-snapshot']);
});
test('reconcile: inbox handoffs with no packet, outside the canonical inbox, or not recorded', () => {
  const r = released();
  const recorded = r.state.packets.ALPHA.authority.released;
  const out = reconcile(r.state, snap({ inboxHandoffs: [
    { inbox: 396, commentId: recorded, packet: 'ALPHA' },
    { inbox: 396, commentId: 11, packet: 'GHOST' },
    { inbox: 400, commentId: 12, packet: 'BETA' },
    { inbox: 396, commentId: 13, packet: 'ALPHA' },
  ] }));
  assert.deepEqual(out.map((x) => `${x.kind}:${x.commentId}`), ['handoff-without-packet:11', 'handoff-outside-canonical-inbox:12', 'handoff-not-recorded:13']);
  assert.ok(out.every((x) => x.wins === 'ledger'));
});
test('reconcile: staging and pin mismatches', () => {
  const s = base().state;
  assert.deepEqual(reconcile(s, snap({ pin: { approvedAppSha: C }, staging: { servedSha: C } })), []);
  assert.deepEqual(kinds(reconcile(s, snap({ pin: { approvedAppSha: D }, staging: { servedSha: E } }))), ['pin-mismatch', 'staging-mismatch']);
});
test('reconcile: queue/phase inconsistencies in a supplied state are reported, not repaired', () => {
  const s = JSON.parse(released().stateText);
  s.queue.W3 = ['ALPHA', 'BETA'];
  const out = reconcile(freeze(s), snap());
  assert.deepEqual(out.map((x) => x.kind), ['queue-phase-inconsistent']);
  assert.match(out[0].detail, /W3's queue names ALPHA, which is already RELEASED/);
});
test('a snapshot carrying prose, titles, bodies or secrets is refused', () => {
  assert.ok(validateSnapshot(snap({ prs: { 520: openPr(A, { title: 'x' }) } })).some((p) => /unknown key "title"/.test(p)));
  assert.ok(validateSnapshot(snap({ ci: {} })).some((p) => /unknown key "ci"/.test(p)));
  assert.ok(validateSnapshot(snap({ inboxHandoffs: [{ inbox: 396, commentId: 1, packet: 'A1', body: 'hi' }] })).some((p) => /exactly \{ inbox, commentId, packet \}/.test(p)));
  assert.ok(validateSnapshot(snap({ prs: { 520: openPr(A, { changedSinceSubject: ['a@b.co'] }) } })).some((p) => /email-address-shaped/.test(p)));
  assert.ok(validateSnapshot(snap({ prs: { 520: { state: 'closed', merged: true, headSha: A } } })).some((p) => /needs its mergeSha/.test(p)));
  refused(() => reconcile(base().state, { schemaVersion: 2, prs: {} }), /schemaVersion must be 1/);
});
test('subject paths: "*" is the whole tree; others are a file or a directory prefix', () => {
  assert.equal(inSubject('anything/at/all', ['*']), true);
  assert.equal(inSubject('apps/wsf/a.ts', ['apps/wsf']), true);
  assert.equal(inSubject('apps/wsf', ['apps/wsf']), true);
  assert.equal(inSubject('apps/wsfx/a.ts', ['apps/wsf']), false);
  assert.equal(inSubject('apps/wsf/a.ts', ['apps/wsf/']), true);
});

// ---- required: CURRENT rendering is byte-stable, embeds ledgerHead, and hand edits are detectable ----
test('CURRENT is byte-stable and embeds the ledgerHead on its first line', () => {
  const r = delivered();
  const t1 = renderCurrent(r.state);
  const t2 = renderCurrent(JSON.parse(r.stateText));
  assert.equal(t1, t2);
  assert.equal(t1.split('\n')[0], `<!-- wsf-control ledgerHead=${r.state.ledgerHead} events=${r.state.eventCount} rendered by tools/wsf-control/render-current.mjs; do not edit -->`);
  assert.ok(t1.endsWith('\n'));
  assert.match(t1, /\| ALPHA \| W3 \| work \| product \| DELIVERED \| #520 \| aaaaaaaa \| aaaaaaaa \| — \|/);
  assert.match(t1, /\| W3 \| #396 \| — \| ALPHA \| — \| BETA \| BETA \| on \|/);
  assert.deepEqual(verifyCurrent(r.state, t1), { status: 'current' });
});
test('a hand-edited CURRENT is detectable', () => {
  const r = delivered();
  const edited = renderCurrent(r.state).replace('| DELIVERED |', '| ACCEPTED |');
  assert.equal(verifyCurrent(r.state, edited).status, 'hand-edited');
  assert.equal(verifyCurrent(r.state, `${renderCurrent(r.state)}\nnote\n`).status, 'hand-edited');
});
test('a CURRENT rendered from an older head is reported stale', () => {
  const r0 = delivered();
  const r1 = add(r0, { type: 'accept', packet: 'ALPHA', subjectSha: A });
  assert.equal(verifyCurrent(r1.state, renderCurrent(r0.state)).status, 'stale');
});

// ---- CLIs: refuse an invalid state; print; never write the state ----
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-control-v-'));
function dirWith(events) {
  const d = path.join(tmp(), 'state');
  for (const [i, e] of events.entries()) appendToDir(d, { actor: 'Fable', authority: 4000 + i, ...e });
  return d;
}
const withRelease = [...BASE, { type: 'release', packet: 'ALPHA', inbox: 396 }];
const snapshot = (dir, s) => { const f = path.join(path.dirname(dir), 'snap.json'); fs.writeFileSync(f, JSON.stringify(s)); return f; };
const pair = (d) => ['events.jsonl', 'state.json'].map((f) => fs.readFileSync(path.join(d, f), 'utf8'));

test('the view CLIs print and change nothing', () => {
  const d = dirWith(withRelease);
  const before = pair(d);
  const w = run('worker-view.mjs', [d, 'W3']);
  assert.equal(w.status, 0, w.stderr);
  assert.match(w.stdout, /^ACTIVE_NOW=ALPHA phase=RELEASED$/m);
  assert.match(w.stdout, /^WATCH=on$/m);
  const p = run('program-view.mjs', [d, '--snapshot', snapshot(d, snap({ triggers: { W3: { enabled: true } } }))]);
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /^CRITICAL_PATH=ALPHA phase=RELEASED owner=W3$/m);
  assert.match(p.stdout, /^PROGRAM_WATCH=on$/m);
  const rc = run('reconcile.mjs', [d, snapshot(d, snap({ inboxHandoffs: [{ inbox: 396, commentId: 5, packet: 'GHOST' }] }))]);
  assert.equal(rc.status, 0, rc.stderr);
  assert.match(rc.stdout, /^FINDING kind=handoff-without-packet wins=ledger packet=GHOST inbox=#396 comment=5 :: /m);
  assert.match(rc.stdout, /^RECONCILE findings=1 head=[0-9a-f]{64}$/m);
  assert.deepEqual(pair(d), before);
});
test('render-current CLI: --out then --verify is current; a hand edit fails --verify', () => {
  const d = dirWith(withRelease);
  const out = path.join(path.dirname(d), 'CURRENT.md');
  assert.equal(run('render-current.mjs', [d, '--out', out]).status, 0);
  const v = run('render-current.mjs', [d, '--verify', out]);
  assert.equal(v.status, 0);
  assert.match(v.stdout, /^CURRENT=current$/m);
  fs.writeFileSync(out, fs.readFileSync(out, 'utf8').replace('RELEASED', 'ACCEPTED'));
  const bad = run('render-current.mjs', [d, '--verify', out]);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /^CURRENT=hand-edited$/m);
});
test('every view CLI refuses a hand-edited state', () => {
  const d = dirWith(withRelease);
  const sp = path.join(d, 'state.json');
  fs.writeFileSync(sp, fs.readFileSync(sp, 'utf8').replace('"phase": "RELEASED"', '"phase": "QUEUED"'));
  for (const [script, args, re] of [
    ['worker-view.mjs', [d, 'W3'], /WORKER_VIEW=refused/],
    ['program-view.mjs', [d], /PROGRAM_VIEW=refused/],
    ['reconcile.mjs', [d, snapshot(d, snap())], /RECONCILE=refused/],
    ['render-current.mjs', [d], /CURRENT=refused/],
  ]) {
    const r = run(script, args);
    assert.equal(r.status, 2, `${script} should refuse`);
    assert.match(r.stdout, re);
  }
});
test('reconcile and program-view CLIs refuse a malformed snapshot', () => {
  const d = dirWith(withRelease);
  const f = snapshot(d, { schemaVersion: 1, prs: { 520: { state: 'open', merged: false, headSha: A, title: 'copied title' } } });
  assert.match(run('reconcile.mjs', [d, f]).stdout, /RECONCILE=refused \(the snapshot is malformed\)/);
  assert.match(run('program-view.mjs', [d, '--snapshot', f]).stdout, /PROGRAM_VIEW=refused \(the snapshot is malformed\)/);
});

done('views');
