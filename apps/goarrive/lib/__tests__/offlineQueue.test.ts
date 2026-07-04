/**
 * Tests for offlineQueue completion-write idempotency.
 *
 * Guards against the double-completion race: rapid Submit→Skip taps (or a
 * crash/relaunch replay) must never queue two workout_logs completion writes
 * for the same assignmentId.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('../firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  addDoc: vi.fn(() => Promise.reject(new Error('offline'))),
  doc: vi.fn(),
  updateDoc: vi.fn(() => Promise.reject(new Error('offline'))),
  serverTimestamp: () => ({ _methodName: 'serverTimestamp' }),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
}));

import { enqueueWrite, getQueueSize } from '../offlineQueue';

const QUEUE_KEY = '@goarrive_offline_queue';

const completionLog = (assignmentId: string) => ({
  memberId: 'member-1',
  assignmentId,
  workoutId: 'w-1',
  coachId: 'coach-1',
  reviewStatus: 'pending',
});

describe('offlineQueue — completion-write idempotency', () => {
  beforeEach(() => {
    localStorage.removeItem(QUEUE_KEY);
  });

  test('queues a completion write when offline', async () => {
    const ok = await enqueueWrite('add', 'workout_logs', completionLog('a-1'));
    expect(ok).toBe(false); // queued, not written
    expect(await getQueueSize()).toBe(1);
  });

  test('skips duplicate completion write for the same assignmentId', async () => {
    await enqueueWrite('add', 'workout_logs', completionLog('a-1'));
    await enqueueWrite('add', 'workout_logs', completionLog('a-1'));
    expect(await getQueueSize()).toBe(1);
  });

  test('allows completion writes for different assignments', async () => {
    await enqueueWrite('add', 'workout_logs', completionLog('a-1'));
    await enqueueWrite('add', 'workout_logs', completionLog('a-2'));
    expect(await getQueueSize()).toBe(2);
  });

  test('does not dedupe non-completion writes', async () => {
    await enqueueWrite('update', 'workout_assignments', { status: 'completed' }, 'a-1');
    await enqueueWrite('update', 'workout_assignments', { status: 'completed' }, 'a-1');
    expect(await getQueueSize()).toBe(2);
  });
});
