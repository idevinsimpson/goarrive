import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * INT-36 (W12-18) — counts on a phone are always en-US; the web keeps the
 * browser's locale. A device set to Germany is simulated by making de-DE the
 * default Intl locale. src/ui/countLocale(.native).ts are loaded as each
 * platform's build resolves them (vitest applies no platform extensions).
 */

const RealNumberFormat = Intl.NumberFormat;
const realToLocaleString = Number.prototype.toLocaleString;
function deviceIn(locale: string) {
  // The device's default for Number#toLocaleString too (what CommunityPresence used before).
  vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function toLocaleStringIn(
    this: number,
    locales?: Intl.LocalesArgument,
    options?: Intl.NumberFormatOptions,
  ) {
    return realToLocaleString.call(this, locales ?? locale, options);
  });
  // A constructor (formatCount calls `new Intl.NumberFormat`) that defaults to `locale`.
  vi.spyOn(Intl, 'NumberFormat').mockImplementation(function NumberFormatIn(
    locales?: string | string[],
    options?: Intl.NumberFormatOptions,
  ) {
    return new RealNumberFormat(locales ?? locale, options);
  } as unknown as typeof Intl.NumberFormat);
}

async function formatCountOn(platform: 'native' | 'web') {
  vi.resetModules();
  vi.doMock('../src/ui/countLocale', () =>
    platform === 'native' ? import('../src/ui/countLocale.native') : vi.importActual('../src/ui/countLocale'),
  );
  return (await import('../src/ui/progressFormat')).formatCount;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('../src/ui/countLocale');
  vi.resetModules();
});

describe('countLocale', () => {
  it('the twins: en-US on a phone, the browser’s own (undefined) on the web', async () => {
    expect((await import('../src/ui/countLocale.native')).COUNT_LOCALE).toBe('en-US');
    expect((await vi.importActual<typeof import('../src/ui/countLocale')>('../src/ui/countLocale')).COUNT_LOCALE).toBeUndefined();
  });

  it('a phone set to Germany prints 4,999 (not "4.999"), and 25,000 and 1,000,000 the same way', async () => {
    deviceIn('de-DE');
    const formatCount = await formatCountOn('native');
    expect(formatCount(4999)).toBe('4,999');
    expect(formatCount(25000)).toBe('25,000');
    expect(formatCount(1_000_000)).toBe('1,000,000');
    expect(formatCount(4999.9)).toBe('4,999'); // still truncated, never rounded up
  });

  it('the web follows the browser, exactly as before: a German browser reads 4.999', async () => {
    deviceIn('de-DE');
    const formatCount = await formatCountOn('web');
    expect(formatCount(4999)).toBe('4.999');
    expect(formatCount(Number.NaN)).toBe('0');
  });
});

describe('CommunityPresence momentum rows count through formatCount', () => {
  it('“added 4,999 squats” on a phone set to Germany', async () => {
    deviceIn('de-DE');
    vi.resetModules();
    vi.doMock('../src/ui/countLocale', () => import('../src/ui/countLocale.native'));
    const { MomentumRow } = await import('../src/ui/CommunityPresence');
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() =>
      root.render(
        createElement(MomentumRow, { row: { displayName: 'Ana', amount: 4999, unit: 'squats', at: '' }, first: true }),
      ),
    );
    expect(host.textContent).toContain('added 4,999 squats');
    act(() => root.unmount());
  });
});
