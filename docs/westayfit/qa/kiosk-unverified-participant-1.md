# KIOSK-UNVERIFIED-PARTICIPANT-1: QA record

| | |
|---|---|
| **Packet** | Queued #365 `6041743819`, released #365 `6041849013`. |
| **Owner policy** | #365 `6041359966` (KIOSK-SCAN-START-1). |
| **Base** | `claude/wsf-app-shell@245c771722d00fb6b5d0c03b867ae423d426e308`. |
| **Proof type** | Source-only. Emulator `demo-wsf-local`. Synthetic fixtures only. |

## What changed (`functions-westayfit/src/index.ts`, 2 gates)

1. **`wsfSaveProfile`** no longer requires `email_verified`. The caller is still a real authenticated Firebase account, and the behaviour that stays the same is:
   - it only ever writes `wsfMemberProfiles/{auth.uid}`, and request fields cannot name another uid (tested);
   - display-name validation, the accepted terms and privacy stamps, and the createdAt and update semantics are unchanged.
2. **`JOIN_REQUIRES_EMAIL_VERIFIED`** flips from `true` to `false`. This is the one-line policy switch that `wsfJoinCommunity` and `wsfJoinViaMarker` both use through `assertJoinEmailVerified`. Every other admission control stays:
   - a saved profile is required;
   - the link or marker must be valid, for a link-joinable, active community;
   - a removed member stays refused;
   - an unknown, private or paused target gets the same generic `not-found`;
   - membership ids stay deterministic, and the preview rate limits are unchanged.

**Unchanged:**
- The organizer gates (`wsfCreateCommunity`, `wsfCreateGoal`, `wsfCreateCombinedGoal`) still refuse unverified callers; their existing suites pass.
- `wsfSendVerificationEmail`.
- Rules, providers, IAM and secrets.
- `emailVerified` is never faked, and there is no anonymous or guest identity.
- The station attempt ledger is still the only kiosk contribution path.

Contribution, member reads, event and turn admission, and the own-receipt paths **never had** an email-verification gate. The new tests pin that, and they pass on base too.

## Callable contract delta (for Lovable)

| Callable | Before | After |
|---|---|---|
| `wsfSaveProfile({displayName})` | unverified → `failed-precondition` "Verify your email before saving your profile." | unverified → `{created:true\|false}` like a verified caller; `invalid-argument` for a bad name, unchanged |
| `wsfJoinCommunity({joinCode})` | unverified → `failed-precondition` "Verify your email before joining a community." | unverified → `{groupId, alreadyMember}`. Still: `unauthenticated` signed out; `failed-precondition` "Complete your profile before joining a community." with no profile; `not-found` "This link is not valid." for any invalid, private, paused or removed case |
| `wsfJoinViaMarker({markerSlug})` | same verification refusal | unverified → `{groupId, goalId, alreadyMember}`, with the same remaining refusals as `wsfJoinCommunity` |
| `wsfContribute`, `wsfMyContribution`, `wsfListGoals`, `wsfGoalPulse`, `wsfJoinTurnLine`, `wsfMyTurn` | no verification gate | unchanged (now pinned for unverified accounts) |

**App UI is not in this packet.** The canonical app's sign-up flow still routes an unverified account to `/verify-email`. Changing that journey, or Lovable's, is a separate UI slice.

## Proof (emulator, synthetic)

**Reserved suites:** `wsf-save-profile`, `wsf-join-community`, `wsf-marker-entry`, `wsf-contribute`, `wsf-package-e-member-access` and `wsf-turn` pass together, 135/135. They cover:
- an unverified profile is created; the same uid verifies later and updates the same profile, with createdAt and the consent record kept;
- an unverified account cannot write another uid's profile;
- an unverified link join; a retry returns `alreadyMember`; the verified re-tap gives the same single membership;
- an unverified account is still refused for private, paused, unknown and removed targets, and when it has no profile;
- an unverified marker join, idempotent, keeping the same membership when verified; every marker refusal still applies;
- an unverified phone contribution with its own receipt; an idempotent retry; the same attempt and credit after verifying;
- non-member, removed, closed-goal and zero-count contributions are still refused;
- an unverified member's reads (`wsfListGoals`, `wsfMyContribution`, `wsfGoalPulse`) equal the verified view; non-members and removed members get the same refusal code as a verified caller;
- an unverified member joins the turn line, sees its own place, and a retry returns the same entry; the verified view is identical; a non-member is refused with the verified code.

**Fail-before:** on the base `index.ts` with these tests, exactly the 6 gate-dependent tests fail. The downstream tests pass on base, which confirms those paths were never gated.

**Full callable suite:** 31 suites, **557/557**, including the organizer verification gates. Deploy-config: 17/17. `tsc` is clean.

## Staging delta (not performed)

- No new function, export, collection, rules, index, IAM or secret change. Inventory is unchanged.
- It is a **behaviour change to three existing deployed callables** (`wsfSaveProfile`, `wsfJoinCommunity`, `wsfJoinViaMarker`). It takes effect only through the reviewed full-deploy path.
- Nothing here is live until deployed. The source tests do not prove the hosted journey.

## Not in this slice
- The expected-turn station mutation contract.
- The stale station-completion race.
- The queue-read failure UX and polling restart.
- Self-service orchestration.

All of these belong to separate follow-on slices (#365 `6041748092`).
