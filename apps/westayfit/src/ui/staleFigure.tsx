import { useRef } from 'react';
import { Platform, Text, type StyleProp, type TextStyle } from 'react-native';

import { useAnnounce } from './announce';
import { useNowTick } from './CommunityPresence';
import { formatConfirmedAt } from './dates';

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
 * `waves` names the failures showing: one value per stale figure, the id of
 * the refresh round whose failure first made it stale (Community Home passes
 * each stale goal's `staleSince`; heads-9 N-3 and heads-11 NB-2), and empty
 * while nothing is stale. Waves already showing when this mounts are not new
 * failures here and are not spoken.
 *
 * W16-20 (heads-14 RV16-642-N2): A WAVE IS SPOKEN WHEN IT HAS NOT BEEN SEEN
 * BEFORE, whatever its value. heads-13 RV15-642-B1 keyed on the newest wave
 * ever seen, so a recovery that fell back to an older, already spoken wave
 * stayed silent; but the ids are the rounds' issue times (Date.now()), and a
 * genuinely new failure can carry an OLDER one: a settle read issued before
 * a newer failed round can fail late, after a full recovery, and the device
 * clock can be corrected backwards. Both were silent. Now every wave value
 * this announcer has seen (seeded with those showing at mount) is kept, and
 * a value it has not seen bumps a counter, which is the announcement's key.
 * A recovery never brings a new value, so it is never spoken as a failure; a
 * round that fails several figures brings one value and speaks once; and a
 * new failure speaks whatever the clock says.
 */
export function StaleAnnouncer({ waves }: { waves: readonly number[] }) {
  const seen = useRef<Set<number> | null>(null);
  const spokenFor = useRef(0);
  if (seen.current === null) {
    seen.current = new Set(waves);
  } else {
    let fresh = false;
    for (const wave of waves) {
      if (seen.current.has(wave)) continue;
      seen.current.add(wave);
      fresh = true;
    }
    if (fresh) spokenFor.current += 1;
  }
  const owed = waves.length > 0 && spokenFor.current > 0;
  useAnnounce(owed ? STALE_FIGURE_SENTENCE : null, owed ? spokenFor.current : null);
  return null;
}

/**
 * NATIVE-MEMBER-1 W16-20 (heads-14 RV16-642-N3, INT-12). Community Home's
 * freshness line under the figure: "Confirmed 3:41 PM", the day named when the
 * figure was confirmed on another day, and "Last confirmed" while a later read
 * has failed (W16-14, formatConfirmedAt). The page has no clock of its own, so
 * a screen left in front across midnight kept "Confirmed 11:58 PM" the next
 * day. This line is drawn again by the shared coarse clock (`useNowTick`:
 * every 60 s while the app is in front, and at once on the return to it), and
 * reads the time at each draw, so a draw for any other reason is never behind.
 */
export function FreshnessLine({
  at,
  failed,
  style,
  testID,
}: {
  at: Date;
  failed: boolean;
  style?: StyleProp<TextStyle>;
  testID?: string;
}) {
  useNowTick();
  return (
    <Text style={style} testID={testID}>
      {formatConfirmedAt(at, new Date(), { failed })}
    </Text>
  );
}
