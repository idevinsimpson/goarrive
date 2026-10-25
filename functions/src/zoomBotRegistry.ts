import {Firestore,FieldValue} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {botHostKey,normalizeBotEmail} from './zoomBotReservation';
export const BOT_INVENTORY_TTL_MS=30000;
export interface BotInventoryProvider {
 readonly mode:'live'|'mock';
 getMeeting(id:string):Promise<unknown|null>;
 inspectHost(email:string):Promise<{email:string;providerUserId:string;active:boolean;userType:number|null;sameAccount:boolean}>;
 inspectHostOccupancy(id:string):Promise<{meetingId:string;startMs:number|null;endMs:number|null;live:boolean}[]>;
}
/** A registration starts by fencing legacy creation. It never enables the rollout flag. */
export async function reconcileBotHost(db:Firestore,provider:BotInventoryProvider,auth:{uid:string;token:Record<string,any>},input:{email:string;roomId:string;legacyRoomIds:string[]}){
 if(auth.token.role!=='platformAdmin')throw new HttpsError('permission-denied','Platform admin role required');
 if(provider.mode!=='live')throw new HttpsError('failed-precondition','Live provider required');
 const email=normalizeBotEmail(input.email),id=botHostKey(email);
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(input.roomId)||!Array.isArray(input.legacyRoomIds)||input.legacyRoomIds.length>20||input.legacyRoomIds.some(x=>!(/^[A-Za-z0-9_-]{1,128}$/).test(x)))throw new HttpsError('invalid-argument','Valid room mappings required');
 const ref=db.doc(`zoom_bot_hosts/${id}`),fence=db.doc(`zoom_bot_registration_fences/${id}`);
 const revision=await db.runTransaction(async tx=>{
  const [old,lock,attempts,lease]=await Promise.all([tx.get(ref),tx.get(fence),tx.get(db.collection('zoom_bot_legacy_attempts').where('hostId','==',id).limit(201)),tx.get(db.doc(`zoom_bot_host_leases/${id}`))]);
  if(attempts.size>200||attempts.docs.some(x=>x.data().state!=='created'))throw new HttpsError('failed-precondition','Legacy provider attempts need reconciliation');
  const same=old.data()?.roomId===input.roomId&&JSON.stringify(old.data()?.legacyRoomIds||[])===JSON.stringify([...new Set(input.legacyRoomIds)]);
  if(!same&&(lease.data()?.windows||[]).some((w:any)=>!w.released))throw new HttpsError('failed-precondition','Existing host occupancy prevents remapping');
  const version=same?old.data()!.mappingVersion:(old.data()?.mappingVersion||0)+1;
  tx.set(fence,{email,blocked:true,revision:(lock.data()?.revision||0)+1});
  tx.set(ref,{email,status:'quiescing',reconciled:false,mappingVersion:version},{merge:true});return version;
 });
 const identity=await provider.inspectHost(email);
 if(identity.email!==email||!identity.active||!identity.sameAccount||identity.userType!==2)throw new HttpsError('failed-precondition','Host is not verified for this account');
 await reconcileLegacyHostRows(db,provider,[input.roomId,...input.legacyRoomIds],identity.providerUserId);
 const beganAt=Date.now(),inventory=await provider.inspectHostOccupancy(identity.providerUserId);
 if(Date.now()-beganAt>=BOT_INVENTORY_TTL_MS)throw new HttpsError('unavailable','Host observation expired');
 await db.runTransaction(async tx=>{
  const [current,room,duplicates]=await Promise.all([tx.get(ref),tx.get(db.doc(`zoom_rooms/${input.roomId}`)),tx.get(db.collection('zoom_bot_hosts').where('providerUserId','==',identity.providerUserId))]);
  const r=room.data();
  if(current.data()?.mappingVersion!==revision||duplicates.docs.some(d=>d.id!==id))throw new HttpsError('failed-precondition','Host mapping changed or duplicates another host');
  if(!r||r.status!=='active'||r.zoomAccountEmail?.trim().toLowerCase()!==email||r.zoomUserId!==identity.providerUserId||r.poolId!=='hmti')throw new HttpsError('failed-precondition','Room does not match verified host');
  if(Date.now()-beganAt>=BOT_INVENTORY_TTL_MS)throw new HttpsError('unavailable','Host observation expired');
  tx.set(ref,{email,providerUserId:identity.providerUserId,poolId:'hmti',isBot:true,verified:true,reconciled:true,providerMode:'live',status:'active',maxConcurrentMeetings:1,roomId:input.roomId,legacyRoomIds:[...new Set(input.legacyRoomIds)],mappingVersion:revision,inventory,inventoryObservedAtMs:beganAt,updatedBy:auth.uid,updatedAt:FieldValue.serverTimestamp()});
 });
 return {hostId:id,mappingVersion:revision,meetingCount:inventory.length};
}

