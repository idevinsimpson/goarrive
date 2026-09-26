# W2 addendum — the corrected Board 01 and the re-rendered INDEX at `4f43973`

**Requested by:** the lead, on PR #397, relaying Program Director Round 4 §3
(https://github.com/idevinsimpson/goarrive/pull/365#issuecomment-5781984220).
**Source SHA audited:** `4f43973` — *"integrate W1's corrected Board 01 candidate (#398 @ 8b3707b); review copy and INDEX re-rendered"*.
**Supersedes:** nothing. This extends `AUDIT-2026-09-22.md`; the Boards 00, 02–05 verdicts there stand unchanged, their artifacts being byte-identical at this head.
**Date:** 2026-09-22

The two findings W1 was assigned — the missing stale state and the named-movement
seam — are **not reopened here**. They are addressed, and this addendum records
them as closed. What follows is the further inspection the lead asked for.

---

## Identity and provenance, verified before inspecting anything

| Claim | How it was checked | Result |
| --- | --- | --- |
| The corrected candidate's hash | `git cat-file blob \| sha256sum` | `f19ae919bf3beecf76b1e2218a452b71ad154440341690c472b70732bb2862ba` — **matches the `f19ae919bf3beecf…` the lead quoted** |
| Geometry | PNG IHDR | **2560 × 4380**, as stated |
| Same file across heads | `git rev-parse <rev>:<path>` | blob `9e8a2218` at `8b3707b`, `4f43973` **and** current canonical `7c35877` — one artifact, three refs |
| *"every capture unchanged"* | `git diff --stat e29b9ec 4f43973 -- board-01/captures/` | **empty — every capture byte-identical** to the pre-correction head |
| Frozen evidence | `node scripts/westayfit/check-evidence-intact.mjs` | **intact** — 8 BEFORE paths, 16 accepted TARGET/AFTER paths, no byte changed |
| Capture labels | opened at native resolution | all four phone frames read **`CURRENT BUILD · CAPTURED`** ✅ |

Because the PNG is byte-identical to the candidate already opened at W1's head,
the inspection in `AUDIT-2026-09-22.md` applies to `4f43973` without
re-derivation, and the findings below are additional rather than repeated.

**P-7 is closed.** `review-copies/` is restored in full at `4f43973` — all seven
1× PNGs (Boards 00–05 and INDEX) are present again, and Board 01's copy is
re-rendered from the corrected candidate. The regression reported in the main
audit no longer exists on canonical. Nothing further is asked of the lead on it.

---

## The lead's specific question — does the stale inset imply the mark is dropped?

> *"the inset must not imply a confirmed Living WE is dropped when stale; note
> whether the version you see already handles it"*

**The version at `4f43973` does not handle it. It states the drop as intended.**

Crop: `crops/board-01-4f43973-stale-inset-drops-the-mark.png` (the inset at 2×)
Context crop: `crops/board-01-4f43973-lifecycle-caption-band.png` (all nine captions in one band, so the contrast is visible in a single image)
Region: native `x 2010–2400, y 2050–2700`

What the cell actually renders: a dashed inset carrying a navy hero with
`500 Squats by Friday · Open · Ends Fri, Sep 25`, the figure **`241` / `of 500
squats`**, a **slim linear progress track**, `48.2% complete`, `259 to go`, and
beneath the card `Connection interrupted · Last confirmed 5:57 PM · Refresh`.
Its caption reads:

> **Stale · last confirmed** — *"Drawn, not captured. The last confirmed values
> and their receipt time, unchanged — **no mark**, and nothing implying anyone
> moved."*

So the board does not merely *imply* the Living WE is dropped when stale; it
**says so on its face**, and draws a linear track in the instrument's place.

### Why this reads as a defect rather than a judgement call

**1. The shipped product does the opposite — on the very surfaces this cell cites.**
The cell's own explanatory line says the target is *"Home adopting a treatment
the product already ships"* on `/display`, `/kiosk` and `/station`. Those three
routes were read at this SHA. All three render the mark **unconditionally**:

```
apps/westayfit/app/display/[goalId].tsx:607
  const we = (
    <View style={styles.weWrap}>
      <LivingWeProgress completed={sharedTotal} target={target} unit={unit} … />
```

`stale` appears nowhere in that expression, on any of the three routes. What
`stale` changes is exactly one thing — the freshness line:

```
apps/westayfit/app/display/[goalId].tsx:506-513
  {stale ? (<Text …>Connection interrupted</Text>) : null}
  <Text …>{`${stale ? 'Last confirmed' : 'Confirmed'} ${formatClock(confirmedAt)}`}</Text>
```

The treatment the product ships is: **keep the mark at its last confirmed fill,
and let the freshness line carry the staleness.** The inset borrows the words and
inverts the behaviour.

**2. It is internally inconsistent.** The cell displays the confirmed ratio in
text — `241`, `of 500 squats`, `48.2% complete`, `259 to go` — while withholding
the mark built from those same numbers. If the figures are safe to show when
stale, the instrument that renders them is equally safe. Nothing is protected by
removing it.

**3. It gives the instrument's absence a second meaning.** Board 00 lock
`5770785512` sets one rule for withholding it — *"no denominator = no
instrument"* — and one rule for the empty state — the 0 % mark *"is the brand,
not a disabled shape."* Here a denominator exists and was confirmed; only its
freshness is in question. Making the mark's absence signal *connection* teaches a
second reading the constitution does not grant, and Board 01's own strip puts the
two cells four apart: **Building · 48.2%** shows 241 of 500 with the full
dominant mark; **Stale · last confirmed** shows the same 241 of 500 with none.

**4. A track where a hero's mark belongs is a demotion.** Board 01 lock
`5770964377` reserves slim tracks for *"secondary goals … never tiny decorative
Living WEs."* Substituting a track for the featured goal's instrument renders a
hero in secondary clothing.

### Suggested remedy — proposal P-9, one writer: W1

Keep the Living WE in the stale cell at its last confirmed fill, exactly as
`/display` does, and let `Connection interrupted · Last confirmed 5:57 PM ·
Refresh` carry the staleness on its own — it already does, truthfully, and it is
the product's own sentence. Then amend the caption: the honest line is that the
values and the mark are the last confirmed ones and nothing claims they are
current, not that the mark is removed. That change also removes findings 2, 3 and
4 above in one edit, and brings the cell into agreement with the three routes it
cites as precedent. It is a board-source change only — no product change, no
re-capture, and no new state.

---

## Geometry — clipping, overlap, caption baselines

Checked across the corrected candidate at native resolution.

**No clipping was found anywhere in the lifecycle strip**, the new ninth cell
included: the dashed inset closes on all four sides, the `TARGET · NOT
IMPLEMENTED` pill is fully inside its border, and no frame is cut by a panel
edge. The seam panel's struck-through `NOT AUTHORIZED · NOT IMPLEMENTED` row
renders complete.

**Caption baselines — eight of nine align; the ninth does not.**
Crop: `crops/board-01-4f43973-lifecycle-caption-band.png` · region `x 90–2470, y 2240–2780`

The eight captured cells set their titles on one shared baseline. **`Stale · last
confirmed` sits below it**, because the `TARGET · NOT IMPLEMENTED` pill is
inserted between the frame and the title in that cell alone, and no other cell
reserves height for it. Separately, **`Closed · unfinished` wraps to two lines**
(`Closed ·` / `unfinished`) where its eight neighbours fit on one, pushing its
body text down a line.

Both are cosmetic and neither hides content. The tidy fix is to reserve the
pill's height in every cell so all nine titles share a baseline, or to place the
status pill above each frame rather than between frame and caption — **proposal
P-10, one writer: W1**, ideally folded into the same pass as P-9 so the strip is
re-rendered once.

A milder observation, offered and not pressed: the nine frames have visibly
ragged bottom edges, the History cards floating well above the navy heroes'
baseline. It reads as a strip of different objects rather than one matrix. No
lock speaks to it.

---

## Findings from the main audit, re-checked at this head

| Finding | Status at `4f43973` |
| --- | --- |
| **D-01.1** — column 2 is an unlabelled scroll-offset frame with no identity, whose caption claims a Living WE the frame does not show | **STILL OPEN.** Verified on the corrected candidate: column 2 still opens flush with the green `Start moving`, no wordmark, no `YOUR COMMUNITY / Smyrna Strong`. Not one of W1's two assigned items. Proposal P-1 stands. |
| **D-01.3** — Champion sidecar omits `total`/`target`/`ownCredit` | **STILL OPEN.** Captures are byte-identical, so the sidecar is unchanged. Proposal P-8 stands. |
| **D-IX.1** — INDEX status word `FINAL` contradicts the manifest | **STILL OPEN at the re-rendered INDEX.** See below. |
| **P-7** — deleted review copies | **CLOSED.** Restored in full. |

---

## INDEX at `4f43973` — re-rendered, thumbnails correct, status words unchanged

The INDEX PNG changed at this head (blob `2c698094` → `78fcd98d`). Opened whole
at 1×, and slot 01 cropped at native resolution.

**Thumbnail correctness: ✅.** Slot 01 now carries the **corrected** candidate —
the lifecycle strip in the thumbnail visibly has **nine** cells with the dashed
target inset at its right end, and the seam panel shows the split layout. Slots
00 and 02–05 are unchanged and still show the right board, each letterboxed at
its true aspect ratio. Slots 06–11 carry titles and `PENDING`; 12–17 carry `—`
and `PENDING`.

**Status words: ✗ unchanged.**
Crop: `crops/index-4f43973-status-word-FINAL-still-unfixed.png` · region `x 90–2470, y 900–1030`

Boards 00, 02, 03, 04 and 05 still read **`FINAL`**; Board 01 still reads
`PRECISION REVIEW`. The package manifest at this same commit still gives those
five `SELF-CHECKED · independent review pending` and still says *"A `_FINAL`
filename is the lock verdict's canonical name for the artifact, **not an
acceptance status**"* and *"**Independent board review** … **No board has this
yet.**"* D-IX.1 is unaffected by the re-render, and **proposal P-3 stands** — it
is a one-token change in the INDEX renderer's status column.

---

## Verdict on the corrected Board 01 at `4f43973`

**ACCEPTABLE WITH THESE DEFECTS** — unchanged in grade from the main audit, and
improved in substance.

What improved: both assigned corrections are properly made. The stale state
exists and is labelled a target rather than silently dropped; the seam now shows
only what #390 returns, with attributed movement separated, struck through and
marked `NOT AUTHORIZED · NOT IMPLEMENTED`; the initials disc is gone; the screen
note gained a matching row; and the footer states the mixed provenance precisely.
Every capture is byte-identical and correctly labelled `CURRENT BUILD ·
CAPTURED`, which this addendum verified by content hash rather than by reading
the claim.

What remains: the stale cell removes a confirmed goal's Living WE and says so
(**P-9**, and this is the substantive one — it contradicts the three shipped
routes it cites); the ninth caption is off the strip's baseline (**P-10**);
column 2 is still an unlabelled scroll-offset frame (**P-1**); the Champion
sidecar is still thin (**P-8**).

None requires re-capturing the product, redrawing a frame, or reopening the
locked creative direction. P-9 and P-10 fall in the same file and should be one
pass.

**W2 does not clear this gate.** The director's independent visual review remains
outstanding. W2 regenerated no board, started no board, and wrote nothing outside
`review-audit-w2/`.
