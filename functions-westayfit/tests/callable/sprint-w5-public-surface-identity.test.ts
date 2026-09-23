/**
 * W5 INDEPENDENT QA — NO PUBLIC SURFACE MAY RETURN A MEMBER'S IDENTITY.
 *
 * Sprint Round 1, W5 packet (PR #365 comment 5781435779). An independently
 * written probe, added alongside the existing suites rather than in place of
 * any of them: nothing here edits or weakens an existing test.
 *
 * WHAT IT ASSERTS, AND WHY IT IS SHAPED THIS WAY.
 *
 * The callables marked `invoker: 'public'` are the ones a signed-out stranger
 * can reach — kiosks, wall displays and station hardware sign in as nobody by
 * design. Each of them has a comment saying no member identity may appear in
 * its response. This probe stops trusting the comments and drives the real
 * callables against seeded data whose identifying values are UNMISTAKABLE, then
 * searches the WHOLE response — recursively, keys as well as values — for any
 * of them.
 *
 * IT SCANS FAILURES TOO. A refusal is a response: an error message that names
 * the member it refused on behalf of leaks exactly as much as a success
 * payload would, and error strings are where identifying detail is likeliest to
 * be interpolated without anybody thinking of it as output.
 *
 * IT SEEDS TWO MEMBERS, NOT ONE. A surface that returns "the caller" is not the
 * hazard here, because there is no caller. The hazard is a surface that returns
 * somebody ELSE, so both members are strangers to the unauthenticated call and
 * both are searched for.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not assert that each callable
 * succeeds. Several need pairing state or a live window this probe does not
 * build, and forcing that would make the file a fixture-maintenance burden that
 * gets disabled later. The invariant under test holds whichever way the call
 * goes, so the probe asserts only the invariant.
 *
 * Runs against the local Firestore emulator via `func.run(request)`.
 */

process.env.METADATA_SERVER_DETECTION =
  process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import {
  wsfCallNext,
  wsfCancelTurn,
  wsfChallengePulse,
  wsfCombinedGoalPulse,
  wsfCommunityActivity,
  wsfCommunityMembers,
  wsfCompleteTurn,
  wsfContribute,
  wsfGoalPulse,
  wsfGoalRecentAdditions,
  wsfPreviewCommunity,
  wsfSendPasswordResetEmail,
  wsfStartTurn,
  wsfStationClaimPairing,
  wsfStationPairingStatus,
  wsfStationRequestPairing,
  wsfStationState,
  wsfTurnState,
} from '../../src/index';

/**
 * EVERY `invoker: 'public'` CALLABLE, READ FROM THE SOURCE RATHER THAN LISTED.
 *
 * This function is a correction. The first version of this probe walked a
 * HARDCODED list of six surfaces, and the report it fed said it covered "every
 * `invoker: 'public'` surface". That was not true: the head it ran against
 * already had seventeen, so eleven public callables were never driven at all.
 *
 * It is also exactly the defect I raised against somebody else's work in #393
 * (F1: a reach matrix walking a hardcoded array of job names rather than one
 * derived from the parsed workflow, so an added job is invisible to it). A
 * list that has to be kept in step by hand falls out of step, and the thing it
 * stops covering is precisely the thing that was just added.
 *
 * So the set is derived from `src/index.ts` and the coverage test below fails
 * when a public callable is not driven here. A new public surface now breaks
 * this probe until somebody points it at the surface.
 */
function declaredPublicCallables(): string[] {
  const src = readFileSync(path.resolve(__dirname, '../../src/index.ts'), 'utf8');
  const found: string[] = [];
  const parts = src.split(/\nexport const ([A-Za-z0-9_]+)\s*=\s*/);
  for (let i = 1; i < parts.length; i += 2) {
    const name = parts[i];
    // The options object precedes the handler; a generous window covers it
    // without reaching into the next export.
    if (/invoker:\s*['"]public['"]/.test(parts[i + 1].slice(0, 1500))) found.push(name);
  }
  return found.sort();
}

function uniq(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Identifying strings are built to be unmistakable on sight. A name like
 * 'Test User' could plausibly appear in a response for reasons that have
 * nothing to do with a leak; 'W5PROBEIDENTITYALPHA…' cannot.
 */
const RUN = Math.random().toString(36).slice(2, 8).toUpperCase();
const MEMBER_A = {
  uid: `W5PROBEUIDALPHA${RUN}`,
  displayName: `W5PROBEIDENTITYALPHA${RUN}`,
  email: `w5probealpha${RUN}@example.invalid`,
};
const MEMBER_B = {
  uid: `W5PROBEUIDBRAVO${RUN}`,
  displayName: `W5PROBEIDENTITYBRAVO${RUN}`,
  email: `w5probebravo${RUN}@example.invalid`,
};
const IDENTIFIERS = [
  MEMBER_A.uid,
  MEMBER_A.displayName,
  MEMBER_A.email,
  MEMBER_B.uid,
  MEMBER_B.displayName,
  MEMBER_B.email,
];

/**
 * Every string anywhere in a value — object keys included.
 *
 * KEYS MATTER AS MUCH AS VALUES. A response keyed by uid
 * (`{ "<uid>": { count: 4 } }`) publishes the uid just as surely as one that
 * lists it, and a scan of values alone would call that payload clean.
 */
function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) allStrings(v, out);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.push(k);
      allStrings(v, out);
    }
  }
  return out;
}

