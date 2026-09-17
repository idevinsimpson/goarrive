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
  for (const [, cond, name] of uploads) {
    assert.match(cond, /steps\.scan-[a-z-]+\.outcome == 'success'/, `${name} upload is not gated on a scan outcome`);
  }
  // And the bare always() form must not remain on any evidence upload.
  const bare = /if: always\(\)\n\s+with:\n\s+name: wsf-[a-z-]*evidence/.test(text);
  assert.equal(bare, false, 'an evidence upload still uses a bare always()');
});

test('both scan steps carry the id their upload references', () => {
  for (const id of ['scan-deployment-evidence', 'scan-hosted-evidence']) {
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
  for (const j of ['config', 'deploy', 'hosted-verify']) {
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

test('the hosted job runs the candidate-local Playwright binary', () => {
  assert.match(jobs['hosted-verify'], /apps\/westayfit\/node_modules\/\.bin\/playwright/);
  assert.match(jobs['hosted-verify'], /install --with-deps chromium/);
});

test('privileged dependency installs keep --ignore-scripts', () => {
  for (const j of ['config', 'deploy', 'hosted-verify']) {
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
  ['deploy', 'Verify the deployed state', '.github/wsf-staging/verify-deployment.mjs'],
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

test('the SDK config file lives in the runner temp dir, not the checkout or evidence', () => {
  const block = stepBlock('hosted-verify', 'Run the Package E hosted authorization checks');
  assert.match(block, /export WSF_SDK_CONFIG_FILE="\$RUNNER_TEMP\/[a-z-]+\.json"/);
  assert.equal(/WSF_SDK_CONFIG_FILE="[^"]*(github\.workspace|wsf-evidence)/.test(block), false);
});

test('nothing in the hosted job prints the SDK config or the env artifact', () => {
  const j = jobs['hosted-verify'].split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.equal(/\b(cat|echo|printenv|env)\b[^\n]*(wsf-staging\.env|WSF_SDK_CONFIG_FILE|WSF_STAGING_API_KEY|EXPO_PUBLIC)/.test(j), false);
});

console.log(`\nworkflow-contract: ${passed} passed`);
