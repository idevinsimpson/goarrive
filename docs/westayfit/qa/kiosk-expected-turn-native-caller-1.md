# KIOSK-EXPECTED-TURN-NATIVE-CALLER-RECOVERY-1 — the station's commands name their turn

Director queue #365 `6059919550` (the scope of `6044059165`), release `6060048984`; W3, inbox #396 (ack `6060186878`, wake `2288365b…`).

**Source only.** It was run in the emulator only (`demo-wsf-local`). Nothing was deployed, and there is no hosted or device claim. There is no functions, rules, index, IAM, pin, fixture, mirror, camera/photo, queue-admin or Together change.

Base: `claude/wsf-app-shell` `b83811950732d97dc5dde324cd7195cb61edaacf`, which contains the integrated #587 server.

## The defect this closes

The #587 server (`docs/westayfit/qa/kiosk-expected-turn-1.md`) requires `wsfStartTurn`, `wsfCancelTurn` and `wsfCompleteTurn` to carry `expectedTurn`, the station-only `assigned.turnRef`. The station screen sent only `stationId`/`secret` (and `count`), and it painted poll and command answers independently. Against that server, every Start, Record and "Let them go" was refused. A client that retried a lost Record with "the newest ref" would have sent B's binding with A's count, recording A's count **to B** and counting it twice.

## The client contract (`apps/westayfit/src/stationTurnOperation.ts`)

The controller holds no React state. It reaches the network only through the `send` it is given.

- **Immutable operations.** Pressing Start, Record or "Let them go" freezes `{command, expectedTurn, count (Record only), code, session}` from the turn the screen shows at that moment. **"Try again" resends exactly that**, whatever the hall shows by then. Pressing the same command for the same turn while it is unanswered also resends the captured operation: never a newly typed count. A press for another turn waits ("Finish checking K7Q2 first").
- **Requests** (the actual SDK bodies, asserted in tests):

  | Command | Request body |
  |---|---|
  | Start | `{"data":{"stationId","secret","expectedTurn"}}` |
  | Record | `{"data":{"stationId","secret","count","expectedTurn"}}` |
  | Let them go | `{"data":{"stationId","secret","expectedTurn"}}` |
  | Call next | `{"data":{"stationId","secret"}}` (**unchanged**) |

- **Single flight.** One command is in flight at a time. The guard sits in the controller, so a double tap sends once even before React re-renders.
- **One sequence for reads and commands.** A ticket is issued before every poll and every command, and only a newer ticket's hall may paint. Whichever of a poll and a command answers first, an older hall never repaints a newer one. A command's receipt still settles its operation even when its hall is dropped.
- **Session binding.** Every answer is bound to credential + goal + station. A revocation, unpairing, goal switch or fresh enrollment drops everything in flight. Nothing is adopted, resent or painted across sessions, and a fresh enrollment never inherits an operation.
- **Strict validation.**
  - A hall that is not one is ignored, and the screen keeps what it last confirmed.
  - A Record answered without its **own** whitelisted receipt is not treated as success. That covers an entry mismatch, a non-positive amount, a mistyped shared field, or no receipt at all. There is no submitted-count fallback: the operation stays unanswered and "Try again" asks again.
- **Outcomes.**
  - A definite refusal ends the operation: stale ("That turn has moved on…"), not running, needs update, revoked, or the product's own refusal (for example, the goal is closed).
  - A lost answer keeps it. Lost covers a dropped connection, `internal`, `unavailable` and similar.
  - A later hall settles an unanswered **Start** (that turn now running) or **Let them go** (that turn gone), but **never a Record**, whose result comes only from its own receipt.
- **Old server.** Against a server that hands out no `turnRef`, the three commands are **unavailable** and never sent unbound. The screen says: "This screen can’t start or record turns until the event’s server is updated." Call next still works.
- **The count box belongs to one turn.** It shows nothing once the screen is on another turn. An answer for A's operation clears only a box typed for A, so it never empties what is being typed for B.

## The screen (`apps/westayfit/app/station/[goalId].tsx`)

- It is wired to the controller. Appearance is unchanged: the wordmark, QR, player, count review, navigation and the one primary control are all as accepted.
- **Copy added, kept to the minimum for an honest recovery:**
  - The unanswered state: "No answer yet for K7Q2. “Try again” sends the result (20) again for that turn — it can’t count twice."
  - A **Try again** control. It appears only while an operation is unanswered.
  - The old-server sentence above.
  - "Finish checking K7Q2 first — tap “Try again”."
- **A Record's result is read from its own receipt.** It shows as "K7Q2 · 20 squats recorded." for the same ten seconds as the hall's result.
  - With nobody being served, it fills the hall's result slot.
  - While somebody else is up, it is a separate line. It is never painted onto the turn being served.
  - Why: the hall's shared `result` names only the station that recorded **last** on the line. Two stations recording together cannot rely on it, which #587 also says.
