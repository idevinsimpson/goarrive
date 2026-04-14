/**
 * useWorkoutTTS — Event-driven voice coaching for the Workout Player
 *
 * Single source of truth for all workout-player speech. Every spoken cue
 * is deterministic: derived from the player state machine + build data.
 *
 * Audio pipeline:
 *   1. OpenAI TTS clips cached in Firebase Storage (voice_cache/cues/{hash}.mp3)
 *   2. No browser speech fallback — if a clip isn't ready, it's silent
 *
 * Phrase map:
 *   PREP_NEXT  → "3, 2, 1. Next up, {movement}{, weight}."
 *   GO         → "3, 2, 1. Go."
 *   HALFWAY    → "That's halfway."
 *   SWAP_SIDES → "3, 2, 1. Swap sides."
 *   WATER_BREAK→ "3, 2, 1. Grab some water."
 *   WORKOUT_COMPLETE → "Your GoArrive workout is complete. Great job."
 *   DEMO       → "3, 2, 1. Here's what's coming up."
 *   GRAB_EQUIPMENT → "3, 2, 1. {coach phrase}"
 *
 * Scoping: all audio gated on activeRef (true while mounted). On unmount,
 * all timers cancelled and audio stopped. No global leakage.
 */
import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { Platform } from 'react-native';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { buildMovementPhrase, normalizeForSpeech } from '../utils/normalizeForSpeech';
import type { StepType } from './useWorkoutFlatten';
import { createHash } from '../utils/hash';

// ── Types ────────────────────────────────────────────────────────────
type Phase = 'ready' | 'work' | 'rest' | 'swap' | 'complete'
  | 'intro' | 'outro' | 'demo' | 'transition' | 'waterBreak' | 'grabEquipment';

interface FlatStep {
  name: string;
  stepType?: StepType;
  weight?: string | number;
  swapSides?: boolean;
  instructionText?: string;
  [key: string]: any;
}

interface UseWorkoutTTSOptions {
  phase: Phase;
  current: FlatStep | null;
  next: FlatStep | null;
  isMuted: boolean;
  currentIndex: number;
  total: number;
  timeLeft: number;
  currentDuration: number;
  flatMovements: FlatStep[];
}

// ── Static phrases ──────────────────────────────────────────────────
const STATIC_PHRASES: Record<string, string> = {
  GO: '3, 2, 1. Go.',
  HALFWAY: "That's halfway.",
  SWAP_SIDES: '3, 2, 1. Swap sides.',
  WATER_BREAK: '3, 2, 1. Grab some water.',
  WORKOUT_COMPLETE: 'Your GoArrive workout is complete. Great job.',
  DEMO: "3, 2, 1. Here's what's coming up.",
};

function buildPrepNextPhrase(name: string, weight?: string | number): string {
  const movement = buildMovementPhrase(name, weight);
  return `3, 2, 1. Next up, ${movement}.`;
}

function buildGrabEquipmentPhrase(coachText?: string): string {
  if (coachText) {
    return `3, 2, 1. ${normalizeForSpeech(coachText)}`;
  }
  return '3, 2, 1. Get ready.';
}

// ── Deterministic hash for cache keys ───────────────────────────────
function phraseHash(text: string): string {
  return createHash(text);
}

function storagePath(text: string): string {
  return `voice_cache/cues/${phraseHash(text)}.mp3`;
}

// ── Module-level audio state ────────────────────────────────────────
let currentAudio: HTMLAudioElement | null = null;
let audioUnlocked = false;

