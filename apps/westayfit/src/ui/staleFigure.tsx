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
 * once each time `failed` turns true (src/ui/announce: iOS ignores live
 * regions, and Android's would speak twice beside an announcement). On the web
 * this does nothing; the polite region beside each figure speaks.
 *
 * heads-9 N-3: Community Home renders ONE of these for the page, fed whether
 * any figure on it is stale, so a refresh round that fails every goal speaks
 * once. A failure that predates the mount is not a new failure here and is
 * not spoken: `wasFailed` starts from the first render.
 */
export function StaleAnnouncer({ failed }: { failed: boolean }) {
  const failures = useRef(0);
  const wasFailed = useRef(failed);
  if (failed && !wasFailed.current) failures.current += 1;
  wasFailed.current = failed;
  const owed = failed && failures.current > 0;
  useAnnounce(owed ? STALE_FIGURE_SENTENCE : null, owed ? failures.current : null);
  return null;
}
