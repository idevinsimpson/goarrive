# Deliverable 4 — combined runtime (`e609c57` + `e982ddc`)

Assignment: PR #394 comment 5782119754 (lead), Program Director Round 4 §1.

**Nothing here was pushed, merged into a release branch, or deployed.** The merge exists only as
a commit in a scratch `git worktree` in this session's container.

## What was built and tested

| | |
|---|---|
| Parent 1 — app | `e609c57319b2cb9f2a6dac044f310c535ec61185` (PR #365 head) |
| Parent 2 — visibility | `e982ddc78267355cda057c0a04b0134b2acf1928` (PR #390 head) |
| Scratch merge commit | **`301412981b616d96e8996e89082845bb2724bed8`** |
| Merge **tree id** | **`37cfe2c6676b44354e06040955b69ebdf6ffd6f3`** |
| Merge base | `21e042b83f94678e0975ab6c2399d529f28c6ed4` |
| Conflicts | none — `git diff --diff-filter=U` empty |
| Branch | `scratch/w4-trial-390`, local to the worktree, never pushed |

```
$ git rev-list --parents -n1 HEAD
3014129... e609c57319b2cb9f2a6dac044f310c535ec61185 e982ddc78267355cda057c0a04b0134b2acf1928
```

### Build source — rebuilt from the combination, not from either parent

```
rm -rf functions-westayfit/lib && npm --prefix functions-westayfit run build     # exit 0
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 \
  npm --prefix apps/westayfit run build:web                                      # exit 0
```

Both ran **inside the scratch worktree at `3014129`**, so `EXPO_PUBLIC_BUILD_COMMIT` is the merge
commit. Two independent confirmations the artifacts are the combination rather than `e609c57`:

- the web export emits **`community/[groupId]/members.html`**, a route that does not exist in
  `e609c57`;
- the compiled `functions-westayfit/lib/index.js` contains the visibility symbols added by #390.

**No pre-merge result from the baseline packet is reused below.** Every number here is from this
build.

### Isolation

Own container. Before starting, `ss -ltnp` showed **no listening sockets** and no
firebase/firestore/java processes — nothing to collide with. Emulators then started from the
worktree on 8080 / 9099 / 5001 / 5010, project `demo-wsf-local`.
`functions-westayfit/tests/emulator-isolation.setup.ts` was **not modified**; its `demo-wsf-local`
and loopback-only guards stand as written.

---

## Results — per suite, all on `3014129`

| Suite | Config / spec | Result |
|---|---|---|
| callable | `jest.callable.config.cjs` | **484 passed / 484**, 29 suites, 70.9s |
| ↳ visibility alone | `wsf-community-visibility.test.ts` | **52 passed / 52**, 6.8s |
| rules | `jest.rules.config.cjs` | **35 passed / 35**, 1 suite, 12.2s |
| deploy-config | `jest.deploy-config.config.cjs` | **13 passed / 13**, 2 suites, 14.3s |
| browser | `community-visibility.spec.ts` | **18 passed**, 38.4s |
| browser | `e35-home.spec.ts` (the #390 version) | **11 passed**, 17.2s |
| browser | `join-batch-b.spec.ts` | **12 passed**, 9.7s |
| browser | `identity-account-switch.spec.ts` | **2 passed**, 13.5s |
| browser | `ui-app-shell.spec.ts` | **3 passed**, 23.9s |
| browser | `ui-community-home.spec.ts` | **3 passed**, 17.8s |

**Totals: 532 jest tests + 49 browser tests = 581 passed, 0 failed, 0 skipped.** Every suite
exited 0.

The 29 callable files were confirmed by `jest --listTests`; `wsf-community-visibility.test.ts` is
among them, and was additionally run alone to obtain its own count.

### `community-visibility.spec.ts` — 18 passed

Covers the directory (only the member who chose to be named; **no uid in text or any
attribute**; a choice stated rather than a roster, with no count of the hidden; publish and
un-publish surviving reload; the nobody-named state; one non-oracular refusal to a stranger; the
shell marking the page Community not Home; paged Show more in one alphabetical order) and the
arrival sheet (asked once, naming the community; **does not block** — Home behind it and Continue
leaves the member private; does not cover the way out; declining is an answer; accepting
publishes; never re-asked; the sheet and the settings page ask in the same words; **the answer is
per community**).

---

## ⚠️ One defect found — REPORTED, NOT PATCHED

### The emulator harness stops testing what ships for `/community/*/members`

**Severity: medium.** Not a proven user-facing break; a proven **evidence-validity** defect, and a
violation of a sync rule the config file states about itself.

**Files.** #390 adds one line to `firebase.westayfit.json:15`:

```
+ { "source": "/community/*/members", "destination": "/community/__dynamic/members.html" },
```

and adds **nothing** to `firebase.westayfit.emulators.json`, whose own header comment says:

> hosting mirrors firebase.westayfit.json exactly — including the `/community/**` rewrite, which
> is the thing GATE 1 has to prove. **Keep the two in sync: if a rewrite or header changes there,
> change it here, or the harness stops testing what actually ships.**

**Reproduction**, on the combined build with the emulator running:

```
$ curl -s http://127.0.0.1:5010/community/GRP123/members | wc -c
51291                     # == dist/community/__dynamic.html          (Community Home shell)
                          #    dist/community/__dynamic/members.html is 50710 bytes

$ curl -s http://127.0.0.1:5010/community/GRP123/challenge | wc -c
51256                     # == dist/community/__dynamic/challenge.html  (control: works)
```

The members request falls through the missing rule to `/community/**` →
`/community/__dynamic.html`. The challenge control proves the mechanism is otherwise fine.

**Why it passes anyway, and why that is the problem.** `community-visibility.spec.ts` reaches the
page with full `page.goto('/community/<id>/members')` loads (`:126`, `:272`, `:311`, `:445`,
`:554`, `:652`, `:696`, …). Expo Router recovers client-side from the wrong shell, so the suite is
**18/18 green while serving a document production would not serve**. The harness cannot detect the
divergence, which is precisely the failure the config comment warns about: production serves
`members.html`, the emulator serves the Home shell, and no test distinguishes them.

**Suggested fix — for the lead to assign, not applied here.** Add the same rewrite to
`firebase.westayfit.emulators.json`, immediately after the `challenge` rule and **before**
`/community/**` (order matters — `/community/**` would otherwise shadow it):

```
{ "source": "/community/*/members", "destination": "/community/__dynamic/members.html" },
```

W4 did not make this change: `firebase.westayfit.emulators.json` is outside W4's owned paths, and
a proved defect returns to the lead for an exclusive patch assignment. It is a one-line change in
a harness config — no rules deploy, no index deploy, no production config.

---

## Standing constraints

- #390 **not merged** into any release branch, scratch merge **not pushed**, **nothing deployed**.
- `tests/emulator-isolation.setup.ts` untouched; no safety check edited to make anything run.
- No new member page built; `/start-community`, `/goals/new`, `/combined` remain gated.
- No data collection changed.
- Primary checkout untouched throughout — all of this ran in the scratch worktree.
- PR #400 (`ff8c880`) is under review, not accepted, so it was **not** folded in.
