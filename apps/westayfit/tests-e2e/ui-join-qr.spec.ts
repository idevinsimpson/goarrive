import { randomBytes } from 'node:crypto';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * JOIN BY QR — the Champion's copy of the invite link, as something a phone
 * can scan.
 *
 * The properties under test are the ones that make this safe to ship, not the
 * ones that make it look finished:
 *
 *   Q-1  a Champion of a link-joinable community sees a QR and the URL it
 *        encodes, and the encoded URL is EXACTLY the invite link the Copy
 *        control produces — not a variant, not a shortener, not a new scheme.
 *   Q-2  an ordinary member has the Invite card and its own QR (candidate D:
 *        inviting is not a Champion privilege), but never the Champion's
 *        Manage QR section, which lives inside a sheet a member cannot open.
 *   Q-3  a signed-in non-member never sees it — they never reach the screen.
 *   Q-4  creating a new invite link changes the encoded URL, and only after
 *        the Champion confirms it. A printed code that outlives its reset is
 *        the failure that matters here: the Champion would believe the old
 *        flyer is dead.
 *   Q-5  a private community renders no QR — it renders the sentence saying
 *        why, on the Invite card and inside Manage. A private group must not
 *        acquire a working invite link because the UI happened to have a
 *        joinCode in hand.
 *
 * `data-qr-url` on the symbol carries the string the encoder was handed. That
 * is deliberately an attribute and not an image comparison: what matters is
 * WHICH URL got encoded, and a pixel diff of a QR answers a different, weaker
 * question. The invite link itself is never printed as body copy any more; the
 * Invite card carries it as `data-invite-url`, and that attribute is what the
 * QR's encoded string is compared against.
 *
 * Helpers are copied from ui-champion-torture.spec.ts rather than imported —
 * a spec file that imports another spec file runs it.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'demo-wsf-local';

async function seedVerifiedUser(email: string, password: string): Promise<string> {
  const headers = { authorization: 'Bearer owner', 'content-type': 'application/json' };
  const base = `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1`;
  const signup = await fetch(`${base}/accounts:signUp?key=fake-api-key`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!signup.ok) throw new Error(`emulator signUp failed: ${signup.status} ${await signup.text()}`);
  const { localId } = (await signup.json()) as { localId: string };
  const update = await fetch(`${base}/accounts:update`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ localId, emailVerified: true }),
  });
  if (!update.ok) throw new Error(`emulator verify failed: ${update.status} ${await update.text()}`);
  return localId;
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
  if (!res.ok) {
    throw new Error(`emulator write ${docPath} failed: ${res.status} ${await res.text()}`);
  }
}

/** The STORED join code, read from the emulator rather than from the screen. */
async function readJoinCode(groupId: string): Promise<string> {
  const url =
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}` +
    `/databases/(default)/documents/wsfCommunityGroups/${groupId}`;
  const res = await fetch(url, { headers: { authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`emulator read failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { fields?: { joinCode?: { stringValue?: string } } };
  const code = body.fields?.joinCode?.stringValue;
  if (!code) throw new Error(`group ${groupId} has no joinCode`);
  return code;
}

function tsField(d: Date): { timestampValue: string } {
  return { timestampValue: d.toISOString() };
}

type Fixture = {
  groupId: string;
  joinCode: string;
  championEmail: string;
  memberEmail: string;
  outsiderEmail: string;
  password: string;
};

async function seedFixture(tag: string, joinPolicy: string): Promise<Fixture> {
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const password = 'qr-spec-password';
  const championEmail = `wsf-qr-champ-${tag}-${stamp}@example.com`;
  const memberEmail = `wsf-qr-member-${tag}-${stamp}@example.com`;
  const outsiderEmail = `wsf-qr-out-${tag}-${stamp}@example.com`;
  const championUid = await seedVerifiedUser(championEmail, password);
  const memberUid = await seedVerifiedUser(memberEmail, password);
  const outsiderUid = await seedVerifiedUser(outsiderEmail, password);

  const now = new Date();
  const groupId = `qrgrp-${stamp}`;
  const joinCode = randomBytes(16).toString('base64url');

  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: 'QR spec community' },
    groupType: { stringValue: 'custom' },
    joinPolicy: { stringValue: joinPolicy },
    joinCode: { stringValue: joinCode },
    createdByUserId: { stringValue: championUid },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });

  for (const [uid, role] of [
    [championUid, 'foundingChampion'],
    [memberUid, 'member'],
  ] as const) {
    await firestoreWrite(`wsfMemberships/${groupId}_${uid}`, {
      groupId: { stringValue: groupId },
      userId: { stringValue: uid },
      role: { stringValue: role },
      membershipStatus: { stringValue: 'active' },
      createdAt: tsField(now),
      updatedAt: tsField(now),
    });
  }
  // The outsider is a complete, verified account with a profile — everything
  // except a membership. That is the interesting case: not "signed out", but
  // "signed in and not in this community".
  for (const uid of [championUid, memberUid, outsiderUid]) {
    await firestoreWrite(`wsfMemberProfiles/${uid}`, {
      displayName: { stringValue: uid },
      createdAt: tsField(now),
      updatedAt: tsField(now),
    });
  }

  return { groupId, joinCode, championEmail, memberEmail, outsiderEmail, password };
}

