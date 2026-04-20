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
 *     [countdown_3] → [rest] → [next_up] → [movement voice]
 *     (each item waits for the previous `ended` event + QUEUE_GAP_MS)
 *   Expected sequence when rest → work:
 *     [countdown_3 (rest)] → [go] → work phase begins
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
// this gap. Just enough breathing room so cues don't feel smushed together.
const QUEUE_GAP_MS = 220;

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
}: UseWorkoutTTSOptions) {
  const lastSpokenRef = useRef<string>('');
  const [isTTSAvailable, setIsTTSAvailable] = useState(true);
  const halfwaySpokenRef = useRef<boolean>(false);
  const countdownSpokenRef = useRef<number>(-1);
  const restCountdownSpokenRef = useRef<number>(-1);
  const welcomeSpokenRef = useRef<boolean>(false);

  // Records which rest phase we've already spoken the movement name for, and
  // the movementId we were expecting. If the next-movement voiceUrl isn't in
  // Firestore yet at rest start (legacy doc being backfilled in the
  // background), we leave this pending and a separate effect enqueues the
  // clip retroactively when the URL shows up via onSnapshot.
  const pendingMovementVoiceRef = useRef<
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
        audio = new (window as any).Audio(item.url);
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

    // Demo block. Until there's an OpenAI/MP3 cue for "Here's what's coming
    // up" + the demo movement names, we stay silent (visual list is shown on
    // screen). Device speech would read the list aloud in the robotic voice,
    // which clashes with the OpenAI-voiced rest of the player.
    if (phase === 'demo' || (phase === 'work' && stepType === 'demo')) {
      const key = `demo_${currentIndex}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        const movements = current.demoMovements || [];
        const names = movements.map((m: any) => m.name).join(', then ');
        logSpeechSuppressed(
          `demo_block_${currentIndex}`,
          names ? `Here's what's coming up: ${names}` : "Here's what's coming up",
        );
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

    // Water Break block
    if (phase === 'waterBreak' || (phase === 'work' && stepType === 'waterBreak')) {
      const key = `waterBreak_${currentIndex}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        enqueueCue('water_break', key);
      }
      return;
    }
  }, [phase, current?.stepType, currentIndex, logSpeechSuppressed, enqueueCue, isPaused]);

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
        pendingMovementVoiceRef.current = null;
        // Synthetic "Get Ready" prep-rest step (movementIndex === -1) plays BEFORE
        // the first movement of a block.
        const isPrepRest = current?.movementIndex === -1;
        if (nextName) {
          // Queue order: [rest (enqueued at end of previous work phase)] →
          // next_up → movement voice. Each waits for the previous `ended`
          // event + QUEUE_GAP_MS — no fixed-delay guessing, no overlap.
          enqueueCue('next_up', `rest_${currentIndex}_next_up`);
          const nextMovementId = (next as any)?.movementId || '';
          const logContext = `rest_next_up_${nextName}`;
          const voiceUrl = next?.voiceUrl || '';
          console.info('[VOICE-AUDIT] rest entry — next-up voice state', {
            currentIndex,
            nextName,
            nextMovementId: nextMovementId || '(MISSING)',
            voiceUrlPresent: !!voiceUrl,
            voiceUrlPreview: voiceUrl ? voiceUrl.slice(0, 80) : '',
          });
          if (voiceUrl) {
            enqueueVoice(voiceUrl, logContext);
          } else {
            // Leave pending so the late-voiceUrl watcher enqueues the clip
            // when useMovementHydrate's onSnapshot backfill lands. No
            // pre-queued silent placeholder — the queue would drain through
            // next_up with nothing to announce afterwards and move on.
            pendingMovementVoiceRef.current = {
              restKey: key,
              movementId: nextMovementId,
              name: nextName,
              context: logContext,
            };
            console.warn(
              '[VOICE-AUDIT] pending late-arrival watcher armed',
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
        enqueueCue('switch_sides', key);
      }
    } else if (phase === 'ready') {
      lastSpokenRef.current = '';
      welcomeSpokenRef.current = false;
      halfwaySpokenRef.current = false;
      countdownSpokenRef.current = -1;
    }
  }, [phase, current?.name, current?.stepType, current?.voiceUrl, currentIndex, next?.name, next?.voiceUrl, enqueueCue, enqueueVoice, isPaused]);

  // ── Halfway announcement (exercise only) ───────────────────────────
  useEffect(() => {
    if (isPaused) return;
    if (phase !== 'work' || !current || current.stepType !== 'exercise') return;
    if (currentDuration <= 6) return;
    const halfway = Math.floor(currentDuration / 2);
    if (timeLeft === halfway && !halfwaySpokenRef.current) {
      halfwaySpokenRef.current = true;
      enqueueCue('halfway', `halfway_${currentIndex}`);
    }
  }, [phase, timeLeft, currentDuration, current, enqueueCue, isPaused, currentIndex]);

  // ── Countdown voice (exercise only) ────────────────────────────────
  // At timeLeft === 3, enqueues the full pre-timed "3, 2, 1" countdown clip.
  // At timeLeft === 0, enqueues rest (or workout_complete).
  useEffect(() => {
    if (isPaused) return;
    if (phase !== 'work' || !current || current.stepType !== 'exercise') return;
    if (currentDuration <= 0) return;

    const displayed = Math.max(0, Math.ceil(timeLeft));
    if (displayed === 3 && timeLeft > 0 && countdownSpokenRef.current !== 3) {
      countdownSpokenRef.current = 3;
      enqueueCue('countdown_3', `work_countdown_${currentIndex}`);
    } else if (timeLeft <= 0 && countdownSpokenRef.current !== 0) {
      countdownSpokenRef.current = 0;
      const isLastMovement = currentIndex >= total - 1;
      // End-of-workout audio rule: see header comment for the full table.
      const nextIsSpecial = next && (next as any).stepType && (next as any).stepType !== 'exercise';
      if (isLastMovement) {
        enqueueCue('workout_complete', `work_end_${currentIndex}`);
      } else if (!nextIsSpecial) {
        enqueueCue('rest', `work_end_${currentIndex}`);
      }
    }
  }, [phase, timeLeft, current, currentDuration, currentIndex, total, next, enqueueCue, isPaused]);

  // ── Rest countdown voice (rest → next exercise only) ───────────────
  // Spoken "3, 2, 1" + "Go" for the rest-exit transition. We only play "Go"
  // when the next phase is actually an exercise — if rest bleeds into a
  // special block (demo, transition, water break, outro), that block's own
  // announcement fires immediately and "Go" would step on it.
  useEffect(() => {
    if (isPaused) return;
    if (phase !== 'rest') return;

    const displayed = Math.max(0, Math.ceil(timeLeft));
    if (displayed === 3 && timeLeft > 0 && restCountdownSpokenRef.current !== 3) {
      restCountdownSpokenRef.current = 3;
      enqueueCue('countdown_3', `rest_countdown_${currentIndex}`);
    } else if (timeLeft <= 0 && restCountdownSpokenRef.current !== 0) {
      restCountdownSpokenRef.current = 0;
      const nextIsExercise = next
        && (!(next as any).stepType || (next as any).stepType === 'exercise');
      if (nextIsExercise) {
        enqueueCue('go', `rest_end_${currentIndex}`);
      } else {
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
    }
  }, [phase, timeLeft, currentDuration, next, currentIndex, enqueueCue, isPaused]);

  // ── Late-arriving movement-name voice clip ────────────────────────
  // When a legacy movement's voiceUrl is generated mid-rest (OpenAI TTS
  // round trip takes 2-5s), useMovementHydrate writes it to Firestore and
  // onSnapshot pushes the new URL through props. If we already passed the
  // rest-entry effect (voiceUrl was empty then), this watcher enqueues the
  // clip when it finally arrives — but only if we still have enough time
  // left before the rest countdown that the voice can finish without
  // clipping "3, 2, 1, Go".
  useEffect(() => {
    if (isPaused) return;
    if (phase !== 'rest') return;
    const pending = pendingMovementVoiceRef.current;
    if (!pending) return;
    // Only the movement we were waiting on — never play a stale name.
    const nextMovementId = (next as any)?.movementId || '';
    if (pending.movementId && nextMovementId && pending.movementId !== nextMovementId) {
      console.warn('[VOICE-AUDIT] late-arrival: movementId mismatch — clearing pending', {
        pendingId: pending.movementId, nextMovementId,
      });
      pendingMovementVoiceRef.current = null;
      return;
    }
    const nextVoiceUrl = next?.voiceUrl || '';
    if (!nextVoiceUrl) return;
    // Don't enqueue a long voice clip into the rest→work countdown window.
    if (timeLeft <= 3.5) {
      console.warn(
        '[VOICE-AUDIT] late voiceUrl arrived inside rest countdown — skipping',
        { name: pending.name, timeLeft },
      );
      pendingMovementVoiceRef.current = null;
      return;
    }
    pendingMovementVoiceRef.current = null;
    console.info(
      '[VOICE-AUDIT] late voiceUrl arrived — enqueuing',
      { name: pending.name, timeLeft, urlPreview: nextVoiceUrl.slice(0, 80) },
    );
    enqueueVoice(nextVoiceUrl, `${pending.context}_late`);
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
