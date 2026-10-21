import { Platform } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { zoneInWords as fromCombinedSetup } from '../src/combinedSetup';
import { zoneInWords } from '../src/zoneName';

/**
 * NATIVE-MEMBER-1 W16-11 (MF-20). On iOS, Hermes hands back a time-zone name
 * split over several formatToParts parts, so Goal setup and the combined setup
 * read "Eastern" for "Eastern Daylight Time". iOS now reads the name as the
 * zone-bearing string minus the date-only one; web and Android keep today's
 * formatToParts path exactly (Android's ICU is unaffected: the critic's
 * iOS-only gate).
 *
 * "Today's" is the pre-W16-11 helper, copied verbatim below from
 * src/combinedSetup.ts (app/goals/new.tsx carried the same copy), so the web
 * and Android cases compare against what shipped, not against a restatement.
 * The Hermes engine is a stubbed Intl.DateTimeFormat. No device.
 */

// ---- today's helper, verbatim (pre-W16-11) ----
const TODAY_ZONE_LABELS: Readonly<Record<string, string>> = { 'America/Phoenix': 'Arizona Time' };
function todayZoneInWords(tz: string): string {
  const named = TODAY_ZONE_LABELS[tz];
  if (named) return named;
  const plain = tz.replace(/_/g, ' ');
  const nameOf = (timeZoneName: 'long' | 'longGeneric'): string | null => {
    try {
      const part = new Intl.DateTimeFormat(undefined, {
        timeZone: tz,
        // 'longGeneric' is newer than the lib typings; older engines ignore it.
        timeZoneName: timeZoneName as 'long',
      })
        .formatToParts(new Date())
        .find((p) => p.type === 'timeZoneName');
      return part && part.value.trim() ? part.value : null;
    } catch {
      return null;
    }
  };
  const generic = nameOf('longGeneric');
  if (generic && !/^(GMT|UTC)([+-].*)?$/.test(generic)) return generic;
  return nameOf('long') ?? generic ?? plain;
}

// ---- a Hermes-like Intl.DateTimeFormat ----
type Names = {
  long: string;
  /** null: the engine ignores 'longGeneric' and prints no zone at all. */
  generic: string | null;
  /** Override for the zone-bearing string (date, name) => text. */
  shape?: (date: string, name: string) => string;
};
const DATE = '10/21/2026';
function hermesIntl(names: Names): typeof Intl {
  class HermesDateTimeFormat {
    private readonly name: string | null;
    constructor(_locale: unknown, opts: { timeZoneName?: string } = {}) {
      this.name = opts.timeZoneName === 'long' ? names.long : opts.timeZoneName === 'longGeneric' ? names.generic : null;
    }
    format(): string {
      if (!this.name) return DATE;
      return names.shape ? names.shape(DATE, this.name) : `${DATE}, ${this.name}`;
    }
    // Hermes's bug: one part per word, so .find() sees the first word only.
    formatToParts(): Array<{ type: string; value: string }> {
      const parts = [
        { type: 'month', value: '10' },
        { type: 'literal', value: '/' },
        { type: 'day', value: '21' },
        { type: 'literal', value: '/' },
        { type: 'year', value: '2026' },
      ];
      if (!this.name) return parts;
      parts.push({ type: 'literal', value: ', ' });
      this.name.split(' ').forEach((word, i) => {
        if (i > 0) parts.push({ type: 'literal', value: ' ' });
        parts.push({ type: 'timeZoneName', value: word });
      });
      return parts;
    }
  }
  return { ...Intl, DateTimeFormat: HermesDateTimeFormat } as unknown as typeof Intl;
}
const EASTERN: Names = { long: 'Eastern Daylight Time', generic: null };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('W16-11 / MF-20: iOS reads the whole name past Hermes split parts', () => {
  it("ios returns 'Eastern Daylight Time', not the first split part", () => {
    vi.stubGlobal('Intl', hermesIntl(EASTERN));
    expect(zoneInWords('America/New_York', 'ios')).toBe('Eastern Daylight Time');
  });

  it('ios prefers the generic name when the engine has one', () => {
    vi.stubGlobal('Intl', hermesIntl({ long: 'Eastern Daylight Time', generic: 'Eastern Time' }));
    expect(zoneInWords('America/New_York', 'ios')).toBe('Eastern Time');
  });

  it('ios keeps the GMT/UTC filter: a bare offset falls through to the specific name', () => {
    vi.stubGlobal('Intl', hermesIntl({ long: 'India Standard Time', generic: 'GMT+05:30' }));
    expect(zoneInWords('Asia/Kolkata', 'ios')).toBe('India Standard Time');
    vi.unstubAllGlobals();
    // A correct engine: 'UTC' is "GMT" generically, named in full specifically.
    expect(zoneInWords('UTC', 'ios')).toBe('Coordinated Universal Time');
  });

  it('ios trims the separator on either side, and falls back to the identifier when the date is not found', () => {
    vi.stubGlobal('Intl', hermesIntl({ ...EASTERN, shape: (d, n) => `${n}、 ${d}` }));
    expect(zoneInWords('America/New_York', 'ios')).toBe('Eastern Daylight Time');
    vi.stubGlobal('Intl', hermesIntl({ ...EASTERN, shape: (_d, n) => `21 Oct 2026 ${n}` }));
    expect(zoneInWords('America/New_York', 'ios')).toBe('America/New York');
  });

  it("android returns exactly today's formatToParts result, split parts and all", () => {
    vi.stubGlobal('Intl', hermesIntl(EASTERN));
    const today = todayZoneInWords('America/New_York');
    expect(today).toBe('Eastern');
    expect(zoneInWords('America/New_York', 'android')).toBe(today);
    vi.stubGlobal('Intl', hermesIntl({ long: 'India Standard Time', generic: 'GMT+05:30' }));
    expect(zoneInWords('Asia/Kolkata', 'android')).toBe(todayZoneInWords('Asia/Kolkata'));
  });

  it('America/Phoenix still reads Arizona Time on every platform', () => {
    vi.stubGlobal('Intl', hermesIntl({ long: 'Mountain Standard Time', generic: null }));
    for (const os of ['ios', 'android', 'web']) expect(zoneInWords('America/Phoenix', os)).toBe('Arizona Time');
    vi.unstubAllGlobals();
    for (const os of ['ios', 'android', 'web']) expect(zoneInWords('America/Phoenix', os)).toBe('Arizona Time');
  });
});

const ZONES = [
  'America/New_York',
  'Europe/London',
  'UTC',
  'Asia/Kolkata',
  'Etc/GMT+5',
  'America/Argentina/Buenos_Aires',
  'Australia/Lord_Howe',
  'America/Phoenix',
  'Not/A_Zone',
];

describe("W16-11: the web keeps today's real V8 result", () => {
  it("web (and the default, Platform.OS 'web' here) is today's helper, zone for zone", () => {
    expect(Platform.OS).toBe('web');
    for (const tz of ZONES) {
      const today = todayZoneInWords(tz);
      expect(zoneInWords(tz, 'web')).toBe(today);
      expect(zoneInWords(tz)).toBe(today);
      expect(fromCombinedSetup(tz)).toBe(today);
    }
    expect(zoneInWords('America/New_York')).toBe('Eastern Time');
    expect(zoneInWords('Not/A_Zone')).toBe('Not/A Zone');
  });

  it('on an engine that does not split, the iOS reading agrees with the parts reading', () => {
    for (const tz of ZONES) expect(zoneInWords(tz, 'ios')).toBe(todayZoneInWords(tz));
  });
});
