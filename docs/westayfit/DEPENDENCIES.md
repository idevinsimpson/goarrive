# We Stay Fit — Dependencies

## Runtime — App (`apps/westayfit/`)

- `expo` ~54 (matches GoArrive to keep Expo/React-Native versions coherent across the monorepo).
- `expo-router` ~6.0.23.
- `react` 19.1.0, `react-dom` 19.1.0, `react-native` (Expo-managed version), `react-native-web`.
- `firebase` ^11.4.0 — web SDK only, initialized in `apps/westayfit/src/firebase.ts` (no reads, no writes in M-U1).

## Runtime — Functions (`functions-westayfit/`)

- Node 20 (matches GoArrive `functions/` runtime).
- `firebase-functions` ^4.9.0 — v2 API (`firebase-functions/v2/https`).
- `firebase-admin` ^12.7.0 — imported for parity but not used to write claims (see zero-claims invariant).

## Dev — App

- `typescript` ~5.9.2 (matches GoArrive).
- `vitest` ^4.1.2 + jsdom for the smoke suite.
- `@playwright/test` ^1.59.1 for the e2e suite.
- `@axe-core/playwright` ^4.12.1 for accessibility check on `/`.

## Dev — Functions

- `typescript` ~5.9.2.
- `firebase-tools` — used via `npx -y firebase-tools@latest` for deploys; not pinned as a repo dev-dep to avoid version drift with GoArrive's deploy path.

## Build / Deploy

- Firebase CLI via `npx -y firebase-tools@latest`.
- Service account key at `~/dev-westayfit/.secrets/firebase-service-account.json` (hardlinked from `~/dev-goarrive/.secrets/`), exported as `GOOGLE_APPLICATION_CREDENTIALS`.

## External / Shared With GoArrive

- **Firebase project `goarrive`** — shared. WSF adds Hosting site `westayfit-app` and functions codebase `westayfit`.
- **Firebase Auth pool** — shared. Same users can exist in both app contexts (see `DATA_OWNERSHIP.md`).
- **`firestore.rules`, `storage.rules`** — shared files, dual-regression required.

## Project-Level Firebase Console Settings (R-9)

These are not packages and not files. They are console settings that belong to
the Firebase project, were configured for GoArrive, do not appear anywhere in
this repo, and that WSF inherits whether or not anyone intended it. Four
production defects in M-U2 came from this list; none was catchable by any test,
because nothing in the repo can see them.

They are recorded here so a future change to one of them can be *noticed*. A
value nobody wrote down cannot be diffed.

**Rule for this section: only record what has actually been observed.** A
guessed value is worse than a blank, because it reads like evidence. Anything
unconfirmed stays under Unverified until someone looks.

### Verified

| Setting | Value | How it was established |
|---|---|---|
| Auth providers | Email/password enabled | Real signup succeeded on staging, 2026-09-01 |
| Auth pool | Shared with GoArrive | `auth/email-already-in-use` on a GoArrive address (R-9) |
| `authDomain` | `goarrive.firebaseapp.com` | `apps/westayfit/src/firebase.ts` |
| Auth **custom action URL** | `https://goarrive.web.app/reset-password` | Read off a minted verification link. **The route does not exist** — see R-9 |
| Default action handler | `https://goarrive.firebaseapp.com/__/auth/action` | Works; it is what the custom URL overrode |
| App Check | Not enforced | No enforcement in source, and a live callable succeeded with `app: "MISSING"` |
| Live Firestore ruleset | `1e14eab9-a23f-437f-8418-918b9eaefe65`, 1259 lines | Fetched from the Rules API after the M-U2 deploy |
| Storage bucket | `goarrive.firebasestorage.app` | In WSF config; WSF never imports Storage |
| Functions region | `us-central1` | `functions-westayfit/src/index.ts` |
| Hosting sites | `goarrive` (default), `westayfit-app` | `firebase.json`, `firebase.westayfit.json` |

### Unverified — assumptions in use, not yet checked

| Setting | Why it matters | Status |
|---|---|---|
| Auth email sender | Verification mail did not arrive at a real Gmail address on 2026-09-01. Presumed to be Firebase's default `noreply@goarrive.firebaseapp.com`, which is routinely spam-filtered — **presumed, not observed**, since no message was received to inspect | Open (R-9) |
| Custom SMTP | Whether one is configured at all. GoArrive sends its own mail through Resend in `functions/src/notifications.ts`, which is a separate path and says nothing about the Auth setting | Open |
| Authorized domains | The staging channel works today, so it is either listed or irrelevant for email/password. The mechanism has not been confirmed, and a new custom domain would need it | Open |
| Email enumeration protection | When enabled, Firebase masks `auth/email-already-in-use`. It is surfacing, so it is probably off — probably is not verified, and turning it on would change the copy in `src/authErrors.ts` | Open |
| Password policy | WSF enforces 8 characters client-side only. Whether a project-level policy exists is unknown; a stricter one would reject signups the UI accepted | Open |
| **Live** Firestore index set | 48 indexes and zero `wsf*` is what the **repo file** says. The live set has never been fetched and could differ — which is the whole hazard in R-10 | Open |

### When to update this

Before any milestone ships work touching auth, email, storage, or enforcement:
list the console settings that path depends on, confirm their current values,
and move them from Unverified to Verified with how you checked. Do not delete
an Unverified row to tidy the table — an open question is the finding.

## What Is NOT A Dependency

- No EAS build service (out-of-scope for M-U1).
- No shared UI/theme package with GoArrive — WSF has its own theme.
- No shared functions library — WSF functions cannot import from `functions/src/`.
- No custom-claims-based auth — see `ARCHITECTURE.md` (f).
- No PWA/service worker/manifest tooling for M-U1.
