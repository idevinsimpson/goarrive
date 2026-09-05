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

1. Every turn ends with work **pushed**. A dispatch that expects >15 minutes of inline work is a defect in the dispatch.
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
8. **The truth gate runs in the worktree the task lives in.** `/home/ben/dev-goarrive` is
   her general workdir and sits on whatever branch she last used for another project
   (`claude/talk-to-anyone-setup-5sx86w` on 2026-09-05). Run from there and WSF files
   "do not exist" and origin looks stale. WSF work lives in `/home/ben/dev-goarrive-wsf-e2`
   (and successors); every dispatch names the worktree.

## Where things live on her box (confirmed 2026-09-05)

| What | Where |
|---|---|
| Slack bot token | `SLACK_BOT_TOKEN` in `~/.agent/.env` (siblings: `SLACK_APP_TOKEN`, `SLACK_NOTIFICATION_CHANNEL`, `SLACK_CHANNEL_TALK_TO_MAIA`) |
| Turn caps | `~/.config/systemd/user/agent-slack.service.d/turn-lease.conf` |
| Claude OAuth token | `~/.config/systemd/user/agent-slack.service.d/override.conf` — never edited |
| Running bot | `/home/ben/agent-platform-live/shared/slack-bot/bot.js`, node v22 |
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

## Still open

- **Jarvis off?** It is all-or-nothing. Turning it off silences Devin's assistant channels too. Devin's decision; until then the text-is-the-record rule (§5) is the control, and Maia has saved it to memory.
- Source-tree drift: the service runs `agent-platform-live/…/bot.js` (Aug 13); her patched
  tree is `agent-setup/…` (Aug 31, +28 KB). Her button-tap fix cannot reach the running
  process until that is reconciled. Not on the WSF critical path; Devin's call.
