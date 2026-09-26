# GoArrive — Agent Instructions

## Project Overview
GoArrive (G->A) is an online fitness coaching platform and coach operating system. Single codebase across web, iOS, and Android using React Native + Expo + Expo Router + Firebase. Multi-tenant, role-based architecture with three roles: platformAdmin, coach, member.

## Two Applications Live In This Repository

As of 2026-08-26, this repository hosts **two first-party applications** that ship from the same Firebase project (`goarrive`) but are otherwise isolated:

- `apps/goarrive/` — the GoArrive coach/member fitness platform (the subject of everything else in this file).
- `apps/westayfit/` — We Stay Fit, the community movement product (see `docs/westayfit/DOCUMENT_AUTHORITY_AND_SUPERSESSION.md` for the current WSF authority map).

**Every rule in this file was written for GoArrive.** None are being deleted, reworded, or weakened. The classification below explains how each existing rule maps to the WSF app; when in doubt, treat any rule below this section as GoArrive-only unless it appears in the GLOBAL AND PRESERVED list.

### GLOBAL AND PRESERVED (applies to both apps)

- Privacy enforcement happens at the Firestore Rules layer, not just app logic. `firestore.rules` is a single shared file across both apps; changes require dual regression against both apps (see `docs/westayfit/ARCHITECTURE.md` invariant (d)).
- `camelCase` everywhere: Firestore documents, TypeScript interfaces, props, state.
- `FlatList` or `react-native-draggable-flatlist` for lists over 500 items.
- Always use `thumbnailUrl` for initial media loads — never full video on first render (applies whenever either app renders media).
- Never deploy to production without explicit Devin approval.
- Always stage before production.
- Do-not-build infrastructure items (MySQL, TiDB, Drizzle, S3, Fastify) apply to both apps — WSF ships on the same Firebase stack.

### CLARIFIED (applies with WSF-specific note)

- **Standing Release Policy — Staging & Production** (2026-08-01) applies to WSF, but WSF has its own release train and current manifest / receipt discipline under `docs/westayfit/ops/`, operational `main`, and `skills/wsf-staging-deploy/SKILL.md`. `docs/westayfit/RELEASES.md` is historical, not the current mutable release-state ledger. A staging deploy of one app does not standing-approve the other.
- **`/setup` and `/ship` agent commands** operate on `apps/goarrive/` by default. For WSF staging, do not reconstruct a direct Firebase CLI path from this file; read `skills/wsf-staging-deploy/SKILL.md` on operational `main` and use the reviewed WSF staging control plane. Do not invoke `/ship` for WSF changes.

### SCOPED TO apps/goarrive (WSF explicitly does not follow)

- `effectiveUid`, `claims.coachId`, `useAuth()` — WSF has no `useAuth()` hook, no admin impersonation model, and (per the zero-custom-claims invariant) no custom claims at all.
- `where('coachId', '==', coachId)` on all GoArrive coach-scoped queries — WSF community authorization does not use GoArrive coachId-scoped queries. Optional coaching remains a separate GoArrive-owned layer, not a WSF custom-claim role.
- Three-role model (`platformAdmin`, `coach`, `member`) — WSF has a different authorization model based on Firestore documents, not claims. **WSF must not add a fourth role to the GoArrive claims either.**
- Roles set via Firebase Custom Claims — WSF functions never call `setCustomUserClaims` (statically enforced by `apps/westayfit/tests/zero-custom-claims.test.ts`). The zero-claims invariant exists because 7 of the 8 GoArrive claims call sites replace the whole claims object and would silently clobber WSF-specific claims (see `docs/westayfit/ARCHITECTURE.md` (f) for the enumerated sites).
- Product language ("coach", "member", "movement", "Command Center") — WSF product language and experience are governed by Strategic Master v3.0 + the v3.1 addendum and `docs/westayfit/WE_STAY_FIT_PROJECT_INSTRUCTIONS_v3_1_2026-09-26.txt`; the Universal Communities Charter is historical foundation only.
- Build Tab, Workouts, block canvas, 4:5 aspect ratio for movements — GoArrive product concepts; WSF has none.
- "White-label / custom domains" under Do Not Build — GoArrive-scoped. WSF is a separate first-party product with its own hosting site (`westayfit-app`) and does not conflict with this rule.

