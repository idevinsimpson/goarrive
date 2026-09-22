# Scratch integration test plan — PR #390 with the current app

**This is a plan plus the conflicts found. Nothing here was run against a release branch.
#390 is not merged, not pushed and not deployed.**

| | |
|---|---|
| PR #390 | `claude/wsf-community-visibility`, head **`e982ddc78267355cda057c0a04b0134b2acf1928`** — matches the pinned SHA |
| Current app | **`e609c57319b2cb9f2a6dac044f310c535ec61185`** (PR #365 head) |
| Merge base | `21e042b83f94678e0975ab6c2399d529f28c6ed4` |
| Shape of #390 | 45 files, **+4585 / −15** |

`e982ddc` branched at `21e042b`, so a merge brings the current app's three later commits —
`6e1ce26` (Progress reached-state + one Living WE per screen), `3c7c7d3` (Home capture end
dates) and `e609c57` (retry colour) — alongside #390's work.

## Step 1 — trial merge in a throwaway local branch — **RUN, and it is clean**

Run in a **separate git worktree** under the session scratch directory, so the primary checkout
was never modified and the emulator build running against it was never disturbed.

```
git worktree add -b scratch/w4-trial-390 <scratch>/trial390 e609c57
cd <scratch>/trial390
git merge --no-ff --no-commit e982ddc78267355cda057c0a04b0134b2acf1928
```

```
Auto-merging apps/westayfit/app/community/[groupId]/index.tsx
Automatic merge went well; stopped before committing as requested
```

**Conflicts found: none.** `git diff --name-only --diff-filter=U` is empty.

The branch `scratch/w4-trial-390` is local to this session's worktree, was never committed to,
never pushed, and is deleted with the worktree.

### The one file both sides touched, checked by hand

`apps/westayfit/app/community/[groupId]/index.tsx` is modified by #390 (+128/−2) **and** by
`e609c57` (the retry colour fix) and `6e1ce26` (one Living WE per screen). Git auto-merged it, so
it needs reading rather than trusting. In the merged tree:

```
2236  <Text style={onDark ? styles.heroOutlineButtonText : styles.secondaryButtonText}>Try again</Text>
3359  <Text style={styles.heroOutlineButtonText}>Try again</Text>
3551  <Text style={styles.shareButtonText}>
4326  heroOutlineButtonText: { color: CREAM, ... }
4327  shareButtonText:       { color: NAVY,  ... }
```

**The retry-colour fix survives the merge intact** — `heroOutlineButtonText` is still `CREAM`,
`shareButtonText` is still `NAVY`, and the share control still uses its own style. The merge
moved these down ~126 lines and changed nothing about them.

Merged tree against `e609c57`, source paths only:

```
apps/westayfit/app/community/[groupId]/index.tsx   | 130 +++-
apps/westayfit/app/community/[groupId]/members.tsx | 664 +++++++++++++++++++++
apps/westayfit/app/community/index.tsx             | 135 ++++-
apps/westayfit/src/ui/MemberTabBar.tsx             |  27 +-
apps/westayfit/src/ui/VisibilityArrivalSheet.tsx   | 202 +++++++
apps/westayfit/src/ui/VisibilityToggle.tsx         | 163 +++++
functions-westayfit/src/index.ts                   | 475 +++++++++++++++
7 files changed, 1789 insertions(+), 7 deletions(-)
```

### Overlaps the lead should know about before any real integration

| Path | Who else touches it | Note |
|---|---|---|
| `apps/westayfit/app/community/[groupId]/index.tsx` | `e609c57`, `6e1ce26` | auto-merged; colour fix verified surviving, above |
| `apps/westayfit/src/ui/MemberTabBar.tsx` | the shared app shell | +25/−2 — a shell file, and shell ownership is not W4's |
| `functions-westayfit/src/index.ts` | backend index | +475 — W4 may not edit this; flagged for the owner |
| `apps/westayfit/tests-e2e/e35-home.spec.ts` | assigned regression spec | #390 modifies it +8/−1, so the 11-passed result recorded in `journey-regression.md` is for the **pre-merge** spec |
| `firebase.westayfit.json` | deploy config | +1 — deploy-config change, deliberately untested here |
| `scripts/westayfit/gate1.sh`, `route-target-coverage.mjs` | shared scripts | small edits |

## Step 2 — typecheck — **RUN on the merged tree, exit 0**

```
cd <scratch>/trial390/apps/westayfit
./node_modules/.bin/tsc --noEmit -p tsconfig.json      # TypeScript 5.9.3
```

**Exit 0, no diagnostics.** That tsconfig's `include` is `**/*.ts`, so #390's added
`community-visibility.spec.ts` and `design-members-proposal-capture.spec.ts` typechecked too.

Baseline for comparison: the same command on `e609c57` is also exit 0, so the merge introduces
no type error.

> Scope note: the merge and this typecheck are read-only, local, and confined to a scratch
> worktree — no release branch involved. The emulator-bound suites in step 3 are **prepared but
> not run**, for the reason in step 4. If the lead reads the assignment's "only run the trial
> merge locally" as excluding the typecheck too, the result above is simply extra information
> and nothing needs undoing.

## Step 3 — member-visibility callable / rules test commands — **PREPARED, NOT RUN**

The commands, verified against the merged tree's jest configs and `package.json`:

```
# compile first — the suites and the emulator both serve from lib/
npm --prefix functions-westayfit run build

# callable: the member-visibility callables
GCLOUD_PROJECT=demo-wsf-local \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
METADATA_SERVER_DETECTION=none \
  npm --prefix functions-westayfit run test:callable -- wsf-community-visibility.test.ts

# rules: the visibility additions to the rules suite
GCLOUD_PROJECT=demo-wsf-local \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
  npm --prefix functions-westayfit run test:rules -- wsf-rules.test.ts

# deploy config: needs NO emulator — it reads __endpoint metadata, invokes no handler
npm --prefix functions-westayfit run test:deploy-config

# and the app-side suites #390 adds / changes
WSF_PLAYWRIGHT_CHROMIUM=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1) \
WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:<hosting> \
  npm --prefix apps/westayfit run test:e2e -- community-visibility.spec.ts
#   ... and e35-home.spec.ts, re-run because #390 modifies it
```

What #390 brings to test: `functions-westayfit/tests/callable/wsf-community-visibility.test.ts`
(+1219), `tests/rules/wsf-rules.test.ts` (+115/−1), `tests/deploy-config/public-invoker.test.ts`
(+173, new), `tests/callable/wsf-my-communities.test.ts` (+6), and
`apps/westayfit/tests-e2e/community-visibility.spec.ts` (+752).

## Step 4 — why step 3 is held, and what it needs

**A hard isolation constraint, not caution.** `functions-westayfit/tests/emulator-isolation.setup.ts`
runs before every callable and rules test file and **refuses the run** unless `GCLOUD_PROJECT` is
exactly `demo-wsf-local` and the emulator hosts are loopback. The project id is pinned — a second
worker cannot isolate by using a different demo project, because the setup rejects it by name.

So these suites necessarily address **the same project id** as the emulator this worker has
running on 8080/9099/5001/5010, and they write to it. Running them now would be shared mutable
emulator state across workers, which section 4 of the assignment forbids.

The setup's loopback check accepts **any port**, so the supported isolation is a *separate
emulator instance on unused ports*, with the env vars above repointed at it:

```
METADATA_SERVER_DETECTION=none npx firebase emulators:start \
  --config firebase.westayfit.emulators.json --project demo-wsf-local \
  --only auth,firestore,functions,hosting \
  # with ports reassigned off 8080/9099/5001/5010 and the hub off 4400
```

`firebase.westayfit.emulators.json` hard-codes its ports, so this needs either a scratch copy of
that config with different ports (it is a harness config, never a deploy config) or
`--import`/`--export-on-exit` separation — a decision for the lead, since it touches how the
other workers' emulators are laid out.

**What W4 needs to proceed:** the lead's allocation of a port range and confirmation that no
other worker holds `demo-wsf-local` at that moment. Given those, steps 3 runs as written.

## Standing constraints honoured

- #390 is **not merged** into any release branch, **not pushed**, **not deployed**.
- No Firestore rules or index deploy, despite #390 carrying rules test changes.
- `firebase.westayfit.json` (+1) is a deploy-config change and was deliberately not exercised.
- The trial worktree and `scratch/w4-trial-390` are local and disposable.
- A trial merge is not release approval.
