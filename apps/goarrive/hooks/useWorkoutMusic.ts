/**
 * useWorkoutMusic — workout background music playlist manager (Mubert pools)
 *
 * Replaces the single looped track with a no-repeat playlist of fixed-length
 * pooled tracks (music_cache/<style>/track_<n>.mp3 via the getWorkoutMusic
 * callable). Web-only, like the music feature it absorbed from WorkoutPlayer.
 *
 * Institutional rules preserved from the original implementation:
 *  - ONE HTMLAudioElement, created + primed synchronously inside the Play tap
 *    gesture (iOS Safari only allows play() from a user gesture). Track changes
 *    swap `src` on that same blessed element — allowed after the initial bless.
 *  - e49f0a0 rule: an element is always paused before src is swapped/released
 *    so an abandoned load can never resurrect and play on its own.
 *  - Music hold: while the intro announcement speaks, music stays primed but
 *    silent; releaseMusicHold() lets it in.
 *
 * "Same exact music" guarantee: the queue is a deterministic permutation
 * seeded by workoutId+style, and shared per-workout dislikes are excluded for
 * everyone — so a coach and a member playing the same workout hear the same
 * songs in the same order. Likes never reorder (that would break determinism).
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { httpsCallable } from 'firebase/functions';
import {
  arrayRemove,
  arrayUnion,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db, functions } from '../lib/firebase';
import { MUSIC_MAX_TRACKS_PER_STYLE } from '../constants/musicStyles';
// The music panel slider drives ONLY the music bus of the shared Web Audio
// graph in useWorkoutTTS — coach voice / cue audio live on a separate voice
// bus that stays at full volume. Routing through Web Audio is required on
// iOS Safari, which ignores JS-set HTMLAudioElement.volume entirely.
import { setMusicVolume, wireToGain } from './useWorkoutTTS';
// iOS background-music handoff adapter — see hook file for full contract.
import { useMusicHandoff } from './useMusicHandoff';

// Pure queue/id helpers live in useWorkoutMusic.helpers.ts (no RN/Firebase
// deps — safe to import in vitest). Re-exported here for convenience.
import { buildMusicQueue, parseTrackId, toTrackId } from './useWorkoutMusic.helpers';
export { buildMusicQueue, hashSeed, indicesForStyle, mulberry32, parseTrackId, toTrackId } from './useWorkoutMusic.helpers';
export type { MusicQueueInput } from './useWorkoutMusic.helpers';

// Cap on new Mubert generations a single session may trigger — protects the
// license quota; once spent, the queue prefers already-cached tracks.
const MAX_NEW_GENERATIONS_PER_SESSION = 3;

// ── Hook ────────────────────────────────────────────────────────────────────

type TrackStatus = 'idle' | 'loading' | 'playing' | 'stalled';

interface TrackResponse {
  url: string;
  path: string;
  cached: boolean;
  style: string;
  trackIndex: number;
  trackId: string;
  fallback?: boolean;
}

interface ListResponse {
  style: string;
  readyIndices: number[];
  maxTracks: number;
  trackDuration: number;
}

export interface UseWorkoutMusicOptions {
  /** Platform.OS === 'web' && workout.workoutMusicEnabled — computed by caller. */
  enabled: boolean;
  visible: boolean;
  phase: string;
  isPaused: boolean;
  /** Master mute for all workout audio; force-mutes music too. */
  isMuted: boolean;
  initialStyle: string;
  initialVolume: number;
  /** Signed-in listener (real uid, not effectiveUid) — null for guests. */
  uid: string | null;
  workoutId: string | null;
  coachId: string | null;
}

export interface UseWorkoutMusicReturn {
  /** MUST be called synchronously inside the Play tap gesture. */
  startMusic: () => void;
  stopMusic: () => void;
  releaseMusicHold: () => void;
  musicHoldRef: MutableRefObject<boolean>;
  musicMuted: boolean;
  toggleMusicMuted: () => void;
  musicOff: boolean;
  turnOffForSession: () => void;
  turnMusicBackOn: () => void;
  currentStyle: string;
  currentTrackIndex: number | null;
  currentTrackId: string | null;
  trackStatus: TrackStatus;
  volume: number;
  setVolume: (v: number) => void;
  skipNext: () => void;
  skipBack: () => void;
  liked: boolean;
  disliked: boolean;
  toggleLike: () => void;
  toggleDislike: () => void;
  changeStyle: (style: string) => void;
}

