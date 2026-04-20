/**
 * useMovementHydrate — Enriches flat movements with the canonical movement doc.
 *
 * Workout blocks store a snapshot of each movement (movementId, movementName,
 * videoUrl, voiceUrl, etc.) at the time the workout was built. After a coach
 * renames or re-records a movement, that snapshot goes stale — but the player
 * needs the current name and the current voiceUrl so it never speaks the old
 * name or plays an MP3 that's been replaced.
 *
 * For every unique movementId in the flat list, this hook subscribes to
 * `movements/{id}` via onSnapshot and merges canonical fields back into the
 * flat sequence. Live subscription (not getDoc) is the whole point: when a
 * coach renames a movement, generateMovementVoice writes the new voiceUrl to
 * Firestore asynchronously (2-5s after rename for the OpenAI round trip).
 * onSnapshot pushes that update to the player so the next phase that reads
 * voiceUrl gets the freshly-generated MP3 instead of the cleared/stale value.
 *
 * Two merge strategies:
 *   • Identity / audio fields (name, voiceUrl, voiceText): canonical ALWAYS
 *     wins. These must reflect the current movement doc — the visual title
 *     and the spoken audio have to come from the same source of truth.
 *   • Media / coaching fields (videoUrl, thumbnailUrl, description, etc.):
 *     block snapshot wins; canonical is the fallback. This preserves any
 *     workout-specific overrides the coach set when building the workout.
 */
import { useEffect, useState, useRef } from 'react';
import { db } from '../lib/firebase';
import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import type { FlatMovement } from './useWorkoutFlatten';
import { generateMovementVoice } from '../utils/generateMovementVoice';
import {
  TTS_PROVIDER,
  TTS_VOICE_ID,
  TTS_VOICE_EFFECT,
} from '../utils/ttsProviderConfig';

/**
 * Returns true when the doc's stored TTS metadata matches the current active
 * provider/voice/effect. Falls back to the legacy `voiceName === voiceId`
 * check for clips written before ttsProvider/voiceEffect existed (those are
 * almost certainly OpenAI nova and should regen onto Voicemaker).
 */
function isStoredVoiceCurrent(cached: any): boolean {
  const storedProvider = typeof cached?.ttsProvider === 'string' ? cached.ttsProvider : '';
  const storedVoiceId = typeof cached?.voiceId === 'string'
    ? cached.voiceId
    : (typeof cached?.voiceName === 'string' ? cached.voiceName : '');
  const storedEffect = typeof cached?.voiceEffect === 'string' ? cached.voiceEffect : '';
  // Legacy clips have no ttsProvider field → treat as wrong provider so they
  // regenerate under Voicemaker. Effect missing on legacy is fine because the
  // provider mismatch already forces regen.
  if (!storedProvider) return false;
  if (storedProvider !== TTS_PROVIDER) return false;
  if (storedVoiceId !== TTS_VOICE_ID) return false;
  if (storedEffect !== TTS_VOICE_EFFECT) return false;
  return true;
}

function mergeFromCache(fm: FlatMovement, cached: any): FlatMovement {
  // Canonical wins for identity + audio so a rename always propagates.
  // For voiceUrl specifically: if the canonical doc has been cleared (e.g.
  // mid-regeneration after a rename), we WANT '' so the player stays silent
  // for the name rather than speaking the stale block snapshot's clip. The
  // backfill effect below kicks off generation so the next phase has audio.
  //
  // Wrong-provider/voice/effect guard: when the canonical doc's stored TTS
  // metadata doesn't match the current active provider+voice+effect, we
  // blank the local voiceUrl so the player won't play the stale wrong-voice
  // clip. The backfill effect below triggers regeneration; onSnapshot pushes
  // the new URL back when the server writes it, and the next rest cue picks
  // it up.
  const canonicalName = typeof cached.name === 'string' && cached.name.trim()
    ? cached.name
    : fm.name;
  const voiceCurrent = isStoredVoiceCurrent(cached);
  const canonicalVoiceUrl = typeof cached.voiceUrl === 'string' && voiceCurrent
    ? cached.voiceUrl
    : (voiceCurrent ? (fm.voiceUrl || '') : '');
  return {
    ...fm,
    name: canonicalName,
    voiceUrl: canonicalVoiceUrl,
    videoUrl: fm.videoUrl || cached.videoUrl || '',
    thumbnailUrl: fm.thumbnailUrl || cached.thumbnailUrl || '',
    description: fm.description || cached.description || '',
    coachingCues: fm.coachingCues || cached.coachingCues || '',
    cropScale: fm.cropScale ?? cached.cropScale ?? 1,
    cropTranslateX: fm.cropTranslateX ?? cached.cropTranslateX ?? 0,
    cropTranslateY: fm.cropTranslateY ?? cached.cropTranslateY ?? 0,
  };
}

