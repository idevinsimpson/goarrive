# We Stay Fit — Data Ownership

Reconciled: September 26, 2026.

This document defines ownership boundaries. Exact live schema/source must still be read
from current code/rules before a migration or release.

## 1. Rule

Every active production datum has one owning system.

Do not create a permanent second active membership, contribution, goal, or permission
record merely to keep a prototype or marketing surface synchronized.

## 2. Firebase / WSF-owned active product data

Current WSF source/rules include active WSF collections and records. The old statement
that WSF has "zero collections" is historical M-U1 evidence and is no longer current.

Direct member/community identity collections include:
- `wsfMemberProfiles`
- `wsfCommunityGroups`
- `wsfMemberships`

Current server code also owns goal/challenge/contribution and operational records,
including collections in these families:
- `wsfGoals`, `wsfGoalCounters`, `wsfGoalMemberTotals`, `wsfGoalAdjustments`
- `wsfContributions`, `wsfCheckIns`
- `wsfChallenges`, `wsfChallengeMoves`, `wsfChallengeCounters`,
  `wsfChallengeParticipants`
- `wsfCombinedGoals`, `wsfCombinedCredits`, `wsfCombinedGoalClaims`
- `wsfKioskStations`, `wsfKioskPairings`
- `wsfTurnEntries`, `wsfTurnLines`, `wsfTurnMembers`, `wsfTurnReceipts`
- bounded support/rate-limit/send-audit collections used by current server flows.

This list describes current source families, not an authorization to add new data.
Read current source and Firestore rules for the exact collection/access contract.

WSF community roles live in trusted membership records, not new Firebase custom claims.

## 3. GoArrive-owned data

GoArrive owns its existing coaching product data: individualized coaching relationships,
tailored plans, coach/member communications, Workout Player/programming, scheduling and
coaching billing.

WSF code must not casually reuse GoArrive collections as its community data model.

## 4. Lovable/Supabase marketing-side data

The public marketing/inquiry surface may own approved:
- public content;
- inquiry/business-pipeline records;
- transitional interest/campaign records.

Those records are not active Firebase memberships or contributions.

No automatic bulk conversion, dual-write, or permanent real-time mirror is implied.

## 5. North Star prototype data

The WE Community Home Lovable reference project owns no production WSF truth.

Its sample identities, goals, contributions, invitations, localStorage state and
simulated outcomes are design evidence only and are excluded from real analytics.

## 6. Auth identities

Auth identity and WSF community membership are separate concepts.

WSF does not create a Champion global custom claim. Community authority is derived from
trusted WSF membership/relationship records and server-side checks.

## 7. Shared infrastructure

Firestore rules and indexes are shared deployment surfaces where configured for the
environment. A documentation statement about collection ownership is not permission to
deploy rules/indexes. Follow the current release-control process, drift review and required
regressions.
