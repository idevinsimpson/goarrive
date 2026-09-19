# Streaks for WE STAY FIT — options, counting rules, recommendation

**Status: design only. Nothing here is implemented, and nothing should be until the definition is approved.**

Grounded in the product as it actually is at `42dd32a`, not as a generic fitness app.

---

## 0. The constraint that decides everything

The brief forbids shame, pressure, fake urgency, ranking, and conditional belonging, and says
plainly: **missing a day must not erase valid contributions or make belonging feel conditional.**

A conventional streak is a *consecutive run that can be lost*. Its entire motivational force is
loss aversion — the fear of breaking it. That force is the thing the brief rules out. You cannot
keep the mechanic and remove the pressure; the pressure **is** the mechanic.

So the useful question is not "how do we add streaks safely" but **"what gives the feeling
streaks give — continuity, momentum, being part of something sustained — without a losable
run?"** Everything below follows from that.

Two further facts from the code constrain the answer:

- **`recentAdditions` carries amount and minute and deliberately no identity.** The public
  progress surface literally cannot say who moved. Any community-level streak built on it is
  privacy-safe by construction, and also cannot count *distinct people*.
- **The window is enforced on server time, and every goal carries its own IANA `timezone`.**
  "A day" therefore has an unambiguous definition available already, and it is not the device's.

---

## 1. Options compared

### A. Community consistency — "days this community moved"

One day counts when **at least one** confirmed contribution lands on the goal, in the goal's
timezone.

- **For:** reinforces "we move together" exactly as the brief wants. Nobody's absence breaks it,
  so belonging is never conditional. No individual is identified, so it needs no privacy story.
  A break is nobody's fault, which is the only version of a break that carries no shame.
- **Against:** in an active community it is always-on and therefore says nothing. In a small one
  it is a single person's streak wearing a community's name — which is a **privacy leak**, not
  just a weak signal: "the community moved 9 days running" in a two-person community tells the
  other member exactly what you did.
- **Verdict:** viable, with a floor (see §2.5).

### B. Private personal consistency — "you moved 4 of the last 7 days"

- **For:** private by default satisfies the brief directly. Personal consistency is the thing a
  person can actually act on.
- **Against, if built as a consecutive run:** it is precisely the pressure mechanic the brief
  forbids, and it makes a missed day feel like a loss.
- **The fix that makes it viable:** express it as a **rolling rate over a fixed window**, not a
  run. *4 of the last 7 days.* A rate cannot be broken — it moves. Miss a day and it reads 3 of 7
  and climbs back on its own. There is no moment of loss to fear and nothing to protect.
- **Verdict:** viable **only** as a rolling rate. Recommended.

### C. Challenge participation continuity — days moved within this goal's window

- **For:** naturally bounded by the goal, so it resets structurally rather than personally — the
  end of a challenge is not a failure. Ties directly to the shared goal, which the brief says
  stays primary.
- **Against:** a three-day goal makes it meaningless; goal length is arbitrary, so the number is
  not comparable between goals and invites comparison anyway.
- **Verdict:** viable as *reporting* ("you took part on 5 of this challenge's 12 days"), not as a
  streak. Best used on the challenge's closing summary, not on Home.

---

## 2. Exact counting rules

These apply to every option; where they differ it is called out.

### 2.1 What a "day" is
The **calendar date in the goal's own IANA `timezone`**, from the goal document — never the
device's and never UTC. Two members in different zones must agree about which day a contribution
belongs to, and the goal's zone is the only value both of them share. The instant used is the
**server** time already used to enforce the goal window.

### 2.2 What qualifies
A **confirmed** contribution row (`wsfContributions/{goalId}_{uid}_{attemptId}`) with a recorded
amount **greater than zero**.

Explicitly **not** qualifying:
- a pending or unconfirmed attempt. The product already has an honest "could not confirm" state;
  counting one toward a streak would be **fabricating activity**, which the brief forbids.
- a replayed attempt id (`alreadyRecorded`), which records nothing new.
- an amount of zero.

### 2.3 Same-day repeats
**A day counts once**, however many contributions land on it. Anything else turns consistency
into volume, and it would systematically penalise goals whose `repeatPolicy` is `once` — those
members *cannot* contribute twice, so a volume-sensitive streak would rank the policy, not the
person.

### 2.4 Missed days
Nothing is removed, decayed, or reset. A missed day simply is not in the set.
**The Living WE never moves backwards** — the brief's hard constraint — and no total, member
total or credit is touched by any streak logic. Streak state is derived and additive only.

### 2.5 Small-community floor (privacy)
The community figure is **suppressed entirely below three distinct contributing members** on the
goal. Below that it is a single member's private activity published to the others under a
community label. It shows a neutral line instead, never "0 days".

This requires counting distinct contributors, which `recentAdditions` cannot do by design — so
the community day record must count contributors itself (§5), and must store a **count**, never
a list of who.

### 2.6 Corrections
A correction (`wsfGoalAdjustments`) that takes a member's day total **to zero** must remove that
day's qualification; one that merely reduces it must not.

