/**
 * analyzeMovementMedia.ts — AI-powered movement analysis
 *
 * Calls a Firebase Cloud Function that sends the movement's GIF thumbnail
 * to GPT-4.1-mini vision and returns structured metadata:
 *   - name, category, equipment, difficulty, muscleGroups,
 *     description, regression, progression, contraindications,
 *     workSec, restSec
 *
 * The Cloud Function keeps the OpenAI API key server-side.
 *
 * Falls back silently — if analysis fails, the movement saves with
 * empty fields and the coach can fill them in manually.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';

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
}

/**
 * Analyze a movement from its GIF thumbnail URL.
 *
 * @param gifUrl - Public URL of the movement's animated GIF thumbnail
 * @returns Structured movement metadata, or null if analysis fails
 */
export async function analyzeMovementMedia(
  gifUrl: string,
): Promise<MovementAnalysis | null> {
  try {
    const functions = getFunctions();
    const analyzeFn = httpsCallable<{ gifUrl: string }, MovementAnalysis>(
      functions,
      'analyzeMovement',
    );

    const result = await analyzeFn({ gifUrl });
    return result.data;
  } catch (err) {
    console.warn('[analyzeMovementMedia] AI analysis failed silently:', err);
    return null;
  }
}
