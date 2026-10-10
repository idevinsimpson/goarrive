# W7 Check 82 instruments: WRITER-CONCURRENCY-1 (inert)

Inert on this branch. These were written and run **outside the repository** (a scratch directory with
`@actions/expressions@0.3.61` and `yaml@2` installed there) against a **detached worktree of #603 at
`75f77d30d2a137ecdb6a1dbc2a2e0241f93fd242`**, and were never pushed to the PR. They are evidence for **Check 82**
(report §82). They change no product code, no workflow and no other worker's test. Read-only GitHub API calls only; no
workflow was dispatched.

## What they prove

| # | Instrument | Result | Why it can fail |
|---|---|---|---|
| 1 | `prop.mjs`: YAML-parse the workflow as GitHub would, then evaluate the workflow-level `concurrency.group` and the reconcile job's `if` with **GitHub's own expression engine** over 2928 event shapes (3 refs, issue_comment × action × login × association × sender × issue number, plus schedule, workflow_dispatch, workflow_run, pull_request) | **head: 0 violations** (88 writer runs hold `wsf-control-writer`, 2840 take `wsf-control-skip-<run_id>`). **base: 2840 violations**, every non-writer run on the writer group | the property is: the job runs if and only if the group is the writer group, and any other run's group is its own |
| 2 | `mut603.mjs`: 11 mutants of the workflow, each judged by instrument 1 and by the PR's own `shadow.test.mjs`, restored after | property kills **9 / 11**; the PR's suite kills **11 / 11** | the 2 survivors of the property are an inbox number outside its domain (498) and the App-bot clause, which the owner-login test already makes redundant |
| 3 | `window.py`: who displaced whom among the 44 runs of this workflow between 09:40Z and 10:20Z on 2026-10-09 | 36 cancelled; of 29 cancelled writer-eligible runs, 22 were displaced by other writer-eligible runs and 5 by non-writer runs | descriptive, not a pass/fail |

## Run them

```sh
# scratch directory, outside any repository
npm init -y && npm install --ignore-scripts @actions/expressions@0.3.61 yaml@2
node prop.mjs <path to wsf-control-reconcile.yml>            # prints contexts, writerRuns, skippedRuns, violations
node mut603.mjs <detached worktree of the PR head>           # mutates the workflow in place and restores it
python3 window.py runs.json
```

## Instrument 1: `prop.mjs`

```js
// W7 instrument for Check 82 (#603): YAML-parse the workflow exactly as GitHub would, then evaluate the workflow-level
// concurrency group and the reconcile job's `if` with GitHub's own expression engine (@actions/expressions) over an
// exhaustive cross product of event shapes. Property: the job runs  <=>  the group is 'wsf-control-writer';
// otherwise the group is 'wsf-control-skip-<run_id>'.
import fs from 'node:fs';
import YAML from 'yaml';
import { Lexer, Parser, Evaluator, data } from '@actions/expressions';

export function load(text) {
  const doc = YAML.parse(text);
  const strip = (s) => s.trim().replace(/^\$\{\{/, '').replace(/\}\}$/, '');
  const rawGroup = String(doc.concurrency.group);
  return { group: rawGroup.includes('${{') ? strip(rawGroup) : JSON.stringify(rawGroup.replace(/'/g, "''")).replace(/^"|"$/g, "'").replace(/^'/, "'"), jobIf: strip(String(doc.jobs.reconcile.if)), cancel: doc.concurrency['cancel-in-progress'] };
}
function evalExpr(src, ctx) {
  const lr = new Lexer(src).lex();
  const expr = new Parser(lr.tokens, ['github'], []).parse();
  const root = JSON.parse(JSON.stringify({ github: ctx }), data.reviver);
  return new Evaluator(expr, root).evaluate();
}
const truthy = (v) => v.coerceBoolean ? v.coerceBoolean().value : Boolean(v.value);
const str = (v) => v.coerceString();

export function contexts() {
  const out = [];
  let id = 1000;
  const refs = ['refs/heads/main', 'refs/heads/claude/x', 'refs/pull/601/merge'];
  for (const ref of refs) {
    for (const event_name of ['schedule', 'workflow_dispatch', 'workflow_run', 'pull_request']) out.push({ ref, run_id: ++id, event_name, event: {} });
    for (const action of ['created', 'edited', 'deleted'])
      for (const login of ['idevinsimpson', 'IDEVINSIMPSON', 'wsf-control-writer[bot]', 'goarrive-maia'])
        for (const association of ['OWNER', 'COLLABORATOR', 'NONE'])
          for (const sender of ['idevinsimpson', 'goarrive-maia', 'wsf-control-writer[bot]'])
            for (const number of [365, 394, 395, 396, 434, 497, 366, 578, 601])
              out.push({ ref, run_id: ++id, event_name: 'issue_comment', event: { action, sender: { login: sender }, issue: { number }, comment: { user: { login }, author_association: association } } });
  }
  return out;
}
export function check(text) {
  const w = load(text);
  const ctxs = contexts();
  let writer = 0, skip = 0; const bad = [];
  for (const c of ctxs) {
    const runs = truthy(evalExpr(w.jobIf, c));
    const g = str(evalExpr(w.group, c));
    const ok = runs ? g === 'wsf-control-writer' : g === `wsf-control-skip-${c.run_id}`;
    if (runs) writer++; else skip++;
    if (!ok) bad.push({ runs, g, c });
  }
  return { n: ctxs.length, writer, skip, bad, cancel: w.cancel };
}
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv[2]) {
  const r = check(fs.readFileSync(process.argv[2], 'utf8'));
  console.log(JSON.stringify({ file: process.argv[2], contexts: r.n, writerRuns: r.writer, skippedRuns: r.skip, violations: r.bad.length, cancelInProgress: r.cancel, firstViolation: r.bad[0] ? { runs: r.bad[0].runs, group: r.bad[0].g, event: r.bad[0].c.event_name, ref: r.bad[0].c.ref } : null }));
}
```

