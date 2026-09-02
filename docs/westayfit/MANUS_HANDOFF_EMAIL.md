# Manus Handoff — WSF verification email, dashboard configuration

**Created:** 2026-09-02 · **Task class:** Stateful Dashboard (per `.claude/agent-task-routing.md` §3)
**Paired code work:** branch `claude/westay-fit-takeover-cont-c6ye55` @ `452834c`, already written and pushed.

Everything below is browser work inside dashboards where Devin is already
logged in. None of it is code. The code side is done and waiting on exactly
these values.

---

## Copy everything below this line into Manus

---

You are completing the dashboard configuration for **We Stay Fit (WSF)**, a
product inside Devin Simpson's existing Firebase project. The code is already
written and tested; it cannot ship until these dashboard steps are done.

### Background, so the steps make sense

WSF members sign up with email and password and must verify their address
before they can do anything. Two separate faults currently make that
impossible, and each one hid the other:

1. WSF was relying on Firebase Auth's **built-in** email sender. Mail never
   arrives. GoArrive (the sibling product in the same Firebase project) long
   ago stopped using it and sends through **Resend** instead.
2. Even when the link was delivered by hand, it was **dead** — the project's
   Auth "action URL" points at a route that does not exist.

The code fix sends verification mail through Resend directly and repoints the
link at Firebase's default handler, which does work. It is finished. It
refuses to run until it is configured, deliberately, because guessing a sender
domain would fail DMARC and damage the real domain's reputation.

**Verified fact you should not re-litigate:** the Resend account currently has
exactly **one** verified sending domain, `goarrive.fit`. The domain WSF needs,
`westay.fit`, is **not in the Resend account at all**. Devin owns
`westay.fit` at the registrar, but that is not the same as Resend being
allowed to send as it.

### Hard guardrails — read before touching anything

- **Do not delete, rotate, edit, or revoke** any of the three existing Resend
  API keys (`GoArrive.fit`, `GoArrive App`, `Onboarding`). GoArrive's live
  production email runs on those. Create a new key; touch nothing existing.
- **Do not remove or modify the `goarrive.fit` domain** in Resend.
- **Do not change** the Firebase Auth action URL, email templates, or any
  other project-level Auth setting. Several are shared with GoArrive and
  changing one silently changes the other product. Step 6 asks you to **read
  and report** one such setting. Report it. Do not fix it.
- **Never paste the API key into Slack, a chat message, a document, a
  screenshot, a commit, or a code file.** It goes from the Resend dashboard
  into Google Secret Manager and nowhere else. This repository has already had
  one live credential reach a public branch; do not create a second.
- If a step cannot be completed, **stop and report the blocker**. Do not
  substitute a different value or a different domain to get past it.

---

### Step 1 — Resend: add `westay.fit` as a sending domain

Resend dashboard → **Domains** → **Add Domain**

- Domain: `westay.fit`
- Region: **us-east-1** (match the existing `goarrive.fit` domain)
- Click tracking: **off**
- Open tracking: **off**

Tracking is off on purpose. This domain sends account-verification mail, not
marketing, and tracking pixels on a security email are an unnecessary privacy
surface.

Resend will immediately show a set of DNS records (typically an MX and a TXT
for the `send.` subdomain, plus a DKIM TXT record). **Capture all of them
exactly** — name, type, value, priority. Do not retype them from memory or
from a screenshot; copy the values.

### Step 2 — DNS: publish those records

Find where `westay.fit`'s nameservers actually point (the registrar, or
Cloudflare / Route 53 / wherever DNS is really managed) and add the records
from Step 1 **exactly as Resend displays them**.

Two things to be careful about:

- Some DNS providers auto-append the domain to the record name. If Resend says
  the name is `send.westay.fit` and your provider already appends `.westay.fit`,
  enter `send` — not `send.westay.fit`. Getting this wrong produces
  `send.westay.fit.westay.fit` and verification silently never completes.
- If `westay.fit` already receives email (Google Workspace, etc.), **do not
  touch the existing MX records on the root domain.** Resend's MX record lives
  on the `send.` subdomain and does not conflict with them.

Optional but recommended: if there is no DMARC record on `westay.fit`, add a
TXT record at `_dmarc` with value `v=DMARC1; p=none; rua=mailto:<an address
Devin monitors>`. Starting at `p=none` means it reports without rejecting
anything, which is the safe first setting.

