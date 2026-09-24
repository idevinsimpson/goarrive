# `/goals/new` — barless AFTER (NOT YET ACCEPTED)

The route as it now builds on this branch, since W9's shell migration, photographed the way
`../after/` was. **Awaiting the Director's actual-pixel review; nothing here is accepted,
integrated or staged.** Released by Director `5800455297` §2 after W6's measurement
(`5800472286`).

`../after/` is the **accepted, historical** record of this route under the floating member tab
bar. Its fifteen frames are byte-identical and are not regenerated: this producer now writes here
and nowhere else.

| | |
|---|---|
| Base | `claude/wsf-app-shell` @ `f2f901acbe3103d8bdd05afb448064e67e19b5cf` |
| Route blob | `95fc01b23886fdcf1bd3828d111c98a20d5bf796` at `f2f901a` → **`cf71b4325a5f1dff58f23bbcb6c3d118be46566d`** (this packet) |
| Producer blob | `24671f7d2a462ec2b419d5bcb09f5f8713e6417d` at `f2f901a` → **`69bbf82f2bcad06d1144ccff7487b1f3ebd047c1`** (this packet; every frame below was captured by it) |
| Producer | `apps/westayfit/tests-e2e/sprint-w6-goal-setup-after-capture.spec.ts` |
| Write gate | `WSF_CAPTURE_FRAMES=1` (`helpers/capture`) |
| Ordinary run | 10 passed, **0 bytes written** (all of `docs/design-target` hashed before and after) |
| Gated run | 10 passed, **16 frames**, all here; `../after/`, `../target/`, `../before/` and `../../goal-setup-current/` byte-identical across the run (47 files, sha256 before and after) |
| Environment | emulator `demo-wsf-local`; web bundle built at the route blob above with `EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1`; Chromium; `deviceScaleFactor` 2 |

Each blob was read with `git rev-parse <sha>:<path>` (base) or `git hash-object` on the working
file (this packet) before being written here.

## What changed on the route

One style. `styles.pageFoot: { paddingBottom: 140 }` existed only to hold content clear of the
floating tab bar. The route is now a focused flow outside `(tabs)` and no bar renders over it, so
the reserve was dead space: its scroll container now takes `kit.page` as it is, a 48 px foot. Of
the two comments that described the bar as present, the one on the scroll container is rewritten
and the one above `pageFoot` is removed with the style it described. No copy, colour, navigation,
classifier or behaviour line moved.

Measured on the same fixture, end of scroll:

| | before (`f2f901a`) | after (this packet) |
|---|---|---|
| foot padding, both classes, form and receipt | 140 px | **48 px** |
| created receipt at 390×844 (`scrollHeight` / viewport) | 873 / 844, so it scrolled 29 px into nothing | **844 / 844, no scroll** |
| created receipt at 390×640 | 862 / 640 | 770 / 640 |

## What the producer now proves

On every state and class it already covered, plus a new keyboard case:

- **No bar.** No visible `wsf-member-tabs`. It is counted by visibility, not tested for presence.
  When the route is pushed from a tab (the form, unknown, created and keyboard cases), the mounted
  `(tabs)` screen keeps a hidden copy in the DOM. When it is opened cold (the refusal and the
  arrival guard), there is none. Counting visible copies holds either way.
- **Nothing takes the foot.** A press 8 px above the bottom edge, at the left, the centre and the
  right, lands inside this route's own scroller. A bar or overlay under any name would take it
  instead. A layer with `pointer-events: none` takes no press and is not seen by this check.
- **No stale reserve.** The scroller's foot is at most `kit.page`'s 48 px.
- **Primary actions are reachable:** scrolled into view programmatically (not by a finger drag),
  then wholly in the viewport (`ratio: 1`), and a press at the centre lands on the control itself.
  Checked for **Start this goal** at rest at both classes, **Check community goals**, **Open the
  contribute page** and **Go to your communities**. Where a control must already be on screen, it
  is asserted before anything scrolls: the commit framed with its review, and **Check community
  goals** where the press left the Champion. These are the two at-rest checks this producer
  already had, kept.
- **The short phone with its keyboard up.** The last text field keeps focus while the viewport
  loses the same 344 px `ui-mobile-acceptance` gives the keyboard, so 640 becomes **296**. From
  there, Tab alone reaches **Start this goal**, which is whole and pressable, and a tap on it
  creates a real goal.

Each guard was **seen to fail** against this exact producer before it was trusted. The mutants
were local and never committed:

