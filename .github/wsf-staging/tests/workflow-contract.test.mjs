#!/usr/bin/env node
/**
 * Static assertions about the workflow itself.
 *
 * These properties cannot be reached by running a script — they are facts about
 * the YAML, and each one is a defect that was actually found in review:
 * evidence uploaded after its scan rejected it, a privileged job resolving an
 * unpinned package, a stamp written as a hidden file that the artifact upload
 * would silently drop.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const WF = path.resolve('.github/workflows/wsf-staging-deploy.yml');
const text = fs.readFileSync(WF, 'utf8');
// Comments explain WHY a defect was fixed and therefore quote the defect. They
// must not themselves trip the checks that look for it.
const code = text
  .split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');
let passed = 0;
const test = (n, f) => { f(); passed += 1; console.log(`  ok  ${n}`); };

// A small YAML reader is deliberate: no dependency, and these checks are
// structural enough to do on the parsed-enough shape below.
function jobBlocks() {
  const jobs = {};
  const lines = text.split('\n');
  let current = null;
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^  ([a-z][a-z0-9-]*):\s*$/.exec(lines[i]);
    if (m && /^jobs:/m.test(text.slice(0, text.indexOf(lines[i])))) {
      current = m[1];
      jobs[current] = [];
      continue;
    }
    if (current) jobs[current].push(lines[i]);
  }
  return Object.fromEntries(Object.entries(jobs).map(([k, v]) => [k, v.join('\n')]));
}
const jobs = jobBlocks();

test('every evidence upload is gated on its own scan step outcome', () => {
  // Find each upload-artifact step that carries an evidence artifact name, and
  // require its `if:` to reference a scan step's outcome.
  const uploads = [...text.matchAll(/if: \$\{\{([^}]*)\}\}\n\s+with:\n\s+name: (wsf-[a-z-]*evidence)/g)];
  const names = uploads.map((m) => m[2]);
  assert.ok(names.includes('wsf-deployment-evidence'), 'deployment evidence upload must be conditional');
  assert.ok(names.includes('wsf-hosted-evidence'), 'hosted evidence upload must be conditional');
  assert.ok(names.includes('wsf-player-evidence'), 'player evidence upload must be conditional');
  assert.ok(names.includes('wsf-cleanup-recovery-evidence'), 'recovery evidence upload must be conditional');
  for (const [, cond, name] of uploads) {
    assert.match(cond, /steps\.scan-[a-z-]+\.outcome == 'success'/, `${name} upload is not gated on a scan outcome`);
  }
  // And the bare always() form must not remain on any evidence upload.
  const bare = /if: always\(\)\n\s+with:\n\s+name: wsf-[a-z-]*evidence/.test(text);
  assert.equal(bare, false, 'an evidence upload still uses a bare always()');
});

test('both scan steps carry the id their upload references', () => {
  for (const id of ['scan-deployment-evidence', 'scan-hosted-evidence', 'scan-player-evidence', 'scan-recovery-evidence']) {
    assert.ok(text.includes(`id: ${id}`), `scan step id ${id} is missing`);
    assert.ok(text.includes(`steps.${id}.outcome == 'success'`), `nothing references ${id}`);
  }
});

test('the build job has no OIDC capability', () => {
  assert.ok(jobs.build, 'build job not found');
  assert.equal(/id-token/.test(jobs.build), false, 'the build job must not be able to obtain a Google credential');
});

test('the gate job has no OIDC capability', () => {
  assert.equal(/id-token/.test(jobs.gate), false);
});

test('privileged jobs declare the wsf-staging environment', () => {
  for (const j of ['config', 'deploy', 'hosted-verify', 'player-journey', 'cleanup-recovery']) {
    assert.match(jobs[j], /environment: wsf-staging/, `${j} must declare the environment the trust condition requires`);
  }
});

test('the build stamp is NOT a hidden file', () => {
  assert.ok(text.includes('wsf-build-sha.txt'), 'the non-hidden stamp name must be used');
  assert.equal(/\.wsf-build-sha(?!\.)/.test(code), false, 'a dotfile stamp would be dropped by upload-artifact');
});

test('hidden-file artifact upload is not broadly enabled', () => {
  assert.equal(/include-hidden-files:\s*true/.test(code), false);
});

test('no npx invocation exists in any job', () => {
  const invocations = code.split('\n').filter((l) => /\bnpx\b/.test(l));
  assert.deepEqual(invocations, [], `npx must not resolve packages in any job: ${invocations.join(' | ')}`);
});

test('the browser jobs run the candidate-local Playwright binary', () => {
  for (const j of ['hosted-verify', 'player-journey']) {
    assert.match(jobs[j], /apps\/westayfit\/node_modules\/\.bin\/playwright/, `${j}: not the candidate's CLI`);
    assert.match(jobs[j], /install --with-deps chromium/, `${j}: browsers not installed from that CLI`);
  }
});

test('privileged dependency installs keep --ignore-scripts', () => {
  for (const j of ['config', 'deploy', 'hosted-verify', 'player-journey', 'social-privacy', 'cleanup-recovery']) {
    const installs = jobs[j].split('\n').filter((l) => /npm (install|--prefix .* ci)/.test(l));
    for (const line of installs) {
      assert.match(line, /--ignore-scripts/, `${j}: privileged install without --ignore-scripts: ${line.trim()}`);
    }
  }
});

test('the pre-deploy inventory read is not fail-open', () => {
  assert.equal(/functions:list[^\n]*\|\| true/.test(code), false, 'the || true fail-open form must be gone');
  assert.match(jobs.deploy, /read-inventory\.mjs/);
  assert.match(jobs.deploy, /cli_status/);
});

test('deployment targets staging explicitly and never --force', () => {
  assert.equal(/--force/.test(code), false);
  assert.match(jobs.deploy, /--only functions:westayfit/);
  assert.match(jobs.deploy, /--no-authorized-domains/);
  const deployCalls = jobs.deploy.split('\n').filter((l) => /firebase (deploy|hosting:channel:deploy)/.test(l));
  assert.ok(deployCalls.length >= 2, 'expected both a functions and a hosting deploy');
});

test('all third-party actions are pinned to 40-char commit SHAs', () => {
  const uses = [...text.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
  assert.ok(uses.length > 0);
  for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, `unpinned action: ${u}`);
});

test('the workflow grants no permissions at workflow level', () => {
  assert.match(text, /^permissions: \{\}$/m);
});

test('only workflow_dispatch triggers it', () => {
  const onBlock = text.slice(text.indexOf('\non:'), text.indexOf('\npermissions:'));
  assert.match(onBlock, /workflow_dispatch/);
  for (const forbidden of ['push:', 'pull_request:', 'schedule:', 'pull_request_target:']) {
    assert.equal(onBlock.includes(forbidden), false, `trigger ${forbidden} must not be present`);
  }
});


// ---- script/step wiring ----------------------------------------------------
// The first hosted run failed on a variable the smoke requires and the step
// never set. That class of defect is static: every WSF_* name a script refuses
// to run without must be supplied by the step that invokes it.
function stepBlock(job, stepName) {
  const lines = jobs[job].split('\n');
  const start = lines.findIndex((l) => l.trim() === `- name: ${stepName}`);
  assert.notEqual(start, -1, `step "${stepName}" not found in job ${job}`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s{6}- (name|uses):/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}
function requiredEnv(scriptPath) {
  const src = fs.readFileSync(path.resolve(scriptPath), 'utf8');
  const names = new Set();
  // `if (!X) throw new Error('WSF_… is required')` and the template form used
  // by verify-deployment's loop over a list of names.
  for (const m of src.matchAll(/throw new Error\('(WSF_[A-Z_]+) is required'\)/g)) names.add(m[1]);
  for (const m of src.matchAll(/for \(const \[k, v\] of Object\.entries\(\{([^}]*)\}\)\)/g)) {
    for (const n of m[1].matchAll(/(WSF_[A-Z_]+)/g)) names.add(n[1]);
  }
  return [...names];
}
function supplied(block, name) {
  return new RegExp(`^\\s+${name}:`, 'm').test(block) || new RegExp(`export ${name}=`).test(block);
}
const WIRING = [
  ['hosted-verify', 'Run the Package E hosted authorization checks', '.github/wsf-staging/hosted-package-e-smoke.mjs'],
  ['hosted-verify', 'Remove synthetic fixtures', '.github/wsf-staging/cleanup-synthetic.mjs'],
  ['hosted-verify', 'Run the changed-journey smoke (report-only)', '.github/wsf-staging/hosted-changed-journeys.mjs'],
  ['deploy', 'Verify the deployed state', '.github/wsf-staging/verify-deployment.mjs'],
  ['player-journey', 'Run the browser/player journey', '.github/wsf-staging/hosted-player-journey.mjs'],
  ['player-journey', 'Remove synthetic fixtures', '.github/wsf-staging/cleanup-synthetic.mjs'],
  ['social-privacy', 'Run the per-community privacy verification', '.github/wsf-staging/social-privacy-postop.mjs'],
  ['social-privacy', 'Remove synthetic fixtures', '.github/wsf-staging/cleanup-synthetic.mjs'],
];
for (const [job, step, script] of WIRING) {
  test(`${path.basename(script)}: every required WSF_* variable is supplied by its step`, () => {
    const block = stepBlock(job, step);
    assert.match(block, new RegExp(path.basename(script).replace('.', '\\.')), 'the step must invoke the script');
    const names = requiredEnv(script);
    assert.ok(names.length >= 3, `expected to find the script's required variables, got ${names.join(',')}`);
    for (const n of names) assert.ok(supplied(block, n), `${step}: ${n} is required by ${script} but not supplied`);
  });
}

test('the smoke step derives WSF_SDK_CONFIG_FILE from the staging env artifact', () => {
  const block = stepBlock('hosted-verify', 'Run the Package E hosted authorization checks');
  const run = block.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const source = run.indexOf('. ../cfg/wsf-staging.env');
  const exportLine = run.indexOf('export WSF_SDK_CONFIG_FILE=');
  const writer = run.indexOf('write-sdk-config.mjs "$WSF_SDK_CONFIG_FILE" "$STAGING_PROJECT"');
  const smoke = run.indexOf('hosted-package-e-smoke.mjs');
  assert.ok(source !== -1 && exportLine !== -1 && writer !== -1 && smoke !== -1);
  assert.ok(source < exportLine && exportLine < writer && writer < smoke, 'source env, export path, write file, then run the smoke — in that order');
  // The existing API-key export stays; the smoke simply does not read it.
  assert.match(run, /export WSF_STAGING_API_KEY="\$EXPO_PUBLIC_WSF_STAGING_API_KEY"/);
});

test('the SDK config file lives in a DEDICATED CHILD of the runner temp dir, not the checkout or evidence', () => {
  const block = stepBlock('hosted-verify', 'Run the Package E hosted authorization checks');
  // A child directory, so the writer creates it (0700) rather than writing
  // into RUNNER_TEMP, which already exists and would keep the runner's mode.
  assert.match(block, /export WSF_SDK_CONFIG_FILE="\$RUNNER_TEMP\/[a-z-]+\/[a-z-]+\.json"/);
  assert.equal(/WSF_SDK_CONFIG_FILE="\$RUNNER_TEMP\/[a-z-]+\.json"/.test(block), false, 'the file must not sit directly in RUNNER_TEMP');
  assert.equal(/WSF_SDK_CONFIG_FILE="[^"]*(github\.workspace|wsf-evidence)/.test(block), false);
});

test('the config job documents both consumers of the staging env artifact', () => {
  const comment = text.split('\n').filter((l) => /^\s*#/.test(l)).join('\n');
  assert.equal(/artifact is consumed\s*#?\s*only by the build job/.test(comment), false, 'stale: hosted-verify downloads it too');
  assert.match(comment, /consumed by\s*\n?\s*#\s*the downstream build job[^\n]*\n?\s*#?[^\n]*hosted-verify/);
});

test('nothing in the browser jobs prints the SDK config or the env artifact', () => {
  for (const name of ['hosted-verify', 'player-journey', 'social-privacy']) {
    const j = jobs[name].split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    assert.equal(/\b(cat|echo|printenv|env)\b[^\n]*(wsf-staging\.env|WSF_SDK_CONFIG_FILE|WSF_STAGING_API_KEY|EXPO_PUBLIC)/.test(j), false, name);
  }
});

// ---- the player-journey mode ----------------------------------------------
// A standalone `wsf-player-journey.yml` was written first and could never
// authenticate: the workload identity provider's attribute condition pins
// assertion.workflow_ref to THIS file, so the run died at `config` with
// "unauthorized_client: The given credential is rejected by the attribute
// condition". The correction moved the proof into this workflow as a dispatch
// mode. These regressions hold that correction in place.

const WORKFLOW_DIR = path.resolve('.github/workflows');
const PLAN = fs.readFileSync(path.resolve('.github/wsf-staging/FEDERATION-PLAN.md'), 'utf8');

function planCondition() {
  const m = /--attribute-condition="([^"]+)"/.exec(PLAN);
  assert.notEqual(m, null, 'FEDERATION-PLAN.md no longer states an attribute condition');
  return m[1];
}
function planValue(field) {
  const m = new RegExp(`assertion\\.${field}\\s*==\\s*'([^']+)'`).exec(planCondition());
  assert.notEqual(m, null, `the federation plan's condition does not pin ${field}`);
  return m[1];
}
// Job blocks with comment lines removed: comments quote the defects these
// checks look for, and must not satisfy or trip them.
function jobCode(name) {
  assert.ok(jobs[name], `job ${name} not found`);
  return jobs[name].split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
}
function jobCondition(name) {
  const m = /^ {4}if: (.*)$/m.exec(jobs[name]);
  return m ? m[1] : null;
}

// A deliberately tiny evaluator for the `if:` expressions this workflow uses.
// Comparing condition STRINGS would pass for a condition that is merely
// present; evaluating them proves which jobs each mode actually reaches.
function evaluate(expr, ctx) {
  const src = expr.replace(/^\$\{\{/, '').replace(/\}\}$/, '').trim();
  const tokens = src.match(/'[^']*'|[A-Za-z_][A-Za-z0-9_.]*\(\)|[A-Za-z_][A-Za-z0-9_.]*|==|!=|&&|\|\||\(|\)|!/g) || [];
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  function primary() {
    const t = next();
    if (t === '(') { const v = orExpr(); assert.equal(next(), ')', `unbalanced parens in: ${src}`); return v; }
    if (t === '!') return !primary();
    if (t === 'always()') return true;
    if (t === 'success()') return ctx.__success !== false;
    if (/^'/.test(t)) return t.slice(1, -1);
    assert.ok(Object.prototype.hasOwnProperty.call(ctx, t), `unknown reference "${t}" in: ${src}`);
    return ctx[t];
  }
  function comparison() {
    let left = primary();
    while (peek() === '==' || peek() === '!=') {
      const op = next();
      const right = primary();
      left = op === '==' ? left === right : left !== right;
    }
    return left;
  }
  function andExpr() {
    let left = comparison();
    while (peek() === '&&') { next(); const right = comparison(); left = left && right; }
    return left;
  }
  function orExpr() {
    let left = andExpr();
    while (peek() === '||') { next(); const right = andExpr(); left = left || right; }
    return left;
  }
  const value = orExpr();
  assert.equal(i, tokens.length, `trailing tokens in: ${src}`);
  return value;
}

// The evaluator is itself test material: if it silently returned true for
// everything, every mode assertion below would pass vacuously.
test('the condition evaluator distinguishes true from false', () => {
  const ctx = { 'inputs.mode': 'deploy', 'needs.gate.result': 'success' };
  assert.equal(evaluate("${{ inputs.mode != 'player-journey' }}", ctx), true);
  assert.equal(evaluate("${{ inputs.mode == 'player-journey' }}", ctx), false);
  assert.equal(evaluate("${{ always() && needs.gate.result == 'success' && inputs.mode != 'player-journey' }}", ctx), true);
  assert.equal(evaluate("${{ always() && needs.gate.result == 'failure' && inputs.mode != 'player-journey' }}", ctx), false);
  assert.throws(() => evaluate('${{ needs.typo.result }}', ctx), /unknown reference/);
});

// A job is reached when every job it needs was reached AND its own condition
// holds. `always()` in a condition releases the needs requirement, which is
// exactly how hosted-verify stays reachable after a soft deploy failure.
function reachedJobs(mode) {
  const ctx = {
    'inputs.mode': mode,
    'needs.gate.result': 'success',
    'needs.config.result': 'success',
    'needs.build.result': 'success',
    'needs.deploy.result': 'success',
  };
  const order = ['gate', 'config', 'build', 'deploy', 'hosted-verify', 'player-journey', 'social-privacy', 'cleanup-recovery'];
  const reached = {};
  for (const name of order) {
    const cond = jobCondition(name);
    const needsMatch = /^ {4}needs: (.*)$/m.exec(jobs[name]);
    const raw = needsMatch ? needsMatch[1].trim() : '';
    const needed = raw === ''
      ? []
      : (raw.startsWith('[') ? raw.replace(/[[\]\s]/g, '').split(',') : [raw]);
    const needsOk = needed.every((n) => reached[n]);
    const alwaysRuns = cond ? /always\(\)/.test(cond) : false;
    reached[name] = (needsOk || alwaysRuns) && (cond === null || evaluate(cond, ctx) === true);
  }
  return reached;
}

// 1. The privileged player work is pinned to the trusted workflow file.
test('the federation plan pins THIS workflow file, and this is that file', () => {
  const ref = planValue('workflow_ref');
  const m = /^[^/]+\/[^/]+\/(\.github\/workflows\/[^@]+)@(refs\/heads\/[^']+)$/.exec(ref);
  assert.notEqual(m, null, `workflow_ref is not a repo-qualified workflow path: ${ref}`);
  const [, pinnedPath, pinnedRef] = m;
  assert.equal(pinnedRef, 'refs/heads/main', 'the plan must still pin the default branch');
  assert.equal(path.resolve(pinnedPath), WF, `the plan pins ${pinnedPath}; the player jobs live in ${path.relative(process.cwd(), WF)}`);
  assert.ok(fs.existsSync(path.resolve(pinnedPath)), 'the pinned workflow file does not exist');
});

test('no OTHER workflow file asks for an OIDC token — one cannot authenticate', () => {
  const files = fs.readdirSync(WORKFLOW_DIR).filter((f) => /\.ya?ml$/.test(f));
  const privileged = files.filter((f) => /id-token/.test(fs.readFileSync(path.join(WORKFLOW_DIR, f), 'utf8')));
  assert.deepEqual(privileged, [path.basename(WF)],
    `only the workflow the provider pins can authenticate; these also request a token: ${privileged.join(', ')}`);
});

test('the retired standalone player workflow is gone', () => {
  assert.equal(fs.existsSync(path.join(WORKFLOW_DIR, 'wsf-player-journey.yml')), false,
    'the standalone workflow can never satisfy the attribute condition and must not come back');
});

test('every job that takes a token declares the environment the plan pins', () => {
  const required = planValue('environment');
  for (const [name, body] of Object.entries(jobs)) {
    if (!/id-token: write/.test(body)) continue;
    assert.match(body, new RegExp(`environment: ${required}$`, 'm'),
      `${name} takes a token but does not declare environment ${required}`);
  }
  assert.ok(/id-token: write/.test(jobs['player-journey']), 'the player job needs a token to seed and clean up');
});

// 2. Player mode builds nothing, deploys nothing, runs no 24-row suite.
test('player mode reaches only gate, config and the player journey', () => {
  const reached = reachedJobs('player-journey');
  assert.deepEqual(reached, {
    gate: true,
    config: true,
    build: false,
    deploy: false,
    'hosted-verify': false,
    'player-journey': true,
    'social-privacy': false,
    'cleanup-recovery': false,
  });
});

test('the player job itself contains no build, deploy or 24-row execution', () => {
  const body = jobCode('player-journey');
  const forbidden = [
    [/firebase deploy/, 'a functions/hosting deploy'],
    [/hosting:channel:deploy/, 'a hosting channel deploy'],
    [/--only functions/, 'a functions deployment target'],
    [/hosted-package-e-smoke\.mjs/, 'the 24-row authorization suite'],
    [/verify-deployment\.mjs/, 'deployment verification'],
    [/read-inventory\.mjs/, 'the pre-deploy inventory read'],
    [/check-build-stamp\.mjs/, 'the build stamp check'],
    [/expo export/, 'a web bundle build'],
  ];
  for (const [re, what] of forbidden) {
    assert.equal(re.test(body), false, `player mode must not perform ${what}`);
  }
  assert.match(body, /hosted-player-journey\.mjs/, 'the player job must run the reviewed journey');
});

test('the player job depends on no build or deploy job', () => {
  const needs = /^ {4}needs: (.*)$/m.exec(jobs['player-journey'])[1];
  assert.equal(needs.replace(/[[\]\s]/g, ''), 'gate,config',
    'the player proof must depend only on the shared gate/config boundary');
});

// 3. Deploy mode is unchanged: it still reaches build, deploy and the suite.
test('deploy mode still reaches build, deploy and hosted verification', () => {
  const reached = reachedJobs('deploy');
  assert.deepEqual(reached, {
    gate: true,
    config: true,
    build: true,
    deploy: true,
    'hosted-verify': true,
    'player-journey': false,
    'social-privacy': false,
    'cleanup-recovery': false,
  });
});

// ---- the social-privacy mode (PRIVACY-POSTOP-VERIFY-1) -------------------
// A verification against staging as it stands: seven callable-level rows with
// synthetic members. It must never build, deploy, open a browser, check out a
// candidate or run the 24-row suite, and it must always clean up after itself.
test('social-privacy mode reaches only gate, config and the privacy verification', () => {
  assert.deepEqual(reachedJobs('social-privacy'), {
    gate: true,
    config: true,
    build: false,
    deploy: false,
    'hosted-verify': false,
    'player-journey': false,
    'social-privacy': true,
    'cleanup-recovery': false,
  });
});

test('the privacy job builds, deploys and browses nothing, and checks out no candidate', () => {
  const body = jobCode('social-privacy');
  const forbidden = [
    [/firebase deploy/, 'a functions/hosting deploy'],
    [/hosting:channel:deploy/, 'a hosting channel deploy'],
    [/--only functions/, 'a functions deployment target'],
    [/hosted-package-e-smoke\.mjs/, 'the 24-row authorization suite'],
    [/hosted-player-journey\.mjs/, 'the browser/player journey'],
    [/verify-deployment\.mjs/, 'deployment verification'],
    [/read-inventory\.mjs/, 'the pre-deploy inventory read'],
    [/expo export/, 'a web bundle build'],
    [/playwright/i, 'a browser'],
    [/needs\.gate\.outputs\.app_sha/, 'a checkout of the candidate'],
    [/gcloud|setIamPolicy|invoker-iam|invokerIamDisabled|indexes/, 'a transport, IAM or index change'],
  ];
  for (const [re, what] of forbidden) {
    assert.equal(re.test(body), false, `social-privacy mode must not perform ${what}`);
  }
  assert.match(body, /node ops\/\.github\/wsf-staging\/social-privacy-postop\.mjs/, 'the job must run the reviewed harness from the operational checkout');
  const needs = /^ {4}needs: (.*)$/m.exec(jobs['social-privacy'])[1];
  assert.equal(needs.replace(/[[\]\s]/g, ''), 'gate,config', 'it depends only on the shared gate/config boundary');
});

test('the privacy job takes exactly contents: read and id-token: write', () => {
  const block = /^ {4}permissions:\n((?: {6}[^\n]*\n)+)/m.exec(jobs['social-privacy']);
  assert.notEqual(block, null, 'no permissions block');
  assert.deepEqual(block[1].trim().split('\n').map((l) => l.trim()).sort(), ['contents: read', 'id-token: write']);
});

test('the privacy job always cleans up, scans before uploading, and gates on both', () => {
  for (const name of ['Re-authenticate before cleanup', 'Remove synthetic fixtures', 'Scan evidence before upload', 'Require the privacy verification and the scan to have passed']) {
    assert.match(stepBlock('social-privacy', name), /if: always\(\)/, `${name}: must run after a failed or blocked verification too`);
  }
  const body = jobs['social-privacy'];
  let previous = -1;
  for (const marker of ['id: privacy', 'Remove synthetic fixtures', 'id: scan-privacy-evidence', 'name: wsf-privacy-evidence', 'Require the privacy verification']) {
    const at = body.indexOf(marker);
    assert.notEqual(at, -1, `missing ${marker}`);
    assert.ok(at > previous, `out of order: ${marker}`);
    previous = at;
  }
  const upload = /if: \$\{\{([^}]*)\}\}\n\s+with:\n\s+name: wsf-privacy-evidence/.exec(text);
  assert.notEqual(upload, null, 'the privacy evidence upload was not found');
  assert.match(upload[1], /steps\.scan-privacy-evidence\.outcome == 'success'/);
  const gate = stepBlock('social-privacy', 'Require the privacy verification and the scan to have passed');
  for (const id of ['privacy', 'scan-privacy-evidence']) {
    assert.match(gate, new RegExp(`steps\\.${id}\\.outcome[^\n]*=[^\n]*["']success["']`), `the gate must require ${id}`);
  }
  assert.match(stepBlock('social-privacy', 'Run the per-community privacy verification'), /^\s+WSF_PRIVACY_TARGET: staging$/m,
    'the workflow runs the staging target and nothing else');
});

test('mail-preflight mode reaches NOTHING that builds, deploys or verifies', () => {
  /*
    The direct statement of the preflight's safety, in the same form the other
    modes are pinned in. Every other job must be false here: if one ever flips
    to true, a read-only report has become a deploy.
  */
  const reached = reachedJobs('mail-preflight');
  assert.deepEqual(reached, {
    gate: false,
    config: false,
    build: false,
    deploy: false,
    'hosted-verify': false,
    'player-journey': false,
    'social-privacy': false,
    'cleanup-recovery': false,
  });
});

