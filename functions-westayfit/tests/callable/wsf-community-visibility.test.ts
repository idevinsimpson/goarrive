/**
 * THE FIRST MECHANISM THAT RETURNS ONE MEMBER'S NAME TO ANOTHER MEMBER.
 *
 * Every other callable in this product is safe from identity disclosure by
 * construction: none of them reads `wsfMemberProfiles` for anybody but the
 * caller. `wsfCommunityMembers` does, so the guarantee moves from "impossible"
 * to "enforced" — and this suite is the enforcement.
 *
 * It is written adversarially. Each test names the specific way the feature
 * would leak if the code were written the obvious way instead of the careful
 * way, because a test that only proves the happy path would pass against an
 * implementation that publishes everybody.
 *
 * THE FOUR THINGS THAT MUST NEVER HAPPEN:
 *
 *   1. A name reaches somebody who is not an active member of that community.
 *   2. A name reaches anybody without that person having chosen `visible` —
 *      including by legacy absence, by a near-miss value, or by a rejoin.
 *   3. A uid, a count, a timestamp, or a storage ordering rides out beside
 *      the names.
 *   4. One person's action changes another person's visibility.
 *
 * Runs against the Firestore emulator via `.run(request)`.
 */

process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  wsfCommunityMembers,
  wsfCreateCommunity,
  wsfJoinCommunity,
  wsfLeaveCommunity,
  wsfMyCommunities,
  wsfReinstateMember,
  wsfRemoveMember,
  wsfSetCommunityVisibility,
} from '../../src/index';

/* ── seeding ─────────────────────────────────────────────────────────────── */

let seq = 0;
/** Unique but stable-per-run ids; the suite never depends on uid ORDER. */
function uid(tag: string): string {
  seq += 1;
  return `wsfVis_${tag}_${seq}`;
}

async function seedGroup(displayName = 'Visibility Community'): Promise<string> {
  const ref = getFirestore().collection('wsfCommunityGroups').doc();
  await ref.set({
    displayName,
    groupType: 'custom',
    joinPolicy: 'private',
    lifecycleStatus: 'active',
    isSample: false,
  });
  return ref.id;
}

/**
 * Seed a membership. `visibility` is passed through EXACTLY as given —
 * including `undefined`, which omits the field the way every row written
 * before this feature omits it.
 */
async function seedMembership(opts: {
  groupId: string;
  userId: string;
  role?: string;
  membershipStatus?: string;
  visibility?: unknown;
  /** Override the document id, to seed a row this product would never write. */
  docId?: string;
}): Promise<void> {
  const row: Record<string, unknown> = {
    groupId: opts.groupId,
    userId: opts.userId,
    role: opts.role ?? 'member',
    membershipStatus: opts.membershipStatus ?? 'active',
  };
  if (opts.visibility !== undefined) row.visibility = opts.visibility;
  await getFirestore()
    .doc(`wsfMemberships/${opts.docId ?? `${opts.groupId}_${opts.userId}`}`)
    .set(row);
}

async function seedProfile(userId: string, displayName: string): Promise<void> {
  await getFirestore().doc(`wsfMemberProfiles/${userId}`).set({ displayName });
}

/* ── invocation ──────────────────────────────────────────────────────────── */

function req(callerUid: string | null, data: Record<string, unknown> = {}): any {
  return {
    auth: callerUid
      ? ({ uid: callerUid, token: { email_verified: true } as any } as any)
      : undefined,
    data: data as any,
    rawRequest: {} as any,
    acceptsStreaming: false,
  };
}

async function tryList(callerUid: string | null, data: Record<string, unknown> = {}) {
  try {
    return { ok: true as const, value: await wsfCommunityMembers.run(req(callerUid, data)) };
  } catch (e) {
    return { ok: false as const, error: e as HttpsError };
  }
}

async function trySet(callerUid: string | null, data: Record<string, unknown> = {}) {
  try {
    return {
      ok: true as const,
      value: await wsfSetCommunityVisibility.run(req(callerUid, data)),
    };
  } catch (e) {
    return { ok: false as const, error: e as HttpsError };
  }
}

/** The stored row, read straight from Firestore — never through a callable. */
async function storedVisibility(groupId: string, userId: string): Promise<unknown> {
  const snap = await getFirestore().doc(`wsfMemberships/${groupId}_${userId}`).get();
  return snap.exists ? (snap.data() as { visibility?: unknown }).visibility : '<<no row>>';
}

/* ── the gate ────────────────────────────────────────────────────────────── */

