# We Stay Fit — Milestones

## M-U1 — App Shell & Infrastructure (IN FLIGHT)

Second first-party app scaffold, own Hosting site, own functions codebase, zero-claims invariant enforced. See `CURRENT_STATE.md` and `ARCHITECTURE.md`.

## M-U2 (planned) — Auth + First Firestore Read

Add Firebase Auth (email/password + Google) and a single Firestore read from a WSF-owned collection. First Firestore rules block for WSF. First real page beyond `/health`.

## M-U3 (planned) — Interest → App Bridge

Wire the Lovable-side WSF interest capture (`interest_responses`) to the Firebase-side WSF app via an explicit, user-triggered conversion path (no dual-write, no auto-conversion — see `LOVABLE_HANDOFF.md`).

## M-U4 (planned) — Champion Campaigns Landing Surface

WSF-app-side read view of `champion_campaigns` for authenticated campaign owners. Still no auto-conversion; explicit one-way flow only.

## M-U5+ (backlog)

- Universal Communities Charter surface implementation.
- Native app (Expo Go → EAS build → TestFlight) once app shell has proven web behavior.
- Analytics event schema for WSF (separate namespace from GoArrive).

Milestones after M-U1 will each have their own dispatch spec.
