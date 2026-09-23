# `/start-community` — BEFORE, and a proposed refresh

**Status: the BEFORE frames are photographs of the shipped route. The TARGET
frames are DRAWINGS awaiting a verdict.** They are not accepted, not
implemented, and nothing in `app/start-community.tsx` changed to produce them.
Every drawn frame carries an amber `PROPOSED / NOT ACCEPTED` strip inside the
image, so a frame that leaves this folder still says what it is.

Source tree: `39799c3fda875521a39566a6f06375d962f46c41`
Producer: `apps/westayfit/tests-e2e/sprint-w4-start-community-next-capture.spec.ts`
Emulators: `demo-wsf-local`, hosting `127.0.0.1:5010`, from this worktree's own
`apps/westayfit/dist`.

---

## What this checkpoint is for

`/start-community` had **no BEFORE at all** — `batch-b-join-and-setup/before`
contains none — so the accepted Batch B target for this route has never been
set beside the thing it replaces. Ten photographs fix that.

Then four drawings, for one reason: **the route cannot tell a refusal from an
unconfirmed result, and neither can the accepted target.** That is not a
styling note. It is the difference between a sentence that is true and a
sentence that invites a member to create a second community.

---

## BEFORE — the shipped route (10 frames)

| frame | what it shows |
|---|---|
| `start-arrival-*` | arrival: name, two types, three admission choices |
| `start-name-too-short-*` | the one client-side refusal the route has (`NAME_MIN_LENGTH = 2`) |
| `start-filled-*` | a representative filled form with the summary line |
| `start-name-over-80-accepted-*` | an 84–120 character name **accepted by the form**; only the server objects |
| `start-failed-INJECTED-NETWORK-*` | the route's error state, reached by aborting the callable |

`INJECTED-NETWORK` is in the filename because it is: the only way to reach the
error state without a real server fault is to abort `wsfCreateCommunity` at the
network layer. Nothing about the server was changed to take that frame.

## TARGET — the proposal (4 states × 2 classes, plus end frames)

| frame | the claim |
|---|---|
| `PROPOSED-start-next-refused-*` | the server **answered**; nothing was created and the screen may say so |
| `PROPOSED-start-next-unconfirmed-*` | the transport failed; the screen says it **does not know**, promotes "Check your communities", demotes the retry |
| `PROPOSED-start-next-created-*` | a confirmed `groupId` whose navigation failed is a **success** with one thing left to do |
| `PROPOSED-start-next-name-too-long-*` | the 80-character ceiling stated where it is enforced |

The `-end` frames are the same element at the same size with its own
`ScrollView` run to the end — nothing stretched, no layout faked. On
`start-next-unconfirmed` the end frame is **required**, not optional: the
demoted retry is below the fold, and a review that sees only the top of that
screen has not seen the proposal.

---

## The four findings these drawings answer

Detail, with line numbers and reproductions, in
[`findings.md`](./findings.md). In short:

1. **The route cannot distinguish "refused" from "we do not know."** One catch,
   one sentence — and the sentence asserts the server was not reached.
2. **The accepted target is stronger and therefore worse**: "Nothing was
   created." is a claim about server state the client cannot observe.
3. **A confirmed creation whose navigation fails renders as a create failure**,
   because `router.replace()` sits inside the same `try` as the awaited call.
4. **The form accepts a name the server refuses**, and the refusal never names
   the length.

`wsfCreateCommunity` carries **no attempt key**. This proposal asks for none
and claims no idempotency — it is a frontend recovery proposal only. No new
backend storage or API field is proposed, requested or implied.

## What the drawings deliberately do not do

No members, no faces, no discovery, no approval workflow, no progress number,
no Living WE. Two community types and three admission choices with the
meanings and defaults the route already has. Admission is who may join — it is
**not** personal name visibility, and nothing here implies it is. No automatic
second create, and no promise that retrying is free.

## Frames

| file | size | sha256 (first 16) |
|---|---|---|
| `before/start-arrival-390x640.png` | 390×640 | `7d216e4a37830fb4` |
| `before/start-arrival-390x844.png` | 390×844 | `a0f0f51eedbc1a4c` |
| `before/start-failed-INJECTED-NETWORK-390x640.png` | 390×640 | `d41430a519e3e181` |
| `before/start-failed-INJECTED-NETWORK-390x844.png` | 390×844 | `75947cfde775505d` |
| `before/start-filled-390x640.png` | 390×640 | `f53574170e354f25` |
| `before/start-filled-390x844.png` | 390×844 | `5d21f95fb7320555` |
| `before/start-name-over-80-accepted-390x640.png` | 390×640 | `347990995f7c2195` |
| `before/start-name-over-80-accepted-390x844.png` | 390×844 | `12f52d3a20d8dccd` |
| `before/start-name-too-short-390x640.png` | 390×640 | `5c39f0c8ac3576bb` |
| `before/start-name-too-short-390x844.png` | 390×844 | `7a61715f4125c1f7` |
| `target/CONTACT-SHEET-start-community-next.png` | 3520×1968 | `139166e3175b8747` |
| `target/PROPOSED-start-next-created-390x640-end.png` | 780×1316 | `af52b1b1b4b1bf15` |
| `target/PROPOSED-start-next-created-390x640.png` | 780×1316 | `91f7b30327aee522` |
| `target/PROPOSED-start-next-created-390x844.png` | 780×1724 | `7c0d6e5907879c5e` |
| `target/PROPOSED-start-next-name-too-long-390x640-end.png` | 780×1316 | `cb521efa1cd2f225` |
| `target/PROPOSED-start-next-name-too-long-390x640.png` | 780×1316 | `19ff363b76a5a7d7` |
| `target/PROPOSED-start-next-name-too-long-390x844-end.png` | 780×1724 | `9b69ca58c3472e77` |
| `target/PROPOSED-start-next-name-too-long-390x844.png` | 780×1724 | `d6f19db7170ce260` |
| `target/PROPOSED-start-next-refused-390x640-end.png` | 780×1316 | `5d54f1420e19798a` |
| `target/PROPOSED-start-next-refused-390x640.png` | 780×1316 | `b4896bd6a328f000` |
| `target/PROPOSED-start-next-refused-390x844-end.png` | 780×1724 | `95371a7789b960db` |
| `target/PROPOSED-start-next-refused-390x844.png` | 780×1724 | `9383cb96b0a22ffa` |
| `target/PROPOSED-start-next-unconfirmed-390x640-end.png` | 780×1316 | `84f41c5cb3ed0f02` |
| `target/PROPOSED-start-next-unconfirmed-390x640.png` | 780×1316 | `1458dc3fa43888d3` |
| `target/PROPOSED-start-next-unconfirmed-390x844-end.png` | 780×1724 | `fbb1698b3d8f9aa8` |
| `target/PROPOSED-start-next-unconfirmed-390x844.png` | 780×1724 | `338bda1325964ac9` |
