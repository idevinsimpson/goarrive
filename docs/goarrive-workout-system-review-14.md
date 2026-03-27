# GoArrive Workout System — Round 14 Review

**Date:** 2026-03-26
**Commit:** `08a75e5` (main)
**Deployed:** https://goarrive.web.app

---

## What Was Fixed

This round addressed five user-reported movement video/thumbnail issues. All fixes were scoped to the smallest possible change across four files.

| Issue | Root Cause | Fix | File(s) |
|---|---|---|---|
| Thumbnail not showing immediately after save | The movement list uses `onSnapshot` (real-time), so it auto-refreshes. The prior round's code that added thumbnail rendering was the actual fix — thumbnails were never rendered before. | Already resolved in Round 13. Verified `onSnapshot` auto-refreshes correctly. | movements.tsx |
| Video only shows top portion | The movement list card used `videoUrl` as an `<Image>` fallback — MP4 files cannot render as `<Image>` elements, causing broken/cropped display. | Removed `videoUrl` from the Image fallback chain; only `thumbnailUrl` and `mediaUrl` (actual images) are used. | movements.tsx |
| Video doesn't auto-play/auto-loop in Movement Details | `MovementDetail` passed `autoPlay={false}` to `MovementVideoControls`. | Changed to `autoPlay={true}` and increased container height from 200 to 240. Video is already muted and looping by default. | MovementDetail.tsx |
| Movement search in WorkoutForm shows "No movements in library" | The `loadMovements` query used `where('coachId') + where('isArchived') + orderBy('name')` — a three-field composite query with **no matching Firestore index**. Firestore silently fails. Also, `movementsLoaded` was never reset when the form re-opened. | Simplified query to `where('coachId')` only (uses existing index). Added client-side `isArchived` filter and `name` sort. Added `useEffect` to reset `movementsLoaded` when `visible` changes. | WorkoutForm.tsx |
| No crop/zoom after video upload | `ImagePicker.launchImageLibraryAsync` and `launchCameraAsync` both had `allowsEditing: false`. | Changed both to `allowsEditing: true`. iOS will now show the native crop/trim editor after selection. | MovementForm.tsx |

Additionally, the thumbnail preview in `MovementForm` was changed from `resizeMode="cover"` to `resizeMode="contain"` so the full image is visible in the preview.

**Files changed:** 4 (MovementForm.tsx, MovementDetail.tsx, movements.tsx, WorkoutForm.tsx)
**Lines changed:** +23 / -18
**Tests:** 54 passing, 5 suites

---

## Current Inventory

| Category | Count |
|---|---|
| Components | 40 |
| Hooks | 10 |
| Test files | 5 (54 tests) |
| Firestore indexes | 37 |
| Cloud Functions | 7 |
| Scripts | 4 |

---

## Suggestions (Do Not Implement)

### S1: Generate Server-Side Video Thumbnails via Cloud Function

Currently, `thumbnailUrl` depends on the coach manually uploading a separate image or the system extracting a frame client-side. If the coach only uploads a video (no separate thumbnail), the movement card shows the placeholder icon. A Cloud Function triggered on video upload (`onObjectFinalized`) could use `ffmpeg` to extract the first frame and write it back to `thumbnailUrl` automatically.

### S2: Add Firestore Composite Index for `coachId + isArchived + name`

The WorkoutForm query was simplified to avoid the missing index, but this means all movements (including archived) are fetched and filtered client-side. For coaches with large libraries (100+ movements), adding the proper composite index (`coachId ASC, isArchived ASC, name ASC`) to `firestore.indexes.json` and deploying would reduce bandwidth and improve performance.

### S3: Add Video Compression Before Upload

Phone-recorded MOV/MP4 files can be 50-100MB+ for a 2-minute clip. The current upload sends the raw file to Firebase Storage. Adding client-side compression (e.g., `expo-video-thumbnails` for frame extraction, or a lightweight WASM encoder for web) would reduce upload times and storage costs significantly.

### S4: Add Thumbnail Extraction from Video on Upload

When a coach uploads a video but no separate thumbnail, the app could extract a frame from the video at the 1-second mark using `expo-video-thumbnails` (native) or a `<canvas>` capture (web) and auto-set it as the `thumbnailUrl`. This would ensure every movement with a video also has a thumbnail for the list card.

