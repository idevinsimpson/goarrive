/**
 * KIOSK-LIVE-POSE-2 (#365 6105637770): the member's stick figure, live on the
 * station screen during their turn.
 *
 * During a station turn the member's phone counts reps with its own camera and
 * the existing counter, unchanged. The paired kiosk has no camera. It shows
 * that member's stick figure, rep count and countdown from frames the phone
 * writes to the Realtime Database.
 *
 * THE CAPABILITY. When a turn becomes `active` (wsfStartTurn), the server mints
 * a 256-bit key and, with the Admin SDK, writes
 * `/wsfLivePose/{key}/meta = { writerUid, expiresAt }`. The key reaches exactly
 * two callers: the member whose turn it is (wsfMyTurn), and the station serving
 * that turn (wsfTurnState, station secret). database.westayfit.rules.json lets
 * that member write `frame`, and anyone holding the key read it, both only
 * until `expiresAt`. There is no new kind of login: the kiosk keeps its
 * station-secret identity, and no custom token, Auth principal or IAM binding
 * is created.
 *
 * NEVER A CONTRIBUTION. No completion path reads the Realtime Database, a frame,
 * its `rep` or the key. What a turn records comes from the Record on the
 * station or the phone, through performContribution, exactly as before.
 *
 * THE SWITCH. WSF_LIVE_POSE === '1' turns this on. Anything else means no key
 * is minted, every `livePose` is null, and nothing here touches the Realtime
 * Database, deletes included.
 *
 * BEST EFFORT. Every Realtime Database call is bounded by a deadline, caught
 * and logged with an error code only, and none of them fails or holds up a
 * turn operation. `expiresAt` already makes
 * a stale key unreadable and unwritable, so a failed delete leaves an inert node
 * (its `meta`, uid included, maybe the last frame), not an open door.
 *
 * KEYS STAY OUT OF THE LOGS. This module logs an operation and an error code,
 * never a key, a uid or a name. The SDK logs a write the server refuses as
 * `set at <path> failed` or `update at <path> failed`, path included (W3 F1,
 * #622 6106926401), so no write here is made at a path that holds a key: each
 * one is an `update()` at `/wsfLivePose` whose child path carries the key, and
 * a refusal reads `update at /wsfLivePose failed: <status>`. The SDK's own
 * debug log, which would print values, is off unless enableLogging is called,
 * and nothing in this codebase calls it.
 */
import { randomBytes } from 'crypto';
import { getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

/** The one Realtime Database path this feature uses. */
export const LIVE_POSE_ROOT = 'wsfLivePose';

/** The owner's timeout: a key works for two minutes from the moment its turn starts. */
export const LIVE_POSE_TTL_MS = 120_000;

/** 32 CSPRNG bytes, base64url without padding: exactly 43 characters. */
const POSE_KEY_BYTES = 32;
const POSE_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** What a key holder is given: the key, and the instant it stops working. */
export type LivePose = { key: string; expiresAt: number };

/** The kill switch, read on every call so it can be flipped without a deploy of code. */
export function livePoseEnabled(): boolean {
  return process.env.WSF_LIVE_POSE === '1';
}

export function mintPoseKey(): string {
  return randomBytes(POSE_KEY_BYTES).toString('base64url');
}

export function normalizePoseKey(v: unknown): string | null {
  return typeof v === 'string' && POSE_KEY_PATTERN.test(v) ? v : null;
}

/** The key and its expiry while it still works, else null. */
export function livePoseIfLive(key: unknown, expiresAt: unknown, now: number): LivePose | null {
  const k = normalizePoseKey(key);
  if (!k) return null;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || now >= expiresAt) return null;
  return { key: k, expiresAt };
}

/**
 * The project's default Realtime Database instance, derived from the project
 * id: no URL env var. The owner creates it in us-central1, whose default
 * instance is `<project>-default-rtdb.firebaseio.com`. Under the emulator,
 * FIREBASE_DATABASE_EMULATOR_HOST redirects this same URL to the emulator,
 * namespace `<project>-default-rtdb`.
 */
export function livePoseDatabaseUrl(projectId: string): string {
  return `https://${projectId}-default-rtdb.firebaseio.com`;
}

function currentProjectId(): string | null {
  const fromApp = getApp().options.projectId;
  const id = typeof fromApp === 'string' && fromApp !== '' ? fromApp : process.env.GCLOUD_PROJECT;
  return typeof id === 'string' && id !== '' ? id : null;
}

/**
 * The one door to the Realtime Database: `/wsfLivePose`, the parent of every
 * key. Every write goes through here as an `update()` whose child path holds
 * the key, never at a path that holds one (see KEYS STAY OUT OF THE LOGS).
 * The SDK is loaded here, on first use, so a deployment with the switch off
 * never loads it at all and no WSF function's cold start pays for it.
 */
