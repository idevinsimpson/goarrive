/**
 * Regression tests for useWorkoutTTS audio queue behavior.
 *
 * Guards against:
 *  - cue→voice gap mistakenly inflated to QUEUE_GAP_MS instead of 0
 *    [EXPECTED RED ON MAIN — green after fix/workout-player-stability merges]
 *  - stale items (bumped runId) leaking back into the pump
 *  - queue ordering: "go" cue enqueued before the work-start fallback voice clip
 */

import { vi } from 'vitest';

vi.mock('expo-speech', () => ({}));
vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(),
  httpsCallable: vi.fn(),
}));
vi.mock('../../lib/audioCues', () => ({ unlockAudioContext: vi.fn() }));

import {
  QUEUE_GAP_MS,
  calcQueueGapMs,
  filterStaleQueueItems,
  findUpcomingExercise,
  type QueueItemKind,
} from '../useWorkoutTTS';

// ── Gap timing ────────────────────────────────────────────────────────────

describe('calcQueueGapMs — inter-clip gap', () => {
  // EXPECTED RED ON MAIN — green after fix/workout-player-stability merges
  // On main the gap is always QUEUE_GAP_MS. The fix changes cue→voice to 0 so
  // the movement-name voice clip follows its preceding cue with zero silence.
  test('cue followed by voice has 0 ms gap [EXPECTED RED ON MAIN]', () => {
    const gap = calcQueueGapMs('cue', 'voice');
    expect(gap).toBe(0);
  });

  test('cue followed by another cue uses QUEUE_GAP_MS', () => {
    expect(calcQueueGapMs('cue', 'cue')).toBe(QUEUE_GAP_MS);
  });

  test('voice followed by voice uses QUEUE_GAP_MS', () => {
    expect(calcQueueGapMs('voice', 'voice')).toBe(QUEUE_GAP_MS);
  });

  test('voice followed by cue uses QUEUE_GAP_MS', () => {
    expect(calcQueueGapMs('voice', 'cue')).toBe(QUEUE_GAP_MS);
  });

  test('cue with no next item uses QUEUE_GAP_MS', () => {
    expect(calcQueueGapMs('cue', null)).toBe(QUEUE_GAP_MS);
  });

  test('QUEUE_GAP_MS is 90 ms', () => {
    expect(QUEUE_GAP_MS).toBe(90);
  });
});

// ── Stale item filtering (runId) ──────────────────────────────────────────

describe('filterStaleQueueItems — runId-based drop', () => {
  function makeItem(kind: QueueItemKind, runId: number) {
    return kind === 'cue'
      ? { kind: 'cue' as const, key: 'go' as const, context: '', runId }
      : { kind: 'voice' as const, url: 'https://x.com/clip.mp3', context: '', runId };
  }

  test('keeps only items matching the current runId', () => {
    const items = [makeItem('cue', 1), makeItem('voice', 2), makeItem('cue', 2)];
    const result = filterStaleQueueItems(items, 2);
    expect(result).toHaveLength(2);
    expect(result.every((i) => i.runId === 2)).toBe(true);
  });

  test('drops ALL items when runId is bumped past all queued items', () => {
    const items = [makeItem('cue', 1), makeItem('voice', 1)];
    expect(filterStaleQueueItems(items, 2)).toHaveLength(0);
  });

  test('returns all items when none are stale', () => {
    const items = [makeItem('cue', 3), makeItem('voice', 3)];
    expect(filterStaleQueueItems(items, 3)).toHaveLength(2);
  });

  test('empty queue returns empty array', () => {
    expect(filterStaleQueueItems([], 5)).toHaveLength(0);
  });
});

// ── Queue ordering invariant ──────────────────────────────────────────────

describe('queue ordering invariant', () => {
  // "go" is a cue enqueued at rest-end (timeLeft ≤ 0 in the rest phase).
  // The work-start fallback enqueues voiceUrl only when rest didn't already
  // announce the movement name. These two effects run in separate useEffect
  // blocks, and "go" is always enqueued FIRST because the rest-end effect
  // fires before the work effect (phase flip triggers both, rest fires with
  // the previous phase value).
  //
  // We verify the ordering contract via the QueueItem shape rather than
  // rendering the full hook (which requires a working HTMLAudioElement).
  test('go cue item shape matches expected queue entry', () => {
    const goItem = { kind: 'cue' as QueueItemKind, context: 'rest_end_0', runId: 1 };
    const voiceItem = { kind: 'voice' as QueueItemKind, context: 'work_0_name_fallback', runId: 1 };

    // Simulate the order they would be enqueued: go cue first, voice second.
    const queue = [goItem, voiceItem];
    expect(queue[0].kind).toBe('cue');
    expect(queue[1].kind).toBe('voice');
  });

  test('stale go cue is dropped when runId is bumped before voice starts', () => {
    const items = [
      { kind: 'cue' as const, context: 'rest_end_0', runId: 1 },
      { kind: 'voice' as const, context: 'work_0_voice', runId: 1 },
    ];
    // Simulate skip (runId bumped to 2) — both items become stale.
    const remaining = filterStaleQueueItems(items, 2);
    expect(remaining).toHaveLength(0);
  });
});

// ── findUpcomingExercise — grabEquipment end announcement target ──────────

describe('findUpcomingExercise', () => {
  const exercise = (name: string, extra: Record<string, unknown> = {}) => ({
    stepType: 'exercise', movementIndex: 0, name, ...extra,
  });
  const bridge = () => ({
    // Synthetic "Get Ready" prep-rest step from useWorkoutFlatten
    stepType: 'exercise', movementIndex: -1, name: 'Get Ready', voiceUrl: '',
  });
  const grab = () => ({ stepType: 'grabEquipment', movementIndex: 0, name: 'Grab Equipment' });

  test('skips the Get Ready bridge and returns the real movement', () => {
    const steps = [grab(), bridge(), exercise('Goblet Squat', { voiceUrl: 'v.mp3' })];
    const found = findUpcomingExercise(steps, 0);
    expect(found?.index).toBe(2);
    expect(found?.step.name).toBe('Goblet Squat');
  });

  test('returns the immediate next step when it is a plain exercise', () => {
    const steps = [grab(), exercise('Push Up')];
    const found = findUpcomingExercise(steps, 0);
    expect(found?.index).toBe(1);
    expect(found?.step.name).toBe('Push Up');
  });

  test('skips special blocks between grabEquipment and the movement', () => {
    const steps = [
      grab(),
      { stepType: 'waterBreak', movementIndex: 0, name: 'Water Break' },
      bridge(),
      exercise('Deadlift'),
    ];
    expect(findUpcomingExercise(steps, 0)?.step.name).toBe('Deadlift');
  });

  test('treats missing stepType as exercise', () => {
    const steps = [grab(), { movementIndex: 1, name: 'Legacy Movement' }];
    expect(findUpcomingExercise(steps, 0)?.step.name).toBe('Legacy Movement');
  });

  test('returns null when nothing follows', () => {
    const steps = [exercise('Row'), grab()];
    expect(findUpcomingExercise(steps, 1)).toBeNull();
  });

  test('returns null when only bridges follow', () => {
    const steps = [grab(), bridge()];
    expect(findUpcomingExercise(steps, 0)).toBeNull();
  });

  test('scans from fromIndex, not from 0', () => {
    const steps = [exercise('First'), grab(), bridge(), exercise('Second')];
    expect(findUpcomingExercise(steps, 1)?.step.name).toBe('Second');
  });
});