### S5: Add Movement Card Video Preview on Long-Press

The movement list card currently shows a static thumbnail. A long-press gesture could trigger an inline video preview (similar to Instagram's peek) that auto-plays the movement demo without opening the full detail modal. This would speed up the coach's library browsing workflow.

### S6: Add Offline Video Caching for Workout Player

Movement demo videos are streamed from Firebase Storage on every play. For gym environments with poor connectivity, caching the video files locally after first download (using `expo-file-system.downloadAsync`) would ensure smooth playback during workouts. The cache could be scoped to the current workout's movements.

### S7: Add Batch Video Upload for Movement Library

Coaches often record multiple movements in a single gym session. A batch upload flow that lets the coach select multiple videos at once, then assign each to a movement (new or existing), would dramatically speed up library building. Each video would go through the same crop/trim editor individually.

### S8: Add Video Duration Validation Before Upload

The `videoMaxDuration: 120` option in ImagePicker is only enforced during recording, not for library picks. A coach could select a 10-minute video from their library. Adding a client-side duration check after selection (using the `asset.duration` property) with a warning/rejection for videos over 2 minutes would prevent oversized uploads.

### S9: Add Movement Thumbnail to WorkoutForm Movement Picker

The movement picker in WorkoutForm shows only the movement name as text. Adding the thumbnail image next to each movement name would help coaches visually identify movements faster, especially when names are similar (e.g., "Dumbbell Chest Press" vs "Dumbbell Chest Fly").

### S10: Add Pull-to-Refresh on Movement List

The movement list uses `onSnapshot` for real-time updates, but if the listener disconnects (e.g., app backgrounded for a long time), the list may go stale. Adding a pull-to-refresh gesture that re-subscribes the listener would give coaches a manual recovery mechanism.

---

## Risks (Do Not Implement)

### R1: `allowsEditing: true` Behavior Varies by Platform

On iOS, `allowsEditing: true` opens the native crop/trim editor. On Android, the behavior is inconsistent — some devices show a crop UI, others skip it entirely. On web, it has no effect. Coaches on Android may not get the crop experience they expect. Consider documenting this limitation or adding a custom crop overlay for Android.

### R2: Client-Side Movement Filtering May Miss Edge Cases

The WorkoutForm now fetches all non-indexed movements and filters `isArchived` client-side. If a movement document lacks the `isArchived` field entirely (older documents), `!cd.isArchived` evaluates to `true` (correct), but if `isArchived` is set to a truthy non-boolean value (e.g., a string "true"), the filter would fail. Consider using `cd.isArchived === true` for strict comparison.

### R3: Auto-Play Video May Increase Data Usage

The Movement Details modal now auto-plays the video on open. If a coach is browsing their library on cellular data, each tap into a movement detail will start streaming the video immediately. Consider adding a user preference or detecting connection type to conditionally auto-play only on Wi-Fi.

### R4: `movementsLoaded` Reset Creates Redundant Fetches

Resetting `movementsLoaded` every time the WorkoutForm opens means movements are re-fetched from Firestore on every form open, even if nothing changed. For coaches who open/close the form frequently, this creates unnecessary reads. Consider using a timestamp-based cache (e.g., re-fetch only if last fetch was more than 5 minutes ago).

### R5: No Error Feedback When Movement Load Fails

The `loadMovements` catch block only logs to console. If the Firestore query fails (permissions, network), the coach sees "No movements in library" with no indication that it was an error vs. an empty library. Consider adding a visible error state with a retry button.

### R6: Video Container Height is Fixed at 240px

The `MovementDetail` video container is hardcoded at 240px height. Portrait videos (9:16) will appear very small with large letterboxing. Landscape videos (16:9) will fill the width nicely. Consider making the height responsive based on the video's actual aspect ratio (available from `onPlaybackStatusUpdate`).

### R7: No Upload Size Limit Enforcement

Firebase Storage has a default max upload size of 5GB, but the app has no client-side size check. A coach could attempt to upload a very large video file, leading to a long upload that may timeout or fail. Consider adding a file size check (e.g., max 100MB) before starting the upload, with a clear error message.

---

*Review by Manus AI — suggestions only, nothing auto-implemented.*
