import { randomBytes } from 'node:crypto';

import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

import {
  AUTH_EMULATOR,
  FIRESTORE_EMULATOR,
  PROJECT_ID,
  firestoreRead,
  firestoreWrite,
  seedCommunity,
  seedProfile,
  seedShards,
  seedVerifiedUser,
  tsField,
} from './mobile';

/**
 * EXPO ATTENDEE JOURNEY FIXTURES (EXPO-ATTENDEE-JOURNEY-PROOF-1).
 *
 * Everything here is SYNTHETIC and emulator-only (`demo-wsf-local`). No name,
 * face, quote, reaction or count in this file belongs to a real person or a
 * real event: every display name starts with "Fixture", every address is under
 * example.com, and every seeded starting total is labelled as a seeded total
 * where it is used.
 *
 * Seeding goes through the emulator's admin bypass, exactly as helpers/mobile.ts
 * does. The journey itself — the device question, the activity, the line, the
 * station's call, the phone's "I'm ready", the station's start and record, the
 * phone's own contribution — goes through the real screens and the real
 * callables. The one callable the fixtures invoke directly is the Champion's
 * station approval, which is a Champion task and not part of an attendee's
 * journey (its own screen is proved by the kiosk pairing specs). `callAs` is
 * also used by the spec's J4b OBSERVATION, which asks the line's own callables
 * what each one does on a goal that is already closed.
 */

export const FUNCTIONS_EMULATOR = 'http://127.0.0.1:5001';
export const FIXTURE_PASSWORD = 'expo-attendee-fixture-1';
const OWNER = { 'content-type': 'application/json', authorization: 'Bearer owner' };

export function fixtureStamp(tag: string): string {
  return `${tag}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
}

// ---------------------------------------------------------------------------
// Accounts and the one callable the Champion makes.
// ---------------------------------------------------------------------------

export type FixtureAccount = { uid: string; email: string; displayName: string };

export async function seedAccount(email: string, displayName: string): Promise<FixtureAccount> {
  const uid = await seedVerifiedUser(email, FIXTURE_PASSWORD);
  await seedProfile(uid, displayName);
  return { uid, email, displayName };
}

async function idTokenFor(email: string): Promise<string> {
  const res = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: FIXTURE_PASSWORD, returnSecureToken: true }),
    },
  );
  if (!res.ok) throw new Error(`emulator sign-in failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { idToken: string }).idToken;
}

/** A callable invoked the way the client SDK invokes it: `{data}` in, `{result}` out. */
export async function callAs<T>(
  email: string | null,
  name: string,
  data: Record<string, unknown>,
): Promise<{ ok: true; result: T } | { ok: false; status: string; message: string }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (email) headers.authorization = `Bearer ${await idTokenFor(email)}`;
  const res = await fetch(`${FUNCTIONS_EMULATOR}/${PROJECT_ID}/us-central1/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ data }),
  });
  const body = (await res.json()) as {
    result?: T;
    error?: { status?: string; message?: string };
  };
  if (body.error) {
    return { ok: false, status: body.error.status ?? '', message: body.error.message ?? '' };
  }
  return { ok: true, result: body.result as T };
}

// ---------------------------------------------------------------------------
// The event: a community, a Champion, attendees, and one goal.
// ---------------------------------------------------------------------------

export type ExpoFixture = {
  stamp: string;
  groupId: string;
  goalId: string;
  champion: FixtureAccount;
  attendees: FixtureAccount[];
  target: number;
  /** The SEEDED starting total — a fixture number, not anybody's effort. */
  seededTotal: number;
};

export async function seedExpoEvent(opts: {
  tag: string;
  attendees: string[];
  target: number;
  seededTotal: number;
}): Promise<ExpoFixture> {
  const stamp = fixtureStamp(opts.tag);
  const champion = await seedAccount(`wsf-expo-champ-${stamp}@example.com`, 'Fixture Champion');
  const attendees: FixtureAccount[] = [];
  for (const [i, displayName] of opts.attendees.entries()) {
    attendees.push(await seedAccount(`wsf-expo-att${i}-${stamp}@example.com`, displayName));
  }
  const groupId = `expo-grp-${stamp}`;
  await seedCommunity({
    groupId,
    displayName: 'Fixture Expo Community',
    joinPolicy: 'public',
    members: [
      { uid: champion.uid, role: 'foundingChampion' },
      ...attendees.map((a) => ({ uid: a.uid, role: 'member' as const })),
    ],
  });
  const goalId = `expo-goal-${stamp}`;
  const now = Date.now();
  await firestoreWrite(`wsfGoals/${goalId}`, {
    ownerUid: { stringValue: champion.uid },
    communityGroupId: { stringValue: groupId },
    title: { stringValue: 'Fixture Expo Squats' },
    target: { integerValue: String(opts.target) },
    unit: { stringValue: 'squats' },
    status: { stringValue: 'active' },
    startsAt: tsField(new Date(now - 24 * 60 * 60_000)),
    endsAt: tsField(new Date(now + 7 * 24 * 60 * 60_000)),
    timezone: { stringValue: 'America/New_York' },
    repeatPolicy: { stringValue: 'multiple' },
    aggregateDisplayAuthorized: { booleanValue: true },
    crossingTracked: { booleanValue: true },
    createdAt: tsField(new Date(now)),
    updatedAt: tsField(new Date(now)),
  });
  await seedShards(goalId, opts.seededTotal);
  return {
    stamp,
    groupId,
    goalId,
    champion,
    attendees,
    target: opts.target,
    seededTotal: opts.seededTotal,
  };
}

/** Field-masked update, so the rest of the document is left exactly as it is. */
export async function firestorePatch(
  docPath: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const mask = Object.keys(fields)
    .map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`)
    .join('&');
  const url = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}?${mask}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: OWNER,
    body: JSON.stringify({ fields }),
  });
  if (!res.ok)
    throw new Error(`emulator patch ${docPath} failed: ${res.status} ${await res.text()}`);
}

