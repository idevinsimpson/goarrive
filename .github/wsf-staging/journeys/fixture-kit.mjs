/**
 * Synthetic fixtures for the changed-journey drivers, on the same contract the
 * other hosted harnesses use (hosted-player-journey.mjs):
 *
 * - accounts are created through the admin Identity Toolkit path, preverified,
 *   with a run-specific synthetic email `wsf-<runTag>-…@example.com`;
 * - community, goal, shard and membership documents carry the run tag in
 *   their path; the one untagged shape, `wsfMemberProfiles/<uid>`, is linked
 *   through a run-tagged membership of the same uid;
 * - every DOCUMENT is written to the cleanup manifest BEFORE the request that
 *   creates it. An ACCOUNT cannot be: its uid exists only once signUp returns
 *   it. It is tracked immediately after a successful create and before any
 *   document that depends on it. A crash inside that one window leaves an
 *   account the manifest does not name; its run-specific synthetic email
 *   (`wsf-<runTag>-…@example.com`) is how it is found and removed by hand;
 * - nothing here deletes anything. The workflow's cleanup step, running
 *   cleanup-synthetic.mjs over this run's own manifest, is the only deleter.
 * - documents the PRODUCT writes during a journey (a place in the line, a
 *   station, a contribution) are tracked as soon as their name is known, and
 *   before the next step that depends on them: a run-tagged path directly
 *   (`wsfTurnLines/goal__<tagged goal>`, `wsfContributions/<tagged goal>_…`),
 *   and a server-minted id as a LINKED document whose stored record names this
 *   run's tagged goal, which the cleaner reads back before it deletes. The
 *   one read of a turn entry and of a station here is that provenance, the
 *   same read hosted-player-journey.mjs makes; it never feeds an assertion.
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
export function createFixtureKit({
  projectId, apiKey, token, runTag, cleanupManifest, fetchImpl = fetch, now = () => new Date(),
  functionsBase = `https://us-central1-${projectId}.cloudfunctions.net`,
}) {
  const cleanup = { users: new Set(), docs: new Set(), linked: new Map() };
  function persist() {
    fs.mkdirSync(path.dirname(cleanupManifest), { recursive: true, mode: 0o700 });
    fs.writeFileSync(cleanupManifest, `${JSON.stringify({
      project: projectId, runTag, users: [...cleanup.users], docs: [...cleanup.docs],
      linkedDocs: [...cleanup.linked].map(([docPath, via]) => ({ path: docPath, via })),
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
  async function createVerifiedUser(label, displayName = `WSF ${label}`) {
    const email = `wsf-${runTag}-${label}-${crypto.randomBytes(2).toString('hex')}@example.com`;
    const password = `Wsf!${crypto.randomBytes(18).toString('base64url')}`;
    const body = await request(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST', admin: true,
      body: { targetProjectId: projectId, email, password, displayName, emailVerified: true, disabled: false, returnSecureToken: false },
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

  // ---- the expo attendee journeys ---------------------------------------------------
  const trackDoc = (docPath) => { cleanup.docs.add(docPath); persist(); };
  const trackLinked = (docPath, via) => { cleanup.linked.set(docPath, via); persist(); };
  const getDoc = (docPath) => request(docUrl(docPath), { admin: true });

  /** A field-masked update of a document THIS run created: the rest of it is left exactly as it is. */
  async function patchDoc(docPath, record) {
    if (!cleanup.docs.has(docPath)) throw new Error(`refusing to patch ${docPath}: this run did not create it`);
    const mask = Object.keys(record).map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
    await request(`${docUrl(docPath)}?${mask}`, { method: 'PATCH', admin: true, body: { fields: fields(record) } });
  }

  /** An end-user ID token, from the product's own password sign-in. Never logged, never written. */
  async function idToken(account) {
    const body = await request(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST', body: { email: account.email, password: account.password, returnSecureToken: true },
    });
    if (typeof body?.idToken !== 'string' || !body.idToken) throw new Error('the synthetic sign-in returned no idToken');
    return body.idToken;
  }
  /** A callable invoked the way the client SDK invokes it; an application refusal names its status only. */
  async function call(name, data, account) {
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${await idToken(account)}` };
    const response = await fetchImpl(`${functionsBase}/${name}`, { method: 'POST', headers, body: JSON.stringify({ data }) });
    let parsed = null;
    try { parsed = JSON.parse(await response.text()); } catch { parsed = null; }
    if (!response.ok || parsed?.error) throw new Error(`${name} refused: ${parsed?.error?.status || `HTTP_${response.status}`}`);
    return parsed?.result ?? parsed?.data ?? null;
  }

  /**
   * One event: a founding Champion, `attendees` members, one community, one open
   * single-activity goal (squats) with display authorized, and its SEEDED total.
   * The seeded total is a fixture number, never anybody's effort.
   */
  async function expoEvent(label, { attendees, target, seeded }) {
    const t = now();
    const tag = `${runTag}-${label}`;
    const champion = await createVerifiedUser(`${label}-champ`, 'Fixture Champion');
    const people = [];
    for (let i = 0; i < attendees; i += 1) people.push(await createVerifiedUser(`${label}-a${i}`, `Fixture Attendee ${i + 1}`));
    const groupId = `e5cgrp-${tag}`;
    const goalId = `e5cgoal-${tag}`;
    await putDoc(`wsfCommunityGroups/${groupId}`, {
      displayName: 'Fixture Expo Community', groupType: 'custom', joinPolicy: 'private',
      joinCode: crypto.randomBytes(16).toString('base64url'), createdByUserId: champion.uid,
      lifecycleStatus: 'active', isSample: false, createdAt: t, updatedAt: t,
    });
    for (const [who, role] of [[champion, 'foundingChampion'], ...people.map((p) => [p, 'member'])]) {
      await putDoc(`wsfMemberships/${groupId}_${who.uid}`, {
        groupId, userId: who.uid, role, membershipStatus: 'active',
        communityNameVisibility: 'private', communityActivityVisibility: 'private', createdAt: t, updatedAt: t,
      });
      await putDoc(`wsfMemberProfiles/${who.uid}`, { displayName: who === champion ? 'Fixture Champion' : `Fixture Attendee ${people.indexOf(who) + 1}`, createdAt: t, updatedAt: t });
    }
    await putDoc(`wsfGoals/${goalId}`, {
      ownerUid: champion.uid, communityGroupId: groupId, title: 'Fixture Expo Squats', target, unit: 'squats', status: 'active',
      startsAt: new Date(t.getTime() - DAY), endsAt: new Date(t.getTime() + 7 * DAY), timezone: 'America/New_York',
      repeatPolicy: 'multiple', aggregateDisplayAuthorized: true, crossingTracked: true, createdAt: t, updatedAt: t,
    });
    await shards(goalId, seeded);
    // The event's line is named by its goal, so its rows carry this run's tag.
    trackDoc(`wsfTurnLines/goal__${goalId}`);
    return {
      setupId: `${label}: one synthetic community, one open squats goal (target ${target}, seeded ${seeded}), a Champion and ${attendees} attendee${attendees === 1 ? '' : 's'}`,
      groupId, goalId, target, seeded, champion, attendees: people,
    };
  }

  /**
   * The Champion approves the code a station screen is SHOWING, through the
   * product's callable. The screen then claims its own credential in-page.
   */
  async function approveStation(event, code, slot) {
    const approved = await call('wsfApproveStation', { goalId: event.goalId, code, slot }, event.champion);
    if (typeof approved?.stationId !== 'string' || approved.slot !== slot) throw new Error(`station ${slot} was not approved into slot ${slot}`);
    trackLinked(`wsfKioskStations/${approved.stationId}`, event.goalId);
    const station = await getDoc(`wsfKioskStations/${approved.stationId}`);
    const pairingId = station?.fields?.pairingId?.stringValue;
    if (typeof pairingId !== 'string' || !pairingId) throw new Error(`station ${slot} carries no pairing to clean up`);
    trackLinked(`wsfKioskPairings/${pairingId}`, event.goalId);
    return { stationId: approved.stationId, slot };
  }

  /** A member's place in this event's line: tracked once they hold one. Returns their entry id. */
  async function trackPlace(event, member) {
    const mine = await call('wsfMyTurn', { goalId: event.goalId }, member);
    const entryId = mine?.turn?.entryId;
    if (typeof entryId !== 'string' || !entryId) throw new Error('the server has no place in the line for this member');
    trackLinked(`wsfTurnEntries/${entryId}`, event.goalId);
    trackDoc(`wsfTurnMembers/goal__${event.goalId}__${member.uid}`);
    trackDoc(`wsfTurnReceipts/goal__${event.goalId}__${member.uid}`);
    return entryId;
  }

  /** What a contribution under `attemptId` writes: the ledger row, the member's total and the recent addition. */
  function trackContribution(event, member, attemptId) {
    if (typeof attemptId !== 'string' || !attemptId) throw new Error('no attempt id to track');
    trackDoc(`wsfContributions/${event.goalId}_${member.uid}_${attemptId}`);
    trackDoc(`wsfGoalMemberTotals/${event.goalId}_${member.uid}`);
    trackDoc(`wsfGoals/${event.goalId}/recentAdditions/${attemptId}`);
  }

  /** A started station turn's attempt: read from its own entry, for cleanup only. */
  async function trackStationTurn(event, member, entryId) {
    const entry = await getDoc(`wsfTurnEntries/${entryId}`);
    if (entry?.fields?.goalId?.stringValue !== event.goalId) throw new Error('the turn entry names a different goal than this run\'s');
    const attemptId = entry?.fields?.attemptId?.stringValue;
    if (!attemptId) throw new Error('the started turn carries no attempt yet');
    trackContribution(event, member, attemptId);
  }

  /** The goal closes, as a closure leaves it: status only, the rest untouched. */
  const closeGoal = (event) => patchDoc(`wsfGoals/${event.goalId}`, { status: 'closed', updatedAt: now() });

  return {
    memberInTwoCommunities, signIn, expoEvent, approveStation, trackPlace, trackContribution, trackStationTurn, closeGoal,
    manifestPath: cleanupManifest,
    tracked: () => ({ users: cleanup.users.size, docs: cleanup.docs.size, linked: cleanup.linked.size }),
  };
}
