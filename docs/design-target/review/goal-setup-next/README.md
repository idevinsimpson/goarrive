# `/goals/new` — goal setup TARGET and AFTER (W6)

**The target PASSED** (`5788308449`, Director `5788288648` §3, reviewed at `f880732`) and is now
implemented on the real route. This package holds both halves:

- `target/` — the thirteen **accepted** drawings. Every one carries a `PROPOSED / NOT ACCEPTED`
  strip inside the image, and they keep it: the strip records what they were when they were
  ruled on. **None of them is an AFTER**, and they have not changed a byte since the verdict.
- `after/` — the **matched AFTERs**: the shipped route, photographed. See
  [`after/README.md`](after/README.md), including the three places the AFTER deliberately
  differs from the drawing.
- `before/` — the reuse proof for the frozen BEFOREs in `../goal-setup-current/`.

Everything below describes the target as it was submitted, and is kept as the record of what
was argued for.

| | |
|---|---|
| Source tree | `a193b43086ee0564b8edf99083ab164c08f9ceff` (`claude/wsf-app-shell`) |
| Sprint hub | PR #365, Director packet comment `5787366259` (section W6) |
| Board 08 lock | PR #365 comment `5771436211` |
| Target component | `apps/westayfit/src/ui/designTarget/GoalSetupNextTargets.tsx` |
| Preview route | `apps/westayfit/app/design-target/goal-setup-next.tsx` (gated on `EXPO_PUBLIC_WSF_USE_EMULATORS`) |
| Producer | `apps/westayfit/tests-e2e/sprint-w6-goal-setup-next-capture.spec.ts` |
| Write gate | `WSF_CAPTURE_FRAMES=1` (`helpers/capture`) |
| Ordinary run | 1 passed, **0 images written** — verified before capturing (see below) |
| Gated run | 1 passed, **13 frames** |
| BEFORE | reused, not re-shot — see [`before/README.md`](before/README.md) |
| Device classes | 390×844 and 390×640. `430×932` is worth drawing when the hierarchy has a verdict, not before. |

## What the proposal is

The route already says the right words. What it does not have is **hierarchy**: four
identically-weighted white cards down a page that is over two screens tall at 390×844 and
nearly four at 390×640. Three things follow from reading the BEFOREs.

1. **The masthead costs ~410 px before the first decision** — 64% of a 390×640 viewport. The
   definition line, which is the whole point of the first section, is below the fold before a
   Champion has typed anything (`../goal-setup-current/form-populated-top-390x640.png`).
2. **The payoff is drawn at label weight.** *"30,000 squats"* renders at 20 px in the same navy
   as the field labels above it, while `kit.display.md` (29 px / 900) exists for exactly the
   value that carries a screen.
3. **The commit point is the quietest surface on the page.** `Check it over` is `kit.cardQuiet`
   — 55% white under three solid cards — and `Start this goal` is a sibling *below* it, so the
   summary and the control that agrees to it are never on screen together.

The proposal answers those and nothing else:

- **A spine.** The same four sections, same order, same titles, joined by a numbered rule.
  Still ONE page and one scroll — no wizard, no step that hides another, no route change.
- **The payoff at `display.md`** on the kit's own selected-option tint.
- **Duration as four pills** (`kit.pill` / `kit.pillSelected`, 44 px of hit target each) instead
  of four 56 px option rows. Same four labels — *1 week / 2 weeks / 1 month / Custom* — with the
  **chosen** option's description kept once underneath instead of all four at all times.
- **The repeat choice stays exactly two full option rows**, `once` still the default, both
  descriptions intact. It is the one decision here with a consequence for every member.
- **The summary becomes the one navy surface on the page and the submit moves inside it.** Same
  seven rows, same words. The check and the control that acts on it cannot be scrolled apart,
  and the last row is no longer under the raised MOVE circle.
- **A reserved strip for the member tab bar**, so nothing sits under it.
- **Three truthful outcomes** where the build renders one string: refused, unconfirmed, live —
  to the Director's recovery contract (`5787676653`), answering a defect W7 measured in a
  browser rather than one inferred from the source. See `findings.md` F1 for the clause-by-clause
  table.

## Kept exactly

Community context by **name, never id** · the `Start a goal` heading and its intro, verbatim ·
the goal phrase · durations `1w` / `2w` / `1m` / `Custom` · the device zone stated in words with
no picker · exactly **two** repeat policies with `once` default · the same-page `Check it over`
with its seven rows · the production gate · no Living WE anywhere in setup.

## Not proposed

No third repeat policy · no movement catalog · no wizard · no production-gate removal · no
backend field and no idempotency claim · no invented faces, names, quotes, reactions or counts ·
no streaks, rankings or comparison · no health data · no coaching upsell · no forced sharing.

**Board 08 is reference, not a source.** Its accepted current-build captures are what these are
measured against. Its older target drawings label this form differently — *"Goal title"*, a
Step 1/2/3 wizard spine, the unit paired beside the target — which conflicts with the build and
with the lock. None of it is copied. Every word in these frames is the route's own.

## Frames

