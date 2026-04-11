/**
 * analyzeMovementMedia.ts — AI-powered movement analysis
 *
 * Sends a compact contact sheet (12 ordered frames from the cropped video)
 * to GPT-4.1-mini vision via a Firebase Cloud Function. If the model's
 * confidence is below 0.7, automatically retries with a denser 24-frame
 * contact sheet for better accuracy.
 *
 * This approach is significantly cheaper than sending a full animated GIF
 * while preserving enough visual context to identify movements reliably.
 *
 * Falls back silently — if analysis fails, the movement saves with
 * empty fields and the coach can fill them in manually.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';
import { generateContactSheet, generateDenseContactSheet } from './generateContactSheet';

export interface MovementAnalysis {
  name: string;
  category: string;
  equipment: string;
  difficulty: string;
  muscleGroups: string[];
  description: string;
  regression: string;
  progression: string;
  contraindications: string;
  workSec: number;
  restSec: number;
  confidence: number;
}

interface AnalyzeRequest {
  contactSheet?: string;
  gifUrl?: string;
}

/** Confidence threshold — below this triggers a denser re-analysis */
const CONFIDENCE_THRESHOLD = 0.7;

/**
 * Analyze a movement using a contact sheet extracted from the cropped video.
 *
 * Flow:
 * 1. Generate a 12-frame contact sheet from the cropped video
 * 2. Send to GPT-4.1-mini vision for analysis
 * 3. If confidence < 0.7, generate a 24-frame dense sheet and retry
 * 4. Return the best result (or null on failure)
 *
 * @param videoUrl - URL of the source video
 * @param crop - Crop transform values from VideoCropModal
 * @returns Structured movement metadata, or null if analysis fails
 */
export async function analyzeMovementMedia(
  videoUrl: string,
  crop: { cropScale: number; cropTranslateX: number; cropTranslateY: number },
): Promise<MovementAnalysis | null> {
  try {
    const functions = getFunctions();
    const analyzeFn = httpsCallable<AnalyzeRequest, MovementAnalysis>(
      functions,
      'analyzeMovement',
    );

    // Step 1: Generate compact 12-frame contact sheet
    const contactSheet = await generateContactSheet(videoUrl, crop);
    if (!contactSheet) {
      console.warn('[analyzeMovementMedia] Contact sheet generation failed');
      return null;
    }

    // Step 2: Send to Cloud Function for AI analysis
    const result = await analyzeFn({ contactSheet });
    const analysis = result.data;

    // Step 3: Check confidence — if too low, retry with denser sheet
    if (analysis.confidence < CONFIDENCE_THRESHOLD) {
      console.log(
        `[analyzeMovementMedia] Low confidence (${analysis.confidence}), retrying with dense contact sheet`,
      );

      const denseSheet = await generateDenseContactSheet(videoUrl, crop);
      if (denseSheet) {
        const retryResult = await analyzeFn({ contactSheet: denseSheet });
        // Use the retry result if it's more confident, otherwise keep original
        if (retryResult.data.confidence > analysis.confidence) {
          return retryResult.data;
        }
      }
    }

    return analysis;
  } catch (err) {
    console.warn('[analyzeMovementMedia] AI analysis failed silently:', err);
    return null;
  }
}

/**
 * Legacy wrapper — analyze from a GIF URL (backwards compatibility).
 * Used by bulk upload or other flows that already have a GIF URL.
 */
export async function analyzeMovementFromGif(
  gifUrl: string,
): Promise<MovementAnalysis | null> {
  try {
    const functions = getFunctions();
    const analyzeFn = httpsCallable<AnalyzeRequest, MovementAnalysis>(
      functions,
      'analyzeMovement',
    );

    const result = await analyzeFn({ gifUrl });
    return result.data;
  } catch (err) {
    console.warn('[analyzeMovementMedia] GIF analysis failed silently:', err);
    return null;
  }
}
