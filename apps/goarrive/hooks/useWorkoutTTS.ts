/**
 * useWorkoutTTS — Event-driven voice coaching for the Workout Player
 *
 * Single source of truth for all workout-player audio cues. Every cue
 * is deterministic: derived from the player state machine + build data.
 *
 * Audio layers (priority order):
 *   1. Static platform cues — pre-generated OpenAI TTS MP3s already in
 *      Firebase Storage (voice_cache/platform/*.mp3). Available instantly.
 *   2. Dynamic movement cues — generated on-demand via generateVoice
 *      cloud function, cached at voice_cache/cues/{hash}.mp3.
 *      These are a bonus: if not ready, static cues cover the gap.
 *
 * This hook REPLACES the oscillator beeps from audioCues.ts for all
 * phase transitions. When TTS is active, beeps are suppressed via
 * setAudioMuted(true) from audioCues.ts.
 *
 * Scoping: all audio gated on activeRef. On unmount, timers cancelled,
 * audio stopped. No global leakage.
 */
import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { Platform } from 'react-native';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { buildMovementPhrase, normalizeForSpeech } from '../utils/normalizeForSpeech';
import { setAudioMuted } from '../lib/audioCues';
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

// ── Static platform cue URLs (already in Firebase Storage) ──────────
// These MP3s were pre-generated and uploaded. They're always available
// with no cloud function call needed.
const STORAGE_BASE =
  'https://firebasestorage.googleapis.com/v0/b/goarrive.firebasestorage.app/o/voice_cache%2Fplatform%2F';
const platformCue = (name: string) => `${STORAGE_BASE}${name}.mp3?alt=media`;

const PLATFORM_CUES = {
  go: platformCue('go'),
  countdown_3: platformCue('countdown_3'),
  halfway: platformCue('halfway'),
  switch_sides: platformCue('switch_sides'),
  water_break: platformCue('water_break'),
  workout_complete: platformCue('workout_complete_long'),
  next_up: platformCue('next_up'),
  get_ready: platformCue('get_ready'),
  nice_work_rest: platformCue('nice_work_rest'),
  lets_get_started: platformCue('lets_get_started'),
};

// ── Dynamic phrase builders ─────────────────────────────────────────
function buildPrepNextPhrase(name: string, weight?: string | number): string {
  const movement = buildMovementPhrase(name, weight);
  return `3, 2, 1. Next up, ${movement}.`;
}

function buildGrabEquipmentPhrase(coachText?: string): string {
  if (coachText) return `3, 2, 1. ${normalizeForSpeech(coachText)}`;
  return '3, 2, 1. Get ready.';
}

function phraseStoragePath(text: string): string {
  return `voice_cache/cues/${createHash(text)}.mp3`;
}

// ── Module-level audio state ────────────────────────────────────────
let currentAudio: HTMLAudioElement | null = null;
let audioUnlocked = false;

// ── Audio pool for preloaded elements ───────────────────────────────
const audioPool: Record<string, HTMLAudioElement> = {};

