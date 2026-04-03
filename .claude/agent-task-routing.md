# GoArrive Agent Task Routing Protocol

This is a **mandatory** workflow rule, not a suggestion. Every GoArrive task must be classified and routed to the correct tool before work begins. This eliminates wasted credits, tool confusion, and vague handoffs between agents.

## Default Mindset

| Task Type | Routed To | Environment |
| :--- | :--- | :--- |
| **Code Task** | `@maia` | Slack + GitHub repository |
| **Browser Task** | Manus | Browser-based dashboards and admin panels |
| **Hybrid Task** | Split between both | `@maia` orchestrates, Manus handles browser steps |

---

## 1. Code Tasks (Route to `@maia` in Slack)

Any task that primarily involves the codebase, repository, or local development environment belongs with `@maia` in Slack. This includes editing screens and UI components, refactoring code, wiring data flows, fixing logic, updating application routes, writing or running tests, managing staging and build tasks, handling the PR/review flow, updating documentation and knowledge files inside the repository, and performing architecture analysis rooted in the codebase.

**Enforced behavior:** Keep this work strictly in Slack with `@maia` and the repository workflow. Do not unnecessarily route repository work to Manus. Prefer `@maia` for all coding, refactoring, testing, PR management, and repository-native implementation. `@maia` reports what changed, what was tested, and what needs review or approval.

---

## 2. Browser Tasks (Route to Manus)

Any task that requires heavy browser interaction, authenticated dashboard clicking, or third-party configuration belongs with Manus. This includes Stripe dashboard configuration (products, webhooks, pricing), Firebase Console setup (auth providers, indexes, project settings, extensions), Google Cloud Console work (IAM policies, API enabling, OAuth consent screens, service accounts), Zoom dashboard setup (app creation, webhook configuration), Jotform admin setup, Google Workspace admin actions, and any task needing live browser login, session interaction, or visual navigation of external sites.

**Enforced behavior:** Do not force browser-heavy dashboard work through Slack if Manus is the better tool. Treat Manus as the preferred tool for all browser, admin, and configuration tasks. When `@maia` encounters a browser task, she must not attempt it herself. Instead, she provides:

1. A short plain-English explanation of what needs to happen.
2. The exact prompt to paste into Manus (copy-paste ready).
3. Any credentials, pages, settings, or approvals needed.
4. Exactly what to send back to `@maia` once Manus finishes.

---

## 3. Hybrid Tasks (Split Between Both)

When a task requires both code changes and browser configuration, it must be split cleanly between the two tools. Examples include changing application code to support a new subscription tier and then configuring that tier in the Stripe dashboard, updating repository logic and then creating or configuring resources in the Firebase or Zoom consoles, and preparing code-side changes with `@maia` before handing off browser steps to Manus and returning to `@maia` to finalize.

**Enforced behavior:** `@maia` orchestrates the split into three distinct phases:

| Phase | Owner | Description |
| :--- | :--- | :--- |
| Phase 1 | `@maia` | Completes all code and repository work. |
| Phase 2 | Manus | Executes browser/dashboard steps. `@maia` provides a complete, copy-paste-ready prompt for Devin to hand to Manus. |
| Phase 3 | `@maia` | Finalizes any remaining code work after Manus completes the browser steps. |

The handoff between tools must be explicit and copy-paste ready. `@maia` must state: *"I have completed the code portion. Please hand this exact instruction to Manus to complete the browser configuration..."*

---

## Guardrails

Every response to a GoArrive task must start with a classification label: **"Code task"**, **"Browser task"**, or **"Hybrid task"**. Agents must not make Devin guess which tool to use. Agents must not attempt browser-heavy dashboard work through Slack if Manus is the better tool. Handoffs must never be vague; Manus prompts must be complete and copy-paste ready. This routing protocol is a permanent operating rule and must not be described as optional. When an agent receives a task that belongs to the other tool, it must politely inform the user of the correct routing based on this document.
