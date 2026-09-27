# Single-goal kiosk — CURRENT-BUILD CAPTURES for Board 11

The kiosk route is built and the atlas had no photograph of it.
`batch-e-room-screens` holds thirteen kiosk **drawings** at 800×1280 with no
`before/` or `after/`, and its own README says *"TARGET / CONCEPT — NOT
IMPLEMENTED. Nothing here has been built."* A Board 11 reconstructed from those
would have been a board about a redesign, so these frames were produced from the
running product under the allowance in the Director's release
([`5786014162`](https://github.com/idevinsimpson/goarrive/pull/412#issuecomment-5786014162)).

| | |
|---|---|
| Routes | `app/kiosk/[goalId].tsx` (the resting screen) and `app/contribute/[goalId].tsx?kiosk=1` (the ordinary contribution route in kiosk mode) |
| Producer | `apps/westayfit/tests-e2e/sprint-w1b-kiosk-capture.spec.ts` |
| Write gate | `WSF_CAPTURE_FRAMES=1`, through `helpers/capture` |
| Gated run | **5 passed, 15 frames** (12 in the first pass, 3 in the failure-state supplement) |
| Ordinary run | assertions run, **0 images written** |
| Fixtures | `helpers/mobile`, isolated `demo-wsf-local` over loopback |
| Classes | 800×1280 (the class batch-e drew) and 1024×1366 (above the route's own 900 px wide-layout threshold) |

## The frames

| Frame | sha256 (first 16) | What it is |
|---|---|---|
| `kiosk-resting-800x1280.png` | `d29134745a68c34a` | the locked resting screen: one calibrated Living WE at `241 of 500 squats` · `48.2% complete` · `259 to go` · `Confirmed 11:30 PM`, one primary `Contribute here`, and the privacy explanation |
| `kiosk-resting-wide-1024x1366.png` | `1d8ccdd725c092f7` | the identical state above the 900 px threshold — the route's **wide** treatment |
| `kiosk-stale-800x1280.png` | `b15bfce762c31dd1` | one real confirmation, then the poll fails: the same total and fill, `Last confirmed 11:30 PM` |
| `kiosk-loading-800x1280.png` | `8e7a6e293d8dd4f3` | `Loading display…` with **no** mark and **no** number |
| `kiosk-refused-800x1280.png` | `08f350634ce7fa7e` | a goal not authorized for display: `Nothing to show here` / `This display isn't currently available.` + `Check again` |
| `kiosk-unreachable-800x1280.png` | `a9dd73fa3d880b9c` | a failure **before** any confirmation: `Connection interrupted`, no invented total |
| `kiosk-handoff-signed-out-800x1280.png` | `0313125ff33dd251` | `Contribute here` lands on the ordinary signed-out contribution gate |
| `kiosk-entry-800x1280.png` | `27b9feb3ab3f70f1` | kiosk mode: Back replaced by `Finish`, the community hero at `241 of 500`, the ordinary entry |
| `kiosk-review-800x1280.png` | `dd0b4d299b6ff4e9` | review previews **own credit only** (`0 → 20 squats`); the hero still reads `241 of 500` |
| `kiosk-receipt-finish-800x1280.png` | `9faf2d666f10e1b0` | the confirmed receipt owning the new total: `261 of 500 squats` · `52.2% complete`, `Finish`, its sentence, and `Finishing in 89 seconds` |
| `kiosk-receipt-stay-800x1280.png` | `e53c7191e43e2164` | the same receipt after `Stay` — a restarted countdown, not a paused one |
| `kiosk-rested-after-finish-800x1280.png` | `e646a312a9121e40` | the device back at rest, signed out, carrying the total that contribution produced |

## The failure-state supplement

Released on [`5786222162`](https://github.com/idevinsimpson/goarrive/pull/423#issuecomment-5786222162):
the two locked states the first pass reported as missing. Each is reached by a
fault injected **outside the product** — no app, backend, config or
existing-producer change — and each frame carries the fault in its provenance
tag. Produced by two further tests in the same gated producer.

| Frame | sha256 (first 16) | What it is | Fault injected |
|---|---|---|---|
| `kiosk-unresolved-800x1280.png` | `2aa9ad903d76af19` | the unknown outcome in kiosk mode: `We couldn't confirm your contribution yet.` · `We don't know whether this effort was recorded. Don't record it again.` · `You entered 20 squats.` · `Confirm this contribution` · the kiosk notice · `Finish` · `Finishing in 90 seconds` · `Stay` | `route.abort('failed')` on `wsfContribute` — the request leaves and no answer comes back |
| `kiosk-rested-after-unresolved-800x1280.png` | `aa2012468ef573a9` | Finish from unresolved: the device at rest, signed out, at `241 of 500 squats` · `48.2% complete` · `259 to go` · `Confirmed 11:43 PM` | same |
| `kiosk-signout-failed-800x1280.png` | `efdc17aa0b240be4` | the receipt still on screen at `261 of 500` · `52.2%` · `239 to go`, with `We couldn't sign you out. Don't leave this device signed in — try Finish again.` in red beneath `Finishing in 90 seconds` | a readwrite transaction on Firebase Auth's own `firebaseLocalStorage` IndexedDB store made to throw, for the instant Finish runs — the web SDK signs out by **removing** the persisted user, so a refused removal is the real mechanism by which `signOut()` rejects |

### Asserted for the unknown outcome

- the state is stated as **uncertainty, not a result**: headline, the
  `Don't record it again` line and the entered amount, each verbatim;
- **no new shared total, no percent and no mark** — `wsf-contribute-shared-total`
  and `wsf-contribute-we` are asserted absent, `261 of 500` and `241 of 500`
  never appear, and no `%` appears anywhere on the screen;
- the replay offered is the **same attempt** (`Confirm this contribution`, "it
  will not count twice"), not a second contribution;
- the guidance is the **shared-device** one — `KIOSK_UNRESOLVED_NOTICE` is
  present and the ordinary route's "the same attempt will be here when you come
  back" is **withheld**, because the visitor is about to be signed out;
- the stored record exists, in state `unknown`, for the amount entered, under
  **this account's uid**;
- after Finish: the auth store is **empty** (signed out), the resting hero is
  back at the confirmed `241 of 500` with `data-fill-ratio="0.4820"` — the
  request never reached the server, so nothing is invented in either direction —
  and the **record survives**, still keyed to the uid that made it.

### Asserted for the sign-out failure

- the error reads verbatim and the device **does not return to its start
  screen**: the URL is still the kiosk-mode contribution route and the resting
  screen, which is mounted beneath it in the router stack, stays hidden;
- the receipt is still on screen and `Finish` is **offered again**, enabled,
  rather than left spinning;
- the account is **still attached**: its persisted record is still in the auth
  store, and a reload — which drops the injected fault with the JS context —
  comes back **signed in as the same visitor**, with no sign-in gate between the
  next person and that account.

### One defect these frames expose — reported, not fixed

`Stay` is drawn in `#0B1F3A` on the dark receipt screen's `#0B1F3A`
background: a contrast ratio of **1:1**. The control is present, focusable and
operable — the producer clicks it and the countdown rises again — and on the
light unresolved screen it reads normally. On the dark frames there is nothing
legible where it sits, checked pixel by pixel across the right of that row
rather than inferred. On a shared device this is the one control that keeps a
receipt on screen for somebody still reading it. **The product is not this
packet's to change**, so it is recorded and nowhere fixed.

## Asserted before each shot

- the resting hero's community, title, total, percent, freshness line and the
  mark's exact `data-fill-ratio`;
- **no individual identity** on the start screen — asserted over the screen's
  whole text, not a testID, and again after `Finish`;
- **none of** QR, queue, turn, pair or station appears in the resting screen's
  text: what this route does not do, checked rather than assumed;
- loading and the two failure states draw **no mark and no total**;
- the refusal **names no reason** and never prints the goal id, so the screen
  cannot be asked which goals exist;
- stale keeps the total it actually confirmed and flips to `Last confirmed`;
- kiosk mode has **no Back** and shows the `Finish` chrome;
- the review never shows `261 of 500` — it does not predict the shared total;
- the receipt's own total, the `Finish` sentence verbatim, and a countdown that
  **falls** and then **rises again** after `Stay`;
- after `Finish`, the resting screen carries neither the account name nor the
  amount the last visitor entered.

## A correction to this package's earlier note

An earlier version of this file said the unknown outcome and the sign-out
failure were "covered by `ui-kiosk.spec.ts`". On re-reading, they are not: that
spec reaches neither state end to end — it asserts only that a **confirmed**
receipt carries no unresolved notice. The rules are covered at unit level in
`apps/westayfit/tests/kiosk-session.test.ts` ("KEEPS an unresolved attempt",
"never claims the unresolved attempt was recorded", "reports a FAILED sign-out
instead of pretending the device is clean"). The three frames above are the
first end-to-end evidence of either state.

## One current-build observation, reported not fixed

The kiosk **start** screen is chrome-free. The kiosk-mode **contribution**
screen replaces Back with `Finish` and still renders the member shell's tab bar
along its bottom edge — visible in the entry, review and receipt frames — where
batch-e's target says a venue screen has no way off. Reported as a seam; the
product is not this packet's to change.

## Why the assertions are not gated with the writes

`helpers/capture` documents both shapes, and this file asserts privacy
properties worth keeping under guard — no identity at rest, no existence oracle
in the refusal, no invented total. Gating the whole file would make those checks
depend on somebody asking for pictures. `ui-kiosk.spec.ts` remains the route's
behavioural coverage and is untouched.

## Reproducing

```
npm --prefix functions-westayfit run build
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 \
  npm --prefix apps/westayfit run build:web
METADATA_SERVER_DETECTION=none npx firebase emulators:start \
  --config firebase.westayfit.emulators.json --project demo-wsf-local

WSF_CAPTURE_FRAMES=1 \
WSF_PLAYWRIGHT_CHROMIUM=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1) \
WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 \
  npm --prefix apps/westayfit run test:e2e -- sprint-w1b-kiosk-capture.spec.ts
```

`npm --prefix apps/westayfit run ts:check` passes with the spec in place.

## Scope

Loopback and `demo-wsf-local` throughout. **No application, functions, config,
`.github`, shared-renderer or existing-producer change; no accepted or frozen
image written; no external account, no staged write and no new permission.**
Every account, community, goal and number is synthetic and local to the
emulator.

This set is **not** on `check-evidence-intact.mjs`'s freeze list — that file
belongs to the lead, and adding these paths is their call.
