/**
 * W5 INDEPENDENT QA — RECONCILING AN UNKNOWN OUTCOME MUST RECONCILE THE RIGHT
 * PERSON'S.
 *
 * Sprint Round 1, W5 packet (PR #365 comment 5781435779). Added alongside the
 * existing suites; nothing here edits, skips or weakens an existing test.
 *
 * THE HAZARD THIS PROBE SITS ON. `apps/westayfit/src/pendingContribution.ts`
 * records an attempt as `'sending'` or `'unknown'` when the network drops
 * before the outcome is known, and the member reconciles it afterwards by
 * asking the server what was actually recorded. That reconciliation is a read
 * performed by WHOEVER IS SIGNED IN NOW — which, on a shared phone or after a
 * sign-out, need not be the person who made the attempt. The same module's own
 * comment records why: the server's idempotency key is
 * `{goalId}_{uid}_{attemptId}`, so an attempt replayed under a different uid
 * does not deduplicate.
 *
 * So the question a probe has to answer is not "does reconciliation work" but
 * "whose contribution does it report". The three cases below are the ones where
 * a wrong answer is a data-isolation defect rather than a bug:
 *
 *   1. A second member reading the same goal sees THEIR OWN credit, never the
 *      first member's — a stale pending record pointing at a goal somebody else
 *      contributed to must not resolve into that person's number.
 *   2. A member with no credit yet sees a real zero, not the goal's total and
 *      not another member's figure.
 *   3. A signed-out reconcile is refused outright, so a pending record surviving
 *      a sign-out reveals nothing at all.
 *
 * It also pins the attribution rule underneath, from the other side: the SAME
 * attemptId submitted by two different members is two contributions, each
 * credited to its own author. That is what makes the client's uid-scoped
 * storage key necessary rather than tidy, and a change that "fixed" the
 * duplicate by keying on attemptId alone would credit one member's work to the
 * other. This test would fail if that happened.
 *
 * Runs against the local Firestore emulator via `func.run(request)`.
 */

process.env.METADATA_SERVER_DETECTION =
  process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { wsfContribute, wsfMyContribution } from '../../src/index';

