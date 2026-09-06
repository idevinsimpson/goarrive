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

## Applied and verified (2026-09-05)

- **Built** in a third session on `maia/unwedge-v1` @ `50dd8bf` (C `508ff48`, D `ec8a5da`,
  E `5d6059f`; harness 96 checks; `npm test` 813/816 = baseline; each patch `git apply
  --check` clean). Root cause of the dead 45-minute deadline: `TURN_DEADLINE_MS` was the
  watchdog's *idle lease*, renewed by every CLI stdout chunk, so a loop of short tool calls
  kept it alive forever; the absolute cap only SIGTERMed the CLI pid, never its process
  group, and never escalated to SIGKILL.
- **Applied on the box 18:17Z** (thread 1788632135.937019): patch route C→D→E, counts
  3 / 4 / 4 / 0 as expected; backup `bot.js.bak-20260905T181619Z`; new drop-in
  `agent-slack.service.d/control.conf` = `MAIA_CONTROL_USERS=U0AQPK35TAS`,
  `TOOL_CALL_TIMEOUT_MS=600000`, `TOOL_STALL_MS=60000` (raised to 900000 after the
  acceptance run); restart fired ~18:20Z.
- **Step 1 — stall detector: LIVE VERIFIED 18:24:47Z** (thread 1788632626.697259): the
  progress line sealed `❌ no output for 1m0s · bash -c 'sleep 1800'` exactly 60 s in, then
  the bot posted `Turn stopped: no output for 1m0s from bash -c 'sleep 1800'. Resend your
  message to retry.` (the stop line arrived 60 s after the seal — the SIGTERM→SIGKILL
  grace plus the reply path; acceptable). Process-group cleanup evidence requested.
- **Residual after C:** the heartbeat phrase still appears once inside the narration
  stream message when a turn has *no* long tool call (only short reads) — seen in the E3
  turn A thread at 18:24Z. C only suppresses it while a live-progress message exists. Next
  patch: never emit the fixed phrase; when the monitor has nothing new, stay silent.

## v5 restart incident (2026-09-05 21:02Z) — RESOLVED 2026-09-06 00:42Z

- **Applied 20:57Z–20:59Z** (thread 1788641770.375139): patch I (`044985b`, branch
  `maia/unwedge-v5` @ `a73d476`) on `bot.js` + `audio-bundle.js`, `APPLIED-I`, `SYNTAX-OK`,
  all nine marker counts as expected; backups `bot.js.bak-20260905T205707Z` and
  `audio-bundle.js.bak-20260905T205707Z`; pre-patch `bot.js` sha256 prefix
  `58ae878c6aff8544` (= `origin/maia/unwedge-v4`). The generator already emits
  `spoken_script`, so no edit there. She also added a top-level `rules` array to
  `assistants/maia.manifest.json` (no rules block existed; `prompts.inline` is the loaded
  paragraph). Restart timer `agent-slack-deferred-restart-1788641936` → ~21:02Z.
- **Symptom:** two mentions after the restart (21:05:27Z acceptance dispatch, 21:19:59Z
  liveness probe) produced nothing — no instant ack, no progress line, no reply. Every
  turn before the restart acked within 3 s. Not a hung turn (rule 11 heartbeats absent);
  the process is down, crash-looping, throwing in the mention handler, or its socket is
  dead. `node --check` cannot catch a load-time or handler-time error, and the 232-check
  harness runs the code outside the real Bolt entry path.
- **Recovery (Manus, console, as `ben`)** — posted 21:2xZ in #dev-westayfit: (1) status +
  `journalctl --user -u agent-slack --since '2026-09-05 21:00:00'`; (2) case A, a trace in
  bot.js/audio-bundle.js → restore both `*.bak-20260905T205707Z` files (keep the broken
  copies as `*.v5-broken-<stamp>`), `node --check`, sha256 prefix must read
  `58ae878c6aff8544`; (3) case B, a manifest/schema error → delete the three-line
  `"rules": [ … ],` block (`sed -i '/^  "rules": \[$/,/^  \],$/d'`), re-validate JSON,
  keep the westayfit channel hunk; (4) `systemctl --user restart agent-slack`, then
  `SubState=running` and a clean Bolt start line in the journal; Devin's native
  `@Maia status` is the proof. Backlog is not replayed: the E3 acceptance dispatch is
  re-sent as a fresh thread afterwards.
