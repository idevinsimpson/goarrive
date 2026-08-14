/**
 * @jest-environment jsdom
 */
/**
 * Regression tests for useMediaPrefetch web-preload behavior.
 *
 * Guards against:
 *  - Hidden <video> not created on web (wrong platform guard)
 *  - Early removal of the hidden video before the 5 s post-loadeddata TTL
 *    (early cleanup would evict the video from the browser cache before
 *     the active Video layer can benefit from it)
 *  - Touching document on non-web platforms (should be a no-op)
 */

import { vi } from 'vitest';
import { Platform, Image } from 'react-native';
import { renderHook } from '../../test-utils/renderHook';
import { useMediaPrefetch } from '../useMediaPrefetch';

const originalOS = Platform.OS;

function makeMovements(videoUrls: Array<string | undefined>) {
  return videoUrls.map((videoUrl) => ({ videoUrl }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Web platform tests
// ─────────────────────────────────────────────────────────────────────────────

describe('useMediaPrefetch — web platform', () => {
  let createdVideos: any[];
  let appendedBodyElements: any[];
  let removedBodyElements: any[];
  let appendBodySpy: ReturnType<typeof vi.spyOn>;
  let appendHeadSpy: ReturnType<typeof vi.spyOn>;
  let removeBodySpy: ReturnType<typeof vi.spyOn>;
  let createElementOrig: typeof document.createElement;

  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true, writable: true });
    createdVideos = [];
    appendedBodyElements = [];
    removedBodyElements = [];

    // Replace document.createElement so we can intercept video element creation.
    createElementOrig = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = createElementOrig(tag) as any;
      if (tag === 'video') {
        // Intercept the specific video elements the hook creates.
        createdVideos.push(el);
      }
      return el;
    });

    appendBodySpy = vi.spyOn(document.body, 'appendChild').mockImplementation((el: any) => {
      appendedBodyElements.push(el);
      return el;
    });
    appendHeadSpy = vi.spyOn(document.head, 'appendChild').mockImplementation((el: any) => el);
    removeBodySpy = vi.spyOn(document.body, 'removeChild').mockImplementation((el: any) => {
      removedBodyElements.push(el);
      return el;
    });

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    (document.createElement as any).mockRestore?.();
    appendBodySpy.mockRestore();
    appendHeadSpy.mockRestore();
    removeBodySpy.mockRestore();
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true, writable: true });
  });

  test('creates a hidden <video> element with the correct src during countdown', () => {
    const url = 'https://storage.example.com/movement-1.mp4';
    const movements = makeMovements([url, 'https://storage.example.com/movement-2.mp4']);

    renderHook(() =>
      useMediaPrefetch(movements, 0, false, false, /* isCountdown */ true, false),
    );

    expect(createdVideos.length).toBeGreaterThan(0);
    const videoEl = createdVideos[0];
    expect(videoEl.src).toBe(url);
    expect(videoEl.preload).toBe('auto');
    expect(videoEl.muted).toBe(true);
  });

  test('hidden video is NOT removed before 5 s post-loadeddata (early-cleanup guard)', () => {
    const url = 'https://storage.example.com/next-mov.mp4';
    const movements = makeMovements(['https://storage.example.com/current.mp4', url]);

    renderHook(() =>
      useMediaPrefetch(movements, 0, false, /* isResting */ true, false, false),
    );

    expect(createdVideos.length).toBeGreaterThan(0);
    const videoEl = createdVideos[0];
    expect(videoEl).toBeDefined();

    // Fire the loadeddata event — schedules a 5 s cleanup.
    videoEl.dispatchEvent(new Event('loadeddata'));

    // Immediately after: video must still be in DOM.
    expect(removedBodyElements).not.toContain(videoEl);

    // 4.9 s — still alive.
    vi.advanceTimersByTime(4900);
    expect(removedBodyElements).not.toContain(videoEl);

    // > 5 s — cleanup fires.
    vi.advanceTimersByTime(200);
    expect(removedBodyElements).toContain(videoEl);
  });

  test('video element is appended to document.body', () => {
    const url = 'https://storage.example.com/mov.mp4';
    const movements = makeMovements(['https://x.com/curr.mp4', url]);

    renderHook(() =>
      useMediaPrefetch(movements, 0, false, true, false, false),
    );

    expect(appendedBodyElements).toContain(createdVideos[0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Non-web platform tests
// ─────────────────────────────────────────────────────────────────────────────

describe('useMediaPrefetch — non-web platform', () => {
  let createElementSpy: ReturnType<typeof vi.spyOn>;
  let appendBodySpy: ReturnType<typeof vi.spyOn>;
  let imagePrefetchSpy: ReturnType<typeof vi.spyOn>;

  let fetchSpy: { mockRestore: () => void };

  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true, writable: true });
    createElementSpy = vi.spyOn(document, 'createElement');
    appendBodySpy = vi.spyOn(document.body, 'appendChild');
    // Image.prefetch must return a promise on native.
    imagePrefetchSpy = vi.spyOn(Image, 'prefetch').mockResolvedValue(true);
    // fetch is used as the native cache-warmer; define it if missing (jsdom may not have it).
    (global as any).fetch = vi.fn().mockResolvedValue({});
    fetchSpy = { mockRestore: () => { delete (global as any).fetch; } } as any;
  });

  afterEach(() => {
    createElementSpy.mockRestore();
    appendBodySpy.mockRestore();
    imagePrefetchSpy.mockRestore();
    fetchSpy.mockRestore();
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true, writable: true });
  });

  test('does not touch document on native (ios)', () => {
    const movements = makeMovements([
      'https://x.com/curr.mp4',
      'https://x.com/next.mp4',
    ]);

    renderHook(() =>
      useMediaPrefetch(movements, 0, false, true, false, false),
    );

    const videoCalls = createElementSpy.mock.calls.filter((c: any[]) => c[0] === 'video');
    expect(videoCalls).toHaveLength(0);
    expect(appendBodySpy).not.toHaveBeenCalled();
  });
});
