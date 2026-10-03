# We Stay Fit — Lovable / Firebase Boundary and North Star Handoff

Reconciled: September 26, 2026.
Governing product strategy: Strategic Master v3.0 + v3.1 addendum.

There are now two completely different uses of Lovable in WSF. Do not conflate them.

## 1. Public marketing Lovable/Supabase

The public WSF marketing/inquiry surface belongs to the Lovable/Supabase lineage.

It may own, within approved scope:
- public marketing/SEO content;
- inquiry leads and business pipeline records;
- approved public pricing/interest content;
- historical/transitional community-candidate or Champion-interest records;
- approved Expo marketing experiments.

It does not own the active WSF membership/contribution system.

Firebase owns active authenticated communities, memberships, permissions, goals,
contributions/check-ins, member settings and the community product.

## 2. WE Community Home Lovable project — North Star only

The project currently used as the member-experience North Star is a design/interaction
laboratory. It is not the public marketing production surface and is not a production
backend.

Its local/synthetic data exists to make visual and interaction behavior concrete enough
to review and port.

Never treat as production authority:
- localStorage state;
- simulated ledgers or confirmation outcomes;
- sample identities, counts, communities or invitations;
- reviewer tools, sample-scenario menus, role switches, coverage sheets;
- prototype-only actions;
- browser-local persistence or timing.

The exact frozen journey reference is recorded in
`docs/westayfit/ops/NORTH_STAR_JOURNEY_MANIFEST.json` or the issued journey packet.
A newer Lovable edit never silently retargets an issued Firebase implementation packet.

## 3. No dual active system

These remain non-negotiable:
1. No permanent dual-write for active community/membership/contribution state.
2. No bidirectional sync to keep an old prototype alive.
3. No automatic conversion of marketing-interest records into active accounts/memberships.
4. No automatic conversion of unreviewed Champion/campaign interest into live community authority.
5. No Supabase Auth as a second permanent member identity system for the WSF community product.

If a historical marketing-side record is ever converted, it requires an explicitly
approved, one-direction, reviewed migration/conversion flow.

## 4. Production system of record

Firebase / `apps/westayfit` owns production community truth, including:
- member profile and membership context;
- community groups and trusted community roles;
- goals/challenges and their lifecycle;
- contribution/check-in records and derived totals;
- member visibility/privacy settings;
- kiosk/station records when those flows are approved;
- publication authorization for aggregate displays.

GoArrive separately owns individualized coaching, tailored plans, Workout Player,
scheduling and coaching billing.

## 5. Porting a North Star journey

Before coding:
- identify the exact frozen Lovable reference;
- identify its states and viewports;
- identify source donor files/tokens when available;
- identify accepted differences where the production platform/data contract must differ;
- reserve the canonical Firebase product files.

During porting:
- preserve Firebase identity, permissions, accounting and recovery truth;
- preserve the visual hierarchy, interaction job, motion/focus intent and app feel;
- do not import prototype data authority.

After porting:
ACTUAL AFTER is compared to the frozen target and independently reviewed. Visual parity
does not prove backend correctness; backend correctness does not waive visual review.

## 6. Historical collection names

Older documents mention records such as `interest_responses` and
`champion_campaigns`. Treat those as marketing/transitional lineage, not a mandate to
re-create their old conversion architecture inside the current Firebase product.
