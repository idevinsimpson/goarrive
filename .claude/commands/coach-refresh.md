---
description: Rebuild a saved persona with fresh research
argument-hint: <name>
---

# /coach-refresh

Target: **$ARGUMENTS**

Rebuild from scratch. Ignore the cached file for research purposes — the point is to pick up what has
changed, so re-running the same searches and re-reading current sources is the whole job.

1. Slugify. Read the existing file only to note its `builtAt`.
2. Re-research fully per `skills/persona/SKILL.md`.
3. Overwrite `.claude/personas/<slug>.json` with a new `builtAt`.
4. Report what actually changed — new positions, shifted confidence, sources that died.
5. If the persona was active, stay in it with the refreshed file.
