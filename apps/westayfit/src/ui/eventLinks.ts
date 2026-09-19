/**
 * The addresses an event uses, built in ONE place.
 *
 * Same reasoning as `joinLink.ts` and `kioskLink.ts`: a Champion copies a
 * string, a QR encodes a string and a test asserts a string, so all three come
 * from one derivation rather than three that can drift.
 *
 * THE STANDING RULE THESE BUILDERS EXIST TO KEEP: no secret, no token and no
 * administrative authority ever rides in a URL or a QR code. Everything here
 * takes an origin, a goal id and — for the newcomer link — the community's
 * existing invite code, which is public by construction and already printed,
 * copied and shared from the Champion's own sheet. A station secret and a
 * pairing id are parameters of NOTHING here; they travel in a callable's
 * request body and nowhere else. Scanning any of these opens a page that still
 * asks whoever scanned it to sign in as themselves, and none of them enrols a
 * screen or confers a Champion's powers.
 */

import { buildJoinUrl } from './joinLink';

function trimOrigin(origin: string): string {
  return origin.replace(/\/+$/, '');
}

/** `/station/<goalId>` — the screen at the event, before and after enrolment. */
export function stationRoute(goalId: string): string {
  return `/station/${encodeURIComponent(goalId)}`;
}

/** `/event/<goalId>` — where an attendee's own phone lands. */
export function eventRoute(goalId: string): string {
  return `/event/${encodeURIComponent(goalId)}`;
}

/**
 * The absolute address of the screen at an event, for the Champion to open or
 * copy onto that screen. It carries a goal id and nothing else: opening it on
 * a brand-new device enrols nobody — that device still has to show a pairing
 * code and wait for a Champion to approve it.
 */
export function buildStationUrl(opts: {
  origin: string | null | undefined;
  goalId: string | null | undefined;
}): string | null {
  const id = opts.goalId?.trim();
  if (!opts.origin) return null;
  if (!id) return null;
  return `${trimOrigin(opts.origin)}${stationRoute(id)}`;
}

/**
 * The absolute address for an attendee who is already a member: the event
 * screen for this goal.
 */
export function buildEventUrl(opts: {
  origin: string | null | undefined;
  goalId: string | null | undefined;
}): string | null {
  const id = opts.goalId?.trim();
  if (!opts.origin) return null;
  if (!id) return null;
  return `${trimOrigin(opts.origin)}${eventRoute(id)}`;
}

/**
 * The absolute address for a newcomer, from a code whose admission policy has
 * ALREADY been screened by whoever is calling.
 *
 * It exists because the screen at an event cannot screen the policy itself: it
 * is not signed in as anybody and cannot read the community document.
 * `wsfStationState` applies the server's own LINK_JOINABLE set and returns a
 * code only for a community that admits by link at all — a private community
 * returns null there, so the screen has no code, builds no URL and shows no
 * newcomer QR. The presence of the code IS the policy decision, made on the
 * server, and this builder says so rather than pretending to re-check it.
 *
 * Every caller that holds a raw code and an unscreened policy must use
 * `buildJoinEventUrl` below instead.
 */
export function buildEventJoinUrlFromScreenedCode(opts: {
  origin: string | null | undefined;
  joinCode: string | null | undefined;
  goalId: string | null | undefined;
}): string | null {
  const { origin, joinCode } = opts;
  const id = opts.goalId?.trim();
  if (!origin) return null;
  if (!joinCode) return null;
  if (!id) return null;
  return `${trimOrigin(origin)}/join/${joinCode}?event=${encodeURIComponent(id)}`;
}

/**
 * The same address, for a caller that holds the community's stored join policy
 * and must apply it: the EXISTING join link with the event named on it, so a
 * newcomer's join finishes at the event rather than dropping someone standing
 * in a hall onto a community page.
 *
 * It is `buildJoinUrl` plus one query parameter — the same URL, the same
 * admission rule, the same code. A community that admits nobody by link
 * returns null here exactly as it does there. Nothing about admission changes
 * because a station is standing in the room.
 */
export function buildJoinEventUrl(opts: {
  origin: string | null | undefined;
  joinCode: string | null | undefined;
  joinPolicy: string | null | undefined;
  goalId: string | null | undefined;
}): string | null {
  // The policy gate, and only then the one derivation of the string.
  const base = buildJoinUrl({
    origin: opts.origin,
    joinCode: opts.joinCode,
    joinPolicy: opts.joinPolicy,
  });
  if (!base) return null;
  return buildEventJoinUrlFromScreenedCode({
    origin: opts.origin,
    joinCode: opts.joinCode,
    goalId: opts.goalId,
  });
}

/** Whether a route parameter names an event to finish a join at. Shape-checked
 * for the same reason every other stored or routed id is. */
export function readEventParam(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(trimmed) ? trimmed : null;
}
