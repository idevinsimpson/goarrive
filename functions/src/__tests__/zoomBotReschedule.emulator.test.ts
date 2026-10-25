import * as admin from 'firebase-admin';
import {beginBotSessionMutation,confirmBotMeetingDeleted,applyBotSessionUpdate,finishBotSessionMutation} from '../zoomBotMutation';
import {prepareBotRescheduleReservation} from '../playbookScheduling';
import {reconcileBotAttempt} from '../zoomBotReconciliation';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080')throw Error('Local emulator required');
jest.setTimeout(30000);
admin.initializeApp({projectId:'demo-bot-reschedule'});const db=admin.firestore();
let original:any;
beforeEach(async()=>{
 for(const c of ['session_instances','member_time_reservations','zoom_bot_allocation_jobs','zoom_bot_host_leases','zoom_bot_allocation_history','session_video_receipts']){const docs=await db.collection(c).get();const b=db.batch();docs.docs.forEach(d=>b.delete(d.ref));await b.commit();}
 original={coachId:'coach',memberId:'member',memberKey:'member',playbookId:'plan',status:'allocated',roomSource:'shared_pool',recordingEnabled:true,zoomMeetingId:'old-meeting',zoomRoomId:'room',timezone:'America/New_York',durationMinutes:45,scheduledDate:'2026-10-30',reservationId:'old',startUtc:admin.firestore.Timestamp.fromDate(new Date('2026-10-30T12:00:00Z')),endUtc:admin.firestore.Timestamp.fromDate(new Date('2026-10-30T12:45:00Z'))};
 await db.doc('session_instances/s').set(original);await db.doc('member_time_reservations/old').set({memberKey:'member',sessionInstanceId:'s',startUtc:original.startUtc,endUtc:original.endUtc});
 await db.doc('zoom_bot_allocation_jobs/s').set({state:'completed',attemptId:'allocation',meetingId:'old-meeting',roomId:'room',hostId:'host',coachId:'coach',memberId:'member'});
 await db.doc('zoom_bot_host_leases/host').set({windows:[{sessionId:'s',attemptId:'allocation'}]});
});
afterAll(()=>admin.app().delete());
test('reschedule holds old and new slots until verified deletion and atomic session update',async()=>{
 const attempt=(await beginBotSessionMutation(db,'s',{uid:'coach',token:{}}))!;
 const proposed=await prepareBotRescheduleReservation('s',original,'2026-11-01','01:30',attempt);
 expect((await db.doc('member_time_reservations/old').get()).exists).toBe(true);expect((await db.doc('member_time_reservations/'+proposed.reservationId).get()).exists).toBe(true);
 await confirmBotMeetingDeleted(db,'s',attempt,'old-meeting');await applyBotSessionUpdate(db,'s',attempt,{status:'scheduled',reservationId:proposed.reservationId,startUtc:admin.firestore.Timestamp.fromDate(proposed.startUtc),endUtc:admin.firestore.Timestamp.fromDate(proposed.endUtc),zoomMeetingId:admin.firestore.FieldValue.delete()});await finishBotSessionMutation(db,'s',attempt);
 expect((await db.doc('member_time_reservations/old').get()).exists).toBe(false);expect((await db.doc('session_instances/s').get()).data()?.startUtc.toMillis()).toBe(proposed.startUtc.getTime());expect(proposed.endUtc.getTime()-proposed.startUtc.getTime()).toBe(2700000);
});
test('unknown deletion keeps both slots and reconciliation does not release an existing meeting',async()=>{
 const attempt=(await beginBotSessionMutation(db,'s',{uid:'coach',token:{}}))!;const proposed=await prepareBotRescheduleReservation('s',original,'2026-11-01','01:30',attempt);await finishBotSessionMutation(db,'s',attempt,true);
 const provider:any={mode:'live',getMeeting:jest.fn(async()=>({meetingId:'old-meeting'}))};expect(await reconcileBotAttempt(db,provider,{uid:'admin',token:{role:'platformAdmin'}},'s')).toEqual({state:'meeting_still_exists'});
 expect((await db.doc('member_time_reservations/old').get()).exists).toBe(true);expect((await db.doc('member_time_reservations/'+proposed.reservationId).get()).exists).toBe(true);
 provider.getMeeting.mockResolvedValue(null);await reconcileBotAttempt(db,provider,{uid:'admin',token:{role:'platformAdmin'}},'s');
 expect((await db.doc('member_time_reservations/old').get()).exists).toBe(true);expect((await db.doc('member_time_reservations/'+proposed.reservationId).get()).exists).toBe(false);expect((await db.doc('zoom_bot_host_leases/host').get()).data()?.windows[0].released).toBe(true);
});
test('no verified meeting ID is never guessed or released',async()=>{
 await db.doc('zoom_bot_allocation_jobs/s').update({state:'needs_reconciliation',meetingId:admin.firestore.FieldValue.delete()});const getMeeting=jest.fn();expect(await reconcileBotAttempt(db,{mode:'live',getMeeting} as any,{uid:'admin',token:{role:'platformAdmin'}},'s')).toMatchObject({state:'manual_reconciliation_required'});expect(getMeeting).not.toHaveBeenCalled();
});
