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
 * The stopAllAudio helper still cancels any in-flight Web Speech utterance so
 * that if a future code path re-introduces device speech as an explicit opt-in,
 * Skip/Pause/Mute continue to silence it cleanly.
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

// ── Types ────────────────────────────────────────────────────────────
type Phase = 'ready' | 'work' | 'rest' | 'swap' | 'complete'
  | 'intro' | 'outro' | 'demo' | 'transition' | 'waterBreak' | 'grabEquipment';

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
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  // Records which rest phase we've already spoken the movement name for, and
  // the movementId we were expecting. If the next-movement voiceUrl isn't in
  // Firestore yet at scheduled playback time (legacy doc being backfilled in
  // the background), we leave this pending and a separate effect watches for
  // the voiceUrl to arrive on the same rest phase and plays it retroactively.
  // Cleared when we actually play the clip or when phase/key changes.
  const pendingMovementVoiceRef = useRef<
    { restKey: string; movementId: string; name: string; context: string } | null
  >(null);

  // Mirror isPaused for use inside setTimeout-deferred callbacks. Without this
  // a cue scheduled before pause (e.g. the gap between "next up" and the
  // movement voice) would still fire after the user pauses.
  const isPausedRef = useRef(isPaused);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);

  // Mirrors the latest `next` prop so scheduled callbacks (setTimeout-deferred
  // voiceUrl playback) always read the freshest voiceUrl from Firestore, not
  // the stale closure-captured value from when the rest-entry effect ran.
  // When a legacy movement's voiceUrl is backfilled mid-rest via
  // generateMovementVoice → updateDoc → onSnapshot, the new URL shows up on
  // this ref immediately.
  const nextRef = useRef(next);
  useEffect(() => { nextRef.current = next; }, [next]);

  // Tracks every deferred voice/speak timer so Skip can cancel them before
  // they fire. Without this, a Skip during the 900ms gap between "next up"
  // and the movement voice would leave the old movement name queued and it
  // would overlap with the next state's audio.
  const pendingTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const scheduleAudio = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      pendingTimersRef.current.delete(id);
      fn();
    }, ms);
    pendingTimersRef.current.add(id);
  }, []);

  // Cancels every audio channel at once: pending deferred cues, the active
  // MP3/voiceUrl clip, Web Speech utterance, and native expo-speech. Called
  // from Skip (resetSpoken=true) so the new skip target's cues fire fresh,
  // and from Pause (resetSpoken=false) where we want cues to resume where
  // they left off on unpause.
  const stopAllAudio = useCallback((resetSpoken = true) => {
    for (const id of pendingTimersRef.current) clearTimeout(id);
    pendingTimersRef.current.clear();
    try {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current.currentTime = 0;
      }
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.speechSynthesis?.cancel();
      } else {
        Speech.stop();
      }
    } catch {}
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

  // Device/Web Speech is no longer part of the normal audible path. We log
  // any place we'd previously have used it so gaps in the OpenAI/MP3 coverage
  // stay visible in the console (e.g. a legacy movement that never had a
  // voiceUrl generated, or a coach transition block with custom prose) and
  // can be backfilled. The workout stays silent for that cue instead of
  // dropping into the robotic device voice.
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

  // ── Play a dynamic audio URL (movement voice clips from Firebase Storage) ──
  // When the MP3 can't be loaded or played (missing, 404, CORS, autoplay
  // block, decode failure) we stay silent and log the gap. We used to fall
  // back to Web Speech reading `fallbackText`, which caused two problems:
  //   • "Next up" MP3 + "Next up, {movement}" Web Speech played back-to-back
  //     so members heard the "Next up" phrase twice.
  //   • The robotic device voice for movement names sounded cheap next to the
  //     OpenAI clips for every other movement in the workout.
  // Silent-with-log surfaces uncovered movements (legacy docs without a
  // generated voiceUrl) so we can backfill them, without polluting the
  // audible path in the meantime.
  const playVoiceUrl = useCallback(
    (url: string, logContext: string, onEnded?: () => void) => {
      if (isMuted || ttsDisabled || isPausedRef.current) return;
      if (Platform.OS !== 'web' || typeof window === 'undefined') return;
      if (!url) {
        logSpeechSuppressed(logContext, '');
        return;
      }
      const fail = (reason: string, err?: unknown) => {
        console.warn(
          '[useWorkoutTTS] voiceUrl playback failed (staying silent):',
          reason,
          { context: logContext, url, err },
        );
      };
      try {
        if (currentAudioRef.current) {
          currentAudioRef.current.pause();
          currentAudioRef.current.currentTime = 0;
        }
        const audio = new (window as any).Audio(url);
        currentAudioRef.current = audio;
        if (onEnded) audio.addEventListener('ended', onEnded, { once: true });
        audio.addEventListener(
          'error',
          () => fail('audio element error', audio.error),
          { once: true },
        );
        audio.play().catch((err: unknown) => fail('audio.play() rejected', err));
      } catch (err) {
        fail('Audio() constructor threw', err);
      }
    },
    [isMuted, ttsDisabled, logSpeechSuppressed],
  );

  // ── Play a static cue from Firebase Storage ────────────────────
  const playCue = useCallback(
    (key: CueKey) => {
      if (isMuted || ttsDisabled || isPausedRef.current) return;
      if (Platform.OS !== 'web' || typeof window === 'undefined') return;
      try {
        // Stop any currently playing cue
        if (currentAudioRef.current) {
          currentAudioRef.current.pause();
          currentAudioRef.current.currentTime = 0;
        }
        let audio = audioPool[key];
        if (!audio) {
          audio = new (window as any).Audio(CUES[key]);
          audioPool[key] = audio;
        } else {
          audio.currentTime = 0;
        }
        currentAudioRef.current = audio;
        audio.play().catch((err: unknown) => {
          // Autoplay blocked or other play() rejection — surface it so we
          // can tell whether a missing cue (e.g. first rest "Go" silent) is
          // an autoplay / load failure vs. the effect never firing at all.
          console.warn(
            '[useWorkoutTTS] playCue rejected',
            { key, err },
          );
        });
      } catch (err) {
        console.warn('[useWorkoutTTS] playCue threw', { key, err });
      }
    },
    [isMuted, ttsDisabled],
  );

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
        playCue('lets_get_started');
      }
      return;
    }

    // Outro block
    if (phase === 'outro' || (phase === 'work' && stepType === 'outro')) {
      const key = `outro_${currentIndex}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        playCue('workout_complete_long');
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
          playCue('get_ready');
        }
      }
      return;
    }

    // Water Break block
    if (phase === 'waterBreak' || (phase === 'work' && stepType === 'waterBreak')) {
      const key = `waterBreak_${currentIndex}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        playCue('water_break');
      }
      return;
    }
  }, [phase, current?.stepType, currentIndex, logSpeechSuppressed, playCue, isPaused]);

  // ── Welcome message on first work phase ─────────────────────────────
  useEffect(() => {
    if (isPaused) return;
    if (phase === 'work' && currentIndex === 0 && !welcomeSpokenRef.current) {
      if (current?.stepType === 'exercise') {
        welcomeSpokenRef.current = true;
        playCue('workout_starting');
      }
    }
  }, [phase, currentIndex, current?.stepType, playCue, isPaused]);

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
        // would have spoken the name — so announce it here as a fallback only
        // in that case to avoid the overlap the prior "next_up at work start"
        // pattern caused.
        const announcedByPriorRest = previousKey === `rest_${currentIndex - 1}`
          || previousKey === `rest_${currentIndex}`; // synthetic prep-rest pairs with the next movement
        if (!announcedByPriorRest) {
          const voiceUrl = current.voiceUrl;
          // Delay past the welcome cue (currentIndex === 0) so it doesn't
          // get cut off by the name clip.
          const delay = currentIndex === 0 ? 1500 : 600;
          scheduleAudio(
            () => playVoiceUrl(voiceUrl || '', `work_${currentIndex}_${current.name}`),
            delay,
          );
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
        // the first movement of a block, so we skip the "Rest" framing and just
        // announce the upcoming movement immediately.
        const isPrepRest = current?.movementIndex === -1;
        if (nextName) {
          // Sequencing target: "3, 2, 1. Rest." (end of previous work) →
          // "Next up, {name}." (rest screen) without one clip stepping on the
          // other. At work phase end we play `countdown_3` (~2s) then `rest`
          // (~0.8s); the rest cue starts playing right as the rest phase
          // begins, so firing `next_up` immediately here was pausing it mid
          // word. We delay next_up past the rest cue's tail (1100ms) and the
          // movement-name voice past next_up's tail (+700ms). For prep-rest
          // there's no preceding work cue so we can open immediately.
          const nextUpDelay = isPrepRest ? 0 : 1100;
          const voiceDelay = nextUpDelay + 700;
          scheduleAudio(() => playCue('next_up'), nextUpDelay);
          const nextMovementId = (next as any)?.movementId || '';
          const logContext = `rest_next_up_${nextName}`;
          // Single "not yet played" token for this rest phase. Whichever
          // fires first — the scheduled voiceDelay callback or the
          // late-voiceUrl watcher — clears this ref so the other one skips,
          // preventing a double-play when a backfill lands mid-delay.
          pendingMovementVoiceRef.current = {
            restKey: key,
            movementId: nextMovementId,
            name: nextName,
            context: logContext,
          };
          scheduleAudio(() => {
            const pending = pendingMovementVoiceRef.current;
            if (!pending || pending.restKey !== key) return;
            // Read from nextRef so a backfill that landed during the delay
            // window (rest-entry closure had voiceUrl='' but
            // useMovementHydrate's onSnapshot wrote the URL after) still gets
            // played.
            const latestVoiceUrl = nextRef.current?.voiceUrl || '';
            if (latestVoiceUrl) {
              pendingMovementVoiceRef.current = null;
              playVoiceUrl(latestVoiceUrl, logContext);
            } else {
              console.warn(
                '[useWorkoutTTS] movement-name voiceUrl not ready at rest start — leaving pending for late-arrival watcher',
                { movementId: nextMovementId, name: nextName, context: logContext },
              );
            }
          }, voiceDelay);
        } else if (!isPrepRest) {
          playCue('rest_now');
        }
      }
    } else if (phase === 'swap') {
      const key = `swap_${currentIndex}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        playCue('switch_sides');
      }
    } else if (phase === 'ready') {
      lastSpokenRef.current = '';
      welcomeSpokenRef.current = false;
      halfwaySpokenRef.current = false;
      countdownSpokenRef.current = -1;
    }
  }, [phase, current?.name, current?.stepType, current?.voiceUrl, currentIndex, next?.name, next?.voiceUrl, playCue, playVoiceUrl, scheduleAudio, isPaused]);

  // ── Halfway announcement (exercise only) ───────────────────────────
  useEffect(() => {
    if (isPaused) return;
    if (phase !== 'work' || !current || current.stepType !== 'exercise') return;
    if (currentDuration <= 6) return;
    const halfway = Math.floor(currentDuration / 2);
    if (timeLeft === halfway && !halfwaySpokenRef.current) {
      halfwaySpokenRef.current = true;
      playCue('halfway');
    }
  }, [phase, timeLeft, currentDuration, current, playCue, isPaused]);

  // ── Countdown voice (exercise only) ────────────────────────────────
  // At timeLeft === 3, plays the full pre-timed "3, 2, 1" countdown clip.
  // At timeLeft === 0, plays rest or workout_complete.
  useEffect(() => {
    if (isPaused) return;
    if (phase !== 'work' || !current || current.stepType !== 'exercise') return;
    if (currentDuration <= 0) return;

    // Use Math.ceil so a fractional Skip pre-entry (e.g. timeLeft=2.5,
    // displayed as "3") also triggers the "3, 2, 1" voice cue. timeLeft<=0
    // catches both the natural 0 tick and the Skip overshoot at -0.5.
    const displayed = Math.max(0, Math.ceil(timeLeft));
    if (displayed === 3 && timeLeft > 0 && countdownSpokenRef.current !== 3) {
      countdownSpokenRef.current = 3;
      playCue('countdown_3');
    } else if (timeLeft <= 0 && countdownSpokenRef.current !== 0) {
      countdownSpokenRef.current = 0;
      const isLastMovement = currentIndex >= total - 1;
      // End-of-workout audio rule:
      //   • If next step is the outro block → stay silent here. The outro
      //     phase plays `workout_complete_long` once when it begins; we
      //     don't want `workout_complete` MP3 stacked on top.
      //   • If next step is any other special block (demo, transition, etc.)
      //     → stay silent; the special block's own announcement fires next.
      //   • If this is the truly last step (no outro block at all) → play
      //     the short `workout_complete` MP3 once.
      //   • Otherwise → play the rest cue as before.
      const nextIsSpecial = next && (next as any).stepType && (next as any).stepType !== 'exercise';
      if (isLastMovement) {
        playCue('workout_complete');
      } else if (!nextIsSpecial) {
        playCue('rest');
      }
    }
  }, [phase, timeLeft, current, currentDuration, currentIndex, total, next, playCue, isPaused]);

  // ── Rest countdown voice (rest → next exercise only) ───────────────
  // Replaces the tone-based beeps in useWorkoutTimer for the rest phase
  // with the spoken "3, 2, 1" + "Go" pair so transitioning from rest into
  // the next movement feels like a coach counting you in instead of a timer.
  // We only play "Go" when the next phase is actually an exercise — if rest
  // bleeds into a special block (demo, transition, water break, outro), that
  // block's own announcement fires immediately and "Go" would step on it.
  useEffect(() => {
    if (isPaused) return;
    if (phase !== 'rest') return;
    // No currentDuration guard — `currentDuration` is the WORK phase duration,
    // and synthetic prep-rest steps (Get Ready) have current.duration === 0
    // even though the rest itself runs for current.restAfter seconds. We rely
    // on the phase + timeLeft checks here.

    const displayed = Math.max(0, Math.ceil(timeLeft));
    if (displayed === 3 && timeLeft > 0 && restCountdownSpokenRef.current !== 3) {
      restCountdownSpokenRef.current = 3;
      playCue('countdown_3');
    } else if (timeLeft <= 0 && restCountdownSpokenRef.current !== 0) {
      restCountdownSpokenRef.current = 0;
      const nextIsExercise = next
        && (!(next as any).stepType || (next as any).stepType === 'exercise');
      if (nextIsExercise) {
        playCue('go');
      } else {
        // Diagnostic: this branch is why the first-rest "Go" bug needs
        // explicit logging. Prep-rest → first-exercise transition is
        // supposed to land here with nextIsExercise=true. If we see this
        // warn on the first rest, either `next` is null (end of list) or
        // next.stepType is unexpectedly set to something other than
        // 'exercise' for the first movement after a prep-rest.
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
  }, [phase, timeLeft, currentDuration, next, currentIndex, playCue, isPaused]);

  // ── Late-arriving movement-name voice clip ────────────────────────
  // When a legacy movement's voiceUrl is generated mid-rest (OpenAI TTS
  // round trip takes 2-5s), useMovementHydrate writes it to Firestore and
  // onSnapshot pushes the new URL through props. The scheduled playback
  // from the rest-entry effect has already fired by then and logged a gap.
  // This effect watches for the URL to arrive and plays it, provided we're
  // still on the same rest phase (pendingMovementVoiceRef is our anchor).
  useEffect(() => {
    if (isPaused) return;
    if (phase !== 'rest') return;
    const pending = pendingMovementVoiceRef.current;
    if (!pending) return;
    // Only the movement we were waiting on — never play a stale name.
    const nextMovementId = (next as any)?.movementId || '';
    if (pending.movementId && nextMovementId && pending.movementId !== nextMovementId) {
      pendingMovementVoiceRef.current = null;
      return;
    }
    const nextVoiceUrl = next?.voiceUrl || '';
    if (!nextVoiceUrl) return;
    // Don't interrupt the "3, 2, 1" rest countdown or "Go" if we're already
    // in the final 3s — better to skip the late clip than clip the countdown.
    if (timeLeft <= 3.5) {
      console.warn(
        '[useWorkoutTTS] late voiceUrl arrived inside rest countdown — skipping to keep 3,2,1,Go clean',
        { name: pending.name, timeLeft },
      );
      pendingMovementVoiceRef.current = null;
      return;
    }
    pendingMovementVoiceRef.current = null;
    console.info(
      '[useWorkoutTTS] late voiceUrl arrived — playing now',
      { name: pending.name, timeLeft },
    );
    playVoiceUrl(nextVoiceUrl, `${pending.context}_late`);
  }, [phase, timeLeft, next, playVoiceUrl, isPaused]);

  // ── Pause → silence any audio in flight ─────────────────────────────
  // Any MP3 cue, Web Speech utterance, or deferred voice cue started just
  // before the user paused would otherwise keep playing. stopAllAudio
  // cancels all three at once.
  useEffect(() => {
    if (!isPaused) return;
    stopAllAudio(false);
  }, [isPaused, stopAllAudio]);

  // ── Cleanup ─────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      for (const id of pendingTimersRef.current) clearTimeout(id);
      pendingTimersRef.current.clear();
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
