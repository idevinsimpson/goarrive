# Staging Admin Account

## Login

- **Email:** `staging-admin@goarrive.fit`
- **Password:** See 1Password entry "GoArrive Staging Admin" (rotate after first use)
- **Role:** `platformAdmin` + `admin: true` custom claims
- **Firebase UID:** `staging-admin-seed-001`

## Purpose

Used to test admin impersonation flows, platform-level dashboard access, and any feature gated
behind `isPlatformAdmin()` Firestore rules or `claims.admin` checks.

## Rotation

1. Sign in to Firebase console → Authentication.
2. Find user `staging-admin@goarrive.fit` and reset the password.
3. Update the 1Password entry.
4. Re-run `node scripts/seed-staging.js` to re-sync custom claims if they were lost.

## Provisioning

Account is created by `scripts/seed-staging.js` section 8. Safe to re-run — it uses `upsertAuthUser`
which skips creation if the UID already exists and always re-sets custom claims.
