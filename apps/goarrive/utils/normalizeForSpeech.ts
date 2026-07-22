/**
 * normalizeForSpeech.ts — Deterministic text normalization for TTS
 *
 * Cleans movement names and weights so OpenAI TTS produces natural,
 * consistent speech. No AI generation — just regex cleanup.
 */

const ABBREVIATIONS: [RegExp, string][] = [
  [/\bDB\b/gi, 'dumbbell'],
  [/\bDBs\b/gi, 'dumbbells'],
  [/\bBB\b/gi, 'barbell'],
  [/\bKB\b/gi, 'kettlebell'],
  [/\bKBs\b/gi, 'kettlebells'],
  [/\bEZ\b/g, 'E Z'],
  [/\bSB\b/gi, 'stability ball'],
  [/\bRDL\b/gi, 'R D L'],
  [/\bGHD\b/gi, 'G H D'],
  [/\bAMRAP\b/gi, 'amrap'],
  [/\bEMOM\b/gi, 'E mom'],
  [/\bTRX\b/gi, 'T R X'],
  [/\bOHP\b/gi, 'overhead press'],
];

const WEIGHT_PATTERNS: [RegExp, string][] = [
  [/(\d+)\s*lbs?\b/gi, '$1 pounds'],
  [/(\d+)\s*kgs?\b/gi, '$1 kilograms'],
  [/(\d+)\s*lb\b/gi, '$1 pound'],
];

const TERM_FIXES: [RegExp, string][] = [
  [/\bT-spine\b/gi, 'T spine'],
  [/\bU-handle\b/gi, 'U handle'],
  [/\bsingle-arm\b/gi, 'single arm'],
  [/\bsingle-leg\b/gi, 'single leg'],
  [/\b1-arm\b/gi, 'one arm'],
  [/\b1-leg\b/gi, 'one leg'],
  [/\b2-arm\b/gi, 'two arm'],
];

/** Normalize a raw movement name or phrase for TTS. */
export function normalizeForSpeech(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  let text = raw.trim();

  // Strip parenthetical noise: "(each side)", "(per arm)"
  text = text.replace(/\s*\([^)]*\)\s*/g, ' ');

  for (const [p, r] of ABBREVIATIONS) text = text.replace(p, r);
  for (const [p, r] of WEIGHT_PATTERNS) text = text.replace(p, r);
  for (const [p, r] of TERM_FIXES) text = text.replace(p, r);

  // Replace hyphens between words with spaces
  text = text.replace(/(\w)-(\w)/g, '$1 $2');
  // Remove repeated consecutive words
  text = text.replace(/\b(\w+)\s+\1\b/gi, '$1');
  // Collapse whitespace
  text = text.replace(/\s{2,}/g, ' ').trim();

  return text;
}

/**
 * Build a spoken phrase for a movement, optionally including weight.
 * Example: "incline chest fly, 50 pounds"
 */
export function buildMovementPhrase(
  name: string,
  weight?: string | number,
): string {
  const normalized = normalizeForSpeech(name);
  if (!normalized) return '';

  if (weight != null && weight !== '' && weight !== 0) {
    const w = typeof weight === 'number'
      ? `${weight} pounds`
      : normalizeForSpeech(String(weight));
    return `${normalized}, ${w}`;
  }

  return normalized;
}
