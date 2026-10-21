# W5 probe for PR #390 — how to run it

The probe source is `sprint-w5-390-visibility.probe.ts.txt` in this directory.

## Why it is parked here rather than committed as a test

It exercises `wsfSetCommunityVisibility`, `wsfCommunityMembers` and the
reinstate/rejoin reset paths, which exist only on `claude/wsf-community-visibility`
(#390, head `e982ddc78267355cda057c0a04b0134b2acf1928`). This branch is cut from
`claude/wsf-app-shell` at `e609c57319b2cb9f2a6dac044f310c535ec61185`, where those
callables do not exist, so a committed `.test.ts` would not compile here and would
break the suite for everyone else. The `.ts.txt` extension keeps it out of
`tsc`, out of `testMatch`, and out of the bundler, while leaving the exact source
that produced the recorded results reviewable.

#390 itself was reviewed **read-only**. Nothing was pushed to it, and the probe
ran from a throwaway detached worktree.

## Reproducing the recorded run

```sh
# 1. A detached worktree of the reviewed head. Never check that branch out in place.
git worktree add --detach /tmp/wt390 e982ddc78267355cda057c0a04b0134b2acf1928

# 2. #390 changes no dependency (its package.json and package-lock.json are
#    untouched in the diff), so the installed modules can be shared.
ln -s "$PWD/functions-westayfit/node_modules" /tmp/wt390/functions-westayfit/node_modules

# 3. Emulators, from the repo root, compiled functions first.
npm --prefix functions-westayfit run build
METADATA_SERVER_DETECTION=none npx firebase emulators:start \
  --config firebase.westayfit.emulators.json --project demo-wsf-local

# 4. The probe.
cp docs/westayfit/qa/sprint-w5-390-visibility.probe.ts.txt \
   /tmp/wt390/functions-westayfit/tests/callable/sprint-w5-390-visibility.test.ts
cd /tmp/wt390/functions-westayfit
GCLOUD_PROJECT=demo-wsf-local \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
METADATA_SERVER_DETECTION=none \
  npx jest --config jest.callable.config.cjs tests/callable/sprint-w5-390-visibility.test.ts

# 5. Discard the worktree.
cd - && git worktree remove --force /tmp/wt390
```

Every document the probe writes is keyed on a per-run unique id, so it shares the
emulator safely with other suites and leaves no fixture another run could inherit.

## Recorded result at `e982ddc`

**11 tests, 11 passed, 0 failed.** No defect found in the behaviour probed.

One failure during development was traced to the probe, not the product: the
first version minted a 10-character join code, and `normalizeJoinCode()`
(`functions-westayfit/src/index.ts:87-95`) requires 16–128 base64url characters.
Once the fixture minted a well-formed code the rejoin case passed. It is recorded
here because a fixture bug reported as a product defect is how review time gets
wasted.
