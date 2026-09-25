# SOCIAL-STAGING-DEMO-1: the retained synthetic social review fixture

Director #365 `5834082617` §C, routed by L0 #396 `5834099352`. **Prepared, not
run against staging.** Running it is a step for an authorized existing staging
operator (below). Nothing here is evidence that the social features work.

## What it seeds

Two communities, both `isSample: true`. The product already badges such a
community "Sample" and keeps it off every public display and pooled aggregate.
Both are `joinPolicy: private`; their join codes are never printed.

| community | members | goal | seeded ledger |
| --- | --- | --- | --- |
| Sample Community: Demo Movers | the owner as Champion, plus all 12 synthetic members | 2,000 squats | 445 over 14 contributions |
| Sample Community: Demo Walkers | the owner as Champion, plus 4 of the same members | 500 push-ups | 75 over 4 contributions |

- **Privacy mix (Demo Movers):**
  - 6 members are named; 3 of them use the product default of no stored field.
  - 3 have their name off and activity on.
  - 3 have activity off.
  - Demo Walkers has the same three kinds.
- **Synthetic members:** twelve "… Sample" names such as Ava Sample and Ben Sample, so every initial differs. Each has a Firestore profile and memberships only: no Auth account, email, contact, invitation or photo.
- **Contributions:** written exactly as `wsfContribute` writes them. That means the contribution row, a counter shard, the member total and the recent-additions tail. The shards are reconciled from each sample goal's whole ledger, so totals always equal the ledger.
- **The owner's data:** the owner is added as Champion of the two sample communities only. The fixture never contributes as him and never touches his profile, his other memberships or his privacy choices. A re-run keeps any change he makes while reviewing, and counts any movement he records on a sample goal.
- **Movement guides:** the units `squats` and `push-ups` map to the product's built-in movement guides.

## Before it is useful

The social screens read `wsfCommunityMembers`, `wsfCommunityActivity` and
`wsfSetCommunityVisibility`. On staging (run 48) all three are transport-SHUT,
and the `wsfContributions` index has no READY receipt. Until Operations 1 and 2
in `docs/wsf-staging/OPERATOR-HANDOFF-social-staging.md` are done and read back,
the seeded people will not appear. The communities, goals and totals come
from callables that are open on staging. Whether the community page renders
fully while the three social calls fail is not measured here.

Do not present seeded results as working social until the served member,
non-member and privacy checks pass.

## Operator runbook step

**Who runs it:** a named, authorized existing operator on `westayfit-staging`
only. Their own identity needs:
- Firestore document read and write;
- `firebaseauth.users.get`, to verify the owner's record.

Nobody widens IAM or credentials for this.

**Where it runs:** from an installed `functions-westayfit`. The script loads
`firebase-admin` from the working directory.

**1. Set up the environment.**

```bash
npm --prefix functions-westayfit ci
cd functions-westayfit
export GOOGLE_CLOUD_PROJECT=westayfit-staging   # the operator's own ADC identity
```

**2. Find the owner's uid.** Take it from the owner's existing, email-verified
record in the Firebase Authentication console for `westayfit-staging`, and
confirm it with him. Never look it up by display name.

**3. Plan, then apply, then verify.** Plan is read-only and reports what apply
would create.

```bash
node ../scripts/westayfit/staging-demo/seed-social-demo.mjs --plan   --project westayfit-staging --owner-uid <UID>
node ../scripts/westayfit/staging-demo/seed-social-demo.mjs --apply  --project westayfit-staging --owner-uid <UID> --receipt /tmp/demo-apply.json
node ../scripts/westayfit/staging-demo/seed-social-demo.mjs --verify --project westayfit-staging --owner-uid <UID>
```

**Post these lines on #396:** `CREATE`, `FOREIGN=0`, `APPLIED`,
`OWNER_DATA_OUTSIDE_FIXTURE_UNCHANGED=true`, each goal's
`ledger N = shards N = member totals N`, and `VERIFY=pass`.

If `FOREIGN` is not 0 or an `AUTH_ERROR` appears, stop and report it. Do not
work around it.

**Later: refresh "moved today"** on the retained fixture. Totals do not change.

```bash
node ../scripts/westayfit/staging-demo/seed-social-demo.mjs --apply --reanchor --project westayfit-staging --owner-uid <UID>
```

**Only when the owner is done reviewing: targeted cleanup.** It deletes exactly
the fixture's documents, including any movement recorded on the two sample
goals, and nothing else.

```bash
node ../scripts/westayfit/staging-demo/seed-social-demo.mjs --cleanup --confirm-cleanup SOCIAL-STAGING-DEMO-1 --project westayfit-staging --owner-uid <UID>
```

## Safety properties

- **Auth errors fail closed.** Only `auth/user-not-found` proves that an
  account is absent. Any other Auth error aborts the run before anything is
  written, and the output names it as `AUTH_ERROR=<code>`. Examples are a
  permission, transport or quota error. This applies to the owner lookup and to
  every synthetic-uid lookup.
- **No counter is ever overwritten.** Each seeded contribution is created the
  way `wsfContribute` creates one:
  - one transaction checks the row is absent;
  - it creates the row;
  - it **increments** the row's shard and the member's total.

  So anything recorded while the script runs is never lost from the confirmed
  totals. That includes the owner using the app. `--reanchor` moves timestamps
  only.
- **Everything is classified before anything is written or deleted.** Each
  existing document at a fixture path falls into one of three cases:
  - **ours, unchanged**;
  - **ours, drifted:** for example a goal the owner edited while reviewing. It is kept and reported as `DRIFT`, never reset, and verify then reports `VERIFY=drift`;
  - **foreign:** it has no fixture marker, or a ledger row does not match the fixture. It aborts the run, cleanup included.

  Two kinds of path follow their own rule:
  - **The owner's membership in each sample group** is created once with the fixture marker. After that it is never written again, because his privacy choices there are his, and the product's own writes merge, so the marker survives them. Cleanup deletes such a row only when it carries the marker. A row there without the marker is foreign.
  - **A recent-addition document** belongs to the fixture only beside its own fixture contribution row, with the same amount. It is created only where absent, and moved on a reanchor only while that link holds. Any other document at that path is foreign.
- **Refusals:**
  - any project other than `westayfit-staging`, and any emulator run not on a `demo-*` project;
  - a missing `--owner-uid`;
  - an owner record that is absent, disabled or not email-verified, or has no profile;
  - a synthetic uid that turns out to be a real Auth account;
  - cleanup without the confirmation token.

**Output:** `CREATE`, `REANCHOR`, `UNCHANGED`, `DRIFT` and `FOREIGN` count the
fixture's own documents. The shards, member totals and recent additions are
created inside the ledger transactions and are not counted separately. After
every apply, each goal prints `ledger N = shards N = member totals N`.

## The emulator dry run

```bash
# Firestore and Auth emulators on a demo-* project, e.g. ports 8085 and 9099
FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
  node scripts/westayfit/staging-demo/emulator-dry-run.mjs --project demo-wsf-local
```

It needs `firebase-admin` in the working directory. It covers:
- every refusal;
- an Auth permission error injected on the synthetic lookups, and an unreachable Auth endpoint. Both must end the run with zero writes;
- foreign documents at a group, profile, goal and membership path;
- plan writing nothing;
- apply with an owner contribution landing inside every one of its ledger transactions, and the same again on `--reanchor`, with none lost;
- idempotence and verify;
- the member mix;
- no synthetic Auth accounts and no contact fields;
- review-time edits kept as drift;
- cleanup refusing over a foreign document, then removing exactly the fixture.
