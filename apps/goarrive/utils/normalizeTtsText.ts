/**
 * normalizeTtsText — Shared helper to clean movement/cue text before TTS.
 *
 * The same input text must produce the same spoken phrase AND the same cache
 * key, so cache-busting and pronunciation share this single normalization.
 *
 * Handles fitness abbreviations TTS providers mispronounce (DB → dumbbell, KB
 * → kettlebell, RDL → Romanian deadlift, etc.), unit words (lbs → pounds),
 * hyphenated terms that read as compounds (T-spine → T spine), duplicated
 * words, and stray punctuation.
 *
 * Note: stripping the `<` and `>` characters in the punctuation pass would
 * destroy Voicemaker SSML break tags (<break time="700ms"/>), so this helper
 * is only safe to call on the *raw movement/cue name* — never on text that
 * already has break tags spliced in. Helpers that build break-tag phrases
 * normalize the bare name first, then splice break tags around it.
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
  [/\bpush-up\b/gi, 'push up'],
  [/\bpush-ups\b/gi, 'push ups'],

  // Compound spellings TTS slurs ("Pushup" → "Push up" so the verb reads naturally).
  // Case-preserving: "Pushup" → "push up" (lowercased — TTS pronunciation is the
  // only consumer of this text, never display).
  [/\bpushups\b/gi, 'push ups'],
  [/\bpushup\b/gi, 'push up'],

  // Equipment abbreviations (case-insensitive but match as standalone tokens)
  [/\bDB\b/g, 'dumbbell'],
  [/\bDBs\b/g, 'dumbbells'],
  [/\bBB\b/g, 'barbell'],
  [/\bBBs\b/g, 'barbells'],
  [/\bKB\b/g, 'kettlebell'],
  [/\bKBs\b/g, 'kettlebells'],
  [/\bSA\b/g, 'single arm'],
  [/\bSL\b/g, 'single leg'],
  [/\bOH\b/g, 'overhead'],

  // Lift abbreviations
  [/\bRDL\b/g, 'Romanian deadlift'],
  [/\bRDLs\b/g, 'Romanian deadlifts'],

  // Units
  [/\blbs?\b/gi, 'pounds'],
  [/\bkgs?\b/gi, 'kilograms'],
  [/\bsecs?\b/gi, 'seconds'],
  [/\bmins?\b/gi, 'minutes'],
  [/\breps?\b/gi, 'reps'],
];

/**
 * Normalize text for TTS pronunciation and cache key generation.
 * Returns a clean phrase suitable for hashing and for sending to the TTS
 * provider. Safe to call on bare movement/cue names — NOT safe to call on
 * text that already contains <break .../> SSML tags (the punctuation pass
 * strips angle brackets).
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
