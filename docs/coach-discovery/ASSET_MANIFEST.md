# Coach Discovery Asset Manifest

Status as of 2026-08-05. All people shown in the current cinematic assets are generated and must not be described as real GoArrive coaches, members, or testimonials.

## Generated structural imagery

| Path | Prompt specification | Current status |
| --- | --- | --- |
| `apps/goarrive/assets/coach-discovery/hero-online-coaching.png` | Cinematic editorial photo, calm Black woman coach in her late 30s listening to an adult member on a laptop video call in a warm, dark-navy home office; portrait 4:5 responsive composition, upper safe text area, warm lamp/cool screen light, natural texture; no branding, legible UI, corporate staging, or staged fitness. | **Lossless generated source.** Runtime uses the matching WebP. Used for the hero and supporting coach moments; replace with permissioned imagery or explicitly approve generated use. |
| `apps/goarrive/assets/coach-discovery/member-audreya.jpg` | User-supplied photograph of GoArrive member Audreya training from home. | **Included.** Scene 8 presents Audreya as a real member and uses the matching public web copy. Confirm that the existing member media release covers public recruiting materials before production. |
| `apps/goarrive/assets/coach-discovery/coach-review-session.png` | Cinematic East Asian man coach in his early 40s attentively reviewing a recorded workout on a laptop in a compact nighttime home office; warm task lamp, blue screen light, caring expression, defocused illegible screen, natural hands; no surveillance tone, corporate staging, or branding. | **Lossless generated source.** Runtime uses the matching WebP. Used for review and coach-focus moments; replace or explicitly approve generated use. |
| `apps/goarrive/assets/coach-discovery/coach-future-life.png` | Grounded evening scene of a South Asian man coach in his early 40s gently closing a laptop after coaching; warm lived-in home, subtle family cues, reflective mood, responsive upper negative space; no wealth/lifestyle promise, celebration, text, branding, or corporate styling. | **Lossless generated source.** Runtime uses the matching WebP. It must not imply a guaranteed outcome. |

Optimized bundled WebPs live beside the PNG masters in `apps/goarrive/assets/coach-discovery/`; predictable web copies live in `apps/goarrive/public/coach-discovery/`. The four delivery files total about 264 KB. The PNG masters total about 7.45 MB and are intentionally retained for future recrops/re-encoding; run `npm run optimize:coach-discovery-images` after replacing a master.

The existing app mark is loaded from `apps/goarrive/assets/logo.png`, with the public web copy at `/goarrive-logo.png`. Confirm that it is the approved production mark/wordmark before release; supply a separate approved wordmark asset if required by brand review.

## Sanitized product captures

The Build workspace is now represented by a real, sanitized GoArrive capture. Every other item below remains a labeled replacement panel rather than fabricated UI.

| Needed capture | Primary use | Status / capture requirement |
| --- | --- | --- |
| Member intake | Scene 9 journey | **Missing.** Mobile member view with realistic demo identity. |
| Coach Command Center | Scene 14 coach montage | **Missing.** Desktop/laptop crop showing realistic, non-confidential priorities. |
| Plan Builder | Scene 10 and member journey | **Missing.** Coach view with schedule, support level, phases, contract/investment, and next step only if currently live. |
| Member-facing plan | Scenes 9–10 | **Missing.** Phone capture paired to the same fictional demo member. |
| Build page | Scene 14 montage | **Included.** `product-build.png` is the redacted source master; the matching 37 KB WebP is bundled for native and copied to public web assets. |
| Movement Library | Product-system support | **Missing.** Sanitized movement list/grid. |
| Workout Builder | Product-system support | **Missing.** Sanitized authored workout. |
| Workout Player | Scene 11 | **Missing.** Phone capture showing only currently live guided-workout capabilities. |
| Member workouts page | Member journey/product support | **Missing.** Sanitized member workout list or detail. |
| Workout sharing | Product-system support | **Missing.** Sanitized current sharing view; do not expose private links or member identifiers. |
| Zoom/session experience | Scene 12 | **Missing.** Approved demo session imagery; all participants must consent or be fictional/demo accounts. |
| Coach Review Queue | Scenes 12–14 | **Missing.** Sanitized review item with no confidential notes or recording content. |
| Glow/Grow reflection | Scenes 9 and 13 | **Missing.** Fictional reflection text with no health information. |
| Scheduling | Scenes 12, 14–15 | **Missing.** Demo schedule with no real names, links, emails, or meeting IDs. |
| Billing dashboard | Scenes 14–15 | **Missing.** Demo amounts; no bank, card, Stripe account, or payout details. |
| Coach Launch | Scene 17 | **Missing.** Guided module progression with approved current module names. |
| Agreement screen | Next-step/product support | **Missing.** Sanitized screen only; do not expose signatures or private contractual records. |
| Member profile or hub | Member journey/product support | **Missing.** Fictional profile with no contact or health data. |

### Build capture provenance

- Source: internal training guide, [GoArrive App — Coach How-To: Upload a Movement + Build a Workout](https://docs.google.com/document/d/19rpqQB2msxpxnVaXTE0xkDi2BcnxsvbkmguzixB8tNg).
- Guide update shown in source: 2026-06-05. Asset extraction and privacy review: 2026-08-05.
- Source app commit and original device dimensions were not recorded in the guide; those fields remain unknown and should be added if the original capture is recovered.
- Redactions: account initials were removed and one potentially member-specific workout title was replaced with “Demo Strength Workout.” No email address, phone number, payment information, health information, meeting credential, signature, or confidential note remains visible.
- Runtime paths: `apps/goarrive/assets/coach-discovery/product-build.webp` and `apps/goarrive/public/coach-discovery/product-build.webp`.

## Capture rules

- Use demo data only and keep names consistent across related captures.
- Remove personal health information, real email addresses/phone numbers, payment details, meeting credentials, signatures, and confidential coach/member notes.
- Do not show direct in-app messaging, progress photos/measurements, server-side push, automated monthly billing close, native-app-store status, or advanced booking/playbook flows as live unless their current merge/deployment status is re-verified.
- Prefer native screenshots at source resolution; provide dark-mode captures and note device/browser dimensions.
- Record the source route, capture date, app commit, fictional identity, permissions, and crop owner for each accepted asset.

## Other approval-dependent assets

- Permissioned real coach photography and, if used, real member photography.
- Approved Zoom-session imagery.
- Optional approved product screen recordings.
- Any approved testimonial or real member story, with written permission.
- Final product-owner/legal confirmation of the exact public compensation language.