/** Case-insensitive, because a leak that lowercases a uid is still a leak. */
function identityIn(value: unknown): string[] {
  const hay = allStrings(value).join('\u0000').toUpperCase();
  return IDENTIFIERS.filter((id) => hay.includes(id.toUpperCase()));
}

type PublicCall = { name: string; call: () => Promise<unknown> };

/** An unauthenticated request — `auth` absent, exactly as a kiosk sends. */
function anonRequest(data: Record<string, unknown>): any {
  return {
    auth: undefined,
    data: data as any,
    rawRequest: { ip: '127.0.0.1', headers: {} } as any,
    acceptsStreaming: false,
  } as any;
}

/** Returns the payload on success and the thrown error on failure. Both are scanned. */
async function respond(fn: () => Promise<unknown>): Promise<{ outcome: string; body: unknown }> {
  try {
    return { outcome: 'resolved', body: await fn() };
  } catch (e) {
    const err = e as { code?: string; message?: string; details?: unknown };
    return {
      outcome: 'rejected',
      body: { code: err?.code, message: err?.message, details: err?.details },
    };
  }
}

let goalId = '';
let groupId = '';
let challengeId = '';
let setupId = '';
let joinCode = '';

describe('W5 probe — public/kiosk/display payloads carry no member identity', () => {
  beforeAll(async () => {
    const db = getFirestore();
    await db.doc('_warmup/sprint-w5-public-surface').set({ at: Date.now() });

    groupId = uniq('w5grp');
    challengeId = uniq('w5chal');
    setupId = uniq('w5setup');
    joinCode = `W5${RUN}`;

    const now = Date.now();
    const startsAt = Timestamp.fromDate(new Date(now - 60_000));
    const endsAt = Timestamp.fromDate(new Date(now + 60 * 60_000));

    await db.doc(`wsfCommunityGroups/${groupId}`).set({
      displayName: 'W5 probe community',
      groupType: 'custom',
      joinPolicy: 'public',
      joinCode,
      lifecycleStatus: 'active',
      isSample: false,
      createdAt: new Date(),
    });

    // Both members active, both with a profile carrying a display name, so a
    // surface that resolves names has something to resolve.
    for (const m of [MEMBER_A, MEMBER_B]) {
      await db.doc(`wsfMemberships/${groupId}_${m.uid}`).set({
        groupId,
        userId: m.uid,
        role: m === MEMBER_A ? 'foundingChampion' : 'member',
        membershipStatus: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await db.doc(`wsfMemberProfiles/${m.uid}`).set({
        displayName: m.displayName,
        email: m.email,
        updatedAt: new Date(),
      });
    }

    const goalRef = db.collection('wsfGoals').doc();
    goalId = goalRef.id;
    await goalRef.set({
      ownerUid: MEMBER_A.uid,
      communityGroupId: groupId,
      challengeId,
      title: 'W5 probe goal',
      target: 5000,
      unit: 'squats',
      status: 'active',
      startsAt,
      endsAt,
      timezone: 'America/New_York',
      createdAt: new Date(),
    });

    await db.doc(`wsfChallenges/${challengeId}`).set({
      communityGroupId: groupId,
      title: 'W5 probe challenge',
      status: 'active',
      startsAt,
      endsAt,
      timezone: 'America/New_York',
      createdAt: new Date(),
    });

    // REAL CONTRIBUTIONS, from both members, through the real callable. A
    // display strip that rebuilds rows from stored contribution documents can
    // only leak if those documents exist, so the probe makes them exist.
    for (const m of [MEMBER_A, MEMBER_B]) {
      await respond(() =>
        wsfContribute.run({
          auth: { uid: m.uid, token: { email_verified: true } as any } as any,
          data: { goalId, attemptId: uniq('w5att'), count: 25 } as any,
          rawRequest: {} as any,
          acceptsStreaming: false,
        } as any)
      );
    }
  }, 60_000);

  /**
   * One case per surface rather than a loop with a single assertion, so a
   * failure names the callable that leaked instead of "the sweep".
   */
  const surfaces = (): PublicCall[] => [
    { name: 'wsfGoalPulse', call: () => wsfGoalPulse.run(anonRequest({ goalId })) },
    {
      name: 'wsfGoalRecentAdditions',
      call: () => wsfGoalRecentAdditions.run(anonRequest({ goalId })),
    },
    { name: 'wsfChallengePulse', call: () => wsfChallengePulse.run(anonRequest({ challengeId })) },
    { name: 'wsfCombinedGoalPulse', call: () => wsfCombinedGoalPulse.run(anonRequest({ setupId })) },
    { name: 'wsfPreviewCommunity', call: () => wsfPreviewCommunity.run(anonRequest({ joinCode })) },
    {
      name: 'wsfStationState',
      call: () => wsfStationState.run(anonRequest({ stationId: groupId, secret: 'w5-probe-secret' })),
    },
    /*
      THE SOCIAL SURFACES. These are the two the community-presence work added,
      and they are the reason the hardcoded list had to go: they resolve member
      display names by design, for authenticated members of that community, and
      they carry `invoker: 'public'` — which governs who may reach the Cloud Run
      service, not who the function will answer. A real `groupId` is passed so
      the call does the work rather than bouncing on a missing argument.
    */
    {
      name: 'wsfCommunityMembers',
      call: () => wsfCommunityMembers.run(anonRequest({ groupId })),
    },
    {
      name: 'wsfCommunityActivity',
      call: () => wsfCommunityActivity.run(anonRequest({ groupId, goalId })),
    },
    /*
      THE REST OF THE DECLARED PUBLIC SET, never driven by the first version of
      this probe. Several need pairing or turn state this file does not build,
      so they will refuse — and a refusal is scanned exactly like a payload,
      which is the point: an error that names the member it refused on behalf of
      leaks as much as a list would.
    */
    { name: 'wsfTurnState', call: () => wsfTurnState.run(anonRequest({ stationId: groupId })) },
    {
      name: 'wsfStartTurn',
      call: () => wsfStartTurn.run(anonRequest({ stationId: groupId, secret: 'w5-probe-secret' })),
    },
    {
      name: 'wsfCallNext',
      call: () => wsfCallNext.run(anonRequest({ stationId: groupId, secret: 'w5-probe-secret' })),
    },
    {
      name: 'wsfCompleteTurn',
      call: () => wsfCompleteTurn.run(anonRequest({ stationId: groupId, secret: 'w5-probe-secret' })),
    },
    {
      name: 'wsfCancelTurn',
      call: () => wsfCancelTurn.run(anonRequest({ stationId: groupId, secret: 'w5-probe-secret' })),
    },
    {
      name: 'wsfStationRequestPairing',
      call: () => wsfStationRequestPairing.run(anonRequest({ goalId })),
    },
    {
      name: 'wsfStationPairingStatus',
      call: () => wsfStationPairingStatus.run(anonRequest({ pairingId: uniq('w5pair') })),
    },
    {
      name: 'wsfStationClaimPairing',
      call: () => wsfStationClaimPairing.run(anonRequest({ pairingId: uniq('w5pair') })),
    },
    /*
      Driven with a member's REAL address. A password-reset surface that echoes
      whether an address is known is an account-existence oracle, and the only
      way to see that is to ask it about somebody who exists.
    */
    {
      name: 'wsfSendPasswordResetEmail',
      call: () => wsfSendPasswordResetEmail.run(anonRequest({ email: MEMBER_A.email })),
    },
  ];

  for (const { name } of surfaces()) {
    test(`${name}: an unauthenticated response names neither member`, async () => {
      const surface = surfaces().find((s) => s.name === name)!;
      const { outcome, body } = await respond(surface.call);
      const leaked = identityIn(body);
      expect({ surface: name, outcome, leaked }).toEqual({
        surface: name,
        outcome,
        leaked: [],
      });
    }, 30_000);
  }

  /**
   * THE PROBE MUST BE ABLE TO FAIL. A detector that never fires proves nothing,
   * and every assertion above would pass vacuously if `identityIn` were broken
   * — so it is tested against a payload that genuinely carries each identifier,
   * in a value, in a key, and nested inside an array.
   */
  /*
    THE COVERAGE GUARD. Without this the file is a list that drifts, and the
    drift is silent: the surfaces it stops covering are the newly added ones.
  */
  test('every declared public callable is actually driven by this probe', () => {
    const declared = declaredPublicCallables();
    const driven = surfaces().map((s) => s.name).sort();
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((n) => !driven.includes(n))).toEqual([]);
  });

  test('the identity detector actually detects — keys, values and nesting', () => {
    expect(identityIn({ members: [{ displayName: MEMBER_A.displayName }] })).toEqual([
      MEMBER_A.displayName,
    ]);
    expect(identityIn({ [MEMBER_B.uid]: { count: 4 } })).toEqual([MEMBER_B.uid]);
    expect(identityIn({ msg: `refused for ${MEMBER_A.email}` })).toEqual([MEMBER_A.email]);
    expect(identityIn({ totals: { count: 50 }, additions: [{ amount: 25 }] })).toEqual([]);
  });
});
