# FitLife Expo — Critical Path and Cut Line

**2026-09-05 · PM assessment · Claude Code**
**Event: Sunday 2026-10-11, 12:00–5:00 PM, Alpharetta City Center — 36 days out.**

This exists because nobody had done the arithmetic. The finding is that **the current
roadmap does not fit in the time remaining**, and the useful response is a cut line, not
a faster pace.

Governed by `WE_STAY_FIT_MASTER.md`. Nothing here is approved — §6 is the decision.

---

## 1. The real deadline is not October 11

| Date | Days out | What it is |
|---|---|---|
| **Sep 28** | 23 | **Feature freeze.** Last day new behaviour can land and still be exercised by real people. |
| **Oct 4** | 29 | **Code freeze.** Kiosk setup, content loading, on-site rehearsal, printed QR artwork. |
| Oct 11 | 36 | Event. |

An activation with two kiosks, printed markers, and vendor QR placement cannot take a
code change in its final week. **Treat the engineering deadline as 23 days, not 36.**

---

## 2. What actually exists today

Verified against the tree at `af86745`, not from memory.

**Built and working (M-U2):**
- Adult signup → email verification → profile setup → sign-in
- Create a community: name, type (`familyFriends` | `custom`), join policy (`private` | `inviteOnly`)
- Community page: name, type, join policy, lifecycle status, your role
- Collections: `wsfMemberProfiles`, `wsfCommunityGroups`, `wsfMemberships`, `wsfVerificationSends`
- Callables: `wsfHealth`, `wsfCreateCommunity`, `wsfSendVerificationEmail`

**The community page is a read-only detail card.** Five labelled rows. That is the
honest description.

**Not landed even so:** PR #300 is stale (head `7721db7`, missing every Sept 1–2 commit);
the hosting redeploy has no receipt; no member can complete signup because verification
email is unconfigured.

---

## 3. What the Expo requires, against what exists

From `WE_STAY_FIT_MASTER.md` §8 and the handoff's Expo definition.

| # | Visitor must be able to | State |
|---|---|---|
| 1 | Sign in as an adult | ✅ built |
| 2 | Become a Founding Champion | ✅ built |
| 3 | Start a new community | ⚠️ partial — 2 of 7 community types |
| 4 | Receive a community page | ⚠️ bare detail card |
| 5 | Choose the kind of community | ❌ |
| 6 | Choose **Join or Start** | ❌ no join path exists at all |
| 7 | Search for an existing community | ❌ |
| 8 | Continue securely on their phone (QR handoff) | ❌ |
| 9 | Choose a starter challenge | ❌ no challenge system |
| 10 | Receive a share link and QR code | ❌ |
| 11 | Invite another person | ❌ |
| 12 | **Join** a community | ❌ |
| 13 | View an active challenge | ❌ |
| 14 | Complete a check-in | ❌ |
| 15 | See truthful aggregate participation | ❌ |
| 16 | Expo mode: idle, reset, demo, large targets | ❌ |

**Eleven of sixteen are unbuilt.** They span M-U3, M-U4, M-U5, M-U6 and M-U7 — five
milestones.

### The rate problem

M-U0 closed 2026-08-26. In the 10 days since: **M-U1 merged, M-U2 has not landed.** That
is roughly one milestone per 5–7 days when things go well, and things have not
consistently gone well — a broken rules harness, environment drift, a 4-day stall.

Five milestones at the observed rate needs 25–35 days. **There are 23.** With zero
slack, no rehearsal, and every dependency landing first. That is not a plan, it is a
hope.

---

## 4. The reframe that makes it fit

The roadmap is built for **universal communities**: any person, any community type,
anywhere. FitLife is not that.

> **At FitLife there is exactly one community.** *FitLife Moves.* It can be created by
> hand, before the doors open, by a person with a laptop.

Nobody at that event needs to search for a community, pick from seven types, or resolve a
duplicate. They need to **join the one that is already there** and have what they do
count toward it.

