/**
 * PROFILE-PHOTOS-FIREBASE-1 — who may see a face.
 *
 * A photo leaves the server only to its owner, or to an ACTIVE member of a
 * community in which the owner is an active member with a visible name AND
 * Show my photo on. Everyone else — a nonmember, a member of a different
 * community, a removed member, a signed-out caller, a kiosk, a public preview
 * or display — gets nothing, and the client falls back to initials. Hide is
 * per community and keeps the photo; Remove deletes it everywhere.
 *
 * Scope: #578 6043515827 (frozen) and #365 6043554729. Synthetic accounts and
 * images only; runs against the local Firestore emulator.
 */
process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import * as fs from 'node:fs';
import * as path from 'node:path';

import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import {
  wsfCommunityFacePhotos,
  wsfCommunityFaces,
  wsfCommunityMembers,
  wsfCreateGoal,
  wsfGoalPulse,
  wsfMyProfilePhoto,
  wsfRemoveProfilePhoto,
  wsfSetCommunityPhotoVisibility,
  wsfSetCommunityVisibility,
  wsfSetProfilePhoto,
} from '../../src/index';

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
type Faces = {
  you: { displayName: string | null; photo: { token: string } | null; photoVisibility: string };
  members: { displayName: string; role: string; photo: { token: string } | null }[];
  nextCursor: string | null;
};
type Photos = { photos: { token: string; jpegBase64: string }[] };

function call(fn: unknown, auth: { uid: string; verified?: boolean } | null, data: Data) {
  return (fn as { run: (r: never) => Promise<unknown> }).run({
    data,
    auth: auth ? { uid: auth.uid, token: { email_verified: auth.verified ?? true } } : undefined,
    rawRequest: { ip: '127.0.0.1', headers: {} },
    acceptsStreaming: false,
  } as never);
}
const as = (uid: string) => ({ uid });

async function attempt<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: HttpsError }> {
  try {
    return { ok: true as const, value: await p };
  } catch (e) {
    return { ok: false as const, error: e as HttpsError };
  }
}

let seq = 0;
const uniq = (p: string) => `${p}_${Date.now().toString(36)}_${(seq += 1)}`;
const op = () => uniq('op');

async function seedCommunity(name = 'Synthetic Photo Community'): Promise<string> {
  const groupId = uniq('photoGroup');
  await getFirestore().doc(`wsfCommunityGroups/${groupId}`).set({
    displayName: name,
    groupType: 'custom',
    joinPolicy: 'public',
    joinCode: uniq('joincode1234567890'),
    createdByUserId: 'photoSeed',
    lifecycleStatus: 'active',
    isSample: false,
  });
  return groupId;
}

async function seedPerson(label: string, displayName: string): Promise<string> {
  const uid = uniq(label);
  await getFirestore().doc(`wsfMemberProfiles/${uid}`).set({
    displayName,
    email: `${uid}@example.invalid`,
    adultConfirmation: true,
    acceptedTermsVersion: 't1',
    acceptedPrivacyVersion: 'p1',
  });
  return uid;
}

async function join(groupId: string, uid: string, extra: Data = {}): Promise<void> {
  await getFirestore().doc(`wsfMemberships/${groupId}_${uid}`).set({
    groupId,
    userId: uid,
    role: 'member',
    membershipStatus: 'active',
    ...extra,
  });
}

const faces = (uid: string, groupId: string) => call(wsfCommunityFaces, as(uid), { groupId }) as Promise<Faces>;
const fetchPhotos = (uid: string, groupId: string, tokens: string[]) =>
  call(wsfCommunityFacePhotos, as(uid), { groupId, tokens }) as Promise<Photos>;
async function uploadFor(uid: string, b64 = JPEG_A) {
  const st = (await call(wsfMyProfilePhoto, as(uid), {})) as { revision: number };
  return (await call(wsfSetProfilePhoto, as(uid), { jpegBase64: b64, expectedRevision: st.revision, operationId: op() })) as {
    revision: number;
    photo: { token: string; jpegBase64: string };
  };
}

