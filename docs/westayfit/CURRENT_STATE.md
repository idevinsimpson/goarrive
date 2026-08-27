# We Stay Fit — Current State

Anchor: `092839b1fa3ff43b0d0139e2b56d0f1662d4cfdf` (origin/main at M-U1 dispatch).

## Where WSF Is Right Now

M-U1 (app shell + infrastructure) has landed on `feat/westayfit-foundation` (PR open, not merged) and is live on the `staging` Hosting channel at <https://westayfit-app--staging-x4m0iwln.web.app>. Before this milestone, WSF existed only as marketing surface on Lovable; there was no first-party Firebase app for WSF.

Deployed 2026-08-26. Full receipt in `RELEASES.md`.

## What Ships In M-U1

- Second Firebase Hosting site `westayfit-app` with a live staging channel URL.
- Two routes: `/` (brand shell, `noindex`) and `/health` (build stamp, `noindex`).
- Firebase web SDK initialized (no reads, no writes).
- Second Cloud Functions codebase `westayfit` with one callable: `wsfHealth` (auth-required, returns `{ok: true}`, no Firestore).
- Zero-custom-claims static guard passing.
- Vitest smoke suite green.
- Playwright specs (`/`, `/health`, unknown route, axe on `/`) green against the staging channel URL.
- GoArrive proven unchanged via `git diff --stat` and `firebase functions:list`.

## What Is NOT In M-U1

- No Firestore reads or writes from the WSF app.
- No auth flows beyond the SDK init.
- No PWA manifest, no service worker, no fonts, no Safari CSS in the injected meta.
- No native app configuration beyond bundle ID declaration.
- No Lovable-side changes.
- No production deploy — staging channel only.

## Next Milestones

See `MILESTONES.md`.
