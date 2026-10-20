#!/usr/bin/env bash
# NATIVE-CAMERA-1 — Kotlin compile and JVM evidence for apps/westayfit/modules/wsf-pose-camera (Android).
#
# Needs: bash, curl, java (17+), sha256sum, unzip, cmp. Downloads only from Maven Central (no Google Maven,
# no Android SDK). Every jar is sha256-pinned below.
#
#   stage 1 (must pass): compile the PURE contract (WsfPoseContract.kt, java.* / kotlin.* only) and its
#            JVM test runner with kotlinc 2.1.20, run the tests, and write the onPose events the
#            recorded stream produces. Compare them with tests/fixtures/native-camera/android-emitted.json
#            (--update overwrites the committed fixture instead).
#   stage 2 (report): compile ALL module Kotlin against the real Android framework (Robolectric android-all,
#            API 34) and the real expo-modules-core Kotlin/Java sources from node_modules. CameraX,
#            AndroidX lifecycle and MediaPipe live on Google Maven, which is unreachable, and NO stubs are
#            used — so what stays unresolved is listed, by symbol.
#
# Usage: docs/westayfit/qa/camera-evidence/run-kotlin-jvm.sh [--update]
#        WSF_CAMERA_EVIDENCE_DIR=/somewhere/else ... (download / build cache; default ${TMPDIR:-/tmp}/wsf-camera-evidence)
set -euo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)
APP=$REPO/apps/westayfit
MOD=$APP/modules/wsf-pose-camera
SRC=$MOD/android/src/main/java/expo/modules/wsfposecamera
TESTSRC=$MOD/android/src/test/java/expo/modules/wsfposecamera
FIXTURES=$APP/tests/fixtures/native-camera
EXPO_CORE=$APP/node_modules/expo-modules-core/android/src
WORK=${WSF_CAMERA_EVIDENCE_DIR:-${TMPDIR:-/tmp}/wsf-camera-evidence}
JARS=$WORK/jars
OUT=$WORK/out
UPDATE=0
[ "${1:-}" = "--update" ] && UPDATE=1
mkdir -p "$JARS" "$OUT"

# path on https://repo1.maven.org/maven2/ and sha256 (sha1 cross-checked with Maven Central's .sha1 on 2026-10-20)
ARTIFACTS=(
  "org/jetbrains/kotlin/kotlin-compiler/2.1.20/kotlin-compiler-2.1.20.jar 9c160024fb84cfaae2ebe40e2b2358b29497e8153f62a1ba61e253d3aab5e86b"
  "org/jetbrains/kotlin/kotlin-stdlib/2.1.20/kotlin-stdlib-2.1.20.jar 1bcc74e8ce84e2c25eaafde10f1248349cce3062b6e36978cbeec610db1e930a"
  "org/jetbrains/kotlin/kotlin-script-runtime/2.1.20/kotlin-script-runtime-2.1.20.jar ae4397fbb3aa2a1ada09290e753bba99a4114548977c3115526b9958f4cb1a04"
  "org/jetbrains/kotlin/kotlin-reflect/1.6.10/kotlin-reflect-1.6.10.jar 3277ac102ae17aad10a55abec75ff5696c8d109790396434b496e75087854203"
  "org/jetbrains/kotlin/kotlin-reflect/2.1.20/kotlin-reflect-2.1.20.jar 419778f2b7a826bad6ee2ca1e4bdebe639ab306d2904fa3ef2a308ecfaab3811"
  "org/jetbrains/intellij/deps/trove4j/1.0.20200330/trove4j-1.0.20200330.jar c5fd725bffab51846bf3c77db1383c60aaaebfe1b7fe2f00d23fe1b7df0a439d"
  "org/jetbrains/kotlinx/kotlinx-coroutines-core-jvm/1.8.0/kotlinx-coroutines-core-jvm-1.8.0.jar 9860906a1937490bf5f3b06d2f0e10ef451e65b95b269f22daf68a3d1f5065c5"
  "org/jetbrains/kotlinx/kotlinx-coroutines-core-jvm/1.7.3/kotlinx-coroutines-core-jvm-1.7.3.jar 1ab3acc38f3e7355c4f9d1ec62107a46fa73c899f3070d055e5d4373dfe67e12"
  "org/jetbrains/kotlinx/kotlinx-coroutines-android/1.7.3/kotlinx-coroutines-android-1.7.3.jar 59fffb26bee12c32dadcfa5d420c2a7db85d3253518128b170efda726613256d"
  "org/jetbrains/annotations/13.0/annotations-13.0.jar ace2a10dc8e2d5fd34925ecac03e4988b2c0f851650c94b8cef49ba1bd111478"
  "org/robolectric/android-all/14-robolectric-10818077/android-all-14-robolectric-10818077.jar 6be2218c6a53fe3c57bc22ebdc723edcb7270a8a6f187545708aa5c0ed813977"
  "com/facebook/fbjni/fbjni/0.7.0/fbjni-0.7.0.aar 7e319ae110ac5e5ef18904170aea5c3e753e915d196699d7fd39d36c8e1dfe36"
)

