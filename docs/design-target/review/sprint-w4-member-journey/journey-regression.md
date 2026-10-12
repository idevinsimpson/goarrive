# Join acceptance package — focused journey regression

**Source SHA: `e609c57319b2cb9f2a6dac044f310c535ec61185`** (PR #365 head, `claude/wsf-app-shell`).

Run from `claude/wsf-sprint-member-journey` at `ea84cc9`, whose `apps/westayfit/app`,
`apps/westayfit/src`, `apps/westayfit/tests-e2e` and `functions-westayfit/src` trees are
byte-identical to `e609c57` — that branch adds one docs-only commit and nothing else.
`git diff --stat e609c57 HEAD -- <those four paths>` is empty.

## How it was run

Everything below is the real emulator build, not a mock.

```
npm --prefix functions-westayfit run build                       # emulator serves compiled lib/
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 \
  npm --prefix apps/westayfit run build:web
METADATA_SERVER_DETECTION=none npx firebase emulators:start \
  --config firebase.westayfit.emulators.json --project demo-wsf-local
WSF_PLAYWRIGHT_CHROMIUM=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1) \
WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 \
  npm --prefix apps/westayfit run test:e2e -- <spec>
```

Emulators: Firestore 8080, Auth 9099, Functions 5001, Hosting 5010, project `demo-wsf-local`.
firebase-tools 15.30.2, installed locally under the session scratch directory — not globally,
not with sudo. Chromium `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
`WSF_CAPTURE_FRAMES` and `WSF_CAPTURE_BEFORE` were never set.

One environment note, recorded because it looks like a product defect and is not one: a fresh
checkout has no `node_modules` anywhere, and `npm --prefix functions-westayfit run build` then
resolves `tsc` from a stray global TypeScript **6.0.2** on `PATH`, which fails with
`TS5011: The common source directory ... rootDir must be explicitly set`. After
`npm ci` in `functions-westayfit` the declared TypeScript **5.9.3** is used and the build is
clean. Nothing in the repository needs changing.

## Results — the five assigned specs

All five green. **50 tests, 50 passed, 0 failed, 0 skipped.**

| Spec | Result | Wall |
|---|---|---|
| `join-batch-b.spec.ts` | **12 passed** | 13.4s |
| `batch-a-identity.spec.ts` | **20 passed** | 29.3s |
| `e5-community-goal-seam.spec.ts` | **4 passed** | 38.3s |
| `ui-community-home.spec.ts` | **3 passed** | 19.9s |
| `e35-home.spec.ts` | **11 passed** | 16.1s |

### `join-batch-b.spec.ts` — 12 passed (13.4s)

```
✓  1 :54:7  › a refused code says nothing about which refusal it is, and offers no retry (1.2s)
✓  2 :83:7  › "Try again" makes a real second call, and the second answer is believed (1.3s)
✓  3 :106:7 › the invitation states the joining conditions once, not twice (815ms)
✓  4 :125:7 › signing up from the invitation leaves ONE join screen behind (965ms)
✓  5 :152:7 › a failed join replaces what was read, and leaves the invitation standing (4.6s)
✓  6 :178:7 › a shared screen can be un-shared without leaving the screen (776ms)
✓  7 :279:7 › arrives at the top on a short phone › the invitation, the failure and the join
              in flight all open with the hero on screen (5.7s)
✓  8 :336:9 › arrives at the top on a short phone › the too-many refusal opens with its
              heading on screen (1.4s)
✓  9 :336:9 › arrives at the top on a short phone › the load-failed refusal opens with its
              heading on screen (1.4s)
✓ 10 :368:7 › never renders server text › a preview failure shows stable recovery copy, not
              the callable message (638ms)
✓ 11 :383:7 › never renders server text › a join failure shows stable recovery copy, not the
              callable message (1.8s)
✓ 12 :403:7 › never renders server text › a category the server can really refuse keeps its
              own actionable reason (1.7s)
```

This is the suite the Batch B review held on. The three short-phone arrival guards
(tests 7–9) are the ones added in answer to the 390×640 arrival question, and they pass
on the current head: the invitation, the failure, the in-flight join and both refusal
states all arrive with their hero or heading on screen.

### `batch-a-identity.spec.ts` — 20 passed (29.3s)

Identity is accepted and staged; this run confirms it has not regressed under the app shell.
Includes the three 390×640 reachability cases (signin, signup, reset), the
does-an-account-exist non-disclosure on reset, the poll-isolation case
(`a poll started for one account can never route another`, 16.9s), and the destination
continuity through the verify gate.

### `e5-community-goal-seam.spec.ts` — 4 passed (38.3s)

```
✓ 1 :354:7 › goal loading: loading, failure and Retry, with the Champion control tracked
             throughout (13.7s)
✓ 2 :249:7 › a Champion creates a goal through the interface and an ordinary member
             contributes (29.2s)
✓ 3 :443:7 › a delayed contribution failure cannot overwrite a newer attempt or leak across
             accounts (15.7s)
✓ 4 :562:7 › a delayed contribution SUCCESS cannot double-count or flip a settled receipt (7.8s)
```

**Status change worth the lead's attention.** The Batch B review record carries "the two known
`e5-community-goal-seam` failures" as openly preserved. On this head the suite is **4/4**. The
cause is in `e609c57` itself, not in anything W4 did: its second change repointed the suite's
`signOutVia` helper from `/` to `/you`. Since the app shell landed, `/` opens the member's
community and redirected away mid-click, detaching the control the helper clicked, so those
tests sat through their full timeout. No assertion was removed — the diff adds two and changes
a navigation target. Treat the "two known failures" line as **resolved**, not as suppressed.

### `ui-community-home.spec.ts` — 3 passed (19.9s)

```
✓ 1 :544:5 › a failed pulse read says so on the hero, and its retry can be read (3.6s)
✓ 2 :255:5 › Community Home at phone size — member view, Champion view, full page (14.6s)
✓ 3 :593:5 › Living WE static states through the real data path (14.6s)
```

### `e35-home.spec.ts` — 11 passed (16.1s)

Join-code routing from the signed-out home (well-formed routes, malformed refused without
routing), the in-app-browser banner across Instagram/Safari UAs and the `?wsf_in_app` overrides,
the terms and privacy accordions with their pending-approval version markers, `createdAt`
preservation on profile re-save, and the Private community labelling.

## Evidence integrity

```
$ node scripts/westayfit/check-evidence-intact.mjs
frozen BEFORE: intact — 8 paths, no byte changed
accepted TARGET / AFTER: intact — 16 paths, no byte changed
```

`git status --short` is empty after every run. `artifacts/` and `test-results/` were restored
and cleaned between specs and are not committed. No frozen or accepted PNG was written.

## Typecheck

`npx tsc --noEmit -p apps/westayfit/tsconfig.json` → **exit 0** on this head. That project's
`include` is `**/*.ts`, so `tests-e2e` is covered. W4 added no spec in this package, so this is
the baseline reading rather than a post-edit one.
