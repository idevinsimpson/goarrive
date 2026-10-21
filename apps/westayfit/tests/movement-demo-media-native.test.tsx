import { readFileSync } from 'node:fs';
import * as nodePath from 'node:path';

import { act, createElement, Profiler, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEDIA-1 — the native media slot (src/ui/MovementDemoMedia.tsx)
 * rendered into jsdom through react-native-web, with expo-video, the
 * navigation focus hook, AppState and Image replaced by controllable fakes.
 *
 * The fake player keeps expo-video's lifecycle rules where they matter: a
 * player is created per source, the previous one is released when the source
 * changes, the last one is released on unmount, and a released player throws
 * when used — as the native shared object does.
 *
 * This proves the contract and the absence of side effects. It does not prove
 * decoding, rendering or battery behaviour on a device.
 */

type Listener = (payload: any) => void;

const ctl = vi.hoisted(() => {
  class FakePlayer {
    source: unknown;
    loop = false;
    muted = false;
    volume = 1;
    audioMixingMode = 'auto';
    staysActiveInBackground = true;
    showNowPlayingNotification = true;
    allowsExternalPlayback = true;
    keepScreenOnWhilePlaying = true;
    timeUpdateEventInterval = 1;
    status = 'idle';
    released = false;
    private time = 0;
    listeners = new Map<string, Set<(payload: any) => void>>();
    calls: string[] = [];
    /** Calls attempted on this player after it was released (each throws, like the native object). */
    afterRelease: string[] = [];
    replaceResult: 'resolve' | 'reject' | 'defer' = 'resolve';
    /** Replacements held in flight ('defer'), settled by the test. */
    pendingReplace: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
    constructor(source: unknown) {
      this.source = source;
    }
    private live(name: string) {
      if (this.released) {
        this.afterRelease.push(name);
        throw new Error('Cannot use a released shared object');
      }
    }
    get currentTime() {
      return this.time;
    }
    set currentTime(t: number) {
      this.live('seek');
      this.calls.push(`seek:${t}`);
      this.time = t;
    }
    play() {
      this.live('play');
      this.calls.push('play');
    }
    pause() {
      this.live('pause');
      this.calls.push('pause');
    }
    replaceAsync(source: unknown) {
      this.live('replace');
      this.calls.push('replace');
      this.source = source;
      if (this.replaceResult === 'defer') {
        return new Promise<void>((resolve, reject) => this.pendingReplace.push({ resolve, reject }));
      }
      return this.replaceResult === 'resolve' ? Promise.resolve() : Promise.reject(new Error('load failed'));
    }
    release() {
      this.calls.push('release');
      this.released = true;
    }
    addListener(event: string, fn: (payload: any) => void) {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set());
      this.listeners.get(event)!.add(fn);
      return { remove: () => this.listeners.get(event)?.delete(fn) };
    }
    emit(event: string, payload?: unknown) {
      this.listeners.get(event)?.forEach((fn) => fn(payload));
    }
    count(call: string) {
      return this.calls.filter((c) => c === call).length;
    }
  }
  return {
    FakePlayer,
    players: [] as InstanceType<typeof FakePlayer>[],
    videoProps: null as Record<string, any> | null,
    focused: true,
    /**
     * Whether unmounting runs the focus cleanup (as expo-router does). Off, it
     * models a slot whose screen stays focused while the slot goes away with
     * its focus flag left stale, so `mayPlay()` alone would still say yes.
     */
    blurOnUnmount: true,
    focusSubs: new Set<{ focus: () => void; blur: () => void }>(),
    appState: 'active' as string,
    appListeners: new Set<(state: string) => void>(),
    imageErrors: new Map<string, () => void>(),
  };
});

vi.mock('expo-video', async () => {
  const React = await import('react');
  // expo-video's lifecycle (useReleasingSharedObject): one player per source,
  // the previous released on a source change, the last released on unmount.
  function useVideoPlayer(source: unknown, setup?: (p: any) => void) {
    const key = JSON.stringify(source ?? null);
    const ref = React.useRef<{ key: string; player: any } | null>(null);
    if (!ref.current || ref.current.key !== key) {
      ref.current?.player.release();
      const player = new ctl.FakePlayer(source);
      setup?.(player);
      ctl.players.push(player);
      ref.current = { key, player };
    }
    React.useEffect(() => () => ref.current?.player.release(), []);
    return ref.current.player;
  }
  function VideoView(props: Record<string, any>) {
    ctl.videoProps = props;
    return React.createElement('div', { 'data-testid': props.testID, 'aria-hidden': props['aria-hidden'] ? 'true' : undefined });
  }
  return { useVideoPlayer, VideoView, createVideoPlayer: () => { throw new Error('createVideoPlayer must not be used'); } };
});