- **If A:** v5 stays rolled back until the child session reproduces the failure from the
  journal trace and ships v5.1; the standing rule is still enforced by her memory and the
  manifest. Runbook rule 13 (probe after every restart) comes out of this.
- **Analysis 21:45Z** (child session on `Trifecta-United/agent-platform`, branch
  `maia/unwedge-v5-1` @ `c32c0fc`, docs only; repo + sandbox evidence, nothing verified on
  the box). Verdict **`MANIFEST` (conditional)**: (1) the patch hunks are byte-identical
  to `git diff 89e02ad 044985b`, and a clean apply on the v4 file (`58ae878c…`) yields
  HEAD's `bot.js`; (2) a stub-token load test of v4 and v5 gives identical startup lines,
  Bolt starts, first error is Slack's 403 on the stub token — no JS error on either;
  harness pass, `npm test` 816/816; (3) on the ack path patch I only adds the `audioSink`
  closure argument before `quickAck.post`, and quick-ack posts its text before the sink
  runs, inside try/catch — it cannot suppress the ack; (4) `spoken_script` is in
  `SPOKEN_SCRIPT_FIELDS`, so the Jarvis clip is not withheld; (5) a hand-added top-level
  `rules` key fails the strict manifest schema (`UNKNOWN_FIELD`) → `[composition]
  refusing to boot reason=admission-deny-all`, exit 1 before Bolt exists → under
  `Restart=always`/`RestartSec=5` a crash loop with no Socket Mode connection, exactly the
  observed silence — **iff** `registry.allowed_roots` is declared in the box's config
  (otherwise the manifest is never read and the cause is outside the repo); (6) neither
  the `rules` array nor `prompts.inline` is read by `bot.js`: the turn prompt is
  `slack.base_system_prompt` (+ channel `system_prompt`) in `config.json` /
  `config.local.json`, which is where the standing rule must go.
- **Procedure refined 21:58Z** (reply in thread 1788643312.060589): discriminator
  `journalctl --user -u agent-slack -n 40 --no-pager | grep -E "composition|admission|
  UNKNOWN_FIELD|bot started|refusing|Error"`; step 3 now removes the key with
  `node -e '… delete j.rules … JSON.stringify(j,null,2)'` (any formatting), re-validates
  with `loadManifest` from `shared/assistant-registry/manifest-loader.js`, and never
  `git checkout -- assistants/maia.manifest.json` (the file also carries the westayfit
  channel edit). The v5 code stays in place; markers unchanged. Pass = `Maia bot started
  in Socket Mode` and no `refusing to boot`, then Devin's native `@Maia status`.
- **LIVE CONFIRMED and RECOVERED (Manus, console, 00:31Z–00:42Z 2026-09-06).** Case B.
  Step 1: `MainPID=0 Result=exit-code NRestarts=2281 SubState=auto-restart`; every 5 s the
  journal repeated `[agent-slack] Loaded config overlay: …/config/config.local.json` →
  `[admission] slack.admission.identity {"mode":"deny-all","reason":"registry-unavailable"}`
  → `[admission] slack.composition.wiring {"mode":"refuse","reason":"admission-deny-all"}`
  → `[composition] refusing to boot reason=admission-deny-all` → `status=1/FAILURE`
  (restart counter 2303→2307 in 25 s); box memory fine (6.5 GB available). Step 2B:
  backup `assistants/maia.manifest.json.bak-rules-20260906T003706Z`, `rules removed`,
  `grep -c '"rules"'` = 0, `manifest schema OK` (the real loader), `git diff --stat` still
  4 insertions (the channel edit, kept). Step 3: `systemctl --user restart agent-slack` →
  `MainPID=2247899 NRestarts=0 SubState=running ActiveEnterTimestamp=00:42:18Z`; the
  `--since '-1 min'` journal tail printed `-- No entries --` (run more than a minute after
  the restart on the console; use `-n 30` next time), so the start line is unquoted — a
  process that survives more than 5 s with `NRestarts=0` has passed the admission check.
  The v5 code (`bot.js` + `audio-bundle.js`) stays in place. Lessons: manifest `rules` and
  `prompts.inline` are not read by `bot.js`; unknown manifest keys are a boot failure, not
  a no-op; runbook rule 13 (probe after every restart).
