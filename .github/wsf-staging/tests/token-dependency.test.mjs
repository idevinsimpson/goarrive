#!/usr/bin/env node
/**
 * Every job that mints a REST token through google-auth-library installs it
 * first, where the minting step's working directory can resolve it.
 *
 * Run 54 (journey-activation) failed with `Cannot find module
 * 'google-auth-library'`: unlike hosted-verify and cleanup-recovery, the job
 * never ran the pinned deployment-tooling install, so the token mint in
 * `app/` had nothing to resolve. This suite would have failed on that
 * workflow, both statically and by resolving the workflow's own token snippet
 * from the step's real working directory in a simulated runner workspace.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const WF = path.resolve(process.env.WSF_WORKFLOW_UNDER_TEST || '.github/workflows/wsf-staging-deploy.yml');
const text = fs.readFileSync(WF, 'utf8');
let passed = 0;
const test = (n, f) => { f(); passed += 1; console.log(`  ok  ${n}`); };

const INSTALL = 'npm install --no-save --ignore-scripts "$FIREBASE_TOOLS"';
const REQUIRE = /require\("google-auth-library"\)/;
/** A step installs the pinned tooling when one line of its script is exactly the install (alone, or in a multi-line script). */
const installs = (s) => s.run.split('\n').some((l) => l.trim() === INSTALL);

/** jobs → ordered steps { name, workingDirectory, if, run } from the workflow text. Comments are dropped. */
function parse() {
  const lines = text.split('\n').filter((l) => !/^\s*#/.test(l));
  const start = lines.indexOf('jobs:');
  assert.ok(start >= 0, 'no jobs: block');
  const jobs = {};
  let job = null;
  let step = null;
  let inRun = false;
  for (const l of lines.slice(start + 1)) {
    const j = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(l);
    if (j) { job = { steps: [] }; jobs[j[1]] = job; step = null; inRun = false; continue; }
    if (!job) continue;
    if (/^ {6}- /.test(l)) {
      step = { name: null, workingDirectory: '.', if: null, run: '' };
      job.steps.push(step);
      inRun = false;
    }
    if (!step) continue;
    const kv = /^ {6}[- ] ([a-z-]+):\s?(.*)$/.exec(l) || /^ {8}([a-z-]+):\s?(.*)$/.exec(l);
    if (kv && !inRun) {
      const [, k, v] = kv;
      if (k === 'name') step.name = v.trim();
      if (k === 'working-directory') step.workingDirectory = v.trim();
      if (k === 'if') step.if = v.trim();
      if (k === 'run') { inRun = v.trim() === '|'; if (!inRun) step.run = v.trim(); }
      continue;
    }
    if (inRun) {
      if (/^ {10}/.test(l) || l.trim() === '') step.run += `${l.slice(10)}\n`;
      else inRun = false;
    }
  }
  return jobs;
}
const jobs = parse();

/** Is `dir` (the install's cwd) `cwd` or an ancestor of it, so Node's resolution from `cwd` walks up into `dir/node_modules`? */
const within = (cwd, dir) => {
  const rel = path.posix.relative(path.posix.normalize(dir), path.posix.normalize(cwd));
  return rel === '' || (!rel.startsWith('..') && !path.posix.isAbsolute(rel));
};

/** For each job: the token-minting steps, and the install each one resolves through (or null). */
function plan() {
  const out = [];
  for (const [name, job] of Object.entries(jobs)) {
    job.steps.forEach((s, i) => {
      if (!REQUIRE.test(s.run)) return;
      const install = job.steps.slice(0, i).find((x) => installs(x) && x.if === null && within(s.workingDirectory, x.workingDirectory)) ?? null;
      out.push({ job: name, step: s, index: i, install });
    });
  }
  return out;
}

test('the pinned tooling is an exact version', () => {
  assert.match(text, /^ {2}FIREBASE_TOOLS: firebase-tools@\d+\.\d+\.\d+\s*$/m);
});

test('the parser sees every token-minting step (so a regression cannot hide from it)', () => {
  const found = plan();
  const perJob = Object.fromEntries(Object.keys(jobs).map((j) => [j, found.filter((x) => x.job === j).length]));
  const textCount = (text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n').match(/require\("google-auth-library"\)/g) || []).length;
  assert.equal(found.length, textCount, 'every require in the workflow is inside a parsed step');
  assert.ok(perJob['journey-activation'] >= 2, 'journey-activation mints for the activation and for cleanup');
  for (const j of ['hosted-verify', 'cleanup-recovery']) assert.ok(perJob[j] >= 1, `${j} mints a token`);
});

test('every job that requires google-auth-library installs the pinned tooling first, unconditionally, where the require resolves it', () => {
  const missing = plan().filter((x) => x.install === null).map((x) => `${x.job} › ${x.step.name}`);
  assert.deepEqual(missing, [], `token mint with no prior pinned install resolvable from its working directory: ${missing.join('; ')}`);
});

test('journey-activation installs the pinned tooling after the served-marker check and before authentication', () => {
  const steps = jobs['journey-activation'].steps;
  const at = (pred, what) => { const i = steps.findIndex(pred); assert.ok(i >= 0, `journey-activation has no ${what}`); return i; };
  const marker = at((s) => /check-served-marker\.mjs/.test(s.run), 'served-marker step');
  const install = at(installs, 'pinned tooling install');
  const authIdx = at((s) => s.name === 'Authenticate to Google Cloud', 'authentication step');
  const mint = at((s) => REQUIRE.test(s.run), 'token mint');
  assert.ok(marker < install, 'the marker is still read before anything else is installed');
  assert.ok(install < authIdx && install < mint, 'the install precedes authentication and the first token mint');
});

/**
 * Resolution, not just text: build a runner-shaped workspace with the stub
 * package installed where the job's install step runs, and execute the
 * workflow's own token snippet from the minting step's working directory.
 */
function resolveInWorkspace(installDir, cwd, snippet) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-token-dep-'));
  for (const d of ['ops', 'app', 'cfg']) fs.mkdirSync(path.join(ws, d), { recursive: true });
  if (installDir !== null) {
    const pkg = path.join(ws, installDir, 'node_modules', 'google-auth-library');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'google-auth-library', version: '0.0.0-stub', main: 'index.js' }));
    fs.writeFileSync(path.join(pkg, 'index.js'), 'class GoogleAuth { constructor(o) { this.o = o; } getAccessToken() { return Promise.resolve("stub-token"); } }\nmodule.exports = { GoogleAuth };\n');
  }
  fs.mkdirSync(path.join(ws, cwd), { recursive: true });
  const env = { PATH: process.env.PATH, HOME: ws };
  return spawnSync(process.execPath, ['-e', snippet], { cwd: path.join(ws, cwd), env, encoding: 'utf8' });
}
const snippetOf = (run) => {
  const m = /node -e '\n([\s\S]*?)\n\s*'\)"/.exec(run);
  assert.ok(m, 'the token mint is not in the expected node -e form');
  return m[1];
};

