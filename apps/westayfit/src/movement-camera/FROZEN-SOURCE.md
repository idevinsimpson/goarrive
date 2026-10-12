# Frozen camera-counter source — provenance

`frozen/rep-counter-proof/` is the owner-accepted live counter closure of the
frozen Lovable reference **`e15b9fa0-b2a0-4314-bc21-9c573b8eceb1@1454357098b9d066f310aee977455f5024c69d28`**
(`src/lab/rep-counter-proof/`), entered through `r14_2/sessionR142.ts` →
`makeSessionR1421()` (r14.2.1 startup arm + r14.1 gap grace + r13.3 skeleton
phase counter + SubjectLockR14 continuity), plus `core/web/cameraLifecycle.ts`.

- **Never edited, never typechecked.** App code reaches it only through
  `frozen.js` + `frozen.d.ts`, exactly as the reference does.
- **How it got here:** two independent transcriptions from Lovable at that ref
  were byte-identical (`diff -r` clean, 32 files, 6303 lines); the 6 `core/*`
  files are additionally byte-identical to PR #475 `eda58218` in git.
- **Pinned:** `tests/move-camera-counter.test.ts` holds the sha256 of every
  file; one changed byte fails the suite.
- `mediapipeVite.ts` is kept as `mediapipeVite.ts.txt`: it imports the
  reference's Vite asset manifests, which do not exist here. Its
  `BLAZEPOSE_INDEX` / `mapBlazePose` are reproduced in `visual.ts`, and the
  suite holds the two texts equal.

PR #475 is a technical donor only (types, privacy tests, fail-closed ideas);
its `MovementSession` counter is not on the product path.
