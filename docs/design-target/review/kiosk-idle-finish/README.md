# The three kiosk screens that had no deadline

A kiosk session ends by itself after 90 seconds from a screen it has come to
rest on. Until this change that meant a receipt, a refusal or an unresolved
attempt only. A goal that **closed**, one that cannot be **found**, and a load
that **failed** all carried a manual `Finish` in the chrome and no deadline at
all — so a shared device left on one of them stayed exactly as the last visitor
left it, indefinitely.

I reported that gap while delivering the confinement correction and it was
assigned as its own packet:
[`5787551970`](https://github.com/idevinsimpson/goarrive/pull/427#issuecomment-5787551970).

| | |
|---|---|
| Start SHA | `66903704e15a51a115499c3458e91930ea01bacb` (#427's frozen head) |
| Rule | `kioskMayFinishUnattended` in `src/kioskSession.ts` |
| Producers | `tests/kiosk-idle-finish.test.ts` · `tests-e2e/sprint-w1b-kiosk-idle-finish.spec.ts` |
| Write gate | `WSF_CAPTURE_FRAMES=1`, through `helpers/capture` |
| Browser suite | **9 passed** |
| Unit | 47 files, **808 tests** passed |
| Classes | 800×1280 and 390×640 |
| Revision | `e4243f1` → `HEAD` after the source review [`5787727916`](https://github.com/idevinsimpson/goarrive/pull/436#issuecomment-5787727916): a fail-closed auth probe, and copy that does not promise a control this screen lacks |

## What is reused, not invented

The same 90 seconds, the same `Stay` restart, the same accessible manual
`Finish`, the same sign-out-failure protection and the same presentation every
other settled kiosk screen already has. No screen is redesigned, no preference
is added, and `KIOSK_IDLE_MS` is untouched.

## The rule, moved out of the screen

Eligibility was an inline condition. It is now a pure predicate beside the rest
of the kiosk's rules, deciding from three facts:

| Fact | Meaning |
|---|---|
| `outcome` | what this session's attempt settled as |
| `attemptInFlight` | a contribution or replay is still out |
| `loadSettled` | the goal is closed, missing, or failed to load |

`loadSettled` is the part that was missing. `attemptInFlight` is **stricter**
than the condition it replaces: a submission in progress now refuses the
deadline as well as a stored row still in `sending`, so the timer can never fire
out from under a request that has not answered. Entry, review, the movement
screen and the initial load stay ineligible by construction rather than by
omission, and the unit test states every combination once so a later edit cannot
drift.

## One ordering fact that decided the implementation

The `error` branch returns **before** the `pending` branches, so a load failure
can render while an unresolved attempt is still stored. Had the new screens
finished as outcome `none`, `kioskFinishPlan` would have set
`clearPendingDraft: true` and `runKioskFinish` would have found the attempt id
on the pending row — **erasing the member's reminder**. They pass the live
`kioskOutcome` instead, exactly as the chrome `Finish` already did, so
`unresolved` keeps meaning unresolved wherever it is true. There is a frame and
an assertion for precisely this case.

## The frames

| Frame | sha256 (first 16) | What it is |
|---|---|---|
| `kiosk-closed-goal-tablet-800x1280.png` | `a8395fc60184819a` | a goal that closed: `241 of 500 squats` · `Closed at 48.2%`, then `Finish`, its sentence and `Finishing in 90 seconds` |
| `kiosk-closed-goal-short-phone-390x640.png` | `d4182dce59da5e13` | the same at the short class |
| `kiosk-not-found-tablet-800x1280.png` | `25773d6c7dca091d` | `Goal not found` — where `Back to home` used to be the only control |
| `kiosk-not-found-short-phone-390x640.png` | `be7e532b9897ac5b` | the same at the short class |
| `kiosk-load-error-tablet-800x1280.png` | `94e8460ab05f20db` | `Something went wrong` with the deadline under it |
| `kiosk-load-error-short-phone-390x640.png` | `d58b77cd33f12b3a` | the same at the short class |
| `kiosk-load-error-with-unresolved-tablet-800x1280.png` | `6fd872a32033ac35` | the ordering case: a failed load **while an unresolved attempt is stored**, now carrying the no-retry variant |
| `kiosk-load-error-with-unresolved-short-phone-390x640.png` | `153f5d46cef8fffc` | the same state at the short class, for the longer sentence's wrapping and `Finish`'s reachability under it |
| `kiosk-not-found-signout-failed-tablet-800x1280.png` | `02e597e93619ea9e` | the deadline fired and the sign-out was refused: the device stays put and says so |

## Deterministic time, unmodified duration

Expiry is reached by advancing the page's own clock (`page.clock`), never by
waiting 90 seconds and never by shortening the deadline to suit a test. The
countdown and the automatic finish both run on the product's real
`KIOSK_IDLE_MS`.

**What the resume case does and does not show.** The countdown is a difference
between two timestamps rather than a decremented counter, so a page that comes
back past its deadline is already expired and finishes on its next tick — the
unit test states that directly on `kioskRemainingMs`. Advancing a clock is a
model of that. It is **not** proof that a browser executes while an operating
system has it suspended, and nothing here claims it does.

## Asserted

Per state, at both classes: the full `Finish` treatment is present, and no new
way into the account appears on a screen that just gained a control — the bar,
`wsf-contribute-home` and `wsf-contribute-back` are all absent. A load failure
is asserted **not** to render as a contribution refusal.

Then the behaviour:

- **the deadline performs the same safe Finish** — sign-out completes *before*
  the return to rest, asserted by *observing* the auth store empty rather than
  merely failing to read it;
- **`Stay` renews it** — and renews a *whole* deadline, not the remainder of the
  old one;
- **a failed sign-out at the deadline stays protected** — the device does not
  return to rest with the account still attached, says so, and offers `Finish`
  again;
- **an unresolved attempt survives the deadline** on the failed-load screen, and
  is still keyed to the uid that made it;
- **an ordinary member gets none of this** — the same three states without the
  kiosk flag keep `Back to home` / `Back to community` and their tab bar, have
  no `wsf-kiosk-finish-bar`, and are not signed out however much time passes;
- **a request in flight is never timed out** — no countdown exists on the entry
  screen at all, and none appears while a contribution is out.

### One boundary measured rather than assumed

A request held past the web SDK's own 70-second patience is abandoned by the
client, and the session becomes **unresolved** — which is a rest state, so it
gains the ordinary deadline. The test asserts the handover is clean: a *whole*
fresh deadline rather than a backdated one that would finish immediately and
hide the outcome, the visitor still signed in at that moment, and the reminder
stored. That is the real edge between "in flight" and "nobody knows", and it is
in the suite rather than in a sentence.

## Two corrections on review

### The test evidence failed open

`authRecords()` turned a refused `indexedDB.open`, a read error or a blocked
upgrade into `[]` — **exactly** the value the tests then assert as "signed out".
An unreadable store is UNKNOWN, not empty, so every sign-out assertion in this
file could have passed on a browser whose IndexedDB was simply broken. The same
class of error as a contrast probe that ignores alpha: a tool certifying the
property rather than measuring it.

It is replaced by `inspectAuthStore`, which returns `{ok: true, keys}` or
`{ok: false, reason}` and never conflates them — `onerror`, `onblocked`, a
throwing transaction and a read failure are each reported as failures, and the
read is **bounded** so an inspection that never answers is reported rather than
waited on. Opening a database that does not exist still counts as a genuine
observation of absence, because it is one. `expectSignedOut` and
`expectStillAttached` replace every bare comparison, and the account is now
observed **before** each expiry so the empty store afterwards is a transition
the run watched happen.

**A discriminating regression proves it.** One test breaks the readonly
inspection, asserts the probe reports it as unreadable, and asserts that
`expectSignedOut` then *fails* — a failed inspection cannot satisfy a signed-out
assertion. The probe stays readonly precisely so it keeps working under the
sign-out-failure injection, which breaks readwrite only; that test still asserts
the account is attached through it.

### The notice promised a control this screen does not have

The accepted unresolved notice points at `Confirm this contribution`. The
load-error branch returns **before** the pending one, so it can show an
unresolved session with **no reconcile control on it at all** — and it was
saying "you can try to confirm this contribution here" on a screen with nothing
to confirm it with.

Where the retry exists the accepted copy is unchanged. Where it does not, a
contextual variant says why instead:

> We couldn't load this goal to confirm your contribution. Entering it again
> elsewhere could count it twice.

The unknown status, the reminder, the manual `Finish` and the deadline are all
preserved, and no flow was expanded to justify a sentence. `canRetryHere` is an
explicit argument rather than something inferred, so a future screen has to
state which kind it is. Tested both ways: the no-retry state names no available
action anywhere on the page, and the ordinary unresolved screen still has both
the accepted copy **and** a real reconciliation control.

## Reported, not changed

The `/kiosk/<goalId>` start screen itself has no deadline, because it is already
the rest state a session returns *to*. Nothing here changes it.

## Scope, this revision

Only the affected evidence moved: the load-error-with-unresolved frame was
re-captured for the new copy, and its short-class twin was added for
reachability. **The other six frames are byte-unchanged**, and #427's merged
evidence and Board 11's record were not touched.

## Scope

Loopback and `demo-wsf-local` throughout. Product changes: `src/kioskSession.ts`
(one pure predicate) and `app/contribute/[goalId].tsx`. **No** shell, auth,
pending-storage schema, timeout preference, backend, public payload, admission
or device-lockdown change; no existing test edited; `_layout.tsx` and
`MemberTabBar.tsx` untouched; #427's evidence and frames untouched; Board 11's
historical record untouched. Every account, community, goal and number is
synthetic and local to the emulator.
