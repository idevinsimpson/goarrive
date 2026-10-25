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
    if(job.exists)throw new HttpsError('failed-precondition','Reconcile the existing video allocation before changing this session');
    if(s.roomSource!=='shared_pool')return null;
    tx.create(ref,{state:'mutation_lock',attemptId,sessionId:id,coachId:s.coachId,memberId:s.memberId,playbookId:s.playbookId||null,startMs:s.startUtc?.toMillis?.()??null,endMs:s.endUtc?.toMillis?.()??null,recordingEnabled:s.recordingEnabled===true,hostId:'',hostEmail:'',providerUserId:''});
    return attemptId;
  });
}

export async function finishBotSessionMutation(db: Firestore,id:string,attemptId:string|null,uncertain=false) {
  if(!attemptId)return;
  const ref=db.doc(`zoom_bot_allocation_jobs/${id}`);
  await db.runTransaction(async tx=>{
    const job=(await tx.get(ref)).data();
    if(job?.attemptId!==attemptId||job.state!=='mutation_lock')return;
    if(uncertain)tx.update(ref,{state:'needs_reconciliation',failure:'provider_delete_uncertain'});
    else tx.delete(ref);
  });
}
