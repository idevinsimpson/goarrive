#!/usr/bin/env node
/** Per-invocation settings, not a worker scheduler. Plan never starts Claude. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const DIR = path.dirname(fileURLToPath(import.meta.url));
export const registry = JSON.parse(fs.readFileSync(path.join(DIR, 'profiles.json'), 'utf8'));
const MODEL = /^claude-(sonnet|opus)-5-5$/;
const EFFORTS = ['medium', 'high', 'xhigh'];
const TIERS = ['default', 'economy', 'deep', 'ultracode'];
export function atLeast(version, minimum = registry.minimumClaudeVersion) {
  const parse = (s) => { const m = /(?:^|\s)(\d+)\.(\d+)\.(\d+)(?=\s|$)/.exec(s); return m && m.slice(1).map(Number); };
  const a = parse(version), b = parse(minimum);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return true;
}
export function plan(worker, tier = 'default') {
  if (!Object.hasOwn(registry.workers, worker)) throw new Error('Unknown worker; use L0, W3, W4, W5, W7 or W9.');
  if (!TIERS.includes(tier)) throw new Error('Unknown tier.');
  if (worker === 'W5' && !['default', 'deep'].includes(tier)) throw new Error('W5 security review cannot use an economy or orchestration override.');
  if (worker === 'L0' && tier === 'ultracode') throw new Error('L0 remains a single integrator.');
  const p = { ...registry.workers[worker] };
  if (tier === 'economy') { p.ultracode = false; p.effort = worker === 'W9' ? 'medium' : 'high'; }
  if (tier === 'deep') { p.model = 'claude-opus-5-5'; p.effort = 'xhigh'; p.ultracode = false; }
  if (tier === 'ultracode') { p.ultracode = true; }
  if (!MODEL.test(p.model) || !EFFORTS.includes(p.effort) || typeof p.ultracode !== 'boolean') throw new Error('Invalid configured model/effort/Ultracode.');
  if (!Number.isSafeInteger(p.maxTurns) || p.maxTurns < 1 || p.maxTurns > 40 || p.timeoutMinutes !== 30) throw new Error('Invalid run bounds.');
  const settings = {
    model: p.model, effortLevel: p.effort, maxEffortLevel: p.effort,
    ultracode: p.ultracode, disableWorkflows: !p.ultracode, workflowSizeGuideline: 'small'
  };
  return { worker, tier, inbox: p.inbox, role: p.role, settings, maxTurns: p.maxTurns,
    timeoutMinutes: p.timeoutMinutes, executeAllowed: p.executeAllowed,
    evidence: 'CONFIGURED_ONLY; not a running-session or billing receipt' };
}
export function command(p, settingsPath, resume = null) {
  if (!p.executeAllowed) throw new Error('L0 launch refused: do not create a second integrator.');
  if (resume !== null && !/^[A-Za-z0-9_-]{1,160}$/.test(resume)) throw new Error('Invalid local resume ID.');
  return ['--model', p.settings.model, '--effort', p.settings.effortLevel,
    '--settings', settingsPath, '--max-turns', String(p.maxTurns), '-p',
    ...(resume ? ['--resume', resume] : [])];
}
export function executionEnv(p, original) {
  const env = { ...original };
  // These are the documented per-launch controls. Do not rewrite provider,
  // credential, managed-policy, global or project settings files.
  env.ANTHROPIC_MODEL = p.settings.model;
  env.CLAUDE_CODE_EFFORT_LEVEL = p.settings.effortLevel;
  if (p.settings.ultracode) delete env.CLAUDE_CODE_DISABLE_WORKFLOWS;
  else env.CLAUDE_CODE_DISABLE_WORKFLOWS = '1';
  return env;
}
export function parseArgs(args) {
  const [mode, worker, ...rest] = args;
  if (!['plan', 'run'].includes(mode)) throw new Error('Usage: launch.mjs plan|run WORKER [--tier default|economy|deep|ultracode] [--prompt-file FILE] [--resume LOCAL_ID] [--output FILE] [--github-output]');
  const o = { mode, worker, tier: 'default' }, seen = new Set();
  for (let i = 0; i < rest.length; i++) {
    const k = rest[i];
    if (seen.has(k)) throw new Error('Duplicate option.'); seen.add(k);
    if (k === '--github-output') { o.githubOutput = true; continue; }
    const keys = { '--tier': 'tier', '--prompt-file': 'promptFile', '--resume': 'resume', '--output': 'output' };
    if (!Object.hasOwn(keys, k) || !rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error('Unsupported or missing option.');
    o[keys[k]] = rest[++i];
  }
  if (mode === 'run' && !o.promptFile) throw new Error('run requires a bounded, already-authorized --prompt-file.');
  if (mode === 'plan' && (o.promptFile || o.resume)) throw new Error('plan accepts no task or resume ID.');
  return o;
}
function main() {
  const o = parseArgs(process.argv.slice(2)), p = plan(o.worker, o.tier);
  if (o.output) fs.writeFileSync(o.output, JSON.stringify(p.settings, null, 2) + '\n', { mode: 0o600 });
  if (o.githubOutput) {
    if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is absent.');
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `settings=${JSON.stringify(p.settings)}\nmodel=${p.settings.model}\neffort=${p.settings.effortLevel}\n`);
  }
  if (o.mode === 'plan') { console.log(JSON.stringify(p, null, 2)); return; }
  // This wrapper is not installed as an inbox consumer. Calling run is an
  // explicit operator launch; stop the former executor first. No silent API-key
  // fallback, token generation or global config writes occur here.
  if (process.env.WSF_WORKER_LAUNCH_CONFIRMED !== 'existing-executor-stopped') throw new Error('Confirm the single-executor handover before run; plan is safe without it.');
  command(p, '/unused', o.resume ?? null);
  const version = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 15000 });
  if (version.error || version.status !== 0 || !atLeast(version.stdout.trim())) throw new Error('Claude Code >=2.1.284 is required; version unverified or too old.');
  const prompt = fs.readFileSync(o.promptFile, 'utf8');
  if (!prompt.trim() || Buffer.byteLength(prompt) > 65536) throw new Error('Task prompt must be nonempty and at most 64 KiB.');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-worker-profile-'));
  try {
    const settingsPath = path.join(temp, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify(p.settings), { mode: 0o600 });
    console.log(`WSF_CONFIGURED worker=${p.worker} model=${p.settings.model} effort=${p.settings.effortLevel} ultracode=${p.settings.ultracode}; runtime overrides must be checked`);
    const r = spawnSync('claude', command(p, settingsPath, o.resume ?? null), {
      input: prompt, stdio: ['pipe', 'inherit', 'inherit'], env: executionEnv(p, process.env),
      timeout: p.timeoutMinutes * 60000, killSignal: 'SIGTERM'
    });
    if (r.error || r.signal || r.status !== 0) throw new Error('Claude stopped, timed out or failed; preserve prior work and inspect its session.');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(`WSF_PROFILE_REFUSED: ${e.message}`); process.exitCode = 1; }
}
