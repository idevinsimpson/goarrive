/**
 * KIOSK-LIVE-POSE-2 — database.westayfit.rules.json, against the Realtime
 * Database emulator.
 *
 * The key is the capability. `meta` is written only by the server (Admin SDK)
 * and holds the one uid that may write `frame`, and the instant the key stops
 * working. These tests write `meta` with the Admin SDK exactly as wsfStartTurn
 * does, then act as a phone (signed in) or a kiosk (not signed in).
 *
 * All fixtures are synthetic and local to the demo-wsf-local emulators.
 */
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';

import { adminDb, frame, kiosk, packedPose, phone, rulesEnvironment, setMeta, uniq } from './harness';
import { mintPoseKey } from '../../src/live-pose';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await rulesEnvironment();
});

afterAll(async () => {
  await env.cleanup();
  await adminDb().goOffline();
});

/** A key whose `meta` names `writerUid` and is live for a minute. */
async function liveKey(writerUid: string, ttl = 60_000): Promise<string> {
  const key = mintPoseKey();
  await setMeta(key, { writerUid, expiresAt: Date.now() + ttl });
  return key;
}

const framePath = (key: string) => `wsfLivePose/${key}/frame`;

describe('the writer', () => {
  test('the member named in meta, signed in with a real provider, may write a frame, and anyone holding the key may read it', async () => {
    const uid = uniq('writer');
    const key = await liveKey(uid);
    await assertSucceeds(phone(env, uid).ref(framePath(key)).set(frame(1, 0, 0)));
    const read = await assertSucceeds(kiosk(env).ref(framePath(key)).once('value'));
    expect(read.val()).toEqual(frame(1, 0, 0));
    // A second frame, 50 ms on, with a higher seq.
    await assertSucceeds(phone(env, uid).ref(framePath(key)).set(frame(2, 50, 1)));
  });

  test('another uid may not write', async () => {
    const key = await liveKey(uniq('writer'));
    await assertFails(phone(env, uniq('other')).ref(framePath(key)).set(frame(1, 0, 0)));
  });

  test('an anonymous token for the right uid may not write', async () => {
    const uid = uniq('writer');
    const key = await liveKey(uid);
    await assertFails(phone(env, uid, 'anonymous').ref(framePath(key)).set(frame(1, 0, 0)));
  });

  test('a token with no sign-in provider claim, or an empty one, may not write', async () => {
    const uid = uniq('writer');
    const key = await liveKey(uid);
    // rules-unit-testing spreads these options over its default claims, so
    // `firebase: {}` really is a token without the provider claim.
    const bare = env.authenticatedContext(uid, { firebase: {} } as never).database();
    await assertFails(bare.ref(framePath(key)).set(frame(1, 0, 0)));
    await assertFails(phone(env, uid, '').ref(framePath(key)).set(frame(1, 0, 0)));
    await assertSucceeds(phone(env, uid).ref(framePath(key)).set(frame(1, 0, 0)));
  });

  test('a signed-out caller may not write', async () => {
    const key = await liveKey(uniq('writer'));
    await assertFails(kiosk(env).ref(framePath(key)).set(frame(1, 0, 0)));
  });

  test('the writer may not delete the frame', async () => {
    const uid = uniq('writer');
    const key = await liveKey(uid);
    await assertSucceeds(phone(env, uid).ref(framePath(key)).set(frame(1, 0, 0)));
    await assertFails(phone(env, uid).ref(framePath(key)).remove());
    await assertFails(phone(env, uid).ref(`${framePath(key)}/seq`).remove());
  });
});

describe('expiry', () => {
  test('after expiresAt, the frame can be neither written nor read', async () => {
    const uid = uniq('writer');
    const key = await liveKey(uid);
    await assertSucceeds(phone(env, uid).ref(framePath(key)).set(frame(1, 0, 0)));
    await setMeta(key, { writerUid: uid, expiresAt: Date.now() - 1 });
    await assertFails(phone(env, uid).ref(framePath(key)).set(frame(2, 50, 1)));
    await assertFails(kiosk(env).ref(framePath(key)).once('value'));
    await assertFails(phone(env, uid).ref(framePath(key)).once('value'));
  });

  test('a key with no meta at all can be neither written nor read', async () => {
    const key = mintPoseKey();
    const uid = uniq('writer');
    await assertFails(phone(env, uid).ref(framePath(key)).set(frame(1, 0, 0)));
    await assertFails(kiosk(env).ref(framePath(key)).once('value'));
  });
});

