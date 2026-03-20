# GoArrive Platform — Blueprint v1.20

**Project:** GoArrive (G➲A) Fitness Coaching PWA
**Stack:** React Native / Expo SDK 52, Expo Router, Firebase Auth + Firestore
**Deploy URL:** https://goarrive.web.app
**GitHub Backup:** https://github.com/idevinsimpson/goarrive
**Last Updated:** March 20, 2026 (Intake Form & Firestore Rules Fixes)
**Supersedes:** Blueprint v1.19

---

## 1. Architecture Overview

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | Expo SDK 52 / React Native | Web-only build via `npx expo export -p web` |
| Navigation | Expo Router (file-based) | `(auth)` group + `(app)` group + `intake` public route |
| Backend | Firebase Auth + Firestore | Hosted on `goarrive.web.app` via Firebase Hosting |
| Icons | Custom inline SVG (`components/Icon.tsx`) | Replaced `@expo/vector-icons` — works on iOS PWA/Safari |
| Fonts | Space Grotesk (headings) + DM Sans (body) | Loaded via Google Fonts in `index.html` |
| Styling | React Native StyleSheet + dark theme | Gold `#F5A623`, dark bg `#0E1117`, blue `#7DD3FC`, green `#86EFAC` |

---

## 2. Recent Major Fixes (v1.20)

The following critical issues were resolved to ensure full mobile compatibility and a seamless intake experience:

| Feature | Issue | Fix Implemented | Status |
|---------|-------|-----------------|--------|
| **Safari Mobile Compatibility** | Black screen on iPhone Safari due to `min-height: 0px` on flex containers. | Injected global CSS override to force `min-height: 100%` on root containers and added proper PWA meta tags. | ✅ Fixed |
| **Intake Form Scrolling** | Form was not scrollable on iPhone Safari, and the bottom toolbar was hidden. | Refactored layout to use `height: 100vh` with `overflow: auto` on the scrollable area and a fixed `navBar` at the bottom with safe-area handling. | ✅ Fixed |
| **Password Security** | Password fields were showing plain text during intake. | Added `secureTextEntry={true}` to both Password and Confirm Password fields in the intake form. | ✅ Fixed |
| **Firestore Permissions** | "Missing or insufficient permissions" error when submitting the intake form. | Updated `firestore.rules` to allow authenticated users (just-created accounts) to create their own `members` and `intakeSubmissions` documents. | ✅ Fixed |
| **Dashboard Stats** | Stats were showing zero even with data in Firestore. | Fixed Firestore security rules for the `workouts` collection to allow authenticated coaches to read their own data. | ✅ Fixed |

---

## 3. Project Structure

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
│   ├── (member)/
│   │   └── home.tsx             — Member home screen (Phase 3)
│   ├── intake/
│   │   └── [coachId].tsx        — ✅ Unified multi-step intake form
│   ├── index.tsx                — Root redirect
│   └── _layout.tsx              — Root layout with ErrorBoundary + fonts
├── components/
│   ├── Icon.tsx                 — Universal inline SVG icon system
│   ├── AppHeader.tsx            — Top header with G➲A logo
│   └── ...                      — Various UI components
├── lib/
│   ├── AuthContext.tsx          — Firebase auth context + claims
│   └── firebase.ts              — Firebase config
└── scripts/
    ├── inject_pwa_meta.py       — Safari CSS & meta tag injection script
    └── generate_sw.js           — Service worker generator
```

---

## 4. Feature Status

### Slice 1 & 2 — Core Coach Tools & Unified Intake

| Feature | Status | Notes |
|---------|--------|-------|
| Firebase Auth | ✅ Complete | Email/password login + password reset |
| Bottom Tab Navigation | ✅ Complete | Dashboard, Members, Workouts, Movements |
| Unified Intake Form | ✅ Complete | 8-step wizard with personal info, goals, and account creation |
| Mobile UX (Safari) | ✅ Complete | Fixed scrolling, safe-area padding, and min-height issues |
| Password Masking | ✅ Complete | `secureTextEntry` enabled on all password fields |
| Firestore Rules | ✅ Complete | Allows unauthenticated intake + authenticated member creation |
| Member Roster | ✅ Complete | Full CRUD with search and sorting |
| Workout Assignment | ✅ Complete | Modal-based assignment with scheduling |
| Dashboard Stats | ✅ Complete | Real-time counts for members, workouts, and movements |

---

## 5. Build & Deploy

```bash
# Build for web
cd /home/ubuntu/goarrive-app/apps/goarrive
npm run build:web

# Deploy to Firebase
cd /home/ubuntu/goarrive-app
firebase deploy --only hosting,firestore:rules
```

**Live URL:** https://goarrive.web.app
**GitHub:** https://github.com/idevinsimpson/goarrive

---

## 6. Next Steps: Phase 3 (Member Experience)

1. **Member Home Screen**: Personalized dashboard for members showing their plan status.
2. **Plan Viewer Integration**: Bringing the Hunter Plan's presentation layer into the main app.
3. **Habit Tracking**: Implementing the daily check-in system for members.
4. **Workout Execution**: Allowing members to view and log their assigned workouts.
