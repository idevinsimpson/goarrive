import { randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

/**
 * Package D — admission controls, driven through real authenticated browser
 * sessions against the isolated emulator suite (project `demo-wsf-local`).
 *
 * The callable suite
 * (functions-westayfit/tests/callable/wsf-admission-controls.test.ts) proves
 * the server decisions. This file exists because the packet's acceptance cases
 * are about what a person sees and can reach, and because reset, joining,
 * removal and departure interact — a link retired while a member is signed in,
 * a removal that has to close a screen that is already open.
 *
 * LABEL FOR THESE RESULTS:
 *   synthetic test evidence, local emulators, no physical device.
 * Accounts are created through the Auth emulator's admin API and memberships
 * are established BY JOINING, not by seeding, except where a fixture role is
 * named below. Nothing here is evidence about production data or hosted
 * behaviour.
 *
 * NOT COVERED, and not claimed: there is no member-management interface in
 * this package. Removal, voluntary departure, reinstatement and Champion
 * designation are callable-only, so this file drives them with the acting
 * person's own ID token and then asserts what the AFFECTED person's real
 * browser session can still reach. That is a real authenticated call by the
 * right account; it is not a screen, and no screen is claimed.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const FUNCTIONS_EMULATOR = 'http://127.0.0.1:5001';
const PROJECT_ID = 'demo-wsf-local';

type Account = { uid: string; email: string; password: string; idToken: string };

/** A verified account with a profile — the minimum to be allowed to join. */
async function seedAccount(label: string): Promise<Account> {
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const email = `d-${label}-${stamp}@example.com`;
  const password = `Dd1!${randomBytes(6).toString('hex')}`;
  const headers = { authorization: 'Bearer owner', 'content-type': 'application/json' };
  const base = `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1`;

  const signup = await fetch(`${base}/accounts:signUp?key=fake-api-key`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!signup.ok) throw new Error(`signUp failed: ${signup.status} ${await signup.text()}`);
  const { localId } = (await signup.json()) as { localId: string };

  const update = await fetch(`${base}/accounts:update`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ localId, emailVerified: true }),
  });
  if (!update.ok) throw new Error(`verify failed: ${update.status} ${await update.text()}`);

  // Re-sign-in so the token carries email_verified: true, which the join
  // callable requires. The token minted at signUp predates the flag.
  const signin = await fetch(`${base}/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!signin.ok) throw new Error(`signIn failed: ${signin.status} ${await signin.text()}`);
  const { idToken } = (await signin.json()) as { idToken: string };

  await firestoreWrite(`wsfMemberProfiles/${localId}`, {
    displayName: { stringValue: `D ${label}` },
  });

  return { uid: localId, email, password, idToken };
}

async function firestoreWrite(docPath: string, fields: Record<string, unknown>): Promise<void> {
  const url =
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}` +
    `/databases/(default)/documents/${docPath}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`write ${docPath} failed: ${res.status} ${await res.text()}`);
}

async function readMembershipStatus(groupId: string, uid: string): Promise<string | null> {
  const url =
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}` +
    `/databases/(default)/documents/wsfMemberships/${groupId}_${uid}`;
  const res = await fetch(url, { headers: { authorization: 'Bearer owner' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`read membership failed: ${res.status}`);
  const body = (await res.json()) as {
    fields?: { membershipStatus?: { stringValue?: string } };
  };
  return body.fields?.membershipStatus?.stringValue ?? null;
}

/**
 * Seed ONE community with ONE founding Champion. Every other membership in
 * these tests is created by that account actually joining, so the fixture
 * cannot accidentally hand someone a role the product would not have given
 * them.
 */
async function seedCommunity(opts: {
  championUid: string;
  joinPolicy: 'public' | 'inviteOnly' | 'private';
}): Promise<{ groupId: string; joinCode: string }> {
  const groupId = `dgrp-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const joinCode = randomBytes(12).toString('hex');
  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: 'D admission community' },
    groupType: { stringValue: 'custom' },
    joinPolicy: { stringValue: opts.joinPolicy },
    joinCode: { stringValue: joinCode },
    createdByUserId: { stringValue: opts.championUid },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
  });
  await firestoreWrite(`wsfMemberships/${groupId}_${opts.championUid}`, {
    groupId: { stringValue: groupId },
    userId: { stringValue: opts.championUid },
    role: { stringValue: 'foundingChampion' },
    membershipStatus: { stringValue: 'active' },
  });
  return { groupId, joinCode };
}

/**
 * Call a callable as a real signed-in account, over the same HTTP endpoint the
 * browser uses, with that account's own ID token. Used for the D actions that
 * have no interface in this package.
 */
async function callAs(
  account: Account,
  name: string,
  data: Record<string, unknown>
): Promise<unknown> {
  const res = await fetch(`${FUNCTIONS_EMULATOR}/${PROJECT_ID}/us-central1/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${account.idToken}`,
    },
    body: JSON.stringify({ data }),
  });
  const body = (await res.json()) as { result?: unknown; error?: { status?: string } };
  if (!res.ok || body.error) {
    throw new Error(`${name} refused: ${res.status} ${JSON.stringify(body.error ?? body)}`);
  }
  return body.result;
}

async function signInVia(page: Page, account: Account): Promise<void> {
  await page.goto('/signin');
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('wsf-signin-email').fill(account.email);
  await page.getByTestId('wsf-signin-password').fill(account.password);
  await page.getByTestId('wsf-signin-submit').click();
  await page.waitForURL(/\/(profile-setup)?$/, { timeout: 15_000 });
}

test.describe('D — admission controls in the interface', () => {
  test('D1 + D4: an inviteOnly link admits, a reset retires it for new joiners, and members stay', async ({
    browser,
  }) => {
    // Three DISTINCT accounts with distinct roles: the Champion who resets,
    // the member who joined on the old link, and a later joiner who will meet
    // the retired link. One account for two of these would make the "members
    // stay" assertion indistinguishable from "the resetter stays".
    const champion = await seedAccount('champ');
    const early = await seedAccount('early');
    const late = await seedAccount('late');
    expect(new Set([champion.uid, early.uid, late.uid]).size).toBe(3);

    const { groupId, joinCode } = await seedCommunity({
      championUid: champion.uid,
      joinPolicy: 'inviteOnly',
    });

    const ctxChampion = await browser.newContext();
    const ctxEarly = await browser.newContext();
    const ctxLate = await browser.newContext();
    const pageChampion = await ctxChampion.newPage();
    const pageEarly = await ctxEarly.newPage();
    const pageLate = await ctxLate.newPage();

    try {
      // ---- D4: the Champion of an inviteOnly community now gets a link ----
      // Before this package the invite block required joinPolicy === 'public',
      // so an inviteOnly Champion had a link they could not see or share.
      await signInVia(pageChampion, champion);
      await pageChampion.goto(`/community/${groupId}`);
      await expect(pageChampion.getByTestId('wsf-community')).toBeVisible({ timeout: 20_000 });
      await expect(pageChampion.getByTestId('wsf-community-role')).toContainText(
        'Founding Champion'
      );
      const originalLink = await pageChampion.getByTestId('wsf-community-invite-url').innerText();
      expect(originalLink).toContain(`/join/${joinCode}`);
      // The caveat states forwardability — the thing a person needs to know
      // before sharing a link that admits whoever holds it.
      await expect(pageChampion.getByTestId('wsf-community-invite-caveat')).toContainText(
        'forwarded'
      );

      // ---- the early member joins on that link, through the interface ----
      await signInVia(pageEarly, early);
      await pageEarly.goto(`/join/${joinCode}`);
      await expect(pageEarly.getByTestId('wsf-join-signed-in')).toBeVisible({ timeout: 20_000 });
      // D6: the preview states the joining conditions and NOT a head count.
      const meta = await pageEarly.getByTestId('wsf-join-meta').innerText();
      expect(meta).toContain('Anyone with this link can join');
      expect(meta).not.toMatch(/\d+\s+members?/);
      await pageEarly.getByTestId('wsf-join-submit').click();
      await pageEarly.waitForURL(new RegExp(`/community/${groupId}`), { timeout: 20_000 });
      await expect(pageEarly.getByTestId('wsf-community-role')).toContainText('Member');

      // ---- D1: the Champion resets the link ----
      await pageChampion.getByTestId('wsf-community-invite-reset').click();
      await expect(pageChampion.getByTestId('wsf-community-invite-reset-done')).toBeVisible({
        timeout: 20_000,
      });
      await expect(pageChampion.getByTestId('wsf-community-invite-reset-error')).toHaveCount(0);
      const newLink = await pageChampion.getByTestId('wsf-community-invite-url').innerText();
      expect(newLink).not.toBe(originalLink);

      // ---- the OLD link is now indistinguishable from an unknown one ----
      await signInVia(pageLate, late);
      await pageLate.goto(`/join/${joinCode}`);
      await expect(pageLate.getByTestId('wsf-join-invalid')).toBeVisible({ timeout: 20_000 });
      await expect(pageLate.getByTestId('wsf-join-signed-in')).toHaveCount(0);

      // ---- the NEW link admits ----
      const newCode = newLink.split('/join/')[1]!.trim();
      expect(newCode).not.toBe(joinCode);
      await pageLate.goto(`/join/${newCode}`);
      await expect(pageLate.getByTestId('wsf-join-signed-in')).toBeVisible({ timeout: 20_000 });
      await pageLate.getByTestId('wsf-join-submit').click();
      await pageLate.waitForURL(new RegExp(`/community/${groupId}`), { timeout: 20_000 });

      // ---- and the early member, who joined on the RETIRED link, is still in ----
      // A reset retires a link. It does not evict anybody.
      await pageEarly.reload();
      await expect(pageEarly.getByTestId('wsf-community-role')).toContainText('Member', {
        timeout: 20_000,
      });
      expect(await readMembershipStatus(groupId, early.uid)).toBe('active');
    } finally {
      await ctxChampion.close();
      await ctxEarly.close();
      await ctxLate.close();
    }
  });

  test('D2 + D3: removal closes the community screen, and a removed person cannot re-enter on the link', async ({
    browser,
  }) => {
    const champion = await seedAccount('rmchamp');
    const member = await seedAccount('rmmember');
    expect(champion.uid).not.toBe(member.uid);

    const { groupId, joinCode } = await seedCommunity({
      championUid: champion.uid,
      joinPolicy: 'inviteOnly',
    });

    const ctxMember = await browser.newContext();
    const pageMember = await ctxMember.newPage();
    try {
      // ---- the member joins for real ----
      await signInVia(pageMember, member);
      await pageMember.goto(`/join/${joinCode}`);
      await pageMember.getByTestId('wsf-join-submit').click();
      await pageMember.waitForURL(new RegExp(`/community/${groupId}`), { timeout: 20_000 });
      await expect(pageMember.getByTestId('wsf-community')).toBeVisible({ timeout: 20_000 });

      // ---- the Champion removes them (callable — no interface, see header) ----
      await callAs(champion, 'wsfRemoveMember', { groupId, targetUid: member.uid });
      expect(await readMembershipStatus(groupId, member.uid)).toBe('removed');

      // ---- their already-open session no longer reaches the community ----
      // This is the screen the membership gate used to leave open: the
      // document still EXISTS after removal, only its status changed.
      await pageMember.reload();
      await expect(pageMember.getByTestId('wsf-community-not-member')).toBeVisible({
        timeout: 20_000,
      });
      await expect(pageMember.getByTestId('wsf-community')).toHaveCount(0);

      // ---- and the link does not let them back in ----
      await pageMember.goto(`/join/${joinCode}`);
      await expect(pageMember.getByTestId('wsf-join-signed-in')).toBeVisible({ timeout: 20_000 });
      await pageMember.getByTestId('wsf-join-submit').click();
      // The refusal is the same "not valid" a stranger with a bad code gets:
      // it does not confirm that they were ever a member here.
      await expect(pageMember.getByTestId('wsf-join-submit-error')).toBeVisible({
        timeout: 20_000,
      });
      expect(await readMembershipStatus(groupId, member.uid)).toBe('removed');
    } finally {
      await ctxMember.close();
    }
  });

  test('D2 + D3: someone who leaves voluntarily can come back on the ordinary link', async ({
    browser,
  }) => {
    const champion = await seedAccount('lvchamp');
    const member = await seedAccount('lvmember');
    expect(champion.uid).not.toBe(member.uid);

    const { groupId, joinCode } = await seedCommunity({
      championUid: champion.uid,
      joinPolicy: 'inviteOnly',
    });

    const ctxMember = await browser.newContext();
    const pageMember = await ctxMember.newPage();
    try {
      await signInVia(pageMember, member);
      await pageMember.goto(`/join/${joinCode}`);
      await pageMember.getByTestId('wsf-join-submit').click();
      await pageMember.waitForURL(new RegExp(`/community/${groupId}`), { timeout: 20_000 });

      // ---- they leave of their own accord, THROUGH THE INTERFACE ----
      // This is a real click on a real control, not a callable invocation.
      // Leaving is the one membership action that can be finished in this
      // package, because it acts on the caller themselves and needs no way to
      // identify anybody else.
      await expect(pageMember.getByTestId('wsf-community-leave')).toBeVisible({ timeout: 20_000 });
      await pageMember.getByTestId('wsf-community-leave').click();
      // It asks first, and the confirmation states what leaving does and does
      // not do — in particular that past contributions stay counted.
      await expect(pageMember.getByTestId('wsf-community-leave-confirm')).toContainText(
        'stays counted'
      );
      // Backing out really backs out.
      await pageMember.getByTestId('wsf-community-leave-cancel').click();
      await expect(pageMember.getByTestId('wsf-community-leave-confirm')).toHaveCount(0);
      expect(await readMembershipStatus(groupId, member.uid)).toBe('active');

      await pageMember.getByTestId('wsf-community-leave').click();
      await pageMember.getByTestId('wsf-community-leave-confirm-yes').click();
      await pageMember.waitForURL(/\/$/, { timeout: 20_000 });
      expect(await readMembershipStatus(groupId, member.uid)).toBe('departed');

      // Leaving returns them to home, so navigate back deliberately: the
      // community screen must close for them too. Departure is not removal,
      // but a departed person is not a current member either.
      await pageMember.goto(`/community/${groupId}`);
      await expect(pageMember.getByTestId('wsf-community-not-member')).toBeVisible({
        timeout: 20_000,
      });

      // ---- and coming back is the ORDINARY path, with no Champion action ----
      await pageMember.goto(`/join/${joinCode}`);
      await expect(pageMember.getByTestId('wsf-join-signed-in')).toBeVisible({ timeout: 20_000 });
      await pageMember.getByTestId('wsf-join-submit').click();
      await pageMember.waitForURL(new RegExp(`/community/${groupId}`), { timeout: 20_000 });
      await expect(pageMember.getByTestId('wsf-community-role')).toContainText('Member', {
        timeout: 20_000,
      });
      expect(await readMembershipStatus(groupId, member.uid)).toBe('active');
    } finally {
      await ctxMember.close();
    }
  });

  test('D7 through the interface: the only Champion is refused when they try to leave, and told why', async ({
    browser,
  }) => {
    // The refusal is surfaced verbatim rather than by disabling the button:
    // a greyed-out control cannot say what has to happen first.
    const champion = await seedAccount('solochamp');
    const { groupId, joinCode } = await seedCommunity({
      championUid: champion.uid,
      joinPolicy: 'inviteOnly',
    });
    // A second, ordinary member so the community is not a single-person case —
    // the guard is about CHAMPIONS, not about members.
    const member = await seedAccount('solomember');

    const ctxM = await browser.newContext();
    const pageM = await ctxM.newPage();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await signInVia(pageM, member);
      await pageM.goto(`/join/${joinCode}`);
      await pageM.getByTestId('wsf-join-submit').click();
      await pageM.waitForURL(new RegExp(`/community/${groupId}`), { timeout: 20_000 });

      await signInVia(page, champion);
      await page.goto(`/community/${groupId}`);
      await expect(page.getByTestId('wsf-community-role')).toContainText('Founding Champion');
      await page.getByTestId('wsf-community-leave').click();
      await page.getByTestId('wsf-community-leave-confirm-yes').click();

      // Refused, and the message names the remedy.
      await expect(page.getByTestId('wsf-community-leave-error')).toContainText(
        'only Champion',
        { timeout: 20_000 }
      );
      await expect(page.getByTestId('wsf-community-leave-error')).toContainText(
        'Designate another Champion'
      );
      // Still a Champion, still in the community.
      expect(await readMembershipStatus(groupId, champion.uid)).toBe('active');

      // NOT DELIVERED, pinned so it cannot be mistaken for delivered: there is
      // no control anywhere to designate that other Champion, so the remedy
      // the message names cannot be carried out in the product. Finishing it
      // needs a way to identify another member's account, which this package
      // does not have and did not invent.
      await expect(page.getByTestId('wsf-community-designate-champion')).toHaveCount(0);
      await expect(page.getByTestId('wsf-community-remove-member')).toHaveCount(0);
      await expect(page.getByTestId('wsf-community-reinstate-member')).toHaveCount(0);
    } finally {
      await ctx.close();
      await ctxM.close();
    }
  });

  test('D5 NOT DELIVERED: no screen offers a private community a way to admit anyone', async ({
    browser,
  }) => {
    // Private invitations are not delivered in this package (see the handoff).
    // The consequence is stated here as an executable fact rather than prose:
    // a private community's Champion is offered NO admission control at all,
    // and the tier therefore cannot admit anyone. This test is the guard that
    // no half-built "add member" affordance appears while the binding
    // mechanism is still missing.
    const champion = await seedAccount('pvchamp');
    const outsider = await seedAccount('pvout');
    const { groupId, joinCode } = await seedCommunity({
      championUid: champion.uid,
      joinPolicy: 'private',
    });

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const ctxOut = await browser.newContext();
    const pageOut = await ctxOut.newPage();
    try {
      await signInVia(page, champion);
      await page.goto(`/community/${groupId}`);
      await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('wsf-community-role')).toContainText('Founding Champion');

      // No link — a general link never admits to a private community…
      await expect(page.getByTestId('wsf-community-invite-url')).toHaveCount(0);
      await expect(page.getByTestId('wsf-community-invite-reset')).toHaveCount(0);
      // …and no individual-invitation control exists to take its place.
      await expect(page.getByTestId('wsf-community-invite-member')).toHaveCount(0);
      await expect(page.getByTestId('wsf-community-add-member')).toHaveCount(0);

      // Even holding the stored code, an outsider is refused, and learns
      // nothing about whether the community exists.
      await signInVia(pageOut, outsider);
      await pageOut.goto(`/join/${joinCode}`);
      await expect(pageOut.getByTestId('wsf-join-invalid')).toBeVisible({ timeout: 20_000 });
      expect(await readMembershipStatus(groupId, outsider.uid)).toBeNull();
    } finally {
      await ctx.close();
      await ctxOut.close();
    }
  });
});
