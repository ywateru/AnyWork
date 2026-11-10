#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Rust builds on all desktop platforms. Linux/Windows receive a portable directory.
# macOS receives an .app; cross-platform tool binaries must match the build host.
profile="${ANYWORK_DESKTOP_PROFILE:-release}"
npm run build:desktop-ui
args=(--locked --offline -p anywork-desktop)
if [[ "$profile" == release ]]; then args+=(--release); fi
cargo build "${args[@]}"
if [[ "${ANYWORK_DESKTOP_SKIP_SERVER_BUILD:-0}" != 1 ]]; then
  server_args=(--locked --offline -p anywork)
  if [[ "$profile" == release ]]; then server_args+=(--release); fi
  cargo build "${server_args[@]}"
fi
web="${ANYWORK_DESKTOP_WEB_DIR:-web/dist}"
[[ -f "$web/index.html" ]] || { echo "Build the web client first."; exit 1; }
platform="$(uname -s)"
suffix=""
if [[ "$platform" == MINGW* || "$platform" == MSYS* ]]; then suffix=.exe; fi
if [[ "$platform" == Darwin ]]; then
  app="${ANYWORK_DESKTOP_OUTPUT:-artifacts/AnyWork.app}"
  executable="$app/Contents/MacOS/anywork-desktop"
  resources="$app/Contents/Resources"
else
  app="${ANYWORK_DESKTOP_OUTPUT:-artifacts/AnyWork-$(uname -s)-$(uname -m)}"
  executable="$app/anywork-desktop$suffix"
  resources="$app/resources"
fi
mkdir -p "$(dirname "$executable")" "$resources/bin" "$resources/artifacts" "$resources/plugins"
build_target="${CARGO_TARGET_DIR:-target}"
install -m 755 "$build_target/$profile/anywork-desktop$suffix" "$executable"
server="$build_target/$profile/anywork$suffix"
# SKIP_SERVER_BUILD can reuse the already built release server for UI iterations.
if [[ ! -f "$server" && "${ANYWORK_DESKTOP_SKIP_SERVER_BUILD:-0}" == 1 ]]; then server="$build_target/release/anywork$suffix"; fi
install -m 755 "$server" "$resources/bin/anywork$suffix"
cloudflared="${ANYWORK_CLOUDFLARED_BIN:-$(command -v cloudflared || true)}"
if [[ -n "$cloudflared" ]]; then install -m 755 "$cloudflared" "$resources/bin/cloudflared$suffix"; fi
# Retired standalone routes are never bundled in fresh packages. Account transport
# resolves its own pinned cloudflared provider; preserve existing user config.
rm -f "$resources/bin/tunwg$suffix"
cp -R licenses "$resources/"
cp NOTICE LICENSE "$resources/"
rm -rf "$resources/web"
cp -R "$web" "$resources/web"
if [[ -f artifacts/anywork-source.tar.gz ]]; then cp artifacts/anywork-source.tar.gz "$resources/artifacts/"; fi
if [[ "$platform" == Darwin ]]; then
  cp desktop/Info.plist "$app/Contents/Info.plist"
  cp desktop/icon.icns "$resources/AnyWork.icns"
  codesign --force --deep --sign - "$app"
fi
echo "$app"
