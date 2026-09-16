# Package E — staging deployment handoff checkpoint

**Documentation only.** This file changes no source, test, config or build input. Adding it
does not change what is deployed.

## The deployable commit does not move

| | |
| --- | --- |
| **Accepted Package E SHA** | `8e1a3ed485a5c0eadbcb23c1f35becad455923c7` |
| Branch | `claude/wsf-package-e-display-auth` (`idevinsimpson/goarrive`) |
| Source review | **ACCEPTED** by Devin for isolated staging validation. Not production-release approval. |
| Last reported deployed baseline | `1cbf2319c7da135ab1bf2b6019cc28c2b347f682` — still what staging runs |
| Status | SOURCE ACCEPTED; STAGING DEPLOYMENT AND HOSTED VERIFICATION BLOCKED BY ACCESS |

**Build from the exact SHA, not from branch HEAD.** This checkpoint commit sits on top of
`8e1a3ed`, so `git checkout <branch>` yields a different commit. The deployed artifact must
carry the accepted SHA and its build marker must read `8e1a3ed`:

```
git checkout 8e1a3ed485a5c0eadbcb23c1f35becad455923c7
```

Anything else is a different candidate and is not covered by the acceptance above.

## The remaining access step

Everything below is done except this. Local gates pass at `8e1a3ed`; nothing is deployed.

The deployment runs in a dedicated personal Claude environment named **WSF Staging Deploy**
(not `Default`, not organization-shared), which supplies two things the `Default` environment
does not have:

1. **Credential** — environment variable `WSF_STAGING_SA_KEY`, containing the JSON key for
   `wsf-staging-deployer@westayfit-staging.iam.gserviceaccount.com`, entered through the
   environment editor. Never through chat, email, an attachment or Git.
2. **Network** — `Custom` access, default trusted destinations retained, plus exactly:
   ```
   westayfit-staging--staging-4a616y5m.web.app
   us-central1-westayfit-staging.cloudfunctions.net
   ```

A saved environment edit applies to sessions started afterwards. The session that performs
the deployment must **verify it actually received both** before relying on either. Do not
infer delivery from the editor having been saved.

### Approved IAM bindings

Recorded as what was approved, not as a proven exhaustive minimum.

| Role | Scope |
| --- | --- |
| `roles/cloudfunctions.developer` | project `westayfit-staging` |
| `roles/firebasehosting.admin` | project `westayfit-staging` |
| `roles/iam.serviceAccountUser` | only the actual staging runtime and build service-account resources, determined from the deployed Functions/Cloud Build configuration. No project-wide `actAs`. If runtime and build are the same identity, one binding. |
| `roles/secretmanager.viewer` | only the existing `WSF_EMAIL_API_KEY` secret. Metadata and policy read. Not payload access, not policy write. |
| `roles/serviceusage.apiKeysViewer` | project `westayfit-staging`, only if not already supplied by another approved binding. Never API Keys Admin. |
| `roles/firebaseauth.admin` | project `westayfit-staging`, for synthetic tester setup and cleanup only |
| `roles/datastore.user` | **IAM-conditioned** to `projects/westayfit-staging/databases/(default)`. If the condition cannot be enforced as specified, stop that grant and report — do not substitute an unconditional grant. |

**Deferred, not granted:** any Cloud Run role. After `wsfSetGoalDisplayAuthorization` exists,
inspect its service metadata and exercise the real callable transport. Only if a
service-scoped binding is genuinely required for the already-authorized
Invoker-IAM-check-disabled operation, report that exact service and permission. A generic
application-level 401/403 is not evidence that transport permissions are wrong. No
project-wide Cloud Run Admin, no `allUsers` bindings, no organization-policy change.

**Authorization scope limits.** `roles/firebaseauth.admin` technically carries broader Auth
permissions; it permits managing clearly identified synthetic users including their test
verification state. It does **not** permit changing providers, authorized domains, password
policy, email configuration or other Auth settings. `roles/datastore.user` permits synthetic
fixture setup, verification and cleanup — not rules or index changes, database deletion, bulk
clearing, or editing unrelated records.

