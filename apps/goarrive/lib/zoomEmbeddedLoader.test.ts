import { afterEach, beforeEach, expect, it, vi } from 'vitest';
beforeEach(() => { vi.resetModules(); delete (globalThis as any).ZoomMtgEmbedded; });
afterEach(() => { document.querySelectorAll('script[src*="source.zoom.us"]').forEach(x => x.remove()); delete (globalThis as any).ZoomMtgEmbedded; });
it('refuses to reuse a previously loaded unknown SDK', async () => {
  (globalThis as any).ZoomMtgEmbedded = { old: true };
  const { loadZoomEmbedded } = await import('./zoomEmbeddedLoader');
  await expect(loadZoomEmbedded()).rejects.toThrow('Reload this page');
  expect(document.querySelector('script[src*="source.zoom.us"]')).toBeNull();
});
it('retries a failed download, loads only the pinned bundle externals, and shares the loaded client module', async () => {
  const { loadZoomEmbedded } = await import('./zoomEmbeddedLoader');
  const failed = loadZoomEmbedded();
  document.querySelector('script[src*="source.zoom.us"]')!.dispatchEvent(new Event('error'));
  await expect(failed).rejects.toThrow('Video download failed');
  const loading = loadZoomEmbedded();
  const expected = ['5.1.4/lib/vendor/react.min.js', '5.1.4/lib/vendor/react-dom.min.js', 'zoom-meeting-embedded-5.1.4.min.js'];
  for (let i = 0; i < expected.length; i++) {
    await vi.waitFor(() => expect(document.querySelectorAll('script[src*="source.zoom.us"]').length).toBe(i + 1));
    const script = document.querySelectorAll<HTMLScriptElement>('script[src*="source.zoom.us"]')[i];
    expect(script.src).toBe('https://source.zoom.us/' + expected[i]);
    if (i === 2) (globalThis as any).ZoomMtgEmbedded = { createClient: vi.fn() };
    script.dispatchEvent(new Event('load'));
  }
  const sdk = await loading; expect(await loadZoomEmbedded()).toBe(sdk); expect(sdk.createClient).not.toHaveBeenCalled();
});
