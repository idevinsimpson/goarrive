# ANON-GATE-1: anonymous-provider tokens refused at every WSF callable auth site

**Authority:** queue #365 `6077731662`, release `6077733181`.

**Context:** the production forensics #365 `6077561449` §4, and the owner's pivot `6077650353` §5, which makes this exposure a release gate.

**Base:** `claude/wsf-app-shell` at `ec162d17a0540e936741027f9b8f90dd372cfaf4`. Source-only. Nothing deployed.

## Why

The shared `goarrive` project keeps **Anonymous sign-in enabled**, because GoArrive's share page signs guests in anonymously (`apps/goarrive/app/share/[shareId].tsx`). Any browser can therefore mint an ID token whose `firebase.sign_in_provider` is `anonymous`.

Every WSF callable is public at the Cloud Run layer (#599 §3). Each one relies on its own `request.auth` check, and that check accepts such a token. So an anonymous caller could write under a throwaway uid:
- create a `wsfMemberProfiles` document;
- store a profile photo of up to 160 KB;
- read account-scoped answers.

## What changed

- **`functions-westayfit/src/anon-gate.ts`** (new, pure):
  - **`requireRealIdentity(request)`:** a token whose `firebase.sign_in_provider` is `anonymous` gets `failed-precondition` with the message **"Sign in with an email account."** A missing token gets `unauthenticated`, as a backstop.
  - **`optionalRealUid(request)`:** returns the caller's uid, or `null` for a signed-out or anonymous caller.
- **`functions-westayfit/src/index.ts`:** `requireRealIdentity(request)` is inserted on the line right after each existing `if (!request.auth)` check, at **42** callables. Each site's own signed-out answer is unchanged:
  - `unauthenticated` with its own message;
  - `wsfChallengePulse`'s not-found.

  The gate runs before any token field or data is read: before the email-verified checks, and before `wsfSendVerificationEmail` reads `token.email`.

### Gated sites (line of the existing check at `ec162d17`)

wsfSaveProfile `:136` | wsfCreateCommunity `:200` | wsfSendVerificationEmail `:538` | wsfJoinCommunity `:918` | wsfJoinViaMarker `:1127` | wsfResetJoinCode `:1359` | wsfRemoveMember `:1434` | wsfLeaveCommunity `:1488` | wsfReinstateMember `:1539` | wsfDesignateChampion `:1590` | wsfListChallenge `:1846` | wsfCheckIn `:1990` | wsfMyCommunities `:2196` | wsfChallengePulse `:2321` | wsfCreateGoal `:3111` | wsfContribute `:3757` | wsfMyContribution `:4636` | wsfListGoals `:4984` | wsfSetGoalDisplayAuthorization `:5157` | wsfAdjustGoal `:5213` | wsfApproveStation `:6062` | wsfListStations `:6450` | wsfRevokeStation `:6517` | wsfCreateCombinedGoal `:6802` | wsfCloseCombinedGoal `:7069` | wsfRepairCombinedGoal `:7264` | wsfEventContext `:8568` | wsfJoinTurnLine `:8628` | wsfMyTurn `:8824` | wsfTurnReady `:8922` | wsfLeaveTurnLine `:9009` | wsfCompleteMyTurn `:9751` | wsfSetCommunityVisibility `:9987` | wsfCommunityMembers `:10106` | wsfMyProfilePhoto `:10276` | wsfSetProfilePhoto `:10300` | wsfRemoveProfilePhoto `:10354` | wsfSetPortraitDecision `:10389` | wsfSetCommunityPhotoVisibility `:10419` | wsfCommunityFaces `:10448` | wsfCommunityFacePhotos `:10545` | wsfCommunityActivity `:10746`

The packet's named roots (`:136`, `:918`, `:1127`, `:10276`, `:10300`, `:10354`, `:10389`) are all in this list.

### Optional-uid sites: `request.auth?.uid ?? null` becomes `optionalRealUid(request)`

| Callable | Line at `ec162d17` |
|---|---|
| wsfResolveMarker | `:1099` |
| wsfGoalPulse | `:4485` |
| wsfGoalRecentAdditions | `:4567` |
| wsfCombinedGoalPulse | `:7722` |

At these four sites, an anonymous caller is treated exactly as signed out: it gets the display route or the uniform refusal, never the member route.

### Untouched

- **Public callables:** `wsfPreviewCommunity`, `wsfResolveMarker` (apart from its optional uid, above) and `wsfPublicPreviewLabel`.
- **`wsfHealth`.** Its check at `:93` is the 43rd `if (!request.auth)`. The packet names `wsfHealth` untouched, and it returns only `{ ok: true }` and reads or writes no data, so it is **not** gated. The source test pins that exemption.
- **The station and turn-display callables** authenticate with a station credential or pairing id and never read `request.auth`, so they are unchanged.
- **GoArrive:** its functions and its share page are untouched, and the **Anonymous provider stays enabled** on `goarrive`.
- **No rules, index, IAM, provider or data change.**

## Behaviour notes

- **`wsfSendVerificationEmail`** already refused a token with no email address (`:541-544`). An anonymous token now gets the gate's message first.
- **`wsfChallengePulse`** validates `challengeId` before its auth check. The refusal comes after that validation and before any cache or Firestore read, so it does not depend on whether the challenge exists. It is not an existence oracle.
- **A token with no `firebase` claim** (every existing test fixture), `password`, `custom` and federated providers all pass unchanged.

## Tests

The suite is `functions-westayfit/tests/callable/wsf-anon-gate.test.ts`, 97 tests:
1. **Helpers:** the refusal code and message, acceptance for password, other providers and a token with no claim, and `optionalRealUid`.
2. **Source:**
   - every `if (!request.auth)` is followed by `requireRealIdentity(request)`, exactly the 42 above, with `wsfHealth` the only exemption;
   - no `request.auth?.` read remains;
   - exactly the four optional-uid callables use `optionalRealUid`;
   - the public callables carry no gate.
3. **Refusal:**
   - each of the 42 callables, called with `auth.token.firebase.sign_in_provider = 'anonymous'`, answers `failed-precondition` / "Sign in with an email account.";
   - the write roots leave no profile, photo or membership for the anonymous uid;
   - a signed-out caller still gets `unauthenticated` at the roots.
4. **Acceptance:** each of the 42 callables, called with a `password` token and with a token that has no `firebase` claim, never answers with the anonymous refusal. A password account saves its profile at the `wsfSaveProfile` root.
5. **Optional uid:** `wsfGoalRecentAdditions` and `wsfGoalPulse` on a member-only goal:
   - the member's uid on a password token reads it;
   - the same uid on an anonymous token gets the signed-out refusal, with the same code and message.

**Placement.** The suite sits in `tests/callable/`, inside the reserved `functions-westayfit/tests/`. The packet named `tests/anon-gate.test.ts`, but no Jest config matches the root of `tests/`. `jest.callable.config.cjs` runs only `tests/callable/**`, and the configs are outside the reservation.

**Run**, from the repository root:
```sh
npx -y firebase-tools@15.30.1 emulators:exec --only firestore,auth --project demo-wsf-local \
  --config firebase.westayfit.emulators.json "cd functions-westayfit && npm run test:callable"
```

**Results:**

| Run | Result |
|---|---|
| The new suite | **97/97** |
| Fail-first: the same suite against the ungated `index.ts` at `ec162d17` | **47 failed**: the 42 refusals, the write roots, two source checks and both optional-uid checks |
| Full callable suite | **701/701** in 35 suites |
| `test:deploy-config` | **17/17** |
| `test:rules` | **28/28** |
| Mutants (11) | **all killed**: helper never/always anonymous, wrong code, wrong message, optional uid leaking, missing backstop, a gate dropped at two sites, the gate moved after the join email check, an optional site reverted, `wsfHealth` gated |

## Deployment

None here. Per #365 `6077561449`, this commit becomes the gated production candidate if the owner names B, or the first fast-follow if the owner names A. Either way it goes through the reviewed runbook (#600). This packet changes nothing that is served.
