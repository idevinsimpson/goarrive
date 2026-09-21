# Atlas Batch A — identity and onboarding

**Implemented, and awaiting visual/functional review.** `/signin`, `/signup`,
`/reset-password`, `/verify-email` and `/profile-setup` are built to the
accepted target. See *Implemented* below for what changed and what was
corrected.

> **This header has now been stale twice.** It first said "eight surfaces… at
> two phone classes" after the batch had grown to seventeen and three; it then
> said "targets only, nothing implemented" after the routes were built. A
> hand-kept inventory beside a generated one will always drift, so the
> inventory is deleted rather than re-typed for a third time.
>
> **`docs/design-target/ATLAS-COVERAGE.md` is the authority** for what is on
> disk: every state by name, the classes it is drawn at, and the `before/` and
> `after/` evidence beside the targets. It is generated from the PNGs, and
> `npm run check:route-index` fails if it drifts.

## The frames

`CONTACT-SHEET-batch-a.png` — every state at 390×844 in one labelled frame.
`TARGET-*.png` are the reviewed and accepted targets; `before/` and `after/`
hold the actual product, before and after implementation.

Every TARGET frame carries `TARGET / CONCEPT — NOT IMPLEMENTED` burnt in
**inside** the frame; the strip is added to the frame's height, so the device
area beneath it is exactly the class the filename names.

## No fillable Living WE in this batch

Its fill is a truthful confirmed-progress instrument, and **not one of these
eight surfaces owns a progress value** — most do not have a community yet.
Using it decoratively here would turn the product's one honest progress signal
into decoration everywhere else. The brand carries these screens through the
compact wordmark, the navy field, its motion texture, and the type.

## Four tones, so the state reads before the words do

| Tone | Treatment |
| --- | --- |
| **ordinary** | Navy field, green action. Sign in, sign up, reset. |
| **action required** | The field carries a step chip and an eyebrow; the sheet leads with the thing to do, and says what to do when it does not work. |
| **error** | The field is unchanged — a failed password does not re-brand the product — and the sheet carries a banded message with **both** honest forks as real controls. |
| **returning** | The field carries the destination that is waiting, which is the entire point of the screen. |

## What the BEFORE frames prove

`BEFORE-return-to-join-390x844.png` and `BEFORE-return-to-event-390x844.png`
are **pixel-identical to `BEFORE-signin-390x844.png`**. A visitor who scanned a
join invitation or an event code, was told to sign in, and arrived here is told
nothing at all about where they are going to land. That is the single largest
thing this batch fixes, and it is a product finding rather than a visual one.

## What the returns do not claim

A pending join code is opaque and a pending event is a goal id. Naming the
community or the goal needs a read a signed-out visitor may not be entitled to
make. So the destination card names the **kind** of thing waiting and what will
happen next — true from `sessionStorage` alone. If the implementation can
resolve the name, it may add it. The target does not promise what it cannot
read.

## Two surfaces that are not routes

"Return to event" and "return to join" are **not pages**. They are `/signin`
with a pending destination in `sessionStorage`, which `nextRouteAfterAuth`
consumes on the terminal hop — after the member is verified and has a profile,
never before, or `wsfJoinCommunity` fires against a profile that does not exist
yet. The targets draw them as states of sign-in, because that is what they are.

## The composition, and the dead space rule

A sign-in form is three controls. On an 844 phone that is a quarter of the
viewport, and the first cut left the rest as empty cream — the flatness the
owner board moves away from. Two changes fixed it without inflating anything:
the navy field **takes a share of a tall screen** (38%, and none of a short
one, where the form needs every point), and the ways out sit at the **foot**,
where a thumb is, instead of trailing the primary action.

## How they were made

```
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 \
  npm --prefix apps/westayfit run build:web
WSF_PLAYWRIGHT_CHROMIUM=... WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 \
  ./node_modules/.bin/playwright test --config=playwright.config.ts \
  tests-e2e/design-target-auth-before.spec.ts tests-e2e/design-target-auth-capture.spec.ts
```

