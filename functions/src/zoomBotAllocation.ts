import {refreshBotInventories} from './zoomBotRegistry';
import { createBotReminderJobs } from './zoomBotReminders';
import { FieldValue, Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { ZoomProvider } from './zoom';
import { reserveBotHost, beginBotMeeting } from './zoomBotReservation';
export async function allocateVerifiedBotSession(db: Firestore, provider: ZoomProvider, sessionId: string, coachId: string) {
  if (provider.mode !== 'live') throw new HttpsError('failed-precondition', 'Verified bot allocation requires a live provider');
  if(typeof (provider as any).inspectHostOccupancy!=='function')throw new HttpsError('failed-precondition','Provider inventory is required');
  await refreshBotInventories(db,provider as any);
  const reservation = await reserveBotHost(db, sessionId, coachId);
  const jobRef = db.doc(`zoom_bot_allocation_jobs/${sessionId}`);
  if (!reservation.create) {
    const success=await db.runTransaction(async tx=>{const [j,s,r]=await Promise.all([tx.get(jobRef),tx.get(db.doc(`session_instances/${sessionId}`)),tx.get(db.doc(`session_video_receipts/${sessionId}`))]);const job=j.data(),current=s.data(),receipt=r.data();return !!(job?.attemptId===reservation.attemptId&&job.state==='completed'&&current&&['allocated','in_progress','completed'].includes(current.status)&&current.coachId===coachId&&current.memberId===job.memberId&&(current.playbookId||null)===job.playbookId&&current.startUtc?.toMillis?.()===job.startMs&&current.endUtc?.toMillis?.()===job.endMs&&current.zoomMeetingId===job.meetingId&&current.zoomRoomId===job.roomId&&receipt?.meetingId===job.meetingId&&receipt?.roomId===job.roomId);});
    return { success, pending: !success, reason: 'Existing allocation attempt; no new provider request', providerMode: provider.mode };
  }
  const job=await beginBotMeeting(db,reservation);
  if (!job) return { success:false, pending:true, reason:'Session or host changed; reconcile reservation', providerMode:provider.mode };
  if (Date.now() >= job.endMs) return {success:false,pending:true,reason:'Allocation window ended; reconcile reservation',providerMode:provider.mode};
  let meeting;
  try {
    meeting=await provider.createMeeting({topic:'GoArrive workout session',startTime:new Date(job.startMs).toISOString(),duration:(job.endMs-job.startMs)/60000,timezone:'UTC',hostEmail:reservation.hostEmail,autoRecording:job.recordingEnabled?'cloud':'none'});
  } catch {
    // A timeout/error may follow provider creation. Never retry another host automatically.
    await db.runTransaction(async tx=>{const current=(await tx.get(jobRef)).data();if(current?.attemptId===reservation.attemptId&&current?.state==='provider_started')tx.update(jobRef,{state:'needs_reconciliation',failure:'provider_outcome_unknown'});});
    return {success:false,pending:true,reason:'Provider outcome uncertain; reconcile before retry',providerMode:provider.mode};
  }
  const expectedMode=job.recordingEnabled?'cloud':'none';
  const finalized=await db.runTransaction(async tx=>{
    const sessionRef=db.doc(`session_instances/${sessionId}`);
    const leaseRef=db.doc(`zoom_bot_host_leases/${reservation.hostId}`);
    const [currentJob,sessionDoc,hostDoc,roomDoc,leaseDoc]=await Promise.all([tx.get(jobRef),tx.get(sessionRef),tx.get(db.doc(`zoom_bot_hosts/${reservation.hostId}`)),tx.get(db.doc(`zoom_rooms/${job.roomId}`)),tx.get(leaseRef)]);
    if(currentJob.data()?.attemptId!==reservation.attemptId||currentJob.data()?.state!=='provider_started'){tx.set(db.doc(`zoom_bot_orphan_attempts/${reservation.attemptId}`),{sessionId,hostId:reservation.hostId,meetingId:meeting.meetingId,reason:'attempt_replaced',observedAt:FieldValue.serverTimestamp()});return false;}
    const s=sessionDoc.data(),h=hostDoc.data();
    const valid=currentJob.data()?.attemptId===reservation.attemptId&&currentJob.data()?.state==='provider_started'&&s&&h&&h.roomId===job.roomId&&h.mappingVersion===job.mappingVersion&&roomDoc.updateTime?.toMillis()===job.roomVersionMs&&h.verified===true&&h.reconciled===true&&h.poolId==='hmti'&&h.isBot===true&&h.providerMode==='live'&&h.email===reservation.hostEmail&&h.status==='active'&&job.endMs>Date.now()&&h.providerUserId===reservation.providerUserId&&
      s.coachId===coachId&&s.memberId===job.memberId&&(s.playbookId||null)===job.playbookId&&s.roomSource==='shared_pool'&&['scheduled','allocation_failed'].includes(s.status)&&s.startUtc?.toMillis?.()===job.startMs&&s.endUtc?.toMillis?.()===job.endMs&&(s.recordingEnabled===true)===job.recordingEnabled&&
      meeting.recordingMode===expectedMode&&meeting.participantVideoOff===true&&meeting.hostEmail?.toLowerCase()===reservation.hostEmail&&typeof h.roomId==='string'&&h.roomId.length>0;
    if(!valid){tx.update(jobRef,{state:'needs_reconciliation',meetingId:meeting.meetingId,failure:'post_creation_state_changed'});return false;}
    tx.update(sessionRef,{status:'allocated',zoomRoomId:h.roomId,zoomRoomLabel:'Workout video',zoomMeetingId:meeting.meetingId,zoomMeetingUuid:meeting.uuid||null,zoomJoinUrl:meeting.joinUrl,zoomMeetingPassword:meeting.password||'',zoomProviderMode:'live',zoomStartUrl:FieldValue.delete(),allocatedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
    tx.set(db.doc(`session_video_receipts/${sessionId}`),{coachId,memberId:job.memberId,playbookId:job.playbookId,roomId:h.roomId,meetingId:meeting.meetingId,providerMode:'live',participantVideoOff:true,recordingMode:meeting.recordingMode,startMs:job.startMs,endMs:job.endMs,botHostId:reservation.hostId,observedAt:FieldValue.serverTimestamp()});
    createBotReminderJobs(tx,db,sessionId,reservation.attemptId,s,meeting.joinUrl);
    tx.update(jobRef,{state:'completed',meetingId:meeting.meetingId});
    tx.update(leaseRef,{windows:(leaseDoc.data()?.windows||[]).map((w:any)=>w.sessionId===sessionId&&w.attemptId===reservation.attemptId?{...w,unresolved:false}:w)});return true;
  }).catch(async error=>{
    // Preserve a known provider result even if the atomic session/receipt commit failed.
    await db.runTransaction(async tx=>{const current=(await tx.get(jobRef)).data();if(current?.attemptId===reservation.attemptId&&current.state==='provider_started')tx.update(jobRef,{state:'needs_reconciliation',meetingId:meeting.meetingId,failure:'allocation_commit_failed'});});
    throw error;
  });
  return {success:finalized,pending:!finalized,reason:finalized?'':'Meeting exists; reconciliation required',providerMode:provider.mode};
}
