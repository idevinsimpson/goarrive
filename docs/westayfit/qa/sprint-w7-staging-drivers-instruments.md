# W7 Check 84 instruments: STAGING-TURN-DRIVERS-1 (inert)

Inert on this branch. These were written and run **outside the repository**, against a **detached worktree of #604 at
`7f42ba1c5bbfaae17578a351c02864f2839f5659`**, a second worktree of main `7cd5aad3` (the original drivers), and a third of the
served product **`ec162d17`** built with the emulator flags and served by the local Firebase emulators (`demo-wsf-local`).
Nothing was pushed to the PR. They are evidence for **Check 84** (report §84). They change no product code and no other
worker's file. **No hosted system, no staging project, no credential and no network write**: every URL the drivers and
the fixture kit would send to `googleapis.com`, `cloudfunctions.net` or the staging site is rewritten to the emulators.

## What they prove

| # | Instrument | Result | Why it can fail |
|---|---|---|---|
| 1 | `run.mjs`: the PR's **real** expo drivers and **real** `fixture-kit.mjs` against the real product on the emulators (the kit's hosted URLs rewritten) | **head 8 / 8 journeys, 33 / 33 rows**; the five timing-sensitive journeys **15 / 15 more** over three repeats. **Main's drivers on the same product: 5 of 6 fail** with run 61's own messages | the drivers are judged by the real product, not by the PR's model |
| 2 | `patch-smoke.py` + `preload.mjs`: an emulator-only copy of the Package E smoke that runs only the `hosted turn-service contract` row | **head PASS; main FAIL** `start the turn: application refusal (INVALID_ARGUMENT)`, run 61's message | the row against the real #587 server |
| 3 | `mut604.mjs`: 23 mutants that each weaken one driver check, judged by the PR's own `changed-journey-drivers.test.mjs` (118 tests) | **17 / 23 killed**; the 6 survivors are test-pin gaps, listed in report §84 | does the model-based suite notice a weakened driver |
| 4 | the structural smoke test, against main's smoke and 3 mutants | **kills all 4**: main's smoke, no `expectedTurn` on Start, none on the Record retry, a weakened ref pattern | the new `hosted-smoke-contract.test.mjs` pin |
| 5 | `static-fidelity.py`: every `wsf-` test id the drivers use, against the product source at `ec162d17` | 106 ids; 98 literal, 7 built by documented builders, 1 is a directory name | selector drift |

## Run them

```sh
# product at ec162d17: npm ci in apps/westayfit and functions-westayfit; tsc the functions; EXPO_PUBLIC_WSF_AUTH_ENABLED=1
# EXPO_PUBLIC_WSF_USE_EMULATORS=1 npm run build:web; firebase emulators:start --config firebase.westayfit.emulators.json --project demo-wsf-local
node run.mjs <wsf-staging dir> http://127.0.0.1:5010 two-station-turns,phone-and-stations-converge,station-lost-answer,line-place-ends,closed-goal-turn,shared-screen-finish
python3 patch-smoke.py <wsf-staging>/hosted-package-e-smoke.mjs smoke-head.mjs      # then, from the product worktree:
WSF_APPROVED_SHA=<40 hex> WSF_GOOGLE_ACCESS_TOKEN=owner WSF_SDK_CONFIG_FILE=sdk.json WSF_CLEANUP_MANIFEST=cleanup.json \
  node --import ./preload.mjs smoke-head.mjs        # sdk.json is {"projectId":"demo-wsf-local","apiKey":"fake-api-key"}
node mut604.mjs <detached #604 worktree>
```

## Instrument 1: `run.mjs`