fetch() {
  local path=$1 sha=$2 file
  file=$JARS/$(basename "$path")
  if [ ! -s "$file" ]; then
    local i code
    for i in 1 2 3 4 5 6 7 8; do
      code=$(curl -sS -m 900 -o "$file.part" -w '%{http_code}' "https://repo1.maven.org/maven2/$path" || echo 000)
      [ "$code" = 200 ] && { mv "$file.part" "$file"; break; }
      echo "  retry $(basename "$path") (HTTP $code)" >&2
      sleep $((i * 5))
    done
  fi
  [ -s "$file" ] || { echo "download failed: $path" >&2; exit 2; }
  echo "$sha  $file" | sha256sum -c --quiet - || { echo "sha256 mismatch: $file" >&2; exit 2; }
}

echo "== fetching pinned jars into $JARS"
for a in "${ARTIFACTS[@]}"; do fetch $a; done
[ -s "$JARS/fbjni-classes.jar" ] || unzip -p "$JARS/fbjni-0.7.0.aar" classes.jar > "$JARS/fbjni-classes.jar"

KOTLINC_CP=$JARS/kotlin-compiler-2.1.20.jar:$JARS/kotlin-stdlib-2.1.20.jar:$JARS/kotlin-script-runtime-2.1.20.jar:$JARS/kotlin-reflect-1.6.10.jar:$JARS/trove4j-1.0.20200330.jar:$JARS/kotlinx-coroutines-core-jvm-1.8.0.jar:$JARS/annotations-13.0.jar
kotlinc() { java -Xmx3g -cp "$KOTLINC_CP" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler "$@"; }
STDLIB=$JARS/kotlin-stdlib-2.1.20.jar

echo "== kotlinc version"
kotlinc -version 2>&1 | grep -i 'kotlinc-jvm' || true

# ── Stage 1: the pure contract, compiled and run on the JVM ──────────────────
echo "== stage 1: pure contract (WsfPoseContract.kt) + JVM tests"
if grep -nE '^import (android|androidx|com\.google|com\.facebook|expo)\.' "$SRC/WsfPoseContract.kt"; then
  echo "WsfPoseContract.kt must stay Android-free" >&2
  exit 1
fi
rm -rf "$OUT/jvm"
kotlinc -no-stdlib -no-reflect -cp "$STDLIB" -jvm-target 17 -language-version 2.1 -api-version 2.1 \
  -d "$OUT/jvm" "$SRC/WsfPoseContract.kt" "$TESTSRC/WsfPoseContractTest.kt"
java -cp "$OUT/jvm:$STDLIB" expo.modules.wsfposecamera.WsfPoseContractTestKt \
  "$MOD/assets/pose_landmarker_lite.task" "$MOD/android/build.gradle" \
  "$FIXTURES/landmark-stream.json" "$OUT/android-emitted.json"
if [ "$UPDATE" = 1 ]; then
  cp "$OUT/android-emitted.json" "$FIXTURES/android-emitted.json"
  echo "  updated $FIXTURES/android-emitted.json"
elif cmp -s "$OUT/android-emitted.json" "$FIXTURES/android-emitted.json"; then
  echo "  android-emitted.json reproduced byte for byte ($(sha256sum < "$OUT/android-emitted.json" | cut -c1-16)…)"
