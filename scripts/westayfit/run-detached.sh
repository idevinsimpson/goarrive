#!/usr/bin/env bash
# scripts/westayfit/run-detached.sh
#
# Run a long job OUTSIDE the chat turn, and post its result back into a Slack
# thread as plain text when it finishes — whether or not anyone is watching.
#
# Why this exists. Maia's platform kills a turn at a hard cap (30 min as of
# 2026-09-05). Anything still running dies with it, and anything not pushed is
# lost. `systemd-run` already keeps a job alive past the turn; what was missing
# is the REPORT. "A second short turn tails the log" only works if somebody
# sends that second turn, and fifteen dead turns since Aug 27 say nobody does.
# So the job reports itself.
#
# Usage:
#   scripts/westayfit/run-detached.sh <unit> <channel-id> <thread-ts> -- <command ...>
#
# Example:
#   scripts/westayfit/run-detached.sh wsf-e2-gate C0BSRUNM50B 1788580453.505509 -- \
#     bash -lc 'cd ~/dev-goarrive-wsf-e2 && scripts/westayfit/gate1.sh'
#
# One-time setup on the box. The token never leaves the box and never appears
# in chat — it is read from a file only this user can open:
#   mkdir -p ~/.config/wsf-run && chmod 700 ~/.config/wsf-run
#   grep -ohE 'xox[bp]-[A-Za-z0-9-]+' ~/.config/systemd/user/agent-slack.service.d/*.conf \
#     | head -1 > ~/.config/wsf-run/slack-token && chmod 600 ~/.config/wsf-run/slack-token
#
# Output: stdout+stderr of the job go to ~/.local/state/wsf-run/<unit>.<utc>.log.
# The Slack report is the exit status plus the last 40 lines, one text message,
# in the thread you named. A SIGTERM still produces a report (exit 143).
set -u

here=$(cd "$(dirname "$0")" && pwd)
usage() { sed -n '2,32p' "$0" | sed -E 's/^# ?//'; exit 2; }

[ $# -ge 5 ] || usage
UNIT_BASE=$1 CHANNEL=$2 THREAD=$3; shift 3
[ "$1" = "--" ] || usage
shift

case "$THREAD" in *.*) ;; *) echo "thread-ts must look like 1788580453.505509" >&2; exit 2;; esac

STATE=${XDG_STATE_HOME:-$HOME/.local/state}/wsf-run
mkdir -p "$STATE"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
UNIT="$UNIT_BASE-$STAMP"              # unique, so a stale unit of the same name cannot block launch
LOG="$STATE/$UNIT_BASE.$STAMP.log"
TOKEN_FILE=${WSF_RUN_TOKEN_FILE:-$HOME/.config/wsf-run/slack-token}

[ -r "$TOKEN_FILE" ] || { echo "no readable token file at $TOKEN_FILE — see the one-time setup in this script's header" >&2; exit 3; }
command -v node >/dev/null 2>&1 || { echo "node is not on PATH; the reporter needs it" >&2; exit 3; }
command -v systemd-run >/dev/null 2>&1 || { echo "systemd-run not found" >&2; exit 3; }

# Transient units start with a minimal environment. Carry PATH and HOME so the
# job can find node, firebase, and a JDK the same way the chat shell does.
systemd-run --user --unit="$UNIT" --collect --same-dir --quiet \
  --setenv=PATH="$PATH" --setenv=HOME="$HOME" \
  "$here/run-detached-inner.sh" "$UNIT" "$CHANNEL" "$THREAD" "$LOG" "$TOKEN_FILE" "$@" \
  || { echo "systemd-run failed to launch $UNIT" >&2; exit 4; }

echo "launched: $UNIT"
echo "log:      $LOG"
echo "watch:    systemctl --user status $UNIT --no-pager | head -8"
echo "report:   posts itself to thread $THREAD in $CHANNEL on exit. End your turn; do not wait."
