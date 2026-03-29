/**
 * useWorkoutTTS — Text-to-speech hook for the Workout Player
 *
 * Phase 3 upgrade: Now handles special block voice cues:
 *   - Intro: "Welcome to your GoArrive workout"
 *   - Outro: "Great job! Your workout is complete"
 *   - Demo: "Here's what's coming up" + movement names
 *   - Transition: reads instruction text aloud
 *   - Water Break: "Grab your water, stay hydrated"
 *
 * Exercise movement cues (unchanged):
 *   - First WORK movement → "First up, [name]"
 *   - Subsequent WORK movements → "Next up, [name]"
 *   - Halfway → "That's halfway"
 *   - Last 3 seconds of WORK → "3... 2... 1... rest"
 *   - REST phase → "Rest. Next up: [name]"
 *   - SWAP phase → "Switch sides"
 *
 * Uses expo-speech on native, Web Speech API on web.
 * Respects the global audio mute toggle.
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import type { StepType } from './useWorkoutFlatten';

type Phase = 'ready' | 'countdown' | 'work' | 'rest' | 'swap' | 'complete'
  | 'intro' | 'outro' | 'demo' | 'transition' | 'waterBreak';

interface UseWorkoutTTSOptions {
  phase: Phase;
  current: { name: string; stepType?: StepType; instructionText?: string; demoMovements?: { name: string }[]; [key: string]: any } | null;
  next: { name: string; [key: string]: any } | null;
  isMuted: boolean;
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
        // TTS unavailable
      }
    },
    [isMuted, ttsDisabled, speakWeb],
  );

  // ── Special block announcements ────────────────────────────────────
  useEffect(() => {
    if (!current) return;
    const stepType = current.stepType;

    // Intro block
    if (phase === 'intro' || (phase === 'work' && stepType === 'intro')) {
      const key = `intro_${currentIndex}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        speak('Welcome to your GoArrive workout. Let\'s get started.');
      }
      return;
    }

    // Outro block
    if (phase === 'outro' || (phase === 'work' && stepType === 'outro')) {
      const key = `outro_${currentIndex}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        speak('Great job! Your workout is complete. You crushed it.');
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
          speak('Transition. Get ready for the next section.');
        }
      }
      return;
    }

    // Water Break block
    if (phase === 'waterBreak' || (phase === 'work' && stepType === 'waterBreak')) {
      const key = `waterBreak_${currentIndex}`;
      if (lastSpokenRef.current !== key) {
        lastSpokenRef.current = key;
        speak('Water break. Grab your water, stay hydrated.');
      }
      return;
    }
  }, [phase, current?.stepType, currentIndex, speak]);

  // ── Welcome message on first countdown ──────────────────────────────
  useEffect(() => {
    if (phase === 'countdown' && currentIndex === 0 && !welcomeSpokenRef.current) {
      // Only speak welcome if the first step is an exercise (intro handles its own)
      if (current?.stepType === 'exercise') {
        welcomeSpokenRef.current = true;
        speak('Welcome to your GoArrive workout');
      }
    }
  }, [phase, currentIndex, current?.stepType, speak]);

  // ── Exercise movement announcements ────────────────────────────────
  useEffect(() => {
    if (!current || current.stepType !== 'exercise') return;

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
  }, [phase, current?.name, current?.stepType, currentIndex, next?.name, speak]);

  // ── Halfway announcement (exercise only) ───────────────────────────
  useEffect(() => {
    if (phase !== 'work' || !current || current.stepType !== 'exercise') return;
    if (currentDuration <= 6) return;
    const halfway = Math.floor(currentDuration / 2);
    if (timeLeft === halfway && !halfwaySpokenRef.current) {
      halfwaySpokenRef.current = true;
      speak("That's halfway");
    }
  }, [phase, timeLeft, currentDuration, current, speak]);

  // ── Countdown voice: "3... 2... 1... rest" (exercise only) ─────────
  useEffect(() => {
    if (phase !== 'work' || !current || current.stepType !== 'exercise') return;
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

  // Cleanup
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
