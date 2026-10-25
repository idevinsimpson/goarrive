/** A duplicate is an unassigned template, with a fresh progression lifecycle. */
export function duplicatePlaybookFields(source: Record<string, any>, coachId: string, newId: string) {
  const workoutIds = Array.isArray(source.workoutIds) ? [...source.workoutIds] : [];
  const workoutPolicy = source.workoutPolicy === 'scheduled' ? 'scheduled' : 'carry_forward';
  return {
    coachId, name: `${source.name} (Copy)`, description: source.description || '',
    workoutIds, parentId: source.parentId ?? null, memberIds: [], isArchived: false,
    workoutPolicy, videoEnabled: source.videoEnabled === true, nextWorkoutIndex: 0,
    ...(workoutPolicy === 'scheduled' ? { scheduledWorkoutPlan: { version: newId, workoutIds: [...workoutIds], startIndex: 0 } } : {}),
  };
}
