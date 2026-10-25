import * as admin from 'firebase-admin';
import { allocateVerifiedBotSession } from '../zoomBotAllocation';
import { botHostKey } from '../zoomBotReservation';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080')throw Error('Local emulator required');
jest.setTimeout(30000);
const app=admin.initializeApp({projectId:'demo-zoom-bot-allocation'},'bot-allocation'),db=app.firestore();
const email='bot@example.invalid',hostId=botHostKey(email);
let provider:any;
beforeEach(async()=>{
  for(const col of ['zoom_bot_hosts','zoom_bot_host_leases','zoom_bot_allocation_jobs','zoom_bot_pool_state','session_instances','session_video_receipts','zoom_rooms','zoom_bot_legacy_releases','zoom_bot_orphan_attempts']){
    const rows=await db.collection(col).get(),batch=db.batch();rows.docs.forEach(d=>batch.delete(d.ref));await batch.commit();
  }
  await db.doc('zoom_bot_hosts/'+hostId).set({email,providerUserId:'provider-user',poolId:'hmti',isBot:true,verified:true,reconciled:true,mappingVersion:1,roomId:"verified-room",legacyRoomIds:[],providerMode:'live',status:'active',maxConcurrentMeetings:1});
  await db.doc('zoom_rooms/verified-room').set({poolId:'hmti',status:'active',zoomAccountEmail:email,zoomUserId:'provider-user'});
  const now=Date.now();await db.doc('session_instances/test').set({coachId:'coach',memberId:'member',playbookId:'plan',roomSource:'shared_pool',status:'scheduled',startUtc:admin.firestore.Timestamp.fromMillis(now),endUtc:admin.firestore.Timestamp.fromMillis(now+2700000),recordingEnabled:true});
  provider={mode:'live',createMeeting:jest.fn(async()=>({meetingId:'synthetic-meeting',joinUrl:'https://example.invalid/join',hostEmail:email,recordingMode:'cloud',participantVideoOff:true}))};
});
afterAll(()=>app.delete());
test('concurrent retries make one provider request and persist session plus receipt',async()=>{
  await Promise.all([allocateVerifiedBotSession(db,provider,'test','coach'),allocateVerifiedBotSession(db,provider,'test','coach')]);
  expect(provider.createMeeting).toHaveBeenCalledTimes(1);
  expect((await db.doc('session_instances/test').get()).data()).toMatchObject({status:'allocated',zoomMeetingId:'synthetic-meeting'});
  expect((await db.doc('session_video_receipts/test').get()).data()).toMatchObject({recordingMode:'cloud',botHostId:hostId});
  expect((await allocateVerifiedBotSession(db,provider,'test','coach')).success).toBe(true);
});
test('ambiguous provider failure is quarantined, never retried',async()=>{
  provider.createMeeting.mockRejectedValue(new Error('timeout'));
  expect((await allocateVerifiedBotSession(db,provider,'test','coach')).pending).toBe(true);
  await allocateVerifiedBotSession(db,provider,'test','coach');expect(provider.createMeeting).toHaveBeenCalledTimes(1);
  expect((await db.doc('session_video_receipts/test').get()).exists).toBe(false);
});
test.each([{status:'cancelled'},{recordingEnabled:false},{memberId:'changed'}])('change during creation quarantines known meeting: %j',async patch=>{
  const response=await provider.createMeeting();provider.createMeeting.mockClear();
  provider.createMeeting.mockImplementation(async()=>{await db.doc('session_instances/test').update(patch);return response;});
  expect((await allocateVerifiedBotSession(db,provider,'test','coach')).success).toBe(false);
  expect((await db.doc('session_video_receipts/test').get()).exists).toBe(false);
  expect((await db.doc('zoom_bot_allocation_jobs/test').get()).data()).toMatchObject({state:'needs_reconciliation',meetingId:'synthetic-meeting'});
  await allocateVerifiedBotSession(db,provider,'test','coach').catch(()=>undefined);expect(provider.createMeeting).toHaveBeenCalledTimes(1);
});
test('receipt persistence failure cannot start a second provider attempt',async()=>{
  const run=db.runTransaction.bind(db);let count=0;
  const proxy=Object.create(db);proxy.runTransaction=(fn:any)=>run(async(tx:any)=>{
    count++;if(count===3){const set=tx.set.bind(tx);tx.set=(ref:any,...args:any[])=>{if(ref.path==='session_video_receipts/test')throw Error('injected receipt failure');return set(ref,...args);};}return fn(tx);
  });
  await expect(allocateVerifiedBotSession(proxy,provider,'test','coach')).rejects.toThrow('injected receipt failure');
  expect((await db.doc('session_instances/test').get()).data()?.status).toBe('scheduled');
  expect((await db.doc('session_video_receipts/test').get()).exists).toBe(false);
  expect((await allocateVerifiedBotSession(db,provider,'test','coach')).pending).toBe(true);
  expect(provider.createMeeting).toHaveBeenCalledTimes(1);
});
test('room mutation during provider creation quarantines meeting without attaching',async()=>{
  const response=await provider.createMeeting();provider.createMeeting.mockClear();provider.createMeeting.mockImplementation(async()=>{await db.doc('zoom_rooms/verified-room').update({status:'inactive'});return response;});
  expect((await allocateVerifiedBotSession(db,provider,'test','coach')).success).toBe(false);
  expect((await db.doc('session_video_receipts/test').get()).exists).toBe(false);
  expect((await db.doc('zoom_bot_allocation_jobs/test').get()).data()?.state).toBe('needs_reconciliation');
});
test('provider failure cannot overwrite a replacement attempt',async()=>{
  provider.createMeeting.mockImplementation(async()=>{await db.doc('zoom_bot_allocation_jobs/test').update({attemptId:'replacement',state:'reserved'});throw Error('ambiguous');});
  await allocateVerifiedBotSession(db,provider,'test','coach');
  expect((await db.doc('zoom_bot_allocation_jobs/test').get()).data()).toMatchObject({attemptId:'replacement',state:'reserved'});
});
test('existing completed job does not report success for a retargeted meeting',async()=>{
  await allocateVerifiedBotSession(db,provider,'test','coach');await db.doc('session_instances/test').update({zoomMeetingId:'changed'});
  expect((await allocateVerifiedBotSession(db,provider,'test','coach')).success).toBe(false);expect(provider.createMeeting).toHaveBeenCalledTimes(1);
});

test('stale successful provider response is recorded separately and cannot overwrite replacement attempt',async()=>{const response=await provider.createMeeting();provider.createMeeting.mockClear();provider.createMeeting.mockImplementation(async()=>{await db.doc('zoom_bot_allocation_jobs/test').update({attemptId:'replacement',state:'reserved'});return response;});expect((await allocateVerifiedBotSession(db,provider,'test','coach')).success).toBe(false);expect((await db.doc('zoom_bot_allocation_jobs/test').get()).data()).toMatchObject({attemptId:'replacement',state:'reserved'});const orphans=await db.collection('zoom_bot_orphan_attempts').get();expect(orphans.size).toBe(1);expect(orphans.docs[0].data()).toMatchObject({meetingId:'synthetic-meeting',reason:'attempt_replaced'});expect((await db.doc('session_video_receipts/test').get()).exists).toBe(false);});
