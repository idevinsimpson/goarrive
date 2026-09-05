#!/usr/bin/env bash
#
# GATE 1 — the We Stay Fit M-U2 flow, end to end, against the emulator suite.
#
# Builds the web app flag-ON and emulator-pointed, boots Auth + Firestore +
# Functions + Hosting from firebase.westayfit.emulators.json, and drives
# signup -> verify email -> profile setup -> start community -> community page
# through a real browser.
#
# Run it from the repo root:
#
#   scripts/westayfit/gate1.sh
#
# Prerequisites: a JDK (the Firestore and Auth emulators are Java), the
# firebase CLI on PATH, and dependencies installed in apps/westayfit and
# functions-westayfit.
#
# Optional:
#   WSF_PLAYWRIGHT_CHROMIUM=/path/to/chrome   use an already-present Chromium
#                                             instead of Playwright's managed
#                                             download (for sandboxes that
#                                             cannot run `playwright install`)
#
# Exit status is the gate's verdict: 0 = GATE 1 CLEAR.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

EMULATOR_CONFIG="firebase.westayfit.emulators.json"
HOSTING_PORT="$(node -p "require('./${EMULATOR_CONFIG}').emulators.hosting.port")"

command -v firebase >/dev/null 2>&1 || {
  echo "GATE 1 BLOCKED: firebase CLI not on PATH." >&2
  exit 2
}
# Portable Temurin JDK 21 lives at ~/jdk-21 on the sandbox where Devin runs the
# gate. If it's there and nothing else brought a JDK to PATH, pick it up so no
# caller has to remember to export JAVA_HOME.
if [ -z "${JAVA_HOME:-}" ] && [ -x "$HOME/jdk-21/bin/java" ]; then export JAVA_HOME="$HOME/jdk-21"; fi
[ -n "${JAVA_HOME:-}" ] && export PATH="$JAVA_HOME/bin:$PATH"
command -v java >/dev/null 2>&1 || {
  echo "GATE 1 BLOCKED: no java. The Firestore and Auth emulators need a JDK." >&2
  exit 2
}

echo "=== GATE 1 at $(git rev-parse HEAD) ==="

echo "--- unit + types ---"
npm --prefix apps/westayfit run test:vitest
npm --prefix apps/westayfit run ts:check

echo "--- build functions-westayfit ---"
npm --prefix functions-westayfit run build

# The emulator flag is set ONLY here. The app also requires a loopback
# hostname before it will honour it, so this build is still safe if it
# somehow escapes -- but it is a verification build and must never be the
# artifact that gets deployed. PHASE 2 rebuilds without it.
echo "--- build web (auth flag ON, emulator-pointed) ---"
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 \
EXPO_PUBLIC_WSF_USE_EMULATORS=1 \
  npm --prefix apps/westayfit run build:web

echo "--- drive the flow ---"
# Run every spec under tests-e2e/. Named specs get compounded here rather than
# hidden inside a package script so a new spec (E2's e2-join-flow, and future
# ones) shows up in this file's diff — a spec that never runs is worse than no
# spec at all.
WSF_PLAYWRIGHT_BASE_URL="http://127.0.0.1:${HOSTING_PORT}" \
  firebase emulators:exec \
    --project goarrive \
    --config "$EMULATOR_CONFIG" \
    "npm --prefix apps/westayfit run test:e2e -- tests-e2e/mu2-flow.spec.ts tests-e2e/e2-join-flow.spec.ts"

echo
echo "GATE 1 CLEAR — profile-setup succeeded and /community/<id> served 200 on a cold load."
echo "NOTE: apps/westayfit/dist is now an EMULATOR build. Rebuild before deploying."
