# GoArrive Coach Discovery

This is the handoff for the first complete structural pass of GoArrive's public, phone-first coach discovery experience. The primary experience is a vertical story at **390 x 844 px**; it contains 27 scenes across seven acts and does not require authentication.

## Run locally

Requirements: Node.js/npm supported by Expo 54 and a current desktop browser. From the repository root:

```powershell
cd apps/goarrive
npm ci
npm run web -- --port 4173
```

Open `http://127.0.0.1:4173/coach-discovery` and set responsive mode to **390 x 844**. To open the development server to a phone on the same network, start Expo with `npm run web -- --lan --port 4173` and append `/coach-discovery` to the LAN URL Expo prints.

The route is public:

- Standard scroll: `/coach-discovery`
- Presentation mode: `/coach-discovery?present=1`
- Final next-step destination: `/coach-apply`

Presentation mode uses light proximity snapping, hides share/back-to-top controls, and enables `ArrowDown`, `ArrowRight`, `PageDown`, or `Space` for next; `ArrowUp`, `ArrowLeft`, or `PageUp` for previous; and `Home`/`End` for first/last scene. Presenter notes are not included in the public bundle.

## Build, test, and capture

Type-check and export the web build:

```powershell
cd apps/goarrive
npm run ts:check
npm run build:web
```

For browser tests, install the repository-level Playwright dependencies, keep the local Expo web server running, then run:

```powershell
# From the repository root
npm ci
npx playwright install chromium firefox webkit
$env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:4173'
npx playwright test tests/coach-discovery.spec.ts
```

To regenerate the phone, tablet, and desktop stills plus the full mobile recording:

```powershell
# From the repository root, with the local web server still running
$env:COACH_DISCOVERY_URL = 'http://127.0.0.1:4173'
npm run capture:coach-discovery
```

The capture script writes to `docs/coach-discovery/artifacts/`. It expects locally installed Google Chrome unless `PLAYWRIGHT_CHANNEL` is changed in a compatible environment. Existing files are not evidence of visual acceptance; see [TESTING_REPORT.md](./TESTING_REPORT.md).

Generated source PNGs can be re-encoded with `npm run optimize:coach-discovery-images`. The web route serves optimized public WebP copies; Expo/native builds retain bundled WebP assets.

The web-only print stylesheet lays out scenes as 390 x 844 pages for a future vertical PDF export. Browser print/PDF output still needs visual QA with background graphics enabled.

## Brand implementation

The discovery layer reuses the repository's shared app theme instead of defining replacement accent colors. Current exact mappings are:

| Role | Token/value |
| --- | --- |
| Discovery background | `#080B12` |
| Discovery alternate background | `#0E1422` |
| Shared app background (outside this route) | shared `BG` = `#0E1117` |
| Surface | shared `CARD` = `#111827` |
| Elevated surface | shared `CARD2` = `#151B28` |
| Border | shared `BORDER` = `#1E2A3A` |
| Soft discovery border | `rgba(255,255,255,0.08)` |
| Primary text | shared `FG` = `#F0F4F8` |
| Secondary discovery text | `#A8B2C3` |
| Muted text | shared `MUTED` = `#8A95A3` |
| GoArrive blue | shared `BLUE` = `#5B9BD5` |
| GoArrive green | shared `GREEN` = `#6EBB7A` |
| GoArrive gold | shared `GOLD` = `#F5A623` |
| Display/body fonts | shared `FH` = Space Grotesk; shared `FB` = DM Sans |

The route self-hosts Latin variable WOFF2 subsets with `font-display: swap` and route-level preloads. Both families are distributed under the SIL Open Font License; license copies are stored in `apps/goarrive/public/fonts/`.

## Copy source and required qualifiers

Scene order and reusable business copy live in `apps/goarrive/data/coachDiscoveryScenes.ts`; scene presentation lives in `apps/goarrive/components/coach-discovery/DiscoveryScenes.tsx`. Revise the data file first when changing repeated copy.

The current economics display keeps these contractual values: 60% coach share for 1–3 active members, 65% for 4–6, and 70% for 7+; 7% for an eligible inter-coach referral recorded in GoArrive before the member engages the receiving coach; and 5% direct/3% secondary recruit profit share, subject to the terms' caps and eligibility. The proposed Team Builder opportunity—up to 10 additional percentage points subject to a future agreement, approval, and performance—is labeled **planned, not live, and not in the current terms**.

Every compensation explanation is subordinate to this on-screen qualifier:

> High-level education only. Current GoArrive Program Terms govern eligibility, definitions, timing, calculations, and payment.

