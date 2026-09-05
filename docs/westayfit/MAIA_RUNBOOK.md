# Maia — Runbook

**2026-09-05 · Why her work vanishes, and the fixes.** Read before dispatching anything to
Maia that takes more than a few minutes.

## The root cause, with the paper trail

Her Slack bot (`agent-slack.service`, `bot.js`) enforces **two** independent turn budgets:

| Knob | Set to | Effect |
|---|---|---|
| `TURN_DEADLINE_MS` | 1,500,000 (25 min) — raised from 4 min on Aug 20 | turn killed at 25 min. **Both knobs exist and both kill** — Maia reads this one and reports "25, not 30"; the 30-min kills are the unset knob below. |
| `TURN_ABSOLUTE_CAP_MS` | **unset** → 30-min platform default | turn killed at 30 min |

Neither resets on activity. When a turn dies the platform posts *"This turn hit the
N-minute deadline and was stopped. Please resend your message to retry"* — and nobody
resends, so everything not yet pushed is lost and no report is ever made. **Fifteen-plus
turns died this way between Aug 27 and Sep 5.** A full E2 implementation died at 00:25
EDT Sep 5 with nothing on origin; it was salvaged by hand nine hours later.

The fix — raise both knobs in one env drop-in — was diagnosed and written on
**2026-08-31** (#dev-goarrive, ts `1788214578.829649`) and handed to "Manus or Devin at
the box" because Maia cannot restart her own service mid-turn. **It was never applied.**
Maia's own readout on Sep 5 shows the identical state she reported on Aug 31.

Two compounding faults:

- **Jarvis audio — the mechanism, confirmed 2026-09-05 13:13Z.** Her turn-end reply is
  posted as **two audio files, not text**: first `audio-bundle-<ts>.mp3` attached to an
  otherwise-empty message (this is the reply content, voiced — a concise thread read shows
  it as a blank message), then `jarvis-reply-<ts>.mp3` under "Jarvis audio reply — tap to
  play". The written record is empty because the writing was converted to audio. It fires
  even on a turn explicitly instructed "text only", so it is not something she controls
  in-turn — it is platform behaviour in `bot.js`. A voice-reply feature has been live since
  2026-06-07 in the assistant channels and is active in the dev channels too. The 1a
  hosting receipt was delivered this way and asked for three times as "missing".
- **Thread replies.** She replies in-thread; a channel read shows nothing. Read threads.

## Fix 1 — raise both caps, without a human at the box

Maia applies it herself, safely, by scheduling the restart to fire **after** her turn ends:

```
mkdir -p ~/.config/systemd/user/agent-slack.service.d
printf '[Service]\nEnvironment=TURN_DEADLINE_MS=2700000\nEnvironment=TURN_ABSOLUTE_CAP_MS=5400000\n' \
  > ~/.config/systemd/user/agent-slack.service.d/turn-lease.conf
systemctl --user daemon-reload          # re-reads units; restarts nothing
systemctl --user cat agent-slack | tail -6   # confirm the drop-in merged before scheduling anything
systemd-run --user --on-active=120 --unit=agent-slack-deferred-restart --collect \
  systemctl --user restart agent-slack
# post output, END THE TURN within 2 minutes
```

`override.conf` (token, memory caps) is never touched. Verify in the next turn:

```
tr '\0' '\n' < /proc/$(systemctl --user show agent-slack -p MainPID --value)/environ | grep -E '^TURN_'
systemctl --user show agent-slack -p ActiveEnterTimestamp
```

45-min lease / 90-min cap. A full build+deploy is ~20 min; a genuine wedge is still bounded.

## Fix 3 — long jobs report themselves

`scripts/westayfit/run-detached.sh` runs a job in a transient `systemd-run` unit that
outlives the turn, then **posts exit status + log tail to the Slack thread as text** when
it finishes. No second turn required, no human required.

```
scripts/westayfit/run-detached.sh <unit> <channel-id> <thread-ts> -- <command ...>
```

**Proven 2026-09-05 13:22:46Z.** `wsf-selftest` launched at 13:19:26Z, slept 200 s — longer
than any inline command survives — and posted `SELFTEST-OK` into thread `1788613482.722789`
as text on its own, with no human and no second turn. (`/home/ben/.local/state/wsf-run/wsf-selftest.20260905T131926Z.log`)

**The runner forwards PATH; it does not find Java.** `~/jdk-21` is not on PATH, so a raw
`firebase emulators:exec …` inside the runner dies in three seconds with *Could not spawn
java -version* (2026-09-05 14:35Z). Anything touching the emulators goes through
`scripts/westayfit/gate1.sh`, which locates the JDK, or exports `JAVA_HOME=$HOME/jdk-21`
and prepends `$JAVA_HOME/bin` to PATH inline. As of `5cbdb8e` on the E2 branch, `gate1.sh`
also runs the callable jest suite, so one gate run is the complete proof.

One-time setup and the acceptance self-test are in the script header. **Standing rule:**
any build, deploy, gate run, emulator suite, or `npm ci` goes through it. Inline
long-running work inside a chat turn is no longer acceptable.

## Dispatch rules that follow

1. Every turn ends with work **pushed** — *even mid-feature.* WIP commits are fine; lost work
   is not. A dispatch that expects >15 minutes of inline work is a defect in the dispatch.
   (E3, 2026-09-05: "build E3" as one dispatch put her 17 minutes in with nothing on origin,
   tailing a log inline. The caps kept the turn alive; the code was still unsafe until a
   checkpoint nudge. Split feature dispatches so each turn has a natural push point.)
2. Long steps go through `run-detached.sh`. The dispatch names the thread-ts to report into.
3. Mention her as `<@U0AQAGGMTE3|Maia>`. Plain `@Maia` pings nobody.
4. Read her **threads**, not the channel — and in **detailed** mode, or an audio-bundle reply looks like an empty message.
5. **The written reply is the record.** Audio may only repeat what the text says, never add to it. Devin has transcribed audio replies and found content that was not in the thread; the 1a receipt was delivered audio-only with an empty text slot. Until the toggle is found and turned off for dev channels: "Text reply only — no Jarvis audio", and anything spoken must also be typed.
6. Fresh thread per dispatch. A 350-reply thread kills even zero-tool turns.
7. **No buttons. Choices are text.** When she posts an A/B/C as Slack buttons, her bot
   enters a modal "pick one" state and the **next message in the thread is consumed as the
   choice** — a full correction was swallowed as "Other" (`✅ Got it — Other — Maia is
   working on it… / Waiting for your message`) and no turn ran (2026-09-05 15:01Z). Taps
   also vanish (`bot.js` `messageTs=null`, fix unapplied). Buttons lose in both directions.
   Evidence, 2026-09-05 15:01Z: her A/B/C buttons put the bot into a "pick one" state; my full
   correction was consumed as the "Other" selection (`Got it — Other — waiting for your
   message`) and no turn ran. Six minutes lost; recovered by re-sending as plain text.
   Buttons lose in both directions — taps vanish (the `messageTs=null` bug from Aug 31,
   unapplied because of the tree drift) and the prompt itself eats whatever comes next.
8. **The truth gate runs in the worktree the task lives in.** `/home/ben/dev-goarrive` is
   her general workdir and sits on whatever branch she last used for another project
   (`claude/talk-to-anyone-setup-5sx86w` on 2026-09-05). Run from there and WSF files
   "do not exist" and origin looks stale. WSF work lives in `/home/ben/dev-goarrive-wsf-e2`
   (and successors); every dispatch names the worktree.

9. **Progress must be live and specific — never "Still working on this…".** Devin's
   standing requirement (2026-09-05 16:20Z): while a command runs, the thread shows *what*
   is running, for *how long*, and the *last lines it printed* — not a fixed string on a
   timer, and not that string voiced as `progress-tick-*.mp3`. Per-tool summaries
   ("I'm reviewing…") are fine; the timer heartbeat is the defect. Fix lives in the running
   `bot.js`; applied via the deferred-restart pattern; verified with a deliberate 3-minute
   command whose heartbeats show command + elapsed + output tail.

10. **Never wait on anything inside a turn.** No log tailing, no "monitor PID N every 5
    seconds", no sleeping for a process to finish. Twice on 2026-09-05 this turned a
    30-second task into a hung turn (a log tail at 15:26Z; a PID watch at 16:21Z, after
    being told to kill it). The choice is binary: if it must finish, launch it through
    `run-detached.sh` and end the turn; if it is in the way, `kill` it. A turn that is
    waiting is a turn that is hung.

11. **Two heartbeats in the same second means two hung turns — stop sending.** Every
    message to Maia starts a new turn. A turn wedged inside a tool call is not ended by
    the deadline (the deadline is checked between steps, and a blocked step never
    returns), and a "kill it" message only starts one more turn under the same
    conditions. On 2026-09-05 16:24Z the E3 thread showed four "Still working" posts in
    one second — four turns all crawling under one memory throttle, none able to run the
    kill they were sent. From that moment only the box can recover her (see below). Do
    not send anything else until the heartbeats stop; each message adds a hung turn.
    *Turns in different threads run concurrently* (seen 17:30Z: the v2 apply turn ran
    while the E3 turn was still inside a tool call). So a deferred restart scheduled in
    one thread kills whatever is in flight in every other thread — never dispatch a
    restart while another turn is running, or accept losing that turn's unpushed work
    (its files on disk survive).

12. **A patch for her bot is built against the captured running file, never `main`.** The
    live tree drifts (a branch plus uncommitted edits, as of 2026-09-05). Before any
    `bot.js` change: commit the running file to a `live/<date>` branch and push; build and
    self-test the change against that commit; apply with `git apply --check` first; the
    guard in the apply dispatch (stop if the file matches neither expected base) is what
    saved the Sep 4 edits on 2026-09-05.

## Where things live on her box (confirmed 2026-09-05)

| What | Where |
|---|---|
| Slack bot token | `SLACK_BOT_TOKEN` in `~/.agent/.env` (siblings: `SLACK_APP_TOKEN`, `SLACK_NOTIFICATION_CHANNEL`, `SLACK_CHANNEL_TALK_TO_MAIA`) |
| Turn caps | `~/.config/systemd/user/agent-slack.service.d/turn-lease.conf` |
| Claude OAuth token | `~/.config/systemd/user/agent-slack.service.d/override.conf` — never edited |
| Running bot | `/home/ben/agent-platform-live/shared/slack-bot/bot.js`, node v22. **A git checkout of `Trifecta-United/agent-platform` on branch `fix/text-as-button-answer` @ `4f53fd0` (2026-08-20) with uncommitted edits to `bot.js` dated Sep 4 22:56** — not `main`, not the Aug-13 file assumed earlier. Any patch must be built against the file as captured on branch `live/agent-slack-2026-09-05`, never against `main`. |
| JDK for the emulators | `~/jdk-21` (portable Temurin 21). Not on PATH by default; `scripts/westayfit/gate1.sh` auto-detects it as of `0f019c4`, and the ensure-JDK step in the E2 gate job installs it if absent. |
| Jarvis switches | `JARVIS_VOICE_REPLY=on` in `/home/ben/agent-platform-live/shared/slack-bot/.env` (documented kill switch); `JARVIS_SPOKEN_REPLY_SCRIPT_PATH` / `TTS_DRAFT_SCRIPT_PATH` env vars read at `bot.js:95-96`; `[JARVIS: /path.mp3]` markers parsed at `bot.js:1691-1694`. **No per-channel setting** — off means off in every channel. |

**Fix 1 LIVE VERIFIED 2026-09-05 13:30Z.** Drop-in merged; deferred restart scheduled
`13:21:43Z +240s`, fired `ActiveEnterTimestamp=13:25:47 UTC`; read from the running
process's environment: `TURN_DEADLINE_MS=2700000`, `TURN_ABSOLUTE_CAP_MS=5400000`;
`agent-slack-deferred-restart` collected. The deferred-restart pattern is now the standard
way she applies her own service config — no human at the box required.

**How the switch would be applied, if Devin says off.** `bot.js:36` loads `.env` with
`require('dotenv').config({ path: __dirname + '/.env' })` — default mode, which does **not**
overwrite variables already in the environment. So `Environment=JARVIS_VOICE_REPLY=off` in
the systemd drop-in wins over the `.env`'s `on`, with no edit to the running tree and a
one-line revert. Caveat: that switch is documented as governing replies to *voice memos*;
whether it also stops the every-turn `audio-bundle` is unproven until tried.

## Recovering her from the box (for Devin or Manus — nothing here needs Maia)

Use when the thread is heartbeats only, the branch has not moved, and the last per-tool
summary is a wait ("monitoring PID N…", "tailing the log…"). Run as the `ben` user:

```bash
systemctl --user status agent-slack --no-pager | head -12      # alive? since when?
free -m                                                         # memory pressure?
ps -eo pid,etimes,rss,cmd --sort=-etimes | grep -E 'jest|java|firebase|emulator' | grep -v grep | head
# stray test/emulator processes only — never the bot itself:
pkill -f 'firebase emulators'; pkill -f jest; pkill -f 'jdk-21/bin/java'
systemctl --user restart agent-slack                            # drops every hung turn
systemctl --user show agent-slack -p ActiveEnterTimestamp       # proof of the restart
```

**Recovery confirmed 16:49Z.** Five-command read-only health check answered in text in
25 seconds (thread 1788626965.235519). After the restart: MainPID 2119862,
MemoryCurrent 232 MB, peak 346 MB, `MemoryHigh=2G` / `MemoryMax=4G` are lines 3–4 of the
unit's own files; box 1.5 GB used / 6.2 GB available. The E3 work from the 14:46Z turn was
sitting uncommitted on disk (`index.ts` + three callable tests) — rule 1 exists for exactly
this; it was committed and pushed as `858feb2` in a 19-second turn.

**LIVE 2026-09-05 16:44:11Z.** Devin had Manus run exactly this from the Hetzner console
(`goarrive-maia`, as `ben`). Status before the restart: active since 13:25:47Z, MainPID
2078804 (`node bot.js`) with **one** child `claude` (PID 2101666), Tasks 159,
**Memory 2.2G against `high: 2.0G`** (max 4.0G), CPU 10m49s; box `free -m`: 7751 total /
657 free / 4387 available; the three `pkill`s found nothing;
`ActiveEnterTimestamp=16:44:11 UTC` after. Two conclusions:

1. Turns run concurrently across threads (corrected 17:31Z — only one `claude` child was
   visible at 16:44Z, but the v2 apply turn later ran alongside the E3 turn). The
   four-per-second heartbeats were four turns crawling under the same throttle, so the
   "kill it" turn crawled with them. Rule 11 stands; the fix is `dispatch/BOT-UNWEDGE.md`
   (a hard tool-call timeout, and a control path served before any model call).
2. The service was over its cgroup memory high-water mark. Above `MemoryHigh` the kernel
   throttles everything in the cgroup, which is what the hour-late audio uploads and the
   crawl were — not the task. Raising `MemoryHigh` in a new drop-in (never `override.conf`)
   is Fix 4, pending the post-restart numbers from the health check.

After the restart the backlog is **not** replayed: re-send the last dispatch as a fresh
thread (rule 6). If `free -m` shows under ~500 MB available, say so in the thread before
re-dispatching — the wedge was memory, not the task, and the next gate will hang the same
way.

## Still open

- **A wedged turn cannot be un-wedged from Slack.** A kill instruction is itself a turn,
  and it queues behind the wedge it is meant to clear. The real fix is a control path the
  bot's event consumer handles *outside* the turn loop — e.g. a message that is exactly
  `maia: restart` schedules the deferred restart directly, no model call. Dispatch this as
  the next bot.js task after the live-progress patch (`dispatch/BOT-LIVE-PROGRESS.md`).
- **Live-progress patch: written, self-tested, dispatched 17:00Z.** Branch
  `Trifecta-United/agent-platform` `maia/live-progress-heartbeat` @ `50495e9`, BASE
  `5fa8626` (2026-08-12; `main` has not touched `bot.js` since). Findings at
  `bot.js` L893–912 (executor output capture), L1149–1290 (`createLiveProgress`),
  L2905–2941 (fallback heartbeat, now 20 s and edit-in-place), L1663–1682 (monitor
  heartbeat absorbed, progress-tick audio removed). Harness `scripts/live-progress-selftest.js`
  passes 5 scenarios; `npm test` 828 pass, 3 pre-existing `dotenv` failures identical to
  `main`. Known limit: with Claude Code 2.1.x as the executor, a running command's output is
  not visible to `bot.js` until the call returns, so a hung command shows the command and
  the elapsed time with `last output: (none yet)` — and is sealed as ❌ when the turn ends.
  Report thread: #dev-westayfit 1788626986.167859. Apply thread: 1788627643.833759.
  **Apply STOPPED at the guard (17:01Z, correctly):** `git apply --check` failed at line
  2647 and the running file matched neither BASE nor its parent — the live tree is
  `fix/text-as-button-answer` @ `4f53fd0` plus uncommitted Sep 4 edits (`optionMeta` /
  `matchTextToProposal`, inline `audioChain`, `envelopeGuard.inspectEnvelope` changes).
  Option B would have erased them. **Captured 17:06Z:** `live/agent-slack-2026-09-05` @
  `92eae98` (pushed; `bot.js` sha256 `2fa097b8…437387`; the commit also carries
  `proposals.js` + `proposals.test.js`, which were already staged on the box and which the
  live `bot.js` imports). The rebuild runs in a fresh session against that exact commit
  with the same harness → branch `maia/live-progress-heartbeat-v2`, plus a separate commit
  for the audio-only/empty-text reply defect (seen again at 17:04:48Z in thread
  1788627812.717299 — the capture result arrived as audio with an empty text slot; the
  text had to be requested a second time). Lesson recorded as rule 12.
  LIVE VERIFIED only after the 3-minute acceptance run in its own thread.
- **Jarvis off?** It is all-or-nothing. Turning it off silences Devin's assistant channels too. Devin's decision; until then the text-is-the-record rule (§5) is the control, and Maia has saved it to memory.
- Source-tree drift: the service runs `agent-platform-live/…/bot.js` (Aug 13); her patched
  tree is `agent-setup/…` (Aug 31, +28 KB). Her button-tap fix cannot reach the running
  process until that is reconciled. Not on the WSF critical path; Devin's call.
