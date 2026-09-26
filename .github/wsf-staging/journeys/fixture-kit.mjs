/**
 * Synthetic fixtures for the changed-journey drivers, on the same contract the
 * other hosted harnesses use (hosted-player-journey.mjs):
 *
 * - accounts are created through the admin Identity Toolkit path, preverified,
 *   with a run-specific synthetic email `wsf-<runTag>-…@example.com`;
 * - community, goal, shard and membership documents carry the run tag in
 *   their path; the one untagged shape, `wsfMemberProfiles/<uid>`, is linked
 *   through a run-tagged membership of the same uid;
 * - every account and document is written to the cleanup manifest BEFORE the
 *   request that creates it, so a crash leaves nothing untracked;
 * - nothing here deletes anything. The workflow's cleanup step, running
 *   cleanup-synthetic.mjs over this run's own manifest, is the only deleter.
 *
 * The password is held in memory for the browser sign-in and never written:
 * not to the manifest, the results or a log line.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DAY = 864e5;

function fv(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number' && Number.isInteger(value)) return { integerValue: String(value) };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  throw new Error(`unsupported Firestore value type: ${typeof value}`);
}
const fields = (record) => Object.fromEntries(Object.entries(record).map(([k, v]) => [k, fv(v)]));

/**
 * @param {{ projectId: string, apiKey: string, token: string, runTag: string,
 *           cleanupManifest: string, fetchImpl?: typeof fetch, now?: () => Date }} opts
 */
export function createFixtureKit({ projectId, apiKey, token, runTag, cleanupManifest, fetchImpl = fetch, now = () => new Date() }) {
  const cleanup = { users: new Set(), docs: new Set() };
  function persist() {
    fs.mkdirSync(path.dirname(cleanupManifest), { recursive: true, mode: 0o700 });
    fs.writeFileSync(cleanupManifest, `${JSON.stringify({
      project: projectId, runTag, users: [...cleanup.users], docs: [...cleanup.docs], linkedDocs: [],
    }, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(cleanupManifest, 0o600);
  }
  // An empty manifest is written first: "no fixtures" is then a receipt, not a missing file.
  persist();

  async function request(url, { method = 'GET', admin = false, body } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (admin) headers.authorization = `Bearer ${token}`;
    const response = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = null; }
    if (!response.ok) {
      // The body is not echoed: an error page can carry request details.
      const code = parsed?.error?.status || parsed?.error?.message || `HTTP_${response.status}`;
      throw new Error(`${method} fixture request failed: ${response.status} ${String(code).slice(0, 80)}`);
    }
    if (parsed === null) throw new Error(`${method} fixture request returned a body that is not JSON`);
    return parsed;
  }
  const docUrl = (docPath) => `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${docPath}`;
  async function putDoc(docPath, record) {
    cleanup.docs.add(docPath);
    persist();
    await request(docUrl(docPath), { method: 'PATCH', admin: true, body: { fields: fields(record) } });
  }
  async function createVerifiedUser(label) {
    const email = `wsf-${runTag}-${label}-${crypto.randomBytes(2).toString('hex')}@example.com`;
    const password = `Wsf!${crypto.randomBytes(18).toString('base64url')}`;
    const body = await request(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST', admin: true,
      body: { targetProjectId: projectId, email, password, displayName: `WSF ${label}`, emailVerified: true, disabled: false, returnSecureToken: false },
    });
    const uid = body?.localId;
    if (typeof uid !== 'string' || !uid) throw new Error('the account create returned no localId');
    cleanup.users.add(uid);
    persist();
    return { uid, email, password };
  }
  async function shards(goalId, total) {
    const per = Math.floor(total / 10);
    let rest = total - per * 10;
    for (let i = 0; i < 10; i += 1) {
      const count = per + (rest > 0 ? 1 : 0);
      if (rest > 0) rest -= 1;
      await putDoc(`wsfGoalCounters/${goalId}/shards/${i}`, { count });
    }
  }

  /**
   * One synthetic member in two synthetic communities:
   *   A — as a member, beside a placeholder founding Champion; name private, activity visible;
   *   B — as its founding Champion; name visible, activity private.
   * Each community has one active goal inside its window.
   */
  async function memberInTwoCommunities(label) {
    const t = now();
    const user = await createVerifiedUser(label);
    const tag = `${runTag}-${label}`;
    const championPlaceholder = `e5cchamp-${tag}`;
    const a = { id: `e5cgrp-${tag}-a`, name: 'Harbor Journey Crew', goalId: `e5cgoal-${tag}-a`, goalTitle: 'Harbor journey squats', roleText: 'Member', members: 2, nameVisible: false, activityVisible: true };
    const b = { id: `e5cgrp-${tag}-b`, name: 'Summit Journey Club', goalId: `e5cgoal-${tag}-b`, goalTitle: 'Summit journey steps', roleText: 'Champion', members: 1, nameVisible: true, activityVisible: false };
    const group = (c, creator) => putDoc(`wsfCommunityGroups/${c.id}`, {
      displayName: c.name, groupType: 'custom', joinPolicy: 'private',
      joinCode: crypto.randomBytes(16).toString('base64url'), createdByUserId: creator,
      lifecycleStatus: 'active', isSample: false, createdAt: t, updatedAt: t,
    });
    const membership = (c, uid, role, name, activity) => putDoc(`wsfMemberships/${c.id}_${uid}`, {
      groupId: c.id, userId: uid, role, membershipStatus: 'active',
      communityNameVisibility: name, communityActivityVisibility: activity, createdAt: t, updatedAt: t,
    });
    const goal = async (c, owner, target, shared) => {
      await putDoc(`wsfGoals/${c.goalId}`, {
        ownerUid: owner, communityGroupId: c.id, title: c.goalTitle, target, unit: 'squats', status: 'active',
        startsAt: new Date(t.getTime() - 2 * DAY), endsAt: new Date(t.getTime() + 5 * DAY),
        timezone: 'America/New_York', aggregateDisplayAuthorized: true, createdAt: t, updatedAt: t,
      });
      await shards(c.goalId, shared);
    };

    await group(a, championPlaceholder);
    await membership(a, championPlaceholder, 'foundingChampion', 'visible', 'visible');
    await membership(a, user.uid, 'member', 'private', 'visible');
    await group(b, user.uid);
    await membership(b, user.uid, 'foundingChampion', 'visible', 'private');
    await putDoc(`wsfMemberProfiles/${user.uid}`, { displayName: 'Jordan Journey', createdAt: t, updatedAt: t });
    await goal(a, championPlaceholder, 500, 120);
    await goal(b, user.uid, 1000, 200);
    return {
      setupId: `${label}: one synthetic member in two synthetic communities (member of A, founding Champion of B)`,
      member: user, a, b,
    };
  }

  /** Sign in through the product's own /signin page; lands on a signed-in route or throws. */
  async function signIn(page, baseUrl, member) {
    await page.goto(`${baseUrl}/signin`);
    await page.getByTestId('wsf-signin-email').waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('wsf-signin-email').fill(member.email);
    await page.getByTestId('wsf-signin-password').fill(member.password);
    await page.getByTestId('wsf-signin-submit').click();
    await page.waitForURL((u) => !/^\/(signin|verify-email|profile-setup)\b/.test(new URL(u).pathname), { timeout: 60_000 });
  }

  return { memberInTwoCommunities, signIn, manifestPath: cleanupManifest, tracked: () => ({ users: cleanup.users.size, docs: cleanup.docs.size }) };
}
