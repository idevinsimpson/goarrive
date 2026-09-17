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

console.log(`\nworkflow-contract: ${passed} passed`);
