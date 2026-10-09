# Join review-evidence package — `/join/[joinCode]`

Prepared per PR #394 comment `5784234771`. **Inventory and links only.** Nothing was recaptured,
no accepted or frozen file was written, no application behaviour was touched.

**This is the baseline package. It is not an integrated-build test.** Every frame below was shot
against the revision named beside it, on the single-branch app — not against any app + visibility
combination. When L0 supplies the integrated revision, combined-build proof must identify that
new tree and stay a separate package from this one.

Prepared in W4's own pinned checkout at `claude/wsf-sprint-member-journey`; the app source there
is byte-identical to `e609c57319b2cb9f2a6dac044f310c535ec61185`.

---

## 1 · The frames, and the revision each was actually captured at

Route `/join/[joinCode]`. Ten states × three phone classes (390×640, 390×844, 430×932).

### Frozen BEFORE — 30 files · `batch-b-join-and-setup/before/`

| | |
|---|---|
| Capture revision | **`c34526d`** — *evidence(westayfit): capture the /join BEFORE, before the route stops having one* (2026-09-22) |
| Files | 30, all at that one revision |
| Producer | `design-batch-b-join-before-capture.spec.ts`, gated behind `WSF_CAPTURE_BEFORE` |

Shot against the untouched `/join` route before Batch B was implemented, which is what makes it a
true before.

### AFTER — 30 files · `batch-b-join-and-setup/after/`

Two revisions, and the split is meaningful rather than untidy:

| Capture revision | Files | What it is |
|---|---|---|
| **`09ca52a`** — *feat(westayfit): build /join/[joinCode] to the accepted Batch B target* | 24 | the implementation shoot |
| **`21e042b`** — *fix(westayfit): no callable text reaches /join, and the arrival guard measures the settled frame* | 6 | `failed` and `load-failed`, ×3 sizes — re-shot because that fix changed what those two states render |

The six re-shot frames are exactly the two states the callable-text fix touched. No other AFTER
frame moved with it.

| | |
|---|---|
| Producer | `design-batch-b-join-after-capture.spec.ts`, gated behind `WSF_CAPTURE_FRAMES` |

### TARGET — 36 `TARGET-join-*` files · `batch-b-join-and-setup/`

| Capture revision | Files | What it is |
|---|---|---|
| **`ac86740`** — *test(westayfit): prove the concept strip mechanically, and label the contact sheets too* (2026-09-21) | 22 | the labelled target set |
| **`5bed912`** — *design(westayfit): atlas visual-review corrections — the flow board, two same-device QR bugs, and a capability I wrongly called absent* (2026-09-21) | 14 | targets revised by the atlas visual review |

The wider directory holds 153 `TARGET-*` in total; the 117 beyond these 36 are the combined-goal
and setup surfaces, which are not this route.

| | |
|---|---|
| Producer | `design-target-join-setup-capture.spec.ts`, gated behind `WSF_CAPTURE_FRAMES` |

### States covered, identically across all three sets

`device-choice` · `device-shared` · `failed` · `invite-in` · `invite-out` · `load-failed` ·
`loading` · `not-valid` · `too-many` · `working`

### Supporting

| File | Revision |
|---|---|
| `batch-b-join-and-setup/README.md` | `09ca52a` |
| `batch-b-join-and-setup/CONTACT-SHEET-batch-b.png` | `ac86740` |

---

## 2 · The functional evidence this imagery accompanies

All of it already exists and is linked rather than re-run. Results below are from the packet-1
run on `e609c57`, reported in `journey-regression.md` in this directory.

### `join-batch-b.spec.ts` — 12 passed

| Group | What it holds |
|---|---|
| refusal is non-oracular | a refused code says nothing about which refusal it is, and offers no retry |
| retry is real | "Try again" makes a real second call, and the second answer is believed |
| the invitation | states the joining conditions once, not twice; signing up from it leaves ONE join screen behind |
| failure | a failed join replaces what was read, and leaves the invitation standing |
| shared device | a shared screen can be un-shared without leaving the screen |
| **short-phone arrival** | the invitation, the failure and the join in flight all open with the hero on screen; the `too-many` and `load-failed` refusals open with their headings on screen |
| **no server text reaches the UI** | preview failure, join failure → stable recovery copy, not the callable message; a category the server can really refuse keeps its own actionable reason |

