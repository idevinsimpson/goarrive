# Public display — responsive implementation · matched AFTER

**IMPLEMENTED on the real route**, at the two classes the direction was passed
for. Returned for independent behaviour review and the Director's AFTER
verdict, which both precede integration or promotion. Nothing here is a deploy,
a main merge, a hardware installation or a QR capability.

Released by the Director on PR #429
([`5787359488`](https://github.com/idevinsimpson/goarrive/pull/429#issuecomment-5787359488))
after the responsive direction passed.

## Source revision, original vs new

| | |
|---|---|
| Original | **`a193b43`** — `claude/wsf-app-shell`, verified as its head when this branch was cut |
| New | **`1fd669f`** — `claude/wsf-display-responsive` |
| Product delta | `app/display/[goalId].tsx` (+196 / −38) · `src/ui/displayLayout.ts` (new, +160) |
| Test delta | `tests-e2e/sprint-w2-display-responsive-capture.spec.ts` (new) |

**Three files. Nothing else in the application changed** — no kit, no brand
renderer, no `MemberTabBar`, no backend, no public payload, no polling, no
recent-read cadence, no permission logic, and no new data, endpoint, identity
or permission.

## The tiers, and the floor that keeps phones out

`displayTier(width, height, hydrated)`, display-only:

| Rule | Tier | `data-layout` | `data-tier` |
|---|---|---|---|
| `width >= 1600` | collective | `wide` | `collective` |
| `width >= 900` | booth | `wide` | `booth` |
| `width >= 600 && height > width` | portrait | `portrait` | `portrait` |
| otherwise | phone | `phone` | `phone` |

A portrait tier keyed only on "taller than wide" would have swallowed every
phone in existence. The `600` floor is the whole safety of the change, so the
boundaries are asserted directly rather than inferred from the two convenient
sizes: **599×1000 stays a phone and 600×1000 does not; 899×700 stays a phone
and 900×700 does not; 1599×900 stays a booth and 1600×900 does not.**

`data-layout` keeps its existing vocabulary so every assertion already in the
suite still reads what it read before; the new tier rides on `data-tier`.

## The instrument, per class — measured, not intended

| Viewport | Mark width | Share of glass | Before |
|---|---|---|---|
| 390 phone | 306 | 78% | **unchanged** |
| 800 portrait | 440 | 55% | 320 (40%), as a phone |
| 1280 booth | 538 | 42% | **unchanged** |
| 1440 booth | 605 | 42% | **unchanged** |
| 1920 collective | 760 | 40% | 640 (33%) |

The phone and booth numbers are asserted against the shipped expressions
themselves, because "guarded against regression" has to mean something
checkable.

## What changed, against the three gaps

1. **800×1280 has its own tier.** It took the phone composition and the phone
   mark cap. It is now one navy column at frame scale.
2. **Type and status scale with the room.** The collective takes the accepted
   wide hierarchy × 1.3 — the hierarchy itself is not re-authored, so the
   length-tiering in `displayTypeScale` keeps working. The freshness line,
   which had **no wide variant at all**, is now 26px at collective and 22px at
   portrait; booth keeps 13px deliberately.
3. **The collective generic states are centred.** `canvasWide` is
   `space-between`, and the refusal renders two children, so at 1920 it was
   pinned to the top edge with two thirds of the glass empty beneath it. The
   centred canvas is the collective tier's alone — see the correction below.

## What did not change, deliberately

- **QR-to-join ships as nothing.** No placeholder, no `Scan to join`, no dead
  control — asserted absent at every tier. The seam stays documented in the
  target package on #429; the space it held is closed up, not left as a hole.
- **The phone composition is untouched**, to the pixel, and is not in this
  checkpoint.
- **The total stays one line — as a choice for this packet, not a rule.** The
  accepted target splits the number from its denominator. I left the route's
  single `241 of 500 squats` string alone because re-authoring the total is
  more than the responsive change this packet carries, and I would rather
  surface it than smuggle it. My earlier wording overstated the reason: an
  existing assertion on that exact text does **not** make the composition
  immutable. Typography and layout may change while the accessible
  numerator, denominator and unit stay exactly what they are, so this is a
  matched-AFTER decision, not a constraint the suite imposes.
- **The booth keeps its shipped composition** — type factor exactly 1, mark
  expression verbatim, generic canvas unchanged. **This was not true when this
  record first said it.** The first cut selected the new centred generic canvas
  on `wide`, which is both wide tiers, so 1280x800 and 1440x900 silently moved
  while this file claimed they had not. Corrected in `1fd669f`: the centred
  generic canvas is now keyed on `tier === 'collective'`, and a regression
  measures the generic block's distance from the top against its distance from
  the bottom at 1280x800 and 1440x900 (deliberately unbalanced) versus
  collective, portrait and phone (balanced). The existing mark-width test could
  not have caught this: the generic states render no mark.

## Verification

**The existing suite, which a style change may not weaken:** 32 passes across
`ui-display`, `ui-display-torture`, `ui-display-torture-2`,
`ui-display-recent-additions`, `ui-a11y-fixes`, `ui-matrix`,
`e5-display-authorization` and `ui-share-display-link`, then 14 re-verified
after the scale correction below. Includes the long-name containment checks and
the authorization-race cases.

**After the booth correction, the specs that photograph a booth: 19 passed** —
all of `e5-display-authorization`, `ui-a11y-fixes`, `ui-display` and
`ui-matrix`, which between them carry `wide 1440x900 distant display states
need no scroll`, `wide 1440x900 the distant display carries the same four
states, full page`, `(f) wide display holds a long name, title and unit on
screen`, and the generic unknown/unauthorized/revoked path. No redesign and no
full-suite repetition: the affected states and `ts:check`.

**This packet's own spec: 12 passed.** Tier boundaries; the shipped mark widths
to the pixel; every phase at both new classes with its exact values, overshoot
and capped percent; stale retaining its confirmed number and mark; an
unreachable first load inventing no zero and no mark; a refusal clearing
context and staying terminal until an explicit `Check again`; a recent-list
failure touching only that list; long strings contained; QR absent; and the
booth-generic regression described above.

## Five defects in this work, and how each surfaced

Four of the five were invisible to a passing test run, and the fifth was
invisible to me entirely — the Director read the diff and found it. On this
surface, **assertions prove behaviour and only measurement, pixels or a second
reader prove appearance.**

| Defect | Kind | Found by |
|---|---|---|
| A Firestore `PATCH` without `updateMask` replaced each seeded goal, wiping title, target and unit — the product looked like it refused to recover from a revocation | my test | reading the failure against the existing spec's helper |
| The containment check looked only for `wsf-display-screen`, the **ready** root, so it reported "not rendered" on exactly the failure states it exists to cover | my test | the failure message naming the sentinel |
| **The recent list was clipped off a 1080 canvas.** 0.42 of the glass plus a 1.45 type factor made the column taller than a screen that cannot scroll — confirmed evidence silently lost to a style change | **product, mine** | the containment assertion written for it |
| **The booth's generic canvas moved while this file said it had not** — the centred canvas was keyed on `wide`, which is the booth as well as the collective | **product, mine** | the Director reading the diff against this record's own claim ([`5787628430`](https://github.com/idevinsimpson/goarrive/pull/435#issuecomment-5787628430)) |
| **The room-scaled `maxWidth` was applied to the wrong element** — `styles.genericBlock` occurs twice and the edit hit the phone loading card, where `big` is always false, so it was a silent no-op and the refusal kept wrapping to two lines | **product, mine** | measuring the live DOM: `maxWidth` read back 720px, not 936px |

## Frames

Eight, all from one run against one seeded fixture at `f22bded`:

The `1fd669f` correction touches only the generic loading/unavailable/
unreachable canvas at the booth tier, which no frame here photographs. I
recorded the eight hashes, rebuilt and re-ran the producer at `1fd669f`, and
all eight came back **byte-identical** — so these are the frames of the
current head, not stale ones.

```
AFTER-progress-800x1280.png              AFTER-progress-1920x1080.png
AFTER-stale-INJECTED-NETWORK-800x1280.png  AFTER-stale-INJECTED-NETWORK-1920x1080.png
AFTER-refused-800x1280.png               AFTER-refused-1920x1080.png
AFTER-long-strings-800x1280.png          AFTER-long-strings-1920x1080.png
```

Each matches the proposed target of the same name and class in
`review/public-display-next/target/` on #429. `INJECTED-NETWORK` means a
callable was aborted at the network layer to photograph the state; no injected
failure is presented as an organic one.

`SAMPLE DATA` appears on every frame because `wsfUsingEmulators` is true. It
never ships.

## One thing left for the pixel review rather than decided alone

On the **portrait stale** frame the `Connection interrupted` pill sits inline
with the wordmark and the header gets tight at 800px. It is legible and the
containment assertion passes, so rather than re-architect the header on my own
judgement I am surfacing it. Moving the freshness below the wordmark at
portrait is a small change if it is wanted.

## A hazard this work kept tripping over

`e5-display-authorization.spec.ts` writes its **28 committed artifacts
unconditionally** — `page.screenshot(...)` with no `WSF_CAPTURE_FRAMES` gate —
so any ordinary verification run silently rewrites committed review evidence.
`ui-display`, `ui-matrix`, `ui-display-torture-2` and
`ui-display-recent-additions` likewise write uncommitted output. I restored the
tracked files and removed the untracked output after every run. Pre-existing,
not caused by this change, and outside this packet's allowed paths — reported
rather than fixed.

## Reproducing

```
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 \
  npm --prefix apps/westayfit run build:web
METADATA_SERVER_DETECTION=none firebase emulators:start \
  --config firebase.westayfit.emulators.json --project demo-wsf-local

WSF_CAPTURE_FRAMES=1 \
WSF_PLAYWRIGHT_CHROMIUM=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1) \
WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 \
  npm --prefix apps/westayfit run test:e2e -- sprint-w2-display-responsive-capture.spec.ts --workers=1
```

The component must be rebuilt into the web bundle before the producer runs, or
the frames are of the previous build.

## Fixtures

Maple Street Movers · Squats together this week · 241 of 500 squats, and a
90-character community name with a 95-character goal title for the long-string
frames — all synthetic. Every ready state asserts that no uid, join code,
member total or group type appears anywhere in the document.

## Status

**IMPLEMENTED — self-checked, not accepted.** Independent behaviour review and
the Director's AFTER verdict precede integration or promotion.
