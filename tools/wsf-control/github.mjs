/**
 * The smallest GitHub REST client the Step-5 writer needs: read PRs, compares,
 * runs and comments; create and edit the ONE shadow CURRENT comment.
 *
 * The token is the App's short-lived installation token, passed in; it is sent
 * only in the Authorization header and never logged. Every method returns plain
 * data; errors carry the HTTP status and path, never a header or a body echo.
 */
const API = 'https://api.github.com';
/**
 * Comments per page: a fixed 25, not the endpoint's 100. Runs 37493661423 and 37494992451 still lost the socket after
 * ~249 KB with 100-comment pages of #365's long comments; a quarter-size page keeps every single response small. The
 * newest-`count` window costs more requests (still bounded), never a larger body.
 */
export const PAGE = 25;
/** Extra pages read past the counted end for comments that arrive mid-read, and back for ones deleted mid-read. */
const ROLLOVER_PAGES = 2;

export class GitHubError extends Error {
  constructor(status, what) { super(`GitHub ${what} returned HTTP ${status}`); this.status = status; }
}

export function gitHubClient({ token, repo, fetchImpl = globalThis.fetch }) {
  if (!token) throw new Error('an installation token is required');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('repo must be owner/name');
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'wsf-control-writer' };
  async function once(method, route, body, what) {
    const res = await fetchImpl(`${API}${route}`, { method, headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 404) return null;
    if (!res.ok) throw new GitHubError(res.status, what);
    return res.status === 204 ? null : res.json();
  }
  /**
   * One request. A GET that fails in TRANSPORT (the socket closed, the body cut off: anything but an HTTP answer) is
   * tried exactly once more, at once; a second transport failure surfaces. An HTTP answer, 4xx or 5xx, is never
   * retried, and a POST or PATCH is never retried at all, so no mutation is ever replayed.
   */
  async function call(method, route, body, what) {
    try {
      return await once(method, route, body, what);
    } catch (e) {
      if (method !== 'GET' || e instanceof GitHubError) throw e;
      return once(method, route, body, what);
    }
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
    /**
     * The newest `count` comments of an issue or PR conversation, oldest first (the endpoint pages oldest-first).
     *
     * BOUNDED (CONTROL-RECENT-COMMENTS-SAFE-READ-1). Walking from page 1 to the end read ~1.6 MB of #365 per run until
     * GitHub closed the socket. Instead: read the conversation's comment count, then only the pages at its end.
     *
     * 1. PROBE forward from the counted last page while pages are full, only to find the actual end: a comment that
     *    lands after the count rolls onto a further page (up to ROLLOVER_PAGES).
     * 2. Build the window from a fresh DESCENDING read, the end page toward older pages, until `count` are held. The
     *    probe's copies of the pages below the end are discarded: an arrival plus an older deletion between two probes
     *    can move the newest comment onto a page already probed (W9, #497 6019310772), and only a page read after every
     *    later page is trusted. Read newest-to-oldest, a mid-read deletion can only shift a held comment onto an
     *    earlier page (a duplicate, dropped by id), never skip one.
     *
     * A conversation that keeps growing past the rollover, an unreadable count, or a window that cannot be filled
     * within its bound is refused, never cut short. An absent conversation is [].
     */
    async recentComments(issue, count = 100) {
      const meta = await call('GET', `${r}/issues/${issue}`, null, `issue #${issue}`);
      if (meta === null) return [];
      const total = meta.comments;
      if (!Number.isInteger(total) || total < 0) throw new Error(`GitHub issue #${issue} returned no readable comment count; refusing to guess a window`);
      const lastPage = Math.max(1, Math.ceil(total / PAGE));
      const read = async (n) => (await call('GET', `${r}/issues/${issue}/comments?per_page=${PAGE}&page=${n}`, null, `comments of #${issue}`)) ?? [];
      let end = lastPage;
      let endBatch;
      for (;; end += 1) {
        if (end > lastPage + ROLLOVER_PAGES) throw new Error(`comments of #${issue} kept growing past ${ROLLOVER_PAGES} extra pages during the read; refusing a partial window`);
        endBatch = await read(end);
        if (endBatch.length < PAGE) break;
      }
      // The descending pass starts from the end page's read (the newest read of all); no earlier probe copy is kept.
      const pages = new Map([[end, endBatch]]);
      const held = () => {
        const byId = new Map();
        for (const n of [...pages.keys()].sort((x, y) => x - y)) for (const c of pages.get(n)) if (!byId.has(c.id)) byId.set(c.id, c);
        return [...byId.values()];
      };
      const floor = Math.max(1, lastPage - Math.ceil(count / PAGE) - ROLLOVER_PAGES);
      let first = end;
      while (held().length < count && first > 1) {
        if (first <= floor) throw new Error(`the newest ${count} comments of #${issue} could not be read in a bounded window; refusing a partial one`);
        first -= 1;
        pages.set(first, await read(first));
      }
      return held().slice(-count).map((c) => ({ id: c.id, body: c.body ?? '', author: c.user?.login ?? null, association: c.author_association ?? null, createdAt: c.created_at ?? null, updatedAt: c.updated_at ?? null }));
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
