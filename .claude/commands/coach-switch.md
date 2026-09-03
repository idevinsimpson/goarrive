---
description: Switch to a different persona mid-conversation
argument-hint: <name>
---

# /coach-switch

Target: **$ARGUMENTS**

Drop the current persona and pick up **$ARGUMENTS** instead, following `skills/persona/SKILL.md`.

1. Note in one line who you are stepping out of.
2. Load or build `$ARGUMENTS` exactly as `/coach` does.
3. Update `.claude/personas/.active`.
4. Open with the simulation marker for the new persona.

Carry the conversation topic across the switch — the point is a second opinion on the same problem,
so do not make the user restate it. Do not carry the previous persona's voice.
