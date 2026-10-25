import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from './firebase';
export async function updateRosterArchive(memberId: string, patch: Record<string, any>) {
  const ref = doc(db, 'members', memberId), snap = await getDoc(ref);
  if (snap.data()?.guestIdentityLocked === true) {
    await httpsCallable(functions, 'updateGuestRosterArchive')({ memberId, isArchived: patch.isArchived });
  } else await updateDoc(ref, patch);
}
