#!/usr/bin/env bash
# One entry point for local builds, CI and signed releases. Never selects a device.
set -euo pipefail
source "$(dirname "$0")/env.sh"
cd "$RA_PROJECT_ROOT"
profile=debug
targets=(aarch64)
while (($#)); do
    case "$1" in
        --release) profile=release; shift ;;
        --debug) profile=debug; shift ;;
        --target) [[ $# -ge 2 ]] || { echo '--target needs aarch64, armv7, i686, x86_64 or a comma-separated list' >&2; exit 2; }
            IFS=',' read -r -a targets <<< "$2"; shift 2 ;;
        --help|-h) echo 'Usage: scripts/build-android.sh [--debug|--release] [--target aarch64[,armv7,i686,x86_64]]'; exit 0 ;;
        *) echo "Unknown Android build argument: $1" >&2; exit 2 ;;
    esac
done
[[ ${#targets[@]} -gt 0 ]] || { echo 'At least one Android target is required' >&2; exit 2; }
for target in "${targets[@]}"; do
    case "$target" in aarch64|armv7|i686|x86_64) ;; *) echo "Unsupported Android target: $target" >&2; exit 2 ;; esac
done
export ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
# The inherited NDK_HOME on this machine points at an uninstalled r28. Pin r27c.
export NDK_HOME="$ANDROID_HOME/ndk/27.2.12479018"
export ANDROID_NDK_HOME="$NDK_HOME"
[[ -f "$NDK_HOME/source.properties" ]] || { echo "Install NDK 27.2.12479018 in $ANDROID_HOME before building" >&2; exit 1; }
if [[ "$profile" == release ]]; then
    : "${ANYWORK_ANDROID_KEYSTORE:?Release signing keystore is required}"
    : "${ANYWORK_ANDROID_STORE_PASSWORD:?Release signing store password is required}"
    : "${ANYWORK_ANDROID_KEY_PASSWORD:?Release signing key password is required}"
    export ANYWORK_ANDROID_KEY_ALIAS="${ANYWORK_ANDROID_KEY_ALIAS:-anywork}"
    export ANYWORK_ANDROID_KEYSTORE="$(cd "$(dirname "$ANYWORK_ANDROID_KEYSTORE")" && pwd)/$(basename "$ANYWORK_ANDROID_KEYSTORE")"
    # Scope size optimization to this Android invocation (including Gradle's
    # child Cargo builds), without changing desktop/workspace release profiles.
    # Strip static symbols, preserving the dynamic JNI exports and unwind data.
    export CARGO_PROFILE_RELEASE_DEBUG=0
    export CARGO_PROFILE_RELEASE_STRIP=symbols
    echo 'Android release: debug=0, strip=symbols'
fi
cli="$RA_PROJECT_ROOT/node_modules/@tauri-apps/cli/tauri.js"
[[ -f "$cli" ]] || { echo 'Run npm ci at the repository root first' >&2; exit 1; }
args=(android build --ci --apk --split-per-abi --target "${targets[@]}")
[[ "$profile" != debug ]] || args+=(--debug)
# Rust static and shared objects must support Android 16 KiB page-size devices.
export RUSTFLAGS="${RUSTFLAGS:-} -C link-arg=-Wl,-z,max-page-size=16384"
(
    cd crates/mobile
    node "$cli" "${args[@]}" -- --locked
)
project="$RA_PROJECT_ROOT/crates/mobile/gen/android"
if [[ "$profile" == debug ]]; then variant=Debug; else variant=Release; fi
lint_tasks=()
rust_excludes=(-x rustBuildUniversalRelease -x rustBuildUniversalDebug)
flavors=()
abis=()
asset_arches=()
for target in "${targets[@]}"; do
    case "$target" in
        aarch64) flavor=arm64; abi=arm64-v8a; asset_arch=arm64 ;;
        armv7) flavor=arm; abi=armeabi-v7a; asset_arch=armv7 ;;
        i686) flavor=x86; abi=x86; asset_arch=x86 ;;
        x86_64) flavor=x86_64; abi=x86_64; asset_arch=x86_64 ;;
    esac
    # Bash 3.2 (macOS) has no ${name^} expansion.
    case "$flavor" in arm64) task_arch=Arm64 ;; arm) task_arch=Arm ;; x86) task_arch=X86 ;; x86_64) task_arch=X86_64 ;; esac
    flavors+=("$flavor")
    abis+=("$abi")
    asset_arches+=("$asset_arch")
    lint_tasks+=(":app:lint$task_arch$variant")
    rust_excludes+=(-x "rustBuild${task_arch}Release" -x "rustBuild${task_arch}Debug")
done
(
    cd "$project"
    # AGP's optimized release variants have no app unit-test component. Lint
    # every packaged flavor; shared JVM fixtures run once on Debug, without
    # rebuilding either profile's Rust tasks or creating a universal APK.
    "${ANYWORK_GRADLE_BIN:-./gradlew}" "${lint_tasks[@]}" \
        :app:testUniversalDebugUnitTest :tauri-plugin-mobile-system:testDebugUnitTest \
        :tauri-plugin-mobile-auth:testDebugUnitTest :anywork-logto-core:test "${rust_excludes[@]}"
)
for index in "${!targets[@]}"; do
    flavor="${flavors[$index]}"
    asset_arch="${asset_arches[$index]}"
    if [[ "$profile" == release ]]; then
        output="$RA_PROJECT_ROOT/release/anywork-android-$asset_arch.apk"
    elif [[ "$asset_arch" == arm64 ]]; then
        output="$RA_PROJECT_ROOT/artifacts/anywork-android-debug.apk"
    else
        output="$RA_PROJECT_ROOT/artifacts/anywork-android-$asset_arch-debug.apk"
    fi
    mkdir -p "$(dirname "$output")"
    cp "$project/app/build/outputs/apk/$flavor/$profile/app-$flavor-$profile.apk" "$output"
    python3 scripts/check-android-apk.py "$output" --profile "$profile" --abi "${abis[$index]}"
    echo "$output"
done
