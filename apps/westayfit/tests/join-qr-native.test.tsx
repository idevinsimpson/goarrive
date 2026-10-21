import { act, forwardRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 W16-10 (MF-05 F-5). The invite QR was an <Image> with an SVG
 * data URI, which React Native cannot decode: a blank square on a phone (hidden
 * today only because the native origin is null). It now goes through
 * SvgMarkup: natively react-native-svg draws the raw markup; on the web
 * SvgMarkup is the same <Image> with the same raw data URI as before.
 *
 * "native" renders the real SvgMarkup.native with react-native-svg's SvgXml
 * stubbed (it cannot load in jsdom); "web" renders the real web SvgMarkup,
 * with <Image> wrapped to read the props it is given. No device.
 */

const mode = { native: true };
const svgXml: { xml: string | null } = { xml: null };
vi.mock('react-native-svg', () => ({
  SvgXml: ({ xml }: { xml: string }) => {
    svgXml.xml = xml;
    return <div data-testid="svgxml" />;
  },
}));
const imageProps: Record<string, unknown>[] = [];
vi.mock('react-native', async (importOriginal) => {
  const rn = await importOriginal<typeof import('react-native')>();
  const Image = forwardRef<unknown, Record<string, unknown>>((props, ref) => {
    imageProps.push(props);
    const Real = rn.Image as unknown as (p: Record<string, unknown>) => ReactNode;
    return <Real ref={ref} {...props} />;
  });
  return { ...rn, Image };
});
vi.mock('../src/ui/SvgMarkup', async () => {
  const web = await vi.importActual<typeof import('../src/ui/SvgMarkup')>('../src/ui/SvgMarkup');
  const native = await import('../src/ui/SvgMarkup.native');
  return {
    SvgMarkup: (p: Parameters<typeof web.SvgMarkup>[0]) => (mode.native ? native.SvgMarkup(p) : web.SvgMarkup(p)),
  };
});

const { JoinQrCode } = await import('../src/ui/JoinQrCode');
const { encodeQr, qrSvgDataUriRaw, renderQrSvg } = await import('../src/ui/qr');
const { wsfTheme } = await import('../src/theme');

const URL = 'https://westayfit.app/join/Ab3_dE-fGh1JkLmN0pQrSt';
const COLOURS = { dark: wsfTheme.colors.primary, light: '#FFFFFF' };
const LABEL = "QR code for this community's join link";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  mode.native = true;
  svgXml.xml = null;
  imageProps.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
function open(url: string | null): void {
  act(() => root.render(<JoinQrCode url={url} />));
  const toggle = byId('wsf-community-qr-toggle');
  if (toggle) act(() => toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

describe('W16-10 / MF-05: the invite QR on a phone', () => {
  it('SvgMarkup draws the raw markup, with its QR modules, keeping the testIDs and data-qr-url', () => {
    open(URL);
    expect(svgXml.xml).toBe(renderQrSvg(encodeQr(URL), COLOURS));
    expect(svgXml.xml).toMatch(/^<svg/);
    expect(svgXml.xml).toContain('<rect');
    expect(svgXml.xml).not.toContain('data:image');
    expect(byId('wsf-community-qr-symbol')!.getAttribute('data-qr-url')).toBe(URL);
    const image = byId('wsf-community-qr-image')!;
    expect(image).not.toBeNull();
    expect(image.getAttribute('aria-label')).toBe(LABEL);
    // No data-URI <Image> anywhere on a phone.
    expect(imageProps).toHaveLength(0);
  });

  it('the not-joinable and encoder-failure fallbacks are kept', () => {
    open(null);
    expect(byId('wsf-community-qr-unavailable')).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    // Far beyond what versions 1-10 can hold: the encoder refuses, never a partial symbol.
    open(`https://westayfit.app/join/${'A'.repeat(4000)}`);
    expect(byId('wsf-community-qr-error')).not.toBeNull();
    expect(svgXml.xml).toBeNull();
  });
});

describe('W16-10: the web keeps the same <Image> it had', () => {
  it('source, resizeMode, label and testID are exactly what JoinQrCode passed before', () => {
    mode.native = false;
    open(URL);
    expect(imageProps.length).toBeGreaterThan(0);
    const props = imageProps[imageProps.length - 1]!;
    // Before: source={{ uri: qrSvgDataUriRaw(encodeQr(url), colours) }}.
    expect(props.source).toEqual({ uri: qrSvgDataUriRaw(encodeQr(URL), COLOURS) });
    expect(props.resizeMode).toBe('contain');
    expect(props.accessibilityLabel).toBe(LABEL);
    expect(props.testID).toBe('wsf-community-qr-image');
    expect(byId('wsf-community-qr-symbol')!.getAttribute('data-qr-url')).toBe(URL);
    expect(svgXml.xml).toBeNull();
  });
});
