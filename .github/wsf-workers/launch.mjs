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
  // --setting-sources user: only the isolated config directory's own settings
  // (checked by configProblems) plus --settings and managed policy. The
  // checkout's project/local settings never reach a subscription run.
  return ['--model', p.settings.model, '--effort', p.settings.effortLevel,
    '--settings', settingsPath, '--setting-sources', 'user', '--max-turns', String(p.maxTurns), '-p',
    ...(resume ? ['--resume', resume] : [])];
}

/*
 * Subscription-only credential mode (#562 finding 5962813120). The official
 * precedence (code.claude.com/docs/en/authentication, "Authentication
 * precedence") puts cloud-provider selection, ANTHROPIC_AUTH_TOKEN,
 * ANTHROPIC_API_KEY (always used by -p when present) and apiKeyHelper ABOVE
 * CLAUDE_CODE_OAUTH_TOKEN, and named/federation profiles beside them; a gateway
 * session outranks them all. So clearing one variable proves nothing. The run
 * path is accepted only when ALL of these hold, checked before any model call:
 *   1. the exact child environment carries CLAUDE_CODE_OAUTH_TOKEN and no
 *      other credential, provider, endpoint or profile selector (names only;
 *      a value is never read beyond being nonempty, never printed);
 *   2. an operator-dedicated CLAUDE_CONFIG_DIR holds no stored login and its
 *      user settings carry no credential helper, env block or provider key;
 *   3. `claude auth status`, run with that same environment, reports
 *      authMethod oauth_token for that same config directory.
 * Anything else, including output this wrapper cannot interpret, is refused.
 * Conflicting credentials are refused, never deleted or overridden; managed
 * policy is never bypassed.
 */
const ALLOWED_ANTHROPIC = new Set(['ANTHROPIC_MODEL']);
export function credentialProblems(env) {
  const bad = [];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || v === '') continue;
    if ((k.startsWith('ANTHROPIC_') && !ALLOWED_ANTHROPIC.has(k)) || k.startsWith('CLAUDE_CODE_USE_') ||
        k.startsWith('CLAUDE_CODE_PROVIDER') || k === 'CLAUDE_CODE_SIMPLE' || k === 'AWS_BEARER_TOKEN_BEDROCK' ||
        (k.startsWith('CLAUDE_CODE_OAUTH_') && k !== 'CLAUDE_CODE_OAUTH_TOKEN')) bad.push(k);
  }
  const problems = bad.sort().map((k) => `conflicting credential/provider/endpoint variable ${k} is set`);
  if (typeof env.CLAUDE_CODE_OAUTH_TOKEN !== 'string' || !env.CLAUDE_CODE_OAUTH_TOKEN.trim()) {
    problems.push('CLAUDE_CODE_OAUTH_TOKEN (subscription setup-token) is absent');
  }
  return problems;
}
const SETTINGS_KEY = /helper|auth|credential|token|apikey|^env$|provider|login|endpoint|baseurl|aws|gcp|vertex|bedrock|foundry|gateway|otel/i;
export function configProblems(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return ['WSF_WORKER_CONFIG_DIR must be an absolute, operator-dedicated directory'];
  let st;
  try { st = fs.statSync(dir); } catch { return ['WSF_WORKER_CONFIG_DIR does not exist']; }
  if (!st.isDirectory()) return ['WSF_WORKER_CONFIG_DIR is not a directory'];
  const problems = [];
  // Existence only: a stored /login or saved Console key is never opened.
  if (fs.existsSync(path.join(dir, '.credentials.json'))) problems.push('the config directory holds a stored login (.credentials.json); use a dedicated directory');
  const settings = path.join(dir, 'settings.json');
  if (fs.existsSync(settings)) {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(settings, 'utf8')); } catch { parsed = null; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) problems.push('user settings.json is unreadable; refusing as unverifiable');
    else for (const k of Object.keys(parsed).sort()) if (SETTINGS_KEY.test(k)) problems.push(`user settings.json sets ${k}; credential/provider settings are not allowed`);
  }
  return problems;
}
/** Reads only authMethod/apiProvider/configDirectory from `claude auth status` JSON; never echoes the output. */
export function authStatusProblems(r, dir) {
  if (r.error || r.signal || r.status !== 0) return ['claude auth status failed or reports not logged in'];
  let j;
  try { j = JSON.parse(String(r.stdout)); } catch { return ['claude auth status output is not JSON; credential mode unverifiable'] }
  if (!j || typeof j !== 'object') return ['claude auth status output is not an object; credential mode unverifiable'];
  const problems = [];
  if (j.authMethod !== 'oauth_token') {
    const known = ['none', 'claude.ai', 'oauth_token', 'api_key', 'api_key_helper', 'third_party'];
    problems.push(`effective auth method is ${known.includes(j.authMethod) ? j.authMethod : 'unknown'}, not the subscription OAuth token`);
  }
  if (j.apiProvider !== undefined && j.apiProvider !== 'firstParty') problems.push('effective API provider is not first-party');
  let same = false;
  try { same = typeof j.configDirectory === 'string' && fs.realpathSync(j.configDirectory) === fs.realpathSync(dir); } catch { same = false; }
  if (!same) problems.push('claude auth status does not confirm the dedicated config directory');
  return problems;
}
function refuse(problems) {
  if (problems.length) throw new Error(`subscription-only preflight refused: ${problems.join('; ')}. Nothing was sent to a model.`);
}
export function executionEnv(p, original) {
  const env = { ...original };
  // The dedicated config directory is the only one a run may use.
  if (original.WSF_WORKER_CONFIG_DIR !== undefined) env.CLAUDE_CONFIG_DIR = original.WSF_WORKER_CONFIG_DIR;
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
  // Initial and resumed launches take exactly the same checks and environment.
  const env = executionEnv(p, process.env);
  refuse([...credentialProblems(env), ...configProblems(process.env.WSF_WORKER_CONFIG_DIR)]);
  const version = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 15000, env });
  if (version.error || version.status !== 0 || !atLeast(version.stdout.trim())) throw new Error('Claude Code >=2.1.284 is required; version unverified or too old.');
  refuse(authStatusProblems(spawnSync('claude', ['auth', 'status'], { encoding: 'utf8', timeout: 30000, env }), process.env.WSF_WORKER_CONFIG_DIR));
  const prompt = fs.readFileSync(o.promptFile, 'utf8');
  if (!prompt.trim() || Buffer.byteLength(prompt) > 65536) throw new Error('Task prompt must be nonempty and at most 64 KiB.');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-worker-profile-'));
  try {
    const settingsPath = path.join(temp, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify(p.settings), { mode: 0o600 });
    console.log(`WSF_CONFIGURED worker=${p.worker} model=${p.settings.model} effort=${p.settings.effortLevel} ultracode=${p.settings.ultracode} auth=oauth_token(preflight); runtime overrides must be checked`);
    const r = spawnSync('claude', command(p, settingsPath, o.resume ?? null), {
      input: prompt, stdio: ['pipe', 'inherit', 'inherit'], env,
      timeout: p.timeoutMinutes * 60000, killSignal: 'SIGTERM'
    });
    if (r.error || r.signal || r.status !== 0) throw new Error('Claude stopped, timed out or failed; preserve prior work and inspect its session.');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(`WSF_PROFILE_REFUSED: ${e.message}`); process.exitCode = 1; }
}