async function signInVia(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/signin');
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('wsf-signin-email').fill(email);
  await page.getByTestId('wsf-signin-password').fill(password);
  await page.getByTestId('wsf-signin-submit').click();
  await page.waitForURL(/\/(profile-setup)?$/, { timeout: 15_000 });
}

async function openManage(page: Page): Promise<void> {
  const manage = page.getByTestId('wsf-community-manage');
  await expect(manage).toBeVisible({ timeout: 20_000 });
  await manage.click();
  await expect(page.getByTestId('wsf-community-manage-panel')).toBeVisible({ timeout: 20_000 });
}

/**
 * Open the sheet, reveal the QR, and return the URL it says it encoded.
 *
 * Tolerant of the symbol already being open: whether the sheet's contents
 * survive a close and reopen is react-native-web's business, not this spec's,
 * and Q-4 opens it twice.
 */
async function revealQrUrl(page: Page): Promise<string> {
  await openManage(page);
  const toggle = page.getByTestId('wsf-community-qr-toggle');
  await expect(toggle).toBeVisible({ timeout: 20_000 });
  const symbol = page.getByTestId('wsf-community-qr-symbol');
  if ((await symbol.count()) === 0) await toggle.click();
  await expect(symbol).toBeVisible({ timeout: 20_000 });
  const url = await symbol.getAttribute('data-qr-url');
  if (!url) throw new Error('the QR symbol carries no data-qr-url');
  return url;
}

// ─────────────────────────────────────────────────────────────────────────────

test('Q-1: a Champion sees the QR and the URL it encodes, and it is the invite link', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const fx = await seedFixture('q1', 'inviteOnly');

  const ctx: BrowserContext = await browser.newContext();
  const champion = await ctx.newPage();
  await signInVia(champion, fx.championEmail, fx.password);
  await champion.goto(`/community/${fx.groupId}`);

  // The link the Copy control puts on the clipboard, carried by the Invite
  // card as a data attribute — never printed as body copy.
  const inviteCard = champion.getByTestId('wsf-community-invite');
  await expect(inviteCard).toBeVisible({ timeout: 20_000 });
  const copied = (await inviteCard.getAttribute('data-invite-url')) ?? '';
  expect(copied.trim()).toBe(`${new URL(champion.url()).origin}/join/${fx.joinCode}`);
  await expect(inviteCard).not.toContainText(`/join/${fx.joinCode}`);

  // The control starts closed: the symbol is drawn on demand, after hydration.
  await openManage(champion);
  await expect(champion.getByTestId('wsf-community-qr-toggle')).toHaveText('Show QR code');
  await expect(champion.getByTestId('wsf-community-qr-symbol')).toHaveCount(0);
  await champion.getByTestId('wsf-community-manage-close').click();

  const encodedUrl = await revealQrUrl(champion);
  // THE assertion: the QR encodes the invite link itself, unchanged.
  expect(encodedUrl).toBe(copied.trim());
  expect(encodedUrl).toContain(`/join/${fx.joinCode}`);

  // Clause 5: the link is CARRIED by the symbol, never PRINTED as body copy —
  // on the Champion's Manage sheet as much as on the member-facing card. The
  // hosted W8 row reads data-qr-url, so nothing depends on the text being
  // there, and a Champion reading a token aloud off a projector is exactly
  // what the contract is trying to prevent.
  await expect(champion.getByTestId('wsf-community-qr-url')).toHaveCount(0);
  await expect(champion.getByTestId('wsf-community-manage-panel')).not.toContainText(
    `/join/${fx.joinCode}`
  );

  // A real image, drawn client-side — an inline SVG data URI, no network fetch.
  // react-native-web renders an Image as a View carrying the testID, a child
  // View with the picture as a CSS background, and a hidden <img> that holds
  // the same URI for assistive technology and the browser context menu. The
  // <img> is where a `src` actually exists.
  const src = await champion
    .locator('[data-testid="wsf-community-qr-image"] img')
    .getAttribute('src');
  expect(src, 'the QR is rendered from an inline data URI').toMatch(/^data:image\/svg\+xml/);
  expect(src, 'the symbol is a QR, not a placeholder').toContain('%3Csvg');

  // The honest note: scanning is not joining.
  await expect(champion.getByTestId('wsf-community-qr-caveat')).toContainText('has to sign in');
  await expect(champion.getByTestId('wsf-community-qr-caveat')).toContainText('new invite link');

  // The toggle is a real 44px control with an accessible name in both states.
  const toggle = champion.getByTestId('wsf-community-qr-toggle');
  await expect(toggle).toHaveText('Hide QR code');
  await expect(toggle).toHaveAttribute('aria-label', 'Hide QR code');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const box = await toggle.boundingBox();
  expect(box, 'the toggle must be laid out').not.toBeNull();
  expect(box!.height, 'minimum touch target height').toBeGreaterThanOrEqual(44);
  expect(box!.width, 'minimum touch target width').toBeGreaterThanOrEqual(44);

  // Hiding really hides it.
  await toggle.click();
  await expect(champion.getByTestId('wsf-community-qr-symbol')).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-label', 'Show QR code');

  await ctx.close();
});