Fixture identity is the BEFORE package's, so the pairs read side by side: community *Harbor
Walkers*, goal *Autumn squat challenge*, *30,000 squats*, the 1-week derived window, and
*Coordinated Universal Time* (the zone the capture container reports).

| Frame | The claim it makes |
|---|---|
| `CONTACT-SHEET-goal-setup-next.png` | all six states at 390×844, under one PROPOSED strip |
| `PROPOSED-form-top-390x844.png` · `-390x640.png` | the spine, and the payoff above the fold at **both** classes |
| `PROPOSED-custom-window-390x844.png` · `-390x640.png` | Custom open; the explicit start control **replaces** the derived line |
| `PROPOSED-summary-commit-390x844.png` · `-390x640.png` | the check and the commit arrive **whole**, as one object |
| `PROPOSED-refused-390x844.png` · `-390x640.png` | the server answered; the claim is tied to the refusal that makes it true, and the refused action is gone |
| `PROPOSED-unconfirmed-390x844.png` · `-390x640.png` | the client does not know and does not pretend to; **Check community goals** resolves it, **Start another goal** is subordinate and deliberate |
| `PROPOSED-created-390x844.png` · `-390x640.png` | the goal exists; the target is not a total |

## Measured, not eyeballed

The producer measures the phone's fold — the frame's own bottom edge — and prints the numbers
on every run, gated or not. From the capture run:

```
[gsnext] 390x844 payoff bottom 2517 / fold 2860      → clears by 343 px
[gsnext] 390x844 submit bottom 2708 / fold 2860      → clears by 152 px
[gsnext] 390x640 payoff bottom 4176 / fold 4327      → clears by 151 px
[gsnext] 390x640 submit bottom 2593 / fold 2887      → clears by 294 px
```

Both values in each line are page coordinates on the tall preview page, so the absolute numbers
move between runs while the **clearance** does not — the 390×640 payoff clears by 151 px in
every run recorded here. The clearance is the claim; the assertion is on the comparison, not on
either number.

The payoff clearing the fold at 390×640 is the first of those that the build does not manage:
`../goal-setup-current/form-populated-top-390x640.png` ends inside the third field, with no
definition line on screen at all. Both are asserted by the producer, so a later edit that puts
either back below the fold fails before anything is written.

**What does NOT clear, stated plainly:** at 390×640 the **duration row is still below the
fold** — `PROPOSED-form-top-390x640.png` ends on *"2 · When"*. The spine recovers roughly one
field's worth of height, not a screen's. The short phone needs one short scroll to choose a
duration, and this checkpoint does not claim otherwise. For the same reason the 390×640 summary
frame is drawn at the scroll position where a Champion actually meets the commit panel: 640 px
cannot hold the repeat decision **and** the whole panel, and drawing them together would either
clip the button — the exact defect the frame is about — or invent a composition no phone
renders.

## What shipped

`apps/westayfit/app/goals/new.tsx` now carries the spine, the payoff at the display tier, the
duration pills, the review-and-commit as one navy object, and the three truthful outcomes — plus
a foot reserve so nothing on this route ends under the floating member tab bar. Two things the
drawings did not settle were decided in code and are written up in `findings.md` F1: which
failure codes count as a refusal rather than an unknown result, and which refusals take the
submit control away. F6 has since been ruled on (`5788849410`) and the three primary calls to
action carry `ACTION_GREEN`, as the accepted target drew them.

## The producer writes nothing unless asked

Proven in this container rather than asserted:

```
$ find docs/design-target/review/goal-setup-next -name '*.png' | wc -l
0
$ WSF_PLAYWRIGHT_CHROMIUM=… WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 \
    npm --prefix apps/westayfit run test:e2e -- sprint-w6-goal-setup-next-capture.spec.ts
  ✓  1 passed
  [goal-setup PROPOSED] assertions ran; frames withheld (WSF_CAPTURE_FRAMES=1).
$ find docs/design-target/review/goal-setup-next -name '*.png' | wc -l
0
```

The assertions still ran: the ordinary suite keeps checking that the unconfirmed frame does not
claim *"Nothing was started"* or that a retry is safe, that the refused frame does not re-offer
the action the server just refused, that there are still exactly two repeat policies and four
durations, that the summary is still same-page with its submit inside it, and that no Living WE
appears anywhere. Only the bytes are withheld.

## Reproducing

```
npm --prefix functions-westayfit run build
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 \
  npm --prefix apps/westayfit run build:web
METADATA_SERVER_DETECTION=none npx firebase-tools emulators:start \
  --config firebase.westayfit.emulators.json --project demo-wsf-local

WSF_CAPTURE_FRAMES=1 \
WSF_PLAYWRIGHT_CHROMIUM=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1) \
WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 \
  npm --prefix apps/westayfit run test:e2e -- sprint-w6-goal-setup-next-capture.spec.ts
```

Loopback and `demo-wsf-local` throughout. No product, backend, rules, indexes, config, `.github`
or shared-kit change; no accepted or frozen image written; no external account, no deployment.

See [`findings.md`](findings.md) for what the source says and what was reported rather than
patched.
