import { randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { FIRESTORE_EMULATOR, PROJECT_ID, seedProfile, seedVerifiedUser, signInVia, stampId } from './helpers/mobile';

/**
 * W7 — INDEPENDENT VERIFICATION of W8's social-community implementation.
 *
 * Product under test: **`60604ca`** (PR #441), exercised as an unpushed local
 * merge onto the CURRENT app-shell head `d86620c` — so the merge, not the
 * branch, is what is tested — with W8's product blobs confirmed by hash first.
 *
 * MOST OF THIS FILE DOES NOT USE A BROWSER, ON PURPOSE. Every privacy property
 * the Director names is enforced in the callables, so the callables are where
 * it is proven: a real ID token from the auth emulator against the genuine
 * `wsfSetCommunityVisibility` / `wsfCommunityMembers` / `wsfCommunityActivity`
 * endpoints, with fixtures written directly to Firestore. A browser assertion
 * about a screen that happens not to draw a name would be much weaker evidence
 * than the payload simply not containing one.
 *
 * ON DISCRIMINATION: the usual W7 practice is to run the discriminating cases
 * against the base as well, so a pass cannot be vacuous. That is not
 * meaningful here and is stated rather than quietly skipped — these three
 * callables and both settings routes DO NOT EXIST on `d86620c`, so every case
 * below fails on the base for the trivial reason that there is nothing to
 * call. What is NOT trivial, and is therefore asserted explicitly wherever it
 * arises, is the difference between "this member is hidden" and "this member
 * is gone": every omission below is checked together with the aggregate that
 * must still include them.
 *
 * Held: no product edit, no frame captured or rebaselined, no pixel verdict,
 * no rules / index / backend deployment, nothing of W5's kiosk lane touched.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FUNCTIONS_EMULATOR = 'http://127.0.0.1:5001';
const OWNER = { authorization: 'Bearer owner', 'content-type': 'application/json' };

const NAME_VIS = 'communityNameVisibility';
const ACTIVITY_VIS = 'communityActivityVisibility';

type CallResult = { ok: boolean; status: number; result?: any; code?: string };

/** A real ID token from the auth emulator — the genuine caller identity. */
async function idTokenFor(email: string, password: string): Promise<string> {
  const res = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { idToken: string }).idToken;
}

/** The genuine callable path, with or without a caller. */
async function call(name: string, data: unknown, idToken?: string): Promise<CallResult> {
  const res = await fetch(`${FUNCTIONS_EMULATOR}/${PROJECT_ID}/us-central1/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(idToken ? { authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ data }),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    return { ok: false, status: res.status, code: body?.error?.status, result: body?.error };
  }
  return { ok: true, status: res.status, result: body?.result };
}

async function write(docPath: string, fields: Record<string, unknown>, mask?: string[]): Promise<void> {
  const q = mask?.length
    ? '?' + mask.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&')
    : '';
  const res = await fetch(
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}${q}`,
    { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields }) },
  );
  if (!res.ok) throw new Error(`write ${docPath} failed: ${res.status} ${await res.text()}`);
}

const ts = (d: Date) => ({ timestampValue: d.toISOString() });

type Person = { uid: string; email: string; password: string; name: string; token: string };

