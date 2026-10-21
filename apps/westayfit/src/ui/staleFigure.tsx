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
 * otherwise an id that changes only when a NEW failure makes something stale
 * (Community Home passes the latest refresh round that did; heads-9 N-3 and
 * heads-11 NB-2). Each distinct wave is spoken once. The wave already showing
 * when this mounts is not a new failure here and is not spoken.
 */
export function StaleAnnouncer({ wave }: { wave: number | null }) {
  const atMount = useRef(wave);
  const owed = wave !== null && wave !== atMount.current;
  useAnnounce(owed ? STALE_FIGURE_SENTENCE : null, owed ? wave : null);
  return null;
}
