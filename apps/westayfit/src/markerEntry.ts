/**
 * EVERGREEN-MARKER-ENTRY-1 (phase A) — the physical-marker entry.
 *
 * A reusable printed QR carries only `/go/{markerSlug}`. The server resolves
 * the slug to ONE community and ONE goal (`wsfResolveMarker`), so the printed
 * code never changes while what it opens can. Everything in this module is
 * deliberately thin:
 *
 *   - THE SLUG SHAPE, the same rule the server applies, so garbage never
 *     reaches a call or a stored return.
 *   - A BACKEND-NEUTRAL RESOLVER BOUNDARY (`MarkerResolver`). The screen talks
 *     to this interface; `firebaseMarkerResolver` is the one implementation.
 *     A marketing forwarder or another backend never owns the mapping — it can
 *     only send people to `/go/{slug}`.
 *   - THE AUTH RETURN, a fourth member of the id-based family beside
 *     `pendingJoinCode`, `eventReturn` and `kioskSession`: it stores a SLUG,
 *     never a URL, and the route is rebuilt from it.
 *   - THE DECISION (`markerStep`, `markerWays`), pure, so every membership
 *     state, goal state and kiosk mode is pinned by unit tests.
 *
 * Nothing here grants anything. A stored slug names where the visitor was;
 * the server decides everything else when they come back. A scan creates no
 * membership, no queue place, no timer and no credit.
 */

import { httpsCallable, type Functions } from 'firebase/functions';

/** Lowercase letters, digits and inner hyphens, at most 48 — e.g. `flag-01`. */
export function normalizeMarkerSlug(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const slug = value.trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(slug) ? slug : null;
}

/** `/go/<slug>` — rebuilt from a validated slug, never remembered as a URL. */
export function markerRoute(slug: string): string {
  return `/go/${encodeURIComponent(slug)}`;
}

export type MarkerKioskMode = 'off' | 'available' | 'queue';
export type MarkerGoalState = 'open' | 'upcoming' | 'ended' | 'closed';
export type MarkerViewer = 'signedOut' | 'nonMember' | 'member';

/** What `wsfResolveMarker` returns. No join code, member, count or scan. */
export type ResolvedMarker = {
  markerSlug: string;
  label: string;
  communityName: string;
  goalId: string;
  goalTitle: string;
  goalState: MarkerGoalState;
  kioskMode: MarkerKioskMode;
  viewer: MarkerViewer;
  /** Present only for an active member. */
  communityGroupId: string | null;
};

export type MarkerJoinResult = { groupId: string; goalId: string; alreadyMember: boolean };

/** The boundary the screen depends on. */
export interface MarkerResolver {
  resolve(slug: string): Promise<ResolvedMarker>;
  join(slug: string): Promise<MarkerJoinResult>;
}

/** `functions` is a getter so nothing initialises Firebase during static export. */
export function firebaseMarkerResolver(functions: () => Functions): MarkerResolver {
  return {
    async resolve(slug) {
      const fn = httpsCallable<{ markerSlug: string }, ResolvedMarker>(functions(), 'wsfResolveMarker');
      return (await fn({ markerSlug: slug })).data;
    },
    async join(slug) {
      const fn = httpsCallable<{ markerSlug: string }, MarkerJoinResult>(functions(), 'wsfJoinViaMarker');
      return (await fn({ markerSlug: slug })).data;
    },
  };
}

// ── the decision ────────────────────────────────────────────────────────────

/**
 * Where a resolved marker puts this visitor. Joining is explained BEFORE any
 * movement: nobody exercises first and meets an account gate afterwards.
 *
 *   signIn   signed out — create an account or sign in, then come back here.
 *   join     signed in, not a member — an explicit "Join {community}" step.
 *   choose   a member and the goal is open — the ways to take part.
 *   notOpen  a member and the goal is upcoming, ended or closed — the truth
 *            and a real next option, never a Start.
 */
export type MarkerStep = 'signIn' | 'join' | 'choose' | 'notOpen';

export function markerStep(m: Pick<ResolvedMarker, 'viewer' | 'goalState'>): MarkerStep {
  if (m.viewer === 'signedOut') return 'signIn';
  if (m.viewer === 'nonMember') return 'join';
  return m.goalState === 'open' ? 'choose' : 'notOpen';
}

/**
 * The ways to take part, for a member on an open goal.
 *
 *   phone  always — the existing `/contribute/<goalId>`; phone participation
 *          is complete without any kiosk.
 *   kiosk  null when the mode is 'off' (the action is OMITTED, never shown
 *          disabled); 'guidance' for 'available' (plain words, no queue, no
 *          station, no promise one is free); 'queue' for 'queue' (the
 *          EXISTING event screen, whose one confirmed name tap is the only
 *          queue write).
 */
export type MarkerWays = {
  phoneRoute: string;
  kiosk: null | { kind: 'guidance' } | { kind: 'queue'; route: string };
};

export function markerWays(m: Pick<ResolvedMarker, 'goalId' | 'kioskMode'>): MarkerWays {
  const goal = encodeURIComponent(m.goalId);
  const kiosk =
    m.kioskMode === 'queue'
      ? ({ kind: 'queue', route: `/event/${goal}` } as const)
      : m.kioskMode === 'available'
        ? ({ kind: 'guidance' } as const)
        : null;
  return { phoneRoute: `/contribute/${goal}`, kiosk };
}

/** A truthful sentence for each goal state. */
export function goalStateLine(state: MarkerGoalState): string {
  switch (state) {
    case 'open':
      return 'Open now';
    case 'upcoming':
      return 'Not started yet';
    case 'ended':
      return 'This challenge has ended';
    case 'closed':
      return 'This challenge is closed';
  }
}

// ── the auth return ─────────────────────────────────────────────────────────

const MARKER_RETURN_KEY = 'wsf.markerReturn';

/** Two hours: the same visit to the same flag, as `eventReturn`. */
export const MARKER_RETURN_MAX_AGE_MS = 2 * 60 * 60 * 1000;

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function setMarkerReturn(slug: string, now: number = Date.now()): void {
  try {
    const store = storage();
    const valid = normalizeMarkerSlug(slug);
    if (!store || !valid || !Number.isFinite(now)) return;
    store.setItem(MARKER_RETURN_KEY, JSON.stringify({ slug: valid, at: now }));
  } catch {
    // Losing the return is a worse walk-back, not a leak: the visitor lands
    // on home and can scan again.
  }
}

/** The slug to return to, or null for anything malformed, future or stale. */
export function readMarkerReturn(now: number = Date.now()): string | null {
  try {
    const raw = storage()?.getItem(MARKER_RETURN_KEY);
    if (raw == null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const { slug, at } = parsed as { slug?: unknown; at?: unknown };
    const valid = normalizeMarkerSlug(slug);
    if (!valid || valid !== slug) return null;
    if (typeof at !== 'number' || !Number.isFinite(at) || at > now) return null;
    if (now - at > MARKER_RETURN_MAX_AGE_MS) return null;
    return valid;
  } catch {
    return null;
  }
}

export function clearMarkerReturn(): void {
  try {
    storage()?.removeItem(MARKER_RETURN_KEY);
  } catch {
    // ignore
  }
}
