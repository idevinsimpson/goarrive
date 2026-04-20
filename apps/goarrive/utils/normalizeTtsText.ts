/**
 * normalizeTtsText — Shared helper to clean movement/cue text before TTS.
 *
 * The same input text must produce the same spoken phrase AND the same cache
 * key, so cache-busting and pronunciation share this single normalization.
 *
 * Handles fitness abbreviations OpenAI mispronounces (DB → dumbbell, KB →
 * kettlebell, etc.), unit words (lbs → pounds), hyphenated terms that read
 * as compounds (T-spine → T spine), duplicated words, and stray punctuation.
 */

// Word-boundary substitutions. Order matters: longer/more-specific phrases
// run before single tokens so "single-arm" expands before the "SA" rule fires.
const SUBSTITUTIONS: [RegExp, string][] = [
  // Hyphenated phrases that TTS reads as one mashed word
  [/\bsingle-arm\b/gi, 'single arm'],
  [/\bsingle-leg\b/gi, 'single leg'],
  [/\bT-spine\b/gi, 'T spine'],
  [/\bU-handle\b/gi, 'U handle'],
  [/\bV-up\b/gi, 'V up'],
  [/\bX-band\b/gi, 'X band'],

  // Equipment abbreviations (case-insensitive but match as standalone tokens)
  [/\bDB\b/g, 'dumbbell'],
  [/\bDBs\b/g, 'dumbbells'],
  [/\bBB\b/g, 'barbell'],
  [/\bBBs\b/g, 'barbells'],
  [/\bKB\b/g, 'kettlebell'],
  [/\bKBs\b/g, 'kettlebells'],
  [/\bSA\b/g, 'single arm'],
  [/\bSL\b/g, 'single leg'],

  // Units
  [/\blbs?\b/gi, 'pounds'],
  [/\bkgs?\b/gi, 'kilograms'],
  [/\bsecs?\b/gi, 'seconds'],
  [/\bmins?\b/gi, 'minutes'],
  [/\breps?\b/gi, 'reps'],
];

/**
 * Normalize text for TTS pronunciation and cache key generation.
 * Returns a clean, lowercase-comparable phrase suitable for hashing.
 */
export function normalizeTtsText(input: string): string {
  if (!input) return '';

  let text = input;

  for (const [pattern, replacement] of SUBSTITUTIONS) {
    text = text.replace(pattern, replacement);
  }

  // Strip stray punctuation that TTS reads as pauses or skips awkwardly,
  // but keep apostrophes (it's, don't) and basic hyphens between letters.
  text = text.replace(/[._/\\|*~`<>{}\[\]()"]/g, ' ');

  // Collapse repeated whitespace
  text = text.replace(/\s+/g, ' ').trim();

  // Remove duplicated adjacent words (case-insensitive): "rest rest" → "rest"
  text = text.replace(/\b(\w+)(\s+\1\b)+/gi, '$1');

  return text;
}

/**
 * Deterministic short hash of a string. djb2 variant — collision risk is
 * acceptable here because the path also includes the movementId namespace,
 * so a collision would only affect a single movement's cache.
 */
export function hashTtsText(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  // 8-char unsigned hex
  return (hash >>> 0).toString(16).padStart(8, '0');
}
