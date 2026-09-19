# Champion Manage — event first

**Task:** the Director's 10:01 ET instruction on PR #327, *"Champion Community Manage +
kiosk setup refinement"*, to be done without waiting on the staging IAM dependency.

**Branch:** `claude/wsf-ui-member-experience`. **Not deployed.** `approvedAppSha` on `main`
still pins `15afae97`, which is what staging serves; nothing here reaches it.

---

## The finding, stated plainly

The sheet opened on the words **"Champion tools"** — a drawer named after its own mechanism —
followed immediately by a mode chooser. The **kiosk address for a goal was rendered inside
that goal's public-display permission card**, so the one thing a Champion opens this sheet to
do was a control inside a permission they were not looking for. Community details, the invite
QR, the invite link and leaving all sat at the same weight as the event work, and *Start
another goal* — ordinary, daily work — sat loose between two administrative blocks.

## What changed

**1. Identity and the story first.** The sheet is titled with the **community**; "Champion
tools" survives as the eyebrow, which is also the dialog's accessible name, so the a11y
contract is unchanged. Under it, one line that says what is actually running.

`manageStoryLine` has a branch per state of the goal list and **never asserts what it does
not have**: `Checking what is running…` while loading, `Goals could not be loaded` on
failure, `No goal running yet`, `"<title>" is running`, or `N goals running`. The member
count is appended **only when it is known** — a null count renders no half-sentence and no
zero.

**2. One primary action, in its own section.** New **Your event** section, first in the
sheet. `renderKioskSetup` and `renderStationEnrolment` were lifted out of
`renderDisplayAuthControl` into their own renderers and called from here. Every testID,
every control, every string and every `data-*` attribute inside them is unchanged.

Each running goal now reads: its **name**, then the plain selection truth in its own unit
(`Counted in push-ups · 1,000 push-ups together`), then the intro, then the green **Open
kiosk** primary and the quiet **Copy kiosk link** beneath it. The second "Set up kiosk"
heading inside each goal's block is gone — the card above says it once.

**3. Screens are a sibling of the mode, not part of it.** Station enrolment renders for every
running goal **whichever mode is chosen**, because a combined event enrols screens exactly as
a single-goal event does. The first cut of this change put it inside the One-goal branch and
`ui-combined-goal.spec.ts` caught it within one run — the spec's own comment had said so, and
the test failed rather than the reviewer noticing.

**4. Secondary work is labelled, not hidden.** Four sections, in this order:

| Section | testID | Holds |
| --- | --- | --- |
| Your event | `wsf-manage-event` | Set up kiosk (mode, per-goal addresses, combined flow), screens |
| Goals | `wsf-manage-goals` | Public display permission per goal, Start another goal |
| Members and invites | `wsf-manage-members` | Community details, Invite QR, Invite link |
| Advanced | `wsf-manage-advanced` | Membership / leaving |

*Start another goal* moved **into Goals**. It is routine work and the Director's instruction
was explicit that routine goal work must not be buried behind danger or admin density.

**5. A sheet, not a table, on a laptop.** `styles.sheet` gains `maxWidth: 720` and centres.
Unbounded, a two-word label and its value sat at opposite ends of 1280 px.

## Honest states

| State | testID | Says |
| --- | --- | --- |
| Loading | `wsf-kiosk-setup-loading` | that it is loading |
| Failed | `wsf-kiosk-setup-failed` | the goals could not be loaded, and offers no address |
| Empty | `wsf-kiosk-setup-empty` | nothing is running, and names the path that exists |
| Ineligible | `wsf-combined-pick-ineligible-<goalId>` | which activity, and why |
| Error | `wsf-combined-error` | the refusal, verbatim from the validator |
| Review | `wsf-combined-summary` | the entered facts read back, including what contributes |
| Success | `wsf-combined-created` | the address, built from the served origin |

The empty-state copy was **corrected after looking at the render**: it first said "Start a
goal under Goals below", but with no goal running the sheet carries no Start control — the
community page behind it does, which is what the Goals section already said. Two parts of one
sheet disagreeing about where a control is, is a defect.

## What did not change

- **Authorization.** The sheet is still `visible={isChampion && manageOpen}`. A member and a
  signed-out visitor render none of it. Proven by `ui-join-qr` Q-2/Q-3 and the Champion
  torture specs, all green.
- **The hosted harness contract on `main`**, which cannot be edited from this branch:
  `wsf-community-manage`, `wsf-community-manage-panel`, `wsf-goal-display-auth-<goalId>` and
  its `-toggle-`/`-state-`/`-unsettled-` ids, and `wsf-goal-display-auth-confirmed-absent`.
  The permission cards still render directly in the opened panel, with no extra step to reach
  them.
- **The blocked 22 services.** Nothing in this slice calls them to render or to copy a kiosk
  link. `wsfListStations` populates the enrolment panel and is one of the shut services; a
  failed read leaves that panel empty and **does not** prevent the address, the Open kiosk
  control or the copy control from rendering.
- **The served origin.** `currentOrigin()` still builds every kiosk, station and combined URL.

## Gates

```
tsc --noEmit                        clean
vitest                              740 passed (42 files)
playwright, complete suite          190 passed  (187 before; +3 here)
expo export --platform web          ok, production-shaped (no emulator flags)
functions-westayfit tsc             ok
```

## Evidence

`apps/westayfit/tests-e2e/ui-manage-event-first.spec.ts` — 3 tests, **40 captures**,
40 distinct SHA-256 hashes.

Presentations, each captured for every state: **360 · 390 · 430 · short 390×640 (keyboard up)
· 195 (the 200 % text-zoom reflow this file's styles are written to) · wide 1280**. The
empty-community test runs entirely under `reducedMotion: 'reduce'`.

Three guards, because a capture is a claim:

1. **Byte-identical guard.** Two captures with the same hash fail the test — one of them is
   not the state it is named for.
2. **Anchor scrolled into frame.** Waiting for visibility was not enough, and this spec proved
   it on itself: the sheet keeps its scroll offset across a viewport change, so
   `combined-success-short-390x640` was a picture of the station panel. *Present* is not
   *shown*. Fixed with `scrollIntoViewIfNeeded` before every capture.
3. **No horizontal clipping, asserted.** At every presentation: nothing inside the sheet is
   wider than the sheet, and the document does not scroll sideways. **36 checks, 0 offenders.**
   Mutation-tested — forcing one element to 3000 px makes it fail — then reverted.

## Structural assertion, not an impression

The central claim is checked by CSS descendancy rather than by eye:

```ts
await expect(page.locator(
  `[data-testid="wsf-manage-event"] [data-testid="wsf-kiosk-setup-${goalId}"]`
)).toBeVisible();
await expect(page.locator(
  `[data-testid="wsf-goal-display-auth-${goalId}"] [data-testid="wsf-kiosk-setup-${goalId}"]`
)).toHaveCount(0);
```

## Still true, and still unclaimed

Staging serves `15afae97`; hosted verification is 20/21; the 22 staging Cloud Run services
are shut. **The product remains BLOCKED for end-to-end expo use**, and nothing in this slice
changes that.
