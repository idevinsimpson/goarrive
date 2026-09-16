#!/usr/bin/env bash
#
# Refuse to let a non-staging artifact be deployed to a staging channel.
#
# `deploy:staging` uploads whatever is sitting in apps/westayfit/dist. That
# directory is produced by `build:web`, which is environment-agnostic and will
# happily build PRODUCTION when no staging variables are set. So the deploy
# script on its own could push a production-pointed bundle to a URL labelled
# staging, with no banner, and nothing would have objected.
#
# This asserts the artifact is what the channel name claims, and is run as a
# pre-step by deploy:staging. It inspects only what is on disk.

set -euo pipefail

DIST="$(cd "$(dirname "$0")/../../apps/westayfit" && pwd)/dist"

fail() {
  echo "" >&2
  echo "STAGING DEPLOY REFUSED — the artifact in dist/ is not a staging build." >&2
  for line in "$@"; do echo "  $line" >&2; done
  echo "" >&2
  echo "  Build it with: scripts/westayfit/build-staging.sh --approved-project <id>" >&2
  exit 1
}

[ -d "$DIST" ] || fail "There is no build at $DIST."
[ -f "$DIST/index.html" ] || fail "There is no index.html at $DIST."

BANNERED=$( { grep -l 'wsf-staging-banner' "$DIST"/*.html 2>/dev/null || true; } | wc -l | tr -d ' ')
[ "$BANNERED" -gt 0 ] || fail \
  "No page in the artifact carries the staging banner." \
  "That means it was built without EXPO_PUBLIC_WSF_ENV=staging — most likely a" \
  "production build, which must never be deployed under a staging label."

if { grep -ho 'goarrive\.firebaseapp\.com' "$DIST"/_expo/static/js/web/*.js 2>/dev/null || true; } \
     | head -1 | grep -q . ; then
  # Production's authDomain appears in every bundle as an inert literal, so its
  # mere presence proves nothing. What matters is whether it is the SELECTED
  # config, and the banner check above already settles that. This block is left
  # as an explicit note rather than a check that would always fire.
  :
fi

echo "staging-artifact check: OK ($BANNERED pages carry the staging banner)"
