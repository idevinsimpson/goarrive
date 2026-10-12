/**
 * PROFILE-PHOTOS-FIREBASE-1 — the owner's side: upload, replace, remove, the
 * one-time portrait decision, the trusted JPEG rebuild, and the generations
 * that keep a retried, stale or concurrent write truthful.
 *
 * Scope: #578 6043515827 (frozen) and #365 6043554729. The audience side
 * (who else may see a face) is wsf-profile-photo-privacy.test.ts.
 *
 * Runs against the local Firestore emulator via `func.run(request)`. Every
 * account and image is synthetic.
 */
process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import {
  wsfMyProfilePhoto,
  wsfRemoveProfilePhoto,
  wsfSetPortraitDecision,
  wsfSetProfilePhoto,
} from '../../src/index';
import { canonicalJpeg } from '../../src/profilePhotos';

// SYNTHETIC FIXTURES, not anyone's photo: flat shapes drawn on a canvas in headless Chromium
// (canvas.toBlob('image/jpeg', 0.7)). Square 256px crops A and B, a 300x200 crop, and a 48px crop.
const JPEG_A =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABh' +
  'Y3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAAB' +
  'UAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAA' +
  'AAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9Y' +
  'WVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAM' +
  'ZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEY' +
  'Ix8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7' +
  'Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAEAAQADASIAAhEBAxEB/8QAGwABAAMBAQEBAAAAAAAAAAAAAAUG' +
  'BwIEAwH/xAAyEAEAAQMBAwoGAgMBAAAAAAAAAQIDBBEFctEGFiEiMTNBU4GREhNRYXGhMkIUI8FS/8QAGQEBAQEBAQEAAAAAAAAA' +
  'AAAAAAMEAQIF/8QAIREBAAICAgIDAQEAAAAAAAAAAAECAxFBUQQSEyExYXH/2gAMAwEAAhEDEQA/APUA+u+CAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA+WVlWcOzN2/' +
  'XFNMe8/aB2I3+Pq82TtHDxNfn36KZj+uus+0K3tDlFk5MzRj62LX2nrT6+HoiJmZmZmdZnxWjH21U8aZ+7LPf5VY9M6WMeu596p+' +
  'Hi8tXKvImerjW4/MzKCHv0qvGDHHCdp5V5ET1sa3P4mYeqxyqx650v49dv70z8Uf8VgPSpODHPC9420cPL0+Rfoqmf666T7S9LO4' +
  'mYmJidJjxS+z+UWTjTFGRrftfeetHr4+rxOPpC/jTH3VbR8sXKs5lmLtiuKqZ94+0vqiyzGv0AHAAAAAAAAAAAAAAAAAH5VVFFM1' +
  'VTEUxGszPgD4Z2bawMaq9dnojopp8ap+imZ2ff2hfm7eq3aY7KY+z6bW2jVtHLmvWYtU9Fun7fX1eJppTT6OHF6Ruf0Ae1wAAAAA' +
  'Hpwc+/s+/F2zVvUz2VR91zwc21n41N61PRPRVT40z9JUN7dk7Rq2dlxXrM2q+i5T9vr6PF6bQzYveNx+ruPymqK6YqpmJiY1iY8X' +
  '6zPnAAAAAAAAAAAAAAAACF5TZvycSnGonSq9/LdhNKXt7I/yNrXenWm31I9O396qY43K+Cvtf/EeA0PogAAAAAAAAALVyazZvYlW' +
  'NXOtVn+O7KaUzYOROPta106U3OpPr2fvRc2fJGpfOz19b/6AJoAAAAAAAAAAAAAAEzpGrPbtc3Ltdye2qqZaBc1+XVp26Sz1bFy2' +
  'eLyALNgAAAAAAAAADq1XNu7RcjtpqifZoUTrGrO2hW9fl069ukI5eGPyuHQCLGAAAAAAAAAAAAAAM+v25s5Fy1PbRVNPtLQVO5Q4' +
  '02Nq11adW7EVx/39q4p+9NXjTq0wjAF24AAAAAAAAAB3YtzeyLdqP71xT7y0FTuT2PN/atFWnVtRNc/8/a4oZZ+9MPkzu0QAJMoA' +
  'AAAAAAAAAAAAAieUWDOVgfOojW5Y635p8ePoljtjSXYnU7eq2ms7hnYktt7MnAyfjoj/AEXJ1pn/AMz9Ea1RO42+rW0WjcADroAA' +
  'AAAACS2Jsyc/KiuuP9Fudap/9T9HJnUbctaKxuU5ydwf8XA+dXGly/1vxT4cfVLHZ0QMszudvlWtNp3IA48gAAAAAAAAAAAAAAAP' +
  'nkY9rKsVWb1PxUVR0wpu09lXtm3et17VX8bkR+p+krs5uW6L1ubdyiK6Ko0mJjWJe62mq2PLNJ/jPRYNocmaombmDOseVVPTH4ni' +
  'grtm7YuTbu26qKo8Ko0aItE/jfTJW/44AdewAAd2rN2/ci3Zt1V1T4Uxqntn8mapmLmdVpHlUz0+s8HJtEfrxfJWn6jNmbKvbSu9' +
  'XqWqf5XJj9R9ZXLHx7WLYps2afhopjoh1bt0WbcW7dEUUUxpERGkQ6Z7WmzBkyzef4APCIAAAAAAAAAAAAAAAAAAAA4vWLORR8F6' +
  '1Tcp+lUauwdRV7k3s+7OtNNdrcq46vNVyUszPVyrkfmmJTw9e9u1Iy3jlA08lLMT1sq5P4piHps8m9nWp1qpru79XDRKh727Jy3n' +
  'lxZsWcej4LNqm3T9KY0dg8pgA4AAAAAAAAAAAAAAAAKxXyoy6blVMWLPRMx2TxWdnt3vq96VccRO9tXj0rbe4TPOrL8iz7TxOdWX' +
  '5Fn2nihBX0r01fDTpN86svyLPtPE51ZfkWfaeKED0r0fDTpN86svyLPtPE51ZfkWfaeKED0r0fDTpN86svyLPtPE51ZfkWfaeKED' +
  '0r0fDTpN86svyLPtPE51ZfkWfaeKED0r0fDTpN86svyLPtPE51ZfkWfaeKED0r0fDTpN86svyLPtPE51ZfkWfaeKED0r0fDTpN86' +
  'svyLPtPE51ZfkWfaeKED0r0fDTpO0cqMuq5TTNiz0zEdk8VnZ7a76jehoSWSIjWmXyKVrrUACTKAAAAAAAAAAM9u99XvS0Jnt3vq' +
  '96VsXLZ4vLkBZsAAAAAAAAAAAAAAdWu+o3oaEz2131G9DQkcvDH5XAAixgAAAAAAAAADPbvfV70tCZ7d76velbFy2eLy5AWbAAAA' +
  'AAAAAAAAAAHVrvqN6GhM9td9RvQ0JHLwx+VwAIsYAAAAAAAAAAz2731e9LQme3e+r3pWxctni8uQFmwAAAAAAAAAAAAAB1a76jeh' +
  'oTPbXfUb0NCRy8MflcACLGAAAAAAAAAAM9u99XvS0Jnt3vq96VsXLZ4vLkBZsAAAAAAAAAAAAAAdWu+o3oaEz2131G9DQkcvDH5X' +
  'AAixgAAAP//Z';