test('deploy is the default mode, so an unset input runs the normal path', () => {
  const onBlock = text.slice(text.indexOf('\non:'), text.indexOf('\n# Nothing is granted'));
  const modeBlock = onBlock.slice(onBlock.indexOf('      mode:'));
  assert.match(modeBlock, /^\s+default: deploy$/m, 'the default must remain the deployment path');
  assert.match(modeBlock, /^\s+type: choice$/m, 'the mode must be a closed choice, not free text');
  const optionsBlock = modeBlock.slice(modeBlock.indexOf('options:'), modeBlock.indexOf('recover_run_id:'));
  const options = [...optionsBlock.matchAll(/^\s+- ([a-z-]+)$/gm)].map((m) => m[1]);
  /*
    THE LIST IS PINNED EXACTLY, so adding a mode is a deliberate act rather
    than something that happens quietly. `mail-preflight` was added here only
    after the job matrix above was extended to say what runs in it — which is
    the check that actually matters, because a mode no job names runs nothing.
  */
  assert.deepEqual(
    options,
    ['deploy', 'player-journey', 'cleanup-recovery', 'mail-preflight', 'social-privacy'],
    'exactly these five modes exist'
  );
});

test('the deploy path still carries the steps it carried before the mode existed', () => {
  assert.match(jobCode('build'), /scripts\/westayfit\/build-staging\.sh/, 'the build job must still build the staging web artifact');
  assert.match(jobCode('build'), /npm --prefix functions-westayfit run build/, 'the build job must still compile the functions');
  assert.match(jobCode('deploy'), /firebase deploy/, 'the deploy job must still deploy');
  assert.match(jobCode('hosted-verify'), /hosted-package-e-smoke\.mjs/, 'the 24-row suite must still run in deploy mode');
  // The mode gate is a condition on those jobs, never a rewrite of their work.
  for (const j of ['build', 'deploy']) {
    assert.equal(/inputs\.mode/.test(jobCode(j).replace(/^ {4}if: .*$/m, '')), false,
      `${j}: mode must gate the job, not branch inside its steps`);
  }
});

