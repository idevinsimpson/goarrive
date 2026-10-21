import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * INT-35 (W12-18) — /health's build stamps are monospaced on iOS too:
 * 'monospace' names no font there, so iOS gets its own 'ui-monospace'; the
 * web and Android keep 'monospace'. The stamp style is made at load, so each
 * platform loads the screen afresh. Its data sources are stubbed.
 */

const ctl = vi.hoisted(() => ({ os: 'web' as 'ios' | 'android' | 'web', fonts: [] as string[] }));

vi.mock('react-native', async () => {
  const React = await import('react');
  const actual = (await vi.importActual('react-native-web')) as Record<string, any>;
  const Text = React.forwardRef(function RecordedText(props: Record<string, any>, ref) {
    const flat = actual.StyleSheet.flatten(props.style) ?? {};
    if (typeof flat.fontFamily === 'string') ctl.fonts.push(flat.fontFamily);
    return React.createElement(actual.Text, { ...props, ref });
  });
  return {
    ...actual,
    Text,
    Platform: {
      ...actual.Platform,
      get OS() {
        return ctl.os;
      },
      select: (o: Record<string, unknown>) => (ctl.os in o ? o[ctl.os] : ctl.os !== 'web' && 'native' in o ? o.native : o.default),
    },
  };
});
vi.mock('../src/firebase', () => ({ wsfIsStaging: false }));
vi.mock('../src/ui/CrashRecordsCard', () => ({ CrashRecordsCard: () => null }));
vi.mock('../src/ui/useScreenTopInset', () => ({ useScreenTopInset: () => 0, ScreenTopSpacer: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function stampFontsOn(os: 'ios' | 'android' | 'web') {
  ctl.os = os;
  ctl.fonts = [];
  vi.resetModules();
  const { default: Health } = await import('../app/health');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(Health)));
  const html = host.innerHTML;
  act(() => root.unmount());
  host.remove();
  return { fonts: [...new Set(ctl.fonts)], html };
}

afterEach(() => {
  ctl.os = 'web';
});

describe('/health build stamps', () => {
  it('iOS: ui-monospace', async () => {
    expect((await stampFontsOn('ios')).fonts).toEqual(['ui-monospace']);
  });

  it('Android: monospace', async () => {
    expect((await stampFontsOn('android')).fonts).toEqual(['monospace']);
  });

  it('web: monospace, and in the DOM as before', async () => {
    const { fonts, html } = await stampFontsOn('web');
    expect(fonts).toEqual(['monospace']);
    expect(html).not.toContain('ui-monospace');
  });
});
