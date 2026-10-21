import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Image } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { moveFigureSvg, moveFigureSvgDataUriRaw } from '../src/ui/moveFigure';
import { encodeQr, qrSvgDataUriRaw, renderQrSvg, SVG_DATA_URI_PREFIX } from '../src/ui/qr';
import { SvgMarkup as NativeSvgMarkup } from '../src/ui/SvgMarkup.native';
import { SvgMarkup as WebSvgMarkup } from '../src/ui/SvgMarkup';

/**
 * MF-05. React Native's <Image> renders an SVG data URI as an empty box, so
 * the invite QR and the drawn movement guide are blank on a phone. The
 * native twin draws the same RAW markup with react-native-svg; the web twin
 * is exactly today's <Image>. react-native-svg is mocked at its boundary
 * (SvgXml as an element carrying its props); no device: how it looks on an
 * iPhone is Appendix C.
 */
vi.mock('react-native-svg', () => ({
  SvgXml: ({ xml, width, height }: { xml: string; width: string; height: string }) => (
    <svg data-testid="svg-xml" data-xml={xml} data-width={width} data-height={height} />
  ),
}));

const QR_OPTS = { dark: '#0B1F3A', light: '#FFFFFF' };
const QR_MARKUP = renderQrSvg(encodeQr('https://wsf.example/join/AbCdEfGhIjKlMnOpQrStUv'), QR_OPTS);
const FIGURE = { kind: 'squat', pose: 'start', accent: true } as const;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
function render(el: ReactElement): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('MF-05: SvgMarkup draws raw SVG markup on a phone', () => {
  it('the native twin hands the RAW QR markup (its <rect> and module path) to SvgXml, filling its box, with the label and testID on one image element', () => {
    expect(QR_MARKUP).toContain('<rect ');
    expect(QR_MARKUP).toContain('<path ');
    const el = render(
      <NativeSvgMarkup
        markup={QR_MARKUP}
        style={{ width: 180, height: 180 }}
        accessibilityLabel="QR code for this community's join link"
        testID="wsf-join-qr-image"
      />,
    );
    const box = el.querySelector('[data-testid="wsf-join-qr-image"]') as HTMLElement;
    expect(box).not.toBeNull();
    expect(box.getAttribute('role')).toBe('img');
    expect(box.getAttribute('aria-label')).toBe("QR code for this community's join link");
    const svg = box.querySelector('[data-testid="svg-xml"]') as HTMLElement;
    expect(svg.getAttribute('data-xml')).toBe(QR_MARKUP);
    expect(svg.getAttribute('data-width')).toBe('100%');
    expect(svg.getAttribute('data-height')).toBe('100%');
    // RV10-641-3: the box keeps the caller's size ...
    expect(box.style.width).toBe('180px');
    // No data URI and no <img> anywhere: that is the path that renders blank.
    expect(el.innerHTML).not.toContain('data:image/svg+xml');
    expect(el.querySelector('img')).toBeNull();
  });

  it('RV10-641-3: ... and clips the drawing to it (overflow hidden, before the caller\'s style)', () => {
    const el = NativeSvgMarkup({ markup: QR_MARKUP, style: { width: 180, height: 180 } });
    expect((el.props.style as unknown[])[0]).toEqual({ overflow: 'hidden' });
    expect((el.props.style as unknown[])[1]).toEqual({ width: 180, height: 180 });
  });

  it('RV10-641-3: the style takes a box, never the keys only an <Image> understands', () => {
    const ok = <NativeSvgMarkup markup={QR_MARKUP} style={{ width: 120, aspectRatio: 1, margin: 4, borderRadius: 8 }} />;
    // @ts-expect-error resizeMode would be dropped silently by the native View
    const resize = <NativeSvgMarkup markup={QR_MARKUP} style={{ resizeMode: 'cover' }} />;
    // @ts-expect-error tintColor would be dropped silently by the native View
    const tint = <WebSvgMarkup markup={QR_MARKUP} style={{ tintColor: '#000' }} />;
    expect([ok, resize, tint]).toHaveLength(3);
  });

  it('the native twin draws the movement figure the same way', () => {
    const el = render(<NativeSvgMarkup markup={moveFigureSvg(FIGURE)} accessibilityLabel="Squat, start" testID="wsf-figure" />);
    const svg = el.querySelector('[data-testid="svg-xml"]') as HTMLElement;
    expect(svg.getAttribute('data-xml')).toBe(moveFigureSvg(FIGURE));
    expect(svg.getAttribute('data-xml')).toMatch(/^<svg /);
  });

  it('the native twin is a View around SvgXml, never React Native\'s Image', () => {
    const code = readFileSync(join(__dirname, '..', 'src', 'ui', 'SvgMarkup.native.tsx'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(code).toMatch(/import \{ SvgXml \} from 'react-native-svg'/);
    expect(code).toMatch(/<SvgXml xml=\{markup\}/);
    expect(code).not.toMatch(/\bImage\b/);
  });
});

describe('MF-05: the web twin is exactly today\'s <Image>', () => {
  const style = { width: 180, height: 180 };

  it('JoinQrCode\'s props: the raw QR data URI, contain, its label and testID', () => {
    const el = WebSvgMarkup({ markup: QR_MARKUP, style, accessibilityLabel: "QR code for this community's join link", testID: 'wsf-join-qr-image' });
    expect(el.type).toBe(Image);
    expect(el.props).toEqual({
      source: { uri: qrSvgDataUriRaw(encodeQr('https://wsf.example/join/AbCdEfGhIjKlMnOpQrStUv'), QR_OPTS) },
      style,
      resizeMode: 'contain',
      accessibilityLabel: "QR code for this community's join link",
      testID: 'wsf-join-qr-image',
    });
  });

  it('FollowAlongCard\'s props: the raw figure data URI, contain, its label and testID', () => {
    const el = WebSvgMarkup({ markup: moveFigureSvg(FIGURE), style, accessibilityLabel: 'Squat, start', testID: 'wsf-move-figure-image' });
    expect(el.type).toBe(Image);
    expect(el.props).toEqual({
      source: { uri: moveFigureSvgDataUriRaw(FIGURE) },
      style,
      resizeMode: 'contain',
      accessibilityLabel: 'Squat, start',
      testID: 'wsf-move-figure-image',
    });
  });

  it('renders the same DOM as today\'s <Image> call', () => {
    const today = render(
      <Image source={{ uri: moveFigureSvgDataUriRaw(FIGURE) }} style={style} resizeMode="contain" accessibilityLabel="Squat, start" testID="wsf-x" />,
    ).innerHTML;
    act(() => root!.unmount());
    host!.remove();
    const twin = render(<WebSvgMarkup markup={moveFigureSvg(FIGURE)} style={style} accessibilityLabel="Squat, start" testID="wsf-x" />).innerHTML;
    expect(twin).toBe(today);
    expect(twin).toContain('data:image/svg+xml');
  });

  it('one prefix: moveFigure and SvgMarkup use qr.ts\'s SVG_DATA_URI_PREFIX, defined once', () => {
    expect(moveFigureSvgDataUriRaw(FIGURE)).toBe(`${SVG_DATA_URI_PREFIX}${moveFigureSvg(FIGURE)}`);
    const ui = join(__dirname, '..', 'src', 'ui');
    const definitions = ['qr.ts', 'moveFigure.ts', 'SvgMarkup.tsx', 'SvgMarkup.native.tsx'].filter((f) =>
      /(const|let|var)\s+SVG_DATA_URI_PREFIX\s*=/.test(readFileSync(join(ui, f), 'utf8')),
    );
    expect(definitions).toEqual(['qr.ts']);
  });
});
