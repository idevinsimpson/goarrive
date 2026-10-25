import fs from 'fs';
import path from 'path';
import { enrollmentCloneFields } from '../playbookClone';
test.each([undefined, 'carry_forward', 'scheduled'])('enrollment preserves policy %s with only the new member and fresh sequence', workoutPolicy => {
  const template = { coachId: 'coach', workoutIds: ['a', 'b'], description: 'Keep content', recordingEnabled: false, workoutPolicy, nextWorkoutIndex: 7, memberIds: ['old'], memberId: 'old', assignedMemberId: 'old', assignedMemberName: 'Old member', assignedAt: 'old-time', createdAt: 'old-time', pinnedWorkoutId: 'b', workoutCompletedAt: 'old-completion', scheduledWorkoutId: 'b', scheduledWorkoutPlan: { version: 'old-version', workoutIds: ['b'], startIndex: 7 } };
  const copy = enrollmentCloneFields(template, 'enrollment-copy', 'new-member');
  expect(copy).toMatchObject({ coachId: 'coach', workoutPolicy: workoutPolicy || 'carry_forward', nextWorkoutIndex: 0, memberIds: ['new-member'], assignedMemberId: 'new-member', memberId: 'new-member', description: 'Keep content', recordingEnabled: false });
  for (const field of ['assignedMemberName', 'assignedAt', 'createdAt', 'pinnedWorkoutId', 'workoutCompletedAt', 'scheduledWorkoutId']) expect(copy).not.toHaveProperty(field);
  if (workoutPolicy === 'scheduled') expect(copy.scheduledWorkoutPlan).toEqual({ version: 'enrollment-copy', workoutIds: ['a', 'b'], startIndex: 0 });
  else expect(copy).not.toHaveProperty('scheduledWorkoutPlan');
  expect(template.nextWorkoutIndex).toBe(7); expect(template.memberIds).toEqual(['old']);
});
test('actual duplicate and enrollment paths use the fresh clone builders; template sync does not overwrite per-member policy', () => {
  const index = fs.readFileSync(path.resolve(__dirname, '../index.ts'), 'utf8');
  const build = fs.readFileSync(path.resolve(__dirname, '../../../apps/goarrive/app/(app)/build.tsx'), 'utf8');
  expect(index).toContain('enrollmentCloneFields(template, newPlaybookRef.id, memberId)');
  expect(build).toContain('duplicatePlaybookFields(pbDoc, coachId, copyRef.id)');
  expect(index).toContain("const syncableFields = ['workoutIds', 'musicStyle', 'description'] as const");
});
