# Board 06 — Create / join / auth

**Status: SELF-CHECKED · independent board review pending.** The `_FINAL`
filename is the lock verdict's canonical name for this artifact, not an
acceptance status. Locked by PR #365 comment
[`5771368550`](https://github.com/idevinsimpson/goarrive/pull/365#issuecomment-5771368550).

Status layer, from that lock: *"This board does NOT promote the underlying
routes to accepted-page status; it records the current build truth and the
intended visual grammar."* Nothing gains standing by appearing here — **and
nothing loses the standing it already had.** The identity funnel's existing
acceptance is recorded on the board rather than overwritten by it; see *Three
provenances* below.

`WE_STAY_FIT_NORTH_STAR_BOARD_06_CREATE_JOIN_AUTH_FINAL.png` · 2560×3980 (1280×3980 @2x)

Authorised as W2's packet by the Director's `5783373780` §2 (*"The 00–05 stop
gate is removed"*), relayed on PR #397 `5783475743`, and confirmed against the
apparent conflict in `5783378056` §5 by the Director's `5783622375`
(*"Board06's released packet should continue; do NOT reset the visual gate"*).
Cut from canonical `1c6e1ed`.

## How it was made

```
node scripts/westayfit/north-star/render-board.mjs scripts/westayfit/north-star/board-06.mjs \
  docs/design-target/north-star-final/board-06/WE_STAY_FIT_NORTH_STAR_BOARD_06_CREATE_JOIN_AUTH_FINAL.png
```

Seventeen frames, every one read in place from `docs/design-target/review/`,
none copied, altered or re-captured. Nothing on this board was drawn by this
worker; the board is a composition of existing evidence and quotations from the
lock.

**Control before authoring.** The renderer was first run against an untouched
committed board — Board 03 — and reproduced it **byte-identically**. So the
toolchain is faithful here, and nothing on Board 06 is an artefact of a
different browser or font stack.

## Three provenances, three tags, never blurred

This is the part of Board 06 that needed the most care, and **the first draft got
it wrong.** It collapsed the identity funnel and the Join route into one
"current build, not accepted" tag, reasoning from the freeze-list comment in
`check-evidence-intact.mjs` (*"submitted for visual/functional review"*) and
never looking for a positive acceptance record. There is one, and the Director's
source review caught the error.

| Source | Actual state | Tag on the board |
| --- | --- | --- |
| `batch-a-identity/after/` | the identity funnel — **ACCEPTED**. `/signin`, `/signup`, `/reset-password`, `/verify-email`, `/profile-setup`, accepted at `3562156` (2026-09-21), recorded in `.github/wsf-staging/approved-candidate.json`. The frames here were **re-baselined afterwards**, at `5cf92e1` (2026-09-22). | `ACCEPTED BUILD · LATER CAPTURE` |
| `batch-b-join-and-setup/after/` | `/join/[joinCode]` — **implemented, still awaiting its page verdict**. Not in the accepted package label; its `after/` set is deliberately not frozen, because it has not been reviewed. | `CURRENT BUILD · CAPTURED` |
| `batch-b-join-and-setup/TARGET-*` | `/start-community` — **drawn, never built**. Each frame carries its own TARGET strip burnt into the image. | `TARGET · NOT IMPLEMENTED` |

Two lessons are recorded rather than quietly fixed. **Freezing is not what makes
something accepted — the record is.** The freeze list guards what is under
review; it is evidence of neither acceptance nor its absence, and inferring
either way from it was the mistake. And **a later capture of an accepted route
is still a later capture**: that is a fact about the frame, not a demotion of
the route.

`/goals/new` and `/combined/[setupId]` are unbuilt as well. They are **named on
the status panel and not drawn** — opening a goal is Board 08's subject, and a
board should not annex its neighbour's material to look complete.

## Checked against the lock, line by line

| Locked requirement | On the board |
| --- | --- |
| signed out → Sign in; unverified → Verify email; verified → one clear creation form | The three `/start-community` target frames, in that order |
| Family & friends defaults to **Private**; Other defaults to **Anyone with the link**; Public opt-in | `TARGET-start-form` and `TARGET-start-form-other`, each showing its own default selected |
| Public is **NOT discoverable** — link-joinable, but not listed or searchable | Stated on the `Other → Anyone with the link` caption and again in the lock panel |
| Anyone with the link can be forwarded until a new link retires it | On the invitation card itself, in the product's own words, on both invite frames |
| Private is not link-joinable, no add-by-name path, so today it holds only its creator | The `Family and friends → Private` caption says exactly this |
| one primary `Create community` | The form frames carry one filled primary and nothing competing |
| invalid-name feedback after interaction/submit, not while typing | `TARGET-start-name-missing`, captioned as the complaint arriving after the attempt |
| preview exposes only safe link-joinable metadata | Community name and kind only; no counts, no members, no goals |
| **private/nonexistent share the same invalid state — no existence oracle** | `AFTER-not-valid`, and the section headline is this rule |
| signed-out invitation says a free account is required, one filled `Sign up to join`, text-weight `Already have an account? Sign in` | `AFTER-invite-out` — *"You'll need a free account first."*, filled green primary, sign-in at text weight |
| signed-in invitation uses one primary `Join <community>` | `AFTER-invite-in` — `Join Harbor Walkers` |
| `What joining means` limited to existing capabilities: see goals/shared progress, add own contributions, leave whenever you like | Exactly those three bullets, and nothing else, on both invite frames |
| pending join code survives signup → verify-email → profile-setup → return-to-same-join | The four-frame funnel section, using the `carrying` variants. Each frame discloses the destination's **kind** — *"An invitation to a community"* — never the community's name or the code; the capture spec asserts the opaque value is not on screen. The four are independently seeded screenshots and are **not** themselves end-to-end proof: the round trip is proved by `e2-join-flow.spec.ts` §3.5, cited on the board |
| invalid, rate limit and generic preview error stay distinct | Three separate frames in the failure section, captioned with what makes each different |
| invalid/private/unknown has **no retry** that could leak existence | `AFTER-not-valid` carries no retry control; the two that do are the ones that claim nothing about the link. The board states the privacy contract as the **indistinguishable response and the authorization behind it** — an earlier draft asserted "a retry is the leak" as a categorical security claim, which the cited source does not establish, and the Director had it removed. The UI behaviour is unchanged |
| rate limit blames the link load, not the person | `AFTER-too-many`, captioned so |
| device question asked only from event context, before an account exists | `AFTER-device-choice`, captioned that an ordinary invitation never sees it |
| shared screen creates NO account, routes to the shared-device path | `AFTER-device-shared` |
| `Use my own phone instead` remains a real escape | Visible on the shared-screen frame and named in the lock panel |
| ordinary community invitations do not get the device question | Stated on the device-choice caption |
| no community directory/search, fake people/activity/counts | None anywhere; stated on the lock panel |
| **no Living WE on setup/auth surfaces without a confirmed ratio** | **No Living WE appears anywhere on this board.** None of these screens has a shared total to be a ratio of; the wordmark carries the brand instead |
| exact WSF assets, one-obvious-primary form grammar | Owner wordmark in the header; every frame is the real route or its labelled target |

## What this board deliberately does not do

- It does not promote any route to accepted-page status. The footer, the status
  panel and every tag say `CURRENT BUILD / REVIEW`.
- It does not draw `/goals/new` or `/combined/[setupId]`.
- It does not reproduce the 390×640 and 430×932 arrival states, which exist for
  every frame above; a board at this width shows the 390×844 class.
- It does not include the reset-password or auth-error surfaces, which exist in
  batch-a and belong to the identity story rather than to create / join.

## Fixtures

"Harbor Walkers", "The Henderson Family", "Riverside Church" and every address
on these frames are synthetic. No real community, person or invite link appears.

## Nothing was filled from memory

Every claim on the board is either a quotation from the lock or a property
visible in the frame it captions. Where the lock did not settle something, it is
not asserted.
