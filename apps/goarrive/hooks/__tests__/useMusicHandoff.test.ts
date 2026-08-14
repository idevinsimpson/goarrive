/** @jest-environment jsdom */

import { act, renderHook } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { createBlessedMusicPlayer, getAudioContextState } from '../useWorkoutTTS';
import { useMusicHandoff } from '../useMusicHandoff';

jest.mock('../useWorkoutTTS', () => ({
  createBlessedMusicPlayer: jest.fn(),
  getAudioContextState: jest.fn(() => 'running'),
  resumeAudioGraph: jest.fn(),
}));

jest.mock('../../utils/musicHandoffVariant', () => ({
  getMusicHandoffVariant: jest.fn(() => 'v3'),
}));

jest.mock('../../utils/handoffLog', () => ({
  pushHandoffLog: jest.fn(),
}));

const originalOS = Platform.OS;
const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');

function makeAudio() {
  const el: any = {
    currentTime: 0,
    muted: false,
    paused: true,
    src: '',
    volume: 1,
    load: jest.fn(),
    removeAttribute: jest.fn(),
  };
  el.pause = jest.fn(() => { el.paused = true; });
  el.play = jest.fn(() => {
    el.paused = false;
    return Promise.resolve();
  });
  return el as HTMLAudioElement;
}

describe('useMusicHandoff v3 shadow controls', () => {
  let visibilityState: DocumentVisibilityState;
  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', {
      value: 'web',
      configurable: true,
      writable: true,
    });
    visibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    });
    jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.mocked(getAudioContextState).mockReturnValue('running');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Object.defineProperty(Platform, 'OS', {
      value: originalOS,
      configurable: true,
      writable: true,
    });
    if (originalVisibility) {
      Object.defineProperty(document, 'visibilityState', originalVisibility);
    }
  });

  function setup() {
    const shadow = makeAudio();
    const audible = makeAudio();
    audible.src = 'https://example.com/music.mp3';
    audible.currentTime = 12;
    const musicPausedRef = { current: false };
    const musicHoldRef = { current: false };
    const musicOffRef = { current: false };
    jest.mocked(createBlessedMusicPlayer).mockReturnValue(shadow);

    const hook = renderHook(
      (props: { isPaused: boolean; isMuted: boolean; volume: number }) =>
        useMusicHandoff({
          enabled: true,
          ...props,
          musicPausedRef,
          musicHoldRef,
          musicOffRef,
        }),
      { initialProps: { isPaused: false, isMuted: false, volume: 0.25 } },
    );

    act(() => {
      hook.result.current.primeShadow(audible);
      hook.result.current.swapTrack(audible.src);
      visibilityState = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
    });

    return { ...hook, audible, shadow, musicPausedRef };
  }

  test('propagates pause, mute, and effective volume while v3 is background-audible', () => {
    const { audible, shadow, rerender, unmount } = setup();

    expect(shadow.play).toHaveBeenCalled();
    expect(shadow.currentTime).toBe(12);
    expect(shadow.muted).toBe(false);
    expect(shadow.volume).toBe(0.25);
    expect(audible.pause).toHaveBeenCalled();

    act(() => rerender({ isPaused: true, isMuted: false, volume: 0.25 }));
    expect(shadow.pause).toHaveBeenCalled();

    act(() => rerender({ isPaused: false, isMuted: true, volume: 0.09 }));
    expect(shadow.play).toHaveBeenCalledTimes(2);
    expect(shadow.muted).toBe(true);
    expect(shadow.volume).toBe(0.09);

    act(() => rerender({ isPaused: false, isMuted: false, volume: 0.64 }));
    expect(shadow.muted).toBe(false);
    expect(shadow.volume).toBe(0.64);
    unmount();
  });

  test('restores position, mute, and active playback on foreground return', () => {
    const { audible, shadow, rerender, unmount } = setup();
    act(() => rerender({ isPaused: false, isMuted: true, volume: 0.25 }));
    shadow.currentTime = 19;
    jest.mocked(audible.play).mockClear();
    jest.mocked(shadow.pause).mockClear();

    act(() => {
      visibilityState = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(audible.currentTime).toBe(19);
    expect(audible.muted).toBe(true);
    expect(audible.play).toHaveBeenCalledTimes(1);
    expect(shadow.pause).toHaveBeenCalledTimes(1);
    unmount();
  });

  test('does not restart the graph-wired element on return while paused', () => {
    const { audible, rerender, unmount } = setup();
    jest.mocked(audible.play).mockClear();

    act(() => rerender({ isPaused: true, isMuted: false, volume: 0.25 }));
    act(() => {
      visibilityState = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(audible.pause).toHaveBeenCalled();
    expect(audible.play).not.toHaveBeenCalled();
    unmount();
  });
});