const JPEG_B =
  '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';
const JPEG_WIDE =
  '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';
const JPEG_TINY =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABh' +
  'Y3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAAB' +
  'UAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAA' +
  'AAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9Y' +
  'WVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAM' +
  'ZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEY' +
  'Ix8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7' +
  'Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAwADADASIAAhEBAxEB/8QAGgAAAgMBAQAAAAAAAAAAAAAAAAUB' +
  'AgQDBv/EACYQAAIBBAEBCQEAAAAAAAAAAAECAAMEBRETQRIVITE0UVNxcpH/xAAZAQEBAAMBAAAAAAAAAAAAAAAABQIDBAb/xAAe' +
  'EQACAgICAwAAAAAAAAAAAAAAAQIRBBITIQMUUf/aAAwDAQACEQMRAD8AvCEh3WmhdzpVGyZbPREwiG5y9eo54Txp08NkwtsvXpuO' +
  'Y8idfDRE5va8d0B9CQjrUQOh2rDYMmdICY8sWGPfXuN/W5slaiLVpsjjasNETGa2i0DykJtuMTc0nPGvInQjz/kLfE3NVxyLxp1J' +
  '8/5JPFO6oDTEljj037nX1ubJWmi0qaog0qjQEtK0FrFIBE2Uu7ijeFKdUqvZB0I5iDMevP5E05Lah0Dl3jefO0O8bz52maEnck/o' +
  'GmLu7iteBKlUsvZJ0Y5iDD+vH5MfyjjNuHYP/9k=';

