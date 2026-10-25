import {randomUUID} from 'crypto';
import {Firestore,FieldValue} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {botHostKey,normalizeBotEmail} from './zoomBotReservation';
import {ZoomProvider,ZoomMeetingRequest} from './zoom';
/** Registration and every legacy provider create contend on this same host fence. */
export async function createFencedLegacyMeeting(db:Firestore,provider:ZoomProvider,input:ZoomMeetingRequest) {
 const email=normalizeBotEmail(input.hostEmail),hostId=botHostKey(email),attemptId=randomUUID();
 const fence=db.doc(`zoom_bot_registration_fences/${hostId}`),attempt=db.doc(`zoom_bot_legacy_attempts/${attemptId}`);
 await db.runTransaction(async tx=>{
  const [registered,lock]=await Promise.all([tx.get(db.doc(`zoom_bot_hosts/${hostId}`)),tx.get(fence)]);
  if(registered.exists||lock.data()?.blocked)throw new HttpsError('failed-precondition','Host is reserved for verified pool allocation');
  tx.set(fence,{email,revision:(lock.data()?.revision||0)+1},{merge:true});
  tx.create(attempt,{hostId,email,state:'provider_started',createdAt:FieldValue.serverTimestamp()});
 });
 try {
  const result=await provider.createMeeting(input);
  await attempt.update({state:'created',meetingId:result.meetingId});
  return result;
 }catch{
  // Even a persistence failure after creation remains a durable unknown hold.
  await attempt.set({state:'needs_reconciliation'},{merge:true});
  throw new HttpsError('unavailable','Meeting creation needs reconciliation before host registration');
 }
}
