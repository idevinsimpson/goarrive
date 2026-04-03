# GoArrive Billing & Business Rules

## Payment Infrastructure
GoArrive uses Stripe Connect in Standard mode for all payment processing. Each coach has their own connected Stripe account, and the platform collects fees through the Stripe Connect fee structure. The payment flow is managed through Cloud Functions, with `stripeWebhook` handling all incoming Stripe events.

## Key Billing Concepts

### Stripe Connect Flow
The coach onboarding process includes creating a Stripe Connect link via the `createStripeConnectLink` Cloud Function. Once the coach completes Stripe onboarding, their account status is tracked in the `coachStripeAccounts` Firestore collection. The `refreshStripeAccountStatus` function can be called to update the status at any time.

### Checkout Sessions
Member payments are initiated through `createCheckoutSession`, which creates a Stripe Checkout session. The checkout flow supports both new subscriptions and plan changes. After successful payment, the `stripeWebhook` processes the event and updates the member's subscription status.

### Commit-to-Save (CTS)
CTS is an accountability mechanism where members commit to a savings plan. The `activateCtsOptIn` function handles opt-in, and `enforceCtsAccountability` is a scheduled function that enforces accountability fees. The `waiveCtsFee` function allows coaches to waive fees for specific members.

## Earnings & Profit Share

### Prorated Earnings Caps
The platform implements prorated earnings caps based on each coach's profit share start date. When a coach's profit share start date falls partway through a year, their earnings cap for that year is prorated proportionally. The admin can set yearly earnings caps via the `setYearlyEarningsCap` Cloud Function, which stores the configuration in the `earnings_caps` Firestore collection.

### Yearly Cap Configuration
The admin UI on the billing page allows setting yearly earnings caps for each coach. Caps are stored per year and automatically carry over to subsequent years if no new cap is set. The prorated calculation divides the yearly cap by 365 and multiplies by the number of days remaining in the year from the coach's start date.

### Profit Share Start Date
The `setProfitShareStartDate` Cloud Function sets the date from which a coach begins earning profit share. This date is critical for prorating the first year's earnings cap.

## Business Rule Guardrails
All business rules must be runtime-driven and auditable. Hardcoding evolving financial rules is strictly prohibited; they must reside in configuration or approved business-rule documents. Webhook-first and ledger-first patterns are mandatory for any money-moving behavior.

When a business-rule amount or edge-case logic is unclear, the correct approach is to scaffold it, flag it for review, and avoid pretending it is finalized. Developers must never invent alternate split logic, fee logic, or exception logic without explicit approval.

Rule versioning, snapshots, and immutable financial records must be preserved at all times. The `ledger_entries` and `ledgerEntries` collections serve as the immutable financial ledger for the platform.

## Payment Status Tracking
The application must accurately catch, document, and update all payment-related statuses. This includes member sign-ups, cancellations, refunds, paused plans, and failed payments. The system must reliably record these events and reflect them in the relevant parts of the application, including the coach's billing view and the member's plan status.

## Coach Access to Payment Process
Coaches must be able to access the same payment page (Stripe checkout) as members. This allows coaches to view the full payment process and guide members through it. The system must not restrict coaches from accessing payment pages, and users should not be forced to sign in before paying.