// ---------------------------------------------------------------------------
// What the store says — the authority every screen claim is checked against.
// ---------------------------------------------------------------------------

type Row = Record<
  string,
  {
    stringValue?: string;
    integerValue?: string;
    booleanValue?: boolean;
    nullValue?: null;
    timestampValue?: string;
  }
>;

async function query(
  collectionId: string,
  filters: [string, string][],
): Promise<{ id: string; f: Row }[]> {
  const res = await fetch(
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
    {
      method: 'POST',
      headers: OWNER,
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId }],
          where: {
            compositeFilter: {
              op: 'AND',
              filters: filters.map(([fieldPath, value]) => ({
                fieldFilter: { field: { fieldPath }, op: 'EQUAL', value: { stringValue: value } },
              })),
            },
          },
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`${collectionId} query failed: ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as { document?: { name: string; fields?: Row } }[];
  return rows
    .filter((r) => r.document)
    .map((r) => ({ id: r.document!.name.split('/').pop()!, f: r.document!.fields ?? {} }));
}

export type ContributionRow = {
  id: string;
  goalId: string;
  userId: string;
  attemptId: string;
  count: number;
  unit: string;
  crossedTarget: boolean;
};

export async function contributionsOf(goalId: string, uid: string): Promise<ContributionRow[]> {
  return (
    await query('wsfContributions', [
      ['goalId', goalId],
      ['userId', uid],
    ])
  ).map((r) => ({
    id: r.id,
    goalId: r.f.goalId?.stringValue ?? '',
    userId: r.f.userId?.stringValue ?? '',
    attemptId: r.f.attemptId?.stringValue ?? '',
    count: Number(r.f.count?.integerValue ?? NaN),
    unit: r.f.unit?.stringValue ?? '',
    crossedTarget: r.f.crossedTarget?.booleanValue === true,
  }));
}

export type TurnEntryRow = {
  id: string;
  uid: string;
  goalId: string;
  activityUnit: string;
  calledName: string;
  code: string;
  status: string;
  assignedStationId: string | null;
  assignedStationLabel: string | null;
  attemptId: string | null;
  attemptStationId: string | null;
  resultAmount: number | null;
  endedBy: string | null;
};

export async function turnEntriesOf(goalId: string, uid: string): Promise<TurnEntryRow[]> {
  return (
    await query('wsfTurnEntries', [
      ['goalId', goalId],
      ['uid', uid],
    ])
  ).map((r) => ({
    id: r.id,
    uid: r.f.uid?.stringValue ?? '',
    goalId: r.f.goalId?.stringValue ?? '',
    activityUnit: r.f.activityUnit?.stringValue ?? '',
    calledName: r.f.calledName?.stringValue ?? '',
    code: r.f.code?.stringValue ?? '',
    status: r.f.status?.stringValue ?? '',
    assignedStationId: r.f.assignedStationId?.stringValue ?? null,
    assignedStationLabel: r.f.assignedStationLabel?.stringValue ?? null,
    attemptId: r.f.attemptId?.stringValue ?? null,
    attemptStationId: r.f.attemptStationId?.stringValue ?? null,
    resultAmount:
      r.f.resultAmount?.integerValue !== undefined ? Number(r.f.resultAmount.integerValue) : null,
    endedBy: r.f.endedBy?.stringValue ?? null,
  }));
}

/** The Living WE number, as the ten shards hold it. */
export async function shardTotal(goalId: string): Promise<number> {
  const res = await fetch(
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/wsfGoalCounters/${goalId}/shards?pageSize=50`,
    { headers: OWNER },
  );
  if (!res.ok) throw new Error(`shard read failed: ${res.status}`);
  const body = (await res.json()) as { documents?: { fields?: Row }[] };
  return (body.documents ?? []).reduce(
    (sum, d) => sum + Number(d.fields?.count?.integerValue ?? 0),
    0,
  );
}

