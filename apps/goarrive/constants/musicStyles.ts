// ── Workout music constants ─────────────────────────────────────────────────
// KEEP IN SYNC (manual): functions/src/index.ts MUSIC_STYLES — keys must match
// exactly; there is no shared module between the app and functions. The server
// rejects unknown style keys with invalid-argument, so drift fails loudly.

export const MUSIC_STYLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'workout', label: 'Workout' },
  { value: 'edm', label: 'EDM' },
  { value: 'hiphop', label: 'Hip-Hop' },
  { value: 'chill', label: 'Chill' },
  { value: 'rock', label: 'Rock' },
  { value: 'focus', label: 'Focus' },
  { value: 'pop', label: 'Pop' },
  { value: 'house', label: 'House' },
  { value: 'techno', label: 'Techno' },
  { value: 'trap', label: 'Trap' },
  { value: 'rnb', label: 'R&B' },
  { value: 'latin', label: 'Latin' },
  { value: 'country', label: 'Country' },
  { value: 'metal', label: 'Metal' },
  { value: 'funk', label: 'Funk' },
  { value: 'disco', label: 'Disco' },
  { value: 'afrobeats', label: 'Afrobeats' },
  { value: 'synthwave', label: 'Synthwave' },
];

export const MUSIC_VOLUME_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0.2, label: 'Quiet' },
  { value: 0.35, label: 'Soft' },
  { value: 0.55, label: 'Medium' },
  { value: 0.8, label: 'Loud' },
];

// Pooled tracks are fixed-length; the player chains them into a no-repeat
// playlist, so these must match the server's TRACK_DURATION_SECS /
// MAX_TRACKS_PER_STYLE.
export const MUSIC_TRACK_DURATION_SECS = 180;
export const MUSIC_MAX_TRACKS_PER_STYLE = 24;

export const musicStyleLabel = (value: string): string =>
  MUSIC_STYLE_OPTIONS.find((o) => o.value === value)?.label ?? value;
