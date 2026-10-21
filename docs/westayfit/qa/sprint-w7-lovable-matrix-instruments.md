# W7 Check 85 instruments: LOVABLE-MATRIX-ALIGN-1 (inert)

Inert on this branch. These were written and run **outside the repository**, against **detached worktrees of #614 at
`bab7e9800072e10df6ad4cc269e6f7794baf2c81`** (one for the suites, a second for mutants, so that no mutant ever touched the tree a suite was reading).
Nothing was pushed to the PR. They are evidence for **Check 85** (report §85). They change no product code and no other worker's file.
**No hosted system, no staging project, no Lovable project and no credential**: every run is hermetic (the PR's own tests and fakes).

## What they prove

| # | Instrument | Result | Why it can fail |
|---|---|---|---|
| 1 | `mut614.mjs`: 33 mutants of the two harnesses, each judged by the PR's own test for that file | **32 / 33 killed**; the survivor is the 300-character cap boundary | does the PR's test notice a weakened check, for each O-item and each new expectation |
| 2 | `drive.mjs`: the sanitiser driven with hostile text | no printed line keeps `##[`; the four documented scrub gaps behave as the QA note says | O1 closure; the "known limits" are true |
| 3 | `audit.sh`: every print site | the only lines carrying host or app text are `seenLine` and `bindLines`, both `logSafe`-mapped | O1 closure is complete, not only at the sites the PR names |
| 4 | `o5.py`: a scan rule written another way | both variants break the parity test | W3 #613 O5 |

## Instrument 1: `mut614.mjs`

```js
// W7 mutants of the two Lovable harnesses (#614). Each applies in a SEPARATE detached worktree and is judged by the PR's own
// test for that file; the file is restored after every mutant. usage: node mut614.mjs <worktree>
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const WT = process.argv[2];
const K = '.github/wsf-staging/hosted-lovable-kiosk.mjs', KT = '.github/wsf-staging/tests/hosted-lovable-kiosk.test.mjs';
const X = '.github/wsf-staging/hosted-lovable-device-matrix.mjs', XT = '.github/wsf-staging/hosted-lovable-device-matrix.test.mjs';
const M = [
  // ---- #613 O-items (kiosk harness) ----
  [K, KT, 'logSafe is the identity', "export const logSafe = (line) => String(line).replace(/##\\[/g, '## [');", "export const logSafe = (line) => String(line);"],
  [K, KT, 'logSafe breaks only the first opener', "replace(/##\\[/g, '## [');", "replace(/##\\[/, '## [');"],
  [K, KT, 'logSafe breaks only a line-start opener', "replace(/##\\[/g, '## [');", "replace(/^##\\[/g, '## [');"],
  [K, KT, 'seenLine skips logSafe', "return logSafe(`${prefix} ${id} ${t || '(none)'}`);", "return `${prefix} ${id} ${t || '(none)'}`;"],
  [K, KT, 'bindLines (nothing observed) skips logSafe', "if (!observed) return lines.map(logSafe);", "if (!observed) return lines;"],
  [K, KT, 'bindLines (observed) skips logSafe', "return lines.map(logSafe); // a host's refusal", "return lines; // a host's refusal"],
  [K, KT, 'DATA_TYPES also admits other', "const DATA_TYPES = new Set(['xhr', 'fetch', 'eventsource', 'ping']);", "const DATA_TYPES = new Set(['xhr', 'fetch', 'eventsource', 'ping', 'other']);"],
  [K, KT, 'DATA_TYPES also admits prefetch', "const DATA_TYPES = new Set(['xhr', 'fetch', 'eventsource', 'ping']);", "const DATA_TYPES = new Set(['xhr', 'fetch', 'eventsource', 'ping', 'prefetch']);"],
  [K, KT, 'withheld only on the raw text', "EVIDENCE_SCAN_RULES.some((re) => re.test(raw) || re.test(t))", "EVIDENCE_SCAN_RULES.some((re) => re.test(raw))"],
  [K, KT, 'withheld only on the scrubbed text', "EVIDENCE_SCAN_RULES.some((re) => re.test(raw) || re.test(t))", "EVIDENCE_SCAN_RULES.some((re) => re.test(t))"],
  [K, KT, 'the cap is one character too long', "Array.from(t).length > SEEN_MAX", "Array.from(t).length > SEEN_MAX + 1"],
  [K, KT, 'the station-row reason reverts to the stale text', "const STATION_BLOCK = 'the station backend (#587) is served on staging and the served build sends its expectedTurn binding, but this proof has no station driver yet; an older station path is never driven';", "const STATION_BLOCK = 'the safe station backend (#587, integrated in source) is not served on staging and this proof has no station driver yet; an older station path is never driven';"],
  // ---- #610 O-items (preview-image rule) ----
  [K, KT, 'preview link frame: http or https', "content=\"https:\\/\\/pub-bb2e", "content=\"https?:\\/\\/pub-bb2e"],
  [K, KT, 'preview link frame: Content or content', "(?<=\\s)content=\"https:", "(?<=\\s)[Cc]ontent=\"https:"],
  [K, KT, 'preview link frame: the slash before lovp_ optional', "r2\\.dev\\/lovp_372a", "r2\\.dev\\/?lovp_372a"],
  [K, KT, 'preview link frame: the dot before png unescaped', "\\.png\"/g;", ".png\"/g;"],
  [K, KT, 'preview link frame: png or jpg', "\\.png\"/g;", "\\.(?:png|jpg)\"/g;"],
  [K, KT, 'printed preview names are not anchored', "const PREVIEW_NAME = /^[0-9a-f]{32}_[0-9]{13}$/;", "const PREVIEW_NAME = /[0-9a-f]{32}_[0-9]{13}/;"],
  [K, KT, 'the file-name shape count ignores a longer hex run', "const PREVIEW_NAME_RE = /[0-9a-f]{32}_[0-9]{13}/g;", "const PREVIEW_NAME_RE = /(?<![0-9a-f])[0-9a-f]{32}_[0-9]{13}(?![0-9])/g;"],
  // ---- display and sign-up cells (matrix harness) ----
  [X, XT, 'exactText reads innerText again', "return (await l.count()) > index ? clean(await l.nth(index).textContent()) : '';", "return (await l.count()) > index ? clean(await l.nth(index).innerText()) : '';"],
  [X, XT, 'freshness: any number of lines', "const freshOk = fresh.length === 2 &&", "const freshOk = fresh.length >= 1 &&"],
  [X, XT, 'freshness: the second line is anything', "FRESH_UPDATED_RE.test(fresh[1]);", "typeof fresh[1] === 'string';"],
  [X, XT, 'freshness: the first line is anything', "fresh[0] === COPY.live && FRESH_UPDATED_RE", "typeof fresh[0] === 'string' && FRESH_UPDATED_RE"],
  [X, XT, 'the updated line may be any text', "export const FRESH_UPDATED_RE = /^updated \\d+ s ago$/;", "export const FRESH_UPDATED_RE = /updated/;"],
  [X, XT, 'display: the community line is not compared', "&& read.community === fx.communityName && read.total === want.total", "&& read.total === want.total"],
  [X, XT, 'display: the total number is not compared', "&& read.total === want.total && read.of === want.of && freshOk;", "&& read.of === want.of && freshOk;"],
  [X, XT, 'display: the target line is not compared', "&& read.total === want.total && read.of === want.of && freshOk;", "&& read.total === want.total && freshOk;"],
  [X, XT, 'display: the live state is not required', "const ok = read.state === 'live' && read.title", "const ok = read.title"],
  [X, XT, 'display: the title is not compared', "&& read.title === fx.goalTitle && showsNumber", "&& showsNumber"],
  [X, XT, 'display: the seeded number need not be in the page', "&& showsNumber(read.page, fx.seeded)\n    && read.community", "\n    && read.community"],
  [X, XT, 'the step verdict accepts any text containing the step', "export const stepVerdict = (text) => text === COPY.stepUnverified;", "export const stepVerdict = (text) => typeof text === 'string' && text.includes('Step');"],
  [X, XT, 'the sign-up cell ignores the step count', "honest && stepVerdict(step) ? 'PASS' : 'FAIL'", "honest ? 'PASS' : 'FAIL'"],
  [X, XT, 'the failed display check says other again', "`community ${read.community === fx.communityName ? 'the fixture community' : quoted(read.community)}`", "`community ${read.community === fx.communityName ? 'the fixture community' : 'other'}`"],
];
let killed = 0, n = 0;
try {
  for (const [file, test, name, from, to] of M) {
    const p = `${WT}/${file}`;
    const orig = fs.readFileSync(p, 'utf8');
    const c = orig.split(from).length - 1;
    if (c !== 1) { console.log(`NOT-APPLICABLE ${name} (${c} matches)`); continue; }
    fs.writeFileSync(p, orig.replace(from, to));
    const r = spawnSync(process.execPath, [test], { cwd: WT, encoding: 'utf8', timeout: 300_000 });
    fs.writeFileSync(p, orig);
    const dead = r.status !== 0;
    n += 1; killed += dead;
    console.log(`${dead ? 'killed  ' : 'SURVIVED'} ${name}`);
  }
} finally {
  for (const f of [K, X]) { /* restored per mutant; nothing else to do */ }
}
console.log(`${killed}/${n} killed (${M.length} defined)`);
```

## Instrument 2: `drive.mjs`

```js
// W7: drive the sanitiser with hostile text (run from .github/wsf-staging of the #604-style detached worktree)
import { seenLine, bindLines, logSafe } from './hosted-lovable-kiosk.mjs';
const hostile = 'x ##[add-mask]SECRET and ##[warning title=forged]y ##[stop-commands]tok';
console.log(seenLine('LOVABLE_SEEN', 'qr-join', hostile).includes('##['));                                  // false
console.log(bindLines(null, { status: 'FAIL', reason: 'served with charset ##[add-mask]fail, not UTF-8' }).some((l) => l.includes('##[')));  // false
console.log(JSON.stringify(logSafe('###[a ##[[ #[')));                                                       // "### [a ## [[ #["
for (const s of ['go ?api_key=SECRETVALUE end', 'go ?x1=SECRETVALUE end', 'url #frag=SECRETFRAG end', 'mail a@x.co-op.test tail']) console.log(seenLine('P', 'id', s));
// the four documented scrub gaps behave exactly as the QA note says: the first three are NOT replaced, and the email tail survives as "<email>-op.test"
```

## Instrument 3: `audit.sh`

```sh
# W7: the print-site audit (O1 closure). Both harnesses print only through say(); the lines that can carry host or app text are exactly
# seenLine(...) and bindLines(...), both of which return logSafe-mapped lines. The other say() sites print fixed text, a harness-chosen id
# and an enum status, a workflow-env value (WSF_LOVABLE_URL, the cleanup and scan outcomes), or the run tag.
grep -n "say(" hosted-lovable-kiosk.mjs hosted-lovable-device-matrix.mjs
grep -n "logSafe" hosted-lovable-kiosk.mjs hosted-lovable-device-matrix.mjs
grep -n "console\.\(log\|error\|warn\|info\)\|process\.\(stdout\|stderr\)\.write" hosted-lovable-kiosk.mjs hosted-lovable-device-matrix.mjs   # only the default say = console.log
```

## Instrument 4: `o5.py`

```python
# W7: O5 (rule parity) — a rule written another way must still break the parity test. Applied in a detached worktree and restored.
import subprocess
def run(label, path, old, new):
    s = open(path).read(); assert s.count(old) == 1
    open(path, 'w').write(s.replace(old, new))
    r = subprocess.run(['node', '.github/wsf-staging/tests/hosted-lovable-kiosk.test.mjs'], capture_output=True, text=True)
    open(path, 'w').write(s)
    print('killed' if r.returncode else 'SURVIVED', label)
run('harness gains an 11th rule as new RegExp', '.github/wsf-staging/hosted-lovable-kiosk.mjs', "  /\\bbu_[A-Za-z0-9_-]{20,}/,\n]);", "  /\\bbu_[A-Za-z0-9_-]{20,}/,\n  new RegExp('zzzzzzzzzzzzzzzzzzzz'),\n]);")
run('scan script gains an 11th rule as new RegExp', '.github/wsf-staging/scan-evidence.mjs', "  { name: 'browser-use-api-key', re: /\\bbu_[A-Za-z0-9_-]{20,}/ },\n];", "  { name: 'browser-use-api-key', re: /\\bbu_[A-Za-z0-9_-]{20,}/ },\n  { name: 'extra', re: new RegExp('zzzzzzzzzzzzzzzzzzzz') },\n];")
```

## Instrument 5: `verdict-prop.mjs` (false PASS and false FAIL)

`displayVerdict` and `stepVerdict` against an oracle written from the queue's wording (#365 `6096204665` item 1), independent of the
implementation. 8 correct renders (fixtures from 120/500 to 1,000,000/2,000,000) and 31 single-field wrong renders of each (state, title,
community, total, target line, every way the two freshness lines can be wrong). Result on Node 20.20.2 and 22.22.2: **256 renders, 0 false FAIL,
0 false PASS**; `stepVerdict` 11 inputs, 0 wrong; `en-GB` equals `en-US` on integers.

```js
// W7: displayVerdict / stepVerdict against an independent oracle, over correct renders (no false FAIL) and single-field wrong
// renders (no false PASS). usage: node verdict-prop.mjs <wsf-staging dir>
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const m = await import(pathToFileURL(path.join(process.argv[2], 'hosted-lovable-device-matrix.mjs')).href);
const { displayVerdict, stepVerdict, displayNumber, COPY, FIXTURE_UNIT } = m;
const fxs = [[120, 500], [40, 300], [0, 10], [999, 1000], [1000, 1000], [1234, 5000], [12345, 100000], [1000000, 2000000]].map(([seeded, target]) => ({ seeded, target, goalTitle: 'Fixture Open Squats', communityName: 'Fixture Open Community' }));
const fmt = (n) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 3 }).format(n);
const good = (fx) => ({ state: 'live', title: fx.goalTitle, community: fx.communityName, total: fmt(fx.seeded), of: `of ${fmt(fx.target)} squats`, fresh: ['Live · confirmed totals', 'updated 3 s ago'], page: `${fx.communityName} ${fx.goalTitle} ${fmt(fx.seeded)} of ${fmt(fx.target)} squats Live · confirmed totals updated 3 s ago` });
// the oracle: the spec in the queue (#365 6096204665 item 1), written independently of the implementation
const oracle = (r, fx) => r.state === 'live' && r.title === fx.goalTitle && r.community === fx.communityName && r.total === fmt(fx.seeded) && r.of === `of ${fmt(fx.target)} squats`
  && Array.isArray(r.fresh) && r.fresh.length === 2 && r.fresh[0] === 'Live · confirmed totals' && /^updated \d+ s ago$/.test(r.fresh[1]) && new RegExp(`(^|[^\\d,.])${fmt(fx.seeded).replace(/[,.]/g, '\\$&')}(?![\\d,.]*\\d)`).test(r.page);
let falseFail = 0, falsePass = 0, n = 0, wrong = 0;
for (const fx of fxs) {
  const g = good(fx);
  n += 1; if (!displayVerdict(g, fx).ok) { falseFail += 1; console.log('FALSE FAIL (correct render refused)', JSON.stringify(fx)); }
  const variants = [
    ['state stale', { state: 'stale' }], ['state notAuthorized', { state: 'notAuthorized' }], ['title other', { title: 'Other' }], ['title case', { title: g.title.toUpperCase() }],
    ['community empty', { community: '' }], ['community case', { community: g.community.toLowerCase() }], ['community trailing dot', { community: `${g.community}.` }],
    ['total +1', { total: fmt(fx.seeded + 1) }], ['total ungrouped', { total: String(fx.seeded) }], ['total empty', { total: '' }], ['total with unit', { total: `${fmt(fx.seeded)} squats` }],
    ['of old copy', { of: `/ ${fmt(fx.target)} confirmed` }], ['of capital', { of: `Of ${fmt(fx.target)} squats` }], ['of trailing dot', { of: `of ${fmt(fx.target)} squats.` }], ['of singular', { of: `of ${fmt(fx.target)} squat` }], ['of other unit', { of: `of ${fmt(fx.target)} steps` }], ['of other target', { of: `of ${fmt(fx.target + 1)} squats` }],
    ['fresh none', { fresh: [] }], ['fresh one line', { fresh: ['Live · confirmed totals'] }], ['fresh three lines', { fresh: ['Live · confirmed totals', 'updated 3 s ago', 'extra'] }], ['fresh swapped', { fresh: ['updated 3 s ago', 'Live · confirmed totals'] }],
    ['fresh first other', { fresh: ['Live · confirmed totals (beta)', 'updated 3 s ago'] }], ['fresh first lower', { fresh: ['live · confirmed totals', 'updated 3 s ago'] }], ['fresh second capital', { fresh: ['Live · confirmed totals', 'Updated 3 s ago'] }],
    ['fresh second no space', { fresh: ['Live · confirmed totals', 'updated 3s ago'] }], ['fresh second minutes', { fresh: ['Live · confirmed totals', 'updated 1 min ago'] }], ['fresh second trailing', { fresh: ['Live · confirmed totals', 'updated 3 s ago.'] }], ['fresh second no number', { fresh: ['Live · confirmed totals', 'updated s ago'] }],
    ['fresh first with nbsp', { fresh: ['Live · confirmed totals', 'updated 3 s ago'] }], ['page lacks the number', { page: 'nothing here' }], ['page has only a longer number', { page: g.page.replace(fmt(fx.seeded), `9${fmt(fx.seeded)}`) }],
  ];
  for (const [name, patch] of variants) {
    const r = { ...g, ...patch };
    const want = oracle(r, fx), got = displayVerdict(r, fx).ok;
    n += 1; if (want !== got) { (got ? (falsePass += 1) : (falseFail += 1)); console.log(got ? 'FALSE PASS' : 'FALSE FAIL', fx.seeded, name); }
    if (!want) wrong += 1;
  }
}
console.log(`displayVerdict: ${n} renders (${fxs.length} correct, ${wrong} wrong); false FAIL ${falseFail}; false PASS ${falsePass}`);
// stepVerdict
const steps = [['Step 2 of 2', true], ['STEP 2 OF 2', false], ['step 2 of 2', false], ['Step 2 of 2.', false], ['Step 2 of 3', false], ['Step 1 of 2', false], ['', false], ['Step 2 of 2 What should your community call you?', false], [' Step 2 of 2', false], [null, false], [undefined, false]];
let sb = 0; for (const [t, w] of steps) if (stepVerdict(t) !== w) { sb += 1; console.log('step verdict wrong for', JSON.stringify(t)); }
console.log(`stepVerdict: ${steps.length} inputs, ${sb} wrong`);
// display number formatting: en-GB equals en-US for integers and for up to 3 fraction digits; locale list for the record
const ints = [0, 1, 40, 120, 999, 1000, 1234, 12345, 100000, 1000000];
console.log('en-GB == en-US on integers:', ints.every((i) => new Intl.NumberFormat('en-GB').format(i) === new Intl.NumberFormat('en-US').format(i)), '| displayNumber == the product formatter:', ints.every((i) => displayNumber(i) === fmt(i)), '| FIXTURE_UNIT', FIXTURE_UNIT);
```

## Instrument 6: `text-diff.mjs` (where `textContent` differs from what a member sees)

Run in the Chromium the matrix drives. It differs for `text-transform` (the reason `exactText` exists), for a `visibility: hidden` leaf
(textContent keeps the copy, innerText reads empty), for a `<br>` (textContent glues the words) and for a hidden child (textContent adds its text).
`display: none`, `opacity: 0`, `font-size: 0` and a clipped leaf read the same either way, so the old `innerText` read was equally blind to them.

```js
// W7: where does a leaf's textContent differ from what a member sees (innerText), in the Chromium the matrix drives?
import { createRequire } from 'node:module';
const require = createRequire('/tmp/claude-0/-home-user-goarrive/7c5b4d17-88ae-5653-a067-ccc063331108/scratchpad/wt-A/apps/westayfit/package.json');
const { chromium } = require('playwright-core');
const clean = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
const cases = [
  ['plain leaf', '<p id=t>Step 2 of 2</p>'],
  ['text-transform: uppercase (the served .eyebrow)', '<style>.u{text-transform:uppercase}</style><p id=t class=u>Step 2 of 2</p>'],
  ['text-transform: lowercase', '<style>.l{text-transform:lowercase}</style><p id=t class=l>Step 2 of 2</p>'],
  ['visibility: hidden', '<p id=t style="visibility:hidden">Step 2 of 2</p>'],
  ['display: none', '<p id=t style="display:none">Step 2 of 2</p>'],
  ['opacity: 0', '<p id=t style="opacity:0">Step 2 of 2</p>'],
  ['font-size: 0', '<p id=t style="font-size:0">Step 2 of 2</p>'],
  ['clipped off-screen (sr-only style)', '<p id=t style="position:absolute;left:-9999px">Step 2 of 2</p>'],
  ['a <br> inside', '<p id=t>Step 2<br>of 2</p>'],
  ['a hidden child', '<p id=t>Step 2 of 2<span style="display:none"> (draft)</span></p>'],
  ['a visibility:hidden child', '<p id=t>Step 2 of 2<span style="visibility:hidden"> (draft)</span></p>'],
  ['aria-hidden child', '<p id=t>Step 2 of 2<span aria-hidden=true> *</span></p>'],
  ['a ::after content', '<style>.a::after{content:" (beta)"}</style><p id=t class=a>Step 2 of 2</p>'],
];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage();
console.log('case'.padEnd(52), 'textContent'.padEnd(26), 'innerText'.padEnd(26), 'same?  visible?');
for (const [name, html] of cases) {
  await page.setContent(`<body>${html}</body>`);
  const el = page.locator('#t');
  const tc = clean(await el.textContent()), it = clean(await el.innerText()), vis = await el.isVisible();
  console.log(name.padEnd(52), JSON.stringify(tc).padEnd(26), JSON.stringify(it).padEnd(26), tc === it ? 'same  ' : 'DIFFER', vis);
}
await browser.close();
```