vi.mock('expo-router', async () => {
  const React = await import('react');
  // Navigation focus: run on focus (and at mount if focused), clean up on blur and unmount.
  function useFocusEffect(effect: () => void | (() => void)) {
    React.useEffect(() => {
      let cleanup: void | (() => void) = ctl.focused ? effect() : undefined;
      const sub = {
        focus: () => {
          cleanup = effect();
        },
        blur: () => {
          if (typeof cleanup === 'function') cleanup();
          cleanup = undefined;
        },
      };
      ctl.focusSubs.add(sub);
      return () => {
        ctl.focusSubs.delete(sub);
        if (ctl.blurOnUnmount && typeof cleanup === 'function') cleanup();
      };
    }, [effect]);
  }
  return { useFocusEffect };
});

vi.mock('react-native', async () => {
  const React = await import('react');
  const actual = (await vi.importActual('react-native-web')) as Record<string, any>;
  // jsdom never loads images; the fake lets a test fail the poster on demand.
  function Image(props: Record<string, any>) {
    if (props.onError) ctl.imageErrors.set(props.testID ?? 'image', props.onError);
    return React.createElement('div', {
      'data-testid': props.testID,
      'data-uri': props.source?.uri,
      'aria-label': props.accessibilityLabel,
    });
  }
  const AppState = {
    get currentState() {
      return ctl.appState;
    },
    addEventListener: (_type: string, handler: (state: string) => void) => {
      ctl.appListeners.add(handler);
      return { remove: () => ctl.appListeners.delete(handler) };
    },
  };
  return { ...actual, Image, AppState };
});

import { DEMO_RETRY_DELAY_MS, DEMO_RETRY_LIMIT, type DemoPlayback } from '../src/movementDemoMedia';
import { MovementDemoMedia, MovementDemoSlot } from '../src/ui/MovementDemoMedia';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const POSTER = '/media/movements/squats@v1.png';
const CLIP = '/media/movements/squats@v1.mp4';
const POSTER_B = '/media/movements/push-ups@v1.png';
const CLIP_B = '/media/movements/push-ups@v1.mp4';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  ctl.players.length = 0;
  ctl.videoProps = null;
  ctl.focused = true;
  ctl.blurOnUnmount = true;
  ctl.focusSubs.clear();
  ctl.appState = 'active';
  ctl.appListeners.clear();
  ctl.imageErrors.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  // In every test, nothing was ever called on a player after it was released.
  for (const p of ctl.players) expect(p.afterRelease).toEqual([]);
});

function render(
  playback: DemoPlayback,
  reducedMotion = false,
  source: { poster: string; clip: string; slot?: boolean } = { poster: POSTER, clip: CLIP }
) {
  const Component = source.slot ? MovementDemoSlot : MovementDemoMedia;
  act(() => {
    root.render(
      <Component
        posterUri={source.poster}
        clipUri={source.clip}
        label="Movement guide: squats."
        playback={playback}
        reducedMotion={reducedMotion}
        imageStyle={{ width: 240, height: 240 }}
        fallback={createElement('span', { 'data-testid': 'guide' }, 'drawn guide')}
        testIDPrefix="fa"
      />
    );
  });
}

const el = (id: string) => container.querySelector(`[data-testid="${id}"]`);
const state = () => el('fa-demo')?.getAttribute('data-demo-state');
const player = () => ctl.players[ctl.players.length - 1];
const emit = (event: string, payload?: unknown) => act(() => player().emit(event, payload));
const firstFrame = () => act(() => ctl.videoProps!.onFirstFrameRender());
const flush = () => act(async () => {});
const blur = () => act(() => ctl.focusSubs.forEach((s) => s.blur()));
const focus = () => act(() => ctl.focusSubs.forEach((s) => s.focus()));
const appGoes = (next: string) =>
  act(() => {
    ctl.appState = next;
    ctl.appListeners.forEach((h) => h(next));
  });

describe('a muted loop that stays in its slot', () => {
  it('every player is muted, looping and confined: no background, no now-playing, no AirPlay, no keep-awake, no time events', () => {
    render('idle');
    const p = player();
    expect(p.source).toBe(CLIP);
    expect(p).toMatchObject({
      loop: true,
      muted: true,
      volume: 0,
      audioMixingMode: 'mixWithOthers',
      staysActiveInBackground: false,
      showNowPlayingNotification: false,
      allowsExternalPlayback: false,
      keepScreenOnWhilePlaying: false,
      timeUpdateEventInterval: 0,
    });
  });

  it('the view has no controls, no fullscreen, no Picture in Picture, and is hidden from assistive technology', () => {
    render('idle');
    expect(ctl.videoProps).toMatchObject({
      nativeControls: false,
      fullscreenOptions: { enable: false },
      allowsPictureInPicture: false,
      startsPictureInPictureAutomatically: false,
      allowsVideoFrameAnalysis: false,
      contentFit: 'contain',
    });
    expect(ctl.videoProps!.allowsFullscreen).toBeUndefined(); // the deprecated prop is not used
    // expo-video's native view does not parse aria-hidden, so a React Native View around it carries it.
    const wrapper = el('fa-video-a11y');
    expect(wrapper?.getAttribute('aria-hidden')).toBe('true');
    expect(wrapper?.contains(el('fa-video'))).toBe(true);
    expect(ctl.videoProps!['aria-hidden']).toBeUndefined();
  });
});