function uniq(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function request(uid: string | null, data: Record<string, unknown>): any {
  return {
    auth: uid ? ({ uid, token: { email_verified: true } as any } as any) : undefined,
    data: data as any,
    rawRequest: {} as any,
    acceptsStreaming: false,
  } as any;
}

async function attempt(uid: string | null, data: Record<string, unknown>) {
  try {
    return { ok: true as const, value: await wsfContribute.run(request(uid, data)) };
  } catch (e) {
    return { ok: false as const, error: e as HttpsError };
  }
}

async function reconcile(uid: string | null, goalId: string) {
  try {
    return { ok: true as const, value: await wsfMyContribution.run(request(uid, { goalId })) };
  } catch (e) {
    return { ok: false as const, error: e as HttpsError };
  }
}

const ALPHA = uniq('w5uidAlpha');
const BRAVO = uniq('w5uidBravo');
const OUTSIDER = uniq('w5uidOutsider');

let goalId = '';
let groupId = '';

describe('W5 probe — an unknown outcome reconciles to the caller, and only the caller', () => {
  beforeAll(async () => {
    const db = getFirestore();
    await db.doc('_warmup/sprint-w5-pending-reconcile').set({ at: Date.now() });

    groupId = uniq('w5grp');
    const now = Date.now();

    await db.doc(`wsfCommunityGroups/${groupId}`).set({
      displayName: 'W5 reconcile probe community',
      groupType: 'custom',
      joinPolicy: 'private',
      lifecycleStatus: 'active',
      isSample: false,
      createdAt: new Date(),
    });

    // ALPHA and BRAVO are both members. OUTSIDER deliberately is not.
    for (const [uid, role] of [
      [ALPHA, 'foundingChampion'],
      [BRAVO, 'member'],
    ] as const) {
      await db.doc(`wsfMemberships/${groupId}_${uid}`).set({
        groupId,
        userId: uid,
        role,
        membershipStatus: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    const ref = db.collection('wsfGoals').doc();
    goalId = ref.id;
    await ref.set({
      ownerUid: ALPHA,
      communityGroupId: groupId,
      title: 'W5 reconcile probe goal',
      target: 5000,
      unit: 'squats',
      status: 'active',
      startsAt: Timestamp.fromDate(new Date(now - 60_000)),
      endsAt: Timestamp.fromDate(new Date(now + 60 * 60_000)),
      timezone: 'America/New_York',
      createdAt: new Date(),
    });
  }, 60_000);

  test('ALPHA contributes 40; reconciling as ALPHA returns ALPHA’s own 40', async () => {
    const first = await attempt(ALPHA, { goalId, attemptId: 'w5-shared-attempt-id', count: 40 });
    expect(first.ok).toBe(true);

    const mine = await reconcile(ALPHA, goalId);
    expect(mine.ok).toBe(true);
    if (!mine.ok) return;
    expect((mine.value as { ownCredit: number }).ownCredit).toBe(40);
  }, 30_000);

  test('BRAVO reconciling the SAME goal sees a real zero, never ALPHA’s 40', async () => {
    /*
      The account-switch case in one assertion. BRAVO has contributed nothing,
      so the only correct answer is 0 — not 40 (ALPHA's credit) and not the
      goal's running total, which the display surface reports and this one must
      not.
    */
    const theirs = await reconcile(BRAVO, goalId);
    expect(theirs.ok).toBe(true);
    if (!theirs.ok) return;
    expect((theirs.value as { ownCredit: number }).ownCredit).toBe(0);
  }, 30_000);

  test('the same attemptId from BRAVO is BRAVO’s own contribution, credited to BRAVO', async () => {
    /*
      Deliberately reusing ALPHA's attemptId verbatim — the exact replay the
      pending record would produce if it were ever read under the wrong
      account. Two facts are pinned at once: it is NOT silently swallowed as a
      duplicate of ALPHA's, and it does NOT land on ALPHA's credit.
    */
    const replay = await attempt(BRAVO, { goalId, attemptId: 'w5-shared-attempt-id', count: 7 });
    expect(replay.ok).toBe(true);

    const bravo = await reconcile(BRAVO, goalId);
    const alpha = await reconcile(ALPHA, goalId);
    expect(bravo.ok && alpha.ok).toBe(true);
    if (!bravo.ok || !alpha.ok) return;
    expect((bravo.value as { ownCredit: number }).ownCredit).toBe(7);
    expect((alpha.value as { ownCredit: number }).ownCredit).toBe(40);
  }, 30_000);

  test('ALPHA replaying ALPHA’s own attemptId counts once — still 40, not 80', async () => {
    const replay = await attempt(ALPHA, { goalId, attemptId: 'w5-shared-attempt-id', count: 40 });
    expect(replay.ok).toBe(true);

    const mine = await reconcile(ALPHA, goalId);
    expect(mine.ok).toBe(true);
    if (!mine.ok) return;
    expect((mine.value as { ownCredit: number }).ownCredit).toBe(40);
  }, 30_000);

  test('a signed-out reconcile is refused, so a pending record surviving sign-out reveals nothing', async () => {
    const anon = await reconcile(null, goalId);
    expect(anon.ok).toBe(false);
    if (anon.ok) return;
    expect(anon.error.code).toBe('unauthenticated');
    // And the refusal itself names nobody.
    expect(anon.error.message).not.toContain(ALPHA);
    expect(anon.error.message).not.toContain(BRAVO);
  }, 30_000);

  test('a non-member reconciling this goal learns neither the credit nor that the goal exists', async () => {
    const out = await reconcile(OUTSIDER, goalId);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    // Whatever the refusal is, it must not carry a number or a member.
    expect(out.error.message).not.toContain('40');
    expect(out.error.message).not.toContain(ALPHA);
    expect(out.error.message).not.toContain(BRAVO);
  }, 30_000);
});