## Deployment procedure

Preflight, before anything is changed:

1. Confirm the credential and network reached **this** session.
2. Materialize the key outside the repository and outside `apps/westayfit/dist` (the Hosting
   upload path), `chmod 600`, and point `GOOGLE_APPLICATION_CREDENTIALS` at it. Never print,
   log, commit, or pass it as a command argument. Treat it as readable by any process running
   as this user in this session.
3. Validate non-secret identity metadata only: `client_email`, `project_id`,
   `private_key_id`. Record those plus owner, creation date and the rotation/revocation
   procedure.
4. Production isolation: confirm the deployer holds nothing on `goarrive`, and that the
   identities it may `actAs` give no route into production. Record which resources and
   permissions were checked, which policies were inspected, and the limits of that inspection.
   `testIamPermissions` is a targeted check, not proof that every production permission is
   absent.
5. Confirm `WSF_EMAIL_API_KEY` exists in `westayfit-staging` and the runtime accessor binding
   is present. Do not replace the placeholder, copy production email credentials, or enable
   real email. Staging email stays **not configured**; any email-state test expects exactly
   that.

Then:

6. `git checkout 8e1a3ed485a5c0eadbcb23c1f35becad455923c7`.
7. Read the staging Web App SDK config via supported read-only metadata
   (`firebase apps:sdkconfig WEB --project westayfit-staging`). Write the values into the
   protected staging configuration without printing them. Do not borrow production values and
   do not guess a missing field.
8. Build fresh via `scripts/westayfit/build-staging.sh --approved-project westayfit-staging`
   with `EXPO_PUBLIC_WSF_ENV=staging` and `EXPO_PUBLIC_WSF_AUTH_ENABLED=1`. Never reuse an
   existing `dist/`. That script refuses rather than falling back to a production build; do
   not route around it and do not use the repository's production-default deploy path.
9. Verify the artifact identifies staging and carries build marker `8e1a3ed`.
10. Deploy Functions: `--only functions:westayfit --project westayfit-staging`.
11. Deploy Hosting to the existing `staging` channel on site `westayfit-staging`, from the
    same SHA.

Every cloud-changing command names `--project westayfit-staging` explicitly and uses the
staging-specific Firebase configuration. Never rely on `.firebaserc` (its default is
`goarrive`, i.e. production). Never `firebase deploy` bare. Never `--force`.

**Cost discipline:** no positive minimum instances, no always-on resources, no max-instance
increases for convenience, no unrelated paid services, no change to the $25 alerts-only
budget, no new long-lived infrastructure, no production-grade email, no new paid
integrations. A materially new cost category stops and asks Devin.

**Credential hygiene:** do not run dependency installation, unreviewed startup hooks, install
scripts or unrelated tests with the deployment key present in the environment.

## Expected functions delta — verify by name, not by count

**1 CREATED**

`wsfSetGoalDisplayAuthorization`

**6 CHANGED HANDLERS**

`wsfGoalPulse`, `wsfChallengePulse`, `wsfContribute`, `wsfCheckIn`, `wsfMyContribution`,
`wsfListGoals`

**16 CARRIED UNCHANGED**

`wsfAdjustGoal`, `wsfCreateCommunity`, `wsfCreateGoal`, `wsfDesignateChampion`, `wsfHealth`,
`wsfJoinCommunity`, `wsfLeaveCommunity`, `wsfListChallenge`, `wsfMyCommunities`,
`wsfPreviewCommunity`, `wsfReinstateMember`, `wsfRemoveMember`, `wsfResetJoinCode`,
`wsfSaveProfile`, `wsfSendPasswordResetEmail`, `wsfSendVerificationEmail`

