# Admin Gate Implementation Notes

## Admin check pattern (from admin.tsx line 150):
```
const isAdmin = claims?.admin === true || claims?.role === 'platformAdmin';
```

## Files to modify:
1. movements.tsx — wrap the real content in isAdmin check, show Coming Soon for non-admins
2. workouts.tsx — same pattern, but also need to build the real workouts page for admin

## WorkoutForm.tsx (164 lines) — existing orphaned component:
- Only captures: name, description
- Writes to 'workouts' collection with: name, description, blocks: [], createdAt
- Missing: coachId, tenantId, category, targetDuration, difficulty, blocks with movements
- Same pattern as old MovementForm — needs full rewrite

## WorkoutDetail.tsx (337 lines) — existing orphaned component:
- Shows workout info, blocks, and assign-to-member button
- Uses AssignWorkoutModal
- Has real-time onSnapshot listener
- Well-styled, follows design system
- Can be wired in as-is

## Firestore rules for workouts:
- read: isAuthenticated() && isCoachOrBootstrap(resource.data.coachId)
- create: isCoachOrBootstrap(request.resource.data.coachId)
- update: isCoachOrBootstrap(resource.data.coachId)
- delete: false

## Coming Soon placeholder styles (from workouts.tsx):
- Uses same design system: #0E1117 bg, Space Grotesk headings, DM Sans body
- Has icon, title, COMING SOON badge, description, hint text
