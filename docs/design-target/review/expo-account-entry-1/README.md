# EXPO-ACCOUNT-ENTRY-1: evidence

- **Packet:** Director #365 `5961761581` (queued), `5961789672` (released). W9 prep #497 `5961815028`; ACK `5961821621`.
- **Base:** canonical development `ab77fbfc`.
- **Product:** `ab413736`, one commit. It changes one product file, `app/event/[goalId].tsx`, plus the three reserved specs.
- **Evidence:** this commit, on its own branch, so the product PR carries only the four files.
- **Status:** delivered. Not reviewed, accepted, integrated or staged.
- **Emulator only** (`demo-wsf-local`). No backend, function, rules, index, provider, auth-policy, credential, Lovable or reference change.

## What changed on the event entry

| Surface | ACTUAL BEFORE `ab77fbfc` | ACTUAL AFTER `ab413736` |
|---|---|---|
| **Signed out** (`wsf-event-signed-out`) | "Add your part", then Create an account / Sign in / Not now. Nothing says what you can do there or what an account involves. | A compact card, **"Two ways to take part, once you're signed in"**: **Use my phone**, count it yourself, right now; **Join the kiosk queue**, take your turn at the screen in the room. Under the buttons: *"A new account needs you to confirm your email first. Open the link we send, then come back to this page and you'll pick up right here."* |
| **Not a member** (`wsf-event-not-member`) | "Join the community first", with **Back to home** as the only way out. The event return was already spent, so signing out and in as the right account lost the event. | It adds **"Signed in as <email>"** and **Use a different account**. That re-arms the existing event return for this same goal id, signs out and opens sign-in, so the right account comes **straight back to the event**. Back to home is kept. |

Notes on the signed-out card:
- **The labels** come from the shared `EVENT_CHOICE_PHONE_LABEL` and `EVENT_CHOICE_QUEUE_LABEL`, so they can't drift from the member buttons.
- **No new control:** the card is plain text, not buttons. Nothing is a way on until the visitor is signed in, a member, and has chosen an activity.
- **No new storage:** the only stored value is the existing goal-id-only event return.

### The packet's label wording
The packet asks for **"Move on my phone" / "Use a kiosk"**. Those labels are the shared constants in `src/eventActivity.ts`. That file is **not in this packet's reserved files**, and the constants are also pinned by `tests/event-activity.test.ts`, which isn't reserved either. They're used by the queue screen and the design targets too.
- **Nothing was overridden locally**, which would make the event and queue screens disagree.
- **One-line follow-up:** once the reservation is widened to those two files, changing the two constants renames both the member buttons and this card together.

## The policy seam (owner decision, not implemented)
A brand-new visitor can't add anything until their email is verified. The server refuses an unverified account in:
- `wsfSaveProfile` (`functions-westayfit/src/index.ts:120`);
- `wsfJoinCommunity`, via `JOIN_REQUIRES_EMAIL_VERIFIED = true` (`:499`). The code comment names this one line as Devin's decision.

Smallest truthful options:
- **A, keep the gate:** this packet already does everything the client can. The visitor is told about the email wait up front, the event survives the round trip, and returning members go straight in.
- **B, a separate backend packet** with security review: relax verification for event joins only. This trades the throwaway-signup protection on the shared total for booth speed.

Not proposed: guest mode, auto-verification, SMS, magic link or a provider change.

## Proof

| Case | Where | BEFORE `ab77fbfc` | AFTER `ab413736` |
|---|---|---|---|
| Signed out names both ways and the email step; no way on is a live control | `event-return` "EAE signed out" | **fails** (no `wsf-event-ways`) | **pass** |
| Wrong account: told which account, switches, and the right one returns to the usable event; the return is spent again afterwards; a returning member then opens the event straight in, with no device question and no onboarding | `event-return` "EAE wrong account" | **fails** (no account line, no switch) | **pass** |
| Interrupted auth: a reload at verify-email and at profile-setup still returns to the event | `event-return` "EAE interrupted" | pass (regression proof) | pass |
| Cancel boundary: "Not now" forgets the event, so a later sign-in lands home | `event-return` "EAE not now" | pass (regression proof) | pass |
| Fresh account through signup, verify and profile back to the event; returning member; tampered return | `event-return` existing three | pass | pass |
| Scanned journey (event and activity through a real signup and join); **a double tap on "Get in line" sends one join, makes one place, shows no error** | `ui-event-activity-choice` | pass (regression proof) | pass |
| Join URL, signed out, through to the community | `e2-join-flow` | pass | pass |

RAW logs:
- `RAW-fail-before-ab77fbfc.txt`: the final specs on the base, 9 passed and exactly the 2 new behaviours failed.
- `RAW-reserved-specs-run{1,2,3}-ab413736.txt`: **11 / 11** in each of three consecutive runs.

**Duplicate queue join.** The client's existing `joining` guard and the server's one-place-per-account document already hold. The proof found no defect, so no product change was made for it.

### A test-instrument race, found and fixed in the reserved specs
- **Symptom:** "a NEW account is returned…" failed about one run in three, **on the base too** (`RAW-verify-gate-race-base-ab77fbfc.txt`: 2 of 4 failed). The new account ended up **signed out on Home**.
- **Root cause, measured with a temporary diagnostic spec that wasn't committed:** verify-email refreshes the user itself and moves on to profile-setup on its own. The shared `helpers/mobile.ts` `clearVerifyGate` clicks "I have verified" as soon as it's visible, which races that auto-advance. The click either waits on a button that has gone, or lands on profile-setup's **Sign out** at the same spot.
- **Not a product defect.** The product advanced correctly in every run.
- **Fix:** the three reserved specs now use a local `passVerifyGate`. It waits for the auto-advance first and clicks only once, with a time limit, if it never comes. Every assertion is unchanged, and the result is **33 / 33** over three runs.
- **Follow-up, not in this packet:** `helpers/mobile.ts` isn't reserved, and **15 spec files** use the racy helper. Same fix, in the shared helper.
- `RAW-verify-gate-race-old-helper-wip-tree.txt` holds runs of the old helper on an uncommitted work-in-progress tree, kept for the record.

### Wider checks on `ab413736`

| Run | Result | RAW |
|---|---|---|
| Event-route regression: the 3 reserved specs plus `design-target-event-queue-capture`, `move-follow-along`, `queue-call-by-name`, `station-enrollment`, `ui-app-shell`, `ui-combined-goal`, `ui-device-choice` | **35 passed, 1 skipped** (a gated capture) | `RAW-event-route-regression-ab413736.txt` |
| vitest | **1042 / 1042** | `RAW-vitest-ab413736.txt` |
| tsc | **0** | `RAW-tsc-ab413736.txt` |

## Frames
`before/` is `ab77fbfc` and `after/` is `ab413736`. Each is full viewport at **390×640** and **390×844**, taken after that state's assertions by the gated producer in `event-return.spec.ts` (`WSF_EAE_CAPTURE_DIR`; `WSF_EAE_STAGE=BEFORE` for the base).
- `event-signed-out-*`: at 390×640 everything fits above the fold, including Create an account, Sign in, the email note and Not now.
- `event-not-member-*`: the "Signed in as" line is a **labelled fixture address** (`wsf-eae-wrong-…@example.com`).

No dead action, and no context loss: every case above ends on the event or on a stated home.

`MANIFEST.sha256` lists every file in this directory.
