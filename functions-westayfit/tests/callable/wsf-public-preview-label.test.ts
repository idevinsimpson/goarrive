/**
 * wsfPublicPreviewLabel (MEMBER-TRUTH-BACKEND-1 B) — the two labels a link
 * preview may show, or a brand-only answer.
 *
 * What this pins:
 *   • ONLY a goal with `aggregateDisplayAuthorized === true`, in a non-sample
 *     community, yields `{visibility:'public', communityName, goalTitle}` —
 *     the same two labels wsfGoalPulse already publishes for that goal.
 *   • Every other case returns the IDENTICAL `{visibility:'none'}` body:
 *     absent / false / malformed authorization, unknown goal, sample
 *     community, bad / inactive / unknown marker, a marker repointed to an
 *     unauthorized goal, a marker whose goal belongs to another community, a
 *     community id alone, two ids at once, unsupported input.
 *   • Link-joinability, membership and marker possession never publish.
 *   • Nothing else leaves: no members, counts, totals, location, join code.
 *   • Labels are trimmed and capped at 60; `maxAgeSeconds` is 60, and a
 *     revocation or repoint is reflected on the very next read.
 *   • The per-IP rate limit fires before any lookup.
 *
 * Synthetic, emulator-only (demo-wsf-local).
 */

process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { mintJoinCode, wsfGoalPulse, wsfPublicPreviewLabel } from '../../src/index';

const RUN = `pp${Date.now().toString(36)}`;
const NONE = { visibility: 'none', maxAgeSeconds: 60 };
const db = () => getFirestore();
let ipSeq = 0;

function req(data: unknown, uid: string | null = null, ip?: string): any {
  ipSeq += 1;
  return {
    auth: uid ? { uid, token: { email_verified: true } } : undefined,
    data,
    rawRequest: { ip: ip ?? `203.0.113.${ipSeq % 250}`, headers: {} },
    acceptsStreaming: false,
  };
}
const label = (data: unknown, uid: string | null = null) => wsfPublicPreviewLabel.run(req(data, uid));

async function seedGroup(name: string, extra: Record<string, unknown> = {}) {
  const id = `${RUN}_${name}`;
  await db().doc(`wsfCommunityGroups/${id}`).set({
    displayName: `Synthetic ${name}`,
    groupType: 'custom',
    joinPolicy: 'public',
    joinCode: mintJoinCode(),
    lifecycleStatus: 'active',
    isSample: false,
    ...extra,
  });
  return id;
}

async function seedGoal(name: string, groupId: string, extra: Record<string, unknown> = {}) {
  const id = `${RUN}_${name}`;
  const now = Date.now();
  await db().doc(`wsfGoals/${id}`).set({
    ownerUid: 'seed',
    communityGroupId: groupId,
    title: `Synthetic ${name} wall`,
    target: 100,
    unit: 'squats',
    status: 'active',
    startsAt: Timestamp.fromMillis(now - 3600e3),
    endsAt: Timestamp.fromMillis(now + 3600e3),
    timezone: 'America/New_York',
    ...extra,
  });
  return id;
}

async function seedMarker(slug: string, groupId: string, goalId: string, extra: Record<string, unknown> = {}) {
  await db().doc(`wsfMarkers/${slug}`).set({ label: 'Synthetic Flag', active: true, communityGroupId: groupId, goalId, kioskMode: 'off', ...extra });
}

const slug = (n: string) => `${RUN}-${n}`.toLowerCase();

let pub: string;
let authorized: string;

beforeAll(async () => {
  await db().doc('_warmup/wsf-public-preview-label').set({ at: Date.now() });
  pub = await seedGroup('public');
  authorized = await seedGoal('authorized', pub, { aggregateDisplayAuthorized: true });
  await db().doc(`wsfGoalCounters/${authorized}/shards/0`).set({ count: 42 });
}, 30_000);

describe('the approved projection', () => {
  it('an authorized goal yields exactly the two labels and the cache bound, nothing else', async () => {
    const r = await label({ goalId: authorized });
    expect(r).toEqual({
      visibility: 'public',
      communityName: 'Synthetic public',
      goalTitle: 'Synthetic authorized wall',
      maxAgeSeconds: 60,
    });
    const text = JSON.stringify(r);
    const code = (await db().doc(`wsfCommunityGroups/${pub}`).get()).data()!.joinCode as string;
    expect(text).not.toContain(code);
    expect(text).not.toMatch(/42|100|squats|member|count|total|target|location|uid/i);
  });

  it('carries the same two labels wsfGoalPulse already publishes for that goal', async () => {
    const pulse = (await wsfGoalPulse.run(req({ goalId: authorized }))) as Record<string, unknown>;
    const r = (await label({ goalId: authorized })) as { communityName: string; goalTitle: string };
    expect(r.communityName).toBe(pulse.communityDisplayName);
    expect(r.goalTitle).toBe(pulse.goalTitle);
  });

  it('a marker resolves to its goal and is then held to that goal’s own authorization', async () => {
    await seedMarker(slug('flag'), pub, authorized);
    expect(await label({ markerSlug: slug('flag') })).toMatchObject({ visibility: 'public', goalTitle: 'Synthetic authorized wall' });
    expect(await label({ markerSlug: slug('flag').toUpperCase() })).toMatchObject({ visibility: 'public' });
  });

  it('labels are trimmed and capped at 60 characters', async () => {
    const long = await seedGroup('long', { displayName: `  ${'C'.repeat(80)}  ` });
    const goal = await seedGoal('longgoal', long, { title: `  ${'T'.repeat(75)} `, aggregateDisplayAuthorized: true });
    const r = (await label({ goalId: goal })) as { communityName: string; goalTitle: string };
    expect(r.communityName).toBe('C'.repeat(60));
    expect(r.goalTitle).toBe('T'.repeat(60));
  });
});