// 4. A failed or skipped journey cannot leave a green run.
test('the player job fails the run when the journey or the scan did not pass', () => {
  const gateStep = stepBlock('player-journey', 'Require the journey and the scan to have passed');
  assert.match(gateStep, /if: always\(\)/, 'the final gate must run even after a failed journey');
  for (const id of ['journey', 'scan-player-evidence']) {
    assert.match(gateStep, new RegExp(`steps\\.${id}\\.outcome[^\n]*=[^\n]*["']success["']`),
      `the gate must require ${id} to have succeeded`);
  }
  assert.match(gateStep, /exit 1/, 'the gate must actually fail the step');
  assert.match(gateStep, /set -euo pipefail/);
});

test('every step outcome the player job gates on belongs to a step that exists', () => {
  const body = jobs['player-journey'];
  const referenced = new Set([...body.matchAll(/steps\.([a-z0-9-]+)\.outcome/g)].map((m) => m[1]));
  const declared = new Set([...body.matchAll(/^\s+id: ([a-z0-9-]+)$/gm)].map((m) => m[1]));
  assert.ok(referenced.size >= 2, `expected the journey and the scan to be gated on, saw ${[...referenced]}`);
  for (const id of referenced) {
    assert.ok(declared.has(id), `steps.${id}.outcome is referenced but no step carries id: ${id} — it would read as empty and the gate would never fire`);
  }
});

