/**
 * PROFILE-PHOTOS-FIREBASE-1 — the trusted side of a member's profile photo.
 *
 * Frozen scope: #578 comment 6043515827 and the queue decision #365 6043554729.
 * This module is pure (no Firestore, no I/O): the byte-level validation of the
 * small square crop a client uploads, the opaque photo token, and the exact
 * request vocabulary. The callables that use it live in index.ts, beside the W8
 * social layer whose membership and visibility rules they reuse.
 *
 * WHERE THE BYTES LIVE, AND WHY THERE. A photo is the small square JPEG crop,
 * stored in the server-only Firestore collection `wsfProfilePhotos/{uid}`.
 *   • Firestore's catch-all `match /{document=**} { allow read, write: if false; }`
 *     already denies every client read of that collection, so the ONLY way to
 *     a photo is a callable that checks the audience first. No rules change.
 *   • No Cloud Storage object exists, so there is no download URL, no
 *     `firebasestorage` token and no bucket rule to get wrong. The shared bucket's
 *     storage.rules (public reads on several GoArrive paths) are untouched.
 *   • A 256px crop is a few kilobytes; MAX_JPEG_BYTES keeps every document far
 *     under Firestore's 1 MiB limit.
 *
 * WHAT THE SERVER DOES TO THE BYTES. It does not decode pixels: that would need
 * an image library this package does not have (see the QA record for the scoped
 * dependency delta that a full trusted re-encode would require). What it does
 * instead is strict and complete at the container level — `canonicalJpeg`
 * parses every marker segment, validates each table's exact length, accepts
 * only an 8-bit baseline/extended/progressive Huffman frame of 1 or 3
 * components that is square and inside the size bounds, and REBUILDS the file
 * from SOI, the quantisation and Huffman tables, the frame, the restart
 * interval, the scans and EOI. Every APPn segment (EXIF, GPS, XMP, ICC, JFIF,
 * maker notes, thumbnails) and every comment is dropped, and anything after EOI
 * is discarded. What is stored is metadata-free by construction, not by search.
 */
import { randomBytes } from 'node:crypto';

/** The square side the product renders (prototype 256px); the bounds accept a client that crops a little larger or smaller. */
export const MIN_SIDE = 96;
export const MAX_SIDE = 512;
/** Upper bound on the uploaded and the stored JPEG. A 256px crop is normally 5–40 KB. */
export const MAX_JPEG_BYTES = 160 * 1024;
/** How many photo tokens one fetch may name (one face row, or one grid page in a few calls). */
export const MAX_TOKENS_PER_FETCH = 24;

export const PHOTO_VIS_FIELD = 'communityPhotoVisibility';

export type PhotoSource = 'library' | 'camera' | 'portrait';
export const PHOTO_SOURCES: readonly PhotoSource[] = ['library', 'camera', 'portrait'];

/** The one-time portrait decision. First decision wins and is never cleared. */
export type PortraitDecision = 'used' | 'skipped' | 'removed';

export const MSG = {
  notJpeg: 'That photo could not be used. Choose a JPEG image.',
  notSquare: 'That photo must be a square crop.',
  size: `That photo must be between ${MIN_SIDE} and ${MAX_SIDE} pixels square.`,
  tooLarge: 'That photo is too large.',
  stale: 'Your photo changed on another device. Refresh and try again.',
  portraitHasPhoto: 'You already have a photo.',
  portraitDecided: 'Your portrait choice is already saved.',
  unavailable: 'That photo is not available.',
} as const;

// ── tokens and operation ids ────────────────────────────────────────────────

/**
 * The opaque photo token: 18 random bytes, minted for EVERY stored upload, so a
 * replacement or a removal makes the old token resolve to nothing. It names a
 * picture, not a person: no uid, no community and no revision is in it.
 */
export function mintPhotoToken(): string {
  return `ph_${randomBytes(18).toString('base64url')}`;
}