`/design-target/auth` renders only when the build carries
`EXPO_PUBLIC_WSF_USE_EMULATORS`, and `scripts/westayfit/build-staging.sh`
refuses a build that sets it. No deployed artifact can serve this route.

## The four owed corrections are closed — 2026-09-21

Batch A is still **target only and not approved**. But it is no longer "not
final as drawn": every debt recorded here has been paid, and the frames were
recaptured. A batch carrying known defects cannot be counted toward a complete
atlas, and this one was, which is why it was reopened.

| Debt | Closed by |
| --- | --- |
| 1 · sign-up must keep the real 8-character rule visible | `TARGET-signup-*` now carries "At least 8 characters" under the field, as `FieldHint` does. `canSubmit` requires `password.length >= 8`, so the rule is stated where it is enforced rather than discovered at submit. |
| 2 · verify and reset need the real send states | All five `VerificationSendOutcome` values are drawn — `verify-sending`, `verify` (sent), `verify-already`, `verify-unconfigured`, `verify-failed` — each with the shipped `INTRO` sentence. Reset gains `reset-sent` and `reset-unconfigured`. |
| 3 · consent must not be depicted pre-checked | `TARGET-profile-*` draws the box **empty**, the shipped sentence in full ("By saving I confirm I am 13 or older and accept the Terms of Service and Privacy Policy"), both policy links, and the primary **disabled** — because with `acceptedTerms` false, it is. |
| 4 · the destination must survive the later gates | `verify-carrying` and `profile-carrying` draw it. `nextRouteAfterAuth` is read at signup, verify-email **and** profile-setup, so a pending destination outlives all three gates; the frames previously covered only the sign-in hop. |

### And a fifth gap, which nobody had recorded

`nextRouteAfterAuth` resolves **three** destination kinds — a pending join
code, an event return, and a **kiosk** return (`readKioskReturnGoal` →
`kioskContributeRoute`). Batch A drew the first two. `TARGET-return-kiosk-*`
draws the third, and it is the one where the wording matters most: the person
is standing at a shared device, and what they most need to know is that
finishing signs them out of it.

### What the destination frames still refuse

They name only the **kind** of thing waiting, never its name. A pending join
code is opaque, and a private community's name is not something a
half-authorized account is entitled to read. If an implementation can resolve
the name for a destination the member is already entitled to see, it may add
it; the target does not promise what it cannot read.

## Recomposed after review — the two states that were truthful but not settled

**Verify · email switched off.** The shipped screen renders all three controls
unconditionally: *I have verified*, *Resend verification email* and *Sign out*.
In this outcome the first two cannot succeed — there is no link to have
followed and nothing to resend — and the only one that resolves anything is the
**tertiary** at the bottom. The first revision reproduced that faithfully and
stated the failure twice, in the intro and again in the panel.

Recomposed: the reason is said once, **signing out to use a verified account is
the primary**, and the two that cannot work are drawn muted rather than
removed — removing them would hide that the shipped screen still offers them.

> **Product finding.** `app/verify-email.tsx` does not gate its three actions on
> `VerificationSendOutcome`. The route is untouched here; the fix is a
> condition, and it is a product decision.

**Second revision of this state:** the first recomposition still explained why
two controls did nothing and then drew them, disabled. That is a transcript of
the defect, not the destination. The target now offers **only what can work** —
Sign out as the sole action, one short "what to do" — and the defect lives here
in the findings, which is where a defect belongs rather than in the picture of
how the screen should look.

## Profile setup: the privacy line, narrowed to what the source proves

The recomposed state first said the community sees this name and that it is
"not shown to anybody outside your community". **Both are broader than anything
the product guarantees**, and the second is a global audience promise with no
mechanism behind it.

| Claim | Source |
| --- | --- |
| `wsfMemberProfiles/{uid}` is owner-readable only | `allow read: if request.auth.uid == uid` |
| Every read and write of it is keyed to the caller's own uid | `functions-westayfit/src/index.ts` — lines 139, 222, 680 |
| **No callable returns another member's `displayName`** | the only `displayName` in a response shape is a *community's* (`PreviewResponse`) |
| Contributions are never attributed publicly | recent additions carry amount, unit and time; uid and name stripped server-side |