export function useMovementHydrate(flatMovements: FlatMovement[]): FlatMovement[] {
  const [hydrated, setHydrated] = useState<FlatMovement[]>(flatMovements);
  const cacheRef = useRef<Record<string, any>>({});
  const subsRef = useRef<Map<string, Unsubscribe>>(new Map());
  const flatRef = useRef<FlatMovement[]>(flatMovements);
  // Movements we've already kicked off voice generation for in this session.
  // Legacy movements created before OpenAI voice generation shipped don't have
  // a voiceUrl on their doc — on first play we trigger generateMovementVoice
  // so the onSnapshot subscription picks up the new URL for the next phase.
  // Without this, those movements stay voiceless forever and the "Next up, …"
  // portion of the rest screen is silent.
  const voiceGenAttemptedRef = useRef<Set<string>>(new Set());

  // Always have the latest flat list available to the snapshot callback so
  // updates merge against the right source array even between renders.
  useEffect(() => { flatRef.current = flatMovements; }, [flatMovements]);

  useEffect(() => {
    if (flatMovements.length === 0) {
      setHydrated([]);
      return;
    }

    const recomputeMerged = () => {
      const merged = flatRef.current.map((fm) =>
        fm.movementId && cacheRef.current[fm.movementId]
          ? mergeFromCache(fm, cacheRef.current[fm.movementId])
          : fm,
      );
      setHydrated(merged);
    };

    // Render synchronously with whatever's already cached so the UI doesn't
    // flash empty data on flatMovements changes (e.g. swap).
    recomputeMerged();

    const desiredIds = new Set<string>();
    for (const fm of flatMovements) {
      if (fm.movementId) desiredIds.add(fm.movementId);
    }

    // Forensic: dump initial block-snapshot state so we can diff against
    // canonical docs as they arrive via onSnapshot below.
    try {
      const table = flatMovements
        .filter((fm) => fm.stepType === 'exercise' && fm.movementIndex !== -1)
        .map((fm) => ({
          name: fm.name,
          movementId: fm.movementId || '(MISSING)',
          blockVoiceUrl: fm.voiceUrl ? 'present' : 'empty',
        }));
      console.info('[VOICE-AUDIT] useMovementHydrate mount — block snapshot', table);
      console.info('[VOICE-AUDIT] useMovementHydrate desiredIds to subscribe', Array.from(desiredIds));
    } catch {}

    // Subscribe to any new movement docs we don't already watch. We never
    // tear down on flatMovements changes here — only at unmount — because
    // the same movement can disappear and reappear (swap/un-swap) and we
    // want to keep the live update flowing through that.
    for (const id of desiredIds) {
      if (subsRef.current.has(id)) continue;
      const unsub = onSnapshot(
        doc(db, 'movements', id),
        (snap) => {
          if (!snap.exists()) {
            console.warn('[VOICE-AUDIT] canonical movement doc MISSING', { movementId: id });
            return;
          }
          const data = snap.data();
          cacheRef.current[id] = data;
          const name = typeof data.name === 'string' ? data.name.trim() : '';
          const hasVoice = typeof data.voiceUrl === 'string' && data.voiceUrl.length > 0;
          const storedProvider = typeof data.ttsProvider === 'string' ? data.ttsProvider : '';
          const storedVoiceId = typeof data.voiceId === 'string'
            ? data.voiceId
            : (typeof data.voiceName === 'string' ? data.voiceName : '');
          const storedEffect = typeof data.voiceEffect === 'string' ? data.voiceEffect : '';
          const voiceCurrent = isStoredVoiceCurrent(data);
          // Regenerate when either (a) the movement has no clip at all (legacy
          // backfill), or (b) it has a clip from a different provider/voice/
          // effect than the current canonical one — e.g. movements cached with
          // OpenAI nova before Voicemaker ai3-Aria shipped. mergeFromCache
          // blanks the local voiceUrl in case (b) so the stale clip doesn't
          // play in the meantime.
          const needsRegen = !hasVoice || !voiceCurrent;
          console.info('[VOICE-AUDIT] onSnapshot movement doc', {
            movementId: id,
            name,
            voiceUrlPresent: hasVoice,
            voiceUrlPreview: hasVoice ? String(data.voiceUrl).slice(0, 80) : '',
            voiceTextPresent: typeof data.voiceText === 'string' && data.voiceText.length > 0,
            storedProvider, storedVoiceId, storedEffect,
            voiceCurrent,
            needsRegen,
            isGlobal: data.isGlobal === true,
            coachId: typeof data.coachId === 'string' ? data.coachId : '',
            attempted: voiceGenAttemptedRef.current.has(id),
          });
          recomputeMerged();
          // Backfill voiceUrl for legacy movements OR correct wrong-voice clips.
          // We only run once per (session, movement) so a coach mid-regenerate
          // (voiceUrl === '') doesn't get a redundant call — MovementForm
          // already owns that flow. We also require a name to send to the
          // provider. The Cloud Function writes voiceUrl/voiceText/voiceName/
          // ttsProvider/voiceId/voiceEffect back to the doc with admin creds
          // (members can't update /movements from the client). onSnapshot
          // then pushes the new URL in for the next rest cue.
          if (needsRegen && name && !voiceGenAttemptedRef.current.has(id)) {
            voiceGenAttemptedRef.current.add(id);
            const reason = !hasVoice
              ? 'missing'
              : `wrong-voice:${storedProvider || '?'}/${storedVoiceId || '?'}/${storedEffect || '?'}`;
            console.info('[VOICE-AUDIT] triggering voice backfill', { movementId: id, name, reason });
            generateMovementVoice(id, name)
              .then(({ url }) => {
                if (!url) {
                  console.warn('[VOICE-AUDIT] backfill returned NO URL', { movementId: id, name });
                } else {
                  console.info('[VOICE-AUDIT] backfill returned URL (awaiting Firestore onSnapshot push)', {
                    movementId: id, name, urlPreview: url.slice(0, 80),
                  });
                }
              })
              .catch((err) => {
                console.warn('[VOICE-AUDIT] backfill REJECTED', { movementId: id, name, err });
              });
          } else if (needsRegen && !name) {
            console.warn('[VOICE-AUDIT] cannot backfill — canonical doc missing name', { movementId: id });
          }
        },
        (err) => {
          console.warn('[VOICE-AUDIT] onSnapshot ERROR', { movementId: id, err });
        },
      );
      subsRef.current.set(id, unsub);
    }
  }, [flatMovements]);

  // Final cleanup on unmount. Snapshot the refs into locals up-front so the
  // cleanup doesn't read .current after a future render swapped in a new Map
  // (the lint warning that flags this pattern).
  useEffect(() => {
    const subs = subsRef.current;
    const cache = cacheRef.current;
    return () => {
      for (const unsub of subs.values()) unsub();
      subs.clear();
      for (const k of Object.keys(cache)) delete cache[k];
    };
  }, []);

  return hydrated;
}
