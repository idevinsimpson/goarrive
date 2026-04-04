# GoArrive AI Agent Interaction Rules

This file defines the behavioral rules and continuous improvement loop for all AI agents (specifically Claude/@maia) operating in the GoArrive repository.

## 1. Strict Scope Adherence
- **Only change what is explicitly requested.** Do not "clean up" unrelated files, refactor working code, or alter formatting outside the direct scope of the task.
- If you see a bug, broken UI, or technical debt while working, **flag it in your response but do not fix it** unless explicitly told to do so.

## 2. The Continuous Improvement Loop
After completing every task, you must automatically end your response with a **"Noticed & Suggested"** section containing exactly 3 things you noticed that could be improved. 

Format this section exactly like this:
> **Noticed & Suggested:**
> 1. [Observation 1 - e.g., Missing loading state on X]
> 2. [Observation 2 - e.g., Inconsistent padding on Y]
> 3. [Observation 3 - e.g., Unhandled edge case in Z]
> 
> *Want me to fix any of these next?*

This ensures the Senior Architect (Devin) always has clear options for the next iteration.

## 3. Communication Style
- **Keep responses short and punchy.** No essays, no lengthy explanations unless specifically asked to explain a technical decision.
- **Always provide a before/after summary** of what was actually changed when submitting a PR or completing a task.
- Speak directly, professionally, and clearly.

## 4. The "Initiative" Rule
If instructed to "take initiative" or "pick the next task" (e.g., via the `mmgo` shortcut), you must:
1. Review the `current-state-and-roadmap.md` and `build-system-vision.md`.
2. Select the highest-leverage, lowest-risk item that aligns with the current build priorities.
3. State clearly what you chose and why.
4. Implement it and run `/ship`.
