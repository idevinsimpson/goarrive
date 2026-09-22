# Board 06 — Create / join / auth

**Status: SELF-CHECKED · independent board review pending.** The `_FINAL`
filename is the lock verdict's canonical name for this artifact, not an
acceptance status. Locked by PR #365 comment
[`5771368550`](https://github.com/idevinsimpson/goarrive/pull/365#issuecomment-5771368550).

Status layer, from that lock — and it is the most important sentence about this
board: *"This board does NOT promote the underlying routes to accepted-page
status; it records the current build truth and the intended visual grammar."*
**Board 06 surfaces are CURRENT BUILD / REVIEW, not accepted Pages 1–5.**

`WE_STAY_FIT_NORTH_STAR_BOARD_06_CREATE_JOIN_AUTH_FINAL.png` · 2560×3860 (1280×3860 @2x)

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

## Three provenances, two tags, never blurred

This is the part of Board 06 that needed the most care, because the routes it
covers are in three different states at once.

| Source | State | Tag on the board |
| --- | --- | --- |
| `batch-b-join-and-setup/after/` | `/join/[joinCode]` — **implemented**, awaiting visual and functional acceptance. Deliberately **not** in the frozen/accepted list, because it has not been reviewed. | `CURRENT BUILD · CAPTURED` |
| `batch-a-identity/after/` | the identity funnel — **built**, submitted for review. Frozen only so a routine run cannot change what is under review. | `CURRENT BUILD · CAPTURED` |
| `batch-b-join-and-setup/TARGET-*` | `/start-community` — **drawn, never built**. Each frame carries its own TARGET strip burnt into the image. | `TARGET · NOT IMPLEMENTED` |

**No frame on this board carries an accepted-build tag**, because none of these
routes is an accepted page. Freezing is not acceptance, and the board says so on
its face rather than leaving the distinction to this file.

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
| pending join code survives signup → verify-email → profile-setup → return-to-same-join | The four-frame funnel section, using the `carrying` variants that show the destination still named at each step |
| invalid, rate limit and generic preview error stay distinct | Three separate frames in the failure section, captioned with what makes each different |
| invalid/private/unknown has **no retry** that could leak existence | `AFTER-not-valid` has no retry control; the two that do are the ones that claim nothing about the link |
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