### Step 3 — Resend: verify the domain, then create a WSF-scoped API key

Return to Resend → Domains → `westay.fit` → **Verify**.

DNS propagation can take anywhere from a few minutes to a few hours. If it
does not verify on the first attempt, wait and retry rather than changing
records. If it still fails after roughly an hour, report exactly which records
Resend says are unverified.

Once verified, Resend → **API Keys** → **Create API Key**:

- Name: `WSF Verification Email`
- Permission: **Sending access** only (not full access)
- Domain: restrict it to **`westay.fit`** if the option is offered

A separate, narrowly-scoped key matters here: if it ever leaks, the blast
radius is WSF verification mail rather than all of GoArrive's production
email.

**The key is shown exactly once.** Copy it and go straight to Step 4. Do not
store it anywhere else along the way.

### Step 4 — Google Cloud: store the key in Secret Manager

Google Cloud Console → project **`goarrive`** → **Security → Secret Manager**
→ **Create Secret**

- Name: `WSF_EMAIL_API_KEY` (exact, case-sensitive — the code looks for this
  literal name)
- Secret value: the Resend key from Step 3
- Replication: automatic

The deployed function reads this through Firebase's secret binding. Nothing
else needs to be configured here.

*If the later deploy fails with a permissions error on this secret*, the fix
is granting `roles/secretmanager.secretAccessor` to the Cloud Functions
runtime service account — but do not pre-emptively change IAM. Report it and
it will be handled.

### Step 5 — Firebase Console: confirm the authorized domain

Firebase Console → project `goarrive` → **Authentication** → **Settings** →
**Authorized domains**

Confirm that **`westayfit-app.web.app`** appears in the list. If it does not,
add it.

Why this matters: the verification link carries a "continue URL" pointing at
the WSF app, and Firebase **rejects** a continue URL whose domain is not on
this list. If it is missing, every verification email fails to send — and it
fails *after* the member has already created their account, which strands
them.

Report the full list of authorized domains you see.

### Step 6 — Firebase Console: READ AND REPORT ONLY (change nothing)

Firebase Console → **Authentication** → **Templates** → **Email address
verification** → the pencil/edit icon → look for the **action URL** (sometimes
labelled "customize action URL").

**Report the exact value. Do not change it.**

The expected value is `https://goarrive.web.app/reset-password`, and that
route does not exist — which is the second fault described at the top. The WSF
code already works around it, so nothing needs to change for WSF to ship.

The reason it still matters: this setting is **project-level and shared with
GoArrive**. If it is genuinely broken, then GoArrive's own password-reset
emails are also broken for real paying users, which is a separate incident
that needs Devin's decision — not a fix applied quietly from inside a WSF
task.

---

### What to report back

Please report in exactly this form:

```
STEP 1 — Resend domain added:      yes / no  (+ blocker if no)
STEP 2 — DNS records published:    yes / no  (+ which provider)
STEP 3 — Domain verified:          yes / no / still pending
STEP 3 — API key created:          yes / no  (name + scope, NOT the key)
STEP 4 — Secret created:           yes / no  (confirm exact name WSF_EMAIL_API_KEY)
STEP 5 — Authorized domains:       <paste the full list>
STEP 6 — Auth action URL:          <paste the exact value, unchanged>

Anything unexpected:
```

Two reminders on the report: the API key itself must **not** appear anywhere
in it, and if a step is partly done, say so plainly rather than rounding up to
"yes" — a half-configured email path fails in a way that is much harder to
diagnose than one that never started.

---

## Separate item — not part of the above, but genuinely urgent

Unrelated to the email work, and included only because Manus is the right
agent for it and it should not wait:

A **live Browser Use API key** (prefix `bu_blf…`) is currently sitting in
plaintext on the **public** `main` branch of `idevinsimpson/goarrive`, in
`skills/browser-use-e2e/SKILL.md`. It has been publicly readable for some
time, so it should be treated as harvested. **Deleting it from the file is not
remediation — the key must be rotated at Browser Use.**

If Devin wants that handled in the same pass: log into Browser Use, revoke the
exposed key, issue a replacement, and report that the old one is revoked
(again — do not paste the new key anywhere).
