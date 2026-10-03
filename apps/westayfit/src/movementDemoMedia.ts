/**
 * MOVEMENT DEMONSTRATION MEDIA — which movements have an APPROVED looping
 * demonstration, where it lives, and the rules its playback follows.
 *
 * EXPO-MOVEMENT-VIDEO-1. The follow-along player has always had a media seam
 * (`FollowAlongMedia` in followAlong.ts: a poster and an optional clip). This
 * module is the only thing allowed to fill it, and it fills it only from an
 * explicit, local catalog of approved assets. Nothing here takes an address
 * from a member, a goal document, GoArrive's storage, a scrape or a prototype.
 *
 * THE CATALOG IS EMPTY TODAY, and that is the truthful state: no movement
 * demonstration clip has been approved for this app. Every real movement keeps
 * the drawn movement guide it has always shown, and the gap is named in
 * DEMO_MEDIA_ASSET_DEPENDENCY rather than papered over.
 *
 * EXACT VARIANTS ONLY. A clip is keyed by the movement's own unit, normalised
 * only for case and spacing. "squats" is not "squat", "jump squats" or
 * "air squats": a demonstration of one movement is never shown for another,
 * however close. There is no alias table here on purpose.
 *
 * THE TEST CATALOG. Playback has to be provable before a real clip exists, so
 * an emulator build served from a loopback address — never a staging or
 * production build — will also read `window.__WSF_TEST_DEMO_MEDIA__`. Its
 * entries must live under TEST_FIXTURE_PREFIX, and the e2e spec generates the
 * only file ever served there at test time. It is a labelled test fixture, not
 * a demonstration of any exercise, and it is never committed or shipped.
 *
 * NOTHING HERE COUNTS. Media is decoration on a round the person counts
 * themselves. No event from a video — ended, timeupdate, a loop, a pause — is
 * wired to the round, the clock, the attempt or a contribution, and the
 * playback rules below can only change what the media slot shows.
 */
import type { FollowAlongMedia } from './followAlong';

/** One approved demonstration: a poster shown first, and the looping clip. */
export type DemoMediaEntry = {
  /** The exact movement this demonstrates, as `demoVariantKey` writes it. */
  variant: string;
  /** Same-origin, release-packaged path under APPROVED_MEDIA_PREFIX. */
  posterUri: string;
  clipUri: string;
  /** Who approved it and which version — so an asset can be traced and replaced. */
  source: string;
};

/**
 * APPROVED, VERSIONED DEMONSTRATIONS, packaged with the web export under
 * `/media/movements/` (for example `/media/movements/squats@v1.webm`).
 *
 * Empty: no clip has been approved. Adding one is a reviewed change to this
 * list plus the asset itself, and nothing else in the player changes.
 */
export const APPROVED_DEMO_MEDIA: readonly DemoMediaEntry[] = [];

/** The production gap, stated where the catalog is. */
export const DEMO_MEDIA_ASSET_DEPENDENCY =
  'No approved movement demonstration clip exists yet. Each movement shows its drawn movement guide until an approved, versioned poster and clip are added to APPROVED_DEMO_MEDIA.';

export const APPROVED_MEDIA_PREFIX = '/media/movements/';
export const TEST_FIXTURE_PREFIX = '/__wsf-test-fixture__/';

