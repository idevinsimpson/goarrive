# WE STAY FIT — Candidate D evidence

Candidate D is an experience redesign, not a reskin. It answers the owner's real-device reviews of
18 September and the UX Director's Candidate D authorisation (clauses 1–12) and goal-flow hardening
(items 1–10). Candidate C stays frozen at `fcb83f7338c62a92a4605cf38b94be2b0fc15e87` and is **not**
staging-ready; nothing here is deployed.

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
| Goal created | Champion | put it to work | Open the contribute page | Contribute on a phone; Show on a big screen; Back to community | — |
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

## Verification

Filled from the final committed tree; see the completion comment on PR #327 for the run logs.

| Gate | Result |
|---|---|
| Type check | `tsc --noEmit` clean |
| Unit suite | Vitest, all green |
| Browser suite | full Playwright suite green **twice** on the final build |
| Weakened assertions | none: no `skip`, no `fixme`, no relaxed timeouts; several assertions strengthened |
| Mobile acceptance | `ui-mobile-acceptance.spec.ts`, three phone contexts, real touch and wheel scrolling |
| Vertical reachability | goal-screen scroll proof, 7 of 7 — **mechanical reachability baseline, not UX acceptance** |
| Captures | phone and wide for every owner-listed state; overflow re-measured with the repaired reader |
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
