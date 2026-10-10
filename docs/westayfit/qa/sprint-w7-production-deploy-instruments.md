# W7 Check 83 instruments: PRODUCTION-DEPLOY-PATH-1 (inert)

Inert on this branch. These were written and run **outside the repository**, against a **detached worktree of #600 at
`dfd48c87ee36710e47c19f0b6e70e3ab7a71e246`**, scratch worktrees of the real anchors A (`ec162d17`) and G (`e65bfee9`), and the
pinned `firebase-tools@15.30.1` and `firebase-functions@4.9.0` tarballs unpacked outside the repo. Nothing was pushed to the
PR. They are evidence for **Check 83** (report §83). They change no product code, no workflow and no other worker's test.
**No network write, no `gcloud`, no `firebase` command, no credential, no production access.** The only network reads were
`git fetch` of the development branch and two `npm pack` downloads of public packages.

## What they prove

| # | Instrument | Result | Why it can fail |
|---|---|---|---|
| 1 | `mut600.mjs`: 43 mutants of `.github/wsf-production/preflight.mjs`, each judged by the PR's own `preflight.test.mjs` (43 tests) | **40 / 43 killed** | each mutant removes one guard: the command pins, the anchors, the G delta, the rules, index and config checks, the worktree and env-file checks, the consent checks |
| 1b | the 3 survivors, shown to hold in the real code | bare `--only hosting` (refused on the real tree), `candidate.not-main` same-tree (redundant for A and G), a config with a second codebase (caught by `config.equals-main`) | test gaps, not product defects |
| 2 | `envdiff.mjs`: the pre-flight's copy of firebase-tools' dotenv parser against the **real** `lib/functions/env.js` extracted from the pinned tarball | 26 crafted + 6000 random inputs, **0 differences**; 0 passed the guard while firebase-tools would upload a foreign or extra value | the claim "it matches the real parser" |
| 2b | `envdiff2.mjs`: 20000 structured hostile env files (valid base lines plus smuggling lines) | **3871 pass the guard** (so the check is not vacuous), **0 smuggled** | |
| 3 | `run1.sh`: real-tree runs of the pre-flight on scratch worktrees of A and G | see report §83 (A and G `ok: true`, 7 controls pass; 29 attacks refused) | the guard's own claims, on the real anchors |
| 4 | `run.sh` + the extraction step: the runbook's own `capture_rules`, `wsf_count` and `wsf_memberships` run against stubbed `gcloud` and `curl` | correct output, valid JSON queries, token never written, both failure paths exit 1 | the runbook's step-0 code |

## Instrument 1: `mut600.mjs`