The three short-phone guards are the ones added in answer to the 390×640 arrival question. They
measure the settled frame rather than trusting a screenshot, which is what `21e042b` is about.

### Destination continuity — `batch-a-identity.spec.ts`, 20 passed

| Test | |
|---|---|
| `:132` | a pending invitation is named on sign-in **as a kind, never as a community** |
| `:152` | a scanned event and a shared screen are each named as themselves |
| `:169` | the kiosk return says finishing signs you out of that device |
| `:183` | **the destination survives the verify gate and still says so** |
| `:494` | the last gate has a way out of the wrong account |

Destination continuity is where Join meets identity: the invitation must still be waiting, and
still be described truthfully, after the member goes through verification.

`batch-a-identity` also carries the return-to-join frames as its own accepted evidence
(`before/BEFORE-return-to-join-*`, `after/AFTER-return-join-*`, ×3 sizes).

---

## 3 · Byte integrity at the time of writing

```
$ npm run check:evidence
frozen BEFORE: intact — 8 paths, no byte changed
accepted TARGET / AFTER: intact — 16 paths, no byte changed
```

`git status --short` empty. No frame in `before/`, `after/` or `TARGET-*` was written by this
packet; `WSF_CAPTURE_FRAMES` and `WSF_CAPTURE_BEFORE` were never set in this session.

---

## ⚠️ 4 · One finding — the guard does not cover the frames under review

**Severity: medium.** Reported, not patched — `scripts/westayfit/check-evidence-intact.mjs` is
outside W4's owned paths.

`check-evidence-intact.mjs` has two manifests. Batch B appears in exactly one of them:

```
$ grep -n "batch-b" scripts/westayfit/check-evidence-intact.mjs
46:  'docs/design-target/review/batch-b-join-and-setup/before',
```

- `FROZEN_BEFORE` → includes `batch-b-join-and-setup/before` ✅
- `ACCEPTED_FRAMES` → includes **neither** `batch-b-join-and-setup/after` **nor**
  `batch-b-join-and-setup/TARGET-*.png` ❌

Compare Batch A, which is listed in both, with `after` and `TARGET-*` explicitly accepted:

```
'docs/design-target/review/batch-a-identity/after',
'docs/design-target/review/batch-a-identity/TARGET-*.png',
```

**Consequence.** The checker's `changed()` only ever runs `git diff --name-only HEAD -- <the
manifest paths>`. A path absent from both manifests is never examined, so a modified Join AFTER
or TARGET frame **cannot** make `check:evidence` fail — it would report "intact" while the exact
bytes under review had moved. The "16 paths, no byte changed" line above is a true statement that
does not cover this route's AFTER or TARGET frames.

This is stated from reading the manifest and the `changed()` implementation, not by dirtying a
frame to see what happens — deliberately, since the frames are under review.

**How exposed is it in practice?** Moderately, not severely. All three Join capture specs are
producer-gated (`WSF_CAPTURE_FRAMES` / `WSF_CAPTURE_BEFORE`), so an ordinary run writes nothing —
that is the primary defence and it is sound. What is missing is the *detector*: the second layer
that the script's own header says exists precisely because a producer gate was once believed
sufficient and was not. Its opening records seven of Page 2's accepted AFTER frames going dirty.

**Suggested fix, for the lead to assign.** Two lines in `ACCEPTED_FRAMES`, mirroring Batch A:

```
'docs/design-target/review/batch-b-join-and-setup/after',
'docs/design-target/review/batch-b-join-and-setup/TARGET-*.png',
```

No test, no product, no config change — it widens a guard's coverage to the frames a reviewer is
being asked to accept. Worth settling **before** Join acceptance is recorded, since acceptance is
a statement about specific bytes.

---

## Constraints held

- No frame recaptured; no accepted or frozen file written.
- No application behaviour edited; no spec added or changed by this packet.
- Written only under `docs/design-target/review/sprint-w4-member-journey/`.
- Not described as an integrated-build test, and not merged, deployed or released.