Before release, the product owner/legal reviewer must compare scenes 19–21 line by line with the authoritative publication version of `G➲A Program Terms.docx`, including New Business, annual reset, proration, technology fee, and continuing referral obligations. Do not treat the scene copy as an agreement or income promise. Maya is disclosed on screen as a generated story character, not a real member testimonial.

## Analytics

No separate analytics backend or invasive tracking was added. On web, each event is dispatched as the DOM event `goarrive:coach-discovery`; if `window.gtag` exists, the same event is also sent to `gtag`.

| Event | Trigger/properties |
| --- | --- |
| `experience_opened` | Initial load; `presentationMode` |
| `scene_depth_reached` | First reach of each scene; `scene`, rounded `percent` |
| `platform_section_viewed` | Scene 5 first reached |
| `compensation_section_viewed` | Scene 19 first reached |
| `final_question_reached` | Scene 25 first reached |
| `next_step_cta_selected` | Final application CTA selected |

## Accessibility and performance notes

- The page exposes one focusable main story region, one H1 followed by 26 H2 scene headings, semantic image alt text, button labels, visible focus treatment, and desktop keyboard navigation.
- `prefers-reduced-motion` is read at runtime; scroll transitions become immediate and no core message depends only on animation.
- Automated axe checks at WCAG A/AA report no violations in Chromium or WebKit at 390 x 844. VoiceOver/TalkBack and manual contrast/zoom review remain pending.
- The layout uses `100dvh` and restrained transforms, and it does not autoplay audio/video. Mobile Safari still requires real-device review.
- Four runtime WebPs total about 264 KB. The hero and hero mark load eagerly; the other 12 rendered images use native browser lazy loading and async decoding. The shared Expo web JavaScript entry remains about 6 MB uncompressed and still needs Lighthouse/network measurement.
- The experience remains readable without motion, but print/PDF, VoiceOver/TalkBack, switch/keyboard-only focus order, and browser zoom at 200% have not yet been signed off.

## Placeholder assets and known limitations

The four cinematic images are generated structural placeholders. Their exact paths, prompt specifications, and disclosure status are recorded in [ASSET_MANIFEST.md](./ASSET_MANIFEST.md). Replace them with permissioned GoArrive coach/member imagery when available, or obtain explicit approval to publish the generated scenes.

All product frames still show labeled demo placeholders. Sanitized captures are needed for: Member intake; Coach Command Center; Plan Builder; member-facing plan; Build; Movement Library; Workout Builder; Workout Player; member workouts; workout sharing; Zoom/session experience; Coach Review Queue; Glow/Grow reflection; Scheduling; Billing; Coach Launch; Agreement; and member profile/hub. Also still needed are an approved production wordmark/mark check, any permissioned testimonial/story, and any approved screen recording. Every capture must use realistic demo data and remove health information, real contact details, payment data, and confidential notes.

Additional known limitations:

- No product screenshot has been represented as live imagery yet; placeholder labels are intentional.
- Chromium and WebKit E2E, automated accessibility checks, and key-scene responsive artifact review are complete. Real iPhone Safari, Android Chrome, assistive-technology, Lighthouse, and full product-owner review remain pending.
- Presentation mode has no private presenter-notes panel.
- The print stylesheet is an export foundation, not an approved PDF deliverable.
- The final CTA assumes `/coach-apply` remains the approved next step.
- Firebase CLI and usable Firebase authentication were unavailable in this local environment, so no staging or production deployment was attempted.
- No Relay result, hosted preview URL, or production deployment is claimed by this handoff.

## Deployment handoff

Use GoArrive's established release workflow from an authorized deploy environment. The shared staging channel must be built from `main` plus every open release-scoped PR branch; do not replace it with a single-feature staging build.

1. Run the type-check, relevant tests, and web export.
2. From `apps/goarrive`, run `npm run deploy:staging` using the configured Firebase CLI/service-account environment.
3. Record the **full staging URL returned by Firebase**. Update the Manus Smoke Test Briefing, then mention Relay (`<@U0B1YQS8L12>`) in `#dev-goarrive` with the full URL, route `/coach-discovery`, viewport 390 x 844, and specific checks for scrolling, presentation navigation, compensation qualifiers, and the final CTA.
4. Wait for Relay's smoke-test result. On failure, fix, rebuild, redeploy to staging, and re-trigger Relay. Do not advance on a failed smoke test.
5. After staging validation and the normal PR/release checks, production still requires Devin's explicit approval. Only then run `npm run deploy` from `apps/goarrive` in the authorized deployment environment.

The deployment scripts are POSIX-oriented and require Firebase credentials; they were not runnable from this unauthenticated Windows session. Never infer production approval from a request for a preview.
