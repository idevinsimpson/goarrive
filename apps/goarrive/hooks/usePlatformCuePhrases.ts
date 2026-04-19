/**
 * usePlatformCuePhrases — Pre-warms the OpenAI-generated halfway / water /
 * demo cue clips so the workout player can fire them with the same voice
 * and pacing as the countdown and next-up phrases.
 *
 * Works the same way as useCountdownPhrases: kicks off generation on mount,
 * pre-downloads the resulting MP3 so the first play doesn't pay network
 * latency, and exposes the URLs via state. useWorkoutTTS prefers these URLs
 * and falls back to the legacy static MP3s (halfway / water_break) when the
 * generated clip isn't ready yet — first-ever-load degradation only.
 *
 * Cache hits on subsequent loads are ~instant because the Cloud Function
 * checks Storage existence at the hashed path before calling OpenAI.
 */

import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  generatePlatformCuePhrase,
  type PlatformCueVariant,
} from '../utils/generatePlatformCuePhrase';

export interface PlatformCuePhraseUrls {
  halfwayUrl: string | null;
  waterUrl: string | null;
  demoUrl: string | null;
}

const sessionUrlCache: Partial<Record<PlatformCueVariant, string>> = {};
const preloadedUrls = new Set<string>();

function preloadVoiceUrl(url: string): void {
  if (Platform.OS !== 'web') return;
  if (typeof window === 'undefined') return;
  if (!url || preloadedUrls.has(url)) return;
  try {
    const audio = new (window as any).Audio(url);
    audio.preload = 'auto';
    preloadedUrls.add(url);
  } catch {
    // Audio API unavailable — silently skip.
  }
}

export function usePlatformCuePhrases(): PlatformCuePhraseUrls {
  const [halfwayUrl, setHalfwayUrl] = useState<string | null>(
    sessionUrlCache.halfway ?? null,
  );
  const [waterUrl, setWaterUrl] = useState<string | null>(
    sessionUrlCache.water ?? null,
  );
  const [demoUrl, setDemoUrl] = useState<string | null>(
    sessionUrlCache.demo ?? null,
  );
  const startedRef = useRef<boolean>(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const kickoff = (variant: PlatformCueVariant, set: (u: string) => void) => {
      if (sessionUrlCache[variant]) {
        preloadVoiceUrl(sessionUrlCache[variant]!);
        return;
      }
      generatePlatformCuePhrase(variant)
        .then(({ url }) => {
          if (!url) return;
          sessionUrlCache[variant] = url;
          preloadVoiceUrl(url);
          set(url);
        })
        .catch((err) => {
          console.warn('[VOICE-AUDIT] usePlatformCuePhrases generation REJECTED', {
            variant, err,
          });
        });
    };

    kickoff('halfway', setHalfwayUrl);
    kickoff('water', setWaterUrl);
    kickoff('demo', setDemoUrl);
  }, []);

  return { halfwayUrl, waterUrl, demoUrl };
}
