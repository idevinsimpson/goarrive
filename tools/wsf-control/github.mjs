/**
 * The smallest GitHub REST client the Step-5 writer needs: read PRs, compares,
 * runs and comments; create and edit the ONE shadow CURRENT comment.
 *
 * The token is the App's short-lived installation token, passed in; it is sent
 * only in the Authorization header and never logged. Every method returns plain
 * data; errors carry the HTTP status and path, never a header or a body echo.
 */
const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(status, what) { super(`GitHub ${what} returned HTTP ${status}`); this.status = status; }
}

export function gitHubClient({ token, repo, fetchImpl = globalThis.fetch }) {
  if (!token) throw new Error('an installation token is required');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('repo must be owner/name');
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'wsf-control-writer' };
  async function call(method, route, body, what) {
    const res = await fetchImpl(`${API}${route}`, { method, headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 404) return null;
    if (!res.ok) throw new GitHubError(res.status, what);
    return res.status === 204 ? null : res.json();
  }
  const r = `/repos/${repo}`;
  return {
    async pull(n) {
      const pr = await call('GET', `${r}/pulls/${n}`, null, `pull ${n}`);
      return pr && { state: pr.state, merged: Boolean(pr.merged), headSha: pr.head.sha, baseSha: pr.base?.sha ?? null, baseRef: pr.base?.ref ?? null, mergeSha: pr.merged ? pr.merge_commit_sha : undefined };
    },
    /**
     * Paths changed between two commits, or null when GitHub cannot compare them (then the change is reported unknown).
     * A rename reports BOTH paths: the path it left matters as much as the one it reached (a move out of a protected or
     * subject path is a change to that path; W4 F1 on STAGING-FRESHNESS-FASTPATH).
     */
    async changedPaths(base, head) {
      const out = [];
      for (let page = 1; page <= 3; page += 1) {
        const c = await call('GET', `${r}/compare/${base}...${head}?per_page=100&page=${page}`, null, 'compare');
        if (!c) return null;
        const files = c.files ?? [];
        out.push(...files.flatMap((f) => (f.previous_filename ? [f.previous_filename, f.filename] : [f.filename])));
        if (files.length < 100) return out;
      }
      return null; // more than 300 paths: do not guess
    },
    /**
     * The git tree id of a top-level directory at a commit: its sha, '' when the commit has no such directory, or null when
     * GitHub cannot say. Two equal ids mean byte-identical trees (the fast path's functions-tree check).
     */
    async treeSha(commit, dir) {
      const c = await call('GET', `${r}/git/commits/${commit}`, null, 'commit');
      if (!c?.tree?.sha) return null;
      const t = await call('GET', `${r}/git/trees/${c.tree.sha}`, null, 'tree');
      if (!Array.isArray(t?.tree)) return null;
      const e = t.tree.find((x) => x.path === dir);
      return !e ? '' : e.type === 'tree' && /^[0-9a-f]{40}$/.test(e.sha) ? e.sha : null;
    },
    /** Does `head` descend from `base`? true, false, or null when GitHub cannot compare them (R-DELIVER-1). */
    async descends(base, head) {
      const c = await call('GET', `${r}/compare/${base}...${head}?per_page=1`, null, 'compare');
      if (!c) return null;
      return c.status === 'ahead' || c.status === 'identical';
    },
    /** One file's text at a commit, or null when it does not exist there (Step 7: the full-path pin at the running main). */
    async fileText(filePath, ref) {
      const f = await call('GET', `${r}/contents/${filePath.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`, null, 'contents');
      if (!f || f.type !== 'file' || f.encoding !== 'base64' || typeof f.content !== 'string') return null;
      return Buffer.from(f.content, 'base64').toString('utf8');
    },
    async run(id) {
      const x = await call('GET', `${r}/actions/runs/${id}`, null, `run ${id}`);
      return x && { status: ['queued', 'in_progress', 'completed'].includes(x.status) ? x.status : 'queued', conclusion: x.status === 'completed' ? x.conclusion : null };
    },
    /** The workflow runs of one workflow file, newest first (health: the writer's own recent runs). */
    async workflowRuns(file, n = 10) {
      const x = await call('GET', `${r}/actions/workflows/${file}/runs?per_page=${n}`, null, 'workflow runs');
      return (x?.workflow_runs ?? []).map((w) => ({ id: w.id, status: w.status, conclusion: w.conclusion, createdAt: w.created_at, headSha: w.head_sha, title: w.display_title ?? null }));
    },
    async comment(id) {
      const c = await call('GET', `${r}/issues/comments/${id}`, null, `comment ${id}`);
      return c && { id: c.id, body: c.body ?? '', author: c.user?.login ?? null, association: c.author_association ?? null, createdAt: c.created_at ?? null, updatedAt: c.updated_at ?? null };
    },
    /** The newest `count` comments of an issue or PR conversation, oldest first (the endpoint pages oldest-first). */
    async recentComments(issue, count = 100) {
      let window = [];
      for (let page = 1; page <= 100; page += 1) {
        const batch = (await call('GET', `${r}/issues/${issue}/comments?per_page=100&page=${page}`, null, `comments of #${issue}`)) ?? [];
        window = window.concat(batch).slice(-count);
        if (batch.length < 100) break;
      }
      return window.map((c) => ({ id: c.id, body: c.body ?? '', author: c.user?.login ?? null, association: c.author_association ?? null, createdAt: c.created_at ?? null, updatedAt: c.updated_at ?? null }));
    },
    async createComment(issue, body) {
      const c = await call('POST', `${r}/issues/${issue}/comments`, { body }, `create comment on #${issue}`);
      return { id: c.id };
    },
    async editComment(id, body) { await call('PATCH', `${r}/issues/comments/${id}`, { body }, `edit comment ${id}`); },
    /** The numeric user id of an App's bot account, for its commit email. */
    async botUserId(slug) {
      const u = await call('GET', `/users/${encodeURIComponent(`${slug}[bot]`)}`, null, 'bot user');
      return u?.id ?? null;
    },
  };
}