That single observation removes most of the remaining scope:

| Milestone | Needed for FitLife? |
|---|---|
| M-U3 Invitation and Join | **Reduced** — join a known community by QR. No general invitation system. |
| M-U4 Starter Challenges + Check-ins | **YES — this is the product at FitLife.** |
| M-U5 Community Home + Champion Controls | **Reduced** — the member view and the aggregate counter. No Champion dashboard. |
| M-U6 Universal Start/Join Funnel | **NO.** One community. Cut entirely. |
| M-U7 Expo Mode | **Reduced** — attract, reset, large targets. No demo communities, no place search. |

And the irony worth stating plainly: **"start a community" — the one flow that is built —
is the least important thing at FitLife.** It stays because it exists and costs nothing,
not because the event needs it.

---

## 5. The minimum honest Expo product

The FitLife brief says the emotional idea is *"I did that"* becoming *"We did that."*
Everything below serves that and nothing else does.

**The loop, five steps:**

1. **Scan** a QR anywhere at the expo → land on the FitLife Moves page
2. **Join** — adult confirmation, display name, one tap
3. **See challenges** — a short list drawn from what FitLife is already running
4. **Check in** — "I did this"
5. **Watch the number move** — the shared community counter, immediately

Plus one screen that is not part of the member loop:

6. **Community Pulse** — the kiosk-two display: participants, challenges completed,
   progress toward the shared goal, updating live

**What that needs, in build order:**

| Slice | Substance | Depends on |
|---|---|---|
| **E1** | Land the email path so a member can actually finish signing up | Resend config — **blocked on Devin** |
| **E2** | Join an existing community by link/QR | M-U2 (built) |
| **E3** | Challenge templates + community challenges + check-ins | E2 |
| **E4** | Aggregate counters, honest and live | E3 |
| **E5** | Community Pulse display view | E4 |
| **E6** | Expo hardening: attract, auto-reset, large targets, no data left on screen | E5 |

Six slices, 23 days. Roughly 4 days each with no slack — **still tight, but arithmetically
possible**, which the current roadmap is not.

### Correcting my own dependency chain

An earlier draft of this table had E2 depending on E1. **That was wrong, and it matters.**

E1 blocks *live member validation* — nobody can walk the real flow until verification mail
delivers. It does not block *engineering*: E2–E6 are built and verified against the
emulator, where the harness sets verification state directly (`markEmailVerified` in the
GATE 1 spec already does exactly this). Treating E1 as a serial gate would have idled the
whole build behind a dashboard task neither Maia nor I can perform.

E1 stays urgent — real people walking the loop is the entire point of the Expo, and every
day it slips is a day of unvalidated work stacking up. But **E2 starts now.**

---

## 6. Decisions needed — Devin only

1. **Adopt this cut line?** Specifically: cut M-U6 entirely, reduce M-U3/M-U5/M-U7 to the
   scope above, and make M-U4 (challenges and check-ins) the priority.
2. **Unblock E1 today.** Everything else queues behind it. Either finish the Resend
   `westay.fit` setup, or ship on the already-verified `goarrive.fit` sender as an
   interim, which needs no DNS and no waiting.
3. **Confirm the freeze dates** — Sep 28 feature, Oct 4 code.
4. **Confirm one community.** If the plan is genuinely for attendees to start their *own*
   communities live at the booth, this whole assessment changes and the timeline does not
   work. Say so now rather than in week three.

### What is explicitly NOT being proposed

Cutting privacy controls, adult-only enforcement, honest counters, or sample labelling.
Those are not scope, they are the conditions of shipping at all — and the FitLife brief's
own success criteria depend on the numbers being real.

---

## 7. The risk in one sentence

The Expo does not fail because a feature is missing; it fails because five milestones were
carried at full scope until week three and then everything shipped at once, untested, in
front of 1,500 people.
