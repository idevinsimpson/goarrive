import { Platform } from 'react-native';

/**
 * NATIVE-MEMBER-1 W16-11 (MF-20). A TIME ZONE IN WORDS, ONE IMPLEMENTATION.
 *
 * "Eastern Time", "United Kingdom Time", "Coordinated Universal Time". The
 * generic name is preferred (it does not flip between standard and daylight);
 * a zone the platform can only name as an offset falls back to the specific
 * name, and a zone it cannot name at all reads as its identifier with the
 * underscores taken out. Arizona is named for the place.
 *
 * IOS ONLY: Hermes on iOS hands back the name split over several parts
 * ("Eastern" · " " · "Daylight" · …), so `formatToParts(...).find(...)` read
 * "Eastern" alone. There the name is the zone-bearing string minus the
 * date-only one, trimmed of separators. Android's ICU is unaffected, and web
 * and Android keep the formatToParts path exactly as before (the critic's
 * iOS-only gate).
 *
 * Shared by Goal setup (app/goals/new.tsx) and the combined setup
 * (src/combinedSetup.ts, which re-exports it), which used to carry two copies.
 */

// A zone Intl names awkwardly reads better as its place. Arizona keeps
// standard time all year, which Intl calls "Mountain Standard Time"; beside
// "Mountain Time" that reads as a duplicate, so it is named for the place.
const ZONE_LABELS: Readonly<Record<string, string>> = { 'America/Phoenix': 'Arizona Time' };

type ZoneStyle = 'long' | 'longGeneric';

function formatter(tz: string, style?: ZoneStyle): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    // 'longGeneric' is newer than the lib typings; older engines ignore it.
    ...(style ? { timeZoneName: style as 'long' } : {}),
  });
}

/** Today's path (web, Android): the formatter's timeZoneName part. */
function nameFromParts(tz: string, style: ZoneStyle, now: Date): string | null {
  try {
    const part = formatter(tz, style)
      .formatToParts(now)
      .find((p) => p.type === 'timeZoneName');
    return part && part.value.trim() ? part.value : null;
  } catch {
    return null;
  }
}

/** iOS: the zone-bearing string minus the date-only string, trimmed of separators. */
function nameFromFormat(tz: string, style: ZoneStyle, now: Date): string | null {
  try {
    const withZone = formatter(tz, style).format(now);
    const dateOnly = formatter(tz).format(now);
    const at = withZone.indexOf(dateOnly);
    if (at < 0) return null;
    const name = (withZone.slice(0, at) + withZone.slice(at + dateOnly.length)).replace(/^[\s,،、]+|[\s,،、]+$/g, '');
    return name ? name : null;
  } catch {
    return null;
  }
}

export function zoneInWords(tz: string, os: string = Platform.OS, now: Date = new Date()): string {
  const named = ZONE_LABELS[tz];
  if (named) return named;
  const plain = tz.replace(/_/g, ' ');
  const nameOf = (style: ZoneStyle): string | null =>
    os === 'ios' ? nameFromFormat(tz, style, now) : nameFromParts(tz, style, now);
  const generic = nameOf('longGeneric');
  // A bare offset ("GMT", "GMT+00:00") is not a name; the specific name
  // ("Coordinated Universal Time") reads better when there is one.
  if (generic && !/^(GMT|UTC)([+-].*)?$/.test(generic)) return generic;
  return nameOf('long') ?? generic ?? plain;
}
