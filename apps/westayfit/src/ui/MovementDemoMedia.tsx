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

export function MovementDemoMedia(props: MovementDemoMediaProps) {
  const { posterUri, clipUri, label, playback, reducedMotion, imageStyle, fallback, testIDPrefix } = props;
  const id = (s: string) => `${testIDPrefix}-${s}`;

  const [failed, setFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [showing, setShowing] = useState<'poster' | 'playing' | 'paused'>('poster');
  const failures = useRef(0);
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
  /** Whether the current source has put a frame on screen. */
  const frameShown = useRef(false);
  /** Whether the player reports itself playing. */
  const isPlaying = useRef(false);

  // Only a live slot gives the player the clip; settling on the poster drops it.
  const player = useVideoPlayer(live ? clipUri : null, configureDemoPlayer);

  /** The clip may play only while the round runs and someone can see it. */
  const mayPlay = useCallback(
    () => liveRef.current && playbackRef.current === 'running' && focused.current && foreground.current,
    []
  );

  const reveal = useCallback(() => {
    if (isPlaying.current && frameShown.current && playbackRef.current === 'running') setShowing('playing');
  }, []);

  const clearRetry = () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  };

  // One attempt fails once, however many ways it reports it (a status error
  // and a rejected replace for the same load count as one failure).
  const attemptFailed = useRef(false);

  const fail = useCallback(() => {
    if (attemptFailed.current) return;
    attemptFailed.current = true;
    failures.current += 1;
    clearRetry();
    if (!shouldRetryDemo(failures.current)) {
      setShowing('poster');
      setFailed(true);
      return;
    }
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      if (!liveRef.current) return;
      attemptFailed.current = false;
      frameShown.current = false;
      setShowing('poster');
      player.replaceAsync(clipUri).then(
        () => {
          if (mayPlay()) safely(() => player.play());
        },
        () => fail()
      );
    }, DEMO_RETRY_DELAY_MS);
  }, [player, clipUri, mayPlay]);

  // A new player (a new source) starts with no frame and not playing.
  useEffect(() => {
    frameShown.current = false;
    isPlaying.current = false;
  }, [player]);

  // The only two events this slot hears, and all they change is what it shows.
  useEffect(() => {
    if (!live) return undefined;
    const status = player.addListener('statusChange', ({ status: next }) => {
      if (next === 'error') fail();
    });
    const playing = player.addListener('playingChange', ({ isPlaying: now }) => {
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
  }, [player, live, fail, mayPlay, reveal]);

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
  }, [playback, live, player, mayPlay]);

  // Leaving the screen pauses; coming back resumes only a round still running.
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      if (mayPlay()) safely(() => player.play());
      return () => {
        focused.current = false;
        safely(() => player.pause());
      };
    }, [player, mayPlay])
  );

  // The app leaving the foreground pauses; returning resumes only a round still running.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      foreground.current = inForeground(next);
      if (!foreground.current) safely(() => player.pause());
      else if (mayPlay()) safely(() => player.play());
    });
    return () => sub.remove();
  }, [player, mayPlay]);

  // No retry outlives the slot.
  useEffect(() => () => clearRetry(), []);

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
        onError={() => setPosterFailed(true)}
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
            aria-hidden
            testID={id('video')}
          />
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
