import { randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { FIRESTORE_EMULATOR, PROJECT_ID, seedProfile, seedVerifiedUser, signInVia, stampId } from './helpers/mobile';

/**
 * W7 — THE COLD DIRECT MEMBERS LOAD, on integration candidate **`9a65324`**.
 *
 * Check 5 found that the members rewrite had been added to
 * `firebase.westayfit.json` but not to `firebase.westayfit.emulators.json`,
 * whose own comment says the two must mirror or "the harness stops testing
 * what actually ships". The bytes proved it — the emulator served the
 * `/community/**` fallback — while the rendered outcome was correct, because
 * the SPA resolves the path on hydration. The Director ruled that a real
 * harness-parity defect "even though hydration masks it", and L0 landed the
 * one-line mirror as `1041a1f`.
 *
 * This file is the proof that the fix works, and it deliberately checks the
 * thing that the byte test cannot: that the route resolving for a member does
 * not mean it resolves for ANYBODY. A rewrite is a routing change, not an
 * authorization change, and the way to be sure of that is to ask a
 * non-member.
 *
 * The byte half lives in the report rather than here, because it is a property
 * of the emulator's own config rather than of the app: a cold
 * `GET /community/<id>/members` now serves `members.html` and not the
 * fallback, the challenge route still serves `challenge.html`, and bare
 * `/community/<id>` still serves the catch-all.
 */

const OWNER = { authorization: 'Bearer owner', 'content-type': 'application/json' };
const ts = (d: Date) => ({ timestampValue: d.toISOString() });

async function write(docPath: string, fields: Record<string, unknown>): Promise<void> {
  const res = await fetch(
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}`,
    { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields }) },
  );
  if (!res.ok) throw new Error(`write ${docPath} failed: ${res.status} ${await res.text()}`);
}

type Person = { uid: string; email: string; password: string; name: string };

async function person(tag: string, name: string): Promise<Person> {
  const email = `wsf-w7mp-${tag}-${stampId()}@example.com`;
  const password = `Aa1!${randomBytes(6).toString('hex')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, name);
  return { uid, email, password, name };
}

async function membership(groupId: string, uid: string, role: 'foundingChampion' | 'member'): Promise<void> {
  const now = new Date();
  await write(`wsfMemberships/${groupId}_${uid}`, {
    groupId: { stringValue: groupId },
    userId: { stringValue: uid },
    role: { stringValue: role },
    membershipStatus: { stringValue: 'active' },
    createdAt: ts(now),
    updatedAt: ts(now),
  });
}

async function community(groupId: string, createdBy: string): Promise<void> {
  const now = new Date();
  await write(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: 'Maple Street Movers' },
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

/** A community with three named members, so a leak would have something to leak. */
async function scene(): Promise<{ champ: Person; groupId: string; names: string[] }> {
  const champ = await person('champ', 'Ada Champion');
  const groupId = `w7mp-${stampId()}`;
  await community(groupId, champ.uid);
  await membership(groupId, champ.uid, 'foundingChampion');
  const names = ['Ada Champion'];
  for (const n of ['Dana Whitfield', 'Ray Okafor']) {
    const p = await person('m', n);
    await membership(groupId, p.uid, 'member');
    names.push(n);
  }
  return { champ, groupId, names };
}

test.describe('W7 — the members route on integration candidate 9a65324', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /**
   * THE FIX, AS A MEMBER SEES IT. A cold navigation — not an in-app one — to
   * the real route renders the real screen, with the real people on it.
   */
  test('a cold direct load renders the members screen for a member', async ({ page }) => {
    test.setTimeout(180_000);
    const { champ, groupId, names } = await scene();
    await signInVia(page, champ.email, champ.password);

    await page.goto(`/community/${groupId}/members`);
    await expect(
      page.getByTestId('wsf-members-screen'),
      'a cold direct load did not render the members screen',
    ).toBeVisible({ timeout: 25_000 });
    expect(new URL(page.url()).pathname).toBe(`/community/${groupId}/members`);

    await expect(page.getByTestId('wsf-members-panel')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId('wsf-members-count')).toHaveText('3 members');
    const body = await page.locator('body').innerText();
    for (const n of names) {
      expect(body, `${n} is missing from the members list`).toContain(n);
    }
  });

  /**
   * AND THE PART A BYTE TEST CANNOT SEE: a rewrite is a routing change, not an
   * authorization change. The same cold URL, from somebody who is not in this
   * community, must not become a way to read it.
   */
  test('the same cold load refuses a non-member, and names nobody', async ({ page }) => {
    test.setTimeout(180_000);
    const { groupId, names } = await scene();
    const outsider = await person('out', 'Gus Outsider');
    expect(outsider.uid).toBeTruthy();
    await signInVia(page, outsider.email, outsider.password);

    await page.goto(`/community/${groupId}/members`);
    await expect(page.getByTestId('wsf-members-screen')).toBeVisible({ timeout: 25_000 });
    // The screen shell may render; the PEOPLE must not.
    await expect(
      page.getByTestId('wsf-members-failed'),
      'a non-member was not refused on the members route',
    ).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId('wsf-members-panel')).toHaveCount(0);
    expect(await page.getByTestId('wsf-member-row').count()).toBe(0);

    const body = await page.locator('body').innerText();
    for (const n of names) {
      expect(body, `the members route leaked ${n} to a non-member`).not.toContain(n);
    }
    expect(body, 'the members route leaked the community name to a non-member').not.toContain(
      'Maple Street Movers',
    );
  });

  /** And signed out, the same URL reveals nothing either. */
  test('the same cold load reveals nothing to a signed-out visitor', async ({ page }) => {
    test.setTimeout(180_000);
    const { groupId, names } = await scene();

    await page.goto(`/community/${groupId}/members`);
    // Whatever it renders, it is not the list.
    await expect(page.getByTestId('wsf-members-panel')).toHaveCount(0, { timeout: 25_000 });
    expect(await page.getByTestId('wsf-member-row').count()).toBe(0);
    const body = await page.locator('body').innerText();
    for (const n of names) {
      expect(body, `the members route leaked ${n} to a signed-out visitor`).not.toContain(n);
    }
  });

  /**
   * THE NEW REWRITE DID NOT SHADOW ITS NEIGHBOURS. The members rewrite sits
   * between the challenge one and the `/community` catch-all, so the community
   * page itself must still load cold.
   */
  test('the community page itself still loads cold, unshadowed by the new rewrite', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { champ, groupId } = await scene();
    await signInVia(page, champ.email, champ.password);

    await page.goto(`/community/${groupId}`);
    await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 25_000 });
    expect(new URL(page.url()).pathname).toBe(`/community/${groupId}`);
    await expect(page.getByTestId('wsf-members-screen')).toHaveCount(0);
  });
});