export async function goalCrossing(goalId: string): Promise<{
  reachedAt: string | null;
  reachedSharedTotal: number | null;
  reachedAttemptId: string | null | undefined;
}> {
  const f = (await firestoreRead(`wsfGoals/${goalId}`)) as Row;
  return {
    reachedAt: f.reachedAt?.timestampValue ?? null,
    reachedSharedTotal:
      f.reachedSharedTotal?.integerValue !== undefined
        ? Number(f.reachedSharedTotal.integerValue)
        : null,
    reachedAttemptId:
      f.reachedAttemptId === undefined ? undefined : (f.reachedAttemptId.stringValue ?? null),
  };
}

/** The 45-second lease, run out on purpose: the server applies a lapsed lease
 * on its very next read, which is the no-show the room actually sees. */
export async function lapseLease(entryId: string): Promise<void> {
  await firestorePatch(`wsfTurnEntries/${entryId}`, {
    readyLeaseExpiresAt: tsField(new Date(Date.now() - 1_000)),
  });
}

// ---------------------------------------------------------------------------
// Browsers. Every device is its own context, so nothing is shared between them
// but the server.
// ---------------------------------------------------------------------------

export type Device = {
  context: BrowserContext;
  page: Page;
  errors: string[];
  assertNoCrash: (where: string) => void;
};

async function openDevice(
  browser: Browser,
  viewport: { width: number; height: number },
): Promise<Device> {
  const context = await browser.newContext({ viewport, locale: 'en-US' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return {
    context,
    page,
    errors,
    assertNoCrash: (where: string) => {
      expect(errors, `${where} must not crash`).toEqual([]);
    },
  };
}

/** An attendee's own phone, signed in as them. */
export async function openPhone(browser: Browser, who: FixtureAccount): Promise<Device> {
  const device = await openDevice(browser, { width: 390, height: 844 });
  const { page } = device;
  await page.goto('/signin');
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('wsf-signin-email').fill(who.email);
  await page.getByTestId('wsf-signin-password').fill(FIXTURE_PASSWORD);
  await page.getByTestId('wsf-signin-submit').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 40_000 });
  return device;
}

/**
 * A station screen in the hall, enrolled the real way: the screen asks for a
 * pairing code itself, the Champion approves THAT code for a slot, and the
 * screen claims its own credential. Nothing is planted in its storage.
 */
export async function openEnrolledStation(
  browser: Browser,
  fx: ExpoFixture,
  slot: 1 | 2,
): Promise<Device & { label: string }> {
  const device = await openDevice(browser, { width: 1280, height: 720 });
  const { page } = device;
  await page.goto(`/station/${fx.goalId}`);
  await expect(page.getByTestId('wsf-station-pairing-code')).toBeVisible({ timeout: 30_000 });
  const code = (await page.getByTestId('wsf-station-pairing-code').innerText()).replace(/\s+/g, '');
  const approved = await callAs(fx.champion.email, 'wsfApproveStation', {
    goalId: fx.goalId,
    code,
    slot,
  });
  expect(approved.ok, `station approval: ${JSON.stringify(approved)}`).toBe(true);
  await expect(page.getByTestId('wsf-station-screen')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('wsf-station-queue-count')).toBeVisible({ timeout: 30_000 });
  return { ...device, label: `Station ${slot}` };
}

/**
 * THE DELIBERATE PATH INTO THE LINE: the event page, answered as a phone, the
 * event's one activity standing selected, "Join the kiosk queue", a name the
 * person chose, and the one tap that sends it. Returns once their own queue
 * page is up.
 */
export async function joinLineFromEventPage(
  phone: Page,
  goalId: string,
  calledName: string,
): Promise<void> {
  await phone.goto(`/event/${goalId}`);
  const choice = phone.getByTestId('wsf-device-choice-personal');
  const member = phone.getByTestId('wsf-event-member');
  await expect(choice.or(member)).toBeVisible({ timeout: 40_000 });
  if (await choice.isVisible()) await choice.click();
  await expect(member).toBeVisible({ timeout: 40_000 });
  await phone.getByTestId('wsf-event-queue-start').click();
  await expect(phone.getByTestId('wsf-event-queue-name')).toBeVisible({ timeout: 15_000 });
  await phone.getByTestId('wsf-event-queue-name').fill(calledName);
  await phone.getByTestId('wsf-event-queue-join').click();
  await phone.waitForURL(new RegExp(`/queue/${goalId}`), { timeout: 30_000 });
  await expect(phone.getByTestId('wsf-queue-screen')).toBeVisible({ timeout: 30_000 });
}

/** Every visible character on a page, for "the hall never says X" checks. */
export async function pageText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText);
}