else
  echo "  android-emitted.json differs from the committed fixture (run with --update after reviewing)" >&2
  exit 1
fi

# ── Stage 2: every module file against the real Android framework + expo-modules-core sources ──
echo "== stage 2: all module Kotlin vs android-all (API 34) + expo-modules-core sources (no stubs)"
[ -d "$EXPO_CORE/main/java" ] || { echo "run npm ci in apps/westayfit first ($EXPO_CORE missing)" >&2; exit 2; }
CP=$JARS/android-all-14-robolectric-10818077.jar:$STDLIB:$JARS/kotlin-reflect-2.1.20.jar:$JARS/kotlinx-coroutines-core-jvm-1.7.3.jar:$JARS/kotlinx-coroutines-android-1.7.3.jar:$JARS/fbjni-classes.jar:$JARS/annotations-13.0.jar
LOG=$OUT/stage2-kotlinc.log
set +e
kotlinc -no-stdlib -no-reflect -cp "$CP" -jvm-target 17 -language-version 2.1 -api-version 2.1 -d "$OUT/android" \
  "$SRC" "$EXPO_CORE/main/java" "$EXPO_CORE/withoutCompose" > "$LOG" 2>&1
STATUS=$?
set -e
echo "  kotlinc exit $STATUS (expected non-zero: Google Maven libraries are absent); full log: $LOG"
# kotlinc prints paths relative to the working directory when it can; normalise to repo-relative.
REL_SRC=${SRC#"$REPO"/}
REL_CORE=${EXPO_CORE#"$REPO"/}
sed -E "s|^$REPO/||; s|^$(pwd)/||" "$LOG" | grep -E '^[^ ].*:[0-9]+:[0-9]+: error: ' > "$OUT/stage2-errors.txt" || true
OURS=$(grep -E "^$REL_SRC/" "$OUT/stage2-errors.txt" || true)
echo "  errors inside expo-modules-core sources (not ours; React Native / AndroidX jars absent): $(grep -cE "^$REL_CORE/" "$OUT/stage2-errors.txt" || true)"
echo "  errors in module files: $(printf '%s\n' "$OURS" | grep -c . || true)"
for f in "$SRC"/*.kt; do
  printf '    %-28s %s\n' "$(basename "$f")" "$(printf '%s\n' "$OURS" | grep -c "^$REL_SRC/$(basename "$f"):" || true)"
done
echo "  unresolved symbols in module files (by name):"
printf '%s\n' "$OURS" | sed -nE "s/.*error: unresolved reference '([^']+)'.*/\1/p" | sort | uniq -c | sort -rn | sed 's/^/    /'
echo "  module-file errors that are NOT 'unresolved reference' (each must trace to an unresolved Google Maven type):"
printf '%s\n' "$OURS" | grep -v "unresolved reference" | sed -E "s|^$REL_SRC/||" | sed 's/^/    /' || true

# Hard checks: the Expo module DSL file and the pure contract compile with no error at all, and every
# unresolved IMPORT in the module is a Google Maven library (CameraX, AndroidX lifecycle, MediaPipe).
FAIL=0
for f in WsfPoseCameraModule.kt WsfPoseContract.kt; do
  if printf '%s\n' "$OURS" | grep -q "^$REL_SRC/$f:"; then echo "  FAIL: $f has compile errors" >&2; FAIL=1; fi
done
while IFS=: read -r file line _; do
  [ -n "$file" ] || continue
  src=$(sed -n "${line}p" "$REPO/$file")
  case "$src" in
    import\ androidx.camera.*|import\ androidx.lifecycle.*|import\ com.google.mediapipe.*) ;;
    import\ *) echo "  FAIL: unexpected unresolved import: $file:$line: $src" >&2; FAIL=1 ;;
  esac
done <<< "$OURS"
[ "$FAIL" = 0 ] && echo "  OK: WsfPoseCameraModule.kt and WsfPoseContract.kt compile clean; unresolved imports are only androidx.camera / androidx.lifecycle / com.google.mediapipe"
exit "$FAIL"
