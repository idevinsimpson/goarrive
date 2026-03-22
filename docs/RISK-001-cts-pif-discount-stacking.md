# RISK-001 — CTS + Pay-in-Full Discount Stacking

**Status:** Documented — rule established, enforcement pending CTS opt-in build  
**Severity:** Medium  
**Raised:** 2026-03-22  
**Owner:** Product / Engineering  

---

## Summary

Two discount mechanisms exist in GoArrive's pricing model:

| Discount | Applies To | Rate |
|---|---|---|
| **Pay-in-Full (PIF)** | Contract period only | 10% off total contract price |
| **Commit to Save (CTS)** | Continuation period only | ~50% off monthly continuation rate |

These two discounts apply to **different time periods** and therefore **do not stack**. This document establishes the canonical rule and describes the enforcement approach.

---

## The Rule

> **PIF and CTS discounts are mutually exclusive by time period. PIF applies only during the initial contract; CTS applies only during the post-contract continuation phase. A member who pays in full and later opts into CTS receives both discounts sequentially — not simultaneously — and neither discount reduces the other.**

### Period Definitions

The **contract period** begins on the member's `contractStartAt` date and ends on `contractEndAt` (calculated as `contractStartAt + contractLengthMonths`). The PIF discount is applied at the time of checkout and reduces the total contract price by 10%. It has no effect on any pricing after `contractEndAt`.

The **continuation period** begins the day after `contractEndAt` and continues month-to-month until the member cancels. The CTS discount reduces the monthly continuation rate by approximately 50% (the exact amount is set by the coach in `postContract.ctsMonthlySavings`). CTS is conditional on the member meeting their accountability commitments each month.

### Stacking Scenario

Consider a member with the following plan:

- Monthly contract rate: **$500/month** over 12 months = $6,000 total
- PIF discount: 10% = **$600 off** → member pays **$5,400** at checkout
- Continuation rate: **$300/month** (coach-set)
- CTS discount: **$150/month** off continuation rate → member pays **$150/month** after opting in

The PIF discount ($600) applies once at checkout. The CTS discount ($150/month) applies each month of the continuation period after the member opts in. **The $600 PIF discount does not reduce the $300 continuation rate, and the CTS opt-in does not retroactively affect the contract payment.**

---

## Current Implementation Status

| Component | Status | Notes |
|---|---|---|
| PIF checkout (`createCheckoutSession`) | ✅ Implemented | 10% discount applied via `coupon` in Stripe |
| PIF deferred continuation subscription | ✅ Implemented | Created at `contractEndAt` via `trial_end` |
| CTS opt-in modal (`CtsOptInModal`) | ✅ Implemented | Member taps "Commit to Save" → consent doc created |
| CTS Stripe price update (`activateCtsOptIn`) | ✅ Implemented | Cloud Function updates subscription price on consent |
| **Stacking guard** | ⚠️ Not yet enforced | See enforcement section below |

---

## Risk: Accidental Stacking

Without an explicit guard, the following scenario could produce incorrect billing:

1. Member pays in full (PIF applied at checkout).
2. Contract period ends; continuation subscription starts at full rate.
3. Member opts into CTS; `activateCtsOptIn` updates the subscription price.
4. **No issue** — this is the correct sequential flow.

However, if a coach manually sets `postContract.ctsMonthlySavings` to a value that already incorporates the PIF discount (e.g., setting it to 55% off instead of 50% because the member "already paid in full"), the member would receive a double benefit. This is a **coach configuration error**, not a system bug, but it should be documented and ideally surfaced in the coach UI.

A second risk exists if the CTS discount is applied to the **contract period** subscription (e.g., if a webhook fires out of order and `activateCtsOptIn` runs before `contractEndAt`). The `activateCtsOptIn` Cloud Function should guard against this by checking `Timestamp.now() >= contractEndAt` before updating the subscription price.

---

## Enforcement Recommendations

The following guards should be added before CTS opt-in is considered production-ready:

**1. Time-period guard in `activateCtsOptIn`**  
Before updating the Stripe subscription price, verify that `Timestamp.now() >= planData.acceptedPlanSnapshot.contractEndAt`. If the contract has not yet ended, return an error: `"CTS opt-in is only available after your contract period ends."` This prevents the CTS discount from being applied during the contract period.

**2. Idempotency guard in `activateCtsOptIn`**  
Check `consentDoc.data().status === 'active'` before processing. If already active, return early. This prevents double-application if the function is retried.

**3. Coach UI warning**  
In `PlanControlsDrawer`, when the coach sets `postContract.ctsMonthlySavings`, display a note: `"This is the monthly savings during the continuation period only. It does not affect the contract price or the pay-in-full discount."` This prevents the coach configuration error described above.

**4. Audit log entry**  
When `activateCtsOptIn` runs successfully, write a `ledgerEntries` document with `type: 'cts_activated'`, `memberId`, `coachId`, `previousMonthlyRate`, `newMonthlyRate`, and `contractEndAt`. This creates an auditable trail for any billing disputes.

---

## Related Documents

- `docs/ci/firestore-rules-tests.yml.txt` — CI workflow (pending activation)
- `functions/src/index.ts` — `activateCtsOptIn`, `createCheckoutSession`, `stripeWebhook`
- `components/CtsOptInModal.tsx` — Member-facing opt-in UI
- `lib/planTypes.ts` — `ContinuationPricing`, `AcceptedPlanSnapshot`, `LedgerEntry`
