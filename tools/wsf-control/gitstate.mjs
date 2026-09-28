/**
 * The state branch as git sees it (AUTONOMY-STATE-1B; memo §2.3).
 *
 * The ref is `refs/heads/wsf-control-state-2`: the documented recovery ref that
 * supersedes `wsf-control-state`, whose first bootstrap imported a stale input (run 50).
 * The old ref is never written again and stays as the audit record. The ruleset covers
 * wsf-control-state*, so every recovery ref is protected from its first push. Writes are
 * FAST-FORWARD ONLY: a plain push, never forced, so a concurrent writer's push
 * makes ours a non-fast-forward that git refuses (ref compare-and-swap). The
 * caller then re-reads and re-derives; ledgers are never merged.
 *
 * Authentication never touches argv or the remote URL: the installation token is
 * handed to git as an http.extraheader through GIT_CONFIG_* environment entries,
 * which git does not echo. Tests use a local bare repository and no token.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const STATE_REF = 'wsf-control-state-2';
/** wsf-control-state, then wsf-control-state-2, -3, …: the only names a state ref may take. */
export const STATE_REF_RE = /^wsf-control-state(?:-([2-9]|[1-9][0-9]+))?$/;

/**
 * The ref a recovery ref supersedes, DERIVED from its name, never configured: -2 supersedes the base ref and
 * -N supersedes -(N-1). The base ref supersedes nothing. A ref outside the naming scheme is refused.
 */
export function predecessorRef(ref) {
  const m = STATE_REF_RE.exec(ref);
  if (!m) throw new Error(`refused: ${JSON.stringify(ref)} is not a control-state ref`);
  if (!m[1]) return null;
  const n = Number(m[1]);
  return n === 2 ? 'wsf-control-state' : `wsf-control-state-${n - 1}`;
}
/** The files a state commit holds; nothing else is ever written to the branch. */
export const STATE_FILES = Object.freeze(['events.jsonl', 'state.json', 'CURRENT.md']);

/** git's environment for a token: an Authorization header for github.com only, outside argv and URLs. */
export function tokenGitEnv(token) {
  const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
  return { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`, GIT_TERMINAL_PROMPT: '0' };
}

/** Remove anything credential-shaped before a git message is shown. */
export const redact = (text) => String(text)
  .replace(/(authorization:\s*)(basic|bearer)\s+\S+/gi, '$1$2 [redacted]')
  .replace(/x-access-token:[^@\s]+/gi, 'x-access-token:[redacted]')
  .replace(/\b(?:ghs|ghp|gho|ghu|ghr|github_pat)_[0-9A-Za-z_]+/g, '[redacted]');

function git(args, { cwd, env = {}, allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });
  if (r.status !== 0 && !allowFail) throw new Error(`git ${args[0]} failed: ${redact(r.stderr || r.stdout).trim()}`);
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: redact(r.stderr || '').trim() };
}

/** The remote's commit for the state ref, or null when the ref does not exist. */
export function remoteHead(remote, { env, ref = STATE_REF } = {}) {
  const r = git(['ls-remote', '--heads', remote, `refs/heads/${ref}`], { env });
  const line = r.out.split('\n').find((l) => l.endsWith(`\trefs/heads/${ref}`));
  return line ? line.split('\t')[0] : null;
}

/** A fresh working directory at the remote state commit (or an empty repository when the ref is absent). */
export function checkoutState(remote, dir, { env, ref = STATE_REF } = {}) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  git(['init', '-q'], { cwd: dir });
  const head = remoteHead(remote, { env, ref });
  if (head) {
    git(['fetch', '-q', '--no-tags', remote, `refs/heads/${ref}`], { cwd: dir, env });
    git(['checkout', '-q', '--detach', 'FETCH_HEAD'], { cwd: dir });
  }
  return head;
}

/** Read a state file from the checkout ('' when absent). */
export const readStateFile = (dir, name) => (fs.existsSync(path.join(dir, name)) ? fs.readFileSync(path.join(dir, name), 'utf8') : '');

/**
 * Commit the three state files on top of the checked-out commit (an orphan root when there is none).
 * The author and committer are the App's bot identity; git records exactly that.
 */
export function commitState(dir, files, message, author) {
  for (const name of Object.keys(files)) if (!STATE_FILES.includes(name)) throw new Error(`refused: ${name} is not a state file`);
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  git(['add', '--', ...Object.keys(files)], { cwd: dir });
  const who = { GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email, GIT_COMMITTER_NAME: author.name, GIT_COMMITTER_EMAIL: author.email };
  git(['-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty-message', '-m', message], { cwd: dir, env: who });
  return git(['rev-parse', 'HEAD'], { cwd: dir }).out;
}

/**
 * Push the local HEAD to the state ref, fast-forward only. Never forced: a concurrent
 * writer's commit makes this push a non-fast-forward, which git refuses. Returns
 * { ok } or { ok: false, rejected: true|false, detail } (detail is redacted).
 */
export function pushFastForward(dir, remote, { env, ref = STATE_REF } = {}) {
  const r = git(['push', '--porcelain', remote, `HEAD:refs/heads/${ref}`], { cwd: dir, env, allowFail: true });
  if (r.ok) return { ok: true };
  const detail = `${r.out}\n${r.err}`.trim();
  const rejected = /\[rejected\]|non-fast-forward|fetch first|stale info|\[remote rejected\]/i.test(detail);
  return { ok: false, rejected, detail };
}