### Cross-App Boundaries (WSF-facing, new)

- WSF code (`apps/westayfit/`, `functions-westayfit/`, `scripts/westayfit/`, `firebase.westayfit.json`, `docs/westayfit/`) must not import from, read from, or write to any `apps/goarrive/` or `functions/` path.
- GoArrive code must not import from any `apps/westayfit/` or `functions-westayfit/` path.
- Any change to `firestore.rules` or `storage.rules` (both shared files) requires regression proof against both apps before merge.
- Any deploy that touches functions must use `--only functions:default` or `--only functions:westayfit` — never the bare `--only functions` (which redeploys both codebases).

For WSF, read these before acting:
- `docs/westayfit/DOCUMENT_AUTHORITY_AND_SUPERSESSION.md`
- `docs/westayfit/WE_STAY_FIT_STRATEGIC_MASTER_v3_1_ADDENDUM_2026-09-26.md` together with Strategic Master v3.0
- `docs/westayfit/WE_STAY_FIT_PROJECT_INSTRUCTIONS_v3_1_2026-09-26.txt`
- `docs/westayfit/ops/NORTH_STAR_JOURNEY_MANIFEST.json` for member-visible journey references
- `docs/westayfit/ops/FABLE_OPERATING_PROTOCOL_v1.md` for current coordination
- the canonical CURRENT STATE comment in #365 for volatile status.

Do not use `docs/westayfit/WE_STAY_FIT_MASTER.md` v1.2 or the Universal Communities Charter to override the current strategy; both are retained for historical lineage.

## Tech Stack
- Frontend: React Native + Expo (web, iOS, Android)
- Routing: Expo Router (file-based, role-based route groups)
- Language: TypeScript (strict mode)
- Database: Cloud Firestore (NoSQL, 40+ collections)
- Auth: Firebase Authentication (email/password + custom claims)
- Backend: Firebase Cloud Functions Gen 2 (52+ functions)
- Hosting: Firebase Hosting
- Payments: Stripe Connect (Standard mode)
- Video: Zoom API
- Calendar: Google Calendar API (OAuth2)

**There is NO MySQL, TiDB, Drizzle, Fastify, or S3 in this project.**

## Build & Test
```bash
# Install dependencies
cd apps/goarrive && npm install

# Run unit/integration tests (Vitest)
cd apps/goarrive && npm run test:vitest

# Run E2E tests (Playwright)
npm run test:e2e

# Deploy to staging (always do this before production)
cd apps/goarrive && npm run deploy:staging

# Deploy to production (requires explicit approval)
cd apps/goarrive && npm run deploy
```

## Critical Rules

### Authentication & Data Access
- Always use `effectiveUid` or `claims.coachId` from `useAuth()` — never `user.uid` directly. This breaks admin impersonation.
- All coach-scoped Firestore queries MUST include `where('coachId', '==', coachId)`.
- Privacy enforcement happens at Firestore Rules layer, not just app logic.

### Role System
- Three roles only: `platformAdmin`, `coach`, `member`. No fourth role (no CoachAssistant, no Encourager).
- Roles are set via Firebase Custom Claims through Admin SDK only.

### Code Style
- `camelCase` everywhere: Firestore documents, TypeScript interfaces, props, state.
- Product language: "coach" (not trainer), "member" (not client), "movement" (not exercise), "Command Center" (not dashboard).
- Use `FlatList` or `react-native-draggable-flatlist` for lists over 500 items.
- Use `thumbnailUrl` for initial media loads — never full video on first render.

### Build Tab & Workouts
- Workout creation starts on a blank block canvas, NOT a metadata form.
- The Build tab is a unified creative workspace replacing separate Workouts and Movements tabs.
- Movements use 4:5 aspect ratio.

### Agent Commands
- `/setup`: Run this first to verify your GitHub and Firebase credentials.
- `/ship`: Run this to automatically type-check, test, build, deploy to staging, and open a PR.

### Deployment
- Always use the `/ship` command to deploy to staging (`goarrive--staging.web.app`).
- Never deploy to production (`goarrive.fit`) without explicit approval.
- **After every staging deploy, run Browser Use pre-validation when feasible and post the staging URL plus a PASS/FAIL-per-route table before asking Devin for the authoritative manual smoke test. Relay/Manus smoke tests are retired.** See `.claude/relay-handoff.md` for the current protocol.