describe('poster first; the round decides and the clip follows', () => {
  it('ready: the poster over a loaded clip, and nothing plays', () => {
    render('idle');
    expect(state()).toBe('poster');
    expect(el('fa-poster')?.getAttribute('data-uri')).toBe(POSTER);
    expect(el('fa-poster')?.getAttribute('aria-label')).toBe('Movement guide: squats.');
    expect(el('fa-video')).not.toBeNull();
    expect(player().count('play')).toBe(0);
  });

  it('running: plays, but the poster stays until the clip is playing AND has a frame on screen', () => {
    render('running');
    expect(player().count('play')).toBe(1);
    expect(state()).toBe('poster');
    emit('playingChange', { isPlaying: true });
    expect(state()).toBe('poster'); // playing, but no frame rendered yet
    firstFrame();
    expect(state()).toBe('playing');
    expect(el('fa-poster')).toBeNull();
  });

  it('a first frame before playback starts still waits for playing', () => {
    render('running');
    firstFrame();
    expect(state()).toBe('poster');
    emit('playingChange', { isPlaying: true });
    expect(state()).toBe('playing');
  });

  it('held: pauses on its frame; ready again: paused, rewound, poster', () => {
    render('running');
    emit('playingChange', { isPlaying: true });
    firstFrame();
    render('held');
    expect(player().count('pause')).toBeGreaterThanOrEqual(1);
    expect(state()).toBe('paused');
    expect(el('fa-poster')).toBeNull();
    render('running');
    expect(player().count('play')).toBe(2);
    render('idle');
    expect(player().calls).toContain('seek:0');
    expect(state()).toBe('poster');
  });

  it('held before any frame was shown keeps the poster, never an empty view', () => {
    render('running');
    render('held');
    expect(state()).toBe('poster');
    expect(el('fa-poster')).not.toBeNull();
  });

  it('a first frame that lands after the round went to held does not reveal the clip (round-phase guard)', () => {
    render('running');
    emit('playingChange', { isPlaying: true }); // playing, but no frame yet
    render('held');
    firstFrame(); // the frame arrives before playingChange(false)
    expect(state()).toBe('poster');
    expect(el('fa-poster')).not.toBeNull();
  });

  it('a play that lands after the round stopped running is paused, not shown', () => {
    render('running');
    render('held');
    const pauses = player().count('pause');
    firstFrame();
    emit('playingChange', { isPlaying: true });
    expect(player().count('pause')).toBe(pauses + 1);
    expect(state()).not.toBe('playing');
  });
});

describe('bounded retry, then the poster — truthfully', () => {
  it(`retries ${DEMO_RETRY_LIMIT} times, ${DEMO_RETRY_DELAY_MS} ms apart, then settles on the poster and drops the clip`, async () => {
    render('running');
    const first = player();
    emit('statusChange', { status: 'error', error: { message: 'cannot load' } });
    expect(state()).toBe('poster');
    expect(first.count('replace')).toBe(0);
    await act(async () => vi.advanceTimersByTime(DEMO_RETRY_DELAY_MS));
    await flush();
    expect(first.count('replace')).toBe(1);
    expect(first.count('play')).toBe(2); // replayed after the reload, because the round still runs
    emit('statusChange', { status: 'error' });
    await act(async () => vi.advanceTimersByTime(DEMO_RETRY_DELAY_MS));
    await flush();
    expect(first.count('replace')).toBe(2);
    emit('statusChange', { status: 'error' });
    expect(state()).toBe('fallback');
    expect(el('fa-poster')?.getAttribute('data-uri')).toBe(POSTER);
    expect(el('fa-video')).toBeNull();
    // Settled: the clip's player is released and the slot's player holds no source.
    expect(first.released).toBe(true);
    expect(player()).not.toBe(first);
    expect(player().source).toBeNull();
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(first.count('replace')).toBe(2);
    expect(state()).toBe('fallback');
  });

  it('one load reported twice (status error and a rejected reload) counts once', async () => {
    render('running');
    const p = player();
    p.replaceResult = 'reject';
    emit('statusChange', { status: 'error' });
    await act(async () => vi.advanceTimersByTime(DEMO_RETRY_DELAY_MS));
    await flush(); // the rejected reload: failure 2
    emit('statusChange', { status: 'error' }); // the same load's status error: still failure 2
    expect(state()).toBe('poster');
    await act(async () => vi.advanceTimersByTime(DEMO_RETRY_DELAY_MS));
    await flush(); // the last permitted attempt is rejected: failure 3, settle
    expect(p.count('replace')).toBe(2);
    expect(state()).toBe('fallback');
  });

  it('a poster that will not load either shows the drawn guide', () => {
    render('running');
    act(() => ctl.imageErrors.get('fa-poster')!());
    // Still loading: the guide stands over the clip instead of an empty box.
    expect(el('guide')).not.toBeNull();
    expect(el('fa-poster')).toBeNull();
    expect(state()).toBe('poster');
  });

  it('settled on the fallback with a broken poster: the drawn guide, and no player source', async () => {
    render('running');
    for (let i = 0; i <= DEMO_RETRY_LIMIT; i += 1) {
      emit('statusChange', { status: 'error' });
      await act(async () => vi.advanceTimersByTime(DEMO_RETRY_DELAY_MS));
      await flush();
    }
    expect(state()).toBe('fallback');
    act(() => ctl.imageErrors.get('fa-poster')!());
    expect(el('guide')).not.toBeNull();
    expect(player().source).toBeNull();
  });
});

