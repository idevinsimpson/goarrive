# GoArrive — Project Blueprint (Current)

**Project:** GoArrive (G➲A) Fitness Coaching PWA
**Stack:** React Native / Expo SDK 52, Expo Router, Firebase Auth + Firestore
**Deploy URL:** https://goarrive.web.app
**GitHub Backup:** https://github.com/idevinsimpson/goarrive
**Last Updated:** March 17, 2026

---

## 1. Architecture Overview

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | Expo SDK 52 / React Native | Web-only build via `npx expo export -p web` |
| Navigation | Expo Router (file-based) | `(auth)` group + `(app)` group with bottom tabs |
| Backend | Firebase Auth + Firestore | Hosted on `goarrive.web.app` via Firebase Hosting |
| Icons | Custom inline SVG (`components/Icon.tsx`) | Replaced `@expo/vector-icons` — works on iOS PWA/Safari |
| Fonts | Space Grotesk (headings) + DM Sans (body) | Loaded via Google Fonts in `index.html` |
| Styling | React Native StyleSheet + dark theme | Gold `#F5A623`, dark bg `#0E1117`, blue `#7DD3FC`, green `#86EFAC` |

---

## 2. Project Structure

```
apps/goarrive/
├── app/
│   ├── (auth)/
│   │   ├── _layout.tsx          — Auth stack layout
│   │   └── login.tsx            — Login screen with forgot password
│   ├── (app)/
│   │   ├── _layout.tsx          — Bottom tab navigation (SVG icons)
│   │   ├── dashboard.tsx        — Coach dashboard with stats
│   │   ├── members.tsx          — Member roster with assignment badges
│   │   ├── workouts.tsx         — Workout management
│   │   ├── movements.tsx        — Movement library
│   │   ├── account.tsx          — User profile + sign out
│   │   └── admin.tsx            — Platform admin (hidden tab)
│   ├── index.tsx                — Root redirect
│   └── _layout.tsx              — Root layout with ErrorBoundary + fonts
├── components/
│   ├── Icon.tsx                 — ✅ Universal inline SVG icon system
│   ├── AppHeader.tsx            — Top header with G➲A logo
│   ├── AssignWorkoutModal.tsx   — 3-step workout assignment modal
│   ├── AssignedWorkoutsList.tsx — Assigned workouts list with sort
│   ├── CheckInCard.tsx          — Daily check-in card
│   ├── ConfirmDialog.tsx        — Reusable confirm/cancel dialog
│   ├── ErrorBoundary.tsx        — React error boundary
│   ├── ListSkeleton.tsx         — Loading skeleton
│   ├── MemberDetail.tsx         — Member detail modal
│   ├── MemberForm.tsx           — Add/edit member form
│   ├── MovementDetail.tsx       — Movement detail modal
│   ├── MovementForm.tsx         — Add/edit movement form
│   ├── OnboardingChecklist.tsx  — New coach onboarding card
│   ├── WorkoutDetail.tsx        — Workout detail modal
│   ├── WorkoutForm.tsx          — Add workout form
│   └── WorkoutPlayer.tsx        — Workout timer/player
├── lib/
│   ├── AuthContext.tsx          — Firebase auth context + claims
│   ├── firebase.ts              — Firebase config (no __DEV__ issue)
│   ├── audioBeep.ts             — Web Audio API beep
│   ├── haptics.ts               — Haptic feedback
│   └── useWakeLock.ts           — Screen wake lock hook
└── docs/
    ├── blueprint.md             — This file
    └── week5-loop3-polish-assessment.md
```

---

## 3. Feature Status

### Slice 1 — Core Coach Tools

| Feature | Status | Notes |
|---------|--------|-------|
| Firebase Auth (email/password) | ✅ Complete | Localhost redirect flow |
| Forgot password | ✅ Complete | Firebase `sendPasswordResetEmail` |
| Bottom tab navigation | ✅ Complete | Dashboard, Members, Workouts, Movements |
| Safe area padding (PWA) | ✅ Complete | CSS `env(safe-area-inset-*)` |
| G➲A logo in header/login | ✅ Complete | Real PNG asset |
| Inline SVG icon system | ✅ Complete | Replaces Ionicons — works on iOS PWA |
| Member roster (CRUD) | ✅ Complete | Add, edit, archive, search, sort |
| Workout management (CRUD) | ✅ Complete | Add, delete, search |
| Movement library (CRUD) | ✅ Complete | Add, delete, search, categories |
| Workout assignment | ✅ Complete | 3-step modal: pick → schedule → success |
| Assignment count badges | ✅ Complete | Per-member barbell icon + count |
| "Workout today" indicator | ✅ Complete | Green border + calendar label |
| Sort chips on assignment list | ✅ Complete | Newest / Oldest / Name |
| Onboarding checklist | ✅ Complete | 4-step getting started card |
| WorkoutPlayer (timer) | ✅ Complete | Play/pause/skip with haptics + beep |
| Dashboard stats | ✅ Complete | Members, Workouts, Movements counts |
| Error boundary | ✅ Complete | Catches React render errors |

### PWA / iOS Safari Compatibility

| Issue | Status | Fix Applied |
|-------|--------|-------------|
| Blank screen on Safari (`__DEV__`) | ✅ Fixed | Removed `__DEV__` check in firebase.ts |
| Icons empty squares (Ionicons font) | ✅ Fixed | Replaced with inline SVG Icon component |
| Safe area bottom padding | ✅ Fixed | CSS `env(safe-area-inset-bottom)` on tab bar |
| Safe area top padding | ✅ Fixed | AppHeader reads `window.screen` for PWA |
| Tab bar labels cut off | ✅ Fixed | Proper height + paddingBottom on tab bar |

---

## 4. Week 6 Candidates (Recommended Next Items)

| Priority | Item | Description |
|----------|------|-------------|
| 1 | **Workout Player + assignments** | Auto-launch WorkoutPlayer for assigned workouts |
| 2 | **Recurring assignments** | Weekly recurring schedule (e.g., Push Day every Monday) |
| 3 | **Assignment status tracking** | Mark assignments as "completed" after WorkoutPlayer finishes |
| 4 | **Dashboard assignment summary** | Today's count + upcoming week overview |
| 5 | **Push notification reminders** | Web push notifications for upcoming workouts |
| 6 | **Member login portal** | Members can log in to view their own assigned workouts |

---

## 5. Build & Deploy

```bash
# Install dependencies
cd /home/ubuntu/goarrive-app/apps/goarrive
npm install

# Build for web
npx expo export -p web

# Inject PWA enhancements (manifest, service worker, meta tags)
python3 inject_pwa_meta.py

# Deploy to Firebase
firebase deploy --only hosting

# Push to GitHub
git add -A && git commit -m "feat: ..." && git push origin main
```

**Live URL:** https://goarrive.web.app
**GitHub:** https://github.com/idevinsimpson/goarrive

---

## 6. Known Limitations

- **Web-only build** — Native iOS/Android builds not configured (Expo Go would work but not tested)
- **No member-facing portal** — Members cannot log in; only coaches can access the app
- **WorkoutPlayer not connected to assignments** — Player works but doesn't auto-load from assignments
- **No offline support** — Service worker caches static assets but Firestore reads require network