test('Q-2: an ordinary member has the Invite card and its QR, never the Champion QR section', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const fx = await seedFixture('q2', 'inviteOnly');

  const ctx: BrowserContext = await browser.newContext();
  const member = await ctx.newPage();
  await signInVia(member, fx.memberEmail, fx.password);
  await member.goto(`/community/${fx.groupId}`);
  await expect(member.getByTestId('wsf-community')).toBeVisible({ timeout: 20_000 });

  // The member DOES have the invite: the card, with the link as data and the
  // working controls — and never the link printed as body copy.
  const inviteCard = member.getByTestId('wsf-community-invite');
  await expect(inviteCard).toBeVisible();
  const inviteUrl = (await inviteCard.getAttribute('data-invite-url')) ?? '';
  expect(inviteUrl).toBe(`${new URL(member.url()).origin}/join/${fx.joinCode}`);
  await expect(inviteCard).not.toContainText(`/join/${fx.joinCode}`);
  await expect(member.getByTestId('wsf-community-invite-copy')).toHaveText('Copy invite');

  // The Champion tools entry point is not rendered for them, so the sheet and
  // everything in it is unreachable — not merely hidden.
  await expect(member.getByTestId('wsf-community-manage')).toHaveCount(0);
  await expect(member.getByTestId('wsf-community-manage-panel')).toHaveCount(0);
  await expect(member.getByTestId('wsf-community-qr-section')).toHaveCount(0);
  await expect(member.getByTestId('wsf-community-qr-toggle')).toHaveCount(0);
  await expect(member.getByTestId('wsf-community-qr-symbol')).toHaveCount(0);
  // Nothing carries an encoded URL until the member asks for the symbol…
  expect(await member.locator('[data-qr-url]').count()).toBe(0);
  // …and then exactly one does, on the Invite card, encoding the same link.
  await member.getByTestId('wsf-community-invite-qr-toggle').click();
  const symbol = member.getByTestId('wsf-community-invite-qr-symbol');
  await expect(symbol).toBeVisible({ timeout: 20_000 });
  expect(await member.locator('[data-qr-url]').count()).toBe(1);
  expect(await symbol.getAttribute('data-qr-url')).toBe(inviteUrl);
  // Clause 5: opening the symbol still does not print the link as body copy.
  // The URL rides on the element as data, and Copy/Share move it.
  await expect(inviteCard).not.toContainText(`/join/${fx.joinCode}`);
  await expect(member.getByTestId('wsf-community-invite-qr-url')).toHaveCount(0);
  // The Champion's ids still resolve to nothing for a member.
  await expect(member.getByTestId('wsf-community-qr-symbol')).toHaveCount(0);
  await expect(member.getByTestId('wsf-community-qr-section')).toHaveCount(0);

  await ctx.close();
});

test('Q-3: a signed-in non-member never sees the QR', async ({ browser }) => {
  test.setTimeout(120_000);
  const fx = await seedFixture('q3', 'inviteOnly');

  const ctx: BrowserContext = await browser.newContext();
  const outsider = await ctx.newPage();
  await signInVia(outsider, fx.outsiderEmail, fx.password);
  await outsider.goto(`/community/${fx.groupId}`);

  // They land on the not-a-member state, which is the existing behaviour; the
  // point here is that nothing about the QR leaks into it.
  await expect(outsider.getByTestId('wsf-community-not-member')).toBeVisible({ timeout: 20_000 });
  await expect(outsider.getByTestId('wsf-community-qr-section')).toHaveCount(0);
  await expect(outsider.getByTestId('wsf-community-qr-toggle')).toHaveCount(0);
  await expect(outsider.getByTestId('wsf-community-qr-symbol')).toHaveCount(0);
  expect(await outsider.locator('[data-qr-url]').count()).toBe(0);
  // The join code itself must not be anywhere in the delivered page.
  expect(await outsider.content()).not.toContain(fx.joinCode);

  await ctx.close();
});

