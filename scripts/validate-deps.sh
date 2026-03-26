#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# validate-deps.sh — Dependency validation for GoArrive app
#
# Scans source files for known Expo/RN imports and verifies they exist in
# package.json. Catches missing dependencies before build failures.
#
# Usage:  ./scripts/validate-deps.sh
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="apps/goarrive"
PKG_JSON="$APP_DIR/package.json"
ERRORS=0

echo "🔍 Validating dependencies for GoArrive app..."
echo ""

# ── Required expo packages (used in source code) ─────────────────────────────
REQUIRED_DEPS=(
  "expo"
  "expo-av"
  "expo-constants"
  "expo-device"
  "expo-file-system"
  "expo-font"
  "expo-haptics"
  "expo-image-picker"
  "expo-linking"
  "expo-notifications"
  "expo-router"
  "expo-speech"
  "expo-status-bar"
  "firebase"
  "react"
  "react-native"
)

for dep in "${REQUIRED_DEPS[@]}"; do
  if ! grep -q "\"$dep\"" "$PKG_JSON"; then
    echo "  ❌ Missing: $dep"
    ERRORS=$((ERRORS + 1))
  else
    echo "  ✅ Found:   $dep"
  fi
done

echo ""

# ── Check for caret ranges on Expo packages (should be pinned) ───────────────
echo "🔒 Checking for unpinned Expo dependencies..."
EXPO_CARET=$(grep -E '"expo-[^"]+": "\^' "$PKG_JSON" || true)
if [ -n "$EXPO_CARET" ]; then
  echo "  ⚠️  Unpinned Expo packages found (use ~ or exact versions):"
  echo "$EXPO_CARET" | while read -r line; do
    echo "    $line"
  done
  ERRORS=$((ERRORS + 1))
else
  echo "  ✅ All Expo packages are pinned"
fi

echo ""

# ── Check for source imports that reference uninstalled packages ──────────────
echo "📦 Scanning source for unresolved imports..."
IMPORT_PATTERN="from ['\"]expo-[^'\"]*['\"]"
IMPORTS=$(grep -roh "$IMPORT_PATTERN" "$APP_DIR" --include="*.ts" --include="*.tsx" 2>/dev/null | sort -u || true)

while IFS= read -r imp; do
  [ -z "$imp" ] && continue
  # Extract package name
  PKG=$(echo "$imp" | sed "s/from ['\"]//;s/['\"]//;s|/.*||")
  if ! grep -q "\"$PKG\"" "$PKG_JSON"; then
    echo "  ❌ Import '$PKG' found in source but missing from package.json"
    ERRORS=$((ERRORS + 1))
  fi
done <<< "$IMPORTS"

echo ""

# ── Check dev dependencies ───────────────────────────────────────────────────
echo "🧪 Checking test dependencies..."
DEV_DEPS=(
  "jest-expo"
  "@types/jest"
)

for dep in "${DEV_DEPS[@]}"; do
  if ! grep -q "\"$dep\"" "$PKG_JSON"; then
    echo "  ❌ Missing devDependency: $dep"
    ERRORS=$((ERRORS + 1))
  else
    echo "  ✅ Found:   $dep"
  fi
done

echo ""

# ── Summary ──────────────────────────────────────────────────────────────────
if [ "$ERRORS" -gt 0 ]; then
  echo "⚠️  Found $ERRORS issue(s). Please fix before building."
  exit 1
else
  echo "✅ All dependencies validated successfully!"
  exit 0
fi
