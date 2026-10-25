import { FieldValue, Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { ZoomProvider } from './zoom';
import { reserveBotHost, beginBotMeeting } from './zoomBotReservation';
export async function allocateVerifiedBotSession(db: Firestore, provider: ZoomProvider, sessionId: string, coachId: string) {
  if (provider.mode !== 'live') throw new HttpsError('failed-precondition', 'Verified bot allocation requires a live provider');
  const reservation = await reserveBotHost(db, sessionId, coachId);
  const jobRef = db.doc(`zoom_bot_allocation_jobs/${sessionId}`);
  if (!reservation.create) {
    const job=(await jobRef.get()).data();
    return { success: job?.state === 'completed', pending: job?.state !== 'completed', reason: 'Existing allocation attempt; no new provider request', providerMode: provider.mode };
  }
  if (!await beginBotMeeting(db, reservation)) return { success:false, pending:true, reason:'Session or host changed; reconcile reservation', providerMode:provider.mode };
  const job=(await jobRef.get()).data()!;
  let meeting;
  try {
    meeting=await provider.createMeeting({topic:'GoArrive workout session',startTime:new Date(job.startMs).toISOString(),duration:(job.endMs-job.startMs)/60000,timezone:'UTC',hostEmail:reservation.hostEmail,autoRecording:job.recordingEnabled?'cloud':'none'});
  } catch {
    // A timeout/error may follow provider creation. Never retry another host automatically.
    await jobRef.update({state:'needs_reconciliation',failure:'provider_outcome_unknown'});
    return {success:false,pending:true,reason:'Provider outcome uncertain; reconcile before retry',providerMode:provider.mode};
  }
  const expectedMode=job.recordingEnabled?'cloud':'none';
  const finalized=await db.runTransaction(async tx=>{
    const sessionRef=db.doc(`session_instances/${sessionId}`);
    const [currentJob,sessionDoc,hostDoc]=await Promise.all([tx.get(jobRef),tx.get(sessionRef),tx.get(db.doc(`zoom_bot_hosts/${reservation.hostId}`))]);
    const s=sessionDoc.data(),h=hostDoc.data();
    const valid=currentJob.data()?.attemptId===reservation.attemptId&&currentJob.data()?.state==='provider_started'&&s&&h&&h.verified===true&&h.reconciled===true&&h.poolId==='hmti'&&h.isBot===true&&h.providerMode==='live'&&h.email===reservation.hostEmail&&h.status==='active'&&job.endMs>Date.now()&&h.providerUserId===reservation.providerUserId&&
      s.coachId===coachId&&s.memberId===job.memberId&&(s.playbookId||null)===job.playbookId&&s.roomSource==='shared_pool'&&['scheduled','allocation_failed'].includes(s.status)&&s.startUtc?.toMillis?.()===job.startMs&&s.endUtc?.toMillis?.()===job.endMs&&(s.recordingEnabled===true)===job.recordingEnabled&&
      meeting.recordingMode===expectedMode&&meeting.participantVideoOff===true&&meeting.hostEmail?.toLowerCase()===reservation.hostEmail&&typeof h.roomId==='string'&&h.roomId.length>0;
    if(!valid){tx.update(jobRef,{state:'needs_reconciliation',meetingId:meeting.meetingId,failure:'post_creation_state_changed'});return false;}
    tx.update(sessionRef,{status:'allocated',zoomRoomId:h.roomId,zoomRoomLabel:'Workout video',zoomMeetingId:meeting.meetingId,zoomMeetingUuid:meeting.uuid||null,zoomJoinUrl:meeting.joinUrl,zoomMeetingPassword:meeting.password||'',zoomProviderMode:'live',zoomStartUrl:FieldValue.delete(),allocatedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
    tx.set(db.doc(`session_video_receipts/${sessionId}`),{coachId,memberId:job.memberId,playbookId:job.playbookId,roomId:h.roomId,meetingId:meeting.meetingId,providerMode:'live',participantVideoOff:true,recordingMode:meeting.recordingMode,startMs:job.startMs,endMs:job.endMs,botHostId:reservation.hostId,observedAt:FieldValue.serverTimestamp()});
    tx.update(jobRef,{state:'completed',meetingId:meeting.meetingId});return true;
  });
  return {success:finalized,pending:!finalized,reason:finalized?'':'Meeting exists; reconciliation required',providerMode:provider.mode};
}