/** A movement's key: its own unit, lower-cased and single-spaced. Nothing more. */
export function demoVariantKey(unit: unknown): string {
  if (typeof unit !== 'string') return '';
  return unit.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * A same-origin path under one prefix, and nothing else: no scheme, no host,
 * no `..`, no query or fragment, no `data:` or `blob:` — so an entry cannot
 * point the player at somebody else's server or at arbitrary bytes.
 */
export function isAllowedDemoUri(uri: unknown, prefix: string): uri is string {
  if (typeof uri !== 'string') return false;
  if (!uri.startsWith(prefix)) return false;
  const rest = uri.slice(prefix.length);
  if (rest === '' || rest.includes('..') || rest.includes('//')) return false;
  return /^[A-Za-z0-9._@/-]+$/.test(rest);
}

function validEntry(raw: unknown, prefix: string): DemoMediaEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  const variant = demoVariantKey(e.variant);
  if (!variant) return null;
  if (!isAllowedDemoUri(e.posterUri, prefix) || !isAllowedDemoUri(e.clipUri, prefix)) return null;
  const source = typeof e.source === 'string' ? e.source : '';
  return { variant, posterUri: e.posterUri, clipUri: e.clipUri, source };
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * The emulator-only test catalog. Read only when this is an emulator build
 * (the same flag that points the app at the local emulators) AND the page is
 * served from a loopback address — a staging or production page never reads it.
 */
export function testDemoMediaCatalog(
  emulatorFlag: string | undefined,
  win: { location?: { hostname?: string }; __WSF_TEST_DEMO_MEDIA__?: unknown } | undefined
): DemoMediaEntry[] {
  const flag = (emulatorFlag ?? '').trim().toLowerCase();
  if (flag !== '1' && flag !== 'true') return [];
  if (!win || !LOOPBACK.has(win.location?.hostname ?? '')) return [];
  const raw = win.__WSF_TEST_DEMO_MEDIA__;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => validEntry(entry, TEST_FIXTURE_PREFIX))
    .filter((e): e is DemoMediaEntry => e !== null);
}

/** The catalog this page may use: the approved list, plus the test list where allowed. */
export function demoMediaCatalog(): readonly DemoMediaEntry[] {
  const approved = APPROVED_DEMO_MEDIA.map((e) => validEntry(e, APPROVED_MEDIA_PREFIX)).filter(
    (e): e is DemoMediaEntry => e !== null
  );
  const win =
    typeof window === 'undefined'
      ? undefined
      : (window as unknown as Parameters<typeof testDemoMediaCatalog>[1]);
  return [...approved, ...testDemoMediaCatalog(process.env.EXPO_PUBLIC_WSF_USE_EMULATORS, win)];
}

/** The media a movement gets: its exact approved demonstration, or none. */
export function demoMediaFor(
  unit: unknown,
  catalog: readonly DemoMediaEntry[] = demoMediaCatalog()
): FollowAlongMedia {
  const key = demoVariantKey(unit);
  if (!key) return { kind: 'none' };
  const entry = catalog.find((e) => e.variant === key);
  return entry ? { kind: 'poster', posterUri: entry.posterUri, clipUri: entry.clipUri } : { kind: 'none' };
}

// ---- playback rules ---------------------------------------------------------

/** How many times a failed play or load is retried before settling on the poster. */
export const DEMO_RETRY_LIMIT = 2;
/** The pause before a retry. Short: a person is standing in front of it. */
export const DEMO_RETRY_DELAY_MS = 400;

/** What the media slot is showing. */
export type DemoState =
  /** The poster, waiting: before a round, after it, or while the clip loads. */
  | 'poster'
  /** The clip, looping, while the round runs. */
  | 'playing'
  /** The clip, held on its frame, while the round is paused. */
  | 'paused'
  /** The clip could not play: the poster (or the drawn guide) for good. */
  | 'fallback'
  /** Reduced motion: the poster, and the clip is never played. */
  | 'static';

/** What the round asks of the media — derived from the player, never the reverse. */
export type DemoPlayback = 'idle' | 'running' | 'held';

export function demoPlaybackFor(phase: string, running: boolean): DemoPlayback {
  if (phase === 'ready' || phase === 'finished') return 'idle';
  return running ? 'running' : 'held';
}

/** After the n-th failure (1-based), whether to try again. Bounded. */
export function shouldRetryDemo(failures: number): boolean {
  return Number.isFinite(failures) && failures >= 1 && failures <= DEMO_RETRY_LIMIT;
}
