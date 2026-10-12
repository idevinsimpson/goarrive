# Corrected Below Target — CURRENT-BUILD CAPTURES for Board 09

The one lifecycle state North Star Board 09 could not show.

Board 09's lock ([`5771469193`](https://github.com/idevinsimpson/goarrive/pull/365#issuecomment-5771469193))
names it exactly:

> **Corrected Below Target** = an authoritative later correction may move the
> current total below target even when historical `reachedAt` exists: current UI
> shows current phase/status (`460 of 500`, `92%`, `40 to go`) and MUST NOT show
> `Reached on …` as if it still described the present state.

No capture of it existed on any surface, so the board stated the rule and drew
nothing. The Director's pixel review
([`5785588557`](https://github.com/idevinsimpson/goarrive/pull/412#issuecomment-5785588557))
passed the layout and held state coverage PARTIAL for this one gap: *"the
board's main lifecycle contract needs a visible specimen, not only a text
promise."* This package is that specimen.

| | |
|---|---|
| **Product source** | **`44cc0633f3d62b1f33d757f6bc0e401758f04523`** (`claude/wsf-app-shell` head). The build was made from this branch's tree at `32111f2`; `git diff` over `apps/westayfit/app`, `apps/westayfit/src`, `functions-westayfit/src` and `firestore.rules` between the two is **empty**, so the frames photograph the app-shell head's product code. |
| Producer | `apps/westayfit/tests-e2e/sprint-w1b-lifecycle-capture.spec.ts` |
| Write gate | `WSF_CAPTURE_FRAMES=1`, through `helpers/capture` |
| Ordinary run | **1 passed, 0 images written** — verified by hashing the frames before and after an ungated run |
| Gated run | 1 passed, 3 frames |
| Fixtures | `helpers/mobile`, the same seeds the existing lifecycle coverage uses |
| Surfaces | Community Home and Progress, 390×844 |

## The frames

| Frame | sha256 (first 16) | What it is |
|---|---|---|
| `home-reached-open-before-correction-390x844.png` | `5a159d9e9ebfa472` | The **positive case**, on the goal that is about to be corrected: `GOAL REACHED`, the mark full, `520 of 500 squats`, `100% complete`, `20 beyond our goal · still open`, and `Reached Sep 22`. |
| `home-corrected-below-target-390x844.png` | `35ce5f3ed676e140` | **The same goal, the same screen, after the correction**: `460 of 500 squats`, `92% complete`, `Only 40 to go`, the mark no longer full — and **no reached date anywhere**, while `reachedAt` is still in Firestore. |
| `progress-corrected-below-target-390x844.png` | `ff5d1eb10009f35f` | The member's own page, both halves at once: the corrected goal running with `460 of 500 squats · 92%` and no reached treatment, and a genuinely reached closed goal keeping its `REACHED` badge and the screen's one full mark. |

All three are 780×1688 (390×844 @2×).

## What makes these evidence rather than a picture of an empty screen

**1 · The goal reaches its target for real.** Nothing seeds `reachedAt`. The
goal starts at zero and a real `wsfContribute` call crosses the target, so the
**server** stamps the event. A fixture field would have proved nothing about a
rule that is entirely about what a real stamp does afterwards.

**2 · The correction is authoritative.** A real `wsfAdjustGoal` call by the
community's own `foundingChampion`, with a reason, producing the same audited
row any other correction does. No shard is hand-edited. The spec then sums the
ten counter shards and asserts the confirmed total is exactly **460** — the
correction moved the number every surface reads, not merely an audit row.

**3 · The stamp is proved to survive.** After the correction the spec reads
`wsfGoals/{goalId}` straight from Firestore and asserts `reachedAt` is **still
there**. Without that assertion a missing date line would be evidence of deleted
data rather than of a page reporting the present tense — which is the opposite
of the rule.

**4 · A zero is not a pass.** Every post-correction assertion names the exact
non-zero value: `460 of 500 squats`, `92% complete`, `Only 40 to go`,
`data-fill-ratio="0.9200"`. A stale or failed read renders `0%` or the progress
error, and each of those fails these assertions rather than slipping through as
"no reached treatment". The progress-error node is asserted absent as well.

**5 · The positive case is preserved.** Two ways, so the frames show a rule by
contrast rather than an absence: the **same goal** is photographed reached
before it is corrected, and a **second goal** — genuinely reached, closed, never
corrected — keeps its `Reached` result in Home's History and its `REACHED` badge
and full mark on Progress.

## Read these three things before composing with them

**1 · The correction is goal-level, so the member's own part is untouched.**
`Your part · You've added 520 squats to this goal` still says 520 while the
shared total reads 460, and Progress shows `520 squats` recorded against
`460 of 500 squats · 92%`. That is the product being exact: a correction with no
`targetUid` moves the community's confirmed total and makes no claim about whose
contribution was wrong. A board should say so rather than let the two numbers
look like a contradiction.

**2 · The status line is `Only 40 to go`, not `40 to go`.** 460 of 500 is 92%,
past the near-goal threshold of 90%, so the goal does not merely stop being
reached — it lands back in **nearGoal** and takes that phase's own wording. The
lock's `40 to go` is illustrative of the numbers, not a copy string.

**3 · The page reports a confirmed snapshot and says when.** Home prints
`Confirmed <time>` beside its own `Refresh`, so a reload alone can still show
the total the member last confirmed. The correction is taken the way a member
takes it — by pressing that control. Reaching past it into the cache would have
been staging the result.

## Asserted before each shot

- the server stamped `reachedAt` on the real crossing;
- reached state: `520 of 500 squats`, `100% complete`,
  `20 beyond our goal · still open`, a visible reached line, `data-fill-ratio="1.0000"`;
- the shard sum is exactly `460` after the correction;
- `reachedAt` is **still present** in Firestore after the correction;
- corrected state: `460 of 500 squats`, `92% complete`, `Only 40 to go`,
  `data-fill-ratio="0.9200"`, the reached line at **count 0**, and no progress error;
- the control's History row still reads `Reached`;
- Progress: the running row carries the corrected numbers and **not** `REACHED`;
  the finished control row does carry it; exactly **one** `wsf-activity-we` is on
  the screen and it is full.

## Why the assertions are not gated with the writes

`helpers/capture` documents two shapes: a spec that only produces images is
skipped outright, and a spec that also **asserts** keeps running while only its
writes are withheld. This one asserts a regression the build has had before —
`app/activity.tsx` records that *"a goal corrected down to 380 of 500 still wore
REACHED, and still drew the celebratory Living WE, because of something that had
been true a week earlier."* Gating the whole file would have made the guard
against that depend on somebody asking for pictures. If the lead prefers the
plain `test.skip` shape the other capture producers use, it is a one-line change.

## Reproducing

```
npm --prefix functions-westayfit run build
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 \
  npm --prefix apps/westayfit run build:web
METADATA_SERVER_DETECTION=none npx firebase emulators:start \
  --config firebase.westayfit.emulators.json --project demo-wsf-local

WSF_CAPTURE_FRAMES=1 \
WSF_PLAYWRIGHT_CHROMIUM=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1) \
WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 \
  npm --prefix apps/westayfit run test:e2e -- sprint-w1b-lifecycle-capture.spec.ts
```

`npm --prefix apps/westayfit run ts:check` passes with the spec in place.

## Scope

Loopback and `demo-wsf-local` throughout. **No application, functions, config,
`.github` or shared-producer change; no accepted or frozen image written; no
external account, no staged write and no new permission.** Every account,
community, goal and number here is synthetic and local to the emulator.

This set is **not** on `check-evidence-intact.mjs`'s freeze list — that file
belongs to the lead, and adding these paths is their call, not this packet's.
