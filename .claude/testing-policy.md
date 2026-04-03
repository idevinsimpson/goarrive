# GoArrive Testing Policy

## Overview
This document outlines the practical and cost-effective testing strategy for the GoArrive application, designed to protect the app's integrity without over-testing or incurring unnecessary costs. The strategy leverages a multi-layered approach using Vitest for fast unit/integration tests and Playwright for selective end-to-end browser validation.

## Core Principles

1.  **Layered Testing:** Utilize Vitest as the primary fast test layer for logic, data, and models. Employ Playwright only when truly needed for browser and user-flow validation.
2.  **Targeted Execution:** Prioritize running targeted tests over full test-suite runs whenever possible to optimize for speed and credit usage.
3.  **Staging-First Deployment:** All significant changes will be deployed to a staging environment (Firebase Preview Channel) first for broader validation before live deployment.
4.  **Cost-Effectiveness:** Avoid running the heaviest possible testing stack on every small change. Optimize for practical safety and low credit usage.

## Testing Tools

### Vitest (Unit & Integration Testing)
*   **Purpose:** Fast, lightweight testing for application logic, components, hooks, and utility functions.
*   **Location:** Tests are located in `apps/goarrive/__tests__/`.
*   **Configuration:** `apps/goarrive/vitest.config.ts` and `apps/goarrive/test-setup.ts`.

### Playwright (End-to-End Testing)
*   **Purpose:** Browser-based end-to-end testing for critical UI flows and user journeys.
*   **Location:** Tests are located in the root `tests/` directory.
*   **Configuration:** `playwright.config.ts` in the root directory, configured to use a base URL from `PLAYWRIGHT_BASE_URL` environment variable, defaulting to the staging URL (`https://goarrive--staging.web.app`).

## Test Execution Scripts

### For `apps/goarrive` (Frontend)
| Script | Command | Purpose |
|---|---|---|
| `npm run test:vitest` | `vitest` | Runs all Vitest tests. Use for broader Vitest validation. |
| `npm run test:vitest:watch` | `vitest --watch` | Runs Vitest in watch mode, re-running tests on file changes. Ideal for quick, safe iteration during development. |
| `npm run test:vitest:ui` | `vitest --ui` | Starts Vitest UI for interactive test debugging and visualization. |
| `npm run test:vitest:coverage` | `vitest run --coverage` | Runs Vitest tests and generates a code coverage report. |

### For Root Directory (E2E)
| Script | Command | Purpose |
|---|---|---|
| `npm run test:e2e` | `playwright test` | Runs all Playwright end-to-end tests. |
| `npm run test:e2e -- --project=chromium` | `playwright test --project=chromium` | Runs Playwright tests specifically for Chromium. |

## Recommended Workflow

### 1. Quick Safe Iteration (Small Logic/Data/Model Changes)
*   **Action:** When making small changes to logic, data models, or utility functions.
*   **Execution:** Run targeted Vitest tests using `npm run test:vitest <path/to/test.test.ts>` or use `npm run test:vitest:watch` to continuously run relevant tests.
*   **Rationale:** Fast feedback, low credit usage, ensures immediate code correctness.

### 2. Staging Validation (Medium Feature Changes / UI Flow Changes)
*   **Action:** When implementing medium-sized features, especially those involving UI changes or new user flows.
*   **Execution:**
    1.  Run relevant Vitest tests (`npm run test:vitest`).
    2.  Deploy to the staging preview channel (`npm run deploy:staging`).
    3.  Run directly related Playwright tests against the staging URL (`npm run test:e2e`).
*   **Rationale:** Validates integration and UI behavior in a realistic environment before affecting production. The staging URL allows for manual review on devices like iPad/iPhone.

### 3. Pre-Live Deploy Validation (Major UX / Workflow / Release-Sensitive Changes)
*   **Action:** Before deploying major UX overhauls, critical workflow changes, or release-sensitive updates to production.
*   **Execution:**
    1.  Run the full Vitest suite (`npm run test:vitest`).
    2.  Deploy to the staging preview channel (`npm run deploy:staging`).
    3.  Run the full Playwright end-to-end suite against the staging URL (`npm run test:e2e`).
    4.  Perform thorough manual review on the staging environment.
*   **Rationale:** Comprehensive validation ensures high confidence before pushing to live, minimizing risk of production issues.

## Baseline Tests (Highest-Risk Areas)
Initial baseline tests have been added to cover the highest-risk areas:

*   **Build/Workout Block Logic:** `apps/goarrive/__tests__/logic/workoutBlock.test.ts`
*   **Scheduling/Session Logic:** `apps/goarrive/__tests__/logic/scheduling.test.ts`
*   **Pricing/Payment-Sensitive Logic:** `apps/goarrive/__tests__/logic/payments.test.ts`
*   **Critical UI/Browser Flows:** `tests/build-page.spec.ts` (for the Build page navigation and search input)

These tests serve as a starting point and should be expanded as new features are developed or existing ones are modified.

## Guardrails
*   **Avoid Over-Engineering:** Do not create a huge, brittle suite of tests just for the sake of having tests. Focus on practical safety.
*   **Optimize for Speed & Cost:** Prefer targeted testing. Do not run the entire test stack if only a small area has changed.
*   **Preserve Conventions:** Maintain existing repository conventions where possible.

This policy aims to strike a balance between robust quality assurance and efficient development, ensuring the GoArrive app remains stable and performant.