async function poseRoot() {
  const projectId = currentProjectId();
  if (!projectId) throw Object.assign(new Error('no project id'), { code: 'no-project-id' });
  const { getDatabaseWithUrl } = await import('firebase-admin/database');
  return getDatabaseWithUrl(livePoseDatabaseUrl(projectId)).ref(LIVE_POSE_ROOT);
}

/** Only a minted key is ever written under: it can hold no `/` or `.`. */
function wellFormed(key: string): string {
  const k = normalizePoseKey(key);
  if (!k) throw Object.assign(new Error('not a pose key'), { code: 'bad-key' });
  return k;
}

/**
 * How long one Realtime Database call may hold a turn operation. The SDK
 * queues a write it cannot send and never settles it while the database is
 * unreachable (no instance yet, an outage), so without this a Record or a
 * Cancel whose Firestore commit already succeeded would hang until the
 * function timed out.
 */
export const LIVE_POSE_DEADLINE_MS = 3_000;

/** `op`, or a `deadline-exceeded` error once `ms` have passed. */
export async function withinDeadline<T>(op: Promise<T>, ms = LIVE_POSE_DEADLINE_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error('deadline exceeded'), { code: 'deadline-exceeded' })),
      ms
    );
  });
  try {
    return await Promise.race([op, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** An operation name and an error code. Never a key, a uid or a name. */
function logFailure(operation: string, e: unknown): void {
  const code = (e as { code?: unknown } | null | undefined)?.code;
  console.error('[wsfLivePose]', operation, 'failed', typeof code === 'string' ? code : 'unknown');
}

/** Delete one key's node. True when the Realtime Database confirmed it. */
export async function removePoseKey(key: string): Promise<boolean> {
  if (!livePoseEnabled()) return false;
  try {
    const k = wellFormed(key);
    const root = await poseRoot();
    await withinDeadline(root.update({ [k]: null }));
    return true;
  } catch (e) {
    logFailure('remove', e);
    return false;
  }
}

/**
 * Take a key down: delete its node, then clear the station's cleanup pointer
 * (`livePoseKey`) if it still names this key. The pointer is cleared only
 * after the delete succeeded, so a delete that failed is retried by the next
 * wsfTurnState or wsfStationState that sees it.
 */
export async function retirePoseKey(key: string, stationId: string | null): Promise<void> {
  if (!(await removePoseKey(key))) return;
  if (!stationId) return;
  try {
    const db = getFirestore();
    const stationRef = db.doc(`wsfKioskStations/${stationId}`);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(stationRef);
      if (snap.exists && snap.get('livePoseKey') === key) tx.update(stationRef, { livePoseKey: null });
    });
  } catch (e) {
    logFailure('unlink', e);
  }
}

/**
 * Make a freshly minted key work, after the commit that started its turn.
 * Arming is confirm-or-delete: unless step 3 confirms the turn, the key's
 * node is taken down.
 *
 * 1. Delete the station's earlier key, if one is still recorded. The start's
 *    own transaction already moved the station's pointer to the new key.
 * 2. Write `meta`. Until this lands, the rules refuse every read and write
 *    under the key.
 * 3. Confirm the turn is still running with this key. A turn that ended between
 *    the commit and step 2 ran its own delete before `meta` existed, so the key
 *    is taken down here instead.
 *
 * A `meta` write that fails or misses its deadline is not cancelled: the SDK
 * keeps it queued and may deliver it later, after the turn's own delete has
 * run (W3 F2, #622 6106926401). So the delete is queued behind it at once, on
 * the same connection. The SDK sends one connection's writes in order and the
 * server applies them in order, so whenever that `meta` lands, the delete
 * lands after it. It is not awaited: a database that did not answer in time
 * would only hold the turn for another deadline, and waiting changes nothing
 * about the order. A confirmation that cannot be read takes the node down too.
 */
export async function armPoseKey(args: {
  key: string;
  writerUid: string;
  expiresAt: number;
  earlierKey: string | null;
  stationId: string;
  stillLive: () => Promise<boolean>;
}): Promise<void> {
  if (!livePoseEnabled()) return;
  if (args.earlierKey && args.earlierKey !== args.key) await removePoseKey(args.earlierKey);
  let root: Awaited<ReturnType<typeof poseRoot>>;
  let key: string;
  try {
    key = wellFormed(args.key);
    root = await poseRoot();
  } catch (e) {
    logFailure('arm', e);
    return;
  }
  try {
    await withinDeadline(root.update({ [`${key}/meta`]: { writerUid: args.writerUid, expiresAt: args.expiresAt } }));
  } catch (e) {
    logFailure('arm', e);
    void root.update({ [key]: null }).catch((cleanup) => logFailure('cleanup', cleanup));
    return;
  }
  let live: boolean;
  try {
    live = await args.stillLive();
  } catch (e) {
    logFailure('confirm', e);
    await removePoseKey(key);
    return;
  }
  if (!live) await retirePoseKey(key, args.stationId);
}
