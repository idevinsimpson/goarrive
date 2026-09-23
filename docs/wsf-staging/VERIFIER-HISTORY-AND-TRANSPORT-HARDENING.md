# The verifier's stale history, and what "closed" may be asserted from

**Packet** `5800166201`. **A proposal. No code is changed by this document** — the change in
§6 lands only if it is accepted. Nothing here touches #448, #449, `6f70c17` or `main`; no
cloud change, no new role, no live call, no deploy.

Every fact below carries its date and the receipt it comes from, and every receipt marked
**read here** was opened from GitHub by this session rather than relayed.

---

## 1. The claim the file makes today, and when it stopped being true

`verify-deployment.mjs` (blob `b75ea3ff…` on my branch and at #448 `83d22d4`; the same
prose on `main`) describes two groups of services in the **present tense**:

> *"every one of these fifteen is shut. firebase-tools created the services and could not
> set their invoker policy, because the deploy service account has no
> `run.services.setIamPolicy`."* — of `CREATED_BY_CANDIDATE`

> *"its transport was never established; theirs was, and it is BAD — run 35421156377's
> receipt has all seven as `invoker_iam_check_enabled`."* — of the seven station services

Both were true when they were written, on **19 September**. Neither is true now.

## 2. The measurement that supersedes them — read here, not relayed

Run **46**, `35810257325`, deploy job **107020701666**, step *Verify the deployed state*,
**2026-09-23 02:31:45Z**. Quoted from the job log:

```
INVENTORY_BEFORE=46
INVENTORY_AFTER=46
CREATED_THIS_DEPLOY=none
PREEXISTING_TRANSPORT_VERIFIED=22/22
NEW_SERVICE_TRANSPORT=invoker_iam_check_disabled
CANDIDATE_SERVICE_TRANSPORT=wsfeventcontext:invoker_iam_check_disabled … wsfrevokestation:invoker_iam_check_disabled
VERIFY=pass
```

The `CANDIDATE_SERVICE_TRANSPORT` line names **23** services — the fifteen turn/combined
callables, `wsfgoalrecentadditions`, and the seven station callables — and **every one of
them reads `invoker_iam_check_disabled`**, which is this file's word for *open*. Together
with the 22 pre-existing and the one Package E service, all **46** deployed services were
open at that moment.

So the two paragraphs in §1 assert `SHUT` of 22 services that a run four days later
measured open, and the file has carried that assertion through every deploy since.

**The repair receipts** are #327 `5742733395` (ten services, 19 Sep 14:39Z),
`5744356056` (the remaining twelve, 18:29Z) and `5744966058` (run `35466096879`,
all 23 re-measured open). **Relayed by L0 (`5800166201`), not opened here** — #327 carries
286 comments and I did not locate those three bodies within this pass. They are cited as
the historical record of *how* the transports came to be open; the fact *that* they are
open rests on run 46, which I read.

## 3. The two 22s are not the same 22

This is the trap in the receipt, and it should be read before either number is used.
Computed from the file at my head:

```
BASE_EXPECTED        46
NEW_SERVICES         24   = 1 Package E + 8 RECENTLY_CREATED + 15 CREATED_BY_CANDIDATE
PRE_EXISTING         22   = BASE_EXPECTED minus NEW_SERVICES
turn 15 + station 7  22
```

`PREEXISTING_TRANSPORT_VERIFIED=22/22` counts the **first** 22 — the services that predate
all of this. It says **nothing** about the second 22, which are exactly the services §1's
stale prose is about. The coincidence is arithmetic, and reading the first number as
evidence about the second group is the easiest available mistake.

The evidence for the second 22 is the separate `CANDIDATE_SERVICE_TRANSPORT` line — and
that line is a **report**, not an assertion. Which is the next section.

## 4. Asserted versus reported, and the hole between them

| set | size | what the verifier does |
| --- | ---: | --- |
| `PRE_EXISTING` | 22 | **asserted** — `driftedTransport` fails the run if one is not open |
| `CREATED_BY_CANDIDATE` + `RECENTLY_CREATED` | 23 | **reported** — printed, never checked |
| `CREATED_BY_PACKAGE_E` | 1 | **reported** — printed, never checked |

Half the deployed surface is in the reported column. **If one of those 24 closed tomorrow,
nothing would fail** — the run would print its new state and pass. They were put there for
a sound reason: a service known to be shut cannot be asserted open, and at the time they
were shut. That reason expired on 19 September and the placement did not.

Two further things are true and worth keeping straight, because both look like safety
nets and neither is one:

