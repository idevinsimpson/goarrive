import { randomUUID } from 'crypto';
import { Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { ownsSessionMember } from './sessionIdentity';

/** Serialize legacy shared-session edits against new bot reservations.
 * Managed/uncertain attempts require explicit provider reconciliation first. */
export async function beginBotSessionMutation(db: Firestore, id: string, auth: {uid: string; token: Record<string, any>}) {
  const attemptId = randomUUID();
  return db.runTransaction(async tx => {
    const ref=db.doc(`zoom_bot_allocation_jobs/${id}`);
    const [sessionDoc,job]=await Promise.all([tx.get(db.doc(`session_instances/${id}`)),tx.get(ref)]);
    const s=sessionDoc.data();
    if(!s || (s.coachId!==auth.uid&&!ownsSessionMember(auth.uid,auth.token,s)))throw new HttpsError('permission-denied','This session is not assigned to you');
    if(job.exists){
      const prior=job.data()!;
      if(prior.state!=='completed'||prior.meetingId!==s.zoomMeetingId||prior.roomId!==s.zoomRoomId)throw new HttpsError('failed-precondition','Reconcile the existing video allocation before changing this session');
      tx.update(ref,{state:'mutation_lock',mutationAttemptId:attemptId,previousState:'completed',providerDeletionVerified:false});
      return attemptId;
    }
    if(s.roomSource!=='shared_pool')return null;
    tx.create(ref,{state:'mutation_lock',attemptId,sessionId:id,coachId:s.coachId,memberId:s.memberId,playbookId:s.playbookId||null,startMs:s.startUtc?.toMillis?.()??null,endMs:s.endUtc?.toMillis?.()??null,recordingEnabled:s.recordingEnabled===true,meetingId:s.zoomMeetingId||null,hostId:'',hostEmail:'',providerUserId:''});
    return attemptId;
  });
}

export async function finishBotSessionMutation(db: Firestore,id:string,attemptId:string|null,uncertain=false) {
  if(!attemptId)return;
  const ref=db.doc(`zoom_bot_allocation_jobs/${id}`);
  await db.runTransaction(async tx=>{
    const job=(await tx.get(ref)).data();
    if((job?.mutationAttemptId||job?.attemptId)!==attemptId||job?.state!=='mutation_lock')return;
    const leaseRef=job.hostId?db.doc(`zoom_bot_host_leases/${job.hostId}`):null;
    const lease=leaseRef?await tx.get(leaseRef):null;
    if(uncertain)tx.update(ref,{state:'needs_reconciliation',failure:'provider_delete_uncertain'});
    else if(job.previousState==='completed'&&!job.providerDeletionVerified)tx.update(ref,{state:'completed',mutationAttemptId:null,previousState:null});
    else {
      if(job.previousState==='completed'){
        tx.set(db.doc(`zoom_bot_allocation_history/${job.attemptId}`),{...job,state:'released'});
        if(leaseRef)tx.update(leaseRef,{windows:(lease?.data()?.windows||[]).map((w:any)=>w.attemptId===job.attemptId?{...w,released:true}:w)});
        tx.delete(db.doc(`session_video_receipts/${id}`));
      }
      tx.delete(ref);
    }
  });
}


/** Call only after the provider DELETE succeeded and GET confirmed absence. */
export async function confirmBotMeetingDeleted(db:Firestore,id:string,attemptId:string|null,meetingId:string){
 if(!attemptId)return;
 await db.runTransaction(async tx=>{
  const ref=db.doc(`zoom_bot_allocation_jobs/${id}`),job=(await tx.get(ref)).data();
  if((job?.mutationAttemptId||job?.attemptId)!==attemptId||job?.state!=='mutation_lock')throw new HttpsError('aborted','Video mutation changed');
  if(job.meetingId!==meetingId)throw new HttpsError('aborted','Meeting identity changed');
  tx.update(ref,{providerDeletionVerified:true});
 });
}


export async function applyBotSessionUpdate(db:Firestore,id:string,attemptId:string,patch:Record<string,any>){
 await db.runTransaction(async tx=>{
  const ref=db.doc(`zoom_bot_allocation_jobs/${id}`),sessionRef=db.doc(`session_instances/${id}`);
  const [jobDoc,sessionDoc]=await Promise.all([tx.get(ref),tx.get(sessionRef)]);const job=jobDoc.data(),session=sessionDoc.data();
  if((job?.mutationAttemptId||job?.attemptId)!==attemptId||job?.state!=='mutation_lock'||!session||session.coachId!==job.coachId||session.memberId!==job.memberId)throw new HttpsError('aborted','Mutation changed');
  if((session.zoomMeetingId||null)!==(job.meetingId||null))throw new HttpsError('aborted','Meeting changed during mutation');
  if(session.zoomMeetingId&&!job.providerDeletionVerified)throw new HttpsError('failed-precondition','Provider deletion must be verified');
  tx.update(sessionRef,patch);
  const old=job.oldReservationId||session.reservationId;
  if(old&&old!==patch.reservationId)tx.delete(db.doc(`member_time_reservations/${old}`));
  tx.update(ref,{sessionMutationCommitted:true});
 });
}
