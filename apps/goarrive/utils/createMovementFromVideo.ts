/**
 * createMovementFromVideo — shared "create a movement from an existing
 * videoUrl" pipeline. Single source of truth used by both MovementForm
 * (upload/record flow) and MovementVariationModal (AI variation flow).
 *
 * Pipeline (identical for every entry point):
 *   1. Derivatives — high GIF, low GIF, poster/first-frame (with legacy fallback)
 *   2. OpenAI movement analysis
 *   3. Movement doc creation (movements collection)
 *   4. Voice generation (non-blocking)
 *   5. One-rep loop detection (non-blocking)
 */
import { db, storage } from '../lib/firebase';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { collection, addDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { Platform } from 'react-native';
import {
  generateMovementDerivatives,
  encodeOneRepLoopGif,
  CropTransform,
} from './generateMovementDerivatives';
import { generateCroppedGif } from './generateCroppedGif';
import { generateMovementVoice } from './generateMovementVoice';
import { analyzeMovementMedia, MovementAnalysis } from './analyzeMovementMedia';
import { analyzeMovementReps } from './analyzeMovementReps';

// ── Shared storage upload ────────────────────────────────────────────────────

/** Upload a blob to movements/{coachId}/{subfolder}/ and return its download URL. */
export async function uploadMovementBlob(
  coachId: string,
  blob: Blob,
  subfolder: string,
  ext: string,
): Promise<string> {
  const fileName = `movements/${coachId}/${subfolder}/${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
  const storageRef = ref(storage, fileName);
  const uploadTask = uploadBytesResumable(storageRef, blob, {
    contentType: ext === 'gif' ? 'image/gif' : 'image/jpeg',
  });
  return new Promise<string>((resolve, reject) => {
    uploadTask.on('state_changed', null, reject, async () => {
      const url = await getDownloadURL(uploadTask.snapshot.ref);
      resolve(url);
    });
  });
}

// ── Shared derivative pipeline ───────────────────────────────────────────────

export interface MovementDerivativeUrls {
  gifHighUrl: string | null;
  gifLowUrl: string | null;
  thumbnailImageUrl: string | null;
  posterUrl: string | null;
  _loFrames: ImageData[];
}

const EMPTY_DERIVATIVES: MovementDerivativeUrls = {
  gifHighUrl: null,
  gifLowUrl: null,
  thumbnailImageUrl: null,
  posterUrl: null,
  _loFrames: [],
};

/**
 * Generate all derivatives for a video and upload them to Storage.
 * Falls back to the legacy single-GIF pipeline if the new one fails.
 */
export async function generateAndUploadMovementDerivatives(
  videoUrl: string,
  crop: CropTransform,
  coachId: string,
  onProgress?: (p: number) => void,
): Promise<MovementDerivativeUrls> {
  if (Platform.OS !== 'web' || !videoUrl) {
    return { ...EMPTY_DERIVATIVES };
  }

  const legacyFallback = async (): Promise<MovementDerivativeUrls> => {
    const legacyCrop = {
      cropScale: crop.cropScale,
      cropTranslateX: crop.cropTranslateX,
      cropTranslateY: crop.cropTranslateY,
    };
    const fallbackBlob = await generateCroppedGif(videoUrl, legacyCrop, onProgress);
    if (!fallbackBlob) return { ...EMPTY_DERIVATIVES };
    const fallbackUrl = await uploadMovementBlob(coachId, fallbackBlob, 'thumbnails', 'gif');
    return { ...EMPTY_DERIVATIVES, gifHighUrl: fallbackUrl };
  };

  try {
    const result = await generateMovementDerivatives(videoUrl, crop, onProgress);

    // If new pipeline failed or produced no usable GIF, fall back to old proven pipeline
    if (!result || (!result.gifHigh && !result.firstFrame)) {
      console.warn('[createMovementFromVideo] New pipeline failed, falling back to generateCroppedGif');
      return await legacyFallback();
    }

    // Upload available derivatives in parallel (some may be null if GIF encoding failed).
    // firstFrame goes to posters/ (posterUrl) AND thumbnailImageUrl for legacy compat.
    const [gifHighUrl, gifLowUrl, posterUrl] = await Promise.all([
      result.gifHigh ? uploadMovementBlob(coachId, result.gifHigh, 'thumbnails', 'gif') : Promise.resolve(null),
      result.gifLow ? uploadMovementBlob(coachId, result.gifLow, 'thumbnails-low', 'gif') : Promise.resolve(null),
      result.firstFrame ? uploadMovementBlob(coachId, result.firstFrame, 'posters', 'jpg') : Promise.resolve(null),
    ]);

    return { gifHighUrl, gifLowUrl, thumbnailImageUrl: posterUrl, posterUrl, _loFrames: result._loFrames };
  } catch (err) {
    console.error('[createMovementFromVideo] Derivative pipeline error:', err);
    try {
      return await legacyFallback();
    } catch (fallbackErr) {
      console.error('[createMovementFromVideo] Fallback pipeline also failed:', fallbackErr);
      return { ...EMPTY_DERIVATIVES };
    }
  }
}

// ── Full create-movement pipeline ────────────────────────────────────────────

export interface CreateMovementFromVideoInput {
  videoUrl: string;
  crop: CropTransform;
  coachId: string;
  tenantId: string;
  metadata?: {
    sourceMovementId?: string;
    sourceMovementName?: string;
    aiVariationPrompt?: string;
    aiVariationJobId?: string;
    aiVariationProvider?: string;
    aiVariationModel?: string;
    createdVia?: 'ai_variation';
  };
  onStatus?: (status: string) => void;
  onProgress?: (progress: number) => void;
}

export interface CreateMovementFromVideoResult {
  movementId: string;
  movementData: Record<string, any>;
}

export async function createMovementFromVideo(
  input: CreateMovementFromVideoInput,
): Promise<CreateMovementFromVideoResult> {
  const { videoUrl, crop, coachId, tenantId, metadata, onStatus, onProgress } = input;

  // Step 1: Generate all derivatives (GIF high, GIF low, first-frame image)
  onStatus?.('Creating thumbnails...');
  onProgress?.(0.1);
  const { gifHighUrl, gifLowUrl, posterUrl, _loFrames } = await generateAndUploadMovementDerivatives(
    videoUrl,
    crop,
    coachId,
  );
  onProgress?.(0.4);

  // Step 2: AI Analysis (runs on the high-quality GIF)
  let aiData: Record<string, any> = {};
  if (gifHighUrl) {
    onStatus?.('Analyzing movement...');
    onProgress?.(0.5);
    try {
      const aiAnalysis: MovementAnalysis | null = await analyzeMovementMedia(videoUrl, crop);
      if (aiAnalysis) {
        aiData = {
          name: aiAnalysis.name || '',
          category: aiAnalysis.category || '',
          equipment: aiAnalysis.equipment || '',
          difficulty: aiAnalysis.difficulty || '',
          muscleGroups: aiAnalysis.muscleGroups || [],
          description: aiAnalysis.description || '',
          regression: aiAnalysis.regression || '',
          progression: aiAnalysis.progression || '',
          contraindications: aiAnalysis.contraindications || '',
          workSec: aiAnalysis.workSec || 30,
          restSec: aiAnalysis.restSec || 15,
        };
      }
    } catch (aiErr) {
      console.warn('[createMovementFromVideo] AI analysis failed, saving without:', aiErr);
    }
  }

  onStatus?.(aiData.name ? 'Saving movement...' : 'AI analysis unavailable — saving with defaults...');
  onProgress?.(0.7);

  // Step 3: Save to Firestore with all derivative URLs
  const fallbackName = metadata?.sourceMovementName
    ? `${metadata.sourceMovementName} Variation`
    : 'New Movement';
  const movementData: Record<string, any> = {
    name: aiData.name || fallbackName,
    category: aiData.category || '',
    equipment: aiData.equipment || '',
    difficulty: aiData.difficulty || '',
    description: aiData.description || '',
    muscleGroups: aiData.muscleGroups || [],
    workSec: aiData.workSec || 30,
    restSec: aiData.restSec || 15,
    countdownSec: 3,
    swapSides: false,
    swapMode: 'split' as const, // initial — coach edits after creation
    swapWindowSec: 5,
    videoUrl: videoUrl.trim(),
    thumbnailUrl: gifHighUrl || posterUrl || '',
    thumbnailImageUrl: posterUrl || '',
    posterUrl: posterUrl || '',
    gifLowUrl: gifLowUrl || '',
    gifLoopUrl: '', // populated by one-rep loop step below
    regression: aiData.regression || '',
    progression: aiData.progression || '',
    contraindications: aiData.contraindications || '',
    cropScale: crop.cropScale,
    cropTranslateX: crop.cropTranslateX,
    cropTranslateY: crop.cropTranslateY,
    cropFrameWidth: crop.cropFrameWidth,
    cropFrameHeight: crop.cropFrameHeight,
    coachId,
    tenantId,
    isGlobal: false,
    isArchived: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (metadata?.createdVia) movementData.createdVia = metadata.createdVia;
  if (metadata?.sourceMovementId) movementData.sourceMovementId = metadata.sourceMovementId;
  if (metadata?.sourceMovementName) movementData.sourceMovementName = metadata.sourceMovementName;
  if (metadata?.aiVariationPrompt) movementData.aiVariationPrompt = metadata.aiVariationPrompt;
  if (metadata?.aiVariationJobId) movementData.aiVariationJobId = metadata.aiVariationJobId;
  if (metadata?.aiVariationProvider) movementData.aiVariationProvider = metadata.aiVariationProvider;
  if (metadata?.aiVariationModel) movementData.aiVariationModel = metadata.aiVariationModel;

  const docRef = await addDoc(collection(db, 'movements'), movementData);
  const movementId = docRef.id;
  onProgress?.(0.85);

  // Step 4: Voice generation (non-blocking).
  // On failure, clear voiceUrl so the player falls back to Web Speech
  // for the new name instead of speaking a stale clip's old name.
  const voiceName = movementData.name;
  if (voiceName) {
    onStatus?.('Generating voice...');
    generateMovementVoice(movementId, voiceName)
      .then(({ url, text, voiceName: vn }) => {
        const update: Record<string, any> = url
          ? { voiceUrl: url, voiceText: text, voiceName: vn }
          : { voiceUrl: '', voiceText: '', voiceName: '' };
        updateDoc(doc(db, 'movements', movementId), update).catch(() => {});
      })
      .catch(() => {});
  }

  // Step 5: AI one-rep loop detection (non-blocking, runs after save)
  if (gifHighUrl && _loFrames.length > 0) {
    (async () => {
      try {
        const repAnalysis = await analyzeMovementReps(gifHighUrl);
        if (repAnalysis && repAnalysis.repCount >= 2) {
          const loopBlob = await encodeOneRepLoopGif(
            _loFrames,
            repAnalysis.loopStartPct,
            repAnalysis.loopEndPct,
          );
          if (loopBlob) {
            const gifLoopUrl = await uploadMovementBlob(coachId, loopBlob, 'thumbnails-loop', 'gif');
            await updateDoc(doc(db, 'movements', movementId), { gifLoopUrl });
          }
        }
      } catch (err) {
        console.warn('[createMovementFromVideo] One-rep loop generation failed:', err);
      }
    })();
  }

  onProgress?.(1);
  onStatus?.('Done!');
  return { movementId, movementData };
}