This is the rule that decides the data model: a per-day **boolean cannot be un-set safely**,
because you cannot tell whether some *other* contribution still qualifies that day. The day
record must therefore hold a **count of qualifying contributions per day**, decremented on
correction-to-zero, with the day qualifying while the count is ≥ 1.

### 2.7 Challenge boundaries
Days are bounded by the goal's own window — start inclusive, end exclusive, in the goal's
timezone. Continuity does **not** span goals: a new challenge starts a new count, and that is
presented as a new beginning, not a lost run.

### 2.8 Timezone changes and travel
The goal's zone is frozen for the goal's life, so a travelling member's days are still assigned
consistently. If a goal's zone were ever edited, previously assigned days are **not**
recomputed; the history stands as recorded.

---

## 3. Recommendation

**Ship two things, and no consecutive run anywhere.**

1. **Community: "We've moved on 9 days."** A cumulative count of qualifying days within the
   current goal — *not* consecutive. It only ever goes up, so there is nothing to break, no
   urgency to manufacture, and no day on which anyone has let the group down. Suppressed below
   three contributors.

2. **Personal: "You've moved 4 of the last 7 days."** A rolling rate, private by default,
   visible only to the member, in "Your part". Never published, never compared, never ranked.

**Why not a consecutive streak, stated plainly:** every hard constraint in the brief is a
constraint against loss aversion, and loss aversion is the only reason consecutive streaks work.
A "safe" consecutive streak is a contradiction — it would either keep the pressure the brief
forbids, or remove the pressure and become a worse version of the two counters above. I would
rather say that than ship a defanged streak that satisfies the letter of the brief and none of
its intent.

**What is deliberately not proposed:** milestone badges, flames, rings, counters that animate on
open, "don't lose your streak" prompts, notifications of any kind, and any comparison between
members. Milestone *language* stays factual — "that's 9 days this community has moved" — and
appears at the confirmation moment, where the Living WE is not the focus, rather than on Home.

---

## 4. Where it lives (and what it must not disturb)

The brief: streaks must not compete visually with the Living WE or become the product identity.

- **Community Home hero:** **nothing.** The hero is the Living WE, the figures and one action.
  This is also where the measured baseline shows the primary action already falls below the fold
  at 390×640 — adding anything above it would make a known defect worse.
- **Under the shared figures:** one quiet line of body text, no badge, no icon, no colour of its
  own. It reads as a sentence, not a score.
- **"Your part":** the private rolling rate, as a sentence beside the member's own total. This
  is the section the visual ledger already flags as inert; a true, private, non-comparative fact
  is exactly the kind of life it needs.
- **Confirmation screen:** the natural home for milestone language, because the payoff moment is
  the one place the Living WE is not carrying the hierarchy.
- **Public display / station:** **nothing personal, ever.** The community line only, and only
  above the contributor floor.

Mocks are the next deliverable and are deliberately not in this document — the brief asks for
inspectable captures before implementation, and I would rather draw them against the *revised*
Community Home than against a layout that is about to change underneath them.

---

## 5. Data model, risks, edge cases

### Required additions (neither exists today)
- `wsfGoalMemberDays/{goalId}_{uid}` — per-member map of local date → count of qualifying
  contributions. Written in the **same transaction** as the contribution, so it cannot drift.
- `wsfGoalDays/{goalId}` — per-goal map of local date → **count of distinct contributing
  members** that day (a number, never a list of uids), for the community figure and the floor.

Both are derived, additive, and hold no new personal or health data. Neither is required for any
existing contract to hold; both can be removed without loss.

### Risks
- **Write contention.** `wsfGoalDays/{goalId}` is one document every contribution touches — the
  exact single-hot-document shape the station rate limiter was redesigned to avoid. It needs
  sharding by day or by member before it goes near an expo crowd.
- **No backfill is possible.** These records do not exist for past contributions, and
  reconstructing them would require reading every contribution row. Any counter must start at
  adoption and **say so on screen** rather than silently appear to be a full history.
- **The floor can move.** A community that drops below three contributors must hide a figure it
  was previously showing. Hiding it is correct; it should not be explained in a way that points
  at whoever left.
- **Kiosk and station contributions** are the member's own — the entry carries their uid and the
  attempt is canonical — so they count. Worth stating because a room full of station
  contributions is exactly when this will first be seen.
- **A correction arriving after a day has been counted** is handled by §2.6, but a correction
  that crosses a *day boundary* (recorded late at night, corrected the next day) must decrement
  the day the **contribution** belongs to, not the day the correction happened.
- **An expo is not a habit.** Every member's first experience of this will be a single day at a
  booth. A counter reading "1 day" on day one must not feel like a failed start — which is
  another argument for the cumulative and rate forms over a run.

---

## 6. What I need before implementing

Approval of the **definition**, specifically: the two counters in §3, the contributor floor in
§2.5, the correction rule in §2.6, and confirmation that no notification, badge or milestone
graphic is wanted. Mocks follow approval; implementation follows the mocks.
