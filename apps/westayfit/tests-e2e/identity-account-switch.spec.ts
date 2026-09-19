/**
 * ACCOUNT IDENTITY ACROSS A SWITCH.
 *
 * The owner signed out of one account on an iPhone, created another, and
 * reported that the flow "appeared to return to the previously signed-in
 * user's information". This file exists to establish what is actually true,
 * with the authenticated uid read at every step, rather than to argue from
 * screenshots.
 *
 * The invariant under test: after signing out of A and into B, nothing that
 * belongs to A may render, even for a frame, and no request started as A may
 * navigate or repopulate B's session. Two accounts deliberately share a
 * display name, because that is the case where a person cannot tell them
 * apart by eye and the product has to say which one is signed in.
 */
import { randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const PROJECT_ID = 'demo-wsf-local';
const PASSWORD = 'switch-secret-1';
/** Both accounts answer to this, so only the address can tell them apart. */
const SHARED_DISPLAY_NAME = 'Sam Rivera';

const unique = (label: string) => `${label}-${randomBytes(6).toString('hex')}@example.com`;

async function markEmailVerified(email: string): Promise<void> {
  const base = `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1`;
  const lookup = await fetch(`${base}/projects/${PROJECT_ID}/accounts:query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({}),
  });
  const { userInfo = [] } = (await lookup.json()) as { userInfo?: { localId: string; email: string }[] };
  const user = userInfo.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error(`no emulator account for ${email}`);
  const update = await fetch(`${base}/projects/${PROJECT_ID}/accounts:update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ localId: user.localId, emailVerified: true }),
  });
  if (!update.ok) throw new Error(`emulator verify failed: ${update.status}`);
}

/**
 * The uid the page is ACTUALLY authenticated as, read from Firebase's own
 * store rather than from anything the UI says. The Web SDK persists the
 * signed-in user in IndexedDB (`firebaseLocalStorageDb`), falling back to
 * localStorage where IndexedDB is unavailable, so both are read here.
 */
async function signedInUid(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const fromLocalStorage = (): string | null => {
      try {
        for (let i = 0; i < window.localStorage.length; i += 1) {
          const key = window.localStorage.key(i);
          if (key && key.startsWith('firebase:authUser:')) {
            const parsed = JSON.parse(window.localStorage.getItem(key) ?? 'null') as {
              uid?: string;
            } | null;
            if (parsed?.uid) return parsed.uid;
          }
        }
      } catch {
        return null;
      }
      return null;
    };

    const fromIndexedDb = (): Promise<string | null> =>
      new Promise((resolve) => {
        let settled = false;
        const done = (value: string | null) => {
          if (!settled) {
            settled = true;
            resolve(value);
          }
        };
        // Never hang the test on a store that is not there.
        setTimeout(() => done(null), 3000);
        try {
          const open = indexedDB.open('firebaseLocalStorageDb');
          open.onerror = () => done(null);
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains('firebaseLocalStorage')) return done(null);
            const all = db.transaction('firebaseLocalStorage', 'readonly')
              .objectStore('firebaseLocalStorage')
              .getAll();
            all.onerror = () => done(null);
            all.onsuccess = () => {
              const rows = (all.result ?? []) as { fbase_key?: string; value?: { uid?: string } }[];
              const row = rows.find(
                (r) => typeof r.fbase_key === 'string' && r.fbase_key.startsWith('firebase:authUser:')
              );
              done(row?.value?.uid ?? null);
            };
          };
        } catch {
          done(null);
        }
      });

    return (await fromIndexedDb()) ?? fromLocalStorage();
  });
}

