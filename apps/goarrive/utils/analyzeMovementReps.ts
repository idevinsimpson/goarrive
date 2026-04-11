/**
 * analyzeMovementReps — AI-powered rep detection for one-rep loop creation
 *
 * Calls a Firebase Cloud Function that sends a movement GIF to GPT-4.1-mini
 * vision and determines:
 *   - How many complete reps are in the clip
 *   - If 2+, the start/end percentages of one clean full rep that loops well
 *
 * Used to create the one-rep loop GIF derivative.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';

export interface RepAnalysis {
  /** Number of complete reps detected in the clip */
  repCount: number;
  /** Start of the best single rep as a fraction of total duration (0–1) */
  loopStartPct: number;
  /** End of the best single rep as a fraction of total duration (0–1) */
  loopEndPct: number;
}

/**
 * Analyze a movement GIF to detect rep count and optimal loop boundaries.
 *
 * @param gifUrl Public URL of the high-quality GIF
 * @returns Rep analysis, or null if analysis fails or only 1 rep detected
 */
export async function analyzeMovementReps(
  gifUrl: string,
): Promise<RepAnalysis | null> {
  try {
    const functions = getFunctions();
    const analyzeFn = httpsCallable<{ gifUrl: string }, RepAnalysis>(
      functions,
      'analyzeMovementReps',
    );

    const result = await analyzeFn({ gifUrl });
    const data = result.data;

    // Only return if 2+ reps — otherwise no loop trimming needed
    if (!data || data.repCount < 2) return null;

    // Validate boundaries
    if (
      data.loopStartPct < 0 ||
      data.loopStartPct >= 1 ||
      data.loopEndPct <= 0 ||
      data.loopEndPct > 1 ||
      data.loopEndPct <= data.loopStartPct
    ) {
      console.warn('[analyzeMovementReps] Invalid loop boundaries:', data);
      return null;
    }

    return data;
  } catch (err) {
    console.warn('[analyzeMovementReps] Rep analysis failed silently:', err);
    return null;
  }
}
