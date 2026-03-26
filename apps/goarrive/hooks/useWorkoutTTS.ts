/**
 * useWorkoutTTS — Text-to-speech hook for the Workout Player (Suggestion 1)
 *
 * Speaks movement names at the start of each WORK phase and announces
 * "Rest" + next movement name during rest phases. Uses expo-speech.
 * Respects the global audio mute toggle.
 *
 * Usage in WorkoutPlayer:
 *   useWorkoutTTS({ phase, current, next, isMuted });
 *
 * The hook is a no-op on web (expo-speech may not be available).
 */
import { useEffect, useRef, useCallback } from 'react';
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
}

export function useWorkoutTTS({
  phase,
  current,
  next,
  isMuted,
  ttsDisabled = false,
}: UseWorkoutTTSOptions) {
  const lastSpokenRef = useRef<string>('');

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
        // Stop any in-progress speech before starting new
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

  useEffect(() => {
    if (!current) return;

    if (phase === 'work') {
      // Speak movement name when entering WORK phase
      const key = `work_${current.name}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        speak(current.name);
      }
    } else if (phase === 'rest') {
      // Announce rest + next movement name
      const nextName = next?.name;
      const key = `rest_${current.name}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        const announcement = nextName
          ? `Rest. Next up: ${nextName}`
          : 'Rest';
        speak(announcement);
      }
    } else if (phase === 'swap') {
      const key = `swap_${current.name}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        speak('Switch sides');
      }
    } else if (phase === 'complete') {
      if (lastSpokenRef.current !== 'complete') {
        lastSpokenRef.current = 'complete';
        speak('Workout complete. Great job!');
      }
    } else if (phase === 'ready') {
      lastSpokenRef.current = '';
    }
  }, [phase, current?.name, next?.name, speak]);

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
}
