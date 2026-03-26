# Firestore Rules Audit Notes

## What Already Exists:
- `workout_assignments` rules (lines 329-342) — ALREADY DONE. Coach CRUD, member read + status update, admin full.
- `workouts` rules (lines 272-277) — ALREADY DONE. Coach CRUD, no member read.
- `movements` rules (lines 257-265) — ALREADY DONE. Coach CRUD + global read.
- `workout_templates` rules (lines 283-288) — Legacy alias, ALREADY DONE.

## What's MISSING:
- `workout_logs` — NO RULES EXIST. The member workout page writes to this collection on workout completion.
  - Need: member creates own logs, coach reads their members' logs, admin reads all.

## What Needs Fixing:
- `workouts` rules (line 273) — members can't read workouts. But the member workout page loads workout data via the assignment's `workoutSnapshot`. So this is OK — members don't query the workouts collection directly.
- However, if we want the member workout page to load fresh workout data (not just snapshot), we'd need to add member read. For now, snapshot approach works.

## Suggestion 8 Status:
- workout_assignments: DONE
- workout_logs: NEEDS RULES
- Need composite index for workout_logs (memberId + completedAt DESC)
- Need composite index for workout_assignments (memberId + scheduledFor DESC)
