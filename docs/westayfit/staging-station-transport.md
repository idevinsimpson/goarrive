# Staging station transport — the exact change, and how to prove it worked

**Scope: `westayfit-staging` only. Seven Cloud Run services. No role grant to
the deploy service account, no project-wide role, no production.**

This document exists because a deploy went green twice while a whole
capability was unreachable. It is written so the change can be made by
somebody who is not me, in one sitting, and verified rather than assumed.

## What is actually wrong

Every one of the seven station services reports `invoker_iam_check_enabled`.
That is run `35421156377`'s own verify receipt, not an inference:

```
CANDIDATE_SERVICE_TRANSPORT=wsfstationrequestpairing:invoker_iam_check_enabled wsfstationpairingstatus:invoker_iam_check_enabled wsfapprovestation:invoker_iam_check_enabled wsfstationclaimpairing:invoker_iam_check_enabled wsfstationstate:invoker_iam_check_enabled wsfliststations:invoker_iam_check_enabled wsfrevokestation:invoker_iam_check_enabled wsfgoalrecentadditions:invoker_iam_check_disabled
```

They were created by run `35420410645`, which created the services and then
failed to set their invoker policy. firebase-tools only attempts that set on
**create**, so every later deploy logs `Successful update operation` and goes
green while the services stay closed.

## Correcting my own earlier recommendation

In an earlier comment I suggested granting the deploy service account
`roles/run.admin` or `roles/functions.admin`. **Do not do that.** It is a
standing, project-wide capability granted to an automated identity so that a
one-time fix to seven existing services becomes unnecessary — the wrong trade,
and it is outside the mandate. The change below touches exactly the seven
services that are wrong and grants nothing to anybody.

## All seven, not only the four

A Cloud Functions v2 callable does its authorization **inside the function**:
`request.auth` is checked by the handler after the request arrives. The
invoker check is transport, and it runs first. So a Champion-only callable
still has to be reachable, or the browser is refused before the function ever
decides whether the caller is a Champion.

This is not a theory about this project — it is what this project already
does. `verify-deployment.mjs` asserts that every pre-existing WSF service
carries `invokerIamDisabled === true`, and that set includes Champion-only
callables such as `wsfRemoveMember` and `wsfResetJoinCode`. The seven station
services are the exception, and the exception is the bug.

## The change

Match what the other 22 services already have, so the harness's own assertion
becomes the proof:

```
for SVC in wsfstationrequestpairing wsfstationpairingstatus wsfapprovestation \
           wsfstationclaimpairing wsfstationstate wsfliststations wsfrevokestation
do
  gcloud beta run services update "$SVC" \
    --region=us-central1 \
    --project=westayfit-staging \
    --invoker-iam-check-disabled
done
```

If that setting is unavailable in the installed gcloud, the equivalent is an
`allUsers` invoker binding on each of the same seven services and nothing
else:

```
for SVC in wsfstationrequestpairing wsfstationpairingstatus wsfapprovestation \
           wsfstationclaimpairing wsfstationstate wsfliststations wsfrevokestation
do
  gcloud run services add-iam-policy-binding "$SVC" \
    --region=us-central1 \
    --project=westayfit-staging \
    --member=allUsers \
    --role=roles/run.invoker
done
```

Prefer the first: it is the state the receipt already checks for, so a
successful change is visible in the next run's `CANDIDATE_SERVICE_TRANSPORT`
line without anybody having to read an IAM policy.

## How to prove it worked, in three ways

**1. Read the state back.** Expect `true`:

```
gcloud run services describe wsfstationstate --region=us-central1 \
  --project=westayfit-staging --format='value(invokerIamDisabled)'
```

**2. Knock on the door.** An anonymous POST must get past the transport layer.
`400` here is a SUCCESS — it means the handler ran and refused a request with
no `goalId`, which is exactly right. `403` with an HTML body is the failure:

```
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST https://us-central1-westayfit-staging.cloudfunctions.net/wsfStationRequestPairing \
  -H 'Content-Type: application/json' -d '{"data":{}}'
```

Send `{"data":{}}`, not a goal id: the handler validates before it writes, so
this probe creates no pairing document and leaves nothing on staging.

**3. Let the harness say it.** The next staging run's hosted smoke now probes
all four publicly-declared station callables and fails by name if any is
refused at the door. Before the change it reads:

```
FAIL station callable transport — wsfStationRequestPairing is not publicly invokable on staging: HTTP 403 (transport); …
```

After it, `RESULTS=22 / FAILURES=0`.

## What this still does not prove

A door that opens is not a working station. Pairing, approval, claim,
state-serving and revocation are exercised against the emulator but not
against staging by any of the above. Revocation in particular — the Director
asked for it proven — needs an enrolled screen on the real channel, which
needs the door open first. That is the next step after this change, not part
of it.

## Rollback

Reverse the same seven, and nothing else:

```
gcloud beta run services update "$SVC" --region=us-central1 \
  --project=westayfit-staging --no-invoker-iam-check-disabled
```
