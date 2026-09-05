# Maia's bot — a hung tool call must end itself, and Slack must be able to end it

**Dispatch spec · 2026-09-05 · Code task on Maia's box, not the product repo**
Owner: Maia (or a separate session against `Trifecta-United/agent-platform`), applied via the
deferred-restart pattern in `MAIA_RUNBOOK.md`. Follows `BOT-LIVE-PROGRESS.md`; same file, same
region of `bot.js`. Requested because of 2026-09-05: four hung turns in one thread, none
recoverable from Slack, a person needed at the box.

## Defect 0 — the heartbeat phrase still reaches the narration stream (small, do first)

After the live-progress patch (LIVE VERIFIED 17:40Z), narration channels still get
`_Still working on this..._` appended as a line inside the in-place narration stream
message: the monitor's `appendNarration` wrapper streams every tick into an open stream,
and only the no-stream path absorbs heartbeat ticks. **Required:** absorb heartbeat ticks
(fewer than `progressMonitorMinEvents` new events, the monitor's own test) on the stream
path too. Real narration lines ("I'm editing index.ts…") are unchanged. The phrase must
not be emitted anywhere while a live-progress message exists.

## Defect 1 — a blocked tool call never returns

`bot.js` has turn deadlines (`TURN_DEADLINE_MS`, `TURN_ABSOLUTE_CAP_MS`), but they are checked
between steps. A tool call that blocks — a `tail -f`, a PID watch, an emulator that never
prints "ready" — never reaches the next check. On 2026-09-05 the 15:28Z checkpoint turn was
still heartbeating 57 minutes later, past its 45-minute deadline, with no output.

**Required:** every tool call runs under a hard timeout, enforced by the executor, not the
model:

- Default `TOOL_CALL_TIMEOUT_MS` = 20 minutes, from the environment, overridable per call by
  an explicit argument only.
- Shell commands are spawned in their own process group (`detached: true`) so the timeout
  kills the whole tree (`process.kill(-pid, 'SIGTERM')`, then `SIGKILL` 10 s later), not
  just the shell.
- On timeout the tool returns a normal result the model can read —
  `❌ timeout after 20m0s · <cmd>` plus the last 40 lines of captured output — and the
  live-progress message is finalised the same way. The turn continues; it does not die.
- The timeout must also cover non-shell tools that can block (network reads, file watches).

## Defect 2 — nothing in Slack can reach a wedged bot

Every Slack message becomes a turn, and turns queue behind the wedge. A "kill it" message
posted at 16:22Z on 2026-09-05 never executed. The only recovery was a person at the box.

**Required:** a control path the Slack event handler serves **before** anything is queued or
any model is called. It must not await any lock, queue, or turn state that a wedged turn
could hold.

| Message (exact, case-insensitive, trimmed) | Behaviour |
|---|---|
| `maia: status` | Reply in-thread within 2 s: service uptime; number of turns in flight; for each: thread link, elapsed, current tool command (masked, first 160 chars), seconds since its last output. |
| `maia: restart` | Reply `restarting in 15 s — N turn(s) in flight will be dropped: <thread links>`, then `systemd-run --user --on-active=15 --unit=agent-slack-deferred-restart --collect systemctl --user restart agent-slack`. Never `process.exit()` inline — the reply must land first. |
| `maia: cancel` (in a thread) | End only the turn bound to that thread: kill its process group, finalise its progress message `❌ cancelled · <cmd>`, post `cancelled` — no model call. |

- Allowlist by Slack user ID, read from the environment (`MAIA_CONTROL_USERS`, comma-separated);
  anyone else gets no reply. Devin's ID is `U0AQPK35TAS`.
- Log every control message with user, channel, and action.
- `maia: status` is also the acceptance probe for defect 1: it must answer while a turn is
  deliberately wedged.

## Constraints

- Same rules as `BOT-LIVE-PROGRESS.md`: running tree, timestamped backup, minimal diff,
  deferred restart, no change to `.env`, no secrets in the repo, no PR unless asked.
- Do not change the turn deadlines themselves; they are correct once tool calls can't block.
- Do not add a general-purpose remote-command feature. Three verbs, allowlisted, nothing else.

## Acceptance (through a normal turn, text-only reply, every output pasted)

1. `bash -c 'sleep 1800'` with the timeout set to 60 s for the test: the live-progress
   message finalises `❌ timeout after 1m0s · bash -c 'sleep 1800'` within ~70 s, the turn
   replies normally afterwards, and `ps` shows no leftover `sleep`.
2. While `bash -c 'sleep 300'` is running in thread A, `maia: status` posted in thread B
   answers within 2 s and lists thread A with its elapsed and command.
3. `maia: cancel` in thread A ends it: `❌ cancelled`, `sleep` gone from `ps`, thread B
   unaffected.
4. `maia: restart` from Devin's ID: the reply lands, the service restarts within ~20 s
   (`systemctl --user show agent-slack -p ActiveEnterTimestamp`), and the same message from
   a non-allowlisted test user does nothing.
5. LIVE VERIFIED means all four ran on the running service, with the pasted outputs.
