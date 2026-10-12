# Owner north-star boards

The two owner-approved boards, supplied by the owner and committed here so the
direction survives past any one session. **Open both before creating or
implementing any destination target.**

| File | What it is |
| --- | --- |
| `OWNER-BOARD-1-before-current-wsf-experience.png` | **BEFORE** — the current product. The thing we are moving away from. |
| `OWNER-BOARD-2-after-target-wsf-vision.png` | **AFTER / TARGET** — the direction. Six screens plus four stated principles. |

The owner's words for what to take from them: *"Do not merely borrow individual
components. Preserve the overall emotional experience, visual energy, density,
hierarchy, polish, and sense of community shown in the AFTER board."*

## What the BEFORE board names as the problem

Card-heavy stacked layout · minimal delight, little emotional feedback ·
website-like rather than native · limited visual energy, modest imagery, minimal
motion.

## The visual language to inherit

Read off the AFTER board, screen by screen, so it can be applied rather than
paraphrased.

**Ground and depth.** White and very light grey grounds with navy as the weight,
not navy everywhere. The dark navy panel is used *selectively* — for the goal
hero, the community-impact card, the challenge card — so it reads as the
important object on the screen rather than the screen itself. Soft shadows under
raised cards. Green gradients on primary actions.

**The Living WE is the signature instrument.** On the AFTER board it is huge,
bright green, with dimensional highlights, and on the confirmation screen it
bursts with rays. It is never a small logo in the corner of a card.

**Type.** A large friendly headline per screen ("Smyrna Strong", "Nice work,
Devin!", "Add your contribution"), one supporting line under it, then dense but
organised detail. Numbers that matter are large and paired with their target:
`241 / 500` with the percentage under the bar.

**Density.** Each screen carries noticeably more than the current product: the
home screen has a hero, a progress card, a recent-activity card and a community
card, all above the fold. Emptiness is not the aesthetic.

**Movement as a grid.** Choosing what you did is a grid of labelled tiles with
icons (Squats, Walk, Run, Workout, Yoga, Other), with the selected one outlined
in green — not a dropdown or a list.

**Celebration.** The confirmation screen is a whole screen: a personal greeting,
the bursting WE, the new shared total, what your contribution did, who else
moved today, then the next actions as secondary.

**Chrome.** Bottom tab bar with filled icons and labels, a rounded pill on the
active tab. Back arrows and a close X top-left, settings or avatar top-right.
Script lettering ("Stronger Together", "Every Movement Counts") used sparingly
as a brand flourish.

**Colour.** Deep navy `#0B1F3A` for weight, cream and pale grey for ground,
with green gradients on the primary button.

**There are TWO greens, and this README previously flattened them into one.**
Sampling the board gave a bright `#22C55E`-ish and the note said it was "for
action and progress" — which quietly replaced the brand's own progress green
with a colour taken off a JPEG. The product defines both, with different jobs:

| Token | Value | Job |
| --- | --- | --- |
| `PROGRESS_GREEN` | **`#91CB7D`** | The brand green. The wordmark's own slash, the move figure, the Living WE's fill, every eyebrow and progress cue. Defined in `src/ui/brandAssets.ts` and asserted by `tests/move-figure.test.ts`. |
| `ACTION_GREEN` | `#22C55E` | The action colour. Primary buttons and the things a thumb is aimed at. Defined in `src/ui/kit.ts`. |

A sampled value from a board image is never a replacement for a defined token.
Where the board's green reads brighter than `#91CB7D`, that is the action
colour on a button, not a redefinition of the progress green.

## The boards are a VISUAL reference, not a data contract

The owner has said this explicitly, and it matters because the AFTER board draws
several things this product cannot truthfully ship. Each conflict below has a
truthful substitute that keeps the board's energy.

| On the board | Why it cannot ship | What to build instead |
| --- | --- | --- |
| Rows of member face avatars | No invented faces; no member photography without authorization | Authorized community photography in the hero where it exists; otherwise an abstract movement texture. Presence stays a number and a sentence, not a face. |
| `Morgan added 20 · 2h ago` | Names a contributor. Contributions are never attributed publicly. | `+20 squats · 2h ago`. The movement is real; the person is not named. |
| `12 people contributed today`, `+18`, `23 members already moving together` | Unique-person counts | Member count where the product is authorized to read it; otherwise recent movement as amounts and times. Never a count of distinct people who moved. |
| `Your update would move the community to 261 / 500` | A predicted shared total that concurrency cannot guarantee | Show your own amount and what the total is *now*. The new total appears after it is confirmed, never before. |
| `6 Day streak — Keep going!` | Public streak pressure — **and** the underlying data is not reachable by any client | **Nothing, today.** Private dated consistency is a *documented seam*, not an authorized capability: `wsfContributions` and `wsfGoalMemberTotals` are returned by no callable and `firestore.rules` denies them. See `review/page-04-progress/PRIVATE-HISTORY-CONTRACT.md`. Drawing it as a substitute would be drawing a target that needs backend work nobody has authorized. |
| `A happier, healthier Smyrna` | Health and happiness claim | Community and movement language. `Moving together this week` is on the same board and is true. |
| `Friends` tab | Friends is not a destination in this product | The agreed IA: **Home · Community · MOVE · Progress · You** |
| `Workouts` tab | WSF does not own coaching or workout content | MOVE — recording what you did, which is what the product actually does. |

Where a board element is not listed above, take it as **visual** direction —
composition, energy, hierarchy, weight — and check it against the current
product truth before drawing it.

**"Take it as drawn" is not a licence.** An earlier revision of this line said
exactly that, which would let any unlisted board element override the Strategic
Master or a newer owner decision simply by having been drawn once. The boards
are a visual reference, as the heading above says; they are not the most recent
word on scope, data or permissions. Where a board element and a newer decision
disagree, the newer decision wins, and where a board element needs data the
product cannot reach, it is a seam to record rather than a screen to draw.

## Where this sits in the order

```
exact owner boards  ->  complete visual north-star atlas  ->  owner visual review  ->  page-by-page BEFORE / TARGET / AFTER
        DONE                      next
```

`VISUAL-NORTH-STAR-ATLAS-REQUIREMENTS.md` in the parent folder defines what the
atlas must cover. `ROUTE-TARGET-INDEX.md` records what is covered today.