async function createAccount(page: Page, email: string): Promise<string> {
  await page.goto('/signup');
  await page.getByTestId('wsf-signup-displayName').fill(SHARED_DISPLAY_NAME);
  await page.getByTestId('wsf-signup-email').fill(email);
  await page.getByTestId('wsf-signup-password').fill(PASSWORD);
  const sendSettled = page.waitForResponse((r) => r.url().includes('wsfSendVerificationEmail'));
  await page.getByTestId('wsf-signup-submit').click();
  await expect(page.getByTestId('wsf-verify')).toBeVisible({ timeout: 20_000 });
  await sendSettled;
  await markEmailVerified(email);
  await page.getByTestId('wsf-verify-check').click();
  await expect(page.getByTestId('wsf-profile')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-profile-termsCheckbox').click();
  await page.getByTestId('wsf-profile-submit').click();
  await expect(page.getByTestId('wsf-home-signed-in')).toBeVisible({ timeout: 20_000 });
  const uid = await signedInUid(page);
  expect(uid, 'the account must be authenticated after sign-up').toBeTruthy();
  return uid!;
}

test('signing out of one account and creating another never shows the first account', async ({
  page,
}) => {
  const emailA = unique('switch-a');
  const emailB = unique('switch-b');

  const uidA = await createAccount(page, emailA);
  // A's own community, so A has content that could leak into B's session.
  await page.getByTestId('wsf-home-start').click();
  await expect(page.getByTestId('wsf-start')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-start-name').fill('Harbor Walkers A');
  await page.getByTestId('wsf-start-submit').click();
  await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 25_000 });
  await page.goto('/');
  await expect(page.getByTestId('wsf-home-my-list')).toContainText('Harbor Walkers A', {
    timeout: 20_000,
  });
  await expect(page.getByTestId('wsf-home-identity')).toContainText(SHARED_DISPLAY_NAME);

  // ---- sign out ----
  await page.getByTestId('wsf-home-signout').click();
  await expect(page.getByTestId('wsf-home-signed-out')).toBeVisible({ timeout: 20_000 });
  expect(await signedInUid(page)).toBeNull();
  // A's community must be gone the moment A is gone.
  await expect(page.locator('body')).not.toContainText('Harbor Walkers A');

  // ---- create B in the same browser ----
  const uidB = await createAccount(page, emailB);
  expect(uidB, 'B must be a different account from A').not.toBe(uidA);

  // THE ASSERTION the owner's report is about: B's session shows nothing of A.
  await expect(page.getByTestId('wsf-home-signed-in')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Harbor Walkers A');
  await expect(page.getByTestId('wsf-home-my-empty')).toBeVisible({ timeout: 20_000 });
  expect(await signedInUid(page)).toBe(uidB);

  // Reload, then back and forward: a restored page must re-read the CURRENT
  // account, never repaint a cached view of the previous one.
  await page.reload();
  await expect(page.getByTestId('wsf-home-signed-in')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('body')).not.toContainText('Harbor Walkers A');
  expect(await signedInUid(page)).toBe(uidB);

  await page.goBack();
  await page.goForward();
  await expect(page.getByTestId('wsf-home-signed-in')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('body')).not.toContainText('Harbor Walkers A');
  expect(await signedInUid(page)).toBe(uidB);

  // Two accounts, one display name: the screen must still say WHICH one, and
  // offer a way out. This is what makes the owner's confusion answerable.
  const identity = page.getByTestId('wsf-home-identity');
  await expect(identity).toBeVisible();
  await expect(identity).toContainText(emailB.split('@')[0]);
  await expect(identity).not.toContainText(emailA.split('@')[0]);
  await expect(page.getByTestId('wsf-home-signout')).toBeVisible();
});

test("a second browser context signed in as A is untouched by B's sign-up", async ({ browser }) => {
  const emailA = unique('ctx-a');
  const emailB = unique('ctx-b');

  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  const uidA = await createAccount(pageA, emailA);

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  const uidB = await createAccount(pageB, emailB);

  expect(uidA).not.toBe(uidB);
  // Each context keeps its own account. A verification action performed in one
  // browser must never sign the other browser into the verified account.
  expect(await signedInUid(pageA)).toBe(uidA);
  expect(await signedInUid(pageB)).toBe(uidB);

  await pageA.goto('/');
  await pageB.goto('/');
  await expect(pageA.getByTestId('wsf-home-signed-in')).toBeVisible({ timeout: 20_000 });
  await expect(pageB.getByTestId('wsf-home-signed-in')).toBeVisible({ timeout: 20_000 });
  expect(await signedInUid(pageA)).toBe(uidA);
  expect(await signedInUid(pageB)).toBe(uidB);

  await contextA.close();
  await contextB.close();
});
