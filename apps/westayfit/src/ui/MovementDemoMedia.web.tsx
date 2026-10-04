/**
 * THE MEDIA SLOT'S DEMONSTRATION — web, phone browser and the station screen.
 *
 * A muted, inline, looping clip of an APPROVED movement demonstration, in the
 * slot the drawn movement guide occupies — and nothing else about the player
 * changes. What it does, in the order a person sees it:
 *
 *  - POSTER FIRST. The poster is up the instant the card renders; the clip
 *    loads behind it and is shown only once it is actually playing.
 *  - IT PLAYS ONLY WHILE THE ROUND RUNS. Ready and finished show the poster
 *    with the clip rewound to its first frame; a paused round holds the clip on
 *    its frame. The round decides; the clip follows.
 *  - BOUNDED RETRY, THEN THE POSTER. A rejected `play()` or a load error is
 *    retried DEMO_RETRY_LIMIT times and then the slot settles on the poster
 *    for good — or on the drawn guide if the poster will not load either. A
 *    cold, offline first load lands on bundled guidance, not on a spinner.
 *  - REDUCED MOTION: the poster, and the clip is never played.
 *  - RELEASED ON THE WAY OUT: paused, source dropped, so a screen that has
 *    moved on is not still decoding a loop.
 *
 * IT TAKES NO CALLBACK FROM THE ROUND, AND LISTENS FOR NOTHING THAT COULD MOVE
 * IT. The only video event handled is `error`, and all it can change is what
 * this slot shows. `ended`, `timeupdate`, a loop, a pause: none of them is
 * wired to the clock, the attempt, the queue or a contribution, because there
 * is nothing here to wire them to.
 */
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import {
  DEMO_RETRY_DELAY_MS,
  shouldRetryDemo,
  type DemoState,
} from '../movementDemoMedia';
import type { MovementDemoMediaProps } from './MovementDemoMedia';

export function MovementDemoMedia(props: MovementDemoMediaProps) {
  const { posterUri, clipUri, label, playback, reducedMotion, imageStyle, fallback, testIDPrefix } = props;
  const id = (s: string) => `${testIDPrefix}-${s}`;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [showing, setShowing] = useState<'poster' | 'playing' | 'paused'>('poster');
  const failures = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read by the async play() continuation, so a round that paused while a play
  // was in flight is not shown as playing.
  const playbackRef = useRef(playback);
  playbackRef.current = playback;

  const attemptPlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.play().then(
      () => {
        if (playbackRef.current === 'running') setShowing('playing');
        else v.pause();
      },
      (e: unknown) => {
        // A play() interrupted by our own pause()/load() is not a failure.
        if ((e as { name?: string } | null)?.name === 'AbortError') return;
        fail();
      }
    );
    // `fail` is declared below and stable; it only touches refs and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fail = useCallback(() => {
    failures.current += 1;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    if (!shouldRetryDemo(failures.current)) {
      setFailed(true);
      return;
    }
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      const v = videoRef.current;
      if (!v) return;
      v.load();
      if (playbackRef.current === 'running') attemptPlay();
    }, DEMO_RETRY_DELAY_MS);
  }, [attemptPlay]);

  // THE ROUND DECIDES; THE CLIP FOLLOWS.
  useEffect(() => {
    if (failed || reducedMotion) return;
    const v = videoRef.current;
    if (!v) return;
    if (playback === 'running') {
      attemptPlay();
    } else if (playback === 'held') {
      v.pause();
      setShowing('paused');
    } else {
      v.pause();
      try {
        v.currentTime = 0;
      } catch {
        // Not seekable yet: nothing has played, so it is already at the start.
      }
      setShowing('poster');
    }
  }, [playback, failed, reducedMotion, attemptPlay]);

  // A hidden page never keeps decoding. (The round pauses itself on the same
  // signal; this does not depend on that.)
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') videoRef.current?.pause();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // No retry outlives the slot.
  useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    []
  );

  // RELEASED ON THE WAY OUT — done where React detaches the element, not in an
  // effect cleanup: on unmount the ref is detached BEFORE cleanups run, so a
  // cleanup reading the ref finds nothing (the station spec caught exactly
  // that). The same path releases the clip when the slot settles on the
  // poster. Paused, source dropped, nothing left decoding.
  const setVideo = useCallback(
    (v: HTMLVideoElement | null) => {
      const previous = videoRef.current;
      if (previous && previous !== v) {
        previous.removeEventListener('error', fail);
        previous.pause();
        previous.removeAttribute('src');
        previous.load();
      }
      videoRef.current = v;
      if (v) {
        v.muted = true;
        v.defaultMuted = true;
        v.addEventListener('error', fail);
      }
    },
    [fail]
  );

  const state: DemoState = reducedMotion ? 'static' : failed ? 'fallback' : showing;
  const box = StyleSheet.flatten(imageStyle) ?? {};
  const posterImage = (overlay: boolean) =>
    posterFailed ? null : (
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
      style={state === 'static' || state === 'fallback' ? null : [styles.box, { width: box.width, height: box.height }]}
      {...({ dataSet: { 'demo-state': state } } as Record<string, unknown>)}
    >
      {state === 'static' || state === 'fallback' ? (
        posterFailed ? (
          fallback
        ) : (
          posterImage(false)
        )
      ) : (
        <>
          {createElement('video', {
            ref: setVideo,
            src: clipUri,
            poster: posterUri,
            muted: true,
            loop: true,
            playsInline: true,
            preload: 'auto',
            'aria-hidden': true,
            'data-testid': id('video'),
            style: videoStyle,
          })}
          {/* POSTER FIRST: over the clip until the clip is actually playing. */}
          {state === 'poster' ? posterImage(true) : null}
        </>
      )}
    </View>
  );
}

const videoStyle = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  objectFit: 'contain',
  backgroundColor: 'transparent',
} as const;

const styles = StyleSheet.create({
  box: { position: 'relative', overflow: 'hidden' },
  overlay: { position: 'absolute', top: 0, left: 0 },
});