## Instrument 2: `mut603.mjs`

```js
// W7 mutants of .github/workflows/wsf-control-reconcile.yml (#603). Each is applied in place in a DETACHED worktree,
// judged by (a) W7's exhaustive property over GitHub's own expression engine and (b) the PR's shadow.test.mjs; restored after.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { check } from './prop.mjs';
const WT = process.argv[2];
const FILE = `${WT}/.github/workflows/wsf-control-reconcile.yml`;
const orig = fs.readFileSync(FILE, 'utf8');
const GROUP_START = orig.indexOf('\nconcurrency:\n');
const JOB_START = orig.indexOf('\njobs:\n');
const inGroup = (from, to) => (s) => { const g = s.slice(GROUP_START, JOB_START); if (g.split(from).length !== 2) throw new Error('NA ' + from); return s.slice(0, GROUP_START) + g.replace(from, to) + s.slice(JOB_START); };
const inJob = (from, to) => (s) => { const j = s.slice(JOB_START); if (j.split(from).length < 2) throw new Error('NA ' + from); return s.slice(0, JOB_START) + j.replace(from, to); };
const M = [
  ['group drops the edit-by-owner clause', inGroup("            (github.event.action != 'edited' || github.event.sender.login == 'idevinsimpson') &&\n", '')],
  ['group drops author_association', inGroup("            github.event.comment.author_association == 'OWNER' &&\n", '')],
  ['group loses inbox 497', inGroup('[365, 394, 395, 396, 434, 497]', '[365, 394, 395, 396, 434]')],
  ['job `if` gains an inbox the group lacks (497 -> 497, 498)', inJob('[365, 394, 395, 396, 434, 497]', '[365, 394, 395, 396, 434, 497, 498]')],
  ['throwaway group keyed by the commit, not the run', inGroup('github.run_id', 'github.sha')],
  ['throwaway group is one shared constant', inGroup("format('wsf-control-skip-{0}', github.run_id)", "'wsf-control-skip'")],
  ['issue_comment test inverted in the group only', inGroup("github.event_name != 'issue_comment'", "github.event_name == 'issue_comment'")],
  ['main-ref guard dropped from the group only', inGroup("        github.ref == 'refs/heads/main' &&\n", '')],
  ['writer branch renamed (a different fixed name)', inGroup("&& 'wsf-control-writer' ||", "&& 'wsf-control-writer-2' ||")],
  ['App-bot clause dropped from the group only', inGroup("            github.event.comment.user.login != 'wsf-control-writer[bot]' &&\n", '')],
  ['cancel-in-progress true', (s) => s.replace('cancel-in-progress: false', 'cancel-in-progress: true')],
];
let killedProp = 0, killedSuite = 0;
try {
  for (const [name, f] of M) {
    let mut;
    try { mut = f(orig); } catch (e) { console.log(`NOT-APPLICABLE ${name}: ${e.message}`); continue; }
    fs.writeFileSync(FILE, mut);
    let p;
    try { const r = check(mut); p = r.bad.length > 0 || r.cancel !== false; } catch (e) { p = true; }
    const t = spawnSync(process.execPath, ['tools/wsf-control/tests/shadow.test.mjs'], { cwd: WT, encoding: 'utf8', timeout: 300000 });
    fs.writeFileSync(FILE, orig);
    const s = t.status !== 0;
    killedProp += p; killedSuite += s;
    console.log(`${p ? 'prop-KILLED ' : 'prop-survived'} | ${s ? 'suite-KILLED ' : 'suite-survived'} | ${name}`);
  }
} finally { fs.writeFileSync(FILE, orig); }
console.log(`property killed ${killedProp}/${M.length}; PR shadow suite killed ${killedSuite}/${M.length}`);
```

## Instrument 3: `window.py`

```python
import json, datetime, sys
# usage: python3 window.py runs.json   (runs.json: [{id, created, updated, event, concl, t}] from the Actions API, read-only)
runs = json.load(open(sys.argv[1]))
P = lambda s: datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))
runs.sort(key=lambda r: r['created'])
def kind(r):
    t = r['t']
    if r['event'] != 'issue_comment': return r['event']
    if t.startswith('[FABLE / L0 CONTROL INBOX') or t.startswith('[WORKER INBOX'): return 'inbox'
    return 'other-issue-or-PR'
byk = {}
for r in [x for x in runs if x['concl'] == 'cancelled']:
    ups = P(r['updated'])
    cands = [x for x in runs if x['id'] != r['id'] and 0 <= (ups - P(x['created'])).total_seconds() <= 3 and P(x['created']) > P(r['created'])]
    d = cands[-1] if cands else None
    key = (kind(r), kind(d) if d else 'unknown')
    byk[key] = byk.get(key, 0) + 1
for k, v in sorted(byk.items(), key=lambda x: -x[1]): print(k, v)
```
