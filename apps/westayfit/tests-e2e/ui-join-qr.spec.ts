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
 *   Q-2  an ordinary member never sees it. The QR lives inside the Champion
 *        tools sheet, which a member cannot open at all.
 *   Q-3  a signed-in non-member never sees it — they never reach the screen.
 *   Q-4  resetting the join code changes the encoded URL. A printed code that
 *        outlives its reset is the failure that matters here: the Champion
 *        would believe the old flyer is dead.
 *   Q-5  a private community renders no QR — it renders the sentence saying
 *        why. A private group must not acquire a working invite link because
 *        the UI happened to have a joinCode in hand.
 *
 * `data-qr-url` on the symbol carries the string the encoder was handed. That
 * is deliberately an attribute and not an image comparison: what matters is
 * WHICH URL got encoded, and a pixel diff of a QR answers a different, weaker
 * question.
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

  // The link the Copy control shows, on the page itself.
  const copied = await champion.getByTestId('wsf-community-invite-url').innerText();
  expect(copied.trim()).toBe(`${new URL(champion.url()).origin}/join/${fx.joinCode}`);

  // The control starts closed: the symbol is drawn on demand, after hydration.
  await openManage(champion);
  await expect(champion.getByTestId('wsf-community-qr-toggle')).toHaveText('Show QR code');
  await expect(champion.getByTestId('wsf-community-qr-symbol')).toHaveCount(0);
  await champion.getByTestId('wsf-community-manage-close').click();

  const encodedUrl = await revealQrUrl(champion);
  // THE assertion: the QR encodes the invite link itself, unchanged.
  expect(encodedUrl).toBe(copied.trim());
  expect(encodedUrl).toContain(`/join/${fx.joinCode}`);

  // The URL is printed under the symbol, not only encoded into it.
  await expect(champion.getByTestId('wsf-community-qr-url')).toHaveText(encodedUrl);

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
  await expect(champion.getByTestId('wsf-community-qr-caveat')).toContainText('Reset the link');

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

test('Q-2: an ordinary member never sees the QR', async ({ browser }) => {
  test.setTimeout(120_000);
  const fx = await seedFixture('q2', 'inviteOnly');

  const ctx: BrowserContext = await browser.newContext();
  const member = await ctx.newPage();
  await signInVia(member, fx.memberEmail, fx.password);
  await member.goto(`/community/${fx.groupId}`);
  await expect(member.getByTestId('wsf-community')).toBeVisible({ timeout: 20_000 });

  // The member DOES have the invite link — that is existing behaviour and not
  // what this asserts.
  await expect(member.getByTestId('wsf-community-invite-url')).toBeVisible();

  // The Champion tools entry point is not rendered for them, so the sheet and
  // everything in it is unreachable — not merely hidden.
  await expect(member.getByTestId('wsf-community-manage')).toHaveCount(0);
  await expect(member.getByTestId('wsf-community-manage-panel')).toHaveCount(0);
  await expect(member.getByTestId('wsf-community-qr-section')).toHaveCount(0);
  await expect(member.getByTestId('wsf-community-qr-toggle')).toHaveCount(0);
  await expect(member.getByTestId('wsf-community-qr-symbol')).toHaveCount(0);
  // And nothing on the page carries an encoded URL at all.
  expect(await member.locator('[data-qr-url]').count()).toBe(0);

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

test('Q-4: resetting the join code changes the URL the QR encodes', async ({ browser }) => {
  test.setTimeout(180_000);
  const fx = await seedFixture('q4', 'inviteOnly');

  const ctx: BrowserContext = await browser.newContext();
  const champion = await ctx.newPage();
  await signInVia(champion, fx.championEmail, fx.password);
  await champion.goto(`/community/${fx.groupId}`);

  const before = await revealQrUrl(champion);
  expect(before).toContain(`/join/${fx.joinCode}`);

  // The reset control lives on the page under the sheet, so close first.
  await champion.getByTestId('wsf-community-manage-close').click();
  await expect(champion.getByTestId('wsf-community-manage-panel')).toHaveCount(0);

  await champion.getByTestId('wsf-community-invite-reset').click();
  await expect(champion.getByTestId('wsf-community-invite-reset-done')).toBeVisible({
    timeout: 30_000,
  });

  // The code that is actually stored now — read from the emulator, not the UI.
  const rotated = await readJoinCode(fx.groupId);
  expect(rotated).not.toBe(fx.joinCode);

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

  // No invite card at all on the page — a private group has no link to share.
  await expect(champion.getByTestId('wsf-community-invite')).toHaveCount(0);

  await openManage(champion);
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
