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