/** Refresh known identities without changing mappings or accepting caller-supplied inventory. */
export async function refreshBotInventories(db:Firestore,provider:Pick<BotInventoryProvider,'inspectHostOccupancy'>){
 const hosts=await db.collection('zoom_bot_hosts').where('status','==','active').limit(11).get();
 if(hosts.size>10)throw new HttpsError('resource-exhausted','Host inventory needs bounded reconciliation');
 for(const doc of hosts.docs){
  const host=doc.data(),beganAt=Date.now();
  const inventory=await provider.inspectHostOccupancy(host.providerUserId);
  await db.runTransaction(async tx=>{
   const current=(await tx.get(doc.ref)).data();
   if(current?.mappingVersion!==host.mappingVersion||current?.providerUserId!==host.providerUserId||Date.now()-beganAt>=BOT_INVENTORY_TTL_MS)throw new HttpsError('aborted','Host inventory changed or expired');
   tx.update(doc.ref,{inventory,inventoryObservedAtMs:beganAt});
  });
 }
}

/** An earlier meeting can overrun after later meetings were allocated. Recheck at join time. */
export async function assertBotJoinCapacity(db:Firestore,provider:Pick<BotInventoryProvider,'inspectHostOccupancy'>,sessionId:string,meetingId:string,expected?:Record<string,any>){
 const receipt=(await db.doc(`session_video_receipts/${sessionId}`).get()).data();
 if(!receipt?.botHostId)return; // Existing non-bot MVP/legacy behavior is unchanged.
 const hostRef=db.doc(`zoom_bot_hosts/${receipt.botHostId}`),host=(await hostRef.get()).data();
 if(!host||host.status!=='active'||!host.reconciled)throw new HttpsError('failed-precondition','Video host unavailable');
 const beganAt=Date.now(),inventory=await provider.inspectHostOccupancy(host.providerUserId);
 await db.runTransaction(async tx=>{
  const [freshHost,freshReceipt,session,lease,jobDoc]=await Promise.all([tx.get(hostRef),tx.get(db.doc(`session_video_receipts/${sessionId}`)),tx.get(db.doc(`session_instances/${sessionId}`)),tx.get(db.doc(`zoom_bot_host_leases/${receipt.botHostId}`)),tx.get(db.doc(`zoom_bot_allocation_jobs/${sessionId}`))]);
  const s=session.data(),now=Date.now(),job=jobDoc.data();
  if(job?.state!=='completed'||job.meetingId!==meetingId||freshReceipt.data()?.botHostId!==receipt.botHostId||(expected&&['coachId','memberId','playbookId'].some(k=>s?.[k]!==expected[k])))throw new HttpsError('failed-precondition','Video assignment changed');
  if(now-beganAt>=BOT_INVENTORY_TTL_MS||freshHost.data()?.mappingVersion!==host.mappingVersion||freshHost.data()?.status!=='active'||freshReceipt.data()?.meetingId!==meetingId||s?.zoomMeetingId!==meetingId||!['allocated','in_progress'].includes(s?.status)||now<s?.startUtc?.toMillis()-300000||now>=s?.endUtc?.toMillis())throw new HttpsError('failed-precondition','Video admission changed');
  const own=inventory.find(m=>m.meetingId===meetingId);
  if(!own||inventory.some(m=>m.meetingId!==meetingId&&(m.live||m.startMs===null||m.endMs===null||(m.startMs-300000<=now&&now<m.endMs))))throw new HttpsError('resource-exhausted','Host is occupied by another meeting');
  if((lease.data()?.windows||[]).some((w:any)=>w.sessionId!==sessionId&&!w.released&&(w.unresolved||w.endMs<=now)))throw new HttpsError('failed-precondition','Earlier host occupancy needs reconciliation');
 });
}


async function reconcileLegacyHostRows(db:Firestore,provider:Pick<BotInventoryProvider,'getMeeting'>,roomIds:string[],providerUserId:string){
 const rows=new Map<string,FirebaseFirestore.QueryDocumentSnapshot>();
 for(const roomId of [...new Set(roomIds)]){
  const docs=await db.collection('session_instances').where('zoomRoomId','==',roomId).limit(201).get();
  for(const d of docs.docs)if(d.data().zoomMeetingId)rows.set(d.id,d);
  if(rows.size>200||docs.size>200)throw new HttpsError('resource-exhausted','Legacy history needs bounded reconciliation');
 }
 for(const [id,doc] of rows){
  const meetingId=doc.data().zoomMeetingId;
  if(await provider.getMeeting(meetingId)!==null)continue;
  await db.runTransaction(async tx=>{
   const current=await tx.get(doc.ref);
   if(current.data()?.zoomMeetingId!==meetingId||!roomIds.includes(current.data()?.zoomRoomId))throw new HttpsError('aborted','Legacy meeting changed');
   tx.set(db.doc(`zoom_bot_legacy_releases/${id}`),{meetingId,providerUserId,verifiedReleasedAtMs:Date.now()});
  });
 }
}
