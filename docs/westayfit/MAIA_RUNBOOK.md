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

- **Jarvis audio.** A voice-reply feature live since 2026-06-07 in the assistant channels
  is active in the dev channels too. Her final summary each turn is voiced, and the text
  slot posts **empty**. The 1a hosting receipt was delivered this way and asked for three
  times as "missing".
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

One-time setup and the acceptance self-test are in the script header. **Standing rule:**
any build, deploy, gate run, emulator suite, or `npm ci` goes through it. Inline
long-running work inside a chat turn is no longer acceptable.

## Dispatch rules that follow

1. Every turn ends with work **pushed**. A dispatch that expects >15 minutes of inline work is a defect in the dispatch.
2. Long steps go through `run-detached.sh`. The dispatch names the thread-ts to report into.
3. Mention her as `<@U0AQAGGMTE3|Maia>`. Plain `@Maia` pings nobody.
4. Read her **threads**, not the channel.
5. **The written reply is the record.** Audio may only repeat what the text says, never add to it. Devin has transcribed audio replies and found content that was not in the thread; the 1a receipt was delivered audio-only with an empty text slot. Until the toggle is found and turned off for dev channels: "Text reply only — no Jarvis audio", and anything spoken must also be typed.
6. Fresh thread per dispatch. A 350-reply thread kills even zero-tool turns.

## Still open

- Which config controls Jarvis audio, and turning it off for `#dev-westayfit` / `#dev-goarrive`.
- Source-tree drift: the service runs `agent-platform-live/…/bot.js` (Aug 13); her patched
  tree is `agent-setup/…` (Aug 31, +28 KB). Her button-tap fix cannot reach the running
  process until that is reconciled. Not on the WSF critical path; Devin's call.
