# PROFILE-PHOTOS-FIREBASE-1: private profile photos and permitted community faces

**Status:** source delivered for review. It is not accepted, integrated, staged or deployed. Everything here ran against emulators only (`demo-wsf-local`) with synthetic accounts and synthetic images.

**Governing scope:**
- the frozen handoff, #578 comment 6043515827;
- the queue decision, #365 comment 6043554729;
- the release, #365 comment 6052427068.

**Base:** `claude/wsf-app-shell` at `934f24f0`, the #587 merge.

**Reserved paths.** Exactly five are reserved, and all five are used:
- `functions-westayfit/src/index.ts`
- `functions-westayfit/src/profilePhotos.ts` (new)
- `functions-westayfit/tests/callable/wsf-profile-photos.test.ts` (new)
- `functions-westayfit/tests/callable/wsf-profile-photo-privacy.test.ts` (new)
- this file

## Architecture

### Where a photo lives
A photo is one document per account, `wsfProfilePhotos/{uid}`, written only by the Admin SDK. It holds the small square JPEG as Firestore bytes, plus `revision`, `photoToken`, `side`, `portraitDecision` and `lastOperationId`.

Three properties follow from that choice:
- **No rules change.** `firestore.rules` ends with the catch-all `match /{document=**} { allow read, write: if false; }`, so no client can read the collection. The only way out is the callables below.
- **No Cloud Storage.** No object, download URL, `firebasestorage` token or bucket rule exists. The shared `storage.rules`, which has public-read GoArrive paths, is untouched.
- **Bounded size.** A 256px crop is a few KB (the synthetic fixtures are 1.9–2.6 KB). The hard limit of 160 KB keeps every document far below Firestore's 1 MiB.

### Who can see it
The audience is enforced on the server, never by hiding an image on the client:
- **The owner** sees their photo everywhere, through `wsfMyProfilePhoto`.
- **An active member of community C** sees another member's photo, through `wsfCommunityFacePhotos`, only while that member:
  - is an active member of C;
  - has a visible **name** in C (the W8 `communityNameVisibility`; a hidden name hides the face);
  - has **Show my photo** on in C (the new `communityPhotoVisibility`, which defaults to visible under the same three-way W8 rule).
- **Nobody else.** Nonmembers, members of a different community, removed or departed members and signed-out callers are all refused. Kiosks, stations, public previews and displays have no account, so they are refused too. Every photo callable requires `request.auth`, and none is `invoker: 'public'`; the source is pinned by a test.

**Tokens, not URLs.** A photo is identified by an opaque token, `ph_` followed by 18 random bytes. A new token is minted for every stored upload and cleared on removal. The token carries no uid, community or revision. It is not a credential: every fetch re-checks the audience at read time, so hide, remove, leave and removal all take effect on the very next request.

### Generations and races
Every write names two values:
- `expectedRevision`: the revision the client last saw, 0 before the first upload;
- `operationId`: a client-chosen idempotency key of 8–64 characters `[A-Za-z0-9_-]`.

Each write runs in one transaction on the owner's own document:
- **A retry of the same `operationId`** returns that operation's settled state with `replayed: true` and writes nothing.
- **A write against an older revision** is refused and changes nothing (`failed-precondition`, "Your photo changed on another device. Refresh and try again."). This covers a stale upload finishing after a removal, and a newer upload made on another device.
- **The account** is always `request.auth.uid`. No request field can name another account, and a stray `uid`, `userId` or `targetUid` is ignored; tests cover this.

### What the server does to the bytes
`canonicalJpeg` in `profilePhotos.ts` validates the image strictly at the container level and **rebuilds** the file:
- **Kept:** SOI, the DQT and DHT tables, DRI, one SOF, the scans and EOI. Each table's length must match exactly what it declares.
- **Frame accepted:** C0, C1 or C2 (8-bit Huffman), with 1 or 3 components, square, and 96–512 px per side.
- **Dropped:** every APP0–APP15 segment (EXIF, GPS, XMP, ICC, JFIF, maker notes, thumbnails), every COM segment, and anything after EOI.
- **Refused:** arithmetic-coded, lossless and hierarchical frames; DNL height; a second SOI or SOF; truncation; and mis-sized tables.

The rebuilt bytes for the synthetic fixture decode in Chromium to identical pixels (checked in scratch).

**Not done: a pixel-level re-encode on the trusted side.** It would need an image library, and this package depends only on `firebase-admin` and `firebase-functions`. See *Scope delta, not taken* below.

## Contract (exact)

