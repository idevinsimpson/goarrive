# Community presence — W8 package

**Status: RESERVATION + START RECORD. No target frames in this commit.**

This package will hold the design-target evidence for the social/community
presence lane: making the member experience visibly feel like a community while
each person still competes only with themselves.

## Start record

| Fact | Value |
| --- | --- |
| Start SHA | `c8f38e37b6286297d1f401834cd9500a675a2923` |
| Base branch | `claude/wsf-app-shell` |
| This branch | `claude/wsf-social-community` |
| Owner decision | 2026-09-22 ~22:23 ET, relayed in #365 comment `5787909127` |
| Predecessor | **#390 (`claude/wsf-community-visibility` @ `670edab`) — SUPERSEDED AS-IS, source material only** |

`c8f38e3` is the accepted member pages + Batch A identity + the accepted Join +
kiosk confinement + `/?view=communities`. It was verified with `git rev-parse
HEAD` at the start of this lane, not assumed from the direction comment.

## Why #390 is superseded rather than continued

#390 built the first mechanism that returns one member's name to another, under
a **private-by-default** rule: `visibility == 'visible'` as an index filter with
no branch below it, so every membership written before the feature simply did
not match. That default is now reversed by owner decision — a missing preference
resolves to **visible inside the community** — so #390 cannot merge as it
stands. Its *engineering* is kept and ported: self-only control with no
`targetUid`, member-only directory, no Champion override, profile fan-out keyed
by uid rather than positionally, bounded pagination with an opaque cursor that
never echoes a uid, the rules/access tests, and the public-invoker pin.

## Boundary this package is built inside

"Public by default" means **community-visible by default to authenticated active
members of that community**. It does not mean internet-public, and it does not
touch QR / public-display / kiosk / station / unauthenticated paths, which stay
aggregate and anonymous. The public `wsfGoalRecentAdditions` payload is not
widened.

## Reserved files

Community page `app/community/[groupId]/index.tsx`; new
`app/community/[groupId]/members.tsx`; `app/you.tsx` (quiet Settings entry
only); new `app/settings.tsx` / `app/settings/privacy.tsx`; `app/index.tsx`
(later Home presence preview only, after checkpoint 1 passes and L0 confirms no
open W4 reservation); new `app/design-target/community-presence.tsx` and
`src/ui/designTarget/CommunityPresenceTargets.tsx`; `tests-e2e/sprint-w8-*`;
`tests/callable/sprint-w8-*` and the functions social/visibility tests;
`functions-westayfit/src/index.ts` for the social/visibility callables only;
`firestore.indexes.json` only if an index is genuinely required (not deployed);
this package; `docs/westayfit/qa/sprint-w8-*.md`.

Not reserved here: the global kit, the shell and brand renderer, Start Community
(W4), goal setup (W6), display (W2), kiosk (W1B), `firestore.rules`, and any
pre-existing board, producer, frozen BEFORE or accepted TARGET/AFTER.
