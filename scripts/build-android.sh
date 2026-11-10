#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/env.sh"
cd "$RA_PROJECT_ROOT"
# Android is a fixed HTTPS Custom Tab host; no bundled Web assets or user data.
cd android
"${ANYWORK_GRADLE_BIN:-./gradlew}" :app:assembleDebug :app:lintDebug :app:testDebugUnitTest
mkdir -p ../artifacts
cp app/build/outputs/apk/debug/app-debug.apk ../artifacts/anywork-android-debug.apk
