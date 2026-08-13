# Pause/Resume E2E Test Plan (Stripe)

## Scope

End-to-end verification of the coach-initiated pause/resume flow for member Stripe
subscriptions (`pauseStripeSubscription` / `resumeStripeSubscription` callables),
including the contract-extends behavior from PR #237 and the hardening in this PR:

- Multi-phase `subscription_schedules` shift (all downstream phases move by the pause delta)
- Server-side `console.log` on resume records `extendedDays` for observability
  (no cap — any duration is allowed; long extensions surface in Cloud Logging)

## Blocker context

This test plan is **chained behind the funnel-rules fix** (separate work stream).
Execute it the moment that blocker clears — do not attempt to unblock funnel rules
as part of this test run.

## Prerequisites

- Staging Firebase auth working (goarrive--staging preview channel).
- Stripe **test mode** active on the connected account used by the seeded coach.
- One seeded coach + one seeded member with an **accepted plan**.
- Stripe test card `4242 4242 4242 4242` (any future expiry, any CVC).

## Steps

1. **Create test subscription** — as the member, complete the checkout flow for the
   coach's plan using the 4242 test card. Confirm a `memberSubscriptions` doc exists
   with `coachId`, `memberId`, and (for scheduled plans) `stripeScheduleId`.
2. **Navigate to MemberDetail** — sign in as the coach and open the member's detail page.
3. **Pause** — click Pause. Verify `pausedAt` is set on the `memberSubscriptions` doc
   and the Stripe subscription shows `pause_collection: { behavior: 'void' }`.
   Wait **5+ minutes** (pause duration rounds up to 1 day on resume).
4. **Resume** — click Resume.
5. **Verify:**
   - `pausedAt` cleared from the `memberSubscriptions` doc.
   - `member_plans/{memberId}.contractEndAt` shifted forward by `ceil(pause-duration-days)`
     (1 day for a short test pause).
   - `memberSubscriptions.pauseHistory` has a new entry: `{ pausedAt, resumedAt, extendedDays }`.
   - Stripe `subscription_schedule` phases shifted (check Stripe dashboard, test mode):
     current phase `end_date` +1 day, every downstream phase `start_date` **and**
     `end_date` +1 day, phase lengths unchanged.

## Failure cases to test

- **Non-owning coach attempts pause** — call pause as a second seeded coach on the
  first coach's member. Expect `permission-denied`.
- **Admin impersonation of coach** — as platformAdmin impersonating the owning coach,
  pause + resume should succeed (PR #237 fix — `claims.coachId`/`effectiveUid` path).

## Observability check (no cap enforcement)

Long pauses are allowed by design (per Devin 2026-08-13 — coach flexibility over
guardrails). Verify the observability signal:

- Set `pausedAt` back-dated ~120 days on the `memberSubscriptions` doc (Firestore
  console, staging only), then Resume.
- Expect: resume **succeeds** (no `failed-precondition`), Stripe mutation applies,
  `contractEndAt` shifts forward by ~120 days, Cloud Function log line
  `[resumeStripeSubscription] extending subscription ... : 120 day(s)` is emitted.
- If a coach ever needs to churn/renegotiate rather than extend, they should
  cancel + re-enroll — the resume path always extends now.

## Rollback (if test corrupts staging data)

1. In Stripe test mode dashboard: cancel the test subscription and release/cancel the
   test subscription schedule.
2. Firestore: delete the test `memberSubscriptions` doc (or clear `pausedAt` +
   remove the bogus `pauseHistory` entry via console).
3. `member_plans/{memberId}`: restore the original `contractEndAt` (note the original
   value before starting the test).
4. If the back-dated `pausedAt` observability test was run, revert `contractEndAt`
   to its pre-test value and ensure `pausedAt` is removed so the member is not
   stuck in a paused state.
5. Re-run the staging seed script if member/coach state is unrecoverable.
