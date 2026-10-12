import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

/**
 * EVERGREEN-MARKER-ENTRY-1 (phase A) — the printed `/go/<slug>` journey,
 * asserted of the PRODUCT against the emulator suite.
 *
 * Every marker, community, goal and account here is SYNTHETIC and lives only in
 * `demo-wsf-local`. Marker documents are seeded with the emulator's owner
 * credential because phase A has no marker write path at all, by design.
 * Verification is completed through the Auth emulator's admin API; no mail is
 * sent or clicked.
 *
 * CAPTURES are gated on WSF_MARKER_CAPTURE_DIR (390×844 and 390×640, each
 * after its state's assertions). WSF_MARKER_STAGE=BEFORE runs only the cold
 * scan against the unchanged base, which has no `/go` route.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'demo-wsf-local';
const PASSWORD = 'marker-entry-password';
const OWNER = { authorization: 'Bearer owner', 'content-type': 'application/json' };
const DOCS = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const CAPTURE_DIR = process.env.WSF_MARKER_CAPTURE_DIR ?? '';
const BEFORE = process.env.WSF_MARKER_STAGE === 'BEFORE';
const VIEWPORTS = [
  { label: '390x844', width: 390, height: 844 },
  { label: '390x640', width: 390, height: 640 },
];

async function snap(page: Page, state: string): Promise<void> {
  if (!CAPTURE_DIR) return;
  mkdirSync(CAPTURE_DIR, { recursive: true });
  const before = page.viewportSize();
  for (const v of VIEWPORTS) {
    await page.setViewportSize({ width: v.width, height: v.height });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(CAPTURE_DIR, `${state}-${v.label}.png`), fullPage: false });
  }
  if (before) await page.setViewportSize(before);
}

async function seedVerifiedUser(email: string): Promise<string> {
  const base = `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1`;
  const signup = await fetch(`${base}/accounts:signUp?key=fake-api-key`, {
    method: 'POST',
    headers: OWNER,
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  });
  if (!signup.ok) throw new Error(`emulator signUp failed: ${signup.status}`);
  const { localId } = (await signup.json()) as { localId: string };
  const update = await fetch(`${base}/accounts:update`, {
    method: 'POST',
    headers: OWNER,
    body: JSON.stringify({ localId, emailVerified: true }),
  });
  if (!update.ok) throw new Error(`emulator verify failed: ${update.status}`);
  return localId;
}

async function write(docPath: string, fields: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${DOCS}/${docPath}`, { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields }) });
  if (!res.ok) throw new Error(`emulator write ${docPath} failed: ${res.status} ${await res.text()}`);
}

async function exists(docPath: string): Promise<boolean> {
  const res = await fetch(`${DOCS}/${docPath}`, { headers: OWNER });
  return res.ok;
}

async function readField(docPath: string, field: string): Promise<string | undefined> {
  const res = await fetch(`${DOCS}/${docPath}`, { headers: OWNER });
  if (!res.ok) return undefined;
  const doc = (await res.json()) as { fields?: Record<string, { stringValue?: string }> };
  return doc.fields?.[field]?.stringValue;
}

const str = (v: string) => ({ stringValue: v });
const ts = (d: Date) => ({ timestampValue: d.toISOString() });

async function seedProfile(uid: string, name: string) {
  const now = new Date();
  await write(`wsfMemberProfiles/${uid}`, { displayName: str(name), createdAt: ts(now), updatedAt: ts(now) });
}

async function seedMembership(groupId: string, uid: string, role = 'member') {
  const now = new Date();
  await write(`wsfMemberships/${groupId}_${uid}`, {
    groupId: str(groupId),
    userId: str(uid),
    role: str(role),
    membershipStatus: str('active'),
    createdAt: ts(now),
    updatedAt: ts(now),
  });
}

/** One synthetic expo community with one goal. */
async function seedExpo(tag: string, title: string, community: string, goalExtra: Record<string, unknown> = {}) {
  const stamp = `${tag}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const groupId = `marker-${stamp}`;
  const now = new Date();
  await write(`wsfCommunityGroups/${groupId}`, {
    displayName: str(community),
    groupType: str('familyFriends'),
    joinPolicy: str('public'),
    joinCode: str(randomBytes(16).toString('base64url')),
    createdByUserId: str('seeder'),
    lifecycleStatus: str('active'),
    isSample: { booleanValue: false },
    createdAt: ts(now),
    updatedAt: ts(now),
  });
  const goalId = `marker-goal-${stamp}`;
  await write(`wsfGoals/${goalId}`, {
    ownerUid: str('seeder'),
    communityGroupId: str(groupId),
    title: str(title),
    target: { integerValue: '500' },
    unit: str('jumping jacks'),
    status: str('active'),
    startsAt: ts(new Date(now.getTime() - 60 * 60_000)),
    endsAt: ts(new Date(now.getTime() + 3 * 24 * 60 * 60_000)),
    timezone: str('America/New_York'),
    createdAt: ts(now),
    updatedAt: ts(now),
    ...goalExtra,
  });
  return { groupId, goalId };
}

async function seedMarker(slug: string, groupId: string, goalId: string, kioskMode = 'off', active = true) {
  await write(`wsfMarkers/${slug}`, {
    label: str('Synthetic Expo Flag'),
    active: { booleanValue: active },
    communityGroupId: str(groupId),
    goalId: str(goalId),
    kioskMode: str(kioskMode),
  });
}

const slugFor = (tag: string) => `t-${tag}-${Date.now().toString(36)}`;
const shown = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);

async function signIn(page: Page, email: string) {
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-signin-email').fill(email);
  await page.getByTestId('wsf-signin-password').fill(PASSWORD);
  await page.getByTestId('wsf-signin-submit').click();
}

test('BEFORE/AFTER cold scan: a printed /go/<slug> on a phone that has never seen the app', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const { groupId, goalId } = await seedExpo('cold', 'Synthetic Expo Squat Wall', 'Synthetic Expo Movers');
  const slug = slugFor('cold');
  await seedMarker(slug, groupId, goalId);
  await page.goto(`/go/${slug}`);
  if (BEFORE) {
    // The base has no /go route: whatever it serves, it is not a marker entry.
    await page.waitForTimeout(4_000);
    await expect(shown(page, 'wsf-marker-signed-out')).toHaveCount(0);
    await snap(page, 'before-cold-scan');
    return;
  }
  await expect(shown(page, 'wsf-marker-signed-out')).toBeVisible({ timeout: 20_000 });
  await expect(shown(page, 'wsf-marker-community')).toHaveText('Synthetic Expo Movers');
  await expect(shown(page, 'wsf-marker-goal')).toHaveText('Synthetic Expo Squat Wall');
  await expect(shown(page, 'wsf-marker-state')).toHaveText('Open now');
  // Joining is explained BEFORE any movement, and no way to move exists yet.
  await expect(shown(page, 'wsf-marker-explain')).toContainText('Sign in and join Synthetic Expo Movers first');
  await expect(shown(page, 'wsf-marker-phone')).toHaveCount(0);
  await expect(shown(page, 'wsf-marker-kiosk')).toHaveCount(0);
  // Nothing private reaches the page.
  const joinCode = await readField(`wsfCommunityGroups/${groupId}`, 'joinCode');
  expect(await page.content()).not.toContain(joinCode!);
  await snap(page, 'after-signed-out');
});

test.describe('after', () => {
  test.skip(BEFORE, 'AFTER journeys need the marker route');

  test('signed-out scan → sign in → back on the marker → explicit Join → choose; kiosk off is omitted', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const { groupId, goalId } = await seedExpo('join', 'Synthetic Expo Squat Wall', 'Synthetic Expo Movers');
    const slug = slugFor('join');
    await seedMarker(slug, groupId, goalId, 'off');
    const email = `wsf-marker-join-${Date.now().toString(36)}@example.com`;
    const uid = await seedVerifiedUser(email);
    await seedProfile(uid, 'Synthetic Visitor');

    await page.goto(`/go/${slug}`);
    await expect(shown(page, 'wsf-marker-signed-out')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('wsf-marker-signin').click();
    // The sign-in screen says the scanned code is waiting.
    await expect(page.getByTestId('wsf-form-destination')).toContainText('The code you scanned', { timeout: 20_000 });
    await signIn(page, email);

    // The product's own redirect, nothing navigates here.
    await expect(page).toHaveURL(new RegExp(`/go/${slug}(\\?|$|#)`), { timeout: 30_000 });
    await expect(shown(page, 'wsf-marker-join')).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => page.evaluate(() => window.sessionStorage.getItem('wsf.markerReturn')))
      .toBeNull();
    // Scanning and signing in admitted nobody: the Join tap is the one write.
    expect(await exists(`wsfMemberships/${groupId}_${uid}`)).toBe(false);
    await snap(page, 'after-join');

    await shown(page, 'wsf-marker-join-button').click();
    await expect(shown(page, 'wsf-marker-choose')).toBeVisible({ timeout: 30_000 });
    expect(await readField(`wsfMemberships/${groupId}_${uid}`, 'membershipStatus')).toBe('active');
    await expect(shown(page, 'wsf-marker-phone')).toBeVisible();
    await expect(shown(page, 'wsf-marker-kiosk')).toHaveCount(0);
    await expect(page.getByText('Use a kiosk')).toHaveCount(0);
    await snap(page, 'after-choose-kiosk-off');

    await shown(page, 'wsf-marker-phone').click();
    await expect(page).toHaveURL(new RegExp(`/contribute/${goalId}(\\?|$|#)`), { timeout: 20_000 });
  });

  test('an existing member goes straight to the choice; kiosk available is guidance only and queues nothing', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const { groupId, goalId } = await seedExpo('member', 'Synthetic Expo Squat Wall', 'Synthetic Expo Movers');
    const slug = slugFor('avail');
    await seedMarker(slug, groupId, goalId, 'available');
    const email = `wsf-marker-member-${Date.now().toString(36)}@example.com`;
    const uid = await seedVerifiedUser(email);
    await seedProfile(uid, 'Synthetic Member');
    await seedMembership(groupId, uid);

    await page.goto('/signin');
    await signIn(page, email);
    await expect(page.getByTestId('wsf-home-signout')).toBeVisible({ timeout: 30_000 });
    await page.goto(`/go/${slug}`);
    await expect(shown(page, 'wsf-marker-choose')).toBeVisible({ timeout: 30_000 });
    await expect(shown(page, 'wsf-marker-join')).toHaveCount(0);
    await expect(shown(page, 'wsf-marker-kiosk-guidance')).toHaveCount(0);
    await shown(page, 'wsf-marker-kiosk').click();
    await expect(shown(page, 'wsf-marker-kiosk-guidance')).toContainText('doesn’t save you a place');
    await expect(page).toHaveURL(new RegExp(`/go/${slug}(\\?|$|#)`));
    expect(await exists(`wsfTurnMembers/goal__${goalId}__${uid}`)).toBe(false);
    await snap(page, 'after-choose-kiosk-available');
  });

  test('kiosk queue reaches the existing event screen and nothing is queued by getting there', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const { groupId, goalId } = await seedExpo('queue', 'Synthetic Expo Squat Wall', 'Synthetic Expo Movers', {
      aggregateDisplayAuthorized: { booleanValue: true },
    });
    const slug = slugFor('queue');
    await seedMarker(slug, groupId, goalId, 'queue');
    const email = `wsf-marker-queue-${Date.now().toString(36)}@example.com`;
    const uid = await seedVerifiedUser(email);
    await seedProfile(uid, 'Synthetic Queuer');
    await seedMembership(groupId, uid);

    await page.goto('/signin');
    await signIn(page, email);
    await expect(page.getByTestId('wsf-home-signout')).toBeVisible({ timeout: 30_000 });
    await page.goto(`/go/${slug}`);
    await expect(shown(page, 'wsf-marker-choose')).toBeVisible({ timeout: 30_000 });
    await expect(shown(page, 'wsf-marker-kiosk-note')).toContainText('choose the name');
    await snap(page, 'after-choose-kiosk-queue');
    await shown(page, 'wsf-marker-kiosk').click();
    await expect(page).toHaveURL(new RegExp(`/event/${goalId}(\\?|$|#)`), { timeout: 20_000 });
    // The existing event screen; its device question or member view, never a queue place.
    await expect(shown(page, 'wsf-device-choice').or(shown(page, 'wsf-event-member'))).toBeVisible({ timeout: 30_000 });
    expect(await exists(`wsfTurnMembers/goal__${goalId}__${uid}`)).toBe(false);
  });

  test('a closed goal is truthful and offers the community, never a start', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const { groupId, goalId } = await seedExpo('closed', 'Synthetic Spring Squat Wall', 'Synthetic Expo Movers', {
      status: str('closed'),
    });
    const slug = slugFor('closed');
    await seedMarker(slug, groupId, goalId, 'queue');
    const email = `wsf-marker-closed-${Date.now().toString(36)}@example.com`;
    const uid = await seedVerifiedUser(email);
    await seedProfile(uid, 'Synthetic Member');
    await seedMembership(groupId, uid);

    await page.goto('/signin');
    await signIn(page, email);
    await expect(page.getByTestId('wsf-home-signout')).toBeVisible({ timeout: 30_000 });
    await page.goto(`/go/${slug}`);
    await expect(shown(page, 'wsf-marker-not-open')).toBeVisible({ timeout: 30_000 });
    await expect(shown(page, 'wsf-marker-state')).toHaveText('This challenge is closed');
    await expect(shown(page, 'wsf-marker-phone')).toHaveCount(0);
    await expect(shown(page, 'wsf-marker-kiosk')).toHaveCount(0);
    await expect(shown(page, 'wsf-marker-open-community')).toHaveAttribute('href', `/community/${groupId}`);
    await snap(page, 'after-closed-goal');
  });

  test('inactive, unknown and malformed markers fail closed with one plain answer', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const { groupId, goalId } = await seedExpo('off', 'Synthetic Expo Squat Wall', 'Synthetic Expo Movers');
    const slug = slugFor('inactive');
    await seedMarker(slug, groupId, goalId, 'off', false);
    for (const target of [`/go/${slug}`, `/go/${slugFor('unknown')}`, '/go/not_a_slug']) {
      await page.goto(target);
      await expect(shown(page, 'wsf-marker-invalid')).toBeVisible({ timeout: 20_000 });
      await expect(shown(page, 'wsf-marker-invalid')).toContainText('This code isn’t active');
      await expect(page.getByText('Synthetic Expo Squat Wall')).toHaveCount(0);
    }
    await snap(page, 'after-invalid');
  });

  test('repointing the marker changes what the same printed address opens, and neither goal is rewritten', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const a = await seedExpo('repA', 'Synthetic Morning Squat Wall', 'Synthetic Expo North');
    const b = await seedExpo('repB', 'Synthetic Evening Plank Hold', 'Synthetic Expo South');
    const slug = slugFor('repoint');
    await seedMarker(slug, a.groupId, a.goalId);
    const titleA = await readField(`wsfGoals/${a.goalId}`, 'title');
    await page.goto(`/go/${slug}`);
    await expect(shown(page, 'wsf-marker-goal')).toHaveText('Synthetic Morning Squat Wall', { timeout: 20_000 });

    // An operator repoint, by the emulator owner: phase A has no repoint path.
    await seedMarker(slug, b.groupId, b.goalId);
    await page.reload();
    await expect(shown(page, 'wsf-marker-goal')).toHaveText('Synthetic Evening Plank Hold', { timeout: 20_000 });
    await expect(shown(page, 'wsf-marker-community')).toHaveText('Synthetic Expo South');
    expect(await readField(`wsfGoals/${a.goalId}`, 'title')).toBe(titleA);
    expect(await readField(`wsfGoals/${a.goalId}`, 'communityGroupId')).toBe(a.groupId);
    await snap(page, 'after-repointed');
  });
});
