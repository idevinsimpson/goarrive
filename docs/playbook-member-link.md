# Permanent member workout link

In **Build → open a Playbook → ⋯ → Copy Member Workout Link**, copy
`https://goarrive.fit/playbook/{playbookId}`. This durable resource URL is distinct
from **Copy Booking Link**, which opens the public scheduling page. It is not a
bearer credential. Renaming a Playbook or changing its schedule does not change
the member URL; deleting/replacing the Playbook creates a different resource.

The member signs in normally. Only a currently assigned member can resolve the
link. The read-only callable uses the existing coach-scoped roster identity and
historical Auth-UID ownership checks and returns only that member's session
summary fields. It does not return other members, workout contents, Zoom links,
or booking tokens. Unassigned, missing and wrong-account resources give the same
assignment-denied response. Coaches must sign in as the assigned member to use
the member journey; coach privileges do not bypass this resolver.

The landing page displays every currently eligible session and requires an
explicit **Open current workout** choice. Multiple candidates are never resolved
by arbitrary query order. A single candidate uses the same button. Before opening
the existing `/live-session/{id}` player route, the page rechecks membership and
the current schedule. Reopening the permanent link resolves the latest schedule,
not the last booking visited. Refresh, app resume and a 30-second poll update the
list. Rejected refreshes clear stale results. No session is invented when none is
scheduled.

Eligibility matches the player's five-minute early window and inclusive end
boundary. UTC timestamps are authoritative. Legacy wall-clock starts use their
stored IANA timezone, the later fall-back occurrence, and forward shifting through
a spring gap; missing/invalid times cannot unlock a workout. Today is computed
per session timezone, not the viewer's timezone. Overnight active sessions remain
visible. Upcoming today, completed, cancelled, skipped, missed and ended sessions
are labeled without a launch action. The earliest next future session (all ties)
is displayed separately. `workoutCompletedAt` distinguishes workout completion
from Zoom's `completed` lifecycle status. The existing player resolver, pinning
and idempotent completion transaction remain responsible for workout selection
and advancement.

Both landing and direct player routes obtain authenticated server-time
observations. The direct route uses read-only `getSessionTime`, not workout
resolution, to initialize time. Monotonic elapsed time advances each observation;
the device's initial clock offset is irrelevant. Responses taking over ten seconds,
observations older than sixty seconds, and later clock jumps fail closed before
workout entry. Refresh/resume obtains another observation. An already-running
workout is not discarded when connectivity temporarily fails.

### Coach-controlled missed-workout policy

Build → open Playbook → calendar (Playbook schedule settings) exposes two choices:
**Carry unfinished workouts forward** and **Follow the scheduled workout**, with
an explicit Save workout setting button. Missing legacy values mean carry forward.
Only the owning coach or existing platform admin may save the setting through
`setPlaybookWorkoutPolicy`; the transaction validates workout ownership too.

Carry forward retains the existing completion-driven `nextWorkoutIndex`. A missed
Monday repeats its unfinished workout on Wednesday. Scheduled mode snapshots the
ordered workout IDs and current carry index when enabled, then stores a workout
assignment on each future unopened occurrence, independently for each member.
Roster IDs and linked Auth UIDs share the same ordering. Monday gets A and Wednesday
gets B even if Monday is missed or incomplete. Completion does not advance the
carry pointer for a scheduled assignment, including after switching back. Neither
mode fabricates completion; duplicate completion retains existing idempotency.

Saving a different policy affects only scheduled/allocated/allocation-failed sessions
more than five minutes away, with no pinned workout or completion. Started,
in-progress, completed, cancelled and pinned occurrences remain unchanged.
Legacy occurrences without an absolute start timestamp are also left unchanged;
the setting does not guess or migrate their scheduling data. Switching
to carry removes planned assignments from those editable future sessions; switching
to scheduled snapshots the current order again. Saving the same choice is idempotent.
To adopt a subsequently changed workout order, save carry then save scheduled again.
Deleted or foreign workout documents never fall through to a different private workout.

