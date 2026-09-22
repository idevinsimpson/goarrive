# Packet 3 — the emulator members-rewrite parity fix

Assignment: PR #394 comment 5783418465 (lead), Director `5783378056` §1.
Deliverable branch: **`claude/wsf-sprint-w4-emulator-members-rewrite`**, head
**`b1fc01bf86541fc27fa03ff757f3bc31f9679fca`**, tree **`5fb0b938bff7cb92818861a73e3df4c3911e2894`**,
cut from `e982ddc78267355cda057c0a04b0134b2acf1928`. Draft PR #405 → `claude/wsf-community-visibility`.

3 files, **+198 / −0**. Nothing deployed, nothing merged.

## The defect this closes

`firebase.westayfit.json` carried `{ "source": "/community/*/members", "destination":
"/community/__dynamic/members.html" }`; `firebase.westayfit.emulators.json` did not. The emulator
config's own header says to keep the two in sync *"or the harness stops testing what actually
ships"*. It had stopped: a cold direct load of `/community/<id>/members` fell through to
`/community/**` and the emulator served the generic community shell where production serves the
members document.

The reason it survived is the reason it needed a test rather than a comment: **Expo Router
recovers client-side from whichever shell it is handed**, so `community-visibility.spec.ts`
passed 18/18 while the server was answering with the wrong document. Nothing in the repository
could tell the two apart.

## The change — one line, same object, same position

```diff
  { "source": "/community/*/challenge", "destination": "/community/__dynamic/challenge.html" },
+ { "source": "/community/*/members",   "destination": "/community/__dynamic/members.html" },
  { "source": "/community/**",          "destination": "/community/__dynamic.html" },
```

Position is load-bearing: Firebase takes the first match, so `/community/**` above the specific
rule would shadow it and restore the bug in a form that looks correct in a diff.

## Reproduced first — `hosting-rewrite-parity.test.ts`

New file in the deploy-config suite, where the hosting-config contracts already live. No emulator
and no handler: it reads both configs off disk.

| | unmodified `e982ddc` | after the fix |
|---|---|---|
| `hosting-rewrite-parity` alone | **2 failed, 13 passed** | **15 passed** |
| whole deploy-config suite | 2 suites / 13 tests | **3 suites / 28 tests, all passed** |

Both failures named the missing rule rather than merely diffing two arrays:

```
● every rewrite matches the deploy config, in the same order
    -     "source": "/community/*/members",
● the emulator carries the shipped rule /community/*/members -> /community/__dynamic/members.html
```

Three assertions, each doing a distinct job:

1. **deep equality including order** — a set comparison would call two differently-ordered
   routers equal, and order is exactly what decides shadowing;
2. **per-rule `test.each`** — so a drift names the route that stopped being tested instead of
   leaving it to be read out of two twelve-element arrays;
3. **the ordering rule stated independently, for both files** — so it still holds if both configs
   are ever changed together in the same wrong way, which parity alone would accept.

## The served document — `sprint-w4-members-rewrite-cold-load.spec.ts`

The assignment asked for proof of the **HTTP response**, not that the client eventually renders
Members. This asserts the response body's bytes against the built members artifact, using
Playwright's `request` fixture so no client JavaScript runs and repairs the answer.

Against the **pre-fix** combined build it fails exactly where it should and nowhere else:

```
✓ the two shells are actually different documents
✘ the response body is the members artifact, byte for byte
✓ the challenge route, which never lost its rewrite, still resolves
✓ the catch-all still serves the community shell for the group itself
1 failed, 3 passed
```

Its first test is a guard against a vacuous pass: were the two shells byte-identical,
`served === members` would hold even when the wrong one came back. `challenge` is the control —
it kept its rewrite throughout, so it isolates the failure to the missing rule rather than to
specific-child rewrites in general. The group route proves the new rule did not narrow the
catch-all.

## Combined verification — after the fix

Combined tree: merge of the fix `b1fc01b` and app `e609c57`, scratch merge commit
**`900a04598047870f51fd46958c4dfd6cec156804`**, tree **`b8f8502ff250b1403035def2f1276b2b74da7da9`**,
**no conflicts**. `functions-westayfit/lib` and the web artifact both rebuilt from that tree.
The retry-colour fix was re-checked as surviving the merge (`index.tsx:4326-4327`).

```
served /community/GRP123/members : 50710 bytes
dist members.html                : 50710 bytes   ← now matches
dist __dynamic.html              : 51291 bytes   ← what it used to serve
```

| Check | Result |
|---|---|
| deploy-config, 3 suites | **28 passed** |
| `sprint-w4-members-rewrite-cold-load.spec.ts` | **4 passed** |
| `community-visibility.spec.ts` | **18 passed** |
| `e35-home.spec.ts` | **11 passed** |
| `join-batch-b.spec.ts` | **12 passed** |

The 581-test Deliverable 4 run was **not** repeated as ceremony, per the packet.

Typecheck after adding the spec: `tsc --noEmit -p apps/westayfit/tsconfig.json` → **exit 0**
(that project's `include` is `**/*.ts`, so `tests-e2e` is covered).

## Second divergence — reported, deliberately not folded in

`hosting.headers` also differs between the two configs. The deploy config carries `/index.html`
and `/_expo/static/js` Content-Type rules the emulator config lacks:

| | deploy config | emulator config |
|---|---|---|
| `/**` — Cache-Control, X-Content-Type-Options, X-Robots-Tag | yes | yes |
| `/index.html` — Content-Type `text/html; charset=utf-8` | yes | **no** |
| `/_expo/static/js` bundles — Content-Type `application/javascript; charset=utf-8` | yes | **no** |

This **predates** the members drift and is outside the bounded packet, so the parity test scopes
to rewrites and says so in a closing comment rather than silently widening.

**Judged, and closed as a seam.** The Product Director's acceptance of this fix
(`5784102622`) rules: *do not widen #405 to repair the pre-existing `hosting.headers`
divergence; record the missing emulator parity for the `/index.html` and
`/_expo/static/js/**` headers as a known integration seam for **M10** unless it produces an
observed failure.* No observed failure exists today — every check in this packet is green, and
the divergence affects Content-Type headers the emulator omits, not routing. So it stays
recorded here and in the parity test's closing comment, and the parity test stays scoped to
rewrites. Extending it to headers remains a one-line change if M10 or an observed failure calls
for it.

## Status after review

**#405 accepted for integration into the #390 visibility DRAFT branch only** (Product Director,
`5784102622`), at this exact head `b1fc01b`. Integration is **L0's** to perform; W4 pushes
nothing further to this branch. The acceptance authorizes no main merge, staging deploy, privacy
release, rules/index/IAM change or production action.

W4's next packet — the Join review-evidence set for `/join/[joinCode]` — is **gated**: it may
begin only after L0 records the integration receipt. Not started.

## Constraints held

- Deployment config, Firestore rules and indexes, IAM and product behaviour all unchanged.
- `tests/emulator-isolation.setup.ts` untouched — no safety check edited to make anything run.
- No merge, no deploy, no broad harness refactor. The combined merge is scratch and unpushed.
- Frozen BEFORE (8 paths) and accepted TARGET/AFTER (16 paths) byte-unchanged.
