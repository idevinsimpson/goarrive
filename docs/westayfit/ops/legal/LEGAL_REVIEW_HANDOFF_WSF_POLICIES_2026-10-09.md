# WE STAY FIT — legal-review handoff: Terms, Privacy, 13+ eligibility, moderation

Status: handoff for the owner and qualified legal review. Prepared by L0/Fable on 2026-10-09 under owner decisions #365 `6074580396` §1 and `6074607727` ("OWNER APPROVES the direction/content … for review; still resolve actual placeholders, consent/moderation/retention, and secure QUALIFIED LEGAL REVIEW before they are labeled published or relied on for unrestricted signups").

This document changes no behavior, gate or setting. It lists exactly what is missing, where the current placeholders sit in code, and what must be true before public sign-up opens. Nothing in it is legal advice.

## 1. Evidence basis (SOURCE INSPECTED)

| Source | Ref | What it says |
| --- | --- | --- |
| Lovable `WE Community Home` drafts | project `e15b9fa0-b2a0-4314-bc21-9c573b8eceb1`, `docs/release-drafts/README.md`, `TERMS-DRAFT.md`, `PRIVACY-DRAFT.md`, `ELIGIBILITY-13PLUS-DRAFT.md` (prepared from Lovable `16233e02`) | "DRAFT ONLY / UNAPPROVED — not for publication." Placeholders are `[[PLACEHOLDER: …]]`, `[[LEGAL REVIEW: …]]`, `[[OWNER DECISION: …]]`. |
| Native app legal text | development `ec162d17`: `apps/westayfit/legal/terms.md`, `apps/westayfit/legal/privacy.md`, `apps/westayfit/src/legalContent.ts` | Both documents are three lines: `Version pending-approval-2026-08-25` and "This text is pending approval and will be replaced before public launch." `tests/legal-content-drift.test.ts` fails the build if `legalContent.ts` and the `.md` files diverge. |
| Consent version pins (client) | `apps/westayfit/src/profileConstants.ts` | `WSF_ACCEPTED_TERMS_VERSION = 'pending-approval-2026-08-25'`, `WSF_ACCEPTED_PRIVACY_VERSION = 'pending-approval-2026-08-25'`. |
| Consent version pins (server) | `functions-westayfit/src/index.ts` L120–125, `wsfSaveProfile` | The same two constants, stamped onto `wsfMemberProfiles/{uid}.acceptedTermsVersion` / `acceptedPrivacyVersion` on create, re-stamped on update only when they differ. Comment: "MUST equal apps/westayfit/src/profileConstants.ts. Bump both files in the same PR." |
| Consent UI | `apps/westayfit/app/profile-setup.tsx` (L45, L134, L242–261) | One checkbox gates submit (`canSubmit = acceptedTerms && …`); two `LegalAccordion` panels show the placeholder texts. There is **no age attestation, date-of-birth field or age gate** anywhere in `apps/westayfit/app`, `apps/westayfit/src` or `functions-westayfit/src` (grep for age/birth/under-13/COPPA/guardian returns nothing). |
| Unverified participants | `functions-westayfit/src/index.ts` ~L139 (`wsfSaveProfile`), owner policy #365 `6041359966` | An authenticated but email-unverified account may save a profile and participate; organizer callables keep their verification gates. The policies must describe this truthfully. |
| Children's effort | `ELIGIBILITY-13PLUS-DRAFT.md`, owner `6074580396` | Owner rule: no under-13 data; a child's movement is never credited to an adult account. Today the product has **no technical enforcement** of either; it relies on policy text and the single-account self-report model (each contribution is the signed-in member's own `wsfContribute`). |

## 2. Placeholders and owner decisions, by document

### Terms of Use (`TERMS-DRAFT.md`)
| § | Placeholder / review item | Who |
| --- | --- | --- |
| 1 | Legal entity name and address ("we"); contact email | Owner |
| 3 | Link target for Eligibility | Owner (once eligibility copy is final) |
| 4 | Account deletion procedure | Owner + legal |
| 7 | Health / assumption-of-risk wording | Legal |
| 9 | Report channel and moderation process; appeal process | Owner + legal |
| 11 | Notice method for material changes | Owner |
| 12 | Warranty disclaimer, limitation of liability, indemnity; governing law; dispute process/venue | Legal |
| — | Effective date | Owner |

### Privacy Notice (`PRIVACY-DRAFT.md`)
| § | Placeholder / review item | Who |
| --- | --- | --- |
| 1 | Responsible entity; privacy contact email | Owner |
| 3 | Profile photo: launch or off (connected mode currently shows initials only) | Owner |
| 6 | Kiosk turn-line retention | Owner + legal (and engineering: `wsfTurnEntries` has no delete and no TTL today, see #365 body "Named seams") |
| 7 | Analytics / cookie notice per jurisdiction | Legal |
| 8 | Optional AI "first step" suggestion: production or off | Owner |
| 9 | Web hosting provider name; AI gateway (if enabled); international-transfer basis | Owner + legal |
| 10 | Retention for accounts, contributions, memberships, kiosk entries, diagnostics; effect of deletion on shared totals | Owner + legal + engineering |
| 11 | Data-subject rights per jurisdiction; contact | Legal |
| 12 | Under-13 contact; teen handling | Owner + legal |
| 13 | Event photography / filming notice | Owner |
| 15 | Notice method; effective date | Owner |

### Eligibility 13+ (`ELIGIBILITY-13PLUS-DRAFT.md`)
| Item | Decision needed | Who |
| --- | --- | --- |
| Minimum age 13 | Confirm; legal to check higher digital-consent ages (e.g. up to 16 in parts of the EU) for launch regions | Owner + legal |
| Members 13–17 | Allowed with no extra step / parental consent required / not allowed in launch region | Owner + legal |
| Attestation form | Checkbox vs statement; date-of-birth vs attestation (a date of birth is new data collection and needs a retention rule) | Owner + legal |
| Under-13 report handling | Contact; who verifies and acts; effect on shared totals | Owner |
| Launch region(s) | Named | Owner |
| Event / kiosk family copy | Wording and venue notice | Legal |

### Moderation (no draft exists yet)
The drafts reference a moderation policy but none is written. Minimum content: what is moderated (community names, goal names, display/called names, photos if launched), who acts, the report channel, response time, suspension/removal and appeal. Owner `6074607727` names moderation as part of the approval; it is still a missing document.

## 3. What has to change in code before "published" (not authorized by this handoff)

1. Replace the three-line placeholders in `apps/westayfit/legal/terms.md`, `apps/westayfit/legal/privacy.md` and the mirrored strings in `apps/westayfit/src/legalContent.ts` with the approved, versioned text (same PR; the drift test enforces it).
2. Bump `WSF_ACCEPTED_TERMS_VERSION` and `WSF_ACCEPTED_PRIVACY_VERSION` in **both** `apps/westayfit/src/profileConstants.ts` and `functions-westayfit/src/index.ts` to the approved version string in the same PR, so new consents are stamped with the real version and existing profiles are re-stamped on their next save.
3. Add the age attestation the owner chooses (checkbox or statement at sign-up/profile setup; server-side record if required) — none exists today.
4. Add the moderation report path the policy promises (at minimum a contact; in-app reporting is a product decision).
5. The Lovable Web Twin shows the same approved texts and the same consent version (Lovable owner; drafts note the app does not link them today).
6. Deploy: the server constant change ships only with the reviewed WSF-only production candidate from `PRODUCTION-FIREBASE-INVENTORY-1` → deploy packet; the client change ships with the Web Twin release. Until both are served, sign-up stays closed to the public.

## 4. Exit criteria for opening public sign-up (owner + legal)
- Qualified legal review recorded for all three documents and the moderation policy, with the reviewer named.
- Every `[[PLACEHOLDER]]`, `[[LEGAL REVIEW]]` and `[[OWNER DECISION]]` resolved; effective dates set.
- Approved version string chosen and present in all four code locations (§3.1–3.2) on the served build, with a DEPLOYMENT RECEIPT for the server constants.
- Age attestation present on the served sign-up path.
- Legal operator / privacy contact reachable.
- Owner acceptance recorded in #365 naming the exact served SHAs.

## 5. Irreducible owner actions right now
1. Name the legal entity, address, privacy contact and report channel (fills most placeholders).
2. Decide the 13–17 handling and the attestation form.
3. Engage the qualified legal reviewer and send them the three drafts plus this handoff.
4. Decide profile photos, event photography and the AI first-step feature for launch (each is a one-word decision that removes an `[[OWNER DECISION]]`).
