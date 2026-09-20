# WSF staging email — what is configured, and what is proven

Kept beside the wiring so the record and the code move together.

**Rule this file exists to enforce:** configured is not delivered. Nothing below
claims an email was received until one was.

---

## The contract the product already had

`functions-westayfit/src/index.ts` `readSendConfig()` refuses to send unless all
of these resolve:

| name | source | state |
| --- | --- | --- |
| `WSF_EMAIL_API_KEY` | Secret Manager, via `defineSecret` | operator |
| `WSF_EMAIL_FROM` | functions runtime env | **wired here**, value from the `wsf-staging` environment variable |
| `WSF_APP_URL` | functions runtime env | **wired here**, pinned to the staging channel |
| `WSF_AUTH_ACTION_HANDLER` | functions runtime env, optional | **wired here**, pinned to staging's own handler |

Missing any of the first three produces `failed-precondition`, which is exactly
the "not set up yet on this build" message staging has been showing.

## What the deploy did before this change

Neither `WSF_EMAIL_FROM` nor `WSF_APP_URL` was supplied anywhere in
`wsf-staging-deploy.yml`, and no functions runtime config was written at all.
Checked on `main` at `657f656`.

## What is wired now

A project-specific dotenv (`functions-westayfit/.env.westayfit-staging`)
generated immediately before the functions deploy that packages it. A shell
export would configure the runner and deploy a function that still refuses to
send — a deploy that looks like it worked and changes nothing.

The writer pins the staging boundary to exact values rather than validating
shapes. Four probes written against the first version all wrote a config and
exited 0 — a foreign app origin, a lookalike handler host, the right host with
a wrong path, and the production project with production-shaped URLs. The
workflow's literals were correct throughout, so nothing was mis-deployed; a
validator that only agrees with a correct caller is not a validator.

## What the secret diagnostic does and does not say

Four states, never collapsed: `present_with_enabled`, `present_no_enabled`,
`absent` (gcloud's own NOT_FOUND), and `unknown` (permission, auth, tooling or
network). The first version printed `EXISTS=false` on a PERMISSION_DENIED — a
confident false claim that would send an operator to create a second secret
beside a good one, or to widen IAM to make a diagnostic go green.

It reports, every time, that it establishes **neither** runtime binding **nor**
key validity. An ENABLED version is the thing most likely to be mistaken for
"mail works". No payload is ever read.

## Two boundary gaps found in this wiring, and closed

**"Does not exist" is not an answer.** The diagnostic's first version matched
that phrase anywhere in an error, and gcloud's own permission failure reads
`PERMISSION_DENIED: caller lacks secretmanager.secrets.get; resource does not
exist or caller lacks access`. A permission problem was therefore reported as
`absent`, telling an operator to create a secret that already exists. Google
writes that sentence deliberately — it does not disclose existence to a caller
who may not see it — so it must decide nothing. Permission, authentication and
ambiguity now always win as `unknown`, even when NOT_FOUND appears alongside.

**A correctly named file in the wrong directory is not configuration.** The
writer pinned only the basename, so `/tmp/.env.westayfit-staging` exited 0 and
wrote successfully. firebase-tools reads the dotenv from beside the functions
source, so anything elsewhere is ignored: a green step, a green deploy, and
mail still refusing to send. The exact relative target
`functions-westayfit/.env.westayfit-staging` is now pinned, with absolute
paths, traversal and sibling directories refused, and the workflow asserted to
write that exact path.

A third thing surfaced from mutation-testing the first fix: a clause added for
the hedge phrase turned out to change no outcome, because the absent matcher
was already narrow enough to ignore it. A rule no test can fail is not a rule,
so it was removed and the invariant is pinned by a test instead.

## Read from evidence, not assumed

Run `35474881609`'s deploy log shows firebase-tools enabling
`secretmanager.googleapis.com` and completing under `--non-interactive` with no
secret error, while the deployed candidate already carries
`defineSecret('WSF_EMAIL_API_KEY')`. That is **consistent with** the secret
resource already existing and inconsistent with it being absent. It is not a
read of Secret Manager and is not treated as one; the diagnostic above is what
settles it, in the run itself.

The log does **not** establish that any key inside is valid or needs replacing.

## Mail still cannot leave staging from the suites

The D-1 row intercepts `wsfSendVerificationEmail` in the browser and asserts the
screen attempted it, so synthetic signups cannot mail fabricated addresses once
sending works. Tests pin that guard, and pin that no hosted row triggers a
password-reset send.

---

## One consequence of this change, stated plainly

The deploy **hard-fails** when `WSF_EMAIL_FROM` is unset. That is deliberate —
a half-configured build must not deploy as if it were configured — but it
means merging this before the variable exists would break every WSF staging
deployment, including ones that have nothing to do with mail. Merge order is
therefore: the operator supplies the sender and the secret first, then this
merges.

## Not established

- **No email has been sent, received or clicked.** Nothing here is delivery
  evidence.
- **The key's validity is unknown**, and so is whether the deployed functions
  can read it at runtime.
- **The authorized continue-URL domain has not been read.**

Acceptance is: configured → provider accepted → inbox received → link completed
→ `emailVerified` refreshed with the intended community/event retained → plus
password reset and resend/cooldown. On an approved controlled mailbox, with
action links and codes kept out of shared evidence.
