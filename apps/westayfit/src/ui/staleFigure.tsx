import { useRef } from 'react';
import { Platform } from 'react-native';

import { useAnnounce } from './announce';

/** The sentence a failed progress refresh shows and speaks (RETURN-CONTINUITY-1). */
export const STALE_FIGURE_SENTENCE = 'Couldn’t refresh. This is the last confirmed figure.';

/**
 * NATIVE-MEMBER-1 W16-3 (MF-18). Hidden from a phone's screen reader: a
 * duplicate of words it hears elsewhere, or a held empty slot. Nothing on the
 * web, which keeps its own aria-hidden. Read at call time (not at import), so
 * the platform is the one rendering.
 */
export function nativeA11yHidden(): { accessible?: false; importantForAccessibility?: 'no' } {
  return Platform.OS === 'web' ? {} : { accessible: false, importantForAccessibility: 'no' };
}

/**
 * NATIVE-MEMBER-1 W16-3 (INT-18). On a phone, speaks the stale-figure sentence
 * once per failure WAVE (src/ui/announce: iOS ignores live regions, and
 * Android's would speak twice beside an announcement). On the web this does
 * nothing; the polite region beside each figure speaks.
 *
 * `wave` names the failure that is showing: null while nothing is stale, and
 * otherwise an increasing id for the round whose failure made a figure stale
 * (Community Home passes the latest such round among the figures still
 * stale; heads-9 N-3 and heads-11 NB-2). The wave already showing when this
 * mounts is not a new failure here and is not spoken.
 *
 * heads-13 RV15-642-B1: SPOKEN ONCE PER NEW WAVE, KEYED ON THE NEWEST EVER
 * SEEN. When the goal of the newest wave recovers first, the page's latest
 * stale round falls back to an OLDER wave that was already spoken, and
 * keying on it re-spoke the sentence during a recovery. The key is the
 * newest wave this announcer has seen (it only grows), so only a wave newer
 * than every earlier one speaks.
 */
export function StaleAnnouncer({ wave }: { wave: number | null }) {
  const atMount = useRef(wave);
  const newest = useRef(wave);
  if (wave !== null && (newest.current === null || wave > newest.current)) newest.current = wave;
  const owed = wave !== null && newest.current !== atMount.current;
  useAnnounce(owed ? STALE_FIGURE_SENTENCE : null, owed ? newest.current : null);
  return null;
}
