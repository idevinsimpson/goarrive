/**
 * STATION ENROLMENT — a Champion-authorized second screen at an event.
 *
 * The properties pinned here are the ones the feature exists to keep:
 *
 *   - Only a Champion of the goal's community can approve a screen, list the
 *     screens or revoke one. Everyone else gets the non-enumerating not-found.
 *   - A screen's credential is a secret the server mints once and stores only
 *     as a hash. It is delivered exactly once; a second claim gets nothing.
 *   - A station sees EXACTLY what the public display sees — the same nine
 *     fields from the same function — and a goal that is not display-
 *     authorized refuses a station the same way it refuses the display.
 *   - Revocation is immediate: the next call from that screen is refused.
 *
 * Runs against the local Firestore emulator via `func.run(request)`.
 */

process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import {
  wsfApproveStation,
  wsfGoalPulse,
  wsfListStations,
  wsfRevokeStation,
  wsfStationClaimPairing,
  wsfStationPairingStatus,
  wsfStationRequestPairing,
  wsfStationState,
} from '../../src/index';

type Data = Record<string, unknown>;

/** Anonymous by construction: this is the screen's own call. */
function anon(fn: unknown, data: Data) {
  return (fn as { run: (r: never) => Promise<unknown> }).run({
    data,
    auth: undefined,
    rawRequest: { ip: '127.0.0.1', headers: {} },
    acceptsStreaming: false,
  } as never);
}

function callAs(fn: unknown, uid: string | null, data: Data) {
  return (fn as { run: (r: never) => Promise<unknown> }).run({
    data,
    auth: uid ? { uid, token: { email_verified: true } } : undefined,
    rawRequest: { ip: '127.0.0.1', headers: {} },
    acceptsStreaming: false,
  } as never);
}

async function attempt<T>(p: Promise<T>): Promise<
  { ok: true; value: T } | { ok: false; error: HttpsError }
> {
  try {
    return { ok: true as const, value: await p };
  } catch (e) {
    return { ok: false as const, error: e as HttpsError };
  }
}

