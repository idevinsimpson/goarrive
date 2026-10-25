/** Optional server-only acceptance scope. Empty/malformed/expired configuration
 * fails closed, even if the general rollout flag was accidentally enabled.
 * These identifiers are restrictions, not credentials or host authority. */
export type VideoAuth = { uid: string; token: Record<string, any> };
export type VideoTestScope = { sessionId: string; memberUid: string; memberId: string; coachId: string; playbookId: string; workoutId: string; startsAt: number; expiresAt: number; recordingMode?: 'none' | 'cloud' };
export type VideoRolloutDecision = { enabled: boolean; scope?: VideoTestScope };
export function videoRolloutDecision(auth: VideoAuth, now = Date.now()): VideoRolloutDecision {
  const raw = process.env.WORKOUT_VIDEO_TEST_SCOPE;
  if (raw === undefined) return { enabled: process.env.WORKOUT_VIDEO_ROLLOUT_ENABLED === 'true' };
  try {
    if (raw.length > 2048) return { enabled: false };
    const s = JSON.parse(raw) as VideoTestScope;
    const ids = ['sessionId', 'memberUid', 'memberId', 'coachId', 'playbookId', 'workoutId'] as const;
    if (!s || typeof s !== 'object' || Array.isArray(s) || Object.keys(s).sort().join(',') !== [...ids, 'startsAt', 'expiresAt', ...(s.recordingMode === undefined ? [] : ['recordingMode'])].sort().join(',') ||
      (s.recordingMode !== undefined && !['none', 'cloud'].includes(s.recordingMode)) ||
      ids.some(k => typeof s[k] !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(s[k])) ||
      !Number.isSafeInteger(s.startsAt) || !Number.isSafeInteger(s.expiresAt) || s.expiresAt <= s.startsAt ||
      s.expiresAt - s.startsAt > 2 * 60 * 60 * 1000 || !Number.isFinite(now) || now < s.startsAt || now >= s.expiresAt) return { enabled: false };
    const actor = (auth.uid === s.memberUid && auth.token.role === 'member') || (auth.uid === s.coachId && ['coach', 'platformAdmin'].includes(auth.token.role));
    return actor ? { enabled: true, scope: s } : { enabled: false };
  } catch { return { enabled: false }; }
}
export function videoPolicyInScope(decision: VideoRolloutDecision, auth: VideoAuth, kind: unknown, id: unknown): boolean {
  if (!decision.enabled) return false;
  if (!decision.scope) return true;
  const s = decision.scope;
  return auth.uid === s.coachId && ['coach', 'platformAdmin'].includes(auth.token.role) &&
    ((kind === 'playbook' && id === s.playbookId) || (kind === 'workout' && id === s.workoutId));
}

/** UI routing only, never an admission grant. Keep the consent path selected
 * after expiry so an expired recorded test cannot fall back to the legacy tile. */
export function isRecordedTestRoute(auth: VideoAuth, sessionId: unknown): boolean {
  try {
    const raw = JSON.parse(process.env.WORKOUT_VIDEO_TEST_SCOPE || 'null');
    if (!raw || raw.recordingMode !== 'cloud' || raw.sessionId !== sessionId) return false;
    const decision = videoRolloutDecision(auth, raw.startsAt);
    return decision.enabled && decision.scope?.recordingMode === 'cloud';
  } catch { return false; }
}