/** Every string value anywhere in a payload. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

/** A community with Ann (photo), Ben (peer), and outsiders: Cal (another community only) and Dee (no community). */
async function scene() {
  const g1 = await seedCommunity();
  const g2 = await seedCommunity('Synthetic Other Community');
  const ann = await seedPerson('ann', 'Ann Synthetic');
  const ben = await seedPerson('ben', 'Ben Synthetic');
  const cal = await seedPerson('cal', 'Cal Synthetic');
  const dee = await seedPerson('dee', 'Dee Synthetic');
  await join(g1, ann);
  await join(g1, ben);
  await join(g2, ann);
  await join(g2, cal);
  const up = await uploadFor(ann);
  return { g1, g2, ann, ben, cal, dee, token: up.photo.token, bytes: up.photo.jpegBase64 };
}

beforeAll(async () => {
  await getFirestore().doc('_warmup/wsf-profile-photo-privacy').set({ at: Date.now() }, { merge: true });
}, 30_000);

describe('the permitted audience', () => {
  test('an active peer in the same community sees the face and gets exactly the owner\'s bytes; the answer names nobody', async () => {
    const s = await scene();
    const f = await faces(s.ben, s.g1);
    const annRow = f.members.find((m) => m.displayName === 'Ann Synthetic');
    expect(annRow).toEqual({ displayName: 'Ann Synthetic', role: 'member', photo: { token: s.token } });
    expect(f.you).toEqual({ displayName: 'Ben Synthetic', photo: null, photoVisibility: 'visible' });
    expect(f.members.some((m) => m.displayName === 'Ben Synthetic')).toBe(false); // "you" is not repeated
    for (const m of f.members) expect(Object.keys(m).sort()).toEqual(['displayName', 'photo', 'role']);
    expect(Object.keys(f).sort()).toEqual(['members', 'nextCursor', 'you']);

    const got = await fetchPhotos(s.ben, s.g1, [s.token]);
    expect(got.photos).toEqual([{ token: s.token, jpegBase64: s.bytes }]);

    // No uid, no email, no URL, anywhere.
    const all = strings([f, got]).join('\n');
    for (const uid of [s.ann, s.ben, s.cal, s.dee]) expect(all).not.toContain(uid);
    expect(all).not.toMatch(/@example\.invalid|https?:\/\/|firebasestorage|googleapis/);
  }, 40_000);

  test('the owner sees their own photo everywhere, in "you" and through their own read', async () => {
    const s = await scene();
    const f = await faces(s.ann, s.g1);
    expect(f.you.photo).toEqual({ token: s.token });
    expect((await fetchPhotos(s.ann, s.g1, [s.token])).photos).toHaveLength(1);
  }, 40_000);
});

