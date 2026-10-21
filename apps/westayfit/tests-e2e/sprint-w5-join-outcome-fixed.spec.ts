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
 * W5 INDEPENDENT QA — THE FIXED SIDE OF THE LOST-RESPONSE JOIN.
 *
 * Sprint packet: PR #395 comments 5785415007 and 5785633689. Held against
 * W4's immutable revision `a760a4ed01f80c50a4aab9140414371eb4ceecc2` (PR
 * #417), a child of app head `44cc063`.
 *
 * SEPARATE FILE ON PURPOSE. `sprint-w5-join-response-lost.spec.ts` records
 * the BASELINE and asserts the false "Nothing was changed." claim. On this
 * revision that baseline MUST fail — that failure is the evidence the fix
 * works — so it is left exactly as it was rather than edited into agreement.
 * A baseline quietly rewritten to pass against the fix would destroy the only
 * record of what was wrong.
 *
 * The criteria are the ones W5 stated before seeing the patch:
 *   1. uncertainty wording, not a false no-change claim and not the definite
 *      "We couldn't join this community.";
 *   2. no raw server text ever reaches a pixel;
 *   3. one safe retry lands on the intended community or event;
 *   4. no duplicate membership.
 *
 * And one more, because W4's own summary claims it: a throw AFTER the call
 * succeeded must no longer be shown as a failed join.
 *
 * The premise is proven first here exactly as in the baseline: the real
 * `wsfJoinCommunity` runs, answers 200, and the membership is read back out
 * of Firestore BEFORE anything is asserted about the screen.
 */

const BASE_URL = process.env.WSF_PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5010';
const JOIN_CALLABLE = /wsfJoinCommunity/;

const FALSE_NO_CHANGE_CLAIM = 'Nothing was changed.';
const DEFINITE_REFUSAL_TITLE = 'We couldn’t join this community.';
const UNCONFIRMED_TITLE = 'We couldn’t confirm your join.';
const UNCONFIRMED_BODY = 'Check your connection, then try again.';

type Fixture = { email: string; password: string; uid: string; groupId: string; joinCode: string };

async function seedJoinableCommunity(): Promise<Fixture> {
  const stamp = stampId();
  const email = `w5.joinfix.${stamp}@example.invalid`;
  const password = 'w5-probe-passw0rd';
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, `W5 Join Fix ${stamp}`);
  const championUid = await seedVerifiedUser(`w5.fixchamp.${stamp}@example.invalid`, password);
  await seedProfile(championUid, `W5 Fix Champ ${stamp}`);
  const groupId = `w5jf_${stamp}`;
  const { joinCode } = await seedCommunity({
    groupId,
    displayName: 'W5 join-fix community',
    joinPolicy: 'public',
    members: [{ uid: championUid, role: 'foundingChampion' }],
  });
  return { email, password, uid, groupId, joinCode };
}

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

