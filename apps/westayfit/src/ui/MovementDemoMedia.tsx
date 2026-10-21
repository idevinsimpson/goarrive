/**
 * THE MEDIA SLOT'S DEMONSTRATION — native (iOS and Android).
 *
 * NATIVE-MEDIA-1. The same contract as the web clip adapter
 * (MovementDemoMedia.web.tsx), played with expo-video:
 *
 *  - POSTER FIRST. The poster is up the instant the card renders; the clip
 *    loads behind it and replaces it only once it is actually playing AND its
 *    first frame is on screen.
 *  - IT PLAYS ONLY WHILE THE ROUND RUNS. Ready and finished show the poster
 *    with the clip rewound to its start; a paused round holds the clip on its
 *    frame (or keeps the poster if no frame has been shown yet). The round
 *    decides; the clip follows.
 *  - BOUNDED RETRY, THEN THE POSTER. A load or playback error is retried
 *    DEMO_RETRY_LIMIT times, DEMO_RETRY_DELAY_MS apart, and then the slot
 *    settles on the poster for good — or on the drawn guide if the poster will
 *    not load either. Loading never shows a spinner: the poster is the
 *    loading state.
 *  - REDUCED MOTION: the poster, and no player is ever given the clip.
 *  - MUTED, NO CONTROLS, NOWHERE ELSE. Muted, looping, mixed with (never
 *    interrupting) the person's own audio; no native controls, no fullscreen,
 *    no Picture in Picture, no AirPlay, no now-playing notification, no
 *    background playback, and it does not hold the screen awake.
 *  - IT STOPS WHEN NOBODY CAN SEE IT. Leaving the screen (navigation blur) or
 *    the app leaving the foreground pauses it; it resumes only if the round is
 *    still running when the person comes back.
 *  - RELEASED ON THE WAY OUT. `useVideoPlayer` releases the player when the
 *    slot unmounts, and when the slot settles on the poster (reduced motion,
 *    or the clip failed) the player is replaced by one with no source, so
 *    nothing is left decoding.
 *
 * IT TAKES NO CALLBACK FROM THE ROUND, AND LISTENS FOR NOTHING THAT COULD MOVE
 * IT. The only player events handled are `statusChange` (to notice an error)
 * and `playingChange` (to know when to take the poster down), and all either
 * can change is what this slot shows. The end of a loop, time updates, a
 * pause: none of them is wired to the clock, the attempt, the queue or a
 * contribution, because there is nothing here to wire them to.
 *
 * ADDRESSES. The slot plays exactly the poster and clip it is given. A source
 * the platform cannot load fails, is retried within the bound, and settles on
 * the poster; nothing here rewrites or guesses an address.
 */
import { useFocusEffect } from 'expo-router';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Image, StyleSheet, View, type ImageStyle, type StyleProp } from 'react-native';

import {
  DEMO_RETRY_DELAY_MS,
  shouldRetryDemo,
  type DemoPlayback,
  type DemoState,
} from '../movementDemoMedia';

export type MovementDemoMediaProps = {
  posterUri: string;
  clipUri: string;
  /** What the poster and clip show, for the accessibility label. */
  label: string;
  /** What the round asks of the media. The media never answers back. */
  playback: DemoPlayback;
  reducedMotion: boolean;
  imageStyle: StyleProp<ImageStyle>;
  /** The drawn movement guide, for when nothing else can be shown. */
  fallback: ReactNode;
  testIDPrefix: string;
};

/** A player call that may land after the player was released (unmount). Never throws. */
function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    // Released or not ready: there is nothing left to pause, play or rewind.
  }
}

/**
 * Every player this slot creates: a muted loop that stays in this slot.
 * Each setting is applied on its own, so one a platform lacks (AirPlay is
 * iOS-only) cannot stop the others.
 */
export function configureDemoPlayer(player: VideoPlayer): void {
  safely(() => (player.loop = true));
  safely(() => (player.muted = true));
  safely(() => (player.volume = 0));
  safely(() => (player.audioMixingMode = 'mixWithOthers'));
  safely(() => (player.staysActiveInBackground = false));
  safely(() => (player.showNowPlayingNotification = false));
  safely(() => (player.allowsExternalPlayback = false));
  safely(() => (player.keepScreenOnWhilePlaying = false));
  safely(() => (player.timeUpdateEventInterval = 0));
}

const inForeground = (state: string): boolean => state !== 'background' && state !== 'inactive';