// ── Hook ─────────────────────────────────────────────────────────────
export function useWorkoutTTS({
  phase,
  current,
  next,
  isMuted,
  currentIndex,
  total,
  timeLeft,
  currentDuration,
  flatMovements,
}: UseWorkoutTTSOptions) {
  const clipUrlsRef = useRef<Record<string, string>>({});
  const [preloadStatus, setPreloadStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const lastPlayedRef = useRef('');
  const halfwayFiredRef = useRef(false);
  const firstCueHandledRef = useRef(false);
  const activeRef = useRef(true);
  const pendingTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // ── Timer helper (tracked for cleanup) ────────────────────────────
  const schedule = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      pendingTimers.current.delete(id);
      if (activeRef.current) fn();
    }, ms);
    pendingTimers.current.add(id);
  }, []);

  // ── Build unique phrase list from flatMovements ───────────────────
  const phraseList = useMemo(() => {
    const seen = new Set<string>();
    const phrases: string[] = [];

    function add(text: string) {
      if (!text || seen.has(text)) return;
      seen.add(text);
      phrases.push(text);
    }

    // Static phrases always needed
    Object.values(STATIC_PHRASES).forEach(add);

    // Dynamic phrases from build data
    for (const step of flatMovements) {
      if (step.stepType === 'exercise' && step.name && step.name !== 'Get Ready') {
        add(buildPrepNextPhrase(step.name, step.weight));
      }
      if (step.stepType === 'grabEquipment') {
        add(buildGrabEquipmentPhrase(step.instructionText));
      }
    }

    return phrases;
  }, [flatMovements]);

  // ── Preload: generate all clips via generateVoice cloud function ──
  useEffect(() => {
    if (phraseList.length === 0) return;
    if (phase === 'complete') return;
    if (Object.keys(clipUrlsRef.current).length > 0) return;

    let cancelled = false;
    setPreloadStatus('loading');

    (async () => {
      try {
        const functions = getFunctions(undefined, 'us-central1');
        const generateVoice = httpsCallable<
          { text: string; voice: string; storagePath: string },
          { url: string; path: string; cached?: boolean }
        >(functions, 'generateVoice');

        // Generate all clips concurrently (cloud function handles caching)
        const results = await Promise.allSettled(
          phraseList.map(async (text) => {
            const path = storagePath(text);
            const result = await generateVoice({
              text,
              voice: 'onyx',
              storagePath: path,
            });
            return { text, url: result.data.url };
          }),
        );

        if (cancelled || !activeRef.current) return;

        const urls: Record<string, string> = {};
        let ok = 0;
        for (const r of results) {
          if (r.status === 'fulfilled') {
            urls[r.value.text] = r.value.url;
            ok++;
          }
        }

        clipUrlsRef.current = urls;
        setPreloadStatus(ok > 0 ? 'ready' : 'failed');
        console.log(`[TTS] Preloaded ${ok}/${phraseList.length} clips`);

        // Pre-create audio elements for first few clips (web only)
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          Object.values(urls).slice(0, 8).forEach((url) => {
            try {
              const a = new (window as any).Audio(url);
              a.preload = 'auto';
            } catch {}
          });
        }
      } catch (err) {
        console.error('[TTS] Preload failed:', err);
        if (!cancelled && activeRef.current) setPreloadStatus('failed');
      }
    })();

    return () => { cancelled = true; };
  }, [phraseList, phase]);

  // ── Play a clip by phrase text ────────────────────────────────────
  const playClip = useCallback((phraseText: string, source: string) => {
    if (isMuted || !activeRef.current) return;

    const url = clipUrlsRef.current[phraseText];
    if (!url) {
      console.log(`[TTS] No clip for "${phraseText.slice(0, 40)}" (source: ${source})`);
      return;
    }

    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    try {
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
      }
      const audio = new (window as any).Audio(url);
      currentAudio = audio;
      const p = audio.play();
      if (p) {
        p.then(() => {
          audioUnlocked = true;
          console.log(`[TTS] Playing: ${source}`);
        })
        .catch((e: any) => console.error(`[TTS] Play failed (${source}):`, e?.name));
      }
    } catch (err) {
      console.error('[TTS] playClip error:', err);
    }
  }, [isMuted]);

  // ── Safari unlock: called synchronously from Start Workout onPress ─
  // Safari requires audio.play() in the same call stack as the user gesture.
  // This function plays the first cue (GO) directly from the tap handler,
  // which unlocks HTMLAudioElement for all subsequent programmatic plays.
  const unlockAndPlayFirst = useCallback(() => {
    if (isMuted) return;
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    // Mark that the first cue is handled here (skip it in the useEffect)
    firstCueHandledRef.current = true;

    const goUrl = clipUrlsRef.current[STATIC_PHRASES.GO];
    if (goUrl) {
      try {
        const audio = new (window as any).Audio(goUrl);
        currentAudio = audio;
        const p = audio.play();
        if (p) {
          p.then(() => {
            audioUnlocked = true;
            console.log('[TTS] Safari unlock: GO cue played from gesture');
          }).catch((e: any) => {
            console.error('[TTS] Safari unlock: play failed:', e?.name);
          });
        }
      } catch (err) {
        console.error('[TTS] Safari unlock error:', err);
      }
    } else {
      // Clips not loaded yet — play a silent audio to at least unlock the API
      console.log('[TTS] Clips not ready — playing silent unlock');
      try {
        const audio = new (window as any).Audio(
          'data:audio/mpeg;base64,SUQzBAAAAAABEVRYWFgAAAAtAAADY29tbWVudABCaWdTb3VuZEJhbmsuY29tIC8gTGFTb25vdGhlcXVlLmNvbQBURU5DAAAAHQAAA1N3aXRjaCBQbHVzIMKpIE5DSCBTb2Z0d2FyZQBUSVQyAAAABgAAAzIyMzUAVFNTRQAAAA8AAANMYXZmNTcuODMuMTAwAAAAAAAAAAAAAAD/80DEAAAAA0gAAAAATEFNRTMuMTAwVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsRbAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQ==',
        );
        audio.volume = 0.01;
        const p = audio.play();
        if (p) {
          p.then(() => {
            audioUnlocked = true;
            console.log('[TTS] Safari unlock: silent audio played from gesture');
          }).catch(() => {});
        }
      } catch {}
    }
  }, [isMuted]);

  // ── Phase-driven cue dispatch ─────────────────────────────────────

  // Work phase: announce movement
  useEffect(() => {
    if (!current || current.stepType !== 'exercise' || !activeRef.current) return;

    if (phase === 'work') {
      const key = `work_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        halfwayFiredRef.current = false;

        if (current.name && current.name !== 'Get Ready') {
          if (currentIndex === 0) {
            // First movement: GO was already played by unlockAndPlayFirst
            // from the Start Workout gesture handler (for Safari unlock).
            // Skip it here to avoid double-play.
            if (firstCueHandledRef.current) {
              firstCueHandledRef.current = false; // reset for future use
              console.log('[TTS] Skipping first GO (already played from gesture)');
            } else {
              playClip(STATIC_PHRASES.GO, `go:first`);
            }
          } else {
            // Not first: "3, 2, 1. Next up, ..."  was already played during rest
            // Now play GO
            playClip(STATIC_PHRASES.GO, `go:${currentIndex}`);
          }
        }
      }
    } else if (phase === 'rest') {
      const key = `rest_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;

        // During rest, announce next movement
        if (next?.stepType === 'exercise' && next.name && next.name !== 'Get Ready') {
          const phrase = buildPrepNextPhrase(next.name, next.weight);
          // Delay slightly so it doesn't overlap with the phase-change beep
          schedule(() => playClip(phrase, `prep:${currentIndex}`), 500);
        }
      }
    } else if (phase === 'swap') {
      const key = `swap_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        playClip(STATIC_PHRASES.SWAP_SIDES, `swap:${currentIndex}`);
      }
    } else if (phase === 'ready') {
      lastPlayedRef.current = '';
      halfwayFiredRef.current = false;
    }
  }, [phase, currentIndex, current?.name, current?.stepType, next?.name, next?.stepType, next?.weight, playClip, schedule]);

  // Special blocks
  useEffect(() => {
    if (!current || !activeRef.current) return;

    if (phase === 'waterBreak') {
      const key = `water_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        playClip(STATIC_PHRASES.WATER_BREAK, `water:${currentIndex}`);
      }
    } else if (phase === 'demo') {
      const key = `demo_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        playClip(STATIC_PHRASES.DEMO, `demo:${currentIndex}`);
      }
    } else if (phase === 'grabEquipment') {
      const key = `equip_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        const phrase = buildGrabEquipmentPhrase(current.instructionText);
        playClip(phrase, `equip:${currentIndex}`);
      }
    } else if (phase === 'complete') {
      const key = 'complete';
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        playClip(STATIC_PHRASES.WORKOUT_COMPLETE, 'complete');
      }
    }
  }, [phase, currentIndex, current?.instructionText, playClip]);

  // Halfway
  useEffect(() => {
    if (phase !== 'work' || !current || current.stepType !== 'exercise') return;
    if (!activeRef.current) return;
    if (currentDuration <= 6) return;
    const hw = Math.floor(currentDuration / 2);
    if (timeLeft === hw && !halfwayFiredRef.current) {
      halfwayFiredRef.current = true;
      playClip(STATIC_PHRASES.HALFWAY, `halfway:${currentIndex}`);
    }
  }, [phase, timeLeft, currentDuration, current, playClip, currentIndex]);

  // ── Cleanup: cancel everything on unmount ─────────────────────────
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      for (const id of pendingTimers.current) clearTimeout(id);
      pendingTimers.current.clear();
      if (Platform.OS === 'web' && currentAudio) {
        currentAudio.pause();
        currentAudio = null;
      }
    };
  }, []);

  return { preloadStatus, unlockAndPlayFirst };
}
