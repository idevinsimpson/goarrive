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
| AFTER verdict | `5788849410` (Director `5788831679` §2) — **functional PASS**, visual HOLD for the F6 brand-token correction, applied below |
| Route blob | `e5be66f0e9afb03ae92c1ba3573fc641bd749ef3` (before, through `f880732`) → `cbda3fdea53a40aa1a404da45938cb4766b26718` (at `8067364`) → `e33b0614695143622685e25a8f09336e1b06d6d5` (at `df78521`, carrying the F6 ruling). Each verified with `git rev-parse <sha>:apps/westayfit/app/goals/new.tsx`. |
| Behaviour verified by | W7, seven cases at `8067364` — PASS on all four conditions (`5788653228`) |
| Producer | `apps/westayfit/tests-e2e/sprint-w6-goal-setup-after-capture.spec.ts` |
| Write gate | `WSF_CAPTURE_FRAMES=1` (`helpers/capture`) |
| Ordinary run | 8 passed, **0 images written** |
| Gated run | 9 passed, **15 frames** |
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
| `AFTER-no-community-390x844.png` | the arrival guard, and its one way on in the action green |

**The unknown state needs two frames and the target needed one.** The drawing composed the
banner, the resolving action, the review and the demoted retry into one screen; the shipped
route has three form sections above all of that, so one viewport holds the top of the state or
its foot, but not both. Shooting only the top would have left the half of the contract that
matters most — the retry saying what it starts, with the consequence beside it —
unphotographed, and a reviewer would be taking my word for it.

## The F6 correction

The first AFTER set used `PROGRESS_GREEN` `#91CB7D` on the primary calls to action, because F6
had not been ruled on and the release said to keep the route's current fill. **It has now been
ruled on** (`5788849410`): Board 00 reserves that green for confirmed progress — the colour the
Living WE speaks in — and primary actions take `ACTION_GREEN` `#22C55E`. All three primaries on
this route now carry it on `ON_ACTION` ink, which is what the accepted target drew: **Start this
goal**, **Check community goals**, **Open the contribute page**. Every word, behaviour, hit
target and disabled treatment is unchanged, the navy selections are untouched, and **Start
another goal** stays a secondary because demoting it is the point.

It is a route-local style, not an edit to `kit.primaryButton`: the kit belongs to another
surface, and one screen's ruling is not licence to restyle every button in the product. The fill
is now **asserted** by the producer (`rgb(34, 197, 94)`, and explicitly not the progress green),
so a later edit that reaches for `kit.primaryButton` here fails before a frame is written.

### The follow-up: the fourth primary

The first pass changed the three CTAs the ruling enumerated and deliberately left
`wsf-new-goal-home` — *Go to your communities* — on the progress green, because the release said
"no other visual change" and that state had no TARGET and no AFTER frame. The Director closed
that on the pixel pass (`5789408712`): it is plainly the primary action of its state and takes
ACTION_GREEN too. One line on the route, one real 390×844 capture of the state, and the same
rendered-colour assertion the other three carry.

**One height only, and not for want of effort:** this state has no scroll and nothing below a
fold, so a second height would photograph the same composition against more cream. The frame is
of the real route, not a drawing.

### Which frames moved, and which could not have

Eight frames carry a primary call to action and changed; six do not and were left at their
`8067364` bytes rather than re-shot, because the container's clock moves between runs and a new
timestamp is not evidence of a token change.

| Frame | before | after |
|---|---|---|
| `AFTER-summary-commit-390x844.png` | `b356ffec7375afbf` | `941f8f6e84eca0d2` |
| `AFTER-summary-commit-390x640.png` | `b85be2db1f46e655` | `e26910a93c8411f3` |
| `AFTER-unconfirmed-INJECTED-NETWORK-390x844.png` | `5cb2432bcd09467c` | `0a9eba57c412ac59` |
| `AFTER-unconfirmed-INJECTED-NETWORK-390x640.png` | `bab9e848b003a55e` | `a947ec2269f7d7c1` |
| `AFTER-unconfirmed-retry-INJECTED-NETWORK-390x844.png` | `a3f5049f80bf37bb` | `910e3e1e17ecd77e` |
| `AFTER-unconfirmed-retry-INJECTED-NETWORK-390x640.png` | `3cf7f349f6ed475b` | `dae8d89ecd115d15` |
| `AFTER-created-390x844.png` | `ad03445b0ce18c97` | `440a3c9fd7f8e792` |
| `AFTER-created-390x640.png` | `7737711b0723956f` | `0eb9847d20c335fa` |
| `AFTER-form-top-390x844.png` · `-390x640.png` | — | **unchanged** |
| `AFTER-custom-window-390x844.png` · `-390x640.png` | — | **unchanged** |
| `AFTER-refused-390x844.png` · `-390x640.png` | — | **unchanged** |
| `AFTER-no-community-390x844.png` (added in the follow-up) | — | `aae48625a6277fb2` |

The six unchanged frames carry no primary call to action — the refusal's only control is the
cream-outlined **Back to community** on navy — so the token cannot have touched them. Three of
them came back byte-identical from a full re-capture anyway; the other three differed only in
the clock, and were restored rather than committed, so the diff against `8067364` contains
nothing but the ruling.

## Where the AFTER still differs from the accepted TARGET, deliberately

1. **The tab bar is the real one, not the target's reserved strip.** The drawing showed reserved
   space labelled as reserved, because `MemberTabBar.tsx` belongs to another surface and the
   drawing had not looked at it. The route now reserves that room for real, from its **own**
   scroll container — nothing in the shell was touched — and the created state's last control
   and the unknown state's consequence line both clear the bar, which
   `../../goal-setup-current/created-receipt-390x844.png` does not.
2. **Times drift between runs.** The capture container's clock moves; the target drew
   `10:15 PM`, the AFTERs read whatever the hour was. Same zone, same behaviour. The custom
   window is fixed on purpose, which is why those two frames are reproducibly byte-identical.

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
