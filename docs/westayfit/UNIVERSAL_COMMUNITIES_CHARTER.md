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

## Ratification

The charter itself is subject to change; every ratified change gets an entry in `DECISIONS.md`. This document tracks the currently-proposed principles until formally ratified.
