# GoArrive Agent Task Routing Protocol

This is a **mandatory** workflow rule, not a suggestion. Every GoArrive task must be classified and routed to the correct tool before work begins. This eliminates wasted credits, tool confusion, and vague handoffs between agents.

## The New Division of Labor

The previous strict split of "Maia does code, Manus does browser" is obsolete. `@maia` now has access to a headless browser via the Browser Use Cloud SDK and can perform automated UI testing and general browser automation.

The new division of labor is based on **Authentication State**, not the tool type.

| Task Type | Routed To | Why? |
| :--- | :--- | :--- |
| **Code & Repo Tasks** | `@maia` | She lives in the repository and handles all coding, testing, and deployment. |
| **Stateless Browser Tasks** | `@maia` | She can use Browser Use for E2E testing, scraping, and interacting with sites that don't require Devin's personal logins. |
| **Stateful Dashboard Tasks** | Manus | Manus maintains persistent login sessions for Devin's accounts (Firebase, Stripe, Google Cloud, Zoom). |
| **Hybrid Tasks** | Split | `@maia` writes code; Manus handles the stateful dashboard configuration. |

---

## 1. Code & Repo Tasks (Route to `@maia`)

Any task that primarily involves the codebase, repository, or local development environment belongs with `@maia` in Slack.
- **Examples:** Editing UI components, refactoring code, writing tests, managing staging/builds, handling PRs, updating documentation.

## 2. Stateless Browser Tasks (Route to `@maia`)

Any task that requires a browser but **does not** require Devin's persistent login credentials belongs with `@maia`.
- **Examples:** Running E2E UI tests against the staging site (`goarrive--staging.web.app`), signing up for new third-party services (like creating a new API key on a free tier), scraping public data, or verifying visual layouts.
- **Tool:** `@maia` uses the Browser Use Cloud SDK (see `skills/browser-use-e2e/SKILL.md`).

## 3. Stateful Dashboard Tasks (Route to Manus)

Any task that requires heavy browser interaction inside authenticated dashboards where Devin is already logged in belongs with Manus.
- **Examples:** Stripe dashboard configuration (products, pricing), Firebase Console setup (auth providers, project settings), Google Cloud Console (IAM, APIs), Zoom dashboard setup, Google Workspace admin actions.
- **Why Manus?** Manus's browser environment persists Devin's cookies and login states, avoiding the need for 2FA or password sharing.

## 4. Hybrid Tasks (Split Between Both)

When a task requires both code changes and stateful dashboard configuration, it must be split.
- **Example:** Adding a new subscription tier (code) and configuring it in Stripe (dashboard).
- **Enforced behavior:** `@maia` orchestrates the split. She completes the code, provides a copy-paste prompt for Devin to hand to Manus for the dashboard work, and finalizes the code once Manus is done.

---

## Guardrails

Every response to a GoArrive task must start with a classification label: **"Code task"**, **"Stateless Browser task"**, **"Stateful Dashboard task"**, or **"Hybrid task"**. Agents must not make Devin guess which tool to use. Handoffs must never be vague. When an agent receives a task that belongs to the other tool, it must politely inform the user of the correct routing based on this document.
