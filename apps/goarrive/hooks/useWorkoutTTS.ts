/**
 * useWorkoutTTS — Deterministic voice coaching for the Workout Player
 *
 * Single source of truth for all workout-player audio. Every spoken cue
 * is deterministic: derived from the player state machine + build data.
 *
 * Audio pipeline (uniform):
 *   ALL phrases → generateVoice cloud function → cached in Firebase Storage
 *   Static phrases ("Go", "Halfway", etc.) are generated once and cached forever.
 *   Dynamic phrases ("Next up, Goblet Squat, 50 pounds") are generated once
 *   per unique text and cached at voice_cache/cues/{hash}.mp3.
 *
 * generateVoice checks Firebase Storage first: if the MP3 already exists at
 * the content-hash path, it returns the URL without calling OpenAI.
 *
 * This hook REPLACES the oscillator beeps from audioCues.ts.
 * Beeps are suppressed via setAudioMuted(true) on mount.
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

// ── Static phrases (deterministic, cached forever after first generation) ──
const STATIC_PHRASES = {
  GO: '3, 2, 1. Go.',
  HALFWAY: "That's halfway.",
  SWAP_SIDES: '3, 2, 1. Swap sides.',
  WATER_BREAK: '3, 2, 1. Grab some water.',
  WORKOUT_COMPLETE: 'Your GoArrive workout is complete. Great job.',
  DEMO: "3, 2, 1. Here's what's coming up.",
  GET_READY: '3, 2, 1. Get ready.',
} as const;

// ── Dynamic phrase builders ─────────────────────────────────────────
function buildPrepNextPhrase(name: string, weight?: string | number): string {
  const movement = buildMovementPhrase(name, weight);
  return `3, 2, 1. Next up, ${movement}.`;
}

function buildGrabEquipmentPhrase(coachText?: string): string {
  if (coachText) return `3, 2, 1. ${normalizeForSpeech(coachText)}`;
  return STATIC_PHRASES.GET_READY;
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

// ── Cloud function reference (lazy) ─────────────────────────────────
type VoiceRequest = { text: string; voice: string; storagePath: string };
type VoiceResponse = { url: string; path: string; cached?: boolean };

let _generateVoice: ReturnType<typeof httpsCallable<VoiceRequest, VoiceResponse>> | null = null;

function getGenerateVoice() {
  if (!_generateVoice) {
    const functions = getFunctions(undefined, 'us-central1');
    _generateVoice = httpsCallable<VoiceRequest, VoiceResponse>(functions, 'generateVoice');
  }
  return _generateVoice;
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
  // All clip URLs keyed by phrase text
  const clipsRef = useRef<Record<string, string>>({});
  const [preloadStatus, setPreloadStatus] = useState<'idle' | 'loading' | 'ready' | 'partial' | 'failed'>('idle');
  const lastPlayedRef = useRef('');
  const halfwayFiredRef = useRef(false);
  const firstCueHandledRef = useRef(false);
  const activeRef = useRef(true);
  const pendingTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const preWarmStartedRef = useRef(false);

  // ── Mute the beep system when TTS is active ───────────────────────
  useEffect(() => {
    console.log('[TTS] Hook mounted — suppressing beeps, isMuted=' + isMuted);
    setAudioMuted(true);
    return () => {
      console.log('[TTS] Hook unmounting — restoring beeps');
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

  // ── Compute ALL phrases for this workout ──────────────────────────
  const allPhrases = useMemo(() => {
    const phrases: { text: string; path: string }[] = [];
    const seen = new Set<string>();

    const add = (text: string) => {
      if (!seen.has(text)) {
        seen.add(text);
        phrases.push({ text, path: phraseStoragePath(text) });
      }
    };

    // Static phrases — always needed
    Object.values(STATIC_PHRASES).forEach(add);

    // Dynamic phrases — from the workout build data
    for (const step of flatMovements) {
      if (step.stepType === 'exercise' && step.name && step.name !== 'Get Ready') {
        add(buildPrepNextPhrase(step.name, step.weight));
      }
      if (step.stepType === 'grabEquipment') {
        add(buildGrabEquipmentPhrase(step.instructionText));
      }
    }

    console.log(`[TTS] Computed ${phrases.length} phrases (${Object.keys(STATIC_PHRASES).length} static + ${phrases.length - Object.keys(STATIC_PHRASES).length} dynamic)`);
    return phrases;
  }, [flatMovements]);

  // ── Pre-warm: generate all clips via generateVoice on mount ───────
  // CRITICAL: This effect depends ONLY on allPhrases, NOT on phase.
  // Previously depended on [allPhrases, phase], which caused the effect
  // to be cancelled when the user pressed Start (phase: ready → work).
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (allPhrases.length === 0) return;
    if (preWarmStartedRef.current) return;
    preWarmStartedRef.current = true;

    setPreloadStatus('loading');
    console.log(`[TTS] PRE-WARM START — ${allPhrases.length} clips via generateVoice`);

    (async () => {
      try {
        const fn = getGenerateVoice();
        let ok = 0;
        let cached = 0;
        let failed = 0;

        await Promise.allSettled(
          allPhrases.map(async ({ text, path }) => {
            try {
              console.log(`[TTS] Generating: "${text.substring(0, 50)}" → ${path}`);
              const result = await fn({ text, voice: 'onyx', storagePath: path });
              if (!activeRef.current) return;

              clipsRef.current[text] = result.data.url;
              ok++;
              if (result.data.cached) cached++;

              try { getOrCreateAudio(result.data.url); } catch {}
              console.log(`[TTS] READY: "${text.substring(0, 40)}" ${result.data.cached ? '(cached)' : '(generated)'} → ${result.data.url.substring(0, 80)}`);
            } catch (err: any) {
              failed++;
              console.error(`[TTS] FAILED: "${text.substring(0, 40)}" — ${err?.code || ''} ${err?.message || err}`);
            }
          }),
        );

        if (!activeRef.current) return;
        console.log(`[TTS] PRE-WARM DONE: ${ok}/${allPhrases.length} ready (${cached} cached, ${failed} failed)`);
        console.log(`[TTS] Loaded clips:`, Object.keys(clipsRef.current).map(k => k.substring(0, 30)));
        setPreloadStatus(ok === allPhrases.length ? 'ready' : ok > 0 ? 'partial' : 'failed');
      } catch (err) {
        console.error('[TTS] PRE-WARM CRASHED:', err);
        if (activeRef.current) setPreloadStatus('failed');
      }
    })();
  }, [allPhrases]);

  // ── Play a clip by phrase text ────────────────────────────────────
  const playPhrase = useCallback((text: string, source: string) => {
    console.log(`[TTS] CUE: ${source} | muted=${isMuted} | active=${activeRef.current} | text="${text.substring(0, 40)}"`);

    if (isMuted) {
      console.log(`[TTS] SKIP (muted): ${source}`);
      return;
    }
    if (!activeRef.current) {
      console.log(`[TTS] SKIP (inactive): ${source}`);
      return;
    }
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      console.log(`[TTS] SKIP (not web): ${source}`);
      return;
    }

    const url = clipsRef.current[text];
    if (!url) {
      console.warn(`[TTS] CLIP NOT LOADED: ${source} — "${text.substring(0, 40)}" | loaded clips: ${Object.keys(clipsRef.current).length}`);
      return;
    }

    console.log(`[TTS] PLAY ATTEMPT: ${source} → ${url.substring(0, 80)}`);

    try {
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
      }
      const audio = getOrCreateAudio(url);
      currentAudio = audio;
      console.log(`[TTS] Audio element: readyState=${audio.readyState}, paused=${audio.paused}, src=${audio.src.substring(0, 60)}`);

      const p = audio.play();
      if (p) {
        p.then(() => {
          audioUnlocked = true;
          console.log(`[TTS] PLAYING OK: ${source}`);
        })
        .catch((e: any) => {
          console.error(`[TTS] PLAY BLOCKED: ${source} — ${e?.name}: ${e?.message}`);
        });
      } else {
        console.log(`[TTS] play() returned no promise: ${source}`);
      }
    } catch (err: any) {
      console.error(`[TTS] PLAY ERROR: ${source} — ${err?.message || err}`);
    }
  }, [isMuted]);

  // ── Safari unlock: called synchronously from Start Workout onPress ─
  const unlockAndPlayFirst = useCallback(() => {
    console.log(`[TTS] unlockAndPlayFirst called | muted=${isMuted} | platform=${Platform.OS} | clips loaded=${Object.keys(clipsRef.current).length} | audioUnlocked=${audioUnlocked}`);

    if (isMuted) {
      console.log('[TTS] unlockAndPlayFirst SKIP — muted');
      return;
    }
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      console.log('[TTS] unlockAndPlayFirst SKIP — not web');
      return;
    }

    firstCueHandledRef.current = true;

    const goUrl = clipsRef.current[STATIC_PHRASES.GO];
    console.log(`[TTS] GO clip URL: ${goUrl ? goUrl.substring(0, 80) : 'NOT LOADED'}`);
    console.log(`[TTS] All loaded clips: ${JSON.stringify(Object.keys(clipsRef.current).map(k => k.substring(0, 25)))}`);

    if (!goUrl) {
      console.warn('[TTS] GO clip not pre-warmed — Safari unlock skipped. Pre-warm may have failed or not completed.');
      return;
    }

    try {
      const audio = getOrCreateAudio(goUrl);
      currentAudio = audio;
      console.log(`[TTS] GO audio element: readyState=${audio.readyState}, src=${audio.src.substring(0, 60)}`);

      const p = audio.play();
      if (p) {
        p.then(() => {
          audioUnlocked = true;
          console.log('[TTS] SAFARI UNLOCK OK — GO played from gesture');
        }).catch((e: any) => {
          console.error(`[TTS] SAFARI UNLOCK FAILED: ${e?.name}: ${e?.message}`);
        });
      }
    } catch (err: any) {
      console.error(`[TTS] SAFARI UNLOCK ERROR: ${err?.message || err}`);
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
            firstCueHandledRef.current = false;
            console.log('[TTS] Skipping first GO (played from gesture)');
          } else {
            playPhrase(STATIC_PHRASES.GO, `go:${currentIndex}`);
          }
        }
      }
    } else if (phase === 'rest') {
      const key = `rest_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;

        if (next?.stepType === 'exercise' && next.name && next.name !== 'Get Ready') {
          const phrase = buildPrepNextPhrase(next.name, next.weight);
          schedule(() => playPhrase(phrase, `prep:${currentIndex}`), 500);
        }
      }
    } else if (phase === 'swap') {
      const key = `swap_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        playPhrase(STATIC_PHRASES.SWAP_SIDES, `swap:${currentIndex}`);
      }
    } else if (phase === 'ready') {
      lastPlayedRef.current = '';
      halfwayFiredRef.current = false;
    }
  }, [phase, currentIndex, current?.name, current?.stepType, next?.name, next?.stepType, next?.weight, playPhrase, schedule]);

  // Special blocks
  useEffect(() => {
    if (!current || !activeRef.current) return;

    if (phase === 'waterBreak') {
      const key = `water_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        playPhrase(STATIC_PHRASES.WATER_BREAK, `water:${currentIndex}`);
      }
    } else if (phase === 'demo') {
      const key = `demo_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        playPhrase(STATIC_PHRASES.DEMO, `demo:${currentIndex}`);
      }
    } else if (phase === 'grabEquipment') {
      const key = `equip_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        const phrase = buildGrabEquipmentPhrase(current.instructionText);
        playPhrase(phrase, `equip:${currentIndex}`);
      }
    } else if (phase === 'complete') {
      const key = 'complete';
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        playPhrase(STATIC_PHRASES.WORKOUT_COMPLETE, 'complete');
      }
    }
  }, [phase, currentIndex, current?.instructionText, playPhrase]);

  // Halfway
  useEffect(() => {
    if (phase !== 'work' || !current || current.stepType !== 'exercise') return;
    if (!activeRef.current) return;
    if (currentDuration <= 6) return;
    const hw = Math.floor(currentDuration / 2);
    if (timeLeft === hw && !halfwayFiredRef.current) {
      halfwayFiredRef.current = true;
      playPhrase(STATIC_PHRASES.HALFWAY, `halfway:${currentIndex}`);
    }
  }, [phase, timeLeft, currentDuration, current, playPhrase, currentIndex]);

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
      setAudioMuted(false);
    };
  }, []);

  return { preloadStatus, unlockAndPlayFirst };
}
