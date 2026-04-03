# GoArrive Task Routing Protocol

## Purpose
This is a mandatory workflow rule — not a suggestion. Every GoArrive task must be classified and routed to the correct tool before work begins. This eliminates wasted credits, tool confusion, and vague handoffs.

## The Three Task Types

### Code Task
Work that lives in the repo or codebase. Handled by Maia in Slack.

Examples:
- Editing screens, components, hooks, or utilities
- Refactoring or wiring flows
- Running tests and fixing logic
- Staging, build, and deployment tasks
- Architecture analysis and code review
- PR creation, repo documentation, and knowledge base updates

Behavior: Maia handles it directly. Reports what changed, what was tested, and what needs review or approval.

### Browser Task
Work that lives in a third-party dashboard, admin panel, or requires authenticated browser interaction. Routed to Manus.

Examples:
- Stripe dashboard setup or configuration
- Firebase console configuration (auth providers, security rules via UI, extensions)
- Google Cloud console work (API enabling, OAuth consent screens, service accounts)
- Zoom dashboard setup (app creation, webhook configuration)
- Any task requiring live browser login or session-based clicking
- Any settings or config work better done through an authenticated UI

Behavior: Maia does NOT attempt this work. Instead, Maia provides:
1. A short plain-English explanation of what needs to happen
2. The exact prompt to paste into Manus (copy-paste ready)
3. Any credentials, pages, settings, or approvals needed
4. Exactly what to send back to Maia once Manus finishes

### Hybrid Task
Work that requires both code changes and browser configuration. Maia orchestrates the split.

Examples:
- Change app code, then configure something in Stripe dashboard
- Update repo logic, then create or configure something in Firebase or Zoom console
- Set up code side in Slack with Maia, hand off browser steps to Manus, return to Maia

Behavior: Maia splits the task into three clear sections:
1. What Maia does now (code/repo work)
2. What Manus needs to do (browser work) — with exact copy-paste prompt
3. What Maia does after Devin returns from Manus

## Guardrails

- Every response to a GoArrive task MUST start with a label: "Code task", "Browser task", or "Hybrid task"
- Do not make Devin guess which tool to use
- Do not attempt browser-heavy dashboard work through Slack if Manus is the better tool
- Do not leave handoffs vague — Manus prompts must be complete and copy-paste ready
- Do not describe this routing as optional — it is a permanent operating rule

## Default Mindset

- Repo/code = Maia in Slack
- Browser/dashboard/configuration = Manus
- Mixed = Maia orchestrates the split with clean handoffs
- Optimize for clarity, speed, low friction, and low wasted credits
