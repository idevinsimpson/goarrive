/**
 * useWorkoutTTS — Text-to-speech hook for the Workout Player
 *
 * Voice coaching cues:
 *   - Ready → "Welcome to your GoArrive workout"
 *   - First WORK movement → "First up, [name]"
 *   - Subsequent WORK movements → "Next up, [name]"
 *   - Halfway through movements → "That's halfway"
 *   - Last 3 seconds of WORK (non-final) → "3... 2... 1... rest"
 *   - Last 3 seconds of final WORK → "3... 2... 1... rest. Your workout is complete, great job!"
 *   - REST phase → "Rest. Next up: [name]"
 *   - SWAP phase → "Switch sides"
 *   - COMPLETE phase → (handled by countdown voice)
 *
 * Uses expo-speech on native, Web Speech API on web.
 * Respects the global audio mute toggle.
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';

type Phase = 'ready' | 'countdown' | 'work' | 'rest' | 'swap' | 'complete';

interface UseWorkoutTTSOptions {
  phase: Phase;
  current: { name: string; [key: string]: any } | null;
  next: { name: string; [key: string]: any } | null;
  isMuted: boolean;
  /** If true, TTS is disabled entirely (user preference) */
  ttsDisabled?: boolean;
  /** Current movement index (0-based) */
  currentIndex: number;
  /** Total number of movements */
  total: number;
  /** Seconds remaining in current phase */
  timeLeft: number;
  /** Current movement duration (to detect halfway) */
  currentDuration: number;
}

export function useWorkoutTTS({
  phase,
  current,
  next,
  isMuted,
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

  // Check TTS availability on mount
  useEffect(() => {
    const check = async () => {
      try {
        if (Platform.OS === 'web') {
          setIsTTSAvailable(
            typeof window !== 'undefined' && !!window.speechSynthesis,
          );
        } else {
          const voices = await Speech.getAvailableVoicesAsync();
          setIsTTSAvailable(voices.length > 0);
        }
      } catch {
        setIsTTSAvailable(false);
      }
    };
    check();
  }, []);

  /** Web Speech API fallback for browsers */
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
      // Web Speech API unavailable — silent fail
    }
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (isMuted || ttsDisabled) return;
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
        // TTS unavailable — silent fail
      }
    },
    [isMuted, ttsDisabled, speakWeb],
  );

  // ── Welcome message on first countdown ──────────────────────────────
  useEffect(() => {
    if (phase === 'countdown' && currentIndex === 0 && !welcomeSpokenRef.current) {
      welcomeSpokenRef.current = true;
      speak('Welcome to your GoArrive workout');
    }
  }, [phase, currentIndex, speak]);

  // ── Movement announcements ──────────────────────────────────────────
  useEffect(() => {
    if (!current) return;

    if (phase === 'work') {
      const key = `work_${currentIndex}_${current.name}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        halfwaySpokenRef.current = false;
        countdownSpokenRef.current = -1;

        if (currentIndex === 0) {
          speak(`First up, ${current.name}`);
        } else {
          speak(`Next up, ${current.name}`);
        }
      }
    } else if (phase === 'rest') {
      const nextName = next?.name;
      const key = `rest_${currentIndex}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        const announcement = nextName
          ? `Rest. Next up: ${nextName}`
          : 'Rest';
        speak(announcement);
      }
    } else if (phase === 'swap') {
      const key = `swap_${currentIndex}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        speak('Switch sides');
      }
    } else if (phase === 'ready') {
      lastSpokenRef.current = '';
      welcomeSpokenRef.current = false;
      halfwaySpokenRef.current = false;
      countdownSpokenRef.current = -1;
    }
  }, [phase, current?.name, currentIndex, next?.name, speak]);

  // ── Halfway announcement ────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'work' || !current) return;
    if (currentDuration <= 6) return; // Too short for halfway
    const halfway = Math.floor(currentDuration / 2);
    if (timeLeft === halfway && !halfwaySpokenRef.current) {
      halfwaySpokenRef.current = true;
      speak("That's halfway");
    }
  }, [phase, timeLeft, currentDuration, current, speak]);

  // ── Countdown voice: "3... 2... 1... rest" ──────────────────────────
  // Replaces the beep tones. Speaks the number at 3, 2, 1 seconds remaining.
  // At 0 (handled by phase transition), the rest/complete announcement fires.
  useEffect(() => {
    if (phase !== 'work' || !current) return;
    // Only speak countdown for timed movements (not rep-based)
    if (currentDuration <= 0) return;

    if (timeLeft === 3 && countdownSpokenRef.current !== 3) {
      countdownSpokenRef.current = 3;
      speak('3');
    } else if (timeLeft === 2 && countdownSpokenRef.current !== 2) {
      countdownSpokenRef.current = 2;
      speak('2');
    } else if (timeLeft === 1 && countdownSpokenRef.current !== 1) {
      countdownSpokenRef.current = 1;
      speak('1');
    } else if (timeLeft === 0 && countdownSpokenRef.current !== 0) {
      countdownSpokenRef.current = 0;
      const isLastMovement = currentIndex >= total - 1;
      if (isLastMovement) {
        speak('Rest. Your workout is complete, great job!');
      } else {
        speak('Rest');
      }
    }
  }, [phase, timeLeft, current, currentDuration, currentIndex, total, speak]);

  // Cleanup: stop speech when unmounting
  useEffect(() => {
    return () => {
      try {
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.speechSynthesis?.cancel();
        } else {
          Speech.stop();
        }
      } catch {}
    };
  }, []);

  return { isTTSAvailable };
}