test('Q-4: creating a new invite link changes the URL the QR encodes, after a confirmation', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const fx = await seedFixture('q4', 'inviteOnly');

  const ctx: BrowserContext = await browser.newContext();
  const champion = await ctx.newPage();
  await signInVia(champion, fx.championEmail, fx.password);
  await champion.goto(`/community/${fx.groupId}`);

  const before = await revealQrUrl(champion);
  expect(before).toContain(`/join/${fx.joinCode}`);

  // The control lives inside Manage, and it asks first. Backing out really
  // backs out: the stored code is untouched and the symbol still encodes it.
  await champion.getByTestId('wsf-community-reset').click();
  await expect(champion.getByTestId('wsf-community-reset-confirm')).toContainText(
    'will stop working for everyone who has it'
  );
  await champion.getByTestId('wsf-community-reset-cancel').click();
  await expect(champion.getByTestId('wsf-community-reset-confirm')).toHaveCount(0);
  expect(await readJoinCode(fx.groupId)).toBe(fx.joinCode);
  await expect(champion.getByTestId('wsf-community-qr-symbol')).toHaveAttribute('data-qr-url', before);

  await champion.getByTestId('wsf-community-reset').click();
  await champion.getByTestId('wsf-community-reset-confirm-yes').click();
  await expect(champion.getByTestId('wsf-community-invite-reset-done')).toBeVisible({
    timeout: 30_000,
  });
  await expect(champion.getByTestId('wsf-community-invite-reset-error')).toHaveCount(0);

  // The code that is actually stored now — read from the emulator, not the UI.
  const rotated = await readJoinCode(fx.groupId);
  expect(rotated).not.toBe(fx.joinCode);

  // Close and reopen: the symbol the Champion sees next must be the new one.
  await champion.getByTestId('wsf-community-manage-close').click();
  await expect(champion.getByTestId('wsf-community-manage-panel')).toHaveCount(0);
  // The Invite card on the page moved with it — the two can never disagree.
  await expect(champion.getByTestId('wsf-community-invite')).toHaveAttribute(
    'data-invite-url',
    `${new URL(champion.url()).origin}/join/${rotated}`
  );

  const after = await revealQrUrl(champion);
  expect(after).not.toBe(before);
  expect(after).toContain(`/join/${rotated}`);
  expect(after).not.toContain(fx.joinCode);
  // The printed URL moves with it — the two can never disagree.
  await expect(champion.getByTestId('wsf-community-qr-url')).toHaveText(after);

  await ctx.close();
});

test('Q-5: a private community renders the reason instead of a QR', async ({ browser }) => {
  test.setTimeout(120_000);
  const fx = await seedFixture('q5', 'private');

  const ctx: BrowserContext = await browser.newContext();
  const champion = await ctx.newPage();
  await signInVia(champion, fx.championEmail, fx.password);
  await champion.goto(`/community/${fx.groupId}`);

  // The Champion's Invite card says why there is no link, and offers no
  // control that could not work: no link to copy, no link to share, no
  // encoded URL, no data attribute carrying one.
  const inviteCard = champion.getByTestId('wsf-community-invite');
  await expect(inviteCard).toBeVisible({ timeout: 20_000 });
  await expect(champion.getByTestId('wsf-community-invite-qr-unavailable')).toContainText(
    'cannot be joined from a link'
  );
  await expect(champion.getByTestId('wsf-community-invite-copy')).toHaveCount(0);
  await expect(champion.getByTestId('wsf-community-invite-share')).toHaveCount(0);
  await expect(champion.getByTestId('wsf-community-invite-qr-toggle')).toHaveCount(0);
  expect(await inviteCard.getAttribute('data-invite-url')).toBeNull();

  await openManage(champion);
  // No link, so nothing to rotate either.
  await expect(champion.getByTestId('wsf-community-reset')).toHaveCount(0);
  await expect(champion.getByTestId('wsf-community-qr-section')).toBeVisible();
  // The sentence, not a symbol and not silence.
  await expect(champion.getByTestId('wsf-community-qr-unavailable')).toContainText(
    'cannot be joined from a link'
  );
  await expect(champion.getByTestId('wsf-community-qr-toggle')).toHaveCount(0);
  await expect(champion.getByTestId('wsf-community-qr-symbol')).toHaveCount(0);
  expect(await champion.locator('[data-qr-url]').count()).toBe(0);
  // The private group's joinCode exists in Firestore but must not reach the page.
  expect(await champion.content()).not.toContain(fx.joinCode);

  await ctx.close();
});
