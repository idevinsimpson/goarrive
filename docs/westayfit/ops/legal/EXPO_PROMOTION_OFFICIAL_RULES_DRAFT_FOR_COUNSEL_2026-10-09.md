# WE STAY FIT — Expo movement promotion: Official Rules DRAFT for qualified counsel

**Status: DRAFT FOR COUNSEL. Not published, not approved, not legal advice. Prepared by L0/Fable on 2026-10-09 under owner delta #365 `6075164352` ("prepare reviewer-ready official rules now and identify an actual qualified reviewer/operator"), as an addition to the legal-review handoff in this directory. Nothing here enables, deploys or promises a promotion. The owner's permission to use judgment is not counsel sign-off.**

This document does three things: (1) states the mechanism exactly as the existing server code enforces it, so the rules counsel reviews are the rules the system can keep; (2) gives counsel a complete Official Rules draft with every owner decision and legal question marked; (3) lists what must be built or decided before any promotion is enabled.

Vocabulary: this draft never calls the drawing a "raffle". The owner-supplied sources (§1) indicate that in Georgia a *raffle* is a licensed activity of eligible nonprofit organizations; WE STAY FIT is not operating one. The draft describes a **promotional sweepstakes** (a prize drawing with no purchase or payment and a free alternative means of entry), which counsel must confirm is the correct characterization for the facts.

## 1. Owner-supplied primary sources (to be verified by counsel; not characterized as law here)

| Source | Owner's reading (#365 `6075164352`) |
| --- | --- |
| Georgia O.C.G.A. §16-12-22.1(a)–(c) — https://law.justia.com/codes/georgia/title-16/chapter-12/article-2/part-1/section-16-12-22-1/ | License-based chance raffles are limited to eligible nonprofit organizations licensed by the county sheriff; the statute reaches chance prizes given in return for paid or promised *consideration*, not merely a fee labelled "ticket". |
| Fulton County Sheriff raffle license statute/application — https://www.fultoncountyga.gov/-/media/Departments/Sheriff/Raffle-License-Application-%281%29.pdf | The licensing path that applies to nonprofit raffles; cited to show what WE STAY FIT is *not* doing. |
| Georgia AG Consumer Protection, "Top 10 consumer myths" — https://consumer.georgia.gov/consumer-topics/top-10-consumer-myths | Legitimate sweepstakes must not require payment or purchase. |
| Georgia AG Consumer Protection, "Gym promotions" — https://consumer.georgia.gov/gym-promotions | Promotions need clear prize value, odds, eligibility/coverage and a winners list (subject to the facts). |