```js
// W7 instrument for Check 84 (#604): run the PR's REAL drivers and REAL fixture kit against the LOCAL emulators and the
// real product build, by rewriting the kit's hosted URLs to the emulators. Nothing here reaches a hosted system.
// usage: node run.mjs <wsf-staging dir (head or base copy)> <baseUrl> <journey-id>[,<journey-id>...]
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const [, , stagingDir, baseUrl, idList] = process.argv;
const S = '/tmp/claude-0/-home-user-goarrive/7c5b4d17-88ae-5653-a067-ccc063331108/scratchpad';
const require = createRequire(`${S}/wt-A/apps/westayfit/package.json`);
const { chromium } = require('playwright-core');
const { createFixtureKit } = await import(pathToFileURL(path.join(stagingDir, 'journeys/fixture-kit.mjs')).href);
const { expoDrivers } = await import(pathToFileURL(path.join(stagingDir, 'journeys/expo-attendee.mjs')).href);

const PROJECT = 'demo-wsf-local';
const FS = 'http://127.0.0.1:8080', AUTH = 'http://127.0.0.1:9099', FN = `http://127.0.0.1:5001/${PROJECT}/us-central1`;
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
  // The emulator's admin signUp may ignore emailVerified: make it so, as the hosted admin path does.
  if (/accounts:signUp/.test(target) && init?.body && res.ok) {
    const sent = JSON.parse(init.body);
    if (sent.emailVerified) {
      const clone = res.clone();
      const { localId } = await clone.json();
      await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:update`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ localId, emailVerified: true }),
      });
    }
  }
  return res;
};
const runTag = `w7-${Date.now().toString(36)}`;
const fixtures = createFixtureKit({
  projectId: PROJECT, apiKey: 'fake-api-key', token: 'owner', runTag, cleanupManifest: `${S}/emu604/cleanup-${runTag}.json`, fetchImpl, functionsBase: FN,
});

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
let failed = 0;
for (const id of idList.split(',')) {
  const driver = expoDrivers[id];
  if (!driver) { console.log(`NO-DRIVER ${id}`); failed++; continue; }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
  const page = await context.newPage();
  const started = Date.now();
  let out;
  try {
    out = await driver({ page, baseUrl, fixtures, journey: { id } });
  } catch (e) {
    out = { error: String(e?.message ?? e).split('\n')[0].slice(0, 300), assertions: [] };
  }
  await context.close().catch(() => {});
  const bad = (out.assertions ?? []).filter((a) => !a.ok);
  const pass = !out.error && bad.length === 0 && (out.assertions ?? []).length > 0;
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} (${Math.round((Date.now() - started) / 1000)}s) assertions ${(out.assertions ?? []).length - bad.length}/${(out.assertions ?? []).length}${out.error ? ` ERROR: ${out.error}` : ''}`);
  for (const a of bad) console.log(`     ✘ ${a.expected}`);
}
await browser.close();
console.log(`${failed === 0 ? 'ALL PASSED' : `${failed} FAILED`}`);
process.exit(failed ? 1 : 0);
```

## Instrument 2a: `preload.mjs`

```js
// W7 instrument: rewrite the hosted smoke's URLs to the local emulators. Nothing here reaches a hosted system.
const real = globalThis.fetch;
const FN = 'http://127.0.0.1:5001/demo-wsf-local/us-central1';
globalThis.fetch = async (url, init) => {
  let u = String(url?.url ?? url), m;
  if ((m = /^https:\/\/us-central1-[a-z0-9-]+\.cloudfunctions\.net\/(.*)$/.exec(u))) u = `${FN}/${m[1]}`;
  else if ((m = /^https:\/\/firestore\.googleapis\.com\/(.*)$/.exec(u))) u = `http://127.0.0.1:8080/${m[1]}`;
  else if ((m = /^https:\/\/identitytoolkit\.googleapis\.com\/(.*)$/.exec(u))) u = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/${m[1]}`;
  const res = await real(u, init);
  if (/accounts:signUp/.test(u) && init?.body && res.ok) {
    try {
      const sent = JSON.parse(init.body);
      if (sent.emailVerified) { const { localId } = await res.clone().json(); await real('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:update', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ localId, emailVerified: true }) }); }
    } catch { /* leave as is */ }
  }
  return res;
};
```

## Instrument 2b: `patch-smoke.py`

```python
# W7: make an emulator-only copy of the Package E smoke that runs ONLY the 'hosted turn-service contract' row.
# usage: python3 patch-smoke.py <smoke.mjs> <out.mjs>
import sys
src, out = sys.argv[1], sys.argv[2]
t = open(src).read()
t = t.replace("const PROJECT_ID = 'westayfit-staging';", "const PROJECT_ID = 'demo-wsf-local';")
t = t.replace("const BASE_URL = 'https://westayfit-staging--staging-4a616y5m.web.app';", "const BASE_URL = 'http://127.0.0.1:5010';")
t = t.replace("await verifyHostedBuild();", "/* W7: hosted build marker check skipped (emulator run) */")
t = t.replace("chromium.launch({ headless: true })", "chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' })")
start = t.index("  await isolated('station callable transport'")
end = t.index("} catch (error) {\n  mainError = error;")
keep = "  await isolated('hosted turn-service contract', () => caseTurnContract());\n"
assert keep in t[start:end]
open(out, 'w').write(t[:start] + keep + t[end:])
```

## Instrument 3: `mut604.mjs`

```js
// W7 mutants of .github/wsf-staging/journeys/expo-attendee.mjs (#604): each WEAKENS one driver check; the PR's own
// changed-journey-drivers.test.mjs (118 tests, hermetic model) must fail. Applied in a DETACHED worktree, restored after.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const WT = process.argv[2];
const FILE = `${WT}/.github/wsf-staging/journeys/expo-attendee.mjs`;
const orig = fs.readFileSync(FILE, 'utf8');
const M = [
  ['sayReady does not wait for the call to show', "need(await shown(phone, 'wsf-queue-ready', 25_000), `${name}'s phone never showed the call, so I'm ready was never offered`);", "await shown(phone, 'wsf-queue-ready', 25_000);"],
  ['sayReady ignores a tap that did nothing', "need(await tap(phone, 'wsf-queue-ready'), `${name}'s phone could not press I'm ready`);", "await tap(phone, 'wsf-queue-ready');"],
  ['readyThenStart ignores Start never opening', "need(await enabled(station, 'wsf-station-turn-action', 25_000), `${where} never offered Start their turn after ${name} said ready`);", "await enabled(station, 'wsf-station-turn-action', 25_000);"],
  ['readyThenStart ignores no turn beginning', "need(await startTurn(station), `${where} pressed Start their turn and no turn began`);", "await startTurn(station);"],
  ['the lease bounds are not checked', "const stood = offeredFor >= 40 && offeredFor <= 45 && lastSeconds <= 3;", "const stood = true;"],
  ['the countdown need not reach its last seconds', "const stood = offeredFor >= 40 && offeredFor <= 45 && lastSeconds <= 3;", "const stood = offeredFor >= 40 && offeredFor <= 45;"],
  ['a long lease is accepted', "const stood = offeredFor >= 40 && offeredFor <= 45 && lastSeconds <= 3;", "const stood = offeredFor >= 40 && lastSeconds <= 3;"],
  ['a short lease is accepted', "const stood = offeredFor >= 40 && offeredFor <= 45 && lastSeconds <= 3;", "const stood = offeredFor <= 45 && lastSeconds <= 3;"],
  ['the notice need not name both heading and reason', "return reason === NO_SHOW && Boolean(heading?.includes('Your turn timed out'));", "return reason === NO_SHOW || Boolean(heading?.includes('Your turn timed out'));"],
  ['the countdown format is not read', "const LEASE_LEFT = /^\\d+s to say you’re coming$/;", "const LEASE_LEFT = /\\d+/;"],
  ['sameWords accepts any text', "const sameWords = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();", "const sameWords = () => true;"],
  ['sameWords accepts a wrong figure (compares words only)', "a.toLowerCase() === b.toLowerCase();", "a.toLowerCase().replace(/\\d+/g, '#') === b.toLowerCase().replace(/\\d+/g, '#');"],
  ['leftover values are not looked for', "const carries = (text, values) => values.filter((v) => text.toLowerCase().includes(v.toLowerCase()));", "const carries = () => [];"],
  ['leftover values are matched case-sensitively again', "const carries = (text, values) => values.filter((v) => text.toLowerCase().includes(v.toLowerCase()));", "const carries = (text, values) => values.filter((v) => text.includes(v));"],
  ['closed ready row does not read the sentence', "row('ready')(pressedReady && cSaid === CLOSED && stillCalled && where === 'Go to Station 1.',", "row('ready')(pressedReady && stillCalled && where === 'Go to Station 1.',"],
  ['closed call row does not require nobody served', "row('call')(pressedCall && t2Said === CLOSED && servesNobody &&", "row('call')(pressedCall && t2Said === CLOSED &&"],
  ['the second event is never closed', "    await fixtures.closeGoal(ev2);\n", ""],
  ['the second event total is not checked after the closure', "&& before2 === '200 of 1,000 squats' && after2 === '200 of 1,000 squats' && noResult,", "&& noResult,"],
  ['lost answer: the retry count is not checked', "completes === 2 && total === '125 of 1,000 squats'", "total === '125 of 1,000 squats'"],
  ['lost answer: the kept count is not checked', "row('kept')(told && keptCount === '25' && keptTurn,", "row('kept')(told && keptTurn,"],
  ['two stations: the other member\'s ready may open Start', "row('ready')(bothShut && s2Open && s1StillShut && s1Open,", "row('ready')(bothShut && s2Open && s1Open,"],
  ['the no-show sentence constant is altered', "const NO_SHOW = 'The screen called you and the 45 seconds ran out, so it moved on.", "const NO_SHOW = 'The screen called you and the 30 seconds ran out, so it moved on."],
  ['the first event total is read from a station again', "const before = await textWhen(display, 'wsf-kiosk-total-line', (t) => t === '200 of 1,000 squats', 25_000);", "const before = await textWhen(s1, 'wsf-station-total-line', (t) => t === '200 of 1,000 squats', 25_000);"],
];
const results = [];
try {
  for (const [name, from, to] of M) {
    const n = orig.split(from).length - 1;
    if (n !== 1) { console.log(`NOT-APPLICABLE ${name} (${n} matches)`); continue; }
    fs.writeFileSync(FILE, orig.replace(from, to));
    const r = spawnSync(process.execPath, ['.github/wsf-staging/tests/changed-journey-drivers.test.mjs'], { cwd: WT, encoding: 'utf8', timeout: 300_000 });
    fs.writeFileSync(FILE, orig);
    const killed = r.status !== 0;
    results.push([name, killed]);
    console.log(`${killed ? 'killed  ' : 'SURVIVED'} ${name}`);
  }
} finally { fs.writeFileSync(FILE, orig); }
console.log(`${results.filter((x) => x[1]).length}/${results.length} killed (${M.length} defined)`);
```

## Instrument 5: `static-fidelity.py`

```python
# W7: every wsf- test id the PR's drivers use must exist in the product source at the served commit (a literal, or a documented builder).
# usage: python3 static-fidelity.py <wsf-staging dir> <product dir with apps/westayfit/{app,src}>
import re, os, sys
W, P = sys.argv[1], sys.argv[2]
ids = {}
for f in ['journeys/expo-attendee.mjs', 'hosted-player-journey.mjs', 'journeys/helpers.mjs', 'journeys/fixture-kit.mjs']:
    for m in re.finditer(r"['\"`](wsf-[a-z0-9-]+)['\"`]", open(f'{W}/{f}').read()):
        ids.setdefault(m.group(1), set()).add(f)
prod = ''
for root, _, files in os.walk(f'{P}/apps/westayfit'):
    for fn in files:
        if fn.endswith(('.ts', '.tsx')): prod += open(os.path.join(root, fn), errors='ignore').read() + '\n'
missing = [i for i in sorted(ids) if i not in prod]
print(len(ids), 'distinct ids;', len(missing), 'not literal in the product:', missing)
# then: DeviceChoice.tsx builds `${testID}-personal|shared`; FollowAlongCard.tsx builds `${testIDPrefix}-start|pause|stop|timer`;
# wsf-player-results is a results DIRECTORY constant in hosted-player-journey.mjs, not a test id.
```

## Instrument 6: `rowdiff.py` (no assertion removed or weakened)

Run over main's and the head's `journeys/expo-attendee.mjs`: **42 rows in both, none removed, none added.** Seven of main's conjuncts are replaced or moved and eight
conjuncts are new in the head, all by relocation or by an equal-or-stronger replacement: `closedGoalTurn.call` and `.ready` name the second event's stations (`t2Said`,
`Go to Station 1.`); `linePlaceEnds.letGo` gains `letGo`; in `linePlaceEnds.noShow` the heading and reason conjuncts move inside `timedOut`,
beside the new `stood` (the lease bounds); `sharedScreenFinish.finish` and `.next` compare the whole credit text case-blind
(`isCredit(n)`, a full-string comparison, so a wrong figure or wording still fails).

```python
import re, sys
# W7: compare every assertion row's top-level && conjuncts between main's driver and the PR's driver.
# usage: python3 rowdiff.py <main expo-attendee.mjs> <head expo-attendee.mjs>
def rows(src):
    out = {}
    heads = [(m.start(), m.group(1)) for m in re.finditer(r"^async function (\w+)\(", src, re.M)]
    for m in re.finditer(r"row\('(\w+)'\)\(", src):
        i = m.end(); depth = 1; j = i; arg_end = None
        while depth > 0:
            c = src[j]
            if c in '([{': depth += 1
            elif c in ')]}': depth -= 1
            elif c == ',' and depth == 1 and arg_end is None: arg_end = j
            j += 1
        expr = src[i:(arg_end if arg_end else j - 1)]
        fn = [n for p, n in heads if p < m.start()][-1]
        terms = []; d = 0; cur = ''; k = 0
        while k < len(expr):
            c = expr[k]
            if c in '([{': d += 1
            elif c in ')]}': d -= 1
            if d == 0 and expr[k:k + 2] == '&&': terms.append(cur.strip()); cur = ''; k += 2; continue
            cur += c; k += 1
        terms.append(cur.strip())
        out[(fn, m.group(1))] = [re.sub(r'\s+', ' ', t) for t in terms]
    return out
base, head = rows(open(sys.argv[1]).read()), rows(open(sys.argv[2]).read())
print('rows base', len(base), 'head', len(head), '| removed', sorted(set(base) - set(head)), '| added', sorted(set(head) - set(base)))
for k in sorted(set(base) & set(head)):
    gone = [t for t in base[k] if t not in head[k]]; new = [t for t in head[k] if t not in base[k]]
    if gone or new:
        print(k); [print('  - base only:', t[:160]) for t in gone]; [print('  + head only:', t[:160]) for t in new]
```
