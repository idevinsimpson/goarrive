# Community Home — visual baseline and gap ledger

**Candidate:** `42dd32a6933bc43669d0eb5fd68ebb72d0ff063c` — the commit staging serves.
**Captures:** local render of that artifact against the local emulator, synthetic data.
**These are NOT staging screenshots.** There is no browser egress from the session that
produced them (`curl` to the staging channel returns HTTP 000). The built artifact and the
component code are identical to what staging serves; only the backend and the data differ.
Staging-truth captures remain the hosted suite's job.

**Fixture:** "Alpharetta Morning Movers", goal "October Squat Challenge",
1,847 of 5,000 squats (36.9%), member has contributed 137. Signed-in member, not Champion.

## What is already good, and should not be lost

Naming this first because the polish pass must not regress it.

- **The Living WE is genuinely the centerpiece.** It is a large filled mark, roughly 135 CSS px
  tall, and the fill level reads as the progress figure. It is not a small status widget.
- **The numbers are strong and honest.** "1,847 of 5,000 squats" / "36.9% complete" /
  "3,153 to go" is a clear, non-gamified ladder from shared total to remaining work.
- **Green is already doing work, not decoration.** It fills the WE mark, sets the percentage,
  and is the primary button. Navy carries the hero.
- **The wordmark is present and intact** at the top of every width.

## Gaps, measured

### G1 — The primary action is below the fold on a short phone. Measured.

`Start moving` begins at **y = 648** at every phone width, because everything above it is
fixed height. At a 390×640 viewport it is **entirely out of view — by 8 pixels**.

```
360×800   start-moving top=648  startsInView=true
390×844   start-moving top=648  startsInView=true
390×640   start-moving top=648  startsInView=FALSE   <-- misses by 8px
430×932   start-moving top=615  startsInView=true
```

The last thing a member sees on that phone is **"Confirmed 4:54 PM · Refresh"** — a timestamp
and a maintenance link. The owner's bar is that a newcomer understands "I can add mine" in
about five seconds; on this viewport the control that says so is not on screen at all.

An 8-pixel margin is not a safe margin. A three-line community name, a longer goal title, or
any increase in system font size pushes it further out. (Not yet measured — stated as the risk
it is, not as a finding.)

### G2 — The vertical budget is spent before the goal appears.

Content height is **1,391 px** against a 640–932 px viewport: the page is 1.5 to 2.2 screens.
Roughly the first 395 px — over 60% of a short phone — is consumed before the goal card starts:

| Block | approx. CSS px |
|---|---|
| Wordmark chrome | 0–110 |
| Community name (2 lines at this name length) | 150–300 |
| "Moving together." tagline | 325–350 |
| Goal card begins | ~395 |

The community name is set larger than the goal title. On a screen whose job is
"here is the goal, here is where we are, add yours", the community's own name is the loudest
element and the goal is second.

### G3 — Three stacked label rows before any progress.

Inside the hero, before the WE mark: an eyebrow **"WHAT WE'RE DOING"**, the goal title, then
**"Open · Ends Sat, Sep 26"**. The eyebrow is a label for something the card's content already
makes obvious, and it costs a full row at the most expensive point on the screen.

### G4 — Two competing calls to action, one of them wordy.

`Start moving` (green, filled) and `Already moved? Record squats` (outlined) sit adjacent and
equally wide. That is two obvious actions, not one. The second label asks a question and then
names a verb and a unit; it reads like a form control, not an invitation.

### G5 — Maintenance metadata sits inside the emotional centerpiece.

"Confirmed 4:54 PM · Refresh" is placed between the progress figures and the primary action —
the single most valuable strip of the hero. It is developer-grade reassurance in the spot the
payoff should occupy, and at 390×640 it is the last thing on screen.

### G6 — At station/wide width the hero is a stretched phone column with mixed alignment.

At 1280×800 the card spans roughly x=320 to x=960 with the eyebrow, title and status **left
aligned** while the WE mark, the figures and the confirmed line are **centre aligned**, and both
buttons are full-bleed. `Start moving` becomes a ~640 px wide target. The result reads as a
phone layout scaled up rather than a composition intended for that width — which matters,
because this is close to what a station screen shows in a room.

### G7 — Three separate routes to the same action on one screen.

Below the hero, "Your part" offers **"Record more squats"**. That is the third control leading to
the contribution flow, after `Start moving` and `Already moved? Record squats`. One screen,
one job, three buttons for it.

### G8 — There is no recent shared movement on Community Home at all.

The brief asks to make "recent shared movement feel human and alive". Nothing on this screen
shows what anyone else did. `wsfGoalRecentAdditions` and the "Recent" panel exist, but they
were built for the **public display**, not the member's Home. This is a content gap, not a
styling one, and no amount of visual polish closes it.

"Your part" itself is one flat sentence — "You've added 137 squats to this goal." — with no
sense of when, no relation to the shared total, and no texture.

### G9 — Invitation outranks the member's own contribution.

"Invite people" is a bold ~24 px heading with two pill buttons and a supporting sentence.
"YOUR PART" above it is a 12 px grey uppercase eyebrow with one line of plain text. For a
signed-in member of an existing community, invitation is secondary — the brief says the
member Home should prioritise goal and action, and campaign energy belongs on the public
surface. Right now the largest thing below the hero is a recruiting card.

### G10 — Below the hero it becomes the control panel the brief names.

Three stacked white rounded cards with hairline borders on cream, each a heading plus controls.
The hero earns its card; these three do not, and the repetition is what makes the screen read
as a settings page once you scroll.

### G11 — The screen ends in chrome.

"1 member · since August 2026", then "Membership options", then "Back to home" — three rows of
low-value navigation and metadata as the closing impression.

## What the next slice should do, in order

1. **Get the primary action onto a 390×640 screen** without shrinking the Living WE — the
   budget should come from G2, G3 and G5, not from the centerpiece.
2. **Demote the community name** below the goal in visual weight; it is context, not the point.
3. **Collapse the eyebrow and status into one line** with the title.
4. **Make one action obvious** and relegate the second to a quieter affordance.
5. **Move the confirmation metadata out of the hero.**

6. **Give the member something alive below the hero** — G8 is the one gap here that needs new
   content rather than rearrangement, and it is the one most likely to create the desire to
   interact that the brief is actually asking for.
7. **Collapse the three contribution routes to one**, and let "Your part" report rather than
   re-ask.

G6 (wide/station composition) and G8 (recent shared movement) are each their own slice. G6 is a
composition problem, not a budget problem; G8 needs a data surface that does not exist on this
screen yet. Folding either into the first hierarchy slice would make the diff unreviewable.

## Self-critique of this baseline

- It is one fixture, one data state, one locale. A reached goal, a zero-progress goal, a
  Champion's view and a three-line community name are all uncaptured and could each change the
  verdict on G1 and G2.
- It is a local render. Fonts, device pixel ratio and the emulator's data shape are close to
  staging but not identical, and I have not proven the two are pixel-equivalent.
- No interaction states are captured: pressed, focused, loading, error. The owner's brief asks
  about interaction feedback and this baseline says nothing about it.
