# We Stay Fit — Universal Communities Charter

> This document is a placeholder for the charter that governs how WSF universal-community features are built. The charter surface itself is not implemented in M-U1; only the app shell exists.

## Intent

WSF's product wedge is "universal communities" — groups of people who move together across shared identity or geography (workplace, neighborhood, faith community, alumni network, etc.) without needing to become clients of a specific coach. This is distinct from GoArrive's coach-centric model.

## Design Principles (proposed, to be ratified in a later milestone)

1. **Community first, individual second.** A user's identity in WSF is primarily their membership in one or more communities; individual profile is secondary.
2. **Low-friction join.** Joining a community must be possible without a payment step, without a coach relationship, and without exposing the user's identity to the whole community until they choose to be visible.
3. **Champion-led, not coach-led.** Communities are stewarded by "champions" — volunteer members with elevated permissions — rather than by paid coaches. Champions are elevated via `champion_campaigns` submissions (Lovable-side today; conversion path in a future milestone).
4. **No cross-community broadcast without consent.** A champion's actions affect only their community; there is no platform-wide broadcast channel.
5. **No leaderboards by default.** Comparative ranking is off by default and opt-in per community.

## Boundaries To GoArrive

WSF communities do not consume GoArrive coaches, workouts, movements, or programs. If a WSF community wants coaching content, it comes through a separate, deliberate integration point (not built).

## Milestones Referencing This Charter

- M-U3 (Interest → App Bridge) will lean on principle 2 (low-friction join).
- M-U4 (Champion Campaigns Landing Surface) will lean on principle 3 (champion-led).

## Brand Language

Canonical brand copy for We Stay Fit. Source: *We Stay Fit Universal Communities PM Handoff (Revised 2026-08-31)*, §1.1 and Appendix A.1, supplied by the owner (Devin Simpson) on 2026-08-31; recorded in `DECISIONS.md`:

- **Wordmark:** WE STAY FIT
- **Tagline:** "Turn your community into a place that moves." — exact punctuation.
- **Supporting line:** "Shared challenges. More movement. Stronger communities." — supporting use only, not a substitute for the tagline.

The tagline keeps the community at the center rather than the app, the coach, or the workout — the community is the product. It is not required copy for every screen; sparing contextual variants are acceptable when they serve the tagline.

Rejected by the owner, and not to be reintroduced: "Start a community. Choose a challenge. Invite your people." as the primary explainer (it makes the reader feel responsible for starting or recruiting, when someone should be able to simply *join* what their community is already doing); the word "participation" (too institutional); and apartment-specific language.

Scope: WSF-only. GoArrive brand language is unchanged. No outcome claims (health, ROI, retention, leasing, productivity, growth) derive from this copy.

Corrects: the hierarchy previously recorded here as "Devin-approved 2026-08-27" was not the copy the owner approved, and that approval citation could not be verified; it is withdrawn (see `DECISIONS.md`). The M-U1-era chartered tagline "Wherever your people gather, We Stay Fit." also remains superseded. Historical M-U1 uses, releases, and evidence artifacts are not rewritten.

## Ratification

The charter itself is subject to change; every ratified change gets an entry in `DECISIONS.md`. This document tracks the currently-proposed principles until formally ratified.
