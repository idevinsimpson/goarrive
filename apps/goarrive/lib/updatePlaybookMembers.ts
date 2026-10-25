import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from './firebase';

/** Legacy plans retain existing writes. Once guest assignment protection is
 * enabled, membership changes must atomically invalidate server-side grants. */
export async function updatePlaybookMembers(playbookId: string, patch: Record<string, any>) {
  const ref = doc(db, 'playbooks', playbookId), current = await getDoc(ref);
  if (current.data()?.guestAssignmentLocked === true) {
    await httpsCallable(functions, 'setGuestAssignmentMembers')({ playbookId, memberIds: patch.memberIds });
  } else {
    // If a concurrent server operation locks this plan, rules reject this write.
    await updateDoc(ref, patch);
  }
}
