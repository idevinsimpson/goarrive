# GoArrive File Map

## Application Structure
The frontend application lives in `apps/goarrive/` and follows Expo Router's file-based routing conventions. The backend Cloud Functions live in `functions/src/`.

## Page Routes

### Coach/Admin Routes (`apps/goarrive/app/(app)/`)

| File | Route | Description |
|---|---|---|
| `dashboard.tsx` | `/dashboard` | Main coach dashboard with stats, getting started checklist, and feature cards. Shows member count, upcoming sessions, and quick actions. |
| `members.tsx` | `/members` | Member list with search, filter, and quick-add functionality. |
| `build.tsx` | `/build` | Unified Build page with movements, workouts, folders, and playbooks. Includes bulk upload and sorting logic. |
| `scheduling.tsx` | `/scheduling` | Scheduling management with recurring slots and session instances. |
| `admin.tsx` | `/admin` | Platform admin page with coach management, profit share settings, and yearly cap configuration. Hidden tab, accessible only to admins. |
| `account.tsx` | `/account` | Coach account settings and profile management. Hidden tab. |
| `billing.tsx` | `/billing` | Billing page with prorated earnings cap calculation and admin yearly cap management. Hidden tab. |
| `workouts.tsx` | `/workouts` | Legacy workouts page (hidden from tab bar, replaced by Build). |
| `movements.tsx` | `/movements` | Legacy movements page (hidden from tab bar, replaced by Build). |
| `member-plan/[memberId].tsx` | `/member-plan/:id` | Full-screen immersive member plan view. |

### Member Routes (`apps/goarrive/app/(member)/`)

| File | Route | Description |
|---|---|---|
| `home.tsx` | `/home` | Member home screen with upcoming sessions and workout assignments. |
| `my-plan.tsx` | `/my-plan` | Member's current plan details. |
| `my-sessions.tsx` | `/my-sessions` | Member's session history and upcoming sessions. |
| `workouts.tsx` | `/workouts` | Member's assigned workouts. |
| `profile.tsx` | `/profile` | Member profile and settings. |
| `payment-select.tsx` | `/payment-select` | Payment method selection. |
| `checkout-success.tsx` | `/checkout-success` | Post-checkout success page. |

### Public Routes

| File | Route | Description |
|---|---|---|
| `intake/index.tsx` | `/intake` | Public intake form landing. |
| `intake/[coachId].tsx` | `/intake/:coachId` | Coach-specific intake form (8-step wizard). |
| `coach-signup.tsx` | `/coach-signup` | Coach signup page. |
| `shared-plan/[memberId].tsx` | `/shared-plan/:memberId` | Publicly shareable plan view. |

### Auth Routes (`apps/goarrive/app/(auth)/`)

| File | Route | Description |
|---|---|---|
| `login.tsx` | `/login` | Login screen for all users. |

## Key Components (`apps/goarrive/components/`)

| Component | Purpose |
|---|---|
| `BulkMovementUpload.tsx` | Bulk movement upload with AI auto-analysis via ChatGPT. |
| `WorkoutPlayer.tsx` | Workout playback engine (built but partially disconnected). |
| `WorkoutForm.tsx` | Workout creation/edit form with block builder. |
| `WorkoutDetail.tsx` | Workout detail view with assignment capabilities. |
| `MovementForm.tsx` | Movement creation/edit form. |
| `MovementDetail.tsx` | Movement detail view. |
| `MemberDetail.tsx` | Member detail panel with tiles for plan, sessions, billing, etc. |
| `MemberForm.tsx` | Member creation form with duplicate email prevention. |
| `OnboardingChecklist.tsx` | Getting Started checklist for new coaches. |
| `CoachReviewQueue.tsx` | Coach review queue for workout logs. |
| `PostWorkoutJournal.tsx` | Post-workout Glow/Grow journal for members. |
| `WorkoutFolderPage.tsx` | Folder view within the Build system. |
| `AssignWorkoutModal.tsx` | Modal for assigning workouts to members. |
| `BatchAssignModal.tsx` | Modal for batch-assigning workouts. |
| `StripeConnectPanel.tsx` | Stripe Connect onboarding and status panel. |
| `ErrorBoundary.tsx` | Global error boundary component. |
| `ConfirmDialog.tsx` | Reusable confirmation dialog. |
| `Icon.tsx` | Custom icon component for the app. |

## Utilities & Hooks

| File | Purpose |
|---|---|
| `utils/analyzeMovementMedia.ts` | Client-side wrapper for the AI movement analysis Cloud Function. |
| `utils/generateCroppedGif.ts` | Generates cropped GIF thumbnails from video. |
| `utils/generateMovementVoice.ts` | Generates voice audio for movement names via OpenAI TTS (`generateVoice` Cloud Function). |
| `hooks/useMovementFilters.ts` | Hook for filtering movements by category, equipment, etc. |
| `hooks/useMovementSwap.ts` | Hook for swapping movements (regression/progression). |
| `hooks/useWorkoutTimer.ts` | Hook for workout timer logic. |
| `hooks/useWorkoutTTS.ts` | Hook for text-to-speech during workouts. |
| `hooks/usePlaybackSpeed.ts` | Hook for video playback speed control. |
| `hooks/useSeamlessLoop.ts` | Hook for seamless video looping. |
| `hooks/useMediaPrefetch.ts` | Hook for prefetching upcoming movement media. |
| `hooks/useNetworkStatus.ts` | Hook for monitoring network connectivity. |
| `hooks/useOfflineVideoCache.ts` | Hook for offline video caching. |

## Library Files (`apps/goarrive/lib/`)

| File | Purpose |
|---|---|
| `AuthContext.tsx` | Authentication context with admin coach override (effectiveClaims) support. |
| `firebase.ts` | Firebase app initialization and service exports. |
| `planTypes.ts` | TypeScript types for member plans. |
| `schedulingTypes.ts` | TypeScript types for scheduling. |
| `notifications.ts` | Push notification registration and management. |
| `offlineQueue.ts` | Offline action queue for network-resilient operations. |
| `audioBeep.ts` | Audio beep utility for workout timer. |
| `audioCues.ts` | Audio cue management for workout playback. |
| `haptics.ts` | Haptic feedback utility. |
| `useWakeLock.ts` | Wake lock hook to prevent screen sleep during workouts. |
| `zoomProvider.ts` | Zoom integration provider. |

## Backend Files (`functions/src/`)

| File | Purpose |
|---|---|
| `index.ts` | Main Cloud Functions file with 52+ exported functions. |
| `notifications.ts` | Notification sending logic (email, SMS, push). |
| `reminders.ts` | Reminder scheduling and processing. |
| `templates.ts` | Email and notification templates. |
| `zoom.ts` | Zoom API integration utilities. |
| `notificationUtils.ts` | Shared notification utility functions. |
