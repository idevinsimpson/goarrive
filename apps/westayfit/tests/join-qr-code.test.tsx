import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JOIN_QR_COPY, JoinQrCode } from '../src/ui/JoinQrCode';

/**
 * The control itself, rendered into jsdom through react-native-web.
 *
 * This covers what the browser specs assert about the control's own behaviour
 * — the toggle, the printed URL, the `data-qr-url` the specs read, and the
 * private-community sentence — at a layer that can actually be run here. What
 * it CANNOT cover is the thing that makes the feature safe: that this is only
 * ever mounted inside the Champion tools sheet. That is a property of the
 * screen, and it is asserted in tests-e2e/ui-join-qr.spec.ts.
 */

const URL_A = 'https://we-stay-fit.example.com/join/9wq2Zc4TpK1nRu7bVdA0Xg';
const URL_B = 'https://we-stay-fit.example.com/join/ZZZZ9999YYYY8888XXXX77';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(url: string | null): void {
  act(() => {
    root.render(<JoinQrCode url={url} />);
  });
}

const byTestId = (id: string) => container.querySelector(`[data-testid="${id}"]`);

function clickToggle(): void {
  const toggle = byTestId('wsf-community-qr-toggle');
  expect(toggle).not.toBeNull();
  act(() => {
    (toggle as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('JoinQrCode', () => {
  it('starts closed: a toggle, no symbol', () => {
    render(URL_A);
    expect(byTestId('wsf-community-qr-toggle')?.textContent).toBe(JOIN_QR_COPY.show);
    expect(byTestId('wsf-community-qr-symbol')).toBeNull();
    expect(byTestId('wsf-community-qr-url')).toBeNull();
    expect(container.querySelector('[data-qr-url]')).toBeNull();
  });

  it('reveals the symbol, the URL beneath it and the honest note', () => {
    render(URL_A);
    clickToggle();

    const symbol = byTestId('wsf-community-qr-symbol');
    expect(symbol).not.toBeNull();
    expect(symbol?.getAttribute('data-qr-url')).toBe(URL_A);
    expect(byTestId('wsf-community-qr-url')?.textContent).toBe(URL_A);

    const note = byTestId('wsf-community-qr-caveat')?.textContent ?? '';
    expect(note).toContain('has to sign in');
    expect(note).toContain('Reset the link');

    // The picture really is the encoded symbol, inline, with no network fetch.
    const img = container.querySelector('[data-testid="wsf-community-qr-image"] img');
    const src = img?.getAttribute('src') ?? '';
    expect(src).toMatch(/^data:image\/svg\+xml/);
    // Escaped exactly ONCE by react-native-web: a second pass would leave the
    // browser holding '%3Csvg' after its own decode, and nothing would render.
    expect(src).toContain('%3Csvg');
    expect(src).not.toContain('%253C');
    expect(decodeURIComponent(src.replace('data:image/svg+xml;utf8,', ''))).toContain('<svg ');
  });

  it('labels the toggle for both states and keeps aria-expanded honest', () => {
    render(URL_A);
    const toggle = () => byTestId('wsf-community-qr-toggle') as HTMLElement;
    expect(toggle().getAttribute('aria-label')).toBe(JOIN_QR_COPY.show);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    clickToggle();
    expect(toggle().getAttribute('aria-label')).toBe(JOIN_QR_COPY.hide);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().textContent).toBe(JOIN_QR_COPY.hide);
  });

  it('hides the symbol again', () => {
    render(URL_A);
    clickToggle();
    expect(byTestId('wsf-community-qr-symbol')).not.toBeNull();
    clickToggle();
    expect(byTestId('wsf-community-qr-symbol')).toBeNull();
    expect(container.querySelector('[data-qr-url]')).toBeNull();
  });

  it('re-encodes when the join code is rotated under it', () => {
    render(URL_A);
    clickToggle();
    const before = container
      .querySelector('[data-testid="wsf-community-qr-image"] img')
      ?.getAttribute('src');
    expect(byTestId('wsf-community-qr-symbol')?.getAttribute('data-qr-url')).toBe(URL_A);

    // The screen re-derives inviteUrl after wsfResetJoinCode returns; the
    // control holds no code of its own, so the new URL arrives as a prop.
    render(URL_B);
    const after = container
      .querySelector('[data-testid="wsf-community-qr-image"] img')
      ?.getAttribute('src');
    expect(byTestId('wsf-community-qr-symbol')?.getAttribute('data-qr-url')).toBe(URL_B);
    expect(byTestId('wsf-community-qr-url')?.textContent).toBe(URL_B);
    expect(after).not.toBe(before);
    // The old URL is gone from the DOM entirely — no stale symbol, no stale text.
    expect(container.innerHTML).not.toContain('9wq2Zc4TpK1nRu7bVdA0Xg');
  });

  it('renders the reason, and no toggle at all, when the policy admits no one by link', () => {
    render(null);
    expect(byTestId('wsf-community-qr-unavailable')?.textContent).toBe(JOIN_QR_COPY.notJoinable);
    expect(byTestId('wsf-community-qr-toggle')).toBeNull();
    expect(byTestId('wsf-community-qr-symbol')).toBeNull();
    expect(container.querySelector('[data-qr-url]')).toBeNull();
  });

  it('says so rather than drawing a partial symbol when the URL cannot be encoded', () => {
    // Past the version-10 ceiling. A truncated QR would scan cleanly and send
    // whoever scanned it somewhere else entirely.
    render(`https://x.example/join/${'a'.repeat(300)}`);
    clickToggle();
    expect(byTestId('wsf-community-qr-error')?.textContent).toBe(JOIN_QR_COPY.failed);
    expect(byTestId('wsf-community-qr-symbol')).toBeNull();
    expect(container.querySelector('[data-qr-url]')).toBeNull();
  });
});
