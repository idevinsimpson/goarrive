# Task 4/8 — Display + authorization race torture

Scope: the public display (`app/display/[goalId].tsx`), the Champion authorization control on Community Home (`app/community/[groupId]/index.tsx` with `src/displayAuthControl.ts` unchanged), and `wsfGoalPulse` / `wsfSetGoalDisplayAuthorization` on the server (unchanged in this task). Method: an Opus read-only design pass mapped the 20 owner scenarios to coverage or recipes and surfaced defects; one Opus implementer fixed the reproducible ones with before/after proof under exclusive emulator access; a second Opus worker authored the remaining torture tests as code; Fable reviewed, integrated, ran the combined suites, committed. Package E semantics unchanged.

## 1. Scenario matrix

| Scenario | Coverage |
|---|---|
| OFF by default · authorize · revoke · closed authorized goal · revoke on a closed goal | existing `e5-display-authorization` CASE 1, callable suites — re-run |
| Authorize goal A while goal B changes | CASE 5 + unit tests — re-run |
| Uncertain Champion result (write lands, response lost) · reconciliation by read-back | CASE 2 — re-run; **new** DEFECT 5 case (closed goal, revoke landed, response lost → confirmed by absence) |
| Delayed success after refusal · earlier/later inversion | CASE 3, CASE 4 — re-run |
| Stale connection · recovery after transient failure | `ui-display` transient test — re-run; **new T6** refusal → Check again while down → neutral state, never a stale refused total; recovery |
| Terminal refusal · unknown goal · malformed id | `ui-display` — re-run (Task 2 added the malformed id) |
| Reauthorize while an old refused session stays refused · explicit Check again | `ui-display` — re-run; **new T3** (below); **new DEFECT 6** Check again gives immediate feedback |
| Sample goal | backend only before; **new DEFECT 3** (Champion card qualifier + display refusal) |
| Wide + phone states | `ui-display` — re-run; long-name overflow moved to Task 5 (design found the existing no-scroll assertion cannot see symmetric overflow) |
| Timezone-boundary contexts (goal zone vs device zone) | **new T2**: the same page rendered from `Asia/Tokyo` and `Pacific/Kiritimati` devices reads the New York calendar day exactly as the UTC runner does; an unusable stored zone is refused rather than dated from the wrong zone |
| Repeated polling / cache windows | **new T3**: revoke → re-authorize → revoke inside one 2 s server cache window ends the session; the refused session stays closed after re-authorization; Check again recovers; 4–7 polls per 10 s; a new total lands within the cache + poll window |
| Leaving the Manage sheet mid-request | **new T8**: the outcome survives the unmounted card and is waiting when the sheet reopens, with the retry carrying the asked-for value |
| Expired window while the server still says active | **new DEFECT 2** on both surfaces (below) |

## 2. Defects found and fixed

| # | Where | Defect | Fix | Proof |
|---|---|---|---|---|
| D-7 / D-7b | Community Home, Manage sheet | The read-back after a failed write bumps the goals reload; if that reload fails (flapping connection) the "That change did not take effect. Public display is still authorized…" notice, its Dismiss and its retry were unreachable (rendered only inside the loaded-goals branch). On the success path the same reload hid the only confirmation that a public display was just switched on. | one predicate for "this goal has a card on screen"; outcomes for goals without a card render with the same copy and testIDs as the card; a confirmed outcome while the list is not loaded renders `wsf-goal-display-auth-confirmed-orphan-{goalId}` | `ui-champion-torture` D-7 (fails before: element not found; passes after) and D-7b; retry from the orphan notice sends the intended value and the stored flag flips |
| D-15 (design "DEFECT 5") | Community Home, `readStoredDisplayAuth` | absence from a **successful** `wsfListGoals` was treated as unknown; `wsfListGoals` returns active-or-authorized goals, so a closed goal whose revoke landed is absent by construction → the Champion was told "could not confirm" and pushed to retry a completed revoke | absence on a successful read is `false`; only a thrown read is unknown | before: "could not confirm"; after: the existing "Public display has been removed" confirmation and stored `false` |
| D-16 (design "DEFECT 3") | Community Home, Champion card | for a sample community the card claimed "Public display is authorized… It can show…" while the server refuses every display read for a sample community | qualifier `wsf-goal-display-auth-sample-note-{goalId}`: "This community is sample data, so no public display will show it." (state text unchanged) | Champion sees the note; anonymous `/display` shows the same generic refusal as an unknown goal |
| D-17 (design "DEFECT 2") | both surfaces, period label | nothing closes a goal automatically, so a goal with `status: 'active'` and `endsAt` in the past read "Open · Ends Mon, Sep 14" on the display and on Community Home | one shared helper `formatActiveWindowLabel` (`src/ui/dates.ts`): "Ended {same date formatting}" with no "Open ·" once the end instant has passed; `hasWindowEnded` is an instant comparison, the zone decides only the wording. Label only: the contribution routes stay offered and `wsfContribute` stays the authority (existing windowEnded refusal). | 4 new unit tests (±1 ms boundary, NY vs UTC wording, same-day "Ended today at…", withheld label); browser cases on both surfaces (before: "Open · Ends Thu, Sep 17"; after: "Ended …") |
| D-18 (design "DEFECT 6") | display, Check again | the button only bumped the poll session; the refusal screen sat unchanged for a full round trip and looked inert | also resets to the loading state | before: `wsf-display-loading` not found within 500 ms; after: visible (1.5 s injected delay) |

## 3. Found, not fixed

- **Contribution routes on an ended window** stay offered (product decision; the server refuses truthfully). Recorded in a code comment on the helper and asserted as still-present in the DEFECT 2 browser case so a future change is deliberate.
- **`wsfSetGoalDisplayAuthorization` ignores `isSample`** on the server (functions untouched overnight); the client qualifier states the truth.
- **Goal-pulse cache `now` is captured before the access reads**, so an entry can be served slightly past its 2 s TTL on a slow instance (safe direction on set). Queued for Task 6 with the LRU one-liner.

## 4. Test receipts for this task

| Suite | Result |
|---|---|
| Browser (one run): `ui-display-torture-2` (T2 ×3, T3, T6), `ui-champion-torture-2` (T8), `ui-champion-torture` (D-7, D-7b, D-15, D-16, D-17), `ui-display-torture` (D-18, D-17), `e5-display-authorization` (CASE 1–5) | 18 passed |
| Implementer's per-spec runs after the fixes: `ui-display` 4, `ui-community-home` 2, `d-admission-controls` 5, `ui-journey` 1 | all passed |
| Vitest | 209 passed / 14 files (was 205) |
| App TypeScript | clean |
