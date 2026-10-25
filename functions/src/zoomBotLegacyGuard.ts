import { Firestore } from 'firebase-admin/firestore';
import { botHostKey } from './zoomBotReservation';

/** Registered hosts may only allocate through the reservation path, including
 * case variants and old room aliases. Inactive registry entries still fence. */
export async function isRegisteredBotRoom(db: Firestore, room: Record<string, any>, roomId?: string): Promise<boolean> {
  const refs: Promise<boolean>[]=[];
  if(typeof room.zoomAccountEmail==='string'&&room.zoomAccountEmail.trim())refs.push(db.doc(`zoom_bot_hosts/${botHostKey(room.zoomAccountEmail)}`).get().then(x=>x.exists));
  if(typeof room.zoomUserId==='string'&&room.zoomUserId)refs.push(db.collection('zoom_bot_hosts').where('providerUserId','==',room.zoomUserId).limit(1).get().then(x=>!x.empty));
  if(roomId)refs.push(db.collection('zoom_bot_hosts').where('roomId','==',roomId).limit(1).get().then(x=>!x.empty));
  if(roomId)refs.push(db.collection('zoom_bot_hosts').where('legacyRoomIds','array-contains',roomId).limit(1).get().then(x=>!x.empty));
  return (await Promise.all(refs)).some(Boolean);
}