async function person(tag: string, name: string): Promise<Person> {
  const email = `wsf-w7sp-${tag}-${stampId()}@example.com`;
  const password = `Aa1!${randomBytes(6).toString('hex')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, name);
  const token = await idTokenFor(email, password);
  return { uid, email, password, name, token };
}

async function membership(
  groupId: string,
  uid: string,
  role: 'foundingChampion' | 'member',
  vis?: { name?: string; activity?: string },
): Promise<void> {
  const now = new Date();
  const fields: Record<string, unknown> = {
    groupId: { stringValue: groupId },
    userId: { stringValue: uid },
    role: { stringValue: role },
    membershipStatus: { stringValue: 'active' },
    createdAt: ts(now),
    updatedAt: ts(now),
  };
  if (vis?.name) fields[NAME_VIS] = { stringValue: vis.name };
  if (vis?.activity) fields[ACTIVITY_VIS] = { stringValue: vis.activity };
  await write(`wsfMemberships/${groupId}_${uid}`, fields);
}

async function communityDoc(groupId: string, displayName: string, createdBy: string): Promise<void> {
  const now = new Date();
  await write(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: displayName },
    groupType: { stringValue: 'custom' },
    joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: `JOIN${randomBytes(4).toString('hex')}` },
    createdByUserId: { stringValue: createdBy },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
    createdAt: ts(now),
    updatedAt: ts(now),
  });
}

async function goalDoc(opts: {
  goalId: string;
  groupId: string;
  ownerUid: string;
  timezone: string;
  startsAt: Date;
  endsAt: Date;
}): Promise<void> {
  const now = new Date();
  await write(`wsfGoals/${opts.goalId}`, {
    ownerUid: { stringValue: opts.ownerUid },
    communityGroupId: { stringValue: opts.groupId },
    title: { stringValue: 'W7 social goal' },
    target: { integerValue: '500' },
    unit: { stringValue: 'squats' },
    status: { stringValue: 'active' },
    startsAt: ts(opts.startsAt),
    endsAt: ts(opts.endsAt),
    timezone: { stringValue: opts.timezone },
    createdAt: ts(now),
    updatedAt: ts(now),
  });
}

async function contribution(opts: {
  groupId: string;
  goalId: string;
  userId: string;
  count: number;
  at: Date;
}): Promise<void> {
  await write(`wsfContributions/w7c-${stampId()}`, {
    communityGroupId: { stringValue: opts.groupId },
    goalId: { stringValue: opts.goalId },
    userId: { stringValue: opts.userId },
    count: { integerValue: String(opts.count) },
    unit: { stringValue: 'squats' },
    createdAt: ts(opts.at),
  });
}

/** Start of "today" in a zone, in UTC ms — the same rule the callable applies. */
function zonedDayStartMs(utcMs: number, timeZone: string): number {
  const offset = (ms: number) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(ms));
    const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second')) - ms;
  };
  const off1 = offset(utcMs);
  const wall = new Date(utcMs + off1);
  const midnightWall = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate());
  const candidate = midnightWall - off1;
  const off2 = offset(candidate);
  return off2 === off1 ? candidate : midnightWall - off2;
}

// ═══════════════════════════════════════════════════════════════════════════
// A — the privacy matrix, at the genuine callable boundary
// ═══════════════════════════════════════════════════════════════════════════

test.describe('W8 social privacy, at the callable', () => {
  /**
   * A membership row with NO preference is visible. The default has to be the
   * one that is stated rather than inferred, because an absent field is
   * exactly what every pre-existing membership in the product has.
   */
  test('community-visible default: a row with no preference is listed and named', async () => {
    test.setTimeout(120_000);
    const champ = await person('champ', 'Ada Champion');
    const plain = await person('plain', 'Ben Nopreference');
    const groupId = `w7sp-${stampId()}`;
    await communityDoc(groupId, 'W7 presence community', champ.uid);
    await membership(groupId, champ.uid, 'foundingChampion');
    await membership(groupId, plain.uid, 'member'); // no visibility fields at all

    const res = await call('wsfCommunityMembers', { groupId }, champ.token);
    expect(res.ok, `members call failed: ${JSON.stringify(res.result)}`).toBe(true);
    const names = (res.result.members as { displayName: string }[]).map((m) => m.displayName);
    expect(names, 'a member with no stored preference was hidden').toContain('Ben Nopreference');
    expect(names).toContain('Ada Champion');

    // The structural protection: no uid anywhere in the payload.
    expect(JSON.stringify(res.result), 'the members payload carries a uid').not.toContain(plain.uid);
    expect(JSON.stringify(res.result)).not.toContain(champ.uid);
  });

  /**
   * NAME PRIVATE — omitted from the directory, STILL INSIDE THE COUNT.
   *
   * The omission and the aggregate are asserted together on purpose: a
   * directory that drops the person AND a count that drops them would look
   * identical to a correct implementation from the directory alone, and would
   * be the product quietly under-reporting its own community.
   */
  test('name-private: absent from the directory, still inside the member count', async () => {
    test.setTimeout(120_000);
    const champ = await person('champ', 'Ada Champion');
    const shy = await person('shy', 'Cleo Private');
    const groupId = `w7sp-${stampId()}`;
    await communityDoc(groupId, 'W7 presence community', champ.uid);
    await membership(groupId, champ.uid, 'foundingChampion');
    await membership(groupId, shy.uid, 'member');

    // The member sets it themselves, through the genuine callable.
    const set = await call('wsfSetCommunityVisibility', { groupId, name: 'private' }, shy.token);
    expect(set.ok, `set failed: ${JSON.stringify(set.result)}`).toBe(true);
    expect(set.result.name).toBe('private');

    const members = await call('wsfCommunityMembers', { groupId }, champ.token);
    expect(members.ok).toBe(true);
    const names = (members.result.members as { displayName: string }[]).map((m) => m.displayName);
    expect(names, 'a name-private member was still named').not.toContain('Cleo Private');
    expect(names, 'the visible member disappeared too').toContain('Ada Champion');
    expect(JSON.stringify(members.result)).not.toContain(shy.uid);

    // ...and the community still says how many people are in it.
    const mine = await call('wsfMyCommunities', {}, champ.token);
    expect(mine.ok).toBe(true);
    const item = (mine.result.items as { groupId: string; memberCount: number }[]).find(
      (c) => c.groupId === groupId,
    );
    expect(item, 'the community vanished from the caller’s list').toBeTruthy();
    expect(item!.memberCount, 'a private member was dropped from the member count').toBe(2);
  });

  /**
   * ACTIVITY PRIVATE — no row in the feed, STILL INSIDE `contributorsToday`.
   * Same reasoning as above: hidden is not gone.
   */
  test('activity-private: no feed row, still counted in contributorsToday', async () => {
    test.setTimeout(120_000);
    const champ = await person('champ', 'Ada Champion');
    const quiet = await person('quiet', 'Dev Quiet');
    const groupId = `w7sp-${stampId()}`;
    const goalId = `w7g-${stampId()}`;
    await communityDoc(groupId, 'W7 presence community', champ.uid);
    await membership(groupId, champ.uid, 'foundingChampion');
    await membership(groupId, quiet.uid, 'member');
    const now = Date.now();
    await goalDoc({
      goalId,
      groupId,
      ownerUid: champ.uid,
      timezone: 'America/New_York',
      startsAt: new Date(now - 10 * 24 * 3_600_000),
      endsAt: new Date(now + 10 * 24 * 3_600_000),
    });
    const dayStart = zonedDayStartMs(now, 'America/New_York');
    const inToday = new Date(Math.max(dayStart, now - 3_600_000) + 60_000);
    await contribution({ groupId, goalId, userId: champ.uid, count: 10, at: inToday });
    await contribution({ groupId, goalId, userId: quiet.uid, count: 20, at: inToday });

    const before = await call('wsfCommunityActivity', { groupId, goalId }, champ.token);
    expect(before.ok, `activity failed: ${JSON.stringify(before.result)}`).toBe(true);
    expect(before.result.contributorsToday, 'both movers should be counted to begin with').toBe(2);
    expect((before.result.entries as { displayName: string | null }[]).map((e) => e.displayName))
      .toContain('Dev Quiet');

    const set = await call('wsfSetCommunityVisibility', { groupId, activity: 'private' }, quiet.token);
    expect(set.ok).toBe(true);

    const after = await call('wsfCommunityActivity', { groupId, goalId }, champ.token);
    expect(after.ok).toBe(true);
    const names = (after.result.entries as { displayName: string | null }[]).map((e) => e.displayName);
    expect(names, 'an activity-private member still has a feed row').not.toContain('Dev Quiet');
    expect(names, 'the visible mover lost their row too').toContain('Ada Champion');
    expect(
      after.result.contributorsToday,
      'the aggregate dropped a private member instead of only hiding them',
    ).toBe(2);
    expect(JSON.stringify(after.result)).not.toContain(quiet.uid);
  });

  /**
   * NAME PRIVATE + ACTIVITY VISIBLE — the row stays and is ANONYMOUS.
   * `displayName: null` is a state the feed renders, not a row to drop.
   */
  test('name-private with activity visible: an anonymous row, not a missing one', async () => {
    test.setTimeout(120_000);
    const champ = await person('champ', 'Ada Champion');
    const masked = await person('masked', 'Eve Masked');
    const groupId = `w7sp-${stampId()}`;
    const goalId = `w7g-${stampId()}`;
    await communityDoc(groupId, 'W7 presence community', champ.uid);
    await membership(groupId, champ.uid, 'foundingChampion');
    await membership(groupId, masked.uid, 'member', { name: 'private', activity: 'visible' });
    const now = Date.now();
    await goalDoc({
      goalId,
      groupId,
      ownerUid: champ.uid,
      timezone: 'America/New_York',
      startsAt: new Date(now - 10 * 24 * 3_600_000),
      endsAt: new Date(now + 10 * 24 * 3_600_000),
    });
    await contribution({
      groupId,
      goalId,
      userId: masked.uid,
      count: 15,
      at: new Date(now - 60_000),
    });

    const res = await call('wsfCommunityActivity', { groupId, goalId }, champ.token);
    expect(res.ok).toBe(true);
    const entries = res.result.entries as { displayName: string | null; amount: number }[];
    const row = entries.find((e) => e.amount === 15);
    expect(row, 'the anonymous contribution lost its row entirely').toBeTruthy();
    expect(row!.displayName, 'a name-private member was named in the feed').toBeNull();
    expect(JSON.stringify(res.result)).not.toContain('Eve Masked');
    expect(JSON.stringify(res.result)).not.toContain(masked.uid);
  });

  /**
   * THE PREFERENCE IS READ AT READ TIME, so it reaches BACKWARDS. A member who
   * contributed while visible and then opts out must disappear from the
   * activity that already exists — otherwise opting out protects only the
   * future and the member was never told that.
   */
  test('the current preference is retroactive over old activity', async () => {
    test.setTimeout(120_000);
    const champ = await person('champ', 'Ada Champion');
    const regret = await person('regret', 'Finn Regret');
    const groupId = `w7sp-${stampId()}`;
    const goalId = `w7g-${stampId()}`;
    await communityDoc(groupId, 'W7 presence community', champ.uid);
    await membership(groupId, champ.uid, 'foundingChampion');
    await membership(groupId, regret.uid, 'member');
    const now = Date.now();
    await goalDoc({
      goalId,
      groupId,
      ownerUid: champ.uid,
      timezone: 'America/New_York',
      startsAt: new Date(now - 10 * 24 * 3_600_000),
      endsAt: new Date(now + 10 * 24 * 3_600_000),
    });
    // Activity from BEFORE the preference existed.
    await contribution({
      groupId,
      goalId,
      userId: regret.uid,
      count: 33,
      at: new Date(now - 2 * 3_600_000),
    });

    const named = await call('wsfCommunityActivity', { groupId, goalId }, champ.token);
    expect((named.result.entries as { displayName: string | null }[]).map((e) => e.displayName))
      .toContain('Finn Regret');

    await call('wsfSetCommunityVisibility', { groupId, name: 'private' }, regret.token);

    const after = await call('wsfCommunityActivity', { groupId, goalId }, champ.token);
    const rows = after.result.entries as { displayName: string | null; amount: number }[];
    expect(JSON.stringify(after.result), 'old activity still carries the name').not.toContain(
      'Finn Regret',
    );
    // The effort is still there; only the identity is gone.
    expect(rows.find((r) => r.amount === 33), 'the old contribution was erased, not anonymised')
      .toBeTruthy();
    expect(rows.find((r) => r.amount === 33)!.displayName).toBeNull();
  });

  /**
   * SAME-COMMUNITY AUTH, and one refusal for every negative case so the pair
   * cannot be used to enumerate which community ids are real.
   */
  test('only an active member of this community can read it', async () => {
    test.setTimeout(150_000);
    const champ = await person('champ', 'Ada Champion');
    const outsider = await person('out', 'Gus Outsider');
    const removed = await person('gone', 'Hal Removed');
    const groupId = `w7sp-${stampId()}`;
    await communityDoc(groupId, 'W7 presence community', champ.uid);
    await membership(groupId, champ.uid, 'foundingChampion');
    await membership(groupId, removed.uid, 'member');
    await write(
      `wsfMemberships/${groupId}_${removed.uid}`,
      { membershipStatus: { stringValue: 'removed' } },
      ['membershipStatus'],
    );

    for (const name of ['wsfCommunityMembers', 'wsfCommunityActivity']) {
      const anon = await call(name, { groupId });
      expect(anon.ok, `${name} answered a signed-out caller`).toBe(false);
      expect(anon.code, `${name} did not refuse a signed-out caller as unauthenticated`).toBe(
        'UNAUTHENTICATED',
      );

      const nonMember = await call(name, { groupId }, outsider.token);
      expect(nonMember.ok, `${name} answered a non-member`).toBe(false);
      expect(nonMember.code).toBe('PERMISSION_DENIED');

      const exMember = await call(name, { groupId }, removed.token);
      expect(exMember.ok, `${name} answered a removed member`).toBe(false);
      expect(exMember.code).toBe('PERMISSION_DENIED');

      // A community that does not exist refuses IDENTICALLY, so the pair of
      // answers cannot tell an attacker which ids are real.
      const nowhere = await call(name, { groupId: `w7sp-nope-${stampId()}` }, outsider.token);
      expect(nowhere.ok).toBe(false);
      expect(nowhere.code, `${name} distinguishes a missing community from a forbidden one`).toBe(
        nonMember.code,
      );
      expect(nowhere.result?.message).toBe(nonMember.result?.message);
    }

    // The member call is still fine for the actual member.
    expect((await call('wsfCommunityMembers', { groupId }, champ.token)).ok).toBe(true);
  });

  /**
   * AN EXPLICIT CHOICE SURVIVES LEAVING AND COMING BACK, AND NO CHAMPION CAN
   * OVERRIDE IT.
   *
   * The override case is the one worth being literal about: the callable takes
   * no `targetUid`, so the test sends one anyway. If a Champion's request with
   * somebody else's uid in it changed that person's row, the absence of the
   * parameter would not be the enforcement it is documented to be.
   */
  test('an explicit choice survives reinstatement, and a Champion cannot override it', async () => {
    test.setTimeout(150_000);
    const champ = await person('champ', 'Ada Champion');
    const shy = await person('shy', 'Iris Private');
    const groupId = `w7sp-${stampId()}`;
    await communityDoc(groupId, 'W7 presence community', champ.uid);
    await membership(groupId, champ.uid, 'foundingChampion');
    await membership(groupId, shy.uid, 'member');

    await call('wsfSetCommunityVisibility', { groupId, name: 'private' }, shy.token);

    // The Champion removes and reinstates them through the real callables.
    const removed = await call('wsfRemoveMember', { groupId, targetUid: shy.uid }, champ.token);
    expect(removed.ok, `remove failed: ${JSON.stringify(removed.result)}`).toBe(true);
    const reinstated = await call('wsfReinstateMember', { groupId, targetUid: shy.uid }, champ.token);
    expect(reinstated.ok, `reinstate failed: ${JSON.stringify(reinstated.result)}`).toBe(true);

    const afterReinstate = await call('wsfCommunityMembers', { groupId }, champ.token);
    expect(
      (afterReinstate.result.members as { displayName: string }[]).map((m) => m.displayName),
      'reinstatement republished a member who had chosen to be private',
    ).not.toContain('Iris Private');

    // THE OVERRIDE ATTEMPT: a Champion naming somebody else.
    const override = await call(
      'wsfSetCommunityVisibility',
      { groupId, targetUid: shy.uid, name: 'visible' },
      champ.token,
    );
    // Whatever it answers, it must not have changed the other member's row.
    const afterOverride = await call('wsfCommunityMembers', { groupId }, champ.token);
    expect(
      (afterOverride.result.members as { displayName: string }[]).map((m) => m.displayName),
      'a Champion changed another member’s visibility',
    ).not.toContain('Iris Private');
    // If it succeeded at all, it can only have acted on the caller.
    if (override.ok) expect(override.result.name).toBe('visible');
    const mineAsShy = await call('wsfCommunityMembers', { groupId }, shy.token);
    expect(mineAsShy.ok, 'the private member lost their own read access').toBe(true);
  });

  /**
   * `contributorsToday` IS THE GOAL'S DAY, NOT THE HOST'S.
   *
   * The fixture is chosen so the two rules give DIFFERENT answers: a zone far
   * enough east that its day began before UTC midnight, and a contribution
   * placed in the window between the two day starts. Counted under the goal's
   * zone; not counted under UTC. A test in a zone where they agree would pass
   * on a UTC implementation too.
   */
  test('contributorsToday uses the goal’s stored zone, not UTC or host time', async () => {
    test.setTimeout(150_000);
    const champ = await person('champ', 'Ada Champion');
    const groupId = `w7sp-${stampId()}`;
    const goalId = `w7g-${stampId()}`;
    const zone = 'Pacific/Kiritimati'; // UTC+14: its day starts before UTC's.
    const now = Date.now();
    const zoneStart = zonedDayStartMs(now, zone);
    const utcStart = Date.UTC(
      new Date(now).getUTCFullYear(),
      new Date(now).getUTCMonth(),
      new Date(now).getUTCDate(),
    );
    // The window where the two rules disagree must be real, or this proves nothing.
    expect(zoneStart, 'the chosen zone does not actually disagree with UTC').toBeLessThan(utcStart);

    await communityDoc(groupId, 'W7 zone community', champ.uid);
    await membership(groupId, champ.uid, 'foundingChampion');
    await goalDoc({
      goalId,
      groupId,
      ownerUid: champ.uid,
      timezone: zone,
      startsAt: new Date(zoneStart - 7 * 24 * 3_600_000),
      endsAt: new Date(now + 7 * 24 * 3_600_000),
    });
    // Strictly inside the disagreement window: today in Kiritimati, yesterday in UTC.
    const between = new Date(Math.floor((zoneStart + utcStart) / 2));
    expect(between.getTime()).toBeGreaterThan(zoneStart);
    expect(between.getTime()).toBeLessThan(utcStart);
    await contribution({ groupId, goalId, userId: champ.uid, count: 5, at: between });

    const res = await call('wsfCommunityActivity', { groupId, goalId }, champ.token);
    expect(res.ok, `activity failed: ${JSON.stringify(res.result)}`).toBe(true);
    expect(
      res.result.contributorsToday,
      'the contribution was not counted in the goal’s own day — a UTC or host day was used',
    ).toBe(1);
  });

  /**
   * AND WHERE THE DAY CANNOT BE ESTABLISHED, IT IS `null` — never a guess,
   * never a row count standing in for a person count.
   */
  test('an unreadable goal zone yields null rather than an invented count', async () => {
    test.setTimeout(120_000);
    const champ = await person('champ', 'Ada Champion');
    const groupId = `w7sp-${stampId()}`;
    const goalId = `w7g-${stampId()}`;
    const now = Date.now();
    await communityDoc(groupId, 'W7 zone community', champ.uid);
    await membership(groupId, champ.uid, 'foundingChampion');
    await goalDoc({
      goalId,
      groupId,
      ownerUid: champ.uid,
      timezone: 'Not/ARealZone',
      startsAt: new Date(now - 7 * 24 * 3_600_000),
      endsAt: new Date(now + 7 * 24 * 3_600_000),
    });
    await contribution({ groupId, goalId, userId: champ.uid, count: 9, at: new Date(now - 60_000) });

    const res = await call('wsfCommunityActivity', { groupId, goalId }, champ.token);
    expect(res.ok).toBe(true);
    expect(
      res.result.contributorsToday,
      'a count was invented for a goal whose day cannot be established',
    ).toBeNull();
    // The activity itself is still readable; only the aggregate is withheld.
    expect((res.result.entries as unknown[]).length).toBeGreaterThan(0);
  });

  /**
   * THE PUBLIC PAYLOADS CARRY NO IDENTITY — checked with the members
   * deliberately VISIBLE, so a pass cannot come from there being no name to
   * leak. And no rank, streak or position anywhere in the social payloads.
   */
  test('public reads stay identity-free, and nothing invents a rank or streak', async () => {
    test.setTimeout(150_000);
    const champ = await person('champ', 'Ada Champion');
    const mover = await person('mover', 'Jo Visible');
    const groupId = `w7sp-${stampId()}`;
    const goalId = `w7g-${stampId()}`;
    const now = Date.now();
    await communityDoc(groupId, 'W7 presence community', champ.uid);
    await membership(groupId, champ.uid, 'foundingChampion');
    await membership(groupId, mover.uid, 'member', { name: 'visible', activity: 'visible' });
    await goalDoc({
      goalId,
      groupId,
      ownerUid: champ.uid,
      timezone: 'America/New_York',
      startsAt: new Date(now - 7 * 24 * 3_600_000),
      endsAt: new Date(now + 7 * 24 * 3_600_000),
    });
    await write(`wsfGoals/${goalId}`, { aggregateDisplayAuthorized: { booleanValue: true } }, [
      'aggregateDisplayAuthorized',
    ]);
    await contribution({ groupId, goalId, userId: mover.uid, count: 21, at: new Date(now - 60_000) });

    // The public display path, with no caller at all.
    for (const name of ['wsfGoalRecentAdditions', 'wsfGoalPulse']) {
      const res = await call(name, { goalId });
      expect(res.ok, `${name} refused the public display path`).toBe(true);
      const body = JSON.stringify(res.result);
      expect(body, `${name} leaked a display name`).not.toContain('Jo Visible');
      expect(body, `${name} leaked a uid`).not.toContain(mover.uid);
      expect(body).not.toContain(champ.uid);
      expect(body, `${name} carries a rank`).not.toMatch(/"rank"|"streak"|"position"|"place"/i);
    }

    // And the member-only payloads invent nothing either.
    const activity = await call('wsfCommunityActivity', { groupId, goalId }, champ.token);
    expect(JSON.stringify(activity.result)).not.toMatch(/"rank"|"streak"|"position"|"place"/i);
    const members = await call('wsfCommunityMembers', { groupId }, champ.token);
    expect(JSON.stringify(members.result)).not.toMatch(/"rank"|"streak"|"position"|"place"/i);
  });

  /**
   * TOGGLING VISIBILITY MOVES NO NUMBER. The shared total is the product's
   * one arithmetic claim and a privacy setting must not touch it.
   */
  test('changing visibility does not move the shared total', async () => {
    test.setTimeout(150_000);
    const champ = await person('champ', 'Ada Champion');
    const mover = await person('mover', 'Kit Mover');
    const groupId = `w7sp-${stampId()}`;
    const goalId = `w7g-${stampId()}`;
    const now = Date.now();
    await communityDoc(groupId, 'W7 presence community', champ.uid);
    await membership(groupId, champ.uid, 'foundingChampion');
    await membership(groupId, mover.uid, 'member');
    await goalDoc({
      goalId,
      groupId,
      ownerUid: champ.uid,
      timezone: 'America/New_York',
      startsAt: new Date(now - 7 * 24 * 3_600_000),
      endsAt: new Date(now + 7 * 24 * 3_600_000),
    });
    await write(`wsfGoals/${goalId}`, { aggregateDisplayAuthorized: { booleanValue: true } }, [
      'aggregateDisplayAuthorized',
    ]);
    await write(`wsfGoalCounters/${goalId}/shards/0`, { count: { integerValue: '77' } });

    const before = await call('wsfGoalPulse', { goalId });
    expect(before.ok).toBe(true);
    const total = before.result.sharedTotal;
    expect(total).toBe(77);

    for (const v of ['private', 'visible'] as const) {
      await call('wsfSetCommunityVisibility', { groupId, name: v, activity: v }, mover.token);
      const after = await call('wsfGoalPulse', { goalId });
      expect(after.result.sharedTotal, `the shared total moved when visibility became ${v}`).toBe(
        total,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B — the two implementation conditions, and one cross-lane dependency
// ═══════════════════════════════════════════════════════════════════════════

async function hittable(page: Page, testId: string, what: string): Promise<void> {
  const el = page.getByTestId(testId);
  await expect(el, `${what} is not visible`).toBeVisible({ timeout: 20_000 });
  const covered = await el.evaluate((node) => {
    const r = (node as HTMLElement).getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return 'zero-sized';
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit) return 'nothing at its centre';
    if (hit === node || node.contains(hit) || hit.contains(node)) return null;
    return `covered by <${hit.tagName.toLowerCase()}>`;
  });
  expect(covered, `${what} cannot be pressed: ${covered}`).toBeNull();
}

test.describe('W8 social implementation conditions, in a browser', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /**
   * SETTINGS IS AN ORDINARY ROW IN `You`'s CONTENT — not a gear, not a header
   * treatment, and not a dead utility. So: it is in the content, it can be
   * pressed, and both destinations are real screens rather than stubs.
   */
  test('Settings is a working row inside You content, with no gear or header treatment', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const champ = await person('champ', 'Ada Champion');
    const groupId = `w7sp-${stampId()}`;
    await communityDoc(groupId, 'W7 presence community', champ.uid);
    await membership(groupId, champ.uid, 'foundingChampion');
    await signInVia(page, champ.email, champ.password);

    await page.goto('/you');
    await expect(page.getByTestId('wsf-you')).toBeVisible({ timeout: 25_000 });

    // No gear anywhere, and no header-mounted utility.
    expect(await page.locator('[data-testid*="gear" i]').count(), 'a gear control is on You').toBe(0);

    const row = page.getByTestId('wsf-you-settings');
    await hittable(page, 'wsf-you-settings', 'the You settings row');
    // It sits in the page content, below the heading — not in the chrome.
    const rowBox = (await row.boundingBox())!;
    const heading = await page.getByTestId('wsf-you-name').boundingBox().catch(() => null);
    if (heading) {
      expect(rowBox.y, 'the settings row is mounted above the page heading, like chrome').toBeGreaterThan(
        heading.y,
      );
    }

    await row.click();
    await page.waitForURL(/\/settings$/, { timeout: 25_000 });
    await expect(page.getByTestId('wsf-settings-screen')).toBeVisible({ timeout: 25_000 });

    // ...and privacy is a real screen from there, not a dead row.
    await hittable(page, 'wsf-settings-privacy-row', 'the privacy row');
    await page.getByTestId('wsf-settings-privacy-row').click();
    await page.waitForURL(/\/settings\/privacy$/, { timeout: 25_000 });
    await expect(page.getByTestId('wsf-privacy-screen')).toBeVisible({ timeout: 25_000 });
  });

  /**
   * THE MEMBERS ROUTE ON A COLD LOAD.
   *
   * `firebase.westayfit.json` gained `/community/*​/members`; the emulator
   * config did not, and its own comment says the two must stay in sync or "the
   * harness stops testing what actually ships". This resolves the config
   * asymmetry into behaviour: what a cold navigation actually renders.
   */
  test('a cold load of the members route renders the members screen', async ({ page }) => {
    test.setTimeout(180_000);
    const champ = await person('champ', 'Ada Champion');
    const groupId = `w7sp-${stampId()}`;
    await communityDoc(groupId, 'W7 presence community', champ.uid);
    await membership(groupId, champ.uid, 'foundingChampion');
    await signInVia(page, champ.email, champ.password);

    await page.goto(`/community/${groupId}/members`);
    await expect(
      page.getByTestId('wsf-members-screen'),
      'a cold load of the members route did not render the members screen',
    ).toBeVisible({ timeout: 25_000 });
    expect(new URL(page.url()).pathname).toBe(`/community/${groupId}/members`);
  });

  /**
   * CROSS-LANE: W8 changed `app/community/[groupId]/index.tsx` by +213 lines,
   * and that page is the destination W6's goal-recovery action depends on
   * (#433's `Check community goals`, which W7 proved at `8067364`). #433 is
   * not in this merge, so the action itself cannot be exercised here — but the
   * dependency can: the community page must still offer a way to an existing
   * goal.
   */
  test('the community page still reaches an existing goal, which the recovery path depends on', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const champ = await person('champ', 'Ada Champion');
    const groupId = `w7sp-${stampId()}`;
    const goalId = `w7g-${stampId()}`;
    const now = Date.now();
    await communityDoc(groupId, 'W7 presence community', champ.uid);
    await membership(groupId, champ.uid, 'foundingChampion');
    await goalDoc({
      goalId,
      groupId,
      ownerUid: champ.uid,
      timezone: 'America/New_York',
      startsAt: new Date(now - 3 * 24 * 3_600_000),
      endsAt: new Date(now + 3 * 24 * 3_600_000),
    });
    await write(`wsfGoalCounters/${goalId}/shards/0`, { count: { integerValue: '12' } });
    await signInVia(page, champ.email, champ.password);

    await page.goto(`/community/${groupId}`);
    const link = page.locator(`[href*="${goalId}"]`).first();
    await expect(
      link,
      'the community page no longer reaches the goal — the recovery path #433 relies on is broken',
    ).toBeVisible({ timeout: 25_000 });
  });
});