**Total after deployment: 23.** `functions:list` before and after; the after-list must contain
the created name and still contain all 22 from the before-list. Also confirm `wsfCheckIn`
remains `minInstances = 0`, and that existing WSF transport configuration did not drift. If
the deploy unexpectedly changes existing transport or scaling, **stop and report the exact
drift** before any broad remediation.

See `PACKAGE-E-DEPLOYMENT-DELTA.md` for what changes for callers in each of the six.

## Hosted authorization checks still required

Synthetic data only. Run-specific fixture identifiers, targeted cleanup, and retained
founder-smoke evidence left alone.

**Testing-integrity rule:** privileged fixture operations stay separate from the assertions.
Every member/Champion authorization assertion must be made through the **actual synthetic user
identities** in a real browser session — never through the deployer's administrative access,
and never by writing `aggregateDisplayAuthorized` directly to Firestore as a substitute for
using the control.

1. **Correct staging build** — staging URL loads; STAGING marker visible; build marker matches
   `8e1a3ed`; backend is `westayfit-staging`.
2. **Member experience with display OFF** — active member sees the goal, can contribute, exact
   personal credit correct, shared total correct.
3. **Default-off public display** — an anonymous browser cannot read a goal merely because it
   knows the `goalId`, the community is public, or the goal predates Package E.
4. **Champion authorization control** — through the real interface: Champion authorizes one
   synthetic goal; an independent signed-out display then shows the permitted aggregate; an
   ordinary member has no authorization control.
5. **Revocation** — through the real interface: Champion revokes; the existing anonymous
   display stops showing the total; the member view continues working.
6. **Re-authorization** — the refused display does **not** silently restart; **Check again**
   starts a fresh display session; the aggregate then returns.
7. **Closed goal** — authorization survives closure and remains revocable through the Champion
   interface. Goal closure has no product control, so that portion is **fixture-seeded** and
   must be labelled as such in the receipt.
8. **Related protected reads** — an unrelated authenticated user cannot use
   `wsfMyContribution` to discover protected goal information; a former member with their own
   historical record keeps permitted own history; replay stays idempotent; replay does not
   expose protected current shared state once no longer authorized; anonymous legacy challenge
   pulse is refused.
9. **Multiple goals / uncertain outcomes** — where the hosted harness can safely simulate
   response loss and delay: an unresolved permission state for goal A survives work on goal B;
   A's retry keeps A's intended value; delayed old display responses cannot repaint a total
   after a refusal. Where the hosted environment cannot safely reproduce a timing case, report
   **NOT TESTED** and retain the local browser evidence. Do not manufacture a PASS.

**Existing goals** without `aggregateDisplayAuthorized` are intentionally OFF. Do not
bulk-enable. Authorize the synthetic test goal through the Champion interface. This is
expected behaviour, not a migration defect.

## Receipt to return

Package E staging status PASS / FAIL / PARTIAL, deployed SHA, staging URL, preview
expiration, Functions deploy, Hosting deploy, function inventory, new callable, Cloud Run
transport verification, `wsfCheckIn` minimum, hosted authorization tests split into PASS /
FAIL / NOT TESTED, synthetic records created, known limitations, and explicit NO for
production resources changed, IAM/org-policy changes outside the one authorized new-service
transport operation, and billing changes.

Keep the three evidence classes distinct: **local test evidence**, **deployment receipts**,
**hosted behavioural verification**.

If hosted Package E passes, mark R-WSF-E1 verified closed **for this staging build only**.
That is not production certification.

## Standing boundaries

No production change of any kind, no `main` merge, no `--force`, no history rewrite, no branch
deletion, no broad IAM change, no organization-policy change, no billing change, no new paid
infrastructure, no Lovable publication. Do not disable the network proxy, use a tunnel, alter
DNS, substitute IP addresses, or route around a policy refusal.

After the hosted verification, stop and return the receipt. The Living WE / member-experience
pass begins only after separate review.