So today this name is shown to **nobody but its owner**, and a promise about
who else sees it — in either direction — is one the product cannot keep. The
name that does go on a screen in a room is a **different** one, chosen per turn
on the event screen, and the target now says so rather than leaving a member to
conflate the two.

**Profile setup.** A display name is one field, so this state was a name, a
checkbox, a button and a third of a phone of empty cream. The void is filled
with the one thing the screen owes an answer to — *where this name appears* —
rather than with padding.

## Coverage now

- **17 states**, up from 8.
- **Three phone classes** — 390×844, 390×640 and **430×932**, which this batch
  previously left as the atlas's open device gap.
- `-end` frames wherever a state overflows the phone.

Still target only. Nothing here is approved and nothing should be built from
these frames without a separate authorization.

## The BEFORE set, completed to three classes — 2026-09-21

`before/` held **eight states at two classes only**, 390×640 and 390×844.
There was no 430×932 BEFORE at all.

The Batch A implementation pass asks for BEFORE → AFTER at three classes, and
a BEFORE can only be photographed **while the BEFORE still exists**. The moment
these routes are built to the target, the large-phone BEFORE is gone and no
later run can recover it. So the missing class was captured first, against
untouched routes, before a line of Batch A code was written.

This **added** eight frames. The sixteen already frozen were not recaptured;
`npm run check:evidence` holds them byte-for-byte, and the four that a routine
capture rewrote were reverted rather than re-baselined — see below for why two
of them changed.

### A capture race this uncovered, recorded rather than fixed

Running the BEFORE capture rewrote four of the sixteen frozen frames. Both
causes were measured, not guessed:

| Frame | Diff | Cause |
| --- | --- | --- |
| `BEFORE-auth-error-390x640/844` | the synthetic email address only | Fixture nondeterminism. Each run stamps a fresh address. Cosmetic. |
| `BEFORE-verify-email-390x640/844` | the whole intro paragraph | **A real race.** The frozen frames caught `unconfigured`; the new run caught `sending`. |

`verify-email.tsx` derives its intro from `readVerificationSend(user.uid)`, and
`sending` is deliberately the non-committal state — nothing has been confirmed,
so nothing is asserted. The capture spec does not pin the outcome, so it
photographs whichever state the send happens to be in when the shutter fires.

It is genuinely intermittent, and the proof is inside one run: **at 430×932 the
same code on the same run landed on `unconfigured`**, matching the frozen
siblings, while 390×640 and 390×844 landed on `sending`.

All four frames were reverted. The spec is **not** changed to pin the outcome,
because a spec that produced a different frame than the frozen ones would break
the guard on every future run — and re-baselining an accepted BEFORE is not
something this pass is authorized to do.

**Consequence worth knowing:** a future routine run may trip `check:evidence`
on `BEFORE-verify-email-390x640/844` through no fault of the runner. That is
the guard working, not a defect in the change under test. The AFTER capture
built in this pass pins the outcome deterministically so the same race cannot
reach the AFTER evidence.

### What the BEFORE shows that the target fixes

The `unconfigured` frame is the clearest case. It says plainly *"no message was
sent. Nobody can finish verifying a new account here until it is switched on"*
— and then offers **I have verified** and **Resend verification email**, two
controls that cannot work, above the one that can. That is the dead-control
defect the accepted target removes.

## Implemented — 2026-09-21

`/signin`, `/signup`, `/reset-password`, `/verify-email` and `/profile-setup`
are built to the accepted target. `after/` holds 42 frames: 14 states at
390×640, 390×844 and 430×932.

**One shell, not five rewrites.** Every identity route renders through
`FormShell`, so the reset is one composition — a navy field carrying the
wordmark, the heading and any waiting destination, over a cream sheet carrying
the form. No Living WE anywhere in the batch: its fill is the product's one
truthful confirmed-progress instrument, and none of these surfaces owns a
progress value.

