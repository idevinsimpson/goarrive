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
 * WHEN THE FIX REACHES THIS BRANCH'S BASE, THIS FILE RETIRES.
 *
 * It records PRE-FIX behaviour and passes only while the base still carries
 * it. Verified against W4's `a760a4ed01f80c50a4aab9140414371eb4ceecc2` (PR
 * #417): the first case and the control both fail there, because the route no
 * longer claims anything it cannot know. That failure is the evidence the fix
 * works, so the assertions are deliberately NOT softened to agree with it — a
 * baseline rewritten to pass against the fix destroys the only record of what
 * was wrong.
 *
 * So when `a760a4e` lands in this branch's base, the two claim-recording cases
 * here are deleted, not edited, and `sprint-w5-join-outcome-fixed.spec.ts`
 * carries the guard from then on. The retry case is the exception: it asserts
 * behaviour that must survive the fix and is already proven to, so it stays.
 */

const BASE_URL = process.env.WSF_PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5010';
const JOIN_CALLABLE = /wsfJoinCommunity/;

/** The exact sentence under test, quoted from the route rather than paraphrased. */
const FALSE_NO_CHANGE_CLAIM = 'Nothing was changed.';

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

  test('BASELINE: the membership exists on the server, and the screen is recorded verbatim', async ({
    page,
  }) => {
    const f = await seedJoinableCommunity();

    const before = await activeMemberships(f.groupId);
    expect(before, 'the visitor must start as a non-member').not.toContain(`${f.groupId}_${f.uid}`);
    expect(before).toHaveLength(1); // the Champion only

    await signInAndOpenJoin(page, f);
    const { served } = loseTheResponseAfterCommit(page);
    await page.getByTestId('wsf-join-submit').click();

    // THE PREMISE, PROVEN FIRST. If the server did not commit, nothing below
    // is a finding and this test must fail here rather than report one.
    const status = await served;
    expect(status, 'the callable must have answered — otherwise the join never reached the server').toBe(200);

    await expect
      .poll(async () => (await activeMemberships(f.groupId)).includes(`${f.groupId}_${f.uid}`), {
        timeout: 15_000,
        message: 'the membership must exist on the server before the UI is judged',
      })
      .toBe(true);

    const after = await activeMemberships(f.groupId);
    expect(after).toHaveLength(2); // Champion + the visitor who just joined

    // Only now: what does the member actually see?
    const card = page.getByTestId('wsf-join-submit-error');
    await expect(card).toBeVisible({ timeout: 20_000 });
    const rendered = ((await card.textContent()) || '').replace(/\s+/g, ' ').trim();

    /*
      RECORDED, NOT ASSERTED AWAY. The baseline's job is to state what the
      shipped route says while the membership demonstrably exists. The
      assertion is written so the failure message carries the sentence
      verbatim into the report.
    */
    expect(
      {
        membershipExists: true,
        activeMemberships: after.length,
        screen: rendered,
      },
      'BASELINE RECORD — the join committed; this is what the screen claimed'
    ).toEqual({
      membershipExists: true,
      activeMemberships: 2,
      screen: expect.stringContaining(FALSE_NO_CHANGE_CLAIM),
    });
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

  test('CONTROL: a join aborted BEFORE the server sees it commits nothing, so the default sentence is true there', async ({
    page,
  }) => {
    /*
      THE CONTROL THAT KEEPS THE FINDING HONEST. The same screen, the same
      sentence, and this time it is correct — because the request never
      reached the server and the membership genuinely does not exist. Without
      this, the baseline above could be read as "the default copy is always
      wrong", which is not the finding and would send W4 after the wrong fix.
    */
    const f = await seedJoinableCommunity();
    await signInAndOpenJoin(page, f);

    await page.route(JOIN_CALLABLE, (route) => route.abort('connectionfailed'));
    await page.getByTestId('wsf-join-submit').click();

    const card = page.getByTestId('wsf-join-submit-error');
    await expect(card).toBeVisible({ timeout: 20_000 });
    const rendered = ((await card.textContent()) || '').replace(/\s+/g, ' ').trim();

    const after = await activeMemberships(f.groupId);
    expect(
      { membershipExists: after.includes(`${f.groupId}_${f.uid}`), saysNothingChanged: rendered.includes(FALSE_NO_CHANGE_CLAIM) },
      'aborted before the server: nothing committed, so the sentence is accurate'
    ).toEqual({ membershipExists: false, saysNothingChanged: true });
  });
});