- **What stays the same:**
  - Timer end still records nothing. The player mints nothing, and only Record sends a count.
  - The binding is never rendered, logged, put in a test ID, or placed in the QR.

## Proof

| Run | Result |
|---|---|
| `tests/stationTurnOperation.test.ts` (new; real `httpsCallable`, scripted `fetch`) | **29 passed** |
| Mutants of `stationTurnOperation.ts` / `turnContract.ts` | **22 / 22 killed**, including the newest-ref retry, no single-flight guard, in-flight set late, cross-session adoption, the old pending operation kept, an older hall repainting, the submitted-count fallback, a foreign receipt entry, lost↔definite confusion, an unbound send to an old server, another turn while unanswered, a re-press taking a new count, A's answer clearing B's count, the Record settled by the hall, no count or binding in the payload, a mutable operation, and a short-ref binding |
| Full Vitest (`npm run test:vitest`) | **65 files, 1,278 tests passed** |
| `tsc --noEmit` (apps/westayfit) | clean |
| Existing attendee station journey (`apps/westayfit/tests-e2e/expo-attendee-journey.spec.ts`, unchanged) against the integrated #587 source, emulator Hosting + Functions + Firestore + Auth | **7 / 7** at `a469ca63`; **5 failed / 2 passed** with the base client (see below) |

The unit tests cover:
- the serialized payloads of all three commands, and Call next unchanged;
- a double tap;
- **A unknown → B assigned → retry A**: A's own binding and count are sent, A's own receipt (`alreadyRecorded`) is read, B stays B, and B's count is untouched;
- a re-press resending the captured count;
- reversed poll and command replies, in both orders;
- revoke, re-enroll and goal switch while in flight, a fresh enrollment inheriting nothing, and the same session set again;
- malformed receipts and halls;
- an old server without the binding;
- presses that do not fit the turn;
- each definite refusal and each lost answer, with "Try again" resending the identical body;
- a later hall settling Start and Let them go, but never Record;
- the binding's shape and the receipt whitelist.

### The attendee journey (emulator)

**Environment:** `firebase-tools` 14.27.0 emulators, all local:
- Auth `:9099`;
- Firestore `:8080`;
- Functions `:5001`, serving `functions-westayfit` built from the base, which includes #587's mandatory binding;
- Hosting `:5010`, serving `npm run build:web` with `EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1`.

Browser: Playwright 1.62.1 with the pre-installed Chromium 1194, run with `--workers=1`. No hosted environment and no device.

| Client served | `expo-attendee-journey.spec.ts` | exit |
|---|---|---|
| **Base `b8381195`** (fail-before) | **5 failed, 2 passed**. In all five failures the station shows the server's "This screen needs an update before it can run a turn.": J1 two stations, J2 lost Record, J3 phone/no-show/let go, J4 closed mid-turn, J4c closed after call. | 1 |
| First cut `1869b1c6` | **6 passed, 1 failed**. J1: the earlier station's hall result line was gone, because the shared `result` names only the station that recorded last. Fixed in `a469ca63` by reading a Record's own receipt (see above). | 1 |
| **This change `a469ca63`** | **7 passed** (1.8m), including J1 (three land once each), J2 (a lost Record is retried and counted once) and J2b (the product sentence for a lost answer) | 0 |

`station-enrollment.spec.ts`, run against the same `a469ca63` build, passes **3 / 3** (1.3m, exit 0).

## The reservation (path gap, reported on #396 `6060221870`)

Three of the seven reserved paths are not where this repository's runners look:

| reserved | where the runners look | status |
|---|---|---|
| `apps/westayfit/src/__tests__/stationTurnOperation.test.ts` | Vitest includes only `apps/westayfit/tests/**` | written at `apps/westayfit/tests/stationTurnOperation.test.ts` |
| `tests-e2e/station-expected-turn.spec.ts` | Playwright `testDir` is `apps/westayfit/tests-e2e` | not written |
| `tests-e2e/expo-attendee-journey.spec.ts` | the file is `apps/westayfit/tests-e2e/expo-attendee-journey.spec.ts` | run unchanged; needed no edit |

## Not in this change

- No server, rules, index, IAM, deploy, functions or Lovable change.
- `app/queue/[goalId].tsx` and `src/followAlongSession.ts` mention the turn callables in comments only. The phone still uses the unchanged `wsfCompleteMyTurn`.
- **Deploy order (needs a decision when separately authorized).** #587's note says to ship the station client first because an old server ignores the extra field. That no longer holds for this client. Following the queue's no-fallback rule, this client makes Start, Record and "Let them go" **unavailable** against a server that hands out no `turnRef`. Shipping this client first therefore leaves stations able to Call next but not run turns until the functions ship. Shipping the functions first breaks the old client ("This screen needs an update…"). Either way there is a window, so the two should ship together or back to back. That is L0's call, not this packet's.
