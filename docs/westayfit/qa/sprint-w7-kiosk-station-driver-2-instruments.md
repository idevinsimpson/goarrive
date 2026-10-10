# W7 Check 88 instruments: LOVABLE-KIOSK-STATION-DRIVER-2 (inert)

Inert on this branch. These were written and run **outside the repository**, against **detached worktrees of #620 at
`ba103116ffb48fc4d83cc138e3ff000a024b9fd4`** (one for the suites, a second for mutants and the reproduction, plus the base `4da578d7` for comparison).
Nothing was pushed to the PR. They are evidence for **Check 88** (report §88). They change no product code and no other worker's file.
**No hosted system, no staging project, no Lovable project and no credential**: every run is hermetic (the PR's own tests and fake) or local Chromium on a crafted page.
The workflow runs the report cites were read through the GitHub API at job level only; their logs are not downloadable from here.

## What they prove

| # | Instrument | Result | Why it can fail |
|---|---|---|---|
| 1 | `repro620.sh`: the hosted failure reproduced offline: the PR's own fake (served timing) against the DRIVER-1 harness from main | the base harness gives exactly the hosted rows: `qr-join` FAIL "phone choice absent", all 7 station rows "not reached: the kiosk QR link shows the control no Join", the five phone rows PASS | does the packet's diagnosis explain the hosted rows, not just a plausible story |
| 2 | `scene.mjs`: the PR's real `phoneScene` (extracted verbatim) and `sceneText` against real Chromium on crafted DOMs | 7 / 7 cases as expected; opacity:0 and off-screen buttons are still listed | does the in-page reader do what the PR says in the engine the proof drives |
| 3 | `seentext.mjs`: `seenText` against an oracle (6,000 inputs) and the claim that the log line carries the stored text | 0 differences from the oracle; 0 differences between the stored text and the log line over 1,107 plain texts | is the PN-1 fix exactly "up to SEEN_MAX, scrubbed, in code points" |
| 4 | `lens3.mjs`: the diagnostic texts against the 300-character cap (the seven PASS texts are measured by `lens2.mjs`, Check 87) | typical diagnostics (148-164 characters) fit; 12 long buttons give 553 characters, stored as 300 | is the diagnostic itself kept whole |
| 5 | `mut620.mjs`: 57 single-edit mutants judged by the PR's own kiosk suite (`--check` parse-checks them without running the suite) | **49 / 57 killed**; all 57 parse; the 8 survivors are analysed in §88 (3 equivalent in the fake, 3 only change wall time, 2 missing pins) | does the PR's own test notice a weakened poll, verdict, cap, scrub, PN-2 wait or PN-3 pattern |

## Instrument 1: `repro620.sh`

```bash
#!/bin/bash
# W7 Check 88 instrument (recorded as run inline): reproduce the hosted failure offline. The PR's own fake app (served timing: the flow mounts 4 s
# after a load, the choice comes 7 s after Join) is run against the DRIVER-1 harness from main, with inert shims for the names the new test imports.
# usage: repro620.sh <scratch worktree of the PR head> <worktree of the base 4da578d7>
HEAD_WT=$1; BASE_WT=$2
cp $HEAD_WT/.github/wsf-staging/hosted-lovable-kiosk.mjs /tmp/k620.head.mjs
cp $BASE_WT/.github/wsf-staging/hosted-lovable-kiosk.mjs $HEAD_WT/.github/wsf-staging/hosted-lovable-kiosk.mjs
cat >> $HEAD_WT/.github/wsf-staging/hosted-lovable-kiosk.mjs <<'EOS'
export const JOIN_WAIT_MS = 30_000;
export const qrJoinVerdict = () => ({ ok: false, seen: 'shim' });
export const sceneText = () => 'shim';
export const seenText = (s) => String(s ?? '');
EOS
node - "$HEAD_WT" <<'EON'
const fs = require('fs');
const root = process.argv[2];
let s = fs.readFileSync(`${root}/.github/wsf-staging/tests/hosted-lovable-kiosk.test.mjs`, 'utf8');
const marker = "const { rows, productDocs, served } = await runJourney({ browser: L.browser, fixtures: L.fixtures, base: LOVABLE_URL, reviewed: FAKE_REVIEWED, now: L.now });";
s = s.replace(marker, marker + "\n  for (const r of results(rows).rows) console.log(`ROW ${r.id.padEnd(20)} ${r.status.padEnd(7)} ${r.seen}`); process.exit(0);");
const loop = "for (const [name, fn] of pending) { await fn(); passed += 1; console.log(`  ok  ${name}`); }";
s = s.replace(loop, "for (const [name, fn] of pending) { if (name.startsWith(\"journey with the kit's real shape\")) await fn(); }");
fs.writeFileSync(`${root}/.github/wsf-staging/tests/repro620.test.mjs`, s);
EON
(cd $HEAD_WT && node .github/wsf-staging/tests/repro620.test.mjs 2>&1 | cut -c1-200)
# restore the scratch tree
cp /tmp/k620.head.mjs $HEAD_WT/.github/wsf-staging/hosted-lovable-kiosk.mjs; rm -f $HEAD_WT/.github/wsf-staging/tests/repro620.test.mjs
```

## Instrument 2: `scene.mjs`

```js
// W7 Check 88 instrument: the PR's REAL phoneScene (extracted verbatim) and sceneText against REAL Chromium on a crafted DOM.
import fs from 'node:fs'; import { createRequire } from 'node:module'; import { pathToFileURL } from 'node:url';
const S = '/tmp/claude-0/-home-user-goarrive/7c5b4d17-88ae-5653-a067-ccc063331108/scratchpad';
const dir = process.argv[2];
const { chromium } = createRequire(`${S}/wt-A/apps/westayfit/package.json`)('playwright-core');
const K = await import(pathToFileURL(`${dir}/hosted-lovable-kiosk.mjs`).href);
const src = fs.readFileSync(`${dir}/hosted-lovable-kiosk.mjs`, 'utf8');
const body = src.slice(src.indexOf('async function phoneScene'), src.indexOf('/** One phrase of what the phone showed'));
const short = (e, max = 200) => String(e?.message || e).split('\n')[0].slice(0, max);
const phoneScene = new Function('short', `${body}; return phoneScene;`)(short);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
let bad = 0;
const t = (name, ok, extra = '') => { if (!ok) bad++; console.log(`${ok ? 'ok ' : 'BAD'} ${name}${extra ? '  ' + extra : ''}`); };
const scene = async (html) => { await page.setContent(`<body>${html}</body>`); return phoneScene(page); };

let s = await scene('<div data-connected-join="choose"><button>Move on my phone</button><button>Use the kiosk</button></div>');
t('stage, and both choice buttons, read', s.stage === 'choose' && s.buttons.join('|') === 'Move on my phone|Use the kiosk', JSON.stringify(s));
s = await scene('<div data-boot="Connecting…"></div><div data-entry-step="signIn"></div><button>Sign in</button>');
t('boot and entry screens read; no join flow -> stage null', s.stage === null && s.boot === 'Connecting…' && s.entry === 'signIn' && s.buttons[0] === 'Sign in', JSON.stringify(s));
s = await scene('<button>Shown</button><button style="display:none">Gone</button><button style="visibility:hidden">Hidden</button><button style="width:0;height:0;padding:0;border:0;overflow:hidden">Zero</button><button style="opacity:0">Faint</button><button style="position:absolute;left:-9999px">Off</button>');
t('display:none, visibility:hidden and zero-size buttons are not listed', !s.buttons.includes('Gone') && !s.buttons.includes('Hidden') && !s.buttons.includes('Zero') && s.buttons.includes('Shown'), JSON.stringify(s.buttons));
console.log(`      (opacity:0 listed: ${s.buttons.includes('Faint')}; off-screen listed: ${s.buttons.includes('Off')}; these are shown to a reader of the log, not to a visitor)`);
s = await scene('<button aria-label="Open menu"><svg width="10" height="10"></svg></button><button>  Spaced\n   out   </button><button>Same</button><button>Same</button><button aria-label=""></button><button>Upper</button>');
t('aria-label names an icon button; whitespace collapses; repeated names appear once; empty buttons are dropped', s.buttons.join('|') === 'Open menu|Spaced out|Same|Upper', JSON.stringify(s.buttons));
s = await scene('<button style="text-transform:uppercase">Use the kiosk</button>');
console.log(`      (a button styled uppercase is read as ${JSON.stringify(s.buttons[0])}: innerText applies text-transform, aria-label does not)`);
s = await scene(`<div data-connected-join="validating">${Array.from({ length: 12 }, (_, i) => `<button>Button number ${i} ${'x'.repeat(60)}</button>`).join('')}</div>`);
const txt = K.sceneText(s);
t('sceneText caps 8 buttons, 40 characters each, and says how many more', /and 4 more/.test(txt) && txt.split('"').filter((_, i) => i % 2 === 1).every((b) => b.length <= 40) && txt.includes('join flow is validating'), txt.slice(0, 120));
await page.setContent('<body></body>'); await page.close();
const dead = await (async () => { try { return await phoneScene(page); } catch (e) { return { threw: true }; } })();
t('a closed page does not throw: phoneScene returns an unreadable scene', dead.stage === null && Array.isArray(dead.buttons) && typeof dead.error === 'string', JSON.stringify(dead));
console.log('sceneText of the unreadable scene:', K.sceneText(dead));
await browser.close();
process.exit(bad ? 1 : 0);
```

## Instrument 3: `seentext.mjs`

```js
// W7 Check 88 instrument: seenText against an oracle, and the claim that the LOVABLE_SEEN line carries the stored text unchanged.
import { pathToFileURL } from 'node:url';
const K = await import(pathToFileURL(`${process.argv[2]}/hosted-lovable-kiosk.mjs`).href);
const { seenText, seenLine, SEEN_MAX, results } = K;
let seed = 99; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const atoms = ['a', 'b', 'é', '\u{1F600}', ' ', '  ', ';', ':', '(', ')', '"', '…', 'wsf-x@example.com', '?join=SECRETCODE', '&goal=g1', '##[', '\n', '\t', '\u0007', 'AI' + 'zaSy' + 'A'.repeat(24), 'Bearer abc', 'control (the kit\'s verified member): '];
const oracle = (s) => {
  let t = String(s ?? '').split('\n')[0].replace(/[?&][A-Za-z]+=[^&\s"']+/g, '?…').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>');
  const cps = Array.from(t);
  return cps.length > SEEN_MAX ? `${cps.slice(0, SEEN_MAX - 1).join('')}…` : t;
};
let n = 0, diffs = 0, lineDiffs = 0, storedWhole = 0;
for (let i = 0; i < 6000; i++) {
  const len = pick([0, 1, 5, 40, 120, 290, 298, 299, 300, 301, 302, 400, 700]);
  let s = ''; while (Array.from(s).length < len) s += pick(atoms);
  n += 1;
  const got = seenText(s);
  if (got !== oracle(s)) diffs++;
  if (Array.from(got).length > SEEN_MAX) diffs++;
  // the claim: the log line carries the stored text unchanged (when nothing in it needs the line's own rules)
  const plain = !/[\u0000-\u001f\u007f-\u009f]|\s{2,}|##\[|AIza|Bearer|^\s|\s$/.test(got) && got.length > 0;
  if (plain) {
    storedWhole += 1;
    const line = seenLine('P', 'id', got);
    if (line !== `P id ${got}`) lineDiffs++;
  }
}
console.log(`seenText vs oracle: ${n} inputs, ${diffs} differences (cap, first line, scrub, code points)`);
console.log(`log line == "P id <stored>" for ${storedWhole} plain stored texts: ${lineDiffs} differences`);
// control characters / tabs / runs of white space: the line normalises them, the stored text does not
const tab = seenText('a\tb  c'); console.log(`stored text with a tab and a double space: ${JSON.stringify(tab)}; its log line: ${JSON.stringify(seenLine('P', 'id', tab))}`);
process.exit(diffs || lineDiffs ? 1 : 0);
```

## Instrument 4: `lens3.mjs`

```js
import { pathToFileURL } from 'node:url';
const K = await import(pathToFileURL(`${process.argv[2]}/hosted-lovable-kiosk.mjs`).href);
const worst = { stage: 'validating', boot: 'hydrate', entry: 'profileSetup', buttons: Array.from({ length: 12 }, (_, i) => `Button label number ${i} ${'x'.repeat(40)}`) };
const typical = { stage: 'validating', boot: null, entry: null, buttons: ['Open menu'] };
const mk = (scene) => ({
  'not-reached (control)': `not reached: the kiosk QR link offered the control no Use the kiosk (its Join answered alreadyMember=true): ${K.sceneText(scene)}`,
  'qr-join FAIL': `join into this community, alreadyMember=false; phone choice absent (no choice within 30 s): ${K.sceneText(scene)}`,
});
for (const [label, sc] of [['typical', typical], ['worst (12 long buttons)', worst]]) for (const [k, v] of Object.entries(mk(sc))) {
  const stored = K.results({ 'qr-join': { status: 'FAIL', seen: v } }).rows.find((r) => r.id === 'qr-join').seen;
  console.log(`${label.padEnd(24)} ${k.padEnd(22)} ${String(v.length).padStart(3)} chars -> stored ${stored.length}${stored.length < v.length ? ` (cut; ends "${stored.slice(-24)}")` : ''}`);
}
```

## Instrument 5: `mut620.mjs`

```js
// W7 Check 88 instrument: fixed-purpose mutants of #620 (join-flow polling, diagnostics, seen cap, PN-2, PN-3), one edit at a time in a scratch
// worktree, judged by the PR's own kiosk suite; restored after each. usage: node mut620.mjs <worktree root> [--check]
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const root = process.argv[2];
const checkOnly = process.argv.includes('--check');
const K = `${root}/.github/wsf-staging/hosted-lovable-kiosk.mjs`;
const KT = `${root}/.github/wsf-staging/tests/hosted-lovable-kiosk.test.mjs`;
const orig = fs.readFileSync(K, 'utf8');
const M = [
  // PN-1: the stored seen text
  ['R1 results() stores short() (200) again', "seen: seenText(r.seen) };", "seen: short(r.seen ?? '') };"],
  ['R2 seenText keeps SEEN_MAX characters + ellipsis (one too many)', "t.slice(0, SEEN_MAX - 1).join('')}…`", "t.slice(0, SEEN_MAX).join('')}…`"],
  ['R3 seenText does not scrub', "const t = Array.from(short(seen ?? '', Infinity));", "const t = Array.from(String(seen ?? ''));"],
  ['R4 seenText counts UTF-16 units', "const t = Array.from(short(seen ?? '', Infinity));\n  return t.length > SEEN_MAX ? `${t.slice(0, SEEN_MAX - 1).join('')}…` : t.join('');", "const t = short(seen ?? '', Infinity);\n  return t.length > SEEN_MAX ? `${t.slice(0, SEEN_MAX - 1)}…` : t;"],
  ['R5 seenText cuts at SEEN_MAX exactly (>=)', "return t.length > SEEN_MAX ?", "return t.length >= SEEN_MAX ?"],
  ['R6 short ignores its max (always 200)', ".slice(0, max);", ".slice(0, 200);"],
  // qrJoinVerdict
  ['V1 kiosk choice not required', "scene?.stage === 'choose' && phoneChoice === true && kioskChoice === true", "scene?.stage === 'choose' && phoneChoice === true"],
  ['V2 phone choice not required', "scene?.stage === 'choose' && phoneChoice === true && kioskChoice === true", "scene?.stage === 'choose' && kioskChoice === true"],
  ['V3 stage choose not required', "scene?.stage === 'choose' && phoneChoice === true && kioskChoice === true", "phoneChoice === true && kioskChoice === true"],
  ['V4 another community accepted', "return { ok: into && r.alreadyMember === false,", "return { ok: r.alreadyMember === false,"],
  ['V5 alreadyMember true accepted', "return { ok: into && r.alreadyMember === false,", "return { ok: into,"],
  ['V6 refusal reported as a timeout', "CHOICE_END.has(scene?.stage) ? `the join flow ended at ${scene.stage}`", "false ? `the join flow ended at ${scene.stage}`"],
  ['V7 wait length 30 s -> 5 s', "export const JOIN_WAIT_MS = 30_000;", "export const JOIN_WAIT_MS = 5_000;"],
  ['V8 wait length 30 s -> 90 s', "export const JOIN_WAIT_MS = 30_000;", "export const JOIN_WAIT_MS = 90_000;"],
  // sceneText / phoneScene
  ['S1 nine buttons named', "const SCENE_BUTTONS = 8;", "const SCENE_BUTTONS = 9;"],
  ['S2 button names 41 characters', ".map((b) => `\"${String(b).slice(0, 40)}\"`)", ".map((b) => `\"${String(b).slice(0, 41)}\"`)"],
  ['S3 button names uncapped', ".map((b) => `\"${String(b).slice(0, 40)}\"`)", ".map((b) => `\"${String(b)}\"`)"],
  ['S4 "and N more" count off by one', "` and ${all.length - SCENE_BUTTONS} more`", "` and ${all.length - SCENE_BUTTONS + 1} more`"],
  ['S5 absent stage not named', "join flow is ${s?.stage ?? 'absent'}", "join flow is ${s?.stage}"],
  ['S6 boot screen not named', "${s?.boot ? `, boot ${s.boot}` : ''}", ""],
  ['S7 entry step not named', "${s?.entry ? `, entry step ${s.entry}` : ''}", ""],
  ['S8 unreadable page not named', "${s?.error ? `; unreadable (${s.error})` : ''}", ""],
  ['S9 phoneScene lists zero-size buttons', "return r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== 'hidden';", "return getComputedStyle(b).visibility !== 'hidden';"],
  ['S10 phoneScene lists visibility:hidden buttons', "return r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== 'hidden';", "return r.width > 0 && r.height > 0;"],
  ['S11 phoneScene ignores aria-label', "(b.getAttribute('aria-label') || b.innerText || '')", "(b.innerText || '')"],
  ['S12 phoneScene keeps repeated names', "buttons: [...new Set(names)] };", "buttons: names };"],
  ['S13 phoneScene keeps inner white space', ".replace(/\\s+/g, ' ').trim()).filter(Boolean);\n      return { stage", ".trim()).filter(Boolean);\n      return { stage"],
  // untilScene
  ['U1 scene poll step 1 s -> 5 s', "await page.waitForTimeout(1000); scene = await phoneScene(page); }", "await page.waitForTimeout(5000); scene = await phoneScene(page); }"],
  ['U2 scene poll ignores its bound (never stops)', "for (; !done(scene) && waited < ms; waited += 1000)", "for (; !done(scene) && waited < ms * 100; waited += 1000)"],
  ['U3 scene poll stops one step early', "for (; !done(scene) && waited < ms; waited += 1000)", "for (; !done(scene) && waited < ms - 1000; waited += 1000)"],
  ['U4 entry stages exclude the choice', "const ENTRY_STAGES = new Set(['preview', 'choose', 'refused', 'unknown']);", "const ENTRY_STAGES = new Set(['preview', 'refused', 'unknown']);"],
  ['U5 entry stages exclude refused/unknown', "const ENTRY_STAGES = new Set(['preview', 'choose', 'refused', 'unknown']);", "const ENTRY_STAGES = new Set(['preview', 'choose']);"],
  ['U6 choice end excludes refused', "const CHOICE_END = new Set(['choose', 'refused', 'unknown']);", "const CHOICE_END = new Set(['choose', 'unknown']);"],
  ['U7 choice end excludes unknown', "const CHOICE_END = new Set(['choose', 'refused', 'unknown']);", "const CHOICE_END = new Set(['choose', 'refused']);"],
  // the control's entry (driveStationTurn)
  ['E1 control: single sample of the flow, as DRIVER-1', "let scene = await untilScene(phone, (s) => ENTRY_STAGES.has(s.stage));", "let scene = await phoneScene(phone);"],
  ['E2 control: Join pressed without the stage check', "if (scene.stage === 'preview' && (await visible(join))) {", "if (await visible(join)) {"],
  ['E3 control: choice sampled once after Join', "scene = await untilScene(phone, (s) => CHOICE_END.has(s.stage));\n  }\n  const useKiosk", "scene = await phoneScene(phone);\n  }\n  const useKiosk"],
  ['E4 control: not-reached drops what the phone showed', "}: ${sceneText(scene)}`);\n    return;", "}`);\n    return;"],
  ['E5 control: its Join read from the whole log, not the turn', "logP.since(turnBegan.p).filter((x) => x.name === 'wsfJoinCommunity').at(-1) ?? null", "logP.last('wsfJoinCommunity')"],
  ['E6 control: a Join answer is not mentioned in the not-reached text', "${qrJoin ? ` (its Join answered ${qrJoin.error ?? `alreadyMember=${qrJoin.result?.alreadyMember}`})` : ''}", ""],
  ['E7 queue-place: a Join that joined something passes (qrJoin check removed)', "if (qrJoin && qrJoin.result?.alreadyMember !== true) bad.push(", "if (false) bad.push("],
  ['E8 queue-place: a missing Join is a FAIL (the DRIVER-1 rule)', "if (qrJoin && qrJoin.result?.alreadyMember !== true) bad.push(", "if (qrJoin?.result?.alreadyMember !== true) bad.push("],
  ['E9 queue-place: PASS text always says nothing joined', "${qrJoin ? 'nothing joined' : 'no Join shown'}", "nothing joined"],
  // A's path (qr-join)
  ['A1 A: entry stage not required preview', "if (entry.stage !== 'preview' || !(await visible(join)))", "if (!(await visible(join)))"],
  ['A2 A: Join button not required visible', "if (entry.stage !== 'preview' || !(await visible(join)))", "if (entry.stage !== 'preview')"],
  ['A3 A: choice sampled once after Join', "const after = await untilScene(pageA, (s) => CHOICE_END.has(s.stage));", "const after = await phoneScene(pageA);"],
  ['A4 A: kiosk choice not read', "kioskChoice: await visible(pageA.getByTestId('join-use-kiosk')) });", "kioskChoice: true });"],
  ['A5 A: phone choice not read', "phoneChoice: await visible(pageA.getByTestId('join-move-phone')),", "phoneChoice: true,"],
  ['A6 A: flow polled once for its entry', "const entry = await untilScene(pageA, (s) => ENTRY_STAGES.has(s.stage));", "const entry = await phoneScene(pageA); entry.waited = 0;"],
  ['A7 A: no-Join text drops the scene', "`no Join for a visitor who is not a member: ${sceneText(entry)}`", "'no Join for a visitor who is not a member'"],
  // PN-2
  ['N1 PN-2 poll removed (phase read once)', "  await wait(kiosk, async () => ['countdown', 'active'].includes(await phaseOf()), 5000, 250); // the panel renders the start (W7 PN-2 on #619)\n", ""],
  ['N2 PN-2 poll window 5 s -> 1 s', "['countdown', 'active'].includes(await phaseOf()), 5000, 250);", "['countdown', 'active'].includes(await phaseOf()), 1000, 250);"],
  ['N3 PN-2 poll placed before the writes mark', "const roundFrom = { k: logK.mark(), p: logP.mark() };\n  await wait(kiosk, async () => ['countdown', 'active'].includes(await phaseOf()), 5000, 250); // the panel renders the start (W7 PN-2 on #619)", "await wait(kiosk, async () => ['countdown', 'active'].includes(await phaseOf()), 5000, 250); // the panel renders the start (W7 PN-2 on #619)\n  const roundFrom = { k: logK.mark(), p: logP.mark() };"],
  // PN-3
  ['L1 line code admits I and O', "const TURN_CODE = /^[A-HJ-NP-Z2-9]{3}$/;", "const TURN_CODE = /^[A-Z2-9]{3}$/;"],
  ['L2 line code 2 to 4 characters', "const TURN_CODE = /^[A-HJ-NP-Z2-9]{3}$/;", "const TURN_CODE = /^[A-HJ-NP-Z2-9]{2,4}$/;"],
  ['L3 line code admits lower case', "const TURN_CODE = /^[A-HJ-NP-Z2-9]{3}$/;", "const TURN_CODE = /^[A-HJ-NP-Za-hj-np-z2-9]{3}$/;"],
  ['L4 line code admits 0 and 1', "const TURN_CODE = /^[A-HJ-NP-Z2-9]{3}$/;", "const TURN_CODE = /^[A-HJ-NP-Z0-9]{3}$/;"],
];
let killed = 0; const survived = [], unapplied = [];
for (const [name, find, rep] of M) {
  const n = orig.split(find).length - 1;
  if (n !== 1) { unapplied.push(`${name} (${n}x)`); continue; }
  fs.writeFileSync(K, orig.replace(find, () => rep));
  const r = checkOnly ? spawnSync(process.execPath, ['--check', K], { cwd: root, encoding: 'utf8' }) : spawnSync(process.execPath, [KT], { cwd: root, encoding: 'utf8', timeout: 400_000 });
  fs.writeFileSync(K, orig);
  const dead = checkOnly ? r.status === 0 : r.status !== 0;
  console.log(`${checkOnly ? (dead ? 'PARSES  ' : 'SYNTAX-ERR') : (dead ? 'KILLED  ' : 'SURVIVED')} ${name}`);
  if (dead) killed++; else survived.push(name);
}
console.log(`\n${killed}/${M.length - unapplied.length} ${checkOnly ? 'parse' : 'killed'}; ${checkOnly ? 'failures' : 'survivors'}: ${survived.length ? survived.join(' | ') : 'none'}; unapplied: ${unapplied.length ? unapplied.join(' | ') : 'none'}`);
fs.writeFileSync(K, orig);
```
