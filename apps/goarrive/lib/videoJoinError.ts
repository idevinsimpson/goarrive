export type VideoJoinStage = 'access' | 'download' | 'initialize' | 'join';
/** Only a bounded numeric SDK code is shown; provider messages may contain private data. */
export function videoJoinError(stage: VideoJoinStage, error: unknown): string {
  const value = error && typeof error === 'object' ? (error as { errorCode?: unknown; code?: unknown }) : {};
  const candidate = value.errorCode ?? value.code;
  const code = (typeof candidate === 'number' && Number.isSafeInteger(candidate)) ||
    (typeof candidate === 'string' && /^-?\d{1,9}$/.test(candidate)) ? String(candidate) : '';
  const label = { access: 'checking access', download: 'loading Zoom', initialize: 'starting Zoom', join: 'joining Zoom' }[stage];
  return `Video could not connect while ${label}${code ? ` (code ${code})` : ''}. Retry or continue your workout.`;
}