describe('wsfCommunityMembers — who may ask at all', () => {
  test('a signed-out caller is refused before anything is read', async () => {
    const groupId = await seedGroup();
    const r = await tryList(null, { groupId });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('unauthenticated');
  });

  test('a stranger to the community gets no names', async () => {
    const groupId = await seedGroup();
    const insider = uid('insider');
    const stranger = uid('stranger');
    await seedMembership({ groupId, userId: insider, visibility: 'visible' });
    await seedProfile(insider, 'Insider Name');
    await seedMembership({ groupId: await seedGroup(), userId: stranger });

    const r = await tryList(stranger, { groupId });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('permission-denied');
  });

  test('a removed member and a departed member are both refused', async () => {
    const groupId = await seedGroup();
    const named = uid('named');
    await seedMembership({ groupId, userId: named, visibility: 'visible' });
    await seedProfile(named, 'Named Person');

    for (const status of ['removed', 'departed', '', 'Active', 'pending']) {
      const ghost = uid(`status_${status || 'blank'}`);
      await seedMembership({ groupId, userId: ghost, membershipStatus: status });
      const r = await tryList(ghost, { groupId });
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.error.code).toBe('permission-denied');
    }
  });

  test('a membership row with no status at all is refused', async () => {
    const groupId = await seedGroup();
    const ghost = uid('nostatus');
    await getFirestore()
      .doc(`wsfMemberships/${groupId}_${ghost}`)
      .set({ groupId, userId: ghost, role: 'member' });
    const r = await tryList(ghost, { groupId });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('permission-denied');
  });

  test('a non-existent community and a community the caller is not in refuse BYTE-IDENTICALLY', async () => {
    /*
      If the two answers differed, the pair would be a membership oracle AND a
      community-existence oracle: a caller could walk ids and learn which are
      real. The message is compared as well as the code, because a helpful
      sentence is exactly how this distinction gets reintroduced.
    */
    const realGroupId = await seedGroup();
    const outsider = uid('outsider');
    await seedMembership({ groupId: await seedGroup(), userId: outsider });

    const notAMember = await tryList(outsider, { groupId: realGroupId });
    const noSuchGroup = await tryList(outsider, { groupId: 'wsfVis_no_such_group_at_all' });

    expect(notAMember.ok).toBe(false);
    expect(noSuchGroup.ok).toBe(false);
    if (notAMember.ok || noSuchGroup.ok) return;
    expect(notAMember.error.code).toBe(noSuchGroup.error.code);
    expect(notAMember.error.message).toBe(noSuchGroup.error.message);
    expect(notAMember.error.code).toBe('permission-denied');
  });

  test('a missing or blank groupId is invalid-argument, not a list', async () => {
    const caller = uid('blankarg');
    for (const bad of [undefined, '', '   ', null, 42, {}, ['x']]) {
      const r = await tryList(caller, bad === undefined ? {} : { groupId: bad });
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.error.code).toBe('invalid-argument');
    }
  });
});

/* ── who is published ────────────────────────────────────────────────────── */

