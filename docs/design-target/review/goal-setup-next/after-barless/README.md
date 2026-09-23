# `/goals/new` — barless AFTER (NOT YET ACCEPTED)

The shipped route since W9's shell migration, photographed the way `../after/` was. **Awaiting the
Director's actual-pixel review; nothing here is accepted.** Released by Director `5800455297` §2
after W6's measurement (`5800472286`).

`../after/` is the **accepted, historical** record of this route under the floating member tab
bar. It is byte-identical and is not regenerated: this producer now writes here and nowhere else.

| | |
|---|---|
| Base | `claude/wsf-app-shell` @ `f2f901acbe3103d8bdd05afb448064e67e19b5cf` |
| Route blob | `95fc01b23886fdcf1bd3828d111c98a20d5bf796` at `f2f901a` → **`cf71b4325a5f1dff58f23bbcb6c3d118be46566d`** (this packet) |
| Producer blob | `24671f7d2a462ec2b419d5bcb09f5f8713e6417d` at `f2f901a` → **`4ec2f4ca08b31fbda09e47e79cc9271760648dd7`** (this packet) |
| Producer | `apps/westayfit/tests-e2e/sprint-w6-goal-setup-after-capture.spec.ts` |
| Write gate | `WSF_CAPTURE_FRAMES=1` (`helpers/capture`) |
| Ordinary run | 10 passed, **0 bytes written** (all of `docs/design-target` hashed before and after) |
| Gated run | 10 passed, **16 frames**, all here; `../after/`, `../target/`, `../before/` and `../../goal-setup-current/` byte-identical (47 files, sha256 before and after) |
| Environment | emulator `demo-wsf-local`; web bundle built at the route blob above with `EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1`; Chromium; `deviceScaleFactor` 2 |

Each blob was read with `git rev-parse <sha>:<path>` (base) or `git hash-object` on the working
file (this packet) before being written here.

## What changed on the route

One style. `styles.pageFoot: { paddingBottom: 140 }` existed only to hold content clear of the
floating tab bar. The route is now a focused flow outside `(tabs)` and no bar renders over it, so
the reserve was dead space: its scroll container now takes `kit.page` as it is, a 48 px foot. The
two comments that described the bar as present are rewritten. No copy, colour, navigation,
classifier or behaviour line moved.

Measured on the same fixture, end of scroll:

| | before (`f2f901a`) | after (this packet) |
|---|---|---|
| foot padding, both classes, form and receipt | 140 px | **48 px** |
| created receipt at 390×844 (`scrollHeight` / viewport) | 873 / 844, so it scrolled 29 px into nothing | **844 / 844, no scroll** |
| created receipt at 390×640 | 862 / 640 | 770 / 640 |

## What the producer now proves

On every state and class it already covered, plus a new keyboard case:

- **No bar.** No visible `wsf-member-tabs`. It is counted, not tested for presence, because the
  `(tabs)` navigator stays mounted under this route, so the bar is always in the DOM, hidden.
- **Nothing overlays the foot.** Whatever is painted 8 px above the bottom edge belongs to this
  route's own scroller. That catches a bar under any name.
- **No stale reserve.** The scroller's foot is at most `kit.page`'s 48 px.
- **Primary actions are reachable:** wholly in the viewport (`ratio: 1`), and a press at the centre
  lands on the control itself. Checked for **Start this goal** at rest at both classes, **Check
  community goals**, **Open the contribute page** and **Go to your communities**.
- **The short phone with its keyboard up.** The last text field keeps focus while the viewport
  loses the same 344 px `ui-mobile-acceptance` gives the keyboard, so 640 becomes **296**. From
  there, Tab alone reaches **Start this goal**, which is whole and pressable, and a tap on it
  creates a real goal.

Each guard was **seen to fail** before it was trusted. The mutants were local and never
committed:

| mutant | failed at |
|---|---|
| `paddingBottom: 140` restored on the route (bundle rebuilt) | 10 / 10 tests: `the foot is deeper than kit.page's …`, received 140 |
| the real hidden bar un-hidden | `a member tab bar is visible over a focused route`, expected 0, received 1 |
| a bar injected under the name `wsf-member-tabs` | the same assertion, expected 0, received 1 |
| an unnamed bar injected at the foot | `something other than this route is painted at its foot` |
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
5e18dedf6551f54202753fa0b53eea07f476bf7419caf4216c013124f7bfdaef  AFTER-created-390x640.png
6dfbf43999db0b95d7bc4b5b5436f922720626778d1278c90d4469faca0103bc  AFTER-created-390x844.png
ea52c29d46da8c4ec9d4b69e42090a8bedff172939a78b08129be4de021d4383  AFTER-custom-window-390x640.png
529f4689cf009c9deadaf9368a54d004db0c7e95448d013b57124f5935e1112b  AFTER-custom-window-390x844.png
c1ffa202ff19c492546b47ae2fd52af572769ad6cbaacb171cade926ae124d07  AFTER-form-top-390x640.png
9ae71dc5708ac71e63080df5066b6f0ba7e2ddc81d17b74e02e6f01e5fda913c  AFTER-form-top-390x844.png
8895e22ac46782aa64685222002280443fd6f28bb428a9ee7b5843148988ad34  AFTER-keyboard-submit-390x296.png
1b01ca55ef18a7e8d36d63e9b12cf741a8592abd6013775a157445a3b5896698  AFTER-no-community-390x844.png
916306fed14a477982234f48154b3765e38eb2e17337b91ed686130fd9056850  AFTER-refused-390x640.png
ef5c6ada5bae1f769f3d5a99613d0671c61d609d9df371dc708ebee2cb9900d1  AFTER-refused-390x844.png
5057a51f52170f014c39229a85a9cc41ec46b8b39514d546d89dbe38a4019a79  AFTER-summary-commit-390x640.png
379a79ffa92ecff2dcc39ecd293cc6699beb1be468a34f96f792512ecfafaf0f  AFTER-summary-commit-390x844.png
a350c25d0a5085c43f342184516254ab81b081ae5c4a8968a9130f92f1e0a902  AFTER-unconfirmed-INJECTED-NETWORK-390x640.png
654b86538c975bac769e9466c9904863ff23288ba744168ab6f17c3ad8d64beb  AFTER-unconfirmed-INJECTED-NETWORK-390x844.png
da01d1ba140e4635d61f64bd867b7ced829083cc5781eefa565dbe136322b857  AFTER-unconfirmed-retry-INJECTED-NETWORK-390x640.png
2dd10753bdbf4866752ac916186a4efcb02a959783e636cf760aa72a4e0d8e2b  AFTER-unconfirmed-retry-INJECTED-NETWORK-390x844.png
```

## Not in this packet

The four community exits on this route still push a second Community instance, and a plain
`back()` would return a stale goal list (measured in `5800472286` §2). That is navigation and
belongs to W9's lane; nothing here touches it. Safari was not measured, only Chromium.

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
