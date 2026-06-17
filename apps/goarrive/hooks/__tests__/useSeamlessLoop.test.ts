/**
 * Regression tests for useSeamlessLoop RAF lifecycle.
 *
 * Guards against:
 *  - RAF handle leaks when the hook unmounts before the 500ms init timer fires
 *  - Leaked polls surviving an unmount (double-RAF on remount)
 *  - Platform guard: no RAF activity on non-web platforms
 */

import { renderHook } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { useSeamlessLoop } from '../useSeamlessLoop';

const originalOS = Platform.OS;

// Minimal fake Video element — only the fields useSeamlessLoop reads.
function makeMockVideo() {
  return {
    loop: false,
    duration: 10,
    currentTime: 9.9,
    paused: false,
  };
}

// Fake container whose querySelector() returns a video.
function makeMockContainer(video = makeMockVideo()) {
  return { querySelector: jest.fn().mockReturnValue(video) };
}

describe('useSeamlessLoop — RAF lifecycle', () => {
  let requestSpy: jest.SpyInstance;
  let cancelSpy: jest.SpyInstance;

  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true, writable: true });
    let nextId = 1;
    requestSpy = jest
      .spyOn(global, 'requestAnimationFrame')
      .mockImplementation((cb) => {
        // Store the callback but don't auto-invoke it so we control the loop.
        void cb;
        return nextId++;
      });
    cancelSpy = jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(jest.fn());
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    requestSpy.mockRestore();
    cancelSpy.mockRestore();
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true, writable: true });
  });

  test('cancelAnimationFrame is called on cleanup after RAF is live', () => {
    const container = makeMockContainer();
    const ref = { current: container as any };

    const { unmount } = renderHook(() =>
      useSeamlessLoop(ref, 'https://example.com/vid.mp4'),
    );

    // Advance past the 500 ms init delay so the hook requests its first RAF.
    jest.advanceTimersByTime(600);
    expect(requestSpy).toHaveBeenCalled();
    const liveRafId = requestSpy.mock.results[0].value;

    unmount();
    expect(cancelSpy).toHaveBeenCalledWith(liveRafId);
  });

  test('unmount before init timer fires cancels the timeout — no RAF started', () => {
    const ref = { current: null as any };

    const { unmount } = renderHook(() =>
      useSeamlessLoop(ref, 'https://example.com/vid.mp4'),
    );

    // Unmount before the 500 ms delay fires.
    unmount();
    jest.advanceTimersByTime(600);

    // destroyed=true prevents init from running, so RAF should never be called.
    expect(requestSpy).not.toHaveBeenCalled();
    expect(cancelSpy).not.toHaveBeenCalled();
  });

  test('remount after unmount starts exactly one new RAF — no duplicate polls', () => {
    const container = makeMockContainer();
    const ref = { current: container as any };

    const { unmount } = renderHook(() =>
      useSeamlessLoop(ref, 'https://example.com/vid.mp4'),
    );
    jest.advanceTimersByTime(600);
    expect(requestSpy).toHaveBeenCalledTimes(1);

    unmount();
    expect(cancelSpy).toHaveBeenCalledTimes(1);

    // Fresh mount — a second independent hook instance.
    const { unmount: unmount2 } = renderHook(() =>
      useSeamlessLoop(ref, 'https://example.com/vid2.mp4'),
    );
    jest.advanceTimersByTime(600);
    // Exactly one more RAF request — no zombie polls from the unmounted instance.
    expect(requestSpy).toHaveBeenCalledTimes(2);

    unmount2();
    expect(cancelSpy).toHaveBeenCalledTimes(2);
  });

  test('no-op on non-web platform — RAF never called', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true, writable: true });
    const ref = { current: null as any };

    const { unmount } = renderHook(() =>
      useSeamlessLoop(ref, 'https://example.com/vid.mp4'),
    );
    jest.advanceTimersByTime(600);
    expect(requestSpy).not.toHaveBeenCalled();
    unmount();
    expect(cancelSpy).not.toHaveBeenCalled();
  });
});
