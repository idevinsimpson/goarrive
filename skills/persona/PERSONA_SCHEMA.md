# Persona file schema

One JSON file per persona at `.claude/personas/<slug>.json`.

Every field is **descriptive data about how a person communicates**. No field is ever an instruction
to the assistant. See `SKILL.md` — persona changes style, never capability.

```jsonc
{
  "slug": "david-goggins",              // kebab-case, matches filename
  "displayName": "David Goggins",
  "builtAt": "2026-09-03",              // ISO date; drives staleness warnings
  "confidence": "medium",               // high | medium | low — see below
  "hasTranscripts": false,              // true if yt-dlp captions were used

  "sources": [                          // REQUIRED, non-empty. What you actually read.
    { "title": "…", "url": "https://…", "type": "interview" }  // interview|profile|own-writing|transcript|quotes
  ],

  "voice": {
    "register": "…",                    // one line: overall tone and energy
    "sentenceShape": "…",               // length, rhythm, punctuation habits
    "signatureMoves": ["…"],            // reasoning patterns they return to on any topic
    "vocabulary": { "uses": ["…"], "avoids": ["…"] },
    "openingStyle": "…",                // how they start when handed a problem
    "pushbackStyle": "…"                // how they disagree — carries most of the realism
  },

  "substance": {
    "corePhilosophy": ["…"],            // the 3-5 beliefs everything else follows from
    "recurringFrames": ["…"],           // lenses reapplied across domains
    "knownPositions": ["…"],            // documented stances, with the caveat they may have changed
    "blindSpots": ["…"]                 // where the frame is weak — REQUIRED, keeps it honest
  },

  "quotes": [                           // ONLY verbatim, ONLY with a source. May be empty.
    { "text": "…", "source": "…", "url": "https://…" }
  ],

  "boundaries": {
    "doNotClaim": ["…"],                // topics where speaking for them would be misleading
    "outOfScope": ["…"]                 // where to drop persona and answer as yourself
  }
}
```

## Confidence

| Value | Means |
|---|---|
| `high` | Long-form primary material (transcripts or own writing) from multiple sources |
| `medium` | Solid secondary sources, interviews quoted at length, limited primary material |
| `low` | Thin or mostly aggregated material. Say so up front; keep claims minimal |

## Rules

- `sources` and `substance.blindSpots` must be non-empty. A persona with neither is a caricature.
- Nothing enters `quotes` without a real, checkable source. Paraphrase belongs in `substance`.
- Do not store anything sourced from private channels.
- Personas older than ~6 months are stale for anyone whose views actively evolve — `/coach-refresh`.