**Questions for counsel that these sources raise (the owner's implication, restated as questions):**
1. Is completing a physical movement challenge "consideration" (effort) under Georgia law and under the other jurisdictions of likely entrants, such that a free alternative means of entry (AMOE) requiring no exercise and no membership is needed to keep the promotion a sweepstakes rather than a lottery? The draft assumes **yes, an AMOE is required** until counsel says otherwise.
2. Is membership in a WE STAY FIT community (free, but requiring an account and acceptance of Terms) itself consideration? The draft assumes the AMOE must also be open to non-members.
3. Minimum age for *prize eligibility* (the product's membership eligibility is 13+ in draft; prize eligibility is commonly 18+ with a parent/guardian claiming for a minor). The draft marks this as an owner + counsel decision.
4. Registration/bonding thresholds in other states if entrants are not Georgia-only (the expo is in Alpharetta, Georgia; members may live elsewhere).
5. Whether a publicity release, a winners-list obligation, and specific disclosures (ARV, odds, sponsor identity, dates) apply exactly as the AG guidance describes.

## 2. The mechanism the code enforces (SOURCE INSPECTED at development `ec162d17`, `functions-westayfit/src/expo-prize/**`, `docs/westayfit/expo-prize/CONTRACT.md`)

The server-only prize core exists, is reviewed and integrated on the development branch, and is **deliberately not exported, not deployed, not enabled**. A promotion is a configured, versioned, server-only record that awards nothing until an operator enables it. Every rule clause below must match one of these enforced facts, or it cannot be promised.

| Rule clause | What the code enforces | Where |
| --- | --- | --- |
| Rules version | `ruleVersion` is a positive integer stored on every source and entry; the promotion's configuration is digested at enablement and any later edit is refused as drift. The Official Rules version counsel approves must be the `ruleVersion` the operator enables. | `policy.ts:40,92-95`; CONTRACT §d |
| Entry by movement | One **qualifying completed challenge** (one durable `wsfContributions/{goalId}_{uid}_{attemptId}` row inside the window) is at most one entry, **regardless of repetitions**: 1 rep and 100 reps are the same entitlement; the count is read but never used. Phone and kiosk completion of the same attempt are one entry. Corrections never create or revoke entries automatically. | CONTRACT §1(a) "Decisions"; `adjudicate.ts` |
| Repeat rule | Required, no default: `perContribution` (each distinct accepted contribution is an entry) or `perGoal` (one entry per listed goal per entrant). The published rule must state which. | `policy.ts:34,97-103` |
| Eligible activities | Only the goals listed in `eligibleGoals` (goal id + community) count; a combined-goal parent never counts; the list is fixed at enablement. | `policy.ts:45,123-142`; CONTRACT §1(a) |
| Promotion period | `windowStartsAt`/`windowEndsAt` are required; a contribution counts iff its own server commit time (`createdAt`) falls inside the window; wall-clock at processing time is irrelevant; the close/freeze steps prove the cutoff on the server clock. | `policy.ts:54-55,146-156`; CONTRACT §d, §d″ |
| Entrant cap | Explicit: a positive integer or an explicit `null` (no cap); cannot be added or changed after any admission. If set, the rules must disclose it. | `policy.ts:43,106-120`; CONTRACT §d′ |
| Operators | `operatorUids` must name at least one server-known uid; community Champions are **not** operators by role. The named operator is an owner decision and will appear in the rules as the administrator contact. | `policy.ts:53,158-176` |
| Bonus entries for a form | `formBonusEntries` (integer ≥ 0) can award a one-time bonus for a server-verified community-interest form receipt — but the trusted form store is **not built**, and a promotion with `formBonusEntries > 0` **cannot be frozen** (`formSourceUnbound`). The first promotion must set `formBonusEntries: 0` unless that store is built and reviewed. | `policy.ts:57,179-185`; `freeze.ts:15,376` |
| Privacy of entrants | Entrants are opaque random ids; the only place a uid meets an entrant is `wsfPromotionEntrantLinks`; entries, tallies and the frozen pool hold no name, email, phone, uid, count or attempt id. All promotion collections are Admin-SDK-only (client default-deny). | CONTRACT §1(b) |
| Pool and ticket numbers | After close, a freeze pass produces an immutable pool of contiguous ticket ranges per entrant (`wsfPromotionPools`), digest-sealed; `pending`/`revoked` entries carry no ticket. The winning *ticket number* is drawn from `[1, totalTickets]`; the pool maps it to one opaque entrant. | CONTRACT §d″; `pool.ts`, `freeze.ts` |
| Free alternative means of entry (AMOE) | **Designed, not built**: the schema reserves a `paperSlip` entrant (`identityBasis: 'paperSlip'`, never an account or a contribution), but no code writes one. An AMOE path must be built and reviewed if counsel requires it. | CONTRACT §1(b); no `paperSlip` writer in `src/expo-prize/**` |
| Winner notification and claim | **Not built**: `wsfPromotionContacts` (the private prize-only contact record) has a schema and no writer; no draw, reveal, claim, affidavit, alternate-winner or publicity step exists. | CONTRACT status line; `award.ts:50` is a collection name only |
| "My entries" receipt | Built, delivered, **not accepted**: a private per-member read of own ticket count (`receipt.ts`, EXP3A). Not part of any promise until accepted and wired. | `docs/westayfit/expo-prize/README.md` |
| Fail-closed default | With no promotion document, every callable the wiring adds answers "no promotion" and the trigger is a no-op; the enable step refuses any missing or invalid decision rather than defaulting. | CONTRACT §d′; packet `EXPO-PRIZE-WIRING-2` (#365 `6075293756`) |

## 3. Draft Official Rules (for counsel; every bracket is a decision or a review item)

> **NO PURCHASE, PAYMENT OR MEMBERSHIP NECESSARY TO ENTER OR WIN. A purchase or payment will not increase your chances of winning. Void where prohibited. [[LEGAL REVIEW: confirm the standard disclaimer wording for Georgia and any other state in scope.]]**

**1. Sponsor and administrator.** The promotion ("Promotion") is sponsored by [[OWNER DECISION: legal entity name, address]] ("Sponsor") and administered by Sponsor's named operator(s) [[OWNER DECISION: operator name(s) and the account(s) recorded as `operatorUids`]]. Contact: [[OWNER DECISION: promotion contact email]]. Sponsor is not a nonprofit organization and this Promotion is not a raffle or other licensed game of chance. [[LEGAL REVIEW: confirm this sentence is appropriate or should be removed.]]

**2. Promotion period.** The Promotion begins [[OWNER DECISION: date/time, America/New_York]] and ends [[OWNER DECISION: date/time]] (the "Promotion Period"). Sponsor's server clock is the official timekeeper: a movement entry counts only if the server records its completion inside the Promotion Period. [[Code: `windowStartsAt`/`windowEndsAt`; cutoff on the contribution's own `createdAt`.]]

**3. Eligibility.** Open to natural persons who, at the time of entry, are [[OWNER DECISION + LEGAL REVIEW: minimum age for prize eligibility, e.g. 18 or older; or 13–17 with parent/guardian consent and claim]] and legal residents of [[OWNER DECISION: Georgia only / the United States / other]]. Employees, contractors and operators of Sponsor, and their immediate family and household members, are not eligible. [[LEGAL REVIEW: any additional exclusions; registration or bonding thresholds in other states if not Georgia-only.]]

**4. How to enter.**
(a) **Movement entry.** During the Promotion Period, members of a participating WE STAY FIT community who complete a qualifying movement challenge listed in Appendix A receive one (1) entry per [[OWNER DECISION: "completed challenge" (`perContribution`) / "listed challenge, once" (`perGoal`)]]. The number of repetitions performed does not change the number of entries; one completed challenge is one entry. Completing the same attempt on a phone and at a kiosk counts once. [[Code: one `wsfContributions` row = at most one entry; count never used.]]
(b) **Free alternative entry (no exercise, no account required).** [[LEGAL REVIEW: required? If required:]] During the Promotion Period, any eligible person may obtain one (1) entry per [[OWNER DECISION: day / Promotion Period]] by [[OWNER DECISION: completing a paper entry slip at the Sponsor's expo table / mailing a hand-printed card to the Sponsor's address / completing a no-exercise web form]] with their name and a contact method. Free alternative entries have the same value and the same odds per entry as movement entries. [[Build: the `paperSlip` entrant path is designed in the schema and not built; it must be built and reviewed before this clause can be published.]]
(c) **Limits.** [[OWNER DECISION: maximum entries per person; whether an entrant cap applies (`entrantCap`) and its number; if a cap applies, state "the first N eligible entrants" rule exactly as the server applies it.]] Sponsor's records are final as to the number and timing of entries.
(d) **Bonus entries.** [[OWNER DECISION: none in this Promotion (recommended for the first promotion: `formBonusEntries: 0`, because the verified form store is not built).]]

**5. Odds.** Odds of winning depend on the total number of eligible entries received. [[LEGAL REVIEW: whether estimated odds or a maximum-entries statement is required.]]

**6. Prize(s).** [[OWNER DECISION: for each prize: description, quantity, approximate retail value (ARV), the provider/sponsor of the prize, any restrictions, and whether a cash alternative is offered.]] Total ARV of all prizes: [[OWNER DECISION]]. No substitution or transfer except by Sponsor; Sponsor may substitute a prize of equal or greater value. Winner is responsible for any taxes. [[LEGAL REVIEW: 1099 threshold language if ARV ≥ USD 600; sales-tax and shipping statements.]]

**7. Winner selection.** On or about [[OWNER DECISION: draw date/time]], after the Promotion Period closes and the entry pool is frozen, Sponsor's operator will select [[OWNER DECISION: number]] potential winner(s) by random drawing of a ticket number from the sealed entry pool, in the presence of [[OWNER DECISION: a witness / an independent judge]]. Each entry is assigned a unique ticket number; the drawn number identifies the entry. [[Code: immutable pool with contiguous ticket ranges per entrant; draw step not yet built — the random selection procedure and its audit record must be built and reviewed before this clause can be published.]] Decisions of Sponsor are final.

**8. Winner notification and claim.** Potential winners will be notified by [[OWNER DECISION: email on file / in-app notice / announcement at the expo]] within [[OWNER DECISION: N]] days and must respond and [[OWNER DECISION: claim in person at the expo / provide a mailing address]] within [[OWNER DECISION: N]] days. A potential winner who is a minor must claim through a parent or legal guardian. Failure to respond, ineligibility, or refusal results in forfeiture and an alternate drawing. [[LEGAL REVIEW: affidavit of eligibility / liability release / publicity release requirements by state.]] [[Build: contact capture (`wsfPromotionContacts` writer), claim and alternate-draw steps are not built.]]

**9. Consent and privacy.** Entry into the Promotion is voluntary and separate from using the WE STAY FIT service; completing a challenge does not enter you unless you have opted into the Promotion. [[OWNER DECISION + Build: an explicit, separate opt-in is not implemented today; the server adjudicates every eligible contribution of a member of a listed community. Either (i) add an opt-in flag the adjudicator checks, or (ii) counsel confirms that disclosure at challenge time plus the rules link is sufficient. Recommended: (i).]] Sponsor stores entries under an anonymous entrant identifier; no name, email or phone is stored with an entry. Contact information is collected only from potential winners for prize delivery and is deleted after [[OWNER DECISION: retention period]]. Personal information is handled under the WE STAY FIT Privacy Notice [[LINK after approval]]. [[LEGAL REVIEW: winners-list publication (first name, last initial, city/state) and any consent needed for it.]]

**10. General conditions.** Sponsor may disqualify any entry it determines to be fraudulent, automated, tampered with or in violation of these rules; movement entries are only those recorded by Sponsor's server from a member's own account (an adult's account is never credited with a child's movement). Sponsor may cancel, suspend or modify the Promotion if fraud, technical failure or any other factor beyond its control impairs its integrity, in which case prizes will be awarded from eligible entries received before the action. [[LEGAL REVIEW: force majeure, limitation of liability, release of Sponsor and prize providers, dispute resolution and governing law: Georgia, venue [[OWNER DECISION: county]].]]

**11. Winners list.** For the name of the winner(s), send a request to [[OWNER DECISION: email / address]] within [[OWNER DECISION: N]] days after the drawing. [[LEGAL REVIEW: required form of the list.]]

**12. Rules version.** These are Official Rules version [[N]] ("`ruleVersion` [[N]]"), approved on [[date]] by [[counsel name]]. A promotion is enabled only under this exact version; any change produces a new version and a new approval.

**Appendix A — Qualifying challenges.** [[OWNER DECISION: the community name(s) and each listed goal (name, community, challenge definition) exactly as they will appear in `eligibleGoals`.]]

**Appendix B — Expo venue notice.** [[OWNER DECISION + LEGAL REVIEW: signage text at the expo table stating no purchase necessary, how to enter without exercising, the prize(s) and ARV, the dates, and where the full rules are posted.]]

## 4. What must exist before any promotion is enabled (none of it exists today)

| Item | Owner | State |
| --- | --- | --- |
| Official Rules v1 approved by named counsel; `ruleVersion` = 1 | Devin + counsel | draft (this document) |
| Sponsor entity, operator uid(s), prize list with ARV, window, eligible goals, repeat rule, cap | Devin | `[[OWNER DECISION]]` throughout §3 |
| Central wiring: operator-only enable/status/receipt callables + contribution trigger, nothing enabled by default | W9 `EXPO-PRIZE-WIRING-2` (#365 `6075293756`), ops-source + security review | queued |
| Free alternative entry (paper-slip entrant writer, operator entry) | new packet if counsel requires AMOE | not built |
| Separate voluntary opt-in checked by the adjudicator | new packet if counsel requires it | not built |
| Draw procedure with audit record; winner contact capture; claim; alternate draw | new packet(s) | not built |
| Rules display at challenge time and at the expo table; winners-list process | Lovable Web Twin owner + Devin | not built |
| Deployment of the wiring to the environment in use (staging for a trial, production for the expo), with a DEPLOYMENT RECEIPT | L0 + Devin (production path per `PRODUCTION-DEPLOY-PATH-1`) | not deployed |
| Security review seat (the same open seat as PR #595) | Devin (#365 `6075009388`) | open |

**Without all of the above, the honest expo answer is: the prize drawing is not available; any paper-only drawing run at the booth is a separate, manual promotion that counsel must also clear.**

## 5. Qualified reviewer and operator: what the owner must name

1. **Qualified reviewer:** an attorney licensed in Georgia with promotions/sweepstakes practice (or a sweepstakes administration firm working with such counsel), who reviews §3 and the Terms/Privacy/eligibility drafts together and is named in §3 clause 12. L0 cannot select or engage counsel; the engagement is Devin's.
2. **Operator(s):** the person(s) whose uids go into `operatorUids` and who sign the draw's audit record; cannot be a community Champion by role alone.
3. **Sponsor and prize provider(s):** entity names, ARV, and who fulfils the prize.
4. **The six policy values:** rule version (1), repeat rule, entrant cap or none, eligible goals, window, operators — the enable step refuses to run without each.

Nothing in this document is legal advice, and nothing in it is enabled until the exit criteria in §4 are met and recorded in #365.