let seq = 0;
function uniq(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

async function seedCommunity(opts: {
  championUid: string;
  joinPolicy?: 'private' | 'inviteOnly' | 'public';
  joinCode?: string;
}): Promise<string> {
  const db = getFirestore();
  const groupId = uniq('stationGroup');
  await db.doc(`wsfCommunityGroups/${groupId}`).set({
    displayName: 'Expo Hall Movers',
    groupType: 'custom',
    joinPolicy: opts.joinPolicy ?? 'public',
    joinCode: opts.joinCode ?? uniq('joincode1234567890'),
    createdByUserId: opts.championUid,
    lifecycleStatus: 'active',
    isSample: false,
  });
  await db.doc(`wsfMemberships/${groupId}_${opts.championUid}`).set({
    groupId,
    userId: opts.championUid,
    role: 'foundingChampion',
    membershipStatus: 'active',
  });
  return groupId;
}

async function seedMember(groupId: string, uid: string): Promise<void> {
  await getFirestore().doc(`wsfMemberships/${groupId}_${uid}`).set({
    groupId,
    userId: uid,
    role: 'member',
    membershipStatus: 'active',
  });
}

async function seedGoal(groupId: string, opts?: { authorized?: boolean }): Promise<string> {
  const now = Date.now();
  const ref = getFirestore().collection('wsfGoals').doc();
  const doc: Record<string, unknown> = {
    ownerUid: 'stationSeed',
    communityGroupId: groupId,
    title: 'Expo Squat Challenge',
    target: 5000,
    unit: 'squats',
    status: 'active',
    startsAt: Timestamp.fromMillis(now - 60_000),
    endsAt: Timestamp.fromMillis(now + 3_600_000),
    timezone: 'America/New_York',
  };
  if (opts?.authorized === true) doc.aggregateDisplayAuthorized = true;
  await ref.set(doc);
  return ref.id;
}

async function seedShards(goalId: string, perShard: number[]): Promise<void> {
  const db = getFirestore();
  const batch = db.batch();
  perShard.forEach((count, i) => {
    if (count > 0) {
      batch.set(db.doc(`wsfGoalCounters/${goalId}/shards/${i}`), { count }, { merge: true });
    }
  });
  await batch.commit();
}

/** The whole enrolment, as it actually happens: the screen asks, the Champion
 * approves, the screen claims. */
async function enrol(opts: {
  goalId: string;
  championUid: string;
  slot?: 1 | 2;
}): Promise<{ stationId: string; secret: string; label: string; pairingId: string }> {
  const requested = (await anon(wsfStationRequestPairing, { goalId: opts.goalId })) as {
    pairingId: string;
    code: string;
  };
  await callAs(wsfApproveStation, opts.championUid, {
    goalId: opts.goalId,
    code: requested.code,
    slot: opts.slot ?? 1,
  });
  const claimed = (await anon(wsfStationClaimPairing, { pairingId: requested.pairingId })) as {
    stationId: string;
    secret: string;
    label: string;
  };
  return { ...claimed, pairingId: requested.pairingId };
}

beforeAll(async () => {
  await getFirestore().doc('_warmup/wsf-station-enrollment').set({ at: Date.now() }, { merge: true });
});

describe('a screen asks to be let in', () => {
  test('a pairing request reads no goal, so it cannot be an existence oracle', async () => {
    const real = (await anon(wsfStationRequestPairing, {
      goalId: (await seedGoal(await seedCommunity({ championUid: uniq('champ') }))),
    })) as { pairingId: string; code: string };
    const imaginary = (await anon(wsfStationRequestPairing, { goalId: uniq('nosuchgoal') })) as {
      pairingId: string;
      code: string;
    };
    // Same shape, same success. Nothing in the answer says whether the goal is
    // real; only a Champion of a real goal can approve the code.
    expect(real.code).toHaveLength(6);
    expect(imaginary.code).toHaveLength(6);
    expect(real.pairingId).not.toBe(imaginary.pairingId);
  });

  test('a code is minted from the unambiguous alphabet only', async () => {
    const r = (await anon(wsfStationRequestPairing, { goalId: uniq('goal') })) as { code: string };
    expect(r.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });

  test('the live code is never stored — only its hash', async () => {
    const goalId = await seedGoal(await seedCommunity({ championUid: uniq('champ') }));
    const r = (await anon(wsfStationRequestPairing, { goalId })) as {
      pairingId: string;
      code: string;
    };
    const snap = await getFirestore().doc(`wsfKioskPairings/${r.pairingId}`).get();
    const data = snap.data() as Record<string, unknown>;
    expect(JSON.stringify(data)).not.toContain(r.code);
    expect(data.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(data.status).toBe('pending');
  });

  test('an unknown pairing id answers exactly as an expired one does', async () => {
    const unknown = (await anon(wsfStationPairingStatus, { pairingId: uniq('nosuch') })) as {
      status: string;
    };
    expect(unknown.status).toBe('expired');
  });
});

describe('only a Champion of that goal can approve a screen', () => {
  test('a stranger, a plain member and a Champion of another community are all refused', async () => {
    const champion = uniq('champ');
    const groupId = await seedCommunity({ championUid: champion });
    const goalId = await seedGoal(groupId, { authorized: true });
    const member = uniq('member');
    await seedMember(groupId, member);
    const otherChampion = uniq('champ');
    await seedCommunity({ championUid: otherChampion });

    const requested = (await anon(wsfStationRequestPairing, { goalId })) as { code: string };

    for (const uid of [null, uniq('stranger'), member, otherChampion]) {
      const r = await attempt(
        callAs(wsfApproveStation, uid, { goalId, code: requested.code, slot: 1 })
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(['not-found', 'unauthenticated']).toContain(r.error.code);
    }

    // And the code is still good for the Champion afterwards: a refused
    // attempt consumes nothing.
    const approved = await attempt(
      callAs(wsfApproveStation, champion, { goalId, code: requested.code, slot: 2 })
    );
    expect(approved.ok).toBe(true);
  });

  test('the label is derived from the slot on the server and cannot be supplied', async () => {
    const champion = uniq('champ');
    const goalId = await seedGoal(await seedCommunity({ championUid: champion }), {
      authorized: true,
    });
    const requested = (await anon(wsfStationRequestPairing, { goalId })) as { code: string };
    const approved = (await callAs(wsfApproveStation, champion, {
      goalId,
      code: requested.code,
      slot: 2,
      label: 'Front desk admin',
    })) as { stationId: string; label: string; slot: number };
    expect(approved.label).toBe('Station 2');
    expect(approved.slot).toBe(2);
    const snap = await getFirestore().doc(`wsfKioskStations/${approved.stationId}`).get();
    expect((snap.data() as { label?: string }).label).toBe('Station 2');
  });

  test('a slot that is not 1 or 2, and a malformed code, are refused', async () => {
    const champion = uniq('champ');
    const goalId = await seedGoal(await seedCommunity({ championUid: champion }));
    const requested = (await anon(wsfStationRequestPairing, { goalId })) as { code: string };

    const badSlot = await attempt(
      callAs(wsfApproveStation, champion, { goalId, code: requested.code, slot: 3 })
    );
    expect(badSlot.ok).toBe(false);
    if (!badSlot.ok) expect(badSlot.error.code).toBe('invalid-argument');

    const badCode = await attempt(
      callAs(wsfApproveStation, champion, { goalId, code: 'ZZZZZZ', slot: 1 })
    );
    expect(badCode.ok).toBe(false);
    if (!badCode.ok) expect(badCode.error.code).toBe('not-found');
  });

  test('a code approved for one goal cannot be redeemed against another', async () => {
    const champion = uniq('champ');
    const groupId = await seedCommunity({ championUid: champion });
    const goalA = await seedGoal(groupId);
    const goalB = await seedGoal(groupId);
    const requested = (await anon(wsfStationRequestPairing, { goalId: goalA })) as { code: string };
    const r = await attempt(
      callAs(wsfApproveStation, champion, { goalId: goalB, code: requested.code, slot: 1 })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not-found');
  });
});

describe('the credential is delivered once and stored only as a hash', () => {
  test('the station document never holds the secret, and the delivery copy is deleted by the claim', async () => {
    const champion = uniq('champ');
    const goalId = await seedGoal(await seedCommunity({ championUid: champion }), {
      authorized: true,
    });
    const { stationId, secret, pairingId } = await enrol({ goalId, championUid: champion });

    const db = getFirestore();
    const station = (await db.doc(`wsfKioskStations/${stationId}`).get()).data() as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(station)).not.toContain(secret);
    expect(station.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(station.status).toBe('active');
    // Deliberately absent: nothing about the device or anyone near it.
    for (const forbidden of ['userAgent', 'ip', 'ipAddress', 'fingerprint', 'geo', 'location']) {
      expect(station).not.toHaveProperty(forbidden);
    }

    const pairing = (await db.doc(`wsfKioskPairings/${pairingId}`).get()).data() as Record<
      string,
      unknown
    >;
    expect(pairing.status).toBe('claimed');
    expect(pairing).not.toHaveProperty('deliverySecret');
    expect(JSON.stringify(pairing)).not.toContain(secret);
  });

  test('a second claim gets nothing', async () => {
    const champion = uniq('champ');
    const goalId = await seedGoal(await seedCommunity({ championUid: champion }), {
      authorized: true,
    });
    const { pairingId } = await enrol({ goalId, championUid: champion });
    const again = await attempt(anon(wsfStationClaimPairing, { pairingId }));
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('failed-precondition');
  });

  test('a pairing that was never approved cannot be claimed', async () => {
    const goalId = await seedGoal(await seedCommunity({ championUid: uniq('champ') }));
    const requested = (await anon(wsfStationRequestPairing, { goalId })) as { pairingId: string };
    const r = await attempt(anon(wsfStationClaimPairing, { pairingId: requested.pairingId }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('failed-precondition');
  });
});

describe('a station sees exactly what the public display sees', () => {
  test('the nine pulse fields are identical to wsfGoalPulse for the same goal', async () => {
    const champion = uniq('champ');
    const goalId = await seedGoal(await seedCommunity({ championUid: champion }), {
      authorized: true,
    });
    await seedShards(goalId, [10, 0, 20, 0, 5, 0, 0, 15, 0, 0]); // 50
    const { stationId, secret } = await enrol({ goalId, championUid: champion });

    const state = (await anon(wsfStationState, { stationId, secret })) as {
      pulse: Record<string, unknown>;
      label: string;
      slot: number;
      queueId: string;
    };
    const pulse = (await anon(wsfGoalPulse, { goalId })) as Record<string, unknown>;

    // THE CONTRACT. Not "the same numbers" — the same object, key for key.
    expect(state.pulse).toEqual(pulse);
    expect(Object.keys(state.pulse).sort()).toEqual(
      [
        'communityDisplayName',
        'endsAt',
        'goalTitle',
        'sharedTotal',
        'startsAt',
        'status',
        'target',
        'timezone',
        'unit',
      ].sort()
    );
    expect(state.pulse.sharedTotal).toBe(50);
    expect(state.label).toBe('Station 1');
    expect(state.queueId).toBe(goalId);
  });

  test('a goal that is not authorized for display refuses a station, exactly as it refuses the display', async () => {
    const champion = uniq('champ');
    const goalId = await seedGoal(await seedCommunity({ championUid: champion }));
    const { stationId, secret } = await enrol({ goalId, championUid: champion });

    const station = await attempt(anon(wsfStationState, { stationId, secret }));
    const display = await attempt(anon(wsfGoalPulse, { goalId }));
    expect(station.ok).toBe(false);
    expect(display.ok).toBe(false);
    if (station.ok || display.ok) return;
    expect(station.error.code).toBe(display.error.code);
    expect(station.error.message).toBe(display.error.message);
  });

  test('the newcomer join code rides only where a link admits anyone at all', async () => {
    const champion = uniq('champ');
    const joinCode = 'vT6nQpR2s8XyZ0aBcDeFgH';
    const publicGroup = await seedCommunity({ championUid: champion, joinPolicy: 'public', joinCode });
    const publicGoal = await seedGoal(publicGroup, { authorized: true });
    const publicStation = await enrol({ goalId: publicGoal, championUid: champion });
    const publicState = (await anon(wsfStationState, {
      stationId: publicStation.stationId,
      secret: publicStation.secret,
    })) as { joinCode: string | null };
    expect(publicState.joinCode).toBe(joinCode);

    const privateChampion = uniq('champ');
    const privateGroup = await seedCommunity({
      championUid: privateChampion,
      joinPolicy: 'private',
      joinCode: 'pRiVaTeCoDe1234567890a',
    });
    const privateGoal = await seedGoal(privateGroup, { authorized: true });
    const privateStation = await enrol({ goalId: privateGoal, championUid: privateChampion });
    const privateState = (await anon(wsfStationState, {
      stationId: privateStation.stationId,
      secret: privateStation.secret,
    })) as { joinCode: string | null };
    // A private community admits nobody by link, so no code and no QR. A
    // station standing in the room changes nothing about admission.
    expect(privateState.joinCode).toBeNull();
  });

  test('a wrong secret, an unknown station and a made-up one are one answer', async () => {
    const champion = uniq('champ');
    const goalId = await seedGoal(await seedCommunity({ championUid: champion }), {
      authorized: true,
    });
    const { stationId } = await enrol({ goalId, championUid: champion });

    const wrong = await attempt(
      anon(wsfStationState, { stationId, secret: 'ZmFrZS1zZWNyZXQtZm9yLXRlc3RzLW9ubHktMDAwMQ' })
    );
    const unknown = await attempt(
      anon(wsfStationState, {
        stationId: uniq('nosuchstation'),
        secret: 'ZmFrZS1zZWNyZXQtZm9yLXRlc3RzLW9ubHktMDAwMQ',
      })
    );
    expect(wrong.ok).toBe(false);
    expect(unknown.ok).toBe(false);
    if (wrong.ok || unknown.ok) return;
    expect(wrong.error.code).toBe('permission-denied');
    expect(unknown.error.code).toBe('permission-denied');
    expect(wrong.error.message).toBe(unknown.error.message);
  });
});

describe('the Champion can see the screens, and turn one off', () => {
  test('the list names the screens and never their secrets', async () => {
    const champion = uniq('champ');
    const goalId = await seedGoal(await seedCommunity({ championUid: champion }), {
      authorized: true,
    });
    const first = await enrol({ goalId, championUid: champion, slot: 1 });
    const second = await enrol({ goalId, championUid: champion, slot: 2 });

    const listed = (await callAs(wsfListStations, champion, { goalId })) as {
      stations: Array<Record<string, unknown>>;
    };
    expect(listed.stations).toHaveLength(2);
    expect(listed.stations.map((s) => s.label)).toEqual(['Station 1', 'Station 2']);
    const serialized = JSON.stringify(listed);
    expect(serialized).not.toContain(first.secret);
    expect(serialized).not.toContain(second.secret);
    expect(serialized).not.toContain('secretHash');
  });

  test('only a Champion may list or revoke', async () => {
    const champion = uniq('champ');
    const groupId = await seedCommunity({ championUid: champion });
    const goalId = await seedGoal(groupId, { authorized: true });
    const member = uniq('member');
    await seedMember(groupId, member);
    const { stationId } = await enrol({ goalId, championUid: champion });

    for (const uid of [uniq('stranger'), member]) {
      const list = await attempt(callAs(wsfListStations, uid, { goalId }));
      const revoke = await attempt(callAs(wsfRevokeStation, uid, { stationId }));
      expect(list.ok).toBe(false);
      expect(revoke.ok).toBe(false);
      if (!list.ok) expect(list.error.code).toBe('not-found');
      if (!revoke.ok) expect(revoke.error.code).toBe('not-found');
    }
    const anonList = await attempt(callAs(wsfListStations, null, { goalId }));
    expect(anonList.ok).toBe(false);
    if (!anonList.ok) expect(anonList.error.code).toBe('unauthenticated');
  });

  test('a revoked screen is refused on its very next call, and its hash is gone', async () => {
    const champion = uniq('champ');
    const goalId = await seedGoal(await seedCommunity({ championUid: champion }), {
      authorized: true,
    });
    const { stationId, secret } = await enrol({ goalId, championUid: champion });

    const before = await attempt(anon(wsfStationState, { stationId, secret }));
    expect(before.ok).toBe(true);

    await callAs(wsfRevokeStation, champion, { stationId });

    const after = await attempt(anon(wsfStationState, { stationId, secret }));
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error.code).toBe('permission-denied');

    const doc = (await getFirestore().doc(`wsfKioskStations/${stationId}`).get()).data() as Record<
      string,
      unknown
    >;
    expect(doc.status).toBe('revoked');
    expect(doc).not.toHaveProperty('secretHash');
    expect(doc.revokedBy).toBe(champion);

    // The revoked screen is still in the Champion's list, with the fact that
    // it was revoked. Revoking is not deleting.
    const listed = (await callAs(wsfListStations, champion, { goalId })) as {
      stations: Array<Record<string, unknown>>;
    };
    expect(listed.stations.find((s) => s.stationId === stationId)?.status).toBe('revoked');
  });

  test('a screen revoked between approval and claim never receives a credential', async () => {
    const champion = uniq('champ');
    const goalId = await seedGoal(await seedCommunity({ championUid: champion }), {
      authorized: true,
    });
    const requested = (await anon(wsfStationRequestPairing, { goalId })) as {
      pairingId: string;
      code: string;
    };
    const approved = (await callAs(wsfApproveStation, champion, {
      goalId,
      code: requested.code,
      slot: 1,
    })) as { stationId: string };
    await callAs(wsfRevokeStation, champion, { stationId: approved.stationId });

    const claim = await attempt(anon(wsfStationClaimPairing, { pairingId: requested.pairingId }));
    expect(claim.ok).toBe(false);
    if (!claim.ok) expect(claim.error.code).toBe('failed-precondition');

    // Not merely undelivered — GONE. Revoking stops the claim on the
    // station's status, but the plaintext secret would otherwise sit in the
    // pairing until it expired, for a screen the Champion has just turned
    // off. A Champion who revokes expects the credential gone, not gone in
    // ten minutes.
    const pairing = (await getFirestore()
      .doc(`wsfKioskPairings/${requested.pairingId}`)
      .get()).data() as Record<string, unknown>;
    expect(pairing).not.toHaveProperty('deliverySecret');
    expect(pairing.status).toBe('refused');

    // And the screen still polling is told a word it knows how to act on, so
    // it stops waiting and asks for a fresh code rather than hanging.
    const polled = (await anon(wsfStationPairingStatus, {
      pairingId: requested.pairingId,
    })) as { status: string };
    expect(['expired', 'refused']).toContain(polled.status);
  });
});

describe('nothing here records a contribution', () => {
  test('a full enrolment writes no contribution, counter or member total', async () => {
    const champion = uniq('champ');
    const goalId = await seedGoal(await seedCommunity({ championUid: champion }), {
      authorized: true,
    });
    const { stationId, secret } = await enrol({ goalId, championUid: champion });
    await anon(wsfStationState, { stationId, secret });

    const db = getFirestore();
    const [contributions, counters, memberTotals] = await Promise.all([
      db.collection('wsfContributions').where('goalId', '==', goalId).get(),
      db.collection(`wsfGoalCounters/${goalId}/shards`).get(),
      db.collection('wsfGoalMemberTotals').where('goalId', '==', goalId).get(),
    ]);
    expect(contributions.empty).toBe(true);
    expect(counters.empty).toBe(true);
    expect(memberTotals.empty).toBe(true);
  });
});
