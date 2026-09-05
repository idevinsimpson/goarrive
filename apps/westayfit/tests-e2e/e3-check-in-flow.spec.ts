import { randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

/**
 * E3 end-to-end: a member on the challenge screen sees the shared number move
 * on a real check-in, and never sees an error on a duplicate tap. The rest of
 * §5 (idempotency at the doc-id layer, the sharded counter, the requiresCode
 * gate, rate limits, sample-hiding) belongs to the callable jest suite — the
 * point of this spec is what a member's screen looks like from tap to reload.
 *
 * The seed goes straight against the Firestore and Auth emulators. Same
 * `Bearer owner` bypass e2-join-flow.spec.ts uses; same reasoning
 * (`allow create: if false` on every wsf collection means the rules layer
 * cannot see this write, and that is exactly why we need an out-of-band seed
 * to drive the flow at all).
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'goarrive';

const KNOWN_GAPS = ['/favicon.ico', 'wsfSendVerificationEmail'];

function shortId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
}

async function firestorePatch(path: string, fields: Record<string, unknown>): Promise<void> {
  const url = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer owner',
    },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    throw new Error(
      `Firestore emulator seed failed at ${path}: ${res.status} ${await res.text()}`
    );
  }
}

async function seedCommunity(groupId: string, displayName: string): Promise<void> {
  await firestorePatch(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: displayName },
    groupType: { stringValue: 'custom' },
    joinPolicy: { stringValue: 'private' },
    createdByUserId: { stringValue: 'e3-seeder' },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
  });
}

async function seedChallenge(
  challengeId: string,
  groupId: string,
  title: string
): Promise<void> {
  await firestorePatch(`wsfChallenges/${challengeId}`, {
    groupId: { stringValue: groupId },
    title: { stringValue: title },
    status: { stringValue: 'active' },
    // goalTarget is deliberately null. Spec §5.5: the shared number is a raw
    // count of taps, and the "of N" suffix only appears when an admin sets a
    // target. This spec pins the untargeted default.
    goalTarget: { nullValue: null },
  });
}

async function seedMove(
  moveId: string,
  challengeId: string,
  sequence: number,
  title: string,
  instructions: string
): Promise<void> {
  await firestorePatch(`wsfChallengeMoves/${moveId}`, {
    challengeId: { stringValue: challengeId },
    title: { stringValue: title },
    instructions: { stringValue: instructions },
    sequence: { integerValue: String(sequence) },
    dayNumber: { nullValue: null },
  });
}

async function seedMembership(groupId: string, uid: string): Promise<void> {
  await firestorePatch(`wsfMemberships/${groupId}_${uid}`, {
    groupId: { stringValue: groupId },
    userId: { stringValue: uid },
    role: { stringValue: 'member' },
    membershipStatus: { stringValue: 'active' },
  });
}

/**
 * Create an emulator auth account and mark its email verified in one step.
 * We do not go through the signup UI because the point of this spec is the
 * challenge screen, not the signup chain — and the signup chain has its own
 * spec (mu2-flow.spec.ts) that would double the boot cost here.
 */
async function createVerifiedAccount(email: string, password: string): Promise<string> {
  const base = `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1`;

  const create = await fetch(`${base}/projects/${PROJECT_ID}/accounts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ email, password, emailVerified: true }),
  });
  if (!create.ok) {
    throw new Error(
      `emulator account create failed: ${create.status} ${await create.text()}`
    );
  }
  const { localId } = (await create.json()) as { localId: string };
  if (!localId) throw new Error('emulator account create did not return a localId');

  return localId;
}

function captureConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const where = msg.location()?.url;
    errors.push(where ? `${msg.text()} [${where}]` : msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 400) errors.push(`HTTP ${res.status()} ${res.url()}`);
  });
  return errors;
}

test('E3: member taps a move, the shared number moves, a reload keeps it, a re-tap is idempotent', async ({
  page,
}) => {
  const errors = captureConsoleErrors(page);

  const groupId = shortId('e3');
  const challengeId = `${groupId}-ch`;
  const moveOneId = `${groupId}-m1`;
  const moveTwoId = `${groupId}-m2`;
  const email = `e3-member-${Date.now()}@example.com`;
  const password = 'e3-password';

  await seedCommunity(groupId, 'E3 Gate Community');
  await seedChallenge(challengeId, groupId, 'Move together');
  await seedMove(moveOneId, challengeId, 1, 'Squat once', 'One bodyweight squat.');
  await seedMove(moveTwoId, challengeId, 2, 'Reach up', 'Both arms overhead for a breath.');
  const uid = await createVerifiedAccount(email, password);
  await seedMembership(groupId, uid);

  // Sign in through the UI. The fallback lands the signed-in visitor on
  // profile-setup; we do not need that screen — we just need Firebase Auth to
  // hold a live session before we visit the challenge URL directly.
  await page.goto('/signin');
  await page.getByTestId('wsf-signin-email').fill(email);
  await page.getByTestId('wsf-signin-password').fill(password);
  await page.getByTestId('wsf-signin-submit').click();
  await expect(page.getByTestId('wsf-profile')).toBeVisible({ timeout: 15_000 });

  // Land on the challenge screen. Two moves, count 0, participant line reads
  // "0 members moving" until someone taps.
  await page.goto(`/community/${groupId}/challenge`);
  await expect(page.getByTestId('wsf-challenge')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-challenge-count')).toHaveText('0');
  await expect(page.getByTestId(`wsf-challenge-move-${moveOneId}`)).toBeVisible();
  await expect(page.getByTestId(`wsf-challenge-move-${moveTwoId}`)).toBeVisible();
  await expect(page.getByTestId(`wsf-challenge-move-${moveOneId}-submit`)).toHaveText(
    'I did this'
  );

  // Tap move one. The button carries data-state="fresh"|"pending"|"counted"
  // — fresh before the tap, pending while wsfCheckIn is in flight, counted
  // only after the server confirms. The shared number bumps optimistically
  // on tap, then reconciles to the server value on confirm. We MUST wait
  // for "counted" before reloading: page.reload() aborts an in-flight
  // fetch, so a reload during "pending" tears down the wsfCheckIn call and
  // the server never sees the write — the reloaded list then still shows
  // "I did this" (the exact failure this spec is here to catch).
  await page.getByTestId(`wsf-challenge-move-${moveOneId}-submit`).click();
  await expect(
    page.getByTestId(`wsf-challenge-move-${moveOneId}-submit`)
  ).toHaveAttribute('data-state', 'counted');
  await expect(page.getByTestId(`wsf-challenge-move-${moveOneId}-submit`)).toHaveText(
    'Already counted'
  );
  await expect(page.getByTestId('wsf-challenge-count')).toHaveText('1');

  // Reload. wsfListChallenge is what has to persist the checked-in flag from
  // the wsfCheckIns doc — the client state does not carry across a reload,
  // and if the callable read forgot to look up a member's check-ins the
  // reloaded screen would show "I did this" and let the same member increment
  // the shared number a second time.
  await page.reload();
  await expect(page.getByTestId('wsf-challenge')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId(`wsf-challenge-move-${moveOneId}-submit`)).toHaveText(
    'Already counted'
  );
  await expect(page.getByTestId('wsf-challenge-count')).toHaveText('1');

  // Tap again. The client-side guard drops the second tap, the button stays
  // on "Already counted", and the number does not move. This is the UI half
  // of the §5.3 idempotency guarantee — the server enforces it at the doc-id
  // layer, and the client should never surface it as an error.
  await page.getByTestId(`wsf-challenge-move-${moveOneId}-submit`).click();
  await expect(page.getByTestId(`wsf-challenge-move-${moveOneId}-submit`)).toHaveText(
    'Already counted'
  );
  await expect(page.getByTestId('wsf-challenge-count')).toHaveText('1');

  expect(
    errors.filter((e) => !KNOWN_GAPS.some((gap) => e.includes(gap))),
    'browser console errors during the E3 flow'
  ).toEqual([]);
});
