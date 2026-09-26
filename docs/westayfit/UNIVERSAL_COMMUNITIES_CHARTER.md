# We Stay Fit — Universal Communities Charter (Historical Foundation)

> Standing: historical product/architecture foundation, not the current governing WSF
> strategy. Strategic Master v3.0 — The Living WE System (2026-09-11) plus the v3.1
> addendum (2026-09-26) govern current product direction. Retain this file for lineage and
> principles that have not been superseded. Do not use its old milestone references,
> "placeholder" state, or Lovable-era Champion conversion assumptions to override current
> Firebase product behavior.

## Intent

WSF's product wedge is "universal communities" — groups of people who move together across shared identity or geography (workplace, neighborhood, faith community, alumni network, etc.) without needing to become clients of a specific coach. This is distinct from GoArrive's coach-centric model.

## Foundational design principles (historical; current strategy may be more specific)

1. **Community first, individual second.** A user's identity in WSF is primarily their membership in one or more communities; individual profile is secondary.
2. **Low-friction join.** Joining a community must be possible without a payment step, without a coach relationship, and without exposing the user's identity to the whole community until they choose to be visible.
3. **Champion-led, not coach-led.** Communities are stewarded by Champions rather than requiring a paid coach. The historical `champion_campaigns` marketing path is not production authority; active Champion roles belong to trusted Firebase membership/permission records.
4. **No cross-community broadcast without consent.** A champion's actions affect only their community; there is no platform-wide broadcast channel.
5. **No leaderboards by default.** Comparative ranking is off by default and opt-in per community.

## Boundaries To GoArrive

WSF communities do not consume GoArrive coaches, workouts, movements, or programs. If a WSF community wants coaching content, it comes through a separate, deliberate integration point (not built).

## Milestone lineage

The former M-U3 "Interest → App Bridge" / M-U4 "Champion Campaigns Landing Surface"
labels belonged to the Lovable lineage and are superseded for `apps/westayfit`.
See `MILESTONES.md` and the strategic master for current milestone meaning.

## Brand Language

Canonical brand copy for We Stay Fit. Source: *We Stay Fit Universal Communities PM Handoff (Revised 2026-08-31)*, §1.1 and Appendix A.1, supplied by the owner (Devin Simpson) on 2026-08-31; recorded in `DECISIONS.md`:

- **Wordmark:** WE STAY FIT
- **Tagline:** "Turn your community into a place that moves." — exact punctuation.
- **Supporting line:** "Shared challenges. More movement. Stronger communities." — supporting use only, not a substitute for the tagline.

The tagline keeps the community at the center rather than the app, the coach, or the workout — the community is the product. It is not required copy for every screen; sparing contextual variants are acceptable when they serve the tagline.

Rejected by the owner, and not to be reintroduced: "Start a community. Choose a challenge. Invite your people." as the primary explainer (it makes the reader feel responsible for starting or recruiting, when someone should be able to simply *join* what their community is already doing); the word "participation" (too institutional); and apartment-specific language.

Scope: WSF-only. GoArrive brand language is unchanged. No outcome claims (health, ROI, retention, leasing, productivity, growth) derive from this copy.

Corrects: the hierarchy previously recorded here as "Devin-approved 2026-08-27" was not the copy the owner approved, and that approval citation could not be verified; it is withdrawn (see `DECISIONS.md`). The M-U1-era chartered tagline "Wherever your people gather, We Stay Fit." also remains superseded. Historical M-U1 uses, releases, and evidence artifacts are not rewritten.

## Current use

Use this charter only as historical foundation. New product decisions are recorded in the
Strategic Master/addendum and `DECISIONS.md`. The current compact project instructions are
`WE_STAY_FIT_PROJECT_INSTRUCTIONS_v3_1_2026-09-26.txt`.
