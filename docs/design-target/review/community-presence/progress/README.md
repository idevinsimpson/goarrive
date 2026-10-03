# Progress copy — contribution first (PROPOSED, NOT ACCEPTED)

Director `5798552781` §4, released to W8 on #441 `5799963313`. Wording only, in
`apps/westayfit/app/(tabs)/activity.tsx`.

| Where | Before | Now |
| --- | --- | --- |
| Under the title | "Only you can see this. It is what you have recorded, not a score, and it is never compared with anyone else." | "Your recorded contributions, by goal." |
| Empty title | "Nothing recorded yet" | "Your first contribution will appear here" |
| Empty body | "…it lands here — your part, kept to yourself." | "Add what you did to a goal, and it is recorded here under that goal." |
| Empty + populated foot | "This page is only ever yours" card ("…nobody else can see it.") | one quiet line: "This personal summary is only for you. Community activity follows your visibility settings." |
| Error | body "Nothing has changed — this is the reading, not the record…" **and** a second "Nothing was lost" card | one sentence: "What you recorded is still recorded. This screen could not read it just now." |

The old copy promised "nobody else can see it" three times. That is true of this
summary. It is not true of the member's contributions, which show in community
activity by default. The new line states both halves once.

Unchanged: finished-goal history (REACHED, the Living WE), per-goal units, the
summary that counts goals, the loading / error / partial states, **Start
moving**, **Try again**, **Go to Home**. No privacy default, callable, backend,
shell, tab label or navigation changed.

## Frames

These are real screenshots of the build, taken on the emulator with a synthetic
fixture (spec `apps/westayfit/tests-e2e/sprint-w8-progress-copy.spec.ts`,
`WSF_CAPTURE_FRAMES=1`). The amber strip sits above the screenshot and covers
none of it.

- `PROPOSED-progress-populated-390x844.png` / `-390x640.png`: two running goals in different units, one finished and reached.
- `PROPOSED-progress-empty-390x844.png` / `-390x640.png`: a member with nothing recorded.
- `PROPOSED-progress-error-390x844.png`: the consolidated failure state.

The accepted Page 04 target and AFTER frames (`page-04-progress/`) still show
the old copy. They are frozen evidence and were left byte-identical.
