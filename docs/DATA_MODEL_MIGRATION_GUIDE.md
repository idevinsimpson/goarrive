# GoArrive Data Model Migration Guide

**Last updated:** March 21, 2026  
**Applies to:** `member_plans` Firestore collection

---

## Overview

This document records the current shape of the `member_plans` data model, flags fields that are backward-compatible additions, and provides migration scripts for any future structural changes that would break existing documents.

---

## Current `member_plans` Document Shape (v1)

The canonical TypeScript definition lives in `apps/goarrive/lib/planTypes.ts → MemberPlanData`.

### Goals-related fields

| Field | Type | Added | Notes |
|---|---|---|---|
| `goals` | `string[]` | v1 | Array of goal label strings, e.g. `["Fat loss", "Build muscle"]`. All labels are sourced from `HEALTH_GOALS` in `planTypes.ts`. |
| `goalEmojis` | `Record<string, string> \| undefined` | v1.1 | Optional map of goal label → emoji override. Backward-compatible: missing field is treated as empty map. |
| `goalWeight` | `string \| undefined` | v1 | Free-text goal weight, e.g. `"165 lbs"`. |
| `goalWeightAutoSuggested` | `boolean \| undefined` | v1.2 | `true` when `goalWeight` was auto-calculated from intake data. Cleared to `false` when the coach manually edits the field. Backward-compatible: missing field is treated as `false`. |

---

## Backward-Compatible Additions (no migration needed)

The following fields were added after the initial v1 schema and are safe because:

1. All reads use optional chaining (`plan.goalEmojis?.[goal]`) or nullish coalescing (`plan.goalWeightAutoSuggested ?? false`).
2. Existing Firestore documents that do not have these fields will simply return `undefined`, which the app handles gracefully.
3. No Cloud Function or security rule depends on these fields being present.

**Fields in this category:**
- `goalEmojis`
- `goalWeightAutoSuggested`

---

## Migration Risk: `goals` Array (string[] → object[])

### Current shape
```json
"goals": ["Fat loss", "Build muscle", "Better sleep"]
```

### Proposed future shape (NOT yet implemented)
```json
"goals": [
  { "label": "Fat loss", "emoji": "🔥", "priority": 1 },
  { "label": "Build muscle", "emoji": "💪", "priority": 2 }
]
```

### Why this would be a breaking change

Every component that reads `plan.goals` currently assumes the array contains plain strings:

- `planTypes.ts` → `getGoalEmoji(goalName, goalEmojis)` — passes `goalName` as a string key
- `[memberId].tsx` → goal chip rendering iterates `plan.goals.map(g => <GoalChip label={g} />)`
- `GoalEditModal` — `allKnownGoals` is `string[]`; the modal compares `plan.goals.includes(label)`
- `my-plan.tsx` — member plan view renders `plan.goals.map(g => ...)`

If the array is changed to objects, all of the above will break silently (TypeScript will catch it at compile time, but existing Firestore documents will still have the old string format).

### Migration script (run when ready)

```typescript
// scripts/migrate-goals-to-objects.ts
// Run with: npx ts-node scripts/migrate-goals-to-objects.ts
//
// Prerequisites:
//   1. Set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON with
//      Firestore read/write access.
//   2. npm install firebase-admin

import * as admin from 'firebase-admin';
admin.initializeApp();
const db = admin.firestore();

async function migrate() {
  const snap = await db.collection('member_plans').get();
  let migrated = 0;
  let skipped = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const goals: unknown[] = data.goals || [];

    // Already migrated (first element is an object, not a string)
    if (goals.length > 0 && typeof goals[0] === 'object') {
      skipped++;
      continue;
    }

    const newGoals = (goals as string[]).map((label, i) => ({
      label,
      emoji: data.goalEmojis?.[label] || null,
      priority: i + 1,
    }));

    await docSnap.ref.update({
      goals: newGoals,
      goalEmojis: admin.firestore.FieldValue.delete(), // merged into goals objects
      _schemaVersion: 2,
    });
    migrated++;
    console.log(`Migrated: ${docSnap.id}`);
  }

  console.log(`Done. Migrated: ${migrated}, Skipped (already v2): ${skipped}`);
}

migrate().catch(console.error);
```

### Migration checklist

Before running the script:

- [ ] Update `MemberPlanData.goals` type from `string[]` to `GoalItem[]` in `planTypes.ts`
- [ ] Update all components that read `plan.goals` to use `goal.label` instead of `goal`
- [ ] Update `GoalEditModal` to compare `plan.goals.map(g => g.label).includes(label)`
- [ ] Update `getGoalEmoji` to read from `goal.emoji` directly instead of the `goalEmojis` map
- [ ] Deploy updated app code **before** running the migration script (old code must handle both shapes during the migration window)
- [ ] Run the migration script against a Firestore backup/export first
- [ ] Verify a sample of migrated documents in the Firebase Console
- [ ] Run the migration script against production
- [ ] Remove the `goalEmojis` field from `MemberPlanData` interface (it will be deleted by the script)

---

## Version History

| Version | Date | Change |
|---|---|---|
| v1.0 | Initial | `goals: string[]`, `goalWeight: string` |
| v1.1 | 2026-03 | Added `goalEmojis: Record<string, string>` (backward-compatible) |
| v1.2 | 2026-03 | Added `goalWeightAutoSuggested: boolean` (backward-compatible) |
