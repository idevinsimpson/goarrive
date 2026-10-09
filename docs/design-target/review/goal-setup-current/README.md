# Goal setup — CURRENT-BUILD CAPTURES for Board 08

**Source SHA: `075737919e62cb74ca21d86ca44ad3b3dcd766ce`** (`claude/wsf-app-shell`, the merge of
PR #408). Re-fetched at capture time: that SHA **is** the branch head, so there is no newer delta
to record.

**Capture SHA** (the commit these frames are committed in): see this file's own commit —
`sprint-w4-goal-setup-captures` @ the commit that adds `goal-setup-current/`.

Route: `apps/westayfit/app/goals/new.tsx`. Framing follows the actual code and lock `5771436211`,
not the older target's conflicting labels.

Board 08's existing arrival captures are truthful but stop at the top of the form. This package
is exactly the part they cannot show: the lower duration and custom-window controls, both repeat
choices, the same-page summary, and the created state.

| | |
|---|---|
| Producer | `apps/westayfit/tests-e2e/sprint-w4-goal-setup-capture.spec.ts` |
| Write gate | `WSF_CAPTURE_FRAMES=1` (`helpers/capture`) |
| Ordinary run | 8 passed, **0 images written** — verified before capturing |
| Gated run | 8 passed, **16 frames, all distinct** |
| Fixtures | shared `helpers/mobile`, the same shape the existing goal-form coverage seeds |
| Entry | the real way — the community's own **Start a goal** control, not a direct URL |

## What is real and what is injected

**The created receipt is produced by the real `wsfCreateGoal` callable** against the local
emulator. No success response is fabricated anywhere. The frame's container carries the
server-assigned `data-goal-id`, and the spec asserts it is present — that attribute cannot exist
without a real server answer.

| Marker | Meaning |
|---|---|
| `INJECTED-DELAY` | the **real** callable held open so the in-flight frame is real, then **released so the call actually completes** — the receipt above is the result of that same call |
| `INJECTED-NETWORK` | the callable aborted, to reach the refusal state |

No other behaviour is simulated and no product capability is widened.

## Frames

Stable fixture identity in every frame: community *Harbor Walkers*, goal *Autumn squat
challenge*, target *30,000 squats*, custom window *2026-10-01 09:00 → 2026-11-15 18:00*.

| Frame | sha256 (first 16) |
|---|---|
| `form-populated-top-390x844.png` | `b6552e98f8334205` |
| `form-duration-options-390x844.png` | `e56a6de66a66c3b5` |
| `form-duration-derived-window-390x844.png` | `aa802ba90b25d6bf` |
| `form-custom-window-390x844.png` | `a102247aeb893de2` |
| `form-repeat-once-390x844.png` | `0ba083ff7c1a63e5` |
| `form-repeat-multiple-390x844.png` | `32b5aa2ba5dcb533` |
| `form-summary-check-it-over-390x844.png` | `2973f029af3d4fff` |
| `form-validation-first-refused-390x844.png` | `4930119fb4b5bf50` |
| `form-submitting-INJECTED-DELAY-390x844.png` | `597a4283096aeb0a` |
| `created-receipt-390x844.png` | `cb91d4b27f6ec6b3` |
| `form-server-refusal-INJECTED-NETWORK-390x844.png` | `5855ca2f7f30880d` |
| `no-community-390x844.png` | `834465c037f28b2f` |
| `signed-out-390x844.png` | `491fee793cc3fa52` |
| `form-populated-top-390x640.png` | `89589fb6014700ed` |
| `form-summary-check-it-over-390x640.png` | `f5d78e35e871de8f` |
| `created-actions-390x640.png` | `5fd70104e9876198` |

## Asserted before each shot

- **Populated form** — the live definition reads `30,000 squats`, so the three fields were
  actually taken rather than merely typed into.
- **Duration** — all four rows present: `1w`, `2w`, `1m`, `custom`.
- **Derived window** — with a preset duration, the "Starts …" and "Ends …" lines in words.
- **Custom window** — the exact start/end controls, filled; see observation 1 below.
- **Repeat** — **exactly two** choices, identified by testID and asserted as the pair
  `once` + `multiple`; each row's description asserted when selected.
- **Summary** — `Check it over`, *This is what your community will see.*, the goal's own title,
  **and `wsf-new-goal-form` still visible**: the summary is on the same page, not a wizard step.
- **Validation** — nothing before a submit (asserted as zero error nodes), then the first refused
  field's message *and* `toBeInViewport()` on the field itself.
- **In flight** — the submit control reads `Starting…`.
- **Created** — the receipt plus a server-assigned `data-goal-id`.
- **Refusal** — the error shows, the form is still present, and **the typed title is still
  there**: the work is not lost.
- **No Living WE on any state** (locator count 0). A goal that does not exist yet has no
  confirmed shared total, so there is no ratio to draw.
- **390×640 reachability** by **hit test** — a tap at the control's own centre must resolve to it.
  `toBeVisible` answers a different question; W5-M1 was a control that passed it while the shell
  took its taps.

## RNW inner scroll

The form scrolls **inside an element**, not the document, so `fullPage` alone shows the top and
misses every lower control. Each section is scrolled into view before its shot and the frame is
named for the section it shows.

## Observations — reported, product untouched

1. **The derived start line and the Custom controls are alternatives, not companions.**
   `new.tsx:853` renders `wsf-new-goal-starts-line` only while duration is **not** custom; in
   Custom the explicit control states the start instead. The *ends* line renders in both. My
   first draft asserted both lines in Custom and failed — the build is right and the assumption
   was wrong. Board 08 should not draw a Custom window that also carries a derived "Starts …"
   line.
2. **`OptionRow` emits child testIDs** (`-indicator`, `-indicator-dot`, `-label`,
   `-description`), so a prefix match over `wsf-new-goal-repeat-*` counts markup rather than
   choices. There are exactly **two** repeat choices; anything suggesting a third is a selector
   artefact.
3. **The signed-out state is supported but has no `testID`.** The route renders a real panel —
   *"Sign in to start a goal"* / *"Only a signed-in Champion can start a goal for their
   community."* — unlike every other state here, which carries one. Asserted by copy; not fixed,
   since the product is not mine to change in this packet.
4. **The member tab bar's raised MOVE circle overlaps the lower edge of the summary card** at
   390×844. Nothing interactive sits there — the summary rows are read-only and the submit
   control is below — and the 390×640 hit tests on submit and on the created action both pass, so
   this is a framing note for Board 08 rather than a W5-M1-class defect.
5. **The created receipt shown here used the default 1-week duration**, not the custom window;
   the custom window has its own frame. One frame, one claim.

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
  npm --prefix apps/westayfit run test:e2e -- sprint-w4-goal-setup-capture.spec.ts
```

Loopback and `demo-wsf-local` guards retained throughout. No application, functions, config,
`.github` or shared-renderer change; no accepted or frozen image written; no external account and
no staging deployment.
