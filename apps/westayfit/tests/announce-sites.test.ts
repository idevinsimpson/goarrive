import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * W12-7 (INT-18). WHERE AN OUTCOME IS ANNOUNCED, AND WHO OWNS EACH PLACE.
 *
 * One helper for every lane (src/ui/announce(.native).ts): a site spreads
 * `liveRegion` where it had `aria-live="polite"` (the same attribute on the
 * web, nothing on a phone) and speaks through `useAnnounce` on a phone. This
 * scan lists every announcing site in the files below with its owner:
 *   - the integrator's sites must use the helper now;
 *   - another lane's site is listed with its ticket and shows as a todo until
 *     it adopts the helper (it then simply passes);
 *   - a raw `aria-live` that is on no list fails, so a new site has to be
 *     added here, by whoever owns it.
 * Extend SITES rather than loosening the rule.
 */
type Site = { owner: 'integrator' | 'state' | 'camera'; ticket: string; note: string };

const CONTRIBUTE = 'app/contribute/[goalId].tsx';
const PROGRESS = 'src/ui/ProgressParityView.tsx';

/** Every announcing element in contribute, by testID. */
const CONTRIBUTE_SITES: Record<string, Site> = {
  'wsf-contribute-refused': { owner: 'integrator', ticket: 'W12-7', note: 'the definitive refusal (closed, invalid, not a member …)' },
  'wsf-contribute-error': { owner: 'integrator', ticket: 'W12-7', note: 'the entry error (alert role on the web)' },
  'wsf-contribute-recording': { owner: 'state', ticket: 'W13-4', note: 'recording' },
  'wsf-contribute-pending': { owner: 'state', ticket: 'W13-4', note: 'pending / unknown' },
  'wsf-contribute-restore-failed': { owner: 'state', ticket: 'W13-4', note: 'the stored attempt could not be read' },
  'wsf-contribute-receipt': { owner: 'state', ticket: 'W13-4', note: 'the receipts (the Together receipt speaks itself on native)' },
  'wsf-kiosk-countdown': { owner: 'state', ticket: 'W13-4', note: 'the kiosk countdown' },
  'wsf-kiosk-finish-error': { owner: 'state', ticket: 'W13-4', note: 'the kiosk sign-out failure' },
  'wsf-contribute-adjust-value': { owner: 'camera', ticket: 'W15', note: 'the adjust value' },
};

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

/** The testID of each element in `text` that carries a raw `aria-live` attribute. */
export function rawLiveRegions(text: string): string[] {
  const ids: string[] = [];
  const re = /aria-live=/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = text.lastIndexOf('<', m.index);
    const element = text.slice(start, text.indexOf('>', m.index) + 1);
    ids.push(/testID="([^"]+)"/.exec(element)?.[1] ?? `(no testID at ${m.index})`);
  }
  return ids;
}

const contribute = read(CONTRIBUTE);
const progress = read(PROGRESS);

describe('W12-7: the integrator\'s announcing sites use the shared helper', () => {
  it('the refusal: liveRegion where aria-live was, and its visible sentence spoken once per refusal', () => {
    expect(contribute).toMatch(/testID="wsf-contribute-refused"\s*\{\.\.\.liveRegion\}/);
    expect(contribute).toContain('useAnnounce(refusalSpoken ? `Not recorded. ${refusalSpoken.headline} ${refusalSpoken.body}` : null, announceKeyFor(refusal));');
  });

  it('the entry error: still role=alert (the web\'s live region for it), and spoken on a phone once per appearance', () => {
    const element = contribute.slice(contribute.lastIndexOf('<Text', contribute.indexOf('testID="wsf-contribute-error"')), contribute.indexOf('testID="wsf-contribute-error"') + 300);
    expect(element).toContain('accessibilityRole="alert"');
    expect(contribute).toContain('useAnnounce(entryError, announceKeyFor(entryErrorToken));');
  });

  it('the Progress partial note: spoken once per appearance; no Android live region beside it (it would speak twice)', () => {
    expect(progress).toContain("useAnnounce(PARTIAL_SENTENCE, 'partial');");
    expect(progress).not.toContain('accessibilityLiveRegion');
    expect(progress).toMatch(/testID="wsf-activity-partial" role="status"/);
  });

  it('the helper comes from one module (src/ui/announce), never a local copy', () => {
    expect(contribute).toContain("import { liveRegion, useAnnounce } from '../../src/ui/announce';");
    expect(progress).toContain("import { useAnnounce } from './announce';");
    for (const text of [contribute, progress]) expect(text).not.toMatch(/announceForAccessibility/);
  });
});

describe('W12-7: every announcing site in contribute is listed with its owner', () => {
  const raw = rawLiveRegions(contribute);

  it('the detector finds aria-live by its element\'s testID, wherever the attribute sits', () => {
    expect(rawLiveRegions('<View testID="a" aria-live="polite">')).toEqual(['a']);
    expect(rawLiveRegions('<Text\n  style={s}\n  aria-live={x}\n  testID="b"\n>')).toEqual(['b']);
    expect(rawLiveRegions('<View {...liveRegion} testID="c">')).toEqual([]);
  });

  it('no raw aria-live outside the list; none on an integrator site', () => {
    expect(raw.length).toBeGreaterThan(3);
    expect(raw.filter((id) => !(id in CONTRIBUTE_SITES))).toEqual([]);
    expect(raw.filter((id) => CONTRIBUTE_SITES[id]?.owner === 'integrator')).toEqual([]);
  });

  for (const [id, site] of Object.entries(CONTRIBUTE_SITES).filter(([, s]) => s.owner !== 'integrator')) {
    if (raw.includes(id)) it.todo(`${site.ticket} (${site.owner}): ${id}, ${site.note}, adopts liveRegion + useAnnounce`);
  }
});
