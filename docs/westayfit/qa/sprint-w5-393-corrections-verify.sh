#!/bin/bash
# W5 independent verification of W3's #393 corrections.
#
# The corrections were delivered as a PATCH, not a pushed head:
#   docs/wsf-staging/393-reporter-corrections-NOT-APPLIED.patch @ 41ea4dd
# It is a git diff against cb91d7879119ec94550986b1caf9be71723d2942.
#
# READ-ONLY on claude/wsf-staging-mail-binding. The patch is applied to a
# throwaway detached worktree and never committed or pushed. Nothing here
# deploys, authenticates or reads a secret: the reporter is driven against
# stub gcloud binaries only.
#
# Usage, from the repo root:
#   git worktree add --detach /tmp/wt393p cb91d7879119ec94550986b1caf9be71723d2942
#   git show 41ea4dd:docs/wsf-staging/393-reporter-corrections-NOT-APPLIED.patch > /tmp/w3.patch
#   (cd /tmp/wt393p && git apply /tmp/w3.patch)
#   WT=/tmp/wt393p bash docs/westayfit/qa/sprint-w5-393-corrections-verify.sh
set -u
WT=${WT:-/tmp/wt393p}
W=${SCRATCH:-/tmp/wsf-w5-verify}
SRC="$WT/.github"
[ -d "$SRC" ] || { echo "no patched worktree at $WT — see usage"; exit 1; }
reset(){ rm -rf "$W"; mkdir -p "$W"; cp -r "$SRC" "$W/.github"; }
mut(){ python3 -c "
import sys;p='$W/.github/wsf-staging/report-mail-binding.mjs';s=open(p).read()
assert sys.argv[1] in s, 'anchor missing'
open(p,'w').write(s.replace(sys.argv[1],sys.argv[2],1))" "$1" "$2"; }
runmb(){ ( cd "$W" && node .github/wsf-staging/tests/mail-binding.test.mjs >/tmp/w5v.txt 2>&1 ); \
  [ $? -eq 0 ] && echo "    SURVIVED" || { echo "    CAUGHT:"; grep -E '^not ok' /tmp/w5v.txt | head -2 | sed 's/^/      /'; }; }

echo "== full suite on the patched tree (expect 14 suites, 311 assertions, exit 0) =="
( cd "$WT" && node .github/wsf-staging/tests/run-all.mjs >/tmp/w5runall.txt 2>&1; echo "   exit=$?" )
echo "   assertions: $(grep -cE '^(ok |  ok |ok [0-9]+ - )' /tmp/w5runall.txt), failures: $(grep -c '^not ok' /tmp/w5runall.txt)"

echo
echo "== every scenario the corrected reporter answers =="
K=WSF_MAIL_BINDING_WSFSENDVERIFICATIONEMAIL
for s in pinned alias alias-revision-numeric wrong-secret other-variable wrong-project \
         project-number no-secret-field no-project-field no-version malformed partial \
         no-name nosecret revision-wrong-secret denied missing; do
  out=$( cd "$WT" && WSF_GCLOUD_BIN=.github/wsf-staging/tests/fixtures/fake-gcloud.mjs \
    WSF_FAKE_GCLOUD_SCENARIO="$s" node .github/wsf-staging/report-mail-binding.mjs \
    westayfit-staging us-central1 WSF_EMAIL_API_KEY wsfSendVerificationEmail 2>&1 )
  printf "   %-24s state=%-12s served=%s\n" "$s" \
    "$(echo "$out"|sed -n "s/^${K}=//p")" "$(echo "$out"|sed -n "s/^${K}_SERVED=//p")"
done

echo
echo "== W5's M6/M7 ungated-job mutations, re-run against the corrections =="
insert(){ JOB="$1" python3 - <<'PY'
import os
p=os.environ['WFY']; s=open(p).read(); a='\n  mail-preflight:\n'
assert a in s; open(p,'w').write(s.replace(a,'\n'+os.environ['JOB']+a,1))
PY
}
for label in "M6 ungated, benign" "M7 ungated, gcloud secrets versions add"; do
  reset; export WFY="$W/.github/workflows/wsf-staging-deploy.yml"
  case "$label" in
    M6*) insert '  rollout-helper:
    runs-on: ubuntu-latest
    steps:
      - run: echo hello
';;
    M7*) insert '  rollout-helper:
    runs-on: ubuntu-latest
    steps:
      - run: gcloud secrets versions add WSF_EMAIL_API_KEY --data-file=- --project westayfit-staging
';;
  esac
  ( cd "$W" && node .github/wsf-staging/tests/workflow-contract.test.mjs >/tmp/w5wc.txt 2>&1 )
  echo "   $label -> $([ $? -eq 0 ] && echo 'SURVIVED' || echo 'CAUGHT')"
done

echo
echo "== W5's NEW mutations against the new regressions =="
echo "   N1 completeness guard drops the empty-string name check"
reset; mut "    typeof d.name !== 'string' ||
    d.name === '' ||" "    typeof d.name !== 'string' ||"; runmb
echo "   N3 numeric-version predicate loses its anchors"
reset; mut 'const isNumericVersion = (v) => /^\d+$/.test(String(v));' 'const isNumericVersion = (v) => /\d+/.test(String(v));'; runmb
echo "   N4 restore the old either-name match (confirmation: must be CAUGHT)"
reset; mut "  const named = refs.filter((v) => v?.key === envName);" \
           "  const named = refs.filter((v) => v?.key === envName || v?.secret === secretName);"; runmb
echo "   N5 mismatch detection uses every() instead of some()"
reset; mut "    const wrongSecret = named.some(" "    const wrongSecret = named.every("; runmb

echo
echo "== R1: job ids the gating guard's regex cannot see =="
echo "   Each is a GitHub-legal job id, UNGATED, running gcloud secrets versions add."
for NAME in "Rollout:" "rollout-helper:  # temporary helper" "_rollout:" "rollout_helper:"; do
  reset; export WFY="$W/.github/workflows/wsf-staging-deploy.yml" JOBNAME="$NAME"
  python3 - <<'PY'
import os
p=os.environ['WFY']; s=open(p).read(); a='\n  mail-preflight:\n'
job='  '+os.environ['JOBNAME']+'\n    runs-on: ubuntu-latest\n    steps:\n      - run: gcloud secrets versions add WSF_EMAIL_API_KEY --data-file=- --project westayfit-staging\n'
open(p,'w').write(s.replace(a,'\n'+job+a,1))
PY
  ( cd "$W" && node .github/wsf-staging/tests/workflow-contract.test.mjs >/tmp/w5wc.txt 2>&1 )
  printf "   %-38s %s\n" "$NAME" "$([ $? -eq 0 ] && echo 'ALL PASS -- EVADED' || echo CAUGHT)"
done