Coach recurrence, one-off booking and public booking all use the same transactional
assignment helper. Assignment order uses absolute UTC instants produced by the
existing timezone-aware booking conversion, with document ID as a tie-breaker.
Stored original order survives rescheduling, so moving an occurrence preserves its
workout. Missed/cancelled occurrences within an assignment version retain their place;
failed/conflicting bookings consume no place. Inserting an earlier new occurrence
can reorder later **unopened** assignments. Already pinned or started assignments
remain fixed even if that means a repeated workout. Each policy version keeps its
workout-order snapshot; no background migration or GET advances a sequence counter.
The explicit setting/booking transactions fail with a review message beyond 400
existing occurrences rather than partially applying an oversized assignment batch.

The permanent resolver remains read-only. The existing player pins the resolved
assignment once, and reopening/reloading preserves it. The scheduled-mode tests use
synthetic missed Monday/current Wednesday fixtures; these are distinct from the
previous completion-driven A-to-B acceptance.

### Duplication and enrollment

Build duplication retains the selected workout policy but creates an unassigned
Playbook with progression at zero. Enrollment retains template configuration but
replaces all prior member identities with the enrolling member and clears inherited
assignment/pin/progression fields. Scheduled clones snapshot the current workout
order with the new Playbook ID as their fresh version, starting at workout A.
Template content synchronization still updates only workout IDs, music and description;
it does not overwrite an enrolled member's chosen policy or progression snapshot.
Synthetic tests cover legacy/default and both explicit policies, source immutability,
and an enrolled scheduled clone resolving its first session through the permanent link.

### Existing archive behavior

The coach's Archive action only toggles `playbooks.isArchived` and exits the
editor. Existing public booking resolution and booking submission reject archived
Playbooks. Archive does not cancel existing session documents or remove member
assignment, and existing player resolution/completion does not check this flag.
The new authenticated resolver currently follows that existing-session behavior.
Treating archive as revocation would require an explicit consistent policy across
the permanent resolver and direct session/player routes; denying only this new
route would not revoke previously issued session URLs. This is an open review
decision, not an access change implemented here.

Login accepts a narrowly validated `returnTo` for only `/playbook/{id}` and
`/live-session/{id}`. External URLs, encoded separators, route groups, queries,
fragments and arrays are rejected. Explicit workout destinations take precedence;
the existing pending-share behavior remains unchanged when no valid workout
destination is supplied. No persistent return-path storage is introduced.

## Later release and live acceptance (not performed by this change)

1. Independently review the exact commit and test receipts. Reconcile live source
   and Function inventory immediately before any separately approved deployment.
   Operational main is not approved WSF production source. Never deploy all
   Functions, use the package's broad deployment script, accept deletions or touch
   WSF. New callables: `getMemberPlaybookSessions`, read-only `getSessionTime`,
   coach-only `setPlaybookWorkoutPolicy`. Changed callables: `bookPlaybookSession`,
   `bookViaBookingToken`, `getSessionWorkout`, `completePlaybookSession`.
   The enrollment clone correction also affects `stripeWebhook` and `stripeConnectWebhook`; these require their own fresh deployed-source comparison before inclusion. No payment configuration or provider calls are part of acceptance. Only an explicitly reviewed named-function deployment may release these.
   No rules or indexes are changed.
2. Validate the Hosting preview and `/playbook/**` rewrite with those callables.
   A preview uses the live backend and is not an isolated staging environment.
   No Node runtime migration belongs in this feature change; the runtime
   decommission warning is a separate release blocker to resolve before deployment.
3. Obtain explicit approval for one dedicated test member's current-time session
   if no eligible test booking exists, with any email/meeting side effects stated.
   Use legitimate existing sign-in. Test the copied permanent URL signed out and
   signed in, reload, Back/Forward and wrong-account denial. Confirm the assigned
   player. Opening the player can pin assignment fields and needs that approval.
   Do not complete the workout, launch Zoom, send invitations or alter other members.
4. Validate the same URL against a later approved scheduled session to prove it
   follows the schedule. Previous single-booking acceptance does not prove this.
   Promote Hosting only after explicit approval and all gates pass; retain the
   pre-release Hosting version and previous named-function rollback references.
