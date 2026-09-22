import { expect, test, type Page } from '@playwright/test';

import {
  FIRESTORE_EMULATOR,
  IPHONE_UA,
  PROJECT_ID,
  seedCommunity,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * W5 INDEPENDENT QA — A JOIN WHOSE RESPONSE IS LOST **AFTER** THE SERVER
 * COMMITTED.
 *
 * Sprint packet: PR #395 comment 5785415007. Added alongside the existing
 * specs; no product or backend file is touched, and the narrow presentation
 * fix belongs to W4, not here.
 *
 * WHAT THE ROUTE CLAIMS, AND WHY THE CLAIM IS NARROWER THAN IT LOOKS.
 * `app/join/[joinCode].tsx` classifies a failed join by callable CODE and
 * falls back to
 *
 *   JOIN_FAILURE_DEFAULT = 'Nothing was changed. Check your connection and try again.'
 *
 * whose own comment says: "The default is safe to state as fact: the whole
 * join runs inside `db.runTransaction`, so a failure commits nothing."
 *
 * That reasoning is sound about the SERVER and says nothing about the wire.
 * A transaction that committed and a response that never arrived is not a
 * failure the transaction can roll back — the membership exists, and the
 * client, holding a transport error with no callable code, falls through
 * `callableCode(e) -> null` to the default and tells the member that nothing
 * was changed. That sentence is then false.
 *
 * WHY THIS TEST IS SHAPED THE WAY IT IS. A request aborted BEFORE it reaches
 * the server proves nothing at all — it is an ordinary failed join, the
 * default sentence is true, and a test that did that would "reproduce" the
 * bug by never triggering it. So the request is allowed through to the real
 * `wsfJoinCommunity` and only its RESPONSE is discarded at the browser
 * boundary, and the membership is read back from Firestore and asserted to
 * EXIST **before** a single assertion is made about what the screen says.
 * If that read ever fails, the test fails there, on its own premise, rather
 * than going on to report a UI finding it has not earned.
 *
 * RETIRED, AS THIS FILE SAID IT WOULD BE.
 *
 * The two cases that recorded the false claim are GONE — deleted, not edited.
 * W4's fix `a760a4ed01f80c50a4aab9140414371eb4ceecc2` reached this branch's
 * base in `d0477cc`, and from that moment those assertions described a build
 * that no longer exists. Softening them to agree with the fix would have left
 * a test that looked like a guard and guarded nothing; deleting them leaves
 * the record where it belongs, in the commit history and in the report.
 *
 * `sprint-w5-join-outcome-fixed.spec.ts` carries the guard now, and it is the
 * stricter one: it requires the uncertainty wording, no raw server text, a
 * safe retry and no duplicate membership.
 *
 * WHAT REMAINS HERE, AND WHY. The retry case below asserts behaviour that had
 * to survive the fix and did: a second press lands on the community and adds
 * no second membership. It was true before the fix and is true after, which
 * is exactly what makes it worth keeping — it is the part of the old
 * behaviour the correction was not allowed to break.
 */

const BASE_URL = process.env.WSF_PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5010';
const JOIN_CALLABLE = /wsfJoinCommunity/;

type Fixture = {
  email: string;
  password: string;
  uid: string;
  groupId: string;
  joinCode: string;
};

async function seedJoinableCommunity(): Promise<Fixture> {
  const stamp = stampId();
  const email = `w5.joinlost.${stamp}@example.invalid`;
  const password = 'w5-probe-passw0rd';
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, `W5 Join Lost ${stamp}`);

  // A Champion who is NOT the joiner, so the community is real and the
  // visitor is genuinely a non-member when the run starts.
  const championUid = await seedVerifiedUser(`w5.champ.${stamp}@example.invalid`, password);
  await seedProfile(championUid, `W5 Champ ${stamp}`);
  const groupId = `w5jl_${stamp}`;
  const { joinCode } = await seedCommunity({
    groupId,
    displayName: 'W5 join-lost community',
    joinPolicy: 'public',
    members: [{ uid: championUid, role: 'foundingChampion' }],
  });
  return { email, password, uid, groupId, joinCode };
}

/** Active membership documents for a group — the count that must not double. */
async function activeMemberships(groupId: string): Promise<string[]> {
  const url = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'wsfMemberships' }],
        where: {
          compositeFilter: {
            op: 'AND',
            filters: [
              { fieldFilter: { field: { fieldPath: 'groupId' }, op: 'EQUAL', value: { stringValue: groupId } } },
              { fieldFilter: { field: { fieldPath: 'membershipStatus' }, op: 'EQUAL', value: { stringValue: 'active' } } },
            ],
          },
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`membership query failed: ${res.status}`);
  const rows = (await res.json()) as { document?: { name: string } }[];
  return rows.filter((r) => r.document).map((r) => r.document!.name.split('/').pop()!);
}

/**
 * Let the join REACH the server, then throw its response away.
 *
 * `route.fetch()` performs the real request from the browser context, so the
 * callable runs and its transaction commits. Aborting afterwards means the
 * page sees a transport failure for a call the server already honoured —
 * which is the whole case. Returns a promise that resolves once the server
 * has actually answered, so the test can wait for the commit rather than
 * guess at it.
 */
function loseTheResponseAfterCommit(page: Page): { served: Promise<number> } {
  let resolveServed: (status: number) => void;
  const served = new Promise<number>((r) => {
    resolveServed = r;
  });
  void page.route(JOIN_CALLABLE, async (route) => {
    const response = await route.fetch();
    resolveServed(response.status());
    await route.abort('connectionfailed');
  });
  return { served };
}

async function signInAndOpenJoin(page: Page, f: Fixture): Promise<void> {
  await signInVia(page, f.email, f.password);
  await page.goto(`/join/${f.joinCode}`);
  await expect(page.getByTestId('wsf-join-submit')).toBeVisible({ timeout: 25_000 });
}

test.describe('W5 probe — a join whose response is lost after the server committed', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    userAgent: IPHONE_UA,
    isMobile: true,
    hasTouch: true,
    baseURL: BASE_URL,
  });

  test('BASELINE: one safe retry still lands on the community, and adds no second membership', async ({
    page,
  }) => {
    /*
      The other half of the member's real situation: having been told nothing
      changed, they press again. `wsfJoinCommunity` answers an active
      membership with `alreadyMember: true` inside the same transaction, so
      the retry must be harmless — one membership, one destination. This is
      recorded as the BASELINE behaviour so W4's fix can be held to it rather
      than accidentally regressing it while the wording changes.
    */
    const f = await seedJoinableCommunity();
    await signInAndOpenJoin(page, f);

    const { served } = loseTheResponseAfterCommit(page);
    await page.getByTestId('wsf-join-submit').click();
    expect(await served).toBe(200);
    await expect
      .poll(async () => (await activeMemberships(f.groupId)).includes(`${f.groupId}_${f.uid}`), {
        timeout: 15_000,
      })
      .toBe(true);
    await expect(page.getByTestId('wsf-join-submit-error')).toBeVisible({ timeout: 20_000 });

    // The retry goes through untouched — the member's second press.
    await page.unroute(JOIN_CALLABLE);
    await page.getByTestId('wsf-join-submit').click();

    await page.waitForURL(new RegExp(`/community/${f.groupId}`), { timeout: 25_000 });
    const after = await activeMemberships(f.groupId);
    expect(
      { destination: new URL(page.url()).pathname, activeMemberships: after.length },
      'the retry must land on the intended community and create no second membership'
    ).toEqual({ destination: `/community/${f.groupId}`, activeMemberships: 2 });
  });
});
