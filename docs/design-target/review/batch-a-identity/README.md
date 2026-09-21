# Atlas Batch A — identity and onboarding

Eight surfaces, in four tones, at two phone classes. **Targets only.** Nothing
in this batch is implemented, and implementation stays frozen until the whole
atlas clears review.

## The frames

`CONTACT-SHEET-batch-a.png` — all eight at 390×844 in one labelled frame.

| Surface | Tone | 390×844 | 390×640 |
| --- | --- | --- | --- |
| Sign in | ordinary | `TARGET-signin-390x844.png` | `TARGET-signin-390x640.png` |
| Sign up | ordinary | `TARGET-signup-390x844.png` | `TARGET-signup-390x640.png` |
| Verify email | action required | `TARGET-verify-390x844.png` | `TARGET-verify-390x640.png` |
| Reset password | ordinary | `TARGET-reset-390x844.png` | `TARGET-reset-390x640.png` |
| Profile setup | action required | `TARGET-profile-390x844.png` | `TARGET-profile-390x640.png` |
| Credential error | error | `TARGET-error-390x844.png` | `TARGET-error-390x640.png` |
| Return to join | returning | `TARGET-return-join-390x844.png` | `TARGET-return-join-390x640.png` |
| Return to event | returning | `TARGET-return-event-390x844.png` | `TARGET-return-event-390x640.png` |

**ACTUAL CURRENT BEFORE** — 16 PNGs under `before/`, one per surface per class.
Real screenshots of the product as it renders today. Nothing there is drawn.

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
