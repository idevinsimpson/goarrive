import * as admin from 'firebase-admin';
import {beginBotSessionMutation,finishBotSessionMutation} from '../zoomBotMutation';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080')throw Error('Local emulator required');
jest.setTimeout(30000);
const app=admin.initializeApp({projectId:'demo-bot-mutation'},'bot-mutation'),db=app.firestore();
beforeEach(async()=>{for(const c of ['session_instances','zoom_bot_allocation_jobs']){const rows=await db.collection(c).get(),b=db.batch();rows.docs.forEach(d=>b.delete(d.ref));await b.commit();}await db.doc('session_instances/s').set({coachId:'coach',memberId:'member',playbookId:'plan',status:'allocated',roomSource:'shared_pool',recordingEnabled:true});});
afterAll(()=>app.delete());
test('managed allocation rejects mutation before any session or job change',async()=>{const ref=db.doc('zoom_bot_allocation_jobs/s');await ref.set({state:'provider_started',attemptId:'original'});await expect(beginBotSessionMutation(db,'s',{uid:'coach',token:{}})).rejects.toMatchObject({code:'failed-precondition'});expect((await ref.get()).data()).toEqual({state:'provider_started',attemptId:'original'});expect((await db.doc('session_instances/s').get()).data()?.status).toBe('allocated');});
test('concurrent edits acquire only one mutation lock',async()=>{const result=await Promise.allSettled([beginBotSessionMutation(db,'s',{uid:'coach',token:{}}),beginBotSessionMutation(db,'s',{uid:'coach',token:{}})]);expect(result.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(result.filter(x=>x.status==='rejected')).toHaveLength(1);});
test('uncertain provider deletion retains the hold through final cleanup',async()=>{const id=await beginBotSessionMutation(db,'s',{uid:'coach',token:{}});await finishBotSessionMutation(db,'s',id,true);await finishBotSessionMutation(db,'s',id);expect((await db.doc('zoom_bot_allocation_jobs/s').get()).data()).toMatchObject({attemptId:id,state:'needs_reconciliation'});});
test('safe completion releases only its own lock',async()=>{const id=await beginBotSessionMutation(db,'s',{uid:'coach',token:{}});await finishBotSessionMutation(db,'s',id);expect((await db.doc('zoom_bot_allocation_jobs/s').get()).exists).toBe(false);});
test('stale cleanup cannot delete a replacement lock',async()=>{const id=await beginBotSessionMutation(db,'s',{uid:'coach',token:{}});await db.doc('zoom_bot_allocation_jobs/s').update({attemptId:'replacement'});await finishBotSessionMutation(db,'s',id);expect((await db.doc('zoom_bot_allocation_jobs/s').get()).data()?.attemptId).toBe('replacement');});
test('wrong account cannot create a mutation lock',async()=>{await expect(beginBotSessionMutation(db,'s',{uid:'other',token:{}})).rejects.toMatchObject({code:'permission-denied'});expect((await db.doc('zoom_bot_allocation_jobs/s').get()).exists).toBe(false);});

test('completed managed allocation can be cancelled only after verified provider deletion',async()=>{
 const {confirmBotMeetingDeleted,applyBotSessionUpdate}=await import('../zoomBotMutation');
 await db.doc('session_instances/s').update({zoomMeetingId:'meeting',zoomRoomId:'room'});
 await db.doc('zoom_bot_allocation_jobs/s').set({state:'completed',attemptId:'allocation',meetingId:'meeting',roomId:'room',hostId:'host',coachId:'coach',memberId:'member'});
 await db.doc('zoom_bot_host_leases/host').set({windows:[{sessionId:'s',attemptId:'allocation',unresolved:false}]});
 const mutation=await beginBotSessionMutation(db,'s',{uid:'coach',token:{}});
 await expect(applyBotSessionUpdate(db,'s',mutation!,{status:'cancelled'})).rejects.toMatchObject({code:'failed-precondition'});
 await confirmBotMeetingDeleted(db,'s',mutation,'meeting');await applyBotSessionUpdate(db,'s',mutation!,{status:'cancelled'});await finishBotSessionMutation(db,'s',mutation);
 expect((await db.doc('session_instances/s').get()).data()?.status).toBe('cancelled');expect((await db.doc('zoom_bot_host_leases/host').get()).data()?.windows[0].released).toBe(true);expect((await db.doc('zoom_bot_allocation_jobs/s').get()).exists).toBe(false);
});
test('known pre-operation failure restores completed job without releasing its occupancy',async()=>{
 await db.doc('session_instances/s').update({zoomMeetingId:'meeting',zoomRoomId:'room'});
 await db.doc('zoom_bot_allocation_jobs/s').set({state:'completed',attemptId:'allocation',meetingId:'meeting',roomId:'room',hostId:'host',coachId:'coach',memberId:'member'});
 const mutation=await beginBotSessionMutation(db,'s',{uid:'coach',token:{}});await finishBotSessionMutation(db,'s',mutation);
 expect((await db.doc('zoom_bot_allocation_jobs/s').get()).data()?.state).toBe('completed');
});
