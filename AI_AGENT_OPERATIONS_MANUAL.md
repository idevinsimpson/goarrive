# GoArrive AI Agent Operations Manual

This manual outlines the professional software factory workflow for the GoArrive project. It defines how human architects (Devin/Ben) and AI agents (Maia/Manus) collaborate to build, test, and deploy features safely and efficiently.

## 1. The Staging-First Workflow

The core principle of this workflow is that **no code goes to production without human review**. We use a dedicated staging environment to bridge the gap between AI-generated code and live user impact.

### The Pipeline
1. **Task Assignment:** Devin assigns a task to Maia in Slack (e.g., "Update the 'Add Movement' button color").
2. **Implementation:** Maia writes the code in her environment.
3. **Automated Checks:** Maia runs the `/ship` command, which automatically executes TypeScript checks and Vitest unit tests.
4. **Staging Deployment:** If checks pass, `/ship` automatically deploys the build to the staging URL.
5. **Human Review:** Devin refreshes the staging URL on his iPad to visually verify the changes.
6. **Approval & Merge:** Devin approves the changes in Slack ("Merge that PR"). Maia merges the Pull Request, and the code goes live to production.

### Key URLs
*   **Staging Environment:** `https://goarrive--staging.web.app` (Keep this open for instant previews)
*   **Production Environment:** `https://goarrive.fit`

## 2. Autonomous Agent Capabilities

When properly authenticated, AI agents like Maia can handle the majority of the development lifecycle autonomously.

### What Maia Can Do Hands-Free
*   **Write and Refactor Code:** Implement new features, fix bugs, and update UI components based on Slack instructions.
*   **Run Local Tests:** Execute `npm run test:vitest` to ensure logic remains intact.
*   **Build the App:** Run `expo export --platform web` to verify the application compiles without errors.
*   **Deploy to Staging:** Push builds to the Firebase Hosting preview channel.
*   **Manage GitHub PRs:** Create branches, commit code, open Pull Requests, and merge them upon approval.

### The `/ship` Command
The `/ship` command is the engine of this autonomy. When Maia runs `/ship`, it executes the following sequence:
1.  `tsc --noEmit` (Type checking)
2.  `npm run test:vitest` (Unit testing)
3.  `expo export --platform web` (Building)
4.  `npm run deploy:staging` (Deploying to preview channel)
5.  `gh pr create` (Opening a Pull Request)

## 3. Human-in-the-Loop Checkpoints

While agents handle the execution, human architects provide the direction and the final safety gate.

### When Devin Needs to Intervene
*   **Task Definition:** Providing clear, high-level instructions in Slack.
*   **Visual Verification:** Checking the staging URL to ensure UI/UX changes meet expectations (e.g., "Is the green the right shade?").
*   **Feedback Loops:** Instructing Maia to iterate on a feature if the staging preview isn't quite right.
*   **Final Approval:** Giving the explicit "Ship it" or "Merge that PR" command in Slack.
*   **Complex Debugging:** Assisting if an agent gets stuck on a complex architectural issue or failing test that requires deep domain context.

## 4. The "Power Suite" Credential Checklist

To maximize Maia's autonomy, Ben needs to configure specific credentials in her environment. The more access she has, the more she can build and test without blocking.

### Required Credentials
*   **GitHub Auth:** Required for reading code, committing, and managing PRs. (Status: **Connected**)
*   **Firebase Token:** Required for deploying to the staging environment. (Status: **Pending Setup by Ben**)
    *   *Action:* Ben must run `firebase login:ci --no-localhost` on the VM and set the resulting token as `FIREBASE_TOKEN` in `~/.bashrc`.

### Optional "Power Suite" Credentials
Adding these credentials allows Maia to test and debug specific integrations autonomously:

| Integration | Environment Variable(s) | Purpose |
| :--- | :--- | :--- |
| **Stripe** | `STRIPE_SECRET_KEY` | Testing payment flows, CTS logic, and earnings caps. |
| **Zoom** | `ZOOM_API_KEY`, `ZOOM_API_SECRET` | Debugging live session hosting and link generation. |
| **Google Calendar** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Fixing scheduling and calendar sync issues. |
| **Linear** | `LINEAR_API_KEY` | Allowing Maia to automatically update task statuses and roadmap progress. |

## 5. Getting Started

Once Ben has configured the Firebase Token, the workflow is ready.

**Your First Command to Maia:**
> "@maia, run `/ship`. I want to see you successfully build and deploy the current state of the app to the staging link."

If this succeeds, your professional software factory is fully operational.
