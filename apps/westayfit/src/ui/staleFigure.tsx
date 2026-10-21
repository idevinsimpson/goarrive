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
 * once each time a refresh fails (src/ui/announce: iOS ignores live regions,
 * and Android's would speak twice beside an announcement). On the web this
 * does nothing; the polite region beside it speaks.
 */
export function StaleAnnouncer({ failed }: { failed: boolean }) {
  const failures = useRef(0);
  const wasFailed = useRef(false);
  if (failed && !wasFailed.current) failures.current += 1;
  wasFailed.current = failed;
  useAnnounce(failed ? STALE_FIGURE_SENTENCE : null, failed ? failures.current : null);
  return null;
}
