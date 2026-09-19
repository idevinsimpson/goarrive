# Hosted harness compatibility delta (proposal only — NOT applied to main)

Final for the Checkpoint D candidate head `5af29f48df73745e500f99cfbf26a64e8d0cd085`
(PR #327, draft, base `3560936b`). Scope of the eventual ops PR: this harness file, the
`approved-candidate.json` SHA/metadata, and any workflow contract pins — no product source.

Target: `.github/wsf-staging/hosted-package-e-smoke.mjs` on `main` (verified for the Package E
candidate `8e1a3ed4`). The UI candidate on `claude/wsf-ui-member-experience` changes the
interface the harness drives and the public `wsfGoalPulse` shape. Every item below is a
matched change the harness needs before that candidate can be staged. No item weakens a
privacy or accounting assertion; each is either a new interaction the real UI requires, a
copy string the approved UI now renders, or the explicitly approved public contract.

## A. Champion controls now live in the Manage sheet (Community Home A2)

Every place the harness navigates a Champion to `/community/{groupId}` and then locates
`wsf-goal-display-auth-*` directly must first open the real management surface:

```js
async function openManage(page) {
  await visible(page.getByTestId('wsf-community-manage'));
  await page.getByTestId('wsf-community-manage').click();
  await visible(page.getByTestId('wsf-community-manage-panel'));
}
```

Call sites (line numbers from `main`):
- `caseRoundTrip`: after `champion.goto(...)` (≈342) and after `champion.reload()` (≈399).
- `caseUncertainAndPerGoal`: after `champion.goto(...)` (≈463).
- `caseRace`: after `champion.goto(...)` (≈541).

Assertions unchanged: control/toggle/state/unsettled/dismiss/confirmed-absent testIDs, the
per-goal isolation checks, `readAuthorization(...)` persistence checks.

## B. Champion state copy (checkpoint C publication decision)

- `textEquals(state, 'Public display is not authorized for this goal.')` — unchanged (the
  state element keeps exactly this text; the new explanation is a separate element
  `wsf-goal-display-auth-explain-{goalId}`).
- `textContains(state, 'Public display is authorized for this goal.')` — unchanged
  (the authorized text now continues "It can show the community name, goal, period, and
  shared progress — never individual contributions or member names.").
- `textContains(confirmed-absent, 'Public display has been removed')` — unchanged.

## C. Contribution screen copy (checkpoint B/B2)

`caseRoundTrip` (≈380–382), member visits `/contribute/{goalId}` after a callable-made
contribution of 137:
- `textEquals(own-credit, 'Your confirmed credit: 137 squats')` →
  `textEquals(member.getByTestId('wsf-contribute-own-credit'), 'Your total on this goal: 137 squats')`
- `textEquals(shared-total, '137 squats')` →
  `textEquals(member.getByTestId('wsf-contribute-shared-total'), '137 of 5,000 squats')`
  (the fixture target is 5,000; `formatCount` groups thousands).
- `visible(member.getByTestId('wsf-contribute-screen'))` — unchanged (a cold link without
  `mode` lands on the entry screen, which carries the root testID).

## D. Public `wsfGoalPulse` contract (checkpoint C, owner decision 2026-09-18)

`caseRoundTrip` (≈366–368) asserts `!('contributorCount' in publicPulseData)` — unchanged and
still true. ADD an exact-key assertion so the hosted run pins the approved contract:

```js
const APPROVED = ['communityDisplayName','endsAt','goalTitle','sharedTotal','startsAt','status','target','timezone','unit'];
assert(JSON.stringify(Object.keys(publicPulseData).sort()) === JSON.stringify(APPROVED),
  `Public goal pulse shape drifted: ${Object.keys(publicPulseData).sort().join(',')}`);
assert(publicPulseData.communityDisplayName === `Package E roundtrip`, 'Public pulse community name mismatch');
assert(publicPulseData.goalTitle === `Package E roundtrip goal 1`, 'Public pulse goal title mismatch');
for (const f of ['joinCode','joinPolicy','groupType','createdByUserId','memberCount','contributorCount'])
  assert(!(f in publicPulseData), `Public pulse leaked ${f}`);
```

`caseProtectedOwnCredit` (≈447): the former-member replay loop over
`['sharedTotal','target','unit','status']` stays valid (the replay withholds shared state
entirely; it never carried context).

## E. Display screen

- `wsf-display-not-available`, `wsf-display-recheck`, `wsf-display-screen`,
  `wsf-display-shared-total`, `wsf-display-closed` — all preserved.
- `wsf-display-shared-total` is now the bare number inside the total line
  (`textContains(..., '137')` / `'241'` keep working; `getByText('241').count() === 0` after
  refusal keeps working).
- ADD, after the authorized display becomes visible (≈363):
  `await textEquals(display.getByTestId('wsf-display-community'), 'Package E roundtrip');`
  `await textEquals(display.getByTestId('wsf-display-goal-title'), 'Package E roundtrip goal 1');`
  and, after each refusal (≈386, 393, 407, 587–595):
  `assert((await display.getByText('Package E roundtrip').count()) === 0, 'Refused display leaked community name');`
- The race case's `held2.body.includes('241')` check is unchanged; the held body now also
  contains the context fields, which the same "not repainted" assertion covers.

## F. Nothing else

No change to `verify-deployment.mjs`, the workflow, the approval file, cleanup provenance,
the Auth/Firestore fixture seeding, or any privacy assertion. The four approved-candidate
fields in `verify-deployment.mjs` are untouched by this candidate.

## G. Display period pinned in the goal's zone (checkpoint C2)

The hosted fixture goals are seeded with `timezone: 'America/New_York'` and a window
computed from `Date.now()` (see `seedFixture`, ≈223). After the authorized display becomes
visible, pin the period label to the fixture's own zone rather than the runner's:

```js
const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' });
await textEquals(display.getByTestId('wsf-display-period'), `Open · Ends ${fmt.format(new Date(fixtureEndsAtIso))}`);
```

where `fixtureEndsAtIso` is the `endsAt` the harness wrote for that goal (keep it in the
fixture record). For the closed step (≈403), assert `wsf-display-period` equals the New York
`Mon D – D` rendering of the fixture's `startsAt`/`endsAt`. If the harness cannot easily
retain the instants, a weaker but still zone-safe check is acceptable: assert the label does
not equal the UTC rendering when the two differ.

## H. Community Home after Checkpoint D (no harness change needed)

Checked against every `wsf-community-*` reference in the `main` harness:
- `wsf-community-goal-link-{goalId}` (≈355) and `wsf-community-goal-closed-{goalId}` (≈400)
  are preserved with the same meaning (featured/secondary goal link; closed goal card).
- The goal window on Community Home is now rendered from the pulse in the goal's zone under
  `wsf-community-goal-period-{goalId}` ("Open · Ends Mon, Oct 5" / "Aug 1 – 15"), and the
  freshness line reads "Confirmed h:mm AM". The harness asserts neither; nothing to change.
  If the ops PR wants to pin it, use the same `Intl.DateTimeFormat` recipe as section G.
- `goalPercent.ts` (integer/bar percent) is deleted from the app; the harness never imported
  app modules, so nothing references it.
- Closed-unreached display now reads "N% complete" like every other surface (previously
  "N% of our goal"). The harness asserts no percent text.

## I. Overnight hardening run 2026-09-18 (Tasks 1–7) — no additional harness change

Re-checked every selector the `main` harness uses (23 distinct: the `wsf-display-*`, `wsf-goal-display-auth-*`,
`wsf-community-goal-link-*` / `-closed-*`, `wsf-contribute-screen` / `-shared-total` / `-own-credit`, and the
sign-in ids) against the overnight head. All preserved with the same meaning. Notes:
- `wsf-goal-display-auth-unsettled-{goalId}` / `-toggle-{goalId}` / `-dismiss-{goalId}` can now also render
  from the Manage sheet's orphan-outcome block when the goals list is not loaded (D-7 fix). Each goal renders at
  most one of the two, so `getByTestId` stays unambiguous; the harness's flows keep the list loaded and hit the
  card path as before.
- A landed revoke on a closed goal now settles as `wsf-goal-display-auth-confirmed-absent` instead of an
  unsettled "could not confirm" (D-15). The harness asserts the confirmed-absent copy on that path already.
- Community Home's footer/shell "Back to home" / "Sign in" links are now buttons with testIDs
  (`wsf-community-home-link`, `wsf-community-signin`, `wsf-community-not-member-home`, `wsf-community-error-home`);
  the harness does not click them.
- The Champion state text for an authorized goal is unchanged; a sample community adds a separate
  `wsf-goal-display-auth-sample-note-{goalId}` element (the hosted fixture is not a sample community).
- Contribute's compact context gained `wsf-contribute-context-updated` ("Confirmed h:mm") and
  `wsf-contribute-context-percent`; `wsf-contribute-shared-total` text is unchanged ("137 of 5,000 squats").
