/**
 * useCountdownPhrases — Pre-warms the combined "3, 2, 1. Rest." and
 * "3, 2, 1. Go." OpenAI clips so the workout player can fire one cohesive
 * countdown cue instead of the old countdown_3.mp3 + rest/go.mp3 pair.
 *
 * Pre-warm timing:
 *   Generation kicks off on mount (workout open). Both phrases are global —
 *   they cache across every workout for the life of the current style
 *   version — so subsequent loads hit the Storage cache server-side and
 *   return immediately without an OpenAI call.
 *
 * Pre-download (browser cache priming):
 *   Once the CDN URL resolves, we new-Audio() it with preload='auto' so the
 *   MP3 bytes land in the browser cache before the player ever needs the
 *   clip. Without this, the first countdown of the session pays ~100-300ms
 *   network fetch on `play()` and the "3" word starts perceptibly late even
 *   when the enqueue timing itself is correct.
 *
 * On failure / while waiting:
 *   The hook returns url=null for that variant. useWorkoutTTS falls back to
 *   the legacy static countdown_3 + rest/go MP3 sequence (graceful
 *   degradation, first-ever load only).
 */
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  generateCountdownPhrase,
  type CountdownVariant,
} from '../utils/generateCountdownPhrase';

export interface CountdownPhraseUrls {
  restCountdownUrl: string | null;
  goCountdownUrl: string | null;
  swapCountdownUrl: string | null;
}

// Module-level cache so a second mount of WorkoutPlayer in the same session
// (open → close → open) doesn't re-call the Cloud Function. Holds the last
// resolved URLs per variant; the callable still short-circuits on its own
// Storage cache check, but this avoids the round trip entirely.
const sessionUrlCache: Partial<Record<CountdownVariant, string>> = {};
const preloadedUrls = new Set<string>();

function preloadVoiceUrl(url: string): void {
  if (Platform.OS !== 'web') return;
  if (typeof window === 'undefined') return;
  if (!url || preloadedUrls.has(url)) return;
  try {
    const audio = new (window as any).Audio(url);
    audio.preload = 'auto';
    // Assigning it to a module-scoped variable would keep a reference alive;
    // HTMLAudioElement survives as long as the browser hasn't GC'd it, and
    // the cache we care about is the HTTP cache keyed on URL, which this
    // fetch populates.
    preloadedUrls.add(url);
  } catch {
    // Audio API unavailable — silently skip; useWorkoutTTS will still play
    // on demand, just without the pre-warm benefit.
  }
}

export function useCountdownPhrases(): CountdownPhraseUrls {
  const [restCountdownUrl, setRestCountdownUrl] = useState<string | null>(
    sessionUrlCache.rest ?? null,
  );
  const [goCountdownUrl, setGoCountdownUrl] = useState<string | null>(
    sessionUrlCache.go ?? null,
  );
  const [swapCountdownUrl, setSwapCountdownUrl] = useState<string | null>(
    sessionUrlCache.swap ?? null,
  );
  const startedRef = useRef<boolean>(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const kickoff = (variant: CountdownVariant, set: (u: string) => void) => {
      if (sessionUrlCache[variant]) {
        preloadVoiceUrl(sessionUrlCache[variant]!);
        return;
      }
      generateCountdownPhrase(variant)
        .then(({ url }) => {
          if (!url) return;
          sessionUrlCache[variant] = url;
          preloadVoiceUrl(url);
          set(url);
        })
        .catch((err) => {
          console.warn('[VOICE-AUDIT] useCountdownPhrases generation REJECTED', {
            variant, err,
          });
        });
    };

    kickoff('rest', setRestCountdownUrl);
    kickoff('go', setGoCountdownUrl);
    kickoff('swap', setSwapCountdownUrl);
  }, []);

  return { restCountdownUrl, goCountdownUrl, swapCountdownUrl };
}
