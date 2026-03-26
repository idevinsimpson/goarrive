# Implementation Notes — Suggestions 1-9

## Suggestion 1: Member workout page
- New file: `(member)/workouts.tsx`
- Member layout `_layout.tsx` needs a new Tabs.Screen entry
- Member auth pattern: `const { user, claims } = useAuth()` → `user!.uid` is the member ID
- Query: `workout_assignments` where `memberId == user.uid` and `status == 'scheduled'`
- Available icons: `workouts` (exists in Icon component)
- Design: #0E1117 bg, #F5A623 gold, Space Grotesk headings, DM Sans body

## Suggestion 2: Wire WorkoutPlayer
- WorkoutPlayer.tsx (199 lines) already has: timer, beeps, haptics, wake lock, block/movement navigation
- Props: `{ visible, workout, onClose, onComplete }`
- `workout` expects: `{ name, blocks: [{ movements: [{ name, duration }] }] }`
- Need to pass the full workout data (with blocks+movements) from the assignment
- onComplete should update workout_assignment status to 'completed' and write a workout_log

## Suggestion 3: Media thumbnails in movement picker
- WorkoutForm MovementOption interface: `{ id, name, category }` — needs `mediaUrl` added
- Movement picker loads from Firestore — need to also fetch `mediaUrl` field
- Show thumbnail if mediaUrl exists

## Suggestion 4: Drag-and-drop
- react-native-draggable-flatlist NOT installed
- Can't add new dependencies per "smallest possible change" constraint
- Alternative: improve the move up/down buttons UX (better styling, haptic feedback)
- OR: skip drag-drop, keep move up/down buttons but make them more prominent

## Suggestion 5: Workout preview in AssignWorkoutModal
- AssignWorkoutModal (744 lines) has a workout picker step
- WorkoutPickerItem: `{ id, name, exerciseCount, category }`
- Need to add an expand/preview action on each workout card
- Show blocks + movements when expanded

## Suggestion 6: Real-time listeners
- movements.tsx uses getDocs (one-time fetch) with pull-to-refresh
- workouts.tsx uses getDocs (one-time fetch) with pull-to-refresh
- Convert to onSnapshot with cleanup in useEffect return

## Suggestion 7: Workout versioning
- AssignWorkoutModal calls `onAssign(workoutId, workoutName, scheduledFor)`
- Need to snapshot the full workout data into the assignment document at assignment time
- This way edits to the workout don't affect assigned copies

## Suggestion 8: AssignWorkoutModal prop interface verification
- Props: `{ visible, memberName, coachId, onClose, onAssign, preselectedWorkoutId?, preselectedWorkoutName? }`
- onAssign signature: `(workoutId: string, workoutName: string, scheduledFor: Date, memberId?: string) => void`
- MemberDetail passes: need to verify what it passes matches this interface
- The MemberDetail edit I did passes: `visible, memberName, coachId, onClose, onAssign`
- Need to check the actual onAssign handler in MemberDetail

## Suggestion 9: Lazy-load movement picker
- Currently loads movements on form open (`useEffect if visible → loadMovements`)
- Change to: only load when coach taps "Add Movement" on a block (when addingMovementToBlock changes from null)
