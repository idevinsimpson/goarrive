# WE STAY FIT — Candidate D evidence

Candidate D is an experience redesign, not a reskin. It answers the owner's real-device reviews of
18 September and the UX Director's Candidate D authorisation (clauses 1–12) and goal-flow hardening
(items 1–10). Candidate C stays frozen at `fcb83f7338c62a92a4605cf38b94be2b0fc15e87` and was never deployed.

**Deployment state, as of 2026-09-19 01:32 UTC.** Candidate D `a3496eb` IS deployed to the isolated
`westayfit-staging` project, under the owner's standing staging authority of 2026-09-18. Run
35412514702 served it and the harness read the health marker back as `a3496eb`. Hosted verification
**FAILED at 20 of 21 rows**: the one failure is `recent public additions (W2)`, refused at the
transport layer with HTTP 403 because `wsfGoalRecentAdditions` runs with the Cloud Run invoker IAM
check enabled. That is Google-side and unchanged by this candidate. This is a usable staging
iteration, not completed hosted acceptance.

## What is NOT in this change

`functions-westayfit`, `firestore.rules`, `firestore.indexes.json`, `.github/**` and every
`firebase*.json` are **byte-identical to candidate B and C**. Verified with
`git diff --stat fcb83f7 -- functions-westayfit firestore.rules firestore.indexes.json .github firebase*.json`,
which returns empty, and independently by the tests/contracts/privacy review lens. No admission
semantics changed. Candidate E (route-specific share metadata, a featured goal in the join preview,
any server change) remains deferred and unstarted.

## UX architecture matrix

Route and state → role → the one job → primary action → secondary → destructive or admin.

| Route / state | Role | Primary job | Primary action | Secondary | Destructive / admin |
|---|---|---|---|---|---|
| Home, signed out | visitor | understand WE STAY FIT and get in | Create an account | Sign in; Join with a code | — |
| Home, signed in, no community | member | get into a first community | Start a community | Join with a code | Sign out (utility footer) |
| Home, signed in, ≥1 community | member / Champion | reach my community and its next action | the community card: Open / Contribute / Start a goal | Join another community; Start a community | Sign out, Build details (utility footer) |
| Start your community | verified member | one clear choice, then create | Create community | Back to home | — |
| Join, signed out | visitor | understand and decide | Sign up to join | Sign in; Not now — back to home | — |
| Join, signed in | member | join | Join &lt;community&gt; | Not now — back to home | — |
| Community Home, active goal | member | see progress and take part | Start moving / Record | Share display link; Invite people; History when non-empty | Membership options → Leave (confirm) |
| Community Home, active goal | Champion | the same, plus steward it | Start moving / Record | Invite people | Manage: display, details, new invite link (confirm), leave |
| Community Home, no goal | Champion | start the story | Start a goal | Invite people | Manage |
| Community Home, no goal | member | know where things stand | honest no-goal state | Invite people where allowed; Back to home | Membership options → Leave |
| Start a goal | Champion | define it | Start this goal | Back to community | — |
| Goal created | Champion | put it to work | Open the contribute page | Show on a big screen; Back to community | — |
| Contribute entry | member | add my count | Record | Back | — |
| Manage sheet | Champion | administer | per section | — | new invite link (confirm), leave (confirm, sole-Champion refusal) |
| Kiosk | visitor | start a contribution | Start | Finish | — |
| Public display | public | see shared progress | — | — | — |

## Review: three adversarial lenses

32 raw findings: **7 blocking, 15 should, 10 nit** (16 visual/a11y/mobile, 12 product hierarchy,
4 tests/contracts/privacy). The 7 blocking dedup to **5 unique**, because two were raised by two
lenses each.

| # | Unique blocking finding | Raised by | Fix | Regression |
|---|---|---|---|---|
| 1 | Join signed-out had no "Not now — back to home"; a visitor who did not want an account had no way out | product, visual | secondary added to the signed-out branch | join spec asserts the control and its href |
| 2 | Manage's invite-link caveat told a public community's Champion it "can be found and joined by anyone" (clause 9: no discovery exists) | product, tests | sentence removed; copy states only enforced behaviour | admission spec asserts the enforced sentence |
| 3 | A private community's Invite card had no working action and named a setting that does not exist | product (visual: should) | the dead-end card and its instruction removed | admission spec asserts no invite affordance on private |
| 4 | "Yes, create a new link" overflowed a 195 px viewport by 30 px | visual | button wraps within the confirmation card | capture overflow check at 195 px |
| 5 | The raw join URL was printed as body copy under the opened QR (clause 5) | visual (tests: should) | member-facing card passes `showUrl={false}`; the value rides on `data-qr-url` / `data-invite-url` | QR and admission specs read the attribute and assert the text is absent |

### Confirmed material "should" findings, and what was done with each

