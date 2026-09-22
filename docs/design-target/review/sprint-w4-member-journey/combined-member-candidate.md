# Combined member candidate — accepted fix `ff8c880` + visibility `670edab`

Assignment: PR #394 comment `5784432989`.

**88 checks, all passed.** Scratch and local only — never pushed, not a deployed or integrated
release, and not a claim about one.

## The combination

| | |
|---|---|
| Parent 1 — accepted short-phone fix (#400) | `ff8c880598d7684d68cc259129d129fc2a32c9d7` |
| Parent 2 — visibility, including the integrated #405 | `670edab04cfa3b24a2846e19eca5f4b1e5102c79` |
| **Merge commit** | **`ac3497718501df56256c738a872c033914207045`** |
| **Merge tree** | **`a27774ffa325f43a4c7bf55de01013cf054ec2af`** |
| **Conflicts** | **none** — `git diff --name-only --diff-filter=U` empty |

No resolution was guessed in anyone's active files. The one file that could have collided did
not: #400 edits `scripts/westayfit/check-evidence-intact.mjs` and `670edab` does not touch it, so
the merge takes #400's version whole.

Verified coexisting in the merged tree **before** anything was built:

| From | Evidence in the tree |
|---|---|
| #405 | `firebase.westayfit.emulators.json:43` — the members rewrite |
| #400 | `contribute/[goalId].tsx:238,1140,2031` — `shellBarShown`, `scrollAboveMove` |
| #400 | `check-evidence-intact.mjs:52,70` — short-phone before/after entries |
| #390 | `app/community/[groupId]/members.tsx` |
| `e609c57` | `index.tsx:4326` — `heroOutlineButtonText: CREAM` |

**Build source.** `functions-westayfit/lib` and the web artifact were both rebuilt inside the
scratch worktree at `ac34977`, so the artifacts are the combination and not either parent.

---

## Results

### Run fresh on this build — 88 passed, 0 failed

| Check | Result |
|---|---|
| deploy-config (hosting contract), 3 suites | **28 passed** |
| `ui-contribute-short-phone.spec.ts` | **7 passed** (29.3s) |
| `sprint-w4-members-rewrite-cold-load.spec.ts` | **4 passed** |
| `community-visibility.spec.ts` | **18 passed** |
| `e35-home.spec.ts` | **11 passed** |
| `ui-community-home.spec.ts` | **3 passed** |
| `join-batch-b.spec.ts` | **12 passed** |
| `identity-account-switch.spec.ts` | **2 passed** |
| `ui-app-shell.spec.ts` | **3 passed** |

Every suite exited 0. `WSF_CAPTURE_FRAMES` and `WSF_SHORT_PHONE_SET` were never set, so the
short-phone spec asserted and wrote nothing; the worktree was clean after the run.

### Contribution short phone — taps AND the at-rest hit-target property

This is the packet's centre, because auto-scroll taps alone missed the original bug.
`ui-contribute-short-phone.spec.ts` carries both, and both pass on the combined build:

```
✓ 390x640 › MOVE step: the raised action never covers "I'm done" or "Skip timer",
            and both take a real tap                                      (15.7s)
✓ 390x664 › (same)                                                        (15.5s)
✓ 390x844 › (same)                                                         (4.6s)
✓ 390x640 › entry, review, confirmed, unknown and refused all keep every
            control clear of the raised action                            (8.6s)
✓ 390x664 › (same)                                                         (5.4s)
✓ 390x640 › /move/[goalId] wears no shell and does not scroll sideways     (1.9s)
✓ 390x664 › (same)                                                         (1.6s)
```

What each half contributes, and why neither alone would do:

- **Normal taps** — `.tap()` with no `force` on `wsf-contribute-skip-timer` and
  `wsf-contribute-done`, each reaching the entry step through the real handler. Playwright
  auto-scrolls before tapping, which is exactly why a passing tap did **not** prove the control
  was reachable where the member actually finds it.
- **The at-rest hit-target property** — the spec walks the screen's own scroll view through its
  whole range in 8px steps and, at every offset, resolves a tap at each on-screen control's
  centre with `document.elementFromPoint`, asserting it never lands inside
  `wsf-member-tabs`. Offset 0 is the at-rest case the original bug lived in. `toBeVisible` is
  blind to this; the hit test is not.
- Plus the geometric allocation — the scroll view's bottom edge at or above the raised action's
  top — measured from the live DOM rather than read off the constants.

The state sweep covers entry, review, confirmed, the unknown outcome and the definitive refusal,
over **every** interactive control the screen owns, at both short heights.

### Reused by equality, not re-run — the callable and rules suites

Per the packet, proof is reused only where equality establishes it. It does here:

```
$ git diff --stat 3014129 ac34977 -- functions-westayfit/src firestore.rules firestore.indexes.json
(empty — byte-identical)
$ git diff --stat 670edab ac34977 -- functions-westayfit/src
(empty — byte-identical)
```

`3014129` is the Deliverable 4 combined tree on which **484 callable across 29 suites** and
**35 rules** passed. The backend source, rules and indexes in this candidate are byte-identical
to it, and #400 changes no backend file, so those two suites are carried forward on equality
rather than ceremony. This is a reuse claim about identical inputs, **not** a fresh run on
`ac34977`, and it is labelled that way deliberately.

The hosting configs **did** change in this merge, so deploy-config was re-run fresh (28 passed)
rather than reused.

### Cold load, re-measured on this build

```
served /community/GRP123/members : 50742 bytes
dist members.html                : 50742 bytes   ← match
dist __dynamic.html              : 51323 bytes
```

Byte counts differ from the Deliverable 4 figures because this is a different build; the
identity that matters — served == `members.html`, != `__dynamic.html` — holds.

---

## When L0 supplies its integrated revision

Compare its tree to **`a27774ffa325f43a4c7bf55de01013cf054ec2af`**. Where the trees are equal,
this package is proof for it as it stands. Where they differ, the differing paths must be
identified and the actually-changed behaviour re-run — a local scratch merge is not an integrated
release, and this package does not claim to be one.

---

## Fallback prepared — the acceptance-guard additions, as a proposed diff only

Recorded here as a proposal. **No frame recaptured or accepted, no shared source modified.**

The gap (reported at `5784281865`): `check-evidence-intact.mjs` lists
`batch-b-join-and-setup/before` under `FROZEN_BEFORE` and lists neither `after/` nor
`TARGET-*.png` under `ACCEPTED_FRAMES`, so a modified Join AFTER or TARGET frame cannot fail
`check:evidence`. Batch A lists both.

Written against the **merged** version of the file, which already carries #400's short-phone
entries at lines 52 and 70:

```diff
--- a/scripts/westayfit/check-evidence-intact.mjs
+++ b/scripts/westayfit/check-evidence-intact.mjs
@@ ACCEPTED_FRAMES @@
   'docs/design-target/review/page-02-move/short-phone/after',
   'docs/design-target/review/page-03-community/TARGET-*.png',
   'docs/design-target/review/page-03-community/PROPOSAL-*.png',
   'docs/design-target/review/page-03-community/after',
   'docs/design-target/review/page-04-progress/TARGET-*.png',
   'docs/design-target/review/page-04-progress/after',
   'docs/design-target/review/page-05-you/TARGET-*.png',
   'docs/design-target/review/page-05-you/after',
   'docs/design-target/review/batch-a-identity/after',
   'docs/design-target/review/batch-a-identity/TARGET-*.png',
+  // Batch B join, submitted for visual/functional review. Its `before/` is
+  // already frozen above; these are the frames a reviewer is asked to accept,
+  // and until they are listed here a change to them cannot fail this check.
+  'docs/design-target/review/batch-b-join-and-setup/after',
+  'docs/design-target/review/batch-b-join-and-setup/TARGET-*.png',
   'docs/design-target/targets',
```

Two lines plus a comment, mirroring Batch A exactly. No test, no product, no config change.

**Scope of the claim.** This says the guard does not *detect* a change to those frames. It does
**not** say any pending AFTER frame is defective — none is known to be, the producers are gated,
and `check:evidence` reports intact today. The proposal closes a detector gap; it is not a
verdict on the frames.

Not applied: `scripts/westayfit/check-evidence-intact.mjs` is outside W4's owned paths and the
packet says to prepare it, not to land it.

---

## Constraints held

- No production or staging access, no new public accounts.
- No source changes, no shared-shell edits, no frozen capture writes, no guard file edited.
- Scratch merge never pushed; no merge, deploy or release of any kind.
- Evidence written only under `docs/design-target/review/sprint-w4-member-journey/`.
- No ceremonial rerun of the historical 581, and no scope expansion beyond the named checks.