/**
 * ONE SLOT PER SOURCE. Everything the slot learns — failures, the pending
 * retry, whether the poster failed, what it is showing — is about ONE poster
 * and ONE clip. Keying the slot on them means a changed source starts a fresh
 * slot (the old player released, its retry cancelled, its counters gone), so
 * nothing from one clip can be applied to, or call into, another. The slot
 * itself is also scoped (below), so it stays correct even if rendered unkeyed.
 */
export function MovementDemoMedia(props: MovementDemoMediaProps) {
  return <MovementDemoSlot key={`${props.posterUri}\n${props.clipUri}`} {...props} />;
}

type Showing = 'poster' | 'playing' | 'paused';

/** The slot itself. Exported for tests; the app renders it through MovementDemoMedia. */
export function MovementDemoSlot(props: MovementDemoMediaProps) {
  const { posterUri, clipUri, label, playback, reducedMotion, imageStyle, fallback, testIDPrefix } = props;
  const id = (s: string) => `${testIDPrefix}-${s}`;

  // SOURCE-SCOPED STATE. A failure belongs to the clip it happened to, a
  // broken poster to that poster, and what is showing to the player showing
  // it: read against the current source, anything recorded for another one
  // reads as nothing.
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const failed = failedFor === clipUri;
  const [posterFailedFor, setPosterFailedFor] = useState<string | null>(null);
  const posterFailed = posterFailedFor === posterUri;
  const attempts = useRef({ clip: clipUri, failures: 0, attemptFailed: false });
  if (attempts.current.clip !== clipUri) attempts.current = { clip: clipUri, failures: 0, attemptFailed: false };
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read by player events and retries, which outlive the render they began in.
  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  const live = !reducedMotion && !failed;
  const liveRef = useRef(live);
  liveRef.current = live;
  // Not assumed: the focus effect sets it (one render after mount, once
  // navigation has loaded). Until then the poster stays up, which is truthful.
  const focused = useRef(false);
  const foreground = useRef(inForeground(AppState.currentState));
  /** Whether the current player has put a frame on screen. */
  const frameShown = useRef(false);
  /** Whether the current player reports itself playing. */
  const isPlaying = useRef(false);

  // Declared BEFORE the player so its cleanup runs before useVideoPlayer's
  // release on unmount: every later cleanup then knows the player is going and
  // leaves it alone, so nothing is ever called on a released player.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Only a live slot gives the player the clip; settling on the poster drops it.
  const player = useVideoPlayer(live ? clipUri : null, configureDemoPlayer);
  const playerRef = useRef(player);
  playerRef.current = player;
  /** Whether `p` is still this slot's player (not replaced, not being released). */
  const usable = useCallback((p: VideoPlayer) => alive.current && playerRef.current === p, []);

  // What is showing belongs to the player that showed it: a new player has
  // shown nothing yet, so it reads as the poster until its own first frame.
  const [shown, setShown] = useState<{ player: VideoPlayer; value: Showing }>({ player, value: 'poster' });
  const showing: Showing = shown.player === player ? shown.value : 'poster';
  // A call that would change nothing keeps the same state object, so React
  // skips the render. The player is captured when the call is made: React may
  // run the updater later (at render), when playerRef could already name another.
  const setShowing = useCallback((value: Showing) => {
    const forPlayer = playerRef.current;
    setShown((prev) => (prev.player === forPlayer && prev.value === value ? prev : { player: forPlayer, value }));
  }, []);

  /** The clip may play only while the round runs and someone can see it. */
  const mayPlay = useCallback(
    () => liveRef.current && playbackRef.current === 'running' && focused.current && foreground.current,
    []
  );

  const reveal = useCallback(() => {
    if (isPlaying.current && frameShown.current && playbackRef.current === 'running') setShowing('playing');
  }, [setShowing]);

  const clearRetry = () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  };

  // One attempt fails once, however many ways it reports it (a status error
  // and a rejected replace for the same load count as one failure). Every
  // retry is bound to the player and clip it was scheduled for: if either has
  // changed by the time it fires or answers, it does nothing.
  const fail = useCallback(() => {
    const scope = attempts.current;
    if (scope.clip !== clipUri || playerRef.current !== player) return;
    if (scope.attemptFailed) return;
    scope.attemptFailed = true;
    scope.failures += 1;
    clearRetry();
    if (!shouldRetryDemo(scope.failures)) {
      setShowing('poster');
      setFailedFor(clipUri);
      return;
    }
    const retryPlayer = player;
    const current = () => usable(retryPlayer) && attempts.current === scope && liveRef.current;
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      if (!current()) return;
      scope.attemptFailed = false;
      frameShown.current = false;
      setShowing('poster');
      safely(() => {
        retryPlayer.replaceAsync(clipUri).then(
          () => {
            if (current() && mayPlay()) safely(() => retryPlayer.play());
          },
          () => {
            if (current()) fail();
          }
        );
      });
    }, DEMO_RETRY_DELAY_MS);
  }, [player, clipUri, mayPlay, setShowing, usable]);

  // A new player starts with no frame, not playing, no retry of the old one
  // pending, and a fresh attempt: the old player's reported failure does not
  // silence the new one's (the clip's failure COUNT carries over; it is per clip).
  useEffect(() => {
    frameShown.current = false;
    isPlaying.current = false;
    attempts.current.attemptFailed = false;
    return () => clearRetry();
  }, [player]);

  // The only two events this slot hears, and all they change is what it shows.
  useEffect(() => {
    if (!live) return undefined;
    const status = player.addListener('statusChange', ({ status: next }) => {
      if (next === 'error') fail();
    });
    const playing = player.addListener('playingChange', ({ isPlaying: now }) => {
      if (!usable(player)) return;
      isPlaying.current = now;
      // A play that lands after the round stopped running is not shown as playing.
      if (now && !mayPlay()) safely(() => player.pause());
      else reveal();
    });
    if (player.status === 'error') fail();
    return () => {
      safely(() => status.remove());
      safely(() => playing.remove());
    };
  }, [player, live, fail, mayPlay, reveal, usable]);

  // THE ROUND DECIDES; THE CLIP FOLLOWS.
  useEffect(() => {
    if (!live) return;
    if (playback === 'running') {
      if (mayPlay()) safely(() => player.play());
    } else if (playback === 'held') {
      safely(() => player.pause());
      setShowing(frameShown.current ? 'paused' : 'poster');
    } else {
      safely(() => player.pause());
      safely(() => (player.currentTime = 0));
      setShowing('poster');
    }
  }, [playback, live, player, mayPlay, setShowing]);

  // Leaving the screen pauses; coming back resumes only a round still running.
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      if (mayPlay()) safely(() => player.play());
      return () => {
        focused.current = false;
        if (usable(player)) safely(() => player.pause());
      };
    }, [player, mayPlay, usable])
  );

  // The app leaving the foreground pauses; returning resumes only a round still running.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      foreground.current = inForeground(next);
      if (!usable(player)) return;
      if (!foreground.current) safely(() => player.pause());
      else if (mayPlay()) safely(() => player.play());
    });
    return () => sub.remove();
  }, [player, mayPlay, usable]);

  const onFirstFrameRender = useCallback(() => {
    frameShown.current = true;
    reveal();
  }, [reveal]);

  const state: DemoState = reducedMotion ? 'static' : failed ? 'fallback' : showing;
  const box = StyleSheet.flatten(imageStyle) ?? {};
  const size = { width: box.width, height: box.height };
  const posterImage = (overlay: boolean) =>
    posterFailed ? (
      overlay ? (
        <View style={[styles.overlay, size]}>{fallback}</View>
      ) : (
        fallback
      )
    ) : (
      <Image
        source={{ uri: posterUri }}
        style={overlay ? [imageStyle, styles.overlay] : imageStyle}
        resizeMode="contain"
        accessibilityLabel={label}
        onError={() => setPosterFailedFor(posterUri)}
        testID={id('poster')}
      />
    );

  return (
    <View
      testID={id('demo')}
      style={state === 'static' || state === 'fallback' ? null : [styles.box, size]}
      {...({ dataSet: { 'demo-state': state } } as Record<string, unknown>)}
    >
      {state === 'static' || state === 'fallback' ? (
        posterImage(false)
      ) : (
        <>
          {/*
            Hidden from VoiceOver and TalkBack. React Native's own View maps
            `aria-hidden` to accessibilityElementsHidden and
            importantForAccessibility="no-hide-descendants"; expo-video's native
            view does not parse it, so the wrapper carries it.
          */}
          <View style={StyleSheet.absoluteFill} aria-hidden testID={id('video-a11y')}>
            <VideoView
              player={player}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              nativeControls={false}
              fullscreenOptions={FULLSCREEN_OFF}
              allowsPictureInPicture={false}
              startsPictureInPictureAutomatically={false}
              allowsVideoFrameAnalysis={false}
              onFirstFrameRender={onFirstFrameRender}
              testID={id('video')}
            />
          </View>
          {/* POSTER FIRST: over the clip until the clip is actually playing. */}
          {state === 'poster' ? posterImage(true) : null}
        </>
      )}
    </View>
  );
}

const FULLSCREEN_OFF = { enable: false } as const;

const styles = StyleSheet.create({
  box: { position: 'relative', overflow: 'hidden' },
  overlay: { position: 'absolute', top: 0, left: 0 },
});
