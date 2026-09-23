# Pending-attempt recovery: what is portable and what is not

**INTENDED DESTINATION:** `docs/westayfit/qa/sprint-w3-pending-portability.md`, on the
`claude/wsf-app-shell` lineage. Parked here because this worker may push only to its own
branch, which does not carry that tree.

**Read at** `a193b43086ee0564b8edf99083ab164c08f9ceff`. Storage-level evidence plus source;
**not** a browser or cross-device runtime run, and it claims nothing about rendering,
routing or the network.

## The contract

| Question | Answer | Where it is established |
| --- | --- | --- |
| Is the pending record itself portable? | **No.** `window.localStorage`, key `wsf.pendingContribution.{goalId}.{uid}` | `src/pendingContribution.ts` — `savePendingNew` / `loadPending`; the module calls it "a LOCAL REMINDER record only" |
| Can the same member read it on another device? | **No** | proven: same uid, two independent storages |
| Can another account inherit it? | **No**, on either device | `pendingKey` scoping; already covered same-device by `contribute-account-isolation.test.ts` |
| Does it survive an unresolved Finish? | **Yes — on the kiosk** | `kioskFinishPlan` sets `clearPendingDraft: false`; `kiosk-session.test.ts` |
| Can the member replay the **same** attempt id from their own device? | **No** — the id exists only where it was written | proven |
| Can the member learn whether the attempt **landed**? | **Yes** | `wsfMyContribution` returns `ownCredit` from `wsfGoalMemberTotals/{goalId}_{uid}`, server-side and durable |
| Does the local record say whether it landed? | **No** — `state` is only `sending \| unknown`; a settled state is not representable | proven |

## Why the distinction matters

Idempotency is keyed `{goalId}_{uid}_{attemptId}`. Replaying a **known** attempt id returns
the original receipt. A **new** attempt id is a new contribution.

So a member who re-enters the amount on their own device — believing they are "resolving"
the attempt the kiosk told them about — submits a *new* attempt id. If the original had
committed, that books a **second** contribution. The recoverable fact is the aggregate
(`ownCredit`), not the attempt.

This also separates the two cases that must not be substituted for each other:

- **aborted before the request was sent** — nothing committed, `ownCredit` unchanged;
  re-entering is correct and books the work once.
- **committed but the response was lost** — `ownCredit` already includes it; re-entering
  double-counts.

`wsfMyContribution` distinguishes them, *provided the member knows their prior total*.
Nothing in the product carries that prior total to them, which is the residual gap.

## Minimum honest copy correction

Current, in `src/kioskSession.ts`:

> Your attempt is saved to your account; check it from your own device.

The second clause is sound — there **is** something to check. The first is not: the attempt
is saved in the kiosk browser's storage under the account's key, not to the account in any
sense that travels. The module's own docstring is the clearest statement of this, describing
the stored record as "the only thing that lets the member ... replay the SAME attempt id"
— a thing that stays on the kiosk.

The smallest correction that stops promising portability, while promising nothing new:

> We don't know whether this was recorded. Check your recorded total for this goal from
> your own device before entering it again.

It drops the "saved to your account" claim, keeps the true instruction, and names the thing
that is actually readable elsewhere. **No new mechanism, no synchronisation feature, and no
schema, backend or API change is proposed or required.**

## Scope

No product, shared test, schema, backend or UI copy was changed. The copy above is a
proposal for the implementation owner, routed by L0. The finding does not touch the kiosk
navigation/sign-out packet, which is W1B's and W5's.
