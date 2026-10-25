import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import vm from 'vm';
import { saveVideoReceipt } from '../videoAllocationReceipt';
const source = ts.createSourceFile('index.ts', fs.readFileSync(path.resolve(__dirname, '../index.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
function harness(name: string, eventFailure = false, botEnabled = false, botCount = 1) {
  const session: any = { coachId: 'coach', memberId: 'member', playbookId: 'plan', status: 'scheduled', scheduledDate: '2026-11-01', scheduledStartTime: '12:00', scheduledEndTime: '12:45', durationMinutes: 45, recordingEnabled: false, roomSource: botEnabled ? 'shared_pool' : 'coach_personal' };
  const meeting = jest.fn(async () => ({ meetingId: 'one-meeting', joinUrl: 'https://example.invalid/join', password: 'synthetic', recordingMode: 'none' }));
  const receipt = jest.fn(async () => { throw Error('injected receipt failure'); });
  const rooms = ['first', 'second'].map(id => ({ id, data: () => ({ coachId: 'coach', status: 'active', label: id, zoomAccountEmail: 'synthetic@example.invalid' }) }));
  const db = { collection: (collection: string) => {
    const filters: any[] = []; const query: any = {
      doc: (id: string) => ({ id, get: async () => ({ exists: true, data: () => session }), update: async (data: any) => { if (collection === 'session_instances') Object.assign(session, data); }, set: receipt }),
      where: (field: string, op: string, value: any) => { filters.push([field, op, value]); return query; },
      get: async () => { const docs = collection === 'zoom_rooms' ? rooms : filters.every(([f, op, v]) => op === 'in' ? v.includes(session[f]) : session[f] === v) ? Array.from({length:botCount},(_,i)=>({id:i?'session'+i:'session',data:()=>({...session})})) : []; return { docs, empty: docs.length === 0, size: docs.length }; },
    }; return query;
  } };
  let declaration = '';
  source.forEachChild(node => { if (ts.isVariableStatement(node)) for (const d of node.declarationList.declarations) if (d.name.getText(source) === name) declaration = `const ${d.getText(source)}; globalThis.invoke = ${name};`; });
  const registered = jest.fn(async()=>false);
  const botAllocate = jest.fn(async()=>({success:true}));
  const context: any = { createFencedLegacyMeeting: (_db:any,provider:any,input:any)=>provider.createMeeting(input), isRegisteredBotRoom: registered, process: {env: {ZOOM_VERIFIED_BOT_POOL_ENABLED: botEnabled ? 'true' : 'false'}}, allocateVerifiedBotSession: botAllocate, db, saveVideoReceipt, console: { log() {}, warn() {} }, onCall: (_: any, fn: any) => fn, getZoomProvider: () => ({ mode: 'live', createMeeting: meeting }), FieldValue: { delete: () => 'deleted', serverTimestamp: () => 0 }, HttpsError: class extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; } }, writeSessionEvent: async () => { if (eventFailure) throw Error('injected event failure'); }, writeAuditLog: async () => {}, createRemindersForInstance: async () => {} };
  for (const key of ['zoomAccountId','zoomClientId','zoomClientSecret','emailApiKey','twilioAccountSid','twilioAuthToken','twilioFromNumber']) context[key] = { value: () => 'synthetic' };
  vm.createContext(context); vm.runInContext(ts.transpile(declaration, { target: ts.ScriptTarget.ES2020 }), context);
  return { invoke: () => context.invoke({ auth: { uid: 'coach' }, data: { instanceId: 'session' } }), session, meeting, receipt, botAllocate, registered };
}
test.each(['allocateSessionInstance', 'allocateAllPendingInstances'])('%s preserves allocation on receipt failure without creating another room/meeting', async name => {
  const h = harness(name); await h.invoke(); expect(h.session.status).toBe('allocated'); expect(h.meeting).toHaveBeenCalledTimes(1); expect(h.receipt).toHaveBeenCalledTimes(1);
  if (name === 'allocateSessionInstance') await expect(h.invoke()).rejects.toMatchObject({ code: 'failed-precondition' }); else expect(await h.invoke()).toMatchObject({ allocated: 0 });
  expect(h.meeting).toHaveBeenCalledTimes(1);
});
test('batch post-creation event failure never tries another room or marks allocated session failed', async () => {
  const h = harness('allocateAllPendingInstances', true); await expect(h.invoke()).rejects.toMatchObject({ code: 'unavailable' }); expect(h.session.status).toBe('allocated'); expect(h.meeting).toHaveBeenCalledTimes(1);
});

test.each(['allocateSessionInstance','allocateAllPendingInstances'])('%s uses the same verified shared-pool allocator only with explicit gate',async name=>{const h=harness(name,false,true);await h.invoke();expect(h.botAllocate).toHaveBeenCalledTimes(1);expect(h.botAllocate).toHaveBeenCalledWith(expect.anything(),expect.anything(),'session','coach');expect(h.meeting).not.toHaveBeenCalled();});

test('batch preserves successes around a failed bot attempt and continues',async()=>{const h=harness('allocateAllPendingInstances',false,true,3);h.botAllocate.mockResolvedValueOnce({success:true}).mockRejectedValueOnce(new Error('synthetic failure')).mockResolvedValueOnce({success:true});await expect(h.invoke()).resolves.toMatchObject({success:false,allocated:2,failed:1,total:3});expect(h.botAllocate).toHaveBeenCalledTimes(3);expect(h.meeting).not.toHaveBeenCalled();});

test.each(['allocateSessionInstance','allocateAllPendingInstances'])('%s does not create through any registered legacy alias',async name=>{const h=harness(name);h.registered.mockResolvedValue(true);await h.invoke();expect(h.meeting).not.toHaveBeenCalled();expect(h.registered).toHaveBeenCalled();});
