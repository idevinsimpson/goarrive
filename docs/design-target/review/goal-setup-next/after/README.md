# `/goals/new` — matched AFTER

The accepted target, implemented on the real route and photographed the way the BEFOREs were.

**These are AFTERs and nothing else is.** Every frame is `apps/westayfit/app/goals/new.tsx` as it
now ships on this branch, entered the real way — the community's own **Start a goal** control —
with the same fixture identity as the BEFOREs, so BEFORE → TARGET → AFTER read as one row:
*Harbor Walkers*, *Autumn squat challenge*, *30,000 squats*, the 2026-10-01 → 2026-11-15 custom
window, *Coordinated Universal Time*.

| | |
|---|---|
| Verdict released by | `5788308449` (Director `5788288648` §3) — TARGET PASS at `f880732` |
| Producer | `apps/westayfit/tests-e2e/sprint-w6-goal-setup-after-capture.spec.ts` |
| Write gate | `WSF_CAPTURE_FRAMES=1` (`helpers/capture`) |
| Ordinary run | 8 passed, **0 images written** |
| Gated run | 8 passed, **14 frames** |
| TARGET it answers | `../target/` — unchanged, byte for byte |

## Why this is a second producer

`sprint-w6-goal-setup-next-capture.spec.ts` photographs the drawings, and those drawings are now
**accepted**. A gated run of one file that wrote both sets would rewrite accepted evidence as a
side effect of capturing an AFTER — precisely the failure `check-evidence-intact.mjs` exists to
catch. Two producers, one job each: that one writes `target/` and is not run gated again, this
one writes `after/` and nothing else.

## What is real, and the one thing that is not

**The refusal is real.** It is not injected: an ordinary member of the community submits the
form, and `wsfCreateGoal` raises `permission-denied` itself because their membership role is not
`foundingChampion`. The refusal the target drew, produced by the server that actually produces
it.

**The created receipt is real.** It comes from the real callable against the local emulator, and
the spec asserts the server-assigned `data-goal-id` is on the container — an attribute that
cannot exist without a real answer. The contribute action's `href` is asserted to equal
`/contribute/<that id>`, which is how the frame proves the id is the server's and not one
inferred from the title.

**One fault is injected, and its filename says so.** `INJECTED-NETWORK` aborts the request so no
answer comes back. That is the entire point of the unknown state: the client cannot tell it from
a transaction that committed and lost its response, which is what W7 measured (#434, evidence
`e6a208a`).

## Frames

| Frame | What it shows |
|---|---|
| `AFTER-form-top-390x844.png` · `-390x640.png` | the spine, and the goal phrase above the fold at **both** classes |
| `AFTER-custom-window-390x844.png` · `-390x640.png` | Custom open; the control states the start, so no derived line is drawn as well |
| `AFTER-summary-commit-390x844.png` · `-390x640.png` | the review and its commit as one object, both on screen |
| `AFTER-refused-390x844.png` · `-390x640.png` | the real `permission-denied`; the refused action gone, the way out inside the panel |
| `AFTER-unconfirmed-INJECTED-NETWORK-390x844.png` · `-390x640.png` | the unknown result and the action that resolves it |
| `AFTER-unconfirmed-retry-INJECTED-NETWORK-390x844.png` · `-390x640.png` | the foot of that same state: the deliberate retry with its duplicate consequence |

**The unknown state needs two frames and the target needed one.** The drawing composed the
banner, the resolving action, the review and the demoted retry into one screen; the shipped
route has three form sections above all of that, so one viewport holds the top of the state or
its foot, but not both. Shooting only the top would have left the half of the contract that
matters most — the retry saying what it starts, with the consequence beside it —
unphotographed, and a reviewer would be taking my word for it.

## Where the AFTER differs from the accepted TARGET, deliberately

1. **The primaries are the paler `PROGRESS_GREEN`, not the target's `ACTION_GREEN`.** F6 was
   explicitly not ruled on (`5788308449`), and the instruction was to keep the route's current
   fill until it is. This is the only colour difference between the target and the product, and
   it is obedience rather than drift. A ruling either way is a one-token change.
2. **The tab bar is the real one, not the target's reserved strip.** The drawing showed reserved
   space labelled as reserved, because `MemberTabBar.tsx` belongs to another surface and the
   drawing had not looked at it. The route now reserves that room for real, from its **own**
   scroll container — nothing in the shell was touched — and the created state's last control
   and the unknown state's consequence line both clear the bar, which
   `../../goal-setup-current/created-receipt-390x844.png` does not.
3. **Times read `3:15 AM` where the target drew `10:15 PM`.** The capture container's clock
   moved between the two runs. Same zone, same behaviour, different hour.

## What did not move

`../target/` and `../../goal-setup-current/` are byte-identical to what the verdict was given
on. `node scripts/westayfit/check-evidence-intact.mjs` is clean.

## Reproducing

```
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 \
  npm --prefix apps/westayfit run build:web
METADATA_SERVER_DETECTION=none npx firebase-tools emulators:start \
  --config firebase.westayfit.emulators.json --project demo-wsf-local

WSF_CAPTURE_FRAMES=1 \
WSF_PLAYWRIGHT_CHROMIUM=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1) \
WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 \
  npm --prefix apps/westayfit run test:e2e -- sprint-w6-goal-setup-after-capture.spec.ts
```
