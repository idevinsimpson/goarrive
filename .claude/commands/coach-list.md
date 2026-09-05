---
description: List saved personas
---

# /coach-list

```bash
ls -1 personas/*.json 2>/dev/null | xargs -r -n1 basename | sed 's/\.json$//'
cat personas/.active 2>/dev/null
```

For each persona read `displayName`, `builtAt`, `confidence`, `hasTranscripts` and the number of
`sources`. Show a compact table, mark the active one, and flag anything older than ~6 months as
stale with a nudge toward `/coach-refresh`.

If there are none, say so and show the `/coach <name>` form.
