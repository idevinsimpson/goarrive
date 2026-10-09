# MEMBER-TRUTH-BACKEND-1: QA record

| | |
|---|---|
| **Packet** | Released by #365 `6029989725` (queued `6029017448`). |
| **This record covers** | Only the isolated B checkpoint, **MEMBER-PREVIEW-LABEL-1** (queued #365 `6035515078`, released `6035517752`). |
| **Base** | `claude/wsf-app-shell@09cc4cb1a2c4732dac5bae0372fa6c54b54935be`. |
| **Proof type** | Source-only. Emulator `demo-wsf-local`. Synthetic fixtures only. |

## Part A (Together crossing): BLOCKED, not in this change

The Director's disposition is #497 `6031313067`. Part A waits on an owner product or authority choice. Two attribution experiments failed the contention gate:

- the single-document gate, #497 `6030402596`;
- distributed slot budgets, #497 `6030791528`.

Both live only on `claude/wsf-w9-member-truth-gate-experiment` (`3223ffac`, `859e119f`), which is not for merge.

**This change touches no crossing source.** The `index.ts` delta is purely additive: 107 inserted lines, 0 removed. `wsfContribute`, `wsfCreateGoal` and `wsfAdjustGoal` are byte-identical to base, and the unmodified base `wsf-target-crossing` suite passes. Integrating B does not complete A.

## Part B: `wsfPublicPreviewLabel`

### Authority
The publication decision is #497 `6030141927`. A label is published only for a goal with **`aggregateDisplayAuthorized === true`**, in a non-sample community. The check uses the same `evaluateGoalAggregateAccess` display route and sample suppression as `wsfGoalPulse`. That function already publishes these same two labels to anyone holding the goal id.

None of the following publishes a label:
- link-joinability or join policy;
- membership, including being a Champion;
- possession of a link or a marker;
- discoverability.

There is no community-only lookup.

### Callable contract (for the Lovable thin consumer)

| | |
|---|---|
| **Name** | `wsfPublicPreviewLabel`, a Firebase callable (HTTPS `onCall`) |
| **Region** | `us-central1` |
| **Invoker** | `invoker: 'public'`. The function is meant for signed-out callers: link unfurlers and a server-rendered `head()` |
| **Credentials** | None. Never send an admin or service-account credential |

**Request.** Exactly one of `goalId` or `markerSlug`:

```http
POST https://us-central1-<staging-project-id>.cloudfunctions.net/wsfPublicPreviewLabel
Content-Type: application/json

{"data": {"goalId": "<goalId>"}}
```
```json
{"data": {"markerSlug": "flag-01"}}
```

**Response, public.** HTTP 200:
```json
{"result": {"visibility": "public", "communityName": "Synthetic public", "goalTitle": "Synthetic authorized wall", "maxAgeSeconds": 60}}
```

**Response, everything else.** HTTP 200, one identical body:
```json
{"result": {"visibility": "none", "maxAgeSeconds": 60}}
```

These cases all return the `none` body:
- authorization absent, false or malformed (`"true"`, `1`);
- unknown goal;
- sample community, missing community, or blank title;
- bad, unknown or inactive marker slug;
- a Firestore-reserved id such as `__abc__`, which passes the shape check, but the read fails;
- a marker whose goal belongs to another community;
- a marker repointed to an unauthorized goal;
- a community id alone, both ids at once, or `{}`, `null`, a string, an array, or a malformed id;
- any read failure.

It never returns `not-found`, so it is not an existence oracle.

**Error.** Only the abuse boundary returns an error:
```json
{"error": {"status": "RESOURCE_EXHAUSTED", "message": "Too many requests. Try again shortly."}}
```
That is HTTP 429, from the shared per-IP preview bucket (100 requests per rolling minute, day-salted IP hash). It fires **before any lookup**, so it reveals nothing about any goal. A consumer should treat it as `none`.

**Labels.**
- Trimmed and capped at 60 characters.
- No member names, counts, totals, target, unit, location, join code, tokens or capabilities.
- The response's only fields are `visibility`, `communityName`, `goalTitle` and `maxAgeSeconds`.

**Caching.**
- `maxAgeSeconds: 60` is the longest a consumer may cache **either** answer.
- A revocation or repoint is reflected by the server on the very next read (tested).
- This is **not** a promise that third-party unfurler caches (iMessage, Slack, WhatsApp) will retract a preview they already stored.
- A goal id never changes meaning.

**Consumer note for Lovable.** `share-preview.ts` `PreviewLabelSource` is synchronous. Feed it from a route `loader` that calls this endpoint with the route's `goalId` or `markerKey`, and map `{visibility:'none'}` and any error to `null`, which is brand-only. **Do not call an undeployed endpoint live.** Until the function is deployed to staging, keep `noApprovedPublicSource`.

### Proof on this exact head (emulator, synthetic)

| Suite | Result |
|---|---|
| `wsf-public-preview-label` | 13/13 |
| Affected callable suites, together: `wsf-marker-entry`, `wsf-preview-community`, `wsf-goal-pulse`, `sprint-w8-social-visibility`, `wsf-overnight-privacy-audit`, base `wsf-target-crossing` | 142/142 (all 7 suites) |
| `deploy-config` | 17/17 |
| `tsc` | clean |

**Mutants.** Each one is re-run on this head and each fails the suite:
- marker/community binding removed;
- "exactly one target" loosened;
- label cap removed;
- marker shape validation bypassed;
- rate limit removed;
- display-route check removed;
- the handler's `catch` removed. The W4 finding (#394 `6035952721`) was that this mutant went uncaught; it is now killed by Firestore-reserved ids such as `__abc__`, which pass the id shape check but make the read throw.

**Equivalent survivor.** Removing the explicit `isAggregateDisplayAuthorized` check still passes. `evaluateGoalAggregateAccess(goal, null)` grants the display route only to an authorized goal, so the evaluator enforces the same rule and no behaviour changes.

These are W9's own results. They are not the independent journey and privacy QA.

## Staging deployment delta (not performed; requires the reviewed full-deploy path)

- **Functions:** +1 export, `wsfPublicPreviewLabel` (`us-central1`, Gen 2 callable). The codebase `westayfit` goes from 51 to **52** callable exports. Do not reuse an older inventory.
- **IAM:** `invoker: 'public'`, which grants `run.invoker` to `allUsers` on this one function at deploy. That is the same posture as the existing `wsfPreviewCommunity`, `wsfGoalPulse` and `wsfResolveMarker`. No other IAM change.
- **Data:**
  - Reads `wsfGoals`, `wsfCommunityGroups` and `wsfMarkers`.
  - Writes only the existing `wsfPreviewRateLimits` buckets.
  - No new collection, no Firestore rules change, no index change, no secret.
- **Not included:** hosting, the app, Lovable publication, production, public opening and GoArrive are all unaffected.