describe('every denial is the same brand-only answer', () => {
  it('absent, false and malformed authorization', async () => {
    for (const [name, extra] of [
      ['absent', {}],
      ['false', { aggregateDisplayAuthorized: false }],
      ['string', { aggregateDisplayAuthorized: 'true' }],
      ['one', { aggregateDisplayAuthorized: 1 }],
    ] as const) {
      const goal = await seedGoal(`auth-${name}`, pub, extra);
      expect(await label({ goalId: goal })).toEqual(NONE);
    }
  });

  it('unknown goal, sample community, missing community and empty labels', async () => {
    expect(await label({ goalId: `${RUN}_ghost` })).toEqual(NONE);
    const sample = await seedGroup('sample', { isSample: true });
    expect(await label({ goalId: await seedGoal('sample-goal', sample, { aggregateDisplayAuthorized: true }) })).toEqual(NONE);
    expect(await label({ goalId: await seedGoal('orphan-goal', `${RUN}_nogroup`, { aggregateDisplayAuthorized: true }) })).toEqual(NONE);
    expect(await label({ goalId: await seedGoal('blank-title', pub, { title: '   ', aggregateDisplayAuthorized: true }) })).toEqual(NONE);
  });

  it('bad, unknown and inactive markers, and a marker naming another community', async () => {
    await seedMarker(slug('inactive'), pub, authorized, { active: false });
    const other = await seedGroup('other');
    await seedMarker(slug('foreign'), other, authorized);
    for (const s of ['a/b', '', 'bad_slug', slug('unknown'), slug('inactive'), slug('foreign'), 42]) {
      expect(await label({ markerSlug: s })).toEqual(NONE);
    }
  });

  it('a community id alone, both ids at once, nothing, and unsupported input', async () => {
    for (const data of [
      { communityId: pub },
      { groupId: pub },
      { goalId: authorized, markerSlug: slug('flag') },
      {},
      null,
      'goal',
      [authorized],
      { goalId: 'a/b' },
      { goalId: { id: authorized } },
      // Firestore-reserved ids (`__.*__`) pass the id shape check but make the
      // document read itself throw; the answer must still be the one denial.
      { goalId: '__abc__' },
      { goalId: '__x__' },
    ]) {
      expect(await label(data)).toEqual(NONE);
    }
  });

  it('link-joinability, membership and marker possession never publish', async () => {
    const goal = await seedGoal('joinable-unauthorized', pub);
    const uid = `${RUN}_member`;
    await db().doc(`wsfMemberships/${pub}_${uid}`).set({ groupId: pub, userId: uid, role: 'foundingChampion', membershipStatus: 'active' });
    await seedMarker(slug('held'), pub, goal);
    expect(await label({ goalId: goal }, uid)).toEqual(NONE);
    expect(await label({ markerSlug: slug('held') }, uid)).toEqual(NONE);
  });
});

describe('revocation and repointing are honoured on the next read', () => {
  it('revoking the display authorization turns the next answer brand-only', async () => {
    const goal = await seedGoal('revoke', pub, { aggregateDisplayAuthorized: true });
    expect((await label({ goalId: goal })).visibility).toBe('public');
    await db().doc(`wsfGoals/${goal}`).update({ aggregateDisplayAuthorized: false });
    expect(await label({ goalId: goal })).toEqual(NONE);
  });

  it('repointing a marker to an unauthorized goal turns it brand-only; the old goal keeps its own answer', async () => {
    const unauthorized = await seedGoal('repoint-target', pub);
    await seedMarker(slug('repoint'), pub, authorized);
    expect((await label({ markerSlug: slug('repoint') })).visibility).toBe('public');
    await seedMarker(slug('repoint'), pub, unauthorized);
    expect(await label({ markerSlug: slug('repoint') })).toEqual(NONE);
    expect((await label({ goalId: authorized })).visibility).toBe('public');
  });

  it('every answer, public or not, carries the 60-second cache bound', async () => {
    expect((await label({ goalId: authorized })).maxAgeSeconds).toBe(60);
    expect((await label({ goalId: `${RUN}_ghost` })).maxAgeSeconds).toBe(60);
  });
});

describe('abuse boundary', () => {
  it('the per-IP limit refuses before any lookup, the same for a real and an unknown goal', async () => {
    const ip = `198.18.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    for (let i = 0; i < 100; i++) await wsfPublicPreviewLabel.run(req({ goalId: `${RUN}_ghost` }, null, ip));
    for (const data of [{ goalId: authorized }, { goalId: `${RUN}_ghost` }]) {
      try {
        await wsfPublicPreviewLabel.run(req(data, null, ip));
        throw new Error('expected refusal');
      } catch (e) {
        expect((e as HttpsError).code).toBe('resource-exhausted');
      }
    }
  }, 60_000);
});
