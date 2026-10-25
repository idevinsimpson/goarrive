import { Firestore, Transaction, Timestamp, FieldValue } from 'firebase-admin/firestore';
/** Called only inside the first successful allocation transaction. No delivery occurs here. */
export function createBotReminderJobs(tx: Transaction, db: Firestore, sessionId: string, attemptId: string, session: Record<string,any>, joinUrl: string, now=Date.now()) {
  const start=session.startUtc.toMillis();
  const coachLive=session.coachExpectedLive!==false&&(session.hostingMode==='coach_personal'||session.guidancePhase==='coach_guided');
  const jobs:[string,number,'member'|'coach'][]=[['member_24h',start-86400000,'member'],['member_1h',start-3600000,'member'],['missed_session_followup',start+5400000,'member']];
  if(coachLive)jobs.push(['coach_24h',start-86400000,'coach'],['coach_1h',start-3600000,'coach']);
  for(const [type,scheduledFor,role] of jobs){
    if(scheduledFor<=now)continue;
    tx.create(db.doc(`reminder_jobs/bot_${attemptId}_${type}`),{
      reminderType:type,sessionInstanceId:sessionId,recipientUid:role==='coach'?session.coachId:session.memberId,
      recipientRole:role,coachId:session.coachId,memberId:session.memberId,scheduledFor:Timestamp.fromMillis(scheduledFor),
      status:'scheduled',channels:['email'],notificationIds:[],createdAt:FieldValue.serverTimestamp(),
      sessionDate:session.scheduledDate||'',sessionTime:session.scheduledStartTime||'',sessionType:session.sessionType||'',
      memberName:session.memberName||'',coachName:session.coachName||'',guidancePhase:session.guidancePhase||'',joinUrl,
      allocationAttemptId:attemptId,
    });
  }
}
