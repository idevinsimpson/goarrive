# GoArrive Known Issues & Lessons Learned

## Resolved Issues (Reference for Future Work)
The following issues were encountered and resolved during development. They are documented here as institutional knowledge to prevent regression and inform future decisions.

### Admin Impersonation Crash (Lazy-Loaded Components)
When a Platform Admin used the "View as [Coach]" feature, the app would crash because certain components were lazy-loaded and did not properly handle the `effectiveClaims` context. The fix ensured that all components consuming auth context use `effectiveUid` and `claims.coachId` from `useAuth()` rather than `user.uid` directly. Any new component that queries Firestore or triggers Cloud Functions must follow this pattern.

### Dashboard Member Count During Admin Override
The dashboard member count was showing the admin's own member count (typically zero) instead of the impersonated coach's member count. The fix involved updating the Firestore query in the dashboard to use the effective coach ID from `AuthContext` when an admin override is active.

### Getting Started Checklist (Wrong Firestore Collection)
The "Getting Started" checklist on the dashboard was not recognizing created workouts because it was querying the wrong Firestore collection. The checklist was looking in a legacy collection instead of the `workouts` collection where workouts are actually stored. The fix updated the query to use the correct collection name.

### Duplicate Member Email Prevention
Before the fix, coaches could create multiple members with the same email address, leading to authentication conflicts and data integrity issues. The solution added a pre-creation check that queries the `members` collection for existing entries with the same email before allowing creation.

### Intake Form Race Condition
When a new member completes the intake form, `createUserWithEmailAndPassword` fires `onAuthStateChanged` before the `members` document is written to Firestore. This means neither the `members` nor `coaches` collection has a document for the user yet. The `AuthContext` handles this by defaulting to the `member` role when no profile document is found, which is safe because new users from intake are always members, not coaches.

## Known Performance Risks

### GIF Memory Consumption at Scale
When a coach has 500+ movements with GIF thumbnails, loading all GIFs simultaneously can consume significant memory, especially on mobile devices. The current mitigation uses `FlatList` virtualization to only render visible items, but the GIFs still consume memory when scrolled into view. Future work should consider converting GIF thumbnails to static image thumbnails (first frame) for list views, loading the animated GIF only when the movement is focused or selected.

### Client-Side Sorting Performance
The app performs client-side sorting and filtering for movement and workout libraries using `useMemo`. This works well for libraries under a few hundred items but may become a bottleneck for very large libraries. If performance issues arise, consider implementing server-side sorting via Firestore composite indexes.

## Architectural Decisions Worth Preserving

### Effective Claims Pattern
The `effectiveClaims` pattern in `AuthContext` is the cornerstone of the admin impersonation feature. It creates a modified copy of the auth claims with the overridden `coachId`, allowing all downstream components to work without modification. This pattern must be preserved and extended to any new auth-dependent features.

### Audit Logging for Impersonation
Every admin impersonation event (start and end) is logged to the `eventLog` collection with a fire-and-forget pattern. This provides an audit trail without blocking the UI. The same pattern should be used for any sensitive admin operations.

### Soft Deletes Over Hard Deletes
The platform uses `isArchived` flags for soft deletion of movements and workouts rather than hard deletes. Firestore rules enforce `allow delete: if false` for these collections. This preserves data integrity and allows for potential recovery. New collections should follow the same pattern.

### Cache-First Service Worker
The service worker uses a cache-first strategy with version-based cache busting. Static assets under `/_expo/static/js/` are cached immutably (1-year max-age), while the SPA entry point (`/index.html`), service worker, and manifest are never cached. This ensures users always get the latest app shell while benefiting from cached static assets.
