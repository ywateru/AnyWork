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
install -m 755 "target/$profile/anywork-desktop$suffix" "$executable"
server="target/$profile/anywork$suffix"
# SKIP_SERVER_BUILD can reuse the already built release server for UI iterations.
if [[ ! -f "$server" && "${ANYWORK_DESKTOP_SKIP_SERVER_BUILD:-0}" == 1 ]]; then server="target/release/anywork$suffix"; fi
install -m 755 "$server" "$resources/bin/anywork$suffix"
cloudflared="${ANYWORK_CLOUDFLARED_BIN:-$(command -v cloudflared || true)}"
if [[ -n "$cloudflared" ]]; then install -m 755 "$cloudflared" "$resources/bin/cloudflared$suffix"; fi
tunwg="${ANYWORK_TUNWG_BIN:-}"
if [[ -z "$tunwg" && "$platform" == Darwin ]]; then
  if [[ "$(uname -m)" == arm64 ]]; then tunwg=artifacts/tools/tunwg-darwin-arm64; else tunwg=artifacts/tools/tunwg-darwin; fi
fi
if [[ -n "$tunwg" && -f "$tunwg" ]]; then install -m 755 "$tunwg" "$resources/bin/tunwg$suffix"; fi
cp -R licenses "$resources/"
cp NOTICE LICENSE "$resources/"
rm -rf "$resources/web"
cp -R "$web" "$resources/web"
if [[ -f artifacts/anywork-source.tar.gz ]]; then cp artifacts/anywork-source.tar.gz "$resources/artifacts/"; fi
if [[ "$platform" == Darwin ]]; then
  cp desktop/Info.plist "$app/Contents/Info.plist"
  iconset="$(mktemp -d "${TMPDIR:-/tmp}/anywork-icon.XXXXXX")/AnyWork.iconset"
  mkdir -p "$iconset"
  for size in 16 32 128 256 512; do
    sips -z "$size" "$size" web/public/icon-512.png --out "$iconset/icon_${size}x${size}.png" >/dev/null
    double=$((size * 2))
    sips -z "$double" "$double" web/public/icon-512.png --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
  done
  python3 scripts/make-icns.py "$iconset" "$resources/AnyWork.icns"
  rm -rf "$(dirname "$iconset")"
  codesign --force --deep --sign - "$app"
fi
echo "$app"