function getOrCreateAudio(url: string): HTMLAudioElement {
  if (audioPool[url]) {
    audioPool[url].currentTime = 0;
    return audioPool[url];
  }
  const a = new (window as any).Audio(url);
  a.preload = 'auto';
  audioPool[url] = a;
  return a;
}

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
  // Dynamic clip URLs (from generateVoice cloud function)
  const dynamicClipsRef = useRef<Record<string, string>>({});
  const [preloadStatus, setPreloadStatus] = useState<'idle' | 'loading' | 'ready' | 'partial' | 'failed'>('idle');
  const lastPlayedRef = useRef('');
  const halfwayFiredRef = useRef(false);
  const firstCueHandledRef = useRef(false);
  const activeRef = useRef(true);
  const pendingTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // ── Mute the beep system when TTS is active ───────────────────────
  // This prevents both beeps AND voice from playing simultaneously.
  // When user mutes via the toggle, both systems go silent.
  useEffect(() => {
    // Suppress beeps — voice cues replace them
    setAudioMuted(true);
    return () => {
      // Restore beeps when leaving the player
      setAudioMuted(false);
    };
  }, []);

  // ── Timer helper (tracked for cleanup) ────────────────────────────
  const schedule = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      pendingTimers.current.delete(id);
      if (activeRef.current) fn();
    }, ms);
    pendingTimers.current.add(id);
  }, []);

  // ── Preload static cues into audio pool (instant, no network wait) ─
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    Object.values(PLATFORM_CUES).forEach((url) => {
      try { getOrCreateAudio(url); } catch {}
    });
    console.log('[TTS] Static platform cues preloaded into audio pool');
  }, []);

  // ── Generate dynamic movement cues via cloud function ─────────────
  // These are the "Next up, {movement name}" clips. They load in the
  // background. If they're not ready when needed, we fall back to the
  // static "next_up" cue instead.
  const dynamicPhrases = useMemo(() => {
    const phrases: { text: string; path: string }[] = [];
    const seen = new Set<string>();
    for (const step of flatMovements) {
      if (step.stepType === 'exercise' && step.name && step.name !== 'Get Ready') {
        const text = buildPrepNextPhrase(step.name, step.weight);
        if (!seen.has(text)) {
          seen.add(text);
          phrases.push({ text, path: phraseStoragePath(text) });
        }
      }
      if (step.stepType === 'grabEquipment') {
        const text = buildGrabEquipmentPhrase(step.instructionText);
        if (!seen.has(text)) {
          seen.add(text);
          phrases.push({ text, path: phraseStoragePath(text) });
        }
      }
    }
    return phrases;
  }, [flatMovements]);

  useEffect(() => {
    if (dynamicPhrases.length === 0) return;
    if (phase === 'complete') return;
    if (Object.keys(dynamicClipsRef.current).length > 0) return;

    let cancelled = false;
    setPreloadStatus('loading');
    console.log(`[TTS] Generating ${dynamicPhrases.length} dynamic cues via cloud function...`);

    (async () => {
      try {
        const functions = getFunctions(undefined, 'us-central1');
        const generateVoice = httpsCallable<
          { text: string; voice: string; storagePath: string },
          { url: string; path: string; cached?: boolean }
        >(functions, 'generateVoice');

        const results = await Promise.allSettled(
          dynamicPhrases.map(async ({ text, path }) => {
            const result = await generateVoice({ text, voice: 'onyx', storagePath: path });
            return { text, url: result.data.url };
          }),
        );

        if (cancelled || !activeRef.current) return;

        const urls: Record<string, string> = {};
        let ok = 0;
        let failed = 0;
        for (const r of results) {
          if (r.status === 'fulfilled') {
            urls[r.value.text] = r.value.url;
            ok++;
          } else {
            failed++;
            console.error('[TTS] Dynamic cue generation failed:', r.reason?.message || r.reason);
          }
        }

        dynamicClipsRef.current = urls;
        console.log(`[TTS] Dynamic cues: ${ok} ready, ${failed} failed`);
        setPreloadStatus(ok === dynamicPhrases.length ? 'ready' : ok > 0 ? 'partial' : 'failed');

        // Preload audio elements
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          Object.values(urls).forEach((url) => {
            try { getOrCreateAudio(url); } catch {}
          });
        }
      } catch (err) {
        console.error('[TTS] Dynamic cue preload failed:', err);
        if (!cancelled && activeRef.current) setPreloadStatus('failed');
      }
    })();

    return () => { cancelled = true; };
  }, [dynamicPhrases, phase]);

  // ── Play audio ────────────────────────────────────────────────────
  const playUrl = useCallback((url: string, source: string) => {
    if (isMuted || !activeRef.current) return;
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    try {
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
      }
      const audio = getOrCreateAudio(url);
      currentAudio = audio;
      const p = audio.play();
      if (p) {
        p.then(() => {
          audioUnlocked = true;
          console.log(`[TTS] Playing: ${source}`);
        })
        .catch((e: any) => console.error(`[TTS] Play BLOCKED (${source}): ${e?.name} — audioUnlocked=${audioUnlocked}`));
      }
    } catch (err) {
      console.error('[TTS] playUrl error:', err);
    }
  }, [isMuted]);

  // Play a static platform cue
  const playCue = useCallback((key: keyof typeof PLATFORM_CUES, source: string) => {
    playUrl(PLATFORM_CUES[key], `cue:${key}:${source}`);
  }, [playUrl]);

  // Play a dynamic movement phrase (with static fallback)
  const playDynamicPhrase = useCallback((phraseText: string, fallbackCue: keyof typeof PLATFORM_CUES, source: string) => {
    const dynamicUrl = dynamicClipsRef.current[phraseText];
    if (dynamicUrl) {
      playUrl(dynamicUrl, `dynamic:${source}`);
    } else {
      // Dynamic clip not ready — use static cue
      console.log(`[TTS] Dynamic clip not ready, using static fallback: ${fallbackCue} (${source})`);
      playCue(fallbackCue, `fallback:${source}`);
    }
  }, [playUrl, playCue]);

  // ── Safari unlock: called synchronously from Start Workout onPress ─
  const unlockAndPlayFirst = useCallback(() => {
    if (isMuted) return;
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    firstCueHandledRef.current = true;

    // Play GO cue directly from user gesture — this unlocks audio on Safari
    try {
      const audio = getOrCreateAudio(PLATFORM_CUES.go);
      currentAudio = audio;
      const p = audio.play();
      if (p) {
        p.then(() => {
          audioUnlocked = true;
          console.log('[TTS] Safari unlock: GO played from gesture — audio unlocked');
        }).catch((e: any) => {
          console.error('[TTS] Safari unlock failed:', e?.name);
        });
      }
    } catch (err) {
      console.error('[TTS] Safari unlock error:', err);
    }
  }, [isMuted]);

  // ── Phase-driven cue dispatch ─────────────────────────────────────

  // Work / Rest / Swap phases
  useEffect(() => {
    if (!current || current.stepType !== 'exercise' || !activeRef.current) return;

    if (phase === 'work') {
      const key = `work_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        halfwayFiredRef.current = false;

        if (current.name && current.name !== 'Get Ready') {
          if (currentIndex === 0 && firstCueHandledRef.current) {
            // First GO was already played by unlockAndPlayFirst
            firstCueHandledRef.current = false;
            console.log('[TTS] Skipping first GO (played from gesture)');
          } else {
            playCue('go', `go:${currentIndex}`);
          }
        }
      }
    } else if (phase === 'rest') {
      const key = `rest_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;

        // Announce next movement during rest
        if (next?.stepType === 'exercise' && next.name && next.name !== 'Get Ready') {
          const phrase = buildPrepNextPhrase(next.name, next.weight);
          schedule(() => playDynamicPhrase(phrase, 'next_up', `prep:${currentIndex}`), 500);
        }
      }
    } else if (phase === 'swap') {
      const key = `swap_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        playCue('switch_sides', `swap:${currentIndex}`);
      }
    } else if (phase === 'ready') {
      lastPlayedRef.current = '';
      halfwayFiredRef.current = false;
    }
  }, [phase, currentIndex, current?.name, current?.stepType, next?.name, next?.stepType, next?.weight, playCue, playDynamicPhrase, schedule]);

  // Special blocks
  useEffect(() => {
    if (!current || !activeRef.current) return;

    if (phase === 'waterBreak') {
      const key = `water_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        playCue('water_break', `water:${currentIndex}`);
      }
    } else if (phase === 'demo') {
      const key = `demo_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        playCue('get_ready', `demo:${currentIndex}`);
      }
    } else if (phase === 'grabEquipment') {
      const key = `equip_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        const phrase = buildGrabEquipmentPhrase(current.instructionText);
        playDynamicPhrase(phrase, 'get_ready', `equip:${currentIndex}`);
      }
    } else if (phase === 'complete') {
      const key = 'complete';
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        playCue('workout_complete', 'complete');
      }
    }
  }, [phase, currentIndex, current?.instructionText, playCue, playDynamicPhrase]);

  // Halfway
  useEffect(() => {
    if (phase !== 'work' || !current || current.stepType !== 'exercise') return;
    if (!activeRef.current) return;
    if (currentDuration <= 6) return;
    const hw = Math.floor(currentDuration / 2);
    if (timeLeft === hw && !halfwayFiredRef.current) {
      halfwayFiredRef.current = true;
      playCue('halfway', `halfway:${currentIndex}`);
    }
  }, [phase, timeLeft, currentDuration, current, playCue, currentIndex]);

  // ── Cleanup ───────────────────────────────────────────────────────
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
      // Restore beeps for other screens
      setAudioMuted(false);
    };
  }, []);

  return { preloadStatus, unlockAndPlayFirst };
}
