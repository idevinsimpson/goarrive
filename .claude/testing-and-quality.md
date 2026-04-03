# GoArrive Testing & Quality

## Testing Infrastructure
The project uses Jest as its testing framework, configured through `jest.config.js` and `jest.setup.js` in the `apps/goarrive/` directory. The test runner is `jest-expo`, which provides Expo-specific test utilities and transforms.

Test files are located in `apps/goarrive/__tests__/` for frontend tests and `functions/src/__tests__/` for Cloud Functions tests. TypeScript type checking can be run independently via `tsc --noEmit` using the `ts:check` script.

## Quality Checklist for New Features
When implementing a new feature, the following checks should be performed before considering the work complete.

**Auth Context Compliance**: Verify that any Firestore queries or Cloud Function calls use `effectiveUid` or `claims.coachId` from `useAuth()`, not `user.uid` directly. Test the feature while impersonating a coach as an admin.

**Tenant Isolation**: Confirm that all queries include proper `coachId` scoping. A coach should never see another coach's data, and a member should never see data outside their assigned coach's tenant.

**Firestore Rules**: If new collections or fields are added, update `firestore.rules` accordingly. Verify that the rules enforce the intended access patterns.

**Soft Deletes**: New collections that represent user-created content should use `isArchived` flags instead of hard deletes. Firestore rules should include `allow delete: if false`.

**Performance**: For list views, ensure `FlatList` virtualization is used. For media-heavy views, use thumbnails for initial loads and swap to full media only when focused.

**Product Language**: Verify that all user-facing copy uses GoArrive terminology (coach, member, movement, Command Center) and does not expose backend jargon.

**Error Handling**: Wrap async operations in try-catch blocks. Use the `ErrorBoundary` component for component-level error handling. Log errors with descriptive context tags (e.g., `[AuthContext]`, `[BulkUpload]`).

## Deployment Verification
After deploying to `goarrive.web.app`, verify the following.

**Service Worker**: Check that the service worker is registered and caching assets correctly. Clear the browser cache if stale assets are served.

**PWA Meta Tags**: Verify that the PWA meta tags, manifest, and Google Fonts are injected correctly in the deployed `index.html`.

**Cloud Functions**: If Cloud Functions were updated, verify they are deployed and responding correctly. Check the Firebase console for any deployment errors.

**Firestore Rules**: If rules were updated, verify they are deployed by checking the Firebase console. Test access patterns from different roles (admin, coach, member).