describe('wsfCommunityMembers — who appears', () => {
  test('private is the default: a community nobody has changed lists nobody', async () => {
    /*
      THE SINGLE MOST IMPORTANT ASSERTION IN THIS FILE. Every membership row
      written before this feature has no `visibility` field. If the query
      treated a missing field as anything but private — or if the filtering
      happened in code with a truthiness test — turning this feature on would
      publish the entire existing member base at once, retroactively, without
      one person having agreed to it.
    */
    const groupId = await seedGroup();
    const a = uid('legacyA');
    const b = uid('legacyB');
    await seedMembership({ groupId, userId: a });
    await seedMembership({ groupId, userId: b, role: 'foundingChampion' });
    await seedProfile(a, 'Legacy A');
    await seedProfile(b, 'Legacy B');

    const r = await tryList(a, { groupId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ members: [] });
  });

  test('only the people who chose visible appear, and the caller sees their own entry', async () => {
    const groupId = await seedGroup();
    const shown = uid('shown');
    const hidden = uid('hidden');
    await seedMembership({ groupId, userId: shown, visibility: 'visible' });
    await seedMembership({ groupId, userId: hidden, visibility: 'private' });
    await seedProfile(shown, 'Shown Person');
    await seedProfile(hidden, 'Hidden Person');

    const r = await tryList(shown, { groupId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.members).toEqual([{ displayName: 'Shown Person', role: 'member' }]);

    // A private member still gets the directory — they just are not in it.
    const asHidden = await tryList(hidden, { groupId });
    expect(asHidden.ok).toBe(true);
    if (!asHidden.ok) return;
    expect(asHidden.value.members).toEqual([{ displayName: 'Shown Person', role: 'member' }]);
  });

  test('near-miss visibility values are NOT visible', async () => {
    /*
      Each of these becomes a publication under a `String(v).trim()
      .toLowerCase() === 'visible'` normalisation, or under `Boolean(v)`, or
      under `v !== 'private'`. The query filters on the literal at the index,
      so none of them match — and that is what this proves.
    */
    const groupId = await seedGroup();
    const viewer = uid('nearmissViewer');
    await seedMembership({ groupId, userId: viewer, visibility: 'private' });
    await seedProfile(viewer, 'Viewer');

    const nearMisses: unknown[] = [
      true,
      1,
      'Visible',
      'VISIBLE',
      ' visible',
      'visible ',
      'visible\n',
      'public',
      'yes',
      {},
      ['visible'],
      null,
    ];
    for (let i = 0; i < nearMisses.length; i += 1) {
      const u = uid(`nearmiss_${i}`);
      await seedMembership({ groupId, userId: u, visibility: nearMisses[i] });
      await seedProfile(u, `Near Miss ${i}`);
    }

    const r = await tryList(viewer, { groupId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.members).toEqual([]);
  });

  test('a visible member of ANOTHER community never bleeds into this one', async () => {
    const here = await seedGroup('Here');
    const elsewhere = await seedGroup('Elsewhere');
    const viewer = uid('bleedViewer');
    const other = uid('bleedOther');
    await seedMembership({ groupId: here, userId: viewer, visibility: 'visible' });
    await seedMembership({ groupId: elsewhere, userId: other, visibility: 'visible' });
    await seedProfile(viewer, 'Aaa Viewer');
    await seedProfile(other, 'Bbb Elsewhere');

    const r = await tryList(viewer, { groupId: here });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.members).toEqual([{ displayName: 'Aaa Viewer', role: 'member' }]);
  });

  test('a visible row whose doc id disagrees with its userId is DROPPED', async () => {
    /*
      THE IMPOSTOR ROW. firestore.rules treats the `userId` FIELD as the
      authority and never parses the document id. A row at
      `{groupId}_{someoneElse}` carrying `userId: victim` is therefore a row
      the product never wrote — and if the lister keyed the profile lookup off
      the parsed id while the gate keyed off the field, or vice versa, the
      victim's name would be published on the strength of a row they do not
      control.

      Both callables require the id and the field to agree, so the row is
      simply not there.
    */
    const groupId = await seedGroup();
    const viewer = uid('impostorViewer');
    const victim = uid('impostorVictim');
    await seedMembership({ groupId, userId: viewer, visibility: 'visible' });
    await seedProfile(viewer, 'Aaa Viewer');
    await seedProfile(victim, 'Zzz Victim');
    // The victim's OWN row is private. The forged row is not at their id.
    await seedMembership({ groupId, userId: victim, visibility: 'private' });
    await seedMembership({
      groupId,
      userId: victim,
      visibility: 'visible',
      docId: `${groupId}_forged_${seq}`,
    });

    const r = await tryList(viewer, { groupId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.members).toEqual([{ displayName: 'Aaa Viewer', role: 'member' }]);
  });

  test('an impostor row is not a way IN either — the gate uses the field too', async () => {
    const groupId = await seedGroup();
    const named = uid('gateNamed');
    const intruder = uid('gateIntruder');
    await seedMembership({ groupId, userId: named, visibility: 'visible' });
    await seedProfile(named, 'Named Person');
    // A row sitting at the intruder's canonical id, but claiming to be
    // somebody else's membership.
    await getFirestore()
      .doc(`wsfMemberships/${groupId}_${intruder}`)
      .set({ groupId, userId: named, role: 'member', membershipStatus: 'active' });

    const r = await tryList(intruder, { groupId });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('permission-denied');
  });

  test('a row whose groupId field disagrees with the requested group is refused', async () => {
    const groupId = await seedGroup();
    const elsewhere = await seedGroup();
    const caller = uid('wronggroup');
    await getFirestore()
      .doc(`wsfMemberships/${groupId}_${caller}`)
      .set({ groupId: elsewhere, userId: caller, role: 'member', membershipStatus: 'active' });
    const r = await tryList(caller, { groupId });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('permission-denied');
  });

  test('a visible member with no profile, or a blank displayName, is dropped without a placeholder', async () => {
    /*
      A placeholder — "Member", "—", an empty string — is a person-shaped row
      that says "somebody is here and hiding", which is the count this feature
      refuses to publish. Dropped means dropped.
    */
    const groupId = await seedGroup();
    const viewer = uid('profViewer');
    const noProfile = uid('noProfile');
    const blankName = uid('blankName');
    const spacesName = uid('spacesName');
    await seedMembership({ groupId, userId: viewer, visibility: 'visible' });
    await seedProfile(viewer, 'Aaa Viewer');
    await seedMembership({ groupId, userId: noProfile, visibility: 'visible' });
    await seedMembership({ groupId, userId: blankName, visibility: 'visible' });
    await seedProfile(blankName, '');
    await seedMembership({ groupId, userId: spacesName, visibility: 'visible' });
    await seedProfile(spacesName, '   ');

    const r = await tryList(viewer, { groupId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.members).toEqual([{ displayName: 'Aaa Viewer', role: 'member' }]);
  });
});

/* ── what is published ───────────────────────────────────────────────────── */

describe('wsfCommunityMembers — the payload carries nothing else', () => {
  test('exactly two keys per entry, and exactly one key on the response', async () => {
    const groupId = await seedGroup();
    const a = uid('shapeA');
    const b = uid('shapeB');
    await seedMembership({ groupId, userId: a, visibility: 'visible', role: 'foundingChampion' });
    await seedMembership({ groupId, userId: b, visibility: 'visible' });
    await seedProfile(a, 'Aaa Champion');
    await seedProfile(b, 'Bbb Member');

    const r = await tryList(a, { groupId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.value).sort()).toEqual(['members']);
    for (const item of r.value.members) {
      expect(Object.keys(item).sort()).toEqual(['displayName', 'role']);
    }
  });

  test('no uid appears ANYWHERE in the serialised response', async () => {
    /*
      A whitelist catches a new top-level key. It does not catch a uid smuggled
      into a string — a "memberKey", a composite id, a name suffixed for
      uniqueness. Serialising and searching for the literal uid catches all of
      those, and is the assertion that would fail first if somebody added a
      React key.
    */
    const groupId = await seedGroup();
    const a = uid('leakA');
    const b = uid('leakB');
    await seedMembership({ groupId, userId: a, visibility: 'visible' });
    await seedMembership({ groupId, userId: b, visibility: 'visible' });
    await seedProfile(a, 'Aaa Leak');
    await seedProfile(b, 'Bbb Leak');

    const r = await tryList(a, { groupId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const body = JSON.stringify(r.value);
    expect(body).not.toContain(a);
    expect(body).not.toContain(b);
    expect(body).not.toContain(groupId);
  });

  test('no count, no total, no hasMore — the hidden are not a subtraction', async () => {
    const groupId = await seedGroup();
    const viewer = uid('countViewer');
    await seedMembership({ groupId, userId: viewer, visibility: 'visible' });
    await seedProfile(viewer, 'Viewer');
    for (let i = 0; i < 4; i += 1) {
      const u = uid(`countHidden_${i}`);
      await seedMembership({ groupId, userId: u, visibility: 'private' });
      await seedProfile(u, `Hidden ${i}`);
    }

    const r = await tryList(viewer, { groupId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const key of [
      'total',
      'memberCount',
      'visibleCount',
      'hiddenCount',
      'hasMore',
      'cursor',
      'nextCursor',
    ]) {
      expect(r.value).not.toHaveProperty(key);
    }
  });

  test('an unrecognised stored role degrades to member rather than riding out', async () => {
    const groupId = await seedGroup();
    const viewer = uid('roleViewer');
    await seedMembership({ groupId, userId: viewer, visibility: 'visible' });
    await seedProfile(viewer, 'Aaa Viewer');
    for (const role of ['staff', 'pendingChampion', 'suspended', 'admin', '']) {
      const u = uid(`role_${role || 'blank'}`);
      await seedMembership({ groupId, userId: u, visibility: 'visible', role });
      await seedProfile(u, `Zzz ${role || 'blank'}`);
    }

    const r = await tryList(viewer, { groupId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const item of r.value.members) {
      expect(['foundingChampion', 'member']).toContain(item.role);
    }
    expect(r.value.members.filter((m) => m.role === 'foundingChampion')).toEqual([]);
  });

  test('the champion role IS passed through, because it is one of the two real values', async () => {
    const groupId = await seedGroup();
    const champ = uid('realChamp');
    await seedMembership({
      groupId,
      userId: champ,
      visibility: 'visible',
      role: 'foundingChampion',
    });
    await seedProfile(champ, 'Real Champion');
    const r = await tryList(champ, { groupId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.members).toEqual([
      { displayName: 'Real Champion', role: 'foundingChampion' },
    ]);
  });

  test('the order is by name, not by uid — storage order is never published', async () => {
    /*
      An equality-only Firestore query returns in document-id order, and with
      groupId fixed those ids differ only by uid. Returning storage order would
      publish a total ordering over the uids of every visible member: a stable
      handle that survives name changes and correlates across communities.

      The seeds below are named in the OPPOSITE order to the uids they are
      given, so a query-order result and a name-order result cannot coincide.
    */
    const groupId = await seedGroup();
    const first = uid('aaa_order');   // smaller uid
    const second = uid('bbb_order');  // larger uid
    await seedMembership({ groupId, userId: first, visibility: 'visible' });
    await seedMembership({ groupId, userId: second, visibility: 'visible' });
    await seedProfile(first, 'Zoe Zephyr');
    await seedProfile(second, 'Aaron Able');
    expect(first < second).toBe(true);

    const r = await tryList(first, { groupId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.members.map((m) => m.displayName)).toEqual([
      'Aaron Able',
      'Zoe Zephyr',
    ]);
  });
});

/* ── setting your own visibility ─────────────────────────────────────────── */

describe('wsfSetCommunityVisibility', () => {
  test('a signed-out caller is refused', async () => {
    const groupId = await seedGroup();
    const r = await trySet(null, { groupId, visibility: 'visible' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('unauthenticated');
  });

  test('a member publishes themselves, and the stored row is what changed', async () => {
    const groupId = await seedGroup();
    const me = uid('setMe');
    await seedMembership({ groupId, userId: me });
    await seedProfile(me, 'Set Me');
    expect(await storedVisibility(groupId, me)).toBeUndefined();

    const r = await trySet(me, { groupId, visibility: 'visible' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ groupId, visibility: 'visible' });
    expect(await storedVisibility(groupId, me)).toBe('visible');

    const back = await trySet(me, { groupId, visibility: 'private' });
    expect(back.ok).toBe(true);
    expect(await storedVisibility(groupId, me)).toBe('private');
  });

  test('setting the same value twice is idempotent, not an error', async () => {
    const groupId = await seedGroup();
    const me = uid('idem');
    await seedMembership({ groupId, userId: me, visibility: 'visible' });
    const r = await trySet(me, { groupId, visibility: 'visible' });
    expect(r.ok).toBe(true);
    expect(await storedVisibility(groupId, me)).toBe('visible');
  });

  test('every malformed visibility is refused WITHOUT writing', async () => {
    const groupId = await seedGroup();
    const me = uid('coerce');
    await seedMembership({ groupId, userId: me, visibility: 'private' });

    const bad: unknown[] = [
      true,
      false,
      1,
      0,
      'Visible',
      'VISIBLE',
      ' visible',
      'visible ',
      'public',
      'yes',
      '',
      null,
      {},
      ['visible'],
      { visibility: 'visible' },
    ];
    for (const value of bad) {
      const r = await trySet(me, { groupId, visibility: value });
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.error.code).toBe('invalid-argument');
      // The stored value never moved.
      expect(await storedVisibility(groupId, me)).toBe('private');
    }

    // A MISSING field is invalid-argument too — never a silent default in
    // either direction. Publishing is something a person does on purpose.
    const missing = await trySet(me, { groupId });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe('invalid-argument');
    expect(await storedVisibility(groupId, me)).toBe('private');
  });

  test('a non-member cannot set a visibility, and nothing is created', async () => {
    const groupId = await seedGroup();
    const outsider = uid('setOutsider');
    const r = await trySet(outsider, { groupId, visibility: 'visible' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('permission-denied');
    // The refusal must not have written the row it refused to read.
    expect(await storedVisibility(groupId, outsider)).toBe('<<no row>>');
  });

  test('a removed member cannot re-publish themselves', async () => {
    const groupId = await seedGroup();
    const gone = uid('setRemoved');
    await seedMembership({
      groupId,
      userId: gone,
      membershipStatus: 'removed',
      visibility: 'private',
    });
    const r = await trySet(gone, { groupId, visibility: 'visible' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('permission-denied');
    expect(await storedVisibility(groupId, gone)).toBe('private');
  });

  test('THERE IS NO targetUid — a targeted request changes only the caller', async () => {
    /*
      The Champion action family sits a few hundred lines above this callable,
      shares the shape `{ groupId, targetUid }`, and opens each handler with
      `requireChampion`. Copying one of them as a starting point would import
      both the parameter and a Champion override of a self-only setting in a
      single paste.

      A Champion sends the exact request that would work against those
      callables. It changes the Champion's own row and nothing else.
    */
    const groupId = await seedGroup();
    const champ = uid('overrideChamp');
    const victim = uid('overrideVictim');
    await seedMembership({ groupId, userId: champ, role: 'foundingChampion' });
    await seedMembership({ groupId, userId: victim, visibility: 'private' });
    await seedProfile(champ, 'Champion');
    await seedProfile(victim, 'Victim');

    const r = await trySet(champ, {
      groupId,
      targetUid: victim,
      uid: victim,
      userId: victim,
      visibility: 'visible',
    });
    expect(r.ok).toBe(true);
    // The victim is untouched...
    expect(await storedVisibility(groupId, victim)).toBe('private');
    // ...and the Champion published themselves, which is the only thing the
    // request could ever have done.
    expect(await storedVisibility(groupId, champ)).toBe('visible');

    const list = await tryList(champ, { groupId });
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value.members).toEqual([{ displayName: 'Champion', role: 'foundingChampion' }]);
  });

  test('no visibilitySetByUid or other actor field is written', async () => {
    /*
      The `*ByUid` fields elsewhere in this file exist only because the actor
      differs from the subject. Here it never can, so such a field on this
      write would be the signature of the override this callable does not have.
    */
    const groupId = await seedGroup();
    const me = uid('actorField');
    await seedMembership({ groupId, userId: me });
    await trySet(me, { groupId, visibility: 'visible' });
    const snap = await getFirestore().doc(`wsfMemberships/${groupId}_${me}`).get();
    const keys = Object.keys(snap.data() ?? {});
    for (const forbidden of keys.filter((k) => /ByUid$/.test(k))) {
      throw new Error(`the visibility write added an actor field: ${forbidden}`);
    }
    /*
      THE WHOLE STORED ROW, whitelisted. This caught `visibilityPromptedAt` on
      the commit that added it, which is what it is for: the write is a merge,
      so any field it names lands on a membership document permanently, and a
      merge that quietly grows is how a row acquires facts about a person
      nobody decided to store.
    */
    expect(keys.sort()).toEqual(
      [
        'groupId',
        'membershipStatus',
        'role',
        'updatedAt',
        'userId',
        'visibility',
        'visibilityPromptedAt',
      ].sort()
    );
  });

  test('the write is a merge — role and status survive it', async () => {
    const groupId = await seedGroup();
    const champ = uid('mergeChamp');
    await seedMembership({ groupId, userId: champ, role: 'foundingChampion' });
    await trySet(champ, { groupId, visibility: 'visible' });
    const snap = await getFirestore().doc(`wsfMemberships/${groupId}_${champ}`).get();
    expect(snap.data()).toMatchObject({
      role: 'foundingChampion',
      membershipStatus: 'active',
      userId: champ,
      groupId,
      visibility: 'visible',
    });
  });

  test('a blank groupId is invalid-argument', async () => {
    const me = uid('setBlankGroup');
    for (const bad of [undefined, '', '   ', null, 7, {}]) {
      const r = await trySet(me, bad === undefined
        ? { visibility: 'visible' }
        : { groupId: bad, visibility: 'visible' });
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.error.code).toBe('invalid-argument');
    }
  });
});

/* ── the caller's own answer, on Home ────────────────────────────────────── */

describe('wsfMyCommunities carries the caller OWN visibility', () => {
  test('default private, and it follows the setter', async () => {
    const groupId = await seedGroup('Home Visibility');
    const me = uid('homeMe');
    await seedMembership({ groupId, userId: me });
    await seedProfile(me, 'Home Me');

    const before = await wsfMyCommunities.run(req(me));
    expect(before.items.find((i) => i.groupId === groupId)?.visibility).toBe('private');

    await trySet(me, { groupId, visibility: 'visible' });
    const after = await wsfMyCommunities.run(req(me));
    expect(after.items.find((i) => i.groupId === groupId)?.visibility).toBe('visible');
  });

  test('it is the CALLER own answer — another member visible does not flip it', async () => {
    const groupId = await seedGroup('Home Others');
    const me = uid('homeQuiet');
    const other = uid('homeLoud');
    await seedMembership({ groupId, userId: me });
    await seedMembership({ groupId, userId: other, visibility: 'visible' });
    await seedProfile(me, 'Quiet');
    await seedProfile(other, 'Loud');

    const mine = await wsfMyCommunities.run(req(me));
    expect(mine.items.find((i) => i.groupId === groupId)?.visibility).toBe('private');
    // And no other member's identity came along with it.
    expect(JSON.stringify(mine)).not.toContain('Loud');
    expect(JSON.stringify(mine)).not.toContain(other);
  });
});

/* ── being asked, once, per membership ───────────────────────────────────── */

/** Whether the stored row carries an answer. Read straight from Firestore. */
async function storedPrompted(groupId: string, userId: string): Promise<boolean> {
  const snap = await getFirestore().doc(`wsfMemberships/${groupId}_${userId}`).get();
  return snap.exists && (snap.data() as { visibilityPromptedAt?: unknown }).visibilityPromptedAt != null;
}

describe('the question is asked once per membership, not once per person', () => {
  test('a membership nobody has answered reports NOT prompted', async () => {
    const groupId = await seedGroup('Unasked');
    const me = uid('unasked');
    await seedMembership({ groupId, userId: me });
    await seedProfile(me, 'Unasked Member');
    const mine = await wsfMyCommunities.run(req(me));
    expect(mine.items.find((i) => i.groupId === groupId)?.visibilityPrompted).toBe(false);
  });

  test('CHOOSING PRIVATE COUNTS AS AN ANSWER', async () => {
    /*
      THE MOST IMPORTANT ASSERTION HERE. Arriving, reading the question and
      continuing with the toggle off is an answer — and it is the commonest
      one. If only `'visible'` were recorded, everybody who declined would be
      asked again on every arrival, which is how a one-time question turns
      into nagging for consent: the member who most clearly said no is the one
      the product would pester.
    */
    const groupId = await seedGroup('Declined');
    const me = uid('declined');
    await seedMembership({ groupId, userId: me });
    await seedProfile(me, 'Declining Member');

    const r = await trySet(me, { groupId, visibility: 'private' });
    expect(r.ok).toBe(true);
    expect(await storedPrompted(groupId, me)).toBe(true);
    // And the stored answer is still private — recording the ANSWER must not
    // have changed the ANSWER.
    expect(await storedVisibility(groupId, me)).toBe('private');

    const mine = await wsfMyCommunities.run(req(me));
    const item = mine.items.find((i) => i.groupId === groupId);
    expect(item?.visibilityPrompted).toBe(true);
    expect(item?.visibility).toBe('private');
  });

  test('choosing visible counts too', async () => {
    const groupId = await seedGroup('Accepted');
    const me = uid('accepted');
    await seedMembership({ groupId, userId: me });
    await seedProfile(me, 'Accepting Member');
    await trySet(me, { groupId, visibility: 'visible' });
    expect(await storedPrompted(groupId, me)).toBe(true);
  });

  test('a REFUSED answer records nothing — a malformed request is not an answer', async () => {
    const groupId = await seedGroup('Malformed');
    const me = uid('malformed');
    await seedMembership({ groupId, userId: me });
    const r = await trySet(me, { groupId, visibility: 'Visible' });
    expect(r.ok).toBe(false);
    expect(await storedPrompted(groupId, me)).toBe(false);
  });

  test('the answer is PER COMMUNITY — answering one does not answer another', async () => {
    /*
      The whole reason this is not an account setting. A member who chose to be
      visible among their family has said nothing at all about the gym.
    */
    const here = await seedGroup('Here');
    const there = await seedGroup('There');
    const me = uid('twoCommunities');
    await seedMembership({ groupId: here, userId: me });
    await seedMembership({ groupId: there, userId: me });
    await seedProfile(me, 'Member Of Two');

    await trySet(me, { groupId: here, visibility: 'visible' });

    const mine = await wsfMyCommunities.run(req(me));
    const a = mine.items.find((i) => i.groupId === here);
    const b = mine.items.find((i) => i.groupId === there);
    expect(a?.visibility).toBe('visible');
    expect(a?.visibilityPrompted).toBe(true);
    // The other community is untouched in BOTH respects: no carried-over
    // visibility, and the question there is still unanswered.
    expect(b?.visibility).toBe('private');
    expect(b?.visibilityPrompted).toBe(false);
    expect(await storedVisibility(there, me)).toBeUndefined();
  });

  test('a non-member answering nothing leaves no row behind', async () => {
    const groupId = await seedGroup();
    const outsider = uid('promptOutsider');
    await trySet(outsider, { groupId, visibility: 'private' });
    expect(await storedVisibility(groupId, outsider)).toBe('<<no row>>');
  });
});

/* ── the life of a membership ────────────────────────────────────────────── */

/**
 * These drive the REAL admission callables rather than seeding a row, because
 * the thing being tested is a `{ merge: true }` write: a merge preserves every
 * field it does not name, so a `visibility` set before somebody left survives
 * their departure and their return unless a line says otherwise. A seeded
 * fixture cannot catch a missing line in somebody else's merge; only running
 * that merge can.
 */
function call(fn: unknown, callerUid: string | null, data: unknown) {
  return (fn as { run: (r: never) => Promise<never> }).run({
    data,
    auth: callerUid ? { uid: callerUid, token: { email_verified: true } } : undefined,
    rawRequest: { ip: '127.0.0.1', headers: {} },
  } as never);
}

/** A real community with a real join code, made by the real callable. */
async function makeCommunity(champion: string): Promise<{ groupId: string; joinCode: string }> {
  await seedProfile(champion, `Champion ${champion}`);
  const created: any = await call(wsfCreateCommunity, champion, {
    displayName: 'Lifecycle Community',
    groupType: 'custom',
    joinPolicy: 'public',
  });
  const groupId: string = created.groupId;
  const snap = await getFirestore().doc(`wsfCommunityGroups/${groupId}`).get();
  return { groupId, joinCode: (snap.data() as { joinCode: string }).joinCode };
}

describe('the life of a membership — publication never outlives it', () => {
  test('wsfCreateCommunity starts the Champion private', async () => {
    /*
      Making a community is the one act in this product most easily mistaken
      for consent to be named in it. It is not.
    */
    const champ = uid('createChamp');
    const { groupId } = await makeCommunity(champ);
    expect(await storedVisibility(groupId, champ)).toBe('private');
    expect(await storedPrompted(groupId, champ)).toBe(false);
    const list = await tryList(champ, { groupId });
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value.members).toEqual([]);
  });

  test('wsfJoinCommunity starts a joiner private', async () => {
    const champ = uid('joinChamp');
    const joiner = uid('joinJoiner');
    const { groupId, joinCode } = await makeCommunity(champ);
    await seedProfile(joiner, 'Joiner Name');
    await call(wsfJoinCommunity, joiner, { joinCode });
    expect(await storedVisibility(groupId, joiner)).toBe('private');
    // Joining does not answer the question, and does not ask it either — the
    // Join flow is untouched. The arrival sheet asks, later and separately.
    expect(await storedPrompted(groupId, joiner)).toBe(false);
  });

  test('LEAVE THEN REJOIN RESETS TO PRIVATE', async () => {
    /*
      THE MERGE TRAP. wsfJoinCommunity re-admits a departed member with
      `{ merge: true }`, which preserves every field it does not name. Without
      an explicit reset, somebody who was visible, left, and came back months
      later would be listed again on the strength of a decision they made
      before they left — never asked, never told.
    */
    const champ = uid('rejoinChamp');
    const leaver = uid('rejoinLeaver');
    const { groupId, joinCode } = await makeCommunity(champ);
    await seedProfile(leaver, 'Leaver Name');

    await call(wsfJoinCommunity, leaver, { joinCode });
    await trySet(leaver, { groupId, visibility: 'visible' });
    expect(await storedVisibility(groupId, leaver)).toBe('visible');

    await call(wsfLeaveCommunity, leaver, { groupId });
    await call(wsfJoinCommunity, leaver, { joinCode });

    expect(await storedVisibility(groupId, leaver)).toBe('private');
    // AND THE QUESTION COMES BACK. A merge preserves what it does not name, so
    // without an explicit delete the answer given before they left would count
    // as an answer about the community they have just re-entered.
    expect(await storedPrompted(groupId, leaver)).toBe(false);
    const list = await tryList(leaver, { groupId });
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value.members).toEqual([]);
  });

  test('REMOVE THEN REINSTATE RESETS TO PRIVATE — a Champion cannot republish by status change', async () => {
    /*
      Worse than the rejoin case, because the actor is not the subject. Without
      the reset, a Champion reinstating somebody who had been visible
      republishes that person's name by a unilateral act — the Champion
      override this feature does not have, arriving through the back door of a
      status change.
    */
    const champ = uid('reinChamp');
    const member = uid('reinMember');
    const { groupId, joinCode } = await makeCommunity(champ);
    await seedProfile(member, 'Reinstated Name');

    await call(wsfJoinCommunity, member, { joinCode });
    await trySet(member, { groupId, visibility: 'visible' });
    expect(await storedVisibility(groupId, member)).toBe('visible');

    await call(wsfRemoveMember, champ, { groupId, targetUid: member });
    await call(wsfReinstateMember, champ, { groupId, targetUid: member });

    expect(await storedVisibility(groupId, member)).toBe('private');
    expect(await storedPrompted(groupId, member)).toBe(false);
    const list = await tryList(champ, { groupId });
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value.members).toEqual([]);
  });

  test('a stale visible value on a departed row publishes nobody meanwhile', async () => {
    /*
      Belt and braces for the window between the two events above: while the
      membership is not active the row cannot be listed at all, because
      `membershipStatus == active` is an index filter rather than a code
      branch. So even a stale `visible` value publishes nobody.
    */
    const groupId = await seedGroup();
    const viewer = uid('lifeViewer');
    const left = uid('lifeLeft');
    await seedMembership({ groupId, userId: viewer, visibility: 'visible' });
    await seedProfile(viewer, 'Aaa Viewer');
    await seedMembership({
      groupId,
      userId: left,
      membershipStatus: 'departed',
      visibility: 'visible',
    });
    await seedProfile(left, 'Zzz Departed');

    const r = await tryList(viewer, { groupId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.members).toEqual([{ displayName: 'Aaa Viewer', role: 'member' }]);
  });
});