**The ways out moved to the foot.** They sat trailing the primary action above
a third of a phone of empty cream. At the foot they are where a thumb is.

### Product findings this pass FIXED rather than recorded

The target recorded these as findings because a target is a drawing. The
implementation is where they get resolved.

| Finding | What was done |
| --- | --- |
| `/verify-email` renders all three actions regardless of outcome | **Resend is now gated** on the outcome. See the correction below for the one that is not. |
| Sign out appeared twice on `unconfigured` once it became the primary | The foot drops it in that state. |
| `/profile-setup` had no sign-out at all | Added. A member who reached the last gate on the wrong account had no control on the screen to leave with. |
| The consent control announced no state | **A real accessibility defect.** It renders `role="checkbox"`, and react-native-web was not mapping `accessibilityState={{ checked }}` to an attribute — so a screen reader met a checkbox with no state, on the one control recording a legal consent. `aria-checked` is now set directly. |

### One instruction not followed, and why

The brief said to drop **both** "I have verified" and "Resend" on
`unconfigured`. Only one of them is dead, and the difference is in what each
calls:

- **Resend is dead.** It calls `wsfSendVerificationEmail` — the callable that
  just threw `failed-precondition` because `WSF_EMAIL_*` is unset. Pressing it
  again fails identically. It is gone.
- **"I have verified" is not dead.** `onCheck` calls `reload(user)` and reads
  `user.emailVerified` — the *current auth state*, not anything this build
  sent. An address verified by any other means (an earlier build, an
  administrator, an already-verified account) makes it succeed and route
  onward. Removing it would delete a working way out of the gate.

So the dead one went and the working one stayed, demoted beneath **Sign out
and use a verified account**, which is now the primary. The rest of the
recomposition stands: the reason is said once, in the field, and the sheet
carries only what to do.

### The BEFORE spec's return fixtures never reached the product

Worth knowing before anyone reuses them. `design-target-auth-before.spec.ts`
seeds its two return states with `wsf.pendingJoinCode = 'ABC123'` and a key
called `wsf.pendingEventGoalId`. Neither is read:

- `isValidShape` in `pendingJoinCode.ts` requires **16–128** characters, so a
  six-character code is refused on read.
- The event return lives under **`wsf.eventReturn`**, as a JSON record
  `{goalId, at}`. Nothing reads `wsf.pendingEventGoalId`.

Those frozen BEFORE frames therefore show a sign-in screen with no destination
because the fixture silently did nothing — not because the old screen resolved
one and declined to say so. The frames are still **true about the product**
(the old screen said nothing either way), so they are not re-baselined. But the
AFTER spec does not inherit the fixtures: it uses shapes the product accepts
and asserts the destination card is on screen before each shutter.

### Outcomes are pinned, not raced

Every verification and reset outcome in the AFTER capture is fulfilled by an
intercept, so a frame means the state it is named after. This is a direct
response to the race recorded above, where one BEFORE run caught `sending` at
two classes and `unconfigured` at a third.

### The state matrix

| | BEFORE | AFTER |
| --- | ---: | ---: |
| States | 8 | 14 |
| Classes | 3 (430×932 added in this pass) | 3 |
| Frames | 24 | 42 |

Six AFTER states have no BEFORE — `reset-sent`, `reset-unconfigured`,
`verify-unconfigured`, `verify-carrying`, `profile-carrying`, `return-kiosk`.
The old screens had no such state to photograph, so the honest label is **new
state**, not a frame pair. The four the brief named as must-haves —
pending-destination, unconfigured, failure and short-phone — are all present
at all three classes, and none is grouped away into a contact sheet.

### Boundaries held

No secret, sender configuration, IAM, function, rule, index or PR #366 change.
Staging email delivery remains a separate reliability track and a current
blocker; nothing on these screens claims it is configured — `/verify-email`
says the opposite, plainly, when it is not. Authorization and auth transitions
are unchanged: `nextRouteAfterAuth` is still resolved and consumed on the
terminal hop only, and `src/authDestination.ts` reads without consuming.