| mutant | failed at |
|---|---|
| `paddingBottom: 140` restored on the route (bundle rebuilt) | 10 / 10 tests: `the foot is deeper than kit.page's …` |
| the real hidden bar un-hidden | `a member tab bar is visible over a focused route`, expected 0, received 1 |
| a bar injected under the name `wsf-member-tabs` | the same assertion, expected 0, received 1 |
| an unnamed full-width bar at the foot | `something other than this route takes a press at its foot`, at x = 8, 195 and 382 |
| an unnamed 44 px block at the left edge only | the same assertion, at x = 8 alone (a single centre sample would have missed it) |
| **Check community goals** scrolled off screen after the unknown result | `the resolving action is not on screen after the press` |
| an invisible layer over **Start this goal** | `a press on wsf-new-goal-submit lands on something else` |
| **Start this goal** removed from the Tab order | `Tab never reaches Start this goal` |

## Frames

Same names as `../after/`, so each pairs one-to-one with the frame it succeeds. One frame is new.

| Frame | What it shows |
|---|---|
| `AFTER-form-top-390x844.png` · `-390x640.png` | the spine and the goal phrase above the fold |
| `AFTER-custom-window-390x844.png` · `-390x640.png` | Custom open; the control states the start |
| `AFTER-summary-commit-390x844.png` · `-390x640.png` | the review and its commit as one object; the commit whole at rest |
| `AFTER-refused-390x844.png` · `-390x640.png` | the real `permission-denied` from the callable |
| `AFTER-unconfirmed-INJECTED-NETWORK-390x844.png` · `-390x640.png` | the unknown result and the action that resolves it |
| `AFTER-unconfirmed-retry-INJECTED-NETWORK-390x844.png` · `-390x640.png` | the foot of that state: the deliberate retry, its consequence, then `kit.page`'s foot, with no band of nothing |
| `AFTER-created-390x844.png` · `-390x640.png` | the live receipt; at 390×844 the whole receipt is on one screen |
| `AFTER-no-community-390x844.png` | the arrival guard |
| **`AFTER-keyboard-submit-390x296.png`** (new) | the short phone with the keyboard up: **Start this goal** reached by Tab, with the focus ring |

What is real and what is injected is unchanged from `../after/README.md`: the refusal and the
created receipt come from the real callable, and only `INJECTED-NETWORK` aborts a request.
Times drift with the capture container's clock; the custom window is fixed.

```
ca9019f921a27a2ced3d2c9305e3e2e15954693b245a316e844c742748e097fd  AFTER-created-390x640.png
b348f42dd96db2c639cc0cad1cadbebc43fec472c6c6bf1b2cc11fc8a066fdb6  AFTER-created-390x844.png
ea52c29d46da8c4ec9d4b69e42090a8bedff172939a78b08129be4de021d4383  AFTER-custom-window-390x640.png
529f4689cf009c9deadaf9368a54d004db0c7e95448d013b57124f5935e1112b  AFTER-custom-window-390x844.png
c1ffa202ff19c492546b47ae2fd52af572769ad6cbaacb171cade926ae124d07  AFTER-form-top-390x640.png
f6e4db2b093a66e49438c939556ba3d80e25094f1f0fd5848fe776db21af50f8  AFTER-form-top-390x844.png
90c0a49b4e625510f73559dd92b459f360be02399039ea3c9ae12a97bb7a2fa6  AFTER-keyboard-submit-390x296.png
1b01ca55ef18a7e8d36d63e9b12cf741a8592abd6013775a157445a3b5896698  AFTER-no-community-390x844.png
b65bfc976fe82ed3a351a36adfae8bc6dcb2e1ffbb74e17619b7f80b6220124f  AFTER-refused-390x640.png
2f4065c90d7f894daf7045f3e6e27a96dd57ce52813e69bb8c16448920a82f73  AFTER-refused-390x844.png
5057a51f52170f014c39229a85a9cc41ec46b8b39514d546d89dbe38a4019a79  AFTER-summary-commit-390x640.png
379a79ffa92ecff2dcc39ecd293cc6699beb1be468a34f96f792512ecfafaf0f  AFTER-summary-commit-390x844.png
20ecc7bc59612be944e73afb52e173f8a878b38e0465ff8556eec4fbd5256e84  AFTER-unconfirmed-INJECTED-NETWORK-390x640.png
aaa4675d8c251fdd72d73bd1f51b118e6f0855720f8b65a195fa8d44ce41dec7  AFTER-unconfirmed-INJECTED-NETWORK-390x844.png
ec8fc3f58c8cb7d1423fe486cd283653c46a8a2c27d0d81f15609736f9690952  AFTER-unconfirmed-retry-INJECTED-NETWORK-390x640.png
33bfd8d7a02cf5f10cad3d14e1790860af9f00c2050c8baa5e9863558f1e012e  AFTER-unconfirmed-retry-INJECTED-NETWORK-390x844.png
```

## Not in this packet

The four community exits on this route still push a second Community instance, and a plain
`back()` would return a stale goal list (measured in `5800472286` §2). That is navigation, which
stays with W9 and waits on W8's goal-list freshness packet (Director `5800485762`); nothing here
touches it. Safari was not measured, only Chromium.

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
