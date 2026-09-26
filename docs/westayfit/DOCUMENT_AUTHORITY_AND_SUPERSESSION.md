# WE STAY FIT — Document Authority and Supersession Map
Date: September 26, 2026
Status: owner-authorized documentation reconciliation

This file answers one question: when WSF documents disagree, which one should an agent trust?

## 1. Product/business authority

1. Devin's newer explicit decision for its stated scope.
2. WE STAY FIT Strategic Master v3.0 — The Living WE System (2026-09-11), plus the v3.1 addendum (2026-09-26).
3. WE STAY FIT Project Instructions v3.1 (compact operating summary).
4. Accepted repository decisions that implement those boundaries.
5. Accepted scoped milestone/journey records.
6. Older masters, handoffs, transcripts, brainstorms, and demos only as historical/advisory material.

Do not use an older document to override a newer explicit owner decision.

## 2. Visual/interaction authority

For a member-visible journey:
1. Devin's specific current visual/product ruling.
2. The exact frozen journey record in `docs/westayfit/ops/NORTH_STAR_JOURNEY_MANIFEST.json` or its issued packet.
3. Applicable accepted owner North Star board / route-target package.
4. Current Lovable project head only when no journey-specific frozen reference exists.

The current Lovable head never silently retargets already-issued work.

The route-level discipline is:
ACTUAL BEFORE → reviewed TARGET → ACTUAL AFTER → visual acceptance.

## 3. Technical/environment authority

### Product source
Use the exact accepted/integrated WSF product SHA on the canonical development lineage. Do not infer implementation from a target, prototype, or PR title.

### Operational workflow source
Use operational `main` for staging-control workflow/tooling truth.

### Served staging
Use the served build marker and deployment receipt. A branch head, pin, merge, build, or HTTP 200 is not enough.

### Production
Use the named production release receipt only.

## 4. Current state

Volatile program state lives in the canonical CURRENT STATE comment in the Fable/L0 control inbox (#365). It is edited in place.

Repository `CURRENT_STATE.md` is a pointer to that record, not a second mutable status ledger.

## 5. Lovable authority

Two different Lovable uses exist:
- Public marketing/inquiry Lovable/Supabase: production marketing-side surface and records within its approved scope.
- WE Community Home Lovable project: design/interaction North Star laboratory only.

The North Star project does not own production identity, membership, permissions, contributions, totals, or backend truth.

## 6. Document status

| Document | Standing |
| --- | --- |
| Strategic Master v3.0 (2026-09-11) | GOVERNING strategic foundation |
| Strategic Master v3.1 addendum (2026-09-26) | GOVERNING newer durable decisions |
| Project Instructions v3.1 | GOVERNING compact instructions |
| docs/westayfit/ops/NORTH_STAR_JOURNEY_MANIFEST.json | GOVERNING per-journey frozen visual reference |
| docs/westayfit/ops/FABLE_OPERATING_PROTOCOL_v1.md | GOVERNING current coordination/evidence discipline |
| canonical CURRENT STATE comment on #365 | GOVERNING volatile current program state |
| docs/westayfit/WE_STAY_FIT_MASTER.md v1.2 (2026-09-06) | SUPERSEDED product master; retained historical architecture lineage |
| docs/westayfit/UNIVERSAL_COMMUNITIES_CHARTER.md | HISTORICAL FOUNDATION; current product strategy is v3.0 + v3.1 |
| Implementation Plan working draft v0.2 (2026-09-11) | SUPERSEDED execution plan; useful historical acceptance/planning source |
| docs/design-target/* | visual/reference evidence; individual package standing controls its use |
| Appendix C of Strategic Master v3.0 | dated history only |

## 7. Evidence vocabulary

Never collapse:
- SOURCE INSPECTED
- IMPLEMENTER REPORTED
- TEST VERIFIED
- VISUAL VERIFIED
- DEPLOYMENT RECEIPT
- HOSTED VERIFIED
- DEVICE VERIFIED
- OWNER ACCEPTED

A visually accurate prototype is not backend proof. A passing backend test is not a visual verdict. A deployment receipt is not a device pass.

## 8. Change discipline

When a conflict is discovered:
- stop only the affected change;
- identify the conflicting sources;
- apply the correct authority order;
- do not silently rewrite history;
- record a newer decision if product meaning actually changes;
- update this map when a document's standing changes.
