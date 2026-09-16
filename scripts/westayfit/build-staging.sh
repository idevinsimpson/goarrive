#!/usr/bin/env bash
#
# Build the We Stay Fit web artifact FOR STAGING, or refuse.
#
# WHY THIS SCRIPT EXISTS SEPARATELY FROM `npm run build:web`.
# build:web is environment-agnostic: given no staging variables it happily
# produces a correct PRODUCTION artifact. That is right for build:web and wrong
# for a deployment path. If the staging variables are missing — unset in CI, a
# typo'd secret name, an env file that did not load — the deploy path must not
# quietly hand back a production build for someone to push to a staging URL.
#
# So this is a second, independent gate. It re-checks staging mode itself
# rather than trusting the app's own resolver, and it requires the approved
# project id to be named ON THE COMMAND LINE. There is deliberately no default:
# a script that defaults its target is a script that deploys somewhere nobody
# chose.
#
# Usage, from the repo root:
#
#   EXPO_PUBLIC_WSF_ENV=staging \
#   EXPO_PUBLIC_WSF_AUTH_ENABLED=1 \
#   EXPO_PUBLIC_WSF_STAGING_PROJECT_ID=<id> \
#   EXPO_PUBLIC_WSF_STAGING_API_KEY=<key> \
#   EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN=<id>.firebaseapp.com \
#   EXPO_PUBLIC_WSF_STAGING_STORAGE_BUCKET=<id>.firebasestorage.app \
#   EXPO_PUBLIC_WSF_STAGING_SENDER_ID=<sender> \
#   EXPO_PUBLIC_WSF_STAGING_APP_ID=<appId> \
#     scripts/westayfit/build-staging.sh --approved-project <id>
#
# Every value comes from the registered staging Web App's own SDK config.
# None of them is guessed here and none is defaulted from production.

set -euo pipefail

PRODUCTION_PROJECT_ID='goarrive'
PRODUCTION_PROJECT_NUMBER='413741232388'
DIST='apps/westayfit/dist'
APPROVED=''

while [ $# -gt 0 ]; do
  case "$1" in
    --approved-project)
      # `shift 2` shifts nothing when only one argument remains, and `|| true`
      # swallowed the failure, so this loop spun forever on the same argument.
      if [ $# -lt 2 ]; then
        echo "build-staging: --approved-project needs a value" >&2
        exit 2
      fi
      APPROVED="$2"
      shift 2
      ;;
    --approved-project=*)
      APPROVED="${1#*=}"
      shift
      ;;
    *)
      echo "build-staging: unknown argument '$1'" >&2
      exit 2
      ;;
  esac
done

fail() {
  # After the export has run, a refusal must also REMOVE the artifact. Leaving
  # a non-staging dist/ in place is exactly what lets a later deploy ship it.
  if [ "${BUILD_RAN:-0}" = "1" ] && [ -d "$DIST" ]; then
    rm -rf "$DIST"
    echo "" >&2
    echo "STAGING BUILD REFUSED — the artifact was removed." >&2
  else
    echo "" >&2
    echo "STAGING BUILD REFUSED — no artifact was produced." >&2
  fi
  for line in "$@"; do echo "  $line" >&2; done
  echo "" >&2
  echo "  This path never falls back to a production build." >&2
  exit 1
}

# 1. The target must be named explicitly. No default, no inference.
[ -n "$APPROVED" ] || fail \
  "--approved-project was not given." \
  "Name the staging project this artifact is allowed to target, e.g." \
  "  scripts/westayfit/build-staging.sh --approved-project wsf-staging"

# Case-insensitive, and rejecting the project number and sibling ids, to match
# namesProductionProject() in stagingEnv.ts. 'GoArrive' used to clear this
# check while its authDomain still resolved to production: DNS ignores case.
APPROVED_LC=$(printf '%s' "$APPROVED" | tr '[:upper:]' '[:lower:]')
case "$APPROVED_LC" in
  *"$PRODUCTION_PROJECT_ID"*|"$PRODUCTION_PROJECT_NUMBER")
    fail \
      "--approved-project is '$APPROVED', which names the production project." \
      "Refused for any casing, for production's project number, and for sibling ids." \
      "A Hosting preview channel of production is not a staging backend."
    ;;
esac

