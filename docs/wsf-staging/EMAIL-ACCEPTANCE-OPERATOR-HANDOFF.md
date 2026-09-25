# WSF staging — email acceptance, operator handoff packet

**Scope: `westayfit-staging` only.** Nothing in this document applies to, or may be run
against, a production project or a production account.

**Who runs this.** An **owner-designated browser operator** — a person, or an agent the
owner has separately authorized — using its own already-authorized browser, **never a
tunnel around this environment's proxy**. Being designated is what confers authority here,
not being human and not being an agent. Approval to read this document is not approval to
run it.

**No automated agent is assigned by this document.** It assigns nobody. It names no
service, no scheduled job and no AI session as the operator, and it does not make any
party's designation true by describing one. The designation is the owner's to make and to
record elsewhere; until it exists and is acknowledged, nobody runs this.

Separately: a session that cannot reach the staging hosts cannot run it whatever its
designation — see [Why a browser operator](#why-a-browser-operator). That is a statement
about reachability, not about who is eligible.

**One operator at a time.** The mailbox and the staging-only send/reset authorization are
already recorded privately with the owner. **Do not ask which address**, and do not write
it down anywhere. If you are reading this and were not handed the mailbox, you are not the
operator.

---

## Why a browser operator

The two flows below can only be exercised by something that can reach the staging site,
the Firebase auth action handler and the staging callables. Agent sessions on this
program's container are denied CONNECT to all three by the environment's network policy —
measured independently from two separate sessions (the lead's, and this worker's; see the
PR body for the exact probe). That is a policy, not an obstacle to route around: no
tunnel, no alternate proxy, no DNS trick.

There is one tempting wrong path, recorded here so nobody rediscovers it as a good idea.
`identitytoolkit.googleapis.com` **is** reachable, and `accounts:sendOobCode` on it would
send mail. That is **Firebase's own email**, not the WSF path. It exercises neither
`wsfSendVerificationEmail`, nor `wsfSendPasswordResetEmail`, nor Resend, nor the
`westay.fit` sender — so a green result there would be a false positive about precisely
the thing under test. Do not substitute it.

---

## What this test does and does not establish

**It establishes:** that a real message, sent by the WSF callable through the configured
provider, arrives in a real inbox; and that the link in it completes the flow in the real
product.

**It does not establish** which Secret Manager *version* supplied the key. A delivered
message proves only that the key the running instance held was accepted by the provider —
several versions could each carry a key that would succeed. Live secret-version binding is
a separate track (PR #393). **Keep the two findings separate in your report.** Do not let
"the email arrived" become a claim about version 2.

---

## Before you start

| | |
| --- | --- |
| **Staging site** | `https://westayfit-staging--staging-4a616y5m.web.app/` |
| **Browser** | An ordinary browser. Use a **private/incognito window** so no existing session interferes. |
| **Mailbox** | The one recorded privately with the owner. Have it open in a second tab. |
| **Clock** | Note times in **UTC**, to the nearest minute. Approximate is fine and expected. |

Two outcomes are worth recognising before you meet them, because they are *the build
telling you the truth*, not failures on your part:

- **"Email isn't switched on for this test build…"** — the callable threw
  `failed-precondition` because the mail environment variables are unset on the deployed
  function. **Stop and report it.** It means the configuration half is not live; there is
  nothing for you to retry.
- **"Please wait Ns…"** — the per-account (verification) or per-address (reset) quota.
  Wait it out. Do not open a second browser or a second account to get around it.

---

## Part A — verification

### A1 · Create the account

1. Open the staging site in a private window.
2. Reach **Create your account** (`/signup`). Heading: **“Start moving together.”**,
   marked **Step 1 of 3**, with the line *“You'll need to verify your email before you can
   join a community.”*
3. Fill **Display name**, **Email** (the recorded mailbox), **Password** — at least 8
   characters, as the hint under the field says.
4. Press **Create account**.

The product moves you to the verification gate as soon as the account exists, and the send
happens behind that move. So **you will land on the next screen before the send finishes** —
that is by design, not a glitch.

**Record:** approximate UTC time of the press. This is your send time for the verification
message.

### A2 · The verification gate

You are now on `/verify-email`, **Step 2 of 3**. Read the heading, because it tells you
which outcome you got:

| Heading | What it means | What to do |
| --- | --- | --- |
| **“Check your email.”** | A send was attempted. | Continue to A3. |
| **“Verification is switched off here.”** | `failed-precondition` — mail is not configured on the deployed function. | **Stop.** Record it and report. Do not press anything further. |

On the working path the screen also offers **Resend verification email** and
**I have verified**. Do not press **Resend** unless nothing arrives after a reasonable
wait — each press is a real send and consumes quota.

**Record:** the exact heading you saw.

### A3 · The message

Watch the mailbox. Expect subject:

> **Confirm your email for We Stay Fit**

**Record:** whether it arrived (yes/no), roughly how long it took, the subject line
exactly as shown, and the **sender domain only** — the part after the `@`. Not the whole
address.

If your mail client or the provider's dashboard shows an accepted/rejected status for the
send, record that too. If it shows nothing, write *not visible* — that is a real and
useful answer.

### A4 · Complete the link

Open the link **from the mailbox**, in the same private window. It goes to the Firebase
auth action handler, which confirms the address.

**Record:** whether the handler confirmed it, or showed an error (record the error's
wording, not the URL).

### A5 · Confirm `emailVerified`, and that the destination survived

Return to the staging tab on `/verify-email`.

- If the screen has already moved you on by itself, that **is** the confirmation — the gate
  re-checks auth state on its own.
- Otherwise press **I have verified**.

**Pass** is: you leave the gate. A brand-new account lands on **Complete your profile**
(`/profile-setup`, **Step 3 of 3**, headed **“What should we call you?”**). Seeing
*“Still unverified. Check your inbox and try again.”* means it has not taken yet — wait a
moment and press once more.

**The destination check.** If you arrived at signup carrying an intended destination — a
join link, a QR code, an event return — the verify screen shows a card headed
**“Still waiting for you”**, noting *“It survives this step and the next one. You will land
on it, not on home.”* **Record whether that card was present through the gate, and whether
you actually landed on that destination** rather than on home after finishing the profile.

If you started with no such destination, there will be no card. Write *no destination
carried* — do not invent one to test with.

**Record:** where you landed; whether the destination card was present; whether the
destination was honoured.

---

## Part B — password reset

Do this **after** Part A has an outcome, not alongside it.

### B1 · Request the reset

1. Sign out, or use a fresh private window.
2. Go to **Sign in**, then **Forgot your password?** → `/reset-password`. Heading:
   **“Set a new password.”**, with *“Enter your email and we will send a link to set a new
   one.”*
3. Enter the same recorded address. Press **Send reset link**.

**Expected:** *“If an account exists for that email, a reset link is on its way. Check your
inbox and spam.”*

**That wording is deliberate and is not a confirmation.** The callable is
enumeration-protected: an unknown address, a malformed address and a real send all return
the same shape. **The screen cannot tell you the send happened** — only the mailbox can.
Do not report "reset sent" on the strength of this sentence.

If instead you see *“Email isn't switched on for this test build yet, so no reset link was
sent.”*, that is the `failed-precondition` path again — stop and report.

**Record:** approximate UTC time of the press, and which of the two messages you saw.

### B2 · The message

Expect subject:

> **Reset your We Stay Fit password**

The message says the link expires in an hour, so do not leave it overnight.

**Record:** arrived yes/no, time taken, subject line, sender domain only, and any visible
provider accepted/rejected status (or *not visible*).

### B3 · Complete the reset and sign in

1. Open the link from the mailbox. Choose a new password (8+ characters).
2. Return to the staging site, go to **Sign in**, and sign in with the **new** password.

**Pass** is: you are signed in. Failure looks like the sign-in error that offers
**Reset password** and **Create account** — record its wording if you hit it.

**Record:** whether the reset completed, and whether sign-in with the new password
succeeded.

---

## What to record — the whole list

For **each** of the two flows:

- [ ] approximate **UTC** time the send was triggered
- [ ] the **subject line**, exactly
- [ ] **provider accepted / rejected**, if visible anywhere — otherwise *not visible*
- [ ] **inbox received: yes / no**, and roughly how long it took
- [ ] whether the **end-to-end flow succeeded** — link completed, and the product moved on
- [ ] the exact wording of any error or unexpected screen

And once, for Part A:

- [ ] whether `emailVerified` took effect (you left the gate)
- [ ] whether an intended destination was carried, and whether it survived

### Optional, and only if your existing console permissions already allow it

- [ ] the current **function / serving-revision secret-reference metadata** — resource and
      variable **names and version numbers only**. **No payloads, no environment dumps, no
      writes**, and do not acquire access you do not already have in order to look.

This is an **independently sourced receipt** and is reported **separately from delivery**.
It is not part of the acceptance, it is not required for a pass, and it neither confirms
nor substitutes for the delivery result above. Skip it entirely if in any doubt — a missing
optional receipt costs nothing, and a widened permission to obtain one costs a great deal.

---

## What NOT to publish

Never write any of these into a PR, an issue, a comment, a commit, a screenshot or a log:

- **The mailbox address**, in whole or in part. The sender **domain** (after the `@`) is
  fine; a local part never is.
- **The verification or reset link**, any `oobCode`, `continueUrl`, or any query string
  from those links. A reset link is a live credential until it is used or expires.
- **Any password**, old or new.
- **Any API key, secret value or secret payload.** Nobody needs one to run this.
- **Raw screenshots of the mailbox or of the action-handler URL bar.** If a screenshot is
  genuinely needed, crop to the subject line and redact the address and the URL.
- Message **headers or raw source**, which carry the recipient.

Report the *shape* of what you saw, not the artifacts. "Subject `Reset your We Stay Fit
password` arrived ~14:32 UTC, roughly 40 seconds after the press, from the `westay.fit`
domain; link completed; signed in with the new password" is a complete finding and leaks
nothing.

---

## Cleanup

When both parts have an outcome:

1. **Sign out** of the staging site and close the private window.
2. **Retain both messages** — the verification and the reset. Do not delete them, and do
   not empty Trash/Bin to remove them. The owner authorized a test, not deletion from
   their mailbox; the messages are the delivery evidence, and whether they are cleaned up
   later is the owner's call on separate request. Both links stay live until used or
   expired, which is a reason to keep them **unpublished**, not a reason to destroy them —
   see [What NOT to publish](#what-not-to-publish).
3. Leave the **staging account in place** unless the owner asks otherwise. It is the
   evidence that the flow worked, and deleting it costs the next run a fresh signup. If
   the owner does want it removed, that is an owner action in the Firebase console, not
   an operator one.
4. **Do not rotate, disable or re-create any secret**, and **leave secret version 1
   enabled**. Nothing in this test requires a secret change.
5. Hand the recorded fields back to the owner / Program Director. Keep the two findings
   separate: *mail delivery* here, *secret-version binding* on PR #393.
