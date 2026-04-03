# GoArrive Multi-Agent Staging and Testing Workflow Guide

This document outlines the new practical and cost-effective staging and testing workflow implemented for the GoArrive application. It is designed to ensure a safe, efficient development process for both human developers and AI agents (like Manus and Claude) by leveraging Firebase Preview Channels, Vitest, and Playwright. This guide also details how AI agents can effectively synchronize their work across GitHub, Slack, and Linear.

## 1. The "Staging-First" Deployment Strategy

To provide a safe environment for testing changes before they impact the live `goarrive.fit` application, we have implemented a "Staging-First" deployment strategy using Firebase Hosting Preview Channels. This approach offers a dedicated, temporary URL for each set of changes, allowing for thorough review and validation.

### How it Works:

1.  **Dedicated Staging URL:** A permanent staging URL, `https://goarrive--staging.web.app`, has been established. This URL will always reflect the latest changes deployed to the staging channel.
2.  **Deployment by AI Agent:** When an AI agent (e.g., Manus or Claude) completes a task involving code changes, it will deploy these changes to the staging channel using a specific script.
3.  **User Review:** You, as the user, can keep the staging URL open in a dedicated tab on your iPad or iPhone. After an AI agent notifies you of a staging deployment, you simply refresh the page to see the updated application.
4.  **Service Worker Bypass:** The staging deployment is configured to automatically bypass the service worker cache, ensuring that a simple page refresh always loads the absolute latest code.
5.  **Approval for Production:** Once you have reviewed and approved the changes on the staging environment, the AI agent can then promote the exact same build to the live `goarrive.fit` production site.

### Key Benefits:

*   **No Risk to Production:** Changes are tested in an isolated environment, preventing potential issues on the live application.
*   **Efficient Feedback Loop:** Rapid iteration and visual verification on your preferred device (iPad/iPhone) by simply refreshing a single URL.
*   **Cost-Effective:** Leverages existing Firebase infrastructure without requiring additional project setup or domain purchases.

## 2. Testing Tools and Execution

To maintain code quality and ensure stability, a layered testing approach has been adopted:

### 2.1. Vitest (Unit & Integration Testing)

*   **Purpose:** Vitest is used for fast, lightweight testing of application logic, components, hooks, and utility functions. It provides immediate feedback during development.
*   **Location:** Tests are located in `apps/goarrive/__tests__/`.
*   **Configuration:** `apps/goarrive/vitest.config.ts` and `apps/goarrive/test-setup.ts`.
*   **Scripts (within `apps/goarrive/package.json`):**

    | Script | Command | Purpose |
    | :--- | :--- | :--- |
    | `test:vitest` | `vitest` | Runs all Vitest tests. |
    | `test:vitest:watch` | `vitest --watch` | Runs Vitest in watch mode, re-running tests on file changes. Ideal for quick iteration. |
    | `test:vitest:ui` | `vitest --ui` | Starts Vitest UI for interactive test debugging. |
    | `test:vitest:coverage` | `vitest run --coverage` | Runs Vitest tests and generates a code coverage report. |

### 2.2. Playwright (End-to-End Testing)

*   **Purpose:** Playwright is used for browser-based end-to-end testing of critical UI flows and user journeys, validating the application's behavior in a real browser environment.
*   **Location:** Tests are located in the root `tests/` directory.
*   **Configuration:** `playwright.config.ts` in the root directory. It is configured to use a base URL from the `PLAYWRIGHT_BASE_URL` environment variable, defaulting to the staging URL (`https://goarrive--staging.web.app`).
*   **Scripts (within root `package.json`):**

    | Script | Command | Purpose |
    | :--- | :--- | :--- |
    | `test:e2e` | `playwright test` | Runs all Playwright end-to-end tests. |
    | `test:e2e -- --project=chromium` | `playwright test --project=chromium` | Runs Playwright tests specifically for Chromium.

## 3. Multi-Agent Synchronization Strategy

To enable seamless collaboration between human developers and AI agents (like Manus and Claude), a clear synchronization strategy is essential across GitHub, Slack, and Linear.

### 3.1. GitHub: The Single Source of Truth

*   **Codebase:** The GitHub repository (`idevinsimpson/goarrive`) serves as the single source of truth for all code, documentation, and configuration.
*   **AI Agent Access:** Both Manus and Claude (or any other AI agent) will interact directly with this repository for:
    *   **Fetching latest code:** `git pull origin main`
    *   **Committing changes:** `git commit -m "Descriptive commit message"`
    *   **Pushing changes:** `git push origin main`
*   **Documentation:** All critical knowledge, including this guide and the `testing-policy.md` file, resides in the `.claude/` directory within the repository. AI agents are instructed to read these documents to understand the project's context, architecture, and workflows.

### 3.2. Slack: Real-time Communication and Notifications

*   **Deployment Notifications:** After an AI agent deploys to the staging environment, it will post a message in a designated Slack channel (e.g., `#goarrive-dev` or a direct message to you) with the staging URL and a summary of the changes. This allows for immediate visual review.
*   **Approval/Feedback:** You can provide approval or feedback directly in Slack, which AI agents will monitor to determine the next steps (e.g., promote to production, make further edits).
*   **Status Updates:** AI agents can provide periodic status updates on ongoing tasks or test results in Slack.

### 3.3. Linear: Task Tracking and Workflow Management

*   **Task Assignment:** Tasks related to GoArrive development will be managed in Linear. AI agents will be assigned Linear issues.
*   **Progress Updates:** AI agents will update the status of their assigned Linear issues as they progress through tasks (ee.g., "In Progress," "Ready for Review," "Done").
*   **Linking Commits:** AI agents will link their GitHub commits to the relevant Linear issues, providing a clear audit trail of code changes associated with specific tasks.
*   **Contextual Information:** Linear issues will contain detailed requirements, acceptance criteria, and any relevant context for the AI agent to understand the task fully.

## 4. AI Agent Workflow Example

Here's a typical workflow for an AI agent like Claude:

1.  **Receive Task:** Claude receives a new task via Linear.
2.  **Fetch Code:** Claude pulls the latest code from GitHub (`git pull origin main`).
3.  **Implement Changes:** Claude makes the necessary code modifications.
4.  **Run Tests:** Claude runs relevant Vitest tests (`npm run test:vitest`) to ensure local correctness.
5.  **Deploy to Staging:** Claude executes `npm run deploy:staging` from `apps/goarrive/` to push changes to `https://goarrive--staging.web.app`.
6.  **Notify User:** Claude sends a Slack message to you, providing the staging URL and a summary of changes, requesting your review.
7.  **Run E2E Tests (if applicable):** If the changes involve critical UI flows, Claude runs Playwright tests (`npm run test:e2e`) against the staging URL.
8.  **Await Feedback:** Claude monitors Slack for your approval or further instructions.
9.  **Promote to Production:** Upon your approval, Claude executes `npm run deploy` from `apps/goarrive/` to push the changes to `goarrive.fit`.
10. **Update Linear:** Claude updates the Linear issue status to "Done" and links the production deployment commit.

This integrated workflow ensures that all development activities are transparent, traceable, and validated, leading to a more robust and reliable GoArrive application.