type Data = Record<string, unknown>;
type OwnState = {
  revision: number;
  photo: { token: string; revision: number; side: number; jpegBase64: string } | null;
  portrait: { decision: 'used' | 'skipped' | 'removed' | null; eligible: boolean };
  replayed?: boolean;
};

function callAs(fn: unknown, uid: string | null, data: Data) {
  return (fn as { run: (r: never) => Promise<unknown> }).run({
    data,
    auth: uid ? { uid, token: { email_verified: true } } : undefined,
    rawRequest: { ip: '127.0.0.1', headers: {} },
    acceptsStreaming: false,
  } as never);
}

async function attempt<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: HttpsError }> {
  try {
    return { ok: true as const, value: await p };
  } catch (e) {
    return { ok: false as const, error: e as HttpsError };
  }
}

function refused(r: { ok: boolean; error?: HttpsError }, code: string, message?: string | RegExp) {
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error.code).toBe(code);
    if (typeof message === 'string') expect(r.error.message).toBe(message);
    else if (message) expect(r.error.message).toMatch(message);
  }
}

let seq = 0;
const uniq = (p: string) => `${p}_${Date.now().toString(36)}_${(seq += 1)}`;
const op = () => uniq('op').replace(/[^A-Za-z0-9_-]/g, '');

const mine = (uid: string) => callAs(wsfMyProfilePhoto, uid, {}) as Promise<OwnState>;
const upload = (uid: string, jpegBase64: string, expectedRevision: number, extra: Data = {}) =>
  callAs(wsfSetProfilePhoto, uid, { jpegBase64, expectedRevision, operationId: op(), ...extra }) as Promise<OwnState>;
const remove = (uid: string, expectedRevision: number, operationId = op()) =>
  callAs(wsfRemoveProfilePhoto, uid, { expectedRevision, operationId }) as Promise<OwnState>;

/** A copy of a JPEG with a synthetic EXIF/GPS APP1 after SOI and junk after EOI. */
function tainted(b64: string): string {
  const src = Buffer.from(b64, 'base64');
  const payload = Buffer.from('Exif\0\0SYNTHETIC-GPS-48.8584N-2.2945E-DO-NOT-STORE');
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 255]), payload]);
  const note = Buffer.from('SYNTHETIC-NOTE');
  const com = Buffer.concat([Buffer.from([0xff, 0xfe, (note.length + 2) >> 8, (note.length + 2) & 255]), note]);
  return Buffer.concat([src.subarray(0, 2), app1, com, src.subarray(2), Buffer.from('TRAILING-JUNK')]).toString('base64');
}

/** Replace the first marker byte `from` (after SOI) with `to`, to build a structurally refused file. */
function withMarker(b64: string, from: number, to: number): string {
  const b = Buffer.from(b64, 'base64');
  for (let i = 2; i < b.length - 1; i += 1) if (b[i] === 0xff && b[i + 1] === from) { b[i + 1] = to; break; }
  return b.toString('base64');
}

beforeAll(async () => {
  await getFirestore().doc('_warmup/wsf-profile-photos').set({ at: Date.now() }, { merge: true });
}, 30_000);

