import type { firestore } from 'firebase-admin';
import { createHash } from 'crypto';
import type { GuestContentSnapshot } from './guestWorkoutDelivery';
import { unavailable } from './guestWorkoutCapability';

/** Firestore transaction snapshot, including absent referenced documents and
 * server update versions. No query supplied by the guest and no writes. */
export async function readGuestWorkoutContentSnapshot(db: firestore.Firestore, tx: firestore.Transaction, workoutId: string): Promise<GuestContentSnapshot> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(workoutId)) throw unavailable();
  const workout = await tx.get(db.doc('workouts/' + workoutId)), data = workout.data();
  if (!data || !Array.isArray(data.blocks) || data.blocks.length > 60) throw unavailable();
  const ids = new Set<string>(); let count = 0;
  for (const block of data.blocks) {
    if (!block || (block.movements && !Array.isArray(block.movements))) throw unavailable();
    for (const movement of block.movements || []) {
      if (!movement || ++count > 300) throw unavailable();
      if (movement.movementId) {
        if (typeof movement.movementId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(movement.movementId)) throw unavailable();
        ids.add(movement.movementId);
      }
      if (ids.size > 300) throw unavailable();
    }
  }
  const rows = ids.size ? await tx.getAll(...Array.from(ids).sort().map(id => db.doc('movements/' + id))) : [];
  const movements: GuestContentSnapshot['movements'] = {};
  for (const row of rows) movements[row.id] = row.data();
  const version = createHash('sha256').update(JSON.stringify([workout, ...rows].map(row => [row.id, row.updateTime?.seconds, row.updateTime?.nanoseconds]))).digest('hex');
  return { workout: data, movements, version };
}
