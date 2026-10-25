import { expect, it } from 'vitest';
import { duplicatePlaybookFields } from './playbookClone';
it.each([undefined, 'carry_forward', 'scheduled'])('duplicates selected policy %s without source assignment or progression', workoutPolicy => {
  const source = { name: 'Original', workoutIds: ['a', 'b'], workoutPolicy, nextWorkoutIndex: 7, memberIds: ['old'], assignedMemberId: 'old', pinnedWorkoutId: 'b', templateSourceId: 'old-template', scheduledWorkoutPlan: { version: 'old-version', workoutIds: ['b'], startIndex: 7 } };
  const copy = duplicatePlaybookFields(source, 'coach', 'new-copy');
  expect(copy.workoutPolicy).toBe(workoutPolicy || 'carry_forward');
  expect(copy.nextWorkoutIndex).toBe(0); expect(copy.memberIds).toEqual([]);
  for (const key of ['assignedMemberId', 'pinnedWorkoutId', 'templateSourceId']) expect(copy).not.toHaveProperty(key);
  if (workoutPolicy === 'scheduled') expect(copy.scheduledWorkoutPlan).toEqual({ version: 'new-copy', workoutIds: ['a', 'b'], startIndex: 0 });
  else expect(copy).not.toHaveProperty('scheduledWorkoutPlan');
  expect(source.nextWorkoutIndex).toBe(7); expect(copy.workoutIds).not.toBe(source.workoutIds);
});