describe('reduced motion: the poster, and no player ever gets the clip', () => {
  it('shows the poster and never plays, whatever the round does', () => {
    render('running', true);
    expect(state()).toBe('static');
    expect(el('fa-poster')).not.toBeNull();
    expect(el('fa-video')).toBeNull();
    expect(ctl.players.every((p) => p.source === null)).toBe(true);
    expect(ctl.players.every((p) => p.count('play') === 0)).toBe(true);
  });

  it('switched on mid-play: the clip stops and its player is released', () => {
    render('running');
    const clipPlayer = player();
    emit('playingChange', { isPlaying: true });
    firstFrame();
    render('running', true);
    expect(state()).toBe('static');
    expect(clipPlayer.released).toBe(true);
    expect(player().source).toBeNull();
  });
});

describe('it stops when nobody can see it', () => {
  it('leaving the screen pauses; returning resumes only a round still running', () => {
    render('running');
    const p = player();
    blur();
    expect(p.calls.at(-1)).toBe('pause');
    focus();
    expect(p.calls.at(-1)).toBe('play');
    blur();
    render('held');
    const plays = p.count('play');
    focus();
    expect(p.count('play')).toBe(plays);
  });

  it('a round that starts while the screen is not focused does not play until it is', () => {
    ctl.focused = false;
    render('idle');
    render('running');
    expect(player().count('play')).toBe(0);
    focus();
    expect(player().count('play')).toBe(1);
  });

  it('the app leaving the foreground pauses; returning resumes only a round still running', () => {
    render('running');
    const p = player();
    appGoes('background');
    expect(p.calls.at(-1)).toBe('pause');
    // While backgrounded, the round asking to run does not start the clip.
    render('held');
    render('running');
    const plays = p.count('play');
    appGoes('active');
    expect(p.count('play')).toBe(plays + 1);
    appGoes('inactive');
    expect(p.calls.at(-1)).toBe('pause');
    render('idle');
    appGoes('active');
    expect(p.calls.at(-1)).not.toBe('play');
  });
});

describe('released on the way out', () => {
  it('unmount releases the player, cancels a pending retry and drops every subscription — without throwing', async () => {
    render('running');
    const p = player();
    emit('statusChange', { status: 'error' }); // a retry is now pending
    expect(vi.getTimerCount()).toBe(1);
    act(() => root.unmount());
    expect(p.released).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(ctl.appListeners.size).toBe(0);
    expect(ctl.focusSubs.size).toBe(0);
    expect([...p.listeners.values()].every((s) => s.size === 0)).toBe(true);
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(p.count('replace')).toBe(0);
    root = createRoot(container);
  });
});