# 2. Staging mode, checked here independently of the app's own resolver.
# Trimmed, because the resolver trims. Two gates disagreeing about what
# ' staging ' means is how a build gets refused for a reason nobody can find.
WSF_ENV_TRIMMED=$(printf '%s' "${EXPO_PUBLIC_WSF_ENV:-}" | tr -d '[:space:]')
[ "$WSF_ENV_TRIMMED" = "staging" ] || fail \
  "EXPO_PUBLIC_WSF_ENV is '${EXPO_PUBLIC_WSF_ENV:-<unset>}', not 'staging'." \
  "A deployment path must not build production by default."

# 3. Every staging value must be present. A missing SET is the exact case this
#    script exists to catch, so it is reported as one message, not six.
MISSING=''
for v in EXPO_PUBLIC_WSF_STAGING_PROJECT_ID \
         EXPO_PUBLIC_WSF_STAGING_API_KEY \
         EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN \
         EXPO_PUBLIC_WSF_STAGING_STORAGE_BUCKET \
         EXPO_PUBLIC_WSF_STAGING_SENDER_ID \
         EXPO_PUBLIC_WSF_STAGING_APP_ID; do
  eval "value=\${$v:-}"
  # Strip every kind of whitespace. `${value// /}` removed spaces only, so a
  # tab-only value read as present and the script went on to run a build.
  stripped=$(printf '%s' "$value" | tr -d '[:space:]')
  [ -n "$stripped" ] || MISSING="$MISSING $v"
done
[ -z "$MISSING" ] || fail \
  "The staging Firebase config is incomplete. Missing:$MISSING" \
  "Supply the registered staging Web App's own SDK config." \
  "Do not fill any blank from production."

# 4. The build's target must be the approved one. This is the check that stops
#    a correct-looking build going to a project nobody approved.
[ "$EXPO_PUBLIC_WSF_STAGING_PROJECT_ID" = "$APPROVED" ] || fail \
  "EXPO_PUBLIC_WSF_STAGING_PROJECT_ID is '$EXPO_PUBLIC_WSF_STAGING_PROJECT_ID'" \
  "but --approved-project is '$APPROVED'. These must be the same project."

# 5. Not against the emulator, and the app must actually be usable.
# Only an ON value conflicts. Testing "set to anything" refused the common CI
# shape of exporting the flag as 0, which the resolver reads as off.
EMU_LC=$(printf '%s' "${EXPO_PUBLIC_WSF_USE_EMULATORS:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')
if [ "$EMU_LC" = "1" ] || [ "$EMU_LC" = "true" ]; then
  fail \
    "EXPO_PUBLIC_WSF_USE_EMULATORS is on. A build targets staging or the local" \
    "emulator suite, never both."
fi

[ "${EXPO_PUBLIC_WSF_AUTH_ENABLED:-}" = "1" ] || fail \
  "EXPO_PUBLIC_WSF_AUTH_ENABLED is not 1, so the built app would render" \
  "'Accounts are opening soon' and could not be smoke-tested."

echo "build-staging: target project '$APPROVED', staging mode confirmed."

# The app's own resolver runs during the export and refuses independently if
# the six values do not describe one coherent project. Both gates must pass.
BUILD_RAN=1
npm --prefix apps/westayfit run build:web

# 6. Verify the ARTIFACT, not just the exit code. A build that succeeded while
#    producing a production bundle would be the whole failure this script is
#    meant to prevent, so check what actually landed on disk.
[ -f "$DIST/index.html" ] || fail "No artifact at $DIST/index.html after a successful build."

# `|| true` matters: grep exits 1 when nothing matches, pipefail propagates
# that, and set -e then killed the script HERE — so the refusal below could
# never print and the non-staging artifact was left on disk, the exact opposite
# of what its message claims.
BANNERED=$( { grep -l 'wsf-staging-banner' "$DIST"/*.html 2>/dev/null || true; } | wc -l | tr -d ' ')
[ "$BANNERED" -gt 0 ] || fail \
  "The built artifact carries no staging banner on any page." \
  "It is not a staging build; refusing to leave it in place." 

if ! grep -q "$APPROVED" "$DIST"/_expo/static/js/web/*.js 2>/dev/null; then
  fail "The built bundle does not reference project '$APPROVED'."
fi

echo ""
echo "STAGING BUILD OK"
echo "  project        : $APPROVED"
echo "  commit         : $(git rev-parse --short HEAD)"
echo "  artifact       : $DIST"
echo "  pages bannered : $BANNERED"
echo ""
echo "  This artifact targets a staging backend and is labelled on every page."
echo "  Deploy it with the westayfit Hosting config. Synthetic data only."