```js
// W7 mutants of .github/wsf-production/preflight.mjs (#600). Each applies in a DETACHED worktree and is judged by the PR's own
// preflight.test.mjs (node --test); the file is restored after every mutant. Usage: node mut600.mjs <worktree>
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const WT = process.argv[2];
const FILE = `${WT}/.github/wsf-production/preflight.mjs`;
const orig = fs.readFileSync(FILE, 'utf8');
const M = [
  ['--force no longer refused', "if (flags.some((f) => f === '--force' || f === '-f' || f.startsWith('--force='))) problems.push(", "if (false) problems.push("],
  ['-f alias no longer refused', "f === '--force' || f === '-f' ||", "f === '--force' ||"],
  ['--non-interactive no longer required', "if (!flags.includes('--non-interactive')) problems.push('--non-interactive is required", "if (false) problems.push('--non-interactive is required"],
  ['firestore:indexes allowed', "new Set([`functions:${WSF_CODEBASE}`, 'firestore:rules'])", "new Set([`functions:${WSF_CODEBASE}`, 'firestore:rules', 'firestore:indexes'])"],
  ['hosting allowed', "new Set([`functions:${WSF_CODEBASE}`, 'firestore:rules'])", "new Set([`functions:${WSF_CODEBASE}`, 'firestore:rules', 'hosting'])"],
  ['--project no longer pinned', "if ((value('--project') ?? value('-P')) !== PRODUCTION_PROJECT) problems.push(", "if (false) problems.push("],
  ['--config no longer pinned', "if ((value('--config') ?? value('-c')) !== PRODUCTION_CONFIG) problems.push(", "if (false) problems.push("],
  ['several --only targets allowed', "if (targets.length !== 1) problems.push(", "if (false) problems.push("],
  ['semicolon allowed in the command', "if (/[\"'`$;|&<>]/.test(String(command)))", "if (/[\"'`$|&<>]/.test(String(command)))"],
  ['a repeated flag is allowed', "if (seen.has(canon)) problems.push(", "if (false) problems.push("],
  ['an unknown flag is allowed', "if (!known.has(base)) problems.push(", "if (false) problems.push("],
  ['candidate may be main (tree test dropped)', "candidate !== main && git(repo, ['rev-parse', `${candidate}^{tree}`]) !== git(repo, ['rev-parse', `${main}^{tree}`])", "candidate !== main"],
  ['record A accepts any candidate', "check('candidate.is-anchor-A', candidate === anchor,", "check('candidate.is-anchor-A', true,"],
  ['record G accepts any candidate', "check('candidate.is-anchor-G', candidate === anchorG,", "check('candidate.is-anchor-G', true,"],
  ['G need not change exactly the four paths', "const exact = descends && JSON.stringify(changed) === JSON.stringify([...CANDIDATE_G_DELTA_PATHS].sort());", "const exact = descends;"],
  ['G need not descend from A', "const descends = candidate !== anchor && gitOk(repo, ['merge-base', '--is-ancestor', anchor, candidate]);\n    const changed = descends ? git(repo, ['diff', '--name-only', anchor, candidate])", "const descends = true;\n    const changed = descends ? git(repo, ['diff', '--name-only', anchor, candidate])"],
  ['rules outside the WSF section may differ from main', "check('rules.outside-wsf-equals-main', cand.outside === main.outside,", "check('rules.outside-wsf-equals-main', true,"],
  ['live rules may differ from main', "const lawful = live.outside === main.outside && liveScope.ok;", "const lawful = true;"],
  ['the WSF section may match non-wsf paths', "return { bad, balanced, ok: bad.length === 0 && balanced };", "return { bad, balanced, ok: balanced };"],
  ['the catch-all need not be last', "check('rules.catch-all-last', cand.wellFormed,", "check('rules.catch-all-last', true,"],
  ['index drops are allowed', "check('indexes.additive', missing.length === 0 && foMissing.length === 0,", "check('indexes.additive', true,"],
  ['non-wsf index additions are allowed', "check('indexes.wsf-only-additions', nonWsfAdded.length === 0 && foNonWsf.length === 0,", "check('indexes.wsf-only-additions', true,"],
  ['config may hold two codebases', "const fnOk = fns.length === 1 && fns[0].codebase === WSF_CODEBASE && fns[0].source === WSF_SOURCE;", "const fnOk = fns.length >= 1 && fns[0].codebase === WSF_CODEBASE && fns[0].source === WSF_SOURCE;"],
  ['config may differ from main', "const sameAsMain = JSON.stringify(config) === JSON.stringify(JSON.parse(show(repo, main, PRODUCTION_CONFIG)));", "const sameAsMain = true;"],
  ['the export manifest is not enforced', "check('exports.match-manifest', missing.length === 0 && extra.length === 0 && dupes.length === 0,", "check('exports.match-manifest', true,"],
  ['a wildcard re-export is allowed', "check('exports.no-wildcard', !wildcard,", "check('exports.no-wildcard', true,"],
  ['the worktree may be anywhere (HEAD unchecked)', "check('worktree.at-candidate', head === candidate,", "check('worktree.at-candidate', true,"],
  ['stray files are allowed (ignored too)', "check('worktree.clean', dirty.length === 0,", "check('worktree.clean', true,"],
  ['a stray functions .env is allowed', "`!! ${WSF_SOURCE}/lib/`]);", "`!! ${WSF_SOURCE}/lib/`, `!! ${WSF_SOURCE}/.env`, `?? ${WSF_SOURCE}/.env`]);"],
  ['the deploy may run from elsewhere', "const same = here !== null && here === there;", "const same = true;"],
  ['the env action handler is not pinned', "if ('WSF_AUTH_ACTION_HANDLER' in env && env.WSF_AUTH_ACTION_HANDLER !== PRODUCTION_ACTION_HANDLER) {", "if (false) {"],
  ['the env file need not read the same through firebase-tools', "if (!sameRead) bad.push(", "if (false) bad.push("],
  ['WSF_APP_URL is not pinned', "if (env.WSF_APP_URL !== WSF_APP_URL) problems.push(", "if (false) problems.push("],
  ['extra env keys (a secret) are allowed', "if (extra.length) problems.push(", "if (false) problems.push("],
  ['the sender need not be westay.fit', "if (!/@westay\\.fit>?$/.test(env.WSF_EMAIL_FROM ?? '')) problems.push(", "if (false) problems.push("],
  ['a rules deploy needs no live ruleset', "checks.push(check('rules.live-ruleset-supplied', liveRules !== undefined,", "checks.push(check('rules.live-ruleset-supplied', true,"],
  ['a deploy needs no worktree', "checks.push(check('worktree.supplied', worktree !== undefined,", "checks.push(check('worktree.supplied', true,"],
  ['an unreviewed interactive reason is accepted', "} else if (!INTERACTIVE_REASONS.includes(interactiveReason)) {", "} else if (false) {"],
  ['the interactive form may target anything', "if (value('--only') !== `functions:${WSF_CODEBASE}`) problems.push(`the ${interactiveReason} form applies only to", "if (false) problems.push(`the ${interactiveReason} form applies only to"],
  ['a pending consent version passes for B', "const approved = CONSENT_NAMES.every((n) => isApprovedVersion(consent[n].server) && isApprovedVersion(consent[n].client));", "const approved = true;"],
  ['server and client consent may disagree', "const agree = CONSENT_NAMES.every((n) => consent[n].server !== null && consent[n].server === consent[n].client);", "const agree = true;"],
  ['B may change code beyond consent', "check('candidate.B-code-equals-A-except-consent', sameServer && sameClient,", "check('candidate.B-code-equals-A-except-consent', true,"],
  ['a missing candidate file crashes instead of refusing', "const filesOk = candMissing.length === 0 && mainMissing.length === 0;", "const filesOk = true;"],
];
const results = [];
try {
  for (const [name, from, to] of M) {
    const n = orig.split(from).length - 1;
    if (n !== 1) { console.log(`NOT-APPLICABLE ${name} (${n} matches)`); continue; }
    fs.writeFileSync(FILE, orig.replace(from, to));
    const r = spawnSync(process.execPath, ['--test', '.github/wsf-production/preflight.test.mjs'], { cwd: WT, encoding: 'utf8', timeout: 400_000 });
    fs.writeFileSync(FILE, orig);
    const killed = r.status !== 0;
    results.push([name, killed]);
    console.log(`${killed ? 'killed  ' : 'SURVIVED'} ${name}`);
  }
} finally { fs.writeFileSync(FILE, orig); }
console.log(`${results.filter((x) => x[1]).length}/${results.length} killed (${M.length} defined)`);
```

## Instrument 2: `envdiff.mjs`

```js
// W7 differential test: the pre-flight's copy of firebase-tools 15.30.1's dotenv parser versus the REAL one,
// extracted from the pinned tarball's lib/functions/env.js (LINE_RE, the escape tables and parse()), on crafted + random inputs.
import fs from 'node:fs';
import vm from 'node:vm';
import { firebaseToolsEnvParse, checkEnvFile } from './preflight.orig.mjs';
const S = '/tmp/claude-0/-home-user-goarrive/7c5b4d17-88ae-5653-a067-ccc063331108/scratchpad';
const src = fs.readFileSync(`${S}/ft600/ft/package/lib/functions/env.js`, 'utf8');
const pick = (start, end) => src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start)));
const body = [
  pick('const LINE_RE', 'const ESCAPE'),
  src.slice(src.indexOf('const ESCAPE_SEQUENCES_TO_CHARACTERS'), src.indexOf('const CHARACTERS_TO_ESCAPE_SEQUENCES')),
  src.slice(src.indexOf('function parse(data)'), src.indexOf('class KeyValidationError')),
].join('\n');
const ctx = {}; vm.createContext(ctx); vm.runInContext(body + '\nthis.parse = parse;', ctx);
const real = ctx.parse;
const H = 'https://goarrive.firebaseapp.com/__/auth/action';
const crafted = [
  'WSF_APP_URL=https://app.westay.fit\nWSF_EMAIL_FROM=We Stay Fit <a@westay.fit>\n',
  `WSF_APP_URL=https://app.westay.fit\nWSF_AUTH_ACTION_HANDLER="${H}\nWSF_AUTH_ACTION_HANDLER=https://evil.example/x"\n`,
  'A="line1\nline2"\nB=2\n', "A='x\ny'\n", 'A="x\\ny"\n', 'A="q\\"q"\n', "A='q\\'q'\n", 'A=1 # c\nB=2\n', 'A="1" # c\n', 'export A=1\n', 'A = 1\n', 'A=\n', '# only\n', 'A=1\r\nB=2\r\n', 'A=1\rB=2\r', 'A="x\n# not a comment\nB=3"\n',
  'A=1\nA=2\n', '=bad\n', 'A B=1\n', 'A=\t1\n', 'A="unterminated\nB=2\n', "A='u\nB=2\n", 'a.b/c=1\n', 'A=1;B=2\n', 'A="\\\\"\n', 'A=\\n\n',
];
const alpha = ['A', 'B', 'WSF_X', '=', '"', "'", '\n', '\r', '\r\n', ' ', '\t', '#', '\\', 'n', 'x', 'export ', '1', '/', '.', '\f', '\v'];
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const random = Array.from({ length: 6000 }, () => Array.from({ length: 1 + Math.floor(rnd() * 24) }, () => alpha[Math.floor(rnd() * alpha.length)]).join(''));
let bad = 0;
for (const t of [...crafted, ...random]) {
  const a = JSON.stringify(real(t)), b = JSON.stringify(firebaseToolsEnvParse(t));
  if (a !== b) { bad++; if (bad <= 3) console.log('DIFF', JSON.stringify(t), '\n real', a, '\n copy', b); }
}
console.log(`parser differential: ${crafted.length} crafted + ${random.length} random inputs, ${bad} differences`);
// And the guard: no input that firebase-tools reads with a foreign handler may pass checkEnvFile.
let smuggled = 0, total = 0;
for (const t of [...crafted, ...random]) {
  const env = real(t).envs; const h = env.WSF_AUTH_ACTION_HANDLER;
  const verdict = checkEnvFile(t)[0].ok;
  total++;
  if (verdict && ((h !== undefined && h !== H) || env.WSF_APP_URL !== 'https://app.westay.fit' || Object.keys(env).some((k) => !['WSF_EMAIL_FROM', 'WSF_APP_URL', 'WSF_AUTH_ACTION_HANDLER'].includes(k)))) { smuggled++; if (smuggled <= 3) console.log('SMUGGLED', JSON.stringify(t)); }
}
console.log(`guard: ${total} inputs, ${smuggled} passed the guard while firebase-tools would upload a foreign/extra value`);
```

## Instrument 2b: `envdiff2.mjs`

```js
import fs from 'node:fs';
import vm from 'node:vm';
import { checkEnvFile } from './preflight.orig.mjs';
const S = '/tmp/claude-0/-home-user-goarrive/7c5b4d17-88ae-5653-a067-ccc063331108/scratchpad';
const src = fs.readFileSync(`${S}/ft600/ft/package/lib/functions/env.js`, 'utf8');
const body = [src.slice(src.indexOf('const LINE_RE'), src.indexOf('const ESCAPE')), src.slice(src.indexOf('const ESCAPE_SEQUENCES_TO_CHARACTERS'), src.indexOf('const CHARACTERS_TO_ESCAPE_SEQUENCES')), src.slice(src.indexOf('function parse(data)'), src.indexOf('class KeyValidationError'))].join('\n');
const ctx = {}; vm.createContext(ctx); vm.runInContext(body + '\nthis.parse = parse;', ctx);
const real = ctx.parse;
const H = 'https://goarrive.firebaseapp.com/__/auth/action';
const must = ['WSF_APP_URL=https://app.westay.fit', 'WSF_EMAIL_FROM="We Stay Fit <noreply@westay.fit>"'];
const hostile = [`WSF_AUTH_ACTION_HANDLER=${H}`, 'WSF_AUTH_ACTION_HANDLER=https://evil.example/a', `WSF_AUTH_ACTION_HANDLER="${H}`, 'X="', "X='", '# "', '#', 'WSF_APP_URL=https://evil.example', 'WSF_APP_URL="https://evil.example"', '  WSF_AUTH_ACTION_HANDLER = https://evil.example/b', 'WSF_AUTH_ACTION_HANDLER="https://evil.example/c" # x', 'export WSF_AUTH_ACTION_HANDLER=https://evil.example/d', 'WSF_EMAIL_API_KEY=k', 'FOO=bar', '"', "'", '\\', 'WSF_AUTH_ACTION_HANDLER=https://evil.example/e\\', 'A="x#y"', 'WSF_AUTH_ACTION_HANDLER=\'https://evil.example/f\'', 'WSF_APP_URL=https://app.westay.fit # c', 'WSF_EMAIL_FROM=\'We <x@westay.fit>\'', `WSF_AUTH_ACTION_HANDLER=${H}  `, 'wsf_auth_action_handler=https://evil.example/g'];
let seed = 99; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pickOne = (a) => a[Math.floor(rnd() * a.length)];
let total = 0, passed = 0, smuggled = 0;
for (let i = 0; i < 20000; i++) {
  const lines = [...must];
  const n = Math.floor(rnd() * 5);
  for (let k = 0; k < n; k++) lines.splice(Math.floor(rnd() * (lines.length + 1)), 0, pickOne(hostile));
  const t = lines.join(pickOne(['\n', '\r\n', '\n\n', '\r'])) + pickOne(['', '\n']);
  total++;
  const ok = checkEnvFile(t)[0].ok;
  const env = real(t).envs;
  const foreign = (env.WSF_AUTH_ACTION_HANDLER !== undefined && env.WSF_AUTH_ACTION_HANDLER !== H) || env.WSF_APP_URL !== 'https://app.westay.fit' || Object.keys(env).some((k) => !['WSF_EMAIL_FROM', 'WSF_APP_URL', 'WSF_AUTH_ACTION_HANDLER'].includes(k)) || !/@westay\.fit>?$/.test(env.WSF_EMAIL_FROM ?? '');
  if (ok) { passed++; if (foreign) { smuggled++; if (smuggled <= 3) console.log('SMUGGLED', JSON.stringify(t)); } }
}
console.log(`structured hostile env files: ${total}; passed the guard: ${passed} (non-vacuity); passed while firebase-tools would upload a foreign or extra value: ${smuggled}`);
```

## Instrument 3: `run1.sh`

```bash
#!/bin/bash
# usage: run1.sh label dir cwd livefile command
S=/tmp/claude-0/-home-user-goarrive/7c5b4d17-88ae-5653-a067-ccc063331108/scratchpad
label="$1"; dir="$2"; cwd="$3"; live="$4"; cmd="$5"
A=ec162d17a0540e936741027f9b8f90dd372cfaf4; MAIN=dfd48c87ee36710e47c19f0b6e70e3ab7a71e246
args=(--repo /home/user/goarrive --record A --candidate $A --main $MAIN --config $dir/firebase.westayfit.production.json --worktree $dir --command "$cmd")
[ "$live" != "-" ] && args+=(--live-rules "$live")
( cd "$cwd" && node $S/pf600/preflight.orig.mjs "${args[@]}" > $S/pf600/v.json 2>$S/pf600/v.err; echo $? > $S/pf600/v.code )
python3 - "$label" <<'PY'
import json,sys
S='/tmp/claude-0/-home-user-goarrive/7c5b4d17-88ae-5653-a067-ccc063331108/scratchpad/pf600'
code=open(S+'/v.code').read().strip()
try: v=json.load(open(S+'/v.json'))
except Exception: print(f"{sys.argv[1]:<50} exit={code} NO-JSON stderr={open(S+'/v.err').read()[:100]!r}"); raise SystemExit
bad=[c['id'] for c in v.get('checks',[]) if not c['ok']]
print(f"{sys.argv[1]:<50} exit={code} ok={v.get('ok')} {('usage='+v['usage'][:70]) if 'usage' in v else ''} refused={bad}")
PY
```

## Instrument 4: `run.sh` (stubbed step-0 functions)

The function definitions are extracted from the runbook's own step-0.4 block (the text from `capture_rules() {` to just before the
final `wsf_memberships` call) into `fns.sh`, so the code under test is the document's, not a copy.

```bash
set -u
gcloud() { echo "FAKE_TOKEN_DO_NOT_PRINT"; }
curl() {
  local url="${@: -1}"
  case "$url" in
    *releases/cloud.firestore) echo '{"name":"projects/goarrive/releases/cloud.firestore","rulesetName":"projects/goarrive/rulesets/abc123"}';;
    *rulesets/abc123) printf '%s' '{"source":{"files":[{"name":"firestore.rules","content":"rules_version = 2;\nservice cloud.firestore {}\n"}]}}';;
    *runAggregationQuery) cat > q.last.json; if grep -q membershipStatus q.last.json; then cp q.last.json q.active.json; echo '[{"result":{"aggregateFields":{"n":{"integerValue":"7"}}}}]'; else cp q.last.json q.all.json; echo '[{"result":{"aggregateFields":{"n":{"integerValue":"9"}}}}]'; fi;;
    *) echo "UNEXPECTED URL $url" >&2; return 22;;
  esac
}
source ./fns.sh
echo "== capture_rules"; capture_rules out.rules; echo "exit:$?"; echo "file: $(wc -c < out.rules) bytes, first line: $(head -n1 out.rules)"
echo "files containing the token: $(grep -l FAKE_TOKEN out.rules rules-release.json 2>/dev/null | wc -l)"
echo "== wsf_memberships (stub: 9 all, 7 active)"; wsf_memberships; echo "exit:$?"
python3 -c "
import json
a=json.load(open('q.all.json')); b=json.load(open('q.active.json'))
print('all-query valid JSON, from:',a['structuredAggregationQuery']['structuredQuery']['from'],'where' in a['structuredAggregationQuery']['structuredQuery'])
print('active-query valid JSON, filter:',b['structuredAggregationQuery']['structuredQuery']['where']['fieldFilter'])"
echo "== failure paths"
curl() { return 22; }; capture_rules out2.rules; echo "exit on read failure: $?"
gcloud() { return 1; }; capture_rules out3.rules; echo "exit with no token: $?"
```

## Instrument 5: `harness.sh` (the runbook's step-6 and step-7 chains, stubbed externals)

`step6.sh` and `step7.sh` are the runbook's own blocks, extracted by the same step as instrument 4 (the blocks containing
`npm --prefix functions-westayfit ci` and `capture_rules live-firestore.rules \`). Every external (`capture_rules`, `PF`,
`firebase`, `npm`) is a stub that logs its call. Result: in step 7 a failed re-read, a changed live ruleset and a refused
pre-flight each stop before `firebase` is called and print `STOP`; a failed deploy prints `STOP` after the call; only the
all-ok case calls `firebase` and prints no `STOP`. In step 6 a refused pre-flight stops the deploy.

```bash
# usage: harness.sh <case> ; every external is a stub that logs; HOME is a scratch dir
case_name="$1"; export HOME=/tmp/claude-0/-home-user-goarrive/7c5b4d17-88ae-5653-a067-ccc063331108/scratchpad/chain600/home-$case_name
mkdir -p "$HOME/wsf-prod" "$HOME/cand"; export CAND="$HOME/cand"; LOG="$HOME/calls.log"; : > "$LOG"
printf 'RULES-V1\n' > "$HOME/wsf-prod/live-firestore.rules.step0"
capture_rules() { echo "capture_rules $1" >> "$LOG"; case "$CAPTURE" in fail) return 1;; same) cp "$HOME/wsf-prod/live-firestore.rules.step0" "$1";; changed) printf 'RULES-V2\n' > "$1";; esac; }
PF() { echo "PF $*" >> "$LOG"; [ "${PF_EXIT:-0}" = 0 ]; }
firebase() { echo "firebase $*" >> "$LOG"; [ "${FB_EXIT:-0}" = 0 ]; }
npm() { echo "npm $*" >> "$LOG"; return "${NPM_EXIT:-0}"; }
bash_script="$2"
source "$bash_script" > "$HOME/out.txt" 2>&1
echo "case=$case_name capture=${CAPTURE:-} pf=${PF_EXIT:-0} fb=${FB_EXIT:-0}: firebase_called=$(grep -c '^firebase ' "$LOG") PF_called=$(grep -c '^PF ' "$LOG") STOP_printed=$(grep -c '^STOP' "$HOME/out.txt")"
```

## Instrument 6: `scan-evidence` on the packet

```sh
mkdir -p scan/txt
cp firebase.westayfit.production.json RUNBOOK_WSF_PRODUCTION_DEPLOY_1.md scan/txt/
cp preflight.mjs scan/txt/preflight.mjs.txt; cp preflight.test.mjs scan/txt/preflight.test.mjs.txt   # .mjs is not a scanned extension
node .github/wsf-staging/scan-evidence.mjs scan/txt       # EVIDENCE_SCAN=clean, 4 files, 154782 bytes, exit 0
# control: a planted ?oobCode= string in a .txt file gives exit 1 and names the rule, never the value
```
