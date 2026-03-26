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

  const speak = useCallback(
    (text: string) => {
      if (isMuted || ttsDisabled) return;
      if (Platform.OS === 'web') return; // expo-speech not reliable on web
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
    [isMuted, ttsDisabled],
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
        Speech.stop();
      } catch {}
    };
  }, []);
}