- The workflow's *Preserve an incomplete functions deployment as a failed release* step is
  conditional on `deploy-functions.outcome == failure`. It fires on a failed deploy, not on
  a closed transport. In run 46 it was **skipped**.
- Their presence in `CREATED_BY_CANDIDATE` also makes each one's **absence** a failure
  (`the candidate's new callable did not deploy`). That is about existence, not transport.

## 5. What must not be swept up in the fix

**The three social services — `wsfSetCommunityVisibility`, `wsfCommunityMembers`,
`wsfCommunityActivity` — have no transport receipt at all, because they do not exist yet.**
They cannot be asserted open on any evidence, and after the deploy that creates them the
expectation (`SOCIAL-ROLLOUT-SEQUENCE.md` §6) is that they arrive **shut**, exactly as the
fifteen did. They belong in the reported column until an authorized handoff produces their
own receipt — which is the same rule that put the fifteen there, applied honestly rather
than inherited.

So the distinction the file needs is not "old versus new". It is:

| | |
| --- | --- |
| **measured open, with a receipt** | may be asserted open; a closure is a failure |
| **awaiting an authorized handoff, no receipt** | reported only; a closure is expected, not a failure |

## 6. The exact change — and the normalization it must not buy

The assertion must not be bought by turning *unknown* into an answer. The file already has
this defect, in the place the fix would touch:

```js
function transportOf(serviceName) {
  const service = services.get(serviceName);
  if (!service) return 'service_not_found';
  if (service.invokerIamDisabled === true) return 'invoker_iam_check_disabled';
  return 'invoker_iam_check_enabled';          // <-- absence reported as SHUT
}
const driftedTransport = PRE_EXISTING.filter(
  (n) => services.has(n) && services.get(n)?.invokerIamDisabled !== true
);                                              // <-- absence reported as "re-enabled"
```

A response that omits `invokerIamDisabled`, or a field that cannot be read, is currently
reported as *shut* — a positive claim from absence, and the same class of defect as the
`does not exist or caller lacks access` substring match this suite already refuses, and as
the empty before-inventory it already treats as an error.

**Proposed: three states, each failing for its own reason.**

```js
function transportOf(serviceName) {
  const service = services.get(serviceName);
  if (!service) return 'service_not_found';
  if (service.invokerIamDisabled === true) return 'invoker_iam_check_disabled';  // open
  if (service.invokerIamDisabled === false) return 'invoker_iam_check_enabled';  // closed
  return 'transport_unknown';   // absent, null, or any non-boolean — nobody measured it
}
```

and an asserted set that fails on each, distinctly:

| observed | on an **asserted** service | on a **reported** service |
| --- | --- | --- |
| open | pass | note |
| **closed** (explicit `false`) | **FAIL** — "transport closed" | note |
| **unknown** (absent / non-boolean) | **FAIL** — "transport could not be established" | note |
| service not found | already fails (`Cloud Run services missing`) | — |

The two failures are deliberately **not** the same message. "This service is closed" and
"nobody could tell whether this service is closed" are different findings, and a run that
reports the second as the first is the thing this document exists to stop.

**Which services move into the asserted set:** the 23 named in run 46's
`CANDIDATE_SERVICE_TRANSPORT` line, all measured open on 2026-09-23, plus the one Package E
service measured open on the same line. **Not** the three social services (§5).

**Where the receipt lives.** The move should be a data change with its evidence attached —
each promoted name carrying the run and date that measured it open — not a silent edit to
an array. The current file's practice of explaining each list in prose is right; what it
lacks is a date on the claim, which is how it went stale unnoticed.

## 7. What this does not propose

- **No IAM action, no new role, no widening of the deploy service account.** The deploy SA
  still has no `run.services.setIamPolicy`, and nothing here asks for it. This is about what
  the verifier may *assert*, not about changing any transport.
- **No change to the pre-existing 22's handling**, which is already fail-closed and correct.
- **No relaxation anywhere.** Every current failure stays a failure; the change adds two and
  splits one.
- **No claim about the three social services' future transport.** §5 says they are expected
  shut; that is an expectation, not a measurement, and the verifier asserts neither.

## 8. If it is accepted

The code change on my branch, with: fixtures for each cell of §6's table, including
explicitly-`false`, absent-field and non-boolean shapes; a positive control proving the
promoted services still pass while open; a case proving the three social names are **not**
asserted; and mutation proofs that the unknown state cannot be collapsed into either
answer. Counts and mutations reported as in packets 10–13, carried by L0, reviewed by W5.
