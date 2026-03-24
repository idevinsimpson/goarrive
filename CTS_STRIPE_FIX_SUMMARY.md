# CTS Stripe Discount Fix — Summary

## What Was Fixed

The Stripe checkout was charging base prices without applying the Commit to Save (CTS) discount or nutrition add-on, even when the member had toggled CTS on in the shared plan page.

### Root Cause
The `handleProceed` function in the shared plan page only sent `planId`, `memberId`, and `paymentOption` to the `createCheckoutSession` Cloud Function. The Cloud Function had no way to know whether CTS or nutrition add-ons were active, so it always calculated prices from the base plan data.

## Changes Made

### 1. Cloud Function (`functions/src/index.ts`)
- **Accepts two new optional parameters:** `commitToSave` (boolean) and `nutritionAddOn` (boolean)
- **Reads CTS savings** from plan data (`plan.commitToSave.monthlySavings` or fallback to `plan.commitToSaveMonthlySavings`, default $100)
- **Reads nutrition cost** from plan data (`plan.nutrition.monthlyCost` or fallback to `plan.nutritionMonthlyCost`, default $100)
- **Calculates effective monthly price:** `baseMonthlyPrice - ctsMonthlySavings + nutritionMonthlyCost`
- **Recalculates pay-in-full total** from the adjusted monthly price: `effectiveMonthly × contractMonths × 0.9`
- **Stores audit trail** in `acceptedPlanSnapshot`: `baseMonthlyPrice`, `ctsActive`, `ctsMonthlySavings`, `nutActive`, `nutritionMonthlyCost`
- **Updates Stripe product names** to reflect active add-ons (e.g., "GoArrive Coaching — 12-Month Contract (Commit to Save)")

### 2. Frontend (`apps/goarrive/app/shared-plan/[memberId].tsx`)
- **Passes CTS and nutrition state** to Cloud Function: `commitToSave: ctsActive` and `nutritionAddOn: nutActive`
- **CTA button text** now shows effective price after CTS/nutrition adjustments (e.g., "Pay $383/mo Now" instead of "Pay $483/mo Now")
- **Added `effectiveMonthly` and `effectivePayInFullTotal`** computed variables for the adjusted prices

### Files Modified
| File | Lines Changed |
|------|--------------|
| `functions/src/index.ts` | ~30 lines added/modified in `createCheckoutSession` |
| `apps/goarrive/app/shared-plan/[memberId].tsx` | ~10 lines added/modified |

## Pricing Scenarios (Example: $483/mo base, 12-month contract, $100 CTS savings)

| Scenario | Monthly | Pay in Full |
|----------|---------|-------------|
| No CTS, no nutrition | $483/mo | $5,216 |
| CTS active | $383/mo | $4,137 |
| Nutrition active ($100/mo) | $583/mo | $6,296 |
| CTS + Nutrition | $483/mo | $5,216 |

## Deployment
- Cloud Functions: ✅ Deployed
- Hosting: ✅ Deployed to https://goarrive.web.app
- GitHub: ✅ Pushed to main (commit `505bbdb`)

---

## Suggestions for Next Steps (DO NOT IMPLEMENT)

### 1. Authentication Gap for Shared Plan Checkout
**Risk: HIGH** — The `createCheckoutSession` Cloud Function requires `request.auth?.uid` (line 439). Members viewing the shared plan page are NOT signed in, which means they will get a "Must be signed in" error when clicking "Pay Now." This was a pre-existing issue not addressed in this fix. The function needs to either:
- Remove the auth requirement and validate via `memberId` + `planId` combination
- Or implement anonymous auth / guest checkout flow
- Or redirect members to sign in before checkout

### 2. CTS Discount Stacking Order (RISK-001)
**Risk: MEDIUM** — The code comment `RISK-001` notes that CTS + pay-in-full discount stacking order is unresolved. Currently, CTS is applied first (subtract $100/mo from base), then pay-in-full 10% discount is applied to the result. This means:
- Base: $483/mo → CTS: $383/mo → PIF: $383 × 12 × 0.9 = $4,137
- vs. Base: $483/mo → PIF: $483 × 12 × 0.9 = $5,216 → CTS: $5,216 - ($100 × 12) = $4,016
- The current implementation uses the first approach. Confirm this is the intended business logic.

### 3. CTA Button Price vs. Card Price Mismatch
**Risk: LOW** — The pricing cards (Monthly/Pay in Full) still show the base prices ($483/mo, $5,216), while the CTA button now shows the CTS-adjusted price ($383/mo, $4,137). This could confuse members. Consider updating the card prices to also reflect CTS adjustments, or adding a strikethrough on the base price with the adjusted price shown below.

### 4. Nutrition Add-On Not Visible in Pricing Cards
**Risk: LOW** — Similar to CTS, if a member toggles the nutrition add-on, the pricing cards don't reflect the added cost. Only the CTA button shows the effective total.

### 5. Missing Server-Side Validation
**Risk: MEDIUM** — The Cloud Function trusts the client-sent `commitToSave` and `nutritionAddOn` booleans. A malicious client could send `commitToSave: true` even if CTS is not enabled for the plan, getting an unauthorized discount. Consider adding server-side validation: check `plan.commitToSave?.enabled === true` before applying the CTS discount.

### 6. Webhook Handling for CTS Subscriptions
**Risk: LOW** — The `stripeWebhook` function processes subscription events. Ensure it correctly handles subscriptions created with CTS-adjusted prices, especially for renewal/continuation phases where the CTS discount may no longer apply.

### 7. Snapshot Audit Trail
**Risk: LOW** — The `acceptedPlanSnapshot` now stores `baseMonthlyPrice`, `ctsActive`, `ctsMonthlySavings`, `nutActive`, and `nutritionMonthlyCost`. This is good for auditing, but consider also storing these in the `checkoutIntent` document for easier debugging.
