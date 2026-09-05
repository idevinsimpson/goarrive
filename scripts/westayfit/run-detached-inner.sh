#!/usr/bin/env bash
# Runs INSIDE the transient unit launched by run-detached.sh. Do not call directly.
#
#   $1 unit   $2 channel   $3 thread-ts   $4 log path   $5 token file   $6.. command
set -u
UNIT=$1 CHANNEL=$2 THREAD=$3 LOG=$4 TOKEN_FILE=$5
shift 5

report() {
  # Posts exit status + log tail to the thread. Never fails the job: a report
  # problem is logged, not raised, so the exit code stays the job's own.
  node - "$UNIT" "$CHANNEL" "$THREAD" "$LOG" "$TOKEN_FILE" "$1" <<'JS' >>"$LOG.report" 2>&1 || true
const [unit, channel, thread, log, tokenFile, rc] = process.argv.slice(2);
const fs = require('fs');
const token = fs.readFileSync(tokenFile, 'utf8').trim();
let tail = '';
try { tail = fs.readFileSync(log, 'utf8').split('\n').slice(-40).join('\n'); } catch (e) { tail = `(no log: ${e.message})`; }
tail = tail.replace(/```/g, '` ` `');
if (tail.length > 2800) tail = '…' + tail.slice(-2800);
const status = rc === '0' ? '✅ ok' : (rc === '143' ? '⚠️ terminated (SIGTERM)' : `❌ exit ${rc}`);
const text = `*${unit}* — ${status} · ${new Date().toISOString()}\nlog: \`${log}\`\n\n\`\`\`\n${tail}\n\`\`\``;
fetch('https://slack.com/api/chat.postMessage', {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ channel, thread_ts: thread, text }),
}).then(async r => {
  const body = await r.text();
  let j; try { j = JSON.parse(body); } catch { console.error(`slack post: HTTP ${r.status}, non-JSON reply: ${body.slice(0, 200)}`); process.exit(1); }
  if (!j.ok) { console.error('slack post failed:', j.error); process.exit(1); }
  console.log('slack post ok', j.ts);
}).catch(e => { console.error('slack post error:', e.message); process.exit(1); });
JS
}

# A SIGTERM (unit stopped, box shutting down) still yields a report.
trap 'report 143; exit 143' TERM INT

{
  echo "== $UNIT  started $(date -u +%Y-%m-%dT%H:%M:%SZ)  cwd=$(pwd)"
  echo "== cmd: $*"
  echo
} >"$LOG"

"$@" >>"$LOG" 2>&1
rc=$?
trap - TERM INT
echo "== exit $rc at $(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$LOG"
report "$rc"
exit "$rc"
