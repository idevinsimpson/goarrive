/**
 * useWorkoutTTS — Voice coaching hook for the Workout Player
 *
 * Audio pipeline:
 *   1. Pre-generated movement voice clips (OpenAI TTS, stored at voiceUrl)
 *   2. Static platform cues (Firebase Storage MP3s)
 *
 * Web Speech / expo-speech are intentionally NOT part of the normal audible
 * path. When a voiceUrl is missing or fails to load, we log the gap and stay
 * silent rather than speaking the text via device speech — the robotic device
 * voice sounded cheap compared to the OpenAI clips and was overlapping the
 * static cues (e.g. "Next up" MP3 + "Next up, {movement}" device speech).
 *
 * Sequencing model (queue-based, not timer-based):
 *   Every cue and voice clip is pushed onto a single FIFO queue and played
 *   one at a time. Each clip's natural `ended` event (plus a small fixed
 *   QUEUE_GAP_MS gap) triggers the next dequeue. This replaces the old
 *   setTimeout ladder (1100ms → 1800ms) that was guessing at clip lengths —
 *   under the old approach, a long movement-name voice clip would overlap
 *   with the subsequent "next up" or rest countdown because the next cue
 *   fired on a fixed timer instead of waiting for the previous audio to end.
 *
 *   Expected sequence when work → rest:
 *     [combined "3, 2, 1. Rest." phrase clip] → [combined "Next up, {name}." phrase clip]
 *     (each item waits for the previous `ended` event + QUEUE_GAP_MS)
 *     Both combined clips are OpenAI gpt-4o-mini-tts with the shared coach
 *     style brief, so the countdown and next-up cues sound like the same
 *     coach in the same breath — no seam between countdown and "Rest", no
 *     seam between "Rest" and "Next up". When the countdown URL hasn't
 *     resolved yet (first-ever load), falls back to [countdown_3 static] →
 *     [rest static] → [next-up phrase] so the player still speaks.
 *   Expected sequence when rest → work:
 *     [combined "3, 2, 1. Go." phrase clip] → work phase begins
 *     Fallback: [countdown_3 static] → [go static].
 *
 *   Invalidation rules:
 *     • Skip:  stopAllAudio() bumps runIdRef, flushes queue, stops current audio.
 *     • Pause: flushes queue + stops current audio (runIdRef NOT bumped so that
 *              anything already spoken stays tracked via lastSpokenRef).
 *     • Mute:  flushes queue; future enqueues are silently dropped.
 *     • Phase change: no forced flush — queued items from the previous phase
 *       (e.g. "rest" cue enqueued at end of work) are allowed to complete
 *       naturally. The late-voiceUrl watcher gates on `timeLeft > 3.5` so we
 *       never enqueue a long voice clip into the rest→work countdown window.
 *
 * End-of-workout audio rule (single source of truth):
 *   - If the workout has an Outro block, the long completion clip
 *     (`workout_complete_long`) plays once when the outro phase begins, and
 *     the per-exercise countdown does NOT also fire `workout_complete` for
 *     the last exercise (the outro itself is the last step).
 *   - If there is no Outro block, the short `workout_complete` MP3 plays
 *     once when the last exercise's timer hits 0. The arpeggio tone in
 *     audioCues.ts is no longer used for end-of-workout to avoid stacking.
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import type { StepType } from './useWorkoutFlatten';

// ── Static cue URL map ──────────────────────────────────────────────
const BASE_URL =
  'https://firebasestorage.googleapis.com/v0/b/goarrive.firebasestorage.app/o/voice_cache%2Fplatform%2F';
const CUE_URL = (name: string) => `${BASE_URL}${name}.mp3?alt=media`;

const CUES = {
  countdown_3: CUE_URL('countdown_3'),
  countdown_3_rest: CUE_URL('countdown_3_rest'),
  countdown_4: CUE_URL('countdown_4'),
  countdown_5: CUE_URL('countdown_5'),
  countdown_10: CUE_URL('countdown_10'),
  five_seconds: CUE_URL('five_seconds'),
  ten_seconds: CUE_URL('ten_seconds'),
  go: CUE_URL('go'),
  begin: CUE_URL('begin'),
  rest: CUE_URL('rest'),
  rest_now: CUE_URL('rest_now'),
  halfway: CUE_URL('halfway'),
  workout_complete: CUE_URL('workout_complete'),
  workout_complete_long: CUE_URL('workout_complete_long'),
  workout_starting: CUE_URL('workout_starting'),
  start_now: CUE_URL('start_now'),
  next_up: CUE_URL('next_up'),
  get_ready: CUE_URL('get_ready'),
  switch_sides: CUE_URL('switch_sides'),
  other_side: CUE_URL('other_side'),
  water_break: CUE_URL('water_break'),
  warm_up: CUE_URL('warm_up'),
  cool_down: CUE_URL('cool_down'),
  stretch: CUE_URL('stretch'),
  shake_it_out: CUE_URL('shake_it_out'),
  lets_get_started: CUE_URL('lets_get_started'),
  lets_go: CUE_URL('lets_go'),
  breathe: CUE_URL('breathe'),
  take_a_breath: CUE_URL('take_a_breath'),
  you_got_this: CUE_URL('you_got_this'),
  keep_pushing: CUE_URL('keep_pushing'),
  almost_there: CUE_URL('almost_there'),
  last_round: CUE_URL('last_round'),
  last_set: CUE_URL('last_set'),
  final_rep: CUE_URL('final_rep'),
  one_more: CUE_URL('one_more'),
  push_through: CUE_URL('push_through'),
  dig_deep: CUE_URL('dig_deep'),
  dont_stop: CUE_URL('dont_stop'),
  stay_strong: CUE_URL('stay_strong'),
} as const;

type CueKey = keyof typeof CUES;

// ── Audio pool for pre-loaded cues ──────────────────────────────────
const audioPool: Record<string, HTMLAudioElement> = {};

// Audio elements pooled by voice-clip URL. Separate from the cue pool because
// voice URLs are dynamic (movement names, combined countdown phrases). Reusing
// the element across plays skips the ~50-100ms MP3 re-decode overhead you
// would eat if each play() did `new Audio(url)`. Populated on first play
// inside pumpQueue and by useCountdownPhrases's preload call; GC'd with the
// module when the tab closes. Cap is informational — browsers happily hold
// ~100 idle <audio> elements but we only ever populate <30 entries in a
// long workout (2 countdown phrases + up to ~20 unique movement names).
const voiceAudioPool: Record<string, HTMLAudioElement> = {};

function preloadCue(key: CueKey): void {
  if (Platform.OS !== 'web') return;
  if (typeof window === 'undefined') return;
  if (audioPool[key]) return;
  try {
    const audio = new (window as any).Audio(CUES[key]);
    audio.preload = 'auto';
    audioPool[key] = audio;
  } catch {
    // Audio API unavailable
  }
}

// Pre-load the most commonly used cues immediately. `go` is critical: without
// it preloaded, the first rest's "Go" cue has to fetch over network on first
// use and can arrive after the work phase has already started, making the
// first rest-to-work transition silent while later rests (with `go` cached in
// audioPool) play cleanly.
const PRIORITY_CUES: CueKey[] = [
  'countdown_3', 'countdown_3_rest', 'rest', 'go', 'halfway',
  'workout_complete', 'next_up', 'you_got_this', 'keep_pushing',
  'almost_there', 'workout_starting', 'lets_get_started',
];
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  // Defer preloading slightly to not block initial render
  setTimeout(() => PRIORITY_CUES.forEach(preloadCue), 2000);
}

// Natural gap between consecutive clips. Not a guess at clip length — the
// queue already waits for the previous clip's `ended` event before starting
// this gap. Tightened from 220ms after the rest flow consolidated to one
// "Next up, {name}." phrase clip — the long silence between separate
// "Next up" and movement-name clips was the main offender, and 220ms
// between [rest]→[combined phrase] still felt awkward. 90ms reads as a
// natural sentence boundary without bleeding clips into each other.
const QUEUE_GAP_MS = 90;

// ── Types ────────────────────────────────────────────────────────────
type Phase = 'ready' | 'work' | 'rest' | 'swap' | 'complete'
  | 'intro' | 'outro' | 'demo' | 'transition' | 'waterBreak' | 'grabEquipment';

type QueueItem =
  | { kind: 'cue'; key: CueKey; context: string; runId: number }
  | { kind: 'voice'; url: string; context: string; runId: number };

interface UseWorkoutTTSOptions {
  phase: Phase;
  current: {
    name: string;
    stepType?: StepType;
    instructionText?: string;
    demoMovements?: { name: string }[];
    [key: string]: any;
  } | null;
  next: { name: string; [key: string]: any } | null;
  isMuted: boolean;
  isPaused: boolean;
  ttsDisabled?: boolean;
  currentIndex: number;
  total: number;
  timeLeft: number;
  currentDuration: number;
  /**
   * Pre-warmed combined "3, 2, 1. Rest." OpenAI clip URL. When present, the
   * work-end countdown uses this single clip instead of the static
   * countdown_3 + rest.mp3 pair, so the rest cue matches the "Next up"
   * phrase vibe. Falls back to the static pair if null (first-ever load
   * before Cloud Function has returned the URL).
   */
  restCountdownUrl?: string | null;
  /**
   * Pre-warmed combined "3, 2, 1. Go." OpenAI clip URL. Same treatment as
   * restCountdownUrl but for the rest→work transition.
   */
  goCountdownUrl?: string | null;
  /**
   * Pre-warmed combined "3, 2, 1. Swap sides." OpenAI clip URL. Plays in
   * the last seconds of the L-side work phase for bilateral exercises, so
   * the swap transition matches the rest/go countdowns instead of popping
   * a different-voice static switch_sides MP3.
   */
  swapCountdownUrl?: string | null;
  /**
   * Pre-warmed OpenAI "That's halfway." clip URL. Replaces the static
   * halfway.mp3 at the midpoint tick so the check-in matches the rest of
   * the coach voice.
   */
  halfwayUrl?: string | null;
  /**
   * Pre-warmed OpenAI "Grab some water." clip URL. Replaces the static
   * water_break.mp3 on Water Break blocks.
   */
  waterUrl?: string | null;
  /**
   * Pre-warmed OpenAI "Here's what's coming up." clip URL. Plays once at
   * the start of a Demo block so the member hears the same coach intro
   * the visual list of upcoming movements, instead of the block being
   * silent.
   */
  demoUrl?: string | null;
  /**
   * 'L' or 'R' — which side of a bilateral exercise the member is on. Used
   * to pick "3, 2, 1. Swap sides." as the countdown when the current work
   * phase is the L-side of a swapSides movement.
   */
  swapSide?: 'L' | 'R';
}