describe('the own photo: upload, second-session read, replace, remove', () => {
  test('upload on A, then a fresh read (a second device) returns the same photo; nothing but the rebuilt JPEG is stored', async () => {
    const a = uniq('photoA');
    expect(await mine(a)).toEqual({ revision: 0, photo: null, portrait: { decision: null, eligible: true } });

    const up = await upload(a, tainted(JPEG_A), 0);
    expect(up.replayed).toBe(false);
    expect(up.revision).toBe(1);
    expect(up.photo?.token).toMatch(/^ph_[A-Za-z0-9_-]{24}$/);
    expect(up.photo?.side).toBe(256);
    expect(up.portrait).toEqual({ decision: null, eligible: false });

    // The second session: nothing local, only the server.
    const again = await mine(a);
    expect(again.photo).toEqual(up.photo);
    const bytes = Buffer.from(again.photo!.jpegBase64, 'base64');
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(bytes.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    expect(bytes.includes('SYNTHETIC-GPS')).toBe(false);
    expect(bytes.includes('SYNTHETIC-NOTE')).toBe(false);
    expect(bytes.includes('TRAILING-JUNK')).toBe(false);
    expect(bytes.includes('JFIF')).toBe(false);
    // Re-validating the stored bytes changes nothing: the rebuild is canonical.
    const re = canonicalJpeg(bytes);
    expect(re.ok && re.jpeg.equals(bytes)).toBe(true);

    // The stored document holds the bytes, the token and the generation — and no source file name, URL or metadata.
    const stored = (await getFirestore().doc(`wsfProfilePhotos/${a}`).get()).data()!;
    expect(Object.keys(stored).sort()).toEqual(
      ['jpeg', 'lastOperationId', 'photoToken', 'portraitDecision', 'revision', 'side', 'updatedAt', 'userId'].sort()
    );
  }, 30_000);

  test('replace mints a new token and revision; remove clears bytes and token everywhere and is not resurrected', async () => {
    const a = uniq('photoA');
    const first = await upload(a, JPEG_A, 0);
    const second = await upload(a, JPEG_B, first.revision);
    expect(second.revision).toBe(2);
    expect(second.photo!.token).not.toBe(first.photo!.token);
    expect(second.photo!.jpegBase64).not.toBe(first.photo!.jpegBase64);

    const gone = await remove(a, second.revision);
    expect(gone).toMatchObject({ revision: 3, photo: null });
    const stored = (await getFirestore().doc(`wsfProfilePhotos/${a}`).get()).data()!;
    expect(stored.jpeg).toBeNull();
    expect(stored.photoToken).toBeNull();
    expect((await mine(a)).photo).toBeNull();

    // A stale upload that was started before the removal finishes now: refused, nothing comes back.
    refused(await attempt(upload(a, JPEG_A, second.revision)), 'failed-precondition', 'Your photo changed on another device. Refresh and try again.');
    expect((await mine(a)).photo).toBeNull();
  }, 30_000);

  test('a retried upload or removal (lost answer) returns its own settled result and writes once', async () => {
    const a = uniq('photoA');
    const opId = op();
    const first = (await callAs(wsfSetProfilePhoto, a, { jpegBase64: JPEG_A, expectedRevision: 0, operationId: opId })) as OwnState;
    const retry = (await callAs(wsfSetProfilePhoto, a, { jpegBase64: JPEG_B, expectedRevision: 0, operationId: opId })) as OwnState;
    expect(retry.replayed).toBe(true);
    expect(retry.revision).toBe(1);
    expect(retry.photo).toEqual(first.photo);

    const rmId = op();
    const gone = await remove(a, 1, rmId);
    const rmRetry = await remove(a, 1, rmId);
    expect(rmRetry.replayed).toBe(true);
    expect(rmRetry.revision).toBe(gone.revision);
    expect(rmRetry.photo).toBeNull();
  }, 30_000);

  test('two devices racing from the same revision: exactly one write lands, the other is refused as stale', async () => {
    const a = uniq('photoA');
    const base = await upload(a, JPEG_A, 0);
    const results = await Promise.all([
      attempt(upload(a, JPEG_B, base.revision)),
      attempt(remove(a, base.revision)),
      attempt(upload(a, JPEG_B, base.revision)),
    ]);
    const ok = results.filter((r) => r.ok);
    expect(ok).toHaveLength(1);
    for (const r of results.filter((x) => !x.ok)) refused(r, 'failed-precondition', /changed on another device/);
    expect((await mine(a)).revision).toBe(base.revision + 1);
  }, 30_000);

  test('accounts never cross: each upload lands only on the caller, whatever the request carries', async () => {
    const a = uniq('photoA');
    const b = uniq('photoB');
    await callAs(wsfSetProfilePhoto, a, { jpegBase64: JPEG_A, expectedRevision: 0, operationId: op(), uid: b, userId: b });
    expect((await mine(a)).photo).not.toBeNull();
    expect((await mine(b)).photo).toBeNull();
    // The same operation id on another account is that account's own operation.
    const shared = op();
    await callAs(wsfSetProfilePhoto, a, { jpegBase64: JPEG_A, expectedRevision: 1, operationId: shared });
    const onB = (await callAs(wsfSetProfilePhoto, b, { jpegBase64: JPEG_B, expectedRevision: 0, operationId: shared })) as OwnState;
    expect(onB.replayed).toBe(false);
    expect(onB.photo!.jpegBase64).not.toBe((await mine(a)).photo!.jpegBase64);
  }, 30_000);
});

describe('the one-time portrait decision, persisted across devices', () => {
  test('skip is saved once and survives a second session; the offer never returns', async () => {
    const a = uniq('photoA');
    const skipped = (await callAs(wsfSetPortraitDecision, a, { decision: 'skipped' })) as OwnState;
    expect(skipped.portrait).toEqual({ decision: 'skipped', eligible: false });
    expect((await mine(a)).portrait).toEqual({ decision: 'skipped', eligible: false });
    // A portrait upload after a skip is refused; an ordinary upload is fine and does not change the decision.
    refused(await attempt(upload(a, JPEG_A, 0, { source: 'portrait' })), 'failed-precondition', 'Your portrait choice is already saved.');
    const lib = await upload(a, JPEG_A, 0, { source: 'library' });
    expect(lib.portrait).toEqual({ decision: 'skipped', eligible: false });
  }, 30_000);

  test('a portrait upload records "used"; it never overwrites an existing photo', async () => {
    const a = uniq('photoA');
    const used = await upload(a, JPEG_A, 0, { source: 'portrait' });
    expect(used.portrait).toEqual({ decision: 'used', eligible: false });
    const b = uniq('photoB');
    await upload(b, JPEG_A, 0, { source: 'camera' });
    refused(await attempt(upload(b, JPEG_B, 1, { source: 'portrait' })), 'failed-precondition', 'You already have a photo.');
  }, 30_000);

  test('removing a photo with no decision records "removed", so no device prompts again; decisions are never cleared', async () => {
    const a = uniq('photoA');
    const up = await upload(a, JPEG_A, 0);
    const gone = await remove(a, up.revision);
    expect(gone.portrait).toEqual({ decision: 'removed', eligible: false });
    const later = (await callAs(wsfSetPortraitDecision, a, { decision: 'skipped' })) as OwnState;
    expect(later.portrait.decision).toBe('removed');
    refused(await attempt(callAs(wsfSetPortraitDecision, a, { decision: 'used' })), 'invalid-argument');
    refused(await attempt(callAs(wsfSetPortraitDecision, a, { decision: null })), 'invalid-argument');
  }, 30_000);
});

describe('the trusted side refuses what is not the small square JPEG crop', () => {
  const NOT_JPEG = 'That photo could not be used. Choose a JPEG image.';
  test('shape, size, encoding and container checks, each writing nothing', async () => {
    const a = uniq('photoA');
    const cases: [string, Data, string][] = [
      ['not square', { jpegBase64: JPEG_WIDE }, 'That photo must be a square crop.'],
      ['too small', { jpegBase64: JPEG_TINY }, 'That photo must be between 96 and 512 pixels square.'],
      ['a PNG', { jpegBase64: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64') }, NOT_JPEG],
      ['a data: URL', { jpegBase64: `data:image/jpeg;base64,${JPEG_A}` }, NOT_JPEG],
      ['whitespace in base64', { jpegBase64: `${JPEG_A.slice(0, 40)}\n${JPEG_A.slice(40)}` }, NOT_JPEG],
      ['arithmetic-coded frame', { jpegBase64: withMarker(JPEG_A, 0xc0, 0xc9) }, NOT_JPEG],
      ['no end of image', { jpegBase64: Buffer.from(JPEG_A, 'base64').subarray(0, -2).toString('base64') }, NOT_JPEG],
      ['truncated mid-file', { jpegBase64: Buffer.from(JPEG_A, 'base64').subarray(0, 300).toString('base64') }, NOT_JPEG],
      ['too large', { jpegBase64: Buffer.alloc(170 * 1024, 7).toString('base64') }, 'That photo is too large.'],
      ['missing', {}, NOT_JPEG],
    ];
    for (const [name, data, msg] of cases) {
      const r = await attempt(callAs(wsfSetProfilePhoto, a, { expectedRevision: 0, operationId: op(), ...data }));
      expect([name, r.ok]).toEqual([name, false]);
      if (!r.ok) expect([name, r.error.code, r.error.message]).toEqual([name, 'invalid-argument', msg]);
    }
    expect(await mine(a)).toEqual({ revision: 0, photo: null, portrait: { decision: null, eligible: true } });
    expect((await getFirestore().doc(`wsfProfilePhotos/${a}`).get()).exists).toBe(false);
  }, 30_000);

  test('a table segment carrying extra bytes is refused (no hidden payload in a DQT or DHT)', () => {
    const b = Buffer.from(JPEG_A, 'base64');
    for (const marker of [0xdb, 0xc4]) {
      const at = b.indexOf(Buffer.from([0xff, marker]));
      const len = b.readUInt16BE(at + 2);
      // Zero padding parses as the start of another table, so only the exact-length check can refuse it.
      for (const pad of [Buffer.alloc(4), Buffer.from('HIDE')]) {
        const padded = Buffer.concat([
          b.subarray(0, at + 2),
          Buffer.from([(len + pad.length) >> 8, (len + pad.length) & 255]),
          b.subarray(at + 4, at + 2 + len),
          pad,
          b.subarray(at + 2 + len),
        ]);
        expect([marker, pad.toString('hex'), canonicalJpeg(padded)]).toEqual([marker, pad.toString('hex'), { ok: false, reason: 'notJpeg' }]);
      }
      // One byte short: the last table declares more than the segment holds.
      const short = Buffer.concat([
        b.subarray(0, at + 2),
        Buffer.from([(len - 1) >> 8, (len - 1) & 255]),
        b.subarray(at + 4, at + 2 + len - 1),
        b.subarray(at + 2 + len),
      ]);
      expect([marker, 'short', canonicalJpeg(short)]).toEqual([marker, 'short', { ok: false, reason: 'notJpeg' }]);
    }
  });

  test('write ids are required and literal; signed-out callers are refused everywhere', async () => {
    const a = uniq('photoA');
    refused(await attempt(callAs(wsfSetProfilePhoto, a, { jpegBase64: JPEG_A, operationId: op() })), 'invalid-argument', 'expectedRevision is required.');
    refused(await attempt(callAs(wsfSetProfilePhoto, a, { jpegBase64: JPEG_A, expectedRevision: '0', operationId: op() })), 'invalid-argument', 'expectedRevision is required.');
    refused(await attempt(callAs(wsfSetProfilePhoto, a, { jpegBase64: JPEG_A, expectedRevision: 0 })), 'invalid-argument', 'operationId is required.');
    refused(await attempt(callAs(wsfSetProfilePhoto, a, { jpegBase64: JPEG_A, expectedRevision: 0, operationId: op(), source: 'upload' })), 'invalid-argument');
    for (const fn of [wsfMyProfilePhoto, wsfSetProfilePhoto, wsfRemoveProfilePhoto, wsfSetPortraitDecision]) {
      refused(await attempt(callAs(fn, null, { jpegBase64: JPEG_A, expectedRevision: 0, operationId: op(), decision: 'skipped' })), 'unauthenticated');
    }
  }, 30_000);
});
