# `/goals/new` — findings

Read off the source at `a193b43` (route blob `e5be66f`) and off the current-build captures in
`../goal-setup-current/`. **Every one of these is REPORTED. Nothing here is patched:**
`apps/westayfit/app/goals/new.tsx` is unchanged on this branch and stays unchanged until the
Director rules on the target. Where a finding shaped a drawing, the drawing is named.

## F1 — a lost response makes a second goal, and nothing on the client can tell

> **CONFIRMED INDEPENDENTLY, AND RULED ON.** W7 measured this in a browser at `a193b43`
> (evidence `e6a208a`, checkpoint `5787648446`): abort-before-send and
> commit-with-lost-response render the **identical sentence, word for word**, while the server
> holds 0 goals in one case and 1 in the other — so obeying *"Please try again."* after a
> committed-but-unconfirmed submit produces two goals, two ids, one title. W7 also found the way
> back: `/community/<groupId>` **already links to the goal that was created**. The Director
> accepted the finding at that level and specified the recovery this target now draws
> (`5787676653`). Seven passing investigation cases are not seven safety guarantees; the frames
> below are a proposal, not a shipped fix.

`wsfCreateGoal` takes no attempt key and writes to a fresh auto-id on every call
(`functions-westayfit/src/index.ts`: `const goalRef = db.collection('wsfGoals').doc()` inside
the transaction), and neither the callable nor the route enforces a one-open-goal-per-community
rule. A create whose response is lost — the connection drops after the transaction commits — is
therefore **indistinguishable on the client from one that never arrived**, and pressing the
button again creates a second goal for the same community.

The route renders both cases as one string. `describeServerError` maps `unavailable` and
`deadline-exceeded` to *"We couldn't reach the server. Check your connection and try again."*
and the default case to *"Something went wrong. Please try again."* Both invite the retry, and
neither says the first attempt may have succeeded.

**Drawn as:** two separate states, `PROPOSED-refused-*` and `PROPOSED-unconfirmed-*`, to the
Director's contract point for point:

| The contract (`5787676653`) | Where it is in the frames |
|---|---|
| the unknown sentence | *"We couldn't confirm your goal was created."* |
| brief duplicate warning | *"It may have been created anyway. Starting another one could create a duplicate."* |
| primary resolves, community-level | **Check community goals** → `/community/<groupId>`, the route's own already-validated param |
| fresh create is explicit, subordinate, deliberate | **Start another goal**, a secondary inside the panel, with *"…your community will have two."* beside it |
| never an automatic retry | no `Try again`, no retry sent on the Champion's behalf — asserted by the producer |
| refusals stay separate and actionable | the refused frame keeps its own banner and a **Back to community** action, and does not redraw the control the server just refused |
| no blanket claim | *"The server refused this request, so no goal was created."* is on the **refused** frame only, tied to the refusal that makes it true; the producer asserts the unconfirmed frame contains none of `Nothing was created` / `Nothing was started` / `no goal was created` / `no goal was started` |
| goalId is the server's | the created frame's action resolves `/contribute/<goalId>` from the callable's response; **no id inferred from the title, no matching-name goal selected** |
| reload promises nothing | nothing in any frame says a draft or receipt is saved; the producer asserts the word `saved` does not appear |

**No idempotency is claimed and no backend field is asked for** — the honest frontend answer to
a backend gap is to stop asserting what it cannot observe, not to design around it.

**For the implementation's independent review, not this checkpoint:** W7's existing-community
recovery assertion finds an *attached link* to the stored goal, which is narrower than proving
the proposed action is visible, tappable and arrives there. When this is implemented, that
review must exercise the real **Check community goals** action and verify it creates no second
goal.

*This is the same refusal-vs-unconfirmed class W4 recorded on `/start-community`. Two routes,
one shape; a fix that only lands on one of them leaves the product inconsistent.*

## F2 — the commit control is outside the thing it commits

`Check it over` is `kit.cardQuiet` — a 55%-white card, the palest surface on a page of three
solid `kit.card`s — and `Start this goal` is a sibling **below** it. At 390×844 the summary's
seven rows and the control that agrees to them are never on screen together
(`form-summary-check-it-over-390x844.png`: the card's foot is at the viewport edge, with the
raised MOVE circle over its last row).

