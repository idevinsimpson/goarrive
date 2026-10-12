# Join — the corrected unconfirmed-outcome screen

**Source: app-shell `44cc0633f3d62b1f33d757f6bc0e401758f04523`**, join route blob
`951ecc9751e8bb968abd6bc245cdee4a01053756`, plus this branch's one bounded correction.

Three frames of one screen. **No existing BEFORE / TARGET / AFTER byte is touched**; this is a
new path, pending the separately recorded acceptance/rebaseline decision.

| Frame | sha256 (first 16) |
|---|---|
| `join-unconfirmed-390x640.png` | `cfa3577a1791d987` |
| `join-unconfirmed-390x844.png` | `92a029b4b17777fb` |
| `join-unconfirmed-430x932.png` | `d8f719c5f8930165` |

## What was wrong

`JOIN_FAILURE_DEFAULT` said **"Nothing was changed. Check your connection and try again."** for
any join that threw without a mapped callable code, and the comment beside it justified the
promise with `db.runTransaction`.

The atomicity is real and it answers a different question. A transaction makes the write
all-or-nothing **on the server**; it says nothing about whether the server got that far. An error
with no callable code is exactly the case where the commit may have happened and the **response
was lost** — and the screen performs no membership read before speaking, so it cannot know either
way. A member told "nothing was changed" who then asks for a new link, or joins again, is acting
on a claim the client was never entitled to make.

A second, quieter fault sat in the same `try`: it ran from the callable all the way to
`router.replace`, so anything thrown **after** the awaited success — session storage, the
destination computation, the navigation — was caught and presented as a failed join. That is
false twice, because the call had already returned and the member *is* in the community.

## What changed

- **Unclassified / transport-uncertain** → heading **"We couldn't confirm your join."**, body
  **"Check your connection, then try again."** No failure asserted, no membership claim, no
  rollback claim. Retry stays safe: the callable is idempotent for an existing member, which is
  what `alreadyMember` is for.
- **Mapped codes are unchanged and now pinned.** Reaching `JOIN_FAILURE_COPY` means a code came
  back, so the server answered and declined — those keep the definite heading **"We couldn't join
  this community."** A test asserts it, so the unconfirmed wording cannot leak onto a real
  refusal.
- **The catch ends where the call ends.** Only the awaited call is inside it.
- **The event-carrying is bounded.** Session storage and `routeAfterJoin` run in their own try and
  fall back to `/community/{groupId}` — the id the server just returned. A storage-blocked browser
  costs the event context, not a join that already succeeded. Nothing is said to the member.
- Server-provided text still never renders; admission behaviour, destination carrying and layout
  are untouched.

## The frames

Reached on the real route by refusing the join callable with `INTERNAL`, a status that carries no
mapped code — **the one injected fault**, labelled here and in the spec. Nothing fakes a server
answer that did not happen.

Each frame is asserted before the shutter: the exact corrected heading and body, the **absence**
of "Nothing was changed", the absence of the server's own message, and the invitation still
standing with its retry offered.

Producer: `apps/westayfit/tests-e2e/sprint-w4-join-outcome-correction-capture.spec.ts`, gated on
`WSF_CAPTURE_FRAMES=1`. An ordinary run asserts all three sizes and writes nothing — verified
(3 passed, 0 files) before the gated run.

## Still carrying the old promise — reported, not changed here

`apps/westayfit/src/ui/designTarget/JoinSetupTargets.tsx:503` renders
`"Nothing was changed. Check your connection and try again."` in the TARGET component. The
corrected route and that target now disagree, and reconciling it is the separately recorded
rebaseline decision, so it is untouched. (`RoomScreenTargets.tsx:625` carries a near-identical
line for a different surface, outside this hold.)

## For W5

The adversarial real-commit / response-lost probe is W5's. The immutable patch SHA to pin against
is this branch's commit; W4 has not duplicated that probe.