export function normalizePhotoToken(v: unknown): string | null {
  return typeof v === 'string' && /^ph_[A-Za-z0-9_-]{24}$/.test(v) ? v : null;
}

/** A client-chosen idempotency key for one upload or removal (a uuid fits). */
export function normalizeOperationId(v: unknown): string | null {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : null;
}

/** A non-negative whole revision the client last saw (0 = never had a photo). */
export function normalizeRevision(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1_000_000_000 ? v : null;
}

// ── base64 ──────────────────────────────────────────────────────────────────

/** Strict standard base64 (no data: prefix, no whitespace), decoded, or null. */
export function decodeBase64Strict(v: unknown, maxBytes = MAX_JPEG_BYTES): Buffer | null {
  if (typeof v !== 'string' || v.length === 0) return null;
  if (v.length > Math.ceil((maxBytes * 4) / 3) + 4) return null;
  if (v.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return null;
  const buf = Buffer.from(v, 'base64');
  // Round-trip: refuses non-canonical padding bits and anything Buffer skipped.
  if (buf.toString('base64') !== v) return null;
  return buf;
}

// ── the JPEG container ──────────────────────────────────────────────────────

export type CanonicalJpeg =
  | { ok: true; jpeg: Buffer; side: number; components: number; dropped: number }
  | { ok: false; reason: 'notJpeg' | 'notSquare' | 'size' | 'tooLarge' };

const SOF_ACCEPTED = new Set([0xc0, 0xc1, 0xc2]); // baseline, extended sequential, progressive (Huffman, 8-bit)
const SOF_REFUSED = new Set([0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]); // lossless, hierarchical, arithmetic

/**
 * Validate a JPEG and rebuild it from only the segments needed to decode it.
 *
 * Kept, each with its length checked against its own contents: DQT, DHT, DRI,
 * exactly one SOF (C0/C1/C2, 8-bit, 1 or 3 components, square, MIN..MAX side),
 * every SOS header followed by its entropy-coded data, and EOI.
 * Dropped: every APP0–APP15 and COM segment, padding fill bytes, and anything
 * after EOI. Refused: a missing SOI/SOF/SOS/EOI, a second SOI or SOF, an SOS
 * before the frame, arithmetic/lossless/hierarchical frames, DNL height,
 * DAC/DHP/EXP/TEM/reserved markers, and any segment whose length disagrees
 * with what it declares.
 */
export function canonicalJpeg(input: Buffer): CanonicalJpeg {
  const bad = { ok: false as const, reason: 'notJpeg' as const };
  if (!Buffer.isBuffer(input) || input.length < 4) return bad;
  if (input.length > MAX_JPEG_BYTES) return { ok: false, reason: 'tooLarge' };
  if (input[0] !== 0xff || input[1] !== 0xd8) return bad;

  const out: Buffer[] = [Buffer.from([0xff, 0xd8])];
  let i = 2;
  let frame: { side: number; components: number } | null = null;
  let scans = 0;
  let dropped = 0;
  let ended = false;

  const u16 = (at: number) => (input[at]! << 8) | input[at + 1]!;

  while (i < input.length) {
    if (input[i] !== 0xff) return bad;
    while (i < input.length && input[i] === 0xff) i += 1; // fill bytes before a marker
    if (i >= input.length) return bad;
    const m = input[i]!;
    i += 1;

    if (m === 0xd9) { ended = true; break; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0x00) return bad;

    if (i + 2 > input.length) return bad;
    const len = u16(i);
    if (len < 2 || i + len > input.length) return bad;
    const seg = input.subarray(i + 2, i + len); // payload, without the length bytes
    const whole = input.subarray(i - 2, i + len); // FF m len payload
    i += len;

    if ((m >= 0xe0 && m <= 0xef) || m === 0xfe) { dropped += 1; continue; } // APPn, COM

    if (m === 0xdb) { // DQT: (Pq|Tq, 64 or 128 bytes)+
      let p = 0;
      while (p < seg.length) {
        const pq = seg[p]! >> 4;
        const tq = seg[p]! & 0x0f;
        if (pq > 1 || tq > 3) return bad;
        p += 1 + (pq === 0 ? 64 : 128);
      }
      if (p !== seg.length || seg.length === 0) return bad;
      out.push(whole);
      continue;
    }
    if (m === 0xc4) { // DHT: (Tc|Th, 16 counts, symbols)+
      let p = 0;
      while (p < seg.length) {
        if (p + 17 > seg.length) return bad;
        const tc = seg[p]! >> 4;
        const th = seg[p]! & 0x0f;
        if (tc > 1 || th > 3) return bad;
        let n = 0;
        for (let k = 1; k <= 16; k += 1) n += seg[p + k]!;
        if (n > 256) return bad;
        p += 17 + n;
      }
      if (p !== seg.length || seg.length === 0) return bad;
      out.push(whole);
      continue;
    }
    if (m === 0xdd) { // DRI
      if (seg.length !== 2) return bad;
      out.push(whole);
      continue;
    }
    if (SOF_ACCEPTED.has(m)) {
      if (frame) return bad; // one frame only
      if (seg.length < 6) return bad;
      const precision = seg[0]!;
      const height = (seg[1]! << 8) | seg[2]!;
      const width = (seg[3]! << 8) | seg[4]!;
      const nf = seg[5]!;
      if (precision !== 8 || (nf !== 1 && nf !== 3) || seg.length !== 6 + 3 * nf) return bad;
      if (height === 0 || width === 0) return bad; // DNL-defined height is refused
      if (height !== width) return { ok: false, reason: 'notSquare' };
      if (width < MIN_SIDE || width > MAX_SIDE) return { ok: false, reason: 'size' };
      frame = { side: width, components: nf };
      out.push(whole);
      continue;
    }
    if (SOF_REFUSED.has(m)) return bad;
    if (m === 0xda) { // SOS header, then entropy-coded data up to the next real marker
      if (!frame || seg.length < 1) return bad;
      const ns = seg[0]!;
      if (ns < 1 || ns > 4 || seg.length !== 4 + 2 * ns) return bad;
      out.push(whole);
      const start = i;
      while (i < input.length) {
        if (input[i] === 0xff) {
          const next = input[i + 1];
          if (next === undefined) return bad;
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { i += 2; continue; } // stuffing, RSTn
          if (next === 0xff) { i += 1; continue; } // fill before a marker
          break;
        }
        i += 1;
      }
      out.push(input.subarray(start, i));
      scans += 1;
      continue;
    }
    return bad; // DAC, DHP, EXP, JPGn, reserved, anything else
  }

  if (!ended || !frame || scans === 0) return bad;
  out.push(Buffer.from([0xff, 0xd9]));
  const jpeg = Buffer.concat(out);
  if (jpeg.length > MAX_JPEG_BYTES) return { ok: false, reason: 'tooLarge' };
  return { ok: true, jpeg, side: frame.side, components: frame.components, dropped };
}

// ── contract shapes (the whitelists ARE the types) ──────────────────────────

/** The caller's own photo, privately visible to them in every community. */
export type OwnPhoto = { token: string; revision: number; side: number; jpegBase64: string };

export type OwnPhotoState = {
  /** The revision every write must name as `expectedRevision`. 0 before the first upload. */
  revision: number;
  photo: OwnPhoto | null;
  portrait: { decision: PortraitDecision | null; eligible: boolean };
};

/** One face in a community: a name (already permitted by W8), a role, and a token only when the photo may be shown here. */
export type FaceEntry = { displayName: string; role: string; photo: { token: string } | null };

export type FacesResponse = {
  you: {
    displayName: string | null;
    photo: { token: string } | null;
    /** This community's Show my photo setting for the caller. */
    photoVisibility: 'visible' | 'private';
  };
  members: FaceEntry[];
  nextCursor: string | null;
};

export type FacePhotosResponse = { photos: { token: string; jpegBase64: string }[] };
