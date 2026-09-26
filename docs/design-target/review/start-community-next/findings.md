# `/start-community` — four findings, reported not patched

Source tree `39799c3fda875521a39566a6f06375d962f46c41`. None of these were
fixed in this branch: `app/start-community.tsx` and `src/callableErrors.ts`
are outside this worker's ownership, and a bounded patch with exclusive
ownership is the lead's to assign. Each is reproducible from the producer in
this package.

---

## F1 — a refusal and an unconfirmed result render as the same sentence, and the sentence asserts something the client cannot know

**Severity: HIGH.** It can cost a member a duplicate community, and the wording
is what leads them into it.

**Where.**
`apps/westayfit/app/start-community.tsx:171-173` — one `catch` for everything:

```ts
} catch (e) {
  setError(describeCallableError(e, 'We couldn’t create your community. Try again.'));
}
```

`apps/westayfit/src/callableErrors.ts:23-32,80-95` — seven codes collapse into
one sentence:

```ts
const NETWORK_SENTENCE = 'We couldn’t reach the server. Check your connection and try again.';
const NETWORK_CODES = new Set([
  'internal', 'unavailable', 'deadline-exceeded', 'unknown', 'cancelled', 'aborted', 'data-loss',
]);
```

**Why it is wrong.** `deadline-exceeded`, `unknown`, `cancelled` and `aborted`
are consistent with a request the server **received and completed**.
`wsfCreateCommunity` (`functions-westayfit/src/index.ts`) writes the group,
membership and profile update in a `db.runTransaction`; that transaction is
atomic **server-side**, which says nothing about whether the response reached
the client. The callable carries **no attempt key**, so there is nothing for a
retry to deduplicate against. The screen nonetheless states the server was not
reached, and tells the member to try again.

**Reproduction.** `sprint-w4-start-community-next-capture.spec.ts`, the
`start-failed-INJECTED-NETWORK-*` shot: route `wsfCreateCommunity` to
`route.abort('failed')`, submit a valid form, read `wsf-start-error`. Frames:
`before/start-failed-INJECTED-NETWORK-390x844.png`
(`75947cfde775505d`), `…-390x640.png` (`d41430a519e3e181`).

**Note on scope.** This is the same defect class as the join-code copy
corrected in PR #417 (`JOIN_UNCONFIRMED_TITLE`), on the other callable and with
a worse consequence — a join retry is idempotent against an existing
membership, a create retry is not.

---

## F2 — the ACCEPTED target for this route makes a stronger version of the same claim

**Severity: HIGH, and it is the reason this checkpoint exists.** Implementing
the accepted target as drawn would ship the defect rather than fix it.

**Where.** `apps/westayfit/src/ui/designTarget/JoinSetupTargets.tsx`,
`Frame id="start-failed"`:

```tsx
error="Nothing was created. Check your connection and try again."
```

Accepted frames: `docs/design-target/review/batch-b-join-and-setup/TARGET-start-failed-*.png` (6 files).

**Why it is wrong.** "Nothing was created" is a claim about the server's state.
The client observed a transport failure; it observed nothing about the server.
Under `deadline-exceeded` the statement is not merely unproven, it may be
false.

**Not patched here on purpose.** Those six frames are accepted evidence and
this packet authorised no rebaseline of them. The correction is drawn as
`start-next-unconfirmed` under a new id, on its own route, so the accepted
frames stay byte-exact and stay reproducible from their own unchanged sources.
`check-evidence-intact.mjs` is green on this branch (`20 accepted paths, no
byte changed`).

---

## F3 — a confirmed creation whose navigation fails is rendered as a create failure

**Severity: MEDIUM.** Rarer than F1, and strictly worse when it happens: the
community exists, the member is told it does not, and the only action offered
creates a second one.

**Where.** `apps/westayfit/app/start-community.tsx:162-174`:

```ts
const result = await fn({ displayName: trimmedName, groupType, joinPolicy });
const groupId = result.data.groupId;
router.replace(`/community/${groupId}`);   // ← inside the same try
} catch (e) {
  setError(describeCallableError(e, 'We couldn’t create your community. Try again.'));
}
```

A throw from `router.replace` — or from anything after the awaited call — lands
in the same catch. It carries no `code`, so `describeCallableError` returns the
**fallback**: "We couldn't create your community. Try again." for a community
that demonstrably exists, since `groupId` was in hand one line earlier.

**Reproduction.** Not photographed: forcing a `router.replace` throw requires
patching the route, which is out of scope here. The defect is on the page — the
awaited call and the post-success navigation share one `try`, and the fallback
string is unconditional. PR #417 fixed the identical shape on `/join/[joinCode]`
by narrowing the catch to the awaited call and giving the post-success work its
own `try`; the same narrowing applies here.

**Drawn as** `start-next-created`: note tone, "Your community is ready.", and
one action that opens the returned `groupId`.

---

## F4 — the form accepts a name the server will refuse, and the refusal never names the length

**Severity: LOW.** No data is lost and no duplicate is created; it is a wasted
round trip and an unhelpful sentence.

**Where.** `apps/westayfit/app/start-community.tsx` — `NAME_MIN_LENGTH = 2`
and **no maximum**. `functions-westayfit/src/index.ts:134`:

```ts
if (displayName.length < 2 || displayName.length > 80) {
  throw new HttpsError('invalid-argument', 'displayName must be 2-80 characters.');
}
```

`describeCallableError` correctly suppresses that string — `looksLikeDeveloperText`
matches both `displayName` and `must be` — and falls back to
`CODE_SENTENCES['invalid-argument']`: "Something about this didn't look right.
Check the details and try again." Correct not to leak the field name; it also
never tells the member the problem is length.