| Finding | Fix | Regression |
|---|---|---|
| A community card's underlined action label read as a second link to a different place | the underline is gone; the label is weight-700 navy text inside the one card link | Home specs drive the card as a single link |
| Signed-in Home listed communities in the server's order, so the one with an open goal could sit mid-list | `orderByUserValue` sorts communities with a confirmed open goal first, soonest-ending first, keeping the server's order within each group | Home spec asserts the ordering |
| The "Check it over" card read back an invalid window as what the community would see | a derived `windowInvalid` makes the Ends row say it must be after the start instead of confirming it | goal-form spec asserts the refused window is shown as refused |
| The goal-created screen offered two differently-labelled controls for the same route | "Contribute on a phone" is removed; "Open the contribute page" carries that link itself | goal-form spec asserts one control and its href |
| Single-action states were an underlined link alone in an otherwise empty card | sign-in, back-to-home and the start-community unverified action became real buttons | community and start specs assert the controls |
| Every option row emitted `aria-selected` on `role="radio"`, which ARIA does not permit | `accessibilityState` is now `{ checked, disabled }` and the raw attribute is `aria-checked` | option-row unit test and the specs assert `aria-checked` |
| A private community's Invite card named a setting that does not exist | the copy now states plainly that such a community has no invite link or QR to share | admission spec asserts no invite affordance |
| The raw invite URL was still printed under the Champion's Manage QR | `showUrl` now defaults to off, so no surface prints it; the value rides on `data-qr-url` | QR spec asserts the Manage panel does not contain the join path |
| The capture of Home caught every card mid-read on "Checking for an open goal…" | the capture harness waits for the per-community goal reads to settle | capture harness only; not a product change |

Two findings were deliberately **not** fixed and are recorded as owner decisions rather than defects:
the "Public" option stating the same consequence as "Anyone with the link", and the reduction in what
a member is shown. Both appear under the open decisions below.

## The overflow reader, and a false green I reported

At 7:46 PM and 8:47 PM ET I reported "0 overflow offenders across all 51 states". That was wrong.
My check iterated each state's top-level keys instead of its nested `results` array, so every state
passed trivially while a real 195 px offender sat in the data. The visual lens caught the
contradiction.

The reader is now a real tool (`scratchpad/check-overflow.py`) whose rule is that a result must be
proven good: a missing or empty `results` array, a malformed result, a non-boolean `ok`, an
`ok: true` that still carries offenders, a missing expected width, or a state-count mismatch are all
failures, never silent passes. It prints the denominator it inspected and exits non-zero on any
problem. Its self-test has 10 cases, all passing, including a document whose only defect is a nested
failing width result, asserted to fail — the exact shape that fooled the old check.

The checker is committed at `scripts/westayfit/check-overflow.py`; run `--self-test` for the 10
regressions, or pass an `overflow.json` with `--expect-states N` for a run's real numbers.

## Verification

Filled from the final committed tree; see the completion comment on PR #327 for the run logs.

| Gate | Result |
|---|---|
| Type check | `tsc --noEmit` clean |
| Unit suite | Vitest, all green |
| Browser suite, run 1 on the committed tree | **158 / 158 passed** (7.5m) |
| Browser suite, run 2 on the committed tree | **PENDING** — not yet complete; this row will name its log and counts when it is. It is not claimed as passing |
| Weakened assertions | none: no `skip`, no `fixme`, no relaxed timeouts; several assertions strengthened |
| Mobile acceptance | `ui-mobile-acceptance.spec.ts`, three phone contexts, real touch and wheel scrolling |
| Vertical reachability | goal-screen scroll proof, 7 of 7 across four viewports — **mechanical reachability baseline, not UX acceptance** |
| Captures | 102 frames over 51 route/state pairs, phone and wide. **Taken from the pre-commit working tree, not from `a3496eb`**; SHA-matched captures and the book are PENDING |
| Narrow-width overflow | `scripts/westayfit/check-overflow.py`, committed here: 51 states, **102 width checks, 0 failed**, on the capture run of 2026-09-19 01:01 UTC |
| Backend boundary | empty diff against functions, rules, indexes, workflows, Firebase configs |

## Decisions that are the owner's, and remain open

Execution is unblocked; **acceptance is blocked** on these. None is implicitly approved.

1. **Whether to offer "Public" at all.** It is enforced identically to "Anyone with the link": both
   are link-joinable, neither is discoverable. Candidate D states only the enforced truth for each,
   but that leaves two options with the same consequence, which a review lens also flagged.
2. **Whether Family & friends should keep defaulting to Private.** Under current code a private
   community cannot be joined by anyone, so the default choice creates a community no one else can
   enter. Recorded in DECISIONS.md; unchanged here.
3. **Whether members should lose Type, Joining, Status and Your role.** Those rows moved into the
   Champion-only Manage sheet. It is what clause 1 and the matrix ask for, and it is a real
   reduction in what a member is shown.
