# Package E — deployment delta

**Branch:** `claude/wsf-package-e-display-auth`
**Deployed baseline:** `1cbf231` — unchanged. Nothing in this document has been deployed.
**Status:** source implementation pending acceptance and hosted verification (RISKS.md
R-WSF-E1). Do not deploy on the strength of this document alone.

This is the exact intended shape of a deployment of this branch, listed function by
function. "22/22" is not a delta and never was: it is a count of what exists, which says
nothing about what changes, and it reads as reassurance while hiding the one function that
does not exist yet.

## Functions codebase `westayfit`

One deploy command, `--only functions:westayfit`, redeploys the whole codebase. Every
function below is touched by the deploy whether or not its behaviour changed, so the useful
split is not "deployed / not deployed" — it is created, changed, and carried along.

### CREATED — 1

This does not exist in the deployed project. It is a create, not an update, and it is the
one function whose absence would make the deploy look successful while the control it backs
does nothing.

| Function | What it is |
| --- | --- |
| `wsfSetGoalDisplayAuthorization` | The Champion-only write that sets or clears a goal's `aggregateDisplayAuthorized`. Strictly boolean. Works on a closed goal. |

### CHANGED HANDLER BEHAVIOUR — 6

Redeployed with different behaviour. Each one is a place where a caller who is served today
may be refused after the deploy.

| Function | What changes for callers |
| --- | --- |
| `wsfGoalPulse` | No longer answers on possession of a `goalId`. Requires an active membership in the goal's community, or an explicit per-goal display authorization. `contributorCount` is gone from the response. The eligibility check runs before the cache, so a revocation takes effect immediately rather than after the cache TTL. |
| `wsfChallengePulse` | Became an active-member read. An anonymous caller holding a real `challengeId` is refused. The cache moved below the membership check; it was previously keyed only by `challengeId` and served across communities. |
| `wsfContribute` | The replay branch no longer returns current shared state to a caller who is no longer an active member. `sharedTotal`, `target`, `unit` and `status` became optional in the response for that reason. Recording and own credit are unchanged and still idempotent. |
| `wsfCheckIn` | The same replay correction. `totals` became optional. |
| `wsfMyContribution` | A caller who is neither an active member nor the holder of their own record now gets the unknown-goal answer. A former member still reads their own credit, and a correction that zeroes it does not erase their history. |
| `wsfListGoals` | Also returns closed goals that are still display-authorized, so the revoke control stays reachable after closure. Each listed goal now carries `aggregateDisplayAuthorized`. A closed goal that was never authorized is still omitted. |

### CARRIED ALONG, BEHAVIOUR UNCHANGED — 16

Redeployed by the codebase deploy; handler code is unchanged from `1cbf231`.

`wsfAdjustGoal`, `wsfCreateCommunity`, `wsfCreateGoal`, `wsfDesignateChampion`, `wsfHealth`,
`wsfJoinCommunity`, `wsfLeaveCommunity`, `wsfListChallenge`, `wsfMyCommunities`,
`wsfPreviewCommunity`, `wsfReinstateMember`, `wsfRemoveMember`, `wsfResetJoinCode`,
`wsfSaveProfile`, `wsfSendPasswordResetEmail`, `wsfSendVerificationEmail`

**Total exports after deploy: 23** (22 before, plus the one created).

## What a successful deploy looks like

`firebase functions:list` before and after. The after-list must contain
`wsfSetGoalDisplayAuthorization` and must still contain all 22 names from the before-list.
A deploy that reports success without that name having appeared has not deployed Package E,
whatever else it did.

## Data migration: none, and that is the decision

No backfill. No script. Nothing writes `aggregateDisplayAuthorized` to an existing document.

**Every goal that already exists will have public display OFF after this deploy**, because
absent is false by decision — an existing goal carries no such field and is treated as
unauthorized. This is not a gap to be closed before or after the deploy. It is the intended
state, and it is what makes the permission a decision somebody made rather than a default
somebody inherited.

For anyone preparing a demonstration or a staging smoke: **synthetic test goals must be
authorized deliberately, one at a time, through the tested control** — sign in as the
community's Champion, open the community screen, use the display-permission control on that
goal. Do not bulk-enable. Do not write the field directly to Firestore, and do not call the
callable by hand. Both of those produce an authorized goal without exercising the path a
Champion uses, which is the only part of this that has not been proven against a hosted
environment.

## Client

The web build must be rebuilt and redeployed for any of the interface behaviour to exist —
the Champion control, the closed-goal rendering, the truthful saving / confirmed / unknown
states, the per-goal scoping of those outcomes, and the display screen's session rules all
live in the client bundle. A functions-only deploy leaves the control absent while the
boundary tightens, which is a coherent state but not the intended one.

The follow-up corrections after the first review are client-only. They changed no callable,
so the function lists above are unchanged by them. Two are worth naming for whoever runs the
hosted smoke, because both are about what a screen shows after a permission changes:

- **A display refusal ends that display's polling session.** Once the display is refused it
  stays blank, and it does not come back on its own even if the permission is restored. The
  way back is the **Check again** button on the refused screen, which starts a fresh
  session. A smoke that revokes, re-authorizes, and then waits for the display to recover by
  itself will wait forever, and that is correct behaviour rather than a fault.
- **Each goal's control keeps its own outcome.** A warning left on one goal stays there
  while another goal is changed, and it leaves only when it is settled or dismissed with its
  own **Dismiss this notice** button.
