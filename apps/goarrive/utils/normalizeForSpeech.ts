/**
 * normalizeForSpeech.ts — Deterministic text normalization for TTS
 *
 * Cleans movement names, weights, and abbreviations so OpenAI TTS
 * produces natural, consistent speech without glitches or awkward
 * pronunciation.
 */

// ── Abbreviation expansions ─────────────────────────────────────────
const ABBREVIATIONS: [RegExp, string][] = [
  [/\bDB\b/gi, 'dumbbell'],
  [/\bDBs\b/gi, 'dumbbells'],
  [/\bBB\b/gi, 'barbell'],
  [/\bKB\b/gi, 'kettlebell'],
  [/\bKBs\b/gi, 'kettlebells'],
  [/\bEZ\b/g, 'E Z'],         // "EZ bar" → "E Z bar"
  [/\bSB\b/gi, 'stability ball'],
  [/\bRDL\b/gi, 'R D L'],
  [/\bGHD\b/gi, 'G H D'],
  [/\bAMRAP\b/gi, 'amrap'],
  [/\bEMOM\b/gi, 'E mom'],
  [/\bTRX\b/gi, 'T R X'],
  [/\bOHP\b/gi, 'overhead press'],
];

// ── Weight / unit patterns ──────────────────────────────────────────
const WEIGHT_PATTERNS: [RegExp, string][] = [
  // "50lbs" or "50 lbs" → "50 pounds"
  [/(\d+)\s*lbs?\b/gi, '$1 pounds'],
  // "50kg" or "50 kgs" → "50 kilograms"
  [/(\d+)\s*kgs?\b/gi, '$1 kilograms'],
  // "50lb" → "50 pound" (singular when directly attached)
  [/(\d+)\s*lb\b/gi, '$1 pound'],
];

// ── Special term pronunciation ──────────────────────────────────────
const TERM_FIXES: [RegExp, string][] = [
  // "T-spine" → "T spine" (hyphen causes TTS to run words together)
  [/\bT-spine\b/gi, 'T spine'],
  // "single-arm" → "single arm"
  [/\bsingle-arm\b/gi, 'single arm'],
  [/\bsingle-leg\b/gi, 'single leg'],
  // "1-arm" → "one arm"
  [/\b1-arm\b/gi, 'one arm'],
  [/\b1-leg\b/gi, 'one leg'],
  [/\b2-arm\b/gi, 'two arm'],
  // "cable straight bar reverse grip curl press" — no fix needed, just TTS
  // Remove repeated consecutive words: "curl curl" → "curl"
];

/**
 * Normalize a movement name or instruction text for TTS.
 * Returns a clean string that OpenAI TTS will pronounce naturally.
 */
export function normalizeForSpeech(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';

  let text = raw.trim();

  // Strip parenthetical noise: "(each side)", "(per arm)" etc.
  text = text.replace(/\s*\([^)]*\)\s*/g, ' ');

  // Expand abbreviations
  for (const [pattern, replacement] of ABBREVIATIONS) {
    text = text.replace(pattern, replacement);
  }

  // Normalize weights/units
  for (const [pattern, replacement] of WEIGHT_PATTERNS) {
    text = text.replace(pattern, replacement);
  }

  // Fix special terms
  for (const [pattern, replacement] of TERM_FIXES) {
    text = text.replace(pattern, replacement);
  }

  // Replace hyphens between words with spaces (general)
  text = text.replace(/(\w)-(\w)/g, '$1 $2');

  // Remove repeated consecutive words (case-insensitive)
  text = text.replace(/\b(\w+)\s+\1\b/gi, '$1');

  // Collapse multiple spaces
  text = text.replace(/\s{2,}/g, ' ').trim();

  return text;
}

/**
 * Build a full spoken phrase for a movement, optionally including weight.
 * Example: "Incline chest fly, 50 pounds"
 */
export function buildMovementPhrase(
  name: string,
  weight?: string | number,
): string {
  const normalized = normalizeForSpeech(name);
  if (!normalized) return '';

  if (weight != null && weight !== '' && weight !== 0) {
    const w = typeof weight === 'number' ? `${weight} pounds` : normalizeForSpeech(String(weight));
    return `${normalized}, ${w}`;
  }

  return normalized;
}