describe('everyone else gets nothing', () => {
  test('a nonmember, and a member of a different community, cannot list or fetch', async () => {
    const s = await scene();
    for (const outsider of [s.dee, s.cal]) {
      const r = await attempt(faces(outsider, s.g1));
      expect(r.ok).toBe(false);
      if (!r.ok) expect([r.error.code, r.error.message]).toEqual(['permission-denied', 'Members only.']);
      const p = await attempt(fetchPhotos(outsider, s.g1, [s.token]));
      expect(p.ok).toBe(false);
      if (!p.ok) expect(p.error.code).toBe('permission-denied');
    }
    // Cal is a member of g2, where Ann is too: the same token is permitted THERE, and only because Ann is visible there.
    expect((await fetchPhotos(s.cal, s.g2, [s.token])).photos).toHaveLength(1);
    // A third community Cal belongs to and Ann does not: the token is simply not available.
    const g3 = await seedCommunity('Synthetic Third');
    await join(g3, s.cal);
    expect((await fetchPhotos(s.cal, g3, [s.token])).photos).toEqual([]);
  }, 40_000);

  test('signed-out callers, kiosks and screens (no account) are refused by every photo callable', async () => {
    const s = await scene();
    for (const fn of [wsfMyProfilePhoto, wsfCommunityFaces, wsfCommunityFacePhotos, wsfSetCommunityPhotoVisibility, wsfSetProfilePhoto, wsfRemoveProfilePhoto]) {
      const r = await attempt(call(fn, null, { groupId: s.g1, tokens: [s.token], photo: 'visible' }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('unauthenticated');
    }
  }, 40_000);

  test('a removed or departed member is neither listed nor able to look', async () => {
    const s = await scene();
    await join(s.g1, s.ben, { membershipStatus: 'removed' });
    refusedMembers(await attempt(faces(s.ben, s.g1)));
    refusedMembers(await attempt(fetchPhotos(s.ben, s.g1, [s.token])));
    // And Ann, once departed, disappears from the faces of those who remain.
    const eve = await seedPerson('eve', 'Eve Synthetic');
    await join(s.g1, eve);
    await join(s.g1, s.ann, { membershipStatus: 'departed' });
    const f = await faces(eve, s.g1);
    expect(f.members.map((m) => m.displayName)).not.toContain('Ann Synthetic');
    expect((await fetchPhotos(eve, s.g1, [s.token])).photos).toEqual([]);
  }, 40_000);

  test('the public goal pulse and the W8 member list are unchanged: no photo token or bytes in either', async () => {
    const s = await scene();
    const champ = await seedPerson('champ', 'Champ Synthetic');
    await join(s.g1, champ, { role: 'foundingChampion' });
    const created = (await call(wsfCreateGoal, as(champ), {
      communityGroupId: s.g1,
      title: 'Synthetic goal',
      target: 100,
      unit: 'squats',
      startsAt: new Date(Date.now() - 3_600_000).toISOString(),
      endsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      timezone: 'America/New_York',
    })) as { goalId: string };
    const pulse = await call(wsfGoalPulse, as(s.ben), { goalId: created.goalId });
    const list = (await call(wsfCommunityMembers, as(s.ben), { groupId: s.g1 })) as { members: Record<string, unknown>[] };
    for (const m of list.members) expect(Object.keys(m).sort()).toEqual(['displayName', 'role']);
    const all = strings([pulse, list]).join('\n');
    expect(all).not.toContain(s.token);
    expect(all).not.toContain(s.bytes.slice(0, 40));
  }, 40_000);
});

function refusedMembers(r: { ok: boolean; error?: HttpsError }) {
  expect(r.ok).toBe(false);
  if (!r.ok) expect([r.error?.code, r.error?.message]).toEqual(['permission-denied', 'Members only.']);
}

describe('Hide is not Remove', () => {
  test('Hide in one community: peers there see initials, the owner and other communities still see the photo', async () => {
    const s = await scene();
    const hidden = (await call(wsfSetCommunityPhotoVisibility, as(s.ann), { groupId: s.g1, photo: 'private' })) as Data;
    expect(hidden).toEqual({ groupId: s.g1, photo: 'private' });

    const f = await faces(s.ben, s.g1);
    expect(f.members.find((m) => m.displayName === 'Ann Synthetic')).toEqual({ displayName: 'Ann Synthetic', role: 'member', photo: null });
    expect((await fetchPhotos(s.ben, s.g1, [s.token])).photos).toEqual([]); // a remembered token does not help

    expect((await faces(s.ann, s.g1)).you).toMatchObject({ photo: { token: s.token }, photoVisibility: 'private' });
    expect(((await call(wsfMyProfilePhoto, as(s.ann), {})) as { photo: unknown }).photo).not.toBeNull();
    expect((await fetchPhotos(s.cal, s.g2, [s.token])).photos).toHaveLength(1);

    // Showing it again restores it, with the same token: hiding kept the photo.
    await call(wsfSetCommunityPhotoVisibility, as(s.ann), { groupId: s.g1, photo: 'visible' });
    expect((await fetchPhotos(s.ben, s.g1, [s.token])).photos).toHaveLength(1);
  }, 40_000);

  test('a hidden NAME hides the face too: the member is not listed and the token is refused', async () => {
    const s = await scene();
    await call(wsfSetCommunityVisibility, as(s.ann), { groupId: s.g1, name: 'private' });
    const f = await faces(s.ben, s.g1);
    expect(f.members.map((m) => m.displayName)).not.toContain('Ann Synthetic');
    expect((await fetchPhotos(s.ben, s.g1, [s.token])).photos).toEqual([]);
  }, 40_000);

  test('Remove deletes it everywhere; a replaced photo\'s old token resolves to nothing', async () => {
    const s = await scene();
    const replaced = await uploadFor(s.ann, JPEG_B);
    expect(replaced.photo.token).not.toBe(s.token);
    expect((await fetchPhotos(s.ben, s.g1, [s.token])).photos).toEqual([]);
    expect((await fetchPhotos(s.ben, s.g1, [replaced.photo.token])).photos).toEqual([{ token: replaced.photo.token, jpegBase64: replaced.photo.jpegBase64 }]);

    await call(wsfRemoveProfilePhoto, as(s.ann), { expectedRevision: replaced.revision, operationId: op() });
    for (const [viewer, g] of [[s.ben, s.g1], [s.cal, s.g2], [s.ann, s.g1]] as const) {
      expect((await fetchPhotos(viewer, g, [replaced.photo.token])).photos).toEqual([]);
    }
    expect((await faces(s.ben, s.g1)).members.find((m) => m.displayName === 'Ann Synthetic')?.photo).toBeNull();
  }, 40_000);

  test('Show my photo takes the literal value only, for the caller\'s own active membership only', async () => {
    const s = await scene();
    for (const bad of [true, 'Private', '', null, ['private']]) {
      const r = await attempt(call(wsfSetCommunityPhotoVisibility, as(s.ann), { groupId: s.g1, photo: bad }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('invalid-argument');
    }
    refusedMembers(await attempt(call(wsfSetCommunityPhotoVisibility, as(s.dee), { groupId: s.g1, photo: 'private' })));
    // There is no way to name another member: a targetUid is ignored and only the caller's row changes.
    await call(wsfSetCommunityPhotoVisibility, as(s.ben), { groupId: s.g1, photo: 'private', targetUid: s.ann, userId: s.ann });
    const annRow = (await getFirestore().doc(`wsfMemberships/${s.g1}_${s.ann}`).get()).data()!;
    expect(annRow.communityPhotoVisibility).toBeUndefined();
  }, 40_000);
});

describe('the boundary as written in the source', () => {
  test('no photo callable is reachable without an account (none is invoker: public)', () => {
    const src = fs
      .readFileSync(path.resolve(__dirname, '../../src/index.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    for (const name of ['wsfMyProfilePhoto', 'wsfSetProfilePhoto', 'wsfRemoveProfilePhoto', 'wsfSetPortraitDecision', 'wsfSetCommunityPhotoVisibility', 'wsfCommunityFaces', 'wsfCommunityFacePhotos']) {
      const m = new RegExp(`export const ${name} = onCall(?:<[^>]*>)?\\(\\s*(\\{[^}]*\\})`, 'm').exec(src);
      expect([name, m !== null]).toEqual([name, true]);
      expect([name, /invoker/.test(m![1]!)]).toEqual([name, false]);
    }
  });

  test('no photo bytes or tokens are logged while uploading, listing and fetching', async () => {
    const logged: string[] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) =>
      jest.spyOn(console, k).mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(' ')); })
    );
    try {
      const s = await scene();
      const f = await faces(s.ben, s.g1);
      await fetchPhotos(s.ben, s.g1, f.members.flatMap((m) => (m.photo ? [m.photo.token] : [])));
      const text = logged.join('\n');
      expect(text).not.toContain(s.token);
      expect(text).not.toContain(s.bytes.slice(0, 40));
      expect(text).not.toContain(JPEG_A.slice(0, 40));
    } finally {
      spies.forEach((sp) => sp.mockRestore());
    }
  }, 40_000);
});
