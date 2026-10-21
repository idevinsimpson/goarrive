#!/bin/bash
# W5 independent review of PR #393 — mutation harness.
#
# Reviewed head: cb91d7879119ec94550986b1caf9be71723d2942
# (branch claude/wsf-staging-mail-binding).
#
# READ-ONLY ON THE REVIEWED BRANCH. Every mutation is applied to a scratch
# COPY of .github taken from a detached worktree of that head; the branch
# itself is never written to. Nothing here deploys, authenticates, or touches
# a real cloud: the reporter is driven against stub `gcloud` binaries only.
#
# Usage:
#   git worktree add --detach /tmp/wt393 cb91d7879119ec94550986b1caf9be71723d2942
#   WT=/tmp/wt393 bash docs/westayfit/qa/sprint-w5-393-mutations.sh
#
# Results recorded at the reviewed head (see sprint-w5-qa-report.md):
#   M1 M2 M3 caught by the PR's own tests; M4 M5 caught incidentally by
#   unrelated rules; M6 M7 M9 SURVIVED; M8 is unmodelled by the fixture.
set -u
WT=${WT:-/tmp/wt393}
SCRATCH=${SCRATCH:-/tmp/wsf-w5-mut}
SRC="$WT/.github"
[ -d "$SRC" ] || { echo "no worktree at $WT — see usage above"; exit 1; }

reset() { rm -rf "$SCRATCH/.github"; mkdir -p "$SCRATCH"; cp -r "$SRC" "$SCRATCH/.github"; }
runsuite() {
  ( cd "$SCRATCH" && node .github/wsf-staging/tests/"$1" >/tmp/w5-out.txt 2>&1 )
  if [ $? -eq 0 ]; then echo "    $1: PASSED  <-- mutation SURVIVED"
  else echo "    $1: FAILED (mutation CAUGHT)"
       grep -m2 -E "^not ok|AssertionError" /tmp/w5-out.txt | sed 's/^/      /'; fi
}
insert_before_preflight() {
  JOB="$1" python3 - <<'PY'
import os
p=os.environ['SCRATCH_YML']; s=open(p).read(); a='\n  mail-preflight:\n'
assert a in s, 'anchor missing'
open(p,'w').write(s.replace(a, '\n'+os.environ['JOB']+a, 1))
PY
}
export SCRATCH_YML="$SCRATCH/.github/workflows/wsf-staging-deploy.yml"

echo "== M1  relabel an alias as the number resolved off the revision =="
reset; python3 - <<'PY'
import os; p=os.environ['SCRATCH']+'/.github/wsf-staging/report-mail-binding.mjs'
s=open(p).read()
old="  const declared = ref.version == null ? 'unset' : String(ref.version);\n  const pinned = /^\\d+$/.test(declared);\n  const served = revisionBinding(revision);\n"
new="  let declared = ref.version == null ? 'unset' : String(ref.version);\n  const pinned = /^\\d+$/.test(declared);\n  const served = revisionBinding(revision);\n  if (!pinned && served.version) declared = served.version;\n"
assert old in s; open(p,'w').write(s.replace(old,new))
PY
runsuite mail-binding.test.mjs

echo "== M2  drop the permission guard, so the hedge phrase reads as absence =="
reset; python3 - <<'PY'
import os; p=os.environ['SCRATCH']+'/.github/wsf-staging/report-mail-binding.mjs'
s=open(p).read()
old="  if (s.includes('permission') || s.includes('denied') || s.includes('lacks access')) return false;\n  return s.includes('not_found') || s.includes('could not be found');"
new="  return s.includes('not_found') || s.includes('could not be found') || s.includes('does not exist');"
assert old in s; open(p,'w').write(s.replace(old,new))
PY
runsuite mail-binding.test.mjs

echo "== M3  revision read becomes a bare describe (full environment dump) =="
reset; python3 - <<'PY'
import os; p=os.environ['SCRATCH']+'/.github/wsf-staging/report-mail-binding.mjs'
s=open(p).read(); old="    '--format=json(spec.containers[].env)',"; new="    '--format=json',"
assert old in s; open(p,'w').write(s.replace(old,new))
PY
runsuite mail-binding.test.mjs; runsuite workflow-contract.test.mjs

echo "== M6  UNGATED job (no if:), benign step =="
reset; insert_before_preflight '  rollout-helper:
    runs-on: ubuntu-latest
    steps:
      - name: Anything
        run: echo hello
'
runsuite workflow-contract.test.mjs

echo "== M7  UNGATED job writing a new version of the secret under review =="
reset; insert_before_preflight '  rollout-helper:
    runs-on: ubuntu-latest
    environment: wsf-staging
    steps:
      - name: Rotate
        run: gcloud secrets versions add WSF_EMAIL_API_KEY --data-file=- --project westayfit-staging
'
runsuite workflow-contract.test.mjs

echo "== M8  revision carries the ALIAS, as real Cloud Run does for :latest =="
reset; python3 - <<'PY'
import os; p=os.environ['SCRATCH']+'/.github/wsf-staging/tests/fixtures/fake-gcloud.mjs'
s=open(p).read(); old="  process.stdout.write(revisionJson('2'));"
new="  process.stdout.write(revisionJson(scenario.startsWith('alias') ? 'latest' : '2'));"
assert old in s; open(p,'w').write(s.replace(old,new))
PY
( cd "$SCRATCH" && WSF_GCLOUD_BIN=.github/wsf-staging/tests/fixtures/fake-gcloud.mjs \
  WSF_FAKE_GCLOUD_SCENARIO=alias node .github/wsf-staging/report-mail-binding.mjs \
  p us-central1 WSF_EMAIL_API_KEY fnA | grep -E "declared version|served version" )

echo "== M9  env var WSF_EMAIL_API_KEY fed from a DIFFERENT secret =="
reset; python3 - <<'PY'
import os; p=os.environ['SCRATCH']+'/.github/wsf-staging/tests/fixtures/fake-gcloud.mjs'
s=open(p).read()
old="secret: 'WSF_EMAIL_API_KEY', version }"; new="secret: 'RESEND_API_KEY', version }"
assert old in s; open(p,'w').write(s.replace(old,new))
PY
runsuite mail-binding.test.mjs