test('cleanup and its re-authentication run whatever the journey did', () => {
  for (const name of ['Re-authenticate before cleanup', 'Remove synthetic fixtures', 'Scan evidence before upload']) {
    const step = stepBlock('player-journey', name);
    assert.match(step, /if: always\(\)/, `${name}: must run after a failed journey too`);
  }
  // Cleanup must come after the journey and before the scan, or it would tidy
  // up nothing and the scan would inspect a directory still being written.
  const body = jobs['player-journey'];
  const order = ['id: journey', 'Remove synthetic fixtures', 'id: scan-player-evidence', 'name: wsf-player-evidence'];
  let previous = -1;
  for (const marker of order) {
    const at = body.indexOf(marker);
    assert.notEqual(at, -1, `missing ${marker}`);
    assert.ok(at > previous, `out of order: ${marker}`);
    previous = at;
  }
});

test('the player evidence upload is gated on the player scan, not on any other', () => {
  const upload = /if: \$\{\{([^}]*)\}\}\n\s+with:\n\s+name: wsf-player-evidence/.exec(text);
  assert.notEqual(upload, null, 'the player evidence upload was not found');
  assert.match(upload[1], /steps\.scan-player-evidence\.outcome == 'success'/);
  assert.equal(/scan-hosted-evidence|scan-deployment-evidence/.test(upload[1]), false,
    'the player upload must not be gated on another job’s scan');
});

