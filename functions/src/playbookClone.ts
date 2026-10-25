/** Preserve template configuration, never its previous member/progression lifecycle. */
export function enrollmentCloneFields(template: Record<string, any>, newId: string, memberId: string) {
  const fields = { ...template };
  for (const key of ['guestAssignmentLocked', 'createdAt', 'updatedAt', 'assignedAt', 'memberId', 'memberIds', 'assignedMemberId', 'assignedMemberName', 'nextWorkoutIndex', 'scheduledWorkoutPlan', 'scheduledWorkoutId', 'scheduledWorkoutVersion', 'scheduledWorkoutOrderUtc', 'scheduledWorkoutMemberKey', 'pinnedWorkoutId', 'pinnedWorkoutIndex', 'pinnedWorkoutSequence', 'pinnedWorkoutPolicy', 'workoutCompletedAt', 'sourcePlaybookId', 'templateSourceId']) delete fields[key];
  const workoutIds = Array.isArray(template.workoutIds) ? [...template.workoutIds] : [];
  const workoutPolicy = template.workoutPolicy === 'scheduled' ? 'scheduled' : 'carry_forward';
  return {
    ...fields, workoutIds, workoutPolicy, nextWorkoutIndex: 0,
    memberId, memberIds: [memberId], assignedMemberId: memberId,
    ...(workoutPolicy === 'scheduled' ? { scheduledWorkoutPlan: { version: newId, workoutIds: [...workoutIds], startIndex: 0 } } : {}),
  };
}