export function useWorkoutTTS({
  phase,
  current,
  next,
  isMuted,
  isPaused,
  ttsDisabled = false,
  currentIndex,
  total,
  timeLeft,
  currentDuration,
  restCountdownUrl = null,
  goCountdownUrl = null,
  swapCountdownUrl = null,
  halfwayUrl = null,
  waterUrl = null,
  demoUrl = null,
  swapSide = 'L',
}: UseWorkoutTTSOptions) {
  const lastSpokenRef = useRef<string>('');
  const [isTTSAvailable, setIsTTSAvailable] = useState(true);
  const halfwaySpokenRef = useRef<boolean>(false);
  const countdownSpokenRef = useRef<number>(-1);
  const restCountdownSpokenRef = useRef<number>(-1);
  const welcomeSpokenRef = useRef<boolean>(false);
  // Whether the current work→rest countdown used the combined OpenAI clip.
  // When true, the timeLeft≤0 branch suppresses the separate `rest` cue —
  // "Rest" is already spoken inside the combined clip, so enqueueing it again
  // would say "Rest. Rest." across the phase boundary.
  const combinedRestFiredRef = useRef<boolean>(false);
  // Same idea for the rest→work countdown suppressing the separate `go` cue.
  const combinedGoFiredRef = useRef<boolean>(false);
  // And again for the work→swap countdown suppressing the separate
  // switch_sides cue that would otherwise re-announce at swap phase entry.
  const combinedSwapFiredRef = useRef<boolean>(false);

  // Records the rest phase we're waiting on a combined "Next up, {name}."
  // phrase clip for. Pre-warm normally has it ready by rest-entry, but on
  // first-ever encounter the phrase generation may still be in flight — in
  // that case we rest silent and a separate effect enqueues the clip when
  // its URL arrives via state, provided we still have enough rest time left.
  const pendingNextUpPhraseRef = useRef<
    { restKey: string; movementId: string; name: string; context: string } | null
  >(null);

  // Mirror isPaused for synchronous use inside the queue pump callbacks.
  const isPausedRef = useRef(isPaused);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);

  // ── Audio queue state ───────────────────────────────────────────────
  // One-item-at-a-time FIFO. Every cue and voice clip goes through this
  // queue; nothing plays out-of-band. The queue guarantees:
  //   1. Only one audio element is playing at any moment (no overlap).
  //   2. The next item starts only after the previous one's `ended` event
  //      fires (no cutoffs — we never guess at clip length).
  //   3. Skip / Mute flushes the queue atomically via a runId bump so any
  //      already-enqueued items that have become stale are discarded.
  const queueRef = useRef<QueueItem[]>([]);
  const isPlayingRef = useRef<boolean>(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  // Monotonic counter; bumped by stopAllAudio() to invalidate in-flight items.
  const runIdRef = useRef<number>(0);
  // setTimeout handle for the QUEUE_GAP_MS gap between clips — tracked so we
  // can cancel it on flush (otherwise a pending gap-timer would fire pumpQueue
  // just after a flush and start playing whatever arrived next).
  const gapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const logSpeechSuppressed = useCallback(
    (context: string, text: string) => {
      if (isMuted || ttsDisabled || isPausedRef.current) return;
      console.warn(
        '[useWorkoutTTS] Web Speech suppressed (no OpenAI/MP3 cue available):',
        context,
        { text: text.slice(0, 120) },
      );
    },
    [isMuted, ttsDisabled],
  );

  // Plays the next queued item. Called after each `ended` event + gap, and
  // whenever a new item is enqueued while the queue is idle. Idempotent — if
  // already playing, does nothing. Drops stale items (bumped runId) without
  // playing them.
  const pumpQueue = useCallback(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (isPlayingRef.current) return;
    if (isPausedRef.current || isMuted || ttsDisabled) return;

    // Drop stale items from the head of the queue.
    while (queueRef.current.length > 0 && queueRef.current[0].runId !== runIdRef.current) {
      queueRef.current.shift();
    }
    if (queueRef.current.length === 0) return;

    const item = queueRef.current.shift()!;
    const url = item.kind === 'cue' ? CUES[item.key] : item.url;
    if (!url) {
      if (item.kind === 'voice') logSpeechSuppressed(item.context, '');
      pumpQueue();
      return;
    }

    let audio: HTMLAudioElement;
    try {
      if (item.kind === 'cue') {
        const pooled = audioPool[item.key];
        if (pooled) {
          audio = pooled;
          try { audio.currentTime = 0; } catch {}
        } else {
          audio = new (window as any).Audio(CUES[item.key]);
          audioPool[item.key] = audio;
        }
      } else {
        // Pool voice URLs too — countdown phrases replay every phase and
        // movement-name clips can replay on superset / circuit workouts.
        // Reusing the element skips MP3 re-decode (~50-100ms) and lets a
        // pre-warmed clip play effectively instantly.
        const pooled = voiceAudioPool[item.url];
        if (pooled) {
          audio = pooled;
          try { audio.currentTime = 0; } catch {}
        } else {
          audio = new (window as any).Audio(item.url);
          voiceAudioPool[item.url] = audio;
        }
      }
    } catch (err) {
      console.warn('[useWorkoutTTS] audio setup threw', { item, err });
      pumpQueue();
      return;
    }

    isPlayingRef.current = true;
    currentAudioRef.current = audio;
    const myRunId = item.runId;
    let settled = false;
    const onDone = (reason: string, detail?: unknown) => {
      if (settled) return;
      settled = true;
      if (reason !== 'ended') {
        console.warn('[useWorkoutTTS] queue item ended early', { item, reason, detail });
      }
      if (currentAudioRef.current === audio) currentAudioRef.current = null;
      isPlayingRef.current = false;
      // If a flush happened (runId bumped) while we were playing, don't pump —
      // the flush already cleared the queue and we should stay quiet until the
      // next enqueue.
      if (myRunId !== runIdRef.current) return;
      if (gapTimerRef.current) clearTimeout(gapTimerRef.current);
      gapTimerRef.current = setTimeout(() => {
        gapTimerRef.current = null;
        pumpQueue();
      }, QUEUE_GAP_MS);
    };
    audio.addEventListener('ended', () => onDone('ended'), { once: true });
    audio.addEventListener(
      'error',
      () => onDone('error', (audio as any).error),
      { once: true },
    );
    try {
      const p = audio.play();
      if (p && typeof p.then === 'function') {
        p.catch((err: unknown) => onDone('play-rejected', err));
      }
    } catch (err) {
      onDone('play-threw', err);
    }
  }, [isMuted, ttsDisabled, logSpeechSuppressed]);

  // ── Queue API ───────────────────────────────────────────────────────
  const enqueueCue = useCallback(
    (key: CueKey, context: string = '') => {
      if (isMuted || ttsDisabled) return;
      if (Platform.OS !== 'web' || typeof window === 'undefined') return;
      queueRef.current.push({ kind: 'cue', key, context, runId: runIdRef.current });
      pumpQueue();
    },
    [isMuted, ttsDisabled, pumpQueue],
  );

  // Enqueue a dynamic voice URL (OpenAI movement clips). Empty URL logs the
  // gap and does not enqueue (nothing would play anyway).
  const enqueueVoice = useCallback(
    (url: string, context: string) => {
      if (isMuted || ttsDisabled) {
        console.warn('[VOICE-AUDIT] enqueueVoice dropped — muted/ttsDisabled', { context, isMuted, ttsDisabled });
        return;
      }
      if (Platform.OS !== 'web' || typeof window === 'undefined') return;
      if (!url) {
        console.warn('[VOICE-AUDIT] enqueueVoice dropped — empty url', { context });
        logSpeechSuppressed(context, '');
        return;
      }
      console.info('[VOICE-AUDIT] enqueueVoice queued', { context, urlPreview: url.slice(0, 80) });
      queueRef.current.push({ kind: 'voice', url, context, runId: runIdRef.current });
      pumpQueue();
    },
    [isMuted, ttsDisabled, logSpeechSuppressed, pumpQueue],
  );

  // Flush everything: bump runId so in-flight play()s drop their post-ended
  // pump, stop the currently playing audio, clear pending items, cancel the
  // inter-clip gap timer. Called from Skip (resetSpoken=true) so the new skip
  // target's cues fire fresh, and from Pause (resetSpoken=false) where we
  // keep track of what was already announced so cues don't double up on
  // resume.
  const stopAllAudio = useCallback((resetSpoken = true) => {
    runIdRef.current += 1;
    queueRef.current.length = 0;
    if (gapTimerRef.current) {
      clearTimeout(gapTimerRef.current);
      gapTimerRef.current = null;
    }
    try {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        try { currentAudioRef.current.currentTime = 0; } catch {}
      }
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.speechSynthesis?.cancel();
      } else {
        Speech.stop();
      }
    } catch {}
    currentAudioRef.current = null;
    isPlayingRef.current = false;
    if (resetSpoken) {
      countdownSpokenRef.current = -1;
      halfwaySpokenRef.current = false;
    }
  }, []);

  // On web, we always have audio (our own files). On native, check expo-speech.
  useEffect(() => {
    if (Platform.OS === 'web') {
      setIsTTSAvailable(typeof window !== 'undefined');
    } else {
      Speech.getAvailableVoicesAsync()
        .then((voices) => setIsTTSAvailable(voices.length > 0))
        .catch(() => setIsTTSAvailable(false));
    }
  }, []);

  // ── Special block announcements ────────────────────────────────────
  useEffect(() => {
    if (isPaused) return;
    if (!current) return;
    const stepType = current.stepType;

    // Intro block
    if (phase === 'intro' || (phase === 'work' && stepType === 'intro')) {
      const key = `intro_${currentIndex}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        enqueueCue('lets_get_started', key);
      }
      return;
    }

    // Outro block
    if (phase === 'outro' || (phase === 'work' && stepType === 'outro')) {
      const key = `outro_${currentIndex}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        enqueueCue('workout_complete_long', key);
      }
      return;
    }

    // Demo block. Plays the OpenAI-generated "Here's what's coming up." cue
    // (same nova fitness-instructor voice as every other cue). The visual
    // list of upcoming movements is shown on screen; we don't read the
    // names aloud because they'd each need their own generated clip and the
    // intro phrase alone is enough to anchor the block. Falls back to a
    // silent log if the generated URL hasn't arrived yet on first-ever
    // load.
    if (phase === 'demo' || (phase === 'work' && stepType === 'demo')) {
      const key = `demo_${currentIndex}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        if (demoUrl) {
          enqueueVoice(demoUrl, `demo_block_${currentIndex}`);
        } else {
          const movements = current.demoMovements || [];
          const names = movements.map((m: any) => m.name).join(', then ');
          logSpeechSuppressed(
            `demo_block_${currentIndex}`,
            names ? `Here's what's coming up: ${names}` : "Here's what's coming up",
          );
        }
      }
      return;
    }

    // Transition block. Coach-custom prose doesn't have an OpenAI clip per
    // transition yet; stay silent and log so we can see which transitions
    // need voice coverage. The `get_ready` MP3 is played for empty-instruction
    // transitions since that's a safe static cue.
    if (phase === 'transition' || (phase === 'work' && stepType === 'transition')) {
      const key = `transition_${currentIndex}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        const instruction = current.instructionText || current.description || '';
        if (instruction) {
          logSpeechSuppressed(`transition_${currentIndex}`, instruction);
        } else {
          enqueueCue('get_ready', key);
        }
      }
      return;
    }

    // Water Break block. Prefers the generated OpenAI "Grab some water."
    // clip (nova, shared style) and falls back to the static water_break
    // MP3 if the generated URL isn't ready on first-ever load.
    if (phase === 'waterBreak' || (phase === 'work' && stepType === 'waterBreak')) {
      const key = `waterBreak_${currentIndex}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        if (waterUrl) {
          enqueueVoice(waterUrl, key);
        } else {
          enqueueCue('water_break', key);
        }
      }
      return;
    }
  }, [phase, current?.stepType, currentIndex, logSpeechSuppressed, enqueueCue, enqueueVoice, waterUrl, demoUrl, isPaused]);

  // ── Welcome message on first work phase ─────────────────────────────
  useEffect(() => {
    if (isPaused) return;
    if (phase === 'work' && currentIndex === 0 && !welcomeSpokenRef.current) {
      if (current?.stepType === 'exercise') {
        welcomeSpokenRef.current = true;
        enqueueCue('workout_starting', 'welcome');
      }
    }
  }, [phase, currentIndex, current?.stepType, enqueueCue, isPaused]);

  // ── Exercise movement announcements ────────────────────────────────
  // Extracted ahead of the effect so the dep array references a flat
  // identifier (eslint react-hooks rule rejects complex expressions there).
  const nextNextUpVoiceUrl = (next as any)?.nextUpVoiceUrl as string | undefined;
  useEffect(() => {
    if (isPaused) return;
    if (!current || current.stepType !== 'exercise') return;

    if (phase === 'work') {
      const key = `work_${currentIndex}_${current.name}`;
      if (lastSpokenRef.current !== key) {
        const previousKey = lastSpokenRef.current;
        lastSpokenRef.current = key;
        halfwaySpokenRef.current = false;
        countdownSpokenRef.current = -1;
        restCountdownSpokenRef.current = -1;
        // Fresh movement → fresh countdown decision. Previous phase's combined
        // flags shouldn't carry over and accidentally suppress the next cue.
        combinedRestFiredRef.current = false;
        combinedGoFiredRef.current = false;
        combinedSwapFiredRef.current = false;
        // The "Next up, {name}" line normally plays on the rest screen leading
        // into this movement, so work-start stays silent and the spoken "Go"
        // closes the rest countdown. But if we arrived at work WITHOUT a
        // preceding rest announcement (very first movement with no prep, or a
        // movement with restAfter=0 chained straight into the next), nothing
        // would have spoken the name — so enqueue it here as a fallback only
        // in that case. The queue serializes it behind the welcome cue (on
        // index 0) so no clipping.
        const announcedByPriorRest = previousKey === `rest_${currentIndex - 1}`
          || previousKey === `rest_${currentIndex}`;
        if (!announcedByPriorRest) {
          const voiceUrl = current.voiceUrl;
          enqueueVoice(voiceUrl || '', `work_${currentIndex}_${current.name}`);
        }
      }
    } else if (phase === 'rest') {
      const nextName = next?.name;
      const key = `rest_${currentIndex}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        countdownSpokenRef.current = -1;
        restCountdownSpokenRef.current = -1;
        combinedRestFiredRef.current = false;
        combinedGoFiredRef.current = false;
        combinedSwapFiredRef.current = false;
        pendingNextUpPhraseRef.current = null;
        // Synthetic "Get Ready" prep-rest step (movementIndex === -1) plays BEFORE
        // the first movement of a block.
        const isPrepRest = current?.movementIndex === -1;
        if (nextName) {
          // Queue order: [rest (enqueued at end of previous work phase)] →
          // [combined "Next up, {name}." phrase clip]. One OpenAI clip with
          // style instructions replaces the old next_up MP3 + standalone
          // movement-name voiceUrl pair so the cue sounds like one coherent
          // sentence with no audible seam. Pre-warm runs at workout-open;
          // the URL arrives on the FlatMovement as nextUpVoiceUrl.
          const nextMovementId = (next as any)?.movementId || '';
          const logContext = `rest_next_up_${nextName}`;
          const phraseUrl = nextNextUpVoiceUrl || '';
          console.info('[VOICE-AUDIT] rest entry — combined next-up phrase state', {
            currentIndex,
            nextName,
            nextMovementId: nextMovementId || '(MISSING)',
            phraseUrlPresent: !!phraseUrl,
            phraseUrlPreview: phraseUrl ? phraseUrl.slice(0, 80) : '',
          });
          if (phraseUrl) {
            enqueueVoice(phraseUrl, logContext);
          } else {
            // Phrase not ready yet (first encounter, generation still in
            // flight). Stay silent for this rest per product decision —
            // device speech is off-brand and the old two-clip fallback is
            // gone. Late-arrival effect picks it up if it shows up before
            // the rest countdown window.
            pendingNextUpPhraseRef.current = {
              restKey: key,
              movementId: nextMovementId,
              name: nextName,
              context: logContext,
            };
            console.warn(
              '[VOICE-AUDIT] next-up phrase not ready — late-arrival watcher armed',
              { movementId: nextMovementId || '(MISSING)', name: nextName, context: logContext },
            );
          }
        } else if (!isPrepRest) {
          enqueueCue('rest_now', `rest_${currentIndex}_rest_now`);
        }
      }
    } else if (phase === 'swap') {
      const key = `swap_${currentIndex}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        // The combined "3, 2, 1. Swap sides." countdown clip normally fires
        // at the end of the L-side work phase (see work-end countdown
        // effect), so the swap phase itself stays silent. Only fall back to
        // the static switch_sides MP3 when the combined clip didn't fire
        // (first-ever load or swapCountdownUrl not ready in time).
        if (!combinedSwapFiredRef.current) {
          enqueueCue('switch_sides', key);
        }
      }
    } else if (phase === 'ready') {
      lastSpokenRef.current = '';
      welcomeSpokenRef.current = false;
      halfwaySpokenRef.current = false;
      countdownSpokenRef.current = -1;
    }
  }, [phase, current?.name, current?.stepType, current?.voiceUrl, currentIndex, next?.name, nextNextUpVoiceUrl, enqueueCue, enqueueVoice, isPaused]);

  // ── Halfway announcement (exercise only) ───────────────────────────
  // Prefers the OpenAI-generated "That's halfway." clip (nova voice, shared
  // coach style) so the mid-set check-in matches the rest of the player.
  // Falls back to the static halfway.mp3 when the generated URL isn't ready
  // (first-ever load).
  useEffect(() => {
    if (isPaused) return;
    if (phase !== 'work' || !current || current.stepType !== 'exercise') return;
    if (currentDuration <= 6) return;
    const halfway = Math.floor(currentDuration / 2);
    if (timeLeft === halfway && !halfwaySpokenRef.current) {
      halfwaySpokenRef.current = true;
      if (halfwayUrl) {
        enqueueVoice(halfwayUrl, `halfway_${currentIndex}`);
      } else {
        enqueueCue('halfway', `halfway_${currentIndex}`);
      }
    }
  }, [phase, timeLeft, currentDuration, current, enqueueCue, enqueueVoice, halfwayUrl, isPaused, currentIndex]);

  // ── Countdown voice (exercise only) ────────────────────────────────
  // At the final countdown tick, enqueue either:
  //   (a) the combined "3, 2, 1. Rest." OpenAI clip (when we're heading
  //       into a real rest phase and restCountdownUrl is pre-warmed), or
  //   (b) the static countdown_3.mp3 fallback (last movement, special
  //       block next, or phrase clip not ready yet on first-ever load).
  //
  // Firing window: timeLeft ≤ 3.5 && > 0. Integer ticks normally deliver
  // this at timeLeft=3 — same as the old trigger. The fractional 3.5 bound
  // catches the Skip pre-entry path (SKIP_PRE_ENTRY_SECONDS=3.5 in
  // useWorkoutTimer) so the countdown plays on the skip landing instead of
  // being swallowed. Also makes the trigger resilient if the timer ever
  // goes sub-second.
  //
  // At timeLeft ≤ 0, enqueue rest (or workout_complete) only if the
  // combined clip was NOT used — the combined clip already ends on "Rest",
  // so firing the separate `rest` cue would say "Rest. Rest." across the
  // phase boundary.
  useEffect(() => {
    if (isPaused) return;
    if (phase !== 'work' || !current || current.stepType !== 'exercise') return;
    if (currentDuration <= 0) return;

    const isLastMovement = currentIndex >= total - 1;
    const nextIsSpecial = next && (next as any).stepType && (next as any).stepType !== 'exercise';
    // Bilateral L-side: the next phase is the intra-movement swap, not the
    // next FlatMovement. Takes precedence over rest even when restAfter>0
    // because the swap phase fires first in useWorkoutTimer.
    const enterSwapNext = (current as any)?.swapSides === true && swapSide === 'L';
    const enterRestNext = !isLastMovement && !nextIsSpecial && !enterSwapNext;

    if (timeLeft <= 3.5 && timeLeft > 0 && countdownSpokenRef.current !== 3) {
      countdownSpokenRef.current = 3;
      if (enterSwapNext && swapCountdownUrl) {
        combinedSwapFiredRef.current = true;
        combinedRestFiredRef.current = false;
        enqueueVoice(swapCountdownUrl, `work_swap_countdown_${currentIndex}`);
      } else if (enterRestNext && restCountdownUrl) {
        combinedRestFiredRef.current = true;
        combinedSwapFiredRef.current = false;
        enqueueVoice(restCountdownUrl, `work_rest_countdown_${currentIndex}`);
      } else {
        combinedRestFiredRef.current = false;
        combinedSwapFiredRef.current = false;
        enqueueCue('countdown_3', `work_countdown_${currentIndex}`);
      }
    } else if (timeLeft <= 0 && countdownSpokenRef.current !== 0) {
      countdownSpokenRef.current = 0;
      // End-of-workout audio rule: see header comment for the full table.
      if (isLastMovement) {
        enqueueCue('workout_complete', `work_end_${currentIndex}`);
      } else if (enterSwapNext && !combinedSwapFiredRef.current) {
        // Swap landing fallback — the swap phase entry effect already plays
        // switch_sides when combinedSwapFiredRef is false, so we stay
        // silent here to avoid double-announce.
      } else if (enterRestNext && !combinedRestFiredRef.current) {
        enqueueCue('rest', `work_end_${currentIndex}`);
      }
      // If combinedRest/SwapFiredRef is true, the combined clip already spoke
      // the final word — staying silent here prevents a double-stutter across
      // the phase boundary.
    }
  }, [phase, timeLeft, current, currentDuration, currentIndex, total, next, restCountdownUrl, swapCountdownUrl, swapSide, enqueueCue, enqueueVoice, isPaused]);

  // ── Rest countdown voice (rest → next exercise only) ───────────────
  // Same pattern as the work-end countdown. Combined "3, 2, 1. Go." OpenAI
  // clip when next is a plain exercise and goCountdownUrl is pre-warmed;
  // otherwise static countdown_3 fallback. We only play the "Go" suffix
  // when the next phase is actually an exercise — if rest bleeds into a
  // special block (demo, transition, water break, outro), that block's own
  // announcement fires immediately and "Go" would step on it.
  useEffect(() => {
    if (isPaused) return;
    if (phase !== 'rest') return;

    const nextIsExercise = next
      && (!(next as any).stepType || (next as any).stepType === 'exercise');

    if (timeLeft <= 3.5 && timeLeft > 0 && restCountdownSpokenRef.current !== 3) {
      restCountdownSpokenRef.current = 3;
      if (nextIsExercise && goCountdownUrl) {
        combinedGoFiredRef.current = true;
        enqueueVoice(goCountdownUrl, `rest_go_countdown_${currentIndex}`);
      } else {
        combinedGoFiredRef.current = false;
        enqueueCue('countdown_3', `rest_countdown_${currentIndex}`);
      }
    } else if (timeLeft <= 0 && restCountdownSpokenRef.current !== 0) {
      restCountdownSpokenRef.current = 0;
      if (nextIsExercise && !combinedGoFiredRef.current) {
        enqueueCue('go', `rest_end_${currentIndex}`);
      } else if (!nextIsExercise) {
        console.warn(
          '[useWorkoutTTS] rest→? "Go" suppressed (next is not a plain exercise)',
          {
            hasNext: !!next,
            nextStepType: (next as any)?.stepType,
            nextName: (next as any)?.name,
            currentIndex,
            timeLeft,
          },
        );
      }
      // If combinedGoFiredRef is true, the combined clip already spoke "Go".
    }
  }, [phase, timeLeft, currentDuration, next, currentIndex, goCountdownUrl, enqueueCue, enqueueVoice, isPaused]);

  // ── Late-arriving combined "Next up, {name}." phrase clip ────────
  // Pre-warm normally has the phrase URL injected before rest-entry, but
  // first-ever encounter of a phrase has to wait on OpenAI (~1-3s). When
  // useNextUpPhrases pushes the URL into state mid-rest, this watcher
  // enqueues it — provided we still have enough time before the rest
  // countdown that the clip can finish without clipping "3, 2, 1, Go".
  useEffect(() => {
    if (isPaused) return;
    if (phase !== 'rest') return;
    const pending = pendingNextUpPhraseRef.current;
    if (!pending) return;
    // Only the movement we were waiting on — never play a stale name.
    const nextMovementId = (next as any)?.movementId || '';
    if (pending.movementId && nextMovementId && pending.movementId !== nextMovementId) {
      console.warn('[VOICE-AUDIT] late-arrival: movementId mismatch — clearing pending', {
        pendingId: pending.movementId, nextMovementId,
      });
      pendingNextUpPhraseRef.current = null;
      return;
    }
    const phraseUrl = (next as any)?.nextUpVoiceUrl || '';
    if (!phraseUrl) return;
    // Don't enqueue a phrase clip into the rest→work countdown window.
    if (timeLeft <= 3.5) {
      console.warn(
        '[VOICE-AUDIT] late next-up phrase arrived inside rest countdown — skipping',
        { name: pending.name, timeLeft },
      );
      pendingNextUpPhraseRef.current = null;
      return;
    }
    pendingNextUpPhraseRef.current = null;
    console.info(
      '[VOICE-AUDIT] late next-up phrase arrived — enqueuing',
      { name: pending.name, timeLeft, urlPreview: phraseUrl.slice(0, 80) },
    );
    enqueueVoice(phraseUrl, `${pending.context}_late`);
  }, [phase, timeLeft, next, enqueueVoice, isPaused]);

  // ── Pause → silence any audio in flight ─────────────────────────────
  useEffect(() => {
    if (!isPaused) return;
    stopAllAudio(false);
  }, [isPaused, stopAllAudio]);

  // ── Mute → silence any audio in flight ─────────────────────────────
  // The `isMuted || ttsDisabled` guards in enqueue/pump prevent *new* cues
  // from starting, but the currently playing clip and anything already
  // queued need to be stopped / dropped immediately on mute.
  useEffect(() => {
    if (!isMuted) return;
    stopAllAudio(false);
  }, [isMuted, stopAllAudio]);

  // ── Cleanup ─────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      runIdRef.current += 1;
      queueRef.current.length = 0;
      if (gapTimerRef.current) {
        clearTimeout(gapTimerRef.current);
        gapTimerRef.current = null;
      }
      try {
        if (currentAudioRef.current) {
          currentAudioRef.current.pause();
          currentAudioRef.current = null;
        }
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.speechSynthesis?.cancel();
        } else {
          Speech.stop();
        }
      } catch {}
    };
  }, []);

  return { isTTSAvailable, stopAllAudio };
}
