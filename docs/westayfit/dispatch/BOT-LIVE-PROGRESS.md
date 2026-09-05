# Maia's bot — live progress instead of "Still working on this…"

**Dispatch spec · 2026-09-05 · Code task on Maia's box, not the product repo**
Owner: Maia, on the **running** tree `/home/ben/agent-platform-live/shared/slack-bot/bot.js`.
Applied via the deferred-restart pattern in `MAIA_RUNBOOK.md`. Requested by Devin.

## The defect

While one tool call runs, `bot.js` posts a fixed string — *"Still working on this…"* — on a
timer, and voices the same non-information as `progress-tick-<ts>.mp3`. On 2026-09-05 a
single hung command produced fifty minutes of it. The reader learns nothing: not what is
running, not for how long, not whether it is producing output.

## Required behaviour

While a tool call is in flight, each heartbeat **edits one message in place** (never posts
a new one) and reads:

```
⏳ 4m10s · running: npm --prefix functions-westayfit run test:callable
last output:
  PASS tests/callable/wsf-join-community.test.ts (12.4s)
  RUNS tests/callable/wsf-check-in.test.ts
```

- **Elapsed** since the tool call started, `Xm YYs`.
- **The command**, first line only, truncated to ~160 chars, secrets masked with the same
  regex the runbook uses for tokens (`xox[abp]-…`, `sk-…`, `AIza…`, anything after `TOKEN=`
  / `KEY=` / `SECRET=`).
- **Last output** — the final 3 non-empty lines of combined stdout+stderr captured so far,
  each truncated to ~200 chars. If nothing has printed yet: `last output: (none yet)`.
- For non-shell tools (file read/write, search), the "command" is the tool name + its
  primary argument (path or pattern).

**One message, edited.** The first heartbeat posts it; every later heartbeat updates it via
`chat.update`. When the tool call finishes, the message is edited one last time to
`✅ 4m22s · npm --prefix … test:callable` (or `❌ exit 1 · …`) so the thread keeps a
one-line record instead of forty identical lines.

**No audio for progress.** `progress-tick-*.mp3` is removed entirely. This is independent
of the reply-audio (Jarvis) decision, which stays Devin's.

**Per-tool summaries stay.** The existing *"I'm reviewing the git history…"* lines are
useful and unchanged.

## Why edit-in-place

Forty "Still working" lines are not forty facts; they are one fact repeated. A single
line that changes is the honest representation, and it is what a person watching from a
phone can actually read.

## Constraints

- Change the **running** tree, with a timestamped backup of `bot.js` first.
- Minimal diff: touch the heartbeat emitter, the progress-tick emitter, and the tool
  executor's output capture. Nothing else — the running tree is ~2 weeks behind the
  patched one and a wide edit invites conflicts.
- The output tail requires the executor to buffer child stdout/stderr as it streams. If
  it already does (likely, since final output is posted), expose the buffer to the
  heartbeat; if it does not, add a bounded ring buffer (last 50 lines).
- Restart via `systemd-run --user --on-active=120 … systemctl --user restart agent-slack`,
  never inline.

## Acceptance

Run one deliberate command through a normal turn (not the runner):
`bash -c 'for i in $(seq 1 18); do echo "step $i of 18"; sleep 10; done'` — three minutes.

Pass when:
1. The thread shows **one** progress message that updates — elapsed climbing, `last output`
   showing `step N of 18` advancing.
2. No new "Still working on this…" message appears.
3. No `progress-tick-*.mp3` is posted.
4. On completion the message reads `✅ 3m0Xs · bash -c 'for i in …'`.
5. A screenshot-equivalent: paste the final edited message text.

Then the same on a real E3 gate run — the heartbeat must show `gate1.sh` and its live tail.
