# Coach Discovery Legal Terms Verification

Verification completed 2026-08-05 for scenes 19–21. This is a content comparison, not legal advice or final legal approval.

## Sources compared

1. [GoArrive Program Terms & Contractual Agreements](https://docs.google.com/document/d/1zjHQ8q5ekscpsQ2roAGtYBgdfMzhf4Mk2OHA9181qKw), modified 2025-04-19 in Google Drive.
2. `apps/goarrive/constants/coachAgreement.ts`, version `2026-07-coach-program-terms-v2`, documented as derived from [JotForm 241435478238159](https://form.jotform.com/241435478238159).
3. The public discovery copy in `apps/goarrive/data/coachDiscoveryScenes.ts` and `apps/goarrive/components/coach-discovery/DiscoveryScenes.tsx`.

The Drive document predates the repository's versioned JotForm-derived terms and contains legacy wording such as “client,” “trainer,” and “virtual.” The discovery route uses current GoArrive terminology while preserving the economic meaning. A GoArrive legal/product owner should confirm which publication is the agreement of record before a production release.

## Comparison result

| Term | Drive agreement | Discovery experience | Result |
| --- | --- | --- | --- |
| Tier 1 | 1–3; 60% coach / 40% GoArrive | 1–3 active members; 60% / 40% | **Match** |
| Tier 2 | 4–6; 65% coach / 35% GoArrive | 4–6 active members; 65% / 35% | **Match** |
| Tier 3 | 7+; 70% coach / 30% GoArrive | 7+ active members; 70% / 30% | **Match** |
| New Business | Revenue from a member during the first year with GoArrive | Same definition in the cap facts | **Match** |
| Annual cap | Set by calendar year, prorated for a mid-year start, reset January 1 | All three mechanics are stated | **Match** |
| After-cap share | 100% of additional qualifying first-year revenue, less the monthly admin technology fee | Same high-level result, with the governing-terms qualifier | **Match** |
| Continuing obligations | 7% inter-coach referral and member-referral refund obligations continue after the cap | Both are explicitly retained | **Match** |
| Inter-coach referral | 7% of receiving coach's net revenue for the member's first year; referral recorded before engagement; eligibility rules apply | Same percentage, basis, duration, and registration timing | **Match** |
| Direct recruit profit share | 5% of net profits, up to the recruited coach's cap | 5%, labeled subject to caps and eligibility | **Match** |
| Secondary recruit profit share | 3% of net profits, up to the recruited coach's cap | 3%, labeled subject to caps and eligibility | **Match** |
| Team Builder | Not present in the reviewed Program Terms | “Planned,” “not live,” and “not in current terms”; subject to a future agreement, approval, and performance | **Correctly separated from current terms** |
| Income/lifestyle outcome | No guaranteed outcome | Five-year scene says “Not guaranteed. But intentionally possible.” | **Appropriately qualified** |

## Release posture

- No contractual percentage or cap-mechanics correction was required in the discovery route.
- The on-screen qualifier remains required: “High-level education only. Current GoArrive Program Terms govern eligibility, definitions, timing, calculations, and payment.”
- Do not remove the planned/not-live label from Team Builder until an executed agreement and supporting implementation are current.
- Before production, the legal/product owner must confirm that the 2026 JotForm-derived terms supersede or otherwise align with the 2025 Drive document, and approve the public-facing paraphrase.
