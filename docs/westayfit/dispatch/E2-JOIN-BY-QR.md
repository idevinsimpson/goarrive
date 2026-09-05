# E2 — Join an existing community by link / QR

**Dispatch spec · 2026-09-05 · Code task · Implementation owner: Maia**
Parent: M-U3 (reduced). Approved 2026-09-05. Governed by `WE_STAY_FIT_MASTER.md`.

## Primary workflow — the only one

> A person scans a QR code, sees which community they are about to join, and joins it.

Everything else in this document exists to make that sentence true and safe.

---

## 1. Why this shape

The obvious implementation is "make `wsfCommunityGroups` publicly readable." **Do not.**
That would expose every private family and friends group in the product to anyone who can
guess a document ID.

Current rule:
```
match /wsfCommunityGroups/{groupId} {
  allow read: if wsfIsGroupMember(groupId) || isPlatformAdmin();
```
A visitor who has not joined yet cannot read the group — so they cannot see its name to
decide whether to join. That is correct behaviour, not a bug to route around.

**The resolution: both reads go through callables, which use Admin and bypass rules.**

> ### E2 requires ZERO changes to `firestore.rules`.
> This is deliberate and it is the most valuable property of the design. A rules deploy
> replaces the **entire live ruleset including GoArrive's** (R-9, GATE 0). Designing E2 to
> need no rules change removes that hazard from the critical path completely. If an
> implementation detail appears to require a rules change, **stop and raise it** — do not
> quietly add one.

---

## 2. Scope

### In

**Data — additive only**
- `wsfCommunityGroups.joinCode: string` — URL-safe, >=16 chars from a CSPRNG. Public by design (it goes on a printed QR), but must not be enumerable or derivable from `groupId`.
- `wsfCommunityGroups.joinPolicy` gains `'public'` alongside existing `'private' | 'inviteOnly'`. Only `'public'` groups are joinable by code.
- Backfill: existing groups get a `joinCode` and keep their current `joinPolicy`. No existing group becomes public.

**Two callables in `functions-westayfit`**

`wsfPreviewCommunity({ joinCode })` — unauthenticated allowed
- Returns **only**: `{ displayName, groupType, memberCount }`
- Returns a single generic not-found for: unknown code, non-`public` group, non-`active` lifecycle. One shape, so the endpoint is not an existence oracle.
- Never returns `groupId`, `createdByUserId`, member identities, or any timestamp.
- Rate-limit by IP or a coarse bucket. It is unauthenticated and enumerable-by-attempt.

`wsfJoinCommunity({ joinCode })` — authenticated
- Guards, in order: authenticated -> email verified (see §5) -> `wsfMemberProfiles/{uid}` exists -> `adultConfirmation === true` -> group resolves, is `public`, is `active`.
- Creates `wsfMemberships/{groupId}_{uid}` with `role: 'member'`, `membershipStatus: 'active'`, server timestamps — **matching `wsfCreateCommunity`'s existing shape exactly**.
- **Idempotent.** The deterministic doc ID makes a double-tap or a back-button re-submit a no-op, not a duplicate or an error. Returns `{ groupId, alreadyMember: boolean }`.
- Runs in a transaction. Never leaves a membership without a readable group.

**One route** — `apps/westayfit/app/join/[joinCode].tsx`
- Signed out -> show the preview, then route to signup/signin, **returning to this join URL afterward**. Losing the join code behind an auth redirect is the single most likely way to break this flow.
- Signed in, not a member -> preview + a single Join action.
- Signed in, already a member -> route straight to `/community/{groupId}`.
- Unknown or non-public code -> a plain "this link is not valid" state. Not a stack trace, not a 404 page.

**Hosting** — `/join/**` needs the same rewrite treatment as `/community/**` in
`firebase.westayfit.json`, or a cold load of a printed QR link 404s. This is exactly the
bug GATE 1 was written to catch.

### Out — do not build

Per-person invitations · invite tokens or hashing · revocation and expiry · a general
invitation system · leaving a community · member directory · community search · QR
*image* generation (the Expo QR codes are printed from the URL by design work, not minted
in-app) · anything touching `firestore.rules`.

---

## 3. Acceptance criteria

Emulator-verified, in the GATE 1 harness (`scripts/westayfit/gate1.sh`):

1. A second adult account, given only a join URL, reaches the community page — never having been invited, never knowing the `groupId`.
2. Joining twice produces exactly one membership document and no error.
3. `wsfPreviewCommunity` against a `private` group returns the same generic not-found as an unknown code. **Assert the two responses are identical** — that is the oracle test, and it is the one most likely to be skipped.
4. A cold load of `/join/<code>` returns 200 and renders, not 404.
5. A signed-out visitor who signs up from the join page lands back on the join page, then in the community.
6. `git diff -- firestore.rules` is **empty**.
7. Existing M-U2 flows unchanged: GATE 1's four specs and the callable suite still green.

Report as: `E2: <ACCEPTED|BLOCKED> — <criteria passed>/7`, with the raw test output. Label
every claim **EMULATOR VERIFIED** or **LIVE VERIFIED**.

---

## 4. Do not

- Deploy anything. This slice ends at a green gate and a pushed branch.
- Run `firebase deploy --only firestore:rules` or `firestore:indexes` under any circumstance.
- Touch `apps/goarrive`, `functions/`, or GoArrive collections.
- Make `wsfCommunityGroups` publicly readable.
- Store the join code hashed — it is printed on a QR; hashing it makes lookup impossible. It is unguessable, not secret. Do not confuse the two.
- Add a fourth global Firebase claim. Community role lives in the membership document.

---

## 5. Open decision — flagged, not decided

**Does joining require a verified email at the Expo?**

Today every WSF write is gated on `email_verified`. At a live event that means: scan ->
sign up -> *stop, go find your email, come back*. That will cost most of the funnel at the
exact moment the person is standing in front of the booth.

The alternatives are a real trade, not a technicality:
- **Require verification** — consistent with M-U2, protects against throwaway signups, costs conversion at the event.
- **Allow join before verification, gate later actions** — much better at the booth, but means an unverified account can appear in a member count.

**This is Devin's call.** Build the guard as a single, clearly-named check so the decision
is a one-line change rather than a redesign. Default to **requiring verification** until
he says otherwise — the safe default, and reversible.
