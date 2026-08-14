/**
 * musicHandoffVariant — reads the iOS music-handoff variant switch.
 *
 * The workout player's music element is normally wired to the shared Web Audio
 * graph so the in-player volume slider can drive it (element.volume is a no-op
 * on iOS). But iOS suspends the AudioContext the moment Safari backgrounds, so
 * anything running through the graph goes silent when the member switches apps.
 *
 * The music-handoff adapter (useMusicHandoff) runs a second native `<audio>`
 * element in parallel — never wired to the graph — that takes over playback
 * during backgrounding via one of two variants:
 *   v1 = mute-flip: shadow plays muted alongside; on hide, muted=false
 *   v2 = play-on-hide: shadow paused; on hide, play() at synced position
 *   off = no shadow; adapter installs return-to-foreground resume only
 *
 * Which variant works on iOS is not documented anywhere — this switch is what
 * lets a device spike compare them on the same staging build.
 */
export type MusicHandoffVariant = 'off' | 'v1' | 'v2';

const STORAGE_KEY = 'goarrive.musicHandoffVariant';

/** Extract the ?handoff= value from a URL search string. */
function parseQuery(search: string): MusicHandoffVariant | null {
  try {
    const params = new URLSearchParams(search);
    const raw = params.get('handoff');
    if (raw === 'v1' || raw === 'v2' || raw === 'off') return raw;
  } catch {}
  return null;
}

/**
 * True on Firebase Hosting preview channels (goarrive--<channel>-<hash>.web.app),
 * hosts containing "staging", and localhost. Mirrors isStagingHost in
 * lib/runtimeEnv.ts — duplicated here to keep this module dep-free (imported
 * by hooks that must not pull the whole runtimeEnv module in).
 */
function isStagingLikeHost(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location?.hostname || '';
  if (!host) return false;
  if (host === 'localhost' || host === '127.0.0.1') return true;
  if (host.includes('--')) return true;
  if (host.includes('staging')) return true;
  return false;
}

/**
 * Resolve the current variant. Query param wins; localStorage persists the
 * last query-param choice so the tester can navigate between pages without
 * re-appending the flag.
 *
 * Default policy:
 *   - Staging hosts default to 'v1' so the plain URL tests the fix rather
 *     than the pre-adapter baseline. Devin can still exercise the baseline
 *     explicitly via ?handoff=off — shorter on-device loop this way.
 *   - Production hosts default to 'off' (adapter installs only the
 *     resume-on-return handler and does nothing else). No experimental
 *     audio path reaches real members until a variant wins the device spike
 *     and the default is deliberately flipped in a later change.
 */
export function getMusicHandoffVariant(): MusicHandoffVariant {
  if (typeof window === 'undefined') return 'off';
  const fromQuery = parseQuery(window.location.search);
  if (fromQuery) {
    try { window.localStorage.setItem(STORAGE_KEY, fromQuery); } catch {}
    return fromQuery;
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'v1' || stored === 'v2' || stored === 'off') return stored;
  } catch {}
  return isStagingLikeHost() ? 'v1' : 'off';
}
