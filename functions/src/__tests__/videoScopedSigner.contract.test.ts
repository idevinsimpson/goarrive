import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
import { HttpsError } from 'firebase-functions/v2/https';
import { videoRolloutDecision } from '../videoTestScope';
const base = 1000000, auth = { uid: 'uid', token: { role: 'member' } };
function handler() {
  let now = base, releaseIdentity!: () => void;
  const identity = new Promise<void>(resolve => { releaseIdentity = resolve; });
  const sign = jest.fn(() => 'synthetic-signature'), admission = jest.fn(async (_id: string, caller: any, at: number) => ({ enabled: videoRolloutDecision(caller, at).enabled, reason: 'Test window ended' }));
  const instance = { memberId: 'uid', coachId: 'coach', status: 'allocated', zoomMeetingId: 'synthetic-meeting', zoomJoinUrl: 'https://example.invalid', zoomMeetingPassword: 'synthetic' };
  const source = fs.readFileSync(path.resolve(__dirname, '../index.ts'), 'utf8'), sf = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
  const statement = sf.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === 'getEmbeddedSessionJoinConfig'))!;
  const js = ts.transpileModule(statement.getText(sf), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const scope: any = { exports: {}, onCall: (_options: any, run: any) => run, HttpsError, Date: { now: () => now }, ownsSessionMember: (uid: string, _token: any, value: any) => uid === value.memberId,
    sessionVideoAvailability: admission, buildMeetingSdkSignature: sign, zoomMeetingSdkKey: { value: () => 'synthetic-key' }, zoomMeetingSdkSecret: { value: () => 'synthetic-secret' },
    db: { collection: (name: string) => ({ doc: () => ({ get: async () => { if (name === 'users') await identity; return { exists: true, data: () => name === 'session_instances' ? instance : { displayName: 'Synthetic' } }; } }) }) } };
  vm.runInNewContext(js, scope);
  return { run: (purpose?: string) => scope.exports.getEmbeddedSessionJoinConfig({ auth, data: { sessionInstanceId: 'session', ...(purpose ? { purpose } : {}) } }), release: (at: number) => { now = at; releaseIdentity(); }, sign, admission };
}
beforeEach(() => { process.env.WORKOUT_VIDEO_ROLLOUT_ENABLED = 'false'; process.env.WORKOUT_VIDEO_TEST_SCOPE = JSON.stringify({ sessionId: 'session', memberUid: 'uid', memberId: 'roster', coachId: 'coach', playbookId: 'plan', workoutId: 'workout', startsAt: base, expiresAt: base + 1000 }); });
afterEach(() => { delete process.env.WORKOUT_VIDEO_TEST_SCOPE; delete process.env.WORKOUT_VIDEO_ROLLOUT_ENABLED; });
test('actual signer handler rejects deferred identity lookup crossing scope expiry', async () => {
  const h = handler(), result = h.run('workout_video'); await Promise.resolve(); h.release(base + 1001);
  await expect(result).rejects.toMatchObject({ code: 'failed-precondition' }); expect(h.admission).toHaveBeenCalledWith('session', auth, base + 1001, expect.any(Object)); expect(h.sign).not.toHaveBeenCalled();
});
test('actual signer handler admits valid scope only after identity completes', async () => {
  const h = handler(), result = h.run('workout_video'); await Promise.resolve(); expect(h.admission).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled(); h.release(base + 100);
  expect(await result).toMatchObject({ signature: 'synthetic-signature', role: 0, zak: null }); expect(h.sign).toHaveBeenCalledTimes(1);
});
test('omitted-purpose legacy signer retains its existing path', async () => {
  const h = handler(), result = h.run(); await Promise.resolve(); h.release(base + 5000);
  expect(await result).toMatchObject({ signature: 'synthetic-signature', role: 0 }); expect(h.admission).not.toHaveBeenCalled();
});