### Data types
```ts
type PortraitDecision = 'used' | 'skipped' | 'removed';
type OwnPhotoState = {
  revision: number;                      // name it as expectedRevision on the next write; 0 = never uploaded
  photo: { token: string; revision: number; side: number; jpegBase64: string } | null;
  portrait: { decision: PortraitDecision | null; eligible: boolean };  // eligible = no decision AND no photo
};
type FaceEntry = { displayName: string; role: string; photo: { token: string } | null };
```

### Callables

| Callable | Request | Response |
|---|---|---|
| `wsfMyProfilePhoto` | `{}` | `OwnPhotoState` |
| `wsfSetProfilePhoto` | `{ jpegBase64, expectedRevision, operationId, source?: 'library'\|'camera'\|'portrait' }` | `OwnPhotoState & { replayed: boolean }` |
| `wsfRemoveProfilePhoto` | `{ expectedRevision, operationId }` | `OwnPhotoState & { replayed: boolean }` |
| `wsfSetPortraitDecision` | `{ decision: 'skipped' }` | `OwnPhotoState` |
| `wsfSetCommunityPhotoVisibility` | `{ groupId, photo: 'visible'\|'private' }` | `{ groupId, photo: 'visible'\|'private' }` |
| `wsfCommunityFaces` | `{ groupId, cursor? }` | `{ you: { displayName: string\|null, photo: {token}\|null, photoVisibility }, members: FaceEntry[], nextCursor: string\|null }` |
| `wsfCommunityFacePhotos` | `{ groupId, tokens: string[] }` (1–24) | `{ photos: { token, jpegBase64 }[] }` |

**`wsfSetProfilePhoto`:**
- `jpegBase64` is strict standard base64 of a JPEG: no `data:` prefix and no whitespace.
- `source` defaults to `library`.
- `source: 'portrait'` is the one-time portrait. It is refused when a photo exists or a portrait decision was already made, and it records `used`.

**`wsfRemoveProfilePhoto`:** clears the bytes and the token everywhere and moves the revision on. If no decision was made yet, it records `removed`. Removing when there is no photo changes nothing.

**`wsfSetPortraitDecision`:** the first decision wins and is never cleared.

**`wsfCommunityFaces`:**
- Pages are 50 long and sorted by name; the cursor is W8's offset cursor.
- `members` excludes the caller, who appears as `you`.
- It lists the same visible-name rows as `wsfCommunityMembers`.
- No uid, email, profile field, hidden-member count or timestamp appears.

**`wsfCommunityFacePhotos`:** a token that is not permitted, or no longer names a stored photo, is omitted. The answer never says why; the client shows initials.

### Errors

| Code | Message | When |
|---|---|---|
| `unauthenticated` | `Sign in first.` | Any photo callable called signed out, including from a kiosk or screen. |
| `invalid-argument` | `That photo could not be used. Choose a JPEG image.` | The upload is not a valid JPEG: not JPEG at all, a `data:` URL, whitespace, a bad container, truncation, or missing. |
| `invalid-argument` | `That photo must be a square crop.` | Width differs from height. |
| `invalid-argument` | `That photo must be between 96 and 512 pixels square.` | The square side is outside the bounds. |
| `invalid-argument` | `That photo is too large.` | More than 160 KB. |
| `invalid-argument` | `expectedRevision is required.` / `operationId is required.` | Either id is missing or not literal. |
| `invalid-argument` | A field message | Bad `source`, `decision`, `photo`, `groupId`, `tokens` or `cursor`. |
| `failed-precondition` | `Your photo changed on another device. Refresh and try again.` | A stale write. |
| `failed-precondition` | `You already have a photo.` / `Your portrait choice is already saved.` | A portrait upload that is not allowed. |
| `permission-denied` | `Members only.` | Faces, fetch or setting for a community where the caller is not an active member. The same sentence is used for every case, as in W8. |

## Native and Web Twin adapter handoff
Both clients use this one contract. Firebase is the only authority: there are no Supabase shadow profiles and nothing local is authoritative.

1. **Own photo.**
   - Read `wsfMyProfilePhoto` on sign-in and on every account switch.
   - Keep `revision` and send it as `expectedRevision`.
   - Mint one `operationId` per user action and **reuse it on retry**.
   - On `failed-precondition` "changed on another device", re-read and show the server state. Never retry with a newer revision automatically.
2. **Upload.**
   - Crop to a square of about 256px and encode it as JPEG on the client, with orientation baked into the pixels: the server drops EXIF.
   - Send it as plain base64.
   - Never keep the original image, its EXIF, a video or frames.