describe('the media can reach nothing that counts', () => {
  it('player events change nothing outside the slot: the round, its clock and its owner never hear them', () => {
    let ownerRenders = 0;
    let setTick: (n: number) => void = () => undefined;
    function Round({ children }: { children: ReactNode }) {
      const [tick, set] = useState(0);
      setTick = set;
      ownerRenders += 1;
      return (
        <>
          <span data-testid="clock">{tick}</span>
          {children}
        </>
      );
    }
    act(() => {
      root.render(
        <Round>
          <MovementDemoMedia
            posterUri={POSTER}
            clipUri={CLIP}
            label="Movement guide: squats."
            playback="running"
            reducedMotion={false}
            imageStyle={{ width: 240, height: 240 }}
            fallback={null}
            testIDPrefix="fa"
          />
        </Round>
      );
    });
    const rendersBefore = ownerRenders;
    const p = player();
    // Everything a player can say, including the end of a loop and time updates.
    act(() => {
      p.emit('playingChange', { isPlaying: true });
      ctl.videoProps!.onFirstFrameRender();
      p.emit('timeUpdate', { currentTime: 3, currentLiveTimestamp: null, currentOffsetFromLive: null, bufferedPosition: 4 });
      p.emit('playToEnd');
      p.emit('sourceChange', { source: CLIP });
      p.emit('statusChange', { status: 'readyToPlay' });
      p.emit('playingChange', { isPlaying: false });
      p.emit('mutedChange', { muted: false });
    });
    expect(ownerRenders).toBe(rendersBefore);
    expect(el('clock')?.textContent).toBe('0');
    // The slot listens to exactly two events, neither of them time or the end of a loop.
    expect([...p.listeners.entries()].filter(([, s]) => s.size > 0).map(([e]) => e).sort()).toEqual([
      'playingChange',
      'statusChange',
    ]);
    // And the round's own clock still belongs to the round.
    act(() => setTick(1));
    expect(el('clock')?.textContent).toBe('1');
  });

  const code = (p: string) =>
    readFileSync(nodePath.resolve(__dirname, '..', p), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

  it('imports nothing that could start, time, count or record a round', () => {
    const src = code('src/ui/MovementDemoMedia.tsx');
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort();
    expect(imports).toEqual(['../movementDemoMedia', 'expo-router', 'expo-video', 'react', 'react-native']);
    // From the router it takes focus only; from the shared rules, constants and types only.
    expect(src).toMatch(/import \{ useFocusEffect \} from 'expo-router'/);
    expect(src).toMatch(/import \{\s*DEMO_RETRY_DELAY_MS,\s*shouldRetryDemo,\s*type DemoPlayback,\s*type DemoState,\s*\} from '\.\.\/movementDemoMedia'/);
    expect(src).not.toMatch(/firebase|httpsCallable|wsfContribute|attemptId|followAlongSession|pendingContribution|setInterval|Date\.now|router\.|createVideoPlayer/);
    // The shared rules module the slot imports reaches nothing either.
    const rules = code('src/movementDemoMedia.ts');
    expect([...rules.matchAll(/from '([^']+)'/g)].map((m) => m[1])).toEqual(['./followAlong']);
    expect(rules).toMatch(/import type \{ FollowAlongMedia \} from '\.\/followAlong'/);
  });

  it('registers no listener but statusChange and playingChange, and takes no callback from the round', () => {
    const src = code('src/ui/MovementDemoMedia.tsx');
    const events = [...src.matchAll(/addListener\('([A-Za-z]+)'/g)].map((m) => m[1]).sort();
    expect(events).toEqual(['playingChange', 'statusChange']);
    // Beyond the player: AppState's foreground changes, and nothing else.
    const others = [...src.matchAll(/addEventListener\('([A-Za-z]+)'/g)].map((m) => m[1]);
    expect(others).toEqual(['change']);
    expect(src).toMatch(/AppState\.addEventListener\('change'/);
    // (`timeUpdateEventInterval = 0` is the setting that turns time events OFF.)
    expect(src).not.toMatch(/\bplayToEnd\b|\btimeUpdate\b|\bsourceLoad\b|\bonEnded\b|\bonTimeUpdate\b/);
    expect(src).toMatch(/timeUpdateEventInterval = 0/);
    const props = src.slice(src.indexOf('export type MovementDemoMediaProps'), src.indexOf('};', src.indexOf('export type MovementDemoMediaProps')));
    expect(props).not.toMatch(/=>|\(\)/);
  });
});

describe('one slot per source: nothing carries from one clip to another', () => {
  const A = { poster: POSTER, clip: CLIP };
  const B = { poster: POSTER_B, clip: CLIP_B };

  for (const slot of [false, true]) {
    const how = slot ? 'the slot itself, unkeyed' : 'MovementDemoMedia (keyed on its source)';

    it(`${how}: a source change mid-retry cancels the retry and never calls the released player`, async () => {
      render('running', false, { ...A, slot });
      const a = player();
      emit('statusChange', { status: 'error' }); // a retry of A is now pending
      expect(vi.getTimerCount()).toBe(1);
      render('running', false, { ...B, slot });
      expect(a.released).toBe(true);
      expect(vi.getTimerCount()).toBe(0); // A's retry is gone
      const b = player();
      expect(b).not.toBe(a);
      expect(b.source).toBe(CLIP_B);
      await act(async () => vi.advanceTimersByTime(DEMO_RETRY_DELAY_MS * 5));
      await flush();
      expect(a.count('replace')).toBe(0);
      expect(a.afterRelease).toEqual([]); // not one call reached the released player
      expect(b.calls).not.toContain('replace');
    });

    it(`${how}: the new clip gets its own full retry budget and its own poster-first reveal`, async () => {
      render('running', false, { ...A, slot });
      emit('statusChange', { status: 'error' });
      await act(async () => vi.advanceTimersByTime(DEMO_RETRY_DELAY_MS));
      await flush();
      emit('statusChange', { status: 'error' }); // A has used both retries' worth of failures
      render('running', false, { ...B, slot });
      const b = player();
      // B starts on its own poster, not on anything A showed.
      expect(state()).toBe('poster');
      expect(el('fa-poster')?.getAttribute('data-uri')).toBe(POSTER_B);
      // B fails: it is retried DEMO_RETRY_LIMIT times before settling — A's count did not carry over.
      for (let i = 1; i <= DEMO_RETRY_LIMIT; i += 1) {
        emit('statusChange', { status: 'error' });
        expect(state()).toBe('poster');
        await act(async () => vi.advanceTimersByTime(DEMO_RETRY_DELAY_MS));
        await flush();
        expect(b.count('replace')).toBe(i);
      }
      emit('statusChange', { status: 'error' });
      expect(state()).toBe('fallback');
    });

    it(`${how}: a playing clip replaced by another shows the poster until the new clip's own first frame`, () => {
      render('running', false, { ...A, slot });
      emit('playingChange', { isPlaying: true });
      firstFrame();
      expect(state()).toBe('playing');
      render('running', false, { ...B, slot });
      expect(state()).toBe('poster');
      expect(el('fa-poster')?.getAttribute('data-uri')).toBe(POSTER_B);
      emit('playingChange', { isPlaying: true });
      expect(state()).toBe('poster'); // B playing, but no frame of B yet
      firstFrame();
      expect(state()).toBe('playing');
    });

    it(`${how}: a clip that settled on the fallback does not make the next clip a fallback`, async () => {
      render('running', false, { ...A, slot });
      for (let i = 0; i <= DEMO_RETRY_LIMIT; i += 1) {
        emit('statusChange', { status: 'error' });
        await act(async () => vi.advanceTimersByTime(DEMO_RETRY_DELAY_MS));
        await flush();
      }
      expect(state()).toBe('fallback');
      render('running', false, { ...B, slot });
      expect(state()).toBe('poster');
      expect(player().source).toBe(CLIP_B);
      expect(el('fa-video')).not.toBeNull();
    });

    it(`${how}: a broken poster does not break the next poster`, () => {
      render('idle', false, { ...A, slot });
      act(() => ctl.imageErrors.get('fa-poster')!());
      expect(el('guide')).not.toBeNull();
      render('idle', false, { ...B, slot });
      expect(el('fa-poster')?.getAttribute('data-uri')).toBe(POSTER_B);
      expect(el('guide')).toBeNull();
    });
  }
});

describe('review follow-ups (#636 round 2)', () => {
  it('a new player for the same clip is a new attempt: reduced motion toggled mid-retry does not silence it (R2-636-1)', async () => {
    render('running');
    emit('statusChange', { status: 'error' }); // failure 1 of the clip; a retry is pending
    render('running', true); // reduced motion on: the clip's player is released, the retry cancelled
    render('running', false); // and off again: a fresh player for the same clip
    const fresh = player();
    expect(fresh.source).toBe(CLIP);
    emit('statusChange', { status: 'error' }); // failure 2: heard, and retried
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => vi.advanceTimersByTime(DEMO_RETRY_DELAY_MS));
    await flush();
    expect(fresh.count('replace')).toBe(1);
    // The clip's budget is per clip, not per player: failure 3 settles it.
    emit('statusChange', { status: 'error' });
    expect(state()).toBe('fallback');
  });

  describe('a reload in flight never acts for a slot that has moved on (R2-636-3)', () => {
    const errorConsole = () => vi.spyOn(console, 'error').mockImplementation(() => undefined);

    for (const outcome of ['resolve', 'reject'] as const) {
      it(`across unmount: a reload that ${outcome}s afterwards plays nothing, retries nothing, sets nothing`, async () => {
        const errors = errorConsole();
        // Even with the focus flag left standing (so `mayPlay()` would say yes),
        // only the reload's own player/alive guard keeps it from playing.
        ctl.blurOnUnmount = false;
        render('running');
        const p = player();
        p.replaceResult = 'defer';
        emit('statusChange', { status: 'error' });
        await act(async () => vi.advanceTimersByTime(DEMO_RETRY_DELAY_MS));
        expect(p.pendingReplace).toHaveLength(1); // in flight
        const plays = p.count('play');
        act(() => root.unmount());
        await act(async () => {
          if (outcome === 'resolve') p.pendingReplace[0].resolve();
          else p.pendingReplace[0].reject(new Error('late'));
        });
        expect(vi.getTimerCount()).toBe(0); // nothing scheduled by the late answer
        await act(async () => vi.advanceTimersByTime(DEMO_RETRY_DELAY_MS * 5));
        expect(vi.getTimerCount()).toBe(0);
        expect(p.count('play')).toBe(plays);
        expect(p.count('replace')).toBe(1);
        expect(p.afterRelease).toEqual([]);
        expect(errors).not.toHaveBeenCalled();
        errors.mockRestore();
        root = createRoot(container);
      });

      for (const slot of [false, true]) {
        it(`across a source change (${slot ? 'unkeyed slot' : 'keyed'}): A's reload that ${outcome}s afterwards touches neither A nor B`, async () => {
          const errors = errorConsole();
          // Keyed, A's slot unmounts: leave its focus flag standing so only the guard can stop a play.
          ctl.blurOnUnmount = false;
          render('running', false, { poster: POSTER, clip: CLIP, slot });
          const a = player();
          a.replaceResult = 'defer';
          emit('statusChange', { status: 'error' });
          await act(async () => vi.advanceTimersByTime(DEMO_RETRY_DELAY_MS));
          expect(a.pendingReplace).toHaveLength(1);
          const playsA = a.count('play');
          render('running', false, { poster: POSTER_B, clip: CLIP_B, slot });
          const b = player();
          const callsB = [...b.calls];
          await act(async () => {
            if (outcome === 'resolve') a.pendingReplace[0].resolve();
            else a.pendingReplace[0].reject(new Error('late'));
          });
          expect(vi.getTimerCount()).toBe(0); // no retry scheduled for anyone
          await act(async () => vi.advanceTimersByTime(DEMO_RETRY_DELAY_MS * 5));
          expect(vi.getTimerCount()).toBe(0);
          expect(a.count('play')).toBe(playsA);
          expect(a.afterRelease).toEqual([]);
          expect(b.calls).toEqual(callsB); // B heard nothing from A's reload
          expect(state()).toBe('poster');
          // And B's budget is untouched: its own first failure is heard and retried.
          emit('statusChange', { status: 'error' });
          expect(vi.getTimerCount()).toBe(1);
          await act(async () => vi.advanceTimersByTime(DEMO_RETRY_DELAY_MS));
          await flush();
          expect(b.count('replace')).toBe(1);
          expect(state()).toBe('poster');
          expect(errors).not.toHaveBeenCalled();
          errors.mockRestore();
        });
      }
    }
  });

  it('the key on MovementDemoMedia remounts the slot for a new source; the bare slot keeps its element (R2-636-7)', () => {
    render('idle', false, { poster: POSTER, clip: CLIP });
    const keyedBefore = el('fa-demo');
    render('idle', false, { poster: POSTER_B, clip: CLIP_B });
    expect(el('fa-demo')).not.toBe(keyedBefore); // a fresh slot: only the key does this
    act(() => root.unmount());
    root = createRoot(container);
    render('idle', false, { poster: POSTER, clip: CLIP, slot: true });
    const bareBefore = el('fa-demo');
    render('idle', false, { poster: POSTER_B, clip: CLIP_B, slot: true });
    expect(el('fa-demo')).toBe(bareBefore); // unkeyed: the same element, scoped internally
  });

  it('a showing update is bound to the player it was made for, even if React applies it after a source change (F1)', () => {
    render('running', false, { poster: POSTER, clip: CLIP, slot: true });
    const a = player();
    emit('playingChange', { isPlaying: true });
    firstFrame();
    // PRECONDITION — why this must follow a real showing change: A must already
    // show 'playing', so the batched update below is a NO-OP for A. Captured
    // correctly it stays bound to A (and B reads as its poster); read lazily at
    // render, after the ref has moved to B, it would be re-bound to B and show
    // B as playing. Without this real prior change there is nothing to tell
    // the two apart.
    expect(state()).toBe('playing');
    // In ONE batch: A reports playing again (a 'playing' update made for A), and the source changes to B.
    act(() => {
      a.emit('playingChange', { isPlaying: true });
      root.render(
        <MovementDemoSlot
          posterUri={POSTER_B}
          clipUri={CLIP_B}
          label="Movement guide: squats."
          playback="running"
          reducedMotion={false}
          imageStyle={{ width: 240, height: 240 }}
          fallback={null}
          testIDPrefix="fa"
        />
      );
    });
    // B has shown no frame: A's update must not make B read as playing.
    expect(player()).not.toBe(a);
    expect(state()).toBe('poster');
    expect(el('fa-poster')?.getAttribute('data-uri')).toBe(POSTER_B);
  });

  it('a showing update that changes nothing does not re-render the slot (R2-636-6)', () => {
    let commits = 0;
    const show = (playback: DemoPlayback) =>
      act(() => {
        root.render(
          <Profiler id="slot" onRender={() => (commits += 1)}>
            <MovementDemoMedia
              posterUri={POSTER}
              clipUri={CLIP}
              label="Movement guide: squats."
              playback={playback}
              reducedMotion={false}
              imageStyle={{ width: 240, height: 240 }}
              fallback={null}
              testIDPrefix="fa"
            />
          </Profiler>
        );
      });
    show('idle'); // the round effect's setShowing('poster') at mount changes nothing
    expect(commits).toBe(1);
    show('running');
    emit('playingChange', { isPlaying: true });
    firstFrame();
    expect(state()).toBe('playing');
    const settled = commits;
    // Repeated reveals: still 'playing'. React may render once more right after a
    // real update before it can bail out; after that, an unchanged update renders
    // nothing. Without the bail-out every one of these would commit.
    for (let i = 0; i < 4; i += 1) {
      emit('playingChange', { isPlaying: true });
      firstFrame();
    }
    expect(commits - settled).toBeLessThanOrEqual(1);
  });
});

describe('MO-06: the clip re-syncs to the round on every foreground', () => {
  it('backgrounded mid-round: the player pauses; the round comes back held, the clip holds its frame; Resume plays it again', () => {
    render('running');
    const p = player();
    emit('playingChange', { isPlaying: true });
    firstFrame();
    expect(state()).toBe('playing');
    appGoes('background');
    expect(p.calls.at(-1)).toBe('pause');
    emit('playingChange', { isPlaying: false }); // the OS stopped it too
    render('held'); // MO-05: the round paused itself while the app was away
    appGoes('active');
    expect(state()).toBe('paused'); // demo-state 'paused': the frame, not the poster
    expect(el('fa-poster')).toBeNull();
    const plays = p.count('play');
    expect(p.calls.at(-1)).not.toBe('play'); // a held round does not play on foreground
    render('running'); // Resume
    expect(p.count('play')).toBe(plays + 1);
    emit('playingChange', { isPlaying: true });
    expect(state()).toBe('playing');
  });

  it('back in front while the round is still running: play() is re-asserted on "active"', () => {
    render('running');
    const p = player();
    emit('playingChange', { isPlaying: true });
    firstFrame();
    appGoes('background');
    emit('playingChange', { isPlaying: false });
    const plays = p.count('play');
    appGoes('active');
    expect(p.count('play')).toBe(plays + 1);
    expect(p.calls.at(-1)).toBe('play');
  });

  it('Control Center (inactive) pauses the clip and "active" resumes it while the round runs', () => {
    render('running');
    const p = player();
    appGoes('inactive');
    expect(p.calls.at(-1)).toBe('pause');
    appGoes('active');
    expect(p.calls.at(-1)).toBe('play');
  });

  it('reduced motion: the poster across every background/foreground cycle, and no player ever has the clip', () => {
    render('running', true);
    for (let i = 0; i < 3; i += 1) {
      appGoes('background');
      appGoes('active');
      expect(state()).toBe('static');
      expect(el('fa-poster')).not.toBeNull();
    }
    expect(ctl.players.every((pl) => pl.source === null && pl.count('play') === 0)).toBe(true);
  });

  it('never takes the audio session or shows Now Playing, never plays in the background; unmount releases the player, blur only pauses it', () => {
    render('running');
    const p = player();
    expect(p).toMatchObject({
      muted: true,
      volume: 0,
      audioMixingMode: 'mixWithOthers',
      showNowPlayingNotification: false,
      staysActiveInBackground: false,
    });
    // Leaving by a forward push keeps the host mounted: the screen blurs and the
    // clip PAUSES (kept, so a return resumes on its frame without reloading)…
    blur();
    expect(p.calls.at(-1)).toBe('pause');
    expect(p.released).toBe(false);
    focus();
    expect(p.calls.at(-1)).toBe('play');
    expect(player()).toBe(p);
    // …and leaving for good unmounts the slot, which releases it.
    act(() => root.unmount());
    expect(p.released).toBe(true);
    root = createRoot(container);
  });

  it('a late background and the return arrive back to back, before the held round renders (N3)', () => {
    render('running');
    const p = player();
    emit('playingChange', { isPlaying: true });
    firstFrame();
    // The background event was late: by the time it lands the app is already
    // back, and the round's held render (MO-05) has not arrived yet.
    appGoes('background');
    appGoes('active'); // the round still reads 'running' here, so play() is re-asserted…
    expect(p.calls.slice(-2)).toEqual(['pause', 'play']);
    render('held'); // …then the round's pause lands
    expect(p.calls.at(-1)).toBe('pause');
    expect(state()).toBe('paused'); // the frame, held
    render('running'); // Resume
    expect(p.calls.at(-1)).toBe('play');
  });
});