test('run-54 reproduction: with no install, the workflow\'s own snippet cannot resolve google-auth-library', () => {
  const x = plan().find((p) => p.job === 'journey-activation');
  const r = resolveInWorkspace(null, x.step.workingDirectory, snippetOf(x.step.run));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Cannot find module 'google-auth-library'/);
});

test('an install that the minting step cannot walk up to does not count (for example, into ops/)', () => {
  const x = plan().find((p) => p.job === 'journey-activation' && p.step.workingDirectory === 'app');
  const r = resolveInWorkspace('ops', x.step.workingDirectory, snippetOf(x.step.run));
  assert.match(r.stderr, /Cannot find module 'google-auth-library'/);
  assert.equal(within('app', 'ops'), false);
});

test('every token mint resolves google-auth-library from its actual working directory through its job\'s install', () => {
  for (const x of plan()) {
    assert.ok(x.install, `${x.job} › ${x.step.name}: no install`);
    const r = resolveInWorkspace(x.install.workingDirectory, x.step.workingDirectory, snippetOf(x.step.run));
    assert.equal(r.status, 0, `${x.job} › ${x.step.name} (cwd ${x.step.workingDirectory}): ${r.stderr.split('\n')[0]}`);
    assert.equal(r.stdout, 'stub-token', `${x.job} › ${x.step.name}: the snippet did not mint through the resolved package`);
  }
});

console.log(`token-dependency: ${passed} passed`);
