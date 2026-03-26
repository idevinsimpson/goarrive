# Implementation Notes for Suggestions 1-10

## Files to modify:
1. WorkoutDetail.tsx — Add edit/archive/duplicate callbacks, typed props, template toggle, metadata display (suggestions 2, 5, 6, 9)
2. WorkoutForm.tsx — Add block builder section, isTemplate toggle (suggestions 3, 6)
3. workouts.tsx — Add template filter, duplicate handler, collapsible filters, template badge on cards (suggestions 5, 6, 7, 8)
4. MemberDetail.tsx — Wire Workouts tile to live=true with onPress (suggestion 4)
5. firestore.indexes.json — Already has workouts index, no changes needed (suggestion 1)

## Key patterns:
- HubTile interface: { icon, label, sublabel, color, bgColor, live: boolean, onPress?: () => void }
- WorkoutDetail props: { workout: any, onClose: () => void } — needs onEdit, onArchive, onDuplicate callbacks
- MemberDetail already imports useAuth and has claims access at line 363
- isAdmin check pattern: claims?.admin === true || claims?.role === 'platformAdmin'
- WorkoutData interface already exists in workouts.tsx with all needed fields

## Suggestion 1 (Deploy indexes):
- Indexes already added to firestore.indexes.json in prior session
- Need to note this is a deploy step, not a code change

## Suggestion 4 (MemberDetail Workouts tile):
- Tile at line 1280 has live: false
- Need to change to live: true and add onPress
- The onPress should open the AssignWorkoutModal (already imported in MemberDetail)
- Or navigate to workouts page — but MemberDetail is a modal, not a page
- Best approach: set live: true, add onPress that opens AssignWorkoutModal for this member

## Suggestion 9 (Type WorkoutDetail):
- Replace workout: any with WorkoutData interface
- Need to export WorkoutData from workouts.tsx or define it in WorkoutDetail

## Suggestion 10 (Legacy workouts):
- Already handled by defaults in loadWorkouts mapping (data.category ?? '', etc.)
- Need to add visual indicator for legacy workouts missing fields
