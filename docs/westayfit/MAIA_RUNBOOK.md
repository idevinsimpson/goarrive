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
   **Devin's standing instruction, 2026-09-05 20:29Z (thread 1788639792.962019):** "never
   finish anything without giving both an explanation in writing and in the audio."
   Enforced two ways from today: (a) the rule above is written into Maia's persistent
   rules/memory in her own words (dispatch 20:30Z, thread 1788640255.280279 — she pastes
   the stored entry and its path back as proof); (b) `bot.js` v5 (branch
   `maia/unwedge-v5`, in preparation) posts every spoken script — Jarvis reply, quick-ack,
   bundle — as the text of the same Slack message that carries the audio (`🎙️ *Spoken:* …`),
   so audio can never carry a fact the thread does not. Until v5 is applied, transcripts
   Devin pastes are the check; the 20:24Z receipt matched its audio.
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
13. **After every restart, probe before dispatching work.** Post a two-line mention
    (`reply with the word alive and the output of systemctl --user show agent-slack -p
    ActiveEnterTimestamp`). Every healthy turn acks within ~3 s. Two silent mentions in a
    row means the service is down or its Slack socket is dead — stop dispatching and go to
    the console (below). Socket Mode does not replay the backlog: re-send the lost dispatch
    as a fresh thread afterwards. Added 2026-09-05 after the v5 restart went silent.

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

- **Bot silent after the v5 restart (21:02Z, 2026-09-05) — OPEN, console recovery
  dispatched 21:2xZ.** The E3 acceptance dispatch (21:05:27Z, thread 1788642327.877409)
  and a liveness probe (21:19:59Z, thread 1788643199.385959) got no reply, not even the
  instant ack every earlier turn posted within 3 s. Only changes since the last good turn
  (20:59Z): the v5 patch (`bot.js` + `audio-bundle.js`, backups
  `*.bak-20260905T205707Z`) and a new top-level `rules` array in
  `assistants/maia.manifest.json`, then `agent-slack-deferred-restart-1788641936`.
  Diagnose-then-rollback procedure for Manus is in `dispatch/BOT-UNWEDGE.md` ("v5 restart
  incident"). Until she answers, E3 acceptance and the `prompts.inline` follow-up wait.
- **Live progress — LIVE VERIFIED 2026-09-05 17:40Z** (thread 1788629761.176299, on the
  service restarted 17:34:33Z). Long tool calls now show one edited-in-place line
  (`⏳ 1m40s · running: <cmd>` → `✅ 3m00s · <cmd>`); no "Still working" posts; no
  progress-tick audio; the written reply posts as its own message before any audio
  (commit B). Branch `maia/live-progress-heartbeat-v2` (A `ce0b061`, B `36c720a`) applied
  by patch on the box; backup `bot.js.bak-20260905T173052Z`. Full record in
  `dispatch/BOT-LIVE-PROGRESS.md`.
- **Un-wedge (defects 0–2 in `dispatch/BOT-UNWEDGE.md`) — in progress in a third session**
  on branch `maia/unwedge-v1`: absorb the last heartbeat phrase on the narration-stream
  path; a real absolute-cap timer that kills the CLI process group plus a stall detector;
  and the `maia: status` / `maia: restart` / `maia: cancel` control path served before
  any model call, allowlisted via a new `control.conf` drop-in. Apply only when no turn is
  in flight (a restart kills every concurrent turn).
- **Jarvis off?** It is all-or-nothing. Turning it off silences Devin's assistant channels too. Devin's decision; until then the text-is-the-record rule (§5) is the control, and Maia has saved it to memory.
- Source-tree drift: the service runs `agent-platform-live/…/bot.js` (Aug 13); her patched
  tree is `agent-setup/…` (Aug 31, +28 KB). Her button-tap fix cannot reach the running
  process until that is reconciled. Not on the WSF critical path; Devin's call.
