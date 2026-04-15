/**
 * useWorkoutTTS — Deterministic voice coaching for the Workout Player
 *
 * Single source of truth for workout-player voice cues. Every spoken cue is
 * derived from the workout player state machine plus flattened build data.
 *
 * Audio pipeline:
 *   phrase text → generateVoice cloud function → Firebase Storage cache URL
 *
 * The hook now keeps clip generation and clip playback separate:
 *   - pre-warm eagerly resolves clip URLs
 *   - HTMLAudioElement instances are only created at playback time
 *
 * That separation matters on iPhone Safari because pre-creating Audio elements
 * before the Start Workout tap can leave the first audible path effectively
 * disconnected from the real user gesture.
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
  enabled: boolean;
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

function createSilentUnlockUrl(): string {
  const sampleRate = 8000;
  const durationMs = 80;
  const numSamples = Math.max(1, Math.floor(sampleRate * durationMs / 1000));
  const buffer = new ArrayBuffer(44 + numSamples);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeString(36, 'data');
  view.setUint32(40, numSamples, true);

  const samples = new Uint8Array(buffer, 44);
  samples.fill(128);

  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

// ── Module-level audio state ────────────────────────────────────────
let currentAudio: HTMLAudioElement | null = null;
let audioUnlocked = false;

function stopCurrentAudio() {
  if (!currentAudio) return;
  try {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  } catch {}
  currentAudio = null;
}

function createPlaybackAudio(url: string): HTMLAudioElement {
  const audio = new (window as any).Audio(url);
  audio.preload = 'auto';
  (audio as any).playsInline = true;
  return audio;
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
  enabled,
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
  const clipsRef = useRef<Record<string, string>>({});
  const clipPromiseRef = useRef<Partial<Record<string, Promise<string | null>>>>({});
  const [preloadStatus, setPreloadStatus] = useState<'idle' | 'loading' | 'ready' | 'partial' | 'failed'>('idle');
  const lastPlayedRef = useRef('');
  const halfwayFiredRef = useRef(false);
  const firstCueHandledRef = useRef(false);
  const activeRef = useRef(false);
  const pendingTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const preWarmKeyRef = useRef('');
  const playSequenceRef = useRef(0);

  const clearPendingTimers = useCallback(() => {
    for (const id of pendingTimers.current) clearTimeout(id);
    pendingTimers.current.clear();
  }, []);

  const schedule = useCallback((fn: () => void, ms: number) => {
    if (!activeRef.current) return;
    const id = setTimeout(() => {
      pendingTimers.current.delete(id);
      if (activeRef.current) fn();
    }, ms);
    pendingTimers.current.add(id);
  }, []);

  const resetSession = useCallback((restoreBeeps: boolean) => {
    activeRef.current = false;
    clearPendingTimers();
    stopCurrentAudio();
    playSequenceRef.current += 1;
    lastPlayedRef.current = '';
    halfwayFiredRef.current = false;
    firstCueHandledRef.current = false;
    if (restoreBeeps) setAudioMuted(false);
  }, [clearPendingTimers]);

  useEffect(() => {
    if (enabled) {
      activeRef.current = true;
      console.log('[TTS] Player session active — suppressing legacy beeps');
      setAudioMuted(true);
      return () => resetSession(true);
    }

    console.log('[TTS] Player session inactive — restoring legacy beeps');
    resetSession(true);
    setPreloadStatus('idle');
    return undefined;
  }, [enabled, resetSession]);

  const allPhrases = useMemo(() => {
    const phrases: { text: string; path: string }[] = [];
    const seen = new Set<string>();

    const add = (text: string) => {
      if (!seen.has(text)) {
        seen.add(text);
        phrases.push({ text, path: phraseStoragePath(text) });
      }
    };

    Object.values(STATIC_PHRASES).forEach(add);

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

  const ensureClip = useCallback(async (text: string): Promise<string | null> => {
    if (clipsRef.current[text]) return clipsRef.current[text];
    if (clipPromiseRef.current[text]) return clipPromiseRef.current[text];
    if (Platform.OS !== 'web' || typeof window === 'undefined') return null;

    const storagePath = phraseStoragePath(text);
    const promise = (async () => {
      try {
        const fn = getGenerateVoice();
        console.log(`[TTS] Generating: "${text.substring(0, 50)}" → ${storagePath}`);
        const result = await fn({ text, voice: 'onyx', storagePath });
        clipsRef.current[text] = result.data.url;
        console.log(`[TTS] READY: "${text.substring(0, 40)}" ${result.data.cached ? '(cached)' : '(generated)'} → ${result.data.url.substring(0, 80)}`);
        return result.data.url;
      } catch (err: any) {
        console.error(`[TTS] FAILED: "${text.substring(0, 40)}" — ${err?.code || ''} ${err?.message || err}`);
        return null;
      } finally {
        delete clipPromiseRef.current[text];
      }
    })();

    clipPromiseRef.current[text] = promise;
    return promise;
  }, []);

  useEffect(() => {
    if (!enabled || Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (allPhrases.length === 0) return;

    const phraseKey = allPhrases.map(p => p.path).join('|');
    const missing = allPhrases.filter(({ text }) => !clipsRef.current[text]);

    if (missing.length === 0) {
      preWarmKeyRef.current = phraseKey;
      setPreloadStatus('ready');
      console.log('[TTS] PRE-WARM SKIP — all clips already cached in session');
      return;
    }

    if (preWarmKeyRef.current === phraseKey && preloadStatus === 'loading') {
      return;
    }

    preWarmKeyRef.current = phraseKey;
    setPreloadStatus('loading');
    console.log(`[TTS] PRE-WARM START — ${missing.length}/${allPhrases.length} clips missing for this workout session`);

    let cancelled = false;

    (async () => {
      try {
        const results = await Promise.allSettled(missing.map(({ text }) => ensureClip(text)));
        if (cancelled) return;

        const ok = results.filter(r => r.status === 'fulfilled' && !!r.value).length;
        const failed = missing.length - ok;
        const loaded = Object.keys(clipsRef.current).length;
        console.log(`[TTS] PRE-WARM DONE — loaded now=${loaded}, ok=${ok}, failed=${failed}`);
        setPreloadStatus(failed === 0 ? 'ready' : ok > 0 ? 'partial' : 'failed');
      } catch (err) {
        console.error('[TTS] PRE-WARM CRASHED:', err);
        if (!cancelled) setPreloadStatus('failed');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, allPhrases, ensureClip, preloadStatus]);

  const playAudioUrl = useCallback(async (
    url: string,
    source: string,
    opts?: { unlock?: boolean; revokeAfterPlay?: boolean },
  ): Promise<boolean> => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      console.log(`[TTS] PLAY SKIP (not web): ${source}`);
      return false;
    }

    try {
      stopCurrentAudio();
      const audio = createPlaybackAudio(url);
      currentAudio = audio;
      console.log(`[TTS] PLAY ATTEMPT: ${source} → ${url.substring(0, 80)}`);
      const promise = audio.play();
      if (promise) await promise;
      audioUnlocked = true;
      console.log(`[TTS] PLAYING OK: ${source}`);

      if (opts?.revokeAfterPlay) {
        const cleanup = () => {
          try { URL.revokeObjectURL(url); } catch {}
          audio.removeEventListener('ended', cleanup);
          audio.removeEventListener('error', cleanup);
        };
        audio.addEventListener('ended', cleanup);
        audio.addEventListener('error', cleanup);
      }

      return true;
    } catch (err: any) {
      console.error(`[TTS] PLAY BLOCKED: ${source} — ${err?.name || 'Error'}: ${err?.message || err}`);
      if (opts?.revokeAfterPlay) {
        try { URL.revokeObjectURL(url); } catch {}
      }
      return false;
    }
  }, []);

  const playPhrase = useCallback(async (text: string, source: string) => {
    console.log(`[TTS] CUE: ${source} | enabled=${enabled} | muted=${isMuted} | active=${activeRef.current} | text="${text.substring(0, 50)}"`);

    if (!enabled || !activeRef.current) {
      console.log(`[TTS] SKIP (inactive): ${source}`);
      return;
    }
    if (isMuted) {
      console.log(`[TTS] SKIP (muted): ${source}`);
      return;
    }
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      console.log(`[TTS] SKIP (not web): ${source}`);
      return;
    }

    const sequence = ++playSequenceRef.current;
    const url = await ensureClip(text);

    if (!enabled || !activeRef.current) {
      console.log(`[TTS] SKIP after ensure (inactive): ${source}`);
      return;
    }
    if (isMuted) {
      console.log(`[TTS] SKIP after ensure (muted): ${source}`);
      return;
    }
    if (sequence !== playSequenceRef.current) {
      console.log(`[TTS] SKIP (superseded by newer cue): ${source}`);
      return;
    }
    if (!url) {
      console.warn(`[TTS] CLIP NOT READY: ${source} — "${text.substring(0, 40)}"`);
      return;
    }

    await playAudioUrl(url, source);
  }, [enabled, ensureClip, isMuted, playAudioUrl]);

  const unlockAndPlayFirst = useCallback(async () => {
    console.log(`[TTS] unlockAndPlayFirst called | enabled=${enabled} | muted=${isMuted} | clips loaded=${Object.keys(clipsRef.current).length} | audioUnlocked=${audioUnlocked}`);

    if (!enabled || !activeRef.current) {
      console.log('[TTS] unlockAndPlayFirst SKIP — inactive player');
      return;
    }
    if (isMuted) {
      console.log('[TTS] unlockAndPlayFirst SKIP — muted');
      return;
    }
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      console.log('[TTS] unlockAndPlayFirst SKIP — not web');
      return;
    }

    firstCueHandledRef.current = false;

    if (!audioUnlocked) {
      const silentUrl = createSilentUnlockUrl();
      console.log('[TTS] Priming web audio with silent gesture clip before first spoken cue');
      const unlocked = await playAudioUrl(silentUrl, 'start:silent-unlock', { revokeAfterPlay: true });
      if (!unlocked) {
        console.warn('[TTS] Silent unlock failed on Start — leaving normal phase GO armed');
        return;
      }
    }

    const goUrl = clipsRef.current[STATIC_PHRASES.GO];
    if (!goUrl) {
      console.warn('[TTS] GO clip not ready on Start — audio unlocked, GO will follow via normal phase cue');
      return;
    }

    const playedGo = await playAudioUrl(goUrl, 'start:go:gesture');
    firstCueHandledRef.current = playedGo;
    if (!playedGo) {
      console.warn('[TTS] Start-gesture GO failed — leaving normal phase GO armed');
    }
  }, [enabled, isMuted, playAudioUrl]);

  useEffect(() => {
    if (!enabled || !current || current.stepType !== 'exercise' || !activeRef.current) return;

    if (phase === 'work') {
      const key = `work_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        halfwayFiredRef.current = false;

        if (current.name && current.name !== 'Get Ready') {
          if (currentIndex === 0 && firstCueHandledRef.current) {
            firstCueHandledRef.current = false;
            console.log('[TTS] Skipping first GO (already played from Start gesture)');
          } else {
            void playPhrase(STATIC_PHRASES.GO, `go:${currentIndex}`);
          }
        }
      }
    } else if (phase === 'rest') {
      const key = `rest_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;

        if (next?.stepType === 'exercise' && next.name && next.name !== 'Get Ready') {
          const phrase = buildPrepNextPhrase(next.name, next.weight);
          schedule(() => { void playPhrase(phrase, `prep:${currentIndex}`); }, 500);
        }
      }
    } else if (phase === 'swap') {
      const key = `swap_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        void playPhrase(STATIC_PHRASES.SWAP_SIDES, `swap:${currentIndex}`);
      }
    } else if (phase === 'ready') {
      lastPlayedRef.current = '';
      halfwayFiredRef.current = false;
    }
  }, [enabled, phase, currentIndex, current?.name, current?.stepType, next?.name, next?.stepType, next?.weight, playPhrase, schedule]);

  useEffect(() => {
    if (!enabled || !current || !activeRef.current) return;

    if (phase === 'waterBreak') {
      const key = `water_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        void playPhrase(STATIC_PHRASES.WATER_BREAK, `water:${currentIndex}`);
      }
    } else if (phase === 'demo') {
      const key = `demo_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        void playPhrase(STATIC_PHRASES.DEMO, `demo:${currentIndex}`);
      }
    } else if (phase === 'grabEquipment') {
      const key = `equip_${currentIndex}`;
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        const phrase = buildGrabEquipmentPhrase(current.instructionText);
        void playPhrase(phrase, `equip:${currentIndex}`);
      }
    } else if (phase === 'complete') {
      const key = 'complete';
      if (lastPlayedRef.current !== key) {
        lastPlayedRef.current = key;
        void playPhrase(STATIC_PHRASES.WORKOUT_COMPLETE, 'complete');
      }
    }
  }, [enabled, phase, currentIndex, current?.instructionText, playPhrase]);

  useEffect(() => {
    if (!enabled || phase !== 'work' || !current || current.stepType !== 'exercise') return;
    if (!activeRef.current) return;
    if (currentDuration <= 6) return;

    const hw = Math.floor(currentDuration / 2);
    if (timeLeft === hw && !halfwayFiredRef.current) {
      halfwayFiredRef.current = true;
      void playPhrase(STATIC_PHRASES.HALFWAY, `halfway:${currentIndex}`);
    }
  }, [enabled, phase, timeLeft, currentDuration, current, playPhrase, currentIndex]);

  useEffect(() => () => resetSession(true), [resetSession]);

  return { preloadStatus, unlockAndPlayFirst };
}
