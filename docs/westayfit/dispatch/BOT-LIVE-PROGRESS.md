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

## Apply on the box (Maia, or a person at the box)

The patch is prepared from the `agent-platform` source (branch `maia/live-progress-heartbeat`,
report in `shared/slack-bot/LIVE-PROGRESS-REPORT.md`) because the running tree could not be
read while the bot was wedged. Every step below is copy-paste; every output is pasted back
as text.

```bash
cd /home/ben/agent-platform-live
git status -sb | head -3 && git log -1 --format='%h %ci' -- shared/slack-bot/bot.js   # what the box runs
git fetch origin maia/live-progress-heartbeat
git show origin/maia/live-progress-heartbeat:shared/slack-bot/live-progress.patch > /tmp/live-progress.patch
cp shared/slack-bot/bot.js shared/slack-bot/bot.js.bak-$(date -u +%Y%m%dT%H%M%SZ)  # backup first
git apply --check /tmp/live-progress.patch && git apply /tmp/live-progress.patch     # or: patch -p1 --dry-run < …
node --check shared/slack-bot/bot.js
grep -c 'Still working on this' shared/slack-bot/bot.js                              # expect 0
grep -c 'progress-tick' shared/slack-bot/bot.js                                      # expect 0
systemd-run --user --on-active=120 --unit=agent-slack-deferred-restart --collect systemctl --user restart agent-slack
```

If `git apply --check` rejects a hunk: post the rejection verbatim and stop — do not hand-edit.
If the directory is not a git checkout: `patch -p1 --dry-run < /tmp/live-progress.patch`
then without `--dry-run`, after fetching the patch file some other way (e.g. `curl` from the
GitHub raw URL with a token, or paste).

**Rollback:** `cp shared/slack-bot/bot.js.bak-<stamp> shared/slack-bot/bot.js` and the same
deferred restart.

After the restart, in a **new thread**, run the acceptance command from §Acceptance and
paste the final edited message text. LIVE VERIFIED only when the thread shows one updating
message, no "Still working on this…", no `progress-tick-*.mp3`.

## v2 — rebuilt against the captured running file (2026-09-05 17:22Z)

The v1 branch was built against `main`'s `bot.js` and did not apply: the running tree is
`fix/text-as-button-answer` @ `4f53fd0` plus uncommitted Sep 4 edits. The running file was
captured as `live/agent-slack-2026-09-05` @ `92eae98` (sha256 `2fa097b8…7387`) and the change
rebuilt against it in a second session: branch **`maia/live-progress-heartbeat-v2` @ `0eaf6a3`**.

- **A = `ce0b061`** — the live-progress port. Four of five regions applied on identical
  context; the fallback-timer block in `trackedProcessMessage` (the live tree predates
  `5fa8626` and still posted the literal `_Still working..._` every 65 s) was resolved in
  favour of the tracker-driven timer. Live-only behaviour untouched (proposals imports,
  inline `audioChain`, envelope-guard call shape, frozen options).
- **B = `36c720a`** — the written reply is posted as its own message, with one retry per
  chunk, *before* any audio. Root cause of the "audio-only, empty text" replies: on
  narration channels the final reply was `streamer.append()`ed into the in-place narration
  stream message (so it sorted above the mid-turn posts and looked absent), while
  `finalizeBundle()` uploaded the merged audio with no comment — a file-only message with
  an empty text slot — then the Jarvis clip. A second, real drop path existed on
  non-stream channels when `chat.postMessage` threw.
- Verification: sha256 match before any edit; harness pass; `npm test` 813/816 vs baseline
  813/816 (same three pre-existing failures); `git apply --check` ok for both
  `live-progress-v2.patch` and `reply-text-first.patch` in clean worktrees.
- Expected on the box after A+B: `grep -c 'Still working' bot.js` = 3 (comments only),
  `grep -c '_Still working'` = 0, `grep -c 'postReplyText'` = 4.
- Apply: `git cherry-pick ce0b061` then `36c720a` on a clean worktree (with the frozen-tree
  guard override), else the two patch files; backup + `node --check` + deferred restart
  (`--on-active=180`). Dispatched 17:30Z in its own thread.
- **APPLIED 17:31Z** (thread 1788629421.976339): patch route (worktree had an unrelated
  modified `assistants/maia.manifest.json`); backup `bot.js.bak-20260905T173052Z`;
  `APPLIED-A`, `APPLIED-B`, `SYNTAX-OK`, greps 3 / 0 / 4 as expected; restart timer
  `agent-slack-deferred-restart.timer` armed for ~17:34Z. The turn's own final reply
  still came out audio-first with the text appended into the stream message — the last
  time that code path runs. Acceptance test scheduled for 17:36Z in its own thread.