describe('the shape is exactly { seq, t, p, rep }', () => {
  async function refused(value: unknown, previous?: unknown) {
    const uid = uniq('writer');
    const key = await liveKey(uid);
    if (previous !== undefined) {
      await assertSucceeds(phone(env, uid).ref(framePath(key)).set(previous));
    }
    await assertFails(phone(env, uid).ref(framePath(key)).set(value));
  }

  test('a missing field is refused', async () => {
    const { seq, t, p } = frame(1, 0, 0);
    await refused({ seq, t, p });
    await refused({ t, p, rep: 0 });
    await refused({ seq, p, rep: 0 });
    await refused({ seq, t, rep: 0 });
  });

  test('an extra field is refused', async () => {
    await refused({ ...frame(1, 0, 0), uid: 'someone' });
    await refused({ ...frame(1, 0, 0), name: 'Ann' });
    await refused({ ...frame(1, 0, 0), image: 'x' });
  });

  test('seq must be an integer from 1 to 2^31 - 1', async () => {
    await refused(frame(0, 0, 0));
    await refused(frame(1.5, 0, 0));
    await refused(frame(2147483648, 0, 0));
    await refused({ ...frame(1, 0, 0), seq: '1' });
    const uid = uniq('writer');
    const key = await liveKey(uid);
    await assertSucceeds(phone(env, uid).ref(framePath(key)).set(frame(2147483647, 0, 0)));
  });

  test('t must be an integer from 0 to the key lifetime', async () => {
    await refused(frame(1, -1, 0));
    await refused(frame(1, 0.5, 0));
    await refused(frame(1, 120001, 0));
    const uid = uniq('writer');
    const key = await liveKey(uid);
    await assertSucceeds(phone(env, uid).ref(framePath(key)).set(frame(1, 120000, 0)));
  });

  test('p must be an 87-character base64url string', async () => {
    const good = packedPose();
    expect(good).toHaveLength(87);
    await refused(frame(1, 0, 0, good.slice(1)));
    await refused(frame(1, 0, 0, `${good}A`));
    await refused(frame(1, 0, 0, `${good.slice(1)}=`));
    await refused(frame(1, 0, 0, `${good.slice(1)}+`));
    await refused(frame(1, 0, 0, `${good.slice(1)}/`));
    await refused({ ...frame(1, 0, 0), p: 12345 });
  });

  test('rep must be an integer from 0 to 9999', async () => {
    await refused(frame(1, 0, -1));
    await refused(frame(1, 0, 10000));
    await refused(frame(1, 0, 1.5));
    const uid = uniq('writer');
    const key = await liveKey(uid);
    await assertSucceeds(phone(env, uid).ref(framePath(key)).set(frame(1, 0, 9999)));
  });
});

describe('ordering and rate', () => {
  test('a lower or equal seq is refused', async () => {
    const uid = uniq('writer');
    const key = await liveKey(uid);
    await assertSucceeds(phone(env, uid).ref(framePath(key)).set(frame(5, 0, 0)));
    await assertFails(phone(env, uid).ref(framePath(key)).set(frame(4, 1000, 0)));
    await assertFails(phone(env, uid).ref(framePath(key)).set(frame(5, 1000, 0)));
    await assertSucceeds(phone(env, uid).ref(framePath(key)).set(frame(6, 1000, 0)));
  });

  test('a t less than 50 ms after the stored t is refused (20 Hz at most)', async () => {
    const uid = uniq('writer');
    const key = await liveKey(uid);
    await assertSucceeds(phone(env, uid).ref(framePath(key)).set(frame(1, 1000, 0)));
    await assertFails(phone(env, uid).ref(framePath(key)).set(frame(2, 1049, 0)));
    await assertFails(phone(env, uid).ref(framePath(key)).set(frame(2, 900, 0)));
    await assertSucceeds(phone(env, uid).ref(framePath(key)).set(frame(2, 1050, 0)));
  });

  test('a write to one field alone is refused, so the seq and rate checks cannot be stepped around', async () => {
    const uid = uniq('writer');
    const key = await liveKey(uid);
    await assertSucceeds(phone(env, uid).ref(framePath(key)).set(frame(1, 0, 0)));
    const db = phone(env, uid);
    await assertFails(db.ref(`${framePath(key)}/p`).set(packedPose(9)));
    await assertFails(db.ref(`${framePath(key)}/rep`).set(3));
    await assertFails(db.ref(framePath(key)).update({ p: packedPose(9), rep: 3 }));
  });
});

describe('nothing but frame is ever reachable', () => {
  test('/wsfLivePose cannot be listed, by anyone', async () => {
    const uid = uniq('writer');
    await liveKey(uid);
    await assertFails(kiosk(env).ref('wsfLivePose').once('value'));
    await assertFails(phone(env, uid).ref('wsfLivePose').once('value'));
    await assertFails(kiosk(env).ref('/').once('value'));
  });

  test('a key node as a whole cannot be read or written', async () => {
    const uid = uniq('writer');
    const key = await liveKey(uid);
    await assertFails(kiosk(env).ref(`wsfLivePose/${key}`).once('value'));
    await assertFails(phone(env, uid).ref(`wsfLivePose/${key}`).once('value'));
    await assertFails(phone(env, uid).ref(`wsfLivePose/${key}`).set({ frame: frame(1, 0, 0) }));
  });

  test('meta is never readable or writable by a client, the writer included', async () => {
    const uid = uniq('writer');
    const key = await liveKey(uid);
    const meta = `wsfLivePose/${key}/meta`;
    await assertFails(kiosk(env).ref(meta).once('value'));
    await assertFails(phone(env, uid).ref(meta).once('value'));
    await assertFails(phone(env, uid).ref(meta).set({ writerUid: uid, expiresAt: Date.now() + 999_999 }));
    await assertFails(phone(env, uid).ref(`${meta}/expiresAt`).set(Date.now() + 999_999));
    await assertFails(kiosk(env).ref(meta).set({ writerUid: 'x', expiresAt: Date.now() + 1 }));
    await assertFails(phone(env, uid).ref(meta).remove());
  });

  test('a key nobody minted cannot be created by a client', async () => {
    const uid = uniq('writer');
    const key = mintPoseKey();
    await assertFails(
      phone(env, uid)
        .ref(`wsfLivePose/${key}`)
        .set({ meta: { writerUid: uid, expiresAt: Date.now() + 60_000 }, frame: frame(1, 0, 0) })
    );
  });

  test('nothing outside /wsfLivePose is readable or writable', async () => {
    const uid = uniq('writer');
    await assertFails(phone(env, uid).ref('anything').set(1));
    await assertFails(kiosk(env).ref('anything').once('value'));
  });
});
