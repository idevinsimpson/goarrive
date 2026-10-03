# Kiosk confinement — matched BEFORE / AFTER for the shared-device correction

A shared device running the kiosk offered the ordinary member tab bar. One tap
of **You** left the previous visitor's session on their own member page —
signed in, named, with their email under *SIGNED IN AS* — and with no `Finish`
and no idle countdown anywhere, because both belong to the contribution screen
that had just unmounted.

The defect is W5's, measured in
[`5786446834`](https://github.com/idevinsimpson/goarrive/pull/395#issuecomment-5786446834).
The correction is this packet, assigned on
[`5786516093`](https://github.com/idevinsimpson/goarrive/pull/423#issuecomment-5786516093).

| | |
|---|---|
| Baseline | `d0477cc047f4e71133fed0741935ebb99d46024d` (`claude/wsf-app-shell` head) |
| Producer | `apps/westayfit/tests-e2e/sprint-w1b-kiosk-confinement.spec.ts` |
| Write gate | `WSF_CAPTURE_FRAMES=1`, through `helpers/capture` |
| Baseline run | **1 passed, 9 failed** — every confinement test fails, and the one that passes is *ordinary personal contribution keeps its tabs* |
| Corrected run | **10 passed** |
| Revision | `b24da91` → `50806fa` after the source review [`5786956143`](https://github.com/idevinsimpson/goarrive/pull/427#issuecomment-5786956143): one shared kiosk predicate, and the two instruction lines raised to the control floor |
| Revision | `50806fa` → `HEAD` after [`5787211535`](https://github.com/idevinsimpson/goarrive/pull/427#issuecomment-5787211535): the unresolved notice stops promising portability it cannot keep |
| Classes | 800×1280 (the class a venue screen is drawn at) and 390×640 (the repository's short phone) |
| Fixtures | `helpers/mobile`, isolated `demo-wsf-local` over loopback |

## The mechanism

`app/_layout.tsx` renders `<MemberTabBar signedIn={…} />` over every screen, and
`shellAppliesTo` decided where the bar belonged from the **pathname alone**. The
kiosk deliberately rides the ordinary contribution route —
`/contribute/<goalId>?kiosk=1`, so that nothing about counting is duplicated —
and `/contribute` is a member prefix. The one thing that makes it a kiosk was a
query parameter the shell never read.

That file's own header already said a kiosk screen must not wear the shell,
because there it *"would offer a room's worth of strangers a way into somebody's
account"*. The rule was right and the test for it was too narrow.

## The frames

Same producer, same viewports, same fixtures, on one branch: the only difference
between a `before/` frame and its `after/` twin is the patch.

| Frame | `before/` | `after/` | What changes |
|---|---|---|---|
| `kiosk-entry-tablet-800x1280.png` | `54aa63fe33030280` | `8b628a1290c7b5e7` | Home · Community · MOVE · Progress · You along the bottom → gone |
| `kiosk-entry-short-phone-390x640.png` | `f8ecc246b637fda7` | `bf2bfc15798197df` | the clearest pair: the bar and the raised MOVE circle cut off *How we count squats*; without them the screen simply ends |
| `kiosk-receipt-tablet-800x1280.png` | `e53c7191e43e2164` | `a1a61673890c5caa` | the bar goes; the chrome `Finish`, `Stay` and both instruction lines become legible |
| `kiosk-receipt-short-phone-390x640.png` | `8d9aebb914a333dd` | `1bfbab29a5adc543` | the same, at the short class |
| `kiosk-unresolved-tablet-800x1280.png` | `2aa9ad903d76af19` | `3b47983a0089acf6` | the bar goes; the notice is rewritten (below) and the rest of the screen is unchanged |
| `kiosk-unresolved-short-phone-390x640.png` | *(no baseline — added with the rewritten notice)* | `72f70c888a017a8c` | the longest string on any kiosk screen, at the class where wrapping fails first |
| `kiosk-signout-failed-tablet-800x1280.png` | `efdc17aa0b240be4` | `ed6629eb6ed84909` | the bar goes; the warning and both instruction lines become readable |
| `ordinary-contribution-keeps-its-tabs-tablet-800x1280.png` | `eb010b345f646278` | `d367506ab4ef251b` | **nothing that matters** — the same route without `?kiosk=1` keeps all four tabs and MOVE |

### `ordinary-contribution-keeps-its-tabs-*` is history, not current truth

That pair — one `before/` frame and its `after/` twin — has **no producer any
more**. It was shot to show that the correction changed nothing on an ordinary
contribution: the same route without `?kiosk=1` still kept all four tabs and
MOVE. The member shell migration changed the claim underneath it. Contributing
now lives outside the tab tree, so an ordinary contribution does not keep its
tabs at all; what it keeps is its way back to the tab it came from. The block
that shot this frame asserts that instead, and writes it under the name
`ordinary-contribution-returns-to-its-tab-tablet-800x1280.png`.

So these two files stay as the record of what was reviewed at the time, the way
the Join package's `AFTER-failed-*` frames do. Nothing regenerates them, and a
re-run of the suite will not touch them: reading either as a statement about the
current build would be reading a photograph of a shell that no longer exists.

**Three of the baseline frames are byte-identical to frames already delivered on
Board 11** — `kiosk-receipt-tablet` to that package's `kiosk-receipt-stay`,
`kiosk-unresolved-tablet` to its `kiosk-unresolved`, and
`kiosk-signout-failed-tablet` to its `kiosk-signout-failed`. Nothing was copied:
they are separate captures that happen to land on the same bytes, because those
screens carry no clock and the product source is identical. It is pixel-level
corroboration of W5's finding that `git diff d0477cc..3e311be` over the app
source is empty, and it means the delivered Board 11 set **is** the
known-defective set this correction is measured against. Board 11's own frames
were not touched, re-captured or re-encoded.

## What the producer asserts, beyond the bar being gone

A fix judged by the disappearance of one click target would pass if `Finish`
disappeared too. So the contract is asserted, on **entry, the dark receipt, the
unknown outcome and the failed sign-out**:

- **no ordinary member navigation, by any name** — `wsf-member-tabs`, each of
  the four destinations, the raised `wsf-member-tab-move`, and the contribution
  screen's own `wsf-contribute-home` / `wsf-contribute-back`; then every
  `a[href]` the page actually rendered is read and checked against the member
  destinations, so a new escape has to be added deliberately to survive;
- **`Finish` is reachable and legible** on every one of those screens;
- the unknown outcome keeps its exact notice, its same-attempt replay, its
  absent shared total — and, after `Finish`, its **account-scoped record**,
  which is still there and still keyed to the uid that made it;
- the failed sign-out still **refuses to show a resting screen** and still
  offers `Finish` again;
- the 90-second countdown and `Stay` still run on a terminal screen, and a
  kiosk session still ends: the receipt test finishes and asserts the device
  rests at the new total with the visitor's name nowhere on it;
- **ordinary personal contribution keeps its tabs** — same route, same account,
  no kiosk flag, all four destinations visible and the You tab owning the point
  a thumb lands on (`elementFromPoint`, the way W5 measured it).

### Legibility, measured rather than eyeballed

The producer reads each control's own computed colour and the colour actually
painted behind it, and computes the WCAG contrast ratio. Controls a visitor has
to act on, and the instructions telling a visitor how their account is cleared,
are all held at **4.5:1**.

| Control | Before | After |
|---|---|---|
| `wsf-kiosk-finish-chrome` on the navy receipt | `#0B1F3A` on `#0B1F3A` — **1.0:1** | cream on navy |
| `wsf-kiosk-stay` on the navy receipt | `#0B1F3A` on `#0B1F3A` — **1.0:1** | cream on navy |
| `wsf-kiosk-finish-error` on the navy receipt | `#8A1C1C` on `#0B1F3A` — **1.47:1** | `#FFB4AE` on navy |
| `wsf-kiosk-finish-explainer` — *what Finish does to your account* | `#5A6B85` on `#0B1F3A` — **3.05:1** | the kiosk display's own `rgba(247,245,240,0.78)` |
| `wsf-kiosk-countdown` — *how long you have* | `#5A6B85` on `#0B1F3A` — **3.05:1** | the same |

The last two were first reported as a shortfall left in place. On the
Director's review they are corrected instead: these are the instructions that
tell a visitor at a shared device when and how their account is cleared, so
they are held at the same **4.5:1** floor as the controls, not a lower one.
They take the muted-on-navy the kiosk's own resting screen already uses rather
than a new colour. The light screens are unchanged and are asserted to stay
legible there.

**Two instrument corrections, recorded rather than quietly fixed.** The first
version of the colour probe read the computed colour of a layout wrapper rather
than the node carrying the label, and reported `rgb(0,0,0)` — it called a
*corrected* control broken. It now walks to the leaf node that holds the text.

The second matters more, because it errs the dangerous way. The muted-on-navy
the instruction lines now use is `rgba(247,245,240,0.78)` — **translucent**. A
probe that reads three channels and drops the alpha scores it as near-white on
navy, about 15:1, when what a visitor sees is about **9.6:1**. That is a tool
certifying text as legible without having measured it. The foreground is now
composited over the background it actually sits on before anything is computed,
so every ratio in the table above is the ratio that lands on the glass.

## One kiosk interpretation, not two

The first revision normalised the repeated-parameter case in the shell alone.
`shellAppliesTo` read `?kiosk=1&kiosk=x` as a kiosk and hid the bar; the
contribution screen still called `isKioskFlag` directly, which accepted only a
scalar, and so rendered the **ordinary** screen — no `Finish`, and its own
member exits back on offer. Hiding the bar and withholding the way out is worse
than either consistent answer. Read in source by the Director
([`5786956143`](https://github.com/idevinsimpson/goarrive/pull/427#issuecomment-5786956143)),
who was explicit that they had not reproduced it in a browser.

**It reproduces.** Driven through this harness against `b24da91` at
`/contribute/<goalId>?kiosk=1&kiosk=x`: the tab bar is gone and
`wsf-contribute-back` is present, count 1 — a member exit on a shared device
with nothing to end the session. That is now a measured finding, not only a
source reading.

The normalisation moved into `isKioskFlag` in `src/kioskSession.ts`, the one
predicate both the shell and the screen already read, and the shell's private
copy of the rule is gone. Scalar behaviour is unchanged. The unit tests cover
missing, null, empty, `'0'`, `'1'`, `'true'`, a number, and the array shapes,
and state the accepting set exactly; the e2e drives a **real repeated-query
navigation** and asserts both halves agree — no member navigation *and* a
working `Finish` — then drives `?kiosk=0&kiosk=no` and asserts that an
unrecognised duplicate is an ordinary contribution that keeps its tabs. Failing
closed must not mean treating every duplicate as a kiosk.

## The unresolved notice stops promising portability

The notice used to read *"Your attempt is saved to your account; check it from
your own device."* It reads as though the attempt travels with the account. It
does not: the record that makes the SAME attempt replayable is in
`localStorage` on the browser that made it (`src/pendingContribution.ts`), keyed
to that uid, and another device signing into the same account finds no such
record — W3's storage-level probe (`5787080285`) confirmed it. A member's own
credit total is durable and readable elsewhere, but a total is not this
attempt's outcome: somebody who does not already know what it was before cannot
infer whether this one landed.

It now reads:

> You can try to confirm this contribution here before you finish. Entering it
> again elsewhere could count it twice.

It points at the only place the recovery actually exists — this screen, before
Finish — and names the real cost of the alternative. **Copy only.** No forced
retry, no extra send, no portability promise, and no backend, storage, auth or
retention change: `Confirm this contribution` is still offered, `Finish` is
still available, and the account-scoped pending record is still kept rather
than cleared on the way out. The unit test that asserts the record survives is
untouched; what changed is the literal expectation and one test description,
plus a new assertion that the notice names no other device.

**Wrapping, measured at the class where it fails first.** The sentence is the
longest string on any kiosk screen, so it is captured at 390×640 as well: it
takes three whole lines inside the screen's width, there is no sideways scroll,
and `Finish` sits directly under it, visible and enabled.

**One reference deliberately left alone.** `src/ui/designTarget/RoomScreenTargets.tsx`
draws the old sentence into the batch-e *target* artwork. That is a frozen
design reference, not the product, and this packet does not repaint targets.

## Reported, not fixed

- **The countdown does not cover the closed-goal, not-found or load-error
  screens.** Those are not terminal states by `kioskTerminal`'s locked
  definition, so a device can sit on one without auto-finishing. The escape
  links are removed and `Finish` stays in the chrome, but extending the
  90-second rule to new screens is a behaviour change beyond this correction and
  is not made here.
- ~~The two instruction lines at 3.05:1.~~ **Corrected** on review — see the
  legibility table above. The 3:1 floor they were held at is gone; they are
  asserted at 4.5:1 with every other control on the surface.

## The boundary, stated rather than oversold

This is confinement of the **app's own navigation**. It is not a device or
browser lockdown, and the last test proves the edge rather than assuming it
away: it drives the browser straight to `/you` by URL and asserts the account is
still reachable that way. What the correction removes is every route the product
offers out of a kiosk session; typing an address is not one of them, and no
web page can make it one.

## What each revision re-captured

The `before/` set is byte-identical to its first capture, checked before and
after every run.

**`b24da91` → `50806fa`** — five `after/` frames: the three **navy** ones
(`kiosk-receipt` ×2, `kiosk-signout-failed`) because the two instruction lines
changed colour, which is the correction; and two **light** ones
(`kiosk-entry-tablet`, `ordinary-contribution-keeps-its-tabs`) by **16 rows**
each at y 338–353, which is the anchor's `Confirmed HH:MM` line.

**`50806fa` → `HEAD`** — the unresolved frame, because its notice is rewritten;
one new frame, the same state at the short class; and the same two light frames,
again by **17 rows** each at y 338–354 and y 418–434, the same clock line. The
navy receipt and sign-out frames came back **byte-identical** this time, which
is what confirms the earlier three changed for the colour and nothing else.

Those screens carry a clock, so their bytes differ run to run and nothing else
in them moved. Measured row by row rather than asserted.

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
  npm --prefix apps/westayfit run test:e2e -- sprint-w1b-kiosk-confinement.spec.ts
```

`WSF_CONFINEMENT_BEFORE=1` only moves the output into `before/`. It was used
once, against the unpatched product, to produce the baseline; the contract
assertions then fail, by design, and that failure is the defect.

## Regression run alongside this change

`ui-app-shell` 3 · `ui-kiosk` 3 · `ui-contribute-short-phone` 7 — **13 passed**,
all unmodified. Unit suite: 46 files, **798 tests**, passed — the three added are the focused
kiosk-flag cases and the notice's no-portability assertion in
`tests/kiosk-session.test.ts`, the only existing test file this packet touches
and the one the reviews named.
`ts:check` passes.

## Scope

Loopback and `demo-wsf-local` throughout. Product changes are confined to
`src/ui/MemberTabBar.tsx`, `app/contribute/[goalId].tsx` and — on the
Director's explicit authorisation in `5786956143`, announced before the edit —
the `isKioskFlag` predicate in `src/kioskSession.ts` with its focused tests.
`app/_layout.tsx` was **not edited**. No session, storage or auth model
changed. No dependency, backend, rules,
index, IAM, auth-model, storage-schema or policy change; no existing test
touched; no accepted or frozen image written. Every account, community, goal and
number is synthetic and local to the emulator.
