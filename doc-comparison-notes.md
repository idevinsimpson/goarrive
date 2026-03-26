# Document Comparison Notes

## Three Documents Under Review

### 1. OG Blueprint (OGBLUEPRINT.docx) — 30 pages
- Pre-code vision document, v1.0 draft
- Written BEFORE any code was written
- Contains: Executive Summary, Branding, Roles (4+Encourager), User Journeys, Feature Inventory (F-01 to F-27), Architecture (MySQL/Fastify/S3), Full SQL Data Model, Movement Library (Canva inventory), Business Rules (all CONFIG placeholders), Integration Plan (Zoom SDK/Otter/Calendly/JotForm), MVP Milestones, Non-Functional Requirements, Open Questions
- WRONG about: tech stack (MySQL/Fastify/S3), roles (CoachAssistant/Encourager), integrations (JotForm/Calendly/Otter/Zoom SDK), data model (SQL tables)
- VALUABLE unique content: User Journey Maps (MVP journey, Accountability journey, Financial journey), Persona Sketches (Jeremy/Belinda/Marcus), Feature Inventory with priority tiers, Canva Movement Library seed data (6 specific movements with Canva IDs), Non-Functional Requirements (timer accuracy, API latency, media delivery), Open Questions list, MVP Milestone Plan
- STATUS: ~40% implemented differently, ~30% not built, ~15% wrong, ~15% of live app wasn't in OG

### 2. Current Blueprint (currentone.docx) — 38 pages
- Written from live codebase audit, March 25, 2026
- Describes WHAT ACTUALLY EXISTS in code
- Contains: Sky-High Overview, Tech Stack, Roles (3 only), Architecture, Routes, Page-by-Page Breakdown, User Flows, Firestore Collections (40+), Cloud Functions (52), Integrations, Security Model, Scheduled Jobs, Business Logic, Component Library, Design System
- ACCURATE: Everything verified against live code
- MISSING: No product vision/philosophy, no user personas, no user journey maps, no feature roadmap, no "why" behind decisions, no design principles, no research backing

### 3. Product Research Doc — 9 pages
- Research-backed recommendations for coach and member experience
- Contains: What users like/dislike (academic citations), Savannah Bananas DNA translation, Keller Williams Command pattern, Gap analysis (accountability backbone strong, workout delivery missing), Workout player concept, Movement library vision, Coach command center model, Design guardrails (anti-abandonment), Media delivery strategy (MP4 baseline, WebM enhancement), Build priority recommendations
- STATUS: Pure strategy/vision — not a blueprint, but contains critical product philosophy

## What the OG Has That Nothing Else Does
1. User Personas (Jeremy, Belinda, Marcus) — useful for empathy/design decisions
2. User Journey Maps (step-by-step flows for MVP, Accountability, Financial close) — some outdated but the format is valuable
3. Feature Inventory with IDs and priority tiers (F-01 through F-27) — needs updating
4. Canva Movement Library seed data (6 specific movements with Canva design IDs)
5. Non-Functional Requirements (timer accuracy ≤50ms, API p95 <300ms, media <2s)
6. Open Questions list (some resolved, some still open)
7. MVP Milestone Plan (format useful even if content is outdated)

## What the Product Research Doc Has That Nothing Else Does
1. Academic research citations backing every recommendation
2. Savannah Bananas "5 E's" translated to product rules
3. Keller Williams Command pattern (Tasks / Who to Contact / Things to Know)
4. Design guardrails grounded in abandonment research
5. Media delivery strategy (MP4/H.264 baseline, muted autoplay, prefetch)
6. Workout player concept design
7. Movement library vision (tags, equipment, regressions, progressions)
8. Member experience principles (premium, clear, supportive, non-invasive)
9. Coach experience principles (command center, progressive disclosure)
10. Journal philosophy (Glow/Grow, lightweight, 20-30 seconds)

## What the Current Blueprint Has That Nothing Else Does
1. Verified truth of every route, component, collection, function
2. Complete Firestore collection inventory with actual field names
3. All 52 Cloud Functions with types and purposes
4. Security model (Firestore rules, auth claims, bootstrap fallback)
5. Component library with line counts and connection status
6. Design system tokens (actual hex values, fonts, spacing)
7. Orphaned component identification (2,324 lines of workout code disconnected)

## The Answer to "Should I Create a New Blueprint First?"

YES. The right approach is:
1. Create ONE new unified blueprint that merges the best of all three documents
2. This new blueprint becomes the ONLY document that matters
3. The OG Blueprint gets retired — it served its purpose
4. The skill then points to this new blueprint as its reference, not to three separate docs

The new blueprint should contain:
- Everything from the Current Blueprint (verified truth)
- Product philosophy and design principles from the Product Research doc
- Updated user personas from the OG (adapted to reality)
- Updated user journey maps (reflecting what's actually built + what's planned)
- Updated feature inventory with real status (built/partial/missing/abandoned)
- Non-functional requirements (kept from OG, updated where needed)
- Build priority roadmap (from Product Research + gap analysis)
- The do-not-build list (from gap analysis)