**Drawn as:** `PROPOSED-summary-commit-*`. The same seven rows, the same words, on the one navy
surface on the page, with the control inside it. The panel ends in the button rather than in a
row, which also takes the last row out from under the MOVE circle.

## F3 — the member tab bar overlaps content

Already recorded as observation 4 of `../goal-setup-current/README.md`, and visible in
`form-populated-top-390x640.png` and `created-receipt-390x844.png` (the bar's raised circle sits
over *"Back to community"*). Nothing interactive is underneath it today, so it is a framing
defect rather than a W5-M1-class one.

**Drawn as:** an explicit reserved strip at the foot of every frame, labelled as reserved. The
strip is drawn as reserved space and **not** as a picture of the bar: `MemberTabBar.tsx` is
another worker's file and this checkpoint has not looked at it.

## F4 — the payoff line is drawn at label weight

`definitionPhrase` produces the sentence the first section exists to make — *"30,000 squats"* —
and the route renders it at 20 px in the same navy as the field labels above it
(`styles.definition`). `kit.display.md` (29 px / 900) exists for exactly the value that carries
a screen, and the kit's own comment says the missing display tier is what makes this product's
numbers small.

**Drawn as:** the phrase at `display.md` on `kit.OPTION_SELECTED_TINT`, the only thing at that
size on the screen.

## F5 — the duration choice spends 340 px on four short labels

Four `OptionRow`s, each 56 px minimum plus a one-line description, for a choice whose options
are *1 week / 2 weeks / 1 month / Custom*. Three of the four descriptions describe an option
that is not selected.

**Drawn as:** `kit.pill` / `kit.pillSelected` — four pills, 44 px of hit target each, the same
four labels, with the **selected** option's description kept once underneath. No option is
removed, added or reworded.

## F6 — the primary action uses the colour the kit reserves for the shared total

`kit.primaryButton` fills with `PROGRESS_GREEN`. `kit.ts` introduces `ACTION_GREEN` with the
comment that it is *"deliberately a SEPARATE token"* because *"a button must never be able to
restate what the Living WE is saying about the shared total"*. This route has no Living WE on
it, so nothing is wrong on this screen today — but the token contract is not being kept, and
`/goals/new` is where a Champion's eye is trained on what green means.

**Drawn as:** `ACTION_GREEN` with `ON_ACTION` ink on every primary in the proposal. **This is
the one token substitution in the checkpoint** and it is called out here so a verdict can accept
the layout and refuse this, or the reverse.

## F7 — the signed-out state carries no `testID`

Re-stated from observation 3 of `../goal-setup-current/README.md` because it lands on me: the
route renders a real panel (*"Sign in to start a goal"*) with no test id, while every other
state on the screen has one. Not drawn in this checkpoint — the proposal does not touch the
arrival guards — and not fixed, because the product file is not mine to change yet.

## F8 — the repeat section says the same thing twice

The card title is *"How members take part"* and the field label directly under it is *"How often
can one member contribute?"*. Both are kept **verbatim** in the target: rewriting product copy
is not what a hierarchy checkpoint is for. Flagged so the Director can rule on it as copy.

## F9 — measured, not asserted: what clears the fold

Printed by the producer on every run (`[gsnext] …`) so the numbers come from the rendered frame
rather than from an estimate. See `README.md` for the values from the capture run.

## Not findings, deliberately

The route is **right** about several things this target keeps untouched, and they are listed so
nobody reads their absence as an oversight:

- The device's zone is the creation zone and there is no picker — the words, the instants sent
  and the stored zone cannot disagree.
- Under Custom the explicit start control **replaces** the derived *"Starts …"* line rather than
  doubling it (observation 1 of the BEFORE package). The target draws it that way and the
  producer asserts it.
- `once` is the conservative repeat default on the client for the same reason it is on the
  server.
- The summary states an end-before-start in the row's own voice rather than in red, leaving red
  for the field after a submit.
- The production gate stays exactly as it is, including its own comment that it is a guard
  against accidental production writes and **not** a security boundary.
