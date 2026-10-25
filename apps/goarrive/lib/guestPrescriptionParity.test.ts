import { it, expect, vi } from 'vitest';
vi.mock('react', () => ({ useMemo: (fn: () => unknown) => fn(), useCallback: (fn: unknown) => fn }));
import { useWorkoutFlatten } from '../hooks/useWorkoutFlatten';
import { GuestWorkoutDelivery } from '../../../functions/src/guestWorkoutDelivery';

it('supported explicit zero-rest Strength prescription matches authenticated duration/sets/reps/order', async () => {
  const workout = { coachId: 'coach', blocks: [{ type: 'Strength', sets: 1, movements: [
    { movementId: 'm', movementName: 'Coach label', sets: 3, reps: 8, restSec: 0, duration: 12, durationSec: 20, workSec: 40 },
    { movementId: 'm', name: 'Second', sets: 2, reps: '10', restSec: 0, durationSec: 25, workSec: 40 },
  ] }] };
  const content = { workout, movements: { m: { coachId: 'coach', name: 'Library label' } }, version: 'test' };
  const delivery = new GuestWorkoutDelivery({ enabled: true, bucket: 'demo', now: () => 0,
    admit: async () => ({ sessionId: 's', workoutId: 'w', coachId: 'coach', validUntil: 25000, digest: 'test' }), content: async () => content,
    metadata: async () => { throw new Error('No assets'); }, readRange: async () => { throw new Error('No assets'); } });
  const guest = (await delivery.manifest('synthetic')).workout.blocks[0].movements;
  const actual = useWorkoutFlatten(workout);
  expect(actual).toHaveLength(2);
  expect(guest.map((m: any) => ({ name: m.name, duration: m.workSec, rest: m.restSec, sets: m.sets, reps: m.reps }))).toEqual(
    actual.map(m => ({ name: m.name, duration: m.duration, rest: m.restAfter, sets: m.sets, reps: String(m.reps) })));
});