### Standing Release Policy — Staging & Production (approved by Devin, 2026-08-01)

This is the standing rule for all release-scoped work. Do not ask Devin for per-PR approval on the moves defined below.

1. **Staging is standing-approved.** When Devin asks for a change intended for testing, that is standing approval to merge every _release-scoped, ready_ PR in that change/batch into `main` and deploy the resulting `main` build to staging once required checks pass. No per-PR approval button.
2. **Production stays explicit.** Production begins only when Devin explicitly says to ship/deploy production. Once he does, deploy the entire _release-scoped, staging-validated_ batch of PRs together without repeated per-PR approval prompts.
3. **Scope guard.** "All PRs" means all PRs belonging to the named release/change batch — not every unrelated open PR in the repo. Never sweep in drafts, experiments, unrelated work, or PRs that have not passed required checks.
4. **Stop-on-surprise.** Halt and report before merging if any of the following is true: required checks failing, unresolvable conflicts, security/data-isolation risk, migration or rollback risk, PR scope ambiguous, staging validation failed.
5. **Batch manifest + terminal result.** Post one concise batch manifest before execution (PRs, SHAs, checks passed, rollback point) and one terminal result afterward (URLs, commit list, smoke-test outcome). This is notification, not an approval prompt, unless a stop-on-surprise condition applies.
6. **Never applies to:** non-release-scoped experiments/spikes, force-pushes to `main`, hook-skipping (`--no-verify`), amending published commits, or Cloud Functions / Firestore rules changes that were not part of the named batch. When in doubt about scope, ask before executing.

The combined-staging rule in `.claude/multi-agent-workflow-guide.md` Section 1 (2026-07-15) still applies — every staging deploy is built from `main` + all open, release-scoped PR branches merged into an integration branch.

### Do Not Build
- MySQL, TiDB, Drizzle, S3, Fastify, JotForm, Calendly, Zoom Embedded SDK
- CoachAssistant or Encourager roles
- White-label / custom domains

## Project Structure
```
apps/goarrive/          # Main Expo/React Native app
  app/(app)/            # Coach/admin routes
  app/(member)/         # Member routes
  app/(auth)/           # Auth routes
  components/           # Shared components
  hooks/                # Custom hooks
  lib/                  # Auth context, Firebase init, types
  utils/                # Utilities
functions/src/          # Firebase Cloud Functions backend
scripts/                # Build/deploy helper scripts
.claude/                # Detailed knowledge base (17 files)
```

## Knowledge Base
For deep dives, see the `.claude/` directory:
- `product-identity.md` — Brand identity, roles, core product loop
- `architecture-and-stack.md` — Full tech stack and routing
- `data-model.md` — Firestore schema and query patterns
- `coding-patterns.md` — Admin impersonation, virtualization, pitfalls
- `file-map.md` — Complete map of all routes, components, hooks, utilities
- `cloud-functions-reference.md` — All 52+ Cloud Functions by category
- `build-system-vision.md` — Build tab, workout creation, playbooks
- `billing-and-business-rules.md` — Stripe Connect, earnings caps, CTS
- `design-system.md` — Colors, typography, layout conventions
- `current-state-and-roadmap.md` — What's built, what's missing, priorities
- `do-not-build.md` — Rejected features and technologies
- `known-issues-and-lessons.md` — Resolved bugs and architectural decisions
- `testing-policy.md` — Testing strategy and execution
- `deployment-and-build.md` — Build process and Firebase Hosting config
- `multi-agent-workflow-guide.md` — Staging-first protocol and agent coordination
- `interaction-rules.md` — **Mandatory.** Behavioral rules: scope adherence, continuous improvement loop, communication style, and initiative protocol
- `agent-task-routing.md` — **Mandatory.** Official workflow split between @maia (Slack/code/stateless-browser) and Manus (stateful-dashboard)
- `relay-handoff.md` — **Mandatory.** Post-staging smoke test protocol. Trigger Relay (`<@U0B1YQS8L12>`) in `#dev-goarrive` after every staging deploy, before every PR.