export function useWorkoutMusic(opts: UseWorkoutMusicOptions): UseWorkoutMusicReturn {
  const { enabled, visible, phase, isPaused, isMuted, initialStyle, initialVolume, uid, workoutId, coachId } = opts;

  const [musicMuted, setMusicMuted] = useState(false);
  const [musicOff, setMusicOff] = useState(false);
  const [currentStyle, setCurrentStyle] = useState(initialStyle);
  const [currentTrack, setCurrentTrack] = useState<{ style: string; index: number } | null>(null);
  const [trackStatus, setTrackStatus] = useState<TrackStatus>('idle');
  const [volume, setVolumeState] = useState(initialVolume);
  const [likedSet, setLikedSet] = useState<Set<string>>(new Set());
  const [dislikedSet, setDislikedSet] = useState<Set<string>>(new Set());
  const [sharedDislikedSet, setSharedDislikedSet] = useState<Set<string>>(new Set());

  const musicElRef = useRef<HTMLAudioElement | null>(null);
  const musicPausedRef = useRef(false);
  // While the intro announcement speaks, music is held (primed but silent).
  const musicHoldRef = useRef(false);
  const musicOffRef = useRef(false);
  const mutedRef = useRef(false);
  const volumeRef = useRef(initialVolume);
  const currentStyleRef = useRef(initialStyle);
  const currentTrackRef = useRef<{ style: string; index: number } | null>(null);
  const likedSetRef = useRef<Set<string>>(new Set());
  const dislikedSetRef = useRef<Set<string>>(new Set());
  const sharedDislikedSetRef = useRef<Set<string>>(new Set());
  // Per-style queue state: deterministic order + how far we've consumed it.
  const queuesRef = useRef<Map<string, { order: number[]; pos: number }>>(new Map());
  const historyRef = useRef<Array<{ style: string; index: number }>>([]);
  const urlCacheRef = useRef<Map<string, string>>(new Map());
  const fetchesRef = useRef<Map<string, Promise<TrackResponse | null>>>(new Map());
  const readyIndicesRef = useRef<Map<string, Set<number>>>(new Map());
  const generationCountRef = useRef(0);
  // Bumped on every style change / stop so stale async resolutions are dropped.
  const seqRef = useRef(0);
  const bootstrappedRef = useRef(false);
  const phaseRef = useRef(phase);

  useEffect(() => { mutedRef.current = isMuted || musicMuted; }, [isMuted, musicMuted]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Music handoff adapter — owns visibilitychange/pageshow/focus resume for
  // all variants (byte-for-byte parity with the pre-adapter handler when
  // variant=off; verified on desktop Chrome tab-switch). On iOS Safari with
  // ?handoff=v1, ?handoff=v2, or ?handoff=v3, also runs a shadow <audio>
  // that takes over during backgrounding so music survives Safari-exit.
  const { primeShadow, swapTrack, teardownShadow } = useMusicHandoff({
    enabled,
    isPaused,
    isMuted: isMuted || musicMuted,
    volume: volume * volume,
    musicPausedRef,
    musicHoldRef,
    musicOffRef,
  });

  const seedFor = useCallback(
    (style: string) => `${workoutId || 'goarrive'}:${style}`,
    [workoutId]
  );

  const isExcluded = useCallback((style: string, index: number): boolean => {
    const id = toTrackId(style, index);
    return dislikedSetRef.current.has(id) || sharedDislikedSetRef.current.has(id);
  }, []);

  // ── Callable wrappers ─────────────────────────────────────────────────────

  const fetchTrack = useCallback((style: string, index: number): Promise<TrackResponse | null> => {
    const key = toTrackId(style, index);
    const existing = fetchesRef.current.get(key);
    if (existing) return existing;
    const call = httpsCallable<{ style: string; trackIndex: number }, TrackResponse>(
      functions,
      'getWorkoutMusic'
    );
    const p = call({ style, trackIndex: index })
      .then((res) => {
        const data = res.data;
        if (!data?.url) return null;
        // The server may substitute a cached track (quota fallback) — key the
        // URL by the track actually served so likes/dislikes hit the right id.
        urlCacheRef.current.set(toTrackId(data.style, data.trackIndex), data.url);
        if (!data.cached) generationCountRef.current += 1;
        const ready = readyIndicesRef.current.get(style) ?? new Set<number>();
        ready.add(data.trackIndex);
        readyIndicesRef.current.set(style, ready);
        return data;
      })
      .catch((err: any) => {
        console.warn('[MUSIC] track fetch failed:', err?.message ?? err);
        fetchesRef.current.delete(key);
        return null;
      });
    fetchesRef.current.set(key, p);
    return p;
  }, []);

  const fetchReadyList = useCallback(async (style: string): Promise<void> => {
    try {
      const call = httpsCallable<{ style: string; list: boolean }, ListResponse>(
        functions,
        'getWorkoutMusic'
      );
      const res = await call({ style, list: true });
      readyIndicesRef.current.set(style, new Set(res.data?.readyIndices ?? []));
    } catch (err: any) {
      console.warn('[MUSIC] list fetch failed:', err?.message ?? err);
    }
  }, []);

  // ── Queue mechanics ───────────────────────────────────────────────────────

  const getQueue = useCallback((style: string) => {
    let q = queuesRef.current.get(style);
    if (!q) {
      q = { order: buildMusicQueue({ poolSize: MUSIC_MAX_TRACKS_PER_STYLE, seed: seedFor(style) }), pos: 0 };
      queuesRef.current.set(style, q);
    }
    return q;
  }, [seedFor]);

  /**
   * Next playable index in seeded order (dislikes skipped at consumption time
   * so late-loading prefs still apply). When the order is exhausted the queue
   * restarts — repeats only happen once the pool can't offer fresh tracks.
   * Once the generation budget is spent, uncached indices are skipped as long
   * as a cached one remains ahead.
   */
  const takeNextIndex = useCallback((style: string): number | null => {
    const q = getQueue(style);
    const budgetSpent = generationCountRef.current >= MAX_NEW_GENERATIONS_PER_SESSION;
    const ready = readyIndicesRef.current.get(style) ?? new Set<number>();
    const isPlayable = (i: number) => !isExcluded(style, i);
    const isPreferred = (i: number) =>
      isPlayable(i) && (!budgetSpent || ready.has(i) || urlCacheRef.current.has(toTrackId(style, i)));

    for (let pass = 0; pass < 2; pass++) {
      const accept = pass === 0 ? isPreferred : isPlayable;
      for (let p = q.pos; p < q.order.length; p++) {
        if (accept(q.order[p])) {
          const idx = q.order[p];
          q.pos = p + 1;
          return idx;
        }
      }
    }

    // Order exhausted — restart it (repeat mode), avoiding an immediate
    // repeat of the current track when the pool allows.
    const playable = q.order.filter(isPlayable);
    if (playable.length === 0) return null; // everything disliked → stay silent
    q.pos = 0;
    let idx = q.order[q.pos];
    while (q.pos < q.order.length && !isPlayable(q.order[q.pos])) q.pos += 1;
    idx = q.order[q.pos] ?? playable[0];
    if (playable.length > 1 && currentTrackRef.current?.style === style && currentTrackRef.current.index === idx) {
      q.pos += 1;
      while (q.pos < q.order.length && !isPlayable(q.order[q.pos])) q.pos += 1;
      idx = q.order[q.pos] ?? playable.find((i) => i !== currentTrackRef.current?.index) ?? idx;
    }
    q.pos += 1;
    return idx;
  }, [getQueue, isExcluded]);

  /** Peek what takeNextIndex would return, without consuming it. */
  const peekNextIndex = useCallback((style: string): number | null => {
    const q = getQueue(style);
    const saved = q.pos;
    const idx = takeNextIndex(style);
    q.pos = saved;
    return idx;
  }, [getQueue, takeNextIndex]);

  const safePlay = useCallback((el: HTMLAudioElement) => {
    el.play().catch((err: any) => {
      // iOS can revoke autoplay after a call/backgrounding; one retry inside
      // the next microtask often succeeds when triggered from a gesture.
      if (err?.name === 'NotAllowedError') {
        el.play().catch(() => {});
      }
    });
  }, []);

  /** e49f0a0-safe src swap on the blessed element. */
  const attachTrack = useCallback((url: string, style: string, index: number) => {
    const el = musicElRef.current;
    if (!el) return;
    try {
      el.pause();
      el.src = url;
      el.load();
    } catch {}
    // Mirror onto the handoff shadow so the swap is invisible on the
    // background-audible side. No-op for variant=off / non-web.
    swapTrack(url);
    currentTrackRef.current = { style, index };
    setCurrentTrack({ style, index });
    setTrackStatus('playing');
    if (!musicPausedRef.current && !musicHoldRef.current && !musicOffRef.current) {
      safePlay(el);
    }
  }, [safePlay, swapTrack]);

  const prefetchUpcoming = useCallback((style: string) => {
    const next = peekNextIndex(style);
    if (next == null) return;
    if (generationCountRef.current >= MAX_NEW_GENERATIONS_PER_SESSION) {
      const ready = readyIndicesRef.current.get(style) ?? new Set<number>();
      if (!ready.has(next) && !urlCacheRef.current.has(toTrackId(style, next))) return;
    }
    void fetchTrack(style, next);
  }, [peekNextIndex, fetchTrack]);

  const playIndex = useCallback((style: string, index: number) => {
    const seq = seqRef.current;
    const cachedUrl = urlCacheRef.current.get(toTrackId(style, index));
    if (cachedUrl) {
      attachTrack(cachedUrl, style, index);
      prefetchUpcoming(style);
      return;
    }
    setTrackStatus((s) => (s === 'playing' ? 'stalled' : 'loading'));
    void fetchTrack(style, index).then((res) => {
      if (seq !== seqRef.current || !musicElRef.current) return;
      if (!res) {
        // Generation dead (quota + empty pool, or offline) — try any cached
        // track for this style before going quiet.
        const anyCached = Array.from(urlCacheRef.current.keys())
          .map(parseTrackId)
          .find((t) => t && t.style === style);
        if (anyCached) {
          attachTrack(urlCacheRef.current.get(toTrackId(anyCached.style, anyCached.index))!, anyCached.style, anyCached.index);
        } else {
          setTrackStatus('idle');
        }
        return;
      }
      attachTrack(res.url, res.style, res.trackIndex);
      prefetchUpcoming(style);
    });
  }, [attachTrack, fetchTrack, prefetchUpcoming]);

  const advance = useCallback(() => {
    if (!musicElRef.current || musicOffRef.current) return;
    const style = currentStyleRef.current;
    if (currentTrackRef.current) historyRef.current.push(currentTrackRef.current);
    const next = takeNextIndex(style);
    if (next == null) {
      setTrackStatus('idle');
      return;
    }
    playIndex(style, next);
  }, [takeNextIndex, playIndex]);

  const advanceRef = useRef(advance);
  useEffect(() => { advanceRef.current = advance; }, [advance]);

  // ── Bootstrap: warm cache picture + first track during the ready screen ───

  useEffect(() => {
    if (!enabled || phase !== 'ready' || bootstrappedRef.current || musicOffRef.current) return;
    bootstrappedRef.current = true;
    const style = currentStyleRef.current;
    void (async () => {
      await fetchReadyList(style);
      const first = peekNextIndex(style);
      if (first != null) void fetchTrack(style, first);
    })();
  }, [enabled, phase, fetchReadyList, peekNextIndex, fetchTrack]);

  // ── Prefs load (personal + shared per-workout) ────────────────────────────

  useEffect(() => {
    if (!visible || !enabled || !uid) return;
    let cancelled = false;
    void (async () => {
      try {
        const snap = await getDoc(doc(db, 'musicPrefs', uid));
        if (!cancelled && snap.exists()) {
          const data = snap.data() as { likedTracks?: string[]; dislikedTracks?: string[] };
          const liked = new Set(Array.isArray(data.likedTracks) ? data.likedTracks : []);
          const disliked = new Set(Array.isArray(data.dislikedTracks) ? data.dislikedTracks : []);
          likedSetRef.current = liked;
          dislikedSetRef.current = disliked;
          setLikedSet(liked);
          setDislikedSet(disliked);
        }
      } catch (err: any) {
        console.warn('[MUSIC] prefs load failed:', err?.message ?? err);
      }
      if (!coachId || !workoutId) return;
      try {
        const snap = await getDoc(doc(db, 'workoutMusicFeedback', coachId, 'workouts', workoutId));
        if (!cancelled && snap.exists()) {
          const data = snap.data() as { dislikedTracks?: string[] };
          const shared = new Set(Array.isArray(data.dislikedTracks) ? data.dislikedTracks : []);
          sharedDislikedSetRef.current = shared;
          setSharedDislikedSet(shared);
        }
      } catch (err: any) {
        console.warn('[MUSIC] shared feedback load failed:', err?.message ?? err);
      }
    })();
    return () => { cancelled = true; };
  }, [visible, enabled, uid, coachId, workoutId]);

  // ── Element lifecycle ─────────────────────────────────────────────────────

  const stopMusic = useCallback(() => {
    seqRef.current += 1;
    const el = musicElRef.current;
    musicElRef.current = null;
    setTrackStatus('idle');
    // Release the shadow before the audible — no-op for variant=off.
    teardownShadow();
    if (!el) return;
    // Pause BEFORE releasing — abandoning a still-loading element without
    // pausing lets it start playing on its own once data arrives (e49f0a0).
    try {
      el.pause();
      el.currentTime = 0;
      el.removeAttribute('src');
      el.load();
    } catch {}
  }, [teardownShadow]);

  // Must run synchronously inside the Play tap gesture.
  const startMusic = useCallback(() => {
    if (!enabled || musicElRef.current || musicOffRef.current) return;
    const el: HTMLAudioElement = new (window as any).Audio();
    // crossOrigin MUST be set before src (in attachTrack below) so the
    // Mubert / Firebase Storage fetch honors CORS — otherwise wireToGain
    // taints the graph and produces silence.
    try { (el as any).crossOrigin = 'anonymous'; } catch {}
    el.loop = false; // playlist advances on 'ended' instead of looping
    el.volume = volumeRef.current * volumeRef.current; // perceptual curve — see setVolume
    setMusicVolume(volumeRef.current * volumeRef.current);
    // Wire this element to the MUSIC bus of the shared Web Audio graph so
    // the slider actually controls it on iOS without touching coach voice.
    // Graph is created inside the same Start-tap gesture (unlockAudioPlayback
    // → ensureAudioGraph); wireToGain is safe to call before the graph exists
    // (queues for retro-wire).
    wireToGain(el, 'music');
    // Prime the handoff shadow INSIDE the same Play gesture so its later
    // play() / mute-flip is legal on iOS. No-op for variant=off / non-web.
    primeShadow(el);
    el.muted = mutedRef.current;
    el.addEventListener('ended', () => {
      if (musicElRef.current !== el || !el.src) return;
      advanceRef.current();
    });
    el.addEventListener('error', () => {
      // Fires for a dead CDN URL; also during teardown after src is released,
      // which the guards below ignore.
      if (musicElRef.current !== el || !el.src) return;
      console.warn('[MUSIC] element error — advancing');
      advanceRef.current();
    });
    musicElRef.current = el;

    const style = currentStyleRef.current;
    const first = takeNextIndex(style);
    if (first == null) {
      setTrackStatus('idle');
      return;
    }
    const cachedUrl = urlCacheRef.current.get(toTrackId(style, first));
    if (cachedUrl) {
      if (musicHoldRef.current) {
        // Prime inside the gesture so releaseMusicHold's play() is allowed.
        el.play().catch(() => {});
      }
      attachTrack(cachedUrl, style, first);
      prefetchUpcoming(style);
    } else {
      // Prime inside the gesture so the later src-attach play() is allowed.
      el.play().catch(() => {});
      playIndex(style, first);
    }
  }, [enabled, takeNextIndex, attachTrack, playIndex, prefetchUpcoming, primeShadow]);

  const releaseMusicHold = useCallback(() => {
    if (!musicHoldRef.current) return;
    musicHoldRef.current = false;
    const el = musicElRef.current;
    if (el && el.src && !musicPausedRef.current && !musicOffRef.current) el.play().catch(() => {});
  }, []);

  // Pause/resume with the workout; respect mute; stop on finish/close/unmount.
  useEffect(() => {
    musicPausedRef.current = isPaused;
    const el = musicElRef.current;
    if (!el || !el.src) return;
    if (isPaused) el.pause();
    else if (!musicHoldRef.current && !musicOffRef.current) el.play().catch(() => {});
  }, [isPaused]);
  useEffect(() => {
    if (musicElRef.current) musicElRef.current.muted = isMuted || musicMuted;
  }, [isMuted, musicMuted]);
  useEffect(() => {
    if (phase === 'complete') stopMusic();
  }, [phase, stopMusic]);
  useEffect(() => {
    if (!visible) stopMusic();
  }, [visible, stopMusic]);
  useEffect(() => () => stopMusic(), [stopMusic]);

  // Note: foreground-resume handler used to live here (visibilitychange /
  // pageshow / focus → resumeAudioGraph() + el.play()). Ownership moved to
  // useMusicHandoff so all handoff modes (off/v1/v2/v3) go through one seam;
  // the off-branch is a byte-for-byte reimplementation of the old handler.

  // ── User controls ─────────────────────────────────────────────────────────

  const toggleMusicMuted = useCallback(() => setMusicMuted((m) => !m), []);

  const turnOffForSession = useCallback(() => {
    musicOffRef.current = true;
    setMusicOff(true);
    stopMusic();
  }, [stopMusic]);

  // Undo for turnOffForSession. Safe to (re)create the element here because
  // this only ever runs from a tap on the music panel — a user gesture.
  const turnMusicBackOn = useCallback(() => {
    if (!musicOffRef.current) return;
    musicOffRef.current = false;
    setMusicOff(false);
    if (phaseRef.current !== 'ready' && phaseRef.current !== 'complete') startMusic();
  }, [startMusic]);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.min(1, Math.max(0, Math.round(v * 10) / 10));
    volumeRef.current = clamped;
    setVolumeState(clamped);
    // Human loudness perception is logarithmic; a linear HTMLAudio volume feels
    // front-loaded (10% still audibly loud). Square the display value so the
    // slider feels natural — 10% displayed ≈ 1% actual, 50% ≈ 25%, 100% = 100%.
    if (musicElRef.current) musicElRef.current.volume = clamped * clamped;
    // Music-only: coach voice / cue audio live on a separate gain bus and
    // are untouched by this slider. See useWorkoutTTS split-gain comment.
    setMusicVolume(clamped * clamped);
  }, []);

  const skipNext = useCallback(() => {
    if (!musicElRef.current || musicOffRef.current) return;
    advanceRef.current();
  }, []);

  const skipBack = useCallback(() => {
    const el = musicElRef.current;
    if (!el || musicOffRef.current) return;
    // Spotify rule: restart the current track unless we just started it.
    if (el.currentTime > 3 || historyRef.current.length === 0) {
      try { el.currentTime = 0; } catch {}
      if (!musicPausedRef.current && !musicHoldRef.current) safePlay(el);
      return;
    }
    const prev = historyRef.current.pop()!;
    const url = urlCacheRef.current.get(toTrackId(prev.style, prev.index));
    if (!url) {
      try { el.currentTime = 0; } catch {}
      return;
    }
    attachTrack(url, prev.style, prev.index);
  }, [attachTrack, safePlay]);

  const persistPrefs = useCallback((updates: {
    like?: { id: string; on: boolean };
    dislike?: { id: string; on: boolean };
  }) => {
    if (!uid) return;
    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.like) {
      payload.likedTracks = updates.like.on ? arrayUnion(updates.like.id) : arrayRemove(updates.like.id);
      if (updates.like.on) payload.dislikedTracks = arrayRemove(updates.like.id);
    }
    if (updates.dislike) {
      payload.dislikedTracks = updates.dislike.on ? arrayUnion(updates.dislike.id) : arrayRemove(updates.dislike.id);
      if (updates.dislike.on) payload.likedTracks = arrayRemove(updates.dislike.id);
    }
    setDoc(doc(db, 'musicPrefs', uid), payload, { merge: true }).catch((err: any) => {
      console.warn('[MUSIC] prefs save failed:', err?.message ?? err);
    });
    if (updates.dislike && coachId && workoutId) {
      // Shared per-workout dislike: excluded for everyone playing this workout.
      setDoc(
        doc(db, 'workoutMusicFeedback', coachId, 'workouts', workoutId),
        {
          dislikedTracks: updates.dislike.on
            ? arrayUnion(updates.dislike.id)
            : arrayRemove(updates.dislike.id),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ).catch((err: any) => {
        console.warn('[MUSIC] shared feedback save failed:', err?.message ?? err);
      });
    }
  }, [uid, coachId, workoutId]);

  const toggleLike = useCallback(() => {
    const track = currentTrackRef.current;
    if (!track || !uid) return;
    const id = toTrackId(track.style, track.index);
    const on = !likedSetRef.current.has(id);
    const liked = new Set(likedSetRef.current);
    const disliked = new Set(dislikedSetRef.current);
    if (on) { liked.add(id); disliked.delete(id); } else { liked.delete(id); }
    likedSetRef.current = liked;
    dislikedSetRef.current = disliked;
    setLikedSet(liked);
    setDislikedSet(disliked);
    persistPrefs({ like: { id, on } });
  }, [uid, persistPrefs]);

  const toggleDislike = useCallback(() => {
    const track = currentTrackRef.current;
    if (!track || !uid) return;
    const id = toTrackId(track.style, track.index);
    const on = !dislikedSetRef.current.has(id);
    const liked = new Set(likedSetRef.current);
    const disliked = new Set(dislikedSetRef.current);
    const shared = new Set(sharedDislikedSetRef.current);
    if (on) { disliked.add(id); shared.add(id); liked.delete(id); } else { disliked.delete(id); shared.delete(id); }
    likedSetRef.current = liked;
    dislikedSetRef.current = disliked;
    sharedDislikedSetRef.current = shared;
    setLikedSet(liked);
    setDislikedSet(disliked);
    setSharedDislikedSet(shared);
    persistPrefs({ dislike: { id, on } });
    // "Never play again" takes effect immediately.
    if (on && musicElRef.current) advanceRef.current();
  }, [uid, persistPrefs]);

  const changeStyle = useCallback((style: string) => {
    if (style === currentStyleRef.current) return;
    seqRef.current += 1;
    const seq = seqRef.current;
    currentStyleRef.current = style;
    setCurrentStyle(style);
    // Fresh order for the new style; old style keeps playing until the new
    // track's URL is ready, so there is never a gap.
    queuesRef.current.delete(style);
    void (async () => {
      if (!readyIndicesRef.current.has(style)) await fetchReadyList(style);
      if (seq !== seqRef.current) return;
      const first = takeNextIndex(style);
      if (first == null) return;
      const res = urlCacheRef.current.has(toTrackId(style, first))
        ? { url: urlCacheRef.current.get(toTrackId(style, first))!, style, trackIndex: first }
        : await fetchTrack(style, first);
      if (seq !== seqRef.current || !res) return;
      if (musicElRef.current) {
        // advance() may have attached a track for this style while fetchReadyList
        // was in flight; skip to avoid overwriting it with a server-fallback style.
        if (currentTrackRef.current?.style === style) return;
        if (currentTrackRef.current) historyRef.current.push(currentTrackRef.current);
        attachTrack(res.url, style, res.trackIndex ?? first);
        prefetchUpcoming(style);
      }
      // Not started yet (ready screen): the fetched URL waits in urlCacheRef
      // and startMusic picks it up for an instant start.
    })();
  }, [fetchReadyList, takeNextIndex, fetchTrack, attachTrack, prefetchUpcoming]);

  const currentTrackId = currentTrack ? toTrackId(currentTrack.style, currentTrack.index) : null;

  return {
    startMusic,
    stopMusic,
    releaseMusicHold,
    musicHoldRef,
    musicMuted,
    toggleMusicMuted,
    musicOff,
    turnOffForSession,
    turnMusicBackOn,
    currentStyle,
    currentTrackIndex: currentTrack?.index ?? null,
    currentTrackId,
    trackStatus,
    volume,
    setVolume,
    skipNext,
    skipBack,
    liked: currentTrackId != null && likedSet.has(currentTrackId),
    disliked:
      currentTrackId != null &&
      (dislikedSet.has(currentTrackId) || sharedDislikedSet.has(currentTrackId)),
    toggleLike,
    toggleDislike,
    changeStyle,
  };
}
