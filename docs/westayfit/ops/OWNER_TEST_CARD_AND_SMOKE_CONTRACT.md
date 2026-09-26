# WE STAY FIT owner test card + changed-journey smoke contract

Status: operations contract. This file defines what the future generator/CI packet must consume. It does not by itself alter the staging workflow.

## Milestone manifest

Each user-visible staging milestone should have one machine-readable manifest with:

```json
{
  "schemaVersion": 1,
  "milestone": "COMMUNITY-SETTINGS-PARITY-1",
  "productSha": "<exact accepted/integrated SHA>",
  "previousKnownGoodSha": "<rollback SHA>",
  "journeys": [
    {
      "id": "community",
      "entry": "/community",
      "setup": "signed-in active member with selected community",
      "actions": ["open Community", "switch selected community", "return"],
      "expected": [
        "selected community leads presentation",
        "server order is not mutated",
        "truthful facts and goal window remain visible"
      ],
      "knownExclusions": []
    }
  ]
}
```

The manifest is frozen before deployment and is generated from accepted QA/Director rows. It is not written from memory after deployment.

## Hosted changed-journey smoke

The staging workflow that can actually reach the hosted site consumes `journeys[]` and exercises the changed routes.

A smoke result records:
- journey id;
- exact served build marker;
- setup/fixture id;
- actions actually performed;
- expected assertions;
- passed / failed / blocked;
- screenshot or trace path when useful.

Generic hosted checks remain valuable but do not substitute for the changed-journey smoke.

A known-unreachable sandbox should report the standing reachability limitation once, not retry the same blocked `*.web.app` request on every release.

## Owner test card generation

The owner card is rendered from the same milestone manifest plus the hosted results.

Required header:
- staging link;
- served SHA;
- previous known-good/rollback SHA;
- milestone name;
- hosted changed-journey status.

Each owner row is:
1. where to go;
2. what setup matters;
3. what to tap/do;
4. what should be visible/feel different;
5. what is intentionally unchanged or unavailable.

Rules:
- do not move a behavior from one route to another;
- do not state a hosted/device pass that was not run;
- do not convert unknown into success or failure;
- no unsupported social/email/kiosk claim;
- include only the shortest useful device review after automated checks;
- visual/feel review remains Devin's verdict.

## Release-gate optimization

Until the generator and changed-journey smoke are independently accepted, the current staging pin and human review gates stay in force.

After acceptance, a deterministic pointer-only pin may use the fast path only when all of these remain unchanged:
- protected paths;
- backend function inventory;
- rules/indexes;
- firebase/hosting config;
- package/app manifests;
- candidate lineage;
- release environment.

Any change to one of those conditions exits the fast path and receives explicit W7 + Director review.

The fast path never bypasses product acceptance, deployment authorization, hosted verification, rollback evidence, or Devin's production authority.
