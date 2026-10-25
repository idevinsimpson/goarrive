import {Firestore,FieldValue} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {ZoomProvider} from './zoom';
/** Read provider truth before releasing a known meeting hold. Unknown IDs never auto-release. */
export async function reconcileBotAttempt(db:Firestore,provider:ZoomProvider,auth:{uid:string;token:Record<string,any>},sessionId:string){
 if(auth.token.role!=='platformAdmin')throw new HttpsError('permission-denied','Platform admin role required');
 if(provider.mode!=='live'||!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId))throw new HttpsError('invalid-argument','Live provider and session required');
 const ref=db.doc(`zoom_bot_allocation_jobs/${sessionId}`),job=(await ref.get()).data();
 if(!job)return {state:'no_attempt'};
 if(!job.meetingId)return {state:'manual_reconciliation_required',reason:'Provider outcome has no verified meeting identifier'};
 const meeting=await provider.getMeeting(job.meetingId);
 if(meeting)return {state:'meeting_still_exists'};
 await db.runTransaction(async tx=>{
  const sessionRef=db.doc(`session_instances/${sessionId}`),leaseRef=job.hostId?db.doc(`zoom_bot_host_leases/${job.hostId}`):null;
  const [fresh,session,lease]=await Promise.all([tx.get(ref),tx.get(sessionRef),leaseRef?tx.get(leaseRef):Promise.resolve(null)]);
  const current=fresh.data(),s=session.data();
  if(current?.attemptId!==job.attemptId||current?.mutationAttemptId!==job.mutationAttemptId||current?.meetingId!==job.meetingId)throw new HttpsError('aborted','Attempt changed during reconciliation');
  // Do not redirect or clear another meeting or another owner's session.
  if(!s||s.coachId!==job.coachId||s.memberId!==job.memberId||(s.zoomMeetingId&&s.zoomMeetingId!==job.meetingId))throw new HttpsError('failed-precondition','Session identity changed');
  tx.set(db.doc(`zoom_bot_allocation_history/${job.attemptId}`),{...current,state:'provider_absent',reconciledAt:FieldValue.serverTimestamp()});
  if(leaseRef)tx.update(leaseRef,{windows:(lease?.data()?.windows||[]).map((w:any)=>w.attemptId===job.attemptId?{...w,released:true}:w)});
  if(job.pendingReservationId&&job.pendingReservationId!==s.reservationId)tx.delete(db.doc(`member_time_reservations/${job.pendingReservationId}`));
  if(s.zoomMeetingId===job.meetingId)tx.update(sessionRef,{...(!['cancelled','completed'].includes(s.status)?{status:'allocation_failed'}:{}),zoomMeetingId:FieldValue.delete(),zoomMeetingUuid:FieldValue.delete(),zoomJoinUrl:FieldValue.delete(),zoomMeetingPassword:FieldValue.delete(),zoomStartUrl:FieldValue.delete(),zoomRoomId:FieldValue.delete(),updatedAt:FieldValue.serverTimestamp()});
  tx.delete(db.doc(`session_video_receipts/${sessionId}`));tx.delete(ref);
 });
 return {state:'provider_absent_hold_released'};
}