**Reproduction.** The producer types 120 characters, asserts
`wsf-start-name-error` has count 0 and the input value has length 120. Frames:
`before/start-name-over-80-accepted-390x844.png` (`12f52d3a20d8dccd`),
`…-390x640.png` (`347990995f7c2195`).

**Drawn as** `start-next-name-too-long`, stating the ceiling the callable
actually enforces, before a request is sent.

---

## The deliberate mapping — which codes are a refusal and which are not

Asked for at `5787041281`. Not every error is a definitive refusal, and the
split is not a judgement call: it is whether the **server answered**.

| What `wsfCreateCommunity` / the SDK produces | The server answered? | Presentation |
|---|---|---|
| `unauthenticated` | yes | the existing **signed-out gate** — unchanged, still its own frame |
| `failed-precondition` · *"Verify your email…"* | yes | the existing **unverified gate** — unchanged, still its own frame |
| `failed-precondition` · *"Complete your profile…"* | yes | **refusal** → `start-next-refused`. Thrown inside the transaction, so no gate catches it first and it lands in the form |
| `invalid-argument` (name, groupType, joinPolicy) | yes | **refusal** in the form. The length case is stated client-side first (`start-next-name-too-long`) so it does not need a round trip |
| `permission-denied`, `not-found`, `resource-exhausted`, `already-exists` | yes | **refusal** in the form, with the existing `CODE_SENTENCES` wording |
| `deadline-exceeded`, `unknown`, `cancelled`, `aborted`, `data-loss` | **no** | **unconfirmed** → `start-next-unconfirmed` |
| `unavailable` | **no** | **unconfirmed**. It usually means the request never left, but the client cannot prove that, and the cost of being wrong is a duplicate community |
| callable `internal` carrying a member sentence | yes | **refusal**, sentence passed through as today |
| callable `internal` carrying only the bare code | **no** | **unconfirmed** — this is the SDK's transport failure wearing a server code |
| a throw **after** the awaited call resolved | n/a — it already succeeded | **created** → `start-next-created` |

The two existing gates stay distinct and untouched. Nothing here renders
server-provided developer text; `looksLikeDeveloperText` keeps doing that job.

---

## F5 — there is no way to send a member to the profile step and back to creation

**Severity: LOW as a defect, but it bounds what `start-next-refused` may promise.**

The Director's correction asks the profile-precondition refusal to offer "a
return to creation using existing navigation support". **That support does not
exist.** `apps/westayfit/app/profile-setup.tsx:157` finishes with:

```ts
router.replace(nextRouteAfterAuth('/') as never);
```

and `apps/westayfit/src/pendingJoinCode.ts:96-104` resolves exactly three
stored returns — a pending join code, an event return, a kiosk return goal —
falling back to the caller's string. There is no slot for `/start-community`,
and `profile-setup` reads only an `edit` param. No route in
`apps/westayfit/app` takes a generic `next` / `returnTo` / `from` param
(searched; zero matches).

Adding one would be a fourth stored return — **new storage**, which this packet
rules out. So the frame draws the profile step as the way forward and
**promises nothing about coming back or about the form being kept**. After the
profile step the member lands on Home, as they do today.

**If a return is wanted**, the smallest honest shape is a fourth resolver
alongside the existing three, written and consumed the same way. That is a
product change to files outside this worker's set, and it is not proposed here
— only costed.

---

## F6 — "Check your communities" has no destination that reliably shows the list

**Severity: MEDIUM, and it blocks half of the second correction.**

The correction asks that the action reach "the EXISTING member community list
rather than merely `/`". The list exists — `MyCommunitiesList`,
`apps/westayfit/app/index.tsx:416`, under the eyebrow "Choose a community" —
but it is rendered **only** by `/`, and only when `/` decides not to open a
community instead:

```ts
const openable = resolveCurrentCommunity(user?.uid ?? null, items.map(i => i.groupId));
useEffect(() => { if (openable) router.replace(`/community/${openable}`); }, [openable]);
```

`resolveCurrentCommunity` (`src/currentCommunity.ts:51-65`) returns a community
when a remembered id is still in `memberOf`, **or** when there is exactly one.
No other route renders the list: `/you` resolves to a single community and
shows a `pickCommunity` state when it cannot, and `/activity` aggregates across
communities without listing them as destinations. Nothing takes a param that
suppresses the auto-open.

**What `/` actually does after an unconfirmed create**, by case:

| The member had | The create in fact | `/` shows | Verdict |
|---|---|---|---|
| no communities | succeeded | opens the new community (`memberOf` is now 1) | **resolves the uncertainty** |
| no communities | did not happen | "You're not in a community yet" | **resolves the uncertainty** |
| one or more | succeeded | opens the **remembered** community | **fails** — the member cannot tell whether the new one exists |
| one or more | did not happen | opens the remembered community | **fails** — same screen as the row above |

So `/` is right in the two cases where the member had nothing, and wrong in
exactly the case the uncertainty matters most: the member already has a
community, and the two outcomes are indistinguishable.

**Smallest fix that uses what is there**, for the lead to assign if wanted: a
query param on `/` that skips the auto-open for that navigation — one condition
on the existing `openable` effect, no new route, no storage, no backend, no
sync. It is a change to `app/index.tsx`, which is outside this worker's set,
so it is reported rather than written.

**The drawing stands either way**: the label and the hierarchy are what the
frame proposes. Its destination is this finding, and it should not be
implemented against bare `/` while the third row of that table is true.
