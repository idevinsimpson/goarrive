# Release boundary — `claude/wsf-app-shell` `37367fd` against the staging pin `c8f38e3`

Prepared 2026-09-23 ~12:50Z on the Director's continuation (#365 `5795073803` §3).
**Nothing in this note is a deployment, an authorization, or a change to what
staging serves.** Staging still serves the pinned candidate `c8f38e3` (pin PR
#437, `main` `340e141`, run 46). This note only sorts the deltas that
app-shell has accumulated since that pin into the two release classes the
owner's authorities distinguish, so the owner can decide which release action
each one needs.

## The two classes

| Class | Authority | Covers |
| --- | --- | --- |
| **A — frontend-only** | the standing UI-only staging authority (`5769298622` under cadence rule `5764947092`): exact candidate pinned and reviewed, **no shared / backend delta**, gate passes | the hosted web bundle only |
| **B — backend / index / shared config** | **explicit owner release authorization; not covered by A** | Cloud Functions, Firestore indexes, Firestore rules, hosting / project config, IAM, secrets |

## What `c8f38e3..37367fd` contains

Five merges and three lead commits:

| Landed as | From | What | Class |
| --- | --- | --- | --- |
| `ba774ef` | #435 (W2) `8165b52` / product `1fd669f` | responsive public display: `app/display/[goalId].tsx`, `src/ui/displayLayout.ts`, evidence | **A** |
| `d86620c` | #436 (W1B) `84acea5` | kiosk idle-Finish: `src/kioskSession.ts`, `app/contribute/[goalId].tsx`, its spec, evidence | **A** |
| `2fffcf3` | #433 (W6) `e0546b3` | `/goals/new` built to the accepted target: `app/goals/new.tsx`, gated design-target route + targets, producer | **A** |
| `3e6a86b` | #441 (W8) `bfc422a` | social community: presence, momentum, per-community privacy — **see the split below** | **A + B** |
| `37367fd` | #446 (W6) `1116695` | one `toBeVisible()` assertion in the Goal Setup producer + README line (tests only; nothing deployed) | **A** (no runtime change) |
| `1041a1f` | L0 | `firebase.westayfit.emulators.json`: mirror of the `/community/*/members` rewrite — **emulator-only config, not deployed** | none |
| `9a65324` | L0 | `@react-navigation/bottom-tabs` declared as a direct dependency (`package.json`, lockfile) | **A** (build input) |
| `740a763` | L0 | `scripts/westayfit/inject_meta.py`: the build guard ignores route-group export duplicates (+ its vitest) | **A** (build tooling) |

## The #441 split — the one merge that carries class B

W8's social work is one merge but two release classes, and its frontend half
depends on its backend half.

**Class B — requires explicit backend / index release authorization:**

| File | Delta | Release action it needs |
| --- | --- | --- |
| `functions-westayfit/src/index.ts` | +727 / −7: three new callables — `wsfSetCommunityVisibility`, `wsfCommunityMembers`, `wsfCommunityActivity` (invoker policy: not `public`; the public set stays at 15 per W5's corrected classification `5791422945`) | a Cloud Functions deploy of those three callables, with their invoker policy verified after deploy |
| `firestore.indexes.json` | +1 composite index: `wsfContributions` on `communityGroupId ASC, createdAt DESC` | an index deploy; Firestore builds it asynchronously, and the members / activity queries **fail until it is built** |
| `firebase.westayfit.json` | +1 hosting rewrite: `/community/*/members → /community/__dynamic/members.html` | deploys with hosting, but it is shared project config, so it is outside the "no shared delta" wording of authority A — the owner decides whether it rides the hosting deploy or waits for the B release |

Not changed: `firestore.rules`, `storage.rules`, IAM, secrets, `.firebaserc`.

**Class A half of #441** (`app/community/[groupId]/index.tsx`, `members.tsx`,
`app/settings.tsx`, `app/settings/privacy.tsx`, `app/you.tsx`,
`src/ui/CommunityPresence.tsx`, the design-target preview): these screens
**call the three new callables and run the indexed query**. Shipped as a
frontend-only deploy against the current backend they would fail at runtime
(missing callables surface as CORS / not-found — exactly what W9 saw against a
stale 46-function emulator, `5794840586` §10).

## What this means for the candidate

1. **`37367fd` is a full candidate, not a UI-only one.** Authority A cannot
   promote it on its own: the bundle is inseparable from the #441 backend
   half. Promoting it needs the class-B release first (functions, then the
   index, then hosting), each an explicit owner action.
2. **There is no frontend-only cut of the overnight work to promote instead.**
   #435, #436, #433 and the lead commits are class A, but they sit on top of
   #441 on the app-shell branch; a branch without #441 does not exist and is
   not the sprint's candidate. Cutting one would be a new branch and a new
   review — the Director's §3 says preserve `c8f38e3` instead.
3. **The pending shell migration (W9, #443) is class A** — routes, layouts,
   `MemberTopBar` / `MemberTabBar`, specs, evidence; no functions, index or
   rules change (verified by git at `7466158`). It does not change the class
   of the candidate; it inherits #441's class B dependency.
4. **Order, when the owner authorizes B:** deploy the three callables →
   confirm their invoker policy → deploy the composite index and wait for
   READY → then hosting (with the members rewrite) from the exact reviewed
   candidate → the staging status stays distinct from acceptance. Staging's
   label remains "email delivery blocked at runtime; signup smoke incomplete".

Prepared by L0. Not deployed, not authorized, not a change to `main`.