test('the player job keeps its own manifest, evidence directory and artifact name', () => {
  const player = jobCode('player-journey');
  const hosted = jobCode('hosted-verify');
  const manifestsOf = (body) => new Set([...body.matchAll(/WSF_CLEANUP_MANIFEST: \$\{\{ github\.workspace \}\}\/([a-z-]+)\//g)].map((m) => m[1]));
  const playerDirs = manifestsOf(player);
  const hostedDirs = manifestsOf(hosted);
  assert.deepEqual([...playerDirs], ['wsf-player-evidence'], 'the player manifest must live in the player evidence directory');
  assert.deepEqual([...hostedDirs], ['wsf-evidence'], 'the hosted manifest must stay where it was');
  for (const d of playerDirs) {
    assert.equal(hostedDirs.has(d), false, `both jobs write a manifest into ${d}; one run's cleanup could adopt the other's record`);
  }
  // Every manifest and receipt the player job names sits under its own directory.
  for (const m of player.matchAll(/WSF_CLEANUP_(?:MANIFEST|RECEIPT): \$\{\{ github\.workspace \}\}\/([a-z-]+)\//g)) {
    assert.equal(m[1], 'wsf-player-evidence');
  }
  assert.match(player, /WSF_RESULT_DIR: \$\{\{ github\.workspace \}\}\/wsf-player-evidence$/m);
  // No two UPLOADS share a name: a second upload of an existing name would
  // merge or clobber the first job's evidence. Downloads reuse names on
  // purpose, so only the upload steps are counted.
  const uploaded = text
    .split('uses: actions/upload-artifact')
    .slice(1)
    .map((chunk) => /^\s+name: (\S+)$/m.exec(chunk))
    .map((m) => { assert.notEqual(m, null, 'an upload-artifact step names no artifact'); return m[1]; });
  assert.equal(new Set(uploaded).size, uploaded.length, `two uploads share an artifact name: ${uploaded.join(', ')}`);
  assert.ok(uploaded.includes('wsf-player-evidence'), 'the player evidence must be uploaded');
  assert.ok(uploaded.includes('wsf-hosted-evidence'), 'the hosted evidence must still be uploaded');
});

test('the player job consumes the deploy workflow’s own env artifact', () => {
  const body = jobCode('player-journey');
  assert.match(body, /name: wsf-staging-env/, 'the player job downloads the config job’s artifact');
  assert.equal(/name: wsf-player-env/.test(text), false, 'the retired workflow’s env artifact name must not linger');
});

// ---- the cleanup-recovery mode ---------------------------------------------
// Run 35495928362 created three synthetic accounts and fifty-one documents and
// removed none of them: the journey minted `e5j-…` tags, the cleaner accepted
// `^e5h-` alone, so the run ended MANIFEST_UNUSABLE. The prefix is fixed in
// run-tag.mjs; this mode is how the fixtures that run stranded get removed
// WITHOUT running another journey, which would create more of them first.

test('recovery mode reaches the recovery job and nothing else — not even the gate', () => {
  const reached = reachedJobs('cleanup-recovery');
  assert.deepEqual(reached, {
    gate: false,
    config: false,
    build: false,
    deploy: false,
    'hosted-verify': false,
    'player-journey': false,
    'social-privacy': false,
    'cleanup-recovery': true,
  });
});

test('the recovery job creates no fixtures: no journey, build, deploy, 24-row suite or verification', () => {
  const body = jobCode('cleanup-recovery');
  const forbidden = [
    [/hosted-player-journey\.mjs/, 'the browser/player journey'],
    [/hosted-package-e-smoke\.mjs/, 'the 24-row authorization suite'],
    [/verify-deployment\.mjs/, 'deployment verification'],
    [/read-inventory\.mjs/, 'the pre-deploy inventory read'],
    [/firebase deploy|hosting:channel:deploy|--only functions/, 'a deployment'],
    [/expo export|build-staging\.sh/, 'a build'],
    [/playwright|chromium/i, 'a browser'],
  ];
  for (const [re, what] of forbidden) {
    assert.equal(re.test(body), false, `the recovery job must not perform ${what}`);
  }
  assert.match(body, /cleanup-synthetic\.mjs/, 'the recovery job must run the cleaner');
  assert.match(body, /validate-recovery-manifest\.mjs/, 'the recovery job must gate the manifest first');
});

test('the recovery job takes exactly actions:read, contents:read and id-token:write', () => {
  const body = jobs['cleanup-recovery'];
  const block = body.slice(body.indexOf('permissions:'), body.indexOf('steps:'));
  const granted = [...block.matchAll(/^\s+([a-z-]+): (read|write)$/gm)].map((m) => `${m[1]}:${m[2]}`).sort();
  assert.deepEqual(granted, ['actions:read', 'contents:read', 'id-token:write'],
    `the recovery job's permissions drifted: ${granted.join(', ')}`);
  // actions: read exists to reach ANOTHER run's artifact, and belongs to no
  // other job in this workflow.
  for (const [name, other] of Object.entries(jobs)) {
    if (name === 'cleanup-recovery') continue;
    assert.equal(/^\s+actions: /m.test(other), false, `${name} must not carry an actions permission`);
  }
});

test('the manifest is validated BEFORE a credential is obtained', () => {
  const body = jobCode('cleanup-recovery');
  const validate = body.indexOf('validate-recovery-manifest.mjs');
  const auth = body.indexOf('google-github-actions/auth');
  const clean = body.indexOf('cleanup-synthetic.mjs');
  assert.ok(validate !== -1 && auth !== -1 && clean !== -1);
  assert.ok(validate < auth, 'a manifest from a downloaded artifact must be gated before the job authenticates');
  assert.ok(auth < clean, 'the cleaner needs the credential the auth step mints');
});

test('the artifact comes from a run id in THIS repository, never another repo', () => {
  const body = jobCode('cleanup-recovery');
  const download = body.slice(body.indexOf('actions/download-artifact'));
  const step = download.slice(0, download.indexOf('- name:', 1) === -1 ? undefined : download.indexOf('- name:', 1));
  assert.match(step, /name: wsf-player-evidence/, 'the recovery job reads the player evidence artifact');
  assert.match(step, /run-id: \$\{\{ steps\.recover-target\.outputs\.run_id \}\}/,
    'the run id must be the validated one, not the raw input');
  assert.equal(/^\s+repository:/m.test(step), false,
    'a repository input would let this mode be pointed at another repository’s run');
  assert.match(step, /github-token:/, 'a cross-run artifact download needs a token');
});

test('the run id is checked for shape before it is used', () => {
  const step = stepBlock('cleanup-recovery', 'Require a plain numeric run id');
  assert.match(step, /\*\[!0-9\]\*\)/, 'a non-numeric run id must be refused');
  assert.match(step, /exit 1/);
  // And the empty case is its own message, not a confusing artifact error.
  assert.match(step, /''\)/);
  assert.match(step, /set -euo pipefail/);
});

test('a recovery that did not complete cannot leave a green run', () => {
  const gate = stepBlock('cleanup-recovery', 'Require the recovery to have completed');
  assert.match(gate, /if: always\(\)/);
  // The receipt is read, not just the exit code: the status is the claim.
  // Checking that "COMPLETE|NO_FIXTURES" merely APPEARS is not enough — it
  // still appears in `COMPLETE|NO_FIXTURES|INCOMPLETE)`, which accepts a
  // recovery that left fixtures behind. So the case arms are parsed and the
  // passing one must be exactly those two statuses, with everything else
  // falling to a catch-all that exits non-zero.
  const caseBody = gate.slice(gate.indexOf('case "$status" in'), gate.indexOf('esac'));
  assert.ok(caseBody.length > 0, 'the gate must decide on the receipt status');
  const arms = [...caseBody.matchAll(/^\s+([A-Za-z_|*]+)\)(.*)$/gm)].map((m) => [m[1], m[2]]);
  const passing = arms.filter(([, body]) => !/exit 1/.test(body)).map(([pattern]) => pattern);
  assert.deepEqual(passing, ['COMPLETE|NO_FIXTURES'],
    `only a COMPLETE or NO_FIXTURES receipt may pass; these do too: ${passing.join(' ')}`);
  const catchAll = arms.find(([pattern]) => pattern === '*');
  assert.ok(catchAll, 'every other status must fall to a catch-all');
  assert.match(catchAll[1], /exit 1/, 'the catch-all must fail the run');
  assert.match(gate, /steps\.scan-recovery-evidence\.outcome[^\n]*=[^\n]*["']success["']/);
  assert.match(gate, /steps\.recover\.outcome[^\n]*=[^\n]*["']success["']/);
  assert.match(gate, /cleanup-receipt\.json|RECEIPT/, 'the gate must read the receipt');
  assert.match(gate, /exit 1/);
});

test('every step outcome the recovery job gates on belongs to a step that exists', () => {
  const body = jobs['cleanup-recovery'];
  const referenced = new Set([...body.matchAll(/steps\.([a-z0-9-]+)\.outcome/g)].map((m) => m[1]));
  const declaredOutputs = new Set([...body.matchAll(/steps\.([a-z0-9-]+)\.outputs/g)].map((m) => m[1]));
  const declared = new Set([...body.matchAll(/^\s+id: ([a-z0-9-]+)$/gm)].map((m) => m[1]));
  assert.ok(referenced.size >= 2, `expected the cleaner and the scan to be gated on, saw ${[...referenced]}`);
  for (const id of [...referenced, ...declaredOutputs]) {
    assert.ok(declared.has(id), `steps.${id} is referenced but no step carries id: ${id}`);
  }
});

test('the recovery job keeps its own evidence directory and artifact name', () => {
  const body = jobCode('cleanup-recovery');
  assert.match(body, /WSF_CLEANUP_RECEIPT: \$\{\{ github\.workspace \}\}\/wsf-recovery-evidence\//);
  assert.equal(/wsf-evidence\/|wsf-player-evidence\/cleanup-receipt/.test(body), false,
    'the recovery job must not write into another job’s evidence directory');
  const upload = /if: \$\{\{([^}]*)\}\}\n\s+with:\n\s+name: wsf-cleanup-recovery-evidence/.exec(text);
  assert.notEqual(upload, null, 'the recovery evidence upload was not found');
  assert.match(upload[1], /steps\.scan-recovery-evidence\.outcome == 'success'/);
});

test('the modes are gated by equality, so a fourth mode cannot silently start building or deploying', () => {
  for (const j of ['build', 'deploy']) {
    const cond = jobCondition(j);
    assert.match(cond, /inputs\.mode == 'deploy'/, `${j} must be gated on deploy mode by equality`);
    assert.equal(/inputs\.mode !=/.test(cond), false, `${j} uses a negation, which admits every future mode`);
  }
  assert.equal(/inputs\.mode !=/.test(jobCondition('hosted-verify')), false,
    'hosted-verify uses a negation, which admits every future mode');
  // And prove it: a mode nobody has defined yet must reach NOTHING — not the
  // gate, and above all not `config`, which is privileged.
  const reached = reachedJobs('some-future-mode');
  for (const [name, hit] of Object.entries(reached)) {
    assert.equal(hit, false, `an unrecognised mode reached ${name}`);
  }
});

test('the failure reprint is diagnostic only and can never become a gate', () => {
  // Runs 37, 38 and 39 were each diagnosed from which capture was MISSING and
  // how long the step ran, because the assertion message sat in a step the log
  // tail could not reach. This step reprints the receipt's failing rows in the
  // LAST step of the job, where the tail always reaches.
  //
  // It must stay diagnostic. A step that can fail a run is a gate, and this one
  // exists precisely so that nobody has to guess — it must not itself become
  // something new to guess about.
  const wf = fs.readFileSync(path.join(WORKFLOW_DIR, 'wsf-staging-deploy.yml'), 'utf8');
  const at = wf.indexOf("- name: Reprint the journey's failing rows");
  assert.notEqual(at, -1, 'the failure reprint step is gone');
  const step = wf.slice(at, wf.indexOf('- name:', at + 10));

  assert.match(step, /continue-on-error:\s*true/,
    'the reprint step can fail the job, so it is a gate and not a diagnostic');
  assert.match(step, /steps\.journey\.outcome != 'success'/,
    'the reprint step runs on a passing journey too, adding noise to green runs');

  // The real gate is untouched and still fails the run.
  const gateAt = wf.indexOf('- name: Require the journey and the scan to have passed');
  assert.notEqual(gateAt, -1, 'the journey gate is gone');
  const gate = wf.slice(gateAt, gateAt + 700);
  assert.match(gate, /the browser\/player journey did not pass"; exit 1/,
    'the journey gate no longer fails the run');
  assert.match(gate, /the evidence scan rejected this run's evidence"; exit 1/,
    'the evidence-scan gate no longer fails the run');
  assert.equal(/continue-on-error/.test(gate), false,
    'the real gate became continue-on-error, so a failed journey could pass');
  assert.ok(at < gateAt, 'the reprint must come before the gate that exits');
});

test('the mail preflight can report, and cannot deploy', () => {
  /*
    THE PREFLIGHT'S SAFETY IS STRUCTURAL, AND THIS PINS THE STRUCTURE.

    Every job in this workflow gates on an explicit equality list of the modes
    it runs in, never a negation — which is what makes adding a mode safe: a
    new mode runs nothing until a job names it. If any other job ever starts
    matching `mail-preflight`, a read-only report becomes a deploy.
  */
  const wf = fs.readFileSync(path.join(WORKFLOW_DIR, 'wsf-staging-deploy.yml'), 'utf8');

  assert.match(wf, /^\s+- mail-preflight$/m, 'the mail-preflight mode is not offered');

  const at = wf.indexOf('\n  mail-preflight:');
  assert.notEqual(at, -1, 'the mail-preflight job is gone');
  const job = wf.slice(at);

  assert.match(job, /if: \$\{\{ inputs\.mode == 'mail-preflight' \}\}/,
    'the preflight job does not gate on its own mode');

  // NOTHING ELSE MAY RUN IN THIS MODE. Count the jobs whose condition names
  // it: exactly one, the preflight itself.
  const namesIt = wf.split(/\n  (?=[a-z][a-z0-9-]*:\n)/).filter(
    (j) => /inputs\.mode == 'mail-preflight'/.test(j)
  );
  assert.equal(namesIt.length, 1,
    `${namesIt.length} jobs run in mail-preflight mode; only the preflight may`);

  // And the preflight itself must not deploy, write or grant.
  for (const forbidden of [
    /firebase\s+deploy/,
    /hosting:channel:deploy/,
    /gcloud\s+secrets\s+(create|versions\s+add|versions\s+access)/,
    /add-iam-policy-binding/,
  ]) {
    assert.equal(forbidden.test(job), false,
      `the preflight job matches ${forbidden}, so it is not read-only`);
  }
});

test('the preflight never reads a secret payload or prints a token', () => {
  const src = fs.readFileSync(
    path.join(WORKFLOW_DIR, '..', 'wsf-staging', 'mail-preflight.mjs'),
    'utf8'
  );
  // `versions access` is the call that returns the key itself. It must not
  // appear at all — not behind a flag, not in a comment-adjacent branch.
  assert.equal(/versions['"\s,\]]*access/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), false,
    'the preflight reads a secret payload');

  // The access token is passed to curl and must never reach stdout.
  assert.equal(/console\.log\([^)]*print-access-token/.test(src), false,
    'the preflight prints an access token');
  assert.equal(/console\.log\([^)]*\btok\b/.test(src), false,
    'the preflight prints the token variable');

  // Only the sender's DOMAIN is reported, never the whole address.
  assert.equal(/console\.log\([^)]*\braw\b/.test(src), false,
    'the preflight prints the full sender address');

  // A report must not fail the run.
  assert.match(src, /process\.exit\(0\)/, 'the preflight can exit nonzero');
});


// ── the staging hosting config's rewrites ─────────────────────────────────
//
// WHY THESE LIVE HERE rather than in a suite of their own: run-all.mjs carries
// a hardcoded list of suites, and a new file that is not added to it is a test
// that never runs. That file is not reserved to this packet, so the cases go
// where they are already executed.
//
// WHAT THEY PIN. `firebase.westayfit.staging.json` is an OPERATIONAL file: the
// workflow copies it into the candidate checkout (`cp ../ops/… .`) and both the
// hosting and functions deploys use it. The app's `firebase.westayfit.json` is
// the production site's config and the staging deploy never reads it — so a
// rewrite added there does nothing for staging, and the two files' own comment
// ("Keep the two in sync") is enforced by nothing but a person. These cases are
// that enforcement for the community routes.

const STAGING_HOSTING = JSON.parse(
  fs.readFileSync('firebase.westayfit.staging.json', 'utf8')
);
const stagingRewrites = STAGING_HOSTING.hosting.rewrites;

/**
 * Firebase Hosting glob matching, enough of it to decide these cases:
 * `*` matches within ONE path segment, `**` matches across segments, and the
 * FIRST matching rewrite wins. Written out rather than imported so the rule the
 * assertions rely on is visible at the point of use.
 */
function firstMatch(rewrites, urlPath) {
  for (const r of rewrites) {
    const rx = new RegExp(
      '^' +
        r.source
          .split(/(\*\*|\*)/)
          .map((part) =>
            part === '**' ? '.*' : part === '*' ? '[^/]*' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
          )
          .join('') +
        '$'
    );
    if (rx.test(urlPath)) return r;
  }
  return null;
}

await test('the members route has its own rewrite, and it wins over the catch-all', () => {
  const hit = firstMatch(stagingRewrites, '/community/abc123/members');
  assert.ok(hit, '/community/{id}/members matches no rewrite at all');
  assert.equal(hit.source, '/community/*/members');
  assert.equal(hit.destination, '/community/__dynamic/members.html');
  // Order, stated as order and not merely as presence: a members rule placed
  // after the catch-all would never be reached.
  const members = stagingRewrites.findIndex((r) => r.source === '/community/*/members');
  const catchAll = stagingRewrites.findIndex((r) => r.source === '/community/**');
  assert.ok(members >= 0 && catchAll >= 0);
  assert.ok(members < catchAll, 'the members rule must precede /community/**');
});

await test('THE DEFECT: without that rule the same URL resolves to the community home', () => {
  // The rewrite list exactly as it stood on main 340e141, so the case proves
  // what was wrong rather than only what is now right. A members request did
  // NOT 404 — it silently served the community home document.
  const before = stagingRewrites.filter((r) => r.source !== '/community/*/members');
  const hit = firstMatch(before, '/community/abc123/members');
  assert.equal(hit.source, '/community/**');
  assert.equal(hit.destination, '/community/__dynamic.html');
});

await test('the challenge rule is unchanged and still precedes the catch-all', () => {
  const hit = firstMatch(stagingRewrites, '/community/abc123/challenge');
  assert.equal(hit.source, '/community/*/challenge');
  assert.equal(hit.destination, '/community/__dynamic/challenge.html');
  const challenge = stagingRewrites.findIndex((r) => r.source === '/community/*/challenge');
  const catchAll = stagingRewrites.findIndex((r) => r.source === '/community/**');
  assert.ok(challenge < catchAll, 'the challenge rule must precede /community/**');
});

await test('the community home itself still resolves to the catch-all', () => {
  // The members rule must not capture the community page: `*` is one segment.
  const hit = firstMatch(stagingRewrites, '/community/abc123');
  assert.equal(hit.source, '/community/**');
  assert.equal(hit.destination, '/community/__dynamic.html');
});

await test('no rewrite was removed and the site and codebase are untouched', () => {
  for (const source of ['/community/*/challenge', '/community/**', '/join/**', '/contribute/**',
    '/display/**', '/kiosk/**', '/station/**', '/event/**', '/queue/**', '/combined/**']) {
    assert.ok(stagingRewrites.some((r) => r.source === source), `${source} was removed`);
  }
  assert.equal(STAGING_HOSTING.hosting.site, 'westayfit-staging');
  assert.equal(STAGING_HOSTING.functions.length, 1);
  assert.equal(STAGING_HOSTING.functions[0].codebase, 'westayfit');
});

await test('the /move dynamic route has its rewrite', () => {
  // This case REPLACES a temporary one that asserted the absence of this rule.
  // A test whose success requires the defect is a test that has to be deleted
  // the moment the defect is fixed, so it is gone rather than inverted in place.
  const hit = firstMatch(stagingRewrites, '/move/some-goal');
  assert.ok(hit, '/move/{goalId} matches no rewrite');
  assert.equal(hit.source, '/move/**');
  assert.equal(hit.destination, '/move/__dynamic.html');
});

await test('THE DEFECT: the main 340e141 list matched /move/{goalId} with nothing at all', () => {
  // The rewrite list exactly as it stood on main 340e141 — no /move rule and no
  // catch-all that could stand in for one. Unlike the members case, which was
  // quietly served the wrong document, this one had no match at all, so a
  // direct load or refresh fell through to Hosting's 404.
  //
  // SOURCE-DERIVED, NOT OBSERVED: no request was made to the staging site from
  // here. This asserts what the config does, which is the only thing a config
  // test can assert.
  const before = stagingRewrites.filter((r) => r.source !== '/move/**' && r.source !== '/community/*/members');
  assert.equal(firstMatch(before, '/move/some-goal'), null);
});

await test('bare /move is not what this rule is for, and static content decides it', () => {
  // apps/westayfit/app/move/index.tsx exports a static document, and Firebase
  // Hosting applies a rewrite only when no static file matches the request. So
  // /move is served by that document whether or not this pattern would also
  // match it — which is why the app's own config has carried the identical
  // `/move/**` rule all along. Pinned as a statement about the rule's shape:
  // it is the dynamic child route that needs the rewrite.
  assert.equal(firstMatch(stagingRewrites, '/move/some-goal').destination, '/move/__dynamic.html');
  assert.equal(firstMatch(stagingRewrites, '/move/some-goal/deeper').destination, '/move/__dynamic.html');
});

await test('the two-tree hosting check runs, and runs BEFORE any credential exists', () => {
  // This REPLACES a case that pinned the asymmetry — that the app config
  // carries no rewrites on this branch, so no test here could cross-check the
  // two hosting configs. That was a description of the gap, not a fix. The fix
  // is check-hosting-routes.mjs, which runs in the one job where both
  // checkouts and the built artifact exist together.
  //
  // WHERE it runs is the load-bearing part. The step must sit after the
  // artifact is confirmed (so dist/ exists) and before the auth step (so the
  // check cannot be reached by anything holding a credential). A check that
  // drifted below authentication would still pass its own tests while
  // silently becoming privileged.
  assert.ok(fs.existsSync('.github/wsf-staging/check-hosting-routes.mjs'),
    'the helper the workflow invokes does not exist');

  const deployJob = text.slice(text.indexOf('\n  deploy:'), text.indexOf('\n  hosted-verify:'));
  assert.ok(deployJob.length > 0, 'the deploy job could not be isolated');

  const confirm = deployJob.indexOf('Confirm the artifact belongs to the approved commit');
  const check = deployJob.indexOf('check-hosting-routes.mjs');
  const auth = deployJob.indexOf('Authenticate to Google Cloud');
  assert.ok(confirm >= 0 && check >= 0 && auth >= 0, 'a required deploy step is missing');
  assert.ok(confirm < check, 'the hosting check runs before the artifact is confirmed');
  assert.ok(check < auth, 'the hosting check runs after a credential is obtained');

  // It reads two checkouts and nothing else: no token, no project, no network.
  const step = deployJob.slice(deployJob.lastIndexOf('- name:', check), auth);
  assert.match(step, /node ops\/\.github\/wsf-staging\/check-hosting-routes\.mjs app ops/);
  assert.equal(/WSF_GOOGLE_ACCESS_TOKEN|google-github-actions\/auth|gcloud |firebase /.test(step), false,
    'the hosting check step reaches for a credential or a cloud CLI');
});

await test('the helper itself makes no network or cloud call', () => {
  const helper = fs.readFileSync('.github/wsf-staging/check-hosting-routes.mjs', 'utf8');
  for (const forbidden of ['fetch(', 'https://', 'child_process', 'gcloud', 'firebase-tools']) {
    assert.equal(helper.includes(forbidden), false, `the helper references ${forbidden}`);
  }
});

await test('the hosting check step is LIVE: nothing gates, skips or swallows it', () => {
  // Pinning WHERE the step sits proves nothing if it can be disarmed in
  // place. Each of these leaves the order case green while the check does
  // nothing: the step commented out, `if: ${{ false }}`, `continue-on-error:
  // true`, `|| true` appended, or the command turned into an `echo`. So the
  // step is read as YAML lines and must be exactly a name and one command.
  const lines = text.split('\n');
  const deployStart = lines.findIndex((l) => /^  deploy:\s*$/.test(l));
  const deployEnd = lines.findIndex((l, i) => i > deployStart && /^  [A-Za-z0-9_-]+:\s*$/.test(l));
  assert.ok(deployStart >= 0 && deployEnd > deployStart, 'the deploy job could not be isolated');
  const job = lines.slice(deployStart, deployEnd);

  // The job itself must not tolerate a failed step either.
  const stepsAt = job.findIndex((l) => /^    steps:\s*$/.test(l));
  assert.ok(stepsAt > 0, 'the deploy job has no steps block');
  assert.equal(job.slice(0, stepsAt).some((l) => /^    continue-on-error:/.test(l)), false,
    'the deploy job is continue-on-error, so a failed hosting check would not stop it');

  const nameAt = job.findIndex((l) => /^      - name: Check the operational hosting config routes this candidate\s*$/.test(l));
  assert.ok(nameAt > stepsAt, 'the hosting check step is missing or commented out');
  const nextStep = job.findIndex((l, i) => i > nameAt && /^      - /.test(l));
  const body = job.slice(nameAt + 1, nextStep < 0 ? job.length : nextStep)
    .filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));

  assert.deepEqual(body, ['        run: node ops/.github/wsf-staging/check-hosting-routes.mjs app ops'],
    'the hosting check step carries more than its one command (an if:, continue-on-error, shell, env or a changed run line)');
});

// ---- the changed-journey smoke (CONTROL-PLANE-CI-1) --------------------------
// Report-only until it is independently accepted: it must run where staging is
// reachable, read its manifest from the operational checkout, and be unable to
// move the hosted-verify result in either direction.
await test('the changed-journey smoke runs in hosted-verify AFTER the Package E suite and BEFORE the gate', () => {
  const names = [...jobs['hosted-verify'].matchAll(/^      - name: (.+)$/gm)].map((m) => m[1].trim());
  const smoke = names.indexOf('Run the Package E hosted authorization checks');
  const changed = names.indexOf('Run the changed-journey smoke (report-only)');
  const gate = names.indexOf('Require the hosted checks to have passed');
  assert.ok(smoke >= 0 && changed >= 0 && gate >= 0, 'a hosted-verify step is missing');
  assert.equal(changed, smoke + 1, 'the changed-journey smoke must directly follow the Package E suite');
  assert.ok(changed < gate);
  for (const j of Object.keys(jobs).filter((k) => k !== 'hosted-verify')) {
    assert.equal(/hosted-changed-journeys\.mjs/.test(jobs[j]), false, `${j} must not run the changed-journey smoke`);
  }
});

await test('the changed-journey smoke is report-only: continue-on-error, no id, and no gate reads it', () => {
  const block = stepBlock('hosted-verify', 'Run the changed-journey smoke (report-only)');
  const live = block.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.match(live, /^\s+continue-on-error: true$/m);
  assert.equal(/^\s+id:/m.test(live), false, 'an id would let a later step gate on it');
  assert.match(live, /^\s+if: \$\{\{ !cancelled\(\) \}\}$/m);
  const gate = stepBlock('hosted-verify', 'Require the hosted checks to have passed');
  const refs = [...gate.matchAll(/steps\.([a-z0-9-]+)\.outcome/g)].map((m) => m[1]).sort();
  assert.deepEqual(refs, ['scan-hosted-evidence', 'smoke'], 'the hosted gate must read exactly the Package E suite and the evidence scan');
  // No credential: it neither mints a token nor reads the env artifact.
  assert.equal(/WSF_GOOGLE_ACCESS_TOKEN|GoogleAuth|wsf-staging\.env|WSF_SDK_CONFIG_FILE/.test(live), false);
});

await test('the changed-journey manifest and script come from the OPERATIONAL checkout, not the candidate', () => {
  const block = stepBlock('hosted-verify', 'Run the changed-journey smoke (report-only)');
  assert.match(block, /^\s+WSF_JOURNEY_MANIFEST: \$\{\{ github\.workspace \}\}\/ops\/\.github\/wsf-staging\/journeys\/manifest\.json$/m);
  assert.match(block, /^\s+run: node \.\.\/ops\/\.github\/wsf-staging\/hosted-changed-journeys\.mjs$/m);
  assert.match(block, /^\s+WSF_RESULT_DIR: \$\{\{ github\.workspace \}\}\/wsf-evidence$/m, 'its results must pass through the same evidence scan');
});

console.log(`\nworkflow-contract: ${passed} passed`);
