/**
 * useWorkoutTTS — Voice coaching hook for the Workout Player
 *
 * Audio pipeline (in priority order):
 *   1. Pre-generated movement voice clips (OpenAI TTS, stored at voiceUrl)
 *   2. Static platform cues (Firebase Storage MP3s)
 *   3. Web Speech API fallback for any movement without a voiceUrl
 *
 * Movement voice clips are generated via OpenAI TTS (voice: onyx) through
 * the generateVoice Cloud Function. Static platform cues were pre-generated
 * and stored in Firebase Storage. Web Speech is the real-time fallback.
 *
 * Uses expo-speech on native, Web Audio API + Web Speech on web.
 * Respects the global audio mute toggle.
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
  looking_good: CUE_URL('looking_good'),
  nice_form: CUE_URL('nice_form'),
  great_work: CUE_URL('great_work'),
  well_done: CUE_URL('well_done'),
  fantastic_effort: CUE_URL('fantastic_effort'),
  proud_of_you: CUE_URL('proud_of_you'),
  nice_work_rest: CUE_URL('nice_work_rest'),
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

// Pre-load the most commonly used cues immediately
const PRIORITY_CUES: CueKey[] = [
  'countdown_3', 'countdown_3_rest', 'rest', 'halfway',
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
  const welcomeSpokenRef = useRef<boolean>(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  // Mirror isPaused for use inside setTimeout-deferred callbacks. Without this
  // a cue scheduled before pause (e.g. the 900ms gap between "next up" and the
  // movement voice) would still fire after the user pauses.
  const isPausedRef = useRef(isPaused);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);

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

    // ── Play a dynamic audio URL (movement voice clips from Firebase Storage) ──
  const playVoiceUrl = useCallback(
    (url: string, onEnded?: () => void) => {
      if (isMuted || ttsDisabled || isPausedRef.current) return;
      if (Platform.OS !== 'web' || typeof window === 'undefined') return;
      if (!url) return;
      try {
        if (currentAudioRef.current) {
          currentAudioRef.current.pause();
          currentAudioRef.current.currentTime = 0;
        }
        const audio = new (window as any).Audio(url);
        currentAudioRef.current = audio;
        if (onEnded) audio.addEventListener('ended', onEnded, { once: true });
        audio.play().catch(() => {});
      } catch {
        // Audio API unavailable
      }
    },
    [isMuted, ttsDisabled],
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
        audio.play().catch(() => {
          // Autoplay blocked — silently fail
        });
      } catch {
        // Audio API unavailable
      }
    },
    [isMuted, ttsDisabled],
  );

  // ── Speak dynamic text (movement names) via Web Speech API ──────
  const speakWeb = useCallback((text: string) => {
    try {
      if (typeof window === 'undefined') return;
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.95;
      utterance.pitch = 1.0;
      synth.speak(utterance);
    } catch {
      // Web Speech API unavailable
    }
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (isMuted || ttsDisabled || isPausedRef.current) return;
      if (Platform.OS === 'web') {
        speakWeb(text);
        return;
      }
      try {
        Speech.stop();
        Speech.speak(text, {
          language: 'en-US',
          rate: 0.95,
          pitch: 1.0,
        });
      } catch {
        // TTS unavailable
      }
    },
    [isMuted, ttsDisabled, speakWeb],
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

    // Demo block
    if (phase === 'demo' || (phase === 'work' && stepType === 'demo')) {
      const key = `demo_${currentIndex}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        const movements = current.demoMovements || [];
        if (movements.length > 0) {
          const names = movements.map((m: any) => m.name).join(', then ');
          speak(`Here's what's coming up: ${names}`);
        } else {
          speak("Here's what's coming up");
        }
      }
      return;
    }

    // Transition block
    if (phase === 'transition' || (phase === 'work' && stepType === 'transition')) {
      const key = `transition_${currentIndex}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        const instruction = current.instructionText || current.description || '';
        if (instruction) {
          speak(instruction);
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
  }, [phase, current?.stepType, currentIndex, speak, playCue, isPaused]);

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
        lastSpokenRef.current = key;
        halfwaySpokenRef.current = false;
        countdownSpokenRef.current = -1;
        // Play "Next up" cue, then play movement name via ElevenLabs voice (or Web Speech fallback)
        playCue('next_up');
        const voiceUrl = current.voiceUrl;
        if (voiceUrl) {
          scheduleAudio(() => playVoiceUrl(voiceUrl), 900);
        } else {
          scheduleAudio(() => speak(current.name), 900);
        }
      }
    } else if (phase === 'rest') {
      const nextName = next?.name;
      const key = `rest_${currentIndex}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        // Synthetic "Get Ready" prep-rest step (movementIndex === -1) plays BEFORE
        // the first movement of a block, not after one. Don't say "Nice work. Rest."
        // there — that cue only makes sense after completing a movement.
        const isPrepRest = current?.movementIndex === -1;
        if (nextName) {
          if (!isPrepRest) playCue('nice_work_rest');
          const nextVoiceUrl = next?.voiceUrl;
          const delay = isPrepRest ? 0 : 1800;
          if (nextVoiceUrl) {
            scheduleAudio(() => playVoiceUrl(nextVoiceUrl), delay);
          } else {
            scheduleAudio(() => speak(`Next up: ${nextName}`), delay);
          }
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
  }, [phase, current?.name, current?.stepType, current?.voiceUrl, currentIndex, next?.name, next?.voiceUrl, speak, playCue, playVoiceUrl, scheduleAudio, isPaused]);

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
      if (isLastMovement) {
        playCue('workout_complete');
      } else {
        playCue('rest');
      }
    }
  }, [phase, timeLeft, current, currentDuration, currentIndex, total, playCue, isPaused]);

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
