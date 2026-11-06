#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/env.sh"
cd "$RA_PROJECT_ROOT"
# Keep the running server's Web directory untouched during Android packaging.
if [[ -z "${ANYWORK_ANDROID_WEB_DIR:-}" ]]; then
    android_web="$(mktemp -d "${TMPDIR:-/tmp}/anywork-android-web.XXXXXX")"
    trap 'rm -rf "$android_web"' EXIT
    npm run typecheck
    (cd web && ../node_modules/.bin/vite build --outDir "$android_web" && node scripts/pwa.mjs "$android_web")
    export ANYWORK_ANDROID_WEB_DIR="$android_web"
fi
cd android
"${ANYWORK_GRADLE_BIN:-./gradlew}" :app:assembleDebug :app:lintDebug :app:testDebugUnitTest
mkdir -p ../artifacts
cp app/build/outputs/apk/debug/app-debug.apk ../artifacts/anywork-android-debug.apk
