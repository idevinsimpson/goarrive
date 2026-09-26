# COMMUNITY-PARITY-1 — component-level evidence

Director release COMMUNITY-PRESENTATION-ACCELERATOR-1 (#447 `5840798701`), with the
data mapping in `5840935220`. **This is component-level evidence, not route
acceptance.** The Community and Settings routes are W9's. W9 imports these views
and owns the wiring and the real transition evidence.

- **Product:** `646c9579bc5761a219d76c49f24dd64eaa3e485b`, which is `db41ffd2` plus the
  Director's condition K-F1 (#496 `5842638933`), and `db41ffd2` is `6acd0243` plus the
  hardening corrections C1–C3 (`5841929675`), all from exact `0b460ce3`. It adds
  `src/ui/CommunityParityView.tsx`, `src/ui/CommunityPrivacyPanelView.tsx` and
  `src/ui/communityParityTypes.ts`. The frames come from the gated fixture
  `app/design-target/community-parity.tsx`.
- **Reference:** Lovable `e15b9fa0-b2a0-4314-bc21-9c573b8eceb1` at frozen
  `d4f606244ba3995080fb0bcd471cbebf4cbbc56a`. Source: `src/demo/screens/community.tsx`,
  `src/demo/overlays.tsx` (`PrivacySheet`), `src/demo/screens/you.tsx`
  (`PrivacyControls`), `src/styles.css`.
- **Producer:** `apps/westayfit/tests-e2e/sprint-w4-community-parity.spec.ts`, evidence test.
  It writes only under `WSF_CAPTURE_FRAMES=1`, and an ungated run writes nothing.
  Chromium runs at device pixel ratio 1, like the originals. Nothing accepted is written.

## The reference originals (`lovable-d4f60624/`)

These are the reference's own evidence captures, committed at `d4f60624` as base64
under `comparison-evidence-base64/`. They are decoded byte-for-byte here and not
re-rendered, because the Lovable preview host is not reachable from this environment.

| file | from | sha256 |
|---|---|---|
| `community-390x844.png` | `02-community-390x844.png.b64` | `725c7e18fb5e6b8835c585f2c9d1aa733315a7d5472fb73c29b471bc0156e9c0` |
| `manage-community-page-390x640.png` | `manage-champion-community-page-390x640.png.b64` | `bcf9b22bbe3af524d1b93f9f81fbb7df0659b01b416a66cb8f636b6674ef261c` |
| `settings-390x844.png` | `you-settings-390x844.png.b64` | `0aed9d15e3ba8072d6c3226e6600827cd5f8f8bcf770b7c7fe42e31c32365928` |
| `settings-390x640.png` | `you-settings-390x640.png.b64` | `93d8552709a3302fbc4c4cc134bb5d25c4b3234873180d8009cf371657de4615` |

The reference has no original for the no-goal Community or for a failed privacy
save. Those frames are canonical-only.

## The frames (`fixture/`)

| state | 390×844 sha256 | 390×640 sha256 |
|---|---|---|
| normal | `01660171f1f63f89cd3a984447830c5ebd72a8d0b7e9939206d5093c8b412ef0` | `e1cb5cdf0d743142ade00a838f225f4320aebec3f3549cfaba42faefe8fb03b9` |
| no-goal | `da6bfcf13661b873115f138ac092a8e3cb7120e267df8ecc881cfcc198ae4e8e` | `6469bf1865be5d4242cac4af63b6ba78b789f286f7c908869d335c5d845d436b` |
| privacy | `03c8a2185f5d306b4d4a7cbc8127b0f70983412a1859e4822773d628b9e1c501` | `4427e85904c8777fbd63949dedad2881ea4e153c5dd0599f96b663a31b9584bb` |
| privacy-failed | `094c8c98accf70fff31472225905ccb1f8bfb6255851cc45cd4e7d4d8f4ab2b7` | `ae1147c2e88bde3360756b32d84422f522e61587b9bb6afb11af59f61424a94e` |

Each state that has an original gets three images: `cmp-…-side-by-side.png` (reference on
the left), `cmp-…-overlay-50.png` and `cmp-…-difference.png`. All three are cropped to the
same window:
- **Community:** below the reference's 92 px masthead and above its 75 px tab bar. Those
  are the shell, which is W9's.
- **Settings:** below the panel header (83 px including its rule, measured on the
  original). The header and Close are overlay chrome, also W9's.

`fixture/manifest.json` records every hash, crop and measured differing-pixel share: the
share of pixels whose summed channel difference is over 48. It is a measurement, not a
verdict.

| comparison | differing share |
|---|---|
| normal 390×844 | 0.0618 |
| normal 390×640 | 0.1410 |
| privacy 390×844 | 0.0934 |
| privacy 390×640 | 0.1884 |

**After C2 / C3** (`db41ffd2`), only the privacy frames and their comparisons were
re-captured. Before them the privacy shares were 0.1430 and 0.2134. The Community
frames (normal and no-goal, and their comparisons) came out **byte-identical** on the
re-capture, so they carry unchanged.

| state | 390×844 sha256 | 390×640 sha256 |
|---|---|---|
| privacy (re-captured) | `ad911d5f1cef2879cf94cea5a35c8ae3b85ff99274fecc4457a964cec292473b` | `65de0d2acdb81614d28a60b28a047983ab3d230279c399981c2811c392791145` |
| privacy-failed (re-captured) | `c3b5b487581732d346f27e768d04266618c16a40395d145ca70f05ce58586f50` | `d0c0ef712b379c3ebbec0f22834513d4376d78ec4b25c7c5a7be042546d9c362` |

The frames table above gives the privacy hashes as they were at `6acd0243`; this
table supersedes them.

**After K-F1** (`646c9579`), an impossible member count (NaN, ±Infinity, a negative,
a fraction) reads as unknown. No valid state changes. All 21 files in `fixture/`
(8 frames, 12 comparisons, `manifest.json`) were re-captured, gated, from the
`646c9579` build after an ungated run that wrote nothing. Every one came out
**byte-identical**, so the evidence carries unchanged and the hashes and shares
above stand.

## Intentional reference differences (what the share is made of)

**1. Banner supporting lines.** Lovable's free-form place ("NEIGHBORHOOD COMMUNITY") and
descriptor ("Moving together this week") have no canonical field. Per the mapping, the
eyebrow carries the human group type ("FAMILY AND FRIENDS"; left out for `custom`), and
the descriptor carries the join policy in existing label words ("Private community",
"Public community", "Anyone with the link can join"). Nothing geographic is derived. The
slot, size and spacing are the reference's. The banner eyebrow is 14 px, as in the
reference, where `.community-banner p` outranks `.eyebrow`.

**2. The period line under the numbers.** The reference prints "This week · squats only".
The canonical goal read carries the window, which the route formats, but no movement
list, so only the window is shown.

**3. The 390×640 reference original is its Champion capture** ("Your role: Champion"). The
fixture is the member state. The reference also starts its banner 4 px lower at short
heights (`@media (max-height: 700px) .screen { padding-top: 10px }`). The rows below
agree.

**4. The final note.** It reads "Your private Progress keeps the exact amounts we can read
for you." The reference's "always keeps exact amounts" would promise dated private
history that is not currently readable (C3). *(At `6acd0243` each privacy block also
carried a consequence paragraph. C2 removed it: each toggle's own hint carries the
consequence, as in the reference, and the privacy rows now line up with the original's.)*

**5. The privacy scope sentence.** It carries the canonical boundary ("never the public
web, a display, a kiosk or marketing") in place of the prototype's "in a real app".

**6. Glyphs.** The chips' check and plus are text glyphs, not Lucide icons. No icon package
is added in this packet.

**7. The failed-save frame.** It shows the W7 Check 43 contract, which the reference
cannot show: the switch is on the stored value, and the error with Try again stays
visible. Its counterpart states are unit-tested:
- the reply lost after the write landed ("We couldn’t confirm that change");
- the membership refused, with no switch and no retry;
- the error kept while a re-read is loading or has failed.

## Limitations

- Chromium only. Safari is not measured.
- Fonts differ. The reference names Avenir Next, and its originals were captured in
  Lovable's own environment. These frames use the app's default stack in this Chromium,
  so glyph shapes and some text widths differ in the difference images.
- Component-level only. Route data, transitions, overlays, focus return and the real
  callables are W9's to wire and W7's to validate on the integrated route.