test.describe('W5 probe — the lost-response join on W4 a760a4e', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    userAgent: IPHONE_UA,
    isMobile: true,
    hasTouch: true,
    baseURL: BASE_URL,
  });

  test('a committed join whose answer was lost now reads as UNCONFIRMED, never as unchanged', async ({
    page,
  }) => {
    const f = await seedJoinableCommunity();
    const before = await activeMemberships(f.groupId);
    expect(before).toHaveLength(1);

    await signInAndOpenJoin(page, f);
    const { served } = loseTheResponseAfterCommit(page);
    await page.getByTestId('wsf-join-submit').click();

    // Premise first, exactly as in the baseline.
    expect(await served, 'the join must have reached the server').toBe(200);
    await expect
      .poll(async () => (await activeMemberships(f.groupId)).includes(`${f.groupId}_${f.uid}`), {
        timeout: 15_000,
        message: 'the membership must exist before the screen is judged',
      })
      .toBe(true);

    const card = page.getByTestId('wsf-join-submit-error');
    await expect(card).toBeVisible({ timeout: 20_000 });
    const rendered = ((await card.textContent()) || '').replace(/\s+/g, ' ').trim();

    expect(
      {
        saysNothingChanged: rendered.includes(FALSE_NO_CHANGE_CLAIM),
        saysDefiniteRefusal: rendered.includes(DEFINITE_REFUSAL_TITLE),
        saysUnconfirmedTitle: rendered.includes(UNCONFIRMED_TITLE),
        saysUnconfirmedBody: rendered.includes(UNCONFIRMED_BODY),
        activeMemberships: (await activeMemberships(f.groupId)).length,
      },
      `screen was: ${rendered}`
    ).toEqual({
      saysNothingChanged: false,
      saysDefiniteRefusal: false,
      saysUnconfirmedTitle: true,
      saysUnconfirmedBody: true,
      activeMemberships: 2,
    });
  });

  test('one safe retry lands on the intended community and adds no second membership', async ({
    page,
  }) => {
    const f = await seedJoinableCommunity();
    await signInAndOpenJoin(page, f);
    const { served } = loseTheResponseAfterCommit(page);
    await page.getByTestId('wsf-join-submit').click();
    expect(await served).toBe(200);
    await expect
      .poll(async () => (await activeMemberships(f.groupId)).includes(`${f.groupId}_${f.uid}`), { timeout: 15_000 })
      .toBe(true);
    await expect(page.getByTestId('wsf-join-submit-error')).toBeVisible({ timeout: 20_000 });

    await page.unroute(JOIN_CALLABLE);
    await page.getByTestId('wsf-join-submit').click();
    await page.waitForURL(new RegExp(`/community/${f.groupId}`), { timeout: 25_000 });

    expect({
      destination: new URL(page.url()).pathname,
      activeMemberships: (await activeMemberships(f.groupId)).length,
    }).toEqual({ destination: `/community/${f.groupId}`, activeMemberships: 2 });
  });

  test('NO RAW SERVER TEXT reaches a pixel, whatever the callable says', async ({ page }) => {
    /*
      The oracle risk the route's own comment names: this surface is reached by
      a stranger holding a link, so the callable's wording is unreviewed
      member-facing copy. An UNMAPPED code carrying a plausible-looking
      sentence is the case that once rendered verbatim.

      The error envelope is synthesised at the browser boundary — no backend
      change, and nothing is committed, which is fine because this criterion is
      about wording and not about commit state.
    */
    const f = await seedJoinableCommunity();
    await signInAndOpenJoin(page, f);

    const SERVER_SENTENCE = 'W5RAWSERVERTEXT join failed because the flux capacitor drifted';
    await page.route(JOIN_CALLABLE, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { status: 'INTERNAL', message: SERVER_SENTENCE } }),
      })
    );
    await page.getByTestId('wsf-join-submit').click();

    const card = page.getByTestId('wsf-join-submit-error');
    await expect(card).toBeVisible({ timeout: 20_000 });
    const rendered = ((await card.textContent()) || '').replace(/\s+/g, ' ').trim();
    const wholePage = ((await page.locator('body').textContent()) || '').replace(/\s+/g, ' ');

    expect({
      cardCarriesServerText: rendered.includes('W5RAWSERVERTEXT'),
      pageCarriesServerText: wholePage.includes('W5RAWSERVERTEXT'),
      saysUnconfirmed: rendered.includes(UNCONFIRMED_TITLE),
    }).toEqual({ cardCarriesServerText: false, pageCarriesServerText: false, saysUnconfirmed: true });
  });

  test('a throw AFTER the call succeeded is no longer shown as a failed join', async ({ page }) => {
    /*
      W4's summary claims the catch boundary now ends at the call, so a
      post-success throw cannot be presented as a failure. Testing the claim
      rather than trusting it: session storage is made to throw before the page
      loads, which is what `routeAfterJoin` reads through. The join itself is
      untouched and really succeeds.

      Expected: no failure card at all, and the member lands on the community.
      The event context is what is lost, which is the stated trade.
    */
    const f = await seedJoinableCommunity();
    await page.addInitScript(() => {
      const boom = () => {
        throw new Error('W5 induced storage failure');
      };
      try {
        Object.defineProperty(window, 'sessionStorage', {
          configurable: true,
          get: () => ({ getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom, length: 0 }),
        });
      } catch {
        /* a browser that will not allow the override simply runs the normal path */
      }
    });
    await signInAndOpenJoin(page, f);
    await page.getByTestId('wsf-join-submit').click();

    await page.waitForURL(new RegExp(`/community/${f.groupId}`), { timeout: 25_000 });
    expect({
      destination: new URL(page.url()).pathname,
      failureCardShown: (await page.getByTestId('wsf-join-submit-error').count()) > 0,
      activeMemberships: (await activeMemberships(f.groupId)).length,
    }).toEqual({ destination: `/community/${f.groupId}`, failureCardShown: false, activeMemberships: 2 });
  });
});
