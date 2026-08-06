# Coach Discovery Testing Report

Release-candidate checks run on 2026-08-05 EDT against the local static export at `http://127.0.0.1:4173/coach-discovery` on branch `feat/coach-discovery-experience`.

## Completed automated checks

| Check | Result | Evidence |
| --- | --- | --- |
| `cd apps/goarrive && npm run ts:check` | **PASS** | TypeScript completed with no errors. |
| `cd apps/goarrive && npm run build:web` | **PASS** | Expo exported the public `/coach-discovery` static route. Existing Expo Notifications web-support and Expo AV deprecation warnings remain. |
| Playwright targeted suite, Chromium + WebKit | **PASS — 14/14** | `playwright test tests/coach-discovery.spec.ts --project=chromium --project=webkit`; 17.9 seconds. Includes the sanitized Build capture check in both engines. |
| 390 x 844 structure/overflow | **PASS** | 27 scenes, public URL, one H1 + 26 H2s, semantic hero image, and <=1 px horizontal overflow in both engines. |
| Standard/presentation keyboard use | **PASS** | Focusable story region, PageDown scrolling, Home/End scene navigation, and final CTA visibility in both engines. |
| Reduced motion | **PASS** | Tested with emulated `prefers-reduced-motion: reduce` in both engines. |
| Compensation content guard | **PASS** | Automated copy checks passed, and scenes 19–21 were compared against the 2025 Drive agreement plus the repository's 2026 JotForm-derived terms. Percentages and cap mechanics match; source-of-record confirmation and legal sign-off remain required before production. |
| Scoped analytics + final CTA | **PASS** | `experience_opened`, `compensation_section_viewed`, and `next_step_cta_selected` DOM events were observed; the CTA routed to `/coach-apply` in both engines. |
| Automated accessibility | **PASS** | Axe WCAG 2 A/AA/2.1 AA scan reported zero violations inside the route in Chromium and WebKit. |
| Static HTML contract | **PASS** | One viewport tag with no `maximum-scale`, discovery title/description/canonical/OG/Twitter metadata, two font preloads, one H1, 26 H2s, and semantic image markup. |
| Capture automation | **PASS** | Script produced three responsive hero stills, six phone key-scene stills, and a 390 x 844 WebM. Instrumented recording ended at `32091 / 32091px`. |

The broader app command `npm run test:vitest -- --run` produced **191 passing tests across 15 suites**. Four pre-existing hook suites failed before running because Vitest/Rolldown could not parse React Native Flow syntax (`useMediaPrefetch`, `useSeamlessLoop`, `useWorkoutTTS.queue`, and `useWorkoutTimer`). No failure referenced coach-discovery code.

## Visual artifact review

| Artifact/check | Result | Notes |
| --- | --- | --- |
| Phone hero, 390 x 844 | **PASS** | Photography, safe-area progress, headline, support copy, wordmark, and controls paint correctly. |
| Phone scenes 5, 9, 14, 19, 21, 27 | **PASS** | Orbit, sticky journey, sanitized Build capture, remaining product placeholders, tier cards, growth cards, qualifiers, and final CTA are legible with no observed collapse/crop. |
| Tablet hero, 820 x 1180 | **PASS** | Responsive crop, type scale, progress rail, and controls reviewed. |
| Desktop hero, 1440 x 1000 | **PASS** | Max-width composition, progress rail, image crop, and controls reviewed. |
| Full mobile recording | **PASS (artifact integrity)** | 19.72 seconds, 390 x 844. Metadata loaded successfully; late and end frames were inspected at scenes 23 and 27. This is a fast automated walkthrough, not final presenter pacing approval. |

Artifacts are under `docs/coach-discovery/artifacts/`:

- `screenshots/phone-390x844.png`
- `screenshots/tablet-820x1180.png`
- `screenshots/desktop-1440x1000.png`
- `screenshots/phone-scene-05.png`, `09`, `14`, `19`, `21`, and `27`
- `coach-discovery-mobile-full.webm`

## Accessibility and performance notes

- Pinch zoom is no longer capped globally; the route has a single viewport declaration and reflow still needs manual 200% review.
- Fixed progress and controls use safe-area insets. Interactive controls expose visible focus treatment.
- Meaningful web photography uses real `<img>`/alt semantics. The hero and hero mark load eagerly; 12 later images lazy-load with async decoding.
- Self-hosted Space Grotesk and DM Sans WOFF2 subsets use `font-display: swap`; SIL OFL copies ship beside the fonts.
- Runtime discovery photography totals about 264 KB. The shared Expo entry remains about 6 MB uncompressed; Lighthouse, throttled-network, LCP, CLS, and INP/TBT measurements remain pending.
- No audio autoplays, and no core information is communicated only through animation.

## Still required before public launch

| Check/approval | Status |
| --- | --- |
| Real iPhone Safari, including PWA safe area/share/reload | **NOT RUN** |
| Real Android Chrome, including share/reduced motion | **NOT RUN** |
| VoiceOver and TalkBack | **NOT RUN** |
| Manual keyboard/switch and 200% zoom review | **NOT RUN** |
| Lighthouse and slow-network performance run | **NOT RUN** |
| Vertical print/PDF export review | **NOT RUN** |
| Sanitized real app screenshot replacement | **MISSING ASSETS** |
| Product-owner review of all 27 scenes and live-call pacing | **PENDING** |
| Authoritative Program Terms comparison and legal approval | **PENDING** |
| Combined release-scoped Firebase staging deploy | **NOT RUN — credentials unavailable** |
| Relay/Manus smoke test | **NOT RUN** |
| Explicit production approval/deployment | **NOT RUN** |

Firebase CLI and usable Firebase authentication were unavailable in the local Windows environment, so no hosted preview or production URL is claimed here.

## Known limitations

- The Build workspace uses a real sanitized product capture; all other product interfaces remain intentionally labeled placeholders until suitable demo screenshots are supplied.
- Generated people are disclosed placeholders, not real coaches, members, or testimonials.
- The current choreography is a polished structural pass with shared fade/translate motion, a sticky member journey, card stacks, diagrams, and proximity snapping; final scene-specific motion can be refined with approved assets.
- Presentation keys move between scene starts; long Scene 9 should be explored with normal scrolling when pausing on individual journey steps.
- The generic GoArrive social image is used until a discovery-specific approved preview image is supplied.
- Presenter notes are intentionally absent from the public bundle.
