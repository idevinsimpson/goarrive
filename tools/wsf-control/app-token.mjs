/**
 * Mint the wsf-control-writer App's short-lived installation token, in process
 * (AUTONOMY-STATE-1B; memo §2.1). No third-party action holds the key: the job
 * reads WSF_CONTROL_WRITER_PRIVATE_KEY from the main-only environment
 * wsf-control-writer, signs a 9-minute App JWT with node:crypto, and exchanges it
 * for an installation token that is DOWN-SCOPED to this one repository and to
 * the Step-5 permissions (contents write for the state branch; issues and pull
 * requests write for the shadow comment, because the control inbox is a PR
 * conversation and GitHub refuses an App's comment there without pull requests
 * write; actions read). Actions write is never
 * requested: the App holds none, and Step 5 dispatches nothing.
 *
 * Neither the key nor the token is ever printed, returned in an error, or passed
 * on a command line.
 */
import crypto from 'node:crypto';

const API = 'https://api.github.com';
/** Exactly what a Step-5 run needs; the request narrows the installation's grant, never widens it. */
export const STEP5_PERMISSIONS = Object.freeze({ contents: 'write', issues: 'write', pull_requests: 'write', actions: 'read', metadata: 'read' });

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** A signed App JWT (RS256), valid from a minute ago for nine minutes (GitHub's limit is ten). */
export function appJwt(appId, privateKeyPem, nowMs = Date.now()) {
  const now = Math.floor(nowMs / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: String(appId) }));
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKeyPem);
  return `${head}.${body}.${b64url(sig)}`;
}

export class AppTokenError extends Error {}

/** { token, slug, expiresAt } for the installation on `repo`, or throws AppTokenError naming only the failed step. */
export async function installationToken({ appId, privateKeyPem, repo, fetchImpl = globalThis.fetch, nowMs }) {
  if (!privateKeyPem || !/BEGIN [A-Z ]*PRIVATE KEY/.test(privateKeyPem)) throw new AppTokenError('the App private key is not available to this job (environment wsf-control-writer)');
  let jwt;
  try { jwt = appJwt(appId, privateKeyPem, nowMs); } catch { throw new AppTokenError('the App private key could not sign (it is not a valid RSA key)'); }
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${jwt}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'wsf-control-writer' };
  const step = async (what, url, init = {}) => {
    const res = await fetchImpl(url, { ...init, headers: { ...headers, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
    if (!res.ok) throw new AppTokenError(`${what} returned HTTP ${res.status}`);
    return res.json();
  };
  const app = await step('GET /app', `${API}/app`);
  const inst = await step('GET installation', `${API}/repos/${repo}/installation`);
  const name = repo.split('/')[1];
  const tok = await step('POST access_tokens', `${API}/app/installations/${inst.id}/access_tokens`, { method: 'POST', body: JSON.stringify({ repositories: [name], permissions: STEP5_PERMISSIONS }) });
  if (!tok?.token) throw new AppTokenError('the installation token response carried no token');
  return { token: tok.token, slug: app.slug, expiresAt: tok.expires_at };
}