3. **Portrait offer.** Show it only when `portrait.eligible` is true. On Use, upload with `source: 'portrait'`. On Skip, call `wsfSetPortraitDecision({decision:'skipped'})`. The decision is server-side, so a second device never asks again.
4. **Faces.**
   - Call `wsfCommunityFaces(groupId)`.
   - Show `you` first, then `members`.
   - Fetch bytes for the visible tokens with `wsfCommunityFacePhotos` (at most 24 per call).
   - Cache bytes **in memory, per account, per token**. Drop any cached token that the latest faces answer no longer lists.
   - Show initials whenever a token is absent or omitted.
   - A token change means the photo was replaced.
5. **Hide versus Remove.**
   - *Show my photo* per community calls `wsfSetCommunityPhotoVisibility`. The photo is kept, the owner still sees it, and other communities are unaffected.
   - *Remove* calls `wsfRemoveProfilePhoto` and deletes the photo everywhere.
6. **Account switch.** Clear the in-memory photo cache and any pending operation. Nothing about photos is persisted in `localStorage` or `AsyncStorage` as authority.

## Proof (emulator, synthetic)

| Run | Result |
|---|---|
| `wsf-profile-photos.test.ts` + `wsf-profile-photo-privacy.test.ts` | **23 / 23** |
| Mutants (13: audience checks, generations, rebuild, portrait, self-exclusion, table lengths) | **12 killed**. The survivor, M4 (the faces list ignoring Show my photo), is equivalent: tokens are only loaded for rows whose photo is visible. |
| Full callable suite | **34 suites, 604 / 604** |
| W4 finding #394 6053090140 (F1, test-only) | Both cases are pinned: a refused Show-my-photo call by a nonmember creates **no** membership row, and a removed member's refused call leaves their row byte-identical. W4's **M17** (pre-write membership check removed) is now killed: **1 failed / 11** on the privacy suite. |
| Deploy-config | **17 / 17** |
| `tsc --noEmit` | clean |
| Chromium round trip (scratch, not committed) | The rebuilt JPEG decodes to identical pixels. The injected GPS APP1, the COM segment and trailing junk are gone. |

**Covered rows:**
- **Owner flow:**
  - upload on A, then a second-session read returns the same photo;
  - the stored bytes are the canonical rebuild, with no EXIF, GPS, COM, JFIF or trailing data;
  - replace mints a new token, and remove clears both bytes and token;
  - a stale upload after a removal is refused and does not resurrect the photo;
  - retries are idempotent;
  - three-way device races land exactly one write;
  - accounts never cross.
- **Portrait decision:** skip persists and blocks the portrait; portrait records `used` and never overwrites a photo; removal records `removed`; decisions are never cleared.
- **Upload refusals:** non-square, too small, PNG, `data:` URL, whitespace, arithmetic frame, no EOI, truncation, too large, missing, padded or short DQT and DHT, missing or non-literal ids, and signed-out callers.
- **Audience:**
  - a same-community peer sees exactly the owner's bytes;
  - the owner sees their own photo;
  - a nonmember and a member of a different community are refused;
  - the token is permitted only in a community the owner shares visibly;
  - signed-out, kiosk and screen callers are refused;
  - removed and departed members are neither listed nor able to look;
  - the public pulse and the W8 member list are unchanged;
  - Hide only affects that community, a hidden name hides the face, remove applies everywhere, and an old token resolves to nothing;
  - Show my photo takes the literal value only and is self-only;
  - no callable is public;
  - nothing is logged.

**Not established here.** These remain separate gates:
- hosted staging;
- cross-device proof on two real browsers or devices;
- the native and Lovable adapters;
- the Home and You visuals at 390x640 and 390x844;
- real-person uploads;
- production.

## Deployment needs: none beyond functions
No rules, indexes, Storage, IAM, provider, secret or hosting change is needed:
- The new collection is denied to clients by the existing catch-all.
- Queries are single-field equality or `in` on `photoToken`, which the automatic index serves.

When separately authorized, deploy the westayfit functions codebase first. The new callables are additive, and no existing response changes shape. Then ship the adapters.

## Scope delta, not taken
A **pixel-level re-encode on the trusted side** (decode, then a fresh JPEG with no carried-over tables or entropy data) would need a reviewed image dependency in `functions-westayfit/package.json`, plus a lockfile change. Candidates:
- `sharp`, which is native;
- a pure-JS JPEG codec, which is smaller to review.

What remains without it:
- The container rebuild removes every metadata segment.
- The fixed-size quantisation and Huffman tables and the entropy-coded data are carried over from the client's encoder, so the server bounds and validates them but does not regenerate them.

If the Director wants a full re-encode, I need a one-path delta for `functions-westayfit/package.json` and `package-lock.json`.
